#!/usr/bin/env python3
"""Check web/data/budget.json against the processed CSVs it was built from.

1. Every series total per fund and revenue/expense equals the sum of the chosen
   column in the designated book's budget_long CSV (exact, to the dollar).
2. One main kind of figure per year: the newest year has "proposed" and "revised" (both
   when the newest book has both columns); every earlier year has "actual" when any
   book reports an audited actual for it, otherwise "projected"; never year-to-date.
   Plus one budget figure per year (selectable, not charted): "amended" when the next
   book prints an amended column for the year, otherwise "adopted"; never both.
3. Printed totals: every section, department and fund total the books print equals the validation CSV, its
   line sum and rounding flag re-add from budget_long ($5 for a section, $0.50 per line for a roll-up), and the
   totals the site can display are matched to them; every flag that shows is listed (failures: value, sum, flag).
4. Org structure (2027 org chart): every shown line's org code maps to an org unit; the
   mapping in budget.json equals mapping/org_structure.csv; for every year, figure and
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
7. Department and bureau summaries (changes.json `summary`): every number a summary uses is re-derived from
   the series and the staffing CSVs: the net change, the driver lines and categories, position counts and why
   raw and adjusted differ, named titles' counts, and the fund shifts named.
8. Lines far above the years either side of them (the site's "stands out" notes, app.js lineSpikes()): listed with
   the same rule (SPIKE_X, SPIKE_SHARE); every row of notes/line_notes.csv names a line printed in that year and
   figure (FAIL otherwise), and is reported as matching a listed line or not.
9. Projections (budget.json `projection`, the multi-year projections book): never in `series` (so never a
   selectable year) and only for years after the newest year; every projection series total per fund and
   revenue/expense equals its budget_long CSV, line for line in count; every line's org code maps to an org unit;
   every printed section and fund total equals the validation CSV, its line sum and flag re-add from budget_long;
   each fund's printed Surplus/(Deficit) equals the CSV and its printed Total Revenue less Total Expense; the
   assumptions equal the extracted assumptions page.
10. Home Rule 6% tax revenue limit (budget.json `tax_limit`, scripts/tax_limit.py): every budget made under the charter
   is re-tested from the budget_long CSVs (the counted tax lines of content/rules/tax_limit_lines.csv, the same book's
   preceding-year figure) and must match the JSON (amounts, baseline, change, over/within); a General Fund tax revenue
   line the CSV does not list fails.
Exits 1 on any failure of checks 1, 2, 3, 4, 6, 7, 8, 9, 10 and the CSV part of 5. Standard library only.
Usage: python3 scripts/check_dataset.py [--entity city|county]
  --entity county checks web/data/county/ against data/processed/county/ (scripts/check_county.py).
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import income_rules
import tax_limit
import tax_rates
from changes import counts_as_income

ROOT = Path(__file__).resolve().parent.parent
TOLERANCE = 5
GOV = None          # the government being checked (set in main); its files and display rules come from it


def processed() -> Path:
    """The government's generated CSVs."""
    return GOV.processed if GOV is not None else ROOT / "data" / "processed"


def org_codes() -> Path:
    """The government's org code -> unit table."""
    return GOV.path(GOV["org"]["codes"])


def primary_fund() -> str:
    """The fund the site opens on (government.yaml display.primary_fund)."""
    return GOV["display"]["primary_fund"]


def check_reserve(budget: dict) -> int:
    """Reserve Fund: every line shown equals the CSV row (same book, column, year, type, label, page)
    and the entries follow the one-kind-per-year rule."""
    reserve = budget.get("reserve")
    print("\nReserve Fund (General Fund balance):")
    if not reserve:
        print("     no fund_balance data")
        return 0
    rows = defaultdict(list)
    for path in sorted(processed().glob("fund_balance_*.csv")):
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
    with org_codes().open(newline="", encoding="utf-8") as f:
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


def draw_codes() -> set[str]:
    """The object codes reviewed as draws on savings (income_rules.csv class draw)."""
    return {r["code"] for r in income_rules.load(GOV) if r["class"] == "draw"}


