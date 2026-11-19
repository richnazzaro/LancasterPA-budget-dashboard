/* Lancaster Budget Explorer: plain JS, no build step. Data: data/budget.json (scripts/build_dataset.py).
 * Routes (hash-based, so GitHub Pages needs no server rules):
 *   #/                                        all departments
 *   #/department/<dept>                       one department
 *   #/department/<dept>/bureau/<fund--bureau> one bureau
 * Shared query: y=year m=measure c=compare k=revenue f=fund
 */
(() => {
  'use strict';

  const LABEL = { proposed: 'Proposed', revised: 'Revised Proposed', adopted: 'Adopted', amended: 'Amended', projected: 'Projected', actual: 'Actual' };
  const ORDER = ['adopted', 'amended', 'projected', 'actual', 'proposed', 'revised'];
  const STATUS = {
    proposed: 'Proposed, not adopted', revised: 'Revised proposal, not adopted', adopted: 'Adopted budget',
    amended: 'Amended budget', projected: 'Projected year-end estimate', actual: 'Actual spending',
  };
  const CAT_ORDER = ['Salaries & Wages', 'Benefits', 'Operating', 'Equipment & Capital', 'Debt, Transfers & Allocations', 'Revenue', 'Uncoded'];
  const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#0ca30c', '#e66767'];
  const OTHER_COLOR = '#777';
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

  /* ---------- data access ---------- */
  function rows(k) {
    if (!k || !series(k)) return [];
    if (rowCache.has(k)) return rowCache.get(k);
    const s = series(k);
    const out = s.a.map((acct, i) => {
      const a = D.accounts[acct];
      return { code: a[0], name: a[1], fund: a[2], dept: a[3], bureau: a[4], cat: a[5], v: s.v[i] };
    });
    rowCache.set(k, out);
    return out;
  }
  const isRevenue = (r) => D.categories[r.cat] === 'Revenue';
  const bureauKey = (r) => `${r.fund}|${r.bureau}`;
  const bureauSlug = (fund, bureau) => `${slug(D.funds[fund])}--${slug(D.bureaus[bureau])}`;

  function scoped(k, over = {}) {
    const kind = over.kind || S.k;
    const f = D.funds.indexOf(S.f);
    return rows(k).filter((r) =>
      (kind === 'revenue') === isRevenue(r) &&
      (over.bureau != null || f < 0 || r.fund === f) && // a bureau lives in one fund, so the fund filter is moot
      (over.dept == null || r.dept === over.dept) &&
      (over.bureau == null || bureauKey(r) === over.bureau));
  }
  function aggregate(list, keyFn, labelFn) {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r);
      let g = m.get(k);
      if (!g) { g = { key: k, label: labelFn(r), total: 0, funds: new Set(), sample: r }; m.set(k, g); }
      g.total += r.v; g.funds.add(r.fund);
    }
    return m;
  }
  const catRank = (i) => { const n = CAT_ORDER.indexOf(D.categories[i]); return n < 0 ? 99 : n; };
  const catColor = (i) => PALETTE[catRank(i) % PALETTE.length];

  const years = () => [...new Set(Object.values(D.series).map((s) => s.year))].sort((a, b) => b - a);
  const measuresFor = (y) => ORDER.filter((m) => series(key(y, m)));
  const defaultMeasure = (y) => { const ms = measuresFor(y); return ms.includes('revised') ? 'revised' : ms.includes('proposed') ? 'proposed' : ms.includes('adopted') ? 'adopted' : ms[0]; };
  function defaultCompare(y, m) {
    return [key(y - 1, m), key(y - 1, 'adopted'), key(y - 1, 'actual')].find((k) => series(k)) || '';
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
    S.f = D.funds.includes(q.get('f')) ? q.get('f') : '';
  }
  function query(over = {}) {
    const s = { ...S, ...over };
    const q = new URLSearchParams();
    q.set('y', s.y); q.set('m', s.m);
    if (s.c !== defaultCompare(s.y, s.m)) q.set('c', s.c ? s.c.replace('|', '-') : 'none');
    if (s.k !== 'expense') q.set('k', s.k);
    if (s.f) q.set('f', s.f);
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

  function filtersHTML({ fund = true } = {}) {
    const k = key(S.y, S.m);
    const yrs = years().map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('');
    const opts = Object.keys(D.series).filter((x) => x !== k)
      .sort((a, b) => parseKey(b).y - parseKey(a).y || ORDER.indexOf(parseKey(a).m) - ORDER.indexOf(parseKey(b).m));
    const cmp = `<option value="none" ${!S.c ? 'selected' : ''}>No comparison</option>` + opts.map((x) => `<option value="${x}" ${x === S.c ? 'selected' : ''}>${esc(seriesLabel(x))}</option>`).join('');
    const present = new Set(rows(k).map((r) => r.fund));
    const funds = `<option value="">All funds</option>` + D.funds.map((f, i) => (present.has(i) || f === S.f ? `<option value="${esc(f)}" ${f === S.f ? 'selected' : ''}>${esc(f)}</option>` : '')).join('');
    const tabs = (name, items, cur) => `<div class="tabs" role="radiogroup" aria-label="${name}">${items.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-tab="${name}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
    return `<div class="filters">
        <div class="field"><label class="field-label" for="f-y">Fiscal year</label><select id="f-y" data-sel="y">${yrs}</select></div>
        <div class="field"><label class="field-label" for="f-c">Compare with</label><select id="f-c" data-sel="c">${cmp}</select></div>
        ${fund ? `<div class="field"><label class="field-label" for="f-f">Fund</label><select id="f-f" data-sel="f">${funds}</select></div>` : ''}
      </div>
      <div class="filters">
        <div class="field field-wide"><span class="field-label" id="lbl-m">Figure</span>${tabs('m', measuresFor(S.y).map((m) => [m, LABEL[m]]), S.m)}</div>
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
    tip: { backgroundColor: '#000', borderColor: '#262626', borderWidth: 1, titleColor: '#fff', bodyColor: '#fff', padding: 10 },
    tick: '#b3b3b3', grid: '#262626',
  });
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- home ---------- */
  function homeView() {
    const k = key(S.y, S.m);
    const list = scoped(k);
    const total = sum(list);
    const kindWord = S.k === 'revenue' ? 'Revenue' : 'Expenses';
    const scope = S.f ? S.f : 'City of Lancaster';
    document.title = `${scope} ${kindWord}: ${seriesLabel(k)} · Lancaster Budget Explorer`;

    const by = (l) => aggregate(l, (r) => r.dept, (r) => D.departments[r.dept]);
    const selMap = by(list), cmpMap = S.c ? by(scoped(S.c)) : new Map();
    const keys = new Set([...selMap.keys(), ...cmpMap.keys()]);
    const items = [...keys].map((d) => ({ dept: d, sel: selMap.get(d), cmp: cmpMap.get(d) }))
      .sort((a, b) => (b.sel?.total || 0) - (a.sel?.total || 0) || (b.cmp?.total || 0) - (a.cmp?.total || 0));
    const max = Math.max(1, ...items.flatMap((i) => [Math.abs(i.sel?.total || 0), Math.abs(i.cmp?.total || 0)]));
    const bar = (agg, cls, label) => `<div><div class="bar-label ${cls}"><span>${esc(label)}</span><span>${agg ? money(agg.total) : '<span class="missing">Not in this book</span>'}</span></div>
        <div class="track"><div class="fill ${cls}" style="width:${agg ? Math.max(0, (agg.total / max) * 100) : 0}%"></div></div></div>`;
    const cards = items.map((it) => {
      const sh = total > 0 && it.sel ? (it.sel.total / total) * 100 : null;
      const share = sh == null ? '' : `<span class="share">(${sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)}% of Total ${esc(seriesLabel(k))} ${kindWord === 'Revenue' ? 'Revenue' : 'Budget'})</span>`;
      const h = deptHash(it.dept);
      return `<li class="card" data-go="${esc(h)}"><div class="card-top"><h3><a href="${esc(h)}">${esc(D.departments[it.dept])}</a>${share}</h3>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></div>
        <div class="bars">${S.c ? bar(it.cmp, 'cmp', seriesLabel(S.c)) : ''}${bar(it.sel, 'sel', seriesLabel(k))}</div></li>`;
    }).join('');

    return `<header class="page-head"><h1 id="page-h">${esc(scope)} ${kindWord}: ${esc(seriesLabel(k))}</h1>
        <p class="big-total" aria-live="polite">${money(total)}</p>${statusHTML()}</header>
      ${filtersHTML()}
      <ul class="cards" aria-label="Departments">${cards || '<li class="empty center">No lines for this selection.</li>'}</ul>
      <p class="hint">Select any department to see its detailed breakdown.</p>
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
          plugins: { legend: { position: 'bottom', labels: { color: '#fff', boxWidth: 12, boxHeight: 12 } }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
          scales: { x: { ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid } }, y: { ticks: { color: '#fff' }, grid: { display: false } } },
        },
      }));
    }
    const dcell = (n) => `<span class="${n >= 0 ? 'up' : 'down'}">${money(n)}</span>`;
    $('re-table').innerHTML = `<thead><tr><th scope="col">Fund</th><th scope="col" class="num">Revenue</th><th scope="col" class="num">Expenses</th><th scope="col" class="num">Revenue minus expenses</th></tr></thead>
      <tbody>${data.map((d) => `<tr><th scope="row">${esc(d.fund)}</th><td class="num">${money(d.rev)}</td><td class="num">${money(d.exp)}</td><td class="num">${dcell(d.rev - d.exp)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>All funds</td><td class="num">${money(data.reduce((t, d) => t + d.rev, 0))}</td><td class="num">${money(data.reduce((t, d) => t + d.exp, 0))}</td><td class="num">${dcell(data.reduce((t, d) => t + d.rev - d.exp, 0))}</td></tr></tfoot>`;
  }

  /* ---------- department / bureau pages ---------- */
  function pieSection(title, groups, { clickable, note } = {}) {
    const total = groups.reduce((t, g) => t + Math.max(0, g.total), 0);
    if (!groups.length || total <= 0) return '';
    const items = groups.map((g) => {
      const body = `<span class="nm" title="${esc(g.label)}">${esc(g.label)}</span><span class="vl">${money(g.total)} (${((g.total / total) * 100).toFixed(1)}%)${g.sub ? ' · ' + esc(g.sub) : ''}</span>`;
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
      data: { labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.v), backgroundColor: data.map((d) => d.c), borderColor: '#0d0d0d', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.label}: ${money(c.raw)} (${((c.raw / total) * 100).toFixed(1)}%)` } } } },
    }));
  }

  function categoryGroups(selRows, cmpRows) {
    const by = (l) => aggregate(l, (r) => r.cat, (r) => D.categories[r.cat]);
    const s = by(selRows), c = by(cmpRows);
    return [...new Set([...s.keys(), ...c.keys()])].map((i) => ({ idx: i, label: D.categories[i], total: s.get(i)?.total || 0, cmpTotal: c.get(i)?.total || 0, color: catColor(i) }))
      .sort((a, b) => b.total - a.total || b.cmpTotal - a.cmpTotal);
  }

  function entityView({ title, subtitle, selRows, cmpRows, parentHash, parentLabel, bureauPie, deptPicker }) {
    const k = key(S.y, S.m), kindWord = S.k === 'revenue' ? 'Revenue' : 'Budget';
    const total = sum(selRows), cmpTotal = sum(cmpRows);
    const cats = categoryGroups(selRows, cmpRows);
    const withColor = (g, i) => ({ ...g, color: g.color || (i < PIE_SLICES ? PALETTE[i] : OTHER_COLOR) });

    let html = `<div class="dept-top"><a class="btn btn-primary" href="${esc(parentHash)}">← ${esc(parentLabel)}</a></div>`;
    if (deptPicker) html += `<div class="field dept-picker" style="margin-inline:auto"><label class="field-label" for="dept-pick">Department</label>${deptPicker}</div>`;
    html += `<header><h2 class="dept-name" id="page-h" tabindex="-1">${esc(title)}</h2>
      <p class="dept-total">Total ${kindWord}: ${money(total)}</p><p class="dept-sub">${subtitle}</p><p class="center">${statusHTML()}</p></header>`;
    html += `<div class="dept-filters">${filtersHTML({ fund: !!deptPicker })}</div>`;

    html += pieSection(`${title} ${seriesLabel(k)} ${kindWord} Breakdown`, cats);

    if (cats.length) {
      html += `<section class="panel" aria-labelledby="yoy-t"><h2 class="panel-title" id="yoy-t">${esc(title)} Total ${S.k === 'revenue' ? 'Revenue' : 'Budgeted Cost'}: ${S.c ? 'Comparison' : 'by Category'}</h2>
        <div class="chart-scroll"><div class="chart-box"><canvas id="yoy-chart" role="img" aria-label="${esc(title)} by category, ${esc(S.c ? seriesLabel(S.c) + ' compared with ' : '')}${esc(seriesLabel(k))}"></canvas></div></div></section>`;
    }
    if (bureauPie) html += bureauPie;

    html += `<div class="totals">${S.c ? `<section class="panel" aria-label="${esc(seriesLabel(S.c))} total"><h2 class="total-label">${esc(seriesLabel(S.c))} Total</h2><p class="total-value">${money(cmpTotal)}</p></section>` : ''}
      <section class="panel" aria-label="${esc(seriesLabel(k))} total"><h2 class="total-label">${esc(seriesLabel(k))} Total</h2><p class="total-value">${money(total)}</p></section></div>`;

    const chg = (a, b) => { const d = a - b, p = pctOf(d, b); return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${money(d)}${p == null ? '' : ` (${p.toFixed(1)}%)`}</span>`; };
    html += `<section class="panel" aria-labelledby="cat-t"><h2 class="total-label" id="cat-t">Budget Categories</h2><div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Category</th>${S.c ? `<th scope="col" class="num">${esc(seriesLabel(S.c))}</th>` : ''}<th scope="col" class="num">${esc(seriesLabel(k))}</th>${S.c ? '<th scope="col" class="num">Change</th>' : ''}</tr></thead>
      <tbody>${cats.map((g) => `<tr><td>${esc(g.label)}</td>${S.c ? `<td class="num">${money(g.cmpTotal)}</td>` : ''}<td class="num">${money(g.total)}</td>${S.c ? `<td class="num">${chg(g.total, g.cmpTotal)}</td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;

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
    const yoy = $('yoy-chart');
    if (yoy && window.Chart) {
      const ds = [];
      if (S.c) ds.push({ label: seriesLabel(S.c), data: cats.map((g) => g.cmpTotal), backgroundColor: '#ffca41', borderRadius: 2 });
      ds.push({ label: seriesLabel(k), data: cats.map((g) => g.total), backgroundColor: '#41ffca', borderRadius: 2 });
      charts.push(new Chart(yoy, { type: 'bar', data: { labels: cats.map((g) => g.label), datasets: ds },
        options: { responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { position: 'bottom', align: 'end', labels: { color: '#fff', boxWidth: 12, boxHeight: 12 } }, tooltip: { ...th.tip, callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
          scales: { x: { ticks: { color: '#fff', font: { size: 11 } }, grid: { color: th.grid } }, y: { ticks: { color: th.tick, font: { size: 11 }, callback: (n) => short(n) }, grid: { color: th.grid } } } } }));
    }
    const ov = $('ov-chart');
    if (ov && window.Chart) {
      charts.push(new Chart(ov, { type: 'bar', data: { labels: [seriesLabel(S.c), seriesLabel(k)], datasets: [{ data: [sum(cmpRows), sum(selRows)], backgroundColor: ['#ffca41', '#41ffca'], borderRadius: 2 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 300 },
          plugins: { legend: { display: false }, tooltip: { ...th.tip, callbacks: { label: (c) => money(c.raw) } } },
          scales: { x: { ticks: { color: th.tick, callback: (n) => short(n) }, grid: { color: th.grid }, beginAtZero: true }, y: { ticks: { color: '#fff' }, grid: { display: false } } } } }));
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
        ${S.c ? `<td class="num">${e.cmp ? money(e.cmp.v) : '—'}</td>` : ''}<td class="num">${e.sel ? money(e.sel.v) : '—'}</td>
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
    document.title = `${name} ${seriesLabel(k)} · Lancaster Budget Explorer`;
    const v = entityView({ title: name, subtitle, selRows, cmpRows, parentHash: homeHash(), parentLabel: 'All departments', bureauPie, deptPicker: picker });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats, { title: bTitle, groups }); mountLines(selRows, cmpRows, true); } };
  }

  function bureauPage() {
    const di = D.departments.findIndex((d) => slug(d) === route.dept);
    if (di < 0) return notFound('Department');
    route.deptIdx = di;
    const all = rows(key(S.y, S.m)).concat(S.c ? rows(S.c) : []);
    const hit = all.find((r) => r.dept === di && bureauSlug(r.fund, r.bureau) === route.bureau);
    if (!hit) return notFound('Bureau');
    route.fund = hit.fund; route.bureauIdx = hit.bureau;
    const k = key(S.y, S.m), bk = bureauKey(hit), name = D.bureaus[hit.bureau];
    const selRows = scoped(k, { dept: di, bureau: bk }), cmpRows = S.c ? scoped(S.c, { dept: di, bureau: bk }) : [];
    document.title = `${name} ${seriesLabel(k)} · Lancaster Budget Explorer`;
    const sub = `${esc(D.departments[di])} · ${esc(D.funds[hit.fund])} · ${selRows.length.toLocaleString()} line items`;
    const v = entityView({ title: name, subtitle: sub, selRows, cmpRows, parentHash: deptHash(di), parentLabel: D.departments[di] });
    return { ...v, after: () => { entityCharts(selRows, cmpRows, v.cats, null); mountLines(selRows, cmpRows, false); } };
  }

  /* ---------- render / events ---------- */
  function onRoute(scroll = true) {
    if (!D) return;
    const { r, q } = parseHash();
    route = r;
    if (q.get('c') === 'none') { applyQuery(q); S.c = ''; } else applyQuery(q);
    T.sort = 'sel'; T.dir = -1; T.q = ''; T.shown = PAGE_SIZE;
    destroyCharts();
    let page;
    if (route.name === 'home') page = { html: homeView(), after: revExpAfter };
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
    const figs = (b) => Object.values(D.series).filter((s) => s.year + D.rule[s.measure].book_offset === b.year && D.docs[Array.isArray(s.doc) ? s.doc[0] : s.doc] === b.doc)
      .sort((a, c) => a.year - c.year || ORDER.indexOf(a.measure) - ORDER.indexOf(c.measure)).map((s) => `${s.year} ${LABEL[s.measure].toLowerCase()}`);
    const books = used.map((b) => { const f = figs(b); return `<li>${esc(b.doc.replace(/\.pdf$/i, ''))} (${b.year} book): ${f.length ? 'supplies ' + f.join(', ') : 'no figures under the selection rule'}.</li>`; }).join('');
    const issues = D.known_issues.map((i) => `<li>${esc(i.source_doc.replace(/\.pdf$/i, ''))}: ${esc(scrubPages(i.note))}</li>`).join('');
    $('about-body').innerHTML = `
      <h3>Sources</h3>
      <p>Every figure comes from the City of Lancaster's published budget books. Each book reports several years side by side; this site picks one figure per account, year and measure:</p>
      <ul>
        <li><strong>Proposed</strong> and <strong>Revised Proposed</strong> appear only for the newest year (${D.newest_year}). Both columns come from the ${D.newest_year} book, so you can compare what changed between them. Neither is an adopted budget.</li>
        <li>For every other year, <strong>adopted</strong>, <strong>amended</strong> and <strong>projected</strong> (the revised projection when present) come from the <em>next</em> year's book, and <strong>actual</strong> comes from the book two years later.</li>
        <li>A book's own-year proposal is never shown for older years, and year-to-date columns are not shown.</li>
      </ul>
      <p>Books in use:</p><ul>${books}</ul>
      <p>Years appear as soon as the books that report them have been processed.</p>
      <h3>Validation</h3>
      <p>Line items were extracted from the PDFs by script (scanned books were OCR'd first). Every total the book prints (each section, department, fund and staffing schedule) was recomputed from the extracted lines; differences of up to $5 are allowed for the city's rounding to whole dollars. Figures are shown as printed, never adjusted. Where overlapping books disagree on the same figure, the rule above decides and the disagreement is logged (${D.conflict_count} so far). Lines of $0 are left out.</p>
      <h3>Known problems in the source books</h3>
      <p>These come from errors in the city's documents, not the extraction. A person reviewed each one.</p>
      <ul>${issues || '<li>None recorded.</li>'}</ul>
      <h3>Get the data</h3>
      <p><a href="data/budget.json">budget.json</a> (every figure shown here), <a href="data/staffing.json">staffing.json</a> (budgeted positions), <a href="data/conflicts.json">conflicts.json</a>. The extraction scripts and tables are in the project repository.</p>`;
    $('generated').textContent = `Data built ${D.generated.slice(0, 10)}.`;
  }

  async function boot() {
    try {
      const res = await fetch('data/budget.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D = await res.json();
    } catch (err) {
      $('view').innerHTML = `<header class="page-head"><h1>Could not load the budget data</h1><p class="muted">data/budget.json: ${esc(err.message)}. If you opened index.html from disk, serve the folder over HTTP instead.</p></header>`;
      return;
    }
    wire();
    renderAbout();
    onRoute(false);
  }
  boot();
})();
