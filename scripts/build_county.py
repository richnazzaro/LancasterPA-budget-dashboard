#!/usr/bin/env python3
"""County build: web/data/county/{budget,changes,conflicts}.json from data/processed/county/.

Run through `python3 scripts/build_dataset.py --entity county` (the City build is unchanged).

Figure rule (the County exception to the City's "one kind per year"): every year shows its **budget**,
measure "budget", taken from the **newest County book that prints that year**. Each County book prints
two budget columns (the prior year and its own year), so e.g. 2025 comes from the 2026 book's
"2025 BUDGET" column, not the 2025 book's own. Where an older book prints a different figure for the
same line and year, the newer book is still used and the difference goes to conflicts.json. Two
editions of one book year: an "adopted" edition wins, else the later file name (as for the City).

Lines are keyed by (fund, account_code, nth), because a department can print the same account in more
than one fund (A3100 Facilities Management appears in the General Fund and Funds Y and H).

Shapes follow the City JSON so web/app.js can reuse its code:
  accounts   [account_code, account_name, fund, department, bureau, category]
             revenue lines: category "Revenue" (what app.js tests) and bureau = the printed revenue
             category (Taxes, Intergovernmental, ...), as the City's bureau is its printed revenue group;
             expense lines: category = the printed category, bureau = the printed department name.
  series     "<year>|budget": a, v, p, doc, column ("budget"), funds, plus book_year.
  printed    every total the books print, for the columns shown, with page: department totals (level "section";
             in Other Funds with `dept_fund`, the fund whose lines the total closes), General Fund / Other Funds
             grand totals ("rollup"), and the by-account report's account rows ("account", with `account` and
             `name`) and account-group totals ("account_group", with `account_group` and `name`).
             Printed-totals rule (user, 2026-11-21): each printed figure in `values` is the displayed total for
             its grouping and year, never our sum. `flags` {key: {sum, gap (printed - sum), lines, allowance,
             known_issue, kind}} marks a gap larger than rounding: max($5, $0.50 x the lines summed). A
             rounding-only gap that known_issues.csv explains is linked in `notes` {key: known_issue}, not flagged.
             Our sums appear only where no printed total exists (e.g. per-fund totals in Other Funds), and
             the site labels those as calculated.
  org        County groups by department letter (A general government, B courts and row offices,
             C corrections, D human services) as `departments`, and each department code as a unit,
             from data/county/org_units.csv.
  changes    the newest year against the year before, line by line (changes.compare), with the account
             merges in data/county/account_changes.csv applied to both years so merged accounts are
             compared as their combined total. Each merged line is listed under `merges`.
No staffing.json: the County books print no positions.

General Fund balance (budget.json `reserve`, named "General Fund Balance"; build_fund_balance): the County's books print
no balance page, but each year's budget resolution (data/processed/county/resolutions_county.csv, from
extract_county_resolutions.py) prints the General Fund balance at the start of the year and the balance remaining at its
end. Those are the entries with measure "budget"; the audited year-end balances from the ACFRs
(gaap_fund_balance_acfr.csv) are separate entries with measure "actual". The two are never combined.

Actuals (measure "actual", 2023-2025): from the County's audited ACFRs, budgetary basis
(data/processed/county/actuals_acfr_<year>.csv, written by extract_county_acfr.py). They are not account lines,
so they sit in their own block, budget.json `actuals`, not in `series`:
  figures    one per shown figure: year, fund (B, E, F, G, Y; "Fund H+R+EI", which the ACFR reports as one fund;
             General Fund), level, section, line (as printed), v (actual, as printed: transfers out and deficits
             negative), final (the ACFR's final budget), doc (index into docs) and p (PDF page). Levels:
               fund_total      Total revenues, Total expenditures, Net change in fund balances, every fund;
               transfer        Transfers in / Transfers out lines, every fund that prints one;
               revenue_source  General Fund revenue by source;
               function        General Fund expenditure by function (heading "Debt service" for its two lines).
             The ACFR's Original column and its variances are never exported: for 2023 and 2024 its Original is not
             the adopted budget (data/county/known_issues.csv), and the budget shown is the books'.
             Every figure is shown as printed on its schedule page. A figure with a known issue carries `flags`:
             [{"known_issue": index into known_issues, "kind": its kind}]. A General Fund or special-fund total
             never maps to departments.
  book       the books' budget totals for the same year and fund (revenue, expense), from the book the series uses,
             for showing beside the actual totals. A special fund's book revenue includes transfers in.
  sources    each ACFR: doc index, file, path, URL, title.
`actuals_note` holds the site wording (docs/COUNTY_RESEARCH.md, "What the site should say").
fund_balance_gaap.json: the ACFRs' Table 3 fund balances (modified accrual, GAAP), kept apart from the budgetary rows.

Standard library only.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_dataset import Interner, parse_amount, read_csv, write_json
from changes import compare
from org_structure import slug

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed" / "county"
DATA = ROOT / "data" / "county"
OUT = ROOT / "web" / "data" / "county"
MEASURE = "budget"
REVENUE = "Revenue"  # the category app.js and changes.compare read as income
GROUPS_ORDER = "ABCD"
CHART_DOC, CHART_PAGE = "County-2026-Budget-Book.pdf", 30  # Class 2A county org chart
ACFR_CONFIG = ROOT / "config" / "county" / "acfr"
ACFR_PDF_DIR = "Budget PDFs - County/ACFR"
ACTUAL = "actual"
ACTUALS_NOTE = [
    "Actual figures come from the County's audited Annual Comprehensive Financial Report. They are reported by fund, "
    "revenue source and function, not by department or account line, so they appear next to budget totals and not next "
    "to line items.",
    "Actuals are on the County's budgetary (cash-like) basis, and include grant revenue and spending added after the "
    "budget was adopted (ARPA, ERAP, opioid funds). Actual revenue ran 10-15% above the adopted budget in 2023-2025, "
    "largely for that reason. Compare actual with the final budget in the ACFR, not only with the adopted budget.",
    "Behavioral Health, Developmental Services (Intellectual Disabilities) and Early Intervention are reported together.",
    "2026 has no actuals yet: the 2026 ACFR will be published around mid-2027.",
    "The budget books count transfers to other funds (the County match) as General Fund expenditure, and count them "
    "again as revenue of the receiving special funds. The ACFR reports transfers separately from revenue and "
    "expenditure, so compare a book's total with the actual total plus transfers.",
    "The budget shown is the County's adopted budget from its budget books. The ACFR's own 'original budget' column is "
    "not used: for 2023 and 2024 it does not match the adopted budget.",
]
FUND_ORDER = ["General Fund", "Fund B", "Fund E", "Fund F", "Fund G", "Fund H+R+EI", "Fund Y"]


def file_year(doc: str) -> int | None:
    m = re.search(r"20\d\d", doc)
    return int(m.group()) if m else None


def load_books(processed: Path) -> dict:
    books = {}
    for path in sorted(processed.glob("budget_long_*.csv")):
        rows = read_csv(path)
        for doc in sorted({r["source_doc"] for r in rows}):
            doc_rows = [r for r in rows if r["source_doc"] == doc]
            years = sorted({int(r["fiscal_year"]) for r in doc_rows})
            books[doc] = {"doc": doc, "csv": path.name, "stem": path.name[len("budget_long_"):-len(".csv")],
                          "rows": doc_rows, "years": years, "year": max(years)}
    return books


def designate(books: dict, conflicts: list) -> tuple[list, dict]:
    """(live books, {fiscal year: book}) under the newest-book-that-prints-it rule."""
    by_year = defaultdict(list)
    for b in books.values():
        by_year[b["year"]].append(b)
    live = []
    for year, group in sorted(by_year.items()):
        group.sort(key=lambda b: ("adopt" in b["doc"].lower(), b["doc"]))
        live.append(group[-1])
        if len(group) > 1:
            conflicts.append({"kind": "duplicate_book", "book_year": year, "used": group[-1]["doc"],
                              "ignored": [b["doc"] for b in group[:-1]]})
    fig_book = {}
    for fy in sorted({y for b in live for y in b["years"]}):
        fig_book[fy] = max((b for b in live if fy in b["years"]), key=lambda b: b["year"])
    return live, fig_book


def lines_of(book: dict, fy: int) -> dict:
    """{(fund, account_code, nth): row} for one book's column of one year, zero lines included."""
    out, seen = {}, defaultdict(int)
    for r in book["rows"]:
        if int(r["fiscal_year"]) != fy or r["doc_type"] != MEASURE:
            continue
        k = (r["fund"], r["account_code"])
        out[(*k, seen[k])] = r
        seen[k] += 1
    return out


