"""Tax rates for the tax estimate page (governments/<id>/mapping/tax_rates.csv -> web/data/tax_rates.json).

The budget tables print no tax rates, so the page "What would you pay?" (#/tax, #/county/tax) reads them from a hand-kept
file, one row per (government, tax, year), each with its source:

    government     city | county
    tax            real_estate (rate in mills, on assessed value) | earned_income (rate in %, on earned income)
    year, label    the tax year, and the site's label for the rate ("2027", "2026 Budget")
    rate, unit     the rate as published; unit is mills for real_estate and % for earned_income
    assessed_year  real_estate only: which year's assessed value the rate applies to (the 2027 reassessment changed
                   every value, so a 2027 rate cannot be applied to a 2026 value)
    account        the budget line the tax is booked to (City), so What changed can link its tax note to the page
    source         <pdf name>#page=N (a PDF under web/pdfs/), an https:// address, or "user-provided; ..." (shown as
                   not printed in the budget book)
    evidence       the words the source prints, for review

Each row is the rate in force for that year, before any change the year's budget makes: this year's rates (2026), and
for next year the City's property tax rate reset after the reassessment (5.71 mills on the new values). What the newest
budget does comes from notes/policy_notes.csv, matched by year and `account`: a note's `rate_to` is the new rate, its
`change_pct` raises the year's rate by that percent (a calculated rate, flagged). Each becomes a step in `steps` (the
Proposal, then the Revised budget). Where a tax has notes for a year but no row (the earned income tax in 2027), the
year before's row is carried forward as the base (`carried`). The page (config.json `tax_estimate.this_year` and
`next_year`) shows this year's tax beside next year's under each step.

check() (run by check_dataset.py) validates every row, cross-checks the County's rate against
data/county/context_facts.csv and each policy note's rate_from against the rate here, and fails when
web/data/tax_rates.json is out of date. Standard library only.
"""
from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path

import govconfig

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "tax_rates.json"
PDFS = ROOT / "web" / "pdfs"
UNITS = {"real_estate": "mills", "earned_income": "%"}
PDF_SRC = re.compile(r"^(?P<doc>[^#]+\.pdf)#page=(?P<page>\d+)$")


def path(gov) -> Path:
    """A government's hand-kept mapping/tax_rates.csv."""
    return gov.mapping / "tax_rates.csv"


def governments() -> list:
    """Every government (site.yaml order) that has a mapping/tax_rates.csv."""
    return [g for g in (govconfig.government(i) for i in govconfig.list_governments()) if path(g).exists()]


def context_file(gov) -> Path | None:
    """The government's context facts, where it keeps them (Phase 2 moves the County file into its folder)."""
    for p in (gov.notes / "context_facts.csv", ROOT / "data" / gov["route"] / "context_facts.csv"):
        if p.exists():
            return p
    return None


def load(paths=None) -> list[dict]:
    """Every government's rows, each labelled with its short name (government.yaml route: city, county).

    The short name is what the site's tax pages key on, so the file keeps its `government` column."""
    rows = []
    for gov in governments() if paths is None else paths:
        with path(gov).open(newline="", encoding="utf-8") as f:
            rows += [{**r, "government": gov["route"]} for r in csv.DictReader(f)]
    return rows


def _pdf_path(doc: str) -> str | None:
    """The PDF's path under web/ (pdfs/... or pdfs/county/...), or None when it is not there. web/pdfs and its
    county folder are symlinks to the source-PDF folders, so the walk follows links."""
    for d, _dirs, files in sorted(os.walk(PDFS, followlinks=True)):
        if doc in files:
            return (Path(d) / doc).relative_to(ROOT / "web").as_posix()
    return None


def problems(rows: list[dict]) -> list[str]:
    """Every reason a row can't be shown as it is; empty when the files are good."""
    out, seen = [], set()
    known = {g["route"] for g in governments()}
    for i, r in enumerate(rows, start=2):
        at = f"{r['government']}/mapping/tax_rates.csv row {i - 1}"
        if r["government"] not in known:
            out.append(f"{at}: government {r['government']!r} has no government.yaml route")
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


