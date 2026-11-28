#!/usr/bin/env python3
"""Check every portable configuration file and hand-kept CSV against its schema (docs/portable/PLAN.md step 0.4).

What it checks:
  site.yaml, kinds/*.yaml, governments/*/government.yaml, and when present governments/*/books/*.yaml,
  governments/*/content/calendar.yaml and governments/*/content/rules/*.yaml;
  today's per-book configs (config/*.json, config/county/*.json, config/county/acfr/*.json,
  config/county/resolutions/*.json) against schemas/book.schema.json, and content/rules/tax_limit.yaml against
  schemas/tax_limit.schema.json, so the schemas are proven to describe the files that exist;
  today's hand-kept CSVs (data/*.csv, data/county/*.csv) against schemas/csv/: required columns, unknown columns,
  and every value (types, allowed values, forms such as page numbers and account codes).

Exit status 0 when everything is valid; 1 with one readable line per problem (file, field or row/column, what was
expected).

Usage:
  python scripts/validate_config.py                  check everything
  python scripts/validate_config.py --file PATH      check one file (its schema is picked from its name and folder;
                                                     add --schema NAME to choose, e.g. --schema government)
  python scripts/validate_config.py --list           list each file with the schema that checks it

Needs PyYAML and jsonschema (requirements-build.txt).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import govconfig  # noqa: E402
from govconfig import ROOT, ConfigError, rel  # noqa: E402

# Each CSV schema (schemas/csv/<name>.schema.json) and the hand-kept files it checks today. Phase 1 and 2 move these
# files into governments/<id>/mapping|notes|content; only this table changes then.
CSV_FILES = {
    "funds": ["governments/lancaster-city/mapping/funds.csv"],
    "income_rules": ["governments/lancaster-city/mapping/income_rules.csv",
                     "governments/lancaster-county/mapping/income_rules.csv"],
    "income_sources": ["governments/lancaster-city/mapping/income_sources.csv"],
    "known_issues": ["governments/lancaster-city/notes/known_issues.csv", "data/county/known_issues.csv"],
    "line_notes": ["governments/lancaster-city/notes/line_notes.csv"],
    "ocr_corrections": ["governments/lancaster-city/notes/ocr_corrections.csv", "data/county/ocr_corrections.csv"],
    "org_descriptions": ["governments/lancaster-city/content/org_descriptions.csv"],
    "org_structure": ["governments/lancaster-city/mapping/org_structure.csv"],
    "org_units": ["governments/lancaster-city/mapping/units.csv"],
    "policy_notes": ["governments/lancaster-city/notes/policy_notes.csv"],
    "sign_corrections": ["governments/lancaster-city/notes/sign_corrections.csv"],
    "staffing_corrections": ["governments/lancaster-city/notes/staffing_corrections.csv"],
    "tax_limit_lines": ["governments/lancaster-city/content/rules/tax_limit_lines.csv"],
    "tax_rates": ["governments/lancaster-city/mapping/tax_rates.csv",
                  "governments/lancaster-county/mapping/tax_rates.csv"],
    "county_account_changes": ["data/county/account_changes.csv"],
    "county_context_facts": ["data/county/context_facts.csv"],
    "county_elected_offices": ["data/county/elected_offices.csv"],
    "county_org_units": ["data/county/org_units.csv"],
}

# Today's JSON configs and the schema that describes each group.
LEGACY_JSON = [
    ("config/*.json", "book"),
    ("config/county/*.json", "book"),
    ("config/county/acfr/*.json", "book"),
    ("config/county/resolutions/*.json", "book"),
]
LEGACY_TAX_LIMIT = "content/rules/tax_limit.yaml"


def yaml_targets() -> list[tuple[Path, str]]:
    """Every portable YAML file that exists, with its schema kind."""
    out = [(govconfig.SITE_FILE, "site")]
    out += [(p, "kind") for p in sorted(govconfig.KINDS_DIR.glob("*.yaml"))]
    for g in sorted(govconfig.GOVERNMENTS_DIR.glob("*/")):
        out.append((g / "government.yaml", "government"))
        out += [(p, "book") for p in sorted((g / "books").glob("*.yaml"))]
        if (g / "content" / "calendar.yaml").exists():
            out.append((g / "content" / "calendar.yaml", "calendar"))
        out += [(p, "tax_limit") for p in sorted((g / "content" / "rules").glob("tax_limit.yaml"))]
        out += [(p, "rule?") for p in sorted((g / "content" / "rules").glob("*.yaml")) if p.name != "tax_limit.yaml"]
    return out


def legacy_targets() -> list[tuple[Path, str]]:
    out = []
    for pattern, kind in LEGACY_JSON:
        out += [(p, kind) for p in sorted(ROOT.glob(pattern)) if p.name != Path(LEGACY_TAX_LIMIT).name]
    if (ROOT / LEGACY_TAX_LIMIT).exists():
        out.append((ROOT / LEGACY_TAX_LIMIT, "tax_limit"))
    return out


def csv_schema_for(path: Path) -> str | None:
    r = rel(path)
    return next((name for name, paths in CSV_FILES.items() if r in paths), None)


def check_csv(path: Path, schema_name: str) -> list[str]:
    """Header and every value of one CSV against schemas/csv/<schema_name>.schema.json."""
    label = rel(path)
    try:
        schema = govconfig.load_schema(f"csv/{schema_name}.schema.json")
    except ConfigError as e:
        return e.problems
    props, required = schema["properties"], schema.get("required", [])
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            rows = list(csv.reader(f))
    except FileNotFoundError:
        return [f"{label}: file not found"]
    except UnicodeDecodeError:
        return [f"{label}: not a UTF-8 text file"]
    if not rows:
        return [f"{label}: the file is empty (it needs at least the header row)"]
    header, out = rows[0], []
    missing = [c for c in required if c not in header]
    unknown = [c for c in header if c not in props]
    if missing:
        out.append(f"{label}, header: missing column{'s' if len(missing) > 1 else ''} "
                   + ", ".join(repr(c) for c in missing))
    if unknown:
        out.append(f"{label}, header: unknown column{'s' if len(unknown) > 1 else ''} "
                   + ", ".join(repr(c) for c in unknown) + f" (allowed: {', '.join(props)})")
    dupes = sorted({c for c in header if header.count(c) > 1})
    if dupes:
        out.append(f"{label}, header: column{'s' if len(dupes) > 1 else ''} listed twice: "
                   + ", ".join(repr(c) for c in dupes))
    if out:
        return out
    from jsonschema import Draft202012Validator
    validators = {c: Draft202012Validator(props[c]) for c in header}
    for n, row in enumerate(rows[1:], start=2):           # n = line number in the file (header is line 1)
        if not any(cell.strip() for cell in row):
            continue                                       # blank line
        if len(row) != len(header):
            out.append(f"{label}, line {n}: has {len(row)} values but the header has {len(header)} columns "
                       f"(check for an unquoted comma)")
            continue
        for c, value in zip(header, row):
            for err in validators[c].iter_errors(value):
                out.append(f"{label}, line {n}, column {c!r}: {govconfig.explain(err)}")
    return out


def guess_kind(path: Path) -> str | None:
    """The schema kind for a file, from its name and folder."""
    if path.suffix == ".csv":
        return "csv"
    name, parent = path.name, path.parent.name
    if name == "site.yaml":
        return "site"
    if "government" in name and path.suffix in (".yaml", ".yml"):
        return "government"
    if parent == "kinds":
        return "kind"
    if name.startswith("calendar"):
        return "calendar"
    if name.startswith("tax_limit"):
        return "tax_limit"
    if parent == "books" or parent in ("county", "acfr", "resolutions", "config"):
        return "book"
    return None


def run_one(path: Path, kind: str | None, csv_schema: str | None) -> list[str]:
    if not path.exists():
        return [f"{rel(path)}: file not found"]
    kind = kind or guess_kind(path)
    if kind == "csv" or path.suffix == ".csv":
        name = csv_schema or csv_schema_for(path)
        if not name:
            return [f"{rel(path)}: no CSV schema is mapped to this file; add --csv-schema NAME "
                    f"(one of: {', '.join(CSV_FILES)})"]
        return check_csv(path, name)
    if kind not in govconfig.SCHEMA_FOR:
        return [f"{rel(path)}: cannot tell which schema checks this file; add --schema "
                f"(one of: {', '.join(govconfig.SCHEMA_FOR)})"]
    return govconfig.check_file(path, kind)[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--file", type=Path, help="check only this file")
    ap.add_argument("--schema", choices=sorted(govconfig.SCHEMA_FOR), help="schema for --file (default: from its name)")
    ap.add_argument("--csv-schema", choices=sorted(CSV_FILES), help="CSV schema for --file")
    ap.add_argument("--list", action="store_true", help="list each file and its schema, then stop")
    a = ap.parse_args()

    if a.file:
        problems = run_one(a.file.resolve(), a.schema, a.csv_schema)
        for p in problems:
            print(p)
        print(f"{rel(a.file)}: {'OK' if not problems else f'{len(problems)} problem(s)'}")
        return 1 if problems else 0

    targets = [(p, k, None) for p, k in yaml_targets() + legacy_targets()]
    targets += [(ROOT / f, "csv", name) for name, files in CSV_FILES.items() for f in files]
    if a.list:
        for p, k, name in targets:
            schema = f"csv/{name}.schema.json" if k == "csv" else govconfig.SCHEMA_FOR.get(k, "?")
            print(f"{rel(p):60} {schema}")
        return 0

    problems, bad_files = [], 0
    for p, k, name in targets:
        if k == "rule?":
            got = [f"{rel(p)}: no schema for this rule file yet (only tax_limit.yaml has one)"]
        else:
            got = run_one(p, k, name)
        if got:
            bad_files += 1
            problems += got
    for line in problems:
        print(line)
    if problems:
        print(f"{len(problems)} problem(s) in {bad_files} of {len(targets)} files")
        return 1
    print(f"OK: {len(targets)} files valid "
          f"({sum(1 for _, k, _ in targets if k == 'csv')} CSVs, {sum(1 for _, k, _ in targets if k != 'csv')} YAML/JSON)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
