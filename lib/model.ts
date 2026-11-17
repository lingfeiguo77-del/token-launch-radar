// lib/model.ts — value model v2 for the token launch radar.
//
// The model turns the snapshot's own figures into one number per protocol:
// an implied value for the token the protocol may one day issue, in whole
// dollars. Nothing is hardcoded by name: one function scores every protocol,
// and the formula and its constants are printed on the page itself.
//
//   implied = max(1, round(tvl_usd * 0.25 * growthMult * maturityMult * chainMult))
//
// growthMult (asymmetric 7-day growth): TVL falling says more than TVL rising,
// so a fall is weighted twice as hard as a rise of the same size.
//   g = clamp(change_7d, -60, 120)
//   g >= 0 : growthMult = 1 + (g / 100) * 0.5
//   g <  0 : growthMult = 1 + (g / 100) * 1.0
//   growthMult is clamped to [0.40, 1.60].
//   A missing change_7d (unreported) is treated as 0, no signal either way.
//
// maturityMult (how long the protocol has run with no token on record):
//   age_days = days from listed_at to the snapshot date, or 365 when
//   listed_at is missing.
//   maturityMult = 0.60 + min(age_days, 1095) / 1095 * 0.40
//   A protocol earns at most 1.00x after three years; a new one starts at 0.60x.
//
// chainMult (distribution breadth): more chains means a wider surface for a
// future token to reach, but the gain flattens so a chain count alone cannot
// dominate the score.
//   chainMult = 1.00 + 0.03 * min(max(0, chains.length - 1), 5), capped at 1.15.
//
// A protocol records a token when mcap_usd, gecko_id or symbol is present.
// Protocols that record a token never enter the ranking board; they are shown
// separately as Live Tokens, ranked by market cap.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Factors {
  base: number;
  growth: number;
  maturity: number;
  chain: number;
  ageDays: number;
  growthRaw: number;
}

export interface ScoredRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  rank: number;
  implied_value_usd: number;
  tier: 'watchlist' | 'early';
  factors: Factors;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  symbol: string | null;
  rank: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hasToken(p: Protocol): boolean {
  return Boolean(p.mcap_usd || p.gecko_id || p.symbol);
}

/** Days from a listed_at date (YYYY-MM-DD) to the snapshot date, or 365. */
export function ageDays(listedAt: string | null, asOfMs: number): number {
  if (!listedAt) return 365;
  const parts = listedAt.split('-');
  const listedMs = Date.UTC(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
  );
  const days = Math.floor((asOfMs - listedMs) / 86400000);
  return days < 0 ? 0 : days;
}

export function growthMult(change7d: number | null): { mult: number; raw: number } {
  const raw = change7d === null || change7d === undefined ? 0 : clamp(change7d, -60, 120);
  const mult =
    raw >= 0 ? 1 + (raw / 100) * 0.5 : 1 + (raw / 100) * 1.0;
  return { mult: clamp(mult, 0.4, 1.6), raw };
}

export function maturityMult(age: number): number {
  return 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
}

export function chainMult(chains: string[]): number {
  const extra = Math.min(Math.max(0, chains.length - 1), 5);
  return Math.min(1 + 0.03 * extra, 1.15);
}

export interface Scored {
  implied: number;
  factors: Factors;
}

export function score(p: Protocol, asOfMs: number): Scored {
  const age = ageDays(p.listed_at, asOfMs);
  const g = growthMult(p.change_7d);
  const maturity = maturityMult(age);
  const chain = chainMult(p.chains);
  const base = p.tvl_usd * 0.25;
  const implied = Math.max(1, Math.round(base * g.mult * maturity * chain));
  return {
    implied,
    factors: { base, growth: g.mult, maturity, chain, ageDays: age, growthRaw: g.raw },
  };
}

