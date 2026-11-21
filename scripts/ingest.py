"""One command for any City of Lancaster or Lancaster County budget book: detect, extract, check.

Usage:
    python scripts/ingest.py "Budget PDFs - City/2026-Adopted-Budget-2026.pdf"
    python scripts/ingest.py --all                 # every budget PDF in Budget PDFs - City/
                                                   # (skips the org chart and org descriptions PDFs)
    python scripts/ingest.py --all --dir "/path/to/Budget PDFs - City"
    python scripts/ingest.py --county              # every County book in Budget PDFs - County/
    python scripts/ingest.py "Budget PDFs - County/County-2026-Budget-Book.pdf"

County books (any PDF in a folder named "Budget PDFs - County") go to
extract_county.py instead of steps 2-3 below, then every pair of County books
that print the same year is compared line by line.

For each PDF:
  1. Detect whether it has a usable text layer (share of pages with text) or
     needs OCR. OCR runs automatically and is cached (data/ocr_cache/).
  2. Load its layout from config/<pdf stem>.json. If there is none, infer one
     from the column header rows ("2025 ORIGINAL BUDGET", "RECEIVED YTD
     11/14/2025", "2026 PROPOSED", ...) and the staffing header, write it,
     and say so: an inferred config must be reviewed before it is trusted.
  3. Extract and validate (extract_layout.py, or extract_budget.py for the
     2027-style book) and cross-check against the neighbouring books:
     book B-1's PROPOSED vs this book's ORIGINAL BUDGET, and this book's
     PROPOSED vs book B+1's ORIGINAL BUDGET.
  4. Print a short report.

Exit status: 0 when everything passes or is a reviewed source issue; 1 when
any book has unreviewed failed checks; 2 when a config was inferred this run
(review it, then run again) or a PDF could not be processed.
"""

import argparse
import contextlib
import io
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import pypdfium2 as pdfium

from budget_common import OUT_DIR, ROOT
import crosscheck
import extract_budget
import extract_layout
import fund_balance
from extract_layout import CONFIG_DIR, load_page_lines, load_text_page_lines
from ocr_pages import cache_dir, ocr_document

PDF_DIR = ROOT / "Budget PDFs - City"
COUNTY_PDF_DIR = ROOT / "Budget PDFs - County"
# PDFs in PDF_DIR that are not budget books. --all skips them; naming one explicitly is an error.
# The org chart and org descriptions feed the dashboard's org structure instead
# (scripts/extract_org_descriptions.py, data/org_*_2027.csv); they have no budget tables.
NOT_BUDGET_BOOK = re.compile(r"org[ _-]*chart|org[ _-]*descriptions?", re.IGNORECASE)
TEXT_PAGE_CHARS = 50       # a page "has text" when it yields this many characters
TEXT_BOOK_SHARE = 0.8      # a book is text-layer when this share of pages has text

HEADER_WORDS = {"ACTUAL", "ORIGINAL", "AMENDED", "ADOPTED", "BUDGET", "YTD",
                "RECEIVED", "EXPENDED", "PROJECTED", "PROPOSED", "REVISED"}
RE_YEAR = re.compile(r"\b(20\d\d)\b")
RE_DATE = re.compile(r"\b\d{1,2}/\d{1,2}/(\d{4})\b")


# --------------------------------------------------------------------------
# 1. Text layer or OCR?
# --------------------------------------------------------------------------

def text_share(pdf_path):
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        n = len(pdf)
        with_text = sum(len(pdf[i].get_textpage().get_text_range().strip())
                        >= TEXT_PAGE_CHARS for i in range(n))
    finally:
        pdf.close()
    return with_text / max(n, 1), n


# --------------------------------------------------------------------------
# 2. Infer a layout config from the header rows
# --------------------------------------------------------------------------

def _pages(pdf_path, source, dpi=300):
    if source == "text":
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                yield i + 1, load_text_page_lines(page), 1.0
    else:
        ocr_document(pdf_path, dpi)
        for tsv in sorted(cache_dir(pdf_path, dpi).glob("page_*.tsv")):
            yield int(tsv.stem.split("_")[1]), load_page_lines(tsv), dpi / 72


def _is_header_token(t):
    return t.upper() in HEADER_WORDS or RE_YEAR.fullmatch(t) or RE_DATE.fullmatch(t)


def _column_meaning(text, budget_years):
    """'2025 ORIGINAL BUDGET' -> (2025, 'adopted'), or None if unknown."""
    t = text.upper()
    year = RE_YEAR.search(t)
    if "YTD" in t:
        return None, "actual_ytd"            # year filled in from its neighbours
    if year is None:
        return None, None
    y = int(year.group(1))
    if "PROPOSED" in t:
        return y, "proposed_revised" if "REVISED" in t else "proposed"
    if "PROJECTED" in t:
        return y, "projected_revised" if "REVISED" in t else "projected"
    if "ORIGINAL" in t or "ADOPTED" in t:
        return y, "adopted"
    if "AMENDED" in t:
        return y, "amended"
    if "ACTUAL" in t:
        return y, "actual"
    return y, None


