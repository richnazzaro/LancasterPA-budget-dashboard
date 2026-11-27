#!/usr/bin/env python3
"""Build the dashboard's JSON from every data/processed/budget_long_*.csv.

Which figure is shown (the project's selection rule): ONE main kind of figure per year.
  * Newest year (the newest book's own year): "proposed" (the original proposal)
    and "revised" (proposed_revised), when the book has them.
  * Any earlier year with an audited actual in the book two years later: "actual" only.
  * The year before the newest, which has no actual yet: "projected" only, from
    the next book (projected_revised preferred).
  The main kind is what the multi-year charts and tables draw.
Plus ONE budget figure per year (owner, 2026-11-27), selectable in Budget year / Compare with but never
drawn on the charts: "amended" when the next book prints an amended column for the year, otherwise
"adopted" (never both). Decided from the data (BUDGET_MEASURES), not by year.
  * Year-to-date columns and older books' own-year proposals are never shown.

Figures are copied exactly as extracted: nothing is rounded, filled or adjusted.
When a non-designated book carries the same account/year/measure with a
different value, the designated book still wins and the disagreement is listed
in web/data/conflicts.json.

Projections (the City's multi-year projections book, doc_type "projection", data/processed/budget_long_<book>.csv
from scripts/extract_projections.py): kept out of `series`, so they are never a selectable year and never feed the
headline, What changed or the one-kind-per-year rule. Only years after the newest year are used. They go in their own
`projection` block: one series per year ("<year>|projection", same shape as `series`, same accounts table), the
book's printed section and fund totals (same shape as `printed`), its printed Surplus/(Deficit) per fund, and the
assumptions page (data/processed/projection_assumptions_<book>.csv). The site draws them after the last year of each
multi-year chart and table, marked as projections.

Reserve Fund (the General Fund balance projection, data/processed/fund_balance_<book>.csv) follows
the same one-kind-per-year rule: actual year-end balance for each year up to two years before the
newest (the opening balance printed in the book two years later), projected for the year before the
newest, and proposed and revised for the newest year. When the newest book prints two columns that
disagree on the same opening balance, the revised column is used and both figures are kept.

Outputs (web/data/):
  budget.json     dimension tables + one column-oriented series per (year, measure)
                  + an `org` block: 2027 org-chart departments/bureaus, org code -> unit,
                  and description text with source pages (scripts/org_structure.py)
  staffing.json   positions per book (Staff section; newest book: proposed and revised)
  conflicts.json  disagreements between overlapping books
  changes.json    "What changed" in the newest year (scripts/changes.py): line-level comparisons,
                  totals by fund, category, department and bureau, shifts between funds found in the
                  city's line notes, position counts per bureau (raw and adjusted), tax-policy notes
                  (data/policy_notes.csv)

Standard library only, so GitHub Actions can run it with no installs.
Usage: python3 scripts/build_dataset.py [--entity city|county] [--processed DIR] [--out DIR]
  --entity county builds web/data/county/ from data/processed/county/ (see scripts/build_county.py).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import income_rules
import tax_limit

from changes import build_changes
from org_structure import build_org

ROOT = Path(__file__).resolve().parent.parent
MEASURES = ["actual", "projected", "proposed", "revised", "amended", "adopted"]
PROJECTION = "projection"  # doc_type of the multi-year projections book; never a measure in `series`
PROPOSED_MEASURES = {"proposed", "revised"}  # shown only for the newest year
# measure -> (book offset from the figure's fiscal year, source columns in preference order)
RULE = {
    "proposed": (0, ["proposed"]),
    "revised": (0, ["proposed_revised"]),
    "projected": (1, ["projected_revised", "projected"]),
    "actual": (2, ["actual"]),
    "amended": (1, ["amended"]),
    "adopted": (1, ["adopted"]),
}
# The year's budget figure, in preference order: Amended where the book prints it, else Adopted (one per year).
BUDGET_MEASURES = ["amended", "adopted"]
COLUMN_TO_MEASURE = {c: m for m, (_, cols) in RULE.items() for c in cols}
FUND_ALIASES = {  # words used in printed roll-up labels -> fund names in the CSVs
    "general fund": "General Fund",
    "stormwater": "Stormwater Management Fund",
    "wastewater": "Sewer Fund",
    "sewer": "Sewer Fund",
    "water fund": "Water Fund",
    "water": "Water Fund",  # after stormwater and wastewater, so only plain "Water ..." labels reach it
    "solid waste": "Solid Waste & Recycling Fund",
    "long's park": "Long's Park Fund",
    "longs park": "Long's Park Fund",
    "liquid fuels": "Liquid Fuels Fund",
}


class Interner:
    """Maps repeated strings to small integers so the JSON stays compact."""

    def __init__(self):
        self.items: list = []
        self.index: dict = {}

    def __call__(self, value):
        if value not in self.index:
            self.index[value] = len(self.items)
            self.items.append(value)
        return self.index[value]


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def parse_amount(text: str):
    text = (text or "").strip()
    if text == "":
        return None
    value = float(text)
    return int(value) if value.is_integer() else value


def book_year(doc: str, rows: list[dict]) -> int:
    """The book's own year: its proposed column, else the year in the file name."""
    years = {int(r["fiscal_year"]) for r in rows if r["doc_type"].startswith("proposed")}
    if len(years) == 1:
        return years.pop()
    m = re.search(r"20\d\d", doc)
    if m:
        return int(m.group())
    return max(int(r["fiscal_year"]) for r in rows)


