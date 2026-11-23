# Lancaster Budget Explorer

A public, independent view of the **City of Lancaster, PA** budget, built from the city's published budget books.

**Live site:** https://budget.nazwel.net

**Contact:** budget@nazwel.net, for errors or questions about a figure. The site shows it in the footer and on the About page; it is set by `contact_email` in `web/config.json`.

This README covers how the site presents the data, where the data lives, and how to use the site. For how the PDFs are turned into data, see [docs/PIPELINE.md](docs/PIPELINE.md). To rebuild everything by hand from a fresh copy (setup, extraction, checks, preview and publishing), see [docs/REBUILD.md](docs/REBUILD.md).

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

### City and County
The two tabs at the top of the left rail (**City**, **County**) switch between the City of Lancaster and Lancaster County. County pages live at `#/county/...`; a plain `#/...` address is still the City, so every existing link works. A bare address opens the entity the visitor last chose (kept in `localStorage`). `web/config.json` has an `entities` map (name, wording, default fund, fund names, data and PDF paths); the County's data is `web/data/county/` and its books are served from `pdfs/county/` (`Budget PDFs - City/county` is a symlink to `Budget PDFs - County`, so the publish workflow's `cp -RL` copies them).

The County view shows the same pages with County figures, all labelled **Budget** (the newest year, 2026, was adopted Dec 24, 2025 by Resolution 79 of 2025), plus:
- the fund letters with their names (Liquid Fuels, Drug & Alcohol, Early Intervention, Domestic Relations, Aging, Behavioral Health, Developmental Services, Children & Youth);
- departments grouped as the County's book groups them (General Government, Courts and Row Offices, Corrections, Human Services), each with its departments and line items;
- the deck sentence "General Fund spending up $15.8M (8.5%) from the 2025 Budget, spending $9.0M more than it expects to collect", with a note that the year's budget resolution covers the gap from the General Fund's balance (linked to the General Fund Balance page);
- **Budget and Actual**: audited 2023–2025 Actual from the County's annual financial reports beside the Budget, only at fund totals (income and spending), plus General Fund income by source and spending by function as their own small tables. No variance is shown, and the report's own "original budget" column is never used;
- **General Fund Balance** (last in the Fund list, and in the header, as the City's Reserve Fund): two measures side by side, never combined. **Budget**, from the budget resolution adopted with each year's budget (Res 91 of 2023, Res 83 of 2024, Res 79 of 2025): the balance at the start of the year, receipts, expenditures, the planned draw (calculated: $5.4M in 2025, $9.0M in 2026; 2024 planned a $100,000 addition) and the balance remaining. **Actual**: the audited balance at December 31 for 2023–2025 and its unassigned part, from the annual financial reports. A grouped chart, a per-year table and a quiet note under each Budget year give the audited balance for the same date; the resolution balances are budget estimates and do not tie (Res 83 dates $69,155,866 12/31/2024, but it is the audited 12/31/2023 balance; logged in the known issues). Every figure links to its PDF page;
- **The 2026 Budget in Context** (overview, below Budget and Actual): the 10% tax increase and the tax rate (3.201 mills, from 2.911), the taxable assessed value, the bond rating (Aa2), the funded staffing positions (1,929), the Capital Improvement Fund ($10,109,623 for 2026: $4,209,623 carried over from 2025 and $5,900,000 of new projects, counted apart from the operating budget), the agency grants (five from the General Fund, $2,560,716; five from the County's Act 13 funds, $700,000; the RRTA/SCTA transit line of $542,008 is separate) and a small chart of the tax rate from 2017 to 2026, with a note that the 2018 drop came with a countywide reassessment. They come from `data/county/context_facts.csv`; each figure links to the page of the resolution, budget book or audited report that prints it. Only the staffing count rests on the County's budget presentation alone, and says so. None of the presentation's balances or revenue and spending figures is used;
- on About, the General Fund balance section (both measures, the resolutions in use, and the audited balances of every fund group);
- no Staff section (the County prints no staffing schedule).

### What the site shows
- **Home (all departments):**
  - a plain opening sentence saying whether the total is up or down against the comparison, by how much, and, for the General Fund, how much is **drawn from the reserve** (the "Fund Balance Reserve" revenue lines, object `499000`): "Up $5.0M (6.0%) from 2026 Projected, with $4.7M drawn from savings ($1.9M of it from dedicated data center revenue). See the Reserve Fund". Where the Fund Balance Projection page prints a "Committed data center revenue" adjustment and it plus the operating deficit equals the draw (2027 Revised: $4,735,088, of it $1,934,343 data center; 2026 Projected: $6,315,053, of it $4,162,525), the total comes first and the data center part follows in parentheses, both linked to that page; otherwise (2027 Proposed, whose page is $475,000 off) the total stands alone, linked to its revenue page. The same split is used wherever the draw is described: the What changed sentence, tile and lists, the "Fund Balance Reserve" line labels and the Reserve Fund page's tie note; `check_dataset.py` checks both parts against the fund balance CSV and that they add up to the draw. The draw is summed from the data for each figure (2027 Revised $4,735,088; 2027 Proposed $4,268,753; 2026 Projected $6,315,053; none in the Actual years) and shown only where there is a draw;
  - the total itself, **exactly as the city printed it** whenever the book prints a total for exactly the lines in view (a fund total, a department roll-up or a bureau's section total). The site re-adds the lines only to check it: rounding (up to $5 on a section, up to 50 cents a line on a roll-up) is not mentioned, and a real gap keeps the printed figure, adds a ledger-red **≠** and a note with the lines' sum, the difference and the reviewed explanation from `data/known_issues.csv`. Where the book prints no such total (all funds together, departments and bureaus regrouped to the 2027 org chart, categories, a line-item search), the figure is the site's own sum, labelled **calculated**. The same rule applies to the fund table, the department ledger, bureau cards, Totals by Year, line-item footers and What changed; About explains it once;
  - the controls, folded into a one-line strip with the year's status (for example "2027: Revised proposal, not adopted");
  - side by side (stacked on narrower screens): a **"What changed in 2027"** summary (the headline sentence, the four headline numbers and a "See everything that changed" button) and a **"Totals by Year"** line chart. The summary appears for the newest year: on the Spending view it leads with spending and positions, on the Income view with income and the reserve draw (and its button opens What changed at "How it's paid for");
  - a **Departments** ledger: one ruled row per department with the comparison figure, the selected figure, the signed change and its share of the total (the whole row is a link);
  - an "Income vs. Spending by Fund" chart and table.
- **Departments and bureaus follow the city's 2027 org chart** (`Budget PDFs - City/2027 Org Chart.pdf`). Every budget line is placed in an org-chart bureau by its account number (org code), so every year is grouped the same way, even where an older book printed a group under another department or name. For example, Human Resources appears under Executive in every year. The full mapping, with the evidence for each choice, is in [`data/org_structure_2027.csv`](data/org_structure_2027.csv).
- **Department page** (`#/department/public-safety`). Top to bottom:
  - breadcrumbs (Home › Department › Bureau), the total and status, and a row of in-page links (What changed · Compare · Bureaus · Staff · Categories · Line items);
  - **"What does this department do?"**: a collapsible description quoted from the city's `Org Descriptions 2027.pdf`, with a small link to its page in that PDF (closed by default; Legislative, City Controller, Public Safety and General Revenue have none, so it is left out);
  - the controls, folded into a one-line strip with a "Change view" button so the figures come first;
  - **What changed**: the headline sentence (the budget change, amount and percent), then a short summary generated from the data: **budgeted positions** in the prior year's schedule against the 2027 Revised schedule with the net change (how many moved between funds with their work or sit on an office one book prints no schedule page for, and the titles whose count changed where the two books' titles can be matched); the **largest increases or decreases** (up to three line items, or the categories when no few lines explain half the change), each amount linked to its page; and money **moved into or out of the General Fund**. Then the fund moves and, behind short disclosures, the change by bureau, positions and the largest line changes. Bureau pages get the same;
  - **Compare**, one panel with two tabs: "This year vs. comparison" (both totals, the change, the by-category bars and a category table behind "Show as a table") and "Over time" (totals by year; in 2027 Revised is a solid green dot joined by a dashed line and Proposed a hollow diamond; the axis starts above zero and says so);
  - a **bureau list**: one card per bureau or office on the org chart (name, share of the department, selected-vs-comparison bars, the whole card is a link; two columns on wide screens), with several budget groups combined where the chart has one bureau. Budget groups that are not a bureau (for example Administrative Services' city-wide Insurance, Fringe Benefits, Debt Service and Community Involvement budgets, or a department's fee revenue) form one card labelled "Department-wide costs (not a bureau)" or "Department revenue (not a bureau)". Departments with no bureaus on the chart (Legislative, City Controller, and General Revenue, which is not on the chart) have no bureau list and no bureau pages;
  - **Staff**: two tables by bureau and year (on a bureau page, that bureau alone):
    - **Budgeted positions**, 2022–2027 (2027 as Proposed and Revised), from each year's staffing schedule. The city publishes budgeted positions only, never actual headcount, so these years are labelled by year rather than Actual. Counts are as printed (fractions are shared positions); full-time and part-time are not split, because the 2023–2025 books don't mark them. Each count opens its schedule page;
    - **Salaries and wages**: the "Salaries & Wages" budget lines (salaries, overtime, temporary wages; benefits are separate), under the usual one-figure rule (Actual 2020–2025, Projected 2026, Proposed and Revised 2027);
    - on a bureau page, a list of every position title in the newest schedule with its count and salary;
  - a **category table**: each spending category with its amount and a share bar;
  - a searchable, sortable line-item table (20 rows at a time) with the account code under each name and **Export this view (CSV)**, which downloads every row matching the search, with figure, comparison, change and the source book and page, built in the browser.
- **Bureau page** (`#/department/<dept>/bureau/<bureau>`, e.g. `#/department/administrative-services/bureau/bureau-of-treasury`): the same layout for one org-chart bureau, across all its funds and years (including its own compact **What changed** section with positions), with **"What does this bureau do?"** from the descriptions PDF. Public Works bureaus also name their division. The department-wide group has a page too (`.../bureau/department-wide`) that lists the budget groups in it. Older bureau links (`.../bureau/<fund>--<printed group>`) redirect to the bureau that group now belongs to, or to the department page.
- **Reserve Fund** (in the Fund selector): the General Fund balance, from each book's "Fund Balance Projection" page. It shows the year-end balance and how it changes each year, using the same one-figure-per-year rule. Where the city's page disagrees with itself, the Revised column is used and the difference is explained on the page: for 2025 the 2027 book prints $13,479,257 (Proposed column) and $25,604,677 (Revised column), so 2025 shows +111.2%, flagged on the chart bar and the table row with a link to the known issues and the source page. Under the "How the Balance Changes" table, a note explains why the General Fund pages show more income than the Revenues line just above it: the budget counts the money drawn from savings as income (its "Fund Balance Reserve" lines) and the projection does not ("The General Fund pages show $87,718,539 of income for 2027 Revised, not the $82,983,451 on the Revenues line above. The difference is the $4.7M drawn from savings ($1.9M of it from dedicated data center revenue) …"). It appears only for years whose projection prints a Revenues line (2026 Projected, 2027 Proposed and Revised). For 2026 Projected and 2027 Revised the draw equals the page's drawdown; for 2027 Proposed the city's own page does not add up (a $475,000 gap, logged in the known issues), and `check_dataset.py` reports it rather than forcing it.
- **Jump to… search** (header): finds departments, bureaus and line items (by name or account code). A line item opens its bureau page with the line-item search filled in. Keyboard and screen-reader accessible (combobox).
- **What changed** (`#/changes`; reached from the summary at the top of the home page and from every department page): what is different in the newest budget. It follows the Fund selector (General Fund by default; the Reserve Fund too, which shows how the General Fund balance changes: the year-end balance in the newest figure against the comparison's, the Fund Balance Projection lines that move it side by side with their effect on the balance, and the draw as "$4.7M drawn from savings ($1.9M of it from dedicated data center revenue)"; where the comparison year prints only a closing balance, as the Actual years do, it says so) and the Proposed / Revised choice, from every way in: the contents rail link carries the fund, figure, comparison and Spending / Income of the page you are on (from an earlier year it opens the newest year). A fund with no lines in either budget being compared (Liquid Fuels, Long's Park) gets a sentence saying so, with links to the funds that have them; arriving from the Reserve Fund shows the General Fund and says why. "Show first" (Spending / Income) puts that side's sections first. It and compares with the prior year's **Projected** figure by default. A badge says when a proposal is being compared with a year-end estimate or with actual spending, with a one-click switch to the latest **Actual**. The page shows:
  - a one-sentence summary generated from the data (for example: "The 2027 Revised budget spends $87.7M from the General Fund, $5.0M (6.0%) more than the city expects to spend in 2026. $1.25M of that is Street Cleaning and Trees work moved from the Stormwater Management Fund. It's balanced by $4.7M drawn from savings ($1.9M of it from dedicated data center revenue).");
  - four headline numbers: the spending change (on the Income view, the income change), the reserve draw, the change in full-time positions with the number budgeted (its "How this is counted" link opens the Positions section at its explanation, also from the home page), and how the revision changed the proposal;
  - **Moved into / out of the General Fund**: work that moved between funds, found from the city's own line notes ("Budget has been moved to the General Fund …"), with the dollars and positions on each side and the notes quoted. Because the General Fund is paid for mostly by taxes and the other funds by fees, every move into or out of it is called out. In 2027 these are Street Cleaning and Trees (Stormwater → General Fund), Water grounds maintenance (Water → General Fund, billed back to the Water Fund), and nuisance abatement (General Fund → Solid Waste);
  - changes by category and by department (bars, or a table);
  - **Positions**: first the budgeted count for the fund ("Full-time positions budgeted, General Fund: 445.65 in the 2027 Revised schedule, against 427.75 in the 2026 budget book", each count linked to its schedule page, with how many moved in or out with their work and the part-time count), then how positions are counted (each line of a book's position schedule is one position or the share of one paid from that office, full-time and part-time as the schedule marks them, positions paid for rather than people employed), then position counts per org-chart bureau, the "Schedule change" (the two books' schedules compared line for line) and the "Real change". The real change leaves out what is not a real change, and each item is listed with a note: positions that moved between funds with their work; council seats marked full-time in one book and part-time in the next; bureaus a book has no staffing page for (from `known_issues.csv`); a bureau printed under a new org code; and titles renamed between books. Benefits are shown in dollars. Salary growth is not shown here;
  - the largest line-item increases and decreases, and new and removed lines;
  - **How it's paid for**: income changes by source, including the reserve draw;
  - **A line that stands out:** where a line in one of the two budgets being compared is far above the years either side of it (see "Lines that stand out" below), a note names it with its amounts and says what the change would be without it. Comparing 2027 Revised with 2025 Actual: "Leaving that line out, income rises $5.7M rather than falling $1.0M."
  - **What the revision changed** (Proposed → Revised), with the tax-policy notes from `data/policy_notes.csv` beside the revenue line each one affects. Tax rates are not in the budget tables, so these notes are entered by hand, each with its source.
  - Each department and bureau page has a short "What changed" section (headline, a two-to-four-item summary of positions, the largest changes and General Fund moves, then bureaus, positions, largest lines and moves between funds) linking to the full page.
  - The figures come from `web/data/changes.json`, built by `scripts/changes.py` (called by `build_dataset.py`). `check_dataset.py` ties every total in it to the series data, lists each fund shift and position adjustment, and re-derives every number in the department and bureau summaries (`summary` in changes.json) from the series and the staffing CSVs.
- **Lines that stand out:** under **Totals by Year** (home, department and bureau pages), a note names any line whose amount in one year is at least twice its amount in both the year before and the year after (both printed and above zero) and whose jump is at least 5% of its fund's total that year (`SPIKE_X`, `SPIKE_SHARE` in `app.js` `lineSpikes()`; `check_dataset.py` lists the same lines with the same rule). It is found from the lines, never typed in. Today that is four lines: the 2025 General Fund **Building Permits** ($9,032,578 in 2025 Actual, 2027 book p. 42, against $1,339,520 in 2024 and $1,936,328 projected for 2026), the 2021 Sewer and Water OPEB contributions, and 2023 Stormwater professional services. Where `data/line_notes.csv` records what the book says about that line, the note adds it with a link: for Building Permits, that the city used data center building permit revenue to pay $4,162,525 of General Fund debt in 2026 (2027 book p. 7); the book does not break the 2025 figure down.
- **Reading notes:** on wide screens a margin beside the page explains the figure names (Proposed, Revised, Projected, Actual) and other terms.
- **About the data** (`#/about`, linked in the header):
  - which book supplies each year;
  - how the figures were validated;
  - every known error in the city's source books, each reviewed by a person;
  - download links.

Funds: General, Stormwater Management, Sewer, Water, Solid Waste & Recycling, Liquid Fuels, Long's Park, plus the Reserve Fund view. The site opens on the **General Fund**.

## 2. Where the data can be found

| What | Where | Notes |
|---|---|---|
| Source budget books (PDF) | [`Budget PDFs - City/`](Budget%20PDFs%20-%20City/), also published at `<site>/pdfs/` | 2022–2027 books |
| County budget books, audited annual reports and budget resolutions (PDF) | [`Budget PDFs - County/`](Budget%20PDFs%20-%20County/) (books for 2024, 2025 and 2026; `ACFR/` for the 2023–2025 reports; `Resolutions/` for the 2024–2026 budget resolutions; the County's 2026 budget presentation, used only for its context facts), also published at `<site>/pdfs/county/` | Source addresses: [docs/REBUILD.md](docs/REBUILD.md) |
| County data the site reads | [`web/data/county/`](web/data/county/) | `budget.json` (Budget 2023–2026 with its printed totals, the Actual 2023–2025 block, and the General Fund Balance as `reserve`), `changes.json`, `conflicts.json`, `fund_balance_gaap.json` (audited year-end balances) |
| County reviewed files | [`data/county/`](data/county/) | known issues, OCR corrections for the scanned 2024 book, merged accounts, department groups, `context_facts.csv` (the facts in "The 2026 Budget in Context", each with its source page) |
| Data the site reads | [`web/data/budget.json`](web/data/budget.json) | Every figure shown, with its source book and page |
| Budgeted positions | [`web/data/staffing.json`](web/data/staffing.json) | Per book: each year's own schedule (the newest book's Proposed and Revised). Shown in the Staff section of department and bureau pages, and as position changes on the "What changed" page |
| Books that disagree | [`web/data/conflicts.json`](web/data/conflicts.json) | Where overlapping books print different values for the same figure |
| What changed | [`web/data/changes.json`](web/data/changes.json) | Newest year compared with the prior year's Projected, the latest Actual, and the Proposal: totals by fund, category, department and bureau, changed lines, shifts between funds, position counts per bureau (raw and adjusted, with artifacts), and per department and bureau the summary facts (net change, driver lines or categories, positions, named titles, General Fund shifts) |
| Tax-policy notes | [`data/policy_notes.csv`](data/policy_notes.csv) | Hand-entered facts not in the budget tables (tax rates), each with a source |
| Line notes | [`data/line_notes.csv`](data/line_notes.csv) | What the budget book says about one line in one year (year, figure, account, text, `<pdf>#page=N`), shown beside the generated "stands out" note for that line; copied into changes.json `line_notes` |
| Tidy per-book tables (CSV) | [`data/processed/`](data/processed/) | `budget_long_*.csv` is the main table: one row per account, year and figure type, with `source_page`. Also: `line_items_*`, `staffing_*`, `fund_balance_*`, `validation_*`, `crosscheck_*` |
| Org chart and descriptions (PDF) | `Budget PDFs - City/2027 Org Chart.pdf`, `Org Descriptions 2027.pdf` | Not budget books; the pipeline skips them |
| Org structure | [`data/org_units_2027.csv`](data/org_units_2027.csv), [`data/org_structure_2027.csv`](data/org_structure_2027.csv), [`data/org_descriptions_2027.csv`](data/org_descriptions_2027.csv) | Departments and bureaus; org code → bureau, with notes; description text with its PDF page. Built into the `org` block of `budget.json` |
| Reviewed source errors | [`data/known_issues.csv`](data/known_issues.csv) | Shown on the site under "Known problems in the source books" |
| Audited corrections | `data/sign_corrections.csv`, `data/ocr_corrections.csv`, `data/staffing_corrections.csv` | Each correction lists its evidence and the value as printed |

The JSON files can also be downloaded from the live site: `<site>/data/budget.json`, `staffing.json`, `conflicts.json` and `changes.json`.

## 3. How to use the site

**Header:** Overview, What changed, Reserve Fund and About the data, plus **Jump to…** search and the light/dark switch. On wide screens a contents rail shows where you are and an "On this page" list; phones get an "On this page" outline instead.

**Controls** (the same component on every page that has them: home with any fund, All funds and the Reserve Fund, department and bureau pages, and What changed): on every screen size they start folded into a one-line summary ("Viewing 2027 Revised · compared with 2026 Projected · General Fund · Spending") with a **Change view** button that opens them (**Close** closes them); the site remembers that choice in your browser. The strip always starts with the status stamp for the figure in view. Fields come in one order: Fiscal year (not on What changed, which is always the newest year), Compare with, Fund, then the Figure and Spending / Income tabs ("Show first" on What changed). Every Fund list is in the same order: All funds, General Fund, the other funds, then the Reserve Fund last. Home, the Reserve Fund page and What changed offer the Reserve Fund; department pages offer only the funds that department has lines in (the reserve has no departments), with a note under the list saying so; bureau pages have no Fund list (they cover all of a bureau's funds); and Spending / Income only appears where the department has both. Short "What do these mean?" and "What is a fund?" notes sit beside the controls.
- **Fiscal year:** the year to show.
- **Compare with:** any other year and figure (for example, 2026 Projected), or "No comparison".
- **Fund:** a single fund, "All funds", or the Reserve Fund.
- **Figure:** Proposed / Revised. This only appears for years that have more than one figure.
- **Show:** Spending / Income.

**On the pages:**
- Click a **department row** to open its page. Use the **Department** dropdown on that page to switch departments, and the bureau cards to drill into a bureau.
- **Line items:**
  - the count reads like "97 line items (1 only in 2026 Projected)": every line in the table, and how many exist only in the comparison figure; the header counts the same way;
  - on phones each line's change shows under its amount;
  - type in the search box to filter by name, account number, bureau, fund or category;
  - click a column header to sort;
  - use "Show more" to load more rows.
- Under the "Totals by Year" chart, **Show values** opens a table of the numbers behind it.
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
Budget PDFs - City/        source budget books (2022–2027), the 2027 org chart and unit descriptions
config/                    per-book layout settings for the extractor
data/                      reviewed issues, audited corrections, tax-policy notes, 2027 org structure and descriptions
data/processed/            extracted CSVs (committed; the site is built from them)
scripts/                   extraction, validation and site-data build (see docs/PIPELINE.md)
web/                       the static site (index.html, app.js, styles.css, config.json, data/ and data/county/; pdfs/ links to the books, pdfs/county/ to the County's)
docs/PIPELINE.md           how PDFs become data (City and County): OCR, validation, corrections, adding a new book
docs/REBUILD.md            rebuilding everything by hand from a fresh clone, and publishing
.github/workflows/         pages.yml: builds, checks and publishes the site on every push to main
PRODUCT.md, DESIGN.md      who the site is for, and its design system (used with the Impeccable design skill)
.impeccable/               the Impeccable design record (config, design tokens, surface brief)
```
