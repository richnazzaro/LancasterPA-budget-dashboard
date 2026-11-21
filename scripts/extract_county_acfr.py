"""Extract and check the County's audited actuals from its Annual Comprehensive
Financial Reports (ACFR), budgetary basis.

    python scripts/extract_county_acfr.py            # every config in config/county/acfr/
    python scripts/extract_county_acfr.py 2024 2025  # some years

Each ACFR prints one "Schedule of Revenues, Expenditures, and Changes in Fund
Balances - Budget and Actual, Budgetary Basis" per budgeted fund, with four
columns: Original budget, Final budget, Actual, and Variance with final budget.
config/county/acfr/<year>.json names the PDF pages (docs/COUNTY_RESEARCH.md,
"ACFR actuals: import spec").

The 2023 and 2024 text layers split many amounts ("3 ,398,006", "( 18,962,872)",
"$ 3 1,019,399"). As in county_rows.py, amounts are rebuilt by position, not by
splitting on spaces: the pieces of one amount touch (gap under 3 pt) while
columns are 15 pt or more apart, and each rebuilt amount goes to the column
whose header it sits under.

Checks inside each schedule (every column):
  - revenue lines add to Total revenues; expenditure lines to Total expenditures;
  - Excess = Total revenues - Total expenditures;
  - other financing lines add to their printed total, where one is printed;
  - Net change = Excess + other financing sources (uses);
  - each printed variance is the favourable difference from the final budget:
    Actual - Final for revenue, other financing and the net lines, and
    Final - Actual for expenditure.
Checks against the County's budget books (the book the site uses for the year):
  - General Fund original revenue = the book's General Fund revenue;
  - General Fund original expenditure + transfers out = the book's expenditure;
  - each special fund's original revenue + transfers in = the book's revenue,
    and its original expenditure = the book's expenditure.
Fund balances (Table 3, statistical section, GAAP / modified accrual): the
General Fund, other governmental funds and total, and the General Fund's
unassigned balance, for the ACFR's own year; the General Fund total must equal
the schedule's "Fund balance at December 31, modified accrual basis", and the
same year printed in a later ACFR's ten-year table must agree.
Each figure in data/county/acfr_substitutions.csv must read as recorded (both
the schedule's printed figure and the figure used instead).

Every check allows the books' $5 rounding. A difference over $5 fails the run
unless data/county/known_issues.csv lists it (same source_doc, page and label),
and is still written to the validation file with the note.

Writes, to data/processed/county/:
    actuals_acfr_<year>.csv         the schedule rows (budgetary basis)
    validation_acfr_<year>.csv      every check
    gaap_fund_balance_acfr.csv      Table 3 balances (GAAP), one row per fund group x year
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from county_rows import _cluster  # noqa: E402  (rows of words by position)

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config" / "county" / "acfr"
PDF_DIR = ROOT / "Budget PDFs - County" / "ACFR"
OUT_DIR = ROOT / "data" / "processed" / "county"
KNOWN_ISSUES_FILE = ROOT / "data" / "county" / "known_issues.csv"
SUBSTITUTIONS_FILE = ROOT / "data" / "county" / "acfr_substitutions.csv"
TOLERANCE = 5
PIECE_GAP = 3  # points: pieces of one split amount touch; columns are 15+ pt apart

COLUMNS = ["fiscal_year", "doc_type", "fund", "book_funds", "acfr_fund", "section", "row_type", "heading",
           "line", "basis", "original", "final", "actual", "variance", "source_doc", "source_page"]
CELLS = ["original", "final", "actual", "variance"]
VALIDATION_COLUMNS = ["check", "fund", "label", "column", "printed", "computed", "diff", "passed",
                      "source_doc", "source_page", "known_issue"]
GAAP_COLUMNS = ["fiscal_year", "group", "line", "amount", "basis", "source_doc", "source_page"]

NUM_RE = re.compile(r"^[$(]*[\d,.\-–]*[\d\-–][\d,.)]*$|^[$()]+$")
AMOUNT_RE = re.compile(r"^\(?\$?\(?([\d,]+|[-–])\)?$")


def norm(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def parse_amount(text):
    """'(1,234)' -> -1234, '-' -> 0. None when it is not an amount."""
    t = text.replace("$", "").replace(" ", "")
    if t in ("-", "–"):
        return 0
    m = AMOUNT_RE.match(t)
    if not m or not any(c.isdigit() for c in t):
        return None
    v = int(m.group(1).replace(",", ""))
    return -v if t.startswith("(") else v


def amounts_of(words):
    """Rebuild amounts from number pieces: [(text, x0, x1)] in x order, '$' dropped."""
    groups = []
    for w in sorted(words, key=lambda w: w["x0"]):
        if groups and w["x0"] - groups[-1][2] < PIECE_GAP:
            g = groups[-1]
            groups[-1] = (g[0] + w["text"], g[1], w["x1"])
        else:
            groups.append((w["text"], w["x0"], w["x1"]))
    out = []
    for text, x0, x1 in groups:
        text = text.replace("$", "")
        if text:
            out.append((text, x0, x1))
    return out


# --- budget-vs-actual schedules -----------------------------------------------------------------------

def schedule_rows(page):
    """[(label, {cell: amount})] for every printed row from the column header to the net change line,
    plus the rows below it (actual column only), and the header's column centres."""
    words = page.extract_words(x_tolerance=1.5, keep_blank_chars=False)
    rows = _cluster(words)
    header = None
    for r in rows:
        texts = [w["text"] for w in r]
        if "Original" in texts and "Final" in texts and "(Negative)" in texts:
            find = lambda t: next(w for w in r if w["text"] == t)
            actual = next(w for w in r if w["text"] == "Amounts")
            header = {"top": r[0]["top"], "label_limit": find("Original")["x0"] - 15,
                      "centres": [(c, (w["x0"] + w["x1"]) / 2) for c, w in
                                  zip(CELLS, (find("Original"), find("Final"), actual, find("(Negative)")))]}
            break
    if header is None:
        raise ValueError(f"p{page.page_number}: no Original / Final / Amounts / (Negative) header row")
    out = []
    for r in rows:
        if r[0]["top"] <= header["top"] + 1:
            continue
        label = [w for w in r if w["x1"] < header["label_limit"]]
        nums = [w for w in r if w["x1"] >= header["label_limit"]]
        if any(not NUM_RE.match(w["text"]) for w in nums):
            raise ValueError(f"p{page.page_number}: text in the amount columns: {' '.join(w['text'] for w in r)}")
        cells = {}
        for text, x0, x1 in amounts_of(nums):
            v = parse_amount(text)
            if v is None:
                raise ValueError(f"p{page.page_number}: cannot read amount {text!r} in row {' '.join(w['text'] for w in r)}")
            mid = (x0 + x1) / 2
            col = min(header["centres"], key=lambda c: abs(c[1] - mid))[0]
            if col in cells:
                raise ValueError(f"p{page.page_number}: two amounts in the {col} column: {' '.join(w['text'] for w in r)}")
            cells[col] = v
        out.append((" ".join(w["text"] for w in label).strip(), cells))
    return out


