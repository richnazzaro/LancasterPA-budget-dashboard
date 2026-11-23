"""Extract and check the County's budget resolutions: the one-page summary the
Board of Commissioners adopts with each year's budget.

    python scripts/extract_county_resolutions.py            # every config in config/county/resolutions/
    python scripts/extract_county_resolutions.py 2026       # some budget years

Each resolution prints three columns (General Fund, Other Funds or "Funded
Agencies", Total) of receipts, the fund balance available at the start of the
year, expenditures and the fund balance remaining at the end. It is the only
County document that says how the General Fund's budget gap is covered: by the
fund balance (docs/COUNTY_RESEARCH.md section 3). config/county/resolutions/
<budget year>.json names the PDF (saved under Budget PDFs - County/Resolutions/),
its source URL and any reprint of it in a budget book.

The PDFs are Excel printouts with a text layer that splits amounts
("$ 1 42,786,672"). As in county_rows.py, amounts are rebuilt by position: the
right edges of the three columns are the right edges of the three amounts on the
"TOTAL <year> RECEIPTS" row (amounts are right-aligned), each word right of the
label area goes to the first column whose edge it does not pass, and the pieces
are joined in x order.

Every row is given a role from where it sits (headings, tax lines, other
revenue lines, receipts total, fund balance rows, expenditure lines and so on);
a row the extractor cannot place stops the run, so a changed layout is seen.

Checks (each column; $5 allowed for rounding):
  - the tax lines add to Total County Tax Receipts;
  - Total County Tax Receipts and the other revenue lines add to TOTAL RECEIPTS;
  - the expenditure lines add to TOTAL OPERATING EXPENDITURES;
  - receipts + fund balance available (+ reserve for encumbrances) = Total
    Receipts & Fund Balance;
  - expenditures (+ prior-year commitments expended) + fund balance remaining =
    Total Operating Expenditures & Fund Balance Remaining;
  - the two grand totals are equal;
  - the chain: balance at start + receipts - expenditures (with encumbrances in
    and commitments out) = balance remaining;
  - the planned draw (balance at start - balance remaining, net of
    encumbrances and commitments) = expenditures - receipts;
  - every row: General Fund + Other Funds = Total.
Checks against other documents (General Fund only):
  - TOTAL RECEIPTS and TOTAL OPERATING EXPENDITURES against the printed General
    Fund revenue and expense Grand Totals of every County budget book that
    prints the year (validation_<book>.csv, "grand total vs departments");
  - a reprint of the resolution in a budget book (Res 83 on p3 of the 2025
    book) must print every figure the same.

A difference over $5 fails the run unless data/county/known_issues.csv lists it
(same source_doc, page and label); it is still written with the note.

Writes, to data/processed/county/:
    resolutions_county.csv              every printed figure, one row per cell
    validation_resolutions_county.csv   every check
"""

import argparse
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from county_rows import _cluster  # noqa: E402  (rows of words by position)

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config" / "county" / "resolutions"
COUNTY_PDF_DIR = ROOT / "Budget PDFs - County"
PDF_DIR = COUNTY_PDF_DIR / "Resolutions"
OUT_DIR = ROOT / "data" / "processed" / "county"
KNOWN_ISSUES_FILE = ROOT / "data" / "county" / "known_issues.csv"
TOLERANCE = 5
EDGE_SLACK = 3  # points: a right-aligned amount ends within this of its column's edge

COLS = ["general_fund", "other_funds", "total"]
COLUMNS = ["budget_year", "resolution", "section", "role", "line", "as_of", "column", "column_label", "amount",
           "source_doc", "source_page"]
VALIDATION_COLUMNS = ["budget_year", "check", "label", "column", "printed", "computed", "diff", "passed",
                      "source_doc", "source_page", "known_issue"]

AMOUNT_RE = re.compile(r"^\d{1,3}(,\d{3})*$")
DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2})\b")
FOOT_AMOUNT_RE = re.compile(r"\$\s?([\d,]+)")


def norm(label):
    return re.sub(r"\s+", " ", label.replace("*", "")).strip()


def as_of(label):
    m = DATE_RE.search(label)
    return date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat() if m else ""


def column_edges(rows):
    """Right edges of the three amount columns, from the TOTAL <year> RECEIPTS row."""
    for r in rows:
        text = " ".join(w["text"] for w in r)
        if re.match(r"^TOTAL \d{4} RECEIPTS\b", text):
            # every amount on this row starts with "$"; each amount's last piece is its column's right edge
            dollars = [i for i, w in enumerate(r) if w["text"] == "$"]
            if len(dollars) != 3:
                raise ValueError(f"TOTAL RECEIPTS row does not print three amounts: {text!r}")
            ends = [r[j - 1] for j in dollars[1:]] + [r[-1]]
            if not all(AMOUNT_RE.match(w["text"]) for w in ends):
                raise ValueError(f"TOTAL RECEIPTS row does not end its amounts in digits: {text!r}")
            return [w["x1"] for w in ends], r[dollars[0]]["x0"] - 3
    raise ValueError("no TOTAL <year> RECEIPTS row")


