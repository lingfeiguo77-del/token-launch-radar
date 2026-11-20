'use strict';
// Dashboard logic for the token launch radar. Reads window.RADAR_DATA only.
// The implied-value check below mirrors the model formula so a reader can
// see the page recompute the same figure the program produced.
var DATA = window.RADAR_DATA || { meta: {}, rows: [], live: [] };
var state = { view: 'board', tier: 'all', category: 'all', chain: 'all', query: '', sort: 'implied', dir: -1 };

function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function recompute(row) {
  var g = clampN(row.change_7d === null ? 0 : row.change_7d, -60, 120);
  var growth = 1 + (g / 100) * (g >= 0 ? 0.55 : 1.1);
  var maturity = 0.55 + (Math.min(row.age_days, 1095) / 1095) * 0.45;
  var chain = 1 + 0.03 * Math.min(Math.max(0, row.chains.length - 1), 6);
  return Math.round(Math.sqrt(row.tvl_usd) * 5000 * growth * maturity * chain);
}
function money(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v;
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function el(id) { return document.getElementById(id); }

function renderBadges() {
  var m = DATA.meta;
  el('badges').innerHTML = '<span>Snapshot ' + esc(m.as_of || '') + '</span><span>' + m.total_protocols + ' snapshot protocols</span><span>Zero network - Offline bundle</span>';
  el('cards').innerHTML =
    '<div class="card"><div class="k">WATCHLIST COVERED</div><div class="v">' + m.watchlist_size + ' / ' + m.watchlist_size + '</div><div class="s">100% floor coverage</div></div>' +
    '<div class="card"><div class="k">PRE-TOKEN RADAR BOARD</div><div class="v">' + m.board_rows + '</div><div class="s">' + m.watchlist_size + ' watchlist + ' + m.early_size + ' early</div></div>' +
    '<div class="card amber"><div class="k">RANK SHIFTS VS PURE TVL</div><div class="v">' + m.rank_shifts + ' / ' + m.board_rows + '</div><div class="s">Avg shift ' + m.avg_rank_shift + ' - max ' + m.max_rank_shift + ' - ' + m.early_in_top40 + ' early in Top 40</div></div>' +
    '<div class="card"><div class="k">LIVE TOKENS ISOLATED</div><div class="v">' + m.live_size + '</div><div class="s">Excluded from pre-token ranking</div></div>';
}

function filteredRows() {
  var q = state.query.toLowerCase();
  var rows = DATA.rows.filter(function (r) {
    if (state.tier !== 'all' && r.tier !== state.tier) return false;
    if (state.category !== 'all' && r.category !== state.category) return false;
    if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
    if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var key = { rank: 'rank', tvl: 'tvl_usd', growth: 'change_7d', age: 'age_days', implied: 'implied_value_usd' }[state.sort] || 'implied_value_usd';
  rows.sort(function (a, b) {
    var av = a[key] === null ? -1e18 : a[key];
    var bv = b[key] === null ? -1e18 : b[key];
    return (av - bv) * state.dir;
  });
  return rows;
}

function renderCats(rows) {
  var byCat = {};
  rows.forEach(function (r) {
    if (!byCat[r.category]) byCat[r.category] = { w: 0, e: 0, n: 0 };
    byCat[r.category][r.tier === 'watchlist' ? 'w' : 'e'] += r.implied_value_usd;
    byCat[r.category].n += 1;
  });
  var cats = Object.keys(byCat).sort(function (a, b) { return (byCat[b].w + byCat[b].e) - (byCat[a].w + byCat[a].e); }).slice(0, 7);
  var max = cats.length ? byCat[cats[0]].w + byCat[cats[0]].e : 1;
  el('catScope').textContent = rows.length + ' protocols';
  el('catChart').innerHTML = cats.map(function (c) {
    var d = byCat[c]; var tot = d.w + d.e;
    return '<div class="catrow"><span>' + esc(c) + '</span><span class="bar"><span class="w" style="width:' + (d.w / max * 100) + '%"></span><span class="e" style="width:' + (d.e / max * 100) + '%"></span></span><span>' + money(tot) + ' (' + d.n + ')</span></div>';
  }).join('');
}

function renderBoard() {
  var rows = filteredRows();
  var maxImp = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
  el('showing').textContent = 'Showing ' + rows.length + ' / ' + DATA.rows.length + ' protocols';
  el('tbody').innerHTML = rows.map(function (r) {
    var shift = r.rank_shift > 0 ? '<span class="up">+' + r.rank_shift + '</span>' : r.rank_shift < 0 ? '<span class="down">' + r.rank_shift + '</span>' : '=';
    var chg = r.change_7d === null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%';
    var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
    var farm = r.farm_steps[1] || '';
    var cap = (farm.match(/\$[0-9,]+/) || [''])[0];
    return '<tr class="row" data-slug="' + esc(r.slug) + '"><td>#' + r.rank + ' ' + shift + '</td>' +
      '<td><strong>' + esc(r.name) + '</strong> <span class="pill ' + (r.tier === 'watchlist' ? 'w' : '') + '">' + r.tier.toUpperCase() + '</span> ' + esc(cap) + ' - ' + r.farm_steps.length + ' steps<br><span class="dim">' + esc(r.category) + ' - ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
      '<td>' + money(r.tvl_usd) + '<br><span class="dim">TVL #' + r.tvl_rank + '</span></td>' +
      '<td class="' + cls + '">' + chg + '</td><td>' + r.age_days + 'd</td>' +
      '<td>' + r.chains.length + ' (' + r.factors.chain_multiplier.toFixed(2) + 'x)</td>' +
      '<td><span class="mbar"><i style="width:' + Math.max(2, r.implied_value_usd / maxImp * 100) + '%"></i></span>' + money(r.implied_value_usd) + '</td>' +
      '<td><span class="pill">no token on record</span></td></tr>';
  }).join('');
  var trs = el('tbody').querySelectorAll('tr.row');
  for (var i = 0; i < trs.length; i++) {
    trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug')); });
  }
  renderCats(rows);
}

function renderLive() {
  el('liveWrap').innerHTML = '<table><thead><tr><th>Rank</th><th>Protocol</th><th>Symbol</th><th>Market Cap</th><th>TVL</th><th>Chains</th></tr></thead><tbody>' +
    DATA.live.map(function (r) { return '<tr><td>#' + r.rank + '</td><td><strong>' + esc(r.name) + '</strong><br><span class="dim">' + esc(r.category) + '</span></td><td>' + esc(r.symbol || '') + '</td><td>' + money(r.mcap_usd) + '</td><td>' + money(r.tvl_usd) + '</td><td>' + r.chains.length + '</td></tr>'; }).join('') + '</tbody></table>';
}

function factorBar(label, value, max, text, neg) {
  var pct = clampN(Math.abs(value) / max * 100, 2, 100);
  return '<div class="frow"><div class="lab"><span>' + label + '</span><span>' + text + '</span></div><div class="fbar' + (neg ? ' neg' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
}

function openDetail(slug) {
  var r = null;
  DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
  if (!r) return;
  var f = r.factors;
  var check = recompute(r);
  var html = '<h3>#' + r.rank + ' ' + esc(r.name) + '</h3><p class="dim">' + esc(r.category) + ' - ' + esc(r.chains.join(', ')) + ' - tier ' + r.tier + '</p>' +
    '<p>TVL ' + money(r.tvl_usd) + ' (TVL rank #' + r.tvl_rank + ', shift ' + (r.rank_shift > 0 ? '+' : '') + r.rank_shift + ') - 7d ' + (r.change_7d === null ? 'n/a' : r.change_7d.toFixed(2) + '%') + ' - age ' + r.age_days + 'd</p>' +
    factorBar('Base anchor sqrt(TVL)*5000', f.base_anchor_usd, 270000000, money(f.base_anchor_usd), false) +
    factorBar('Growth multiplier', f.growth_multiplier, 1.7, f.growth_multiplier.toFixed(4) + 'x (input ' + f.growth_input + '%)', f.growth_multiplier < 1) +
    factorBar('Maturity multiplier', f.maturity_multiplier, 1, f.maturity_multiplier.toFixed(4) + 'x (' + f.age_days + 'd)', false) +
    factorBar('Chain multiplier', f.chain_multiplier, 1.2, f.chain_multiplier.toFixed(2) + 'x (' + r.chains.length + ' chains)', false) +
    '<p><strong>Implied value: ' + money(r.implied_value_usd) + '</strong> - page recompute ' + money(check) + (check === r.implied_value_usd ? ' (match)' : ' (differs)') + '</p><h4>Farm plan (' + r.farm_steps.length + ' steps)</h4>' +
    r.farm_steps.map(function (s, i) { return '<div class="step"><b>STEP ' + (i + 1) + '</b><br>' + esc(s) + '</div>'; }).join('');
  el('drawerBody').innerHTML = html;
  el('drawer').hidden = false;
}

function fillSelects() {
  var cats = {}, chains = {};
  DATA.rows.forEach(function (r) { cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  el('catSel').innerHTML = '<option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  el('chainSel').innerHTML = '<option value="all">All chains</option>' + Object.keys(chains).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
}

function applyHash() {
  var h = location.hash.replace(/^#/, '');
  if (!h) return;
  h.split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv[0] === 'chain') { state.chain = decodeURIComponent(kv[1] || 'all'); el('chainSel').value = state.chain; }
    if (kv[0] === 'sort') { state.sort = kv[1]; state.dir = kv[1] === 'rank' ? 1 : -1; }
    if (kv[0] === 'tier') state.tier = kv[1];
    if (kv[0] === 'p') setTimeout(function () { openDetail(decodeURIComponent(kv[1])); }, 60);
  });
}

function bind() {
  el('viewBoard').addEventListener('click', function () { state.view = 'board'; el('boardTable').hidden = false; el('liveWrap').hidden = true; this.classList.add('on'); el('viewLive').classList.remove('on'); });
  el('viewLive').addEventListener('click', function () { state.view = 'live'; el('boardTable').hidden = true; el('liveWrap').hidden = false; this.classList.add('on'); el('viewBoard').classList.remove('on'); renderLive(); });
  var tiers = document.querySelectorAll('.tier');
  for (var i = 0; i < tiers.length; i++) tiers[i].addEventListener('click', function () { state.tier = this.getAttribute('data-tier'); for (var j = 0; j < tiers.length; j++) tiers[j].classList.remove('on'); this.classList.add('on'); renderBoard(); });
  el('catSel').addEventListener('change', function () { state.category = this.value; renderBoard(); });
  el('chainSel').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  el('q').addEventListener('input', function () { state.query = this.value; renderBoard(); });
  el('reset').addEventListener('click', function () { state = { view: 'board', tier: 'all', category: 'all', chain: 'all', query: '', sort: 'implied', dir: -1 }; el('q').value = ''; el('catSel').value = 'all'; el('chainSel').value = 'all'; renderBoard(); });
  el('drawerClose').addEventListener('click', function () { el('drawer').hidden = true; });
  var ths = document.querySelectorAll('th[data-sort]');
  for (var k = 0; k < ths.length; k++) ths[k].addEventListener('click', function () { var s = this.getAttribute('data-sort'); if (state.sort === s) state.dir *= -1; else { state.sort = s; state.dir = s === 'rank' ? 1 : -1; } renderBoard(); });
}

renderBadges();
fillSelects();
bind();
applyHash();
renderBoard();