def parse_schedule(page, sched, cfg):
    """Rows of one schedule as CSV dicts, from REVENUES to the net change line."""
    rows = schedule_rows(page)
    out, section, heading, done = [], None, "", False
    title = " ".join(w["text"] for w in page.extract_words()[:40])
    if norm(sched["acfr_fund"]) not in norm(title):
        raise ValueError(f"p{page.page_number}: expected the {sched['acfr_fund']} schedule")
    for label, cells in rows:
        low = label.lower()
        if done:
            break
        if not cells:
            if low == "revenues":
                section = "revenue"
            elif low == "expenditures":
                section = "expenditure"
            elif low.startswith("other financing"):
                section = "transfer"
            elif label.endswith(":") and section:
                heading = label[:-1] if low != "current:" else ""
            continue
        if section is None:
            continue  # page title lines carry no amounts; anything else before REVENUES is not ours
        if low.startswith("total revenues"):
            row_type, sec = "total", "revenue"
        elif low.startswith("total expenditures"):
            row_type, sec = "total", "expenditure"
        elif low.startswith("excess"):
            row_type, sec, section, heading = "excess", "net_change", "transfer", ""
        elif low.startswith("total other financing"):
            row_type, sec = "total", "transfer"
        elif low.startswith("net change in fund balance"):
            row_type, sec, done = "net_change", "net_change", True
        else:
            row_type, sec = "line", section
            if low == "capital outlay":
                heading = ""  # its own category, printed after the "Current:" lines
        out.append({"fiscal_year": cfg["fiscal_year"], "doc_type": "actual", "fund": sched["fund"],
                    "book_funds": ";".join(sched["book_funds"]), "acfr_fund": sched["acfr_fund"],
                    "section": sec, "row_type": row_type, "heading": heading if row_type == "line" else "",
                    "line": label, "basis": "budgetary",
                    **{c: cells.get(c, "") for c in CELLS},
                    "source_doc": cfg["source_doc"], "source_page": page.page_number})
        if row_type != "line":
            heading = ""
    if not done:
        raise ValueError(f"p{page.page_number}: no 'Net change in fund balances' row")
    below = []
    started = False
    for label, cells in rows:
        if label.lower().startswith("net change in fund balance"):
            started = True
            continue
        if started and cells:
            below.append((label, cells))
    return out, below


