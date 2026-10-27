/**
 * Strategy Lab invariants.
 *
 * A backtester is easy to write and easy to write wrongly: the failure mode
 * is not a crash but a plausible number that flatters the strategy. These
 * assertions pin the properties that make the output trustworthy — no
 * lookahead, costs actually charged, capital conserved, results reproducible
 * — because those are exactly the ones a refactor silently breaks.
 */

import assert from 'node:assert/strict';
import { buildPaths, REGIMES } from '../lib/api/market-paths.js';
import {
  DEFAULT_STRATEGY,
  PRESETS,
  normalizeStrategy,
  runBacktest,
  runExperiment,
  simulate,
  labCatalog,
} from '../lib/api/strategy.js';

const CAPITAL = 1_000_000;
const paths = await buildPaths({ mode: 'synthetic', asset: 'USDC', days: 90, seed: 't', regime: 'dispersed' });

/* -- paths ---------------------------------------------------------------- */

assert.ok(paths.venues.length >= 3, 'the USDC venue set should have several venues');
for (const row of paths.series) {
  assert.equal(row.length, 90, 'every venue covers the full window');
  assert.ok(row.every((v) => Number.isFinite(v) && v > 0 && v < 0.5), 'rates stay in a sane band');
}

// Same seed, same market; different seed, different market. Without the first
// an experiment cannot be paired, and without the second every "independent"
// sample would be the same sample.
const same = await buildPaths({ mode: 'synthetic', asset: 'USDC', days: 90, seed: 't', regime: 'dispersed' });
assert.deepEqual(same.series, paths.series, 'a seed reproduces its market exactly');
const other = await buildPaths({ mode: 'synthetic', asset: 'USDC', days: 90, seed: 'u', regime: 'dispersed' });
assert.notDeepEqual(other.series, paths.series, 'a different seed produces a different market');

// Venue leadership has to rotate, or no rebalancing policy can differ from
// hold and every comparison in the lab is vacuous. Rotation is a property of
// the regime rather than of any one draw, so it is measured across seeds:
// `dispersed` is the regime routing exists for and must rotate almost always,
// while `stable` is the regime where there is little to capture and must
// rotate distinctly less often. If those two ever converge, the regime
// selector has stopped meaning anything.
async function rotationRate(regime, seeds = 16) {
  let rotated = 0;
  for (let k = 0; k < seeds; k++) {
    const p = await buildPaths({ mode: 'synthetic', asset: 'USDC', days: 90, seed: `rot${k}`, regime });
    const leaders = new Set();
    for (let t = 0; t < p.days; t++) {
      let best = 0;
      for (let i = 1; i < p.series.length; i++) if (p.series[i][t] > p.series[best][t]) best = i;
      leaders.add(best);
    }
    if (leaders.size > 1) rotated += 1;
  }
  return rotated / seeds;
}
const dispersedRotation = await rotationRate('dispersed');
const stableRotation = await rotationRate('stable');
assert.ok(dispersedRotation >= 0.8, `dispersed should rotate leadership on most seeds, got ${dispersedRotation}`);
assert.ok(
  stableRotation < dispersedRotation - 0.2,
  `stable (${stableRotation}) should rotate distinctly less than dispersed (${dispersedRotation})`,
);

/* -- validation ----------------------------------------------------------- */

assert.throws(() => normalizeStrategy({ policy: 'nope' }), /Unknown policy/);
assert.throws(() => normalizeStrategy({ rebalance_threshold_bps: -1 }), /between 0 and 5000/);
assert.throws(() => normalizeStrategy({ perf_fee_pct: 0.9 }), /between 0 and 0.5/);
assert.throws(() => normalizeStrategy({ allowed_tiers: ['junk'] }), /Unknown risk tier/);
await assert.rejects(runBacktest({ capital: 10 }), /capital must be/);
await assert.rejects(runExperiment({ variants: [] }), /at least one variant/);
await assert.rejects(
  runExperiment({ variants: [{ id: 'A' }], baseline_variant: 'Z' }),
  /not one of the variants/,
);

