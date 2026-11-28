#!/usr/bin/env python3
"""Extract the "what does this unit do" text from the city's org descriptions PDF.

Input:  Budget PDFs - City/Org Descriptions 2027.pdf (text layer; pages 1-17 are prose,
        pages 18-23 repeat the org chart as one word per line and are skipped).
Output: content/org_descriptions.csv with one row per printed heading:
        id, level, parent, heading, source_page, text

Wording is kept exactly as printed (typos included). Cleanup is limited to:
  * wrapped lines are joined into paragraphs (a blank-line-sized gap starts a new one);
  * a line ending in "-" is joined without a space, keeping the hyphen (every line-end
    hyphen in this book is a real compound such as "data-driven" or "non-emergency");
  * a paragraph that runs over a page break is joined when the page ends mid-sentence;
  * the two-column bullet lists on page 13 are read column by column;
  * the footnote marker on page 13 becomes a superscript and the footnote its own paragraph.

Text markup in the `text` column (rendered by web/app.js):
  blank line  = paragraph break
  "• " prefix = bullet item
  "### " prefix = a bold in-text subheading as printed (e.g. "Uniformed Platoons")

Headings: 13.5pt bold lines are level 1 (department, bureau, division of Public Works);
10.7pt bold lines in capitals are level 2 (e.g. the Police and Fire divisions) and record
their level-1 parent.

Needs pdfplumber (requirements.txt). Run by hand when the city publishes a new edition:
    python scripts/extract_org_descriptions.py
"""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
def default_pdf(gov) -> Path:
    """The government's descriptions PDF (government.yaml org.descriptions_pdf)."""
    return gov.sources / gov["org"]["descriptions_pdf"]


def default_out(gov) -> Path:
    """The descriptions table the build reads (government.yaml org.descriptions)."""
    return gov.path(gov["org"]["descriptions"])

BODY, HEAD, FOOT = 10.7, 13.5, 7.7
# Two-column bullet lists: page -> [(top, bottom, x split)]. Read left column, then right.
# A list that starts in the left column and overflows into the right one is read in flow order:
# the left column up to its second "...consisting of:" heading, then the right column up to its
# first heading, then the rest of each column.
COLUMN_REGIONS = {13: [(240, 405, 320), (535, 705, 320)]}


def is_bold(ch) -> bool:
    return "AAAAAB" in ch["fontname"]


def size_of(chars) -> float:
    sizes = [round(c["size"], 1) for c in chars if c["text"].strip()]
    return max(set(sizes), key=sizes.count) if sizes else BODY


def line_text(chars) -> str:
    """Text of one line, with a small raised digit turned into a superscript marker."""
    out, prev = [], None
    for c in sorted(chars, key=lambda c: c["x0"]):
        t = c["text"]
        if t.isdigit() and c["size"] < 7:
            t = "¹²³⁴⁵⁶⁷⁸⁹"[int(t) - 1] if t != "0" else "⁰"
        if prev is not None and t not in "¹²³⁴⁵⁶⁷⁸⁹⁰" and c["x0"] - prev["x1"] > min(c["size"], prev["size"]) * 0.2 and not out[-1].endswith(" ") and t != " ":
            out.append(" ")
        out.append(t)
        prev = c
    return re.sub(r"\s+", " ", "".join(out)).strip()


def page_lines(page, pno: int) -> list[dict]:
    """Lines in reading order: {top, x0, size, bold, text}."""
    chars = [c for c in page.chars if c["text"] != ""]
    regions = COLUMN_REGIONS.get(pno, [])

    def group(cs):
        rows = []
        # normal-size characters first, so raised superscripts join an existing line
        for c in sorted(cs, key=lambda c: (c["size"] < 7, round(c["top"]), c["x0"])):
            # superscripts sit a little higher than their line: attach them to the nearest line
            for r in rows:
                if abs(r["bottom"] - c["bottom"]) < 3.5 or (c["size"] < 7 and -2 < c["top"] - r["top"] < 6):
                    r["chars"].append(c)
                    break
            else:
                rows.append({"top": c["top"], "bottom": c["bottom"], "chars": [c]})
        out = []
        for r in sorted(rows, key=lambda r: r["top"]):
            vis = [c for c in r["chars"] if c["text"].strip()]
            if not vis:
                continue
            out.append({"top": min(c["top"] for c in vis), "x0": min(c["x0"] for c in vis),
                        "size": size_of(vis), "bold": all(is_bold(c) for c in vis), "text": line_text(r["chars"])})
        return out

    in_region = lambda c, r: r[0] <= c["top"] <= r[1]
    plain = [c for c in chars if not any(in_region(c, r) for r in regions)]
    blocks = [(l["top"], [l]) for l in group(plain)]
    for r in regions:
        cs = [c for c in chars if in_region(c, r)]
        left = group([c for c in cs if c["x0"] < r[2]])
        right = group([c for c in cs if c["x0"] >= r[2]])
        for l in left + right:
            l["column"] = True
        heads = lambda ls: [i for i, l in enumerate(ls) if l["text"].endswith(":")]
        lh, rh = heads(left), heads(right)
        if len(lh) >= 2 and rh:
            ordered = left[:lh[1]] + right[:rh[0]] + left[lh[1]:] + right[rh[0]:]
        else:
            ordered = left + right
        blocks.append((r[0], ordered))
    return [l for _, ls in sorted(blocks, key=lambda b: b[0]) for l in ls]


