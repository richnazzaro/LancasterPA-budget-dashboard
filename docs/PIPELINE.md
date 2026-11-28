# Data pipeline: budget PDFs to validated data

How the City of Lancaster's and the County of Lancaster's budget documents become the CSVs in `data/processed/` (County: `data/processed/county/`) and the JSON the site reads. For what each page shows, see [SITE.md](SITE.md); for where to change a setting or label, [REFERENCE.md](REFERENCE.md); the visitor's guide is the [README](../README.md).

Run it by hand, about once a year, when a new budget book (or County resolution or audited report) is published. Paths below are relative to the repository root. To rebuild everything from a fresh clone, step by step, see [REBUILD.md](REBUILD.md).

## Setup
Python 3.12 (also what the publish workflow uses) and, for the scanned books (the City's 2026 book and the County's 2024 book), Tesseract:
```bash
brew install tesseract            # only needed for OCR
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
`build_dataset.py` and `check_dataset.py` use only the standard library; run them with the venv's Python too (the macOS system `python3` is 3.9 and is not supported).

## Running the extraction
One command handles any budget book, scanned or not:

```bash
python scripts/ingest.py "governments/lancaster-city/sources/2026-Adopted-Budget-2026.pdf"
python scripts/ingest.py --all          # every budget PDF in the government's sources folder (skips the org chart and descriptions)
```

For each PDF, `ingest.py`:
1. **Detects** whether the PDF has a usable text layer (share of pages with text) or needs OCR. OCR runs automatically and is cached.
2. **Loads `config/<pdf name>.json`.** If there isn't one, it **infers** one from the column header rows ("2025 ORIGINAL BUDGET", "RECEIVED YTD 11/14/2025", "2026 PROPOSED", ...) and the staffing header, and writes it. An inferred config must be reviewed: check every column's year and type, the staffing field order, and the fund maps. Delete its `_generated` key and run again.
3. **Extracts and validates** the book, then **cross-checks** it against its neighbours: book B-1's PROPOSED vs this book's ORIGINAL BUDGET, and this book's PROPOSED vs book B+1's.
4. **Prints a short report:** text or OCR, line items, checks passed / acknowledged / unreviewed, and the cross-check match rate.

Exit status: 0 when everything passes or is a reviewed source issue, 1 when a book has unreviewed failures, and 2 when a config was just inferred or a PDF couldn't be processed.

`ingest.py` picks the code that reads a book from its YAML: `layout_family: lineitem_columns` with `reading: word_boxes` (the default) → `scripts/extract_layout.py`; `lineitem_columns` with `reading: char_rows` (a book printed from a spreadsheet, such as the 2027 book) → `scripts/extract_budget.py`; `layout_family: projection_book` → `scripts/extract_projections.py`. A book whose family and reading have no reader stops with a message listing the known ones. Each script also runs on its own with a PDF path.

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

### Multi-year projections (`2028-2029-Budget-Projections.pdf`)
The city published projections for 2028 and 2029 with the 2027 budget: 28 pages printed from the 2027 budget workbook, one table per fund (General Fund pp. 1–16, Stormwater 17–18, Sewer 19–21, Water 22–25, Solid Waste & Recycling 26–27) and the assumptions on p. 28. Each row is `<org> <object> <description> <2028 Projection> <2029 Projection>`. `governments/lancaster-city/books/2028-2029-Budget-Projections.yaml` (`"kind": "projection"`) sends it to `scripts/extract_projections.py`, which:
- builds rows from characters in drawing order, as the other extractors do, then orders a row's words left to right (total rows draw their amounts before their label). Total rows are set in the bold font `CIDFont+F1`; line rows in `CIDFont+F2`; there are no overlapping notes;
- places each amount in its column by its x position (the columns are right-aligned), so a row printed with one amount or none keeps its blanks: five lines print no amount in a column (`1810001-404300` Tsfr'd From Utility Funds, both `1000004-499000` Fund Balance Reserve lines, `1409000-923000` Paying Agent Fees, and `56387000-924000` Debt Service - Interest, which prints 0 for 2028 only). Blank cells stay blank in `line_items` and are left out of `budget_long`;
- keeps names as printed ("Treasury Allocaiton");
- writes `line_items_<doc>.csv` (both years side by side), `budget_long_<doc>.csv` (`doc_type` `projection`, `fiscal_year` 2028 and 2029, with `source_doc` and `source_page`), `validation_<doc>.csv` and `projection_assumptions_<doc>.csv` (the p. 28 text, one row per line).

**Checks** ($5 per cell, nothing acknowledged): every section total (expense sections have a heading and a total row with the same label; General Fund revenue categories have only the total) re-added from its lines; the General Fund "Total - Revenue" from its category totals and from its lines; each fund's "Total Revenue" and "Total Expense" from its lines and from its section totals; and each printed "Surplus/(Deficit)" against the printed totals and against the lines. On the 2028–2029 book all 92 checks pass, the largest gap $4.

**Cross-check:** every line is matched by `account_code` (and its order, for a code printed twice) to the 2027 book's Revised column and written to `crosscheck_projection_<doc>_vs_revised_2027_<book>.csv` with `status` `both`, `only_projection` or `only_2027`, so nothing is dropped silently. All 953 projection lines match a 2027 line; 23 lines are only in the 2027 book: the 21 Stormwater Street Cleaning and Trees lines (orgs 56084200 and 560888000, all 0 in the 2027 Revised, since that work moved to the General Fund) and two Solid Waste lines with 2027 Revised amounts that the projections leave out (`56387000-740900` Bad Debt Expense $65,432 and `56387000-829000` Capital Outlay $16,000). One line is renamed (`1601000-611000` "Salary - Deputy Director" in 2027, "Salary - Bureau Chief" in the projections). Every org code is also checked against `governments/lancaster-city/mapping/org_structure.csv` (all map; the run fails if one does not or its fund differs).

### General Fund reserve ("Fund Balance Projection" page)
`scripts/fund_balance.py` (run automatically by `ingest.py`) extracts the page that carries the General Fund balance from the last closed year-end through the projected and proposed years.
- **`fund_balance_<doc>.csv`:** one row per printed amount, with `scenario` (2027 prints `proposed` and `revised` side by side; other books are `single`), `fiscal_year`, `as_of_date`, `line_type`, `label`, a signed `amount` and `basis`, all as printed. When a book prints the surplus amount on the "(Reduction to Fund Balance)" line instead, `note` says so.
- **`fund_balance_checks_<doc>.csv`:** the chain checks (revenues + expenditures = surplus; beginning + surplus + adjustments = ending) and a report-only comparison with the book's General Fund totals.
- **`fund_balance_crossbook.csv`:** book Y's projected 12/31/(Y-1) balance vs book Y+1's (unaudited) balance for the same date.

### Validation
Each section, department, and fund total and each staffing subtotal printed in the PDF is recomputed from the parsed rows. Differences of up to $5 are allowed for the city's cent rounding. The script exits with an error if any check fails, unless that failure is listed in `governments/lancaster-city/notes/known_issues.csv` with a note explaining the source-document error.

### Other budget books (2022–2026): config-driven extractor
A book printed from a spreadsheet (`reading: char_rows`; today the 2027 book) goes through `scripts/extract_budget.py`, which reads its columns, note fonts, staffing pairs and fund maps from the book's YAML. Every other line-item book goes through `scripts/extract_layout.py`, which takes its page layout from `governments/<id>/books/<pdf name>.yaml`:

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
- An amount that can't be read cleanly fails the run until a person fixes it in `governments/lancaster-city/notes/ocr_corrections.csv`, with evidence. Flagged cells are listed in `ocr_cells_<doc>.csv`.
- **Missing minus signs:** the city prints some negative actuals without a sign, but the printed TOTAL counts them as negative. `scripts/sign_corrections.py <doc> --append` flips a value only when the total proves it: the lines exceed the total by exactly 2× that one line (or 2× one unique pair). Each flip is logged in `governments/lancaster-city/notes/sign_corrections.csv` with the printed total, line sum and gap. The printed value stays in the line_items `as_printed` column.
- **Staffing values proven wrong by a subtotal** (e.g. a clipped leading digit) are corrected through `governments/lancaster-city/notes/staffing_corrections.csv`, again with the printed value, the subtotal evidence and any alternative that was ruled out. The staffing output keeps the original in `as_printed`.
- `scripts/review_failures.py <doc>` drafts `known_issues.csv` rows for the failures that remain. It spells out the arithmetic, for example "the gap is exactly twice line X": the city prints some negative amounts without a sign. A person reads the drafts before appending them.

**Cross-book check:** `scripts/crosscheck.py` compares book B's "B PROPOSED" with book B+1's "B ORIGINAL BUDGET", account by account. It writes `crosscheck_*.csv`, which separates adoption changes from possible misreads. Add `--loose` for figures that should only be close, such as B-1 PROJECTED vs the next book's B-1 ACTUAL.

`scripts/budget_common.py` holds the parts both extractors share.

## County of Lancaster
The County is a second entity with its own folders: books in `Budget PDFs - County/` (`ACFR/` for the audited reports, `Resolutions/` for the budget resolutions), configs in `config/county/`, extracted CSVs in `data/processed/county/`, reviewed files in `data/county/`, and site data in `web/data/county/`. Source addresses for every PDF are in [REBUILD.md](REBUILD.md#the-source-pdfs).

- **Extraction:** `python scripts/ingest.py --county` runs `scripts/extract_county.py` on each budget book (a PDF in `Budget PDFs - County/` with a layout config in `config/county/`; the budget presentation has none and is skipped), then the resolutions and the context facts (below). The audited reports are a separate command, `python scripts/extract_county_acfr.py`. The County prints split digits (an amount cut into pieces that touch), so `scripts/county_rows.py` rebuilds each amount by position: pieces under 3 pt apart belong together, and each goes to the column header it sits under. The books print each year as a "BUDGET" column; the 2024 book prints the new year first. Checks: department totals, the General Fund and Other Funds grand totals, the by-department and by-account reports, and every department page line by line (2026 book). Outputs per book: `budget_long_*.csv`, `line_items_*.csv`, `validation_*.csv`, and pair-wise `crosscheck_*.csv`.
- **The scanned 2024 book:** OCR at 400 DPI with the page cleaned first (the copy shows the back of each sheet through the paper), settings in the `ocr` block of its config. `data/county/ocr_corrections.csv` holds 177 proven fixes (see REBUILD.md); `scripts/county_ocr_corrections.py` proposes new ones from the printed variance and % change for a person to review.
- **Audited actuals:** `scripts/extract_county_acfr.py` reads the budget-versus-actual schedules and the GAAP fund balances from the annual financial reports. Split amounts are rebuilt by position as above. 677 checks; every tie-out difference with the books is logged in `data/county/known_issues.csv`. The report's own "original budget" column and its variances are never exported, because the original column does not match the adopted budget for 2023 and 2024.
- **Budget resolutions:** `scripts/extract_county_resolutions.py` (run last by `ingest.py --county`) reads the one-page resolution adopted with each budget (`config/county/resolutions/<budget year>.json`: Res 91 of 2023 for 2024, Res 83 of 2024 for 2025, Res 79 of 2025 for 2026). Every printed figure goes to `resolutions_county.csv`, one row per cell, with a `role` (tax_line, tax_total, revenue_line, receipts_total, fb_start, encumbrances, resources_total, expense_line, exp_total, commitments, fb_end, uses_total, millage, assessed_value, tax_increase_pct, footnote), `as_of` for the dated balances, `source_doc` and `source_page`. A row it cannot place stops the run. Column edges come from the right edges of the three amounts on the TOTAL RECEIPTS row; split pieces are joined in x order. 201 checks in `validation_resolutions_county.csv` ($5 rounding): lines to totals, General Fund + Other Funds = Total, start + receipts − expenditures = remaining, planned draw = expenditures − receipts, the General Fund receipts and expenditures against every book's printed Grand Total for the year, and the 2025 book's p3 reprint of Res 83 figure for figure. All pass (largest gap $2).
- **Build and check:** `python scripts/build_dataset.py --entity county` (`scripts/build_county.py`) and `python scripts/check_dataset.py --entity county` (`scripts/check_county.py`). Same figure rule as the City, with the County's measure called `budget`: each year comes from the newest book that prints it, and every line where two books disagree goes to `conflicts.json`. `account_changes.csv` folds merged accounts into both years for What changed. `org_units.csv` groups departments. `printed` holds every total the books print (department totals, grand totals, the by-account report's account rows and group totals) with its page, shown as printed; a `flags` record appears only where the lines miss a printed total by more than max($5, $0.50 per line) (none today), and a rounding-only gap that `known_issues.csv` explains is linked as a note. The County's `printed` items carry no member lists; the site derives what each covers (kind, fund group, department, account or group), as the build does.
- **Actuals in `budget.json`:** the `actuals` block (measure `actual`, levels fund total, transfer, revenue source, function) is separate from `series`, because these are not account lines. `fund_balance_gaap.json` holds the audited year-end fund balances (modified accrual basis, not comparable with the budget).
- **Context facts (`budget.json` `context`):** `data/county/context_facts.csv` (hand-kept, 34 rows) holds the facts shown in "The 2026 Budget in Context": tax rate, tax increase, assessed value, the rate history 2017–2026, bond rating, funded staffing positions, the Capital Improvement Fund and the agency grants. Each row has the `source_doc` and `source_page` that print it, a `source_kind` (`printed`; `calculated` for the Capital Improvement Fund total, the sum of its two printed parts; `presentation` for the staffing count), `find` (the text that must be on that page) and `also_in` (the presentation slide that repeats it, `file#page`). It also records the 2018 reassessment behind the rate drop (audited report p13; the slide label "0% revenue increase" is presentation-only). The rule: cite the primary document (resolution, budget book, audited report), never the presentation, and show only figures that agree. The 2026 budget presentation (`County-2026-Budget-Presentation.pdf`, converted from the County's pptx with LibreOffice; slides are its pages) supplied the list. Its slide 17 splits the ten agency grants into two columns; the General Fund total of $2,560,716 covers only the five in the General Fund column, and the other five ($700,000) are Act 13 funds, as the book's p110 prints. `scripts/verify_county_context.py` (run last by `ingest.py --county`) reads each cited page and confirms the figure is on it, and on the slide that repeats it (`validation_context_county.csv`). `check_county.py` section 9 recomputes the block from the CSV: the grants add to their totals, the General Fund total and the transit line equal Res 79, the tax rate, assessed value and increase equal Res 91, 83 and 79, and every page check passed. The presentation's own proposed-resolution balances ($61,421,407 General Fund balance at 12/31/2026 against Res 79's $64,247,361), fund-balance history and revenue and expense "actuals" are not used.
- **General Fund Balance (`budget.json` `reserve`):** the City's Reserve Fund shape, named "General Fund Balance". Entries with measure `budget` come from `resolutions_county.csv` (General Fund column: beginning, encumbrances, revenues, expenditures and commitments negative, the calculated `surplus` = receipts − expenditures with `calc: true`, ending); entries with measure `actual` are the General Fund rows of `gaap_fund_balance_acfr.csv` (ending, unassigned). `sources` lists each resolution with its URL. A printed line that `known_issues.csv` explains carries `known_issue`. `check_county.py` recomputes every entry from the CSVs, the chain and the tie to the books' Grand Totals, and that Budget entries cite only resolutions and Actual entries only audited reports.
- **Site:** City and County share `web/app.js`; `web/config.json` `entities` selects names, wording, fund names, data path (`data/county/`) and PDF path (`pdfs/county/`). The County has no staffing data, so no Staff section. What each page shows: [SITE.md](SITE.md); every setting: [REFERENCE.md](REFERENCE.md).

