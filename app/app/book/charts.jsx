"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { CASH_COLOR, marketColor } from "../../../lib/vault-book.mjs";
import { earnedSeries } from "../../../lib/blue-chip-index.mjs";
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
                {group.netH >= 36 ? (
                  <>
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
                ) : (
                  // A thin band has no room for two lines inside it: one line above.
                  <text x={midX} y={group.netY - 7} className={b.flowName}>
                    {group.name}{" "}
                    <tspan className={b.flowValue}>{amount(group.amount)}</tspan>
                  </text>
                )}
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
  const places = Math.min(6, Math.max(2, -Math.floor(Math.log10(niceStep(range / 3)))));
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
  // Round gridlines inside the range; the exact first and last prices are in
  // the readout under the chart.
  const tick = niceStep(range / 3);
  const levels = [];
  for (let v = Math.ceil(min / tick) * tick; v <= min + range + 1e-12; v += tick) levels.push(v);
  if (levels.length < 2) levels.splice(0, levels.length, max, min);
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
            x={Math.min(Math.max((x(longest.from.at) + x(longest.to.at)) / 2, left + 90), W - right - 90)}
            y={top - 5}
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

// Growth of 100 over the same days, for two or three lines worked out the same
// way. Labels sit at the line ends; hovering reads every line on that day.
// Thesauros against the index and a few reference lines: what one amount
// earned on each since the start of the window. The slope is the rate; the
// label at each end gives it a year, so the numbers match the table beside it.
// Thesauros is the brand blue and the heaviest line; the index is ink, the
// yardstick; the references are thin and dashed, there for scale.
export const COMPARE_COLORS = {
  thesauros: "#196aff",
  index: "#2b3445",
  aave: "#e87ba4",
  tbills: "#c98500",
};
const COMPARE_DASH = { aave: "6 4", tbills: "10 3 2 3" };

// A line over the window: its reading nearest the start, its last reading, and
// the simple annual rate between them. The chart and the verdict under it both
// use this, so they never disagree.
export function windowOf(series, from) {
  const list = series || [];
  let first = list.findIndex((point) => point.at >= from);
  if (first > 0 && from - list[first - 1].at < list[first].at - from) first -= 1;
  const inside = first < 0 ? [] : list.slice(first);
  if (inside.length < 2) return null;
  const base = inside[0],
    last = inside.at(-1);
  return {
    inside,
    base,
    last,
    rate: ((last.level / base.level - 1) * 365 * DAY_MS * 100) / (last.at - base.at),
  };
}

// Lines are compared from one moment: the window's start, or, for the whole
// history, the latest first reading among them.
export function commonStart(lines, from = -Infinity) {
  return Math.max(
    from,
    ...(lines || []).map((line) => line.series?.[0]?.at ?? -Infinity),
  );
}

// A line's value at any moment, on the straight segment between its readings.
function valueAt(points, at) {
  if (at <= points[0].at) return points[0].value;
  if (at >= points.at(-1).at) return points.at(-1).value;
  for (let i = 1; i < points.length; i++)
    if (at <= points[i].at) {
      const a = points[i - 1],
        c = points[i];
      return a.value + ((c.value - a.value) * (at - a.at)) / Math.max(c.at - a.at, 1);
    }
  return points.at(-1).value;
}

// Where our line runs above the Market Average: stretches between the two
// lines, cut where they cross. Where we are below, there is nothing.
function aheadStretches(ours, market) {
  if (!ours || !market || market.points.length < 2) return [];
  const first = market.points[0].at,
    last = market.points.at(-1).at;
  const pts = ours.points.filter((point) => point.at >= first && point.at <= last);
  const out = [];
  let run = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const m = valueAt(market.points, p.at);
    const d = p.value - m;
    if (i > 0) {
      const q = pts[i - 1];
      const qd = q.value - valueAt(market.points, q.at);
      if (qd > 0 !== d > 0 && qd !== d) {
        const t = qd / (qd - d);
        const at = q.at + (p.at - q.at) * t;
        const v = q.value + (p.value - q.value) * t;
        if (qd > 0) {
          run.push({ at, top: v, bottom: v });
          if (run.length > 1) out.push(run);
          run = [];
        } else run = [{ at, top: v, bottom: v }];
      }
    }
    if (d > 0) run.push({ at: p.at, top: p.value, bottom: m });
  }
  if (run.length > 1) out.push(run);
  return out;
}

