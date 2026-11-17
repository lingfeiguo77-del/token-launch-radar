// Token Launch Radar v2 估值模型、宇宙筛选与 Farm 计划生成器（仅使用 Node 22 标准库）。
//
// 核心设计原则：
// 1. 严格只使用快照自带的 10 个字段（slug, name, category, chains, tvl_usd, change_7d, mcap_usd,
//    listed_at, gecko_id, symbol），绝不对任何协议名称或 slug 做硬编码特判。
// 2. 排名板覆盖全部 40 个 watchlist 协议（TVL >= $50M、无 token 记录、非衍生包装/质押/桥），
//    并补充 160 个 watchlist 之外按 TVL 最高的早期无 token 记录协议（总计 200 行）。
// 3. 已记录发币的协议（mcap_usd / gecko_id / symbol 任意非空）绝不混入排名板，
//    全部隔离到独立的 Live Token 对照视图（按市值降序展示前 24 个）。
// 4. 语言红线：只表述“记录中无 token（no token on record）”，绝不断言协议“没有 token”，
//    绝不承诺“保证空投”或“必发币”。

/** 快照中单个协议的精确 10 个字段定义 */
export interface SnapshotProtocol {
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

/** 密封快照文件（/input/snapshot.json）结构 */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** v2 非对称多链估值模型常数配置 */
export interface ModelV2Constants {
  base_multiple: number;
  growth_floor: number;
  growth_cap: number;
  growth_up_weight: number;
  growth_down_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL_VERSION = 'radar-v2';
export const EARLY_RADAR_LIMIT = 160;
export const LIVE_TOKEN_LIMIT = 24;

export const MODEL_V2: ModelV2Constants = {
  // 基准 TVL 估值倍数：0.25x，代表早期协议相对锁仓量的保守潜在市值锚
  base_multiple: 0.25,
  // 7 日增长率截断区间 [-60%, +120%]，防止极端单周波动扭曲估值
  growth_floor: -60,
  growth_cap: 120,
  // 上涨段权重 0.5（每 +1% 加 0.5%）：短期拉升可能含脉冲激励，按保守折算
  growth_up_weight: 0.5,
  // 下跌段权重 1.0（每 -1% 扣 1.0%）：资金净流出更直接反映留存受损，下跌惩罚加倍
  growth_down_weight: 1.0,
  // 运营成熟度乘数 [0.60, 1.00]，满 1095 天（3 年）封顶，未知上市日按 365 天计
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  // 多链分发加成：单链 1.00，每增 1 条链 +0.03，在额外 5 条链（总计 6 链）封顶 1.15
  chain_step: 0.03,
  chain_max_extra: 5,
};

/** 估值分项拆解结构，写入 board.json 并在页面详情中展示 */
export interface ModelBreakdown {
  base_multiple: number;
  base_value_usd: number;
  growth_pct: number;
  growth_weight_applied: number;
  growth_multiplier: number;
  age_days: number | null;
  age_days_effective: number;
  maturity_multiplier: number;
  chain_count: number;
  chain_multiplier: number;
}

/** computeImpliedValue 返回的完整估值结果 */
export interface ImpliedValuationResult {
  implied_value_usd: number;
  breakdown: ModelBreakdown;
}

/** board.json 单行结构 */
export interface BoardRow {
  rank: number;
  tvl_rank: number;
  rank_delta: number;
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
  tier: 'watchlist' | 'early';
  token_status: 'no-token-on-record';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** Live Token 对照视图单行结构（严格与未发币榜隔离） */
export interface LiveTokenRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_to_tvl: number | null;
  change_7d: number | null;
}

/** 注入 data.js 供离线仪表盘读取的完整数据集 */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelV2Constants;
  total_protocols: number;
  pre_token_record_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  divergence_count: number;
  rows: BoardRow[];
  live: LiveTokenRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED_POOL_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_STAKED_RE = /\b(wrapped|staked|staking)\b/i;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 计算协议自 listed_at 至快照基准日 as_of 的运营天数（仅基于快照日期字段） */
export function computeAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const endMs = Date.parse(`${asOf}T00:00:00Z`);
  const startMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs)) return null;
  return Math.max(0, Math.floor((endMs - startMs) / DAY_MS));
}

