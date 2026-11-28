#!/usr/bin/env python3
"""Write docs/portable/CONFIG.md from the JSON Schemas in schemas/ (docs/portable/PLAN.md step 0.7).

For every configuration file and hand-kept CSV: a short introduction (the schema's description), then a table
field | type | required | meaning | example. The text comes only from the schemas, so edit a schema's
`description`/`examples` and rerun this script; never edit CONFIG.md by hand.

Usage: python scripts/docs_config.py [--out docs/portable/CONFIG.md] [--check]
  --check   do not write; exit 1 if CONFIG.md is out of date with the schemas
Standard library only, but run it with the project venv: the CSV-to-file table comes from
scripts/validate_config.py, which needs PyYAML and jsonschema (without them the CSV sections list no file paths).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "schemas"
OUT = ROOT / "docs" / "portable" / "CONFIG.md"

# Configuration files in reading order: (schema file, who edits it).
FILES = [
    ("site.schema.json", "the site owner"),
    ("government.schema.json", "whoever onboards the government"),
    ("kind.schema.json", "rarely edited; shared by every government of the kind"),
    ("book.schema.json", "the reviewer of each new PDF (drafted by the detect step from Phase 4)"),
    ("calendar.schema.json", "whoever writes the government's budget calendar from its own documents"),
    ("tax_limit.schema.json", "whoever sets up a legal tax limit test"),
]


def csv_map() -> dict[str, list[str]]:
    """CSV schema name -> today's file(s), from scripts/validate_config.py (the one place that maps them)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from validate_config import CSV_FILES
    except SystemExit:           # PyYAML/jsonschema missing: fall back to the schema list only
        return {p.name.removesuffix(".schema.json"): [] for p in sorted((SCHEMAS / "csv").glob("*.schema.json"))}
    return CSV_FILES


def cell(text) -> str:
    s = str(text).replace("\n", " ").replace("|", "\\|")
    return s


def prose(text) -> str:
    """Plain text for Markdown: < and > escaped so a path like governments/<id>/ is not read as an HTML tag."""
    return str(text).replace("<", "&lt;").replace(">", "&gt;")


def example(prop: dict) -> str:
    ex = prop.get("examples")
    if not ex:
        return ""
    v = ex[0]
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    if len(s) > 70:
        s = s[:67] + "..."
    return f"`{s.replace('`', '')}`" if s else "(empty)"


def type_words(prop: dict, root: dict) -> str:
    prop = resolve(prop, root)
    if prop.get("x-type"):
        words = prop["x-type"]
        if prop.get("enum"):
            words += ": " + ", ".join("(empty)" if e == "" else f"`{e}`" for e in prop["enum"])
        return words
    if "enum" in prop:
        return "one of: " + ", ".join("(empty)" if e is None else f"`{e}`" for e in prop["enum"])
    if "oneOf" in prop or "anyOf" in prop:
        alts = prop.get("oneOf") or prop.get("anyOf")
        return " or ".join(type_words(a, root) for a in alts)
    t = prop.get("type")
    names = {"string": "text", "integer": "whole number", "number": "number", "boolean": "true/false",
             "array": "list", "object": "group of fields", "null": "empty"}
    if isinstance(t, list):
        return " or ".join(names.get(x, x) for x in t)
    if t == "array":
        items = resolve(prop.get("items", {}), root)
        inner = type_words(items, root) if items else ""
        return f"list of {inner}" if inner and inner != "group of fields" else "list"
    if t == "object" and "additionalProperties" in prop and isinstance(prop["additionalProperties"], dict) \
            and not prop.get("properties"):
        return "map of name → " + type_words(prop["additionalProperties"], root)
    return names.get(t, "any")


def resolve(prop: dict, root: dict) -> dict:
    ref = prop.get("$ref")
    if not ref:
        return prop
    node = root
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    merged = dict(node)
    merged.update({k: v for k, v in prop.items() if k != "$ref"})
    return merged


def rows(schema: dict, root: dict, prefix: str = "", required: list | None = None) -> list[list[str]]:
    """Table rows for every documented field, walking into nested groups, lists of groups and maps."""
    out = []
    schema = resolve(schema, root)
    required = schema.get("required", []) if required is None else required
    for name, prop in schema.get("properties", {}).items():
        prop = resolve(prop, root)
        path = f"{prefix}{name}"
        req = "yes" if name in required else "no"
        out.append([f"`{path}`", prose(type_words(prop, root)), req, prose(prop.get("description", "")), example(prop)])
        out += children(prop, root, path)
    return out


