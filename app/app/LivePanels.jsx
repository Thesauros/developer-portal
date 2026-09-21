"use client";
import { useEffect, useId, useMemo, useState } from "react";
import s from "./workspace.module.css";
import BrandLoading from "../ui/BrandLoading";
export const fmt = (n, d = 2) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-US", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
export const pct = (n) => (n === null || n === undefined ? "—" : fmt(n) + "%");
export const compact = (n) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(n);
export const stamp = (v) =>
  v
    ? new Date(v).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "Not received";
export const short = (v) => (v ? v.slice(0, 6) + "…" + v.slice(-4) : "—");
export function Mark({ name, token, chain }) {
  const file = name
    ? "protocols/" + name + ".png"
    : token
      ? "tokens/" + (token === "USDT0" ? "usdt" : token.toLowerCase()) + ".svg"
      : {
          Base: "tokens/base.svg",
          Arbitrum: "tokens/arb.png",
          Monad: "tokens/monad.png",
          Ethereum: "tokens/eth.svg",
        }[chain];
  return file ? (
    <img
      className={s.mark}
      src={"/brand/" + file}
      alt=""
      width="27"
      height="27"
    />
  ) : (
    <span className={s.markFallback}>
      {(chain || token || "T").slice(0, 1)}
    </span>
  );
}
export function useLive(kind) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function run() {
      try {
        const r = await fetch("/app/live?kind=" + kind, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (r.status === 401) {
          location.assign("/app/");
          return;
        }
        if (!r.ok) throw new Error();
        const value = await r.json();
        if (active) {
          setData(value);
          setError(value.error || "");
        }
      } catch (e) {
        if (e.name !== "AbortError" && active)
          setError("Data could not refresh. Please retry.");
      } finally {
        if (active) setLoading(false);
      }
    }
    run();
    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, 60000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [kind, revision]);
  return {
    data,
    loading,
    error,
    refresh: () => {
      setLoading(true);
      setRevision((v) => v + 1);
    },
  };
}
export function Source({ href, time, stale, label = "Source" }) {
  return (
    <div className={s.source}>
      <span className={stale ? s.warningText : ""}>
        {stale ? "Last received · " : "Updated · "}
        {stamp(time)}
      </span>
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    </div>
  );
}
export function Empty({ children }) {
  return <div className={s.empty}>{children}</div>;
}
export function Chart({ points, metric = "apy", label = "Market APY" }) {
  const id = useId().replaceAll(":", ""),
    [selected, setSelected] = useState(null);
  const valid = useMemo(
    () =>
      points.filter(
        (p) =>
          p[metric] !== null &&
          p[metric] !== undefined &&
          Number.isFinite(p[metric]) &&
          Number.isFinite(Date.parse(p.timestamp)),
      ),
    [points, metric],
  );
  if (valid.length < 2)
    return (
      <Empty>
        Historical observations are not available for this selection yet.
      </Empty>
    );
  const minT = Date.parse(valid[0].timestamp),
    maxT = Date.parse(valid.at(-1).timestamp),
    values = valid.map((p) => p[metric]);
  let min = Math.min(...values),
    max = Math.max(...values);
  const pad = Math.max((max - min) * 0.18, max * 0.01, 0.001);
  min = Math.max(0, min - pad);
  max += pad;
  const x = (p) =>
      54 + ((Date.parse(p.timestamp) - minT) / (maxT - minT || 1)) * 690,
    y = (p) => 196 - ((p[metric] - min) / (max - min)) * 174;
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p[metric] === null || p[metric] === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(p);
  }
  if (current.length) segments.push(current);
  const idx = Math.max(
      0,
      Math.min(selected ?? valid.length - 1, valid.length - 1),
    ),
    point = valid[idx],
    value = (n) => (metric === "tvlUsd" ? "$" + compact(n) : pct(n));
  function choose(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const t =
      minT +
      Math.max(
        0,
        Math.min(
          1,
          (((event.clientX - rect.left) / rect.width) * 770 - 54) / 690,
        ),
      ) *
        (maxT - minT);
    let best = 0;
    valid.forEach((p, i) => {
      if (
        Math.abs(Date.parse(p.timestamp) - t) <
        Math.abs(Date.parse(valid[best].timestamp) - t)
      )
        best = i;
    });
    setSelected(best);
  }
  return (
    <div className={s.chart}>
      <div className={s.chartReadout}>
        <span>{label}</span>
        <strong>{value(point[metric])}</strong>
        <small>{stamp(point.timestamp)}</small>
      </div>
      <svg
        viewBox="0 0 770 228"
        role="img"
        aria-label={
          label +
          " history from " +
          stamp(valid[0].timestamp) +
          " to " +
          stamp(valid.at(-1).timestamp)
        }
        onPointerMove={choose}
        onClick={choose}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#567d9a" stopOpacity=".18" />
            <stop offset="100%" stopColor="#567d9a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1="54"
              x2="746"
              y1={196 - t * 174}
              y2={196 - t * 174}
              stroke="#e6edf2"
              strokeDasharray="3 5"
            />
            <text x="0" y={200 - t * 174} fill="#8294a3" fontSize="10">
              {value(min + t * (max - min))}
            </text>
          </g>
        ))}
        {segments.map((segment, i) => (
          <g key={i}>
            <path
              d={
                "M" +
                segment.map((p) => x(p) + "," + y(p)).join(" L") +
                " L" +
                x(segment.at(-1)) +
                ",196 L" +
                x(segment[0]) +
                ",196 Z"
              }
              fill={"url(#" + id + ")"}
            />
            <path
              d={"M" + segment.map((p) => x(p) + "," + y(p)).join(" L")}
              fill="none"
              stroke="#315b7b"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          </g>
        ))}
        <line
          x1={x(point)}
          x2={x(point)}
          y1="20"
          y2="196"
          stroke="#91a9bd"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(point)}
          cy={y(point)}
          r="4.5"
          fill="#254d70"
          stroke="white"
          strokeWidth="2"
        />
        <text x="54" y="221" fontSize="10" fill="#8194a3">
          {new Date(minT).toLocaleDateString("en-GB", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}
        </text>
        <text x="744" y="221" textAnchor="end" fontSize="10" fill="#8194a3">
          {new Date(maxT).toLocaleDateString("en-GB", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}
        </text>
      </svg>
      <input
        className={s.chartSlider}
        type="range"
        min="0"
        max={valid.length - 1}
        value={idx}
        onChange={(e) => setSelected(Number(e.target.value))}
        aria-label={"Explore " + label + " observations"}
        aria-valuetext={value(point[metric]) + " on " + stamp(point.timestamp)}
      />
    </div>
  );
}
export function Markets({ feed, brief = false, onExplore }) {
  const [chain, setChain] = useState("All networks"),
    [protocol, setProtocol] = useState("All protocols"),
    [selected, setSelected] = useState(""),
    [history, setHistory] = useState(null),
    [historyError, setHistoryError] = useState(""),
    [days, setDays] = useState(90),
    [metric, setMetric] = useState("apy"),
    [reload, setReload] = useState(0);
  const list = feed.data?.data || [],
    filtered = list.filter(
      (p) =>
        (chain === "All networks" || p.chain === chain) &&
        (protocol === "All protocols" || p.name === protocol),
    );
  const market = filtered.find((p) => p.id === selected) || filtered[0];
  useEffect(() => {
    if (!market) return;
    const controller = new AbortController();
    let active = true;
    setHistory(null);
    setHistoryError("");
    fetch("/app/live?kind=history&pool=" + market.id, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const v = await r.json();
        if (active) {
          setHistory(v);
          setHistoryError(v.error || "");
        }
      })
      .catch((e) => {
        if (active && e.name !== "AbortError")
          setHistoryError("Market history could not load.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [market?.id, reload]);
  const historyPoints = (history?.data || []).filter(
    (p) => Date.parse(p.timestamp) >= Date.now() - days * 86400000,
  );
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <div>
          <span className={s.eyebrow}>Market intelligence</span>
          <h2>
            {brief ? "A view across lending markets." : "Follow the market."}
          </h2>
        </div>
        {brief ? (
          <button className={s.textButton} onClick={onExplore}>
            All markets
          </button>
        ) : (
          <button
            className={s.textButton}
            onClick={feed.refresh}
            disabled={feed.loading}
          >
            {feed.loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
      {feed.error && (
        <p className={s.warning} role="status">
          {feed.error}
        </p>
      )}
      {!list.length ? (
        feed.loading ? (
          <BrandLoading label="Reading the markets" />
        ) : (
          <Empty>Market data is unavailable.</Empty>
        )
      ) : (
        <>
          {!brief && (
            <div className={s.filters}>
              <label>
                Network
                <select
                  aria-label="Market network"
                  value={chain}
                  onChange={(e) => setChain(e.target.value)}
                >
                  {["All networks", ...new Set(list.map((p) => p.chain))].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Protocol
                <select
                  aria-label="Market protocol"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                >
                  {["All protocols", ...new Set(list.map((p) => p.name))].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              <span>{filtered.length} markets</span>
            </div>
          )}
          {market && (
            <>
              <div className={s.chartHead}>
                <div className={s.identity}>
                  <Mark name={market.logo} />
                  <div>
                    <strong>
                      {market.name} · {market.token}
                    </strong>
                    <span>
                      {market.chain}
                      {market.label ? " · " + market.label : ""}
                    </span>
                  </div>
                </div>
                <div className={s.segment}>
                  <button
                    aria-pressed={metric === "apy"}
                    onClick={() => setMetric("apy")}
                  >
                    APY
                  </button>
                  <button
                    aria-pressed={metric === "tvlUsd"}
                    onClick={() => setMetric("tvlUsd")}
                  >
                    Liquidity
                  </button>
                </div>
                <div className={s.segment}>
                  {[30, 90, 365].map((d) => (
                    <button
                      key={d}
                      aria-pressed={days === d}
                      onClick={() => setDays(d)}
                    >
                      {d === 365 ? "1Y" : d + "D"}
                    </button>
                  ))}
                </div>
              </div>
              {historyError && (
                <p className={s.warning}>
                  {historyError}{" "}
                  <button
                    className={s.textButton}
                    onClick={() => setReload((v) => v + 1)}
                  >
                    Retry history
                  </button>
                </p>
              )}
              {history?.data ? (
                <Chart
                  points={historyPoints}
                  metric={metric}
                  label={metric === "apy" ? "Supply APY" : "Market liquidity"}
                />
              ) : (
                !historyError && <Empty>Loading historical observations…</Empty>
              )}
              {!brief && (
                <div className={s.miniStats}>
                  <div>
                    <span>Current APY</span>
                    <strong>{pct(market.apy)}</strong>
                  </div>
                  <div>
                    <span>Base APY</span>
                    <strong>{pct(market.baseApy)}</strong>
                  </div>
                  <div>
                    <span>Rewards APY</span>
                    <strong>{pct(market.rewardApy)}</strong>
                  </div>
                  <div>
                    <span>Market liquidity</span>
                    <strong>${compact(market.tvlUsd)}</strong>
                  </div>
                </div>
              )}
            </>
          )}
          <div
            className={s.tableWrap}
            tabIndex="0"
            role="region"
            aria-label="Lending markets"
          >
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Network</th>
                  <th>Supply APY</th>
                  <th>Market liquidity</th>
                  {!brief && <th>7D change, pp</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, brief ? 4 : 30).map((p) => (
                  <tr key={p.id} data-selected={market?.id === p.id}>
                    <td>
                      <button
                        className={s.marketButton}
                        onClick={() => setSelected(p.id)}
                        aria-pressed={market?.id === p.id}
                      >
                        <Mark name={p.logo} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.token}
                            {p.label ? " · " + p.label : ""}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>{p.chain}</td>
                    <td className={s.rate}>{pct(p.apy)}</td>
                    <td>${compact(p.tvlUsd)}</td>
                    {!brief && <td>{fmt(p.change7d)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <Empty>No markets match these filters.</Empty>}
          </div>
          <Source
            href="https://defillama.com/yields"
            label="DeFiLlama · external markets"
            time={feed.data?.fetchedAt}
            stale={feed.data?.stale}
          />
          {history?.fetchedAt && !brief && (
            <Source
              href={"https://yields.llama.fi/chart/" + market.id}
              label="Historical observations"
              time={history.fetchedAt}
              stale={history.stale}
            />
          )}
        </>
      )}
    </section>
  );
}
export function Events({ networks, limit = 100 }) {
  const [type, setType] = useState("All events");
  const events = networks
    .flatMap((n) =>
      n.events.map((e) => ({ ...e, network: n.name, explorer: n.explorer })),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const shown = events
    .filter((e) => type === "All events" || e.type === type)
    .slice(0, limit);
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <div>
          <span className={s.eyebrow}>Onchain activity</span>
          <h2>Every movement, traceable.</h2>
        </div>
        <label className={s.selectLabel}>
          Event type
          <select
            aria-label="Event type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {["All events", ...new Set(events.map((e) => e.type))].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div
        className={s.tableWrap}
        tabIndex="0"
        role="region"
        aria-label="Protocol transactions"
      >
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Network</th>
              <th>Time (UTC)</th>
              <th>Block</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.network + e.id}>
                <td>
                  <span className={s.eventType}>
                    {e.type.replace(/([a-z])([A-Z])/g, "$1 $2")}
                  </span>
                  <small>
                    {e.token} · {e.success ? "Confirmed" : "Failed"}
                  </small>
                </td>
                <td>{e.network}</td>
                <td>{stamp(e.timestamp).replace(" UTC", "")}</td>
                <td>{fmt(e.blockNumber, 0)}</td>
                <td>
                  <a
                    className={s.address}
                    href={e.explorer + "/tx/" + e.txHash}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(e.txHash)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <Empty>No events were returned for this selection.</Empty>
        )}
      </div>
      <p className={s.caption}>
        Indexed protocol events. Open a transaction to inspect its onchain
        details.
        {networks
          .filter((n) => n.eventsRetained)
          .map((n) => (
            <span key={n.key}>
              {" "}
              Last received {n.name} events: {stamp(n.eventsObservedAt)}.
            </span>
          ))}
      </p>
    </section>
  );
}
export function Protocol({ feed, brief = false, onExplore }) {
  const [selected, setSelected] = useState("baseRebalancer");
  const networks = feed.data?.networks || [],
    network = networks.find((n) => n.key === selected) || networks[0];
  return (
    <>
      <section className={s.panel}>
        <div className={s.panelHead}>
          <div>
            <span className={s.eyebrow}>Thesauros protocol</span>
            <h2>{brief ? "Capital, at the source." : "Inside the vaults."}</h2>
          </div>
          <button
            className={s.textButton}
            onClick={brief ? onExplore : feed.refresh}
            disabled={!brief && feed.loading}
          >
            {brief ? "View protocol" : feed.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {feed.error && <p className={s.warning}>{feed.error}</p>}
        {!networks.length ? (
          feed.loading ? (
            <BrandLoading label="Reading the vaults" />
          ) : (
            <Empty>The protocol source is unavailable.</Empty>
          )
        ) : (
          <>
            <div className={s.networks}>
              {networks.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setSelected(n.key)}
                  aria-pressed={network?.key === n.key}
                >
                  <Mark chain={n.name} />
                  <span>{n.name}</span>
                  <i
                    className={
                      n.status === "available" ? s.statusDot : s.warningDot
                    }
                  />
                </button>
              ))}
            </div>
            {network && (
              <>
                <div className={s.networkMeta}>
                  <span>
                    Chain {network.chainId} ·{" "}
                    {network.blockNumber
                      ? "Block " + fmt(network.blockNumber, 0)
                      : "Block unavailable"}
                  </span>
                  <span>
                    {network.status === "degraded"
                      ? "Current RPC read unavailable"
                      : network.stale
                        ? "Last received snapshot"
                        : "Source connected"}
                  </span>
                </div>
                {network.status === "degraded" && (
                  <p className={s.warning}>
                    Current vault data could not be read. Previously received
                    records keep their original timestamps.
                  </p>
                )}
                {network.error && <p className={s.warning}>{network.error}</p>}
                {network.vaults.map((v) => (
                  <div key={v.address} className={s.vault}>
                    <div className={s.vaultHead}>
                      <div className={s.identity}>
                        <Mark token={v.token} />
                        <div>
                          <h3>{v.name}</h3>
                          <span>
                            {network.name} · {v.shareSymbol || "Vault shares"}
                          </span>
                        </div>
                      </div>
                      <a
                        className={s.address}
                        href={network.explorer + "/address/" + v.address}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(v.address)}
                      </a>
                    </div>
                    <div className={s.vaultStats}>
                      <div>
                        <span>Vault assets · {v.token}</span>
                        <strong>{fmt(v.assets, 6)}</strong>
                      </div>
                      <div>
                        <span>Current supply APY</span>
                        <strong>{pct(v.apy)}</strong>
                      </div>
                      <div>
                        <span>Shares outstanding</span>
                        <strong>{fmt(v.shares, 6)}</strong>
                      </div>
                    </div>
                    {v.providers.length &&
                    (!brief || v.providers.some((p) => p.share > 0)) ? (
                      <>
                        <div
                          className={s.allocationBar}
                          aria-label="Provider allocation"
                        >
                          {v.providers
                            .filter((p) => p.share > 0)
                            .map((p, i) => (
                              <span
                                key={p.address}
                                style={{
                                  width: p.share + "%",
                                  background: [
                                    "#254b6b",
                                    "#6e91ac",
                                    "#a8bbc9",
                                    "#d1dce4",
                                  ][i % 4],
                                }}
                                title={p.name + " " + pct(p.share)}
                              />
                            ))}
                        </div>
                        <div className={s.providerList}>
                          {v.providers
                            .filter((p) => !brief || p.share > 0)
                            .map((p) => (
                              <div key={p.address}>
                                <div className={s.identity}>
                                  <Mark name={p.logo} />
                                  <div>
                                    <strong>{p.name}</strong>
                                    <span>
                                      {p.riskTier
                                        ? p.riskTier.charAt(0).toUpperCase() +
                                          p.riskTier.slice(1) +
                                          " provider"
                                        : "Lending provider"}
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <strong>{pct(p.share)}</strong>
                                  <small>
                                    {fmt(p.balance, 6)} {v.token}
                                  </small>
                                </div>
                                <div>
                                  <strong>{pct(p.apy)}</strong>
                                  <small>Supply APY</small>
                                </div>
                                {!brief && (
                                  <a
                                    className={s.address}
                                    href={
                                      network.explorer + "/address/" + p.address
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {short(p.address)}
                                  </a>
                                )}
                              </div>
                            ))}
                        </div>
                      </>
                    ) : (
                      <Empty>
                        Provider allocation is unavailable in this snapshot.
                      </Empty>
                    )}
                    {!brief && (
                      <>
                        <div className={s.subhead}>
                          <h3>Vault rate history</h3>
                        </div>
                        <Chart
                          points={v.history}
                          label={v.token + " vault APY"}
                        />
                        {v.lifetime && (
                          <div className={s.lifetime}>
                            <div className={s.subhead}>
                              <h3>Lifetime activity</h3>
                              <span>
                                {v.lifetime.retained
                                  ? "Last indexed snapshot · "
                                  : ""}
                                {stamp(v.lifetime.updatedAt)}
                              </span>
                            </div>
                            <div className={s.miniStats}>
                              {[
                                ["Deposited", v.lifetime.totalDeposits],
                                ["Withdrawn", v.lifetime.totalWithdrawals],
                                ["Net deposits", v.lifetime.netDeposits],
                                [
                                  "Financial result",
                                  v.lifetime.financialResult,
                                ],
                                [
                                  "Last observed assets",
                                  v.lifetime.currentAssets,
                                ],
                                ["Protocol fees", v.lifetime.protocolFees],
                                [
                                  "Rebalanced assets",
                                  v.lifetime.rebalancedAssets,
                                ],
                                ["Rebalance costs", v.lifetime.rebalanceCosts],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <span>
                                    {label} · {v.token}
                                  </span>
                                  <strong>{fmt(value, 6)}</strong>
                                </div>
                              ))}
                            </div>
                            <div className={s.eventCounts}>
                              <span>
                                {fmt(v.lifetime.depositsCount, 0)} deposits
                              </span>
                              <span>
                                {fmt(v.lifetime.withdrawalsCount, 0)}{" "}
                                withdrawals
                              </span>
                              <span>
                                {fmt(v.lifetime.rebalanceCount, 0)} rebalances
                              </span>
                              <span>
                                {fmt(v.lifetime.feeChargedCount, 0)} fee events
                              </span>
                            </div>
                            <p className={s.caption}>
                              Indexed blocks {fmt(v.lifetime.fromBlock, 0)} –{" "}
                              {fmt(v.lifetime.toBlock, 0)}. Financial result =
                              assets + withdrawals − deposits.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {!brief && network.alerts && (
                  <div className={s.alerts}>
                    <h3>Monitoring alerts</h3>
                    <span>{fmt(network.alerts.high, 0)} high</span>
                    <span>{fmt(network.alerts.medium, 0)} medium</span>
                    <span>{fmt(network.alerts.low, 0)} low</span>
                    <small>{stamp(network.alerts.observedAt)}</small>
                    {network.alerts.recent.map((a, i) => (
                      <p key={i}>
                        {a.severity} · {a.type}: {a.message}
                      </p>
                    ))}
                  </div>
                )}
                <Source
                  href={network.source}
                  label="Thesauros monitor"
                  time={network.observedAt || network.fetchedAt}
                  stale={network.stale || network.status === "degraded"}
                />
              </>
            )}
          </>
        )}
      </section>
      {!brief && network && <Events networks={[network]} />}
    </>
  );
}
