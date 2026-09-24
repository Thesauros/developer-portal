"use client";
import { useMemo, useState } from "react";
import { EarningsArea } from "./RateChart";
import { Amount, VaultMark } from "./parts";
import Rail, { RailLayout } from "./Rail";
import { mergeActivity, rebalancesWhileHeld } from "./feed";
export { VaultMark };
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
  const providers = useMemo(() => {
    if (!held.length) return [];
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
      .filter((p) => p.share >= 0.05)
      .sort((a, b) => b.share - a.share);
  }, [held, total]);

  const loading = account.loading && !account.vaults.length;
  const moneyRows = mergeActivity(
    mine.data?.transactions || [],
    account.transactions || [],
  );
  const recent = [...moneyRows, ...rebalancesWhileHeld(rows, moneyRows)]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 4);
  const best = [...rows]
    .filter((r) => r.depositable)
    .sort((a, b) => (b.apr30d || 0) - (a.apr30d || 0))[0];
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
          <div className={c.heroGrowth}>
            <div className={c.statementMain}>
              <p className={c.label}>Balance in Earn</p>
              <p className={c.balance}>
                <Amount value={total} /> <span>USDC</span>
              </p>
              <p className={c.earnedLine}>
                <span className={c.positive}>
                  {signed(earnedTotal, earnedTotal < 1 ? 4 : 2)} USDC earned
                </span>
                {Number.isFinite(since) && (
                  <span className={c.muted}> since {day(since, true)}</span>
                )}
              </p>
            </div>
            <div className={c.growth}>
              <div className={c.growthHead}>
                <span className={c.muted}>Earnings, last 30 days</span>
                <strong className={c.positive}>+{earned(last30)} USDC</strong>
              </div>
              <EarningsArea ticks={daily} />
            </div>
          </div>
        ) : (
          <>
            <div className={c.statementMain}>
              <p className={c.label}>Balance in Earn</p>
              <p className={c.balance}>
                <Amount value={0} /> <span>USDC</span>
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

      {held.length > 0 ? (
        <section className={c.section}>
          <header className={c.sectionHead}>
            <div>
              <h2>Where your money works</h2>
              <p className={c.muted}>
                Your {money(total)} USDC by lending market, at each vault’s
                current allocation.
              </p>
            </div>
            <button className={c.link} onClick={() => navigate("vaults")}>
              Vault details
            </button>
          </header>
          <Allocation providers={providers} total={total} token="USDC" />
        </section>
      ) : (
        !loading && (
          <section className={c.section}>
            <header className={c.sectionHead}>
              <div>
                <h2>Choose where to start</h2>
                <p className={c.muted}>
                  {best
                    ? `The ${best.network} vault averaged ${pct(best.apr30d)} over 30 days, ${points(best.marketSpread30d)} above the average lending market.`
                    : "Compare rates, allocation and history for each vault."}
                </p>
              </div>
              <button className={c.link} onClick={() => navigate("vaults")}>
                Compare vaults
              </button>
            </header>
          </section>
        )
      )}

      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Recent activity</h2>
            <p className={c.muted}>
              Your deposits and withdrawals, and the rebalances that moved your
              money.
            </p>
          </div>
          <button className={c.link} onClick={() => navigate("activity")}>
            Full statement
          </button>
        </header>
        <ActivityRows rows={recent} empty="No activity yet." />
      </section>
    </RailLayout>
  );
}

const KIND = {
  deposit: { title: "Deposit", icon: "↓", tone: "dirIn", sign: "+" },
  withdraw: { title: "Withdrawal", icon: "↑", tone: "dirOut", sign: "−" },
  earned: { title: "Earned", icon: "+", tone: "dirEarn", sign: "+" },
  rebalance: { title: "Rebalanced", icon: "⇄", tone: "dirMove", sign: "" },
};

export function ActivityRows({ rows, empty }) {
  if (!rows.length) return <p className={c.emptyLine}>{empty}</p>;
  return (
    <ul className={c.activity}>
      {rows.map((t, i) => {
        const k = KIND[t.kind] || KIND.deposit;
        return (
          <li key={(t.txHash || t.at) + t.kind + i}>
            <span className={c[k.tone]} aria-hidden="true">
              {k.icon}
            </span>
            <span className={c.activityMain}>
              <strong>{k.title}</strong>
              <small>
                {t.kind === "rebalance"
                  ? `${t.network} vault: ${t.fromName || "provider"} to ${t.toName || "provider"}, ${day(t.at, true)}`
                  : t.kind === "earned"
                    ? `All vaults, ${day(t.at, true)}`
                    : `${t.network} ${t.token}, ${day(t.at, true)}`}
                {t.status && t.status !== "success"
                  ? ", awaiting confirmation"
                  : ""}
              </small>
            </span>
            <span
              className={`${c.num} ${c.activityAmount} ${t.kind === "earned" ? c.positive : ""}`}
            >
              {k.sign}
              {t.kind === "earned" ? earned(t.amount) : money(t.amount)}{" "}
              {t.token || "USDC"}
              {t.kind === "rebalance" && (
                <small className={c.amountNote}>moved in the vault</small>
              )}
            </span>
            {t.url ? (
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                className={c.receipt}
              >
                {t.kind === "rebalance" ? "Transaction" : "Receipt"}
              </a>
            ) : (
              <span />
            )}
          </li>
        );
      })}
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
