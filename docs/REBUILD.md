# Rebuilding everything by hand

How to reproduce the whole project from a fresh copy of the repository: every CSV in `data/processed/`, every JSON file in `web/data/`, a local preview, and the published site. Nothing here needs Claude or any other assistant. For what each step does in detail, see [PIPELINE.md](PIPELINE.md); for how the site presents the data, the [README](../README.md).

Commands run from the repository root on macOS (Linux works the same way with its own package manager).

## 1. What you need

| Tool | Used for | How to get it |
|---|---|---|
| git | the repository | Xcode command-line tools (`xcode-select --install`) or git-scm.com |
| Python 3.9 to 3.12 | the pipeline (tested on 3.9.6, the macOS system Python, `/usr/bin/python3`; the publish workflow uses 3.12). **Not 3.13 or newer:** the packages pinned in `requirements.txt` do not install there, so if your `python3` is newer, create the venv with `/usr/bin/python3 -m venv .venv` or another 3.9 to 3.12 | python.org, or the system `python3` |
| Tesseract | OCR of the two scanned books (the City's 2026 book and the County's 2024 book) | `brew install tesseract` |
| A web browser | the local preview | any |
| A GitHub account | publishing (optional) | github.com |

`build_dataset.py` and `check_dataset.py` use only the Python standard library. Everything else (extraction, OCR, validation) needs the packages in `requirements.txt`.

