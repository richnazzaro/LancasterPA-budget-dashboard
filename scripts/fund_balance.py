"""Extract and check the General Fund "Fund Balance Projection" page.

Usage:
    python scripts/fund_balance.py "Budget PDFs - City/2027-RevisedProposedBudget-Compressed.pdf"
    (ingest.py runs this for every book)

The page walks the General Fund reserve ("Reserve Fund" on the dashboard)
from the last closed year-end through the projected and proposed years:

    Fund Balance 12/31/2025 (Unaudited fund balance)      beginning_balance
    Projected Revenues: 2026                              revenues
    Projected Expenditures: 2026  (in parentheses)        expenditures
    Projected Current Operating Surplus/(Deficit) 2026    surplus_deficit
      (Addition|Reduction to Fund Balance)                caption; some books
                                                          print the value here
    (Committed data center revenue ...)                   adjustment
    Projected Fund Balance 12/31/2026                     ending_balance
    Proposed Revenues: 2027 ... Projected Fund Balance 12/31/2027

Some books print two columns side by side (2027: proposed and revised); the
config's "fund_balance": {"scenarios": [...]} names them left to right.

Writes data/processed/fund_balance_<doc>.csv (one row per printed amount,
labels and signs as printed) and fund_balance_checks_<doc>.csv:
  chain     revenues + expenditures = surplus/deficit; beginning + surplus +
            adjustments = ending; each ending is the next year's beginning
  gf_total  page revenues/expenditures vs the General Fund totals extracted
            from the same book (printed roll-up and sum of lines)
Failed chain checks need a known_issues.csv entry, as everywhere else.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

from budget_common import (OUT_DIR, ROUNDING_TOLERANCE, acknowledge_known_issues,
                           check_counts)
from extract_layout import CONFIG_DIR, load_page_lines, load_text_page_lines, read_salary
from ocr_pages import cache_dir, ocr_document

RE_MONEY = re.compile(r"^\$?\(?\$?[\d,]+(\.\d+)?\)?$")
RE_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
RE_YEAR = re.compile(r"\b(20\d\d)\b")
CAPTION = re.compile(r"^\((Unaudited fund balance|Addition to Fund Balance|"
                     r"Reduction to Fund Balance)\)$", re.I)


def _pages(pdf, cfg):
    if cfg.get("source", "ocr") == "text":
        import pdfplumber
        with pdfplumber.open(pdf) as doc:
            for i, page in enumerate(doc.pages):
                yield i + 1, (lambda p=page: load_text_page_lines(p, cfg.get("glyph_map")))
    else:
        dpi = cfg.get("ocr", {}).get("dpi", 300)
        ocr_document(pdf, dpi, fallback_rotate=cfg.get("ocr", {}).get("fallback_rotate", 0))
        for tsv in sorted(cache_dir(pdf, dpi).glob("page_*.tsv")):
            yield int(tsv.stem.split("_")[1]), (lambda t=tsv: load_page_lines(t))


def find_page(pdf, cfg):
    for page_no, get_lines in _pages(pdf, cfg):
        lines = get_lines()
        text = "\n".join(l.text for l in lines[:6]).upper()
        if "FUND BALANCE PROJECTION" in text and "GENERAL FUND" in text:
            return page_no, lines
    return None, None


def _segments(lines, n_scenarios):
    """Split each line into per-scenario word lists (side-by-side columns)."""
    # The table starts at the first "Fund Balance 12/31/..." line; above it
    # are the page title and column headings ("2027 Budget").
    start = next(i for i, l in enumerate(lines) if RE_DATE.search(l.text))
    lines = lines[start:]
    if n_scenarios == 1:
        return [[l.words for l in lines]]
    # Columns start where the second "Fund Balance 12/31" label starts.
    first = next(l for l in lines if sum(w.text == "Fund" for w in l.words) >= 2)
    split = [w for w in first.words if w.text == "Fund"][1].left - 1
    cols = [[] for _ in range(n_scenarios)]
    for l in lines:
        cols[0].append([w for w in l.words if w.left < split])
        cols[1].append([w for w in l.words if w.left >= split])
    return cols


def parse_column(rows_words):
    """Turn one column's lines into (label, amount or None) entries."""
    entries, pending = [], []
    for words in rows_words:
        if not words:
            continue
        # A bare year ("... Surplus/(Deficit) 2026") is part of the label.
        money = [w for w in words if RE_MONEY.match(w.text) and w.text != "$"
                 and not re.fullmatch(r"(19|20)\d\d", w.text)]
        label_words = [w.text for w in words if w.text != "$" and w not in money]
        label = " ".join(label_words)
        amount = read_salary(money[-1].text.replace("$", ""))[0] if money else None
        if amount is None and not CAPTION.match(label) and not re.search(
                r"Fund Balance|Revenues|Expenditures|Surplus", label, re.I):
            pending.append(label)          # first line of a wrapped label
            continue
        if pending:
            label = " ".join(pending + [label])
            pending = []
        entries.append((label, amount))
    return entries