def account_tuple(r: dict, funds, depts, bureaus, cats) -> tuple:
    rev = r["side"] == "revenue"
    return (r["account_code"], r["account_name"], funds(r["fund"]), depts(r["department"]),
            bureaus(r["category"] if rev else r["department"]), cats(REVENUE if rev else r["category"]))


def load_account_changes(books: dict) -> list[dict]:
    path = DATA / "account_changes.csv"
    rules = []
    for r in (read_csv(path) if path.exists() else []):
        doc = r["first_book"]
        year = books[doc]["year"] if doc in books else file_year(doc)
        scope = r["department_scope"].strip()
        rules.append({"first_book": doc, "year": year,
                      "departments": None if scope in ("", "all") else set(scope.split(";")),
                      "from": [a.strip() for a in r["from_accounts"].split(";") if a.strip()],
                      "to": r["to_account"].strip(), "to_name": r["to_name"].strip(), "evidence": r["evidence"].strip()})
    return rules


class Lines:
    """A shown series (or its merged view) as changes.compare expects: .key, .lines, .get()."""

    def __init__(self, key: str, lines: dict):
        self.key, self.lines = key, lines

    def get(self, k):
        return self.lines.get(k)


def merged_views(frm: dict, to: dict, rules: list, accounts, acc_items: list) -> tuple[dict, dict, list]:
    """Fold merged accounts into their target account in both years. frm/to: {(fund, code, nth): (a, v, d, p)}.
    Returns the two merged views and the list of merged lines (with every component)."""
    def target(k):
        fund, code, nth = k
        dept, acct = code.split("-", 1)
        for i, rule in enumerate(rules):
            if acct in rule["from"] and (rule["departments"] is None or dept in rule["departments"]):
                return (fund, f"{dept}-{rule['to']}", 0), i
        return k, None

    groups = {}
    for side, view in (("f", frm), ("t", to)):
        for k, e in view.items():
            tk, ri = target(k)
            g = groups.setdefault(tk, {"f": [], "t": [], "rules": set()})
            g[side].append((k, e))
            if ri is not None:
                g["rules"].add(ri)

    out = {"f": {}, "t": {}}
    merges = []
    for tk, g in sorted(groups.items()):
        if not g["rules"]:
            for side in ("f", "t"):
                for k, e in g[side]:
                    out[side][k] = e
            continue
        own = next((e for side in ("t", "f") for k, e in g[side] if k == tk), None)
        if own is not None:
            a = own[0]
        else:  # only merged-away accounts carry money: name the line after the target account
            base = acc_items[g["f"][0][1][0] if g["f"] else g["t"][0][1][0]]
            rule = rules[min(g["rules"])]
            a = accounts((tk[1], rule["to_name"], *base[2:]))
        entry = {}
        for side in ("f", "t"):
            comps = sorted(g[side], key=lambda c: (c[0] != tk, c[0]))
            if comps:
                d = comps[0][1][2]
                entry[side] = [list(c[1]) for c in comps]
                out[side][tk] = (a, sum(c[1][1] for c in comps), d, min(c[1][3] for c in comps if c[1][2] == d))
        merges.append({"a": a, "fund": acc_items[a][2], "code": tk[1], "rules": sorted(g["rules"]),
                       "f": entry.get("f", []), "t": entry.get("t", [])})
    return out["f"], out["t"], merges


