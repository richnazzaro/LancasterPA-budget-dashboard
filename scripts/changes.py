#!/usr/bin/env python3
""""What changed" data for the newest budget year: web/data/changes.json.

Called by build_dataset.py after budget.json is built, so it reads the same series the site shows
(one kind of figure per year) and the same `org` block. Nothing here is typed in by hand except
data/policy_notes.csv (tax-policy facts that are not in the budget tables).

Comparisons (to <- from), for the newest year N:
  N Revised  <- N-1 Projected   (default)          N Proposed <- N-1 Projected
  N Revised  <- latest Actual                       N Proposed <- latest Actual
  N Revised  <- N Proposed      (what the revision changed)

For each comparison:
  lines    every budget line whose amount differs: [account, from v, d, p, to v, d, p]
           (account indexes budget.json `accounts`; d indexes budget.json `docs`; p is the PDF page;
           v/d/p are null where the line is absent, i.e. $0)
  scopes   "all" and each fund: totals, by category, department, org-chart bureau (unit) and
           revenue group, for spending and income; top increases/decreases; new and removed lines;
           the reserve draw. Every amount carries the doc and page of its first line (fund totals:
           the page where the city prints the fund roll-up).
  positions  position counts per org-chart bureau from the staffing schedules, raw and adjusted,
           with an explicit list of artifacts (missing schedules from known_issues.csv, full-/part-time
           relabels, org-code moves, renamed titles, positions moved between funds).
Shifts between funds are detected from the city's own line notes ("Budget has been moved to the
General Fund ...", "... being transferred from Property Maintenance to Solid Waste ...") plus the
matching zero-outs, new lines, and direct-bill reimbursements. See detect_shifts().

Standard library only.
"""
from __future__ import annotations

import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

import income_rules

ROOT = Path(__file__).resolve().parent.parent
POLICY_CSV = ROOT / "data" / "policy_notes.csv"
LINE_NOTES_CSV = ROOT / "data" / "line_notes.csv"  # what the book says about one line in one year (e.g. 2025 Building Permits)
TOP_N = 10
MOVE_RE = re.compile(r"\b(?:moved|transferr(?:ed|ing))\b", re.I)
DIRECT_BILL_RE = re.compile(r"\bdirect(?:ly)?[ -]?(?:bill|billed|invoice)", re.I)
ORG_RE = re.compile(r"\bOrg\.?\s*(\d{6,9})\b", re.I)
STOP = {"bureau", "of", "the", "and", "public", "office", "department", "fund", "services", "division", "&"}


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(text) -> float:
    text = (text or "").strip()
    return float(text) if text else 0.0


def clean(n: float):
    """Whole numbers as int, fractional position counts rounded to 2 places."""
    n = round(n, 2)
    return int(n) if n == int(n) else n


# ---------------------------------------------------------------------------------------------
# Series access
# ---------------------------------------------------------------------------------------------
class Series:
    """One shown figure (e.g. 2026|projected) as lines keyed by (account_code, nth occurrence)."""

    def __init__(self, budget: dict, key: str):
        s = budget["series"][key]
        self.key = key
        n = len(s["a"])
        docs = s["doc"] if isinstance(s["doc"], list) else [s["doc"]] * n
        seen = Counter()
        self.lines = {}
        for a, v, p, d in zip(s["a"], s["v"], s["p"], docs):
            code = budget["accounts"][a][0]
            self.lines[(code, seen[code])] = (a, v, d, p)
            seen[code] += 1

    def get(self, code_nth):
        return self.lines.get(code_nth)


def link(entries) -> dict | None:
    """{v, d, p} for a sum of (a, v, d, p) entries: the first page, in the first entry's book."""
    entries = [e for e in entries if e]
    if not entries:
        return None
    d = entries[0][2]
    p = min(e[3] for e in entries if e[2] == d)
    return {"v": clean(sum(e[1] for e in entries)), "d": d, "p": p}