def _header_signature(lines, unit):
    """Column texts of a line-item page header, or None."""
    block = []
    for line in lines[:8]:
        toks = [w.text for w in line.words]
        if toks and all(_is_header_token(t) for t in toks):
            block.append(line)
        elif block:
            break
    if not block or not any(any(w.text.upper() in HEADER_WORDS for w in l.words) for l in block):
        return None
    line_of = {id(w): i for i, l in enumerate(block) for w in l.words}
    words = sorted((w for l in block for w in l.words), key=lambda w: w.left)
    clusters = []
    for w in words:
        if clusters and w.left <= clusters[-1][-1].right + 5 * unit:
            clusters[-1].append(w)
        else:
            clusters.append([w])
    texts = tuple(" ".join(w.text for w in sorted(c, key=lambda w: (line_of[id(w)], w.left)))
                  for c in clusters)
    last = block[-1].words
    return texts, f"{re.escape(last[0].text)}.*{re.escape(last[-1].text)}"


STAFF_HEADER = {"FTE": "count", "COUNT": "count", "POSITIONS": "count",
                "POSITION": "title", "POSTION": "title", "BU": "bargaining_unit",
                "UNION": "bargaining_unit", "FT/PT": "ft_pt", "FI/PT": "ft_pt",
                "F/PART": "ft_pt", "SALARY": "salary"}


def _staffing_row(lines):
    """Field order from a staffing header such as 'APPROPRIATION CODE FTE
    POSITION SALARY' (some books stack or rotate these labels)."""
    idx = next((i for i, l in enumerate(lines) if "APPROPRIATION" in l.text), None)
    if idx is None:
        return None
    found = []
    for line in lines[max(0, idx - 2): idx + 2]:
        for w in line.words:
            for k, part in enumerate(re.split(r"[|\[\]]+", w.text)):
                key = part.upper().strip()
                field = STAFF_HEADER.get(key) or STAFF_HEADER.get(key[::-1])
                if field:                 # k keeps "[FT/PT|COUNT|" in printed order
                    found.append((w.left, k, field))
    order = [f for *_, f in sorted(found)]
    order = list(dict.fromkeys(order))           # first occurrence wins
    return order if "title" in order and "salary" in order else None


def infer_config(pdf_path, source):
    sigs, staff_rows = Counter(), Counter()
    pages_of = {}
    for page_no, lines, unit in _pages(pdf_path, source):
        text = "\n".join(l.text for l in lines)
        if "STAFFING" in text:
            row = _staffing_row(lines)
            if row:
                staff_rows[tuple(row)] += 1
            continue
        sig = _header_signature(lines, unit)
        if sig:
            sigs[sig] += 1
            pages_of.setdefault(sig, []).append(page_no)
    if not sigs:
        return None

    layouts, notes, merged = [], [], {}
    for (texts, last_line), n in sigs.most_common():
        meanings = [_column_meaning(t, None) for t in texts]
        years = Counter(y for y, d in meanings if d in ("adopted", "amended", "projected"))
        ytd_year = years.most_common(1)[0][0] if years else None
        columns = []
        for text, (y, kind) in zip(texts, meanings):
            if kind == "actual_ytd":
                date_m = RE_DATE.search(text)
                y = ytd_year or (int(date_m.group(1)) if date_m else None)
                header = r"^(?:[A-Z]+ )?YTD (\d{1,2}/\d{1,2}/\d{4})$"
            else:
                header = "^" + re.escape(text) + "$"
            columns.append({"header": header, "fiscal_year": y, "doc_type": kind})
        pages = pages_of[(texts, last_line)]
        if any(c["doc_type"] is None or c["fiscal_year"] is None for c in columns):
            # Cover pages, "2024 BUDGET" titles, garbled headers: not a table
            # layout we understand. Listed so a person can check them.
            notes.append(f"header {' | '.join(texts)!r} on page(s) {pages[:8]} not "
                         f"understood; ignored. If those pages hold line items, add a layout.")
            continue
        key = (json.dumps(columns), last_line)
        if key in merged:                       # same columns, e.g. RECEIVED vs EXPENDED YTD
            merged[key]["pages_seen"] += len(pages)
            continue
        merged[key] = {"name": f"layout_{len(layouts) + 1}", "pages_seen": len(pages),
                       "example_page": pages[0], "columns": columns,
                       "header_last_line": last_line}
        layouts.append(merged[key])
    if not layouts:
        return None

    main = layouts[0]
    budget_year = max((c["fiscal_year"] for c in main["columns"]
                       if c["doc_type"] == "proposed"),
                      default=max(c["fiscal_year"] for c in main["columns"]))
    template = _newest_layout_config()
    row = list(staff_rows.most_common(1)[0][0]) if staff_rows else None
    if row is None:
        notes.append("no staffing header found; staffing.row is a guess")
    cfg = {
        "_generated": (f"Inferred by scripts/ingest.py on {date.today()} from the column "
                       f"headers. REVIEW BEFORE TRUSTING: check each column's fiscal_year/"
                       f"doc_type against the printed header, the staffing row order, and "
                       f"the fund/department maps (copied from {template['source_doc']}). "
                       f"Delete this key once reviewed."),
        "_review_notes": notes,
        "source_doc": Path(pdf_path).name,
        "source": source,
        "budget_year": budget_year,
        "line_items": {"layouts": layouts, "total_prefix": "^TOTAL\\b\\s*[-_]?\\s*",
                       "inherit_header": len(layouts) > 1},
        "staffing": {"columns": [{"fiscal_year": budget_year, "doc_type": "proposed"}],
                     "row": row or ["title", "count", "salary"]},
        "funds": template["funds"],
        "general_fund_departments": template["general_fund_departments"],
        "general_fund_department_overrides": template.get("general_fund_department_overrides", {}),
    }
    if source == "ocr":
        cfg["ocr"] = {"dpi": 300, "fallback_rotate": 90}
    return cfg


