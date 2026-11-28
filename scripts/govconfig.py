#!/usr/bin/env python3
"""Load and check the portable configuration files (Phase 0 of docs/portable/PLAN.md).

The files:
  site.yaml                                   the whole site (schemas/site.schema.json)
  kinds/<kind>.yaml                           default words for a city, county or school district (kind.schema.json)
  governments/<id>/government.yaml            one government (government.schema.json)
  governments/<id>/books/<book>.yaml          how to read one PDF (book.schema.json)
  governments/<id>/content/calendar.yaml      the budget calendar page (calendar.schema.json)
  governments/<id>/content/rules/*.yaml       rules such as the tax limit test (tax_limit.schema.json)

Every file is checked against its JSON Schema when it is loaded. A problem raises ConfigError whose message names the
file, the field and what was expected, in plain words, one line per problem.

Phase 0: only scripts/validate_config.py uses this module; the build and the website do not read these files yet.

Usage from another script:
    import govconfig
    site = govconfig.load_site()
    city = govconfig.load_government("lancaster-city")
    words = govconfig.vocabulary(city)          # kind defaults with the government's own words on top

Needs PyYAML and jsonschema (requirements-build.txt).
"""
from __future__ import annotations

import csv
import json
import copy
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
    from jsonschema import Draft202012Validator
except ImportError as e:  # pragma: no cover - only when the packages are missing
    raise SystemExit(f"govconfig: {e.name} is not installed. Run: pip install -r requirements-build.txt") from e

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS_DIR = ROOT / "schemas"
SITE_FILE = ROOT / "site.yaml"
KINDS_DIR = ROOT / "kinds"
GOVERNMENTS_DIR = ROOT / "governments"

# Which schema checks which file, by the file's place in the folder layout.
SCHEMA_FOR = {
    "site": "site.schema.json",
    "government": "government.schema.json",
    "kind": "kind.schema.json",
    "book": "book.schema.json",
    "calendar": "calendar.schema.json",
    "tax_limit": "tax_limit.schema.json",
}


class ConfigError(Exception):
    """A configuration file is missing, unreadable or does not match its schema.

    `problems` holds one plain-language line per problem; str(error) joins them."""

    def __init__(self, problems):
        if isinstance(problems, str):
            problems = [problems]
        self.problems = list(problems)
        super().__init__("\n".join(self.problems))


# ---------------------------------------------------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------------------------------------------------

def rel(path: Path | str) -> str:
    """A path as shown in messages: relative to the repository when it is inside it."""
    p = Path(path).resolve()
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def gov_dir(gov_id: str) -> Path:
    return GOVERNMENTS_DIR / gov_id


def government_file(gov_id: str) -> Path:
    return gov_dir(gov_id) / "government.yaml"


def books_dir(gov_id: str) -> Path:
    return gov_dir(gov_id) / "books"


def mapping_dir(gov_id: str) -> Path:
    return gov_dir(gov_id) / "mapping"


def notes_dir(gov_id: str) -> Path:
    return gov_dir(gov_id) / "notes"


def content_dir(gov_id: str) -> Path:
    return gov_dir(gov_id) / "content"


def inbox_dir(gov_id: str) -> Path:
    return gov_dir(gov_id) / "inbox"


def review_dir(gov_id: str) -> Path:
    return gov_dir(gov_id) / "review"


def data_dir(gov_id: str) -> Path:
    """Generated per-government CSVs (Phase 1 onwards)."""
    return gov_dir(gov_id) / "data"


def sources_dir(gov: dict | str) -> Path:
    """The folder holding the government's processed PDFs (government.yaml `sources_dir`, relative to the repo)."""
    g = load_government(gov) if isinstance(gov, str) else gov
    return ROOT / g["sources_dir"]


# ---------------------------------------------------------------------------------------------------------------------
# Reading and checking
# ---------------------------------------------------------------------------------------------------------------------

@lru_cache(maxsize=None)
def load_schema(name: str) -> dict:
    """A schema from schemas/ (for example "government.schema.json" or "csv/tax_rates.schema.json")."""
    path = SCHEMAS_DIR / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"{rel(path)}: schema file not found") from None
    except json.JSONDecodeError as e:
        raise ConfigError(f"{rel(path)}: not valid JSON (line {e.lineno}, column {e.colno}: {e.msg})") from None