def headers(rows, edges, label_limit):
    """Printed column headings ('GENERAL FUND', 'OTHER FUNDS' or 'FUNDED AGENCIES**', 'TOTAL')."""
    out, inside = {c: [] for c in COLS}, False
    for r in rows:
        text = " ".join(w["text"] for w in r)
        if text.startswith("REVENUE"):
            break
        if text == "OPERATING BUDGET":
            inside = True  # the headings are the rows between "OPERATING BUDGET" and "REVENUE"
            continue
        if not inside:
            continue
        for w in r:
            if w["x0"] < label_limit - 20:
                continue
            mid = (w["x0"] + w["x1"]) / 2
            # headings are centred over their column, roughly 30 pt left of its right edge
            i = min(range(3), key=lambda i: abs(edges[i] - 25 - mid))
            out[COLS[i]].append(w["text"])
    lab = {c: " ".join(v) for c, v in out.items()}
    if "GENERAL" not in lab["general_fund"] or lab["total"] != "TOTAL" or not lab["other_funds"]:
        raise ValueError(f"unexpected column headings: {lab}")
    return lab


def split_row(r, edges, label_limit):
    """(label, {column: amount}) for one printed row."""
    label = [w for w in r if w["x1"] <= label_limit]
    cells = {c: [] for c in COLS}
    for w in r:
        if w["x1"] <= label_limit:
            continue
        if w["x0"] < label_limit:
            raise ValueError(f"word crosses the label edge: {w['text']!r}")
        i = next((i for i, e in enumerate(edges) if w["x1"] <= e + EDGE_SLACK), None)
        if i is None:
            raise ValueError(f"word right of the last column: {w['text']!r}")
        cells[COLS[i]].append(w)
    amounts = {}
    for c, ws in cells.items():
        if not ws:
            continue
        s = "".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"])).lstrip("$")
        if not AMOUNT_RE.match(s):
            raise ValueError(f"not an amount in {c}: {s!r} ({' '.join(w['text'] for w in r)!r})")
        amounts[c] = int(s.replace(",", ""))
    return " ".join(w["text"] for w in label), amounts


def read_page(page):
    """Every printed figure on a resolution page, as dicts without the source fields."""
    rows = _cluster(page.extract_words())
    edges, label_limit = column_edges(rows)
    heads = headers(rows, edges, label_limit)
    out, section, state, heading = [], None, "start", ""
    footnotes, tail = [], False

    def add(role, label, amounts):
        for c in COLS:
            if c in amounts:
                out.append({"section": section, "role": role, "line": label, "as_of": as_of(label),
                            "column": c, "column_label": heads[c], "amount": amounts[c]})

    for r in rows:
        text = " ".join(w["text"] for w in r)
        if tail:
            m = re.match(r"^TAX RATE ON ASSESSED VALUE OF REAL ESTATE = ([\d.]+) MILLS$", text)
            if m:
                out.append({"section": "tax", "role": "millage", "line": text, "as_of": "", "column": "",
                            "column_label": "", "amount": m.group(1)})
                continue
            m = re.match(r"^TAXABLE ASSESSED VALUE = \$([\d,]+)$", text)
            if m:
                out.append({"section": "tax", "role": "assessed_value", "line": text, "as_of": "", "column": "",
                            "column_label": "", "amount": int(m.group(1).replace(",", ""))})
                continue
            m = re.match(r"^TAX INCREASE OVER \d{4} = (\d+)%$", text)
            if m:
                out.append({"section": "tax", "role": "tax_increase_pct", "line": text, "as_of": "", "column": "",
                            "column_label": "", "amount": int(m.group(1))})
                continue
            if text.startswith("*"):
                footnotes.append(text)
            elif footnotes:
                footnotes[-1] += " " + text  # a footnote that runs onto a second line
            continue
        if section is None:
            if text == "REVENUE":
                section = "revenue"
            continue
        if text == "EXPENDITURES":
            section, state = "expenditure", "start"
            continue
        label, amounts = split_row(r, edges, label_limit)
        key = norm(label)
        if not amounts:
            # headings: "County Tax Receipts--2026", "Total 2026 Operating Expenditures", and the first line of the
            # two-line grand total; a commitments row may print no amounts (2026)
            if re.search(r"Commitments Expended", key):
                continue
            heading = key
            if section == "revenue" and re.match(r"^County Tax Receipts", key):
                state = "tax"
            continue
        if section == "revenue":
            if re.match(r"^Total County Tax Receipts", key):
                role, state = "tax_total", "revenue"
            elif re.match(r"^TOTAL \d{4} RECEIPTS$", key):
                role, state = "receipts_total", "balance"
            elif state == "tax":
                role = "tax_line"
            elif state == "revenue":
                role = "revenue_line"
            elif state == "balance" and re.search(r"Fund Balance Available", key):
                role = "fb_start"
            elif state == "balance" and re.match(r"^Reserve for Encumbrances$", key):
                role = "encumbrances"
            elif state == "balance" and re.match(r"^Total Receipts & Fund Balance$", key):
                role, state = "resources_total", "done"
            else:
                raise ValueError(f"unplaced revenue row: {text!r}")
        else:
            if re.match(r"^TOTAL \d{4} OPERATING EXPENDITURES$", key):
                role, state = "exp_total", "after"
            elif state == "start":
                role = "expense_line"
            elif re.search(r"Commitments Expended", key):
                role = "commitments"
            elif re.search(r"Fund Balance Remaining", key) and re.match(r"^(&|And) ", key):
                role, label, tail = "uses_total", f"{heading} {label}", True
            elif re.search(r"Fund Balance Remaining", key):
                role = "fb_end"
            else:
                raise ValueError(f"unplaced expenditure row: {text!r}")
        add(role, norm(label), amounts)
    for f in footnotes:
        m = FOOT_AMOUNT_RE.search(f)
        out.append({"section": "footnote", "role": "footnote", "line": norm(f) if not f.startswith("*") else f,
                    "as_of": "", "column": "", "column_label": "", "amount": int(m.group(1).replace(",", "")) if m else ""})
    return out


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