def _layout_configs():
    out = {}
    for p in sorted(CONFIG_DIR.glob("*.json")):
        cfg = json.loads(p.read_text())
        out[p.stem] = cfg
    return out


def budget_year(cfg):
    if cfg.get("budget_year"):
        return cfg["budget_year"]
    li = cfg.get("line_items", {})
    cols = li.get("columns") or [c for l in li.get("layouts", []) for c in l["columns"]]
    years = [c["fiscal_year"] for c in cols if c["doc_type"] == "proposed"]
    return max(years) if years else None


def _newest_layout_config():
    cfgs = [c for c in _layout_configs().values() if "funds" in c and not c.get("_generated")]
    return max(cfgs, key=lambda c: budget_year(c) or 0)


# --------------------------------------------------------------------------
# 3. Extract, validate, cross-check
# --------------------------------------------------------------------------

def extract_one(pdf_path, cfg):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        if cfg.get("extractor") == "extract_budget":
            stats = extract_budget.run(pdf_path)
        else:
            stats = extract_layout.run(pdf_path)
    return stats, buf.getvalue()


def neighbour_checks(stem, cfgs):
    year = budget_year(cfgs[stem])
    by_year = {budget_year(c): s for s, c in cfgs.items()}
    li = lambda s: OUT_DIR / f"line_items_{s}.csv"
    results = []
    for a, b, y in ((by_year.get(year - 1), stem, year - 1), (stem, by_year.get(year + 1), year)):
        if a and b and li(a).exists() and li(b).exists():
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                _, st = crosscheck.run_pair(li(a), f"proposed_{y}", li(b), f"adopted_{y}")
            results.append((y, a, b, st))
    return results


# --------------------------------------------------------------------------

def ingest(pdf_path):
    pdf_path = Path(pdf_path)
    rep = {"pdf": pdf_path.name}
    share, n_pages = text_share(pdf_path)
    source = "text" if share >= TEXT_BOOK_SHARE else "ocr"
    rep.update(pages=n_pages, text_share=share, detected=source)

    cfg_path = CONFIG_DIR / f"{pdf_path.stem}.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text())
        rep["config"] = "existing"
        if cfg.get("source", "ocr") != source and cfg.get("extractor") != "extract_budget":
            rep["warning"] = (f"config says source={cfg.get('source', 'ocr')!r} but the PDF "
                              f"looks {source!r} ({share:.0%} of pages have text)")
    else:
        cfg = infer_config(pdf_path, source)
        if cfg is None:
            rep["skip"] = "no budget column header found; not a budget book?"
            return rep
        cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
        rep["config"] = "INFERRED"
    if cfg.get("_generated"):
        rep["config"] = "INFERRED"
        rep["config_path"] = cfg_path

    try:
        stats, log = extract_one(pdf_path, cfg)
    except Exception as e:                         # header mismatch etc.
        rep["error"] = f"{type(e).__name__}: {e}"
        return rep
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            rep["fund_balance"] = fund_balance.run(pdf_path)
        except Exception as e:                     # never hide the main results
            rep["fund_balance"] = {"ok": False, "found": None,
                                   "error": f"{type(e).__name__}: {e}"}
    rep["fb_log"] = buf.getvalue()
    rep.update(stats=stats, log=log)
    return rep


