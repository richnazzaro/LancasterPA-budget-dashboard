---
name: Lancaster Budget Explorer
description: The city's budget book, set properly online: open ruled sections, a contents rail with the page's own outline, and money colors (paper, ink, banknote green, ledger red).
colors:
  paper: "#fcfcfa"
  ink: "#1a1d1b"
  ink-muted: "#4a524d"
  banknote-green: "#1d5a3a"
  ledger-red: "#a12626"
  ink-gray: "#5f6862"
  hairline: "#d3d8d2"
  track: "#e6e9e4"
  hover-wash: "#eceee9"
  footer-ink: "#14201a"
  cat-ink: "#1a1d1b"
  cat-sage: "#6b7770"
  cat-olive-gold: "#8a7a2c"
  cat-stone: "#938f80"
  cat-steel: "#5f7f8f"
  cat-slate: "#4d6b86"
  cat-umber: "#8a5a44"
  cat-deep-ink: "#3b4a42"
  dark-paper: "#101512"
  dark-ink: "#eef1ec"
  dark-green: "#7fc99b"
  dark-red: "#ef7b6f"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  deck:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "32px"
  figure:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: "48px"
  headline:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "52px"
    fontWeight: 700
    lineHeight: "56px"
  title:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "30px"
  body:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  table:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
    letterSpacing: "0.16em"
rounded:
  square: "0px"
  control: "2px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "48px"
  section: "56px"
components:
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-outline-hover:
    backgroundColor: "{colors.hover-wash}"
  button-primary:
    backgroundColor: "{colors.banknote-green}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  tab-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    height: "40px"
    padding: "0 14px"
  select-field:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "8px 36px 8px 12px"
  status-stamp:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "2px 10px"
---

# Design System: Lancaster Budget Explorer

## Overview

**Creative North Star: "The Printed Budget Book"**

The site is the city's budget book, set properly: open sections divided by rules rather than boxes, a contents rail on the left, running section labels, and figures set in a serif the way a ledger prints them. Color is money color: paper, ink, banknote green for the figure you are reading, ledger red only for shortfalls. Nothing floats; nothing is carded.

