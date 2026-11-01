"use client";
import { useMemo, useState } from "react";
import { CASH_COLOR, exposure } from "../../../lib/vault-book.mjs";
import { indexRate } from "../../../lib/vault-metrics.mjs";
import { AUDITS, PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import { marketingHref } from "../../../lib/site-links.mjs";
import { LedgerRows } from "./ledger";
import { vaultNamer } from "./activity";
import {
  compact,
  dateLabel,
  MeasuredRate,
  money,
  pct,
  Section,
  Segmented,
  short,
  Stage,
  usePublicResource,
  VaultTitle,
} from "./parts";
import b from "./book.module.css";

const SERIES = ["#196aff", "#0b1b2b", "#7fa7f5", "#5f7183", CASH_COLOR];

function Capital({ book, navigate }) {
  const { totals, vaults } = book;
  return (
    <Section
      id="capital"
      title="Capital"
      lede="Everything in Thesauros vaults, read from the contracts. USDC and USDT0 are added at face value."
    >
      <p className={b.totalLine}>
        <strong>
          {money(totals.tvl, 0)} <small>{totals.unit}</small>
        </strong>
        {!totals.complete && " at least; some vaults could not be read"}
      </p>
      <span className={b.allocationBar} style={{ height: 12 }} aria-hidden="true">
        {vaults
          .filter((vault) => vault.tvl > 0)
          .map((vault, index) => (
            <i
              key={vault.id}
              style={{
                flexGrow: Math.max((vault.tvl / totals.tvl) * 100, 0.8),
                background: SERIES[index % SERIES.length],
              }}
            />
          ))}
      </span>
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th>Stage</th>
              <th>Since</th>
              <th className={b.num}>Total value</th>
              <th className={b.num}>Share</th>
            </tr>
          </thead>
          <tbody>
            {vaults.map((vault, index) => (
              <tr key={vault.id}>
                <td data-cell="vault">
                  <button
                    className={b.rowLink}
                    onClick={() => navigate("vault", vault.id)}
                  >
                    <i
                      className={b.swatch}
                      style={{ background: SERIES[index % SERIES.length] }}
                    />
                    <VaultTitle vault={vault} size={22} />
                  </button>
                </td>
                <td data-label="Stage">
                  <Stage stage={vault.stage} />
                </td>
                <td data-label="Since">{dateLabel(vault.since)}</td>
                <td className={b.num} data-label="Total value">
                  {compact(vault.tvl)} <small>{vault.token}</small>
                </td>
                <td className={b.num} data-label="Share">
                  {totals.tvl && vault.tvl != null
                    ? ((vault.tvl / totals.tvl) * 100).toFixed(
                        vault.tvl / totals.tvl < 0.001 ? 3 : 1,
                      ) + "%"
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Exposure({ book }) {
  const [by, setBy] = useState("market");
  const rows = useMemo(
    () => exposure(book.vaults, (vault) => vault.tvl, by),
    [book.vaults, by],
  );
  return (
    <Section
      id="exposure"
      title="Exposure"
      lede="All capital by where it is lent now."
      aside={
        <Segmented
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            { value: "market", label: "Market" },
            { value: "network", label: "Network" },
          ]}
        />
      }
    >
      <span className={b.allocationBar} style={{ height: 12 }} aria-hidden="true">
        {rows.map((row, index) => (
          <i
            key={row.name}
            style={{
              flexGrow: Math.max(row.share, 0.8),
              background: row.color || SERIES[index % SERIES.length],
            }}
          />
        ))}
      </span>
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>{by === "market" ? "Market" : "Network"}</th>
              <th className={b.num}>Rate now</th>
              <th className={b.num}>Amount</th>
              <th className={b.num}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.name}>
                <td data-cell="vault">
                  <span className={b.market}>
                    <i
                      className={b.swatch}
                      style={{
                        background: row.color || SERIES[index % SERIES.length],
                      }}
                    />
                    {row.logo && (
                      <img
                        src={"/brand/protocols/" + row.logo + ".png"}
                        width="18"
                        height="18"
                        alt=""
                      />
                    )}
                    {row.icon && (
                      <img src={row.icon} width="18" height="18" alt="" />
                    )}
                    {row.name}
                  </span>
                </td>
                <td className={b.num} data-label="Rate now">
                  {pct(row.rate)}
                </td>
                <td className={b.num} data-label="Amount">
                  {compact(row.amount)}
                </td>
                <td className={b.num} data-label="Share">
                  {row.share.toFixed(row.share < 0.1 ? 3 : 1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Results({ book }) {
  const rows = book.vaults.map((vault) => {
    const m = vault.measured.r30;
    const benchmarkSource =
      vault.id === "arbitrum" || vault.id === "base"
        ? vault.samples
        : vault.kind === "batch"
          ? book.byId.base?.samples
          : null;
    const aave =
      benchmarkSource && m?.from
        ? indexRate(benchmarkSource, m.from.at, m.to.at)
        : null;
    return { vault, m, aave };
  });
  return (
    <Section
      id="results"
      title="Results"
      lede="What holders received, from each vault’s share price, against Aave V3 USDC on the network you deposit on, without rewards, over the same days. Both are simple annual rates."
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th className={b.num}>Share price, 30 days</th>
              <th className={b.num}>30-day rate</th>
              <th className={b.num}>Aave, same days</th>
              <th className={b.num}>Since reaching 10,000 USD</th>
              <th className={b.num}>Fee now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ vault, m, aave }) => (
              <tr key={vault.id}>
                <td data-cell="vault">
                  <VaultTitle vault={vault} size={22} />
                </td>
                <td className={b.num} data-label="Share price, 30 days">
                  {m?.change == null
                    ? "—"
                    : `${m.change >= 0 ? "+" : "−"}${Math.abs(m.change).toFixed(3)}%`}
                </td>
                <td className={b.num} data-label="30-day rate">
                  <MeasuredRate measure={m} />
                </td>
                <td className={b.num} data-label="Aave, same days">
                  {vault.onlyMarket
                    ? "Holds Aave only"
                    : aave == null
                      ? "—"
                      : pct(aave)}
                </td>
                <td className={b.num} data-label="Since reaching 10,000 USD">
                  {vault.measured.grown ? (
                    <>
                      {pct(vault.measured.grown.rate)}
                      <small className={b.quietBlock}>
                        from {dateLabel(vault.measured.grown.from, false)}
                      </small>
                    </>
                  ) : (
                    <span className={b.quiet}>Not reached</span>
                  )}
                </td>
                <td className={b.num} data-label="Fee now">
                  {vault.fees.performance == null
                    ? "—"
                    : pct(vault.fees.performance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        A rate is shown once a vault held over 10,000 USD for the whole period:
        below that, a cent would move it by whole points. Each vault’s raw share
        price change is shown either way.
      </p>
    </Section>
  );
}

function Operations({ book, name }) {
  const feed = usePublicResource("/api/vaults/feed", { refreshMs: 120000 });
  const gaps = (feed.data?.items || []).filter((item) => item.kind === "gap");
  const batch = book.vaults.find((vault) => vault.kind === "batch");
  return (
    <Section
      id="operations"
      title="Operating record"
      lede="Periods when a vault could not do its job. The full record of everything else is in Activity."
    >
      {batch?.gaps?.staleShare != null && (
        <p className={b.compare}>
          Since {dateLabel(batch.gaps.since)}, the {batch.token}{" "}
          {batch.networkLabel} vault’s valuation was out of date{" "}
          <strong>{batch.gaps.staleShare.toFixed(1)}%</strong> of the time. While
          it is, batches do not settle. This vault’s record is exact because it
          publishes a valuation every hour; the others have no equivalent signal.
        </p>
      )}
      {gaps.length ? (
        <LedgerRows rows={gaps} vaultName={name} />
      ) : (
        <p className={b.quiet}>
          {feed.loading ? "Loading…" : "No gaps recorded."}
        </p>
      )}
    </Section>
  );
}

function Security({ book }) {
  return (
    <Section
      id="security"
      title="Audits and control"
      lede="Who has reviewed the code, and who can change it."
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th>Reviewed by</th>
              <th>Who can change it</th>
              <th>Contract</th>
            </tr>
          </thead>
          <tbody>
            {book.vaults.map((vault) => (
              <tr key={vault.id}>
                <td data-cell="vault">
                  <VaultTitle vault={vault} size={22} />
                </td>
                <td data-label="Reviewed by">{vault.audit.label}</td>
                <td data-label="Who can change it">
                  {vault.kind === "batch"
                    ? "One team key, with no delay"
                    : "Vault administrators"}
                </td>
                <td data-label="Contract">
                  <a
                    href={vault.explorer + "/address/" + vault.address}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(vault.address)} ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        {AUDITS.map((audit) => `${audit.firm}, ${audit.date}`).join("; ")}. Full
        reports and vault controls are in the{" "}
        <a href={marketingHref("/security")}>security overview</a>.
      </p>
    </Section>
  );
}

function Fees() {
  return (
    <Section id="fees" title="Fees">
      <dl className={b.terms}>
        <div>
          <dt>Charged today</dt>
          <dd>0%</dd>
          <small>Read from each vault’s contract.</small>
        </div>
        <div>
          <dt>Planned</dt>
          <dd>{PLANNED_PERFORMANCE_FEE}% of yield</dd>
          <small>
            A performance fee. There is no management fee and no fee on
            principal.
          </small>
        </div>
      </dl>
    </Section>
  );
}

export default function TransparencyPage({ book, navigate }) {
  const name = useMemo(() => vaultNamer(book), [book]);
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Transparency</h1>
          <p className={b.pageLede}>
            How much is here, where it is, what it has earned, what has gone
            wrong and who is in control. For anyone deciding whether to trust
            these vaults.
          </p>
        </div>
      </header>
      <nav className={b.toc} aria-label="On this page">
        {[
          ["capital", "Capital"],
          ["exposure", "Exposure"],
          ["results", "Results"],
          ["operations", "Operating record"],
          ["security", "Audits and control"],
          ["fees", "Fees"],
        ].map(([id, label]) => (
          <a key={id} href={"#" + id}>
            {label}
          </a>
        ))}
      </nav>
      <Capital book={book} navigate={navigate} />
      <Exposure book={book} />
      <Results book={book} />
      <Operations book={book} name={name} />
      <Security book={book} />
      <Fees />
    </div>
  );
}
