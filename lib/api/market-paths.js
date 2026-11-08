/**
 * Strategy Lab — venue APY paths.
 *
 * A backtest needs a rate per venue per day. Two sources produce the same
 * shape so the simulator never knows which one it got:
 *
 *   synthetic  — seeded mean-reverting paths around the sandbox vaults' own
 *                long-run rates, plus a shared market factor and venue shocks.
 *                Deterministic, offline, reproducible from (seed, params).
 *   historical — real daily rates of the markets Thesauros vaults may use, from
 *                the Thesauros indexer's readings of their interest indexes
 *                by lib/live-data.mjs, on the venues the protocol actually
 *                routes between.
 *
 * Synthetic paths are a *model*, not evidence about the future. Anything
 * measured on them is a statement about the model's assumptions; only the
 * historical mode is a statement about rates that really happened. Both carry
 * that provenance on the returned object so the UI and the API can say so.
 */

import { all, rngFromString } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Volatility multiplier by risk tier — opportunistic venues move more. */
const TIER_VOL = { bluechip: 0.6, core: 1.0, opportunistic: 1.9 };

/** Daily pull back toward the long-run mean (fraction of the gap closed). */
const KAPPA = 0.06;

/** Base daily sigma of an APY path, in decimal APY units (0.0009 = 9 bps). */
const BASE_SIGMA = 0.0009;

/**
 * Slow per-venue wander of the long-run rate. Persistence near 1 makes it a
 * months-long trend rather than noise; the sigma is sized so a venue's fair
 * rate drifts on the order of +/-100 bps over a quarter, which is the scale
 * at which venue leadership actually changes hands.
 */
const ROTATION_PERSISTENCE = 0.98;
const ROTATION_SIGMA = 0.0016;

/**
 * Market regimes. `drift_bps` is the total move applied to every venue across
 * the whole window; `vol` scales sigma; `shock` is the per-venue-per-day
 * probability of a step change (an incentive program starting or ending).
 */
export const REGIMES = {
  stable: {
    label: 'Stable',
    description: 'Range-bound rates, leadership rarely changes. Rebalancing has little to capture.',
    drift_bps: 0,
    vol: 1,
    shock: 0.004,
    rotation: 0.4,
  },
  rising: {
    label: 'Rising rates',
    description: 'The whole curve lifts ~180 bps across the window.',
    drift_bps: 180,
    vol: 1.1,
    shock: 0.006,
    rotation: 0.7,
  },
  falling: {
    label: 'Falling rates',
    description: 'The whole curve drops ~180 bps across the window.',
    drift_bps: -180,
    vol: 1.1,
    shock: 0.006,
    rotation: 0.7,
  },
  volatile: {
    label: 'Volatile',
    description: 'Large daily swings and frequent incentive shocks; signals are unreliable.',
    drift_bps: 0,
    vol: 2.6,
    shock: 0.022,
    rotation: 1.1,
  },
  dispersed: {
    label: 'Dispersed',
    description: 'Venues pull apart and leadership rotates. The regime routing is built for.',
    drift_bps: 0,
    vol: 1.4,
    shock: 0.03,
    rotation: 1.8,
  },
};

/** Risk tier by protocol project id. */
export const PROJECT_TIER = {
  'aave-v3': 'bluechip',
  'compound-v3': 'bluechip',
  'morpho-blue': 'core',
  spark: 'core',
  'fluid-lending': 'core',
  'moonwell-lending': 'opportunistic',
  'euler-v2': 'opportunistic',
};

export const MIN_APY = 0.0005;
export const MAX_APY = 0.45;

function clampApy(v) {
  return Math.min(MAX_APY, Math.max(MIN_APY, v));
}

