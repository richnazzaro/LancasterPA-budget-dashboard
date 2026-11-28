# Portable budget engine: plan

**Goal (owner, 2026-11-28).** Drop a budget PDF into a folder and get the dashboard for any **City, County or School District**. People edit only YAML/JSON files and check CSVs; no code changes per government or per year. The owner runs the process himself to validate it; Hermes builds, tests and documents it.

- Branch / worktree: `feature/portable-engine` in `Lancaster Dashboard - portable`, from `origin/main` `6693955`.
- Vault spec: `Wiki/Features/portable-engine.md` (decisions, audit, design). This file is the working plan and the hand-off point.
- Baseline inventory of hardcoded values: [`baseline-inventory.csv`](baseline-inventory.csv) (531 code lines at `6693955`; regenerate with `scripts/check_portable.py` once Phase 0 lands).

---

## Status (update this table at the end of every work session)

| Phase | Status | Last commit | Next action |
|---|---|---|---|
| 0 Contracts | Not started | plan committed locally | 0.1 requirements + CI install step |
| 1 City into its folder | Not started | — | — |
| 2 County into its folder | Not started | — | — |
| 3 Website reads the manifest | Not started | — | — |
| 4 Read / Detect / Review tools | Not started | — | — |
| 5 Pilot: School District of Lancaster (owner runs it) | Not started | — | — |
| 6 Docs and hand-over | Not started | — | — |

**Done so far (2026-11-28):** worktree created; PyYAML 6.0.4 and jsonschema 4.26.0 installed in the main checkout's `.venv` (not yet in `requirements.txt`); baseline inventory written; School District of Lancaster sources checked (below); this plan.

---

## Owner decisions (2026-11-28)

1. Government kinds: County, City, School District.
2. One site. The government switch lists only governments with data; with one government there is no switch.
3. City-only features stay in the engine as optional modules, shown when a government uses them.
4. The Home Rule calendar becomes a general **budget calendar** driven by a file.
5. Pilot: **School District of Lancaster**.
6. Top folder name: `governments/`.
7. PyYAML + jsonschema may be added.
8. The owner goes through every step himself to validate it. Every phase ends with an **Owner check** that he runs.
9. **D1:** a July–June year is stored as the year it ends (2027) and shown as "2026–27" (label pattern in `government.yaml`).
10. **D3:** one PR per phase; the owner merges each.
11. **D6:** government ids `lancaster-city`, `lancaster-county`, `sd-lancaster`. Addresses become real paths, **`/city/…`, `/county/…`, `/school/…`**, instead of `#/…` (Phase 3.3). Old `#/` links keep working by redirect.

## Open decisions (ask before the phase that needs them)

| # | Question | Default if not answered | Needed by |
|---|---|---|---|
| D2 | School District tax on the tax estimate page (ruled out 2026-11-27 for City/County scope) | Stays out; revisit after the pilot | Phase 5 |
| D4 | Move source PDFs into `governments/<id>/inbox/` now? | No: Phase 1 points to today's folders via `sources_dir`; moving is optional later (keeps the public `pdfs/` links) | Phase 1 |
| D5 | Content files format | Markdown, a small subset (paragraphs, **bold**, *italic*, links, lists, headings), converted at build time | Phase 3 |

---

## Target design (short form; full spec in the vault)

```
site.yaml                         site title, contact, repo, government order, default government
kinds/{city,county,school_district}.yaml   default vocabulary (governing body, executive, figure names)
schemas/*.schema.json             one per YAML file and one per hand-kept CSV (columns + types)
governments/<id>/
  government.yaml                 name, kind, route, fiscal year, sources_dir, display rules, features
  books/<book>.yaml               per PDF: layout family, columns -> year + figure, page ranges, status
  mapping/  funds.csv (with role), departments.csv, units.csv, categories.csv,
            account_codes.csv, income_rules.csv, income_sources.csv
  notes/    known_issues.csv, line_notes.csv, policy_notes.csv, corrections.csv, context_facts.csv
  content/  about.md, calendar.yaml, glossary.yaml, rules/*.yaml (e.g. tax_limit.yaml)
  review/<book>/   generated: pages/NNN.md, words.tsv, headings.csv, checks.csv, index.html
  data/            generated: spending.csv, income.csv, staffing.csv, balance.csv, actuals.csv
engine/ (= today's scripts/, renamed at the end)  read, detect, extractors, build, check, web app
web/data/manifest.json            generated: governments, routes, labels, data paths, features present
```

### Layout families (one extractor each; a new government reuses one)

