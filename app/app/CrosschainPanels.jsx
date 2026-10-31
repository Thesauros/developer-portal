"use client";
import { formatUnits } from "viem";
import { crosschain } from "../../lib/crosschain-config.mjs";
import { crosschainPersonalTotals } from "../../lib/crosschain-feed.mjs";
import s from "./crosschain.module.css";

export const amount = (value, decimals = 6) =>
  value == null || !/^\d+$/.test(String(value))
    ? "—"
    : formatUnits(BigInt(value), decimals);
const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
export function CrosschainStatus({ feed, loading }) {
  if (!feed)
    return (
      <p className={s.muted}>
        {loading
          ? "Reading the cross-chain contracts…"
          : "Cross-chain data is unavailable."}
      </p>
    );
  return (
    <>
      {Object.entries(feed.sourceErrors)
        .filter(([, error]) => error)
        .map(([source, error]) => (
          <p className={s.notice} role="alert" key={source}>
            {
              {
                vault: "Vault state",
                allocation: "Network allocation",
                account: "Your wallet balances",
                activity: "Your activity",
              }[source]
            }{" "}
            could not load: {error}
          </p>
        ))}
      {feed.backendError && (
        <p className={s.notice} role="status">
          {feed.backendError} New requests are disabled. Current balances,
          allocation and epoch state are read from the cross-chain contracts.
        </p>
      )}
      {feed.vault && (
        <p className={s.muted}>
          Verified EpochVault on Base · Block {feed.vault.blockNumber} ·{" "}
          {new Date(feed.vault.observedAt).toLocaleString()} ·{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={crosschain.explorer + "/address/" + crosschain.vault}
          >
            {short(crosschain.vault)} ↗
          </a>
          {" · NAV updated "}
          {new Date(
            Number(feed.vault.tick.committedAt) * 1000,
          ).toLocaleString()}
          {feed.vault.tick.ageSeconds == null ||
          feed.vault.tick.ageSeconds > feed.vault.risk.maxTickAge
            ? " (stale or not yet published)"
            : ""}
        </p>
      )}
    </>
  );
}
function Metrics({ items }) {
  return (
    <section className={s.metrics}>
      {items.map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}
export function CrosschainNetworks({ feed }) {
  return (
    <section className={s.card}>
      <h3>Capital across networks</h3>
      <p>
        One user position on Base. The strategy can allocate fund capital to
        both networks.
      </p>
      {crosschain.networks.map((network) => {
        const allocation = feed?.allocation?.chains?.find(
          (chain) => chain.chainId === network.chainId,
        );
        return (
          <article className={s.network} key={network.chainId}>
            <h4>
              {network.name} · {network.role === "hub" ? "Hub" : "Spoke"}
            </h4>
            <p>
              Invested: {amount(allocation?.strategyValue)} USDC · Agent cash:{" "}
              {amount(allocation?.idle)} USDC
            </p>
            <a
              target="_blank"
              rel="noreferrer"
              href={network.explorer + "/address/" + network.strategy}
            >
              Strategy {short(network.strategy)} ↗
            </a>
            <a
              target="_blank"
              rel="noreferrer"
              href={network.explorer + "/address/" + network.agent}
            >
              ChainAgent {short(network.agent)} ↗
            </a>
            {allocation && (
              <p className={s.muted}>
                Read from {network.name} block {allocation.blockNumber}.
              </p>
            )}
          </article>
        );
      })}
      <p className={s.muted}>
        Bridge transfers in flight: unavailable. No transfer index has been
        connected.
      </p>
    </section>
  );
}
function Coverage({ history }) {
  if (!history) return <p className={s.muted}>Event history has not loaded.</p>;
  const coverage = history.coverage;
  return (
    <p className={s.muted}>
      {coverage.complete
        ? "Event index is up to date"
        : "Event history is being indexed"}
      : blocks {coverage.fromBlock}–{coverage.indexedTo} of{" "}
      {coverage.headBlock ?? "unknown"}.
      {coverage.lastSync && (
        <> Updated {new Date(coverage.lastSync).toLocaleString()}.</>
      )}
      {coverage.error && <> Indexer error: {coverage.error}</>}
      {history.truncated && <> Showing the latest 500 events.</>}
    </p>
  );
}
function SharePrice({ history }) {
  const ticks = [...(history?.ticks || [])].sort((a, b) => a.at - b.at);
  const points = ticks
    .filter((tick) => tick.rateBid != null)
    .map((tick) => ({
      at: tick.at,
      value: Number(formatUnits(BigInt(tick.rateBid), 18)),
    }));
  const min = Math.min(...points.map((point) => point.value)),
    max = Math.max(...points.map((point) => point.value));
  const span = Math.max(max - min, max * 0.00001),
    first = points[0]?.at,
    last = points.at(-1)?.at;
  const path = points
    .map((point, index) => {
      const x = 15 + ((point.at - first) / Math.max(last - first, 1)) * 670;
      const y = 165 - ((point.value - min) / span) * 140;
      return `${index ? "H" : "M"}${x.toFixed(2)}${index ? "V" : ","}${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <section className={s.card}>
      <h3>Share price · USDC per share</h3>
      {points.length < 2 ? (
        <p>
          Waiting for at least two accepted NAV observations. No estimated curve
          is shown.
        </p>
      ) : (
        <>
          <svg
            className={s.chart}
            viewBox="0 0 700 185"
            role="img"
            aria-label={`Accepted share price observations from ${new Date(first).toLocaleDateString()} to ${new Date(last).toLocaleDateString()}`}
          >
            <path d={path} fill="none" stroke="#196aff" strokeWidth="2.5" />
          </svg>
          <p>
            {new Date(first).toLocaleDateString()}: {points[0].value.toFixed(6)}{" "}
            → {new Date(last).toLocaleDateString()}:{" "}
            {points.at(-1).value.toFixed(6)} USDC/share.
          </p>
        </>
      )}
      <Coverage history={history} />
    </section>
  );
}
export default function CrosschainPanels({ view, feed, navigate, loading }) {
  const vault = feed?.vault,
    user = feed?.user,
    totals =
      user?.coverage?.complete && !user.truncated
        ? crosschainPersonalTotals(user)
        : null;
  if (view === "activity") return <CrosschainActivity feed={feed} />;
  if (view === "vaults")
    return (
      <>
        <Metrics
          items={[
            ["Fund NAV · USDC", amount(vault?.tick.navBid)],
            [
              "Share price · USDC",
              amount(vault?.tick.rateBid, 18).replace(/(\.\d{8})\d+$/, "$1"),
            ],
            ["Total vault shares", amount(vault?.totalSupply)],
            ["Current epoch", vault?.epoch.id ?? "—"],
          ]}
        />
        <section className={s.card}>
          <h3>{vault?.symbol || "Cross-chain USDC EpochVault"}</h3>
          <p>
            Deposits and withdrawals are requested on Base and settled in
            epochs. Arbitrum holds strategy capital; it is not a second user
            vault.
          </p>
          <div className={s.actions}>
            <button onClick={() => navigate("earn")}>Deposit & withdraw</button>
            <a
              target="_blank"
              rel="noreferrer"
              href={crosschain.explorer + "/address/" + crosschain.accountant}
            >
              View NAV accountant ↗
            </a>
          </div>
          <p>
            Hub cash: {amount(vault?.accounting.cash)} USDC · Pending deposits:{" "}
            {amount(vault?.accounting.pendingDeposits)} USDC · Redemption
            liabilities: {amount(vault?.accounting.liabilities)} USDC.
          </p>
          <p>
            Minimum deposit: {amount(vault?.limits.minDeposit)} USDC. Deposit
            requests:{" "}
            {vault ? (vault.depositPaused ? "paused" : "open") : "unknown"}.
            Withdrawal requests:{" "}
            {vault ? (vault.redeemPaused ? "paused" : "open") : "unknown"}.
          </p>
          <p className={s.muted}>
            Fund NAV and hub cash are different accounting measures. Pending
            deposits and redemption liabilities are shown separately.
          </p>
        </section>
        <CrosschainNetworks feed={feed} />
        <SharePrice history={feed?.activity} />
      </>
    );
  return (
    <>
      <Metrics
        items={[
          ["Your shares · USDC estimate", amount(user?.valueBid)],
          ["USDC in your Base wallet", amount(user?.cash)],
          ["Your available vault shares", amount(user?.shares)],
          [
            "Pending deposits · USDC",
            totals ? amount(totals.pendingDeposit) : "—",
          ],
        ]}
      />
      <section className={s.card}>
        <h3>Your cross-chain position</h3>
        <p>
          Your vault position is held on Base. Its value uses the latest
          accepted NAV; it is not a guaranteed withdrawal quote.
        </p>
        <div className={s.actions}>
          <button onClick={() => navigate("earn")}>Deposit & withdraw</button>
          <button onClick={() => navigate("activity")}>View activity</button>
          <button onClick={() => navigate("vaults")}>Explore vault</button>
        </div>
        <p>
          Shares ready to claim: {totals ? amount(totals.unclaimedShares) : "—"}{" "}
          · Withdrawals ready to claim:{" "}
          {totals ? amount(totals.redeemAssets) : "—"} USDC.
        </p>
        <p className={s.muted}>
          Request totals include the indexed and explicitly tracked requests.
          Personal earnings are unavailable until a complete cost-basis history
          is available; missing data is not shown as zero.
        </p>
        <Coverage history={feed?.activity} />
      </section>
      <SharePrice history={feed?.activity} />
    </>
  );
}
function CrosschainActivity({ feed }) {
  const history = feed?.activity,
    events = history?.events || [];
  const labels = {
    deposit_requested: "Deposit requested",
    redeem_requested: "Withdrawal requested",
    request_cancelled: "Request cancelled",
    deposit_claimed: "Deposit shares claimed",
    redeem_claimed: "Withdrawal claimed",
    instant_exit: "Instant withdrawal",
  };
  return (
    <section className={s.card}>
      <h3>Your transactions on Base</h3>
      <Coverage history={history} />
      {!history ? (
        <p>Loading EpochVault events for your signed-in wallet…</p>
      ) : !events.length ? (
        <p>
          {history.coverage.complete
            ? "No EpochVault events found for this wallet in the indexed range."
            : "No events found yet. The index is still catching up; this is not a complete history."}
        </p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Operation</th>
                <th>Amount</th>
                <th>Request</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.txHash + ":" + event.logIndex}>
                  <td>{new Date(event.at).toLocaleString()}</td>
                  <td>{labels[event.type] || event.eventName}</td>
                  <td>
                    {event.assets != null
                      ? amount(event.assets) + " USDC"
                      : event.shares != null
                        ? amount(event.shares) + " shares"
                        : "—"}
                  </td>
                  <td>{event.requestId ?? "—"}</td>
                  <td>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={crosschain.explorer + "/tx/" + event.txHash}
                    >
                      {short(event.txHash)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={s.muted}>
        Only events emitted by this cross-chain EpochVault are included.
        Requested amounts, claimed shares and paid USDC are distinct operations.
        No daily earnings or legacy-vault rebalances are synthesized.
      </p>
    </section>
  );
}
