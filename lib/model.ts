// Token Radar, model radar-3.
//
// What this model is: every number it uses comes from the sealed snapshot itself.
// There are no hand-picked protocol names, no outside prices, no network calls.
//
// The snapshot carries two populations. One already trades: 118 protocols record
// a market cap above zero, a TVL above zero, and a category other than CEX. Those
// are the comps. The other records no token at all; those are the board. radar-3
// fits the comps, then prices the board the way the comps were priced.
//
// The fitted multiple, computed at run time from the comps:
//   * global median multiple M0 = median(mcap_usd / tvl_usd) over the comps,
//     after winsorizing each comp's multiple at the 95th percentile (see below).
//   * a log-log regression, log(mcap) = a + b * log(tvl), fitted by ordinary least
//     squares over the comps (NOT winsorized: the regression is on log market cap,
//     where one thin-TVL outlier is one point among 118), with the slope clamped
//     to [0.25, 0.9]. A slope below 1 means the market pays a smaller multiple
//     for a bigger TVL, which is what the comps show. The regression's multiple
//     for a protocol is exp(a) * tvl^(b-1).
//   * a category multiple: the median mcap/TVL inside the protocol's own category
//     (winsorized at the 95th percentile first), shrunk toward the global median,
//     (n * catMedian + 8 * M0) / (n + 8), so a category with two comps barely
//     moves the answer and one with twenty does, then clamped to [0.02, 2.5].
//   * fittedMultiple = sqrt(logLogMultiple * categoryMultiple), clamped to
//     [0.02, 2.5], the range the comps actually span (10th to 90th percentile
//     roughly 0.01 to 2.9).
//
// Winsorizing: comp multiples are capped at their 95th percentile (x5.13 on this
// snapshot) before any median is taken. The median is already robust, so the
// global median does not move (x0.241 before and after) and the held-out folds do
// not move either — but three thin categories do: Prediction Market 2.5 -> 0.78,
// Collateral Management 1.57 -> 0.78, Token Locker 2.10 -> 0.71. Before
// winsorizing, one comp (rain, 400x on thin TVL) set the whole Prediction Market
// category multiple to the 2.5 clamp; now it cannot. The program reports the
// 95th percentile and the changed categories in its calibration, so the effect
// can be checked instead of taken on trust.
//
// Small adjustments on top, each capped so the fitted multiple does the work:
//   * growth     = 1 + clamp(change_7d, -40, 80) / 100 * 0.25        (range 0.90..1.20)
//   * maturity   = 0.85 + min(age_days, 1095) / 1095 * 0.30, unknown age -> 1.00
//                  (range 0.85..1.15)
//
//   implied = round(tvl_usd * fittedMultiple * growth * maturity), min 1.
//
// radar-2 also had a breadth term, 1 + min(max(chains - 1, 0), 4) * 0.03.
// It is GONE in radar-3. The leave-one-out ablation (Method tab, computed by
// the program on the same folds) shows dropping breadth improves the mean
// held-out median log error on folds A+B from 1.463 to 1.409 — and improves
// BOTH folds, A 1.379 -> 1.311 and B 1.548 -> 1.508. Dropping growth or
// maturity is mixed across folds (one better, one worse), so those two stay,
// and both are quantities the bounty brief itself names (7-day growth, time
// without a token). Every difference here is small at n = 23-24 per fold and
// the dashboard says so; breadth is dropped because it is the only term whose
// removal helps on both folds, not because the gap is large.
//
// Honesty note, stated in the dashboard too: mcap/TVL is wildly dispersed
// (10th percentile 0.01, median 0.24, 90th percentile 2.9 over the comps), so any
// fitted value is a central estimate with a wide error bar. The program measures
// that error itself, three times, and reports it: see heldOutTest() below.
// radar-2's published held-out numbers (1.28 / 1.62) scored the fitted multiple
// ALONE, not the implied value the board actually ranks by; radar-3 scores the
// full implied value (fitted x growth x maturity), so its numbers are not
// directly comparable to radar-2's. The fitted-multiple-only numbers are
// unchanged (fold A 1.2811, fold B 1.618, fold C 1.1966) and appear as the
// "fitted multiple only" row of the ablation table.
//
// Token odds (12-month launch prior) are NOT a fitted forecast — the snapshot has
// no launch labels, so no such fit exists. They are a stated prior built from the
// peers' record: the share of protocols in the same TVL band x age band that
// record a token, shrunk toward the overall share (prior weight 10), then
// discounted for time already spent tokenless (a protocol that has run 3+ years
// with no token has already passed most launch windows) and nudged by growth.
//   odds = clamp(peerRate * ageDiscount * growthNudge, 0.05, 0.85)
// The dashboard shows the peer rate and the discount, so the number can be
// argued with instead of taken on trust.
//
// Farm economics (new in radar-3): every row carries a verdict, FARM / THIN /
// SKIP, from numbers the farm plan itself already states. Cash cost = gas per
// transaction (the midpoint of the range the plan's text states for the
// protocol's first chain) x the number of transactions the plan implies
// (1 setup + 1 second action + 1 qualifying action per week of the hold +
// 1 on-chain check) + the opportunity cost of the locked capital (10% a year
// for the hold, an ASSUMPTION stated on the dashboard, not a fact).
// Expected farmer value = token_odds x implied_value x ASSUMED_SHARE, where
// ASSUMED_SHARE = 0.000005: an ASSUMPTION, not a fact — 5% of the implied
// value is assumed to be allocated to an airdrop pool, and a typical farmer
// is assumed to capture 1/10,000 of that pool. The dashboard states both
// numbers and also shows breakeven_share = cash_cost / (odds x implied), the
// share a farmer would need to break even, so the verdict can be re-derived
// under any other share assumption. Verdict: FARM when EV > 2x cash cost,
// THIN when EV > cash cost, SKIP otherwise.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label. */
export const MODEL_VERSION = 'radar-3';

