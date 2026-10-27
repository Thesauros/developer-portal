/**
 * Strategy Lab — a parameterized backtester for routing strategies.
 *
 * The sandbox engine (engine.js) replays one hard-coded policy: move to the
 * highest APY every 36–96h, free of charge. That is enough to make the API
 * feel alive and useless for deciding whether a policy is any good. This
 * module is the other half: the policy, its costs and its constraints are all
 * inputs, so two configurations can be run against the same rate paths and
 * compared.
 *
 * Three rules keep the numbers honest:
 *
 *  1. No lookahead. A decision on day t sees rates up to and including day t
 *     (a supply rate is observable on-chain the moment you look) and never
 *     day t+1. The one exception is the `oracle_best` baseline, which is
 *     explicitly the unattainable ceiling.
 *  2. Moving money costs money. Every rebalance pays proportional cost plus
 *     gas, and the performance fee is charged on yield, so a strategy that
 *     churns has to out-earn its own friction.
 *  3. Capital has price impact. Supplying into a venue dilutes its rate by
 *     your share of the pool, and capacity is a hard cap. A strategy cannot
 *     win by pretending it can put $50M into a $6M market.
 */

import { buildPaths, REGIMES } from './market-paths.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Small numeric helpers
 * ------------------------------------------------------------------ */

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** Nearest-rank percentile, p in [0,1]. */
function percentile(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
/** Least-squares slope per index step. */
function slope(a) {
  const n = a.length;
  if (n < 2) return 0;
  const xbar = (n - 1) / 2;
  const ybar = mean(a);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (a[i] - ybar);
    den += (i - xbar) * (i - xbar);
  }
  return den === 0 ? 0 : num / den;
}

/** Abramowitz & Stegun 7.1.26 error function, |error| < 1.5e-7. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
/**
 * Two-sided p-value for a z statistic under the normal approximation.
 * Floored at 1e-6: the erf approximation carries ~1.5e-7 of absolute error,
 * so anything smaller is noise in the arithmetic, not evidence. Reporting a
 * flat 0 would claim a certainty the method cannot deliver.
 */
function twoSidedP(z) {
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return Math.max(1e-6, Math.min(1, Number(p.toPrecision(3))));
}

/* ------------------------------------------------------------------ *
 * Strategy definition
 * ------------------------------------------------------------------ */

export const POLICIES = {
  hold: 'Route once on day 1, then never move. The cost of doing nothing.',
  best_apy: 'Always chase the highest quoted APY. Ignores risk tier and volatility.',
  risk_adjusted: 'Highest APY after a risk-tier haircut and a volatility penalty.',
  momentum: 'Risk-adjusted score plus a trend term, so a rising venue is preferred to a flat one.',
  top_k: 'Split across the best `max_venues` by score, weighted by score and capped per venue.',
  equal_weight: 'Equal split across every eligible venue, reweighted on the rebalance cadence.',
};

export const DEFAULT_STRATEGY = {
  policy: 'risk_adjusted',
  /** Only move when the target scores this many bps/yr above the incumbent. */
  rebalance_threshold_bps: 40,
  /** Cooldown after a move, in hours. */
  min_hold_hours: 48,
  /** Days of rate history the signal smooths over. */
  lookback_days: 7,
  /** Multiplier applied to a venue's APY by risk tier. */
  risk_penalty: { bluechip: 1.0, core: 0.92, opportunistic: 0.82 },
  /** Score penalty per unit of APY standard deviation over the lookback. */
  vol_penalty: 0.5,
  /** Weight on the 7-day trend term (momentum policy only). */
  momentum_weight: 1.5,
  /** Number of venues held at once (top_k / equal_weight). */
  max_venues: 1,
  /** Hard cap on any single venue's share. */
  max_alloc_pct: 1.0,
  /** Proportional cost of moving capital, in bps of the amount moved. */
  tx_cost_bps: 3,
  /** Fixed gas cost per venue touched in a rebalance, in USD. */
  gas_cost_usd: 1.2,
  /** Protocol performance fee on positive yield. */
  perf_fee_pct: 0.25,
  /** Risk tiers the strategy may route into. */
  allowed_tiers: ['bluechip', 'core', 'opportunistic'],
  /** Dilute a venue's rate by our share of it, and respect its capacity. */
  capacity_aware: true,
  /** Require a move to earn back its cost within `cost_horizon_days`. */
  cost_aware: true,
  /**
   * Payback window for cost_aware, in days. The cooldown is the wrong horizon
   * here: a 48h cooldown means a full-size move would need a ~15pp rate edge
   * to clear its own fee, so cost awareness silently becomes a kill switch.
   * A move is judged on how long we realistically expect to keep it.
   */
  cost_horizon_days: 30,
  /** Force 100% into one venue id, ignoring the policy. Used by baselines. */
  pin_venue: null,
};