function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The core farming action for a category: one concrete clause naming what the
// reader does with their capital. Categories the map does not name fall back
// to the protocol's main product, so every row still gets a specific step.
const CORE_ACTION: Record<string, string> = {
  'Lending': 'supply $150 of USDC as collateral and borrow $75 of stablecoin against it, keeping the loan well below the liquidation threshold',
  'Uncollateralized Lending': 'supply $150 of USDC to the lending pool and open a $75 uncollateralised borrow line inside the pool limits',
  'Collateral Markets': 'supply $150 of USDC as collateral and borrow $75 of stablecoin against it, keeping the loan well below the liquidation threshold',
  'Collateral Management': 'deposit $150 of collateral into the managed vault and borrow $75 of stablecoin against it',
  'Dexs': 'add $150 as a two-sided liquidity position in the largest pool, keeping the pair balanced so the position earns trading fees',
  'Liquid Staking': 'stake $150 through the liquid staking contract and hold the receipt token it issues',
  'Liquid Restaking': 'restake $150 of liquid staking tokens into the restaking contract and hold the restaking receipt',
  'Restaking': 'restake $150 of liquid staking tokens into the restaking contract and hold the restaking receipt',
  'Restaked BTC': 'restake $150 of BTC-pegged liquid staking tokens into the restaking contract',
  'Staking Pool': 'deposit $150 into the staking pool and hold the staking receipt token',
  'Yield': 'deposit $150 into the highest-TVL yield vault and let it compound',
  'Yield Aggregator': 'deposit $150 into the aggregator highest-yield vault and let it compound',
  'Farm': 'deposit $150 into the farm vault and claim the farming rewards weekly',
  'Leveraged Farming': 'open a $150 leveraged farming position at the lowest leverage the vault offers',
  'Derivatives': 'open a $150 hedged derivatives position at 1x size with no leverage',
  'Basis Trading': 'open a $150 basis trade at 1x size, long spot and short the future in equal size',
  'Synthetics': 'mint $150 of the synthetic asset against collateral and hold the position',
  'Interest Rate Derivatives': 'open a $150 interest-rate swap position at 1x size',
  'Options': 'sell a $150 covered call in the options vault and collect the premium',
  'Options Vault': 'deposit $150 into the options vault and let it sell covered calls',
  'Bridge': 'bridge $150 of stablecoin from the first chain to the second chain and back, keeping the receipt',
  'Canonical Bridge': 'bridge $150 of stablecoin through the canonical bridge and hold the bridged asset',
  'Cross Chain Bridge': 'bridge $150 of stablecoin from the first chain to the second chain and back, keeping the receipt',
  'RWA': 'buy $150 of the tokenised treasury position and hold it for the term',
  'CDP': 'lock $150 of collateral and mint $75 of the stablecoin against it',
  'CDP Manager': 'lock $150 of collateral through the CDP manager and mint $75 of the stablecoin against it',
  'Stablecoin Issuer': 'lock $150 of collateral and mint $75 of the stablecoin against it',
  'Dual-Token Stablecoin': 'lock $150 of collateral and mint $75 of the stablecoin against it',
  'Algo-Stables': 'lock $150 of collateral and mint $75 of the algorithmic stablecoin against it',
  'Reserve Currency': 'bond $150 into the reserve and hold the reserve receipt',
  'Stablecoin Wrapper': 'wrap $150 of stablecoin into the wrapped token and hold it',
  'Risk Curators': 'deposit $150 into the top curated vault and let the curator allocate it',
  'Onchain Capital Allocator': 'deposit $150 into the top allocation vault and let the allocator deploy it',
  'Launchpad': 'commit $150 to the next launch allocation and hold the allocation ticket',
  'Insurance': 'buy $150 of cover for a 30-day term on the highest-volume pool',
  'Indexes': 'buy $150 of the index token and hold it',
  'Payments': 'route $150 of payments through the protocol settlement rail',
  'Crypto Card Issuer': 'load $150 onto the card through the protocol and spend it in small amounts',
  'Prediction Market': 'place a $150 prediction position on the highest-volume market',
  'Privacy': 'deposit $150 into the privacy pool and withdraw it after the holding period',
  'Governance Incentives': 'lock $150 of the governance token for the voting term',
  'NFT Marketplace': 'buy and list $150 of NFTs through the marketplace, keeping the trade receipts',
  'OTC Marketplace': 'place a $150 over-the-counter order on the marketplace',
  'Token Locker': 'lock $150 of tokens in the locker contract for the 30-day term',
  'CEX': 'open a $150 spot position on the exchange and hold it',
  'Chain': 'use $150 of the chain native asset in the chain core contract',
  'AI Agents': 'fund a $150 agent task through the protocol and collect the task receipt',
  'Decentralized AI': 'fund a $150 compute task through the protocol and collect the task receipt',
  'Decentralized BTC': 'deposit $150 of BTC-pegged assets into the vault',
  'Anchor BTC': 'deposit $150 of BTC-pegged assets into the anchor vault',
  'DOR': 'deposit $150 into the decentralised options reserve',
  'CeDeFi': 'deposit $150 into the centralised-decentralised finance vault',
  'Liquidity Manager': 'deposit $150 into the managed liquidity position',
};