FIGURES = ("proposed", "revised")  # the newest budget's figures, in the order the page shows them
FIGURE_LABEL = {"proposed": "Proposed", "revised": "Revised"}


def _source(s: str) -> tuple[str | None, str | None]:
    """(href, pdf name) for a source: a PDF page under web/pdfs, an https address, or (None, None) when user-provided."""
    s = s.strip()
    m = PDF_SRC.match(s)
    if m:
        return f"{_pdf_path(m['doc'])}#page={m['page']}", m["doc"]
    return (s, None) if s.startswith("https://") else (None, None)


def load_policy() -> list[dict]:
    """Every government's notes/policy_notes.csv rows that change a rate, labelled with its short name."""
    rows = []
    for gov in (govconfig.government(i) for i in govconfig.list_governments()):
        p = gov.notes / "policy_notes.csv"
        if not p.exists():
            continue
        with p.open(newline="", encoding="utf-8") as f:
            rows += [{**r, "government": gov["route"]} for r in csv.DictReader(f)
                     if r["account"] and (r["rate_to"] or r["change_pct"])]
    return rows


def steps_for(r: dict, policy: list[dict]) -> list[dict]:
    """What the newest budget's figures do to this rate (notes/policy_notes.csv, same year and account), in FIGURES order.
    A note with rate_to gives the new rate; one with change_pct raises the row's rate by that percent (calculated)."""
    if not r["account"]:
        return []
    base, out = float(r["rate"]), []
    for fig in FIGURES:
        ns = [p for p in policy if p["year"] == r["year"] and p["account"] == r["account"] and p["figure"] == fig]
        if not ns:
            continue
        n = next((p for p in ns if p["rate_to"]), ns[0])
        pct = None if n["rate_to"] else float(n["change_pct"])
        rate = float(n["rate_to"]) if n["rate_to"] else round(base * (1 + pct / 100), 6)
        # The rate's source: the note's, where it prints the new rate; the row's, where the rate is the row's rate
        # changed by a percent (the note only says what the change was, so it is kept as `change_href`).
        href, doc = _source(n["source"] if n["rate_to"] else r["source"])
        change_href = None if n["rate_to"] else _source(n["source"])[0]
        out.append({"figure": fig, "label": f"{r['year']} {FIGURE_LABEL[fig]}", "rate": rate, "tax": r["tax"],
                    "change_pct": pct, "calculated": bool(pct), "href": href, "doc": doc, "user_provided": href is None,
                    "change_href": change_href,
                    "rate_from": float(n["rate_from"]) if n["rate_from"] else None})
    return out


def with_carried(rows: list[dict], policy: list[dict]) -> list[dict]:
    """The rows, plus a carried-forward base for each tax with policy notes for a year it has no row for."""
    out = list(rows)
    for gov, y, acct in sorted({(p["government"], p["year"], p["account"]) for p in policy}):
        if any(r["government"] == gov and r["account"] == acct and r["year"] == y for r in rows):
            continue
        prev = [r for r in rows if r["government"] == gov and r["account"] == acct and int(r["year"]) == int(y) - 1]
        if prev:
            out.append({**prev[0], "year": y, "label": y, "carried": True})
    return out


def build(rows: list[dict] | None = None, policy: list[dict] | None = None) -> dict:
    rows = load() if rows is None else rows
    policy = load_policy() if policy is None else policy
    bad = problems(rows)
    if bad:
        raise SystemExit("\n".join(bad))
    rates = []
    for r in with_carried(rows, policy):
        href, doc = _source(r["source"])
        steps = [{k: v for k, v in st.items() if k != "rate_from"} for st in steps_for(r, policy)]
        rates.append({"gov": r["government"], "tax": r["tax"], "year": int(r["year"]), "label": r["label"],
                      "rate": float(r["rate"]), "unit": r["unit"],
                      "assessed_year": int(r["assessed_year"]) if r["assessed_year"] else None,
                      "account": r["account"] or None, "href": href, "doc": doc,
                      "user_provided": href is None, "carried": bool(r.get("carried")), "steps": steps})
    rates.sort(key=lambda x: (x["gov"], x["tax"], x["year"]))
    return {"rates": rates}


