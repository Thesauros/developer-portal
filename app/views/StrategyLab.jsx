'use client';

/**
 * Strategy Lab — the test stand.
 *
 * Every other view in this console reports what the engine did. This one asks
 * what it *would* do: configure a routing policy, run it against a market,
 * and see whether it actually beats the alternatives. Two strategies can be
 * run side by side over identical markets, repeatedly, so the difference
 * between them is the policy and not the draw.
 *
 * The screen is deliberately ordered as an argument: market → strategies →
 * the claim you are testing → the verdict → the evidence behind it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import s from '../platform.module.css';
import { BASE, post, fmtUsd, fmtApy, fmtNum } from '../lib/api';
import { Badge, CodeBlock, Empty, Spinner } from '../ui/primitives';
import { AllocationBand, CompareChart, EffectBar, SERIES_COLORS } from '../ui/charts';
import { IconRefresh, IconCheck, IconX } from '../lib/icons';

const VARIANT_IDS = ['A', 'B'];

const BASELINE_LABELS = {
  bluechip_hold: 'Passive bluechip',
  hold_best_at_start: 'Route once, hold',
  equal_weight: 'Equal weight',
  oracle_best: 'Best venue (ex-post)',
};

const OUTCOME_TONE = {
  supported: 'green',
  refuted: 'red',
  negligible: 'orange',
  underpowered: 'gray',
  inconclusive: 'gray',
};

const OUTCOME_COLOR = {
  supported: 'var(--green)',
  refuted: 'var(--red)',
  negligible: 'var(--orange)',
  underpowered: 'var(--ink-3)',
  inconclusive: 'var(--ink-3)',
};

/** Fields shown in the strategy editor, in the order they matter. */
const FIELDS = [
  { key: 'rebalance_threshold_bps', label: 'Move threshold', suffix: 'bps', step: 5, min: 0, max: 5000,
    help: 'Annualized advantage the target must show before capital moves.' },
  { key: 'min_hold_hours', label: 'Cooldown', suffix: 'h', step: 12, min: 0, max: 8760,
    help: 'Minimum time between moves.' },
  { key: 'lookback_days', label: 'Signal lookback', suffix: 'd', step: 1, min: 1, max: 90,
    help: 'Days of rate history the signal averages over.' },
  { key: 'vol_penalty', label: 'Volatility penalty', suffix: '×', step: 0.1, min: 0, max: 50,
    help: 'Score penalty per unit of rate volatility.' },
  { key: 'max_venues', label: 'Venues held', suffix: '', step: 1, min: 1, max: 12,
    help: 'How many venues the capital is split across.' },
  { key: 'max_alloc_pct', label: 'Max per venue', suffix: '', step: 0.05, min: 0.05, max: 1,
    help: 'Cap on any single venue, as a fraction of capital.' },
  { key: 'tx_cost_bps', label: 'Move cost', suffix: 'bps', step: 1, min: 0, max: 1000,
    help: 'Proportional cost charged on the amount moved.' },
  { key: 'gas_cost_usd', label: 'Gas per venue', suffix: '$', step: 0.2, min: 0, max: 10000,
    help: 'Fixed cost per venue touched in a move.' },
  { key: 'perf_fee_pct', label: 'Performance fee', suffix: '', step: 0.05, min: 0, max: 0.5,
    help: 'Protocol fee charged on positive yield.' },
  { key: 'cost_horizon_days', label: 'Cost payback', suffix: 'd', step: 5, min: 1, max: 365,
    help: 'Window a move must earn back its cost within.' },
];

const TIERS = ['bluechip', 'core', 'opportunistic'];

/**
 * Y-axis labels for an equity curve.
 *
 * Compact formatting is wrong here: four strategies on $1M finish within a
 * few thousand dollars of each other, so every gridline renders as "$1.0M"
 * and the axis says nothing. Full dollars with grouping is the only format
 * where the ticks differ.
 */
const equityAxis = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

/* ------------------------------------------------------------------ *
 * Small form primitives
 * ------------------------------------------------------------------ */

function Field({ label, help, children }) {
  return (
    <label className={s.field} style={{ display: 'block' }}>
      <span className={s.fieldLabel} title={help}>
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, step, min, max, suffix }) {
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <input
        type="number"
        className={`${s.input} ${s.inputMono}`}
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={suffix ? { paddingRight: 34 } : undefined}
      />
      {suffix ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 11,
            color: 'var(--ink-3)',
            fontFamily: 'var(--mono)',
            pointerEvents: 'none',
          }}
        >
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

