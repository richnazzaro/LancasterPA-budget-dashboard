---
name: Lancaster Budget Explorer
description: The city's budget book, set properly online: open ruled sections, a contents rail, and money colors (paper, ink, banknote green, ledger red).
colors:
  paper: "#fcfcfa"
  ink: "#1a1d1b"
  ink-muted: "#4a524d"
  banknote-green: "#1d5a3a"
  ledger-red: "#a12626"
  ink-gray: "#7d867f"
  hairline: "#d3d8d2"
  track: "#e6e9e4"
  hover-wash: "#eceee9"
  footer-ink: "#14201a"
  cat-ink: "#1a1d1b"
  cat-sage: "#6b7770"
  cat-olive-gold: "#8a7a2c"
  cat-stone: "#b8b09a"
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
  figure:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "72px"
    fontWeight: 700
    lineHeight: 1
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

Density is that of a reference book: hairline-ruled rows, tabular figures, long text capped near 70ch. Voice is plain and sober. The headline figure is the largest thing on the page, then the plain verdict line, then the evidence.

The previous look (blue and amber boxed cards matched to another site) is retired; none of its rules carry over.

**Key Characteristics:**
- Sections are open and separated by a 3px double ink rule, never boxed.
- Controls are square-ish (2px), 1px ink outline; selected tabs invert to ink on paper.
- Lists and tables are hairline-ruled rows with a 1px or 2px ink head rule.
- Serif for headlines and figures, sans for labels, tables and prose; all numerals tabular.
- Light by default, dark follows the device or the header toggle; both are tuned for contrast.

## Colors

A restrained money palette: near-white paper, green-black ink, one green, one red, and gray for comparison.

