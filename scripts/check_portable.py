#!/usr/bin/env python3
"""Report government-specific values written into engine code (docs/portable/PLAN.md step 0.6).

The portable engine's rule: scripts and the web app name no government, year, fund, department, account code or
source file; those come from the government's files. This script lists every line that still does.

Scans scripts/*.py, web/app.js, web/index.html and .github/workflows/pages.yml. Each hit is one (file, line,
category) and is classed by where it sits:
  docstring  inside a Python docstring
  comment    a Python/YAML line starting with #, or a JS/HTML line starting with //, /*, * or <!--
  code       anything else; only these count towards the total
A code hit is not counted when config/portable_allowlist.csv (file,category,pattern,reason) allows it: same file
(or a glob such as scripts/*.py), same category (or *), and `pattern` (a regular expression) found in the line.

Report mode (default) always exits 0. --strict exits 1 when any code hit is left (Phase 3 turns this on in CI).

Usage:
  python scripts/check_portable.py                         table of code hits per file and category, and the total
  python scripts/check_portable.py --csv hits.csv          also write every hit (code, comment, docstring) to a CSV
  python scripts/check_portable.py --baseline docs/portable/baseline-inventory.csv
                                                           also compare code hits per file with an earlier inventory
  python scripts/check_portable.py --root DIR              scan another copy of the repository (e.g. a git archive)

Standard library only.
"""
from __future__ import annotations

import argparse
import ast
import csv
import fnmatch
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST = Path("config/portable_allowlist.csv")

CATEGORIES = {
    "government": r"\bLancaster\b|Pennsylvania|cityoflancaster|co\.lancaster|nazwel",
    "entity_branch": r"""isCounty\(|ENT\s*===?|=== *'county'|== *"county"|'county'|"county"|"city"|'city'|entity\s*==|--entity""",
    "gov_body": r"\bMayor|\bCouncil\b|Home Rule|Charter|Commissioner|Controller|Treasurer|row offices|School Board",
    "year": r"(?<![\d.\w])20[12]\d(?![\d])",
    "fund_name": r"General Fund|Reserve Fund|Sewer|Wastewater|Stormwater|Water Fund|Solid Waste|Liquid Fuels|\bFund [A-Z]{1,2}\b|Long's Park",
    "dept_name": r"Public Safety|Public Works|CPED|Neighborhood Engagement|Admin(istrative)? Services|General Revenue|Facilities Management",
    "account_code": r'(?<![\d.\w#])(4\d{5}|49\d{4}|1[0-8]\d{5}|56[0-3]\d{5,6})(?![\d])|"1[0-8]"\s*:|"56[0-3]"\s*:|"140[35]"',
    "source_file": r"[\w\-]+\.pdf\b|Budget PDFs - (City|County)|org_\w+_2027\.csv",
    "money_or_wording": r"data center|\$\d[\d.,]*[MK]?\b|\b\d{1,3}(,\d{3}){2,}\b",
}
PATTERNS = {c: re.compile(p) for c, p in CATEGORIES.items()}


def scanned_files(root: Path) -> list[Path]:
    files = sorted((root / "scripts").glob("*.py"))
    files += [root / p for p in ("web/app.js", "web/index.html", ".github/workflows/pages.yml")]
    return [f for f in files if f.exists()]


