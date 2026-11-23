# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: static HTML, CSS and vanilla JavaScript in `web/`, Chart.js from a CDN, no build step, no server. Deployed to GitHub Pages at budget.nazwel.net on every push to `main`. A Python 3.12 pipeline (run by hand about once a year) turns the City's and the County's budget PDFs into the CSVs and the `web/data/` JSON the site reads.

## Users

Primary: a Lancaster, PA resident and taxpayer who wants a verdict: is the city asking for more money, where does it go, and what changed. Confirmed by the owner (2026-11-20): taxpayer first.
Secondary, served after the taxpayer: journalists and analysts who need provenance (every number links to its PDF page, anomalies are disclosed, data is downloadable), and council or city staff checking figures.

## Product Purpose

A public budget-transparency dashboard for the City of Lancaster, PA and the County of Lancaster, PA. It turns the City's budget books (2022 to 2027, plus its 2028–2029 projections) and the County's budget books, budget resolutions and audited annual reports (2023 to 2026) into one plain, checkable view: totals by year, what changed in the newest budget, spending by department and bureau down to line items, which funds are tax-funded, and the General Fund's reserve or balance. Success: a resident understands the headline and the changes in the first screen, and anyone can verify any figure against the source PDF.

## Positioning

Independent, source-linked and honest about the source's flaws. Every figure links to its PDF page; the site discloses where the city's own books disagree (40 reviewed source errors in the City's books and 27 in the County's as of 11/2026, two printed 12/31/2025 reserve balances) and shows one kind of figure per year (Actual, Projected, Proposed, Revised) rather than mixing them. Plain-English narration of what changed. A neighboring site could not copy the validation behind it.

## Operating Context

Data comes from the city's budget PDFs, extracted and validated by a pipeline with cross-checks to the printed totals. The County of Lancaster is a second volume of the same site (City and County tabs in the rail): its Budget from the County's own books, with audited Actual only where the annual financial report gives it at the same level. The General Fund is the default view because it is the tax-funded fund; shifts into it are flagged.

## Capabilities and Constraints

- Views: Home (Totals by Year, What changed, departments, funds), department and bureau pages with line items and a Staff section (budgeted positions and salaries by year), What changed, Reserve Fund, Funds and terms, About the data. County: the same pages without Staff; a General Fund Balance page in the Reserve Fund's place (budget-resolution and audited balances side by side, never combined); a Budget and Actual section (audited actuals beside the Budget at fund level); The 2026 Budget in Context; elected-office labels. Every page heading carries the entity's name as a running head.
- One kind of figure per year: historic years Actual, the prior budget year Projected, the new year Proposed and Revised. Adopted and Amended are never shown.
- Links from numbers to PDF pages (`#page=N`) stay, quiet and without "p. N" text.
- County figures are labelled "Budget" (never Adopted or Proposed on screen; the newest year's status line cites Resolution 79 of 2025), and audited figures "Actual". The County has no Staff section; its General Fund Balance page takes the Reserve Fund's place.
- Entity name, title, footer, default fund, fund names and data paths live in the `entities` map of `web/config.json`; all colors live in the `:root` block of `web/styles.css` (charts read them from there). Keep it that way.
- The site must work with no build step on GitHub Pages.
- The lacontroller.app look-matching rule in CLAUDE.md is released for this redesign (owner, 2026-11-20).

## Brand Commitments

- Name: Lancaster Budget Explorer. Header carries the disclaimer "This is an independent project, not associated with the City of Lancaster." (set in `web/config.json`; the County's reads "not associated with the County of Lancaster").
- Binding visual constraints volunteered by the owner for the redesign: the floating-card page treatment reads as AI-generated and is to be replaced; the color theme must be accessible and draw on traditional colors for money. Their specific meaning is to be confirmed in new-work, not assumed here.

## Evidence on Hand

Real City data for 2020 to 2029 (2028–2029 as projections; positions 2022 to 2027) in `web/data/*.json` (budget, changes, staffing, conflicts) and County data for 2023 to 2026 in `web/data/county/` (budget, changes, conflicts, fund_balance_gaap); real PDFs in `web/pdfs/` and `web/pdfs/county/`. No testimonials, press or usage metrics; none should be invented.

## Product Principles

1. The verdict comes first: a taxpayer should know in the first screen whether spending is up or down and why.
2. Every number is checkable: it keeps its link to the source page.
3. Be honest about uncertainty: caveats and known source errors appear where the number is read, not only in About.
4. Compare like with like, and say when a comparison mixes a proposal with an estimate.
5. Plain words over budget jargon.

## Accessibility & Inclusion

WCAG 2.2 AA at minimum: text contrast 4.5:1 (3:1 large) in both light and dark themes, color never the only carrier of meaning, 44px touch targets on phones, keyboard operable, reduced-motion respected. Audience is the general public, so phones and older readers count.
