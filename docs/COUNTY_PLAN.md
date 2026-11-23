# Plan: Lancaster County budget data

Status: step 1 done (see Progress at the end). Written 2026-11-20 from a survey of the three books in `Budget PDFs - County/` and the project's Impeccable context (PRODUCT.md, DESIGN.md, `.impeccable/surfaces/web-index-html.md`).

## Your decisions so far

- **Figures:** County pages show the County's **budget** for each year, down to line items, labelled **"Budget"**. This is a deliberate exception to the city's "one figure per year, never Adopted" rule, because the County books print no actual or projected line items. Category-level actuals can be added later as a clearly labelled comparison.
- **Placement:** the same site (budget.nazwel.net) with a **City / County switch** in the contents rail. The same code and design, with a second config and data folder.
- **Books:** plan around the three books on hand. Older books (2022, 2023) and a check on whether the 2026 book is the adopted edition come later and use the same steps.

## What the County books contain

| Book (file in `Budget PDFs - County/`) | Pages | Text | Prints |
|---|---|---|---|
| `Lancaster%20County%20Budget%20Book%202024_…pdf` | 170 | **scanned** (169 of 170 pages have no text; 70 MB) | 2023 budget, 2024 budget; department summaries with 2022 actual by category (to confirm after OCR) |
| `Budget%20Book%202025%20v4-%20FINAL_…pdf` | 143 | text | 2024 budget, 2025 budget; department summaries: 2023 actual, 2024 adopted, 2025 proposed, by category |
| `2026%20Budget%20Book.pdf` | 149 | text | 2025 budget, 2026 budget only (no actuals anywhere) |

Each book is laid out the same way:

1. **General Fund summaries:** revenue and expenditure by department, by account, and by department plus account. These are 25 pages in the 2026 book (pp. 4–28). Each has a printed `Grand Total` and a `VARIANCE` and `% CHANGE` column.
2. **Operating department pages:** an executive-summary narrative, then a department account table ending in `Revenue Total` and `Expense Total`. These are pp. 31–86 (2026).
3. **Judicial department pages:** pp. 87–104 (2026).
4. **Liquid Fuels and bridge funds:** a balance page with beginning balance, revenue, expenses and ending balance per fund (Act 13, Act 44, Act 89, Liquid Fuels). p. 106 (2026).
5. **County grants and Act 13 information:** an agency grant table and the Act 13 projected balance. p. 110 (2026).
6. **Other funds:** department and line-item tables for the non-General funds. These are pp. 113–123 (2026). The departments are Engineers, Domestic Relations, State Institutions, Youth Intervention Center, Children & Youth, Aging, Drug & Alcohol, Behavioral Health, Intellectual Disabilities, Early Intervention and HUD.
7. **Funded agency pages:** narrative plus account tables. pp. 124–147 (2026).
8. **Capital Reserve Fund:** beginning balance, revenue, current-year capital projects, carried-over projects and ending balance. p. 149 (2026).
9. **Org chart:** the Class 2A county chart. p. 30 (2026), p. 33 (2025).

### How the County books differ from the city's

| | City | County |
|---|---|---|
| Line key | org code (7–9 digits) + object code (6 digits) | department code (letter + 4 digits, e.g. `A1111`) + account (4 digits, e.g. `7113`) |
| Department grouping | first 2 digits of org; 2027 org chart | department letter: `A` general government, `B` courts and row offices, `C` corrections, `D` human services. The org chart groups these under Commissioners, elected officials and judicial. |
| Category | object code ranges | first 2 digits of the account: `61` taxes, `62` licenses, `63` intergovernmental, `64` charges for services, … `71` personnel, `72` operating, `73` services, `74` special services, `75` capital, `79` charges from county agencies |
| Columns | 6 or 8 per year | 2 budgets plus variance and % change (all four checkable) |
| Staffing schedule | yes | **none**: no positions or counts are printed. There is no Staff section for the County. |
| Reserve | General Fund Fund Balance Projection page | no General Fund balance page. The Capital Reserve, Liquid Fuels/bridge and Act 13 balances are printed. |
| Fiscal year | calendar | calendar |

### Problems already visible