# ---------------------------------------------------------------------------------------------
# Line-level comparison and scoped totals
# ---------------------------------------------------------------------------------------------
def compare(budget: dict, frm: Series, to: Series, ctx: dict) -> dict:
    acc, cats = budget["accounts"], budget["categories"]
    codes = budget["org"]["codes"]
    units = budget["org"]["units"]
    rev_cat = cats.index("Revenue") if "Revenue" in cats else -1
    fund_names = budget["funds"]
    classify = income_rules.classifier()  # draw / transfer / charge (data/income_rules.csv); '' is income
    keys = sorted(set(frm.lines) | set(to.lines))
    lines, meta = [], []  # meta: per line (fund, cat, unit, dept, is_rev, delta, is_draw, bureau)
    every = []            # every key with its from/to entry, for scope totals
    for k in keys:
        f, t = frm.get(k), to.get(k)
        a = (t or f)[0]
        code, name, fund, _dept, bureau, cat = acc[a]
        unit = codes[code.split("-")[0]]
        info = {"fund": fund, "cat": cat, "unit": unit, "dept": units[unit]["dept"], "rev": cat == rev_cat,
                "bureau": bureau, "draw": code.endswith("-499000") and name.lower().startswith("fund balance reserve"),
                "cls": classify(code, fund_names[fund]) if cat == rev_cat else "",
                "f": f, "t": t, "delta": (t[1] if t else 0) - (f[1] if f else 0)}
        every.append(info)
        if f and t and f[1] == t[1]:
            continue
        info["i"] = len(lines)
        lines.append([a, *(f[1:] if f else (None, None, None)), *(t[1:] if t else (None, None, None))])
        meta.append(info)

    scopes = {}
    for scope in ["all"] + sorted({fund_names[e["fund"]] for e in every}):
        fi = None if scope == "all" else fund_names.index(scope)
        inscope = [e for e in every if fi is None or e["fund"] == fi]
        out = {}
        for kind in ("expense", "revenue"):
            # Income leaves out draws and transfers, and in the All-funds scope also charges to the government's own
            # funds (the paying fund's income already counts that money). Spending is every expense line.
            ks = [e for e in inscope if e["rev"] == (kind == "revenue") and counts_as_income(e, scope)]
            if not ks:
                continue
            block = {"total": {"f": total_link(budget, ctx, scope, kind, frm.key, ks, "f"),
                               "t": total_link(budget, ctx, scope, kind, to.key, ks, "t")}}

            def group(keyfn):
                g = defaultdict(list)
                for e in ks:
                    g[keyfn(e)].append(e)
                rows = []
                for gk, es in g.items():
                    fl, tl = link([e["f"] for e in es]), link([e["t"] for e in es])
                    rows.append([gk, fl, tl])
                rows.sort(key=lambda r: -abs((r[2] or {"v": 0})["v"] - (r[1] or {"v": 0})["v"]))
                return rows

            block["by_dept"] = group(lambda e: e["dept"])
            block["by_unit"] = group(lambda e: e["unit"])
            if kind == "expense":
                block["by_cat"] = group(lambda e: e["cat"])
            else:
                block["by_group"] = group(lambda e: e["bureau"])  # printed revenue group (budget.json `bureaus`)
                dl = [e for e in inscope if e["rev"] and e["draw"]]
                if dl:
                    block["draw"] = {"f": link([e["f"] for e in dl]), "t": link([e["t"] for e in dl])}
            ids = {id(e) for e in ks}
            changed = [m for m in meta if id(m) in ids]
            both = [m for m in changed if m["f"] and m["t"] and not m["draw"]]
            block["up"] = [m["i"] for m in sorted((m for m in both if m["delta"] > 0), key=lambda m: -m["delta"])[:TOP_N]]
            block["down"] = [m["i"] for m in sorted((m for m in both if m["delta"] < 0), key=lambda m: m["delta"])[:TOP_N]]
            new = sorted((m for m in changed if not m["f"]), key=lambda m: -m["delta"])
            gone = sorted((m for m in changed if not m["t"]), key=lambda m: m["delta"])
            block["new"] = {"n": len(new), "v": clean(sum(m["delta"] for m in new)), "i": [m["i"] for m in new]}
            block["removed"] = {"n": len(gone), "v": clean(sum(-m["delta"] for m in gone)), "i": [m["i"] for m in gone]}
            out[kind] = block
        scopes[scope] = out
    return {"lines": lines, "scopes": scopes}


def counts_as_income(e: dict, scope: str) -> bool:
    """An expense line, or a revenue line the site counts as income in this scope (see income_rules.py)."""
    if not e["rev"]:
        return True
    return e["cls"] not in ("draw", "transfer") and not (scope == "all" and e["cls"] == "charge")


def total_link(budget, ctx, scope, kind, key, entries, side):
    """Fund totals link to the page where the city prints the fund roll-up (closest occurrence to the
    line sum, as in app.js printedFund); other totals to their first line."""
    lk = link([e[side] for e in entries])
    if lk is None or scope == "all":
        return lk
    cands = [p for p in budget["printed"] if p.get("fund") == scope and p.get("kind") == kind and key in p["values"]]
    if cands:
        best = min(cands, key=lambda p: abs(p["values"][key] - lk["v"]))
        lk = {**lk, "d": best["doc"], "p": best["page"]}
    return lk


# ---------------------------------------------------------------------------------------------
# Shifts between funds, from the city's line notes
# ---------------------------------------------------------------------------------------------
def fund_in(text: str, aliases: dict) -> str | None:
    low = text.lower()
    hits = [(low.find(k), f) for k, f in aliases.items() if k in low]
    return min(hits)[1] if hits else None


def words(text: str) -> set:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if w not in STOP and len(w) > 2}


