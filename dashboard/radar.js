// Token Launch Radar v2 — Offline Interactive Dashboard
// Zero network calls: reads window.RADAR generated in ../data.js by main.ts.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var root = document.getElementById('radar-root');
  var state = {
    tab: 'board',       // 'board' | 'live'
    tier: 'all',        // 'all' | 'watchlist' | 'early'
    category: 'all',
    chain: 'all',
    q: '',
    sort: 'implied',    // 'implied' | 'rank' | 'name' | 'tvl' | 'growth' | 'age' | 'chains'
    dir: -1,            // -1 desc, 1 asc
    selected: null
  };

  function fmtCompactUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  var intUsdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtExactUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return intUsdFmt.format(Math.round(n));
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days, isFallback) {
    if (days === null || days === undefined) return 'unknown (365d model)';
    var label = days >= 365 ? (days / 365).toFixed(1) + 'y (' + days + 'd)' : days + 'd';
    return isFallback ? label + ' [fallback]' : label;
  }

  /**
   * Mirror of lib/model.ts computeImpliedValue: recomputes every row purely from
   * snapshot numbers and model constants so the UI and board.json stay auditable.
   */
  function computeImpliedValue(row, model) {
    var base = row.tvl_usd * model.base_multiple;
    var rawG = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var g = Math.min(model.growth_cap, Math.max(model.growth_floor, rawG));
    var gWeight = g >= 0 ? model.growth_up_weight : model.growth_down_weight;
    var growthMult = 1 + (g / 100) * gWeight;

    var ageEff = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : Math.max(0, row.age_days);
    var maturityMult = model.maturity_floor + (Math.min(ageEff, model.maturity_days) / model.maturity_days) * model.maturity_range;

    var chainLen = row.chains ? row.chains.length : 0;
    var extraChains = Math.min(Math.max(0, chainLen - 1), model.chain_max_extra);
    var chainMult = 1 + model.chain_step * extraChains;

    var implied = Math.min(100000000000000, Math.max(1, Math.round(base * growthMult * maturityMult * chainMult)));
    return {
      implied: implied,
      base: Math.round(base),
      growthPct: g,
      growthWeight: gWeight,
      growthMult: growthMult,
      ageEff: ageEff,
      maturityMult: maturityMult,
      chainCount: chainLen,
      chainMult: chainMult
    };
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      } else if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else {
        el.appendChild(child);
      }
    }
    return el;
  }

  function radarEmblemHtml() {
    return h('div', { class: 'radar-emblem', 'aria-hidden': 'true' },
      h('div', { class: 're-ring' }),
      h('div', { class: 're-ring re-ring-sm' }),
      h('div', { class: 're-cross-v' }),
      h('div', { class: 're-cross-h' }),
      h('div', { class: 're-sweep' }),
      h('div', { class: 're-line' }),
      h('div', { class: 're-dot re-dot-teal' }),
      h('div', { class: 're-dot re-dot-amber' })
    );
  }

  function buildSectorHtml(list) {
    var byCat = {};
    list.forEach(function (r) {
      var c = r.category || 'Uncategorized';
      if (!byCat[c]) byCat[c] = { cat: c, sum: 0, count: 0 };
      byCat[c].sum += r.implied_value_usd;
      byCat[c].count += 1;
    });
    var items = Object.keys(byCat).map(function (k) { return byCat[k]; }).sort(function (a, b) { return b.sum - a.sum; });
    var top = items.slice(0, 5);
    var totalImplied = items.reduce(function (acc, it) { return acc + it.sum; }, 0) || 1;
    var maxSum = top.length ? top[0].sum : 1;

    if (top.length === 0) {
      return h('div', { class: 'html-chart', role: 'img', 'aria-label': 'Top sectors by implied value' },
        h('div', { class: 'hc-empty', text: 'No rows match active filters' }));
    }

    var rows = top.map(function (it, idx) {
      var barW = Math.max(4, Math.round((it.sum / maxSum) * 168));
      var share = ((it.sum / totalImplied) * 100).toFixed(1) + '%';
      var label = it.cat.length > 22 ? it.cat.slice(0, 20) + '..' : it.cat;
      return h('div', { class: 'hc-row' },
        h('span', { class: 'hc-label', text: label }),
        h('span', { class: 'hc-track' }, h('span', { class: 'hc-fill' + (idx === 0 ? ' hc-fill-first' : ''), style: 'width:' + barW + 'px' })),
        h('span', { class: 'hc-value', text: fmtCompactUsd(it.sum) + ' (' + it.count + ' · ' + share + ')' })
      );
    });
    return h('div', { class: 'html-chart', role: 'img', 'aria-label': 'Sector implied value distribution' }, rows);
  }

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('tier') === 'watchlist' || p.get('tier') === 'early') state.tier = p.get('tier');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir') === '1') state.dir = 1;
    if (p.get('p')) state.selected = p.get('p');
  }

  function writeHash() {
    var p = new URLSearchParams();
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.tier !== 'all') p.set('tier', state.tier);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', '1');
    if (state.selected) p.set('p', state.selected);
    var str = p.toString();
    window.history.replaceState(null, '', str ? '#' + str : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd;
        bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? -1 : a.age_days;
        bv = b.age_days === null ? -1 : b.age_days;
      } else if (key === 'chains') {
        av = a.chains ? a.chains.length : 0;
        bv = b.chains ? b.chains.length : 0;
      } else if (key === 'rank') {
        av = -a.rank;
        bv = -b.rank;
      } else {
        av = a.implied_value_usd;
        bv = b.implied_value_usd;
      }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function allCategories() {
    var set = {};
    DATA.rows.forEach(function (r) { set[r.category || 'Uncategorized'] = true; });
    return Object.keys(set).sort();
  }

  function allChainsByFreq() {
    var counts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  function renderHeader() {
    return h('header', { class: 'topbar' },
      h('div', { class: 'brand' },
        radarEmblemHtml(),
        h('div', null,
          h('div', { class: 'brand-title', text: 'TOKEN LAUNCH RADAR // RADAR-V2' }),
          h('div', { class: 'proto-sub', text: 'Pre-token-record screener & deterministic farm planner' })
        )
      ),
      h('div', { class: 'meta-strip' },
        h('span', { class: 'badge accent', text: 'Snapshot ' + DATA.as_of }),
        h('span', { class: 'badge', text: DATA.total_protocols + ' snapshot protocols' }),
        h('span', { class: 'badge', text: 'Zero network · Offline bundle' })
      )
    );
  }

  function renderHero() {
    return h('section', { class: 'hero' },
      h('div', { class: 'hero-head' },
        h('div', null,
          h('h1', { text: 'Pre-Token Protocol Radar: Value Model v2 & Execution Plans' }),
          h('p', { class: 'hero-sub', text: 'Covers 100% of the ' + DATA.watchlist_size + ' watchlist protocols (>= $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL, no token on record) plus ' + DATA.early_size + ' early pre-token-record protocols below the floor. Live-token protocols are separated cleanly. Derived strictly from the 10 snapshot fields — no hardcoded names, no guaranteed airdrops.' })
        )
      ),
      h('div', { class: 'kpi-grid' },
        h('div', { class: 'kpi-card' },
          h('div', { class: 'kpi-label', text: 'Watchlist Floor Covered' }),
          h('div', { class: 'kpi-val', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
          h('div', { class: 'kpi-note', text: '100% coverage (>= $50M TVL)' })
        ),
        h('div', { class: 'kpi-card' },
          h('div', { class: 'kpi-label', text: 'Pre-Token Radar Board' }),
          h('div', { class: 'kpi-val', text: String(DATA.board_size) }),
          h('div', { class: 'kpi-note', text: DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early protocols' })
        ),
        h('div', { class: 'kpi-card is-warn' },
          h('div', { class: 'kpi-label', text: 'Rank Shifts vs Pure TVL' }),
          h('div', { class: 'kpi-val', text: DATA.divergence_count + ' / ' + DATA.board_size }),
          h('div', { class: 'kpi-note', text: 'Re-ordered by v2 asymmetric factors' })
        ),
        h('div', { class: 'kpi-card' },
          h('div', { class: 'kpi-label', text: 'Live Tokens Isolated' }),
          h('div', { class: 'kpi-val', text: String(DATA.live_size) }),
          h('div', { class: 'kpi-note', text: 'Excluded from pre-token ranking' })
        )
      )
    );
  }

  function renderIntelRow(currentFiltered) {
    var m = DATA.model;
    return h('section', { class: 'intel-grid' },
      h('div', { class: 'panel intel-card' },
        h('div', { class: 'intel-title' },
          h('h2', { text: 'Model v2 Formula (computeImpliedValue)' }),
          h('span', { class: 'badge accent', text: '10-field pure derivation' })
        ),
        h('div', { class: 'formula-box', text: 'implied = max(1, round( tvl_usd * ' + m.base_multiple + ' * growthMult * maturityMult * chainMult ))' }),
        h('div', { class: 'factor-list' },
          h('div', null, h('b', { text: '1. Asymmetric 7d Growth: ' }), 'clamp(' + m.growth_floor + '%, +' + m.growth_cap + '%); upside +' + m.growth_up_weight + 'x vs downside -' + m.growth_down_weight + 'x penalty (capital flight weighs 2x).'),
          h('div', null, h('b', { text: '2. Age Maturity: ' }), m.maturity_floor + ' + min(age, ' + m.maturity_days + 'd)/' + m.maturity_days + ' * ' + m.maturity_range + ' (unlisted fallback ' + m.unknown_age_days + 'd; caps at 1.00x).'),
          h('div', null, h('b', { text: '3. Multi-Chain Reach: ' }), '1.00 + ' + m.chain_step + ' * min(chains - 1, ' + m.chain_max_extra + ') (caps at 1.15x at 6+ chains to prevent tail bloat).')
        )
      ),
      h('div', { class: 'panel intel-card', id: 'sector-chart-card' },
        h('div', { class: 'intel-title' },
          h('h2', { text: 'Top Categories in Current View' }),
          h('span', { class: 'badge', id: 'chart-scope-badge', text: currentFiltered.length + ' protocols' })
        ),
        buildSectorHtml(currentFiltered)
      )
    );
  }

  function sortButton(key, label) {
    var active = state.sort === key;
    var arrow = active ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return h('th', { scope: 'col' },
      h('button', {
        type: 'button',
        class: active ? 'is-active' : '',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash();
          refreshDataViews();
        }
      }, label + arrow)
    );
  }

  function renderDeltaBadge(delta) {
    if (delta > 0) return h('span', { class: 'delta-up', text: '▲+' + delta, title: 'Outranks TVL position by ' + delta });
    if (delta < 0) return h('span', { class: 'delta-dn', text: '▼' + delta, title: 'Down ' + Math.abs(delta) + ' vs TVL rank' });
    return h('span', { class: 'delta-eq', text: '—' });
  }

  function renderBoardTable(list) {
    if (list.length === 0) {
      return h('div', { class: 'panel empty-box' },
        h('h2', { text: 'No protocol matches these filters' }),
        h('p', { text: 'Reset filters or broaden the chain / category selection.' }),
        h('button', {
          type: 'button',
          class: 'btn-reset',
          text: 'Reset all filters',
          onclick: resetAllFilters
        })
      );
    }

    var sorted = sortedRows(list);
    var maxVal = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var tbody = h('tbody');

    sorted.forEach(function (r) {
      var chgClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chainPreview = r.chains.length <= 3 ? r.chains.join(', ') : r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3);
      var pctW = Math.max(3, Math.round((r.implied_value_usd / maxVal) * 100));

      var tr = h('tr', {
        'data-slug': r.slug,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDrawer(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
      },
        h('td', { class: 'num' },
          h('div', { class: 'rank-cell' },
            h('strong', { text: '#' + r.rank }),
            renderDeltaBadge(r.rank_delta)
          )
        ),
        h('td', null,
          h('div', { class: 'proto-cell' },
            h('div', { class: 'proto-top' },
              h('b', { text: r.name }),
              h('span', { class: 'tier-tag ' + (r.tier === 'watchlist' ? 'wl' : 'early'), text: r.tier === 'watchlist' ? 'WATCHLIST' : 'EARLY' })
            ),
            h('div', { class: 'proto-sub', text: (r.category || 'Uncategorized') + ' · ' + chainPreview })
          )
        ),
        h('td', { class: 'num', text: fmtCompactUsd(r.tvl_usd) }),
        h('td', { class: 'num' },
          h('span', { class: r.change_7d === null ? 'badge' : 'badge ' + chgClass, text: fmtPct(r.change_7d) })
        ),
        h('td', { class: 'num', text: r.age_days === null ? 'unk (365d)' : r.age_days + 'd' }),
        h('td', { class: 'num', text: r.chains.length + ' (' + r.model.chain_multiplier.toFixed(2) + 'x)' }),
        h('td', null,
          h('div', { class: 'implied-cell' },
            h('div', { class: 'bar-track', 'aria-hidden': 'true' },
              h('span', { class: 'bar-fill', style: 'width:' + pctW + '%' })
            ),
            h('strong', { class: 'num', text: fmtCompactUsd(r.implied_value_usd) })
          )
        ),
        h('td', null,
          h('span', { class: 'badge', text: 'no token on record' })
        )
      );
      tbody.appendChild(tr);
    });

    return h('div', { class: 'panel table-wrap' },
      h('table', null,
        h('thead', null,
          h('tr', null,
            sortButton('rank', 'Rank'),
            sortButton('name', 'Protocol'),
            sortButton('tvl', 'TVL'),
            sortButton('growth', '7d Change'),
            sortButton('age', 'Age'),
            sortButton('chains', 'Chains'),
            sortButton('implied', 'Implied Value'),
            h('th', { scope: 'col', text: 'Record Status' })
          )
        ),
        tbody
      )
    );
  }

  function renderLiveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r, idx) {
      var chgClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chainStr = r.chains.length <= 3 ? r.chains.join(', ') : r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3);
      tbody.appendChild(
        h('tr', null,
          h('td', { class: 'num', text: 'L' + (idx + 1) }),
          h('td', null,
            h('div', { class: 'proto-cell' },
              h('div', { class: 'proto-top' },
                h('b', { text: r.name }),
                r.symbol ? h('span', { class: 'badge accent', text: r.symbol }) : null
              ),
              h('div', { class: 'proto-sub', text: (r.category || 'Uncategorized') + ' · ' + chainStr })
            )
          ),
          h('td', { class: 'num', text: fmtCompactUsd(r.tvl_usd) }),
          h('td', { class: 'num', text: fmtCompactUsd(r.mcap_usd) }),
          h('td', { class: 'num', text: r.mcap_to_tvl !== null ? r.mcap_to_tvl.toFixed(2) + 'x' : 'n/a' }),
          h('td', { class: 'num' },
            h('span', { class: r.change_7d === null ? 'badge' : 'badge ' + chgClass, text: fmtPct(r.change_7d) })
          ),
          h('td', null, h('span', { class: 'badge warn', text: 'already trades (excluded)' }))
        )
      );
    });

    return h('div', { class: 'panel table-wrap' },
      h('table', null,
        h('thead', null,
          h('tr', null,
            h('th', { scope: 'col', text: 'Live #' }),
            h('th', { scope: 'col', text: 'Protocol & Ticker' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: 'Market Cap' }),
            h('th', { scope: 'col', text: 'MCap / TVL' }),
            h('th', { scope: 'col', text: '7d Change' }),
            h('th', { scope: 'col', text: 'Status' })
          )
        ),
        tbody
      )
    );
  }

  var drawerBackdrop = h('div', {
    class: 'drawer-backdrop',
    id: 'drawer-backdrop',
    hidden: 'true',
    onclick: function (e) { if (e.target === drawerBackdrop) closeDrawer(); }
  });
  var drawerEl = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title' });
  drawerBackdrop.appendChild(drawerEl);

  function parseStepParts(raw) {
    var costIdx = raw.indexOf(' Cost: ');
    var timeIdx = raw.indexOf(' Time: ');
    var action = costIdx >= 0 ? raw.slice(0, costIdx) : raw;
    var cost = costIdx >= 0 && timeIdx > costIdx ? raw.slice(costIdx + 7, timeIdx).replace(/\.$/, '') : '';
    var time = timeIdx >= 0 ? raw.slice(timeIdx + 7).replace(/\.$/, '') : '';
    return { action: action, cost: cost, time: time };
  }

  function openDrawer(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();

    var check = computeImpliedValue(row, DATA.model);
    var deltaStr = row.rank_delta > 0 ? '▲+' + row.rank_delta + ' vs TVL' : row.rank_delta < 0 ? '▼' + row.rank_delta + ' vs TVL' : 'same as TVL';
    var gSign = row.model.growth_pct >= 0 ? 'upside 0.50x' : 'downside 1.00x';

    drawerEl.textContent = '';
    drawerEl.appendChild(
      h('div', { class: 'drawer-head' },
        h('div', null,
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' },
            h('span', { class: 'badge accent', text: 'Rank #' + row.rank + ' of ' + DATA.board_size }),
            h('span', { class: 'badge ' + (row.tier === 'watchlist' ? 'accent' : 'warn'), text: row.tier === 'watchlist' ? 'WATCHLIST' : 'EARLY RADAR' }),
            h('span', { class: 'badge', text: 'TVL #' + row.tvl_rank + ' (' + deltaStr + ')' })
          ),
          h('h2', { id: 'drawer-title', text: row.name }),
          h('div', { class: 'proto-sub', text: 'slug: ' + row.slug + ' · category: ' + (row.category || 'Uncategorized') }),
          h('div', { class: 'chain-pills' },
            row.chains.map(function (c) { return h('span', { class: 'chain-pill', text: c }); })
          )
        ),
        h('button', { type: 'button', class: 'close-btn', text: 'Close', onclick: closeDrawer })
      )
    );

    drawerEl.appendChild(
      h('section', null,
        h('h3', { style: 'font-size:13px;margin-bottom:8px;color:var(--muted);font-family:var(--font-mono)', text: 'MODEL V2 DECOMPOSITION (COMPUTEIMPLIEDVALUE)' }),
        h('div', { class: 'decomp-box' },
          h('div', { class: 'decomp-row' }, h('span', { text: '1. Base Anchor (TVL × 0.25)' }), h('b', { text: fmtExactUsd(row.tvl_usd) + ' × 0.25 = ' + fmtExactUsd(check.base) })),
          h('div', { class: 'decomp-row' }, h('span', { text: '2. Asymmetric 7d Growth (' + gSign + ')' }), h('b', { text: fmtPct(row.change_7d) + ' -> ' + check.growthMult.toFixed(4) + 'x' })),
          h('div', { class: 'decomp-row' }, h('span', { text: '3. Maturity (' + (row.listed_at || 'unlisted') + ')' }), h('b', { text: fmtAge(row.age_days, row.age_days === null) + ' -> ' + check.maturityMult.toFixed(4) + 'x' })),
          h('div', { class: 'decomp-row' }, h('span', { text: '4. Multi-Chain Reach (' + check.chainCount + ' chains, cap 6)' }), h('b', { text: check.chainMult.toFixed(4) + 'x' })),
          h('div', { class: 'decomp-row decomp-total' },
            h('span', { text: 'Implied Value (live JS verification)' }),
            h('b', { text: fmtExactUsd(check.implied) + (check.implied === row.implied_value_usd ? ' ✓ matches board.json' : ' (mismatch)') })
          )
        )
      )
    );

    drawerEl.appendChild(
      h('section', null,
        h('h3', { style: 'font-size:13px;margin-bottom:8px;color:var(--muted);font-family:var(--font-mono)', text: 'ACTIONABLE FARM PLAN (NO TOKEN ON RECORD)' }),
        h('ol', { class: 'steps-list' },
          row.farm_steps.map(function (rawStep, i) {
            var parts = parseStepParts(rawStep);
            var isDisc = rawStep.indexOf('records no token') >= 0;
            return h('li', { class: 'step-card' + (isDisc ? ' is-disclosure' : '') },
              h('div', { class: 'step-head' },
                h('span', { class: 'step-num', text: 'STEP 0' + (i + 1) }),
                h('div', { class: 'step-tags' },
                  parts.cost ? h('span', { class: 'badge warn', text: 'Cost: ' + parts.cost }) : null,
                  parts.time ? h('span', { class: 'badge accent', text: 'Time: ' + parts.time }) : null
                )
              ),
              h('div', { class: 'step-body', text: parts.action })
            );
          })
        )
      )
    );

    drawerBackdrop.removeAttribute('hidden');
    var rowsDom = document.querySelectorAll('tbody tr[data-slug]');
    for (var i = 0; i < rowsDom.length; i++) {
      rowsDom[i].setAttribute('data-selected', rowsDom[i].getAttribute('data-slug') === slug ? 'true' : 'false');
    }
  }

  function closeDrawer() {
    state.selected = null;
    writeHash();
    drawerBackdrop.setAttribute('hidden', 'true');
    var rowsDom = document.querySelectorAll('tbody tr[data-selected="true"]');
    for (var i = 0; i < rowsDom.length; i++) rowsDom[i].setAttribute('data-selected', 'false');
  }

  function resetAllFilters() {
    state.tier = 'all';
    state.category = 'all';
    state.chain = 'all';
    state.q = '';
    state.sort = 'implied';
    state.dir = -1;
    writeHash();
    mountApp();
  }

  var controlsWrap, dynamicArea;

  function renderControls() {
    var cats = allCategories();
    var chains = allChainsByFreq();

    var tabBoard = h('button', {
      type: 'button',
      'aria-pressed': state.tab === 'board' ? 'true' : 'false',
      text: 'Board (' + DATA.board_size + ')',
      onclick: function () { state.tab = 'board'; writeHash(); mountApp(); }
    });
    var tabLive = h('button', {
      type: 'button',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Live Tokens (' + DATA.live_size + ')',
      onclick: function () { state.tab = 'live'; writeHash(); mountApp(); }
    });

    var tierAll = h('button', { type: 'button', 'aria-pressed': state.tier === 'all' ? 'true' : 'false', text: 'All (' + DATA.board_size + ')', onclick: function () { state.tier = 'all'; writeHash(); mountApp(); } });
    var tierWl = h('button', { type: 'button', 'aria-pressed': state.tier === 'watchlist' ? 'true' : 'false', text: 'Watchlist (' + DATA.watchlist_size + ')', onclick: function () { state.tier = 'watchlist'; writeHash(); mountApp(); } });
    var tierEarly = h('button', { type: 'button', 'aria-pressed': state.tier === 'early' ? 'true' : 'false', text: 'Early <$50M (' + DATA.early_size + ')', onclick: function () { state.tier = 'early'; writeHash(); mountApp(); } });

    var catSel = h('select', { id: 'f-cat', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return h('option', { value: c, text: c, selected: state.category === c ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); refreshDataViews(); });

    var chainSel = h('select', { id: 'f-chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); refreshDataViews(); });

    var searchBox = h('input', {
      type: 'search',
      id: 'f-search',
      placeholder: 'Search protocol or chain',
      value: state.q,
      'aria-label': 'Search protocols'
    });
    searchBox.addEventListener('input', function () {
      state.q = searchBox.value;
      writeHash();
      refreshDataViews();
    });

    var counter = h('span', { class: 'row-counter', id: 'row-counter', text: '' });

    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { text: 'View' }), h('div', { class: 'tabs' }, tabBoard, tabLive)),
      state.tab === 'board' ? h('div', { class: 'field' }, h('label', { text: 'Universe Tier' }), h('div', { class: 'tabs tier' }, tierAll, tierWl, tierEarly)) : null,
      state.tab === 'board' ? h('div', { class: 'field' }, h('label', { for: 'f-cat', text: 'Category' }), catSel) : null,
      state.tab === 'board' ? h('div', { class: 'field' }, h('label', { for: 'f-chain', text: 'Chain' }), chainSel) : null,
      state.tab === 'board' ? h('div', { class: 'field' }, h('label', { for: 'f-search', text: 'Search' }), searchBox) : null,
      state.tab === 'board' ? h('button', { type: 'button', class: 'btn-reset', text: 'Reset', onclick: resetAllFilters }) : null,
      counter
    );
  }

  function refreshDataViews() {
    var current = filteredRows();
    var counter = document.getElementById('row-counter');
    if (counter) {
      counter.textContent = state.tab === 'board'
        ? current.length + ' / ' + DATA.board_size + ' rows'
        : DATA.live_size + ' live (separated)';
    }

    var chartCard = document.getElementById('sector-chart-card');
    if (chartCard && state.tab === 'board') {
      var oldChart = chartCard.querySelector('.html-chart');
      if (oldChart) chartCard.replaceChild(buildSectorHtml(current), oldChart);
      var scopeBadge = document.getElementById('chart-scope-badge');
      if (scopeBadge) scopeBadge.textContent = current.length + ' protocols';
    }

    if (dynamicArea) {
      dynamicArea.textContent = '';
      dynamicArea.appendChild(state.tab === 'board' ? renderBoardTable(current) : renderLiveTable());
    }
  }

  function mountApp() {
    root.textContent = '';
    var current = filteredRows();
    root.appendChild(renderHeader());
    root.appendChild(renderHero());
    if (state.tab === 'board') root.appendChild(renderIntelRow(current));
    controlsWrap = renderControls();
    dynamicArea = h('div', { id: 'table-stage' });
    root.appendChild(controlsWrap);
    root.appendChild(dynamicArea);
    if (!drawerBackdrop.isConnected) document.body.appendChild(drawerBackdrop);
    refreshDataViews();
    root.setAttribute('aria-busy', 'false');
    if (state.selected) openDrawer(state.selected);
  }

  readHash();
  mountApp();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawerBackdrop.hasAttribute('hidden')) closeDrawer();
  });
})();