def build_org(shown_codes: set, printed_names: dict) -> dict:
    """Groups (by department letter) and departments from data/county/org_units.csv. A department code
    the file does not list (e.g. from a newly added book) is placed in its letter's group under its printed
    name and listed in `unlisted`, so a new book never stops the build."""
    rows = read_csv(DATA / "org_units.csv")
    letters = sorted({r["group_letter"] for r in rows} | {c[0] for c in shown_codes}, key=lambda x: (GROUPS_ORDER.find(x), x))
    group_name = {r["group_letter"]: r["group"] for r in rows}
    depts = [{"name": group_name.get(L, f"Departments {L}"), "slug": slug(group_name.get(L, f"departments {L}")),
              "letter": L, "aliases": [], "chart_page": None, "desc": [], "bureaus": True} for L in letters]
    units, codes = [], {}
    errors = []
    for r in rows:
        c = r["department_code"]
        if c in codes:
            errors.append(f"org_units.csv: {c} listed twice")
            continue
        if c[0] != r["group_letter"]:
            errors.append(f"org_units.csv: {c} is in group {r['group_letter']}, not its letter {c[0]}")
        codes[c] = len(units)
        units.append({"name": r["department"], "slug": slug(r["department"]), "dept": letters.index(r["group_letter"]),
                      "kind": "bureau", "division": r["book_section"], "chart_page": None, "desc": [], "code": c,
                      "page": int(r["department_page"]), "section_page": int(r["section_page"]), "doc": r["source_doc"]})
    unlisted = sorted(shown_codes - set(codes))
    for c in unlisted:
        print(f"note: department {c} ({printed_names.get(c, '?')}) is not in data/county/org_units.csv; "
              f"placed in group {c[0]} under its printed name", file=sys.stderr)
        codes[c] = len(units)
        units.append({"name": printed_names.get(c, c), "slug": slug(printed_names.get(c, c)), "dept": letters.index(c[0]),
                      "kind": "bureau", "division": "", "chart_page": None, "desc": [], "code": c})
    for i in range(len(depts)):
        mine = [u["slug"] for u in units if u["dept"] == i]
        if len(set(mine)) != len(mine):
            errors.append(f"org_units.csv: duplicate department slugs in group {depts[i]['name']}")
    if errors:
        sys.exit("County org errors:\n  " + "\n  ".join(errors))
    return {"chart_doc": CHART_DOC, "chart_page": CHART_PAGE, "desc_doc": None, "departments": depts,
            "units": units, "codes": dict(sorted(codes.items())), "unlisted": unlisted}


