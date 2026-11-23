# Data pipeline: budget PDFs to validated data

How the City of Lancaster's budget books become the CSVs in `data/processed/` and the JSON the site reads. For how the site presents the data and how to edit it, see the [README](../README.md).

Run it by hand, about once a year, when a new budget book is published. Paths below are relative to the repository root. To rebuild everything from a fresh clone, step by step, see [REBUILD.md](REBUILD.md).

## Setup
Python 3.9 or newer (tested on 3.9.6; the publish workflow uses 3.12) and, for the scanned books (the City's 2026 book and the County's 2024 book), Tesseract:
```bash
brew install tesseract            # only needed for OCR
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
`build_dataset.py` and `check_dataset.py` use only the standard library, so they run without the venv.

## Running the extraction
One command handles any budget book, scanned or not:

```bash
python scripts/ingest.py "Budget PDFs - City/2026-Adopted-Budget-2026.pdf"
python scripts/ingest.py --all          # every budget PDF in Budget PDFs - City/ (skips the org chart and descriptions)
```

For each PDF, `ingest.py`:
1. **Detects** whether the PDF has a usable text layer (share of pages with text) or needs OCR. OCR runs automatically and is cached.
2. **Loads `config/<pdf name>.json`.** If there isn't one, it **infers** one from the column header rows ("2025 ORIGINAL BUDGET", "RECEIVED YTD 11/14/2025", "2026 PROPOSED", ...) and the staffing header, and writes it. An inferred config must be reviewed: check every column's year and type, the staffing field order, and the fund maps. Delete its `_generated` key and run again.
3. **Extracts and validates** the book, then **cross-checks** it against its neighbours: book B-1's PROPOSED vs this book's ORIGINAL BUDGET, and this book's PROPOSED vs book B+1's.
4. **Prints a short report:** text or OCR, line items, checks passed / acknowledged / unreviewed, and the cross-check match rate.

Exit status: 0 when everything passes or is a reviewed source issue, 1 when a book has unreviewed failures, and 2 when a config was just inferred or a PDF couldn't be processed.

The per-book scripts still work on their own: `scripts/extract_budget.py` (2027 book) and `scripts/extract_layout.py` (all others).

Each book writes these files to `data/processed/`, suffixed with the PDF's name (plus the Fund Balance files below, and `crosscheck_*.csv`):

| File | Contents |
|---|---|
| `budget_long_*.csv` | The main table: one row per account line per column (`fiscal_year, doc_type, fund, department, bureau, account_code, org_code, object_code, account_name, category, amount, source_doc, source_page`). |
| `line_items_*.csv` | One row per account line with all eight amount columns side by side, plus the city's explanatory note for that line. |
| `staffing_*.csv` | One row per budgeted position: title, bargaining unit, FT/PT, count, and salary. |
| `validation_*.csv` | Every printed TOTAL row compared with the sum of the parsed lines. |

A single budget book carries several years. The 2027 book has eight columns: 2025 actual, 2026 adopted, 2026 amended, 2026 year-to-date, 2026 projected, 2026 revised projected, 2027 proposed and 2027 revised proposed. These are told apart by `fiscal_year` and `doc_type`. Its staffing schedule prints two columns, 2027 proposed and 2027 revised.

### The 2027 book's explanatory notes
Under many line items the city prints a short note ("Budget has been moved to the General Fund…"). The notes are set in their own font and overlap the table rows, so `extract_budget.py` separates characters by font, rebuilds the table rows from the rest, and attaches each note to its line as `description`. The note font is `CIDFont+F2` in the 11/16/2026 edition and `Calibri` in the 11/19/2026 edition, which was re-saved through macOS (its table font became `Calibri-Bold`); `NOTE_FONT_SUFFIXES` lists both. A new edition with other font names shows up as section totals that no longer validate: compare the fonts per page with `pdfplumber` and add the new name.

### General Fund reserve ("Fund Balance Projection" page)
`scripts/fund_balance.py` (run automatically by `ingest.py`) extracts the page that carries the General Fund balance from the last closed year-end through the projected and proposed years.
- **`fund_balance_<doc>.csv`:** one row per printed amount, with `scenario` (2027 prints `proposed` and `revised` side by side; other books are `single`), `fiscal_year`, `as_of_date`, `line_type`, `label`, a signed `amount` and `basis`, all as printed. When a book prints the surplus amount on the "(Reduction to Fund Balance)" line instead, `note` says so.
- **`fund_balance_checks_<doc>.csv`:** the chain checks (revenues + expenditures = surplus; beginning + surplus + adjustments = ending) and a report-only comparison with the book's General Fund totals.
- **`fund_balance_crossbook.csv`:** book Y's projected 12/31/(Y-1) balance vs book Y+1's (unaudited) balance for the same date.

### Validation
Each section, department, and fund total and each staffing subtotal printed in the PDF is recomputed from the parsed rows. Differences of up to $5 are allowed for the city's cent rounding. The script exits with an error if any check fails, unless that failure is listed in `data/known_issues.csv` with a note explaining the source-document error.

### Other budget books (2022–2026): config-driven extractor
`scripts/extract_budget.py` is hard-wired to the 2027 book's 8 columns. Every other book goes through `scripts/extract_layout.py`, which takes its page layout from `config/<pdf name>.json`:

```bash
python scripts/extract_layout.py "/path/to/Budget PDFs - City/2024-Adopted-Budget.pdf"
```

| Book | Source | Notes |
|---|---|---|
| 2022, 2023, 2024, 2025 | PDF text layer | 2024 splits some departments into a 5-column page plus a separate "2024" page, and some continuation pages have no column header (`layouts`, `inherit_header` in its config) |
| 2026 | OCR (image-only PDF) | needs `brew install tesseract` |

The config holds everything that varies by year:
- **Line-item columns:** a header regex, fiscal year and doc_type for each column, labelled as printed (e.g. `proposed` even in an "Adopted" book).
- **Staffing:** the order of fields in a staffing row.
- **Codes:** the fund and department code maps.
- **Text layer:** a glyph map for unmapped characters.

A page whose header matches no configured layout stops the run.

**OCR** (`"source": "ocr"`): `scripts/ocr_pages.py` renders each page at 300 DPI, turns it upright using Tesseract's orientation detection, erases table rules, and caches word boxes in `data/ocr_cache/` (git-ignored, keyed by the PDF's hash).

**Checks** are the same as for 2027: every printed section TOTAL in every column, roll-ups, staffing subtotals, and duplicate pages.
- An amount that can't be read cleanly fails the run until a person fixes it in `data/ocr_corrections.csv`, with evidence. Flagged cells are listed in `ocr_cells_<doc>.csv`.
- **Missing minus signs:** the city prints some negative actuals without a sign, but the printed TOTAL counts them as negative. `scripts/sign_corrections.py <doc> --append` flips a value only when the total proves it: the lines exceed the total by exactly 2× that one line (or 2× one unique pair). Each flip is logged in `data/sign_corrections.csv` with the printed total, line sum and gap. The printed value stays in the line_items `as_printed` column.
- **Staffing values proven wrong by a subtotal** (e.g. a clipped leading digit) are corrected through `data/staffing_corrections.csv`, again with the printed value, the subtotal evidence and any alternative that was ruled out. The staffing output keeps the original in `as_printed`.
- `scripts/review_failures.py <doc>` drafts `known_issues.csv` rows for the failures that remain. It spells out the arithmetic, for example "the gap is exactly twice line X": the city prints some negative amounts without a sign. A person reads the drafts before appending them.

**Cross-book check:** `scripts/crosscheck.py` compares book B's "B PROPOSED" with book B+1's "B ORIGINAL BUDGET", account by account. It writes `crosscheck_*.csv`, which separates adoption changes from possible misreads. Add `--loose` for figures that should only be close, such as B-1 PROJECTED vs the next book's B-1 ACTUAL.

`scripts/budget_common.py` holds the parts both extractors share.

## Lancaster County
The County is a second entity with its own folders: books in `Budget PDFs - County/` (`ACFR/` for the audited reports, `Resolutions/` for the budget resolutions), configs in `config/county/`, extracted CSVs in `data/processed/county/`, reviewed files in `data/county/`, and site data in `web/data/county/`. Source addresses for every PDF are in [REBUILD.md](REBUILD.md#2-get-the-repository-and-set-up-python).

- **Extraction:** `python scripts/ingest.py --county` runs `scripts/extract_county.py` on each book. The County prints split digits (an amount cut into pieces that touch), so `scripts/county_rows.py` rebuilds each amount by position: pieces under 3 pt apart belong together, and each goes to the column header it sits under. The books print each year as a "BUDGET" column; the 2024 book prints the new year first. Checks: department totals, the General Fund and Other Funds grand totals, the by-department and by-account reports, and every department page line by line (2026 book). Outputs per book: `budget_long_*.csv`, `line_items_*.csv`, `validation_*.csv`, and pair-wise `crosscheck_*.csv`.
- **The scanned 2024 book:** OCR at 400 DPI with the page cleaned first (the copy shows the back of each sheet through the paper), settings in the `ocr` block of its config. `data/county/ocr_corrections.csv` holds 177 proven fixes (see REBUILD.md); `scripts/county_ocr_corrections.py` proposes new ones from the printed variance and % change for a person to review.
- **Audited actuals:** `scripts/extract_county_acfr.py` reads the budget-versus-actual schedules and the GAAP fund balances from the annual financial reports. Split amounts are rebuilt by position as above. 677 checks; every tie-out difference with the books is logged in `data/county/known_issues.csv`. The report's own "original budget" column and its variances are never exported, because the original column does not match the adopted budget for 2023 and 2024.
- **Budget resolutions:** `scripts/extract_county_resolutions.py` (run last by `ingest.py --county`) reads the one-page resolution adopted with each budget (`config/county/resolutions/<budget year>.json`: Res 91 of 2023 for 2024, Res 83 of 2024 for 2025, Res 79 of 2025 for 2026). Every printed figure goes to `resolutions_county.csv`, one row per cell, with a `role` (tax_line, tax_total, revenue_line, receipts_total, fb_start, encumbrances, resources_total, expense_line, exp_total, commitments, fb_end, uses_total, millage, assessed_value, tax_increase_pct, footnote), `as_of` for the dated balances, `source_doc` and `source_page`. A row it cannot place stops the run. Column edges come from the right edges of the three amounts on the TOTAL RECEIPTS row; split pieces are joined in x order. 201 checks in `validation_resolutions_county.csv` ($5 rounding): lines to totals, General Fund + Other Funds = Total, start + receipts − expenditures = remaining, planned draw = expenditures − receipts, the General Fund receipts and expenditures against every book's printed Grand Total for the year, and the 2025 book's p3 reprint of Res 83 figure for figure. All pass (largest gap $2).
- **Build and check:** `python3 scripts/build_dataset.py --entity county` (`scripts/build_county.py`) and `python3 scripts/check_dataset.py --entity county` (`scripts/check_county.py`). Same figure rule as the City, with the County's measure called `budget`: each year comes from the newest book that prints it, and every line where two books disagree goes to `conflicts.json`. `account_changes.csv` folds merged accounts into both years for What changed. `org_units.csv` groups departments. `printed` holds every total the books print (department totals, grand totals, the by-account report's account rows and group totals) with its page, shown as printed; a `flags` record appears only where the lines miss a printed total by more than max($5, $0.50 per line) (none today), and a rounding-only gap that `known_issues.csv` explains is linked as a note. The County's `printed` items carry no member lists; the site derives what each covers (kind, fund group, department, account or group), as the build does.
- **Actuals in `budget.json`:** the `actuals` block (measure `actual`, levels fund total, transfer, revenue source, function) is separate from `series`, because these are not account lines. `fund_balance_gaap.json` holds the audited year-end fund balances (modified accrual basis, not comparable with the budget).
- **Context facts (`budget.json` `context`):** `data/county/context_facts.csv` (hand-kept, 32 rows) holds the facts shown in "The 2026 Budget in Context": tax rate, tax increase, assessed value, the rate history 2017–2026, bond rating, funded staffing positions, the Capital Improvement Fund and the agency grants. Each row has the `source_doc` and `source_page` that print it, a `source_kind` (`printed`; `calculated` for the Capital Improvement Fund total, the sum of its two printed parts; `presentation` for the staffing count), `find` (the text that must be on that page) and `also_in` (the presentation slide that repeats it, `file#page`). The rule: cite the primary document (resolution, budget book, audited report), never the presentation, and show only figures that agree. The 2026 budget presentation (`County-2026-Budget-Presentation.pdf`, converted from the County's pptx with LibreOffice; slides are its pages) supplied the list. Its slide 17 splits the ten agency grants into two columns; the General Fund total of $2,560,716 covers only the five in the General Fund column, and the other five ($700,000) are Act 13 funds, as the book's p110 prints. `scripts/verify_county_context.py` (run last by `ingest.py --county`) reads each cited page and confirms the figure is on it, and on the slide that repeats it (`validation_context_county.csv`). `check_county.py` section 9 recomputes the block from the CSV: the grants add to their totals, the General Fund total and the transit line equal Res 79, the tax rate, assessed value and increase equal Res 91, 83 and 79, and every page check passed. The presentation's own proposed-resolution balances ($61,421,407 General Fund balance at 12/31/2026 against Res 79's $64,247,361), fund-balance history and revenue and expense "actuals" are not used.
- **General Fund Balance (`budget.json` `reserve`):** the City's Reserve Fund shape, named "General Fund Balance". Entries with measure `budget` come from `resolutions_county.csv` (General Fund column: beginning, encumbrances, revenues, expenditures and commitments negative, the calculated `surplus` = receipts − expenditures with `calc: true`, ending); entries with measure `actual` are the General Fund rows of `gaap_fund_balance_acfr.csv` (ending, unassigned). `sources` lists each resolution with its URL. A printed line that `known_issues.csv` explains carries `known_issue`. `check_county.py` recomputes every entry from the CSVs, the chain and the tie to the books' Grand Totals, and that Budget entries cite only resolutions and Actual entries only audited reports.
- **Site:** City and County share `web/app.js`; `web/config.json` `entities` selects names, wording, fund names, data path (`data/county/`) and PDF path (`pdfs/county/`). The County has no staffing data, so no Staff section.

