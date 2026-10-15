'use client';

import { useId } from 'react';
import s from '../platform.module.css';

/* All charts are dependency-free inline SVG. */

function scale(values, w, h, pad = 2) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  return values.map((v, i) => [
    pad + (i / Math.max(1, values.length - 1)) * innerW,
    pad + innerH - ((v - min) / span) * innerH,
  ]);
}

function pathFrom(points) {
  return points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

export function Sparkline({ values, width = 84, height = 30, stroke = '#4dead8' }) {
  if (!values || values.length < 2) return null;
  const pts = scale(values, width, height, 3);
  const d = pathFrom(pts);
  const area = `${d} L${width - 3},${height - 2} L3,${height - 2} Z`;
  const gid = useId().replace(/:/g, '');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${gid})`} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={s.chartDraw}
      />
    </svg>
  );
}

/**
 * Multi-series area/line chart with grid, axis labels and hover crosshair.
 * series: [{ label, color, values: number[], fill?: bool }]
 * labels: string[] for x axis (subset rendered).
 */
export function LineChart({ series, labels, height = 220, yFmt = (v) => v, hoverFmt }) {
  const W = 720;
  const H = height;
  const PAD = { l: 46, r: 12, t: 14, b: 26 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const all = series.flatMap((sr) => sr.values);
  const max = Math.max(...all, 1);
  const min = 0;
  const span = max - min || 1;

  const xAt = (i, len) => PAD.l + (i / Math.max(1, len - 1)) * innerW;
  const yAt = (v) => PAD.t + innerH - ((v - min) / span) * innerH;

  const gridLines = 4;
  const gid = useId().replace(/:/g, '');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="time series chart"
      style={{ display: 'block' }}
    >
      <defs>
        {series.map((sr, si) => (
          <linearGradient key={si} id={`lg-${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sr.color} stopOpacity={sr.fill === false ? 0 : 0.22} />
            <stop offset="100%" stopColor={sr.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {Array.from({ length: gridLines + 1 }).map((_, gi) => {
        const v = min + (span * gi) / gridLines;
        const y = yAt(v);
        return (
          <g key={gi}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y}
              y2={y}
              stroke="rgba(147,164,195,0.1)"
              strokeDasharray={gi === 0 ? '0' : '3 4'}
            />
            <text
              x={PAD.l - 8}
              y={y + 3}
              textAnchor="end"
              fontSize="9.5"
              fill="#5b6b8c"
              fontFamily="var(--mono)"
            >
              {yFmt(v)}
            </text>
          </g>
        );
      })}

      {labels &&
        labels.map((lb, i) => {
          const len = labels.length;
          const step = Math.ceil(len / 6);
          if (i % step !== 0 && i !== len - 1) return null;
          return (
            <text
              key={i}
              x={xAt(i, len)}
              y={H - 8}
              textAnchor="middle"
              fontSize="9.5"
              fill="#5b6b8c"
              fontFamily="var(--mono)"
            >
              {lb}
            </text>
          );
        })}

      {series.map((sr, si) => {
        const pts = sr.values.map((v, i) => [xAt(i, sr.values.length), yAt(v)]);
        const d = pathFrom(pts);
        const area = `${d} L${xAt(sr.values.length - 1, sr.values.length)},${PAD.t + innerH} L${PAD.l},${
          PAD.t + innerH
        } Z`;
        return (
          <g key={si}>
            {sr.fill !== false ? <path d={area} fill={`url(#lg-${gid}-${si})`} /> : null}
            <path
              d={d}
              fill="none"
              stroke={sr.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bar list (e.g. allocation or top endpoints). */
export function BarList({ items, color = '#3a7fff', fmt = (v) => v }) {
  const max = Math.max(...items.map((it) => it.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it) => (
        <div key={it.label}>
          <div className={s.row} style={{ justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{it.label}</span>
            <span className={s.mono} style={{ fontSize: 12, color: 'var(--ink)' }}>
              {fmt(it.value)}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 99,
              background: 'rgba(147,164,195,0.1)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(it.value / max) * 100}%`,
                height: '100%',
                borderRadius: 99,
                background: it.color || color,
                transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Row of uptime slats (90 days). statuses: array of 'ok'|'warn'|'down'. */
export function UptimeBars({ statuses, tone = 'ok' }) {
  const color =
    tone === 'down' ? 'var(--red)' : tone === 'warn' ? 'var(--orange)' : 'var(--teal)';
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {statuses.map((st, i) => (
        <span
          key={i}
          title={st}
          style={{
            width: 4,
            height: 18,
            borderRadius: 2,
            background:
              st === 'down'
                ? 'var(--red)'
                : st === 'warn'
                  ? 'var(--orange)'
                  : `color-mix(in srgb, ${color} ${55 + (i % 5) * 9}%, transparent)`,
            opacity: st === 'ok' ? 0.9 : 1,
          }}
        />
      ))}
    </div>
  );
}

/* ---------- Strategy Lab ---------- */

/**
 * Categorical palette for venues and variants. Ordered so the first few stay
 * distinguishable in the common 2–4 series case, and legible on the light
 * console background.
 */
export const SERIES_COLORS = [
  '#214771',
  '#267366',
  '#945b25',
  '#52648a',
  '#b04444',
  '#2b7454',
  '#7a5ea8',
  '#8a6d3b',
];

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const out = [];
  for (let v = lo; v <= max + step * 0.5; v += step) if (v >= min - step * 0.5) out.push(v);
  return out;
}

/**
 * Multi-series line chart over a fitted y-domain.
 *
 * `LineChart` pins y to zero, which is right for request counts and useless
 * for equity curves: four strategies on $1M differ by a few thousand dollars
 * and all render as the same flat line at the top of the frame. This one fits
 * the domain to the data so the difference is the thing you see.
 *
 * series: [{ label, color, values: number[], dashed?: bool }]
 */
export function CompareChart({ series, labels, height = 260, yFmt = (v) => v, legend = true, yGutter = 62 }) {
  const W = 760;
  const H = height;
  const PAD = { l: yGutter, r: 14, t: 12, b: 26 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const visible = series.filter((sr) => sr.values && sr.values.length);
  if (!visible.length) return null;
  const flat = visible.flatMap((sr) => sr.values);
  let min = Math.min(...flat);
  let max = Math.max(...flat);
  if (min === max) {
    min -= Math.abs(min) * 0.001 || 1;
    max += Math.abs(max) * 0.001 || 1;
  }
  // Breathe a little so the extreme series is not drawn on the frame.
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const span = max - min;

  const xAt = (i, len) => PAD.l + (i / Math.max(1, len - 1)) * innerW;
  const yAt = (v) => PAD.t + innerH - ((v - min) / span) * innerH;
  const ticks = niceTicks(min, max, 4);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="strategy comparison" style={{ display: 'block' }}>
        {ticks.map((v, gi) => (
          <g key={gi}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yAt(v)} y2={yAt(v)} stroke="rgba(20,44,76,0.08)" strokeDasharray="3 4" />
            <text x={PAD.l - 8} y={yAt(v) + 3} textAnchor="end" fontSize="9.5" fill="#657389" fontFamily="var(--mono)">
              {yFmt(v)}
            </text>
          </g>
        ))}

        {labels &&
          labels.map((lb, i) => {
            const step = Math.ceil(labels.length / 6);
            if (i % step !== 0 && i !== labels.length - 1) return null;
            return (
              <text key={i} x={xAt(i, labels.length)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#657389" fontFamily="var(--mono)">
                {lb}
              </text>
            );
          })}

        {visible.map((sr, si) => (
          <path
            key={si}
            d={pathFrom(sr.values.map((v, i) => [xAt(i, sr.values.length), yAt(v)]))}
            fill="none"
            stroke={sr.color || SERIES_COLORS[si % SERIES_COLORS.length]}
            strokeWidth={sr.width || 2}
            strokeDasharray={sr.dashed ? '5 4' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={sr.dashed ? 0.8 : 1}
          />
        ))}
      </svg>

      {legend ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginTop: 10 }}>
          {visible.map((sr, si) => (
            <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
              <i
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 0,
                  borderTop: `2px ${sr.dashed ? 'dashed' : 'solid'} ${sr.color || SERIES_COLORS[si % SERIES_COLORS.length]}`,
                }}
              />
              {sr.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stacked allocation over time: where the capital actually sat, day by day.
 *
 * `allocation` is one weight array per day, aligned to `venues`. Rendered as
 * stacked bands rather than lines because the question it answers is "how
 * concentrated was this, and when did it switch", not "what was the exact
 * weight on day 41".
 */
export function AllocationBand({ allocation, venues, height = 88, legend = true }) {
  const W = 760;
  const H = height;
  const days = allocation.length;
  if (!days || !venues.length) return null;

  const colW = W / days;
  const bands = [];
  for (let d = 0; d < days; d++) {
    let y = 0;
    for (let v = 0; v < venues.length; v++) {
      const w = allocation[d][v] || 0;
      if (w <= 0.0005) continue;
      const h = w * H;
      bands.push(
        <rect
          key={`${d}-${v}`}
          x={d * colW}
          y={y}
          width={colW + 0.6}
          height={h}
          fill={SERIES_COLORS[v % SERIES_COLORS.length]}
          opacity="0.85"
        />,
      );
      y += h;
    }
  }

  const used = venues.map((_, v) => allocation.some((row) => (row[v] || 0) > 0.0005));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="allocation over time" style={{ display: 'block', borderRadius: 6, overflow: 'hidden' }}>
        <rect x="0" y="0" width={W} height={H} fill="rgba(20,44,76,0.05)" />
        {bands}
      </svg>
      {legend ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
          {venues.map((v, i) =>
            used[i] ? (
              <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' }}>
                <i aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                {v.name}
              </span>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Paired-difference summary: where the effect sits, and how wide the interval
 * is around it. A single number hides whether an edge is reliable; the bar
 * shows the 95% interval against zero so an interval that straddles zero is
 * visibly a non-result.
 */
export function EffectBar({ value, ci, unit = 'bps', higherIsBetter = true }) {
  const [lo, hi] = ci || [value, value];
  const bound = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(value), 1) * 1.15;
  const pos = (v) => ((v + bound) / (2 * bound)) * 100;
  const good = higherIsBetter ? value > 0 : value < 0;
  const crossesZero = lo <= 0 && hi >= 0;
  const color = crossesZero ? 'var(--ink-3)' : good ? 'var(--green)' : 'var(--red)';

  return (
    <div>
      <div style={{ position: 'relative', height: 26 }}>
        <div style={{ position: 'absolute', inset: '11px 0 auto 0', height: 4, borderRadius: 99, background: 'rgba(20,44,76,0.07)' }} />
        <div
          style={{
            position: 'absolute',
            top: 11,
            height: 4,
            borderRadius: 99,
            background: color,
            opacity: 0.35,
            left: `${Math.min(pos(lo), pos(hi))}%`,
            width: `${Math.abs(pos(hi) - pos(lo))}%`,
          }}
        />
        <div style={{ position: 'absolute', top: 5, bottom: 5, left: '50%', width: 1, background: 'rgba(20,44,76,0.28)' }} />
        <div
          style={{
            position: 'absolute',
            top: 7,
            left: `calc(${pos(value)}% - 6px)`,
            width: 12,
            height: 12,
            borderRadius: 99,
            background: color,
            border: '2px solid var(--bg-panel)',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
        <span>{lo.toFixed(1)}</span>
        <span style={{ color, fontWeight: 600 }}>
          {value > 0 ? '+' : ''}
          {value.toFixed(1)} {unit}
        </span>
        <span>{hi.toFixed(1)}</span>
      </div>
    </div>
  );
}