def load_books(processed: Path, projections: dict | None = None) -> dict:
    """Group every budget_long row by its source document. Rows of a projections book (doc_type
    "projection") are not a budget book: they go to `projections` (doc -> {doc, csv, stem, rows}) instead."""
    books: dict[str, dict] = {}
    for path in sorted(processed.glob("budget_long_*.csv")):
        rows = read_csv(path)
        proj = [r for r in rows if r["doc_type"] == PROJECTION]
        if proj and len(proj) != len(rows):
            sys.exit(f"{path.name} mixes projection rows with budget columns")
        if proj:
            if projections is not None:
                for doc in sorted({r["source_doc"] for r in proj}):
                    projections[doc] = {"doc": doc, "csv": path.name, "rows": [r for r in proj if r["source_doc"] == doc],
                                        "stem": path.name[len("budget_long_"):-len(".csv")]}
            continue
        if not rows:
            continue
        for doc in sorted({r["source_doc"] for r in rows}):
            doc_rows = [r for r in rows if r["source_doc"] == doc]
            books[doc] = {"doc": doc, "csv": path.name, "rows": doc_rows,
                          "year": book_year(doc, doc_rows),
                          "stem": path.name[len("budget_long_"):-len(".csv")]}
    return books


def pick_designated(books: dict, conflicts: list) -> dict[int, dict]:
    """One book per book-year. If two documents claim the same year, prefer an
    'adopted' edition, else the later file name, and log it."""
    by_year = defaultdict(list)
    for b in books.values():
        by_year[b["year"]].append(b)
    chosen = {}
    for year, group in by_year.items():
        group.sort(key=lambda b: ("adopt" in b["doc"].lower(), b["doc"]))
        chosen[year] = group[-1]
        if len(group) > 1:
            conflicts.append({"kind": "duplicate_book", "book_year": year,
                              "used": group[-1]["doc"],
                              "ignored": [b["doc"] for b in group[:-1]]})
    return chosen


