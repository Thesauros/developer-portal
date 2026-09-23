"use client";
import { useMemo, useState } from "react";
import RateChart, { RateLegend } from "./RateChart";
import { Allocation, VaultMark, combine } from "./Portfolio";
import Rail, { RailLayout } from "./Rail";
import {
  ago,
  average,
  money,
  pct,
  points,
  shortAddress,
  units,
} from "./format";
import c from "./cabinet.module.css";

export default function Vaults({
  account,
  market,
  mine,
  period,
  setPeriod,
  onEarn,
  initial,
  navigate,
  needsWallet,
}) {
  const rows = useMemo(
    () => combine(market.data, account, mine.data),
    [market.data, account, mine.data],
  );
  const [selected, setSelected] = useState(initial || "arbitrum");
  const v = rows.find((r) => r.id === selected) || rows[0];
  if (!v)
    return (
      <div className={c.page}>
        <p className={c.emptyLine}>{market.error || "Loading vaults…"}</p>
      </div>
    );
  const chain = v.chain;
  const fee = (x) => (x == null ? "—" : (Number(x) / 1e16).toFixed(2) + "%");
  const vaultAvg = average(v.series.vault);
  const marketAvg = average(v.series.market);
  return (
    <RailLayout
      rail={
        <Rail
          rows={rows}
          onEarn={onEarn}
          navigate={navigate}
          needsWallet={needsWallet}
        />
      }
    >
      <div className={c.tableWrap}>
        <table className={`${c.table} ${c.selectable}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th className={c.num}>Rate now</th>
              <th className={c.num}>30-day avg</th>
              <th className={c.num}>vs market</th>
              <th className={c.num}>Total deposits</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                aria-selected={r.id === v.id}
                onClick={() => setSelected(r.id)}
              >
                <td>
                  <button
                    className={c.vaultCell}
                    onClick={() => setSelected(r.id)}
                  >
                    <VaultMark vault={r} />
                    <span>
                      <strong>{r.token}</strong>
                      <small>{r.network}</small>
                    </span>
                  </button>
                </td>
                <td className={c.num}>{pct(r.rate)}</td>
                <td className={c.num}>{pct(r.apr30d)}</td>
                <td className={c.num}>
                  {r.marketSpread30d ? points(r.marketSpread30d) : "—"}
                </td>
                <td className={c.num}>
                  {money(r.tvl)} {r.token}
                </td>
                <td>
                  {r.depositable ? (
                    <span className={c.ok}>Open here</span>
                  ) : (
                    <span className={c.muted}>In the Thesauros app</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div className={c.vaultTitle}>
            <VaultMark vault={v} size={36} />
            <div>
              <h2>
                {v.token} on {v.network}
              </h2>
              <p className={c.muted}>
                {v.address && (
                  <a
                    href={v.explorer + "/address/" + v.address}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(v.address)}
                  </a>
                )}
              </p>
            </div>
          </div>
          {v.depositable ? (
            <div className={c.actions}>
              <button
                className={c.primary}
                onClick={() => onEarn(v.id, "deposit")}
              >
                Deposit
              </button>
              {v.balance > 0 && (
                <button
                  className={c.secondary}
                  onClick={() => onEarn(v.id, "withdraw")}
                >
                  Withdraw
                </button>
              )}
            </div>
          ) : (
            <a
              className={c.secondary}
              href="https://app.thesauros.io"
              target="_blank"
              rel="noreferrer"
            >
              Open in Thesauros app
            </a>
          )}
        </header>
        <dl className={c.factsGrid}>
          <div>
            <dt>Rate now</dt>
            <dd>{pct(v.rate)}</dd>
          </div>
          <div>
            <dt>
              Average,{" "}
              {period === "180d" ? "6 months" : period.replace("d", " days")}
            </dt>
            <dd>{pct(vaultAvg)}</dd>
          </div>
          <div>
            <dt>Market average</dt>
            <dd>{pct(marketAvg)}</dd>
          </div>
          <div>
            <dt>Extra yield</dt>
            <dd className={vaultAvg - marketAvg >= 0 ? c.positive : c.negative}>
              {vaultAvg != null && marketAvg != null
                ? points(vaultAvg - marketAvg)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Total deposits</dt>
            <dd>{money(v.tvl, 0)}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>
              {chain
                ? `${fee(chain.managementFee)} / ${fee(chain.performanceFee)}`
                : "—"}
            </dd>
            <small>management / performance</small>
          </div>
          <div>
            <dt>Minimum deposit</dt>
            <dd>{chain ? money(units(chain.minAssets, v.decimals)) : "—"}</dd>
          </div>
          <div>
            <dt>Deposits / withdrawals</dt>
            <dd>
              {chain
                ? `${chain.depositPaused ? "Paused" : "Open"} / ${chain.withdrawPaused ? "Paused" : "Open"}`
                : "—"}
            </dd>
          </div>
        </dl>
        <div className={c.sectionHead}>
          <h3>Rate history</h3>
          <div className={c.segmented} role="group" aria-label="Period">
            {["7d", "30d", "180d"].map((p) => (
              <button
                key={p}
                aria-pressed={p === period}
                onClick={() => setPeriod(p)}
              >
                {p === "180d" ? "6m" : p}
              </button>
            ))}
          </div>
        </div>
        <RateChart
          series={v.series}
          label={`${v.network} vault rate history`}
        />
        <RateLegend />
      </section>

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Allocation</h2>
            <p className={c.muted}>
              Where this vault lends right now
              {v.allocationObservedAt
                ? `, read ${ago(v.allocationObservedAt)}`
                : ""}
              . Core markets are the largest, longest-running lenders; satellite
              markets are curated vaults with higher rates.
            </p>
          </div>
        </header>
        <Allocation
          providers={v.providers}
          total={v.balance > 0 ? v.balance : null}
          token={v.token}
        />
        {v.lastRebalance && (
          <p className={c.rebalance}>
            Last rebalance {ago(v.lastRebalance.at)}: moved{" "}
            {money(v.lastRebalance.amount)} {v.token}
            {v.lastRebalance.fromName && v.lastRebalance.toName
              ? ` from ${v.lastRebalance.fromName} to ${v.lastRebalance.toName}`
              : ""}
            .{" "}
            <a
              href={v.explorer + "/tx/" + v.lastRebalance.txHash}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
            </a>
          </p>
        )}
      </section>
    </RailLayout>
  );
}
