/* Budget Explorer: plain JS, no build step. Entity name, title and data paths come from config.json;
 * brand and chart colors (light and dark) come from the CSS variables in styles.css. Data: <paths.data>budget.json (scripts/build_dataset.py).
 * Routes (hash-based, so GitHub Pages needs no server rules):
 *   #/                                        all departments
 *   #/department/<dept>                       one department
 *   #/department/<dept>/bureau/<unit>         one bureau (org-chart unit)
 * Departments and bureaus follow the city's 2027 org chart (budget.json `org` block, built by
 * scripts/org_structure.py): every line's org code maps to one unit, and each unit to one department.
 * Older bureau links (#/department/<dept>/bureau/<fund--printed group>) redirect to the unit.
 * Shared query: y=year m=measure c=compare k=revenue f=fund
 */
(() => {
  'use strict';

  const LABEL = { proposed: 'Proposed', revised: 'Revised', projected: 'Projected', actual: 'Actual' };
  const ORDER = ['actual', 'projected', 'proposed', 'revised'];
  const STATUS = {
    proposed: 'Proposed, not adopted', revised: 'Revised proposal, not adopted',
    projected: 'Projected year-end estimate', actual: 'Actual spending',
  };
  const CAT_ORDER = ['Salaries & Wages', 'Benefits', 'Operating', 'Equipment & Capital', 'Debt, Transfers & Allocations', 'Revenue', 'Uncoded'];
  // Colors are read from CSS variables at start-up (see loadTokens), so branding lives in styles.css.
  let PALETTE = [], OTHER_COLOR = '#777', SEL = '#41ffca', CMP = '#ffca41', INK = '#fff', MUTED = '#b3b3b3', GRID = '#262626', SURFACE = '#0d0d0d', BG = '#000';
  let CFG = null, DEFAULT_FUND = '';
  function loadTokens() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--cat-${i}`, '#888'));
    OTHER_COLOR = v('--cat-other', OTHER_COLOR); SEL = v('--sel', SEL); CMP = v('--cmp', CMP);
    INK = v('--fg', INK); MUTED = v('--muted', MUTED); GRID = v('--border', GRID); SURFACE = v('--card', SURFACE); BG = v('--bg', BG);
  }
  const PAGE_SIZE = 50;
  const PIE_SLICES = 7;

  let D = null, O = null; // O = D.org (departments, units, org code -> unit)
  const rowCache = new Map();
  let charts = [];
  const S = { y: 0, m: '', c: '', k: 'expense', f: '' };
  let route = { name: 'home' };
  let aboutOpen = false; // "What does this … do?" stays open when the page re-renders (theme, filters)
  const T = { sort: 'sel', dir: -1, q: '', shown: PAGE_SIZE };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const short = (n) => {
    const a = Math.abs(n), sg = n < 0 ? '-' : '';
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
  const bookYearOf = (k) => { const s = series(k); return s.year + D.rule[s.measure].book_offset; };
  const pdfHref = (d, p) => `${CFG.paths.pdfs}${encodeURIComponent(D.docs[d])}#page=${p}`;
  const src = (text, k, d, p) => (d == null || !k ? text
    : `<a class="src" href="${pdfHref(d, p)}" target="_blank" rel="noopener" title="View in budget book" aria-label="${esc(text)}: open source page in the ${bookYearOf(k)} budget book">${text}</a>`);
  const firstPage = (list) => { let d = null, p = Infinity; for (const r of list) { if (d == null) d = r.d; if (r.d === d && r.p < p) p = r.p; } return { d, p }; };
  /* A book can print the same fund roll-up twice (e.g. before and after a late section). Use the
     occurrence closest to the sum of the line items, so a superseded subtotal is not mistaken for the total. */
  const printedFund = (fund, kind, k) => {
    const c = D.printed.filter((x) => x.level === 'rollup' && x.fund === fund && x.kind === kind && k in x.values);
    if (c.length < 2) return c[0];
    const fi = D.funds.indexOf(fund);
    const shown = sum(rows(k).filter((r) => r.fund === fi && (kind === 'revenue') === isRevenue(r)));
    return c.reduce((b, x) => (Math.abs(x.values[k] - shown) < Math.abs(b.values[k] - shown) ? x : b));
  };

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
    let r = { name: 'home' };
    if (parts[0] === 'department' && parts[1]) {
      r = parts[2] === 'bureau' && parts[3] ? { name: 'bureau', dept: parts[1], bureau: parts[3] } : { name: 'dept', dept: parts[1] };
    }
    return { r, q };
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
  const deptHash = (dept, over) => `#/department/${O.departments[dept].slug}?${query(over)}`;
  const unitHash = (unit, over) => `#/department/${O.departments[O.units[unit].dept].slug}/bureau/${O.units[unit].slug}?${query(over)}`;
  const homeHash = (over) => `#/?${query(over)}`;

  function navigate(hash, replace = false) {
    if (replace) { history.replaceState(null, '', hash); onRoute(false); } else { location.hash = hash; }
  }
  const currentHash = () => (route.name === 'home' ? homeHash : route.name === 'dept' ? (o) => deptHash(route.deptIdx, o) : (o) => unitHash(route.unitIdx, o));

  /* ---------- shared UI pieces ---------- */
  function statusHTML() {
    const draft = S.m === 'proposed' || S.m === 'revised';
    return `<span class="status${draft ? ' not-adopted' : ''}">${S.y}: ${STATUS[S.m]}</span>`;
  }

  function reserveFiltersHTML() {
    const ys = [...new Set(D.reserve.entries.map((e) => e.year))].sort((a, b) => b - a);
    const ms = ORDER.filter((m) => resFind(S.y, m));
    const funds = `<option value="">All funds</option>` + D.funds.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')
      + extraFundViews().map((f) => `<option value="${esc(f)}" ${f === S.f ? 'selected' : ''}>${esc(f)}</option>`).join('');
    return `<div class="filters">
        <div class="field"><label class="field-label" for="f-y">Fiscal year</label><select id="f-y" data-sel="y">${ys.map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select>${defineFund()}</div>
      </div>
      ${ms.length > 1 ? `<div class="filters"><div class="field field-wide"><span class="field-label" id="lbl-m">Figure</span><div class="tabs" role="radiogroup" aria-label="m">${ms.map((m) => `<button type="button" role="radio" aria-checked="${m === S.m}" data-tab="m" data-v="${m}">${esc(LABEL[m])}</button>`).join('')}</div>${defineFigures()}</div></div>` : ''}`;
  }

  /* Short plain definitions beside the controls. A <details> works on touch and with screen readers (no hover or title). */
  const DEFINE_FIGURES = [['Proposed', 'the administration\'s first budget proposal.'], ['Revised', 'the revised proposal.'], ['Neither is adopted.', ''],
    ['Projected', 'the city\'s year-end estimate.'], ['Actual', 'what was spent, reported in the budget book two years later.']];
  const defineFigures = () => `<details class="define"><summary>What do these mean?</summary><ul>${DEFINE_FIGURES.map(([a, b]) => (b ? `<li><strong>${a}:</strong> ${b}</li>` : `<li class="aside">${a}</li>`)).join('')}</ul></details>`;
  const defineFund = () => `<details class="define"><summary>What is a fund?</summary><p>A fund is a separate account the city keeps for a purpose. The General Fund pays for most city services; others, such as water, sewer and trash, are paid for by their own fees and are not mixed with it. The Reserve Fund is the General Fund's savings balance.</p></details>`;

  /* The controls sit behind a one-line summary and a "Change" button, so content comes first. Open by default
     on wide screens, closed on phones; the visitor's last choice is remembered (localStorage may be blocked). */
  let ctlOpen = null;
  const controlsOpen = () => {
    if (ctlOpen == null) {
      try { const v = localStorage.getItem('controlsOpen'); if (v === '1' || v === '0') ctlOpen = v === '1'; } catch (e) { /* no storage */ }
      if (ctlOpen == null) ctlOpen = !matchMedia('(max-width: 767px)').matches;
    }
    return ctlOpen;
  };
  function setControls(open) {
    ctlOpen = open;
    try { localStorage.setItem('controlsOpen', open ? '1' : '0'); } catch (e) { /* the choice lasts for this visit */ }
  }
  function controlsWrap(inner, summary) {
    const open = controlsOpen();
    return `<div class="controls"><div class="controls-bar"><p class="controls-sum" id="controls-sum">${summary}</p>
        <button type="button" class="btn btn-outline controls-btn" data-toggle-controls aria-expanded="${open}" aria-controls="controls-panel">${open ? 'Done' : 'Change'}</button></div>
      <div class="controls-panel" id="controls-panel"${open ? '' : ' hidden'}>${inner}</div></div>`;
  }
  const kindWordPlain = () => (S.k === 'revenue' ? 'Income' : 'Spending');

  /* Lines of a department or bureau in either shown figure, ignoring the Fund selector: what that page can offer. */
  function scopeRows(scope) {
    const ks = [key(S.y, S.m), S.c].filter(Boolean);
    return ks.flatMap((kk) => rows(kk).filter((r) => (scope.dept == null || r.od === scope.dept) && (scope.unit == null || r.unit === scope.unit)));
  }

  function filtersHTML({ fund = true, scope = null } = {}) {
    if (isReserve()) return controlsWrap(reserveFiltersHTML(), `Viewing ${esc(D.reserve.name)} · ${S.y}${S.m ? ' ' + esc(LABEL[S.m]) : ''}`);
    const k = key(S.y, S.m);
    const yrs = years().map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('');
    const opts = Object.keys(D.series).filter((x) => x !== k)
      .sort((a, b) => parseKey(b).y - parseKey(a).y || ORDER.indexOf(parseKey(a).m) - ORDER.indexOf(parseKey(b).m));
    const cmp = `<option value="none" ${!S.c ? 'selected' : ''}>No comparison</option>` + opts.map((x) => `<option value="${x}" ${x === S.c ? 'selected' : ''}>${esc(seriesLabel(x))}</option>`).join('');
    // Home offers every fund plus "All funds" and the Reserve Fund. A department page offers only the funds it has lines in
    // (and the current choice, so the control never disagrees with the page).
    const sr = scope ? scopeRows(scope) : null;
    const present = new Set((sr || rows(k)).map((r) => r.fund));
    const keep = (f) => f === S.f;
    const funds = (scope ? '' : `<option value="">All funds</option>`)
      + (scope && !S.f ? `<option value="" selected>All funds</option>` : '')
      + D.funds.map((f, i) => (present.has(i) || keep(f) ? `<option value="${esc(f)}" ${keep(f) ? 'selected' : ''}>${esc(f)}</option>` : '')).join('')
      + (scope ? '' : extraFundViews().map((f) => `<option value="${esc(f)}" ${f === S.f ? 'selected' : ''}>${esc(f)}</option>`).join(''));
    const tabs = (name, items, cur) => `<div class="tabs" role="radiogroup" aria-label="${name}">${items.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-tab="${name}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
    // Offer Spending / Income only where the page has both kinds of lines.
    const kinds = sr ? ['expense', 'revenue'].filter((kd) => kd === S.k || sr.some((r) => (kd === 'revenue') === isRevenue(r))) : ['expense', 'revenue'];
    const kindTabs = kinds.length > 1
      ? `<div class="field field-wide"><span class="field-label" id="lbl-k">Show: Spending / Income</span>${tabs('k', [['expense', 'Spending'], ['revenue', 'Income']], S.k)}</div>` : '';
    const showFund = fund && (!scope || [...present].length + (S.f && !present.has(D.funds.indexOf(S.f)) ? 1 : 0) > 1 || !S.f);
    const inner = `<div class="filters">
        <div class="field"><label class="field-label" for="f-y">Fiscal year</label><select id="f-y" data-sel="y">${yrs}</select></div>
        <div class="field"><label class="field-label" for="f-c">Compare with</label><select id="f-c" data-sel="c">${cmp}</select>${defineFigures()}</div>
        ${showFund ? `<div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select>${defineFund()}</div>` : ''}
      </div>
      <div class="filters">
        ${measuresFor(S.y).length > 1 ? `<div class="field field-wide"><span class="field-label" id="lbl-m">Figure</span>${tabs('m', measuresFor(S.y).map((m) => [m, LABEL[m]]), S.m)}${defineFigures()}</div>` : ''}
        ${kindTabs}
      </div>`;
    const parts = [`Viewing ${esc(seriesLabel(k))}`, S.c ? `compared with ${esc(seriesLabel(S.c))}` : 'no comparison'];
    if (fund) parts.push(esc(S.f || 'All funds'));
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
    navigate(currentHash()(over), true);
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
        const l = scoped(kk, scope);
        pts.push({ y, m, v: l.length ? sum(l) : null });
      }
    }
    return pts;
  }
  function trendHTML(scope, title) {
    trendScope = scope;
    const pts = trendData(scope);
    if (!pts.some((p) => p.v != null)) return '';
    const has = (m) => pts.some((p) => p.m === m && p.v != null);
    const legend = [
      has('actual') && `<li><i class="ln"></i>Actual</li>`,
      has('projected') && `<li><i class="ln dashed"></i>Projected</li>`,
      has('proposed') && `<li><i class="dot" style="background:${PALETTE[0]}"></i>Proposed</li>`,
      has('revised') && `<li><i class="dot ring" style="border-color:${PALETTE[1]}"></i>Revised</li>`,
    ].filter(Boolean).join('');
    const rowsHtml = pts.map((p) => `<tr><th scope="row">${p.y}</th><td>${LABEL[p.m]}</td><td class="num">${p.v == null ? '—' : money(p.v)}</td></tr>`).join('');
    return `<section class="panel" aria-labelledby="tr-t"><h2 class="panel-title" id="tr-t">${esc(title)}</h2>
      <p class="panel-note">${kindWordPlain()}${S.f ? ' · ' + esc(S.f) : ''}. Each year shows one kind of figure: actual, projected or proposed.</p>
      <ul class="trend-legend" aria-hidden="true">${legend}</ul>
      <div class="chart-box short"><canvas id="trend-chart" role="img" aria-label="Totals by year, ${pts[0].y} to ${pts[pts.length - 1].y}. Solid line: actual. Dashed line: projected. Small dot: proposed. Ring: revised. The table below has the values."></canvas></div>
      <details class="values"><summary>Show values</summary><div class="table-scroll"><table class="table"><thead><tr><th scope="col">Year</th><th scope="col">Figure</th><th scope="col" class="num">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></details></section>`;
  }
  function drawTrend() {
    const cv = $('trend-chart');
    if (!cv || !window.Chart || !trendScope) return;
    const pts = trendData(trendScope), th = chartTheme();
    const yrs = [...new Set(pts.map((p) => p.y))];
    const main = yrs.map((y) => pts.find((p) => p.y === y && (p.m === 'actual' || p.m === 'projected')) || null);
    const dot = (m, c) => ({ label: LABEL[m], data: yrs.map((y) => pts.find((p) => p.y === y && p.m === m)?.v ?? null), borderColor: c, backgroundColor: c, showLine: false, pointRadius: 5, pointHoverRadius: 7 });
    const datasets = [{
      label: 'Actual / Projected', data: main.map((p) => p?.v ?? null), borderColor: SEL, borderWidth: 2, tension: 0, spanGaps: true,
      pointRadius: 4, pointHoverRadius: 6, pointBorderColor: SEL, pointBackgroundColor: (c) => (main[c.dataIndex]?.m === 'projected' ? SURFACE : SEL),
      segment: { borderDash: (c) => (main[c.p1DataIndex]?.m === 'projected' ? [6, 4] : undefined) },
    }];
    if (pts.some((p) => p.m === 'proposed')) datasets.push(dot('proposed', PALETTE[0]));
    // Proposed and Revised sit at nearly the same height in the same year: Proposed is a small filled dot, Revised a larger open ring around it.
    if (pts.some((p) => p.m === 'revised')) datasets.push({ ...dot('revised', PALETTE[1]), backgroundColor: 'transparent', borderWidth: 3, pointRadius: 10, pointHoverRadius: 12, pointBorderWidth: 3 });
    charts.push(new Chart(cv, { type: 'line', data: { labels: yrs, datasets },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 8 } }, animation: reduceMotion() ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => (c.datasetIndex === 0 ? `${LABEL[main[c.dataIndex].m]}: ${money(c.raw)}` : `${c.dataset.label}: ${money(c.raw)}`) } } },
        scales: { x: { offset: true, ticks: { color: INK }, grid: { color: th.grid } }, y: { beginAtZero: true, ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
  }
  /* Where a book's own printed fund total differs from the sum of its line items, say so. */
  function rollupNote(list) {
    const k = key(S.y, S.m), out = [];
    for (const fi of [...new Set(list.map((r) => r.fund))]) {
      const fund = D.funds[fi], pr = printedFund(fund, S.k, k);
      if (!pr) continue;
      const printed = pr.values[k];
      const shown = sum(rows(k).filter((r) => r.fund === fi && (S.k === 'revenue') === isRevenue(r))); // whole fund, not just this page's lines
      if (Math.abs(shown - printed) <= 100) continue; // smaller gaps are the city's rounding
      const miss = D.missing_bureaus[D.docs[pr.doc]];
      const why = miss && shown < printed
        ? `The city's ${bookYearOf(k)} budget book leaves out the line items for ${esc(miss.join(' and '))}, so the figure shown is lower than the city's printed total. See “Known problems in the source books” below for the rest.`
        : 'See “Known problems in the source books” below.';
      out.push(`${esc(fund)}: the ${bookYearOf(k)} budget book prints ${money(printed)}, but its line items add up to ${money(shown)} (${money(Math.abs(shown - printed))} ${shown < printed ? 'less' : 'more'}). ${why}`);
    }
    return out.length ? `<div class="notice" role="note">${out.join('<br>')}</div>` : '';
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
  function drawNote(k) {
    if (!D.reserve) return '';
    const gf = D.funds.indexOf(DEFAULT_FUND);
    if (gf < 0 || S.f !== D.funds[gf]) return ''; // the draw sits in the General Fund; shown on that view
    const dr = reserveDraw(k, gf);
    if (!dr) return '';
    return `<p class="draw-note">Balanced by drawing ${src(millions(dr.v), k, dr.d, dr.p)} from the reserve (Fund Balance Reserve). <a href="${esc(homeHash({ f: D.reserve.name }))}">See the Reserve Fund</a></p>`;
  }
  /* One line tying the Reserve page's "Revenues" to the General Fund's revenue elsewhere on the site. */
  function reserveTie(e) {
    const k = key(e.year, e.measure), rev = e.lines.find((l) => l.t === 'revenues');
    if (!rev || !series(k)) return '';
    const gf = D.funds.indexOf(DEFAULT_FUND), dr = reserveDraw(k, gf);
    if (!dr) return '';
    const gfRev = sum(rows(k).filter((r) => r.fund === gf && isRevenue(r)));
    const gap = Math.round(rev.v + dr.v - gfRev), ties = Math.abs(gap) <= 5;
    return `<p class="hint tie-note" style="margin-top:0">This page's revenues of ${srcDoc(money(rev.v), e.doc, rev.p)} plus ${src(money(dr.v), k, dr.d, dr.p)} drawn from the reserve (the “Fund Balance Reserve” revenue line) ${ties ? (gap === 0 ? 'equal' : 'equal, within the city\'s rounding,') : `come to ${money(rev.v + dr.v)}, ${money(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than`} the General Fund's ${money(gfRev)} of revenue. <a href="${esc(homeHash({ f: DEFAULT_FUND, k: 'revenue', y: e.year, m: e.measure }))}">See General Fund revenue</a></p>`;
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
  const chgHTML = (c) => (c ? `<span class="${c.d > 0 ? 'up' : c.d < 0 ? 'down' : 'flat'}">${c.d > 0 ? '+' : ''}${money(c.d)}${c.p == null ? '' : `<span class="pct"> (${c.p > 0 ? '+' : ''}${c.p.toFixed(1)}%)</span>`}</span>` : '—');
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
    if (e.note) notices.push(`${esc(e.note)} See “Known problems in the source books” below.`);
    const entries = resSorted();
    const colorsLegend = [
      entries.some((x) => x.measure === 'actual') && `<li><i class="sw"></i>Actual</li>`,
      entries.some((x) => x.measure === 'projected') && `<li><i class="sw hatched" style="--c:${SEL}"></i>Projected</li>`,
      entries.some((x) => x.measure === 'proposed') && `<li><i class="sw hatched" style="--c:${PALETTE[0]}"></i>Proposed</li>`,
      entries.some((x) => x.measure === 'revised') && `<li><i class="sw hatched" style="--c:${PALETTE[1]}"></i>Revised</li>`,
    ].filter(Boolean).join('');
    const yrRows = entries.map((x) => {
      const xc = resChange(x), xe = resEnd(x);
      return `<tr${x === e ? ' aria-current="true"' : ''}><th scope="row"><a href="${esc(homeHash({ y: x.year, m: x.measure }))}">${x.year}</a></th><td>${esc(x.measure === 'actual' && x.basis === 'unaudited' ? 'Actual (unaudited)' : LABEL[x.measure])}</td><td class="num">${srcDoc(money(xe.v), x.doc, xe.p)}</td><td class="num">${chgHTML(xc)}</td></tr>`;
    }).join('');
    const detail = e.lines.length > 1
      ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Line</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${e.lines.map((l) => `<tr><td>${esc(resLineLabel(l, e))}</td><td class="num">${srcDoc(money(l.v), e.doc, l.p)}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="panel-note" style="margin:0 0 12px">For actual years the city's budget book prints only the closing balance.</p><div class="table-scroll"><table class="table"><tbody><tr><td>${esc(resLineLabel(end, e))}</td><td class="num">${srcDoc(money(end.v), e.doc, end.p)}</td></tr></tbody></table></div>`;
    return `<header class="page-head"><h1 id="page-h" tabindex="-1">${esc(name)}: ${esc(resLabel(e))}</h1>
        <p class="big-total" aria-live="polite">${srcDoc(money(end.v), e.doc, end.p)}</p>
        <p class="compare-line">Year-end balance${ch ? ` · change from ${ch.from}: ${chgHTML(ch)}` : ''}</p>
        <span class="status${e.measure === 'proposed' || e.measure === 'revised' ? ' not-adopted' : ''}">${e.year}: ${esc(RES_STATUS[e.measure])}</span>
        ${notices.map((n) => `<div class="notice" role="note">${n}</div>`).join('')}</header>
      ${filtersHTML()}
      <p class="hint" style="margin-top:0">The General Fund's reserve: the cash balance carried from year to year.</p>${reserveTie(e)}
      <section class="panel" aria-labelledby="rb-t"><h2 class="panel-title" id="rb-t">Year-End Balance, ${entries[0].year}–${entries[entries.length - 1].year}</h2>
        <ul class="trend-legend" aria-hidden="true">${colorsLegend}</ul>
        <div class="chart-box"><canvas id="res-chart" role="img" aria-label="Year-end General Fund balance by year: ${esc(entries.map((x) => `${x.year} ${LABEL[x.measure]} ${money(resEnd(x).v)}`).join(', '))}. The table below has the values."></canvas></div></section>
      <section class="panel" aria-labelledby="rd-t"><h2 class="total-label" id="rd-t">${esc(resLabel(e))}: How the Balance Changes</h2>${detail}</section>
      <section class="panel" aria-labelledby="ry-t"><h2 class="total-label" id="ry-t">Year-End Balance by Year</h2><div class="table-scroll"><table class="table tight">
        <thead><tr><th scope="col">Year</th><th scope="col">Figure</th><th scope="col" class="num">Year-end balance</th><th scope="col" class="num">Change</th></tr></thead><tbody>${yrRows}</tbody></table></div></section>`;
  }
  function drawReserve() {
    const cv = $('res-chart');
    if (!cv || !window.Chart) return;
    const th = chartTheme(), entries = resSorted(), cur = resFind(S.y, S.m);
    const dup = (y) => entries.filter((x) => x.year === y).length > 1;
    const labels = entries.map((x) => (dup(x.year) ? `${x.year} ${LABEL[x.measure]}` : String(x.year)));
    charts.push(new Chart(cv, { type: 'bar',
      data: { labels, datasets: [{ data: entries.map((x) => resEnd(x).v),
        backgroundColor: entries.map((x) => (x.measure === 'actual' ? SEL : hatch(resColor(x)))),
        borderColor: entries.map((x) => (x === cur ? INK : resColor(x))), borderWidth: entries.map((x) => (x === cur ? 3 : x.measure === 'actual' ? 0 : 1.5)), borderRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
        onClick: (_ev, els) => { if (els.length) { const x = entries[els[0].index]; navigate(homeHash({ y: x.year, m: x.measure }), true); } },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { title: (c) => resLabel(entries[c[0].dataIndex]), label: (c) => money(c.raw) } } },
        scales: { x: { ticks: { color: INK, maxRotation: 45 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
  }

  /* Department / bureau cards: name, share of the whole, and selected-vs-comparison bars. The whole card links. */
  function cardList(items, { total, k, shareOf, level }) {
    const max = Math.max(1, ...items.flatMap((i) => [Math.abs(i.sel?.total || 0), Math.abs(i.cmp?.total || 0)]));
    const bar = (agg, cls, label, bk) => `<div><div class="bar-label ${cls}"><span>${esc(label)}</span><span>${agg ? src(money(agg.total), bk, agg.d, agg.p) : '<span class="missing">No figures</span>'}</span></div>
        <div class="track"><div class="fill ${cls}" style="width:${agg ? Math.max(0, (agg.total / max) * 100) : 0}%"></div></div></div>`;
    return items.map((it) => {
      const sh = total > 0 && it.sel ? (it.sel.total / total) * 100 : null;
      const share = sh == null ? '' : `<span class="share">(${sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)}% of ${esc(shareOf)})</span>`;
      return `<li class="card" data-go="${esc(it.href)}"><div class="card-top"><h${level}><a href="${esc(it.href)}">${esc(it.name)}</a>${share}</h${level}>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></div>
        <div class="bars">${S.c ? bar(it.cmp, 'cmp', seriesLabel(S.c), S.c) : ''}${bar(it.sel, 'sel', seriesLabel(k), k)}</div></li>`;
    }).join('');
  }

  /* ---------- home ---------- */
  function homeView() {
    if (isReserve()) return reserveView();
    const k = key(S.y, S.m);
    const list = scoped(k);
    const total = sum(list);
    const kindWord = kindWordPlain();
    const scope = S.f ? S.f : CFG.entity.short;
    document.title = `${scope} ${kindWord}: ${seriesLabel(k)} · ${CFG.site_title}`;

    const by = (l) => aggregate(l, (r) => r.od, (r) => O.departments[r.od].name);
    const selMap = by(list), cmpMap = S.c ? by(scoped(S.c)) : new Map();
    const keys = new Set([...selMap.keys(), ...cmpMap.keys()]);
    const items = [...keys].map((d) => ({ id: d, name: O.departments[d].name, href: deptHash(d), sel: selMap.get(d), cmp: cmpMap.get(d) }))
      .sort((a, b) => (b.sel?.total || 0) - (a.sel?.total || 0) || (b.cmp?.total || 0) - (a.cmp?.total || 0));
    const cards = cardList(items, { total, k, shareOf: `Total ${seriesLabel(k)} ${kindWord}`, level: 2 });

    return `<header class="page-head"><h1 id="page-h">${esc(scope)} ${kindWord}: ${esc(seriesLabel(k))}</h1>
        <p class="big-total" aria-live="polite">${(() => { const pf = S.f ? printedFund(S.f, S.k, k) : null; return pf ? src(money(total), k, pf.doc, pf.page) : money(total); })()}</p>${drawNote(k)}${statusHTML()}${rollupNote(list)}</header>
      ${filtersHTML()}
      <p class="hint hint-top">Select any department to see its detailed breakdown. Amounts open the source page in the budget book.</p>
      <ul class="cards" aria-label="Departments">${cards || '<li class="empty center">No lines for this selection.</li>'}</ul>
      ${trendHTML({}, 'Totals by Year')}
      <section class="panel" aria-labelledby="re-title"><h2 class="panel-title" id="re-title">Income vs. Spending by Fund: ${esc(seriesLabel(k))}</h2>
        <div class="chart-box"><canvas id="re-chart" role="img" aria-label="Income and spending by fund"></canvas></div>
        <div class="table-scroll"><table class="table" id="re-table"></table></div></section>`;
  }

  function revExpAfter() {
    const k = key(S.y, S.m);
    const all = rows(k);
    const data = [...new Set(all.map((r) => r.fund))].map((fi) => {
      const fr = all.filter((r) => r.fund === fi);
      return { fund: D.funds[fi], rev: sum(fr.filter(isRevenue)), exp: sum(fr.filter((r) => !isRevenue(r))) };
    }).sort((a, b) => b.exp - a.exp);
    const th = chartTheme();
    if (window.Chart) {
      charts.push(new Chart($('re-chart'), {
        type: 'bar',
        data: { labels: data.map((d) => d.fund.replace(' Fund', '')), datasets: [
          { label: 'Income', data: data.map((d) => d.rev), backgroundColor: PALETTE[0], borderRadius: 2 },
          { label: 'Spending', data: data.map((d) => d.exp), backgroundColor: PALETTE[1], borderRadius: 2 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { position: 'bottom', labels: { color: INK, boxWidth: 12, boxHeight: 12 } }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
          scales: { x: { ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } }, y: { ticks: { color: INK }, grid: { display: false } } },
        },
      }));
    }
    const pr = (d, kind) => printedFund(d.fund, kind, k);
    const lk = (d, kind, n) => { const x = pr(d, kind); return x ? src(money(n), k, x.doc, x.page) : money(n); };
    const dcell = (n) => { const r = Math.round(n); return `<span class="${r > 0 ? 'up' : r < 0 ? 'down' : 'flat'}">${money(n)}</span>`; };
    $('re-table').innerHTML = `<thead><tr><th scope="col">Fund</th><th scope="col" class="num">Income</th><th scope="col" class="num">Spending</th><th scope="col" class="num">Income minus spending</th></tr></thead>
      <tbody>${data.map((d) => `<tr><th scope="row">${esc(d.fund)}</th><td class="num">${lk(d, 'revenue', d.rev)}</td><td class="num">${lk(d, 'expense', d.exp)}</td><td class="num">${dcell(d.rev - d.exp)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>All funds</td><td class="num">${money(data.reduce((t, d) => t + d.rev, 0))}</td><td class="num">${money(data.reduce((t, d) => t + d.exp, 0))}</td><td class="num">${dcell(data.reduce((t, d) => t + d.rev - d.exp, 0))}</td></tr></tfoot>`;
  }

  /* ---------- department / bureau pages ---------- */
  function pieSection(title, groups, { clickable, note, k } = {}) {
    const total = groups.reduce((t, g) => t + Math.max(0, g.total), 0);
    if (!groups.length || total <= 0) return '';
    const items = groups.map((g) => {
      const body = `<span class="nm" title="${esc(g.label)}">${esc(g.label)}</span><span class="vl">${clickable ? money(g.total) : src(money(g.total), k, g.d, g.p)} (${((g.total / total) * 100).toFixed(1)}%)${g.sub ? ' · ' + esc(g.sub) : ''}</span>`;
      return `<li><i class="sw" style="background:${g.color}"></i><div class="body">${clickable && g.href ? `<a href="${esc(g.href)}">${body}</a>` : body}</div></li>`;
    }).join('');
    const id = `pie-${slug(title)}`;
    return `<section class="panel" aria-labelledby="${id}-t"><h2 class="panel-title" id="${id}-t">${esc(title)}</h2>${note ? `<p class="panel-note">${esc(note)}</p>` : ''}
      <div class="pie-wrap"><div class="pie-box"><canvas id="${id}" role="img" aria-label="${esc(title)}: ${esc(groups.slice(0, 6).map((g) => `${g.label} ${money(g.total)}`).join(', '))}"></canvas></div>
      <ul class="legend-list">${items}</ul></div></section>`;
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

  function entityView({ title, subtitle, selRows, cmpRows, parentHash, parentLabel, bureauList = '', deptPicker, scope, about = '' }) {
    const k = key(S.y, S.m), kindWord = S.k === 'revenue' ? 'Revenue' : 'Budget';
    const total = sum(selRows), cmpTotal = sum(cmpRows);
    const fp = firstPage(selRows), cfp = firstPage(cmpRows);
    const totalLink = src(money(total), k, fp.d, fp.p), cmpLink = S.c ? src(money(cmpTotal), S.c, cfp.d, cfp.p) : '';
    const cats = categoryGroups(selRows, cmpRows);
    const withColor = (g, i) => ({ ...g, color: g.color || (i < PIE_SLICES ? PALETTE[i] : OTHER_COLOR) });

    let html = `<div class="dept-top"><a class="btn btn-primary" href="${esc(parentHash)}">← ${esc(parentLabel)}</a></div>`;
    if (deptPicker) html += `<div class="field dept-picker" style="margin-inline:auto"><label class="field-label" for="dept-pick">Department</label>${deptPicker}</div>`;
    html += `<header><h1 class="dept-name" id="page-h" tabindex="-1">${esc(title)}</h1>
      <p class="dept-total">Total ${kindWord}: ${totalLink}</p><p class="dept-sub">${subtitle}</p><p class="center">${statusHTML()}</p>${deptPicker ? rollupNote(selRows) : ''}</header>${about}`;
    html += `<div class="dept-filters">${filtersHTML({ fund: !!deptPicker, scope })}</div>`;
    html += bureauList;

    html += pieSection(`${title} ${seriesLabel(k)} ${kindWord} Breakdown`, cats, { k });

    if (cats.length) {
      html += `<section class="panel" aria-labelledby="yoy-t"><h2 class="panel-title" id="yoy-t">${esc(title)} Total ${S.k === 'revenue' ? 'Revenue' : 'Budgeted Cost'}: ${S.c ? 'Comparison' : 'by Category'}</h2>
        <div class="chart-scroll"><div class="chart-box"><canvas id="yoy-chart" role="img" aria-label="${esc(title)} by category, ${esc(S.c ? seriesLabel(S.c) + ' compared with ' : '')}${esc(seriesLabel(k))}"></canvas></div></div></section>`;
    }
    html += trendHTML(scope, `${title}: Totals by Year`);

    html += `<div class="totals">${S.c ? `<section class="panel" aria-label="${esc(seriesLabel(S.c))} total"><h2 class="total-label">${esc(seriesLabel(S.c))} Total</h2><p class="total-value">${cmpLink}</p></section>` : ''}
      <section class="panel" aria-label="${esc(seriesLabel(k))} total"><h2 class="total-label">${esc(seriesLabel(k))} Total</h2><p class="total-value">${totalLink}</p></section></div>`;

    const chg = (a, b) => { const d = a - b, p = pctOf(d, b); return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${money(d)}${p == null ? '' : `<span class="pct"> (${p.toFixed(1)}%)</span>`}</span>`; };
    html += `<section class="panel" aria-labelledby="cat-t"><h2 class="total-label" id="cat-t">Budget Categories</h2><div class="table-scroll"><table class="table tight">
      <thead><tr><th scope="col">Category</th>${S.c ? `<th scope="col" class="num">${esc(seriesLabel(S.c))}</th>` : ''}<th scope="col" class="num">${esc(seriesLabel(k))}</th>${S.c ? '<th scope="col" class="num">Change</th>' : ''}</tr></thead>
      <tbody>${cats.map((g) => `<tr><td>${esc(g.label)}</td>${S.c ? `<td class="num">${src(money(g.cmpTotal), S.c, g.cd, g.cp)}</td>` : ''}<td class="num">${src(money(g.total), k, g.d, g.p)}</td>${S.c ? `<td class="num">${chg(g.total, g.cmpTotal)}</td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;

    if (S.c) {
      html += `<section class="panel" aria-labelledby="ov-t"><h2 class="total-label" id="ov-t">Overall Year-Over-Year Change</h2>
        <p class="overall"><span class="lbl">Total ${kindWord} Change:</span><span class="val">${chg(total, cmpTotal)}</span></p>
        <div class="chart-box short"><canvas id="ov-chart" role="img" aria-label="${esc(seriesLabel(S.c))} ${money(cmpTotal)} compared with ${esc(seriesLabel(k))} ${money(total)}"></canvas></div></section>`;
    }
    html += `<section class="panel" aria-labelledby="li-t"><h2 class="total-label" id="li-t">Line Items</h2><div id="li-holder"></div></section>`;
    return { html, cats };
  }

  function entityCharts(selRows, cmpRows, cats) {
    const k = key(S.y, S.m), th = chartTheme();
    drawPie(`${$('page-h').textContent} ${seriesLabel(k)} ${S.k === 'revenue' ? 'Revenue' : 'Budget'} Breakdown`, cats);
    drawTrend();
    const yoy = $('yoy-chart');
    if (yoy && window.Chart) {
      const ds = [];
      if (S.c) ds.push({ label: seriesLabel(S.c), data: cats.map((g) => g.cmpTotal), backgroundColor: CMP, borderRadius: 2 });
      ds.push({ label: seriesLabel(k), data: cats.map((g) => g.total), backgroundColor: SEL, borderRadius: 2 });
      charts.push(new Chart(yoy, { type: 'bar', data: { labels: cats.map((g) => g.label), datasets: ds },
        options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { position: 'bottom', align: 'end', labels: { color: INK, boxWidth: 12, boxHeight: 12 } }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
          scales: { x: { ticks: { color: INK, font: { size: 11 } }, grid: { color: th.grid } }, y: { ticks: { color: th.tick, font: { size: 11 }, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
    }
    const ov = $('ov-chart');
    if (ov && window.Chart) {
      charts.push(new Chart(ov, { type: 'bar', data: { labels: [seriesLabel(S.c), seriesLabel(k)], datasets: [{ data: [sum(cmpRows), sum(selRows)], backgroundColor: [CMP, SEL], borderRadius: 2 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => money(c.raw) } } },
          scales: { x: { ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid }, beginAtZero: true }, y: { ticks: { color: INK }, grid: { display: false } } } } }));
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
  function lineTable(selRows, cmpRows, showBureau) {
    const k = key(S.y, S.m);
    const all = mergeLines(selRows, cmpRows);
    let list = all;
    const q = T.q.trim().toLowerCase();
    if (q) list = list.filter((e) => `${e.code} ${e.name} ${bureauName(e.bureau)} ${D.funds[e.fund]} ${D.categories[e.cat]}`.toLowerCase().includes(q));
    const val = (e, s) => (e[s] ? e[s].v : 0);
    const sorters = { code: (e) => e.code, name: (e) => e.name.toLowerCase(), cat: (e) => D.categories[e.cat], sel: (e) => val(e, 'sel'), cmp: (e) => val(e, 'cmp'), chg: (e) => val(e, 'sel') - val(e, 'cmp') };
    const f = sorters[T.sort] || sorters.sel;
    list.sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * T.dir; });
    const th = (id, label, cls = '') => `<th scope="col" class="${cls}" aria-sort="${T.sort === id ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${id}">${label}</button></th>`;
    const body = list.slice(0, T.shown).map((e) => {
      const d = val(e, 'sel') - val(e, 'cmp');
      const where = showBureau ? `<span class="sub">${esc(bureauName(e.bureau))}</span>` : '';
      return `<tr><td class="code hide-sm">${esc(e.code)}</td><td>${esc(e.name)}${where}</td><td class="hide-sm">${esc(D.categories[e.cat])}</td>
        ${S.c ? `<td class="num">${e.cmp ? src(money(e.cmp.v), S.c, e.cmp.d, e.cmp.p) : '—'}</td>` : ''}<td class="num">${e.sel ? src(money(e.sel.v), k, e.sel.d, e.sel.p) : '—'}${S.c && d !== 0 ? `<span class="chg-sm ${d > 0 ? 'up' : 'down'}" aria-label="Change from ${esc(seriesLabel(S.c))}: ${money(d)}">${money(d)}</span>` : ''}</td>
        ${S.c ? `<td class="num hide-sm"><span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d === 0 ? '—' : money(d)}</span></td>` : ''}</tr>`;
    }).join('');
    const ts = list.reduce((t, e) => t + val(e, 'sel'), 0), tc = list.reduce((t, e) => t + val(e, 'cmp'), 0);
    const left = list.length - T.shown;
    return `<div class="table-tools"><label class="sr-only" for="li-search">Search line items</label>
        <input type="search" id="li-search" placeholder="Search line items, account numbers…" value="${esc(T.q)}" autocomplete="off">
        <span class="count" aria-live="polite">${q ? `${list.length.toLocaleString()} matching of ${all.length.toLocaleString()} line items` : lineCountText(selRows, cmpRows, all)}</span></div>
      <div class="table-scroll"><table class="table"><thead><tr>${th('code', 'Account', 'hide-sm')}${th('name', 'Line item')}${th('cat', 'Category', 'hide-sm')}${S.c ? th('cmp', esc(seriesLabel(S.c)), 'num') : ''}${th('sel', esc(seriesLabel(k)), 'num')}${S.c ? th('chg', 'Change', 'num hide-sm') : ''}</tr></thead>
        <tbody>${body || '<tr><td colspan="6" class="empty">No matching line items.</td></tr>'}</tbody>
        <tfoot><tr><td class="hide-sm"></td><td>Total${q ? ' (matching)' : ''}</td><td class="hide-sm"></td>${S.c ? `<td class="num">${money(tc)}</td>` : ''}<td class="num">${money(ts)}</td>${S.c ? `<td class="num hide-sm">${money(ts - tc)}</td>` : ''}</tr></tfoot></table></div>
      ${left > 0 ? `<button type="button" class="btn btn-outline more" data-more>Show ${Math.min(PAGE_SIZE, left)} more</button>` : ''}`;
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
      holder.querySelector('[data-more]')?.addEventListener('click', () => { T.shown += PAGE_SIZE; paint(false); });
      if (focus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    };
    paint(false);
  }

  const notFound = (what) => ({ html: `<div class="dept-top"><a class="btn btn-primary" href="${esc(homeHash())}">← All departments</a></div><header class="page-head"><h1 id="page-h" tabindex="-1">${esc(what)} not found</h1><p class="muted">That link doesn't match anything in the current data.</p></header>` });

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
      html += para.startsWith('### ') ? `<h4>${esc(para.slice(4))}</h4>` : `<p>${esc(para)}</p>`;
    }
    flush();
    return html;
  }
  function aboutHTML(question, entries, extra = '') {
    if (!entries.length && !extra) return '';
    const body = entries.map((e) => `<div class="org-entry">${e.h ? `<h3>${esc(e.h)}</h3>` : ''}${descBody(e.t)}
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
    const units = aggregate(selRows, (r) => r.unit, (r) => unitLabel(r.unit));
    const nBureaus = [...units.keys()].filter((u) => O.units[u].kind === 'bureau').length;
    const count = !dept.bureaus ? 'No bureaus' : nBureaus ? `${nBureaus} bureau${nBureaus === 1 ? '' : 's'}` : '';
    const subtitle = selRows.length
      ? [count, [...funds].map((f) => esc(D.funds[f])).join(', '), lineCountText(selRows, cmpRows)].filter(Boolean).join(' · ')
      : `No ${S.k === 'revenue' ? 'revenue' : 'expense'} lines for this department in ${esc(seriesLabel(k))}.`;
    // Bureau list: only for departments that have bureaus on the org chart. Several budget groups can make up one
    // bureau; budget groups that are not a bureau form one "department-wide" card, listed last.
    let bureauList = '';
    if (dept.bureaus) {
      const cmpUnits = S.c ? aggregate(cmpRows, (r) => r.unit, (r) => unitLabel(r.unit)) : new Map();
      const ids = [...new Set([...units.keys(), ...cmpUnits.keys()])];
      const items = ids.map((u) => ({ id: u, name: unitLabel(u), href: unitHash(u), sel: units.get(u), cmp: cmpUnits.get(u) }))
        .sort((a, b) => (O.units[a.id].kind === 'department-wide') - (O.units[b.id].kind === 'department-wide') || (b.sel?.total || 0) - (a.sel?.total || 0) || (b.cmp?.total || 0) - (a.cmp?.total || 0));
      const hasWide = ids.some((u) => O.units[u].kind === 'department-wide');
      if (items.length > 1) {
        const note = 'Bureaus as on the city\'s 2027 org chart. Select one to see its line items.'
          + (hasWide ? ` “${unitLabel(ids.find((u) => O.units[u].kind === 'department-wide'))}” collects budget groups that are not a bureau.` : '');
        bureauList = `<section class="bureau-list" aria-labelledby="bl-t"><h2 class="list-title" id="bl-t">${S.k === 'revenue' ? 'Income by Bureau' : 'Spending by Bureau'}</h2><p class="hint hint-top">${esc(note)} Amounts open the source page in the budget book.</p>
          <ul class="cards" aria-labelledby="bl-t">${cardList(items, { total: sum(selRows), k, shareOf: `${name} ${S.k === 'revenue' ? 'revenue' : 'spending'}`, level: 3 })}</ul></section>`;
      }
    }
    document.title = `${name} ${seriesLabel(k)} · ${CFG.site_title}`;
    const about = aboutHTML('What does this department do?', dept.desc);
    const v = entityView({ title: name, subtitle, selRows, cmpRows, parentHash: homeHash(), parentLabel: 'All departments', bureauList, deptPicker: picker, scope: { dept: di }, about });
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
    const funds = [...new Set([...selRows, ...cmpRows].map((r) => r.fund))].map((f) => esc(D.funds[f]));
    document.title = `${name} ${seriesLabel(k)} · ${CFG.site_title}`;
    const sub = [esc(O.departments[di].name), unit.division ? `${esc(unit.division)} Division` : '', ...funds, lineCountText(selRows, cmpRows)].filter(Boolean).join(' · ');
    let about;
    if (unit.kind === 'department-wide') {
      const groupsShown = [...new Set([...selRows, ...cmpRows].map((r) => bureauName(r.bureau)))].sort();
      about = aboutHTML('What is this?', [], `<p>These budget lines are not a bureau on the city's 2027 org chart. They are budget groups the ${esc(O.departments[di].name)} department manages${groupsShown.length ? `, printed in the budget book as: ${esc(groupsShown.join('; '))}` : ''}.</p>`);
    } else {
      const q = /^Bureau\b/.test(unit.name) ? 'What does this bureau do?' : /^Office\b/.test(unit.name) ? 'What does this office do?' : `What does ${unit.name} do?`;
      about = aboutHTML(q, unit.desc);
    }
    const v = entityView({ title: name, subtitle: sub, selRows, cmpRows, parentHash: deptHash(di), parentLabel: O.departments[di].name, scope, about });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats); mountLines(selRows, cmpRows, true); } };
  }

  /* ---------- render / events ---------- */
  function onRoute(scroll = true) {
    if (!D) return;
    const { r, q } = parseHash();
    route = r;
    if (scroll) aboutOpen = false;
    if (q.get('c') === 'none') { applyQuery(q); S.c = ''; } else applyQuery(q);
    if (route.name !== 'home' && isReserve()) S.f = DEFAULT_FUND; // the reserve has no departments or bureaus
    T.sort = 'sel'; T.dir = -1; T.q = ''; T.shown = PAGE_SIZE;
    destroyCharts();
    let page;
    if (route.name === 'home') page = { html: homeView(), after: () => { if (isReserve()) drawReserve(); else { drawTrend(); revExpAfter(); } } };
    else if (route.name === 'dept') page = deptPage();
    else page = bureauPage();
    if (page.redirect) { navigate(page.redirect, true); return; }
    $('view').innerHTML = page.html;
    page.after?.();
    if (scroll) {
      window.scrollTo({ top: 0 });
      $('page-h')?.focus({ preventScroll: true });
    }
  }

  function wire() {
    window.addEventListener('hashchange', () => onRoute(true));
    const view = $('view');
    view.addEventListener('change', (e) => {
      const sel = e.target.closest('select');
      if (!sel) return;
      if (sel.dataset.pick) navigate(`#/department/${sel.value}?${query()}`);
      else if (sel.dataset.sel) onFilter(sel.dataset.sel, sel.value);
    });
    view.addEventListener('click', (e) => {
      const tog = e.target.closest('[data-toggle-controls]');
      if (tog) {
        const open = tog.getAttribute('aria-expanded') !== 'true';
        setControls(open);
        tog.setAttribute('aria-expanded', String(open)); tog.textContent = open ? 'Done' : 'Change';
        const panel = $('controls-panel'); if (panel) panel.hidden = !open;
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) { onFilter(tab.dataset.tab, tab.dataset.v); return; }
      const card = e.target.closest('[data-go]');
      if (card && !e.target.closest('a')) navigate(card.dataset.go);
    });
    view.addEventListener('toggle', (e) => { if (e.target.classList?.contains('org-about')) aboutOpen = e.target.open; }, true);
    view.addEventListener('keydown', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const btns = [...b.parentElement.querySelectorAll('button')], i = btns.indexOf(b);
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      e.preventDefault(); onFilter(n.dataset.tab, n.dataset.v);
      requestAnimationFrame(() => $('view').querySelector(`[data-tab="${n.dataset.tab}"][data-v="${n.dataset.v}"]`)?.focus());
    });
    $('about-btn').addEventListener('click', () => $('about').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' }));
  }

  /* ---------- about ---------- */
  function scrubPages(text) {
    // Notes quote source page numbers; the site does not show page references.
    return text.replace(/\s*(?:\(|,)?\s*(?:on |from |at )?\b(?:pp?\.?|pages?)\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:and|,)\s*(?:pp?\.?|pages?)?\s*\d+)*\)?/gi, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  function renderAbout() {
    const used = D.books.filter((b) => b.used);
    const yrsOf = (m) => Object.values(D.series).filter((x) => x.measure === m).map((x) => x.year).sort((a, b) => a - b);
    const actualYears = yrsOf('actual'), projYears = yrsOf('projected');
    const figs = (b) => Object.values(D.series).filter((s) => s.year + D.rule[s.measure].book_offset === b.year && D.docs[Array.isArray(s.doc) ? s.doc[0] : s.doc] === b.doc)
      .sort((a, c) => a.year - c.year || ORDER.indexOf(a.measure) - ORDER.indexOf(c.measure)).map((s) => `${s.year} ${LABEL[s.measure].toLowerCase()}`);
    const books = used.map((b) => { const f = figs(b); return `<li>${esc(b.doc.replace(/\.pdf$/i, ''))} (${b.year} book): ${f.length ? 'supplies ' + f.join(', ') : 'no figures under the selection rule'}.</li>`; }).join('');
    const issues = D.known_issues.map((i) => `<li>${esc(i.source_doc.replace(/\.pdf$/i, ''))}: ${esc(scrubPages(i.note))}</li>`).join('');
    $('about-body').innerHTML = `
      <h3>Sources</h3>
      <p>Every figure comes from ${esc(CFG.entity.possessive)} published budget books. Each book reports several years side by side; this site picks <strong>one kind of figure per year</strong>:</p>
      <ul>
        <li><strong>${actualYears[0]}–${actualYears[actualYears.length - 1]}: Actual</strong>, the audited spending reported in the budget book published two years later.</li>
        ${projYears.length ? `<li><strong>${projYears.join(', ')}: Projected</strong>, the city's year-end estimate (the revised projection when present) from the next year's book. The actual for ${projYears.length > 1 ? 'these years is' : 'this year is'} not published yet.</li>` : ''}
        <li><strong>${D.newest_year}: Proposed and Revised</strong>, both from the ${D.newest_year} book, so you can compare what changed between them. Neither is an adopted budget.</li>
      </ul>
      <p>Adopted and amended budgets, year-to-date columns and an older book's own-year proposal are not shown.</p>
      ${D.reserve ? `<h3>Reserve Fund</h3>
      <p>The <strong>Reserve Fund</strong> entry in the Fund selector is the General Fund's balance, from the budget book's Fund Balance Projection page. Each book prints the actual balance at the end of the year two years earlier; that is the <strong>actual</strong> year-end balance for that year (unaudited for recent years). The newest book also prints a projected balance for the prior year and proposed and revised balances for the newest year. The same one-kind-per-year rule applies. Where a book prints two columns that disagree, the revised column is used and the difference is stated on the page.</p>` : ''}
      <p>Books in use:</p><ul>${books}</ul>
      <p>Years appear as soon as the books that report them have been processed.</p>
      <h3>Departments and bureaus</h3>
      <p>Departments and bureaus follow the city's <a href="${CFG.paths.pdfs}${encodeURIComponent(O.chart_doc)}" target="_blank" rel="noopener">2027 organizational chart</a>. Each budget line belongs to a bureau by its account number, so older years are grouped the same way even where the budget book printed them under another department or name (for example, Human Resources is shown under Executive in every year). Budget groups that are not a bureau, such as city-wide insurance, benefits and debt service or fee revenue, are shown as a separate “department-wide” group. Descriptions of what each department and bureau does are quoted from the city's <a href="${CFG.paths.pdfs}${encodeURIComponent(O.desc_doc)}" target="_blank" rel="noopener">2027 organization descriptions</a>.</p>
      <h3>Validation</h3>
      <p>Line items were extracted from the PDFs by script (scanned books were OCR'd first). Every total the book prints (each section, department, fund and staffing schedule) was recomputed from the extracted lines; differences of up to $5 are allowed for the city's rounding to whole dollars. Figures are shown as printed, never adjusted. Where overlapping books disagree on the same figure, the rule above decides and the disagreement is logged (${D.conflict_count} so far). Lines of $0 are left out.</p>
      <h3>Known problems in the source books</h3>
      <p>These come from errors in the city's documents, not the extraction. A person reviewed each one.</p>
      <details class="values"><summary>Show all ${D.known_issues.length} notes</summary><ul>${issues || '<li>None recorded.</li>'}</ul></details>
      <h3>Get the data</h3>
      <p><a href="${CFG.paths.data}budget.json">budget.json</a> (every figure shown here), <a href="${CFG.paths.data}staffing.json">staffing.json</a> (budgeted positions), <a href="${CFG.paths.data}conflicts.json">conflicts.json</a>. The extraction scripts and tables are in the project repository.</p>`;
    $('generated').textContent = `Data built ${D.generated.slice(0, 10)}.`;
  }

  /* Theme: follows the device until the visitor clicks the toggle; then an explicit choice is saved and set as
     data-theme on <html> (the CSS and the inline script in index.html's <head> use it). Storage may be blocked. */
  const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const currentTheme = () => document.documentElement.dataset.theme || (isDark() ? 'dark' : 'light');
  function applyTheme(redraw = true) {
    const t = currentTheme();
    document.querySelector('meta[name=color-scheme]')?.setAttribute('content', document.documentElement.dataset.theme || 'light dark');
    $('theme-toggle')?.setAttribute('aria-label', `Color theme: ${t}. Switch to ${t === 'dark' ? 'light' : 'dark'} theme.`);
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

  async function boot() {
    try {
      CFG = await (await fetch('config.json', { cache: 'no-cache' })).json();
      const res = await fetch(`${CFG.paths.data}budget.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D = await res.json();
      O = D.org;
    } catch (err) {
      $('view').innerHTML = `<header class="page-head"><h1>Could not load the budget data</h1><p class="muted">budget data: ${esc(err.message)}. If you opened index.html from disk, serve the folder over HTTP instead.</p></header>`;
      return;
    }
    loadTokens();
    if (window.Chart) { Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font').trim(); Chart.defaults.color = MUTED; }
    // Charts are drawn on canvas, so wait for the web font before the first draw (but never more than 1.5s).
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    // Light/dark follows the device; redraw the charts in the new colors when it changes.
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
    initThemeToggle();
    DEFAULT_FUND = D.funds.includes(CFG.default_fund) ? CFG.default_fund : '';
    document.title = CFG.site_title;
    $('wordmark').textContent = CFG.site_title;
    document.querySelector('meta[name=description]')?.setAttribute('content', CFG.description);
    $('footer-text').textContent = CFG.footer;
    if (CFG.tagline) $('tagline').textContent = CFG.tagline;
    wire();
    renderAbout();
    onRoute(false);
  }
  boot();
})();