## Building the site data
```bash
python3 scripts/build_dataset.py   # data/processed/budget_long_*.csv + fund_balance_*.csv -> web/data/*.json
python3 scripts/check_dataset.py   # every shown figure vs the CSVs, every printed total and gap flag, plus the org structure; must report 0 mismatches
```
`build_dataset.py` writes `budget.json` (every figure shown), `staffing.json`, `changes.json` and `conflicts.json`. It picks **one kind of figure per year**:
- the newest year gets **proposed** and **revised**;
- the year before it gets **projected** (the revised projection when one is printed), from the newest book;
- earlier years get **actual**, from the book two years later.

Adopted, amended and year-to-date columns, and older books' own-year proposals, are never shown. New `budget_long_*.csv` files are picked up automatically. Where overlapping books disagree, the disagreement is logged to `web/data/conflicts.json`. The Reserve Fund block in `budget.json` is built from `fund_balance_*.csv` under the same rule.

**Printed totals** (`budget.json` `printed`, from the `validation_*.csv` files of the designated books, for the figures the site shows). The site shows every total as the city printed it, so each printed section, department roll-up and fund total says which lines it covers:
- `m`: a list of `[fund, bureau, first page, last page]` (indexes into `funds` and `bureaus`; bureau `-1` means every line of the fund) and `kind` (`revenue`/`expense`). A section covers its own lines (its label, from the page after the previous section with that label up to its TOTAL). The last fund roll-up of a fund and kind in a book covers the whole fund. Other roll-ups cover the run of preceding sections that best re-adds to every printed column (fewest columns off, then the smallest gap), so one bad year-to-date column does not pick the wrong run.
- `values` (as printed), `sum` and `n` (our sum of the shown lines it covers, and how many), `flag` (the figures whose gap is more than rounding: $5 for a section, $0.50 per line for a roll-up), and `issue` (index into `known_issues` of the reviewed note for that book, page and label).
- The site (`totalOf()` in `app.js`) shows the printed value whenever the lines in view are exactly a printed total's lines; otherwise its own sum, labelled "calculated". `missing_bureaus` lists bureaus a book omits entirely (`[{name, org, fund}]`, from the known-issue notes) so calculated totals that cannot be complete say so.
- `check_dataset.py` re-reads each printed value from the validation CSV, re-adds `sum`/`n` from `budget_long` and re-derives every flag, then matches every total the site can display to the printed total that covers exactly its lines and lists every flag that shows.

