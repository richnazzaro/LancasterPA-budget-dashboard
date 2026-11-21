"""Extract and validate one County of Lancaster budget book.

    python scripts/extract_county.py "Budget PDFs - County/County-2026-Budget-Book.pdf"

The County books print each year's budget beside the prior year's, with the
variance and percent change. The line items come from the "Department Account"
reports (General Fund and Other Funds). Every other table in the book is used
as a check:

  - each department's printed total vs the sum of its lines;
  - each report's Grand Total vs the sum of its departments;
  - the "by department" report vs the department totals;
  - the "by account" report vs the lines summed across departments;
  - the department pages (2026 book onward) vs the lines, line by line;
  - every row's printed variance vs (new year - prior year).

Writes, to data/processed/county/:
    line_items_<stem>.csv   one row per line: both budget years, as printed
    budget_long_<stem>.csv  one row per line x year (the build's input)
    validation_<stem>.csv   every check, printed vs parsed

Exit status 1 when a check fails and is not acknowledged in
data/county/known_issues.csv; 0 otherwise.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from county_rows import (DEPT_CODE_RE, amount, open_pdf, page_kind,  # noqa: E402
                         read_page, split_label)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "processed" / "county"
CONFIG_DIR = ROOT / "config" / "county"
KNOWN_ISSUES_FILE = ROOT / "data" / "county" / "known_issues.csv"

# The County's spreadsheet rounds each cell on its own, as the city's does.
ROUNDING_TOLERANCE = 5

LONG_COLUMNS = ["fiscal_year", "doc_type", "fund", "section", "department_code",
                "department", "account_code", "account", "account_name", "side",
                "category", "amount", "source_doc", "source_page"]


def is_footer(label_words):
    return bool(label_words) and label_words[0][0] == "Page"


def num(cell):
    v = amount(cell)
    return 0 if v is None else v


class Book:
    def __init__(self, pdf_path, cfg=None):
        self.cfg = cfg or {}
        self.pdf = Path(pdf_path)
        self.doc = self.pdf.name
        self.years = None
        self.lines = []          # detail line items
        self.dept_totals = []    # printed department totals in the detail reports
        self.grand = []          # printed grand totals in the detail reports
        self.bydept = []         # "by department" report rows
        self.byaccount = []      # "by account" report rows (accounts and group totals)
        self.dept_pages = []     # department page lines and totals (2026 book onward)
        self.groups = {}         # 2-digit account group -> printed name ("61" -> "Taxes")
        self.variance = []       # (page, label, y1, y2, printed variance)
        self.unparsed = []

    # --- reading -------------------------------------------------------------

    def read(self):
        with open_pdf(self.pdf) as pdf:
            prev_kind, bounds = None, None
            dp_state = {}
            for page_no, page in enumerate(pdf.pages, 1):
                text = (page.extract_text() or "").strip().splitlines()
                kind, section, side = page_kind(text)
                if kind == "deptpage-cont" and prev_kind not in ("deptpage", "deptpage-cont"):
                    kind = None
                if kind is None and prev_kind in ("deptpage", "deptpage-cont") and text \
                        and "$" in text[0] and not text[0].startswith("County of"):
                    kind = "deptpage-cont"
                if kind in (None, "deptsummary"):
                    prev_kind = kind
                    continue
                b, rows = read_page(page, bounds if kind == "deptpage-cont" else None)
                if not b:
                    self.unparsed.append((page_no, "no column header"))
                    prev_kind = kind
                    continue
                bounds = b
                if self.years is None:
                    self.years = b["years"]
                elif self.years != b["years"]:
                    self.unparsed.append((page_no, f"years {b['years']} differ from {self.years}"))
                if kind == "detail":
                    self._detail(page_no, section, side, b, rows)
                elif kind == "bydept":
                    self._bydept(page_no, section, side, b, rows)
                elif kind == "byaccount":
                    self._byaccount(page_no, section, side, b, rows)
                else:
                    self._deptpage(page_no, b, rows, dp_state)
                prev_kind = kind

    def _values(self, page_no, label, cells):
        y1, y2, var = amount(cells[0]), amount(cells[1]), amount(cells[2])
        if var is not None:
            self.variance.append((page_no, label, num(cells[0]), num(cells[1]), var))
        return y1, y2

    def _detail(self, page_no, section, side, b, rows):
        st = getattr(self, "_dstate", {})
        if st.get("key") != (section, side):
            st = {"key": (section, side), "fund": None, "code": None, "dept": None}
        for r in rows:
            if is_footer(r["label_words"]) or not r["label_words"]:
                continue
            fund, dept, acct, name = split_label(r["label_words"], b["label"])
            if fund == "Grand Total" or dept == "Grand Total":
                y1, y2 = self._values(page_no, f"{section} {side} Grand Total", r["cells"])
                self.grand.append(dict(section=section, side=side, page=page_no, y1=y1, y2=y2))
                continue
            if fund:
                st["fund"] = fund
            if dept.endswith(" Total") and not acct:
                y1, y2 = self._values(page_no, dept, r["cells"])
                self.dept_totals.append(dict(section=section, side=side, fund=st["fund"],
                                             code=st["code"], department=st["dept"],
                                             printed_name=dept[:-6], page=page_no, y1=y1, y2=y2))
                continue
            if dept:
                parts = dept.split(" ", 1)
                if DEPT_CODE_RE.match(parts[0]):
                    st["code"], st["dept"] = parts[0], parts[1] if len(parts) > 1 else ""
                else:
                    st["code"], st["dept"] = None, dept
            if not acct:
                self.unparsed.append((page_no, " ".join(t for t, _ in r["label_words"])))
                continue
            y1, y2 = self._values(page_no, f"{st['dept']} {acct}", r["cells"])
            self.lines.append(dict(section=section, side=side, fund=st["fund"] or "",
                                   department_code=st["code"], department=st["dept"],
                                   account=acct, account_name=name, y1=y1, y2=y2,
                                   page=page_no))
        self._dstate = st

    def _bydept(self, page_no, section, side, b, rows):
        for r in rows:
            if is_footer(r["label_words"]) or not r["label_words"]:
                continue
            # Some pages print the revenue and the expenditure report one above
            # the other; the second report's title and header switch the side.
            if "Budgeted Revenues" in r["text"] or "Budgeted Expenditures" in r["text"]:
                side = "revenue" if "Revenues" in r["text"] else "expense"
                continue
            if r["text"].startswith("Department ") and "BUDGET" in r["text"]:
                continue
            label = " ".join(t for t, _ in r["label_words"])
            y1, y2 = self._values(page_no, label, r["cells"])
            parts = label.split(" ", 1)
            code = parts[0] if DEPT_CODE_RE.match(parts[0]) else None
            name = parts[1] if code else label
            self.bydept.append(dict(section=section, side=side, code=code, department=name,
                                    page=page_no, y1=y1, y2=y2))

    def _byaccount(self, page_no, section, side, b, rows):
        group = getattr(self, "_agroup", None)
        for r in rows:
            if is_footer(r["label_words"]) or not r["label_words"]:
                continue
            words = r["label_words"]
            label = " ".join(t for t, _ in words)
            y1, y2 = self._values(page_no, label, r["cells"])
            if label == "Grand Total":
                self.byaccount.append(dict(section=section, side=side, kind="grand",
                                           group=None, account=None, page=page_no, y1=y1, y2=y2))
                continue
            first = words[0][0]
            if first.isdigit() and len(first) == 2:
                group = first
                rest = [t for t, _ in words[1:]]
                if rest and rest[0] == "Total":
                    self.byaccount.append(dict(section=section, side=side, kind="group",
                                               group=group, account=None, page=page_no,
                                               y1=y1, y2=y2))
                    continue
                # "61 Taxes 6111Real Estate At Discount": group name, then the account
                name_words, acct_words = [], []
                for t in rest:
                    if acct_words or (t[:4].isdigit() and len(t) >= 4):
                        acct_words.append(t)
                    else:
                        name_words.append(t)
                self.groups[group] = " ".join(name_words)
                words_acct = acct_words
            else:
                words_acct = [t for t, _ in words]
            acct = words_acct[0][:4] if words_acct and words_acct[0][:4].isdigit() else None
            if acct is None:
                self.unparsed.append((page_no, label))
                continue
            self.byaccount.append(dict(section=section, side=side, kind="account", group=group,
                                       account=acct, page=page_no, y1=y1, y2=y2))
        self._agroup = group

    def _deptpage(self, page_no, b, rows, st):
        for r in rows:
            if is_footer(r["label_words"]) or not r["label_words"]:
                continue
            fund, dept, acct, name = split_label(r["label_words"], b["label"])
            if dept in ("Revenue Total", "Expense Total"):
                y1, y2 = self._values(page_no, f"{st.get('code')} {dept}", r["cells"])
                self.dept_pages.append(dict(kind="total", code=st.get("code"),
                                            side="revenue" if dept.startswith("Revenue") else "expense",
                                            account=None, page=page_no, y1=y1, y2=y2))
                continue
            if dept:
                parts = dept.split(" ", 1)
                if DEPT_CODE_RE.match(parts[0]):
                    st["code"] = parts[0]
            if not acct:
                self.unparsed.append((page_no, " ".join(t for t, _ in r["label_words"])))
                continue
            y1, y2 = self._values(page_no, f"{st.get('code')} {acct}", r["cells"])
            self.dept_pages.append(dict(kind="line", code=st.get("code"),
                                        side="revenue" if acct.startswith("6") else "expense",
                                        account=acct, page=page_no, y1=y1, y2=y2))

    # --- fixing up -----------------------------------------------------------

    def fill_codes(self):
        """Other Funds reports print department names, not codes; take the
        code from the book's own "by department" report."""
        by_name = {(r["department"]): r["code"] for r in self.bydept if r["code"]}
        for row in self.lines + self.dept_totals:
            if not row.get("department_code" if "department_code" in row else "code"):
                code = by_name.get(row["department"])
                if "department_code" in row:
                    row["department_code"] = code
                else:
                    row["code"] = code

    # --- checks --------------------------------------------------------------

    def checks(self):
        out = []
        y1n, y2n = (f"budget_{y}" for y in self.years)

        def add(check, page, label, printed, computed, column):
            p = 0 if printed is None else printed
            c = 0 if computed is None else computed
            diff = round(c - p, 2)
            out.append(dict(check=check, source_page=page, label=label, column=column,
                            printed=p, parsed=c, diff=diff,
                            passed=abs(diff) <= ROUNDING_TOLERANCE))

        def pair(check, page, label, printed, computed):
            add(check, page, label, printed[0], computed[0], y1n)
            add(check, page, label, printed[1], computed[1], y2n)

        lines = pd.DataFrame(self.lines)
        lines[["y1", "y2"]] = lines[["y1", "y2"]].fillna(0)

        # 1. department totals vs their lines (detail reports)
        for t in self.dept_totals:
            m = lines[(lines.section == t["section"]) & (lines.side == t["side"])
                      & (lines.department == t["department"]) & (lines.fund == (t["fund"] or ""))]
            pair("department total", t["page"], f"{t['section']} {t['side']}: {t['printed_name']}",
                 (num_or0(t["y1"]), num_or0(t["y2"])), (m.y1.sum(), m.y2.sum()))
            if t["printed_name"] != t["department"]:
                add("department total name", t["page"], f"{t['printed_name']} vs {t['department']}",
                    0, 1, "name")

        # 2. grand totals vs the printed department totals (each of which is
        # checked against its lines above; summing ~1,200 separately rounded
        # lines straight to the grand total drifts by more than $5)
        for g in self.grand:
            ts = [t for t in self.dept_totals if t["section"] == g["section"] and t["side"] == g["side"]]
            pair("grand total vs departments", g["page"], f"{g['section']} {g['side']}",
                 (num_or0(g["y1"]), num_or0(g["y2"])),
                 (sum(num_or0(t["y1"]) for t in ts), sum(num_or0(t["y2"]) for t in ts)))

        # 3. by-department report vs detail department totals
        dt = defaultdict(lambda: [0, 0])
        for t in self.dept_totals:
            k = (t["section"], t["side"], t["code"] or t["department"])
            dt[k][0] += num_or0(t["y1"])
            dt[k][1] += num_or0(t["y2"])
        for r in self.bydept:
            if r["department"] == "Grand Total":
                ts = [t for t in self.dept_totals if t["section"] == r["section"] and t["side"] == r["side"]]
                pair("by-department grand total", r["page"], f"{r['section']} {r['side']}",
                     (num_or0(r["y1"]), num_or0(r["y2"])),
                     (sum(num_or0(t["y1"]) for t in ts), sum(num_or0(t["y2"]) for t in ts)))
                continue
            k = (r["section"], r["side"], r["code"] or r["department"])
            got = dt.get(k)
            if got is None:
                m = lines[(lines.section == r["section"]) & (lines.side == r["side"])
                          & (lines.department_code == r["code"])]
                got = (m.y1.sum(), m.y2.sum())
            pair("by-department report", r["page"], f"{r['section']} {r['side']}: {r['code']} {r['department']}",
                 (num_or0(r["y1"]), num_or0(r["y2"])), got)

        # 4. by-account report vs lines summed across departments
        for r in self.byaccount:
            m = lines[(lines.section == r["section"]) & (lines.side == r["side"])]
            if r["kind"] == "account":
                m = m[m.account == r["account"]]
                label = f"{r['side']} account {r['account']}"
            else:
                # group and grand totals: against the printed rows they add up
                # (the account rows, each checked against the lines, and the
                # group totals), since lines summed across every department
                # drift past $5 from separately rounded cells
                same = [a for a in self.byaccount if a["section"] == r["section"] and a["side"] == r["side"]]
                if r["kind"] == "group":
                    parts = [a for a in same if a["kind"] == "account" and a["group"] == r["group"]]
                    label = f"{r['side']} account group {r['group']} total"
                else:
                    parts = [a for a in same if a["kind"] == "group"]
                    label = f"{r['side']} by-account Grand Total"
                pair("by-account report", r["page"], f"{r['section']} {label}",
                     (num_or0(r["y1"]), num_or0(r["y2"])),
                     (sum(num_or0(a["y1"]) for a in parts), sum(num_or0(a["y2"]) for a in parts)))
                continue
            pair("by-account report", r["page"], f"{r['section']} {label}",
                 (num_or0(r["y1"]), num_or0(r["y2"])), (m.y1.sum(), m.y2.sum()))

        # 5. department pages vs detail lines. A department page normally
        # holds every line with its code; the book config can limit a page to
        # some sections, or add lines printed under another department
        # (config "department_pages").
        rules = self.cfg.get("department_pages", {})

        def page_lines(code):
            rule = rules.get(code, {})
            m = lines[lines.department_code == code]
            if rule.get("sections"):
                m = m[m.section.isin(rule["sections"])]
            for fund, dept in rule.get("add", []):
                m = pd.concat([m, lines[(lines.section == "Other Funds") & (lines.fund == fund)
                                        & (lines.department == dept)]])
            return m

        if self.dept_pages:
            dp = pd.DataFrame(self.dept_pages)
            dp[["y1", "y2"]] = dp[["y1", "y2"]].map(num_or0)
            for (code, side, acct), g in dp[dp.kind == "line"].groupby(["code", "side", "account"]):
                m = page_lines(code)
                m = m[(m.side == side) & (m.account == acct)]
                pair("department page line", int(g.page.iloc[0]), f"{code} {acct}",
                     (g.y1.sum(), g.y2.sum()), (m.y1.sum(), m.y2.sum()))
            for _, t in dp[dp.kind == "total"].iterrows():
                m = page_lines(t["code"])
                m = m[m.side == t["side"]]
                pair("department page total", int(t["page"]), f"{t['code']} {t['side']} total",
                     (t["y1"], t["y2"]), (m.y1.sum(), m.y2.sum()))

        # 6. printed variance = new year - prior year, on every row that prints one
        for page, label, a, b, var in self.variance:
            add("printed variance", page, label, var, b - a, "variance")

        # every department line must have a code
        for row in self.lines:
            if not row["department_code"]:
                add("department code", row["page"], f"{row['department']} has no code", 0, 1, "code")
                break
        for page, text in self.unparsed:
            add("unparsed row", page, text, 0, 1, "row")
        return pd.DataFrame(out)


