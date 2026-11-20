"""Extract a City of Lancaster budget book whose layout is set by a config file.

Usage:
    python scripts/extract_layout.py "/path/to/2026-Adopted-Budget-2026.pdf"
    python scripts/extract_layout.py PDF --config config/<doc>.json

Works for scanned (image-only) books and for text-layer books alike. The
config's "source" picks where word boxes come from:
  "ocr"   render + Tesseract (scripts/ocr_pages.py; cached and git-ignored)
  "text"  the PDF's own text layer (pdfplumber)

Steps:
  1. Get word boxes for every page.
  2. Read each page's column header and check it against the per-document
     config (config/<pdf stem>.json). Assign every number to a column by its
     x-position on the page, not by its order in the line.
  3. Rebuild line items, section TOTAL rows and staffing schedules, and
     re-check every printed total exactly as extract_budget.py does.
  4. Write the same four tables as extract_budget.py, plus
     ocr_cells_<doc>.csv: every amount cell that was not read cleanly.

Any number that could not be read as a well-formed amount fails the run,
unless a person has fixed it in data/ocr_corrections.csv (with evidence).
Corrected values still have to pass the printed-total checks.
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

import pandas as pd

from budget_common import (
    OUT_DIR, ROOT, acknowledge_known_issues, category_for, find_rollup,
    make_fund_mapper, print_summary, staff_check, to_long, to_number,
    total_check, check_counts,
)
from ocr_pages import cache_dir, ocr_document

CONFIG_DIR = ROOT / "config"
CORRECTIONS_FILE = ROOT / "data" / "ocr_corrections.csv"
SIGN_FILE = ROOT / "data" / "sign_corrections.csv"
STAFF_FIX_FILE = ROOT / "data" / "staffing_corrections.csv"

RE_ORG = re.compile(r"^\d{7,8}$")
RE_OBJ = re.compile(r"^\d{6}$")
# A well-formed printed amount: 0, 1,234, (1,234), -1,234 or a bare dash.
RE_AMOUNT = re.compile(r"^(\(?-?\d{1,3}(,\d{3})*\)?|-)$")
# Stray marks OCR picks up from table rules and gray bands.
RE_NOISE = re.compile(r"^[|—_\-–©‘’'\"“”~.,:;=»«]+$")


# --------------------------------------------------------------------------
# OCR words -> lines
# --------------------------------------------------------------------------

class HeaderMismatch(ValueError):
    pass


class Word:
    __slots__ = ("text", "left", "top", "right", "bottom", "conf")

    def __init__(self, text, left, top, width, height, conf):
        self.text, self.left, self.top = text, left, top
        self.right, self.bottom, self.conf = left + width, top + height, conf

    @property
    def xc(self):
        return (self.left + self.right) / 2


class Line:
    def __init__(self, words):
        self.words = sorted(words, key=lambda w: w.left)
        self.top = min(w.top for w in words)

    @property
    def text(self):
        return " ".join(w.text for w in self.words)


def load_page_lines(tsv_path):
    df = pd.read_csv(tsv_path, sep="\t", quoting=csv.QUOTE_NONE,
                     keep_default_na=False, dtype={"text": str})
    df = df[(df.level == 5) & (df.text.str.strip() != "")]
    lines = []
    for _, g in df.groupby(["block_num", "par_num", "line_num"], sort=False):
        words = [Word(t, r.left, r.top, r.width, r.height, float(r.conf))
                 for r in g.itertuples()
                 if (t := r.text.strip().strip("‘’'\"“”"))]
        if words:
            lines.append(Line(words))
    return sorted(lines, key=lambda l: l.top)


def load_text_page_lines(page, glyphs=None):
    """Word boxes from a PDF text layer, grouped into lines like the OCR path.

    Words that touch (a font change mid-word: "RECEIVE"+"D") are merged.
    Bold table rows and regular-weight notes can overlap vertically, so words
    of different weight share a line only when their tops are within 1pt.
    """
    words = page.extract_words(extra_attrs=["fontname"], keep_blank_chars=False)
    for w in words:  # glyphs with no Unicode mapping, e.g. "(cid:20)" -> "1"
        for cid, ch in (glyphs or {}).items():
            if cid.startswith("_"):
                continue
            w["text"] = w["text"].replace(cid, ch)
    rows = []   # [top, bold, [words]]
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        bold = "Bold" in w["fontname"]
        for row in rows:
            gap = abs(row[0] - w["top"])
            if gap <= 1.0 or (row[1] == bold and gap <= 2.5):
                row[2].append(w)
                break
        else:
            rows.append([w["top"], bold, [w]])
    lines = []
    for top, _, ws in rows:
        ws.sort(key=lambda w: w["x0"])
        merged = []
        for w in ws:
            if merged and w["x0"] - merged[-1]["x1"] < 0.6:
                merged[-1] = {**merged[-1], "text": merged[-1]["text"] + w["text"],
                              "x1": w["x1"], "bottom": max(merged[-1]["bottom"], w["bottom"])}
            else:
                merged.append(dict(w))
        lines.append(Line([Word(w["text"], w["x0"], w["top"], w["x1"] - w["x0"],
                                w["bottom"] - w["top"], 100.0) for w in merged]))
    return sorted(lines, key=lambda l: l.top)


def iter_pages(pdf_path, cfg):
    """Yield (page_no, lines, unit) from OCR word boxes or the text layer.

    `unit` is the size of one PDF point in the word coordinates (pixels at
    the OCR resolution, or 1 for the text layer), for distance thresholds.
    """
    if cfg.get("source", "ocr") == "text":
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                yield i + 1, load_text_page_lines(page, cfg.get("glyph_map")), 1.0
        return
    dpi = cfg["ocr"]["dpi"]
    for tsv in sorted(cache_dir(pdf_path, dpi).glob("page_*.tsv")):
        yield int(tsv.stem.split("_")[1]), load_page_lines(tsv), dpi / 72


# --------------------------------------------------------------------------
# Column header -> x anchors
# --------------------------------------------------------------------------

def find_layout(lines, layouts, unit=1.0):
    """Try each configured layout; return (layout, anchors, texts, end) or None.

    A page whose header looks like a table header but matches no layout is an
    error, so a year with an unexpected column order fails loudly.
    """
    errors = []
    for layout in layouts:
        try:
            found = header_columns(lines, layout, unit)
        except HeaderMismatch as e:
            errors.append(str(e))
            continue
        if found:
            return (layout, *found)
    if errors:
        raise HeaderMismatch("; ".join(errors))
    return None


def header_columns(lines, layout, unit=1.0):
    """Find the column header and match it to the configured columns.

    Returns (anchors, header_texts, header_end_index) or None if this is not
    a page of this layout. Header words that overlap horizontally belong to
    the same column ("2025" / "ORIGINAL" / "BUDGET" are stacked).
    """
    last = re.compile(layout["header_last_line"])
    end = next((i for i, l in enumerate(lines[:8]) if last.search(l.text)), None)
    if end is None:
        return None
    line_of = {id(w): i for i, l in enumerate(lines[:end + 1]) for w in l.words}
    words = sorted((w for l in lines[:end + 1] for w in l.words), key=lambda w: w.left)
    clusters = []
    for w in words:
        if clusters and w.left <= clusters[-1]["right"] + 5 * unit:
            clusters[-1]["words"].append(w)
            clusters[-1]["right"] = max(clusters[-1]["right"], w.right)
        else:
            clusters.append({"words": [w], "right": w.right})
    columns = layout["columns"]
    if len(clusters) < len(columns):
        return None
    clusters = clusters[-len(columns):]
    texts, anchors = [], []
    for cl, col in zip(clusters, columns):
        ws = sorted(cl["words"], key=lambda w: (line_of[id(w)], w.left))
        text = " ".join(w.text for w in ws)
        m = re.search(col["header"], text)
        if not m:
            raise HeaderMismatch(f"header column {text!r} does not match {col['header']!r}")
        texts.append((text, m.groups()))
        anchors.append(sum(w.xc for w in cl["words"]) / len(cl["words"]))
    return anchors, texts, end


# --------------------------------------------------------------------------
# Amount cells
# --------------------------------------------------------------------------

OCR_DIGIT_FIXES = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "S": "5"})


def read_amount(raw):
    """Parse one OCR'd amount cell. Returns (value or None, flags list)."""
    flags = []
    text = raw.strip().replace("$", "")
    # Marks picked up from rules next to the digits ("~—«-17,753,825",
    # "26,022,439+"). A lone leading "-" is kept: it may be a minus sign.
    m = re.match(r"^([^\d(]*)(.*?)([^\d)]*)$", text)
    head, core, tail = m.groups()
    if head not in ("", "-"):
        head = ""
    text = head + core
    if text != raw.strip().replace("$", ""):
        flags.append("stripped_marks")
    if re.fullmatch(r"[\d,.()\-OolIS]+", text) and re.search(r"[OolIS]", text):
        text = text.translate(OCR_DIGIT_FIXES)
        flags.append("letter_as_digit")
    # A period inside a whole-dollar amount is a misread comma ("2,105.233").
    if re.fullmatch(r"\(?-?\d{1,3}([.,]\d{3})+\)?", text) and "." in text:
        text = text.replace(".", ",")
        flags.append("period_as_comma")
    if not RE_AMOUNT.match(text):
        if re.fullmatch(r"\(?-?\d{4,}\)?", text):
            flags.append("missing_comma")   # value unambiguous, format odd
        else:
            return None, flags + ["unreadable"]
    if text == "-":
        return 0, flags + ["dash_as_zero"]
    return to_number(text), flags


