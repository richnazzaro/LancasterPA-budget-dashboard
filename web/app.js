/* Lancaster Budget Explorer: plain JS, no build step. Data: data/budget.json (scripts/build_dataset.py). */
(() => {
  'use strict';

  const PDF_BASE = 'pdfs/'; // web/pdfs -> ../Budget PDFs - City (copied in by the Pages workflow)
  const LABEL = { proposed: 'Proposed', adopted: 'Adopted', amended: 'Amended', projected: 'Projected', actual: 'Actual' };
  const ORDER = ['adopted', 'amended', 'projected', 'actual', 'proposed'];
  const PAGE_SIZE = 50;

  let D = null;            // budget.json
  const rowCache = new Map();
  let chart = null;
  let catChart = null;
  const S = { y: 0, m: '', c: '', k: 'expense', f: '', d: '', b: '' };
  const tableState = { sort: 'sel', dir: -1, q: '', shown: PAGE_SIZE };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const short = (n) => {
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(0) + 'K';
    return sign + '$' + a;
  };
  const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const key = (y, m) => `${y}|${m}`;
  const parseKey = (k) => { const [y, m] = k.split('|'); return { y: +y, m }; };
  const series = (k) => D.series[k];
  const seriesLabel = (k) => { const { y, m } = parseKey(k); return `${y} ${LABEL[m].toLowerCase()}`; };
  const docName = (i) => D.docs[i];
  const bookYearOf = (k) => { const s = series(k); return s.year + D.rule[s.measure].book_offset; };

  function pdfHref(doc, page) {
    return PDF_BASE + encodeURIComponent(docName(doc)) + (page ? `#page=${page}` : '');
  }
  function pdfLink(doc, page, text, extra = '') {
    const title = `${docName(doc)}, page ${page}`;
    return `<a href="${pdfHref(doc, page)}" target="_blank" rel="noopener" title="${esc(title)}" ${extra}>${text}</a>`;
  }
  function srcLink(agg) {
    if (!agg || agg.doc == null) return '';
    const label = agg.printed ? `p.${agg.page}` : (agg.minP === agg.maxP ? `p.${agg.minP}` : `pp.${agg.minP}–${agg.maxP}`);
    const why = agg.printed ? 'printed total' : 'line items';
    return `<span class="src">${pdfLink(agg.doc, agg.page, esc(label), `aria-label="Source: ${esc(docName(agg.doc))}, page ${agg.page} (${why})"`)}</span>`;
  }

  /* ---------- data access ---------- */
  function rows(k) {
    if (!k || !series(k)) return [];
    if (rowCache.has(k)) return rowCache.get(k);
    const s = series(k);
    const out = s.a.map((acct, i) => {
      const a = D.accounts[acct];
      return {
        code: a[0], name: a[1], fund: a[2], dept: a[3], bureau: a[4], cat: a[5],
        v: s.v[i], p: s.p[i], doc: Array.isArray(s.doc) ? s.doc[i] : s.doc,
        col: Array.isArray(s.column) ? s.column[i] : s.column,
      };
    });
    rowCache.set(k, out);
    return out;
  }
  const isRevenue = (r) => D.categories[r.cat] === 'Revenue';
  const fundIdx = (name) => D.funds.indexOf(name);
  const deptIdx = (name) => D.departments.indexOf(name);
  const bureauKey = (r) => `${D.funds[r.fund]}::${D.bureaus[r.bureau]}`;

  function scoped(k, { ignoreFund = false, kind = S.k, depth = 3 } = {}) {
    const f = ignoreFund ? -1 : fundIdx(S.f);
    const d = depth >= 2 ? deptIdx(S.d) : -1;
    const b = depth >= 3 ? S.b : '';
    return rows(k).filter((r) =>
      (kind === 'revenue') === isRevenue(r) &&
      (f < 0 || r.fund === f) &&
      (d < 0 || r.dept === d) &&
      (!b || bureauKey(r) === b));
  }

  function aggregate(list, keyFn, labelFn) {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r);
      let g = m.get(k);
      if (!g) { g = { key: k, label: labelFn(r), total: 0, n: 0, minP: Infinity, maxP: 0, doc: r.doc, funds: new Set(), sample: r }; m.set(k, g); }
      g.total += r.v; g.n++;
      if (r.doc === g.doc) { g.minP = Math.min(g.minP, r.p); g.maxP = Math.max(g.maxP, r.p); }
      g.funds.add(r.fund);
    }
    for (const g of m.values()) g.page = g.minP;
    return m;
  }
  const sum = (list) => list.reduce((t, r) => t + r.v, 0);

  function printedFund(fund, kind, k) {
    return D.printed.find((p) => p.level === 'rollup' && p.fund === fund && p.kind === kind && k in p.values);
  }
  function printedSection(label, k, doc, minP, maxP) {
    const hits = D.printed.filter((p) => p.level === 'section' && p.label === label && p.doc === doc && k in p.values && p.page >= minP && p.page <= maxP + 3);
    hits.sort((a, b) => a.page - b.page);
    return hits[0];
  }
  function attachPrinted(g, printed, k) {
    if (!printed) return g;
    g.printed = printed.values[k];
    g.page = printed.page;
    g.doc = printed.doc;
    return g;
  }

  /* ---------- state & URL ---------- */
  const years = () => [...new Set(Object.values(D.series).map((s) => s.year))].sort((a, b) => b - a);
  const measuresFor = (y) => ORDER.filter((m) => series(key(y, m)));

  function defaultCompare(y, m) {
    const tries = [key(y - 1, m), key(y - 1, 'adopted'), key(y - 1, 'actual'), m !== 'adopted' ? key(y, 'adopted') : ''];
    return tries.find((k) => k && series(k)) || '';
  }

  function readURL() {
    const q = new URLSearchParams(location.search);
    const ys = years();
    S.y = ys.includes(+q.get('y')) ? +q.get('y') : D.newest_year;
    if (!ys.includes(S.y)) S.y = ys[0];
    const ms = measuresFor(S.y);
    S.m = ms.includes(q.get('m')) ? q.get('m') : (ms.includes('proposed') ? 'proposed' : ms.includes('adopted') ? 'adopted' : ms[0]);
    S.c = q.has('c') ? (series(q.get('c')) ? q.get('c') : '') : defaultCompare(S.y, S.m);
    if (S.c === key(S.y, S.m)) S.c = '';
    S.k = q.get('k') === 'revenue' ? 'revenue' : 'expense';
    S.f = D.funds.includes(q.get('f')) ? q.get('f') : '';
    S.d = D.departments.includes(q.get('d')) ? q.get('d') : '';
    S.b = S.d && q.get('b') ? q.get('b') : '';
    tableState.q = q.get('q') || '';
  }
  function writeURL(push) {
    const q = new URLSearchParams();
    q.set('y', S.y); q.set('m', S.m);
    if (S.c !== defaultCompare(S.y, S.m)) q.set('c', S.c);
    if (S.k !== 'expense') q.set('k', S.k);
    if (S.f) q.set('f', S.f);
    if (S.d) q.set('d', S.d);
    if (S.b) q.set('b', S.b);
    const url = `${location.pathname}?${q}${location.hash}`;
    if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  }
  function go(patch, push = true) {
    const before = { ...S };
    Object.assign(S, patch);
    if ('y' in patch || 'm' in patch) {
      const ms = measuresFor(S.y);
      if (!ms.includes(S.m)) S.m = ms.includes('adopted') ? 'adopted' : ms[0];
      if (!('c' in patch)) S.c = defaultCompare(S.y, S.m);
    }
    if (S.c === key(S.y, S.m)) S.c = '';
    if (before.d !== S.d || before.b !== S.b || before.f !== S.f || before.k !== S.k) { tableState.shown = PAGE_SIZE; }
    writeURL(push);
    render();
    if (push && (before.d !== S.d || before.b !== S.b || before.f !== S.f)) {
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      $('hero-title').focus({ preventScroll: true }); // announce the new view to screen readers
    }
  }

  /* ---------- controls ---------- */
  function renderControls() {
    $('year-select').innerHTML = years().map((y) => `<option value="${y}" ${y === S.y ? 'selected' : ''}>${y}</option>`).join('');
    $('measure-group').innerHTML = measuresFor(S.y).map((m) => {
      const col = series(key(S.y, m)).column;
      const note = typeof col === 'string' && col.endsWith('_revised') ? ' (revised)' : '';
      return `<button type="button" role="radio" aria-checked="${m === S.m}" data-m="${m}" title="${LABEL[m]}${note}">${LABEL[m]}</button>`;
    }).join('');
    $('kind-group').innerHTML = [['expense', 'Expenses'], ['revenue', 'Revenue']].map(([k, l]) =>
      `<button type="button" role="radio" aria-checked="${k === S.k}" data-k="${k}">${l}</button>`).join('');
    const fundsHere = new Set(rows(key(S.y, S.m)).map((r) => r.fund));
    $('fund-select').innerHTML = `<option value="">All funds</option>` + D.funds
      .map((f, i) => fundsHere.has(i) || f === S.f ? `<option value="${esc(f)}" ${f === S.f ? 'selected' : ''}>${esc(f)}</option>` : '').join('');
    const opts = Object.keys(D.series).filter((k) => k !== key(S.y, S.m))
      .sort((a, b) => parseKey(b).y - parseKey(a).y || ORDER.indexOf(parseKey(a).m) - ORDER.indexOf(parseKey(b).m));
    $('compare-select').innerHTML = `<option value="">Nothing</option>` +
      opts.map((k) => `<option value="${k}" ${k === S.c ? 'selected' : ''}>${esc(seriesLabel(k))}</option>`).join('');
  }

  function wireControls() {
    $('year-select').addEventListener('change', (e) => go({ y: +e.target.value }));
    $('fund-select').addEventListener('change', (e) => go({ f: e.target.value, d: '', b: '' }));
    $('compare-select').addEventListener('change', (e) => go({ c: e.target.value }));
    const radio = (groupId, attr, apply) => {
      const g = $(groupId);
      g.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) apply(b.dataset[attr]); });
      g.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        const btns = [...g.querySelectorAll('button')];
        const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
        const n = btns[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
        e.preventDefault(); apply(n.dataset[attr]);
        requestAnimationFrame(() => g.querySelector(`[data-${attr}="${n.dataset[attr]}"]`)?.focus());
      });
    };
    radio('measure-group', 'm', (m) => go({ m }));
    radio('kind-group', 'k', (k) => go({ k, d: '', b: '' }));
    $('theme-toggle').addEventListener('click', () => {
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      const next = dark ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
      renderCatChart();
      renderRevExp();
    });
    window.addEventListener('popstate', () => { readURL(); render(); });
    document.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (!nav) return;
      const a = e.target.closest('a');
      if (a && !a.hasAttribute('data-nav')) return; // source links open the PDF instead
      e.preventDefault();
      go(JSON.parse(nav.dataset.nav));
    });
  }

  /* ---------- hero / badge ---------- */
  function badge() {
    const k = key(S.y, S.m), s = series(k), book = bookYearOf(k);
    const col = typeof s.column === 'string' ? s.column : '';
    const el = $('status-badge');
    const kindWord = S.k === 'revenue' ? 'revenue' : 'spending';
    const text = {
      proposed: [`${S.y}: Proposed, not adopted${col.endsWith('_revised') ? ' (revised proposal)' : ''}`, 'warn'],
      adopted: [`${S.y}: Adopted budget · from the ${book} book`, 'ok'],
      amended: [`${S.y}: Amended budget (mid-year changes) · from the ${book} book`, ''],
      projected: [`${S.y}: Projected year-end estimate${col.endsWith('_revised') ? ' (revised)' : ''} · from the ${book} book`, ''],
      actual: [`${S.y}: Actual ${kindWord} · reported in the ${book} book`, 'ok'],
    }[S.m];
    el.textContent = text[0];
    el.className = 'badge ' + text[1];
  }

  function scopeName() {
    if (S.b) return S.b.split('::')[1];
    if (S.d) return S.d + (S.f ? ` (${S.f})` : '');
    return S.f || 'City of Lancaster';
  }

  function renderHero() {
    const k = key(S.y, S.m);
    const list = scoped(k);
    const total = sum(list);
    const kindWord = S.k === 'revenue' ? 'revenue' : 'expenses';
    $('hero-eyebrow').textContent = S.f || S.d ? 'City of Lancaster, PA' : 'All funds';
    const scope = /(expense|revenue|fees|income)$/i.test(scopeName()) ? scopeName() : `${scopeName()} ${kindWord}`;
    $('hero-title').textContent = `${scope}: ${S.y} ${LABEL[S.m].toLowerCase()}`;
    document.title = `${scope} ${S.y} · Lancaster Budget Explorer`;

    let link = '', note = '';
    const g = aggregate(list, () => 'all', () => '').get('all');
    if (g) {
      let printed = null;
      if (S.b) printed = printedSection(S.b.split('::')[1], k, g.doc, g.minP, g.maxP);
      else if (S.f && !S.d) printed = printedFund(S.f, S.k, k);
      if (printed) {
        attachPrinted(g, printed, k);
        const diff = total - g.printed;
        note = Math.abs(diff) < 0.5 ? `Matches the printed total on page ${g.page}.`
          : Math.abs(diff) <= 5
            ? `Sum of line items. The book prints ${money(g.printed)} on page ${g.page}; the ${money(Math.abs(diff))} gap is the city's rounding.`
            : `Sum of line items. The book prints ${money(g.printed)} on page ${g.page}; the lines add up to ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than that total.`;
      } else if (!S.f && !S.d) {
        note = 'Sum of every fund below; each fund total links to the page where the city prints it.';
      } else {
        note = `Sum of ${g.n} line items, ${g.minP === g.maxP ? `page ${g.minP}` : `pages ${g.minP}–${g.maxP}`} of the ${bookYearOf(k)} book.`;
      }
      link = pdfLink(g.doc, g.page, money(total), `aria-label="${money(total)}, source page ${g.page}"`);
    }
    $('hero-total').innerHTML = g ? link : '<span class="empty">No figures</span>';

    let cmp = '';
    if (S.c) {
      const ct = sum(scoped(S.c));
      const p = pct(total, ct);
      cmp = `${money(ct)} in ${seriesLabel(S.c)}` + (p == null ? '' : ` · ${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`);
    }
    $('hero-sub').innerHTML = [note, cmp && `Compared with ${esc(cmp)}.`].filter(Boolean).join(' ');
    badge();
  }

  function renderCrumbs() {
    const up = S.b ? { b: '' } : { d: '', b: '' };
    const back = S.d ? `<button type="button" class="back-btn" data-nav='${esc(JSON.stringify(up))}'>← Back</button>` : '';
    const parts = [`<a href="#" data-nav='{"d":"","b":""}'>${esc(S.f || 'All funds')}</a>`];
    if (S.d) parts.push(S.b ? `<a href="#" data-nav='${esc(JSON.stringify({ b: '' }))}'>${esc(S.d)}</a>` : `<span aria-current="page">${esc(S.d)}</span>`);
    if (S.b) parts.push(`<span aria-current="page">${esc(S.b.split('::')[1])}</span>`);
    $('crumbs').innerHTML = back + parts.join('<span aria-hidden="true">›</span>');
  }

  /* ---------- bar cards ---------- */
  function legendHTML() {
    const sel = `<span><i class="swatch" style="background:var(--sel)"></i>${esc(seriesLabel(key(S.y, S.m)))}</span>`;
    const cmp = S.c ? `<span><i class="swatch" style="background:var(--cmp)"></i>${esc(seriesLabel(S.c))}</span>` : '';
    return `<div class="legend" aria-hidden="true">${sel}${cmp}</div>`;
  }

  /** items: [{key,label,sel(agg|undefined),cmp(agg|undefined),nav,meta,missingSel,missingCmp}] */
  function cardsHTML(items, total, { limit = 0 } = {}) {
    if (!items.length) return `<p class="empty">No ${S.k === 'revenue' ? 'revenue' : 'expense'} lines here for ${esc(seriesLabel(key(S.y, S.m)))}.</p>`;
    const max = Math.max(1, ...items.flatMap((i) => [i.sel?.total || 0, i.cmp?.total || 0]));
    const selYear = String(S.y), cmpLabel = S.c ? parseKey(S.c).y + (parseKey(S.c).y === S.y ? ' ' + LABEL[parseKey(S.c).m].slice(0, 4) + '.' : '') : '';
    const li = items.map((it, idx) => {
      const sh = total && it.sel ? (it.sel.total / total) * 100 : null;
      const share = sh == null ? '' : ` <span class="card-share">${sh > 0 && sh < 0.1 ? '<0.1' : sh.toFixed(1)}% of total</span>`;
      const title = it.nav
        ? `<button type="button" data-nav='${esc(JSON.stringify(it.nav))}'>${esc(it.label)}<span class="chev" aria-hidden="true">›</span></button>`
        : esc(it.label);
      const p = it.sel && it.cmp ? pct(it.sel.total, it.cmp.total) : null;
      const delta = p == null ? '' : `<span class="delta ${Math.abs(p) < 0.05 ? 'flat' : p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : p < 0 ? '▼' : '■'} ${Math.abs(p).toFixed(1)}%<span class="sr-only"> ${p >= 0 ? 'increase' : 'decrease'} from ${esc(seriesLabel(S.c))}</span></span>`;
      const bar = (agg, cls, label, missing) => {
        const v = agg ? agg.total : 0;
        const w = Math.max(0, (v / max) * 100);
        const value = agg ? `${pdfLink(agg.doc, agg.page, money(v))}${srcLink(agg)}` : `<span class="empty">${missing || '$0'}</span>`;
        return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill ${cls}" style="width:${w}%"></div></div><span class="bar-value ${cls}">${value}</span></div>`;
      };
      return `<li class="card ${it.nav ? 'clickable' : ''}" ${it.nav ? `data-nav='${esc(JSON.stringify(it.nav))}'` : ''} ${limit && idx >= limit ? 'hidden' : ''}>
        <div class="card-head"><h3 class="card-title">${title}${share}</h3>${delta}</div>
        ${it.meta ? `<div class="card-meta">${it.meta}</div>` : ''}
        ${S.c ? bar(it.cmp, 'cmp', cmpLabel, it.missingCmp) : ''}
        ${bar(it.sel, '', selYear, it.missingSel)}
      </li>`;
    }).join('');
    const more = limit && items.length > limit ? `<button type="button" class="more-btn" data-more>Show all ${items.length}</button>` : '';
    return `${legendHTML()}<ul class="cards">${li}</ul>${more}`;
  }

  function mergeAggs(selMap, cmpMap) {
    const keys = new Set([...selMap.keys(), ...cmpMap.keys()]);
    return [...keys].map((k) => {
      const s = selMap.get(k), c = cmpMap.get(k);
      return { key: k, label: (s || c).label, sel: s, cmp: c };
    }).sort((a, b) => (b.sel?.total || 0) - (a.sel?.total || 0) || (b.cmp?.total || 0) - (a.cmp?.total || 0));
  }

  function fundCards() {
    const k = key(S.y, S.m);
    const byFund = (list) => aggregate(list, (r) => r.fund, (r) => D.funds[r.fund]);
    const items = mergeAggs(byFund(scoped(k)), S.c ? byFund(scoped(S.c)) : new Map());
    const covSel = new Set(series(k).funds), covCmp = S.c ? new Set(series(S.c).funds) : null;
    for (const it of items) {
      const fname = it.label;
      if (it.sel) attachPrinted(it.sel, printedFund(fname, S.k, k), k);
      if (it.cmp) attachPrinted(it.cmp, printedFund(fname, S.k, S.c), S.c);
      it.nav = { f: fname, d: '', b: '' };
      const fi = fundIdx(fname);
      if (!covSel.has(fi)) it.missingSel = `Not in the ${bookYearOf(k)} book`;
      if (covCmp && !covCmp.has(fi)) it.missingCmp = `Not in the ${bookYearOf(S.c)} book`;
      const notes = [];
      for (const [agg, kk] of [[it.sel, k], [it.cmp, S.c]]) {
        if (agg && agg.printed != null && Math.abs(agg.total - agg.printed) > 5) { // ≤$5 is the city's whole-dollar rounding
          notes.push(`${esc(seriesLabel(kk))}: book prints ${money(agg.printed)} (lines sum ${money(agg.total)})`);
        }
      }
      if (notes.length) it.meta = notes.join(' · ');
    }
    return cardsHTML(items, sum(scoped(k)));
  }

  function deptCards() {
    const k = key(S.y, S.m);
    const by = (list) => aggregate(list, (r) => r.dept, (r) => D.departments[r.dept]);
    const items = mergeAggs(by(scoped(k, { depth: 1 })), S.c ? by(scoped(S.c, { depth: 1 })) : new Map());
    for (const it of items) {
      it.nav = { d: it.label, b: '' };
      const fs = new Set([...(it.sel?.funds || []), ...(it.cmp?.funds || [])]);
      if (!S.f && fs.size > 1) it.meta = `${fs.size} funds`;
    }
    return cardsHTML(items, sum(scoped(k, { depth: 1 })), { limit: 12 });
  }

  function bureauCards() {
    const k = key(S.y, S.m);
    const by = (list) => aggregate(list, bureauKey, (r) => D.bureaus[r.bureau]);
    const items = mergeAggs(by(scoped(k, { depth: 2 })), S.c ? by(scoped(S.c, { depth: 2 })) : new Map());
    const multiFund = new Set(items.map((i) => i.key.split('::')[0])).size > 1;
    for (const it of items) {
      if (it.sel) attachPrinted(it.sel, printedSection(it.label, k, it.sel.doc, it.sel.minP, it.sel.maxP), k);
      if (it.cmp) attachPrinted(it.cmp, printedSection(it.label, S.c, it.cmp.doc, it.cmp.minP, it.cmp.maxP), S.c);
      it.nav = { b: it.key };
      if (multiFund) it.meta = esc(it.key.split('::')[0]);
    }
    return cardsHTML(items, sum(scoped(k, { depth: 2 })));
  }

  /* Category breakdown donut. Color follows the category (its index), never its rank. */
  const catColor = (i) => `var(--c${(i % 8) + 1})`;
  function categoryDonutHTML() {
    const k = key(S.y, S.m);
    const groups = [...aggregate(scoped(k), (r) => r.cat, (r) => D.categories[r.cat]).values()].sort((a, b) => b.total - a.total);
    const total = groups.reduce((t, g) => t + g.total, 0);
    if (!groups.length || total <= 0) return '';
    const legend = groups.map((g) => `<li><i class="swatch" style="background:${catColor(g.key)}"></i><span class="dl-name">${esc(g.label)}</span><span class="dl-val">${pdfLink(g.doc, g.page, money(g.total))} <span class="card-share">${((g.total / total) * 100).toFixed(1)}%</span></span></li>`).join('');
    return `<div class="donut-wrap"><div class="donut-box"><canvas id="cat-chart" role="img" aria-label="${esc(seriesLabel(k))} by category: ${esc(groups.map((g) => `${g.label} ${money(g.total)}`).join(', '))}"></canvas></div><ul class="donut-legend">${legend}</ul></div>`;
  }
  function renderCatChart() {
    if (catChart) { catChart.destroy(); catChart = null; }
    const cv = $('cat-chart');
    if (!cv || !window.Chart) return;
    const groups = [...aggregate(scoped(key(S.y, S.m)), (r) => r.cat, (r) => D.categories[r.cat]).values()].sort((a, b) => b.total - a.total);
    const css = getComputedStyle(document.documentElement);
    const col = (i) => css.getPropertyValue(`--c${(i % 8) + 1}`).trim();
    catChart = new Chart(cv, {
      type: 'doughnut',
      data: { labels: groups.map((g) => g.label), datasets: [{ data: groups.map((g) => Math.max(0, g.total)), backgroundColor: groups.map((g) => col(g.key)), borderColor: css.getPropertyValue('--surface').trim(), borderWidth: 2 }] },
      options: {
        cutout: '58%', responsive: true, maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.raw)}` } } },
      },
    });
  }

  function categoryCards() {
    const k = key(S.y, S.m);
    const by = (list) => aggregate(list, (r) => r.cat, (r) => D.categories[r.cat]);
    return cardsHTML(mergeAggs(by(scoped(k)), S.c ? by(scoped(S.c)) : new Map()), sum(scoped(k)));
  }

  /* ---------- line-item table ---------- */
  function tableHTML(depth) {
    const k = key(S.y, S.m);
    const selRows = scoped(k, { depth }), cmpRows = S.c ? scoped(S.c, { depth }) : [];
    const byCode = new Map();
    const seen = { sel: new Map(), cmp: new Map() };
    const put = (r, slot) => {
      // The same account code can be printed on two lines; pair them by occurrence.
      const base = `${r.code}::${r.fund}`;
      const nth = seen[slot].get(base) || 0;
      seen[slot].set(base, nth + 1);
      const id = `${base}::${nth}`;
      let e = byCode.get(id);
      if (!e) { e = { code: r.code, name: r.name, fund: r.fund, bureau: r.bureau, cat: r.cat }; byCode.set(id, e); }
      if (slot === 'sel') { e.name = r.name; e.bureau = r.bureau; e.cat = r.cat; }
      e[slot] = r;
    };
    cmpRows.forEach((r) => put(r, 'cmp'));
    selRows.forEach((r) => put(r, 'sel'));
    let list = [...byCode.values()];
    const q = tableState.q.trim().toLowerCase();
    if (q) list = list.filter((e) => `${e.code} ${e.name} ${D.bureaus[e.bureau]} ${D.funds[e.fund]} ${D.categories[e.cat]}`.toLowerCase().includes(q));
    const val = (e, s) => (e[s] ? e[s].v : 0);
    const sorters = {
      code: (e) => e.code, name: (e) => e.name.toLowerCase(), cat: (e) => D.categories[e.cat],
      sel: (e) => val(e, 'sel'), cmp: (e) => val(e, 'cmp'), chg: (e) => val(e, 'sel') - val(e, 'cmp'),
    };
    const f = sorters[tableState.sort] || sorters.sel;
    list.sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * tableState.dir; });

    const showWhere = depth < 3;
    const th = (id, label, cls = '') => {
      const sort = tableState.sort === id ? (tableState.dir > 0 ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" class="${cls}" aria-sort="${sort}"><button type="button" data-sort="${id}">${label}</button></th>`;
    };
    const cell = (r) => (r ? `${pdfLink(r.doc, r.p, money(r.v))}<span class="src">p.${r.p}</span>` : '<span class="empty">—</span>');
    const body = list.slice(0, tableState.shown).map((e) => {
      const d = S.c ? val(e, 'sel') - val(e, 'cmp') : null;
      const where = showWhere ? `<span class="sub">${esc(D.bureaus[e.bureau])}${S.f ? '' : ' · ' + esc(D.funds[e.fund])}</span>` : '';
      return `<tr><td class="code hide-sm">${esc(e.code)}</td><td>${esc(e.name)}<span class="sub code-sm">${esc(e.code)}</span>${where}</td><td class="hide-sm">${esc(D.categories[e.cat])}</td>
        ${S.c ? `<td class="num">${cell(e.cmp)}</td>` : ''}<td class="num">${cell(e.sel)}</td>
        ${S.c ? `<td class="num hide-sm"><span class="delta ${d === 0 ? 'flat' : d > 0 ? 'up' : 'down'}">${d === 0 ? '—' : (d > 0 ? '+' : '−') + money(Math.abs(d)).slice(1)}</span></td>` : ''}</tr>`;
    }).join('');
    const totSel = list.reduce((t, e) => t + val(e, 'sel'), 0), totCmp = list.reduce((t, e) => t + val(e, 'cmp'), 0);
    const more = list.length > tableState.shown ? `<button type="button" class="more-btn" data-more-rows>Show ${Math.min(PAGE_SIZE, list.length - tableState.shown)} more of ${list.length - tableState.shown}</button>` : '';
    return `
      <div class="table-tools">
        <label class="sr-only" for="line-search">Search line items</label>
        <input type="search" id="line-search" placeholder="Search by name, account, bureau…" value="${esc(tableState.q)}" autocomplete="off">
        <span class="table-count" aria-live="polite">${list.length.toLocaleString()} line item${list.length === 1 ? '' : 's'}</span>
      </div>
      <p class="panel-note">Each amount links to its page in the budget book. Lines that are $0 in both columns are omitted.</p>
      <div class="table-scroll"><table class="data-table">
        <thead><tr>${th('code', 'Account', 'hide-sm')}${th('name', 'Line item')}${th('cat', 'Category', 'hide-sm')}
          ${S.c ? th('cmp', esc(seriesLabel(S.c)), 'num') : ''}${th('sel', esc(seriesLabel(k)), 'num')}${S.c ? th('chg', 'Change', 'num hide-sm') : ''}</tr></thead>
        <tbody>${body || `<tr><td colspan="6" class="empty">No matching line items.</td></tr>`}</tbody>
        <tfoot><tr><td class="hide-sm"></td><td>Total${q ? ' (matching)' : ''}</td><td class="hide-sm"></td>${S.c ? `<td class="num">${money(totCmp)}</td>` : ''}<td class="num">${money(totSel)}</td>${S.c ? `<td class="num hide-sm">${(totSel - totCmp >= 0 ? '+' : '−') + money(Math.abs(totSel - totCmp)).slice(1)}</td>` : ''}</tr></tfoot>
      </table></div>${more}`;
  }

  function wireTable(container, depth) {
    const rerender = (keepFocus) => {
      const holder = container.querySelector('[data-table]');
      holder.innerHTML = tableHTML(depth);
      wireTable(container, depth);
      if (keepFocus) { const s = holder.querySelector('#line-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    };
    const holder = container.querySelector('[data-table]');
    if (!holder) return;
    holder.querySelector('#line-search').addEventListener('input', (e) => { tableState.q = e.target.value; tableState.shown = PAGE_SIZE; rerender(true); });
    holder.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.sort;
      tableState.dir = tableState.sort === id ? -tableState.dir : (['code', 'name', 'cat'].includes(id) ? 1 : -1);
      tableState.sort = id;
      rerender(false);
      container.querySelector(`[data-sort="${id}"]`)?.focus();
    }));
    holder.querySelector('[data-more-rows]')?.addEventListener('click', () => { tableState.shown += PAGE_SIZE; rerender(false); });
  }

  /* ---------- views ---------- */
  function render() {
    renderControls();
    renderHero();
    renderCrumbs();
    const view = $('view');
    const kindWord = S.k === 'revenue' ? 'revenue' : 'expenses';
    let html = '', depth = 3;
    if (!S.d) {
      depth = 1;
      if (!S.f) html += `<section class="panel" id="funds" aria-labelledby="funds-title"><h2 id="funds-title">By fund</h2><p class="panel-note">Select a fund to focus every view on it. Totals link to the page where the book prints them.</p>${fundCards()}</section>`;
      html += `<section class="panel" aria-labelledby="dept-title"><h2 id="dept-title">By department${S.f ? ` · ${esc(S.f)}` : ''}</h2><p class="panel-note">Select a department to see its bureaus.</p>${deptCards()}</section>`;
      html += `<section class="panel" aria-labelledby="all-title"><h2 id="all-title">All ${kindWord} line items${S.f ? ` · ${esc(S.f)}` : ''}</h2><div data-table>${tableHTML(1)}</div></section>`;
    } else if (!S.b) {
      depth = 2;
      html += `<div class="two-col"><section class="panel" aria-labelledby="bur-title"><h2 id="bur-title">Bureaus</h2><p class="panel-note">Select a bureau to see its line items.</p>${bureauCards()}</section>`;
      html += `<section class="panel" aria-labelledby="cat-title"><h2 id="cat-title">By category</h2><p class="panel-note">${esc(S.d)} ${kindWord} by type of spending or revenue.</p>${categoryDonutHTML()}${categoryCards()}</section></div>`;
      html += `<section class="panel" aria-labelledby="all-title"><h2 id="all-title">${esc(S.d)} line items</h2><div data-table>${tableHTML(2)}</div></section>`;
    } else {
      html += `<section class="panel" aria-labelledby="li-title"><h2 id="li-title">Line items · ${esc(S.b.split('::')[1])}</h2><p class="panel-note">${esc(S.b.split('::')[0])} · ${esc(S.d)}. Sort by any column; search by name or account number.</p><div data-table>${tableHTML(3)}</div></section>`;
      html += `<section class="panel" aria-labelledby="cat-title"><h2 id="cat-title">By category</h2>${categoryDonutHTML()}${categoryCards()}</section>`;
    }
    view.innerHTML = html;
    view.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => {
      b.closest('section').querySelectorAll('.card[hidden]').forEach((c) => { c.hidden = false; });
      b.remove();
    }));
    wireTable(view, depth);
    renderCatChart();
    renderRevExp();
  }

  /* ---------- revenue vs expense ---------- */
  function renderRevExp() {
    const k = key(S.y, S.m);
    const all = rows(k);
    const fundsHere = [...new Set(all.map((r) => r.fund))];
    const data = fundsHere.map((fi) => {
      const fr = all.filter((r) => r.fund === fi);
      const rev = fr.filter(isRevenue), exp = fr.filter((r) => !isRevenue(r));
      const mk = (list, kind) => {
        const g = aggregate(list, () => 1, () => '').get(1);
        if (g) attachPrinted(g, printedFund(D.funds[fi], kind, k), k);
        return g;
      };
      return { fund: D.funds[fi], rev: mk(rev, 'revenue'), exp: mk(exp, 'expense') };
    }).sort((a, b) => (b.exp?.total || 0) - (a.exp?.total || 0));

    $('rev-exp-note').textContent = `${seriesLabel(k)} · all funds. Revenue is the sum of each fund's revenue lines as printed, which can include transfers between funds and planned use of reserves (fund balance).`;
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    if (window.Chart) {
      const cfg = {
        type: 'bar',
        data: {
          labels: data.map((d) => d.fund.replace(' Fund', '').replace('Management', 'Mgmt.')),
          datasets: [
            { label: 'Revenue', data: data.map((d) => d.rev?.total || 0), backgroundColor: v('--rev'), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.8, categoryPercentage: 0.7 },
            { label: 'Expenses', data: data.map((d) => d.exp?.total || 0), backgroundColor: v('--exp'), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.8, categoryPercentage: 0.7 },
          ],
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
          plugins: {
            legend: { position: 'top', align: 'start', labels: { color: v('--text-2'), boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } },
          },
          scales: {
            x: { ticks: { color: v('--text-3'), callback: (n) => short(n) }, grid: { color: v('--border') }, border: { display: false } },
            y: { ticks: { color: v('--text-2') }, grid: { display: false }, border: { color: v('--border') } },
          },
        },
      };
      if (chart) chart.destroy();
      chart = new Chart($('rev-exp-chart'), cfg);
    }
    const cell = (g) => (g ? `${pdfLink(g.doc, g.page, money(g.total))}${srcLink(g)}` : '<span class="empty">—</span>');
    const body = data.map((d) => {
      const diff = (d.rev?.total || 0) - (d.exp?.total || 0);
      return `<tr><th scope="row">${esc(d.fund)}</th><td class="num">${cell(d.rev)}</td><td class="num">${cell(d.exp)}</td><td class="num"><span class="delta ${diff >= 0 ? 'down' : 'up'}">${diff >= 0 ? '+' : '−'}${money(Math.abs(diff)).slice(1)}</span></td></tr>`;
    }).join('');
    const tr = data.reduce((t, d) => t + (d.rev?.total || 0), 0), te = data.reduce((t, d) => t + (d.exp?.total || 0), 0);
    $('rev-exp-table').innerHTML = `<caption>Revenue minus expenses by fund. Amounts link to the page where the book prints the fund total, or to the fund's first line-item page when it prints none.</caption>
      <thead><tr><th scope="col">Fund</th><th scope="col" class="num">Revenue</th><th scope="col" class="num">Expenses</th><th scope="col" class="num">Revenue − expenses</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>All funds</td><td class="num">${money(tr)}</td><td class="num">${money(te)}</td><td class="num">${tr - te >= 0 ? '+' : '−'}${money(Math.abs(tr - te)).slice(1)}</td></tr></tfoot>`;
  }

  /* ---------- about ---------- */
  function renderAbout() {
    const used = D.books.filter((b) => b.used);
    const figs = (b) => Object.values(D.series).filter((s) => s.year + D.rule[s.measure].book_offset === b.year && D.docs[Array.isArray(s.doc) ? s.doc[0] : s.doc] === b.doc)
      .sort((a, c) => a.year - c.year || ORDER.indexOf(a.measure) - ORDER.indexOf(c.measure))
      .map((s) => `${s.year} ${LABEL[s.measure].toLowerCase()}${typeof s.column === 'string' && s.column.endsWith('_revised') ? ' (revised)' : ''}`);
    const books = used.map((b) => {
      const f = figs(b);
      return `<li><a href="${PDF_BASE + encodeURIComponent(b.doc)}" target="_blank" rel="noopener">${esc(b.doc)}</a> (${b.year} book): ${f.length ? 'supplies ' + f.join(', ') : 'no figures shown under the selection rule'}.</li>`;
    }).join('');
    const ignored = D.books.filter((b) => !b.used).map((b) => `<li>${esc(b.doc)} — another edition of the ${b.year} book; not used.</li>`).join('');
    const issues = D.known_issues.map((i) => {
      const di = D.docs.indexOf(i.source_doc);
      const where = di >= 0 ? pdfLink(di, +i.source_page, `${esc(i.source_doc)}, p.${esc(i.source_page)}`) : `${esc(i.source_doc)}, p.${esc(i.source_page)}`;
      return `<li><strong>${esc(i.label)}</strong> (${where}): ${esc(i.note)}</li>`;
    }).join('');
    $('about-body').innerHTML = `
      <h3>Sources</h3>
      <p>Every figure comes from the City of Lancaster's published budget books. Each book reports several years side by side; this site picks one figure per account, year and measure:</p>
      <ul>
        <li><strong>Proposed</strong> appears only for the newest year (${D.newest_year}), using the revised proposal when the book has one. A proposal is not the adopted budget.</li>
        <li>For every other year, <strong>adopted</strong>, <strong>amended</strong> and <strong>projected</strong> come from the <em>next</em> year's book (the revised projection when present), and <strong>actual</strong> comes from the book two years later.</li>
        <li>A book's own-year proposal is never shown for older years, and year-to-date columns are not shown.</li>
      </ul>
      <p>Books in use:</p><ul>${books}${ignored}</ul>
      <p>Years appear as soon as the books that report them have been processed. Fund totals link to the page where the book prints them; department totals link to their first line-item page; every line item links to its own page.</p>
      <h3>Validation</h3>
      <p>Line items were extracted from the PDFs by script (scanned books were OCR'd first). Every total the book prints (each section, department, fund and staffing schedule) was recomputed from the extracted lines; differences of up to $5 are allowed for the city's rounding to whole dollars. Figures are shown exactly as printed, never adjusted. Where overlapping books disagree on the same figure, the rule above decides and the disagreement is listed in <a href="data/conflicts.json">conflicts.json</a> (${D.conflict_count} so far). Lines of $0 are left out.</p>
      <h3>Known problems in the source PDFs</h3>
      <p>These validation failures come from errors in the city's documents, not the extraction. They were reviewed by a person.</p>
      <ul>${issues || '<li>None recorded.</li>'}</ul>
      <h3>Get the data</h3>
      <p><a href="data/budget.json">budget.json</a> (all figures shown here), <a href="data/staffing.json">staffing.json</a> (budgeted positions), <a href="data/conflicts.json">conflicts.json</a>. The extraction scripts and CSVs are in the project repository.</p>`;
    $('generated').textContent = `Data built ${D.generated.slice(0, 10)}.`;
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const res = await fetch('data/budget.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D = await res.json();
    } catch (err) {
      $('hero-title').textContent = 'Could not load the budget data';
      $('hero-sub').textContent = `data/budget.json: ${err.message}. If you opened index.html from disk, serve the folder over HTTP instead.`;
      return;
    }
    readURL();
    wireControls();
    renderAbout();
    render();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
  boot();
})();