def closing_fund(book: dict, fy: int, department: str, side: str, page: int) -> str | None:
    """The Other Funds fund whose lines for this department end closest before the printed total's page."""
    last = defaultdict(int)
    for r in book["rows"]:
        if (int(r["fiscal_year"]) == fy and r["section"] == "Other Funds" and r["department"] == department
                and r["side"] == side and int(r["source_page"]) <= page):
            last[r["fund"]] = max(last[r["fund"]], int(r["source_page"]))
    return max(last, key=lambda f: (last[f], f)) if last else None


ACCOUNT_RE = re.compile(r"(General Fund|Other Funds) (revenue|expense) account (?:(\d{4})|group (\d\d) total)")
ROUNDING_CELL, ROUNDING_PER_LINE = 5, 0.5  # the printed-totals rule: rounding is at most $5 a cell or $0.50 a line summed


def printed_totals(processed: Path, live: list, fig_book: dict, docs, shown: set) -> list:
    """Every total each book prints, for the columns shown: department totals (level "section"), General Fund /
    Other Funds grand totals ("rollup"), and the by-account report's account rows ("account") and account-group
    totals ("account_group"). The printed figure is the displayed total for that grouping and year."""
    out = []
    for book in live:
        path = processed / f"validation_{book['stem']}.csv"
        if not path.exists():
            continue
        items = {}
        for r in read_csv(path):
            level = {"department total": "section", "grand total vs departments": "rollup"}.get(r["check"])
            am = ACCOUNT_RE.fullmatch(r["label"]) if r["check"] == "by-account report" else None
            if am:
                level = "account" if am.group(3) else "account_group"
            m = re.fullmatch(r"budget_(\d{4})", r["column"])
            if not level or not m or parse_amount(r["printed"]) is None:
                continue
            fy = int(m.group(1))
            key = f"{fy}|{MEASURE}"
            if fig_book.get(fy) is not book or key not in shown:
                continue
            item = items.setdefault((level, r["label"], r["source_page"]), {
                "level": level, "label": r["label"], "page": int(r["source_page"]), "doc": docs(book["doc"]),
                "values": {}, "passed": True})
            item["values"][key] = parse_amount(r["printed"])
            item["passed"] &= r["passed"] == "True"
            if am:
                item["group"], item["kind"] = am.group(1), am.group(2)
                if am.group(3):
                    item["account"] = am.group(3)
                else:
                    item["account_group"] = am.group(4)
                continue
            lm = re.fullmatch(r"(General Fund|Other Funds) (revenue|expense)(?:: (.+))?", r["label"])
            if lm:
                item["group"], item["kind"] = lm.group(1), lm.group(2)
                if lm.group(3):
                    item["department"] = lm.group(3)
                    if lm.group(1) == "Other Funds":  # a department can print a total in each fund it spends from
                        item["dept_fund"] = closing_fund(book, fy, lm.group(3), lm.group(2), int(r["source_page"]))
                elif lm.group(1) == "General Fund":
                    item["fund"] = "General Fund"
        out.extend(items.values())
    return out


def members(item: dict, r: dict) -> bool:
    """Whether a budget_long row is one of the lines a printed total adds up."""
    side = "revenue" if r["side"] == "revenue" else "expense"
    if side != item.get("kind") or r["section"] != item.get("group"):
        return False
    if "department" in item:
        return r["department"] == item["department"] and ("dept_fund" not in item or r["fund"] == item["dept_fund"])
    if "account" in item:
        return r["account"] == item["account"]
    if "account_group" in item:
        return r["account"][:2] == item["account_group"]
    return True  # a General Fund / Other Funds grand total


