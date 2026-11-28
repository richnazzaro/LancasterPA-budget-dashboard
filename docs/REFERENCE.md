# Reference: every setting and wording on the site

**Keep this file current.** Any change to `web/` (or to a hand-kept data file listed below) updates this sheet in the same commit: a new setting gets a row, a changed value gets its new value, a removed one loses its row.

This is the index of everything someone might want to change on https://budget.nazwel.net: names, wording, colors, fonts, numbers that steer what is shown, and the data files behind them. Each row gives the file, where to find it (a line link and the exact text to search for), what it controls and its current value. Line numbers drift as files change; the search text does not, so search for it if a line link lands in the wrong place.

How to edit and check:
- Preview locally with `python -m http.server 8765 --directory web` and open http://localhost:8765 (see [REBUILD.md](REBUILD.md#6-preview-locally)). Opening `index.html` from disk does not work.
- `web/` files take effect on reload (Cmd-Shift-R skips the cache). Files under `data/` take effect only after a rebuild: `python scripts/build_dataset.py` and `python scripts/check_dataset.py` (add `--entity county` for the County).
- In `app.js`, page text sits inside template strings (`` `…` ``). Change the words, keep every `${…}` placeholder and HTML tag.
- To find any phrase you see on screen: `grep -n "the phrase" web/app.js`.