def assign_cells(words, anchors, single_pitch=300):
    """Group amount words by nearest column anchor."""
    pitch = min(b - a for a, b in zip(anchors, anchors[1:])) if len(anchors) > 1 else single_pitch
    cells = [[] for _ in anchors]
    stray = []
    for w in words:
        dists = [abs(w.xc - a) for a in anchors]
        k = dists.index(min(dists))
        if dists[k] > 0.5 * pitch:
            stray.append(w)
        else:
            cells[k].append(w)
    return cells, stray


def parse_amounts(words, anchors, keys, single_pitch=300):
    """Return ({key: value}, [cell problems]) for one table row."""
    cells, stray = assign_cells(words, anchors, single_pitch)
    values, problems = {}, []
    for key, cell in zip(keys, cells):
        if not cell:
            values[key] = None
            problems.append({"column": key, "ocr_text": "", "problem": "missing"})
            continue
        raw = "".join(w.text for w in cell)
        value, flags = read_amount(raw)
        if len(cell) > 1:
            flags.append("joined_words")
        values[key] = value
        conf = min(w.conf for w in cell)
        if flags:
            problems.append({"column": key, "ocr_text": " ".join(w.text for w in cell),
                             "problem": "+".join(flags), "value": value,
                             "conf": conf})
    for w in stray:
        if not RE_NOISE.match(w.text):
            problems.append({"column": "", "ocr_text": w.text, "problem": "stray_word"})
    return values, problems


