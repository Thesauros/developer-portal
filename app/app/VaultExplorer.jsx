"use client";

import { useRef, useState } from "react";
import { formatUnits } from "viem";
import {
  vaults,
  displayAmount,
  tokenAmount,
} from "../../lib/vault-contracts.mjs";
import { csvContent } from "../../lib/workspace-view.mjs";
import { downloadCsv } from "./LivePanels";
import p from "./product.module.css";
import v from "./vaultdetail.module.css";

function percent(value, decimals = 27) {
  return value == null
    ? "—"
    : (Number(formatUnits(BigInt(value), decimals)) * 100).toFixed(2) + "%";
}
const short = (value) =>
  value ? value.slice(0, 8) + "…" + value.slice(-6) : "—";
function observed(value) {
  if (!value) return "Not received";
  return (
    new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
function ContractLink({ vault, address = vault.address, children }) {
  return (
    <a
      href={vault.explorer + "/address/" + address}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {children || short(address)}
    </a>
  );
}
function status(paused) {
  return paused == null ? "Unavailable" : paused ? "Paused" : "Not paused";
}

export default function VaultExplorer({ account, onEarn, initialVault }) {
  const [selected, setSelected] = useState(
    vaults.some((vault) => vault.id === initialVault)
      ? initialVault
      : vaults[0].id,
  );
  const detail = useRef(null);
  const definition = vaults.find((item) => item.id === selected);
  const snapshot = account.vaults.find((item) => item.id === selected);
  const ready = snapshot?.status === "ready";
  const providers = ready ? snapshot.providers || [] : [];
  const completeAllocation =
    providers.length > 0 && providers.every((row) => row.assets != null);
  const allocated = providers.reduce(
    (sum, row) => sum + BigInt(row.assets || 0),
    0n,
  );

  function inspect(id) {
    setSelected(id);
    requestAnimationFrame(() => {
      detail.current?.scrollIntoView({ behavior: "auto", block: "start" });
      detail.current?.focus({ preventScroll: true });
    });
  }
  function exportVaults() {
    downloadCsv(
      csvContent([
        [
          "Network",
          "Vault",
          "Asset",
          "Assets USDC",
          "Gross APR",
          "Minimum deposit USDC",
          "Deposits",
          "Withdrawals",
          "Management fee",
          "Performance fee",
          "Read status",
          "Block",
          "Observed UTC",
        ],
        ...vaults.map((vault) => {
          const row = account.vaults.find((item) => item.id === vault.id);
          const available = row?.status === "ready";
          return [
            vault.name,
            vault.address,
            vault.symbol,
            available ? tokenAmount(row.totalAssets) : "",
            available && row.rateRay != null ? percent(row.rateRay) : "",
            available ? tokenAmount(row.minAssets) : "",
            available ? status(row.depositPaused) : "Unavailable",
            available ? status(row.withdrawPaused) : "Unavailable",
            available ? percent(row.managementFee, 18) : "",
            available ? percent(row.performanceFee, 18) : "",
            available ? "Read from contract" : "Unavailable",
            available ? row.blockNumber : "",
            available ? row.observedAt : "",
          ];
        }),
      ]),
      "thesauros-current-vaults.csv",
    );
  }

  return (
    <div className={p.product}>
      <div className={v.intro}>
        <p>
          The USDC vaults available in Earn, read from the same contracts as
          your account.
        </p>
        <div className={p.inlineActions}>
          <button
            className={p.secondaryButton}
            onClick={() => account.refresh()}
            disabled={account.loading}
          >
            {account.loading ? "Refreshing…" : "Refresh vaults"}
          </button>
          <button
            className={p.secondaryButton}
            onClick={exportVaults}
            disabled={!account.vaults.length}
          >
            Export CSV
          </button>
        </div>
      </div>
      {account.error && (
        <p className={`${p.stateMessage} ${p.error}`} role="status">
          {account.error}
        </p>
      )}
      <div className={p.twoColumn}>
        {vaults.map((vault) => {
          const row = account.vaults.find((item) => item.id === vault.id);
          const available = row?.status === "ready";
          return (
            <section
              className={`${p.marketCard} ${v.vaultCard}`}
              key={vault.id}
              aria-labelledby={"vault-card-" + vault.id}
              data-selected={vault.id === selected}
            >
              <div className={p.marketCardHead}>
                <img src={vault.icon} width="38" height="38" alt="" />
                <div>
                  <h2 id={"vault-card-" + vault.id} className={p.marketName}>
                    USDC on {vault.name}
                  </h2>
                  <p>Thesauros Earn vault</p>
                </div>
              </div>
              <dl className={p.marketMetrics}>
                <div className={p.metric}>
                  <dt className={p.metricLabel}>Current gross APR</dt>
                  <dd className={p.metricValue}>
                    {percent(available ? row.rateRay : null)}
                  </dd>
                </div>
                <div className={p.metric}>
                  <dt className={p.metricLabel}>Assets in vault · USDC</dt>
                  <dd className={p.metricValue}>
                    {displayAmount(available ? row.totalAssets : null)}
                  </dd>
                </div>
              </dl>
              <div className={v.cardFacts}>
                <div>
                  <span>Minimum deposit</span>
                  <strong>
                    {displayAmount(available ? row.minAssets : null)} USDC
                  </strong>
                </div>
                <div>
                  <span>Deposits / withdrawals</span>
                  <strong>
                    {available
                      ? status(row.depositPaused) +
                        " / " +
                        status(row.withdrawPaused)
                      : "Unavailable"}
                  </strong>
                </div>
                <div>
                  <span>Management / performance fee</span>
                  <strong>
                    {available
                      ? percent(row.managementFee, 18) +
                        " / " +
                        percent(row.performanceFee, 18)
                      : "—"}
                  </strong>
                </div>
              </div>
              <div className={p.cardFoot}>
                {!available && (
                  <p>{account.loading ? "Loading…" : "Network unavailable"}</p>
                )}
                <button
                  className={p.secondaryButton}
                  onClick={() => inspect(vault.id)}
                  aria-controls="current-vault-detail"
                >
                  View {vault.name} details
                </button>
              </div>
            </section>
          );
        })}
      </div>
      <p className={p.dataNote}>
        Gross APR is the allocation-weighted lending rate before vault fees and
        can change. Assets in a vault are not a guarantee of immediately
        available withdrawal liquidity.
      </p>

      <section
        id="current-vault-detail"
        ref={detail}
        tabIndex={-1}
        className={v.detail}
        aria-labelledby="current-vault-title"
      >
        <div className={p.sectionHeader}>
          <div>
            <span className={p.eyebrow}>Inside the vault</span>
            <h2 id="current-vault-title">USDC on {definition.name}</h2>
            <p className={p.sectionCopy}>
              The allocation and controls behind this Earn account.
            </p>
          </div>
          <button className={p.primaryButton} onClick={() => onEarn(selected)}>
            Go to Earn
          </button>
        </div>
        {!ready && (
          <div className={p.stateMessage} role="status">
            {account.loading
              ? "Reading the vault and its providers…"
              : snapshot?.error ||
                "This network did not respond. Refresh to try again."}{" "}
            Values remain unavailable until the contract can be read.
          </div>
        )}
        <div className={v.detailGrid}>
          <div>
            <h3 className={v.subheading}>Where capital is allocated</h3>
            <p className={p.sectionCopy}>
              A provider connects the vault to a lending market. Its balance
              shows how much of this vault’s capital is allocated there.
            </p>
            {providers.length > 0 ? (
              <div className={v.providerList}>
                {providers.map((provider, index) => {
                  const name = (provider.name || "Lending provider")
                    .replace(/_Provider$/, "")
                    .replaceAll("_", " ");
                  const share =
                    completeAllocation && allocated > 0n
                      ? Number((BigInt(provider.assets) * 10000n) / allocated) /
                        100
                      : null;
                  const logo = [
                    "aave",
                    "compound",
                    "morpho",
                    "moonwell",
                    "euler",
                    "spark",
                    "fluid",
                  ].find((item) => name.toLowerCase().includes(item));
                  return (
                    <details key={provider.address} className={v.provider}>
                      <summary>
                        <div className={v.providerIdentity}>
                          {logo ? (
                            <img
                              src={"/brand/protocols/" + logo + ".png"}
                              width="30"
                              height="30"
                              alt=""
                            />
                          ) : (
                            <span className={p.tokenIcon}>
                              {name.slice(0, 1)}
                            </span>
                          )}
                          <div>
                            <strong>{name}</strong>
                            <span>
                              {share == null
                                ? "Allocation share unavailable"
                                : share.toFixed(1) + "% of allocated capital"}
                            </span>
                          </div>
                        </div>
                        <div className={v.providerNumbers}>
                          <strong>
                            {displayAmount(provider.assets)} <small>USDC</small>
                          </strong>
                          <span>{percent(provider.rateRay)} supply APR</span>
                        </div>
                        <span className={v.providerMore}>Details</span>
                      </summary>
                      <div className={v.allocationTrack} aria-hidden="true">
                        <span
                          style={{
                            width: (share || 0) + "%",
                            background: [
                              "#245ddd",
                              "#789caf",
                              "#77a69d",
                              "#586879",
                            ][index % 4],
                          }}
                        />
                      </div>
                      <div className={v.providerDetail}>
                        <span>Provider contract</span>
                        <ContractLink
                          vault={definition}
                          address={provider.address}
                        />
                        <p>
                          This is a lending adapter used by the vault. Your
                          deposit is made to the Thesauros vault, rather than to
                          this adapter.
                        </p>
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : (
              <p className={`${p.stateMessage} ${v.providerEmpty}`}>
                {account.loading
                  ? "Reading provider allocations…"
                  : "Provider allocation is unavailable. The vault’s asset balance and controls are read separately."}
              </p>
            )}
            {ready && !snapshot.complete && (
              <p className={p.dataNote}>
                Some provider data could not be read. Missing amounts and rates
                are left unavailable.
              </p>
            )}
          </div>
          <aside className={v.controls} aria-labelledby="vault-controls-title">
            <h3 id="vault-controls-title" className={v.subheading}>
              Fees & availability
            </h3>
            <dl className={p.transactionDetails}>
              <div>
                <dt>Management fee</dt>
                <dd>{percent(ready ? snapshot.managementFee : null, 18)}</dd>
              </div>
              <div>
                <dt>Performance fee</dt>
                <dd>{percent(ready ? snapshot.performanceFee : null, 18)}</dd>
              </div>
              <div>
                <dt>Deposits</dt>
                <dd>{status(ready ? snapshot.depositPaused : null)}</dd>
              </div>
              <div>
                <dt>Withdrawals</dt>
                <dd>{status(ready ? snapshot.withdrawPaused : null)}</dd>
              </div>
              <div>
                <dt>Minimum deposit</dt>
                <dd>{displayAmount(ready ? snapshot.minAssets : null)} USDC</dd>
              </div>
            </dl>
            <p className={p.dataNote}>
              Management fees apply over time; performance fees apply to
              positive growth in the vault. These settings can change. A “not
              paused” status does not guarantee that a withdrawal can be filled.
            </p>
            <details className={v.controlDetails}>
              <summary>Who controls the vault?</summary>
              <p>
                Administrators can change fees and minimums, and pause deposits
                and withdrawals independently. Executors can move capital
                between configured providers. Provider-list changes use a
                timelock.
              </p>
              <p>
                The vault is an upgradeable proxy. An upgrade can change its
                implementation; the current interface checks the configured
                implementation before preparing a transaction.
              </p>
              <ContractLink vault={definition}>
                Inspect the vault contract
              </ContractLink>
            </details>
          </aside>
        </div>
        <details className={v.sourceDetails}>
          <summary>Contract details</summary>
          <div className={v.source}>
            <div>
              <span>Vault contract</span>
              <ContractLink vault={definition} />
            </div>
            <div>
              <span>Asset contract</span>
              <ContractLink vault={definition} address={definition.asset} />
            </div>
            <div>
              <span>Source</span>
              <strong>
                {ready
                  ? "Onchain block " + snapshot.blockNumber
                  : "Current contract data unavailable"}
              </strong>
              <small>
                {ready
                  ? observed(snapshot.observedAt)
                  : "Refresh to request a new reading"}
              </small>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
