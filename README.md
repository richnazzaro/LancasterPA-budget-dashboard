# Lancaster Budget Explorer

A public, independent view of the **City of Lancaster, PA** budget, built from the city's published budget books.

**Live site:** https://budget.nazwel.net (the old `richnazzaro.github.io/LancasterPA-budget-dashboard` address forwards there)

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
  - the total for the selected fund, year and figure, with whether it is up or down against the comparison (for example "▲ $5.0M (6.1%) vs 2026 Projected");
  - for the General Fund, a short note under the total when part of the revenue is **drawn from the reserve** (the "Fund Balance Reserve" revenue lines, object `499000`): "Balanced by drawing $4.8M from the reserve". It links to the Reserve Fund view and, through the amount, to the source page. It is summed from the data for each figure (2027 Revised $4,782,815; 2027 Proposed $4,268,753; 2026 Projected $6,315,053; none in the Actual years) and shown only where there is a draw;
  - at the top, side by side (stacked on narrower screens): a **"Totals by Year"** line chart and a **"What changed in 2027"** summary (the headline sentence, the four headline numbers and a "See everything that changed" button). The summary appears for the newest year's Spending view;
  - one card per department, with bars comparing the selected figure (blue) with the comparison figure (amber);
  - an "Income vs. Spending by Fund" chart.
- **Departments and bureaus follow the city's 2027 org chart** (`Budget PDFs - City/2027 Org Chart.pdf`). Every budget line is placed in an org-chart bureau by its account number (org code), so every year is grouped the same way, even where an older book printed a group under another department or name. For example, Human Resources appears under Executive in every year. The full mapping, with the evidence for each choice, is in [`data/org_structure_2027.csv`](data/org_structure_2027.csv).
- **Department page** (`#/department/public-safety`), modeled on the LA Controller's budget site. Top to bottom:
  - breadcrumbs (Home › Department › Bureau), the total and status, and a row of in-page links (Compare · What changed · Bureaus · Categories · Line items);
  - **"What does this department do?"**: a collapsible description quoted from the city's `Org Descriptions 2027.pdf`, with a small link to its page in that PDF (closed by default; Legislative, City Controller, Public Safety and General Revenue have none, so it is left out);
  - the controls (on phones, **What changed** comes first and the controls follow behind a "Change view" button);
  - **Compare**, one panel with two tabs: "This year vs. comparison" (both totals, the change, the by-category bars and a category table behind "Show as a table") and "Over time" (totals by year; in the 2027 year the small dot is Proposed and the larger ring is Revised);
  - **What changed**: headline sentence, the reserve/fund moves, and, behind short disclosures, the change by bureau, positions and the largest line changes;
  - a **bureau list**: one card per bureau or office on the org chart (name, share of the department, selected-vs-comparison bars, the whole card is a link; two columns on wide screens), with several budget groups combined where the chart has one bureau. Budget groups that are not a bureau (for example Administrative Services' city-wide Insurance, Fringe Benefits, Debt Service and Community Involvement budgets, or a department's fee revenue) form one card labelled "Department-wide costs (not a bureau)" or "Department revenue (not a bureau)". Departments with no bureaus on the chart (Legislative, City Controller, and General Revenue, which is not on the chart) have no bureau list and no bureau pages;
  - a category pie;
  - a searchable, sortable line-item table (20 rows at a time) with the account code under each name and **Export this view (CSV)**, which downloads every row matching the search, with figure, comparison, change and the source book and page, built in the browser.