def build(processed: Path, out: Path) -> dict:
    projection_books: dict = {}
    books = load_books(processed, projection_books)
    if not books:
        sys.exit(f"No budget_long_*.csv files in {processed}")
    conflicts: list[dict] = []
    designated = pick_designated(books, conflicts)
    newest = max(designated)

    docs, funds, depts, bureaus, cats = (Interner() for _ in range(5))
    accounts = Interner()  # (code, name, fund, dept, bureau, cat) tuples of ints
    # candidates[(measure, fy, account_code)] -> list of (is_designated, col_rank, row, book)
    candidates = defaultdict(list)

    for book in books.values():
        by = book["year"]
        is_book_designated = designated.get(by) is book
        seen = defaultdict(int)  # a book can print the same account code on two lines
        for r in book["rows"]:
            measure = COLUMN_TO_MEASURE.get(r["doc_type"])
            if measure is None:  # actual_ytd and anything unknown
                continue
            fy = int(r["fiscal_year"])
            offset, cols = RULE[measure]
            if measure in PROPOSED_MEASURES and fy != newest:
                continue  # older books' own-year proposals are never shown
            nth = seen[(r["doc_type"], fy, r["account_code"])]
            seen[(r["doc_type"], fy, r["account_code"])] += 1
            amount = parse_amount(r["amount"])
            if amount is None:
                continue
            designated_for_figure = is_book_designated and by - fy == offset
            candidates[(measure, fy, r["account_code"], nth)].append(
                (designated_for_figure, cols.index(r["doc_type"]), r, book, amount))

    # Pass 1: for every (year, measure, account line) take the designated book's figure.
    picks = defaultdict(list)  # (fy, measure) -> [(code, row, book, amount, cands)]
    for (measure, fy, code, nth), cands in sorted(candidates.items()):
        pool = [c for c in cands if c[0]]
        if not pool:
            continue  # designated book not loaded yet: show nothing rather than guess
        pool.sort(key=lambda c: c[1])
        _, _, row, book, amount = pool[0]
        picks[(fy, measure)].append((code, row, book, amount, cands))

    # One main kind per year: proposed/revised for the newest year, else actual, else projected;
    # plus the year's budget figure: amended where printed, else adopted.
    kept = set()
    for fy in {fy for fy, _ in picks}:
        have = {m for f, m in picks if f == fy}
        if fy == newest:
            kept |= {(fy, m) for m in PROPOSED_MEASURES & have}
        elif "actual" in have:
            kept.add((fy, "actual"))
        elif "projected" in have:
            kept.add((fy, "projected"))
        budget_fig = next((m for m in BUDGET_MEASURES if m in have), None)
        if budget_fig:
            kept.add((fy, budget_fig))

    # Pass 2: intern what is kept, log disagreements between books.
    series = defaultdict(lambda: {"a": [], "v": [], "p": [], "d": [], "c": []})
    covered = defaultdict(set)  # funds present in the designated book, zero lines included
    for (fy, measure) in sorted(kept):
        for code, row, book, amount, cands in picks[(fy, measure)]:
            covered[f"{fy}|{measure}"].add(funds(row["fund"]))
            for other in cands:
                if other[3] is not book and other[4] != amount:
                    conflicts.append({
                        "kind": "value", "account_code": code, "fiscal_year": fy,
                        "measure": measure, "used": amount, "used_doc": book["doc"],
                        "used_page": int(row["source_page"]), "other": other[4],
                        "other_doc": other[3]["doc"], "other_page": int(other[2]["source_page"]),
                        "other_column": other[2]["doc_type"]})
            if amount == 0:
                continue  # zero lines add size without adding information
            acct = accounts((code, row["account_name"], funds(row["fund"]),
                             depts(row["department"]), bureaus(row["bureau"]),
                             cats(row["category"])))
            s = series[f"{fy}|{measure}"]
            s["a"].append(acct)
            s["v"].append(amount)
            s["p"].append(int(row["source_page"]))
            s["d"].append(docs(book["doc"]))
            s["c"].append(row["doc_type"])

    out_series = {}
    for key, s in sorted(series.items()):
        fy, measure = key.split("|")
        entry = {"year": int(fy), "measure": measure, "funds": sorted(covered[key]),
                 "a": s["a"], "v": s["v"], "p": s["p"]}
        # Collapse per-row doc and column when uniform (the usual case).
        entry["doc"] = s["d"][0] if len(set(s["d"])) == 1 else s["d"]
        entry["column"] = s["c"][0] if len(set(s["c"])) == 1 else s["c"]
        out_series[key] = entry

    known_issues = read_csv(ROOT / "data" / "known_issues.csv") if (ROOT / "data" / "known_issues.csv").exists() else []
    # Projections: interned into the same accounts table before it is listed, so org mapping covers their lines.
    projection = build_projection(processed, projection_books, newest, docs, funds, depts, bureaus, cats, accounts,
                                  known_issues)
    acct_rows = [list(a) for a in accounts.items]
    printed = printed_totals(processed, designated, newest, docs, funds, bureaus, out_series, acct_rows,
                             cats.index.get("Revenue"), known_issues)

    book_list = sorted(({"doc": b["doc"], "year": b["year"], "csv": b["csv"],
                         "used": designated.get(b["year"]) is b} for b in books.values()),
                       key=lambda b: b["year"])
    for b in book_list:
        docs(b["doc"])

    budget = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "newest_year": newest,
        "measures": MEASURES,
        "rule": {m: {"book_offset": o, "columns": c} for m, (o, c) in RULE.items()},
        "books": book_list,
        "docs": docs.items,
        "funds": funds.items,
        "departments": depts.items,
        "bureaus": bureaus.items,
        "categories": cats.items,
        # [account_code, account_name, fund, department, bureau, category]
        "accounts": [list(a) for a in accounts.items],
        # Revenue accounts that are not income: {account index: draw | transfer | charge} (data/income_rules.csv).
        "not_income": income_rules.not_income(accounts.items, funds.items, cats.items),
        # Home Rule Charter § 8.08: each budget made under the charter tested against the 6% tax revenue limit
        # (scripts/tax_limit.py; config/tax_limit.json, data/tax_limit_lines.csv). Sums are calculated.
        "tax_limit": tax_limit.build(designated, RULE, docs),
        "series": out_series,
        "printed": printed,
        "known_issues": known_issues,
        # Bureaus a book omits entirely (reviewed known-issue notes), keyed by source book.
        "missing_bureaus": missing_bureaus(known_issues, books),
        "reserve": reserve_fund(processed, designated, newest, docs),
        # Multi-year projections after the newest year (see the module docstring). Never part of `series`.
        "projection": projection,
        "conflict_count": len(conflicts),
        # Departments and bureaus as on the 2027 org chart, with "what does it do" text
        # (scripts/org_structure.py; data/org_*_2027.csv). Every org code above maps to a unit.
        "org": build_org({a[0].split("-")[0] for a in accounts.items}),
    }
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "budget.json", budget)
    write_json(out / "conflicts.json", conflicts)
    write_json(out / "staffing.json", staffing(processed, designated, newest))
    # "What changed" for the newest year (scripts/changes.py): comparisons, fund shifts, positions, policy notes.
    write_json(out / "changes.json", build_changes(budget, processed, designated, newest, FUND_ALIASES))
    return budget