def v(row, col):
    x = row.get(col, "")
    return 0 if x == "" else int(x)


def schedule_checks(rows, below, add):
    fund = rows[0]["fund"]
    by_type = defaultdict(list)
    for r in rows:
        by_type[(r["section"], r["row_type"])].append(r)

    def one(key):
        found = by_type.get(key, [])
        if len(found) != 1:
            add("schedule row", fund, f"{fund}: one {key[0]} {key[1]} row", "count", 1, len(found), rows[0]["source_page"])
            return None
        return found[0]

    rev_t, exp_t, excess, net = (one(k) for k in (("revenue", "total"), ("expenditure", "total"),
                                                  ("net_change", "excess"), ("net_change", "net_change")))
    fin_lines = by_type.get(("transfer", "line"), [])
    fin_t = by_type.get(("transfer", "total"), [])
    page = rows[0]["source_page"]
    for c in CELLS:
        for sec, tot in (("revenue", rev_t), ("expenditure", exp_t)):
            if tot:
                add("lines add to total", fund, f"{fund} {tot['line']}", c, v(tot, c),
                    sum(v(r, c) for r in by_type[(sec, "line")]), page)
        if fin_t:
            add("lines add to total", fund, f"{fund} {fin_t[0]['line']}", c, v(fin_t[0], c),
                sum(v(r, c) for r in fin_lines), page)
        if excess and rev_t and exp_t:
            # The variance of an expenditure is final - actual, so the excess variance is their sum.
            want = v(rev_t, c) + v(exp_t, c) if c == "variance" else v(rev_t, c) - v(exp_t, c)
            add("excess foots", fund, f"{fund} {excess['line']}", c, v(excess, c), want, page)
        if net and excess:
            add("net change foots", fund, f"{fund} {net['line']}", c, v(net, c),
                v(excess, c) + sum(v(r, c) for r in fin_lines), page)
    for r in rows:
        if r["variance"] == "" and r["final"] == "" and r["actual"] == "":
            continue
        fav = v(r, "final") - v(r, "actual") if r["section"] == "expenditure" else v(r, "actual") - v(r, "final")
        add("variance = favourable difference from final", fund, f"{fund} {r['line']}", "variance",
            v(r, "variance"), fav, page)
    # Below the line: cash-basis roll-forward (fund balance January 1 + net change + interfund change = December 31).
    jan = [c["actual"] for lab, c in below if "january 1" in lab.lower() and "actual" in c]
    dec = [c["actual"] for lab, c in below if "december 31, cash basis" in lab.lower() and "actual" in c]
    if net and jan and dec:
        moves = 0
        for lab, c in below:
            if "january 1" in lab.lower():
                break
            moves += c.get("actual", 0)
        add("cash-basis fund balance rolls forward", fund, f"{fund} Fund balance, December 31, cash basis", "actual",
            dec[0], jan[0] + v(net, "actual") + moves, page)
    mod = [(lab, c) for lab, c in below if "modified accrual basis" in lab.lower() and "actual" in c]
    if dec and mod:
        recon, started = 0, False
        for lab, c in below:
            if "december 31, cash basis" in lab.lower():
                started = True
                continue
            if started and "modified accrual" not in lab.lower():
                recon += c.get("actual", 0)
        add("modified-accrual fund balance reconciles", fund, f"{fund} {mod[0][0]}", "actual",
            mod[0][1]["actual"], dec[0] + recon, page)
    return {"modified_accrual": mod[0][1]["actual"] if mod else None}


