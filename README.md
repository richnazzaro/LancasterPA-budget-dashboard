# Lancaster Budget Explorer

A public, independent view of the **City of Lancaster, PA** budget, built from the city's published budget books.

**Live site:** https://richnazzaro.github.io/LancasterPA-budget-dashboard/

This README covers how the site presents the data, where the data lives, how to use the site, and how to change what it shows and says. For how the PDFs are turned into data, see [docs/PIPELINE.md](docs/PIPELINE.md).

---

## 1. How the data is presented

### One kind of figure per year
Each budget book prints several years side by side. The site shows **one kind of figure per year**, so years are never mixed up:

| Year | Figure shown | Where it comes from |
|---|---|---|
| Historic years (2020–2025) | **Actual** | The book published two years later |
| Prior budget year (2026) | **Projected** (year-end estimate) | The newest book. The revised projection is used when one is printed. |
| New budget year (2027) | **Proposed** and **Revised** | The newest book. You can switch between the two. Neither is an adopted budget. |

**Adopted** and **Amended** budgets, year-to-date columns, and an older book's own-year proposal are **not shown**. They stay in the raw extractions in `data/processed/`. When a new book arrives, the year labels move forward automatically: the new year becomes Proposed/Revised, the year before becomes Projected, and older years become Actual.

### Every amount links to its source page
Clicking a dollar amount opens the budget-book PDF **at the page it came from**. This works for totals, categories and line items. Page numbers are not printed on screen, because the link is the amount itself.

### What the site shows
- **Home (all departments):**
  - the total for the selected fund, year and figure;
  - one card per department, with bars comparing the selected figure (mint) with the comparison figure (gold);
  - a "Totals by Year" line chart;
  - a "Revenue vs. Expenses by Fund" chart.
- **Department page** (`#/department/public-safety`), modeled on the LA Controller's budget site:
  - total and status;
  - a category pie;
  - a by-category comparison chart;
  - totals by year;
  - a bureau breakdown;
  - a category table with changes;
  - the overall year-over-year change;
  - a searchable, sortable line-item table.
- **Bureau page** (`#/department/<dept>/bureau/<fund--bureau>`): the same layout for a single bureau. Bureau names change between books, so years are matched by org code. A crosswalk of names is still to come.
- **Reserve Fund** (in the Fund selector): the General Fund balance, from each book's "Fund Balance Projection" page. It shows the year-end balance and how it changes each year, using the same one-figure-per-year rule. Where the city's page disagrees with itself, the Revised column is used and the difference is explained on the page.
- **About the data** (button in the header):
  - which book supplies each year;
  - how the figures were validated;
  - every known error in the city's source books, each reviewed by a person;
  - download links.

Funds: General, Stormwater Management, Sewer, Water, Solid Waste & Recycling, Liquid Fuels, Long's Park, plus the Reserve Fund view. The site opens on the **General Fund**.

## 2. Where the data can be found

| What | Where | Notes |
|---|---|---|
| Source budget books (PDF) | [`Budget PDFs - City/`](Budget%20PDFs%20-%20City/), also published at `<site>/pdfs/` | 2022–2027 books |
| Data the site reads | [`web/data/budget.json`](web/data/budget.json) | Every figure shown, with its source book and page |
| Budgeted positions | [`web/data/staffing.json`](web/data/staffing.json) | Not on screen yet (personnel view planned) |
| Books that disagree | [`web/data/conflicts.json`](web/data/conflicts.json) | Where overlapping books print different values for the same figure |
| Tidy per-book tables (CSV) | [`data/processed/`](data/processed/) | `budget_long_*.csv` is the main table: one row per account, year and figure type, with `source_page`. Also: `line_items_*`, `staffing_*`, `fund_balance_*`, `validation_*`, `crosscheck_*` |
| Reviewed source errors | [`data/known_issues.csv`](data/known_issues.csv) | Shown on the site under "Known problems in the source books" |
| Audited corrections | `data/sign_corrections.csv`, `data/ocr_corrections.csv`, `data/staffing_corrections.csv` | Each correction lists its evidence and the value as printed |

The JSON files can also be downloaded from the live site: `<site>/data/budget.json`, `staffing.json` and `conflicts.json`.

## 3. How to use the site

**Controls** (at the top of the home and department pages):
- **Fiscal year:** the year to show.
- **Compare with:** any other year and figure (for example, 2026 Projected), or "No comparison".
- **Fund:** a single fund, "All funds", or the Reserve Fund.
- **Figure:** Proposed / Revised. This only appears for years that have more than one figure.
- **Show:** Expenses / Revenue.

**On the pages:**
- Click a **department card** to open its page. Use the **Department** dropdown on that page to switch departments, and the bureau breakdown to drill into a bureau.
- **Line items:**
  - type in the search box to filter by name, account number, bureau, fund or category;
  - click a column header to sort;
  - use "Show more" to load more rows.