// A single venue with a cap below 100% would strand capital forever, so the
// cap is raised rather than silently leaving the portfolio part-invested.
assert.equal(normalizeStrategy({ max_venues: 1, max_alloc_pct: 0.5 }).max_alloc_pct, 1);

/* -- no lookahead --------------------------------------------------------- */

// Rewriting the future must not change the past. Run the full window, then
// corrupt every rate after day 45 and re-run: the equity curve up to day 45
// has to be identical, or a decision somewhere read a rate it could not know.
const strat = normalizeStrategy({});
const full = simulate(paths, strat, { capital: CAPITAL });
const tampered = {
  ...paths,
  series: paths.series.map((row, i) => row.map((v, t) => (t > 45 ? (i % 2 ? 0.3 : 0.001) : v))),
};
const altered = simulate(tampered, strat, { capital: CAPITAL });
assert.deepEqual(
  altered.series.equity.slice(0, 46),
  full.series.equity.slice(0, 46),
  'changing future rates must not change past equity — the simulator is peeking',
);

/* -- costs and conservation ----------------------------------------------- */

const free = simulate(
  paths,
  normalizeStrategy({ tx_cost_bps: 0, gas_cost_usd: 0, perf_fee_pct: 0, cost_aware: false }),
  { capital: CAPITAL },
);
const expensive = simulate(
  paths,
  normalizeStrategy({ tx_cost_bps: 200, gas_cost_usd: 500, perf_fee_pct: 0, cost_aware: false }),
  { capital: CAPITAL },
);
assert.ok(
  expensive.metrics.final_value < free.metrics.final_value,
  'a strategy charged 200 bps a move must end up behind the same strategy charged nothing',
);
assert.ok(expensive.metrics.costs_usd > free.metrics.costs_usd);
assert.equal(free.metrics.fees_usd, 0, 'a zero performance fee charges nothing');

// The performance fee is taken out of yield, so it can only reduce the result.
const fee25 = simulate(paths, normalizeStrategy({ perf_fee_pct: 0.25 }), { capital: CAPITAL });
const fee0 = simulate(paths, normalizeStrategy({ perf_fee_pct: 0 }), { capital: CAPITAL });
assert.ok(fee25.metrics.final_value < fee0.metrics.final_value);
assert.ok(fee25.metrics.fees_usd > 0);

// Weights are a portfolio, not a wish: they never exceed 100% of capital.
for (const day of full.series.allocation) {
  const total = day.reduce((s, x) => s + x, 0);
  assert.ok(total <= 1.0001, `allocation sums to ${total}, above 100% of capital`);
}

// Gross is the friction-free twin, so it can never trail net.
assert.ok(
  full.metrics.gross_apy >= full.metrics.net_apy - 1e-9,
  'net return cannot exceed the same run with no fees and no costs',
);
assert.ok(full.metrics.drag_bps >= 0);

/* -- policies behave as named --------------------------------------------- */

const held = simulate(paths, normalizeStrategy({ policy: 'hold' }), { capital: CAPITAL });
assert.equal(held.metrics.rebalances, 0, 'hold never moves after the initial routing');
assert.equal(held.decisions.length, 1, 'hold makes exactly one decision');

const pinned = simulate(
  paths,
  normalizeStrategy({ policy: 'hold', pin_venue: paths.venues[2].id }),
  { capital: CAPITAL },
);
assert.equal(pinned.decisions[0].to[0].id, paths.venues[2].id, 'pin_venue overrides the policy');

const spread = simulate(
  paths,
  normalizeStrategy({ policy: 'top_k', max_venues: 3, max_alloc_pct: 0.5 }),
  { capital: CAPITAL },
);
const firstDay = spread.series.allocation[0];
assert.ok(firstDay.filter((w) => w > 0.001).length >= 2, 'top_k holds more than one venue');
assert.ok(Math.max(...firstDay) <= 0.5001, 'top_k respects max_alloc_pct');