# --------------------------------------------------------------------------
# Corrections reviewed by a person
# --------------------------------------------------------------------------

def load_corrections(source_doc):
    if not CORRECTIONS_FILE.exists():
        return {}
    df = pd.read_csv(CORRECTIONS_FILE, dtype=str, keep_default_na=False)
    df = df[df.source_doc == source_doc]
    return {(int(r.source_page), r.row_label, r.column): r for r in df.itertuples()}


# --------------------------------------------------------------------------
# Main extraction
# --------------------------------------------------------------------------

def extract(pdf_path, cfg):
    source_doc = cfg["source_doc"]
    li = cfg["line_items"]
    layouts = li.get("layouts") or [{"name": "main", "columns": li["columns"],
                                     "header_last_line": li["header_last_line"]}]
    columns, keys = [], []          # union over layouts, in config order
    for lay in layouts:
        lay["keys"] = [f"{c['doc_type']}_{c['fiscal_year']}" for c in lay["columns"]]
        for c, k in zip(lay["columns"], lay["keys"]):
            if k not in keys:
                keys.append(k)
                columns.append((c["fiscal_year"], c["doc_type"]))
    inherit = li.get("inherit_header", False)
    prev_header = None
    re_total = re.compile(li["total_prefix"])
    fund_and_department = make_fund_mapper(
        cfg["funds"], cfg["general_fund_departments"],
        cfg.get("general_fund_department_overrides", {}))

    st = cfg["staffing"]
    st_keys = [(f"count_{c['fiscal_year']}_{c['doc_type']}",
                f"salary_{c['fiscal_year']}_{c['doc_type']}") for c in st["columns"]]
    st_flat = [k for pair in st_keys for k in pair]
    # Per book; reset every run so one book's pattern never leaks into the next.
    STAFF_FIELD["count"] = re.compile(st.get("count_pattern") or DEFAULT_COUNT)

    corrections = load_corrections(source_doc)
    signs, used_signs = load_signs(source_doc), set()
    staff_fixes, used_staff_fixes = load_staff_fixes(source_doc), set()
    used_corrections = set()

    items, sections, staff, staff_checks, unparsed, cell_log = [], [], [], [], [], []
    open_items, leaf_totals = [], []
    staff_unit, open_positions, open_staff_groups = None, [], []
    units_without_total = []
    seen_pages = {}
    page_kinds = {}

    for page_no, lines, unit in iter_pages(pdf_path, cfg):
        if not lines:
            page_kinds[page_no] = "blank"
            continue
        header = find_layout(lines, layouts, unit)
        if header is None and inherit and prev_header and \
                _continues_table(lines, prev_header, unit):
            # Continuation page printed without the column header: reuse the
            # previous page's columns (numbers must still line up with them).
            header = (*prev_header[:3], -1)
        prev_header = header

        # ---------------- line-item pages --------------------------------
        if header:
            page_kinds[page_no] = "line_items"
            layout, anchors, header_texts, end = header
            lkeys = layout["keys"]
            single = 80 * unit
            ytd_as_of = next((g[0] for _, g in header_texts if g), "")
            amount_left = anchors[0] - 0.5 * (
                anchors[1] - anchors[0] if len(anchors) > 1 else single)
            body = lines[end + 1:]
            fingerprint = "\n".join(l.text for l in body)
            if fingerprint in seen_pages:
                sections.append({
                    "level": "duplicate_page",
                    "label": f"Page {page_no} repeats page {seen_pages[fingerprint]}; skipped",
                    "source_page": page_no, "members": 0, "max_abs_diff": 0,
                    "passed": False})
                continue
            seen_pages[fingerprint] = page_no
            state, last_item = "heading", None
            for line in body:
                ws = [w for w in line.words if not RE_NOISE.match(w.text)]
                if not ws:
                    continue
                left_ws = [w for w in ws if w.xc < amount_left]
                amt_ws = [w for w in ws if w.xc >= amount_left]
                text = " ".join(w.text for w in ws)

                # line item: <org> <object> <name> <amounts>
                if len(left_ws) >= 2 and RE_ORG.match(left_ws[0].text) \
                        and RE_OBJ.match(left_ws[1].text):
                    org, obj = left_ws[0].text, left_ws[1].text
                    label = f"{org}-{obj}"
                    values, problems = parse_amounts(amt_ws, anchors, lkeys, single)
                    values = _apply_corrections(values, problems, corrections,
                                                used_corrections, page_no, label)
                    values, as_printed = _apply_signs(values, signs, used_signs,
                                                      page_no, label)
                    fund, dept = fund_and_department(org)
                    item = {
                        "org_code": org, "object_code": obj, "account_code": label,
                        "account_name": _name(line, left_ws, amount_left,
                                              corrections, used_corrections,
                                              page_no, label),
                        "fund": fund, "department": dept,
                        "category": category_for(obj), "source_page": page_no,
                        "description": "", "ytd_as_of": ytd_as_of,
                        "as_printed": as_printed,
                        "ocr_flags": "; ".join(
                            f"{p['column']}:{p['problem']}" for p in problems),
                        **values,
                    }
                    _log_cells(cell_log, page_no, label, problems)
                    items.append(item)
                    open_items.append(item)
                    state, last_item = "note", item
                    continue

                # section / roll-up total
                m = re_total.match(text)
                if m:
                    label = " ".join(w.text for w in left_ws)
                    label = re_total.sub("", label).strip(" ~_-")
                    if not amt_ws:          # heading such as "TOTAL GENERAL FUND"
                        state = "heading"
                        continue
                    printed, problems = parse_amounts(amt_ws, anchors, lkeys, single)
                    printed = _apply_corrections(printed, problems, corrections,
                                                 used_corrections, page_no, f"TOTAL {label}")
                    _log_cells(cell_log, page_no, f"TOTAL {label}", problems)
                    printed = [printed[k] if printed[k] is not None else 0 for k in lkeys]
                    if open_items:
                        level, n_members = "section", len(open_items)
                        for it in open_items:
                            it["bureau"] = label
                        sums = [sum(it.get(k) or 0 for it in open_items) for k in lkeys]
                        diffs = [s - p for s, p in zip(sums, printed)]
                        leaf_totals.append(dict(zip(lkeys, printed)))
                        open_items = []
                    elif not any(printed):
                        # A bureau with no lines and an all-zero total.
                        level, n_members, diffs = "section", 0, [0] * len(lkeys)
                    else:
                        level = "rollup"
                        n_members, diffs = find_rollup(
                            [[lt.get(k, 0) for k in lkeys] for lt in leaf_totals], printed)
                    sections.append(total_check(level, label, page_no, n_members,
                                                diffs, printed, lkeys))
                    state = "heading"
                    continue

                if amt_ws and any(re.search(r"\d", w.text) for w in amt_ws):
                    unparsed.append({"source_page": page_no, "text": text})
                    continue
                if state == "note" and re.search(r"[A-Za-z]{2}", text):
                    last_item["description"] = (last_item["description"] + " " + text).strip()
            continue

        # ---------------- staffing schedules -----------------------------
        page_text = "\n".join(l.text for l in lines)
        # Continuation pages have no title; some hold only the closing
        # "TOTAL ... EMPLOYEES" rows of the previous page's schedule.
        is_staffing = "PROJECTION" not in page_text and (
            "STAFFING SCHEDULE" in page_text
            or re.search(r"^TOTAL\b.*\bEMPLOYEES\b", page_text, re.M)
            or sum(bool(re.match(r"^\d{7,8} \d{6} ", _clean(l))) for l in lines) >= 3)
        if not is_staffing:
            page_kinds[page_no] = "other"
            continue
        page_kinds[page_no] = "staffing"
        fingerprint = page_text
        if fingerprint in seen_pages:
            sections.append({
                "level": "duplicate_page",
                "label": f"Page {page_no} repeats page {seen_pages[fingerprint]}; skipped",
                "source_page": page_no, "members": 0, "max_abs_diff": 0,
                "passed": False})
            continue
        seen_pages[fingerprint] = page_no
        # Everything down to the "APPROPRIATION CODE ..." column header is
        # page furniture (some books print sideways labels such as "NOINU").
        header_end = next((i for i, l in enumerate(lines) if "APPROPRIATION" in l.text), -1)
        org_left = None
        for line in lines[header_end + 1:]:
            toks = _tokens(line)
            text = " ".join(toks)
            if len(toks) >= 3 and re.fullmatch(r"\d{6,8}", toks[0]):
                org_left = line.words[0].left
                # <org> <object> ...; a few rows print a malformed or missing
                # object code ("61090", none at all). Keep what is printed.
                org = toks[0]
                has_obj = re.fullmatch(r"\d{5,6}", toks[1]) is not None
                obj = toks[1] if has_obj else ""
                fields, problems = parse_staff_row(toks[2 if has_obj else 1:], st_keys,
                                                   st.get("row"))
                if not RE_OBJ.match(obj):
                    problems.append({"column": "object_code", "ocr_text": obj,
                                     "problem": "object_code_as_printed", "value": obj})
                label = f"{org}-{obj} {fields['position_title']}".strip()
                _log_cells(cell_log, page_no, label, problems)
                fund, dept = fund_and_department(org)
                pos = {"org_code": org, "object_code": obj, "fund": fund,
                       "department": dept, "unit": staff_unit, **fields,
                       "_count_seen": fields.pop("_count_seen"),
                       "source_page": page_no,
                       "as_printed": _apply_staff_fixes(fields, staff_fixes,
                                                        used_staff_fixes, page_no, org, obj),
                       "ocr_flags": "; ".join(
                           f"{p['column']}:{p['problem']}" for p in problems)}
                pos.update({k: fields[k] for k in st_flat})
                staff.append(pos)
                open_positions.append(pos)
                continue
            if toks and toks[0] == "TOTAL" and len(toks) >= 3:
                middle, printed, problems = parse_staff_total(toks[1:], len(st_keys))
                _log_cells(cell_log, page_no, text, problems)
                if printed is None:
                    unparsed.append({"source_page": page_no, "text": text})
                    continue
                if middle[-1:] == ["EMPLOYEES"] and len(middle) == 2:
                    sums = [sum(p[k] for p in open_positions) for k in st_flat]
                    staff_checks.append(staff_check(
                        "object", f"{staff_unit} / {middle[0]}", page_no,
                        len(open_positions), sums, printed))
                    open_staff_groups.append(printed)
                    open_positions = []
                elif middle == ["EMPLOYEES"]:
                    groups = open_staff_groups + (
                        [[sum(p[k] for p in open_positions) for k in st_flat]]
                        if open_positions else [])
                    sums = [sum(g[i] for g in groups) for i in range(len(st_flat))]
                    staff_checks.append(staff_check(
                        "unit", staff_unit, page_no, len(groups), sums, printed))
                    open_staff_groups, open_positions = [], []
                elif all(re.fullmatch(r"\d{4}", m) for m in middle) and staff:
                    sums = [sum(p[k] for p in staff) for k in st_flat]
                    staff_checks.append(staff_check(
                        "grand_total", "All staffing schedules", page_no,
                        len(staff), sums, printed))
                else:
                    unparsed.append({"source_page": page_no, "text": text})
                continue
            # A count or salary printed a few points off its row lands on a
            # line of its own; give it back to the position above.
            if open_positions and len(toks) == 1:
                prev = open_positions[-1]
                ck, sk = st_keys[0]
                if STAFF_FIELD["count"].match(toks[0]) and prev.get("_count_seen") is False:
                    prev[ck] = float(toks[0])
                    prev["_count_seen"] = True
                    prev["ocr_flags"] = (prev["ocr_flags"] + "; count on next line").strip("; ")
                    continue
                if RE_SALARY.fullmatch(toks[0]) and "no_salary_printed" in prev["ocr_flags"]:
                    prev[sk] = read_salary(toks[0])[0] or 0
                    prev["ocr_flags"] = prev["ocr_flags"].replace(
                        f"{sk}:no_salary_printed", "salary on next line")
                    continue
            # Uncoded rows inside a schedule ("Available for Merit - AFSCME
            # 23,535", "Bonus & Merit Pay") count toward the subtotal; they
            # take the codes of the position above them.
            if open_positions and toks and not toks[0].isdigit() \
                    and re.search(r"[A-Za-z]{3}", text) \
                    and RE_SALARY.fullmatch(toks[-1]) and len(toks) > 1:
                prev = open_positions[-1]
                value, flags = read_salary(toks[-1])
                pos = {**{k: prev[k] for k in ("org_code", "object_code", "fund",
                                               "department", "unit")},
                       "position_title": " ".join(toks[:-1]), "bargaining_unit": "",
                       "ft_pt": "", **{k: 0.0 for k in st_flat},
                       st_keys[0][1]: value or 0, "source_page": page_no,
                       "ocr_flags": "uncoded row"}
                staff.append(pos)
                open_positions.append(pos)
                continue
            # Unit headings start at or left of the code column; an all-caps
            # title alone in the title column is a vacancy line, not a heading.
            if (text.isupper() and not re.search(r"\d", text) and len(text) > 3
                    and (org_left is None or line.words[0].left <= org_left + 5 * unit)
                    and "STAFFING SCHEDULE" not in text
                    and text not in {"CITY OF LANCASTER"}
                    and not text.startswith(("APPROPRIATION", "TOTAL"))):
                new_unit = " ".join(w.text for w in line.words
                                    if not RE_NOISE.match(w.text)).title()
                if new_unit != staff_unit and (open_staff_groups or open_positions):
                    # The previous unit printed no "TOTAL EMPLOYEES" row (older
                    # books skip it); its object subtotals were still checked.
                    units_without_total.append((page_no, staff_unit))
                    open_staff_groups, open_positions = [], []
                staff_unit = new_unit
                continue
            if re.match(r"^\d{7,8} ", text):
                unparsed.append({"source_page": page_no, "text": text})

    if units_without_total:
        print(f"Staffing units with no printed unit total (object subtotals still "
              f"checked): {len(units_without_total)}")
    if open_items:
        unparsed.append({"source_page": -1,
                         "text": f"{len(open_items)} line items never closed by a TOTAL"})
    for key in sorted(set(staff_fixes) - used_staff_fixes):
        unparsed.append({"source_page": key[0],
                         "text": f"staffing correction for {key[1:]} matched no position"})
    for key in sorted(set(signs) - used_signs):
        unparsed.append({"source_page": key[0],
                         "text": f"sign correction for {key[1]} / {key[2]} matched no line"})
    unused = set(corrections) - used_corrections
    for key in sorted(unused):
        unparsed.append({"source_page": key[0],
                         "text": f"correction for {key[1]} / {key[2]} matched no OCR cell"})
    return (items, sections, staff, staff_checks, unparsed, cell_log,
            columns, keys, page_kinds)


