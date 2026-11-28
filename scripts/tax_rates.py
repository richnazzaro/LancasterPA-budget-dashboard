"""Tax rates for the tax estimate page (data/tax_rates.csv -> web/data/tax_rates.json).

The budget tables print no tax rates, so the page "What would you pay?" (#/tax, #/county/tax) reads them from a hand-kept
file, one row per (government, tax, year), each with its source:

    government     city | county
    tax            real_estate (rate in mills, on assessed value) | earned_income (rate in %, on earned income)
    year, label    the tax year, and the site's label for the figure the rate belongs to ("2027 Revised", "2026 Budget")
    rate, unit     the rate as published; unit is mills for real_estate and % for earned_income
    assessed_year  real_estate only: which year's assessed value the rate applies to (the 2027 reassessment changed
                   every value, so a 2027 rate cannot be applied to a 2026 value)
    account        the budget line the tax is booked to (City), so What changed can link its tax note to the page
    source         <pdf name>#page=N (a PDF under web/pdfs/), an https:// address, or "user-provided; ..." (shown as
                   not printed in the budget book)
    evidence       the words the source prints, for review

The page estimates each tax at its newest year's rate; older rows are context (the City's 2026 rate, before the
reassessment). check() (run by check_dataset.py) validates every row, cross-checks the County's rate against
data/county/context_facts.csv and the City's earned income tax against data/policy_notes.csv, and fails when
web/data/tax_rates.json is out of date. Standard library only.
"""
from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "tax_rates.csv"
OUT = ROOT / "web" / "data" / "tax_rates.json"
PDFS = ROOT / "web" / "pdfs"
CONTEXT = ROOT / "data" / "county" / "context_facts.csv"
POLICY = ROOT / "data" / "policy_notes.csv"
UNITS = {"real_estate": "mills", "earned_income": "%"}
GOVS = ("city", "county")
PDF_SRC = re.compile(r"^(?P<doc>[^#]+\.pdf)#page=(?P<page>\d+)$")


def load(path: Path = CSV) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _pdf_path(doc: str) -> str | None:
    """The PDF's path under web/ (pdfs/... or pdfs/county/...), or None when it is not there. web/pdfs and its
    county folder are symlinks to the source-PDF folders, so the walk follows links."""
    for d, _dirs, files in sorted(os.walk(PDFS, followlinks=True)):
        if doc in files:
            return (Path(d) / doc).relative_to(ROOT / "web").as_posix()
    return None


def problems(rows: list[dict]) -> list[str]:
    """Every reason a row can't be shown as it is; empty when the file is good."""
    out, seen = [], set()
    for i, r in enumerate(rows, start=2):
        at = f"data/tax_rates.csv line {i}"
        if r["government"] not in GOVS:
            out.append(f"{at}: government must be one of {', '.join(GOVS)}")
        if r["tax"] not in UNITS:
            out.append(f"{at}: tax must be one of {', '.join(UNITS)}")
        elif r["unit"] != UNITS[r["tax"]]:
            out.append(f"{at}: {r['tax']} is in {UNITS[r['tax']]}, not {r['unit']!r}")
        try:
            if float(r["rate"]) <= 0:
                out.append(f"{at}: rate must be above zero")
            int(r["year"])
        except ValueError:
            out.append(f"{at}: year and rate must be numbers")
        if r["tax"] == "real_estate" and not r["assessed_year"].isdigit():
            out.append(f"{at}: real_estate needs assessed_year (which year's assessed value the rate applies to)")
        if not r["label"].strip():
            out.append(f"{at}: label is empty")
        k = (r["government"], r["tax"], r["year"])
        if k in seen:
            out.append(f"{at}: second row for {' '.join(k)}")
        seen.add(k)
        s = r["source"].strip()
        m = PDF_SRC.match(s)
        if m:
            if not _pdf_path(m["doc"]):
                out.append(f"{at}: source PDF {m['doc']} is not under web/pdfs/")
        elif not (s.startswith("https://") or s.lower().startswith("user-provided")):
            out.append(f"{at}: source must be <pdf>#page=N, an https:// address or user-provided; got {s!r}")
    return out