| Family | Today | Used by |
|---|---|---|
| `lineitem_columns` | `extract_layout.py` + `extract_budget.py` (merge: the 2027 8-column layout becomes a config) | Lancaster City books 2022–2027 |
| `projection_book` | `extract_projections.py` | City 2028–2029 projections |
| `xposition_rows` | `county_rows.py` + `extract_county.py` | Lancaster County books |
| `pde2028` | **new** | Any Pennsylvania school district's PDE-2028 General Fund Budget |
| Supporting pages | `fund_balance.py`, `extract_county_resolutions.py`, `extract_county_acfr.py`, `extract_org_descriptions.py` | balance chain, actuals, org text |

OCR is an option of the Read step (`ocr_pages.py`), not a family.

### Feature modules (shown only when their data exists)

| Module | Shown when | Today |
|---|---|---|
| Reserve / fund balance | `data/balance.csv` has rows | City Reserve Fund, County General Fund Balance |
| Staff and positions | `data/staffing.csv` has rows | City |
| Audited actuals | `data/actuals.csv` has rows | County ACFR |
| Projections | a book with `figure: projection` | City |
| Tax limit test | `content/rules/tax_limit.yaml` | City § 8.08 6% |
| Tax estimate | rows for the government in `tax_rates.csv` | City, County |
| Budget calendar | `content/calendar.yaml` | City Home Rule calendar |
| Context facts | `notes/context_facts.csv` | County |
| Unit descriptions | `mapping/units.csv` has description ids | City org descriptions |
| Income sources | `mapping/income_sources.csv` | City, County |

### Rules for all code (checked by `check_portable.py` in CI from Phase 3)

1. Engine code names no government, year, fund, department, account code or source file.
2. A new feature is a module that reads its own file and shows only when it has data.
3. Reader-facing text lives in `content/`, `kinds/` or mapping CSVs, not in code.
4. Every YAML/CSV the owner edits has a schema; errors name the file, the row/field and what is expected, in plain words.
5. A new PDF layout may need a new family (engine code, once). A new government or year never does.

---

## Cross-phase tools (built in Phase 0, used by every gate)

- **Parity harness** `scripts/parity.py <baseline-dir> <web/data>`: compares every JSON file as parsed data, ignoring `generated`, and sorting the `values` keys in `changes.json` (their order follows `PYTHONHASHSEED`, a known non-issue). The baseline is a snapshot of `web/data/` at `6693955`, saved outside the repo in the scratch dir and also reproducible with `git show 6693955:web/data/...`.
- **Processed-CSV parity**: re-run extraction for every book and diff `data/processed/*.csv` against `6693955` (sorted rows).
- **Screenshot baseline** (Phase 3): every route, 1440 and 375, light and dark, from the live site before Phase 3 starts.
- **`check_portable.py`**: the inventory above as a check, with a reviewed allowlist `config/portable_allowlist.csv` (file, pattern, reason). Report-only until Phase 3, then a CI failure.

---

## Phase 0: Contracts (no change to the site)

**Goal:** the file formats exist, validate, and describe Lancaster City and County as they are today.

| Step | Work | Files |
|---|---|---|
| 0.1 | Pin `PyYAML==6.0.4`, `jsonschema==4.26.0` in `requirements.txt`; add `requirements-build.txt` (just those two) and a `pip install -r requirements-build.txt` step to `pages.yml` (the build is stdlib-only today, so CI installs nothing). **The owner's main checkout has uncommitted `pages.yml` edits: compare before touching it.** | requirements*.txt, .github/workflows/pages.yml |
| 0.2 | Schemas for `site.yaml`, `government.yaml`, `kinds/*.yaml`, `books/*.yaml`, `calendar.yaml`, `rules/tax_limit.yaml`, and one per hand-kept CSV (required columns, types, allowed values) | schemas/ |
| 0.3 | Loader `scripts/govconfig.py`: `load_site()`, `load_government(id)`, `book_config(gov, pdf)`, path resolution (`sources_dir`, `mapping/`, `notes/`), plain error messages | scripts/govconfig.py |
| 0.4 | `scripts/validate_config.py`: validates every YAML and CSV; exit 1 with readable messages | scripts/ |
| 0.5 | Hand-write `site.yaml`, `governments/lancaster-city/government.yaml`, `governments/lancaster-county/government.yaml`, `kinds/*.yaml` from today's `web/config.json` and AGENTS.md rules (figure rules, default fund, features). Not read by the build yet. | governments/, kinds/, site.yaml |
| 0.6 | `scripts/check_portable.py` (report mode) + allowlist; `scripts/parity.py`; snapshot the baseline | scripts/, config/ |
| 0.7 | `scripts/docs_config.py` generates `docs/portable/CONFIG.md` (every field: meaning, type, example) from the schemas | docs/portable/CONFIG.md |

