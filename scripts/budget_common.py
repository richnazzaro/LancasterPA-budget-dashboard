"""Shared pieces of the budget extractors.

Used by extract_budget.py (PDFs with a text layer) and extract_scanned.py
(image-only PDFs read with OCR), so both produce the same tables and apply
the same checks:

    line_items_<doc>.csv   one row per account line, every amount column (wide)
    budget_long_<doc>.csv  the dashboard's long table: one row per line x column
    staffing_<doc>.csv     one row per budgeted position
    validation_<doc>.csv   every printed TOTAL row vs. the sum of what we parsed
"""

import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "processed"

# Printed checks that fail because of errors in the source PDF itself, after a
# person has reviewed them. Unreviewed failures still stop the pipeline.
KNOWN_ISSUES_FILE = ROOT / "data" / "known_issues.csv"

# The city's spreadsheet rounds each cell independently, so sums can drift by
# a few dollars from the printed total. Anything bigger is a real problem.
ROUNDING_TOLERANCE = 5

LONG_COLUMNS = ["fiscal_year", "doc_type", "fund", "department", "bureau",
                "account_code", "org_code", "object_code", "account_name",
                "category", "amount", "source_doc", "source_page"]


def to_number(token):
    token = token.strip()
    negative = token.startswith("(") or token.startswith("-")
    digits = re.sub(r"[^\d.]", "", token)
    value = float(digits) if digits else 0.0
    value = int(value) if value.is_integer() else value
    return -value if negative else value


def make_fund_mapper(funds, general_fund_departments, department_overrides,
                     other_fund_department="Public Works"):
    """Return org_code -> (fund, department) for one budget book.

    General Fund org codes are 7 digits; the first 2 give the department and
    4-digit overrides move bureaus that report elsewhere. Longer org codes
    belong to the enterprise funds, keyed by their first 3 digits. A fund
    entry may be a name, or {"fund": name, "department": dept}.
    """
    def mapper(org_code):
        if len(org_code) >= 8:
            entry = funds.get(org_code[:3], f"Unknown fund {org_code[:3]}")
            if isinstance(entry, dict):
                return entry["fund"], entry.get("department", other_fund_department)
            return entry, other_fund_department
        dept = department_overrides.get(org_code[:4]) or \
            general_fund_departments.get(org_code[:2], f"Unknown dept {org_code[:2]}")
        return "General Fund", dept
    return mapper


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


def find_rollup(leaf_totals, printed):
    """Find the run of most-recent section totals that adds up to `printed`.

    Roll-ups nest (bureau -> department -> fund), so rather than tracking the
    hierarchy we search backwards for a contiguous run of leaf sections whose
    sum matches every printed column. Returns (count, diffs) of the best run.
    """
    running = [0] * len(printed)
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


def total_check(level, label, page_no, members, diffs, printed, amount_keys):
    return {
        "level": level,
        "label": label,
        "source_page": page_no,
        "members": members,
        "max_abs_diff": max(abs(d) for d in diffs),
        "passed": all(abs(d) <= ROUNDING_TOLERANCE for d in diffs),
        **{f"printed_{k}": p for k, p in zip(amount_keys, printed)},
        **{f"diff_{k}": d for k, d in zip(amount_keys, diffs)},
    }


def staff_check(level, label, page_no, members, sums, printed):
    diffs = [s - p for s, p in zip(sums, printed)]
    return {
        "level": f"staffing_{level}", "label": label, "source_page": page_no,
        "members": members, "max_abs_diff": max(abs(d) for d in diffs),
        "passed": all(abs(d) <= ROUNDING_TOLERANCE for d in diffs),
        "printed_counts_salaries": printed, "parsed_counts_salaries": sums,
    }


def to_long(items, amount_columns, amount_keys, source_doc):
    rows = []
    for it in items:
        for (fy, doc), key in zip(amount_columns, amount_keys):
            if it.get(key) is None or it[key] != it[key]:   # column not on this page
                continue
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
    return pd.DataFrame(rows, columns=LONG_COLUMNS)


def acknowledge_known_issues(checks, source_doc):
    """Mark failed checks that a person has logged as source-PDF errors."""
    checks["acknowledged"] = ""
    if KNOWN_ISSUES_FILE.exists():
        known = pd.read_csv(KNOWN_ISSUES_FILE)
        known = known[known["source_doc"] == source_doc]
        for _, k in known.iterrows():
            hit = (checks["source_page"] == k["source_page"]) & \
                  (checks["label"] == k["label"]) & ~checks["passed"]
            checks.loc[hit, "acknowledged"] = k["note"]
    return checks


def check_counts(checks):
    """passed / acknowledged (reviewed source errors) / failed (unreviewed)."""
    failed = ~checks["passed"]
    ack = failed & (checks["acknowledged"].fillna("") != "")
    return {"checks": len(checks), "passed": int(checks["passed"].sum()),
            "acknowledged": int(ack.sum()), "failed": int((failed & ~ack).sum())}


def print_summary(items, staff, checks, unparsed):
    """Print the run summary. Returns True if every check passed or is known."""
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
        return False
    print("\nAll checks pass or are acknowledged source issues.")
    return True