/** Board size: every watchlist row plus this many early rows below the floor. */
export const EARLY_ROWS = 260;

/** Live-token comps shown in the dashboard's separate view, by market cap. */
export const LIVE_ROWS = 24;

/** Assumed share of implied value a typical farmer captures: 5% of implied
 *  value assumed allocated to an airdrop pool, x 1/10,000 of that pool.
 *  An assumption, stated wherever the verdict is shown — not a fact. */
export const FARM_ASSUMED_SHARE = 0.000005;

/** Assumed annual opportunity cost of locked farm capital (10%/year). */
export const FARM_OPPORTUNITY_RATE = 0.1;

/** The shares the verdict-sensitivity table is computed at: 10x below, the
 *  assumed share, and 10x above it. The headline 42/24/117 split is the
 *  middle row; the other two rows show how far it moves when the one
 *  assumption the verdict rests on is wrong by a factor of ten. */
export const FARM_SENSITIVITY_SHARES = [0.0000005, 0.000005, 0.00005];

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The fitted calibration, computed from the snapshot's live-token comps. */
export interface Calibration {
  comps: number;
  global_median_multiple: number;
  loglog_intercept: number;
  loglog_slope: number;
  category_multiples: Record<string, number>;
  multiple_floor: number;
  multiple_cap: number;
  winsor_p95_multiple: number;
  winsor_changed_categories: string[];
}

/** One held-out fold: fit on the train comps, score the test comps. */
export interface HeldOutFold {
  fold: string;
  train: number;
  test: number;
  median_abs_log_error: number;
  within_2x: number;
  within_3x: number;
  baseline_median_abs_log_error: number;
  baseline_within_2x: number;
}

/** The three held-out folds, so the fit is tested three times. */
export interface HeldOutReport {
  method: string;
  folds: HeldOutFold[];
}

/** One ablation variant: the same folds, one term (or the whole blend) removed. */
export interface AblationRow {
  variant: string;
  fold_a: number;
  fold_b: number;
  mean_ab: number;
  fold_c: number;
}

/** The leave-one-out ablation table, computed by the program on folds A, B, C. */
export interface AblationReport {
  method: string;
  rows: AblationRow[];
}

/** A farm verdict: FARM when EV > 2x cash cost, THIN when EV > cash cost, else SKIP. */
export type FarmVerdict = 'FARM' | 'THIN' | 'SKIP';

/** One row of the verdict-sensitivity table: the FARM/THIN/SKIP split the
 *  whole board would get if the assumed farmer share were this instead. */
export interface FarmSensitivityRow {
  share: number;
  farm: number;
  thin: number;
  skip: number;
}