**Gate:** `validate_config.py` passes; a broken field gives a message naming file + field; `check_dataset.py` and `--entity county` 0 series mismatches; `parity.py` shows `web/data` unchanged.

**Owner check (≈15 min):** open `governments/lancaster-city/government.yaml` and read it against the live site; run `python scripts/validate_config.py`; change `kind: city` to `kind: town` and read the error; read `docs/portable/CONFIG.md`.

## Phase 1: Lancaster City into its folder

**Goal:** every City-specific value the City pipeline uses comes from `governments/lancaster-city/`. Output identical.

| Step | Work |
|---|---|
| 1.1 | `git mv` City hand-kept files: `data/income_rules.csv`, `income_sources.csv`, `known_issues.csv`, `line_notes.csv`, `policy_notes.csv`, `ocr_corrections.csv`, `sign_corrections.csv`, `staffing_corrections.csv`, `tax_limit_lines.csv`, `org_*_2027.csv` → `mapping/`/`notes/`/`content/rules/` (org files lose the `_2027` suffix; `as_of: 2027` and the chart/description PDFs go in `government.yaml`). Note: `income_rules.csv` (and `income_sources.csv`, `tax_rates.csv`) hold City and County rows in one file with an `entity`/`government` column; split each per government (the tax estimate page then gathers every government's `tax_rates.csv`). |
| 1.2 | Per-book configs `config/*.json` → `books/*.yaml` (mechanical conversion; `_comment` keys become YAML comments). |
| 1.3 | Merge `extract_budget.py` into the `lineitem_columns` family: its `AMOUNT_COLUMNS`, `FUNDS`, `GENERAL_FUND_DEPARTMENTS`, overrides, `NOTE_FONT_SUFFIXES` and the `count_2027_*` staffing field names come from the 2027 book's YAML. Staffing output switches to long form (`fiscal_year, figure, count, salary`) with a compatibility writer until build reads it. |
| 1.4 | Fund roles: `mapping/funds.csv` (`code_prefix, name, role, paid_by, description`). Replace `"General Fund"` / `"Reserve Fund"` literals in `build_dataset.py`, `check_dataset.py`, `changes.py`, `fund_balance.py`, `extract_projections.py`, `tax_limit.py` with role lookups; replace object `499000` with the `draw` class already in `income_rules.csv`. |
| 1.5 | `ingest.py`, `build_dataset.py`, `check_dataset.py` take `--gov lancaster-city` (default from `site.yaml`), read paths from the loader. |

**Gate:** processed-CSV parity for all 7 City books; `parity.py` equal for `budget.json`, `changes.json`, `staffing.json`, `positions.json`, `tax_rates.json`; `check_dataset.py` 0 mismatches; `check_portable.py` shows no City literals left in the touched scripts (or each is allowlisted with a reason).

**Owner check (≈30 min):** run the four City commands from the new paths (`ingest --gov lancaster-city --all`, build, check, preview); open `mapping/funds.csv` and `books/2027-….yaml` and confirm they say what the book prints; change a fund's `description` and see it in `budget.json`.

## Phase 2: Lancaster County into its folder

**Goal:** same as Phase 1 for County; one build and one check for every government.

| Step | Work |
|---|---|
| 2.1 | `config/county/*.json`, `acfr/*.json`, `resolutions/*.json` → `governments/lancaster-county/books/` (ACFR and resolutions as books with their own family). |
| 2.2 | `data/county/*` (`account_changes`, `context_facts`, `elected_offices`, `known_issues`, `ocr_corrections`, `org_units`) → `mapping/`, `notes/`, `content/`. `FUND_ORDER`, `CHART_DOC/CHART_PAGE`, the description strings in `build_county.py` and `config.json` `fund_names` → `funds.csv` / `government.yaml` / `content/`. |
| 2.3 | Fold `build_county.py` / `check_county.py` into `build_dataset.py` / `check_dataset.py` as modules (actuals, context facts, resolution-based balance). `--entity county` stays as an alias for `--gov lancaster-county`. |
| 2.4 | `pages.yml`: loop over `site.yaml` governments instead of two fixed steps. |

**Gate:** processed-CSV parity for the 3 County books, ACFRs, resolutions; `parity.py` equal for `web/data/county/*`; both checks 0 mismatches; no County literals in the shared scripts.

**Owner check (≈20 min):** run build + check for both governments with one command; read `governments/lancaster-county/mapping/funds.csv`.

## Phase 3: The website reads the manifest

**Goal:** `web/app.js` names no government. The switch, routes, labels, features and text come from generated files. The site looks exactly as it does today.

| Step | Work |
|---|---|
| 3.0 | Screenshot baseline of the live site (every route, 1440/375, light/dark). |
| 3.1 | Build writes `web/data/manifest.json` (site + per government: id, route, label, kind, names, data/pdf paths, fiscal-year label, vocabulary, features present). `web/config.json` becomes generated from `site.yaml` + `government.yaml` (or is replaced by the manifest; same content). |
| 3.2 | Replace each `isCounty()`/`ENT` branch (71 in `app.js`, listed in the inventory) with a feature check, a vocabulary word, or data. `EXPLAIN_FIGURES`, `FUND_INFO`, `FUND_INTRO`, `TAX_WHO`, `CHARTER_PAGE`, `OLD_RULES_PAGE`, the calendar steps, the County about text and the data-center wording move to content/mapping files. |
| 3.3 | Government switch: built from the manifest; hidden when one government has data. **Path addresses (D6):** `/city/`, `/county/`, `/school/`, then the page (`/city/department/<d>/bureau/<b>`, `/county/changes`, `/school/about`…), with `?y=&m=&c=` unchanged. GitHub Pages has no server rewrites, so the build writes a small `index.html` for every address (the route list is finite: home, changes, about, terms, budget-calendar, tax, each department and bureau, per government) and the app switches pages with the History API. Asset, data and PDF paths become root-absolute (`/styles.css`, `/data/…`, `/pdfs/…`) because a page at `/city/department/x/` would resolve relative paths wrongly. `/` shows the default government (or a chooser; owner decides when the School District arrives). The root page turns every old `#/…` and `#/county/…` link into its new path with `location.replace`, so shared links still open the same view. Gate adds: every generated address returns 200 locally; every old hash route redirects to the matching path. |
| 3.4 | Budget calendar page renders any `calendar.yaml`; the nav item appears only when the current government has one (label from the file). |
| 3.5 | Docs: SITE.md, REFERENCE.md (refresh every line link), README, DESIGN.md; EDITING.md lines listed for the owner. |

**Gate:** screenshot comparison shows no unexplained difference; every route works for City and County; `node --check`; both checks 0; `check_portable.py` passes on `web/` and becomes a CI failure.

**Owner check (≈30 min):** browse both governments; set `features.budget_calendar: off` in `government.yaml`, rebuild, see the page and nav item go; edit `content/about.md` and see it on the About page.

## Phase 4: Read / Detect / Review tools

**Goal:** a new PDF goes from inbox to a reviewed config with as little typing as possible, and the reviewer can see what the script understood.

| Step | Work |
|---|---|
| 4.1 | `scripts/budget.py` CLI with subcommands `read, detect, review, parse, build, check, preview` (`ingest.py` stays as a wrapper). |
| 4.2 | **read**: text layer or OCR (existing detection in `ingest.py` + `ocr_pages.py`); writes `review/<book>/pages/NNN.md` (readable) and `words.tsv` (word, x0, x1, top, bottom, font, size, page). |
| 4.3 | **detect**: page kinds (line items, summary, staffing, balance, narrative); column headers → year + figure (generalise `ingest.py`'s header inference); account-code pattern (most common leading token shapes); headings (font, caps, position, a `TOTAL - X` that closes them) → `headings.csv` with page, guessed role and confidence; government name, kind and budget year from the cover/title lines; layout family by matching each family's signature. Writes `books/<book>.yaml` with `status: draft` and appends unknown codes to mapping CSVs with `status: review`. |
| 4.4 | **review**: writes `review/<book>/index.html`: summary (what was found, what needs a decision), then per page the rendered PDF page beside the parsed rows, each row's fund/department/category, unmatched lines and failed totals highlighted, and the exact file + row to edit. Read-only: all edits go in YAML/CSV. |
| 4.5 | **parse**: runs the family's extractor; writes `data/*.csv` and `review/<book>/checks.csv`; refuses a `status: draft` book. |

**Gate:** detect re-run on every Lancaster City and County book from scratch, compared with the reviewed configs: report the share of columns, page ranges, funds and departments found unaided. No accuracy target is promised in advance; the report decides how much review the onboarding guide must ask for.

**Owner check (≈1 hr):** copy one City PDF into a scratch government `governments/replay-city/`, run read → detect → review, read the review page, fix the draft, parse, compare with the real City data.

## Phase 5: Pilot, School District of Lancaster (the owner runs it)

**Goal:** onboard a third government by editing only YAML/CSV. The owner does every step from the guide; Hermes fixes engine problems found on the way, and every fix is generic (no School District names in code; `check_portable` enforces it).

**Sources (checked 2026-11-28):**
- The district publishes its budget on the state's uniform form **PDE-2028** ("Final General Fund Budget"). pa.gov hosts every year: `https://www.pa.gov/content/dam/copapwp-pagov/en/education/documents/schools/grants-and-funding/school-finances/finances/gfbdata/<YYYY-YY>/<YYYY-YY>%20gfb%20lancaster%20sd.pdf`. 2022-23 through 2026-27 all return HTTP 200 (PDF).
- The district's own copies (sdlancaster.org "Past Budgets") returned 403 to a script, and its "Budget 2026-2027" link points to the 2025 ACFR, so use the pa.gov copies.
- The 2026-27 form (31 pages, text layer, LEA 113364002, printed 7/7/2026): revenue summary p5 and detail pp6–7 (codes 6000 local, 7000 state, 8000 federal, 9000 other financing; 4-digit detail lines); real estate tax pages pp8–12; expenditure summary p13 and detail pp14–17 (function 1000/1100/… × object 100–800, with a printed "Total <function>" per block); cash, debt and juvenile pages pp18–30; Fund Balance Summary p31. One amount column: the budget year only. Total estimated revenues and other financing sources $301,400,000 (p5).

**What this means for the engine:**
- New family `pde2028` (one extractor for every Pennsylvania school district).
- Figures: each form prints only its own year, so trends use one "Budget" figure per year (like County). Actuals would come later from audited reports.
- General Fund only; no staffing schedule (Staff module stays hidden); the Fund Balance Summary feeds the Reserve module.
- July–June fiscal year (decision D1).
- Departments ≈ functions (1000 Instruction, 2000 Support Services…), categories ≈ objects (100 Salaries, 200 Benefits…). The owner decides that mapping in `mapping/` during review.

**Hermes prepares (before the owner starts):** the `pde2028` family; `kinds/school_district.yaml`; a template `government.yaml`; the guide's School District page.

**Owner runs:** create `governments/sd-lancaster/government.yaml` from the template → download the five PDE-2028 PDFs into its `inbox/` → read → detect → review → fix YAML/CSV → parse → read `checks.csv` (every function total and the revenue total must tie, $5 per cell) → build → preview → decide what the switch and pages say.

**Gate:** zero engine edits that name the district; both existing governments still at parity; owner sign-off.

## Phase 6: Docs and hand-over

- `docs/portable/ONBOARDING.md`: the process diagram, then one section per step with the command, what you see (screenshots from the owner's Phase 5 run), what to check, what to edit, and common failures.
- `docs/portable/CONFIG.md`: generated from the schemas (Phase 0.7), regenerated in CI so it cannot go stale.
- Update README, PIPELINE, REBUILD, SITE, REFERENCE, DESIGN; vault notes (`portable-engine`, `budget-pdf-onboarding`, `engine-architecture`, `project-overview`); AGENTS.md lines for the owner to paste.
- Rename `scripts/` → `engine/` only if the owner wants it (many docs link to `scripts/`).

---

## Risks

| Risk | How it is handled |
|---|---|
| A refactor quietly changes a number on the live site | Parity harness at every phase; no phase merges without it |
| Auto-detection is wrong on an unfamiliar book | Detect only drafts; nothing parses until a person sets `status: reviewed`; the review page shows every unmatched line |
| A new publisher's layout fits no family | A new family is a one-time engine change, reused by every government with that layout |
| `app.js` (~4,100 lines) is one scope; the Phase 3 change is large | Split into steps 3.2a–e by area (controls, reserve, about, calendar, tax), each screenshot-checked |
| The owner's main checkout is behind and dirty | All work in this worktree; the owner's `pages.yml` edit is compared before Phase 0.1 touches the file |
| Effort | Rough: Phase 0 1–2 days, 1 3–5, 2 3–5, 3 5–8, 4 5–10, 5 3–5 plus the owner's time, 6 2. Estimates, not commitments. |

## How to pick this up

1. Read this file's **Status** table and the vault note `Wiki/Features/portable-engine.md`.
2. `cd "/Users/rich/Coding Workspace/Lancaster Dashboard - portable"`; `git fetch origin`; `git log --oneline -3`; `git status --short`. If `origin/main` moved, merge it in (`git merge --no-edit origin/main`) and rerun the parity harness.
3. Start at the **Next action** in the Status table. Use the main checkout's venv: `"/Users/rich/Coding Workspace/Lancaster Dashboard/.venv/bin/python"`.
4. At the end of a session: update the Status table and "Done so far", add a line to the vault `log.md`, and commit only when the owner has said so.
