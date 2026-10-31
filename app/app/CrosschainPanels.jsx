"use client";
import { useEffect, useMemo, useState } from "react";
import { crosschain } from "../../lib/crosschain-config.mjs";
import {
  allMarkets,
  capitalMap,
  crosschainEarned,
  rateOnAllCapital,
  realizedRate,
  REQUEST_STEPS,
  requestStage,
  valuationState,
} from "../../lib/crosschain-feed.mjs";
import { Allocation, Tier } from "./cabinet/Portfolio";
import RateChart, { RateLegend } from "./cabinet/RateChart";
import { RailLayout } from "./cabinet/Rail";
import { Amount } from "./cabinet/parts";
import c from "./cabinet/cabinet.module.css";
import s from "./crosschain.module.css";

const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
const isUnits = (value) => /^\d+$/.test(String(value ?? ""));
const toUsdc = (value) => (isUnits(value) ? Number(value) / 1e6 : null);
export const usdc = (value, digits = 2) => {
  if (!isUnits(value)) return "—";
  const number = Number(value) / 1e6;
  if (number > 0 && number < 10 ** -digits) return "<" + 10 ** -digits;
  return number.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};
const money = (number, digits = 2) =>
  number == null
    ? "—"
    : number.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
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

// Colour follows the market, never its rank. Validated for colour-vision
// deficiency; every swatch also sits next to the market's name.
const MARKET_COLOR = {
  "Aave V3": "#196aff",
  "Compound V3": "#0b8f7b",
  "Gauntlet Core": "#7b5bd6",
  "Steakhouse High Yield": "#c77a12",
  "Steakhouse Prime": "#c44b8a",
};
const CASH_COLOR = "#a9b8c7";
const NETWORK_ICON = {
  Base: "/brand/tokens/base.svg",
  Arbitrum: "/brand/tokens/arb.png",
};

// Charts draw at the measured width, so labels stay a readable size everywhere.
function useWidth() {
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

function useResource(path, refreshMs = 0) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/crosschain/" + path, {
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unavailable");
        if (active) setState({ data, error: "", loading: false });
      } catch (error) {
        if (active)
          setState((last) => ({
            ...last,
            error: error.message || "Unavailable",
            loading: false,
          }));
      }
    }
    setState((last) => ({ ...last, loading: true }));
    load();
    const timer = refreshMs
      ? setInterval(() => {
          if (!document.hidden) load();
        }, refreshMs)
      : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [path, refreshMs]);
  return state;
}

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

const YIELD_NOTE =
  "Calculated by Thesauros, not read from a contract: each strategy's current rate, weighted by its share of everything the vault holds. Cash kept on Base for withdrawals earns nothing, so this figure is lower than the rate of any single strategy and should not be compared with them directly.";

