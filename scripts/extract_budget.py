"""Extract a book printed from a spreadsheet, where rows must be rebuilt from characters in drawing order.

Usage:
    python scripts/extract_budget.py "governments/lancaster-city/sources/2027-Mayors-Revised-Proposed-Budget-Rev-11-19-26.pdf"

Everything that belongs to one book comes from its config (governments/<id>/books/<pdf stem>.yaml):
`amount_columns` (the printed amount columns, left to right), `note_fonts` (the fonts of the explanatory notes),
`staffing.columns` (one count/salary pair per printed column) and the fund / department maps. Nothing in this file
names a government, a year or a fund.

Writes to data/processed/ (or --out):
    line_items_<doc>.csv   one row per account line, every amount column (wide)
    budget_long_<doc>.csv  the dashboard's long table: one row per line x column
    staffing_<doc>.csv     one row per budgeted position
    validation_<doc>.csv   every printed TOTAL row vs. the sum of what we parsed

Works on PDFs that have a text layer. Scanned PDFs must be OCR'd first (see README). Every printed TOTAL row is
re-computed from the parsed lines; any mismatch larger than ROUNDING_TOLERANCE is flagged and the script exits
non-zero so bad data never reaches the dashboard silently.
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
import pdfplumber

from budget_common import (
    OUT_DIR, ROUNDING_TOLERANCE, acknowledge_known_issues, category_for,
    find_rollup, make_fund_mapper, print_summary, staff_check, to_long,
    to_number, total_check, check_counts,
)

# The 11/16 2027 book embeds the note font as "CIDFont+F2"; the 11/19 book (re-saved through macOS) renames the same
# font "Calibri" (and the table font "Calibri-Bold", which "+Calibri" does not match). A book names its own in
# `note_fonts`; this is only the fallback for a book that does not.
DEFAULT_NOTE_FONTS = ("CIDFont+F2", "+Calibri")

NUM = r"\(?-?[\d,]+\)?"
COUNT = r"\(?-?[\d.,]+\)?"   # a position count, printed with 1-3 decimals ("1.00", "0.75")


def pair_pattern(n: int) -> str:
    """The count/salary cells of a staffing row, one pair per printed column: '<count> <salary>' repeated n times."""
    return " ".join([f"({COUNT}) ({NUM})"] * n)


def extract(pdf_path, book):
    """Parse one book. `book` is a Book (see book_from_config)."""
    items, sections, staff, staff_checks = [], [], [], []
    open_items = []          # line items waiting for their section TOTAL
    leaf_totals = []         # printed totals of every leaf section so far
    staff_dept = None
    open_positions = []      # positions waiting for a "TOTAL xxxxxx EMPLOYEES"
    open_staff_groups = []   # subtotals waiting for "TOTAL EMPLOYEES"
    unparsed = []
    seen_pages = {}          # page text -> first page number (catch duplicates)

    keys, columns = book["amount_keys"], book["amount_columns"]
    st_keys, st_flat = book["staff_keys"], book["staff_flat"]
    fund_and_department = book["fund_and_department"]
    re_position = re.compile(rf"^(\d{{7,9}}) (\d{{6}}) (.+?) ?(\d{{4}}) (FT|PT) {pair_pattern(len(st_keys))}$")
    re_staff_subtotal = re.compile(rf"^TOTAL (\d{{6}}) EMPLOYEES {pair_pattern(len(st_keys))}$")
    re_staff_total = re.compile(rf"^TOTAL EMPLOYEES {pair_pattern(len(st_keys))}$")
    re_staff_grand = re.compile(rf"^TOTAL {pair_pattern(len(st_keys))}$")
    re_bonus = re.compile(r"^(?:(\d{7,9}) (\d{6}) )?(BONUS|Bonus) ([\d,]+) ([\d,]+)$")

    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages):
            page_no = page_index + 1
            table_lines, note_lines = page_lines(page, book["note_fonts"])
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
                m = re.match(rf"^(\d{{7,9}}) (\d{{6}}|TBD) (.+?) ({NUM}(?: {NUM}){{{len(keys) - 1}}})$", text)
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
                        **dict(zip(keys, map(to_number, nums.split()))),
                    }
                    items.append(item)
                    open_items.append(item)
                    page_items.append((top, item))
                    continue

                m = re.match(rf"^TOTAL\s*-\s*(.+?) ({NUM}(?: {NUM}){{{len(keys) - 1}}})$", text)
                if m:
                    label, nums = m.group(1).strip(), m.group(2)
                    printed = list(map(to_number, nums.split()))
                    if open_items:
                        n_members, level = len(open_items), "section"
                        for it in open_items:
                            it["bureau"] = label
                        sums = [sum(it[k] for it in open_items) for k in keys]
                        diffs = [s - p for s, p in zip(sums, printed)]
                        leaf_totals.append(printed)
                        open_items = []
                    else:
                        # Roll-up total (department / fund): match it against
                        # a run of the preceding section totals.
                        level = "rollup"
                        n_members, diffs = find_rollup(leaf_totals, printed)
                    sections.append(total_check(
                        level, label, page_no, n_members, diffs, printed, keys))
                    continue

                # --- staffing schedule --------------------------------------
                m = re_position.match(text)
                if m:
                    org, obj, title, bu, ftpt, *cells = m.groups()
                    fund, dept = fund_and_department(org)
                    pairs = [to_number(x) for x in cells]
                    pos = {
                        "org_code": org, "object_code": obj, "fund": fund,
                        "department": dept, "unit": staff_dept,
                        "position_title": title.strip(), "bargaining_unit": bu,
                        "ft_pt": ftpt,
                    }
                    for (ck, sk), (count, salary) in zip(st_keys, zip(pairs[::2], pairs[1::2])):
                        pos[ck], pos[sk] = count, salary
                    pos["source_page"] = page_no
                    staff.append(pos)
                    open_positions.append(pos)
                    continue

                m = re_staff_subtotal.match(text)
                if m:
                    obj, *cells = m.groups()
                    printed = list(map(to_number, cells))
                    sums = [sum(p[k] for p in open_positions) for k in st_flat]
                    staff_checks.append(staff_check(
                        "object", f"{staff_dept} / {obj}", page_no,
                        len(open_positions), sums, printed))
                    open_staff_groups.append(printed)
                    open_positions = []
                    continue

                m = re_staff_total.match(text)
                if m:
                    printed = list(map(to_number, m.groups()))
                    groups = open_staff_groups + (
                        [[sum(p[k] for p in open_positions) for k in st_flat]] if open_positions else []
                    )
                    sums = [sum(g[i] for g in groups) for i in range(len(st_flat))]
                    staff_checks.append(staff_check(
                        "unit", staff_dept, page_no, len(groups), sums, printed))
                    open_staff_groups, open_positions = [], []
                    continue

                m = re_staff_grand.match(text)
                if m and staff:
                    printed = list(map(to_number, m.groups()))
                    sums = [sum(p[k] for p in staff) for k in st_flat]
                    staff_checks.append(staff_check(
                        "grand_total", "All staffing schedules", page_no,
                        len(staff), sums, printed))
                    continue

                m = re_bonus.match(text)
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
                        "ft_pt": "", "source_page": page_no,
                    }
                    for i, (ck, sk) in enumerate(st_keys):
                        pos[ck] = 0
                        pos[sk] = to_number((s1, s2)[i] if i < 2 else 0)
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


def book_from_config(cfg, gov):
    """The parts of a book config this extractor needs, ready to use."""
    columns = [(c["fiscal_year"], c["doc_type"]) for c in cfg["amount_columns"]]
    st_columns = [(c["fiscal_year"], c["doc_type"]) for c in cfg["staffing"]["columns"]]
    st_keys = [(f"count_{fy}_{fig}", f"salary_{fy}_{fig}") for fy, fig in st_columns]
    return {
        "amount_columns": columns,
        "amount_keys": [f"{fig}_{fy}" for fy, fig in columns],
        "note_fonts": tuple(cfg.get("note_fonts") or DEFAULT_NOTE_FONTS),
        "fund_and_department": make_fund_mapper(cfg, gov),
        "staff_keys": st_keys,
        "staff_flat": [k for pair in st_keys for k in pair],
    }


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


def page_lines(page, note_fonts=DEFAULT_NOTE_FONTS):
    """Return (table_lines, note_lines): lists of (top, text) for one page.

    Explanatory notes are set in `note_fonts`; they overlap the table rows and corrupt them if read together, so they
    are split out and attached to the line above."""
    is_note = lambda c: c.get("fontname", "").endswith(tuple(note_fonts))
    table = [c for c in page.chars if not is_note(c)]
    notes = [c for c in page.chars if is_note(c)]
    return rows_from_chars(table), rows_from_chars(notes)


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


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--gov", help="government id (default: site.yaml default_government)")
    args = ap.parse_args()
    if not run(args.pdf, args.out, gov=args.gov)["ok"]:
        sys.exit(1)


def run(pdf, out=OUT_DIR, gov=None, cfg=None):
    """Extract and validate a spreadsheet-printed book from its config. Returns a stats dict."""
    import govconfig
    gov = govconfig.resolve_government(gov)
    pdf = Path(pdf)
    if cfg is None:
        cfg = govconfig.book_config(gov.id, pdf.name)
        if cfg is None:
            sys.exit(f"{govconfig.books_dir(gov.id) / (pdf.stem + '.yaml')}: no book config for {pdf.name}")
    book = book_from_config(cfg, gov)
    doc = pdf.stem
    items, sections, staff, staff_checks, unparsed = extract(pdf, book)
    Path(out).mkdir(parents=True, exist_ok=True)

    wide = pd.DataFrame(items)
    cols = ["fund", "department", "bureau", "account_code", "org_code",
            "object_code", "account_name", "category", *book["amount_keys"],
            "description", "source_page"]
    wide = wide[cols]
    wide.to_csv(Path(out) / f"line_items_{doc}.csv", index=False)
    to_long(items, book["amount_columns"], book["amount_keys"], pdf.name).to_csv(
        Path(out) / f"budget_long_{doc}.csv", index=False)
    pd.DataFrame(staff).to_csv(Path(out) / f"staffing_{doc}.csv", index=False)
    checks = pd.DataFrame(sections + staff_checks)

    checks = acknowledge_known_issues(checks, pdf.name, gov)
    checks.to_csv(Path(out) / f"validation_{doc}.csv", index=False)
    ok = print_summary(items, staff, checks, unparsed)
    return {"ok": ok, "line_items": len(items), "positions": len(staff),
            **check_counts(checks), "source": "text"}


if __name__ == "__main__":
    main()