def read_yaml(path: Path | str):
    """Parse a YAML (or JSON) file, turning syntax errors into a plain ConfigError."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ConfigError(f"{rel(path)}: file not found") from None
    except UnicodeDecodeError:
        raise ConfigError(f"{rel(path)}: not a UTF-8 text file") from None
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark else ""
        what = getattr(e, "problem", None) or str(e).splitlines()[0]
        raise ConfigError(f"{rel(path)}{where}: the file is not valid YAML: {what}") from None


def field_path(parts) -> str:
    """['display', 'figures', 0, 'show'] -> 'display.figures[1].show' (lists counted from 1, as people count)."""
    out = ""
    for p in parts:
        if isinstance(p, int):
            out += f"[{p + 1}]"
        else:
            out += ("." if out else "") + str(p)
    return out


def _show(v) -> str:
    if isinstance(v, str):
        return repr(v)
    if v is None:
        return "nothing (empty)"
    if isinstance(v, bool):
        return f"{str(v).lower()} (a yes/no value)"
    if isinstance(v, (dict, list)):
        s = json.dumps(v, ensure_ascii=False)
        return s if len(s) <= 60 else s[:57] + "..."
    return str(v)


TYPE_WORDS = {"string": "text", "integer": "a whole number", "number": "a number", "boolean": "true or false",
              "array": "a list", "object": "a group of fields", "null": "nothing"}


def _expected_words(schema: dict) -> str:
    """A short plain description of what a field expects, for pattern errors."""
    if schema.get("x-type"):
        return schema["x-type"]
    desc = (schema.get("description") or "").strip()
    first = re.split(r"(?<=[.!?])\s", desc)[0] if desc else ""
    return first[:120] or "the expected form"


def explain(error) -> str:
    """One plain-language sentence for a jsonschema ValidationError (without the file/field prefix)."""
    v, s, kw = error.instance, error.schema, error.validator
    if kw == "enum":
        choices = ", ".join("(empty)" if c == "" else str(c) for c in error.validator_value)
        hint = ""
        if isinstance(v, bool) and {"on", "off"} & set(map(str, error.validator_value)):
            hint = ' (YAML reads a bare on/off/yes/no as true/false: write it in quotes, e.g. "off")'
        return f"{_show(v)} is not allowed; use one of: {choices}{hint}"
    if kw == "required":
        missing = [r for r in error.validator_value if isinstance(v, dict) and r not in v]
        return "missing required field" + ("s " if len(missing) > 1 else " ") + ", ".join(repr(m) for m in missing)
    if kw == "additionalProperties":
        allowed = sorted(s.get("properties", {}))
        extra = sorted(k for k in v if k not in s.get("properties", {})
                       and not any(re.search(p, k) for p in s.get("patternProperties", {})))
        tail = f" (allowed: {', '.join(allowed)})" if allowed and len(allowed) <= 25 else ""
        return "unknown field" + ("s " if len(extra) > 1 else " ") + ", ".join(repr(x) for x in extra) + tail
    if kw == "type":
        want = error.validator_value if isinstance(error.validator_value, list) else [error.validator_value]
        return f"expected {' or '.join(TYPE_WORDS.get(t, t) for t in want)}, got {_show(v)}"
    if kw == "pattern":
        return f"{_show(v)} is not in the expected form: {_expected_words(s)}"
    if kw == "minLength":
        return "must not be empty"
    if kw in ("minimum", "exclusiveMinimum"):
        return f"{_show(v)} is too small (must be {'at least' if kw == 'minimum' else 'more than'} {error.validator_value})"
    if kw in ("maximum", "exclusiveMaximum"):
        return f"{_show(v)} is too large (must be {'at most' if kw == 'maximum' else 'less than'} {error.validator_value})"
    if kw == "minItems":
        return f"needs at least {error.validator_value} item(s)"
    if kw == "maxItems":
        return f"allows at most {error.validator_value} item(s)"
    if kw == "uniqueItems":
        return "lists the same item twice"
    if kw == "minProperties":
        return f"needs at least {error.validator_value} entry"
    if kw == "propertyNames":
        return f"the name {_show(v)} is not allowed here"
    if kw in ("anyOf", "oneOf"):
        reqs = [sub.get("required") for sub in error.validator_value if isinstance(sub, dict)]
        if reqs and all(r and len(r) == 1 for r in reqs):
            return "needs one of the fields " + " or ".join(repr(r[0]) for r in reqs)
        return f"{_show(v)} does not match any of the allowed forms"
    return error.message


def schema_problems(data, schema_name: str, label: str) -> list[str]:
    """Every way `data` breaks the schema, as 'label, field x.y: sentence' lines (sorted by position)."""
    validator = Draft202012Validator(load_schema(schema_name))
    errors = sorted(validator.iter_errors(data), key=lambda e: (list(map(str, e.absolute_path)), e.validator))
    enum_at = {tuple(e.absolute_path) for e in errors if e.validator == "enum"}
    out = []
    for err in errors:
        if err.validator == "type" and tuple(err.absolute_path) in enum_at:
            continue                                   # the enum message already says what is allowed
        where = field_path(err.absolute_path)
        out.append(f"{label}, field {where}: {explain(err)}" if where else f"{label}: {explain(err)}")
    return out


def check_file(path: Path | str, kind: str) -> tuple[Any, list[str]]:
    """Read one YAML/JSON file and check it against the schema for `kind` (a key of SCHEMA_FOR).

    Returns (data, problems); a file that cannot be read gives (None, [its problem])."""
    path = Path(path)
    try:
        data = read_yaml(path)
    except ConfigError as e:
        return None, e.problems
    if data is None:
        return None, [f"{rel(path)}: the file is empty"]
    problems = schema_problems(data, SCHEMA_FOR[kind], rel(path))
    if not problems:
        problems = extra_checks(data, kind, path)
    return data, problems


def extra_checks(data: dict, kind: str, path: Path) -> list[str]:
    """Rules a JSON Schema cannot express (cross-references between fields and files)."""
    out, label = [], rel(path)
    if kind == "government":
        folder = path.parent.name
        if path.parent.parent.resolve() == GOVERNMENTS_DIR.resolve() and data["id"] != folder:
            out.append(f"{label}, field id: {data['id']!r} must match the folder name {folder!r}")
        measures = data["display"]["measures"]
        for i, rule in enumerate(data["display"]["figures"]):
            for j, fig in enumerate(rule["show"]):
                if fig not in measures:
                    out.append(f"{label}, field display.figures[{i + 1}].show[{j + 1}]: {fig!r} is not defined under "
                               f"display.measures (defined: {', '.join(measures)})")
        for j, fig in enumerate(data["display"].get("selectable", {}).get("figures", [])):
            if fig not in measures:
                out.append(f"{label}, field display.selectable.figures[{j + 1}]: {fig!r} is not defined under "
                           f"display.measures")
        for name, m in measures.items():
            if "book_offset" in m and "book" in m:
                out.append(f"{label}, field display.measures.{name}: give book_offset or book, not both")
        if not (KINDS_DIR / f"{data['kind']}.yaml").exists():
            out.append(f"{label}, field kind: there is no kinds/{data['kind']}.yaml for {data['kind']!r}")
    elif kind == "kind":
        if path.parent.resolve() == KINDS_DIR.resolve() and data["kind"] != path.stem:
            out.append(f"{label}, field kind: {data['kind']!r} must match the file name {path.stem!r}")
    elif kind == "site":
        listed = data["governments"]
        if data["default_government"] not in listed:
            out.append(f"{label}, field default_government: {data['default_government']!r} is not in governments "
                       f"({', '.join(listed)})")
        for i, gid in enumerate(listed):
            if not government_file(gid).exists():
                out.append(f"{label}, field governments[{i + 1}]: {gid!r} has no {rel(government_file(gid))}")
    return out


def _load(path: Path, kind: str) -> Any:
    data, problems = check_file(path, kind)
    if problems:
        raise ConfigError(problems)
    return data


# ---------------------------------------------------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------------------------------------------------

def load_site() -> dict:
    """site.yaml, checked."""
    return _load(SITE_FILE, "site")


def list_governments() -> list[str]:
    """Government ids that have a governments/<id>/government.yaml, in site.yaml order, then any others by name."""
    found = sorted(p.parent.name for p in GOVERNMENTS_DIR.glob("*/government.yaml"))
    try:
        order = read_yaml(SITE_FILE).get("governments", [])
    except (ConfigError, AttributeError):
        order = []
    return [g for g in order if g in found] + [g for g in found if g not in order]


def load_kind(kind: str) -> dict:
    """kinds/<kind>.yaml, checked."""
    return _load(KINDS_DIR / f"{kind}.yaml", "kind")


def load_government(gov_id: str) -> dict:
    """governments/<id>/government.yaml, checked."""
    path = government_file(gov_id)
    if not path.exists():
        known = ", ".join(list_governments()) or "none"
        raise ConfigError(f"{rel(path)}: no government {gov_id!r} (governments found: {known})")
    return _load(path, "government")


def vocabulary(gov: dict | str) -> dict:
    """The words for a government: its kind's defaults with its own `vocabulary` on top."""
    g = load_government(gov) if isinstance(gov, str) else gov
    words = dict(load_kind(g["kind"]).get("vocabulary", {}))
    words.update(g.get("vocabulary", {}))
    return words


