// Value model for the token launch radar (clean-room implementation).
//
// One scoring function rates every protocol from the snapshot figures alone.
// No protocol name or slug receives special treatment.
//
//   base_anchor  = sqrt(tvl_usd) * 5000
//   growth       = 1 + (clamped_7d / 100) * (clamped_7d >= 0 ? 0.55 : 1.10)
//                  where clamped_7d = clamp(change_7d ?? 0, -60, 120)
//   maturity     = 0.55 + (min(age_days, 1095) / 1095) * 0.45
//                  where age_days counts listed_at to the snapshot date,
//                  a missing listed_at counts as 365 days, negatives as 0
//   chain_factor = 1.00 + 0.03 * min(max(0, chains.length - 1), 6)
//   implied      = clamp(round(base_anchor * growth * maturity * chain_factor),
//                        1, 100000000000000)
//
// The square-root anchor compresses a hundredfold TVL gap into a tenfold
// value gap, so weekly momentum, operating age and chain breadth can move
// ranks instead of merely decorating a TVL table. Falls weigh roughly twice
// as heavily as rises of the same size. Maturity tops out after three years.
// Each extra chain adds three points, capped at seven chains.
//
// Language rule: a protocol is described only as recording no token in this
// snapshot. Nothing here promises an airdrop or a future launch.

