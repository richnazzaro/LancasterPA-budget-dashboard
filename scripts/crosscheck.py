"""Compare the same figure across two budget books, account by account.

Usage:
    python scripts/crosscheck.py \\
        data/processed/line_items_2026-Adopted-Budget-2026.csv proposed_2026 \\
        data/processed/line_items_2027-Mayors-Revised-Proposed-Budget-Rev-11-19-26.csv adopted_2026

A later book reprints an earlier year's figures (the 2027 book's "2026
ORIGINAL BUDGET" is the adopted 2026 budget), so this is an independent check
on OCR'd digits. Every account is classified:

    match                both books print the same amount
    budget_change        amounts differ, but the first book's section total
                         re-adds correctly, so the OCR'd digits are confirmed:
                         the figure changed between the two documents
                         (e.g. proposed -> adopted)
    possible_ocr_error   amounts differ, the first book was OCR'd, and its
                         section total does not re-add: needs a look at the
                         page image. (A text-layer book cannot have OCR
                         errors, so its differences are always budget_change.)
    renamed              same account code, amounts agree, name differs
    moved_or_recoded     only in one book, but an account with the same amount
                         and object code (or same org and name) is in the other
    only_in_a / only_in_b

Writes data/processed/crosscheck_<a column>_<a doc>_vs_<b column>_<b doc>.csv.
"""

import argparse
import json
import re
from pathlib import Path

import pandas as pd

from budget_common import OUT_DIR, ROOT, ROUNDING_TOLERANCE


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


def digit_pattern(a, b):
    """'1 digit: 7->1' when two amounts differ in one digit (an OCR-style
    misread); 'round' when the change is a multiple of 100 (a typical
    adoption change); '' otherwise."""
    if pd.isna(a) or pd.isna(b):
        return ""
    sa, sb = str(int(abs(a))), str(int(abs(b)))
    if len(sa) == len(sb):
        d = [(x, y) for x, y in zip(sa, sb) if x != y]
        if len(d) == 1:
            return f"1 digit: {d[0][0]}->{d[0][1]}"
    if (a - b) % 100 == 0:
        return "round"
    return ""


def crosscheck(a_path, a_col, b_path, b_col):
    a, b = load(a_path, a_col), load(b_path, b_col)
    a_checks = pd.read_csv(Path(a_path).parent / f"validation_{doc_name(a_path)}.csv")
    a_checks = a_checks[a_checks.level == "section"]
    sec_diff = {r.label: abs(getattr(r, f"diff_{a_col}")) for r in a_checks.itertuples()}
    cfg_path = ROOT / "config" / f"{doc_name(a_path)}.json"
    a_is_ocr = cfg_path.exists() and json.loads(cfg_path.read_text()).get("source", "ocr") == "ocr"

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
            rec["digit_pattern"] = digit_pattern(r.amount_a, r.amount_b)
            if abs(diff) <= 1:
                same_name = norm_name(r.account_name_a) == norm_name(r.account_name_b)
                rec["status"] = "match" if same_name else "renamed"
            elif not a_is_ocr or sec_diff.get(r.bureau_a, 0) <= ROUNDING_TOLERANCE:
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


def run_pair(a_csv, a_col, b_csv, b_col, out_dir=OUT_DIR):
    """Run one comparison, write its CSV, return (table, stats)."""
    out = crosscheck(a_csv, a_col, b_csv, b_col)
    path = Path(out_dir) / (f"crosscheck_{a_col}_{doc_name(a_csv)}"
                            f"_vs_{b_col}_{doc_name(b_csv)}.csv")
    out.to_csv(path, index=False)
    vc = out.status.value_counts()
    in_both = sum(vc.get(s, 0) for s in ("match", "renamed", "budget_change",
                                         "possible_ocr_error"))
    equal = vc.get("match", 0) + vc.get("renamed", 0)
    return out, {"file": path, "in_both": int(in_both), "equal": int(equal),
                 "rate": equal / in_both if in_both else float("nan"),
                 "adoption_changes": int(vc.get("budget_change", 0)),
                 "possible_ocr_errors": int(vc.get("possible_ocr_error", 0))}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("a_csv")
    ap.add_argument("a_column")
    ap.add_argument("b_csv")
    ap.add_argument("b_column")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--loose", action="store_true",
                    help="figures expected to be close but not equal (e.g. projected vs "
                         "actual): report gap sizes only, no classification")
    args = ap.parse_args()
    if args.loose:
        a, b = load(args.a_csv, args.a_column), load(args.b_csv, args.b_column)
        m = a.merge(b, on="account_code", suffixes=("_a", "_b"))
        gap = (m.amount_b - m.amount_a).abs()
        print(f"{doc_name(args.a_csv)} {args.a_column} vs {doc_name(args.b_csv)} "
              f"{args.b_column}: {len(m)} accounts; equal {(gap <= 1).mean():.0%}; "
              f"median gap {gap.median():,.0f}; 90th pct {gap.quantile(.9):,.0f}; "
              f"total |gap| {gap.sum():,.0f} on total {m.amount_a.abs().sum():,.0f} "
              f"({gap.sum() / max(m.amount_a.abs().sum(), 1):.1%})")
        return
    out, stats = run_pair(args.a_csv, args.a_column, args.b_csv, args.b_column, args.out)
    name = stats["file"].name
    both, agree = stats["in_both"], stats["equal"]
    print(f"{doc_name(args.a_csv)} {args.a_column}  vs  {doc_name(args.b_csv)} {args.b_column}")
    print(f"Accounts in both: {both}; same amount: {agree} "
          f"({agree / max(both, 1):.1%})")
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