def figure_label(gov: dict | str, figure: str) -> str:
    """The label a figure is shown under: display.measures, else the kind's default, else the stored name."""
    g = load_government(gov) if isinstance(gov, str) else gov
    m = g["display"]["measures"].get(figure)
    if m and m.get("label"):
        return m["label"]
    return load_kind(g["kind"]).get("figure_labels", {}).get(figure, figure)


def book_config(gov_id: str, pdf_name: str) -> dict | None:
    """governments/<id>/books/<pdf stem>.yaml, checked; None when the book has no YAML yet.

    Phase 0: no book has a YAML file yet (today's configs are config/*.json and config/county/*.json), so this returns
    None for every book."""
    path = books_dir(gov_id) / f"{Path(pdf_name).stem}.yaml"
    if not path.exists():
        return None
    data = _load(path, "book")
    if data["source_doc"] != Path(pdf_name).name:
        raise ConfigError(f"{rel(path)}, field source_doc: {data['source_doc']!r} does not match the PDF "
                          f"{Path(pdf_name).name!r}")
    return normalise_book(data)


def calendar(gov_id: str) -> dict | None:
    """governments/<id>/content/calendar.yaml, checked; None when the government has none."""
    path = content_dir(gov_id) / "calendar.yaml"
    return _load(path, "calendar") if path.exists() else None


