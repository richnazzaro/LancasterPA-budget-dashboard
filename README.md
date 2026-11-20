# Lancaster Municipal Budget Visibility Project

This repository provides public visibility into the City of Lancaster, PA budget.

## Features
- **PDF Parsing**: Automated extraction of budget figures from the city's budget PDFs using pdfplumber (OCRmyPDF for scanned years), with every printed total re-checked.
- **Data Visualization**: Interactive charts showing large line items by bureau and category.
- **Drill-down capabilities**: Filterable tables for specific accounts, funds, and personnel costs.
- **Year-over-Year Analysis**: Crosswalk-based comparison of budget changes over time.

## Project Structure
- `Budget PDFs - City/`: Source budget documents.
- `scripts/`: Python scripts for PDF extraction and data normalization.
- `data/processed/`: Extracted tables (see below).
- `data/known_issues.csv`: Validation failures caused by errors in the source PDFs, reviewed by a person.
- `web/`: Static dashboard for GitHub Pages (plain HTML/CSS/JS, Chart.js from a CDN, no build step).

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
| `budget_long_*.csv` | The dashboard table: one row per account line per column (`fiscal_year, doc_type, fund, department, bureau, account_code, account_name, category, amount, source_doc, source_page`). |
| `line_items_*.csv` | One row per account line with all eight amount columns side by side, plus the city's explanatory note for that line. |
| `staffing_*.csv` | One row per budgeted position: title, bargaining unit, FT/PT, count, and salary. |
| `validation_*.csv` | Every printed TOTAL row compared with the sum of the parsed lines. |

A single budget book carries several years. The 2027 book has 2025 actual, 2026 adopted, 2026 amended, 2026 year-to-date, 2026 projected, and 2027 proposed figures. These are told apart by `fiscal_year` and `doc_type`.

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

## Dashboard
```bash
python3 scripts/build_dataset.py   # data/processed/budget_long_*.csv -> web/data/*.json
python3 scripts/check_dataset.py   # every shown total vs the CSVs and the printed fund totals
python3 -m http.server 8765 --directory web   # then open http://localhost:8765
```
`build_dataset.py` shows **one kind of figure per year**: the newest year gets **proposed** and **revised** (the original and revised proposals); an earlier year gets **actual** (from the book two years later); the year before the newest, which has no actual yet, gets **projected** (revised projection when present, from the next book). Adopted, amended and year-to-date columns and older books' own-year proposals are never shown. New `budget_long_*.csv` files are picked up automatically. Disagreements between overlapping books go to `web/data/conflicts.json`.

The site shows no page numbers as text; each amount is itself a link to `pdfs/<book>.pdf#page=N` (from `source_doc`/`source_page` in `web/data/budget.json`), and `web/pdfs` is a symlink to `Budget PDFs - City/`. Bureau names differ between books, so bureau pages match lines across years by org code (the first part of the account code); a name crosswalk is still to come. Entity name, site title, default fund and data paths live in `web/config.json`; brand and chart colors live in the `:root` block of `web/styles.css`, so another entity (e.g. the county) is a new config plus a new data folder. Routes are hash-based (`#/department/public-safety`), so GitHub Pages needs no server rules. The Pages workflow (`.github/workflows/pages.yml`) rebuilds the data and publishes `web/` with the PDFs copied in.