def num_or0(v):
    return 0 if v is None or (isinstance(v, float) and pd.isna(v)) else v


def acknowledge(checks, doc):
    checks["acknowledged"] = ""
    if not KNOWN_ISSUES_FILE.exists():
        return checks
    known = pd.read_csv(KNOWN_ISSUES_FILE, dtype=str)
    known = known[known.source_doc == doc]
    for _, k in known.iterrows():
        hit = (checks.source_page.astype(str) == str(k.source_page)) & (checks.label == k.label)
        checks.loc[hit & ~checks.passed, "acknowledged"] = k.note
    return checks


def category(side, account, groups):
    return groups.get(account[:2], f"{side.title()} {account[:2]}")


def crossbook():
    """Compare every pair of County books that print the same year's budget,
    line by line (section, fund, department, side, account). Writes
    crosscheck_<year>_<older>_vs_<newer>.csv and returns a list of
    (year, older, newer, lines, differing, net) for the report.

    Differences are expected where the County amended the budget after the
    older book or restated it under new accounts (data/county/account_changes.csv);
    they are reported, not failed, as the city's cross-book checks are.
    """
    books = {}
    for f in sorted(OUT_DIR.glob("line_items_*.csv")):
        d = pd.read_csv(f, dtype={"account": str})
        d["fund"] = d.fund.fillna("")
        books[f.stem.removeprefix("line_items_")] = d
    key = ["section", "fund", "department_code", "side", "account"]
    out = []
    for a_name, a in books.items():
        for b_name, b in books.items():
            if a_name == b_name:
                continue
            years_a = {c[7:] for c in a.columns if c.startswith("budget_")}
            years_b = sorted(c[7:] for c in b.columns if c.startswith("budget_"))
            # a is the older book: the year it budgets is b's prior year
            if years_b[0] not in years_a or max(years_a) != years_b[0]:
                continue
            col = f"budget_{years_b[0]}"
            ga = a.groupby(key).agg(older=(col, "sum"), account_name=("account_name", "first"),
                                    older_page=("source_page", "first")).reset_index()
            gb = b.groupby(key).agg(newer=(col, "sum"), newer_page=("source_page", "first")).reset_index()
            m = ga.merge(gb, on=key, how="outer")
            m[["older", "newer"]] = m[["older", "newer"]].fillna(0)
            m["diff"] = m.newer - m.older
            m["differs"] = m["diff"].abs() > ROUNDING_TOLERANCE
            m.insert(0, "fiscal_year", int(years_b[0]))
            m.to_csv(OUT_DIR / f"crosscheck_{years_b[0]}_{a_name}_vs_{b_name}.csv", index=False)
            out.append((years_b[0], a_name, b_name, len(m), int(m.differs.sum()),
                        float(m.loc[m.differs, "diff"].sum())))
    return out


