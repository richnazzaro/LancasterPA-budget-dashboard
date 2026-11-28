"""Extract and validate the City's multi-year budget projections book.

Usage:
    python scripts/extract_projections.py "governments/lancaster-city/sources/2028-2029-Budget-Projections.pdf"

The book (printed from the 2027 budget workbook) has one table per fund:
    <org> <object> <description> <2028 Projection> <2029 Projection>
with these printed totals, which are all re-added here:
    * General Fund revenue: a total under each category ("Tax Revenue", ...), no heading above it;
      then "Total - Revenue".
    * Expense sections: a heading ("Mayor's Office Exp") above the lines and a total row with the
      same label below them.
    * Enterprise funds: a "Revenue" total under the revenue lines, then expense sections.
    * Each fund ends with "Total Revenue", "Total Expense" and "Surplus/(Deficit)".
The column years come from the header ("2028 Projection", "2029 Projection"). A cell can be blank
(the book prints some lines with no amount); each amount is placed in its column by its x position,
so a lone figure lands in the right year. Blank cells are kept blank in line_items and left out of
budget_long, as the other extractors do for columns a page does not print.

Writes to data/processed/:
    line_items_<doc>.csv    one row per account line, both years side by side
    budget_long_<doc>.csv   one row per line x year, doc_type "projection"
    validation_<doc>.csv    every printed total vs. the sum of the parsed lines ($5 per cell)
    projection_assumptions_<doc>.csv   the printed assumptions page, one row per line
    crosscheck_projection_<doc>_vs_revised_<year>_<book>.csv
                            every line matched by account_code (and its order, for codes printed twice)
                            to the year before's Revised column in the newest budget book: `status` is
                            both / only_projection / only_<book year>, so no line is silently dropped.
                            Org codes are also checked against mapping/org_structure.csv.
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
import pdfplumber

from budget_common import (
    OUT_DIR, ROUNDING_TOLERANCE, acknowledge_known_issues, category_for, check_counts,
    make_fund_mapper, to_long, to_number,
)

DOC_TYPE = "projection"
RE_TITLE = re.compile(r"^(.+?) (\d{4})-(\d{4}) Projections$")
RE_HEADER = re.compile(r"^Org Obj Description (\d{4}) Projection (\d{4}) Projection$")
RE_ASSUMPTIONS = re.compile(r"^\d{4}-\d{4} Projection Assumptions$")
RE_AMOUNT = re.compile(r"^\(?-?[\d,]+\)?$")
RE_CODE_ROW = re.compile(r"^(\d{7,9}) (\d{6}|TBD) (.+)$")
# The fund named in each page title -> the fund name used everywhere else comes from the book (`fund_titles`).


def cells_from_chars(chars, y_tolerance=3, cell_gap=1.5):
    """Rows of cells rebuilt from characters in PDF drawing order (see extract_budget.rows_from_chars:
    sorting by x would interleave a long description with the next column). Each cell keeps its x
    extent and whether it is set in the bold total font."""
    rows = []
    for c in chars:
        for row in rows:
            if abs(row[0] - c["top"]) <= y_tolerance:
                row[1].append(c)
                break
        else:
            rows.append([c["top"], [c]])
    out = []
    for top, cs in sorted(rows, key=lambda r: r[0]):
        cells, cur = [], []
        for c in cs:
            if cur and c["x0"] < cur[-1]["x1"] - 1:          # jumped back: new cell
                cells.append(cur)
                cur = []
            cur.append(c)
        if cur:
            cells.append(cur)
        row = []
        for cell in cells:
            # split a drawn cell on runs of blank space into words; keep word boxes
            words, w = [], []
            for c in cell:
                if c["text"].strip() == "":
                    if w:
                        words.append(w)
                        w = []
                    continue
                if w and c["x0"] - w[-1]["x1"] > cell_gap:
                    words.append(w)
                    w = []
                w.append(c)
            if w:
                words.append(w)
            for w in words:
                row.append({"text": "".join(c["text"] for c in w), "x0": w[0]["x0"], "x1": w[-1]["x1"],
                            "bold": all(c["fontname"].endswith("F1") for c in w)})
        if row:
            # Total rows draw their amounts before their label: order the words left to right.
            # Each word was built in drawing order, so an overflowing description stays whole.
            row.sort(key=lambda w: w["x0"])
            out.append((top, row))
    return out


def split_amounts(words):
    """Trailing amount words of a row, and the words before them."""
    k = len(words)
    while k > 0 and RE_AMOUNT.match(words[k - 1]["text"]) and not re.fullmatch(r"\d{6,9}", words[k - 1]["text"]):
        k -= 1
    return words[:k], words[k:]


def extract(pdf_path, book):
    items, checks, unparsed, assumptions = [], [], [], []
    fund, years, col_split = None, None, None
    section = None             # current expense section heading, or None
    open_items = []            # lines waiting for their section/category total
    fund_items = []            # every line of the current fund
    leaf = []                  # printed section totals of the current fund: (kind, label, printed)
    fund_printed = {}          # "Total Revenue" / "Total Expense" printed per fund
    keys = None

    def check(level, label, page_no, members, sums, printed):
        diffs = [s - p for s, p in zip(sums, printed)]
        checks.append({"level": level, "label": label, "source_page": page_no, "fund": fund,
                       "members": members, "max_abs_diff": max(abs(d) for d in diffs),
                       "passed": all(abs(d) <= ROUNDING_TOLERANCE for d in diffs),
                       **{f"printed_{k}": p for k, p in zip(keys, printed)},
                       **{f"diff_{k}": d for k, d in zip(keys, diffs)}})

    def col_sum(rows, kind=None):
        return [sum((it[k] or 0) for it in rows if kind is None or it["kind"] == kind) for k in keys]

    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages):
            page_no = page_index + 1
            for top, words in cells_from_chars(page.chars):
                text = " ".join(w["text"] for w in words)
                if RE_ASSUMPTIONS.match(text) or assumptions:   # the assumptions page: kept as text
                    assumptions.append((page_no, text))
                    continue
                m = RE_TITLE.match(text)
                if m:
                    if open_items:
                        unparsed.append({"source_page": page_no, "text": f"{len(open_items)} lines of {fund} never closed by a total"})
                    fund = book["fund_titles"].get(m.group(1))
                    if fund is None:
                        raise SystemExit(f"p{page_no}: unknown fund title {m.group(1)!r}")
                    section, open_items, fund_items, leaf = None, [], [], []
                    continue
                m = RE_HEADER.match(text)
                if m:
                    ys = (int(m.group(1)), int(m.group(2)))
                    if years and ys != years:
                        raise SystemExit(f"p{page_no}: header years {ys} differ from {years}")
                    years = ys
                    keys = [f"{DOC_TYPE}_{y}" for y in years]
                    proj = [w for w in words if w["text"] == "Projection"]
                    col_split = (proj[0]["x1"] + proj[1]["x1"]) / 2   # amounts are right-aligned
                    continue
                if fund is None or keys is None:
                    continue

                head, amounts = split_amounts(words)
                values = [None, None]
                for w in amounts:
                    j = 0 if w["x1"] < col_split else 1
                    if values[j] is not None:
                        raise SystemExit(f"p{page_no}: two amounts in one column: {text!r}")
                    values[j] = to_number(w["text"])
                label = " ".join(w["text"] for w in head)

                m = RE_CODE_ROW.match(label)
                if m and not any(w["bold"] for w in head):
                    org, obj, name = m.groups()
                    f, dept = book["fund_and_department"](org)
                    if f != fund:
                        unparsed.append({"source_page": page_no, "text": f"org {org} maps to {f}, page is {fund}: {text}"})
                    cat = category_for(obj)
                    it = {"fund": fund, "department": dept, "bureau": section or "",
                          "account_code": f"{org}-{obj}", "org_code": org, "object_code": obj,
                          "account_name": name.strip(), "category": cat,
                          **dict(zip(keys, values)), "source_page": page_no,
                          "kind": "revenue" if cat == "Revenue" else "expense"}
                    items.append(it)
                    open_items.append(it)
                    fund_items.append(it)
                    continue

                if label and not amounts and not re.search(r"\d", label):
                    # An expense section heading (underlined, regular weight); its total row repeats it.
                    if open_items:
                        unparsed.append({"source_page": page_no, "text": f"heading {label!r} with {len(open_items)} lines still open"})
                    section = label
                    continue
                if not all(w["bold"] for w in head) or not label:
                    unparsed.append({"source_page": page_no, "text": text})
                    continue
                if None in values:
                    unparsed.append({"source_page": page_no, "text": f"total with a blank cell: {text}"})
                    continue

                if label in ("Total Revenue", "Total Expense"):
                    kind = "revenue" if label == "Total Revenue" else "expense"
                    fund_printed[(fund, kind)] = values
                    check("fund", f"{fund} / {label}", page_no, sum(1 for it in fund_items if it["kind"] == kind),
                          col_sum(fund_items, kind), values)
                    secs = [p for k, _, p in leaf if k == kind]
                    check("fund_sections", f"{fund} / {label} = its section totals", page_no, len(secs),
                          [sum(p[i] for p in secs) for i in range(2)], values)
                    continue
                if label == "Surplus/(Deficit)":
                    rev, exp = fund_printed.get((fund, "revenue")), fund_printed.get((fund, "expense"))
                    if not rev or not exp:
                        unparsed.append({"source_page": page_no, "text": f"surplus row before fund totals: {text}"})
                        continue
                    check("surplus", f"{fund} / Surplus/(Deficit) = printed Total Revenue - Total Expense",
                          page_no, 2, [r - e for r, e in zip(rev, exp)], values)
                    sums = [r - e for r, e in zip(col_sum(fund_items, "revenue"), col_sum(fund_items, "expense"))]
                    check("surplus_lines", f"{fund} / Surplus/(Deficit) = revenue lines - expense lines",
                          page_no, len(fund_items), sums, values)
                    continue
                if label == "Total - Revenue":         # General Fund revenue roll-up
                    secs = [p for k, _, p in leaf if k == "revenue"]
                    check("rollup", f"{fund} / {label}", page_no, len(secs),
                          [sum(p[i] for p in secs) for i in range(2)], values)
                    check("fund", f"{fund} / {label} (lines)", page_no,
                          sum(1 for it in fund_items if it["kind"] == "revenue"), col_sum(fund_items, "revenue"), values)
                    continue

                # A section or revenue-category total: closes the open lines.
                if section is not None and label != section:
                    unparsed.append({"source_page": page_no, "text": f"total {label!r} under heading {section!r}"})
                kinds = {it["kind"] for it in open_items}
                if not open_items or len(kinds) != 1:
                    unparsed.append({"source_page": page_no, "text": f"total {label!r} over {len(open_items)} lines of kinds {kinds}"})
                    open_items = []
                    continue
                for it in open_items:
                    it["bureau"] = label
                check("section", label, page_no, len(open_items), col_sum(open_items), values)
                leaf.append((kinds.pop(), label, values))
                open_items, section = [], None

    if open_items:
        unparsed.append({"source_page": -1, "text": f"{len(open_items)} lines never closed by a total"})
    assumption_rows = [{"source_page": p, "line": i, "text": t} for i, (p, t) in enumerate(assumptions, start=1)]
    return items, checks, unparsed, assumption_rows, years, keys


def crosscheck_revised(doc, years, out=OUT_DIR, gov=None):
    """Match every projection line to the newest book's Revised column for the year before the first
    projection year. Returns (stats, path) or (None, None) when that book is not extracted."""
    base = years[0] - 1
    col = f"proposed_revised_{base}"
    book = None
    for path in sorted(out.glob("line_items_*.csv")):
        if path.stem != f"line_items_{doc}" and col in pd.read_csv(path, nrows=0).columns:
            book = path
    if book is None:
        return None, None
    keys = [f"{DOC_TYPE}_{y}" for y in years]
    p = pd.read_csv(out / f"line_items_{doc}.csv", dtype={"org_code": str, "object_code": str})
    r = pd.read_csv(book, dtype={"org_code": str, "object_code": str})
    p["nth"] = p.groupby("account_code").cumcount()
    r["nth"] = r.groupby("account_code").cumcount()
    m = p.merge(r[["account_code", "nth", "fund", "bureau", "account_name", col, "source_page"]],
                on=["account_code", "nth"], how="outer", indicator=True, suffixes=("", "_book"))
    book_stem = book.stem[len("line_items_"):]
    m["status"] = m["_merge"].map({"both": "both", "left_only": "only_projection",
                                   "right_only": f"only_{base}"}).astype(str)
    for c in ("fund", "account_name", "bureau"):
        m[c] = m[c].fillna(m[f"{c}_book"])
    m["name_differs"] = (m["_merge"] == "both") & (m["account_name"] != m["account_name_book"])
    m[f"change_{years[0]}"] = m[keys[0]] - m[col]
    cols = ["status", "fund", "bureau", "account_code", "account_name", "account_name_book", "name_differs",
            col, *keys, f"change_{years[0]}", "source_page", "source_page_book"]
    m = m[cols]
    path = out / f"crosscheck_projection_{doc}_vs_revised_{base}_{book_stem}.csv"
    m.to_csv(path, index=False)
    org = pd.read_csv(gov.path(gov["org"]["codes"]), dtype=str) if gov.get("org") else pd.DataFrame({"org_code": [],
                                                                                                 "fund": []})
    unmapped = sorted(set(p["org_code"]) - set(org["org_code"]))
    funds = p.merge(org, on="org_code", suffixes=("", "_org"))
    fund_diff = sorted(set(funds.loc[funds["fund"] != funds["fund_org"], "org_code"]))
    counts = m["status"].value_counts().to_dict()
    return {"base": base, "book": book_stem, "counts": counts, "unmapped_orgs": unmapped,
            "fund_differs": fund_diff, "name_differs": int(m["name_differs"].sum()),
            "only_book": m[m["status"] == f"only_{base}"], "only_projection": m[m["status"] == "only_projection"],
            "col": col}, path


def run(pdf, out=OUT_DIR, gov=None, cfg=None):
    """Extract and validate the projections book. Returns a stats dict like the other extractors."""
    import govconfig
    gov = govconfig.resolve_government(gov)
    pdf, out = Path(pdf), Path(out)
    doc = pdf.stem
    if cfg is None:
        cfg = govconfig.book_config(gov.id, pdf.name)
        if cfg is None:
            sys.exit(f"{govconfig.books_dir(gov.id) / (pdf.stem + '.yaml')}: no book config for {pdf.name}")
    book = {"fund_titles": cfg.get("fund_titles") or {},
            "fund_and_department": make_fund_mapper(cfg["funds"], cfg["general_fund_departments"],
                                                    cfg.get("general_fund_department_overrides", {}))}
    items, checks, unparsed, assumption_rows, years, keys = extract(pdf, book)
    out.mkdir(parents=True, exist_ok=True)
    cols = ["fund", "department", "bureau", "account_code", "org_code", "object_code",
            "account_name", "category", *keys, "source_page"]
    pd.DataFrame(items)[cols].to_csv(out / f"line_items_{doc}.csv", index=False)
    to_long(items, [(y, DOC_TYPE) for y in years], keys, pdf.name).to_csv(out / f"budget_long_{doc}.csv", index=False)
    pd.DataFrame(assumption_rows, columns=["source_page", "line", "text"]).to_csv(
        out / f"projection_assumptions_{doc}.csv", index=False)
    checks = acknowledge_known_issues(pd.DataFrame(checks), pdf.name, gov)
    checks.to_csv(out / f"validation_{doc}.csv", index=False)

    df = pd.DataFrame(items)
    print(f"Line items:      {len(items)}")
    for f, grp in df.groupby("fund", sort=False):
        blank = int(grp[keys].isna().any(axis=1).sum())
        print(f"  {f:30s} {len(grp):4d} lines ({(grp.kind == 'revenue').sum()} revenue, "
              f"{(grp.kind == 'expense').sum()} expense; {blank} with a blank cell)")
    for level, grp in checks.groupby("level", sort=False):
        print(f"Checks {level:<16} {int(grp['passed'].sum()):>3}/{len(grp)} passed")
    if unparsed:
        print(f"\nUnparsed rows ({len(unparsed)}):")
        for u in unparsed:
            print(f"  p{u['source_page']}: {u['text'][:120]}")
    failed = checks[~checks["passed"] & (checks["acknowledged"] == "")]
    for _, r in failed.iterrows():
        print(f"  FAILED p{r.source_page} [{r.level}] {r.label}: off by up to {r.max_abs_diff:,}")
    xc, xpath = crosscheck_revised(doc, years, out, gov)
    if xc is None:
        print(f"\nNo extracted book has a {years[0] - 1} Revised column; cross-check skipped.")
    else:
        print(f"\nCross-check vs {xc['base']} Revised ({xc['book']}): "
              + ", ".join(f"{k} {v}" for k, v in sorted(xc["counts"].items()))
              + f"; {xc['name_differs']} line(s) renamed -> {xpath.name}")
        for label, df_ in ((f"only in the {xc['base']} book", xc["only_book"]), ("only in the projections", xc["only_projection"])):
            for _, r in df_.iterrows():
                amt = r[xc["col"]] if "only_" + str(xc["base"]) == r["status"] else r[keys[0]]
                print(f"  {label}: {r.account_code:18s} {r.account_name:28s} {r.bureau:32s} {amt:>12,.0f}")
        print(f"Org codes not in {gov.get('org', {}).get('codes', 'the org structure')}: {xc['unmapped_orgs'] or 'none'}; "
              f"fund differs from the org structure: {xc['fund_differs'] or 'none'}")
    stats = {"ok": failed.empty and not unparsed and not (xc and (xc["unmapped_orgs"] or xc["fund_differs"])), "line_items": len(items), "positions": 0,
             **check_counts(checks), "source": "text"}
    if unparsed:
        stats["failed"] += len(unparsed)
    if xc:
        stats["failed"] += len(xc["unmapped_orgs"]) + len(xc["fund_differs"])
        stats["crosscheck"] = {k: xc[k] for k in ("base", "book", "counts", "name_differs")}
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--gov", help="government id (default: site.yaml default_government)")
    args = ap.parse_args()
    if not run(args.pdf, args.out, gov=args.gov)["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