/** 计算非对称 7 天增长乘数：下跌段权重翻倍（1.0 vs 0.5），区间 [0.40, 1.60] */
export function computeAsymmetricGrowth(
  change7d: number | null,
  model: ModelV2Constants = MODEL_V2,
): { growthPct: number; weightApplied: number; multiplier: number } {
  const raw = typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0;
  const growthPct = clamp(raw, model.growth_floor, model.growth_cap);
  const weightApplied = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const multiplier = 1 + (growthPct / 100) * weightApplied;
  return { growthPct, weightApplied, multiplier };
}

/** 计算无 token 记录运营成熟度乘数：区间 [0.60, 1.00]，3 年封顶 */
export function computeMaturityMultiplier(
  ageDays: number | null,
  model: ModelV2Constants = MODEL_V2,
): { ageEffective: number; multiplier: number } {
  const ageEffective = ageDays === null ? model.unknown_age_days : Math.max(0, ageDays);
  const ratio = Math.min(ageEffective, model.maturity_days) / model.maturity_days;
  const multiplier = model.maturity_floor + ratio * model.maturity_range;
  return { ageEffective, multiplier };
}

/** 计算多链分发加成乘数：单链 1.00，每多一条链 +0.03，6 链及以上封顶 1.15 */
export function computeChainMultiplier(
  chains: readonly string[],
  model: ModelV2Constants = MODEL_V2,
): { chainCount: number; multiplier: number } {
  const chainCount = chains.length;
  const extraChains = Math.min(Math.max(0, chainCount - 1), model.chain_max_extra);
  const multiplier = 1 + model.chain_step * extraChains;
  return { chainCount, multiplier };
}

/**
 * 核心估值函数 v2：由同一确定性函数对全部协议打分，绝不特判任何名字或 slug。
 *
 * 公式：
 *   base       = tvl_usd * 0.25
 *   growthMult = 1 + clamp(change_7d, -60, 120) / 100 * (change_7d >= 0 ? 0.5 : 1.0)
 *   maturity   = 0.60 + min(age_effective, 1095) / 1095 * 0.40
 *   chainMult  = 1.00 + 0.03 * min(max(0, chains.length - 1), 5)
 *   implied    = max(1, round(base * growthMult * maturity * chainMult))
 */
export function computeImpliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelV2Constants = MODEL_V2,
): ImpliedValuationResult {
  const baseValue = protocol.tvl_usd * model.base_multiple;
  const ageDays = computeAgeDays(asOf, protocol.listed_at);
  const growth = computeAsymmetricGrowth(protocol.change_7d, model);
  const maturity = computeMaturityMultiplier(ageDays, model);
  const chain = computeChainMultiplier(protocol.chains, model);

  const rawImplied = baseValue * growth.multiplier * maturity.multiplier * chain.multiplier;
  const impliedUsd = Math.min(100_000_000_000_000, Math.max(1, Math.round(rawImplied)));

  return {
    implied_value_usd: impliedUsd,
    breakdown: {
      base_multiple: model.base_multiple,
      base_value_usd: Math.round(baseValue),
      growth_pct: round4(growth.growthPct),
      growth_weight_applied: growth.weightApplied,
      growth_multiplier: round4(growth.multiplier),
      age_days: ageDays,
      age_days_effective: maturity.ageEffective,
      maturity_multiplier: round4(maturity.multiplier),
      chain_count: chain.chainCount,
      chain_multiplier: round4(chain.multiplier),
    },
  };
}