function YieldFigure({ map }) {
  return (
    <div className={s.figure}>
      <span>Yield on all capital, now</span>
      <strong>{percent(rateOnAllCapital(map))}</strong>
      <details className={s.why}>
        <summary>How this is calculated</summary>
        <p>{YIELD_NOTE}</p>
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

// The signature of this page: the deposit split across networks and into each
// market, drawn to scale. Bands are proportional to the money they carry.
function MoneyFlow({ map }) {
  const [box, width] = useWidth();
  return (
    <div ref={box}>
      {width >= 600 ? (
        <FlowDiagram map={map} W={width} />
      ) : width > 0 ? (
        <FlowList map={map} />
      ) : null}
    </div>
  );
}

function FlowDiagram({ map, W }) {
  const leftX = 0,
    midX = Math.round(W * 0.34),
    rightX = Math.round(W * 0.68),
    bar = 8,
    slot = 44,
    groupGap = 18;
  const networks = map.networks.filter((net) => net.amount > 0);
  const scale = 200 / Math.max(map.held, 1e-9);
  const height = (amount) => Math.max(amount * scale, 3);
  let y = 0;
  const groups = networks.map((net) => {
    const used = net.markets.filter((row) => row.amount > 0);
    const netH = height(net.amount);
    const rows = used.map((row) => ({ ...row, h: height(row.amount) }));
    const groupH = Math.max(netH, slot, rows.length * slot);
    const top = y;
    y += groupH + groupGap;
    let slice = top + (groupH - netH) / 2;
    const netY = slice;
    const placed = rows.map((row, index) => {
      const rowY =
        top +
        (groupH - rows.length * slot) / 2 +
        index * slot +
        (slot - row.h) / 2;
      const sliceH = (row.amount / Math.max(net.amount, 1e-9)) * netH;
      const item = { ...row, y: rowY, sliceY: slice, sliceH };
      slice += sliceH;
      return item;
    });
    return { ...net, netY, netH, rows: placed };
  });
  const cashH = map.cash > 0 ? height(map.cash) : 0;
  const cashSlot = map.cash > 0 ? Math.max(cashH, slot) : 0;
  const cashY = y + (cashSlot - cashH) / 2;
  const total = y + cashSlot;
  const leftH =
    networks.reduce((sum, net) => sum + height(net.amount), 0) + cashH;
  const leftY = (total - leftH) / 2;
  const ribbon = (x1, y1, h1, x2, y2, h2) => {
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1}C${mid},${y1} ${mid},${y2} ${x2},${y2}L${x2},${y2 + h2}C${mid},${y2 + h2} ${mid},${y1 + h1} ${x1},${y1 + h1}Z`;
  };
  let leftCursor = leftY;
  const top = Math.min(leftY - 42, -6);
  const drawn = total - top + 8;
  return (
    <svg
      className={s.flow}
      width={W}
      height={drawn}
      viewBox={`0 ${top} ${W} ${drawn}`}
      role="img"
      aria-label={`The vault holds ${money(map.held)} USDC across ${networks.map((net) => net.name).join(" and ")}, with ${money(map.cash)} USDC in cash on Base. The table below lists every market.`}
    >
      <text x={leftX} y={leftY - 22} className={s.flowName}>
        The vault, on Base
      </text>
      <text x={leftX} y={leftY - 6} className={s.flowValue}>
        {money(map.held)} USDC
      </text>
      <rect
        x={leftX}
        y={leftY}
        width={bar}
        height={leftH}
        rx="2"
        fill="#142b40"
      />
      {groups.map((net) => {
        const fromY = leftCursor;
        leftCursor += net.netH;
        return (
          <g key={net.key}>
            <path
              className={s.band}
              d={ribbon(leftX + bar, fromY, net.netH, midX, net.netY, net.netH)}
              fill="#142b40"
              fillOpacity="0.1"
            >
              <title>{`${net.name}: ${money(net.amount)} USDC, ${net.share.toFixed(1)}% of the vault`}</title>
            </path>
            <rect
              x={midX}
              y={net.netY}
              width={bar}
              height={net.netH}
              rx="2"
              fill="#142b40"
            />
            <text
              x={midX + 16}
              y={net.netY + net.netH / 2 - 3}
              className={s.flowName}
            >
              {net.name}
            </text>
            <text
              x={midX + 16}
              y={net.netY + net.netH / 2 + 13}
              className={s.flowValue}
            >
              {money(net.amount)} USDC · {percent(net.rate)}
            </text>
            {net.rows.map((row) => (
              <g key={row.key}>
                <path
                  className={s.band}
                  d={ribbon(
                    midX + bar,
                    row.sliceY,
                    row.sliceH,
                    rightX,
                    row.y,
                    row.h,
                  )}
                  fill={MARKET_COLOR[row.name] || "#142b40"}
                  fillOpacity="0.22"
                >
                  <title>{`${row.name} on ${row.network}: ${money(row.amount)} USDC at ${percent(row.rate)}`}</title>
                </path>
                <rect
                  x={rightX}
                  y={row.y}
                  width={bar}
                  height={row.h}
                  rx="2"
                  fill={MARKET_COLOR[row.name] || "#142b40"}
                />
                <text
                  x={rightX + 16}
                  y={row.y + row.h / 2 - 3}
                  className={s.flowName}
                >
                  {row.name}
                </text>
                <text
                  x={rightX + 16}
                  y={row.y + row.h / 2 + 13}
                  className={s.flowValue}
                >
                  {money(row.amount)} USDC · {percent(row.rate)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {map.cash > 0 && (
        <g>
          <path
            className={s.band}
            d={ribbon(leftX + bar, leftCursor, cashH, midX, cashY, cashH)}
            fill={CASH_COLOR}
            fillOpacity="0.32"
          >
            <title>{`Cash on Base: ${money(map.cash)} USDC, ${map.cashShare.toFixed(1)}% of the vault`}</title>
          </path>
          <rect
            x={midX}
            y={cashY}
            width={bar}
            height={cashH}
            rx="2"
            fill={CASH_COLOR}
          />
          <text x={midX + 16} y={cashY + cashH / 2 - 3} className={s.flowName}>
            Cash on Base
          </text>
          <text
            x={midX + 16}
            y={cashY + cashH / 2 + 13}
            className={s.flowValue}
          >
            {money(map.cash)} USDC · kept ready for withdrawals
          </text>
        </g>
      )}
    </svg>
  );
}

function FlowList({ map }) {
  return (
    <ul className={s.flowList}>
      {map.networks
        .filter((net) => net.amount > 0)
        .map((net) => (
          <li key={net.key}>
            <b>{net.name}</b> {money(net.amount)} USDC · {percent(net.rate)}
            <ul>
              {net.markets
                .filter((row) => row.amount > 0)
                .map((row) => (
                  <li key={row.key}>
                    <i
                      style={{
                        background: MARKET_COLOR[row.name] || "#142b40",
                      }}
                    />
                    {row.name} {money(row.amount)} USDC · {percent(row.rate)}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      {map.cash > 0 && (
        <li>
          <b>Cash on Base</b> {money(map.cash)} USDC, kept ready for withdrawals
        </li>
      )}
    </ul>
  );
}

function MarketsTable({ map }) {
  const [all, setAll] = useState(false);
  const rows = allMarkets(map);
  const used = rows.filter((row) => row.amount > 0);
  const shown = all ? rows : used;
  return (
    <>
      <div className={s.tableHead}>
        <h4>By market</h4>
        <div className={s.segmented} role="group" aria-label="Markets shown">
          <button aria-pressed={!all} onClick={() => setAll(false)}>
            In use ({used.length})
          </button>
          <button aria-pressed={all} onClick={() => setAll(true)}>
            All approved ({rows.length})
          </button>
        </div>
      </div>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.stacked}`}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Network</th>
              <th>Risk tier</th>
              <th className={s.right}>Rate now</th>
              <th className={s.right}>In this vault</th>
              <th className={s.right}>Share</th>
              <th className={s.right}>Limit</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key}>
                <td className={s.cellA}>
                  <i
                    className={s.swatch}
                    style={{ background: MARKET_COLOR[row.name] || "#142b40" }}
                  />
                  {row.logo && (
                    <img
                      src={"/brand/protocols/" + row.logo + ".png"}
                      width="18"
                      height="18"
                      alt=""
                      className={s.logo}
                    />
                  )}
                  <a
                    href={row.explorer + "/address/" + row.address}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {row.name}
                  </a>
                </td>
                <td className={s.cellC}>{row.network}</td>
                <td className={s.onWide}>
                  <Tier tier={row.tier} />
                </td>
                <td className={`${s.right} ${s.cellD}`}>{percent(row.rate)}</td>
                <td className={`${s.right} ${s.cellB}`}>
                  {row.amount ? money(row.amount) + " USDC" : "—"}
                </td>
                <td className={`${s.right} ${s.onWide}`}>
                  {row.amount ? row.share.toFixed(1) + "%" : "—"}
                </td>
                <td className={`${s.right} ${s.onWide}`}>
                  {row.limit == null
                    ? "—"
                    : row.limit === 0
                      ? "None"
                      : row.limit + "%"}
                </td>
              </tr>
            ))}
            {map.networks
              .filter((net) => net.idle > 0)
              .map((net) => (
                <tr key={net.key + ":idle"}>
                  <td className={s.cellA}>
                    <i
                      className={s.swatch}
                      style={{ background: CASH_COLOR }}
                    />
                    Not yet lent
                  </td>
                  <td className={s.cellC}>{net.name}</td>
                  <td className={s.onWide} />
                  <td className={`${s.right} ${s.cellD}`}>0.00%</td>
                  <td className={`${s.right} ${s.cellB}`}>
                    {money(net.idle)} USDC
                  </td>
                  <td className={`${s.right} ${s.onWide}`}>
                    {((net.idle / map.held) * 100).toFixed(1)}%
                  </td>
                  <td className={`${s.right} ${s.onWide}`}>—</td>
                </tr>
              ))}
            {map.cash > 0 && (
              <tr>
                <td className={s.cellA}>
                  <i className={s.swatch} style={{ background: CASH_COLOR }} />
                  Cash for withdrawals
                </td>
                <td className={s.cellC}>Base</td>
                <td className={s.onWide} />
                <td className={`${s.right} ${s.cellD}`}>0.00%</td>
                <td className={`${s.right} ${s.cellB}`}>
                  {money(map.cash)} USDC
                </td>
                <td className={`${s.right} ${s.onWide}`}>
                  {map.cashShare.toFixed(1)}%
                </td>
                <td className={`${s.right} ${s.onWide}`}>—</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan="4" className={s.cellA}>
                Everything the vault holds
              </th>
              <td className={`${s.right} ${s.cellB}`}>
                {money(map.held)} USDC
              </td>
              <td className={`${s.right} ${s.onWide}`}>100%</td>
              <td className={s.onWide} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={s.muted}>
        Limit is the most a market may hold of that network's strategy. Core
        markets are the largest, longest-running lenders; satellite markets are
        curated vaults with higher rates.
      </p>
    </>
  );
}

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
        <div>
          <h3>Where the money is</h3>
          <p className={s.muted}>
            One deposit on Base, working across networks and lending markets.
          </p>
        </div>
      </header>
      <MoneyFlow map={map} />
      <MarketsTable map={map} />
      {vault?.tick?.navBid &&
        Math.abs(map.held - toUsdc(vault.tick.navBid)) >= 0.01 && (
          <p className={s.muted}>
            These are live balances. The last valuation was{" "}
            {usdc(vault.tick.navBid)} USDC; the difference is interest and any
            money in transit since then.
          </p>
        )}
      {(map.pendingDeposits > 0 || map.owed > 0) && (
        <p className={s.muted}>
          Of this, {money(map.pendingDeposits)} USDC is waiting to become shares
          and {money(map.owed)} USDC is owed to settled withdrawals.
        </p>
      )}
    </section>
  );
}