// Two views of one comparison. "rate": each line's 30-day rate, day by day, so
// the gap between them is visible and the right edge is the 30-day figure.
// "earned": what one amount earned on each since the start of the window.
export function ComparisonChart({
  lines,
  from = -Infinity,
  amount = 10000,
  token = "USDC",
  height = 260,
  markers = [],
  mode = "rate",
}) {
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
  const hatchId = "ahead" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const rolling = useMemo(
    () =>
      mode === "rate"
        ? (lines || []).map((line) => ({
            ...line,
            rolled: earnedSeries(line.series, 30).map((point) => ({
              at: point.at,
              level: point.rate,
            })),
          }))
        : lines,
    [lines, mode],
  );
  const start =
    mode === "rate"
      ? commonStart(rolling.map((line) => ({ series: line.rolled })), from)
      : commonStart(lines, from);
  const usable = useMemo(
    () =>
      mode === "rate"
        ? rolling
            .map((line) => {
              const inside = line.rolled.filter((point) => point.at >= start);
              if (inside.length < 2) return null;
              const last = inside.at(-1).level;
              return {
                ...line,
                // The right edge is the 30-day figure; where the page states it
                // for the same days, the label uses that figure.
                rate: line.rate ?? last,
                points: inside.map((point) => ({ at: point.at, value: point.level })),
              };
            })
            .filter(Boolean)
        : (lines || [])
            .map((line) => {
              const span = windowOf(line.series, start);
              if (!span) return null;
              const { inside, base } = span;
              const rate = line.rate ?? span.rate;
              return {
                ...line,
                rate,
                points: inside.map((point) => ({
                  at: point.at,
                  value: (point.level / base.level - 1) * amount,
                })),
              };
            })
            .filter(Boolean),
    [lines, rolling, start, amount, mode],
  );
  if (usable.length < 2)
    return (
      <div ref={box} className={b.chartEmpty} style={{ height: 120 }}>
        Not enough readings yet to compare.
      </div>
    );
  const narrow = (width || 720) < 560;
  const W = width || 720,
    H = height,
    left = 44,
    // On a phone the rates go in the readout below, so the plot keeps the width.
    right = narrow ? 14 : 178,
    top = 24,
    bottom = 26;
  const all = usable.flatMap((line) => line.points);
  const values = all.map((point) => point.value);
  const lo = mode === "rate" ? Math.min(...values) : Math.min(0, ...values),
    hi = Math.max(...values);
  // The plot uses its full height; gridlines sit at round amounts inside it.
  const step = niceStep((hi - lo) / 4);
  const yLo = Math.floor(lo / step) * step,
    yHi = Math.max(hi + (hi - yLo) * 0.06, yLo + step);
  const unit = mode === "rate" ? "% a year" : token;
  const t0 = Math.min(...all.map((point) => point.at)),
    t1 = Math.max(...all.map((point) => point.at));
  const x = (t) => left + ((t - t0) / Math.max(t1 - t0, 1)) * (W - left - right);
  const y = (v) => top + (1 - (v - yLo) / (yHi - yLo)) * (H - top - bottom);
  const path = (points) =>
    points
      .map(
        (point, index) =>
          (index ? "L" : "M") + x(point.at).toFixed(1) + " " + y(point.value).toFixed(1),
      )
      .join("");
  // Our gain over the Market Average, hatched: per year in the rate view, in
  // money in the earned view. A loss is not drawn.
  const oursLine = usable.find((line) => line.id === "thesauros");
  const marketLine = usable.find((line) => line.id === "index");
  const ahead = aheadStretches(oursLine, marketLine);
  const grid = [];
  for (let level = yLo; level <= yHi; level += step) grid.push(level);
  const shownMarkers = (markers || []).filter((marker) => marker.at > t0 && marker.at < t1);
  const nearest = (points, at) =>
    points.reduce((a, c) => (Math.abs(c.at - at) < Math.abs(a.at - at) ? c : a));
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      t0 +
      (((event.clientX - rect.left) / rect.width) * W - left) /
        ((W - left - right) / Math.max(t1 - t0, 1));
    setHover(Math.min(Math.max(at, t0), t1));
  }
  // End labels may not collide: push them apart, then back inside the plot.
  const gap = narrow ? 15 : 17;
  const ends = usable
    .map((line) => ({ line, y: y(line.points.at(-1).value) }))
    .sort((a, c) => a.y - c.y);
  for (let i = 1; i < ends.length; i++)
    if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
  const overflow = ends.length ? ends.at(-1).y - (H - bottom) : 0;
  if (overflow > 0) for (const end of ends) end.y -= overflow;
  // A finger lifting off keeps the day it chose; a mouse leaving clears it.
  const shownAt = hover ?? t1;
  const fmt = (v) =>
    mode === "rate"
      ? v.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0) + "%"
      : Math.abs(v) >= 100
        ? Math.round(v).toLocaleString("en-US")
        : v.toFixed(Number.isInteger(step) ? 0 : 1);
  return (
    <div ref={box} className={b.chartBox}>
      <svg
        className={b.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={usable
          .map((line) =>
            mode === "rate"
              ? `${line.name}: ${line.rate.toFixed(2)}% a year over the last 30 days`
              : `${line.name}: ${line.points.at(-1).value.toFixed(2)} ${token} earned, ${line.rate.toFixed(2)}% a year`,
          )
          .join("; ")}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={(event) => event.pointerType === "mouse" && setHover(null)}
      >
        <text x={2} y={10} className={b.axis}>
          {unit}
        </text>
        {shownMarkers.map((marker) => (
          <g key={marker.at + marker.label}>
            <line
              x1={x(marker.at)}
              x2={x(marker.at)}
              y1={top - 8}
              y2={H - bottom}
              className={b.markerLine}
            />
            <text
              x={x(marker.at) + (x(marker.at) > (W - right) * 0.6 ? -6 : 6)}
              y={top - 1}
              textAnchor={x(marker.at) > (W - right) * 0.6 ? "end" : "start"}
              className={b.axis}
            >
              {narrow ? marker.short || marker.label : marker.label}
            </text>
          </g>
        ))}
        {grid.map((level) => (
          <g key={level}>
            <line
              x1={left}
              x2={W - right}
              y1={y(level)}
              y2={y(level)}
              className={level === 0 ? b.baseLine : b.gridLine}
            />
            <text x={left - 8} y={y(level) + 4} textAnchor="end" className={b.axis}>
              {fmt(level)}
            </text>
          </g>
        ))}
        <defs>
          <pattern
            id={hatchId}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke={COMPARE_COLORS.thesauros} strokeWidth="1.6" strokeOpacity="0.45" />
          </pattern>
        </defs>
        {ahead.map((run, i) => (
          <path
            key={"ahead" + i}
            d={
              run.map((point, k) => (k ? "L" : "M") + x(point.at).toFixed(1) + " " + y(point.top).toFixed(1)).join("") +
              [...run].reverse().map((point) => "L" + x(point.at).toFixed(1) + " " + y(point.bottom).toFixed(1)).join("") +
              "Z"
            }
            fill={`url(#${hatchId})`}
            stroke="none"
          />
        ))}
        {[...usable].reverse().map((line) => (
          <path
            key={line.id}
            d={path(line.points)}
            fill="none"
            stroke={line.color}
            strokeWidth={line.id === "thesauros" ? 3 : line.strong ? 2 : 1.25}
            strokeOpacity={line.strong ? 1 : 0.9}
            strokeDasharray={line.strong ? undefined : COMPARE_DASH[line.id] || "5 4"}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {(narrow ? [] : ends).map(({ line, y: labelY }) => (
          <g key={line.id}>
            <circle
              cx={x(line.points.at(-1).at)}
              cy={y(line.points.at(-1).value)}
              r={line.strong ? 4 : 3}
              fill={line.color}
              stroke="#fff"
              strokeWidth="2"
            />
            <text
              x={W - right + 12}
              y={labelY + 4}
              className={line.strong ? b.endStrong : b.endLabel}
            >
              <tspan className={b.endValue}>
                {mode === "rate"
                  ? line.rate.toFixed(2) + "%"
                  : "+" + money(line.points.at(-1).value, line.points.at(-1).value >= 1000 ? 0 : 2)}
              </tspan>{" "}
              {line.tiny || line.short || line.name}
            </text>
          </g>
        ))}
        {hover != null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={top}
              y2={H - bottom}
              className={b.hoverLine}
            />
            {usable.map((line) => {
              const point = nearest(line.points, hover);
              return (
                <circle
                  key={line.id}
                  cx={x(point.at)}
                  cy={y(point.value)}
                  r="4"
                  fill={line.color}
                  stroke="#fff"
                  strokeWidth="2"
                />
              );
            })}
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
        <span>
          {mode === "rate"
            ? `30-day rate on ${niceDay(shownAt)}`
            : narrow && hover == null
              ? "A year over the period"
              : `Earned by ${niceDay(shownAt)}, in ${token}`}
        </span>
        {ahead.length > 0 && oursLine && marketLine && (
          <span>
            <i className={b.keyHatch} aria-hidden="true" /> Ahead of Market Average
            {hover != null &&
              (() => {
                const gain =
                  valueAt(oursLine.points, shownAt) - valueAt(marketLine.points, shownAt);
                return gain > 0 ? (
                  <strong>
                    {" "}
                    +{gain.toFixed(2)}
                    {mode === "rate" ? " pts a year" : ` ${token}`}
                  </strong>
                ) : null;
              })()}
          </span>
        )}
        {usable.map((line) => (
          <span key={line.id}>
            <i
              className={line.strong ? b.key : b.keyDashed}
              style={line.strong ? { background: line.color } : { borderColor: line.color }}
            />{" "}
            {narrow ? line.tiny || line.short || line.name : line.short || line.name}{" "}
            <strong>
              {mode === "rate"
                ? `${(hover == null ? line.rate : nearest(line.points, shownAt).value).toFixed(2)}%`
                : narrow && hover == null
                  ? `${line.rate.toFixed(2)}%`
                  : `+${nearest(line.points, shownAt).value.toFixed(2)}`}
            </strong>
          </span>
        ))}
      </p>
    </div>
  );
}

const DAY_MS = 86400000;
// 1, 2 or 5 times a power of ten, so the grid reads in round amounts.
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

// The vault's rate against a named comparison, with the same grid.
export function RateChart({
  series,
  height = 240,
  vaultLabel = "This vault",
  compareLabel = "Market Average",
}) {
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
  // Round rates for the gridlines: 2%, 3%, 4%, not 2.1%, 5.4%.
  const rateStep = niceStep((hi - lo) / 3);
  const grid = [];
  for (let v = Math.ceil(lo / rateStep) * rateStep; v <= hi + 1e-9; v += rateStep) grid.push(v);
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
  const marketAt = market.length
    ? market.reduce((a, c) =>
        Math.abs(c.t - shown.t) < Math.abs(a.t - shown.t) ? c : a,
      ).v
    : null;
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
        onPointerDown={move}
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
              {level.toFixed(Number.isInteger(rateStep) ? 0 : 1)}%
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
            <i className={b.keyMarket} /> {compareLabel}{" "}
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
// Softer fills and a 2px gap between bands, so the shares read as shares and
// not as a patchwork.
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
    // Steps, not slopes: a split holds until the next reading changes it.
    const stepped = (values) =>
      days.flatMap((day, at) => {
        const until = at + 1 < days.length ? days[at + 1].at : day.at;
        return [
          `${x(day.at).toFixed(1)},${y(values[at]).toFixed(1)}`,
          `${x(until).toFixed(1)},${y(values[at]).toFixed(1)}`,
        ];
      });
    const up = stepped(upper);
    const down = stepped(lower).reverse();
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
            fillOpacity={0.78}
            stroke="#fff"
            strokeWidth="2"
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
        {names.map((name, index) => {
          const held = shown.shares[index] >= 0.05;
          return (
            <li key={name} className={held ? undefined : b.legendPast}>
              <i style={{ background: marketColor(name) }} />
              {name}{" "}
              {held ? (
                <strong>{shown.shares[index].toFixed(1)}%</strong>
              ) : (
                <span>none that day</span>
              )}
            </li>
          );
        })}
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

// The gap to the index, week by week: above the line the vault earned more than
// the index over the previous seven days, below it less. One bar a reading.
export function GapChart({ points, height = 200, label = "This vault" }) {
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
  if (!points || points.length < 2)
    return (
      <div ref={box} className={b.chartEmpty} style={{ height: 120 }}>
        Not enough readings yet to compare.
      </div>
    );
  const W = width || 720,
    H = height,
    left = 2,
    right = 56,
    top = 12,
    bottom = 24;
  // Bars show each period's part of the whole gap when it is known, so they add
  // up to the figure above the chart.
  const value = (point) => point.share ?? point.gap;
  const gaps = points.map(value);
  const reach = Math.max(0.1, ...gaps.map(Math.abs)) * 1.15;
  const y = (v) => top + (1 - (v + reach) / (2 * reach)) * (H - top - bottom);
  const step = (W - left - right) / points.length;
  const bar = Math.max(6, Math.min(48, step * 0.55));
  const x = (i) => left + step * (i + 0.5);
  const shown = hover ?? points.length - 1;
  const p = points[shown];
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left) / rect.width) * W;
    setHover(Math.min(points.length - 1, Math.max(0, Math.floor((at - left) / step))));
  }
  const ticks = [reach / 1.15, 0, -reach / 1.15].map((v) => Math.round(v * 100) / 100);
  return (
    <div ref={box} className={b.chartBox}>
      <svg
        className={b.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label} against the Market Average over each previous week, from ${dateLabel(points[0].at, false)} to ${dateLabel(points.at(-1).at, false)}`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={W - right}
              y1={y(tick)}
              y2={y(tick)}
              className={tick === 0 ? b.baseLine : b.gridLine}
            />
            <text x={W - right + 8} y={y(tick) + 4} className={b.axis}>
              {tick > 0 ? "+" : tick < 0 ? "−" : ""}
              {Math.abs(tick).toFixed(2)}
            </text>
          </g>
        ))}
        {points.map((point, i) => (
          <rect
            key={point.at}
            x={x(i) - (point.partial ? bar * 0.5 : bar) / 2}
            y={Math.min(y(value(point)), y(0))}
            width={point.partial ? bar * 0.5 : bar}
            height={Math.max(1, Math.abs(y(value(point)) - y(0)))}
            rx="1.5"
            fill={value(point) >= 0 ? "var(--blue)" : "var(--ink-4)"}
            opacity={hover == null || hover === i ? 1 : 0.55}
          />
        ))}
        {points.map((point, i) => (
          <text key={"d" + point.at} x={x(i)} y={H - 6} textAnchor="middle" className={b.axis}>
            {dateLabel(point.at, false)}
          </text>
        ))}
      </svg>
      <p className={b.chartRead} aria-live="polite">
        <span>
          <i className={b.key} style={{ background: "var(--blue)" }} /> ahead
        </span>
        <span>
          <i className={b.key} style={{ background: "var(--ink-4)" }} /> behind
        </span>
        <span>
          {p.partial
            ? `${dateLabel(p.from, false)} to ${dateLabel(p.at, false)}`
            : `Week to ${dateLabel(p.at, false)}`}
          : {label} <strong>{pct(p.ours)}</strong>, Market Average{" "}
          <strong>{pct(p.index)}</strong> a year
          {p.share != null ? (
            <>
              ; adds{" "}
              <strong>
                {p.share >= 0 ? "+" : "−"}
                {Math.abs(p.share).toFixed(2)} pts
              </strong>{" "}
              to the gap
            </>
          ) : (
            <>
              ,{" "}
              <strong>
                {p.gap >= 0 ? "+" : "−"}
                {Math.abs(p.gap).toFixed(2)} pts
              </strong>
            </>
          )}
        </span>
      </p>
    </div>
  );
}