def flag_printed(printed: list, fig_book: dict, known: list, docs) -> None:
    """Under the printed-totals rule the printed figure is shown. A flag is added only where the lines differ from
    it by more than rounding can explain: max($5, $0.50 x the lines summed). Rounding-only gaps that known_issues.csv
    explains are linked as `notes` (not flags). Each item also gets `name` for account rows and groups."""
    norm = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
    for item in printed:
        doc = docs.items[item["doc"]]
        ki = next((i for i, k in enumerate(known) if k["source_doc"] == doc and int(k["source_page"] or 0) == item["page"]
                   and norm(k["label"]) == norm(item["label"])), None)
        for key, pv in item["values"].items():
            fy = int(key.split("|")[0])
            rows = [r for r in fig_book[fy]["rows"] if int(r["fiscal_year"]) == fy and r["doc_type"] == MEASURE and members(item, r)]
            vals = [parse_amount(r["amount"]) or 0 for r in rows]
            total, n = sum(vals), sum(1 for x in vals if x)
            if "account" in item or "account_group" in item:
                # name from the book's lines in either of its years (an account can print 0 in the year shown)
                names = [r["account_name"] if "account" in item else r["category"] for r in fig_book[fy]["rows"]
                         if r["doc_type"] == MEASURE and members(item, r)]
                if names and "name" not in item:
                    item["name"] = max(sorted(set(names)), key=names.count)  # sorted: a tie must not depend on the hash seed
            gap = round(pv - total, 2)
            allowance = max(ROUNDING_CELL, ROUNDING_PER_LINE * n)
            if abs(gap) > allowance:
                item.setdefault("flags", {})[key] = {"sum": total, "gap": gap, "lines": n, "allowance": allowance,
                                                     "known_issue": ki, "kind": known[ki].get("kind", "") if ki is not None else None}
            elif ki is not None and gap:
                item.setdefault("notes", {})[key] = ki


def actual_level(r: dict) -> str | None:
    """The level an ACFR schedule row is shown at, or None when it is not shown."""
    if r["row_type"] == "line" and r["section"] == "transfer":
        return "transfer"
    if r["row_type"] in ("total", "net_change") and r["section"] in ("revenue", "expenditure", "net_change"):
        return "fund_total"
    if r["row_type"] == "line" and r["fund"] == "General Fund":
        return {"revenue": "revenue_source", "expenditure": "function"}.get(r["section"])
    return None


def build_actuals(processed: Path, docs, known: list, fig_book: dict) -> dict | None:
    configs = {int(p.stem): json.loads(p.read_text()) for p in sorted(ACFR_CONFIG.glob("*.json"))}
    years = [y for y in sorted(configs) if (processed / f"actuals_acfr_{y}.csv").exists()]
    if not years:
        return None
    flag_of = defaultdict(list)
    for i, k in enumerate(known):
        flag_of[(k["source_doc"], int(k["source_page"] or 0), k["label"])].append(i)
    figures, sources, book = [], [], []
    for y in years:
        cfg = configs[y]
        d = docs(cfg["source_doc"])
        sources.append({"year": y, "doc": d, "file": cfg["source_doc"], "path": f"{ACFR_PDF_DIR}/{cfg['source_doc']}",
                        "url": cfg["url"], "title": cfg["title"]})
        rows = read_csv(processed / f"actuals_acfr_{y}.csv")
        for r in sorted(rows, key=lambda r: FUND_ORDER.index(r["fund"])):  # stable: printed order within a fund
            level = actual_level(r)
            if level is None:
                continue
            f = {"year": y, "fund": r["fund"], "level": level, "section": r["section"], "line": r["line"],
                 "v": int(r["actual"]), "final": int(r["final"]) if r["final"] != "" else None,
                 "doc": d, "p": int(r["source_page"])}
            if r["heading"]:
                f["heading"] = r["heading"]
            # Known issues about this figure: same page, label "<year> <fund> <line>" (or that followed by more words).
            me = f"{y} {r['fund']} {r['line']}"
            flags = sorted(i for (doc, page, label), ids in flag_of.items() for i in ids
                           if doc == cfg["source_doc"] and page == int(r["source_page"]) and (label == me or label.startswith(me + " ")))
            if flags:
                f["flags"] = [{"known_issue": i, "kind": known[i].get("kind", "")} for i in flags]
            figures.append(f)
        # The books' totals for the same year and fund, from the book the budget series uses.
        b = fig_book.get(y)
        if b:
            tot = defaultdict(float)
            for r in b["rows"]:
                if int(r["fiscal_year"]) == y and r["doc_type"] == MEASURE:
                    tot[(r["fund"], "revenue" if r["side"] == "revenue" else "expense")] += parse_amount(r["amount"]) or 0
            for sched in cfg["schedules"]:
                book.append({"year": y, "fund": sched["fund"], "book_funds": sched["book_funds"], "doc": docs(b["doc"]),
                             "revenue": round(sum(tot[(bf, "revenue")] for bf in sched["book_funds"])),
                             "expense": round(sum(tot[(bf, "expense")] for bf in sched["book_funds"]))})
    funds = []
    for name in FUND_ORDER:
        sched = next((s for c in configs.values() for s in c["schedules"] if s["fund"] == name), None)
        if sched:
            funds.append({"fund": name, "acfr_fund": sched["acfr_fund"], "book_funds": sched["book_funds"]})
    return {"measure": ACTUAL, "basis": "budgetary", "years": years,
            "levels": ["fund_total", "transfer", "revenue_source", "function"],
            "sign": "as printed: transfers out and deficits are negative",
            "funds": funds, "sources": sources, "figures": figures, "book": book}


