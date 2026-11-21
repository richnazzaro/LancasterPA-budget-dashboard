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
