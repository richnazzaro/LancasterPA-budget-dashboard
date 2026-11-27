"""The Home Rule Charter's 6% tax revenue limit (§ 8.08), tested for every City budget made under the charter.

§ 8.08: the City shall not increase all sources of General Fund tax revenues by more than 6% over the preceding year
unless Council waives it (majority of the whole plus one). Fees, grants, one-time sources, debt proceeds, asset sales
and other restricted revenue are not tax revenue.

Everything that can change is read from files, never written here:
  config/tax_limit.json        entity, fund, limit, the first budget year made under the charter, which book columns
                               are the budget being tested (proposed, proposed_revised), which figure is the preceding
                               year (`baseline_measure`, a measure of build_dataset.RULE: the same book's Projected
                               column, revised projection first, the figure the site compares the newest year with by
                               default), and the budget years the § 13.14 note is shown for.
  data/tax_limit_lines.csv     which General Fund revenue lines are tax revenue (counts = yes) and which tax-looking
                               lines are not (counts = no), each with a one-line reason.

For each designated book whose own year is at or after `first_year`, each tested column the book prints gives one test:
the sum of the counted lines in that column (the book's own year) against the sum of the same lines in the baseline
column of the same book (the year before). The sums are this site's own (calculated); each line keeps its page.

check() (run by check_dataset.py) recomputes every test straight from the budget_long CSVs and compares it with
budget.json, and fails on a General Fund line in the books' tax revenue group that data/tax_limit_lines.csv does not
list, so a new tax line is reviewed before the test silently leaves it out. Standard library only.
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "tax_limit.json"
LINES = ROOT / "data" / "tax_limit_lines.csv"
TAX_GROUP = "tax revenue"  # the books' revenue group ("Tax Revenue" / "Tax Revenues"), for the unreviewed-line check


def load_config() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def load_lines(entity: str) -> list[dict]:
    with LINES.open(newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["entity"] == entity]
    for r in rows:
        if r["counts"] not in ("yes", "no"):
            raise ValueError(f"{LINES.name}: counts {r['counts']!r} for {r['code']} must be yes or no")
    return rows


def _amount(text: str):
    text = (text or "").strip()
    if not text:
        return None
    v = float(text)
    return int(v) if v.is_integer() else v


def build(designated: dict, rule: dict, docs) -> dict | None:
    """budget.json `tax_limit`. designated: book year -> book ({doc, rows, year}); rule: build_dataset.RULE;
    docs: the build's document interner (doc name -> index)."""
    cfg = load_config()
    if cfg.get("entity") != "city":
        return None
    lines = load_lines(cfg["entity"])
    counted = {r["code"] for r in lines if r["counts"] == "yes"}
    base_cols = rule[cfg["baseline_measure"]][1]

    def pick(book, fy, col):
        got = [r for r in book["rows"] if r["fund"] == cfg["fund"] and r["object_code"] in counted
               and int(r["fiscal_year"]) == fy and r["doc_type"] == col and _amount(r["amount"]) is not None]
        if not got:
            return None
        ls = sorted(([r["object_code"], r["account_name"], _amount(r["amount"]), int(r["source_page"])] for r in got),
                    key=lambda x: x[0])
        return {"year": fy, "column": col, "doc": docs(book["doc"]), "value": sum(x[2] for x in ls), "lines": ls}

    tests = []
    for by in sorted(y for y in designated if y >= cfg["first_year"]):
        book = designated[by]
        base = None
        for col in base_cols:
            base = pick(book, by - 1, col)
            if base:
                base["measure"] = cfg["baseline_measure"]
                break
        if not base:
            continue
        found = []
        for t in cfg["tested"]:
            cur = pick(book, by, t["column"])
            if cur:
                cur["measure"] = t["measure"]
                found.append(cur)
        for i, cur in enumerate(found):
            pct = (cur["value"] - base["value"]) / base["value"] * 100
            tests.append({**cur, "book_year": by, "newest": i == len(found) - 1, "base": base,
                          "change_pct": round(pct, 4), "limit": round(base["value"] * (1 + cfg["limit_pct"] / 100), 2),
                          "over": pct > cfg["limit_pct"]})
    return {
        "limit_pct": cfg["limit_pct"],
        "first_year": cfg["first_year"],
        "fund": cfg["fund"],
        "section": cfg["section"],
        "baseline_measure": cfg["baseline_measure"],
        "transition": cfg.get("transition"),
        # [object code, name, counts (bool), reason]
        "lines": [[r["code"], r["name"], r["counts"] == "yes", r["reason"]] for r in lines],
        "tests": tests,
    }


