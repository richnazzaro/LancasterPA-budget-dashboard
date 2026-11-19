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

### Scanned PDFs
The 2026 adopted budget PDF has no text layer. It has to be OCR'd before extraction:
```bash
brew install ocrmypdf   # installs Tesseract and Ghostscript too
ocrmypdf "Budget PDFs - City/2026-Adopted-Budget-2026.pdf" "Budget PDFs - City/2026-Adopted-Budget-2026-ocr.pdf"
```

## Dashboard
```bash
python3 scripts/build_dataset.py   # data/processed/budget_long_*.csv -> web/data/*.json
python3 scripts/check_dataset.py   # every shown total vs the CSVs and the printed fund totals
python3 -m http.server 8765 --directory web   # then open http://localhost:8765
```
`build_dataset.py` picks one figure per account, year and measure: **proposed** and **revised** (the original and revised proposals) only for the newest book's year; for every other year, **adopted**, **amended** and **projected** (revised when present) from the next year's book and **actual** from the book two years later. Year-to-date columns and older books' own-year proposals are never shown. New `budget_long_*.csv` files are picked up automatically. Disagreements between overlapping books go to `web/data/conflicts.json`.

The site shows no page numbers as text; each amount is itself a link to `pdfs/<book>.pdf#page=N` (from `source_doc`/`source_page` in `web/data/budget.json`), and `web/pdfs` is a symlink to `Budget PDFs - City/`. Routes are hash-based (`#/department/public-safety`), so GitHub Pages needs no server rules. The Pages workflow (`.github/workflows/pages.yml`) rebuilds the data and publishes `web/` with the PDFs copied in.
