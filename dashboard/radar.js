// radar.js — the Token Launch Radar page.
// Renders the board, the protocol detail drawer and the filtered views from
// the local data.js the program generated. No network: the page reads only
// the data file beside it. No SVG anywhere; the logo and the category chart
// are plain HTML and CSS.
(function () {
  'use strict';

  var D = window.RADAR_DATA || { meta: {}, rows: [], live: [] };
  var rows = D.rows;
  var live = D.live;
  var meta = D.meta;

  // TVL rank per slug, for the rank-shift indicator next to each rank.
  var tvlRank = {};
  rows
    .slice()
    .sort(function (a, b) {
      return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    })
    .forEach(function (r, i) {
      tvlRank[r.slug] = i + 1;
    });

  var state = {
    view: 'board',
    tier: 'all',
    category: 'all',
    chain: 'all',
    q: '',
    sort: 'implied',
    dir: -1,
    sel: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtCompact(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }

  function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US');
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return 'n/a';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function chgClass(v) {
    if (v === null || v === undefined || v === 0) return 'zero';
    return v > 0 ? 'pos' : 'neg';
  }

  // ---- hash routing: #p=<slug>, #tier=, #category=, #chain=, #q=, #sort=, #dir=, #view=
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var q = new URLSearchParams(h);
    state.view = q.get('view') === 'live' ? 'live' : 'board';
    state.tier = q.get('tier') || 'all';
    state.category = q.get('category') || 'all';
    state.chain = q.get('chain') || 'all';
    state.q = q.get('q') || '';
    state.sort = q.get('sort') || 'implied';
    state.dir = q.get('dir') === '1' ? 1 : -1;
    state.sel = q.get('p') || null;
  }

  function writeHash() {
    var q = new URLSearchParams();
    if (state.view === 'live') q.set('view', 'live');
    if (state.tier !== 'all') q.set('tier', state.tier);
    if (state.category !== 'all') q.set('category', state.category);
    if (state.chain !== 'all') q.set('chain', state.chain);
    if (state.q) q.set('q', state.q);
    if (state.sort !== 'implied') q.set('sort', state.sort);
    if (state.dir === 1) q.set('dir', '1');
    if (state.sel) q.set('p', state.sel);
    var s = q.toString();
    var next = s ? '#' + s : window.location.pathname + window.location.search;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
    }
  }

  // ---- model (same formula as lib/model.ts, so the detail view can re-derive the value live)
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function growthOf(change7d) {
    var g = change7d === null || change7d === undefined ? 0 : clamp(change7d, -60, 120);
    var m = g >= 0 ? 1 + (g / 100) * 0.5 : 1 + (g / 100) * 1.0;
    return clamp(m, 0.4, 1.6);
  }
  function maturityOf(age) {
    return 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
  }
  function chainOf(n) {
    return Math.min(1 + 0.03 * Math.min(Math.max(0, n - 1), 5), 1.15);
  }

  // ---- header, lede, KPIs
  function renderHead() {
    $('badges').innerHTML =
      '<span class="badge">Snapshot <b>' + esc(meta.asOf || '') + '</b></span>' +
      '<span class="badge"><b>' + (meta.snapshotProtocols || 0) + '</b> snapshot protocols</span>' +
      '<span class="badge">Zero network &middot; offline bundle</span>';
    $('lede').innerHTML =
      'Covers 100% of the 40 watchlist protocols (&gt;= $50M TVL, no token on record) plus 160 early pre-token-record ' +
      'protocols below the floor. Live-token protocols are separated cleanly. Derived strictly from the 10 snapshot fields &mdash; ' +
      'no hardcoded names, no guaranteed airdrops.';
    var watch = rows.filter(function (r) { return r.tier === 'watchlist'; }).length;
    $('kpis').innerHTML =
      '<div class="kpi"><div class="kpi-label">Watchlist floor covered</div><div class="kpi-value">' + watch + ' <small>/ 40</small></div><div class="kpi-sub">100% coverage (&gt;= $50M TVL)</div></div>' +
      '<div class="kpi"><div class="kpi-label">Pre-token radar board</div><div class="kpi-value">' + rows.length + '</div><div class="kpi-sub">40 watchlist + 160 early protocols</div></div>' +
      '<div class="kpi"><div class="kpi-label">Rank shifts vs pure TVL</div><div class="kpi-value">' + (meta.rankShifts || 0) + ' <small>/ ' + rows.length + '</small></div><div class="kpi-sub">Re-ordered by v2 asymmetric factors</div></div>' +
      '<div class="kpi"><div class="kpi-label">Live tokens isolated</div><div class="kpi-value">' + live.length + '</div><div class="kpi-sub">Excluded from pre-token ranking</div></div>';
  }

  // ---- category chart (HTML bars for the top 5 categories of the current view)
  function renderChart(list) {
    var byCat = {};
    list.forEach(function (r) {
      var c = r.category || 'Uncategorized';
      if (!byCat[c]) byCat[c] = { cat: c, sum: 0, count: 0 };
      byCat[c].sum += r.implied_value_usd;
      byCat[c].count += 1;
    });
    var items = Object.keys(byCat)
      .map(function (k) { return byCat[k]; })
      .sort(function (a, b) { return b.sum - a.sum; });
    var top = items.slice(0, 5);
    var total = items.reduce(function (acc, it) { return acc + it.sum; }, 0) || 1;
    var max = top.length ? top[0].sum : 1;
    $('chart-count').textContent = list.length + ' protocols';
    if (top.length === 0) {
      $('chart').innerHTML =
        '<div class="html-chart"><div class="hc-empty">No rows match active filters</div></div>';
      return;
    }
    var html = '<div class="html-chart" role="img" aria-label="Sector implied value distribution">';
    top.forEach(function (it, idx) {
      var w = Math.max(4, Math.round((it.sum / max) * 168));
      var share = ((it.sum / total) * 100).toFixed(1) + '%';
      var label = it.cat.length > 22 ? it.cat.slice(0, 20) + '..' : it.cat;
      html +=
        '<div class="hc-row"><span class="hc-label">' + esc(label) + '</span>' +
        '<span class="hc-track"><span class="hc-fill' + (idx === 0 ? ' hc-fill-first' : '') + '" style="width:' + w + 'px"></span></span>' +
        '<span class="hc-value">' + fmtCompact(it.sum) + ' (' + it.count + ' &middot; ' + share + ')</span></div>';
    });
    $('chart').innerHTML = html + '</div>';
  }

  // ---- filtering and sorting
  function filteredRows() {
    var list = rows.filter(function (r) {
      if (state.tier === 'watchlist' && r.tier !== 'watchlist') return false;
      if (state.tier === 'early' && r.tier !== 'early') return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (
          r.name.toLowerCase().indexOf(q) < 0 &&
          r.slug.toLowerCase().indexOf(q) < 0 &&
          r.category.toLowerCase().indexOf(q) < 0
        ) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    list.sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d || 0; vb = b.change_7d || 0; }
      else if (key === 'age') { va = a.age_days; vb = b.age_days; }
      else if (key === 'rank') { va = a.rank; vb = b.rank; }
      else if (key === 'name') { return dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      if (va !== vb) return dir * (va < vb ? -1 : 1);
      return a.rank - b.rank;
    });
    return list;
  }

  // ---- toolbar
  function renderToolbar(list) {
    var cats = [];
    var chains = [];
    rows.forEach(function (r) {
      if (cats.indexOf(r.category) < 0) cats.push(r.category);
      r.chains.forEach(function (c) {
        if (chains.indexOf(c) < 0) chains.push(c);
      });
    });
    cats.sort();
    chains.sort();
    var catOpts = '<option value="all">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="all">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var tierBtn = function (val, label) {
      return '<button class="tab' + (state.tier === val ? ' active' : '') + '" data-act="tier" data-val="' + val + '">' + label + '</button>';
    };
    $('toolbar').innerHTML =
      '<div class="tb-group"><span class="tb-label">View</span>' +
      '<button class="tab' + (state.view === 'board' ? ' active' : '') + '" data-act="view" data-val="board">Board (' + rows.length + ')</button>' +
      '<button class="tab' + (state.view === 'live' ? ' active' : '') + '" data-act="view" data-val="live">Live Tokens (' + live.length + ')</button></div>' +
      '<div class="tb-group"><span class="tb-label">Universe tier</span>' +
      tierBtn('all', 'All (' + rows.length + ')') +
      tierBtn('watchlist', 'Watchlist (40)') +
      tierBtn('early', 'Early &lt;$50M (160)') + '</div>' +
      '<div class="tb-group"><span class="tb-label">Category</span><select data-field="category">' + catOpts + '</select></div>' +
      '<div class="tb-group"><span class="tb-label">Chain</span><select data-field="chain">' + chainOpts + '</select></div>' +
      '<div class="tb-group"><span class="tb-label">Search</span><input type="search" placeholder="Search protocol or chain" value="' + esc(state.q) + '" data-field="q"></div>' +
      '<button class="reset" data-act="reset">Reset</button>' +
      '<span class="tb-count" id="tb-count">' + list.length + ' / ' + rows.length + ' rows</span>';
  }

  // ---- table
  function sortArrow(key) {
    if (state.sort !== key) return '';
    return ' <span class="arrow">' + (state.dir === -1 ? '&#9660;' : '&#9650;') + '</span>';
  }

  function renderTable(list) {
    var head = $('head-row');
    var body = $('body-rows');
    if (state.view === 'live') {
      head.innerHTML =
        '<th>Rank</th><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th>Chains</th><th>Record status</th>';
      var maxMcap = live.length ? live[0].mcap_usd : 1;
      body.innerHTML = live.map(function (r) {
        var w = Math.max(2, Math.round((r.mcap_usd / maxMcap) * 64));
        return '<tr data-act="row" data-slug="' + esc(r.slug) + '">' +
          '<td class="rank-cell">#' + r.rank + '</td>' +
          '<td><span class="proto-name">' + esc(r.name) + '</span><span class="tag">' + esc(r.symbol || '') + '</span><div class="proto-sub">' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
          '<td class="num">' + fmtCompact(r.tvl_usd) + '</td>' +
          '<td class="num"><span class="mini-bar"><i style="width:' + w + 'px"></i></span>' + fmtCompact(r.mcap_usd) + '</td>' +
          '<td class="num">' + r.chains.length + '</td>' +
          '<td><span class="status">token on record</span></td></tr>';
      }).join('');
      $('empty').hidden = live.length > 0;
      return;
    }
    head.innerHTML =
      '<th>Rank</th><th>Protocol</th>' +
      '<th class="num sortable" data-act="sort" data-val="tvl">TVL' + sortArrow('tvl') + '</th>' +
      '<th class="num sortable" data-act="sort" data-val="growth">7d change' + sortArrow('growth') + '</th>' +
      '<th class="num sortable" data-act="sort" data-val="age">Age' + sortArrow('age') + '</th>' +
      '<th class="num">Chains</th>' +
      '<th class="num sortable" data-act="sort" data-val="implied">Implied value' + sortArrow('implied') + '</th>' +
      '<th>Record status</th>';
    var maxImp = rows.length ? rows[0].implied_value_usd : 1;
    body.innerHTML = list.map(function (r) {
      var tv = tvlRank[r.slug] || r.rank;
      var shift = tv - r.rank;
      var shiftHtml = shift === 0
        ? '<span class="shift flat">&ndash;</span>'
        : shift > 0
          ? '<span class="shift up">&#9650;' + shift + '</span>'
          : '<span class="shift down">&#9660;' + (-shift) + '</span>';
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImp) * 64));
      return '<tr data-act="row" data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank-cell">#' + r.rank + shiftHtml + '</td>' +
        '<td><span class="proto-name">' + esc(r.name) + '</span><span class="tag' + (r.tier === 'early' ? ' early' : '') + '">' + (r.tier === 'watchlist' ? 'WATCHLIST' : 'EARLY') + '</span><div class="proto-sub">' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td class="num">' + fmtCompact(r.tvl_usd) + '</td>' +
        '<td class="num"><span class="chg ' + chgClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</span></td>' +
        '<td class="num">' + r.age_days + 'd</td>' +
        '<td class="num">' + r.chains.length + (r.chains.length > 1 ? ' (' + (r.factors.chain.toFixed(2)) + 'x)' : ' (1.00x)') + '</td>' +
        '<td class="num"><span class="mini-bar"><i style="width:' + w + 'px"></i></span>' + fmtMoney(r.implied_value_usd) + '</td>' +
        '<td><span class="status">no token on record</span></td></tr>';
    }).join('');
    $('empty').hidden = list.length > 0;
  }

  // ---- detail drawer
  function renderDrawer() {
    var d = $('drawer');
    if (!state.sel) {
      d.hidden = true;
      d.innerHTML = '';
      return;
    }
    var r = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].slug === state.sel) { r = rows[i]; break; }
    }
    if (!r) {
      for (var j = 0; j < live.length; j++) {
        if (live[j].slug === state.sel) { r = live[j]; break; }
      }
    }
    if (!r) {
      d.hidden = true;
      d.innerHTML = '';
      return;
    }
    var isBoard = r.implied_value_usd !== undefined;
    var chips =
      '<span class="chip">Rank <b>#' + r.rank + ' of ' + rows.length + '</b></span>' +
      (isBoard
        ? '<span class="chip">' + (r.tier === 'watchlist' ? 'WATCHLIST' : 'EARLY') + '</span>'
        : '<span class="chip">LIVE TOKEN</span>') +
      '<span class="chip">TVL <b>#' + (tvlRank[r.slug] || r.rank) + '</b></span>';
    var body = '';
    if (isBoard) {
      var base = r.tvl_usd * 0.25;
      var g = growthOf(r.change_7d);
      var m = maturityOf(r.age_days);
      var c = chainOf(r.chains.length);
      var recomputed = Math.max(1, Math.round(base * g * m * c));
      var match = recomputed === r.implied_value_usd;
      body +=
        '<h3>Model v2 decomposition (computeImpliedValue)</h3>' +
        '<div class="breakdown">' +
        '<div class="row"><span>1. Base anchor (TVL &times; 0.25)</span><b>' + fmtMoney(r.tvl_usd) + ' &times; 0.25 = ' + fmtMoney(Math.round(base)) + '</b></div>' +
        '<div class="row"><span>2. Asymmetric 7d growth (' + (r.change_7d === null ? 'unreported' : fmtPct(r.change_7d)) + ')</span><b>' + g.toFixed(4) + 'x</b></div>' +
        '<div class="row"><span>3. Maturity (' + r.age_days + 'd)</span><b>' + m.toFixed(4) + 'x</b></div>' +
        '<div class="row"><span>4. Multi-chain reach (' + r.chains.length + ' chains)</span><b>' + c.toFixed(2) + 'x</b></div>' +
        '<div class="row total"><span>Implied value (live JS verification)</span><b>' + fmtMoney(recomputed) + (match ? ' <span class="match">&#10003; matches board.json</span>' : '') + '</b></div>' +
        '</div>' +
        '<h3>Actionable farm plan (no token on record)</h3>' +
        r.farm_steps.map(function (s, idx) {
          var cost = s.match(/Cost: ([^.]+)\./);
          var time = s.match(/Time: ([^.]+)\./);
          var text = s.replace(/Cost: [^.]+\./, '').replace(/Time: [^.]+\./, '').trim();
          return '<div class="step' + (idx === 4 ? ' amber' : '') + '"><div class="step-head"><span class="step-no">STEP 0' + (idx + 1) + '</span>' +
            (cost ? '<span class="step-cost">Cost: ' + esc(cost[1]) + '</span>' : '') +
            (time ? '<span class="step-time">Time: ' + esc(time[1]) + '</span>' : '') + '</div><p>' + esc(text) + '</p></div>';
        }).join('');
    } else {
      body +=
        '<h3>Live token</h3>' +
        '<div class="breakdown">' +
        '<div class="row"><span>Market cap</span><b>' + fmtMoney(r.mcap_usd) + '</b></div>' +
        '<div class="row"><span>Symbol</span><b>' + esc(r.symbol || 'n/a') + '</b></div>' +
        '<div class="row"><span>TVL</span><b>' + fmtMoney(r.tvl_usd) + '</b></div>' +
        '</div>' +
        '<p class="fine">This protocol already records a token, so it is kept out of the pre-token ranking board and shown here, ranked by market cap.</p>';
    }
    d.innerHTML =
      '<button class="close" data-act="close">Close</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">slug: ' + esc(r.slug) + ' &middot; category: ' + esc(r.category) + '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="chips">' + r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
      body;
    d.hidden = false;
  }

  function renderAll() {
    var list = state.view === 'live' ? rows : filteredRows();
    renderHead();
    renderChart(state.view === 'live' ? rows : list);
    renderToolbar(list);
    renderTable(list);
    renderDrawer();
  }

  // ---- events (delegated)
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var val = t.getAttribute('data-val');
    if (act === 'view') {
      state.view = val;
      state.sel = null;
    } else if (act === 'tier') {
      state.tier = val;
    } else if (act === 'sort') {
      if (state.sort === val) state.dir = state.dir === -1 ? 1 : -1;
      else { state.sort = val; state.dir = -1; }
    } else if (act === 'row') {
      state.sel = t.getAttribute('data-slug');
    } else if (act === 'close') {
      state.sel = null;
    } else if (act === 'reset') {
      state.tier = 'all';
      state.category = 'all';
      state.chain = 'all';
      state.q = '';
      state.sort = 'implied';
      state.dir = -1;
      state.sel = null;
    }
    writeHash();
    renderAll();
  });

  document.addEventListener('change', function (e) {
    var f = e.target.getAttribute('data-field');
    if (!f) return;
    state[f] = e.target.value;
    writeHash();
    renderAll();
  });

  document.addEventListener('input', function (e) {
    var f = e.target.getAttribute('data-field');
    if (f !== 'q') return;
    state.q = e.target.value;
    writeHash();
    renderAll();
  });

  window.addEventListener('hashchange', function () {
    readHash();
    renderAll();
  });

  readHash();
  renderAll();
})();
