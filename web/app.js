/* Budget Explorer: plain JS, no build step. Entity name, title and data paths come from config.json;
 * brand and chart colors (light and dark) come from the CSS variables in styles.css. Data: <paths.data>budget.json (scripts/build_dataset.py).
 * Routes (hash-based, so GitHub Pages needs no server rules):
 *   #/                                        all departments
 *   #/department/<dept>                       one department
 *   #/department/<dept>/bureau/<fund--bureau> one bureau
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

  let D = null;
  const rowCache = new Map();
  let charts = [];
  const S = { y: 0, m: '', c: '', k: 'expense', f: '' };
  let route = { name: 'home' };
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
      return { code: a[0], name: a[1], fund: a[2], dept: a[3], bureau: a[4], cat: a[5], v: s.v[i], p: s.p[i], d: Array.isArray(s.doc) ? s.doc[i] : s.doc };
    });
    rowCache.set(k, out);
    return out;
  }
  const isRevenue = (r) => D.categories[r.cat] === 'Revenue';
  const bureauKey = (r) => `${r.fund}|${r.bureau}`;
  const orgOf = (r) => r.code.split('-')[0];
  const bureauSlug = (fund, bureau) => `${slug(D.funds[fund])}--${slug(D.bureaus[bureau])}`;

  function scoped(k, over = {}) {
    const kind = over.kind || S.k;
    const f = D.funds.indexOf(S.f);
    return rows(k).filter((r) =>
      (kind === 'revenue') === isRevenue(r) &&
      (over.orgs != null || f < 0 || r.fund === f) && // a bureau lives in one fund, so the fund filter is moot
      (over.dept == null || r.dept === over.dept) &&
      (over.orgs == null || over.orgs.has(orgOf(r))));
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
  const deptHash = (dept, over) => `#/department/${slug(D.departments[dept])}?${query(over)}`;
  const bureauHash = (dept, fund, bureau, over) => `#/department/${slug(D.departments[dept])}/bureau/${bureauSlug(fund, bureau)}?${query(over)}`;
  const homeHash = (over) => `#/?${query(over)}`;

  function navigate(hash, replace = false) {
    if (replace) { history.replaceState(null, '', hash); onRoute(false); } else { location.hash = hash; }
  }
  const currentHash = () => (route.name === 'home' ? homeHash : route.name === 'dept' ? (o) => deptHash(route.deptIdx, o) : (o) => bureauHash(route.deptIdx, route.fund, route.bureauIdx, o));

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
        <div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select></div>
      </div>
      ${ms.length > 1 ? `<div class="filters"><div class="field field-wide"><span class="field-label" id="lbl-m">Figure</span><div class="tabs" role="radiogroup" aria-label="m">${ms.map((m) => `<button type="button" role="radio" aria-checked="${m === S.m}" data-tab="m" data-v="${m}">${esc(LABEL[m])}</button>`).join('')}</div></div></div>` : ''}`;
  }

  function filtersHTML({ fund = true } = {}) {
    if (isReserve()) return reserveFiltersHTML();
    const k = key(S.y, S.m);
    const yrs = years().map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('');
    const opts = Object.keys(D.series).filter((x) => x !== k)
      .sort((a, b) => parseKey(b).y - parseKey(a).y || ORDER.indexOf(parseKey(a).m) - ORDER.indexOf(parseKey(b).m));
    const cmp = `<option value="none" ${!S.c ? 'selected' : ''}>No comparison</option>` + opts.map((x) => `<option value="${x}" ${x === S.c ? 'selected' : ''}>${esc(seriesLabel(x))}</option>`).join('');
    const present = new Set(rows(k).map((r) => r.fund));
    const funds = `<option value="">All funds</option>` + D.funds.map((f, i) => (present.has(i) || f === S.f ? `<option value="${esc(f)}" ${f === S.f ? 'selected' : ''}>${esc(f)}</option>` : '')).join('')
      + extraFundViews().map((f) => `<option value="${esc(f)}" ${f === S.f ? 'selected' : ''}>${esc(f)}</option>`).join('');
    const tabs = (name, items, cur) => `<div class="tabs" role="radiogroup" aria-label="${name}">${items.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-tab="${name}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
    return `<div class="filters">
        <div class="field"><label class="field-label" for="f-y">Fiscal year</label><select id="f-y" data-sel="y">${yrs}</select></div>
        <div class="field"><label class="field-label" for="f-c">Compare with</label><select id="f-c" data-sel="c">${cmp}</select></div>
        ${fund ? `<div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select></div>` : ''}
      </div>
      <div class="filters">
        ${measuresFor(S.y).length > 1 ? `<div class="field field-wide"><span class="field-label" id="lbl-m">Figure</span>${tabs('m', measuresFor(S.y).map((m) => [m, LABEL[m]]), S.m)}</div>` : ''}
        <div class="field field-wide"><span class="field-label" id="lbl-k">Show</span>${tabs('k', [['expense', 'Expenses'], ['revenue', 'Revenue']], S.k)}</div>
      </div>`;
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
      has('revised') && `<li><i class="dot" style="background:${PALETTE[1]}"></i>Revised</li>`,
    ].filter(Boolean).join('');
    const rowsHtml = pts.map((p) => `<tr><th scope="row">${p.y}</th><td>${LABEL[p.m]}</td><td class="num">${p.v == null ? '—' : money(p.v)}</td></tr>`).join('');
    return `<section class="panel" aria-labelledby="tr-t"><h2 class="panel-title" id="tr-t">${esc(title)}</h2>
      <p class="panel-note">${S.k === 'revenue' ? 'Revenue' : 'Expenses'}${S.f ? ' · ' + esc(S.f) : ''}. Each year shows one kind of figure: actual, projected or proposed.</p>
      <ul class="trend-legend" aria-hidden="true">${legend}</ul>
      <div class="chart-box short"><canvas id="trend-chart" role="img" aria-label="Totals by year, ${pts[0].y} to ${pts[pts.length - 1].y}. Solid line: actual. Dashed line: projected. Dots: proposed and revised. The table below has the values."></canvas></div>
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
    if (pts.some((p) => p.m === 'revised')) datasets.push(dot('revised', PALETTE[1]));
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
    if (!e) return `<header class="page-head"><h1 id="page-h" tabindex="-1">${esc(D.reserve.name)}</h1><p class="muted">No reserve figures for ${S.y}.</p></header>${reserveFiltersHTML()}`;
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
      ${reserveFiltersHTML()}
      <p class="hint" style="margin-top:0">The General Fund's reserve: the cash balance carried from year to year.</p>
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

  /* ---------- home ---------- */
  function homeView() {
    if (isReserve()) return reserveView();
    const k = key(S.y, S.m);
    const list = scoped(k);
    const total = sum(list);
    const kindWord = S.k === 'revenue' ? 'Revenue' : 'Expenses';
    const scope = S.f ? S.f : CFG.entity.short;
    document.title = `${scope} ${kindWord}: ${seriesLabel(k)} · ${CFG.site_title}`;

    const by = (l) => aggregate(l, (r) => r.dept, (r) => D.departments[r.dept]);
    const selMap = by(list), cmpMap = S.c ? by(scoped(S.c)) : new Map();
    const keys = new Set([...selMap.keys(), ...cmpMap.keys()]);
    const items = [...keys].map((d) => ({ dept: d, sel: selMap.get(d), cmp: cmpMap.get(d) }))
      .sort((a, b) => (b.sel?.total || 0) - (a.sel?.total || 0) || (b.cmp?.total || 0) - (a.cmp?.total || 0));
    const max = Math.max(1, ...items.flatMap((i) => [Math.abs(i.sel?.total || 0), Math.abs(i.cmp?.total || 0)]));
    const bar = (agg, cls, label, bk) => `<div><div class="bar-label ${cls}"><span>${esc(label)}</span><span>${agg ? src(money(agg.total), bk, agg.d, agg.p) : '<span class="missing">No figures</span>'}</span></div>
        <div class="track"><div class="fill ${cls}" style="width:${agg ? Math.max(0, (agg.total / max) * 100) : 0}%"></div></div></div>`;
    const cards = items.map((it) => {
      const sh = total > 0 && it.sel ? (it.sel.total / total) * 100 : null;
      const share = sh == null ? '' : `<span class="share">(${sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)}% of Total ${esc(seriesLabel(k))} ${kindWord === 'Revenue' ? 'Revenue' : 'Budget'})</span>`;
      const h = deptHash(it.dept);
      return `<li class="card" data-go="${esc(h)}"><div class="card-top"><h3><a href="${esc(h)}">${esc(D.departments[it.dept])}</a>${share}</h3>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></div>
        <div class="bars">${S.c ? bar(it.cmp, 'cmp', seriesLabel(S.c), S.c) : ''}${bar(it.sel, 'sel', seriesLabel(k), k)}</div></li>`;
    }).join('');

    return `<header class="page-head"><h1 id="page-h">${esc(scope)} ${kindWord}: ${esc(seriesLabel(k))}</h1>
        <p class="big-total" aria-live="polite">${(() => { const pf = S.f ? printedFund(S.f, S.k, k) : null; return pf ? src(money(total), k, pf.doc, pf.page) : money(total); })()}</p>${statusHTML()}${rollupNote(list)}</header>
      ${filtersHTML()}
      <ul class="cards" aria-label="Departments">${cards || '<li class="empty center">No lines for this selection.</li>'}</ul>
      <p class="hint">Select any department to see its detailed breakdown. Amounts open the source page in the budget book.</p>
      ${trendHTML({}, 'Totals by Year')}
      <section class="panel" aria-labelledby="re-title"><h2 class="panel-title" id="re-title">Revenue vs. Expenses by Fund: ${esc(seriesLabel(k))}</h2>
        <div class="chart-box"><canvas id="re-chart" role="img" aria-label="Revenue and expenses by fund"></canvas></div>
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
          { label: 'Revenue', data: data.map((d) => d.rev), backgroundColor: PALETTE[0], borderRadius: 2 },
          { label: 'Expenses', data: data.map((d) => d.exp), backgroundColor: PALETTE[1], borderRadius: 2 }] },
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
    $('re-table').innerHTML = `<thead><tr><th scope="col">Fund</th><th scope="col" class="num">Revenue</th><th scope="col" class="num">Expenses</th><th scope="col" class="num">Revenue minus expenses</th></tr></thead>
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

  function entityView({ title, subtitle, selRows, cmpRows, parentHash, parentLabel, bureauPie, deptPicker, scope }) {
    const k = key(S.y, S.m), kindWord = S.k === 'revenue' ? 'Revenue' : 'Budget';
    const total = sum(selRows), cmpTotal = sum(cmpRows);
    const fp = firstPage(selRows), cfp = firstPage(cmpRows);
    const totalLink = src(money(total), k, fp.d, fp.p), cmpLink = S.c ? src(money(cmpTotal), S.c, cfp.d, cfp.p) : '';
    const cats = categoryGroups(selRows, cmpRows);
    const withColor = (g, i) => ({ ...g, color: g.color || (i < PIE_SLICES ? PALETTE[i] : OTHER_COLOR) });

    let html = `<div class="dept-top"><a class="btn btn-primary" href="${esc(parentHash)}">← ${esc(parentLabel)}</a></div>`;
    if (deptPicker) html += `<div class="field dept-picker" style="margin-inline:auto"><label class="field-label" for="dept-pick">Department</label>${deptPicker}</div>`;
    html += `<header><h2 class="dept-name" id="page-h" tabindex="-1">${esc(title)}</h2>
      <p class="dept-total">Total ${kindWord}: ${totalLink}</p><p class="dept-sub">${subtitle}</p><p class="center">${statusHTML()}</p>${deptPicker ? rollupNote(selRows) : ''}</header>`;
    html += `<div class="dept-filters">${filtersHTML({ fund: !!deptPicker })}</div>`;

    html += pieSection(`${title} ${seriesLabel(k)} ${kindWord} Breakdown`, cats, { k });

    if (cats.length) {
      html += `<section class="panel" aria-labelledby="yoy-t"><h2 class="panel-title" id="yoy-t">${esc(title)} Total ${S.k === 'revenue' ? 'Revenue' : 'Budgeted Cost'}: ${S.c ? 'Comparison' : 'by Category'}</h2>
        <div class="chart-scroll"><div class="chart-box"><canvas id="yoy-chart" role="img" aria-label="${esc(title)} by category, ${esc(S.c ? seriesLabel(S.c) + ' compared with ' : '')}${esc(seriesLabel(k))}"></canvas></div></div></section>`;
    }
    html += trendHTML(scope, `${title}: Totals by Year`);
    if (bureauPie) html += bureauPie;

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

  function entityCharts(selRows, cmpRows, cats, bureauGroups) {
    const k = key(S.y, S.m), th = chartTheme();
    drawPie(`${$('page-h').textContent} ${seriesLabel(k)} ${S.k === 'revenue' ? 'Revenue' : 'Budget'} Breakdown`, cats);
    if (bureauGroups) drawPie(bureauGroups.title, bureauGroups.groups);
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
  function lineTable(selRows, cmpRows, showBureau) {
    const k = key(S.y, S.m);
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
    let list = [...map.values()];
    const q = T.q.trim().toLowerCase();
    if (q) list = list.filter((e) => `${e.code} ${e.name} ${D.bureaus[e.bureau]} ${D.funds[e.fund]} ${D.categories[e.cat]}`.toLowerCase().includes(q));
    const val = (e, s) => (e[s] ? e[s].v : 0);
    const sorters = { code: (e) => e.code, name: (e) => e.name.toLowerCase(), cat: (e) => D.categories[e.cat], sel: (e) => val(e, 'sel'), cmp: (e) => val(e, 'cmp'), chg: (e) => val(e, 'sel') - val(e, 'cmp') };
    const f = sorters[T.sort] || sorters.sel;
    list.sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * T.dir; });
    const th = (id, label, cls = '') => `<th scope="col" class="${cls}" aria-sort="${T.sort === id ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${id}">${label}</button></th>`;
    const body = list.slice(0, T.shown).map((e) => {
      const d = val(e, 'sel') - val(e, 'cmp');
      const where = showBureau ? `<span class="sub">${esc(D.bureaus[e.bureau])}</span>` : '';
      return `<tr><td class="code hide-sm">${esc(e.code)}</td><td>${esc(e.name)}${where}</td><td class="hide-sm">${esc(D.categories[e.cat])}</td>
        ${S.c ? `<td class="num">${e.cmp ? src(money(e.cmp.v), S.c, e.cmp.d, e.cmp.p) : '—'}</td>` : ''}<td class="num">${e.sel ? src(money(e.sel.v), k, e.sel.d, e.sel.p) : '—'}</td>
        ${S.c ? `<td class="num hide-sm"><span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d === 0 ? '—' : money(d)}</span></td>` : ''}</tr>`;
    }).join('');
    const ts = list.reduce((t, e) => t + val(e, 'sel'), 0), tc = list.reduce((t, e) => t + val(e, 'cmp'), 0);
    const left = list.length - T.shown;
    return `<div class="table-tools"><label class="sr-only" for="li-search">Search line items</label>
        <input type="search" id="li-search" placeholder="Search line items, account numbers…" value="${esc(T.q)}" autocomplete="off">
        <span class="count" aria-live="polite">${list.length.toLocaleString()} line item${list.length === 1 ? '' : 's'}</span></div>
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

  function deptPage() {
    const di = D.departments.findIndex((d) => slug(d) === route.dept);
    if (di < 0) return notFound('Department');
    route.deptIdx = di;
    const k = key(S.y, S.m), name = D.departments[di];
    const selRows = scoped(k, { dept: di }), cmpRows = S.c ? scoped(S.c, { dept: di }) : [];
    // If this department has nothing of the chosen kind, say so rather than showing zeros.
    const picker = `<select id="dept-pick" data-pick="dept">${D.departments.map((d, i) => `<option value="${esc(slug(d))}" ${i === di ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>`;
    const bureaus = aggregate(selRows, bureauKey, (r) => D.bureaus[r.bureau]);
    const funds = new Set(selRows.map((r) => r.fund));
    const subtitle = selRows.length
      ? `${bureaus.size} bureau${bureaus.size === 1 ? '' : 's'}${funds.size ? ' · ' + [...funds].map((f) => esc(D.funds[f])).join(', ') : ''} · ${selRows.length.toLocaleString()} line items`
      : `No ${S.k === 'revenue' ? 'revenue' : 'expense'} lines for this department in ${esc(seriesLabel(k))}.`;
    const groups = [...bureaus.values()].sort((a, b) => b.total - a.total).map((g, i) => ({
      label: g.label, total: g.total, color: i < PIE_SLICES ? PALETTE[i] : OTHER_COLOR,
      sub: [...g.funds].length ? D.funds[[...g.funds][0]] : '', href: bureauHash(di, g.sample.fund, g.sample.bureau),
    }));
    const multiFund = funds.size > 1;
    groups.forEach((g) => { if (!multiFund) g.sub = ''; });
    const bTitle = `${S.k === 'revenue' ? 'Revenue Source' : 'Bureau'} Breakdown`;
    const bureauPie = pieSection(bTitle, groups, { clickable: true, note: 'Select a bureau to see its line items.' });
    document.title = `${name} ${seriesLabel(k)} · ${CFG.site_title}`;
    const v = entityView({ title: name, subtitle, selRows, cmpRows, parentHash: homeHash(), parentLabel: 'All departments', bureauPie, deptPicker: picker, scope: { dept: di } });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats, { title: bTitle, groups }); mountLines(selRows, cmpRows, true); } };
  }

  function bureauPage() {
    const di = D.departments.findIndex((d) => slug(d) === route.dept);
    if (di < 0) return notFound('Department');
    route.deptIdx = di;
    // Bureau names change between books, so find it in any year, then match every year by org code.
    const k = key(S.y, S.m);
    let hit = null, hitKey = null;
    for (const kk of [k, S.c, ...Object.keys(D.series)]) {
      if (!kk) continue;
      hit = rows(kk).find((r) => r.dept === di && bureauSlug(r.fund, r.bureau) === route.bureau);
      if (hit) { hitKey = kk; break; }
    }
    if (!hit) return notFound('Bureau');
    route.fund = hit.fund; route.bureauIdx = hit.bureau;
    const orgs = new Set(rows(hitKey).filter((r) => r.dept === di && r.fund === hit.fund && r.bureau === hit.bureau).map(orgOf));
    const name = D.bureaus[hit.bureau];
    const selRows = scoped(k, { dept: di, orgs }), cmpRows = S.c ? scoped(S.c, { dept: di, orgs }) : [];
    const scope = { dept: di, orgs };
    document.title = `${name} ${seriesLabel(k)} · ${CFG.site_title}`;
    const sub = `${esc(D.departments[di])} · ${esc(D.funds[hit.fund])} · ${selRows.length.toLocaleString()} line items`;
    const v = entityView({ title: name, subtitle: sub, selRows, cmpRows, parentHash: deptHash(di), parentLabel: D.departments[di], scope });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats, null); mountLines(selRows, cmpRows, false); } };
  }

  /* ---------- render / events ---------- */
  function onRoute(scroll = true) {
    if (!D) return;
    const { r, q } = parseHash();
    route = r;
    if (q.get('c') === 'none') { applyQuery(q); S.c = ''; } else applyQuery(q);
    if (route.name !== 'home' && isReserve()) S.f = DEFAULT_FUND; // the reserve has no departments or bureaus
    T.sort = 'sel'; T.dir = -1; T.q = ''; T.shown = PAGE_SIZE;
    destroyCharts();
    let page;
    if (route.name === 'home') page = { html: homeView(), after: () => { if (isReserve()) drawReserve(); else { drawTrend(); revExpAfter(); } } };
    else if (route.name === 'dept') page = deptPage();
    else page = bureauPage();
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
      const tab = e.target.closest('[data-tab]');
      if (tab) { onFilter(tab.dataset.tab, tab.dataset.v); return; }
      const card = e.target.closest('[data-go]');
      if (card && !e.target.closest('a')) navigate(card.dataset.go);
    });
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
