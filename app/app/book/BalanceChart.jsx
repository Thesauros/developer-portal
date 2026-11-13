"use client";
import { useState } from "react";
import { useWidth } from "./charts";
import { clock, dateLabel, money } from "./parts";
import c from "./portfolio.module.css";

const niceStep = (raw) => {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
};
const axisLabel = (value, step) =>
  Math.abs(value) >= 10000
    ? (value / 1000).toFixed(step >= 1000 ? 0 : 1) + "k"
    : value.toLocaleString("en-US", {
        maximumFractionDigits: step >= 1 ? 0 : step >= 0.1 ? 1 : 2,
      });

// A person's balance in the vault, day by day. In "balance" the line is what the
// position was worth and the step beneath it is what they had put in, so the
// band between the two is what they earned. In "earned" that band is the chart.
export default function BalanceChart({ points, mode = "balance", height = 240 }) {
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
  if (!points || points.length < 2)
    return (
      <div ref={box} className={c.chartEmpty}>
        The chart starts with your first settled day.
      </div>
    );
  const W = width || 720,
    H = height,
    left = 2,
    right = 58,
    top = 14,
    bottom = 26;
  const earned = mode === "earned";
  const values = earned
    ? points.map((point) => point.earned)
    : points.flatMap((point) => [point.value, point.invested]);
  let min = Math.min(...values),
    max = Math.max(...values);
  if (earned) min = Math.min(min, 0);
  // A flat line still needs a band to sit in.
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.0005, 0.0005);
  min = earned ? min : Math.max(0, min - pad);
  max += pad;
  const range = max - min;
  const first = points[0].at,
    last = points.at(-1).at;
  const x = (at) => left + ((at - first) / Math.max(last - first, 1)) * (W - left - right);
  const y = (value) => top + (1 - (value - min) / range) * (H - top - bottom);
  const line = (pick) =>
    points
      .map((point, i) => `${i ? "L" : "M"}${x(point.at).toFixed(1)},${y(pick(point)).toFixed(1)}`)
      .join("");
  // What was put in changes in steps, at the moment of each request.
  const steps = points
    .map((point, i) =>
      i
        ? `H${x(point.at).toFixed(1)}V${y(point.invested).toFixed(1)}`
        : `M${x(point.at).toFixed(1)},${y(point.invested).toFixed(1)}`,
    )
    .join("");
  const main = line(earned ? (point) => point.earned : (point) => point.value);
  const floor = y(earned ? Math.max(min, 0) : min).toFixed(1);
  const area = `${main}L${x(last).toFixed(1)},${floor}L${x(first).toFixed(1)},${floor}Z`;
  const step = niceStep(range / 3);
  const levels = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) levels.push(v);
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      first +
      (((event.clientX - rect.left) / rect.width) * W - left) /
        ((W - left - right) / Math.max(last - first, 1));
    setHover(points.reduce((a, p) => (Math.abs(p.at - at) < Math.abs(a.at - at) ? p : a)));
  }
  const shown = hover ?? points.at(-1);
  const digits = Math.abs(shown.earned) < 1 ? 4 : 2;
  return (
    <div ref={box} className={c.chartBox}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          earned
            ? `Earned ${money(points.at(-1).earned, digits)} USDC between ${dateLabel(first)} and ${dateLabel(last)}`
            : `Balance ${money(points.at(-1).value)} USDC on ${dateLabel(last)}, of which ${money(points.at(-1).invested)} USDC was deposited`
        }
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        {levels.map((level) => (
          <g key={level}>
            <line x1={left} x2={W - right} y1={y(level)} y2={y(level)} className={c.grid} />
            <text x={W - right + 8} y={y(level) + 4} className={c.axis}>
              {axisLabel(level, step)}
            </text>
          </g>
        ))}
        <path d={area} className={c.area} />
        {!earned && <path d={steps} className={c.invested} />}
        <path d={main} className={c.line} />
        {hover && (
          <>
            <line x1={x(hover.at)} x2={x(hover.at)} y1={top} y2={H - bottom} className={c.hoverLine} />
            <circle cx={x(hover.at)} cy={y(earned ? hover.earned : hover.value)} r="4" className={c.dot} />
          </>
        )}
        <text x={left} y={H - 6} className={c.axis}>
          {dateLabel(first, false)}
        </text>
        <text x={W - right} y={H - 6} textAnchor="end" className={c.axis}>
          {dateLabel(last, false)}
        </text>
      </svg>
      <p className={c.read} aria-live="polite">
        <span>{clock(shown.at)}</span>
        <span>
          <i className={c.keyLine} /> Balance <strong>{money(shown.value)}</strong>
        </span>
        <span>
          <i className={c.keyStep} /> Deposited <strong>{money(shown.invested)}</strong>
        </span>
        <span>
          <i className={c.keyBand} /> Earned{" "}
          <strong>
            {shown.earned >= 0 ? "+" : "−"}
            {money(Math.abs(shown.earned), digits)}
          </strong>
        </span>
      </p>
    </div>
  );
}
