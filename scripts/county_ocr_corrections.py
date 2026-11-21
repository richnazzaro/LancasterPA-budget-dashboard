"""Propose OCR fixes for a scanned County book, for a person to review.

    python scripts/county_ocr_corrections.py "Budget PDFs - County/County-2024-Budget-Book.pdf"

Every County table row prints four cells: prior-year budget, new-year
budget, VARIANCE (new - prior) and % CHANGE (variance / prior). When OCR
misreads one of the three amounts, the row's variance no longer adds up. The
% CHANGE is printed independently, so it says which amount is wrong:

  - % matches variance / prior        -> prior and variance are right;
                                         new = prior + variance
  - % matches (new - prior) / prior   -> the variance is misread;
                                         variance = new - prior
  - % matches variance / (new - var.) -> the prior year is misread;
                                         prior = new - variance

("matches" = equal to the printed two decimals.) A fix is proposed only when
exactly one of the three holds, and only when the corrected value is a
plausible misreading of the text OCR saw: the digits read are the corrected
value's digits with at most two dropped, added or changed. Each printed cell
is rounded on its own, so of the computed value and the values $1 either
side, the one nearest the OCR'd digits is proposed.

Proposals go to data/processed/county/ocr_proposals_<stem>.csv, in the
columns of data/county/ocr_corrections.csv. Review each against the page
image before copying it into that file; extract_county.py then checks the
fixed lines against the department totals and the by-department and
by-account reports, which this script does not use.
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from county_rows import amount, page_kind  # noqa: E402
from extract_county import CONFIG_DIR, OUT_DIR, Book, row_keys  # noqa: E402


def pct(cell):
    c = cell.replace("%", "")
    try:
        return float(c)
    except ValueError:
        return None


def digits(v):
    return str(abs(int(v)))


def edits(read, value):
    """Edit distance between OCR's digits and `value`'s digits."""
    a, b = "".join(ch for ch in read if ch.isdigit()), digits(value)
    if not a:
        return 0 if b == "0" else len(b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def fmt(v):
    return f"({abs(v):,})" if v < 0 else f"{v:,}"


def propose(cells, years):
    """Return (column, ocr_text, corrected_value, evidence) or None."""
    prior, new, var = (amount(c) for c in cells[:3])
    p = pct(cells[3])
    if var is None or p is None:
        return None
    prior, new = prior or 0, new or 0
    if abs(new - prior - var) <= 5:
        return None

    def same(a, b):
        return b != 0 and round(a / b * 100, 2) == round(p, 2)

    options = []
    if same(var, prior):
        options.append((1, prior + var, f"{years[1]} = {years[0]} {fmt(prior)} + variance {fmt(var)}; "
                                        f"% change {p:.2f}% = {fmt(var)} / {fmt(prior)}"))
    if same(new - prior, prior):
        options.append((2, new - prior, f"variance = {years[1]} {fmt(new)} - {years[0]} {fmt(prior)}; "
                                        f"% change {p:.2f}% = {fmt(new - prior)} / {fmt(prior)}"))
    if new - var != prior and same(var, new - var):
        options.append((0, new - var, f"{years[0]} = {years[1]} {fmt(new)} - variance {fmt(var)}; "
                                      f"% change {p:.2f}% = {fmt(var)} / {fmt(new - var)}"))
    if len(options) != 1:
        return None
    j, value, why = options[0]
    # each printed cell is rounded on its own, so the printed figure can be
    # $1 off the arithmetic: take whichever of value-1, value, value+1 is
    # closest to what OCR read
    best = min((edits(cells[j], v), abs(v - value), v) for v in (value - 1, value, value + 1))
    if best[0] > 2:
        return None
    if best[2] != value:
        why += f" (printed {fmt(best[2])}: the cells are rounded separately)"
        value = best[2]
    column = ["budget_%d" % years[0], "budget_%d" % years[1], "variance"][j]
    return column, cells[j], fmt(value), f"Variance and % change agree: {why}."


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    args = ap.parse_args()
    cfg = json.loads((CONFIG_DIR / f"{args.pdf.stem}.json").read_text())
    book = Book(args.pdf, cfg)
    out, unresolved = [], 0
    for page_no, text, reader in book.pages():
        kind, _, _ = page_kind(text)
        if kind not in ("detail", "bydept", "byaccount"):
            continue
        b, rows = reader(None)
        if not b:
            continue
        rows = book.corrections.apply(page_no, rows, b["years"])
        for r, key in zip(rows, row_keys(rows)):
            try:
                prior, new, var = (amount(c) for c in r["cells"][:3])
            except ValueError:
                unresolved += 1
                continue
            if var is None or abs((new or 0) - (prior or 0) - var) <= 5:
                continue
            fix = propose(r["cells"], b["years"])
            if fix is None:
                unresolved += 1
                continue
            column, read, value, why = fix
            out.append(dict(source_doc=book.doc, source_page=page_no, row_label=key,
                            column=column, ocr_text=read, corrected_value=value, evidence=why))
    path = OUT_DIR / f"ocr_proposals_{args.pdf.stem}.csv"
    pd.DataFrame(out, columns=["source_doc", "source_page", "row_label", "column", "ocr_text",
                               "corrected_value", "evidence"]).to_csv(path, index=False)
    print(f"{len(out)} proposals in {path.relative_to(OUT_DIR.parent.parent.parent)}; "
          f"{unresolved} rows still off that % change cannot settle")


if __name__ == "__main__":
    sys.exit(main())
