/* Budget Explorer: plain JS, no build step. Entity name, title and data paths come from config.json;
 * brand and chart colors (light and dark) come from the CSS variables in styles.css. Data: <paths.data>budget.json (scripts/build_dataset.py).
 * Routes (hash-based, so GitHub Pages needs no server rules):
 *   #/                                        all departments
 *   #/department/<dept>                       one department
 *   #/department/<dept>/bureau/<unit>         one bureau (org-chart unit)
 *   #/changes                                 what changed in the newest year (changes.json, scripts/changes.py)
 * Departments and bureaus follow the city's 2027 org chart (budget.json `org` block, built by
 * scripts/org_structure.py): every line's org code maps to one unit, and each unit to one department.
 * Older bureau links (#/department/<dept>/bureau/<fund--printed group>) redirect to the unit.
 * Shared query: y=year m=measure c=compare k=revenue f=fund
 */
(() => {
  'use strict';

  const LABEL = { proposed: 'Proposed', revised: 'Revised', projected: 'Projected', actual: 'Actual', budget: 'Budget' };
  const ORDER = ['actual', 'projected', 'budget', 'proposed', 'revised'];
  const STATUS = {
    proposed: 'Proposed, not adopted', revised: 'Revised proposal, not adopted',
    projected: 'Projected year-end estimate', actual: 'Actual spending', budget: 'Budget',
  };
  const CAT_ORDER = ['Salaries & Wages', 'Benefits', 'Operating', 'Equipment & Capital', 'Debt, Transfers & Allocations', 'Revenue', 'Uncoded'];
  // Colors are read from CSS variables at start-up (see loadTokens), so branding lives in styles.css.
  let PALETTE = [], OTHER_COLOR = '#777', SEL = '#41ffca', CMP = '#ffca41', INK = '#fff', MUTED = '#b3b3b3', GRID = '#262626', SURFACE = '#0d0d0d', BG = '#000';
  let CFG = null, DEFAULT_FUND = '', BASE = null, ENT = 'city', SITE = '', GB = null; // BASE: config.json; CFG: BASE plus the chosen entity; GB: County audited fund balances
  function loadTokens() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--cat-${i}`, '#888'));
    OTHER_COLOR = v('--cat-other', OTHER_COLOR); SEL = v('--sel', SEL); CMP = v('--cmp', CMP);
    INK = v('--fg', INK); MUTED = v('--muted', MUTED); GRID = v('--border', GRID); SURFACE = v('--card', SURFACE); BG = v('--bg', BG);
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
  let charts = [];
  const S = { y: 0, m: '', c: '', k: 'expense', f: '' };
  let route = { name: 'home' };
  let aboutOpen = false; // "What does this … do?" stays open when the page re-renders (theme, filters)
  const T = { sort: 'sel', dir: -1, q: '', shown: PAGE_SIZE };

  const $ = (id) => document.getElementById(id);
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
  const series = (k) => D.series[k];
  const seriesLabel = (k) => { const { y, m } = parseKey(k); return `${y} ${LABEL[m]}`; };
  const sum = (list) => list.reduce((t, r) => t + r.v, 0);
  /* Source links: the amount itself links to its page in the budget book (no page text is shown). */
  const bookYearOf = (k) => { const s = series(k); return s.book_year != null ? s.book_year : s.year + D.rule[s.measure].book_offset; };
  // County audited reports sit in the ACFR/ folder of the County PDFs.
  const docRel = (d) => (/^County-ACFR-/.test(D.docs[d]) ? `ACFR/${D.docs[d]}` : D.docs[d]);
  const pdfHref = (d, p) => `${CFG.paths.pdfs}${docRel(d).split('/').map(encodeURIComponent).join('/')}#page=${p}`;
  const src = (text, k, d, p) => (d == null || !k ? text
    : `<a class="src" href="${pdfHref(d, p)}" target="_blank" rel="noopener" title="View in budget book" aria-label="${esc(text)}: open source page in the ${bookYearOf(k)} budget book">${text}</a>`);
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
    return `<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> ${what ? `<strong>${esc(what)}, ${esc(seriesLabel(t.k))}:</strong> ` : ''}the ${bookYearOf(t.k)} budget book prints ${src(money(t.v), t.k, t.d, t.p)}, but the lines it totals add up to ${money(t.calc)}, <span class="nb">${money(Math.abs(g))} ${g < 0 ? 'less' : 'more'}.</span> ${iss ? esc(scrubPages(iss.note).replace(/^Text layer, every cell read cleanly \(no OCR\)\.\s*/i, '')) : 'Not yet explained.'} ${knownLink()}</p>`;
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
    return `<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> <strong>Incomplete, ${esc(seriesLabel(k))}:</strong> the ${bookYearOf(k)} budget book has no line-item pages for ${esc(miss.map((m) => m.name).join(' and '))}, so the calculated figures here leave ${miss.length === 1 ? 'it' : 'them'} out. ${knownLink()}</p>`;
  }

  /* ---------- data access ---------- */
  function rows(k) {
    if (!k || !series(k)) return [];
    if (rowCache.has(k)) return rowCache.get(k);
    const s = series(k);
    const out = s.a.map((acct, i) => {
      const a = D.accounts[acct];
      const unit = O.codes[a[0].split('-')[0]];
      return { code: a[0], name: a[1], fund: a[2], dept: a[3], bureau: a[4], cat: a[5], v: s.v[i], p: s.p[i], d: Array.isArray(s.doc) ? s.doc[i] : s.doc,
        unit, od: O.units[unit].dept }; // od: department on the 2027 org chart
    });
    rowCache.set(k, out);
    return out;
  }
  const isRevenue = (r) => D.categories[r.cat] === 'Revenue';
  const bureauKey = (r) => `${r.fund}|${r.bureau}`;
  // Old budget-group names end in " Exp" / " Expense" (the book's section label). Show the plain name.
  const plainName = (n) => String(n).replace(/\s+Exp(?:ense)?$/i, '');
  const bureauName = (i) => plainName(D.bureaus[i]);
  const bureauSlug = (fund, bureau) => `${slug(D.funds[fund])}--${slug(D.bureaus[bureau])}`;

  function scoped(k, over = {}) {
    const kind = over.kind || S.k;
    const f = D.funds.indexOf(S.f);
    return rows(k).filter((r) =>
      (kind === 'revenue') === isRevenue(r) &&
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
  const measuresFor = (y) => ORDER.filter((m) => series(key(y, m)));
  const defaultMeasure = (y) => { const ms = measuresFor(y); return ms.includes('revised') ? 'revised' : ms.includes('proposed') ? 'proposed' : ms[0]; };
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
    else if (parts[0] === 'department' && parts[1]) {
      r = parts[2] === 'bureau' && parts[3] ? { name: 'bureau', dept: parts[1], bureau: parts[3] } : { name: 'dept', dept: parts[1] };
    } else if (parts.length && location.hash.startsWith('#/')) r = { name: 'missing' }; // any other path is not a page
    return { r, q, ent };
  }
  function applyQuery(q) {
    const ys = years();
    S.y = ys.includes(+q.get('y')) ? +q.get('y') : ys.includes(D.newest_year) ? D.newest_year : ys[0];
    const ms = measuresFor(S.y);
    S.m = ms.includes(q.get('m')) ? q.get('m') : defaultMeasure(S.y);
    const c = (q.get('c') || '').replace('-', '|');
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
    return `<span class="status${draft ? ' not-adopted' : ''}">${S.y}: ${STATUS[S.m]}${ad}</span>`;
  }

  const knownLink = () => `<a class="known-link" href="${eh('about?s=about-issues')}">Known issues for this view</a>`;

  /* The one Fund list, used by every view: "All funds" (on a department page only while it is the choice), the funds that
     have lines in what is shown (plus the current choice), and the Reserve Fund view where the page allows it. */
  function fundOptions(present, scope) {
    const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
    return (!scope || !S.f ? opt('', 'All funds', !S.f) : '')
      + D.funds.map((f, i) => (present.has(i) || f === S.f ? opt(f, fn(f), f === S.f) : '')).join('')
      + (scope ? '' : extraFundViews().map((f) => opt(f, f, f === S.f)).join(''));
  }

  /* One tab-group field for every controls panel (Figure, Show): square segmented buttons named by their visible label. */
  const tabField = (name, label, items, cur, extra = '') => `<div class="field field-wide"><span class="field-label" id="lbl-${name}">${label}</span><div class="tabs" role="radiogroup" aria-labelledby="lbl-${name}">${items.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-tab="${name}" data-v="${v}">${esc(l)}</button>`).join('')}</div>${extra}</div>`;

  function reserveFiltersHTML() {
    const ys = [...new Set(D.reserve.entries.map((e) => e.year))].sort((a, b) => b - a);
    const ms = ORDER.filter((m) => resFind(S.y, m));
    const ym = measuresFor(S.y)[0], funds = fundOptions(new Set(ym ? rows(key(S.y, ym)).map((r) => r.fund) : D.funds.map((f, i) => i)), null);
    return `<div class="filters">
        <div class="field"><label class="field-label" for="f-y">Fiscal year</label><select id="f-y" data-sel="y">${ys.map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select>${defineFund()}</div>
      </div>
      ${ms.length > 1 ? `<div class="filters">${tabField('m', 'Figure', ms.map((m) => [m, LABEL[m]]), S.m, defineFigures())}</div>` : ''}`;
  }

  /* Short plain definitions beside the controls. A <details> works on touch and with screen readers (no hover or title). */
  const DEFINE_CITY = [['Proposed', 'the administration\'s first budget proposal.'], ['Revised', 'the revised proposal.'], ['Neither is adopted.', ''],
    ['Projected', 'the city\'s year-end estimate.'], ['Actual', 'what was spent, reported in the budget book two years later.']];
  const DEFINE_COUNTY = [['Budget', 'the County\'s budget for the year, from its own budget books. The newest year is the adopted budget; earlier years are as the next book prints them.'],
    ['Actual', 'what the County\'s audited annual report says it received and spent. Shown only for 2023 to 2025, by fund, revenue source and function.']];
  const defineList = () => (isCounty() ? DEFINE_COUNTY : DEFINE_CITY);
  const defineFigures = () => `<details class="define"><summary>What do these mean?</summary><ul>${defineList().map(([a, b]) => (b ? `<li><strong>${a}:</strong> ${b}</li>` : `<li class="aside">${a}</li>`)).join('')}</ul></details>`;
  const defineFund = () => (isCounty() ? `<details class="define"><summary>What is a fund?</summary><p>A fund is a separate account the County keeps for a purpose. The General Fund pays for most County services and is paid for mostly by property taxes. The others, such as Children &amp; Youth, Aging, Behavioral Health and Liquid Fuels, take in their own grants and transfers and are not mixed with it. The County prints the fund letters without names; the names here come from the County's audited report.</p></details>`
    : `<details class="define"><summary>What is a fund?</summary><p>A fund is a separate account the city keeps for a purpose. The General Fund pays for most city services and is paid for mostly by taxes; others, such as water, sewer, stormwater and trash, are paid for by their own fees and are not mixed with it. The Reserve Fund is the General Fund's savings balance.</p></details>`);

  /* One controls component for every page (home with any fund, the Reserve Fund, department and bureau pages, What changed):
     a one-line strip (the year's status stamp, then "Viewing …") with a "Change view" / "Close" button, and the fields
     below it. Closed by default on every screen size so content comes first; the visitor's last choice is remembered
     (localStorage may be blocked). */
  let ctlOpen = null;
  const controlsOpen = () => {
    if (ctlOpen == null) {
      try { const v = localStorage.getItem('controlsOpen'); if (v === '1' || v === '0') ctlOpen = v === '1'; } catch (e) { /* no storage */ }
    }
    return ctlOpen ?? false;
  };
  function setControls(open) {
    ctlOpen = open;
    try { localStorage.setItem('controlsOpen', open ? '1' : '0'); } catch (e) { /* the choice lasts for this visit */ }
  }
  function controlsWrap(inner, summary, stamp = statusHTML()) {
    const open = controlsOpen();
    return `<div class="controls"><div class="controls-bar"><p class="controls-sum" id="controls-sum">${stamp}${summary}</p>
        <button type="button" class="btn btn-outline controls-btn" data-toggle-controls aria-expanded="${open}" aria-controls="controls-panel">${open ? 'Close' : 'Change view'}</button></div>
      <div class="controls-panel" id="controls-panel"${open ? '' : ' hidden'}>${inner}</div></div>`;
  }
  const kindWordPlain = () => (S.k === 'revenue' ? 'Income' : 'Spending');

  /* Lines of a department or bureau in either shown figure, ignoring the Fund selector: what that page can offer. */
  function scopeRows(scope) {
    const ks = [key(S.y, S.m), S.c].filter(Boolean);
    return ks.flatMap((kk) => rows(kk).filter((r) => (scope.dept == null || r.od === scope.dept) && (scope.unit == null || r.unit === scope.unit)));
  }

  function filtersHTML({ fund = true, scope = null } = {}) {
    if (isReserve()) {
      const e = resFind(S.y, S.m);
      const stamp = e ? `<span class="status${e.measure === 'proposed' || e.measure === 'revised' ? ' not-adopted' : ''}">${e.year}: ${esc(RES_STATUS[e.measure])}</span>` : '';
      return controlsWrap(reserveFiltersHTML(), `Viewing ${S.y}${S.m ? ' ' + esc(LABEL[S.m]) : ''} · ${esc(D.reserve.name)}`, stamp);
    }
    const k = key(S.y, S.m);
    const yrs = years().map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('');
    const opts = Object.keys(D.series).filter((x) => x !== k)
      .sort((a, b) => parseKey(b).y - parseKey(a).y || ORDER.indexOf(parseKey(a).m) - ORDER.indexOf(parseKey(b).m));
    const cmp = `<option value="none" ${!S.c ? 'selected' : ''}>No comparison</option>` + opts.map((x) => `<option value="${x}" ${x === S.c ? 'selected' : ''}>${esc(seriesLabel(x))}</option>`).join('');
    // Home offers every fund plus "All funds" and the Reserve Fund. A department page offers only the funds it has lines in
    // (and the current choice, so the control never disagrees with the page).
    const sr = scope ? scopeRows(scope) : null;
    const present = new Set((sr || rows(k)).map((r) => r.fund));
    const funds = fundOptions(present, scope);
    // Offer Spending / Income only where the page has both kinds of lines.
    const kinds = sr ? ['expense', 'revenue'].filter((kd) => kd === S.k || sr.some((r) => (kd === 'revenue') === isRevenue(r))) : ['expense', 'revenue'];
    const kindTabs = kinds.length > 1
      ? tabField('k', 'Show', [['expense', 'Spending'], ['revenue', 'Income']], S.k) : '';
    const showFund = fund && (!scope || [...present].length + (S.f && !present.has(D.funds.indexOf(S.f)) ? 1 : 0) > 1 || !S.f);
    const inner = `<div class="filters">
        <div class="field"><label class="field-label" for="f-y">Fiscal year</label><select id="f-y" data-sel="y">${yrs}</select></div>
        <div class="field"><label class="field-label" for="f-c">Compare with</label><select id="f-c" data-sel="c">${cmp}</select>${defineFigures()}</div>
        ${showFund ? `<div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f"${scope ? ' aria-describedby="f-f-note"' : ''}>${funds}</select>${scope ? `<p class="field-note" id="f-f-note">Only the funds this ${scope.unit != null ? 'bureau' : 'department'} uses are listed.</p>` : ''}${defineFund()}</div>` : ''}
      </div>
      <div class="filters">
        ${measuresFor(S.y).length > 1 ? tabField('m', 'Figure', measuresFor(S.y).map((m) => [m, LABEL[m]]), S.m, defineFigures()) : ''}
        ${kindTabs}
      </div>`;
    const parts = [`Viewing ${esc(seriesLabel(k))}`, S.c ? `compared with ${esc(seriesLabel(S.c))}` : 'no comparison'];
    if (fund) parts.push(esc(fn(S.f) || 'All funds'));
    parts.push(kindWordPlain());
    return controlsWrap(inner, parts.join(' · '));
  }

  function onFilter(name, v) {
    const over = {};
    if (name === 'y') {
      const ms = measuresFor(+v);
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
    // The page re-renders; keep keyboard focus on the control that was used (a select keeps its id).
    const id = document.activeElement?.id;
    navigate(currentHash()(over), true);
    if (id && name !== 'm' && name !== 'k') $(id)?.focus({ preventScroll: true });
  }

  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
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
    return pts;
  }
  function trendHTML(scope, title, { bare = false } = {}) {
    trendScope = scope;
    const pts = trendData(scope);
    if (!pts.some((p) => p.v != null)) return '';
    const has = (m) => pts.some((p) => p.m === m && p.v != null);
    const legend = [
      has('actual') && `<li><i class="ln"></i>Actual</li>`,
      has('budget') && `<li><i class="ln"></i>Budget</li>`,
      has('projected') && `<li><i class="ln dashed"></i>Projected</li>`,
      has('proposed') && `<li><i class="dot diamond" style="background:${PALETTE[0]}"></i>Proposed</li>`,
      has('revised') && `<li><i class="dot" style="background:${SEL}"></i>Revised</li>`,
    ].filter(Boolean).join('');
    // Proposed and Revised sit a few pixels apart on a $0-based axis, so state the revision in words.
    const ly = pts.length ? Math.max(...pts.map((p) => p.y)) : null;
    const pv = pts.find((p) => p.y === ly && p.m === 'proposed' && p.v != null), rv = pts.find((p) => p.y === ly && p.m === 'revised' && p.v != null);
    const revision = pv && rv ? `<p class="trend-revision">${ly}: Proposed ${mny(pv.v)} → Revised ${mny(rv.v)}, ${deltaHTML(rv.v - pv.v, pv.v, mny)}</p>` : '';
    const notes = new Map(), what = trendWhat(scope);
    const rowsHtml = pts.map((p) => `<tr><th scope="row">${p.y}</th><td>${LABEL[p.m]}</td><td class="num">${p.t ? fig(p.t, { notes, what }) : '—'}</td></tr>`).join('');
    const head = bare ? '' : `<h2 class="panel-title" id="tr-t">${esc(title)}</h2>`;
    const inner = `${head}
      <p class="panel-note${bare ? ' panel-note-left' : ''}">${kindWordPlain()}${S.f ? ' · ' + esc(fn(S.f)) : ''}. ${isCounty() ? 'Each year shows the County\'s budget.' : 'Each year shows one kind of figure: actual, projected or proposed.'}</p>
      <ul class="trend-legend" aria-hidden="true">${legend}</ul>${revision}
      <div class="chart-box short"><canvas id="trend-chart" role="img" aria-label="Totals by year, ${pts[0].y} to ${pts[pts.length - 1].y}. Solid line: actual. Dashed line: projected. Hollow diamond: proposed. Solid dot: revised. The table below has the values."></canvas></div>
      <p class="trend-axis" id="trend-axis"></p>${spikeNotes(scope, S.k)}
      <details class="values"><summary>Show values</summary><div class="table-scroll"><table class="table"><thead><tr><th scope="col">Year</th><th scope="col">Figure</th><th scope="col" class="num">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${gapNotes(notes)}</details>`;
    return bare ? inner : `<section class="panel" aria-labelledby="tr-t">${inner}</section>`;
  }
  function drawTrend() {
    const cv = $('trend-chart');
    if (!cv || !window.Chart || !trendScope) return;
    const pts = trendData(trendScope), th = chartTheme();
    const yrs = [...new Set(pts.map((p) => p.y))];
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
      const ri = yrs.indexOf(rvPt.y), pi = main.map((p, i) => (p ? i : -1)).filter((i) => i >= 0 && i < ri).pop();
      datasets.push({ label: 'Revised', data: yrs.map((y, i) => (i === ri ? rvPt.v : i === pi ? main[pi].v : null)), borderColor: SEL, backgroundColor: SEL, borderWidth: 2, borderDash: [6, 4], showLine: true, spanGaps: false,
        pointRadius: (c) => (c.dataIndex === ri ? 8 : 0), pointHoverRadius: (c) => (c.dataIndex === ri ? 10 : 0), pointHitRadius: (c) => (c.dataIndex === ri ? 10 : 0), pointBorderColor: SURFACE, pointBorderWidth: 2 });
    }
    // The line chart does not start at zero (a line shows movement, not size), so the axis says where it starts.
    const vals = pts.map((p) => p.v).filter((v) => v != null && v > 0);
    let yMin = 0;
    if (vals.length) { const lo = Math.min(...vals) * 0.7, pow = 10 ** Math.floor(Math.log10(lo)); yMin = Math.floor(lo / pow) * pow; }
    const ax = $('trend-axis'); if (ax) ax.textContent = yMin > 0 ? `The vertical axis starts at ${short(yMin)}, not zero.` : '';
    charts.push(new Chart(cv, { type: 'line', data: { labels: yrs, datasets },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 8 } }, animation: reduceMotion() ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => (c.datasetIndex === 0 ? `${LABEL[main[c.dataIndex].m]}: ${money(c.raw)}` : `${c.dataset.label}: ${money(c.raw)}`) } } },
        scales: { x: { offset: true, ticks: { color: INK }, grid: { color: th.grid } }, y: { beginAtZero: yMin === 0, min: yMin || undefined, ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
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
        if ((kind === 'revenue') !== isRevenue(r)) continue;
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
  /* Under the "How the Balance Changes" table: why the General Fund pages show more income than its Revenues line.
     The budget books the money drawn from savings as income ("Fund Balance Reserve" lines); the Fund Balance
     Projection does not. Shown only for a year whose projection prints a Revenues line and whose budget has a draw. */
  function reserveTie(e) {
    const k = key(e.year, e.measure), rev = e.lines.find((l) => l.t === 'revenues');
    if (!rev || !series(k)) return '';
    const gf = D.funds.indexOf(DEFAULT_FUND), dr = reserveDraw(k, gf);
    if (!dr) return '';
    const gfT = totalOf(rows(k).filter((r) => r.fund === gf && isRevenue(r)), k);
    const gap = Math.round(rev.v + dr.v - gfT.v), ties = Math.abs(gap) <= 5;
    const P = drawParts(k, dr.v);
    const drawn = P ? drawSplit(P) : `${src(millions(dr.v), k, dr.d, dr.p)} drawn from the reserve`;
    const sum = ties ? '' : ` The two come to ${money(rev.v + dr.v)}, ${money(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than the General Fund's income.`;
    return `<p class="hint tie-note">The ${esc(DEFAULT_FUND)} pages show ${fig(gfT)} of income for ${esc(resLabel(e))}, not the ${srcDoc(money(rev.v), e.doc, rev.p)} on the Revenues line above. The difference is the ${drawn}: the budget counts it as income, on its “Fund Balance Reserve” lines, and this projection does not.${sum} <a href="${esc(homeHash({ f: DEFAULT_FUND, k: 'revenue', y: e.year, m: e.measure }))}">See ${esc(DEFAULT_FUND)} income</a></p>`;
  }

  /* ---------- Reserve Fund (General Fund balance) ---------- */
  const resFind = (y, m) => D.reserve.entries.find((e) => e.year === y && e.measure === m);
  const resEnd = (e) => e.lines.find((l) => l.t === 'ending');
  const resLabel = (e) => `${e.year} ${e.measure === 'actual' && e.basis === 'unaudited' ? 'Actual (unaudited)' : LABEL[e.measure]}`;
  const resBookYear = (e) => (D.books.find((b) => b.doc === D.docs[e.doc]) || {}).year;
  const srcDoc = (text, d, p) => `<a class="src" href="${pdfHref(d, p)}" target="_blank" rel="noopener" title="View in budget book" aria-label="${esc(text)}: open source page in the ${(D.books.find((b) => b.doc === D.docs[d]) || {}).year} budget book">${text}</a>`;
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
    const e = resFind(S.y, S.m) || resFind(S.y, ORDER.find((m) => resFind(S.y, m)));
    if (!e) return `<header class="page-head"><h1 id="page-h" tabindex="-1">${esc(D.reserve.name)}</h1><p class="muted">No reserve figures for ${S.y}.</p></header>${filtersHTML()}`;
    const end = resEnd(e), ch = resChange(e), name = D.reserve.name;
    document.title = `${name} ${resLabel(e)} · ${CFG.site_title}`;
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
        <p class="big-total" aria-live="polite"><span class="big-label">Year-end balance</span> ${srcDoc(money(end.v), e.doc, end.p)}</p>
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

  /* Lines grouped by a key, each group with the total shown for it (printed or calculated). */
  function groupTotals(list, keyFn, k) {
    const m = new Map();
    for (const r of list) { const g = keyFn(r); if (!m.has(g)) m.set(g, []); m.get(g).push(r); }
    return new Map([...m].map(([g, l]) => [g, totalOf(l, k)]));
  }
  const allCalc = (ts) => ts.every((t) => !t || !t.x);

  /* Department / bureau cards: name, share of the whole, and selected-vs-comparison bars. The whole card links.
     Each item's sel/cmp is a total from totalOf(). */
  function cardList(items, { total, k, shareOf, level, notes }) {
    const max = Math.max(1, ...items.flatMap((i) => [Math.abs(i.sel?.v || 0), Math.abs(i.cmp?.v || 0)]));
    const bar = (t, cls, label, what) => `<div><div class="bar-label ${cls}"><span>${esc(label)}</span><span>${t ? fig(t, { notes, what }) : '<span class="missing">No figures</span>'}</span></div>
        <div class="track"><div class="fill ${cls}" style="width:${t ? Math.max(0, (t.v / max) * 100) : 0}%"></div></div></div>`;
    return items.map((it) => {
      const sh = total > 0 && it.sel ? (it.sel.v / total) * 100 : null;
      const share = sh == null ? '' : `<span class="share">(${sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)}% of ${esc(shareOf)})</span>`;
      return `<li class="card" data-go="${esc(it.href)}"><div class="card-top"><h${level}><a href="${esc(it.href)}">${esc(it.name)}</a>${share}</h${level}>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></div>
        <div class="bars">${S.c ? bar(it.cmp, 'cmp', seriesLabel(S.c), it.name) : ''}${bar(it.sel, 'sel', seriesLabel(k), it.name)}</div></li>`;
    }).join('');
  }

  /* Department ledger: department, comparison, selected figure, signed change and share, as one ruled table.
     Amounts keep their PDF links; the whole row opens the department. The footer is the total shown at the top. */
  function ledgerHTML(items, { total, cmpTotal, k, notes }) {
    // A column of departments regrouped to the 2027 org chart is usually all calculated: say so once, in its head.
    const selCalc = allCalc(items.map((i) => i.sel)), cmpCalc = allCalc(items.map((i) => i.cmp));
    const head = (label, calc) => `${esc(label)}${calc ? `<span class="calc-tag calc-head">calculated</span>` : ''}`;
    const body = items.map((i) => {
      const sel = i.sel?.v || 0, cmp = i.cmp?.v || 0;
      const sh = total.v > 0 && i.sel ? (sel / total.v) * 100 : null;
      const cell = (t, calc) => (t ? fig(t, { tag: !calc, notes, what: `${i.name} ${kindWordPlain().toLowerCase()}` }) : '<span class="missing">No figures</span>');
      return `<tr data-go="${esc(i.href)}"><th scope="row"><a href="${esc(i.href)}">${esc(i.name)}</a></th>${S.c ? `<td class="num hide-sm">${cell(i.cmp, cmpCalc)}</td>` : ''}<td class="num">${cell(i.sel, selCalc)}</td>${S.c ? `<td class="num">${deltaHTML(sel - cmp, cmp, mny)}</td>` : ''}<td class="num hide-sm">${sh == null ? '' : (sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)) + '%'}</td></tr>`;
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
    const ex = totalOf(rows(k).filter((r) => r.fund === gf && !isRevenue(r)), k), rv = totalOf(rows(k).filter((r) => r.fund === gf && isRevenue(r)), k);
    const gap = ex.v - rv.v;
    return gap > 0 ? { ex, rv, gap, k } : null;
  }
  const countyGap = (k) => { const g = countyGapParts(k); return g ? `, spending ${mny(g.gap)} more than it expects to collect` : ''; };
  function countyGapNote(k) {
    const g = countyGapParts(k);
    if (!g) return '';
    const bal = GB && GB.rows.filter((r) => r.group === 'General Fund' && r.line === 'Total general fund').sort((a, b) => b.year - a.year)[0];
    const balTxt = bal ? ` The audited General Fund balance was ${gbLink(money(bal.v), bal)} at the end of ${bal.year} (<a href="${esc(eh('about?s=about-balance'))}">about this figure</a>).` : '';
    return `<p class="draw-note">${esc(seriesLabel(k))}: spending of ${fig(g.ex)} against income of ${fig(g.rv)}, a gap of ${money(g.gap)} <span class="calc-tag">calculated</span>. The budget book prints no General Fund balance page, so it does not say how the gap is met.${balTxt}</p>`;
  }
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
      out.push(`<p class="gap-note"><span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> <strong>${esc(what)}, ${a.year} Actual:</strong> ${esc(D.known_issues[f.known_issue].note)} ${knownLink()}</p>`);
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
      const ts = af.book_funds.map((f) => { const l = rows(ks).filter((r) => r.fund === D.funds.indexOf(f) && (kind === 'revenue') === isRevenue(r)); return l.length ? totalOf(l, ks) : null; }).filter(Boolean);
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
      <p class="panel-note">${esc(A.years[0])} to ${esc(A.years[A.years.length - 1])} Actual is set beside the Budget only where both exist at the same level: the fund's income and spending. ${esc(D.actuals_note[0])} No difference is calculated, because the two are not on the same footing.</p>
      <details class="values"><summary>About the Actual figures</summary><ul>${D.actuals_note.slice(1).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>${combined}
      <div class="table-scroll"><table class="table ledger" aria-label="Budget and Actual by ${af ? 'year' : 'fund'}"><thead><tr><th scope="col">${esc(head)}</th><th scope="col" class="num">Income: Budget</th><th scope="col" class="num">Income: Actual</th><th scope="col" class="num">Spending: Budget</th><th scope="col" class="num">Spending: Actual</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="panel-note" style="margin-top:12px">The Budget's spending includes transfers to other funds (the County match); the audited report counts transfers separately, so they are listed below and not added to the Actual spending.</p>
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

  function homeView() {
    if (isReserve()) return reserveView();
    const k = key(S.y, S.m);
    const list = scoped(k);
    const total = totalOf(list, k), cmp = S.c && series(S.c) ? totalOf(scoped(S.c), S.c) : null;
    const kindWord = kindWordPlain();
    const scope = S.f ? fn(S.f) : CFG.entity.short;
    document.title = `${scope} ${kindWord}: ${seriesLabel(k)} · ${CFG.site_title}`;

    const notes = new Map(), what = `${scope} ${kindWord.toLowerCase()}`;
    const selMap = groupTotals(list, (r) => r.od, k), cmpMap = cmp ? groupTotals(scoped(S.c), (r) => r.od, S.c) : new Map();
    const keys = new Set([...selMap.keys(), ...cmpMap.keys()]);
    const items = [...keys].map((d) => ({ id: d, name: O.departments[d].name, href: deptHash(d), sel: selMap.get(d), cmp: cmpMap.get(d) }))
      .sort((a, b) => (b.sel?.v || 0) - (a.sel?.v || 0) || (b.cmp?.v || 0) - (a.cmp?.v || 0));
    const ledgerNotes = new Map();
    const ledger = items.length ? ledgerHTML(items, { total, cmpTotal: cmp, k, notes: ledgerNotes }) : '<p class="empty">No lines for this selection.</p>';
    const totalHTML = fig(total, { notes, what });
    const flagNote = gapNotes(notes) + (total.x ? '' : missingNote(k, { fund: S.f }));
    // The deck says what a resident came to learn: up or down, by how much, and what covers it. It sits under the total.
    const deck = (() => {
      if (!cmp) return '';
      const d = total.v - cmp.v, p = pctOf(d, cmp.v);
      if (!cmp.v || Math.round(d) === 0) return '';
      const gf = D.funds.indexOf(DEFAULT_FUND), dr = D.reserve && gf >= 0 && S.f === D.funds[gf] ? reserveDraw(k, gf) : null;
      if (isCounty()) return `<p class="deck"><span class="${d > 0 ? 'up' : 'down'}">${fn(S.f) ? `${fn(S.f)} ` : ''}${S.k === 'revenue' ? (fn(S.f) ? 'income' : 'Income') : (fn(S.f) ? 'spending' : 'Spending')} ${d > 0 ? 'up' : 'down'} ${mny(Math.abs(d))} (${fmtPct(Math.abs(p))})<span class="sr-only"> ${d > 0 ? 'higher' : 'lower'}</span></span> from the ${esc(seriesLabel(S.c))}${countyGap(k)}.</p>`;
      return `<p class="deck"><span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? 'Up' : 'Down'} ${mny(Math.abs(d))} (${fmtPct(Math.abs(p))})<span class="sr-only"> ${d > 0 ? 'higher' : 'lower'}</span></span> from ${esc(seriesLabel(S.c))}${dr ? `, with ${drawParts(k, dr.v) ? drawSplit(drawParts(k, dr.v)) : `${src(millions(dr.v), k, dr.d, dr.p)} drawn from savings`}. <a class="deck-link" href="${esc(homeHash({ f: D.reserve.name }))}">See the Reserve Fund</a>` : '.'}</p>`;
    })();
    return `<header class="page-head"><h1 id="page-h">${esc(scope)} ${kindWord}: ${esc(seriesLabel(k))}</h1>
        <p class="big-total" aria-live="polite"><span class="big-label">${esc(scope)} ${kindWord}</span> ${totalHTML}</p>${flagNote}
        ${deck || `${heroDelta(k, total, cmp)}${drawNote(k)}`}${countyGapNote(k)}</header>
      <div class="home-flow">${filtersHTML()}
      ${(() => { const wc = homeChangesHTML(); return `<div class="overview${wc ? '' : ' overview-single'}">${trendHTML({}, 'Totals by Year')}${wc}</div>`; })()}</div>
      <section class="panel" id="sec-departments" tabindex="-1" aria-labelledby="dep-t"><h2 class="panel-title" id="dep-t">${isCounty() ? 'Departments by Group' : 'Departments'}</h2>
        <p class="panel-note">${isCounty() ? 'The County\'s departments are grouped as in its budget book. Select a group to see its departments.' : 'Select a department to see its detailed breakdown.'} Amounts open the source page in the budget book.</p>
        ${ledger}${gapNotes(ledgerNotes)}</section>
      <section class="panel" aria-labelledby="re-title"><h2 class="panel-title" id="re-title">Income vs. Spending by Fund: ${esc(seriesLabel(k))}</h2>
        <div class="chart-box"><canvas id="re-chart" role="img" aria-label="Income and spending by fund"></canvas></div>
        <div class="table-scroll"><table class="table" id="re-table"></table></div></section>${actualsHTML()}`;
  }

  function revExpAfter() {
    const k = key(S.y, S.m);
    const all = rows(k);
    const data = [...new Set(all.map((r) => r.fund))].map((fi) => {
      const fr = all.filter((r) => r.fund === fi), rl = fr.filter(isRevenue), el = fr.filter((r) => !isRevenue(r));
      return { fund: fn(D.funds[fi]), rev: rl.length ? totalOf(rl, k) : null, exp: el.length ? totalOf(el, k) : null };
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
    const allRev = all.filter(isRevenue), allExp = all.filter((r) => !isRevenue(r));
    const tRev = totalOf(allRev, k), tExp = totalOf(allExp, k);
    $('re-table').innerHTML = `<thead><tr><th scope="col">Fund</th><th scope="col" class="num">Income</th><th scope="col" class="num">Spending</th><th scope="col" class="num">Income minus spending</th></tr></thead>
      <tbody>${data.map((d) => `<tr><th scope="row">${esc(d.fund)}</th><td class="num">${cell(d, d.rev, 'income')}</td><td class="num">${cell(d, d.exp, 'spending')}</td><td class="num">${dcell(vo(d.rev) - vo(d.exp))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>All funds</td><td class="num">${fig(tRev)}</td><td class="num">${fig(tExp)}</td><td class="num">${dcell(tRev.v - tExp.v)}</td></tr></tfoot>`;
    $('re-table').parentElement.insertAdjacentHTML('afterend', gapNotes(notes));
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
     one-figure-per-year rule: Actual, Projected, then Proposed and Revised. Positions are placed in org-chart
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
      <thead><tr><th scope="col">${scope.unit == null ? 'Bureau' : ''}</th>${cols.map((c) => `<th scope="col" class="num">${c.label.split(' ').map(esc).join('<br>')}</th>`).join('')}</tr></thead>
      <tbody>${ids.map((u) => `<tr><th scope="row">${rowHead(u)}</th>${cols.map((c) => `<td class="num">${cell(m.get(u)?.get(c.k), c.k)}</td>`).join('')}</tr>`).join('')}</tbody>
      ${multi ? `<tfoot><tr><th scope="row">All</th>${cols.map((c) => `<td class="num">${total(c.k)}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
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
      <p class="panel-note">The “Salaries &amp; Wages” budget lines (salaries, overtime and temporary wages; benefits are separate): Actual through 2025, Projected for 2026, Proposed and Revised for 2027.</p>
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
      <p class="dept-total">Total ${kindWord}: <strong class="figure">${totalLink}</strong></p>${headNotes}<p class="dept-sub">${subtitle}</p></header>${about}`;

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
    html += `<div class="entity-flow"><div class="dept-filters">${filtersHTML({ fund: !!deptPicker, scope })}</div>${changes}${compare}${bureauList}${staff}`;
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
    const body = list.slice(0, T.shown).map((e) => {
      const d = val(e, 'sel') - val(e, 'cmp');
      const sub = [e.code, showBureau ? bureauName(e.bureau) : ''].filter(Boolean).map(esc).join(' · ');
      const draw = /^Fund Balance Reserve/i.test(e.name) && /-499000$/.test(e.code) ? `<span class="sub">${esc(drawLineLabel(e.sel ? k : S.c, (e.sel || e.cmp).v))}</span>` : '';
      return `<tr><td>${esc(e.name)}<span class="sub">${sub}</span>${draw}</td><td class="hide-sm">${esc(D.categories[e.cat])}</td>
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
      <div class="table-scroll"><table class="table"><thead><tr>${th('name', 'Line item and account')}${th('cat', 'Category', 'hide-sm')}${S.c ? th('cmp', esc(seriesLabel(S.c)), 'num') : ''}${th('sel', esc(seriesLabel(k)), 'num')}${S.c ? th('chg', 'Change', 'num hide-sm') : ''}</tr></thead>
        <tbody>${body || '<tr><td colspan="5" class="empty">No matching line items.</td></tr>'}</tbody>
        <tfoot><tr><td>Total${q ? ' (matching)' : ''}</td><td class="hide-sm"></td>${S.c ? `<td class="num">${fig(fCmp)}</td>` : ''}<td class="num">${fig(fSel)}</td>${S.c ? `<td class="num hide-sm">${money(ts - tc)}</td>` : ''}</tr></tfoot></table></div>
      ${left > 0 ? `<button type="button" class="btn btn-outline more" data-more>Show ${Math.min(PAGE_SIZE, left)} more</button>` : ''}`;
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
      holder.innerHTML = lineTable(selRows, cmpRows, showBureau);
      const s = $('li-search');
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

  const notFound = (what) => ({ html: `<p class="back-link"><a href="${esc(homeHash())}">‹ All departments</a></p><header class="page-head"><h1 id="page-h" tabindex="-1">${esc(what)} not found</h1><p class="muted">That link doesn't match anything in the current data.</p></header>` });

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
    let bureauList = '';
    const cardNotes = new Map();
    if (dept.bureaus) {
      const cmpUnits = S.c ? groupTotals(cmpRows, (r) => r.unit, S.c) : new Map();
      const ids = [...new Set([...units.keys(), ...cmpUnits.keys()])];
      const items = ids.map((u) => ({ id: u, name: unitLabel(u), href: unitHash(u), sel: units.get(u), cmp: cmpUnits.get(u) }))
        .sort((a, b) => (O.units[a.id].kind === 'department-wide') - (O.units[b.id].kind === 'department-wide') || (b.sel?.v || 0) - (a.sel?.v || 0) || (b.cmp?.v || 0) - (a.cmp?.v || 0));
      const hasWide = ids.some((u) => O.units[u].kind === 'department-wide');
      if (items.length > 1) {
        const note = (isCounty() ? 'Departments as the County\'s 2026 budget book groups them. Select one to see its line items.' : 'Bureaus as on the city\'s 2027 org chart. Select one to see its line items.')
          + (hasWide ? ` “${unitLabel(ids.find((u) => O.units[u].kind === 'department-wide'))}” collects budget groups that are not a bureau.` : '');
        bureauList = `<section class="bureau-list" id="sec-bureaus" tabindex="-1" aria-labelledby="bl-t"><h2 class="list-title" id="bl-t">${S.k === 'revenue' ? 'Income by' : 'Spending by'} ${isCounty() ? 'Department' : 'Bureau'}</h2><p class="hint hint-top">${esc(note)} Amounts open the source page in the budget book.</p>
          <ul class="cards" aria-labelledby="bl-t">${cardList(items, { total: totalOf(selRows, k).v, k, shareOf: `${name} ${S.k === 'revenue' ? 'revenue' : 'spending'}`, level: 3, notes: cardNotes })}</ul>${gapNotes(cardNotes)}</section>`;
      }
    }
    document.title = `${name} ${seriesLabel(k)} · ${CFG.site_title}`;
    const about = aboutHTML('What does this department do?', dept.desc);
    const v = entityView({ title: name, subtitle, selRows, cmpRows, crumbs: [{ label: 'Home', href: homeHash() }, { label: name }], bureauList, changes: deptChangesHTML(di), deptPicker: picker, scope: { dept: di }, about });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats); mountLines(selRows, cmpRows, true); } };
  }

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
    document.title = `${name} ${seriesLabel(k)} · ${CFG.site_title}`;
    const sub = [esc(O.departments[di].name), unit.division ? (isCounty() ? esc(unit.division) : `${esc(unit.division)} Division`) : '', ...funds, lineCountText(selRows, cmpRows)].filter(Boolean).join(' · ');
    let about;
    if (unit.kind === 'department-wide') {
      const groupsShown = [...new Set([...selRows, ...cmpRows].map((r) => bureauName(r.bureau)))].sort();
      about = aboutHTML('What is this?', [], `<p>These budget lines are not a bureau on the city's 2027 org chart. They are budget groups the ${esc(O.departments[di].name)} department manages${groupsShown.length ? `, printed in the budget book as: ${esc(groupsShown.join('; '))}` : ''}.</p>`);
    } else {
      const q = /^Bureau\b/.test(unit.name) ? 'What does this bureau do?' : /^Office\b/.test(unit.name) ? 'What does this office do?' : `What does ${unit.name} do?`;
      about = aboutHTML(q, unit.desc);
    }
    const v = entityView({ title: name, subtitle: sub, selRows, cmpRows, crumbs: [{ label: 'Home', href: homeHash() }, { label: O.departments[di].name, href: deptHash(di) }, { label: name }], changes: deptChangesHTML(di, ui), scope, about });
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
    const l = rows(k).filter((r) => (kind === 'revenue') === isRevenue(r) && (fi < 0 || r.fund === fi) && (!filter || filter(r)));
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

  /* The Income view's headline: what the newest budget takes in, against the comparison, and the draw inside it. */
  function incomeSentence(c, sc) {
    const t = wcTotal(c.to, 'revenue'), f = wcTotal(c.from, 'revenue'), d = vOf(t) - vOf(f), p = vOf(f) ? Math.abs(d / vOf(f)) * 100 : null;
    let s = `The ${esc(seriesLabel(c.to))} budget takes in ${t ? fig(t, { text: mny(t.v) }) : '$0'} ${S.f ? `in the ${esc(S.f)}` : 'across all funds'}, `
      + (d === 0 ? `the same as ${fromPhrase(c, false)}.` : `${mny(Math.abs(d))}${p == null ? '' : ` (${p.toFixed(1)}%)`} ${d > 0 ? 'more' : 'less'} than ${fromPhrase(c, false)}.`);
    const dr = sc.revenue?.draw;
    if (dr && vOf(dr.t) > 0) {
      const P = drawParts(c.to, vOf(dr.t));
      s += ` That includes ${P ? drawSplit(P, mny) : `${lnk(dr.t, mny(vOf(dr.t)))} drawn from the reserve`}.`;
    }
    return s;
  }
  const ledeFor = (c, sc) => (S.k === 'revenue' && sc.revenue ? incomeSentence(c, sc) : headlineSentence(c, sc));

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
      tiles.push(['Spending change', deltaHTML(vOf(tt) - vOf(tf), vOf(tf), mny), `${esc(seriesLabel(c.from))} ${fx(tf, 'expense')} → ${esc(seriesLabel(c.to))} ${fx(tt, 'expense')}`]);
    }
    const dr = sc.revenue?.draw;
    // The Income tile: on the Income view always (first), otherwise only where there is no draw tile.
    if (sc.revenue && (S.k === 'revenue' || !dr)) {
      const rf = wcTotal(c.from, 'revenue'), rt = wcTotal(c.to, 'revenue');
      const t = ['Income change', deltaHTML(vOf(rt) - vOf(rf), vOf(rf), mny), `${esc(seriesLabel(c.from))} ${fx(rf, 'revenue')} → ${esc(seriesLabel(c.to))} ${fx(rt, 'revenue')}`];
      if (S.k === 'revenue') tiles.unshift(t); else tiles.push(t);
    }
    if (dr) {
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
    return `<ul class="wc-tiles">${tiles.map(([h, big, sub]) => `<li class="wc-tile"><h2 class="wc-tile-h">${h}</h2><p class="wc-tile-v">${big}</p><p class="wc-tile-s">${sub}</p></li>`).join('')}</ul>${foot ? gapNotes(notes) : ''}`;
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
  const defineMoved = () => `<details class="define"><summary>Why this matters</summary><p>The General Fund is paid for mostly by taxes. The Water, Sewer, Stormwater and Solid Waste funds are paid for by their own fees. Work moved into the General Fund is paid for from taxes from now on; work moved out of it is paid for by fees.</p></details>`;

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
      const drawNoteTxt = /^Fund Balance Reserve/i.test(a[1]) && /-499000$/.test(a[0]) ? `<span class="sub">${esc(ln[4] != null ? drawLineLabel(c.to, ln[4]) : drawLineLabel(c.from, ln[1]))}</span>` : '';
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
    if (sc?.revenue?.draw) parts.push(`<li>${drawLabel(rc, sc.revenue.draw)}: ${lnk(sc.revenue.draw.f)} → ${lnk(sc.revenue.draw.t)}${drawSplitNote(rc, sc.revenue.draw)}</li>`);
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
    document.title = `What changed: ${seriesLabel(c.to)} · ${name} · ${CFG.site_title}`;
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
      <p class="wc-note wc-after">The ${esc(DEFAULT_FUND)}'s budget lists the money drawn from savings as income (its “Fund Balance Reserve” lines); this page leaves it out of Revenues and shows it as the deficit and the committed data center revenue. <a href="${esc(homeHash({ f: name, y: to.year, m: to.measure }))}">See the ${esc(name)}</a></p></section>`;
    const tiles = `<ul class="wc-tiles"><li class="wc-tile"><h2 class="wc-tile-h">Balance change</h2><p class="wc-tile-v">${deltaHTML(d, fe.v, mny)}</p><p class="wc-tile-s">${esc(resLabel(from))} ${srcDoc(money(fe.v), from.doc, fe.p)} → ${esc(resLabel(to))} ${srcDoc(money(te.v), to.doc, te.p)}</p></li>${dr ? `<li class="wc-tile"><h2 class="wc-tile-h">Drawn from savings</h2><p class="wc-tile-v"><span>${src(mny(dr.v), c.to, dr.d, dr.p)}</span></p><p class="wc-tile-s">${P ? `Of it, ${srcDoc(mny(P.dc.v), P.dc.d, P.dc.p)} from dedicated data center revenue (Fund Balance Projection).` : 'The budget\'s “Fund Balance Reserve” lines.'}</p></li>` : ''}</ul>`;
    return { html: `<header class="page-head wc-head">${h1}<p class="wc-lede">${lede}</p>${badgeHTML(c)}${start}</header>${changesFiltersHTML(c)}${tiles}${table}` };
  }

  function changesFiltersHTML(c) {
    const to = key(D.newest_year, S.m);
    const opts = Object.keys(CH.comparisons).filter((x) => x.startsWith(`${to}~`)).map((x) => x.split('~')[1]);
    const ms = measuresFor(D.newest_year);
    const present = new Set(Object.keys(c.scopes).filter((x) => x !== 'all').map((f) => D.funds.indexOf(f)));
    const funds = fundOptions(present, null);
    // Same order as every other page: selects (Compare with, Fund), then the Figure and Spending / Income tabs.
    const inner = `<div class="filters">
        <div class="field"><label class="field-label" for="f-c">Compare with</label><select id="f-c" data-sel="c">${opts.map((x) => `<option value="${x}" ${x === c.from ? 'selected' : ''}>${esc(seriesLabel(x))}</option>`).join('')}</select>${defineFigures()}</div>
        <div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select>${defineFund()}</div>
      </div><div class="filters">
        ${ms.length > 1 ? tabField('m', `Figure (${D.newest_year})`, ms.map((m) => [m, LABEL[m]]), S.m) : ''}
        ${isReserve() ? '' : tabField('k', 'Show first', [['expense', 'Spending'], ['revenue', 'Income']], S.k)}
      </div>`;
    return controlsWrap(inner, `Viewing ${esc(seriesLabel(c.to))} · compared with ${esc(seriesLabel(c.from))} · ${esc(fn(S.f) || 'All funds')}${isReserve() ? '' : ` · ${kindWordPlain()} first`}`);
  }

  function changesPage() {
    if (!CH) return { html: `<header class="page-head"><h1 id="page-h" tabindex="-1">What changed</h1><p class="muted">The comparison data (changes.json) could not be loaded.</p></header>` };
    const c = changeCmp();
    if (!c) return notFound('Comparison');
    if (c.from !== S.c) S.c = c.from;
    if (isReserve()) return reserveChangesPage(c);
    const sc = c.scopes[scopeName()];
    document.title = `What changed: ${seriesLabel(c.to)}${S.f ? ' · ' + fn(S.f) : ''} · ${CFG.site_title}`;
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
      const dr = rv.draw;
      income += `<section class="panel" aria-labelledby="wc-inc"><h2 class="total-label" id="wc-inc">How it's paid for</h2>
        <ul class="wc-facts">${(() => { const { f, t } = grp('revenue', null), notes = new Map(); return `<li>Income: ${f ? fig(f, { notes, what: wcWhat('revenue') }) : '$0'} → ${t ? fig(t, { notes, what: wcWhat('revenue') }) : '$0'}, ${deltaHTML(vOf(t) - vOf(f), vOf(f))}${gapNotes(notes)}</li>`; })()}
        ${dr ? `<li>${drawLabel(c, dr)}: ${lnk(dr.f, dr.f ? money(vOf(dr.f)) : '$0')} in ${esc(seriesLabel(c.from))} → ${lnk(dr.t, dr.t ? money(vOf(dr.t)) : '$0')} in ${esc(seriesLabel(c.to))}${drawSplitNote(c, dr)}. <a href="${esc(homeHash({ f: D.reserve?.name || '' }))}">See the Reserve Fund</a></li>` : ''}</ul>
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
    const mine = c.lines.map((ln, i) => i).filter((i) => { const ln = c.lines[i], a = acctOf(ln); return O.units[unitOfLine(ln)].dept === di && (!unitPage || unitOfLine(ln) === ui) && (fi == null || a[2] === fi) && (D.categories[a[5]] === 'Revenue') === (S.k === 'revenue'); })
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

  /* ---------- margin notes (wide screens): what the words mean, and where the problems are ---------- */
  function renderMargin() {
    const m = $('margin'); if (!m) return;
    m.innerHTML = `<h2 class="margin-h">Reading notes</h2>
      <dl>${defineList().filter(([, b]) => b).map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <p>Every amount links to its page in ${isCounty() ? 'the County\'s' : 'the city\'s'} ${isCounty() ? 'books' : 'budget book'}.</p>
      <p>${knownLink()}</p>`;
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
    if (scroll) aboutOpen = false;
    if (q.get('c') === 'none') { applyQuery(q); S.c = ''; } else applyQuery(q);
    if (route.name !== 'home' && route.name !== 'changes' && isReserve()) S.f = DEFAULT_FUND; // the reserve has no departments or bureaus
    if (route.name === 'changes' && S.y !== D.newest_year) { S.y = D.newest_year; S.m = defaultMeasure(S.y); S.c = defaultCompare(S.y, S.m); }
    T.sort = 'sel'; T.dir = -1; T.q = route.name === 'dept' || route.name === 'bureau' ? (q.get('q') || '') : ''; T.shown = PAGE_SIZE;
    destroyCharts();
    notesShown = new Set();
    let page;
    if (route.name === 'home') page = { html: homeView(), after: () => { if (isReserve()) drawReserve(); else { drawTrend(); revExpAfter(); } } };
    else if (route.name === 'changes') page = changesPage();
    else if (route.name === 'dept') page = deptPage();
    else if (route.name === 'about') page = { html: '<header class="page-head"><h1 id="page-h" tabindex="-1">About the data</h1></header>', after: () => { const t = q.get('s') && $(q.get('s')); if (t) { if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView(); } } };
    else if (route.name === 'missing') page = notFound('Page');
    else page = bureauPage();
    if (page.redirect) { navigate(page.redirect, true); return; }
    $('view').innerHTML = page.html;
    $('about').hidden = route.name !== 'about';
    document.body.classList.toggle('about-page', route.name === 'about');
    page.after?.();
    // Mark where the reader is in the contents.
    const here = route.name === 'changes' ? 'changes' : route.name === 'about' ? 'about' : route.name === 'home' ? (isReserve() ? 'reserve' : 'home') : 'home';
    const onUnit = route.name === 'dept' || route.name === 'bureau';
    document.querySelectorAll('#site-nav a').forEach((a) => { if (a.dataset.nav === here && !onUnit) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    renderRail(here, onUnit);
    renderSwitch();
    renderMargin();
    // The rail's "What changed" link keeps the fund (the Reserve Fund included: that page says it shows the General Fund),
    // the figure and the comparison, and Spending / Income; from an earlier year it opens the newest year's defaults.
    const wcLink = document.querySelector('#site-nav a[data-nav="changes"]');
    if (wcLink && route.name !== 'changes') {
      const nm = defaultMeasure(D.newest_year);
      wcLink.setAttribute('href', changesHash(S.y === D.newest_year ? {} : { y: D.newest_year, m: nm, c: defaultCompare(D.newest_year, nm) }));
    }
    const jumpTo = route.name === 'changes' && q.get('s') ? $(q.get('s')) : null; // e.g. "How this is counted" from the Overview
    if (scroll && jumpTo) {
      jumpTo.scrollIntoView();
      jumpTo.focus({ preventScroll: true });
    } else if (scroll) {
      window.scrollTo({ top: 0 });
      $('page-h')?.focus({ preventScroll: true });
      if (T.q && $('sec-lines')) $('sec-lines').scrollIntoView(); // arrived from "Jump to…" with a line item: show the table
    }
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
      const tog = e.target.closest('[data-toggle-controls]');
      if (tog) {
        const open = tog.getAttribute('aria-expanded') !== 'true';
        setControls(open);
        tog.setAttribute('aria-expanded', String(open)); tog.textContent = open ? 'Close' : 'Change view';
        const panel = $('controls-panel'); if (panel) panel.hidden = !open;
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) { onFilter(tab.dataset.tab, tab.dataset.v); return; }
      const card = e.target.closest('[data-go]');
      if (card && !e.target.closest('a')) navigate(card.dataset.go);
    });
    view.addEventListener('toggle', (e) => { if (e.target.classList?.contains('org-about')) aboutOpen = e.target.open; }, true);
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
      const b = e.target.closest('[data-tab]');
      if (!b || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const btns = [...b.parentElement.querySelectorAll('button')], i = btns.indexOf(b);
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      e.preventDefault(); onFilter(n.dataset.tab, n.dataset.v);
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
    const nameOf = Object.fromEntries([...D.books.map((b) => [b.doc, `${b.year} Budget Book`]), ...A.sources.map((x) => [x.file, `${x.year} audited annual report`])]);
    const books = D.books.filter((b) => b.used).map((b) => `<li><a href="${pdf(b.doc)}" target="_blank" rel="noopener">${esc(nameOf[b.doc])}</a> (<a href="${pdf(b.doc)}" download>download PDF</a>): supplies ${b.figures.map((y) => `${y} Budget`).join(' and ')}.</li>`).join('');
    const acfrs = A.sources.map((x) => `<li><a href="${pdf(`ACFR/${x.file}`)}" target="_blank" rel="noopener">${esc(nameOf[x.file])}</a> (<a href="${pdf(`ACFR/${x.file}`)}" download>download PDF</a>; <a href="${esc(x.url)}" target="_blank" rel="noopener">County archive page</a>).</li>`).join('');
    const issues = D.known_issues.map((i) => `<li>${esc(nameOf[i.source_doc] || i.source_doc.replace(/\.pdf$/i, ''))}: ${esc(i.note)}</li>`).join('');
    const groups = O.departments.map((g) => `${esc(g.name)} (${g.letter})`).join(', ');
    const fundList = Object.entries(CFG.fund_names || {}).filter(([k]) => D.funds.includes(k)).map(([k, v]) => `<li>${esc(v)}</li>`).join('');
    const gbYears = GB ? [...new Set(GB.rows.map((r) => r.year))].sort((a, b) => a - b) : [];
    const gbLines = GB ? [...new Set(GB.rows.map((r) => r.line))] : [];
    const gbTable = GB ? `<div class="table-scroll"><table class="table ledger" aria-label="Audited fund balances at December 31"><thead><tr><th scope="col">At December 31</th>${gbYears.map((y) => `<th scope="col" class="num">${y}</th>`).join('')}</tr></thead><tbody>${gbLines.map((ln) => `<tr><th scope="row">${esc(ln)}</th>${gbYears.map((y) => { const r = GB.rows.find((x) => x.year === y && x.line === ln); return `<td class="num">${r ? gbLink(money(r.v), r) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    const merges = (CH?.account_changes || []).map((m) => `<li>${esc(m.from.join(' and '))} → ${esc(m.to)} ${esc(m.to_name)}: ${esc(m.evidence)}</li>`).join('');
    $('about-body').innerHTML = `
      <h2 class="about-h">Sources</h2>
      <p>Every Budget figure comes from the County of Lancaster's published budget books. Each book reports two or three years side by side; this site shows <strong>one Budget figure per year</strong>, from the newest book that prints that year, and labels it simply “Budget”.</p>
      <ul>
        <li><strong>${D.newest_year}: Budget</strong>${ac ? `, ${esc(ac.text)}` : ''}.</li>
        <li><strong>${years().filter((y) => y < D.newest_year).sort((a, b) => a - b).join(', ')}: Budget</strong>, as the next year's book prints them. The books do not call these figures adopted or amended, so the site does not either.</li>
      </ul>
      <p>Books in use:</p><ul>${books}</ul>
      <p>Years appear as soon as the books that report them have been processed.</p>
      <h2 class="about-h">Actual figures</h2>
      <p>Actual figures for ${A.years[0]} to ${A.years[A.years.length - 1]} come from the County's audited annual reports, in the budget-versus-actual schedules.</p>
      <ul>${D.actuals_note.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p>Audited reports in use:</p><ul>${acfrs}</ul>
      <h2 class="about-h">Departments and funds</h2>
      <p>Departments are grouped as the County's <a href="${pdf(O.chart_doc)}#page=${O.chart_page}" target="_blank" rel="noopener">${D.newest_year} budget book</a> groups them: ${groups}. Each budget line belongs to a department by its account number, with the department's name as the book prints it. The County does not publish staffing schedules, so there is no Staff section.</p>
      <p>The County's books print fund letters without names. The names shown here come from the County's audited annual reports:</p>
      <ul>${fundList}</ul>
      <h2 class="about-h" id="about-balance" tabindex="-1">General Fund balance (audited)</h2>
      <p>The County's budget books print no General Fund balance page, so this site cannot say how the General Fund's budget gap is met. The audited annual reports do print year-end fund balances. These are <strong>audited year-end balances on the County's accounting (modified accrual) basis</strong>, not budget figures: they are not comparable with the Budget or with the Actual figures above, and they are not a projection.</p>
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
      <h2 class="about-h">Known problems in the source books</h2>
      <p>These come from errors or differences in the County's documents, not the extraction. A person reviewed each one.</p>
      <details class="values" id="about-issues" tabindex="-1"><summary>Show all ${D.known_issues.length} notes</summary><ul>${issues || '<li>None recorded.</li>'}</ul></details>
      <h2 class="about-h">Get the data</h2>
      <p><a href="${CFG.paths.data}budget.json">budget.json</a> (every figure shown here, including the Actual figures), <a href="${CFG.paths.data}changes.json">changes.json</a> (what changed in ${D.newest_year}), <a href="${CFG.paths.data}conflicts.json">conflicts.json</a> and <a href="${CFG.paths.data}fund_balance_gaap.json">fund_balance_gaap.json</a> (audited year-end balances). The extraction scripts and tables are in the project repository.</p>${CFG.contact_email ? `
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
      .sort((a, c) => a.year - c.year || ORDER.indexOf(a.measure) - ORDER.indexOf(c.measure)).map((s) => `${s.year} ${LABEL[s.measure].toLowerCase()}`);
    const bookName = (b) => `${b.year} ${/revised|proposed/i.test(b.doc) ? 'Revised Proposed Budget' : 'Adopted Budget'}`;
    const nameOf = Object.fromEntries(D.books.map((b) => [b.doc, bookName(b)]));
    const books = used.map((b) => { const f = figs(b); const href = `${CFG.paths.pdfs}${encodeURIComponent(b.doc)}`; return `<li><a href="${href}" target="_blank" rel="noopener">${esc(bookName(b))}</a> (<a href="${href}" download>download PDF</a>): ${f.length ? 'supplies ' + f.join(', ') : 'no figures under the selection rule'}.</li>`; }).join('');
    const issues = D.known_issues.map((i) => `<li>${esc(nameOf[i.source_doc] || i.source_doc.replace(/\.pdf$/i, ''))}: ${esc(scrubPages(i.note))}</li>`).join('');
    $('about-body').innerHTML = `
      <h2 class="about-h">Sources</h2>
      <p>Every figure comes from ${esc(CFG.entity.possessive)} published budget books. Each book reports several years side by side; this site picks <strong>one kind of figure per year</strong>:</p>
      <ul>
        <li><strong>${actualYears[0]}–${actualYears[actualYears.length - 1]}: Actual</strong>, the audited spending reported in the budget book published two years later.</li>
        ${projYears.length ? `<li><strong>${projYears.join(', ')}: Projected</strong>, the city's year-end estimate (the revised projection when present) from the next year's book. The actual for ${projYears.length > 1 ? 'these years is' : 'this year is'} not published yet.</li>` : ''}
        <li><strong>${D.newest_year}: Proposed and Revised</strong>, both from the ${D.newest_year} book, so you can compare what changed between them. Neither is an adopted budget.</li>
      </ul>
      <p>Adopted and amended budgets, year-to-date columns and an older book's own-year proposal are not shown.</p>
      ${D.reserve ? `<h2 class="about-h">Reserve Fund</h2>
      <p>The <strong>Reserve Fund</strong> entry in the Fund selector is the General Fund's balance, from the budget book's Fund Balance Projection page. Each book prints the actual balance at the end of the year two years earlier; that is the <strong>actual</strong> year-end balance for that year (unaudited for recent years). The newest book also prints a projected balance for the prior year and proposed and revised balances for the newest year. The same one-kind-per-year rule applies. Where a book prints two columns that disagree, the revised column is used and the difference is stated on the page.</p>` : ''}
      <p>Books in use:</p><ul>${books}</ul>
      <p>Years appear as soon as the books that report them have been processed.</p>
      <h2 class="about-h">Departments and bureaus</h2>
      <p>Departments and bureaus follow the city's <a href="${CFG.paths.pdfs}${encodeURIComponent(O.chart_doc)}" target="_blank" rel="noopener">2027 organizational chart</a>. Each budget line belongs to a bureau by its account number, so older years are grouped the same way even where the budget book printed them under another department or name (for example, Human Resources is shown under Executive in every year). Budget groups that are not a bureau, such as city-wide insurance, benefits and debt service or fee revenue, are shown as a separate “department-wide” group. Descriptions of what each department and bureau does are quoted from the city's <a href="${CFG.paths.pdfs}${encodeURIComponent(O.desc_doc)}" target="_blank" rel="noopener">2027 organization descriptions</a>.</p>
      <h2 class="about-h">Validation</h2>
      <p>Line items were extracted from the PDFs by script (scanned books were OCR'd first). Figures are shown as printed, never adjusted. Where overlapping books disagree on the same figure, the rule above decides and the disagreement is logged (${D.conflict_count} so far). Lines of $0 are left out.</p>
      <h2 class="about-h" id="about-totals">Printed and calculated totals</h2>
      <p>Every total is shown exactly as the city printed it, and links to its page. The site adds up the line items under each printed total (each section, department roll-up and fund) only to check it. A difference of up to $5 on a section total, or up to 50 cents for each line in a larger roll-up, is the city's rounding to whole dollars and is not mentioned.</p>
      <p>Where the lines add up to something else, the printed total is still the one shown. It carries a <span class="gap-mark" aria-hidden="true">${GAP_SIGN}</span> sign, and a note beside it gives what the lines add up to, the difference, and the reviewed explanation from the list of known problems below.</p>
      <p>Where the book prints no total for exactly what you are looking at, the figure is this site's own sum of the line items, labelled <span class="calc-tag">calculated</span>. That covers all funds together, departments and bureaus regrouped to the 2027 org chart, spending categories, and line items narrowed by a search.</p>
      <h2 class="about-h">Known problems in the source books</h2>
      <p>These come from errors in the city's documents, not the extraction. A person reviewed each one.</p>
      <details class="values" id="about-issues" tabindex="-1"><summary>Show all ${D.known_issues.length} notes</summary><ul>${issues || '<li>None recorded.</li>'}</ul></details>
      <h2 class="about-h">Get the data</h2>
      <p><a href="${CFG.paths.data}budget.json">budget.json</a> (every figure shown here), <a href="${CFG.paths.data}staffing.json">staffing.json</a> (budgeted positions), <a href="${CFG.paths.data}conflicts.json">conflicts.json</a>, <a href="${CFG.paths.data}changes.json">changes.json</a> (what changed in ${D.newest_year}, with the fund shifts and position counts). The extraction scripts and tables are in the project repository.</p>${CFG.contact_email ? `
      <h2 class="about-h">Contact</h2>
      <p>Found an error, or have a question about a figure? Email <a href="mailto:${esc(CFG.contact_email)}">${esc(CFG.contact_email)}</a>.</p>` : ''}`;
    groupAbout();
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
    document.title = CFG.site_title;
    $('wordmark').textContent = SITE; $('wordmark').setAttribute('href', eh(''));
    document.querySelector('meta[name=description]')?.setAttribute('content', CFG.description);
    $('footer-text').textContent = CFG.footer;
    if (CFG.tagline) $('tagline').textContent = CFG.tagline;
    if (CFG.contact_email) $('footer-contact').innerHTML = `Questions or corrections: <a href="mailto:${esc(CFG.contact_email)}">${esc(CFG.contact_email)}</a>`;
    const nav = { home: eh(''), changes: eh('changes'), reserve: eh('?f=Reserve%20Fund'), about: eh('about') };
    document.querySelectorAll('#site-nav a[data-nav]').forEach((a) => {
      a.setAttribute('href', nav[a.dataset.nav]);
      if (a.dataset.nav === 'reserve') a.closest('li').hidden = !D.reserve; // the County has no Reserve Fund page
    });
    jumpIndexReset();
  }
  const jumpIndexReset = () => { jumpIndex = null; const i = $('jump-input'); if (i) i.value = ''; };
  /* City / County tabs: each opens the same kind of page in the other entity (the overview, What changed or About). */
  function renderSwitch() {
    const tail = route.name === 'changes' ? 'changes' : route.name === 'about' ? 'about' : '';
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