def is_prose_page(page) -> bool:
    lines = page.extract_text_lines()
    return bool(lines) and sum(len(l["text"].split()) for l in lines) / len(lines) >= 3


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", " and ")).strip("-")


def join(a: str, b: str) -> str:
    if not a:
        return b
    return a + b if a.endswith("-") else a + " " + b


def extract(pdf_path: Path) -> list[dict]:
    entries: list[dict] = []
    cur = None
    para: list[str] = []   # paragraphs of the current entry
    buf = ""               # paragraph being built
    last = None            # previous line (for gap detection)
    parent_l1 = None

    def flush():
        nonlocal buf
        if buf.strip() and cur is not None:
            para.append(buf.strip())
        buf = ""

    def close():
        flush()
        if cur is not None:
            cur["text"] = "\n\n".join(para)

    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            if not is_prose_page(page):
                continue
            for ln in page_lines(page, pno):
                t, size = ln["text"], ln["size"]
                heading_l1 = ln["bold"] and size >= HEAD - 0.5
                heading_l2 = ln["bold"] and abs(size - BODY) < 0.5 and t.upper() == t and len(t) > 3
                if heading_l1 or heading_l2:
                    close()
                    para = []
                    level = 1 if heading_l1 else 2
                    hid = f"p{pno}-{slug(t)}"
                    cur = {"id": hid, "level": level, "parent": "" if level == 1 else (parent_l1 or ""),
                           "heading": t, "source_page": pno, "text": ""}
                    if level == 1:
                        parent_l1 = hid
                    entries.append(cur)
                    last = ln | {"page": pno}
                    continue
                if cur is None:
                    continue
                new_para = False
                if last is not None:
                    if last["page"] != pno:
                        # page break: continue only when the previous page stopped mid-sentence
                        new_para = bool(re.search(r"[.:)]$", buf.strip())) or not buf
                    else:
                        new_para = ln["top"] - last["top"] > 20 if not ln.get("column") else False
                if ln["bold"] and abs(size - BODY) < 0.5:                       # in-text subheading
                    flush(); para.append("### " + t); last = ln | {"page": pno}; continue
                if abs(size - FOOT) < 0.5:                                      # footnote
                    if not (last and abs(last["size"] - FOOT) < 0.5):
                        flush(); t = re.sub(r"^(\d)\s+", lambda m: "¹²³⁴⁵⁶⁷⁸⁹"[int(m.group(1)) - 1] + " ", t)
                    elif ln["top"] - last["top"] > 20:
                        flush()
                    if t.startswith("•"):
                        flush()
                    buf = join(buf, t)
                    last = ln | {"page": pno}
                    continue
                if last is not None and abs(last["size"] - FOOT) < 0.5:
                    new_para = True
                if ln.get("column"):
                    # a list line continues the item above unless it starts a new bullet or heading,
                    # follows a heading, or sits a full item-step below (an item printed without a bullet)
                    new_para = (t.startswith("•") or t.endswith(":") or buf.endswith(":")
                                or not (last is not None and last.get("column") and 0 < ln["top"] - last["top"] < 15.5))
                    if new_para and not t.startswith("•") and not t.endswith(":") and not buf.endswith(":") and last is not None and last.get("column"):
                        t = "• " + t
                elif t.startswith("•"):
                    new_para = True
                if new_para:
                    flush()
                buf = join(buf, t)
                last = ln | {"page": pno}
        close()
    for e in entries:
        # "•Name" -> "• Name"
        e["text"] = re.sub(r"(?m)^•\s*", "• ", e["text"])
    return entries


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gov", help="government id (default: site.yaml default_government)")
    ap.add_argument("--pdf", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    import govconfig
    gov = govconfig.resolve_government(args.gov)
    args.pdf = args.pdf or default_pdf(gov)
    args.out = args.out or default_out(gov)
    entries = extract(args.pdf)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "level", "parent", "heading", "source_page", "text"])
        w.writeheader()
        w.writerows(entries)
    for e in entries:
        print(f"{e['id']:55s} L{e['level']} p{e['source_page']:<3} {len(e['text']):5d} chars")
    print(f"{len(entries)} entries -> {args.out}")


if __name__ == "__main__":
    main()