### Positions (`staffing.json`)
One entry per staffing schedule: each book's own-year schedule (2022–2026, `measure: "budgeted"`) and the newest book's two schedules (`"proposed"` and `"revised"`). Each position row is `[unit, title, ft_pt, org_code, object_code, count, salary, page]`; `unit` and `title` index the `units` and `titles` lists. The city publishes budgeted positions only, so there is no Actual for positions. The site's Staff section places each position in an org-chart bureau by its org code, the same way as the budget lines. Its salary table does not use `staffing.json`: it sums the "Salaries & Wages" budget lines from `budget.json` under the one-figure rule.

### Org structure (2027 org chart)
`build_dataset.py` also adds an `org` block to `budget.json` (via `scripts/org_structure.py`, stdlib only). The site groups lines into departments and bureaus from it, not from the printed `department`/`bureau` columns. It is built from three committed CSVs:

| File | One row per | Edited by |
|---|---|---|
| `data/org_units_2027.csv` | department (`unit` empty, `kind=department`) and unit. `kind`: `bureau` (on the chart; gets a page), `department-wide` (budget groups that are not a bureau), `whole-department` (the single unit of a department with no bureaus). Also `division`, `chart_page`, `descriptions` (ids from the descriptions CSV, `;`-separated, optionally `id[2-3]` for a paragraph range), `aliases` (old department URL slugs) and `notes` | hand |
| `data/org_structure_2027.csv` | budget org code (first part of `account_code`): `department`, `unit`, the printed department and group names by year, and `notes` with the evidence for each mapping | hand |
| `data/org_descriptions_2027.csv` | heading in `Org Descriptions 2027.pdf`: `id`, `level`, `parent`, `heading`, `source_page`, `text` (blank line = paragraph, `• ` = bullet, `### ` = printed subheading) | `python scripts/extract_org_descriptions.py` (pdfplumber; wording kept as printed, only wrapped lines and line-end hyphens joined) |