def detect_shifts(budget: dict, newest_items: list[dict], doc_idx: int, series: dict, aliases: dict) -> list[dict]:
    """A shift is a group of lines in one fund and org whose city note says the budget moved to
    another fund. Its destination is, in order of preference:
      1. lines in the destination fund carrying the same note;
      2. an org in the destination fund that is new this year (no prior amounts) and holds the same
         kinds of lines (object codes; best overlap of at least half);
      3. a new income line in the destination fund equal to what the source org now pays back through
         new "direct bill" lines (the work moved, and is billed back).
    Values are summed from the shown series, so they match the rest of the site."""
    funds = budget["funds"]
    codes, units = budget["org"]["codes"], budget["org"]["units"]
    prior_cols = [c for c in newest_items[0].keys() if re.match(r"(actual|adopted|amended|projected)", c)]
    new_cols = [c for c in newest_items[0].keys() if c.startswith("proposed")]
    seen = Counter()
    items = []
    for r in newest_items:
        nth = seen[r["account_code"]]
        seen[r["account_code"]] += 1
        r = dict(r, nth=nth, is_new=all(num(r[c]) == 0 for c in prior_cols) and any(num(r[c]) for c in new_cols),
                 had=any(num(r[c]) for c in prior_cols))
        items.append(r)

    def values(rs):
        """Summed per shown series: {key: {v, d, p}}."""
        out = {}
        for key, s in series.items():
            lk = link([s.get((r["account_code"], r["nth"])) for r in rs])
            out[key] = lk or {"v": 0}
        return out

    def ev(rs):
        notes = Counter((r["description"].strip(), r["source_page"]) for r in rs)
        return [{"t": t, "d": doc_idx, "p": int(p), "n": n} for (t, p), n in notes.items()]

    groups = defaultdict(list)
    same_note_to = defaultdict(list)
    for r in items:
        text = r["description"]
        m = MOVE_RE.search(text)
        if not m or not r["fund"] in funds:
            continue
        dest = fund_in(text[m.end():], aliases)
        if not dest or dest not in funds:
            continue  # a move inside a fund (e.g. phone charges moved to IT)
        if dest == r["fund"]:
            same_note_to[(dest, re.sub(r"\W+", " ", text).strip().lower())].append(r)
        elif r["had"]:
            groups[(r["fund"], r["org_code"], dest)].append(r)

    by_org = defaultdict(list)
    for r in items:
        by_org[(r["fund"], r["org_code"])].append(r)
    new_orgs = {k: rs for k, rs in by_org.items()
                if all(not x["had"] for x in rs) and any(x["is_new"] for x in rs)}

    shifts = []
    for (src_fund, org, dest), rs in sorted(groups.items()):
        unit = codes[org]
        note_orgs = sorted({o for r in rs for o in ORG_RE.findall(r["description"])})
        shift = {"from_fund": src_fund, "to_fund": dest,
                 "from": {"orgs": [org], "unit": unit, "label": plain(rs[0]["bureau"]), "n_lines": len(rs),
                          "values": values(rs)},
                 "evidence": ev(rs)}
        if len(rs) == 1:
            shift["from"]["label"] = rs[0]["account_name"].strip()
        to_rows, how = [], ""
        key = re.sub(r"\W+", " ", rs[0]["description"]).strip().lower()
        if same_note_to.get((dest, key)):
            to_rows, how = same_note_to[(dest, key)], "same note"
            shift["evidence"] += ev(to_rows)
        else:
            objs = {r["object_code"] for r in rs}
            best, score = None, 0.0
            for (f, o), nrs in new_orgs.items():
                if f != dest:
                    continue
                other = {r["object_code"] for r in nrs if r["is_new"]}
                j = len(objs & other) / len(objs | other)
                if j > score:
                    best, score = (f, o), j
            if best and score >= 0.5:
                to_rows = [r for r in new_orgs[best] if r["is_new"]]
                how = f"new org with the same kinds of lines ({round(score * 100)}% of object codes match)"
        if to_rows:
            to_orgs = sorted({r["org_code"] for r in to_rows})
            shift["to"] = {"orgs": to_orgs, "unit": codes[to_orgs[0]], "label": plain(to_rows[0]["bureau"]),
                           "n_lines": len(to_rows), "values": values(to_rows), "how": how}
        else:
            billed = [r for r in by_org[(src_fund, org)] if r["is_new"] and DIRECT_BILL_RE.search(r["description"])]
            if billed:
                bv = values(billed)
                reimb = None
                for r in items:
                    if r["fund"] == dest and r["is_new"] and r["category"] == "Revenue":
                        rv = values([r])
                        if any(abs(rv[k]["v"] - bv[k]["v"]) <= 1 and bv[k]["v"] for k in bv):
                            reimb = r
                            break
                shift["billed"] = {"n_lines": len(billed), "values": bv}
                shift["evidence"] += ev(billed)
                if reimb:
                    shift["billed"]["reimb"] = {"code": reimb["account_code"], "name": reimb["account_name"].strip(),
                                                "values": values([reimb])}
                    shift["evidence"] += ev([reimb])
                # Where the work went: the destination-fund bureau named in the note.
                note_words = words(rs[0]["description"])
                cand = sorted({codes[o] for o, u in codes.items() if o in {x["org_code"] for x in items if x["fund"] == dest}
                               and units[u]["kind"] == "bureau" and units[u]["dept"] == units[unit]["dept"]},
                              key=lambda u: -len(words(units[u]["name"]) & note_words))
                if cand and words(units[cand[0]]["name"]) & note_words:
                    shift["to"] = {"orgs": [], "unit": cand[0], "label": units[cand[0]]["name"], "values": None,
                                   "how": "named in the note; the cost is not shown on separate lines"}
        if note_orgs:
            shift["note_orgs"] = note_orgs
            if shift.get("to") and shift["to"]["orgs"] and not set(note_orgs) & set(shift["to"]["orgs"]):
                shift["note_org_mismatch"] = True
        shifts.append(shift)
    return shifts


def plain(name: str) -> str:
    return re.sub(r"\s+Exp(?:ense)?$", "", name.strip(), flags=re.I)


# ---------------------------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------------------------
def load_schedule(path: Path, column: str, doc_idx: int, org_fund: dict, codes: dict) -> dict | None:
    rows = read_csv(path)
    if not rows or f"count_{column}" not in rows[0]:
        return None
    has_ftpt = any(r.get("ft_pt") in ("FT", "PT") for r in rows)
    by = defaultdict(lambda: {"n": 0.0, "p": None, "titles": Counter()})
    remapped = []
    for r in rows:
        n = num(r[f"count_{column}"])
        if not n:
            continue
        org = r["org_code"]
        if org not in codes:
            # A misprinted org code (e.g. 56188001 for 56188000): use the one mapped code it differs from in the last digit.
            near = [c for c in codes if len(c) == len(org) and c[:-1] == org[:-1]]
            if len(near) != 1:
                raise SystemExit(f"staffing org {org} ({path.name}) is not in data/org_structure_2027.csv")
            remapped.append({"printed": org, "used": near[0], "n": n, "p": int(r["source_page"]), "title": r["position_title"]})
            org = near[0]
        cls = r["ft_pt"] if has_ftpt and r["ft_pt"] in ("FT", "PT") else ("FT" if has_ftpt else "ALL")
        e = by[(org, cls)]
        e["n"] += n
        p = int(r["source_page"])
        e["p"] = p if e["p"] is None else min(e["p"], p)
        e["titles"][norm_title(r["position_title"])] += n
    return {"doc": doc_idx, "column": column, "ftpt": has_ftpt, "orgs": dict(by), "remapped": remapped,
            "fund": {o: org_fund[o] for o, _ in by}}