def ingest_county(pdfs):
    """Extract and check County books (extract_county.py); return the exit status."""
    import extract_county
    status = 0
    for p in pdfs:
        if text_share(p)[0] < TEXT_BOOK_SHARE:
            print(f"{p.name}: scanned; County OCR is not set up yet. Skipped.")
            status = max(status, 2)
            continue
        code, rep = extract_county.run(p)
        print("\n".join(rep))
        status = max(status, code)
    for year, a, b, n, nd, net in extract_county.crossbook():
        print(f"cross-book {year}: {a} vs {b}: {n} lines, {nd} differ (net {net:+,.0f}); "
              f"see data/processed/county/crosscheck_{year}_{a}_vs_{b}.csv")
    return status


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", nargs="*", type=Path)
    ap.add_argument("--all", action="store_true", help="every PDF in --dir")
    ap.add_argument("--dir", type=Path, default=PDF_DIR)
    ap.add_argument("-v", "--verbose", action="store_true", help="show each extractor's log")
    ap.add_argument("--county", action="store_true",
                    help=f"every County book in {COUNTY_PDF_DIR.name}/")
    args = ap.parse_args()
    if args.county:
        sys.exit(ingest_county(sorted(COUNTY_PDF_DIR.glob("*.pdf"))))
    pdfs = sorted(args.dir.glob("*.pdf")) if args.all else args.pdf
    county = [p for p in pdfs if p.resolve().parent.name == COUNTY_PDF_DIR.name]
    if county:
        if len(county) != len(pdfs):
            ap.error("give City and County books in separate runs")
        sys.exit(ingest_county(county))
    others = [p for p in pdfs if NOT_BUDGET_BOOK.search(p.stem)]
    if others and not args.all:
        ap.error("not a budget book: " + ", ".join(p.name for p in others))
    for p in others:
        print(f"skipping {p.name}: not a budget book (org chart / descriptions)")
    pdfs = [p for p in pdfs if p not in others]
    if not pdfs:
        ap.error("give a PDF or --all")

    reports = [ingest(p) for p in pdfs]
    fund_balance.crossbook()
    cfgs = _layout_configs()
    status = 0
    print()
    for r in reports:
        stem = Path(r["pdf"]).stem
        head = f"{r['pdf']}  [{r.get('detected', '?')}, {r.get('text_share', 0):.0%} of {r.get('pages', '?')} pages have text]"
        print(head)
        if "skip" in r:
            print(f"  skipped: {r['skip']}")
            if not args.all:
                status = max(status, 2)
            continue
        if "error" in r:
            print(f"  FAILED: {r['error']}")
            status = max(status, 2)
            continue
        if r.get("warning"):
            print(f"  warning: {r['warning']}")
        if r["config"] == "INFERRED":
            print(f"  config: INFERRED -> {r.get('config_path')}  REVIEW IT before trusting "
                  f"these numbers, then delete its _generated key and run again.")
            for note in cfgs.get(stem, {}).get("_review_notes", []):
                print(f"    - {note}")
            status = max(status, 2)
        s = r["stats"]
        print(f"  line items {s['line_items']}, positions {s['positions']}; checks "
              f"{s['passed']} passed, {s['acknowledged']} acknowledged source issues, "
              f"{s['failed']} UNREVIEWED failures")
        if s["failed"]:
            status = 1 if status != 2 else 2
            if not args.verbose:
                fails = [l for l in r["log"].splitlines() if l.startswith("  p")][-8:]
                print("    " + "\n    ".join(fails))
        fb = r.get("fund_balance", {})
        if fb.get("error"):
            print(f"  fund balance page: FAILED ({fb['error']})")
            status = max(status, 1)
        elif fb.get("found"):
            print(f"  fund balance page p{fb['page']}: {fb['rows']} amounts; chain checks "
                  f"{fb['passed']} passed, {fb['acknowledged']} acknowledged, "
                  f"{fb['failed']} UNREVIEWED")
            if fb["failed"]:
                status = 1 if status != 2 else 2
        else:
            print("  fund balance page: none found")
        if stem in cfgs:
            for y, a, b, st in neighbour_checks(stem, cfgs):
                print(f"  cross-check {y}: {a} PROPOSED vs {b} ORIGINAL: "
                      f"{st['equal']}/{st['in_both']} equal ({st['rate']:.1%}); "
                      f"{st['adoption_changes']} adoption changes, "
                      f"{st['possible_ocr_errors']} possible OCR errors")
        if args.verbose:
            print(r["log"])
    sys.exit(status)


if __name__ == "__main__":
    main()