/** 判断协议在 DefiLlama 快照中是否“无任何已记录 token 字段” */
export function isPreTokenRecord(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** 判断是否符合早期雷达候选条件（watchlist 之外、低于门槛、排除 CEX/版本号池/交易所衍生/wrapped-staked） */
export function isEarlyCandidate(p: SnapshotProtocol, floorUsd: number): boolean {
  return (
    isPreTokenRecord(p) &&
    p.tvl_usd < floorUsd &&
    p.category !== 'CEX' &&
    !VERSIONED_POOL_RE.test(p.name) &&
    !EXCHANGE_PREFIX_RE.test(p.name) &&
    !WRAPPED_STAKED_RE.test(p.name)
  );
}

interface ChainGasProfile {
  tierLabel: string;
  setupGasUsd: number;
  weeklyGasUsd: number;
  exitGasUsd: number;
  setupMinutes: number;
}

const HIGH_FEE_L1 = new Set(['Ethereum', 'Bitcoin']);
const ULTRA_LOW_NON_EVM = new Set([
  'Solana',
  'Sui',
  'Aptos',
  'TON',
  'Stellar',
  'Algorand',
  'Ripple',
  'Tron',
  'Proton',
]);

/** 基于真实主链名称估算合理的美元级 Gas 成本与确认时间 */
function classifyChainGas(chain: string, tvlUsd: number): ChainGasProfile {
  if (HIGH_FEE_L1.has(chain)) {
    return {
      tierLabel: 'L1 Mainnet',
      setupGasUsd: tvlUsd >= 200_000_000 ? 10 : 8,
      weeklyGasUsd: 5,
      exitGasUsd: 8,
      setupMinutes: 15,
    };
  }
  if (ULTRA_LOW_NON_EVM.has(chain)) {
    return {
      tierLabel: 'High-Throughput L1',
      setupGasUsd: 0.15,
      weeklyGasUsd: 0.05,
      exitGasUsd: 0.15,
      setupMinutes: 6,
    };
  }
  return {
    tierLabel: 'L2 / Alt-EVM',
    setupGasUsd: 0.8,
    weeklyGasUsd: 0.3,
    exitGasUsd: 0.6,
    setupMinutes: 8,
  };
}

function fmtGas(amount: number): string {
  return amount < 1 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(0)}`;
}

function recommendedCapitalUsd(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  if (tvlUsd >= 25_000_000) return 100;
  return 50;
}

function recommendedHoldDays(ageDays: number | null): number {
  if (ageDays === null) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** 根据快照 category 与真实主链构造可执行的 Core DeFi 交互动作 */
function buildCategoryAction(
  p: SnapshotProtocol,
  capitalUsd: number,
  primaryChain: string,
  secondaryChain: string | null,
): string {
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;

  if (cat.includes('uncollateralized') || cat === 'lending' || cat.includes('collateral market')) {
    return `Deposit $${capitalUsd} of USDC or ETH as collateral into ${name} on ${primaryChain}, then borrow 30% LTV in a correlated asset to register active two-sided lending utilization`;
  }
  if (cat.includes('cdp') || cat.includes('dual-token') || cat.includes('stablecoin wrapper')) {
    return `Supply $${capitalUsd} of base collateral into ${name} on ${primaryChain}, mint the protocol stable asset at >200% collateral ratio, and route it into the native stability vault`;
  }
  if (cat === 'dexs' || cat.includes('liquidity manager')) {
    return `Execute three spot swaps totaling $${capitalUsd} on ${name} on ${primaryChain}, then deposit balanced liquidity into the highest-volume stable or major LP pool`;
  }
  if (cat.includes('derivative') || cat.includes('interest rate')) {
    return `Deposit $${capitalUsd} USDC margin into ${name} on ${primaryChain} and open a low-leverage (2x) delta-neutral or hedged perpetual position to build realized trading volume`;
  }
  if (cat.includes('prediction')) {
    return `Fund $${capitalUsd} on ${name} on ${primaryChain} and place two liquid event market positions across separate resolution dates to log settled volume`;
  }
  if (cat.includes('bridge')) {
    const dest = secondaryChain ?? primaryChain;
    return `Bridge $${capitalUsd} of USDC or ETH across ${name} between ${primaryChain} and ${dest}, then verify settlement finality before interacting with a native pool`;
  }
  if (cat.includes('staking') || cat.includes('restak') || cat.includes('btc')) {
    return `Deposit $${capitalUsd} of native gas asset or wrapped BTC into ${name} on ${primaryChain} and hold the issued liquid staking or restaking receipt token directly in your wallet`;
  }
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('yield') || cat.includes('farm') || cat.includes('basis') || cat.includes('index')) {
    return `Allocate $${capitalUsd} into a flagship curated vault or yield pool on ${name} (${primaryChain}) and retain the vault share token without wrapping it off-protocol`;
  }
  if (cat.includes('rwa') || cat.includes('cedefi')) {
    return `Mint or subscribe $${capitalUsd} into ${name}'s tokenized yield instrument on ${primaryChain} and retain custody of the yield-bearing receipt on-chain`;
  }
  if (cat.includes('insurance')) {
    return `Underwrite $${capitalUsd} in a cover pool or purchase a minimum-duration protocol cover policy through ${name} on ${primaryChain}`;
  }
  if (cat.includes('payment') || cat.includes('crypto card')) {
    return `Load $${capitalUsd} onto ${name} on ${primaryChain} and settle at least two real on-chain transfers or merchant payment invoices`;
  }
  if (cat.includes('governance')) {
    return `Deposit $${capitalUsd} into ${name}'s incentive pool on ${primaryChain} and cast one on-chain epoch gauge vote`;
  }
  if (cat === 'chain') {
    return `Bridge $${capitalUsd} onto ${primaryChain} for ${name}, execute five distinct native DEX or transfer transactions, and maintain an active native gas balance`;
  }
  return `Supply $${capitalUsd} of USDC into ${name}'s primary contract on ${primaryChain} and keep the receipt position verifiable on-chain`;
}

