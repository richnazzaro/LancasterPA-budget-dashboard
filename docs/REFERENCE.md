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
| `default_entity` ([L4](../web/config.json#L4)) | `city` | Not read by the site today. A bare address opens the entity the visitor last chose (`localStorage` key `entity`), otherwise the City. |
| `entities` ([L5](../web/config.json#L5)) | `city`, `county` | One block per entity, below. The City / County tabs in `index.html` link to these two ids. |

### `entities.city` and `entities.county`

| Key | City value | County value | What it controls |
|---|---|---|---|
| `label` | `City` | `County` | Not read by the site today (the tab text is in `index.html`). |
| `title_suffix` ([L26](../web/config.json#L26)) | (none) | `: County` | Added to `site_title` for this entity (the County's wordmark and tab titles read "Lancaster Budget Explorer: County"). |
| `entity.name` | `City of Lancaster, PA` | `County of Lancaster, PA` | Not read by the site today. |
| `entity.short` ([L10](../web/config.json#L10)) | `City of Lancaster` | `County of Lancaster` | The running head above every page heading, the first part of every browser tab title, the Funds and terms cross-link, and the fallback name in "Totals by Year" notes. |
| `entity.kind` | `city` | `county` | Not read by the site today. |
| `entity.possessive` | `the City of Lancaster's` | `the County of Lancaster's` | Funds and terms intro ("Which of the City of Lancaster's funds are paid for by taxes…") and About. |
| `description` ([L14](../web/config.json#L14)) | "City of Lancaster, PA budget by department, bureau and line item, from the city's published budget books." | "Lancaster County, PA budget by department and line item, with audited actuals by fund, from the County's published budget books and annual financial reports." | The `<meta name="description">` once the page has loaded (search engines read the one in `index.html`). |
| `tagline` | "This is an independent project, not associated with the City of Lancaster." | "… not associated with the County of Lancaster." | The disclaimer under the site name. |
| `footer` | "An independent transparency project using the City of Lancaster's published budget books." | "… using the County of Lancaster's published budget books and annual financial reports." | Footer text. |
| `default_fund` | `General Fund` | `General Fund` | The fund every page opens on. |
| `files` | `["changes", "staffing"]` | `["changes", "fund_balance_gaap"]` | Which optional data files to load besides `budget.json`: `changes.json` (What changed), `staffing.json` (Staff section), `fund_balance_gaap.json` (County audited balances). |
| `adopted` ([L37](../web/config.json#L37)) | (none) | `{ "year": 2026, "text": "adopted Dec 24, 2025 (Resolution 79 of 2025)" }` | Added to the status stamp for that year ("2026: Budget, adopted Dec 24, 2025 (Resolution 79 of 2025)"), and used on Funds and terms and County About. Update it when a new County budget year arrives. |
| `fund_names` ([L39](../web/config.json#L39)) | (none) | `Fund B` → `Liquid Fuels (Fund B)`, `Fund E` → `Drug & Alcohol (Fund E)`, `Fund EI` → `Early Intervention (Fund EI)`, `Fund F` → `Domestic Relations (Fund F)`, `Fund G` → `Aging (Fund G)`, `Fund H` → `Behavioral Health (Fund H)`, `Fund R` → `Developmental Services (Fund R)`, `Fund Y` → `Children & Youth (Fund Y)`, `Fund H+R+EI` → `Behavioral Health, Developmental Services & Early Intervention (Funds H, R, EI)` | How a fund letter is shown everywhere (Fund list, tables, Funds and terms). A fund not listed shows as printed. |
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
| Header navigation | `id="site-nav"` ([L37](../web/index.html#L37)) | Overview · What changed · Reserve Fund · Funds and terms · About the data (each `data-nav`: `home`, `changes`, `reserve`, `terms`, `about`) | `applyChrome()` sets the links per entity and renames "Reserve Fund" to the data's reserve name (the County's "General Fund Balance"). `onRoute()` keeps "What changed" pointing at the current fund and figure. |
| Jump search label and placeholder | `id="jump-input"` ([L46](../web/index.html#L46)) | label "Jump to a department, bureau or line item"; placeholder "Jump to a department or line" | Results come from `buildJumpIndex()` in `app.js`. |
| Theme button | `id="theme-toggle"` ([L51](../web/index.html#L51)) | moon icon and "Dark" while light; sun and "Light" while dark | Label and title set by `applyTheme()`. |
| Loading text | `Loading budget…` ([L57](../web/index.html#L57)) | "Loading budget…" | Shown until the data arrives. |
| About heading | `id="about-title"` ([L60](../web/index.html#L60)) | "About the data" | The body is written by `renderAbout()` / `renderAboutCounty()`. |
| Reading notes margin | `id="margin"` ([L63](../web/index.html#L63)) | aria-label "Reading notes" | Filled by `renderMargin()` on screens 1750px and wider. |
| Footer | `id="site-footer"` ([L66](../web/index.html#L66)) | three spans: `footer-text`, `generated`, `footer-contact` | Filled from `footer`, the data's build date and `contact_email`. |
| Chart library | `Chart.js/4.4.1` ([L72](../web/index.html#L72)) | Chart.js 4.4.1 from cdnjs, with an `integrity` hash | A new version needs its new hash. |

---

## 3. `web/styles.css`

All colors live in three blocks at the top of the file; the charts read them from there (`loadTokens()` in `app.js`), so no color is set in JavaScript.

- `:root { … }` ([L17](../web/styles.css#L17)): the light theme, plus the fonts;
- `:root[data-theme="dark"] { … }` ([L52](../web/styles.css#L52)): dark, when chosen with the header toggle;
- `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` ([L64](../web/styles.css#L64)): the same dark values, for visitors who have not chosen (the site follows their device).

**Change a dark value in both dark blocks** (they hold identical values). Keep text at 4.5:1 contrast on `--bg` and chart marks, borders that identify a control and the focus ring at 3:1, in both themes (DESIGN.md, "The Contrast Rule"). The comment above `:root` gives the reasoning and the measured ratios.

### Color and font tokens

"Read by `app.js`" names the JavaScript variable that `loadTokens()` copies the token into for the charts.

| Token | Light | Dark | Used for (CSS) | Read by `app.js` |
|---|---|---|---|---|
| `--bg` | `#fcfcfa` | `#101512` | Page background (paper); text on the selected City/County tab and selected segmented tabs | `BG` (chart background) |
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
| `--cat-other` | `#d0d4cd` | `#4a5750` | (no CSS rule) | `OTHER_COLOR`: categories past `PIE_SLICES` |
| `--red` | `#a12626` | `#ef7b6f` | Ledger red: shortfalls (`.neg`) and the ≠ gap mark only | |
| `--blue` | `#1d5a3a` | `#7fc99b` | Keyboard focus ring (the name is historical; the value is green) | |
| `--font` | `"Source Sans 3", ui-sans-serif, system-ui, …, sans-serif` | (same) | Body, labels, tables, controls | `Chart.defaults.font.family` in `boot()` |
| `--serif` | `"Source Serif 4", Georgia, "Times New Roman", serif` | (same) | Headlines, big figures, deck sentence, running head, department names | |

Other colors outside the token blocks:
- **Dropdown chevron** ([L132](../web/styles.css#L132)): drawn in the `select` background image, light `%234a524d` (#4a524d), dark `%23a9b4ac` (#a9b4ac) in both dark rules at the end of the file ([L885](../web/styles.css#L885)).

### Type sizes (main ones)

| Element | Rule | Current |
|---|---|---|
| Body text | `body {` ([L81](../web/styles.css#L81)) | 16px / 1.5, `--font`, tabular figures |
| Site name | `.wordmark {` ([L98](../web/styles.css#L98)) | serif 24px bold |
| Running head above headings ("City of Lancaster") | `.eyebrow {` ([L882](../web/styles.css#L882)) | serif 18px semibold, `--sel-ink` |
| Page heading | `.page-head h1 {` ([L122](../web/styles.css#L122)) | serif 56px (44px under 1024px, 32px on phones) |
| Deck sentence ("Up $5.0M (6.0%) …") | `.deck {` ([L759](../web/styles.css#L759)) | serif 26px semibold |
| Big total | `.big-total {` ([L763](../web/styles.css#L763)) | serif 44px, `--sel-ink`; label `.big-total .big-label` 13px uppercase |
| Department name | `.dept-name {` ([L179](../web/styles.css#L179)) | serif 52px |
| Chart text | `Chart.defaults.font.size` in `app.js` ([L2732](../web/app.js#L2732)) | 13px |

### Breakpoints

| Width | What changes | Search for |
|---|---|---|
| 1750px and up | Reading notes margin (260px) appears beside the page; main `max-width: 1480px` | `min-width: 1750px` ([L792](../web/styles.css#L792)) |
| 1280px and up | About sections two to a row | `min-width: 1280px` ([L750](../web/styles.css#L750)) |
| 1100px and up | Header becomes the 300px contents rail; main column `max-width: 1360px` | `min-width: 1100px` ([L662](../web/styles.css#L662)) |
| 1024px and up / 1023px and down | Bureau cards and What changed tiles two to a row; smaller page headings and big totals below | `min-width: 1024px`, `max-width: 1023px` |
| 767px and down | Phone layout (stacked tables, "On this page" outline, 46px tabs) | `max-width: 767px` |
| 420px, 339px and down | Narrowest phones | `max-width: 420px`, `max-width: 339px` |

---

## 4. `web/app.js`

### Labels and constants

| Name | Search for | Current value | What it controls |
|---|---|---|---|
| `LABEL` ([L20](../web/app.js#L20)) | `const LABEL` | `proposed` "Proposed", `revised` "Revised", `projected` "Projected", `actual` "Actual", `budget` "Budget", `projection` "Projection" | The figure word everywhere (controls, legends, tables, sentences). |
| `ORDER` ([L21](../web/app.js#L21)) | `const ORDER` | `actual`, `projected`, `budget`, `proposed`, `revised` | Order of figures within a year (Compare with list, tables). |
| `STATUS` ([L22](../web/app.js#L22)) | `const STATUS` | `proposed` "Proposed, not adopted"; `revised` "Revised proposal, not adopted"; `projected` "Projected year-end estimate"; `actual` "Actual spending"; `budget` "Budget" | The status stamp in the controls strip ("2027: Revised proposal, not adopted"); the County adds `adopted.text` from `config.json`. Built by `statusHTML()`. |
| `CAT_ORDER` ([L26](../web/app.js#L26)) | `const CAT_ORDER` | Salaries & Wages, Benefits, Operating, Equipment & Capital, Debt, Transfers & Allocations, Revenue, Uncoded | Order of City categories in charts and tables, and which `--cat-*` color each gets. The names themselves come from the data (`category_for()` in `scripts/budget_common.py`; County: `scripts/build_county.py`). |
| `PAGE_SIZE` ([L37](../web/app.js#L37)) | `const PAGE_SIZE` | `20` | Line-item rows shown at a time (the "Show 20 more" button adds this many). |
| `PIE_SLICES` ([L38](../web/app.js#L38)) | `const PIE_SLICES` | `7` | How many categories get their own color; the rest use `--cat-other`. |
| `MINUS` ([L57](../web/app.js#L57)) | `const MINUS` | `−` (−) | The one minus sign used in every number. Formats: `money()`, `fmtPct()`, `short()`, `mny()`. |
| `CALC_TAG` ([L135](../web/app.js#L135)) | `const CALC_TAG` | "calculated" (`.calc-tag`) | The label on the site's own sums. |
| `GAP_SIGN` ([L136](../web/app.js#L136)) | `const GAP_SIGN` | `≠` (≠) | The mark on a printed total whose lines miss it beyond rounding (`gapMark()`, `gapNote()`). |
| `DEFINE_CITY` ([L306](../web/app.js#L306)) | `const DEFINE_CITY` | Proposed: "the administration's first budget proposal."; Revised: "the revised proposal."; "Neither is adopted."; Projected: "the city's year-end estimate."; Actual: "what was spent, reported in the budget book two years later." | "What do these mean?" beside the controls, and the Reading notes margin (City). |
| `DEFINE_COUNTY` ([L308](../web/app.js#L308)) | `const DEFINE_COUNTY` | Budget: "the County's budget for the year, from its own budget books. …"; Actual: "what the County's audited annual report says it received and spent. …" | The same, for the County. |
| "What is a fund?" text | `const defineFund` ([L312](../web/app.js#L312)) | City: "A fund is a separate account the city keeps for a purpose. …"; County: "A fund is a separate account the County keeps for a purpose. …" | The fund toggle beside the Fund list. |
| `controlsOpen()` default ([L324](../web/app.js#L324)) | `ctlOpen ?? false` | `false` (closed) | Whether the controls start open. The visitor's choice is saved as `localStorage` key `controlsOpen`. |
| `SPIKE_X`, `SPIKE_SHARE` ([L548](../web/app.js#L548)) | `const SPIKE_X` | `2`, `0.05` | "Stands out" notes: a line at least 2× both neighbouring years, with a jump of at least 5% of its fund's total. Keep equal to `SPIKE_X, SPIKE_SHARE` in `scripts/check_dataset.py` (section 7). |
| `RES_STATUS` ([L671](../web/app.js#L671)) | `const RES_STATUS` | `actual` "Actual year-end balance"; `projected` "Projected year-end balance"; `proposed` "Proposed, not adopted"; `revised` "Revised proposal, not adopted" | Status stamp on the Reserve Fund page. |
| `resLabel` ([L662](../web/app.js#L662)) | `const resLabel` | "<year> <LABEL>", "Actual (unaudited)" for an unaudited year-end | Year labels on the Reserve Fund chart and table. |
| `WC_TOP` ([L1575](../web/app.js#L1575)) | `const WC_TOP` | `10` | Rows in "Largest changes" on What changed before "All N changed lines". |
| `unitLabel` ([L1460](../web/app.js#L1460)) | `const unitLabel` | "Department-wide costs (not a bureau)" / "Department revenue (not a bureau)" | Name of the City's department-wide group. |
| `plainName` ([L186](../web/app.js#L186)) | `const plainName` | drops a trailing " Exp" / " Expense" | Display names of old printed budget groups. |
| `isDraw` ([L604](../web/app.js#L604)) | `const isDraw` | name starts "Fund Balance Reserve" and object `499000` | Which revenue lines count as money drawn from savings. |
| `drawDC`, `drawSplit` ([L625](../web/app.js#L625)) | `const drawDC` | "… drawn from savings (… of it from dedicated data center revenue)" | The reserve-draw phrase used on every page. |
| `drawLabel` ([L1698](../web/app.js#L1698)) | `const drawLabel` | "Drawn from savings (the “Fund Balance Reserve” lines)" / "Drawn from the reserve (the “Fund Balance Reserve” line)" | Row label on What changed. |
| `countyGap` ([L945](../web/app.js#L945)) | `const countyGap` | ", spending $9.0M more than it expects to collect, covered from the General Fund's balance" | The County deck sentence's second half. |
| `JT` ([L2365](../web/app.js#L2365)) | `const JT` | City: Department, Bureau, Line item; County: Group, Department, Line item | Result type labels in the Jump search. |
| `FUND_INFO` ([L2561](../web/app.js#L2561)) | `const FUND_INFO` | see "Funds and terms" below | What pays for each fund, and what it is. |
| Font wait ([L2734](../web/app.js#L2734)) | `setTimeout(r, 1500)` | 1.5 s | How long the first chart waits for the web font. |
| Saved choices | `localStorage` | keys `theme`, `entity`, `controlsOpen` | Theme, last entity, controls open/closed. |

### Funds and terms (`#/terms`, `#/county/terms`)

`FUND_INFO` ([L2561](../web/app.js#L2561)): one row per fund, `[paid for by, what it is]`. A fund in the data with no row shows "See the books". The table follows the data's funds, so a fund is listed only if the data has it.

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

The rest of the page is `termsPage()` ([L2586](../web/app.js#L2586)): the heading "Funds and terms", the intro, the Reserve Fund / General Fund Balance definition (`balance`), the figure words (`words`: Actual, Projected, Proposed, Revised, Projection, calculated; County: Budget, Actual, calculated) and "Adopted and Amended (not shown)" (`notShown`). The toggles link to it through `termHref()` ([L2627](../web/app.js#L2627)).

### Wording by page

Each row names the function that writes the text; search for it in `web/app.js`.

**On every page**

| What you see | Where |
|---|---|
| Running head above the heading ("City of Lancaster") | `addEyebrow()` ([L2262](../web/app.js#L2262)); the name is `entity.short` in `config.json` |
| Browser tab titles ("City of Lancaster · Overview · Lancaster Budget Explorer") | `pageTitle` ([L55](../web/app.js#L55)) |
| Wordmark, tagline, footer, contact line ("Questions or corrections: …"), nav links | `applyChrome()` ([L2690](../web/app.js#L2690)) |
| City / County tab links (each opens the same kind of page in the other entity) | `renderSwitch()` ([L2707](../web/app.js#L2707)) |
| Status stamp ("2027: Revised proposal, not adopted") | `statusHTML()` ([L274](../web/app.js#L274)), `STATUS` |
| Controls strip ("Viewing 2027 Revised · compared with 2026 Projected · General Fund · Spending", "Change view" / "Close") | `controlsWrap()` ([L330](../web/app.js#L330)), `filtersHTML()` ([L344](../web/app.js#L344)), `tabField` ([L292](../web/app.js#L292)) |
| Field labels: Fiscal year, Compare with, Fund, Figure, Show (Spending / Income), "No comparison" | `filtersHTML()` |
| Fund list order (All funds, General Fund, other funds, Reserve Fund last) and "Only the funds this department uses are listed." | `fundOptions()` ([L284](../web/app.js#L284)), `filtersHTML()` |
| "Known issues for this view" | `knownLink` ([L280](../web/app.js#L280)) |
| Printed vs calculated totals, the ≠ note ("The lines this total covers add up to …") | `totalOf()` ([L129](../web/app.js#L129)), `fig()` ([L140](../web/app.js#L140)), `gapNote()` ([L150](../web/app.js#L150)), `missingNote()` ([L158](../web/app.js#L158)) |
| Contents rail ("On this page") | `renderRail()` ([L2161](../web/app.js#L2161)) |
| Reading notes margin (1750px and up) | `renderMargin()` ([L2151](../web/app.js#L2151)) |
| Jump search results and "No matches." | `buildJumpIndex()` ([L2366](../web/app.js#L2366)), `initJump()` ([L2383](../web/app.js#L2383)) |
| Theme button label | `applyTheme()` ([L2634](../web/app.js#L2634)) |
| "Could not load the budget data" | `loadEntity()` ([L2659](../web/app.js#L2659)), `boot()` ([L2716](../web/app.js#L2716)) |

**Home (Overview)**

| What you see | Where |
|---|---|
| Page layout and order of sections; the deck sentence ("Up $5.0M (6.0%) from 2026 Projected, with $4.7M drawn from savings …"); "Income vs. Spending by Fund" | `homeView()` ([L1025](../web/app.js#L1025)) (the `deck` block), `heroDelta()` ([L920](../web/app.js#L920)), `drawNote()` ([L634](../web/app.js#L634)) |
| "What changed in 2027" summary beside Totals by Year | `homeChangesHTML()` ([L2042](../web/app.js#L2042)) |
| Departments ledger | `ledgerHTML()` ([L903](../web/app.js#L903)) |
| Totals by Year chart, legend, "Show values" table | `trendHTML()` ([L464](../web/app.js#L464)), `drawTrend()` ([L494](../web/app.js#L494)) |
| The projection note ("2028 and 2029 are projections, not budgets: …") and "The city's assumptions" | `projectionNote()` ([L431](../web/app.js#L431)); the assumption lines come from the data |
| "Stands out" notes ("2025 stands out: Building Permits …") | `spikeSentence()` ([L584](../web/app.js#L584)), `spikeNotes` ([L592](../web/app.js#L592)), `lineSpikes()` ([L553](../web/app.js#L553)) |
| How the reserve draw is split ("$4.7M drawn from savings ($1.9M of it from dedicated data center revenue)") | `drawParts()` ([L616](../web/app.js#L616)), `drawLineLabel()` ([L628](../web/app.js#L628)), `reserveTie()` ([L646](../web/app.js#L646)) |

**Department and bureau pages**

| What you see | Where |
|---|---|
| Layout, headings (Compare, Line Items), in-page links | `entityView()` ([L1295](../web/app.js#L1295)), `crumbsHTML` ([L1205](../web/app.js#L1205)), `jumpNav` ([L1209](../web/app.js#L1209)) |
| Department page: bureau cards, "What does this department do?" | `deptPage()` ([L1491](../web/app.js#L1491)), `cardList()` ([L888](../web/app.js#L888)), `aboutHTML()` ([L1475](../web/app.js#L1475)) |
| Bureau page: "What does this bureau do?", department-wide group | `bureauPage()` ([L1537](../web/app.js#L1537)) |
| Short "What changed" section and its summary ("Budgeted positions:", "Largest increases:", …) | `deptChangesHTML()` ([L2120](../web/app.js#L2120)), `deptSummaryHTML()` ([L2057](../web/app.js#L2057)) |
| Staff section (Budgeted positions, Salaries and wages, position titles) | `staffHTML()` ([L1218](../web/app.js#L1218)) |
| Category table | `categorySection()` ([L1173](../web/app.js#L1173)) |
| Line items: count ("97 line items (1 only in 2026 Projected)"), headers, the search box ("Search line items, account numbers…"), "Show 20 more" | `lineCountText()` ([L1378](../web/app.js#L1378)), `lineTable()` ([L1383](../web/app.js#L1383)) |
| "Export this view (CSV)": columns and file name | `exportCSV()` ([L1419](../web/app.js#L1419)) |

**What changed (`#/changes`)**

| What you see | Where |
|---|---|
| Page layout and section order (Spending by category, Positions, Largest line-item changes, New and removed lines, How it's paid for) | `changesPage()` ([L1985](../web/app.js#L1985)) |
| Summary sentence (Spending / Income) | `headlineSentence()` ([L1644](../web/app.js#L1644)), `incomeSentence()` ([L1667](../web/app.js#L1667)) |
| Badge (comparing a proposal with an estimate or actual) | `badgeHTML()` ([L1704](../web/app.js#L1704)) |
| Four headline numbers | `tilesHTML()` ([L1714](../web/app.js#L1714)) |
| Moved into / out of the General Fund | `shiftCard()` ([L1758](../web/app.js#L1758)), `shiftsHTML()` ([L1774](../web/app.js#L1774)) |
| Positions ("Full-time positions budgeted, General Fund: …", "How positions are counted") | `positionsHTML()` ([L1823](../web/app.js#L1823)) |
| "A line that stands out" | `spikeWCNote()` ([L1682](../web/app.js#L1682)) |
| What the revision changed, tax-policy notes | `revisionHTML()` ([L1881](../web/app.js#L1881)), `policyHTML()` ([L1905](../web/app.js#L1905)) |
| Show first (Spending / Income) and the other controls | `changesFiltersHTML()` ([L1968](../web/app.js#L1968)) |
| Reserve Fund version ("The 2027 Revised budget leaves $14.6M in the Reserve Fund …", "What moves the balance") | `reserveChangesPage()` ([L1930](../web/app.js#L1930)) |
| County "Accounts merged: …" note under a line | `mergeNote` ([L1806](../web/app.js#L1806)) |

**Reserve Fund (City) and General Fund Balance (County)**

| What you see | Where |
|---|---|
| City Reserve Fund page ("Year-End Balance", "Year-End Balance by Year", the 2025 two-balances note) | `reserveView()` ([L711](../web/app.js#L711)), `resAltNote()` ([L688](../web/app.js#L688)), `resLineLabel()` ([L692](../web/app.js#L692)) |
| County General Fund Balance page ("Balance at Year-End", "Balance by Year", the tie notes) | `countyBalanceView()` ([L828](../web/app.js#L828)), `cbLineLabel()` ([L800](../web/app.js#L800)), `cbTieNote()` ([L813](../web/app.js#L813)) |

**County-only sections**

| What you see | Where |
|---|---|
| Deck sentence's gap and the note under it | `countyGap` ([L945](../web/app.js#L945)), `countyGapNote()` ([L947](../web/app.js#L947)) |
| Budget and Actual | `actualsHTML()` ([L977](../web/app.js#L977)); its note paragraphs are `actuals_note` in `web/data/county/budget.json` (written by `scripts/build_county.py`) |
| The 2026 Budget in Context | `contextHTML()` ([L1074](../web/app.js#L1074)); the facts come from `data/county/context_facts.csv` |
| "Group" / "Department" in place of "Department" / "Bureau" | search `isCounty()` in `homeView()`, `deptPage()`, `ledgerHTML()` and `JT` |

**About the data and Funds and terms**

| What you see | Where |
|---|---|
| City About (Sources, Projections, Reserve Fund, Departments and bureaus, Validation, Printed and calculated totals, Known problems, Get the data, Contact) | `renderAbout()` ([L2439](../web/app.js#L2439)) |
| County About (Context facts, Sources, Actual figures, Departments and funds, How the County is run, General Fund balance, Validation, Merged accounts, …) | `renderAboutCounty()` ([L2439](../web/app.js#L2439)) |
| Funds and terms | `termsPage()` ([L2586](../web/app.js#L2586)), `FUND_INFO` |

---

## 5. Data files the site reads (`web/data/`)

Built by `scripts/build_dataset.py` (City) and `scripts/build_dataset.py --entity county` (County, via `scripts/build_county.py`). Never edit them by hand: change the CSVs and rebuild. The City's are listed in `config.json` `entities.city.files`, the County's in `entities.county.files`; `budget.json` is always loaded.

| File | Top-level fields |
|---|---|
| `web/data/budget.json` | `generated` (build time, shown in the footer), `newest_year`, `measures`, `rule` (which book each figure comes from), `books`, `docs`, `funds`, `departments`, `bureaus`, `categories`, `accounts`, `series` (one per year and figure, e.g. `2027|revised`), `printed` (every printed total), `known_issues`, `missing_bureaus`, `reserve` (`name`, `entries`), `projection` (`label`, `doc`, `after_year`, `years`, `series`, `printed`, `surplus`, `assumptions`), `conflict_count`, `org` (`chart_doc`, `desc_doc`, `departments`, `units`, `codes`) |
| `web/data/changes.json` | `year`, `default` (the comparison What changed opens on), `note`, `comparisons` (one per pair, e.g. `2027|revised~2026|projected`), `shifts`, `policy`, `line_notes` |
| `web/data/staffing.json` | `units`, `titles`, `books` (one staffing schedule each) |
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
| `data/known_issues.csv` | 40 | `source_doc`, `source_page`, `label`, `note` | City "Known problems in the source books" on About, the explanation in each ≠ note, and bureaus with no staffing page. |
| `data/line_notes.csv` | 1 | `year`, `figure`, `account`, `text`, `source` | What the book says about a "stands out" line, added after the generated note. `source` is `<pdf>#page=N`. |
| `data/policy_notes.csv` | 5 | `year`, `figure`, `item`, `text`, `source`, `account` | Tax-policy notes in "What the revision changed". `source` is a book page or a short description; `account` (optional) puts the note beside that revenue line. |
| `data/org_units_2027.csv` | 42 | `department`, `unit`, `kind`, `division`, `chart_page`, `descriptions`, `aliases`, `notes` | City department and bureau names, order, kinds (`bureau`, `department-wide`, `whole-department`), divisions, which descriptions show, old link slugs (`aliases`). |
| `data/org_structure_2027.csv` | 74 | `org_code`, `fund`, `department`, `unit`, `printed_department`, `printed_names`, `notes` | Which bureau each budget org code belongs to, with the evidence. |
| `data/org_descriptions_2027.csv` | 39 | `id`, `level`, `parent`, `heading`, `source_page`, `text` | "What does this department/bureau do?" text. Generated by `scripts/extract_org_descriptions.py`; hand edits are lost if it is rerun. |
| `data/sign_corrections.csv` | 60 | `source_doc`, `source_page`, `account_code`, `column`, `printed_value`, `corrected_value`, `section`, `section_page`, `printed_total`, `line_sum`, `gap`, `evidence` | Minus signs the City's books dropped, each proven by a printed total. |
| `data/ocr_corrections.csv` | 4 | `source_doc`, `source_page`, `row_label`, `column`, `ocr_text`, `corrected_value`, `evidence` | Amounts the OCR of the City's scanned 2026 book misread. |
| `data/staffing_corrections.csv` | 1 | `source_doc`, `source_page`, `org_code`, `object_code`, `position_title`, `column`, `printed_value`, `corrected_value`, `subtotal_label`, `printed_subtotal`, `line_sum`, `gap`, `evidence` | Staffing values proven wrong by a printed subtotal. |
| `data/county/known_issues.csv` | 27 | `source_doc`, `source_page`, `label`, `kind`, `note` | County "Known problems" on About, ≠ notes and the General Fund Balance tie notes. `kind`: `rounding`, `source_error` or `basis_difference`. |
| `data/county/context_facts.csv` | 34 | `id`, `group`, `label`, `value`, `unit`, `year`, `fund`, `source_doc`, `source_page`, `source_kind`, `find`, `also_in`, `note` | Every figure in "The 2026 Budget in Context" and the tax-rate chart. Checked by `scripts/verify_county_context.py`. |
| `data/county/elected_offices.csv` | 12 | `department_code`, `department`, `label`, `line`, `source_doc`, `source_page`, `also_in`, `note` | The "Elected office" / "Elected judges" labels on departments, and About's "How the County is run". |
| `data/county/org_units.csv` | 51 | `department_code`, `department`, `group_letter`, `group`, `book_section`, `section_page`, `department_page`, `source_doc` | County department names, codes and groups (General Government, Courts and Row Offices, Corrections, Human Services). |
| `data/county/account_changes.csv` | 2 | `first_book`, `department_scope`, `from_accounts`, `to_account`, `to_name`, `evidence` | Accounts the County folded together between books; What changed compares them as one line ("Accounts merged: …"). |
| `data/county/ocr_corrections.csv` | 177 | `source_doc`, `source_page`, `row_label`, `column`, `ocr_text`, `corrected_value`, `evidence` | Amounts the OCR of the County's scanned 2024 book misread. |

Book layouts, OCR settings and source addresses are in `config/*.json` (City), `config/county/*.json`, `config/county/acfr/<year>.json` and `config/county/resolutions/<budget year>.json`; see [PIPELINE.md](PIPELINE.md).

---

## 7. Pipeline settings that change what the site says

| Setting | File | Search for | Current value | What it controls |
|---|---|---|---|---|
| `SPIKE_X`, `SPIKE_SHARE` | `scripts/check_dataset.py` ([L795](../scripts/check_dataset.py#L795)) | `SPIKE_X, SPIKE_SHARE =` | `2`, `0.05` | The check's copy of the "stands out" rule; must equal `app.js`. |
| `TOLERANCE` | `scripts/check_dataset.py` ([L55](../scripts/check_dataset.py#L55)), `scripts/check_county.py` ([L58](../scripts/check_county.py#L58)) | `TOLERANCE = 5` | `5` (dollars) | Rounding allowed per printed total. Never widen it to make a check pass. |
| `DRIVER_SHARE` | `scripts/changes.py` ([L557](../scripts/changes.py#L557)) | `DRIVER_SHARE =` | `0.15` | A line is named in a department summary when it is at least 15% of the net change. |
| `DRIVER_COVER` | `scripts/changes.py` ([L558](../scripts/changes.py#L558)) | `DRIVER_COVER =` | `0.5` | Below this share, the summary names categories instead of lines. |
| `TITLE_MIN` | `scripts/changes.py` ([L559](../scripts/changes.py#L559)) | `TITLE_MIN =` | `1` | Position titles are named when their count changes by at least this many. |
| `TITLE_WORDS` | `scripts/changes.py` ([L548](../scripts/changes.py#L548)) | `TITLE_WORDS =` | abbreviation → word pairs (e.g. "POL OFF") | Spells out printed title abbreviations so two books' titles match. |
| Category names | `scripts/budget_common.py` ([L64](../scripts/budget_common.py#L64)) | `def category_for` | Salaries & Wages, Benefits, … | The City's category for each object code. |