def tax_limit(gov_id: str) -> dict | None:
    """governments/<id>/content/rules/tax_limit.yaml, checked; None when the government has none."""
    path = content_dir(gov_id) / "rules" / "tax_limit.yaml"
    return _load(path, "tax_limit") if path.exists() else None


def year_label(gov: dict | str, year: int) -> str:
    """A stored year as the government shows it: 2027 -> '2027', or '2026–27' for a July-June year."""
    g = load_government(gov) if isinstance(gov, str) else gov
    fy = g["fiscal_year"]
    start = year if fy["start_month"] == 1 else year - 1
    return (fy["label"].replace("{end_short}", f"{year % 100:02d}")
            .replace("{end}", str(year)).replace("{start}", str(start)))


# ---------------------------------------------------------------------------------------------------------------------
# One government's files, in one object (Phase 1)
# ---------------------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Gov:
    """A loaded government.yaml and the folders every script reads its files from.

    Paths are absolute; `rel()` turns one into the form shown in messages. Nothing here names a government: a script
    takes a Gov and asks it where its mapping, notes, books, PDFs and generated data live.
    """

    id: str
    data: dict

    def __getitem__(self, key: str):
        return self.data[key]

    def get(self, key: str, default=None):
        return self.data.get(key, default)

    @property
    def name(self) -> str:
        return self.data["name"]

    @property
    def kind(self) -> str:
        return self.data["kind"]

    def path(self, *parts: str) -> Path:
        return gov_dir(self.id).joinpath(*parts)

    @property
    def books(self) -> Path:
        return books_dir(self.id)

    @property
    def mapping(self) -> Path:
        return mapping_dir(self.id)

    @property
    def notes(self) -> Path:
        return notes_dir(self.id)

    @property
    def content(self) -> Path:
        return content_dir(self.id)

    @property
    def inbox(self) -> Path:
        return inbox_dir(self.id)

    @property
    def review(self) -> Path:
        return review_dir(self.id)

    @property
    def sources(self) -> Path:
        """The processed PDFs (government.yaml sources_dir), published at `pdf_path`."""
        return ROOT / self.data["sources_dir"]

    @property
    def processed(self) -> Path:
        """The generated CSVs the build reads (government.yaml processed_dir, default data/processed)."""
        return ROOT / self.data.get("processed_dir", "data/processed")

    @property
    def primary_fund(self) -> str:
        """The government's main fund: the one row of mapping/funds.csv with role primary, else
        government.yaml display.primary_fund. Every script asks here instead of naming the fund."""
        file = self.mapping / "funds.csv"
        if file.exists():
            with file.open(newline="", encoding="utf-8") as f:
                rows = [r for r in csv.DictReader(f) if r["role"] == "primary"]
            if len(rows) != 1:
                raise ConfigError([f"{rel(file)}: exactly one fund must have role primary (found {len(rows)})"])
            return rows[0]["name"]
        return self.data["display"]["primary_fund"]

    @property
    def web_data(self) -> Path:
        """The site's JSON for this government (government.yaml data_path, under web/)."""
        return ROOT / "web" / self.data["data_path"]