## Building the site data
```bash
python scripts/build_dataset.py   # data/processed/budget_long_*.csv + fund_balance_*.csv -> web/data/*.json
python scripts/check_dataset.py   # every shown figure vs the CSVs, every printed total and gap flag, plus the org structure; must report 0 mismatches
```
`build_dataset.py` writes `budget.json` (every figure shown), `staffing.json`, `changes.json`, `positions.json` and `conflicts.json`. It also writes `tax_rates.json` for the What would you pay? page from the hand-kept `governments/<id>/mapping/tax_rates.csv` (`scripts/tax_rates.py`): one row per government, tax and year (the rate in force before any budget change), each with its source, plus the newest budget's changes from `governments/lancaster-city/notes/policy_notes.csv` as `steps` (a note's `rate_to`, or `change_pct` applied to the year's rate, flagged calculated); a tax with notes for a year but no row carries the year before's rate forward. `check_dataset.py` validates the rows, compares the County's rate with `data/county/context_facts.csv` and each note's `rate_from` with the rate it changes, and fails when the JSON is stale. Update the CSV when a new rate is set (for example the County's 2027 rate on the reassessed values). It picks **one kind of figure per year**:
- the newest year gets **proposed** and **revised**;
- the year before it gets **projected** (the revised projection when one is printed), from the newest book;
- earlier years get **actual**, from the book two years later;
- and every year that a later book reports also gets **one budget figure**: **amended** where the book a year later prints an amended column for it, otherwise **adopted** (`BUDGET_MEASURES`; never both). It is selectable on the site but not drawn on the multi-year charts. `check_dataset.py` checks each year has exactly the expected figures.

Year-to-date columns and older books' own-year proposals are never shown. New `budget_long_*.csv` files are picked up automatically.

**Projections** (`doc_type` `projection`) are not a budget book: `load_books` sets them aside, so they never become the newest year or a series. `budget.json` carries them in a separate `projection` block, used only when every projection year comes after the newest year (two such books stop the build): `series` (`"2028|projection"`, `"2029|projection"`, same shape as the main series and the same `accounts` table, so the org mapping covers them), `printed` (each section and fund total, same shape as the main `printed`), `surplus` (each fund's printed Surplus/(Deficit)), `assumptions` (the p. 28 lines with their page), `years`, `after_year` and `doc`. The site draws them after the newest year on the multi-year charts and tables only. `check_dataset.py` checks that no projection is in `series` and every projection year is after the newest year, ties every projection total per fund and kind (and the line count) to the CSV, checks every org code maps to a unit, re-reads every printed total and Surplus/(Deficit) from the validation CSV with line sums and flags re-derived, and compares the assumptions with the extracted page. Where overlapping books disagree, the disagreement is logged to `web/data/conflicts.json`. The Reserve Fund block in `budget.json` is built from `fund_balance_*.csv` under the same rule.

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
| `governments/lancaster-city/mapping/units.csv` | department (`unit` empty, `kind=department`) and unit. `kind`: `bureau` (on the chart; gets a page), `department-wide` (budget groups that are not a bureau), `whole-department` (the single unit of a department with no bureaus). Also `division`, `chart_page`, `descriptions` (ids from the descriptions CSV, `;`-separated, optionally `id[2-3]` for a paragraph range), `aliases` (old department URL slugs) and `notes` | hand |
| `governments/lancaster-city/mapping/org_structure.csv` | budget org code (first part of `account_code`): `department`, `unit`, the printed department and group names by year, and `notes` with the evidence for each mapping | hand |
| `governments/lancaster-city/content/org_descriptions.csv` | heading in `Org Descriptions 2027.pdf`: `id`, `level`, `parent`, `heading`, `source_page`, `text` (blank line = paragraph, `• ` = bullet, `### ` = printed subheading) | `python scripts/extract_org_descriptions.py` (pdfplumber; wording kept as printed, only wrapped lines and line-end hyphens joined) |

The build stops if an org code in `budget.json` has no row in `org_structure_2027.csv`, a row names a unit that is not in `org_units_2027.csv`, or a description reference does not exist. When a new budget book adds an org code, add a row (older codes map to their best-matching 2027 unit, with a note). `check_dataset.py` then verifies that every shown line maps to a unit, that the mapping in `budget.json` equals the CSV, that for every year, figure and revenue/expense the bureau totals of each department add up to the department total and the departments add up to the series total, and that departments without bureaus have exactly one unit.

`build_dataset.py` also writes `web/data/changes.json` (via `scripts/changes.py`, stdlib only) for the "What changed" page: the newest year's Revised and Proposed compared with the prior year's Projected and the latest Actual, and Revised with Proposed. It holds every changed line, totals by fund, category, department and bureau, shifts between funds detected from the city's line notes in `line_items_<newest book>.csv` (plus the matching zero-outs, new orgs, and direct-bill reimbursements), position counts per bureau from the `staffing_*.csv` files (raw and adjusted, with every artifact listed: missing schedules from `known_issues.csv`, full-/part-time relabels, org-code moves, misprinted org codes, renamed titles, positions moved with a shift), and the tax-policy notes in `governments/lancaster-city/notes/policy_notes.csv`. Income in it follows `governments/lancaster-city/mapping/income_rules.csv` (`scripts/income_rules.py`): draws and transfers are left out of income in every scope, and charges between funds are left out of the All funds scope, the same rule `app.js` applies. `check_dataset.py` ties every total in it to the series, checks each changed line against its series line, re-adds each shift from the series, checks position counts against the staffing CSVs, and prints the shifts, artifacts and policy notes.

It also writes `web/data/positions.json` (`build_positions()` in `scripts/changes.py`), so What changed can show positions for any two figures, not just the five comparisons above: `schedules` (id → `label`, `doc`; ids `"<newest>|proposed"`, `"<newest>|revised"` and `"<y>"` for each earlier book's own-year column) and `pairs` (`"<to>~<from>"` for every ordered pair of distinct schedules, 42 today, each the same positions block as a changes.json comparison; `shifts` apply only from an earlier year to the newest). These schedules are read leniently: a position whose org code the org chart doesn't have (a few in the 2022–2024 books) is counted in the all-funds totals and listed as an `unplaced` artifact instead of stopping the build; changes.json's own schedules stay strict. The site maps a series to a schedule (`seriesSchedule()` in `app.js`: the newest year's figure to its column, any other year's figure to that year's book) and loads the file only when What changed first opens. `check_dataset.py` checks every pair's totals per class against the staffing CSV column sums (unplaced included), the unplaced counts, adjusted = raw minus missing-schedule positions, and that the pairs changes.json also has are identical to it.

`build_dataset.py` also adds `tax_limit` to `budget.json` (`scripts/tax_limit.py`, stdlib only): the Home Rule Charter § 8.08 test for each City book from `governments/lancaster-city/content/rules/tax_limit.yaml` `first_year` on. It sums the General Fund lines marked `counts = yes` in `governments/lancaster-city/content/rules/tax_limit_lines.csv` in the book's own-year `proposed` and `proposed_revised` columns, and the same lines in the same book's projection of the year before (`projected_revised`, else `projected`), and records the change and whether it is over the limit. `check_dataset.py` recomputes every test from the `budget_long_*.csv` files, compares it with the JSON, and fails on a General Fund "Tax Revenue" line the CSV does not list.

`ingest.py --all` skips the org chart and descriptions PDFs (file names matching "Org Chart" / "Org Descriptions"); naming one of them explicitly is an error.

Each figure keeps its `source_doc` and `source_page`, which the site turns into a link to `pdfs/<book>.pdf#page=N`. `web/pdfs` is a symlink to `Budget PDFs - City/`.

The publish workflow (`.github/workflows/pages.yml`) runs the build and check for the City and for the County on every push to `main`, then publishes `web/` with the PDFs copied in.

## Adding a new budget book
1. Put the PDF in `Budget PDFs - City/`. Keep it under GitHub's 100 MB file limit (compress it if needed).
2. Run `python scripts/ingest.py "governments/lancaster-city/sources/<file>.pdf"`. If it infers a config (exit status 2), review `config/<file>.json`, delete its `_generated` key and run again.
3. Clear every unreviewed failure (exit status 1). Either fix the parsing, or add a reviewed source error to `governments/lancaster-city/notes/known_issues.csv`, with evidence. Never widen the tolerance.
4. Run `build_dataset.py` and `check_dataset.py`. The new year becomes Proposed/Revised, and the earlier years move forward automatically.
   If the build stops on an unmapped org code, add it to `governments/lancaster-city/mapping/org_structure.csv` (see "Org structure" above). When the city publishes a new org chart or descriptions, add the PDFs, rerun `scripts/extract_org_descriptions.py` (pointing `--pdf`/`--out` at the new edition) and review the unit and code tables.
5. Commit the PDF, the config, `data/processed/` and `web/data/`, then push to `main`.

To replace a book with an amended edition (as the 11/19/2026 2027 book replaced the 11/16 one), see [REBUILD.md](REBUILD.md#an-amended-edition-of-the-current-book).