def check_reserve_draw(budget: dict) -> int:
    """The tax-funded fund's revenue includes money drawn from savings. Verify what the site shows."""
    draws = draw_codes()
    print(f"\nReserve draw ({primary_fund()} revenue lines class draw: object {', '.join(sorted(draws))}):")
    acc = budget["accounts"]
    is_draw = lambda a: acc[a][0].split("-")[-1] in draws
    csv_sum = defaultdict(float)
    for path in sorted(processed().glob("budget_long_*.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["object_code"] in draws and r["amount"].strip():
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
            gf = budget["funds"].index(primary_fund())
            gf_rev = sum(v for a, v in zip(s["a"], s["v"]) if acc[a][2] == gf and budget["categories"][acc[a][5]] == "Revenue")
            gap_rev = by_t["revenues"] + shown - gf_rev
            ties = abs(drawdown - shown) <= TOLERANCE and abs(op - shown) <= TOLERANCE and abs(gap_rev) <= TOLERANCE
            line += f"  Reserve page drawdown {drawdown:,}, revenues+draw-GF revenue {gap_rev:+,.0f}: " + ("ties" if ties else f"DOES NOT TIE (drawdown off by {shown - drawdown:+,.0f}; revenues-expenditures off by {shown - op:+,.0f})" + ("  (page note: " + e["note"][:60] + "...)" if e.get("note") else ""))
            line = line.replace("ok  ", "NOTE", 1) if not ties and ok else line
        elif shown:
            line += "  (no Reserve Fund page entry for this figure)"
        print(line)
        # The split the site shows (app.js drawParts): where the Fund Balance Projection prints a committed data center
        # revenue adjustment and it plus the operating deficit equals the draw, the draw is shown as those two parts.
        if e and shown:
            sur = next((ln for ln in e["lines"] if ln["t"] == "surplus"), None)
            dc = next((ln for ln in e["lines"] if ln["t"] == "adjustment" and "data center" in ln["l"].lower()), None)
            if sur and dc and sur["v"] < 0 and dc["v"] < 0 and abs(-(sur["v"] + dc["v"]) - shown) <= TOLERANCE:
                doc = budget["docs"][e["doc"]]
                fb = processed() / f"fund_balance_{doc[:-4]}.csv"
                with fb.open(newline="", encoding="utf-8") as f:
                    rows = [r for r in csv.DictReader(f) if r["fiscal_year"] == str(s["year"]) and r["scenario"] in (e["sc"], "single")]
                want = {t: [float(r["amount"]) for r in rows if r["line_type"] == t and (t != "adjustment" or "data center" in r["label"].lower())]
                        for t in ("surplus_deficit", "adjustment")}
                parts = {"surplus_deficit": (sur, -sur["v"]), "adjustment": (dc, -dc["v"])}
                for t, (ln, v) in parts.items():
                    ok = len(want[t]) == 1 and abs(-want[t][0] - v) < 0.5 and ln["p"] > 0
                    bad += not ok
                    name = "drawn from reserves" if t == "surplus_deficit" else "committed data center revenue"
                    print(f"{'ok  ' if ok else 'FAIL'} {key:16s}   split: {v:>12,.0f} {name} = fund balance CSV {t} {want[t]} (p{ln['p']})")
                total = parts["surplus_deficit"][1] + parts["adjustment"][1]
                ok = abs(total - shown) < 0.5
                bad += not ok
                print(f"{'ok  ' if ok else 'FAIL'} {key:16s}   split parts add to {total:,.0f}, the draw shown {shown:,.0f}")
            else:
                print(f"     {key:16s}   no split (the Fund Balance Projection prints no data center adjustment that, with the deficit, equals the draw)")
    return bad


def check_changes(budget: dict) -> int:
    path = GOV.web_data / "changes.json"
    print("\nWhat changed (changes.json):")
    if not path.exists():
        print("FAIL web/data/changes.json is missing")
        return 1
    ch = json.loads(path.read_text())
    acc, cats, funds = budget["accounts"], budget["categories"], budget["funds"]
    codes, units = budget["org"]["codes"], budget["org"]["units"]
    bad = 0
    classify = income_rules.classifier(income_rules.load(GOV))
    draws = draw_codes()

    def entries(key):
        s = budget["series"][key]
        docs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * len(s["a"])
        out = []
        for a, v, p, d in zip(s["a"], s["v"], s["p"], docs):
            code = acc[a][0]
            u = codes[code.split("-")[0]]
            out.append({"a": a, "v": v, "p": p, "d": d, "fund": acc[a][2], "cat": acc[a][5], "bureau": acc[a][4],
                        "unit": u, "dept": units[u]["dept"], "rev": cats[acc[a][5]] == "Revenue",
                        "draw": code.split("-")[-1] in draws,
                        "cls": classify(code, funds[acc[a][2]]) if cats[acc[a][5]] == "Revenue" else ""})
        return out

    val = lambda x: (x or {}).get("v", 0) if isinstance(x, dict) or x is None else x
    for cid, c in ch["comparisons"].items():
        E = {"f": entries(c["from"]), "t": entries(c["to"])}
        n_checked = 0
        for scope, kinds in c["scopes"].items():
            fi = None if scope == "all" else funds.index(scope)
            for kind, b in kinds.items():
                sel = {side: [e for e in E[side] if (fi is None or e["fund"] == fi) and e["rev"] == (kind == "revenue")
                              and counts_as_income(e, scope)] for side in "ft"}
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
                        want = sum(e["v"] for e in E[side] if (fi is None or e["fund"] == fi) and e["rev"] and e["draw"])
                        if abs(val(b["draw"][side]) - want) >= 0.5:
                            bad += 1
                            print(f"FAIL {cid} {scope} draw[{side}] {val(b['draw'][side]):,} vs series {want:,}")
                # changed lines add up to the change in the total
                idx = set(b["up"]) | set(b["down"]) | set(b["new"]["i"]) | set(b["removed"]["i"])
                in_scope = [ln for ln in c["lines"] if (fi is None or acc[ln[0]][2] == fi) and (cats[acc[ln[0]][5]] == "Revenue") == (kind == "revenue")
                            and counts_as_income({"rev": cats[acc[ln[0]][5]] == "Revenue", "cls": classify(acc[ln[0]][0], funds[acc[ln[0]][2]])}, scope)]
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
        g = c["scopes"].get(primary_fund(), {}).get("expense")
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
    for p in sorted(processed().glob("staffing_*.csv")):
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

    bad += check_position_pairs(budget, ch, staffing_sum)

    print("\nTax-policy notes (notes/policy_notes.csv):")
    for n in ch["policy"]:
        print(f"     {n['year']} {n['figure']:8s} {n['item']:18s} {n['text']}  [{n['source']}]")
    return bad


def check_summaries(budget: dict) -> int:
    """Department and bureau summaries (changes.json comparisons[*].summary), re-derived from budget.json's
    series and the staffing CSVs rather than from changes.json's own groups: the net change; that each driver
    line is in the department or bureau, moves the same way as the net and is among the largest moves (no line
    left out is larger); each category driver's change; position counts from both schedules; that raw minus
    adjusted equals the moved and missing-schedule positions; each named title's counts; and that each fund
    shift named touches the General Fund and the department or bureau."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from changes import title_key  # the canonical title form only; counts are re-added from the CSVs here

    print("\nDepartment and bureau summaries (What changed):")
    ch = json.loads((GOV.web_data / "changes.json").read_text())
    acc, cats, funds = budget["accounts"], budget["categories"], budget["funds"]
    codes, units, depts = budget["org"]["codes"], budget["org"]["units"], budget["org"]["departments"]
    rev = cats.index("Revenue")
    with org_codes().open(newline="", encoding="utf-8") as f:
        org_fund = {r["org_code"]: r["fund"] for r in csv.DictReader(f)}
    bad, n_checked = 0, 0

    def series_by(key):
        s = budget["series"][key]
        docs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * len(s["a"])
        return [(a, v, d, p) for a, v, p, d in zip(s["a"], s["v"], s["p"], docs)]

    def schedule(doc_i, label):
        doc = budget["docs"][doc_i]
        m = re.search(r"(\d{4}) (Revised|Proposed)", label)
        yr = m.group(1) if m else re.search(r"(\d{4})", label).group(1)
        col = f"count_{yr}_proposed_revised" if m and m.group(2) == "Revised" else f"count_{yr}_proposed"
        path = next(p for p in processed().glob("staffing_*.csv") if budget_stem(doc) in p.name)
        out = []  # (org, title key, n)
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                n = float(r[col]) if r.get(col, "").strip() else 0.0
                if not n:
                    continue
                org = r["org_code"]
                if org not in codes:
                    near = [c for c in codes if len(c) == len(org) and c[:-1] == org[:-1]]
                    org = near[0]
                out.append((org, title_key(r["position_title"]), n))
        return out

    def fail(msg):
        nonlocal bad
        bad += 1
        print(f"FAIL {msg}")

    for cid, c in ch["comparisons"].items():
        Sm = c.get("summary")
        if not Sm:
            continue
        F, T = series_by(c["from"]), series_by(c["to"])
        P = c.get("positions")
        if P:
            SF, ST = schedule(P["from_doc"], P["from_label"]), schedule(P["to_doc"], P["to_label"])
            moved = [a for a in P["artifacts"] if a["kind"] == "moved"]
            missing = [a for a in P["artifacts"] if a["kind"] == "missing_schedule"]
        for scope, block in Sm.items():
            fi = None if scope == "all" else funds.index(scope)
            for kind, groups in block.items():
                for g, s in groups.items():
                    g = int(g)
                    name = f"{cid} {scope} {'dept ' + depts[g]['name'] if kind == 'd' else 'bureau ' + units[g]['name']}"
                    in_group = (lambda u: units[u]["dept"] == g) if kind == "d" else (lambda u: u == g)
                    sel = lambda a: acc[a][5] != rev and (fi is None or acc[a][2] == fi) and in_group(codes[acc[a][0].split("-")[0]])
                    net = sum(v for a, v, _d, _p in T if sel(a)) - sum(v for a, v, _d, _p in F if sel(a))
                    n_checked += 1
                    if abs(net - s["net"]) >= 0.5:
                        fail(f"{name}: net {s['net']:+,} vs series {net:+,.0f}")
                    lines = c["lines"]
                    dl = lambda i: (lines[i][4] or 0) - (lines[i][1] or 0)
                    mine = [i for i, ln in enumerate(lines) if sel(ln[0])]
                    for i in s.get("drivers", []):
                        n_checked += 1
                        if i not in mine or dl(i) * s["net"] <= 0:
                            fail(f"{name}: driver line {acc[lines[i][0]][0]} is outside the scope or moves against the net change")
                    if s.get("drivers"):
                        smallest = min(abs(dl(i)) for i in s["drivers"])
                        bigger = [i for i in mine if i not in s["drivers"] and dl(i) * s["net"] > 0 and abs(dl(i)) > smallest]
                        if bigger and len(s["drivers"]) < 3 and any(abs(dl(i)) >= 0.15 * abs(s["net"]) for i in bigger) or \
                                (bigger and len(s["drivers"]) == 3):
                            fail(f"{name}: line {acc[lines[bigger[0]][0]][0]} moves more than a named driver")
                    for ci, v, d, p in s.get("cat_drivers", []):
                        want = sum(vv for a, vv, _d, _p in T if sel(a) and acc[a][5] == ci) - sum(vv for a, vv, _d, _p in F if sel(a) and acc[a][5] == ci)
                        n_checked += 1
                        if abs(want - v) >= 0.5 or v * s["net"] <= 0:
                            fail(f"{name}: category {cats[ci]} {v:+,} vs series {want:+,.0f}")
                        if not any(dd == d and pp == p and acc[a][5] == ci and sel(a) for a, _v, dd, pp in T + F):
                            fail(f"{name}: category {cats[ci]} links to doc {d} p{p}, where none of its lines is")
                    pos = s.get("pos")
                    if pos and P:
                        keep = lambda o: in_group(codes[o]) and (fi is None or org_fund[o] == funds[fi])
                        for side, rows in (("f", SF), ("t", ST)):
                            want = sum(n for o, _t, n in rows if keep(o))
                            n_checked += 1
                            if abs(want - pos[side]) > 0.005:
                                fail(f"{name}: positions[{side}] {pos[side]} vs staffing CSV {want:g}")
                        mi = sum(sum(a["n"].values()) for a in moved if in_group(a["unit"]) and (fi is None or a["fund"] == funds[fi])
                                 and not (in_group(a["from_unit"]) and (fi is None or a["from_fund"] == funds[fi])))
                        mo = sum(sum(a["n"].values()) for a in moved if in_group(a["from_unit"]) and (fi is None or a["from_fund"] == funds[fi])
                                 and not (in_group(a["unit"]) and (fi is None or a["fund"] == funds[fi])))
                        ms = sum(a["n_other"] * (1 if a["side"] == "from" else -1) for a in missing
                                 if in_group(a["unit"]) and (fi is None or a["fund"] == funds[fi]))
                        n_checked += 1
                        if abs(mi - pos["moved_in"]) > 0.005 or abs(mo - pos["moved_out"]) > 0.005 or abs(ms - pos["missing"]) > 0.005:
                            fail(f"{name}: moved/missing {pos['moved_in']}/{pos['moved_out']}/{pos['missing']} vs artifacts {mi:g}/{mo:g}/{ms:g}")
                        if abs((pos["t"] - pos["f"]) - (pos["at"] - pos["af"]) - (mi - mo + ms)) > 0.005:
                            fail(f"{name}: raw change {pos['t'] - pos['f']:+g} - adjusted {pos['at'] - pos['af']:+g} is not moved and missing {mi - mo + ms:+g}")
                        miss_orgs = {o for a in missing for o in a["orgs"]}
                        for nm, tf, tt in s.get("titles", []):
                            key = re.sub(r"\s+", " ", nm.upper())
                            k2 = lambda o: keep(o) and o not in miss_orgs
                            want_t = sum(n for o, t, n in ST if k2(o) and t == key)
                            want_f = sum(n for o, t, n in SF if k2(o) and t == key)
                            for a in moved:
                                org = a["orgs"][0]
                                dest_in = in_group(a["unit"]) and (fi is None or a["fund"] == funds[fi])
                                src_in = in_group(a["from_unit"]) and (fi is None or a["from_fund"] == funds[fi])
                                if dest_in != src_in:
                                    n = max(0.0, sum(x for o, t, x in SF if o == org and t == key) - sum(x for o, t, x in ST if o == org and t == key))
                                    want_f += n if dest_in else -n
                            n_checked += 1
                            if abs(want_f - tf) > 0.005 or abs(want_t - tt) > 0.005:
                                fail(f"{name}: title {nm} {tf:g} -> {tt:g} vs staffing CSV {want_f:g} -> {want_t:g}")
                    for j in s.get("shifts", []):
                        x = ch["shifts"][j]
                        n_checked += 1
                        touches = in_group(x["from"]["unit"]) or (x.get("to") and in_group(x["to"]["unit"]))
                        if funds[0] not in (x["from_fund"], x["to_fund"]) or not touches:
                            fail(f"{name}: shift {x['from']['label']} does not touch the General Fund and this group")
        if cid == ch["default"]:
            for g, s in sorted(Sm.get(primary_fund(), {}).get("d", {}).items(), key=lambda kv: int(kv[0])):
                p = s.get("pos") or {}
                drv = [f"{acc[c['lines'][i][0]][1]} {((c['lines'][i][4] or 0) - (c['lines'][i][1] or 0)):+,}" for i in s.get("drivers", [])]
                drv += [f"{cats[ci]} {v:+,}" for ci, v, _d, _p in s.get("cat_drivers", [])]
                print(f"     {depts[int(g)]['name'][:34]:34s} net {s['net']:>+12,}  positions {p.get('f', '-')} -> {p.get('t', '-')}"
                      f"  drivers: {'; '.join(drv) or '-'}" + (f"  titles: {', '.join(f'{n} {a:g}->{b:g}' for n, a, b in s['titles'])}" if s.get("titles") else ""))
    print(f"{'ok  ' if not bad else 'FAIL'} {n_checked} summary figures re-derived from the series and the staffing CSVs")
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


def check_projection(budget: dict) -> int:
    """Check 9 (see the module docstring)."""
    pj = budget.get("projection")
    print("\nProjections (multi-year projections book; shown after the newest year, never selectable):")
    processed = ROOT / "data" / "processed"
    have_csv = []
    for path in sorted(processed.glob("budget_long_*.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f) if r["doc_type"] == "projection"]
        if rows:
            have_csv.append((path, rows))
    if not pj:
        newest = budget["newest_year"]
        later = [p.name for p, rows in have_csv if min(int(r["fiscal_year"]) for r in rows) > newest]
        for name in later:
            print(f"FAIL {name} has projection years after {newest} but budget.json has no projection block")
        if not later:
            print("     no projections book after the newest year")
        return len(later)
    bad = 0
    acc, funds, bureaus, cats, docs = budget["accounts"], budget["funds"], budget["bureaus"], budget["categories"], budget["docs"]
    doc = docs[pj["doc"]]
    stem = budget_stem(doc)
    path = processed / f"budget_long_{stem}.csv"
    with path.open(newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["source_doc"] == doc and r["doc_type"] == "projection"]
    newest = budget["newest_year"]
    # Not selectable: no projection figure in `series`, and every projection year is after the newest year.
    stray = [k for k, s in budget["series"].items() if s["measure"] == "projection" or k.endswith("|projection")]
    early = [k for k, s in pj["series"].items() if s["year"] <= newest]
    for k in stray:
        print(f"FAIL projection figure {k} is in `series` (it would be a selectable year)")
    for k in early:
        print(f"FAIL projection {k} is not after the newest year {newest}")
    bad += len(stray) + len(early)
    if sorted(pj["years"]) != sorted({int(r["fiscal_year"]) for r in rows}) or sorted(pj["series"]) != [f"{y}|projection" for y in sorted(pj["years"])]:
        print(f"FAIL projection years {pj['years']} / series {sorted(pj['series'])} differ from the CSV")
        bad += 1
    if not stray and not early:
        print(f"ok   {', '.join(sorted(pj['series']))} are after {newest} and not in `series`")

    # Totals per fund and kind, and line counts, against the CSV.
    raw, n_raw = defaultdict(float), Counter()
    for r in rows:
        if r["amount"].strip() and float(r["amount"]) != 0:
            k = (f"{r['fiscal_year']}|projection", r["fund"], "revenue" if r["category"] == "Revenue" else "expense")
            raw[k] += float(r["amount"])
            n_raw[k] += 1
    shown, n_shown = defaultdict(float), Counter()
    unmapped = set()
    for key, s in pj["series"].items():
        if s["doc"] != pj["doc"]:
            print(f"FAIL {key}: series doc {s['doc']} is not the projections book")
            bad += 1
        for a, v in zip(s["a"], s["v"]):
            k = (key, funds[acc[a][2]], "revenue" if cats[acc[a][5]] == "Revenue" else "expense")
            shown[k] += v
            n_shown[k] += 1
            if acc[a][0].split("-")[0] not in budget["org"]["codes"]:
                unmapped.add(acc[a][0].split("-")[0])
    for k in sorted(set(raw) | set(shown)):
        ok = abs(raw[k] - shown[k]) < 0.5 and n_raw[k] == n_shown[k]
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {k[0]:16s} {k[1]:30s} {k[2]:8s} shown {shown[k]:>14,.0f} ({n_shown[k]} lines)  csv {raw[k]:>14,.0f} ({n_raw[k]})")
    for o in sorted(unmapped):
        print(f"FAIL projection org code {o} has no org unit ({org_codes().name})")
    bad += len(unmapped)
    if not unmapped:
        print("ok   every projection line maps to an org unit")

    # Printed totals and Surplus/(Deficit), against the validation CSV and re-added from the CSV lines.
    with (processed / f"validation_{stem}.csv").open(newline="", encoding="utf-8") as f:
        val = list(csv.DictReader(f))
    def find(level, label, page):
        return next((r for r in val if r["level"] == level and r["label"] == label and int(r["source_page"]) == page), None)
    nbad = 0
    for p in pj["printed"]:
        fund_name = p.get("fund") or funds[p["m"][0][0]]
        row = find("section", p["label"], p["page"]) if p["level"] == "section" else find("fund", f"{fund_name} / {p['label']}", p["page"])
        if row is None:
            print(f"FAIL p{p['page']} {p['label']!r}: not in the validation CSV")
            nbad += 1
            continue
        for key, printed in p["values"].items():
            fy = key.split("|")[0]
            want = float(row[f"printed_projection_{fy}"])
            total, n = 0.0, 0
            for r in rows:
                if r["fiscal_year"] != fy or not r["amount"].strip() or float(r["amount"]) == 0:
                    continue
                if (r["category"] == "Revenue") != (p["kind"] == "revenue"):
                    continue
                pg = int(r["source_page"])
                if any(r["fund"] == funds[f] and (b == -1 or r["bureau"] == bureaus[b]) and lo <= pg <= hi for f, b, lo, hi in p["m"]):
                    total += float(r["amount"])
                    n += 1
            tol = ROUNDING_PER_CELL if p["level"] == "section" else max(ROUNDING_PER_CELL, ROUNDING_PER_LINE * n)
            errs = []
            if abs(want - printed) > 0.001:
                errs.append(f"shown {printed} but the CSV prints {want}")
            if abs(total - p["sum"][key]) > 0.001 or n != p["n"][key]:
                errs.append(f"line sum {p['sum'][key]} ({p['n'][key]}) but the CSV gives {total} ({n})")
            if (abs(total - printed) > tol) != (key in p["flag"]):
                errs.append(f"gap {total - printed:+,.0f} vs rounding {tol:g}, flag {'set' if key in p['flag'] else 'not set'}")
            for e in errs:
                print(f"FAIL p{p['page']} {p['label']!r} {key}: {e}")
            nbad += bool(errs)
    nflag = sum(len(p["flag"]) for p in pj["printed"])
    print(f"{'ok  ' if not nbad else 'FAIL'} {len(pj['printed'])} printed projection totals: values match the validation CSV, line sums and flags re-derived ({nflag} flagged)")
    bad += nbad
    tot = {(p.get("fund"), p["kind"]): p for p in pj["printed"] if p["level"] == "rollup"}
    for sp in pj["surplus"]:
        fund_name = funds[sp["fund"]]
        row = find("surplus", f"{fund_name} / Surplus/(Deficit) = printed Total Revenue - Total Expense", sp["page"])
        rv, ex = tot.get((fund_name, "revenue")), tot.get((fund_name, "expense"))
        for key, v in sp["values"].items():
            fy = key.split("|")[0]
            ok = row is not None and abs(float(row[f"printed_projection_{fy}"]) - v) < 0.001 and rv and ex \
                and abs(rv["values"][key] - ex["values"][key] - v) <= ROUNDING_PER_CELL
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {key:16s} {fund_name:30s} Surplus/(Deficit) {v:>13,.0f} = printed revenue - expense")
    ap = processed / f"projection_assumptions_{stem}.csv"
    with ap.open(newline="", encoding="utf-8") as f:
        text = " ".join(r["text"].strip() for r in csv.DictReader(f))
    ok = " ".join(a["t"] for a in pj["assumptions"]) == text and all(a["p"] >= 1 for a in pj["assumptions"])
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {len(pj['assumptions'])} assumption lines equal {ap.name}")
    return bad


def budget_stem(doc: str) -> str:
    return doc[:-4] if doc.lower().endswith(".pdf") else doc


def check_position_pairs(budget: dict, ch: dict, staffing_sum: dict, override: dict | None = None) -> int:
    """web/data/positions.json (positions for every pair of position schedules), re-derived from the staffing CSVs:
    each side's all-funds total per class equals the schedule column's sum (unplaced positions included); the
    unplaced count equals the CSV lines whose org code the org chart doesn't have; adjusted = raw minus the positions
    left out for a missing schedule page (moves and relabels net to zero); and each pair that changes.json also has
    is identical to it. `override` replaces the file's data (to show the check catches a wrong number)."""
    print("\nPositions for every pair of schedules (positions.json):")
    path = ROOT / "web" / "data" / "positions.json"
    if override is None and not path.exists():
        print("FAIL web/data/positions.json is missing (run build_dataset.py)")
        return 1
    pos: dict = override if override is not None else json.loads(path.read_text())
    codes, docs, newest = budget["org"]["codes"], budget["docs"], ch["year"]
    csv_cache, bad = {}, 0

    def sched_rows(sid):
        """(class, n, placed) per CSV line of a schedule; class as changes.load_schedule() assigns it."""
        if sid in csv_cache:
            return csv_cache[sid]
        doc = docs[pos["schedules"][sid]["doc"]]
        y, _, m = sid.partition("|")
        col = f"count_{y}_proposed_revised" if m == "revised" else f"count_{y}_proposed"
        path = next(p for p in processed().glob("staffing_*.csv") if budget_stem(doc) in p.name)
        with path.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        ftpt = any(r.get("ft_pt") in ("FT", "PT") for r in rows)
        out = []
        for r in rows:
            n = float(r[col]) if r.get(col, "").strip() else 0.0
            if not n:
                continue
            org = r["org_code"]
            placed = org in codes or len([c for c in codes if len(c) == len(org) and c[:-1] == org[:-1]]) == 1
            out.append(("PT" if ftpt and r["ft_pt"] == "PT" else "FT" if ftpt else "ALL", n, placed))
        csv_cache[sid] = (out, sum(v for (fn, cn), v in staffing_sum.items() if cn == col[6:] and budget_stem(doc) in fn))
        return csv_cache[sid]

    sk = lambda k: k if k.startswith(f"{newest}|") else k.split("|")[0]
    n_ok = 0
    for pid, P in pos["pairs"].items():
        t_id, f_id = pid.split("~")
        T = P["totals"]["all"]
        fails = []
        for side, sid, raw, adj in (("from", f_id, "f", "af"), ("to", t_id, "t", "at")):
            rows, col_sum = sched_rows(sid)
            for c in P["classes"]:
                want = sum(n for cl, n, _ in rows if c == "ALL" or cl == c)
                if abs(T[c][raw] - want) > 0.005:
                    fails.append(f"{side} {c} total {T[c][raw]:g} vs staffing CSV {want:g}")
            if abs(sum(T[c][raw] for c in P["classes"]) - col_sum) > 0.005:
                fails.append(f"{side} total {sum(T[c][raw] for c in P['classes']):g} vs staffing CSV column sum {col_sum:g}")
            up_csv = sum(n for _, n, placed in rows if not placed)
            up_art = sum(sum(a["n"].values()) for a in P["artifacts"] if a["kind"] == "unplaced" and a["side"] == side)
            if abs(up_csv - up_art) > 0.005:
                fails.append(f"{side} unplaced {up_art:g} vs CSV lines with unknown org codes {up_csv:g}")
            rows_sum = sum(r[3 if side == "from" else 4] for r in P["rows"])
            if abs(rows_sum + up_art - sum(T[c][raw] for c in P["classes"])) > 0.005:
                fails.append(f"{side} bureau rows {rows_sum:g} + unplaced {up_art:g} is not the total")
            other = "to" if side == "from" else "from"
            missing = sum(a["n_other"] for a in P["artifacts"] if a["kind"] == "missing_schedule" and a["side"] == other)
            r_tot, a_tot = sum(T[c][raw] for c in P["classes"]), sum(T[c][adj] for c in P["classes"])
            if abs(a_tot - (r_tot - missing)) > 0.005:
                fails.append(f"{side} adjusted {a_tot:g} is not raw {r_tot:g} - missing schedules {missing:g}")
        for cid, c in ch["comparisons"].items():
            if c.get("positions") and f"{sk(c['to'])}~{sk(c['from'])}" == pid and c["positions"] != P:
                fails.append(f"differs from changes.json {cid}")
        bad += len(fails)
        n_ok += not fails
        for x in fails:
            print(f"FAIL {pid:24s} {x}")
    same = [cid for cid, c in ch["comparisons"].items() if c.get("positions") and pos["pairs"].get(f"{sk(c['to'])}~{sk(c['from'])}") == c["positions"]]
    print(f"{'ok  ' if n_ok == len(pos['pairs']) else 'FAIL'} {n_ok} of {len(pos['pairs'])} pairs ({len(pos['schedules'])} schedules): totals per class = "
          f"staffing CSV sums (unplaced included), adjusted = raw - missing schedules; {len(same)} identical to changes.json ({', '.join(same)})")
    for sid in pos["schedules"]:
        rows, col_sum = sched_rows(sid)
        up = sum(n for _, n, placed in rows if not placed)
        print(f"       {sid:14s} {col_sum:8.2f} positions" + (f", {up:g} under org codes the org chart doesn't have" if up else ""))
    return bad


SPIKE_X, SPIKE_SHARE = 2, 0.05  # keep equal to app.js


def check_spikes(budget: dict) -> int:
    """The same rule as app.js lineSpikes(): along the Actual / Projected line (then the newest year's Revised, else
    Proposed), a line at least SPIKE_X times both neighbours (both above zero) whose jump is at least SPIKE_SHARE of its
    fund's total of that kind that year."""
    acc, funds, cats = budget["accounts"], budget["funds"], budget["categories"]
    ser = budget["series"]
    keys = []
    for y in sorted({s["year"] for s in ser.values()}):
        m = next((x for x in ("actual", "projected") if f"{y}|{x}" in ser), None)
        if m is None and y == budget["newest_year"]:
            m = "revised" if f"{y}|revised" in ser else "proposed" if f"{y}|proposed" in ser else None
        if m:
            keys.append(f"{y}|{m}")

    def lines(k):
        by, tot = defaultdict(float), defaultdict(float)
        for a, v in zip(ser[k]["a"], ser[k]["v"]):
            kind = "revenue" if cats[acc[a][5]] == "Revenue" else "expense"
            if kind == "revenue" and budget["not_income"].get(str(a)) in ("draw", "transfer"):
                continue  # not income (app.js lineSpikes leaves them out the same way)
            by[(kind, acc[a][2], acc[a][0])] += v
            tot[(kind, acc[a][2])] += v
        return by, tot

    L = [lines(k) for k in keys]
    spikes = set()
    print("\nLines far above the years either side (site notes under Totals by Year and on What changed):")
    for i in range(1, len(keys) - 1):
        (a, _), (x, tot), (b, _) = L[i - 1], L[i], L[i + 1]
        for idk, v in sorted(x.items()):
            pa, pb = a.get(idk, 0), b.get(idk, 0)
            if pa <= 0 or pb <= 0:
                continue
            nb = max(pa, pb)
            if v >= SPIKE_X * nb and v - nb >= SPIKE_SHARE * tot[idk[:2]]:
                spikes.add((keys[i], idk[2]))
                print(f"     {keys[i]:16s} {funds[idk[1]]:28s} {idk[0]:8s} {idk[2]:16s} {v:>12,.0f}  (before {pa:,.0f}, after {pb:,.0f}; {(v - nb) / tot[idk[:2]]:.1%} of the fund)")
    bad = 0
    ch = json.loads((GOV.web_data / "changes.json").read_text())
    print("Line notes (notes/line_notes.csv):")
    for n in ch.get("line_notes", []):
        k = f"{n['year']}|{n['figure']}"
        found = k in ser and any(acc[a][0] == n["account"] for a in ser[k]["a"])
        bad += not found
        print(f"{'ok  ' if found else 'FAIL'} {k:16s} {n['account']:16s} {'matches a listed line' if (k, n['account']) in spikes else 'no listed line (shown only if one appears)'}"
              + ("" if found else "  (no such line in that series)"))
    return bad


def main() -> int:
    global GOV
    import argparse
    import govconfig
    ap = argparse.ArgumentParser(description="Check the dashboard JSON against the processed CSVs.")
    ap.add_argument("--gov", help="government id (default: site.yaml default_government)")
    ap.add_argument("--entity", choices=["city", "county"],
                    help="old name for --gov: city = lancaster-city, county = lancaster-county")
    args = ap.parse_args()
    gov_id = args.gov or {"city": "lancaster-city", "county": "lancaster-county"}.get(args.entity)
    GOV = govconfig.resolve_government(gov_id)
    if GOV.kind == "county":
        import check_county
        return check_county.main()
    budget = json.loads((GOV.web_data / "budget.json").read_text())
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
    for path in sorted(processed().glob("budget_long_*.csv")):
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
    # The year's budget figure comes from the next book only (its adopted / amended columns for the prior year).
    year_of_doc = {b["doc"]: b["year"] for b in budget["books"] if b["used"]}
    budget_cols = defaultdict(set)  # fiscal year -> adopted / amended columns printed by the book a year later
    for (fy, c, _fund, _kind, doc) in raw:
        if c in ("adopted", "amended") and year_of_doc.get(doc) == int(fy) + 1:
            budget_cols[int(fy)].add(c)
    for y, got in sorted(by_year.items()):
        if y == newest:
            want = {"proposed", "revised"} & {m for m, c in (("proposed", "proposed"), ("revised", "proposed_revised")) if c in raw_cols[str(y)]}
        elif "actual" in raw_cols[str(y)]:
            want = {"actual"}
        else:
            want = {"projected"}
        want |= {"amended"} if "amended" in budget_cols[y] else {"adopted"} if "adopted" in budget_cols[y] else set()
        ok = got == want
        bad_years += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {y}: shows {', '.join(sorted(got))}" + ("" if ok else f" (expected {', '.join(sorted(want))})"))
    failures += bad_years

    failures += check_printed(budget)

    failures += check_reserve(budget)
    failures += check_org(budget)
    failures += check_reserve_draw(budget)
    failures += income_rules.check(budget, gov=GOV)
    failures += check_changes(budget)
    failures += check_summaries(budget)
    failures += check_spikes(budget)
    failures += check_projection(budget)
    failures += tax_limit.check(budget, gov=GOV)
    failures += tax_rates.check()

    print(f"\n{failures} series mismatches")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