def build_projection(processed: Path, projection_books: dict, newest: int, docs, funds, depts, bureaus, cats,
                     accounts, known_issues: list) -> dict | None:
    """The `projection` block: series for each year after the newest year, the book's printed totals, its printed
    Surplus/(Deficit) per fund, and its assumptions page. One projections book is used: the newest one whose years
    all come after the newest budget year (several would be ambiguous, so the build stops)."""
    usable = []
    for pb in projection_books.values():
        yrs = sorted({int(r["fiscal_year"]) for r in pb["rows"]})
        if yrs and yrs[0] > newest:
            usable.append((pb, yrs))
    if not usable:
        return None
    if len(usable) > 1:
        sys.exit("More than one projections book after the newest year: " + ", ".join(pb["doc"] for pb, _ in usable))
    pb, yrs = usable[0]
    doc = docs(pb["doc"])
    series: dict = {}
    covered = defaultdict(set)
    pages = defaultdict(list)  # (fund, bureau) -> pages of its lines
    for r in pb["rows"]:
        key = f"{r['fiscal_year']}|{PROJECTION}"
        covered[key].add(funds(r["fund"]))
        pages[(r["fund"], r["bureau"])].append(int(r["source_page"]))
        amount = parse_amount(r["amount"])
        if amount is None or amount == 0:
            continue  # zero lines add size without adding information (as in `series`)
        acct = accounts((r["account_code"], r["account_name"], funds(r["fund"]), depts(r["department"]),
                         bureaus(r["bureau"]), cats(r["category"])))
        s = series.setdefault(key, {"year": int(r["fiscal_year"]), "measure": PROJECTION, "a": [], "v": [], "p": []})
        s["a"].append(acct)
        s["v"].append(amount)
        s["p"].append(int(r["source_page"]))
    for key, s in series.items():
        s.update(funds=sorted(covered[key]), doc=doc, column=PROJECTION)
    series = dict(sorted(series.items()))

    # Printed totals: each section over its own lines; each fund's "Total Revenue" / "Total Expense" over the fund.
    val = read_csv(processed / f"validation_{pb['stem']}.csv")
    acc = [list(a) for a in accounts.items]
    revenue_cat = cats.index.get("Revenue")
    printed, surplus = [], []
    for r in val:
        values = {f"{y}|{PROJECTION}": parse_amount(r[f"printed_{PROJECTION}_{y}"]) for y in yrs}
        fund = r.get("fund") or ""
        if r["level"] == "section":
            pg = pages.get((fund, r["label"]))
            if not pg:
                continue
            kind = "revenue" if any(x["fund"] == fund and x["bureau"] == r["label"] and x["category"] == "Revenue"
                                    for x in pb["rows"]) else "expense"
            item = {"level": "section", "label": r["label"], "page": int(r["source_page"]), "doc": doc, "kind": kind,
                    "m": [[funds(fund), bureaus(r["label"]), min(pg), max(pg)]]}
        elif r["level"] == "fund" and r["label"] in (f"{fund} / Total Revenue", f"{fund} / Total Expense"):
            kind = "revenue" if r["label"].endswith("Revenue") else "expense"
            item = {"level": "rollup", "label": r["label"].split(" / ", 1)[1], "page": int(r["source_page"]),
                    "doc": doc, "kind": kind, "m": [[funds(fund), -1, 0, 100000]], "fund": fund}
        elif r["level"] == "surplus":
            surplus.append({"fund": funds(fund), "label": "Surplus/(Deficit)", "page": int(r["source_page"]),
                            "values": values})
            continue
        else:
            continue
        item.update(values=values, sum={}, n={}, flag=[])
        for key in values:
            total, n = member_sum(series[key], acc, item, doc, revenue_cat)
            item["sum"][key], item["n"][key] = total, n
            if abs(total - values[key]) > tolerance(item["level"], n):
                item["flag"].append(key)
        iss = _issue_for(known_issues, pb["doc"], item["page"], r["label"])
        if iss is not None:
            item["issue"] = iss
        printed.append(item)

    assumptions = []
    ap = processed / f"projection_assumptions_{pb['stem']}.csv"
    for r in (read_csv(ap) if ap.exists() else []):
        t = r["text"].strip()
        kind = ("title" if r["line"] == "1" else "item" if re.match(r"^\([a-z]\)", t)
                else "note" if t.startswith("*") else "head")
        assumptions.append({"t": t, "k": kind, "p": int(r["source_page"])})
    # A wrapped note continues on the next line: join it.
    joined = []
    for a in assumptions:
        if joined and a["k"] == "head" and joined[-1]["k"] == "note":
            joined[-1]["t"] += " " + a["t"]
        else:
            joined.append(a)
    return {"label": "Projection", "doc": doc, "after_year": newest, "years": yrs, "series": series,
            "printed": printed, "surplus": surplus, "assumptions": joined}


