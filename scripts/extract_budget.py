"""Extract City of Lancaster (PA) budget PDFs into clean, validated tables.

Usage:
    python scripts/extract_budget.py "Budget PDFs - City/2027-RevisedProposedBudget-Compressed.pdf"

Writes to data/processed/:
    line_items_<doc>.csv   one row per account line, all 8 amount columns (wide)
    budget_long_<doc>.csv  the dashboard's long table: one row per line x column
    staffing_<doc>.csv     one row per budgeted position
    validation_<doc>.csv   every printed TOTAL row vs. the sum of what we parsed

Works on PDFs that have a text layer. Scanned PDFs must be OCR'd first
(see README). Every printed TOTAL row is re-computed from the parsed lines;
any mismatch larger than ROUNDING_TOLERANCE is flagged and the script exits
non-zero so bad data never reaches the dashboard silently.
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "processed"

# The city's spreadsheet rounds each cell independently, so sums can drift by
# a few dollars from the printed total. Anything bigger is a real problem.
ROUNDING_TOLERANCE = 5

# The 8 amount columns on line-item pages, left to right.
# (fiscal_year, doc_type)
AMOUNT_COLUMNS = [
    (2025, "actual"),
    (2026, "adopted"),            # "2026 ORIGINAL BUDGET"
    (2026, "amended"),            # "2026 AMENDED BUDGET"
    (2026, "actual_ytd"),         # "ACTUAL YTD" (as-of date printed in header)
    (2026, "projected"),
    (2026, "projected_revised"),
    (2027, "proposed"),
    (2027, "proposed_revised"),
]
AMOUNT_KEYS = [f"{doc}_{fy}" for fy, doc in AMOUNT_COLUMNS]

# Explanatory notes under each line item are set in this font. They overlap
# the table rows vertically and corrupt them if read together, so we split
# them out and attach them to the line above as a description.
NOTE_FONT_SUFFIX = "CIDFont+F2"

NUM = r"\(?-?[\d,]+\)?"
EIGHT_NUMS = rf"((?:{NUM} ){{7}}{NUM})"
RE_LINE_ITEM = re.compile(rf"^(\d{{7,9}}) (\d{{6}}|TBD) (.+?) {EIGHT_NUMS}$")
RE_SECTION_TOTAL = re.compile(rf"^TOTAL\s*-\s*(.+?) {EIGHT_NUMS}$")
RE_POSITION = re.compile(
    r"^(\d{7,9}) (\d{6}) (.+?) ?(\d{4}) (FT|PT) ([\d.]+) ([\d,]+) ([\d.]+) ([\d,]+)$"
)
RE_BONUS = re.compile(r"^(?:(\d{7,9}) (\d{6}) )?(BONUS|Bonus) ([\d,]+) ([\d,]+)$")
RE_STAFF_SUBTOTAL = re.compile(
    r"^TOTAL (\d{6}) EMPLOYEES ([\d.]+) ([\d,]+) ([\d.]+) ([\d,]+)$"
)
RE_STAFF_TOTAL = re.compile(r"^TOTAL EMPLOYEES ([\d.]+) ([\d,]+) ([\d.]+) ([\d,]+)$")
RE_STAFF_GRAND_TOTAL = re.compile(r"^TOTAL ([\d.]+) ([\d,]{5,}) ([\d.]+) ([\d,]{5,})$")

FUNDS = {  # org-code prefix -> fund
    "560": "Stormwater Management Fund",
    "561": "Sewer Fund",
    "562": "Water Fund",
    "563": "Solid Waste & Recycling Fund",
}
# General Fund org codes are 7 digits; the first 2 give the department.
# A few bureaus report to a different department than their code suggests,
# so 4-digit overrides follow the "General Fund Expense Summary" page.
GENERAL_FUND_DEPARTMENTS = {
    "10": "General Revenue",
    "11": "Executive",
    "12": "Legislative",
    "13": "Neighborhood Engagement",
    "14": "Administrative Services",
    "15": "Public Safety",
    "16": "Community Planning & Economic Development",
    "18": "Public Works",
}
GENERAL_FUND_DEPARTMENT_OVERRIDES = {
    "1405": "Executive",                     # Human Resources
    "1403": "City Controller / Treasurer",
}

# Printed checks that fail because of errors in the source PDF itself, after a
# person has reviewed them. Unreviewed failures still stop the pipeline.
KNOWN_ISSUES_FILE = ROOT / "data" / "known_issues.csv"


def to_number(token):
    token = token.strip()
    negative = token.startswith("(") or token.startswith("-")
    digits = re.sub(r"[^\d.]", "", token)
    value = float(digits) if digits else 0.0
    value = int(value) if value.is_integer() else value
    return -value if negative else value


def fund_and_department(org_code):
    if len(org_code) >= 8:
        return FUNDS.get(org_code[:3], f"Unknown fund {org_code[:3]}"), "Public Works"
    dept = GENERAL_FUND_DEPARTMENT_OVERRIDES.get(org_code[:4]) or \
        GENERAL_FUND_DEPARTMENTS.get(org_code[:2], f"Unknown dept {org_code[:2]}")
    return "General Fund", dept


def category_for(object_code):
    """Broad category from the object (account) code."""
    if object_code == "TBD":
        return "Uncoded"
    first, first_two = object_code[0], object_code[:2]
    if first == "4":
        return "Revenue"
    if first_two == "61":
        return "Salaries & Wages"
    if first_two == "62":
        return "Benefits"
    if first == "6":
        return "Personnel - Other"
    if first == "7":
        return "Operating"
    if first == "8":
        return "Equipment & Capital"
    if first == "9":
        return "Debt, Transfers & Allocations"
    return "Other"


def rows_from_chars(chars, y_tolerance=3, cell_gap=1.5):
    """Rebuild text rows from characters in the order the PDF draws them.

    The budget was printed from a spreadsheet, which draws one cell at a time.
    When a long cell (e.g. a job title) overflows into the next column, sorting
    characters by x-position interleaves the two cells ("MANA20G0E0R").
    Keeping drawing order and starting a new cell whenever x jumps backwards
    or leaves a gap keeps every cell intact.
    """
    rows = []  # [top, [chars...]]
    for c in chars:
        for row in rows:
            if abs(row[0] - c["top"]) <= y_tolerance:
                row[1].append(c)
                break
        else:
            rows.append([c["top"], [c]])
    out = []
    for top, cs in sorted(rows, key=lambda r: r[0]):
        cells, cur, prev_x1 = [], "", None
        for c in cs:
            if prev_x1 is not None:
                if c["x0"] < prev_x1 - 1:      # jumped back: new cell
                    cells.append(cur)
                    cur = ""
                elif c["x0"] - prev_x1 > cell_gap:  # visible gap: word break
                    cur += " "
            cur += c["text"]
            prev_x1 = c["x1"]
        cells.append(cur)
        text = " ".join(" ".join(cell.split()) for cell in cells if cell.strip())
        if text:
            out.append((top, text))
    return out


def page_lines(page):
    """Return (table_lines, note_lines): lists of (top, text) for one page."""
    is_note = lambda c: c.get("fontname", "").endswith(NOTE_FONT_SUFFIX)
    table = [c for c in page.chars if not is_note(c)]
    notes = [c for c in page.chars if is_note(c)]
    return rows_from_chars(table), rows_from_chars(notes)


def find_rollup(leaf_totals, printed):
    """Find the run of most-recent section totals that adds up to `printed`.

    Roll-ups nest (bureau -> department -> fund), so rather than tracking the
    hierarchy we search backwards for a contiguous run of leaf sections whose
    sum matches all 8 printed columns. Returns (count, diffs) of the best run.
    """
    running = [0] * 8
    best = None
    for k, sec in enumerate(reversed(leaf_totals), start=1):
        running = [r + s for r, s in zip(running, sec)]
        diffs = [r - p for r, p in zip(running, printed)]
        worst = max(abs(d) for d in diffs)
        if best is None or worst < best[2]:
            best = (k, diffs, worst)
        if worst <= max(ROUNDING_TOLERANCE, k):
            return k, diffs
    return (best[0], best[1]) if best else (0, [-p for p in printed])


def extract(pdf_path):
    items, sections, staff, staff_checks = [], [], [], []
    open_items = []          # line items waiting for their section TOTAL
    leaf_totals = []         # printed totals of every leaf section so far
    staff_dept = None
    open_positions = []      # positions waiting for a "TOTAL xxxxxx EMPLOYEES"
    open_staff_groups = []   # subtotals waiting for "TOTAL EMPLOYEES"
    unparsed = []
    seen_pages = {}          # page text -> first page number (catch duplicates)

    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages):
            page_no = page_index + 1
            table_lines, note_lines = page_lines(page)
            if not table_lines:
                continue
            fingerprint = "\n".join(t for _, t in table_lines)
            if re.search(r"^\d{7,9} ", fingerprint, re.M) and fingerprint in seen_pages:
                sections.append({
                    "level": "duplicate_page",
                    "label": f"Page {page_no} repeats page {seen_pages[fingerprint]}; skipped",
                    "source_page": page_no, "members": 0, "max_abs_diff": 0,
                    "passed": False,
                })
                continue
            seen_pages.setdefault(fingerprint, page_no)
            page_items = []  # (top, item) for attaching notes

            for top, text in table_lines:
                # --- line items -------------------------------------------
                m = RE_LINE_ITEM.match(text)
                if m:
                    org, obj, name, nums = m.groups()
                    fund, dept = fund_and_department(org)
                    item = {
                        "org_code": org,
                        "object_code": obj,
                        "account_code": f"{org}-{obj}",
                        "account_name": name.strip(),
                        "fund": fund,
                        "department": dept,
                        "category": category_for(obj),
                        "source_page": page_no,
                        "description": "",
                        **dict(zip(AMOUNT_KEYS, map(to_number, nums.split()))),
                    }
                    items.append(item)
                    open_items.append(item)
                    page_items.append((top, item))
                    continue

                m = RE_SECTION_TOTAL.match(text)
                if m:
                    label, nums = m.group(1).strip(), m.group(2)
                    printed = list(map(to_number, nums.split()))
                    if open_items:
                        n_members, level = len(open_items), "section"
                        for it in open_items:
                            it["bureau"] = label
                        sums = [sum(it[k] for it in open_items) for k in AMOUNT_KEYS]
                        diffs = [s - p for s, p in zip(sums, printed)]
                        leaf_totals.append(printed)
                        open_items = []
                    else:
                        # Roll-up total (department / fund): match it against
                        # a run of the preceding section totals.
                        level = "rollup"
                        n_members, diffs = find_rollup(leaf_totals, printed)
                    sections.append({
                        "level": level,
                        "label": label,
                        "source_page": page_no,
                        "members": n_members,
                        "max_abs_diff": max(abs(d) for d in diffs),
                        "passed": all(abs(d) <= ROUNDING_TOLERANCE for d in diffs),
                        **{f"printed_{k}": p for k, p in zip(AMOUNT_KEYS, printed)},
                        **{f"diff_{k}": d for k, d in zip(AMOUNT_KEYS, diffs)},
                    })
                    continue

                # --- staffing schedule --------------------------------------
                m = RE_POSITION.match(text)
                if m:
                    org, obj, title, bu, ftpt, c1, s1, c2, s2 = m.groups()
                    fund, dept = fund_and_department(org)
                    pos = {
                        "org_code": org, "object_code": obj, "fund": fund,
                        "department": dept, "unit": staff_dept,
                        "position_title": title.strip(), "bargaining_unit": bu,
                        "ft_pt": ftpt,
                        "count_2027_proposed": to_number(c1),
                        "salary_2027_proposed": to_number(s1),
                        "count_2027_proposed_revised": to_number(c2),
                        "salary_2027_proposed_revised": to_number(s2),
                        "source_page": page_no,
                    }
                    staff.append(pos)
                    open_positions.append(pos)
                    continue

                m = RE_STAFF_SUBTOTAL.match(text)
                if m:
                    obj, c1, s1, c2, s2 = m.groups()
                    printed = list(map(to_number, (c1, s1, c2, s2)))
                    sums = [
                        sum(p["count_2027_proposed"] for p in open_positions),
                        sum(p["salary_2027_proposed"] for p in open_positions),
                        sum(p["count_2027_proposed_revised"] for p in open_positions),
                        sum(p["salary_2027_proposed_revised"] for p in open_positions),
                    ]
                    staff_checks.append(_staff_check(
                        "object", f"{staff_dept} / {obj}", page_no,
                        len(open_positions), sums, printed))
                    open_staff_groups.append(printed)
                    open_positions = []
                    continue

                m = RE_STAFF_TOTAL.match(text)
                if m:
                    printed = list(map(to_number, m.groups()))
                    groups = open_staff_groups + (
                        [[sum(p[k] for p in open_positions) for k in (
                            "count_2027_proposed", "salary_2027_proposed",
                            "count_2027_proposed_revised",
                            "salary_2027_proposed_revised")]]
                        if open_positions else []
                    )
                    sums = [sum(g[i] for g in groups) for i in range(4)]
                    staff_checks.append(_staff_check(
                        "unit", staff_dept, page_no, len(groups), sums, printed))
                    open_staff_groups, open_positions = [], []
                    continue

                m = RE_STAFF_GRAND_TOTAL.match(text)
                if m and staff:
                    printed = list(map(to_number, m.groups()))
                    sums = [sum(p[k] for p in staff) for k in (
                        "count_2027_proposed", "salary_2027_proposed",
                        "count_2027_proposed_revised", "salary_2027_proposed_revised")]
                    staff_checks.append(_staff_check(
                        "grand_total", "All staffing schedules", page_no,
                        len(staff), sums, printed))
                    continue

                m = RE_BONUS.match(text)
                if m:
                    org, obj, title, s1, s2 = m.groups()
                    if org is None and open_positions:  # "Bonus" row with no codes
                        org = open_positions[-1]["org_code"]
                        obj = open_positions[-1]["object_code"]
                    title = title.upper()
                    fund, dept = fund_and_department(org)
                    pos = {
                        "org_code": org, "object_code": obj, "fund": fund,
                        "department": dept, "unit": staff_dept,
                        "position_title": title.strip(), "bargaining_unit": "",
                        "ft_pt": "", "count_2027_proposed": 0,
                        "salary_2027_proposed": to_number(s1),
                        "count_2027_proposed_revised": 0,
                        "salary_2027_proposed_revised": to_number(s2),
                        "source_page": page_no,
                    }
                    staff.append(pos)
                    open_positions.append(pos)
                    continue

                # Staffing unit headings are all-caps lines with no digits.
                if (text.isupper() and not re.search(r"\d", text)
                        and len(text) > 3 and "STAFFING SCHEDULE" not in text
                        and text not in {"CITY OF LANCASTER"}
                        and not text.startswith(("APPROPRIATION", "TOTAL"))):
                    staff_dept = text.title()

                if re.match(r"^\d{7,9} ", text) or text.startswith("TOTAL"):
                    unparsed.append({"source_page": page_no, "text": text})

            _attach_notes(page_items, note_lines)

    if open_items:
        unparsed.append({"source_page": -1,
                         "text": f"{len(open_items)} line items never closed by a TOTAL"})
    return items, sections, staff, staff_checks, unparsed


def _staff_check(level, label, page_no, members, sums, printed):
    diffs = [s - p for s, p in zip(sums, printed)]
    return {
        "level": f"staffing_{level}", "label": label, "source_page": page_no,
        "members": members, "max_abs_diff": max(abs(d) for d in diffs),
        "passed": all(abs(d) <= ROUNDING_TOLERANCE for d in diffs),
        "printed_counts_salaries": printed, "parsed_counts_salaries": sums,
    }


def _attach_notes(page_items, note_lines):
    """Give each note line to the closest line item above it on the page."""
    if not page_items:
        return
    for top, text in note_lines:
        # A note starts ~12pt below its item. Its last line can sit a hair
        # above the next item's row, so require a clear 3pt gap.
        above = [(t, it) for t, it in page_items if t <= top - 3]
        if not above:
            continue
        item = max(above, key=lambda x: x[0])[1]
        item["description"] = (item["description"] + " " + text).strip()


def to_long(items, source_doc):
    rows = []
    for it in items:
        for (fy, doc), key in zip(AMOUNT_COLUMNS, AMOUNT_KEYS):
            rows.append({
                "fiscal_year": fy,
                "doc_type": doc,
                "fund": it["fund"],
                "department": it["department"],
                "bureau": it.get("bureau", ""),
                "account_code": it["account_code"],
                "org_code": it["org_code"],
                "object_code": it["object_code"],
                "account_name": it["account_name"],
                "category": it["category"],
                "amount": it[key],
                "source_doc": source_doc,
                "source_page": it["source_page"],
            })
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()

    doc = args.pdf.stem
    items, sections, staff, staff_checks, unparsed = extract(args.pdf)
    args.out.mkdir(parents=True, exist_ok=True)

    wide = pd.DataFrame(items)
    cols = ["fund", "department", "bureau", "account_code", "org_code",
            "object_code", "account_name", "category", *AMOUNT_KEYS,
            "description", "source_page"]
    wide = wide[cols]
    wide.to_csv(args.out / f"line_items_{doc}.csv", index=False)
    to_long(items, args.pdf.name).to_csv(args.out / f"budget_long_{doc}.csv", index=False)
    pd.DataFrame(staff).to_csv(args.out / f"staffing_{doc}.csv", index=False)
    checks = pd.DataFrame(sections + staff_checks)

    checks["acknowledged"] = ""
    if KNOWN_ISSUES_FILE.exists():
        known = pd.read_csv(KNOWN_ISSUES_FILE)
        known = known[known["source_doc"] == args.pdf.name]
        for _, k in known.iterrows():
            hit = (checks["source_page"] == k["source_page"]) & \
                  (checks["label"] == k["label"]) & ~checks["passed"]
            checks.loc[hit, "acknowledged"] = k["note"]
    checks.to_csv(args.out / f"validation_{doc}.csv", index=False)

    failed = checks[~checks["passed"] & (checks["acknowledged"] == "")]
    acknowledged = checks[~checks["passed"] & (checks["acknowledged"] != "")]
    print(f"Line items:      {len(items)}")
    print(f"Positions:       {len(staff)}")
    for level, grp in checks.groupby("level"):
        print(f"Checks {level:<18} {grp['passed'].sum():>3}/{len(grp)} passed")
    if unparsed:
        print(f"\nUnparsed lines that look like data ({len(unparsed)}):")
        for u in unparsed[:30]:
            print(f"  p{u['source_page']}: {u['text'][:110]}")
    if len(acknowledged):
        print("\nKnown source-document issues (reviewed, see data/known_issues.csv):")
        for _, r in acknowledged.iterrows():
            print(f"  p{r.source_page} [{r.level}] {r.label}")
    if len(failed):
        print("\nFAILED checks (need review):")
        for _, r in failed.iterrows():
            print(f"  p{r.source_page} [{r.level}] {r.label}: off by up to {r.max_abs_diff:,}")
        sys.exit(1)
    print("\nAll checks pass or are acknowledged source issues.")


if __name__ == "__main__":
    main()
