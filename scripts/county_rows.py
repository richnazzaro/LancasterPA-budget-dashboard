"""Read the County of Lancaster budget books' tables into rows.

Every County table prints a label part on the left (fund, department,
account) and four right-aligned cells: two budget years, the variance and the
percent change. The PDF's text layer splits many amounts into pieces
("$ 1 6,560", "$ 7 ,935,488"), so cells are rebuilt from words by position:
each word belongs to the cell whose right edge it ends before, and the pieces
are joined in x order. Splitting the line text on spaces would read
"$ 1 6,560" as two numbers.

Used by extract_county.py.
"""

import csv
import re
from collections import defaultdict

import pandas as pd
import pdfplumber

# Words whose tops are this close (points) are on the same printed row.
ROW_TOLERANCE = 3
# OCR'd rows are Tesseract's own lines; two lines whose words' median
# heights are this close (points) are one printed row. Printed rows are
# about 10 pt apart.
OCR_ROW_TOLERANCE = 3

YEAR_RE = re.compile(r"^(19|20)\d\d$")
ACCOUNT_RE = re.compile(r"^(\d{4})(.*)$")
DEPT_CODE_RE = re.compile(r"^[A-Z]\d{4}$")


def page_kind(lines):
    """Classify a page from its first lines of text.

    Returns (kind, section, side): kind is one of 'detail', 'bydept',
    'byaccount', 'deptpage', 'deptsummary' or None; section is 'General Fund'
    or 'Other Funds' for the summary reports; side is 'revenue', 'expense' or
    None (department pages carry both).
    """
    if not lines:
        return None, None, None
    first, head = lines[0], " ".join(lines[:3])
    if "Budgeted" in first and (first.startswith("General Fund") or first.startswith("Other Funds")):
        section = "General Fund" if first.startswith("General Fund") else "Other Funds"
        side = "revenue" if "Revenues" in first else "expense"
        second = lines[1] if len(lines) > 1 else ""
        if "Department Account" in second:
            return "detail", section, side
        if second.startswith("Account"):
            return "byaccount", section, side
        return "bydept", section, side
    if first.startswith("Department Account") and "BUDGET" in first:
        return "deptpage", None, None
    if first.startswith("Departmental Budget Summary"):
        return "deptsummary", None, None
    if "BUDGET" not in head and lines[0][:4].isdigit() and "$" in first:
        # A department page that continues from the previous page with no header.
        return "deptpage-cont", None, None
    return None, None, None


def _median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


def _cluster_ocr(words):
    """Rows of OCR words: Tesseract's lines, merged when their median
    heights are within OCR_ROW_TOLERANCE. A speck of noise a few points off
    the row stays on its line instead of starting a row of its own."""
    lines = defaultdict(list)
    for w in words:
        lines[w["line"]].append(w)
    groups = sorted(lines.values(), key=lambda g: _median(w["top"] for w in g))
    rows = []
    for g in groups:
        mid = _median(w["top"] for w in g)
        if rows and mid - rows[-1][0] <= OCR_ROW_TOLERANCE:
            rows[-1][1].extend(g)
        else:
            rows.append([mid, list(g)])
    out = []
    for mid, r in rows:
        r = sorted(r, key=lambda w: w["x0"])
        # the row's height is its median word's, so a speck cannot move it
        r[0] = {**r[0], "top": mid} if r[0]["top"] != mid else r[0]
        out.append(r)
    return out


def _cluster(words):
    if words and "line" in words[0]:
        return _cluster_ocr(words)
    rows, current, top = [], [], None
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if top is not None and w["top"] - top > ROW_TOLERANCE:
            rows.append(current)
            current = []
        if not current:
            top = w["top"]
        current.append(w)
    if current:
        rows.append(current)
    return [sorted(r, key=lambda w: w["x0"]) for r in rows]