/** Named starting points so the lab opens on something meaningful. */
export const PRESETS = [
  {
    id: 'passive_bluechip',
    label: 'Passive bluechip',
    summary: 'Park it in the safest venue and leave it. The floor every other strategy must clear.',
    strategy: { policy: 'hold', allowed_tiers: ['bluechip'], rebalance_threshold_bps: 0 },
  },
  {
    id: 'naive_chaser',
    label: 'Naive APY chaser',
    summary: 'Move to the top rate whenever it changes. The strategy everyone tries first.',
    strategy: {
      policy: 'best_apy',
      rebalance_threshold_bps: 0,
      min_hold_hours: 0,
      lookback_days: 1,
      vol_penalty: 0,
      cost_aware: false,
    },
  },
  {
    id: 'thesauros_default',
    label: 'Thesauros default',
    summary: 'Risk-adjusted score, 40 bps threshold, 48h cooldown, cost-aware. The shipped policy.',
    strategy: {},
  },
  {
    id: 'patient_router',
    label: 'Patient router',
    summary: 'Wide threshold and a long cooldown. Trades upside for far lower turnover.',
    strategy: {
      policy: 'risk_adjusted',
      rebalance_threshold_bps: 120,
      min_hold_hours: 168,
      lookback_days: 14,
    },
  },
  {
    id: 'diversified_three',
    label: 'Diversified (3 venues)',
    summary: 'Spread across three venues, 50% cap each. Lower single-venue exposure.',
    strategy: { policy: 'top_k', max_venues: 3, max_alloc_pct: 0.5, rebalance_threshold_bps: 60 },
  },
  {
    id: 'momentum_tilt',
    label: 'Momentum tilt',
    summary: 'Prefers venues whose rate is climbing, not just high today.',
    strategy: { policy: 'momentum', momentum_weight: 2.5, lookback_days: 10 },
  },
];

/** Merge a partial strategy onto the defaults and validate every field. */
export function normalizeStrategy(input = {}) {
  const s = { ...DEFAULT_STRATEGY, ...input };
  s.risk_penalty = { ...DEFAULT_STRATEGY.risk_penalty, ...(input.risk_penalty || {}) };

  if (!POLICIES[s.policy]) {
    throw invalid(`Unknown policy "${s.policy}". Use one of: ${Object.keys(POLICIES).join(', ')}.`);
  }
  const num = (key, min, max, fallback) => {
    const v = Number(s[key]);
    if (!Number.isFinite(v)) {
      s[key] = fallback;
      return;
    }
    if (v < min || v > max) throw invalid(`${key} must be between ${min} and ${max} (received ${v}).`);
    s[key] = v;
  };
  num('rebalance_threshold_bps', 0, 5000, DEFAULT_STRATEGY.rebalance_threshold_bps);
  num('min_hold_hours', 0, 8760, DEFAULT_STRATEGY.min_hold_hours);
  num('cost_horizon_days', 1, 365, DEFAULT_STRATEGY.cost_horizon_days);
  num('lookback_days', 1, 90, DEFAULT_STRATEGY.lookback_days);
  num('vol_penalty', 0, 50, DEFAULT_STRATEGY.vol_penalty);
  num('momentum_weight', 0, 50, DEFAULT_STRATEGY.momentum_weight);
  num('max_venues', 1, 12, DEFAULT_STRATEGY.max_venues);
  num('max_alloc_pct', 0.05, 1, DEFAULT_STRATEGY.max_alloc_pct);
  num('tx_cost_bps', 0, 1000, DEFAULT_STRATEGY.tx_cost_bps);
  num('gas_cost_usd', 0, 10000, DEFAULT_STRATEGY.gas_cost_usd);
  num('perf_fee_pct', 0, 0.5, DEFAULT_STRATEGY.perf_fee_pct);

  if (!Array.isArray(s.allowed_tiers) || s.allowed_tiers.length === 0) {
    s.allowed_tiers = DEFAULT_STRATEGY.allowed_tiers;
  }
  const tiers = ['bluechip', 'core', 'opportunistic'];
  for (const t of s.allowed_tiers) {
    if (!tiers.includes(t)) throw invalid(`Unknown risk tier "${t}". Use ${tiers.join(', ')}.`);
  }
  // `max_venues` above 1 with a cap that cannot cover 100% is fine; a single
  // venue with a cap below 100% would leave capital unallocated forever.
  if (s.max_venues === 1 && s.max_alloc_pct < 1) s.max_alloc_pct = 1;
  s.capacity_aware = s.capacity_aware !== false;
  s.cost_aware = s.cost_aware !== false;
  s.pin_venue = s.pin_venue ? String(s.pin_venue) : null;
  return s;
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_request' });
}

/* ------------------------------------------------------------------ *
 * The simulator
 * ------------------------------------------------------------------ */

/**
 * Per-venue score on day `t`, from rates in [t-lookback+1 .. t].
 * Ineligible venues score -Infinity so they are never selected.
 */
function scoreVenues(paths, strategy, t) {
  const { venues, series } = paths;
  const from = Math.max(0, t - strategy.lookback_days + 1);
  return venues.map((v, i) => {
    if (!strategy.allowed_tiers.includes(v.risk_tier)) {
      return { i, score: -Infinity, smooth: 0, vol: 0, trend: 0, spot: series[i][t] };
    }
    const win = series[i].slice(from, t + 1);
    const smooth = mean(win);
    const vol = stddev(win);
    const trend = slope(win);
    const rf = strategy.risk_penalty[v.risk_tier] ?? 0.9;
    let score;
    if (strategy.policy === 'best_apy') {
      score = series[i][t];
    } else if (strategy.policy === 'momentum') {
      score = smooth * rf - strategy.vol_penalty * vol + strategy.momentum_weight * trend * 7;
    } else {
      score = smooth * rf - strategy.vol_penalty * vol;
    }
    return { i, score, smooth: round6(smooth), vol: round6(vol), trend: round6(trend), spot: series[i][t] };
  });
}

/**
 * Target weights for a scored venue set. Returns an array aligned to
 * `paths.venues`, summing to 1 (or to 0 when nothing is eligible).
 */
