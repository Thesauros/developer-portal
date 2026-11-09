"use client";
import { Fragment, useMemo, useState } from "react";
import { CASH_COLOR, exposure } from "../../../lib/vault-book.mjs";
import { AUDITS, PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import { marketingHref } from "../../../lib/site-links.mjs";
import { LedgerRows } from "./ledger";
import { Ledger } from "./ActivityPage";
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
  NetworkMarks,
  ProductTitle,
  usePublicResource,
  VaultTitle,
  VsIndex,
} from "./parts";
import { indexWindowRate } from "../../../lib/blue-chip-index.mjs";
import b from "./book.module.css";

const SERIES = ["#196aff", "#0b1b2b", "#7fa7f5", "#5f7183", CASH_COLOR];

const PRODUCT_COLOR = {
  "usdc-instant": "#196aff",
  "usdc-multichain": "#8f5200",
  "usdt0-instant": "#0b8f7b",
};

function Capital({ book, navigate }) {
  const { totals, products } = book;
  const share = (value) =>
    totals.tvl && value != null
      ? ((value / totals.tvl) * 100).toFixed(value / totals.tvl < 0.001 ? 3 : 1) + "%"
      : "—";
  return (
    <Section
      id="capital"
      title="Capital"
      lede="Everything in Thesauros vaults, read from the contracts, by product and then by network. USDC and USDT0 are added at face value."
    >
      <p className={b.totalLine}>
        <strong>
          {money(totals.tvl, 0)} <small>{totals.unit}</small>
        </strong>
        {!totals.complete && " at least; some vaults could not be read"}
      </p>
      <span className={b.allocationBar} style={{ height: 12 }} aria-hidden="true">
        {products
          .filter((product) => product.tvl > 0)
          .map((product) => (
            <i
              key={product.id}
              style={{
                flexGrow: Math.max((product.tvl / totals.tvl) * 100, 0.8),
                background: PRODUCT_COLOR[product.id] || "#5f7183",
              }}
            />
          ))}
      </span>
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Stage</th>
              <th>Since</th>
              <th className={b.num}>Total value</th>
              <th className={b.num}>Share</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <Fragment key={product.id}>
                <tr>
                  <td data-cell="vault">
                    <button
                      className={b.rowLink}
                      onClick={() => navigate("vault", product.id)}
                    >
                      <i
                        className={b.swatch}
                        style={{ background: PRODUCT_COLOR[product.id] || "#5f7183" }}
                      />
                      <ProductTitle product={product} size={22} stage={false} />
                    </button>
                  </td>
                  <td data-label="Stage">
                    <Stage stage={product.stage} />
                  </td>
                  <td data-label="Since">
                    {dateLabel(Math.min(...product.vaults.map((vault) => vault.since ?? Infinity)))}
                  </td>
                  <td className={b.num} data-label="Total value">
                    {compact(product.tvl)} <small>{product.token}</small>
                  </td>
                  <td className={b.num} data-label="Share">
                    {share(product.tvl)}
                  </td>
                </tr>
                {product.vaults.length > 1 &&
                  product.vaults.map((vault) => (
                    <tr key={vault.id} className={b.subRow}>
                      <td data-cell="vault">
                        <span className={b.inlineMark}>
                          <NetworkMarks vault={vault} size={16} />
                          On {vault.place}
                        </span>
                      </td>
                      <td data-label="Stage">
                        <Stage stage={vault.stage} />
                      </td>
                      <td data-label="Since">{dateLabel(vault.since)}</td>
                      <td className={b.num} data-label="Total value">
                        {compact(vault.tvl)} <small>{vault.token}</small>
                      </td>
                      <td className={b.num} data-label="Share">
                        {share(vault.tvl)}
                      </td>
                    </tr>
                  ))}
              </Fragment>
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

function ResultRow({ item, sub = false, title }) {
  const m = item.measured.r30;
  const grown = item.measured.grown;
  const grownIndex =
    grown && item.index
      ? indexWindowRate(item.index, grown.from, grown.to ?? item.measured.r30?.to?.at ?? Date.now())
      : null;
  return (
    <tr className={sub ? b.subRow : undefined}>
      <td data-cell="vault">{title}</td>
      <td className={b.num} data-label="30-day rate">
        <MeasuredRate measure={m} />
        {m?.status !== "ok" && m?.change != null && (
          <small className={b.quietBlock}>
            share price {m.change >= 0 ? "+" : "−"}
            {Math.abs(m.change).toFixed(3)}%
          </small>
        )}
      </td>
      <td className={b.num} data-label="Index, same days">
        {pct(item.vsIndex?.r30)}
      </td>
      <td className={b.num} data-label="Difference">
        <VsIndex diff={item.vsIndex?.r30Diff} />
      </td>
      <td className={b.num} data-label="Since reaching 10,000 USD">
        {grown ? (
          <>
            {pct(grown.rate)}
            <small className={b.quietBlock}>
              from {dateLabel(grown.from, false)}
              {grownIndex != null ? `; index ${pct(grownIndex)}` : ""}
            </small>
          </>
        ) : sub || item.vaults ? (
          <span className={b.quiet}>Not reached</span>
        ) : (
          <span className={b.quiet}>Not reached</span>
        )}
      </td>
    </tr>
  );
}

function Results({ book, navigate }) {
  const all = book.totals;
  return (
    <Section
      id="results"
      title="Results"
      lede={
        <>
          What holders received, from share prices, against the{" "}
          <button className={b.linkButton} onClick={() => navigate("index")}>
            blue-chip index
          </button>{" "}
          for the same stablecoin over the same days. Simple annual rates,
          before fees; no vault charges a fee today.
        </>
      }
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Product</th>
              <th className={b.num}>30-day rate</th>
              <th className={b.num}>Index, same days</th>
              <th className={b.num}>Difference</th>
              <th className={b.num}>Since reaching 10,000 USD</th>
            </tr>
          </thead>
          <tbody>
            {book.products.map((product) => (
              <Fragment key={product.id}>
                <ResultRow
                  item={{
                    ...product,
                    measured: {
                      ...product.measured,
                      grown:
                        product.vaults.length === 1
                          ? product.vaults[0].measured.grown
                          : product.lead.measured.grown,
                    },
                    index: product.index,
                  }}
                  title={<ProductTitle product={product} size={22} />}
                />
                {product.vaults.length > 1 &&
                  product.vaults.map((vault) => (
                    <ResultRow
                      key={vault.id}
                      sub
                      item={vault}
                      title={
                        <span className={b.inlineMark}>
                          <NetworkMarks vault={vault} size={16} />
                          On {vault.place}
                        </span>
                      }
                    />
                  ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th data-cell="vault">All USDC vaults, weighted by size</th>
              <td className={b.num} data-label="30-day rate">
                <MeasuredRate measure={all.measured.r30} />
              </td>
              <td className={b.num} data-label="Index, same days">
                {pct(all.vsIndex?.r30)}
              </td>
              <td className={b.num} data-label="Difference">
                <VsIndex diff={all.vsIndex?.r30Diff} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={b.footnote}>
        A rate is shown once a vault held over 10,000 USD for the whole period:
        below that, a cent would move it by whole points, so the raw share price
        change is shown instead. A product’s “since 10,000 USD” is its largest
        vault’s.
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
      lede="Periods when a vault could not do its job. Every other move is in the record at the end of this page."
    >
      {batch?.gaps?.staleShare != null && (
        <p className={b.compare}>
          Since {dateLabel(batch.gaps.since)}, the {batch.title} vault’s
          valuation was out of date{" "}
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
            {book.products.flatMap((product) => product.vaults).map((vault) => (
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
          ["record", "Every move"],
        ].map(([id, label]) => (
          <a key={id} href={"#" + id}>
            {label}
          </a>
        ))}
      </nav>
      <Capital book={book} navigate={navigate} />
      <Exposure book={book} />
      <Results book={book} navigate={navigate} />
      <Operations book={book} name={name} />
      <Security book={book} />
      <Fees />
      <Section
        id="record"
        title="Every move"
        lede="Everything the vaults did, from the contracts: money moved between markets and networks, with the rates on each side, batches settled and valuation gaps. No wallet appears here."
      >
        <Ledger book={book} scope="all" limit={10} />
      </Section>
    </div>
  );
}
