"""What counts as income (a government's mapping/income_rules.csv).

The budget books list some revenue lines that are not money coming in from the public:

    draw      money taken from the fund's own savings ("Fund Balance Reserve")
    transfer  money moved in from another of the government's own funds
    charge    a charge to another of the government's own funds for services (indirect costs,
              Treasury and IT allocations, vehicle upkeep)
    income    reviewed and counted as income: a line whose name looks like one of the above but is money from
              outside (a federal indirect-cost grant, the state's liquid fuels allocation)

Income on the site leaves out draws and transfers everywhere. Charges stay in the income of the fund that
receives them, labelled, and are left out of the All-funds total, where the paying fund's own income already
counts the money. Spending is shown as printed. A rule matches the object code (City, 6 digits) or account
(County, 4 digits) after the "-" in an account code, and optionally a fund name.

WATCH lists names that look like one of these; check_dataset.py and check_county.py fail on any revenue line
that matches and has no rule, so a new transfer line in a future book is reviewed before it is counted as income.
"""

from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path

import govconfig

def path(gov=None) -> Path:
    """The government's mapping/income_rules.csv (governments/<id>/mapping/)."""
    import govconfig
    return govconfig.resolve_government(gov).mapping / "income_rules.csv"
CLASSES = ("draw", "transfer", "charge", "income")
# Names that suggest a draw, transfer or charge. "Real Estate Transfer" is a tax.
WATCH = re.compile(r"(?<!estate )transfer|tsfr|fund balance|allocation|indirect|county cash|county share|reimb\.? .*fund", re.I)
# County revenue categories that are payments from other County funds.
WATCH_COUNTY_CATEGORY = re.compile(r"^Charges (to )?County Agencies$", re.I)


def load(gov=None) -> list[dict]:
    file = path(gov)
    with file.open(newline="") as f:
        rules = list(csv.DictReader(f))
    for r in rules:
        if r["class"] not in CLASSES:
            raise ValueError(f"{file.name}: class {r['class']!r} for {r['code']} is not one of {CLASSES}")
    return rules


def classifier(rules: list[dict] | None = None):
    """(account_code, fund name) -> 'draw' | 'transfer' | 'charge' | '' (income)."""
    rules = load() if rules is None else rules
    by_code: dict[str, list[dict]] = {}
    for r in rules:
        by_code.setdefault(r["code"], []).append(r)

    def classify(account_code: str, fund: str = "") -> str:
        obj = account_code.split("-")[-1]
        for r in by_code.get(obj, []):
            if not r["fund"] or r["fund"] == fund:
                return "" if r["class"] == "income" else r["class"]
        return ""
    return classify


def not_income(accounts: list, funds: list, categories: list, revenue: str = "Revenue", gov=None) -> dict:
    """budget.json `not_income`: {account index (as text): class} for every revenue account a rule matches."""
    classify = classifier(load(gov))
    out = {}
    for i, a in enumerate(accounts):
        if categories[a[5]] != revenue:
            continue
        c = classify(a[0], funds[a[2]])
        if c:
            out[str(i)] = c
    return out


def check(budget: dict, revenue: str = "Revenue", gov=None) -> int:
    """For check_dataset.py and check_county.py: every revenue line that looks like a draw, transfer or charge (WATCH,
    or a County "Charges to County Agencies" group) has a rule, and every rule's class is what budget.json carries.
    Returns the number of failures."""
    acc, funds, cats, bureaus = budget["accounts"], budget["funds"], budget["categories"], budget["bureaus"]
    rules = load(gov)
    classify, bad, seen = classifier(rules), 0, Counter()
    reviewed = {r["code"] for r in rules if r["class"] == "income"}
    print(f"\nWhat counts as income ({govconfig.rel(path(gov))}):")
    for i, a in enumerate(acc):
        if cats[a[5]] != revenue:
            continue
        c = classify(a[0], funds[a[2]])
        if c != budget["not_income"].get(str(i), ""):
            bad += 1
            print(f"FAIL {a[0]} {a[1]}: rule says {c or 'income'}, budget.json says {budget['not_income'].get(str(i)) or 'income'}")
        if c:
            seen[c] += 1
        elif a[0].split("-")[-1] not in reviewed and (WATCH.search(a[1]) or WATCH_COUNTY_CATEGORY.match(bureaus[a[4]])):
            bad += 1
            print(f"FAIL {a[0]} {a[1]} ({funds[a[2]]}): looks like a draw, transfer or charge but has no rule; "
                  f"add it to {govconfig.rel(path(gov))}")
    print(f"{'ok  ' if not bad else 'FAIL'} revenue accounts not counted as income: {dict(sorted(seen.items()))}; no unreviewed look-alikes")
    return bad
