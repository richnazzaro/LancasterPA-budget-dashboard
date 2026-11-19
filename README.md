# Lancaster Municipal Budget Visibility Project

This repository provides public visibility into the City of Lancaster's budget. 

## Features
- **PDF Parsing**: Automated extraction of budget figures from annual PDF documents using usage: pdfplumber [-h] [--structure | --structure-text]
                  [--format {csv,json,text}] [--types TYPES [TYPES ...]]
                  [--include-attrs INCLUDE_ATTRS [INCLUDE_ATTRS ...]]
                  [--exclude-attrs EXCLUDE_ATTRS [EXCLUDE_ATTRS ...]]
                  [--laparams LAPARAMS] [--precision PRECISION]
                  [--pages PAGES [PAGES ...]] [--indent INDENT]
                  [infile]

positional arguments:
  infile

optional arguments:
  -h, --help            show this help message and exit
  --structure           Write the structure tree as JSON. All other arguments
                        except --pages, --laparams, and --indent will be
                        ignored
  --structure-text      Write the structure tree as JSON including text
                        contents. All other arguments except --pages,
                        --laparams, and --indent will be ignored
  --format {csv,json,text}
  --types TYPES [TYPES ...]
  --include-attrs INCLUDE_ATTRS [INCLUDE_ATTRS ...]
                        Include *only* these object attributes in output.
  --exclude-attrs EXCLUDE_ATTRS [EXCLUDE_ATTRS ...]
                        Exclude these object attributes from output.
  --laparams LAPARAMS
  --precision PRECISION
  --pages PAGES [PAGES ...]
  --indent INDENT       Indent level for JSON pretty-printing. and OCR tools.
- **Data Visualization**: Interactive charts showing large line items by bureau and category.
- **Drill-down capabilities**: Filterable tables for specific accounts, funds, and personnel costs.
- **Year-over-Year Analysis**: Crosswalk-based comparison of budget changes over time.

## Project Structure
- `/data`: Contains raw and processed CSV/JSON data.
- `/scripts`: Python scripts for PDF extraction and data normalization.
- `/web`: Static site files for the GitHub Pages frontend.

## Setup Instructions
1. Install dependencies:  (to be added)
2. Run the extraction script: 
3. View the dashboard on GitHub Pages.
