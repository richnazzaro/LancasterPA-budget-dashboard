#!/usr/bin/env python3
"""Build the dashboard's JSON from every data/processed/budget_long_*.csv.

Which figure is shown (the project's selection rule): ONE kind of figure per year.
  * Newest year (the newest book's own year): "proposed" (the original proposal)
    and "revised" (proposed_revised), when the book has them.
  * Any earlier year with an audited actual in the book two years later: "actual" only.
  * The year before the newest, which has no actual yet: "projected" only, from
    the next book (projected_revised preferred).
  * Adopted, amended, year-to-date and older books' own-year proposals are never shown.

Figures are copied exactly as extracted: nothing is rounded, filled or adjusted.
When a non-designated book carries the same account/year/measure with a
different value, the designated book still wins and the disagreement is listed
in web/data/conflicts.json.

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
Usage: python3 scripts/build_dataset.py [--processed DIR] [--out DIR]
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

from changes import build_changes
from org_structure import build_org

ROOT = Path(__file__).resolve().parent.parent
MEASURES = ["actual", "projected", "proposed", "revised"]
PROPOSED_MEASURES = {"proposed", "revised"}  # shown only for the newest year
# measure -> (book offset from the figure's fiscal year, source columns in preference order)
RULE = {
    "proposed": (0, ["proposed"]),
    "revised": (0, ["proposed_revised"]),
    "projected": (1, ["projected_revised", "projected"]),
    "actual": (2, ["actual"]),
}
COLUMN_TO_MEASURE = {c: m for m, (_, cols) in RULE.items() for c in cols}
FUND_ALIASES = {  # words used in printed roll-up labels -> fund names in the CSVs
    "general fund": "General Fund",
    "stormwater": "Stormwater Management Fund",
    "wastewater": "Sewer Fund",
    "sewer": "Sewer Fund",
    "water fund": "Water Fund",
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


def load_books(processed: Path) -> dict:
    """Group every budget_long row by its source document."""
    books: dict[str, dict] = {}
    for path in sorted(processed.glob("budget_long_*.csv")):
        rows = read_csv(path)
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
    books = load_books(processed)
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

    # One kind per year: proposed/revised for the newest year, else actual, else projected.
    kept = set()
    for fy in {fy for fy, _ in picks}:
        have = {m for f, m in picks if f == fy}
        if fy == newest:
            kept |= {(fy, m) for m in PROPOSED_MEASURES & have}
        elif "actual" in have:
            kept.add((fy, "actual"))
        elif "projected" in have:
            kept.add((fy, "projected"))

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

    printed = printed_totals(processed, designated, newest, docs, bureaus, set(out_series))

    book_list = sorted(({"doc": b["doc"], "year": b["year"], "csv": b["csv"],
                         "used": designated.get(b["year"]) is b} for b in books.values()),
                       key=lambda b: b["year"])
    for b in book_list:
        docs(b["doc"])
    known_issues = read_csv(ROOT / "data" / "known_issues.csv") if (ROOT / "data" / "known_issues.csv").exists() else []

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
        "series": out_series,
        "printed": printed,
        "known_issues": known_issues,
        # Bureaus a book omits entirely, read from the reviewed known-issue notes
        # ("... has no line-item pages for <bureau> (org N)"), keyed by source book.
        "missing_bureaus": missing_bureaus(known_issues),
        "reserve": reserve_fund(processed, designated, newest, docs),
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


def missing_bureaus(known_issues: list) -> dict:
    out: dict = {}
    for i in known_issues:
        for name in re.findall(r"no line-item pages for (.+?) \(org \d+\)", i.get("note", "")):
            out.setdefault(i["source_doc"], [])
            if name not in out[i["source_doc"]]:
                out[i["source_doc"]].append(name)
    return out


def printed_totals(processed: Path, designated: dict, newest: int, docs, bureaus, shown_keys: set) -> list:
    """Printed section (bureau) and fund roll-up totals from the validation files,
    restricted to the columns the selection rule uses, so the UI can link each
    total to the page where the city prints it."""
    out = []
    for by, book in sorted(designated.items()):
        path = processed / f"validation_{book['stem']}.csv"
        if not path.exists():
            continue
        for r in read_csv(path):
            if r["level"] not in ("section", "rollup"):
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
                # keep only the preferred column for each measure
                key = f"{fy}|{measure}"
                if key not in shown_keys:
                    continue  # only totals for figures the site actually shows
                rank = RULE[measure][1].index(doc_type)
                if key not in values or rank < values[key][1]:
                    values[key] = (parse_amount(text), rank)
            if not values:
                continue
            item = {"level": r["level"], "label": r["label"], "page": int(r["source_page"]),
                    "doc": docs(book["doc"]), "values": {k: v[0] for k, v in values.items()},
                    "passed": r.get("passed") == "True"}
            if r["level"] == "rollup":
                label = r["label"].lower()
                fund = next((f for k, f in FUND_ALIASES.items() if k in label), None)
                kind = "revenue" if "revenue" in label else "expense" if "expense" in label else None
                if fund and kind:
                    item["fund"], item["kind"] = fund, kind
            out.append(item)
    return out


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
    ap.add_argument("--processed", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "data")
    args = ap.parse_args()
    budget = build(args.processed, args.out)
    print(f"Books: " + ", ".join(f"{b['year']}={b['doc']}{'' if b['used'] else ' (ignored)'}"
                                 for b in budget["books"]))
    for key, s in budget["series"].items():
        print(f"  {key:16s} {len(s['a']):4d} lines  total {sum(s['v']):>14,}  "
              f"column {s['column'] if isinstance(s['column'], str) else 'mixed'}")
    print(f"Conflicts: {budget['conflict_count']} (web/data/conflicts.json)")
    for name in ("budget.json", "staffing.json", "conflicts.json", "changes.json"):
        print(f"  {name}: {(args.out / name).stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
