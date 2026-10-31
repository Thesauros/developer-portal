"use client";
import { useMemo, useState } from "react";
import RateChart, { RateLegend } from "./RateChart";
import {
  Allocation,
  Health,
  providersByNetwork,
  VaultMark,
  aggregateSeries,
  combine,
} from "./Portfolio";
import Rail, { RailLayout } from "./Rail";
import {
  ago,
  average,
  day,
  money,
  pct,
  points,
  shortAddress,
  units,
} from "./format";
import c from "./cabinet.module.css";

function Rebalances({ items, showVault }) {
  const [all, setAll] = useState(false);
  if (!items.length)
    return (
      <p className={c.emptyLine}>
        Rebalance history is available for the Arbitrum and Base vaults.
      </p>
    );
  const shown = all ? items : items.slice(0, 6);
  return (
    <>
      <ul className={c.moves}>
        {shown.map((e) => (
          <li key={e.txHash + e.logIndex}>
            <span className={c.moveDate}>{day(e.at, true)}</span>
            <span className={c.moveRoute}>
              {showVault && <VaultMark vault={e.vault} size={18} />}
              {e.fromName || shortAddress(e.from)}
              <span aria-hidden="true" className={c.moveArrow}>
                →
              </span>
              {e.toName || shortAddress(e.to)}
            </span>
            <span className={c.num}>
              {money(e.amount)} {e.vault.token}
            </span>
            <a
              className={c.receipt}
              href={e.vault.explorer + "/tx/" + e.txHash}
              target="_blank"
              rel="noreferrer"
            >
              Transaction
            </a>
          </li>
        ))}
      </ul>
      {items.length > 6 && (
        <button className={c.link} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

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
  const [selected, setSelected] = useState(initial || "all");
  if (!rows.length)
    return (
      <div className={c.page}>
        <p className={c.emptyLine}>{market.error || "Loading vaults…"}</p>
      </div>
    );
  const single = rows.find((r) => r.id === selected);
  const held = rows.filter((r) => r.balance > 0);
  const weightOf = held.length ? (r) => r.balance : (r) => r.tvl;
  const series = single
    ? single.series
    : {
        vault: aggregateSeries(rows, "vault", weightOf),
        market: aggregateSeries(rows, "market", weightOf),
      };
  const vaultAvg = average(series.vault);
  const marketAvg = average(series.market);
  const providers = single
    ? single.providers.map((p) => ({ ...p, vault: single }))
    : providersByNetwork(rows, (r) => r.tvl);
  const moves = (single ? [single] : rows)
    .flatMap((r) => (r.rebalances || []).map((e) => ({ ...e, vault: r })))
    .sort((a, b) => b.at - a.at);
  const chain = single?.chain;
  const fee = (x) => (x == null ? "—" : (Number(x) / 1e16).toFixed(2) + "%");

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
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                aria-selected={r.id === selected}
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
                    <span className={c.ok}>Here</span>
                  ) : (
                    <span className={c.muted}>Thesauros app</span>
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
            {single ? (
              <VaultMark vault={single} size={36} />
            ) : (
              <span className={c.chainStack} aria-hidden="true">
                {rows.map((r) => (
                  <VaultMark key={r.id} vault={r} size={24} />
                ))}
              </span>
            )}
            <div>
              <h2>
                {single
                  ? `${single.token} on ${single.network}`
                  : "All networks"}
              </h2>
              <p className={c.muted}>
                {single?.address ? (
                  <a
                    href={single.explorer + "/address/" + single.address}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(single.address)}
                  </a>
                ) : (
                  `Weighted by ${held.length ? "your balance" : "vault deposits"}`
                )}
              </p>
            </div>
          </div>
          {single &&
            (single.depositable ? (
              <div className={c.actions}>
                <button
                  className={c.primary}
                  onClick={() => onEarn(single.id, "deposit")}
                  disabled={single.depositPaused}
                >
                  Deposit
                </button>
                {single.balance > 0 && (
                  <button
                    className={c.secondary}
                    onClick={() => onEarn(single.id, "withdraw")}
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
            ))}
        </header>

        <div className={c.controls}>
          <div className={c.segmented} role="group" aria-label="Network">
            <button aria-pressed={!single} onClick={() => setSelected("all")}>
              All
            </button>
            {rows.map((r) => (
              <button
                key={r.id}
                aria-pressed={r.id === selected}
                onClick={() => setSelected(r.id)}
              >
                <VaultMark vault={r} size={16} />
                {r.network}
              </button>
            ))}
          </div>
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

        <dl className={c.factsGrid}>
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
            <dd>
              {money(
                single
                  ? single.tvl
                  : rows.reduce((s, r) => s + (r.tvl || 0), 0),
                0,
              )}
            </dd>
          </div>
          {single && (
            <>
              <div>
                <dt>Rate now</dt>
                <dd>{pct(single.rate)}</dd>
              </div>
              <div>
                <dt>Fees</dt>
                <dd>
                  {chain
                    ? `${fee(chain.managementFee)} / ${fee(chain.performanceFee)}`
                    : "—"}
                </dd>
                <small>management / performance, onchain</small>
              </div>
              <div>
                <dt>Minimum deposit</dt>
                <dd>
                  {chain ? money(units(chain.minAssets, single.decimals)) : "—"}
                </dd>
              </div>
              <div>
                <dt>Deposits / withdrawals</dt>
                <dd>
                  {chain
                    ? `${chain.depositPaused ? "Paused" : "Open"} / ${chain.withdrawPaused ? "Paused" : "Open"}`
                    : "—"}
                </dd>
              </div>
            </>
          )}
        </dl>

        <RateChart
          series={series}
          label={`${single ? single.network + " vault" : "All vaults"} rate against the lending market`}
        />
        <RateLegend />
      </section>

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Allocation</h2>
            <p className={c.muted}>
              {single
                ? `Where the ${single.network} vault lends right now${single.allocationObservedAt ? `, read ${ago(single.allocationObservedAt)}` : ""}.`
                : "Where all vaults lend right now, weighted by deposits."}{" "}
              Core markets are the largest, longest-running lenders; satellite
              markets are curated vaults with higher rates.
            </p>
          </div>
        </header>
        <Allocation
          providers={providers}
          total={single && single.balance > 0 ? single.balance : null}
          token={single?.token || "USDC"}
        />
      </section>

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Rebalance history</h2>
            <p className={c.muted}>
              Every move between lending markets, read from the vault contracts.
            </p>
          </div>
        </header>
        <Rebalances items={moves} showVault={!single} />
      </section>

      <Health rows={rows} market={market} />
    </RailLayout>
  );
}