def _continues_table(lines, prev_header, unit):
    """Does a header-less page continue the previous page's table?

    Most of its coded rows must carry exactly one number per column, and
    nothing on it may look like a staffing schedule.
    """
    text = "\n".join(l.text for l in lines)
    if "STAFFING" in text or re.search(r"\bEMPLOYEES\b", text):
        return False
    n_cols = len(prev_header[1])
    rows = [l for l in lines if len(l.words) > 2 and (
        (RE_ORG.match(l.words[0].text) and RE_OBJ.match(l.words[1].text))
        or l.words[0].text == "TOTAL")]
    if not rows:
        return False
    fits = sum(sum(bool(re.fullmatch(r"\(?-?[\d,]+\)?", w.text)) for w in l.words[2:]) == n_cols
               for l in rows)
    return fits >= 0.8 * len(rows)


def _clean(line):
    return " ".join(_tokens(line))


def _tokens(line):
    """Words with stray border marks trimmed ("+=MAYOR" -> "MAYOR", "1000." -> "1000")."""
    toks = (w.text if w.text == "&" else re.sub(r"^[^\w(]+|[^\w)]+$", "", w.text)
            for w in line.words)
    out = []
    for t in toks:
        if re.fullmatch(r"\d{13,14}", t):     # "56289100611500": org+object run together
            out += [t[:-6], t[-6:]]
        elif t:
            out.append(t)
    return out


