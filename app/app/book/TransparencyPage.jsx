"use client";
import { useMemo, useState } from "react";
import { CASH_COLOR, exposure } from "../../../lib/vault-book.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import { Ledger } from "./ActivityPage";
import { VaultContracts, VaultMarkets } from "./VaultDetail";
import {
  compact,
  dateLabel,
  MeasuredRate,
  money,
  pct,
  Section,
  Segmented,
  short,
  NetworkMarks,
  VaultTitle,
  VsIndex,
} from "./parts";
import { indexWindowRate } from "../../../lib/blue-chip-index.mjs";
import b from "./book.module.css";

const SERIES = ["#196aff", "#0b1b2b", "#7fa7f5", "#5f7183", CASH_COLOR];

const VAULT_COLOR = "#196aff";
const PREVIOUS_COLOR = "#c98500";

// How much is in Thesauros: the vault, and what holders have not moved out of
// the vaults before it yet.
function Capital({ book, navigate }) {
  const [open, setOpen] = useState(false);
  const { totals, vault, previous } = book;
  const held = previous.filter((item) => (item.tvl ?? 0) >= 0.005);
  const all = (vault.tvl ?? 0) + totals.previousTvl;
  const unit = totals.previousUnit === "USDC" || !held.length ? "USDC" : "USD";
  // Shares that read right together: a sliver is "under 0.1%", and nothing
  // short of the whole rounds up to 100%.
  const share = (value) => {
    if (!all || value == null) return "—";
    const p = (value / all) * 100;
    if (p > 0 && p < 0.1) return "under 0.1%";
    if (p < 100 && p > 99.9) return "99.9%";
    return p.toFixed(1) + "%";
  };
  return (
    <Section
      id="capital"
      title="Capital"
      lede="Everything in Thesauros, read from the contracts: the vault, and what holders have not yet moved out of the vaults before it."
    >
      <p className={b.totalLine}>
        <strong>
          {money(all, 0)} <small>{unit}</small>
        </strong>
        {vault.tvl == null && " at least; the vault could not be read"}
      </p>
      <span className={b.allocationBar} style={{ height: 12 }} aria-hidden="true">
        {vault.tvl > 0 && (
          <i
            style={{
              flexGrow: Math.max((vault.tvl / all) * 100, 0.8),
              background: VAULT_COLOR,
            }}
          />
        )}
        {totals.previousTvl > 0 && (
          <i
            style={{
              flexGrow: Math.max((totals.previousTvl / all) * 100, 0.8),
              background: PREVIOUS_COLOR,
            }}
          />
        )}
      </span>
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Where</th>
              <th>Since</th>
              <th className={b.num}>Total value</th>
              <th className={b.num}>Share</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-cell="vault">
                <button className={b.rowLink} onClick={() => navigate("earn")}>
                  <i className={b.swatch} style={{ background: VAULT_COLOR }} />
                  <VaultTitle vault={vault} size={22} />
                </button>
              </td>
              <td data-label="Since">{dateLabel(vault.since)}</td>
              <td className={b.num} data-label="Total value">
                {compact(vault.tvl)} <small>{vault.token}</small>
              </td>
              <td className={b.num} data-label="Share">
                {share(vault.tvl)}
              </td>
            </tr>
            {held.length > 0 && (
              <tr>
                <td data-cell="vault">
                  <span className={b.inlineMark}>
                    <i className={b.swatch} style={{ background: PREVIOUS_COLOR }} />
                    Previous vaults, not yet moved
                  </span>
                </td>
                <td data-label="Since">
                  {dateLabel(Math.min(...held.map((item) => item.since ?? Infinity)))}
                </td>
                <td className={b.num} data-label="Total value">
                  {compact(totals.previousTvl)} <small>{totals.previousUnit}</small>
                </td>
                <td className={b.num} data-label="Share">
                  {share(totals.previousTvl)}
                </td>
              </tr>
            )}
            {held.length > 0 && (
              <tr className={b.toggleRow}>
                <td colSpan={4}>
                  <button
                    className={b.linkButton}
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                  >
                    {open ? "Hide the previous vaults" : `Each of the ${held.length} previous vaults`}
                  </button>
                </td>
              </tr>
            )}
            {open &&
              held.map((item) => (
                <tr key={item.id} className={b.subRow}>
                  <td data-cell="vault">
                    <span className={b.inlineMark}>
                      <NetworkMarks vault={item} size={16} />
                      {item.title}
                    </span>
                  </td>
                  <td data-label="Since">{dateLabel(item.since)}</td>
                  <td className={b.num} data-label="Total value">
                    {compact(item.tvl)} <small>{item.token}</small>
                  </td>
                  <td className={b.num} data-label="Share">
                    {share(item.tvl)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {held.length > 0 && (
        <p className={b.footnote}>
          Thesauros moved to one vault that lends across networks. Holders of
          the previous vaults move their own money; until they do it stays where
          it was, earning there.
        </p>
      )}
    </Section>
  );
}

function Exposure({ book }) {
  const [by, setBy] = useState("market");
  // Slivers under 0.1% fold into one line: each would otherwise be a card of
  // its own on a phone and say nothing.
  const rows = useMemo(() => {
    const all = exposure(book.vaults, (vault) => vault.tvl, by);
    const tiny = all.filter((row) => row.share < 0.1);
    if (tiny.length < 2) return all;
    const amount = tiny.reduce((sum, row) => sum + (row.amount || 0), 0);
    return [
      ...all.filter((row) => row.share >= 0.1),
      {
        name: `${tiny.length} positions under 0.1% each`,
        color: "#c3cad6",
        amount,
        share: tiny.reduce((sum, row) => sum + row.share, 0),
        rate:
          amount > 0
            ? tiny.reduce((sum, row) => sum + (row.amount || 0) * (row.rate || 0), 0) / amount
            : null,
      },
    ];
  }, [book.vaults, by]);
  return (
    <Section
      id="exposure"
      title="Exposure"
      lede="All of it, the vault and the previous vaults together, by where it is lent now."
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
                  {row.share > 0 && row.share < 0.1 ? "under 0.1%" : row.share.toFixed(1) + "%"}
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
      <td className={b.num} data-label="Market Average, same days">
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
              {grownIndex != null ? `; Market Average ${pct(grownIndex)}` : ""}
            </small>
          </>
        ) : (
          <span className={b.quiet}>Not reached</span>
        )}
      </td>
    </tr>
  );
}

function Results({ book, navigate }) {
  const [open, setOpen] = useState(false);
  const all = book.totals;
  const held = book.previous.filter((item) => (item.tvl ?? 0) >= 0.005);
  return (
    <Section
      id="results"
      title="Results"
      lede={
        <>
          What holders received, from share prices, against the{" "}
          <button className={b.linkButton} onClick={() => navigate("index")}>
            Market Average
          </button>{" "}
          over the same days. Simple annual rates, before fees; no vault charges
          a fee today.
        </>
      }
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th className={b.num}>30-day rate</th>
              <th className={b.num}>Market Average, same days</th>
              <th className={b.num}>Difference</th>
              <th className={b.num}>Since reaching 10,000 USD</th>
            </tr>
          </thead>
          <tbody>
            <tr className={b.totalRow}>
              <th data-cell="vault">Thesauros USDC, every vault by size</th>
              <td className={b.num} data-label="30-day rate">
                <MeasuredRate measure={all.measured.r30} />
              </td>
              <td className={b.num} data-label="Market Average, same days">
                {pct(all.vsIndex?.r30)}
              </td>
              <td className={b.num} data-label="Difference">
                <VsIndex diff={all.vsIndex?.r30Diff} />
              </td>
              <td />
            </tr>
            <ResultRow item={book.vault} title={<VaultTitle vault={book.vault} size={22} />} />
            {held.length > 0 && (
              <tr className={b.toggleRow}>
                <td colSpan={5}>
                  <button
                    className={b.linkButton}
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                  >
                    {open ? "Hide the previous vaults" : `Each of the ${held.length} previous vaults`}
                  </button>
                </td>
              </tr>
            )}
            {open &&
              held.map((item) => (
                <ResultRow
                  key={item.id}
                  sub
                  item={item}
                  title={
                    <span className={b.inlineMark}>
                      <NetworkMarks vault={item} size={16} />
                      {item.title}
                    </span>
                  }
                />
              ))}
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        The first line is the record the app compares with the Market Average:
        every USDC vault chained day by day and weighted by the money it held,
        so money that moves from a previous vault to the current one stays in
        one line. A single vault shows a rate once it held over 10,000 USD for
        the whole period; below that a cent would move it by whole points, so
        the raw share price change is shown instead.
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
          <small>Read from the vault’s contract.</small>
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
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Transparency</h1>
          <p className={b.pageLede}>
            How much is here, where it is lent, what it has earned and every
            move the vaults made, read from the contracts.
          </p>
        </div>
      </header>
      <nav className={b.toc} aria-label="On this page">
        {[
          ["capital", "Capital"],
          ["exposure", "Exposure"],
          ["markets", "Markets"],
          ["results", "Results"],
          ["contracts", "Contracts"],
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
      <Section
        id="markets"
        title={`${book.vault.title}, market by market`}
        lede="Every market the vault lends to or is approved to use, with its rate, share and limit. Each market’s rate times its share adds up to the vault’s rate."
      >
        <VaultMarkets vault={book.vault} index={book.product.index} />
      </Section>
      <Results book={book} navigate={navigate} />
      <Section
        id="contracts"
        title="Contracts"
        lede={`Where ${book.vault.title} lives, and every contract behind it.`}
      >
        <VaultContracts vault={book.vault} />
      </Section>
      <Fees />
      <Section
        id="record"
        title="Every move"
        lede="Everything the vault and the vaults before it did, from the contracts: money moved between markets and networks, with the rates on each side, batches settled and valuation gaps. No wallet appears here."
      >
        <Ledger book={book} scope="all" limit={10} />
      </Section>
    </div>
  );
}