def classify(entries, scenario, source_doc, page):
    """Label each printed amount; returns output rows."""
    rows, year, basis = [], None, None
    i = 0
    while i < len(entries):
        label, amount = entries[i]
        nxt = entries[i + 1] if i + 1 < len(entries) else (None, None)
        low = label.lower()
        date = RE_DATE.search(label)
        yr = RE_YEAR.search(label)
        row = {"source_doc": source_doc, "source_page": page, "scenario": scenario,
               "fiscal_year": None, "as_of_date": "", "line_type": None,
               "label": label, "amount": amount, "basis": "", "note": ""}
        if CAPTION.match(label):
            i += 1
            continue                         # consumed below with its owner
        if "fund balance" in low and date:
            row["as_of_date"] = f"{date.group(3)}-{int(date.group(1)):02d}-{int(date.group(2)):02d}"
            row["fiscal_year"] = int(date.group(3))
            if low.startswith("fund balance"):
                row["line_type"] = "beginning_balance"
                cap = nxt[0] if nxt[0] and CAPTION.match(nxt[0]) else ""
                row["basis"] = "unaudited" if "unaudited" in cap.lower() else ""
                if cap:
                    row["label"] += f" {cap}"
            else:
                row["line_type"] = "ending_balance"
                row["basis"] = basis or ""
        elif "revenues" in low:
            row.update(line_type="revenues", fiscal_year=int(yr.group(1)) if yr else year)
            basis = low.split()[0]
            row["basis"] = basis
        elif "expenditures" in low:
            row.update(line_type="expenditures", fiscal_year=int(yr.group(1)) if yr else year)
            row["basis"] = low.split()[0]
        elif "surplus" in low:
            row.update(line_type="surplus_deficit", fiscal_year=int(yr.group(1)) if yr else year,
                       basis=basis or "")
            if nxt[0] and CAPTION.match(nxt[0]) and "fund balance)" in nxt[0].lower():
                row["label"] += f" {nxt[0]}"
                if amount is None and nxt[1] is not None:
                    row["amount"] = nxt[1]
                    row["note"] = (f"surplus line printed blank; amount is printed on the "
                                   f"'{nxt[0]}' line")
                i += 1
        else:
            row.update(line_type="adjustment", fiscal_year=year, basis=basis or "")
        if row["fiscal_year"]:
            year = row["fiscal_year"]
        rows.append(row)
        i += 1
    return rows


