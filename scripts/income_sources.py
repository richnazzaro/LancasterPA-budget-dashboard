"""Income sources (data/income_sources.csv).

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

PATH = Path(__file__).resolve().parent.parent / "data" / "income_sources.csv"
COLUMNS = ("entity", "code", "fund", "source", "evidence")


def load(path: Path = PATH, entity: str | None = None) -> list[dict]:
    """The rules (for one entity when given), validated: every field present, evidence given, no code listed twice for
    the same fund."""
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{path.name}: columns must be {', '.join(COLUMNS)}")
        rules = list(reader)
    seen = set()
    for n, r in enumerate(rules, start=2):
        for c in ("entity", "code", "source", "evidence"):
            if not (r[c] or "").strip():
                raise ValueError(f"{path.name} line {n}: {c} is empty")
        if r["entity"] not in ("city", "county"):
            raise ValueError(f"{path.name} line {n}: entity {r['entity']!r} is not city or county")
        key = (r["entity"], r["code"], r["fund"])
        if key in seen:
            raise ValueError(f"{path.name} line {n}: {r['code']} is listed twice for the same fund")
        seen.add(key)
    return [r for r in rules if entity is None or r["entity"] == entity]


def income_sources(accounts: list, funds: list, categories: list, entity: str = "city", revenue: str = "Revenue") -> dict:
    """budget.json `income_sources`: the source names and {account index (as text): name index} for every revenue
    account a rule matches (a rule with a fund beats nothing else: a fund rule and an any-fund rule never overlap
    on one account because the first match wins, fund rules first)."""
    rules = load(entity=entity)
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