RE_COUNT = re.compile(r"^\d+\.\d{2}$")


DEFAULT_COUNT = r"^\d+\.\d{1,2}$"
STAFF_FIELD = {
    "count": re.compile(DEFAULT_COUNT),
    "ft_pt": re.compile(r"^(FT|PT|F|P|[FP][A-Za-z1])$"),
    "bargaining_unit": re.compile(r"^(\d{4}|[A-Z])$"),
}
# A salary cell: 52,530 / 643,122.78 / (250,000) for allowances.
RE_SALARY = re.compile(r"\(?[\d,]+(\.\d{1,2})?\)?")
DEFAULT_STAFF_ROW = ["title", "bargaining_unit", "ft_pt", "count", "salary"]


def read_salary(raw):
    """Salary cell; staffing pages sometimes print cents ("643,122.78")."""
    if re.fullmatch(r"\d{1,3}(,\d{3})*\.\d{1,2}", raw):
        return float(raw.replace(",", "")), []
    return read_amount(raw)


def parse_staff_row(rest, st_keys, row_order=None):
    """Parse the fields after <org> <object>, in the book's column order.

    `row_order` comes from the config, e.g. ["title", "bargaining_unit",
    "ft_pt", "count", "salary"] or ["ft_pt", "bargaining_unit", "count",
    "title", "salary"]. Fields left of the title are read from the left,
    fields right of it from the right. A field that is not there (bonus rows
    have no count or FT/PT) is left blank, count 0.
    """
    order = row_order or DEFAULT_STAFF_ROW
    count_key, salary_key = st_keys[0]
    t = order.index("title")
    rest, got, problems = list(rest), {}, []
    for field in order[:t]:
        if rest and (field not in STAFF_FIELD or STAFF_FIELD[field].match(rest[0])):
            got[field] = rest.pop(0)
    for field in reversed(order[t + 1:]):
        if not rest:
            break
        if field == "salary":
            if RE_SALARY.fullmatch(rest[-1]):
                got[field] = rest.pop()
        elif STAFF_FIELD[field].match(rest[-1]):
            got[field] = rest.pop()
    raw = got.get("salary", "")
    # A position printed with no salary (a vacancy) is blank, not an error;
    # the subtotal check decides whether anything is really missing.
    value, flags = read_salary(raw) if raw else (0, ["no_salary_printed"])
    if flags:
        problems.append({"column": salary_key, "ocr_text": raw,
                         "problem": "+".join(flags), "value": value})
    ftpt = got.get("ft_pt", "")
    if ftpt and ftpt not in ("FT", "PT", "F", "P"):
        problems.append({"column": "ft_pt", "ocr_text": ftpt,
                         "problem": "ft_pt_misread", "value": ftpt[0] + "T"})
        ftpt = ftpt[0] + "T"
    ftpt = {"F": "FT", "P": "PT"}.get(ftpt, ftpt)
    return {"position_title": " ".join(rest),
            "bargaining_unit": got.get("bargaining_unit", ""), "ft_pt": ftpt,
            count_key: float(got["count"]) if "count" in got else 0.0,
            "_count_seen": "count" in got,
            salary_key: value if value is not None else 0}, problems