def header_bounds(rows):
    """Find the column header row and return the cell bounds.

    Returns dict with label edges ('fund', 'dept', 'account' x0 where printed),
    'years' (the two budget years), and the right-edge limits of the four
    cells. Numbers are right-aligned, so a word belongs to the first cell
    whose limit its right edge does not pass.
    """
    for r in rows:
        texts = [w["text"] for w in r]
        if texts.count("BUDGET") == 2 and "VARIANCE" in texts:
            years = [w for w in r if YEAR_RE.match(w["text"])]
            var = next(w for w in r if w["text"] == "VARIANCE")
            pct = next(w for w in r if w["text"] == "%")
            label = {w["text"].lower(): w["x0"] for w in r
                     if w["text"] in ("Fund", "Department", "Account")}
            return {
                "top": r[0]["top"],
                "years": [int(years[0]["text"]), int(years[1]["text"])],
                "cells_start": years[0]["x0"] - 4,
                "limits": [years[1]["x0"], var["x0"], pct["x0"] + 4, 10_000],
                "label": label,
            }
    return None


def read_page(page, bounds=None):
    """Return (bounds, rows) for one table page of a text-layer book.

    Each row is a dict: top, label_words (list of (text, x0)), cells (4 raw
    strings, '' when the cell is blank). Pages without their own header
    (a department table continued from the previous page) take the previous
    page's bounds.
    """
    words = page.extract_words(x_tolerance=1.5, keep_blank_chars=False)
    return read_words(words, bounds)


def read_words(words, bounds=None, find_header=None):
    """read_page for a word list (dicts with text, x0, x1, top, in points),
    from a PDF text layer or from OCR (ocr_words, with find_header=ocr_bounds).

    When the header prints the newer year first (the 2024 book: "2024 BUDGET
    | 2023 BUDGET"), the two budget cells are swapped so cells[0] is always
    the prior year; the variance is newer minus prior either way.
    """
    rows = _cluster(words)
    own = (find_header or header_bounds)(rows)
    if own:
        bounds = own
    if not bounds:
        return None, []
    out = []
    for r in rows:
        if own and r[0]["top"] <= own["top"] + ROW_TOLERANCE:
            continue  # title and header rows
        label, cells = [], [[], [], [], []]
        for w in r:
            if w["x1"] <= bounds["cells_start"]:
                label.append((w["text"], w["x0"]))
                continue
            if w["text"] == "$":
                continue
            for i, limit in enumerate(bounds["limits"]):
                if w["x1"] <= limit + 0.5:
                    cells[i].append(w["text"])
                    break
        cells = ["".join(c) for c in cells]
        if bounds.get("ocr"):
            cells = [ocr_cell(c, i == 3) for i, c in enumerate(cells)]
            label = ocr_label(label, bounds["label"])
        if bounds.get("newer_first"):
            cells[0], cells[1] = cells[1], cells[0]
        out.append({
            "top": r[0]["top"],
            "label_words": label,
            "text": " ".join(w["text"] for w in r),
            "cells": cells,
        })
    return bounds, out


# --- OCR'd books ---------------------------------------------------------------
#
# A scanned book's words come from Tesseract (scripts/ocr_pages.py). Table
# rules print as "|", "[" and "]" glued to words, the "$" at the left of each
# cell reads as "$", "S", "s" or "§", and the column header is often garbled.
# So ocr_words splits words on rule glyphs and drops dollar signs, and
# ocr_bounds finds the cells from the amounts themselves: they are
# right-aligned, so their right edges stack up at four x positions.

RULE_CHARS = "|[]{}"
DOLLAR_RE = re.compile(r"^[$§Ss]{1,2}$|^[iIl!'5]?[$§][Ss]?$|^[$§Ss][iIl!'5]$|^5S$|^[iIl]S$")
NUMBERISH_RE = re.compile(r"\d")
HEADER_WORDS = ("BUDGET", "VARIANCE", "CHANGE")


def ocr_words(tsv_path, dpi):
    """Tesseract TSV -> word dicts in PDF points (text, x0, x1, top, bottom, conf).

    `top` is the word's vertical middle, so that "(", "$" and digits of one
    printed row, whose boxes differ in height, line up; `line` is
    Tesseract's line, which _cluster uses to form rows.
    """
    df = pd.read_csv(tsv_path, sep="\t", quoting=csv.QUOTE_NONE,
                     keep_default_na=False, dtype={"text": str})
    df = df[(df.level == 5) & (df.text.str.strip() != "")]
    k = 72 / dpi
    out = []
    for r in df.itertuples():
        text = r.text.strip()
        # split on rule glyphs, sharing the box out by character count
        pieces, start = [], 0
        for i, ch in enumerate(text + "|"):
            if ch in RULE_CHARS:
                if i > start:
                    pieces.append((start, i))
                start = i + 1
        for a, b in pieces:
            t = text[a:b].strip("'‘’\"“”_—~=:;,.")
            if not t or DOLLAR_RE.match(t):
                continue
            x0 = r.left + r.width * a / len(text)
            x1 = r.left + r.width * b / len(text)
            out.append(dict(text=t, x0=x0 * k, x1=x1 * k,
                            top=(r.top + r.height / 2) * k, bottom=(r.top + r.height) * k,
                            conf=float(r.conf), line=(r.block_num, r.par_num, r.line_num)))
    return out