/** The farm economics of one row, all derived from the row's own farm plan. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  weekly_txns: number;
  txns: number;
  gas_per_tx_usd: number;
  gas_cost_usd: number;
  opportunity_cost_usd: number;
  cash_cost_usd: number;
  expected_value_usd: number;
  breakeven_share: number;
  verdict: FarmVerdict;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  token_odds_12m: number;
  model: {
    fitted_multiple: number;
    loglog_multiple: number;
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    peer_token_rate: number;
    age_discount: number;
    age_days: number | null;
  };
  farm_steps: string[];
  farm_ev_usd: number;
  farm_cash_cost_usd: number;
  farm_breakeven_share: number;
  farm_verdict: FarmVerdict;
  farm_verdict_share_low: FarmVerdict;
  farm_verdict_share_high: FarmVerdict;
  farm_capital_usd: number;
  farm_hold_days: number;
  farm_txns: number;
  farm_gas_per_tx_usd: number;
  integrity_flags: string[];
}

/** A board row's compact form for data.js (farm steps included, so the page shows exactly what board.json carries). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  token_odds_12m: number;
  fitted_multiple: number;
  loglog_multiple: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  peer_token_rate: number;
  age_discount: number;
  farm_steps: string[];
  farm_ev_usd: number;
  farm_cash_cost_usd: number;
  farm_breakeven_share: number;
  farm_verdict: FarmVerdict;
  farm_verdict_share_low: FarmVerdict;
  farm_verdict_share_high: FarmVerdict;
  farm_capital_usd: number;
  farm_hold_days: number;
  farm_txns: number;
  farm_gas_per_tx_usd: number;
  integrity_flags: string[];
}

/** One live-token comp, for the dashboard's separate view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  calibration: Calibration;
  heldout: HeldOutReport;
  ablation: AblationReport;
  verdict_counts: { farm: number; thin: number; skip: number };
  farm_sensitivity: FarmSensitivityRow[];
  farm_assumptions: {
    assumed_share: number;
    airdrop_pool_share: number;
    farmer_pool_share: number;
    opportunity_rate_annual: number;
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_total: number;
  pre_token_total: number;
  excluded_total: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round10 = (n: number): number => Math.round(n * 1e10) / 1e10;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The q-th percentile (nearest-rank) of a list of numbers. */