SCENARIO_PREFERENCE = ["revised", "single", "proposed"]  # which printed column wins when a book has several


def _amount(text):
    return int(round(float(text)))


def reserve_fund(processed: Path, designated: dict, newest: int, docs) -> dict | None:
    """Year-end General Fund balance entries, one kind per year (see module docstring)."""
    books = {}
    for by, book in sorted(designated.items()):
        path = processed / f"fund_balance_{book['stem']}.csv"
        if path.exists():
            books[by] = (book, read_csv(path))
    if not books:
        return None

    def pick(rows):
        for sc in SCENARIO_PREFERENCE:
            hit = [r for r in rows if r["scenario"] == sc]
            if hit:
                return sc, hit
        return None, []

    def line(t, r, fy, rt, label=None):
        return {"t": t, "l": label or r["label"], "v": _amount(r["amount"]), "p": int(r["source_page"]), "fy": fy, "rt": rt}

    entries = []
    for by, (book, rows) in sorted(books.items()):
        doc = docs(book["doc"])
        openings = [r for r in rows if r["line_type"] == "beginning_balance"]
        if openings:  # the audited/unaudited actual year-end balance of year by-2
            y = int(openings[0]["as_of_date"][:4])
            sc, hit = pick(openings)
            r = hit[0]
            entry = {"year": y, "measure": "actual", "doc": doc, "sc": sc, "basis": r["basis"], "lines": [line("ending", r, y, "beginning_balance")]}
            others = [{"sc": o["scenario"], "v": _amount(o["amount"])} for o in openings if o is not r and _amount(o["amount"]) != _amount(r["amount"])]
            if others:
                entry["alt"] = others
            entries.append(entry)
        if by != newest:
            continue
        # The newest book: projected for the year before, proposed/revised for the newest year.
        scenarios = sorted({r["scenario"] for r in rows}, key=SCENARIO_PREFERENCE.index)
        checks_path = processed / f"fund_balance_checks_{book['stem']}.csv"
        checks = read_csv(checks_path) if checks_path.exists() else []
        def fy_rows(sc, fy):
            return [r for r in rows if r["scenario"] == sc and int(r["fiscal_year"]) == fy and r["line_type"] != "beginning_balance"]
        def block(sc, fy, begin_row, begin_rt, begin_fy):
            ls = [line("beginning", begin_row, begin_fy, begin_rt)]
            for r in fy_rows(sc, fy):
                t = {"revenues": "revenues", "expenditures": "expenditures", "surplus_deficit": "surplus", "adjustment": "adjustment", "ending_balance": "ending"}[r["line_type"]]
                ls.append(line(t, r, fy, r["line_type"]))
            return ls
        # projected: year newest-1, preferred scenario
        sc = next(x for x in SCENARIO_PREFERENCE if x in scenarios)
        begin = next(r for r in openings if r["scenario"] == sc)
        entries.append({"year": newest - 1, "measure": "projected", "doc": doc, "sc": sc, "basis": "projected",
                        "lines": block(sc, newest - 1, begin, "beginning_balance", newest - 2)})
        # proposed / revised: the newest year, one entry per printed column
        for sc in scenarios:
            measure = "revised" if sc == "revised" else "proposed"
            prev_end = next(r for r in rows if r["scenario"] == sc and int(r["fiscal_year"]) == newest - 1 and r["line_type"] == "ending_balance")
            entry = {"year": newest, "measure": measure, "doc": doc, "sc": sc, "basis": "proposed",
                     "lines": block(sc, newest, prev_end, "ending_balance", newest - 1)}
            for c in checks:  # a printed column whose own lines do not add up
                if c["level"] == "fund_balance_chain" and c["passed"] == "False" and c["label"].startswith(sc + ":") and str(newest) in c["label"]:
                    gap = _amount(c["max_abs_diff"])
                    usd = lambda n: ("-" if n < 0 else "") + f"${abs(n):,}"
                    entry["note"] = (f"In the city's {by} book the {sc} column does not add up: its revenues plus expenditures ({usd(_amount(c['computed']))}) "
                                     f"differ from its surplus plus adjustment lines ({usd(_amount(c['printed']))}) by ${gap:,}.")
            entries.append(entry)
    return {"name": "Reserve Fund", "entries": entries}


