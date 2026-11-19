"""Draft data/known_issues.csv rows for a book's unreviewed failed checks.

Usage:
    python scripts/review_failures.py <doc stem>            # print drafts
    python scripts/review_failures.py <doc stem> --append   # after reading them

Run it after extract_layout.py. For every failed check that is not yet in
known_issues.csv it writes the arithmetic a reviewer needs:

  * section totals: per-column gap, and whether the gap is exactly twice one
    or two of the section's lines (the city prints some negative amounts
    without a sign; the printed total treats them as negative);
  * staffing subtotals: the gap vs. the bound from rounding each printed
    salary to the dollar (n positions x $0.50);
  * everything else: the printed vs. parsed figures.

Run scripts/sign_corrections.py first: gaps it can prove are unsigned
negatives get flipped (and logged) there, not acknowledged here.

The drafts never change data and never make a check pass by themselves:
a person reads them (and the page) and only then appends. A failure the
draft cannot explain is labelled UNEXPLAINED so it is not waved through.
"""

import argparse
import ast
import csv
import itertools
import json
import sys
from pathlib import Path

import pandas as pd

from budget_common import KNOWN_ISSUES_FILE, OUT_DIR, ROOT, ROUNDING_TOLERANCE


def money(x):
    return f"{x:,.0f}"


def sign_explanation(members, key, gap):
    """Smallest set of positive lines whose doubled sum equals the gap."""
    vals = [(r.account_code, r.account_name, r[key]) for _, r in members.iterrows()
            if pd.notna(r[key]) and r[key] > 0]
    for n in (1, 2):
        hits = [c for c in itertools.combinations(vals, n)
                if abs(2 * sum(v for *_, v in c) - gap) <= ROUNDING_TOLERANCE]
        if hits:
            return hits
    return []


def draft(doc):
    cfg = json.loads((ROOT / "config" / f"{doc}.json").read_text())
    v = pd.read_csv(OUT_DIR / f"validation_{doc}.csv")
    li = pd.read_csv(OUT_DIR / f"line_items_{doc}.csv")
    v = v[~v.passed & v.acknowledged.isna()]
    keys = [c[len("diff_"):] for c in v.columns if c.startswith("diff_")]
    rows = []
    for _, r in v.iterrows():
        note, explained = "", True
        if r.level == "section":
            members = li[(li.bureau == r.label)]
            parts = []
            for k in keys:
                gap = r.get(f"diff_{k}")
                if pd.isna(gap) or abs(gap) <= ROUNDING_TOLERANCE:
                    continue
                hits = sign_explanation(members, k, gap) if gap > 0 else []
                if hits and len(hits) == 1 or (hits and len(hits[0]) == 1
                                               and sum(len(h) == 1 for h in hits) == 1):
                    best = hits[0]
                    lines = " and ".join(f"{a} {b} ({money(x)})" for a, b, x in best)
                    parts.append(f"{k}: lines sum {money(gap)} above the printed total, "
                                 f"exactly twice {lines}; the total treats "
                                 f"{'it' if len(best) == 1 else 'them'} as negative "
                                 f"but no sign is printed")
                else:
                    explained = False
                    parts.append(f"{k}: printed lines sum {money(gap)} "
                                 f"{'above' if gap > 0 else 'below'} the printed total "
                                 f"{money(r[f'printed_{k}'])}")
            note = "; ".join(parts) + "."
        elif r.level.startswith("staffing") and isinstance(r.printed_counts_salaries, str):
            printed = ast.literal_eval(r.printed_counts_salaries)
            parsed = ast.literal_eval(r.parsed_counts_salaries)
            gap = parsed[-1] - printed[-1]
            n = int(r.members)
            if printed[0] == parsed[0] and abs(gap) <= 0.5 * n:
                note = (f"Salaries of the {n} positions sum to {money(parsed[-1])} vs "
                        f"printed {money(printed[-1])} ({gap:+,.0f}); counts agree. Within "
                        f"the ${0.5 * n:,.1f} bound from rounding each printed salary to the "
                        f"dollar, so the total was computed from unrounded salaries.")
            else:
                explained = False
                note = (f"Printed count/salary {printed}, position lines add to "
                        f"{[round(x, 2) for x in parsed]}.")
        else:
            explained = False
            gaps = {k: r.get(f"diff_{k}") for k in keys
                    if pd.notna(r.get(f"diff_{k}")) and abs(r.get(f"diff_{k}")) > ROUNDING_TOLERANCE}
            note = "Gaps: " + ", ".join(f"{k} {money(g)}" for k, g in gaps.items()) if gaps \
                else f"{r.level} check failed."
        rows.append({"source_doc": cfg["source_doc"], "source_page": int(r.source_page),
                     "label": r.label,
                     "note": ("" if explained else "UNEXPLAINED: ") + note})
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("doc")
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args()
    rows = draft(args.doc)
    for r in rows:
        print(f"p{r['source_page']} | {r['label']} | {r['note']}")
    if args.append:
        bad = [r for r in rows if r["note"].startswith("UNEXPLAINED")]
        if bad:
            sys.exit(f"{len(bad)} drafts are UNEXPLAINED; replace their notes by hand first.")
        with open(KNOWN_ISSUES_FILE, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["source_doc", "source_page", "label", "note"])
            w.writerows(rows)
        print(f"Appended {len(rows)} rows to {KNOWN_ISSUES_FILE}")


if __name__ == "__main__":
    main()