Contents:
1. [`web/config.json`](#1-webconfigjson): names, wording and paths for each entity
2. [`web/index.html`](#2-webindexhtml): page title, description, header, navigation
3. [`web/styles.css`](#3-webstylescss): colors (light and dark), fonts, sizes, breakpoints
4. [`web/app.js`](#4-webappjs): labels, constants and wording, by page
5. [Data files the site reads](#5-data-files-the-site-reads-webdata): `web/data/` and `web/data/county/`
6. [Hand-kept data files](#6-hand-kept-data-files-data): `data/` and `data/county/`
7. [Pipeline settings that change what the site says](#7-pipeline-settings-that-change-what-the-site-says)

---

## 1. `web/config.json`

Read once at start-up by `boot()` and `loadEntity()` in `app.js`. The values for the entity in view (`entities.city` or `entities.county`) are merged over the top-level ones. `config.json` wins over the matching text hard-coded in `index.html`.

### Top level

| Key | Current value | What it controls |
|---|---|---|
| `site_title` ([L2](../web/config.json#L2)) | `Lancaster Budget Explorer` | The site name: wordmark in the header, last part of every browser tab title. |
| `contact_email` ([L3](../web/config.json#L3)) | `budget@nazwel.net` | "Questions or corrections" in the footer and the Contact section of About. Remove the key to hide both. |
| `default_entity` ([L5](../web/config.json#L5)) | `city` | Not read by the site today. A bare address opens the entity the visitor last chose (`localStorage` key `entity`), otherwise the City. |
| `entities` ([L17](../web/config.json#L17)) | `city`, `county` | One block per entity, below. The City / County tabs in `index.html` link to these two ids. |
| `tax_estimate` | `rates` `data/tax_rates.json`; `this_year` 2026; `next_year` 2027; `reassessment_year` 2027; `reassessment_source` the County's "Taxpayers Guide to the 2027 Reassessment" (https://co.lancaster.pa.us/DocumentCenter/View/17033/Taxpayers-Guide-to-the-2027-Reassessment-) | The What would you pay? page (`#/tax`, `#/county/tax`). `rates` is loaded once at start-up (shared by City and County; without it the page says the rates could not be loaded and the "Estimate what you would pay →" links are hidden). `this_year` and `next_year` are the two years compared (update both when a new budget year arrives). A property rate whose `assessed_year` is at or after `reassessment_year` asks for "The new value on your reassessment notice"; an earlier one for "The value on your {year} tax bill". `reassessment_source` is the "state law" link in the note on why the City's rate is lower. `lookup` lists the County's property search for each year of value (`assessed_year`, `name`, `search`: 2026 → Property Tax Inquiry, https://lancasterpa.devnetwedge.com/Search/ExecuteSearch; 2027 → 2027 Reassessment Inquiry, https://lancasterpa-reval.devnetwedge.com/Search/ExecuteSearch), used by Find your assessed values. |

### `entities.city` and `entities.county`

| Key | City value | County value | What it controls |
|---|---|---|---|
| `label` | `City` | `County` | Not read by the site today (the tab text is in `index.html`). |
| `title_suffix` ([L45](../web/config.json#L45)) | (none) | `: County` | Added to `site_title` for this entity (the County's wordmark and tab titles read "Lancaster Budget Explorer: County"). |
| `entity.name` | `City of Lancaster, PA` | `County of Lancaster, PA` | Not read by the site today. |
| `entity.short` ([L22](../web/config.json#L22)) | `City of Lancaster` | `County of Lancaster` | The running head above every page heading, the first part of every browser tab title, the Funds and terms cross-link, and the fallback name in "Totals by Year" notes. |
| `entity.kind` | `city` | `county` | Not read by the site today. |
| `entity.possessive` | `the City of Lancaster's` | `the County of Lancaster's` | Funds and terms intro ("Which of the City of Lancaster's funds are paid for by taxes…") and About. |
| `description` ([L26](../web/config.json#L26)) | "City of Lancaster, PA budget by department, bureau and line item, from the city's published budget books." | "Lancaster County, PA budget by department and line item, with audited actuals by fund, from the County's published budget books and annual financial reports." | The `<meta name="description">` once the page has loaded (search engines read the one in `index.html`). |
| `tagline` | "This is an independent project, not associated with the City of Lancaster." | "… not associated with the County of Lancaster." | The disclaimer under the site name. |
| `footer` | "An independent transparency project using the City of Lancaster's published budget books." | "… using the County of Lancaster's published budget books and annual financial reports." | Footer text. |
| `default_fund` | `General Fund` | `General Fund` | The fund every page opens on. |
| `files` | `["changes", "staffing"]` | `["changes", "fund_balance_gaap"]` | Which optional data files to load besides `budget.json`: `changes.json` (What changed), `staffing.json` (Staff section), `fund_balance_gaap.json` (County audited balances). |
| `lazy_files` ([L31](../web/config.json#L31)) | `["positions"]` | (none) | Data files fetched only when the page that needs them first opens: `positions.json` when What changed is first drawn (`loadPositions()`). |
| `adopted` ([L56](../web/config.json#L56)) | (none) | `{ "year": 2026, "text": "adopted Dec 24, 2025 (Resolution 79 of 2025)" }` | Added to the status stamp for that year ("2026: Budget, adopted Dec 24, 2025 (Resolution 79 of 2025)"), and used on Funds and terms and County About. Update it when a new County budget year arrives. |
| `fund_names` ([L58](../web/config.json#L58)) | (none) | `Fund B` → `Liquid Fuels (Fund B)`, `Fund E` → `Drug & Alcohol (Fund E)`, `Fund EI` → `Early Intervention (Fund EI)`, `Fund F` → `Domestic Relations (Fund F)`, `Fund G` → `Aging (Fund G)`, `Fund H` → `Behavioral Health (Fund H)`, `Fund R` → `Developmental Services (Fund R)`, `Fund Y` → `Children & Youth (Fund Y)`, `Fund H+R+EI` → `Behavioral Health, Developmental Services & Early Intervention (Funds H, R, EI)` | How a fund letter is shown everywhere (Fund list, tables, Funds and terms). A fund not listed shows as printed. |
| `budget_calendar` ([L32](../web/config.json#L32)) | `charter_title` "Home Rule Charter"; `charter_url` https://www.cityoflancasterpa.gov/wp-content/uploads/2025/01/Adopted-Home-Rule-Charter.pdf; `old_rules_title` "2024 audited financial statements"; `old_rules_url` https://www.cityoflancasterpa.gov/wp-content/uploads/2025/12/COL-Financial-Statements-2024.pdf | (none) | The How the City budget is made page (`#/budget-calendar`): every § link opens `charter_url` at its page, and the Before 2025 section links `old_rules_url`. An entity without this block gets no nav link and a one-sentence note on that address; About links the page only when it is set. The page numbers are in `CHARTER_PAGE` and `OLD_RULES_PAGE` in `app.js`: check them if a URL changes to a different edition. |
| `paths.data` | `data/` | `data/county/` | Folder the entity's JSON is loaded from. |
| `paths.pdfs` | `pdfs/` | `pdfs/county/` | Folder every "open the source page" link points into. `web/pdfs` is a symlink to `Budget PDFs - City/`, which holds a `county` symlink to `Budget PDFs - County/`. |

---

## 2. `web/index.html`

The page shell. `app.js` replaces the wordmark, tagline, description, footer and nav links once `config.json` loads, so the values here are what shows before that (and what search engines and link previews read).

| What | Search for | Current value | Notes |
|---|---|---|---|
| Browser tab title (before load) | `<title>` ([L6](../web/index.html#L6)) | `Lancaster Budget Explorer` | After load, `pageTitle()` in `app.js` sets "<entity short> · <page> · <site_title>". |
| Page description (search engines, link previews) | `meta name="description"` ([L7](../web/index.html#L7)) | "County and City of Lancaster budget information, straight from their published materials." | After load, replaced by the entity's `description`. |
| Light/dark support | `meta name="color-scheme"` ([L8](../web/index.html#L8)) | `light dark` | Kept in step with the theme toggle by the inline script below it and `applyTheme()`. |
| Saved-theme script | `localStorage.getItem('theme')` ([L13](../web/index.html#L13)) | key `theme`, values `light` / `dark` | Applies the visitor's choice before the first paint. |
| Favicon | `rel="icon"` ([L21](../web/index.html#L21)) | inline SVG: `%231d5a3a` (#1d5a3a green), `%23fcfcfa`, `%237fc99b` | Colors are URL-encoded (`%23` = `#`). |
| Web fonts | `fonts.googleapis.com/css2` ([L24](../web/index.html#L24)) | Source Sans 3 (400–800) and Source Serif 4 (400, 600, 700) | Two copies of the link (one in `<noscript>`): change both. The names must match `--font` and `--serif` in `styles.css`. |
| Skip link | `id="skip-link"` ([L29](../web/index.html#L29)) | "Skip to content" | |
| Wordmark | `id="wordmark"` ([L33](../web/index.html#L33)) | "Lancaster Budget Explorer" | Replaced by `site_title` (+ `title_suffix`). |
| City / County tabs | `id="entity-switch"` ([L34](../web/index.html#L34)) | "City" (`#/`), "County" (`#/county/`); group label "Budget" | Their links are reset per page by `renderSwitch()` in `app.js`. |
| Disclaimer | `id="tagline"` ([L35](../web/index.html#L35)) | "This is an independent project, not associated with the City of Lancaster." | Replaced by the entity's `tagline`. |
| Header navigation | `id="site-nav"` ([L37](../web/index.html#L37)) | Overview · What changed · Your taxes · Home Rule and the Budget · Funds and terms · About the data (each `data-nav`: `home`, `changes`, `tax`, `calendar`, `terms`, `about`) | `applyChrome()` sets the links per entity, hides "Your taxes" (the What would you pay? page) when `tax_rates.json` did not load, and hides "Budget calendar" (the How the City budget is made page) for an entity with no `budget_calendar` block in `config.json` (the County). `onRoute()` keeps "What changed" pointing at the current fund and figure. The Reserve Fund (the County's General Fund Balance) has no header link: it is last in every Fund list, and while it is shown Overview is marked current. |
| Jump search label and placeholder | `id="jump-input"` ([L47](../web/index.html#L47)) | label "Jump to a department, bureau or line item"; placeholder "Jump to a department or line" | Results come from `buildJumpIndex()` in `app.js`. |
| Theme button | `id="theme-toggle"` ([L52](../web/index.html#L52)) | moon icon and "Dark" while light; sun and "Light" while dark | Label and title set by `applyTheme()`. |
| Loading text | `Loading budget…` ([L58](../web/index.html#L58)) | "Loading budget…" | Shown until the data arrives. |
| View announcement | `id="view-status"` ([L59](../web/index.html#L59)) | empty; `aria-live="polite"`, visually hidden | After a control changes, `announceView()` writes one sentence here ("Showing 2027 Revised compared with 2026 Projected, General Fund, spending."); cleared when you open another page. |
| About heading | `id="about-title"` ([L62](../web/index.html#L62)) | "About the data" | The body is written by `renderAbout()` / `renderAboutCounty()`. |
| Footer | `id="site-footer"` ([L67](../web/index.html#L67)) | three spans: `footer-text`, `generated`, `footer-contact` | Filled from `footer`, the data's build date and `contact_email`. |
| Chart library | `Chart.js/4.4.1` ([L73](../web/index.html#L73)) | Chart.js 4.4.1 from cdnjs, with an `integrity` hash | A new version needs its new hash. |

---

## 3. `web/styles.css`

All colors live in three blocks at the top of the file; the charts read them from there (`loadTokens()` in `app.js`), so no color is set in JavaScript.

- `:root { … }` ([L17](../web/styles.css#L17)): the light theme, plus the fonts;
- `:root[data-theme="dark"] { … }` ([L55](../web/styles.css#L55)): dark, when chosen with the header toggle;
- `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` ([L68](../web/styles.css#L68)): the same dark values, for visitors who have not chosen (the site follows their device).

**Change a dark value in both dark blocks** (they hold identical values). Keep text at 4.5:1 contrast on `--bg` and chart marks, borders that identify a control and the focus ring at 3:1, in both themes (DESIGN.md, "The Contrast Rule"). The comment above `:root` gives the reasoning and the measured ratios.

### Color and font tokens

"Read by `app.js`" names the JavaScript variable that `loadTokens()` copies the token into for the charts.

| Token | Light | Dark | Used for (CSS) | Read by `app.js` |
|---|---|---|---|---|
| `--bg` | `#fcfcfa` | `#101512` | Page background (paper); text on the selected City/County tab and selected segmented tabs | `BG` (chart background; slice borders on the side pies) |
| `--card` | `#fff` | `#171e19` | Inputs, menus and the jump list (sections have no box) | `SURFACE` (point fills, pie borders) |
| `--card-50` | `#fff` | `#171e19` | Not used by any rule | |
| `--header-bg` | `#fcfcfa` | `#101512` | Header and contents rail background | |
| `--border` | `#d3d8d2` | `#2c3731` | Hairline rules between rows and around inputs | `GRID` (chart grid lines) |
| `--border-50` | `#d3d8d2` | `#2c3731` | Not used by any rule | |
| `--border-strong` | `#7d867f` | `#6d7d73` | Stronger rules and the underline of source links in sentences | |
| `--track` | `#e6e9e4` | `#232c26` | Empty part of a bar (`.track`, `.share-bar`) | |
| `--proj-band` | `#f0f2ee` | `#18201b` | (no CSS rule) | `TRACK`: the shaded band behind 2028–2029 projections on Totals by Year |
| `--muted-bg` | `#eceee9` | `#232c26` | Outline-button hover | |
| `--hover` | `rgba(29, 90, 58, .06)` | `rgba(127, 201, 155, .09)` | Row, card, tab and jump-result hover wash | |
| `--fg` | `#1a1d1b` | `#eef1ec` | Main text, ink rules, control outlines | `INK` (chart labels, legend text) |
| `--muted` | `#4a524d` | `#a9b4ac` | Secondary text, notes, labels | `MUTED` (chart default text color, projection label) |
| `--sel` | `#1d5a3a` | `#7fc99b` | Banknote green: selected figure bars, chart series, current nav page | `SEL` (selected series, Actual in County charts, Income on the fund chart) |
| `--sel-ink` | `#1d5a3a` | `#7fc99b` | Green as text: big totals, running head, selected labels | |
| `--btn-bg`, `--btn-fg` | `#1d5a3a`, `#fff` | `#7fc99b`, `#0d1410` | Primary button background and text | |
| `--cmp` | `#5f6862` | `#8b968e` | Comparison figure (ink gray) in bars and legends; the projection line | `CMP` (comparison series and the projection line) |
| `--cmp-ink` | `#4a524d` | `#a9b4ac` | Comparison figure as text | |
| `--rule` | `#1a1d1b` | `#eef1ec` | Double ink rule under list and description headings | |
| `--accent` | `#1d5a3a` | `#7fc99b` | Not used by any rule | |
| `--footer-bg`, `--footer-fg` | `#14201a`, `#e7ece8` | `#0b100d`, `#d3dbd5` | Footer | |
| `--link` | `#1d5a3a` | `#7fc99b` | Links in prose, breadcrumbs, back links | |
| `--mint` | `var(--sel)` | (follows `--sel`) | Selected bar fill (`.fill.sel`) | |
| `--gold` | `var(--cmp)` | (follows `--cmp`) | Comparison bar fill (`.fill.cmp`) | |
| `--cat-1` | `#1a1d1b` (ink) | `#eef1ec` | Category color 1 | `PALETTE[0]`: also Proposed on trend and Reserve Fund charts, County "Budget: planned" |
| `--cat-2` | `#6b7770` (sage) | `#98a59c` | Category color 2 | `PALETTE[1]`: also Revised on the Reserve Fund chart, Spending on the fund chart |
| `--cat-3` | `#8a7a2c` (olive gold) | `#d0bd5e` | Category color 3 | `PALETTE[2]` |
| `--cat-4` | `#938f80` (stone) | `#b8b09a` | Category color 4 | `PALETTE[3]` |
| `--cat-5` | `#5f7f8f` (steel) | `#8fb0c0` | Category color 5 | `PALETTE[4]` |
| `--cat-6` | `#4d6b86` (slate) | `#8aa9c6` | Category color 6 | `PALETTE[5]` |
| `--cat-7` | `#8a5a44` (umber) | `#d19a82` | Category color 7 | `PALETTE[6]` |
| `--cat-8` | `#3b4a42` (deep ink) | `#c2cdc5` | Category color 8; the half-bar on What changed (`.wc-half i`) | `PALETTE[7]` |
| `--cat-other` | `#d0d4cd` | `#4a5750` | Swatch of side-pie rows past `PIE_SLICES` (`.pie-key`, set inline by `pieKey()`) | `OTHER_COLOR`: categories and side-pie rows past `PIE_SLICES` |
| `--red` | `#a12626` | `#ef7b6f` | Ledger red: shortfalls (`.neg`) and the ≠ gap mark only | |
| `--blue` | `#1d5a3a` | `#7fc99b` | Keyboard focus ring (the name is historical; the value is green) | |
| `--cal-deadline` | `#1d5a3a` | `#7fc99b` | How the budget is made: the 3px rule over a step with a charter deadline, the "Deadline" label's fill and the filled step marker (7.9:1 / 9.4:1 on paper) | |
| `--cal-deadline-fg` | `#fff` | `#0d1410` | Text on the "Deadline" label (8.2:1 / 9.5:1) | |
| `--font` | `"Source Sans 3", ui-sans-serif, system-ui, …, sans-serif` | (same) | Body, labels, tables, controls | `Chart.defaults.font.family` in `boot()` |
| `--serif` | `"Source Serif 4", Georgia, "Times New Roman", serif` | (same) | Headlines, big figures, deck sentence, running head, department names | |
| `--rail-w` | `260px` | (same) | Width of the left contents rail on wide screens (1100px and up). It fits the 26px wordmark on two lines and the longest rail entries on one line; measure them before narrowing it further. | |

Other colors outside the token blocks:
- **Printing How the budget is made** (`Printing the budget calendar`, at the end of the file): a `@media print` `:root:has(body.calendar-page)` block repeats the light values of the main tokens, so the page prints as paper and ink even when the screen is dark. Change it with the light tokens.
- **Dropdown chevron** ([L153](../web/styles.css#L153)): drawn in the `select` background image, light `%234a524d` (#4a524d), dark `%23a9b4ac` (#a9b4ac) in both dark rules at the end of the file ([L971](../web/styles.css#L971)).

### Type sizes (main ones)

| Element | Rule | Current |
|---|---|---|
| Body text | `body {` ([L102](../web/styles.css#L102)) | 16px / 1.5, `--font`, tabular figures |
| Site name | `.wordmark {` ([L119](../web/styles.css#L119)) | serif 24px bold |
| Running head above headings ("City of Lancaster") | `.eyebrow {` ([L968](../web/styles.css#L968)) | serif 18px semibold, `--sel-ink` |
| Page heading | `.page-head h1 {` ([L143](../web/styles.css#L143)) | serif 56px (44px under 1024px, 32px on phones) |
| Deck sentence ("Up $5.0M (6.0%) …") | `.deck {` ([L861](../web/styles.css#L861)) | serif 26px semibold |
| Big total | `.big-total {` ([L865](../web/styles.css#L865)) | serif 44px, `--sel-ink`; label `.big-total .big-label` 13px uppercase |
| Department name | `.dept-name {` ([L200](../web/styles.css#L200)) | serif 52px |
| Chart text | `Chart.defaults.font.size` in `app.js` ([L4086](../web/app.js#L4086)) | 13px |

### Breakpoints

| Width | What changes | Search for |
|---|---|---|
| 1280px and up | About sections two to a row | `min-width: 1280px` ([L853](../web/styles.css#L853)) |
| 1099px and down | Header is a top bar; the sections are one row (16px apart, fits from about 750px; narrower it scrolls sideways) | `max-width: 1099px` |
| 1100px and up | Header becomes the contents rail (`--rail-w`, 260px; 26px wordmark, 24px side padding); main column `max-width: 1360px` | `min-width: 1100px` ([L765](../web/styles.css#L765)) |
| 1024px and up / 1023px and down | Bureau cards and What changed tiles two to a row; smaller page headings and big totals below | `min-width: 1024px`, `max-width: 1023px` |
| 767px and down | Phone layout (stacked tables, "On this page" outline, 46px tabs; the pinned controls in two rows of two, the status stamp scrolling away, field notes read by screen readers only) | `max-width: 767px` |
| 1024px and up | "What do these mean?" ends the row of controls; below 1024px it sits on its own line under them | `.controls-define` inside `min-width: 1024px` |
| 420px, 339px and down | Narrowest phones | `max-width: 420px`, `max-width: 339px` |
| Container 880px and up (`.cal-wrap`) | How the budget is made: the timeline runs across, five steps a row; narrower it runs down the left | `@container (min-width: 880px)` |

---

## 4. `web/app.js`

### Labels and constants

| Name | Search for | Current value | What it controls |
|---|---|---|---|
| `LABEL` ([L23](../web/app.js#L23)) | `const LABEL` | `proposed` "Proposed", `revised` "Revised", `projected` "Projected", `actual` "Actual", `budget` "Budget", `projection` "Projection", `adopted` "Adopted", `amended` "Amended" | The figure word everywhere (controls, legends, tables, sentences). |
| `ORDER` ([L25](../web/app.js#L25)) | `const ORDER` | `actual`, `projected`, `budget`, `proposed`, `revised` | The one kind of figure per year that the multi-year charts and tables draw, and a year's default figure (`defaultMeasure()`). |
| `PICK_ORDER` ([L28](../web/app.js#L28)) | `const PICK_ORDER` | `revised`, `proposed`, `actual`, `projected`, `budget`, `amended`, `adopted` | Order of the figures within a year in the Budget year and Compare with lists (`figureKeys()`, `figuresFor()`). Amended / Adopted are selectable but never charted. |
| `STATUS` ([L29](../web/app.js#L29)) | `const STATUS` | `proposed` "Proposed, not adopted"; `revised` "Revised proposal, not adopted"; `projected` "Projected year-end estimate"; `actual` "Actual spending"; `budget` "Budget"; `adopted` "Adopted budget"; `amended` "Amended budget" | The status stamp above the controls ("2027: Revised proposal, not adopted", "2026: Amended budget"); the County adds `adopted.text` from `config.json`. Built by `statusHTML()`. |
| `CAT_ORDER` ([L34](../web/app.js#L34)) | `const CAT_ORDER` | Salaries & Wages, Benefits, Operating, Equipment & Capital, Debt, Transfers & Allocations, Revenue, Uncoded | Order of City categories in charts and tables, and which `--cat-*` color each gets. The names themselves come from the data (`category_for()` in `scripts/budget_common.py`; County: `scripts/build_county.py`). |
| `PAGE_SIZE` ([L46](../web/app.js#L46)) | `const PAGE_SIZE` | `20` | Line-item rows shown at a time (the "Show 20 more" button adds this many). |
| `PIE_SLICES` ([L47](../web/app.js#L47)) | `const PIE_SLICES` | `7` | How many categories, and how many rows of a side pie (departments, bureaus, funds), get their own color; the rest use `--cat-other` and fold into one "All other (n)" slice. |
| `MINUS` ([L67](../web/app.js#L67)) | `const MINUS` | `−` (−) | The one minus sign used in every number. Formats: `money()`, `fmtPct()`, `short()`, `mny()`. |
| `CALC_TAG` ([L145](../web/app.js#L145)) | `const CALC_TAG` | "calculated" (`.calc-tag`) | The label on the site's own sums. |
| `GAP_SIGN` ([L146](../web/app.js#L146)) | `const GAP_SIGN` | `≠` (≠) | The mark on a printed total whose lines miss it beyond rounding (`gapMark()`, `gapNote()`). |
| `EXPLAIN_FIGURES` ([L353](../web/app.js#L353)) | `const EXPLAIN_FIGURES` | City: actual, projected, proposed, revised, amended, adopted, projection (only while the data has projection years), calculated; County: budget, actual, calculated | Which figure words the "What do these mean?" panel lists, in this order. The wording itself is `figureWords()` (Funds and terms), not a copy. |
| "What do these mean?" panel ([L354](../web/app.js#L354)) | `function explainHTML` | Toggle "What do these mean?"; headings "Figures" and "Funds"; markers "shown" (the figure in Budget year), "comparing" (the one in Compare with), "selected" (the chosen fund); link "More in Funds and terms →" to `#/terms` | The last of the controls: one explainer for the figures and the funds in the page's Fund list, using `figureWords()`, `FUND_INTRO`, `fundInfo()` / `FUND_INFO` and `balanceWord()`. Opened and closed by `setExplain()` ([L3096](../web/app.js#L3096)); Escape, a click outside the controls or Tab out of them close it, and Escape returns focus to the toggle. The open state lasts while the page's controls change and resets on a new page. |
| Controls ([L388](../web/app.js#L388)) | `function controlsWrap` | always open on wide screens; on phones a compact bar (`controlsSummary()`, `setControls()`) naming only the selected view, above the headline, which expands on tap and closes on scroll; pinned to the top of the main column while the page scrolls | The stamp, the "View" group (Budget year, Compare with, Fund, Spending / Income) and the "What do these mean?" panel (`explainHTML()`). Field helpers: `selField` ([L323](../web/app.js#L323)), `tabField` ([L321](../web/app.js#L321)), `figureOptions()` ([L326](../web/app.js#L326): options grouped by year, the shown figure disabled in Compare with as "(the budget year shown)"). Live sentence: `viewSentence()` / `announceView()` ([L445](../web/app.js#L445)) into `#view-status` in `index.html`. Pinning: `pinControls()` ([L3057](../web/app.js#L3057)) sets `--pin-h` on `<html>` (the height of the bar left on screen once pinned, `0px` on pages without controls) and `--stamp-h` on the bar (phones), and adds `.is-stuck` once the bar is pinned. |
| `SPIKE_X`, `SPIKE_SHARE` ([L646](../web/app.js#L646)) | `const SPIKE_X` | `2`, `0.05` | "Stands out" notes: a line at least 2× both neighbouring years, with a jump of at least 5% of its fund's total. Keep equal to `SPIKE_X, SPIKE_SHARE` in `scripts/check_dataset.py` (section 7). |
| `RES_STATUS` ([L873](../web/app.js#L873)) | `const RES_STATUS` | `actual` "Actual year-end balance"; `projected` "Projected year-end balance"; `proposed` "Proposed, not adopted"; `revised` "Revised proposal, not adopted" | Status stamp on the Reserve Fund page. |
| `resLabel` ([L864](../web/app.js#L864)) | `const resLabel` | "<year> <LABEL>", "Actual (unaudited)" for an unaudited year-end | Year labels on the Reserve Fund chart and table. |
| `WC_TOP` ([L2193](../web/app.js#L2193)) | `const WC_TOP` | `10` | Rows in "Largest changes" on What changed before "All N changed lines". |
| `unitLabel` ([L2076](../web/app.js#L2076)) | `const unitLabel` | "Department-wide costs (not a bureau)" / "Department revenue (not a bureau)" | Name of the City's department-wide group. |
| `plainName` ([L206](../web/app.js#L206)) | `const plainName` | drops a trailing " Exp" / " Expense" | Display names of old printed budget groups. |
| `isDraw` ([L704](../web/app.js#L704)) | `const isDraw` | name starts "Fund Balance Reserve" and object `499000` | Which revenue lines count as money drawn from savings. |
| `taxLimitFlag()`, `tlTest()` | `function taxLimitFlag` | over: "▲ Exceeds the 6% tax revenue limit" / "Needs a Council waiver vote, majority of the whole Council plus one (§ 8.08). In the 2027 Revised budget, General Fund tax revenue is up 8.6% from 2026 Projected. How this is worked out", plus for `transition.budget_years` "Section 13.14 may waive the limit for budgets adopted in the charter's first two years, if passed by a simple majority of Council. This site does not say whether it applies to this budget."; within: "2026 budget: within the 6% tax revenue limit, +5.1% from 2025 Projected. How this is worked out" | The Home Rule 6% flag (`budget.json` `tax_limit`; City, General Fund or All funds only). Under the tiles in the home "What changed in 2027" panel and on What changed (follows the Budget year choice); for an earlier year, under the total on the Income view (that year's budget as tested; nothing before `first_year`). CSS `.tl-flag`, `.tl-over`, `.tl-within`, `.tl-sign`, `.tl-note` (existing tokens only: `--fg`, `--muted`). |
| `nonIncome`, `isIncome`, `ofKind` ([L202](../web/app.js#L202)) | `const isIncome` | from `budget.json` `not_income` (`governments/lancaster-city/mapping/income_rules.csv`) | What counts as income. `draw` and `transfer` lines are never income; `charge` lines are income of one fund but not of All funds. Edit the CSV, not these. |
| `lineTag` ([L745](../web/app.js#L745)) | `const lineTag` | "Charged to another of the City's funds" / "Transfer from another of the City's funds: not counted as income" | The tag under a charge or transfer line in line-item tables. `ownFunds()` gives "the City's" / "the County's". |
| `drawDC`, `drawSplit` ([L726](../web/app.js#L726)) | `const drawDC` | "… drawn from savings (… of it from dedicated data center revenue)" | The reserve-draw phrase used on every page. |
| `drawLabel` ([L2468](../web/app.js#L2468)) | `const drawLabel` | "Drawn from savings (the “Fund Balance Reserve” lines)" / "Drawn from the reserve (the “Fund Balance Reserve” line)" | Row label on What changed. |
| `countyGap` ([L1176](../web/app.js#L1176)) | `const countyGap` | ", spending $9.0M more than it expects to collect, covered from the General Fund's balance" | The County deck sentence's second half. |
| `JT` ([L3206](../web/app.js#L3206)) | `const JT` | City: Department, Bureau, Line item; County: Group, Department, Line item | Result type labels in the Jump search. |
| `FUND_INFO` ([L3421](../web/app.js#L3421)) | `const FUND_INFO` | see "Funds and terms" below | What pays for each fund, and what it is (Funds and terms and the "What do these mean?" panel, through `fundInfo()`). |
| Font wait ([L4088](../web/app.js#L4088)) | `setTimeout(r, 1500)` | 1.5 s | How long the first chart waits for the web font. |
| Saved choices | `localStorage` | keys `theme`, `entity` | Theme, last entity. (`controlsOpen` is no longer used and is deleted on load.) |

### Funds and terms (`#/terms`, `#/county/terms`)

`FUND_INFO` ([L3421](../web/app.js#L3421)): one row per fund, `[paid for by, what it is]`. A fund in the data with no row shows "See the books". The table follows the data's funds, so a fund is listed only if the data has it.

| Entity | Fund | "Paid for by" | "What it is" starts |
|---|---|---|---|
| City | General Fund | Mostly taxes | "The city's everyday budget: police, fire, streets, parks and administration. …" |
| City | Stormwater Management Fund | Fees, not taxes | "Paid for by the stormwater management fee …" |
| City | Sewer Fund | Fees, not taxes | "Paid for by sewage treatment charges …" |
| City | Water Fund | Fees, not taxes | "Paid for by water rents …" |
| City | Solid Waste & Recycling Fund | Fees, not taxes | "Paid for by trash fees, with some state recycling grant money." |
| City | Liquid Fuels Fund | State money, not city taxes | "The city's share of the state's liquid fuels (motor fuel) money …" |
| City | Long's Park Fund | Rentals and gifts, not taxes | "Paid for by pavilion and amphitheater rentals …" |
| County | General Fund | Mostly taxes | "Pays for most County services. Paid for mostly by property taxes …" |
| County | Fund B | State money, not County taxes | "The County's share of the state's liquid fuels (motor fuel) money …" |
| County | Fund E | Grants, not taxes | "… for drug and alcohol programs." |
| County | Fund EI | Grants, not taxes | "… for early intervention services for young children." |
| County | Fund F | Fees and grants, not taxes | "… for the domestic relations (child support) office." |
| County | Fund G | Grants, not taxes | "… for aging services." |
| County | Fund H | Grants, not taxes | "… for behavioral health services." |
| County | Fund R | Grants, not taxes | "… for developmental services." |
| County | Fund Y | Grants, not taxes | "… for children and youth services." |

The wording shared with the "What do these mean?" panel sits just above the page: `FUND_INTRO` ([L3447](../web/app.js#L3447), "A fund is a separate account kept for a purpose. …"), `fundInfo()` (a fund's `FUND_INFO` row, or "See the books"), `balanceWord()` ([L3450](../web/app.js#L3450): the Reserve Fund / General Fund Balance definition, anchor `term-balance`) and `figureWords()` ([L3458](../web/app.js#L3458): the figure words, Actual, Projected, Proposed, Revised, Adopted, Amended, Projection, Income, calculated; County: Budget, Actual, Income, calculated; the Income text is the `income` entry, anchor `term-income`; Adopted and Amended are anchors `term-adopted` and `term-amended`). Edit a definition there and both places change. The rest of the page is `termsPage()` ([L3476](../web/app.js#L3476)): the heading "Funds and terms", the intro, those definitions and `notShown` (City: "Not shown", anchor `term-not-shown`: year-to-date columns and older books' own proposals; County: "Adopted and Amended", anchor `term-adopted`). The panel and the status stamp link to it through `termHref()`.

### How the City budget is made (`#/budget-calendar`)

City only (the County shows one sentence and a link: "This page covers the City of Lancaster's budget calendar; the County's has not been researched for this site."). Search `calendarPage` in `web/app.js`. The source PDFs are named in `config.json` `entities.city.budget_calendar`.

| Name | Search for | Current value | What it controls |
|---|---|---|---|
| `CHARTER_PAGE` | `const CHARTER_PAGE` | section → charter PDF page: `cover` 1; 8.01–8.04 (intro) 35; 8.04(a)–(f), 8.05(a) 36; 8.05(b)–(f) 37; 8.05(g)–(h), 8.06 38; 8.07, 8.08 39; 8.09, 8.10(a) 40; 8.10(b)–(d), 8.11(a) 41; 8.11(b) 42; 13.02 58; 13.14 61 | Which page each § link opens. A subsection not listed uses its section's page. Checked against the PDF text on 2026-11-27 (every cited section). |
| `OLD_RULES_PAGE` | `const OLD_RULES_PAGE` | `government` 42, `budget` 58 | Pages of the 2024 audited financial statements cited in Before 2025 (the Optional Third Class City Charter Law; the November 30 / end of December rule). |
| `cite()`, `cites()` | `const cite = ` | "§ 8.05(e)" as a quiet dotted link; `cites()` wraps several in parentheses, muted 14px | Every charter citation. Title "Read it in the Home Rule Charter". |
| `calSteps()` | `const calSteps` | ten steps: Capital program due (By June 30); Council adopts the capital program (By Sept 30); The Mayor presents the budget (By Council's last scheduled October meeting); Vote on a 6% waiver, if one is proposed (By the first Council meeting in November); Public hearings and questions (7 to 30 days after the notice); Answers published, changes made (At least 7 days before adoption); Council adopts the budget (By Dec 15); The Mayor signs or vetoes (Within 10 days; override by Dec 31); The budget year begins (Jan 1); A revised budget, if any (By Feb 15, only after a municipal election year) | The timeline. Each step: `month` (band label, or `null`), `deadline`, `when`, `at` (the section after the Deadline label), `title`, `who`, `body`, `missed` / `missedLabel` ("If it is missed" / "If it does not pass"). |
| `WHO_TAG` | `const WHO_TAG` | "Mayor", "Council", "Public" (`.cal-who-tag`) | Who acts at a step. |
| `calTimeline()` | `function calTimeline` | `<ol class="cal-line" aria-label="The budget calendar, in time order">` | Builds the list; shows a step's month only when it differs from the step before. |
| Page text | `function calendarPage` | heading "How the City budget is made"; sections The budget calendar, The Mayor's budget, The 6% limit on tax revenue, Council's deadlines, When you can take part, During the budget year, Before 2025; the key under the timeline; the example ($30.0M, $1.8M, $31.8M, $33.0M, $1.2M, "An illustration only; these are not the City's figures."); the § 13.14 quotation | All wording on the page. |
| `calLimitTest()` | `function calLimitTest` | heading "The City's budgets against the limit"; columns Budget · Tax revenue (calculated) · Year before (calculated) · Change · Against the 6% limit ("▲ Exceeds: needs a waiver" / "Within"); the note on the year before; "Which lines count" (from `tax_limit.lines`) | The test table in the 6% section (`id="cal-limit-test"`, linked from every flag as `#/budget-calendar?s=cal-limit-test`). Amounts open the book page that prints the lines; on phones each budget stacks into labelled rows. |
| About link | `How the City budget is made</a>, the budget calendar` | "Who prepares and approves the budget, and by when: How the City budget is made, the budget calendar in the City's Home Rule Charter." | City About, under Sources. |

CSS: the `.cal-*` rules under `/* How the City budget is made` in `styles.css` (band, month label, Deadline label, who-tags, step text, key, example, quotation, print).

### What would you pay? (`#/tax`, `#/county/tax`)

City and County alike; in the header as "Your taxes" (`data-nav="tax"`). This year against next year: the reader's taxes this year (`tax_estimate.this_year`) and next year (`next_year`) under the newest City budget's latest figure (2027 Revised; the Proposal is not shown). Also reached from "Estimate what you would pay →" (`taxLinkHTML()`, class `.tax-link`) under the property tax and earned income tax tiles on the Income view's What changed (`taxTiles()`; the County's real estate tax tile too) and under those notes in "What the revision changed" (`policyHTML()`, `.tax-link-p`). Rates come from `web/data/tax_rates.json` (`TAXR`); search `What would you pay?` in `web/app.js`.

| Name | Search for | Current value | What it controls |
|---|---|---|---|
| `TAX_NAME` | `const TAX_NAME` | `real_estate` "Property tax", `earned_income` "Earned income tax" | Row names in the table. |
| `TAX_WHO` | `const TAX_WHO` | "Both (property in the City)" (City and County), "City only", "County only (outside the City)" | The "Taxes to include" choices. Opens on Both from a City page, County only from a County page. |
| `TX` | `const TX = ` | `{ who, av: {year: value}, inc }` | What the reader typed, kept while the page is open; never put in the address or stored. |
| `taxRow()`, `taxNextRate()` | `const taxRow`, `function taxNextRate` | a tax's row for a year; next year's rate under one figure (its step, else the year's own rate, else none) | Where each cell's rate comes from. No next-year row (the County today): "{next} rate not set yet". |
| `taxNextCols()` | `function taxNextCols` | "2027 Revised" (the latest step of the City rows); County only: "2027" | The next-year column. Only the latest figure is shown; earlier steps (the Proposal) stay in `tax_rates.json` but not on the page. |
| `taxValueYears()` | `function taxValueYears` | "Assessed value, 2026" ("The value on your 2026 tax bill.") and "Assessed value, 2027" ("The new value on your reassessment notice.") | One field per year of value a shown property rate uses. |
| `taxPage()` | `function taxPage` | heading "What would you pay?"; lede "Your City and County taxes this year, and what they would be next year under the City's 2027 Revised budget. An estimate, not a tax bill. School district taxes are not included."; sections Your details (fields, Earned income "Wages and business profits, as on your PA tax return. City residents only. Used for both years. This is the City's earned income tax only; your school district's is not included.", the privacy line), How your taxes change, This year and next year, How this is worked out | All wording on the page. |
| `taxFindHTML()`, `taxFindGo()`, `taxStreet()` | `function taxFindHTML`, `function taxFindGo`, `const taxStreet` | section "Find your assessed values", first on the page (above Your details): "Don't have your assessment notice? …"; House number, Street name ("With its direction, like S Duke or E James."), or Parcel number ("From your tax bill or notice, like 332-32083-0-0000."); one "Look up your {year} value ↗" button per `tax_estimate.lookup` site (shown only for a year the chosen taxes use); "Type a street name, or a parcel number, first."; "Opened the County's {name} in a new tab."; where to read the value (Assessments, the Total in the Non-Exempt row, or Pref. Total if above zero); the lede says only the address or parcel number goes to the County | A hand-off, not a proxy: `taxStreet()` turns a spelled-out direction into its letter (South Duke → S DUKE) and drops a spelled-out street type at the end (Street, Avenue, Road, …), which the County's search does not match; the visitor's browser posts the search (`property_key`, or `house_number_min`/`house_number_max`/`street_name`) to the County's site in a new tab (`rel="noopener noreferrer"`). This site fetches nothing: the County's sites send no CORS headers and ask robots not to fetch parcel pages. |
| `taxModel()` | `function taxModel` | each shown tax this year and next year (`lines`), per-government totals (`G`) and the change (`all`: only the governments with next year's rates) | The numbers both sections use. Property tax = value ÷ 1,000 × mills; earned income tax = income × rate; whole dollars (`money()`). |
| `taxSummaryHTML()` | `function taxSummaryHTML` | section "How your taxes change": the years ("2026 → 2027 Revised"), one line per tax ("City property tax  $1,896 → $1,884  ▼ −$12 (−0.6%)"; a tax with no rate yet: "$480 → 2027 rate not set yet  Not in the total"), then "Total increase" / "Total decrease" / "Total change" ("(City taxes)" when the County is left out) with the change large in green; "The County has not set its 2027 rate yet, so it is not in the total." | The change summary, above the table. |
| `taxTableHTML()` | `function taxTableHTML` | section "This year and next year": Tax (with "On $150,000 → $330,000 value" / "On $60,000 income") · 2026 · 2027 Revised · Change, grouped by government, each amount with its rate under it; City total, County total, Total; notes: why the City's rate is lower next year (reassessment, the revenue-neutral rate, `reassessment_source`), a calculated rate if a shown figure has one, the rates not printed in the budget book | The table. |
| `rateHTML()` | `function rateHTML` | linked rate; "(calculated)"; "(not in the budget book)" | How a rate is shown under an amount. |

CSS: the `.tx-*` and `.tax-link` rules under `/* What would you pay?` in `styles.css`: `.tx-find*` for Find your assessed values, `.tx-sum*` for How your taxes change (on phones the amounts drop under the name), `.tx-table` for the compact table (on phones each tax stacks into labelled rows).

### Wording by page

Each row names the function that writes the text; search for it in `web/app.js`.

**On every page**

| What you see | Where |
|---|---|
| Running head above the heading ("City of Lancaster") | `addEyebrow()` ([L3046](../web/app.js#L3046)); the name is `entity.short` in `config.json` |
| Browser tab titles ("City of Lancaster · Overview · Lancaster Budget Explorer") | `pageTitle` ([L65](../web/app.js#L65)) |
| Wordmark, tagline, footer, contact line ("Questions or corrections: …"), nav links | `applyChrome()` ([L4038](../web/app.js#L4038)) |
| City / County tab links (each opens the same kind of page in the other entity) | `renderSwitch()` ([L4056](../web/app.js#L4056)) |
| Status stamp ("2027: Revised proposal, not adopted"), above the controls | `statusHTML()` ([L302](../web/app.js#L302)), `STATUS` |
| Controls (wide screens: stamp, then Budget year, Compare with, Fund, Spending / Income, then "What do these mean?"; phones: a compact 45px summary that expands on tap and closes on scroll; pinned while scrolling) | `controlsWrap()` ([L388](../web/app.js#L388)), `filtersHTML()` ([L404](../web/app.js#L404)), `reserveFiltersHTML()` ([L336](../web/app.js#L336)), `cbFiltersHTML()` ([L994](../web/app.js#L994)), `changesFiltersHTML()` ([L2757](../web/app.js#L2757)), `onFilter()` ([L452](../web/app.js#L452)), `pinControls()` ([L3057](../web/app.js#L3057)); look: `.controls` (sticky, `.is-stuck`), `.controls-compact`, `.controls-body`, `.controls-stamp`, `.controls-fields`, `.controls-define` in `styles.css` ([L418](../web/styles.css#L418)), and `html { scroll-padding-top: var(--pin-h) }` |
| "What do these mean?" panel (Figures and Funds, the "shown" / "comparing" / "selected" markers) | `explainHTML()` ([L354](../web/app.js#L354)), `EXPLAIN_FIGURES`, `setExplain()`; wording from `figureWords()`, `FUND_INTRO`, `FUND_INFO`, `balanceWord()`; look: `.explain-toggle`, `.explain`, `.explain-h`, `.explain-grid` (columns `repeat(auto-fit, minmax(16rem, 1fr))`), `.explain-item`, `.explain-tag` in `styles.css` ([L441](../web/styles.css#L441)) |
| Field labels: Budget year, Compare with, Fund, Show (Spending / Income), "No comparison", "(the budget year shown)", "Only the funds this department uses are listed.", "What changed covers 2026 only." (County) | `filtersHTML()`, `changesFiltersHTML()`, `figureOptions()` |
| Live sentence after a change ("Showing 2027 Revised compared with 2026 Projected, General Fund, spending.") | `viewSentence()` ([L434](../web/app.js#L434)); the region is `<p id="view-status" aria-live="polite">` in `index.html` |
| Fund list order (All funds, General Fund, other funds, Reserve Fund last) and "Only the funds this department uses are listed." | `fundChoices()` ([L312](../web/app.js#L312); `fundOptions()` turns it into the list's options, and the "What do these mean?" panel defines the same funds), `filtersHTML()` |
| "Known issues for this view" | `knownLink` ([L308](../web/app.js#L308)) |
| Printed vs calculated totals, the ≠ note ("The lines this total covers add up to …") | `totalOf()` ([L139](../web/app.js#L139)), `fig()` ([L150](../web/app.js#L150)), `gapNote()` ([L160](../web/app.js#L160)), `missingNote()` ([L168](../web/app.js#L168)) |
| Contents rail ("On this page") | `renderRail()` ([L2942](../web/app.js#L2942)) |
| Jump search results and "No matches." | `buildJumpIndex()` ([L3207](../web/app.js#L3207)), `initJump()` ([L3224](../web/app.js#L3224)) |
| Theme button label | `applyTheme()` ([L3982](../web/app.js#L3982)) |
| "Could not load the budget data" | `loadEntity()` ([L4007](../web/app.js#L4007)), `boot()` ([L4065](../web/app.js#L4065)) |

**Home (Overview)**

| What you see | Where |
|---|---|
| Page layout and order of sections; the deck sentence ("Up $5.0M (6.0%) from 2026 Projected, with $4.7M drawn from savings …"); "Income vs. Spending by Fund" | `homeView()` ([L1257](../web/app.js#L1257)) (the `deck` block), `heroDelta()` ([L1151](../web/app.js#L1151)), `drawNote()` ([L734](../web/app.js#L734)) |
| "What changed in 2027" summary beside Totals by Year | `homeChangesHTML()` ([L2832](../web/app.js#L2832)) |
| Departments ledger. Each row opens its department; a chevron button before the name (`.hist-toggle`, in `th.has-hist`) unfolds the department's (County: group's) history under the row, the same totals as its page's "Over time" tab, printed totals linked to their page and calculated ones tagged. Panel note: "Select a department to see its detailed breakdown, or the arrow beside it to see it year by year." | `ledgerHTML()` ([L1133](../web/app.js#L1133)), `mountDeptHistory()` ([L1991](../web/app.js#L1991)); styles `.hist-toggle` ([L985](../web/styles.css#L985)) |
| Side pies beside the Departments ledger, the Spending (Income) by Bureau cards, the Income vs. Spending by Fund table and the Income Sources table and the Staff ledgers: caption "Share of 2027 Revised spending by department" (… by group / bureau / department on County pages / fund; "income" on the Income view; Income Sources: "Share of 2027 Revised income by source"; Staff: "Share of 2027 Revised positions by department" on home, "… positions by bureau" and "… salaries and wages by bureau" on department pages), each row's color swatch, slice click opens the row's page (Income Sources and Staff: the slice opens or closes that row's history through `piePick[canvasId]`, a map from pie canvas id to function, set by `mountIncomeSources()` for `pie-src` and by `mountStaff()` for the Staff pies; an item's `pick` is its toggle id, and the grey "All other" slice has none, so it does nothing; `drawSidePie(id, items, fmt)` takes the number format of its tooltips: `money`, or `fmtN` for positions) | `sidePieHTML()` ([L1092](../web/app.js#L1092)), `drawSidePie()` ([L1098](../web/app.js#L1098)), `pieKey()` ([L1089](../web/app.js#L1089)); called from `homeView()`, `revExpAfter()` ([L1369](../web/app.js#L1369)), `incomeSourcesHTML()` (adds `['pie-src', items]` to `homePies`), `staffLedger()` (adds `[id, items, fmt]` to `staffPies`, drawn by `mountStaff()`) and `deptPage()`. Layout: `.with-pie`, `.side-pie`, `.pie-key`, `.keyed` (swatch + name; on phones the fund table puts the swatch above the name so the table gets no wider) in `styles.css`; inside `.with-pie` the Income Sources `.share-bar` is hidden, and from 768px its non-first columns use 12px side padding so the five columns fit beside the pie |
| Totals by Year chart, legend, "Show values" table | `trendHTML()` ([L561](../web/app.js#L561)), `trendLegend()` ([L549](../web/app.js#L549)), `drawTrend()` ([L584](../web/app.js#L584)); the chart itself is `trendChart()` ([L592](../web/app.js#L592)), also used by a line item's history and, with `count = true` (position ticks and tooltips, a zero baseline under 10, `LABEL.budgeted` for staffing years), by the Staff charts |
| The projection note ("2028 and 2029 are projections, not budgets: …") and "The city's assumptions" | `projectionNote()` ([L515](../web/app.js#L515)); the assumption lines come from the data |
| "Stands out" notes ("2025 stands out: Building Permits …") | `spikeSentence()` ([L684](../web/app.js#L684)), `spikeNotes` ([L692](../web/app.js#L692)), `lineSpikes()` ([L653](../web/app.js#L653)); the same note, with any `governments/lancaster-city/notes/line_notes.csv` text for the line, also opens under a line's name in the line-item table (`lineHistoryNotes()`) |
| How the reserve draw is split ("$4.7M drawn from savings ($1.9M of it from dedicated data center revenue)") | `drawParts()` ([L716](../web/app.js#L716)), `drawLineLabel()` ([L728](../web/app.js#L728)), `reserveTie()` ([L848](../web/app.js#L848)) |
| Tax tiles on the Income view of "What changed" (home panel and page), shaped like the Income change tile: heading, the rate change with its arrow ("+0.20 pts", "+0.290 mills", "No change"), the rate before → after | `taxTiles()` ([L760](../web/app.js#L760)), called from `tilesHTML()` |
| Income highlights under the total where there is no "What changed" panel, and on department and bureau pages ("Earned income tax: The revised proposal raises …", "Real estate tax: the rate rises from 2.911 to 3.201 mills, a 10% tax increase.", "Largest changes from 2026 Projected: …"; how many lines: `INCOME_TOP`, 3), the Income vs. Spending footnote, and the About section "What counts as income" | `incomeHighlights()` ([L813](../web/app.js#L813)), `countyTax()` ([L752](../web/app.js#L752)), `revExpAfter()`, `aboutPage()` (search `about-income`) |

**Department and bureau pages**

| What you see | Where |
|---|---|
| Layout, headings (Compare, Line Items), in-page links | `entityView()` ([L1827](../web/app.js#L1827)), `crumbsHTML` ([L1455](../web/app.js#L1455)), `jumpNav` ([L1459](../web/app.js#L1459)) |
| Department page: bureau cards, "What does this department do?" | `deptPage()` ([L2107](../web/app.js#L2107)), `cardList()` ([L1118](../web/app.js#L1118)), `aboutHTML()` ([L2091](../web/app.js#L2091)) |
| Bureau page: "What does this bureau do?", department-wide group | `bureauPage()` ([L2155](../web/app.js#L2155)) |
| Short "What changed" section and its summary ("Budgeted positions:", "Largest increases:", …) | `deptChangesHTML()` ([L2910](../web/app.js#L2910)), `deptSummaryHTML()` ([L2847](../web/app.js#L2847)) |
| Category table | `categorySection()` ([L1423](../web/app.js#L1423)) |
| Line items: count ("97 line items (1 only in 2026 Projected)"), headers, the search box ("Search line items, account numbers…"), "Show 20 more" | `lineCountText()` ([L1911](../web/app.js#L1911)), `lineTable()` ([L1916](../web/app.js#L1916)) |
| A line item's history: the line's name is a toggle (`.li-toggle`, an ink chevron like the bureau "What does it do" summary: pointing right closed, down open; a muted hint above the table, `.li-hint`: "Select a line's name to see it year by year.") that unfolds a full-width row (`tr.li-hist`) under it: a small line chart (legend, "The vertical axis starts at …, not zero."), the "stands out" note and any line note, and a "Show values" table (Year, Figure, Amount; every Amount links to its PDF page). Figures are the line's rows (same account code and fund) per year by the site's own rule: Actual, Projected, Proposed and Revised, then Projection (County: Budget); a year with no row shows —. One row open at a time; re-sorting, searching or "Show more" closes it | `lineHistoryPoints()` ([L1955](../web/app.js#L1955)), `lineHistoryNotes()` ([L1967](../web/app.js#L1967)), `lineHistoryHTML()` ([L1986](../web/app.js#L1986)) and the shared `histBodyHTML()` ([L1978](../web/app.js#L1978)), `toggleLineHistory()` ([L2019](../web/app.js#L2019)), `closeLineHistory()` ([L2013](../web/app.js#L2013)), `mountLines()` ([L2048](../web/app.js#L2048)); styles `.li-toggle`, `.li-hist` ([L995](../web/styles.css#L995)) |
| "Export this view (CSV)": columns and file name | `exportCSV()` ([L2032](../web/app.js#L2032)) |
| Staff section (positions chart, Budgeted positions, Salaries and wages, position titles) | `staffHTML()` ([L1570](../web/app.js#L1570)); the chart and its values are `staffHistoryHTML()` ([L1522](../web/app.js#L1522)) (a bureau's Salaries and wages: `salHistoryHTML()` ([L1534](../web/app.js#L1534)), money chart, row id `s<unit>`, hint "Select a bureau's name to see its salaries and wages year by year."), drawn by `mountStaff()` ([L1544](../web/app.js#L1544)) with `trendChart(…, count = true)`. Chart points: `staffPoints()`, kept in `staffPts` by row id (`scope`, `u<unit>`, `d<dept>`, `s<unit>`); `staffCols()` ([L1485](../web/app.js#L1485)) lists the schedules. The two tables are Income Sources-format ledgers built by `staffLedger()` ([L1501](../web/app.js#L1501)): Bureau | comparison (`seriesLabel(S.c)`, `hide-sm`) | selected figure | Change (`deltaHTML(…, fmtN)` for positions, `mny` for salaries) | Share (`hide-sm`; left out on a bureau page, where there is one row, no toggle and no pie), an **All** row (sums of the rows; positions: `sumCol()` of the schedule's counts), and a side pie (`pie-st-pos`, `pie-st-sal`; caption "Share of <selected figure> positions by bureau" / "… salaries and wages by bureau"; none when the selected figure has no schedule). Positions take the schedule a series key stands for, `posSched()` ([L1490](../web/app.js#L1490)): the newest year's Revised or Proposed is that schedule, any other key `<y>|<m>` is year `y`'s `budgeted` schedule, and a year with none (2020, 2021, 2028, 2029) shows "—" (`noSched()`, title "No staffing schedule for <label>") with a blank change; salaries use the series keys directly (`salOf()`), gathered for every year (history) plus the selected and comparison keys. Rows with nothing in either shown figure are left out and rows sort by the selected figure desc. A bureau's name in either ledger is a toggle (`.li-toggle.staff-toggle`, `data-st`) that folds its history in a row (`tr.li-hist`, id `st-row-<row id>`, set as the toggle's `aria-controls`) directly under it, built by `openInlineRow()` ([L1478](../web/app.js#L1478)) and closed by `closeInlineRows()` ([L1473](../web/app.js#L1473)), like a line item's history; a pie slice opens or closes the same row (`piePick[id]`, set in `mountStaff()`). Hints (`.li-hint`): "Select a bureau's name to see its positions year by year." / "… salaries and wages year by year." One open history at a time in the section, across both ledgers (`staffChart`, freed by `closeStaffChart()` ([L1472](../web/app.js#L1472)) and `destroyCharts()`). The panel note says an Actual or Projected year's positions are that year's budgeted positions (the books print no actual headcount). |
| Home page Staff panel (positions by department, "Not placed in a department" row, city-wide chart) | `homeStaffHTML()` ([L1673](../web/app.js#L1673)); the same `staffLedger()` (Department | comparison | selected | Change | Share, **All** row = every schedule line including the "Not placed in a department" row, side pie `pie-st-home`, caption "Share of <selected figure> positions by department"; the "Not placed" row has no toggle and is the last pie slice's row); a department's name is a toggle (`data-st="d<dept>"`) that folds its history in an inline row under it (`openInlineRow()`, `tr.li-hist`); hint: "Select a department's name to see its positions year by year." |
| Income Sources panel (home page, Income view only, City and County, not the Reserve Fund) | `incomeSourcesHTML()` ([L1735](../web/app.js#L1735)); a line's source is `sourceOf()` ([L1728](../web/app.js#L1728)): the `budget.json` `income_sources` name for its account, else "Charges to other funds" (a `charge` in `not_income`), else the group the book prints it under; in every column a line takes the source it has in the newest book that prints the account (same account and fund; `newestSrc`), so a group the books renamed ("Public Safety Revenues" → "Public Safety - Police Fees") stays one row and the projections book's single group, "Revenue", does not split a trend; `sourceKey()` ([L1734](../web/app.js#L1734)) still merges spelling variants of one name (case, "&"/"and", hyphens, a trailing "s"). Columns follow the Budget year and Compare with controls, as the Departments ledger (`ledgerHTML()`) does: Source | comparison (`seriesLabel(S.c)`, `hide-sm`, omitted with no comparison) | selected figure | Change (`deltaHTML(…, mny)`, signed with %) | Share (`hide-sm`, the percentage only: the `.share-bar` of `categorySection()` is hidden inside `.with-pie`); amounts are `src()` links, the figure history for every year is still gathered per source (`bySrc`) for the chart; sources with nothing in either shown figure are omitted; rows sort by the selected figure desc; the **All** row is `fig()` of `totalOf()` of the same `scoped()` lines the page total uses (with `gapNotes`), for both figures. Heading: "Income Sources". Side pie (`.with-pie` around the table, `sidePieHTML('pie-src', …)`): caption "Share of <selected figure> income by source" (same on the County), slice i = row i (each row's th starts with `pieKey(i)` in a `.keyed` span before the toggle), share of the selected figure, rows past the seventh in the grey "All other (n)" slice, zero or negative sources add nothing; a slice toggles that source's history row (`piePick['pie-src']`, set by `mountIncomeSources()`; scrolls it into view). On phones `.table th .li-toggle` is set `position: relative` (the global `.table th button { all: unset }` otherwise leaves the toggle's 44px `::after` hit area unpositioned, which widened the page to 381px at 375px). Note: "Sources follow the books' account numbers: taxes are shown one by one, and other lines are grouped as the newest book that prints them does, so a group renamed over the years stays one row. Draws from savings and transfers between funds are not income and are left out.", plus "In All funds, charges to other funds are left out too." and a link to What counts as income. Hint (`.li-hint`): "Select a source's name to see it year by year." A source's name is a toggle (`.li-toggle.is-toggle`, `data-is="i<n>"`) that folds down its full history in a row (`tr.li-hist`, id `is-row-i<n>`, set as the toggle's `aria-controls`) directly under it, the same markup as a line item's (`salHistoryHTML(name, pts, 'Income')` ([L1534](../web/app.js#L1534)), `trendChart()` money mode); the Staff ledgers use the same fold-down (`staffLedger()`, `openInlineRow()`); `mountIncomeSources()` ([L1799](../web/app.js#L1799)); one open at a time (`srcChart`, freed by `closeSrcChart()` ([L1727](../web/app.js#L1727)) and `destroyCharts()`). Sources and their evidence: `governments/lancaster-city/mapping/income_sources.csv`. |

**What changed (`#/changes`)**

| What you see | Where |
|---|---|
| Page layout and section order (Spending by category, Positions, Largest line-item changes, New and removed lines, How it's paid for) | `changesPage()` ([L2770](../web/app.js#L2770)) |
| Summary sentence (Spending / Income; "In 2023 the city spent …" for an Actual Budget year) | `headlineSentence()` ([L2419](../web/app.js#L2419)), `incomeSentence()` ([L2443](../web/app.js#L2443)), `toSubject()` ([L2370](../web/app.js#L2370)) |
| Badge ("Comparing a proposal with a year-end estimate", "Comparing an amended budget with actual spending", and the "Compare with … instead" switch) | `figureWhat`, `badgeHTML()` ([L2478](../web/app.js#L2478)) |
| Four headline numbers | `tilesHTML()` ([L2489](../web/app.js#L2489)) |
| Moved into / out of the General Fund | `shiftCard()` ([L2536](../web/app.js#L2536)), `shiftsHTML()` ([L2552](../web/app.js#L2552)) |
| Positions ("Full-time positions budgeted, General Fund: …", "How positions are counted") | `positionsHTML()` ([L2601](../web/app.js#L2601)) |
| "A line that stands out" | `spikeWCNote()` ([L2452](../web/app.js#L2452)) |
| What the revision changed, tax-policy notes | `revisionHTML()` ([L2668](../web/app.js#L2668)), `policyHTML()` ([L2692](../web/app.js#L2692)) |
| What changed controls: Budget year (every year and figure), Compare with (every other figure; County: the comparisons in its changes.json), Fund, Show first (Spending / Income) | `changesFiltersHTML()` ([L2757](../web/app.js#L2757)) |
| Which comparison is shown, and any pair not in changes.json computed in the browser (port of `compare()` in `scripts/changes.py`: lines, totals, by category / department / bureau / revenue group, draw, largest changes, new and removed lines) | `changeCmp()` ([L2212](../web/app.js#L2212)), `wcDefaultFrom()` ([L2262](../web/app.js#L2262)), `buildComparison()` ([L2300](../web/app.js#L2300)) |
| Page heading ("What changed in 2024", "2023 Actual against 2026 Projected") | `wcTitle` ([L2827](../web/app.js#L2827)) |
| Positions for a pair changes.json doesn't hold: positions.json loaded on the first What changed visit, a series mapped to its position schedule, "Both figures use the 2026 position schedule, so the count of positions is the same.", "There is no position schedule for 2021 or 2020." | `loadPositions()` ([L2236](../web/app.js#L2236)), `seriesSchedule` ([L2235](../web/app.js#L2235)), `pairPositions()` ([L2252](../web/app.js#L2252)) |
| Reserve Fund version ("The 2027 Revised budget leaves $14.6M in the Reserve Fund …", "What moves the balance") | `reserveChangesPage()` ([L2717](../web/app.js#L2717)) |
| County "Accounts merged: …" note under a line | `mergeNote` ([L2584](../web/app.js#L2584)) |

**Reserve Fund (City) and General Fund Balance (County)**

| What you see | Where |
|---|---|
| City Reserve Fund page ("Year-End Balance", "Year-End Balance by Year", the 2025 two-balances note) | `reserveView()` ([L913](../web/app.js#L913)), `resAltNote()` ([L890](../web/app.js#L890)), `resLineLabel()` ([L894](../web/app.js#L894)) |
| County General Fund Balance page ("Balance at Year-End", "Balance by Year", the tie notes) | `countyBalanceView()` ([L1027](../web/app.js#L1027)), `cbLineLabel()` ([L999](../web/app.js#L999)), `cbTieNote()` ([L1012](../web/app.js#L1012)) |

**County-only sections**

| What you see | Where |
|---|---|
| Deck sentence's gap and the note under it | `countyGap` ([L1176](../web/app.js#L1176)), `countyGapNote()` ([L1178](../web/app.js#L1178)) |
| Budget and Actual | `actualsHTML()` ([L1208](../web/app.js#L1208)); its note paragraphs are `actuals_note` in `web/data/county/budget.json` (written by `scripts/build_county.py`) |
| The 2026 Budget in Context | `contextHTML()` ([L1317](../web/app.js#L1317)); the facts come from `data/county/context_facts.csv` |
| "Group" / "Department" in place of "Department" / "Bureau" | search `isCounty()` in `homeView()`, `deptPage()`, `ledgerHTML()` and `JT` |

**About the data and Funds and terms**

| What you see | Where |
|---|---|
| City About (Sources, Projections, Reserve Fund, Departments and bureaus, Validation, Printed and calculated totals, Known problems, Get the data, Contact) | `renderAbout()` ([L3356](../web/app.js#L3356)) |
| County About (Context facts, Sources, Actual figures, Departments and funds, How the County is run, General Fund balance, Validation, Merged accounts, …) | `renderAboutCounty()` ([L3280](../web/app.js#L3280)) |
| Funds and terms | `termsPage()` ([L3476](../web/app.js#L3476)), `FUND_INFO` |
| How the City budget is made | `calendarPage()`, `calSteps()` (see the section above) |

---

## 5. Data files the site reads (`web/data/`)

Built by `scripts/build_dataset.py` (City) and `scripts/build_dataset.py --entity county` (County, via `scripts/build_county.py`). Never edit them by hand: change the CSVs and rebuild. The City's are listed in `config.json` `entities.city.files`, the County's in `entities.county.files`; `budget.json` is always loaded.

| File | Top-level fields |
|---|---|
| `web/data/budget.json` | `generated` (build time, shown in the footer), `newest_year`, `measures`, `rule` (which book each figure comes from), `books`, `docs`, `funds`, `departments`, `bureaus`, `categories`, `accounts`, `not_income` (revenue accounts that are not income: {account index: `draw` | `transfer` | `charge`}, from `governments/lancaster-city/mapping/income_rules.csv`), `tax_limit` (City only, `scripts/tax_limit.py`: `limit_pct`, `first_year`, `fund`, `section`, `baseline_measure`, `transition` {`section`, `budget_years`}, `lines` [[object code, name, counts, reason]], `tests`: one per budget made under the charter and tested column, each {`year`, `measure` (`proposed`/`revised`), `column`, `book_year`, `doc`, `value` (calculated sum), `lines` [[code, name, amount, page]], `newest` (the year's newest figure), `base` {`year`, `measure`, `column`, `doc`, `value`, `lines`}, `change_pct`, `limit`, `over`}), `series` (one per year and figure, e.g. `2027|revised`), `printed` (every printed total), `known_issues`, `missing_bureaus`, `reserve` (`name`, `entries`), `projection` (`label`, `doc`, `after_year`, `years`, `series`, `printed`, `surplus`, `assumptions`), `conflict_count`, `org` (`chart_doc`, `desc_doc`, `departments`, `units`, `codes`) |
| `web/data/changes.json` | `year`, `default` (the comparison What changed opens on), `note`, `comparisons` (one per pair, e.g. `2027|revised~2026|projected`), `shifts`, `policy`, `line_notes` |
| `web/data/staffing.json` | `units`, `titles`, `books` (one staffing schedule each) |
| `web/data/positions.json` | `note`, `schedules` (id → `label`, `doc`; ids `2027|proposed`, `2027|revised`, `2026` … `2022`), `pairs` (`"<to>~<from>"` for every ordered pair of schedules, 42: the same positions block as a changes.json comparison, plus `unplaced` artifacts for positions under org codes the org chart doesn't have). Built by `build_positions()` in `scripts/changes.py`; loaded lazily (`lazy_files`). |
| `web/data/tax_rates.json` | `rates`: one per government, tax and year {`gov`, `tax`, `year`, `label`, `rate`, `unit`, `assessed_year`, `account`, `href` (source link: a PDF page under `pdfs/` or an https address; `null` when user-provided), `doc`, `user_provided`, `carried` (a base carried from the year before for a tax with a budget change and no row of its own), `steps` (the newest budget's changes from `governments/lancaster-city/notes/policy_notes.csv`: each {`figure`, `label`, `rate`, `tax`, `change_pct`, `calculated`, `href`, `doc`, `user_provided`, `change_href`})}. Built from `governments/<id>/mapping/tax_rates.csv` by `scripts/tax_rates.py`; shared by City and County, loaded at start-up from `config.json` `tax_estimate.rates`. |
| `web/data/conflicts.json` | a list: one entry per figure two books print differently (empty today) |
| `web/data/county/budget.json` | as the City's, plus `entity`, `context` (`year`, `presentation`, `facts`), `actuals` (`measure`, `basis`, `years`, `levels`, `sign`, `funds`, `sources`, `figures`, `book`) and `actuals_note`; `reserve` adds `entity`, `measures`, `basis`, `sources`; `org` adds `chart_page`, `unlisted`, `elected_chart`, `elected_list`. No `projection`. |
| `web/data/county/changes.json` | `year`, `default`, `note`, `account_changes`, `comparisons`, `shifts`, `policy` |
| `web/data/county/conflicts.json` | a list (11 entries today): `kind`, `account_code`, `fund`, `fiscal_year`, `measure`, `account_name`, `used`, `used_doc`, `used_page`, `other`, `other_doc`, `other_page`, … |
| `web/data/county/fund_balance_gaap.json` | `basis`, `note`, `sources`, `rows` (audited year-end fund balances) |

What each field holds in detail: [PIPELINE.md](PIPELINE.md#building-the-site-data).

---

## 6. Hand-kept data files (`data/`)

These are edited by a person and committed; the pipeline reads them and never writes them (except `org_descriptions_2027.csv`, below). After editing one, rebuild and check. Each keeps its evidence: never delete the printed value or the source.

| File | Rows | Columns | What it changes on the site |
|---|---|---|---|
| `governments/lancaster-city/notes/known_issues.csv` | 40 | `source_doc`, `source_page`, `label`, `note` | City "Known problems in the source books" on About, the explanation in each ≠ note, and bureaus with no staffing page. |
| `governments/lancaster-city/notes/line_notes.csv` | 1 | `year`, `figure`, `account`, `text`, `source` | What the book says about a "stands out" line, added after the generated note. `source` is `<pdf>#page=N`. |
| `governments/lancaster-city/mapping/income_rules.csv` | 16 | `code` (City object code or County account), `fund` (blank: every fund), `class` (`draw`, `transfer`, `charge`, `income`), `lines`, `evidence` | Which revenue lines are not income (draws from savings, transfers between the government's own funds), which are charges between funds (income of one fund, left out of All funds), and reviewed look-alikes that are income. Read by `scripts/income_rules.py` into `budget.json` `not_income`; `check_dataset.py` fails on an unreviewed look-alike. |
| `governments/lancaster-city/content/rules/tax_limit_lines.csv` | 9 | `code` (City object code), `name`, `counts` (`yes`/`no`), `reason` | Which General Fund lines are tax revenue for the Home Rule 6% limit (§ 8.08): `yes` lines are summed for each budget's test; `no` lines are tax-looking lines left out, with why (listed under "Which lines count" on How the City budget is made). Read by `scripts/tax_limit.py` into `budget.json` `tax_limit`; `check_dataset.py` fails on a General Fund "Tax Revenue" line not listed. |
| `governments/lancaster-city/mapping/income_sources.csv` | 18 | `code` (City object code; the County has no rows), `fund` (blank: every fund), `source`, `evidence` | The source an income line is shown under in the Income Sources panel: the taxes one by one (real estate, earned income, local services, real estate transfer, payments in lieu of taxes), the one-time federal ARPA revenue replacement, and grants and reimbursements. Lines with no row are shown under the group the book prints them under. No County rows. Read and validated by `scripts/income_sources.py` into `budget.json` `income_sources`. |
| `governments/lancaster-city/notes/policy_notes.csv` | 5 | `year`, `figure`, `item`, `text`, `source`, `account`, `rate_from`, `rate_to`, `unit`, `change_pct` | Tax-policy notes in "What the revision changed" and in the income highlights under an income total (for the year and figure in view, where the view holds the `account` line). Rows with `rate_from`/`rate_to`/`unit` (all three, or the build stops) or `change_pct` (0 = no change) become tax tiles in What changed. `source` is a book page or a short description; `account` (optional) puts the note beside that revenue line. The City's notes with `rate_to` or `change_pct` also set next year's rates on What would you pay? (via `scripts/tax_rates.py`). |
| `governments/<id>/mapping/tax_rates.csv` | 3 City + 1 County | `tax` (`real_estate` in mills, `earned_income` in %), `year`, `label`, `rate`, `unit`, `assessed_year` (real estate: which year's assessed value the rate applies to), `account` (City budget line: matches `policy_notes.csv` and the links from What changed), `source` (`<pdf>#page=N`, an https address, or `user-provided; …`), `evidence` | The rates in force each year before any budget change: this year's (City 12.64 mills and 1.10%, County 3.201 mills, all 2026) and the City's 2027 revenue-neutral property rate after the reassessment (5.71 mills, user-provided). Next year's rates are built from `policy_notes.csv` (`rate_to`, or `change_pct` on this file's rate); the page shows the latest figure only (2027 Revised: 5.71 mills, 1.3%). Read by `scripts/tax_rates.py` into `web/data/tax_rates.json`; `check_dataset.py` fails on a bad row, a County rate that differs from `context_facts.csv`, a policy note whose `rate_from` differs from the rate here, or a stale JSON. |
| `governments/lancaster-city/mapping/units.csv` | 42 | `department`, `unit`, `kind`, `division`, `chart_page`, `descriptions`, `aliases`, `notes` | City department and bureau names, order, kinds (`bureau`, `department-wide`, `whole-department`), divisions, which descriptions show, old link slugs (`aliases`). |
| `governments/lancaster-city/mapping/org_structure.csv` | 74 | `org_code`, `fund`, `department`, `unit`, `printed_department`, `printed_names`, `notes` | Which bureau each budget org code belongs to, with the evidence. |
| `governments/lancaster-city/content/org_descriptions.csv` | 39 | `id`, `level`, `parent`, `heading`, `source_page`, `text` | "What does this department/bureau do?" text. Generated by `scripts/extract_org_descriptions.py`; hand edits are lost if it is rerun. |
| `governments/lancaster-city/notes/sign_corrections.csv` | 60 | `source_doc`, `source_page`, `account_code`, `column`, `printed_value`, `corrected_value`, `section`, `section_page`, `printed_total`, `line_sum`, `gap`, `evidence` | Minus signs the City's books dropped, each proven by a printed total. |
| `governments/lancaster-city/notes/ocr_corrections.csv` | 4 | `source_doc`, `source_page`, `row_label`, `column`, `ocr_text`, `corrected_value`, `evidence` | Amounts the OCR of the City's scanned 2026 book misread. |
| `governments/lancaster-city/notes/staffing_corrections.csv` | 1 | `source_doc`, `source_page`, `org_code`, `object_code`, `position_title`, `column`, `printed_value`, `corrected_value`, `subtotal_label`, `printed_subtotal`, `line_sum`, `gap`, `evidence` | Staffing values proven wrong by a printed subtotal. |
| `data/county/known_issues.csv` | 27 | `source_doc`, `source_page`, `label`, `kind`, `note` | County "Known problems" on About, ≠ notes and the General Fund Balance tie notes. `kind`: `rounding`, `source_error` or `basis_difference`. |
| `data/county/context_facts.csv` | 34 | `id`, `group`, `label`, `value`, `unit`, `year`, `fund`, `source_doc`, `source_page`, `source_kind`, `find`, `also_in`, `note` | Every figure in "The 2026 Budget in Context" and the tax-rate chart. Checked by `scripts/verify_county_context.py`. |
| `data/county/elected_offices.csv` | 12 | `department_code`, `department`, `label`, `line`, `source_doc`, `source_page`, `also_in`, `note` | The "Elected office" / "Elected judges" labels on departments, and About's "How the County is run". |
| `data/county/org_units.csv` | 51 | `department_code`, `department`, `group_letter`, `group`, `book_section`, `section_page`, `department_page`, `source_doc` | County department names, codes and groups (General Government, Courts and Row Offices, Corrections, Human Services). |
| `data/county/account_changes.csv` | 2 | `first_book`, `department_scope`, `from_accounts`, `to_account`, `to_name`, `evidence` | Accounts the County folded together between books; What changed compares them as one line ("Accounts merged: …"). |
| `data/county/ocr_corrections.csv` | 177 | `source_doc`, `source_page`, `row_label`, `column`, `ocr_text`, `corrected_value`, `evidence` | Amounts the OCR of the County's scanned 2024 book misread. |

The 6% limit's settings are in `governments/lancaster-city/content/rules/tax_limit.yaml` (section 7). Book layouts, OCR settings and source addresses are in `config/*.json` (City), `config/county/*.json`, `config/county/acfr/<year>.json` and `config/county/resolutions/<budget year>.json`; see [PIPELINE.md](PIPELINE.md).

---

## 7. Pipeline settings that change what the site says

| Setting | File | Search for | Current value | What it controls |
|---|---|---|---|---|
| `SPIKE_X`, `SPIKE_SHARE` | `scripts/check_dataset.py` ([L890](../scripts/check_dataset.py#L890)) | `SPIKE_X, SPIKE_SHARE =` | `2`, `0.05` | The check's copy of the "stands out" rule; must equal `app.js`. |
| `TOLERANCE` | `scripts/check_dataset.py` ([L64](../scripts/check_dataset.py#L64)), `scripts/check_county.py` ([L61](../scripts/check_county.py#L61)) | `TOLERANCE = 5` | `5` (dollars) | Rounding allowed per printed total. Never widen it to make a check pass. |
| `DRIVER_SHARE` | `scripts/changes.py` ([L606](../scripts/changes.py#L606)) | `DRIVER_SHARE =` | `0.15` | A line is named in a department summary when it is at least 15% of the net change. |
| `DRIVER_COVER` | `scripts/changes.py` ([L607](../scripts/changes.py#L607)) | `DRIVER_COVER =` | `0.5` | Below this share, the summary names categories instead of lines. |
| `TITLE_MIN` | `scripts/changes.py` ([L608](../scripts/changes.py#L608)) | `TITLE_MIN =` | `1` | Position titles are named when their count changes by at least this many. |
| `TITLE_WORDS` | `scripts/changes.py` ([L597](../scripts/changes.py#L597)) | `TITLE_WORDS =` | abbreviation → word pairs (e.g. "POL OFF") | Spells out printed title abbreviations so two books' titles match. |
| Category names | `scripts/budget_common.py` ([L64](../scripts/budget_common.py#L64)) | `def category_for` | Salaries & Wages, Benefits, … | The City's category for each object code. |
| 6% tax revenue limit | `governments/lancaster-city/content/rules/tax_limit.yaml` | `first_year`, `limit_pct`, `tested`, `baseline_measure`, `transition` | `first_year` 2025; `limit_pct` 6; `tested` `proposed` → Proposed, `proposed_revised` → Revised; `baseline_measure` `projected` (the same book's revised projection, else its projection, per `build_dataset.py` `RULE`); `transition.budget_years` [2025, 2026, 2027], `transition.section` 13.14 | Which City budgets are tested against Home Rule Charter § 8.08 (books from `first_year` on; none before), the limit, which column is the budget and which is "the year before", and which flagged budgets carry the § 13.14 note ("may waive the limit for budgets adopted in the charter's first two years"). Which lines count: `governments/lancaster-city/content/rules/tax_limit_lines.csv`. |
