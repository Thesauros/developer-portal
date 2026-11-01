"use client";
import { useEffect, useMemo, useState } from "react";
import { CASH_COLOR, marketColor } from "../../../lib/vault-book.mjs";
import { clock, dateLabel, money, pct } from "./parts";
import b from "./book.module.css";

// Charts draw at the measured width, so labels stay a readable size everywhere.
export function useWidth() {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

// A small price line: direction over the last 30 days, no axis, no claim.
export function Sparkline({ points, width = 72, height = 22 }) {
  const series = (points || []).slice(-120);
  if (series.length < 2) return <span className={b.sparkEmpty} />;
  const prices = series.map((point) => point.price);
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const range = max - min || 1;
  const first = series[0].at,
    last = series.at(-1).at;
  const path = series
    .map(
      (point, index) =>
        (index ? "L" : "M") +
        (((point.at - first) / (last - first || 1)) * (width - 2) + 1).toFixed(
          1,
        ) +
        " " +
        ((1 - (point.price - min) / range) * (height - 4) + 2).toFixed(1),
    )
    .join("");
  return (
    <svg
      className={b.spark}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Where the money is, as one bar. Colour follows the market, never its rank.
export function AllocationBar({ rows, height = 8 }) {
  const parts = (rows || []).filter((row) => (row.share || 0) > 0);
  if (!parts.length) return <span className={b.barEmpty} style={{ height }} />;
  return (
    <span className={b.allocationBar} style={{ height }} aria-hidden="true">
      {parts.map((row) => (
        <i
          key={row.key}
          style={{
            flexGrow: Math.max(row.share, 1.2),
            background:
              row.kind === "market" ? marketColor(row.name) : CASH_COLOR,
          }}
          title={`${row.name}${row.network ? " on " + row.network : ""}: ${row.share.toFixed(1)}%`}
        />
      ))}
    </span>
  );
}

const ribbon = (x1, y1, h1, x2, y2, h2) => {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1}C${mid},${y1} ${mid},${y2} ${x2},${y2}L${x2},${y2 + h2}C${mid},${y2 + h2} ${mid},${y1 + h1} ${x1},${y1 + h1}Z`;
};

// The signature of the product: a vault's money split into networks and markets,
// drawn to scale. A vault on one network skips the network column.
export function MoneyMap({ vault }) {
  const [box, width] = useWidth();
  const groups = useMemo(() => groupsOf(vault), [vault]);
  return (
    <div ref={box} className={b.map}>
      {width >= 600 ? (
        <FlowDiagram vault={vault} groups={groups} W={width} />
      ) : width > 0 ? (
        <FlowList groups={groups} token={vault.token} />
      ) : null}
    </div>
  );
}

function groupsOf(vault) {
  const networks = new Map();
  let cash = 0;
  for (const row of vault.allocation) {
    if (!(row.amount > 0)) continue;
    if (row.kind !== "market") {
      cash += row.amount;
      continue;
    }
    const group = networks.get(row.network) || {
      name: row.network,
      amount: 0,
      rows: [],
    };
    group.amount += row.amount;
    group.rows.push(row);
    networks.set(row.network, group);
  }
  return { networks: [...networks.values()], cash };
}

function FlowDiagram({ vault, groups, W }) {
  const many = vault.networks.length > 1;
  const bar = 8,
    slot = 46,
    gap = 14;
  const midX = many ? Math.round(W * 0.34) : 0;
  const rightX = many ? Math.round(W * 0.68) : Math.round(W * 0.5);
  const total =
    groups.networks.reduce((sum, group) => sum + group.amount, 0) + groups.cash;
  const scale = (many ? 190 : 170) / Math.max(total, 1e-9);
  const height = (amount) => Math.max(amount * scale, 3);
  let y = 0;
  const placed = groups.networks.map((group) => {
    const netH = height(group.amount);
    const rows = group.rows.map((row) => ({
      ...row,
      h: height(row.amount),
      room: Math.max(height(row.amount) + 6, slot),
    }));
    const rowsH = rows.reduce((sum, row) => sum + row.room, 0);
    const groupH = Math.max(netH, rowsH);
    const top = y;
    y += groupH + gap;
    let slice = top + (groupH - netH) / 2;
    const netY = slice;
    let cursorY = top + (groupH - rowsH) / 2;
    const markets = rows.map((row) => {
      const rowY = cursorY + (row.room - row.h) / 2;
      cursorY += row.room;
      const sliceH = (row.amount / Math.max(group.amount, 1e-9)) * netH;
      const item = { ...row, y: rowY, sliceY: slice, sliceH };
      slice += sliceH;
      return item;
    });
    return { ...group, netY, netH, markets };
  });
  const cashH = groups.cash > 0 ? height(groups.cash) : 0;
  const cashSlot = groups.cash > 0 ? Math.max(cashH, slot) : 0;
  const cashY = y + (cashSlot - cashH) / 2;
  const span = y + cashSlot;
  const leftH =
    placed.reduce((sum, group) => sum + height(group.amount), 0) + cashH;
  const leftY = (span - leftH) / 2;
  const top = Math.min(leftY - 42, -6);
  const drawn = span - top + 8;
  const token = vault.token;
  const amount = (value) => money(value, value >= 1000 ? 0 : 2) + " " + token;
  // The same total as everywhere else on the page.
  const shownTotal = vault.capital?.held ?? vault.tvl ?? total;
  let cursor = leftY;
  return (
    <svg
      className={b.flow}
      width={W}
      height={drawn}
      viewBox={`0 ${top} ${W} ${drawn}`}
      role="img"
      aria-label={`The vault holds ${amount(shownTotal)}${groups.cash > 0 ? `, of which ${amount(groups.cash)} is cash` : ""}. The table below lists every market.`}
    >
      <text x={0} y={leftY - 22} className={b.flowName}>
        This vault
      </text>
      <text x={0} y={leftY - 6} className={b.flowValue}>
        {amount(shownTotal)}
      </text>
      <rect x={0} y={leftY} width={bar} height={leftH} rx="2" fill="#0b1b2b" />
      {placed.map((group) => {
        const fromY = cursor;
        cursor += group.netH;
        const originX = many ? midX + bar : bar;
        let originCursor = fromY;
        return (
          <g key={group.name}>
            {many && (
              <>
                <path
                  className={b.band}
                  d={ribbon(bar, fromY, group.netH, midX, group.netY, group.netH)}
                  fill="#0b1b2b"
                  fillOpacity="0.09"
                >
                  <title>{`${group.name}: ${amount(group.amount)}`}</title>
                </path>
                <rect
                  x={midX}
                  y={group.netY}
                  width={bar}
                  height={group.netH}
                  rx="2"
                  fill="#0b1b2b"
                />
                <text
                  x={midX + 16}
                  y={group.netY + group.netH / 2 - 3}
                  className={b.flowName}
                >
                  {group.name}
                </text>
                <text
                  x={midX + 16}
                  y={group.netY + group.netH / 2 + 13}
                  className={b.flowValue}
                >
                  {amount(group.amount)}
                </text>
              </>
            )}
            {group.markets.map((row) => {
              const sliceY = many ? row.sliceY : originCursor;
              originCursor += row.sliceH;
              return (
                <g key={row.key}>
                  <path
                    className={b.band}
                    d={ribbon(
                      originX,
                      sliceY,
                      row.sliceH,
                      rightX,
                      row.y,
                      row.h,
                    )}
                    fill={marketColor(row.name)}
                    fillOpacity="0.2"
                  >
                    <title>{`${row.name} on ${row.network}: ${amount(row.amount)} at ${pct(row.rate)}`}</title>
                  </path>
                  <rect
                    x={rightX}
                    y={row.y}
                    width={bar}
                    height={row.h}
                    rx="2"
                    fill={marketColor(row.name)}
                  />
                  <text
                    x={rightX + 16}
                    y={row.y + row.h / 2 - 3}
                    className={b.flowName}
                  >
                    {row.name}
                  </text>
                  <text
                    x={rightX + 16}
                    y={row.y + row.h / 2 + 13}
                    className={b.flowValue}
                  >
                    {amount(row.amount)} at {pct(row.rate)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      {groups.cash > 0 && (
        <g>
          <path
            className={b.band}
            d={ribbon(bar, cursor, cashH, many ? midX : rightX, cashY, cashH)}
            fill={CASH_COLOR}
            fillOpacity="0.32"
          >
            <title>{`Cash: ${amount(groups.cash)}`}</title>
          </path>
          <rect
            x={many ? midX : rightX}
            y={cashY}
            width={bar}
            height={cashH}
            rx="2"
            fill={CASH_COLOR}
          />
          <text
            x={(many ? midX : rightX) + 16}
            y={cashY + cashH / 2 - 3}
            className={b.flowName}
          >
            Cash on {vault.depositNetwork}
          </text>
          <text
            x={(many ? midX : rightX) + 16}
            y={cashY + cashH / 2 + 13}
            className={b.flowValue}
          >
            {amount(groups.cash)}, earns nothing
          </text>
        </g>
      )}
    </svg>
  );
}

function FlowList({ groups, token }) {
  return (
    <ul className={b.flowList}>
      {groups.networks.map((group) => (
        <li key={group.name}>
          <b>{group.name}</b> {money(group.amount)} {token}
          <ul>
            {group.rows.map((row) => (
              <li key={row.key}>
                <i style={{ background: marketColor(row.name) }} />
                {row.name} {money(row.amount)} {token} at {pct(row.rate)}
              </li>
            ))}
          </ul>
        </li>
      ))}
      {groups.cash > 0 && (
        <li>
          <b>Cash</b> {money(groups.cash)} {token}, earns nothing
        </li>
      )}
    </ul>
  );
}

const niceDay = (ms) => dateLabel(ms, false);

// Share price over time. A long silence between readings is drawn dashed and
// labelled: the price was not observed then, and a solid line would claim it was.
export function PriceChart({
  points,
  height = 240,
  // Longer than this between readings counts as silence. Hourly valuations and
  // daily samples need different limits.
  silenceMs = 6 * 3600000,
  gapLabel = "No valuation",
}) {
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
  if (!points || points.length < 2)
    return (
      <div ref={box} className={b.chartEmpty} style={{ height: 120 }}>
        Not enough readings in this period to draw a line.
      </div>
    );
  const W = width || 720,
    H = height,
    left = 2,
    right = 66,
    top = 18,
    bottom = 24;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const range = Math.max(max - min, max * 0.00002);
  const first = points[0].at,
    last = points.at(-1).at;
  const x = (at) =>
    left + ((at - first) / Math.max(last - first, 1)) * (W - left - right);
  const y = (price) => top + (1 - (price - min) / range) * (H - top - bottom);
  const places = range < 0.0005 ? 6 : 4;
  let solid = "",
    silent = "";
  const gaps = [];
  points.forEach((point, index) => {
    const px = x(point.at).toFixed(1),
      py = y(point.price).toFixed(1);
    if (!index) {
      solid = `M${px},${py}`;
      return;
    }
    const previous = points[index - 1];
    if (point.at - previous.at > silenceMs) {
      silent += `M${x(previous.at).toFixed(1)},${y(previous.price).toFixed(1)}L${px},${py}`;
      solid += `M${px},${py}`;
      gaps.push({ from: previous, to: point });
    } else solid += `L${px},${py}`;
  });
  const longest = [...gaps].sort(
    (a, c) => c.to.at - c.from.at - (a.to.at - a.from.at),
  )[0];
  const levels = [max, min + range / 2, min];
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      first +
      (((event.clientX - rect.left) / rect.width) * W - left) /
        ((W - left - right) / Math.max(last - first, 1));
    setHover(
      points.reduce((a, c) =>
        Math.abs(c.at - at) < Math.abs(a.at - at) ? c : a,
      ),
    );
  }
  const shown = hover ?? points.at(-1);
  return (
    <div ref={box} className={b.chartBox}>
      <svg
        className={b.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Share price from ${points[0].price.toFixed(6)} on ${niceDay(first)} to ${points.at(-1).price.toFixed(6)} on ${niceDay(last)}`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        {levels.map((level) => (
          <g key={level}>
            <line
              x1={left}
              x2={W - right}
              y1={y(level)}
              y2={y(level)}
              className={b.gridLine}
            />
            <text x={W - right + 8} y={y(level) + 4} className={b.axis}>
              {level.toFixed(places)}
            </text>
          </g>
        ))}
        <path d={solid} fill="none" stroke="var(--blue)" strokeWidth="2" />
        {silent && (
          <path
            d={silent}
            fill="none"
            stroke="var(--blue)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}
        {longest && (
          <text
            x={(x(longest.from.at) + x(longest.to.at)) / 2}
            y={Math.min(y(longest.from.price), y(longest.to.price)) - 10}
            textAnchor="middle"
            className={b.annotation}
          >
            {gapLabel} {niceDay(longest.from.at)} to {niceDay(longest.to.at)}
          </text>
        )}
        {hover && (
          <>
            <line
              x1={x(hover.at)}
              x2={x(hover.at)}
              y1={top}
              y2={H - bottom}
              className={b.hoverLine}
            />
            <circle
              cx={x(hover.at)}
              cy={y(hover.price)}
              r="4"
              fill="var(--blue)"
            />
          </>
        )}
        <text x={left} y={H - 6} className={b.axis}>
          {niceDay(first)}
        </text>
        <text x={W - right} y={H - 6} textAnchor="end" className={b.axis}>
          {niceDay(last)}
        </text>
      </svg>
      <p className={b.chartRead} aria-live="polite">
        <strong>{shown.price.toFixed(6)}</strong> {clock(shown.at)}
      </p>
    </div>
  );
}

// The vault's rate against a named comparison, with the same grid.
export function RateChart({ series, height = 240, vaultLabel = "This vault" }) {
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
  const vault = (series?.vault || []).filter((point) => point.v != null);
  const market = (series?.market || []).filter((point) => point.v != null);
  if (vault.length < 2)
    return (
      <div ref={box} className={b.chartEmpty} style={{ height: 120 }}>
        Rate history is not available for this period yet.
      </div>
    );
  const W = width || 720,
    H = height,
    left = 2,
    right = 56,
    top = 14,
    bottom = 24;
  const all = [...vault, ...market];
  const values = all.map((point) => point.v);
  const spread = Math.max(Math.max(...values) - Math.min(...values), 0.5);
  const lo = Math.max(0, Math.min(...values) - spread * 0.12),
    hi = Math.max(...values) + spread * 0.12;
  const t0 = Math.min(...all.map((point) => point.t)),
    t1 = Math.max(...all.map((point) => point.t));
  const x = (t) => left + ((t - t0) / Math.max(t1 - t0, 1)) * (W - left - right);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const path = (list) =>
    list
      .map(
        (point, index) =>
          (index ? "L" : "M") +
          x(point.t).toFixed(1) +
          " " +
          y(point.v).toFixed(1),
      )
      .join("");
  const grid = [0, 1, 2, 3].map((step) => lo + ((hi - lo) * step) / 3);
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const t =
      t0 +
      (((event.clientX - rect.left) / rect.width) * W - left) /
        ((W - left - right) / Math.max(t1 - t0, 1));
    setHover(
      vault.reduce((a, c) => (Math.abs(c.t - t) < Math.abs(a.t - t) ? c : a)),
    );
  }
  const shown = hover ?? vault.at(-1);
  const marketAt = market.find((point) => point.t === shown.t)?.v;
  return (
    <div ref={box} className={b.chartBox}>
      <svg
        className={b.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${vaultLabel} rate from ${pct(vault[0].v)} to ${pct(vault.at(-1).v)}`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        {grid.map((level) => (
          <g key={level}>
            <line
              x1={left}
              x2={W - right}
              y1={y(level)}
              y2={y(level)}
              className={b.gridLine}
            />
            <text x={W - right + 8} y={y(level) + 4} className={b.axis}>
              {level.toFixed(1)}%
            </text>
          </g>
        ))}
        {market.length > 1 && (
          <path
            d={path(market)}
            fill="none"
            stroke="var(--ink-4)"
            strokeWidth="1.5"
          />
        )}
        <path d={path(vault)} fill="none" stroke="var(--blue)" strokeWidth="2" />
        {hover && (
          <>
            <line
              x1={x(hover.t)}
              x2={x(hover.t)}
              y1={top}
              y2={H - bottom}
              className={b.hoverLine}
            />
            <circle cx={x(hover.t)} cy={y(hover.v)} r="4" fill="var(--blue)" />
          </>
        )}
        <text x={left} y={H - 6} className={b.axis}>
          {niceDay(t0)}
        </text>
        <text x={W - right} y={H - 6} textAnchor="end" className={b.axis}>
          {niceDay(t1)}
        </text>
      </svg>
      <p className={b.chartRead} aria-live="polite">
        <i className={b.keyVault} /> {vaultLabel} <strong>{pct(shown.v)}</strong>
        {market.length > 1 && (
          <>
            {" "}
            <i className={b.keyMarket} /> Market average{" "}
            <strong>{pct(marketAt)}</strong>
          </>
        )}{" "}
        <span>{niceDay(shown.t)}</span>
      </p>
    </div>
  );
}

// Where the money was, day by day. A stack, because the shares always add up to
// the whole vault and what matters is how the split changed.
export function AllocationHistory({ history, height = 200 }) {
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
  const { names, days } = history;
  const W = width || 720,
    H = height,
    left = 2,
    right = 44,
    top = 6,
    bottom = 24;
  const first = days[0].at,
    last = days.at(-1).at;
  const x = (at) =>
    left + ((at - first) / Math.max(last - first, 1)) * (W - left - right);
  const y = (share) => top + (1 - share / 100) * (H - top - bottom);
  const bands = names.map((name, index) => {
    const lower = days.map((day) =>
      day.shares.slice(0, index).reduce((sum, value) => sum + value, 0),
    );
    const upper = days.map((day, at) => lower[at] + day.shares[index]);
    const up = days.map((day, at) => `${x(day.at).toFixed(1)},${y(upper[at]).toFixed(1)}`);
    const down = days
      .map((day, at) => `${x(day.at).toFixed(1)},${y(lower[at]).toFixed(1)}`)
      .reverse();
    return { name, path: `M${up.join("L")}L${down.join("L")}Z` };
  });
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      first +
      (((event.clientX - rect.left) / rect.width) * W - left) /
        ((W - left - right) / Math.max(last - first, 1));
    setHover(
      days.reduce((a, c) => (Math.abs(c.at - at) < Math.abs(a.at - at) ? c : a)),
    );
  }
  const shown = hover ?? days.at(-1);
  return (
    <div ref={box} className={b.chartBox}>
      <svg
        className={b.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`How the vault's money was split between ${names.join(", ")} from ${niceDay(first)} to ${niceDay(last)}. The figures below the chart give each share.`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        {bands.map((band) => (
          <path
            key={band.name}
            d={band.path}
            fill={marketColor(band.name)}
            stroke="#fff"
            strokeWidth="1"
          />
        ))}
        {[0, 50, 100].map((level) => (
          <text
            key={level}
            x={W - right + 8}
            y={y(level) + 4}
            className={b.axis}
          >
            {level}%
          </text>
        ))}
        {hover && (
          <line
            x1={x(hover.at)}
            x2={x(hover.at)}
            y1={top}
            y2={H - bottom}
            stroke="#fff"
            strokeWidth="1.5"
          />
        )}
        <text x={left} y={H - 6} className={b.axis}>
          {niceDay(first)}
        </text>
        <text x={W - right} y={H - 6} textAnchor="end" className={b.axis}>
          {niceDay(last)}
        </text>
      </svg>
      <ul className={b.legend} aria-live="polite">
        <li className={b.legendDate}>{niceDay(shown.at)}</li>
        {names.map((name, index) => (
          <li key={name}>
            <i style={{ background: marketColor(name) }} />
            {name} <strong>{shown.shares[index].toFixed(1)}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A small cumulative line for the blue surface: what has been earned, not a price.
export function EarnedSpark({ days, width = 220, height = 48 }) {
  let sum = 0;
  const points = days.map((day) => {
    sum += day.v || 0;
    return { at: day.t, price: sum };
  });
  return <Sparkline points={points} width={width} height={height} />;
}