def children(prop: dict, root: dict, path: str) -> list[list[str]]:
    if prop.get("type") == "object" and prop.get("properties"):
        return rows(prop, root, path + ".")
    if prop.get("type") == "array":
        items = resolve(prop.get("items", {}), root)
        if items.get("properties"):
            return rows(items, root, path + "[].")
    ap = prop.get("additionalProperties")
    if isinstance(ap, dict):
        ap = resolve(ap, root)
        if ap.get("properties"):
            return rows(ap, root, path + ".<name>.")
    return []


def csv_rows(schema: dict) -> list[list[str]]:
    out = []
    for name, prop in schema["properties"].items():
        if name not in schema.get("required", []):
            req = "optional column"
        elif prop.get("minLength") or (prop.get("enum") and "" not in prop["enum"]):
            req = "yes"
        else:
            req = "column yes, value may be empty"
        out.append([f"`{name}`", prose(type_words(prop, schema)), req, prose(prop.get("description", "")), example(prop)])
    return out


def table(body: list[list[str]]) -> str:
    lines = ["| Field | Type | Required | Meaning | Example |", "|---|---|---|---|---|"]
    lines += ["| " + " | ".join(cell(c) for c in r) + " |" for r in body]
    return "\n".join(lines)


def anchor(title: str) -> str:
    keep = "".join(ch for ch in title.lower() if ch.isalnum() or ch in " -_")
    return keep.strip().replace(" ", "-")


def build() -> str:
    parts = [
        "# Configuration reference",
        "",
        "Generated by `scripts/docs_config.py` from the JSON Schemas in `schemas/`. Do not edit by hand: change a "
        "schema's `description` or `examples` and run `python scripts/docs_config.py`.",
        "",
        "Check every file with `python scripts/validate_config.py`. A problem is reported as one line naming the file, "
        "the field (or the CSV line and column) and what was expected.",
        "",
        "How to read the tables: a field written `a.b` sits inside `a`; `a[].b` is a field of each item in the list "
        "`a`; `a.<name>.b` is a field of each named entry in `a`. Keys starting with `_` are comments where a "
        "schema allows them. In YAML, write `on`, `off`, `yes` and `no` in quotes (`\"off\"`): bare, YAML reads them "
        "as true/false.",
        "",
        "## Contents",
        "",
    ]
    schemas = [(f, json.loads((SCHEMAS / f).read_text(encoding="utf-8")), who) for f, who in FILES]
    csvs = csv_map()
    csv_schemas = [(n, json.loads((SCHEMAS / "csv" / f"{n}.schema.json").read_text(encoding="utf-8")), paths)
                   for n, paths in csvs.items()]
    for f, s, _ in schemas:
        parts.append(f"- [`{s['title']}`](#{anchor(s['title'])})")
    parts.append("- [Hand-kept CSV files](#hand-kept-csv-files)")
    for n, s, _ in csv_schemas:
        parts.append(f"  - [{prose(s['title'])}](#{anchor(s['title'])})")
    for f, s, who in schemas:
        parts += ["", f"## `{s['title']}`", "", prose(s.get("description", "")), "",
                  f"Schema: `schemas/{f}`. Edited by: {who}.", "", table(rows(s, s))]
    parts += ["", "## Hand-kept CSV files", "",
              "Each CSV has a header row. The tables list its columns; a value's form (whole number, page number, "
              "account code, one of a list) is checked on every line. Phase 0 checks the files where they are "
              "today; Phases 1 and 2 move them into `governments/<id>/mapping/`, `notes/` and `content/`."]
    for n, s, paths in csv_schemas:
        where = ", ".join(f"`{p}`" for p in paths) or "(not mapped)"
        parts += ["", f"### {prose(s['title'])}", "", prose(s.get("description", "")), "",
                  f"Schema: `schemas/csv/{n}.schema.json`. Today's file(s): {where}.", "", table(csv_rows(s))]
    return "\n".join(parts) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate docs/portable/CONFIG.md from schemas/.")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true", help="exit 1 if the file is out of date; do not write")
    a = ap.parse_args()
    text = build()
    if a.check:
        current = a.out.read_text(encoding="utf-8") if a.out.exists() else ""
        if current != text:
            print(f"{a.out} is out of date: run python scripts/docs_config.py")
            return 1
        print(f"{a.out} is up to date")
        return 0
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(text, encoding="utf-8")
    print(f"Wrote {a.out} ({len(FILES)} configuration files, {len(csv_map())} CSV schemas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