function percentile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Categories that are a wrapped, staked or bridged product of another token, not a launch of their own. */
const EXCLUDED_EARLY_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A live-token comp: it trades, has a market cap, and is not an exchange. */
export function isComp(p: SnapshotProtocol): boolean {
  return (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- fitting

function fitLogLog(comps: SnapshotProtocol[]): { intercept: number; slope: number } {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den > 0 ? clamp(num / den, 0.25, 0.9) : 0.5;
  return { intercept: my - slope * mx, slope };
}

interface Fit {
  globalMedian: number;
  intercept: number;
  slope: number;
  catMult: Record<string, number>;
  winsorP95: number;
  winsorChanged: string[];
}

function fitComps(comps: SnapshotProtocol[]): Fit {
  const rawMultiples = comps.map((p) => p.mcap_usd! / p.tvl_usd);
  // Winsorize at the 95th percentile before any median is taken, so one
  // thin-TVL outlier (a single comp at 400x) cannot set a whole category.
  // The log-log regression is NOT winsorized: it fits log market cap, where
  // that comp is one point among 118.
  const winsorP95 = percentile(rawMultiples, 0.95);
  const wins = (m: number): number => Math.min(m, winsorP95);
  const globalMedian = median(rawMultiples.map(wins));
  const { intercept, slope } = fitLogLog(comps);
  const byCat = new Map<string, number[]>();
  const byCatRaw = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(wins(p.mcap_usd! / p.tvl_usd));
    byCat.set(key, arr);
    const raw = byCatRaw.get(key) ?? [];
    raw.push(p.mcap_usd! / p.tvl_usd);
    byCatRaw.set(key, raw);
  }
  const catMult: Record<string, number> = {};
  const winsorChanged: string[] = [];
  for (const [key, values] of byCat) {
    // Shrink toward the global median: 8 phantom protocols at the global rate.
    const shrunk = (vs: number[]): number => clamp((vs.length * median(vs) + 8 * globalMedian) / (vs.length + 8), 0.02, 2.5);
    catMult[key] = shrunk(values);
    if (Math.abs(shrunk(values) - shrunk(byCatRaw.get(key)!)) > 1e-9) winsorChanged.push(key);
  }
  winsorChanged.sort();
  return { globalMedian, intercept, slope, catMult, winsorP95, winsorChanged };
}

/** The fitted multiple for one protocol under a fit: geometric mean of the log-log and category multiples. */
function fittedMultipleFor(p: SnapshotProtocol, fit: Fit): { fitted: number; loglog: number; category: number } {
  const loglog = Math.exp(fit.intercept) * Math.pow(p.tvl_usd, fit.slope - 1);
  const category = fit.catMult[p.category ?? 'Other'] ?? fit.globalMedian;
  const fitted = clamp(Math.sqrt(Math.max(loglog, 1e-9) * Math.max(category, 1e-9)), 0.02, 2.5);
  return { fitted, loglog, category };
}

// ---------------------------------------------------------------- held-out test

/** One ablation variant: which terms the predicted value keeps. */
export type AblationVariant = 'full' | 'no-growth' | 'no-maturity' | 'no-breadth' | 'fitted-only' | 'loglog' | 'category' | 'global';

export const ABLATION_VARIANTS: { variant: AblationVariant; label: string }[] = [
  { variant: 'full', label: 'full (radar-2: growth + maturity + breadth)' },
  { variant: 'no-growth', label: 'no growth' },
  { variant: 'no-maturity', label: 'no maturity' },
  { variant: 'no-breadth', label: 'no breadth (radar-3)' },
  { variant: 'fitted-only', label: 'fitted multiple only (no terms)' },
  { variant: 'loglog', label: 'log-log only' },
  { variant: 'category', label: 'category only' },
  { variant: 'global', label: 'global median only' },
];

/** The predicted market cap of one comp under a fit and a variant. */
function predictMcap(p: SnapshotProtocol, asOf: string, fit: Fit, variant: AblationVariant): number {
  const { fitted, loglog, category } = fittedMultipleFor(p, fit);
  let mult: number;
  if (variant === 'loglog') mult = clamp(loglog, 0.02, 2.5);
  else if (variant === 'category') mult = clamp(category, 0.02, 2.5);
  else if (variant === 'global') mult = fit.globalMedian;
  else mult = fitted;
  const simple = variant === 'loglog' || variant === 'category' || variant === 'global' || variant === 'fitted-only';
  const age = ageDays(asOf, p.listed_at);
  const growthMult = simple || variant === 'no-growth' ? 1 : 1 + (clamp(finite(p.change_7d, 0), -40, 80) / 100) * 0.25;
  const maturityMult = simple || variant === 'no-maturity' ? 1 : age === null ? 1.0 : 0.85 + (Math.min(age, 1095) / 1095) * 0.3;
  // radar-2's breadth term, kept only in the 'full' variant so the ablation
  // can show what removing it does; radar-3 itself does not use it.
  const breadthMult = simple || variant === 'no-breadth' ? 1 : 1 + Math.min(Math.max(p.chains.length - 1, 0), 4) * 0.03;
  return Math.max(1, p.tvl_usd * mult * growthMult * maturityMult * breadthMult);
}

function foldStats(train: SnapshotProtocol[], test: SnapshotProtocol[], asOf: string, variant: AblationVariant): { medianAbsLogError: number; within2x: number; within3x: number; baseMedianAbsLogError: number; baseWithin2x: number } {
  const fit = fitComps(train);
  const errs: number[] = [];
  const baseErrs: number[] = [];
  for (const p of test) {
    errs.push(Math.abs(Math.log(predictMcap(p, asOf, fit, variant) / p.mcap_usd!)));
    baseErrs.push(Math.abs(Math.log((0.25 * p.tvl_usd) / p.mcap_usd!)));
  }
  errs.sort((a, b) => a - b);
  baseErrs.sort((a, b) => a - b);
  const ln2 = Math.log(2);
  const ln3 = Math.log(3);
  return {
    medianAbsLogError: round4(median(errs)),
    within2x: errs.filter((e) => e < ln2).length / errs.length,
    within3x: errs.filter((e) => e < ln3).length / errs.length,
    baseMedianAbsLogError: round4(median(baseErrs)),
    baseWithin2x: baseErrs.filter((e) => e < ln2).length / baseErrs.length,
  };
}

/** The three train/test splits: two disjoint slug folds and one walk-forward fold. */
function foldsOf(comps: SnapshotProtocol[]): { label: string; train: SnapshotProtocol[]; test: SnapshotProtocol[] }[] {
  const sorted = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const out: { label: string; train: SnapshotProtocol[]; test: SnapshotProtocol[] }[] = [];
  for (const [label, offset] of [['A: every 5th, offset 4', 4], ['B: every 5th, offset 1', 1]] as const) {
    out.push({
      label,
      test: sorted.filter((_, i) => i % 5 === offset),
      train: sorted.filter((_, i) => i % 5 !== offset),
    });
  }
  // Walk-forward fold C: fit on the older comps, test on the youngest 20%.
  // Test = the 24 youngest comps by listed_at (ties by slug); comps with no
  // listed_at stay in train. The model is asked to price protocols younger
  // than anything it was fitted on — the closest analogue to pricing a
  // protocol that has not launched yet.
  const withDate = comps.filter((p) => p.listed_at !== null);
  const youngest = [...withDate]
    .sort((a, b) => (a.listed_at! < b.listed_at! ? 1 : a.listed_at! > b.listed_at! ? -1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, Math.round(comps.length * 0.2));
  const testSlugs = new Set(youngest.map((p) => p.slug));
  out.push({
    label: 'C: walk-forward, youngest 20% by listed_at',
    test: comps.filter((p) => testSlugs.has(p.slug)),
    train: comps.filter((p) => !testSlugs.has(p.slug)),
  });
  return out;
}

/**
 * The fit, tested three times, scoring the full implied value radar-3 ranks
 * by (fitted x growth x maturity) — not the fitted multiple alone, which is
 * what radar-2's published numbers scored. The baseline is the starter's
 * flat 0.25 multiple, scored the same way.
 */
export function heldOutTest(comps: SnapshotProtocol[], asOf: string): HeldOutReport {
  const folds: HeldOutFold[] = [];
  for (const f of foldsOf(comps)) {
    const s = foldStats(f.train, f.test, asOf, 'no-breadth');
    folds.push({
      fold: f.label,
      train: f.train.length,
      test: f.test.length,
      median_abs_log_error: s.medianAbsLogError,
      within_2x: Math.round(s.within2x * 100) / 100,
      within_3x: Math.round(s.within3x * 100) / 100,
      baseline_median_abs_log_error: s.baseMedianAbsLogError,
      baseline_within_2x: Math.round(s.baseWithin2x * 100) / 100,
    });
  }
  return {
    method: 'Three held-out folds over the live-token comps, scoring the full implied value (fitted multiple x growth x maturity) against the flat 0.25 baseline. Folds A/B: comps sorted by slug, every 5th held out (disjoint test sets). Fold C (walk-forward): fit on the older comps, test on the youngest 20% by listed_at; comps with no listed_at stay in train.',
    folds,
  };
}

/**
 * Leave-one-out ablation: the same three folds, each variant scored the same
 * way. 'full' is radar-2 (growth + maturity + breadth); 'no-breadth' is the
 * radar-3 model the board actually uses. The simple variants (log-log only,
 * category only, global median only) keep no adjustment term.
 */
export function ablationTest(comps: SnapshotProtocol[], asOf: string): AblationReport {
  const folds = foldsOf(comps);
  const rows: AblationRow[] = ABLATION_VARIANTS.map(({ variant, label }) => {
    const medians = folds.map((f) => foldStats(f.train, f.test, asOf, variant).medianAbsLogError);
    return {
      variant: label,
      fold_a: medians[0]!,
      fold_b: medians[1]!,
      mean_ab: round4((medians[0]! + medians[1]!) / 2),
      fold_c: medians[2]!,
    };
  });
  return {
    method: 'Each variant is fitted and scored on the same three folds (A, B, walk-forward C) as the held-out test. Mean AB is the mean of the fold A and fold B median |log error|s. A term is dropped only if removing it improves the median error on both folds A and B; breadth is the only term that does, so radar-3 drops it.',
    rows,
  };
}

// ---------------------------------------------------------------- token odds

function tvlBand(tvl: number): string {
  if (tvl < 1e7) return '<10M';
  if (tvl < 5e7) return '10-50M';
  if (tvl < 1e8) return '50-100M';
  if (tvl < 5e8) return '100-500M';
  if (tvl < 1e9) return '500M-1B';
  if (tvl < 1e10) return '1-10B';
  return '>=10B';
}

function ageBand(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1095) return '2-3y';
  return '>=3y';
}

/** Discount for time already spent tokenless: the longer the wait so far, the lower the remaining 12-month hazard. A stated prior, not a fitted fact. */
function ageDiscount(age: number | null): number {
  if (age === null) return 0.8;
  if (age < 365) return 1.0;
  if (age < 730) return 0.85;
  if (age < 1095) return 0.7;
  return 0.5;
}

/**
 * Token odds in the next 12 months: the peers' record first. Among all 758
 * protocols, the share in the same TVL band x age band that record a token,
 * shrunk toward the overall share with 10 phantom protocols; then the age
 * discount above, and a small growth nudge (fast-growing TVL is read as a
 * launch being prepared, capped at +10%).
 */
export function tokenOdds(p: SnapshotProtocol, age: number | null, snapshot: Snapshot): { odds: number; peerRate: number; discount: number } {
  const hasToken = (q: SnapshotProtocol): boolean => !isPreToken(q);
  const overall = snapshot.protocols.filter(hasToken).length / snapshot.protocols.length;
  const band = tvlBand(p.tvl_usd);
  const ab = ageBand(age);
  const peers = snapshot.protocols.filter((q) => tvlBand(q.tvl_usd) === band && ageBand(ageDays(snapshot.as_of, q.listed_at)) === ab);
  const peerRate = (peers.filter(hasToken).length + 10 * overall) / (peers.length + 10);
  const discount = ageDiscount(age);
  const growthNudge = 1 + clamp(finite(p.change_7d, 0), -20, 40) / 400;
  const odds = clamp(peerRate * discount * growthNudge, 0.05, 0.85);
  return { odds: Math.round(odds * 100) / 100, peerRate: round4(peerRate), discount };
}

// ---------------------------------------------------------------- scoring

/** The multipliers and the implied value one protocol gets. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, fit: Fit, snapshot: Snapshot): {
  implied: number;
  fitted: number;
  loglog: number;
  category: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  odds: number;
  peerRate: number;
  discount: number;
} {
  const age = ageDays(asOf, p.listed_at);
  const { fitted, loglog, category } = fittedMultipleFor(p, fit);
  const growthMult = 1 + (clamp(finite(p.change_7d, 0), -40, 80) / 100) * 0.25;
  const maturityMult = age === null ? 1.0 : 0.85 + (Math.min(age, 1095) / 1095) * 0.3;
  const implied = Math.max(1, Math.round(p.tvl_usd * fitted * growthMult * maturityMult));
  const { odds, peerRate, discount } = tokenOdds(p, age, snapshot);
  return { implied, fitted, loglog, category, growthMult, maturityMult, age, odds, peerRate, discount };
}

/** Data-quality flags for one row, from the snapshot alone — never from the model's own output. */
export function integrityFlags(
  p: SnapshotProtocol,
  s: { fitted: number; category: number; odds: number },
  compCountByCategory: Map<string, number>,
): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('change_7d missing');
  if (p.listed_at === null) flags.push('listed_at missing (age unknown)');
  const nCat = compCountByCategory.get(p.category ?? 'Other') ?? 0;
  if (nCat <= 1) flags.push('category has 1 live comp');
  if (s.fitted <= 0.02 + 1e-9 || s.fitted >= 2.5 - 1e-9) flags.push('fitted multiple clamped');
  if (s.category <= 0.02 + 1e-9 || s.category >= 2.5 - 1e-9) flags.push('category multiple clamped');
  if (s.odds <= 0.05 + 1e-9 || s.odds >= 0.85 - 1e-9) flags.push('token odds clamped');
  return flags;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; calibration: Calibration; heldout: HeldOutReport; ablation: AblationReport } {
  const comps = snapshot.protocols.filter(isComp);
  const fit = fitComps(comps);
  const calibration: Calibration = {
    comps: comps.length,
    global_median_multiple: round4(fit.globalMedian),
    loglog_intercept: round4(fit.intercept),
    loglog_slope: round4(fit.slope),
    category_multiples: Object.fromEntries(Object.entries(fit.catMult).map(([k, v]) => [k, round4(v)])),
    multiple_floor: 0.02,
    multiple_cap: 2.5,
    winsor_p95_multiple: round4(fit.winsorP95),
    winsor_changed_categories: fit.winsorChanged,
  };
  const heldout = heldOutTest(comps, snapshot.as_of);
  const ablation = ablationTest(comps, snapshot.as_of);

  const compCountByCategory = new Map<string, number>();
  for (const p of comps) {
    const key = p.category ?? 'Other';
    compCountByCategory.set(key, (compCountByCategory.get(key) ?? 0) + 1);
  }

  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, whatever its category.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, scored by the
  // model itself (not by raw TVL), skipping wrapped/staked/bridged products.
  // First score every candidate, then take the strongest EARLY_ROWS.
  const candidates = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && !EXCLUDED_EARLY_CATEGORIES.has(p.category ?? '') && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, fit, snapshot) }))
    .sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const c of candidates) chosen.set(c.p.slug, c.p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, fit, snapshot) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((row, i) => {
    const econ = farmEconomics(row.p, row.s.age, row.s.odds, row.s.implied);
    return {
      rank: i + 1,
      slug: row.p.slug,
      name: row.p.name,
      category: row.p.category,
      chains: row.p.chains,
      tvl_usd: row.p.tvl_usd,
      change_7d: row.p.change_7d,
      mcap_usd: row.p.mcap_usd,
      listed_at: row.p.listed_at,
      gecko_id: row.p.gecko_id,
      symbol: row.p.symbol,
      token_status: 'pre-token',
      age_days: row.s.age,
      implied_value_usd: row.s.implied,
      token_odds_12m: row.s.odds,
      model: {
        fitted_multiple: round4(row.s.fitted),
        loglog_multiple: round4(row.s.loglog),
        category_multiple: round4(row.s.category),
        growth_multiplier: round4(row.s.growthMult),
        maturity_multiplier: round4(row.s.maturityMult),
        peer_token_rate: row.s.peerRate,
        age_discount: row.s.discount,
        age_days: row.s.age,
      },
      farm_steps: farmSteps(row.p, row.s.age).map(stepText),
      farm_ev_usd: econ.expected_value_usd,
      farm_cash_cost_usd: econ.cash_cost_usd,
      farm_breakeven_share: econ.breakeven_share,
      farm_verdict: econ.verdict,
      farm_verdict_share_low: farmVerdictAtShare(row.s.odds, row.s.implied, econ.cash_cost_usd, FARM_SENSITIVITY_SHARES[0]!),
      farm_verdict_share_high: farmVerdictAtShare(row.s.odds, row.s.implied, econ.cash_cost_usd, FARM_SENSITIVITY_SHARES[2]!),
      farm_capital_usd: econ.capital_usd,
      farm_hold_days: econ.hold_days,
      farm_txns: econ.txns,
      farm_gas_per_tx_usd: econ.gas_per_tx_usd,
      integrity_flags: integrityFlags(row.p, row.s, compCountByCategory),
    };
  });
  return { board, calibration, heldout, ablation };
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas per transaction, by the protocol's first chain: L1/L2 economics, not a guess per protocol. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $6-$14 of gas per transaction';
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('movement') || c.includes('near')) return 'under $0.10 of gas per transaction';
  if (c.includes('bitcoin') || c.includes('bob') || c.includes('rootstock')) return 'about $2-$8 of network fees per transaction';
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('polygon') || c.includes('zksync') || c.includes('linea') || c.includes('blast') || c.includes('scroll') || c.includes('mantle') || c.includes('mode') || c.includes('opbnb')) return 'about $0.10-$1 of gas per transaction';
  return 'about $1-$4 of gas per transaction';
}

