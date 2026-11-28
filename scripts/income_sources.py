"""Income sources (mapping/income_sources.csv).

The Income view groups income by where it comes from. A rule names the source of one object code (City, 6 digits) or
account (County, 4 digits), the part after the "-" in an account code, and optionally a fund name (blank: any fund).
A revenue line no rule names is shown under the group the book prints it under, or, when income_rules.py calls it a
charge between funds, under "Charges to other funds"; the front end does that, so this file holds only the exceptions
that make the printed groups finer (all the taxes sit in one printed group, "Tax Revenue").

budget.json carries `income_sources`: {"names": [source names], "a": {account index (as text): name index}}.
"""

from __future__ import annotations

import csv
from pathlib import Path

COLUMNS = ("code", "fund", "source", "evidence")


def path(gov=None) -> Path:
    """The government's mapping/income_sources.csv."""
    import govconfig
    return govconfig.resolve_government(gov).mapping / "income_sources.csv"


def load(gov=None) -> list[dict]:
    """The rules, validated: every field present, evidence given, no code listed twice for the same fund.

    A government with no file has no rules (its income is grouped by the printed groups)."""
    file = path(gov)
    if not file.exists():
        return []
    with file.open(newline="") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{file.name}: columns must be {', '.join(COLUMNS)}")
        rules = list(reader)
    seen = set()
    for n, r in enumerate(rules, start=2):
        for c in ("code", "source", "evidence"):
            if not (r[c] or "").strip():
                raise ValueError(f"{file.name} line {n}: {c} is empty")
        key = (r["code"], r["fund"])
        if key in seen:
            raise ValueError(f"{file.name} line {n}: {r['code']} is listed twice for the same fund")
        seen.add(key)
    return rules


def income_sources(accounts: list, funds: list, categories: list, gov=None, revenue: str = "Revenue") -> dict:
    """budget.json `income_sources`: the source names and {account index (as text): name index} for every revenue
    account a rule matches (a rule with a fund beats nothing else: a fund rule and an any-fund rule never overlap
    on one account because the first match wins, fund rules first)."""
    rules = load(gov)
    by_code: dict[str, list[dict]] = {}
    for r in sorted(rules, key=lambda r: not r["fund"]):  # fund-specific rules first
        by_code.setdefault(r["code"], []).append(r)
    names: list[str] = []
    mapping: dict[str, int] = {}
    for i, a in enumerate(accounts):
        if categories[a[5]] != revenue:
            continue
        obj = a[0].split("-")[-1]
        for r in by_code.get(obj, []):
            if not r["fund"] or r["fund"] == funds[a[2]]:
                if r["source"] not in names:
                    names.append(r["source"])
                mapping[str(i)] = names.index(r["source"])
                break
    return {"names": names, "a": mapping}