function targetWeights(scored, strategy, paths) {
  const w = new Array(scored.length).fill(0);

  if (strategy.pin_venue) {
    const idx = paths.venues.findIndex((v) => v.id === strategy.pin_venue);
    if (idx >= 0) {
      w[idx] = 1;
      return w;
    }
  }

  const eligible = scored.filter((x) => Number.isFinite(x.score));
  if (!eligible.length) return w;

  if (strategy.policy === 'equal_weight') {
    const take = eligible.slice(0, Math.max(1, Math.min(strategy.max_venues, eligible.length)));
    const share = Math.min(strategy.max_alloc_pct, 1 / take.length);
    for (const e of take) w[e.i] = share;
    return renormalize(w, strategy, paths);
  }

  const ranked = [...eligible].sort((a, b) => b.score - a.score);
  if (strategy.policy === 'top_k' && strategy.max_venues > 1) {
    const take = ranked.slice(0, Math.min(strategy.max_venues, ranked.length));
    // Shift scores positive before weighting so a negative score cannot
    // produce a negative (short) weight.
    const floor = Math.min(...take.map((x) => x.score));
    const shifted = take.map((x) => Math.max(1e-9, x.score - floor + 1e-6));
    const total = shifted.reduce((s, x) => s + x, 0);
    take.forEach((x, k) => {
      w[x.i] = Math.min(strategy.max_alloc_pct, shifted[k] / total);
    });
    return renormalize(w, strategy, paths);
  }

  w[ranked[0].i] = 1;
  return renormalize(w, strategy, paths);
}

/** Rescale to sum 1 while respecting per-venue caps, then capacity. */
function renormalize(w, strategy, paths) {
  let total = w.reduce((s, x) => s + x, 0);
  if (total <= 0) return w;
  const cap = strategy.max_alloc_pct;
  // Water-filling: scale up, clip at the cap, repeat with the remainder.
  for (let pass = 0; pass < 6; pass++) {
    total = w.reduce((s, x) => s + x, 0);
    if (total <= 0 || Math.abs(total - 1) < 1e-9) break;
    const room = w.map((x) => (x > 0 ? cap - x : 0)).reduce((s, x) => s + x, 0);
    if (total > 1) {
      const k = 1 / total;
      for (let i = 0; i < w.length; i++) w[i] *= k;
    } else if (room > 1e-12) {
      const need = 1 - total;
      const k = Math.min(1, need / room);
      for (let i = 0; i < w.length; i++) if (w[i] > 0) w[i] = Math.min(cap, w[i] + (cap - w[i]) * k);
    } else {
      break; // caps make full allocation impossible; the rest stays idle
    }
  }
  return w;
}

/** Cap weights so no venue receives more than its remaining capacity. */
function applyCapacity(w, strategy, paths, equity) {
  if (!strategy.capacity_aware) return w;
  const out = [...w];
  let spill = 0;
  for (let i = 0; i < out.length; i++) {
    const capUsd = paths.venues[i].capacity_usd;
    if (!capUsd || out[i] <= 0) continue;
    const maxW = capUsd / equity;
    if (out[i] > maxW) {
      spill += out[i] - maxW;
      out[i] = maxW;
    }
  }
  // Push the overflow onto venues that still have room, best-score-first order
  // is already encoded in the weights, so distribute proportionally.
  if (spill > 1e-12) {
    const room = out.map((x, i) => {
      const capUsd = paths.venues[i].capacity_usd;
      if (!capUsd) return x > 0 ? Infinity : 0;
      return Math.max(0, capUsd / equity - x);
    });
    const finiteRoom = room.map((r) => (Number.isFinite(r) ? r : spill));
    const totalRoom = finiteRoom.reduce((s, x) => s + x, 0);
    if (totalRoom > 1e-12) {
      for (let i = 0; i < out.length; i++) {
        out[i] += spill * (finiteRoom[i] / totalRoom);
      }
    }
  }
  return out;
}

/**
 * Rate actually earned on `amount` in venue `i`: the quoted rate diluted by
 * our share of the pool. Supplying size into a money market pushes the supply
 * rate down; ignoring that is how a backtest invents returns it cannot get.
 */
function effectiveApy(paths, i, t, amount, strategy) {
  const quoted = paths.series[i][t];
  if (!strategy.capacity_aware) return quoted;
  const depth = paths.venues[i].tvl_usd || paths.venues[i].capacity_usd;
  if (!depth || depth <= 0 || amount <= 0) return quoted;
  return quoted * (depth / (depth + amount));
}

/**
 * Run one strategy over one set of rate paths.
 *
 * @param {object} paths     from buildPaths()
 * @param {object} strategy  normalized strategy
 * @param {object} opts      { capital, label }
 */
