"""Compare the same figure across two budget books, account by account.

Usage:
    python scripts/crosscheck.py \\
        data/processed/line_items_2026-Adopted-Budget-2026.csv proposed_2026 \\
        data/processed/line_items_2027-RevisedProposedBudget-Compressed.csv adopted_2026

A later book reprints an earlier year's figures (the 2027 book's "2026
ORIGINAL BUDGET" is the adopted 2026 budget), so this is an independent check
on OCR'd digits. Every account is classified:

    match                both books print the same amount
    budget_change        amounts differ, but the first book's section total
                         re-adds correctly, so the OCR'd digits are confirmed:
                         the figure changed between the two documents
                         (e.g. proposed -> adopted)
    possible_ocr_error   amounts differ and the first book's section total does
                         not re-add: needs a look at the page image
    renamed              same account code, amounts agree, name differs
    moved_or_recoded     only in one book, but an account with the same amount
                         and object code (or same org and name) is in the other
    only_in_a / only_in_b

Writes data/processed/crosscheck_<a column>_<a doc>_vs_<b column>_<b doc>.csv.
"""

import argparse
import re
from pathlib import Path

import pandas as pd

from budget_common import OUT_DIR, ROUNDING_TOLERANCE


def doc_name(path):
    return re.sub(r"^line_items_", "", Path(path).stem)


def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def load(path, column):
    df = pd.read_csv(path, dtype={"org_code": str, "object_code": str})
    df = df[["account_code", "org_code", "object_code", "account_name",
             "bureau", "source_page", column]].rename(columns={column: "amount"})
    dupes = df[df.account_code.duplicated(keep=False)]
    if len(dupes):
        print(f"note: {doc_name(path)} lists {dupes.account_code.nunique()} account "
              f"codes more than once; amounts are summed per code")
    agg = df.groupby("account_code", as_index=False).agg(
        org_code=("org_code", "first"), object_code=("object_code", "first"),
        account_name=("account_name", "first"), bureau=("bureau", "first"),
        source_page=("source_page", "first"), amount=("amount", "sum"))
    return agg


def crosscheck(a_path, a_col, b_path, b_col):
    a, b = load(a_path, a_col), load(b_path, b_col)
    a_checks = pd.read_csv(Path(a_path).parent / f"validation_{doc_name(a_path)}.csv")
    a_checks = a_checks[a_checks.level == "section"]
    sec_diff = {r.label: abs(getattr(r, f"diff_{a_col}")) for r in a_checks.itertuples()}

    m = a.merge(b, on="account_code", how="outer", suffixes=("_a", "_b"), indicator="side")
    rows = []
    for r in m.itertuples():
        rec = {"account_code": r.account_code,
               "account_name_a": r.account_name_a, "account_name_b": r.account_name_b,
               "bureau_a": r.bureau_a, "page_a": r.source_page_a, "page_b": r.source_page_b,
               "amount_a": r.amount_a, "amount_b": r.amount_b}
        if r.side == "both":
            diff = r.amount_a - r.amount_b
            rec["diff"] = diff
            if abs(diff) <= 1:
                same_name = norm_name(r.account_name_a) == norm_name(r.account_name_b)
                rec["status"] = "match" if same_name else "renamed"
            elif sec_diff.get(r.bureau_a, 0) <= ROUNDING_TOLERANCE:
                rec["status"] = "budget_change"
            else:
                rec["status"] = "possible_ocr_error"
        else:
            side, other = ("a", b) if r.side == "left_only" else ("b", a)
            amount = r.amount_a if side == "a" else r.amount_b
            obj = r.object_code_a if side == "a" else r.object_code_b
            org = r.org_code_a if side == "a" else r.org_code_b
            name = r.account_name_a if side == "a" else r.account_name_b
            unmatched = other[~other.account_code.isin(m.loc[m.side == "both", "account_code"])]
            twin = unmatched[((unmatched.object_code == obj) & (unmatched.amount == amount)
                              & (amount != 0))
                             | ((unmatched.org_code == org)
                                & (unmatched.account_name.map(norm_name) == norm_name(name)))]
            if len(twin):
                rec["status"] = "moved_or_recoded"
                rec["counterpart"] = "; ".join(
                    f"{t.account_code} {t.account_name} ({t.amount:,.0f})"
                    for t in twin.itertuples())
            else:
                rec["status"] = f"only_in_{side}"
        rows.append(rec)
    out = pd.DataFrame(rows)
    order = ["possible_ocr_error", "budget_change", "moved_or_recoded", "renamed",
             "only_in_a", "only_in_b", "match"]
    out["_o"] = out.status.map(order.index)
    return out.sort_values(["_o", "account_code"]).drop(columns="_o")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("a_csv")
    ap.add_argument("a_column")
    ap.add_argument("b_csv")
    ap.add_argument("b_column")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()
    out = crosscheck(args.a_csv, args.a_column, args.b_csv, args.b_column)
    name = (f"crosscheck_{args.a_column}_{doc_name(args.a_csv)}"
            f"_vs_{args.b_column}_{doc_name(args.b_csv)}.csv")
    out.to_csv(args.out / name, index=False)

    both = out[out.status.isin(["match", "renamed", "budget_change", "possible_ocr_error"])]
    agree = both.status.isin(["match", "renamed"]).sum()
    print(f"{doc_name(args.a_csv)} {args.a_column}  vs  {doc_name(args.b_csv)} {args.b_column}")
    print(f"Accounts in both: {len(both)}; same amount: {agree} "
          f"({agree / max(len(both), 1):.1%})")
    print(out.status.value_counts().to_string())
    for status in ["possible_ocr_error", "budget_change", "moved_or_recoded", "renamed"]:
        sub = out[out.status == status]
        if len(sub):
            print(f"\n{status} ({len(sub)}):")
            for r in sub.itertuples():
                extra = f" -> {r.counterpart}" if isinstance(getattr(r, "counterpart", None), str) else ""
                print(f"  {r.account_code:<16} {str(r.account_name_a)[:28]:<28} "
                      f"a={r.amount_a!s:>11} b={r.amount_b!s:>11}{extra}")
    print(f"\nWrote {args.out / name}")


if __name__ == "__main__":
    main()
