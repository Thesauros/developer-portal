"use client";
import { useMemo, useState } from "react";
import { DAY } from "../../../lib/vault-metrics.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import { dateLabel, money, Section, Segmented, signed } from "./parts";
import { PERIODS } from "./IndexPage";
import b from "./book.module.css";

// The reading of a chained series nearest a moment, within a day of it.
const near = (series, at) =>
  (series || []).reduce(
    (best, point) =>
      Math.abs(point.at - at) <= 1.1 * DAY &&
      (!best || Math.abs(point.at - at) < Math.abs(best.at - at))
        ? point
        : best,
    null,
  );

// What a real amount would have done over a real period: in Thesauros, from
// share prices, and in the Market Average over exactly the same days.
export default function WhatIf({ book, navigate }) {
  const [amount, setAmount] = useState("10000");
  const [days, setDays] = useState(30);
  const value = Number(String(amount).replace(/[^\d.]/g, "")) || 0;
  const ours = book.product.record.measure.series;
  const index = book.index;
  const result = useMemo(() => {
    if (!ours?.length || !index?.series?.length) return null;
    const end = Math.min(ours.at(-1).at, index.series.at(-1).at);
    const start = Math.max(ours[0].at, index.series[0].at);
    const from = days ? Math.max(end - days * DAY, start) : start;
    const a = near(ours, from),
      c = near(ours, end),
      ia = near(index.series, from),
      ic = near(index.series, end);
    if (!a || !c || !ia || !ic || c.at <= a.at) return null;
    return {
      from: a.at,
      to: c.at,
      gain: value * (c.level / a.level - 1),
      indexGain: value * (ic.level / ia.level - 1),
    };
  }, [ours, index, days, value]);
  if (!result) return null;
  const max = Math.max(result.gain, result.indexGain, 0.000001);
  const bar = (gain, color) => (
    <span className={b.gain}>
      <span className={b.gainTrack}>
        <i
          style={{
            width: Math.max((Math.max(gain, 0) / max) * 100, 1) + "%",
            background: color,
          }}
        />
      </span>
      {signed(gain)}
    </span>
  );
  return (
    <Section
      id="what-if"
      title="What if you had deposited"
      lede={`From ${dateLabel(result.from, false)} to ${dateLabel(result.to, false)}, worked out from real share prices and from the Market Average over the same days. Past results; rates change.`}
      aside={
        <div className={b.controls}>
          <label className={b.inlineField}>
            <span className={b.amount}>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="Amount"
              />
              USDC
            </span>
          </label>
          <Segmented label="Period" value={days} onChange={setDays} options={PERIODS} />
        </div>
      }
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.whatIf}`}>
          <thead>
            <tr>
              <th />
              <th>Gain</th>
              <th className={b.num}>Value now</th>
              <th className={b.num}>After the planned {PLANNED_PERFORMANCE_FEE}% fee</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-cell="vault">
                <strong>Thesauros USDC</strong>
              </td>
              <td data-label="Gain">{bar(result.gain, "var(--blue)")}</td>
              <td className={b.num} data-label="Value now">
                {money(value + result.gain)}
              </td>
              <td
                className={b.num}
                data-label={`After the planned ${PLANNED_PERFORMANCE_FEE}% fee`}
              >
                {money(value + result.gain * (1 - PLANNED_PERFORMANCE_FEE / 100))}
              </td>
            </tr>
            <tr className={b.comparisonRow}>
              <td data-cell="vault">
                <button className={b.rowLink} onClick={() => navigate("index")}>
                  USDC Market Average
                </button>
              </td>
              <td data-label="Gain">{bar(result.indexGain, "#5f7183")}</td>
              <td className={b.num} data-label="Value now">
                {money(value + result.indexGain)}
              </td>
              <td className={b.num} data-label="After fees">
                <span className={b.quiet}>no fee</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        Thesauros USDC is the record of every Thesauros USDC vault, weighted by
        the money each held. No fee is charged today; the planned fee is shown
        for comparison. The Market Average is a measure, not something you can
        deposit into. Network costs are not included.
      </p>
    </Section>
  );
}