- **Split digits:** the text layer splits numbers with spaces, for example `$ 1 6,560` and `$ 7 ,935,488`. The parser must rebuild each amount from characters by position: the `$` sign starts a cell, and digits closer together than a set gap belong to the same number. Text splitting on spaces will not work. This is the same lesson as the city's drawing-order rule.
- **Joined codes:** account codes are sometimes joined to their name (`6111Real Estate At Discount`) and sometimes spaced.
- **Rounding:** the books disagree by a few dollars. The 2025 book's 2025 expenditure total is 186,157,597, and the 2026 book prints 186,157,594 for the same year. The $5 tolerance covers this.
- **Stale footer:** the 2025 book still carries a "11.29.23 2024 Budget Reports" footer on p. 7. That is a possible known-issue entry.
- **Account changes:** wage accounts were merged in 2026. `7112 Executive` and `7114 Staff` were folded into `7113 Professional (Full-Time Employees)`, which is why some lines rise 250–7,000%. Line-level "What changed" must detect these merges and not present them as raises.
- **Deficit:** General Fund revenue is below expenditure in both books: about $5.4M in 2025 and $9.0M in 2026. The books do not say where the money comes from. Treat this the way the city's reserve draw is treated, but only as revenue minus expenditure, and disclose that no balance page is printed.

## Phase 1: Pipeline (Python, `data/processed/`)

Keep the two-layer rule: raw extractions keep every printed column, and a separate build picks the figures shown.

1. **Folder and file names.**
   - Keep `Budget PDFs - County/` and start tracking it in git (all three books are under 100 MB).
   - Rename the files to clean names, decoding `%20`. For example `County-2026-Budget-Book.pdf`. This is the only step that touches the source PDFs.
2. **Configs.** Add `config/county/<book>.json` in the same form as the city configs:
   - page ranges for each section type;
   - column order;
   - the code pattern `^[A-D]\d{4}` with a 4-digit account;
   - the "General Fund" and "Other Funds" section markers.
3. **Extractor.** Add a new `scripts/extract_county.py`. The layouts are too different to share `extract_layout.py`, but it reuses `budget_common.py` helpers.
   - Read characters in drawing order and rebuild split amounts by x-gap.
   - Read the department, account and name, then both budget columns.
   - Read the printed variance and % change, used only for checks.
   - Treat the "Department Account" pages as the line-item source, and the summary pages as checks.
   - Extract the balance pages (Liquid Fuels/bridge, Capital Reserve, Act 13) into `fund_balance_county_*.csv` with their arithmetic.
   - For the 2024 and 2025 books, also extract the category actuals from the "Departmental Budget Summary" pages into `category_actuals_county_*.csv`. They are not shown yet.
4. **OCR.** Run the 2024 book through the existing `ocr_pages.py` at 300 DPI, cached in `data/ocr_cache/`.
   - Expect the same dropped-sign and digit errors as the city's 2026 book.
   - Fixes go in `data/county/ocr_corrections.csv` and `sign_corrections.csv`, each keeping the printed value.
5. **Validation.** Every check runs within $5 and is never widened.
   - Each department's lines must sum to its `Revenue Total` and `Expense Total`.
   - The department pages must equal the "by department" summary rows.
   - Department totals must sum to the General Fund `Grand Total`, and the same for Other Funds.
   - `2026 − 2025 = VARIANCE` on every row, which catches OCR misreads cheaply.
   - Each balance page's chain (beginning + revenue − expenses = end) must hold.
   - **Cross-book check:** the prior-year budget column in book Y must equal the budget column in book Y−1, line by line. Differences go to `conflicts` and are shown, as the city's are.
6. **Ingest.** Teach `ingest.py` to pick `extract_county.py` from the folder or config. Exit codes stay the same: 1 means an unreviewed failure, 2 means an inferred config. `--all` covers both entities.
7. **Hand-maintained files.** These go under `data/county/`:
   - `known_issues.csv`, the correction files and `policy_notes.csv` (County millage, with source);
   - `org_units.csv` and `org_structure.csv`, mapping department codes to the org chart groups: Commissioners' departments, elected row offices, courts, corrections, human services and funded agencies.
8. **Data model.**
   - Use the same `budget_long_*.csv` columns, with `doc_type` set to `budget`.
   - Use `account_code = <dept>-<account>`.
   - Add an `entity` column (`city` or `county`), or split by file prefix (`county_budget_long_*.csv`). Prefer the file prefix: it leaves every city file and check untouched.

## Phase 2: Build (`web/data/county/`)

1. Generalise `build_dataset.py` to take `--entity county`, reading `config/county/` and `data/county/` and writing `web/data/county/budget.json`, `changes.json` and `conflicts.json`. There is no `staffing.json`.
2. **Figure rule for the County:**
   - Each year shows the budget from the **newest book that prints it**. For example, 2025 comes from the 2026 book's "2025 BUDGET" column, which is the adopted figure. Its own book printed the proposed figure.
   - Record which book each figure came from, and flag any year where the two books differ.
   - The measure label is "Budget" for every year. The newest year is "Budget" too, with a note that the book was presented for adoption on a stated date (the 2026 book cover letter is dated Dec 3, 2025, with the vote set for Dec 24, 2025).
