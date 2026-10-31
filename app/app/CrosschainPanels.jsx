"use client";
import { useMemo, useState } from "react";
import { crosschain } from "../../lib/crosschain-config.mjs";
import {
  capitalMap,
  crosschainPersonalTotals,
  rateOnAllCapital,
  realizedRate,
  REQUEST_STEPS,
  requestStage,
  valuationState,
} from "../../lib/crosschain-feed.mjs";
import s from "./crosschain.module.css";

const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
const isUnits = (value) => /^\d+$/.test(String(value ?? ""));
export const usdc = (value, digits = 2) => {
  if (!isUnits(value)) return "—";
  const number = Number(value) / 1e6;
  if (number > 0 && number < 10 ** -digits) return "<" + 10 ** -digits;
  return number.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};
const money = (number) =>
  number == null
    ? "—"
    : number.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const percent = (number) => (number == null ? "—" : number.toFixed(2) + "%");
const sharePrice = (rate) =>
  isUnits(rate) ? (Number(rate) / 1e18).toFixed(6) : "—";
function ago(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 90) return "just now";
  if (seconds < 5400) return Math.round(seconds / 60) + " min ago";
  if (seconds < 129600) return Math.round(seconds / 3600) + " hours ago";
  return Math.round(seconds / 86400) + " days ago";
}
function clock(ms) {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
const dayLabel = (ms) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Problems in plain words. Only what the person can act on or needs to know.
export function CrosschainStatus({ feed, loading }) {
  if (!feed)
    return (
      <p className={loading ? s.muted : s.notice} role="status">
        {loading
          ? "Reading the vault from Base…"
          : "The vault's data could not load. Your funds are not affected. Try Refresh."}
      </p>
    );
  const valuation = valuationState(feed.vault);
  const names = {
    vault: "The vault's state",
    allocation: "Where the money sits",
    account: "Your wallet balances",
    activity: "Your history",
  };
  const failed = Object.entries(feed.sourceErrors).filter(([, e]) => e);
  return (
    <>
      {failed.map(([source, error]) => (
        <p className={s.notice} role="alert" key={source} title={error}>
          {names[source]} could not load. Other figures on this page are
          current. Try Refresh.
        </p>
      ))}
      {feed.backendError && (
        <p className={s.notice} role="status" title={feed.backendError}>
          New requests are paused while the data service catches up. Your
          balance and existing requests are not affected.
        </p>
      )}
      {valuation.level === "stale" && (
        <p className={s.notice} role="status">
          The vault was last valued {ago(valuation.ageSeconds)}. New requests
          wait until the next valuation.
        </p>
      )}
      {valuation.level === "frozen" && (
        <p className={s.notice} role="alert">
          Settlement is paused while the vault's valuation is frozen. New
          requests and settlements wait until it resumes.
        </p>
      )}
      {valuation.level === "review" && (
        <p className={s.notice} role="alert">
          A valuation is under review. New requests and settlements wait until
          it is resolved.
        </p>
      )}
    </>
  );
}

export function EarlyNotice({ vault }) {
  if (crosschain.profile !== "stand") return null;
  return (
    <p className={s.early}>
      Early deployment.{" "}
      {vault?.limits?.maxEpochDeposits
        ? `Deposits are limited to ${usdc(vault.limits.maxEpochDeposits, 0)} USDC per batch.`
        : "Limits apply."}
    </p>
  );
}

// The single yield figure for all capital.
function YieldFigure({ map }) {
  return (
    <div className={s.figure}>
      <span>Yield on all capital, now</span>
      <strong>{percent(rateOnAllCapital(map))}</strong>
      <details className={s.why}>
        <summary>How this is calculated</summary>
        <p>
          Calculated by Thesauros, not read from a contract: each strategy's
          current rate, weighted by its share of everything the vault holds.
          Cash kept on Base for withdrawals earns nothing, so this figure is
          lower than the rate of any single strategy and should not be compared
          with them directly.
        </p>
      </details>
    </div>
  );
}

function Journey({ stage }) {
  return (
    <ol className={s.journey} data-cancelled={stage.cancelled || undefined}>
      {REQUEST_STEPS.map((label, index) => (
        <li
          key={label}
          data-state={
            index < stage.step
              ? "done"
              : index === stage.step
                ? stage.step === 3
                  ? "done"
                  : "current"
                : "next"
          }
        >
          <span aria-hidden="true" />
          {label}
        </li>
      ))}
    </ol>
  );
}

export function RequestList({
  requests,
  price,
  onClaim,
  onCancel,
  blocked,
  owner,
}) {
  return (
    <div className={s.requests}>
      {requests.map((request) => {
        const stage = requestStage(request);
        const deposit = request.kind === "deposit";
        const estimate =
          !deposit && isUnits(price)
            ? String((BigInt(request.amount) * BigInt(price)) / 10n ** 18n)
            : null;
        return (
          <article className={s.request} key={request.id}>
            <header>
              <h4>
                {deposit ? "Deposit" : "Withdrawal"}{" "}
                {deposit
                  ? usdc(request.amount) + " USDC"
                  : usdc(request.amount, 4) + " shares"}
              </h4>
              <span>
                Batch {request.epoch}
                {estimate && !["claimed", "cancelled"].includes(request.state)
                  ? ` · about ${usdc(estimate)} USDC`
                  : ""}
              </span>
            </header>
            {!stage.cancelled && <Journey stage={stage} />}
            <p className={stage.ready ? s.ready : s.muted}>{stage.note}</p>
            <div className={s.actions}>
              {request.state === "claimable" && (
                <button
                  className={s.primary}
                  disabled={blocked}
                  onClick={() => onClaim(request.id)}
                >
                  Claim
                </button>
              )}
              {request.cancellable &&
                owner &&
                request.owner?.toLowerCase() === owner.toLowerCase() && (
                  <button
                    disabled={blocked}
                    onClick={() => onCancel(request.id)}
                  >
                    Cancel request
                  </button>
                )}
              {/^0x[0-9a-f]{64}$/i.test(request.requestedTx || "") && (
                <a
                  href={crosschain.explorer + "/tx/" + request.requestedTx}
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction ↗
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

const SWATCH = { Base: "#196aff", Arbitrum: "#0f2437", cash: "#a9b8c7" };
export function MoneyMap({ vault, allocation }) {
  const map = capitalMap(vault, allocation);
  if (!map)
    return (
      <section className={s.card}>
        <h3>Where the money is</h3>
        <p className={s.muted}>This could not be read right now.</p>
      </section>
    );
  return (
    <section className={s.card}>
      <header className={s.cardHead}>
        <h3>Where the money is</h3>
        <span className={s.num}>{money(map.held)} USDC held</span>
      </header>
      <div className={s.stack} aria-hidden="true">
        {map.parts.map((part) => (
          <span
            key={part.key}
            style={{
              width: Math.max(part.share, part.amount > 0 ? 0.6 : 0) + "%",
              background: SWATCH[part.key],
            }}
          />
        ))}
      </div>
      <table className={s.map}>
        <tbody>
          {map.parts.map((part) => (
            <tr key={part.key}>
              <th scope="row">
                <i style={{ background: SWATCH[part.key] }} />
                {part.label}
              </th>
              <td>{money(part.amount)} USDC</td>
              <td>{part.share.toFixed(1)}%</td>
              <td>
                {part.key === "cash"
                  ? "kept for withdrawals"
                  : percent(part.rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(map.pendingDeposits > 0 || map.owed > 0) && (
        <p className={s.muted}>
          Of this, {money(map.pendingDeposits)} USDC is waiting to become shares
          and {money(map.owed)} USDC is owed to settled withdrawals.
        </p>
      )}
      <p className={s.muted}>
        Money moving between networks is not shown here yet.
      </p>
    </section>
  );
}

export function Batch({ vault }) {
  if (!vault) return null;
  const { epoch } = vault;
  const now = vault.observedAt;
  const start = (epoch.openedAt ?? epoch.earliestCloseAt) * 1000;
  const earliest = epoch.earliestCloseAt * 1000;
  const latest = epoch.latestCloseAt * 1000;
  const span = Math.max(latest - start, 1);
  const position = Math.min(Math.max((now - start) / span, 0), 1) * 100;
  return (
    <section className={s.card}>
      <header className={s.cardHead}>
        <h3>Current batch</h3>
        <span className={s.num}>Batch {epoch.id}</span>
      </header>
      <p>
        Deposits and withdrawals are collected into a batch and settled
        together, then you claim the result.
      </p>
      <div className={s.window} aria-hidden="true">
        <span
          className={s.windowOpen}
          style={{
            left: ((earliest - start) / span) * 100 + "%",
            right: 0,
          }}
        />
        <i style={{ left: position + "%" }} />
      </div>
      <p className={s.num}>
        {now >= latest
          ? "Closing now"
          : `Closes between ${clock(earliest)} and ${clock(latest)}`}
      </p>
      <p className={s.muted}>
        Deposits {vault.depositPaused ? "paused" : "open"} · Withdrawals{" "}
        {vault.redeemPaused ? "paused" : "open"}. A withdrawal larger than the
        cash on Base waits until funds return from the strategies.
      </p>
    </section>
  );
}

const PERIODS = [
  [7, "7d"],
  [30, "30d"],
  [null, "All"],
];
export function PriceChart({ ticks, now = Date.now() }) {
  const [days, setDays] = useState(30);
  const [hover, setHover] = useState(null);
  const all = useMemo(
    () =>
      [...(ticks || [])]
        .filter((tick) => tick.rateBid != null && tick.at != null)
        .map((tick) => ({ at: tick.at, price: Number(tick.rateBid) / 1e18 }))
        .sort((a, b) => a.at - b.at),
    [ticks],
  );
  const points = days
    ? all.filter((point) => point.at >= now - days * 86400000)
    : all;
  const realized = realizedRate(ticks, days || 36500, now);
  const head = (
    <header className={s.cardHead}>
      <div>
        <h3>Share price</h3>
        <p className={s.muted}>
          {realized
            ? `Holders received ${percent(realized.rate)} a year over the last ${realized.days} days.`
            : "What one share is worth in USDC."}
        </p>
      </div>
      <div className={s.segmented} role="group" aria-label="Period">
        {PERIODS.map(([value, label]) => (
          <button
            key={label}
            aria-pressed={days === value}
            onClick={() => setDays(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
  if (points.length < 2)
    return (
      <section className={s.card}>
        {head}
        <p className={s.muted}>
          {all.length
            ? "Not enough valuations in this period to draw a line."
            : "Price history is still loading."}
        </p>
      </section>
    );
  const W = 720,
    H = 210,
    left = 8,
    right = 8,
    top = 12,
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
  // A long silence between valuations is drawn dashed: the price was not
  // observed then, and a solid flat line would claim that it was.
  const SILENCE = 6 * 3600000;
  let solid = "",
    silent = "";
  points.forEach((point, index) => {
    const px = x(point.at).toFixed(1),
      py = y(point.price).toFixed(1);
    if (!index) {
      solid = `M${px},${py}`;
      return;
    }
    const previous = points[index - 1];
    if (point.at - previous.at > SILENCE) {
      silent += `M${x(previous.at).toFixed(1)},${y(previous.price).toFixed(1)}L${px},${py}`;
      solid += `M${px},${py}`;
    } else solid += `H${px}V${py}`;
  });
  const shown = hover ?? points.at(-1);
  function move(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const at =
      first +
      (((event.clientX - box.left) / box.width) * W - left) /
        ((W - left - right) / Math.max(last - first, 1));
    setHover(
      points.reduce((a, b) =>
        Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a,
      ),
    );
  }
  return (
    <section className={s.card}>
      {head}
      <p className={s.num}>
        <strong>{shown.price.toFixed(6)} USDC</strong>{" "}
        <span className={s.muted}>{clock(shown.at)}</span>
      </p>
      <svg
        className={s.chart}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Share price from ${points[0].price.toFixed(6)} on ${dayLabel(first)} to ${points.at(-1).price.toFixed(6)} USDC on ${dayLabel(last)}`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        <path d={solid} fill="none" stroke="#196aff" strokeWidth="2" />
        {silent && (
          <path
            d={silent}
            fill="none"
            stroke="#196aff"
            strokeOpacity="0.45"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}
        {hover && (
          <>
            <line
              x1={x(hover.at)}
              x2={x(hover.at)}
              y1={top}
              y2={H - bottom}
              stroke="#142b40"
              strokeOpacity="0.25"
            />
            <circle cx={x(hover.at)} cy={y(hover.price)} r="4" fill="#196aff" />
          </>
        )}
        <text x={left} y={H - 6} className={s.axis}>
          {dayLabel(first)}
        </text>
        <text x={W - right} y={H - 6} textAnchor="end" className={s.axis}>
          {dayLabel(last)}
        </text>
      </svg>
      {silent && (
        <p className={s.muted}>
          The dashed line marks a period when no valuation was published.
        </p>
      )}
    </section>
  );
}

export function ContractDetails({ vault, allocation }) {
  const link = (explorer, address, label) => (
    <li key={label}>
      <span>{label}</span>
      <a
        href={explorer + "/address/" + address}
        target="_blank"
        rel="noreferrer"
      >
        {short(address)} ↗
      </a>
    </li>
  );
  return (
    <details className={s.details}>
      <summary>Contracts and data sources</summary>
      <ul>
        {link(crosschain.explorer, crosschain.vault, "Vault on Base")}
        {link(crosschain.explorer, crosschain.accountant, "Valuation contract")}
        {crosschain.networks.flatMap((network) => [
          link(network.explorer, network.strategy, network.name + " strategy"),
          link(network.explorer, network.agent, network.name + " agent"),
        ])}
      </ul>
      {vault && (
        <p className={s.muted}>
          Read from Base block {vault.blockNumber}. Last valuation{" "}
          {ago(vault.tick?.ageSeconds)}.
          {allocation?.chains
            ?.filter((chain) => chain.name !== "Base")
            .map((chain) => ` ${chain.name} block ${chain.blockNumber}.`)}
        </p>
      )}
    </details>
  );
}

// The vault for anyone, signed in or not.
export function VaultOverview({ vault, allocation, ticks, now }) {
  const map = capitalMap(vault, allocation);
  return (
    <>
      <section className={s.hero}>
        <div className={s.figure}>
          <span>Vault value</span>
          <strong>
            {usdc(vault?.tick?.navBid)} <small>USDC</small>
          </strong>
          <p className={s.muted}>
            {vault?.tick
              ? `Valued ${ago(vault.tick.ageSeconds)}.`
              : "Not available right now."}
          </p>
        </div>
        <YieldFigure map={map} />
        <div className={s.figure}>
          <span>Share price</span>
          <strong>
            {sharePrice(vault?.tick?.rateBid)} <small>USDC</small>
          </strong>
          <p className={s.muted}>
            Minimum deposit {usdc(vault?.limits?.minDeposit)} USDC.
          </p>
        </div>
      </section>
      <div className={s.columns}>
        <MoneyMap vault={vault} allocation={allocation} />
        <Batch vault={vault} />
      </div>
      <PriceChart ticks={ticks} now={now} />
      <ContractDetails vault={vault} allocation={allocation} />
    </>
  );
}

function Portfolio({ feed, onStart, onClaim, onCancel, blocked, owner }) {
  const { user, vault, allocation } = feed || {};
  const map = capitalMap(vault, allocation);
  const active = (user?.requests || []).filter(
    (request) => !["claimed", "cancelled"].includes(request.state),
  );
  const holds = isUnits(user?.shares) && BigInt(user.shares) > 0n;
  const totals =
    user?.coverage?.complete && !user.truncated
      ? crosschainPersonalTotals(user)
      : null;
  const onTheWay = totals ? Number(totals.pendingDeposit) : 0;
  return (
    <>
      <section className={s.hero}>
        <div className={s.figure}>
          <span>Your balance</span>
          <strong className={s.balance}>
            {usdc(user?.valueBid)} <small>USDC</small>
          </strong>
          <p className={s.muted}>
            {holds
              ? `${usdc(user.shares, 4)} shares at ${sharePrice(vault?.tick?.rateBid)} USDC each.`
              : "You hold no shares yet."}
            {onTheWay > 0 &&
              ` ${usdc(String(totals.pendingDeposit))} USDC on its way in.`}
          </p>
          <div className={s.actions}>
            <button className={s.primary} onClick={() => onStart("deposit")}>
              Deposit
            </button>
            <button onClick={() => onStart("redeem")} disabled={!holds}>
              Withdraw
            </button>
          </div>
        </div>
        <YieldFigure map={map} />
        <div className={s.figure}>
          <span>In your wallet on Base</span>
          <strong>
            {usdc(user?.cash)} <small>USDC</small>
          </strong>
          <p className={s.muted}>Ready to deposit.</p>
        </div>
      </section>
      {active.length > 0 ? (
        <section className={s.card}>
          <header className={s.cardHead}>
            <h3>In progress</h3>
          </header>
          <RequestList
            requests={active}
            price={vault?.tick?.rateBid}
            onClaim={onClaim}
            onCancel={onCancel}
            blocked={blocked}
            owner={owner}
          />
        </section>
      ) : (
        !holds && (
          <section className={s.card}>
            <h3>How it works</h3>
            <ol className={s.steps}>
              <li>
                <b>Request a deposit on Base.</b> You keep your USDC until you
                sign, and you can cancel while the batch is open.
              </li>
              <li>
                <b>The batch settles.</b> Your USDC is converted to shares at
                the next valuation.
              </li>
              <li>
                <b>Claim and hold.</b> The vault earns on Base and Arbitrum. To
                leave, request a withdrawal the same way.
              </li>
            </ol>
          </section>
        )
      )}
      <MoneyMap vault={vault} allocation={allocation} />
      <PriceChart ticks={feed?.activity?.ticks} now={vault?.observedAt} />
    </>
  );
}

const ACTIVITY = {
  deposit_requested: "Deposit requested",
  redeem_requested: "Withdrawal requested",
  request_cancelled: "Request cancelled",
  deposit_claimed: "Shares claimed",
  redeem_claimed: "Withdrawal claimed",
  instant_exit: "Instant withdrawal",
};
function Coverage({ history }) {
  if (!history) return null;
  const { coverage } = history;
  if (coverage.complete && !coverage.error && !history.truncated)
    return <p className={s.muted}>History is up to date.</p>;
  return (
    <p className={s.muted}>
      {coverage.complete
        ? "History is up to date"
        : "History is still being read from Base, so this list may be incomplete"}
      {history.truncated ? ". Showing the latest 500 events." : "."}
    </p>
  );
}
function Activity({ feed }) {
  const history = feed?.activity;
  const events = history?.events || [];
  return (
    <section className={s.card}>
      {!history ? (
        <p className={s.muted}>Loading your history…</p>
      ) : !events.length ? (
        <p>
          {history.coverage.complete
            ? "Nothing yet. Your deposits, withdrawals and claims will appear here."
            : "Nothing found yet. History is still being read from Base."}
        </p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>What happened</th>
                <th className={s.right}>Amount</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.txHash + ":" + event.logIndex}>
                  <td>{clock(event.at)}</td>
                  <td>{ACTIVITY[event.type] || event.eventName}</td>
                  <td className={s.right}>
                    {event.assets != null
                      ? usdc(event.assets) + " USDC"
                      : event.shares != null
                        ? usdc(event.shares, 4) + " shares"
                        : "—"}
                  </td>
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
      <Coverage history={history} />
    </section>
  );
}

export default function CrosschainPanels({
  view,
  feed,
  onStart,
  onClaim,
  onCancel,
  blocked,
  owner,
}) {
  if (view === "activity") return <Activity feed={feed} />;
  if (view === "vaults")
    return (
      <VaultOverview
        vault={feed?.vault}
        allocation={feed?.allocation}
        ticks={feed?.activity?.ticks}
        now={feed?.vault?.observedAt}
      />
    );
  return (
    <Portfolio
      feed={feed}
      onStart={onStart}
      onClaim={onClaim}
      onCancel={onCancel}
      blocked={blocked}
      owner={owner}
    />
  );
}