OCR_DIGITS = str.maketrans("OoSIl", "00511")
DEPT_OCR_RE = re.compile(r"^[^A-Za-z0-9]{0,2}\d?([A-D])([0-9OoSIli]{4,6})(?:[il]|[_—~-]+\S*)?$")
# the department code's letter as OCR reads it in the first column: A1100's
# A as 4, B's as 8 or 6 (only where the word sits at the column's start)
DEPT_LETTER_RE = re.compile(r"^([468])(\d{4})[il]?$")
DEPT_LETTERS = {"4": "A", "8": "B", "6": "B"}
ACCT_OCR_RE = re.compile(r"^[^0-9A-Za-z]{0,2}(\d{4})(.*)$")


def ocr_label(label, label_x):
    """Tidy a row's OCR'd label words (text, x0); label_x as in split_label.

    Rule and box glyphs left at a word's ends go ('(6721' -> '6721'); a
    department code keeps its letter and reads O/S/I/l as digits in its
    four-digit part ('A1S11' -> 'A1511', '1A1100' -> 'A1100'); in the
    account column, one- or two-character specks before the account code go
    ('I 6444 Other Fees' -> '6444 Other Fees'). In the department column a
    one- or two-character word with no letter, other than '&', or a lone
    lower-case letter, is a speck, and an 'l' glued before a capital is a
    rule ('lEngineers'). 'Tota' and 'TOTAI' are 'Total'.
    A fund letter keeps letters only, upper-cased, with 'l' read as 'I'
    ('El' -> 'EI').
    """
    account_x = label_x.get("account")
    dept_x = label_x.get("department")
    out = []
    for text, x in label:
        t = text.strip("|[]{}()!'`‘’\"“”_—~=:;,.")
        if not t:
            continue
        m = DEPT_OCR_RE.match(t)
        code = m and m.group(2).replace("i", "").translate(OCR_DIGITS)
        if m and len(code) == 4:           # 'B11i11' -> 'B1111', 'B1511__-Ss' -> 'B1511'
            t = m.group(1) + code
        else:
            m = ACCT_OCR_RE.match(text)
            if m:
                t = m.group(1) + m.group(2)
            elif (account_x is not None and account_x - 12 <= x <= account_x + 20
                  and re.match(r"^[0-9OoSIl]{4}$", t.lstrip("-")[:4]) and sum(c.isdigit() for c in t.lstrip("-")[:4]) >= 3):
                t = t.lstrip("-"); t = t[:4].translate(OCR_DIGITS) + t[4:]   # "-711S" -> "7115"
        in_dept = dept_x is not None and x >= dept_x - 12 and (account_x is None or x < account_x - 12)
        m = DEPT_LETTER_RE.match(t)
        if m and dept_x is not None and abs(x - dept_x) <= 12 and "fund" not in label_x:
            t = DEPT_LETTERS[m.group(1)] + m.group(2)
        if in_dept and len(t) <= 2 and t != "&" and not any(c.isalpha() for c in t):
            continue
        if in_dept and len(t) == 1 and t.islower():
            continue                       # a speck read as a letter
        if in_dept and re.match(r"^[lI|][A-Z][a-z]", t):
            t = t[1:]                      # a rule read as "l" ("lEngineers")
        if re.fullmatch(r"(?i)tota[l1i!]?", t):
            t = "Total"                    # 'Prison Tota', 'GRAND TOTAI'
        elif t.upper() == "GRAND":
            t = "Grand"
        elif "fund" in label_x and dept_x is not None and x < dept_x - 12 and len(t) <= 3:
            t = "".join(c for c in t if c.isalpha()).replace("l", "I").upper()
            if not t:
                continue
        out.append((t, x))
    if "fund" in label_x and dept_x is not None and [t for t, _ in out[:2]] != ["Grand", "Total"]:
        # a fund letter heads a department's first row, beside its name;
        # elsewhere (a total row, a plain line) it is a speck
        named = any(x >= dept_x - 12 and (account_x is None or x < account_x - 12)
                    and any(c.isalpha() for c in t) for t, x in out)
        if not named or any(t == "Total" for t, _ in out):
            out = [(t, x) for t, x in out if x >= dept_x - 12]
    if account_x is not None:
        acct = [i for i, (t, x) in enumerate(out) if x >= account_x - 12]
        codes = [i for i in acct if re.match(r"^\d{4}", out[i][0])]
        if codes:
            out = [w for i, w in enumerate(out)
                   if not (i in acct and i < codes[0] and len(w[0]) <= 2)]
    return out


