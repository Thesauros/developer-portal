"use client";
import { useMemo, useState } from "react";
import RateChart, { RateLegend, EarningsBars } from "./RateChart";
import {
  ago,
  average,
  day,
  earned,
  money,
  pct,
  points,
  signed,
  units,
} from "./format";
import c from "./cabinet.module.css";

// One row per vault combining onchain balances, earnings history and rates.
export function combine(market, account, mine) {
  return (market?.vaults || []).map((v) => {
    const chain = account.vaults.find(
      (x) => x.id === v.id && x.status === "ready",
    );
    const row = mine?.vaults?.find((x) => x.vaultId === v.id);
    const balance = chain ? units(chain.positionAssets, v.decimals) : null;
    const hasHistory = !!row?.transactions?.length;
    const derived =
      balance != null && hasHistory
        ? balance - row.deposited + row.withdrawn
        : null;
    return {
      ...v,
      chain,
      balance,
      cash: chain ? units(chain.cash, v.decimals) : null,
      earned: row?.earned ?? derived,
      deposited: row?.deposited || 0,
      withdrawn: row?.withdrawn || 0,
      dailyEarned: row?.dailyEarned || [],
      firstDepositAt: row?.firstDepositAt || null,
      rate: v.apyNow ?? v.apr30d,
      depositPaused: chain?.depositPaused ?? false,
      withdrawPaused: chain?.withdrawPaused ?? false,
    };
  });
}

// Weighted average of daily series across vaults. Weights are the user's
// balances when they hold any, otherwise each vault's total deposits.
export function aggregateSeries(rows, key, weightOf) {
  const byDay = new Map();
  for (const r of rows) {
    const w = weightOf(r);
    if (!(w > 0)) continue;
    for (const p of r.series?.[key] || []) {
      if (p.v == null) continue;
      const day = Math.floor(p.t / 86400000);
      const acc = byDay.get(day) || { t: p.t, sum: 0, w: 0 };
      acc.sum += p.v * w;
      acc.w += w;
      byDay.set(day, acc);
    }
  }
  return [...byDay.values()]
    .map((a) => ({ t: a.t, v: a.sum / a.w }))
    .sort((a, b) => a.t - b.t);
}

