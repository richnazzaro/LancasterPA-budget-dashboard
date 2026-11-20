# Data pipeline: budget PDFs to validated data

How the City of Lancaster's budget books become the CSVs in `data/processed/` and the JSON the site reads. For how the site presents the data and how to edit it, see the [README](../README.md).

Run it by hand, about once a year, when a new budget book is published. Paths below are relative to the repository root.

## Setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running the extraction
One command handles any budget book, scanned or not:

```bash
python scripts/ingest.py "Budget PDFs - City/2026-Adopted-Budget-2026.pdf"
python scripts/ingest.py --all          # every PDF in Budget PDFs - City/
```

For each PDF, `ingest.py`:
1. **Detects** whether the PDF has a usable text layer (share of pages with text) or needs OCR. OCR runs automatically and is cached.
2. **Loads `config/<pdf name>.json`.** If there isn't one, it **infers** one from the column header rows ("2025 ORIGINAL BUDGET", "RECEIVED YTD 11/14/2025", "2026 PROPOSED", ...) and the staffing header, and writes it. An inferred config must be reviewed: check every column's year and type, the staffing field order, and the fund maps. Delete its `_generated` key and run again.
3. **Extracts and validates** the book, then **cross-checks** it against its neighbours: book B-1's PROPOSED vs this book's ORIGINAL BUDGET, and this book's PROPOSED vs book B+1's.
4. **Prints a short report:** text or OCR, line items, checks passed / acknowledged / unreviewed, and the cross-check match rate.

Exit status: 0 when everything passes or is a reviewed source issue, 1 when a book has unreviewed failures, and 2 when a config was just inferred or a PDF couldn't be processed.

The per-book scripts still work on their own: `scripts/extract_budget.py` (2027 book) and `scripts/extract_layout.py` (all others).

This writes four files to `data/processed/`, suffixed with the PDF's name:

| File | Contents |
|---|---|
| `budget_long_*.csv` | The main table: one row per account line per column (`fiscal_year, doc_type, fund, department, bureau, account_code, org_code, object_code, account_name, category, amount, source_doc, source_page`). |
| `line_items_*.csv` | One row per account line with all eight amount columns side by side, plus the city's explanatory note for that line. |
| `staffing_*.csv` | One row per budgeted position: title, bargaining unit, FT/PT, count, and salary. |
| `validation_*.csv` | Every printed TOTAL row compared with the sum of the parsed lines. |

A single budget book carries several years. The 2027 book has 2025 actual, 2026 adopted, 2026 amended, 2026 year-to-date, 2026 projected, and 2027 proposed figures. These are told apart by `fiscal_year` and `doc_type`.

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

## Building the site data
```bash
python3 scripts/build_dataset.py   # data/processed/budget_long_*.csv + fund_balance_*.csv -> web/data/*.json
python3 scripts/check_dataset.py   # every shown figure vs the CSVs and the printed fund totals; must report 0 mismatches
```
`build_dataset.py` picks **one kind of figure per year**:
- the newest year gets **proposed** and **revised**;
- the year before it gets **projected** (the revised projection when one is printed), from the newest book;
- earlier years get **actual**, from the book two years later.

Adopted, amended and year-to-date columns, and older books' own-year proposals, are never shown. New `budget_long_*.csv` files are picked up automatically. Where overlapping books disagree, the disagreement is logged to `web/data/conflicts.json`. The Reserve Fund block in `budget.json` is built from `fund_balance_*.csv` under the same rule.

Each figure keeps its `source_doc` and `source_page`, which the site turns into a link to `pdfs/<book>.pdf#page=N`. `web/pdfs` is a symlink to `Budget PDFs - City/`.

The publish workflow (`.github/workflows/pages.yml`) runs both scripts on every push to `main`, then publishes `web/` with the PDFs copied in.

## Adding a new budget book
1. Put the PDF in `Budget PDFs - City/`. Keep it under GitHub's 100 MB file limit (compress it if needed).
2. Run `python scripts/ingest.py "Budget PDFs - City/<file>.pdf"`. If it infers a config (exit status 2), review `config/<file>.json`, delete its `_generated` key and run again.
3. Clear every unreviewed failure (exit status 1). Either fix the parsing, or add a reviewed source error to `data/known_issues.csv`, with evidence. Never widen the tolerance.
4. Run `build_dataset.py` and `check_dataset.py`. The new year becomes Proposed/Revised, and the earlier years move forward automatically.
5. Commit the PDF, the config, `data/processed/` and `web/data/`, then push to `main`.