def book_totals(year):
    """[(book, page, side, printed)] for every County book that prints `year`'s General Fund Grand Totals."""
    out = []
    for path in sorted(OUT_DIR.glob("validation_County-*-Budget-Book.csv")):
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if (r["check"] == "grand total vs departments" and r["column"] == f"budget_{year}"
                        and r["label"] in ("General Fund revenue", "General Fund expense")):
                    out.append((path.stem[len("validation_"):] + ".pdf", int(r["source_page"]),
                                r["label"].split()[-1], int(float(r["printed"]))))
    return out


def run(cfg, known):
    doc, page_no, fy = cfg["source_doc"], cfg["page"], cfg["budget_year"]
    with pdfplumber.open(PDF_DIR / doc) as pdf:
        figs = read_page(pdf.pages[page_no - 1])
    rows = [{"budget_year": fy, "resolution": cfg["resolution"], **f, "source_doc": doc, "source_page": page_no}
            for f in figs]
    checks = []

    def check(name, label, column, printed, computed, src_doc=doc, src_page=page_no):
        diff = printed - computed
        ok = abs(diff) <= TOLERANCE
        ki = "" if ok else next((k["note"] for k in known if k["source_doc"] == src_doc
                                 and str(k["source_page"]) == str(src_page) and k["label"] == label), "")
        checks.append({"budget_year": fy, "check": name, "label": label, "column": column, "printed": printed,
                       "computed": computed, "diff": diff, "passed": ok, "source_doc": src_doc,
                       "source_page": src_page, "known_issue": ki})

    cell = {}
    for r in rows:
        if r["column"]:
            cell.setdefault((r["role"], r["column"]), []).append(r)

    def one(role, c):
        lst = cell.get((role, c), [])
        if len(lst) > 1:
            raise ValueError(f"{doc}: {len(lst)} rows for {role}")
        return lst[0]["amount"] if lst else 0

    def total(role, c):
        return sum(r["amount"] for r in cell.get((role, c), []))

    for role in ("receipts_total", "fb_start", "resources_total", "exp_total", "fb_end", "uses_total"):
        if not cell.get((role, "general_fund")):
            raise ValueError(f"{doc}: no General Fund {role} row")
    for c in COLS:
        if cell.get(("tax_total", c)):
            check("tax lines", "Total County Tax Receipts", c, one("tax_total", c), total("tax_line", c))
        check("revenue lines", "TOTAL RECEIPTS", c, one("receipts_total", c),
              one("tax_total", c) + total("revenue_line", c))
        check("expenditure lines", "TOTAL OPERATING EXPENDITURES", c, one("exp_total", c), total("expense_line", c))
        start = one("fb_start", c) + one("encumbrances", c)
        check("receipts and fund balance", "Total Receipts & Fund Balance", c, one("resources_total", c),
              one("receipts_total", c) + start)
        check("expenditures and fund balance", "Total Operating Expenditures & Fund Balance Remaining", c,
              one("uses_total", c), one("exp_total", c) + one("commitments", c) + one("fb_end", c))
        check("grand totals agree", "Total Operating Expenditures & Fund Balance Remaining", c,
              one("uses_total", c), one("resources_total", c))
        check("fund balance chain", "Fund Balance Remaining", c, one("fb_end", c),
              start + one("receipts_total", c) - one("exp_total", c) - one("commitments", c))
        draw = start - one("commitments", c) - one("fb_end", c)
        check("planned draw = expenditures - receipts", "Fund Balance Remaining", c, draw,
              one("exp_total", c) - one("receipts_total", c))
    by_line = {}
    for r in rows:
        if r["column"]:
            by_line.setdefault((r["role"], r["line"]), {})[r["column"]] = r["amount"]
    for (role, line), v in by_line.items():
        check("General Fund + Other Funds = Total", line, "total", v.get("total", 0),
              v.get("general_fund", 0) + v.get("other_funds", 0))
    for book, page, side, printed in book_totals(fy):
        role = "receipts_total" if side == "revenue" else "exp_total"
        label = f"General Fund {side} Grand Total"
        check("budget book Grand Total", label, "general_fund", printed, one(role, "general_fund"),
              src_doc=book, src_page=page)
    for cp in cfg.get("copies", []):
        with pdfplumber.open(COUNTY_PDF_DIR / cp["source_doc"]) as pdf:
            copy = read_page(pdf.pages[cp["page"] - 1])
        mine = {(f["role"], f["line"], f["column"]): f["amount"] for f in figs if f["role"] != "footnote"}
        theirs = {(f["role"], f["line"], f["column"]): f["amount"] for f in copy if f["role"] != "footnote"}
        if set(mine) != set(theirs):
            raise ValueError(f"{cp['source_doc']} p{cp['page']} prints different rows from {doc}: "
                             f"{sorted(set(mine) ^ set(theirs))}")
        for k in mine:
            if k[0] in ("millage",):
                ok = mine[k] == theirs[k]
                checks.append({"budget_year": fy, "check": "reprint", "label": k[1], "column": k[2],
                               "printed": theirs[k], "computed": mine[k], "diff": 0 if ok else "", "passed": ok,
                               "source_doc": cp["source_doc"], "source_page": cp["page"], "known_issue": ""})
                continue
            check("reprint", k[1], k[2] or "-", theirs[k], mine[k], src_doc=cp["source_doc"], src_page=cp["page"])
    return rows, checks


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("years", nargs="*", type=int)
    args = ap.parse_args(argv)
    known = load_known()
    cfgs = {int(p.stem): json.loads(p.read_text()) for p in sorted(CONFIG_DIR.glob("*.json"))}
    years = args.years or sorted(cfgs)
    all_rows, all_checks, unlogged_n = [], [], 0
    for fy in years:
        rows, checks = run(cfgs[fy], known)
        all_rows += rows
        all_checks += checks
        bad = [c for c in checks if not c["passed"]]
        unlogged = [c for c in bad if not c["known_issue"]]
        unlogged_n += len(unlogged)
        gf = {r["role"]: r["amount"] for r in rows if r["column"] == "general_fund"}
        print(f"{cfgs[fy]['source_doc']} ({fy} budget): {len(rows)} figures, {len(checks)} checks, "
              f"{len(bad)} over ${TOLERANCE} ({len(bad) - len(unlogged)} in known_issues.csv). General Fund: "
              f"receipts {gf['receipts_total']:,}, expenditures {gf['exp_total']:,}, balance at start "
              f"{gf['fb_start']:,}, remaining {gf['fb_end']:,}")
        for c in bad:
            print(f"  {'KNOWN' if c['known_issue'] else 'FAIL '} {c['check']}: {c['label']} [{c['column']}] "
                  f"printed {c['printed']:,} computed {c['computed']:,} diff {c['diff']:+,} ({c['source_doc']} p{c['source_page']})")
    if not args.years:
        write_csv(OUT_DIR / "resolutions_county.csv", COLUMNS, all_rows)
        write_csv(OUT_DIR / "validation_resolutions_county.csv", VALIDATION_COLUMNS, all_checks)
        print(f"wrote {len(all_rows)} figures and {len(all_checks)} checks to {OUT_DIR.relative_to(ROOT)}/")
    if unlogged_n:
        print(f"{unlogged_n} differences not in {KNOWN_ISSUES_FILE.relative_to(ROOT)}")
    return 1 if unlogged_n else 0


if __name__ == "__main__":
    raise SystemExit(main())
