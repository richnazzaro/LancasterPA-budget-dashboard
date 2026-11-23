# County research (2026-11-20)

Answers to the open questions in `docs/COUNTY_PLAN.md`. Sources are the County's own sites, plus the three books in `Budget PDFs - County/`. Nothing here is guessed; gaps are marked "not found".

URL notes:
- `lancastercountypa.gov` and `co.lancaster.pa.us` are the same site (CivicPlus). Both work.
- The County's index of all budget documents is <https://lancastercountypa.gov/591/Budget-Financial-Information>.

---

## 1. Is the 2026 book the adopted edition?

**Answer: yes for the numbers, no for the edition. The County adopted the 2026 budget on Dec 24, 2025 by Resolution No. 79 of 2025, with the same totals as our book. It published no separate adopted book. The only 2026 book on the County site is the Dec 3 one we already have.**

Evidence:
- **Adoption:** the Commissioners' minutes for Wednesday Dec 24, 2025 record "Resolution No. 79 of 2025: On motion of Commissioner D'Agostino, seconded by Commissioner Parsons; the 2026 County budget is hereby adopted". Roll call: D'Agostino yes, Parsons yes, Yoder no. Passed 2–1.
  - Minutes: <https://www.co.lancaster.pa.us/AgendaCenter/ViewFile/Minutes/_12242025-3512>
  - Agenda: <https://www.co.lancaster.pa.us/AgendaCenter/ViewFile/Agenda/_12242025-3512>
  - The minutes say the proposed budget went on public inspection after the Dec 3 meeting, for adoption on Dec 24.
- **The resolution:** <https://lancastercountypa.gov/DocumentCenter/View/18652/Resolution-No-79-of-2025>. One page. It lists:
  - General Fund receipts of $192,961,058;
  - General Fund operating expenditures of $201,945,900;
  - Other Funds receipts of $137,939,553 and expenditures of $138,025,402;
  - the millage (question 6) and the fund balances (question 3).
- **The book is unchanged.** The County's "Lancaster County Budget Book 2026" (<https://www.lancastercountypa.gov/DocumentCenter/View/18342/Lancaster-County-Budget-Book-2026>) is **byte-identical** to our `County-2026-Budget-Book.pdf` (`cmp` shows no difference; 9,689,000 bytes). The County's listing offers no other 2026 book.
- **Our book's cover letter** (p2) says the budget is "in the form of Resolution #75 of 2025", the proposed form. The adopting resolution is #79. Its totals equal the book's General Fund grand totals (revenue 192,961,058, expense 201,945,900), so the vote left the numbers as presented.
- **A request to change it was not taken up.** The minutes show Commissioner Yoder asked for an extra $1.5M from reserves (for homelessness/Continuum of Care funding) and voted no. The adopted totals equal the proposed ones.
- **Not found:** any amended or mid-year 2026 budget. The County's monthly budget reports (<https://lancastercountypa.gov/QuickLinks.aspx?CID=98>) and later 2026 minutes may show amendments; I did not read them.

One difference to note: the 2026 book has no summary page at the front. The 2025 book has the resolution summary on p3 (fund balance, millage). In the 2026 book, p3 is a divider, so the resolution is the only place for the 2026 fund balance and millage.

---

## 2. Does the County publish actuals?

**Answer: yes. The Controller publishes an ACFR (audited) every year, 1999 through 2025. The 2025 ACFR is already out (audit opinion dated June 29, 2026). Detail is by function and revenue source, not by department or account, so it gives a category-level "Actual" series. It includes a General Fund budget-versus-actual schedule.**

ACFR index (Controller): <https://lancastercountypa.gov/Archive.aspx?AMID=39>. The PDFs, by year:

| Year | URL |
|---|---|
| 2025 | <https://lancastercountypa.gov/Archive.aspx?ADID=3414> |
| 2024 | <https://lancastercountypa.gov/Archive.aspx?ADID=3399> |
| 2023 | <https://lancastercountypa.gov/Archive.aspx?ADID=3395> |
| 2022 | <https://lancastercountypa.gov/Archive.aspx?ADID=3280> |
| 2021 | <https://lancastercountypa.gov/Archive.aspx?ADID=3175> |
| 2020 | <https://lancastercountypa.gov/Archive.aspx?ADID=3031> |

Each link redirects to the PDF. Older years back to 1999 are on the same index (2019 `ADID=2923`, 2018 `2807`, 2017 `1695`, 2016 `1547`, 2015 `1379`). 2023–2025 are text-layer PDFs of 152–154 pages (checked with pdfplumber).

Detail levels (checked in the 2025, 2024 and 2023 ACFRs):
- **General Fund, budget versus actual:** "Schedule of Revenues, Expenditures, and Changes in Fund Balances – Budget and Actual – Budgetary Basis – General Fund" (2025 ACFR p103; PDF page 112). Yes, a Budgetary Comparison Schedule exists. It has columns Original, Final, Actual and Variance.
  - **Revenues by source:** real estate taxes, intergovernmental, departmental, fines and costs, investment earnings, other.
  - **Expenditures by function:** general government, public safety, judicial, corrections, cultural and recreation, capital outlay, debt service (principal, interest). Then transfers out.
  - **Not by department or object.** The functions do not map one-to-one to the books' A/B/C/D departments.