The build stops if an org code in `budget.json` has no row in `org_structure_2027.csv`, a row names a unit that is not in `org_units_2027.csv`, or a description reference does not exist. When a new budget book adds an org code, add a row (older codes map to their best-matching 2027 unit, with a note). `check_dataset.py` then verifies that every shown line maps to a unit, that the mapping in `budget.json` equals the CSV, that for every year, figure and revenue/expense the bureau totals of each department add up to the department total and the departments add up to the series total, and that departments without bureaus have exactly one unit.

`build_dataset.py` also writes `web/data/changes.json` (via `scripts/changes.py`, stdlib only) for the "What changed" page: the newest year's Revised and Proposed compared with the prior year's Projected and the latest Actual, and Revised with Proposed. It holds every changed line, totals by fund, category, department and bureau, shifts between funds detected from the city's line notes in `line_items_<newest book>.csv` (plus the matching zero-outs, new orgs, and direct-bill reimbursements), position counts per bureau from the `staffing_*.csv` files (raw and adjusted, with every artifact listed: missing schedules from `known_issues.csv`, full-/part-time relabels, org-code moves, misprinted org codes, renamed titles, positions moved with a shift), and the tax-policy notes in `data/policy_notes.csv`. `check_dataset.py` ties every total in it to the series, checks each changed line against its series line, re-adds each shift from the series, checks position counts against the staffing CSVs, and prints the shifts, artifacts and policy notes.

