#!/usr/bin/env python3
"""Check web/data/county/*.json against the County CSVs, recomputing every figure independently.

Run through `python3 scripts/check_dataset.py --entity county`. It reads data/processed/county/budget_long_*.csv,
validation_*.csv and data/county/*.csv directly and does not import the build.

1. Figure rule: one series per fiscal year printed by any County book, measure "budget", taken from the newest
   book that prints the year; nothing else.
2. Lines: every shown line equals its CSV row (fund, account, name, department, category, amount, page), and
   every non-zero CSV row of the chosen book and year is shown; totals per fund and revenue/expense are printed.
3. Printed totals: the General Fund and Other Funds grand totals and each department total the book prints,
   against the shown line sums. A difference over $5 is reported with whether known_issues.csv explains it
   (as for the City, not a failure).
4. Org: the department-code mapping equals data/county/org_units.csv (plus any listed as unlisted); each group
   is its department letter; department totals add up to group totals and groups to the series total.
5. Changes: the newest year against the year before, recomputed from the CSVs with data/county/account_changes.csv
   folded in: every changed line (values and pages), the set of changed lines, every scope total and every
   category, group, department and revenue-category figure, and each merged line's components.
6. Conflicts: every line where an older book prints a different figure for a shown year is in conflicts.json,
   and nothing else is.
7. Actuals (budget.json `actuals`, from data/processed/county/actuals_acfr_<year>.csv): every figure recomputed
   from the CSVs, config/county/acfr/*.json, data/county/acfr_substitutions.csv and known_issues.csv (level, line,
   actual, final, document, page, substitution, flags), and nothing else shown; no Original or variance figure;
   no actual for a year without an ACFR; the General Fund's sources and functions add to its printed totals and
   every fund's net change foots (with the printed figures); the books' totals beside them equal the CSV sums;
   every ACFR check over $5 in validation_acfr_<year>.csv is in known_issues.csv; and fund_balance_gaap.json
   equals data/processed/county/gaap_fund_balance_acfr.csv, with the General Fund and other funds adding to the total.
Every failure counts toward the final "N series mismatches". Standard library only.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed" / "county"
DATA = ROOT / "data" / "county"
WEB = ROOT / "web" / "data" / "county"
TOLERANCE = 5


def read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def amt(text) -> float:
    text = (text or "").strip()
    return float(text) if text else 0.0


def main() -> int:
    budget = json.loads((WEB / "budget.json").read_text())
    changes = json.loads((WEB / "changes.json").read_text())
    conflicts = json.loads((WEB / "conflicts.json").read_text())
    acc, funds, cats, depts, bureaus, docs = (budget[k] for k in ("accounts", "funds", "categories", "departments", "bureaus", "docs"))
    failures = 0

    # ---- books and the figure rule --------------------------------------------------------------
    rows_by_doc = defaultdict(list)
    for path in sorted(PROCESSED.glob("budget_long_*.csv")):
        for r in read(path):
            if r["doc_type"] == "budget":
                rows_by_doc[r["source_doc"]].append(r)
    book_year = {d: max(int(r["fiscal_year"]) for r in rs) for d, rs in rows_by_doc.items()}
    editions = defaultdict(list)
    for d, y in book_year.items():
        editions[y].append(d)
    live = {y: sorted(ds, key=lambda d: ("adopt" in d.lower(), d))[-1] for y, ds in editions.items()}
    prints = defaultdict(set)
    for y, d in live.items():
        for r in rows_by_doc[d]:
            prints[int(r["fiscal_year"])].add(d)
    want_book = {fy: max(ds, key=lambda d: book_year[d]) for fy, ds in prints.items()}
    newest = max(want_book)

    print("County figure rule (newest book that prints the year, measure budget):")
    want_keys = {f"{fy}|budget" for fy in want_book}
    got_keys = set(budget["series"])
    for k in sorted(want_keys | got_keys):
        s = budget["series"].get(k)
        fy = int(k.split("|")[0])
        ok = s is not None and k in want_keys and docs[s["doc"]] == want_book[fy] and s["measure"] == "budget" and s["column"] == "budget"
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {k:12s} from {docs[s['doc']] if s else '-':32s} expected {want_book.get(fy, 'no series')}")
    ok = budget["newest_year"] == newest
    failures += not ok
    print(f"{'ok  ' if ok else 'FAIL'} newest year {budget['newest_year']} (expected {newest})")

    def csv_rows(fy: int, doc: str | None = None) -> list[dict]:
        return [r for r in rows_by_doc[doc or want_book[fy]] if int(r["fiscal_year"]) == fy]

    def kind_of(r):
        return "revenue" if r["side"] == "revenue" else "expense"

    # ---- lines ------------------------------------------------------------------------------------
    print("\nShown lines vs CSV rows (fund, account, name, department, category, amount, page):")
    shown_tot = defaultdict(float)
    for key, s in sorted(budget["series"].items()):
        fy = s["year"]
        got = Counter()
        for a, v, p in zip(s["a"], s["v"], s["p"]):
            code, name, f, d, b, c = acc[a]
            rev = cats[c] == "Revenue"
            got[(funds[f], code, name, depts[d], bureaus[b] if rev else cats[c], "revenue" if rev else "expense", v, p)] += 1
            if not rev and bureaus[b] != depts[d]:
                failures += 1
                print(f"FAIL {key} {code}: expense bureau {bureaus[b]!r} is not the department name")
            shown_tot[(key, funds[f], "revenue" if rev else "expense")] += v
        want = Counter()
        for r in csv_rows(fy):
            v = amt(r["amount"])
            if v:
                want[(r["fund"], r["account_code"], r["account_name"], r["department"], r["category"], kind_of(r),
                      int(v) if v.is_integer() else v, int(r["source_page"]))] += 1
        extra, missing = got - want, want - got
        for x in list(extra)[:5]:
            print(f"FAIL {key} shown but not in CSV: {x}")
        for x in list(missing)[:5]:
            print(f"FAIL {key} in CSV but not shown: {x}")
        failures += sum(extra.values()) + sum(missing.values())
        csv_tot = defaultdict(float)
        for r in csv_rows(fy):
            csv_tot[(r["fund"], kind_of(r))] += amt(r["amount"])
        for (f, kd) in sorted(csv_tot):
            sv = shown_tot[(key, f, kd)]
            ok = abs(sv - csv_tot[(f, kd)]) < 0.5
            failures += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {key:12s} {f:14s} {kd:8s} shown {sv:>14,.0f}  csv {csv_tot[(f, kd)]:>14,.0f}")

    # ---- printed totals ---------------------------------------------------------------------------
    print("\nPrinted totals vs shown sums:")
    known = read(DATA / "known_issues.csv") if (DATA / "known_issues.csv").exists() else []
    norm = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
    dept_sum = defaultdict(float)
    for key, s in budget["series"].items():
        for a, v in zip(s["a"], s["v"]):
            code, name, f, d, b, c = acc[a]
            grp = "General Fund" if funds[f] == "General Fund" else "Other Funds"
            kd = "revenue" if cats[c] == "Revenue" else "expense"
            dept_sum[(key, grp, kd, depts[d])] += v
            if grp == "Other Funds":
                dept_sum[(key, funds[f], kd, depts[d])] += v  # Other Funds department totals are printed per fund
    undocumented = shown_printed = 0
    for p in budget["printed"]:
        for key, printed in p["values"].items():
            if "department" in p:
                sv = dept_sum[(key, p.get("dept_fund") or p["group"], p["kind"], p["department"])]
            else:
                sv = sum(v for (k, f, kd), v in shown_tot.items() if k == key and kd == p["kind"]
                         and (f == "General Fund") == (p["group"] == "General Fund"))
            diff = sv - printed
            shown_printed += 1
            if abs(diff) <= TOLERANCE and "department" in p:
                continue  # department totals: only differences are listed
            tail = ""
            if abs(diff) > TOLERANCE:
                doc = docs[p["doc"]]
                hit = [i for i in known if i["source_doc"] == doc and int(i["source_page"] or 0) == p["page"] and norm(i["label"]) == norm(p["label"])]
                tail = "  -> logged in known_issues.csv" if hit else "  -> NOT in known_issues.csv"
                undocumented += not hit
            print(f"{'ok  ' if abs(diff) <= TOLERANCE else 'DIFF'} {key:12s} {p['label']:58s} p.{p['page']:<4d} printed {printed:>14,.0f}  shown {sv:>14,.0f}  diff {diff:+,.0f}{tail}")
    print(f"{shown_printed} printed totals compared; {undocumented} differences over ${TOLERANCE} are not in data/county/known_issues.csv")

    # ---- org ------------------------------------------------------------------------------------------
    print("\nCounty groups and departments (data/county/org_units.csv):")
    org = budget["org"]
    units_csv = {r["department_code"]: r for r in read(DATA / "org_units.csv")}
    bad = 0
    expect_codes = set(units_csv) | set(org.get("unlisted", []))
    if set(org["codes"]) != expect_codes:
        bad += 1
        print(f"FAIL org codes differ from org_units.csv: {sorted(set(org['codes']) ^ expect_codes)}")
    for code, ui in org["codes"].items():
        u = org["units"][ui]
        g = org["departments"][u["dept"]]
        r = units_csv.get(code)
        ok = g["letter"] == code[0] and (r is None or (u["name"] == r["department"] and g["name"] == r["group"]
                                                       and r["group_letter"] == code[0] and u.get("page") == int(r["department_page"])))
        if not ok:
            bad += 1
            print(f"FAIL {code}: shown as {g['name']} / {u['name']}")
    for c in org.get("unlisted", []):
        print(f"NOTE {c} is shown but not listed in org_units.csv (grouped by its letter)")
    for key, s in budget["series"].items():
        by_unit, by_group = defaultdict(float), defaultdict(float)
        for a, v in zip(s["a"], s["v"]):
            code = acc[a][0].split("-")[0]
            if code not in org["codes"]:
                bad += 1
                print(f"FAIL {key} {acc[a][0]}: department not mapped")
                continue
            ui = org["codes"][code]
            kd = "revenue" if cats[acc[a][5]] == "Revenue" else "expense"
            by_unit[(ui, kd)] += v
            by_group[(org["units"][ui]["dept"], kd)] += v
        for (gi, kd), gv in by_group.items():
            us = sum(v for (ui, k), v in by_unit.items() if k == kd and org["units"][ui]["dept"] == gi)
            if abs(us - gv) >= 0.5:
                bad += 1
                print(f"FAIL {key} {org['departments'][gi]['name']} {kd}: departments {us:,.0f} != group {gv:,.0f}")
        for kd in ("revenue", "expense"):
            gs = sum(v for (gi, k), v in by_group.items() if k == kd)
            ts = sum(v for (k, f, kk), v in shown_tot.items() if k == key and kk == kd)
            if abs(gs - ts) >= 0.5:
                bad += 1
                print(f"FAIL {key} {kd}: groups {gs:,.0f} != series {ts:,.0f}")
    print(f"{'ok  ' if not bad else 'FAIL'} {len(org['codes'])} department codes in {len(org['departments'])} groups; "
          f"department and group totals add up in every series")
    failures += bad

    failures += check_changes(budget, changes, csv_rows, want_book, book_year, newest)
    failures += check_conflicts(conflicts, rows_by_doc, live, want_book)
    failures += check_actuals(budget, rows_by_doc, want_book)

    print(f"\n{failures} series mismatches")
    return 1 if failures else 0


def check_changes(budget, changes, csv_rows, want_book, book_year, newest) -> int:
    print("\nWhat changed (changes.json), recomputed from the CSVs with account merges:")
    acc, funds, cats, depts, bureaus = (budget[k] for k in ("accounts", "funds", "categories", "departments", "bureaus"))
    org = budget["org"]
    prior = newest - 1
    if prior not in want_book:
        ok = not changes["comparisons"]
        print(f"{'ok  ' if ok else 'FAIL'} only one budget year: no comparison")
        return 0 if ok else 1
    cid = f"{newest}|budget~{prior}|budget"
    comp = changes["comparisons"].get(cid)
    if comp is None or changes["default"] != cid:
        print(f"FAIL comparison {cid} missing or not the default")
        return 1

    def year_of(doc):
        if doc in book_year:
            return book_year[doc]
        m = re.search(r"20\d\d", doc)
        return int(m.group()) if m else None

    rules = []
    for r in read(DATA / "account_changes.csv"):
        y = year_of(r["first_book"])
        if y is not None and prior < y <= newest:
            scope = r["department_scope"].strip()
            rules.append((set(r["from_accounts"].split(";")), r["to_account"], None if scope in ("", "all") else set(scope.split(";"))))

    def target(code):
        dept, a = code.split("-", 1)
        for frm, to, scope in rules:
            if a in frm and (scope is None or dept in scope):
                return f"{dept}-{to}", True
        return code, False

    # (fund, code) -> {"v", "pages", "kind", "cat", "rev group", "dept code", "merged"}
    def view(fy):
        out = {}
        for r in csv_rows(fy):
            v = amt(r["amount"])
            if not v:
                continue
            code, moved = target(r["account_code"])
            e = out.setdefault((r["fund"], code), {"v": 0.0, "pages": [], "kind": "revenue" if r["side"] == "revenue" else "expense",
                                                    "cat": r["category"], "rcat": r["category"], "dept": code.split("-")[0], "merged": False})
            e["v"] += v
            e["pages"].append(int(r["source_page"]))
            e["merged"] |= moved
        return out

    f_view, t_view = view(prior), view(newest)
    bad = 0
    want_changed = {k for k in set(f_view) | set(t_view) if (f_view.get(k) or {"v": 0})["v"] != (t_view.get(k) or {"v": 0})["v"]}
    got_changed = {}
    for i, ln in enumerate(comp["lines"]):
        code, _n, f, *_ = acc[ln[0]]
        k = (funds[f], code)
        got_changed[k] = i
        fe, te = f_view.get(k), t_view.get(k)
        for side, e, v, p in (("from", fe, ln[1], ln[3]), ("to", te, ln[4], ln[6])):
            if (e is None) != (v is None) or (e and (abs(e["v"] - v) >= 0.5 or p not in e["pages"])):
                bad += 1
                print(f"FAIL line {k}: {side} shown {v} p.{p}, csv {e and e['v']} pages {e and e['pages']}")
    for k in sorted(want_changed - set(got_changed)):
        bad += 1
        print(f"FAIL changed line missing: {k}")
    for k in sorted(set(got_changed) - want_changed):
        bad += 1
        print(f"FAIL line shown as changed but equal in the CSVs: {k}")
    print(f"{'ok  ' if not bad else 'FAIL'} {len(comp['lines'])} changed lines (values, pages, and the set of lines)")

    # merges
    mbad = 0
    want_merged = {k for k, e in list(f_view.items()) + list(t_view.items()) if e["merged"]}
    got_merged = set()
    for m in comp["merges"]:
        k = (funds[m["fund"]], m["code"])
        got_merged.add(k)
        for side, view_, li in (("f", f_view, 1), ("t", t_view, 4)):
            comps = m[side]
            total = sum(c[1] for c in comps)
            e = view_.get(k)
            if (e["v"] if e else 0) != total:
                mbad += 1
                print(f"FAIL merge {k} {side}: components {total:,} != csv {e and e['v']}")
            for c in comps:
                code = acc[c[0]][0]
                if target(code)[0] != m["code"] or funds[acc[c[0]][2]] != k[0]:
                    mbad += 1
                    print(f"FAIL merge {k}: component {code} does not merge into it")
        if m["line"] is not None and (acc[comp["lines"][m["line"]][0]][0] != m["code"] or funds[acc[comp["lines"][m["line"]][0]][2]] != k[0]):
            mbad += 1
            print(f"FAIL merge {k}: points at the wrong line")
        if m["line"] is None and k in want_changed:
            mbad += 1
            print(f"FAIL merge {k}: changed but has no line")
    for k in sorted(want_merged ^ got_merged):
        mbad += 1
        print(f"FAIL merged line {k}: {'missing from' if k in want_merged else 'not a merge in the CSVs, but in'} merges")
    print(f"{'ok  ' if not mbad else 'FAIL'} {len(comp['merges'])} merged lines; each equals the sum of its accounts in both years")
    bad += mbad

    # scopes
    sbad = 0
    unit_of = lambda dept: org["codes"][dept]
    for scope, kinds in comp["scopes"].items():
        for kind, block in kinds.items():
            def pick(v):
                return {k: e for k, e in v.items() if e["kind"] == kind and (scope == "all" or k[0] == scope)}
            fv, tv = pick(f_view), pick(t_view)
            for side, vw in (("f", fv), ("t", tv)):
                got = (block["total"][side] or {"v": 0})["v"]
                want = sum(e["v"] for e in vw.values())
                if abs(got - want) >= 0.5:
                    sbad += 1
                    print(f"FAIL {scope} {kind} total {side}: {got:,} != csv {want:,.0f}")
            groups = {"by_dept": lambda k, e: org["units"][unit_of(e["dept"])]["dept"],
                      "by_unit": lambda k, e: unit_of(e["dept"])}
            if kind == "expense":
                groups["by_cat"] = lambda k, e: cats.index(e["cat"])
            else:
                groups["by_group"] = lambda k, e: bureaus.index(e["rcat"])
            for name, keyfn in groups.items():
                for side, vw, col in (("f", fv, 1), ("t", tv, 2)):
                    want = defaultdict(float)
                    for k, e in vw.items():
                        want[keyfn(k, e)] += e["v"]
                    got = {row[0]: (row[col] or {"v": 0})["v"] for row in block[name]}
                    for g in set(want) | set(got):
                        if abs(want.get(g, 0) - got.get(g, 0)) >= 0.5:
                            sbad += 1
                            print(f"FAIL {scope} {kind} {name}[{g}] {side}: {got.get(g, 0):,} != csv {want.get(g, 0):,.0f}")
                    tot = (block["total"][side] or {"v": 0})["v"]
                    if abs(sum(got.values()) - tot) >= 0.5:
                        sbad += 1
                        print(f"FAIL {scope} {kind} {name} {side}: groups do not add up to the total")
            # changed lines add up to the change in the total
            idx = [i for i, ln in enumerate(comp["lines"]) if (scope == "all" or funds[acc[ln[0]][2]] == scope)
                   and (cats[acc[ln[0]][5]] == "Revenue") == (kind == "revenue")]
            delta = sum((comp["lines"][i][4] or 0) - (comp["lines"][i][1] or 0) for i in idx)
            tdelta = (block["total"]["t"] or {"v": 0})["v"] - (block["total"]["f"] or {"v": 0})["v"]
            if abs(delta - tdelta) >= 0.5:
                sbad += 1
                print(f"FAIL {scope} {kind}: changed lines add to {delta:,}, total changed by {tdelta:,}")
    want_scopes = {"all"} | {k[0] for k in set(f_view) | set(t_view)}
    if set(comp["scopes"]) != want_scopes:
        sbad += 1
        print(f"FAIL scopes {sorted(comp['scopes'])} != {sorted(want_scopes)}")
    print(f"{'ok  ' if not sbad else 'FAIL'} {len(comp['scopes'])} scopes: totals, categories, groups, departments and "
          f"revenue categories equal the CSV sums; changed lines add up to each total's change")
    a = comp["scopes"]["all"]
    for kind in ("expense", "revenue"):
        if kind in a:
            f, t = a[kind]["total"]["f"]["v"], a[kind]["total"]["t"]["v"]
            print(f"     all funds {kind:8s} {prior} {f:>14,}  {newest} {t:>14,}  change {t - f:+,}")
    return bad + sbad


def check_conflicts(conflicts, rows_by_doc, live, want_book) -> int:
    print("\nConflicts between books (conflicts.json):")
    want = Counter()
    for fy, used in want_book.items():
        def lines(doc):
            out = defaultdict(float)
            for r in rows_by_doc[doc]:
                if int(r["fiscal_year"]) == fy:
                    out[(r["fund"], r["account_code"])] += amt(r["amount"])
            return out
        mine = lines(used)
        for doc in live.values():
            if doc == used or not any(int(r["fiscal_year"]) == fy for r in rows_by_doc[doc]):
                continue
            theirs = lines(doc)
            for k in set(mine) | set(theirs):
                if mine.get(k, 0) != theirs.get(k, 0):
                    want[(fy, k[0], k[1], mine.get(k, 0), theirs.get(k, 0), used, doc)] += 1
    got = Counter((c["fiscal_year"], c["fund"], c["account_code"], float(c["used"]), float(c["other"]), c["used_doc"], c["other_doc"])
                  for c in conflicts if c["kind"] == "value")
    bad = sum((want - got).values()) + sum((got - want).values())
    for x in list((want - got) + (got - want))[:10]:
        print(f"FAIL {x}")
    explained = sum(1 for c in conflicts if c.get("account_change"))
    print(f"{'ok  ' if not bad else 'FAIL'} {len(got)} line differences between books, {explained} of them from a recorded account change")
    return bad


ACFR_LEVEL = {("revenue", "line"): "revenue_source", ("expenditure", "line"): "function",
              ("revenue", "total"): "fund_total", ("expenditure", "total"): "fund_total", ("net_change", "net_change"): "fund_total"}


def check_actuals(budget, rows_by_doc, want_book) -> int:
    print("\nActuals (ACFR, budgetary basis), recomputed from actuals_acfr_*.csv:")
    a, docs = budget.get("actuals"), budget["docs"]
    configs = {int(p.stem): json.loads(p.read_text()) for p in sorted((ROOT / "config" / "county" / "acfr").glob("*.json"))}
    years = [y for y in sorted(configs) if (PROCESSED / f"actuals_acfr_{y}.csv").exists()]
    if not years:
        ok = not a
        print(f"{'ok  ' if ok else 'FAIL'} no ACFR CSVs: no actuals")
        return 0 if ok else 1
    if not a:
        print("FAIL actuals_acfr CSVs exist but budget.json has no actuals")
        return 1
    bad = 0
    ok = a["years"] == years and "actual" in budget["measures"] and a["measure"] == "actual" and a["basis"] == "budgetary"
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} actual years {a['years']} (expected {years}); measure 'actual', budgetary basis")
    ok = max(want_book) not in a["years"] or max(want_book) in configs
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} the newest budget year ({max(want_book)}) has actuals only if its ACFR is configured")

    known = read(DATA / "known_issues.csv") if (DATA / "known_issues.csv").exists() else []
    spath = DATA / "acfr_substitutions.csv"
    subs = {(int(r["fiscal_year"]), r["fund"], r["line"], r["column"]): r for r in (read(spath) if spath.exists() else [])}
    want = Counter()
    for y in years:
        doc = configs[y]["source_doc"]
        for r in read(PROCESSED / f"actuals_acfr_{y}.csv"):
            if r["section"] == "transfer" and r["row_type"] == "line":
                level = "transfer"
            elif r["fund"] != "General Fund" and r["row_type"] == "line":
                continue  # special funds: totals and transfers only
            else:
                level = ACFR_LEVEL.get((r["section"], r["row_type"]))
            if level is None:
                continue
            v, d, p, printed, printed_p = int(r["actual"]), doc, int(r["source_page"]), None, None
            sub = subs.get((y, r["fund"], r["line"], "actual"))
            if sub:
                printed, printed_p = v, p
                v, d, p = int(sub["used"]), sub["used_doc"], int(sub["used_page"])
            me = f"{y} {r['fund']} {r['line']}"
            flags = tuple(sorted(i for i, k in enumerate(known) if k["source_doc"] == doc and int(k["source_page"] or 0) == int(r["source_page"])
                                 and (k["label"] == me or k["label"].startswith(me + " "))))
            want[(y, r["fund"], level, r["section"], r["line"], r["heading"] or None, v,
                  int(r["final"]) if r["final"] != "" else None, d, p, printed, printed_p, flags)] += 1
    got = Counter()
    forbidden = 0
    for f in a["figures"]:
        forbidden += any(k in f for k in ("original", "variance"))
        got[(f["year"], f["fund"], f["level"], f["section"], f["line"], f.get("heading"), f["v"], f["final"], docs[f["doc"]],
             f["p"], f.get("printed"), f.get("printed_p"), tuple(f.get("flags", [])))] += 1
    for x in list((want - got) + (got - want))[:10]:
        print(f"FAIL actual figure {'missing' if x in want else 'not in the CSVs'}: {x}")
    nbad = sum((want - got).values()) + sum((got - want).values())
    bad += nbad
    print(f"{'ok  ' if not nbad else 'FAIL'} {len(a['figures'])} actual figures equal the CSV rows (value, final budget, document, page, "
          f"substitutions, flags), and nothing else is shown")
    bad += forbidden
    print(f"{'ok  ' if not forbidden else 'FAIL'} no figure carries the ACFR's Original column or a variance")
    flagged = sum(1 for f in a["figures"] if f.get("flags"))
    print(f"     {flagged} figures flagged from known_issues.csv; {sum(1 for f in a['figures'] if 'printed' in f)} taken from another page "
          f"(acfr_substitutions.csv)")

    # Footing with the printed figures, from the JSON.
    fbad = 0
    by = defaultdict(dict)
    for f in a["figures"]:
        by[(f["year"], f["fund"])][(f["level"], f["line"])] = f.get("printed", f["v"])
    for (y, fund), figs in sorted(by.items()):
        rev, exp = figs.get(("fund_total", "Total revenues")), figs.get(("fund_total", "Total expenditures"))
        net = figs.get(("fund_total", "Net change in fund balances"))
        tr = sum(v for (lv, _), v in figs.items() if lv == "transfer")
        if None in (rev, exp, net) or abs(rev - exp + tr - net) > 0:
            fbad += 1
            print(f"FAIL {y} {fund}: revenue {rev} - expenditure {exp} + transfers {tr} != net change {net}")
        if fund == "General Fund":
            for lv, tot in (("revenue_source", rev), ("function", exp)):
                s_ = sum(v for (l, _), v in figs.items() if l == lv)
                if s_ != tot:
                    fbad += 1
                    print(f"FAIL {y} General Fund {lv} figures add to {s_:,}, total {tot:,}")
    bad += fbad
    print(f"{'ok  ' if not fbad else 'FAIL'} {len(by)} fund-years: net change = revenue - expenditure + transfers (printed figures); "
          f"General Fund sources and functions add to its totals")

    # The books' totals shown beside the actuals.
    bbad = 0
    want_b = {}
    for y in years:
        if y not in want_book:
            continue
        tot = defaultdict(float)
        for r in rows_by_doc[want_book[y]]:
            if int(r["fiscal_year"]) == y:
                tot[(r["fund"], "revenue" if r["side"] == "revenue" else "expense")] += amt(r["amount"])
        for sc in configs[y]["schedules"]:
            want_b[(y, sc["fund"])] = (want_book[y], round(sum(tot[(bf, "revenue")] for bf in sc["book_funds"])),
                                       round(sum(tot[(bf, "expense")] for bf in sc["book_funds"])))
    got_b = {(b["year"], b["fund"]): (docs[b["doc"]], b["revenue"], b["expense"]) for b in a["book"]}
    for k in sorted(set(want_b) | set(got_b)):
        if want_b.get(k) != got_b.get(k):
            bbad += 1
            print(f"FAIL book totals {k}: shown {got_b.get(k)}, csv {want_b.get(k)}")
    bad += bbad
    print(f"{'ok  ' if not bbad else 'FAIL'} {len(got_b)} book budget totals beside the actuals equal the CSV sums")

    # Every ACFR check over $5 is in known_issues.csv.
    norm = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
    vbad = nchecks = 0
    for y in years:
        vpath = PROCESSED / f"validation_acfr_{y}.csv"
        if not vpath.exists():
            vbad += 1
            print(f"FAIL {vpath.name} missing")
            continue
        for c in read(vpath):
            nchecks += 1
            if abs(float(c["diff"])) <= TOLERANCE:
                continue
            hit = [k for k in known if k["source_doc"] == c["source_doc"] and k["source_page"] == c["source_page"] and norm(k["label"]) == norm(c["label"])]
            print(f"{'DIFF' if hit else 'FAIL'} {y} p{c['source_page']:>4} {c['label']} [{c['column']}] printed {float(c['printed']):,.0f} "
                  f"computed {float(c['computed']):,.0f}  -> {'logged in known_issues.csv' if hit else 'NOT in known_issues.csv'}")
            vbad += not hit
    bad += vbad
    print(f"{'ok  ' if not vbad else 'FAIL'} {nchecks} ACFR checks (schedules, tie-outs to the books); every difference over ${TOLERANCE} is in known_issues.csv")

    ok = bool(budget.get("actuals_note"))
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} actuals_note has the site wording ({len(budget.get('actuals_note', []))} paragraphs)")

    # GAAP fund balances: a separate file, equal to the CSV.
    gbad = 0
    gpath, gjson = PROCESSED / "gaap_fund_balance_acfr.csv", WEB / "fund_balance_gaap.json"
    if gpath.exists():
        g = json.loads(gjson.read_text()) if gjson.exists() else {"rows": []}
        w = Counter((int(r["fiscal_year"]), r["group"], r["line"], int(r["amount"]), r["source_doc"], int(r["source_page"])) for r in read(gpath))
        h = Counter((r["year"], r["group"], r["line"], r["v"], r["doc"], r["p"]) for r in g["rows"])
        gbad += sum(((w - h) + (h - w)).values())
        for y in sorted({k[0] for k in w}):
            val = {(k[1], k[2]): k[3] for k in w if k[0] == y}
            if val[("General Fund", "Total general fund")] + val[("Other governmental funds", "Total all other governmental funds")] != \
                    val[("All governmental funds", "Total fund balances of all governmental funds")]:
                gbad += 1
                print(f"FAIL {y} GAAP fund balances: General Fund + other funds != total")
        gbad += "basis" not in g or "GAAP" not in g.get("basis", "") or any("fund_balance" in k for k in a)
        print(f"{'ok  ' if not gbad else 'FAIL'} fund_balance_gaap.json: {len(h)} GAAP fund balances equal the CSV and add up; kept out of the budgetary actuals")
    bad += gbad
    return bad


if __name__ == "__main__":
    raise SystemExit(main())
