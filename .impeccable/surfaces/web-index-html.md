---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: []
---

# Surface: the whole Lancaster Budget Explorer (web/)

Mode: Read (a taxpayer understands the budget), with Operate controls (year, compare, fund). Scope: every page, one shared system.

## Audience and job
Primary: a Lancaster resident who wants a verdict in the first screen. Secondary: journalists and staff who verify against PDF pages.

## Direction contract

THESIS: The site is the city's budget book, set properly: open ruled sections, running heads and a contents rail, in money colors. It refuses the floating boxed-card dashboard with an orange accent.
OWN-WORLD: Paper (#fcfcfa) and ink (#1a1d1b); banknote green (#1d5a3a) for the selected figure, links, labels and primary controls; ledger red (#a12626) only for shortfalls, with a minus sign or arrow as well; comparison figures in ink gray. No orange. Source Serif 4 for headlines and figures, Source Sans 3 for labels and tables. Sections are separated by a 3px double ink rule, never boxed; controls are square, 1px ink, tabs inverted when selected; lists are hairline-ruled rows.
STORY: A resident reads the headline figure and the plain verdict, sees what changed, and drills down; a journalist follows any figure to its PDF page.
FIRST VIEWPORT: Left contents rail (300px: name, disclaimer, Overview / What changed / Reserve Fund, search, theme, About); main column opens on a 56px serif headline, then the 44px green figure under a small uppercase label (the total as printed, with a ≠ note only when the lines miss it beyond rounding), then the serif deck sentence directly beneath it (the verdict: up or down, by how much, the reserve draw with its dedicated data center part); the one-line controls strip with the status stamp; then What changed with Totals by Year beside it.
FORM: Candidate 1 of my list, The Printed Budget Book, chosen by the user from the decision page (the roll assigned Banknote Engraving). seed:d88b41cc68953178
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decisions
- lacontroller.app look-matching released (owner, 2026-11-20). Page structure and wording kept; light and dark kept.
- Data encodings (solid/dashed lines, dot/ring markers) kept; only colors changed.