function coreAction(category: string): string {
  return (
    CORE_ACTION[category] ||
    'deposit $150 into the protocol main product and hold the receipt it issues'
  );
}

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Five concrete farm steps for one protocol. Each step names a real chain from
 * the snapshot, a concrete action for the protocol's category, a cost in USD
 * and a time. The last step carries the red-line declaration: the protocol
 * records no token in this snapshot, so the reader farms a token that may be
 * issued in future, not an existing token's yield, and no airdrop is promised
 * or guaranteed.
 */
export function farmSteps(p: Protocol): string[] {
  const c1 = p.chains[0] || 'Ethereum';
  const c2 = p.chains.length > 1 ? p.chains[1] : null;
  const name = p.name;
  const action = coreAction(p.category || '');

  const step1 =
    'Open a fresh wallet on ' + c1 + ' and fund it with $150 of working capital plus $25 set aside for gas; ' +
    'keep this wallet separate from your main holdings so the farm is easy to track. ' +
    'Cost: about $5 in transfer fees. Time: 10 minutes.';

  const step2 =
    'On ' + c1 + ', ' + action + '. ' +
    'Cost: about $4 in gas and protocol fees. Time: 15 minutes.';

  const step3 = c2
    ? 'Repeat the position on ' + c2 + ' with a $60 secondary deposit, so the farm spans two chains and is not tied to a single network. ' +
      'Cost: about $3 in gas. Time: 10 minutes.'
    : 'Add a second, smaller $60 position on ' + c1 + ' in a different pool or vault, so the farm is not a single point of failure. ' +
      'Cost: about $3 in gas. Time: 10 minutes.';

  const step4 =
    'Hold the position for at least 30 days and review it once a week for 5 minutes, rebalancing only if the 7-day TVL change turns sharply negative; ' +
    'do not chase short-term moves. Cost: about $1 per week in gas. Time: 30 days holding, 5 minutes a week.';

  const step5 =
    'After 30 days, unwind the position cleanly (repay any debt, withdraw liquidity or receipt tokens), record the transaction hashes, ' +
    'and verify any future claim link only on ' + name + ' own official site. ' +
    'This protocol records no token in this snapshot, so you are farming a token that may be issued in future, not an existing token yield, ' +
    'and no airdrop is promised or guaranteed. Cost: about $8 in exit gas. Time: 12 minutes.';

  return [step1, step2, step3, step4, step5];
}

export interface Board {
  rows: ScoredRow[];
  live: LiveRow[];
  meta: {
    asOf: string;
    snapshotProtocols: number;
    watchlist: number;
    boardRows: number;
    liveCount: number;
    rankShifts: number;
  };
}

