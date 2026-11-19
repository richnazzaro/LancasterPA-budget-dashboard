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

### Scanned PDFs
The 2026 adopted budget PDF has no text layer. It has to be OCR'd before extraction:
```bash
brew install ocrmypdf   # installs Tesseract and Ghostscript too
ocrmypdf "Budget PDFs - City/2026-Adopted-Budget-2026.pdf" "Budget PDFs - City/2026-Adopted-Budget-2026-ocr.pdf"
```