@lru_cache(maxsize=None)
def government(gov_id: str) -> Gov:
    """A government by id, checked, with its folders. Raise on an unknown id."""
    data = load_government(gov_id)
    return Gov(id=gov_id, data=data)


def default_government() -> str:
    """site.yaml default_government (the government the opening address shows)."""
    return load_site()["default_government"]


def resolve_government(gov_id) -> Gov:
    """A Gov from an id, an already-loaded Gov, or a plain government.yaml dict; site.yaml's default when None."""
    if isinstance(gov_id, Gov):
        return gov_id
    if isinstance(gov_id, dict):
        return Gov(id=gov_id["id"], data=gov_id)
    return government(gov_id or default_government())


def normalise_book(cfg: dict) -> dict:
    """A book config with `figure` renamed to `doc_type`, the name the extractors use.

    The YAML files call a printed column's kind `figure` (the portable name); the extractors were written when it was
    called `doc_type`. Renaming here keeps one name in the files and one change in the code. Returns a copy.
    """
    out = copy.deepcopy(cfg)
    for columns in [out.get("line_items", {}).get("columns") or []] + \
                   [lay["columns"] for lay in out.get("line_items", {}).get("layouts") or []] + \
                   [out.get("staffing", {}).get("columns") or []] + \
                   [out.get("amount_columns") or []]:
        for col in columns:
            if isinstance(col, dict) and "figure" in col:
                col.setdefault("doc_type", col.pop("figure"))
    return out


def book_files(gov_id: str) -> list[Path]:
    """Every governments/<id>/books/*.yaml, by file name."""
    return sorted(books_dir(gov_id).glob("*.yaml"))


def load_books(gov_id: str) -> dict[str, dict]:
    """Every book of a government: {pdf stem: normalised config}, each checked against book.schema.json.

    A book in governments/<id>/books/ must say which family reads it and whether a person has reviewed it; the legacy
    config/*.json files (County, until Phase 2) do not, so the requirement lives here rather than in the schema."""
    out = {}
    for path in book_files(gov_id):
        cfg = _load(path, "book")
        for field in ("layout_family", "status"):
            if not cfg.get(field):
                raise ConfigError(f"{rel(path)}, field {field}: missing; every book must say which family reads it "
                                  f"(layout_family) and whether a person has checked it (status: draft or reviewed)")
        if Path(cfg["source_doc"]).stem != path.stem:
            raise ConfigError(f"{rel(path)}, field source_doc: {cfg['source_doc']!r} does not match the file name "
                              f"{path.stem + '.yaml'!r} (name the file after the PDF)")
        out[path.stem] = normalise_book(cfg)
    return out