export function simulate(paths, strategy, { capital = 1_000_000, label = 'strategy' } = {}) {
  const n = paths.venues.length;
  const days = paths.days;
  const minHoldDays = strategy.min_hold_hours / 24;
  const EPS = 1e-6;

  /**
   * Per-venue balances, not fixed weights. A weight that stays constant while
   * balances compound at different rates is a free daily rebalance — the
   * cheapest way for a backtest to manufacture returns that no one can earn.
   * Holding balances means drift is real and correcting it costs money.
   */
  let pos = new Array(n).fill(0);
  let cash = capital;
  /** Friction-free twin: same target weights, no costs, no fee, no dilution. */
  let grossEquity = capital;

  let feesPaid = 0;
  let costsPaid = 0;
  let turnover = 0;
  let lastMoveDay = -Infinity;

  const equityCurve = [];
  const grossCurve = [];
  const allocation = [];
  const dailyReturn = [];
  const decisions = [];
  const daysInVenue = new Array(n).fill(0);
  let idleDays = 0;

  const sum = (a) => a.reduce((s, x) => s + x, 0);

  for (let t = 0; t < days; t++) {
    let equity = sum(pos) + cash;
    const weights = equity > 0 ? pos.map((x) => x / equity) : new Array(n).fill(0);
    const scored = scoreVenues(paths, strategy, t);
    const holdPolicy = strategy.policy === 'hold' || !!strategy.pin_venue;
    const isFirst = t === 0;

    let target = weights;
    if (isFirst || !holdPolicy) {
      const proposed = applyCapacity(targetWeights(scored, strategy, paths), strategy, paths, equity);
      const drift = 0.5 * proposed.reduce((s, x, i) => s + Math.abs(x - weights[i]), 0);
      const cooled = t - lastMoveDay >= minHoldDays;

      if (isFirst) {
        target = proposed;
      } else if (cooled && drift > EPS) {
        const scoreOf = (w) =>
          w.reduce((s, x, i) => s + x * (Number.isFinite(scored[i].score) ? scored[i].score : 0), 0);
        const gain = scoreOf(proposed) - scoreOf(weights);
        const touched = proposed.reduce((s, x, i) => s + (Math.abs(x - weights[i]) > EPS ? 1 : 0), 0);
        const cost = equity * drift * (strategy.tx_cost_bps / 10000) + strategy.gas_cost_usd * touched;
        // The move has to pay for itself inside the payback window.
        const horizonYears = strategy.cost_horizon_days / 365;
        const expected = equity * gain * horizonYears;
        const passesThreshold = gain * 10000 >= strategy.rebalance_threshold_bps;
        const passesCost = !strategy.cost_aware || expected > cost;
        if (passesThreshold && passesCost) target = proposed;
      }
    }

    // Settle the move in dollars, then charge it, before the day accrues.
    const desired = target.map((w) => w * equity);
    const movedUsd = 0.5 * desired.reduce((s, d, i) => s + Math.abs(d - pos[i]), 0);
    if (movedUsd > equity * EPS) {
      const touched = desired.reduce((s, d, i) => s + (Math.abs(d - pos[i]) > equity * EPS ? 1 : 0), 0);
      const cost = movedUsd * (strategy.tx_cost_bps / 10000) + strategy.gas_cost_usd * touched;
      const apyBefore = equity > 0 ? sum(pos.map((x, i) => (x / equity) * paths.series[i][t])) : 0;
      const apyAfter = equity > 0 ? sum(desired.map((d, i) => (d / equity) * paths.series[i][t])) : 0;
      const from = pos
        .map((x, i) => ({ id: paths.venues[i].id, name: paths.venues[i].name, w: round4(equity > 0 ? x / equity : 0) }))
        .filter((x) => x.w > 0.0001);
      const to = desired
        .map((d, i) => ({ id: paths.venues[i].id, name: paths.venues[i].name, w: round4(equity > 0 ? d / equity : 0) }))
        .filter((x) => x.w > 0.0001);

      // Take the cost off the top, pro rata across the new positions.
      const after = equity - cost;
      const scale = equity > 0 ? after / equity : 0;
      pos = desired.map((d) => d * scale);
      cash = after - sum(pos);
      costsPaid += cost;
      turnover += equity > 0 ? movedUsd / equity : 0;
      lastMoveDay = t;
      equity = after;

      decisions.push({
        day: t,
        at: new Date(paths.start + t * DAY_MS).toISOString(),
        type: isFirst ? 'initial_routing' : 'rebalance',
        from,
        to,
        moved_usd: round2(movedUsd),
        turnover_pct: round4((movedUsd / Math.max(1, equity + cost)) * 100),
        cost_usd: round2(cost),
        apy_before: round6(apyBefore),
        apy_after: round6(apyAfter),
        gain_bps: round2((apyAfter - apyBefore) * 10000),
        rationale: isFirst
          ? `Initial routing into ${to.map((x) => x.name).join(', ')} at ${(apyAfter * 100).toFixed(2)}%.`
          : `Moved $${Math.round(movedUsd).toLocaleString('en-US')} into ${to
              .map((x) => x.name)
              .join(', ')} for ${((apyAfter - apyBefore) * 10000).toFixed(0)} bps of quoted rate, costing $${cost.toFixed(
              2,
            )}.`,
      });
    }

    // Accrue the day. Each venue pays the rate it offers on the size we put in.
    const openingEquity = sum(pos) + cash;
    let grossWeighted = 0;
    let allocated = 0;
    for (let i = 0; i < n; i++) {
      const w = openingEquity > 0 ? pos[i] / openingEquity : 0;
      grossWeighted += w * paths.series[i][t];
      if (pos[i] <= 0) continue;
      allocated += w;
      daysInVenue[i] += 1;
      const earned = pos[i] * (effectiveApy(paths, i, t, pos[i], strategy) / 365);
      const fee = Math.max(0, earned) * strategy.perf_fee_pct;
      feesPaid += fee;
      pos[i] += earned - fee;
    }
    if (allocated < 0.999) idleDays += 1;
    grossEquity *= 1 + grossWeighted / 365;

    const closingEquity = sum(pos) + cash;
    equityCurve.push(round2(closingEquity));
    grossCurve.push(round2(grossEquity));
    dailyReturn.push(openingEquity > 0 ? closingEquity / openingEquity - 1 : 0);
    allocation.push(
      closingEquity > 0 ? pos.map((x) => round4(x / closingEquity)) : new Array(n).fill(0),
    );
  }

  return finalize({
    label,
    paths,
    strategy,
    capital,
    equityCurve,
    grossCurve,
    dailyReturn,
    allocation,
    decisions,
    daysInVenue,
    feesPaid,
    costsPaid,
    turnover,
    idleDays,
  });
}