### Primary
- **Banknote Green** (#1d5a3a; dark theme #7fc99b): the selected figure, the 72px headline figure, links, primary buttons, section labels, the active nav marker, the focus ring. Fill and text versions are the same value here (7.4:1 on paper).

### Secondary
- **Ledger Red** (#a12626; dark #ef7b6f): shortfalls and negative numbers only, always paired with a minus sign or arrow (7.0:1).

### Neutral
- **Paper** (#fcfcfa; dark #101512): page ground and header.
- **Ink** (#1a1d1b; dark #eef1ec): text, rules, control outlines, selected-tab fill.
- **Ink Muted** (#4a524d; dark #a9b4ac): secondary text, notes, comparison labels (7.6:1).
- **Ink Gray** (#7d867f): the comparison figure; differs from green in lightness as well as hue and is drawn thinner (12px track versus 18px) at 65% opacity.
- **Hairline** (#d3d8d2) and **Track** (#e6e9e4): row dividers and empty bar tracks. **Hover Wash** (#eceee9; green at 6% for row hover).
- **Footer Ink** (#14201a): the only dark slab in light theme.
- **Category set**, for pies and legends only: ink, sage (#6b7770), olive gold (#8a7a2c), stone (#b8b09a), steel (#5f7f8f), slate (#4d6b86), umber (#8a5a44), deep ink (#3b4a42). Ink and sage also mark Proposed and Revised on trends.

### Named Rules
**The Money Colors Rule.** Green means the figure being read; red means a shortfall; gray means the thing compared against. Direction of change (more or less spending) is not good or bad, so up and down use ink with an arrow, never green or red.
**The Never-Color-Alone Rule.** Every color distinction also carries a second cue: a sign, an arrow, line dash, ring versus dot marker, or bar thickness.
**The Tokens-In-:root Rule.** All colors live in the `:root` blocks of styles.css (light, dark explicit, dark by device); charts read them from there.

## Typography

**Display Font:** Source Serif 4 (Georgia, Times New Roman, serif)
**Body Font:** Source Sans 3 (system sans fallbacks)

**Character:** A bookish serif carries headlines and every headline number; a clear humanist sans carries labels, tables and prose. Both share one superfamily lineage, so the pairing reads as one printed page.

### Hierarchy
- **Display** (700, 56px, 1.04, -0.01em): page headline. Steps to 44px under 1024px and 32px on phones.
- **Figure** (700, 72px, 1, banknote green): the home headline total. 56px, then 40px on phones. Department pages use a 52px serif name and a 28px total.
- **Title** (600, 22px, 30px): list-row names such as department and bureau.
- **Stat** (700, 30-36px serif): tile and compare values.
- **Body** (400, 16px, 1.5): prose, capped at 70ch.
- **Table** (400, 14px, 20px; 13px on phones): rows, with right-aligned tabular numbers; headers 600 with a 2px ink rule.
- **Label** (600, 14px, 0.16em, uppercase, banknote green): section labels at the head of each ruled section.

### Named Rules
**The Serif Figures Rule.** Headline numbers are serif and bold; table numbers are sans, tabular, right-aligned.
**The Balanced Headline Rule.** Headings wrap balanced, paragraphs wrap pretty, and amounts never split across lines.

## Layout

On wide screens (1100px and up) the masthead becomes a sticky 300px contents rail on the left (name, disclaimer, Overview / What changed / Reserve Fund, search, theme, About) closed by a 3px double ink rule; the main column is at most 1060px with 64px side padding and 48px top. Below 1100px the rail becomes a top bar with the sections as a scrolling row. Breakpoints: 1100, 1023, 767, 420, 339px.

Rhythm: 8px base; 16px gaps; 24px between grid items; 56px between sections (40px on phones). Overview pairs two panels in a two-column grid that collapses to one under 1024px. Department and bureau lists run as hairline rows, two columns from 1024px. Phones reorder so the verdict (What changed) comes first, then controls, then charts. Touch targets are 44px on phones, with invisible hit areas grown around quiet amount links.

## Elevation & Depth

Flat. Depth comes from rules and position, not shadow: a 3px double ink rule opens each section, hairlines divide rows, and the rail is set apart by a vertical double rule. Hover is a pale green wash. The single exception is the jump-search results menu, which floats over content and carries a soft ambient shadow (`0 8px 24px rgba(0,0,0,.18)`).

### Named Rules
**The No-Box Rule.** Sections, lists, tiles and notes are never framed cards with shadow or rounded corners. Group with a rule, not a container.

## Shapes

Square. Panels, rows, bars, tiles and swatches have 0 radius; controls, stamps and notices have a 2px radius with a 1px ink border. Focus is a 2px outline offset 2px. The only round shapes are the data-encoding dot markers on trend lines. The jump-search menu has an 8px radius and is the one softer form; it is treated as carried inconsistency, not a precedent.

## Components

### Buttons
- **Shape:** 2px radius, 600 weight 14px sans, padding 8px 16px, 40px tall (44px on phones).
- **Outline (default):** transparent, 1px ink border, ink text; hover fills with Hover Wash.
- **Primary:** banknote green fill with white text (dark theme: light green with near-black text); hover brightens 10%.

### Tabs and segmented controls
- **Style:** 40px tall, 1px ink border, buttons separated by 1px ink rules. Selected tab inverts to ink fill with paper text; hover is the green wash.
- **Section tabs (Compare panel) and Jump links:** underline style: muted text, selected is ink with a 3px green underline.

### Inputs / Fields
- **Style:** 40px, white (dark: raised green-black) field, 1px ink border, 2px radius, 14px sans; selects carry an inline chevron. Labels sit above at 14px 500 muted.
- **Focus:** 2px green outline, 2px offset.

### Lists and tables
- **Rows:** top 1px ink rule, rows separated by 1px hairline, 22px vertical padding; hover washes green; the chevron nudges 3px right.
- **Tables:** 14px, 12px 16px cell padding, 2px ink head rule, sortable heads show an arrow; totals in a 600 footer. Amounts are the links to the PDF page: ink, no underline, dotted underline on hover or focus.

### Navigation
- **Rail links:** 15px 600 ink, hairline-divided rows; current page has a 3px green left bar and green text. On narrow screens the same links run as a row with a 3px green bottom bar.
- **Breadcrumbs:** 14px, green links separated by a chevron, current page in ink 600.

### Status stamp and notices
- A 1px ink bordered stamp in uppercase 13px with 0.08em tracking labels the figure status. Notices are 1px ink bordered, 2px radius, muted text.

### Charts (Chart.js)
- Colors come from the tokens. Selected is green, comparison ink gray and thinner; Actual is a solid line and Projected dashed; Proposed is a dot and Revised a ring; bars have 0 radius; diverging change bars are neutral deep ink; tooltips use paper with a hairline. Animation is 300ms and off under reduced motion.

## Do's and Don'ts

### Do:
- **Do** open every section with the 3px double ink rule and a green small-caps label.
- **Do** pair every red figure with a minus sign and every change with an arrow.
- **Do** keep comparison figures in ink gray, thinner than the selected green.
- **Do** keep the amount itself as the link to its PDF page, quiet until hovered.
- **Do** keep colors in the `:root` blocks and retune dark tokens whenever a light one changes.
- **Do** respect reduced motion and keep 44px touch targets on phones.

### Don't:
- **Don't** wrap sections, tiles or list rows in boxed, rounded, shadowed cards.
- **Don't** use orange or amber anywhere; keep category colors away from the green and red.
- **Don't** color changes green or red by direction; ink and an arrow carry it.
- **Don't** show "p. N" text next to figures.
- **Don't** show Adopted or Amended figures; one kind of figure per year.