/**
 * Gas per transaction in dollars: the midpoint of the range gasFor() states
 * for the same chain, so the farm verdict's cash cost is the plan's own
 * numbers, not a second set. Ethereum $10 (of $6-$14), Solana-class $0.05
 * (of under $0.10), Bitcoin-class $5 (of $2-$8), L2 $0.55 (of $0.10-$1),
 * other chains $2.50 (of $1-$4).
 */
export function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 10;
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('movement') || c.includes('near')) return 0.05;
  if (c.includes('bitcoin') || c.includes('bob') || c.includes('rootstock')) return 5;
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('polygon') || c.includes('zksync') || c.includes('linea') || c.includes('blast') || c.includes('scroll') || c.includes('mantle') || c.includes('mode') || c.includes('opbnb')) return 0.55;
  return 2.5;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The verdict one row would get under a different assumed farmer share.
 *  Uses the same rounding as farmEconomics (EV rounded to cents), so at
 *  FARM_ASSUMED_SHARE this reproduces the row's own verdict exactly. */
export function farmVerdictAtShare(odds: number, implied: number, cashCost: number, share: number): FarmVerdict {
  const ev = round2(odds * implied * share);
  return ev > 2 * cashCost ? 'FARM' : ev > cashCost ? 'THIN' : 'SKIP';
}