function venueName(paths, id) {
  const v = paths.venues.find((x) => x.id === id);
  return v ? v.name : id;
}

/** Derive the reported metrics from a finished run. */
function finalize(run) {
  const { paths, capital, equityCurve, grossCurve, dailyReturn, daysInVenue } = run;
  const days = paths.days;
  const final = equityCurve[equityCurve.length - 1] ?? capital;
  const years = days / 365;

  // Compounded annualized return. Guard the degenerate total-loss case.
  const growth = capital > 0 ? final / capital : 1;
  const netApy = years > 0 && growth > 0 ? Math.pow(growth, 1 / years) - 1 : 0;
  const grossFinal = grossCurve[grossCurve.length - 1] ?? capital;
  const grossApy = years > 0 && grossFinal > 0 ? Math.pow(grossFinal / capital, 1 / years) - 1 : 0;

  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }

  const vol = stddev(dailyReturn) * Math.sqrt(365);
  const rebalances = run.decisions.filter((d) => d.type === 'rebalance').length;

  return {
    object: 'backtest_run',
    label: run.label,
    strategy: run.strategy,
    metrics: {
      final_value: round2(final),
      pnl: round2(final - capital),
      total_return_pct: round4((growth - 1) * 100),
      net_apy: round6(netApy),
      gross_apy: round6(grossApy),
      /** What the friction cost, annualized: gross APY minus net APY. */
      drag_bps: round2((grossApy - netApy) * 10000),
      fees_usd: round2(run.feesPaid),
      costs_usd: round2(run.costsPaid),
      rebalances,
      turnover_pct: round4(run.turnover * 100),
      /** Average days between moves; null when the strategy never moved. */
      avg_hold_days: rebalances > 0 ? round2(days / rebalances) : null,
      max_drawdown_pct: round4(maxDd * 100),
      apy_volatility: round6(vol),
      idle_days: run.idleDays,
      time_in_venue: paths.venues.map((v, i) => ({
        vault_id: v.id,
        name: v.name,
        days: daysInVenue[i],
        share_pct: round4((daysInVenue[i] / days) * 100),
      })).filter((x) => x.days > 0),
    },
    series: {
      t: Array.from({ length: days }, (_, i) => paths.start + i * DAY_MS),
      equity: equityCurve,
      gross_equity: grossCurve,
      allocation: run.allocation,
    },
    decisions: run.decisions,
  };
}

/* ------------------------------------------------------------------ *
 * Baselines
 * ------------------------------------------------------------------ */

/**
 * The comparisons a strategy has to beat to be worth deploying.
 *
 * `oracle_best` is the ex-post best single venue. It uses information no
 * strategy can have and exists only to show the ceiling — how much of the
 * available spread the strategy actually captured.
 */
export function runBaselines(paths, { capital, perf_fee_pct, tx_cost_bps, gas_cost_usd }) {
  const shared = { perf_fee_pct, tx_cost_bps, gas_cost_usd };
  const pinned = (venueId, label, extra = {}) =>
    simulate(paths, normalizeStrategy({ ...shared, policy: 'hold', pin_venue: venueId, ...extra }), {
      capital,
      label,
    });
  const out = [];

  // 1. The safest thing a treasury would do without us: the deepest bluechip.
  const bluechip = paths.venues
    .filter((v) => v.risk_tier === 'bluechip')
    .sort((a, b) => (b.tvl_usd || 0) - (a.tvl_usd || 0))[0];
  if (bluechip) {
    const run = pinned(bluechip.id, 'bluechip_hold');
    run.note = `Hold ${bluechip.name} for the whole window — the passive bluechip floor.`;
    out.push(run);
  }

  // 2. Route once on day 1 with the full risk-adjusted signal, then never move.
  //    Isolates the value of *rebalancing* from the value of *picking well*.
  const firstPick = simulate(paths, normalizeStrategy({ ...shared, policy: 'hold' }), {
    capital,
    label: 'hold_best_at_start',
  });
  firstPick.note = 'Best venue on day 1, held to the end. Isolates rebalancing from initial selection.';
  out.push(firstPick);

  // 3. Naive diversification: equal split, reweighted monthly.
  const eq = simulate(
    paths,
    normalizeStrategy({
      ...shared,
      policy: 'equal_weight',
      max_venues: paths.venues.length,
      max_alloc_pct: 1,
      rebalance_threshold_bps: 0,
      min_hold_hours: 720,
      cost_aware: false,
    }),
    { capital, label: 'equal_weight' },
  );
  eq.note = 'Equal split across every venue, reweighted monthly.';
  out.push(eq);

  // 4. Ex-post ceiling. Compounds each venue's realised path to find the one
  //    that turned out best, then holds it from day 1 — which requires knowing
  //    the future. Reported to show how much of the spread was capturable.
  let best = paths.venues[0];
  let bestGrowth = -Infinity;
  paths.venues.forEach((v, i) => {
    const growth = paths.series[i].reduce((acc, apy) => acc * (1 + apy / 365), 1);
    if (growth > bestGrowth) {
      bestGrowth = growth;
      best = v;
    }
  });
  const oracle = pinned(best.id, 'oracle_best');
  oracle.note = `Ex-post best single venue (${best.name}). Requires future information — the ceiling, not an achievable result.`;
  out.push(oracle);

  return out;
}

/* ------------------------------------------------------------------ *
 * Single backtest
 * ------------------------------------------------------------------ */