def ocr_cell(cell, percent=False):
    """Keep the characters an amount can print. The books print whole
    dollars, so a '.' in an amount is a misread ','."""
    keep = "0123456789,()-" + (".%" if percent else "")
    c = "".join(ch for ch in cell if ch in keep)
    return c


def ocr_lines(words, years=None):
    """The page's text as lines, top to bottom, with the report title and the
    column header restored to their printed wording where OCR garbled them,
    so page_kind can classify the page.

    The title is the first of the top three lines with a word like FUND
    after one like GENERAL or OTHER; its side is whichever of REVENUES and
    EXPENDITURES a later word is closer to, or, when neither is close, the
    side of the page's account codes (6xxx revenue, 7xxx expense). The
    header is the first line with two words like BUDGET, VARIANCE, CHANGE.
    """
    rows = _cluster(words)
    lines = [" ".join(w["text"] for w in r) for r in rows]
    title = None
    for i, r in enumerate(rows[:3]):
        texts = [w["text"] for w in r]
        for j in range(1, len(texts)):
            if not _fuzzy(texts[j], "FUND", 0.75) and not _fuzzy(texts[j], "FUNDS", 0.75):
                continue
            if _fuzzy(texts[j - 1], "GENERAL", 0.7):
                section = "General Fund"
            elif _fuzzy(texts[j - 1], "OTHER", 0.6) or _fuzzy(texts[j - 1], "THER", 0.75):
                section = "Other Funds"
            else:
                continue
            title = (i, section, texts[j + 1:])
            break
        if title:
            break
    if title is None:
        return lines
    i, section, rest = title
    rev = max((_ratio(t, "REVENUES") for t in rest), default=0)
    exp = max((_ratio(t, "EXPENDITURES") for t in rest), default=0)
    if max(rev, exp) >= 0.6 and abs(rev - exp) >= 0.15:
        side = "Revenues" if rev > exp else "Expenditures"
    else:
        codes = [w["text"][0] for w in words if re.match(r"^[67]\d{3}", w["text"])]
        side = "Revenues" if codes.count("6") > codes.count("7") else "Expenditures"
    y = years or ["", ""]
    out = [f"{section}- {y[0]}/{y[1]} Budgeted {side}"]
    for r in rows[i + 1:]:
        if sum(any(_fuzzy(w["text"], h) for h in HEADER_WORDS) for w in r) >= 2:
            names = [n for n in ("Fund", "Department", "Account")
                     if any(_fuzzy(w["text"], n.upper(), 0.7) for w in r)
                     or (n == "Account" and _account_x(words) is not None)]
            out.append(" ".join(names + [f"{y[0]} BUDGET {y[1]} BUDGET VARIANCE % CHANGE"]))
            break
    return out + lines[i + 1:]


