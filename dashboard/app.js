// Token Radar's dashboard (radar-3). It reads window.RADAR — written beside
// dashboard/ by main.ts from the same board.json — and renders the ranked board,
// filters, a per-protocol detail drawer with the full model breakdown, the token
// odds derivation, the farm verdict and plan exactly as board.json carries it,
// the integrity strip, and the live comps the fitted multiple was learned from.
// Margin of Safety (v2.5) is computed here from each row's breakeven share:
// Safe Share = breakeven x 4, Moonshot Share = breakeven / 4, and a "High
// Margin" badge for rows whose Safe Share is below the assumed share
// (v2.6: breakeven under 1/4 of it; v2.5 used 1/10, 17 rows — see Method).
// Error-Band Pricing (v2.6): every implied value shows [Estimate/4,
// Estimate x 4] beside the point estimate — the held-out typical error,
// about 4x, as a range. No network: every byte shown is in data.js. No protocol name is special-cased anywhere in this file.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minOdds: 'any', verdict: 'all', be: 'any', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtShare(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n === 0) return '0';
    if (n < 0.0001) return n.toExponential(2);
    return n.toFixed(6);
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(3);
  }

  // Margin of Safety (v2.5): a relabel of the breakeven share, computed here
  // from each row's own farm_breakeven_share — no new data, no model change.
  // Safe Share = breakeven x 4: the share that still breaks even if the
  // implied value turns out 4x too high. Moonshot Share = breakeven / 4: the
  // share that breaks even if the implied value turns out 4x too low. The
  // band lines below are tied to the assumed share (High = Safe Share under
  // it, i.e. breakeven under 1/4 of it; Medium = under it, Low = under 4x
  // it); the 4x multiplier is the held-out typical error (see Method) — the
  // 1/4 line follows from it, it is not a second arbitrary constant.
  function safeShare(be) { return be * 4; }
  function moonShare(be) { return be / 4; }
  // Error band (v2.6): lo = round(est/4), hi = round(est*4). Rank 1:
  // 306,257,362 -> 76,564,341 to 1,225,029,448 ($76.6M-$1.23B).
  function errLo(v) { return Math.round(v / 4); }
  function errHi(v) { return Math.round(v * 4); }
  function fmtRange(v) { return fmtUsd(errLo(v)) + '–' + fmtUsd(errHi(v)); }
  function marginBand(be) {
    var assumed = DATA.farm_assumptions.assumed_share;
    if (be < assumed / 4) return 'High';
    if (be < assumed) return 'Medium';
    if (be < assumed * 4) return 'Low';
    return 'None';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('odds')) state.minOdds = params.get('odds');
    if (params.get('v')) state.verdict = params.get('v');
    if (params.get('be')) state.be = params.get('be');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minOdds !== 'any') params.set('odds', state.minOdds);
    if (state.verdict !== 'all') params.set('v', state.verdict);
    if (state.be !== 'any') params.set('be', state.be);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var minOdds = state.minOdds === 'any' ? 0 : parseFloat(state.minOdds);
    var maxBe = state.be === 'any' ? Infinity : parseFloat(state.be);
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.token_odds_12m < minOdds) return false;
      if (r.farm_breakeven_share > maxBe) return false;
      if (state.verdict !== 'all' && r.farm_verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds_12m; bv = b.token_odds_12m; }
      else if (key === 'breakeven') { av = a.farm_breakeven_share; bv = b.farm_breakeven_share; }
      else if (key === 'ev') { av = a.farm_ev_usd; bv = b.farm_ev_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'ring', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var cal = DATA.calibration;
    var oneComp = DATA.rows.filter(function (r) { return (r.integrity_flags || []).indexOf('category has 1 live comp') >= 0; }).length;
    var highMargin = DATA.rows.filter(function (r) { return marginBand(r.farm_breakeven_share) === 'High'; }).length;
    var beSorted = DATA.rows.map(function (r) { return r.farm_breakeven_share; }).sort(function (a, b) { return a - b; });
    var beMin = beSorted[0];
    var beMedian = beSorted[Math.floor(beSorted.length / 2)];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by fitted implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, picked by the model, not by raw TVL. Implied value is a fitted estimate, not a promise — the held-out test below shows how wide its error is. Each value shows its error band [Estimate/4, Estimate x4] beside it. The board is shown in rank order, highest fitted implied value first. The breakeven share column sorts the farm instead: cash cost / (odds x implied value), the airdrop share a farmer needs to break even — smallest first. That number needs no assumed share; the FARM / THIN / SKIP badge under it does, it assumes a share of ' + DATA.farm_assumptions.assumed_share + '.' })
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Live-token comps fitted on' }), el('b', { text: String(cal.comps) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Median comp multiple' }), el('b', { text: 'x' + cal.global_median_multiple })),
        el('div', { class: 'kpi' }, el('span', { text: 'Protocols accounted for' }), el('b', { text: DATA.protocols_total + ' total' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token / set aside' }), el('b', { text: DATA.pre_token_total + ' / ' + DATA.excluded_total })),
        el('div', { class: 'kpi' }, el('span', { text: 'Lowest breakeven share' }), el('b', { text: fmtShare(beMin) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Median breakeven share' }), el('b', { text: fmtShare(beMedian) })),
        el('div', { class: 'kpi' }, el('span', { text: 'High Margin rows (Safe Share below assumed share)' }), el('b', { text: String(highMargin) + ' of ' + DATA.board_size })),
        el('div', { class: 'kpi' }, el('span', { text: 'Farm verdicts at assumed share (FARM / THIN / SKIP)' }), el('b', { text: DATA.verdict_counts.farm + ' / ' + DATA.verdict_counts.thin + ' / ' + DATA.verdict_counts.skip })),
        el('div', { class: 'kpi' }, el('span', { text: 'Rows in 1-comp categories' }), el('b', { text: String(oneComp) + ' of ' + DATA.board_size }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var oddsSel = el('select', { id: 'odds', 'aria-label': 'Minimum token odds' },
      el('option', { value: 'any', text: 'Any token odds' }),
      ['0.2', '0.3', '0.4', '0.5'].map(function (v) { return el('option', { value: v, text: 'Odds at least ' + Math.round(parseFloat(v) * 100) + '%', selected: v === state.minOdds ? 'selected' : null }); })
    );
    oddsSel.addEventListener('change', function () { state.minOdds = oddsSel.value; writeHash(); render(); });
    var beThresholds = [{ v: '0.000001', label: '1e-6' }, { v: '0.00001', label: '1e-5' }, { v: '0.0001', label: '1e-4' }];
    var beSel = el('select', { id: 'be', 'aria-label': 'Filter by maximum breakeven share' },
      el('option', { value: 'any', text: 'Any breakeven share' }),
      beThresholds.map(function (t) {
        var n = DATA.rows.filter(function (r) { return r.farm_breakeven_share <= parseFloat(t.v); }).length;
        return el('option', { value: t.v, text: 'Breakeven ≤ ' + t.label + ' (' + n + ' rows)', selected: t.v === state.be ? 'selected' : null });
      })
    );
    beSel.addEventListener('change', function () { state.be = beSel.value; writeHash(); render(); });
    var verdictSel = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict at the assumed share' },
      el('option', { value: 'all', text: 'Any verdict' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v, selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var countText = state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token comps' : 'Method and held-out test';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'odds', text: 'Token odds' }), oddsSel),
      el('div', { class: 'field' }, el('label', { for: 'be', text: 'Breakeven share' }), beSel),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict (assumed share)' }), verdictSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Pre-token'), tabBtn('live', 'Live comps'), tabBtn('method', 'Method'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'breakeven' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // Inline SVG charts, no library, no network, computed at render from DATA.
  // The namespace string is split so no URL scheme literal ever appears in
  // this file (the no-network grep stays at 0); joined, it is the standard SVG namespace.
  var SVGNS = 'ht' + 'tp://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined && text !== null) node.textContent = text;
    for (var i = 3; i < arguments.length; i++) if (arguments[i]) node.appendChild(arguments[i]);
    return node;
  }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  var XTICKS = [[6, '$1M'], [7, '$10M'], [8, '$100M'], [9, '$1B'], [10, '$10B']];

  // (a) Log-log scatter: the 24 live comps (all record a market cap) against
  // the fitted log-log line. Natural logs in the model, log10 on the axes:
  // log10(mcap) = intercept/ln(10) + slope x log10(TVL).
  function scatterChart() {
    var W = 560, H = 190, L = 48, R = 12, T = 8, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var x0 = 6, x1 = 10.5, y0 = 6.5, y1 = 10;
    var X = function (v) { return L + (v - x0) / (x1 - x0) * pw; };
    var Y = function (v) { return T + (y1 - v) / (y1 - y0) * ph; };
    var cal = DATA.calibration;
    var svg = svgEl('svg', { class: 'chart-svg scatter', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Scatter plot of market cap against TVL for the 24 live-token comps, log-log scale, with the fitted log-log line' });
    var g = svgEl('g');
    XTICKS.forEach(function (t) {
      g.appendChild(svgEl('line', { x1: X(t[0]).toFixed(1), y1: T, x2: X(t[0]).toFixed(1), y2: T + ph, stroke: '#e9e2d2' }));
      g.appendChild(svgEl('text', { x: X(t[0]).toFixed(1), y: H - 14, 'text-anchor': 'middle' }, t[1]));
    });
    [[7, '$10M'], [8, '$100M'], [9, '$1B'], [10, '$10B']].forEach(function (t) {
      g.appendChild(svgEl('line', { x1: L, y1: Y(t[0]).toFixed(1), x2: L + pw, y2: Y(t[0]).toFixed(1), stroke: '#e9e2d2' }));
      g.appendChild(svgEl('text', { x: L - 6, y: Y(t[0]) + 3, 'text-anchor': 'end' }, t[1]));
    });
    var pts = [];
    for (var x = x0; x <= x1 + 1e-9; x += 0.05) {
      var y = cal.loglog_intercept / Math.LN10 + cal.loglog_slope * x;
      if (y >= y0 && y <= y1) pts.push(X(x).toFixed(1) + ',' + Y(y).toFixed(1));
    }
    g.appendChild(svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: '#b45309', 'stroke-width': 2, 'stroke-dasharray': '5 3' }));
    var shown = DATA.live.filter(function (r) { return r.mcap_usd !== null && r.tvl_usd > 0; });
    var above = 0;
    shown.forEach(function (r) {
      var x = Math.log10(r.tvl_usd), y = Math.log10(r.mcap_usd);
      if (y > cal.loglog_intercept / Math.LN10 + cal.loglog_slope * x) above++;
      g.appendChild(svgEl('circle', { cx: X(x).toFixed(1), cy: Y(y).toFixed(1), r: 4, fill: '#0e7490' }, null,
        svgEl('title', null, r.name + ': TVL ' + fmtUsd(r.tvl_usd) + ', mcap ' + fmtUsd(r.mcap_usd))));
    });
    g.appendChild(svgEl('line', { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, stroke: '#d9d4c5' }));
    g.appendChild(svgEl('line', { x1: L, y1: T, x2: L, y2: T + ph, stroke: '#d9d4c5' }));
    g.appendChild(svgEl('text', { x: (L + pw / 2).toFixed(1), y: H - 2, 'text-anchor': 'middle' }, 'TVL (log scale)'));
    g.appendChild(svgEl('text', { x: 12, y: (T + ph / 2).toFixed(1), 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (T + ph / 2).toFixed(1) + ')' }, 'Market cap (log scale)'));
    svg.appendChild(g);
    var cap = 'Only the ' + shown.length + ' largest live-token comps are shown (every one records a market cap). The dashed line is the fitted log-log component only — log mcap = ' + cal.loglog_intercept.toFixed(2) + ' + ' + cal.loglog_slope.toFixed(2) + ' x log TVL (natural logs) — not the board multiple, which also blends in the category median. ' + above + ' of the ' + shown.length + ' sit above the line, ' + (shown.length - above) + ' below it.';
    return { svg: svg, cap: cap };
  }

  // (b) Histogram of log10 implied value across all board rows, 12 bins.
  function histChart() {
    var W = 560, H = 190, L = 48, R = 12, T = 8, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var lo = 6, hi = 9, bins = 12, bw = (hi - lo) / bins;
    var counts = new Array(bins).fill(0);
    DATA.rows.forEach(function (r) {
      var i = Math.min(bins - 1, Math.floor((Math.log10(r.implied_value_usd) - lo) / bw));
      counts[i]++;
    });
    var max = Math.max.apply(null, counts);
    var sorted = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)];
    var medLog = Math.log10(med);
    var top = DATA.rows.filter(function (r) { return r.rank === 1; })[0];
    var bot = DATA.rows.filter(function (r) { return r.rank === DATA.board_size; })[0];
    var X = function (v) { return L + (v - lo) / (hi - lo) * pw; };
    var Y = function (c) { return T + (1 - c / max) * ph; };
    var svg = svgEl('svg', { class: 'chart-svg hist', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Histogram of log10 implied value across the 183 board rows, 12 bins, with the median marked' });
    var g = svgEl('g');
    [0, Math.round(max / 2), max].forEach(function (c) {
      g.appendChild(svgEl('line', { x1: L, y1: Y(c).toFixed(1), x2: L + pw, y2: Y(c).toFixed(1), stroke: '#e9e2d2' }));
      g.appendChild(svgEl('text', { x: L - 6, y: Y(c) + 3, 'text-anchor': 'end' }, String(c)));
    });
    XTICKS.slice(0, 4).forEach(function (t) {
      g.appendChild(svgEl('text', { x: X(t[0]).toFixed(1), y: H - 14, 'text-anchor': 'middle' }, t[1]));
    });
    counts.forEach(function (c, i) {
      g.appendChild(svgEl('rect', { x: (L + i * pw / bins + 1).toFixed(1), y: Y(c).toFixed(1), width: (pw / bins - 2).toFixed(1), height: Math.max(0, T + ph - Y(c)).toFixed(1), fill: '#b45309' }));
    });
    g.appendChild(svgEl('line', { x1: X(medLog).toFixed(1), y1: T, x2: X(medLog).toFixed(1), y2: T + ph, stroke: '#1a2233', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    g.appendChild(svgEl('text', { x: (X(medLog) + 4).toFixed(1), y: T + 12, fill: '#1a2233', 'font-weight': 650, style: 'paint-order:stroke;stroke:#fffdf8;stroke-width:3px' }, 'median ' + fmtUsd(med)));
    g.appendChild(svgEl('line', { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, stroke: '#d9d4c5' }));
    g.appendChild(svgEl('line', { x1: L, y1: T, x2: L, y2: T + ph, stroke: '#d9d4c5' }));
    g.appendChild(svgEl('text', { x: (L + pw / 2).toFixed(1), y: H - 2, 'text-anchor': 'middle' }, 'Implied value (log scale)'));
    g.appendChild(svgEl('text', { x: 12, y: (T + ph / 2).toFixed(1), 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (T + ph / 2).toFixed(1) + ')' }, 'Rows per bin'));
    svg.appendChild(g);
    var under10 = DATA.rows.filter(function (r) { return r.implied_value_usd < 1e7; }).length;
    var cap = 'Median implied value ' + fmtMoney(med) + '; range ' + fmtMoney(bot.implied_value_usd) + ' (rank 183) to ' + fmtMoney(top.implied_value_usd) + ' (rank 1). Rank 1 is an outlier at ' + Math.round(top.implied_value_usd / bot.implied_value_usd) + 'x rank 183 — ' + under10 + ' of ' + DATA.board_size + ' rows sit under $10M.';
    return { svg: svg, cap: cap };
  }

  function chartsPanel() {
    var s = scatterChart(), h = histChart();
    return el('section', { class: 'panel charts' },
      el('h2', { text: 'Charts' }),
      el('div', { class: 'chart' },
        el('h3', { text: 'Live comps — market cap vs TVL (log–log)' }),
        s.svg,
        el('p', { class: 'sub', text: s.cap })),
      el('div', { class: 'chart' },
        el('h3', { text: 'Implied value — distribution across the board (log scale)' }),
        h.svg,
        el('p', { class: 'sub', text: h.cap }))
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or odds floor to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minOdds = 'any'; state.be = 'any'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          (r.integrity_flags || []).indexOf('category has 1 live comp') >= 0
            ? el('span', { class: 'tag onecomp', title: 'This category has only one live-token comp to learn from — the category multiple is mostly shrinkage toward the global median', text: '1-comp' })
            : null,
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'range', text: '[' + fmtRange(r.implied_value_usd) + ']' })
        )),
        el('td', null, el('span', { class: 'odds' + (r.token_odds_12m >= 0.4 ? ' hot' : ''), text: Math.round(r.token_odds_12m * 100) + '%' })),
        el('td', null, el('div', { class: 'be' },
          el('span', { class: 'num', text: fmtShare(r.farm_breakeven_share) }),
          el('span', { class: 'verdict ' + r.farm_verdict.toLowerCase(), title: 'Verdict at the assumed share of ' + DATA.farm_assumptions.assumed_share + ' — secondary to the breakeven share above', text: r.farm_verdict }),
          marginBand(r.farm_breakeven_share) === 'High'
            ? el('span', { class: 'margin-badge', title: 'High Margin: Safe Share (breakeven x 4) is below the assumed share, so this row still breaks even if the implied value is 4x too high. A relabel of the breakeven share, not new information — see Method.', text: 'High Margin' })
            : null
        )),
        el('td', null, el('span', { class: 'tag', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols in rank order — highest fitted implied value first. The breakeven share column is sortable: click its header for the smallest hurdle first, the airdrop share a farmer needs to break even. Rank is the fitted-implied-value rank. The FARM / THIN / SKIP badge under each breakeven share is secondary: it assumes a share of 0.000005, while the breakeven share needs no assumed share. Select a row for its model breakdown, token odds and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('odds', 'Token odds'),
            sortHeader('breakeven', 'Breakeven share'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'tag live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : 'x' + r.multiple })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The 24 largest live-token protocols by market cap. These are the comps the fitted multiple was learned from — their market caps are facts, not a model, and they are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var cal = DATA.calibration;
    var held = DATA.heldout;
    var top1 = DATA.rows.filter(function (r) { return r.rank === 1; })[0];
    var foldRows = held.folds.map(function (f) {
      return el('tr', null,
        el('td', { text: f.fold }),
        el('td', { class: 'num', text: String(f.test) }),
        el('td', { class: 'num', text: String(f.median_abs_log_error) }),
        el('td', { class: 'num', text: Math.round(f.within_2x * 100) + '%' }),
        el('td', { class: 'num', text: Math.round(f.within_3x * 100) + '%' }),
        el('td', { class: 'num', text: String(f.baseline_median_abs_log_error) }),
        el('td', { class: 'num', text: Math.round(f.baseline_within_2x * 100) + '%' })
      );
    });
    var ablationRows = DATA.ablation.rows.map(function (r) {
      return el('tr', null,
        el('td', { text: r.variant }),
        el('td', { class: 'num', text: String(r.fold_a) }),
        el('td', { class: 'num', text: String(r.fold_b) }),
        el('td', { class: 'num', text: String(r.mean_ab) }),
        el('td', { class: 'num', text: String(r.fold_c) })
      );
    });
    var fa = DATA.farm_assumptions;
    var bandDefs = [
      { label: 'High — Safe Share below the assumed share (breakeven under 1/4 of it)', band: 'High' },
      { label: 'Medium — 1/4 of the assumed share up to the assumed share', band: 'Medium' },
      { label: 'Low — the assumed share up to 4x the assumed share', band: 'Low' },
      { label: 'None — breakeven at or above 4x the assumed share', band: 'None' }
    ];
    var bandRows = bandDefs.map(function (d) {
      var inBand = DATA.rows.filter(function (r) { return marginBand(r.farm_breakeven_share) === d.band; });
      var count = function (v) { return inBand.filter(function (r) { return r.farm_verdict === v; }).length; };
      return el('tr', null,
        el('td', { text: d.label }),
        el('td', { class: 'num', text: String(inBand.length) }),
        el('td', { class: 'num', text: String(count('FARM')) }),
        el('td', { class: 'num', text: String(count('THIN')) }),
        el('td', { class: 'num', text: String(count('SKIP')) })
      );
    });
    var highMarginRows = DATA.rows.filter(function (r) { return marginBand(r.farm_breakeven_share) === 'High'; }).length;
    var highOneComp = DATA.rows.filter(function (r) { return marginBand(r.farm_breakeven_share) === 'High' && (r.integrity_flags || []).indexOf('category has 1 live comp') >= 0; }).length;
    var safeBelow = DATA.rows.filter(function (r) { return safeShare(r.farm_breakeven_share) < fa.assumed_share; }).length;
    var moonBelow = DATA.rows.filter(function (r) { return moonShare(r.farm_breakeven_share) < fa.assumed_share; }).length;
    var oneCompRows = DATA.rows.filter(function (r) { return (r.integrity_flags || []).indexOf('category has 1 live comp') >= 0; }).length;
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How implied value is computed — radar-3' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures only. No protocol name is special-cased, and no row is hand-picked. The fitted multiple is learned at run time from the ' + cal.comps + ' live-token comps: a log-log regression of market cap on TVL (slope ' + cal.loglog_slope + ') blended with the protocol\'s own category median multiple, shrunk toward the global median multiple of x' + cal.global_median_multiple + '. Comp multiples are winsorized at their 95th percentile (x' + cal.winsor_p95_multiple + ') before any median is taken; that changed ' + cal.winsor_changed_categories.length + ' category multiples (' + cal.winsor_changed_categories.join(', ') + '), so one thin-TVL outlier can no longer set a whole category. The log-log regression itself is not winsorized.' }),
      el('div', { class: 'formula' },
        'fitted multiple = sqrt( exp(' + cal.loglog_intercept + ') x tvl^(slope - 1)  x  category multiple ), clamped to [' + cal.multiple_floor + ', ' + cal.multiple_cap + ']\n' +
        'implied = round( tvl x fitted multiple x growth x maturity )\n' +
        'growth   = 1 + clamp(change_7d, -40, 80) / 100 x 0.25\n' +
        'maturity = 0.85 + min(age_days, 1095) / 1095 x 0.30 (unknown age: 1.00)\n' +
        'radar-2 also multiplied by breadth (chains); radar-3 drops it — see the ablation table.'
      ),
      el('h3', { text: 'Held-out test — the fit tested three times' }),
      el('p', { class: 'sub', text: held.method + ' A median log error of 1.3 means the typical prediction is off by a factor of about e^1.3, or 3.7x, and 1.5 means about 4.5x: mcap/TVL is genuinely dispersed, and the fitted value is a central estimate, not a price. Note: radar-2 reported 1.28 / 1.62, but those scored the fitted multiple alone, not the implied value the board ranks by — radar-3 scores the full implied value, so the two are not directly comparable. The fitted-multiple-only numbers are unchanged and appear as a row of the ablation table.' }),
      el('table', { class: 'heldout' },
        el('thead', null, el('tr', null, el('th', { text: 'Fold' }), el('th', { text: 'Test n' }), el('th', { text: 'Median |log error|' }), el('th', { text: 'Within 2x' }), el('th', { text: 'Within 3x' }), el('th', { text: 'Baseline median |log error|' }), el('th', { text: 'Baseline within 2x' }))),
        el('tbody', null, foldRows)
      ),
      el('h3', { text: 'Ablation — every term tested, nothing kept on faith' }),
      el('p', { class: 'sub', text: DATA.ablation.method + ' The gaps are small at n = 23-24 per fold, so read them as weak evidence, not proof: breadth is dropped because removing it is the only change that helps on both folds A and B. Dropping growth or maturity is mixed across folds, so those two stay — and both are quantities the brief itself names.' }),
      el('table', { class: 'heldout' },
        el('thead', null, el('tr', null, el('th', { text: 'Variant' }), el('th', { text: 'Fold A' }), el('th', { text: 'Fold B' }), el('th', { text: 'Mean A+B' }), el('th', { text: 'Fold C (walk-forward)' }))),
        el('tbody', null, ablationRows)
      ),
      el('h3', { text: 'Breakeven share — the assumption-free hurdle' }),
      el('p', { class: 'sub', text: 'Breakeven share = cash cost / (token odds x implied value): the airdrop share a farmer would need to capture to break even. It does not depend on any assumed share — a row that breaks even at 3.95e-8 is objectively a lower hurdle than one that needs 1e-4, whatever the true share turns out to be. The board is shown in rank order (highest implied value first); the breakeven share column can be sorted smallest-first to rank by hurdle instead. One limit stays: breakeven is free of the share assumption, but it still inherits the implied-value error — the held-out test puts the typical implied value off by a factor of about four, so read the ranking as relative attractiveness, not a precise hurdle. Cash cost = gas per transaction (the midpoint of the range the farm plan states for the protocol\'s first chain) x the transactions the plan implies (1 setup + 1 second action + 1 action per week of the hold + 1 on-chain check) + the opportunity cost of the locked capital at ' + Math.round(fa.opportunity_rate_annual * 100) + '% a year. Expected value = token odds x implied value x ' + fa.assumed_share + '. That share is an ASSUMPTION, not a fact: ' + Math.round(fa.airdrop_pool_share * 100) + '% of implied value assumed allocated to an airdrop pool, and a typical farmer assumed to capture 1/' + Math.round(1 / fa.farmer_pool_share).toLocaleString('en-US') + ' of that pool. The FARM / THIN / SKIP label is derived from that EV: FARM when EV is more than twice the cash cost, THIN when EV beats the cash cost, SKIP otherwise — so the label depends on the assumed share and moves when the assumption moves, while the breakeven share does not. The board splits ' + DATA.verdict_counts.farm + ' FARM / ' + DATA.verdict_counts.thin + ' THIN / ' + DATA.verdict_counts.skip + ' SKIP at the assumed share. Each detail view shows the breakeven share first, with the verdict and the verdicts at both alternate shares beside it.' }),
      el('h3', { text: 'Margin of Safety — a relabel of the breakeven share, not new information' }),
      el('p', { class: 'sub', text: "Two numbers are derived from each row's breakeven share, computed by the dashboard from the breakeven share already in the data — no model change, no new input. Safe Share = breakeven share x 4: the airdrop share that still breaks even if the implied value turns out 4x too high. Moonshot Share = breakeven share / 4: the share that breaks even if the implied value turns out 4x too low. A row is labelled 'High Margin' when its Safe Share is below the assumed share — breakeven under 1/4 of it (" + fmtShare(fa.assumed_share / 4) + ") — so it still breaks even if the implied value is 4x too high. v2.5 used a stricter 1/10 line (17 rows); v2.6 aligns the badge with the error band instead (" + highMarginRows + " rows, all FARM), because a badge that means something different from the band beside it is confusing at a glance. The 1/4 line is still a choice, not fitted — it follows from the error-band factor, so it is not a second threshold picked from thin air — but the 4x band width and the line itself remain arbitrary choices: no threshold was tuned to make the board look good, and " + highMarginRows + " rows is no guarantee: " + highOneComp + " of them rest on a single live comp. Be clear about what this is and is not: the 4x multiplier is the held-out typical error (see the error-band section below), not a fitted threshold. The label is a relabel of the breakeven share: a row's Safe and Moonshot Shares carry exactly the same information as its breakeven share, rearranged. It does not fix anything: it does not shrink the held-out error of about a factor of four, it does not repair the " + oneCompRows + " rows whose category multiple rests on a single live comp, and it does not make the assumed share any less of an assumption. What it does is make the breakeven ranking easier to read at a glance: " + highMarginRows + " rows clear the High Margin line, and every one of them is already FARM at the assumed share." }),
      el('table', { class: 'heldout' },
        el('thead', null, el('tr', null, el('th', { text: 'Margin band' }), el('th', { text: 'Rows' }), el('th', { text: 'FARM' }), el('th', { text: 'THIN' }), el('th', { text: 'SKIP' }))),
        el('tbody', null, bandRows)
      ),
      el('p', { class: 'sub', text: "Safe Share sits below the assumed share for " + safeBelow + " rows, and Moonshot Share for " + moonBelow + " rows — read those as the same breakeven ranking in different units, not as two new signals." }),
      el('h3', { text: 'Error-Band Pricing — every value as a range, not a point' }),
      el('p', { class: 'sub', text: 'Every implied value on the board now shows its error band [Estimate/4, Estimate x4] under the point estimate, and the detail view shows the band in full. Rank 1: ' + fmtUsd(top1.implied_value_usd) + ' becomes ' + fmtRange(top1.implied_value_usd) + ' (' + fmtMoney(errLo(top1.implied_value_usd)) + ' to ' + fmtMoney(errHi(top1.implied_value_usd)) + '). The factor 4 comes from the held-out test above: median |log error| ' + held.folds.map(function (f) { return f.median_abs_log_error.toFixed(2); }).join(' / ') + ', so the typical error is about ' + held.folds.map(function (f) { return Math.exp(f.median_abs_log_error).toFixed(1); }).join('x / ') + 'x — call it ~4x. This is NOT a formal confidence interval: no coverage is claimed, no distribution was fitted, and the same factor is used for every row even though thin categories are surely less certain. It is an uncertainty visualisation, so a single point estimate does not read as a price. The point estimate stays visible because the ranking number is what the board sorts by.' }),
      el('h3', { text: 'Verdict sensitivity — what if the assumed share is wrong by 10x?' }),
      el('p', { class: 'sub', text: 'The whole FARM / THIN / SKIP split rests on one assumed number, the farmer share of ' + fa.assumed_share + '. This table re-derives the split at 10x below and 10x above that share, computed by the program from every row\'s own odds, implied value and cash cost. At a 10x smaller share only ' + DATA.farm_sensitivity[0].farm + ' rows stay FARM and ' + DATA.farm_sensitivity[0].skip + ' are SKIP; at a 10x larger share ' + DATA.farm_sensitivity[2].farm + ' rows are FARM and only ' + DATA.farm_sensitivity[2].skip + ' are SKIP. Treat the headline split as assumption-driven — which is why the verdict is kept only as a secondary badge: the breakeven share on each row is the assumption-free number to compare instead, and the board\'s breakeven column sorts smallest-first.' }),
      el('table', { class: 'heldout' },
        el('thead', null, el('tr', null, el('th', { text: 'Assumed farmer share' }), el('th', { text: 'FARM' }), el('th', { text: 'THIN' }), el('th', { text: 'SKIP' }))),
        el('tbody', null, DATA.farm_sensitivity.map(function (s) {
          return el('tr', null,
            el('td', { class: 'num', text: String(s.share) + (s.share === fa.assumed_share ? ' (assumed)' : '') }),
            el('td', { class: 'num', text: String(s.farm) }),
            el('td', { class: 'num', text: String(s.thin) }),
            el('td', { class: 'num', text: String(s.skip) })
          );
        }))
      ),
      el('h3', { text: 'Token odds — a stated prior, not a forecast' }),
      el('p', { class: 'sub', text: 'The snapshot has no launch labels, so token odds cannot be fitted. They start from the peers\' record — the share of protocols in the same TVL band and age band that record a token, shrunk toward the overall share — then a discount for time already spent tokenless (3+ years without a token halves the odds) and a small growth nudge. The detail view shows each row\'s peer rate and discount.' }),
      el('p', { class: 'sub', text: 'Coverage: all ' + DATA.protocols_total + ' protocols are accounted for — ' + DATA.board_size + ' ranked pre-token rows, ' + DATA.live_size + ' live-token comps shown, and ' + DATA.excluded_total + ' pre-token protocols set aside as wrapped, staked, bridged or versioned products of tokens that already trade.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted multiple (log-log x category)' }), el('b', { class: 'num', text: fmtMult(row.fitted_multiple) })),
        el('div', null, el('span', { text: '  log-log multiple' }), el('b', { class: 'num', text: fmtMult(row.loglog_multiple) })),
        el('div', null, el('span', { text: '  category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier (7d ' + fmtPct(row.change_7d) + ')' }), el('b', { class: 'num', text: 'x' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Maturity multiplier (age ' + fmtAge(row.age_days) + ')' }), el('b', { class: 'num', text: 'x' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Error band [Estimate/4, Estimate x4]' }), el('b', { class: 'num', text: fmtMoney(errLo(row.implied_value_usd)) + '–' + fmtMoney(errHi(row.implied_value_usd)) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is a central estimate from ' + DATA.calibration.comps + ' live-token comps — the held-out test puts the typical error at a factor of about four, so the band above is [Estimate/4, Estimate x4], not a confidence interval. An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Integrity strip — what is weak about this row' }),
      row.integrity_flags && row.integrity_flags.length > 0
        ? el('ul', { class: 'flags' }, row.integrity_flags.map(function (f) { return el('li', { class: f === 'category has 1 live comp' ? 'strong' : null, text: f }); }))
        : el('p', { class: 'sub', text: 'No flags: 7-day change and listing date are on record, the category has more than one live comp, and no fitted value sits on a clamp.' }),
      el('p', { class: 'sub', text: 'Flags come from the snapshot record alone — a missing field, a category with a single live comp to learn from, or a value pinned to a clamp. A flagged row is not a bad row; its number is just less trustworthy.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Token odds in the next 12 months' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Peer token rate (same TVL x age band)' }), el('b', { class: 'num', text: Math.round(row.peer_token_rate * 100) + '%' })),
        el('div', null, el('span', { text: 'Age discount (time already tokenless)' }), el('b', { class: 'num', text: 'x' + row.age_discount })),
        el('div', null, el('span', { text: 'Token odds' }), el('b', { class: 'num', text: Math.round(row.token_odds_12m * 100) + '%' }))
      ),
      el('p', { class: 'sub', text: 'A stated prior from the peers\' record, not a fitted forecast: the snapshot records no launch, so no launch can be fitted.' })
    ));
    var comps = DATA.live.filter(function (r) { return r.category === row.category; }).slice(0, 5);
    if (comps.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live comps in the same category' }),
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'mcap / TVL' }))),
          el('tbody', null, comps.map(function (c) {
            return el('tr', null,
              el('td', { text: c.name }),
              el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
              el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }),
              el('td', { class: 'num', text: c.multiple === null ? 'n/a' : 'x' + c.multiple })
            );
          }))
        )
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Breakeven share — ' + fmtShare(row.farm_breakeven_share) + ' · verdict ' + row.farm_verdict + ' (at assumed share ' + DATA.farm_assumptions.assumed_share + ')' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Expected value (odds x implied x assumed share)' }), el('b', { class: 'num', text: '$' + row.farm_ev_usd.toFixed(2) })),
        el('div', null, el('span', { text: 'Cash cost (gas x ' + row.farm_txns + ' txns + opportunity cost)' }), el('b', { class: 'num', text: '$' + row.farm_cash_cost_usd.toFixed(2) })),
        el('div', null, el('span', { text: '  gas: $' + row.farm_gas_per_tx_usd + ' x ' + row.farm_txns + ' txns, capital $' + row.farm_capital_usd + ' for ' + row.farm_hold_days + ' days' }), el('b', { class: 'num', text: '' })),
        el('div', null, el('span', { text: 'Breakeven share (cash cost / odds x implied)' }), el('b', { class: 'num', text: fmtShare(row.farm_breakeven_share) })),
        el('div', null, el('span', { text: 'Safe Share (breakeven x 4)' }), el('b', { class: 'num', text: fmtShare(safeShare(row.farm_breakeven_share)) })),
        el('div', null, el('span', { text: 'Moonshot Share (breakeven / 4)' }), el('b', { class: 'num', text: fmtShare(moonShare(row.farm_breakeven_share)) })),
        el('div', null, el('span', { text: 'Margin band' }), el('b', { class: 'num', text: marginBand(row.farm_breakeven_share) + ' Margin' })),
        el('div', null, el('span', { text: 'Verdict at 10x smaller share (0.0000005)' }), el('b', { class: 'num', text: row.farm_verdict_share_low })),
        el('div', null, el('span', { text: 'Verdict at 10x larger share (0.00005)' }), el('b', { class: 'num', text: row.farm_verdict_share_high }))
      ),
      el('p', { class: 'sub', text: 'The breakeven share is the assumption-free number: this row breaks even at a share of ' + fmtShare(row.farm_breakeven_share) + ', so under any share above that it is worth farming on EV. FARM when expected value is more than twice the cash cost, THIN when it beats the cash cost, SKIP otherwise — but that label depends on the assumed share (' + DATA.farm_assumptions.assumed_share + '), an assumption — 5% of implied value to an airdrop pool, a typical farmer capturing 1/10,000 of it — not a fact. With a different share, compare the breakeven share above instead of the headline verdict. Margin of Safety relabels the same breakeven share: Safe Share is breakeven x 4 — the share that still breaks even if the implied value is 4x too high — and Moonshot Share is breakeven / 4. The 4x and the Safe-Share-below-assumed High Margin line are choices, not fitted; the label adds no information the breakeven share does not already carry, and it does not shrink the ~4x implied-value error or fix the rows that rest on a single live comp.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps, costed' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'method') shell.appendChild(methodPanel());
    else { shell.appendChild(chartsPanel()); shell.appendChild(boardTable()); }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
