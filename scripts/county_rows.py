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

import re

import pdfplumber

# Words whose tops are this close (points) are on the same printed row.
ROW_TOLERANCE = 3

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


def _cluster(words):
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
    """Return (bounds, rows) for one table page.

    Each row is a dict: top, label_words (list of (text, x0)), cells (4 raw
    strings, '' when the cell is blank). Pages without their own header
    (a department table continued from the previous page) take the previous
    page's bounds.
    """
    words = page.extract_words(x_tolerance=1.5, keep_blank_chars=False)
    rows = _cluster(words)
    own = header_bounds(rows)
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
        out.append({
            "top": r[0]["top"],
            "label_words": label,
            "text": " ".join(w["text"] for w in r),
            "cells": ["".join(c) for c in cells],
        })
    return bounds, out


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