def docstring_lines(source: str) -> set[int]:
    """Line numbers inside module, class and function docstrings."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    lines = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                lines.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    return lines


def classify(rel: str, line: str, n: int, doc: set[int]) -> str:
    s = line.lstrip()
    if rel.endswith(".py"):
        if n in doc:
            return "docstring"
        return "comment" if s.startswith("#") else "code"
    if rel.endswith((".yml", ".yaml")):
        return "comment" if s.startswith("#") else "code"
    return "comment" if s.startswith(("//", "/*", "*", "<!--")) else "code"


def scan(root: Path) -> list[dict]:
    hits = []
    for path in scanned_files(root):
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        doc = docstring_lines(text) if rel.endswith(".py") else set()
        for n, line in enumerate(text.splitlines(), start=1):
            for cat, rx in PATTERNS.items():
                if rx.search(line):
                    hits.append({"file": rel, "line": n, "category": cat, "kind": classify(rel, line, n, doc),
                                 "text": line.strip()})
    return hits


def load_allowlist(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = {"file", "category", "pattern", "reason"} - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"{path}: header needs the columns file,category,pattern,reason (missing: {', '.join(sorted(missing))})")
        for n, r in enumerate(reader, start=2):
            if not (r["file"] and r["category"] and r["pattern"] and r["reason"].strip()):
                sys.exit(f"{path}, line {n}: every row needs file, category, pattern and a reason")
            if r["category"] != "*" and r["category"] not in CATEGORIES:
                sys.exit(f"{path}, line {n}: category {r['category']!r} is not one of *, {', '.join(CATEGORIES)}")
            try:
                r["rx"] = re.compile(r["pattern"])
            except re.error as e:
                sys.exit(f"{path}, line {n}: pattern {r['pattern']!r} is not a valid regular expression ({e})")
            rows.append(r)
    return rows


def allowed(hit: dict, allow: list[dict]) -> str:
    for r in allow:
        if (fnmatch.fnmatch(hit["file"], r["file"]) and r["category"] in ("*", hit["category"])
                and r["rx"].search(hit["text"])):
            return r["reason"]
    return ""


def table(counts: dict[str, Counter]) -> str:
    cats = list(CATEGORIES)
    short = {"government": "gov", "entity_branch": "entity", "gov_body": "body", "year": "year", "fund_name": "fund",
             "dept_name": "dept", "account_code": "code", "source_file": "file", "money_or_wording": "money"}
    w = max([len("TOTAL")] + [len(f) for f in counts]) + 2
    out = [f"{'file':{w}}" + "".join(f"{short[c]:>7}" for c in cats) + f"{'total':>7}"]
    tot = Counter()
    for f in sorted(counts, key=lambda f: (-sum(counts[f].values()), f)):
        out.append(f"{f:{w}}" + "".join(f"{counts[f][c]:>7}" for c in cats) + f"{sum(counts[f].values()):>7}")
        tot.update(counts[f])
    out.append(f"{'TOTAL':{w}}" + "".join(f"{tot[c]:>7}" for c in cats) + f"{sum(tot.values()):>7}")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Report government-specific values in engine code.")
    ap.add_argument("--root", type=Path, default=ROOT, help="repository copy to scan (default: this one)")
    ap.add_argument("--csv", type=Path, help="write every hit to this CSV")
    ap.add_argument("--baseline", type=Path, help="an earlier inventory CSV (file,line,category,kind,text) to compare with")
    ap.add_argument("--strict", action="store_true", help="exit 1 when any code hit is not allowlisted")
    a = ap.parse_args()
    root = a.root.resolve()

    allow = load_allowlist(ROOT / ALLOWLIST)
    hits = scan(root)
    for h in hits:
        h["allowed"] = allowed(h, allow) if h["kind"] == "code" else ""
    code = [h for h in hits if h["kind"] == "code" and not h["allowed"]]

    counts: dict[str, Counter] = {}
    for h in code:
        counts.setdefault(h["file"], Counter())[h["category"]] += 1
    print(f"Code hits per file and category ({root.name}); comments and docstrings are not counted.")
    print(table(counts))
    kinds = Counter(h["kind"] for h in hits)
    n_allowed = sum(1 for h in hits if h["allowed"])
    print(f"\nTotal code hits: {len(code)} on {len({(h['file'], h['line']) for h in code})} lines "
          f"(allowlisted: {n_allowed}; also found in comments: {kinds['comment']}, in docstrings: {kinds['docstring']}).")

    if a.baseline:
        with a.baseline.open(newline="", encoding="utf-8") as f:
            base = [r for r in csv.DictReader(f) if r["kind"] == "code"]
        bc = Counter(r["file"] for r in base)
        nc = Counter(h["file"] for h in code)
        print(f"\nAgainst {a.baseline}: baseline {len(base)} code hits, now {len(code)} ({len(code) - len(base):+d}).")
        for f in sorted(set(bc) | set(nc)):
            if bc[f] != nc[f]:
                print(f"  {f}: {bc[f]} -> {nc[f]} ({nc[f] - bc[f]:+d})")

    if a.csv:
        a.csv.parent.mkdir(parents=True, exist_ok=True)
        with a.csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["file", "line", "category", "kind", "allowed", "text"])
            w.writeheader()
            for h in hits:
                w.writerow({k: h[k] for k in w.fieldnames})
        print(f"Wrote {len(hits)} hits to {a.csv}")

    if a.strict and code:
        print(f"--strict: {len(code)} code hits are not allowlisted")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