def norm_title(t: str) -> str:
    return re.sub(r"[^A-Z0-9]+", " ", t.upper()).strip()


def staff_org(budget_org: str, schedule_orgs) -> str | None:
    """Budget and staffing pages can print one org with 8 or 9 digits (560888000 / 56088800)."""
    if budget_org in schedule_orgs:
        return budget_org
    alt = budget_org[:-1] if budget_org.endswith("0") and len(budget_org) == 9 else None
    return alt if alt in schedule_orgs else None


def compare_positions(budget, frm, to, codes, units, known_issues, shifts, ctx) -> dict:
    cls_list = ["FT", "PT"] if frm["ftpt"] and to["ftpt"] else ["ALL"]

    def collapse(sched):
        out = defaultdict(lambda: {"n": 0.0, "p": None, "titles": Counter()})
        for (org, cls), e in sched["orgs"].items():
            c = cls if cls_list != ["ALL"] else "ALL"
            x = out[(org, c)]
            x["n"] += e["n"]
            x["titles"].update(e["titles"])
            x["p"] = e["p"] if x["p"] is None else min(x["p"], e["p"])
        return out

    F, T = collapse(frm), collapse(to)
    funds = budget["funds"]
    org_fund = {**frm["fund"], **to["fund"]}
    artifacts = []
    # adjusted counts start as raw, per (org, cls)
    adjF = {k: v["n"] for k, v in F.items()}
    adjT = {k: v["n"] for k, v in T.items()}
    orgs = sorted({o for o, _ in F} | {o for o, _ in T})
    tot = lambda S, o: sum(v["n"] for (oo, _), v in S.items() if oo == o)

    # 1. Schedules the source book leaves out (reviewed notes in known_issues.csv).
    for side, sched, other in (("from", frm, T), ("to", to, F)):
        doc = budget["docs"][sched["doc"]]
        for i in known_issues:
            if i["source_doc"] != doc:
                continue
            for name, org in re.findall(r"no staffing schedule for (.+?) \(org (\d+)\)", i["note"]):
                there = tot(other, org)
                if not there:
                    continue  # missing on both sides (same book): nothing to adjust
                for k in list(adjF):
                    if k[0] == org:
                        adjF[k] = 0.0
                for k in list(adjT):
                    if k[0] == org:
                        adjT[k] = 0.0
                n_issue = re.search(r"(?:Gap of|of) ([\d.]+) positions", i["note"])
                artifacts.append({"kind": "missing_schedule", "orgs": [org], "unit": codes[org], "fund": org_fund.get(org, ""),
                                  "side": side, "n_other": clean(there), "n_note": float(n_issue.group(1)) if n_issue else None,
                                  "d": sched["doc"], "p": int(i["source_page"]),
                                  "text": f"The {ctx[side + '_label']} has no page for {name} (org {org}); its "
                                          f"{clean(there)} position{'s' if there != 1 else ''} in the {ctx[('to' if side == 'from' else 'from') + '_label']} "
                                          f"are left out of the adjusted count." +
                                          (f" The city's position summary lists {n_issue.group(1)}." if n_issue else "")})

    # 2. Full-time / part-time relabels: an org's full-time count falls by exactly what its part-time count
    #    gains, with the same titles.
    if cls_list == ["FT", "PT"]:
        for o in orgs:
            fF, fP, tF, tP = (S.get((o, c), {"n": 0, "titles": Counter()}) for S, c in ((F, "FT"), (F, "PT"), (T, "FT"), (T, "PT")))
            for a, b, c, d, label in ((fF, tP, "FT", "PT", "full-time → part-time"), (fP, tF, "PT", "FT", "part-time → full-time")):
                drop = a["n"] - S_get(T, o, c)
                gain = b["n"] - S_get(F, o, d)
                if drop > 0 and abs(drop - gain) < 1e-6 and set(a["titles"]) == set(b["titles"]):
                    adjF[(o, c)] = adjF.get((o, c), 0) - drop
                    adjF[(o, d)] = adjF.get((o, d), 0) + drop
                    artifacts.append({"kind": "relabel", "orgs": [o], "unit": codes[o], "fund": org_fund[o], "n": clean(drop),
                                      "d": to["doc"], "p": T[(o, d)]["p"],
                                      "text": f"{clean(drop)} position{'s' if drop != 1 else ''} with the same titles are marked {label} "
                                              f"(org {o}). Counted as relabelled, not cut or added."})

    # 3. Positions moved between funds with a detected shift.
    for s in shifts:
        so = staff_org(s["from"]["orgs"][0], {o for o, _ in F})
        if not so or not s.get("to"):
            continue
        moved = {c: S_get(F, so, c) - S_get(T, so, c) for c in cls_list}
        if not any(v > 0 for v in moved.values()):
            continue
        dest_unit = s["to"]["unit"]
        s.setdefault("positions", {})[ctx["id"]] = {c: clean(v) for c, v in moved.items() if v}
        for c, v in moved.items():
            if v <= 0:
                continue
            adjF[(so, c)] = adjF.get((so, c), 0) - v
            ghost = (f"moved:{s['to_fund']}:{dest_unit}", c)
            adjF[ghost] = adjF.get(ghost, 0) + v
        artifacts.append({"kind": "moved", "orgs": [so], "unit": dest_unit, "from_unit": codes[s["from"]["orgs"][0]],
                          "fund": s["to_fund"], "from_fund": s["from_fund"], "n": {c: clean(v) for c, v in moved.items() if v},
                          "d": frm["doc"], "p": F[(so, cls_list[0])]["p"] if (so, cls_list[0]) in F else None,
                          "text": f"{fmt_n(sum(moved.values()))} position{'s' if sum(moved.values()) != 1 else ''} in {s['from']['label']} "
                                  f"({s['from_fund']}, org {so}) in the {ctx['from_label']} moved with the work to the {s['to_fund']} "
                                  f"({units[dest_unit]['name']}). Counted as moved, not added."})

    # Misprinted org codes in a schedule (counted under the nearest mapped code).
    for side, sched in (("from", frm), ("to", to)):
        for m in sched["remapped"]:
            artifacts.append({"kind": "org_typo", "orgs": [m["printed"], m["used"]], "unit": codes[m["used"]], "fund": org_fund[m["used"]],
                              "n": clean(m["n"]), "d": sched["doc"], "p": m["p"],
                              "text": f"The {ctx[side + '_label']} prints org {m['printed']}, which is not a budget org, for "
                                      f"{fmt_n(m['n'])} position ({m['title'].title()}). Counted under org {m['used']}."})

    # 4. Org-code moves inside one bureau, and renamed titles (both need no adjustment at bureau level).
    moved_orgs = {o for a in artifacts if a["kind"] == "moved" for o in a["orgs"]}
    by_unit_orgs = defaultdict(set)
    for o in orgs:
        by_unit_orgs[(org_fund[o], codes[o])].add(o)
    for (fund, u), os_ in by_unit_orgs.items():
        gone = [o for o in os_ if tot(F, o) and not tot(T, o) and o not in moved_orgs]
        came = [o for o in os_ if tot(T, o) > tot(F, o)]
        for g in gone:
            tg = Counter()
            for (o, _), e in F.items():
                if o == g:
                    tg.update(e["titles"])
            for c in came:
                tc = Counter()
                for (o, _), e in T.items():
                    if o == c:
                        tc.update(e["titles"])
                if set(tg) & set(tc) and not any(a.get("kind") == "missing_schedule" and g in a["orgs"] for a in artifacts):
                    artifacts.append({"kind": "org_move", "orgs": [g, c], "unit": u, "fund": fund, "n": clean(tot(F, g)),
                                      "d": to["doc"], "p": min(e["p"] for (o, _), e in T.items() if o == c),
                                      "text": f"Org {g}'s {fmt_n(tot(F, g))} positions are printed under org {c} in the {ctx['to_label']}, "
                                              f"in the same bureau. No change is counted for the move."})
        tf, tt = Counter(), Counter()
        for (o, _), e in F.items():
            if o in os_ and not any(a.get("kind") == "missing_schedule" and o in a["orgs"] for a in artifacts):
                tf.update(e["titles"])
        for (o, _), e in T.items():
            if o in os_ and not any(a.get("kind") == "missing_schedule" and o in a["orgs"] for a in artifacts):
                tt.update(e["titles"])
        old = sorted(set(tf) - set(tt))
        new = sorted(set(tt) - set(tf))
        if old and new:
            artifacts.append({"kind": "titles", "unit": u, "fund": fund, "orgs": sorted(os_), "old": old[:4], "new": new[:4],
                              "n_old": len(old), "n_new": len(new), "d": to["doc"], "p": None,
                              "text": f"{len(old)} title{'s' if len(old) != 1 else ''} in the {ctx['from_label']} "
                                      f"(e.g. {', '.join(old[:2])}) are not printed in the {ctx['to_label']}, which has "
                                      f"{len(new)} other{'s' if len(new) != 1 else ''} (e.g. {', '.join(new[:2])}). Titles are renamed "
                                      f"or reworded between books, so positions are compared per bureau, not per title."})

    # Rows per (fund, unit, cls)
    agg = defaultdict(lambda: {"f": 0.0, "t": 0.0, "af": 0.0, "at": 0.0, "fp": None, "tp": None})
    def put(key, field, n, p=None, pf=None):
        e = agg[key]
        e[field] += n
        if p is not None and pf:
            e[pf] = p if e[pf] is None else min(e[pf], p)
    for (o, c), e in F.items():
        put((org_fund[o], codes[o], c), "f", e["n"], e["p"], "fp")
    for (o, c), e in T.items():
        put((org_fund[o], codes[o], c), "t", e["n"], e["p"], "tp")
    for (o, c), n in adjF.items():
        if o.startswith("moved:"):
            _, fund, u = o.split(":")
            put((fund, int(u), c), "af", n)
        else:
            put((org_fund[o], codes[o], c), "af", n)
    for (o, c), n in adjT.items():
        put((org_fund[o], codes[o], c), "at", n)
    rows = []
    for (fund, u, c), e in sorted(agg.items(), key=lambda kv: (kv[0][0], units[kv[0][1]]["dept"], kv[0][1], kv[0][2])):
        if not any(abs(e[x]) > 1e-9 for x in ("f", "t", "af", "at")):
            continue
        notes = [i for i, a in enumerate(artifacts) if a["fund"] == fund and a["unit"] == u
                 or a.get("kind") == "moved" and a["from_fund"] == fund and a["from_unit"] == u]
        rows.append([funds.index(fund), u, c, clean(e["f"]), clean(e["t"]), clean(e["af"]), clean(e["at"]),
                     e["fp"], e["tp"], notes])
    totals = {}
    for scope in ["all"] + sorted({r[0] for r in rows}):
        for c in cls_list:
            rs = [r for r in rows if r[2] == c and (scope == "all" or r[0] == scope)]
            totals.setdefault(str(scope), {})[c] = {k: clean(sum(r[i] for r in rs)) for k, i in (("f", 3), ("t", 4), ("af", 5), ("at", 6))}
    return {"from_label": ctx["from_label"], "to_label": ctx["to_label"], "from_doc": frm["doc"], "to_doc": to["doc"],
            "classes": cls_list, "rows": rows, "totals": totals, "artifacts": artifacts}


