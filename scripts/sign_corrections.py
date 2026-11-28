"""Find amounts the city printed without their minus sign, and log the flips.

Usage:
    python scripts/sign_corrections.py <doc stem>            # show candidates
    python scripts/sign_corrections.py <doc stem> --append   # write proven ones

Some books print negative amounts with no sign (no "-", no parentheses), but
their section TOTAL rows count them as negative. When that happens the lines
add up to more than the printed total by exactly twice the unsigned values.

A value is flipped only when the printed total proves it (rule agreed with
the project owner):
  * the gap in one column is positive and equals 2 x one line's value within
    the $5 rounding tolerance, and no other single line fits; or
  * no single line fits, and exactly one pair of lines fits.
Anything else (no fit, several fits) is left as printed and stays in
known_issues.csv for a person.

Flips are written to notes/sign_corrections.csv with the evidence (printed
total, line sum, gap). extract_layout.py applies them and keeps the printed
value in the line_items `as_printed` column, so every change can be audited.
Run this on outputs produced *before* the flips are applied; sections that
already pass yield no candidates, so re-running is harmless.
"""

import argparse
import itertools
import sys

import pandas as pd

from budget_common import OUT_DIR, ROOT, ROUNDING_TOLERANCE

SIGN_FILE = ROOT / "data" / "sign_corrections.csv"
FIELDS = ["source_doc", "source_page", "account_code", "column", "printed_value",
          "corrected_value", "section", "section_page", "printed_total", "line_sum",
          "gap", "evidence"]


def explanations(members, column, gap):
    """Line combinations whose doubled sum equals the gap: (size, [hits])."""
    vals = [(r.account_code, int(r.source_page), r[column])
            for _, r in members.iterrows() if pd.notna(r[column]) and r[column] > 0]
    for n in (1, 2):
        hits = [c for c in itertools.combinations(vals, n)
                if abs(2 * sum(v for *_, v in c) - gap) <= ROUNDING_TOLERANCE]
        if hits:
            return n, hits
    return 0, []


def candidates(doc):
    v = pd.read_csv(OUT_DIR / f"validation_{doc}.csv")
    li = pd.read_csv(OUT_DIR / f"line_items_{doc}.csv", dtype={"account_code": str})
    flips, ambiguous = [], []
    for _, r in v[(v.level == "section") & ~v.passed].iterrows():
        members = li[li.bureau == r.label]
        for col in [c[5:] for c in v.columns if c.startswith("diff_")]:
            gap = r.get(f"diff_{col}")
            if pd.isna(gap) or gap <= ROUNDING_TOLERANCE:
                continue
            size, hits = explanations(members, col, gap)
            printed_total = r[f"printed_{col}"]
            if len(hits) != 1:
                ambiguous.append((r.source_page, r.label, col, gap, size, len(hits)))
                continue
            for code, page, value in hits[0]:
                flips.append({
                    "source_page": page, "account_code": code, "column": col,
                    "printed_value": int(value), "corrected_value": -int(value),
                    "section": r.label, "section_page": int(r.source_page),
                    "printed_total": int(printed_total),
                    "line_sum": int(printed_total + gap), "gap": int(gap),
                    "evidence": (f"Lines of '{r.label}' sum to {printed_total + gap:,.0f}, "
                                 f"{gap:,.0f} above the printed total {printed_total:,.0f}"
                                 f" = 2 x " + " + ".join(f"{v:,.0f}" for *_, v in hits[0])
                                 + (" (the only single line that fits)" if size == 1 else
                                    " (no single line fits; the only pair that does)")),
                })
    return flips, ambiguous


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("doc")
    ap.add_argument("--source-doc", help="PDF file name (default: <doc>.pdf)")
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args()
    flips, ambiguous = candidates(args.doc)
    source_doc = args.source_doc or f"{args.doc}.pdf"
    for f in flips:
        print(f"flip p{f['source_page']} {f['account_code']} {f['column']}: "
              f"{f['printed_value']:,} -> {f['corrected_value']:,}  [{f['evidence']}]")
    for page, label, col, gap, size, n in ambiguous:
        why = "no line combination fits" if n == 0 else f"{n} combinations of {size} fit"
        print(f"leave p{page} {label} {col}: gap {gap:,.0f}, {why}")
    if args.append and flips:
        existing = pd.read_csv(SIGN_FILE, dtype=str) if SIGN_FILE.exists() else \
            pd.DataFrame(columns=FIELDS)
        new = pd.DataFrame([{**f, "source_doc": source_doc} for f in flips])[FIELDS]
        key = ["source_doc", "source_page", "account_code", "column"]
        new = new[~new[key].astype(str).apply(tuple, axis=1).isin(
            existing[key].astype(str).apply(tuple, axis=1))]
        pd.concat([existing, new.astype(str)]).to_csv(SIGN_FILE, index=False)
        print(f"Appended {len(new)} flips to {SIGN_FILE}")


if __name__ == "__main__":
    sys.exit(main())