/**
 * Run one strategy plus its baselines over one freshly built set of paths.
 *
 * @param {object} req
 * @param {'synthetic'|'historical'} [req.mode]
 * @param {string} [req.asset]
 * @param {number} [req.days]
 * @param {number} [req.capital]
 * @param {string} [req.seed]
 * @param {string} [req.regime]
 * @param {string[]} [req.venue_ids]
 * @param {object} [req.strategy]
 */
export async function runBacktest(req = {}) {
  const strategy = normalizeStrategy(req.strategy);
  const capital = validCapital(req.capital);
  const paths = await buildPaths({
    mode: req.mode,
    asset: req.asset,
    days: req.days,
    seed: req.seed || 'lab',
    regime: req.regime,
    venue_ids: req.venue_ids,
  });

  const run = simulate(paths, strategy, { capital, label: req.label || 'strategy' });
  const baselines = runBaselines(paths, {
    capital,
    perf_fee_pct: strategy.perf_fee_pct,
    tx_cost_bps: strategy.tx_cost_bps,
    gas_cost_usd: strategy.gas_cost_usd,
  });

  return {
    object: 'backtest',
    as_of: new Date().toISOString(),
    market: marketSummary(paths),
    capital,
    run,
    baselines: baselines.map((b) => ({
      label: b.label,
      note: b.note || null,
      metrics: b.metrics,
      series: { equity: b.series.equity },
    })),
    comparison: baselines.map((b) => ({
      baseline: b.label,
      uplift_usd: round2(run.metrics.final_value - b.metrics.final_value),
      uplift_bps: round2((run.metrics.net_apy - b.metrics.net_apy) * 10000),
      beats: run.metrics.final_value > b.metrics.final_value,
    })),
    disclaimer: disclaimerFor(paths),
  };
}

function validCapital(v) {
  const c = Number(v);
  if (v === undefined || v === null || v === '') return 1_000_000;
  if (!Number.isFinite(c) || c < 1000 || c > 1e10) {
    throw invalid('capital must be a number between 1,000 and 10,000,000,000.');
  }
  return c;
}

function marketSummary(paths) {
  return {
    mode: paths.mode,
    provenance: paths.provenance,
    asset: paths.asset,
    days: paths.days,
    seed: paths.seed,
    regime: paths.regime,
    start: paths.start,
    warnings: paths.warnings,
    venues: paths.venues.map((v, i) => ({
      id: v.id,
      name: v.name,
      provider: v.provider,
      chain: v.chain,
      risk_tier: v.risk_tier,
      tvl_usd: v.tvl_usd,
      capacity_usd: v.capacity_usd,
      apy_start: paths.series[i][0],
      apy_end: paths.series[i][paths.series[i].length - 1],
      apy_mean: round6(mean(paths.series[i])),
      apy_stddev: round6(stddev(paths.series[i])),
      apy: paths.series[i],
    })),
  };
}

function disclaimerFor(paths) {
  return paths.mode === 'historical'
    ? 'Backtest over real historical APY. Past venue rates do not predict future rates, and the simulation ignores gas spikes, bridge risk, oracle failure and smart-contract loss.'
    : 'Backtest over simulated APY paths. Results describe the behaviour of this rate model, not of any real market. Use mode=historical for a claim about rates that actually happened.';
}

/* ------------------------------------------------------------------ *
 * Experiments: A/B variants + a hypothesis verdict
 * ------------------------------------------------------------------ */

/**
 * Below this many paired samples the normal approximation is not trustworthy
 * and a "significant" label would be manufactured confidence. Historical mode
 * routinely lands here — a year of history only yields a handful of
 * non-overlapping blocks — so the verdict says "underpowered" rather than
 * pretending three blocks settled the question.
 */
const MIN_SAMPLES_FOR_SIGNIFICANCE = 8;

export const METRICS = {
  net_apy: { label: 'Net APY', unit: 'bps', scale: 10000, higher_is_better: true },
  final_value: { label: 'Final value', unit: 'usd', scale: 1, higher_is_better: true },
  total_return_pct: { label: 'Total return', unit: 'pct', scale: 1, higher_is_better: true },
  max_drawdown_pct: { label: 'Max drawdown', unit: 'pct', scale: 1, higher_is_better: false },
  rebalances: { label: 'Rebalances', unit: 'count', scale: 1, higher_is_better: false },
  costs_usd: { label: 'Rebalance costs', unit: 'usd', scale: 1, higher_is_better: false },
  turnover_pct: { label: 'Turnover', unit: 'pct', scale: 1, higher_is_better: false },
  apy_volatility: { label: 'Return volatility', unit: 'bps', scale: 10000, higher_is_better: false },
  drag_bps: { label: 'Friction drag', unit: 'bps', scale: 1, higher_is_better: false },
};

/**
 * Run two or more variants over the same rate paths, repeatedly, and report
 * whether the stated hypothesis survives.
 *
 * Variants are *paired*: on every sample every variant sees an identical
 * market, so the difference between them is the strategy and nothing else.
 * That is what makes a modest edge detectable without thousands of runs.
 *
 * Sampling differs by mode, and so does what the result means:
 *   synthetic  — `samples` independent seeds. The p-value is a real statement
 *                about the rate model.
 *   historical — consecutive non-overlapping blocks of the one history. Blocks
 *                from a single series are not independent draws, so the
 *                p-value is reported as indicative and flagged as such.
 */