// A wide threshold must not trade more than a narrow one.
const twitchy = simulate(paths, normalizeStrategy({ rebalance_threshold_bps: 0, cost_aware: false }), { capital: CAPITAL });
const patient = simulate(paths, normalizeStrategy({ rebalance_threshold_bps: 500 }), { capital: CAPITAL });
assert.ok(
  patient.metrics.rebalances <= twitchy.metrics.rebalances,
  'raising the threshold cannot increase turnover',
);

// The cooldown is a hard floor on the gap between moves.
const cooled = simulate(paths, normalizeStrategy({ min_hold_hours: 480, cost_aware: false }), { capital: CAPITAL });
const moveDays = cooled.decisions.map((d) => d.day);
for (let i = 1; i < moveDays.length; i++) {
  assert.ok(moveDays[i] - moveDays[i - 1] >= 20, 'a 480h cooldown means at least 20 days between moves');
}

// Excluded tiers are never entered.
const blueOnly = simulate(paths, normalizeStrategy({ allowed_tiers: ['bluechip'] }), { capital: CAPITAL });
const tierOf = Object.fromEntries(paths.venues.map((v) => [v.id, v.risk_tier]));
for (const d of blueOnly.decisions) {
  for (const leg of d.to) assert.equal(tierOf[leg.id], 'bluechip', 'a tier filter is not a suggestion');
}

/* -- capacity and price impact -------------------------------------------- */

// Supplying size into a shallow venue must earn less than supplying a little.
const small = simulate(paths, normalizeStrategy({ policy: 'hold' }), { capital: 10_000 });
const huge = simulate(paths, normalizeStrategy({ policy: 'hold' }), { capital: 500_000_000 });
assert.ok(
  huge.metrics.net_apy < small.metrics.net_apy,
  'half a billion dollars must not earn the quoted rate — price impact is not modelled',
);
const noImpact = simulate(
  paths,
  normalizeStrategy({ policy: 'hold', capacity_aware: false }),
  { capital: 500_000_000 },
);
assert.ok(noImpact.metrics.net_apy > huge.metrics.net_apy, 'capacity_aware=false removes the haircut');

/* -- baselines ------------------------------------------------------------ */

const bt = await runBacktest({ mode: 'synthetic', asset: 'USDC', days: 90, seed: 't', regime: 'dispersed' });
const labels = bt.baselines.map((b) => b.label);
assert.deepEqual(labels, ['bluechip_hold', 'hold_best_at_start', 'equal_weight', 'oracle_best']);
const oracle = bt.baselines.find((b) => b.label === 'oracle_best');
const bluechip = bt.baselines.find((b) => b.label === 'bluechip_hold');
assert.ok(oracle.note.includes('future information'), 'the ceiling is labelled as unattainable');

// The ex-post best venue is a ceiling for single-venue strategies: no
// baseline that holds one venue may beat it.
assert.ok(oracle.metrics.net_apy >= bluechip.metrics.net_apy - 1e-9, 'oracle_best is the single-venue ceiling');
assert.equal(bt.comparison.length, 4);
assert.ok(bt.disclaimer.includes('simulated'), 'a synthetic result says so');

/* -- experiments and verdicts --------------------------------------------- */

const naive = PRESETS.find((p) => p.id === 'naive_chaser').strategy;
const exp = await runExperiment({
  mode: 'synthetic',
  asset: 'USDC',
  days: 90,
  samples: 20,
  seed: 'x',
  regime: 'dispersed',
  variants: [
    { id: 'A', label: 'Default', strategy: {} },
    { id: 'B', label: 'Naive', strategy: naive },
  ],
  baseline_variant: 'B',
  hypothesis: { metric: 'net_apy', variant: 'A', direction: 'greater', min_effect: 10 },
});
assert.equal(exp.samples, 20);
assert.equal(exp.variants.length, 2);
assert.ok(exp.verdict, 'a hypothesis produces a verdict');
assert.ok(['supported', 'refuted', 'negligible', 'inconclusive'].includes(exp.verdict.outcome));
assert.ok(exp.verdict.win_rate >= 0 && exp.verdict.win_rate <= 1);
assert.ok(exp.verdict.p_value >= 1e-6, 'p-values are floored at the method’s own precision');
assert.equal(exp.verdict.underpowered, false);
assert.ok(
  exp.verdict.ci95[0] <= exp.verdict.observed_effect && exp.verdict.observed_effect <= exp.verdict.ci95[1],
  'the point estimate lies inside its own interval',
);