export interface ProtocolRecord {
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

export interface SnapshotData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

export interface FactorSet {
  base_anchor_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number;
  growth_input: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  rank: number;
  tvl_rank: number;
  rank_shift: number;
  implied_value_usd: number;
  tier: 'watchlist' | 'early';
  factors: FactorSet;
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

export function clampNumber(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function recordsToken(p: ProtocolRecord): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

// Eligibility for board subjects: no token on record, and not in the
// bridged, staked or exchange categories the snapshot rule sets aside.
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function isEligibleSubject(p: ProtocolRecord): boolean {
  if (recordsToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  return true;
}

export function ageInDays(listedAt: string | null, asOfMs: number): number {
  if (listedAt === null) return 365;
  const pieces = listedAt.slice(0, 10).split('-');
  const listedMs = Date.UTC(Number(pieces[0]), Number(pieces[1]) - 1, Number(pieces[2]));
  const days = Math.floor((asOfMs - listedMs) / 86400000);
  return days < 0 ? 0 : days;
}

export function computeImpliedValue(p: ProtocolRecord, asOfMs: number): { implied: number; factors: FactorSet } {
  const age = ageInDays(p.listed_at, asOfMs);
  const growthInput = clampNumber(p.change_7d === null ? 0 : p.change_7d, -60, 120);
  const growth = 1 + (growthInput / 100) * (growthInput >= 0 ? 0.55 : 1.1);
  const maturity = 0.55 + (Math.min(age, 1095) / 1095) * 0.45;
  const chainFactor = 1 + 0.03 * Math.min(Math.max(0, p.chains.length - 1), 6);
  const anchor = Math.sqrt(p.tvl_usd) * 5000;
  const implied = clampNumber(Math.round(anchor * growth * maturity * chainFactor), 1, 100000000000000);
  return {
    implied,
    factors: {
      base_anchor_usd: Math.round(anchor),
      growth_multiplier: growth,
      maturity_multiplier: maturity,
      chain_multiplier: chainFactor,
      age_days: age,
      growth_input: growthInput,
    },
  };
}

const CATEGORY_ACTIONS: Record<string, { verb: string; detail: string; cost: string; minutes: string }> = {
  Lending: { verb: 'supply stablecoins as collateral and borrow a smaller stablecoin amount against it', detail: 'keep the borrow well under the liquidation line and check the health factor before leaving', cost: 'about $6 in gas and market fees', minutes: 'about 18 minutes' },
  'Uncollateralized Lending': { verb: 'deposit stablecoins into the lending pool and draw a modest uncollateralised line within pool limits', detail: 'respect the pool borrow cap and leave headroom for rate swings', cost: 'about $5 in gas and pool fees', minutes: 'about 16 minutes' },
  Dexs: { verb: 'place a two-sided liquidity position in the deepest pool', detail: 'keep both sides balanced so the position stays in range and collects swap fees', cost: 'about $7 in gas and swap fees', minutes: 'about 20 minutes' },
  'Liquid Staking': { verb: 'stake through the liquid staking contract and keep the receipt token in the same wallet', detail: 'note the unbonding window shown by the contract before confirming', cost: 'about $4 in gas', minutes: 'about 12 minutes' },
  'Liquid Restaking': { verb: 'restake liquid staking tokens into the restaking contract and hold the restaking receipt', detail: 'record which operator or vault the deposit was delegated to', cost: 'about $5 in gas', minutes: 'about 14 minutes' },
  Restaking: { verb: 'restake liquid staking tokens into the restaking contract and hold the restaking receipt', detail: 'record which operator or vault the deposit was delegated to', cost: 'about $5 in gas', minutes: 'about 14 minutes' },
  Yield: { verb: 'deposit into the largest yield vault and leave rewards to compound', detail: 'check the vault strategy page for withdrawal timing before depositing', cost: 'about $5 in gas and vault fees', minutes: 'about 15 minutes' },
  'Yield Aggregator': { verb: 'deposit into the aggregator vault with the deepest TVL and leave rewards to compound', detail: 'confirm the vault fee schedule on its detail page first', cost: 'about $6 in gas and vault fees', minutes: 'about 16 minutes' },
  Farm: { verb: 'deposit into the farm vault and claim farming rewards on a weekly cadence', detail: 'set a calendar reminder so claims do not pile up uncollected', cost: 'about $5 in gas per deposit and claim cycle', minutes: 'about 15 minutes to open' },
  Derivatives: { verb: 'open a small hedged derivatives position at one-times size with no leverage', detail: 'set alerts on both legs so a drift in one side is caught early', cost: 'about $8 in gas and trading fees', minutes: 'about 22 minutes' },
  Bridge: { verb: 'bridge stablecoins across and back through the official bridge route', detail: 'keep both transaction hashes and wait for finality on each side', cost: 'about $9 in bridge and gas fees for the round trip', minutes: 'about 25 minutes including waiting' },
  CDP: { verb: 'lock collateral and mint a conservative amount of the stablecoin against it', detail: 'leave a wide collateral buffer so a price dip cannot trigger liquidation', cost: 'about $6 in gas and mint fees', minutes: 'about 17 minutes' },
  'Stablecoin Issuer': { verb: 'lock collateral and mint a conservative amount of the stablecoin against it', detail: 'leave a wide collateral buffer so a price dip cannot trigger liquidation', cost: 'about $6 in gas and mint fees', minutes: 'about 17 minutes' },
  RWA: { verb: 'buy the tokenised treasury position and hold it to term', detail: 'read the redemption terms and lockup shown before buying', cost: 'about $5 in gas and purchase fees', minutes: 'about 14 minutes' },
  Launchpad: { verb: 'commit to the next launch allocation and keep the allocation ticket', detail: 'check the vesting schedule attached to the allocation before committing', cost: 'about $5 in gas', minutes: 'about 13 minutes' },
  Insurance: { verb: 'buy cover for a thirty-day term on the highest-volume pool', detail: 'save the policy details and expiry date somewhere visible', cost: 'about $7 in premium and gas', minutes: 'about 15 minutes' },
  'Prediction Market': { verb: 'place a position on the highest-volume market and note the resolution source', detail: 'write down the resolution criteria so the outcome can be checked later', cost: 'about $5 in gas and market fees', minutes: 'about 14 minutes' },
  Indexes: { verb: 'buy the index token and hold it without rebalancing by hand', detail: 'note the index composition page for later comparison', cost: 'about $4 in gas and swap fees', minutes: 'about 11 minutes' },
  Payments: { verb: 'route a series of small payments through the settlement rail', detail: 'keep receipts for each payment so usage is easy to prove', cost: 'about $4 in gas and rail fees', minutes: 'about 13 minutes' },
};

const FALLBACK_ACTION = { verb: 'use the core product with a first deposit and keep the position receipt', detail: 'follow the official guide for the main flow and avoid third-party shortcuts', cost: 'about $5 in gas and product fees', minutes: 'about 15 minutes' };

function actionFor(category: string) {
  return CATEGORY_ACTIONS[category] ?? FALLBACK_ACTION;
}

export function buildFarmSteps(p: ProtocolRecord, tier: 'watchlist' | 'early'): string[] {
  const mainChain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const act = actionFor(p.category ?? 'Other');
  const mainCapital = tier === 'watchlist' ? 400 : 120;
  const sideCapital = tier === 'watchlist' ? 150 : 50;
  const gasReserve = tier === 'watchlist' ? 40 : 20;
  const steps: string[] = [];
  steps.push(
    `Prepare a separate wallet for this farm on ${mainChain} and fund it with $${mainCapital} of working capital plus $${gasReserve} kept aside for gas, so this position never mixes with everyday holdings. Cost: roughly $4 in transfer fees. Time: about 9 minutes.`,
  );
  steps.push(
    `On ${mainChain}, ${act.verb} using $${mainCapital}; ${act.detail}. Cost: ${act.cost}. Time: ${act.minutes}.`,
  );
  if (secondChain !== null) {
    steps.push(
      `Repeat a smaller $${sideCapital} position on ${secondChain} with the same core action, so the farm is spread over two networks instead of depending on one chain staying cheap and live. Cost: roughly $3 in gas. Time: about 11 minutes.`,
    );
  } else {
    steps.push(
      `Add a second, smaller $${sideCapital} position on ${mainChain} in a different pool or vault of the same protocol, so one pool pausing does not freeze the whole farm. Cost: roughly $3 in gas. Time: about 10 minutes.`,
    );
  }
  steps.push(
    `Hold for at least thirty days and spend five minutes each week checking the position, the protocol TVL trend and any official announcements; adjust only if the seven-day TVL change turns sharply negative. Cost: about $1 a week in gas if an adjustment is needed. Time: thirty days holding, five minutes a week.`,
  );
  if (secondChain !== null) {
    steps.push(
      `Once a month, compare the ${mainChain} and ${secondChain} legs side by side and move the smaller leg only if fees or liquidity have clearly shifted; avoid churn for its own sake. Cost: about $3 in gas when a move happens. Time: about 12 minutes a month.`,
    );
  }
  steps.push(
    `After the holding period, unwind in reverse order, save every transaction hash, and verify any future claim page only through ${p.name} official channels. This protocol records no token in this snapshot, so the farm targets a token that may be issued later rather than yield from an existing token, and no airdrop or token launch is promised or guaranteed. Cost: about $7 in exit gas. Time: about 13 minutes.`,
  );
  return steps;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface RadarPayload {
  meta: Record<string, unknown>;
  rows: BoardRow[];
  live: LiveRow[];
}

export function buildRadar(snapshot: SnapshotData): RadarPayload {
  const asOfMs = Date.parse(snapshot.as_of.slice(0, 10) + 'T00:00:00Z');
  const watchSet = new Set(snapshot.watchlist);
  const noToken = snapshot.protocols.filter((p) => isEligibleSubject(p));
  const watchRows = noToken.filter((p) => watchSet.has(p.slug));
  const earlyPool = noToken
    .filter((p) => !watchSet.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareText(a.slug, b.slug))
    .slice(0, 160);
  const chosen = [...watchRows, ...earlyPool];
  const tvlOrder = [...chosen].sort((a, b) => b.tvl_usd - a.tvl_usd || compareText(a.slug, b.slug));
  const tvlRank = new Map<string, number>();
  tvlOrder.forEach((p, i) => tvlRank.set(p.slug, i + 1));
  const scored = chosen.map((p) => {
    const tier: 'watchlist' | 'early' = watchSet.has(p.slug) ? 'watchlist' : 'early';
    const { implied, factors } = computeImpliedValue(p, asOfMs);
    return { p, tier, implied, factors };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || compareText(a.p.slug, b.p.slug));
  // Deterministic strict-descent guard: walk from the top and nudge any
  // equal value down by one dollar steps so ranks never tie.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) {
      scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - 1);
    }
  }
  const rows: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category ?? 'Other',
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.factors.age_days,
    rank: i + 1,
    tvl_rank: tvlRank.get(s.p.slug) ?? 0,
    rank_shift: (tvlRank.get(s.p.slug) ?? 0) - (i + 1),
    implied_value_usd: s.implied,
    tier: s.tier,
    factors: s.factors,
    farm_steps: buildFarmSteps(s.p, s.tier),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p) && (p.category ?? '') !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || compareText(a.slug, b.slug))
    .slice(0, 24)
    .map((p, i) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      symbol: p.symbol,
      rank: i + 1,
    }));
  const shifts = rows.map((r) => Math.abs(r.rank_shift));
  const meta: Record<string, unknown> = {
    model_version: 'radar-v3-sqrt-clean',
    as_of: snapshot.as_of,
    formula_text: 'implied = round( sqrt(tvl_usd) * 5000 * growthMult * maturityMult * chainMult )',
    total_protocols: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_rows: rows.length,
    early_size: rows.filter((r) => r.tier === 'early').length,
    live_size: live.length,
    rank_shifts: shifts.filter((v) => v > 0).length,
    avg_rank_shift: Math.round((shifts.reduce((a, b) => a + b, 0) / shifts.length) * 10) / 10,
    max_rank_shift: Math.max(...shifts),
    early_in_top40: rows.filter((r) => r.rank <= 40 && r.tier === 'early').length,
  };
  return { meta, rows, live };
}