def S_get(S, org, cls):
    return S.get((org, cls), {"n": 0.0})["n"]


def fmt_n(n):
    n = round(n, 2)
    return str(int(n)) if n == int(n) else f"{n:g}"


# ---------------------------------------------------------------------------------------------
# Department and bureau summaries
# ---------------------------------------------------------------------------------------------
# Position titles are abbreviated and reworded between books ("POL OFF 8HR", "POLICE OFFICER";
# "EO1", "EO 1"). For naming titles in a summary they are compared by a canonical form: shift lengths
# and "part time" dropped, letters and digits split, and these printed abbreviations spelled out.
TITLE_WORDS = {
    "POL": "POLICE", "OFF": "OFFICER", "SGT": "SERGEANT", "DET": "DETECTIVE", "LT": "LIEUTENANT",
    "POLSGT": "POLICE SERGEANT", "POLLT": "POLICE LIEUTENANT", "SCH": "SCHOOL", "CROSS": "CROSSING",
    "MAINT": "MAINTENANCE", "MAIN": "MAINTENANCE", "MGR": "MANAGER", "ASST": "ASSISTANT", "ASSIS": "ASSISTANT",
    "DEP": "DEPUTY", "DIR": "DIRECTOR", "TEC": "TECH", "PW": "PUBLIC WORKS", "PWENGINEER": "PUBLIC WORKS ENGINEER",
    "PWENVIRON": "PUBLIC WORKS ENVIRON", "PRKS": "PARKS", "ADMIN": "ADMINISTRATIVE",
}
TITLE_DROP = re.compile(r"\b\d+\s*HR\b|\bPART\s*TIME\b")
SMALL = {"OF", "AND", "THE", "TO", "FOR", "IN"}
DRIVER_SHARE = 0.15  # a line is a driver when it is at least this share of the net change (the largest always is)
DRIVER_COVER = 0.5   # below this share of the net change, the summary names categories instead of lines
TITLE_MIN = 1        # titles are named only when their count changes by at least one position