3. **Changes:** `changes.py` compares the newest budget with the prior one, by line, using the account-merge map from step 1.5 so merged wage accounts net out.
4. **Checks:** `check_dataset.py --entity county` recomputes every shown figure and must report "0 series mismatches". The Pages workflow runs build and check for both entities, and either one failing stops the publish.

## Phase 3: Site (`web/`), checked against Impeccable

The surface mode stays **Read**, with Operate controls. The direction contract ("The Printed Budget Book") is kept; the County is a second volume of the same book, not a new look.

### Structure
- **Entity switch:**
  - Two tabs at the top of the contents rail, under the name: "City" and "County".
  - They are square, 1px ink, and inverted when selected, matching the existing tab rule.
  - Routes become `#/county/...`, while plain `#/...` stays the city so every existing link keeps working.
  - The choice is remembered per visitor in `localStorage`, inside try/catch.
- **Config:**
  - `web/config.json` gains an `entities` map. Each entity has the existing keys: name, possessive, tagline, footer, `default_fund`, data path and pdf path.
  - The County default fund is the General Fund, which is tax-funded as it is for the city.
  - Its disclaimer reads "not associated with the County of Lancaster".
- **Pages:**

  | Page | County version |
  |---|---|
  | Overview | headline and deck verdict: up or down by how much, and the revenue gap |
  | What changed | line changes, with account merges noted |
  | Department pages | grouped by the County org chart |
  | Line-item drill-down | same as the city |
  | Balances | the City's Reserve Fund entry becomes the County's printed balance pages (Capital Reserve, Liquid Fuels and bridge, Act 13), each with its own chain |
  | About | the County's sources and known issues |

- **No Staff section** for the County. Hide the nav entry, rather than showing an empty one.
- **Deck sentence:** the city says "draws $4.7M from the reserve". The County says "spends $9.0M more than it expects to collect", and the About page states that the book prints no General Fund balance page.

### Design compliance (DESIGN.md rules to hold)
- **Money Colors:** green only for the figure being read, and red only for the revenue shortfall, always with a minus sign. No new accent color for the County. The entity is told apart by its name, running head and tabs, not by color.
- **Never-Color-Alone:** the County's budget-vs-budget comparison uses the existing comparison encoding (ink gray, thinner, dashed and hollow).
- **Tokens-In-:root:** no new colors. If a County mark is ever needed, it is added to all three `:root` blocks, with the dark tokens retuned.
- **No-Box:** the switch and the balance pages use the open ruled sections and the 3px double rule.
- **Quiet PDF links:** every County amount links to its page in the County book (`pdfs/county/<book>.pdf#page=N`) with no "p. N" text. `web/pdfs` gains a `county` link, and the workflow's `cp -RL` copies it.
- **Labels:** "Budget" everywhere for County figures, and never "Adopted" or "Proposed" on screen. DESIGN.md's "Don't show Adopted" entry gains a County exception note.
- **The † calculated mark:** applies the same way where a County total is summed from lines and differs from the printed `Grand Total` by up to $100.
- **Wording:** County department names come from the book, in its own capitalisation. The book's "Agricultrl Supplies" abbreviations stay as printed, as the city's do.
- **Phones:** the switch must fit the 375px rail drawer, with 44px touch targets. Text stays full width, per your earlier choice.

### Impeccable workflow for the build
1. Update the surface brief (`.impeccable/surfaces/web-index-html.md`): add the entity switch to the FIRST VIEWPORT text and record the County figure-label decision under Decisions.
2. Read `reference/craft-floor.md` before the first UI edit, as the skill requires.
3. After the UI is done, run `impeccable detect --json --changed` once. The only expected finding is line length, which follows from your full-width text choice.
4. Capture screenshots with `impeccable shot` at desktop and 375px, in light and dark, for both entities. Then run the finish review (the `impeccable-finish-reviewer` agent) against the direction contract.
5. Refresh `.impeccable/design.json` with `document`. The context check reports it as stale already.

## Phase 4: Documentation

- **README:** the County view, its figure rule and why it differs, and its data files.
- **PIPELINE.md:** the County layout, the split-digit rebuild, the account-merge map and the County checks.
- **REBUILD.md:**
  - a County book table and `ingest.py` for County books;
  - `build_dataset.py --entity county` and `check_dataset.py --entity county`;
  - the County OCR time;
  - the yearly County update steps.
- **DESIGN.md and PRODUCT.md:** the entity switch and the County label exception.
- **Your local files:** CLAUDE.md gets the County rules; EDITING.md gets the switch and County wording rows. Neither is committed.

## Order of work and size