- **The "Original" column is the adopted budget.** For 2025, original revenue is 180,750,776, which equals the 2025 book. Original expenditure is 169,434,290 plus transfers out of 16,723,306, which is 186,157,596. That equals the books' expenditure total, so **the books' "expenditure" includes transfers out** (County Match to other funds).
- **Other funds:** the same schedule for Children & Youth, Behavioral Health/Developmental Services and Domestic Relations (RSI), and for Aging, Drug & Alcohol and Liquid Fuels (combining section). Combining statements cover all nonmajor funds.
- **Ten-year tables** (Statistical Section, Tables 3 and 4, 2025 ACFR p117–118): fund balances and revenues by source and expenditures by function, for all governmental funds.
- **Basis:** the budget schedule is "budgetary basis, substantially cash". It differs from GAAP by accruals. The 2025 notes reconcile: budgetary revenue 204,822,503 to GAAP 197,428,949, and expenditure 187,605,887 to 177,443,236.

Actual General Fund results, budgetary basis (from each year's budget-and-actual schedule):

| Year | Original budget revenue | Actual revenue | Actual expenditure | Transfers out | Net change |
|---|---|---|---|---|---|
| 2023 | 178,585,614 | 205,435,105 | 183,048,550 | n/a here | +3,423,683 |
| 2024 | 182,661,641 | 211,203,955 | 189,237,822 | 18,962,872 | +3,003,261 |
| 2025 | 180,750,776 | 204,822,503 | 187,605,887 | 18,026,639 | −810,023 |

Actuals run well above the original budgets, for two reasons the ACFR gives: grant revenue (ARPA, ERAP, opioid) is added through mid-year resolutions, and actual spending came in below the final budget. A comparison of "budget" with "actual" will therefore show large gaps that are not overspending. The final budget (amended) column is also printed.

Sources: 2025 ACFR p35 (MD&A budget highlights) and p112 (schedule); 2024 ACFR PDF p114; 2023 ACFR PDF p116 or nearby (lines "Total revenues 178,585,614 … 205,435,105").

---

## 3. What covers the General Fund gap?

**Answer: the General Fund's accumulated fund balance. The budget resolution shows it explicitly. The documents do not say which class (unassigned or assigned) is drawn. The ACFR shows most of the balance is unassigned. Actual results in 2023–2025 did not draw it down.**

**The adopted budgets plan to use fund balance** (resolution one-pagers, General Fund column):

| Budget year | Receipts | Expenditures | Fund balance at start | Remaining at end | Planned draw |
|---|---|---|---|---|---|
| 2023 (Res 109 of 2022) | 178,585,614 | 178,358,147 | 61,334,360 (plus 7,948,024 encumbrances) | 61,561,827 | none |
| 2024 (Res 91 of 2023) | 182,661,641 | 182,561,641 | 61,869,512 (plus 6,376,194 encumbrances) | 61,969,512 | none |
| 2025 (Res 83 of 2024) | 180,750,776 | 186,157,596 | 69,155,866 | 63,749,046 | 5,406,820 |
| 2026 (Res 79 of 2025) | 192,961,058 | 201,945,900 | 73,232,203 (estimated 12/31/25) | 64,247,361 | 8,984,842 |

- Res 109 of 2022: <https://lancastercountypa.gov/DocumentCenter/View/14688/Resolution-No-109-of-2022>
- Res 91 of 2023: <https://lancastercountypa.gov/DocumentCenter/View/16142/Resolution-No-91-of-2023>
- Res 83 of 2024: <https://lancastercountypa.gov/DocumentCenter/View/17144/Resolution-No-83-of-2024> (also on p3 of our 2025 book)
- Res 79 of 2025: <https://lancastercountypa.gov/DocumentCenter/View/18652/Resolution-No-79-of-2025>

The deficit the plan computes (revenue minus expenditure: 5.4M in 2025, 9.0M in 2026) is exactly the planned fund balance draw. 2023 and 2024 were budgeted nearly balanced; 2025 and 2026 are the first deliberate draws in this set.

The Res 83 footnote says the 2025 opening balance "includes $550,000 in prior fiscal year cost saving measures." Res 83 labels its opening balance "12/31/24", but 69,155,866 is the ACFR's audited General Fund balance at **12/31/2023**. Treat the resolutions' balances as budget-basis estimates; they do not tie to the ACFR year-ends.

**ACFR General Fund balance** (GAAP, 2025 ACFR Table 3, PDF p127):

| Year-end | Total | Unassigned | Other classes (2025) |
|---|---|---|---|
| 2022 | 66,784,984 | 53,419,626 | |
| 2023 | 69,155,866 | 55,350,379 | |
| 2024 | 74,186,759 | 51,170,696 | |
| 2025 | 77,048,798 | 51,330,147 | restricted 21.0M (health, welfare 8.4M; judicial 1.6M; public safety 7.6M; roads 2.0M; general government 1.8M), assigned 4.3M (future benefits 1.3M, healthcare benefits 2.7M, corrections 0.4M) |

- The 2025 ACFR (MD&A, PDF p24) says: "The County's total General Fund balance increased $2.8 million during 2025 to $77.0 million. … included an unassigned fund balance of $51.3 million."
- **Budgetary-basis (cash) General Fund balance:** 62.9M at 12/31/2023 (2024 ACFR schedule), 73.99M at 12/31/2024, and 63.03M at 12/31/2025 (2025 ACFR p112). The 2025 book's "remaining 12/31/25" of 63.7M is close to the cash figure. The 2026 resolution's estimated 73.2M opening balance is about 10M above the actual 12/31/25 cash balance of 63.0M. The 2025 ACFR attributes about 10.1M of the difference to "due from other funds". The 2026 draw therefore starts from a lower actual balance than the resolution assumed.
- Which class pays: the resolution says only "Estimated Fund Balance". The County's own wording elsewhere is "reserves" (Dec 24 minutes: a speaker I did not identify noted that the County "maintains reserves to address potential uncertainties"). I found no document that names the unassigned balance as the source. Say "fund balance", and show unassigned from the ACFR as context.

**Narrative in our local books:** extracted both with `.venv/bin/python` and pdfplumber and searched for fund balance, reserve, deficit and draw. The 2025 book's only relevant text is the p3 resolution summary above. The 2026 book has **no** such narrative or summary (its p2 cover letter only gives the adoption timetable). The department "Executive Summary" narratives do not mention the gap. The Fiscal Affairs pages and the 2025–2026 Budget Presentations (<https://www.lancastercountypa.gov/DocumentCenter/View/17170/2025-Budget-Presentation>, <https://www.lancastercountypa.gov/DocumentCenter/View/18387/2026-Budget-Presentation>) were not read; I downloaded the 2022–2025 presentations only to check they have text layers. The 2026 presentation is a likely place for narrative.

---

## 4. Older books

**Answer: the County posts a 2023 "Budget Detail & Reports" (text, 99 pages), and for 2022 only "Take Away Reports" (text) plus a presentation. No full "book" exists for either year. The 2024 book on the County site is the same scanned file we have; no text-layer version is posted.**

| Year | Document | URL | Notes |
|---|---|---|---|
| 2023 | 2023 Budget Detail & Reports | <https://www.lancastercountypa.gov/DocumentCenter/View/14689/2023-Budget-Detail--Reports> | 99 pages; 82 have a text layer (a few pages are images). Prints 2023 proposed against 2022 adopted. Includes Res 107 of 2022 (proposed) |
| 2023 | 2023 Budget Presentation | <https://www.lancastercountypa.gov/DocumentCenter/View/14672/2023-Budget-Presentation> | 21 pages, text |
| 2023 | Resolution No. 109 of 2022 (adopted) | <https://lancastercountypa.gov/DocumentCenter/View/14688/Resolution-No-109-of-2022> | |
| 2022 | 2022 General Fund Take Away Reports | <https://www.lancastercountypa.gov/DocumentCenter/View/13458/2022-General-Fund-Take-Away-Reports> | 28 pages, text. "2022/2021 Budgeted Revenues/Expenditures" by department and by account |
| 2022 | 2022 Other Fund Take Away Reports | <https://www.lancastercountypa.gov/DocumentCenter/View/13459/2022-Other-Fund-Take-Away-Reports> | 10 pages, text |
| 2022 | 2022 Budget Presentation | <https://www.lancastercountypa.gov/DocumentCenter/View/13443/2022-Budget-Presentation> | 25 pages, text |
| 2022 | Resolution No. 90 of 2021 (adopted) | <https://www.lancastercountypa.gov/DocumentCenter/View/13457/Resolution-No-90-of-2021> | |

Older sets (2015–2021 take-away reports and resolutions) are on the same index, so back to 2015.

- **2024:** the County's "Lancaster County Budget Book 2024" is <https://www.lancastercountypa.gov/DocumentCenter/View/16123/Lancaster-County-Budget-Book-2024>. Downloaded and compared: **byte-identical** to our `County-2024-Budget-Book.pdf` (70,644,077 bytes, scanned). No second version. The 2024 Budget Presentation (<https://www.lancastercountypa.gov/DocumentCenter/View/16122/2024-Budget-Presentation>) is 24 pages, 22 with text, but is a summary, not line items.
- **Caveat on 2022 and 2023:** the 2022 take-away pages print "2022 budget vs 2021 budget"; the 2023 file prints "2023 proposed vs 2022 adopted". Neither prints actuals. Both use the same A/B/C/D department codes and 4-digit accounts as the books, so a lighter version of the County extractor may work. Not tested.
- The 2023 file is a proposed-edition document. The adopted 2023 totals are in Res 109 of 2022. I did not compare line by line.

---

## 5. Fund letters

**Answer: the County's own index names them, and the books confirm each letter by department.**

Names are from the County's monthly-report links on the Budget & Financial page (<https://lancastercountypa.gov/591/Budget-Financial-Information>). Departments are from the 2026 book's Other Funds pages (PDF p114 on):

| Letter | County's name | Book department with that letter |
|---|---|---|
| A | General Fund | all A/B/C/D departments |
| B | Liquid Fuels Fund | Engineers Office (A1300) |
| E | Drug and Alcohol Fund | Drug & Alcohol (D1700) |
| EI | Early Intervention Fund | Early Intervention (D2100) |
| F | Four-D Fund | Domestic Relations (B1118) |
| G | Office of Aging Fund | Office of Aging (D1600) |
| H | Behavioral Health Fund | Behavioral Health (D1800) |
| R | Developmental Services Fund | Intellectual Disabilities (D1900) |
| Y | Child Welfare Fund | Children & Youth (D1400) |
| T | JTPA Fund | none in the 2025–2026 books |

- "Four-D" is the County's name for the child-support program fund. The ACFR describes the Domestic Relations Fund as enforcing support obligations and establishing paternity (2025 ACFR fund descriptions, PDF p~45), which matches the Domestic Relations department. The link between "Four-D" and the Title IV-D program is my reading; the County does not say so on the page.
- The ACFR names the funds differently (it merges R with Behavioral Health into "Behavioral Health and Developmental Services Fund"). In the ACFR, major funds are General, Children and Youth Services, Behavioral Health and Developmental Services, Domestic Relations and the Capital Projects fund. Nonmajor funds are Aging, Drug & Alcohol, Liquid Fuels, HSDF, CDBG and Ag Land Preservation. The ACFR has no "Early Intervention" fund line that I found, so how EI rolls up in the ACFR is not confirmed.
- Not found: a County page that explains the letters as a list. The names above come from link titles on the index page.

---

## 6. Millage

**Answer:**

| Year | Real estate millage | Source |
|---|---|---|
| 2023 | 2.911 | Res 109 of 2022: <https://lancastercountypa.gov/DocumentCenter/View/14688/Resolution-No-109-of-2022> ("TAX INCREASE OVER 2022 = 0%"; taxable assessed value $44,031,995,700) |
| 2024 | 2.911 | Res 91 of 2023: <https://lancastercountypa.gov/DocumentCenter/View/16142/Resolution-No-91-of-2023> (0% increase; $44,508,664,500) |
| 2025 | 2.911 | Res 83 of 2024: <https://lancastercountypa.gov/DocumentCenter/View/17144/Resolution-No-83-of-2024> (0% increase; $44,887,823,600). Confirmed by the 2025 ACFR MD&A: "The County's 2025 real estate property tax millage rate remained unchanged at 2.911." |
| 2026 | 3.201 | Res 79 of 2025: <https://lancastercountypa.gov/DocumentCenter/View/18652/Resolution-No-79-of-2025> ("TAX INCREASE OVER 2025 = 10%"; $45,286,188,100) |

- The 2026 increase is 0.290 mills, about 10%. It raises budgeted real estate tax receipts from $128.3M (2025) to $142.8M (2026), +$14.5M. Our 2026 book shows the same figure as department A1700 Tax Collectors: $128,305,084 to $142,786,672.
- Commissioner Parsons' statement in the Dec 24 minutes says the County had held the line on taxes since 2013.

---

## What would change in `docs/COUNTY_PLAN.md`

1. **Open question 1 (adopted or proposed): settled.** The 2026 book needs no swap. Note in the plan that it was adopted Dec 24, 2025 by Res 79 of 2025 (2–1), with unchanged totals. The site can label 2026 "Adopted", and 2025 and 2024 are adopted too (Res 83 of 2024, Res 91 of 2023). The County's books are all adopted budgets, so the city's "Proposed/Revised" labels do not apply. Cite the resolution for each year.
2. **Open question 2 (actuals): yes, from the ACFRs.** Add an optional "Actual" phase. It would be General Fund only, in the ACFR's categories (revenue by source, expenditure by function), budgetary basis, 2020–2025, with each ACFR's own budget-versus-actual schedule as the source. It cannot be tied to department or account lines. Because actuals run above budgets (grants added mid-year), do not draw a variance chart from it without the Final column.
3. **Open question 3 (the gap): answered.** The Overview can say "draws $X from fund balance" using Res 79 (2026: 8.98M, from 73.2M to 64.2M) and Res 83 (2025: 5.41M). Add a fund-balance series from the resolutions (budget estimates) and, separately, the ACFR year-end balances and the unassigned portion. Disclose that the resolution's opening balance (73.2M) is above the actual 12/31/25 cash balance (63.0M). The plan's statement that "the books do not say where the money comes from" should say that the resolution one-pager does; the 2026 book itself does not.
4. **Phase 1 step 1: add the resolution one-pagers** (2023–2026) as a small extraction, `fund_balance_county_*.csv`. This replaces the planned "no General Fund balance page" note. They also give millage and taxable assessed value, so the plan can show millage as a headline figure.
5. **Open question 4 (2023 column from the 2024 book):** still yes. There are two further ways to get 2023 and 2022: the County's text-layer "2023 Budget Detail & Reports" (proposed 2023 vs adopted 2022) and the 2022 take-away reports (2022 vs 2021 budget). A text-layer 2023 file may avoid some OCR risk, but it is a proposed edition; the adopted figures are in Res 109 of 2022. Use it as a cross-check for the OCR of the 2024 book's 2023 column.
6. **Fund letters:** replace "Fund B", "Fund E", … with the names in section 5 (B Liquid Fuels, E Drug and Alcohol, EI Early Intervention, F Four-D (Domestic Relations), G Aging, H Behavioral Health, R Developmental Services (Intellectual Disabilities), Y Child Welfare (Children & Youth)). Record the source (the County's index page and the book's department labels). Flag F's "Four-D" meaning and EI's ACFR roll-up as unconfirmed.
7. **Expenditure definition:** the County's expenditure total includes transfers out (County Match), as the ACFR's original-budget column shows (169.4M plus 16.7M for 2025). Say so on the site when comparing with ACFR actuals, which report operating expenditure and transfers separately.
8. **2024 text layer:** none exists. OCR of the 2024 book stays in the plan.
9. **Not checked, for a later pass:** the 2026 Budget Presentation and Fiscal Affairs pages (possible narrative on the draw); later 2026 amendments; ACFR 2020–2022 General Fund actuals in detail.

---

# ACFR actuals: import spec

Scope: the 2023, 2024 and 2025 ACFRs (downloaded to a scratchpad, not the repo; text extracted with pdfplumber). 2026 has no ACFR, so it stays budget-only. All page numbers below are **PDF page numbers** (the printed page number is 9–10 lower). Source files:
- 2025 ACFR: <https://lancastercountypa.gov/Archive.aspx?ADID=3414> (152 pages)
- 2024 ACFR: <https://lancastercountypa.gov/Archive.aspx?ADID=3399> (153 pages)
- 2023 ACFR: <https://lancastercountypa.gov/Archive.aspx?ADID=3395> (154 pages)

## 1. Coverage and text layer

| ACFR | Covers | Audit opinion date | Text layer |
|---|---|---|---|
| 2025 | year ended 12/31/2025 (single year; no prior-year columns in the fund schedules) | June 29, 2026 | full, clean. Split-digit amounts: about 1 in the whole file |
| 2024 | year ended 12/31/2024 | transmittal dated June 30, 2025 | full, but ~50 amounts have a stray space (`$ 4 5,070,335`, `( 18,962,872)`, `1 89,000`) and ~90 more in 7-digit amounts |
| 2023 | year ended 12/31/2023 | not read | full, with ~90 stray-space amounts and ~180 in 7-digit amounts (`3 ,398,006`, `2 ,316,146`) |

- Each ACFR is one year. The only multi-year view is the ten-year Statistical Section (Table 3 fund balances and Table 4 changes in fund balances, all governmental funds): 2025 PDF p127–128, 2024 p129–130, 2023 p131–132.
- The same split-digit rule as the books applies: rebuild amounts by character position, not by splitting on spaces. `county_rows.py` already does this for the books and should be reusable. The 2025 ACFR needs almost none of it.
- The 2022 ACFR (`ADID=3280`, 11.8 MB) is not needed: no budget year of ours is 2022. I did not extract it.

## 2. Schedules that give actuals

All three ACFRs have the same set, in the same order. Row labels are stable across the three years (only differences: "Public Safety" capitalised in 2023/2024; a few reconciliation rows below the net-change line vary).

PDF pages:

| Schedule | 2025 | 2024 | 2023 |
|---|---|---|---|
| MD&A, "General Fund budgetary highlights" (narrative) | 35 | 35 | 35 |
| Governmental funds statement of revenues, expenditures and changes in fund balances (GAAP) | 43 | 43 | 43 |
| Budget vs actual, **General Fund** | 112 | 114 | 116 |
| Budget vs actual, Children and Youth Services Fund | 113 | 115 | 117 |
| Budget vs actual, Behavioral Health and Developmental Services Fund | 114 | 116 | 118 |
| Budget vs actual, Domestic Relations Fund | 115 | 117 | 119 |
| Combining statement of revenues/expenditures, nonmajor funds (GAAP) | 119 | 121 | 123 |
| Budget vs actual, Office of Aging | 120 | 122 | 124 |
| Budget vs actual, Drug and Alcohol | 121 | 123 | 125 |
| Budget vs actual, Liquid Fuels | 122 | 124 | 126 |
| Notes to RSI: budget-to-GAAP reconciliation (General Fund revenue and expenditure) | ~116 | not checked | not checked |

**A. Budget-vs-actual schedules (budgetary basis, "substantially cash").** Every schedule has four numeric columns: **Original, Final, Actual, Variance with Final Budget (positive/negative)**. Rows:

- **General Fund** (revenue by source, spending by function):
  - Revenues: Real estate taxes; Intergovernmental; Departmental; Fines and costs; Investment earnings; Other; **Total revenues**.
  - Expenditures, "Current:": General government; Public safety; Judicial; Corrections; Cultural and recreation; Capital outlay; "Debt service:" Principal retirement, Interest and fiscal charges; **Total expenditures**.
  - **Excess (deficiency)** of revenues over expenditures; Transfers out; **Net change in fund balances**.
  - Below the line (actual column only): Net increase/decrease in due from other funds; Fund balance January 1 and December 31, cash basis; then reconciling items (taxes, fines and costs, accounts, due from other funds/governments, accounts payable, deferred inflows, payroll accruals) to the **modified-accrual fund balance** (the GAAP year-end balance, e.g. 77,048,798 for 2025).
  - There is no sub-function level (no department, no object).
- **Children and Youth Services:** Intergovernmental; Departmental; Total revenues; Children and youth; Capital outlay; Total expenditures; Excess; Transfers in; Net change.
- **Behavioral Health and Developmental Services:** Intergovernmental; Departmental; Total revenues; Behavioral Health & Developmental Services; Capital outlay; Principal retirement; Interest and fiscal charges; Total expenditures; Excess; Transfers in; Net change. (2023/2024 have no debt rows if they print none; not checked row by row.)
- **Domestic Relations:** Intergovernmental; Departmental; Investment earnings; Total revenues; Judicial; Capital outlay; Total expenditures; Excess; Transfers in; Net change.
- **Office of Aging:** Intergovernmental; Departmental; Other; Total revenues; Office of Aging; Capital outlay; Total expenditures; Excess; Transfers in; Net change.
- **Drug and Alcohol:** Intergovernmental; Departmental; Investment earnings; Other; Total revenues; Drug and alcohol; Total expenditures; Excess; Transfers in; Net change.
- **Liquid Fuels:** Intergovernmental; Investment earnings; Other; Total revenues; Roads and bridges; Capital outlay; Total expenditures; Excess; Net change. (2023 also has a Transfers in line.)

**B. Governmental funds statement (GAAP, modified accrual), PDF p43 in all three.** One column per fund: General, Children and Youth Services, Behavioral Health and Developmental Services, Domestic Relations, Capital Projects, Block Grant, Nonmajor governmental funds, Total. **No budget columns.** Rows: revenues by source (real estate taxes, intergovernmental, departmental, fines and costs, investment earnings, other, Health Choices revenues); expenditures by function with sub-functions under "Health, education, and welfare" (Drug and alcohol; Behavioral health and developmental services; Office of aging; Children and youth; Other); Judicial; Corrections; Cultural and recreation; Community development; Capital outlay; debt service; transfers in and out; leases; net change; fund balances January 1 and December 31.

**Budgetary basis versus GAAP:** the two differ, and the County reconciles them in the Notes to RSI (2025 PDF p116):

| 2025 General Fund | Budgetary (schedule) | GAAP (statement) |
|---|---|---|
| Revenue | 204,822,503 | 197,428,949 |
| Expenditure | 187,605,887 | 177,443,236 |
| Transfers out | 18,026,639 | 18,026,639 |

Use the budgetary basis for "Actual" next to budgets, since the budget schedules use it and the budgets are cash-like. Show GAAP only if the site wants a "fund balance" series. Never mix the two in one row.

**Special fund actuals are not always one-to-one with revenue.** Several funds record "Transfers in" (County match from the General Fund) as other financing sources; the books fold these into revenue (see section 4).

## 3. Fund mapping

| Our fund | ACFR fund | Own actuals? | Evidence |
|---|---|---|---|
| General Fund (A) | General Fund | **Yes**, revenue by source and spending by function | Section 4 |
| B Liquid Fuels | Liquid Fuels Special Revenue Fund (nonmajor) | **Yes**, its own budget-vs-actual schedule | 2025 original expenditure 3,024,952 = book B 3,024,952; original revenue 1,833,000 = book 1,833,000 |
| E Drug & Alcohol | Drug and Alcohol Special Revenue Fund (nonmajor) | **Yes**, own schedule | 2025 original expenditure 8,083,597 = book E 8,083,596; revenue plus transfers in 7,894,597 + 189,000 = 8,083,597 |
| F Domestic Relations | Domestic Relations Special Revenue Fund (major) | **Yes** | 2025 original expenditure 9,096,614 = book F 9,096,612; revenue plus transfers in 6,835,991 + 2,260,623 = 9,096,614 |
| G Aging | Office of Aging Special Revenue Fund (nonmajor) | **Yes**, own schedule | 2025 original expenditure 13,298,097 = book G 13,298,097; revenue 13,298,097 |
| H Behavioral Health, R Developmental Services (Intellectual Disabilities), EI Early Intervention | **one fund:** Behavioral Health and Developmental Services Fund (major) | **Combined only.** No separate H, R or EI actuals | 2025 original expenditure 42,023,515 = book H 24,576,950 + R 9,033,603 + EI 8,412,963 = 42,023,516. 2024: 36,750,958 vs 36,737,540 (gap 13,418 = the ACFR's printed original net change of (13,419)) |
| Y Children & Youth | Children and Youth Services Fund (major) | **Yes**, but see the flags below | Book Y includes Children & Youth, Youth Intervention Center and State Institutions departments. 2024 original expenditure 53,335,444 vs book Y 53,138,716 |

Findings that matter:
- **The books' revenue for every special fund equals the ACFR's revenue plus transfers in.** Example, 2025 Domestic Relations: 6,835,991 + 2,260,623 = 9,096,614. So the books' "revenue" for a special fund includes County match. For an honest "Actual", show revenue and transfers in separately (as the ACFR does) or label the books' figure "revenue and transfers in".
- **Aging (G) and Drug & Alcohol (E), and Liquid Fuels (B), each have their own schedule**, so those three letters get their own actuals. Their combining statement on p119/121/123 is the GAAP view.
- **H, R and EI cannot be separated.** The only separate line anywhere in the ACFR is "Behavioral Health & Developmental Services". Show actuals for the combined H + R + EI fund and say so.
- **Two funds in the ACFR have no letter in the books:** Capital Projects and the Block Grant fund (HSDF), plus nonmajor Agricultural Land Preservation and Community Development. They have no budget books lines and are out of scope.
- **Children and Youth, 2025 flag:** the ACFR's 2025 "original" expenditure is 53,335,444, **the same total as the 2024 original** (and the 2025 original equals the final). The book's 2025 Y total is 57,657,397. The ACFR's 2025 original revenue plus transfers (44,816,706 + 12,840,687 = 57,657,393) does equal the book. The expenditure side looks carried forward from 2024 in the ACFR. Do not show the CYS "original" budget from the ACFR; use the book's budget and the ACFR's Actual only.

## 4. Tie-out: the ACFR's "Original" column against the books

**General Fund revenue ties exactly in all three years.**

| Year | ACFR original revenue | Books/resolution revenue | Source of ours |
|---|---|---|---|
| 2023 | 178,585,614 | 178,585,614 | Res 109 of 2022 (the 2024 book's 2023 column is not extracted yet) |
| 2024 | 182,661,641 | 182,661,643 | 2025 book, 2024 column (Res 91 of 2023: 182,661,641) |
| 2025 | 180,750,776 | 180,750,776 | 2025 and 2026 books |

**General Fund expenditure ties for 2025 only, and only after adding transfers.**

| Year | ACFR original: current + capital + debt | + transfers out (county match) | ACFR total | Books/resolution expenditure | Gap |
|---|---|---|---|---|---|
| 2025 | 169,434,290 | 16,723,306 | **186,157,596** | 186,157,601 (2026 book), 186,157,603 (2025 book); Res 83: 186,157,596 | **0** (rounding) |
| 2024 | 185,071,157 | 13,794,916 | 198,866,073 | 182,561,646; Res 91: 182,561,641 | **16,304,432** |
| 2023 | 172,362,634 | 13,758,442 | 186,121,076 | Res 109: 178,358,147 | **7,762,929** |

What does and does not explain the gaps:
- **2025:** ties line by line. Book account 7965 "Transfers To Other Funds" = 16,723,306 = ACFR transfers out; 7953 Bond Redemption 10,100,000 = ACFR principal; 7951 Interest Expense 5,530,570 = ACFR interest. The 2025 operating total less those = 153,803,720 on both sides.
- **2024:** the same three accounts tie exactly (7965 13,794,916; 7953 14,145,000; 7951 5,357,776). The whole gap is in current spending: the ACFR's original has capital outlay of 7,989,713, the book 572,010. The County's explanation in the MD&A is only that the original budget was later increased for ARPA and ERAP; it does not say what is in the "original" figure. **Cause not found.** The ACFR's original 2024 net change is −16,204,432; the adopted resolution is +100,000. Possible partial cause: 6,376,194 of 2023 encumbrances carried into 2024 (Res 91). That leaves about 9.9M unexplained. This is a guess; the ACFR does not say.
- **2023:** county match ties (13,758,442). The 7.76M gap is close to the 7,948,024 of 2022 encumbrances in Res 109 (185,095 apart), but again not stated in the ACFR.
- **Interest and principal in 2023:** ACFR 21,700,878 vs Res 109 debt service 21,423,128 (277,750 apart). Not explained.
- **Revenue includes ARPA/ERAP/opioid mid-year additions only in the Final column**, so the Original column is the right one to compare with adopted budgets.

**Special funds** (original revenue + transfers in against the books' revenue, and original expenditure against the books' expenditure):

| Fund | Year | Revenue + transfers: ACFR vs book | Expenditure: ACFR vs book |
|---|---|---|---|
| B | 2025 / 2024 | 1,833,000 vs 1,833,000 / 1,892,375 vs 1,892,375 | 3,024,952 vs 3,024,952 / 3,435,236 vs 3,374,120 |
| E | 2025 / 2024 | 8,083,597 vs 8,083,597 / 7,898,307 vs 7,898,307 | 8,083,597 vs 8,083,596 / 7,899,400 vs 7,898,307 |
| F | 2025 / 2024 | 9,096,614 vs 9,096,614 / 7,578,231 vs 7,578,231 | 9,096,614 vs 9,096,612 / 7,674,434 vs 7,578,230 |
| G | 2025 / 2024 | 13,298,097 vs 13,298,097 / 14,804,818 vs 14,804,818 | 13,298,097 vs 13,298,097 / 14,816,261 vs 14,804,818 |
| H+R+EI | 2025 / 2024 | 42,023,515 vs 42,023,516 / 36,737,539 vs 36,737,540 | 42,023,515 vs 42,023,516 / 36,750,958 vs 36,737,540 |
| Y | 2025 / 2024 | 57,657,393 vs 57,657,393 / 53,138,719 vs 53,138,716 | **53,335,444 vs 57,657,397** / 53,335,444 vs 53,138,716 |

Revenue ties to the dollar everywhere; the expenditure differences are small planned-deficit amounts in 2024 (the ACFR prints the original net change, e.g. 13,419 for BH) and the Y 2025 flag above. 2023: the sum of the six special-fund original revenue and transfers in (109,604,947) equals Res 109's Other Funds receipts (109,604,948). The 2023 book column is not available to compare line by line.

**Conclusion on honesty:** budgets and actuals can sit side by side for the General Fund **revenue** in all three years, and for **expenditure** in 2025 exactly. For 2024 and 2023 the ACFR's "original" expenditure is not the adopted figure, so show budget (from the book/resolution) and actual (from the ACFR) and **do not show the ACFR's original or a variance computed from it**.

**Data flags to carry into known issues:**
1. **2024 ACFR p114: Transfers out actual is (18,962,872), identical to the dollar to the 2023 figure** (2023 ACFR p116). The 2024 GAAP statement (p43) shows transfers out of (21,630,095) for the General Fund. The schedule's net change (+3,003,261) is arithmetically consistent with the 18.96M. Unverified. Prefer to flag, and prefer the p43 figure for transfers if the site shows them.
2. **CYS 2025 original expenditure** equals the 2024 figure (above).
3. Special-fund 2024 reconciliation rows differ in labels ("Retainage payable") and are not needed.

## 5. Department mapping

**There is no printed crosswalk.** Neither the ACFR (Tables 15 and 16 give employees and operating indicators by function, with no department list) nor the books map departments to functions. A department-level mapping needs judgement, and the totals show it cannot be exact.

What can be proven for 2025 (General Fund, original budget, ACFR function against the sum of book departments):

| ACFR function | ACFR original | Proposed book departments | Book sum | Gap | Confidence |
|---|---|---|---|---|---|
| General government | 32,567,293 | all remaining A-departments: A1111 to A1700, A2600, A2800, A3100 (A1114 less debt and transfers) | 32,448,737 | +118,556 | residual; moderate |
| Public safety | 13,898,917 | A2410 Department of Public Safety | 13,609,636 | +289,281 | likely |
| Judicial | 59,624,415 | all B-departments plus A2311 Public Defender | 61,864,265 | −2,239,850 | **uncertain** |
| Corrections | 44,127,773 | C1200 Prison | 42,300,186 | +1,827,587 | **uncertain** |
| Cultural and recreation | 3,585,322 | A1100 Line-Item Grants, A1150 Commissioner Grants, A2700 Ag Preserve | 3,580,901 | +4,421 | likely (nearly exact), but a coincidence is possible |
| Capital outlay | 0 (original) | none in the 2025 book | 0 | 0 | |
| Debt service | 15,630,570 | A1114 accounts 7953 and 7951 | 15,630,570 | 0 | **exact**, by account |
| Transfers out | 16,723,306 | A1114 account 7965 | 16,723,306 | 0 | **exact**, by account |

- The five operating-function gaps add up to about zero (the total ties to 153,803,720), so money has been moved between functions, not lost.
- The ±1.8M and ±2.2M gaps mean at least one B- or A-department sits in a different function than my guess. **A plausible candidate** is B1122 APPS Special Supervision (1,743,182): moving it from Judicial to Corrections leaves gaps of +84,405 (Corrections) and +496,732 (Judicial). That is a guess; no document says so. Other departments I am unsure about: B1120 APPS Supervision Services (12.3M), B1121 Juvenile Probation (5.6M), B1711 Sheriff (7.3M), B1811 Coroner (2.1M), A2311 Public Defender (3.7M), A1220 Voter Registration, A3100 Facilities Management.
- **2024 is worse:** the book has A2410 = 0 in 2024 (the Department of Public Safety is not in the 2024 column), so public safety lived under other department codes. A 2025 mapping cannot be applied to 2024 without moving departments.
- **Order of the departments changes between years**, and the 2026 book merges some, so a mapping must be keyed by (year, department code).

**Special funds** map cleanly by fund, not by department: each fund's departments are (almost) one function ("Health, education, and welfare" for CYS, BH&DS, Aging and Drug & Alcohol; "Judicial" for Domestic Relations; "Roads and bridges" for Liquid Fuels). The exception is Y, which includes the Youth Intervention Center and State Institutions departments (the ACFR carries all of fund Y under "Children and youth").

## 6. Recommendation

**Yes, an honest "Actual" series exists, at three levels:**

1. **Fund totals, 2023–2025 (strongest).** For the General Fund and for B, E, F, G, Y, and the combined H+R+EI: total revenue, transfers in, total expenditure, net change, from the budget-vs-actual schedules (budgetary basis). Revenue ties to the budgets to the dollar. This is the level to import first.
2. **General Fund revenue by source** (taxes, intergovernmental, departmental, fines and costs, investment earnings, other). It can sit beside the books' revenue categories only approximately: the books' category names (Taxes, Intergovernmental, Charges for Services, and so on) do not match the ACFR's sources one-to-one. Map at the broad level and label it "by source".
3. **General Fund spending by function.** Show it as its own function table, **not** as department lines. A department-to-function mapping exists only as a labelled approximation (section 5).

**Import spec:**
- File: `data/processed/county/actuals_acfr_<year>.csv`. Columns: `fiscal_year, doc_type=actual, fund, section (revenue|expenditure|transfer|net_change), line (as printed), basis=budgetary, original, final, actual, variance, source_doc, source_page`.
- Keep Original and Final even though the site shows only Actual, to carry the checks.
- Checks: each schedule's lines sum to its printed totals; Total revenues, Excess and Net change foot; the printed variance equals Final minus Actual; General Fund original revenue equals the book; 2025 original expenditure equals the book after transfers. Known failures go in `data/county/known_issues.csv` (2024 transfers out; CYS 2025 original; 2023/2024 original expenditure gaps).
- Parse the 2023/2024 split digits by character position.
- GAAP fund balance (p127 table) is a separate small file; do not mix it into the budgetary rows.

**What the site should say:**
- "Actual figures come from the County's audited Annual Comprehensive Financial Report. They are reported by fund, revenue source and function, not by department or account line, so they appear next to budget totals and not next to line items."
- "Actuals are on the County's budgetary (cash-like) basis, and include grant revenue and spending added after the budget was adopted (ARPA, ERAP, opioid funds). Actual revenue ran 10–15% above the adopted budget in 2023–2025, largely for that reason. Compare actual with the final budget in the ACFR, not only with the adopted budget." (Facts: 2025 actual revenue 204.8M against 180.8M adopted; 2024 211.2M against 182.7M; 2023 205.4M against 178.6M.)
- "Behavioral Health, Developmental Services (Intellectual Disabilities) and Early Intervention are reported together."
- "2026 has no actuals yet: the 2026 ACFR will be published around mid-2027."
- Treat the County's own budget figures (adopted books and resolutions) as the budget and the ACFR as the actual; never derive a budget from the ACFR's Original column for 2023 or 2024.

**Changes to `docs/COUNTY_PLAN.md` from this spec:**
1. Add an "Actuals" phase using the schedules above; first deliverable is fund-level totals for 2023–2025.
2. Remove any plan to chart actual against budget by department.
3. Add the flags in section 4 to `data/county/known_issues.csv` and to the About panel.
4. Combine H, R and EI in any actuals view; keep B, E, F, G, Y separate.
5. Do the 2023 tie-out again once the 2024 book's OCR gives the 2023 column.