function sumDaily(rows) {
  const map = new Map();
  for (const r of rows)
    for (const t of r.dailyEarned)
      map.set(t.t, (map.get(t.t) || 0) + (t.v || 0));
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

export function Tier({ tier }) {
  if (!tier) return null;
  const label =
    { core: "Core", satellite: "Satellite", experimental: "Experimental" }[
      tier
    ] || tier;
  return (
    <span className={`${c.tier} ${c["tier_" + tier] || ""}`}>{label}</span>
  );
}

export function VaultMark({ vault, size = 28 }) {
  return vault.icon ? (
    <img
      src={vault.icon}
      width={size}
      height={size}
      alt=""
      className={c.vaultMark}
    />
  ) : (
    <span className={c.vaultMarkText} style={{ width: size, height: size }}>
      {vault.network[0]}
    </span>
  );
}

export function Allocation({ providers, total, token = "USDC" }) {
  if (!providers.length)
    return (
      <p className={c.muted}>
        Allocation data is refreshing. Check back in a minute.
      </p>
    );
  const palette = ["#196AFF", "#0F2437", "#6E9BE8", "#A9B8C7", "#D5DDE5"];
  return (
    <div className={c.allocation}>
      <div className={c.stack} aria-hidden="true">
        {providers.map((p, i) => (
          <span
            key={p.name + i}
            style={{
              width: p.share + "%",
              background: palette[i % palette.length],
            }}
          />
        ))}
      </div>
      <div className={c.tableWrap}>
        <table className={c.table}>
          <thead>
            <tr>
              <th>Lending market</th>
              <th>Risk tier</th>
              <th className={c.num}>Rate</th>
              <th className={c.num}>Share</th>
              {total != null && <th className={c.num}>Your {token}</th>}
            </tr>
          </thead>
          <tbody>
            {providers.map((p, i) => (
              <tr key={p.name + i}>
                <td>
                  <span
                    className={c.swatch}
                    style={{ background: palette[i % palette.length] }}
                  />
                  {p.logo && (
                    <img
                      src={"/brand/protocols/" + p.logo + ".png"}
                      width="20"
                      height="20"
                      alt=""
                      className={c.logo}
                    />
                  )}
                  {p.name}
                </td>
                <td>
                  <Tier tier={p.riskTier} />
                </td>
                <td className={c.num}>{pct(p.apy)}</td>
                <td className={c.num}>
                  {p.share != null ? p.share.toFixed(1) + "%" : "—"}
                </td>
                {total != null && (
                  <td className={c.num}>
                    {money((total * (p.share || 0)) / 100)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Calculator({ vault }) {
  const [amount, setAmount] = useState("10000");
  const value = Number(amount.replace(/[^\d.]/g, "")) || 0;
  const rate = vault?.apr30d ?? vault?.rate;
  const marketRate =
    rate != null && vault?.marketSpread30d != null
      ? rate - vault.marketSpread30d
      : null;
  const year = (value * (rate || 0)) / 100;
  return (
    <div className={c.calculator}>
      <label>
        <span>If you deposit</span>
        <span className={c.amountInput}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount in USDC"
          />
          USDC
        </span>
      </label>
      <dl className={c.projection}>
        <div>
          <dt>Per month</dt>
          <dd>{money(year / 12)}</dd>
        </div>
        <div>
          <dt>Per year</dt>
          <dd>{money(year)}</dd>
        </div>
        {marketRate != null && (
          <div>
            <dt>More than the market average</dt>
            <dd className={c.positive}>
              {signed((value * (rate - marketRate)) / 100)} a year
            </dd>
          </div>
        )}
      </dl>
      <p className={c.footnote}>
        At the {vault?.network} vault’s 30-day average of {pct(rate)}. Rates are
        variable; past rates do not promise future ones.
      </p>
    </div>
  );
}

export default function Portfolio({
  mode,
  needsWallet = false,
  account,
  market,
  mine,
  period,
  setPeriod,
  navigate,
  onEarn,
}) {
  const rows = useMemo(
    () => combine(market.data, account, mine.data),
    [market.data, account, mine.data],
  );
  const held = rows.filter((r) => r.balance > 0);
  const total = held.reduce((s, r) => s + r.balance, 0);
  const earnedTotal = rows.reduce((s, r) => s + (r.earned || 0), 0);
  const rate = total
    ? held.reduce((s, r) => s + r.balance * (r.rate || 0), 0) / total
    : null;
  const spread = total
    ? held.reduce((s, r) => s + r.balance * (r.marketSpread30d || 0), 0) / total
    : null;
  const since = Math.min(...rows.map((r) => r.firstDepositAt || Infinity));
  const cash = rows.reduce((s, r) => s + (r.cash || 0), 0);
  const daily = sumDaily(rows);
  const last30 = daily.reduce((s, t) => s + (t.v || 0), 0);

  const featured =
    [...held].sort((a, b) => b.balance - a.balance)[0] ||
    rows.find((r) => r.id === "arbitrum") ||
    rows[0];
  const [chosen, setChosen] = useState("all");
  const weightOf = held.length ? (r) => r.balance : (r) => r.tvl;
  const allVaults = {
    id: "all",
    network: "All networks",
    token: "USDC",
    series: {
      vault: aggregateSeries(rows, "vault", weightOf),
      market: aggregateSeries(rows, "market", weightOf),
    },
    providers: (() => {
      const byName = new Map();
      const total = rows.reduce((s, r) => s + (weightOf(r) || 0), 0);
      for (const r of rows)
        for (const p of r.providers || []) {
          const amount = ((weightOf(r) || 0) * (p.share || 0)) / 100;
          const prev = byName.get(p.name) || { ...p, amount: 0, rateSum: 0 };
          prev.amount += amount;
          prev.rateSum += amount * (p.apy || 0);
          byName.set(p.name, prev);
        }
      return [...byName.values()]
        .map((p) => ({
          ...p,
          share: total ? (p.amount / total) * 100 : null,
          apy: p.amount ? p.rateSum / p.amount : p.apy,
        }))
        .filter((p) => p.share >= 0.05)
        .sort((a, b) => b.share - a.share);
    })(),
  };
  const chartVault =
    chosen === "all"
      ? allVaults
      : rows.find((r) => r.id === chosen) || featured;

  const providers = useMemo(() => {
    if (!held.length) return chartVault?.providers || [];
    const byName = new Map();
    for (const r of held)
      for (const p of r.providers) {
        const amount = (r.balance * (p.share || 0)) / 100;
        const prev = byName.get(p.name) || { ...p, amount: 0, rateSum: 0 };
        prev.amount += amount;
        prev.rateSum += amount * (p.apy || 0);
        byName.set(p.name, prev);
      }
    return [...byName.values()]
      .map((p) => ({
        ...p,
        share: (p.amount / total) * 100,
        apy: p.amount ? p.rateSum / p.amount : p.apy,
      }))
      .sort((a, b) => b.share - a.share);
  }, [held, total, chartVault]);

  const loading = account.loading && !account.vaults.length;
  const recent = (mine.data?.transactions || []).slice(0, 5);
  const rebalance = (
    held.length ? held : chartVault?.id === "all" ? rows : [chartVault]
  )
    .map((r) => r?.lastRebalance && { ...r.lastRebalance, vault: r })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)[0];

  return (
    <div className={c.page}>
      <section className={c.statement} aria-label="Your balance">
        {loading ? (
          <div className={c.statementMain}>
            <p className={c.label}>Balance in Earn</p>
            <p className={c.balance}>
              <span className={c.skeleton}>00,000.00</span>
            </p>
            <p className={c.muted}>Reading your balance onchain…</p>
          </div>
        ) : total > 0 ? (
          <>
            <div className={c.statementMain}>
              <p className={c.label}>Balance in Earn</p>
              <p className={c.balance}>
                {money(total)} <span>USDC</span>
              </p>
              <p className={c.earnedLine}>
                <span className={c.positive}>
                  {signed(earnedTotal, earnedTotal < 1 ? 4 : 2)} USDC earned
                </span>
                {Number.isFinite(since) && (
                  <span className={c.muted}> since {day(since, true)}</span>
                )}
              </p>
              <div className={c.actions}>
                <button
                  className={c.primary}
                  onClick={() => onEarn(featured.id, "deposit")}
                >
                  Deposit
                </button>
                <button
                  className={c.secondary}
                  onClick={() => onEarn(featured.id, "withdraw")}
                >
                  Withdraw
                </button>
              </div>
            </div>
            <dl className={c.statementFacts}>
              <div>
                <dt>Earning now</dt>
                <dd>{pct(rate)}</dd>
                <small>variable, blended across your vaults</small>
              </div>
              <div>
                <dt>At this rate</dt>
                <dd>{money((total * (rate || 0)) / 100 / 12)}</dd>
                <small>
                  USDC a month, {money((total * (rate || 0)) / 100)} a year
                </small>
              </div>
              <div>
                <dt>Against the market</dt>
                <dd className={spread >= 0 ? c.positive : c.negative}>
                  {points(spread)}
                </dd>
                <small>30-day average vs average lending market</small>
              </div>
            </dl>
          </>
        ) : (
          <>
            <div className={c.statementMain}>
              <p className={c.label}>Balance in Earn</p>
              <p className={c.balance}>
                0.00 <span>USDC</span>
              </p>
              <p className={c.muted}>
                {needsWallet
                  ? "Link your treasury wallet to see its balance, earnings and activity here."
                  : cash > 0
                    ? `You have ${money(cash)} USDC in your wallet ready to deposit.`
                    : "Nothing deposited yet. Add USDC on Arbitrum or Base to start earning."}
              </p>
              <div className={c.actions}>
                {needsWallet ? (
                  <button
                    className={c.primary}
                    onClick={() => navigate("settings")}
                  >
                    Link treasury wallet
                  </button>
                ) : (
                  <button
                    className={c.primary}
                    onClick={() =>
                      onEarn(featured?.id || "arbitrum", "deposit")
                    }
                  >
                    Deposit USDC
                  </button>
                )}
                <button
                  className={c.secondary}
                  onClick={() => navigate("test")}
                >
                  Try with test funds
                </button>
              </div>
            </div>
            <Calculator vault={featured} />
          </>
        )}
      </section>

      {account.error && (
        <p className={c.notice} role="alert">
          {account.error}
        </p>
      )}

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Your rate against the market</h2>
            <p className={c.muted}>
              {chartVault?.id === "all"
                ? `Across all networks, weighted by ${held.length ? "your balance" : "vault deposits"}, Thesauros averaged `
                : `${chartVault?.network} ${chartVault?.token} vault averaged `}
              {pct(average(chartVault?.series?.vault || []))} over this period;
              the average lending market paid{" "}
              {pct(average(chartVault?.series?.market || []))}.
            </p>
          </div>
          <div className={c.controls}>
            <div className={c.segmented} role="group" aria-label="Network">
              <button
                aria-pressed={chartVault?.id === "all"}
                onClick={() => setChosen("all")}
              >
                <span className={c.chainStack} aria-hidden="true">
                  {rows.map((r) => (
                    <VaultMark key={r.id} vault={r} size={16} />
                  ))}
                </span>
                All
              </button>
              {rows.map((r) => (
                <button
                  key={r.id}
                  aria-pressed={r.id === chartVault?.id}
                  onClick={() => setChosen(r.id)}
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
        </header>
        {market.loading && !market.data ? (
          <div className={c.chartEmpty} style={{ height: 260 }}>
            Loading rate history…
          </div>
        ) : (
          <RateChart
            series={chartVault?.series}
            label={`${chartVault?.network} vault rate against the lending market`}
          />
        )}
        <RateLegend />
      </section>

      <div className={c.split}>
        <section className={c.section}>
          <header className={c.sectionHead}>
            <div>
              <h2>Where your money works</h2>
              <p className={c.muted}>
                {held.length
                  ? "Your balance spread across lending markets, by current vault allocation."
                  : chartVault?.id === "all"
                    ? "How Thesauros vaults allocate deposits right now, across all networks."
                    : `How the ${chartVault?.network} vault allocates deposits right now.`}
              </p>
            </div>
          </header>
          <Allocation
            providers={providers}
            total={held.length ? total : null}
            token={chartVault?.token}
          />
          {rebalance && (
            <p className={c.rebalance}>
              Last rebalance {ago(rebalance.at)}: moved{" "}
              {money(rebalance.amount)} {rebalance.vault.token}
              {rebalance.fromName && rebalance.toName
                ? ` from ${rebalance.fromName} to ${rebalance.toName}`
                : ""}
              .{" "}
              <a
                href={rebalance.vault.explorer + "/tx/" + rebalance.txHash}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            </p>
          )}
        </section>
        <section className={c.section}>
          <header className={c.sectionHead}>
            <div>
              <h2>Daily earnings</h2>
              <p className={c.muted}>
                {held.length
                  ? `${earned(last30)} USDC over the last 30 days`
                  : "Appears after your first deposit"}
              </p>
            </div>
          </header>
          <EarningsBars ticks={daily} />
          <dl className={c.miniFacts}>
            <div>
              <dt>Deposited</dt>
              <dd>{money(rows.reduce((s, r) => s + r.deposited, 0))}</dd>
            </div>
            <div>
              <dt>Withdrawn</dt>
              <dd>{money(rows.reduce((s, r) => s + r.withdrawn, 0))}</dd>
            </div>
            <div>
              <dt>In wallet</dt>
              <dd>{money(cash)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Vaults</h2>
            <p className={c.muted}>
              Your balance and current rate in every Thesauros vault.
            </p>
          </div>
          <button className={c.link} onClick={() => navigate("vaults")}>
            Compare vaults
          </button>
        </header>
        <div className={c.tableWrap}>
          <table className={c.table}>
            <thead>
              <tr>
                <th>Vault</th>
                <th className={c.num}>Your balance</th>
                <th className={c.num}>Earned</th>
                <th className={c.num}>Rate now</th>
                <th className={c.num}>30-day avg</th>
                <th className={c.num}>vs market</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={c.vaultCell}>
                      <VaultMark vault={r} />
                      <span>
                        <strong>{r.token}</strong>
                        <small>{r.network}</small>
                      </span>
                    </span>
                  </td>
                  <td className={c.num}>
                    {r.depositable ? money(r.balance) : "—"}
                  </td>
                  <td className={`${c.num} ${r.earned > 0 ? c.positive : ""}`}>
                    {r.earned ? earned(r.earned) : "—"}
                  </td>
                  <td className={c.num}>{pct(r.rate)}</td>
                  <td className={c.num}>{pct(r.apr30d)}</td>
                  <td className={c.num}>
                    {r.marketSpread30d ? points(r.marketSpread30d) : "—"}
                  </td>
                  <td className={c.rowActions}>
                    {r.depositable ? (
                      <>
                        <button
                          className={c.small}
                          onClick={() => onEarn(r.id, "deposit")}
                          disabled={r.depositPaused}
                        >
                          Deposit
                        </button>
                        {r.balance > 0 && (
                          <button
                            className={c.small}
                            onClick={() => onEarn(r.id, "withdraw")}
                            disabled={r.withdrawPaused}
                          >
                            Withdraw
                          </button>
                        )}
                      </>
                    ) : (
                      <a
                        className={c.small}
                        href="https://app.thesauros.io"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in app
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Recent activity</h2>
            <p className={c.muted}>
              Your deposits and withdrawals, from onchain records.
            </p>
          </div>
          <button className={c.link} onClick={() => navigate("activity")}>
            All activity
          </button>
        </header>
        <ActivityRows rows={recent} empty="No deposits or withdrawals yet." />
      </section>

      <Health rows={rows} market={market} />
    </div>
  );
}

export function ActivityRows({ rows, empty }) {
  if (!rows.length) return <p className={c.emptyLine}>{empty}</p>;
  return (
    <ul className={c.activity}>
      {rows.map((t) => (
        <li key={t.txHash + t.kind}>
          <span
            className={t.kind === "withdraw" ? c.dirOut : c.dirIn}
            aria-hidden="true"
          >
            {t.kind === "withdraw" ? "↑" : "↓"}
          </span>
          <span className={c.activityMain}>
            <strong>{t.kind === "withdraw" ? "Withdrawal" : "Deposit"}</strong>
            <small>
              {t.network} {t.token}, {day(t.at, true)}
              {t.status && t.status !== "success"
                ? ", awaiting confirmation"
                : ""}
            </small>
          </span>
          <span className={`${c.num} ${c.activityAmount}`}>
            {t.kind === "withdraw" ? "−" : "+"}
            {money(t.amount)} {t.token}
          </span>
          <a
            href={t.url}
            target="_blank"
            rel="noreferrer"
            className={c.receipt}
          >
            Receipt
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Health({ rows, market }) {
  const items = rows
    .filter((r) => r.depositable)
    .map((r) => {
      const problem = r.depositPaused || r.withdrawPaused;
      return {
        key: r.id,
        ok: !problem,
        text: problem
          ? `${r.network}: ${r.depositPaused ? "deposits" : ""}${r.depositPaused && r.withdrawPaused ? " and " : ""}${r.withdrawPaused ? "withdrawals" : ""} paused`
          : `${r.network}: deposits and withdrawals open`,
      };
    });
  return (
    <footer className={c.health}>
      {items.map((i) => (
        <span key={i.key} className={i.ok ? c.ok : c.warn}>
          {i.text}
        </span>
      ))}
      <span className={c.muted}>
        Rates updated {ago(Date.parse(market.data?.updatedAt))}
      </span>
    </footer>
  );
}