def chain_checks(rows, scenario, page):
    """revenues + expenditures = surplus; balance + surplus + adj = ending."""
    checks, balance, block = [], None, {}

    def check(label, printed, computed, members):
        diff = None if printed is None or computed is None else computed - printed
        checks.append({"level": "fund_balance_chain", "label": f"{scenario}: {label}",
                       "source_page": page, "members": members,
                       "printed": printed, "computed": computed,
                       "max_abs_diff": abs(diff) if diff is not None else None,
                       "passed": diff is not None and abs(diff) <= ROUNDING_TOLERANCE})

    for r in rows:
        t, a = r["line_type"], r["amount"]
        if t == "beginning_balance":
            balance = a
        elif t in ("revenues", "expenditures"):
            block[t] = a
        elif t == "surplus_deficit":
            block["surplus"] = a
            block["surplus_row"] = r
        elif t == "adjustment":
            block.setdefault("adj", []).append(a or 0)
        if t == "ending_balance" and "surplus_row" in block \
                and "revenues" in block and "expenditures" in block:
            sr, op = block["surplus_row"], block["revenues"] + block["expenditures"]
            if sr["note"]:
                # Amount printed on the "(Reduction to Fund Balance)" line: the
                # page splits the operating result into that line plus the
                # labelled adjustments, so those must add back to it.
                check(f"revenues + expenditures {sr['fiscal_year']} = '(Addition/Reduction "
                      f"to Fund Balance)' + adjustments",
                      sum([sr["amount"] or 0] + block.get("adj", [])), op,
                      2 + len(block.get("adj", [])))
            else:
                check(f"surplus/deficit {sr['fiscal_year']} = revenues + expenditures",
                      sr["amount"], op, 2)
        if t == "ending_balance":
            parts = [balance, block.get("surplus")] + block.get("adj", [])
            computed = None if any(p is None for p in parts) else sum(parts)
            check(f"fund balance {r['as_of_date']} = beginning + surplus + adjustments",
                  a, computed, len(parts))
            balance, block = a, {}
    return checks


def gf_total_checks(rows, doc, scenario_cols):
    """Compare page revenues/expenditures with this book's General Fund totals:
    the printed roll-up, the sum of General Fund lines, and (revenues) that sum
    without 499000 Fund Balance Reserve, the budgeted draw on the reserve."""
    val_path, li_path = OUT_DIR / f"validation_{doc}.csv", OUT_DIR / f"line_items_{doc}.csv"
    if not val_path.exists() or not li_path.exists():
        return []
    v, li = pd.read_csv(val_path), pd.read_csv(li_path, dtype={"object_code": str})
    roll = v[v.level.isin(["rollup", "section"])]
    gf = li[li.fund == "General Fund"]
    out = []
    for r in rows:
        if r["line_type"] not in ("revenues", "expenditures") or r["amount"] is None:
            continue
        col = scenario_cols.get((r["scenario"], r["basis"], r["fiscal_year"]))
        if not col or col not in li.columns:
            continue
        rev = r["line_type"] == "revenues"
        pat = "general fund.*revenue" if rev else "general fund.*expen"
        tot = roll[roll.label.str.contains(pat, case=False, regex=True)]
        printed = tot[f"printed_{col}"].iloc[-1] if len(tot) and f"printed_{col}" in tot else None
        lines = gf[(gf.category == "Revenue") == rev]
        cands = {"printed General Fund total": printed,
                 "sum of General Fund lines": lines[col].sum()}
        if rev:
            cands["sum of lines excl. 499000 Fund Balance Reserve"] = \
                lines[lines.object_code != "499000"][col].sum()
        page_amt = abs(r["amount"])
        diffs = {k: page_amt - c for k, c in cands.items() if c is not None and c == c}
        best = min(diffs, key=lambda k: abs(diffs[k])) if diffs else None
        out.append({"level": "fund_balance_gf_total",
                    "label": f"{r['scenario']}: {r['label']} vs {col}",
                    "source_page": r["source_page"], "members": 1,
                    "printed": page_amt, "computed": cands["printed General Fund total"],
                    "line_sum": cands["sum of General Fund lines"],
                    "line_sum_excl_reserve": cands.get("sum of lines excl. 499000 Fund Balance Reserve"),
                    "max_abs_diff": abs(diffs[best]) if best else None,
                    "matches": (best if best and abs(diffs[best]) <= ROUNDING_TOLERANCE
                                else f"none (closest: {best}, off by {diffs[best]:,.0f})"
                                if best else "no total found"),
                    "passed": True})   # report only
    return out


def scenario_columns(cfg, scenario, year_now):
    """(scenario, basis, year) -> line-item column with the same figure."""
    rev = "_revised" if scenario == "revised" else ""
    return {(scenario, "projected", year_now - 1): f"projected{rev}_{year_now - 1}",
            (scenario, "proposed", year_now): f"proposed{rev}_{year_now}"}