def _account_x(words):
    """Left edge of the account-code column: the median x0 of the words that
    start with a 4-digit 6xxx/7xxx code left of the amounts, when at least
    three do. None on pages without account codes."""
    xs = sorted(w["x0"] for w in words
                if re.match(r"^[67]\d{3}(?!\d)", w["text"]) and w["x0"] < 400)
    return xs[len(xs) // 2] if len(xs) >= 3 else None


def _ratio(text, target):
    from difflib import SequenceMatcher
    t = re.sub(r"[^A-Za-z]", "", text).upper()
    return SequenceMatcher(None, t, target).ratio() if len(t) >= 3 else 0


def _fuzzy(text, target, cutoff=0.6):
    from difflib import SequenceMatcher
    t = re.sub(r"[^A-Za-z%]", "", text).upper()
    return len(t) >= 3 and SequenceMatcher(None, t, target).ratio() >= cutoff


def ocr_bounds(rows, years=None, page_width=612):
    """Cell bounds for an OCR'd table page; None when it has no table.

    The header row is the first row with a word like BUDGET, VARIANCE or
    CHANGE. The four cells' right edges are the four rightmost peaks of the
    amounts' right edges (to 2 pt); a word belongs to the first cell whose
    edge (plus 6 pt) it does not pass. Label words end left of the first
    cell, three quarters of a cell width before its right edge. `years`
    (from the book config) is [printed first, printed second].
    """
    head = None
    for r in rows:
        if sum(any(_fuzzy(w["text"], h) for h in HEADER_WORDS) for w in r) >= 2:
            head = r
            break
    if head is None:
        return None
    body = [w for r in rows if r[0]["top"] > head[0]["top"] + ROW_TOLERANCE for w in r]
    ends = [w["x1"] for w in body
            if NUMBERISH_RE.search(w["text"]) and w["x0"] > page_width * 0.4]
    if len(ends) < 8:
        return None
    hist = {}
    for x in ends:
        hist[round(x / 2)] = hist.get(round(x / 2), 0) + 1
    peaks = []
    for b in sorted(hist, key=hist.get, reverse=True):
        if hist[b] < 3:
            break
        if all(abs(b - q) > 10 for q in peaks):   # peaks at least 20 pt apart
            peaks.append(b)
    peaks = sorted(peaks)[-4:]
    if len(peaks) < 4:
        return None
    edges = [p * 2 + 1 for p in peaks]
    label = {}
    for w in head:
        for name, target in (("fund", "FUND"), ("department", "DEPARTMENT"), ("account", "ACCOUNT")):
            if name not in label and _fuzzy(w["text"], target, 0.7) and w["x1"] < edges[0] - 30:
                label[name] = w["x0"]
    if "account" not in label and _account_x(body) is not None:
        label["account"] = _account_x(body)
    years = list(years or [None, None])
    return {
        "top": head[0]["top"],
        "years": sorted(years) if None not in years else years,
        "newer_first": None not in years and years[0] > years[1],
        "cells_start": edges[0] - 0.75 * (edges[1] - edges[0]),
        "limits": [edges[0] + 6, edges[1] + 6, edges[2] + 6, 10_000],
        "label": label,
        "ocr": True,
    }


def amount(cell):
    """Printed cell -> number. '' -> None (blank), '-' -> 0, '(1,440)' -> -1440."""
    c = cell.strip()
    if c == "":
        return None
    if c in ("-", "$-"):
        return 0
    neg = c.startswith("(") or c.startswith("-")
    digits = re.sub(r"[^\d.]", "", c)
    if not digits:
        return None
    v = float(digits)
    v = int(round(v)) if abs(v - round(v)) < 1e-9 else v
    return -v if neg else v


def split_label(label_words, label_x):
    """Split a row's label words into (fund, department, account, name).

    label_x holds the header x0 of 'fund', 'department' and 'account' as
    printed on the page. The account column starts a little left of its
    header; a 4-digit code may be glued to its name ('6111Real Estate').
    """
    acct_x = label_x.get("account", 10_000) - 12
    dept_x = label_x.get("department", 0) - 12
    fund, dept, acct = [], [], []
    for text, x in label_words:
        if x >= acct_x:
            acct.append(text)
        elif "fund" in label_x and x < dept_x:
            fund.append(text)
        else:
            dept.append(text)
    code, name = None, " ".join(acct)
    if acct:
        m = ACCOUNT_RE.match(acct[0])
        if m:
            code = m.group(1)
            rest = [m.group(2)] if m.group(2) else []
            name = " ".join(rest + acct[1:])
    return " ".join(fund), " ".join(dept), code, name.strip()


def open_pdf(path):
    return pdfplumber.open(path)
