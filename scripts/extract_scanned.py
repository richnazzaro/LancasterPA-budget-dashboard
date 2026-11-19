"""Extract a scanned (image-only) City of Lancaster budget PDF via OCR.

Usage:
    python scripts/extract_scanned.py "/path/to/2026-Adopted-Budget-2026.pdf"
    python scripts/extract_scanned.py PDF --config config/<doc>.json

Steps:
  1. OCR every page to word boxes (scripts/ocr_pages.py; cached and git-ignored).
  2. Read each page's column header, check it against the per-document config
     (config/<pdf stem>.json), and assign every number to a column by its
     x-position on the page, not by its order in the line.
  3. Rebuild line items, section TOTAL rows and staffing schedules, and
     re-check every printed total exactly as extract_budget.py does.
  4. Write the same four tables as the text-layer extractor, plus
     ocr_cells_<doc>.csv: every amount cell that OCR did not read cleanly.

Any number that OCR could not read as a well-formed amount fails the run,
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
    total_check,
)
from ocr_pages import cache_dir, ocr_document

CONFIG_DIR = ROOT / "config"
CORRECTIONS_FILE = ROOT / "data" / "ocr_corrections.csv"

RE_ORG = re.compile(r"^\d{7,8}$")
RE_OBJ = re.compile(r"^\d{6}$")
# A well-formed printed amount: 0, 1,234, (1,234), -1,234 or a bare dash.
RE_AMOUNT = re.compile(r"^(\(?-?\d{1,3}(,\d{3})*\)?|-)$")
# Stray marks OCR picks up from table rules and gray bands.
RE_NOISE = re.compile(r"^[|—_\-–©‘’'\"“”~.,:;=»«]+$")


# --------------------------------------------------------------------------
# OCR words -> lines
# --------------------------------------------------------------------------

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


# --------------------------------------------------------------------------
# Column header -> x anchors
# --------------------------------------------------------------------------

def header_columns(lines, layout):
    """Find the column header and match it to the configured columns.

    Returns (anchors, header_texts, header_end_index) or None if this is not
    a page of this layout. Header words that overlap horizontally belong to
    the same column ("2025" / "ORIGINAL" / "BUDGET" are stacked).
    """
    last = re.compile(layout["header_last_line"])
    end = next((i for i, l in enumerate(lines[:8]) if last.search(l.text)), None)
    if end is None:
        return None
    words = sorted((w for l in lines[:end + 1] for w in l.words), key=lambda w: w.left)
    clusters = []
    for w in words:
        if clusters and w.left <= clusters[-1]["right"] + 5:
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
        ws = sorted(cl["words"], key=lambda w: (round(w.top / 15), w.left))
        text = " ".join(w.text for w in ws)
        m = re.search(col["header"], text)
        if not m:
            raise ValueError(f"header column {text!r} does not match {col['header']!r}")
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
    text = raw.strip().lstrip("$")
    # Marks picked up from rules next to the digits ("~—«-17,753,825",
    # "26,022,439+"). A lone leading "-" is kept: it may be a minus sign.
    m = re.match(r"^([^\d(]*)(.*?)([^\d)]*)$", text)
    head, core, tail = m.groups()
    if head not in ("", "-"):
        head = ""
    text = head + core
    if text != raw.strip():
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


def assign_cells(words, anchors):
    """Group amount words by nearest column anchor."""
    pitch = min(b - a for a, b in zip(anchors, anchors[1:])) if len(anchors) > 1 else 300
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


def parse_amounts(words, anchors, keys):
    """Return ({key: value}, [cell problems]) for one table row."""
    cells, stray = assign_cells(words, anchors)
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
    columns = [(c["fiscal_year"], c["doc_type"]) for c in li["columns"]]
    keys = [f"{doc}_{fy}" for fy, doc in columns]
    re_total = re.compile(li["total_prefix"])
    fund_and_department = make_fund_mapper(
        cfg["funds"], cfg["general_fund_departments"],
        cfg.get("general_fund_department_overrides", {}))

    st = cfg["staffing"]
    st_keys = [(f"count_{c['fiscal_year']}_{c['doc_type']}",
                f"salary_{c['fiscal_year']}_{c['doc_type']}") for c in st["columns"]]
    st_flat = [k for pair in st_keys for k in pair]

    corrections = load_corrections(source_doc)
    used_corrections = set()

    items, sections, staff, staff_checks, unparsed, cell_log = [], [], [], [], [], []
    open_items, leaf_totals = [], []
    staff_unit, open_positions, open_staff_groups = None, [], []
    seen_pages = {}
    page_kinds = {}

    tsv_dir = cache_dir(pdf_path, cfg["ocr"]["dpi"])
    for tsv in sorted(tsv_dir.glob("page_*.tsv")):
        page_no = int(tsv.stem.split("_")[1])
        meta = json.loads(tsv.with_suffix(".json").read_text())
        lines = load_page_lines(tsv)
        if not lines:
            page_kinds[page_no] = "blank"
            continue
        header = header_columns(lines, li)

        # ---------------- line-item pages --------------------------------
        if header:
            page_kinds[page_no] = "line_items"
            anchors, header_texts, end = header
            ytd_as_of = next((g[0] for _, g in header_texts if g), "")
            amount_left = anchors[0] - 0.5 * (anchors[1] - anchors[0])
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
                    values, problems = parse_amounts(amt_ws, anchors, keys)
                    values = _apply_corrections(values, problems, corrections,
                                                used_corrections, page_no, label)
                    fund, dept = fund_and_department(org)
                    item = {
                        "org_code": org, "object_code": obj, "account_code": label,
                        "account_name": _name(line, left_ws, amount_left,
                                              corrections, used_corrections,
                                              page_no, label),
                        "fund": fund, "department": dept,
                        "category": category_for(obj), "source_page": page_no,
                        "description": "", "ytd_as_of": ytd_as_of,
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
                    printed, problems = parse_amounts(amt_ws, anchors, keys)
                    printed = _apply_corrections(printed, problems, corrections,
                                                 used_corrections, page_no, f"TOTAL {label}")
                    _log_cells(cell_log, page_no, f"TOTAL {label}", problems)
                    printed = [printed[k] if printed[k] is not None else 0 for k in keys]
                    if open_items:
                        level, n_members = "section", len(open_items)
                        for it in open_items:
                            it["bureau"] = label
                        sums = [sum(it[k] or 0 for it in open_items) for k in keys]
                        diffs = [s - p for s, p in zip(sums, printed)]
                        leaf_totals.append(printed)
                        open_items = []
                    else:
                        level = "rollup"
                        n_members, diffs = find_rollup(leaf_totals, printed)
                    sections.append(total_check(level, label, page_no, n_members,
                                                diffs, printed, keys))
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
        for line in lines:
            toks = _tokens(line)
            text = " ".join(toks)
            if len(toks) >= 4 and RE_ORG.match(toks[0]) and RE_OBJ.match(toks[1]):
                org, obj = toks[0], toks[1]
                fields, problems = parse_staff_row(toks[2:], st_keys)
                label = f"{org}-{obj} {fields['position_title']}".strip()
                _log_cells(cell_log, page_no, label, problems)
                fund, dept = fund_and_department(org)
                pos = {"org_code": org, "object_code": obj, "fund": fund,
                       "department": dept, "unit": staff_unit, **fields,
                       "source_page": page_no,
                       "ocr_flags": "; ".join(
                           f"{p['column']}:{p['problem']}" for p in problems)}
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
            if (text.isupper() and not re.search(r"\d", text) and len(text) > 3
                    and "STAFFING SCHEDULE" not in text
                    and text not in {"CITY OF LANCASTER"}
                    and not text.startswith(("APPROPRIATION", "TOTAL"))):
                staff_unit = " ".join(w.text for w in line.words
                                      if not RE_NOISE.match(w.text)).title()
                continue
            if re.match(r"^\d{7,8} ", text):
                unparsed.append({"source_page": page_no, "text": text})

    if open_items:
        unparsed.append({"source_page": -1,
                         "text": f"{len(open_items)} line items never closed by a TOTAL"})
    unused = set(corrections) - used_corrections
    for key in sorted(unused):
        unparsed.append({"source_page": key[0],
                         "text": f"correction for {key[1]} / {key[2]} matched no OCR cell"})
    return (items, sections, staff, staff_checks, unparsed, cell_log,
            columns, keys, page_kinds)


def _clean(line):
    return " ".join(_tokens(line))


def _tokens(line):
    """Words with stray border marks trimmed ("+=MAYOR" -> "MAYOR", "1000." -> "1000")."""
    toks = (w.text if w.text == "&" else re.sub(r"^[^\w(]+|[^\w)]+$", "", w.text)
            for w in line.words)
    return [t for t in toks if t]


RE_COUNT = re.compile(r"^\d+\.\d{2}$")


def parse_staff_row(rest, st_keys):
    """Parse '<title> <BU> <FT|PT> (<count> <salary>)...' from the right.

    Bonus rows have no count (and sometimes no FT/PT); their count is 0.
    """
    rest, fields, problems = list(rest), {}, []
    for count_key, salary_key in reversed(st_keys):
        raw = rest.pop() if rest else ""
        value, flags = read_amount(raw) if raw else (None, ["missing"])
        if flags:
            problems.append({"column": salary_key, "ocr_text": raw,
                             "problem": "+".join(flags), "value": value})
        fields[salary_key] = value if value is not None else 0
        fields[count_key] = float(rest.pop()) if rest and RE_COUNT.match(rest[-1]) else 0.0
    ftpt = ""
    if rest and re.fullmatch(r"[FP][A-Za-z1]", rest[-1]):
        ftpt = rest.pop()
        if ftpt not in ("FT", "PT"):
            problems.append({"column": "ft_pt", "ocr_text": ftpt,
                             "problem": "ft_pt_misread", "value": ftpt[0] + "T"})
            ftpt = ftpt[0] + "T"
    bu = rest.pop() if rest and re.fullmatch(r"\d{4}", rest[-1]) else ""
    title = " ".join(rest)
    return {"position_title": title, "bargaining_unit": bu, "ft_pt": ftpt,
            **{k: fields[k] for pair in st_keys for k in pair}}, problems


def parse_staff_total(toks, n_pairs):
    """'... <count> <salary>' x n_pairs -> (label words, [c, s, ...], problems)."""
    toks, nums, problems = list(toks), [], []
    for _ in range(n_pairs):
        if len(toks) < 2 or not RE_COUNT.match(toks[-2]):
            return toks, None, problems
        salary, flags = read_amount(toks.pop())
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

    cfg_path = args.config or CONFIG_DIR / f"{args.pdf.stem}.json"
    cfg = json.loads(cfg_path.read_text())
    if cfg["source_doc"] != args.pdf.name:
        sys.exit(f"{cfg_path} is for {cfg['source_doc']}, not {args.pdf.name}")
    ocr_document(args.pdf, cfg["ocr"]["dpi"],
                 fallback_rotate=cfg["ocr"].get("fallback_rotate", 0))

    (items, sections, staff, staff_checks, unparsed, cell_log,
     columns, keys, page_kinds) = extract(args.pdf, cfg)
    doc = args.pdf.stem
    args.out.mkdir(parents=True, exist_ok=True)

    wide = pd.DataFrame(items)
    cols = ["fund", "department", "bureau", "account_code", "org_code",
            "object_code", "account_name", "category", *keys, "ytd_as_of",
            "description", "source_page", "ocr_flags"]
    wide = wide.reindex(columns=cols)
    wide.to_csv(args.out / f"line_items_{doc}.csv", index=False)
    to_long(items, columns, keys, args.pdf.name).to_csv(
        args.out / f"budget_long_{doc}.csv", index=False)
    pd.DataFrame(staff).to_csv(args.out / f"staffing_{doc}.csv", index=False)
    pd.DataFrame(cell_log).to_csv(args.out / f"ocr_cells_{doc}.csv", index=False)

    checks = pd.DataFrame(sections + staff_checks + cell_checks(cell_log))
    checks = acknowledge_known_issues(checks, args.pdf.name)
    checks.to_csv(args.out / f"validation_{doc}.csv", index=False)

    kinds = pd.Series(page_kinds).value_counts()
    print("Pages: " + ", ".join(f"{k} {v}" for k, v in kinds.items()))
    print(f"OCR cells flagged: {len(cell_log)} "
          f"(see ocr_cells_{doc}.csv)")
    if not print_summary(items, staff, checks, unparsed):
        sys.exit(1)


if __name__ == "__main__":
    main()
