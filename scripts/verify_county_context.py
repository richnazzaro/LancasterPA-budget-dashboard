#!/usr/bin/env python3
"""Check the County's context facts (data/county/context_facts.csv) against the text of the pages they cite.

    python scripts/verify_county_context.py

Each fact names a source document and page. This reads that page's text layer and confirms the figure is printed there
(`find`: spaces, commas and "$" are ignored, because the resolutions' text layer splits amounts; "YEAR|TOKEN" means a
line that starts with YEAR and contains TOKEN, for the audited report's millage table). A fact's `also_in` (a page of the
County's budget presentation, "file#page") is confirmed the same way, so where the presentation repeats a figure that a
primary document prints, the two are shown to agree. A fact of kind "calculated" has no `find`; its `also_in` page is
checked for the value.

Writes data/processed/county/validation_context_county.csv (fact, document, page, check, expected, passed). Exit status 1
when any figure is not on its page. The arithmetic ties (agency grants add to their totals, the Capital Improvement
Fund adds up, the resolution's lines match) are in scripts/check_county.py.
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

import pdfplumber
import pypdfium2

ROOT = Path(__file__).resolve().parent.parent
FACTS = ROOT / "data" / "county" / "context_facts.csv"
OUT = ROOT / "data" / "processed" / "county" / "validation_context_county.csv"
PDFS = ROOT / "Budget PDFs - County"


def locate(doc: str) -> Path:
    for p in (PDFS / doc, PDFS / "ACFR" / doc, PDFS / "Resolutions" / doc):
        if p.exists():
            return p
    raise FileNotFoundError(doc)


_pages: dict = {}


def page_text(doc: str, page: int) -> str:
    if (doc, page) not in _pages:
        with pdfplumber.open(locate(doc)) as pdf:
            text = pdf.pages[page - 1].extract_text() or ""
        # A slide whose chart title overlaps its text can scramble pdfplumber's lines; pdfium orders them differently.
        pdfium = pypdfium2.PdfDocument(str(locate(doc)))[page - 1].get_textpage().get_text_range()
        _pages[(doc, page)] = text + "\n" + pdfium.replace("\r", "")
    return _pages[(doc, page)]


def flat(t: str) -> str:
    return re.sub(r"[\s,$]", "", t)


def present(text: str, find: str) -> bool:
    if "|" in find:
        year, token = find.split("|", 1)
        return any(re.match(rf"\s*{re.escape(year)}\b", ln) and token in ln for ln in text.split("\n"))
    return flat(find) in flat(text)


def main(argv: list[str] | None = None) -> int:
    rows = list(csv.DictReader(FACTS.open(newline="", encoding="utf-8")))
    out, bad = [], 0
    for r in rows:
        checks = []
        if r["source_kind"] != "calculated":
            checks.append(("source page", r["source_doc"], int(r["source_page"]), r["find"]))
        if r["also_in"]:
            doc, pg = r["also_in"].split("#")
            val = r["find"] if r["source_kind"] != "calculated" and "|" not in r["find"] else (f"{int(r['value']):,}" if r["value"].isdigit() else r["value"])
            if "|" in val:
                val = val.split("|", 1)[1]
            checks.append(("presentation agrees", doc, int(pg), val))
        for name, doc, pg, find in checks:
            ok = present(page_text(doc, pg), find)
            bad += not ok
            out.append({"fact": r["id"], "check": name, "source_doc": doc, "source_page": pg, "expected": find, "passed": ok})
            if not ok:
                print(f"FAIL {r['id']}: {find!r} not on {doc} p{pg}")
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["fact", "check", "source_doc", "source_page", "expected", "passed"], lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    print(f"{len(rows)} context facts, {len(out)} page checks, {bad} failed -> {OUT.relative_to(ROOT)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