def build_gaap_fund_balance(processed: Path) -> dict | None:
    path = processed / "gaap_fund_balance_acfr.csv"
    if not path.exists():
        return None
    configs = {json.loads(p.read_text())["source_doc"]: json.loads(p.read_text()) for p in sorted(ACFR_CONFIG.glob("*.json"))}
    rows = read_csv(path)
    return {"basis": "modified accrual (GAAP)",
            "note": "Fund balances at December 31 from the ACFR's statistical section (Table 3, Fund Balances of Governmental "
                    "Funds), on the GAAP (modified accrual) basis. They are not on the budgetary basis of the actuals in "
                    "budget.json and are not comparable with budget figures.",
            "sources": [{"file": d, "path": f"{ACFR_PDF_DIR}/{d}", "url": configs[d]["url"]} for d in sorted({r["source_doc"] for r in rows})],
            "rows": [{"year": int(r["fiscal_year"]), "group": r["group"], "line": r["line"], "v": int(r["amount"]),
                      "doc": r["source_doc"], "p": int(r["source_page"])} for r in rows]}


RESOLUTION_CONFIG = ROOT / "config" / "county" / "resolutions"
RESOLUTION_PDF_DIR = "Budget PDFs - County/Resolutions"
BALANCE_NAME = "General Fund Balance"
# Resolution rows shown on the balance page, in order, as City-style reserve lines (t). Expenditures and commitments are
# negative, as on the City's Fund Balance Projection.
BALANCE_ROLES = [("fb_start", "beginning", 1), ("encumbrances", "encumbrances", 1), ("receipts_total", "revenues", 1),
                 ("exp_total", "expenditures", -1), ("commitments", "commitments", -1), ("fb_end", "ending", 1)]


def build_fund_balance(processed: Path, docs, known: list) -> dict | None:
    """The County's General Fund balance view (budget.json `reserve`, as the City's Reserve Fund).

    Two measures, never mixed:
      budget  one entry per budget resolution (resolutions_county.csv, General Fund column): balance at the start of the
              year, receipts, expenditures (and the 2024 resolution's encumbrances and commitments), balance remaining,
              all as printed, plus the planned change (receipts - expenditures), which is calculated (`calc`).
      actual  one entry per ACFR year (gaap_fund_balance_acfr.csv): the audited General Fund balance at December 31 and
              its unassigned part, GAAP (modified accrual).
    The resolution balances are budget-basis estimates and do not tie to the audited year-ends; the page says so."""
    rpath, gpath = processed / "resolutions_county.csv", processed / "gaap_fund_balance_acfr.csv"
    if not rpath.exists():
        return None
    cfgs = {json.loads(p.read_text())["source_doc"]: json.loads(p.read_text()) for p in sorted(RESOLUTION_CONFIG.glob("*.json"))}
    rows = read_csv(rpath)
    entries, sources = [], []
    for doc in sorted({r["source_doc"] for r in rows}, key=lambda d: cfgs[d]["budget_year"]):
        cfg, d = cfgs[doc], docs(doc)
        mine = [r for r in rows if r["source_doc"] == doc]
        gf = {r["role"]: r for r in mine if r["column"] == "general_fund"}
        fy = cfg["budget_year"]
        lines = []
        for role, t, sign in BALANCE_ROLES:
            r = gf.get(role)
            if not r:
                continue
            ln = {"t": t, "l": r["line"], "v": sign * int(r["amount"]), "p": int(r["source_page"])}
            if r["as_of"]:
                ln["as_of"] = r["as_of"]
                ln["fy"] = int(r["as_of"][:4])
            ki = [i for i, k in enumerate(known) if k["source_doc"] == doc and k["label"] == r["line"]]
            if ki:
                ln["known_issue"] = ki[0]
            lines.append(ln)
        change = int(gf["receipts_total"]["amount"]) - int(gf["exp_total"]["amount"])
        lines.insert(next(i for i, l in enumerate(lines) if l["t"] == "ending"),
                     {"t": "surplus", "l": "Receipts minus expenditures", "v": change, "calc": True})
        notes = [{"l": r["line"], "v": int(r["amount"]), "p": int(r["source_page"])}
                 for r in mine if r["role"] == "footnote" and r["amount"]]
        entries.append({"year": fy, "measure": MEASURE, "doc": d, "basis": "budget", "resolution": cfg["resolution"],
                        "lines": lines, "footnotes": notes})
        sources.append({"doc": d, "file": doc, "path": f"{RESOLUTION_PDF_DIR}/{doc}", "url": cfg["url"],
                        "title": cfg["title"], "resolution": cfg["resolution"], "budget_year": fy})
    if gpath.exists():
        for r in read_csv(gpath):
            if r["group"] != "General Fund":
                continue
            y = int(r["fiscal_year"])
            e = next((x for x in entries if x["year"] == y and x["measure"] == ACTUAL), None)
            if not e:
                e = {"year": y, "measure": ACTUAL, "doc": docs(r["source_doc"]), "basis": "audited", "lines": []}
                entries.append(e)
            e["lines"].append({"t": "ending" if r["line"] == "Total general fund" else slug(r["line"]).replace("-", "_"),
                               "l": r["line"], "v": int(r["amount"]), "p": int(r["source_page"]), "fy": y,
                               "as_of": f"{y}-12-31"})
    entries.sort(key=lambda e: (e["year"], e["measure"] != ACTUAL))
    return {"name": BALANCE_NAME, "entity": "county", "measures": [ACTUAL, MEASURE],
            "basis": {MEASURE: "budget resolution (budget basis, estimated)", ACTUAL: "audited, GAAP (modified accrual)"},
            "sources": sources, "entries": entries}


