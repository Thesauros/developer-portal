"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import s from "./workspace.module.css";
import c from "./livecards.module.css";
import {
  assetTotals,
  csvContent,
  filterNetworks,
  vaultRows,
} from "../../lib/workspace-view.mjs";
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
  const protocol = String(name || "")
    .toLowerCase()
    .split(/[ _-]/)[0];
  const knownProtocol = [
    "aave",
    "compound",
    "morpho",
    "euler",
    "fluid",
    "moonwell",
    "spark",
  ].includes(protocol);
  const file = name
    ? knownProtocol
      ? "protocols/" + protocol + ".png"
      : null
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
    <span className={s.markFallback} aria-hidden="true">
      {(name || chain || token || "T").slice(0, 1)}
    </span>
  );
}
export function useLive(kind, enabled = true) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
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
  }, [kind, revision, enabled]);
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
export function Source({ href, time, stale, label = "Data source" }) {
  return (
    <details className={s.sourceDisclosure}>
      <summary>{label}</summary>
      <div className={s.source}>
        <span>
          {stale ? "Last available data" : "Updated"} · {stamp(time)}
        </span>
        <a href={href} target="_blank" rel="noreferrer">
          Open source
        </a>
      </div>
    </details>
  );
}

export function Empty({ children }) {
  return <div className={s.empty}>{children}</div>;
}
export function Chart({ points, metric = "apy", label = "Market APY" }) {
  const id = useId().replaceAll(":", ""),
    [selected, setSelected] = useState(null);
  const plot = useRef(null);
  const [width, setWidth] = useState(770);
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
  const hasHistory = valid.length >= 2;
  useEffect(() => {
    if (!hasHistory || !plot.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(200, Math.round(entry.contentRect.width)));
    });
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, [hasHistory]);
  if (valid.length < 2) return <Empty>No history available.</Empty>;
  const minT = Date.parse(valid[0].timestamp),
    maxT = Date.parse(valid.at(-1).timestamp),
    values = valid.map((p) => p[metric]);
  let min = Math.min(...values),
    max = Math.max(...values);
  const pad = Math.max((max - min) * 0.18, max * 0.01, 0.001);
  min = Math.max(0, min - pad);
  max += pad;
  const x = (p) =>
      54 +
      ((Date.parse(p.timestamp) - minT) / (maxT - minT || 1)) * (width - 80),
    y = (p) => 196 - ((p[metric] - min) / (max - min)) * 174;
  const segments = [];
  let current = [];
  for (const p of points) {
    if (
      p[metric] === null ||
      p[metric] === undefined ||
      !Number.isFinite(p[metric]) ||
      !Number.isFinite(Date.parse(p.timestamp))
    ) {
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
          (((event.clientX - rect.left) / rect.width) * width - 54) /
            (width - 80),
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
        <small>
          <time dateTime={point.timestamp} title={stamp(point.timestamp)}>
            {new Date(point.timestamp).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </time>
        </small>
      </div>
      <div
        ref={plot}
        className={s.chartPlot}
        role="region"
        aria-label={label + " chart"}
        tabIndex={0}
      >
        <svg
          viewBox={`0 0 ${width} 228`}
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
                x2={width - 24}
                y1={196 - t * 174}
                y2={196 - t * 174}
                stroke="#e6edf2"
                strokeDasharray="3 5"
              />
              <text x="0" y={200 - t * 174} fill="#526579" fontSize="12">
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
          <text x="54" y="221" fontSize="12" fill="#526579">
            {new Date(minT).toLocaleDateString("en-GB", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </text>
          <text
            x={width - 26}
            y="221"
            textAnchor="end"
            fontSize="12"
            fill="#526579"
          >
            {new Date(maxT).toLocaleDateString("en-GB", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </text>
        </svg>
      </div>
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
export function downloadCsv(content, filename) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Table({ label, children, className = "" }) {
  return (
    <div
      className={`${s.tableWrap} ${className}`}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  );
}
export function Markets({ feed, networks = null, brief = false, onExplore }) {
  const [protocol, setProtocol] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("liquidity");
  const [selected, setSelected] = useState(""),
    [history, setHistory] = useState(null),
    [historyError, setHistoryError] = useState("");
  const [days, setDays] = useState(90),
    [metric, setMetric] = useState("apy"),
    [reload, setReload] = useState(0);
  const list = feed.data?.data || [];
  const filtered = filterNetworks(list, networks, (p) => p.chain)
    .filter(
      (p) =>
        (!protocol || p.name === protocol) &&
        [p.name, p.token, p.label, p.chain]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (b[sort === "apy" ? "apy" : "tvlUsd"] ?? -Infinity) -
        (a[sort === "apy" ? "apy" : "tvlUsd"] ?? -Infinity),
    );
  const market = !brief && filtered.find((p) => p.id === selected);
  useEffect(() => {
    if (!market) return;
    const controller = new AbortController();
    let active = true;
    setHistory(null);
    setHistoryError("");
    fetch("/app/live?kind=history&pool=" + encodeURIComponent(market.id), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (active) {
          setHistory(value);
          setHistoryError(value.error || "");
        }
      })
      .catch((error) => {
        if (active && error.name !== "AbortError")
          setHistoryError("Market history could not load.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [market?.id, reload]);
  useEffect(() => {
    if (!market) return;
    const detail = document.getElementById("market-detail");
    detail?.scrollIntoView({ block: "start" });
    detail?.focus({ preventScroll: true });
  }, [market?.id]);
  function closeMarket() {
    ["market-", "market-mobile-"]
      .map((prefix) => document.getElementById(prefix + selected))
      .find((node) => node?.getClientRects().length)
      ?.focus();
    setSelected("");
  }
  const points = (history?.data || []).filter(
    (p) => Date.parse(p.timestamp) >= Date.now() - days * 86400000,
  );
  const shown = brief ? filtered.slice(0, 4) : filtered;
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2>{brief ? "Lending markets" : "Market comparison"}</h2>
        {brief && (
          <button className={s.textButton} onClick={onExplore}>
            All markets ({filtered.length})
          </button>
        )}
      </div>
      {feed.error && (
        <p className={s.warning} role="status">
          {feed.error}
        </p>
      )}
      {!list.length && feed.loading ? (
        <BrandLoading label="Loading markets" />
      ) : !list.length ? (
        <Empty>Market data is unavailable. Use Refresh to try again.</Empty>
      ) : (
        <>
          {!brief && (
            <div className={s.filters}>
              <label>
                Search
                <input
                  type="search"
                  placeholder="Market, asset or network"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                Protocol
                <select
                  aria-label="Protocol"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                >
                  <option value="">All protocols</option>
                  {[...new Set(list.map((p) => p.name))].sort().map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Sort by
                <select
                  aria-label="Sort by"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="liquidity">Pool TVL: highest first</option>
                  <option value="apy">Supply APY: highest first</option>
                </select>
              </label>
              <span className={s.resultCount} role="status">
                {filtered.length} markets
              </span>
            </div>
          )}
          <div className={c.mobileList} aria-label="Lending market cards">
            {shown.map((p) => (
              <article
                className={c.card}
                key={p.id}
                data-selected={market?.id === p.id}
              >
                <div className={c.cardHead}>
                  <Mark name={p.logo} />
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {p.token}
                      {p.label ? " · " + p.label : ""}
                    </span>
                  </div>
                  <span className={c.network}>{p.chain}</span>
                </div>
                <dl className={c.values}>
                  <div>
                    <dt>Supply APY</dt>
                    <dd>{pct(p.apy)}</dd>
                  </div>
                  <div>
                    <dt>Pool TVL · USD</dt>
                    <dd>{compact(p.tvlUsd)}</dd>
                  </div>
                  {!brief && (
                    <div>
                      <dt>7D change · pp</dt>
                      <dd>{fmt(p.change7d)}</dd>
                    </div>
                  )}
                </dl>
                {!brief && (
                  <button
                    id={"market-mobile-" + p.id}
                    className={c.cardButton}
                    onClick={() => setSelected(selected === p.id ? "" : p.id)}
                    aria-expanded={market?.id === p.id}
                    aria-controls="market-detail"
                    aria-label={`View ${p.name} ${p.token} on ${p.chain}`}
                  >
                    View market history
                  </button>
                )}
              </article>
            ))}
          </div>
          <Table label="Lending markets" className={c.desktopTable}>
            <table>
              <thead>
                <tr>
                  <th>Market / asset</th>
                  <th>Network</th>
                  <th className={s.numeric}>Supply APY</th>
                  <th className={s.numeric}>Pool TVL · USD</th>
                  {!brief && <th className={s.numeric}>7D change · pp</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} data-selected={market?.id === p.id}>
                    <td>
                      {brief ? (
                        <div className={s.identity}>
                          <Mark name={p.logo} />
                          <div>
                            <strong>{p.name}</strong>
                            <span>
                              {p.token}
                              {p.label ? " · " + p.label : ""}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <button
                          className={s.marketButton}
                          id={"market-" + p.id}
                          onClick={() =>
                            setSelected(selected === p.id ? "" : p.id)
                          }
                          aria-expanded={market?.id === p.id}
                          aria-controls="market-detail"
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
                      )}
                    </td>
                    <td>{p.chain}</td>
                    <td className={s.numeric}>{pct(p.apy)}</td>
                    <td className={s.numeric}>{compact(p.tvlUsd)}</td>
                    {!brief && <td className={s.numeric}>{fmt(p.change7d)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
          {!filtered.length && <Empty>No markets match this selection.</Empty>}
          {!brief && (
            <p className={c.metricHelp}>
              Pool TVL is the reported capital in a market. It is separate from
              available withdrawal liquidity.
            </p>
          )}
          <Source
            href="https://defillama.com/yields"
            label="DeFiLlama · external markets"
            time={feed.data?.fetchedAt}
            stale={feed.data?.stale}
          />
          {!brief && (
            <div id="market-detail" tabIndex={-1} className={s.focusedDetail}>
              {market && (
                <div className={s.detailPanel}>
                  <div className={s.panelHead}>
                    <h3>
                      {market.name} · {market.token} · {market.chain}
                    </h3>
                    <button className={s.textButton} onClick={closeMarket}>
                      Close details
                    </button>
                  </div>
                  <div className={s.miniStats}>
                    {[
                      ["Supply APY", pct(market.apy)],
                      ["Base APY", pct(market.baseApy)],
                      ["Rewards APY", pct(market.rewardApy)],
                      ["Pool TVL · USD", compact(market.tvlUsd)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className={s.chartHead}>
                    <div className={s.segment} aria-label="Chart metric">
                      {[
                        ["apy", "APY"],
                        ["tvlUsd", "Pool TVL"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={metric === value}
                          onClick={() => setMetric(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className={s.segment} aria-label="Chart period">
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
                    <p className={s.warning} role="status">
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
                      points={points}
                      metric={metric}
                      label={
                        metric === "apy" ? "Supply APY" : "Market pool TVL"
                      }
                    />
                  ) : (
                    !historyError && <Empty>Loading history…</Empty>
                  )}
                  {history?.fetchedAt && (
                    <Source
                      href={"https://yields.llama.fi/chart/" + market.id}
                      label="History source"
                      time={history.fetchedAt}
                      stale={history.stale}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function Events({ networks, loading = false, error = "" }) {
  const [type, setType] = useState(""),
    [limit, setLimit] = useState(50);
  const events = networks
    .flatMap((n) =>
      n.events.map((e) => ({ ...e, network: n.name, explorer: n.explorer })),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const types = [...new Set(events.map((e) => e.type))].sort();
  const filtered = events.filter((e) => !type || e.type === type);
  function exportEvents() {
    downloadCsv(
      csvContent([
        [
          "Event",
          "Network",
          "Asset",
          "Time UTC",
          "Block",
          "Transaction",
          "Status",
        ],
        ...filtered.map((e) => [
          e.type,
          e.network,
          e.token,
          e.timestamp,
          e.blockNumber,
          e.txHash,
          e.success ? "Confirmed" : "Failed",
        ]),
      ]),
      "thesauros-protocol-activity.csv",
    );
  }
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2>Protocol transactions</h2>
        <button
          className={s.secondaryButton}
          onClick={exportEvents}
          disabled={!filtered.length}
        >
          Export CSV
        </button>
      </div>
      {error && (
        <p className={s.warning} role="status">
          {error}
        </p>
      )}
      <div className={s.filters}>
        <label>
          Event type
          <select
            aria-label="Event type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setLimit(50);
            }}
          >
            <option value="">All events</option>
            {[...new Set([...types, ...(type ? [type] : [])])].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <span className={s.resultCount} role="status">
          {filtered.length} events
        </span>
      </div>
      {loading && !events.length ? (
        <BrandLoading label="Loading activity" />
      ) : (
        <Table label="Protocol transactions">
          <table>
            <thead>
              <tr>
                <th>Event / asset</th>
                <th>Network</th>
                <th>Time · UTC</th>
                <th className={s.numeric}>Block</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((e) => (
                <tr key={e.network + e.id}>
                  <td>
                    <strong>
                      {e.type.replace(/([a-z])([A-Z])/g, "$1 $2")}
                    </strong>
                    <small>
                      {e.token} · {e.success ? "Confirmed" : "Failed"}
                    </small>
                  </td>
                  <td>{e.network}</td>
                  <td>{stamp(e.timestamp).replace(" UTC", "")}</td>
                  <td className={s.numeric}>{fmt(e.blockNumber, 0)}</td>
                  <td>
                    <a
                      className={s.address}
                      href={e.explorer + "/tx/" + e.txHash}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={"View transaction " + e.txHash}
                    >
                      {short(e.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty>
              {error || networks.some((n) => n.status === "degraded" || n.error)
                ? "Activity is unavailable for part of this selection. Use Refresh to try again."
                : !networks.length
                  ? "No protocol networks in this selection."
                  : "No indexed events match this selection."}
            </Empty>
          )}
        </Table>
      )}
      {filtered.length > limit && (
        <div className={s.tableFooter}>
          <span>
            Showing {Math.min(limit, filtered.length)} of {filtered.length}
          </span>
          <button
            className={s.secondaryButton}
            onClick={() => setLimit((v) => v + 50)}
          >
            Show more
          </button>
        </div>
      )}
      {networks.some(
        (n) => n.status === "degraded" || n.error || n.eventsRetained,
      ) && (
        <p className={s.warning} role="status">
          Some networks could not refresh. Available indexed events are shown
          with their source timestamps below.
        </p>
      )}
      <div className={s.sourceList}>
        {networks.map((n) => (
          <Source
            key={n.key}
            href={n.source}
            label={n.name + " · monitor"}
            time={n.eventsObservedAt || n.observedAt || n.fetchedAt}
            stale={n.eventsRetained || n.stale || n.status === "degraded"}
          />
        ))}
      </div>
    </section>
  );
}
function VaultDetail({ vault: v, onClose }) {
  const network = v.network;
  return (
    <div className={s.detailPanel}>
      <div className={s.panelHead}>
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
          View contract · {short(v.address)}
        </a>
        <button className={s.textButton} onClick={onClose}>
          Close vault details
        </button>
      </div>
      {(network.status === "degraded" || network.stale) && (
        <p className={s.warning}>Some data is delayed.</p>
      )}
      {network.error && <p className={s.warning}>{network.error}</p>}
      <div className={s.miniStats}>
        {[
          ["Assets · " + v.token, fmt(v.assets, 6)],
          ["Supply APY", pct(v.apy)],
          ["Shares outstanding", fmt(v.shares, 6)],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <h3 className={s.subhead}>Provider allocation</h3>
      {v.providers.length ? (
        <Table label={network.name + " vault providers"}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th className={s.numeric}>Allocation</th>
                <th className={s.numeric}>{v.token}</th>
                <th className={s.numeric}>Supply APY</th>
                <th>Contract</th>
              </tr>
            </thead>
            <tbody>
              {v.providers.map((p) => (
                <tr key={p.address}>
                  <td>
                    <div className={s.identity}>
                      <Mark name={p.logo} />
                      <strong>{p.name}</strong>
                    </div>
                  </td>
                  <td className={s.numeric}>{pct(p.share)}</td>
                  <td className={s.numeric}>{fmt(p.balance, 6)}</td>
                  <td className={s.numeric}>{pct(p.apy)}</td>
                  <td>
                    <a
                      className={s.address}
                      href={network.explorer + "/address/" + p.address}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(p.address)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Table>
      ) : (
        <Empty>Allocation unavailable.</Empty>
      )}
      <h3 className={s.subhead}>Vault rate history</h3>
      <Chart points={v.history} label={v.token + " vault APY"} />
      {v.lifetime && (
        <details className={s.disclosure}>
          <summary>Lifetime activity</summary>
          <p className={s.caption}>
            {v.lifetime.retained ? "Last updated · " : "Updated · "}
            {stamp(v.lifetime.updatedAt)}
          </p>
          <div className={s.miniStats}>
            {[
              ["Deposited", v.lifetime.totalDeposits],
              ["Withdrawn", v.lifetime.totalWithdrawals],
              ["Net deposits", v.lifetime.netDeposits],
              ["Financial result", v.lifetime.financialResult],
              ["Protocol fees", v.lifetime.protocolFees],
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
          <p className={s.caption}>
            Indexed blocks {fmt(v.lifetime.fromBlock, 0)} –{" "}
            {fmt(v.lifetime.toBlock, 0)}. Financial result = assets +
            withdrawals − deposits.
          </p>
        </details>
      )}
      {network.alerts && (
        <details className={s.disclosure}>
          <summary>
            Monitoring alerts · {fmt(network.alerts.high, 0)} high ·{" "}
            {fmt(network.alerts.medium, 0)} medium ·{" "}
            {fmt(network.alerts.low, 0)} low
          </summary>
          <p className={s.caption}>{stamp(network.alerts.observedAt)}</p>
          {network.alerts.recent.map((a, i) => (
            <p key={i}>
              {a.severity} · {a.type}: {a.message}
            </p>
          ))}
        </details>
      )}
      <Source
        href={network.source}
        label={network.name + " · monitor"}
        time={network.observedAt || network.fetchedAt}
        stale={network.stale || network.status === "degraded"}
      />
    </div>
  );
}
export function Protocol({ feed, brief = false, onExplore }) {
  const [selected, setSelected] = useState("");
  const networks = feed.data?.networks || [],
    rows = vaultRows(networks),
    totals = assetTotals(networks);
  const vault = rows.find((v) => v.id === selected);
  useEffect(() => {
    if (!vault || brief) return;
    const detail = document.getElementById("vault-detail");
    detail?.scrollIntoView({ block: "start" });
    detail?.focus({ preventScroll: true });
  }, [vault?.id, brief]);
  function closeVault() {
    ["vault-", "vault-mobile-"]
      .map((prefix) => document.getElementById(prefix + selected))
      .find((node) => node?.getClientRects().length)
      ?.focus();
    setSelected("");
  }
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2>{brief ? "Thesauros vaults" : "Vault comparison"}</h2>
        {brief && (
          <button className={s.textButton} onClick={onExplore}>
            View vaults
          </button>
        )}
      </div>
      {feed.error && (
        <p className={s.warning} role="status">
          {feed.error}
        </p>
      )}
      {networks.some((n) => !n.vaults.length) && (
        <p className={s.warning} role="status">
          No vault data returned for{" "}
          {networks
            .filter((n) => !n.vaults.length)
            .map((n) => n.name)
            .join(", ")}
          .
        </p>
      )}
      {!feed.data && feed.loading ? (
        <BrandLoading label="Loading vaults" />
      ) : !rows.length ? (
        <Empty>
          {!feed.data || feed.error
            ? "Protocol data is unavailable. Use Refresh to try again."
            : "No vaults in this network selection."}
        </Empty>
      ) : (
        <>
          {!brief && (
            <div className={s.assetTotals}>
              {totals.map((t) => (
                <div key={t.token}>
                  <span>Reported assets · {t.token}</span>
                  <strong>{fmt(t.assets, 2)}</strong>
                  <small>
                    {t.reporting} of {t.count} vaults reporting
                    {t.stale ? " · includes last received data" : ""}
                  </small>
                </div>
              ))}
            </div>
          )}
          <div className={c.mobileList} aria-label="Thesauros vault cards">
            {rows.map((v) => (
              <article
                className={c.card}
                key={v.id}
                data-selected={v.id === selected}
              >
                <div className={c.cardHead}>
                  <Mark chain={v.network.name} />
                  <div>
                    <strong>{v.network.name}</strong>
                    <span>{v.token} vault</span>
                  </div>
                  <span className={c.network}>{v.token}</span>
                </div>
                <dl className={c.values}>
                  <div>
                    <dt>Supply APY</dt>
                    <dd>{pct(v.apy)}</dd>
                  </div>
                  <div>
                    <dt>Reported assets · {v.token}</dt>
                    <dd>{fmt(v.assets, 2)}</dd>
                  </div>
                </dl>
                <p className={c.observed}>
                  {v.assets == null
                    ? "Unavailable"
                    : v.network.stale || v.network.status === "degraded"
                      ? "Last received"
                      : "Observed"}{" "}
                  · {stamp(v.network.observedAt)}
                </p>
                {!brief && (
                  <button
                    id={"vault-mobile-" + v.id}
                    className={c.cardButton}
                    onClick={() => setSelected(selected === v.id ? "" : v.id)}
                    aria-expanded={v.id === selected}
                    aria-controls="vault-detail"
                    aria-label={`View ${v.network.name} ${v.token} vault allocations`}
                  >
                    View allocations
                  </button>
                )}
              </article>
            ))}
          </div>
          <Table label="Thesauros vaults" className={c.desktopTable}>
            <table>
              <thead>
                <tr>
                  <th>Network / asset</th>
                  <th className={s.numeric}>Reported assets</th>
                  <th className={s.numeric}>Supply APY</th>
                  <th>Data observed · UTC</th>
                  {!brief && <th>Details</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const stale =
                    v.network.stale || v.network.status === "degraded";
                  return (
                    <tr key={v.id} data-selected={v.id === selected}>
                      <td>
                        <div className={s.identity}>
                          <Mark chain={v.network.name} />
                          <div>
                            <strong>{v.network.name}</strong>
                            <span>{v.token}</span>
                          </div>
                        </div>
                      </td>
                      <td className={s.numeric}>
                        {fmt(v.assets, 6)}
                        <small>{v.token}</small>
                      </td>
                      <td className={s.numeric}>{pct(v.apy)}</td>
                      <td>
                        <span
                          className={
                            stale || v.assets == null
                              ? s.warningText
                              : undefined
                          }
                        >
                          {v.assets == null
                            ? "Unavailable"
                            : stale
                              ? "Last received"
                              : "Available"}
                        </span>
                        <small>
                          {stamp(v.network.observedAt).replace(" UTC", "")}
                        </small>
                      </td>
                      {!brief && (
                        <td>
                          <button
                            className={s.textButton}
                            id={"vault-" + v.id}
                            aria-expanded={v.id === selected}
                            aria-controls="vault-detail"
                            aria-label={
                              (v.id === selected ? "Close " : "View ") +
                              v.network.name +
                              " " +
                              v.token +
                              " vault"
                            }
                            onClick={() =>
                              setSelected(selected === v.id ? "" : v.id)
                            }
                          >
                            {selected === v.id ? "Close" : "View"}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Table>
          {!brief && (
            <div id="vault-detail" tabIndex={-1} className={s.focusedDetail}>
              {vault && <VaultDetail vault={vault} onClose={closeVault} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}