Density is that of a reference book: hairline-ruled rows, tabular figures, text running the full width of the reading column (the user chose full-width text over a 70ch cap on 2026-11-20; the reading column itself is capped by the page layout). Voice is plain and sober. On the home page the total sits under the title, and a serif deck sentence directly beneath it says what changed (the user's choice, 2026-11-21); then the charts and tables. The Reserve Fund page uses the same order.

The previous look (blue and amber boxed cards matched to another site) is retired; none of its rules carry over.

**Key Characteristics:**
- Sections are open and separated by a 3px double ink rule, never boxed.
- Controls are square-ish (2px), 1px ink outline; selected tabs invert to ink on paper.
- Lists and tables are hairline-ruled rows with a 1px or 2px ink head rule.
- Serif for headlines and figures, sans for labels, tables and prose; all numerals tabular.
- Light by default, dark follows the device or the header toggle; both are tuned for contrast.

## Colors

Every token's light and dark value, and which rules and charts use it, is listed in [docs/REFERENCE.md](docs/REFERENCE.md#3-webstylescss).

A restrained money palette: near-white paper, green-black ink, one green, one red, and gray for comparison.

### Primary
- **Banknote Green** (#1d5a3a; dark theme #7fc99b): the selected figure, the headline total, selected bars and the selected state (current rail page, selected underline tab), primary buttons, links in running prose, the focus ring. Section labels, department names, crumbs and ledger links are ink, not green. Fill and text versions are the same value here (7.4:1 on paper).

### Secondary
- **Ledger Red** (#a12626; dark #ef7b6f): shortfalls and negative numbers only, always paired with a minus sign or arrow (7.0:1).

### Neutral
- **Paper** (#fcfcfa; dark #101512): page ground and header.
- **Ink** (#1a1d1b; dark #eef1ec): text, rules, control outlines, selected-tab fill.
- **Ink Muted** (#4a524d; dark #a9b4ac): secondary text, notes, comparison labels (7.6:1).
- **Ink Gray** (#5f6862; dark #8b968e): the comparison figure, at least 3:1 on paper and on the bar track; differs from green in lightness as well as hue and is drawn thinner (12px track versus 18px) at 65% opacity.
- **Hairline** (#d3d8d2) and **Track** (#e6e9e4): row dividers and empty bar tracks. **Hover Wash** (#eceee9; green at 6% for row hover).
- **Footer Ink** (#14201a): the only dark slab in light theme.
- **Category set**, for chart series and legends only (the category breakdown is a ruled table, not a pie): ink, sage (#6b7770), olive gold (#8a7a2c), stone (#938f80, 3.15:1 on paper; dark #b8b09a), steel (#5f7f8f), slate (#4d6b86), umber (#8a5a44), deep ink (#3b4a42). Ink and sage also mark Proposed (a hollow diamond) on trends; Revised is drawn in the selected green.

### Named Rules
**The Money Colors Rule.** Green means the figure being read: the total, selected bars, the selected state. Red means a shortfall; gray means the thing compared against. Labels, names and crumbs are ink. Direction of change (more or less spending) is not good or bad, so up and down use ink with an arrow, never green or red.
**The Contrast Rule.** Body text 4.5:1 and non-text (chart marks, focus ring, borders that identify a control, category colors) 3:1, in both themes; every pair in `:root` and its dark blocks is checked (2026-11-22: all pass; changed that day: dark border-strong #55645b to #6d7d73, light cat-stone #b8b09a to #938f80, dark select chevron drawn in Ink Muted).
**The Never-Color-Alone Rule.** Every color distinction also carries a second cue: a sign, an arrow, line dash, hollow diamond versus solid dot marker, or bar thickness.
**The Tokens-In-:root Rule.** All colors live in the `:root` blocks of styles.css (light, dark explicit, dark by device); charts read them from there.

## Typography

**Display Font:** Source Serif 4 (Georgia, Times New Roman, serif)
**Body Font:** Source Sans 3 (system sans fallbacks)

**Character:** A bookish serif carries headlines and every headline number; a clear humanist sans carries labels, tables and prose. Both share one superfamily lineage, so the pairing reads as one printed page.

### Hierarchy
- **Display** (700, 56px, 1.04, -0.01em): page headline. Steps to 44px under 1024px and 32px on phones.
- **Deck** (600, 26px, 32px, ink; 26px on phones too; full column width): the home sentence saying what changed, with the direction arrow in ink, set directly under the total.
- **Figure** (700, 44px, 48px, banknote green): the home total, directly under the title behind a 13px uppercase muted label, with the deck beneath it; 36px on phones. Department pages use a 52px serif name and a 28px total. The What changed lead figure is 52px (40px on home).
- **Title** (600, 22px, 30px): list-row names such as department and bureau.
- **Stat** (700, 30-36px serif): tile and compare values.
- **Body** (400, 16px, 1.5): prose, full column width.
- **Table** (400, 14px, 20px; 13px on phones): rows, with right-aligned tabular numbers; headers 600 with a 2px ink rule. Ledger department names are 18px/26px serif 600.
- **Label** (600, 14px, 0.16em, uppercase, ink): section labels at the head of each ruled section; the rail outline heading is 12px, 0.14em, muted.

### Named Rules
**The Serif Figures Rule.** Headline numbers are serif and bold; table numbers are sans, tabular, right-aligned.
**The Balanced Headline Rule.** Headings wrap balanced, paragraphs wrap pretty, and amounts never split across lines. The What changed sentences (`.wc-lede`, `.wc-lede-sm`) are paragraphs, not headings: they wrap pretty and fill the full column, on the home page and on every department and bureau page alike.

## Layout

On wide screens (1100px and up) the masthead becomes a sticky 300px contents rail on the left (name, disclaimer, Overview / What changed / Reserve Fund / Funds and terms / Home Rule and the Budget (City only) / About the data, search, theme) closed by a 3px double ink rule; the main column is at most 1360px with 64px side padding and 48px top. Under the active page only, the rail nests that page's trail and an "On this page" outline. Below 1100px the rail becomes a top bar with the sections as one row 20px apart (it fits from about 700px and scrolls sideways below that), and on phones the outline becomes a collapsed "On this page" details block under the page heading. Breakpoints: 1100, 1023, 767, 420, 339px.

Rhythm: 8px base; 16px gaps; 24px between grid items; 56px between sections (40px on phones). Home leads with What changed, with Totals by Year beside it in a two-column grid that collapses to one under 1024px. About is its own page (#/about) with readable book names linking to the PDFs; from 1280px its sections sit two to a row in a grid, with the known-problems list and the downloads spanning the full width (a grid, not CSS columns, so opening the list does not reflow the page). Department and bureau pages open What changed with the same 14px uppercase label as home ("What changed in 2027"), the 17px headline sentence, then a short bulleted summary (`.wc-sum`, 16px body, muted markers, a bold run-in label per item: Budgeted positions, Largest increases or decreases, Moved into / out of the General Fund) at full column width; its amounts are quiet dotted links. Notes that explain a figure (the "stands out" note under Totals by Year and on What changed, the Reserve Fund page's note on why General Fund income is higher than its Revenues line, which sits directly under that table) are plain 14–17px paragraphs at full column width with a bold run-in label where they have one: no box, no side stripe. On What changed, the Positions section opens with the budgeted count in body text (bold run-in label) and the explanation in muted 14px notes; "How this is counted" lands there. Department and bureau pages carry a Staff section (budgeted positions and salaries by year) between the bureau list and the category table. Department and bureau lists run as hairline rows, two columns from 1024px. Phones reorder so the verdict comes first, then controls, then charts. Touch targets are 44px on phones, with invisible hit areas grown around quiet amount links.

## Elevation & Depth

Flat. Depth comes from rules and position, not shadow: a 3px double ink rule opens each section, hairlines divide rows, and the rail is set apart by a vertical double rule. Hover is a pale green wash. The single exception is the jump-search results menu, which floats over content and carries a soft ambient shadow (`0 8px 24px rgba(0,0,0,.18)`).

### Named Rules
**The No-Box Rule.** Sections, lists, tiles and notes are never framed cards with shadow or rounded corners. Group with a rule, not a container.

## Shapes

Square. Panels, rows, bars, tiles and swatches have 0 radius; controls, stamps and notices have a 2px radius with a 1px ink border. Focus is a 2px outline offset 2px. The only round shapes are the data-encoding markers on trend lines (Revised solid dot, Actual dots); Proposed is a rotated square. The jump-search menu has an 8px radius and is the one softer form; it is treated as carried inconsistency, not a precedent.

## Components

### Buttons
- **Shape:** 2px radius, 600 weight 14px sans, padding 8px 16px, 40px tall (44px on phones).
- **Outline (default):** transparent, 1px ink border, ink text; hover fills with Hover Wash.
- **Primary:** banknote green fill with white text (dark theme: light green with near-black text); hover brightens 10%.

### Tabs and segmented controls
- **Style:** 40px tall, 1px ink border, buttons separated by 1px ink rules. Selected tab inverts to ink fill with paper text; hover is the green wash.
- **County pages (reviewed 2026-11-22):** the same components with County wording: "Group" and "Department" in place of the City's "Department" and "Bureau", fund names in the Fund list, a status stamp that cites the adopting resolution, and a **Budget and Actual** section made of the ordinary ruled tables (fund totals, then General Fund income by source and spending by function as separate small tables). Audited Actual figures are links like any amount and carry the ≠ mark only where a reviewed known issue says the printed figure is wrong; no variance is drawn. The County adds no color, no card and no new component.
- **Entity switch (City / County):** two square tabs under the site name at the top of the rail, the same 40px (46px on phones) 1px-ink buttons as above, inverted when selected. They are links (`#/` and `#/county/`), not radio buttons, and have no color of their own: the County is told apart by its name, the tagline, the tabs and the running status line, never by a second accent.
- **Section tabs (Compare panel) and Jump links:** underline style: muted text, selected is ink with a 3px green underline.

### Inputs / Fields
- **Style:** 40px, white (dark: raised green-black) field, 1px ink border, 2px radius, 14px sans; selects carry an inline chevron. Labels sit above at 14px 500 muted.
- **Focus:** 2px green outline, 2px offset.

### Lists and tables
- **Rows:** top 1px ink rule, rows separated by 1px hairline, 22px vertical padding; hover washes green; the chevron nudges 3px right.
- **Tables:** 14px, 12px 16px cell padding, 2px ink head rule, sortable heads show an arrow; totals in a 600 footer.
- **Year grids (Staff section):** the same table with 8px horizontal padding and headers stacked year over figure ("2027" / "Revised"), so up to nine year columns fit the column without scrolling. Sub-blocks inside a section use the 16px 700 sans sub-heading (`.wc-h3`), not a second label.
- **Printed and calculated totals:** a total the book prints is shown as printed, with no mark. A total the site adds up itself (no printed total covers exactly those lines) carries a quiet muted sans 14px "calculated" label: "(calculated)" after a figure in a sentence or header, on its own line under the amount in a table cell or bar label, and once in a column head when every figure in the column is calculated. Never colored.
- **Gap flag:** a printed total whose lines add up to something else by more than rounding keeps the printed figure and carries a ledger-red ≠ sign (half size beside the big total), with a muted 14px note, no box, starting with the same ≠: what the book prints, what its lines add up to, the difference, and the reviewed explanation. A page gives each note once, where the figure first appears; later copies carry the sign only. The red never appears without the sign and the words.
- **Department ledger:** a table under a 1px ink rule; the department name is an 18px serif ink link in a flush-left first column, whole rows are clickable with the green wash, the footer total has a 2px ink rule.
- **Category table:** the share column carries an inline square share bar (10px tall, track fill, banknote green bar) beside the percentage, on hairline-ruled rows; the bar is hidden on phones. Amounts are the links to the PDF page: ink, no underline, dotted underline on hover or focus.

### Navigation
- **Rail links:** 15px 600 ink, hairline-divided rows; current page has a 3px green left bar and green text. Beneath it, a 1px hairline-ruled outline: a trail and an "On this page" list in 14px 500 ink; the current page is a green bar with bold text, the section in view is bold and underlined. On narrow screens the same links run as a row with a 3px green bottom bar.
- **Breadcrumbs:** 14px, ink links separated by a chevron, current page in ink 600.
- **Theme toggle:** an outline button with a drawn 18px SVG icon (moon while light, sun while dark) and a Dark/Light word, icon only on phones.

### Funds and terms, and the page running head
- **Running head.** Every page heading is preceded by the entity's name ("City of Lancaster", "County of Lancaster", from config.json `entities.<id>.entity.short`) in 18px Source Serif semibold sentence case, banknote green: a printed book's running head, not a tracked-caps eyebrow chip (the detector rightly calls that an AI-hero signature). The heading is described by it for screen readers. The document title is "{entity} · {page} · Lancaster Budget Explorer" on every route.
- **Funds and terms** (`#/terms`, `#/county/terms`) is the book's key: a Funds section (a ruled table: fund, what pays for it in plain words, what it is; the General Fund is labelled just "General Fund", and the tax link lives in the text; stacked per fund on phones) and a Figure words section (serif term, then its meaning: Actual, Projected, Proposed, Revised, Adopted and Amended, Projection, Income, calculated, and what is not shown). The "What do these mean?" panel under the controls carries the same words (one copy, shared in code) and ends with a link into it, the status stamp is a link to its word, and About points to it.

### Budget calendar timeline (How the City budget is made)
- **Purpose.** `#/budget-calendar` (City only) draws the Home Rule Charter's budget calendar after a printed budget-process chart: a month band, step titles, who does what, wrapped into two rows. No photos or clip art.
- **Structure.** One ordered list in time order (screen readers read it as a list). The band, its month labels, the step markers and the row-end arrowheads are CSS decoration and carry no meaning alone: every step also says its timing in words.
- **Band.** A 2px ink rule. Month labels are small square ink-inverted labels (12px 700 uppercase, paper on ink), shown only when the month changes; a step the charter ties to another step has no month and a hollow square marker instead (filled green when it is a deadline). The budget year's first month carries a thin ring. Wide columns (container 880px and up): horizontal, five steps a row, each row ending in an ink arrowhead. Narrower: the band runs down the left; no sideways scrolling at 375px.
- **Step.** Timing in 14px 600 sans over a hairline; a serif 20px title; who acts as square 1px-ink uppercase tags (Mayor, Council, Public); 15px body with charter citations as muted, dotted-underlined § links.
- **Deadline.** A date the charter sets carries a 3px green rule (`--cal-deadline`), a green-filled "Deadline" label (`--cal-deadline-fg` text) and its section. This is the one use of green as a status rather than the figure being read, always paired with the word. What happens if a deadline is missed is ink text with a bold run-in ("If it is missed:"), not ledger red: a consequence, not a shortfall.
- **Prose sections** under it use the ordinary ruled panels, hairline lists, a ruled two-column example (serif tabular figures) and a serif italic quotation with no box or side stripe.
- **Print.** The page prints in the light tokens without the rail; steps do not split across pages.

### Tax revenue limit flag (Home Rule § 8.08)
- **Over the limit.** A 1px ink rule, then a bold 17px line with a ▲ sign: "Exceeds the 6% tax revenue limit"; under it, 15px ink: "Needs a Council waiver vote, majority of the whole Council plus one (§ 8.08)", the change from the year before and a "How this is worked out" link; a § 13.14 note in 14px muted where it may apply. Ink, not ledger red: a legal threshold passed is not a shortfall, and the word and the sign say it, never color alone. No box, no fill.
- **Within it.** One muted 15px line ("2026 budget: within the 6% tax revenue limit, +5.1% from 2025 Projected"). Calm: no green, no check mark.
- **Where.** Under the What changed tiles (home panel and page), under the total on an earlier year's Income view, and as a ruled table on How the City budget is made (stacked labelled rows on phones). Existing tokens only (`--fg`, `--muted`, `--border`).

### Status stamp and notices
- A 1px ink bordered stamp in uppercase 13px with 0.08em tracking labels the figure status and links to that word on Funds and terms (no underline until hover); it sits directly above the controls on every page (the Reserve Fund and department pages included; no page prints a second stamp in its header). The controls are one component everywhere (`controlsWrap()`), **always open** (owner, 2026-11-27; there is no Change view / Close fold): the stamp, then a `<fieldset>` named "View" holding Budget year, Compare with and Fund (square 1px-ink selects, each with a visible `<label for>` above it in 14px 500 muted Source Sans 3) and the Spending / Income tabs, then the "What do these mean?" toggle (from 1024px it ends the row, level with the selects; narrower it sits under them). Desktop: one row (selects 170–260px wide, the tabs at their natural width).
- **Pinned controls** (owner, 2026-11-27): the whole controls bar is `position: sticky` at the top of the main column on every page that has controls, so the view can be changed from anywhere on the page; it never covers the contents rail. The bar is opaque paper (`--bg`, both themes), and once pinned a 1px ink rule (`--fg`) runs under it, the same hairline that closes a ruled list; no shadow. Its pinned height is measured into `--pin-h` (`pinControls()`), and `html { scroll-padding-top: var(--pin-h) }` keeps "On this page" jumps and keyboard focus below it. Pinned heights: 131px from 1024px (173px with a field note, e.g. a department's Fund note), 173px at 768px. Phones (767px and narrower): a compact form, two controls to a row (Budget year | Compare with, Fund | Spending / Income), 12px labels, 44px targets; the status stamp scrolls away (the bar's `top` is minus the stamp's height) and field notes are kept for screen readers only, so 185px stays pinned at 375 and 320px (28% of a 667px screen; 117px for a one-row page). Printing, the bar is static.
- **"What do these mean?"** is one explainer for the figures and the funds. The toggle is a quiet 14px 600 ink button with the `.org-about` chevron (right when closed, down when open), `aria-expanded` and `aria-controls`. It opens a panel the full width of the bar, laid over the page below (never pushing it), ruled like a section: a 1px ink rule above, the 3px double rule below, paper background, no box or shadow. Inside, two 13px tracked-caps labels, "Figures" and "Funds", each over a grid `repeat(auto-fit, minmax(16rem, 1fr))` of hairline-ruled definitions (three columns at 1440 and 1024px, two at 768px, one on phones). The figure in Budget year carries a 1px-ink "shown" tag, the one in Compare with "comparing", the chosen fund "selected"; those items are bold with a 3px banknote-green left rule, so colour is never the only cue. The panel is capped at 60% of the window and scrolls inside; Escape, the toggle, a click outside or tabbing out close it (Escape returns focus to the toggle). It opens with a 160ms top-down reveal, none under reduced motion. Tab groups come from one helper (`tabField()`), named by their visible label, as radio groups (one Tab stop; arrow keys, Home and End move the choice). A change keeps focus where it was and is announced once in the polite live region `#view-status`. Year-and-figure lists group by year (`<optgroup>`) and name every option in full ("2026 Amended"); the figure already chosen as Budget year stays listed in Compare with, disabled, with the reason in its name. Notices are 1px ink bordered, 2px radius, muted text.

### Charts (Chart.js)
- Colors come from the tokens. Selected is green, comparison ink gray and thinner; Actual is a solid line and Projected dashed; Proposed is a hollow diamond and Revised a solid green dot joined to the last Projected point by a dashed line; the line chart's axis starts above zero and says so beneath the chart; the city's projection years (2028–2029) follow the newest year as a thin ink-gray dotted line with hollow points, continuing from the Revised point, over a quiet shaded band (`--proj-band`) labelled "Projection" at its foot, with muted year labels; in tables they are muted italic rows or columns labelled "Projection". Projections are never green (not the figure being read) and never red (tentative, not a warning), and a short muted note under the chart gives the city's assumptions; bars have 0 radius; diverging change bars are neutral deep ink; tooltips use paper with a hairline. Animation is 300ms and off under reduced motion.

## Do's and Don'ts

### Do:
- **Do** open every section with the 3px double ink rule and a small-caps ink label.
- **Do** pair every red figure with a minus sign and every change with an arrow.
- **Do** reserve green for the figure being read (total, selected bars, selected state).
- **Do** keep comparison figures in ink gray, thinner than the selected green.
- **Do** keep the amount itself as the link to its PDF page, quiet until hovered.
- **Do** keep colors in the `:root` blocks and retune dark tokens whenever a light one changes.
- **Do** respect reduced motion and keep 44px touch targets on phones.

### Don't:
- **Don't** wrap sections, tiles or list rows in boxed, rounded, shadowed cards.
- **Don't** use orange or amber anywhere; keep category colors away from the green and red.
- **Don't** color changes green or red by direction; ink and an arrow carry it.
- **Don't** show "p. N" text next to figures.
- **Don't** show Adopted and Amended for the same year, or draw either on the multi-year charts: the charts keep one kind of figure per year, and the year's budget as passed is one selectable figure, Amended where the books print it, otherwise Adopted (owner, 2026-11-27). County exception: its figures are labelled "Budget", and the newest year's status line may say "adopted Dec 24, 2025 (Resolution 79 of 2025)" because that is the County's own record, not a label on the figures.