def write(out: Path = OUT) -> dict:
    data = build()
    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def check() -> int:
    """For check_dataset.py: the file's rows, the cross-checks and web/data/tax_rates.json. Returns the failure count."""
    print("\nTax rates for the tax estimate page (governments/*/mapping/tax_rates.csv):")
    rows = load()
    fails = problems(rows)
    policy = load_policy()
    newest = {}
    for r in with_carried(rows, policy):
        k = (r["government"], r["tax"])
        if k not in newest or int(r["year"]) > int(newest[k]["year"]):
            newest[k] = r
    # A rate the government also prints as a context fact (from its adopting resolution) must agree.
    for r in rows:
        if r["tax"] != "real_estate":
            continue
        gov = next((g for g in governments() if g["route"] == r["government"]), None)
        cf = context_file(gov) if gov else None
        if cf is None:
            continue
        ctx = {f["id"]: f for f in csv.DictReader(cf.open(newline="", encoding="utf-8"))}
        f = ctx.get(f"millage_{r['year']}")
        if not f:
            fails.append(f"{r['government']} real_estate {r['year']}: no millage_{r['year']} in "
                         f"{govconfig.rel(cf)}")
        elif abs(float(f["value"]) - float(r["rate"])) > 1e-9:
            fails.append(f"{r['government']} real_estate {r['year']}: {r['rate']} mills here, {f['value']} in "
                         f"{govconfig.rel(cf)}")
    # The budget's tax changes (notes/policy_notes.csv): a note's rate_from is the rate before the change, so it must
    # equal this file's rate; every figure with a note for the row's year and line must become a step.
    for (gov, tax), r in newest.items():
        steps = steps_for(r, policy)
        for st in steps:
            if st["rate_from"] is not None and abs(st["rate_from"] - float(r["rate"])) > 1e-9:
                fails.append(f"{gov} {tax} {r['year']}: {r['rate']}{r['unit']} here, but the {st['figure']} note in "
                             f"policy_notes.csv changes it from {st['rate_from']}{r['unit']}")
        noted = {p["figure"] for p in policy if p["year"] == r["year"] and p["account"] == r["account"]} if r["account"] else set()
        if noted - {st["figure"] for st in steps}:
            fails.append(f"{gov} {tax} {r['year']}: policy notes {sorted(noted)} not all turned into steps")
    if not fails:
        try:
            on_disk = json.loads(OUT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            on_disk = None
        if on_disk != build(rows, policy):
            fails.append("web/data/tax_rates.json is out of date: run scripts/build_dataset.py")
    for (gov, tax), r in sorted(newest.items()):
        note = " (user-provided: not printed in a source document yet)" if r["source"].lower().startswith("user-provided") else ""
        note += f" (carried from {int(r['year']) - 1})" if r.get("carried") else ""
        print(f"  {gov:6s} {tax:13s} {r['label']:13s} {r['rate']} {r['unit']}{note}")
        for st in steps_for(r, policy):
            print(f"         {'':13s} {st['label']:13s} {st['rate']} {r['unit']}"
                  + (f" (calculated: {st['change_pct']:+g}%)" if st["calculated"] else "")
                  + (" (user-provided)" if st["user_provided"] else ""))
    for msg in fails:
        print(f"FAIL {msg}")
    if not fails:
        print(f"ok   {len(rows)} rows, newest rate per tax as listed")
    return len(fails)


if __name__ == "__main__":
    raise SystemExit(1 if check() else 0)