# --- tie-outs against the budget books ----------------------------------------------------------------

def book_totals(fy):
    """{(fund, side): amount} and the book used for the year (the newest book that prints it)."""
    best = None
    for path in sorted(OUT_DIR.glob("budget_long_*.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f) if r["doc_type"] == "budget"]
        years = {int(r["fiscal_year"]) for r in rows}
        if fy in years and (best is None or max(years) > best[0]):
            best = (max(years), rows)
    if best is None:
        return None, {}
    tot = defaultdict(float)
    doc = None
    for r in best[1]:
        if int(r["fiscal_year"]) == fy:
            tot[(r["fund"], "revenue" if r["side"] == "revenue" else "expense")] += float(r["amount"] or 0)
            doc = r["source_doc"]
    return doc, tot


def tieouts(rows, cfg, add):
    fy = cfg["fiscal_year"]
    doc, book = book_totals(fy)
    if doc is None:
        print(f"  no budget book prints {fy}: tie-outs skipped")
        return
    by_fund = defaultdict(list)
    for r in rows:
        by_fund[r["fund"]].append(r)
    for sched in cfg["schedules"]:
        rs = by_fund[sched["fund"]]
        page = sched["page"]
        find = lambda sec, rt: [r for r in rs if r["section"] == sec and r["row_type"] == rt]
        rev = sum(v(r, "original") for r in find("revenue", "total"))
        exp = sum(v(r, "original") for r in find("expenditure", "total"))
        tin = sum(v(r, "original") for r in find("transfer", "line") if r["line"].lower().startswith("transfers in"))
        tout = -sum(v(r, "original") for r in find("transfer", "line") if r["line"].lower().startswith("transfers out"))
        brev = sum(book[(f, "revenue")] for f in sched["book_funds"])
        bexp = sum(book[(f, "expense")] for f in sched["book_funds"])
        f = sched["fund"]
        if f == "General Fund":
            add("ACFR original vs book", f, f"{fy} General Fund original revenue vs {doc}", "original",
                rev, round(brev), page)
            add("ACFR original vs book", f, f"{fy} General Fund original expenditure + transfers out vs {doc}", "original",
                exp + tout, round(bexp), page)
        else:
            add("ACFR original vs book", f, f"{fy} {f} original revenue + transfers in vs {doc}", "original",
                rev + tin, round(brev), page)
            add("ACFR original vs book", f, f"{fy} {f} original expenditure vs {doc}", "original",
                exp, round(bexp), page)


# --- governmental funds statement (GAAP): General Fund transfers out -----------------------------------

def gaap_transfers_out(page):
    """The General Fund (first) column of the "Transfers out" row of the governmental funds statement."""
    text = " ".join(w["text"] for w in page.extract_words()[:40])
    if "Governmental Funds" not in text:
        raise ValueError(f"p{page.page_number}: not the governmental funds statement")
    for r in _cluster(page.extract_words(x_tolerance=1.5)):
        label = " ".join(w["text"] for w in r if not NUM_RE.match(w["text"]))
        if label == "Transfers out":
            amts = amounts_of([w for w in r if NUM_RE.match(w["text"])])
            return parse_amount(amts[0][0])
    raise ValueError(f"p{page.page_number}: no Transfers out row")


# --- Table 3: fund balances (GAAP) -----------------------------------------------------------------------

GAAP_LINES = [("General Fund", "Unassigned"), ("General Fund", "Total general fund"),
              ("Other governmental funds", "Total all other governmental funds"),
              ("All governmental funds", "Total fund balances of all governmental funds")]


def fund_balance_table(page, cfg):
    rows = _cluster(page.extract_words(x_tolerance=1.5))
    years = None
    for r in rows:
        ys = [w for w in r if re.fullmatch(r"20\d\d", w["text"])]
        if len(ys) == 10:
            years = [(int(w["text"]), (w["x0"] + w["x1"]) / 2) for w in ys]
            break
    if not years:
        raise ValueError(f"p{page.page_number}: no ten-year header")
    out, in_gf = [], False
    label_prev = ""
    for r in rows:
        label = " ".join(w["text"] for w in r if w["x1"] < years[0][1] - 40)
        nums = [w for w in r if w["x1"] >= years[0][1] - 40]
        if label.lower().startswith("general fund"):
            in_gf = True
        if label.lower().startswith("all other governmental"):
            in_gf = False
        full = (label_prev + " " + label).strip() if label_prev.lower().startswith("total fund balances") else label
        label_prev = label
        for group, want in GAAP_LINES:
            if norm(full) != norm(want) or (group == "General Fund" and want == "Unassigned" and not in_gf):
                continue
            amts = amounts_of(nums)
            if len(amts) != 10:
                raise ValueError(f"p{page.page_number}: {want}: {len(amts)} amounts, not 10")
            for (text, x0, x1), (yr, centre) in zip(amts, years):
                val = parse_amount(text)
                if val is None:
                    raise ValueError(f"p{page.page_number}: cannot read {text!r}")
                out.append({"fiscal_year": yr, "group": group, "line": want, "amount": val, "basis": "modified accrual (GAAP)",
                            "source_doc": cfg["source_doc"], "source_page": page.page_number})
    found = {(r["group"], r["line"]) for r in out}
    if found != set(GAAP_LINES):
        raise ValueError(f"p{page.page_number}: fund balance lines missing: {set(GAAP_LINES) - found}")
    return out


# --- run --------------------------------------------------------------------------------------------------

def load_known():
    if not KNOWN_ISSUES_FILE.exists():
        return []
    with KNOWN_ISSUES_FILE.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path, columns, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def run(cfg, known):
    pdf_path = PDF_DIR / cfg["source_doc"]
    checks = []

    def add(check, fund, label, column, printed, computed, page):
        diff = printed - computed
        hit = [k for k in known if k["source_doc"] == cfg["source_doc"] and str(k["source_page"]) == str(page)
               and norm(k["label"]) == norm(label)]
        checks.append({"check": check, "fund": fund, "label": label, "column": column, "printed": printed,
                       "computed": computed, "diff": diff, "passed": abs(diff) <= TOLERANCE,
                       "source_doc": cfg["source_doc"], "source_page": page,
                       "known_issue": hit[0]["note"][:80] + "..." if hit and abs(diff) > TOLERANCE else ""})

    rows, gaap = [], []
    with pdfplumber.open(pdf_path) as pdf:
        for sched in cfg["schedules"]:
            page = pdf.pages[sched["page"] - 1]
            srows, below = parse_schedule(page, sched, cfg)
            rows.extend(srows)
            extra = schedule_checks(srows, below, add)
            if sched["fund"] == "General Fund":
                gf_mod = extra["modified_accrual"]
        gp = cfg["gaap_statement_page"]
        gaap_out = gaap_transfers_out(pdf.pages[gp - 1])
        t3 = cfg["fund_balance_table_page"]
        gaap = fund_balance_table(pdf.pages[t3 - 1], cfg)
    fy = cfg["fiscal_year"]
    gf_t3 = next(r["amount"] for r in gaap if r["fiscal_year"] == fy and r["line"] == "Total general fund")
    add("Table 3 vs General Fund schedule", "General Fund", f"{fy} Total general fund (Table 3) vs schedule modified accrual balance",
        "actual", gf_t3, gf_mod, t3)
    # Transfers are the same on both bases (2025 Notes to RSI): the schedule's actual must equal the statement's.
    sched_out = next(v(r, "actual") for r in rows if r["fund"] == "General Fund" and r["line"] == "Transfers out")
    gf_page = next(s["page"] for s in cfg["schedules"] if s["fund"] == "General Fund")
    add("schedule vs governmental funds statement", "General Fund",
        f"{fy} General Fund Transfers out actual vs governmental funds statement p{gp}", "actual", sched_out, gaap_out, gf_page)
    # A figure the site takes from another page (data/county/acfr_substitutions.csv) must still read as recorded.
    if SUBSTITUTIONS_FILE.exists():
        with SUBSTITUTIONS_FILE.open(newline="", encoding="utf-8") as f:
            subs = [r for r in csv.DictReader(f) if int(r["fiscal_year"]) == fy]
        for sub in subs:
            if not (sub["fund"] == "General Fund" and sub["line"] == "Transfers out" and int(sub["used_page"]) == gp):
                raise ValueError(f"acfr_substitutions.csv: only General Fund transfers out from the governmental funds statement is supported: {sub}")
            add("substitution as recorded", sub["fund"], f"{fy} substitution {sub['fund']} {sub['line']} printed", sub["column"],
                int(sub["printed"]), sched_out, int(sub["printed_page"]))
            add("substitution as recorded", sub["fund"], f"{fy} substitution {sub['fund']} {sub['line']} used", sub["column"],
                int(sub["used"]), gaap_out, int(sub["used_page"]))
    tieouts(rows, cfg, add)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(OUT_DIR / f"actuals_acfr_{fy}.csv", COLUMNS, rows)
    write_csv(OUT_DIR / f"validation_acfr_{fy}.csv", VALIDATION_COLUMNS, checks)
    return rows, gaap, checks


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("years", nargs="*", type=int)
    args = ap.parse_args()
    known = load_known()
    cfgs = {int(p.stem): json.loads(p.read_text()) for p in sorted(CONFIG_DIR.glob("*.json"))}
    years = args.years or sorted(cfgs)
    unknown_fail = 0
    gaap_all = []
    for fy in years:
        rows, gaap, checks = run(cfgs[fy], known)
        gaap_all.extend(gaap)
        bad = [c for c in checks if not c["passed"]]
        unlogged = [c for c in bad if not c["known_issue"]]
        unknown_fail += len(unlogged)
        print(f"{cfgs[fy]['source_doc']}: {len(rows)} schedule rows, {len(checks)} checks, "
              f"{len(bad)} over ${TOLERANCE} ({len(bad) - len(unlogged)} in known_issues.csv)")
        for c in bad:
            print(f"  {'KNOWN' if c['known_issue'] else 'FAIL '} p{c['source_page']} {c['label']} [{c['column']}]: "
                  f"printed {c['printed']:,} computed {c['computed']:,} diff {c['diff']:+,}")
    # Table 3: keep each year from its own ACFR; a later ACFR printing the same year must agree.
    if not args.years:
        own = {}
        for r in gaap_all:
            k = (r["fiscal_year"], r["group"], r["line"])
            if int(r["source_doc"][12:16]) == r["fiscal_year"]:
                own[k] = r
        for r in gaap_all:
            k = (r["fiscal_year"], r["group"], r["line"])
            if k in own and own[k] is not r and own[k]["amount"] != r["amount"]:
                unknown_fail += 1
                print(f"  FAIL Table 3 {k}: {own[k]['source_doc']} {own[k]['amount']:,} vs {r['source_doc']} {r['amount']:,}")
        write_csv(OUT_DIR / "gaap_fund_balance_acfr.csv", GAAP_COLUMNS,
                  sorted(own.values(), key=lambda r: (r["fiscal_year"], [g for g, _ in GAAP_LINES].index(r["group"]), r["line"])))
        print(f"Table 3 fund balances: {len(own)} figures for {sorted({k[0] for k in own})}, "
              f"each agreeing with every later ACFR that prints its year")
    if unknown_fail:
        print(f"{unknown_fail} differences not in {KNOWN_ISSUES_FILE.relative_to(ROOT)}")
    return 1 if unknown_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