def missing_bureaus(known_issues: list, books: dict) -> dict:
    """Bureaus a book omits entirely, read from the reviewed notes ("... has no line-item pages for <bureau>
    (org N)"), keyed by source book: [{name, org, fund}]. The fund comes from that org's lines in other books."""
    fund_of = {}
    for b in books.values():
        for r in b["rows"]:
            fund_of.setdefault(r["org_code"], r["fund"])
    out: dict = {}
    for i in known_issues:
        for name, org in re.findall(r"no line-item pages for (.+?) \(org (\d+)\)", i.get("note", "")):
            entry = {"name": name, "org": org, "fund": fund_of.get(org)}
            if entry not in out.setdefault(i["source_doc"], []):
                out[i["source_doc"]].append(entry)
    return out


ROUNDING_PER_CELL = 5       # a section total the book prints over its own lines
ROUNDING_PER_LINE = 0.5     # a roll-up: each summed line may be off by half a dollar


def _norm_label(text: str) -> str:
    text = re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower())
    text = re.sub(r"\b(exp|expense|expenses|fund)\b", " ", text)
    return " ".join(text.split())


def _issue_for(known_issues: list, doc: str, page: int, label: str):
    """The reviewed known-issue note for a printed total (same book, page and label), if any."""
    here = [(i, k) for i, k in enumerate(known_issues)
            if k["source_doc"] == doc and str(k["source_page"]).strip() == str(page) and "/" not in k["label"]]
    want = _norm_label(label)
    for i, k in here:
        got = _norm_label(k["label"])
        if got == want or got.startswith(want) or want.startswith(got):
            return i
    return None


