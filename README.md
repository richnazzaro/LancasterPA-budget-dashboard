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
- `web/`: Static site files for the GitHub Pages frontend (not built yet).

## Setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running the extraction
```bash
python scripts/extract_budget.py "Budget PDFs - City/2027-RevisedProposedBudget-Compressed.pdf"
```

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

### Scanned PDFs (OCR)
Some budget books, including the 2026 adopted budget, have no text layer. They go through an OCR path that produces the same four tables:

```bash
brew install tesseract
python scripts/extract_scanned.py "Budget PDFs - City/2026-Adopted-Budget-2026.pdf"
```

- `scripts/ocr_pages.py` renders each page at 300 DPI, turns it upright using Tesseract's orientation detection, erases table rules, and saves Tesseract word boxes to `data/ocr_cache/` (git-ignored, keyed by the PDF's hash). The first run takes about a minute; later runs reuse the cache.
- `scripts/extract_scanned.py` reads the column header on each page and checks it against `config/<pdf name>.json`. It assigns each number to a column by its position on the page, then runs the same TOTAL-row and staffing checks as the text-layer extractor.
- `config/<pdf name>.json` holds everything that varies by year: column order, fiscal year and doc_type per column, staffing columns, and the fund and department code maps. For another scanned year, copy the 2026 file and edit what differs.
- An amount OCR can't read cleanly fails the run until a person fixes it in `data/ocr_corrections.csv`, with evidence from the page image. Every flagged cell is listed in `ocr_cells_<doc>.csv`. Corrected values still have to re-add to the printed totals.
- `scripts/crosscheck.py` compares one book's column with another book's reprint of the same year, account by account. It writes `crosscheck_*.csv`, for example 2026 PROPOSED in the 2026 book vs 2026 ORIGINAL BUDGET in the 2027 book.

`scripts/budget_common.py` holds the parts both extractors share.
