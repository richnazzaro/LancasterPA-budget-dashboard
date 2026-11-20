#!/usr/bin/env python3
"""Org structure for the dashboard: departments and bureaus as on the city's 2027 org chart.

Inputs (hand-maintained, committed):
  data/org_units_2027.csv        one row per department (unit empty) and per unit:
                                 department, unit, kind, division, chart_page, descriptions, aliases, notes
                                   kind: department        the department's own row
                                         bureau            a bureau or office on the chart (gets a page)
                                         department-wide   budget groups that are not a bureau
                                                           (city-wide costs a department manages, fee revenue)
                                         whole-department  the single unit of a department with no bureaus
                                   descriptions: ';'-separated ids from org_descriptions_2027.csv,
                                                 optionally with a 1-based paragraph range: id[3] or id[1-2]
  data/org_structure_2027.csv    one row per budget org code (first part of account_code):
                                 org_code, fund, department, unit, printed_department, printed_names, notes
  data/org_descriptions_2027.csv extracted from the descriptions PDF by scripts/extract_org_descriptions.py

Output: the `org` block of web/data/budget.json (see build_org). Standard library only.
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UNITS_CSV = DATA / "org_units_2027.csv"
CODES_CSV = DATA / "org_structure_2027.csv"
DESC_CSV = DATA / "org_descriptions_2027.csv"
CHART_DOC = "2027 Org Chart.pdf"
DESC_DOC = "Org Descriptions 2027.pdf"
KINDS = {"department", "bureau", "department-wide", "whole-department"}
SMALL = {"a", "an", "and", "of", "the", "to", "for", "in", "on"}


def slug(s: str) -> str:
    """Same rule as slug() in web/app.js."""
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", " and ")).strip("-")


def title_case(heading: str) -> str:
    """'BUREAU OF POLICE' -> 'Bureau of Police' (the printed headings are set in capitals)."""
    if heading != heading.upper():
        return heading
    words = heading.lower().split()
    return " ".join(w if i and w in SMALL else w[:1].upper() + w[1:] for i, w in enumerate(words))


def read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def resolve(refs: str, descs: dict, errors: list, where: str) -> list[dict]:
    """'id;id[2-3]' -> [{h, p, t}]. The first entry carries no heading (the page title says it)."""
    out = []
    for ref in filter(None, (r.strip() for r in refs.split(";"))):
        m = re.fullmatch(r"([a-z0-9-]+)(?:\[(\d+)(?:-(\d+))?\])?", ref)
        if not m or m.group(1) not in descs:
            errors.append(f"{where}: unknown description '{ref}'")
            continue
        d = descs[m.group(1)]
        paras = d["text"].split("\n\n")
        heading = title_case(d["heading"])
        if m.group(2):
            a = int(m.group(2))
            b = int(m.group(3) or a)
            if not 1 <= a <= b <= len(paras):
                errors.append(f"{where}: paragraph range {a}-{b} outside 1-{len(paras)} in {d['id']}")
                continue
            paras = paras[a - 1:b]
            heading = ""  # an unheaded excerpt of a longer section
        text = "\n\n".join(paras).strip()
        if not text:
            errors.append(f"{where}: description '{ref}' is empty")
            continue
        out.append({"h": heading if out else "", "p": int(d["source_page"]), "t": text})
    return out


def build_org(budget_codes: set[str]) -> dict:
    """The `org` block for budget.json. Exits with a message when the tables are inconsistent or
    an org code used in budget.json has no mapping."""
    errors: list[str] = []
    descs = {d["id"]: d for d in read(DESC_CSV)}
    depts, units, dept_index, unit_index = [], [], {}, {}
    for r in read(UNITS_CSV):
        kind, dname, uname = r["kind"], r["department"], r["unit"]
        if kind not in KINDS:
            errors.append(f"org_units: unknown kind '{kind}' for {dname} / {uname}")
            continue
        where = f"org_units {dname} / {uname or '(department)'}"
        if kind == "department":
            if uname or dname in dept_index:
                errors.append(f"{where}: department row must have an empty unit and appear once")
                continue
            dept_index[dname] = len(depts)
            depts.append({"name": dname, "slug": slug(dname),
                          "aliases": [a for a in r["aliases"].split(";") if a],
                          "chart_page": int(r["chart_page"]) if r["chart_page"] else None,
                          "desc": resolve(r["descriptions"], descs, errors, where)})
            continue
        if dname not in dept_index:
            errors.append(f"{where}: department row must come first")
            continue
        if (dname, uname) in unit_index:
            errors.append(f"{where}: listed twice")
            continue
        unit_index[(dname, uname)] = len(units)
        units.append({"name": uname, "slug": "department-wide" if kind == "department-wide" else slug(uname),
                      "dept": dept_index[dname], "kind": kind, "division": r["division"],
                      "chart_page": int(r["chart_page"]) if r["chart_page"] else None,
                      "desc": resolve(r["descriptions"], descs, errors, where)})

    for i, d in enumerate(depts):
        mine = [u for u in units if u["dept"] == i]
        kinds = {u["kind"] for u in mine}
        d["bureaus"] = "bureau" in kinds
        if not mine:
            errors.append(f"org_units: {d['name']} has no units")
        if "whole-department" in kinds and len(mine) != 1:
            errors.append(f"org_units: {d['name']} mixes a whole-department unit with other units")
        if not d["bureaus"] and kinds != {"whole-department"}:
            errors.append(f"org_units: {d['name']} has no bureaus, so its only unit must be whole-department")
        if len({u["slug"] for u in mine}) != len(mine):
            errors.append(f"org_units: duplicate unit slugs in {d['name']}")

    codes = {}
    for r in read(CODES_CSV):
        key = (r["department"], r["unit"])
        if key not in unit_index:
            errors.append(f"org_structure {r['org_code']}: no unit '{r['unit']}' in department '{r['department']}' (org_units_2027.csv)")
            continue
        if r["org_code"] in codes:
            errors.append(f"org_structure {r['org_code']}: listed twice")
        codes[r["org_code"]] = unit_index[key]
    unmapped = sorted(budget_codes - set(codes))
    for c in unmapped:
        errors.append(f"org code {c} appears in budget.json but not in {CODES_CSV.name}")
    used = set(codes.values())
    for i, u in enumerate(units):
        if i not in used:
            print(f"note: unit with no budget org codes: {depts[u['dept']]['name']} / {u['name']}", file=sys.stderr)
    if errors:
        sys.exit("Org structure errors:\n  " + "\n  ".join(errors))
    return {"chart_doc": CHART_DOC, "desc_doc": DESC_DOC, "departments": depts, "units": units,
            "codes": dict(sorted(codes.items()))}