def run(pdf, out=OUT_DIR):
    pdf = Path(pdf)
    cfg = json.loads((CONFIG_DIR / f"{pdf.stem}.json").read_text())
    scenarios = cfg.get("fund_balance", {}).get("scenarios", ["single"])
    page, lines = find_page(pdf, cfg)
    if page is None:
        print(f"{pdf.name}: no Fund Balance Projection page")
        return {"ok": True, "found": False}
    rows, checks = [], []
    for scenario, col_words in zip(scenarios, _segments(lines, len(scenarios))):
        entries = parse_column(col_words)
        r = classify(entries, scenario, pdf.name, page)
        rows += r
        checks += chain_checks(r, scenario, page)
        year_now = max(x["fiscal_year"] for x in r if x["fiscal_year"])
        checks += gf_total_checks(r, pdf.stem, scenario_columns(cfg, scenario, year_now))
    df = pd.DataFrame(rows)
    df.to_csv(Path(out) / f"fund_balance_{pdf.stem}.csv", index=False)
    ch = acknowledge_known_issues(pd.DataFrame(checks), pdf.name)
    ch.to_csv(Path(out) / f"fund_balance_checks_{pdf.stem}.csv", index=False)
    counts = check_counts(ch)
    print(f"{pdf.name}: Fund Balance Projection on p{page}, {len(scenarios)} column(s), "
          f"{len(df)} amounts; chain checks {counts['passed']}/{counts['checks']} passed, "
          f"{counts['acknowledged']} acknowledged, {counts['failed']} unreviewed")
    for c in ch[~ch.passed & (ch.acknowledged == "")].itertuples():
        print(f"  FAILED p{c.source_page} {c.label}: printed {c.printed}, computed {c.computed}")
    for c in ch[ch.level == "fund_balance_gf_total"].itertuples():
        print(f"  {c.label}: page {c.printed:,.0f} -> {c.matches}")
    return {"ok": counts["failed"] == 0, "found": True, "page": page, "rows": len(df),
            **counts}


def crossbook(out=OUT_DIR):
    """Book Y's projected 12/31/(Y-1) balance vs book Y+1's (unaudited)
    12/31/(Y-1) balance. Report only: these are expected to differ."""
    books = {}
    for f in Path(out).glob("fund_balance_*.csv"):
        if f.name.startswith(("fund_balance_checks_", "fund_balance_crossbook")):
            continue
        df = pd.read_csv(f)
        if len(df):
            books[int(df.fiscal_year.max())] = df
    rows = []
    for y, a in sorted(books.items()):
        b = books.get(y + 1)
        if b is None:
            continue
        as_of = f"{y - 1}-12-31"
        ends = a[(a.line_type == "ending_balance") & (a.as_of_date == as_of)]
        begins = b[(b.line_type == "beginning_balance") & (b.as_of_date == as_of)]
        for e in ends.itertuples():
            for g in begins.itertuples():
                rows.append({"as_of_date": as_of,
                             "book_a": e.source_doc, "scenario_a": e.scenario,
                             "label_a": e.label, "basis_a": e.basis, "amount_a": e.amount,
                             "book_b": g.source_doc, "scenario_b": g.scenario,
                             "label_b": g.label, "basis_b": g.basis, "amount_b": g.amount,
                             "gap_b_minus_a": g.amount - e.amount})
    df = pd.DataFrame(rows)
    df.to_csv(Path(out) / "fund_balance_crossbook.csv", index=False)
    return df


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    args = ap.parse_args()
    ok = run(args.pdf)["ok"]
    cb = crossbook()
    for r in cb.itertuples():
        print(f"  {r.as_of_date}: {r.book_a} {r.basis_a} {r.amount_a:,.0f} -> {r.book_b} "
              f"[{r.scenario_b}] {r.basis_b or 'as printed'} {r.amount_b:,.0f} "
              f"(gap {r.gap_b_minus_a:+,.0f})")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