export async function runExperiment(req = {}) {
  const variants = (req.variants || []).map((v, i) => ({
    id: v.id || String.fromCharCode(65 + i),
    label: v.label || v.id || `Variant ${String.fromCharCode(65 + i)}`,
    strategy: normalizeStrategy(v.strategy),
  }));
  if (variants.length < 1) throw invalid('Provide at least one variant.');
  if (variants.length > 6) throw invalid('At most 6 variants per experiment.');

  const capital = validCapital(req.capital);
  const mode = req.mode === 'historical' ? 'historical' : 'synthetic';
  const days = Math.max(14, Math.min(365, Math.round(Number(req.days) || 90)));
  const baselineId = req.baseline_variant || variants[0].id;
  if (!variants.some((v) => v.id === baselineId)) {
    throw invalid(`baseline_variant "${baselineId}" is not one of the variants.`);
  }

  const samples = [];
  let market = null;
  const warnings = [];

  if (mode === 'synthetic') {
    const count = Math.max(1, Math.min(200, Math.round(Number(req.samples) || 40)));
    const rootSeed = req.seed || 'lab';
    for (let k = 0; k < count; k++) {
      const paths = await buildPaths({
        mode: 'synthetic',
        asset: req.asset,
        days,
        seed: `${rootSeed}:${k}`,
        regime: req.regime,
        venue_ids: req.venue_ids,
      });
      if (!market) market = marketSummary(paths);
      samples.push({
        sample: k,
        seed: `${rootSeed}:${k}`,
        runs: variants.map((v) => simulate(paths, v.strategy, { capital, label: v.id })),
      });
    }
  } else {
    const full = await buildPaths({
      mode: 'historical',
      asset: req.asset,
      days,
      venue_ids: req.venue_ids,
    });
    market = marketSummary(full);
    const blockDays = Math.max(14, Math.min(full.days, Math.round(Number(req.block_days) || 30)));
    const blocks = Math.floor(full.days / blockDays);
    if (blocks < 2) {
      warnings.push(
        `The window holds ${blocks} block of ${blockDays} days; a single sample yields no statistics.`,
      );
    }
    for (let b = 0; b < Math.max(1, blocks); b++) {
      const from = b * blockDays;
      const slice = {
        ...full,
        days: Math.min(blockDays, full.days - from),
        start: full.start + from * DAY_MS,
        series: full.series.map((row) => row.slice(from, from + blockDays)),
      };
      if (slice.days < 14) continue;
      samples.push({
        sample: b,
        window: `${new Date(slice.start).toISOString().slice(0, 10)} → ${new Date(
          slice.start + (slice.days - 1) * DAY_MS,
        )
          .toISOString()
          .slice(0, 10)}`,
        runs: variants.map((v) => simulate(slice, v.strategy, { capital, label: v.id })),
      });
    }
    warnings.push(
      'Historical blocks come from one rate history and are not independent draws; treat the p-value as indicative.',
    );
  }

  // Per-variant metric distributions.
  const metricKeys = Object.keys(METRICS);
  const summaries = variants.map((v, vi) => {
    const dist = {};
    for (const key of metricKeys) {
      const values = samples.map((s) => Number(s.runs[vi].metrics[key]) || 0);
      dist[key] = {
        mean: round6(mean(values)),
        median: round6(median(values)),
        stddev: round6(stddev(values)),
        p5: round6(percentile(values, 0.05)),
        p95: round6(percentile(values, 0.95)),
      };
    }
    return {
      id: v.id,
      label: v.label,
      strategy: v.strategy,
      metrics: dist,
      /** One representative run (the first sample) for charting. */
      example: samples.length
        ? { series: samples[0].runs[vi].series, decisions: samples[0].runs[vi].decisions, metrics: samples[0].runs[vi].metrics }
        : null,
    };
  });

  // Paired comparisons against the designated baseline variant.
  const baseIdx = variants.findIndex((v) => v.id === baselineId);
  const comparisons = variants
    .map((v, vi) => {
      if (vi === baseIdx) return null;
      return pairedComparison({
        variant: v,
        baseline: variants[baseIdx],
        deltasFor: (key) =>
          samples.map((s) => (Number(s.runs[vi].metrics[key]) || 0) - (Number(s.runs[baseIdx].metrics[key]) || 0)),
        metricKeys,
      });
    })
    .filter(Boolean);

  const verdict = req.hypothesis
    ? judge(req.hypothesis, { variants, comparisons, baselineId, samples: samples.length, mode })
    : null;

  return {
    object: 'experiment',
    as_of: new Date().toISOString(),
    mode,
    samples: samples.length,
    capital,
    baseline_variant: baselineId,
    market: market ? { ...market, venues: market.venues.map(({ apy, ...rest }) => rest) } : null,
    variants: summaries,
    comparisons,
    hypothesis: req.hypothesis || null,
    verdict,
    warnings: [...warnings, ...(market?.warnings || [])],
    disclaimer:
      mode === 'historical'
        ? 'Paired comparison over blocks of real historical APY. Blocks overlap in market conditions; this measures the past, not the future.'
        : 'Paired comparison over independent simulated rate paths. The p-value is a statement about this rate model, not about real markets.',
  };
}