def title_key(t: str) -> str:
    t = TITLE_DROP.sub(" ", re.sub(r"[^A-Z0-9]+", " ", t.upper()))
    t = re.sub(r"(?<=[A-Z])(?=\d)|(?<=\d)(?=[A-Z])", " ", t)
    return " ".join(TITLE_WORDS.get(w, w) for w in t.split())


def title_name(key: str) -> str:
    out = []
    for i, w in enumerate(key.split()):
        if w in SMALL and i:
            out.append(w.lower())
        elif len(w) <= 2 or re.fullmatch(r"[IVX]+", w):
            out.append(w)
        else:
            out.append(w.capitalize())
    return " ".join(out)


def summaries(budget: dict, comp: dict, shifts: list, frm: dict, to: dict, codes: dict, units: list) -> dict:
    """Per department ("d") and org-chart bureau ("u"), per fund scope ("all" and each fund; bureaus
    "all" only, as bureau pages cover all their funds), what a short summary needs beyond the total:
      net      the change summed from the comparison's changed lines (spending)
      drivers  up to 3 changed lines, indexes into comp["lines"], that add most to the net change
      pos      positions in both schedules (all classes): f, t, adjusted af, at, and why they differ:
               moved_in / moved_out (positions moved between funds with their work) and missing
               (positions on an org one book has no schedule page for: + when only the newer has it)
      titles   up to 3 [name, f, t]: titles whose count changed, where the books' titles can be matched
      shifts   indexes into the shifts list that move money into or out of the General Fund"""
    acc, cats, funds = budget["accounts"], budget["categories"], budget["funds"]
    rev_cat = cats.index("Revenue") if "Revenue" in cats else -1
    P = comp.get("positions")
    org_fund = {**frm["fund"], **to["fund"]} if frm and to else {}
    gf = funds[0] if funds else ""

    def line_info(ln):
        code, _name, fund, _d, _b, cat = acc[ln[0]]
        u = codes[code.split("-")[0]]
        return fund, u, cat

    infos = [line_info(ln) for ln in comp["lines"]]

    def titles_of(sched, keep):
        c = Counter()
        for (org, _cls), e in sched["orgs"].items():
            if keep(org):
                for t, n in e["titles"].items():
                    c[title_key(t)] += n
        return c

    def org_titles(sched, org):
        c = Counter()
        for (o, _cls), e in sched["orgs"].items():
            if o == org:
                for t, n in e["titles"].items():
                    c[title_key(t)] += n
        return c

    out = {}
    scope_names = ["all"] + [s for s in comp["scopes"] if s != "all"]
    for scope in scope_names:
        fi = None if scope == "all" else funds.index(scope)
        groups = [("d", d) for d in range(len(budget["org"]["departments"]))]
        if scope == "all":
            groups += [("u", u) for u in range(len(units))]
        block = {"d": {}, "u": {}}
        for kind, g in groups:
            in_group = (lambda u: units[u]["dept"] == g) if kind == "d" else (lambda u: u == g)
            in_fund = lambda f: fi is None or f == fi
            idx = [i for i, (f, u, cat) in enumerate(infos) if cat != rev_cat and in_fund(f) and in_group(u)]
            delta = lambda i: (comp["lines"][i][4] or 0) - (comp["lines"][i][1] or 0)
            net = clean(sum(delta(i) for i in idx))
            s = {"net": net}
            if net:
                sign = 1 if net > 0 else -1
                ranked = sorted((i for i in idx if delta(i) * sign > 0), key=lambda i: -delta(i) * sign)
                s["drivers"] = [i for n, i in enumerate(ranked[:3]) if n == 0 or abs(delta(i)) >= DRIVER_SHARE * abs(net)]
                # When no few lines explain at least half the change, the categories say it better:
                # [category, change, d, p of the category's largest changed line in the newer book].
                if sum(delta(i) for i in s["drivers"]) * sign < DRIVER_COVER * abs(net):
                    by_cat = defaultdict(list)
                    for i in idx:
                        by_cat[infos[i][2]].append(i)
                    cs = sorted(((c, sum(delta(i) for i in l), l) for c, l in by_cat.items()), key=lambda x: -x[1] * sign)
                    cs = [x for n, x in enumerate(cs[:3]) if x[1] * sign > 0 and (n == 0 or abs(x[1]) >= DRIVER_SHARE * abs(net))]
                    s["cat_drivers"] = []
                    for c, dv, l in cs:
                        top = max(l, key=lambda i: abs(delta(i)))
                        ln = comp["lines"][top]
                        d, p = (ln[5], ln[6]) if ln[5] is not None else (ln[2], ln[3])
                        s["cat_drivers"].append([c, clean(dv), d, p])
                    del s["drivers"]
            # positions
            if P:
                rows = [r for r in P["rows"] if (fi is None or r[0] == fi) and in_group(r[1])]
                if rows:
                    pos = {k: clean(sum(r[i] for r in rows)) for k, i in (("f", 3), ("t", 4), ("af", 5), ("at", 6))}
                    pos["by_cls"] = {c: [clean(sum(r[3] for r in rows if r[2] == c)), clean(sum(r[4] for r in rows if r[2] == c))]
                                     for c in P["classes"] if any(r[2] == c for r in rows)}
                    mi = mo = miss = 0.0
                    missing_orgs, moves = set(), []
                    for a in P["artifacts"]:
                        if a["kind"] == "moved":
                            n = sum(a["n"].values())
                            dest_in = in_group(a["unit"]) and (fi is None or funds[fi] == a["fund"])
                            src_in = in_group(a["from_unit"]) and (fi is None or funds[fi] == a["from_fund"])
                            if dest_in and not src_in:
                                mi += n
                                moves.append((a["orgs"][0], 1))
                            elif src_in and not dest_in:
                                mo += n
                                moves.append((a["orgs"][0], -1))
                        elif a["kind"] == "missing_schedule" and in_group(a["unit"]) and (fi is None or funds[fi] == a["fund"]):
                            miss += a["n_other"] if a["side"] == "from" else -a["n_other"]
                            missing_orgs.update(a["orgs"])
                    pos |= {"moved_in": clean(mi), "moved_out": clean(mo), "missing": clean(miss)}
                    s["pos"] = pos
                    # titles, on the adjusted basis: moved positions count where they work now; orgs a book has no
                    # schedule page for are left out of both sides
                    keep = lambda o: (o in org_fund and o in codes and o not in missing_orgs and in_group(codes[o])
                                      and (fi is None or org_fund[o] == funds[fi]))
                    tf, tt = titles_of(frm, keep), titles_of(to, keep)
                    for org, sg in moves:
                        moved = org_titles(frm, org) - org_titles(to, org)
                        for k, n in moved.items():
                            tf[k] += n * sg
                    tf = Counter({k: n for k, n in tf.items() if n > 1e-9})
                    gone = [k for k in tf if k not in tt]
                    new = [k for k in tt if k not in tf]
                    clear = [k for k in tf if k in tt and abs(tf[k] - tt[k]) >= TITLE_MIN - 1e-9]
                    if not (gone and new):  # titles only on one side are named only when nothing could be a rename
                        clear += [k for k in gone + new if max(tf.get(k, 0), tt.get(k, 0)) >= TITLE_MIN - 1e-9]
                    # Two titles that start with the same two words and change in opposite directions may be one
                    # title worded two ways ("Plant Maintenance Mech 3", "Plant Maintenance Mechanic"): name neither.
                    dt = lambda k: tt.get(k, 0) - tf.get(k, 0)
                    twin = {k for k in clear for j in clear if j != k and k.split()[:2] == j.split()[:2] and dt(k) * dt(j) < 0}
                    clear = [k for k in clear if k not in twin]
                    clear.sort(key=lambda k: (-abs(tt.get(k, 0) - tf.get(k, 0)), k))
                    if clear:
                        s["titles"] = [[title_name(k), clean(tf.get(k, 0)), clean(tt.get(k, 0))] for k in clear[:3]]
                    if gone and new:
                        s["titles_renamed"] = True
            # shifts into or out of the General Fund that touch this group
            if parse_year(comp["from"]) != parse_year(comp["to"]):
                sh = [j for j, x in enumerate(shifts) if gf in (x["from_fund"], x["to_fund"])
                      and (fi is None or funds[fi] in (x["from_fund"], x["to_fund"]))
                      and (in_group(x["from"]["unit"]) or (x.get("to") and in_group(x["to"]["unit"])))]
                if sh:
                    s["shifts"] = sh
            if len(s) > 1 or net:
                block[kind][str(g)] = s
        out[scope] = block
    return out