def printed_totals(processed: Path, designated: dict, newest: int, docs, funds, bureaus,
                   series: dict, accounts: list, revenue_cat, known_issues: list) -> list:
    """Every section (bureau) and roll-up total the books print, for the figures the site shows.

    Each item says which lines the printed total covers (`m`), so the site can tell whether a total it
    displays is one the book prints: a list of [fund, bureau, first page, last page] (bureau -1 = every
    line of that fund and `kind`). Sections cover their own lines; the last fund roll-up of a fund and kind
    in a book covers the whole fund; other roll-ups (departments, subtotals) cover the run of sections the
    validation step matched. Per shown figure: `values` (as printed), `sum` (our sum of those lines),
    `n` (lines summed), and `flag` (the gap is more than rounding: $5 for a section, $0.50 per line for a
    roll-up). `issue` points to the reviewed note in known_issues.csv."""
    out = []
    shown_keys = set(series)
    for by, book in sorted(designated.items()):
        path = processed / f"validation_{book['stem']}.csv"
        if not path.exists():
            continue
        val = [r for r in read_csv(path) if r["level"] in ("section", "rollup")]
        # Section membership: same label, pages after the previous section of that label up to its total.
        lines = defaultdict(set)  # label -> {(fund, page)}
        for r in book["rows"]:
            lines[r["bureau"]].add((r["fund"], int(r["source_page"]), r["category"] == "Revenue"))
        prev_page = defaultdict(int)
        specs, leaf = [], []  # per validation row; leaf sections in order (for roll-up runs)
        for r in val:
            page = int(r["source_page"])
            if r["level"] == "section":
                lo = prev_page[r["label"]] + 1
                prev_page[r["label"]] = page
                hit = {(f, rev) for f, pg, rev in lines.get(r["label"], ()) if lo <= pg <= page}
                if not hit or int(r["members"] or 0) == 0:
                    specs.append(None)
                    continue
                if len(hit) > 1:
                    sys.exit(f"{book['doc']} p{page} section {r['label']!r} spans {sorted(hit)}")
                (fund, rev), = hit
                spec = {"m": [[funds(fund), bureaus(r["label"]), lo, page]], "kind": "revenue" if rev else "expense"}
                specs.append(spec)
                leaf.append((spec, printed_cells(r)))
            else:
                run = [x[0] for x in best_run(leaf, printed_cells(r))]
                spec = {"m": [x for s in run for x in s["m"]],
                        "kind": run[0]["kind"] if run and len({s["kind"] for s in run}) == 1 else None}
                specs.append(spec)
        # The last printed roll-up of each fund and kind is the fund total.
        last_fund = {}
        for i, r in enumerate(val):
            if r["level"] == "rollup":
                label = r["label"].lower()
                fund = next((f for k, f in FUND_ALIASES.items() if k in label), None)
                kind = "revenue" if "revenue" in label else "expense" if "expense" in label else None
                if fund and kind:
                    last_fund[(fund, kind)] = i
        fund_of = {i: fk for fk, i in last_fund.items()}

        for i, r in enumerate(val):
            spec = specs[i]
            if i in fund_of:
                fund, kind = fund_of[i]
                spec = {"m": [[funds(fund), -1, 0, 100000]], "kind": kind}
            if not spec or not spec["m"] or not spec["kind"]:
                continue
            values = {}
            for col, text in r.items():
                m = re.fullmatch(r"printed_(.+)_(\d{4})", col or "")
                if not m or parse_amount(text) is None:
                    continue
                doc_type, fy = m.group(1), int(m.group(2))
                measure = COLUMN_TO_MEASURE.get(doc_type)
                if measure is None or by - fy != RULE[measure][0]:
                    continue
                if measure in PROPOSED_MEASURES and fy != newest:
                    continue
                key = f"{fy}|{measure}"
                if key not in shown_keys:
                    continue  # only totals for figures the site actually shows
                rank = RULE[measure][1].index(doc_type)
                if key not in values or rank < values[key][1]:
                    values[key] = (parse_amount(text), rank)
            if not values:
                continue
            doc = docs(book["doc"])
            item = {"level": r["level"], "label": r["label"], "page": int(r["source_page"]), "doc": doc,
                    "kind": spec["kind"], "m": spec["m"], "values": {k: v[0] for k, v in values.items()},
                    "sum": {}, "n": {}, "flag": []}
            if i in fund_of:
                item["fund"] = fund_of[i][0]
            for key in item["values"]:
                total, n = member_sum(series[key], accounts, item, doc, revenue_cat)
                item["sum"][key], item["n"][key] = total, n
                if abs(total - item["values"][key]) > tolerance(item["level"], n):
                    item["flag"].append(key)
            iss = _issue_for(known_issues, book["doc"], item["page"], r["label"])
            if iss is not None:
                item["issue"] = iss
            out.append(item)
    return out


def printed_cells(r: dict) -> dict:
    return {c: parse_amount(v) for c, v in r.items() if (c or "").startswith("printed_") and parse_amount(v) is not None}


def best_run(leaf: list, cells: dict) -> list:
    """The run of most recent sections a roll-up adds up. Unlike the validation step's first-fit search,
    this picks the run with the fewest printed columns off by more than rounding, then the smallest gap,
    so one bad column (a year-to-date figure, say) does not send it to the wrong run."""
    best, run = None, [0] * 0
    sums = defaultdict(float)
    for n in range(1, len(leaf) + 1):
        for c, v in leaf[-n][1].items():
            sums[c] += v
        diffs = [abs(sums[c] - v) for c, v in cells.items()]
        if not diffs:
            break
        score = (sum(d > max(ROUNDING_PER_CELL, n) for d in diffs), max(diffs))
        if best is None or score < best:
            best, run = score, leaf[-n:]
    return run