def parse_staff_total(toks, n_pairs):
    """'... <count> <salary>' x n_pairs -> (label words, [c, s, ...], problems)."""
    toks, nums, problems = list(toks), [], []
    for _ in range(n_pairs):
        if len(toks) < 2 or not STAFF_FIELD["count"].match(toks[-2]):
            return toks, None, problems
        salary, flags = read_salary(toks.pop())
        count = float(toks.pop())
        if flags:
            problems.append({"column": "salary", "ocr_text": str(salary),
                             "problem": "+".join(flags), "value": salary})
        if salary is None:
            return toks, None, problems
        nums = [count, salary] + nums
    return toks, nums, problems


def _name(line, left_ws, amount_left, corrections, used, page_no, label):
    """Account name: the words between the codes and the amounts.

    Keeps a " - " between words ("Maint. - Vehicles"), which the noise filter
    would drop. Names are not covered by any total, so a person's fix in the
    corrections file (column "account_name") wins.
    """
    key = (page_no, label, "account_name")
    if key in corrections:
        used.add(key)
        return corrections[key].corrected_value
    words = [w.text for w in line.words
             if w.xc < amount_left and w.left > left_ws[1].right
             and (not RE_NOISE.match(w.text) or w.text in ("-", "–"))]
    while words and words[0] in ("-", "–"):
        words.pop(0)
    while words and words[-1] in ("-", "–"):
        words.pop()
    return " ".join(words)