def check(budget: dict) -> int:
    """For check_dataset.py: recompute every test from the budget_long CSVs and compare with budget.json `tax_limit`.
    Returns the number of failures."""
    print("\nHome Rule 6% tax revenue limit (§ 8.08; config/tax_limit.json, data/tax_limit_lines.csv):")
    cfg = load_config()
    lines = load_lines(cfg["entity"])
    listed = {r["code"] for r in lines}
    counted = {r["code"] for r in lines if r["counts"] == "yes"}
    TL = budget.get("tax_limit")
    bad = 0
    if not TL:
        print("FAIL budget.json has no tax_limit block")
        return 1
    docs = budget["docs"]
    used = {b["year"]: b["doc"] for b in budget["books"] if b["used"]}
    base_cols = budget["rule"][cfg["baseline_measure"]]["columns"]
    tested = {t["column"]: t["measure"] for t in cfg["tested"]}

    sums = defaultdict(float)  # (doc, fy, column) -> sum of counted lines
    pages = defaultdict(set)
    unreviewed = set()
    for path in sorted((ROOT / "data" / "processed").glob("budget_long_*.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["fund"] != cfg["fund"] or not r["amount"].strip():
                    continue
                if r["category"] == "Revenue" and r["bureau"].strip().lower().rstrip("s") == TAX_GROUP \
                        and r["object_code"] not in listed:
                    unreviewed.add((r["object_code"], r["account_name"]))
                if r["object_code"] in counted:
                    k = (r["source_doc"], int(r["fiscal_year"]), r["doc_type"])
                    sums[k] += float(r["amount"])
                    pages[k].add(int(r["source_page"]))
    for code, name in sorted(unreviewed):
        bad += 1
        print(f"FAIL {code} {name}: a General Fund tax revenue line not in data/tax_limit_lines.csv; review it (counts yes/no)")

    expected = []
    for by in sorted(y for y in used if y >= cfg["first_year"]):
        doc = used[by]
        bcol = next((c for c in base_cols if (doc, by - 1, c) in sums), None)
        if not bcol:
            continue
        for col in (c for c in tested if (doc, by, c) in sums):
            expected.append((by, tested[col], col, doc, sums[(doc, by, col)], bcol, sums[(doc, by - 1, bcol)]))
    got = {(t["year"], t["measure"]): t for t in TL["tests"]}
    if len(got) != len(TL["tests"]) or set(got) != {(e[0], e[1]) for e in expected}:
        bad += 1
        print(f"FAIL tests in budget.json {sorted(got)} differ from the CSVs {sorted((e[0], e[1]) for e in expected)}")
    for by, m, col, doc, v, bcol, bv in expected:
        t = got.get((by, m))
        if not t:
            continue
        pct = (v - bv) / bv * 100
        over = pct > cfg["limit_pct"]
        problems = []
        if docs[t["doc"]] != doc or t["column"] != col or abs(t["value"] - v) >= 0.5 or abs(sum(x[2] for x in t["lines"]) - v) >= 0.5:
            problems.append(f"value {t['value']:,} vs csv {v:,.0f}")
        b = t["base"]
        if docs[b["doc"]] != doc or b["column"] != bcol or b["year"] != by - 1 or abs(b["value"] - bv) >= 0.5:
            problems.append(f"baseline {b['column']} {b['value']:,} vs csv {bcol} {bv:,.0f}")
        if abs(t["change_pct"] - pct) > 0.0001 or t["over"] != over:
            problems.append(f"change {t['change_pct']}% over={t['over']} vs csv {pct:.4f}% over={over}")
        if {x[3] for x in t["lines"]} - pages[(doc, by, col)]:
            problems.append("line pages differ")
        bad += bool(problems)
        status = "EXCEEDS" if over else "within"
        print(f"{'FAIL' if problems else 'ok  '} {by} {m:8s} {v:>13,.0f} vs {by - 1} {bcol:17s} {bv:>13,.0f}  "
              f"{pct:+.1f}%  {status} the {cfg['limit_pct']}% limit" + (f"  ({'; '.join(problems)})" if problems else ""))
    print(f"{'ok  ' if not bad else 'FAIL'} {len(expected)} budgets tested from {cfg['first_year']}; "
          f"{len(counted)} lines counted, {len(listed - counted)} listed as not tax revenue; no unreviewed tax lines")
    return bad
