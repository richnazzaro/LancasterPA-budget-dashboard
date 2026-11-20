# Lancaster Budget Explorer

A public, independent view of the **City of Lancaster, PA** budget, built from the city's published budget books.

**Live site:** https://richnazzaro.github.io/LancasterPA-budget-dashboard/

This README covers how the site presents the data, where the data lives, and how to use the site. For how the PDFs are turned into data, see [docs/PIPELINE.md](docs/PIPELINE.md).

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