function pairedComparison({ variant, baseline, deltasFor, metricKeys }) {
  const per = {};
  for (const key of metricKeys) {
    const d = deltasFor(key);
    const n = d.length;
    const m = mean(d);
    const sd = stddev(d);
    const se = n > 1 ? sd / Math.sqrt(n) : 0;
    const z = se > 0 ? m / se : 0;
    const higherBetter = METRICS[key].higher_is_better;
    const wins = d.filter((x) => (higherBetter ? x > 0 : x < 0)).length;
    per[key] = {
      mean_delta: round6(m),
      median_delta: round6(median(d)),
      stddev: round6(sd),
      /** 95% CI on the mean difference, normal approximation. */
      ci95: [round6(m - 1.96 * se), round6(m + 1.96 * se)],
      win_rate: n ? round4(wins / n) : 0,
      z: round4(z),
      p_value: n > 1 ? twoSidedP(z) : null,
      samples: n,
    };
  }
  return { variant: variant.id, variant_label: variant.label, baseline: baseline.id, metrics: per };
}

/**
 * Turn a hypothesis into a verdict.
 *
 * A hypothesis is only "supported" when all three hold: the effect points the
 * way it was predicted, it is at least as large as the stated minimum, and it
 * clears the significance level. An effect that is significant but smaller
 * than `min_effect` is reported as `negligible`, not as a win — statistical
 * significance on a 2 bps edge is not a reason to ship anything.
 */
/**
 * Render a p-value for prose. At the 1e-6 floor the number is the method's
 * limit rather than a measurement, so it is written as a bound — printing
 * "p = 0.000001" would claim a precision the normal approximation does not
 * have.
 */
function showP(p) {
  if (p === null) return 'n/a';
  return p <= 1e-6 ? '< 1e-6' : `= ${p}`;
}

function judge(hypothesis, { comparisons, baselineId, samples, mode }) {
  const metric = hypothesis.metric || 'net_apy';
  if (!METRICS[metric]) {
    throw invalid(`Unknown hypothesis metric "${metric}". Use one of: ${Object.keys(METRICS).join(', ')}.`);
  }
  const variantId = hypothesis.variant || (comparisons[0] && comparisons[0].variant);
  const cmp = comparisons.find((c) => c.variant === variantId);
  if (!cmp) {
    throw invalid(`Hypothesis names variant "${variantId}", which has no comparison against ${baselineId}.`);
  }

  const spec = METRICS[metric];
  const stat = cmp.metrics[metric];
  const direction = hypothesis.direction === 'less' ? 'less' : 'greater';
  const alpha = Number.isFinite(Number(hypothesis.alpha)) ? Number(hypothesis.alpha) : 0.05;
  // min_effect is expressed in the metric's reported unit (bps for net_apy).
  const minEffect = Math.abs(Number(hypothesis.min_effect) || 0) / spec.scale;

  const observed = stat.mean_delta;
  const observedReported = round4(observed * spec.scale);
  const rightDirection = direction === 'greater' ? observed > 0 : observed < 0;
  const bigEnough = Math.abs(observed) >= minEffect;
  const significant = stat.p_value !== null && stat.p_value < alpha;

  let outcome;
  let reason;
  if (samples < 2) {
    outcome = 'inconclusive';
    reason = 'A single sample cannot separate a strategy effect from one lucky market.';
  } else if (samples < MIN_SAMPLES_FOR_SIGNIFICANCE) {
    outcome = 'underpowered';
    reason = `${samples} paired samples is too few to separate signal from noise; the observed ${observedReported} ${spec.unit} is a direction, not a result. Raise \`samples\` (synthetic) or widen the window / shorten \`block_days\` (historical).`;
  } else if (!rightDirection && significant) {
    outcome = 'refuted';
    reason = `The effect is significant and points the other way (${observedReported} ${spec.unit}).`;
  } else if (!significant) {
    outcome = 'inconclusive';
    reason = `p ${showP(stat.p_value)} at alpha ${alpha}; the difference is inside the noise of ${samples} samples.`;
  } else if (!bigEnough) {
    outcome = 'negligible';
    reason = `Statistically detectable but only ${observedReported} ${spec.unit}, below the ${
      hypothesis.min_effect || 0
    } ${spec.unit} that was called material.`;
  } else {
    outcome = 'supported';
    reason = `${observedReported} ${spec.unit} in the predicted direction, p ${showP(stat.p_value)} over ${samples} paired samples.`;
  }

  return {
    object: 'verdict',
    statement:
      hypothesis.statement ||
      `${variantId} achieves ${direction === 'greater' ? 'higher' : 'lower'} ${spec.label} than ${baselineId}.`,
    outcome,
    reason,
    metric,
    unit: spec.unit,
    direction,
    variant: variantId,
    baseline: baselineId,
    observed_effect: observedReported,
    min_effect: Number(hypothesis.min_effect) || 0,
    ci95: [round4(stat.ci95[0] * spec.scale), round4(stat.ci95[1] * spec.scale)],
    win_rate: stat.win_rate,
    p_value: stat.p_value,
    alpha,
    samples,
    underpowered: samples < MIN_SAMPLES_FOR_SIGNIFICANCE,
    evidence_strength:
      mode === 'historical'
        ? 'Blocks of one real history — not independent samples.'
        : 'Independent simulated paths — valid for the model, not for the market.',
  };
}

/** Everything the lab UI needs to render its controls, in one call. */
export function labCatalog() {
  return {
    object: 'strategy_catalog',
    policies: Object.entries(POLICIES).map(([id, description]) => ({ id, description })),
    presets: PRESETS.map((p) => ({
      ...p,
      strategy: normalizeStrategy(p.strategy),
    })),
    regimes: Object.entries(REGIMES).map(([id, r]) => ({ id, ...r })),
    metrics: Object.entries(METRICS).map(([id, m]) => ({ id, ...m })),
    defaults: DEFAULT_STRATEGY,
    limits: {
      days: [14, 365],
      capital: [1000, 1e10],
      samples: [1, 200],
      variants: [1, 6],
    },
  };
}