def load_signs(source_doc):
    """Sign flips proven by printed totals (scripts/sign_corrections.py)."""
    if not SIGN_FILE.exists():
        return {}
    df = pd.read_csv(SIGN_FILE, dtype=str, keep_default_na=False)
    df = df[df.source_doc == source_doc]
    return {(int(r.source_page), r.account_code, r.column): r for r in df.itertuples()}


def load_staff_fixes(source_doc):
    """Staffing cells corrected because a printed subtotal proves the value
    (data/staffing_corrections.csv)."""
    if not STAFF_FIX_FILE.exists():
        return {}
    df = pd.read_csv(STAFF_FIX_FILE, dtype=str, keep_default_na=False)
    df = df[df.source_doc == source_doc]
    return {(int(r.source_page), r.org_code, r.object_code, r.position_title, r.column,
             r.printed_value): r for r in df.itertuples()}


def _apply_staff_fixes(fields, fixes, used, page_no, org, obj):
    """Apply logged corrections to one position; return "col=printed" for audit."""
    printed = []
    for column in [k for k in fields if k.startswith(("salary_", "count_"))]:
        value = fields[column]
        key = (page_no, org, obj, fields["position_title"], column,
               f"{value:g}" if isinstance(value, float) else str(value))
        if key in fixes:
            printed.append(f"{column}={key[-1]}")
            fields[column] = to_number(fixes[key].corrected_value)
            used.add(key)
    return "; ".join(printed)