| Step | Work | Depends on |
|---|---|---|
| 1 | Track and rename the PDFs; configs; `extract_county.py` for the 2026 and 2025 text books, with every check passing | — |
| 2 | OCR the 2024 book and clear its checks | 1 (same extractor) |
| 3 | `build_dataset.py` and `check_dataset.py` for `--entity county`; changes with the account-merge map | 1 |
| 4 | Site: config entities, switch, County routes, Balances page | 3 |
| 5 | Impeccable detect, screenshots and finish review; DESIGN.md and design.json | 4 |
| 6 | Docs; a from-scratch rebuild test of both entities | 4 |

Steps 1–3 can be checked without touching the site. Step 2 can run alongside step 3 once step 1's extractor is settled. Work on a branch off `main`, not on `feature/printed-flag-personnel`, so the County work does not wait on that branch.

## Open questions to settle during the build

1. Is the 2026 book the **proposed or the adopted** edition? Its cover letter presents it for a Dec 24, 2025 vote. If an adopted edition exists, swap it in using the amended-edition steps in REBUILD.md.
2. Does the County publish **actuals** anywhere else, such as an annual financial report? That would allow an "Actual" series later, at category level or better.
3. The **General Fund gap**: does the County print where it comes from (unassigned fund balance)? If a balance figure is found, the Overview can say "draws $X from the reserve", as the city's does.
4. Should the 2024 book's **2023 budget column** be shown? That gives four years: 2023–2026. The plan assumes yes.

## Progress

**Step 1, done (2026-11-20).**

1. **PDFs:** renamed to `County-<year>-Budget-Book.pdf`. Each config keeps the original file name.
2. **Configs:** `config/county/` has one per book.
3. **Code:**
   - `scripts/county_rows.py` rebuilds the split amounts by position.
   - `scripts/extract_county.py` extracts and checks each book.
   - `ingest.py --county`, or naming a County PDF, runs the County books.
4. **Checks:** every check passes in both text books:
   - 2025 book: 1,794 lines, 2,901 checks.
   - 2026 book: 1,743 lines, 8,262 checks, including every department page line by line.
5. **Cross-book check:** the two books' 2025 budgets agree on all 1,927 lines except 10. Those 10 are the County folding 7216 Printing Supplies into 7215 Office Supplies (net $0).
6. **Account merges:** recorded with evidence in `data/county/account_changes.csv`. The 2026 book also merges wage accounts 7112 and 7114 into 7113.
7. **Facilities costs:** the department pages fold the Facilities Management costs charged to the Children & Youth (fund Y) and Behavioral Health (fund H) funds into those departments. The reports list the same costs under A3100. The 2026 config records this.

**Still open from step 1:**
- The 2025 book's "Departmental Budget Summary" pages (2023 actuals by category) are not extracted yet.
- Fund letters (B, E, EI, F, G, H, R, Y) have no printed names. They are kept as "Fund B" and so on until a source names them.

**Step 2, done (2026-11-21).** The scanned 2024 book now goes through the same extractor and passes every check.

1. **Layout:** same page types as the 2025 book.
   - General Fund by department: p7 (revenue), p9 (expenditure).
   - General Fund by account: p8, pp10–11.
   - General Fund Department Account detail: pp99–101 (revenue), pp103–120 (expenditure).
   - Other Funds: by department p159, detail pp160–168.
   - "Departmental Budget Summary" pages: pp17–155, with 2022, 2023 and 2024 columns; not extracted yet.
   - Two differences: the tables print the new year first ("2024 BUDGET | 2023 BUDGET"), and pp111 and 112 are bound in the wrong order. The config's `column_years` and `page_order` handle both.
2. **OCR:** `ocr_pages.py --clean`, at 400 DPI (not the 300 the plan assumed).
   - The photocopy shows the back of each sheet through the paper, so Tesseract's own threshold reads it as text. `clean_scan` thresholds at 140 and erases the dashed table rules.
   - Pages are stretched 1.25× before OCR, so the 2024 column's touching digits come apart.
   - Sample of 10 table pages, rows whose printed variance matches: under 5% raw, 87% cleaned at 300 DPI, 89% at 400 DPI, 93% stretched.
   - The cache is separate (`dpi400-clean4`). City books use the old path, which is unchanged.
3. **Rows:** `county_rows.read_words` runs on a text-layer or OCR word list; the text path is unchanged.
   - For OCR: `ocr_words` reads the TSV, `ocr_lines` restores the report title and header for `page_kind`, and `ocr_bounds` finds the four cells from the amounts' right edges.
   - `ocr_label` tidies codes and specks; rows are Tesseract's own lines.