`ingest.py --all` skips the org chart and descriptions PDFs (file names matching "Org Chart" / "Org Descriptions"); naming one of them explicitly is an error.

Each figure keeps its `source_doc` and `source_page`, which the site turns into a link to `pdfs/<book>.pdf#page=N`. `web/pdfs` is a symlink to `Budget PDFs - City/`.

The publish workflow (`.github/workflows/pages.yml`) runs the build and check for the City and for the County on every push to `main`, then publishes `web/` with the PDFs copied in.

## Adding a new budget book
1. Put the PDF in `Budget PDFs - City/`. Keep it under GitHub's 100 MB file limit (compress it if needed).
2. Run `python scripts/ingest.py "Budget PDFs - City/<file>.pdf"`. If it infers a config (exit status 2), review `config/<file>.json`, delete its `_generated` key and run again.
3. Clear every unreviewed failure (exit status 1). Either fix the parsing, or add a reviewed source error to `data/known_issues.csv`, with evidence. Never widen the tolerance.
4. Run `build_dataset.py` and `check_dataset.py`. The new year becomes Proposed/Revised, and the earlier years move forward automatically.
   If the build stops on an unmapped org code, add it to `data/org_structure_2027.csv` (see "Org structure" above). When the city publishes a new org chart or descriptions, add the PDFs, rerun `scripts/extract_org_descriptions.py` (pointing `--pdf`/`--out` at the new edition) and review the unit and code tables.
5. Commit the PDF, the config, `data/processed/` and `web/data/`, then push to `main`.

To replace a book with an amended edition (as the 11/19/2026 2027 book replaced the 11/16 one), see [REBUILD.md](REBUILD.md#an-amended-edition-of-the-current-book).