def _apply_signs(values, signs, used, page_no, label):
    """Flip the logged values; return (values, "col=printed; ..." for audit)."""
    printed = []
    for column in list(values):
        key = (page_no, label, column)
        if key not in signs:
            continue
        c = signs[key]
        if values[column] != to_number(c.printed_value):
            raise ValueError(f"sign correction {key} expects printed {c.printed_value}, "
                             f"page has {values[column]}")
        printed.append(f"{column}={c.printed_value}")
        values[column] = to_number(c.corrected_value)
        used.add(key)
    return values, "; ".join(printed)


def _apply_corrections(values, problems, corrections, used, page_no, label):
    """Replace OCR'd cells with values a person read off the page image."""
    for column in list(values):
        key = (page_no, label, column)
        if key not in corrections:
            continue
        c = corrections[key]
        flagged = next((p for p in problems if p["column"] == column), None)
        if flagged is None:   # misread that looked well-formed; caught by a total
            flagged = {"column": column, "problem": "misread",
                       "value": values[column]}
            problems.append(flagged)
        flagged["ocr_text"] = c.ocr_text
        flagged["corrected_to"] = c.corrected_value
        values[column] = to_number(c.corrected_value)
        used.add(key)
    return values


def _log_cells(cell_log, page_no, label, problems):
    for p in problems:
        cell_log.append({"source_page": page_no, "row_label": label, **p})


def cell_checks(cell_log):
    """Unreadable or missing amounts fail the run until corrected by a person."""
    checks = []
    for c in cell_log:
        bad = c["problem"] == "missing" or "unreadable" in c["problem"] \
            or c["problem"] == "stray_word"
        if not bad:
            continue
        fixed = "corrected_to" in c
        checks.append({
            "level": "ocr_cell", "label": f"{c['row_label']} / {c['column'] or '?'}",
            "source_page": c["source_page"], "members": 1, "max_abs_diff": 0,
            "passed": fixed,
        })
    return checks


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--config", type=Path)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()
    if not run(args.pdf, args.config, args.out)["ok"]:
        sys.exit(1)


def run(pdf, config=None, out=OUT_DIR):
    """Extract and validate one book. Returns a stats dict ("ok" = no
    unreviewed failures)."""
    args = argparse.Namespace(pdf=Path(pdf), config=config, out=Path(out))
    cfg_path = args.config or CONFIG_DIR / f"{args.pdf.stem}.json"
    cfg = json.loads(cfg_path.read_text())
    if cfg["source_doc"] != args.pdf.name:
        sys.exit(f"{cfg_path} is for {cfg['source_doc']}, not {args.pdf.name}")
    if cfg.get("source", "ocr") == "ocr":
        ocr_document(args.pdf, cfg["ocr"]["dpi"],
                     fallback_rotate=cfg["ocr"].get("fallback_rotate", 0))

    (items, sections, staff, staff_checks, unparsed, cell_log,
     columns, keys, page_kinds) = extract(args.pdf, cfg)
    doc = args.pdf.stem
    args.out.mkdir(parents=True, exist_ok=True)

    wide = pd.DataFrame(items)
    cols = ["fund", "department", "bureau", "account_code", "org_code",
            "object_code", "account_name", "category", *keys, "ytd_as_of",
            "description", "source_page", "as_printed", "ocr_flags"]
    wide = wide.reindex(columns=cols)
    wide.to_csv(args.out / f"line_items_{doc}.csv", index=False)
    to_long(items, columns, keys, args.pdf.name).to_csv(
        args.out / f"budget_long_{doc}.csv", index=False)
    pd.DataFrame(staff).drop(columns=["_count_seen"], errors="ignore").to_csv(
        args.out / f"staffing_{doc}.csv", index=False)
    pd.DataFrame(cell_log).to_csv(args.out / f"ocr_cells_{doc}.csv", index=False)

    checks = pd.DataFrame(sections + staff_checks + cell_checks(cell_log))
    checks = acknowledge_known_issues(checks, args.pdf.name)
    checks.to_csv(args.out / f"validation_{doc}.csv", index=False)

    kinds = pd.Series(page_kinds).value_counts()
    print("Pages: " + ", ".join(f"{k} {v}" for k, v in kinds.items()))
    print(f"OCR cells flagged: {len(cell_log)} "
          f"(see ocr_cells_{doc}.csv)")
    ok = print_summary(items, staff, checks, unparsed)
    return {"ok": ok, "line_items": len(items), "positions": len(staff),
            **check_counts(checks), "source": cfg.get("source", "ocr")}


if __name__ == "__main__":
    main()