def parse_year(k: str) -> str:
    return k.split("|")[0]


# ---------------------------------------------------------------------------------------------
# Policy notes
# ---------------------------------------------------------------------------------------------
def policy_notes(docs: list) -> list:
    if not POLICY_CSV.exists():
        return []
    out = []
    for r in read_csv(POLICY_CSV):
        e = {"year": int(r["year"]), "figure": r["figure"].strip(), "item": r["item"].strip(), "text": r["text"].strip(),
             "source": r["source"].strip(), "account": (r.get("account") or "").strip()}
        m = re.match(r"(.+\.pdf)#page=(\d+)$", e["source"], re.I)
        if m:
            if m.group(1) not in docs:
                raise SystemExit(f"policy_notes.csv: unknown source document {m.group(1)}")
            e["d"], e["p"] = docs.index(m.group(1)), int(m.group(2))
        # A tax-change tile on the Income view: the rate before and after (rate_from, rate_to, unit), or, where the
        # rate itself is not printed, only the change in percent (change_pct; 0 = no change).
        for k in ("rate_from", "rate_to", "change_pct"):
            v = (r.get(k) or "").strip()
            if v:
                e[k] = float(v)
        if "rate_from" in e or "rate_to" in e:
            if not ("rate_from" in e and "rate_to" in e and (r.get("unit") or "").strip()):
                raise SystemExit(f"policy_notes.csv: {e['year']} {e['item']}: rate_from, rate_to and unit go together")
            e["unit"] = r["unit"].strip()
        out.append(e)
    return out


