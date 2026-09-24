"use client";
import { useEffect, useId, useRef, useState } from "react";
import { day, pct } from "./format";
import c from "./cabinet.module.css";

// Vault rate against the lending market. The shaded band between the vault
// line and the market average is what the rebalancer adds.
export default function RateChart({ series, height = 260, label }) {
  const box = useRef(null);
  const clip = useId().replace(/:/g, "");
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const vault = (series?.vault || []).filter((p) => p.v != null);
  const market = (series?.market || []).filter((p) => p.v != null);
  if (vault.length < 2)
    return (
      <div className={c.chartEmpty} style={{ height }}>
        Rate history is not available for this vault yet.
      </div>
    );

  const pad = { top: 16, right: 52, bottom: 28, left: 8 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const all = [...vault, ...market];
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const values = all.map((p) => p.v);
  let lo = Math.min(...values),
    hi = Math.max(...values);
  const span = Math.max(hi - lo, 0.5);
  lo = Math.max(0, lo - span * 0.15);
  hi = hi + span * 0.15;
  const x = (t) => pad.left + ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v) => pad.top + (1 - (v - lo) / (hi - lo)) * h;
  const path = (pts) =>
    pts
      .map(
        (p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1),
      )
      .join("");
  const band =
    market.length > 1
      ? path(vault) +
        [...market]
          .reverse()
          .map((p) => "L" + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1))
          .join("") +
        "Z"
      : null;
  // Only shade where the vault is above the market: clip to the area under
  // the vault line and above the market line.
  const aboveMarket =
    market.length > 1
      ? path(market) +
        `L${x(market.at(-1).t)} ${pad.top}L${x(market[0].t)} ${pad.top}Z`
      : null;

  const ticks = 4;
  const grid = Array.from(
    { length: ticks + 1 },
    (_, i) => lo + ((hi - lo) * i) / ticks,
  );
  const dates = [vault[0], vault[Math.floor(vault.length / 2)], vault.at(-1)];

  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const t = t0 + ((px - pad.left) / w) * (t1 - t0);
    let nearest = vault[0];
    for (const p of vault)
      if (Math.abs(p.t - t) < Math.abs(nearest.t - t)) nearest = p;
    setHover(nearest.t);
  }
  const at = (list, t) => list.find((p) => p.t === t)?.v ?? null;

  return (
    <div className={c.chart} ref={box}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {aboveMarket && (
            <clipPath id={clip}>
              <path d={aboveMarket} />
            </clipPath>
          )}
        </defs>
        {grid.map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={pad.left + w}
              y1={y(v)}
              y2={y(v)}
              className={c.gridLine}
            />
            <text x={pad.left + w + 8} y={y(v) + 4} className={c.axisText}>
              {v.toFixed(1)}%
            </text>
          </g>
        ))}
        {dates.map((p) => (
          <text
            key={p.t}
            x={x(p.t)}
            y={height - 6}
            className={c.axisText}
            textAnchor={
              p === vault[0] ? "start" : p === vault.at(-1) ? "end" : "middle"
            }
          >
            {day(p.t)}
          </text>
        ))}
        {band && (
          <path d={band} className={c.band} clipPath={`url(#${clip})`} />
        )}
        {market.length > 1 && (
          <path d={path(market)} className={c.marketLine} />
        )}
        <path d={path(vault)} className={c.vaultLine} />
        {hover && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + h}
              className={c.hoverLine}
            />
            <circle
              cx={x(hover)}
              cy={y(at(vault, hover))}
              r="4"
              className={c.vaultDot}
            />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className={c.tooltip}
          style={{
            left: Math.min(Math.max(x(hover) - 90, 0), width - 190),
          }}
        >
          <strong>{day(hover, true)}</strong>
          <span className={c.keyVault}>Thesauros {pct(at(vault, hover))}</span>
          {market.length > 1 && (
            <span className={c.keyMarket}>
              Market average {pct(at(market, hover))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function RateLegend() {
  return (
    <div className={c.legend}>
      <span className={c.keyVault}>Thesauros vault</span>
      <span className={c.keyMarket}>Market average</span>
      <span className={c.keyBand}>Extra yield</span>
    </div>
  );
}

// Daily earnings as bars.
export function EarningsBars({ ticks, height = 120 }) {
  const values = ticks.map((t) => t.v ?? 0);
  const max = Math.max(...values, 0);
  if (!ticks.length || max <= 0)
    return (
      <div className={c.chartEmpty} style={{ height }}>
        No earnings recorded in the last 30 days.
      </div>
    );
  return (
    <div
      className={c.bars}
      style={{ height }}
      role="img"
      aria-label="Daily earnings, last 30 days"
    >
      {ticks.map((t) => (
        <span
          key={t.t}
          style={{ height: Math.max(2, ((t.v ?? 0) / max) * 100) + "%" }}
          title={day(t.t) + ": " + (t.v ?? 0).toFixed(4)}
        />
      ))}
    </div>
  );
}

// Cumulative earnings over the period, as a soft area.
export function EarningsArea({ ticks, height = 120 }) {
  const points = [];
  let sum = 0;
  for (const t of ticks) {
    sum += t.v || 0;
    points.push({ t: t.t, v: sum });
  }
  if (points.length < 2 || sum <= 0)
    return (
      <div className={c.chartEmpty} style={{ height }}>
        No earnings recorded in the last 30 days.
      </div>
    );
  const w = 600,
    h = height;
  const x = (i) => (i / (points.length - 1)) * w;
  const y = (v) => h - 6 - (v / sum) * (h - 18);
  const line = points
    .map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1))
    .join("");
  return (
    <svg
      className={c.area}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label="Cumulative earnings, last 30 days"
    >
      <defs>
        <linearGradient id="earned-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#12805c" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#12805c" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w} ${h}L0 ${h}Z`} fill="url(#earned-fill)" />
      <path
        d={line}
        fill="none"
        stroke="#12805c"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
