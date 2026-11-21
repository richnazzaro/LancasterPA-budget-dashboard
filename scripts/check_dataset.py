#!/usr/bin/env python3
"""Check web/data/budget.json against the processed CSVs it was built from.

1. Every series total per fund and revenue/expense equals the sum of the chosen
   column in the designated book's budget_long CSV (exact, to the dollar).
2. One kind of figure per year: the newest year has "proposed" and "revised" (both
   when the newest book has both columns); every earlier year has "actual" when any
   book reports an audited actual for it, otherwise "projected"; never adopted,
   amended or year-to-date.
3. Printed totals: every section, department and fund total the books print equals the validation CSV, its
   line sum and rounding flag re-add from budget_long ($5 for a section, $0.50 per line for a roll-up), and the
   totals the site can display are matched to them; every flag that shows is listed (failures: value, sum, flag).
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
Exits 1 on any failure of checks 1, 2, 3, 4, 6 and the CSV part of 5. Standard library only.
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


ROUNDING_PER_CELL, ROUNDING_PER_LINE = 5, 0.5


def check_printed(budget: dict) -> int:
    """Printed totals (budget.json `printed`): the site shows each as printed and flags only real gaps.

    For every printed total: the value equals the validation CSV's printed cell (same book, label and page, the
    column the selection rule uses); our sum of the lines it covers, re-added from budget_long (not from
    budget.json's series), equals `sum` and `n`; `flag` is set exactly when the gap is more than rounding ($5 for a
    section, $0.50 per line for a roll-up). Then every total the site can display (all funds, each fund, department,
    bureau and What changed income source, by year, figure and income/spending) is matched to the printed total that covers
    exactly its lines, the way app.js does; those are listed, with every flag that shows."""
    print("\nPrinted totals (shown as printed; flagged only beyond rounding):")
    processed = ROOT / "data" / "processed"
    docs, funds, bureaus = budget["docs"], budget["funds"], budget["bureaus"]
    stem_of = {b["doc"]: b["csv"][len("budget_long_"):-len(".csv")] for b in budget["books"]}
    year_of = {b["doc"]: b["year"] for b in budget["books"]}
    val, csv_rows = {}, {}
    for doc, stem in stem_of.items():
        vp = processed / f"validation_{stem}.csv"
        if vp.exists():
            with vp.open(newline="", encoding="utf-8") as f:
                val[doc] = list(csv.DictReader(f))
        with (processed / f"budget_long_{stem}.csv").open(newline="", encoding="utf-8") as f:
            csv_rows[doc] = [r for r in csv.DictReader(f) if r["source_doc"] == doc]
    bad = 0
    for p in budget["printed"]:
        doc = docs[p["doc"]]
        row = next((r for r in val.get(doc, []) if r["level"] == p["level"] and r["label"] == p["label"] and int(r["source_page"]) == p["page"]), None)
        if row is None:
            print(f"FAIL {doc} p{p['page']} {p['label']!r}: not in the validation CSV")
            bad += 1
            continue
        for key, printed in p["values"].items():
            fy, measure = key.split("|")
            rule = budget["rule"][measure]
            want = next((float(row[c]) for c in (f"printed_{col}_{fy}" for col in rule["columns"]) if (row.get(c) or "").strip()), None)
            if year_of[doc] - int(fy) != rule["book_offset"] or want is None or abs(want - printed) > 0.001:
                print(f"FAIL {doc} p{p['page']} {p['label']!r} {key}: shown {printed} but the CSV prints {want}")
                bad += 1
            col = budget["series"][key]["column"]
            total, n = 0.0, 0
            for r in csv_rows[doc]:
                if r["fiscal_year"] != fy or (r["doc_type"] != col if isinstance(col, str) else r["doc_type"] not in col):
                    continue
                if (r["category"] == "Revenue") != (p["kind"] == "revenue") or not r["amount"].strip() or float(r["amount"]) == 0:
                    continue
                pg = int(r["source_page"])
                if any(r["fund"] == funds[f] and (b == -1 or r["bureau"] == bureaus[b]) and lo <= pg <= hi for f, b, lo, hi in p["m"]):
                    total += float(r["amount"])
                    n += 1
            if abs(total - p["sum"][key]) > 0.001 or n != p["n"][key]:
                print(f"FAIL {doc} p{p['page']} {p['label']!r} {key}: line sum {p['sum'][key]} ({p['n'][key]} lines) but the CSV gives {total} ({n})")
                bad += 1
            tol = ROUNDING_PER_CELL if p["level"] == "section" else max(ROUNDING_PER_CELL, ROUNDING_PER_LINE * n)
            if (abs(total - printed) > tol) != (key in p["flag"]):
                print(f"FAIL {doc} p{p['page']} {p['label']!r} {key}: gap {total - printed:+,.0f} vs rounding {tol:g}, flag {'set' if key in p['flag'] else 'not set'}")
                bad += 1
    n_vals = sum(len(p["values"]) for p in budget["printed"])
    print(f"{'ok  ' if not bad else 'FAIL'} {len(budget['printed'])} printed totals, {n_vals} figures: values match the validation CSVs, line sums and flags re-derived from budget_long")

    # Which displayed totals are printed, and which flags show (app.js totalOf / printedFor).
    acc, org = budget["accounts"], budget["org"]
    rev = budget["categories"].index("Revenue")
    ch_path = ROOT / "web" / "data" / "changes.json"
    wc_keys = {k for c in json.loads(ch_path.read_text())["comparisons"].values() for k in (c["from"], c["to"])} if ch_path.exists() else set()
    shown, flags, calc_scopes = 0, [], Counter()
    for key, s in budget["series"].items():
        sdocs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * len(s["a"])
        R = []
        for i, (a, v, pg, d) in enumerate(zip(s["a"], s["v"], s["p"], sdocs)):
            u = org["codes"][acc[a][0].split("-")[0]]
            R.append({"i": i, "fund": acc[a][2], "bureau": acc[a][4], "rev": acc[a][5] == rev, "p": pg, "d": d,
                      "unit": u, "dept": org["units"][u]["dept"]})
        members = {}
        for j, p in enumerate(budget["printed"]):
            if key in p["values"]:
                members[j] = frozenset(r["i"] for r in R if r["d"] == p["doc"] and r["rev"] == (p["kind"] == "revenue")
                                       and any(r["fund"] == f and (b == -1 or r["bureau"] == b) and lo <= r["p"] <= hi for f, b, lo, hi in p["m"]))
        scopes = defaultdict(list)
        for kind in (True, False):
            K = [r for r in R if r["rev"] == kind]
            def add(name, l):
                if l:
                    scopes[frozenset(r["i"] for r in l)].append(name)
            add("all funds", K)
            for f in {r["fund"] for r in K}:
                add(funds[f], [r for r in K if r["fund"] == f])
                for d in {r["dept"] for r in K}:
                    add(f"{org['departments'][d]['name']} ({funds[f]})", [r for r in K if r["fund"] == f and r["dept"] == d])
                for u in {r["unit"] for r in K}:
                    add(f"{org['units'][u]['name']} ({funds[f]})", [r for r in K if r["fund"] == f and r["unit"] == u])
                if kind and key in wc_keys:  # income sources on What changed (printed revenue groups)
                    for b in {r["bureau"] for r in K if r["fund"] == f}:
                        add(f"income source {bureaus[b]} ({funds[f]})", [r for r in K if r["fund"] == f and r["bureau"] == b])
            for d in {r["dept"] for r in K}:
                add(org["departments"][d]["name"], [r for r in K if r["dept"] == d])
            for u in {r["unit"] for r in K}:
                add(org["units"][u]["name"], [r for r in K if r["unit"] == u])
        for sc, names in scopes.items():
            hits = [j for j, m in members.items() if m == sc]
            if not hits:
                calc_scopes[key] += 1
                continue
            j = min(hits, key=lambda j: (2 if key in budget["printed"][j]["flag"] else 0) + (0 if budget["printed"][j].get("fund") else 1))
            shown += 1
            p = budget["printed"][j]
            if key in p["flag"]:
                flags.append((key, p, names))
    print(f"ok   {shown} displayable totals are printed (shown as printed); {sum(calc_scopes.values())} have no printed total (shown as calculated)")
    seen = set()
    for key, p, names in sorted(flags, key=lambda x: (x[0], x[1]["page"])):
        if (key, id(p)) in seen:
            continue
        seen.add((key, id(p)))
        gap = p["sum"][key] - p["values"][key]
        has = "issue" in p
        print(f"FLAG {key:14s} {docs[p['doc']][:34]:34s} p{p['page']:<4d} {p['label'][:30]:30s} printed {p['values'][key]:>13,.0f} lines {p['sum'][key]:>13,.0f} gap {gap:+,.0f}"
              f"  [{'; '.join(sorted(names))[:80]}]{'' if has else '  -> NOT in known_issues.csv'}")
    print(f"{len(seen)} flags show on the site; {sum('issue' not in p for _, p, _ in flags)} without a reviewed note")
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

    failures += check_printed(budget)

    failures += check_reserve(budget)
    failures += check_org(budget)
    failures += check_reserve_draw(budget)
    failures += check_changes(budget)

    print(f"\n{failures} series mismatches")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