function clampStepLength(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 600 && clean.length >= 20) return clean;
  if (clean.length > 600) return `${clean.slice(0, 596)}...`;
  return `${clean} Verify transaction confirmation on block explorer.`;
}

/**
 * 为每个协议生成 5 步具体可执行的 Farm 计划（纯由快照字段推导，每步 20..600 字符）。
 * 明确包含链名、美元级成本估算、耗时预算，以及“记录中无 token，farm 未来潜在代币而非已发币收益”声明。
 */
export function generateFarmPlan(
  protocol: SnapshotProtocol,
  ageDays: number | null,
  _impliedValueUsd: number,
): string[] {
  const primaryChain = protocol.chains.length > 0 ? protocol.chains[0]! : 'Ethereum';
  const secondaryChain = protocol.chains.length > 1 ? protocol.chains[1]! : null;
  const gas = classifyChainGas(primaryChain, protocol.tvl_usd);
  const capital = recommendedCapitalUsd(protocol.tvl_usd);
  const holdDays = recommendedHoldDays(ageDays);
  const rawChg = protocol.change_7d ?? 0;

  const gasBuffer = HIGH_FEE_L1.has(primaryChain) ? 25 : 4;
  const step1 = clampStepLength(
    `Fund a dedicated wallet on ${primaryChain} (${gas.tierLabel}) with $${capital} working capital plus $${gasBuffer} native gas buffer. Cost: ~$${(gas.setupGasUsd * 0.5).toFixed(2)} transfer fee (${gas.tierLabel} gas). Time: 10 minutes.`,
  );

  const coreAction = buildCategoryAction(protocol, capital, primaryChain, secondaryChain);
  const bridgeFeeNote =
    (protocol.category ?? '').toLowerCase().includes('bridge')
      ? ` + ~$${(capital * 0.001).toFixed(2)} bridge fee`
      : '';
  const step2 = clampStepLength(
    `${coreAction}. Cost: $${capital} committed capital + ~${fmtGas(gas.setupGasUsd)} ${primaryChain} gas${bridgeFeeNote}. Time: ${gas.setupMinutes} minutes.`,
  );

  let cadenceClause: string;
  let cadenceCost: string;
  if (secondaryChain !== null) {
    const secGas = classifyChainGas(secondaryChain, protocol.tvl_usd);
    cadenceClause = `Expand multi-chain footprint to ${secondaryChain} (listed in snapshot) with a $${Math.round(capital * 0.4)} secondary deposit or weekly rebalance on ${primaryChain}`;
    cadenceCost = `~${fmtGas(secGas.setupGasUsd)} initial on ${secondaryChain} + ${fmtGas(gas.weeklyGasUsd)}/week`;
  } else {
    cadenceClause = `Execute one weekly on-chain maintenance action on ${primaryChain} (compound rewards, rebalance LP range, or repay/top up 10% position)`;
    cadenceCost = `~${fmtGas(gas.weeklyGasUsd)}/week ${primaryChain} gas`;
  }
  const momentumNote =
    rawChg <= -10
      ? ' Monitor 7d TVL outflow closely before adding size.'
      : rawChg >= 15
        ? ' Split entries across 2 days to avoid temporary incentive spikes.'
        : '';
  const step3 = clampStepLength(
    `${cadenceClause}.${momentumNote} Cost: ${cadenceCost}. Time: 10 minutes/week.`,
  );

  const step4 = clampStepLength(
    `Hold position across at least ${holdDays} days to span multiple ecosystem snapshots; note ${protocol.name} records no token in this snapshot, so you are farming potential future token distribution rather than live-token yield with no launch or distribution promised. Cost: $0 protocol fee (capital opportunity cost only). Time: ${holdDays} days holding (5 minutes/week review).`,
  );

  const step5 = clampStepLength(
    `After ${holdDays} days, unwind the ${primaryChain} position cleanly (repay any debt, withdraw shares/LP), record tx hashes, and verify any points or future claim link solely via ${protocol.name}'s official domain. Cost: ~${fmtGas(gas.exitGasUsd)} exit gas. Time: 12 minutes.`,
  );

  return [step1, step2, step3, step4, step5];
}