/** Whether a below-floor protocol counts as an early pre-token subject. The
 *  watchlist's product test, applied to the early set: not an exchange (a CEX
 *  is not a pre-token DeFi subject — its token already trades), not a
 *  versioned redeploy (a name ending in a version marker), not a wrapped or
 *  staked product of a token that already trades (a whole word wrapped,
 *  staked or staking in the name), and not an exchange's own product (a name
 *  beginning with an exchange name). */
function isEarlyEligible(p: Protocol): boolean {
  if (p.category === 'CEX') return false;
  const name = p.name || '';
  if (/\s(v\d+|\d+\.\d+)$/i.test(name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return false;
  const exchanges = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  const lower = name.toLowerCase();
  for (const e of exchanges) {
    if (lower.startsWith(e.toLowerCase())) return false;
  }
  return true;
}

/** Build the 200-row board: all 40 watchlist protocols plus the 160 highest-TVL
 *  no-token protocols outside it that sit below the watchlist floor and pass
 *  the early-subject product test. The floor is the radar's subject line:
 *  protocols at or above it that the watchlist leaves out are wrapped,
 *  staked, bridge or exchange products whose token already trades, so they
 *  are not early pre-token subjects. */
export function buildBoard(snap: Snapshot): Board {
  const parts = snap.as_of.split('-');
  const asOfMs = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const watch = new Set(snap.watchlist);
  const bySlug = new Map<string, Protocol>();
  for (const p of snap.protocols) bySlug.set(p.slug, p);

  const watchRows = snap.watchlist
    .map((s) => bySlug.get(s))
    .filter((p): p is Protocol => p !== undefined && !hasToken(p));
  const early = snap.protocols
    .filter(
      (p) =>
        !hasToken(p) &&
        !watch.has(p.slug) &&
        p.tvl_usd < snap.floor_usd &&
        isEarlyEligible(p),
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareStr(a.slug, b.slug))
    .slice(0, 160);

  const picked = [...watchRows, ...early];
  const scored = picked.map((p) => ({ p, s: score(p, asOfMs) }));
  scored.sort(
    (a, b) =>
      b.s.implied - a.s.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      compareStr(a.p.slug, b.p.slug),
  );

  // Rank shifts vs a pure TVL ordering, for the page's headline number.
  const tvlOrder = [...picked].sort(
    (a, b) => b.tvl_usd - a.tvl_usd || compareStr(a.slug, b.slug),
  );
  const tvlRank = new Map(tvlOrder.map((p, i) => [p.slug, i + 1]));
  let shifts = 0;
  scored.forEach((entry, i) => {
    if (tvlRank.get(entry.p.slug) !== i + 1) shifts += 1;
  });

  const rows: ScoredRow[] = scored.map((entry, i) => {
    const p = entry.p;
    return {
      slug: p.slug,
      name: p.name,
      category: p.category || 'Uncategorized',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: entry.s.factors.ageDays,
      rank: i + 1,
      implied_value_usd: entry.s.implied,
      tier: watch.has(p.slug) ? 'watchlist' : 'early',
      factors: entry.s.factors,
      farm_steps: farmSteps(p),
    };
  });

  const live: LiveRow[] = snap.protocols
    .filter((p) => hasToken(p))
    .sort(
      (a, b) =>
        (b.mcap_usd || 0) - (a.mcap_usd || 0) || compareStr(a.slug, b.slug),
    )
    .slice(0, 24)
    .map((p, i) => ({
      slug: p.slug,
      name: p.name,
      category: p.category || 'Uncategorized',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd || 0,
      symbol: p.symbol,
      rank: i + 1,
    }));

  return {
    rows,
    live,
    meta: {
      asOf: snap.as_of,
      snapshotProtocols: snap.protocols.length,
      watchlist: snap.watchlist.length,
      boardRows: rows.length,
      liveCount: live.length,
      rankShifts: shifts,
    },
  };
}

export { money };