def build(processed: Path = PROCESSED, out: Path = OUT) -> dict:
    books = load_books(processed)
    if not books:
        sys.exit(f"No budget_long_*.csv files in {processed}")
    conflicts: list[dict] = []
    live, fig_book = designate(books, conflicts)
    newest = max(fig_book)
    rules = load_account_changes(books)

    docs, funds, depts, bureaus, cats, accounts = (Interner() for _ in range(6))
    series, views = {}, {}
    for fy, book in sorted(fig_book.items()):
        key = f"{fy}|{MEASURE}"
        s = {"a": [], "v": [], "p": []}
        covered, view = set(), {}
        d = docs(book["doc"])
        for k, r in sorted(lines_of(book, fy).items(), key=lambda kv: (kv[1]["section"] != "General Fund", kv[0])):
            covered.add(funds(r["fund"]))
            amount = parse_amount(r["amount"])
            if not amount:
                continue  # zero lines add size without adding information (as for the City)
            a = accounts(account_tuple(r, funds, depts, bureaus, cats))
            s["a"].append(a)
            s["v"].append(amount)
            s["p"].append(int(r["source_page"]))
            view[k] = (a, amount, d, int(r["source_page"]))
        series[key] = {"year": fy, "measure": MEASURE, "funds": sorted(covered), "a": s["a"], "v": s["v"], "p": s["p"],
                       "doc": d, "column": MEASURE, "book_year": book["year"]}
        views[key] = view
        # Older books that print the same year: every line where they disagree.
        mine = lines_of(book, fy)
        for other in live:
            if other is book or fy not in other["years"]:
                continue
            theirs = lines_of(other, fy)
            for k in sorted(set(mine) | set(theirs)):
                u, o = mine.get(k), theirs.get(k)
                uv, ov = (parse_amount(u["amount"]) or 0) if u else 0, (parse_amount(o["amount"]) or 0) if o else 0
                if uv == ov:
                    continue
                acct = k[1].split("-", 1)[1]
                c = {"kind": "value", "account_code": k[1], "fund": k[0], "fiscal_year": fy, "measure": MEASURE,
                     "account_name": (u or o)["account_name"], "used": uv, "used_doc": book["doc"],
                     "used_page": int(u["source_page"]) if u else None, "other": ov, "other_doc": other["doc"],
                     "other_page": int(o["source_page"]) if o else None, "other_column": MEASURE}
                why = [i for i, rule in enumerate(rules) if rule["first_book"] == book["doc"] and (acct in rule["from"] or acct == rule["to"])]
                if why:
                    c["account_change"] = why
                conflicts.append(c)

    printed_names = {}
    for b in live:
        for r in b["rows"]:
            printed_names[r["department_code"]] = r["department"]  # live is oldest first: the newest name wins
    shown_codes = {accounts.items[a][0].split("-")[0] for s in series.values() for a in s["a"]}
    org = build_org(shown_codes, printed_names)

    printed = printed_totals(processed, live, fig_book, docs, set(series))
    kpath = DATA / "known_issues.csv"
    known = read_csv(kpath) if kpath.exists() else []
    flag_printed(printed, fig_book, known, docs)

    # What changed: newest year against the year before, with account merges folded in.
    comparisons, merge_rules = {}, []
    to_key, from_key = f"{newest}|{MEASURE}", f"{newest - 1}|{MEASURE}"
    if from_key in views:
        applied = [r for r in rules if r["year"] is not None and newest - 1 < r["year"] <= newest]
        merge_rules = [{"from": r["from"], "to": r["to"], "to_name": r["to_name"], "departments": sorted(r["departments"] or []) or "all",
                        "first_book": r["first_book"], "evidence": r["evidence"]} for r in applied]
        f_view, t_view, merges = merged_views(views[from_key], views[to_key], applied, accounts, accounts.items)
        cid = f"{to_key}~{from_key}"
        ctx = {"id": cid, "from_label": f"{newest - 1} Budget", "to_label": f"{newest} Budget"}
        view_budget = {"accounts": accounts.items, "categories": cats.items, "funds": funds.items, "org": org, "printed": printed}
        comp = {"to": to_key, "from": from_key, "same_kind": True}
        comp |= compare(view_budget, Lines(from_key, f_view), Lines(to_key, t_view), ctx)
        where = {ln[0]: i for i, ln in enumerate(comp["lines"])}
        for m in merges:
            m["line"] = where.get(m.pop("a"))
        comp["merges"] = merges
        comparisons[cid] = comp

    for b in live:
        docs(b["doc"])
    used = {b["doc"] for b in fig_book.values()}
    actuals = build_actuals(processed, docs, known, fig_book)
    reserve = build_fund_balance(processed, docs, known)
    budget = {
        "entity": "county",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "newest_year": newest,
        "measures": [MEASURE] + ([ACTUAL] if actuals else []),
        "rule": {MEASURE: {"book": "newest book that prints the year", "columns": [MEASURE]},
                 **({ACTUAL: {"source": "County ACFR, budget-vs-actual schedules (budgetary basis)", "years": actuals["years"],
                              "block": "actuals"}} if actuals else {})},
        "books": [{"doc": b["doc"], "year": b["year"], "years": b["years"], "csv": b["csv"], "used": b["doc"] in used,
                   "figures": [fy for fy, fb in sorted(fig_book.items()) if fb is b]} for b in live],
        "docs": docs.items,
        "funds": funds.items,
        "departments": depts.items,
        "bureaus": bureaus.items,
        "categories": cats.items,
        # [account_code, account_name, fund, department, bureau, category]
        "accounts": [list(a) for a in accounts.items],
        "series": dict(sorted(series.items())),
        "printed": printed,
        "known_issues": known,
        "missing_bureaus": {},
        "reserve": reserve,
        "conflict_count": len(conflicts),
        "org": org,
        "actuals": actuals,
        "actuals_note": ACTUALS_NOTE if actuals else [],
    }
    changes = {
        "year": newest,
        "default": next(iter(comparisons), None),
        "note": "Indexes: account -> budget.json accounts; d -> budget.json docs; unit -> budget.json org.units "
                "(County departments); dept -> org.departments (groups by department letter); cat -> categories; "
                "by_group key -> bureaus (printed revenue category). merges: lines compared as the combined total of "
                "accounts the County merged (account_changes), with each component [account, v, d, p] per year.",
        "account_changes": merge_rules,
        "comparisons": comparisons,
        "shifts": [],
        "policy": [],
    }
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "budget.json", budget)
    write_json(out / "conflicts.json", conflicts)
    write_json(out / "changes.json", changes)
    gaap = build_gaap_fund_balance(processed)
    if gaap:
        write_json(out / "fund_balance_gaap.json", gaap)
    return budget