- **Bureau page** (`#/department/<dept>/bureau/<bureau>`, e.g. `#/department/administrative-services/bureau/bureau-of-treasury`): the same layout for one org-chart bureau, across all its funds and years (including its own compact **What changed** section with positions), with **"What does this bureau do?"** from the descriptions PDF. Public Works bureaus also name their division. The department-wide group has a page too (`.../bureau/department-wide`) that lists the budget groups in it. Older bureau links (`.../bureau/<fund>--<printed group>`) redirect to the bureau that group now belongs to, or to the department page.
- **Reserve Fund** (in the Fund selector): the General Fund balance, from each book's "Fund Balance Projection" page. It shows the year-end balance and how it changes each year, using the same one-figure-per-year rule. Where the city's page disagrees with itself, the Revised column is used and the difference is explained on the page: for 2025 the 2027 book prints $13,479,257 (Proposed column) and $25,604,677 (Revised column), so 2025 shows +111.2%, flagged on the chart bar and the table row with a link to the known issues and the source page. A one-line note ties its "Revenues" to the General Fund revenue (revenues plus the reserve draw). For 2026 Projected and 2027 Revised the draw equals the page's drawdown; for 2027 Proposed the city's own page does not add up (a $475,000 gap, logged in the known issues), and `check_dataset.py` reports it rather than forcing it.
- **Jump to… search** (header): finds departments, bureaus and line items (by name or account code). A line item opens its bureau page with the line-item search filled in. Keyboard and screen-reader accessible (combobox).
- **What changed** (`#/changes`; reached from the summary at the top of the home page and from every department page): what is different in the newest budget. It follows the Fund selector (General Fund by default) and the Proposed / Revised choice, and compares with the prior year's **Projected** figure by default. A badge says when a proposal is being compared with a year-end estimate or with actual spending, with a one-click switch to the latest **Actual**. The page shows:
  - a one-sentence summary generated from the data (for example: "The 2027 Revised budget spends $87.8M from the General Fund, $5.0M (6.1%) more than the city expects to spend in 2026. $1.25M of that is Street Cleaning and Trees work moved from the Stormwater Management Fund. It's balanced by drawing $4.8M from the reserve.");
  - four headline numbers: the spending change, the reserve draw, the change in full-time positions, and how the revision changed the proposal;
  - **Moved into / out of the General Fund**: work that moved between funds, found from the city's own line notes ("Budget has been moved to the General Fund …"), with the dollars and positions on each side and the notes quoted. Because the General Fund is paid for mostly by taxes and the other funds by fees, every move into or out of it is called out. In 2027 these are Street Cleaning and Trees (Stormwater → General Fund), Water grounds maintenance (Water → General Fund, billed back to the Water Fund), and nuisance abatement (General Fund → Solid Waste);
  - changes by category and by department (bars, or a table);
  - **Positions**: position counts per org-chart bureau, the "Schedule change" (the two books' schedules compared line for line) and the "Real change". The real change leaves out what is not a real change, and each item is listed with a note: positions that moved between funds with their work; council seats marked full-time in one book and part-time in the next; bureaus a book has no staffing page for (from `known_issues.csv`); a bureau printed under a new org code; and titles renamed between books. Benefits are shown in dollars. Salary growth is not shown here;
  - the largest line-item increases and decreases, and new and removed lines;
  - **How it's paid for**: income changes by source, including the reserve draw;
  - **What the revision changed** (Proposed → Revised), with the tax-policy notes from `data/policy_notes.csv` beside the revenue line each one affects. Tax rates are not in the budget tables, so these notes are entered by hand, each with its source.
  - Each department page has a short "What changed" section (summary, bureaus, positions, largest lines, moves between funds) linking to the full page.
  - The figures come from `web/data/changes.json`, built by `scripts/changes.py` (called by `build_dataset.py`). `check_dataset.py` ties every total in it to the series data and lists each fund shift and position adjustment.
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
| Budgeted positions | [`web/data/staffing.json`](web/data/staffing.json) | Per book. Position changes per bureau are on the "What changed" page |
| Books that disagree | [`web/data/conflicts.json`](web/data/conflicts.json) | Where overlapping books print different values for the same figure |
| What changed | [`web/data/changes.json`](web/data/changes.json) | Newest year compared with the prior year's Projected, the latest Actual, and the Proposal: totals by fund, category, department and bureau, changed lines, shifts between funds, position counts per bureau (raw and adjusted, with artifacts) |
| Tax-policy notes | [`data/policy_notes.csv`](data/policy_notes.csv) | Hand-entered facts not in the budget tables (tax rates), each with a source |
| Tidy per-book tables (CSV) | [`data/processed/`](data/processed/) | `budget_long_*.csv` is the main table: one row per account, year and figure type, with `source_page`. Also: `line_items_*`, `staffing_*`, `fund_balance_*`, `validation_*`, `crosscheck_*` |
| Org chart and descriptions (PDF) | `Budget PDFs - City/2027 Org Chart.pdf`, `Org Descriptions 2027.pdf` | Not budget books; the pipeline skips them |
| Org structure | [`data/org_units_2027.csv`](data/org_units_2027.csv), [`data/org_structure_2027.csv`](data/org_structure_2027.csv), [`data/org_descriptions_2027.csv`](data/org_descriptions_2027.csv) | Departments and bureaus; org code → bureau, with notes; description text with its PDF page. Built into the `org` block of `budget.json` |
| Reviewed source errors | [`data/known_issues.csv`](data/known_issues.csv) | Shown on the site under "Known problems in the source books" |
| Audited corrections | `data/sign_corrections.csv`, `data/ocr_corrections.csv`, `data/staffing_corrections.csv` | Each correction lists its evidence and the value as printed |

The JSON files can also be downloaded from the live site: `<site>/data/budget.json`, `staffing.json`, `conflicts.json` and `changes.json`.

## 3. How to use the site

**Controls** (at the top of the home, department and bureau pages): on wide screens the controls are always shown. On phones they fold into a one-line summary ("Viewing 2027 Revised · compared with 2026 Projected · General Fund · Spending") with a **Change** button that opens them (**Done** closes them); the site remembers that choice in your browser. On department pages, only the funds that department has lines in are offered, and Spending / Income only appears where the department has both. Short "What do these mean?" and "What is a fund?" notes sit beside the controls.
- **Fiscal year:** the year to show.
- **Compare with:** any other year and figure (for example, 2026 Projected), or "No comparison".
- **Fund:** a single fund, "All funds", or the Reserve Fund.
- **Figure:** Proposed / Revised. This only appears for years that have more than one figure.
- **Show:** Spending / Income.

**On the pages:**
- Click a **department card** to open its page. Use the **Department** dropdown on that page to switch departments, and the bureau cards to drill into a bureau.
- **Line items:**
  - the count reads like "97 line items (1 only in 2026 Projected)": every line in the table, and how many exist only in the comparison figure; the header counts the same way;
  - on phones each line's change shows under its amount;
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
data/                 reviewed issues, audited corrections, 2027 org structure and descriptions
data/processed/       extracted CSVs (committed; the site is built from them)
scripts/              extraction, validation and site-data build (see docs/PIPELINE.md)
web/                  the static site (index.html, app.js, styles.css, config.json, data/)
docs/PIPELINE.md      how PDFs become data: OCR, validation, corrections, adding a new book
```