def line_notes(docs: list) -> list:
    """Hand-kept, sourced context for one line in one year (data/line_notes.csv): year, figure, account, text, source.
    The site shows it beside the generated note for a line far above the years either side of it."""
    if not LINE_NOTES_CSV.exists():
        return []
    out = []
    for r in read_csv(LINE_NOTES_CSV):
        e = {"year": int(r["year"]), "figure": r["figure"].strip(), "account": r["account"].strip(), "text": r["text"].strip()}
        m = re.match(r"(.+\.pdf)#page=(\d+)$", r["source"].strip(), re.I)
        if not m or m.group(1) not in docs:
            raise SystemExit(f"line_notes.csv: source must be <budget book pdf>#page=N, got {r['source']!r}")
        e["d"], e["p"] = docs.index(m.group(1)), int(m.group(2))
        out.append(e)
    return out


# ---------------------------------------------------------------------------------------------
def build_changes(budget: dict, processed: Path, designated: dict, newest: int, aliases: dict) -> dict:
    docs = budget["docs"]
    newest_book = designated[newest]
    items_path = processed / f"line_items_{newest_book['stem']}.csv"
    newest_items = read_csv(items_path) if items_path.exists() else []
    newest_doc = docs.index(newest_book["doc"])
    keys = budget["series"]
    to_keys = [k for k in (f"{newest}|revised", f"{newest}|proposed") if k in keys]
    actual_years = sorted(int(k.split("|")[0]) for k in keys if k.endswith("|actual"))
    from_keys = [k for k in (f"{newest - 1}|projected",) if k in keys]
    if actual_years:
        from_keys.append(f"{actual_years[-1]}|actual")
    pairs = [(t, f) for t in to_keys for f in from_keys]
    if len(to_keys) == 2:
        pairs.append((to_keys[0], to_keys[1]))  # what the revision changed
    series = {k: Series(budget, k) for k in set(to_keys + from_keys)}
    label = lambda k: f"{k.split('|')[0]} {k.split('|')[1].capitalize()}"

    org_rows = read_csv(ROOT / "data" / "org_structure_2027.csv")
    org_fund = {r["org_code"]: r["fund"] for r in org_rows}
    codes, units = budget["org"]["codes"], budget["org"]["units"]
    known = budget.get("known_issues", [])

    # Staffing schedules: the newest book's proposed / revised columns, and each earlier book's own-year column.
    schedules = {}
    for k in to_keys:
        col = f"{newest}_proposed_revised" if k.endswith("revised") else f"{newest}_proposed"
        path = processed / f"staffing_{newest_book['stem']}.csv"
        if path.exists():
            sc = load_schedule(path, col, newest_doc, org_fund, codes)
            if sc:
                schedules[k] = sc | {"label": f"{label(k)} position schedule"}
    for k in from_keys:
        y = int(k.split("|")[0])
        book = designated.get(y)
        path = processed / f"staffing_{book['stem']}.csv" if book else None
        if path and path.exists():
            sc = load_schedule(path, f"{y}_proposed", docs.index(book["doc"]), org_fund, codes)
            if sc:
                schedules[k] = sc | {"label": f"{y} budget book's position schedule"}

    shifts = detect_shifts(budget, newest_items, newest_doc, series, aliases) if newest_items else []

    comparisons = {}
    for t, f in pairs:
        cid = f"{t}~{f}"
        ctx = {"id": cid, "from_label": schedules.get(f, {}).get("label", label(f)), "to_label": schedules.get(t, {}).get("label", label(t))}
        comp = {"to": t, "from": f, "same_kind": t.split("|")[1] == f.split("|")[1] or f.split("|")[0] == t.split("|")[0]}
        comp |= compare(budget, series[f], series[t], ctx)
        if t in schedules and f in schedules:
            comp["positions"] = compare_positions(budget, schedules[f], schedules[t], codes, units, known,
                                                  shifts if f.split("|")[0] != t.split("|")[0] else [], ctx)
        comparisons[cid] = comp
    for cid, comp in comparisons.items():
        t, f = comp["to"], comp["from"]
        if comp.get("positions"):
            comp["summary"] = summaries(budget, comp, shifts, schedules[f], schedules[t], codes, units)
        else:
            comp["summary"] = summaries(budget, comp, shifts, {}, {}, codes, units)
    for s in shifts:
        s.setdefault("positions", {})
    return {
        "year": newest,
        "default": f"{to_keys[0]}~{from_keys[0]}" if to_keys and from_keys else None,
        "note": "Indexes: account -> budget.json accounts; d -> budget.json docs; unit -> budget.json org.units; "
                "dept -> org.departments; cat -> categories; by_group key -> bureaus (printed revenue group).",
        "comparisons": comparisons,
        "shifts": shifts,
        "policy": policy_notes(docs),
        "line_notes": line_notes(docs),
    }