def report(budget: dict, out: Path) -> None:
    print("County books: " + ", ".join(f"{b['doc']} (prints {', '.join(map(str, b['years']))}; used for "
                                       f"{', '.join(map(str, b['figures'])) or 'nothing'})" for b in budget["books"]))
    for key, s in budget["series"].items():
        print(f"  {key:12s} {len(s['a']):4d} lines  total {sum(s['v']):>14,}  from {budget['docs'][s['doc']]}")
    if budget["org"]["unlisted"]:
        print(f"  departments not in org_units.csv: {', '.join(budget['org']['unlisted'])}")
    a = budget.get("actuals")
    if a:
        for y in a["years"]:
            figs = [f for f in a["figures"] if f["year"] == y]
            gf = {f["line"]: f["v"] for f in figs if f["fund"] == "General Fund" and f["level"] == "fund_total"}
            print(f"  {y}|actual  {len(figs):4d} figures  General Fund revenue {gf.get('Total revenues', 0):>14,}  "
                  f"expenditure {gf.get('Total expenditures', 0):>14,}  from {budget['docs'][figs[0]['doc']] if figs else '-'}")
    r = budget.get("reserve")
    if r:
        for e in r["entries"]:
            end = next(l for l in e["lines"] if l["t"] == "ending")
            print(f"  {e['year']}|{e['measure']:6s} {r['name']}: year-end {end['v']:>12,}  from {budget['docs'][e['doc']]}")
    print(f"Conflicts: {budget['conflict_count']} ({out / 'conflicts.json'})")
    for name in ("budget.json", "conflicts.json", "changes.json", "fund_balance_gaap.json"):
        if (out / name).exists():
            print(f"  {name}: {(out / name).stat().st_size:,} bytes")
