# Rebuilding everything by hand

How to reproduce the whole project from a fresh copy of the repository: every CSV in `data/processed/`, every JSON file in `web/data/`, a local preview, and the published site. Nothing here needs Claude or any other assistant. For what each step does in detail, see [PIPELINE.md](PIPELINE.md); for how the site presents the data, the [README](../README.md).

Commands run from the repository root on macOS (Linux works the same way with its own package manager).

## 1. What you need

| Tool | Used for | How to get it |
|---|---|---|
| git | the repository | Xcode command-line tools (`xcode-select --install`) or git-scm.com |
| Python 3.9 or newer | the pipeline (tested on 3.9.6; the publish workflow uses 3.12) | python.org, or the system `python3` |
| Tesseract | OCR of the one scanned book (2026) | `brew install tesseract` |
| A web browser | the local preview | any |
| A GitHub account | publishing (optional) | github.com |

`build_dataset.py` and `check_dataset.py` use only the Python standard library. Everything else (extraction, OCR, validation) needs the packages in `requirements.txt`.

## 2. Get the repository and set up Python

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
python3 -m venv .venv
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

Each budget book has a layout file in `config/` with the same name (`.json`). If you start from the PDFs alone, `ingest.py` writes a first draft of the config for you to review (step 3).

## 3. Extract and validate every book

```bash
python scripts/ingest.py --all
```

For each budget book this detects text or scan, runs OCR where needed, extracts every line item, staffing row and the Fund Balance page, checks every printed total, and cross-checks the book against its neighbours. It prints one short report per book.

- **Warnings:** lines such as `Cannot set gray non-stroke color` come from the PDF library reading the 2027 book and are harmless.
- **Time:** the text books take seconds each. The scanned 2026 book takes several minutes the first time (OCR at 300 DPI); the result is cached in `data/ocr_cache/` (not committed), so later runs are fast.
- **Exit status 0:** every check passed or is a reviewed source error in `data/known_issues.csv`.
- **Exit status 1:** a check failed and has not been reviewed. Fix the cause; see "When a check fails" below.
- **Exit status 2:** a config was inferred (review it, delete its `_generated` key, run again) or a PDF could not be read.

Run one book at a time with `python scripts/ingest.py "Budget PDFs - City/<file>.pdf"`.

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
```

`build_dataset.py` writes `web/data/budget.json`, `staffing.json`, `changes.json` and `conflicts.json`. `check_dataset.py` recomputes every figure the site shows from the CSVs and must end with **"0 series mismatches"**.

### Check the rebuild matches the repository

```bash
git status --short
git diff --stat
```

On a clean rebuild of an unchanged repository, `data/processed/` comes out identical. In `web/data/`, `budget.json` differs only in its `"generated"` timestamp, and `changes.json` may list some keys in a different order with identical content. To throw those away: `git checkout -- web/data/`. (This was tested on 2026-11-20 from a fresh clone with no OCR cache: all six books passed and the check reported 0 mismatches.)

## 5. Preview locally

```bash
python3 -m http.server 8765 --directory web
```

Open http://localhost:8765. The site has to be served (opening `web/index.html` from disk does not work, because the browser blocks it from loading the data files). `web/pdfs` is a link to `Budget PDFs - City/`, so the PDF links work in the preview. After editing `web/` files, reload with Cmd-Shift-R to skip the browser cache.

## 6. Publish

### On GitHub Pages (how the live site is published)

1. Push the repository to GitHub.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` now runs `.github/workflows/pages.yml`. It builds the data, runs `check_dataset.py` (a mismatch stops the publish), copies `web/` with the PDFs themselves in place of the `pdfs` link, and publishes it. You can also run it by hand from the **Actions** tab ("Publish dashboard" → Run workflow).
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