def build(rows: list[dict] | None = None) -> dict:
    rows = load() if rows is None else rows
    bad = problems(rows)
    if bad:
        raise SystemExit("\n".join(bad))
    rates = []
    for r in rows:
        s = r["source"].strip()
        m = PDF_SRC.match(s)
        href = f"{_pdf_path(m['doc'])}#page={m['page']}" if m else s if s.startswith("https://") else None
        rates.append({"gov": r["government"], "tax": r["tax"], "year": int(r["year"]), "label": r["label"],
                      "rate": float(r["rate"]), "unit": r["unit"],
                      "assessed_year": int(r["assessed_year"]) if r["assessed_year"] else None,
                      "account": r["account"] or None, "href": href, "doc": m["doc"] if m else None,
                      "user_provided": href is None})
    rates.sort(key=lambda x: (x["gov"], x["tax"], x["year"]))
    return {"rates": rates}


def write(out: Path = OUT) -> dict:
    data = build()
    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def check() -> int:
    """For check_dataset.py: the file's rows, the cross-checks and web/data/tax_rates.json. Returns the failure count."""
    print("\nTax rates for the tax estimate page (data/tax_rates.csv):")
    rows = load()
    fails = problems(rows)
    newest = {}
    for r in rows:
        k = (r["government"], r["tax"])
        if k not in newest or int(r["year"]) > int(newest[k]["year"]):
            newest[k] = r
    # The County's rate is also in the context facts (from its adopting resolution): they must agree.
    ctx = {f["id"]: f for f in csv.DictReader(CONTEXT.open(newline="", encoding="utf-8"))} if CONTEXT.exists() else {}
    for r in rows:
        if r["government"] == "county" and r["tax"] == "real_estate":
            f = ctx.get(f"millage_{r['year']}")
            if not f:
                fails.append(f"county real_estate {r['year']}: no millage_{r['year']} in data/county/context_facts.csv")
            elif abs(float(f["value"]) - float(r["rate"])) > 1e-9:
                fails.append(f"county real_estate {r['year']}: {r['rate']} mills here, {f['value']} in context_facts.csv")
    # The City's newest earned income tax rate is also a policy note's rate_to for the same year and line.
    with POLICY.open(newline="", encoding="utf-8") as f:
        pol = [p for p in csv.DictReader(f) if p["rate_to"]]
    for (gov, tax), r in newest.items():
        if gov == "city" and tax == "earned_income":
            # The note for the same figure ("2027 Revised" -> the revised note), else any note for that year and line.
            fig = r["label"].split()[-1].lower()
            same = [p for p in pol if p["year"] == r["year"] and p["account"] == r["account"]]
            to = {float(p["rate_to"]) for p in same if p["figure"] == fig} or {float(p["rate_to"]) for p in same}
            if to and float(r["rate"]) not in to:
                fails.append(f"city earned_income {r['year']}: {r['rate']}% here, policy_notes.csv says {sorted(to)}")
    if not fails:
        try:
            on_disk = json.loads(OUT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            on_disk = None
        if on_disk != build(rows):
            fails.append("web/data/tax_rates.json is out of date: run scripts/build_dataset.py")
    for (gov, tax), r in sorted(newest.items()):
        note = " (user-provided: not printed in a source document yet)" if r["source"].lower().startswith("user-provided") else ""
        print(f"  {gov:6s} {tax:13s} {r['label']:13s} {r['rate']} {r['unit']}{note}")
    for msg in fails:
        print(f"FAIL {msg}")
    if not fails:
        print(f"ok   {len(rows)} rows, newest rate per tax as listed")
    return len(fails)


if __name__ == "__main__":
    raise SystemExit(1 if check() else 0)