- Under the "Totals by Year" chart, **Show values** opens a table of the numbers behind it. Pie charts list their values beside the chart.
- **Shareable links:** every view's settings are kept in the address, so a link reopens exactly that view. For example, `#/department/public-safety?y=2027&m=proposed&c=2026-projected`.

| Parameter | Meaning | Values |
|---|---|---|
| `y` | year | e.g. `2027` |
| `m` | figure | `actual`, `projected`, `proposed`, `revised` |
| `c` | compare with | `2026-projected`, or `none` |
| `k` | show revenue | `revenue` (expenses is the default) |
| `f` | fund | a fund name, `Reserve Fund`, or `all` (General Fund is the default) |

---

## 4. Editing the site's display and text

The site is plain HTML, CSS and JavaScript in [`web/`](web/). There is no build step. Edit a file, push to `main`, and the site redeploys in about a minute.

### Preview your changes locally
```bash
python3 -m http.server 8765 --directory web    # then open http://localhost:8765
```
Opening `index.html` straight from disk won't work, because the browser blocks it from loading the data files.

### Where each thing lives

| To change… | Edit | What to look for |
|---|---|---|
| Site name, city name, page description, footer text, default fund | [`web/config.json`](web/config.json) | `site_title`, `entity.name` / `short` / `possessive`, `description`, `footer`, `default_fund` |
| Colors (background, panels, text, the mint "selected" and gold "comparison" colors, chart palette) | [`web/styles.css`](web/styles.css) | The `:root { … }` block at the top. Charts read their colors from it too, so there's nothing to change in JS. |
| Fonts, sizes, spacing, layout | [`web/styles.css`](web/styles.css) | `--font` in `:root`; sections are labelled (`/* Header */`, `/* Filters */`, …) |
| Favicon, the fallback page title, the "About the data" button label | [`web/index.html`](web/index.html) | `<link rel="icon">`, `<title>`, `#about-btn` |
| Figure names ("Proposed", "Revised", "Projected", "Actual") | [`web/app.js`](web/app.js) | `const LABEL` near the top |
| Status badges ("Revised proposal, not adopted", …) | `web/app.js` | `const STATUS` near the top |
| Category order in charts and tables | `web/app.js` | `const CAT_ORDER` |
| Rows per page in the line-item table; number of pie slices | `web/app.js` | `PAGE_SIZE`, `PIE_SLICES` |
| Home page headings, hint text and charts | `web/app.js` | `function homeView()` |
| Department and bureau page sections and headings | `web/app.js` | `function entityView()` |
| Filter labels ("Fiscal year", "Compare with", …) | `web/app.js` | `function filtersHTML()` |
| "Totals by Year" chart text | `web/app.js` | `function trendHTML()` |
| Reserve Fund page text | `web/app.js` | `function reserveView()` and `const resLabel` |
| "About the data" text (sources, validation, downloads) | `web/app.js` | `function renderAbout()` |
| Notes listed under "Known problems in the source books" | [`data/known_issues.csv`](data/known_issues.csv) | The `note` column. Then rebuild the data (below). |

Notes:
- `config.json` overrides the title, wordmark, description and footer that are hard-coded in `index.html`. Change them in `config.json`.
- In `app.js`, page text sits inside template strings (`` `…` ``). Change the words, but keep `${…}` placeholders and the HTML tags intact.

### Changing which figures appear
Which figure is used for each year is decided when the data is built, not in the page code. That logic lives in [`scripts/build_dataset.py`](scripts/build_dataset.py). After changing it, or anything in `data/`, rebuild and check:
```bash
python3 scripts/build_dataset.py   # data/processed/*.csv -> web/data/*.json
python3 scripts/check_dataset.py   # every shown figure vs the CSVs and printed totals; must report 0 mismatches
```
The publish workflow runs both scripts on every push, and stops the deploy if the check fails.

### Adding another government (e.g. Lancaster County)
The city name, title and data paths are all in `config.json`, and colors are in the `:root` block. A second entity needs:
- its own `config.json` values;
- a data folder (`paths.data`);
- a PDF folder (`paths.pdfs`).

### Publishing and custom domain
- `.github/workflows/pages.yml` publishes `web/`, plus copies of the PDFs, to GitHub Pages on every push to `main`. It can also be run by hand from the Actions tab.
- To use your own domain:
  1. Add a DNS CNAME to `richnazzaro.github.io` (or the four GitHub Pages A records for a bare domain).
  2. Set the domain under repo **Settings → Pages → Custom domain**.
  3. Tick **Enforce HTTPS**.

---

## Repository layout
```
Budget PDFs - City/   source budget books (2022–2027)
config/               per-book layout settings for the extractor
data/                 reviewed issues and audited corrections
data/processed/       extracted CSVs (committed; the site is built from them)
scripts/              extraction, validation and site-data build (see docs/PIPELINE.md)
web/                  the static site (index.html, app.js, styles.css, config.json, data/)
docs/PIPELINE.md      how PDFs become data: OCR, validation, corrections, adding a new book
```