4. **Corrections:** `data/county/ocr_corrections.csv` has 177 fixes on 33 pages, each with the value as read and its evidence (the City file's columns).
   - 84 came from `scripts/county_ocr_corrections.py`, which proposes a fix only when the printed variance and % change agree on it. Each was checked against the page image.
   - 93 were read from the page image. Most are rows printed "- / 0.00%", where % change cannot say which year was misread. Every one was confirmed by the department totals and the by-department and by-account reports.
   - By cell: 99 in the 2024 column, 40 in the 2023 column, 30 variance, 8 labels.
   - No source errors were found: `known_issues.csv` is unchanged.
5. **Checks:** 2,795 checks, 0 failures; 1,720 lines (General Fund 1,246, Other Funds 474).
6. **Cross-book:** the 2024 book's 2024 budget equals the 2025 book's 2024 column on all 1,816 lines (0 differ). The County did not amend the 2024 budget between the books, and no OCR misread is left in that column. The 2023 column has no second book to compare against; the totals and reports check it.
7. **A check fix from step 1:** flag-type checks (unparsed row, department code, department total name) recorded printed 0 vs parsed 1, which the $5 tolerance passed. They now always fail. The 2025 and 2026 books still pass every check.

**Still open from step 2:**
- The 2024 book's "Departmental Budget Summary" pages (2022 actuals by category) are not extracted.
- Corrections are keyed by the row's label as read. A re-OCR with another Tesseract version reads differently, and its stale corrections fail the run until they are re-keyed. `county_ocr_corrections.py` re-proposes the arithmetic ones.

**Step 3, done (2026-11-20).**

1. **Build:** `python3 scripts/build_dataset.py --entity county` runs `scripts/build_county.py`.
   - It reads `data/processed/county/` and `data/county/`, and writes `web/data/county/budget.json`, `changes.json` and `conflicts.json`. There is no `staffing.json` and no reserve.
   - The default (`--entity city`) is unchanged. With a fixed `PYTHONHASHSEED`, the City JSON and the City check output are byte-identical to before, apart from the timestamp.
2. **Figure rule:** each year shows measure `budget` from the newest book that prints it:
   - 2024 from the 2025 book;
   - 2025 and 2026 from the 2026 book.
   A 2024 book will add 2023 with no code change; this was tested with a stand-in book.
3. **Line key:** lines are keyed by fund plus account code. A3100 Facilities Management prints the same accounts in the General Fund and in Funds Y and H.
4. **Shapes follow the City JSON** so `app.js` can reuse its code:
   - Revenue lines have category `Revenue`, with the printed revenue category (Taxes, Intergovernmental, …) as their `bureau`. This matches the City's printed revenue group.
   - Expense lines keep the printed category, with the department name as their `bureau`.
   - `org.departments` are the four letter groups, and `org.units` are the 51 department codes.
   - Each series also has `book_year`. The County `rule` has no `book_offset`, so Phase 3 must handle `bookYearOf()` in `app.js`.
5. **Groups:** `data/county/org_units.csv` has one row per department code. Each row has:
   - the department name as printed in the newest book that has it;
   - its letter group (A general government, B courts and row offices, C corrections, D human services);
   - the book section and divider page in the 2026 book: Operating p29, Judicial p87, Liquid Fuels p105, Funded Agencies p124;
   - its department page.
   A2400 and A2413 appear only in the 2025 book (p66). A code the file does not list is placed in its letter group under its printed name, with a note, so a new book never stops the build.
6. **What changed:** 2026 against 2025, line by line, using `changes.compare`.
   - The merges in `account_changes.csv` are folded into both years, so wages are compared as 7112 + 7113 + 7114 against 7113.
   - The 41 merged lines are listed under `merges`, with each component account and page.
   - Totals: spending is $319.3M → $340.0M (+$20.6M), and income is $312.7M → $330.9M (+$18.2M).
7. **Conflicts:** there are 11 lines where the 2025 book's 2025 column differs from the 2026 book's:
   - ten are the 7216 → 7215 fold, each tagged with `account_change`;
   - one is A2410-7115, by $2 (326,483 against 326,485).
8. **Checks:** `python3 scripts/check_dataset.py --entity county` runs `scripts/check_county.py`. It recomputes everything from the CSVs without importing the build:
   - the figure rule;
   - every line and its page;
   - fund totals;
   - 298 printed totals;
   - the org mapping and its sums;
   - every changed line, merge and scope total;
   - the conflicts list.
   Result: "0 series mismatches". Tampered JSON fails, as expected.
9. **Known issue:** in the 2026 book, the General Fund expense lines add to $7 (2025) and $11 (2026) more than the printed Grand Total on p28.
   - Each department is within $3 of its printed total, so the gap is rounding spread over many departments.
   - It is logged in `data/county/known_issues.csv`.
10. **Publish:** `.github/workflows/pages.yml` builds and checks both entities in separate steps, so either one failing stops the publish.

**Found in passing:** the City build is not byte-stable from run to run. `changes.json` key order follows Python's string hash seed, although the values are identical. This was already true before step 3.

**Actuals, done (2026-11-21).** Audited actuals for 2023, 2024 and 2025 come from the County's ACFRs (budgetary basis), following the import spec in `docs/COUNTY_RESEARCH.md`. 2026 stays budget-only until its ACFR (mid-2027).

1. **Sources:** `Budget PDFs - County/ACFR/County-ACFR-<year>.pdf` (6.2, 7.3 and 2.8 MB). Each `config/county/acfr/<year>.json` records the archive URL, the direct download URL and the schedule pages (PDF page numbers).
2. **Extractor:** `scripts/extract_county_acfr.py` reads the seven budget-vs-actual schedules per year: General Fund; Children & Youth (Y); Behavioral Health & Developmental Services (H, R and EI combined); Domestic Relations (F); Office of Aging (G); Drug & Alcohol (E); Liquid Fuels (B).
   - It writes `data/processed/county/actuals_acfr_<year>.csv` (Original, Final, Actual and Variance) and `validation_acfr_<year>.csv`.
   - Split amounts are rebuilt by position: pieces of one amount touch (under 3 pt apart), and each amount goes to the column header it sits under.
   - 677 checks: lines add to the printed totals; Excess and Net change foot; every printed variance is the favourable difference from the final budget; the cash-basis fund balance rolls forward; the modified-accrual balance reconciles and equals Table 3; General Fund transfers out equal the governmental funds statement (p43); each later ACFR's Table 3 agrees with the earlier ones.
3. **Tie-outs to the books** (the book the site uses for each year):
   - General Fund original revenue ties in all three years; 2025 original expenditure plus transfers ties.
   - Every special fund's original revenue plus transfers in ties in all three years.
   - Differences, all logged with evidence in `data/county/known_issues.csv` (24 new entries):
     - General Fund original expenditure, 2023 (+7.76M) and 2024 (+16.30M). Cause not found.
     - Special-fund original expenditure, 2023 and 2024. Each gap equals the ACFR's own planned deficit, which the books do not show. Fund B's gaps are only partly explained.
     - Children & Youth 2025: the ACFR's original expenditure repeats the 2024 figure.
     - **New source error:** the Liquid Fuels schedule's Excess and Net change variances are wrong in all three ACFRs. They subtract the expenditure variance instead of adding it. The 2023 Transfers in variance is blank.
     - **2024 transfers out:** the schedule prints (18,962,872), the 2023 figure. The p43 statement prints (21,630,095). The site shows the printed (18,962,872), flagged (see "Printed-totals rule" below); the 2024 General Fund net change is flagged too.
4. **Build:** `budget.json` has measure `actual` in a separate `actuals` block (not `series`; these are not account lines).
   - Levels: fund totals; transfers; General Fund revenue by source; General Fund spending by function.
   - Each figure carries its ACFR document and page, the ACFR's final budget, and any flags.
   - The ACFR's Original column and its variances are never exported.
   - `actuals.book` gives the books' budget totals for the same fund and year.
   - `actuals_note` has the site wording.
   - `fund_balance_gaap.json` holds the Table 3 GAAP fund balances, kept apart from the budgetary rows.
5. **Checks:** `check_county.py` recomputes every actual figure from the CSVs and fails on any ACFR difference over $5 that `known_issues.csv` does not list. Result: "0 series mismatches".
6. **City:** the City output is unchanged (same content as before, apart from the timestamp).

**Still open from Actuals:**
- Site work: show actuals beside the fund totals, and General Fund by source and by function (`web/app.js` is untouched).
- 2026 ACFR (about mid-2027): add `config/county/acfr/2026.json` and run `scripts/extract_county_acfr.py`.
- A department-to-function mapping stays out. Research section 5 shows it can only be approximate.

**Printed-totals rule, done (2026-11-21).** The user's rule: show every figure exactly as printed. Our sums are used only to flag a printed figure that is wrong or a line that is missing. Rounding-only gaps get no flag.
- `budget.json` `printed` now holds every total the books print for each shown year, 1,054 values in all. These are department Revenue/Expense totals, the General Fund and Other Funds grand totals, and the by-account report's account rows and account-group totals, each with its page. The printed figure is the displayed total.
- A `flags` record (`{year|budget: {sum, gap, lines, allowance, known_issue, kind}}`) appears only where the lines miss the printed figure by more than max($5, $0.50 × lines summed). There are none today.
- A rounding-only gap explained in `known_issues.csv` is linked in `notes` and is not flagged. This covers the 2026 book's $7 / $11 General Fund gap, and a newly logged $6 gap in the 2024 book (2023, p120).
- `known_issues.csv` has a new `kind` column: `rounding`, `source_error` or `basis_difference`.
- The 2024 ACFR General Fund transfers out is shown as printed on p114, (18,962,872), and flagged. `acfr_substitutions.csv` is removed. ACFR figure flags are now `[{known_issue, kind}]`.
- `check_county.py` checks that every printed total is shown exactly as printed, and that every one the books print is there. It recomputes each flag and note (a gap beyond rounding with no known issue fails), and checks that no actual carries a substituted value. Result: "0 series mismatches".

**Step 4, site pages (2026-11-21).** The County pages are in `web/`; the City output is unchanged (checked: the rendered text, links and titles of nine City routes are identical to `main`'s).
1. **Switch and routes:** City / County tabs under the site name in the rail. `#/county/...` is the County, plain `#/...` the City. A bare address opens the last choice (`localStorage`, in try/catch). `config.json` has an `entities` map (name, wording, default fund, fund names, adopted-resolution text, data and PDF paths, optional data files). Each entity's data loads once, on first visit.
2. **Pages:**
   - Overview: deck "General Fund spending up $15.8M (8.5%) from the 2025 Budget, spending $9.0M more than it expects to collect", with a note (spending $201,945,900 against income $192,961,058, a gap of $8,984,842 calculated) that the book prints no General Fund balance page, and the audited General Fund balance from the ACFR. The status line cites Resolution 79 of 2025.
   - What changed: from the County `changes.json`; account merges are noted under the merged lines and described on About.
   - Departments: the four letter groups, then the departments, then line items. Fund selector with the fund names.
   - About: sources and the figure rule, Actual figures (all `actuals_note` wording), departments and fund names, the audited General Fund balance, validation, merged accounts, printed and calculated totals, known problems, downloads.
   - No Staff section and no Reserve Fund entry. There is no Balances page yet (the Capital Reserve, Liquid Fuels/bridge and Act 13 balance pages are not extracted).
3. **Actuals:** a Budget and Actual section on the overview: fund totals (income and spending, 2023–2025), and for the General Fund, income by source and spending by function as their own tables. 2024 transfers out and net change keep the ≠ flag with the known-issue note. No variance is computed and the ACFR's Original column is not used.
4. **Printed totals:** the County's `printed` items have no member lists, so `app.js` derives what each covers from its kind, fund group, department, account or account group (as `build_county.py` does) and applies the same rule as the City.
5. **PDFs:** `Budget PDFs - City/county` is a symlink to `Budget PDFs - County`, so `web/pdfs/county/` resolves (the workflow's `cp -RL` copies it). Audited reports are under `pdfs/county/ACFR/`.
6. **Checks:** City and County builds and checks both report 0 series mismatches. Impeccable detect: 66 advisory findings, none non-advisory and none on the new rules (all existing).

**Still open:** a Balances page for the County's printed balance pages; Budget-side figures by revenue source and function (the books and the ACFR classify them differently); screenshots with `impeccable shot` and the finish review; refreshing `.impeccable/design.json`.

**Merge and design review (2026-11-22).** The pages branch and `origin/main` (9902a05) are merged into `feature/county` (not pushed).
- **Conflicts in `web/app.js`:** eight, in the deck and header order, `fromPhrase`, the What changed line table, the What changed controls (kept main's `fundOptions` and `tabField`), the not-found fund note, the Positions panel and the department What changed block. In each, main's version was kept and the County additions (`isCounty()`, `fn()` fund names, `bud()`, `mergeNote()`, `countyGapNote()`) were re-applied on top. The other conflicts were the `check_dataset.py` docstring and the surface brief.
- **Result:** the County gets main's single Change view / Close strip and Fund-list rules through the shared code. City checks: 0 series mismatches; County: 0 series mismatches.
- **Review:** see the notes in the commit message and DESIGN.md.


**Step 6, docs and rebuild test (2026-11-22).** README, PIPELINE and REBUILD now cover the County: where the books and audited reports live (all tracked, 99 MB, with a source address for each), `ingest.py --county`, the 2024 book's OCR and corrections, `extract_county_acfr.py`, both builds and checks, the hand files in `data/county/`, Budget and Actual labelling, the printed-totals rule, the City / County switch, and a yearly County update.
- **Rebuild from a fresh clone, following REBUILD.md:** City and County ingest passed (County 2024: 2,795 checks; 2025: 2,901; 2026: 8,262; audited reports 677 checks); both checks report 0 series mismatches; every `web/data` JSON matched the committed one except timestamps.
- **Found and fixed:** (1) the docs did not say the pinned packages do not install on Python 3.13+ (the system `python3` here was 3.15); they now say to use 3.9 to 3.12. (2) The County `printed` account-group names depended on the hash seed when OCR variants tied, so two builds differed; `build_county.py` now sorts before choosing, and the County JSON was regenerated.

**General Fund Balance (2026-11-22).** The County's budget resolutions now give the Budget side of the General Fund balance.
- **Sources:** Res 91 of 2023 (2024 budget), Res 83 of 2024 (2025) and Res 79 of 2025 (2026), saved as `Budget PDFs - County/Resolutions/County-Resolution-<n>-of-<year>.pdf`, with `config/county/resolutions/<budget year>.json` (URL, the County's file name, reprints). Res 109 of 2022 (2023 budget) is not used, so 2023 has an Actual balance only.
- **Extractor:** `scripts/extract_county_resolutions.py`, run last by `ingest.py --county`. 181 printed figures (every cell of the General Fund, Other Funds and Total columns, the tax rate, assessed value and increase, and the footnotes) to `data/processed/county/resolutions_county.csv`; 201 checks to `validation_resolutions_county.csv`, all within $5 (largest $2): lines to totals, columns across, start + receipts − expenditures = remaining, planned draw = expenditures − receipts, General Fund totals against every book's printed Grand Total for the year, and the 2025 book's p3 reprint of Res 83 figure for figure.
- **General Fund figures:** 2024 receipts 182,661,641, expenditures 182,561,641, start 61,869,512 (+ 6,376,194 encumbrances, spent as 2023 commitments), remaining 61,969,512 (a planned 100,000 addition). 2025: 180,750,776, 186,157,596, start 69,155,866, remaining 63,749,046 (draw 5,406,820). 2026: 192,961,058, 201,945,900, start 73,232,203 (estimated), remaining 64,247,361 (draw 8,984,842).
- **Known issue logged:** Res 83 dates its opening balance, 69,155,866, 12/31/24, but that is the audited balance at 12/31/2023 (audited 12/31/2024: 74,186,759). Kind `basis_difference`.
- **Site:** "General Fund Balance", last in the County Fund list and in the header (the City's Reserve Fund slot). Budget (resolutions) and Actual (audited ACFR year-ends, with unassigned) are separate entries in `budget.json` `reserve`, shown side by side in a grouped chart and a per-year table and never combined; the planned change is labelled calculated; a quiet note under each Budget year gives the audited balance for the same date. Every figure links to its PDF page. The Overview deck now says the gap is "covered from the General Fund's balance" and links to the page (the separate gap and audited-balance notes under the deck were folded in on 2026-11-22; their detail is on the General Fund Balance page); About describes both measures and lists the resolutions.
- **Checks:** `check_county.py` section 8 recomputes the block from the CSVs (and fails on a planted $10 change). County and City checks both report 0 series mismatches. Browser-checked at desktop and 375px in light and dark.

**Still open:** Res 109 of 2022 if a 2023 Budget balance is wanted; the 2027 resolution when adopted (about Dec 2026).

**Elected offices (2026-11-22).** Department pages and lists say which departments are headed by an elected official. The book's four groups and their printed totals are unchanged.
- **Data:** `data/county/elected_offices.csv` (department code, label, the sentence shown, the printed source page, other pages that say the same). `build_county.attach_elected` puts it on each unit in `budget.json` `org.units[].elected`; a row that names a department `org_units.csv` lacks stops the build.
- **Sources:** the audited 2025 report (p.10: three Commissioners elected, row offices elected for four-year terms; p.16 organizational chart; p.17 list of elected officials), slide 3 of the 2026 budget presentation (asterisks), and, for the row offices, the budget book's account 7111 "Elected Officials" with a figure on the department page. Judicial Operations cites book p.89 (staff supporting the Common Pleas judges); Magisterial District Court cites the report's p.16 chart.
- **Labelled "Elected office" (10):** Commissioners Office, Treasurers Office, Controllers Office, Recorder of Deeds, Clerk of Courts Office, District Attorneys Office, Register of Wills Office, Prothonotary, Sheriffs Office, Coroners Office. **Labelled "Elected judges" (2):** Judicial Operations, Magisterial District Court (they serve elected judges but are not headed by one, and the line says so).
- **Left out:** Court Administration, Law Library, Legal Services, Court Reporters, Jury Services, Domestic Relations, Adult Probation (APPS), Juvenile Probation (appointed court staff); Public Defender and every other department (no asterisk on the chart); Tax Collectors (not on the chart; the County books only print the account). Constables are marked elected on the report's chart but have no County department.
- **Site:** a quiet label and one linked sentence on the department page, a small tag in the department cards, and a paragraph on About ("How the County is run").
