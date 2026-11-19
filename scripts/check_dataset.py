#!/usr/bin/env python3
"""Check web/data/budget.json against the processed CSVs it was built from.

1. Every series total per fund and revenue/expense equals the sum of the chosen
   column in the designated book's budget_long CSV (exact, to the dollar).
2. Proposed-type measures ("proposed", "revised") exist only for the newest
   year, and both exist when the newest book has both columns.
3. Every fund roll-up the book prints is within $5 of the shown line-item sum
   (known source-PDF issues are reported, not failed).
Exits 1 on any failure of checks 1-2. Standard library only.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOLERANCE = 5


def main() -> int:
    budget = json.loads((ROOT / "web" / "data" / "budget.json").read_text())
    acc = budget["accounts"]
    shown = defaultdict(float)
    for key, s in budget["series"].items():
        docs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * len(s["a"])
        cols = s["column"] if isinstance(s["column"], list) else [s["column"]] * len(s["a"])
        for a, v, d, c in zip(s["a"], s["v"], docs, cols):
            fund = budget["funds"][acc[a][2]]
            kind = "revenue" if budget["categories"][acc[a][5]] == "Revenue" else "expense"
            shown[(key, fund, kind, budget["docs"][d], c)] += v

    raw = defaultdict(float)
    for path in sorted((ROOT / "data" / "processed").glob("budget_long_*.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["amount"].strip():
                    kind = "revenue" if r["category"] == "Revenue" else "expense"
                    raw[(r["fiscal_year"], r["doc_type"], r["fund"], kind, r["source_doc"])] += float(r["amount"])

    failures = 0
    for (key, fund, kind, doc, col), total in sorted(shown.items()):
        fy = key.split("|")[0]
        expected = raw[(fy, col, fund, kind, doc)]
        ok = abs(expected - total) < 0.5
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {key:16s} {fund:30s} {kind:8s} shown {total:>14,.0f}  csv[{col}] {expected:>14,.0f}")

    newest = budget["newest_year"]
    proposed_keys = {k for k, s in budget["series"].items() if s["measure"] in ("proposed", "revised")}
    stray = sorted(k for k in proposed_keys if budget["series"][k]["year"] != newest)
    newest_cols = {c for (fy, c, *_rest) in raw if fy == str(newest)}
    expected = {f"{newest}|proposed"} if "proposed" in newest_cols else set()
    if "proposed_revised" in newest_cols:
        expected.add(f"{newest}|revised")
    missing = sorted(expected - proposed_keys)
    for k in stray:
        print(f"FAIL proposed-type series for a non-newest year: {k}")
    for k in missing:
        print(f"FAIL newest book has the column but series is missing: {k}")
    if not stray and not missing:
        print(f"ok   proposed-type series: {', '.join(sorted(proposed_keys))} (newest year {newest} only)")
    failures += len(stray) + len(missing)

    print("\nPrinted fund roll-ups vs shown sums:")
    for p in budget["printed"]:
        if "fund" not in p:
            continue
        for key, printed in p["values"].items():
            totals = [v for (k, f, kd, _, _), v in shown.items() if k == key and f == p["fund"] and kd == p["kind"]]
            if not totals:
                continue
            diff = sum(totals) - printed
            flag = "ok  " if abs(diff) <= TOLERANCE else "DIFF"
            print(f"{flag} {key:16s} {p['label']:42s} p.{p['page']:<4d} printed {printed:>14,.0f}  shown {sum(totals):>14,.0f}  diff {diff:+,.0f}")

    print(f"\n{failures} series mismatches")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