/** Box–Muller normal draw from a [0,1) PRNG. Never returns +/-Infinity. */
function gauss(rng) {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ *
 * Synthetic paths
 * ------------------------------------------------------------------ */

/**
 * Ornstein–Uhlenbeck-style daily APY path per venue, sharing one market
 * factor so venues co-move the way real money markets do (the whole curve
 * shifts) while still dispersing (each venue has idiosyncratic noise and
 * incentive shocks). Rebalancing only pays when venues disperse, so the
 * dispersion is the thing the lab is really varying.
 *
 * @param {object[]} venues sandbox vault rows
 * @param {object}   opts   { days, seed, regime }
 * @returns {number[][]} one APY array of length `days` per venue, in order
 */
function syntheticSeries(venues, { days, seed, regime }) {
  const cfg = REGIMES[regime] || REGIMES.stable;
  const driftPerDay = cfg.drift_bps / 10000 / Math.max(1, days);

  // Shared market factor: an AR(1) common shock plus the regime's drift.
  const marketRng = rngFromString(`lab:market:${seed}:${regime}`);
  const market = [];
  let m = 0;
  for (let t = 0; t < days; t++) {
    m = m * 0.86 + gauss(marketRng) * BASE_SIGMA * 0.8 * cfg.vol;
    market.push(m + driftPerDay * t);
  }

  return venues.map((v) => {
    const rng = rngFromString(`lab:venue:${seed}:${regime}:${v.id}`);
    const base = v.apy_30d_avg || v.apy;
    const sigma = BASE_SIGMA * (TIER_VOL[v.risk_tier] || 1) * cfg.vol;
    const rotSigma = ROTATION_SIGMA * cfg.rotation * (TIER_VOL[v.risk_tier] || 1);

    // Three components, because a single mean-reverting series produces a
    // market whose ranking never changes — and a backtest on a market where
    // the best venue is always the same venue cannot say anything about
    // rebalancing. `drift` is the slow wander of a venue's own fair rate
    // (curator changes, utilisation trends, incentive budgets), and it is what
    // makes leadership rotate.
    let level = v.apy;
    let drift = 0;
    const out = [];
    for (let t = 0; t < days; t++) {
      drift = drift * ROTATION_PERSISTENCE + rotSigma * gauss(rng);
      const theta = base + drift;
      level += KAPPA * (theta - level) + sigma * gauss(rng);
      // Incentive programs start and stop in steps, not drifts.
      if (rng() < cfg.shock) {
        const magnitude = 0.25 + rng() * 0.75; // 25%–100% of the current rate
        level = rng() < 0.5 ? level * (1 - magnitude * 0.5) : level * (1 + magnitude * 0.6);
      }
      level = clampApy(level);
      out.push(round6(clampApy(level + market[t])));
    }
    return out;
  });
}

/* ------------------------------------------------------------------ *
 * Historical paths
 * ------------------------------------------------------------------ */

/**
 * Real venues: the markets Thesauros vaults may use, with the daily rate each
 * earned, read from the markets' own interest indexes by the Thesauros indexer.
 *
 * Venues are aligned onto one daily grid: a venue must cover the whole window
 * to be included, and gaps inside its own range are forward-filled (a missing
 * day on a rate series means "unchanged", not "zero"). Dropping short-history
 * venues rather than padding them keeps every venue comparable over the same
 * days — otherwise a venue that only existed for the good half of the window
 * would win on survivorship alone.
 *
 * @returns {Promise<{venues: object[], series: number[][], start: number, warnings: string[]}>}
 */
const PROTOCOL_TIER = {
  Aave: PROJECT_TIER['aave-v3'],
  Compound: PROJECT_TIER['compound-v3'],
  Morpho: PROJECT_TIER['morpho-blue'],
  Fluid: PROJECT_TIER['fluid-lending'],
};
async function historicalSeries({ asset, days, maxVenues }) {
  const { readMarketVenues } = await import('../market-history.mjs');
  const warnings = [];
  const token = String(asset || '').toUpperCase();
  let list;
  try {
    list = readMarketVenues({ symbol: token || null });
  } catch {
    throw Object.assign(new Error('The historical rate source is unavailable. Use mode=synthetic.'), {
      code: 'invalid_request',
    });
  }
  const candidates = list.filter((v) => v.daily.length > 1).slice(0, Math.max(2, maxVenues));
  if (candidates.length < 2) {
    throw Object.assign(
      new Error(`Fewer than two historical venues carry ${token || 'this asset'}. Use mode=synthetic.`),
      { code: 'invalid_request' },
    );
  }
  const lastCommon = Math.min(...candidates.map((v) => v.daily[v.daily.length - 1].day));
  const firstCommon = Math.max(...candidates.map((v) => v.daily[0].day));
  const available = lastCommon - firstCommon + 1;
  if (available < 14) {
    throw Object.assign(
      new Error('The venues share fewer than 14 days of overlapping history. Use mode=synthetic.'),
      { code: 'invalid_request' },
    );
  }
  const span = Math.min(days, available);
  if (span < days) {
    warnings.push(`Only ${span} days of overlapping history are available; the window was shortened.`);
  }
  const startDay = lastCommon - span + 1;

  const venues = [];
  const series = [];
  for (const venue of candidates) {
    const byDay = new Map(venue.daily.map((point) => [point.day, point.rate / 100]));
    const row = [];
    let last = null;
    let filled = 0;
    for (let d = startDay; d <= lastCommon; d++) {
      if (byDay.has(d)) last = byDay.get(d);
      else if (last !== null) filled += 1;
      if (last === null) break; // no observation at or before the window start
      row.push(round6(clampApy(last)));
    }
    if (row.length !== span) continue;
    if (filled > span * 0.4) {
      warnings.push(`${venue.name} ${venue.symbol}: ${filled}/${span} days forward-filled.`);
    }
    venues.push({
      id: venue.key,
      name: `${venue.name} ${venue.symbol} (${venue.network})`,
      provider: String(venue.protocol || '').toLowerCase(),
      asset: venue.symbol,
      chain: venue.network,
      risk_tier: PROTOCOL_TIER[venue.protocol] || 'core',
      apy: row[row.length - 1],
      apy_30d_avg: round6(row.slice(-30).reduce((s, x) => s + x, 0) / Math.min(30, row.length)),
      tvl_usd: venue.tvl,
      capacity_usd: venue.tvl,
      status: 'active',
    });
    series.push(row);
  }

  if (venues.length < 2) {
    throw Object.assign(
      new Error('Fewer than two venues cover the full window. Shorten `days` or use mode=synthetic.'),
      { code: 'invalid_request' },
    );
  }

  return { venues, series, start: startDay * DAY_MS, span, warnings };
}

/* ------------------------------------------------------------------ *
 * Public entry
 * ------------------------------------------------------------------ */

/**
 * Build the venue set and its daily APY matrix for a backtest.
 *
 * @param {object} opts
 * @param {'synthetic'|'historical'} opts.mode
 * @param {string}  [opts.asset]      USDC / USDT filter
 * @param {number}  [opts.days]       window length in days
 * @param {string}  [opts.seed]       synthetic determinism seed
 * @param {string}  [opts.regime]     synthetic regime key
 * @param {string[]}[opts.venue_ids]  explicit venue allow-list
 * @param {number}  [opts.max_venues] cap on the number of venues
 */
export async function buildPaths({
  mode = 'synthetic',
  asset = 'USDC',
  days = 90,
  seed = 'lab',
  regime = 'stable',
  venue_ids = null,
  max_venues = 8,
} = {}) {
  days = Math.max(14, Math.min(365, Math.round(days)));

  if (mode === 'historical') {
    const hist = await historicalSeries({ asset, days, maxVenues: max_venues });
    const keep = venue_ids && venue_ids.length ? new Set(venue_ids) : null;
    const idx = hist.venues.map((v, i) => i).filter((i) => !keep || keep.has(hist.venues[i].id));
    if (idx.length < 1) {
      throw Object.assign(new Error('No historical venue matched `venue_ids`.'), {
        code: 'invalid_request',
      });
    }
    return {
      mode: 'historical',
      provenance: 'Real daily rates of the markets Thesauros vaults may use, from their own interest indexes, read by the Thesauros indexer.',
      asset,
      days: hist.span,
      seed: null,
      regime: null,
      start: hist.start,
      step_ms: DAY_MS,
      venues: idx.map((i) => hist.venues[i]),
      series: idx.map((i) => hist.series[i]),
      warnings: hist.warnings,
    };
  }

  const keep = venue_ids && venue_ids.length ? new Set(venue_ids) : null;
  const venues = all('vaults')
    .filter((v) => v.status === 'active' && (!asset || v.asset === asset) && (!keep || keep.has(v.id)))
    .slice(0, max_venues);

  if (venues.length < 1) {
    throw Object.assign(new Error(`No active sandbox venue matches asset "${asset}".`), {
      code: 'invalid_request',
    });
  }

  return {
    mode: 'synthetic',
    provenance:
      'Seeded mean-reverting simulation around the sandbox venues. A model of rate behaviour, not observed history.',
    asset,
    days,
    seed,
    regime,
    start: Date.now() - days * DAY_MS,
    step_ms: DAY_MS,
    venues: venues.map((v) => ({
      id: v.id,
      name: v.name,
      provider: v.provider,
      asset: v.asset,
      chain: v.chain,
      risk_tier: v.risk_tier,
      apy: v.apy,
      apy_30d_avg: v.apy_30d_avg,
      tvl_usd: v.tvl_usd,
      capacity_usd: v.capacity_usd,
      status: v.status,
    })),
    series: syntheticSeries(venues, { days, seed, regime }),
    warnings: [],
  };
}

/** Venue list for the lab's pickers, without generating any path data. */
export function syntheticVenues(asset = null) {
  return all('vaults')
    .filter((v) => v.status === 'active' && (!asset || v.asset === asset))
    .map((v) => ({
      id: v.id,
      name: v.name,
      provider: v.provider,
      asset: v.asset,
      chain: v.chain,
      risk_tier: v.risk_tier,
      apy: v.apy,
      tvl_usd: v.tvl_usd,
      capacity_usd: v.capacity_usd,
    }));
}