/** 筛选出已记录发币的协议，按市值降序取前 24 个供 Live Token 独立页面参照 */
export function selectLiveTokenRows(snapshot: Snapshot): LiveTokenRow[] {
  return snapshot.protocols
    .filter((p) => !isPreTokenRecord(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || compareCodeUnits(a.slug, b.slug))
    .slice(0, LIVE_TOKEN_LIMIT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_to_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** 构建完整的排名板与前端载荷 */
export function buildRadarPayload(snapshot: Snapshot, model: ModelV2Constants = MODEL_V2): { board: BoardRow[]; payload: RadarPayload } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlistSet = new Set(snapshot.watchlist);
  const selected = new Map<string, { protocol: SnapshotProtocol; tier: 'watchlist' | 'early' }>();

  // 1. 全量覆盖 watchlist 全部 40 个协议（不可遗漏）
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) selected.set(slug, { protocol: p, tier: 'watchlist' });
  }

  // 2. 补充 watchlist 之外 TVL 最高的 160 个早期无 token 记录协议
  const earlyList = snapshot.protocols
    .filter((p) => !selected.has(p.slug) && isEarlyCandidate(p, snapshot.floor_usd))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareCodeUnits(a.slug, b.slug))
    .slice(0, EARLY_RADAR_LIMIT);

  for (const p of earlyList) {
    selected.set(p.slug, { protocol: p, tier: 'early' });
  }

  // 计算在 200 行集合内的纯 TVL 排名，用于展现模型与 TVL 排序的显著差异
  const allChosen = [...selected.values()];
  const tvlSorted = [...allChosen].sort((a, b) => b.protocol.tvl_usd - a.protocol.tvl_usd || compareCodeUnits(a.protocol.slug, b.protocol.slug));
  const tvlRankBySlug = new Map<string, number>();
  tvlSorted.forEach((item, idx) => tvlRankBySlug.set(item.protocol.slug, idx + 1));

  // 使用同一函数 computeImpliedValue 对 200 个协议全部打分
  const scored = allChosen.map(({ protocol, tier }) => {
    const val = computeImpliedValue(protocol, snapshot.as_of, model);
    return { protocol, tier, val };
  });

  scored.sort(
    (a, b) =>
      b.val.implied_value_usd - a.val.implied_value_usd ||
      compareCodeUnits(a.protocol.slug, b.protocol.slug),
  );

  let divergenceCount = 0;
  const board: BoardRow[] = scored.map((entry, idx) => {
    const rank = idx + 1;
    const tvlRank = tvlRankBySlug.get(entry.protocol.slug) ?? rank;
    const rankDelta = tvlRank - rank;
    if (rankDelta !== 0) divergenceCount++;

    return {
      rank,
      tvl_rank: tvlRank,
      rank_delta: rankDelta,
      slug: entry.protocol.slug,
      name: entry.protocol.name,
      category: entry.protocol.category,
      chains: entry.protocol.chains,
      tvl_usd: entry.protocol.tvl_usd,
      change_7d: entry.protocol.change_7d,
      mcap_usd: entry.protocol.mcap_usd,
      listed_at: entry.protocol.listed_at,
      gecko_id: entry.protocol.gecko_id,
      symbol: entry.protocol.symbol,
      tier: watchlistSet.has(entry.protocol.slug) ? 'watchlist' : 'early',
      token_status: 'no-token-on-record',
      age_days: entry.val.breakdown.age_days,
      implied_value_usd: entry.val.implied_value_usd,
      model: entry.val.breakdown,
      farm_steps: generateFarmPlan(entry.protocol, entry.val.breakdown.age_days, entry.val.implied_value_usd),
    };
  });

  const live = selectLiveTokenRows(snapshot);
  const preTokenRecordCount = snapshot.protocols.filter(isPreTokenRecord).length;
  const earlySize = board.filter((r) => r.tier === 'early').length;

  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    total_protocols: snapshot.protocols.length,
    pre_token_record_count: preTokenRecordCount,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    divergence_count: divergenceCount,
    rows: board,
    live,
  };

  return { board, payload };
}