function Toggle({ checked, onChange, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Strategy editor
 * ------------------------------------------------------------------ */

function StrategyEditor({ variant, catalog, onChange, accent, onRemove }) {
  const st = variant.strategy;
  const set = (patch) => onChange({ ...variant, strategy: { ...st, ...patch }, preset: null });

  return (
    <div className={`${s.card} ${s.cardPad}`} style={{ borderTop: `3px solid ${accent}` }}>
      <div className={s.row} style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className={s.row} style={{ gap: 9 }}>
          <span
            style={{
              width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center',
              background: accent, color: '#fff', fontSize: 12, fontWeight: 700,
            }}
          >
            {variant.id}
          </span>
          <input
            className={s.input}
            value={variant.label}
            onChange={(e) => onChange({ ...variant, label: e.target.value })}
            aria-label={`Variant ${variant.id} name`}
            style={{ width: 200, fontWeight: 600 }}
          />
        </div>
        {onRemove ? (
          <button type="button" className={s.btnGhost} onClick={onRemove} aria-label={`Remove variant ${variant.id}`}>
            <IconX size={15} />
          </button>
        ) : null}
      </div>

      <div className={s.grid2} style={{ gap: 12 }}>
        <Field label="Preset" help="Named starting points.">
          <select
            className={s.select}
            value={variant.preset || ''}
            onChange={(e) => {
              const p = catalog.presets.find((x) => x.id === e.target.value);
              if (p) onChange({ ...variant, label: p.label, preset: p.id, strategy: { ...p.strategy } });
            }}
          >
            <option value="">Custom</option>
            {catalog.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Policy" help="Venue selection rule.">
          <select className={s.select} value={st.policy} onChange={(e) => set({ policy: e.target.value })}>
            {catalog.policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className={s.faint} style={{ fontSize: 11.5, margin: '4px 0 14px', minHeight: 30 }}>
        {variant.preset
          ? catalog.presets.find((p) => p.id === variant.preset)?.summary
          : catalog.policies.find((p) => p.id === st.policy)?.description}
      </p>

      <div className={s.grid2} style={{ gap: 12 }}>
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} help={f.help}>
            <NumberInput
              value={st[f.key]}
              step={f.step}
              min={f.min}
              max={f.max}
              suffix={f.suffix}
              onChange={(v) => set({ [f.key]: v })}
            />
          </Field>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <span className={s.fieldLabel}>Allowed risk tiers</span>
        <div className={s.row} style={{ gap: 14, marginTop: 6 }}>
          {TIERS.map((t) => (
            <Toggle
              key={t}
              checked={st.allowed_tiers.includes(t)}
              onChange={(on) => {
                const next = on ? [...st.allowed_tiers, t] : st.allowed_tiers.filter((x) => x !== t);
                set({ allowed_tiers: next.length ? next : [t] });
              }}
            >
              {t}
            </Toggle>
          ))}
        </div>
      </div>

      <div className={s.row} style={{ gap: 18, marginTop: 12 }}>
        <Toggle checked={st.cost_aware} onChange={(v) => set({ cost_aware: v })}>
          Cost-aware
        </Toggle>
        <Toggle checked={st.capacity_aware} onChange={(v) => set({ capacity_aware: v })}>
          Capacity &amp; price impact
        </Toggle>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Result pieces
 * ------------------------------------------------------------------ */

function StatCell({ label, value, tone }) {
  return (
    <div className={`${s.card} ${s.stat}`}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue} style={{ fontSize: 22, ...(tone ? { color: tone } : {}) }}>
        {value}
      </div>
    </div>
  );
}

function VerdictCard({ verdict, disclaimer }) {
  const color = OUTCOME_COLOR[verdict.outcome] || 'var(--ink-3)';
  return (
    <div className={`${s.card} ${s.cardPad}`} style={{ borderLeft: `3px solid ${color}`, marginTop: 20 }}>
      <div className={s.row} style={{ gap: 12, flexWrap: 'wrap' }}>
        <Badge tone={OUTCOME_TONE[verdict.outcome] || 'gray'} dot>
          {verdict.outcome}
        </Badge>
        {verdict.underpowered ? <Badge tone="orange">underpowered</Badge> : null}
        <span className={s.faint} style={{ fontSize: 12 }}>
          {verdict.samples} paired samples
        </span>
      </div>

      <h3 className={s.h2} style={{ fontSize: 18, margin: '10px 0 6px' }}>
        {verdict.statement}
      </h3>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>{verdict.reason}</p>

      <div style={{ maxWidth: 420, marginTop: 18 }}>
        <span className={s.fieldLabel}>
          Effect on {verdict.metric} with 95% interval ({verdict.unit})
        </span>
        <EffectBar
          value={verdict.observed_effect}
          ci={verdict.ci95}
          unit={verdict.unit}
          higherIsBetter={verdict.direction !== 'less'}
        />
      </div>

      <div className={s.statGrid} style={{ marginTop: 18 }}>
        <StatCell label="Win rate" value={`${(verdict.win_rate * 100).toFixed(0)}%`} />
        <StatCell label="p-value" value={verdict.p_value <= 1e-6 ? '< 1e-6' : String(verdict.p_value)} />
        <StatCell label="Material threshold" value={`${verdict.min_effect} ${verdict.unit}`} />
        <StatCell label="Alpha" value={String(verdict.alpha)} />
      </div>

      <p className={s.faint} style={{ fontSize: 11.5, marginTop: 14, marginBottom: 0 }}>
        {verdict.evidence_strength} {disclaimer}
      </p>
    </div>
  );
}

function MetricRows({ rows, columns }) {
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>Metric</th>
          {columns.map((c) => (
            <th key={c.key} style={{ textAlign: 'right' }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td style={{ color: 'var(--ink-2)' }}>
              {r.label}
              {r.help ? (
                <span className={s.faint} style={{ display: 'block', fontSize: 11 }}>
                  {r.help}
                </span>
              ) : null}
            </td>
            {columns.map((c) => (
              <td key={c.key} className={s.mono} style={{ textAlign: 'right', color: r.tone ? r.tone(r.get(c)) : undefined }}>
                {r.fmt(r.get(c))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DecisionLog({ decisions }) {
  if (!decisions.length) {
    return <Empty>No moves. The strategy routed once and the market never justified a change.</Empty>;
  }
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>Day</th>
          <th>Type</th>
          <th>Into</th>
          <th style={{ textAlign: 'right' }}>Rate</th>
          <th style={{ textAlign: 'right' }}>Gain</th>
          <th style={{ textAlign: 'right' }}>Moved</th>
          <th style={{ textAlign: 'right' }}>Cost</th>
        </tr>
      </thead>
      <tbody>
        {decisions.map((d) => (
          <tr key={`${d.day}-${d.type}`}>
            <td className={s.mono}>{d.day}</td>
            <td>
              <Badge tone={d.type === 'rebalance' ? 'blue' : 'teal'}>{d.type.replace('_', ' ')}</Badge>
            </td>
            <td style={{ fontSize: 12.5 }}>{d.to.map((x) => x.name).join(', ')}</td>
            <td className={s.mono} style={{ textAlign: 'right' }}>
              {fmtApy(d.apy_after)}
            </td>
            <td className={s.mono} style={{ textAlign: 'right', color: d.gain_bps > 0 ? 'var(--green)' : 'var(--ink-3)' }}>
              {d.type === 'rebalance' ? `${d.gain_bps > 0 ? '+' : ''}${d.gain_bps} bps` : '—'}
            </td>
            <td className={s.mono} style={{ textAlign: 'right' }}>
              {fmtUsd(d.moved_usd, { compact: true })}
            </td>
            <td className={s.mono} style={{ textAlign: 'right', color: 'var(--red)' }}>
              {fmtUsd(d.cost_usd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MarketPanel({ market }) {
  const labels = useMemo(
    () => market.venues[0]?.apy?.map((_, i) => `d${i}`) ?? [],
    [market],
  );
  const series = market.venues.map((v, i) => ({
    label: v.name,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    values: v.apy || [],
  }));

  return (
    <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 20 }}>
      <div className={s.panelHead}>
        <h3 className={s.h3}>The market it ran on</h3>
        <Badge tone={market.mode === 'historical' ? 'teal' : 'purple'}>{market.mode}</Badge>
      </div>
      <p className={s.faint} style={{ fontSize: 12, marginTop: 0 }}>
        {market.provenance}
      </p>
      {series.length && series[0].values.length ? (
        <CompareChart series={series} labels={labels} height={220} yFmt={(v) => `${(v * 100).toFixed(1)}%`} />
      ) : null}
      <table className={s.table} style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>Venue</th>
            <th>Chain</th>
            <th>Tier</th>
            <th style={{ textAlign: 'right' }}>Mean APY</th>
            <th style={{ textAlign: 'right' }}>Rate σ</th>
            <th style={{ textAlign: 'right' }}>TVL</th>
          </tr>
        </thead>
        <tbody>
          {market.venues.map((v, i) => (
            <tr key={v.id}>
              <td>
                <span className={s.row} style={{ gap: 7 }}>
                  <i style={{ width: 9, height: 9, borderRadius: 2, background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {v.name}
                </span>
              </td>
              <td className={s.faint}>{v.chain}</td>
              <td>
                <Badge tone={v.risk_tier === 'bluechip' ? 'blue' : v.risk_tier === 'core' ? 'teal' : 'orange'}>
                  {v.risk_tier}
                </Badge>
              </td>
              <td className={s.mono} style={{ textAlign: 'right' }}>
                {fmtApy(v.apy_mean)}
              </td>
              <td className={s.mono} style={{ textAlign: 'right' }}>
                {(v.apy_stddev * 100).toFixed(2)}pp
              </td>
              <td className={s.mono} style={{ textAlign: 'right' }}>
                {fmtUsd(v.tvl_usd, { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */

export default function StrategyLab({ apiKey }) {
  const [catalog, setCatalog] = useState(null);
  const [variants, setVariants] = useState(null);
  const [compare, setCompare] = useState(true);
  const [market, setMarket] = useState({
    mode: 'synthetic',
    asset: 'USDC',
    days: 90,
    capital: 1000000,
    regime: 'dispersed',
    seed: 'lab',
    samples: 40,
    block_days: 30,
  });
  const [hypothesis, setHypothesis] = useState({
    metric: 'net_apy',
    variant: 'A',
    direction: 'greater',
    min_effect: 10,
    alpha: 0.05,
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [experiment, setExperiment] = useState(null);

  // Load the catalog once and seed two variants that already disagree, so the
  // first run says something instead of comparing a strategy with itself.
  useEffect(() => {
    let alive = true;
    fetch(`${BASE}/lab/catalog`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((json) => {
        if (!alive || !json.data) return;
        const cat = json.data;
        setCatalog(cat);
        const pick = (id) => cat.presets.find((p) => p.id === id);
        const a = pick('thesauros_default');
        const b = pick('naive_chaser');
        setVariants([
          { id: 'A', label: a.label, preset: a.id, strategy: { ...a.strategy } },
          { id: 'B', label: b.label, preset: b.id, strategy: { ...b.strategy } },
        ]);
      })
      .catch(() => alive && setError('Could not load the strategy catalog.'));
    return () => {
      alive = false;
    };
  }, [apiKey]);

  const isHistorical = market.mode === 'historical';
  const catalogMetricLabel = (id) => catalog?.metrics.find((m) => m.id === id)?.label || id;

  const backtestBody = useMemo(() => {
    if (!variants) return null;
    const body = {
      mode: market.mode,
      asset: market.asset,
      days: Number(market.days),
      capital: Number(market.capital),
      label: variants[0].label,
      strategy: variants[0].strategy,
    };
    if (!isHistorical) {
      body.seed = market.seed;
      body.regime = market.regime;
    }
    return body;
  }, [variants, market, isHistorical]);

  const experimentBody = useMemo(() => {
    if (!variants) return null;
    const active = compare ? variants : variants.slice(0, 1);
    const body = {
      mode: market.mode,
      asset: market.asset,
      days: Number(market.days),
      capital: Number(market.capital),
      variants: active.map((v) => ({ id: v.id, label: v.label, strategy: v.strategy })),
      baseline_variant: active.length > 1 ? active[1].id : active[0].id,
      hypothesis: {
        ...hypothesis,
        min_effect: Number(hypothesis.min_effect),
        // Send the sentence the operator actually composed, so the verdict
        // reads back their claim instead of "A achieves higher net_apy than B".
        statement: `${variants.find((v) => v.id === hypothesis.variant)?.label} achieves ${
          hypothesis.direction === 'greater' ? 'higher' : 'lower'
        } ${
          catalogMetricLabel(hypothesis.metric)
        } than ${variants.find((v) => v.id !== hypothesis.variant)?.label}, by at least ${
          hypothesis.min_effect
        } ${catalog?.metrics.find((m) => m.id === hypothesis.metric)?.unit || ''}.`.replace(
          / +\./,
          '.',
        ),
      },
    };
    if (isHistorical) body.block_days = Number(market.block_days);
    else {
      body.seed = market.seed;
      body.regime = market.regime;
      body.samples = Number(market.samples);
    }
    return body;
  }, [variants, market, hypothesis, compare, isHistorical]);

  const run = useCallback(
    async (kind) => {
      setRunning(true);
      setError(null);
      try {
        if (kind === 'backtest') {
          const { data } = await post('/lab/backtest', backtestBody, { key: apiKey });
          setBacktest(data);
          setExperiment(null);
        } else {
          const { data } = await post('/lab/experiments', experimentBody, { key: apiKey });
          setExperiment(data);
          setBacktest(null);
        }
      } catch (e) {
        setError(e.message || 'The run failed.');
      } finally {
        setRunning(false);
      }
    },
    [apiKey, backtestBody, experimentBody],
  );

  if (error && !catalog) {
    return (
      <div className={s.view}>
        <h1 className={s.viewTitle}>Strategy lab</h1>
        <Empty>{error}</Empty>
      </div>
    );
  }
  if (!catalog || !variants) {
    return (
      <div className={s.view}>
        <div className={s.empty}>
          <Spinner />
        </div>
      </div>
    );
  }

  const setVariant = (i, next) => setVariants(variants.map((v, k) => (k === i ? next : v)));
  const curl = `curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}${BASE}/lab/${
    experiment || !backtest ? 'experiments' : 'backtest'
  } \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(experiment || !backtest ? experimentBody : backtestBody, null, 2)}'`;

  return (
    <div className={s.view}>
      <div className={s.row} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span className={`${s.kicker} ${s.kickerTeal}`}>Research</span>
          <h1 className={s.viewTitle}>Strategy lab</h1>
          <p className={s.viewLead}>
            A test stand for routing policies. Set the market, configure two strategies, state what
            you expect to be true, and run it enough times to find out. Every variant sees the same
            market on every sample, so what separates them is the policy rather than the draw.
          </p>
        </div>
      </div>

      {/* ---------- market ---------- */}
      <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 22 }}>
        <div className={s.panelHead}>
          <h3 className={s.h3}>1 · Market</h3>
          <div className={s.envSwitch}>
            {['synthetic', 'historical'].map((m) => (
              <button
                key={m}
                type="button"
                className={`${s.envBtn} ${market.mode === m ? s.envBtnActive : ''}`}
                onClick={() => setMarket({ ...market, mode: m })}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <p className={s.faint} style={{ fontSize: 12, marginTop: 0 }}>
          {isHistorical
            ? 'Real daily APY from the DeFiLlama pool charts. One history, so samples are non-overlapping blocks of it — enough to describe the past, not enough to call a p-value.'
            : 'Seeded simulation around the sandbox venues. Reproducible from (seed, regime) and able to produce as many independent markets as the statistics need — but a model, not evidence about real rates.'}
        </p>

        <div className={s.quickGrid} style={{ marginTop: 14 }}>
          <Field label="Asset">
            <select className={s.select} value={market.asset} onChange={(e) => setMarket({ ...market, asset: e.target.value })}>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
            </select>
          </Field>
          <Field label="Window" help="Days per sample.">
            <NumberInput value={market.days} min={14} max={365} step={15} suffix="d" onChange={(v) => setMarket({ ...market, days: v })} />
          </Field>
          <Field label="Capital">
            <NumberInput value={market.capital} min={1000} step={100000} suffix="$" onChange={(v) => setMarket({ ...market, capital: v })} />
          </Field>
          {isHistorical ? (
            <Field label="Block size" help="Length of each non-overlapping historical sample.">
              <NumberInput value={market.block_days} min={14} step={5} suffix="d" onChange={(v) => setMarket({ ...market, block_days: v })} />
            </Field>
          ) : (
            <>
              <Field label="Regime" help="How the simulated market behaves.">
                <select className={s.select} value={market.regime} onChange={(e) => setMarket({ ...market, regime: e.target.value })}>
                  {catalog.regimes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Samples" help="Independent markets each strategy is run against.">
                <NumberInput value={market.samples} min={1} max={200} step={10} onChange={(v) => setMarket({ ...market, samples: v })} />
              </Field>
              <Field label="Seed" help="Same seed, same markets.">
                <span className={s.row} style={{ gap: 6 }}>
                  <input className={`${s.input} ${s.inputMono}`} value={market.seed} onChange={(e) => setMarket({ ...market, seed: e.target.value })} />
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSecondary} ${s.btnSm}`}
                    onClick={() => setMarket({ ...market, seed: Math.random().toString(36).slice(2, 8) })}
                    aria-label="New seed"
                  >
                    <IconRefresh size={13} />
                  </button>
                </span>
              </Field>
            </>
          )}
        </div>

        {!isHistorical ? (
          <p className={s.faint} style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
            {catalog.regimes.find((r) => r.id === market.regime)?.description}
          </p>
        ) : null}
      </div>

      {/* ---------- strategies ---------- */}
      <div className={s.panelHead} style={{ marginTop: 26 }}>
        <h3 className={s.h3}>2 · Strategies</h3>
        <Toggle checked={compare} onChange={setCompare}>
          Compare two variants
        </Toggle>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compare ? '1fr 1fr' : '1fr', gap: 16, marginTop: 12 }}>
        {(compare ? variants : variants.slice(0, 1)).map((v, i) => (
          <StrategyEditor
            key={v.id}
            variant={v}
            catalog={catalog}
            accent={SERIES_COLORS[i]}
            onChange={(next) => setVariant(i, next)}
          />
        ))}
      </div>

      {/* ---------- hypothesis ---------- */}
      {compare ? (
        <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 26 }}>
          <div className={s.panelHead}>
            <h3 className={s.h3}>3 · The claim</h3>
          </div>
          <p className={s.faint} style={{ fontSize: 12, marginTop: 0 }}>
            State it before you run it. A result you went looking for afterwards is a story, not a
            finding.
          </p>
          <div className={s.row} style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
            <Field label="Variant">
              <select className={s.select} value={hypothesis.variant} onChange={(e) => setHypothesis({ ...hypothesis, variant: e.target.value })}>
                {VARIANT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id} · {variants.find((v) => v.id === id)?.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Achieves">
              <select className={s.select} value={hypothesis.direction} onChange={(e) => setHypothesis({ ...hypothesis, direction: e.target.value })}>
                <option value="greater">higher</option>
                <option value="less">lower</option>
              </select>
            </Field>
            <Field label="Metric">
              <select className={s.select} value={hypothesis.metric} onChange={(e) => setHypothesis({ ...hypothesis, metric: e.target.value })}>
                {catalog.metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="By at least" help="Smallest difference worth acting on.">
              <NumberInput
                value={hypothesis.min_effect}
                min={0}
                step={5}
                suffix={catalog.metrics.find((m) => m.id === hypothesis.metric)?.unit}
                onChange={(v) => setHypothesis({ ...hypothesis, min_effect: v })}
              />
            </Field>
            <span className={s.faint} style={{ fontSize: 12.5, paddingBottom: 10 }}>
              than {variants.find((v) => v.id !== hypothesis.variant)?.label}
            </span>
          </div>
        </div>
      ) : null}

      {/* ---------- run ---------- */}
      <div className={s.row} style={{ gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={running} onClick={() => run(compare ? 'experiment' : 'backtest')}>
          {running ? <Spinner /> : null}
          {compare ? `Run ${isHistorical ? 'block' : market.samples + '-path'} experiment` : 'Run backtest'}
        </button>
        {compare ? (
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} disabled={running} onClick={() => run('backtest')}>
            Backtest variant A in detail
          </button>
        ) : null}
        {error ? (
          <span className={s.row} style={{ gap: 6, color: 'var(--red)', fontSize: 12.5 }}>
            <IconX size={14} /> {error}
          </span>
        ) : null}
      </div>

      {/* ---------- experiment results ---------- */}
      {experiment ? <ExperimentResult experiment={experiment} catalog={catalog} /> : null}

      {/* ---------- backtest results ---------- */}
      {backtest ? <BacktestResult backtest={backtest} /> : null}

      {(experiment || backtest) && (
        <div style={{ marginTop: 26 }}>
          <div className={s.panelHead}>
            <h3 className={s.h3}>Reproduce this run</h3>
          </div>
          <p className={s.faint} style={{ fontSize: 12, marginTop: 0 }}>
            The lab is an API surface, not a toy in the console. This is the exact request the page
            just made — the same run belongs in CI, where a strategy change that loses 20 bps
            against the baseline fails the build.
          </p>
          <CodeBlock code={curl} lang="bash" file="strategy-lab.sh" showLines={false} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Result renderers
 * ------------------------------------------------------------------ */

function ExperimentResult({ experiment, catalog }) {
  const { variants, comparisons, verdict, market } = experiment;
  const columns = variants.map((v, i) => ({ key: v.id, label: v.label, variant: v, index: i }));
  const metricMeta = Object.fromEntries(catalog.metrics.map((m) => [m.id, m]));

  const rows = [
    { label: 'Net APY', help: 'After fees, costs and price impact', get: (c) => c.variant.metrics.net_apy.mean, fmt: (v) => fmtApy(v) },
    { label: 'Gross APY', help: 'Before any friction', get: (c) => c.variant.metrics.net_apy.mean + c.variant.metrics.drag_bps.mean / 10000, fmt: (v) => fmtApy(v) },
    { label: 'Friction drag', help: 'Gross minus net', get: (c) => c.variant.metrics.drag_bps.mean, fmt: (v) => `${v.toFixed(0)} bps` },
    { label: 'Rebalances', get: (c) => c.variant.metrics.rebalances.mean, fmt: (v) => v.toFixed(1) },
    { label: 'Move costs', get: (c) => c.variant.metrics.costs_usd.mean, fmt: (v) => fmtUsd(v) },
    { label: 'Turnover', get: (c) => c.variant.metrics.turnover_pct.mean, fmt: (v) => `${v.toFixed(0)}%` },
    { label: 'Max drawdown', get: (c) => c.variant.metrics.max_drawdown_pct.mean, fmt: (v) => `${v.toFixed(3)}%` },
    { label: 'Return volatility', get: (c) => c.variant.metrics.apy_volatility.mean, fmt: (v) => `${(v * 10000).toFixed(0)} bps` },
    { label: 'Worst case (p5 net APY)', help: 'Bottom 5% of samples', get: (c) => c.variant.metrics.net_apy.p5, fmt: (v) => fmtApy(v) },
    { label: 'Best case (p95 net APY)', get: (c) => c.variant.metrics.net_apy.p95, fmt: (v) => fmtApy(v) },
  ];

  return (
    <div style={{ marginTop: 6 }}>
      {verdict ? <VerdictCard verdict={verdict} disclaimer={experiment.disclaimer} /> : null}

      {experiment.warnings?.length ? (
        <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 16, borderLeft: '3px solid var(--orange)' }}>
          {experiment.warnings.map((w, i) => (
            <p key={i} style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: i ? '6px 0 0' : 0 }}>
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 20 }}>
        <div className={s.panelHead}>
          <h3 className={s.h3}>Across {experiment.samples} samples</h3>
        </div>
        <MetricRows rows={rows} columns={columns} />
      </div>

      {comparisons.map((c) => (
        <div key={c.variant} className={`${s.card} ${s.cardPad}`} style={{ marginTop: 16 }}>
          <div className={s.panelHead}>
            <h3 className={s.h3}>
              {c.variant_label} minus {variants.find((v) => v.id === c.baseline)?.label}
            </h3>
          </div>
          <p className={s.faint} style={{ fontSize: 12, marginTop: 0 }}>
            Paired per sample. When the mean and the win rate disagree, the edge is concentrated in
            a few samples rather than earned consistently — worth knowing before you ship it.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 20, marginTop: 6 }}>
            {['net_apy', 'costs_usd', 'rebalances', 'max_drawdown_pct'].map((key) => {
              const st = c.metrics[key];
              const meta = metricMeta[key];
              const scale = meta?.scale || 1;
              return (
                <div key={key}>
                  <div className={s.row} style={{ justifyContent: 'space-between' }}>
                    <span className={s.fieldLabel}>{meta?.label || key}</span>
                    <span className={s.faint} style={{ fontSize: 11 }}>
                      win {(st.win_rate * 100).toFixed(0)}% · p {st.p_value <= 1e-6 ? '<1e-6' : st.p_value}
                    </span>
                  </div>
                  <EffectBar
                    value={st.mean_delta * scale}
                    ci={[st.ci95[0] * scale, st.ci95[1] * scale]}
                    unit={meta?.unit === 'usd' ? '$' : meta?.unit || ''}
                    higherIsBetter={meta?.higher_is_better !== false}
                  />
                  <div className={s.faint} style={{ fontSize: 11, marginTop: 2 }}>
                    median {(st.median_delta * scale).toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {variants.some((v) => v.example) ? (
        <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 20 }}>
          <div className={s.panelHead}>
            <h3 className={s.h3}>One sample, in full</h3>
          </div>
          <p className={s.faint} style={{ fontSize: 12, marginTop: 0 }}>
            The first market of the {experiment.samples}. Averages hide what a strategy actually
            does day to day.
          </p>
          <CompareChart
            series={variants
              .filter((v) => v.example)
              .map((v, i) => ({
                label: v.label,
                color: SERIES_COLORS[i % SERIES_COLORS.length],
                values: v.example.series.equity,
              }))}
            labels={variants[0].example.series.equity.map((_, i) => `d${i}`)}
            height={250}
            yFmt={equityAxis}
            yGutter={86}
          />
          {variants
            .filter((v) => v.example)
            .map((v) => (
              <div key={v.id} style={{ marginTop: 18 }}>
                <span className={s.fieldLabel}>{v.label} — where the capital sat</span>
                <AllocationBand allocation={v.example.series.allocation} venues={market.venues} />
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function BacktestResult({ backtest }) {
  const { run, baselines, comparison, market } = backtest;
  const m = run.metrics;
  const labels = run.series.equity.map((_, i) => `d${i}`);

  const series = [
    { label: run.label, color: SERIES_COLORS[0], values: run.series.equity, width: 2.4 },
    ...baselines.map((b, i) => ({
      label: BASELINE_LABELS[b.label] || b.label,
      color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
      values: b.series.equity,
      dashed: true,
    })),
  ];

  return (
    <div style={{ marginTop: 6 }}>
      <div className={s.statGrid} style={{ marginTop: 20 }}>
        <StatCell label="Net APY" value={fmtApy(m.net_apy)} tone="var(--green)" />
        <StatCell label="Final value" value={fmtUsd(m.final_value)} />
        <StatCell label="Friction drag" value={`${m.drag_bps.toFixed(0)} bps`} tone="var(--orange)" />
        <StatCell label="Rebalances" value={fmtNum(m.rebalances)} />
        <StatCell label="Move costs" value={fmtUsd(m.costs_usd)} tone="var(--red)" />
        <StatCell label="Fees paid" value={fmtUsd(m.fees_usd)} />
        <StatCell label="Max drawdown" value={`${m.max_drawdown_pct.toFixed(3)}%`} />
        <StatCell label="Avg hold" value={m.avg_hold_days ? `${m.avg_hold_days.toFixed(0)}d` : 'never moved'} />
      </div>

      <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 20 }}>
        <div className={s.panelHead}>
          <h3 className={s.h3}>Against the alternatives</h3>
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Baseline</th>
              <th style={{ textAlign: 'right' }}>Its net APY</th>
              <th style={{ textAlign: 'right' }}>Difference</th>
              <th style={{ textAlign: 'right' }}>In dollars</th>
              <th style={{ textAlign: 'center' }}>Beats it</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((c) => {
              const b = baselines.find((x) => x.label === c.baseline);
              return (
                <tr key={c.baseline}>
                  <td>
                    {BASELINE_LABELS[c.baseline] || c.baseline}
                    {b?.note ? (
                      <span className={s.faint} style={{ display: 'block', fontSize: 11 }}>
                        {b.note}
                      </span>
                    ) : null}
                  </td>
                  <td className={s.mono} style={{ textAlign: 'right' }}>
                    {fmtApy(b.metrics.net_apy)}
                  </td>
                  <td className={s.mono} style={{ textAlign: 'right', color: c.beats ? 'var(--green)' : 'var(--red)' }}>
                    {c.uplift_bps > 0 ? '+' : ''}
                    {c.uplift_bps.toFixed(0)} bps
                  </td>
                  <td className={s.mono} style={{ textAlign: 'right' }}>
                    {fmtUsd(c.uplift_usd)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {c.beats ? <IconCheck size={15} style={{ color: 'var(--green)' }} /> : <IconX size={15} style={{ color: 'var(--red)' }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 20 }}>
        <div className={s.panelHead}>
          <h3 className={s.h3}>Equity</h3>
        </div>
        <CompareChart series={series} labels={labels} height={260} yFmt={equityAxis} yGutter={86} />
        <div style={{ marginTop: 20 }}>
          <span className={s.fieldLabel}>Where the capital sat</span>
          <AllocationBand allocation={run.series.allocation} venues={market.venues} />
        </div>
      </div>

      <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 20 }}>
        <div className={s.panelHead}>
          <h3 className={s.h3}>Every decision it made</h3>
          <span className={s.faint} style={{ fontSize: 12 }}>
            {run.decisions.length} total
          </span>
        </div>
        <DecisionLog decisions={run.decisions} />
      </div>

      <MarketPanel market={market} />

      <p className={s.faint} style={{ fontSize: 11.5, marginTop: 14 }}>
        {backtest.disclaimer}
      </p>
    </div>
  );
}