def run(pdf, quiet=False):
    """Extract and validate one book; return (exit status, report lines)."""
    pdf = Path(pdf)
    cfg_path = CONFIG_DIR / f"{pdf.stem}.json"
    cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}

    book = Book(pdf, cfg)
    book.read()
    book.fill_codes()
    checks = acknowledge(book.checks(), book.doc)
    y1, y2 = book.years
    if cfg.get("years") and cfg["years"] != book.years:
        return 1, [f"{book.doc}: config years {cfg['years']} differ from the book's {book.years}"]
    groups = {**cfg.get("account_groups", {}), **book.groups}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    items = pd.DataFrame(book.lines).rename(columns={"y1": f"budget_{y1}", "y2": f"budget_{y2}",
                                                     "page": "source_page"})
    items.insert(0, "source_doc", book.doc)
    items["category"] = [category(s, a, groups) for s, a in zip(items.side, items.account)]
    items.to_csv(OUT_DIR / f"line_items_{pdf.stem}.csv", index=False)

    long_rows = []
    for _, r in items.iterrows():
        for y in (y1, y2):
            v = r[f"budget_{y}"]
            if pd.isna(v):
                continue
            long_rows.append(dict(
                fiscal_year=y, doc_type="budget",
                fund="General Fund" if r.section == "General Fund" else f"Fund {r.fund}",
                section=r.section, department_code=r.department_code, department=r.department,
                account_code=f"{r.department_code}-{r.account}", account=r.account,
                account_name=r.account_name, side=r.side, category=r.category, amount=v,
                source_doc=book.doc, source_page=r.source_page))
    pd.DataFrame(long_rows, columns=LONG_COLUMNS).to_csv(OUT_DIR / f"budget_long_{pdf.stem}.csv", index=False)
    checks.to_csv(OUT_DIR / f"validation_{pdf.stem}.csv", index=False)

    failed = checks[~checks.passed]
    unreviewed = failed[failed.acknowledged == ""]
    rep = []
    print = rep.append  # noqa: A001 - collect the report instead of printing
    print(f"{book.doc}: budgets {y1} and {y2}")
    print(f"  line items: {len(items)}  (General Fund {sum(items.section == 'General Fund')}, "
          f"Other Funds {sum(items.section == 'Other Funds')})")
    for (sec, side), g in items.groupby(["section", "side"]):
        print(f"  {sec:12s} {side:8s} {y1}: {g[f'budget_{y1}'].sum():>14,.0f}   {y2}: {g[f'budget_{y2}'].sum():>14,.0f}")
    print(f"  checks: {len(checks)}  passed {int(checks.passed.sum())}  "
          f"failed {len(failed)} (reviewed {len(failed) - len(unreviewed)}, unreviewed {len(unreviewed)})")
    for _, f in unreviewed.head(40).iterrows():
        print(f"    FAIL p{f.source_page} {f.check}: {f.label} [{f.column}] printed {f['printed']:,} parsed {f['parsed']:,} diff {f['diff']:,}")
    if len(unreviewed) > 40:
        print(f"    ... {len(unreviewed) - 40} more in validation_{pdf.stem}.csv")
    return (1 if len(unreviewed) else 0), rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", nargs="+")
    args = ap.parse_args()
    status = 0
    for pdf in args.pdf:
        code, rep = run(pdf)
        print("\n".join(rep))
        status = max(status, code)
    for year, a, b, n, nd, net in crossbook():
        print(f"cross-book {year}: {a} vs {b}: {n} lines, {nd} differ (net {net:+,.0f})")
    return status


if __name__ == "__main__":
    sys.exit(main())
