"use client";

import { useEffect, useRef, useState } from "react";
import {
  platformPortfolio,
  scopedEvents,
  historyPeriod,
} from "../../lib/platform-view.mjs";
import { csvContent } from "../../lib/workspace-view.mjs";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import { Chart, Mark, fmt, pct, short, stamp, downloadCsv } from "./LivePanels";
import s from "./platform-workspace.module.css";

const colors = ["#254c68", "#7ba1b4", "#adc8c7", "#a2afc7", "#c4cbb7"];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const vaultName = (row) => `${row.token || "Asset"} on ${row.network}`;
const eventName = (value = "Operation") =>
  /rebalance/i.test(value)
    ? "Rebalance"
    : /withdraw|redeem/i.test(value)
      ? "Withdrawal"
      : /deposit/i.test(value)
        ? "Deposit"
        : value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
const eventDate = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

function VaultSwitcher({ entries, selected, onSelect }) {
  const menu = useRef(null);
  const primary = entries.filter((row) => row.isEarnVault);
  const others = entries.filter((row) => !row.isEarnVault);
  const otherSelected = others.find((row) => row.key === selected);
  useEffect(() => {
    const close = (event) => {
      if (menu.current?.open && !menu.current.contains(event.target))
        menu.current.open = false;
    };
    const escape = (event) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <nav className={s.switcher} aria-label="Vault selection">
      <button
        className={s.switchItem}
        aria-pressed={selected === "all"}
        onClick={() => onSelect("all")}
      >
        <span className={s.allGlyph} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
            <rect x="14" y="14" width="7" height="7" rx="2" />
          </svg>
        </span>
        <span>
          <strong>All vaults</strong>
          <small>Platform overview</small>
        </span>
      </button>
      {primary.map((row) => (
        <button
          key={row.key}
          className={s.switchItem}
          aria-label={`Select ${vaultName(row)}`}
          aria-pressed={selected === row.key}
          onClick={() => onSelect(row.key)}
        >
          <Mark chain={row.network} />
          <span>
            <strong>{row.token}</strong>
            <small>{row.network}</small>
          </span>
        </button>
      ))}
      {others.length > 0 && (
        <details ref={menu} className={s.moreVaults}>
          <summary
            className={`${s.switchItem} ${otherSelected ? s.moreSelected : ""}`}
          >
            <span className={s.allGlyph} aria-hidden="true">
              ···
            </span>
            <span>
              <strong>
                {otherSelected ? otherSelected.token : "More vaults"}
              </strong>
              <small>
                {otherSelected
                  ? otherSelected.network
                  : `${others.length} available`}
              </small>
            </span>
          </summary>
          <div className={s.vaultMenu}>
            {others.map((row) => (
              <button
                key={row.key}
                aria-pressed={selected === row.key}
                onClick={() => {
                  menu.current.open = false;
                  onSelect(row.key);
                }}
              >
                <Mark chain={row.network} />
                <span>
                  <strong>{vaultName(row)}</strong>
                  <small>{short(row.address)}</small>
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}

function DataDetails({ entries, networks }) {
  return (
    <details className={s.dataDetails}>
      <summary>Data & contract details</summary>
      <div className={s.detailsBody}>
        <p>
          APR is the current lending rate before fees. APY history is reported
          by the monitor. Totals keep each token separate; unavailable balances
          are excluded.
        </p>
        {entries.map((row) => (
          <section key={row.key} className={s.detailRecord}>
            <h3>{vaultName(row)}</h3>
            <dl>
              <div>
                <dt>Contract</dt>
                <dd>
                  <a
                    href={`${row.explorer}/address/${row.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {row.address}
                  </a>
                </dd>
              </div>
              {row.snapshot && (
                <>
                  <div>
                    <dt>Contract read</dt>
                    <dd>{stamp(row.snapshot.observedAt)}</dd>
                  </div>
                  <div>
                    <dt>Block</dt>
                    <dd>{row.snapshot.blockNumber || "Unavailable"}</dd>
                  </div>
                </>
              )}
              {row.source && (
                <>
                  <div>
                    <dt>Monitor</dt>
                    <dd>
                      <a href={row.source} target="_blank" rel="noreferrer">
                        {row.stale ? "Last available snapshot" : "Source"}
                      </a>{" "}
                      · {stamp(row.observedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>History</dt>
                    <dd>
                      {row.history?.length || 0} observations ·{" "}
                      {stamp(row.historyObservedAt)}
                    </dd>
                  </div>
                </>
              )}
              {row.lifetime && (
                <div>
                  <dt>Activity index</dt>
                  <dd>
                    {stamp(row.lifetime.updatedAt)} · Blocks{" "}
                    {fmt(row.lifetime.fromBlock, 0)}–
                    {fmt(row.lifetime.toBlock, 0)}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        ))}
        {networks?.map((network) => (
          <p key={network.key}>
            {network.name}: {network.status || "Unavailable"}.{" "}
            {network.alerts?.total ?? "—"} alerts.{" "}
            {network.eventsRetained ? "Saved event index." : ""}
          </p>
        ))}
        <p>
          Financial result = assets + withdrawals − deposits. Events without a
          verified vault address are marked “Network event”.
        </p>
      </div>
    </details>
  );
}

function VaultTable({ entries, onSelect }) {
  return (
    <section className={s.panel} aria-label="All vaults">
      <div className={s.panelHead}>
        <h2>Vaults</h2>
        <span className={s.count}>{entries.length}</span>
      </div>
      <div className={s.tableHead} aria-hidden="true">
        <span>Vault</span>
        <span>Supply rate</span>
        <span>Assets</span>
      </div>
      <div className={s.vaultRows}>
        {entries.map((row) => (
          <button
            key={row.key}
            className={s.vaultRow}
            aria-label={`Open ${vaultName(row)} ${short(row.address)}`}
            onClick={() => onSelect(row.key)}
          >
            <span className={s.vaultIdentity}>
              <Mark chain={row.network} />
              <span>
                <strong>{row.token || "Asset"}</strong>
                <small>
                  {row.network}
                  {row.assetsDelayed ? " · Delayed" : ""}
                </small>
              </span>
            </span>
            <span className={s.vaultRate}>
              <strong>{pct(row.displayRate)}</strong>
              <small>
                {row.rateKind}
                {row.rateDelayed ? " · Delayed" : ""}
              </small>
            </span>
            <span className={s.vaultAssets}>
              <strong>{fmt(row.displayAssets)}</strong>
              <small>{row.token}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CapitalByNetwork({ entries, totals }) {
  const [chosenToken, setChosenToken] = useState("USDC");
  const token = totals.some((item) => item.token === chosenToken)
    ? chosenToken
    : totals[0]?.token;
  const total = totals.find((item) => item.token === token);
  const byNetwork = new Map();
  for (const row of entries.filter((item) => item.token === token)) {
    const item = byNetwork.get(row.chainId) || {
      network: row.network,
      assets: null,
    };
    if (finite(row.displayAssets))
      item.assets = (item.assets ?? 0) + row.displayAssets;
    byNetwork.set(row.chainId, item);
  }
  const complete = total && total.reporting === total.count && total.assets > 0;
  return (
    <section className={s.panel} aria-label="Capital by network">
      <div className={s.panelHead}>
        <h2>Capital by network</h2>
      </div>
      {totals.length > 1 && (
        <div className={s.segmented} role="group" aria-label="Allocation asset">
          {totals.map((item) => (
            <button
              key={item.token}
              aria-pressed={token === item.token}
              onClick={() => setChosenToken(item.token)}
            >
              {item.token}
            </button>
          ))}
        </div>
      )}
      <div className={s.networkRows}>
        {[...byNetwork.values()].map((item, i) => (
          <div key={item.network} className={s.networkRow}>
            <div>
              <span>
                <Mark chain={item.network} />
                {item.network}
              </span>
              <strong>
                {fmt(item.assets)} <small>{token}</small>
              </strong>
            </div>
            {complete && (
              <div className={s.networkTrack} aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(0, Math.min(100, (item.assets / total.assets) * 100))}%`,
                    background: colors[i % colors.length],
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {!byNetwork.size && <p className={s.empty}>Allocation unavailable.</p>}
    </section>
  );
}

function Allocation({ vault }) {
  const providers = vault.snapshot?.providers.length
    ? vault.snapshot.providers
    : vault.providers || [];
  const complete =
    providers.length > 0 &&
    providers.every((p) => finite(p.share) && p.share >= 0);
  const total = complete
    ? providers.reduce((sum, p) => sum + p.share, 0)
    : null;
  return (
    <section className={s.panel} aria-label="Capital allocation">
      <div className={s.panelHead}>
        <h2>Allocation</h2>
        <span className={s.unit}>{vault.token}</span>
      </div>
      {complete && total > 0 && total <= 100.5 && (
        <div className={s.allocationBar} aria-hidden="true">
          {providers.map((provider, i) => (
            <span
              key={provider.key || provider.address || i}
              style={{
                width: `${provider.share}%`,
                background: colors[i % colors.length],
              }}
            />
          ))}
        </div>
      )}
      {!providers.length ? (
        <p className={s.empty}>Allocation unavailable.</p>
      ) : (
        <div className={s.providerList}>
          {providers.map((provider, i) => (
            <div
              className={s.provider}
              key={provider.key || provider.address || i}
            >
              <span className={s.providerName}>
                <Mark name={provider.name} />
                <span>{provider.name || "Provider"}</span>
              </span>
              <div>
                <strong>
                  {vault.snapshot &&
                  provider.share === 0 &&
                  provider.balance > 0
                    ? "<0.01%"
                    : pct(provider.share)}
                </strong>
                <span>
                  {fmt(provider.balance)} {vault.token}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PerformancePanel({ vault, pending }) {
  const [period, setPeriod] = useState("30d");
  const points = historyPeriod(vault.history || [], period);
  const hasHistory = points.filter((point) => finite(point.apy)).length >= 2;
  return (
    <section className={s.panel} aria-label="Vault performance">
      <div className={s.panelHead}>
        <h2>Yield history</h2>
        {vault.history?.length > 1 && (
          <div className={s.segmented} role="group" aria-label="History period">
            {["24h", "7d", "30d", "all"].map((value) => (
              <button
                key={value}
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {value === "all" ? "All" : value.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      {hasHistory ? (
        <Chart points={points} label="Supply APY" />
      ) : (
        <p className={s.empty} role={pending ? "status" : undefined}>
          {pending
            ? "Loading history…"
            : "No history available for this period."}
        </p>
      )}
    </section>
  );
}

function EventList({ events, all, pending }) {
  const [kind, setKind] = useState("all");
  const filtered =
    !all || kind === "all"
      ? events
      : events.filter((event) =>
          eventName(event.type).toLowerCase().startsWith(kind),
        );
  const visible = all ? filtered : filtered.slice(0, 3);
  return (
    <>
      {all && (
        <div className={s.segmented} role="group" aria-label="Operation type">
          {[
            ["all", "All"],
            ["rebalance", "Rebalances"],
            ["deposit", "Deposits"],
            ["withdraw", "Withdrawals"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!visible.length && (
        <p className={s.empty} role={pending ? "status" : undefined}>
          {pending ? "Loading activity…" : "No activity to display."}
        </p>
      )}
      <div className={s.eventList}>
        {visible.map((event, i) => (
          <article
            className={s.event}
            key={event.key || `${event.txHash}:${i}`}
          >
            <span className={s.eventIcon} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4 7h16M4 17h16M8 4v6m8 4v6" />
              </svg>
            </span>
            <div className={s.eventBody}>
              <strong>{eventName(event.type)}</strong>
              <span>
                {event.network}
                {event.token ? ` · ${event.token}` : ""}
                {event.scope === "network" ? " · Network event" : ""}
              </span>
              {(event.fromProvider || event.toProvider) && (
                <p>
                  {event.fromProvider || "Provider"} to{" "}
                  {event.toProvider || "provider"}
                </p>
              )}
              {finite(event.assets) && (
                <p>
                  {fmt(event.assets)} {event.token}
                </p>
              )}
            </div>
            <div className={s.eventEnd}>
              <time
                dateTime={event.timestamp || undefined}
                title={stamp(event.timestamp)}
              >
                {eventDate(event.timestamp)}
              </time>
              {event.success === false && (
                <span className={s.status}>Failed</span>
              )}
              {event.txHash && event.explorer && (
                <a
                  href={`${event.explorer.replace(/\/$/, "")}/tx/${event.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function Activity({ events, view, navigate, pending }) {
  return (
    <section className={s.panel} aria-label="Vault activity">
      <div className={s.panelHead}>
        <h2>{view === "operations" ? "Activity" : "Recent activity"}</h2>
        {view !== "operations" && (
          <button
            className={s.textButton}
            onClick={() => navigate("operations")}
          >
            View all
          </button>
        )}
      </div>
      <EventList
        events={events}
        all={view === "operations"}
        pending={pending}
      />
    </section>
  );
}

function Lifetime({ vault }) {
  if (!vault.lifetime) return null;
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2>Capital movements</h2>
        <span className={s.unit}>{vault.token}</span>
      </div>
      <dl className={s.lifetime}>
        {[
          ["Deposited", vault.lifetime.totalDeposits],
          ["Withdrawn", vault.lifetime.totalWithdrawals],
          ["Net deposits", vault.lifetime.netDeposits],
          ["Financial result", vault.lifetime.financialResult],
          ["Protocol fees", vault.lifetime.protocolFees],
          ["Rebalance costs", vault.lifetime.rebalanceCosts],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{fmt(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EarnCard({ onEarn, navigate, vault }) {
  return (
    <section className={s.earnCard}>
      <h2>Try Earn.</h2>
      <p>Deposit and withdraw USDC with your wallet.</p>
      <button
        className={s.primaryButton}
        onClick={() =>
          vault?.earnVaultId ? onEarn(vault.earnVaultId) : navigate("earn")
        }
      >
        Open Earn
      </button>
      <button className={s.textButton} onClick={() => navigate("test")}>
        Try with test funds
      </button>
    </section>
  );
}

function IntegrationBanner({ navigate }) {
  return (
    <section className={s.banner}>
      <div>
        <h2>Add Earn to your app.</h2>
        <p>Connect vaults, allocation and reporting to your product.</p>
        <button
          className={s.primaryButton}
          onClick={() => navigate("developers")}
        >
          Explore the integration
        </button>
      </div>
      <div className={s.system} aria-hidden="true">
        <div className={s.productNode}>
          <span>Your app</span>
          <strong>
            Balance <b>Earn</b>
          </strong>
        </div>
        <span className={s.connector} />
        <div className={s.vaultNode}>
          <img src="/brand/mark.svg" width="27" height="27" alt="" />
          <strong>Thesauros</strong>
        </div>
      </div>
    </section>
  );
}

export default function PlatformWorkspace({
  view,
  feed,
  account,
  navigate,
  onEarn,
}) {
  const [selected, setSelected] = useState("all");
  const portfolio = platformPortfolio(
    feed.data?.networks || [],
    account?.vaults || [],
  );
  const { entries, totals } = portfolio;
  const vault =
    selected === "all" ? null : entries.find((entry) => entry.key === selected);
  const all = selected === "all";
  const pending = feed.loading && !feed.data;
  const scoped = all ? entries : vault ? [vault] : [];
  const events =
    all || vault ? scopedEvents(feed.data?.networks || [], vault) : [];
  const delayed = scoped.some((row) => row.assetsDelayed || row.rateDelayed);
  const partial = scoped.some((row) => !finite(row.displayAssets));
  function refresh() {
    feed.refresh();
    account?.refresh();
  }
  function select(key) {
    setSelected(key);
  }
  function exportReport() {
    downloadCsv(
      csvContent([
        [
          "Network",
          "Contract",
          "Token",
          "Assets",
          "Supply rate %",
          "Rate type",
          "Rate source",
          "Contract read UTC",
          "Monitor UTC",
          "Monitor status",
        ],
        ...scoped.map((row) => [
          row.network,
          row.address,
          row.token,
          row.displayAssets,
          row.displayRate,
          row.rateKind,
          row.rateKind === "APR" ? "Contract, before fees" : "Monitor",
          row.snapshot?.observedAt,
          row.observedAt,
          row.stale ? "Last available" : row.status,
        ]),
        ...(!all && vault
          ? [
              [],
              ["History UTC", "Supply APY %"],
              ...(vault.history || []).map((point) => [
                point.timestamp,
                point.apy,
              ]),
            ]
          : []),
      ]),
      all
        ? "thesauros-all-vaults.csv"
        : `thesauros-${vault?.networkKey}-vault.csv`,
    );
  }
  return (
    <div className={s.workspace}>
      <VaultSwitcher entries={entries} selected={selected} onSelect={select} />
      <div className={s.context}>
        <div className={s.contextTitle}>
          <h2>
            {all
              ? "All vaults"
              : vault
                ? vaultName(vault)
                : "Vault unavailable"}
          </h2>
          {delayed ? (
            <span className={s.status}>Some data delayed</span>
          ) : partial && !pending && !account?.loading ? (
            <span className={s.status}>Some data unavailable</span>
          ) : null}
        </div>
        <div className={s.actions}>
          <button
            className={s.secondaryButton}
            onClick={refresh}
            disabled={feed.loading || account?.loading}
          >
            {feed.loading || account?.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className={s.secondaryButton}
            onClick={exportReport}
            disabled={!scoped.length}
          >
            Export
          </button>
        </div>
      </div>
      {feed.error && !feed.data && (
        <p className={s.status} role="status">
          Activity is temporarily unavailable.
        </p>
      )}
      {all ? (
        <>
          <div className={s.overallMetrics} aria-label="Platform totals">
            {totals.map((total) => (
              <div key={total.token}>
                <span>
                  {total.reporting < total.count ? "Reported" : "Total"}{" "}
                  {total.token}
                </span>
                <strong>{fmt(total.assets)}</strong>
              </div>
            ))}
            <div>
              <span>Vaults</span>
              <strong>{entries.length}</strong>
            </div>
            <div>
              <span>Networks</span>
              <strong>{portfolio.networks}</strong>
            </div>
          </div>
          <div className={s.split}>
            <VaultTable entries={entries} onSelect={select} />
            <div className={s.stack}>
              <CapitalByNetwork entries={entries} totals={totals} />
              {view === "overview" && (
                <EarnCard navigate={navigate} onEarn={onEarn} />
              )}
            </div>
          </div>
          {view !== "performance" && (
            <Activity
              events={events}
              view={view}
              navigate={navigate}
              pending={pending}
            />
          )}
        </>
      ) : vault ? (
        <>
          <div className={s.metrics} aria-label="Vault metrics">
            <div>
              <span>Total assets</span>
              <strong>
                {fmt(vault.displayAssets)} <small>{vault.token}</small>
              </strong>
            </div>
            <div>
              <span>Supply {vault.rateKind}</span>
              <strong>{pct(vault.displayRate)}</strong>
            </div>
            <div>
              <span>Rebalances</span>
              <strong>{fmt(vault.lifetime?.rebalanceCount, 0)}</strong>
            </div>
          </div>
          <div className={s.split}>
            <div className={s.stack}>
              {view !== "operations" ? (
                <PerformancePanel vault={vault} pending={pending} />
              ) : (
                <Activity
                  events={events}
                  view={view}
                  navigate={navigate}
                  pending={pending}
                />
              )}
              {vault.lifetime && <Lifetime vault={vault} />}
            </div>
            <div className={s.stack}>
              <Allocation vault={vault} />
              {view === "overview" && (
                <EarnCard vault={vault} onEarn={onEarn} navigate={navigate} />
              )}
            </div>
          </div>
          {view === "overview" && (
            <Activity
              events={events}
              view={view}
              navigate={navigate}
              pending={pending}
            />
          )}
          {view === "operations" && (
            <div className={s.actions}>
              <button
                className={s.secondaryButton}
                onClick={() => navigate("protocol")}
              >
                Contract controls
              </button>
              <a
                className={s.textButton}
                href={documentationHref("/security/controls/")}
              >
                Security documentation
              </a>
            </div>
          )}
        </>
      ) : (
        <section className={s.panel}>
          <p className={s.empty}>
            This vault is no longer in the available data.
          </p>
          <button className={s.secondaryButton} onClick={() => select("all")}>
            All vaults
          </button>
        </section>
      )}
      <DataDetails
        entries={scoped}
        networks={
          all
            ? feed.data?.networks
            : feed.data?.networks?.filter(
                (network) => network.key === vault?.networkKey,
              )
        }
      />
      {view === "overview" && <IntegrationBanner navigate={navigate} />}
      {view === "overview" && (
        <div className={s.contact}>
          <span>Planning an integration?</span>
          <a href={marketingHref("/contact?usecase=launch")}>
            Talk to Thesauros
          </a>
        </div>
      )}
    </div>
  );
}