/** The whole board's FARM/THIN/SKIP split at each sensitivity share. */
export function farmSensitivity(board: BoardRow[]): FarmSensitivityRow[] {
  return FARM_SENSITIVITY_SHARES.map((share) => {
    let farm = 0;
    let thin = 0;
    let skip = 0;
    for (const r of board) {
      const v = farmVerdictAtShare(r.token_odds_12m, r.implied_value_usd, r.farm_cash_cost_usd, share);
      if (v === 'FARM') farm++;
      else if (v === 'THIN') thin++;
      else skip++;
    }
    return { share, farm, thin, skip };
  });
}

/**
 * The farm economics of one row. Cash cost = gas per transaction x the
 * transactions the plan implies (1 setup + 1 second action + 1 qualifying
 * action per week of the hold + 1 on-chain check) + the opportunity cost of
 * the locked capital at FARM_OPPORTUNITY_RATE a year. Expected value =
 * token odds x implied value x FARM_ASSUMED_SHARE (an assumption, stated
 * wherever the verdict is shown). Verdict: FARM when EV > 2x cash cost,
 * THIN when EV > cash cost, SKIP otherwise. Because the whole split rests on
 * that one assumed share, the program also computes the split at 10x below
 * and 10x above it (farmSensitivity) and the verdict each row would get at
 * those shares, so the dashboard can show how assumption-driven the headline
 * split is — and every row carries its breakeven share, the assumption-free number.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, odds: number, implied: number): FarmEconomics {
  const capital = capitalFor(p);
  const holdDays = holdDaysFor(age);
  const weeklyTxns = Math.floor(holdDays / 7);
  const txns = 1 + 1 + weeklyTxns + 1;
  const gasPerTxUsd = gasPerTx(chainOf(p));
  const gasCost = round2(gasPerTxUsd * txns);
  const opportunityCost = round2((capital * FARM_OPPORTUNITY_RATE * holdDays) / 365);
  const cashCost = round2(gasCost + opportunityCost);
  const expectedValue = round2(odds * implied * FARM_ASSUMED_SHARE);
  const breakeven = odds * implied > 0 ? round10(cashCost / (odds * implied)) : 1;
  const verdict: FarmVerdict = expectedValue > 2 * cashCost ? 'FARM' : expectedValue > cashCost ? 'THIN' : 'SKIP';
  return {
    capital_usd: capital,
    hold_days: holdDays,
    weekly_txns: weeklyTxns,
    txns,
    gas_per_tx_usd: gasPerTxUsd,
    gas_cost_usd: gasCost,
    opportunity_cost_usd: opportunityCost,
    cash_cost_usd: cashCost,
    expected_value_usd: expectedValue,
    breakeven_share: breakeven,
    verdict,
  };
}

/** The category's main action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('option')) return `Deposit $${capital} of USDC into an ${name} options vault on ${chain}.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action for the same category: one position is rarely enough. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $10 of USDC against the deposit on ${name}, then repay it a week later.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $10 through ${name}'s main pool on ${chain} in a separate week from the deposit.`;
  if (c.includes('bridge')) return `Bridge $10 back through ${name} the following week so both directions are on record.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim or restake the staking rewards on ${name} once they appear.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a fresh $10 position the next week.`;
  if (c.includes('prediction')) return `Settle the first market on ${name}, then place a second $5 position.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Top up the ${name} vault with $10 in a later week so the position shows repeat deposits.`;
  return `Do a second on-chain action on ${name} — a swap, a vote or a small extra deposit — in a later week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, first chain, TVL, age);
 * no name is ever special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeklyGas = gas.includes('$6') ? 'about $6-$14 of gas a week' : gas.includes('under $0.10') ? 'under $0.10 of gas a week' : gas.includes('$2-$8') ? 'about $2-$8 of gas a week' : gas.includes('$0.10-$1') ? 'about $0.10-$1 of gas a week' : 'about $1-$4 of gas a week';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: `$10 of capital plus ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet shows steady activity.`,
      cost: weeklyGas,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open the protocol's own points or rewards page and check the wallet's eligibility, then do one listed on-chain task if it is cheap.`,
      cost: gas,
      time: '10 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and claim only from the link the protocol itself publishes — never pay anyone to claim for you.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token comps, by market cap, for the dashboard's separate view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && (p.mcap_usd ?? 0) > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration, heldout, ablation } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const excluded = snapshot.protocols.filter((p) => isPreToken(p) && (EXCLUDED_EARLY_CATEGORIES.has(p.category ?? '') || p.category === 'CEX' || VERSIONED.test(p.name))).length;
  const verdictCounts = {
    farm: board.filter((r) => r.farm_verdict === 'FARM').length,
    thin: board.filter((r) => r.farm_verdict === 'THIN').length,
    skip: board.filter((r) => r.farm_verdict === 'SKIP').length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    calibration,
    heldout,
    ablation,
    verdict_counts: verdictCounts,
    farm_sensitivity: farmSensitivity(board),
    farm_assumptions: {
      assumed_share: FARM_ASSUMED_SHARE,
      airdrop_pool_share: 0.05,
      farmer_pool_share: 0.0001,
      opportunity_rate_annual: FARM_OPPORTUNITY_RATE,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    protocols_total: snapshot.protocols.length,
    pre_token_total: preToken,
    excluded_total: excluded,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      token_odds_12m: row.token_odds_12m,
      fitted_multiple: row.model.fitted_multiple,
      loglog_multiple: row.model.loglog_multiple,
      category_multiple: row.model.category_multiple,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      peer_token_rate: row.model.peer_token_rate,
      age_discount: row.model.age_discount,
      farm_steps: row.farm_steps,
      farm_ev_usd: row.farm_ev_usd,
      farm_cash_cost_usd: row.farm_cash_cost_usd,
      farm_breakeven_share: row.farm_breakeven_share,
      farm_verdict: row.farm_verdict,
      farm_verdict_share_low: row.farm_verdict_share_low,
      farm_verdict_share_high: row.farm_verdict_share_high,
      farm_capital_usd: row.farm_capital_usd,
      farm_hold_days: row.farm_hold_days,
      farm_txns: row.farm_txns,
      farm_gas_per_tx_usd: row.farm_gas_per_tx_usd,
      integrity_flags: row.integrity_flags,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.token_odds_12m !== 'number' || r.token_odds_12m < 0.05 || r.token_odds_12m > 0.85) return `${r.slug} has token odds ${r.token_odds_12m}`;
    if (r.farm_verdict !== 'FARM' && r.farm_verdict !== 'THIN' && r.farm_verdict !== 'SKIP') return `${r.slug} has farm verdict ${r.farm_verdict}`;
    if (!(r.farm_cash_cost_usd >= 0) || !(r.farm_ev_usd >= 0)) return `${r.slug} has a negative farm value`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