## 2. Get the repository and set up Python

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
python3 -m venv .venv      # or /usr/bin/python3 -m venv .venv (see step 1: Python 3.9 to 3.12)
source .venv/bin/activate
pip install -r requirements.txt
```

`Budget PDFs - City/` comes with the clone. It holds every source book:

| File | Year | Text or scanned |
|---|---|---|
| `2022-City-of-Lancaster-Adopted-Budget-122121.pdf` | 2022 | text |
| `2023-City-of-Lancaster-ADOPTED-Budget-122022.pdf` | 2023 | text |
| `2024-Adopted-Budget.pdf` | 2024 | text |
| `City-of-Lancaster-Adopted-2025-Budget.pdf` | 2025 | text |
| `2026-Adopted-Budget-2026.pdf` | 2026 | scanned (OCR) |
| `2027-Mayors-Revised-Proposed-Budget-Rev-11-19-26.pdf` | 2027 | text (the 11/19/2026 amended Revised book) |
| `2027 Org Chart.pdf`, `Org Descriptions 2027.pdf` | org chart and unit descriptions | text; not budget books |

`Budget PDFs - County/` also comes with the clone (99 MB, every file under GitHub's 100 MB limit). If a file is ever missing, download it from the source below and save it under exactly the name in the table; the `config/county/` files are keyed by these names, and the books are byte-identical to the County's own downloads.

| File | Year | Text or scanned | Where it comes from |
|---|---|---|---|
| `Budget PDFs - County/County-2024-Budget-Book.pdf` | 2024 (also prints the 2023 budget) | scanned photocopy (OCR) | <https://www.lancastercountypa.gov/DocumentCenter/View/16123/Lancaster-County-Budget-Book-2024> |
| `Budget PDFs - County/County-2025-Budget-Book.pdf` | 2025 (also prints the 2024 budget) | text | the County's budget index, <https://lancastercountypa.gov/591/Budget-Financial-Information> ("Budget Book 2025"; the County's own file name is in `config/county/County-2025-Budget-Book.json`) |
| `Budget PDFs - County/County-2026-Budget-Book.pdf` | 2026 (also prints the 2025 budget) | text | <https://www.lancastercountypa.gov/DocumentCenter/View/18342/Lancaster-County-Budget-Book-2026> (adopted Dec 24, 2025, Resolution 79 of 2025) |
| `Budget PDFs - County/ACFR/County-ACFR-2023.pdf` | 2023 audited annual report | text | <https://lancastercountypa.gov/ArchiveCenter/ViewFile/Item/3395> (archive page: `Archive.aspx?ADID=3395`) |
| `Budget PDFs - County/ACFR/County-ACFR-2024.pdf` | 2024 audited annual report | text | <https://lancastercountypa.gov/ArchiveCenter/ViewFile/Item/3399> |
| `Budget PDFs - County/ACFR/County-ACFR-2025.pdf` | 2025 audited annual report | text | <https://lancastercountypa.gov/ArchiveCenter/ViewFile/Item/3414> |
| `Budget PDFs - County/Resolutions/County-Resolution-91-of-2023.pdf` | 2024 budget resolution (one page) | text | <https://lancastercountypa.gov/DocumentCenter/View/16142/Resolution-No-91-of-2023> (the County's file name: `Resolution No. 91 of 2023- FINAL 2024 BUDGET.pdf`) |
| `Budget PDFs - County/Resolutions/County-Resolution-83-of-2024.pdf` | 2025 budget resolution (one page; also reprinted on p3 of the 2025 book) | text | <https://lancastercountypa.gov/DocumentCenter/View/17144/Resolution-No-83-of-2024> (the County's file name: `Resolution No. 83 of 2024_202412111412040001.pdf`) |
| `Budget PDFs - County/County-2026-Budget-Presentation.pdf` | the County's 2026 budget presentation (21 slides = 21 pages); used only for the context facts, never as a primary source | slides | the County publishes it at <https://www.co.lancaster.pa.us/591/Budget-Financial-Information> (slide 21). The County's file is a pptx named `2026 Budget Presentation_202512180856433056.pptx`; this PDF was made from it with `soffice --headless --convert-to pdf` (LibreOffice) and saved under the clean name |
| `Budget PDFs - County/Resolutions/County-Resolution-79-of-2025.pdf` | 2026 budget resolution (one page) | text | <https://lancastercountypa.gov/DocumentCenter/View/18652/Resolution-No-79-of-2025> (the County's file name: `Resolution No. 79 of 2025.pdf`) |

The `Archive.aspx?ADID=` addresses return an HTML page; the PDF itself is at the `ViewFile/Item/<ADID>` address. Each `config/county/acfr/<year>.json` records both addresses and the schedule pages; each `config/county/resolutions/<budget year>.json` records a resolution's address, the County's file name and any reprint in a book. The 2023 budget's resolution (Res 109 of 2022, <https://lancastercountypa.gov/DocumentCenter/View/14688/Resolution-No-109-of-2022>) is not used, so 2023 has no Budget balance. The County is a separate entity from the City: its books, configs, CSVs and web data all live in `county/` subfolders, and `Budget PDFs - City/county` is a symlink to `Budget PDFs - County` so that the site's `pdfs/county/` links resolve.

Each budget book has a layout file in `config/` (City) or `config/county/` (County) with the same name (`.json`). If you start from the PDFs alone, `ingest.py` writes a first draft of the config for you to review (step 3).

## 3. Extract and validate every book

```bash
python scripts/ingest.py --all
```

(`--all` is the City only; the County is step 3's next section.)

For each budget book this detects text or scan, runs OCR where needed, extracts every line item, staffing row and the Fund Balance page, checks every printed total, and cross-checks the book against its neighbours. It prints one short report per book.

- **Warnings:** lines such as `Cannot set gray non-stroke color` come from the PDF library reading the 2027 book and are harmless.
- **Time:** the text books take seconds each. The scanned 2026 book takes several minutes the first time (OCR at 300 DPI); the result is cached in `data/ocr_cache/` (not committed), so later runs are fast.
- **Exit status 0:** every check passed or is a reviewed source error in `data/known_issues.csv`.
- **Exit status 1:** a check failed and has not been reviewed. Fix the cause; see "When a check fails" below.
- **Exit status 2:** a config was inferred (review it, delete its `_generated` key, run again) or a PDF could not be read.

Run one book at a time with `python scripts/ingest.py "Budget PDFs - City/<file>.pdf"`.

### The County books and audited reports

```bash
python scripts/ingest.py --county
python scripts/extract_county_acfr.py
```

- **`ingest.py --county`** extracts every book in `Budget PDFs - County/` with `scripts/extract_county.py` (not the City extractor), checks every printed department, fund and by-account total, then compares each pair of County books that print the same year line by line (`data/processed/county/crosscheck_*.csv`). Last it runs `scripts/extract_county_resolutions.py` on the budget resolutions (below). Output goes to `data/processed/county/`. Exit status as above: 0 when every check passes, 1 when one fails.
- **`extract_county_resolutions.py`** (also run by `ingest.py --county`; on its own, `python scripts/extract_county_resolutions.py`) reads every printed figure of each budget resolution in `Budget PDFs - County/Resolutions/` (General Fund, Other Funds and Total columns: receipts, fund balance available, expenditures, fund balance remaining, the tax rate and assessed value, and footnotes) into `data/processed/county/resolutions_county.csv`, and its 201 checks into `validation_resolutions_county.csv`: lines add to printed totals in every column, General Fund + Other Funds = Total, start + receipts − expenditures = remaining, the planned draw = expenditures − receipts, the General Fund totals match every book's printed Grand Totals for the year, and the 2025 book's reprint of Res 83 matches figure for figure. The text layer splits amounts (`$ 1 42,786,672`), so amounts are rebuilt by position, as in `county_rows.py`. It runs after the books because it reads their validation files.
- **The 2024 book is a scanned photocopy.** It is read by OCR with the settings in the `ocr` block of `config/county/County-2024-Budget-Book.json` (400 DPI, with the page cleaned first), and p111 and p112, which are bound in the wrong order, are put right by its `page_order`. The first OCR run takes a few minutes and is cached in `data/ocr_cache/` (not committed).
- **OCR corrections.** `data/county/ocr_corrections.csv` (177 rows) fixes amounts the OCR misread, each keeping the text OCR saw, the corrected value and the evidence (84 are proven by the row's printed variance and % change, 93 were read from the page image). A correction is keyed by the row as OCR read it, so a different Tesseract version can leave some rows stale; the check then fails with "ocr correction" and names the rows. To propose fixes for a new scan, run `python scripts/county_ocr_corrections.py "Budget PDFs - County/County-2024-Budget-Book.pdf"` and review every row against the page image before copying it in.
- **`verify_county_context.py`** (also run last by `ingest.py --county`; on its own, `python scripts/verify_county_context.py`) reads the page each row of `data/county/context_facts.csv` cites and confirms the figure is printed there, and on the presentation slide named in `also_in`; it writes `data/processed/county/validation_context_county.csv` (61 checks). It needs the packages in `requirements.txt`. The facts file is kept by hand: to add or change a fact, edit the CSV, cite the primary page (resolution, budget book or audited report; the presentation only for a fact nothing else prints), then run this script and the build and check commands.
- **`extract_county_acfr.py`** reads the budget-versus-actual schedules (General Fund, Children & Youth, Behavioral Health and Developmental Services, Domestic Relations, Aging, Drug & Alcohol, Liquid Fuels) and the GAAP fund balances from each audited report named in `config/county/acfr/<year>.json`, into `data/processed/county/actuals_acfr_<year>.csv`, `validation_acfr_<year>.csv` and `gaap_fund_balance_acfr.csv`. It runs 677 checks (lines add to printed totals, variances foot, balances roll forward, and each report agrees with the others). It needs the packages in `requirements.txt`.

### Org descriptions (only when the descriptions PDF changes)

```bash
python scripts/extract_org_descriptions.py
```

This rewrites `data/org_descriptions_2027.csv` from `Org Descriptions 2027.pdf`. The committed file is already current, so a plain rebuild can skip it.

### Hand-maintained files

These are reviewed by a person and committed; the scripts read them but never write them:

| File | What it holds |
|---|---|
| `config/*.json` | each book's column layout, staffing field order and code maps |
| `data/known_issues.csv` | reviewed errors in the city's books (shown on the site) |
| `data/sign_corrections.csv`, `data/ocr_corrections.csv`, `data/staffing_corrections.csv` | proven value fixes, each keeping the printed value and the evidence |
| `data/org_units_2027.csv`, `data/org_structure_2027.csv` | departments and bureaus from the 2027 org chart, and which org code belongs to which |
| `data/policy_notes.csv` | tax-rate facts that are not in the budget tables, each with its source |
| `config/county/*.json`, `config/county/acfr/*.json`, `config/county/resolutions/*.json` | each County book's layout and OCR settings; each audited report's source addresses and schedule pages; each budget resolution's address and reprints |
| `data/county/known_issues.csv` | reviewed errors and differences in the County's books and audited reports (shown on the County About page), each with a `kind`: `rounding`, `source_error` or `basis_difference` |
| `data/county/context_facts.csv` | the County's context facts (tax rate and history, assessed value, bond rating, staffing, Capital Improvement Fund, agency grants), each with the primary document and page that print it and the presentation slide that repeats it; checked by `scripts/verify_county_context.py` and `check_county.py` |
| `data/county/ocr_corrections.csv` | proven value fixes for the scanned 2024 book |
| `data/county/account_changes.csv` | accounts the County folded together between books (7112 and 7114 into 7113; 7216 into 7215), so What changed compares them as one line |
| `data/county/org_units.csv` | each County department code with its name, group (General Government, Courts and Row Offices, Corrections, Human Services), book section and pages |

### When a check fails

1. Read the failure: the report names the page, the section and the gap.
2. If the extraction misread the page, fix the parsing (`scripts/extract_layout.py` or `config/<book>.json`; `scripts/extract_budget.py` for the 2027 book).
3. If the city's book is itself wrong, add a row to `data/known_issues.csv` explaining the evidence. `python scripts/review_failures.py <book name without .pdf>` drafts these rows for you to read and edit.
4. If a value is provably misprinted (for example a negative printed without its minus sign), record the fix in the matching corrections file. `python scripts/sign_corrections.py <book> --append` proposes sign flips only when the printed total proves them.
5. Never widen the $5 rounding tolerance to make a check pass.

## 4. Build the site data

```bash
python3 scripts/build_dataset.py
python3 scripts/check_dataset.py
python3 scripts/build_dataset.py --entity county
python3 scripts/check_dataset.py --entity county
```

The first pair is the City, the second the County; each ends with **"0 series mismatches"** and the publish workflow runs both. The County build (`scripts/build_county.py`) writes `web/data/county/budget.json`, `changes.json`, `conflicts.json` and `fund_balance_gaap.json`. `budget.json` also carries the `context` block (from `data/county/context_facts.csv`). County figures are all labelled **Budget** (one per year, from the newest book that prints that year: 2023 to 2026); the audited **Actual** figures for 2023 to 2025 sit in a separate `actuals` block at fund, revenue-source and function level only. The `reserve` block is the County's **General Fund Balance** page: Budget balances (start, receipts, expenditures, remaining) from the budget resolutions for 2024 to 2026, and the audited Actual year-end balances for 2023 to 2025 as separate entries, never combined. The County follows the same printed-totals rule as the City: every total is shown as the book printed it, a gap is flagged only when the lines miss it by more than rounding, and our own sums are labelled calculated. `check_county.py` recomputes everything from the CSVs without importing the build.

`build_dataset.py` writes `web/data/budget.json`, `staffing.json`, `changes.json` and `conflicts.json`. `check_dataset.py` recomputes every figure the site shows from the CSVs, checks every printed total and gap flag (it lists each ≠ flag the site shows), and must end with **"0 series mismatches"**.

### Check the rebuild matches the repository

```bash
git status --short
git diff --stat
```

On a clean rebuild of an unchanged repository, `data/processed/` (City and `county/`) comes out identical. In `web/data/` and `web/data/county/`, `budget.json` differs only in its `"generated"` timestamp, and `changes.json` may list some keys in a different order with identical content. To throw those away: `git checkout -- web/data/`. (Tested on 2026-11-22 from a fresh clone with no OCR cache: all six City books and all three County books passed, the audited reports passed, both entities' checks reported 0 mismatches, and every JSON file matched what is committed apart from the timestamps.)

## 5. Preview locally

```bash
python3 -m http.server 8765 --directory web
```

Open http://localhost:8765. The site has to be served (opening `web/index.html` from disk does not work, because the browser blocks it from loading the data files). `web/pdfs` is a link to `Budget PDFs - City/`, which holds a `county` link to `Budget PDFs - County/`, so the PDF links work for both entities. The City is at `#/` and the County at `#/county/`; the City / County tabs at the top of the left rail switch between them. After editing `web/` files, reload with Cmd-Shift-R to skip the browser cache.

## 6. Publish

### On GitHub Pages (how the live site is published)

1. Push the repository to GitHub.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` now runs `.github/workflows/pages.yml`. It builds the City and County data, runs `check_dataset.py` for each (a mismatch in either stops the publish), copies `web/` with the PDFs themselves in place of the `pdfs` link, and publishes it. You can also run it by hand from the **Actions** tab ("Publish dashboard" → Run workflow).
4. **Custom domain (optional):**
   - At your DNS provider, add a `CNAME` record for the subdomain (for example `budget`) pointing to `<owner>.github.io`.
   - In **Settings → Pages → Custom domain**, enter the full name (for example `budget.example.net`) and save. GitHub stores it in the Pages settings; no `CNAME` file is needed in the repository.
   - When the certificate is ready (minutes to an hour), tick **Enforce HTTPS**.

### Anywhere else

The published site is plain files. Build the data (step 4), then copy `web/` with the PDFs included:

```bash
mkdir _site
cp -RL web/. _site/
```

Upload `_site/` to any static host. No server code or database is involved.

## 7. Every year, or when the city publishes a new or amended book

### A new budget year
1. Put the PDF in `Budget PDFs - City/`. GitHub refuses files over 100 MB; compress the PDF first if needed.
2. `python scripts/ingest.py "Budget PDFs - City/<file>.pdf"`; review the inferred config (exit status 2) and clear every failure (exit status 1).
3. `python3 scripts/build_dataset.py` and `python3 scripts/check_dataset.py`. The new year becomes Proposed/Revised and the earlier years move forward automatically. If the build stops on an unmapped org code, add the code to `data/org_structure_2027.csv`.
4. Look at the site locally (step 5), then commit the PDF, its config, `data/` and `web/data/`, and push to `main`.

### An amended edition of the current book
This is how the 11/16/2026 2027 book was replaced by the 11/19/2026 one:
1. Add the new PDF and copy the old book's config to the new file name (`config/<new name>.json`), changing `source_doc` and any page numbers in its comments.
2. `python scripts/ingest.py "Budget PDFs - City/<new file>.pdf"`.
3. Compare `data/processed/line_items_<old>.csv` with `line_items_<new>.csv` by `org_code` + `object_code`: only the amended lines should differ. If others differ, the new PDF is being read differently; fix that first. (The 11/19 book was re-saved through macOS, which renamed the note font; `extract_budget.py` now accepts both names.)
4. Move rows in `data/known_issues.csv` and `data/policy_notes.csv` from the old file name and page to the new ones, and delete rows the new edition fixes.
5. Remove the old book: `git rm` its PDF, `config/<old>.json` and every `data/processed/*<old>*.csv`.
6. Rebuild and check (step 4), preview, commit, push.

### A new org chart
Add the PDFs, run `python scripts/extract_org_descriptions.py --pdf "<new descriptions PDF>" --out data/org_descriptions_<year>.csv`, and review `data/org_units_2027.csv` and `data/org_structure_2027.csv` against the new chart (the file names and the build's references to them would move to the new year).

### A new County budget year or audited report
1. Save the new County book as `Budget PDFs - County/County-<year>-Budget-Book.pdf` (keep it under 100 MB) and give it a `config/county/County-<year>-Budget-Book.json` modelled on the 2026 one (a scan also needs the `ocr` block). Run `python scripts/ingest.py --county` and clear every failure: fix the parsing, or record a reviewed source error in `data/county/known_issues.csv`. Never widen the tolerance.
2. Add rows to `data/county/org_units.csv` for new departments (an unlisted code still builds, under its printed name, with a note) and to `data/county/account_changes.csv` when the County folds accounts together.
3. For a new audited report, save it as `Budget PDFs - County/ACFR/County-ACFR-<year>.pdf`, add `config/county/acfr/<year>.json` (copy the 2025 one; update the addresses and schedule pages) and run `python scripts/extract_county_acfr.py`.
4. For a new budget resolution, save it as `Budget PDFs - County/Resolutions/County-Resolution-<number>-of-<year>.pdf`, add `config/county/resolutions/<budget year>.json` (copy the 2026 one; update the file name, resolution number, address and `copies`) and run `python scripts/ingest.py --county`. The General Fund Balance page gains the Budget year by itself.
5. Update `data/county/context_facts.csv` for the new year (tax rate, assessed value, Capital Improvement Fund, agency grants and the rest, each from the resolution, book or audited report; add the new year's presentation to `Budget PDFs - County/` the same way if the County publishes one) and run `python scripts/verify_county_context.py`.
6. Run the four build and check commands in step 4. The County's newest year changes automatically; set `adopted` for it in `web/config.json` (`entities.county`) so the status line cites the adopting resolution.