def tolerance(level: str, n: int) -> float:
    """Rounding: $5 for a printed section total, $0.50 for each line summed for a roll-up (at least $5)."""
    return ROUNDING_PER_CELL if level == "section" else max(ROUNDING_PER_CELL, ROUNDING_PER_LINE * n)


def member_sum(s: dict, accounts: list, item: dict, doc: int, revenue_cat):
    """Our sum of the shown lines a printed total covers (same book, fund, section, pages, kind)."""
    total, n = 0, 0
    docs_ = s["doc"] if isinstance(s["doc"], list) else None
    for j, a in enumerate(s["a"]):
        if (docs_[j] if docs_ else s["doc"]) != doc:
            continue
        code, _, fund, _, bureau, cat = accounts[a]
        if (cat == revenue_cat) != (item["kind"] == "revenue"):
            continue
        p = s["p"][j]
        if any(fund == f and (b == -1 or b == bureau) and lo <= p <= hi for f, b, lo, hi in item["m"]):
            total += s["v"][j]
            n += 1
    return (int(total) if float(total).is_integer() else total), n


def staffing(processed: Path, designated: dict, newest: int) -> dict:
    """Positions from each designated book's own-year schedule.

    Older years have one budgeted schedule per book ("budgeted"). The newest book prints the
    proposed and the revised schedule side by side; both are kept, as "proposed" and "revised".
    """
    result = {"units": [], "titles": [], "books": []}
    units, titles = Interner(), Interner()
    for by, book in sorted(designated.items()):
        path = processed / f"staffing_{book['stem']}.csv"
        if not path.exists():
            continue
        rows = read_csv(path)
        if not rows:
            continue
        cols = rows[0].keys()
        if by == newest and f"count_{by}_proposed_revised" in cols and f"count_{by}_proposed" in cols:
            picks = [(f"{by}_proposed", "proposed"), (f"{by}_proposed_revised", "revised")]
        else:
            suffix = next((s for s in (f"{by}_proposed_revised", f"{by}_proposed", f"{by}_adopted")
                           if f"count_{s}" in cols), None)
            if suffix is None:
                continue
            picks = [(suffix, "budgeted" if by != newest else "proposed")]
        for suffix, measure in picks:
            positions = []
            for r in rows:
                count = parse_amount(r[f"count_{suffix}"])
                salary = parse_amount(r[f"salary_{suffix}"])
                if count is None:
                    continue
                positions.append([units((r["fund"], r["department"], r["unit"])),
                                  titles(r["position_title"]), r["ft_pt"], r["org_code"],
                                  r["object_code"], count, salary, int(r["source_page"])])
            result["books"].append({"doc": book["doc"], "year": by, "column": suffix, "measure": measure,
                                    # [unit, title, ft_pt, org, object, count, salary, page]
                                    "positions": positions})
    result["units"] = [list(u) for u in units.items]
    result["titles"] = titles.items
    return result


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n",
                    encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--entity", choices=["city", "county"], default="city",
                    help="city (default): web/data/; county: data/processed/county -> web/data/county/ (scripts/build_county.py)")
    ap.add_argument("--processed", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    if args.entity == "county":
        import build_county
        out = args.out or build_county.OUT
        build_county.report(build_county.build(args.processed or build_county.PROCESSED, out), out)
        return
    args.processed = args.processed or ROOT / "data" / "processed"
    args.out = args.out or ROOT / "web" / "data"
    budget = build(args.processed, args.out)
    print(f"Books: " + ", ".join(f"{b['year']}={b['doc']}{'' if b['used'] else ' (ignored)'}"
                                 for b in budget["books"]))
    for key, s in budget["series"].items():
        print(f"  {key:16s} {len(s['a']):4d} lines  total {sum(s['v']):>14,}  "
              f"column {s['column'] if isinstance(s['column'], str) else 'mixed'}")
    pj = budget.get("projection")
    if pj:
        for key, s in pj["series"].items():
            print(f"  {key:16s} {len(s['a']):4d} lines  total {sum(s['v']):>14,}  (projection block, not selectable)")
    print(f"Conflicts: {budget['conflict_count']} (web/data/conflicts.json)")
    for name in ("budget.json", "staffing.json", "conflicts.json", "changes.json"):
        print(f"  {name}: {(args.out / name).stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
