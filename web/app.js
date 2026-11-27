/* Budget Explorer: plain JS, no build step. Entity name, title and data paths come from config.json;
 * brand and chart colors (light and dark) come from the CSS variables in styles.css. Data: <paths.data>budget.json (scripts/build_dataset.py).
 * Routes (hash-based, so GitHub Pages needs no server rules):
 *   #/                                        all departments
 *   #/department/<dept>                       one department
 *   #/department/<dept>/bureau/<unit>         one bureau (org-chart unit)
 *   #/changes                                 what changed in the newest year (changes.json, scripts/changes.py)
 *   #/terms                                   funds and terms: which funds are tax-funded, what each figure word means
 *   #/budget-calendar                         how the City budget is made: the Home Rule Charter's budget calendar (City only)
 * Departments and bureaus follow the city's 2027 org chart (budget.json `org` block, built by
 * scripts/org_structure.py): every line's org code maps to one unit, and each unit to one department.
 * Older bureau links (#/department/<dept>/bureau/<fund--printed group>) redirect to the unit.
 * Shared query: y=year m=measure c=compare k=revenue f=fund. The Budget year select sets y and m together (e.g.
 * y=2026&m=amended); Compare with sets c (<year>-<measure>, e.g. c=2026-projected, or c=none). Addresses made before the
 * selects (…?y=2027&m=proposed&c=2026-projected) use the same parameters, so they still open the same view.
 * Projections (budget.json `projection`, the city's multi-year projections book): years after the newest year, drawn
 * at the end of the multi-year charts and tables as "Projection". They are not in D.series, so they are never a
 * selectable year and never reach the headline, deck or What changed; series(k) and rows(k) still read them.
 */
(() => {
  'use strict';

  const LABEL = { proposed: 'Proposed', revised: 'Revised', projected: 'Projected', actual: 'Actual', budget: 'Budget', projection: 'Projection', adopted: 'Adopted', amended: 'Amended' };
  // The one kind of figure per year that the multi-year charts and tables draw (and the default figure of a year).
  const ORDER = ['actual', 'projected', 'budget', 'proposed', 'revised'];
  // Every figure a year can be picked as in Budget year / Compare with, newest first within a year. A year's budget as
  // passed (budget.json: Amended where the next book prints it, else Adopted; never both) is selectable but never charted.
  const PICK_ORDER = ['revised', 'proposed', 'actual', 'projected', 'budget', 'amended', 'adopted'];
  const STATUS = {
    proposed: 'Proposed, not adopted', revised: 'Revised proposal, not adopted',
    projected: 'Projected year-end estimate', actual: 'Actual spending', budget: 'Budget',
    adopted: 'Adopted budget', amended: 'Amended budget',
  };
  const CAT_ORDER = ['Salaries & Wages', 'Benefits', 'Operating', 'Equipment & Capital', 'Debt, Transfers & Allocations', 'Revenue', 'Uncoded'];
  // Colors are read from CSS variables at start-up (see loadTokens), so branding lives in styles.css.
  let PALETTE = [], OTHER_COLOR = '#777', SEL = '#41ffca', CMP = '#ffca41', INK = '#fff', MUTED = '#b3b3b3', GRID = '#262626', SURFACE = '#0d0d0d', BG = '#000', TRACK = '#222';
  let CFG = null, DEFAULT_FUND = '', BASE = null, ENT = 'city', SITE = '', GB = null; // BASE: config.json; CFG: BASE plus the chosen entity; GB: County audited fund balances
  function loadTokens() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--cat-${i}`, '#888'));
    OTHER_COLOR = v('--cat-other', OTHER_COLOR); SEL = v('--sel', SEL); CMP = v('--cmp', CMP);
    INK = v('--fg', INK); MUTED = v('--muted', MUTED); GRID = v('--border', GRID); SURFACE = v('--card', SURFACE); BG = v('--bg', BG);
    TRACK = v('--proj-band', TRACK);
  }
  const PAGE_SIZE = 20; // line-item rows shown at a time (keeps department pages short)
  const PIE_SLICES = 7;

  let D = null, O = null; // O = D.org (departments, units, org code -> unit)
  let rowCache = new Map(), memberCache = new Map();
  const isCounty = () => ENT === 'county';
  /* Every route lives under #/ (City) or #/county/ (County); a plain #/ link is the City, so old links keep working. */
  const eh = (path = '') => `#/${isCounty() ? 'county/' : ''}${path}`;
  const fundNames = () => (CFG && CFG.fund_names) || {};
  const fn = (f) => fundNames()[f] || f; // a fund as shown (the County's fund letters have names)
  let charts = [], histChart = null; // histChart: the one open line-item history chart (see lineHistory), kept apart from the page's charts
  function closeHist() { if (histChart) { histChart.destroy(); histChart = null; } }
  const S = { y: 0, m: '', c: '', k: 'expense', f: '' };
  let route = { name: 'home' };
  let aboutOpen = false; // "What does this … do?" stays open when the page re-renders (theme, filters)
  const T = { sort: 'sel', dir: -1, q: '', shown: PAGE_SIZE };

  const $ = (id) => document.getElementById(id);
  /* The document title always names the entity first, so a tab or a search result says City or County. */
  const pageTitle = (t) => `${CFG.entity.short} · ${t} · ${SITE}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const MINUS = '\u2212'; // one minus sign everywhere (not the hyphen)
  const money = (n) => (Math.round(n) < 0 ? `${MINUS}$` : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const fmtPct = (p, signed = false) => `${p < 0 ? MINUS : signed && p > 0 ? '+' : ''}${Math.abs(p).toFixed(1)}%`;
  const short = (n) => {
    const a = Math.abs(n), sg = n < 0 ? MINUS : '';
    return a >= 1e9 ? `${sg}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(0)}M` : a >= 1e3 ? `${sg}$${(a / 1e3).toFixed(0)}K` : `${sg}$${a}`;
  };
  const pctOf = (a, b) => (b ? (a / Math.abs(b)) * 100 : null);
  const slug = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const key = (y, m) => `${y}|${m}`;
  const parseKey = (k) => { const [y, m] = k.split('|'); return { y: +y, m }; };
  const series = (k) => D.series[k] || D.projection?.series[k];
  // Projection years (budget.json `projection`): shown after the newest year, never selectable.
  const projectionYears = () => (D.projection ? D.projection.years.filter((y) => D.projection.series[key(y, 'projection')]) : []);
  const isProjKey = (k) => !!k && parseKey(k).m === 'projection';
  const projBook = () => `${D.projection.years[0]}–${D.projection.years[D.projection.years.length - 1]} projections book`;
  // "the 2027 budget book" / "the 2028–2029 projections book": the book a source document is.
  const docLabel = (d) => (D.projection && d === D.projection.doc ? projBook() : `${(D.books.find((b) => b.doc === D.docs[d]) || {}).year} budget book`);
  const seriesLabel = (k) => { const { y, m } = parseKey(k); return `${y} ${LABEL[m]}`; };
  const sum = (list) => list.reduce((t, r) => t + r.v, 0);
  /* Source links: the amount itself links to its page in the budget book (no page text is shown). */
  const bookYearOf = (k) => { const s = series(k); return s.book_year != null ? s.book_year : s.year + D.rule[s.measure].book_offset; };
  const bookOf = (k) => (isProjKey(k) ? projBook() : `${bookYearOf(k)} budget book`);
  // County audited reports sit in the ACFR/ folder of the County PDFs, budget resolutions in Resolutions/.
  const docRel = (d) => (/^County-ACFR-/.test(D.docs[d]) ? `ACFR/${D.docs[d]}` : /^County-Resolution-/.test(D.docs[d]) ? `Resolutions/${D.docs[d]}` : D.docs[d]);
  const pdfHref = (d, p) => `${CFG.paths.pdfs}${docRel(d).split('/').map(encodeURIComponent).join('/')}#page=${p}`;
  const src = (text, k, d, p) => (d == null || !k ? text
    : `<a class="src" href="${pdfHref(d, p)}" target="_blank" rel="noopener" title="View in budget book" aria-label="${esc(text)}: open source page in the ${esc(docLabel(d))}">${text}</a>`);
  const firstPage = (list) => { let d = null, p = Infinity; for (const r of list) { if (d == null) d = r.d; if (r.d === d && r.p < p) p = r.p; } return { d, p }; };
  /* ---------- printed totals ----------
     A total is shown exactly as the city printed it when the book prints a total for exactly the lines in view
     (budget.json `printed`, scripts/build_dataset.py: a section, a department roll-up or a fund total; `m` lists the
     lines each covers). Otherwise the site shows its own sum of the lines and labels it "calculated". Where the printed
     figure and its lines disagree by more than rounding (`flag`), the printed figure stays and a note gives our sum, the
     gap and the reviewed explanation from known_issues.csv. Rounding-only gaps are not mentioned. */
  /* The County's printed items carry no member list: what a total covers follows from its kind, fund group, department
     (and fund), account or account group, as in scripts/build_county.py. */
  function countyMember(x) {
    const gf = D.funds.indexOf('General Fund'), df = x.dept_fund != null ? D.funds.indexOf(x.dept_fund) : -1;
    return (r) => {
      if ((x.group === 'General Fund') !== (r.fund === gf)) return false;
      if (x.department != null) return D.departments[r.dept] === x.department && (df < 0 || r.fund === df);
      const acct = r.code.split('-')[1] || '';
      if (x.account != null) return acct === x.account;
      if (x.account_group != null) return acct.slice(0, 2) === x.account_group;
      return true;
    };
  }
  const isFlag = (x, k) => (x.flags ? !!x.flags[k] : (x.flag || []).includes(k));
  function membersOf(i, k) {
    const id = `${i}|${k}`;
    if (memberCache.has(id)) return memberCache.get(id);
    const x = D.printed[i], rev = x.kind === 'revenue';
    const test = x.m ? (r) => x.m.some(([f, b, lo, hi]) => r.fund === f && (b === -1 || r.bureau === b) && r.p >= lo && r.p <= hi) : countyMember(x);
    const set = new Set(rows(k).filter((r) => r.d === x.doc && isRevenue(r) === rev && test(r)));
    memberCache.set(id, set);
    return set;
  }
  function printedFor(list, k) {
    if (!list.length || !series(k)) return null;
    const rev = isRevenue(list[0]), d = list[0].d;
    let best = null, bestScore = Infinity;
    D.printed.forEach((x, i) => {
      if (!(k in x.values) || x.doc !== d || (x.kind === 'revenue') !== rev) return;
      const m = membersOf(i, k);
      if (m.size !== list.length || !list.every((r) => m.has(r))) return;
      const score = (isFlag(x, k) ? 2 : 0) + (x.fund ? 0 : 1); // a figure that adds up, then the fund total
      if (score < bestScore) { best = x; bestScore = score; }
    });
    return best;
  }
  /* The total shown for a list of lines: { v, calc (our sum), x (printed item or null), flag, k, d, p (its page) }. */
  function totalOf(list, k) {
    const calc = sum(list), x = printedFor(list, k);
    if (x) return { v: x.values[k], calc, x, k, d: x.doc, p: x.page, flag: isFlag(x, k) };
    const fp = firstPage(list);
    return { v: calc, calc, x: null, k, d: fp.d, p: fp.p, flag: false };
  }
  const CALC_TAG = '<span class="calc-tag">calculated</span>';
  const GAP_SIGN = '\u2260'; // ≠
  const gapMark = (t) => `<span class="gap-mark" title="${esc(`The lines this total covers add up to ${money(t.calc)}`)}"><span aria-hidden="true">${GAP_SIGN}</span><span class="sr-only"> (the lines it covers add up to ${money(t.calc)}; see the note)</span></span>`;
  /* An amount as shown: the link to its page, then the ≠ mark (a flagged printed total) or the calculated label.
     `tag: false` when the column or sentence already says the figures are calculated. `notes` collects flagged totals. */
  function fig(t, { text = money(t.v), tag = true, notes = null, what = '' } = {}) {
    const a = src(text, t.k, t.d, t.p);
    if (t.x) {
      if (!t.flag) return a;
      if (notes) notes.set(`${D.printed.indexOf(t.x)}|${t.k}`, { t, what });
      return a + gapMark(t);
    }
    return a + (tag ? ` ${CALC_TAG}` : '');
  }
  /* The note under a flagged printed total: what the book prints, what its lines add up to, and why. */
  function gapNote(t, what = '') {
    const g = Math.round(t.calc - t.v), ki = t.x.flags ? t.x.flags[t.k]?.known_issue : t.x.issue, iss = ki != null ? D.known_issues[ki] : null;
    return `<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> ${what ? `<strong>${esc(what)}, ${esc(seriesLabel(t.k))}:</strong> ` : ''}the ${esc(bookOf(t.k))} prints ${src(money(t.v), t.k, t.d, t.p)}, but the lines it totals add up to ${money(t.calc)}, <span class="nb">${money(Math.abs(g))} ${g < 0 ? 'less' : 'more'}.</span> ${iss ? esc(scrubPages(iss.note).replace(/^Text layer, every cell read cleanly \(no OCR\)\.\s*/i, '')) : 'Not yet explained.'} ${knownLink()}</p>`;
  }
  // A page says each gap once, where the figure first appears; later copies of the figure carry the ≠ sign only.
  let notesShown = new Set();
  const gapNotes = (notes) => [...notes].filter(([id]) => !notesShown.has(id)).map(([id, n]) => { notesShown.add(id); return gapNote(n.t, n.what); }).join('');
  /* A calculated total that cannot be complete because the book leaves a whole bureau out (missing_bureaus). */
  function missingNote(k, scope, kind = S.k) {
    if (kind !== 'expense' || !series(k)) return '';
    const s = series(k), doc = D.docs[Array.isArray(s.doc) ? s.doc[0] : s.doc];
    const miss = (D.missing_bureaus[doc] || []).filter((m) => {
      const u = O.codes[m.org];
      return (!scope.fund || scope.fund === m.fund) && (scope.dept == null || (u != null && O.units[u].dept === scope.dept)) && (scope.unit == null || u === scope.unit);
    });
    if (!miss.length) return '';
    return `<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> <strong>Incomplete, ${esc(seriesLabel(k))}:</strong> the ${esc(bookOf(k))} has no line-item pages for ${esc(miss.map((m) => m.name).join(' and '))}, so the calculated figures here leave ${miss.length === 1 ? 'it' : 'them'} out. ${knownLink()}</p>`;
  }

  /* ---------- data access ---------- */
  function rows(k) {
    if (!k || !series(k)) return [];
    if (rowCache.has(k)) return rowCache.get(k);
    const s = series(k);
    const out = s.a.map((acct, i) => {
      const a = D.accounts[acct];
      const unit = O.codes[a[0].split('-')[0]];
      return { ai: acct, code: a[0], name: a[1], fund: a[2], dept: a[3], bureau: a[4], cat: a[5], v: s.v[i], p: s.p[i], d: Array.isArray(s.doc) ? s.doc[i] : s.doc,
        unit, od: O.units[unit].dept }; // od: department on the 2027 org chart
    });
    rowCache.set(k, out);
    return out;
  }
  const isRevenue = (r) => D.categories[r.cat] === 'Revenue';
  /* Income is money coming in: taxes, fees, grants, interest. The books also list as revenue money drawn from savings
     ("draw") and money moved in from the government's own funds ("transfer"); neither is income anywhere on the site.
     Charges to its own funds for services ("charge": indirect costs, Treasury and IT allocations) are income of the fund
     that receives them, labelled, but not of All funds, where the paying fund's income already counts that money.
     budget.json `not_income`, from data/income_rules.csv. Spending is every expense line, as printed. */
  const nonIncome = (ai) => (D.not_income && D.not_income[ai]) || '';
  const incomeAcct = (ai, allFunds = false) => { const c = nonIncome(ai); return c !== 'draw' && c !== 'transfer' && !(allFunds && c === 'charge'); };
  const isIncome = (r, allFunds = false) => isRevenue(r) && incomeAcct(r.ai, allFunds);
  const ofKind = (r, kind, allFunds = false) => (kind === 'revenue' ? isIncome(r, allFunds) : !isRevenue(r));
  const acctKindOk = (ai, kind, allFunds = false) => (D.categories[D.accounts[ai][5]] === 'Revenue' ? kind === 'revenue' && incomeAcct(ai, allFunds) : kind === 'expense');
  const bureauKey = (r) => `${r.fund}|${r.bureau}`;
  // Old budget-group names end in " Exp" / " Expense" (the book's section label). Show the plain name.
  const plainName = (n) => String(n).replace(/\s+Exp(?:ense)?$/i, '');
  const bureauName = (i) => plainName(D.bureaus[i]);
  const bureauSlug = (fund, bureau) => `${slug(D.funds[fund])}--${slug(D.bureaus[bureau])}`;

  function scoped(k, over = {}) {
    const kind = over.kind || S.k;
    const f = D.funds.indexOf(S.f);
    return rows(k).filter((r) =>
      ofKind(r, kind, f < 0) &&
      (over.unit != null || f < 0 || r.fund === f) && // a bureau page shows all of its funds
      (over.dept == null || r.od === over.dept) &&
      (over.unit == null || r.unit === over.unit));
  }
  function aggregate(list, keyFn, labelFn) {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r);
      let g = m.get(k);
      if (!g) { g = { key: k, label: labelFn(r), total: 0, funds: new Set(), sample: r, d: r.d, p: r.p }; m.set(k, g); }
      g.total += r.v; g.funds.add(r.fund);
      if (r.d === g.d && r.p < g.p) g.p = r.p;
    }
    return m;
  }
  const catRank = (i) => { const n = CAT_ORDER.indexOf(D.categories[i]); return n < 0 ? 99 : n; };
  const catColor = (i) => PALETTE[catRank(i) % PALETTE.length];

  /* Extra Fund-selector entries that are not budget lines. Placeholder for the "Reserve Fund" (General Fund
     balance projection: year-end balance and year-over-year change; Actual (unaudited) for past years,
     Projected for the prior budget year, Proposed and Revised for the new year). It appears when
     budget.json has a `reserve` block (built from data/processed/fund_balance_*.csv) and is rendered by
     reserveView() on the home route. */
  const extraFundViews = () => (D.reserve ? [D.reserve.name] : []);
  const isReserve = () => !!D.reserve && S.f === D.reserve.name;

  const years = () => [...new Set(Object.values(D.series).map((s) => s.year))].sort((a, b) => b - a);
  const measuresFor = (y) => ORDER.filter((m) => series(key(y, m))); // the year's charted kind(s)
  const figuresFor = (y) => PICK_ORDER.filter((m) => D.series[key(y, m)]); // everything the Budget year select offers for it
  const defaultMeasure = (y) => { const ms = measuresFor(y); return ms.includes('revised') ? 'revised' : ms.includes('proposed') ? 'proposed' : ms[0] || figuresFor(y)[0]; };
  // Every selectable figure, newest year first, then PICK_ORDER within the year: "2027 Revised", "2027 Proposed", "2026 Projected", …
  const figureKeys = () => Object.keys(D.series).sort((a, b) => parseKey(b).y - parseKey(a).y || PICK_ORDER.indexOf(parseKey(a).m) - PICK_ORDER.indexOf(parseKey(b).m));
  function defaultCompare(y, m) {
    return [key(y - 1, m), ...ORDER.map((x) => key(y - 1, x))].find((k) => series(k)) || '';
  }

  /* ---------- routing ---------- */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const q = new URLSearchParams(qs);
    const ent = parts[0] === 'county' ? 'county' : 'city'; // #/county/... is the County; any other #/... is the City
    if (ent === 'county') parts.shift();
    let r = { name: 'home' };
    if (parts[0] === 'changes') r = { name: 'changes' };
    else if (parts[0] === 'about') r = { name: 'about' };
    else if (parts[0] === 'terms') r = { name: 'terms' };
    else if (parts[0] === 'budget-calendar') r = { name: 'calendar' };
    else if (parts[0] === 'department' && parts[1]) {
      r = parts[2] === 'bureau' && parts[3] ? { name: 'bureau', dept: parts[1], bureau: parts[3] } : { name: 'dept', dept: parts[1] };
    } else if (parts.length && location.hash.startsWith('#/')) r = { name: 'missing' }; // any other path is not a page
    return { r, q, ent };
  }
  function applyQuery(q) {
    const ys = years();
    S.y = ys.includes(+q.get('y')) ? +q.get('y') : ys.includes(D.newest_year) ? D.newest_year : ys[0];
    const ms = figuresFor(S.y);
    // A year's budget figure is Amended or Adopted, never both: an address naming the other one opens the one shown.
    const qm = ['adopted', 'amended'].includes(q.get('m')) && !ms.includes(q.get('m')) ? ms.find((m) => m === 'adopted' || m === 'amended') : q.get('m');
    S.m = ms.includes(qm) ? qm : defaultMeasure(S.y);
    let c = (q.get('c') || '').replace('-', '|');
    if (!D.series[c] && /\|(adopted|amended)$/.test(c)) { const y = parseKey(c).y; c = key(y, figuresFor(y).find((m) => m === 'adopted' || m === 'amended') || parseKey(c).m); }
    S.c = q.has('c') ? (series(c) && c !== key(S.y, S.m) ? c : '') : defaultCompare(S.y, S.m);
    S.k = q.get('k') === 'revenue' ? 'revenue' : 'expense';
    S.f = q.get('f') === 'all' ? '' : (D.funds.includes(q.get('f')) || extraFundViews().includes(q.get('f'))) ? q.get('f') : DEFAULT_FUND; // opens on the default fund unless f=all
  }
  function query(over = {}) {
    const s = { ...S, ...over };
    const q = new URLSearchParams();
    q.set('y', s.y); q.set('m', s.m);
    if (s.c !== defaultCompare(s.y, s.m)) q.set('c', s.c ? s.c.replace('|', '-') : 'none');
    if (s.k !== 'expense') q.set('k', s.k);
    if (!s.f) q.set('f', 'all'); else if (s.f !== DEFAULT_FUND) q.set('f', s.f);
    return q.toString();
  }
  const deptHash = (dept, over) => eh(`department/${O.departments[dept].slug}?${query(over)}`);
  const unitHash = (unit, over) => eh(`department/${O.departments[O.units[unit].dept].slug}/bureau/${O.units[unit].slug}?${query(over)}`);
  const homeHash = (over) => eh(`?${query(over)}`);

  function navigate(hash, replace = false) {
    if (replace) { history.replaceState(null, '', hash); onRoute(false); } else { location.hash = hash; }
  }
  const currentHash = () => (route.name === 'home' ? homeHash : route.name === 'changes' ? (o) => changesHash(o) : route.name === 'dept' ? (o) => deptHash(route.deptIdx, o) : (o) => unitHash(route.unitIdx, o));

  /* ---------- shared UI pieces ---------- */
  function statusHTML() {
    const draft = S.m === 'proposed' || S.m === 'revised';
    const ad = CFG.adopted && CFG.adopted.year === S.y && S.m === 'budget' ? `, ${CFG.adopted.text}` : ''; // the County's newest budget cites its resolution
    return `<a class="status${draft ? ' not-adopted' : ''}" href="${termHref(`term-${S.m}`)}" title="What this means">${S.y}: ${STATUS[S.m]}${ad}<span class="sr-only"> (what this means)</span></a>`;
  }

  const knownLink = () => `<a class="known-link" href="${eh('about?s=about-issues')}">Known issues for this view</a>`;

  /* The one Fund list, used by every view: "All funds" (on a department page only while it is the choice), the funds that
     have lines in what is shown (plus the current choice), and the Reserve Fund view where the page allows it. */
  function fundChoices(present, scope) {
    return [...(!scope || !S.f ? [['', 'All funds']] : []),
      ...D.funds.filter((f, i) => present.has(i) || f === S.f).map((f) => [f, fn(f)]),
      ...(scope ? [] : extraFundViews().map((f) => [f, f]))];
  }
  const fundOptions = (present, scope) => fundChoices(present, scope).map(([v, label]) => `<option value="${esc(v)}"${v === S.f ? ' selected' : ''}>${esc(label)}</option>`).join('');

  /* One tab-group field for the controls (Spending / Income, Show first): square segmented buttons named by their visible
     label, as a radio group: only the chosen button is in the Tab order; arrow keys (and Home / End) move the choice. */
  const tabField = (name, label, items, cur, extra = '') => `<div class="field field-tabs"><span class="field-label" id="lbl-${name}">${label}</span><div class="tabs" role="radiogroup" aria-labelledby="lbl-${name}">${items.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" tabindex="${v === cur ? 0 : -1}" data-tab="${name}" data-v="${v}">${esc(l)}</button>`).join('')}</div>${extra}</div>`;
  /* A labelled select (Budget year, Compare with, Fund). `note` is a short line under it, read with it (aria-describedby). */
  const selField = (id, sel, label, opts, note = '') => `<div class="field"><label class="field-label" for="${id}">${label}</label><select id="${id}" data-sel="${sel}"${note ? ` aria-describedby="${id}-note"` : ''}>${opts}</select>${note ? `<p class="field-note" id="${id}-note">${note}</p>` : ''}</div>`;
  /* Year-and-figure options grouped by year (<optgroup label="2027">), each option named in full ("2027 Revised") so it
     reads the same with or without the group. `off`: a key listed but not choosable, with the reason in its name. */
  function figureOptions(list, cur, { none = false, off = null, offWhy = '', label = (x) => seriesLabel(x) } = {}) {
    const groups = [];
    for (const x of list) { const y = parseKey(x).y; if (!groups.length || groups[groups.length - 1].y !== y) groups.push({ y, ks: [] }); groups[groups.length - 1].ks.push(x); }
    return (none ? `<option value="none"${!cur ? ' selected' : ''}>No comparison</option>` : '')
      + groups.map((g) => `<optgroup label="${g.y}">${g.ks.map((x) => `<option value="${x}"${x === cur ? ' selected' : ''}${x === off ? ' disabled' : ''}>${esc(label(x))}${x === off ? ` (${offWhy})` : ''}</option>`).join('')}</optgroup>`).join('');
  }

  /* The Reserve Fund: Budget year lists its balances (year and figure, e.g. "2027 Revised", "2025 Actual (unaudited)");
     there is no Compare with, because each balance is shown with its change from the year before. */
  const resCur = () => resFind(S.y, S.m) || resFind(S.y, ORDER.find((m) => resFind(S.y, m)));
  function reserveFiltersHTML() {
    const ks = D.reserve.entries.map((e) => key(e.year, e.measure)).sort((a, b) => parseKey(b).y - parseKey(a).y || PICK_ORDER.indexOf(parseKey(a).m) - PICK_ORDER.indexOf(parseKey(b).m));
    const e = resCur(), cur = e ? key(e.year, e.measure) : '';
    const lbl = (x) => resLabel(resFind(parseKey(x).y, parseKey(x).m));
    const ym = measuresFor(S.y)[0], funds = fundOptions(new Set(ym ? rows(key(S.y, ym)).map((r) => r.fund) : D.funds.map((f, i) => i)), null);
    return selField('f-y', 'ym', 'Budget year', figureOptions(ks, cur, { label: lbl })) + selField('f-f', 'f', 'Fund', funds);
  }

  /* "What do these mean?": one explainer for the figures and the funds, the last of the controls. Its toggle opens a panel
     the width of the pinned controls bar, laid over the page under it, with the definitions in columns that reflow to the
     width (one column on phones): "Figures", then "Funds". The wording is the Funds and terms page's own (figureWords,
     FUND_INFO, FUND_INTRO, balanceWord), not a copy. The figure in Budget year is marked "shown", the one in Compare with
     "comparing" and the chosen fund "selected" (in words, in bold and with a rule, not by colour alone). It closes with
     the toggle, with Escape (focus returns to the toggle) and when focus leaves the controls. */
  let explainOpen = false;
  const EXPLAIN_FIGURES = { city: ['actual', 'projected', 'proposed', 'revised', 'amended', 'adopted', 'projection', 'calculated'], county: ['budget', 'actual', 'calculated'] };
  function explainHTML({ shown = [], comparing = [], funds = [] } = {}) {
    const item = (title, text, tags) => `<div class="explain-item${tags.length ? ' is-on' : ''}"><dt>${title}${tags.map((t) => ` <span class="explain-tag">${t}</span>`).join('')}</dt><dd>${text}</dd></div>`;
    const ids = EXPLAIN_FIGURES[ENT].filter((id) => id !== 'projection' || projectionYears().length);
    const words = figureWords();
    const figs = ids.map((id) => words.find((w) => w[0] === id)).filter(Boolean)
      .map(([id, t, d]) => item(t, d, [shown.includes(id) && 'shown', comparing.includes(id) && 'comparing'].filter(Boolean))).join('');
    const bal = balanceWord();
    const fundItems = funds.filter((f) => f).map((f) => {
      if (bal && f === D.reserve.name) return item(esc(f), bal[2], f === S.f ? ['selected'] : []);
      const [paid, text] = fundInfo(f);
      return item(esc(fn(f)), `<strong>${esc(paid)}.</strong> ${esc(text)}`, f === S.f ? ['selected'] : []);
    }).join('');
    return `<div class="controls-define"><button type="button" class="explain-toggle" id="explain-toggle" aria-expanded="${explainOpen}" aria-controls="explain">What do these mean?</button></div>
      <div class="explain" id="explain" role="region" aria-label="What these mean" tabindex="0"${explainOpen ? '' : ' hidden'}>
        <h2 class="explain-h">Figures</h2><dl class="explain-grid">${figs}</dl>
        <h2 class="explain-h">Funds</h2><p class="explain-intro">${FUND_INTRO}</p>${fundItems ? `<dl class="explain-grid">${fundItems}</dl>` : ''}
        <p class="define-more"><a href="${eh('terms')}">More in Funds and terms →</a></p></div>`;
  }
  const mOf = (k) => (k ? parseKey(k).m : null);

  /* One controls component for every page (home with any fund, the Reserve Fund, department and bureau pages, What changed),
     always open: the year's status stamp, then one group named "View" holding, in Tab order, Budget year, Compare with,
     Fund and the Spending / Income tabs (each where the page has it), then the short definitions. A change re-draws the
     page, keeps focus on the control and is announced in one sentence (announceView). The whole bar stays pinned at the
     top of the main column while the page scrolls (.controls in styles.css; pinControls measures it). */
  function controlsWrap(fields, stamp = statusHTML(), explain = '') {
    return `<div class="controls" id="controls">${stamp ? `<p class="controls-stamp">${stamp}</p>` : ''}
      <fieldset class="controls-fields"><legend class="sr-only">View</legend>${fields}</fieldset>
      ${explain}</div>`;
  }
  const kindWordPlain = () => (S.k === 'revenue' ? 'Income' : 'Spending');

  /* Lines of a department or bureau in either shown figure, ignoring the Fund selector: what that page can offer. */
  function scopeRows(scope) {
    const ks = [key(S.y, S.m), S.c].filter(Boolean);
    return ks.flatMap((kk) => rows(kk).filter((r) => (scope.dept == null || r.od === scope.dept) && (scope.unit == null || r.unit === scope.unit)));
  }

  function filtersHTML({ fund = true, scope = null } = {}) {
    const allFunds = () => fundChoices(new Set(measuresFor(S.y)[0] ? rows(key(S.y, measuresFor(S.y)[0])).map((r) => r.fund) : D.funds.map((f, i) => i)), null).map(([v]) => v);
    if (isReserve() && isCounty()) return controlsWrap(cbFiltersHTML(), `<a class="status" href="${termHref('term-balance')}" title="What this means">${S.y}: Budget and Actual balances<span class="sr-only"> (what this means)</span></a>`, explainHTML({ shown: ['budget', 'actual'], funds: allFunds() }));
    if (isReserve()) {
      const e = resCur();
      const stamp = e ? `<a class="status${e.measure === 'proposed' || e.measure === 'revised' ? ' not-adopted' : ''}" href="${termHref('term-balance')}" title="What this means">${e.year}: ${esc(RES_STATUS[e.measure])}<span class="sr-only"> (what this means)</span></a>` : '';
      return controlsWrap(reserveFiltersHTML(), stamp, explainHTML({ shown: e ? [e.measure] : [], funds: allFunds() }));
    }
    const k = key(S.y, S.m), all = figureKeys();
    // Compare with lists the same figures; the one shown as Budget year stays listed but cannot be picked.
    const cmp = figureOptions(all, S.c, { none: true, off: k, offWhy: 'the budget year shown' });
    // Home offers every fund plus "All funds" and the Reserve Fund. A department page offers only the funds it has lines in
    // (and the current choice, so the control never disagrees with the page).
    const sr = scope ? scopeRows(scope) : null;
    const present = new Set((sr || rows(k)).map((r) => r.fund));
    const funds = fundOptions(present, scope), fundList = fundChoices(present, scope).map(([v]) => v);
    // Offer Spending / Income only where the page has both kinds of lines.
    const kinds = sr ? ['expense', 'revenue'].filter((kd) => kd === S.k || sr.some((r) => (kd === 'revenue') === isRevenue(r))) : ['expense', 'revenue'];
    const kindTabs = kinds.length > 1
      ? tabField('k', 'Show', [['expense', 'Spending'], ['revenue', 'Income']], S.k) : '';
    const showFund = fund && (!scope || [...present].length + (S.f && !present.has(D.funds.indexOf(S.f)) ? 1 : 0) > 1 || !S.f);
    const fields = selField('f-y', 'ym', 'Budget year', figureOptions(all, k))
      + selField('f-c', 'c', 'Compare with', cmp)
      + (showFund ? selField('f-f', 'f', 'Fund', funds, scope ? `Only the funds this ${scope.unit != null ? 'bureau' : 'department'} uses are listed.` : '') : '')
      + kindTabs;
    return controlsWrap(fields, statusHTML(), explainHTML({ shown: [S.m], comparing: [mOf(S.c)], funds: showFund ? fundList : [...present].map((i) => D.funds[i]) }));
  }

  /* One sentence for the live region after a control changes: "Showing 2027 Revised compared with 2026 Projected, General
     Fund, spending." It names only what this page's controls offer (no Fund on a bureau page, no kind on the Reserve Fund). */
  function viewSentence() {
    if (route.name === 'home' && isReserve()) {
      const e = isCounty() ? null : resCur();
      return `Showing the ${D.reserve.name}, ${e ? resLabel(e) : S.y}.`;
    }
    const parts = [`Showing ${seriesLabel(key(S.y, S.m))}${S.c ? ` compared with ${seriesLabel(S.c)}` : ', no comparison'}`];
    if ($('f-f')) parts.push(fn(S.f) || 'All funds');
    if ($('view').querySelector('[data-tab="k"]')) parts.push(`${kindWordPlain().toLowerCase()}${route.name === 'changes' ? ' first' : ''}`);
    return `${parts.join(', ')}.`;
  }
  let announceTimer = null;
  function announceView() {
    const el = $('view-status'); if (!el) return;
    el.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.textContent = viewSentence(); }, 100); // emptied first, so the same sentence is read again
  }

  function onFilter(name, v) {
    const over = {};
    if (name === 'ym') {
      // Budget year (year and figure). Compare with follows the usual default unless the visitor chose one, which stays
      // (unless it is now the figure shown).
      const { y, m } = parseKey(v), nk = key(y, m);
      const chosen = S.c !== defaultCompare(S.y, S.m);
      over.y = y; over.m = m;
      over.c = chosen && S.c !== nk ? S.c : defaultCompare(y, m);
    } else if (name === 'y') {
      const ms = figuresFor(+v);
      over.y = +v; over.m = ms.includes(S.m) ? S.m : defaultMeasure(+v);
      over.c = defaultCompare(+v, over.m);
    } else if (name === 'm') {
      over.m = v; over.c = defaultCompare(S.y, v);
    } else if (name === 'c') {
      over.c = v === 'none' ? '' : v;
    } else if (name === 'k') {
      over.k = v;
    } else if (name === 'f') {
      over.f = v;
    }
    // The page re-renders; keep keyboard focus on the control that was used (a select keeps its id; a tab group puts it
    // on the chosen button), then say what is shown now.
    const id = document.activeElement?.id;
    navigate(currentHash()(over), true);
    const a = document.activeElement;
    if (!a || a === document.body || !$('view').contains(a)) {
      if (id && $(id)) $(id).focus({ preventScroll: true });
      else $('view').querySelector(`[data-tab="${name}"][aria-checked="true"]`)?.focus({ preventScroll: true });
    }
    announceView();
  }

  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; closeHist(); }
  const chartTheme = () => ({
    tip: { backgroundColor: BG, borderColor: GRID, borderWidth: 1, titleColor: INK, bodyColor: INK, padding: 10 },
    tick: MUTED, grid: GRID,
  });
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- multi-year trend and printed-total notes ---------- */
  let trendScope = null;
  function trendData(scope) {
    const pts = [];
    for (const y of years().slice().sort((a, b) => a - b)) {
      for (const m of ORDER) {
        const kk = key(y, m);
        if (!series(kk)) continue;
        const l = scoped(kk, scope), t = l.length ? totalOf(l, kk) : null;
        pts.push({ y, m, v: t ? t.v : null, t });
      }
    }
    // The city's projections follow the newest year (never selectable; see projectionYears).
    for (const y of projectionYears()) {
      const kk = key(y, 'projection'), l = scoped(kk, scope), t = l.length ? totalOf(l, kk) : null;
      pts.push({ y, m: 'projection', v: t ? t.v : null, t });
    }
    return pts;
  }
  /* Under the trend: the projection years are the city's estimates, with its printed assumptions (linked to their page),
     the fund's printed Surplus/(Deficit) when one fund is in view, and, for the General Fund, that the newest year is
     balanced with money drawn from savings (not income) and the projections plan none. Plain muted text: tentative, not alarming. */
  function projectionNote(scope, pts) {
    const P = D.projection, ys = pts.filter((p) => p.m === 'projection' && p.v != null).map((p) => p.y);
    if (!P || !ys.length) return '';
    const yrs = ys.length > 1 ? `${ys[0]} and ${ys[ys.length - 1]}` : String(ys[0]);
    const page = (P.assumptions[0] || {}).p;
    const assume = page ? srcDoc('assumptions', P.doc, page) : 'assumptions';
    let extra = '';
    const fi = D.funds.indexOf(S.f);
    if (fi >= 0 && scope.dept == null && scope.unit == null) {
      const sp = P.surplus.find((x) => x.fund === fi);
      const vals = sp ? ys.map((y) => ({ y, v: sp.values[key(y, 'projection')] })).filter((x) => x.v != null) : [];
      if (vals.length) {
        const neg = vals.every((x) => x.v < 0), pos = vals.every((x) => x.v >= 0);
        const amts = vals.map((x) => `${srcDoc(mny(Math.abs(x.v)), P.doc, sp.page)} in ${x.y}`).join(' and ');
        extra += neg ? ` They show the ${esc(S.f)} spending more than it brings in, by ${amts}.`
          : pos ? ` They show the ${esc(S.f)} bringing in more than it spends, by ${amts}.`
          : ` Their printed surplus or deficit: ${vals.map((x) => `${srcDoc(money(x.v), P.doc, sp.page)} in ${x.y}`).join(', ')}.`;
      }
      const gf = D.funds.indexOf(DEFAULT_FUND), nk = key(D.newest_year, defaultMeasure(D.newest_year));
      const dr = fi === gf && D.reserve && S.k !== 'revenue' ? reserveDraw(nk, gf) : null; // the draw is not income
      if (dr && !ys.some((y) => reserveDraw(key(y, 'projection'), gf))) {
        extra += ` The ${esc(seriesLabel(nk))} budget is balanced with ${src(millions(dr.v), nk, dr.d, dr.p)} drawn from savings, which is not income; the projections plan no draw.`;
      }
    }
    const groups = [];
    for (const a of P.assumptions.slice(1)) {
      if (a.k === 'head' || !groups.length) groups.push({ head: a.k === 'head' ? a.t : '', items: [] });
      if (a.k !== 'head') groups[groups.length - 1].items.push(a);
    }
    const list = groups.map((g) => `${g.head ? `<p class="proj-head">${esc(g.head)}</p>` : ''}<ul>${g.items.map((a) => `<li${a.k === 'note' ? ' class="proj-fine"' : ''}>${esc(a.t.replace(/^\([a-z]\)\s*/, ''))}</li>`).join('')}</ul>`).join('');
    return `<div class="trend-proj"><p><strong>${yrs} are projections</strong>, not budgets: the city's estimates made with its ${D.projection.after_year} budget, based on its ${assume}.${extra}</p>
      ${groups.length ? `<details class="values proj-assume"><summary>The city's assumptions</summary>${list}</details>` : ''}</div>`;
  }
  // The legend under a trend: one entry per kind of figure the points hold (shared by Totals by Year and a line item's history).
  function trendLegend(pts) {
    const has = (m) => pts.some((p) => p.m === m && p.v != null);
    return [
      has('actual') && `<li><i class="ln"></i>Actual</li>`,
      has('budget') && `<li><i class="ln"></i>Budget</li>`,
      has('projected') && `<li><i class="ln dashed"></i>Projected</li>`,
      has('proposed') && `<li><i class="dot diamond" style="background:${PALETTE[0]}"></i>Proposed</li>`,
      has('revised') && `<li><i class="dot" style="background:${SEL}"></i>Revised</li>`,
      has('projection') && `<li><i class="ln dotted proj"></i><i class="dot ring proj"></i>Projection</li>`,
    ].filter(Boolean).join('');
  }
  function trendHTML(scope, title, { bare = false } = {}) {
    trendScope = scope;
    const pts = trendData(scope);
    if (!pts.some((p) => p.v != null)) return '';
    const has = (m) => pts.some((p) => p.m === m && p.v != null);
    const legend = trendLegend(pts);
    // Proposed and Revised sit a few pixels apart on a $0-based axis, so state the revision in words.
    const budgetPts = pts.filter((p) => p.m !== 'projection');
    const ly = budgetPts.length ? Math.max(...budgetPts.map((p) => p.y)) : null;
    const pv = pts.find((p) => p.y === ly && p.m === 'proposed' && p.v != null), rv = pts.find((p) => p.y === ly && p.m === 'revised' && p.v != null);
    const revision = pv && rv ? `<p class="trend-revision">${ly}: Proposed ${mny(pv.v)} → Revised ${mny(rv.v)}, ${deltaHTML(rv.v - pv.v, pv.v, mny)}</p>` : '';
    const notes = new Map(), what = trendWhat(scope);
    const rowsHtml = pts.map((p) => `<tr${p.m === 'projection' ? ' class="proj-row"' : ''}><th scope="row">${p.y}</th><td>${LABEL[p.m]}</td><td class="num">${p.t ? fig(p.t, { notes, what }) : '—'}</td></tr>`).join('');
    const hasProj = has('projection');
    const head = bare ? '' : `<h2 class="panel-title" id="tr-t">${esc(title)}</h2>`;
    const inner = `${head}
      <p class="panel-note${bare ? ' panel-note-left' : ''}">${kindWordPlain()}${S.f ? ' · ' + esc(fn(S.f)) : ''}. ${isCounty() ? 'Each year shows the County\'s budget.' : 'Each year shows one kind of figure: actual, projected or proposed' + (hasProj ? ', then the city\'s projections' : '') + '.'}</p>
      <ul class="trend-legend" aria-hidden="true">${legend}</ul>${revision}
      <div class="chart-box short"><canvas id="trend-chart" role="img" aria-label="Totals by year, ${pts[0].y} to ${pts[pts.length - 1].y}. Solid line: actual. Dashed line: projected. Hollow diamond: proposed. Solid dot: revised.${hasProj ? ' Dotted gray line with hollow points, on a shaded band: the city\'s projections.' : ''} The table below has the values."></canvas></div>
      <p class="trend-axis" id="trend-axis"></p>${spikeNotes(scope, S.k)}${projectionNote(scope, pts)}
      <details class="values"><summary>Show values</summary><div class="table-scroll"><table class="table"><thead><tr><th scope="col">Year</th><th scope="col">Figure</th><th scope="col" class="num">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${gapNotes(notes)}</details>`;
    return bare ? inner : `<section class="panel" aria-labelledby="tr-t">${inner}</section>`;
  }
  function drawTrend() {
    const cv = $('trend-chart');
    if (!cv || !window.Chart || !trendScope) return;
    charts.push(trendChart(cv, trendData(trendScope), $('trend-axis')));
  }
  /* The trend line chart for a list of points ({ y, m, v }, v null where there is no figure): Totals by Year, and the
     history of one line item (lineHistory). `axisEl` receives the note that the axis does not start at zero; `fine` gives a
     narrow range in millions the decimals its ticks need. */
  function trendChart(cv, pts, axisEl, fine = false) {
    const th = chartTheme();
    const yrs = [...new Set(pts.map((p) => p.y))];
    const projAt = new Set(pts.filter((p) => p.m === 'projection').map((p) => p.y));
    const main = yrs.map((y) => pts.find((p) => p.y === y && (p.m === 'actual' || p.m === 'projected' || p.m === 'budget')) || null);
    const dot = (m, c) => ({ label: LABEL[m], data: yrs.map((y) => pts.find((p) => p.y === y && p.m === m)?.v ?? null), borderColor: c, backgroundColor: c, showLine: false, pointRadius: 5, pointHoverRadius: 7 });
    const datasets = [{
      label: 'Actual / Projected', data: main.map((p) => p?.v ?? null), borderColor: SEL, borderWidth: 2, tension: 0, spanGaps: true,
      pointRadius: 4, pointHoverRadius: 6, pointBorderColor: SEL, pointBackgroundColor: (c) => (main[c.dataIndex]?.m === 'projected' ? SURFACE : SEL),
      segment: { borderDash: (c) => (main[c.p1DataIndex]?.m === 'projected' ? [6, 4] : undefined) },
    }];
    // Proposed is a hollow ink diamond. Revised is the figure the page is about, so it is a solid green dot, joined to the
    // last Actual/Projected point by a dashed line: the reader can see where the revision lands.
    if (pts.some((p) => p.m === 'proposed')) datasets.push({ ...dot('proposed', PALETTE[0]), pointStyle: 'rectRot', pointRadius: 7, pointHoverRadius: 9, backgroundColor: SURFACE, borderWidth: 2.5 });
    const rvPt = pts.filter((p) => p.m === 'revised' && p.v != null).pop();
    if (rvPt) {
      const ri = yrs.indexOf(rvPt.y), pi = main.map((p, i) => (p && p.v != null ? i : -1)).filter((i) => i >= 0 && i < ri).pop();
      datasets.push({ label: 'Revised', data: yrs.map((y, i) => (i === ri ? rvPt.v : i === pi ? main[pi].v : null)), borderColor: SEL, backgroundColor: SEL, borderWidth: 2, borderDash: [6, 4], showLine: true, spanGaps: false,
        pointRadius: (c) => (c.dataIndex === ri ? 8 : 0), pointHoverRadius: (c) => (c.dataIndex === ri ? 10 : 0), pointHitRadius: (c) => (c.dataIndex === ri ? 10 : 0), pointBorderColor: SURFACE, pointBorderWidth: 2 });
    }
    // Projections: a thin dotted ink-gray line with hollow points, continuing from the newest year's figure in view
    // (Revised, else Proposed), over a shaded band labelled "Projection". Gray, not green: it is not the figure being read.
    const prPts = pts.filter((p) => p.m === 'projection' && p.v != null);
    if (prPts.length) {
      const nm = defaultMeasure(D.newest_year), anchor = pts.find((p) => p.y === D.newest_year && p.m === nm && p.v != null);
      const ai = anchor ? yrs.indexOf(anchor.y) : -1;
      const at = (i) => (i === ai ? anchor.v : prPts.find((p) => p.y === yrs[i])?.v ?? null);
      datasets.push({ label: LABEL.projection, data: yrs.map((_, i) => at(i)), borderColor: CMP, backgroundColor: SURFACE, borderWidth: 1.5, borderDash: [2, 4], showLine: true, spanGaps: false,
        pointStyle: 'circle', pointRadius: (c) => (c.dataIndex === ai ? 0 : 4), pointHoverRadius: (c) => (c.dataIndex === ai ? 0 : 6), pointHitRadius: (c) => (c.dataIndex === ai ? 0 : 8), pointBorderColor: CMP, pointBorderWidth: 1.5 });
    }
    const band = { id: 'projBand', beforeDatasetsDraw(chart) {
      if (!projAt.size) return;
      const xs = chart.scales.x, { top, bottom, right } = chart.chartArea, first = yrs.findIndex((y) => projAt.has(y));
      const left = first > 0 ? (xs.getPixelForValue(first - 1) + xs.getPixelForValue(first)) / 2 : chart.chartArea.left;
      const g = chart.ctx; g.save(); g.fillStyle = TRACK; g.fillRect(left, top, right - left, bottom - top);
      g.fillStyle = MUTED; g.font = `600 12px ${getComputedStyle(document.documentElement).getPropertyValue('--font')}`; g.textBaseline = 'bottom'; g.fillText('Projection', left + 6, bottom - 4); g.restore(); // at the foot: the line runs high
    } };
    // The line chart does not start at zero (a line shows movement, not size), so the axis says where it starts.
    const vals = pts.map((p) => p.v).filter((v) => v != null && v > 0);
    let yMin = 0;
    if (vals.length) { const lo = Math.min(...vals) * 0.7, pow = 10 ** Math.floor(Math.log10(lo)); yMin = Math.floor(lo / pow) * pow; }
    // A narrow range in millions would repeat "$6M, $6M"; give those ticks the decimals they need.
    const span = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    const tickFmt = (n) => (fine && span < 5e6 && Math.abs(n) >= 1e6 ? `${n < 0 ? MINUS : ''}$${parseFloat((Math.abs(n) / 1e6).toFixed(2))}M` : short(n));
    if (axisEl) axisEl.textContent = yMin > 0 ? `The vertical axis starts at ${short(yMin)}, not zero.` : '';
    return new Chart(cv, { type: 'line', data: { labels: yrs, datasets }, plugins: [band],
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 8 } }, animation: reduceMotion() ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => (c.datasetIndex === 0 ? `${LABEL[main[c.dataIndex].m]}: ${money(c.raw)}` : `${c.dataset.label}: ${money(c.raw)}`) } } },
        scales: { x: { offset: true, ticks: { color: (c) => (projAt.has(yrs[c.index]) ? MUTED : INK) }, grid: { color: th.grid } }, y: { beginAtZero: yMin === 0, min: yMin || undefined, ticks: { color: th.tick, callback: (n) => tickFmt(n) }, grid: { color: th.grid } } } } });
  }
  /* ---------- A line far above the years either side of it (e.g. 2025 Building Permits) ----------
     Along the Actual / Projected line (then the newest year's figure), a line whose amount in one year is at least
     SPIKE_X times its amount in both the year before and the year after (both printed and above zero), where the jump
     is at least SPIKE_SHARE of its fund's total of that kind that year. Found from the lines, never typed in; named under
     Totals by Year and on What changed. check_dataset.py lists the same lines. */
  const SPIKE_X = 2, SPIKE_SHARE = 0.05;
  const spikeCache = new Map();
  const trendKeys = () => years().slice().sort((a, b) => a - b)
    .map((y) => { const m = ['actual', 'projected'].find((x) => series(key(y, x))) || (y === D.newest_year ? defaultMeasure(y) : null); return m ? key(y, m) : null; })
    .filter(Boolean);
  function lineSpikes(kind) {
    if (spikeCache.has(kind)) return spikeCache.get(kind);
    const ks = trendKeys();
    const by = ks.map((k) => {
      const m = new Map(), tot = new Map();
      for (const r of rows(k)) {
        if (!ofKind(r, kind)) continue; // per fund: draws and transfers are not income
        tot.set(r.fund, (tot.get(r.fund) || 0) + r.v);
        const id = `${r.fund}|${r.code}`, g = m.get(id);
        if (g) g.v += r.v; else m.set(id, { k, v: r.v, d: r.d, p: r.p, r });
      }
      return { m, tot };
    });
    const out = [];
    for (let i = 1; i < ks.length - 1; i++) {
      for (const [id, x] of by[i].m) {
        const a = by[i - 1].m.get(id), b = by[i + 1].m.get(id);
        if (!a || !b || a.v <= 0 || b.v <= 0) continue;
        const nb = Math.max(a.v, b.v);
        if (x.v >= SPIKE_X * nb && x.v - nb >= SPIKE_SHARE * by[i].tot.get(x.r.fund)) {
          out.push({ k: x.k, v: x.v, d: x.d, p: x.p, prev: a, next: b, code: x.r.code, name: x.r.name, fund: x.r.fund, unit: x.r.unit, od: x.r.od });
        }
      }
    }
    spikeCache.set(kind, out);
    return out;
  }
  // The spikes inside a scope (the Fund selector, and a department or bureau). A bureau page covers all its funds.
  const spikesIn = (kind, scope = {}, k = null) => lineSpikes(kind).filter((s) => (!k || s.k === k)
    && (scope.unit != null ? s.unit === scope.unit : (!S.f || s.fund === D.funds.indexOf(S.f)) && (scope.dept == null || s.od === scope.dept)));
  // "Building Permits brought in $9.03M in 2025 Actual, against $1.34M in 2024 Actual and $1.94M in 2026 Projected"
  function spikeSentence(s, kind) {
    const at = (x) => `${src(mny(x.v), x.k, x.d, x.p)} in ${esc(seriesLabel(x.k))}`;
    return `${S.f ? '' : `${esc(D.funds[s.fund])} `}${esc(s.name)} ${kind === 'revenue' ? 'brought in' : 'came to'} ${at(s)}, against ${at(s.prev)} and ${at(s.next)}`;
  }
  // What the budget book says about that line in that year, where data/line_notes.csv records it (changes.json line_notes).
  const spikeContext = (s) => (CH?.line_notes || [])
    .filter((n) => key(n.year, n.figure) === s.k && n.account === s.code)
    .map((n) => ` ${esc(n.text)} <span class="wc-srcnote">${srcDoc('Budget book', n.d, n.p)}</span>`).join('');
  const spikeNotes = (scope, kind) => spikesIn(kind, scope).map((s) => `<p class="trend-spike"><strong>${esc(String(parseKey(s.k).y))} stands out:</strong> ${spikeSentence(s, kind)}.${spikeContext(s)}</p>`).join('');

  /* What a scope's total is called in a gap note ("General Fund spending", "Public Safety spending"). */
  function trendWhat(scope) {
    const name = scope.unit != null ? unitLabel(scope.unit) : scope.dept != null ? O.departments[scope.dept].name : fn(S.f) || CFG.entity.short;
    const fund = (scope.unit == null && S.f && (scope.dept != null)) ? ` (${fn(S.f)})` : '';
    return `${name}${fund} ${kindWordPlain().toLowerCase()}`;
  }

  /* ---------- Reserve draw: the General Fund's revenue includes money taken from the reserve ----------
     These are the "Fund Balance Reserve" revenue lines (object 499000). The amount is summed from the lines
     of the chosen figure, never typed in. scripts/check_dataset.py checks it against the CSVs and the Reserve Fund page. */
  const isDraw = (r) => /^Fund Balance Reserve/i.test(r.name) && /-499000$/.test(r.code);
  function reserveDraw(k, fundIdx) {
    const l = rows(k).filter((r) => isDraw(r) && (fundIdx == null || r.fund === fundIdx));
    if (!l.length) return null;
    const v = sum(l);
    return v > 0 ? { v, ...firstPage(l) } : null;
  }
  const millions = (n) => `$${(n / 1e6).toFixed(1)}M`;
  /* Where the draw comes from, as the Fund Balance Projection page prints it (D.reserve, from data/processed/fund_balance_*.csv):
     when the page has a "Committed data center revenue" adjustment and that plus the operating deficit equals the draw, the
     draw is shown as its total with the data center part in parentheses. Otherwise null: the total alone, as before.
     check_dataset.py checks both parts against the fund balance CSV and that they add up to the draw. */
  function drawParts(k, drawV) {
    if (!D.reserve || !drawV) return null;
    const { y, m } = parseKey(k), e = resFind(y, m);
    const sur = e?.lines.find((l) => l.t === 'surplus'), dc = e?.lines.find((l) => l.t === 'adjustment' && /data center/i.test(l.l));
    if (!sur || !dc || sur.v >= 0 || dc.v >= 0 || Math.abs(-(sur.v + dc.v) - drawV) > 5) return null;
    return { res: { v: -sur.v, d: e.doc, p: sur.p }, dc: { v: -dc.v, d: e.doc, p: dc.p } };
  }
  // "($1.9M of it from dedicated data center revenue)" and "$4.7M drawn from savings ($1.9M of it from dedicated data center
  // revenue)": the total first, the data center part in parentheses, both linked to the Fund Balance Projection.
  const drawDC = (P, f = millions) => `(${srcDoc(f(P.dc.v), P.dc.d, P.dc.p)} of it from dedicated data center revenue)`;
  const drawSplit = (P, f = millions) => `${srcDoc(f(P.res.v + P.dc.v), P.res.d, P.res.p)} drawn from savings ${drawDC(P, f)}`;
  // Label under a "Fund Balance Reserve" line: which part it is, where its amount matches one.
  function drawLineLabel(k, v) {
    const P = drawParts(k, reserveDraw(k, D.funds.indexOf(DEFAULT_FUND))?.v);
    if (P && Math.abs(v - P.dc.v) < 0.5) return 'Drawn from savings: dedicated data center revenue (Fund Balance Projection)';
    if (P && Math.abs(v - P.res.v) < 0.5) return 'Drawn from savings (Fund Balance Projection)';
    return 'Money drawn from the reserve';
  }
  function drawNote(k) {
    if (!D.reserve) return '';
    const gf = D.funds.indexOf(DEFAULT_FUND);
    if (gf < 0 || S.f !== D.funds[gf]) return ''; // the draw sits in the General Fund; shown on that view
    const dr = reserveDraw(k, gf);
    if (!dr) return '';
    const P = drawParts(k, dr.v);
    return `<p class="draw-note">${P ? `Balanced by ${drawSplit(P)}, as the Fund Balance Projection shows (the budget's “Fund Balance Reserve” lines).` : `Balanced by drawing ${src(millions(dr.v), k, dr.d, dr.p)} from the reserve (the budget's “Fund Balance Reserve” line).`} <a href="${esc(homeHash({ f: D.reserve.name }))}">See the Reserve Fund</a></p>`;
  }
  const ownFunds = () => (isCounty() ? "the County's" : "the City's");
  const andList = (a) => (a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const lineTag = (ai) => ({ charge: `Charged to another of ${ownFunds()} funds`, transfer: `Transfer from another of ${ownFunds()} funds: not counted as income` }[nonIncome(ai)] || '');
  /* Under an income total: what is worth knowing about the change in income. Tax changes for the year in view (City:
     changes.json `policy`, from data/policy_notes.csv, where the scope holds the tax's line; County: the context facts'
     tax increase and rate) and the income lines that changed most against the comparison. Income only: nothing here
     mentions money drawn from savings or transfers, which are not income. */
  const INCOME_TOP = 3;
  // County: "rises from 2.911 to 3.201 mills, a 10% tax increase", from the context facts (null for another year).
  function countyTax(y) {
    if (!isCounty() || !D.context || y !== D.context.year) return null;
    const inc = ctxFact('tax_increase'), now = ctxFact(`millage_${y}`), was = ctxFact(`millage_${y - 1}`);
    return inc && now && was ? `rises from ${ctxLink(was, was.v.toFixed(3))} to ${ctxLink(now, `${now.v.toFixed(3)} mills`)}, a ${ctxLink(inc, `${inc.v}%`)} tax increase` : null;
  }
  /* The Income view's tax-change tiles in "What changed", shaped like the Income change tile: the change with its arrow,
     then the rate before → after. City: changes.json `policy` rows with a rate (rate_from, rate_to, unit) or only a
     change in percent (change_pct); County: the context facts' rates. General Fund or All funds only, where the tax is. */
  function taxTiles(k) {
    if (S.f && S.f !== DEFAULT_FUND) return [];
    const { y, m } = parseKey(k), lbl = esc(seriesLabel(k)), out = [];
    if (isCounty()) {
      const now = D.context && y === D.context.year ? ctxFact(`millage_${y}`) : null, was = now ? ctxFact(`millage_${y - 1}`) : null;
      if (now && was) {
        const mills = (n) => `${n.toFixed(3)} mills`;
        out.push(['Real estate tax', deltaHTML(now.v - was.v, was.v, mills), `${y - 1} ${ctxLink(was, mills(was.v))} → ${lbl} ${ctxLink(now, mills(now.v))}`]);
      }
      return out;
    }
    const ps = (CH?.policy || []).filter((x) => x.year === y && x.figure === m && (x.rate_to != null || x.change_pct != null));
    for (const it of [...new Set(ps.map((x) => x.item))]) {
      const x = ps.find((q) => q.item === it);
      const at = (t) => (x.d != null ? srcDoc(t, x.d, x.p) : t);
      const from = /^user-provided/i.test(x.source) ? '<br><span class="muted">From the city\'s proposal; not printed in the budget book.</span>' : '';
      if (x.rate_to != null) {
        const r = (n) => `${n.toFixed(2)}${x.unit}`;
        out.push([esc(it), deltaHTML(x.rate_to - x.rate_from, x.rate_from, (n) => `${n.toFixed(2)} pts`), `${y - 1} ${r(x.rate_from)} → ${lbl} ${at(r(x.rate_to))}${from}`]);
      } else {
        const d = x.change_pct;
        out.push([esc(it), deltaHTML(d, null, (n) => `${n}%`), d ? `${at(`Rate ${d > 0 ? 'up' : 'down'} ${Math.abs(d)}%`)} from ${y - 1} to the ${lbl}.${from}` : `Rate unchanged from ${y - 1}. ${at(esc(x.text))}${from}`]);
      }
    }
    return out;
  }
  /* Home Rule Charter § 8.08, the 6% limit on tax revenue (budget.json `tax_limit`, scripts/tax_limit.py; City only).
     Each budget made under the charter is tested in the build: its General Fund tax revenue (the lines counted in
     data/tax_limit_lines.csv) against the same book's figure for the year before (config/tax_limit.json). Over the limit:
     ink with a ▲ sign over a 1px ink rule, not ledger red (a legal threshold passed, not a shortfall; never color alone).
     Within it: one calm muted line. Years before the charter's first budget have no test and show nothing. Every flag
     links to the test on How the City budget is made. */
  const TLIM = () => (!isCounty() && D.tax_limit) || null;
  function tlTest(y, m) {
    const T = TLIM(); if (!T) return null;
    const ts = T.tests.filter((t) => t.year === y);
    return ts.find((t) => t.measure === m) || ts.find((t) => t.newest) || null; // an earlier year: its budget as tested
  }
  const tlLabel = (t) => (t.year === D.newest_year ? `${t.year} ${LABEL[t.measure]}` : `${t.year} budget`);
  const tlBase = (t) => `${t.base.year} ${LABEL[t.base.measure]}`;
  const tlScope = () => !S.f || S.f === DEFAULT_FUND; // the General Fund or All funds, where the taxes are
  const tlCite = (s) => (CFG.budget_calendar ? cites(s) : `(§&nbsp;${esc(s)})`);
  const tlSec = (s) => (CFG.budget_calendar ? cite(s, s) : esc(s)); // "Section 13.14", the number linked
  function taxLimitFlag(t) {
    if (!t) return '';
    const T = TLIM(), pct = fmtPct(t.change_pct, true);
    const more = CFG.budget_calendar ? ` <a class="tl-more" href="${esc(eh('budget-calendar?s=cal-limit-test'))}">How this is worked out</a>` : '';
    if (!t.over) return `<p class="tl-flag tl-within">${esc(tlLabel(t))}: within the ${T.limit_pct}% tax revenue limit, ${pct} from ${esc(tlBase(t))}.${more}</p>`;
    const tr = T.transition && T.transition.budget_years.includes(t.year)
      ? `<p class="tl-note">Section ${tlSec(T.transition.section)} may waive the limit for budgets adopted in the charter's first two years, if passed by a simple majority of Council. This site does not say whether it applies to this budget.</p>` : '';
    return `<div class="tl-flag tl-over"><p class="tl-head"><span class="tl-sign" aria-hidden="true">▲</span> Exceeds the ${T.limit_pct}% tax revenue limit</p>
      <p class="tl-sub">Needs a Council waiver vote, majority of the whole Council plus one ${tlCite(T.section)}. In the ${esc(tlLabel(t).replace(/ budget$/, ''))} budget, General Fund tax revenue is up ${fmtPct(t.change_pct)} from ${esc(tlBase(t))}.${more}</p>${tr}</div>`;
  }
  function incomeHighlights(k, scope = {}) {
    if (S.k !== 'revenue' || !series(k)) return '';
    const f = D.funds.indexOf(S.f), all = f < 0;
    const inScope = (r) => isIncome(r, all) && (scope.unit != null || all || r.fund === f) && (scope.dept == null || r.od === scope.dept) && (scope.unit == null || r.unit === scope.unit);
    const cur = rows(k).filter(inScope), codes = new Set(cur.map((r) => r.code)), { y, m } = parseKey(k);
    const out = [];
    // Tax changes
    if (!isCounty() && CH) {
      const ps = (CH.policy || []).filter((x) => x.year === y && x.figure === m && (!x.account || codes.has(x.account)));
      for (const it of [...new Set(ps.map((x) => x.item))]) {
        const x = ps.find((q) => q.item === it);
        const srcTxt = x.d != null ? ` ${srcDoc('Source', x.d, x.p)}` : /^user-provided/i.test(x.source) ? ' <span class="muted">(from the city\'s proposal; not printed in the budget book)</span>' : '';
        out.push(`<strong>${esc(it)}:</strong> ${esc(x.text)}${srcTxt}`);
      }
    }
    if (isCounty() && D.context && y === D.context.year && (all || S.f === DEFAULT_FUND) && scope.dept == null && scope.unit == null) {
      const ct = countyTax(y);
      if (ct) out.push(`<strong>Real estate tax:</strong> the rate ${ct}.`);
    }
    // The income lines that changed most against the comparison
    if (S.c && series(S.c)) {
      const by = new Map();
      const add = (r, side) => { const g = by.get(r.code) || { name: r.name, where: isCounty() ? D.departments[r.dept] : O.units[r.unit].name, sel: null, cmp: null }; if (!g[side]) g[side] = { v: 0, d: r.d, p: r.p }; g[side].v += r.v; by.set(r.code, g); };
      cur.forEach((r) => add(r, 'sel'));
      rows(S.c).filter(inScope).forEach((r) => add(r, 'cmp'));
      const moves = [...by.values()].map((g) => ({ ...g, dv: (g.sel?.v || 0) - (g.cmp?.v || 0) })).filter((g) => Math.round(g.dv) !== 0)
        .sort((a, b) => Math.abs(b.dv) - Math.abs(a.dv)).slice(0, INCOME_TOP);
      const twice = (g) => moves.filter((x) => x.name === g.name).length > 1; // the same name in two departments: say which
      if (moves.length) out.push(`<strong>Largest changes from ${esc(seriesLabel(S.c))}:</strong> ${andList(moves.map((g) => { const at = g.sel ? src(mny(Math.abs(g.dv)), k, g.sel.d, g.sel.p) : src(mny(Math.abs(g.dv)), S.c, g.cmp.d, g.cmp.p); return `${esc(g.name)}${twice(g) ? ` (${esc(g.where)})` : ''} ${g.dv > 0 ? 'up' : 'down'} ${at}${g.sel ? '' : ' (no longer budgeted)'}${g.cmp ? '' : ' (new)'}`; }))}.`);
    }
    return out.length ? `<div class="income-notes">${out.map((t) => `<p class="draw-note">${t}</p>`).join('')}</div>` : '';
  }
  /* Under the "How the Balance Changes" table, where the General Fund's income differs from the projection's Revenues line.
     Income leaves out the draw from savings, as the projection does; the projection's Revenues also count any transfers
     in from the utility funds, which income leaves out. No note when the two agree. */
  function reserveTie(e) {
    const k = key(e.year, e.measure), rev = e.lines.find((l) => l.t === 'revenues');
    if (!rev || !series(k)) return '';
    const gf = D.funds.indexOf(DEFAULT_FUND), gr = rows(k).filter((r) => r.fund === gf);
    const gfT = totalOf(gr.filter((r) => isIncome(r)), k), tr = gr.filter((r) => isRevenue(r) && nonIncome(r.ai) === 'transfer' && r.v);
    const trV = sum(tr), gap = Math.round(rev.v - gfT.v);
    if (Math.abs(gap) <= 5) return '';
    const fp = firstPage(tr), ties = tr.length && Math.abs(rev.v - gfT.v - trV) <= 5;
    const why = ties ? ` The difference is the ${src(mny(trV), k, fp.d, fp.p)} transferred in from the utility funds: the projection counts it as revenue, and this site does not count transfers as income.`
      : ` The difference, ${money(Math.abs(gap))}, is not explained by the budget's lines.`;
    return `<p class="hint tie-note">The ${esc(DEFAULT_FUND)} pages show ${fig(gfT)} of income for ${esc(resLabel(e))}, not the ${srcDoc(money(rev.v), e.doc, rev.p)} on the Revenues line above.${why} <a href="${esc(homeHash({ f: DEFAULT_FUND, k: 'revenue', y: e.year, m: e.measure }))}">See ${esc(DEFAULT_FUND)} income</a></p>`;
  }

  /* ---------- Reserve Fund (General Fund balance) ---------- */
  const resFind = (y, m) => D.reserve.entries.find((e) => e.year === y && e.measure === m);
  const resEnd = (e) => e.lines.find((l) => l.t === 'ending');
  const resLabel = (e) => `${e.year} ${e.measure === 'actual' && e.basis === 'unaudited' ? 'Actual (unaudited)' : LABEL[e.measure]}`;
  const resBookYear = (e) => (D.books.find((b) => b.doc === D.docs[e.doc]) || {}).year;
  // What a source document is called in link titles: a budget book, or (County) a budget resolution or an audited report.
  const docTitle = (d) => {
    const f = D.docs[d], r = (D.reserve?.sources || []).find((x) => x.file === f), a = /^County-ACFR-(\d{4})/.exec(f);
    if (/Presentation\.pdf$/.test(f)) return `${D.context?.year || ''} budget presentation`.trim();
    return r ? `budget resolution (${r.resolution})` : a ? `${a[1]} audited annual report` : docLabel(d);
  };
  const srcDoc = (text, d, p) => `<a class="src" href="${pdfHref(d, p)}" target="_blank" rel="noopener" title="${isCounty() ? `View in the ${esc(docTitle(d))}` : 'View in budget book'}" aria-label="${esc(text)}: open source page in the ${esc(docTitle(d))}">${text}</a>`;
  const RES_STATUS = { actual: 'Actual year-end balance', projected: 'Projected year-end balance', proposed: 'Proposed, not adopted', revised: 'Revised proposal, not adopted' };
  function resChange(e) {
    let base = null, from = '';
    if (e.measure === 'actual') {
      const pe = resFind(e.year - 1, 'actual');
      if (pe) { base = resEnd(pe).v; from = `12/31/${e.year - 1}`; }
    } else {
      const b = e.lines.find((l) => l.t === 'beginning');
      if (b) { base = b.v; from = `12/31/${b.fy}`; }
    }
    if (base == null) return null;
    const d = resEnd(e).v - base;
    return { d, p: pctOf(d, base), from };
  }
  const chgHTML = (c) => (c ? `<span class="${c.d > 0 ? 'up' : c.d < 0 ? 'down' : 'flat'}">${c.d > 0 ? '+' : ''}${money(c.d)}${c.p == null ? '' : `<span class="pct"> (${fmtPct(c.p, true)})</span>`}</span>` : '—');
  const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  /* The 2027 book prints two 12/31/2025 balances. This says which one the site uses and why 2025 jumps. */
  function resAltNote(x) {
    const end = resEnd(x), ch = resChange(x), a = x.alt[0];
    return `The ${resBookYear(x)} book prints two different 12/31/${x.year} balances: ${srcDoc(money(a.v), x.doc, end.p)} in its ${capWord(a.sc)} column and ${srcDoc(money(end.v), x.doc, end.p)} in its ${capWord(x.sc)} column. This site uses ${capWord(x.sc)}${ch && ch.p != null ? `, which is why ${x.year} shows ${fmtPct(ch.p, true)} from ${x.year - 1}` : ''}. ${knownLink()}`;
  }
  function resLineLabel(l, e) {
    if (l.t === 'beginning') return `Beginning balance (12/31/${l.fy})${e.measure === 'proposed' && e.year === D.newest_year ? ', proposed column' : ''}`;
    if (l.t === 'ending') return `Ending balance (12/31/${e.measure === 'actual' ? e.year : l.fy})`;
    if (l.t === 'revenues') return 'Revenues';
    if (l.t === 'expenditures') return 'Expenditures';
    if (l.t === 'surplus') return 'Operating surplus / (deficit)';
    return l.l.replace(/^\((.*)\)$/, '$1');
  }
  const hatch = (color) => {
    const c = document.createElement('canvas'); c.width = c.height = 10;
    const x = c.getContext('2d');
    x.globalAlpha = 0.25; x.fillStyle = color; x.fillRect(0, 0, 10, 10);
    x.globalAlpha = 1; x.strokeStyle = color; x.lineWidth = 2; x.beginPath();
    x.moveTo(0, 10); x.lineTo(10, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(8, 12); x.lineTo(12, 8); x.stroke();
    return x.createPattern(c, 'repeat');
  };
  const resColor = (e) => (e.measure === 'proposed' ? PALETTE[0] : e.measure === 'revised' ? PALETTE[1] : SEL);
  const resSorted = () => D.reserve.entries.slice().sort((a, b) => a.year - b.year || ORDER.indexOf(a.measure) - ORDER.indexOf(b.measure));

  function reserveView() {
    if (isCounty()) return countyBalanceView();
    const e = resFind(S.y, S.m) || resFind(S.y, ORDER.find((m) => resFind(S.y, m)));
    if (!e) return `<header class="page-head"><h1 id="page-h" tabindex="-1">${esc(D.reserve.name)}</h1><p class="muted">No reserve figures for ${S.y}.</p></header>${filtersHTML()}`;
    const end = resEnd(e), ch = resChange(e), name = D.reserve.name;
    document.title = pageTitle(`${name} ${resLabel(e)}`);
    const notices = [];
    if (e.alt) {
      const alts = e.alt.map((a) => `${money(a.v)} (${a.sc} column)`).join(' and ');
      notices.push(`The city's ${resBookYear(e)} budget book prints two different 12/31/${e.year} balances: ${alts} and ${money(end.v)} (${e.sc} column). The ${e.sc} figure, the city's latest, is shown.`);
    }
    // A printed column whose own lines do not add up: the printed lines stay; the note gives the gap (no box).
    const resGap = e.note ? `<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> ${esc(e.note)} The lines are shown as printed. ${knownLink()}</p>` : '';
    const entries = resSorted();
    const colorsLegend = [
      entries.some((x) => x.measure === 'actual') && `<li><i class="sw"></i>Actual</li>`,
      entries.some((x) => x.measure === 'projected') && `<li><i class="sw hatched" style="--c:${SEL}"></i>Projected</li>`,
      entries.some((x) => x.measure === 'proposed') && `<li><i class="sw hatched" style="--c:${PALETTE[0]}"></i>Proposed</li>`,
      entries.some((x) => x.measure === 'revised') && `<li><i class="sw hatched" style="--c:${PALETTE[1]}"></i>Revised</li>`,
    ].filter(Boolean).join('');
    const yrRows = entries.map((x) => {
      const xc = resChange(x), xe = resEnd(x);
      const noteRow = x.alt ? `<tr class="res-note-row"><td colspan="4"><div class="res-note-text"><span class="res-flag">Two balances printed.</span> ${resAltNote(x)}</div></td></tr>` : '';
      return `<tr${x === e ? ' aria-current="true"' : ''}><th scope="row"><a href="${esc(homeHash({ y: x.year, m: x.measure }))}">${x.year}</a></th><td>${esc(x.measure === 'actual' && x.basis === 'unaudited' ? 'Actual (unaudited)' : LABEL[x.measure])}</td><td class="num">${srcDoc(money(xe.v), x.doc, xe.p)}</td><td class="num">${chgHTML(xc)}</td></tr>${noteRow}`;
    }).join('');
    const annot = entries.filter((x) => x.alt).map((x) => `<p class="res-annot"><span class="res-flag">${resChange(x)?.p != null ? fmtPct(resChange(x).p, true) : ''}*</span> ${resAltNote(x)}</p>`).join('');
    const detail = e.lines.length > 1
      ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Line</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${e.lines.map((l) => `<tr><td>${esc(resLineLabel(l, e))}</td><td class="num">${srcDoc(money(l.v), e.doc, l.p)}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="panel-note" style="margin:0 0 12px">For actual years the city's budget book prints only the closing balance.</p><div class="table-scroll"><table class="table"><tbody><tr><td>${esc(resLineLabel(end, e))}</td><td class="num">${srcDoc(money(end.v), e.doc, end.p)}</td></tr></tbody></table></div>`;
    return `<header class="page-head"><h1 id="page-h" tabindex="-1">${esc(name)}: ${esc(resLabel(e))}</h1>
        <p class="big-total"><span class="big-label">Year-end balance</span> ${srcDoc(money(end.v), e.doc, end.p)}</p>
        ${ch && ch.p != null ? `<p class="deck"><span class="${ch.d < 0 ? 'down' : ch.d > 0 ? 'up' : 'flat'}">${ch.d < 0 ? 'Down' : ch.d > 0 ? 'Up' : 'No change'} ${mny(Math.abs(ch.d))} (${fmtPct(Math.abs(ch.p))})</span> from ${esc(ch.from)}.</p>` : ''}
        ${notices.map((n) => `<div class="notice" role="note">${n}</div>`).join('')}${resGap}</header>
      ${filtersHTML()}
      <p class="hint" style="margin-top:0">The General Fund's reserve: the cash balance carried from year to year. ${knownLink()}</p>
      <section class="panel" aria-labelledby="rb-t"><h2 class="panel-title" id="rb-t">Year-End Balance, ${entries[0].year}–${entries[entries.length - 1].year}</h2>
        <ul class="trend-legend" aria-hidden="true">${colorsLegend}</ul>
        <div class="chart-box"><canvas id="res-chart" role="img" aria-label="Year-end General Fund balance by year: ${esc(entries.map((x) => `${x.year} ${LABEL[x.measure]} ${money(resEnd(x).v)}`).join(', '))}. The table below has the values."></canvas></div>${annot}</section>
      <section class="panel" aria-labelledby="rd-t"><h2 class="total-label" id="rd-t">${esc(resLabel(e))}: How the Balance Changes</h2>${detail}${reserveTie(e)}</section>
      <section class="panel" aria-labelledby="ry-t"><h2 class="total-label" id="ry-t">Year-End Balance by Year</h2><div class="table-scroll"><table class="table tight">
        <thead><tr><th scope="col">Year</th><th scope="col">Figure</th><th scope="col" class="num">Year-end balance</th><th scope="col" class="num">Change</th></tr></thead><tbody>${yrRows}</tbody></table></div></section>`;
  }
  function drawReserve() {
    if (isCounty()) { drawCountyBalance(); return; }
    const cv = $('res-chart');
    if (!cv || !window.Chart) return;
    const th = chartTheme(), entries = resSorted(), cur = resFind(S.y, S.m);
    const dup = (y) => entries.filter((x) => x.year === y).length > 1;
    const labels = entries.map((x) => (dup(x.year) ? `${x.year} ${LABEL[x.measure]}` : String(x.year)));
    // Marks the year whose book prints two balances: the change (e.g. "+111.2%*") sits above the bar; the note is under the chart.
    const flag = { id: 'resFlag', afterDatasetsDraw(chart) {
      const m = chart.getDatasetMeta(0), c = chart.ctx;
      entries.forEach((x, i) => {
        if (!x.alt || !m.data[i]) return;
        const ch = resChange(x);
        c.save(); c.font = `700 13px ${Chart.defaults.font.family}`; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(`${ch && ch.p != null ? fmtPct(ch.p, true) : ''}*`, m.data[i].x, m.data[i].y - 6); c.restore();
      });
    } };
    charts.push(new Chart(cv, { type: 'bar', plugins: [flag],
      data: { labels, datasets: [{ data: entries.map((x) => resEnd(x).v),
        backgroundColor: entries.map((x) => (x.measure === 'actual' ? SEL : hatch(resColor(x)))),
        borderColor: entries.map((x) => (x === cur ? INK : resColor(x))), borderWidth: entries.map((x) => (x === cur ? 3 : x.measure === 'actual' ? 0 : 1.5)), borderRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } }, animation: reduceMotion() ? false : { duration: 300 },
        onClick: (_ev, els) => { if (els.length) { const x = entries[els[0].index]; navigate(homeHash({ y: x.year, m: x.measure }), true); } },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { title: (c) => resLabel(entries[c[0].dataIndex]), label: (c) => money(c.raw) } } },
        scales: { x: { ticks: { color: INK, maxRotation: 45 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
  }

  /* ---------- County: General Fund Balance (budget.json `reserve`, scripts/build_county.py build_fund_balance) ----------
     Two measures, shown side by side and never combined. Budget entries come from the budget resolution adopted with each
     year's budget: the General Fund balance at the start of the year, receipts, expenditures and the balance remaining, as
     printed (the planned change, receipts minus expenditures, is calculated and says so). Actual entries are the audited
     balances at December 31 from the annual financial reports (GAAP). The resolution's balances are budget estimates and
     do not tie to the audited ones; a quiet note under each Budget year gives the audited figure for the same date. */
  const cbFind = (y, m) => D.reserve.entries.find((e) => e.year === y && e.measure === m);
  const cbLine = (e, t) => (e ? e.lines.find((l) => l.t === t) : null);
  const cbYears = () => [...new Set(D.reserve.entries.map((e) => e.year))].sort((a, b) => a - b);
  const cbRes = (e) => (D.reserve.sources.find((x) => x.doc === e.doc) || {}).resolution || 'the budget resolution';
  const usDate = (iso) => { const [y, m, d] = iso.split('-'); return `${+m}/${+d}/${y}`; };
  const isEst = (l) => /estimated/i.test(l.l);
  function cbFiltersHTML() {
    const ys = cbYears().slice().reverse();
    const ym = measuresFor(S.y)[0], funds = fundOptions(new Set(ym ? rows(key(S.y, ym)).map((r) => r.fund) : D.funds.map((f, i) => i)), null);
    return selField('f-y', 'y', 'Budget year', ys.map((y) => `<option value="${y}"${y === S.y ? ' selected' : ''}>${y}</option>`).join('')) + selField('f-f', 'f', 'Fund', funds);
  }
  function cbLineLabel(l) {
    const est = isEst(l) ? 'estimated, ' : '';
    if (l.t === 'beginning') return `Balance at the start (${est}${usDate(l.as_of)})`;
    if (l.t === 'encumbrances') return 'Reserve for encumbrances';
    if (l.t === 'revenues') return 'Receipts';
    if (l.t === 'expenditures') return 'Expenditures';
    if (l.t === 'commitments') return 'Prior-year commitments spent this year';
    if (l.t === 'surplus') return l.v < 0 ? 'Planned draw from the balance' : l.v > 0 ? 'Planned addition to the balance' : 'Planned change in the balance';
    if (l.t === 'ending') return `Balance remaining (${est}${usDate(l.as_of)})`;
    return l.l;
  }
  // Under a Budget year: the audited balance at each date the resolution prints, and a resolution balance that equals an
  // audited balance at another date. Worded quietly; the figures are linked, nothing is subtracted.
  function cbTieNote(e) {
    const out = [];
    for (const t of ['beginning', 'ending']) {
      const l = cbLine(e, t);
      if (!l || !l.as_of) continue;
      const y = +l.as_of.slice(0, 4), a = cbLine(cbFind(y, 'actual'), 'ending');
      const same = D.reserve.entries.filter((x) => x.measure === 'actual' && x.year !== y).map((x) => cbLine(x, 'ending')).find((x) => x && x.v === l.v);
      const what = t === 'beginning' ? 'start' : 'end';
      if (same) out.push(`${cbRes(e)} dates its ${what} balance, ${srcDoc(money(l.v), e.doc, l.p)}, ${usDate(l.as_of)}; that equals the audited balance at ${usDate(same.as_of)}.${a ? ` The audited balance at ${usDate(l.as_of)} is ${srcDoc(money(a.v), cbFind(y, 'actual').doc, a.p)}.` : ''}`);
      else if (a) out.push(`The audited balance at ${usDate(l.as_of)} is ${srcDoc(money(a.v), cbFind(y, 'actual').doc, a.p)}.`);
    }
    if (!out.length) return '';
    const ki = e.lines.some((l) => l.known_issue != null);
    return `<p class="draw-note">${out.join(' ')} Budget balances are the County's estimates on its budget basis; audited balances are counted on its accounting basis, so the two are not expected to match.${ki ? ` ${knownLink()}` : ''}</p>`;
  }
  function countyBalanceView() {
    const name = D.reserve.name, ys = cbYears(), y = ys.includes(S.y) ? S.y : ys[ys.length - 1];
    const b = cbFind(y, 'budget'), a = cbFind(y, 'actual'), bEnd = cbLine(b, 'ending'), aEnd = cbLine(a, 'ending');
    document.title = pageTitle(`${name} ${y}`);
    const big = b ? `<p class="big-total"><span class="big-label">Budget: planned balance at ${usDate(bEnd.as_of)}</span> ${srcDoc(money(bEnd.v), b.doc, bEnd.p)}</p>`
      : aEnd ? `<p class="big-total"><span class="big-label">Actual: audited balance at ${usDate(aEnd.as_of)}</span> ${srcDoc(money(aEnd.v), a.doc, aEnd.p)}</p>` : '';
    let deck = '';
    if (b) {
      const sur = cbLine(b, 'surplus'), st = cbLine(b, 'beginning');
      const start = `${cbRes(b)} puts the balance at ${srcDoc(money(st.v), b.doc, st.p)} on ${usDate(st.as_of)}${isEst(st) ? ', an estimate' : ''}`;
      deck = sur.v < 0 ? `The ${y} Budget spends ${mny(-sur.v)} more than it expects to collect <span class="calc-tag">calculated</span> and covers the gap from the General Fund's balance. ${start}.`
        : sur.v > 0 ? `The ${y} Budget expects to collect ${mny(sur.v)} more than it spends <span class="calc-tag">calculated</span>, adding it to the General Fund's balance. ${start}.`
          : `The ${y} Budget expects to collect what it spends. ${start}.`;
    }
    const detail = b ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Line</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${b.lines.map((l) => `<tr><td>${esc(cbLineLabel(l))}${l.calc ? ' <span class="calc-tag">calculated</span>' : ''}</td><td class="num">${l.calc ? money(l.v) : srcDoc(money(l.v), b.doc, l.p)}</td></tr>`).join('')}</tbody></table></div>
        ${(b.footnotes || []).map((f) => `<p class="draw-note">The resolution's footnote: “${esc(f.l.replace(/^\*+\s*/, '')).replace(money(f.v), srcDoc(money(f.v), b.doc, f.p))}”</p>`).join('')}${cbTieNote(b)}`
      : `<p class="panel-note" style="margin:0">This site does not have the budget resolution for ${y}.</p>`;
    const audited = a ? `<div class="table-scroll"><table class="table"><tbody>${a.lines.map((l) => `<tr><td>${l.t === 'ending' ? `General Fund balance at ${usDate(l.as_of)}` : `Of it, ${esc(l.l.toLowerCase())}`}</td><td class="num">${srcDoc(money(l.v), a.doc, l.p)}</td></tr>`).join('')}</tbody></table></div>
        <p class="draw-note">From the County's ${esc(docTitle(a.doc))}, on its accounting (modified accrual) basis. Unassigned is the part not set aside for a particular purpose.</p>`
      : `<p class="panel-note" style="margin:0">No audited balance for ${y} yet.</p>`;
    const cell = (e, t) => { const l = cbLine(e, t); return l ? (l.calc ? money(l.v) : srcDoc(money(l.v), e.doc, l.p)) : '—'; };
    const yrRows = ys.map((x) => { const xb = cbFind(x, 'budget'), xa = cbFind(x, 'actual'); return `<tr${x === y ? ' aria-current="true"' : ''}><th scope="row"><a href="${esc(homeHash({ y: x }))}">${x}</a></th><td class="num">${cell(xb, 'beginning')}</td><td class="num">${cell(xb, 'surplus')}</td><td class="num">${cell(xb, 'ending')}</td><td class="num">${cell(xa, 'ending')}</td></tr>`; }).join('');
    const label = (x, m) => { const l = cbLine(cbFind(x, m), 'ending'); return l ? `${x} ${LABEL[m]} ${money(l.v)}` : null; };
    return `<header class="page-head"><h1 id="page-h" tabindex="-1">${esc(name)}: ${y}</h1>${big}
        ${deck ? `<p class="deck">${deck}</p>` : ''}</header>
      ${filtersHTML()}
      <p class="hint" style="margin-top:0">The General Fund's accumulated balance, carried from year to year. <strong>Budget</strong> figures are the County's plan, from the budget resolution adopted with each year's budget. <strong>Actual</strong> figures are audited year-end balances from the County's annual financial reports. They are counted differently and are shown side by side, never combined. ${knownLink()}</p>
      <section class="panel" aria-labelledby="rb-t"><h2 class="panel-title" id="rb-t">Balance at Year-End, ${ys[0]}–${ys[ys.length - 1]}</h2>
        <ul class="trend-legend" aria-hidden="true"><li><i class="sw hatched" style="--c:${PALETTE[0]}"></i>Budget: planned</li><li><i class="sw"></i>Actual: audited</li></ul>
        <div class="chart-box"><canvas id="res-chart" role="img" aria-label="General Fund balance at year-end: ${esc(ys.flatMap((x) => [label(x, 'budget'), label(x, 'actual')]).filter(Boolean).join(', '))}. The table below has the values."></canvas></div></section>
      <section class="panel" aria-labelledby="rd-t"><h2 class="total-label" id="rd-t">${y} Budget: How the Balance Changes</h2>${detail}</section>
      <section class="panel" aria-labelledby="ra-t"><h2 class="total-label" id="ra-t">${y} Actual: Audited Balance</h2>${audited}</section>
      <section class="panel" aria-labelledby="ry-t"><h2 class="total-label" id="ry-t">Balance by Year</h2><div class="table-scroll"><table class="table tight">
        <thead><tr><th scope="col">Year</th><th scope="col" class="num">Budget: at the start</th><th scope="col" class="num">Budget: planned change <span class="calc-tag">calculated</span></th><th scope="col" class="num">Budget: remaining at year-end</th><th scope="col" class="num">Actual: audited at year-end</th></tr></thead><tbody>${yrRows}</tbody></table></div></section>`;
  }
  function drawCountyBalance() {
    const cv = $('res-chart');
    if (!cv || !window.Chart) return;
    const th = chartTheme(), ys = cbYears();
    const end = (x, m) => cbLine(cbFind(x, m), 'ending')?.v ?? null;
    const ds = (m, label, color, solid) => ({ label, data: ys.map((x) => end(x, m)), backgroundColor: solid ? color : hatch(color),
      borderColor: ys.map((x) => (x === S.y ? INK : color)), borderWidth: ys.map((x) => (x === S.y ? 3 : solid ? 0 : 1.5)), borderRadius: 0 });
    charts.push(new Chart(cv, { type: 'bar',
      data: { labels: ys.map(String), datasets: [ds('budget', 'Budget: planned', PALETTE[0], false), ds('actual', 'Actual: audited', SEL, true)] },
      options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
        onClick: (_ev, els) => { if (els.length) navigate(homeHash({ y: ys[els[0].index] }), true); },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { title: (c) => `${ys[c[0].dataIndex]} ${c[0].dataset.label}`, label: (c) => money(c.raw) } } },
        scales: { x: { ticks: { color: INK }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
  }

  /* Lines grouped by a key, each group with the total shown for it (printed or calculated). */
  function groupTotals(list, keyFn, k) {
    const m = new Map();
    for (const r of list) { const g = keyFn(r); if (!m.has(g)) m.set(g, []); m.get(g).push(r); }
    return new Map([...m].map(([g, l]) => [g, totalOf(l, k)]));
  }
  const allCalc = (ts) => ts.every((t) => !t || !t.x);

  /* Side pie: a pie to the right of a ruled list (departments, bureaus, funds). Slice i is the list's row i, and each
     row carries the slice's swatch, so the list is the pie's key. Rows past PIE_SLICES fold into one grey slice.
     items: [{ label, v, href }] in the list's order. Swatches use the CSS variables, so they follow the theme. */
  const pieVar = (i) => (i < PIE_SLICES ? `--cat-${(i % 8) + 1}` : '--cat-other');
  const pieKey = (i) => `<i class="pie-key" aria-hidden="true" style="background:var(${pieVar(i)})"></i>`;
  const pieTotal = (items) => items.reduce((t, x) => t + Math.max(0, x.v), 0);
  function sidePieHTML(id, caption, items) {
    const total = pieTotal(items);
    if (items.length < 2 || total <= 0) return '';
    const desc = items.filter((x) => x.v > 0).map((x) => `${x.label} ${((x.v / total) * 100).toFixed(1)}%`).join(', ');
    return `<figure class="side-pie"><div class="side-pie-box"><canvas id="${id}" role="img" aria-label="${esc(`${caption}: ${desc}. The list beside it has the amounts.`)}"></canvas></div><figcaption>${esc(caption)}</figcaption></figure>`;
  }
  function drawSidePie(id, items) {
    const cv = $(id);
    if (!cv || !window.Chart) return;
    const th = chartTheme(), total = pieTotal(items);
    const data = items.slice(0, PIE_SLICES).map((x, i) => ({ ...x, v: Math.max(0, x.v), c: PALETTE[i % PALETTE.length] }));
    const rest = items.slice(PIE_SLICES);
    if (rest.length) data.push({ label: `All other (${rest.length})`, v: pieTotal(rest), c: OTHER_COLOR });
    const at = (els) => (els.length ? data[els[0].index] : null);
    charts.push(new Chart(cv, {
      type: 'pie',
      data: { labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.v), backgroundColor: data.map((d) => d.c), borderColor: BG, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
        onClick: (_ev, els) => { const x = at(els); if (x && x.href) navigate(x.href); },
        onHover: (ev, els) => { const x = at(els); ev.native.target.style.cursor = x && x.href ? 'pointer' : 'default'; },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.label}: ${money(c.raw)} (${((c.raw / total) * 100).toFixed(1)}%)` } } } },
    }));
  }

  /* Department / bureau cards: name, share of the whole, and selected-vs-comparison bars. The whole card links.
     Each item's sel/cmp is a total from totalOf(). */
  function cardList(items, { total, k, shareOf, level, notes, keys = false }) {
    const max = Math.max(1, ...items.flatMap((i) => [Math.abs(i.sel?.v || 0), Math.abs(i.cmp?.v || 0)]));
    const bar = (t, cls, label, what) => `<div><div class="bar-label ${cls}"><span>${esc(label)}</span><span>${t ? fig(t, { notes, what }) : '<span class="missing">No figures</span>'}</span></div>
        <div class="track"><div class="fill ${cls}" style="width:${t ? Math.max(0, (t.v / max) * 100) : 0}%"></div></div></div>`;
    return items.map((it, n) => {
      const sh = total > 0 && it.sel ? (it.sel.v / total) * 100 : null;
      const share = sh == null ? '' : `<span class="share">(${sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)}% of ${esc(shareOf)})</span>`;
      return `<li class="card" data-go="${esc(it.href)}"><div class="card-top"><h${level}><a href="${esc(it.href)}">${keys ? pieKey(n) : ''}${esc(it.name)}</a>${share}${it.elected ? `<span class="elected-tag">${esc(it.elected.label)}</span>` : ''}</h${level}>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></div>
        <div class="bars">${S.c ? bar(it.cmp, 'cmp', seriesLabel(S.c), it.name) : ''}${bar(it.sel, 'sel', seriesLabel(k), it.name)}</div></li>`;
    }).join('');
  }

  /* Department ledger: department, comparison, selected figure, signed change and share, as one ruled table.
     Amounts keep their PDF links; the whole row opens the department. The footer is the total shown at the top. */
  function ledgerHTML(items, { total, cmpTotal, k, notes, keys = false }) {
    // A column of departments regrouped to the 2027 org chart is usually all calculated: say so once, in its head.
    const selCalc = allCalc(items.map((i) => i.sel)), cmpCalc = allCalc(items.map((i) => i.cmp));
    const head = (label, calc) => `${esc(label)}${calc ? `<span class="calc-tag calc-head">calculated</span>` : ''}`;
    const body = items.map((i, n) => {
      const sel = i.sel?.v || 0, cmp = i.cmp?.v || 0;
      const sh = total.v > 0 && i.sel ? (sel / total.v) * 100 : null;
      const cell = (t, calc) => (t ? fig(t, { tag: !calc, notes, what: `${i.name} ${kindWordPlain().toLowerCase()}` }) : '<span class="missing">No figures</span>');
      return `<tr data-go="${esc(i.href)}"><th scope="row">${keys ? `<span class="keyed">${pieKey(n)}<a href="${esc(i.href)}">${esc(i.name)}</a></span>` : `<a href="${esc(i.href)}">${esc(i.name)}</a>`}</th>${S.c ? `<td class="num hide-sm">${cell(i.cmp, cmpCalc)}</td>` : ''}<td class="num">${cell(i.sel, selCalc)}</td>${S.c ? `<td class="num">${deltaHTML(sel - cmp, cmp, mny)}</td>` : ''}<td class="num hide-sm">${sh == null ? '' : (sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)) + '%'}</td></tr>`;
    }).join('');
    const foot = (t) => fig(t, { notes, what: `${fn(S.f) || CFG.entity.short} ${kindWordPlain().toLowerCase()}` });
    return `<div class="table-scroll"><table class="table ledger" aria-label="${isCounty() ? 'Groups' : 'Departments'}"><thead><tr><th scope="col">${isCounty() ? 'Group' : 'Department'}</th>${S.c ? `<th scope="col" class="num hide-sm">${head(seriesLabel(S.c), cmpCalc)}</th>` : ''}<th scope="col" class="num">${head(seriesLabel(k), selCalc)}</th>${S.c ? '<th scope="col" class="num">Change</th>' : ''}<th scope="col" class="num hide-sm">Share</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><th scope="row">${isCounty() ? 'All groups' : 'All departments'}</th>${S.c ? `<td class="num hide-sm">${cmpTotal ? foot(cmpTotal) : ''}</td>` : ''}<td class="num">${foot(total)}</td>${S.c ? `<td class="num">${deltaHTML(total.v - (cmpTotal?.v || 0), cmpTotal?.v || 0, mny)}</td>` : ''}<td class="num hide-sm">100%</td></tr></tfoot></table></div>`;
  }

  /* ---------- home ---------- */
  /* "▲ $5.0M (6.1%) vs 2026 Projected": says whether the total is up or down against the comparison. */
  function heroDelta(k, total, cmp) {
    if (!cmp) return '';
    const d = total.v - cmp.v, p = pctOf(d, cmp.v);
    if (!cmp.v && !total.v) return '';
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const txt = Math.round(d) === 0 ? 'No change' : `${mny(Math.abs(d))}${p == null ? '' : ` (${fmtPct(Math.abs(p))})`}<span class="sr-only"> ${d > 0 ? 'higher' : 'lower'}</span>`;
    return `<p class="hero-delta"><span class="${Math.round(d) === 0 ? 'flat' : cls}">${txt}</span> vs ${esc(seriesLabel(S.c))}</p>`;
  }
  /* ---------- County: the General Fund gap, and audited actuals beside the budget ----------
     The County's books print no General Fund balance page, so the gap is revenue minus expense of the printed totals and the
     note says so. Actuals (budget.json `actuals`, from the audited annual reports) exist only for fund totals, General Fund
     revenue by source and General Fund spending by function; they are shown only there, never as a variance and never
     against the ACFR's own "original budget" column. */
  function countyGapParts(k) {
    const gf = D.funds.indexOf('General Fund');
    if (!isCounty() || S.f !== 'General Fund' || gf < 0 || S.k !== 'expense' || !series(k)) return null;
    const ex = totalOf(rows(k).filter((r) => r.fund === gf && !isRevenue(r)), k), rv = totalOf(rows(k).filter((r) => r.fund === gf && isIncome(r)), k);
    const gap = ex.v - rv.v;
    return gap > 0 ? { ex, rv, gap, k } : null;
  }
  // What covers the gap: the year's budget resolution, shown on the General Fund Balance page (null when none is printed).
  const countyGapCover = (k) => { const rb = D.reserve && cbFind(parseKey(k).y, 'budget'); return rb && cbLine(rb, 'ending') ? rb : null; };
  const countyGapLink = (k) => { const rb = countyGapCover(k); return rb ? ` <a class="deck-link" href="${esc(homeHash({ f: D.reserve.name, y: rb.year }))}">See the ${esc(D.reserve.name)}</a>` : ''; };
  // ", spending $9.0M more than it expects to collect, covered from the General Fund's balance". The arithmetic, the
  // resolution and the audited balance are on the General Fund Balance page, which the deck links to.
  const countyGap = (k) => { const g = countyGapParts(k); return g ? `, spending ${mny(g.gap)} more than it expects to collect${countyGapCover(k) ? ", covered from the General Fund's balance" : ''}` : ''; };
  // Only when there is no comparison (so no deck): the same sentence on its own, linked to the General Fund Balance page.
  function countyGapNote(k, hasDeck) {
    const g = countyGapParts(k);
    if (!g || hasDeck) return '';
    return `<p class="draw-note">The ${esc(seriesLabel(k))} spends ${mny(g.gap)} more than it expects to collect${countyGapCover(k) ? ", covered from the General Fund's balance" : ''}.${countyGapLink(k)}</p>`;
  }
  /* County notes as shown: no page numbers, file names as plain words, "Budget" in place of "adopted budget", no
     Actual-versus-Budget percentage, and nothing about the audit report's own Original column (it is not used). */
  const cleanNote = (t) => t
    .replace(/County-ACFR-(\d{4})\.pdf/g, 'the $1 audited report').replace(/County-(\d{4})-Budget-Book\.pdf/g, 'the $1 budget book')
    .replace(/Actual revenue ran [^.]*\.\s*/g, '').replace(/adopted budget/gi, 'Budget').replace(/was adopted/g, 'was passed')
    .replace(/\s*\bpp?\.?\s*\d+(?:\s*[-–]\s*\d+)?/g, '').replace(/\(\s*\)/g, '').replace(/\s+([,.;)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  const noOriginal = (t) => /original/i.test(t);
  const gbHref = (r) => `${CFG.paths.pdfs}ACFR/${encodeURIComponent(r.doc)}#page=${r.p}`;
  const gbLink = (text, r) => `<a class="src" href="${gbHref(r)}" target="_blank" rel="noopener" title="View in the County's audited report" aria-label="${esc(text)}: open source page in the ${r.year} audited annual report">${text}</a>`;

  const actFund = (f) => D.actuals.funds.find((x) => x.book_funds.includes(f));
  const actFigs = (af, y, level) => D.actuals.figures.filter((a) => a.fund === af.fund && a.year === y && a.level === level);
  const actLink = (a, text = money(a.v)) => {
    const flagged = (a.flags || []).length ? `<span class="gap-mark" title="The County's audited report has a known problem with this figure"><span aria-hidden="true">${GAP_SIGN}</span><span class="sr-only"> (known problem with this figure; see the note)</span></span>` : '';
    return `<a class="src" href="${pdfHref(a.doc, a.p)}" target="_blank" rel="noopener" title="View in the County's audited report" aria-label="${esc(text)}: open source page in the ${D.actuals.sources.find((x) => x.doc === a.doc)?.year} audited annual report">${text}</a>${flagged}`;
  };
  const actNote = (a, what, seen) => {
    const out = [];
    for (const f of a.flags || []) {
      if (seen.has(f.known_issue)) continue;
      seen.add(f.known_issue);
      out.push(`<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> <strong>${esc(what)}, ${a.year} Actual:</strong> ${esc(cleanNote(D.known_issues[f.known_issue].note))} ${knownLink()}</p>`);
    }
    return out.join('');
  };
  function actualsHTML() {
    if (!isCounty() || !D.actuals) return '';
    const A = D.actuals, bk = (y) => key(y, 'budget');
    const af = S.f ? actFund(S.f) : null, seen = new Set(), notes = [];
    const fundBudget = (af, y, kind) => {
      const ks = bk(y);
      if (!series(ks)) return '—';
      const ts = af.book_funds.map((f) => { const l = rows(ks).filter((r) => r.fund === D.funds.indexOf(f) && ofKind(r, kind)); return l.length ? totalOf(l, ks) : null; }).filter(Boolean);
      if (!ts.length) return '—';
      return ts.length === 1 ? fig(ts[0]) : `${money(ts.reduce((t, x) => t + x.v, 0))} ${CALC_TAG}`;
    };
    const one = (af, y, section) => actFigs(af, y, 'fund_total').find((a) => a.section === section);
    const trn = (af, y) => actFigs(af, y, 'transfer');
    const cellA = (a, what) => { if (!a) return '—'; const t = actNote(a, what, seen); if (t) notes.push(t); return actLink(a); };
    // Rows: the chosen fund over the years, or every fund for one year when the page shows all funds.
    const yrs = [...new Set([...years(), ...A.years])].filter((y) => series(bk(y)) || A.years.includes(y)).sort((a, b) => b - a);
    const allY = A.years.includes(S.y) ? S.y : Math.max(...A.years);
    const lines = (af ? yrs.map((y) => [String(y), af, y]) : A.funds.map((f) => [fn(f.fund), f, allY]));
    const body = lines.map(([lab, f, y]) => `<tr><th scope="row">${esc(lab)}</th><td class="num">${fundBudget(f, y, 'revenue')}</td><td class="num">${cellA(one(f, y, 'revenue'), `${fn(f.fund)} income`)}</td><td class="num">${fundBudget(f, y, 'expense')}</td><td class="num">${cellA(one(f, y, 'expenditure'), `${fn(f.fund)} spending`)}</td></tr>`).join('');
    const tlines = lines.filter(([, , y]) => A.years.includes(y));
    const hasIn = tlines.some(([, f, y]) => trn(f, y).some((a) => /in$/i.test(a.line))), hasOut = tlines.some(([, f, y]) => trn(f, y).some((a) => /out$/i.test(a.line)));
    const tbody = tlines.map(([lab, f, y]) => { const t = trn(f, y), net = one(f, y, 'net_change'); return `<tr><th scope="row">${esc(lab)}</th>${hasIn ? `<td class="num">${cellA(t.find((a) => /in$/i.test(a.line)), `${fn(f.fund)} transfers in`)}</td>` : ''}${hasOut ? `<td class="num">${cellA(t.find((a) => /out$/i.test(a.line)), `${fn(f.fund)} transfers out`)}</td>` : ''}<td class="num">${cellA(net, `${fn(f.fund)} net change`)}</td></tr>`; }).join('');
    const first = lines[0] && lines[0][1];
    const head = af ? 'Year' : `Fund, ${allY}`;
    const combined = af && af.book_funds.length > 1 ? `<p class="panel-note">${esc(fn(af.fund))} are reported together in the County's audited report, so the Budget figures here add the three funds' printed totals <span class="calc-tag">calculated</span>.</p>` : '';
    let html = `<section class="panel" id="sec-actual" tabindex="-1" aria-labelledby="ac-t"><h2 class="panel-title" id="ac-t">Budget and Actual${af ? `: ${esc(fn(af.fund))}` : ' by Fund'}</h2>
      <p class="panel-note">${esc(A.years[0])} to ${esc(A.years[A.years.length - 1])} Actual is set beside the Budget only where both exist at the same level: the fund's income and spending. ${esc(cleanNote(D.actuals_note[0]))} No difference is calculated, because the two are not on the same footing.</p>
      <details class="values"><summary>About the Actual figures</summary><ul>${D.actuals_note.slice(1).map((t) => cleanNote(t)).filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>${combined}
      <div class="table-scroll"><table class="table ledger" aria-label="Budget and Actual by ${af ? 'year' : 'fund'}"><thead><tr><th scope="col">${esc(head)}</th><th scope="col" class="num">Income: Budget</th><th scope="col" class="num">Income: Actual</th><th scope="col" class="num">Spending: Budget</th><th scope="col" class="num">Spending: Actual</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="panel-note" style="margin-top:12px">Budget income leaves out transfers in from other County funds, as the audited report does. The Budget's spending includes transfers to other funds (the County match), as printed; the audited report counts transfers separately, so they are listed below and not added to the Actual spending.</p>
      <h3 class="wc-h3">Transfers and net change, Actual</h3>
      <div class="table-scroll"><table class="table ledger" aria-label="Actual transfers and net change"><thead><tr><th scope="col">${esc(head)}</th>${hasIn ? '<th scope="col" class="num">Transfers in</th>' : ''}${hasOut ? '<th scope="col" class="num">Transfers out</th>' : ''}<th scope="col" class="num">Net change in fund balance</th></tr></thead><tbody>${tbody}</tbody></table></div>`;
    if (S.f === 'General Fund' && first) {
      const y3 = A.years.slice().sort((a, b) => a - b);
      const lc = (t) => t.toLowerCase();
      // The report capitalises a line differently from year to year ("Public Safety", "Public safety"): one row, named as the newest year prints it.
      const lineSet = (level) => { const m = new Map(); A.figures.filter((a) => a.fund === 'General Fund' && a.level === level).sort((a, b) => a.year - b.year).forEach((a) => m.set(lc(a.line), a.line)); return [...m.values()]; };
      const tot = (section) => (y) => one(first, y, section);
      const tbl = (title, cap, level, totalLabel, totalSection) => `<h3 class="wc-h3">${esc(title)}</h3><div class="table-scroll"><table class="table ledger" aria-label="${esc(cap)}"><thead><tr><th scope="col">${esc(cap)}</th>${y3.map((y) => `<th scope="col" class="num">${y} Actual</th>`).join('')}</tr></thead>
        <tbody>${lineSet(level).map((ln) => `<tr><th scope="row">${esc(ln)}</th>${y3.map((y) => `<td class="num">${cellA(A.figures.find((a) => a.fund === 'General Fund' && a.year === y && a.level === level && lc(a.line) === lc(ln)), `${ln}, ${title.toLowerCase()}`)}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">${esc(totalLabel)}</th>${y3.map((y) => `<td class="num">${cellA(tot(totalSection)(y), totalLabel)}</td>`).join('')}</tr></tfoot></table></div>`;
      html += tbl('General Fund income by source, Actual', 'Source', 'revenue_source', 'Total revenues', 'revenue')
        + tbl('General Fund spending by function, Actual', 'Function', 'function', 'Total expenditures', 'expenditure')
        + `<p class="panel-note" style="margin-top:12px">The Budget is not broken down by source or function the way the audited report is, so no Budget figures are shown beside these.</p>`;
    }
    return html + notes.join('') + '</section>';
  }

  let homePies = []; // [canvas id, items] for the side pies homeView laid out; drawn after render
  function homeView() {
    if (isReserve()) return reserveView();
    const k = key(S.y, S.m);
    const list = scoped(k);
    const total = totalOf(list, k), cmp = S.c && series(S.c) ? totalOf(scoped(S.c), S.c) : null;
    const kindWord = kindWordPlain();
    const scope = S.f ? fn(S.f) : CFG.entity.short;
    document.title = pageTitle(`${scope} ${kindWord}: ${seriesLabel(k)}`);

    const notes = new Map(), what = `${scope} ${kindWord.toLowerCase()}`;
    const selMap = groupTotals(list, (r) => r.od, k), cmpMap = cmp ? groupTotals(scoped(S.c), (r) => r.od, S.c) : new Map();
    const keys = new Set([...selMap.keys(), ...cmpMap.keys()]);
    const items = [...keys].map((d) => ({ id: d, name: O.departments[d].name, href: deptHash(d), sel: selMap.get(d), cmp: cmpMap.get(d) }))
      .sort((a, b) => (b.sel?.v || 0) - (a.sel?.v || 0) || (b.cmp?.v || 0) - (a.cmp?.v || 0));
    const ledgerNotes = new Map();
    const depPie = items.map((i) => ({ label: i.name, v: i.sel?.v || 0, href: i.href }));
    const depPieHTML = sidePieHTML('pie-dep', `Share of ${seriesLabel(k)} ${kindWord.toLowerCase()} by ${isCounty() ? 'group' : 'department'}`, depPie);
    homePies = depPieHTML ? [['pie-dep', depPie]] : [];
    const ledger = items.length ? ledgerHTML(items, { total, cmpTotal: cmp, k, notes: ledgerNotes, keys: !!depPieHTML }) : '<p class="empty">No lines for this selection.</p>';
    const totalHTML = fig(total, { notes, what });
    const flagNote = gapNotes(notes) + (total.x ? '' : missingNote(k, { fund: S.f }));
    // The deck says what a resident came to learn: up or down, by how much, and what covers it. It sits under the total.
    const deck = (() => {
      if (!cmp) return '';
      const d = total.v - cmp.v, p = pctOf(d, cmp.v);
      if (!cmp.v || Math.round(d) === 0) return '';
      // On Income the draw is not part of the total; the income note under the deck says it is left out.
      const gf = D.funds.indexOf(DEFAULT_FUND), dr = D.reserve && gf >= 0 && S.f === D.funds[gf] && S.k !== 'revenue' ? reserveDraw(k, gf) : null;
      if (isCounty()) return `<p class="deck"><span class="${d > 0 ? 'up' : 'down'}">${fn(S.f) ? `${fn(S.f)} ` : ''}${S.k === 'revenue' ? (fn(S.f) ? 'income' : 'Income') : (fn(S.f) ? 'spending' : 'Spending')} ${d > 0 ? 'up' : 'down'} ${mny(Math.abs(d))} (${fmtPct(Math.abs(p))})<span class="sr-only"> ${d > 0 ? 'higher' : 'lower'}</span></span> from the ${esc(seriesLabel(S.c))}${countyGap(k)}.${countyGap(k) ? countyGapLink(k) : ''}</p>`;
      return `<p class="deck"><span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? 'Up' : 'Down'} ${mny(Math.abs(d))} (${fmtPct(Math.abs(p))})<span class="sr-only"> ${d > 0 ? 'higher' : 'lower'}</span></span> from ${esc(seriesLabel(S.c))}${dr ? `, with ${drawParts(k, dr.v) ? drawSplit(drawParts(k, dr.v)) : `${src(millions(dr.v), k, dr.d, dr.p)} drawn from savings`}. <a class="deck-link" href="${esc(homeHash({ f: D.reserve.name }))}">See the Reserve Fund</a>` : '.'}</p>`;
    })();
    // Where the "What changed" panel is shown, its tiles carry the tax changes; otherwise the income highlights
    // (tax changes, largest income changes) sit under the total.
    const wc = homeChangesHTML(), hl = wc ? '' : incomeHighlights(k);
    // Without the What changed panel (an earlier year), the Income view says how that year's budget stood against the
    // 6% tax revenue limit (none before the charter's first budget).
    const tl = !wc && S.k === 'revenue' && tlScope() ? taxLimitFlag(tlTest(S.y, S.m)) : '';
    return `<header class="page-head"><h1 id="page-h">${esc(scope)} ${kindWord}: ${esc(seriesLabel(k))}</h1>
        <p class="big-total"><span class="big-label">${esc(scope)} ${kindWord}</span> ${totalHTML}</p>${flagNote}
        ${deck || `${heroDelta(k, total, cmp)}${S.k === 'revenue' ? '' : drawNote(k)}`}${countyGapNote(k, !!deck)}${hl}${tl}</header>
      <div class="home-flow">${filtersHTML()}
      <div class="overview${wc ? '' : ' overview-single'}">${trendHTML({}, 'Totals by Year')}${wc}</div>
      <section class="panel" id="sec-departments" tabindex="-1" aria-labelledby="dep-t"><h2 class="panel-title" id="dep-t">${isCounty() ? 'Departments by Group' : 'Departments'}</h2>
        <p class="panel-note">${isCounty() ? 'The County\'s departments are grouped as in its budget book. Select a group to see its departments.' : 'Select a department to see its detailed breakdown.'} Amounts open the source page in the budget book.</p>
        ${depPieHTML ? `<div class="with-pie">${ledger}${depPieHTML}</div>` : ledger}${gapNotes(ledgerNotes)}</section>
      <section class="panel" aria-labelledby="re-title"><h2 class="panel-title" id="re-title">Income vs. Spending by Fund: ${esc(seriesLabel(k))}</h2>
        <div class="chart-box"><canvas id="re-chart" role="img" aria-label="Income and spending by fund"></canvas></div>
        <div class="with-pie" id="re-wrap"><div class="table-scroll"><table class="table" id="re-table"></table></div></div></section>${actualsHTML()}${contextHTML()}</div>`;
  }


  /* ---------- County: the budget in context (budget.json `context`, data/county/context_facts.csv) ----------
     Tax rate, assessed value, bond rating, staffing, Capital Improvement Fund and agency grants. Each figure links to the
     primary page that prints it (a resolution, the budget book or the audited report); only staffing rests on the County's
     presentation, and says so. */
  const ctxFacts = () => (isCounty() && D.context ? D.context.facts : []);
  const ctxFact = (id) => ctxFacts().find((f) => f.id === id);
  const ctxLink = (f, text) => srcDoc(text, f.d, f.p);
  const ctxFig = (f, text) => ctxLink(f, text) + (f.kind === 'calculated' ? ` ${CALC_TAG}` : '');
  function contextHTML() {
    const F = ctxFacts();
    if (!F.length || (S.f && S.f !== DEFAULT_FUND)) return '';
    const g = (id) => ctxFact(id), y = D.context.year, P = D.context.presentation;
    const mills = (f) => ctxLink(f, `${f.v.toFixed(3)} mills`);
    const row = (label, cell, note) => `<tr><th scope="row">${label}${note ? `<span class="ctx-note">${esc(note)}</span>` : ''}</th><td class="num">${cell}</td></tr>`;
    const inc = g('tax_increase'), m26 = g('millage_2026'), m25 = g('millage_2025'), av = g('assessed_value'), br = g('bond_rating'), pos = g('positions');
    const cip = [g('cip_total'), g('cip_rollover'), g('cip_2026')];
    const tax = `<table class="table ledger ctx-table" aria-label="Tax rate and standing, ${y}"><tbody>
      ${row(`Tax increase over ${y - 1}`, ctxLink(inc, `${inc.v}%`))}
      ${row('Real estate tax rate', `${mills(m26)}<span class="ctx-from"> from ${ctxLink(m25, `${m25.v.toFixed(3)}`)}</span>`)}
      ${row('Taxable assessed value', ctxLink(av, money(av.v)))}
      ${row('Bond rating (Moody\'s)', ctxLink(br, esc(br.v)), `Maintained during ${br.year}, per the audited report.`)}
      ${row('County staffing positions funded', ctxLink(pos, pos.v.toLocaleString('en-US')), `From the County's ${y} budget presentation only; the budget books and audited reports print no position count.`)}
      </tbody></table>`;
    const capital = `<h3 class="wc-h3">Capital Improvement Fund, ${y}</h3>
      <p class="panel-note">Capital projects are counted apart from the operating budget above.</p>
      <table class="table ledger ctx-table" aria-label="Capital Improvement Fund, ${y}"><tbody>
      ${row('Projects begun in 2025, carried over', ctxFig(cip[1], money(cip[1].v)))}
      ${row(`${y} projects`, ctxFig(cip[2], money(cip[2].v)))}</tbody>
      <tfoot><tr><th scope="row">Total ${y} expense</th><td class="num">${ctxFig(cip[0], money(cip[0].v))}</td></tr></tfoot></table>`;
    const grants = F.filter((f) => f.group === 'agency_grants' && /^grant_\d+$/.test(f.id));
    const gcell = (f) => (f ? ctxLink(f, money(f.v)) : '');
    const gf = (f) => (f.fund === 'General Fund'), tg = g('grants_gf'), ta = g('grants_act13'), tr = g('grants_request'), sc = g('scta');
    const ordered = [...grants.filter(gf), ...grants.filter((f) => !gf(f))];
    const gbody = ordered.map((f) => `<tr><th scope="row">${esc(f.label)}</th><td class="num">${gf(f) ? gcell(f) : ''}</td><td class="num">${gf(f) ? '' : gcell(f)}</td></tr>`).join('');
    const agency = `<h3 class="wc-h3">Agency grants, ${y}</h3>
      <p class="panel-note">Grants to outside agencies. Five are paid from the General Fund; the other five come from the County's Act 13 funds, a separate fund that is not part of the General Fund.</p>
      <div class="table-scroll"><table class="table ledger ctx-table" aria-label="Agency grants, ${y}"><thead><tr><th scope="col">Agency</th><th scope="col" class="num">General Fund</th><th scope="col" class="num">Act 13 funds</th></tr></thead><tbody>${gbody}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num">${ctxLink(tg, money(tg.v))}</td><td class="num">${ctxLink(ta, money(ta.v))}</td></tr>
      <tr><th scope="row">Total request, both</th><td class="num" colspan="2">${ctxLink(tr, money(tr.v))}</td></tr></tfoot></table></div>
      <p class="draw-note">Transit funding for RRTA/SCTA, ${ctxLink(sc, money(sc.v))} from the General Fund, is printed apart from these grants and is not in the totals above.</p>`;
    const hist = F.filter((f) => f.group === 'millage_history').sort((a, b) => a.year - b.year);
    const history = `<h3 class="wc-h3">Real estate tax rate, ${hist[0].year} to ${hist[hist.length - 1].year}</h3>
      <div class="chart-box ctx-chart"><canvas id="ctx-millage" role="img" aria-label="Real estate tax rate in mills, ${hist[0].year} to ${hist[hist.length - 1].year}: ${hist.map((f) => `${f.year} ${f.v.toFixed(3)}`).join(', ')}"></canvas></div>
      ${(() => { const ra = g('reassessment_2018'), rv = g('revenue_2018'); return ra && rv ? `<p class="draw-note">The drop from ${hist[0].v.toFixed(3)} to ${hist[1].v.toFixed(3)} mills in ${ra.year} came with the County's ${ctxLink(ra, 'countywide reassessment')}. A reassessment is meant to raise no extra revenue, so the lower rate was not a tax cut. The County's presentation marks ${ra.year} as ${ctxLink(rv, esc(rv.v))}.</p>` : ''; })()}
      <details class="values"><summary>Show the rate for each year</summary><div class="table-scroll"><table class="table ledger ctx-table" aria-label="Real estate tax rate by year"><thead><tr><th scope="col">Year</th><th scope="col" class="num">Mills</th></tr></thead><tbody>${[...hist].reverse().map((f) => `<tr><th scope="row">${f.year}</th><td class="num">${ctxLink(f, f.v.toFixed(3))}</td></tr>`).join('')}</tbody></table></div></details>`;
    return `<section class="panel" id="sec-context" tabindex="-1" aria-labelledby="cx-t"><h2 class="panel-title" id="cx-t">The ${y} Budget in Context</h2>
      <p class="panel-note">Facts about the ${y} budget from the County's own documents. Each figure opens the page that prints it. The County's ${esc(P.title)} repeats them and is listed on the About page.</p>
      ${tax}${capital}${agency}${history}</section>`;
  }
  function drawContext() {
    const cv = $('ctx-millage');
    if (!cv || !window.Chart) return;
    const hist = ctxFacts().filter((f) => f.group === 'millage_history').sort((a, b) => a.year - b.year), th = chartTheme();
    charts.push(new Chart(cv, { type: 'line',
      data: { labels: hist.map((f) => f.year), datasets: [{ label: 'Mills', data: hist.map((f) => f.v), borderColor: SEL, backgroundColor: SEL, stepped: 'middle', pointRadius: 3, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.raw.toFixed(3)} mills` } } },
        scales: { x: { ticks: { color: th.tick }, grid: { display: false } }, y: { min: 0, max: 4, ticks: { color: th.tick, callback: (n) => n.toFixed(1) }, grid: { color: th.grid }, title: { display: true, text: 'Mills', color: th.tick } } } } }));
  }

  function revExpAfter() {
    const k = key(S.y, S.m);
    const all = rows(k);
    const data = [...new Set(all.map((r) => r.fund))].map((fi) => {
      const fr = all.filter((r) => r.fund === fi), rl = fr.filter((r) => isIncome(r)), el = fr.filter((r) => !isRevenue(r));
      return { raw: D.funds[fi], fund: fn(D.funds[fi]), rev: rl.length ? totalOf(rl, k) : null, exp: el.length ? totalOf(el, k) : null };
    }).sort((a, b) => (b.exp?.v || 0) - (a.exp?.v || 0));
    const vo = (t) => (t ? t.v : 0);
    const th = chartTheme();
    if (window.Chart) {
      charts.push(new Chart($('re-chart'), {
        type: 'bar',
        data: { labels: data.map((d) => d.fund.replace(/ Fund$/, '')), datasets: [
          { label: 'Income', data: data.map((d) => vo(d.rev)), backgroundColor: SEL, borderRadius: 0 },
          { label: 'Spending', data: data.map((d) => vo(d.exp)), backgroundColor: PALETTE[1], borderRadius: 0 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { position: 'bottom', labels: { color: INK, boxWidth: 12, boxHeight: 12 } }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
          scales: { x: { ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } }, y: { ticks: { color: INK }, grid: { display: false } } },
        },
      }));
    }
    const notes = new Map();
    const cell = (d, t, kind) => (t ? fig(t, { notes, what: `${d.fund} ${kind}` }) : '—');
    const dcell = (n) => { const r = Math.round(n); return `<span class="${r > 0 ? 'up' : r < 0 ? 'down neg' : 'flat'}">${money(n)}</span>`; };
    const allRev = all.filter((r) => isIncome(r, true)), allExp = all.filter((r) => !isRevenue(r));
    const tRev = totalOf(allRev, k), tExp = totalOf(allExp, k);
    // Pie beside the fund table: each fund's share of the spending (or income, on the Income tab) of all the funds listed.
    const pieItems = data.map((d) => ({ label: d.fund, v: vo(S.k === 'revenue' ? d.rev : d.exp), href: homeHash({ f: d.raw }) }));
    const fundPie = sidePieHTML('pie-fund', `Share of ${seriesLabel(k)} ${S.k === 'revenue' ? 'income' : 'spending'} by fund`, pieItems);
    if (fundPie) $('re-wrap').insertAdjacentHTML('beforeend', fundPie);
    $('re-table').innerHTML = `<thead><tr><th scope="col">Fund</th><th scope="col" class="num">Income</th><th scope="col" class="num">Spending</th><th scope="col" class="num">Income minus spending</th></tr></thead>
      <tbody>${data.map((d, n) => `<tr><th scope="row">${fundPie ? `<span class="keyed">${pieKey(n)}<span>${esc(d.fund)}</span></span>` : esc(d.fund)}</th><td class="num">${cell(d, d.rev, 'income')}</td><td class="num">${cell(d, d.exp, 'spending')}</td><td class="num">${dcell(vo(d.rev) - vo(d.exp))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>All funds</td><td class="num">${fig(tRev)}</td><td class="num">${fig(tExp)}</td><td class="num">${dcell(tRev.v - tExp.v)}</td></tr></tfoot>`;
    const chg = all.filter((r) => isRevenue(r) && nonIncome(r.ai) === 'charge' && r.v);
    const reNote = chg.length ? `<p class="panel-note" style="margin-top:12px">Each fund's income includes what it charges ${ownFunds()} other funds for services; the All funds total leaves out that ${src(mny(sum(chg)), k, firstPage(chg).d, firstPage(chg).p)}, because the paying fund's income already counts it. <a href="${termHref('term-income')}">What counts as income</a></p>` : '';
    $('re-wrap').insertAdjacentHTML('afterend', gapNotes(notes) + reNote);
    if (fundPie) drawSidePie('pie-fund', pieItems);
  }

  /* ---------- department / bureau pages ---------- */
  function pieSection(title, groups, { clickable, note, k, secId = '' } = {}) {
    const total = groups.reduce((t, g) => t + Math.max(0, g.total), 0);
    if (!groups.length || total <= 0) return '';
    const items = groups.map((g) => {
      const body = `<span class="nm" title="${esc(g.label)}">${esc(g.label)}</span><span class="vl">${clickable ? money(g.total) : src(money(g.total), k, g.d, g.p)} (${((g.total / total) * 100).toFixed(1)}%)${g.sub ? ' · ' + esc(g.sub) : ''}</span>`;
      return `<li><i class="sw" style="background:${g.color}"></i><div class="body">${clickable && g.href ? `<a href="${esc(g.href)}">${body}</a>` : body}</div></li>`;
    }).join('');
    const id = `pie-${slug(title)}`;
    return `<section class="panel"${secId ? ` id="${secId}" tabindex="-1"` : ''} aria-labelledby="${id}-t"><h2 class="panel-title" id="${id}-t">${esc(title)}</h2>${note ? `<p class="panel-note">${esc(note)}</p>` : ''}
      <div class="pie-wrap"><div class="pie-box"><canvas id="${id}" role="img" aria-label="${esc(title)}: ${esc(groups.slice(0, 6).map((g) => `${g.label} ${money(g.total)}`).join(', '))}"></canvas></div>
      <ul class="legend-list${groups.length > 6 ? ' scroll" tabindex="0" aria-label="' + esc(title) + ' legend, scrollable' : ''}">${items}</ul></div></section>`;
  }
  /* Categories as a ruled table with an inline bar for each share, the same grammar as the department ledger. */
  function categorySection(title, groups, { k, secId = '' } = {}) {
    const total = groups.reduce((t, g) => t + Math.max(0, g.total), 0);
    if (!groups.length || total <= 0) return '';
    const id = `cat-${slug(title)}`;
    const rows = groups.map((g) => { const sh = (Math.max(0, g.total) / total) * 100; return `<tr><th scope="row">${esc(g.label)}${g.sub ? `<span class="sub">${esc(g.sub)}</span>` : ''}</th><td class="num">${src(money(g.total), k, g.d, g.p)}</td><td class="num share-cell"><span class="share-bar" aria-hidden="true"><i style="width:${sh.toFixed(1)}%"></i></span><span class="share-n">${sh.toFixed(1)}%</span></td></tr>`; }).join('');
    return `<section class="panel"${secId ? ` id="${secId}" tabindex="-1"` : ''} aria-labelledby="${id}-t"><h2 class="panel-title" id="${id}-t">${esc(title)}</h2>
      <div class="table-scroll"><table class="table ledger cat-table" aria-label="${esc(title)}"><thead><tr><th scope="col">Category</th><th scope="col" class="num">${esc(seriesLabel(k))}<span class="calc-tag calc-head">calculated</span></th><th scope="col" class="num">Share</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  function drawPie(title, groups) {
    const cv = $(`pie-${slug(title)}`);
    if (!cv || !window.Chart) return;
    const th = chartTheme(), total = groups.reduce((t, g) => t + Math.max(0, g.total), 0);
    // Slices beyond the first seven fold into one grey "other" slice; the legend still lists every item.
    const shown = groups.slice(0, PIE_SLICES), rest = groups.slice(PIE_SLICES);
    const data = shown.map((g) => ({ label: g.label, v: Math.max(0, g.total), c: g.color }));
    if (rest.length) data.push({ label: `All other (${rest.length})`, v: rest.reduce((t, g) => t + Math.max(0, g.total), 0), c: OTHER_COLOR });
    charts.push(new Chart(cv, {
      type: 'pie',
      data: { labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.v), backgroundColor: data.map((d) => d.c), borderColor: SURFACE, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.label}: ${money(c.raw)} (${((c.raw / total) * 100).toFixed(1)}%)` } } } },
    }));
  }

  function categoryGroups(selRows, cmpRows) {
    const by = (l) => aggregate(l, (r) => r.cat, (r) => D.categories[r.cat]);
    const s = by(selRows), c = by(cmpRows);
    return [...new Set([...s.keys(), ...c.keys()])].map((i) => ({ idx: i, label: D.categories[i], total: s.get(i)?.total || 0, cmpTotal: c.get(i)?.total || 0, color: catColor(i), d: s.get(i)?.d, p: s.get(i)?.p, cd: c.get(i)?.d, cp: c.get(i)?.p }))
      .sort((a, b) => b.total - a.total || b.cmpTotal - a.cmpTotal);
  }

  let cmpTab = 'vs'; // Compare panel: "vs" (this year against the comparison) or "time" (totals by year)
  const crumbsHTML = (items) => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map((c, i) => (c.href
    ? `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`
    : `<li aria-current="page">${esc(c.label)}</li>`)).join('')}</ol></nav>`;
  /* In-page links (hash routing, so the data-scroll pattern, not href="#id"). */
  const jumpNav = (items) => `<nav class="jump" aria-label="On this page"><ul>${items.map(([id, label]) => `<li><a href="${esc(location.hash || '#/')}" data-scroll="${id}">${esc(label)}</a></li>`).join('')}</ul></nav>`;

  /* ---------- Staff: budgeted positions and salary spending by year ----------
     Positions come from each book's staffing schedule (staffing.json). The city publishes budgeted positions only,
     never actual headcount, so every year is "budgeted"; the newest book prints Proposed and Revised schedules.
     Salaries are the "Salaries & Wages" budget lines (salaries, overtime, temporary wages) and follow the site's
     one-figure-per-year rule: Actual, Projected, then Proposed and Revised, then the city's projections (muted). Positions are placed in org-chart
     bureaus by org code (O.codes), the same way as the budget lines. */
  let ST = null;
  function staffHTML(scope) {
    if (!ST || S.k === 'revenue') return '';
    const inScope = (u) => (scope.unit != null ? u === scope.unit : O.units[u].dept === scope.dept);
    const fsel = scope.unit == null && S.f ? S.f : null; // a bureau page shows all of its funds, as elsewhere
    // Positions: unit -> column -> { n, d, p }
    const pcols = ST.books.map((b) => ({ k: `${b.year}|${b.measure}`, label: b.measure === 'budgeted' ? String(b.year) : `${b.year} ${LABEL[b.measure]}`, b }));
    const pos = new Map();
    for (const c of pcols) {
      const d = D.docs.indexOf(c.b.doc);
      for (const x of c.b.positions) {
        const u = O.codes[x[3]];
        if (u == null || !inScope(u) || (fsel && ST.units[x[0]][0] !== fsel)) continue;
        if (!pos.has(u)) pos.set(u, new Map());
        const cell = pos.get(u).get(c.k) || { n: 0, d, p: x[7] };
        cell.n += x[5]; cell.p = Math.min(cell.p, x[7]);
        pos.get(u).set(c.k, cell);
      }
    }
    // Salaries & wages: unit -> series key -> { v, d, p }
    const cat = D.categories.indexOf('Salaries & Wages');
    const scols = [];
    for (const y of years().slice().sort((a, b) => a - b)) for (const m of ORDER) if (series(key(y, m))) scols.push(key(y, m));
    for (const y of projectionYears()) scols.push(key(y, 'projection')); // the city's projections, after the newest year
    const sal = new Map();
    for (const k of scols) {
      for (const r of scoped(k, { ...scope, kind: 'expense' })) {
        if (r.cat !== cat || !inScope(r.unit)) continue;
        if (!sal.has(r.unit)) sal.set(r.unit, new Map());
        const cell = sal.get(r.unit).get(k) || { v: 0, d: r.d, p: r.p };
        cell.v += r.v; if (r.d === cell.d && r.p < cell.p) cell.p = r.p;
        sal.get(r.unit).set(k, cell);
      }
    }
    const ids = [...new Set([...pos.keys(), ...sal.keys()])];
    if (!ids.length) return '';
    const last = pcols[pcols.length - 1]?.k;
    ids.sort((a, b) => (pos.get(b)?.get(last)?.n || 0) - (pos.get(a)?.get(last)?.n || 0) || (O.units[a].name < O.units[b].name ? -1 : 1));
    const multi = scope.unit == null && ids.length > 1;
    const rowHead = (u) => (scope.unit == null && O.departments[O.units[u].dept].bureaus ? `<a href="${esc(unitHash(u))}">${esc(unitLabel(u, 'expense'))}</a>` : esc(unitLabel(u, 'expense')));
    const pdfLink = (text, d, p) => (d >= 0 && d != null ? `<a class="src" href="${pdfHref(d, p)}" target="_blank" rel="noopener" title="View in budget book">${text}</a>` : text);
    const sumCol = (m, k, f) => { let t = 0, any = false; for (const u of ids) { const c = m.get(u)?.get(k); if (c) { t += f(c); any = true; } } return any ? t : null; };
    const table = (caption, cols, m, cell, total) => `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}, scrollable"><table class="table tight staff-table" aria-label="${esc(caption)}">
      <thead><tr><th scope="col">${scope.unit == null ? 'Bureau' : ''}</th>${cols.map((c) => `<th scope="col" class="num${pc(c)}">${c.label.split(' ').map(esc).join('<br>')}</th>`).join('')}</tr></thead>
      <tbody>${ids.map((u) => `<tr><th scope="row">${rowHead(u)}</th>${cols.map((c) => `<td class="num${pc(c)}">${cell(m.get(u)?.get(c.k), c.k)}</td>`).join('')}</tr>`).join('')}</tbody>
      ${multi ? `<tfoot><tr><th scope="row">All</th>${cols.map((c) => `<td class="num${pc(c)}">${total(c.k)}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
    const pc = (c) => (isProjKey(c.k) ? ' proj-col' : '');
    const dash = '<span class="missing" title="Not in this year\'s schedule">—</span>';
    const posTable = table('Budgeted positions by year', pcols, pos,
      (c) => (c ? pdfLink(fmtN(c.n), c.d, c.p) : dash),
      (k) => { const t = sumCol(pos, k, (c) => c.n); return t == null ? dash : fmtN(t); });
    const salCols = scols.map((k) => ({ k, label: seriesLabel(k) }));
    const salTable = table('Salaries and wages by year', salCols, sal,
      (c, k) => (c ? src(mny(c.v), k, c.d, c.p) : dash),
      (k) => { const t = sumCol(sal, k, (c) => c.v); return t == null ? dash : mny(t); });
    // Titles in the newest schedule (bureau pages only).
    let titles = '';
    if (scope.unit != null && last) {
      const b = pcols[pcols.length - 1].b, by = new Map();
      for (const x of b.positions) {
        if (O.codes[x[3]] !== scope.unit) continue;
        const t = ST.titles[x[1]], g = by.get(t) || { n: 0, s: 0, ft: new Set() };
        g.n += x[5]; g.s += x[6]; if (x[2]) g.ft.add(x[2]); by.set(t, g);
      }
      if (by.size) titles = `<details class="values"><summary>Positions in ${esc(pcols[pcols.length - 1].label)} (${by.size} titles)</summary><div class="table-scroll"><table class="table tight"><thead><tr><th scope="col">Title</th><th scope="col">Full or part time</th><th scope="col" class="num">Positions</th><th scope="col" class="num">Salaries</th></tr></thead>
        <tbody>${[...by].sort((a, b) => b[1].s - a[1].s).map(([t, g]) => `<tr><td>${esc(t)}</td><td>${esc([...g.ft].join(', ') || 'Not printed')}</td><td class="num">${fmtN(g.n)}</td><td class="num">${money(g.s)}</td></tr>`).join('')}</tbody></table></div></details>`;
    }
    const where = fsel ? ` in the ${esc(fsel)}` : '';
    return `<section class="panel" id="sec-staff" tabindex="-1" aria-labelledby="st-t"><h2 class="panel-title" id="st-t">Staff</h2>
      <h3 class="wc-h3">Budgeted positions${where}</h3>
      <p class="panel-note">From each year's staffing schedule. The city publishes budgeted positions, not how many people were actually employed. Fractions are positions shared with other bureaus or funds. Counts open the schedule page in the budget book.</p>
      ${posTable}${titles}
      <h3 class="wc-h3">Salaries and wages${where}</h3>
      <p class="panel-note">The “Salaries &amp; Wages” budget lines (salaries, overtime and temporary wages; benefits are separate): Actual through 2025, Projected for 2026, Proposed and Revised for 2027${projectionYears().length ? `, then the city's projections for ${projectionYears().join(' and ')}` : ''}.</p>
      ${salTable}</section>`;
  }

  const bdWord = () => (S.k === 'revenue' ? 'Revenue' : isCounty() ? 'Spending' : 'Budget'); // "Total Budget" on a City department page; the County's figure is already called Budget
  function entityView({ title, subtitle, selRows, cmpRows, crumbs, bureauList = '', changes = '', deptPicker, scope, about = '' }) {
    const k = key(S.y, S.m), kindWord = bdWord();
    const selT = totalOf(selRows, k), cmpT = S.c ? totalOf(cmpRows, S.c) : null;
    const total = selT.v, cmpTotal = cmpT ? cmpT.v : 0;
    const notes = new Map(), what = trendWhat(scope);
    const totalLink = fig(selT, { notes, what }), cmpLink = cmpT ? fig(cmpT, { notes, what }) : '';
    const headNotes = gapNotes(notes) + (selT.x ? '' : missingNote(k, { fund: scope.unit == null ? S.f : '', ...scope }));
    const cats = categoryGroups(selRows, cmpRows);
    const withColor = (g, i) => ({ ...g, color: g.color || (i < PIE_SLICES ? PALETTE[i] : OTHER_COLOR) });
    const chg = (a, b) => { const d = a - b, p = pctOf(d, b); return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${money(d)}${p == null ? '' : `<span class="pct"> (${fmtPct(p)})</span>`}</span>`; };

    let html = crumbsHTML(crumbs);
    if (deptPicker) html += `<div class="field dept-picker"><label class="field-label" for="dept-pick">Department</label>${deptPicker}</div>`;
    html += `<header><h1 class="dept-name" id="page-h" tabindex="-1">${esc(title)}</h1>
      <p class="dept-total">Total ${kindWord}: <strong class="figure">${totalLink}</strong></p>${headNotes}${incomeHighlights(k, scope)}<p class="dept-sub">${subtitle}</p></header>${about}`;

    // One Compare panel holds what used to be five: the two totals, the change, the category bars and the totals by year.
    let compare = '';
    if (cats.length) {
      const vsLabel = S.c ? 'This year vs. comparison' : 'By category';
      const tabBtn = (id, label) => `<button type="button" role="tab" id="cmp-tab-${id}" aria-selected="${cmpTab === id}" aria-controls="cmp-pane-${id}" tabindex="${cmpTab === id ? 0 : -1}" data-pane-tab="${id}">${label}</button>`;
      const stats = `<dl class="cmp-stats">${S.c ? `<div><dt>${esc(seriesLabel(S.c))}</dt><dd>${cmpLink}</dd></div>` : ''}<div><dt>${esc(seriesLabel(k))}</dt><dd>${totalLink}</dd></div>${S.c ? `<div><dt>Change</dt><dd>${chg(total, cmpTotal)}</dd></div>` : ''}</dl>`;
      const table = `<details class="values"><summary>Show as a table</summary><div class="table-scroll"><table class="table tight">
        <thead><tr><th scope="col">Category</th>${S.c ? `<th scope="col" class="num">${esc(seriesLabel(S.c))}<span class="calc-tag calc-head">calculated</span></th>` : ''}<th scope="col" class="num">${esc(seriesLabel(k))}<span class="calc-tag calc-head">calculated</span></th>${S.c ? '<th scope="col" class="num">Change</th>' : ''}</tr></thead>
        <tbody>${cats.map((g) => `<tr><td>${esc(g.label)}</td>${S.c ? `<td class="num">${src(money(g.cmpTotal), S.c, g.cd, g.cp)}</td>` : ''}<td class="num">${src(money(g.total), k, g.d, g.p)}</td>${S.c ? `<td class="num">${chg(g.total, g.cmpTotal)}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
      compare = `<section class="panel compare" id="sec-compare" tabindex="-1" aria-labelledby="cmp-t"><h2 class="panel-title" id="cmp-t">Compare</h2>
        <div class="cmp-tabs" role="tablist" aria-label="Compare view">${tabBtn('vs', vsLabel)}${tabBtn('time', 'Over time')}</div>
        <div class="cmp-pane" id="cmp-pane-vs" role="tabpanel" aria-labelledby="cmp-tab-vs"${cmpTab === 'vs' ? '' : ' hidden'}>${stats}
          <div class="chart-scroll"><div class="chart-box"><canvas id="yoy-chart" role="img" aria-label="${esc(title)} by category, ${esc(S.c ? seriesLabel(S.c) + ' compared with ' : '')}${esc(seriesLabel(k))}"></canvas></div></div>${table}</div>
        <div class="cmp-pane" id="cmp-pane-time" role="tabpanel" aria-labelledby="cmp-tab-time"${cmpTab === 'time' ? '' : ' hidden'}>${trendHTML(scope, '', { bare: true })}</div></section>`;
    }
    const hasChanges = changes.includes('id="sec-changes"'), hasBureaus = bureauList.includes('id="sec-bureaus"');
    const staff = staffHTML(scope);
    const nav = [hasChanges && ['sec-changes', 'What changed'], cats.length && ['sec-compare', 'Compare'], hasBureaus && ['sec-bureaus', isCounty() ? 'Departments' : 'Bureaus'], staff && ['sec-staff', 'Staff'], cats.length && ['sec-categories', 'Categories'], ['sec-lines', 'Line items']].filter(Boolean);
    html += jumpNav(nav);
    html += `<div class="entity-flow">${filtersHTML({ fund: !!deptPicker, scope })}${changes}${compare}${bureauList}${staff}`;
    html += categorySection(`${title} ${seriesLabel(k)} ${kindWord} Breakdown`, cats.map(withColor), { k, secId: 'sec-categories' });
    html += `<section class="panel" id="sec-lines" tabindex="-1" aria-labelledby="li-t"><h2 class="total-label" id="li-t">Line Items</h2><div id="li-holder"></div></section></div>`;
    return { html, cats };
  }

  const alpha = (hex, a) => { const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function entityCharts(selRows, cmpRows, cats) {
    const k = key(S.y, S.m), th = chartTheme();
    drawPie(`${$('page-h').textContent} ${seriesLabel(k)} ${bdWord()} Breakdown`, cats);
    drawTrend();
    const yoy = $('yoy-chart');
    if (yoy && window.Chart) {
      const ds = [];
      // The comparison bar is lighter than the selected one, so the amber never outweighs the blue.
      if (S.c) ds.push({ label: seriesLabel(S.c), data: cats.map((g) => g.cmpTotal), backgroundColor: alpha(CMP, 0.8), borderColor: CMP, borderWidth: 1, borderRadius: 0 });
      ds.push({ label: seriesLabel(k), data: cats.map((g) => g.total), backgroundColor: SEL, borderRadius: 0 });
      // On phones the categories run down the side, so every one is visible without sideways scrolling.
      const narrow = matchMedia('(max-width: 767px)').matches;
      if (narrow) yoy.parentElement.style.height = `${Math.max(240, cats.length * (S.c ? 76 : 48) + 72)}px`;
      const valAxis = { ticks: { color: th.tick, font: { size: 13 }, callback: (n) => short(n) }, grid: { color: th.grid } };
      const catAxis = { ticks: { color: INK, font: { size: 13 } }, grid: narrow ? { display: false } : { color: th.grid } };
      // Long category names wrap onto lines of about 16 characters so none is cut off at the left edge.
      const wrap = (t) => t.split(' ').reduce((ls, w) => { const l = ls[ls.length - 1]; if (l && (l + ' ' + w).length <= 16) ls[ls.length - 1] = l + ' ' + w; else ls.push(w); return ls; }, []);
      charts.push(new Chart(yoy, { type: 'bar', data: { labels: cats.map((g) => (narrow ? wrap(g.label) : g.label)), datasets: ds },
        options: { indexAxis: narrow ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { position: 'bottom', align: 'end', labels: { color: INK, boxWidth: 12, boxHeight: 12, font: { size: 13 } } }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
          scales: narrow ? { x: valAxis, y: catAxis } : { x: catAxis, y: valAxis } } }));
    }
  }

  /* line-item table (sortable, searchable) */
  /* One entry per budget line, whichever year(s) it appears in. The header and the table both count these. */
  function mergeLines(selRows, cmpRows) {
    const map = new Map(), seen = { sel: new Map(), cmp: new Map() };
    const put = (r, slot) => {
      const base = `${r.code}::${r.fund}`, n = seen[slot].get(base) || 0;
      seen[slot].set(base, n + 1);
      const id = `${base}::${n}`;
      let e = map.get(id);
      if (!e) { e = { code: r.code, name: r.name, fund: r.fund, bureau: r.bureau, cat: r.cat }; map.set(id, e); }
      if (slot === 'sel') { e.name = r.name; e.bureau = r.bureau; e.cat = r.cat; }
      e[slot] = r;
    };
    cmpRows.forEach((r) => put(r, 'cmp')); selRows.forEach((r) => put(r, 'sel'));
    return [...map.values()];
  }
  // "97 line items (1 only in 2026 Projected)": every line in the table, and how many exist only in the comparison year.
  function lineCountText(selRows, cmpRows, all = mergeLines(selRows, cmpRows)) {
    const only = S.c ? all.filter((e) => !e.sel).length : 0;
    return `${all.length.toLocaleString()} line item${all.length === 1 ? '' : 's'}${only ? ` (${only.toLocaleString()} only in ${seriesLabel(S.c)})` : ''}`;
  }
  let lastList = [];
  function lineTable(selRows, cmpRows, showBureau) {
    const k = key(S.y, S.m);
    const all = mergeLines(selRows, cmpRows);
    let list = all;
    const q = T.q.trim().toLowerCase();
    if (q) list = list.filter((e) => `${e.code} ${e.name} ${bureauName(e.bureau)} ${fn(D.funds[e.fund])} ${D.categories[e.cat]}`.toLowerCase().includes(q));
    const val = (e, s) => (e[s] ? e[s].v : 0);
    const sorters = { code: (e) => e.code, name: (e) => e.name.toLowerCase(), cat: (e) => D.categories[e.cat], sel: (e) => val(e, 'sel'), cmp: (e) => val(e, 'cmp'), chg: (e) => val(e, 'sel') - val(e, 'cmp') };
    const f = sorters[T.sort] || sorters.sel;
    list.sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * T.dir; });
    const th = (id, label, cls = '') => `<th scope="col" class="${cls}" aria-sort="${T.sort === id ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${id}">${label}</button></th>`;
    const body = list.slice(0, T.shown).map((e, i) => {
      const d = val(e, 'sel') - val(e, 'cmp');
      const sub = [e.code, showBureau ? bureauName(e.bureau) : ''].filter(Boolean).map(esc).join(' · ');
      const draw = /^Fund Balance Reserve/i.test(e.name) && /-499000$/.test(e.code) ? `<span class="sub">${esc(drawLineLabel(e.sel ? k : S.c, (e.sel || e.cmp).v))}</span>` : lineTag(e.ai) ? `<span class="sub line-tag">${esc(lineTag(e.ai))}</span>` : '';
      return `<tr><td><button type="button" class="li-toggle" data-li="${i}" aria-expanded="false" aria-controls="li-hist-${i}">${esc(e.name)}</button><span class="sub">${sub}</span>${draw}</td><td class="hide-sm">${esc(D.categories[e.cat])}</td>
        ${S.c ? `<td class="num">${e.cmp ? src(money(e.cmp.v), S.c, e.cmp.d, e.cmp.p) : '—'}</td>` : ''}<td class="num">${e.sel ? src(money(e.sel.v), k, e.sel.d, e.sel.p) : '—'}${S.c && d !== 0 ? `<span class="chg-sm ${d > 0 ? 'up' : 'down'}" aria-label="Change from ${esc(seriesLabel(S.c))}: ${money(d)}">${money(d)}</span>` : ''}</td>
        ${S.c ? `<td class="num hide-sm"><span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d === 0 ? '—' : money(d)}</span></td>` : ''}</tr>`;
    }).join('');
    // Footer: the page's total (printed where the book prints one) unless a search narrows the lines.
    const ft = (rowsIn, kk) => (q ? { v: rowsIn.reduce((t, r) => t + r.v, 0), x: null, k: kk, d: null } : totalOf(rowsIn, kk));
    const fSel = ft(list.filter((e) => e.sel).map((e) => e.sel), k), fCmp = S.c ? ft(list.filter((e) => e.cmp).map((e) => e.cmp), S.c) : null;
    const ts = fSel.v, tc = fCmp ? fCmp.v : 0;
    const left = list.length - T.shown;
    lastList = list;
    return `<div class="table-tools"><label class="sr-only" for="li-search">Search line items</label>
        <input type="search" id="li-search" placeholder="Search line items, account numbers…" value="${esc(T.q)}" autocomplete="off">
        <button type="button" class="btn btn-outline export-btn" data-export>Export this view (CSV)</button>
        <span class="count" aria-live="polite">${q ? `${list.length.toLocaleString()} matching of ${all.length.toLocaleString()} line items` : lineCountText(selRows, cmpRows, all)}</span></div>
      <p class="hint li-hint">Select a line's name to see it year by year.</p>
      <div class="table-scroll"><table class="table"><thead><tr>${th('name', 'Line item and account')}${th('cat', 'Category', 'hide-sm')}${S.c ? th('cmp', esc(seriesLabel(S.c)), 'num') : ''}${th('sel', esc(seriesLabel(k)), 'num')}${S.c ? th('chg', 'Change', 'num hide-sm') : ''}</tr></thead>
        <tbody>${body || '<tr><td colspan="5" class="empty">No matching line items.</td></tr>'}</tbody>
        <tfoot><tr><td>Total${q ? ' (matching)' : ''}</td><td class="hide-sm"></td>${S.c ? `<td class="num">${fig(fCmp)}</td>` : ''}<td class="num">${fig(fSel)}</td>${S.c ? `<td class="num hide-sm">${money(ts - tc)}</td>` : ''}</tr></tfoot></table></div>
      ${left > 0 ? `<button type="button" class="btn btn-outline more" data-more>Show ${Math.min(PAGE_SIZE, left)} more</button>` : ''}`;
  }
  /* ---------- A line item's history, unfolded under its name in the line-item table ----------
     The same line (account code in the same fund) in every year: one figure per year by the site's own rules (Actual,
     then Projected, then Proposed and Revised, then the city's projections), summed where the book prints the line
     more than once. Drawn like Totals by Year (trendChart), with the values and their PDF pages in a table. */
  function lineHistoryPoints(e) {
    const kindOk = (r) => isRevenue(r) === (S.k === 'revenue');
    const at = (y, m) => {
      const kk = key(y, m), l = rows(kk).filter((r) => r.code === e.code && r.fund === e.fund && kindOk(r));
      return { y, m, v: l.length ? sum(l) : null, t: l.length ? { v: sum(l), k: kk, ...firstPage(l) } : null };
    };
    const pts = [];
    for (const y of years().slice().sort((a, b) => a - b)) for (const m of ORDER) if (series(key(y, m))) pts.push(at(y, m));
    for (const y of projectionYears()) pts.push(at(y, 'projection'));
    return pts;
  }
  // What the books say about this line: the "stands out" sentence for a year it towers over its neighbours, and any line note.
  function lineHistoryNotes(e) {
    const spikes = lineSpikes(S.k).filter((s) => s.code === e.code && s.fund === e.fund);
    const seen = new Set(spikes.map((s) => s.k));
    const out = spikes.map((s) => `<p class="trend-spike"><strong>${esc(String(parseKey(s.k).y))} stands out:</strong> ${spikeSentence(s, S.k)}.${spikeContext(s)}</p>`);
    for (const n of CH?.line_notes || []) {
      if (n.account !== e.code || seen.has(key(n.year, n.figure))) continue;
      out.push(`<p class="trend-spike"><strong>${esc(String(n.year))}:</strong> ${esc(n.text)} <span class="wc-srcnote">${srcDoc('Budget book', n.d, n.p)}</span></p>`);
    }
    return out.join('');
  }
  function lineHistoryHTML(e, pts) {
    const rowsHtml = pts.map((p) => `<tr${p.m === 'projection' ? ' class="proj-row"' : ''}><th scope="row">${p.y}</th><td>${LABEL[p.m]}</td><td class="num">${p.t ? src(money(p.v), p.t.k, p.t.d, p.t.p) : '—'}</td></tr>`).join('');
    return `<div class="li-hist-body" role="group" aria-label="History of ${esc(e.name)}">
      <ul class="trend-legend" aria-hidden="true">${trendLegend(pts)}</ul>
      <div class="chart-box short"><canvas role="img" aria-label="${esc(e.name)} by year, ${pts[0].y} to ${pts[pts.length - 1].y}. Solid line: actual. Dashed line: projected. Hollow diamond: proposed. Solid dot: revised. The table below has the values."></canvas></div>
      <p class="trend-axis"></p>${lineHistoryNotes(e)}
      <details class="values"><summary>Show values</summary><div class="table-scroll"><table class="table"><thead><tr><th scope="col">Year</th><th scope="col">Figure</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></details></div>`;
  }
  function closeLineHistory(holder) {
    closeHist();
    holder.querySelectorAll('tr.li-hist').forEach((r) => r.remove());
    holder.querySelectorAll('.li-toggle[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  // Open (or, on a second click, close) the history of the line in the toggle's row; one is open at a time and focus stays on the toggle.
  function toggleLineHistory(holder, btn, e) {
    const wasOpen = btn.getAttribute('aria-expanded') === 'true';
    closeLineHistory(holder);
    if (wasOpen) return;
    const tr = btn.closest('tr'), pts = lineHistoryPoints(e);
    if (!pts.some((p) => p.v != null)) return;
    tr.insertAdjacentHTML('afterend', `<tr class="li-hist" id="li-hist-${btn.dataset.li}"><td colspan="${tr.cells.length}">${lineHistoryHTML(e, pts)}</td></tr>`);
    btn.setAttribute('aria-expanded', 'true');
    const box = tr.nextElementSibling, cv = box.querySelector('canvas');
    if (window.Chart) histChart = trendChart(cv, pts, box.querySelector('.trend-axis'), true);
  }
  /* CSV of the line items matching the search (every row, in the table's order), built in the browser. Plain
     ASCII minus signs, so spreadsheets read the numbers; source pages are the budget-book PDF pages. */
  function exportCSV() {
    const k = key(S.y, S.m), v = (e, sl) => (e[sl] ? e[sl].v : '');
    const cell = (x) => { let t = x == null ? '' : String(x); if (/^[=+\-@]/.test(t) && Number.isNaN(Number(t))) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Account', 'Line item', 'Department', 'Budget group', 'Fund', 'Category', S.c ? seriesLabel(S.c) : '', seriesLabel(k), S.c ? 'Change' : '', `Source book (${seriesLabel(k)})`, `Source page (${seriesLabel(k)})`, S.c ? `Source book (${seriesLabel(S.c)})` : '', S.c ? `Source page (${seriesLabel(S.c)})` : ''];
    const lines = lastList.map((e) => {
      const u = O.codes[e.code.split('-')[0]];
      return [e.code, e.name, O.departments[O.units[u].dept].name, bureauName(e.bureau), fn(D.funds[e.fund]), D.categories[e.cat], S.c ? v(e, 'cmp') : '', v(e, 'sel'), S.c ? (e.sel ? e.sel.v : 0) - (e.cmp ? e.cmp.v : 0) : '',
        e.sel ? D.docs[e.sel.d] : '', e.sel ? e.sel.p : '', S.c && e.cmp ? D.docs[e.cmp.d] : '', S.c && e.cmp ? e.cmp.p : ''];
    });
    const csv = [head, ...lines].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${slug($('page-h')?.textContent || 'line-items')}-${S.y}-${S.m}-line-items.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function mountLines(selRows, cmpRows, showBureau) {
    const holder = $('li-holder');
    if (!holder) return;
    const paint = (focus) => {
      closeLineHistory(holder); // a new table closes the open history (and frees its chart)
      holder.innerHTML = lineTable(selRows, cmpRows, showBureau);
      const s = $('li-search');
      const shown = lastList.slice(0, T.shown);
      holder.querySelectorAll('.li-toggle').forEach((b) => b.addEventListener('click', () => toggleLineHistory(holder, b, shown[+b.dataset.li])));
      s.addEventListener('input', (e) => { T.q = e.target.value; T.shown = PAGE_SIZE; paint(true); });
      holder.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.sort;
        T.dir = T.sort === id ? -T.dir : (['code', 'name', 'cat'].includes(id) ? 1 : -1); T.sort = id;
        paint(false); holder.querySelector(`[data-sort="${id}"]`)?.focus();
      }));
      holder.querySelector('[data-export]')?.addEventListener('click', exportCSV);
      holder.querySelector('[data-more]')?.addEventListener('click', () => { T.shown += PAGE_SIZE; paint(false); });
      if (focus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    };
    paint(false);
  }

  const notFound = (what) => (document.title = pageTitle(`${what} not found`), { html: `<p class="back-link"><a href="${esc(homeHash())}">‹ All departments</a></p><header class="page-head"><h1 id="page-h" tabindex="-1">${esc(what)} not found</h1><p class="muted">That link doesn't match anything in the current data.</p></header>` });

  /* ---------- org chart: departments, bureaus and "what does it do" text ---------- */
  const findDept = (sl) => O.departments.findIndex((d) => d.slug === sl || d.aliases.includes(sl));
  const unitsOf = (di) => O.units.map((u, i) => ({ ...u, i })).filter((u) => u.dept === di);
  // A department-wide group is not a bureau: budget lines the department manages (city-wide costs, fee revenue).
  const unitLabel = (ui, kind = S.k) => (O.units[ui].kind === 'department-wide'
    ? (kind === 'revenue' ? 'Department revenue (not a bureau)' : 'Department-wide costs (not a bureau)') : O.units[ui].name);
  const descHref = (p) => `${CFG.paths.pdfs}${encodeURIComponent(O.desc_doc)}#page=${p}`;
  function descBody(text) {
    // Paragraphs are separated by blank lines; "• " starts a bullet, "### " a printed subheading.
    let html = '', list = [];
    const flush = () => { if (list.length) { html += `<ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`; list = []; } };
    for (const para of text.split(/\n\n+/)) {
      if (para.startsWith('• ')) { list.push(para.slice(2)); continue; }
      flush();
      html += para.startsWith('### ') ? `<h3 class="org-sub">${esc(para.slice(4))}</h3>` : `<p>${esc(para)}</p>`;
    }
    flush();
    return html;
  }
  function aboutHTML(question, entries, extra = '') {
    if (!entries.length && !extra) return '';
    const body = entries.map((e) => `<div class="org-entry">${e.h ? `<h2 class="org-h">${esc(e.h)}</h2>` : ''}${descBody(e.t)}
        <a class="org-src" href="${esc(descHref(e.p))}" target="_blank" rel="noopener" aria-label="${esc(e.h || question.replace(/\?$/, ''))}: open in the city's 2027 organization descriptions (PDF)" title="Open in the city's 2027 organization descriptions">Source document ↗</a></div>`).join('');
    return `<details class="org-about"${aboutOpen ? ' open' : ''}><summary>${esc(question)}</summary><div class="org-about-body">${extra}${body}</div></details>`;
  }
  /* Old bureau links named a fund and a printed budget group ("general-fund--accounting-expense").
     Find that group in any year and return the org unit its lines belong to. */
  function legacyUnit(bureauPart) {
    for (const kk of Object.keys(D.series)) {
      const hit = rows(kk).find((r) => bureauSlug(r.fund, r.bureau) === bureauPart);
      if (hit) return hit.unit;
    }
    return -1;
  }

  function deptPage() {
    const di = findDept(route.dept);
    if (di < 0) return notFound('Department');
    if (O.departments[di].slug !== route.dept) return { redirect: deptHash(di) };
    route.deptIdx = di;
    const dept = O.departments[di];
    const k = key(S.y, S.m), name = dept.name;
    const selRows = scoped(k, { dept: di }), cmpRows = S.c ? scoped(S.c, { dept: di }) : [];
    const picker = `<select id="dept-pick" data-pick="dept">${O.departments.map((d, i) => `<option value="${esc(d.slug)}" ${i === di ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
    const funds = new Set(selRows.map((r) => r.fund));
    const units = groupTotals(selRows, (r) => r.unit, k);
    const nBureaus = [...units.keys()].filter((u) => O.units[u].kind === 'bureau').length;
    const UW = isCounty() ? 'department' : 'bureau';
    const count = !dept.bureaus ? `No ${UW}s` : nBureaus ? `${nBureaus} ${UW}${nBureaus === 1 ? '' : 's'}` : '';
    const subtitle = selRows.length
      ? [count, [...funds].map((f) => esc(fn(D.funds[f]))).join(', '), lineCountText(selRows, cmpRows)].filter(Boolean).join(' · ')
      : `No ${S.k === 'revenue' ? 'revenue' : 'expense'} lines for this department in ${esc(seriesLabel(k))}.`;
    // Bureau list: only for departments that have bureaus on the org chart. Several budget groups can make up one
    // bureau; budget groups that are not a bureau form one "department-wide" card, listed last.
    let bureauList = '', bureauPie = [], bureauPieHTML = '';
    const cardNotes = new Map();
    if (dept.bureaus) {
      const cmpUnits = S.c ? groupTotals(cmpRows, (r) => r.unit, S.c) : new Map();
      const ids = [...new Set([...units.keys(), ...cmpUnits.keys()])];
      const items = ids.map((u) => ({ id: u, name: unitLabel(u), href: unitHash(u), elected: isCounty() ? O.units[u].elected : null, sel: units.get(u), cmp: cmpUnits.get(u) }))
        .sort((a, b) => (O.units[a.id].kind === 'department-wide') - (O.units[b.id].kind === 'department-wide') || (b.sel?.v || 0) - (a.sel?.v || 0) || (b.cmp?.v || 0) - (a.cmp?.v || 0));
      const hasWide = ids.some((u) => O.units[u].kind === 'department-wide');
      if (items.length > 1) {
        bureauPie = items.map((i) => ({ label: i.name, v: i.sel?.v || 0, href: i.href }));
        bureauPieHTML = sidePieHTML('pie-bureau', `Share of ${name} ${seriesLabel(k)} ${S.k === 'revenue' ? 'income' : 'spending'} by ${isCounty() ? 'department' : 'bureau'}`, bureauPie);
        const note = (isCounty() ? 'Departments as the County\'s 2026 budget book groups them. Select one to see its line items.' : 'Bureaus as on the city\'s 2027 org chart. Select one to see its line items.')
          + (hasWide ? ` “${unitLabel(ids.find((u) => O.units[u].kind === 'department-wide'))}” collects budget groups that are not a bureau.` : '');
        bureauList = `<section class="bureau-list" id="sec-bureaus" tabindex="-1" aria-labelledby="bl-t"><h2 class="list-title" id="bl-t">${S.k === 'revenue' ? 'Income by' : 'Spending by'} ${isCounty() ? 'Department' : 'Bureau'}</h2><p class="hint hint-top">${esc(note)} Amounts open the source page in the budget book.</p>
          ${bureauPieHTML ? '<div class="with-pie">' : ''}<ul class="cards" aria-labelledby="bl-t">${cardList(items, { total: totalOf(selRows, k).v, k, shareOf: `${name} ${S.k === 'revenue' ? 'revenue' : 'spending'}`, level: 3, notes: cardNotes, keys: !!bureauPieHTML })}</ul>${bureauPieHTML ? `${bureauPieHTML}</div>` : ''}${gapNotes(cardNotes)}</section>`;
      }
    }
    document.title = pageTitle(`${name} ${seriesLabel(k)}`);
    const about = aboutHTML('What does this department do?', dept.desc);
    const v = entityView({ title: name, subtitle, selRows, cmpRows, crumbs: [{ label: 'Home', href: homeHash() }, { label: name }], bureauList, changes: deptChangesHTML(di), deptPicker: picker, scope: { dept: di }, about });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats); if (bureauPieHTML) drawSidePie('pie-bureau', bureauPie); mountLines(selRows, cmpRows, true); } };
  }

  /* County: a department headed by (or serving) elected officials, from data/county/elected_offices.csv. The sentence links
     to the page that says so; the other pages that say it (organizational chart, budget book) are listed on About. */
  const electedLineHTML = (u) => (u.elected
    ? `<p class="elected-line"><span class="elected-label">${esc(u.elected.label)}</span> <a class="src" href="${pdfHref(u.elected.d, u.elected.p)}" target="_blank" rel="noopener">${esc(u.elected.line)}</a>.</p>`
    : '');

  function bureauPage() {
    const di = findDept(route.dept);
    let ui = di < 0 ? -1 : unitsOf(di).find((u) => u.slug === route.bureau)?.i ?? -1;
    if (ui < 0) {
      // Old link, renamed department or a unit that moved: go to the unit if it has a page, else its department.
      const lu = legacyUnit(route.bureau);
      if (lu >= 0) return { redirect: O.departments[O.units[lu].dept].bureaus ? unitHash(lu) : deptHash(O.units[lu].dept) };
      return di >= 0 ? { redirect: deptHash(di) } : notFound('Bureau');
    }
    const unit = O.units[ui];
    if (!O.departments[di].bureaus) return { redirect: deptHash(di) }; // no bureau pages for departments without bureaus
    if (O.departments[di].slug !== route.dept) return { redirect: unitHash(ui) };
    route.deptIdx = di; route.unitIdx = ui;
    const k = key(S.y, S.m), name = unitLabel(ui);
    const selRows = scoped(k, { unit: ui }), cmpRows = S.c ? scoped(S.c, { unit: ui }) : [];
    const scope = { unit: ui };
    const funds = [...new Set([...selRows, ...cmpRows].map((r) => r.fund))].map((f) => esc(fn(D.funds[f])));
    document.title = pageTitle(`${name} ${seriesLabel(k)}`);
    const sub = [esc(O.departments[di].name), unit.division ? (isCounty() ? esc(unit.division) : `${esc(unit.division)} Division`) : '', ...funds, lineCountText(selRows, cmpRows)].filter(Boolean).join(' · ');
    let about;
    if (unit.kind === 'department-wide') {
      const groupsShown = [...new Set([...selRows, ...cmpRows].map((r) => bureauName(r.bureau)))].sort();
      about = aboutHTML('What is this?', [], `<p>These budget lines are not a bureau on the city's 2027 org chart. They are budget groups the ${esc(O.departments[di].name)} department manages${groupsShown.length ? `, printed in the budget book as: ${esc(groupsShown.join('; '))}` : ''}.</p>`);
    } else {
      const q = /^Bureau\b/.test(unit.name) ? 'What does this bureau do?' : /^Office\b/.test(unit.name) ? 'What does this office do?' : `What does ${unit.name} do?`;
      about = aboutHTML(q, unit.desc);
    }
    const v = entityView({ title: name, subtitle: sub, selRows, cmpRows, crumbs: [{ label: 'Home', href: homeHash() }, { label: O.departments[di].name, href: deptHash(di) }, { label: name }], changes: deptChangesHTML(di, ui), scope, about: electedLineHTML(unit) + about });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats); mountLines(selRows, cmpRows, true); } };
  }

  /* ---------- What changed (#/changes) ----------
     Reads <paths.data>changes.json (scripts/changes.py): per comparison (newest Revised or Proposed against the
     prior year's Projected, the latest Actual, or the Proposal), totals by fund, category, department and bureau,
     every changed line, shifts between funds found in the city's line notes, and position counts per bureau with
     the artifacts that make printed schedules differ. Every amount links to its page in the budget book. */
  let CH = null;
  const changesHash = (over) => eh(`changes?${query(over)}`);
  const WC_TOP = 10;
  const vOf = (x) => (x ? x.v : 0);
  /* Short money for sentences and tiles: $87.8M, $1.25M (a second decimal when one would be more than 2.5% off), $148K. */
  const mny = (n) => {
    const a = Math.abs(n), sg = n < 0 ? MINUS : '';
    if (a >= 1e6) { const one = +(a / 1e6).toFixed(1); return `${sg}$${Math.abs(one * 1e6 - a) / a > 0.025 ? (a / 1e6).toFixed(2) : one.toFixed(1)}M`; }
    if (a >= 1e3) return `${sg}$${Math.round(a / 1e3)}K`;
    return `${sg}$${Math.round(a)}`;
  };
  const sgn = (n, f) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));
  const fmtN = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const lnk = (x, text) => (x && x.d != null ? srcDoc(text ?? money(x.v), x.d, x.p) : (text ?? money(vOf(x))));
  const deltaHTML = (d, base, f = money) => { const p = base ? (d / Math.abs(base)) * 100 : null; return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d === 0 ? 'No change' : sgn(d, f)}${p == null || d === 0 ? '' : `<span class="pct"> (${sgn(p, (x) => x.toFixed(1))}%)</span>`}</span>`; };
  const nDelta = (d) => `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${Math.abs(d) < 0.005 ? '0' : sgn(d, fmtN)}</span>`;

  /* Which comparison: <newest figure>~<compare with>. Falls back to the first one listed for that figure. */
  function changeCmp() {
    if (!CH) return null;
    const to = key(D.newest_year, S.m);
    let id = `${to}~${S.c}`;
    if (!CH.comparisons[id]) id = Object.keys(CH.comparisons).find((x) => x.startsWith(`${to}~`)) || CH.default;
    return CH.comparisons[id] ? { id, ...CH.comparisons[id] } : null;
  }
  const revisionCmp = () => (CH ? CH.comparisons[`${D.newest_year}|revised~${D.newest_year}|proposed`] || null : null);
  const kindOf = (k) => parseKey(k).m;
  const crossYear = (c) => parseKey(c.from).y !== parseKey(c.to).y;
  const bud = (k) => (kindOf(k) === 'budget' ? `${parseKey(k).y} budget` : `${seriesLabel(k)} budget`); // "2026 budget" (the County's figure is already called Budget)
  function fromPhrase(c, spend = true) {
    const { y, m } = parseKey(c.from);
    if (m === 'projected') return `the city expects to ${spend ? 'spend' : 'collect'} in ${y}`;
    if (m === 'actual') return `the city ${spend ? 'spent' : 'collected'} in ${y}`;
    return `the ${bud(c.from)}`;
  }
  const scopeName = () => S.f || 'all';
  const fundWords = () => (S.f ? `from the ${esc(fn(S.f))}` : 'across all funds');
  const acctOf = (ln) => D.accounts[ln[0]];
  const unitOfLine = (ln) => O.codes[acctOf(ln)[0].split('-')[0]];
  const lineF = (ln) => (ln[1] == null ? null : { v: ln[1], d: ln[2], p: ln[3] });
  const lineT = (ln) => (ln[4] == null ? null : { v: ln[4], d: ln[5], p: ln[6] });
  const lineD = (ln) => (ln[4] || 0) - (ln[1] || 0);
  /* Totals on What changed come from the same lines and the same printed-total rule as the rest of the site
     (changes.json supplies which groups exist; the amounts shown are totalOf()). */
  function wcTotal(k, kind, fund = S.f, filter = null) {
    const fi = fund ? D.funds.indexOf(fund) : -1;
    const l = rows(k).filter((r) => ofKind(r, kind, fi < 0) && (fi < 0 || r.fund === fi) && (!filter || filter(r)));
    return l.length ? totalOf(l, k) : null;
  }
  const wcWhat = (kind, fund = S.f) => `${fn(fund) || 'All funds'} ${kind === 'revenue' ? 'income' : 'spending'}`;

  /* Shifts between funds that touch this scope (fund, and optionally one department). */
  function shiftsFor(c, fund, dept = null, unit = null) {
    if (!CH || !crossYear(c)) return [];
    const inDept = (u) => u != null && O.units[u].dept === dept;
    return CH.shifts.filter((s) => (!fund || s.from_fund === fund || s.to_fund === fund) && (dept == null || inDept(s.from.unit) || inDept(s.to?.unit))
      && (unit == null || s.from.unit === unit || s.to?.unit === unit));
  }
  function movedPositions(P, cls, fund) {
    let into = 0, out = 0;
    for (const a of (P?.artifacts || [])) {
      if (a.kind !== 'moved') continue;
      const n = a.n[cls] || 0;
      if (!fund || a.fund === fund) into += n;
      if (fund && a.from_fund === fund) out += n;
    }
    return { into, out };
  }
  const posClass = (P) => (P.classes.includes('FT') ? 'FT' : 'ALL');
  const clsWord = (cls, plural = true) => (cls === 'FT' ? `full-time position${plural ? 's' : ''}` : cls === 'PT' ? `part-time position${plural ? 's' : ''}` : `position${plural ? 's' : ''}`);

  function headlineSentence(c, sc) {
    const ex = sc.expense; if (!ex) return '';
    const t = wcTotal(c.to, 'expense'), f = wcTotal(c.from, 'expense'), d = vOf(t) - vOf(f), p = vOf(f) ? Math.abs(d / vOf(f)) * 100 : null;
    let s = `The ${esc(bud(c.to))} spends ${t ? fig(t, { text: mny(t.v) }) : '$0'} ${fundWords()}, `
      + (d === 0 ? `the same as ${fromPhrase(c)}.` : `${mny(Math.abs(d))}${p == null ? '' : ` (${p.toFixed(1)}%)`} ${d > 0 ? 'more' : 'less'} than ${fromPhrase(c)}.`);
    if (S.f) {
      const ins = shiftsFor(c, S.f).filter((x) => x.to_fund === S.f && x.to?.values);
      const amt = ins.reduce((a, x) => a + vOf(x.to.values[c.to]), 0);
      if (amt > 0) {
        const from = [...new Set(ins.map((x) => x.from_fund))];
        const what = ins.map((x) => esc(x.to.label || x.from.label));
        s += ` ${d > 0 && amt <= d ? `${mny(amt)} of that is` : `That includes ${mny(amt)} of`} ${what.length > 1 ? what.slice(0, -1).join(', ') + ' and ' + what[what.length - 1] : what[0]} work moved from the ${from.length === 1 ? esc(from[0]) : 'other funds'}.`;
      }
    }
    const dr = sc.revenue?.draw;
    if (dr && vOf(dr.t) > 0) {
      const P = drawParts(c.to, vOf(dr.t));
      s += ` ${S.f ? 'It\'s' : 'The General Fund is'} balanced by ${P ? drawSplit(P, mny) : `drawing ${lnk(dr.t, mny(vOf(dr.t)))} from the reserve`}.`;
    }
    return s;
  }

  /* The Income view's headline: what the newest budget takes in, against the comparison. The tax changes behind it are
     tiles below it (taxTiles); never the draw, which is not income. */
  function incomeSentence(c) {
    const t = wcTotal(c.to, 'revenue'), f = wcTotal(c.from, 'revenue'), d = vOf(t) - vOf(f), p = vOf(f) ? Math.abs(d / vOf(f)) * 100 : null;
    return `The ${esc(seriesLabel(c.to))}${isCounty() ? '' : ' budget'} takes in ${t ? fig(t, { text: mny(t.v) }) : '$0'} ${S.f ? `in the ${esc(S.f)}` : 'across all funds'}, `
      + (d === 0 ? `the same as ${fromPhrase(c, false)}.` : `${mny(Math.abs(d))}${p == null ? '' : ` (${p.toFixed(1)}%)`} ${d > 0 ? 'more' : 'less'} than ${fromPhrase(c, false)}.`);
  }
  const ledeFor = (c, sc) => (S.k === 'revenue' && sc.revenue ? incomeSentence(c) : headlineSentence(c, sc));

  /* A line far above the years either side of it (lineSpikes) in either budget being compared: the generated note, and
     how much of the change it accounts for ("Leaving that line out, income rises $5.7M rather than falling $1.0M"). */
  function spikeWCNote(c, kind, { brief = false } = {}) {
    const word = kind === 'revenue' ? 'income' : 'spending';
    return [c.from, c.to].flatMap((k) => spikesIn(kind, {}, k)).map((s) => {
      const other = s.k === c.from ? c.to : c.from;
      const ol = rows(other).filter((r) => r.fund === s.fund && r.code === s.code), ov = sum(ol);
      const d = vOf(wcTotal(c.to, kind)) - vOf(wcTotal(c.from, kind));
      const rest = d - (s.k === c.from ? ov - s.v : s.v - ov);
      const there = ol.length ? `${esc(seriesLabel(other))} has ${src(mny(ov), other, ol[0].d, ol[0].p)}` : `${esc(seriesLabel(other))} has no such line`;
      const moves = (x, ing) => (Math.round(x) === 0 ? (ing ? 'staying the same' : 'stays the same') : `${x > 0 ? (ing ? 'rising' : 'rises') : (ing ? 'falling' : 'falls')} ${mny(Math.abs(x))}`);
      // Brief beside Totals by Year (which carries the full note): only what the line does to this comparison.
      if (brief) return `<p class="wc-spike">Leaving out ${esc(s.name)}, which stands out in ${esc(seriesLabel(s.k))} (${src(mny(s.v), s.k, s.d, s.p)}), ${word} ${moves(rest, false)} rather than ${moves(d, true)}.</p>`;
      return `<p class="wc-spike"><strong>${esc(String(parseKey(s.k).y))} stands out:</strong> ${spikeSentence(s, kind)}; ${there}. Leaving that line out, ${word} ${moves(rest, false)} rather than ${moves(d, true)}.${spikeContext(s)}</p>`;
    }).join('');
  }

  /* The draw's label and its parts in a comparison (see drawParts). */
  const drawLabel = (c, dr) => (drawParts(c.to, vOf(dr.t)) || drawParts(c.from, vOf(dr.f)) ? 'Drawn from savings (the “Fund Balance Reserve” lines)' : 'Drawn from the reserve (the “Fund Balance Reserve” line)');
  function drawSplitNote(c, dr) {
    const parts = [[c.from, dr.f], [c.to, dr.t]].map(([k, x]) => [k, drawParts(k, vOf(x))]).filter(([, P]) => P);
    return parts.length ? ` (${parts.map(([k, P]) => `${esc(seriesLabel(k))}: ${srcDoc(money(P.dc.v), P.dc.d, P.dc.p)} of it from dedicated data center revenue`).join('; ')})` : '';
  }

  function badgeHTML(c) {
    if (c.same_kind) return '';
    const fm = kindOf(c.from);
    const what = fm === 'projected' ? 'a year-end estimate' : fm === 'actual' ? (isReserve() ? 'an actual year-end balance' : S.k === 'revenue' ? 'actual income' : 'actual spending') : LABEL[fm].toLowerCase();
    const alt = Object.keys(CH.comparisons).filter((x) => x.startsWith(`${c.to}~`) && x !== c.id && crossYear(CH.comparisons[x]));
    const altK = alt.find((x) => kindOf(x.split('~')[1]) === (fm === 'projected' ? 'actual' : 'projected'));
    const sw = altK ? ` <a class="wc-switch" href="${esc(changesHash({ c: altK.split('~')[1] }))}">Compare with ${esc(seriesLabel(altK.split('~')[1]))} instead</a>` : '';
    return `<p class="wc-badge"><span class="wc-badge-tag">Comparing a proposal with ${what}</span>${sw}</p>`;
  }

  function tilesHTML(c, sc, { foot = true } = {}) {
    const tiles = [];
    const ex = sc.expense, notes = new Map();
    const fx = (t, kind) => (t ? fig(t, { notes, what: wcWhat(kind) }) : '$0');
    if (ex && !(S.k === 'revenue' && sc.revenue)) {
      const tf = wcTotal(c.from, 'expense'), tt = wcTotal(c.to, 'expense');
      tiles.push(['Spending change', deltaHTML(vOf(tt) - vOf(tf), vOf(tf), mny), `<span class="nb">${esc(seriesLabel(c.from))}</span> ${fx(tf, 'expense')} → <span class="nb">${esc(seriesLabel(c.to))}</span> ${fx(tt, 'expense')}`]);
    }
    const dr = sc.revenue?.draw;
    // The Income tile: on the Income view always (first), otherwise only where there is no draw tile.
    if (sc.revenue && (S.k === 'revenue' || !dr)) {
      const rf = wcTotal(c.from, 'revenue'), rt = wcTotal(c.to, 'revenue');
      const t = ['Income change', deltaHTML(vOf(rt) - vOf(rf), vOf(rf), mny), `${esc(seriesLabel(c.from))} ${fx(rf, 'revenue')} → ${esc(seriesLabel(c.to))} ${fx(rt, 'revenue')}`];
      if (S.k === 'revenue') tiles.unshift(t, ...taxTiles(c.to)); else tiles.push(t);
    }
    if (dr && S.k !== 'revenue') { // the draw is not income: shown with spending only
      const Pt = drawParts(c.to, vOf(dr.t)), Pf = drawParts(c.from, vOf(dr.f));
      tiles.push([Pt ? 'Drawn from savings' : 'Drawn from the reserve', `<span>${lnk(dr.t, mny(vOf(dr.t)))}</span>`,
        Pt ? `Of it, ${srcDoc(mny(Pt.dc.v), Pt.dc.d, Pt.dc.p)} from dedicated data center revenue (Fund Balance Projection). ${esc(seriesLabel(c.from))}: ${lnk(dr.f, dr.f ? mny(vOf(dr.f)) : '$0')}${Pf ? ` ${drawDC(Pf, mny)}` : ''}. The budget's “Fund Balance Reserve” lines.`
          : `${esc(seriesLabel(c.from))}: ${lnk(dr.f, dr.f ? mny(vOf(dr.f)) : '$0')}. Money taken from savings; the budget's “Fund Balance Reserve” line.`]);
    }
    const P = c.positions;
    if (P && S.k !== 'revenue') {
      const cls = posClass(P), tk = S.f ? String(D.funds.indexOf(S.f)) : 'all', T = P.totals[tk]?.[cls];
      if (T) {
        const mv = movedPositions(P, cls, S.f);
        const corrected = (T.at - T.af) + mv.into - mv.out;
        const parts = [];
        if (mv.into) parts.push(`${fmtN(mv.into)} moved in from other funds`);
        if (mv.out) parts.push(`${fmtN(mv.out)} moved out`);
        parts.push(`${sgn(T.at - T.af, fmtN)} ${mv.into || mv.out ? 'other change' : 'after corrections'}`);
        // The count itself comes first; the link opens the Positions section of What changed at its explanation.
        tiles.push([cls === 'FT' ? 'Full-time positions' : 'Positions', nDelta(corrected), `${fmtN(T.t)} budgeted in the ${esc(P.to_label.replace(/ position schedule$/, ''))} schedule · ${parts.join(' · ')}. <a href="${esc(changesHash({ k: 'expense' }))}&amp;s=wc-pos-how" data-scroll="wc-pos-how">How this is counted</a>`]);
      }
    }
    const rc = revisionCmp();
    const rk = S.k === 'revenue' && rc?.scopes[scopeName()]?.revenue ? 'revenue' : 'expense';
    if (rc?.scopes[scopeName()]?.[rk]) {
      const pf = wcTotal(rc.from, rk), pt = wcTotal(rc.to, rk);
      tiles.push(['Revision vs. proposal', deltaHTML(vOf(pt) - vOf(pf), vOf(pf), mny), `Proposed ${fx(pf, rk)} → Revised ${fx(pt, rk)}`]);
    }
    // The 6% tax revenue limit for the figure being read (Proposed or Revised), General Fund or All funds.
    const tl = tlScope() ? taxLimitFlag(tlTest(parseKey(c.to).y, parseKey(c.to).m)) : '';
    return `<ul class="wc-tiles">${tiles.map(([h, big, sub]) => `<li class="wc-tile"><h2 class="wc-tile-h">${h}</h2><p class="wc-tile-v">${big}</p><p class="wc-tile-s">${sub}</p></li>`).join('')}</ul>${tl}${foot ? gapNotes(notes) : ''}`;
  }

  function shiftCard(s, c) {
    const fv = s.from.values[c.from], tv = s.to?.values?.[c.to], pos = s.positions?.[c.id];
    const unitName = (u) => (u == null ? '' : esc(O.units[u].name));
    const posTxt = pos ? Object.entries(pos).map(([cls, n]) => `${fmtN(n)} ${clsWord(cls, n !== 1)}`).join(' and ') : '';
    const notes = s.evidence.map((e) => `<li><q>${esc(e.t)}</q> ${srcDoc('City\'s note', e.d, e.p)}${e.n > 1 ? `<span class="muted"> (on ${e.n} lines)</span>` : ''}</li>`).join('');
    let to = '';
    if (s.to?.values) to = `<p><strong>Now:</strong> ${lnk(tv)} in ${esc(seriesLabel(c.to))}, ${esc(s.to_fund)}, ${unitName(s.to.unit)}${s.to.orgs.length ? ` (org ${s.to.orgs.join(', ')})` : ''}.</p>`;
    else if (s.to) to = `<p><strong>Now:</strong> done by the ${unitName(s.to.unit)} in the ${esc(s.to_fund)}; its cost there is not on separate lines.</p>`;
    const billed = s.billed ? `<p>The ${esc(s.from_fund)} now pays it back: ${lnk(s.billed.values[c.to])} in ${esc(seriesLabel(c.to))}${s.billed.reimb ? `, received by the ${esc(s.to_fund)} as “${esc(s.billed.reimb.name)}” (${lnk(s.billed.reimb.values[c.to])})` : ''}.</p>` : '';
    const left = s.from.values[c.to] && vOf(s.from.values[c.to]) ? ` ${lnk(s.from.values[c.to])} stays there in ${esc(seriesLabel(c.to))}.` : '';
    const mism = s.note_org_mismatch ? `<p class="muted">The city's note names org ${esc(s.note_orgs.join(', '))}; the matching new lines are in org ${esc(s.to.orgs.join(', '))}.</p>` : '';
    return `<li class="wc-shift"><h3>${esc(s.from.label)}: ${esc(s.from_fund)} → ${esc(s.to_fund)}</h3>
      <p><strong>Before:</strong> ${lnk(fv)} in ${esc(seriesLabel(c.from))}, ${esc(s.from_fund)}, ${unitName(s.from.unit)} (org ${esc(s.from.orgs.join(', '))}).${left}</p>
      ${to}${billed}${posTxt ? `<p><strong>Positions:</strong> ${posTxt} moved with the work.</p>` : ''}${mism}
      <details class="wc-ev"><summary>The city's notes</summary><ul>${notes}</ul></details></li>`;
  }
  function shiftsHTML(c, dept = null, unit = null, fund = S.f) {
    const list = shiftsFor(c, fund, dept, unit);
    if (!list.length) return '';
    const into = fund ? list.filter((s) => s.to_fund === fund) : [], out = fund ? list.filter((s) => s.from_fund === fund) : [];
    const block = (title, l, id) => (l.length ? `<section class="panel wc-moved" aria-labelledby="${id}"><h2 class="total-label" id="${id}">${title}</h2>
      ${fund === DEFAULT_FUND || !fund ? defineMoved() : ''}<ul class="wc-shifts">${l.map((s) => shiftCard(s, c)).join('')}</ul></section>` : '');
    if (!fund) return block('Moved between funds', list, 'wc-mv');
    return block(`Moved into the ${esc(fund)}`, into, 'wc-in') + block(`Moved out of the ${esc(fund)}`, out, 'wc-out');
  }
  const defineMoved = () => `<details class="define"><summary>Why this matters</summary><p>The General Fund is paid for mostly by taxes. The Water, Sewer, Stormwater and Solid Waste funds are paid for by their own fees. Work moved into the General Fund is paid for from taxes from now on; work moved out of it is paid for by fees.</p><p class="define-more"><a href="${termHref('terms-funds')}">Every fund, and which are paid for by taxes →</a></p></details>`;

  /* Diverging bars: one row per group, the bar grows right for an increase and left for a decrease. */
  function divBars(rows, c, id, { title, note = '' }) {
    const items = rows.map((r) => ({ ...r, d: vOf(r.t) - vOf(r.f) })).filter((r) => r.d !== 0).sort((a, b) => b.d - a.d);
    if (!items.length) return '';
    const max = Math.max(...items.map((r) => Math.abs(r.d)));
    const bars = items.map((r) => {
      const w = (Math.abs(r.d) / max) * 100;
      const label = r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label);
      return `<li><span class="wc-bl">${label}</span><span class="wc-track" aria-hidden="true"><span class="wc-half wc-neg">${r.d < 0 ? `<i style="width:${w}%"></i>` : ''}</span><span class="wc-half wc-pos">${r.d > 0 ? `<i style="width:${w}%"></i>` : ''}</span></span><span class="wc-bv">${deltaHTML(r.d, null, mny)}</span></li>`;
    }).join('');
    const unchanged = rows.length - items.length;
    // Each figure is a total from totalOf(): printed where the book prints one for exactly that group, else calculated.
    const fCalc = allCalc(rows.map((r) => r.f)), tCalc = allCalc(rows.map((r) => r.t)), notes = new Map();
    const head = (label, calc) => `${esc(label)}${calc ? '<span class="calc-tag calc-head">calculated</span>' : ''}`;
    const cell = (x, calc, r) => (x ? fig(x, { tag: !calc, notes, what: r.label }) : '—');
    const table = `<details class="values"><summary>Show as a table</summary><div class="table-scroll"><table class="table tight"><thead><tr><th scope="col">${esc(title)}</th><th scope="col" class="num">${head(seriesLabel(c.from), fCalc)}</th><th scope="col" class="num">${head(seriesLabel(c.to), tCalc)}</th><th scope="col" class="num">Change</th></tr></thead>
      <tbody>${rows.map((r) => ({ ...r, d: vOf(r.t) - vOf(r.f) })).sort((a, b) => b.d - a.d).map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${cell(r.f, fCalc, r)}</td><td class="num">${cell(r.t, tCalc, r)}</td><td class="num">${deltaHTML(r.d, vOf(r.f))}</td></tr>`).join('')}</tbody></table></div>${gapNotes(notes)}</details>`;
    return `<div class="wc-div" id="${id}">${note ? `<p class="wc-note">${note}</p>` : ''}<ul class="wc-bars">${bars}</ul>${unchanged ? `<p class="wc-note">${unchanged} unchanged.</p>` : ''}${table}</div>`;
  }

  /* County: where the book folded accounts together, say so under the line (changes.json `merges`; the evidence is in `account_changes`). */
  const mergeNote = (c, i) => {
    const m = (c.merges || []).find((x) => x.line === i);
    if (!m) return '';
    const codes = (l) => [...new Set(l.map((x) => (D.accounts[x[0]][0].split('-')[1] || '')))].join(', ');
    return `<span class="sub">Accounts merged: ${parseKey(c.from).y} ${esc(codes(m.f))} → ${parseKey(c.to).y} ${esc(codes(m.t))}; shown as one line in both years. <a class="known-link" href="${esc(eh('about?s=about-merges'))}">Details</a></span>`;
  };
  function lineTableHTML(c, idx, { caption, showFund = !S.f, empty = '' } = {}) {
    if (!idx.length) return empty;
    const body = idx.map((i) => {
      const ln = c.lines[i], a = acctOf(ln), u = unitOfLine(ln), d = lineD(ln);
      const sub = [a[0], unitLabel(u, D.categories[a[5]] === 'Revenue' ? 'revenue' : 'expense'), showFund ? fn(D.funds[a[2]]) : ''].filter(Boolean).map(esc).join(' · ');
      const drawNoteTxt = /^Fund Balance Reserve/i.test(a[1]) && /-499000$/.test(a[0]) ? `<span class="sub">${esc(ln[4] != null ? drawLineLabel(c.to, ln[4]) : drawLineLabel(c.from, ln[1]))}</span>` : lineTag(ln[0]) ? `<span class="sub line-tag">${esc(lineTag(ln[0]))}</span>` : '';
      return `<tr><td>${esc(a[1])}<span class="sub">${sub}</span>${drawNoteTxt}${mergeNote(c, i)}</td><td class="num hide-sm">${ln[1] == null ? '—' : lnk(lineF(ln))}</td><td class="num">${ln[4] == null ? '—' : lnk(lineT(ln))}<span class="wc-sm">${sgn(d, money)}</span></td><td class="num hide-sm">${deltaHTML(d, ln[1])}</td></tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="table tight wc-lines">${caption ? `<caption>${caption}</caption>` : ''}<thead><tr><th scope="col">Line item</th><th scope="col" class="num hide-sm">${esc(seriesLabel(c.from))}</th><th scope="col" class="num">${esc(seriesLabel(c.to))}</th><th scope="col" class="num hide-sm">Change</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function positionsHTML(c, { dept = null, unit = null, compact = false, fund = S.f } = {}) {
    const P = c.positions;
    if (!P) return '';
    const fi = fund ? D.funds.indexOf(fund) : null;
    const rows = P.rows.filter((r) => (fi == null || r[0] === fi) && (dept == null || O.units[r[1]].dept === dept) && (unit == null || r[1] === unit));
    if (!rows.length) return '';
    const used = new Map();
    const ref = (i) => { if (!used.has(i)) used.set(i, used.size + 1); return used.get(i); };
    const tables = P.classes.map((cls) => {
      const rs = rows.filter((r) => r[2] === cls && (r[3] || r[4] || r[5] || r[6]));
      if (!rs.length) return '';
      // Only bureaus whose count changed (schedule change or real change); the total still covers every bureau.
      const show = rs.filter((r) => r[3] !== r[4] || r[5] !== r[6]);
      if (!show.length) return compact ? '' : `<p class="wc-note">${cls === 'PT' ? 'Part-time p' : 'P'}ositions: no bureau changed (${fmtN(rs.reduce((t, r) => t + r[4], 0))} in all).</p>`;
      const same = rs.length - show.length;
      const body = show.map((r) => {
        const notes = r[9].filter((i) => P.artifacts[i].kind !== 'titles').map((i) => `<a class="wc-ref" href="#wc-note-${ref(i)}" aria-label="Note ${ref(i)}">${ref(i)}</a>`).join('');
        const fl = r[7] != null ? srcDoc(fmtN(r[3]), P.from_doc, r[7]) : fmtN(r[3]);
        const tl = r[8] != null ? srcDoc(fmtN(r[4]), P.to_doc, r[8]) : fmtN(r[4]);
        const nm = unitLabel(r[1]) + (fi == null ? ` · ${fn(D.funds[r[0]])}` : '');
        const href = O.departments[O.units[r[1]].dept].bureaus && O.units[r[1]].kind === 'bureau' ? unitHash(r[1]) : deptHash(O.units[r[1]].dept);
        return `<tr><td><a href="${esc(href)}">${esc(nm)}</a>${notes ? `<sup class="wc-refs">${notes}</sup>` : ''}<span class="sub">${esc(O.departments[O.units[r[1]].dept].name)}</span><span class="wc-sm">${fl} → ${tl}</span></td><td class="num hide-sm">${fl}</td><td class="num hide-sm">${tl}</td><td class="num">${nDelta(r[4] - r[3])}</td><td class="num">${nDelta(r[6] - r[5])}</td></tr>`;
      }).join('');
      const T = rs.reduce((t, r) => ({ f: t.f + r[3], t: t.t + r[4], af: t.af + r[5], at: t.at + r[6] }), { f: 0, t: 0, af: 0, at: 0 });
      const head = cls === 'ALL' ? 'Positions' : cls === 'FT' ? 'Full-time positions' : 'Part-time positions';
      return `<div class="table-scroll"><table class="table tight wc-pos"><caption>${head}</caption><thead><tr><th scope="col">Bureau</th><th scope="col" class="num hide-sm">${esc(P.from_label.replace(/ position schedule$/, '').replace(/ budget book's$/, ' book'))}</th><th scope="col" class="num hide-sm">${esc(P.to_label.replace(/ position schedule$/, ''))}</th><th scope="col" class="num">Schedule change</th><th scope="col" class="num">Real change</th></tr></thead>
        <tbody>${body}</tbody>${compact ? '' : `<tfoot><tr><td>Total${same ? `<span class="sub">including ${same} bureau${same === 1 ? '' : 's'} with no change</span>` : ''}<span class="wc-sm">${fmtN(T.f)} → ${fmtN(T.t)}</span></td><td class="num hide-sm">${fmtN(T.f)}</td><td class="num hide-sm">${fmtN(T.t)}</td><td class="num">${nDelta(T.t - T.f)}</td><td class="num">${nDelta(T.at - T.af)}</td></tr></tfoot>`}</table></div>`;
    }).join('');
    if (!tables) return '';
    const notes = [...used.entries()].sort((a, b) => a[1] - b[1]).map(([i, n]) => {
      const a = P.artifacts[i];
      return `<li id="wc-note-${n}" value="${n}">${esc(a.text)}${a.p ? ` ${srcDoc('Source page', a.d, a.p)}` : ''}</li>`;
    }).join('');
    const titles = compact ? [] : P.artifacts.filter((a) => a.kind === 'titles' && (fi == null || a.fund === fund) && (dept == null || O.units[a.unit].dept === dept) && (unit == null || a.unit === unit));
    const titleNote = titles.length ? `<details class="values"><summary>Renamed titles in ${titles.length} bureau${titles.length === 1 ? '' : 's'}</summary><ul class="wc-notes">${titles.map((a) => `<li><strong>${esc(O.units[a.unit].name)}:</strong> ${esc(a.text)}</li>`).join('')}</ul></details>` : '';
    // The page's own explanation (the "How this is counted" link lands here): the count first, then how it is made.
    let explain = '';
    if (!compact) {
      const T = P.totals[fi == null ? 'all' : String(fi)];
      const pg = (i) => { const ps = rows.map((r) => r[i]).filter((x) => x != null); return ps.length ? Math.min(...ps) : null; };
      const n = (v, doc, page) => (page != null ? srcDoc(fmtN(v), doc, page) : fmtN(v));
      const lbl = (l) => esc(l.replace(/ budget book's position schedule$/, ' budget book').replace(/ position schedule$/, ''));
      const count = (cls) => { const x = T?.[cls]; return x ? `${n(x.t, P.to_doc, pg(8))} in the ${lbl(P.to_label)} schedule, against ${n(x.f, P.from_doc, pg(7))} in the ${lbl(P.from_label)}` : ''; };
      const main = posClass(P), mv = movedPositions(P, main, fund);
      const moved = [mv.into && `${fmtN(mv.into)} moved in from other funds with their work`, mv.out && `${fmtN(mv.out)} moved out to other funds`].filter(Boolean);
      explain = `<p class="wc-pos-count" id="wc-pos-how" tabindex="-1"><strong>${main === 'FT' ? 'Full-time positions' : 'Positions'} budgeted${fund ? `, ${esc(fund)}` : ', all funds'}:</strong> ${count(main)}.${moved.length ? ` Of the change, ${listWords(moved)}.` : ''}${P.classes.includes('PT') && (T?.PT?.t || T?.PT?.f) ? ` Part-time: ${fmtN(T.PT.t)}, against ${fmtN(T.PT.f)}.` : ''}</p>
        <p class="wc-note"><strong>How positions are counted.</strong> Each budget book has a position schedule: pages listing every job title the budget pays for, office by office. Each line there counts as one position, or as the share of one paid from that office's budget, so a job split between two offices or funds counts as part of a position in each (for example 0.5). Full-time and part-time are as the schedule marks them. These are positions the budget pays for, not a count of people employed.</p>
        <p class="wc-note">“Schedule change” is the difference between the two schedules, line for line. “Real change” leaves out what is not a real change: positions that moved between funds with their work (counted as moved, not added in one fund and cut in the other), positions marked full-time in one book and part-time in the other, and offices a book has no schedule page for. Each is listed in the notes under the table.</p>`;
    }
    return `${explain}${tables}${notes ? `<ol class="wc-notes">${notes}</ol>` : ''}${titleNote}`;
  }

  function benefitsLine(c, sc) {
    const b = sc.expense?.by_cat?.find((r) => D.categories[r[0]] === 'Benefits');
    if (!b) return '';
    return `<p class="wc-benefits"><strong>Benefits</strong> (health insurance, pensions and other costs on top of pay): ${lnk(b[1])} in ${esc(seriesLabel(c.from))} → ${lnk(b[2])} in ${esc(seriesLabel(c.to))}, ${deltaHTML(vOf(b[2]) - vOf(b[1]), vOf(b[1]))}.</p>`;
  }

  function revisionHTML(c) {
    const rc = revisionCmp();
    if (!rc) return '';
    const rcc = { ...rc, id: `${D.newest_year}|revised~${D.newest_year}|proposed` };
    const sc = rc.scopes[scopeName()];
    const parts = [];
    const fact = (label, kind) => { const f = wcTotal(rc.from, kind), t = wcTotal(rc.to, kind); return `<li>${label}: ${f ? fig(f) : '$0'} → ${t ? fig(t) : '$0'}, ${deltaHTML(vOf(t) - vOf(f), vOf(f))}</li>`; };
    if (sc?.expense) parts.push(fact('Spending', 'expense'));
    if (sc?.revenue) parts.push(fact('Income', 'revenue'));
    if (sc?.revenue?.draw && S.k !== 'revenue') parts.push(`<li>${drawLabel(rc, sc.revenue.draw)}: ${lnk(sc.revenue.draw.f)} → ${lnk(sc.revenue.draw.t)}${drawSplitNote(rc, sc.revenue.draw)}</li>`);
    const P = rc.positions, tk = S.f ? String(D.funds.indexOf(S.f)) : 'all';
    if (P?.totals[tk]) parts.push(`<li>Positions: ${P.classes.map((cls) => { const d = P.totals[tk][cls].t - P.totals[tk][cls].f; return `${nDelta(d)} ${clsWord(cls, Math.abs(d) !== 1)}`; }).join(', ')}</li>`);
    const fi = S.f ? D.funds.indexOf(S.f) : null;
    const idx = rc.lines.map((ln, i) => i).filter((i) => fi == null || acctOf(rc.lines[i])[2] === fi).sort((a, b) => Math.abs(lineD(rc.lines[b])) - Math.abs(lineD(rc.lines[a])));
    const n = idx.length;
    return `<section class="panel" aria-labelledby="wc-rev"><h2 class="total-label" id="wc-rev">What the revision changed</h2>
      <p class="wc-note">From the ${esc(seriesLabel(rc.from))} budget to the ${esc(seriesLabel(rc.to))} budget${S.f ? `, ${esc(fn(S.f))}` : ''}. ${n} line${n === 1 ? '' : 's'} changed.</p>
      <ul class="wc-facts">${parts.join('')}</ul>
      ${policyHTML(c)}
      ${lineTableHTML(rcc, idx.slice(0, WC_TOP), { caption: `Largest changes, ${esc(seriesLabel(rc.from))} → ${esc(seriesLabel(rc.to))}` })}
      ${n > WC_TOP ? `<details class="values"><summary>All ${n} changed lines</summary>${lineTableHTML(rcc, idx)}</details>` : ''}</section>`;
  }

  /* Tax-policy facts that are not in the budget tables (data/policy_notes.csv), next to the budget line they affect. */
  function policyHTML(c) {
    const notes = (CH.policy || []).filter((p) => p.year === D.newest_year);
    if (!notes.length || (S.f && S.f !== DEFAULT_FUND)) return '';
    const items = [...new Set(notes.map((p) => p.item))];
    const fromK = crossYear(c) && kindOf(c.from) === 'projected' ? c.from : key(D.newest_year - 1, 'projected');
    const fig = (k, code) => { const l = rows(k).filter((r) => r.code === code); return l.length ? { v: sum(l), d: l[0].d, p: l[0].p, k } : null; };
    const blocks = items.map((it) => {
      const ns = notes.filter((p) => p.item === it);
      const code = ns.find((p) => p.account)?.account;
      let traj = '';
      if (code) {
        const pts = [fig(fromK, code), fig(key(D.newest_year, 'proposed'), code), fig(key(D.newest_year, 'revised'), code)].filter(Boolean);
        const base = pts[0];
        traj = `<p class="wc-traj">${esc(rows(base?.k || fromK).find((r) => r.code === code)?.name || code)}: ${pts.map((x, i) => `${esc(seriesLabel(x.k))} ${src(money(x.v), x.k, x.d, x.p)}${i && base ? ` <span class="muted">(${fmtPct(((x.v - base.v) / base.v) * 100, true)} vs. ${esc(seriesLabel(base.k))})</span>` : ''}`).join(' → ')}</p>`;
      }
      const li = ns.map((p) => `<li><span class="wc-fig">${esc(LABEL[p.figure] || p.figure)}:</span> ${esc(p.text)} <span class="wc-srcnote">${p.d != null ? srcDoc('Budget book', p.d, p.p) : /^user-provided/i.test(p.source) ? 'From the city\'s proposal; not printed in the budget book.' : `Source: ${esc(p.source)}`}</span></li>`).join('');
      return `<div class="wc-policy"><h3>${esc(it)}</h3>${traj}<ul>${li}</ul></div>`;
    }).join('');
    return `<div class="wc-policies"><p class="wc-note">Tax rates are not printed in the budget tables. These notes say what the proposal and the revision did to them, next to the revenue line each one affects.</p>${blocks}</div>`;
  }

  /* What changed for the Reserve Fund: the year-end balance in the newest figure against the comparison's, and the lines of
     the Fund Balance Projection page that move it (beginning balance, revenues, expenditures, the operating deficit, the
     committed data center revenue, ending balance), side by side where both figures print them. Every amount links to its
     page; the draw is worded as everywhere else ("$4.7M drawn from savings ($1.9M of it from dedicated data center revenue)"). */
  function reserveChangesPage(c) {
    const name = D.reserve.name, to = resFind(D.newest_year, S.m), from = resFind(parseKey(c.from).y, parseKey(c.from).m);
    document.title = pageTitle(`What changed: ${seriesLabel(c.to)} · ${name}`);
    const h1 = `<h1 id="page-h" tabindex="-1">What changed in ${D.newest_year}</h1>`;
    if (!to || !from) {
      return { html: `<header class="page-head wc-head">${h1}<p class="wc-lede">The ${esc(name)} has no Fund Balance Projection figures for ${esc(seriesLabel(to ? c.from : c.to))}, so there is nothing to compare.</p></header>${changesFiltersHTML(c)}` };
    }
    const te = resEnd(to), fe = resEnd(from), d = te.v - fe.v, p = fe.v ? Math.abs(d / fe.v) * 100 : null;
    const endWord = (e) => (e.measure === 'actual' ? `the city ended ${e.year} with` : e.measure === 'projected' ? `the city expects at the end of ${e.year}` : `the ${esc(resLabel(e))} budget leaves`);
    const gf = D.funds.indexOf(DEFAULT_FUND), dr = reserveDraw(c.to, gf), P = dr ? drawParts(c.to, dr.v) : null;
    let lede = `The ${esc(seriesLabel(c.to))} budget leaves ${srcDoc(mny(te.v), to.doc, te.p)} in the ${esc(name)} at the end of ${to.year}, `
      + (Math.round(d) === 0 ? `the same as ${endWord(from)}.` : `${mny(Math.abs(d))}${p == null ? '' : ` (${p.toFixed(1)}%)`} ${d > 0 ? 'more' : 'less'} than the ${srcDoc(mny(fe.v), from.doc, fe.p)} ${endWord(from)}.`);
    if (dr) lede += ` The ${esc(DEFAULT_FUND)} budget is balanced by ${P ? drawSplit(P, mny) : `${src(mny(dr.v), c.to, dr.d, dr.p)} drawn from savings`}.`;
    // The newest column's own starting balance can differ from where the comparison ends (the book prints two 12/31/2025 balances).
    const tb = to.lines.find((l) => l.t === 'beginning');
    const start = tb && Math.abs(tb.v - fe.v) > 5 && tb.fy === from.year
      ? `<p class="hint wc-fundnote">The ${esc(resLabel(to))} column starts ${to.year} from ${srcDoc(money(tb.v), to.doc, tb.p)}, not the ${srcDoc(money(fe.v), from.doc, fe.p)} that ${esc(resLabel(from))} ends with: the city's book prints two different balances for the start of the year. ${knownLink()}</p>` : '';
    // Lines matched by kind (adjustments in the order printed); the label is the newest figure's own.
    const kinds = ['beginning', 'revenues', 'expenditures', 'surplus'];
    const pick = (e, t, i = 0) => e.lines.filter((l) => l.t === t)[i];
    const adjN = Math.max(...[to, from].map((e) => e.lines.filter((l) => l.t === 'adjustment').length));
    const rowsSpec = [...kinds.map((t) => [t, 0]), ...Array.from({ length: adjN }, (_, i) => ['adjustment', i]), ['ending', 0]];
    const both = from.lines.length > 1;
    const amt = (e, l) => (l ? srcDoc(money(l.v), e.doc, l.p) : '—');
    const body = rowsSpec.map(([t, i]) => {
      const a = pick(from, t, i), b = pick(to, t, i);
      if (!a && !b) return '';
      const lbl = t === 'beginning' ? 'Beginning balance' : t === 'ending' ? 'Ending balance' : resLineLabel(b || a, b ? to : from);
      return `<tr><td>${esc(lbl)}</td>${both ? `<td class="num">${amt(from, a)}</td>` : ''}<td class="num">${amt(to, b)}</td>${both ? `<td class="num">${a && b ? deltaHTML(b.v - a.v, a.v) : '—'}</td>` : ''}</tr>`;
    }).join('');
    const only = both ? '' : `<p class="wc-note">For ${esc(resLabel(from))} the Fund Balance Projection prints only the closing balance (${srcDoc(money(fe.v), from.doc, fe.p)}), so there are no lines to compare. The table shows the ${esc(resLabel(to))} lines.</p>`;
    const table = `<section class="panel" aria-labelledby="wc-res"><h2 class="total-label" id="wc-res">What moves the balance</h2>${only}
      <div class="table-scroll"><table class="table tight"><thead><tr><th scope="col">Fund Balance Projection line</th>${both ? `<th scope="col" class="num">${esc(resLabel(from))}</th>` : ''}<th scope="col" class="num">${esc(resLabel(to))}</th>${both ? '<th scope="col" class="num">Effect on the balance</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="wc-note wc-after">The ${esc(DEFAULT_FUND)}'s budget book lists the money drawn from savings as revenue (its “Fund Balance Reserve” lines). Like the rest of this site, this page does not count it as income: it shows it as the deficit and the committed data center revenue. <a href="${esc(homeHash({ f: name, y: to.year, m: to.measure }))}">See the ${esc(name)}</a></p></section>`;
    const tiles = `<ul class="wc-tiles"><li class="wc-tile"><h2 class="wc-tile-h">Balance change</h2><p class="wc-tile-v">${deltaHTML(d, fe.v, mny)}</p><p class="wc-tile-s">${esc(resLabel(from))} ${srcDoc(money(fe.v), from.doc, fe.p)} → ${esc(resLabel(to))} ${srcDoc(money(te.v), to.doc, te.p)}</p></li>${dr ? `<li class="wc-tile"><h2 class="wc-tile-h">Drawn from savings</h2><p class="wc-tile-v"><span>${src(mny(dr.v), c.to, dr.d, dr.p)}</span></p><p class="wc-tile-s">${P ? `Of it, ${srcDoc(mny(P.dc.v), P.dc.d, P.dc.p)} from dedicated data center revenue (Fund Balance Projection).` : 'The budget\'s “Fund Balance Reserve” lines.'}</p></li>` : ''}</ul>`;
    return { html: `<header class="page-head wc-head">${h1}<p class="wc-lede">${lede}</p>${badgeHTML(c)}${start}</header>${changesFiltersHTML(c)}${tiles}${table}` };
  }

  /* What changed is always about the newest year: its Budget year lists only that year's figures (Revised, Proposed), and
     Compare with lists the comparisons changes.json holds for the chosen one. */
  function changesFiltersHTML(c) {
    const to = key(D.newest_year, S.m);
    const opts = Object.keys(CH.comparisons).filter((x) => x.startsWith(`${to}~`)).map((x) => x.split('~')[1])
      .sort((a, b) => parseKey(b).y - parseKey(a).y || PICK_ORDER.indexOf(parseKey(a).m) - PICK_ORDER.indexOf(parseKey(b).m));
    const ms = figuresFor(D.newest_year).filter((m) => Object.keys(CH.comparisons).some((x) => x.startsWith(`${key(D.newest_year, m)}~`)));
    const present = new Set(Object.keys(c.scopes).filter((x) => x !== 'all').map((f) => D.funds.indexOf(f)));
    const funds = fundOptions(present, null);
    const fields = selField('f-y', 'ym', 'Budget year', figureOptions(ms.map((m) => key(D.newest_year, m)), c.to), `What changed covers ${D.newest_year} only.`)
      + selField('f-c', 'c', 'Compare with', figureOptions(opts, c.from))
      + selField('f-f', 'f', 'Fund', funds)
      + (isReserve() ? '' : tabField('k', 'Show first', [['expense', 'Spending'], ['revenue', 'Income']], S.k));
    return controlsWrap(fields, statusHTML(), explainHTML({ shown: [mOf(c.to)], comparing: [mOf(c.from)], funds: fundChoices(present, null).map(([v]) => v) }));
  }

  function changesPage() {
    if (!CH) return { html: `<header class="page-head"><h1 id="page-h" tabindex="-1">What changed</h1><p class="muted">The comparison data (changes.json) could not be loaded.</p></header>` };
    const c = changeCmp();
    if (!c) return notFound('Comparison');
    if (c.from !== S.c) S.c = c.from;
    if (isReserve()) return reserveChangesPage(c);
    const sc = c.scopes[scopeName()];
    document.title = pageTitle(`What changed: ${seriesLabel(c.to)}${S.f ? ' · ' + fn(S.f) : ''}`);
    const head = `<header class="page-head wc-head"><h1 id="page-h" tabindex="-1">What changed in ${D.newest_year}</h1>
      ${sc ? `<p class="wc-lede">${ledeFor(c, sc)}</p>` : ''}${badgeHTML(c)}</header>`;
    if (!sc) {
      // A fund with no lines in either budget being compared (e.g. one the city has since folded into another).
      const others = D.funds.filter((f) => c.scopes[f]).map((f) => `<a href="${esc(changesHash({ f }))}">${esc(fn(f))}</a>`);
      return { html: `${head}${changesFiltersHTML(c)}<p class="hint wc-fundnote">The ${esc(fn(S.f))} has no lines in the ${esc(seriesLabel(c.to))} budget or in ${esc(seriesLabel(c.from))}, so there is nothing to compare. What changed covers ${listWords(others)}, or <a href="${esc(changesHash({ f: '' }))}">all funds</a>.</p>` };
    }
    const k = 'expense', ex = sc.expense, rv = sc.revenue;
    const grp = (kind, test) => ({ f: wcTotal(c.from, kind, S.f, test), t: wcTotal(c.to, kind, S.f, test) });
    const deptRows = (b, kind) => b.by_dept.map(([d]) => ({ label: O.departments[d].name, ...grp(kind, (r) => r.od === d), href: deptHash(d, { k: kind }) }));
    let html = head + changesFiltersHTML(c) + tilesHTML(c, sc) + shiftsHTML(c);
    let spend = '', income = '';
    if (ex) {
      spend += `<section class="panel" aria-labelledby="wc-cat"><h2 class="total-label" id="wc-cat">Spending by category</h2>${spikeWCNote(c, 'expense')}
        ${divBars(ex.by_cat.map(([i]) => ({ label: D.categories[i], ...grp('expense', (r) => r.cat === i) })), c, 'wc-cat-b', { title: 'Category' })}</section>
        <section class="panel" aria-labelledby="wc-dep"><h2 class="total-label" id="wc-dep">Spending by ${isCounty() ? 'group' : 'department'}</h2>
        ${divBars(deptRows(ex, k), c, 'wc-dep-b', { title: isCounty() ? 'Group' : 'Department', note: isCounty() ? 'Select a group to see its departments and lines.' : 'Select a department to see its bureaus and lines.' })}</section>`;
    }
    const pos = positionsHTML(c);
    if (pos || (ex && (c.positions || ST))) spend += `<section class="panel" aria-labelledby="wc-pos"><h2 class="total-label" id="wc-pos">Positions</h2>${pos || '<p class="wc-note">No position schedule for this comparison.</p>'}${benefitsLine(c, sc)}</section>`;
    if (ex) {
      spend += `<section class="panel" aria-labelledby="wc-top"><h2 class="total-label" id="wc-top">Largest line-item changes</h2>
        <p class="wc-note">Lines in both budgets. New and removed lines are listed below.</p>
        ${lineTableHTML(c, ex.up, { caption: 'Increases', empty: '<p class="wc-note">No increases.</p>' })}${lineTableHTML(c, ex.down, { caption: 'Decreases', empty: '<p class="wc-note">No decreases.</p>' })}</section>`;
      const nw = ex.new, rm = ex.removed;
      spend += `<section class="panel" aria-labelledby="wc-new"><h2 class="total-label" id="wc-new">New and removed lines</h2>
        <p class="wc-facts-line"><strong>${nw.n}</strong> new line${nw.n === 1 ? '' : 's'} (${mny(nw.v)}) · <strong>${rm.n}</strong> removed (${mny(rm.v)})</p>
        ${nw.n ? `<details class="values"><summary>New lines</summary>${lineTableHTML(c, nw.i)}</details>` : ''}
        ${rm.n ? `<details class="values"><summary>Removed lines</summary>${lineTableHTML(c, rm.i)}</details>` : ''}</section>`;
    }
    if (rv) {
      income += `<section class="panel" aria-labelledby="wc-inc"><h2 class="total-label" id="wc-inc">How it's paid for</h2>
        <ul class="wc-facts">${(() => { const { f, t } = grp('revenue', null), notes = new Map(); return `<li>Income: ${f ? fig(f, { notes, what: wcWhat('revenue') }) : '$0'} → ${t ? fig(t, { notes, what: wcWhat('revenue') }) : '$0'}, ${deltaHTML(vOf(t) - vOf(f), vOf(f))}${gapNotes(notes)}</li>`; })()}
</ul>
        ${spikeWCNote(c, 'revenue')}
        ${divBars(rv.by_group.map(([g]) => ({ label: plainName(D.bureaus[g]), ...grp('revenue', (r) => r.bureau === g) })), c, 'wc-inc-b', { title: 'Income source' })}
        ${lineTableHTML(c, rv.up, { caption: 'Largest increases' })}${lineTableHTML(c, rv.down, { caption: 'Largest decreases' })}
        ${rv.new.n || rv.removed.n ? `<p class="wc-facts-line">${rv.new.n} new income line${rv.new.n === 1 ? '' : 's'} (${mny(rv.new.v)}) · ${rv.removed.n} removed (${mny(rv.removed.v)})</p>
        ${rv.new.n ? `<details class="values"><summary>New income lines</summary>${lineTableHTML(c, rv.new.i)}</details>` : ''}${rv.removed.n ? `<details class="values"><summary>Removed income lines</summary>${lineTableHTML(c, rv.removed.i)}</details>` : ''}` : ''}</section>`;
    }
    html += S.k === 'revenue' ? income + spend : spend + income; // "Show first": the chosen side leads
    if (crossYear(c)) html += revisionHTML(c);
    return { html };
  }

  /* "What changed" summary at the top of the home page, beside Totals by Year: the headline sentence and the
     key numbers for the newest year, linking to the full page. Newest year only; the Income view leads with income
     and links to "How it's paid for". */
  function homeChangesHTML() {
    if (!CH || S.y !== D.newest_year) return '';
    const c = changeCmp();
    const sc = c?.scopes[scopeName()];
    const inc = S.k === 'revenue';
    if (!(inc ? sc?.revenue : sc?.expense)) return '';
    return `<section class="panel wc-home" aria-labelledby="wch-t"><h2 class="panel-title" id="wch-t">What changed in ${D.newest_year}</h2>
      <p class="wc-lede-sm">${ledeFor(c, sc)}</p>${badgeHTML(c)}${tilesHTML(c, sc, { foot: false })}${inc ? spikeWCNote(c, 'revenue', { brief: true }) : ''}
      <p class="wc-home-more"><a class="btn btn-primary" href="${esc(changesHash())}${inc ? '&amp;s=wc-inc' : ''}">See everything that changed →</a></p></section>`;
  }

  /* The short summary under a department's or bureau's headline, from changes.json `summary` (scripts/changes.py
     summaries()): budgeted positions in the two schedules, the lines (or categories) that add most to the change,
     and money moved into or out of the General Fund. Facts only; every amount links to its page. */
  const listWords = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
  function deptSummaryHTML(c, di, ui, fund) {
    const unitPage = ui != null;
    const s = c.summary?.[unitPage ? 'all' : (fund || 'all')]?.[unitPage ? 'u' : 'd']?.[String(unitPage ? ui : di)];
    if (!s) return '';
    const items = [];
    const P = c.positions, p = s.pos;
    if (P && p && (p.f || p.t)) {
      const fi = fund ? D.funds.indexOf(fund) : null;
      const rs = P.rows.filter((r) => (fi == null || r[0] === fi) && (unitPage ? r[1] === ui : O.units[r[1]].dept === di));
      const pg = (i) => { const ps = rs.map((r) => r[i]).filter((x) => x != null); return ps.length ? Math.min(...ps) : null; };
      const n = (v, doc, page) => (v && page != null ? srcDoc(fmtN(v), doc, page) : fmtN(v));
      const fy = parseKey(c.from).y, d = p.t - p.f;
      const cls = p.by_cls || {}, pt = cls.PT && (cls.PT[0] || cls.PT[1]);
      let t = `<strong>Budgeted positions:</strong> ${d ? `${n(p.f, P.from_doc, pg(7))} in the ${fy} schedule, ${n(p.t, P.to_doc, pg(8))} in the ${esc(seriesLabel(c.to))} schedule (${sgn(d, fmtN)})` : `${n(p.t, P.to_doc, pg(8))} in both the ${fy} and the ${esc(seriesLabel(c.to))} schedules`}${pt ? `, including ${fmtN(cls.PT[1])} part-time` : ''}.`;
      const why = [];
      if (p.moved_in) why.push(`${fmtN(p.moved_in)} moved in from other funds with their work`);
      if (p.moved_out) why.push(`${fmtN(p.moved_out)} moved out to other funds with their work`);
      if (p.missing > 0) why.push(`${fmtN(p.missing)} are in an office the ${fy} book prints no schedule page for`);
      if (p.missing < 0) why.push(`${fmtN(-p.missing)} are in an office the ${esc(seriesLabel(c.to))} book prints no schedule page for`);
      if (why.length) t += ` ${listWords(why)}; without those, the change is ${sgn(p.at - p.af, fmtN) || '0'}.`;
      if (s.titles) t += ` Titles that changed: ${s.titles.map(([nm, f, to]) => `${esc(nm)} <span class="nb">(${fmtN(f)} → ${fmtN(to)})</span>`).join(', ')}${s.titles_renamed ? '; other titles are worded differently in the two books' : ''}.`;
      items.push(t);
    }
    const up = s.net > 0, dir = up ? 'increases' : 'decreases';
    if (s.drivers?.length) {
      const part = s.drivers.map((i) => {
        const ln = c.lines[i], a = acctOf(ln), grp = unitLabel(unitOfLine(ln), 'expense');
        // Name the bureau only where the department has bureaus (and, on a bureau page, never).
        // Two lines with one name in one place also get the book's own group name (e.g. "Parks Maintenance").
        const showGrp = !unitPage && O.departments[di].bureaus && O.units[unitOfLine(ln)].kind !== 'whole-department';
        const where = showGrp ? (O.units[unitOfLine(ln)].kind === 'department-wide' ? 'department-wide' : grp) : '';
        const twin = s.drivers.some((j) => j !== i && acctOf(c.lines[j])[1] === a[1] && unitOfLine(c.lines[j]) === unitOfLine(ln));
        const tag = [where, twin ? plainName(D.bureaus[a[4]] || '') : ''].filter(Boolean).join(', ');
        const nm = `${esc(a[1])}${tag ? ` <span class="muted">(${esc(tag)})</span>` : ''}`;
        if (ln[1] == null) return `${nm}, new at ${lnk(lineT(ln), mny(ln[4]))}`;
        if (ln[4] == null) return `${nm}, <span class="nb">${lnk(lineF(ln), mny(ln[1]))} → not budgeted</span>`;
        return `${nm}, <span class="nb">${lnk(lineF(ln), mny(ln[1]))} → ${lnk(lineT(ln), mny(ln[4]))}</span>`;
      });
      items.push(`<strong>Largest ${dir}:</strong> ${part.join('; ')}.`);
    } else if (s.cat_drivers?.length) {
      items.push(`<strong>Largest ${dir}, by category:</strong> ${s.cat_drivers.map(([ci, v, d, pg]) => `${esc(D.categories[ci])} ${srcDoc(sgn(v, mny), d, pg)}`).join(', ')}.`);
    }
    if (s.shifts?.length) {
      const gf = DEFAULT_FUND || D.funds[0];
      const sh = s.shifts.map((j) => CH.shifts[j]);
      const into = sh.filter((x) => x.to_fund === gf), out = sh.filter((x) => x.from_fund === gf);
      // The amount where it is now (in the newer budget); where the new fund shows no separate lines for it, the amount it had before.
      const amt = (x, side) => {
        const now = side === 'to' ? x.to?.values?.[c.to] : null, was = x.from.values[c.from];
        if (now && vOf(now)) return ` (${lnk(now, mny(vOf(now)))})`;
        return was && vOf(was) ? ` (${lnk(was, mny(vOf(was)))} in ${esc(seriesLabel(c.from))})` : '';
      };
      const byFund = (l, key, side, word) => [...new Set(l.map((x) => x[key]))].map((f) => `${listWords(l.filter((x) => x[key] === f).map((x) => `${esc(x.from.label)}${amt(x, side)}`))} ${word} the ${esc(f)}`);
      const t = [];
      if (into.length) t.push(`<strong>Moved into the ${esc(gf)}:</strong> ${listWords(byFund(into, 'from_fund', 'to', 'from'))}`);
      if (out.length) t.push(`<strong>Moved out of the ${esc(gf)}:</strong> ${listWords(byFund(out, 'to_fund', 'from', 'to'))}`);
      items.push(`${t.join('. ')}.`);
    }
    return items.length ? `<ul class="wc-sum">${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
  }

  /* Compact "What changed" on a department or bureau page: headline, bureaus, positions, largest lines, shifts.
     A bureau page (ui given) covers all of the bureau's funds, like the rest of that page. */
  function deptChangesHTML(di, ui = null) {
    const link = (txt) => `<a class="btn btn-outline wc-more" href="${esc(changesHash({ y: D.newest_year }))}">${txt}</a>`;
    if (!CH || S.y !== D.newest_year) return `<p class="wc-deptlink sec-changes-link">${link(`What changed in ${D.newest_year} →`)}</p>`;
    const c = changeCmp();
    if (!c) return '';
    const unitPage = ui != null, fund = unitPage ? '' : S.f;
    const sc = c.scopes[unitPage ? 'all' : scopeName()], b = sc?.[S.k];
    const has = unitPage ? b?.by_unit.find((r) => r[0] === ui) : b?.by_dept.find((r) => r[0] === di);
    // The same lines (and so the same total) as the page's own header.
    const inScope = (r) => (unitPage ? r.unit === ui : r.od === di);
    const dr = has && [null, wcTotal(c.from, S.k, fund, inScope), wcTotal(c.to, S.k, fund, inScope)];
    if (!dr) return `<p class="wc-deptlink sec-changes-link">${link(`What changed across ${isCounty() ? 'the County' : 'the city'} →`)}</p>`;
    const name = unitPage ? unitLabel(ui) : O.departments[di].name, word = S.k === 'revenue' ? 'takes in' : 'spends';
    const d = vOf(dr[2]) - vOf(dr[1]), p = vOf(dr[1]) ? Math.abs(d / vOf(dr[1])) * 100 : null;
    const lede = `In the ${esc(bud(c.to))}, ${esc(name)} ${word} ${dr[2] ? fig(dr[2], { text: mny(dr[2].v) }) : '$0'}${fund ? ` from the ${esc(fund)}` : ''}, ${d === 0 ? 'the same as' : `${mny(Math.abs(d))}${p == null ? '' : ` (${p.toFixed(1)}%)`} ${d > 0 ? 'more' : 'less'} than`} ${isCounty() ? `the ${esc(bud(c.from))}` : esc(seriesLabel(c.from))}.`;
    const units = unitPage ? [] : b.by_unit.filter((r) => O.units[r[0]].dept === di).map(([u]) => ({ label: unitLabel(u), f: wcTotal(c.from, S.k, fund, (r) => r.unit === u), t: wcTotal(c.to, S.k, fund, (r) => r.unit === u), href: O.departments[di].bureaus ? unitHash(u) : null }));
    const fi = fund ? D.funds.indexOf(fund) : null;
    const mine = c.lines.map((ln, i) => i).filter((i) => { const ln = c.lines[i], a = acctOf(ln); return O.units[unitOfLine(ln)].dept === di && (!unitPage || unitOfLine(ln) === ui) && (fi == null || a[2] === fi) && acctKindOk(ln[0], S.k, fi == null); })
      .sort((x, y) => Math.abs(lineD(c.lines[y])) - Math.abs(lineD(c.lines[x])));
    const pos = S.k === 'expense' ? positionsHTML(c, { dept: di, unit: ui, compact: true, fund }) : '';
    const summary = S.k === 'expense' ? deptSummaryHTML(c, di, ui, fund) : '';
    return `<section class="panel wc-dept" id="sec-changes" tabindex="-1" aria-labelledby="wc-d"><h2 class="panel-title" id="wc-d">What changed in ${D.newest_year}</h2>
      <p class="wc-lede-sm">${lede}</p>${badgeHTML(c)}${summary}
      ${units.length > 1 ? `<details class="values wc-lines-d"><summary>Change by ${isCounty() ? 'department' : 'bureau'}</summary>${divBars(units, c, 'wc-du', { title: isCounty() ? 'Department' : 'Bureau' })}</details>` : ''}
      ${pos ? `<details class="values wc-lines-d"><summary>Positions</summary>${pos}</details>` : ''}
      ${mine.length ? `<details class="values wc-lines-d"><summary>Largest line changes (${Math.min(6, mine.length)})</summary>${lineTableHTML(c, mine.slice(0, 6))}</details>` : ''}
      ${S.k === 'expense' ? shiftsHTML(c, di, ui, fund) : ''}
      <p>${link('See everything that changed →')}</p></section>`;
  }

  /* ---------- contents rail: where you are, and the sections of this page ---------- */
  let railScroll = null;
  function renderRail(here, onUnit) {
    document.querySelectorAll('#site-nav .rail-sub, #view .phone-toc').forEach((n) => n.remove());
    if (railScroll) { window.removeEventListener('scroll', railScroll); railScroll = null; }
    // The outline hangs under the page you are on, never under another page.
    const host = document.querySelector(`#site-nav a[data-nav="${here}"]`)?.closest('li');
    if (!host) return;
    const secs = [...document.querySelectorAll('#view section.panel')].map((sec) => {
      const h = sec.querySelector(':scope > h2, :scope > .compare > h2, :scope > h2.panel-title');
      const t = h?.textContent.trim().replace(/:.*$/, '').replace(/^.* (Budget|Spending|Revenue|Income) Breakdown$/i, '$1 breakdown');
      if (!t) return null;
      if (!sec.id) { sec.id = `sec-r${Math.random().toString(36).slice(2, 7)}`; sec.tabIndex = -1; }
      return { id: sec.id, label: t.length > 34 ? `${t.slice(0, 32)}…` : t, el: sec };
    }).filter(Boolean);
    const trail = [];
    if (onUnit) {
      [...document.querySelectorAll('.crumbs a')].filter((a) => !/^home$/i.test(a.textContent.trim()))
        .forEach((a) => trail.push(`<li><a href="${esc(a.getAttribute('href'))}">${esc(a.textContent.trim())}</a></li>`));
      const cur = document.getElementById('page-h')?.textContent.trim();
      if (cur) trail.push(`<li><a href="${esc(location.hash || '#/')}" aria-current="page">${esc(cur)}</a></li>`);
    }
    if (!trail.length && !secs.length) return;
    const list = secs.map((x) => `<li><a href="${esc(location.hash || '#/')}" data-scroll="${x.id}">${esc(x.label)}</a></li>`).join('');
    const ul = document.createElement('ul'); ul.className = 'rail-sub';
    ul.innerHTML = `${trail.join('')}${list ? `<li class="rail-sections"><span class="rail-h">On this page</span><ul>${list}</ul></li>` : ''}`;
    host.appendChild(ul);
    // Phones have no rail: the same outline sits under the page heading, closed.
    if (list) {
      const pageHead = document.querySelector('#view .page-head, #view header');
      const d = document.createElement('details'); d.className = 'phone-toc';
      d.innerHTML = `<summary>On this page</summary><ul>${secs.map((x) => `<li><a href="${esc(location.hash || '#/')}" data-scroll="${x.id}">${esc(x.label)}</a></li>`).join('')}</ul>`;
      pageHead?.insertAdjacentElement('afterend', d);
    }
    if (secs.length) {
      // Current section: the last one whose top has passed about a third of the way down the window.
      railScroll = () => {
        let cur = null;
        for (const x of secs) if (x.el.getBoundingClientRect().top <= window.innerHeight * 0.35) cur = x;
        ul.querySelectorAll('[data-scroll]').forEach((a) => { if (cur && a.dataset.scroll === cur.id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
      };
      window.addEventListener('scroll', railScroll, { passive: true });
      railScroll();
    }
  }

  /* ---------- render / events ---------- */
  async function onRoute(scroll = true) {
    if (!D) return;
    const { r, q, ent } = parseHash();
    if (ent !== ENT) { if (await loadEntity(ent)) onRoute(true); return; } // the other entity: load it, then draw this address
    route = r;
    if (scroll) { aboutOpen = false; explainOpen = false; const ls = $('view-status'); if (ls) ls.textContent = ''; } // a new page: the last control announcement no longer applies
    if (q.get('c') === 'none') { applyQuery(q); S.c = ''; } else applyQuery(q);
    if (route.name !== 'home' && (route.name !== 'changes' || isCounty()) && isReserve()) S.f = DEFAULT_FUND; // the reserve has no departments or bureaus (and the County's no What changed page)
    if (route.name === 'changes' && S.y !== D.newest_year) { S.y = D.newest_year; S.m = defaultMeasure(S.y); S.c = defaultCompare(S.y, S.m); }
    T.sort = 'sel'; T.dir = -1; T.q = route.name === 'dept' || route.name === 'bureau' ? (q.get('q') || '') : ''; T.shown = PAGE_SIZE;
    destroyCharts();
    notesShown = new Set();
    let page;
    if (route.name === 'home') page = { html: homeView(), after: () => { if (isReserve()) drawReserve(); else { drawTrend(); revExpAfter(); drawContext(); homePies.forEach(([id, items]) => drawSidePie(id, items)); } } };
    else if (route.name === 'changes') page = changesPage();
    else if (route.name === 'dept') page = deptPage();
    else if (route.name === 'about') page = { html: '<header class="page-head"><h1 id="page-h" tabindex="-1">About the data</h1></header>', after: () => { const t = q.get('s') && $(q.get('s')); if (t) { if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView(); } } };
    else if (route.name === 'terms') page = termsPage(q);
    else if (route.name === 'calendar') page = calendarPage();
    else if (route.name === 'missing') page = notFound('Page');
    else page = bureauPage();
    if (page.redirect) { navigate(page.redirect, true); return; }
    if (route.name === 'about') document.title = pageTitle('About the data');
    else if (route.name === 'missing') document.title = pageTitle('Page not found');
    $('view').innerHTML = page.html;
    addEyebrow();
    $('about').hidden = route.name !== 'about';
    document.body.classList.toggle('about-page', route.name === 'about');
    document.body.classList.toggle('terms-page', route.name === 'terms');
    document.body.classList.toggle('calendar-page', route.name === 'calendar');
    page.after?.();
    // Mark where the reader is in the contents.
    const here = route.name === 'changes' ? 'changes' : route.name === 'about' ? 'about' : route.name === 'terms' ? 'terms' : route.name === 'calendar' ? 'calendar' : route.name === 'home' ? (isReserve() ? 'reserve' : 'home') : 'home';
    const onUnit = route.name === 'dept' || route.name === 'bureau';
    document.querySelectorAll('#site-nav a').forEach((a) => { if (a.dataset.nav === here && !onUnit) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    pinControls();
    renderRail(here, onUnit);
    renderSwitch();
    // The rail's "What changed" link keeps the fund (the Reserve Fund included: that page says it shows the General Fund),
    // the figure and the comparison, and Spending / Income; from an earlier year it opens the newest year's defaults.
    const wcLink = document.querySelector('#site-nav a[data-nav="changes"]');
    if (wcLink && route.name !== 'changes') {
      const nm = defaultMeasure(D.newest_year);
      wcLink.setAttribute('href', changesHash(S.y === D.newest_year ? {} : { y: D.newest_year, m: nm, c: defaultCompare(D.newest_year, nm) }));
    }
    const jumpTo = (route.name === 'changes' || route.name === 'terms' || route.name === 'calendar') && q.get('s') ? $(q.get('s')) : null; // e.g. "How this is counted" from the Overview
    if (scroll && jumpTo) {
      jumpTo.scrollIntoView();
      jumpTo.focus({ preventScroll: true });
    } else if (scroll) {
      window.scrollTo({ top: 0 });
      $('page-h')?.focus({ preventScroll: true });
      if (T.q && $('sec-lines')) $('sec-lines').scrollIntoView(); // arrived from "Jump to…" with a line item: show the table
    }
  }

  /* Every page heading says which budget the page is about: a quiet eyebrow above the h1 with the entity's name from
     config.json (`entities.<id>.entity.short`). The h1 is described by it, so a screen reader announces both. */
  function addEyebrow() {
    const h = $('page-h'); if (!h || h.previousElementSibling?.id === 'page-eyebrow') return;
    const p = document.createElement('p'); p.className = 'eyebrow'; p.id = 'page-eyebrow'; p.textContent = CFG.entity.short;
    h.before(p); h.setAttribute('aria-describedby', 'page-eyebrow');
  }

  /* The pinned controls bar. --pin-h on <html> is how much of the bar stays on screen once pinned (0 where a page has no
     controls); html's scroll-padding-top uses it, so in-page jumps and keyboard focus land below the bar. On phones the
     status stamp scrolls away and the controls under it stay (top: -stamp height). A ResizeObserver keeps the numbers
     right when the bar wraps or the window changes; .is-stuck draws the ink rule under the bar once it is pinned. */
  let pinObserver = null, pinScroll = null;
  function pinControls() {
    pinObserver?.disconnect(); pinObserver = null;
    if (pinScroll) { window.removeEventListener('scroll', pinScroll); pinScroll = null; }
    const root = document.documentElement, bar = $('controls');
    if (!bar) { root.style.setProperty('--pin-h', '0px'); return; }
    const measure = () => {
      const stamp = bar.querySelector('.controls-stamp');
      bar.style.setProperty('--stamp-h', `${stamp ? stamp.offsetHeight + parseFloat(getComputedStyle(stamp).marginBottom) : 0}px`);
      const top = parseFloat(getComputedStyle(bar).top) || 0;
      root.style.setProperty('--pin-h', `${Math.ceil(bar.offsetHeight + top)}px`);
      pinScroll?.();
    };
    pinScroll = () => { const top = parseFloat(getComputedStyle(bar).top) || 0; bar.classList.toggle('is-stuck', window.scrollY > 0 && bar.getBoundingClientRect().top <= top + 1); };
    window.addEventListener('scroll', pinScroll, { passive: true });
    pinObserver = new ResizeObserver(measure);
    pinObserver.observe(bar);
    measure();
  }
  function setExplain(open, focusToggle = false) {
    explainOpen = open;
    const t = $('explain-toggle'), p = $('explain'); if (!t || !p) return;
    t.setAttribute('aria-expanded', String(open)); p.hidden = !open;
    if (open) p.scrollTop = 0;
    if (focusToggle) t.focus();
  }

  /* Compare panel: switch between "this year vs. comparison" and "over time" without re-rendering. */
  function setPane(id) {
    cmpTab = id;
    document.querySelectorAll('[data-pane-tab]').forEach((b) => { const on = b.dataset.paneTab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('.cmp-pane').forEach((p) => { p.hidden = p.id !== `cmp-pane-${id}`; });
    charts.forEach((c) => c.resize());
  }

  function wire() {
    window.addEventListener('hashchange', () => { if (!location.hash || location.hash.startsWith('#/')) onRoute(true); });
    // "Skip to content" moves focus to the main area without changing the page's address.
    // Rail links to this page's sections scroll like the in-page jumps do.
    $('site-nav')?.addEventListener('click', (e) => {
      const j = e.target.closest('[data-scroll]'); const t = j && $(j.dataset.scroll);
      if (!t) return;
      e.preventDefault(); t.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' }); t.focus({ preventScroll: true });
    });
    $('skip-link')?.addEventListener('click', (e) => { e.preventDefault(); $('main').focus(); $('main').scrollIntoView(); });
    const view = $('view');
    view.addEventListener('change', (e) => {
      const sel = e.target.closest('select');
      if (!sel) return;
      if (sel.dataset.pick) navigate(eh(`department/${sel.value}?${query()}`));
      else if (sel.dataset.sel) onFilter(sel.dataset.sel, sel.value);
    });
    view.addEventListener('click', (e) => {
      if (e.target.closest('#explain-toggle')) { setExplain(!explainOpen); return; }
      // In-page jump (e.g. "How this is counted"): scroll if the target is on this page, else follow the link.
      const jump = e.target.closest('[data-scroll]');
      if (jump && $(jump.dataset.scroll) && !$(jump.dataset.scroll).closest('#about')) {
        e.preventDefault();
        const tgt = $(jump.dataset.scroll);
        if (tgt.tagName === 'DETAILS') tgt.open = true;
        tgt.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
        tgt.focus({ preventScroll: true });
        return;
      }
      const pt = e.target.closest('[data-pane-tab]');
      if (pt) { setPane(pt.dataset.paneTab); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { onFilter(tab.dataset.tab, tab.dataset.v); return; }
      const card = e.target.closest('[data-go]');
      if (card && !e.target.closest('a')) navigate(card.dataset.go);
    });
    view.addEventListener('toggle', (e) => { if (e.target.classList?.contains('org-about')) aboutOpen = e.target.open; }, true);
    // "What do these mean?": Escape closes it and returns focus to its toggle; so does leaving the controls (by Tab or a
    // click elsewhere), so the open panel never covers the part of the page in use.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && explainOpen && !e.defaultPrevented) { e.preventDefault(); setExplain(false, true); } });
    view.addEventListener('focusout', (e) => { if (explainOpen && e.target.closest('#controls') && e.relatedTarget && !e.relatedTarget.closest('#controls')) setExplain(false); });
    document.addEventListener('pointerdown', (e) => { if (explainOpen && !e.target.closest('#controls')) setExplain(false); });
    // Name every data table and give sideways-scrolling regions a keyboard stop and a label.
    let a11yQueued = false;
    const a11yPass = () => {
      a11yQueued = false;
      document.querySelectorAll('#view table').forEach((t) => {
        if (t.querySelector('caption') || t.hasAttribute('aria-label') || t.hasAttribute('aria-labelledby')) return;
        const head = t.closest('section')?.querySelector('h1, h2')?.textContent.trim() || document.getElementById('page-h')?.textContent.trim() || '';
        const what = t.closest('details')?.querySelector('summary')?.textContent.trim().replace(/^Show (as a )?/i, '') || '';
        t.setAttribute('aria-label', [head, /^(table|values)$/i.test(what) ? 'data table' : what].filter(Boolean).join(', '));
      });
      document.querySelectorAll('#view .table-scroll, #view .chart-scroll').forEach((el) => {
        const over = el.scrollWidth > el.clientWidth + 1;
        if (over && !el.hasAttribute('tabindex')) {
          const n = el.querySelector('table')?.getAttribute('aria-label') || el.closest('section')?.querySelector('h2')?.textContent.trim() || 'Content';
          el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region'); el.setAttribute('aria-label', `${n}, scrolls sideways`); el.dataset.a11y = '1';
        } else if (!over && el.dataset.a11y) {
          ['tabindex', 'role', 'aria-label', 'data-a11y'].forEach((a) => el.removeAttribute(a));
        }
      });
    };
    const queueA11y = () => { if (!a11yQueued) { a11yQueued = true; setTimeout(a11yPass, 50); } };
    new MutationObserver(queueA11y).observe(view, { childList: true, subtree: true });
    view.addEventListener('toggle', queueA11y, true);
    window.addEventListener('resize', queueA11y);
    view.addEventListener('keydown', (e) => {
      const pb = e.target.closest('[data-pane-tab]');
      if (pb && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const o = [...pb.parentElement.querySelectorAll('[data-pane-tab]')].find((x) => x !== pb);
        if (o) { setPane(o.dataset.paneTab); o.focus(); }
        return;
      }
      // Spending / Income (a radio group): arrow keys move the choice, Home / End go to the first / last.
      const b = e.target.closest('[data-tab]');
      if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const btns = [...b.parentElement.querySelectorAll('button')], i = btns.indexOf(b);
      const n = e.key === 'Home' ? btns[0] : e.key === 'End' ? btns[btns.length - 1]
        : btns[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
      e.preventDefault(); if (n === b) return; onFilter(n.dataset.tab, n.dataset.v);
      requestAnimationFrame(() => $('view').querySelector(`[data-tab="${n.dataset.tab}"][data-v="${n.dataset.v}"]`)?.focus());
    });
  }

  /* ---------- "Jump to…" search: departments, bureaus and line items ----------
     A combobox with a listbox: arrow keys move, Enter opens, Escape closes. A line item opens its bureau (or
     department) page with the line-item search pre-filled (the q= parameter). */
  let jumpIndex = null;
  const JT = () => (isCounty() ? ['Group', 'Department', 'Line item'] : ['Department', 'Bureau', 'Line item']);
  function buildJumpIndex() {
    const JT_ = JT(); // eslint-disable-line

    const out = [];
    O.departments.forEach((d, i) => out.push({ t: JT_[0], name: d.name, sub: '', href: deptHash(i, { f: DEFAULT_FUND }), hay: d.name.toLowerCase(), rank: 0 }));
    O.units.forEach((u, i) => { if (u.kind === 'bureau' && O.departments[u.dept].bureaus) out.push({ t: JT_[1], name: u.name, sub: O.departments[u.dept].name, href: unitHash(i), hay: `${u.name} ${O.departments[u.dept].name}`.toLowerCase(), rank: 1 }); });
    const seen = new Set();
    D.accounts.forEach((a) => {
      const id = `${a[0]}|${a[1]}`; if (seen.has(id)) return; seen.add(id);
      const u = O.codes[a[0].split('-')[0]]; if (u == null) return;
      const unit = O.units[u], dept = O.departments[unit.dept];
      const over = { k: D.categories[a[5]] === 'Revenue' ? 'revenue' : 'expense', f: D.funds[a[2]] };
      const base = dept.bureaus && unit.kind !== 'whole-department' ? unitHash(u, over) : deptHash(unit.dept, over);
      out.push({ t: JT_[2], name: a[1], sub: `${a[0]} · ${unit.kind === 'bureau' ? unit.name : dept.name}`, href: `${base}&q=${encodeURIComponent(a[0])}`, hay: `${a[0]} ${a[1]} ${unit.name}`.toLowerCase(), rank: 2 });
    });
    return out;
  }
  function initJump() {
    const input = $('jump-input'), list = $('jump-list'), status = $('jump-status');
    if (!input || !list) return;
    let items = [], active = -1;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const setActive = (i) => {
      active = i;
      list.querySelectorAll('[role=option]').forEach((o, n) => { o.setAttribute('aria-selected', String(n === i)); if (n === i) o.scrollIntoView({ block: 'nearest' }); });
      if (i >= 0) input.setAttribute('aria-activedescendant', `jump-opt-${i}`); else input.removeAttribute('aria-activedescendant');
    };
    const go = (it) => { close(); input.value = ''; status.textContent = ''; location.hash = it.href; };
    function render() {
      const q = input.value.trim().toLowerCase();
      if (!q) { close(); status.textContent = ''; return; }
      jumpIndex = jumpIndex || buildJumpIndex();
      const toks = q.split(/\s+/);
      const hits = jumpIndex.filter((x) => toks.every((t) => x.hay.includes(t)));
      hits.sort((a, b) => a.rank - b.rank || (b.hay.startsWith(q) - a.hay.startsWith(q)) || a.name.localeCompare(b.name));
      const take = (t, n) => hits.filter((x) => x.t === t).slice(0, n);
      const jt = JT();
      items = [...take(jt[0], 4), ...take(jt[1], 6), ...take(jt[2], 8)];
      list.innerHTML = items.length ? items.map((it, i) => `<li role="option" id="jump-opt-${i}" aria-selected="false" data-i="${i}"><span class="jt">${it.t}</span><span class="jn">${esc(it.name)}</span>${it.sub ? `<span class="js">${esc(it.sub)}</span>` : ''}</li>`).join('')
        : '<li class="jump-none" role="presentation">No matches</li>';
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      setActive(items.length ? 0 : -1);
      status.textContent = items.length ? `${items.length} result${items.length === 1 ? '' : 's'}${hits.length > items.length ? ` shown of ${hits.length}` : ''}. Use the up and down arrow keys, then Enter.` : 'No matches.';
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) { render(); return; }
        if (items.length) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      } else if (e.key === 'Enter') { if (!list.hidden && items[active]) { e.preventDefault(); go(items[active]); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } else input.value = ''; }
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('[data-i]'); if (li) { e.preventDefault(); go(items[+li.dataset.i]); } });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  /* ---------- about ---------- */
  function scrubPages(text) {
    // Notes quote source page numbers; the site does not show page references.
    return text.replace(/\s*(?:\(|,)?\s*(?:on |from |at )?\b(?:pp?\.?|pages?)\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:and|,)\s*(?:pp?\.?|pages?)?\s*\d+)*\)?/gi, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  /* Group each heading with what follows it, so wide screens can lay the sections out as a grid. */
  function groupAbout() {
    const ab = $('about-body'), secs = [];
    [...ab.childNodes].forEach((n) => {
      if (n.nodeType === 1 && n.classList.contains('about-h')) { secs.push(document.createElement('section')); secs[secs.length - 1].className = 'about-sec'; }
      if (secs.length) secs[secs.length - 1].appendChild(n);
    });
    secs.forEach((x) => { if (x.querySelector('details, .about-wide') || /Known problems|Get the data|General Fund balance|Actual figures/.test(x.firstChild.textContent)) x.classList.add('about-sec-wide'); ab.appendChild(x); });
    $('generated').textContent = `Data built ${D.generated.slice(0, 10)}.`;
  }
  function renderAboutCounty() {
    const A = D.actuals, ac = CFG.adopted, pdf = (rel) => `${CFG.paths.pdfs}${rel.split('/').map(encodeURIComponent).join('/')}`;
    const yrOf = Object.fromEntries(A.sources.map((x) => [x.file, x.year]));
    const RS = D.reserve?.sources || [];
    const nameOf = Object.fromEntries([...D.books.map((b) => [b.doc, `${b.year} Budget Book`]), ...A.sources.map((x) => [x.file, `${x.year} audited annual report`]), ...RS.map((x) => [x.file, x.resolution])]);
    const resols = RS.map((x) => `<li><a href="${pdf(`Resolutions/${x.file}`)}" target="_blank" rel="noopener">${esc(x.resolution)}</a> (<a href="${pdf(`Resolutions/${x.file}`)}" download>download PDF</a>; <a href="${esc(x.url)}" target="_blank" rel="noopener">County page</a>): the ${x.budget_year} budget.</li>`).join('');
    const books = D.books.filter((b) => b.used).map((b) => `<li><a href="${pdf(b.doc)}" target="_blank" rel="noopener">${esc(nameOf[b.doc])}</a> (<a href="${pdf(b.doc)}" download>download PDF</a>): supplies ${b.figures.map((y) => `${y} Budget`).join(' and ')}.</li>`).join('');
    const acfrs = A.sources.map((x) => `<li><a href="${pdf(`ACFR/${x.file}`)}" target="_blank" rel="noopener">${esc(nameOf[x.file])}</a> (<a href="${pdf(`ACFR/${x.file}`)}" download>download PDF</a>; <a href="${esc(x.url)}" target="_blank" rel="noopener">County archive page</a>).</li>`).join('');
    const shownIssues = D.known_issues.filter((i) => !noOriginal(i.note)), nOrig = D.known_issues.length - shownIssues.length;
    const issues = shownIssues.map((i) => `<li>${esc(nameOf[i.source_doc] || i.source_doc.replace(/\.pdf$/i, ''))}: ${esc(cleanNote(i.note))}</li>`).join('') + (nOrig ? `<li>${nOrig} further notes compare the audited report's own “original budget” column with the budget books. That column is not used on this site, so they are kept in the project <a href="${CFG.project_repository}">repository</a> and not listed here.</li>` : '');
    const groups = O.departments.map((g) => `${esc(g.name)} (${g.letter})`).join(', ');
    const fundList = Object.entries(CFG.fund_names || {}).filter(([k]) => D.funds.includes(k)).map(([k, v]) => `<li>${esc(v)}</li>`).join('');
    const gbYears = GB ? [...new Set(GB.rows.map((r) => r.year))].sort((a, b) => a - b) : [];
    const gbLines = GB ? [...new Set(GB.rows.map((r) => r.line))] : [];
    const gbTable = GB ? `<div class="table-scroll"><table class="table ledger" aria-label="Audited fund balances at December 31"><thead><tr><th scope="col">At December 31</th>${gbYears.map((y) => `<th scope="col" class="num">${y}</th>`).join('')}</tr></thead><tbody>${gbLines.map((ln) => `<tr><th scope="row">${esc(ln)}</th>${gbYears.map((y) => { const r = GB.rows.find((x) => x.year === y && x.line === ln); return `<td class="num">${r ? gbLink(money(r.v), r) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    const PR = D.context?.presentation;
    const ctxAbout = PR ? `<h2 class="about-h">Context facts</h2>
      <p>The “${D.context.year} Budget in Context” section on the overview shows the tax rate and its history, the taxable assessed value, the bond rating, the Capital Improvement Fund and the agency grants. Each figure links to the page that prints it in <a href="${pdf(`Resolutions/${RS.find((x) => x.budget_year === D.context.year)?.file || ''}`)}" target="_blank" rel="noopener">${esc(RS.find((x) => x.budget_year === D.context.year)?.resolution || 'the budget resolution')}</a>, the ${D.context.year} budget book or the ${A.years[A.years.length - 1]} audited annual report. They are shown as printed; a figure that the County's presentation gave differently from those documents would not be shown.</p>
      <p>The County's <a href="${pdf(PR.file)}" target="_blank" rel="noopener">${D.context.year} budget presentation</a> (<a href="${pdf(PR.file)}" download>download PDF</a>; <a href="${esc(PR.url)}" target="_blank" rel="noopener">County page</a>) repeats these figures and is the only source for the number of funded staffing positions. A slide deck is not a primary document, so the site uses none of its other figures: its fund balances, revenue and spending are budget-basis or proposed figures that differ from the adopted resolution and the audit.</p>` : '';
    const merges = (CH?.account_changes || []).map((m) => `<li>${esc(m.from.join(' and '))} → ${esc(m.to)} ${esc(m.to_name)}: ${esc(m.evidence)}</li>`).join('');
    $('about-body').innerHTML = `
      <h2 class="about-h">Sources</h2>
      <p>Every Budget figure comes from the County of Lancaster's published budget books. Each book reports two or three years side by side; this site shows <strong>one Budget figure per year</strong>, from the newest book that prints that year, and labels it simply “Budget”.</p>
      <ul>
        <li><strong>${D.newest_year}: Budget</strong>${ac ? `, ${esc(ac.text)}` : ''}.</li>
        <li><strong>${years().filter((y) => y < D.newest_year).sort((a, b) => a - b).join(', ')}: Budget</strong>, as the next year's book prints them. The books do not say whether these are the original or an amended budget, so the site calls them Budget.</li>
      </ul>
      <p>Books in use:</p><ul>${books}</ul>
      <p>Years appear as soon as the books that report them have been processed.</p>
      <p>Not sure what a word or fund means? See <a href="${eh('terms')}">Funds and terms</a>.</p>
      <h2 class="about-h">Actual figures</h2>
      <p>Actual figures for ${A.years[0]} to ${A.years[A.years.length - 1]} come from the County's audited annual reports, in the budget-versus-actual schedules.</p>
      <ul>${D.actuals_note.map((t) => cleanNote(t)).filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p>Audited reports in use:</p><ul>${acfrs}</ul>
      ${ctxAbout}
      <h2 class="about-h">Departments and funds</h2>
      <p>Departments are grouped as the County's <a href="${pdf(O.chart_doc)}#page=${O.chart_page}" target="_blank" rel="noopener">${D.newest_year} budget book</a> groups them: ${groups}. Each budget line belongs to a department by its account number, with the department's name as the book prints it. The County does not publish staffing schedules, so there is no Staff section.</p>
      ${O.elected_chart ? `<h2 class="about-h" id="about-elected" tabindex="-1">How the County is run, and the elected offices</h2>
      <p>Three Commissioners, elected by the voters, manage the County. Alongside them, officials elected on their own (the “row offices”: Controller, Coroner, Recorder of Deeds, Treasurer, Clerk of Courts, Prothonotary, Register of Wills, Sheriff and District Attorney) head their own offices, and the judges of the Court of Common Pleas and the Magisterial District Judges are elected too. The County's <a href="${pdfHref(O.elected_chart.d, O.elected_chart.p)}" target="_blank" rel="noopener">2026 budget presentation (slide 3)</a> marks each of them with an asterisk on its organizational chart, and the audited report's <a href="${pdfHref(O.elected_list.d, O.elected_list.p)}" target="_blank" rel="noopener">list of elected officials</a> names them. Departments headed by an elected official, or serving elected judges, say so on their page and in the department lists. The budget book's own groups, and their printed totals, are unchanged.</p>` : ''}
      <p>The County's books print fund letters without names. The names shown here come from the County's audited annual reports:</p>
      <ul>${fundList}</ul>
      <h2 class="about-h" id="about-balance" tabindex="-1">General Fund balance</h2>
      ${D.reserve ? `<p>The <strong>${esc(D.reserve.name)}</strong> entry, last in the Fund list, shows the General Fund's accumulated balance in two separate measures:</p>
      <ul><li><strong>Budget</strong>: the budget resolution the Commissioners adopt with each year's budget prints the General Fund's balance at the start of the year, its receipts and expenditures, and the balance remaining at the end. That is how the County covers a budget gap: from the balance. These are the County's own estimates, on its budget basis. The planned change (receipts minus expenditures) is calculated by this site; every other figure is as printed.</li>
      <li><strong>Actual</strong>: the audited balance at December 31 from the County's audited annual reports, on its accounting (modified accrual) basis.</li></ul>
      <p>The two are counted differently and do not tie, so they are never combined. Under each Budget year the page gives the audited balance for the same date. The County's budget books themselves print no General Fund balance page.</p>
      <p>Budget resolutions in use:</p><ul>${resols}</ul>
      <p>All audited fund balances (General Fund, other governmental funds and the total):</p>`
      : `<p>The County's budget books print no General Fund balance page, so this site cannot say how the General Fund's budget gap is met. The audited annual reports do print year-end fund balances. These are <strong>audited year-end balances on the County's accounting (modified accrual) basis</strong>, not budget figures: they are not comparable with the Budget or with the Actual figures above, and they are not a projection.</p>`}
      ${gbTable}
      <h2 class="about-h">Validation</h2>
      <p>Line items were extracted from the PDFs by script (the 2024 book is a scan and was read with OCR, then checked line by line). Figures are shown as printed, never adjusted. Where overlapping books disagree on the same figure, the newest book wins and the disagreement is logged (${D.conflict_count} so far). Lines of $0 are left out.</p>
      <h2 class="about-h" id="about-merges" tabindex="-1">Merged accounts</h2>
      <p>In the 2026 book the County folded some accounts into others and restated 2025 to match. Where that happens, What changed compares the accounts as one line in both years and says so under the line.</p>
      <ul>${merges || '<li>None recorded.</li>'}</ul>
      <h2 class="about-h" id="about-totals">Printed and calculated totals</h2>
      <p>Every total is shown exactly as the County printed it, and links to its page. The site adds up the line items under each printed total only to check it. A difference of up to $5 on a department total, or up to 50 cents for each line in a larger roll-up, is rounding to whole dollars and is not mentioned.</p>
      <p>Where the lines add up to something else, the printed total is still the one shown. It carries a <span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> sign, and a note beside it gives what the lines add up to and the reviewed explanation from the list below.</p>
      <p>Where the book prints no total for exactly what you are looking at, the figure is this site's own sum of the line items, labelled <span class="calc-tag">calculated</span>.</p>
      <h2 class="about-h" id="about-income" tabindex="-1">What counts as income</h2>
      <p>Income is money coming in: taxes, fees, grants, state and federal payments, interest and the like. The budget books also list as revenue money drawn from savings and money moved in from ${ownFunds()} other funds. The site leaves both out of income, so an income total is usually this site's own sum, labelled calculated, rather than the book's printed revenue total. What one of ${ownFunds()} funds charges another for services stays in the income of the fund that is paid, marked on its lines, and is left out of the All funds total so it is not counted twice. Spending is shown as printed, transfers out included. <a href="${termHref('term-income')}">More on what counts as income</a></p>
      <h2 class="about-h">Known problems in the source books</h2>
      <p>These come from errors or differences in the County's documents, not the extraction. A person reviewed each one.</p>
      <details class="values" id="about-issues" tabindex="-1"><summary>Show all ${shownIssues.length + (nOrig ? 1 : 0)} notes</summary><ul>${issues || '<li>None recorded.</li>'}</ul></details>
      <h2 class="about-h">Get the data</h2>
      <p><a href="${CFG.paths.data}budget.json">budget.json</a> (every figure shown here, including the Actual figures), <a href="${CFG.paths.data}changes.json">changes.json</a> (what changed in ${D.newest_year}), <a href="${CFG.paths.data}conflicts.json">conflicts.json</a> and <a href="${CFG.paths.data}fund_balance_gaap.json">fund_balance_gaap.json</a> (audited year-end balances). The extraction scripts and tables are in the project <a href="${CFG.project_repository}">repository</a>.</p>${CFG.contact_email ? `
      <h2 class="about-h">Contact</h2>
      <p>Found an error, or have a question about a figure? Email <a href="mailto:${esc(CFG.contact_email)}">${esc(CFG.contact_email)}</a>.</p>` : ''}`;
    groupAbout();
  }
  function renderAbout() {
    if (isCounty()) { renderAboutCounty(); return; }
    const used = D.books.filter((b) => b.used);
    const yrsOf = (m) => Object.values(D.series).filter((x) => x.measure === m).map((x) => x.year).sort((a, b) => a - b);
    const actualYears = yrsOf('actual'), projYears = yrsOf('projected');
    const figs = (b) => Object.values(D.series).filter((s) => s.year + D.rule[s.measure].book_offset === b.year && D.docs[Array.isArray(s.doc) ? s.doc[0] : s.doc] === b.doc)
      .sort((a, c) => a.year - c.year || PICK_ORDER.indexOf(c.measure) - PICK_ORDER.indexOf(a.measure)).map((s) => `${s.year} ${LABEL[s.measure].toLowerCase()}`);
    const bookName = (b) => `${b.year} ${/revised|proposed/i.test(b.doc) ? 'Revised Proposed Budget' : 'Adopted Budget'}`;
    const nameOf = Object.fromEntries(D.books.map((b) => [b.doc, bookName(b)]));
    const books = used.map((b) => { const f = figs(b); const href = `${CFG.paths.pdfs}${encodeURIComponent(b.doc)}`; return `<li><a href="${href}" target="_blank" rel="noopener">${esc(bookName(b))}</a> (<a href="${href}" download>download PDF</a>): ${f.length ? 'supplies ' + f.join(', ') : 'no figures under the selection rule'}.</li>`; }).join('');
    const issues = D.known_issues.map((i) => `<li>${esc(nameOf[i.source_doc] || i.source_doc.replace(/\.pdf$/i, ''))}: ${esc(scrubPages(i.note))}</li>`).join('');
    $('about-body').innerHTML = `
      <h2 class="about-h">Sources</h2>
      <p>Every figure comes from ${esc(CFG.entity.possessive)} published budget books. Each book reports several years side by side; this site picks <strong>one main kind of figure per year</strong>, which the multi-year charts and tables draw:</p>
      <ul>
        <li><strong>${actualYears[0]}–${actualYears[actualYears.length - 1]}: Actual</strong>, the audited spending reported in the budget book published two years later.</li>
        ${projYears.length ? `<li><strong>${projYears.join(', ')}: Projected</strong>, the city's year-end estimate (the revised projection when present) from the next year's book. The actual for ${projYears.length > 1 ? 'these years is' : 'this year is'} not published yet.</li>` : ''}
        <li><strong>${D.newest_year}: Proposed and Revised</strong>, both from the ${D.newest_year} book, so you can compare what changed between them. Neither is an adopted budget.</li>
        ${projectionYears().length ? `<li><strong>${projectionYears().join(' and ')}: Projection</strong>, the city's own multi-year estimates made with the ${D.projection.after_year} budget, from its ${srcDoc(esc(projBook()), D.projection.doc, 1)}. They appear only at the end of the multi-year charts and tables (Totals by Year and the Staff salaries table), drawn lighter and labelled “Projection”; they are never the year you pick, and the headline, the change sentence and What changed stay on ${D.newest_year}.</li>` : ''}
      </ul>
      ${(() => { const am = yrsOf('amended'), ad = yrsOf('adopted'); return am.length || ad.length ? `<p>Each year also has <strong>one budget figure</strong> you can pick in Budget year or Compare with: the <strong>Amended</strong> budget where the next year's book prints one${am.length ? ` (${rangeText(am)})` : ''}, otherwise the <strong>Adopted</strong> budget${ad.length ? ` (${rangeText(ad)})` : ''}; never both. It is not drawn on the multi-year charts.</p>` : ''; })()}
      <p>Year-to-date columns and an older book's own-year proposal are not shown.</p>
      ${D.projection ? (() => {
        const P = D.projection, page = (P.assumptions[0] || {}).p;
        return `<h2 class="about-h">Projections</h2>
      <p>The ${srcDoc(esc(projBook()), P.doc, 1)} prints every account line of the General Fund and the four utility funds for ${P.years.join(' and ')}, with each fund's total income, total spending and surplus or deficit. The site checks every section and fund total against its lines, as it does for the budget books. Its ${page ? srcDoc('assumptions', P.doc, page) : 'assumptions'}: no water, sewer, stormwater or trash rate increases; 3% salary increases; General Fund costs following each department's history; and, in the utility funds, 5% medical and 2% operating cost increases. The city notes that actual results will differ where costs depart from past trends.</p>
      <p>The projections list no money drawn from savings (their “Fund Balance Reserve” lines are blank), so where spending is higher than income they show a deficit. They have no Fund Balance Projection page, so the Reserve Fund ends at ${D.newest_year}.</p>`;
      })() : ''}
      ${D.reserve ? `<h2 class="about-h">Reserve Fund</h2>
      <p>The <strong>Reserve Fund</strong> entry in the Fund selector is the General Fund's balance, from the budget book's Fund Balance Projection page. Each book prints the actual balance at the end of the year two years earlier; that is the <strong>actual</strong> year-end balance for that year (unaudited for recent years). The newest book also prints a projected balance for the prior year and proposed and revised balances for the newest year. The same one-kind-per-year rule applies. Where a book prints two columns that disagree, the revised column is used and the difference is stated on the page.</p>` : ''}
      <p>Books in use:</p><ul>${books}${D.projection ? (() => { const href = `${CFG.paths.pdfs}${encodeURIComponent(D.docs[D.projection.doc])}`; return `<li><a href="${href}" target="_blank" rel="noopener">${esc(D.projection.years.join('–'))} Budget Projections</a> (<a href="${href}" download>download PDF</a>): supplies ${D.projection.years.map((y) => `${y} projection`).join(', ')}.</li>`; })() : ''}</ul>
      <p>Years appear as soon as the books that report them have been processed.</p>
      <p>Not sure what a word or fund means? See <a href="${eh('terms')}">Funds and terms</a>.</p>
      ${CFG.budget_calendar ? `<p>Who prepares and approves the budget, and by when: <a href="${eh('budget-calendar')}">How the City budget is made</a>, the budget calendar in the City's ${esc(CFG.budget_calendar.charter_title)}.</p>` : ''}
      <h2 class="about-h">Departments and bureaus</h2>
      <p>Departments and bureaus follow the city's <a href="${CFG.paths.pdfs}${encodeURIComponent(O.chart_doc)}" target="_blank" rel="noopener">2027 organizational chart</a>. Each budget line belongs to a bureau by its account number, so older years are grouped the same way even where the budget book printed them under another department or name (for example, Human Resources is shown under Executive in every year). Budget groups that are not a bureau, such as city-wide insurance, benefits and debt service or fee revenue, are shown as a separate “department-wide” group. Descriptions of what each department and bureau does are quoted from the city's <a href="${CFG.paths.pdfs}${encodeURIComponent(O.desc_doc)}" target="_blank" rel="noopener">2027 organization descriptions</a>.</p>
      <h2 class="about-h">Validation</h2>
      <p>Line items were extracted from the PDFs by script (scanned books were OCR'd first). Figures are shown as printed, never adjusted. Where overlapping books disagree on the same figure, the rule above decides and the disagreement is logged (${D.conflict_count} so far). Lines of $0 are left out.</p>
      <h2 class="about-h" id="about-totals">Printed and calculated totals</h2>
      <p>Every total is shown exactly as the city printed it, and links to its page. The site adds up the line items under each printed total (each section, department roll-up and fund) only to check it. A difference of up to $5 on a section total, or up to 50 cents for each line in a larger roll-up, is the city's rounding to whole dollars and is not mentioned.</p>
      <p>Where the lines add up to something else, the printed total is still the one shown. It carries a <span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> sign, and a note beside it gives what the lines add up to, the difference, and the reviewed explanation from the list of known problems below.</p>
      <p>Where the book prints no total for exactly what you are looking at, the figure is this site's own sum of the line items, labelled <span class="calc-tag">calculated</span>. That covers all funds together, departments and bureaus regrouped to the 2027 org chart, spending categories, and line items narrowed by a search.</p>
      <h2 class="about-h" id="about-income" tabindex="-1">What counts as income</h2>
      <p>Income is money coming in: taxes, fees, grants, state and federal payments, interest and the like. The budget books also list as revenue money drawn from savings and money moved in from ${ownFunds()} other funds. The site leaves both out of income, so an income total is usually this site's own sum, labelled calculated, rather than the book's printed revenue total. What one of ${ownFunds()} funds charges another for services stays in the income of the fund that is paid, marked on its lines, and is left out of the All funds total so it is not counted twice. Spending is shown as printed, transfers out included. <a href="${termHref('term-income')}">More on what counts as income</a></p>
      <h2 class="about-h">Known problems in the source books</h2>
      <p>These come from errors in the city's documents, not the extraction. A person reviewed each one.</p>
      <details class="values" id="about-issues" tabindex="-1"><summary>Show all ${D.known_issues.length} notes</summary><ul>${issues || '<li>None recorded.</li>'}</ul></details>
      <h2 class="about-h">Get the data</h2>
      <p><a href="${CFG.paths.data}budget.json">budget.json</a> (every figure shown here${D.projection ? ', with the projections in its <code>projection</code> block' : ''}), <a href="${CFG.paths.data}staffing.json">staffing.json</a> (budgeted positions), <a href="${CFG.paths.data}conflicts.json">conflicts.json</a>, <a href="${CFG.paths.data}changes.json">changes.json</a> (what changed in ${D.newest_year}, with the fund shifts and position counts). The extraction scripts and tables are in the project <a href="${CFG.project_repository}">repository</a>.</p>${CFG.contact_email ? `
      <h2 class="about-h">Contact</h2>
      <p>Found an error, or have a question about a figure? Email <a href="mailto:${esc(CFG.contact_email)}">${esc(CFG.contact_email)}</a>.</p>` : ''}`;
    groupAbout();
  }

  /* ---------- Funds and terms: the reference page (#/terms, #/county/terms) ----------
     What each fund is paid for with (taxes or something else) and what every figure word on the site means. One page per
     entity; the fund rows follow D.funds, so a fund the data does not have is not listed. Opened from the "What do these
     mean?" panel under the controls, from the status stamp, from About and from the contents. */
  const FUND_INFO = {
    city: {
      'General Fund': ['Mostly taxes', 'The city\'s everyday budget: police, fire, streets, parks and administration. Paid for mostly by taxes (real estate, earned income, local services and real estate transfer taxes), plus fees, licenses and other city income. Every other fund below is kept apart from it.'],
      'Stormwater Management Fund': ['Fees, not taxes', 'Paid for by the stormwater management fee charged to property owners.'],
      'Sewer Fund': ['Fees, not taxes', 'Paid for by sewage treatment charges to customers.'],
      'Water Fund': ['Fees, not taxes', 'Paid for by water rents (customers\' water bills).'],
      'Solid Waste & Recycling Fund': ['Fees, not taxes', 'Paid for by trash fees, with some state recycling grant money.'],
      'Liquid Fuels Fund': ['State money, not city taxes', 'The city\'s share of the state\'s liquid fuels (motor fuel) money, spent on streets. The data lists it only for the years the books print it.'],
      'Long\'s Park Fund': ['Rentals and gifts, not taxes', 'Paid for by pavilion and amphitheater rentals, concessions, contributions and investment earnings, and spent on Long\'s Park. The data lists it only for the years the books print it.'],
    },
    county: {
      'General Fund': ['Mostly taxes', 'Pays for most County services. Paid for mostly by property taxes, plus fees, state and federal payments and other income.'],
      'Fund B': ['State money, not County taxes', 'The County\'s share of the state\'s liquid fuels (motor fuel) money, which its books list as a state grant, spent on County bridges and roads.'],
      'Fund E': ['Grants, not taxes', 'Federal and state grants, fees and transfers from other funds, for drug and alcohol programs.'],
      'Fund EI': ['Grants, not taxes', 'Federal and state grants, Medical Assistance and transfers from other funds, for early intervention services for young children.'],
      'Fund F': ['Fees and grants, not taxes', 'Federal incentive payments and fees, with transfers from other funds, for the domestic relations (child support) office.'],
      'Fund G': ['Grants, not taxes', 'Federal and state grants, fees, contributions and transfers from other funds, for aging services.'],
      'Fund H': ['Grants, not taxes', 'Federal and state grants, Medical Assistance and transfers from other funds, for behavioral health services.'],
      'Fund R': ['Grants, not taxes', 'Federal and state grants and Medical Assistance, for developmental services.'],
      'Fund Y': ['Grants, not taxes', 'Federal and state grants and transfers from other funds, for children and youth services.'],
    },
  };
  const rangeText = (ys) => (ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`);
  const fundYears = (i) => rangeText([...new Set(Object.values(D.series).filter((x) => x.funds.includes(i)).map((x) => x.year))].sort((a, b) => a - b));
  const termDl = (items, cls = '') => `<dl class="terms-dl${cls}">${items.map(([id, t, d]) => `<dt id="term-${id}" tabindex="-1">${t}</dt><dd>${d}</dd>`).join('')}</dl>`;
  /* The wording shared by this page and the controls' "What do these mean?" panel (explainHTML): one copy of each. */
  const FUND_INTRO = 'A fund is a separate account kept for a purpose. Money in one fund is not mixed with another, so a fund paid for by fees can only be spent on its own service. Only the General Fund is paid for mostly by taxes.';
  const fundInfo = (f) => FUND_INFO[ENT][f] || ['See the books', 'The books do not describe this fund.'];
  // The Reserve Fund (City) or General Fund Balance (County): [id, name, definition], or null where the data has none.
  function balanceWord() {
    if (!D.reserve) return null;
    const open = `<a href="${eh(`?f=${encodeURIComponent(D.reserve.name)}`)}">Open the ${esc(D.reserve.name)}</a>.`;
    return ['balance', esc(D.reserve.name), isCounty()
      ? `The General Fund's accumulated balance: what it has kept over the years, which is how the County covers a budget gap. It is the General Fund's own savings, so it is tax-funded in the same way. The page shows two measures side by side and never adds them together: <strong>Budget</strong> (the budget resolution's estimate) and <strong>Actual</strong> (the audited balance at December 31). ${open}`
      : `The General Fund's savings: the balance it carries from year to year, not a separate fund with spending of its own. When the General Fund spends more than it takes in, the difference is drawn from it. Because it is the General Fund's own savings, it is tax-funded in the same way. ${open}`];
  }
  // Every figure word: [id, label, definition]. The page lists them all; the controls' panel the ones its entity uses.
  function figureWords() {
    const yrsOf = (m) => Object.values(D.series).filter((x) => x.measure === m).map((x) => x.year).sort((a, b) => a - b);
    const yr = (m) => (yrsOf(m).length ? rangeText(yrsOf(m)) : '');
    const income = ['income', 'Income', `Money coming in from outside ${isCounty() ? 'the County' : 'the City'}: taxes, fees and charges for services, fines, grants, state and federal payments, interest and rent. The budget books also list as revenue some money that is not coming in, and the site leaves it out of income: <strong>money drawn from savings</strong>${isCounty() ? ' (the County\'s budget books list none)' : ' (the “Fund Balance Reserve” lines)'} and <strong>transfers</strong> from ${ownFunds()} other funds. What ${ownFunds()} funds <strong>charge one another</strong> for services (${isCounty() ? 'indirect costs' : 'administration, Treasury, IT and similar'}) is income of the fund that is paid, and is marked on its lines, but is left out of the All funds total so the same money is not counted twice. Spending is shown as printed, including transfers out. Each kept-out line is listed, with the book's own explanation, in <code>data/income_rules.csv</code>.`];
    const calc = ['calculated', `<span class="calc-tag">calculated</span>`, `This site's own sum of line items, shown where the book prints no total for exactly what you are looking at (for example all funds together, or a search result). A total the book does print is shown as printed, with a link to its page. Details are under <a href="${eh('about?s=about-totals')}">Printed and calculated totals</a> in About the data.`];
    return isCounty()
      ? [['budget', 'Budget', `The County's budget for the year, from its own budget books. The newest year (${D.newest_year}) is the budget the County passed${CFG.adopted ? `, ${esc(CFG.adopted.text)}` : ''}. Earlier years are as the next book prints them. The books do not say whether those are the original or an amended budget, so the site calls them Budget.`],
        ['actual', 'Actual', `What the County's audited annual report says it received and spent, shown only for ${D.actuals ? rangeText(D.actuals.years) : 'some years'}, by fund, revenue source and function. Actual and Budget are counted differently, so they are shown side by side and never combined.`],
        income, calc]
      : [['actual', 'Actual', `What was spent or received, reported in the budget book published two years later. It is the figure that really happened, not a plan.`],
        ['projected', 'Projected', `The city's year-end estimate for a year that is not finished. The actual is not published yet.`],
        ['proposed', 'Proposed', `The mayor's first budget proposal. It is a proposal, not an adopted budget.`],
        ['revised', 'Revised', `A second presentation of a proposed budget, it is still a proposal and is not an adopted budget.`],
        ['adopted', 'Adopted', `The budget City Council passed before the year began, as the next year's budget book prints it.${yr('adopted') ? ` It is the budget figure for ${yr('adopted')}, where the books print no Amended figure.` : ''}`],
        ['amended', 'Amended', `The adopted budget with the changes made to it during the year, as the next year's budget book prints it.`],
        ['projection', 'Projection', `The city's own multi-year estimate for the years after the newest budget as required by Home Rule.`],
        income, calc];
  }
  function termsPage(q) {
    const other = isCounty() ? 'city' : 'county';
    document.title = pageTitle('Funds and terms');
    const fundRows = D.funds.map((f, i) => {
      const [paid, text] = fundInfo(f);
      const label = f === 'General Fund' ? 'General Fund' : esc(fn(f));
      return `<tr><th scope="row">${label}<span class="ctx-note">In the data: ${fundYears(i)}</span></th><td><strong>${esc(paid)}</strong></td><td>${esc(text)}</td></tr>`;
    }).join('');
    const bal = balanceWord();
    const notShown = isCounty()
      ? `<dt id="term-adopted" tabindex="-1">Adopted and Amended</dt><dd>The County's books do not label their figures this way, so the site does not either. The ${D.newest_year} Budget is the budget the Commissioners adopted${CFG.adopted ? ` (${esc(CFG.adopted.text)})` : ''}, and the site says so beside it.</dd>`
      : `<dt id="term-not-shown" tabindex="-1">Not shown</dt><dd>Year-to-date columns, and an older book's own proposal for its year, are left out: they are partial or superseded figures. They are still in the PDFs.</dd>`;
    const html = `<header class="page-head"><h1 id="page-h" tabindex="-1">Funds and terms</h1>
        <p class="lede-sm">Which of ${esc(CFG.entity.possessive)} funds are paid for by taxes and which are not, and what each figure word on this site means.</p></header>
      <section class="panel" id="terms-funds" tabindex="-1" aria-labelledby="tf-t"><h2 class="panel-title" id="tf-t">Funds</h2>
        <p class="hint" style="margin-top:0">${FUND_INTRO}</p>
        <div class="table-scroll"><table class="table terms-table"><thead><tr><th scope="col">Fund</th><th scope="col">Paid for by</th><th scope="col">What it is</th></tr></thead><tbody>${fundRows}</tbody></table></div>
        ${bal ? termDl([bal], ' terms-after') : ''}</section>
      <section class="panel" id="terms-figures" tabindex="-1" aria-labelledby="tw-t"><h2 class="panel-title" id="tw-t">Figure words</h2>
        <p class="hint" style="margin-top:0">${isCounty() ? 'Every figure on the County pages is one of these.' : 'Every figure you can pick on the City pages is one of these.'} The figure in view is named in the stamp above the controls.</p>
        ${termDl(figureWords())}<dl class="terms-dl">${notShown}</dl></section>
      <p class="hint">${isCounty() ? 'Looking for the City?' : 'Looking for the County?'} <a href="#/${other === 'county' ? 'county/' : ''}terms">See the ${esc(BASE.entities[other].entity.short)} funds and terms</a>. Sources and how the figures are checked: <a href="${eh('about')}">About the data</a>.</p>`;
    return { html };
  }
  const termHref = (id) => eh(`terms?s=${id}`);

  /* ---------- How the City budget is made (#/budget-calendar) ----------
     The City's budget calendar under its Home Rule Charter, drawn as a month-by-month timeline, then the rules behind it.
     Every statement cites its charter section, linked to the charter PDF at the page that prints it. The PDF and the
     City's 2024 audited statements (the rules before 2025) are named in config.json `entities.city.budget_calendar`;
     an entity without that block (the County) gets a one-line note instead and no nav link. CHARTER_PAGE maps each
     section to its PDF page (the charter's PDF page numbers equal its printed "Page | N"); a subsection not listed uses
     its section's page. OLD_RULES_PAGE: the audited statements' pages for the old form of government and budget rules. */
  const CHARTER_PAGE = {
    cover: 1, '8.01': 35, '8.02': 35, '8.03': 35, '8.04': 35,
    '8.04(a)': 36, '8.04(b)': 36, '8.04(c)': 36, '8.04(d)': 36, '8.04(e)': 36, '8.04(f)': 36, '8.05': 36, '8.05(a)': 36,
    '8.05(b)': 37, '8.05(c)': 37, '8.05(d)': 37, '8.05(e)': 37, '8.05(f)': 37,
    '8.05(g)': 38, '8.05(h)': 38, '8.06': 38,
    '8.07': 39, '8.08': 39, '8.09': 40, '8.10': 40, '8.10(a)': 40,
    '8.10(b)': 41, '8.10(c)': 41, '8.10(d)': 41, '8.11': 41, '8.11(a)': 41, '8.11(b)': 42,
    '13.02': 58, '13.14': 61,
  };
  const OLD_RULES_PAGE = { government: 42, budget: 58 };
  const charterPage = (s) => CHARTER_PAGE[s] ?? CHARTER_PAGE[s.replace(/\(.*$/, '')];
  // A charter citation: the section number is the link, quiet like every source link, opening the PDF at its page.
  const cite = (s, text) => {
    const B = CFG.budget_calendar, label = text || `§ ${s}`;
    return `<a class="src cite" href="${esc(B.charter_url)}#page=${charterPage(s)}" target="_blank" rel="noopener" title="Read it in the ${esc(B.charter_title)}" aria-label="${esc(label)}: open the ${esc(B.charter_title)} at that page">${esc(label).replace(/^§ /, '§&nbsp;')}</a>`;
  };
  const cites = (...ss) => `<span class="cites">(${ss.map((s) => cite(s)).join(', ')})</span>`;
  /* The timeline's steps, in time order. month: the band label (Jan–Dec, shown only when it changes from the step before;
     null for a step the charter ties to another step rather than a date); deadline: a date the charter requires;
     when: the date or timing in words; who: who acts; missed: what the charter says happens otherwise. */
  const calSteps = () => [
    { month: 'Jun', deadline: true, when: 'By June 30', at: '8.09(a)', title: 'Capital program due', who: ['Mayor'],
      body: `The Mayor sends Council a five-year capital program: major projects for City buildings, infrastructure and equipment, with cost estimates and how each would be paid for ${cites('8.09(a)', '8.09(b)')}.` },
    { month: 'Sep', deadline: true, when: 'By Sept 30', at: '8.10(d)', title: 'Council adopts the capital program', who: ['Council', 'Public'],
      body: `After a public hearing 15 to 30 days after its notice, with a public question period ${cites('8.10(a)')}, Council adopts the program, with or without changes ${cites('8.10(c)')}.`,
      missed: `The Mayor's original capital program becomes the official one ${cites('8.10(d)')}.` },
    { month: 'Oct', deadline: true, when: 'By Council\'s last scheduled October meeting', at: '8.02(b)', title: 'The Mayor presents the budget', who: ['Mayor'],
      body: `A balanced budget for the next year, the ordinance to enact it and a budget message ${cites('8.02(b)')}. If it raises tax revenue more than 6%, it includes a proposed waiver ${cites('8.02(c)')}. <a href="${eh('budget-calendar')}" data-scroll="cal-mayor">What must be in it</a>` },
    { month: 'Nov', deadline: true, when: 'By the first Council meeting in November', at: '8.02(d)', title: 'Vote on a 6% waiver, if one is proposed', who: ['Council'],
      body: `Council considers it at a public meeting ${cites('8.02(d)')}. It passes only with a majority of the whole Council plus one ${cites('8.08')}. <a href="${eh('budget-calendar')}" data-scroll="cal-limit">The 6% limit</a>`,
      missedLabel: 'If it does not pass', missed: `General Fund tax revenue may not rise more than 6% over the year before ${cites('8.08')}.` },
    { month: null, when: '7 to 30 days after the notice', title: 'Public hearings and questions', who: ['Council', 'Public'],
      body: `Council publishes a summary of the budget and a notice saying where to read it, when the hearings are and how to ask questions. Hearings are never on a regular Council meeting date ${cites('8.05(a)')}.` },
    { month: null, when: 'At least 7 days before adoption', title: 'Answers published, changes made', who: ['Mayor', 'Council'],
      body: `The Mayor publishes the public's questions with answers ${cites('8.05(c)')}. From 7 days after the hearings Council may adopt the budget, with or without changes; changes may not raise spending above estimated revenue ${cites('8.05(d)')}.` },
    { month: 'Dec', deadline: true, when: 'By Dec 15', at: '8.05(e)', title: 'Council adopts the budget', who: ['Council'],
      body: `Council adopts the budget ordinance ${cites('8.05(e)')} and every budget-related tax ordinance ${cites('8.05(h)')}.`,
      missed: `The Mayor's proposed budget becomes the official budget for the year ${cites('8.05(e)')}.` },
    { month: 'Dec', deadline: true, when: 'Within 10 days; override by Dec 31', at: '8.05(g)', title: 'The Mayor signs or vetoes', who: ['Mayor', 'Council'],
      body: `The Mayor signs the budget and tax ordinances or returns them with objections, and may veto single line items ${cites('8.05(f)')}. Council may override a veto with a majority plus one of its members, by December 31 ${cites('8.05(g)')}.` },
    { month: 'Jan', newYear: true, when: 'Jan 1', title: 'The budget year begins', who: ['Mayor', 'Council'],
      body: `The City's fiscal year is January 1 to December 31 ${cites('8.01')}. The Mayor reports budget against spending every month, and Council reviews it in public every quarter ${cites('8.11(a)', '8.11(b)')}.` },
    { month: 'Feb', deadline: true, when: 'By Feb 15, only after a municipal election year', at: '8.06(a)', title: 'A revised budget, if any', who: ['Mayor', 'Council'],
      body: `In the year after a municipal election, the Mayor and/or Council may revise the budget and tax levies; the revision replaces the budget then in effect ${cites('8.06(a)', '8.06(b)')}.` },
  ];
  const WHO_TAG = (w) => `<span class="cal-who-tag">${esc(w)}</span>`;
  function calTimeline() {
    let prev = null;
    const items = calSteps().map((s) => {
      const showMonth = s.month && s.month !== prev; if (s.month) prev = s.month;
      const cls = ['cal-step', s.deadline ? 'is-deadline' : '', s.newYear ? 'is-new-year' : '', showMonth ? 'has-month' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}">
        <div class="cal-band" aria-hidden="true">${showMonth ? `<span class="cal-month">${s.month}</span>` : ''}</div>
        <p class="cal-when">${s.deadline ? `<span class="cal-deadline-tag">Deadline</span> ` : ''}<span class="cal-when-text">${esc(s.when)}</span>${s.at ? ` ${cite(s.at)}` : ''}</p>
        <h3 class="cal-title">${esc(s.title)}</h3>
        <p class="cal-who"><span class="sr-only">Who acts: </span>${s.who.map(WHO_TAG).join(' ')}</p>
        <p class="cal-body">${s.body}</p>
        ${s.missed ? `<p class="cal-missed"><strong>${esc(s.missedLabel || 'If it is missed')}:</strong> ${s.missed}</p>` : ''}
      </li>`;
    }).join('');
    return `<ol class="cal-line" aria-label="The budget calendar, in time order">${items}</ol>`;
  }
  /* The 6% test for each City budget made under the charter (budget.json `tax_limit`, scripts/tax_limit.py): the budget
     and its General Fund tax revenue, the same book's figure for the year before, the change and the status. The sums
     are this site's own (calculated); each links to the book page that prints its lines. */
  function calLimitTest() {
    const T = TLIM();
    if (!T || !T.tests.length) return '';
    const amt = (x) => `${srcDoc(money(x.value), x.doc, Math.min(...x.lines.map((l) => l[3])))}`;
    const rowsH = T.tests.slice().sort((a, b) => a.year - b.year || ORDER.indexOf(a.measure) - ORDER.indexOf(b.measure)).map((t) => `<tr${t.over ? ' class="tl-row-over"' : ''}>
        <th scope="row">${esc(tlLabel(t))}</th><td class="num" data-label="Tax revenue, calculated"><span>${amt(t)}</span></td><td class="num" data-label="Year before, calculated"><span><span class="tl-base-l">${esc(tlBase(t))}</span> ${amt(t.base)}</span></td>
        <td class="num" data-label="Change"><span>${fmtPct(t.change_pct, true)}</span></td>
        <td data-label="Against the limit"><span>${t.over ? `<span class="tl-sign" aria-hidden="true">▲</span> <strong>Exceeds</strong>: needs a waiver` : 'Within'}</span></td></tr>`).join('');
    const counted = T.lines.filter((l) => l[2]), left = T.lines.filter((l) => !l[2]);
    const yrs = rangeText([...new Set(T.tests.map((t) => t.year))]);
    return `<div class="tl-test" id="cal-limit-test" tabindex="-1">
        <h3 class="cal-h3">The City's budgets against the limit</h3>
        <p>Each budget made under the charter (${yrs}), its General Fund tax revenue against the year before as printed in the same budget book: ${counted.length === 4 ? 'the four' : 'the'} taxes the City levies, ${andList(counted.map((l) => esc(l[1])))}.</p>
        <div class="table-scroll" tabindex="0" role="region" aria-label="The City's budgets against the 6% limit, scrollable"><table class="table tl-table" aria-label="The City's budgets against the ${T.limit_pct}% tax revenue limit">
          <thead><tr><th scope="col">Budget</th><th scope="col" class="num">Tax revenue<span class="calc-tag calc-head">calculated</span></th><th scope="col" class="num">Year before<span class="calc-tag calc-head">calculated</span></th><th scope="col" class="num">Change</th><th scope="col">Against the ${T.limit_pct}% limit</th></tr></thead>
          <tbody>${rowsH}</tbody></table></div>
        <p class="cal-note">Year before: the same book's Projected figure for that year (its revised projection where it prints one), the figure this site compares a new budget with. Amounts open the page of the budget book that prints the lines. A budget over the limit needs Council's waiver vote, majority of the whole Council plus one ${cites(T.section)}; this site does not track the votes.${T.transition ? ` For ${rangeText(T.transition.budget_years)}, see § 13.14 above.` : ''} Budgets before ${T.first_year} were made before the charter and are not tested.</p>
        <details class="values tl-lines"><summary>Which lines count</summary><ul>${counted.map((l) => `<li><strong>${esc(l[1])}</strong> (${esc(l[0])}): counted. ${esc(l[3])}</li>`).join('')}${left.map((l) => `<li><strong>${esc(l[1])}</strong> (${esc(l[0])}): not counted. ${esc(l[3])}</li>`).join('')}</ul></details>
      </div>`;
  }
  function calendarPage() {
    document.title = pageTitle('How the City budget is made');
    const B = CFG.budget_calendar;
    if (!B) {
      return { html: `<header class="page-head"><h1 id="page-h" tabindex="-1">How the City budget is made</h1></header>
        <p class="lede-sm">This page covers the City of Lancaster's budget calendar; the County's has not been researched for this site. <a href="#/budget-calendar">See the City's budget calendar</a>.</p>` };
    }
    const oldLink = (text, page) => `<a class="src cite" href="${esc(B.old_rules_url)}#page=${page}" target="_blank" rel="noopener" title="Read it in the City's ${esc(B.old_rules_title)}" aria-label="${esc(text)}: open the City's ${esc(B.old_rules_title)} at that page">${text}</a>`;
    const proj = projectionYears();
    const html = `<header class="page-head"><h1 id="page-h" tabindex="-1">How the City budget is made</h1>
        <p class="lede-sm">Who prepares the City's budget, who approves it, and by when, under the City's ${esc(B.charter_title)}. Every rule here links to the page that sets it out.</p></header>
      <section class="panel" id="cal-year" tabindex="-1" aria-labelledby="cal-year-t"><h2 class="panel-title" id="cal-year-t">The budget calendar</h2>
        <p class="cal-lead"><strong>The fiscal year is the calendar year,</strong> January 1 to December 31 ${cites('8.01')}, so each year's budget is made during the year before it. The Mayor proposes; City Council changes and adopts; the public can read, ask and be heard along the way.</p>
        <div class="cal-wrap">${calTimeline()}</div>
        <ul class="cal-key">
          <li><span class="cal-deadline-tag">Deadline</span> A date the charter sets. Where it says what happens if the date is missed, the step says so.</li>
          <li><span class="cal-who-tag">Mayor</span> <span class="cal-who-tag">Council</span> <span class="cal-who-tag">Public</span> Who acts at that step.</li>
          <li>Steps with no month have no fixed date: the charter ties them to another step instead.</li>
        </ul>
      </section>
      <section class="panel" id="cal-mayor" tabindex="-1" aria-labelledby="cal-mayor-t"><h2 class="panel-title" id="cal-mayor-t">The Mayor's budget</h2>
        <p>The Mayor, with the Director of Administrative Services, prepares the budget each year ${cites('8.02(a)')}. By Council's last scheduled meeting in October, the Mayor must send Council a <strong>balanced budget</strong> for the next year, the <strong>ordinance</strong> to enact it and a <strong>budget message</strong> ${cites('8.02(b)')}.</p>
        <h3 class="cal-h3">The budget message must explain</h3>
        <ul class="cal-list">
          <li>The revenues and spending in the proposed budget, and the major changes from the current year and the year before ${cites('8.03(a)')}.</li>
          <li>The proposed programs, and any that are new, expanded or abolished ${cites('8.03(b)')}.</li>
          <li>The City's debt position ${cites('8.03(c)')}.</li>
          <li>Anything else that tells Council and the public the City's goals ${cites('8.03(d)')}.</li>
        </ul>
        <h3 class="cal-h3">The budget must show</h3>
        <ul class="cal-list">
          <li>A complete financial plan of every City fund (the General Fund, other governmental funds and proprietary funds), following generally accepted accounting principles ${cites('8.04')}.</li>
          <li>A general summary first ${cites('8.04(a)')}.</li>
          <li>Every fund's estimated revenues in detail, with the existing and proposed tax rates and levies, assessments, fees and charges ${cites('8.04(b)')}.</li>
          <li>All proposed spending, fund by fund, by office and department ${cites('8.04(c)')}.</li>
          <li>Revenues equal to or above spending in each fund. A fund may use its unrestricted balance, under a fund balance policy adopted by Council ${cites('8.04(d)')}.</li>
          <li>Actual and estimated figures for the current year, and actual figures for the four years before it ${cites('8.04(e)')}.</li>
          <li>Estimated revenues and spending for <strong>two more years</strong>, fund by fund, by office and department ${cites('8.04(f)')}.</li>
        </ul>
        <p class="cal-note">That last rule is why the City publishes estimates for the two years after the budget year.${proj.length ? ` This site shows the City's ${rangeText(proj)} estimates as <a href="${termHref('term-projection')}">Projection</a> at the end of its multi-year charts and tables.` : ''}</p>
      </section>
      <section class="panel" id="cal-limit" tabindex="-1" aria-labelledby="cal-limit-t"><h2 class="panel-title" id="cal-limit-t">The 6% limit on tax revenue</h2>
        <p>The City may not raise its <strong>General Fund tax revenue</strong>, all sources together, by more than <strong>6%</strong> over the year before ${cites('8.08')}.</p>
        <p><strong>What counts:</strong> all taxes the City is allowed to levy. <strong>What does not:</strong> fees, regular income, grants, one-time sources, money from borrowing or revenue set aside for debt payments, proceeds from selling assets, departmental and utility fees, and other restricted revenue ${cites('8.08')}.</p>
        <h3 class="cal-h3">Going above it</h3>
        <ol class="cal-list">
          <li>The Mayor's proposed budget includes a proposed Council resolution to waive the limit ${cites('8.02(c)')}.</li>
          <li>Council considers it at a public meeting by its first meeting in November ${cites('8.02(d)')}.</li>
          <li>It passes only with a majority of the whole Council plus one ${cites('8.02(c)', '8.08')}.</li>
          <li>Tax revenue above the 6% limit is left out when the next year's limit is worked out ${cites('8.08')}.</li>
        </ol>
        <h3 class="cal-h3">An example, with made-up round numbers</h3>
        <dl class="cal-example">
          <div><dt>Last year's General Fund tax revenue</dt><dd>$30.0M</dd></div>
          <div><dt>6% of that</dt><dd>$1.8M</dd></div>
          <div><dt>Most it can be this year without a waiver</dt><dd>$31.8M</dd></div>
          <div><dt>With a waiver, say</dt><dd>$33.0M</dd></div>
          <div><dt>Left out when next year's limit is worked out</dt><dd>$1.2M</dd></div>
        </dl>
        <p class="cal-note">An illustration only; these are not the City's figures. The City's own budgets are tested below.</p>
        <h3 class="cal-h3">The charter's first two years</h3>
        <blockquote class="cal-quote"><p>“For two (2) years following the effective date of this Charter, the revenue limitations established under § 8.08 of this Charter shall be waived upon enactment of the annual budget ordinance as approved by a majority vote of Council.”</p><footer>${cite('13.14')}</footer></blockquote>
        <p class="cal-note">The charter took effect on January 1, 2025 ${cites('13.02')}. Section 13.14 does not name the budget years it covers, so this site does not say which they are.</p>
        ${calLimitTest()}
      </section>
      <section class="panel" id="cal-council" tabindex="-1" aria-labelledby="cal-council-t"><h2 class="panel-title" id="cal-council-t">Council's deadlines</h2>
        <dl class="terms-dl cal-dl">
          <dt>7 to 30 days after its notice</dt><dd>Council holds one or more public hearings on the budget, never on a regular Council meeting date, at times meant to let the most people take part, with a public question period ${cites('8.05(a)')}.</dd>
          <dt>At least 7 days before adoption</dt><dd>The Mayor or a designee publishes a summary of the public's questions with answers, grouped by topic ${cites('8.05(c)')}.</dd>
          <dt>No earlier than 7 days after the hearings</dt><dd>Council may adopt the budget with or without changes. It may add, raise, cut or remove programs and line items, except spending required by law or for debt service, but no change may raise spending above total estimated revenue. If the changes move the Mayor's spending by more than 10% in total, or more than 25% on any one item, the changed budget must be published for public inspection for at least 10 days before it can be enacted ${cites('8.05(d)')}.</dd>
          <dt>By December 15</dt><dd>Council adopts the budget ordinance ${cites('8.05(e)')} and all budget-related tax ordinances ${cites('8.05(h)')}. <span class="cal-missed"><strong>If Council misses it:</strong> the budget the Mayor proposed becomes the City's official budget for the year ${cites('8.05(e)')}.</span></dd>
          <dt>Within 10 days of receiving them</dt><dd>The Mayor signs the budget and tax ordinances, or returns them to Council with objections. The Mayor may veto the whole amended budget or single line items ${cites('8.05(f)')}.</dd>
          <dt>By December 31</dt><dd>From the third day after a veto, Council may override it by a vote of a majority plus one of its current members ${cites('8.05(g)')}.</dd>
          <dt>By September 30 (capital program)</dt><dd>Council adopts the capital program and budget, after a hearing 15 to 30 days after its notice ${cites('8.10(a)', '8.10(d)')}. <span class="cal-missed"><strong>If Council misses it:</strong> the Mayor's original capital program becomes the official one, and its part for the next year goes into that year's budget ${cites('8.10(d)')}.</span></dd>
        </dl>
      </section>
      <section class="panel" id="cal-public" tabindex="-1" aria-labelledby="cal-public-t"><h2 class="panel-title" id="cal-public-t">When you can take part</h2>
        <ul class="cal-list">
          <li><strong>Read the proposed budget.</strong> It is available from the first business day after Council introduces it, online and elsewhere as Council decides ${cites('8.05(a)')}, and at City Hall during business hours ${cites('8.05(b)')}.</li>
          <li><strong>Speak at a budget hearing.</strong> Hearings come 7 to 30 days after Council's notice, never on a regular Council meeting date ${cites('8.05(a)')}.</li>
          <li><strong>Ask a question,</strong> at the hearing's question period or in writing; the notice says how ${cites('8.05(a)')}.</li>
          <li><strong>Read the answers.</strong> The Mayor publishes them at least 7 days before Council adopts the budget ${cites('8.05(c)')}.</li>
          <li><strong>See big changes before they pass.</strong> Changes of more than 10% in total or 25% on one item are published for at least 10 days first ${cites('8.05(d)')}.</li>
          <li><strong>Watch a 6% waiver vote,</strong> held at a public meeting ${cites('8.02(d)')}.</li>
          <li><strong>Speak on the capital program</strong> at its hearing, 15 to 30 days after its notice, with a question period ${cites('8.10(a)')}, and read the answers at least 7 days before it is adopted ${cites('8.10(b)')}.</li>
          <li><strong>Follow the money during the year</strong> at the monthly reports and quarterly reviews, both at advertised public meetings ${cites('8.11(a)', '8.11(b)')}.</li>
        </ul>
        <p class="cal-note">Dates and places are in the notices Council publishes, in the ways set by the City's Administrative Code ${cites('8.05(a)')}. This site does not list them.</p>
      </section>
      <section class="panel" id="cal-during" tabindex="-1" aria-labelledby="cal-during-t"><h2 class="panel-title" id="cal-during-t">During the budget year</h2>
        <ul class="cal-list">
          <li><strong>Monthly reports.</strong> Within 21 days of each month's end, the Mayor gives Council, at an advertised public meeting, and makes public a cash flow report and a statement of revenues and spending by department, bureau and line item: the amount budgeted, the amount collected or spent so far and the percent ${cites('8.11(a)')}.</li>
          <li><strong>Quarterly reviews.</strong> After each quarter the Mayor and department heads appear before Council at an advertised public meeting to review programs, revenues and spending ${cites('8.11(b)')}.</li>
          <li><strong>Changes after adoption.</strong> Council may make emergency appropriations for a sudden danger to life or property ${cites('8.07(a)')}; add spending when revenue comes in above the estimates ${cites('8.07(b)')}; and cut appropriations, except debt service, when the Mayor reports that revenue will fall short ${cites('8.07(c)')}.</li>
          <li><strong>A revised budget after an election.</strong> In the year after a municipal election, the Mayor and/or Council may revise the budget and tax levies within 45 days of the year's start; it must be adopted by February 15 and replaces the budget then in effect ${cites('8.06(a)', '8.06(b)')}. This is not the <a href="${termHref('term-revised')}">Revised</a> figure on this site, which is the Mayor's revised proposal before the budget is adopted.</li>
        </ul>
      </section>
      <section class="panel" id="cal-before" tabindex="-1" aria-labelledby="cal-before-t"><h2 class="panel-title" id="cal-before-t">Before 2025</h2>
        <p>Voters approved the ${esc(B.charter_title)} on ${cite('cover', 'November 5, 2024')}, and it took effect on January 1, 2025 ${cites('13.02')}.</p>
        <p>Through 2024 the City ran under the Optional Third Class City Charter Law (${oldLink(`City's ${esc(B.old_rules_title)}`, OLD_RULES_PAGE.government)}). Under those rules the proposed budget went to City Council before November 30, and Council had to approve it by the end of December (${oldLink('the same statements', OLD_RULES_PAGE.budget)}).</p>
        <p>The budget books on this site for 2022, 2023 and 2024 were made under those earlier rules.</p>
      </section>
      <p class="hint">The details of notices and hearings are set in the City's Administrative Code, which this page does not cover. Words used on this site: <a href="${eh('terms')}">Funds and terms</a>. Where the figures come from: <a href="${eh('about')}">About the data</a>.</p>`;
    return { html };
  }


  /* Theme: follows the device until the visitor clicks the toggle; then an explicit choice is saved and set as
     data-theme on <html> (the CSS and the inline script in index.html's <head> use it). Storage may be blocked. */
  const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const currentTheme = () => document.documentElement.dataset.theme || (isDark() ? 'dark' : 'light');
  function applyTheme(redraw = true) {
    const t = currentTheme();
    document.querySelector('meta[name=color-scheme]')?.setAttribute('content', document.documentElement.dataset.theme || 'light dark');
    const next = t === 'dark' ? 'light' : 'dark';
    $('theme-toggle')?.setAttribute('aria-label', `Switch to ${next} theme`);
    $('theme-toggle')?.setAttribute('title', `Switch to ${next} theme`);
    if ($('theme-label')) $('theme-label').textContent = next === 'dark' ? 'Dark' : 'Light';
    loadTokens();
    if (window.Chart) Chart.defaults.color = MUTED;
    if (redraw) onRoute(false);
  }
  function initThemeToggle() {
    $('theme-toggle')?.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked: the choice lasts for this visit */ }
      applyTheme();
    });
    applyTheme(false);
  }

  /* ---------- entities: City and County ----------
     config.json `entities` holds each one's name, wording, default fund and data/PDF paths. Each is loaded once, on first visit,
     and kept; switching swaps D, O, CH, ST and the caches, then re-renders the route. */
  const ENTCACHE = {};
  async function loadEntity(id) {
    const e = BASE.entities && BASE.entities[id];
    if (!e) return false;
    try {
      if (!ENTCACHE[id]) {
        const get = (f) => fetch(`${e.paths.data}${f}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        // changes.json feeds "What changed", staffing.json the Staff section, fund_balance_gaap.json the County's audited balances;
        // each is optional (an entity lists the ones it has under `files`).
        const has = (f) => !e.files || e.files.includes(f);
        const [ch, st, gb] = await Promise.all([has('changes') ? get('changes.json') : null, has('staffing') ? get('staffing.json') : null, has('fund_balance_gaap') ? get('fund_balance_gaap.json') : null]);
        const res = await fetch(`${e.paths.data}budget.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        // The projections book's printed section and fund totals join the others, so totalOf() shows them as printed.
        if (d.projection) d.printed = d.printed.concat(d.projection.printed);
        ENTCACHE[id] = { D: d, O: d.org, CH: ch, ST: st, GB: gb, rowCache: new Map(), memberCache: new Map() };
      }
    } catch (err) {
      $('view').innerHTML = `<header class="page-head"><h1>Could not load the budget data</h1><p class="muted">budget data: ${esc(err.message)}. If you opened index.html from disk, serve the folder over HTTP instead.</p></header>`;
      return false;
    }
    const c = ENTCACHE[id];
    ENT = id; D = c.D; O = c.O; CH = c.CH; ST = c.ST; GB = c.GB; rowCache = c.rowCache; memberCache = c.memberCache; jumpIndex = null;
    CFG = { ...BASE, ...e, site_title: SITE + (e.title_suffix || '') };
    DEFAULT_FUND = D.funds.includes(CFG.default_fund) ? CFG.default_fund : '';
    try { localStorage.setItem('entity', id); } catch (err) { /* the choice lasts for this visit */ }
    applyChrome();
    renderAbout();
    return true;
  }
  /* The name, disclaimer, footer and contents links follow the entity. */
  function applyChrome() {
    document.documentElement.setAttribute('data-entity', ENT);
    document.title = pageTitle('Overview');
    $('wordmark').textContent = SITE; $('wordmark').setAttribute('href', eh(''));
    document.querySelector('meta[name=description]')?.setAttribute('content', CFG.description);
    $('footer-text').textContent = CFG.footer;
    if (CFG.tagline) $('tagline').textContent = CFG.tagline;
    if (CFG.contact_email) $('footer-contact').innerHTML = `Questions or corrections: <a href="mailto:${esc(CFG.contact_email)}">${esc(CFG.contact_email)}</a>`;
    const nav = { home: eh(''), changes: eh('changes'), reserve: eh(`?f=${encodeURIComponent(D.reserve?.name || 'Reserve Fund')}`), about: eh('about'), terms: eh('terms'), calendar: eh('budget-calendar') };
    document.querySelectorAll('#site-nav a[data-nav]').forEach((a) => {
      a.setAttribute('href', nav[a.dataset.nav]);
      if (a.dataset.nav === 'calendar') a.closest('li').hidden = !CFG.budget_calendar; // the budget calendar is researched for the City only
      if (a.dataset.nav === 'reserve') { a.closest('li').hidden = !D.reserve; if (D.reserve) a.textContent = D.reserve.name; } // the City's Reserve Fund, the County's General Fund Balance
    });
    jumpIndexReset();
  }
  const jumpIndexReset = () => { jumpIndex = null; const i = $('jump-input'); if (i) i.value = ''; };
  /* City / County tabs: each opens the same kind of page in the other entity (the overview, What changed or About). */
  function renderSwitch() {
    const tail = route.name === 'changes' ? 'changes' : route.name === 'about' ? 'about' : route.name === 'terms' ? 'terms' : route.name === 'calendar' ? 'budget-calendar' : '';
    document.querySelectorAll('#entity-switch a').forEach((a) => {
      const county = a.dataset.entity === 'county';
      a.setAttribute('href', `#/${county ? 'county/' : ''}${tail}`);
      if (a.dataset.entity === ENT) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  async function boot() {
    try {
      BASE = await (await fetch('config.json', { cache: 'no-cache' })).json();
    } catch (err) {
      $('view').innerHTML = `<header class="page-head"><h1>Could not load the budget data</h1><p class="muted">config: ${esc(err.message)}. If you opened index.html from disk, serve the folder over HTTP instead.</p></header>`;
      return;
    }
    SITE = BASE.site_title;
    // The controls used to fold behind "Change view" and remembered that as `controlsOpen`; they are always open now.
    try { localStorage.removeItem('controlsOpen'); } catch (e) { /* no storage */ }
    // A bare address opens the entity the visitor last chose; any #/... address says which one it means.
    if (!location.hash || location.hash === '#') {
      let saved = null;
      try { saved = localStorage.getItem('entity'); } catch (e) { /* no storage */ }
      if (saved && saved !== 'city' && BASE.entities[saved]) history.replaceState(null, '', `#/${saved}/`);
    }
    if (!(await loadEntity(parseHash().ent))) return;
    loadTokens();
    if (window.Chart) { Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font').trim(); Chart.defaults.font.size = 13; Chart.defaults.color = MUTED; }
    // Charts are drawn on canvas, so wait for the web font before the first draw (but never more than 1.5s).
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    // Light/dark follows the device; redraw the charts in the new colors when it changes.
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
    initThemeToggle();
    wire();
    initJump();
    $('site-footer').hidden = false; // shown only once there is something to show; About appears on its own page
    onRoute(false);
  }
  boot();
})();
