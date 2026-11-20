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
6. "What changed" (web/data/changes.json, scripts/changes.py): for every comparison, scope (all funds and
   each fund) and spending/income, the from and to totals equal the sums of the shown series; every
   category, department, bureau and revenue-group figure equals the series sum for that group, and the
   groups add up to the total; every changed line equals its series line (value and page), and the
   changed lines add up to the change in the total; the reserve draw equals the draw lines. Shifts between
   funds are listed with their evidence (the city's notes) and their sums are re-added from the series;
   position counts equal the staffing CSVs, and the adjusted counts differ from the raw ones only by the
   listed artifacts (moves between funds net to zero across funds).
Exits 1 on any failure of checks 1, 2, 4, 6 and the CSV part of 5. Standard library only.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
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


def check_changes(budget: dict) -> int:
    path = ROOT / "web" / "data" / "changes.json"
    print("\nWhat changed (changes.json):")
    if not path.exists():
        print("FAIL web/data/changes.json is missing")
        return 1
    ch = json.loads(path.read_text())
    acc, cats, funds = budget["accounts"], budget["categories"], budget["funds"]
    codes, units = budget["org"]["codes"], budget["org"]["units"]
    bad = 0

    def entries(key):
        s = budget["series"][key]
        docs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * len(s["a"])
        out = []
        for a, v, p, d in zip(s["a"], s["v"], s["p"], docs):
            code = acc[a][0]
            u = codes[code.split("-")[0]]
            out.append({"a": a, "v": v, "p": p, "d": d, "fund": acc[a][2], "cat": acc[a][5], "bureau": acc[a][4],
                        "unit": u, "dept": units[u]["dept"], "rev": cats[acc[a][5]] == "Revenue",
                        "draw": code.endswith("-499000") and acc[a][1].lower().startswith("fund balance reserve")})
        return out

    val = lambda x: (x or {}).get("v", 0) if isinstance(x, dict) or x is None else x
    for cid, c in ch["comparisons"].items():
        E = {"f": entries(c["from"]), "t": entries(c["to"])}
        n_checked = 0
        for scope, kinds in c["scopes"].items():
            fi = None if scope == "all" else funds.index(scope)
            for kind, b in kinds.items():
                sel = {side: [e for e in E[side] if (fi is None or e["fund"] == fi) and e["rev"] == (kind == "revenue")] for side in "ft"}
                for side in "ft":
                    want = sum(e["v"] for e in sel[side])
                    got = val(b["total"][side])
                    if abs(want - got) >= 0.5:
                        bad += 1
                        print(f"FAIL {cid} {scope} {kind} total[{side}] {got:,} vs series {want:,}")
                    n_checked += 1
                    for gname, keyf in (("by_cat", "cat"), ("by_dept", "dept"), ("by_unit", "unit"), ("by_group", "bureau")):
                        if gname not in b:
                            continue
                        gsum = defaultdict(float)
                        for e in sel[side]:
                            gsum[e[keyf]] += e["v"]
                        shown = {r[0]: val(r[1 if side == "f" else 2]) for r in b[gname]}
                        for g in set(gsum) | set(shown):
                            n_checked += 1
                            if abs(gsum[g] - shown.get(g, 0)) >= 0.5:
                                bad += 1
                                print(f"FAIL {cid} {scope} {kind} {gname}[{g}][{side}] {shown.get(g, 0):,} vs series {gsum[g]:,}")
                        if abs(sum(shown.values()) - got) >= 0.5:
                            bad += 1
                            print(f"FAIL {cid} {scope} {kind} {gname}[{side}] groups add to {sum(shown.values()):,}, total {got:,}")
                    if "draw" in b:
                        want = sum(e["v"] for e in sel[side] if e["draw"])
                        if abs(val(b["draw"][side]) - want) >= 0.5:
                            bad += 1
                            print(f"FAIL {cid} {scope} draw[{side}] {val(b['draw'][side]):,} vs series {want:,}")
                # changed lines add up to the change in the total
                idx = set(b["up"]) | set(b["down"]) | set(b["new"]["i"]) | set(b["removed"]["i"])
                in_scope = [ln for ln in c["lines"] if (fi is None or acc[ln[0]][2] == fi) and (cats[acc[ln[0]][5]] == "Revenue") == (kind == "revenue")]
                diff = sum((ln[4] or 0) - (ln[1] or 0) for ln in in_scope)
                if abs(diff - (val(b["total"]["t"]) - val(b["total"]["f"]))) >= 0.5:
                    bad += 1
                    print(f"FAIL {cid} {scope} {kind} changed lines add to {diff:+,}, totals change {val(b['total']['t']) - val(b['total']['f']):+,}")
                if not idx <= set(range(len(c["lines"]))):
                    bad += 1
                    print(f"FAIL {cid} {scope} {kind} line index out of range")
        # every changed line equals a series line (account, value, doc, page)
        pool = {side: Counter((e["a"], e["v"], e["d"], e["p"]) for e in E[side]) for side in "ft"}
        for ln in c["lines"]:
            for side, off in (("f", 1), ("t", 4)):
                if ln[off] is None:
                    continue
                k = (ln[0], ln[off], ln[off + 1], ln[off + 2])
                hit = [x for x in pool[side] if x[1:] == k[1:] and acc[x[0]][0] == acc[k[0]][0]]
                if not hit:
                    bad += 1
                    print(f"FAIL {cid} line {acc[ln[0]][0]} [{side}] {ln[off]:,} p{ln[off + 2]} not in series")
        g = c["scopes"].get("General Fund", {}).get("expense")
        gl = f"; General Fund spending {val(g['total']['f']):,} -> {val(g['total']['t']):,} ({val(g['total']['t']) - val(g['total']['f']):+,})" if g else ""
        print(f"ok   {cid:30s} {len(c['lines'])} changed lines, {n_checked} totals tied to the series{gl}")

    # Shifts between funds
    print("\nShifts between funds (from the city's line notes):")
    keys = {k for c in ch["comparisons"].values() for k in (c["from"], c["to"])}
    E = {k: entries(k) for k in keys}
    for s in ch["shifts"]:
        fr, to = s["from"], s.get("to")
        print(f"     {fr['label']}: {s['from_fund']} (org {', '.join(fr['orgs'])}) -> {s['to_fund']}"
              + (f" ({units[to['unit']]['name']}{', org ' + ', '.join(to['orgs']) if to['orgs'] else ''})" if to else " (destination not found)"))
        for k, v in sorted(fr["values"].items()):
            org_total = sum(e["v"] for e in E[k] if acc[e["a"]][0].split("-")[0] in fr["orgs"])
            ok = v["v"] <= org_total + 0.5
            bad += not ok
            line = f"{'ok  ' if ok else 'FAIL'}   from {k:16s} {v['v']:>12,} (org total {org_total:,.0f})"
            if to and to.get("values"):
                tv = to["values"][k]["v"]
                tt = sum(e["v"] for e in E[k] if acc[e["a"]][0].split("-")[0] in to["orgs"])
                ok2 = tv <= tt + 0.5 and (not to["how"].startswith("new org") or abs(tv - tt) < 0.5)
                bad += not ok2
                line += f"   to {tv:>12,} (org total {tt:,.0f})" + ("" if ok2 else "  FAIL")
            if s.get("billed"):
                line += f"   billed back {s['billed']['values'][k]['v']:,}" + (f", income line {s['billed']['reimb']['code']} {s['billed']['reimb']['values'][k]['v']:,}" if s["billed"].get("reimb") else "")
            print(line)
        for e in s["evidence"]:
            print(f"       note p.{e['p']} x{e['n']}: {e['t'][:110]}")
        if s.get("note_org_mismatch"):
            print(f"NOTE   the note names org {', '.join(s['note_orgs'])}, but the matching new lines are in org {', '.join(to['orgs'])}")
        for cid, pos in s.get("positions", {}).items():
            print(f"       positions moved ({cid}): {pos}")

    # Positions
    print("\nPositions (staffing schedules, per org-chart bureau):")
    staffing_sum = {}
    for p in sorted((ROOT / "data" / "processed").glob("staffing_*.csv")):
        with p.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        for col in (rows[0].keys() if rows else []):
            if col.startswith("count_"):
                staffing_sum[(p.name, col[6:])] = sum(float(r[col]) for r in rows if r[col].strip())
    for cid, c in ch["comparisons"].items():
        P = c.get("positions")
        if not P:
            continue
        T = P["totals"]["all"]
        raw_f = sum(T[x]["f"] for x in P["classes"])
        raw_t = sum(T[x]["t"] for x in P["classes"])
        adj_f = sum(T[x]["af"] for x in P["classes"])
        adj_t = sum(T[x]["at"] for x in P["classes"])
        # raw counts equal the staffing CSVs
        for side, n in (("from", raw_f), ("to", raw_t)):
            doc = budget["docs"][P[side + "_doc"]]
            label = P[side + "_label"]
            col = re.search(r"(\d{4}) (Revised|Proposed)", label)
            yr = col.group(1) if col else re.search(r"(\d{4})", label).group(1)
            colname = f"{yr}_proposed_revised" if col and col.group(2) == "Revised" else f"{yr}_proposed"
            want = [v for (fn, cn), v in staffing_sum.items() if cn == colname and fn and budget_stem(doc) in fn]
            ok = len(want) == 1 and abs(want[0] - n) < 0.01
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {cid:30s} {side:4s} positions {n:,.2f} = staffing CSV count_{colname} {want}")
        missing = {side: sum(a["n_other"] for a in P["artifacts"] if a["kind"] == "missing_schedule" and a["side"] != side) for side in ("from", "to")}
        ok = abs(adj_f - (raw_f - missing["from"])) < 0.01 and abs(adj_t - (raw_t - missing["to"])) < 0.01
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {cid:30s} adjusted = raw - missing schedules (moves between funds net to zero): "
              f"{adj_f:,.2f} -> {adj_t:,.2f}")
        for fk, tt in sorted(P["totals"].items(), key=lambda kv: kv[0]):
            name = "All funds" if fk == "all" else funds[int(fk)]
            parts = [f"{x}: {tt[x]['f']:g} -> {tt[x]['t']:g} (raw {tt[x]['t'] - tt[x]['f']:+.2f}; adjusted {tt[x]['af']:g} -> {tt[x]['at']:g}, {tt[x]['at'] - tt[x]['af']:+.2f})" for x in P["classes"]]
            print(f"       {name:30s} " + "  ".join(parts))
        if cid == ch["default"]:
            for a in P["artifacts"]:
                if a["kind"] != "titles":
                    print(f"       artifact [{a['kind']}] {a['text']}")
            print(f"       + {sum(1 for a in P['artifacts'] if a['kind'] == 'titles')} bureaus with renamed titles (compared per bureau)")

    print("\nTax-policy notes (data/policy_notes.csv):")
    for n in ch["policy"]:
        print(f"     {n['year']} {n['figure']:8s} {n['item']:18s} {n['text']}  [{n['source']}]")
    return bad


def budget_stem(doc: str) -> str:
    return doc[:-4] if doc.lower().endswith(".pdf") else doc


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
    failures += check_changes(budget)

    print(f"\n{failures} series mismatches")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