// The same experiment run twice must agree, or nothing measured here is a
// finding.
const again = await runExperiment({
  mode: 'synthetic', asset: 'USDC', days: 90, samples: 20, seed: 'x', regime: 'dispersed',
  variants: [
    { id: 'A', label: 'Default', strategy: {} },
    { id: 'B', label: 'Naive', strategy: naive },
  ],
  baseline_variant: 'B',
  hypothesis: { metric: 'net_apy', variant: 'A', direction: 'greater', min_effect: 10 },
});
assert.equal(again.verdict.observed_effect, exp.verdict.observed_effect, 'an experiment is reproducible');

// A variant compared against itself has no effect to find, and must not be
// reported as one.
const nullExp = await runExperiment({
  mode: 'synthetic', days: 90, samples: 12, seed: 'null', regime: 'volatile',
  variants: [
    { id: 'A', label: 'One', strategy: {} },
    { id: 'B', label: 'Same', strategy: {} },
  ],
  baseline_variant: 'B',
  hypothesis: { metric: 'net_apy', variant: 'A', direction: 'greater', min_effect: 5 },
});
assert.equal(nullExp.verdict.observed_effect, 0, 'identical variants differ by exactly nothing');
assert.equal(nullExp.verdict.outcome, 'inconclusive', 'a null result is not a finding');

// Too few samples is reported as too few samples, not as a significant result.
const thin = await runExperiment({
  mode: 'synthetic', days: 90, samples: 3, seed: 'thin', regime: 'dispersed',
  variants: [
    { id: 'A', label: 'Default', strategy: {} },
    { id: 'B', label: 'Naive', strategy: naive },
  ],
  baseline_variant: 'B',
  hypothesis: { metric: 'net_apy', variant: 'A', direction: 'greater', min_effect: 10 },
});
assert.equal(thin.verdict.outcome, 'underpowered');
assert.equal(thin.verdict.underpowered, true);

// An effect that is real but trivial is not dressed up as a win.
const negligible = await runExperiment({
  mode: 'synthetic', days: 90, samples: 30, seed: 'x', regime: 'dispersed',
  variants: [
    { id: 'A', label: 'Default', strategy: {} },
    { id: 'B', label: 'Naive', strategy: naive },
  ],
  baseline_variant: 'B',
  hypothesis: { metric: 'net_apy', variant: 'A', direction: 'greater', min_effect: 1e6 },
});
assert.ok(
  ['negligible', 'inconclusive'].includes(negligible.verdict.outcome),
  'an impossible materiality bar cannot yield "supported"',
);

/* -- catalog -------------------------------------------------------------- */

const cat = labCatalog();
assert.equal(cat.presets.length, PRESETS.length);
assert.ok(cat.regimes.length === Object.keys(REGIMES).length);
for (const p of cat.presets) {
  assert.ok(p.strategy.policy, 'every preset resolves to a complete strategy');
  assert.equal(typeof p.summary, 'string');
}
assert.deepEqual(Object.keys(cat.defaults).sort(), Object.keys(DEFAULT_STRATEGY).sort());

console.log(
  'PASS: paths reproduce and rotate, no lookahead, costs and fees reduce returns, allocation is bounded, ' +
    'policies honour thresholds/cooldowns/tiers/caps, price impact applies at size, baselines bracket the run, ' +
    'and verdicts refuse to overstate thin or trivial evidence.',
);