const PERIODS = [
  [7, "7d"],
  [30, "30d"],
  [null, "All"],
];
export function PriceChart({ ticks, now = Date.now(), compact = false }) {
  const [days, setDays] = useState(30);
  const [hover, setHover] = useState(null);
  const [box, width] = useWidth();
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
  const head = !compact && (
    <header className={s.cardHead}>
      <div>
        <h3>Share price</h3>
        <p className={s.muted}>
          What one share is worth in USDC. It rises as the markets pay interest,
          so holders earn without receiving anything.
          {realized &&
            ` Over the last ${realized.days} days holders received ${percent(realized.rate)} a year.`}
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
  const Wrap = compact ? "div" : "section";
  if (points.length < 2)
    return (
      <Wrap className={compact ? undefined : s.card}>
        {head}
        <p className={s.muted}>
          {all.length
            ? "Not enough valuations in this period to draw a line."
            : "Price history is not available yet."}
        </p>
      </Wrap>
    );
  const W = width || 720,
    H = compact ? 92 : 220,
    left = 2,
    right = compact ? 2 : 62,
    top = 10,
    bottom = 22;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const range = Math.max(max - min, max * 0.00002);
  const first = points[0].at,
    last = points.at(-1).at;
  const x = (at) =>
    left + ((at - first) / Math.max(last - first, 1)) * (W - left - right);
  const y = (price) => top + (1 - (price - min) / range) * (H - top - bottom);
  const levels = compact ? [] : [max, min + range / 2, min];
  const places = range < 0.0005 ? 6 : 4;
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
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      first +
      (((event.clientX - rect.left) / rect.width) * W - left) /
        ((W - left - right) / Math.max(last - first, 1));
    setHover(
      points.reduce((a, b) =>
        Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a,
      ),
    );
  }
  return (
    <Wrap className={compact ? undefined : s.card}>
      {head}
      <p className={s.num}>
        <strong>{shown.price.toFixed(6)} USDC</strong>{" "}
        <span className={s.muted}>{clock(shown.at)}</span>
      </p>
      <div ref={box}>
        <svg
          className={s.chart}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Share price from ${points[0].price.toFixed(6)} on ${dayLabel(first)} to ${points.at(-1).price.toFixed(6)} USDC on ${dayLabel(last)}`}
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
                stroke="#142b40"
                strokeOpacity="0.08"
              />
              <text x={W - right + 8} y={y(level) + 4} className={s.axis}>
                {level.toFixed(places)}
              </text>
            </g>
          ))}
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
              <circle
                cx={x(hover.at)}
                cy={y(hover.price)}
                r="4"
                fill="#196aff"
              />
            </>
          )}
          <text x={left} y={H - 6} className={s.axis}>
            {dayLabel(first)}
          </text>
          <text x={W - right} y={H - 6} textAnchor="end" className={s.axis}>
            {dayLabel(last)}
          </text>
        </svg>
      </div>
      {silent && !compact && (
        <p className={s.muted}>
          The dashed line marks a period when no valuation was published.
        </p>
      )}
    </Wrap>
  );
}

const RATE_PERIODS = [
  ["7d", "7d"],
  ["30d", "30d"],
  ["180d", "6m"],
];
function RatesCard() {
  const [period, setPeriod] = useState("30d");
  const [network, setNetwork] = useState("Base");
  const { data, error, loading } = useResource("rates?period=" + period);
  const row = data?.networks?.find((net) => net.name === network);
  return (
    <section className={s.card}>
      <header className={s.cardHead}>
        <div>
          <h3>Rate against the market</h3>
          <p className={s.muted}>
            What the strategy on one network paid, against the plain average of
            its approved markets. Strategy rates are not the vault's yield,
            which also counts cash.
          </p>
        </div>
        <div className={s.controls}>
          <div className={s.segmented} role="group" aria-label="Network">
            {crosschain.networks.map((net) => (
              <button
                key={net.name}
                aria-pressed={network === net.name}
                onClick={() => setNetwork(net.name)}
              >
                {net.name}
              </button>
            ))}
          </div>
          <div className={s.segmented} role="group" aria-label="Period">
            {RATE_PERIODS.map(([value, label]) => (
              <button
                key={value}
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      {row ? (
        <div
          className={`${c.page} ${s.rateChart} ${loading ? s.switching : ""}`}
        >
          <RateChart
            series={{ vault: row.vault, market: row.market }}
            label={`${network} strategy rate against the average of its approved markets`}
          />
          <RateLegend vault={`${network} strategy`} />
          {row.vault.length > 0 && (
            <p className={s.muted}>
              History for this vault starts on {dayLabel(row.vault[0].t)}.
            </p>
          )}
        </div>
      ) : (
        <p className={s.muted}>
          {error
            ? "Rate history is not available right now."
            : "Loading rate history…"}
        </p>
      )}
    </section>
  );
}

export function ExitAndTerms({ vault, allocation }) {
  if (!vault) return null;
  const { epoch } = vault;
  const now = vault.observedAt;
  const start = (epoch.openedAt ?? epoch.earliestCloseAt) * 1000;
  const earliest = epoch.earliestCloseAt * 1000;
  const latest = epoch.latestCloseAt * 1000;
  const span = Math.max(latest - start, 1);
  const position = Math.min(Math.max((now - start) / span, 0), 1) * 100;
  // The fee holders pay is set on the vault's valuation contract, read here.
  const fee = (value) =>
    value == null ? "—" : (Number(value) / 1e16).toFixed(2) + "%";
  const strategyFee = Math.max(
    0,
    ...(allocation?.chains || []).map(
      (chain) => Number(chain.performanceFee || 0) / 1e16,
    ),
  );
  return (
    <div className={s.columns}>
      <section className={s.card}>
        <header className={s.cardHead}>
          <h3>How deposits and withdrawals settle</h3>
          <span className={s.num}>Batch {epoch.id}</span>
        </header>
        <p>
          Requests are collected into a batch and settled together at the next
          valuation. Then you claim the result.
        </p>
        <div className={s.window} aria-hidden="true">
          <span
            className={s.windowOpen}
            style={{ left: ((earliest - start) / span) * 100 + "%", right: 0 }}
          />
          <i style={{ left: position + "%" }} />
        </div>
        <p className={s.num}>
          {now >= latest
            ? "Closing now"
            : `Closes between ${clock(earliest)} and ${clock(latest)}`}
        </p>
        <p className={s.muted}>
          Cash ready for withdrawals: {usdc(vault.accounting.cash)} USDC. A
          withdrawal larger than this waits until funds return from the
          strategies. Deposits {vault.depositPaused ? "paused" : "open"},
          withdrawals {vault.redeemPaused ? "paused" : "open"}.
        </p>
      </section>
      <section className={s.card}>
        <h3>Terms</h3>
        <dl className={s.terms}>
          <div>
            <dt>Performance fee now</dt>
            <dd>{fee(vault.fees?.performanceFee)}</dd>
            <small>
              Read from the contracts. The planned fee is 25% of yield; it is
              not switched on in this vault yet.
              {strategyFee > 0 &&
                ` Strategies also charge ${strategyFee.toFixed(2)}% of yield.`}
            </small>
          </div>
          <div>
            <dt>Management fee</dt>
            <dd>{fee(vault.fees?.managementFee)}</dd>
          </div>
          <div>
            <dt>Minimum deposit</dt>
            <dd>{usdc(vault.limits?.minDeposit)} USDC</dd>
          </div>
          <div>
            <dt>Asset</dt>
            <dd>USDC, deposited on Base</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function Moves() {
  const { data, error, loading } = useResource("moves");
  const moves = data?.moves || [];
  return (
    <section className={s.card}>
      <h3>Money moved between networks</h3>
      {loading && !data ? (
        <p className={s.muted}>Loading…</p>
      ) : !data ? (
        <p className={s.muted} title={error}>
          This history is not available right now.
        </p>
      ) : !moves.length ? (
        <p className={s.muted}>No money has moved between networks yet.</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.stacked}`}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Sent</th>
                <th>Arrived</th>
                <th className={s.right}>Amount</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((move) => (
                <tr key={move.id}>
                  <td className={s.cellA}>
                    {move.from} to {move.to}
                  </td>
                  <td className={s.cellC}>
                    {move.sentAt ? clock(move.sentAt) : "—"}
                  </td>
                  <td className={s.cellD}>
                    {move.receivedAt ? clock(move.receivedAt) : "In transit"}
                  </td>
                  <td className={`${s.right} ${s.cellB}`}>
                    {usdc(move.amount)} USDC
                  </td>
                  <td className={s.onWide}>
                    {move.tx ? (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={move.explorer + "/tx/" + move.tx}
                      >
                        {short(move.tx)} ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

export function HowItWorks({ rate }) {
  const [amount, setAmount] = useState("10000");
  const plan = Number(String(amount).replace(/[^\d.]/g, "")) || 0;
  return (
    <section className={s.card}>
      <h3>How it works</h3>
      <ol className={s.steps}>
        <li>
          <b>Request a deposit on Base.</b> You can cancel while the batch is
          open.
        </li>
        <li>
          <b>The batch settles.</b> Your USDC becomes shares at the next
          valuation, and you claim them.
        </li>
        <li>
          <b>Your shares earn.</b> The vault lends across Base and Arbitrum, and
          the share price rises. To leave, request a withdrawal the same way.
        </li>
      </ol>
      <div className={s.plan2}>
        <label className={s.field}>
          If you deposit
          <span className={s.amount}>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="Amount in USDC"
            />
            USDC
          </span>
        </label>
        <p className={s.muted}>
          {rate == null
            ? "Yield is not available right now."
            : `About ${money((plan * rate) / 100 / 12)} USDC a month at today's ${percent(rate)}. Rates are variable; past rates do not promise future ones.`}
        </p>
      </div>
    </section>
  );
}

// The vault for anyone, signed in or not.
export function VaultOverview({ vault, allocation, ticks, now, explain }) {
  const map = capitalMap(vault, allocation);
  const prices = useResource(ticks ? null : "prices");
  const allTicks = ticks || prices.data?.ticks;
  const realized = realizedRate(allTicks, 30, now);
  return (
    <>
      <section className={`${s.hero} ${s.heroFour}`}>
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
          <span>Received by holders, 30 days</span>
          <strong>{realized ? percent(realized.rate) : "—"}</strong>
          <p className={s.muted}>From the share price, a year's rate.</p>
        </div>
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
      {explain && <HowItWorks rate={rateOnAllCapital(map)} />}
      <MoneyMap vault={vault} allocation={allocation} />
      <PriceChart ticks={allTicks} now={now} />
      <RatesCard />
      <ExitAndTerms vault={vault} allocation={allocation} />
      <Moves />
      <ContractDetails vault={vault} allocation={allocation} />
    </>
  );
}

function PositionRail({ feed, onStart, holds, earned, active }) {
  const { user, vault, allocation } = feed || {};
  const map = capitalMap(vault, allocation);
  const rate = rateOnAllCapital(map);
  const inVault = toUsdc(user?.valueBid);
  const cash = toUsdc(user?.cash);
  const share =
    (inVault || 0) + (cash || 0) > 0
      ? ((inVault || 0) / ((inVault || 0) + (cash || 0))) * 100
      : 0;
  return (
    <>
      <div className={c.railActions}>
        <button className={c.pill} onClick={() => onStart("deposit")}>
          Deposit <span aria-hidden="true">+</span>
        </button>
        <button
          className={c.pill}
          disabled={!holds}
          onClick={() => onStart("redeem")}
        >
          Withdraw <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className={c.railCard}>
        <div className={c.railSplit}>
          <div>
            <span>In wallet</span>
            <strong>
              <Amount value={cash} />
            </strong>
          </div>
          <div className={c.alignEnd}>
            <span>In the vault</span>
            <strong className={c.positive}>
              <Amount value={inVault} />
            </strong>
          </div>
        </div>
        <div className={c.railBar} aria-hidden="true">
          <span style={{ width: share + "%" }} />
        </div>
      </div>
      <div className={c.railTiles}>
        <div>
          <span>Yield now</span>
          <strong>{percent(rate)}</strong>
          <small>on all capital, variable</small>
        </div>
        <div>
          <span>Per month</span>
          <strong>
            {inVault && rate != null ? money((inVault * rate) / 100 / 12) : "—"}
          </strong>
          <small>USDC at this rate</small>
        </div>
        <div>
          <span>Earned</span>
          <strong className={earned > 0 ? c.positive : undefined}>
            {earned == null ? "—" : money(earned, Math.abs(earned) < 1 ? 4 : 2)}
          </strong>
          <small>{earned == null ? "history loading" : "USDC, all time"}</small>
        </div>
        <div>
          <span>In progress</span>
          <strong>{active.length}</strong>
          <small>{active.length === 1 ? "request" : "requests"}</small>
        </div>
      </div>
    </>
  );
}

function MoneyMapCompact({ map, onOpen }) {
  if (!map) return null;
  return (
    <section className={s.card}>
      <header className={s.cardHead}>
        <h3>Where the vault's money is</h3>
        <button className={s.link} onClick={onOpen}>
          See every market
        </button>
      </header>
      <MoneyFlow map={map} />
    </section>
  );
}

function Portfolio({
  feed,
  onStart,
  onClaim,
  onCancel,
  blocked,
  owner,
  navigate,
  otherVaults,
}) {
  const { user, vault, allocation, activity } = feed || {};
  const map = capitalMap(vault, allocation);
  const active = (user?.requests || []).filter(
    (request) => !["claimed", "cancelled"].includes(request.state),
  );
  const holds = isUnits(user?.shares) && BigInt(user.shares) > 0n;
  const earned = crosschainEarned(user, activity);
  const value = toUsdc(user?.valueBid);
  const icon = (network) => ({
    id: network.toLowerCase(),
    network,
    icon: NETWORK_ICON[network],
  });
  const yours = map
    ? [
        ...allMarkets(map)
          .filter((row) => row.amount > 0)
          .map((row) => ({
            name: row.name,
            logo: row.logo,
            riskTier: row.tier,
            apy: row.rate,
            share: row.share,
            color: MARKET_COLOR[row.name],
            vault: icon(row.network),
          })),
        ...(map.cash > 0
          ? [
              {
                name: "Cash for withdrawals",
                apy: 0,
                share: map.cashShare,
                color: CASH_COLOR,
                vault: icon("Base"),
              },
            ]
          : []),
      ]
    : [];
  return (
    <RailLayout
      rail={
        <PositionRail
          feed={feed}
          onStart={onStart}
          holds={holds}
          earned={earned}
          active={active}
        />
      }
    >
      <section className={`${s.card} ${s.statement}`} aria-label="Your balance">
        <div className={s.figure}>
          <span>Your balance</span>
          <strong className={s.balance}>
            {usdc(user?.valueBid)} <small>USDC</small>
          </strong>
          <p className={s.muted}>
            {!user
              ? feed?.sourceErrors?.account
                ? "Your balance could not be read right now."
                : "Reading your balance…"
              : holds
                ? `${usdc(user.shares, 4)} shares at ${sharePrice(vault?.tick?.rateBid)} USDC each.`
                : "You hold no shares yet."}
          </p>
        </div>
        {holds && (
          <div className={s.growth}>
            <span className={s.muted}>Share price, last 30 days</span>
            <PriceChart
              ticks={activity?.ticks}
              now={vault?.observedAt}
              compact
            />
          </div>
        )}
      </section>
      {otherVaults >= 0.01 && (
        <button className={s.otherVaults} onClick={() => navigate("single")}>
          You also hold {money(otherVaults)} in single-network vaults.
          <span>View</span>
        </button>
      )}
      {active.length > 0 && (
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
      )}
      {holds ? (
        <section className={s.card}>
          <header className={s.cardHead}>
            <div>
              <h3>Where your money works</h3>
              <p className={s.muted}>
                Your {usdc(user.valueBid)} USDC by lending market, at the
                vault's current allocation.
              </p>
            </div>
            <button className={s.link} onClick={() => navigate("vaults")}>
              Vault details
            </button>
          </header>
          <Allocation providers={yours} total={value} token="USDC" />
        </section>
      ) : (
        user && <HowItWorks rate={rateOnAllCapital(map)} />
      )}
      {!holds && (
        <MoneyMapCompact map={map} onOpen={() => navigate("vaults")} />
      )}
      {activity?.events?.length > 0 && (
        <section className={s.card}>
          <header className={s.cardHead}>
            <h3>Recent activity</h3>
            <button className={s.link} onClick={() => navigate("activity")}>
              All activity
            </button>
          </header>
          <ActivityTable events={activity.events.slice(0, 4)} />
        </section>
      )}
    </RailLayout>
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
const ACTIVITY_FILTERS = [
  ["all", "All", () => true],
  [
    "requests",
    "Requests",
    (event) =>
      ["deposit_requested", "redeem_requested", "request_cancelled"].includes(
        event.type,
      ),
  ],
  [
    "claims",
    "Claims",
    (event) =>
      ["deposit_claimed", "redeem_claimed", "instant_exit"].includes(
        event.type,
      ),
  ],
];
function activityCsv(events) {
  const lines = [
    "date,what,assets_usdc,shares,transaction",
    ...events.map((event) =>
      [
        new Date(event.at).toISOString(),
        ACTIVITY[event.type] || event.eventName,
        event.assets != null ? Number(event.assets) / 1e6 : "",
        event.shares != null ? Number(event.shares) / 1e6 : "",
        event.txHash,
      ].join(","),
    ),
  ];
  return "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
}
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
function ActivityTable({ events }) {
  return (
    <div className={s.tableWrap}>
      <table className={`${s.table} ${s.stacked}`}>
        <thead>
          <tr>
            <th>What happened</th>
            <th>Date</th>
            <th className={s.right}>Amount</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.txHash + ":" + event.logIndex}>
              <td className={s.cellA}>
                {ACTIVITY[event.type] || event.eventName}
              </td>
              <td className={s.cellC}>{clock(event.at)}</td>
              <td className={`${s.right} ${s.cellB}`}>
                {event.assets != null
                  ? usdc(event.assets) + " USDC"
                  : event.shares != null
                    ? usdc(event.shares, 4) + " shares"
                    : "—"}
              </td>
              <td className={s.cellD}>
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
  );
}
function Activity({ feed }) {
  const [filter, setFilter] = useState("all");
  const history = feed?.activity;
  const events = history?.events || [];
  const shown = events.filter(
    ACTIVITY_FILTERS.find(([id]) => id === filter)[2],
  );
  return (
    <section className={s.card}>
      <header className={s.cardHead}>
        <div className={s.segmented} role="group" aria-label="Show">
          {ACTIVITY_FILTERS.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {events.length > 0 && (
          <a
            className={s.link}
            href={activityCsv(events)}
            download="thesauros-activity.csv"
          >
            Export CSV
          </a>
        )}
      </header>
      {!history ? (
        <p className={s.muted}>Loading your history…</p>
      ) : !shown.length ? (
        <p>
          {history.coverage.complete
            ? "Nothing here yet. Your deposits, withdrawals and claims will appear here."
            : "Nothing found yet. History is still being read from Base."}
        </p>
      ) : (
        <ActivityTable events={shown} />
      )}
      <Coverage history={history} />
    </section>
  );
}

export default function CrosschainPanels({
  view,
  feed,
  navigate,
  onStart,
  onClaim,
  onCancel,
  blocked,
  owner,
  otherVaults,
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
      navigate={navigate}
      onStart={onStart}
      onClaim={onClaim}
      onCancel={onCancel}
      blocked={blocked}
      owner={owner}
      otherVaults={otherVaults}
    />
  );
}