/** 严格校验 snapshot.json 结构完整性 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid UTF-8 JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json lacks a valid as_of date (YYYY-MM-DD)');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json lacks source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json lacks a valid positive integer floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json lacks protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json lacks watchlist slug array');
  }

  const protocols: SnapshotProtocol[] = o.protocols.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new SnapshotError(`protocols[${idx}] is not an object`);
    }
    const p = item as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocols[${idx}] is missing slug, name, or finite tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** 预校验 board.json 是否满足全部密封门（gate）硬约束，若有问题返回错误描述 */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board row count ${board.length} must be within 100..4000`;
  }
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seenSlugs = new Set<string>();
  for (const row of board) {
    if (!row.slug || /\s/.test(row.slug) || row.slug.length > 128) return `invalid slug: ${row.slug}`;
    if (!snapshotSlugs.has(row.slug)) return `slug not in snapshot: ${row.slug}`;
    if (seenSlugs.has(row.slug)) return `duplicate slug: ${row.slug}`;
    seenSlugs.add(row.slug);
    if (!row.name || row.name.trim().length === 0) return `empty name for ${row.slug}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `invalid implied_value_usd for ${row.slug}: ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps (expected 3..12)`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has step length ${len} outside 20..600`;
    }
  }

  for (const slug of snapshot.watchlist) {
    if (!seenSlugs.has(slug)) return `missing watchlist slug: ${slug}`;
  }

  const sortedRanks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length; i++) {
    if (sortedRanks[i] !== i + 1) return `ranks must be exact 1..${board.length}, found ${sortedRanks[i]} at index ${i}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} implied_value_usd exceeds row ${i}`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all rows share the same implied_value_usd';
  }
  return null;
}

/** 序列化为离线浏览器可直接加载的 window.RADAR 脚本 */
export function serializeDataScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
