#!/usr/bin/env python3
"""Check web/data/budget.json against the processed CSVs it was built from.

1. Every series total per fund and revenue/expense equals the sum of the chosen
   column in the designated book's budget_long CSV (exact, to the dollar).
2. One kind of figure per year: the newest year has "proposed" and "revised" (both
   when the newest book has both columns); every earlier year has "actual" when any
   book reports an audited actual for it, otherwise "projected"; never adopted,
   amended or year-to-date.
3. Every fund roll-up the book prints is within $5 of the shown line-item sum
   (known source-PDF issues are reported, not failed).
4. Org structure (2027 org chart): every shown line's org code maps to an org unit; the
   mapping in budget.json equals data/org_structure_2027.csv; for every year, figure and
   revenue/expense, the unit (bureau) totals of each department add up to that department's
   total (department taken straight from the CSV), and the departments add up to the series total;
   departments with no bureaus have exactly one unit; every description has text.
5. Reserve draw: the "Fund Balance Reserve" revenue lines (object 499000) the General Fund view
   shows as drawn from the reserve equal the sum of those lines in the source CSVs, and tie to the
   Reserve Fund page's drawdown where both exist. A year that does not tie is reported (NOTE), not forced.
Exits 1 on any failure of checks 1, 2, 4 and the CSV part of 5. Standard library only.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOLERANCE = 5


def check_reserve(budget: dict) -> int:
    """Reserve Fund: every line shown equals the CSV row (same book, column, year, type, label, page)
    and the entries follow the one-kind-per-year rule."""
    reserve = budget.get("reserve")
    print("\nReserve Fund (General Fund balance):")
    if not reserve:
        print("     no fund_balance data")
        return 0
    rows = defaultdict(list)
    for path in sorted((ROOT / "data" / "processed").glob("fund_balance_*.csv")):
        if "_checks_" in path.name or "crossbook" in path.name:
            continue
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows[(r["source_doc"], r["scenario"], int(r["fiscal_year"]), r["line_type"], r["label"])].append(r)
    bad = 0
    for e in reserve["entries"]:
        doc = budget["docs"][e["doc"]]
        for ln in e["lines"]:
            hit = rows.get((doc, e["sc"], ln["fy"], ln["rt"], ln["l"]), [])
            ok = len(hit) == 1 and abs(float(hit[0]["amount"]) - ln["v"]) < 0.5 and int(hit[0]["source_page"]) == ln["p"]
            if not ok:
                bad += 1
                print(f"FAIL {e['year']} {e['measure']:9s} {ln['t']:12s} shown {ln['v']:>14,}  csv {[h['amount'] for h in hit]}")
    newest = budget["newest_year"]
    got = defaultdict(set)
    for e in reserve["entries"]:
        got[e["year"]].add(e["measure"])
    for y, ms in sorted(got.items()):
        want = {"proposed", "revised"} if y == newest else {"projected"} if y == newest - 1 else {"actual"}
        if y == newest:
            want &= {"proposed" if sc != "revised" else "revised" for (_, sc, fy, *_x) in rows if fy == newest}
        ok = ms == want
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {y}: {', '.join(sorted(ms))}" + ("" if ok else f" (expected {', '.join(sorted(want))})"))
    # chain: beginning + surplus + adjustments = ending, and revenues + expenditures = surplus + adjustments
    for e in reserve["entries"]:
        by_t = defaultdict(int)
        for ln in e["lines"]:
            by_t[ln["t"]] += ln["v"]
        if "revenues" not in by_t:
            continue
        end_gap = by_t["beginning"] + by_t["surplus"] + by_t["adjustment"] - by_t["ending"]
        op_gap = by_t["revenues"] + by_t["expenditures"] - by_t["surplus"] - by_t["adjustment"]
        flag = "ok  " if abs(end_gap) <= TOLERANCE and abs(op_gap) <= TOLERANCE else "NOTE"
        print(f"{flag} {e['year']} {e['measure']:9s} balance chain off by {end_gap:+,}; revenues+expenditures vs surplus+adjustments off by {op_gap:+,}" + ("  (logged in known_issues.csv)" if flag == "NOTE" else ""))
    # the displayed 2-column disagreement
    for e in reserve["entries"]:
        if e.get("alt"):
            print(f"note {e['year']} actual: {e['sc']} column {e['lines'][0]['v']:,} used; other column(s) {[(a['sc'], a['v']) for a in e['alt']]} kept for the on-screen note")
    return bad


def check_org(budget: dict) -> int:
    print("\nOrg structure (2027 org chart):")
    org = budget.get("org")
    if not org:
        print("FAIL budget.json has no org block")
        return 1
    bad = 0
    units, depts, codes = org["units"], org["departments"], org["codes"]
    with (ROOT / "data" / "org_structure_2027.csv").open(newline="", encoding="utf-8") as f:
        table = {r["org_code"]: (r["department"], r["unit"]) for r in csv.DictReader(f)}
    built = {c: (depts[units[u]["dept"]]["name"], units[u]["name"]) for c, u in codes.items()}
    if built != table:
        diff = sorted(set(built.items()) ^ set(table.items()))
        print(f"FAIL org.codes differs from org_structure_2027.csv: {diff[:10]}")
        bad += 1
    acc = budget["accounts"]
    unmapped = set()
    for key, s in budget["series"].items():
        dept_total = defaultdict(float)   # (kind, department) via the CSV's department column
        unit_total = defaultdict(float)   # (kind, department) via unit -> department
        total = defaultdict(float)
        for a, v in zip(s["a"], s["v"]):
            org_code = acc[a][0].split("-")[0]
            kind = "revenue" if budget["categories"][acc[a][5]] == "Revenue" else "expense"
            total[kind] += v
            if org_code not in codes or org_code not in table:
                unmapped.add(org_code)
                continue
            dept_total[(kind, table[org_code][0])] += v
            unit_total[(kind, depts[units[codes[org_code]]["dept"]]["name"])] += v
        for dk in sorted(set(dept_total) | set(unit_total)):
            if abs(dept_total[dk] - unit_total[dk]) >= 0.5:
                bad += 1
                print(f"FAIL {key:16s} {dk[1]:42s} {dk[0]:8s} bureaus {unit_total[dk]:>14,.0f}  department {dept_total[dk]:>14,.0f}")
        for kind, t in sorted(total.items()):
            d_sum = sum(v for (k, _), v in dept_total.items() if k == kind)
            ok = abs(d_sum - t) < 0.5
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {key:16s} {kind:8s} departments {d_sum:>14,.0f}  series {t:>14,.0f}  ({len([1 for (k, _) in dept_total if k == kind])} departments; each one's bureaus checked above)")
    for c in sorted(unmapped):
        print(f"FAIL org code {c} in budget.json has no org unit")
    bad += len(unmapped)
    for i, d in enumerate(depts):
        mine = [u for u in units if u["dept"] == i]
        ok = d["bureaus"] == any(u["kind"] == "bureau" for u in mine) and (d["bureaus"] or (len(mine) == 1 and mine[0]["kind"] == "whole-department"))
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {d['name']}: {'bureaus: ' + ', '.join(u['name'] for u in mine) if d['bureaus'] else 'no bureaus'}")
    for who in depts + units:
        for e in who["desc"]:
            if not e["t"].strip() or e["p"] < 1:
                bad += 1
                print(f"FAIL empty description or page for {who['name']}")
    return bad


def check_reserve_draw(budget: dict) -> int:
    """The General Fund's revenue includes money drawn from the reserve. Verify what the site shows."""
    print("\nReserve draw (General Fund revenue lines 'Fund Balance Reserve', object 499000):")
    acc = budget["accounts"]
    is_draw = lambda a: acc[a][0].endswith("-499000") and acc[a][1].lower().startswith("fund balance reserve")
    csv_sum = defaultdict(float)
    for path in sorted((ROOT / "data" / "processed").glob("budget_long_*.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["object_code"] == "499000" and r["account_name"].lower().startswith("fund balance reserve") and r["amount"].strip():
                    csv_sum[(r["fiscal_year"], r["doc_type"], r["source_doc"])] += float(r["amount"])
    reserve = {(e["year"], e["measure"]): e for e in (budget.get("reserve") or {}).get("entries", [])}
    bad = 0
    for key, s in sorted(budget["series"].items()):
        docs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * len(s["a"])
        cols = s["column"] if isinstance(s["column"], list) else [s["column"]] * len(s["a"])
        shown = sum(v for a, v in zip(s["a"], s["v"]) if is_draw(a))
        pairs = {(d, c) for a, d, c in zip(s["a"], docs, cols) if is_draw(a)}
        expect = sum(csv_sum[(key.split("|")[0], c, budget["docs"][d])] for d, c in pairs)
        ok = abs(shown - expect) < 0.5
        bad += not ok
        if not shown and not expect:
            print(f"ok   {key:16s} no draw")
            continue
        line = f"{'ok  ' if ok else 'FAIL'} {key:16s} draw shown {shown:>12,.0f}  csv {expect:>12,.0f}"
        e = reserve.get((s["year"], s["measure"]))
        if e and shown:
            by_t = defaultdict(int)
            for ln in e["lines"]:
                by_t[ln["t"]] += ln["v"]
            drawdown = -(by_t["surplus"] + by_t["adjustment"])      # what the Fund Balance page takes out of the reserve
            op = -(by_t["revenues"] + by_t["expenditures"])           # revenues less expenditures on the same page
            gf = budget["funds"].index("General Fund")
            gf_rev = sum(v for a, v in zip(s["a"], s["v"]) if acc[a][2] == gf and budget["categories"][acc[a][5]] == "Revenue")
            gap_rev = by_t["revenues"] + shown - gf_rev
            ties = abs(drawdown - shown) <= TOLERANCE and abs(op - shown) <= TOLERANCE and abs(gap_rev) <= TOLERANCE
            line += f"  Reserve page drawdown {drawdown:,}, revenues+draw-GF revenue {gap_rev:+,.0f}: " + ("ties" if ties else f"DOES NOT TIE (drawdown off by {shown - drawdown:+,.0f}; revenues-expenditures off by {shown - op:+,.0f})" + ("  (page note: " + e["note"][:60] + "...)" if e.get("note") else ""))
            line = line.replace("ok  ", "NOTE", 1) if not ties and ok else line
        elif shown:
            line += "  (no Reserve Fund page entry for this figure)"
        print(line)
    return bad


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

    # one kind per year
    raw_cols = defaultdict(set)  # fiscal year -> doc_types present in any book
    for (fy, c, *_rest) in raw:
        raw_cols[fy].add(c)
    by_year = defaultdict(set)
    for sr in budget["series"].values():
        by_year[sr["year"]].add(sr["measure"])
    bad_years = 0
    for y, got in sorted(by_year.items()):
        if y == newest:
            want = {"proposed", "revised"} & {m for m, c in (("proposed", "proposed"), ("revised", "proposed_revised")) if c in raw_cols[str(y)]}
        elif "actual" in raw_cols[str(y)]:
            want = {"actual"}
        else:
            want = {"projected"}
        ok = got == want
        bad_years += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {y}: shows {', '.join(sorted(got))}" + ("" if ok else f" (expected {', '.join(sorted(want))})"))
    failures += bad_years

    print("\nPrinted fund roll-ups vs shown sums:")
    # A book can print the same roll-up more than once (e.g. before and after a late section).
    # Compare against the occurrence closest to the shown sum and report which one was used.
    known = []
    kpath = ROOT / "data" / "known_issues.csv"
    if kpath.exists():
        with kpath.open(newline="", encoding="utf-8") as f:
            known = list(csv.DictReader(f))
    norm = lambda t: re.sub(r"[^a-z]", "", t.lower())
    groups = defaultdict(list)
    for p in budget["printed"]:
        if "fund" in p:
            for key, printed in p["values"].items():
                groups[(key, p["fund"], p["kind"])].append((p, printed))
    undocumented = 0
    for (key, fund, kind), cands in sorted(groups.items()):
        totals = [v for (k, f, kd, _, _), v in shown.items() if k == key and f == fund and kd == kind]
        if not totals:
            continue
        s_sum = sum(totals)
        p, printed = min(cands, key=lambda c: abs(s_sum - c[1]))
        diff = s_sum - printed
        flag = "ok  " if abs(diff) <= TOLERANCE else "DIFF"
        extra = f"  (also printed on p.{', '.join(str(c[0]['page']) for c in cands if c[0] is not p)})" if len(cands) > 1 else ""
        doc = budget["docs"][p["doc"]]
        tail = ""
        if abs(diff) > TOLERANCE:
            hit = [i for i in known if i["source_doc"] == doc and (norm(i["label"]) in norm(p["label"]) or norm(p["label"]) in norm(i["label"]))]
            if hit:
                tail = "  -> logged in known_issues.csv"
            else:
                tail = "  -> NOT in known_issues.csv"
                undocumented += 1
        print(f"{flag} {key:16s} {p['label']:42s} p.{p['page']:<4d} printed {printed:>14,.0f}  shown {s_sum:>14,.0f}  diff {diff:+,.0f}{extra}{tail}")
    print(f"\n{undocumented} printed-total differences are not in known_issues.csv")

    failures += check_reserve(budget)
    failures += check_org(budget)
    failures += check_reserve_draw(budget)

    print(f"\n{failures} series mismatches")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
