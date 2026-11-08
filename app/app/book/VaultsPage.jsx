"use client";
import { Fragment, useMemo, useState } from "react";
import { DAY, measuredRate } from "../../../lib/vault-metrics.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import { AllocationBar } from "./charts";
import { IndexComparison, INDEX_DEFINITION } from "./IndexPage";
import {
  compact,
  dateLabel,
  MeasuredRate,
  money,
  NetworkMarks,
  pct,
  ProductTitle,
  Section,
  Segmented,
  signed,
  Stage,
  TokenMark,
  VsIndex,
} from "./parts";
import b from "./book.module.css";

// The 30-day difference when there is one, otherwise today's, and it says which.
function IndexCell({ vs, measure }) {
  if (measure?.status === "ok" && vs?.r30Diff != null)
    return <VsIndex diff={vs.r30Diff} />;
  if (vs?.nowDiff != null)
    return (
      <span title="Rate now against the index rate now. The 30-day figure needs a larger vault.">
        <VsIndex diff={vs.nowDiff} /> <small className={b.quiet}>now</small>
      </span>
    );
  return <span className={b.quiet}>—</span>;
}

function NetworkCell({ networks, count }) {
  return (
    <span className={b.inlineMark}>
      <NetworkMarks networks={networks} size={16} />
      {count > 1 ? `${count} networks` : networks[0]}
    </span>
  );
}

function ProductRows({ product, navigate, showBalance, open, toggle }) {
  const many = product.vaults.length > 1;
  const go = () => navigate("vault", product.lead.id);
  return (
    <>
      <tr className={b.vaultRow} onClick={many ? toggle : go}>
        <td data-cell="vault">
          <div className={b.vaultCell}>
            <button
              className={b.rowLink}
              onClick={(event) => {
                event.stopPropagation();
                go();
              }}
            >
              <ProductTitle product={product} />
            </button>
          </div>
        </td>
        <td className={b.num} data-label="Rate now">
          {pct(product.rateNow)}
        </td>
        <td className={b.num} data-label="30-day rate">
          <MeasuredRate measure={product.measured.r30} />
        </td>
        <td className={b.num} data-label="Against the index">
          <IndexCell vs={product.vsIndex} measure={product.measured.r30} />
        </td>
        <td className={b.num} data-label="Total value">
          {compact(product.tvl)} <small>{product.token}</small>
        </td>
        <td data-label="Withdraw in">
          <span className={b.exit}>{product.exit.label}</span>
          <small className={b.quietBlock}>{product.exit.note}</small>
        </td>
        <td data-label="Deposit from">
          {many ? (
            <button
              className={b.expand}
              aria-expanded={open}
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
            >
              <NetworkCell
                networks={product.vaults.map((vault) => vault.place)}
                count={product.vaults.length}
              />
            </button>
          ) : (
            <NetworkCell
              networks={[product.lead.depositNetwork]}
              count={1}
            />
          )}
        </td>
        {showBalance && (
          <td className={b.num} data-label="Your balance">
            {product.position.balance > 0 ? money(product.position.balance) : "—"}
          </td>
        )}
      </tr>
      {many &&
        open &&
        product.vaults.map((vault) => (
          <tr
            key={vault.id}
            className={b.subRow}
            onClick={() => navigate("vault", vault.id)}
          >
            <td data-cell="vault">
              <div className={b.vaultCell}>
                <button
                  className={b.rowLink}
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate("vault", vault.id);
                  }}
                >
                  <span className={b.inlineMark}>
                    <NetworkMarks vault={vault} size={18} />
                    <span>
                      From {vault.place}
                      <AllocationBar rows={vault.allocation} height={4} />
                    </span>
                  </span>
                </button>
                <Stage stage={vault.stage} />
              </div>
            </td>
            <td className={b.num} data-label="Rate now">
              {pct(vault.rateNow)}
            </td>
            <td className={b.num} data-label="30-day rate">
              <MeasuredRate measure={vault.measured.r30} />
            </td>
            <td className={b.num} data-label="Against the index">
              <IndexCell vs={vault.vsIndex} measure={vault.measured.r30} />
            </td>
            <td className={b.num} data-label="Total value">
              {compact(vault.tvl)} <small>{vault.token}</small>
            </td>
            <td data-label="Withdraw in">
              <span className={b.exit}>{vault.exit.label}</span>
            </td>
            <td data-label="Deposit from">{vault.depositNetwork}</td>
            {showBalance && (
              <td className={b.num} data-label="Your balance">
                {vault.position.balance > 0 ? money(vault.position.balance) : "—"}
              </td>
            )}
          </tr>
        ))}
    </>
  );
}

export function Products({ book, navigate, user }) {
  const showBalance = !!user?.walletAddress;
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((last) => {
      const next = new Set(last);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className={b.tableWrap}>
      <table className={`${b.table} ${b.directory}`}>
        <thead>
          <tr>
            <th>Vault</th>
            <th className={b.num}>Rate now</th>
            <th className={b.num}>30-day rate</th>
            <th className={b.num}>Against the index</th>
            <th className={b.num}>Total value</th>
            <th>Withdraw in</th>
            <th>Deposit from</th>
            {showBalance && <th className={b.num}>Your balance</th>}
          </tr>
        </thead>
        <tbody>
          {book.products.map((product) => (
            <ProductRows
              key={product.id}
              product={product}
              navigate={navigate}
              showBalance={showBalance}
              open={open.has(product.id)}
              toggle={() => toggle(product.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 36500, label: "Since launch" },
];

// Growth between two moments of a chained level series, or null.
function growthBetween(series, fromAt, toAt) {
  const near = (at) =>
    (series || []).reduce(
      (best, point) =>
        Math.abs(point.at - at) <= 1.1 * DAY &&
        (!best || Math.abs(point.at - at) < Math.abs(best.at - at))
          ? point
          : best,
      null,
    );
  const a = near(fromAt),
    c = near(toAt);
  return a && c && c.at > a.at ? c.level / a.level - 1 : null;
}

// What a real amount would have done over a real period, for each vault and
// for the blue-chip index over exactly the same days.
function WhatIf({ book, navigate }) {
  const [amount, setAmount] = useState("5000");
  const [days, setDays] = useState(30);
  const value = Number(String(amount).replace(/[^\d.]/g, "")) || 0;
  const rows = useMemo(() => {
    const out = book.products.map((product) => {
      // The same calculation as each vault's own rate: its share price between
      // the readings nearest the period, added up by size.
      const parts = product.vaults
        .map((vault) => ({ vault, measure: measuredRate(vault.samples, days) }))
        .filter((part) => part.measure.from && part.vault.tvl > 0);
      const measured = parts.filter((part) => part.measure.status === "ok");
      const use = measured.length ? measured : parts.slice(0, 1);
      const total = use.reduce((sum, part) => sum + part.vault.tvl, 0);
      const change = total
        ? use.reduce((sum, part) => sum + part.vault.tvl * part.measure.change, 0) / total / 100
        : null;
      const window = use[0]?.measure;
      const indexChange =
        window && book.index
          ? growthBetween(book.index.series, window.from.at, window.to.at)
          : null;
      return {
        product,
        gain: change == null ? null : value * change,
        indexGain: indexChange == null ? null : value * indexChange,
        reliable: measured.length > 0,
        from: window?.from.at ?? null,
      };
    });
    return {
      measured: out.filter((row) => row.reliable),
      small: out.filter((row) => !row.reliable),
    };
  }, [book.products, book.index, days, value]);
  const lead = rows.measured[0];
  const maxGain = Math.max(
    ...[...rows.measured, ...rows.small].flatMap((row) => [row.gain ?? 0, row.indexGain ?? 0]),
    0.000001,
  );
  const bar = (gain, color, opacity = 1) => (
    <span className={b.gain}>
      <span className={b.gainTrack}>
        <i
          style={{
            width: Math.max((Math.max(gain, 0) / maxGain) * 100, 1) + "%",
            background: color,
            opacity,
          }}
        />
      </span>
      {signed(gain)}
    </span>
  );
  const productRow = ({ product, gain }) => (
    <tr key={product.id}>
      <td data-cell="vault">
        <button
          className={b.rowLink}
          onClick={() => navigate("vault", product.lead.id)}
        >
          <span className={b.vaultTitle}>
            <TokenMark token={product.token} size={22} />
            <strong>
              {product.token} <span className={b.tag}>{product.tag}</span>
            </strong>
          </span>
        </button>
      </td>
      <td data-label="Gain">
        {gain == null ? (
          <span className={b.quiet}>Not enough history</span>
        ) : (
          bar(gain, product.measured.r30.status === "ok" ? "var(--blue)" : "var(--ink-4)")
        )}
      </td>
      <td className={b.num} data-label="Value now">
        {gain == null ? "—" : money(value + gain)}
      </td>
      <td
        className={b.num}
        data-label={`After the planned ${PLANNED_PERFORMANCE_FEE}% fee`}
      >
        {gain == null
          ? "—"
          : money(value + gain * (1 - PLANNED_PERFORMANCE_FEE / 100))}
      </td>
    </tr>
  );
  return (
    <Section
      id="what-if"
      title="What if you had deposited"
      lede="Worked out from each vault’s real share price, and from the index over the same days. Past results; rates change."
      aside={
        <div className={b.controls}>
          <label className={b.inlineField}>
            <span className={b.amount}>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="Amount"
              />
              USD
            </span>
          </label>
          <Segmented
            label="Period"
            value={days}
            onChange={setDays}
            options={PERIODS}
          />
        </div>
      }
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.whatIf}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th>Gain</th>
              <th className={b.num}>Value now</th>
              <th className={b.num}>
                After the planned {PLANNED_PERFORMANCE_FEE}% fee
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.measured.map(productRow)}
            {lead?.indexGain != null && (
              <tr className={b.comparisonRow}>
                <td data-cell="vault">
                  <button className={b.rowLink} onClick={() => navigate("index")}>
                    Blue-chip index
                  </button>
                  <small className={b.quietBlock}>
                    same days{lead.from ? ", from " + dateLabel(lead.from, false) : ""}
                  </small>
                </td>
                <td data-label="Gain">{bar(lead.indexGain, "#5f7183", 0.55)}</td>
                <td className={b.num} data-label="Value now">
                  {money(value + lead.indexGain)}
                </td>
                <td className={b.num} data-label="After fees">
                  <span className={b.quiet}>no fee</span>
                </td>
              </tr>
            )}
            {rows.small.length > 0 && (
              <tr className={b.tableNote}>
                <td colSpan="4">
                  These hold too little for the result to be a reliable guide
                </td>
              </tr>
            )}
            {rows.small.map(productRow)}
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        No vault charges a fee today; the planned fee is shown for comparison.
        The index is a measure, not something you can deposit into. Network
        costs are not included.
      </p>
    </Section>
  );
}

export default function VaultsPage({ book, navigate, user }) {
  const { totals } = book;
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Earn</h1>
          <p className={b.pageLede}>
            Interest on stablecoins from approved lending markets: core lenders
            such as Aave and Compound, and curated Morpho vaults. Each vault
            moves its money to the better rate and shows where every dollar is.{" "}
            {money(totals.tvl, 0)} {totals.unit} in {book.products.length}{" "}
            products on {totals.networks} networks
            {Number.isFinite(totals.since)
              ? `, since ${dateLabel(totals.since, false)}`
              : ""}
            .
          </p>
        </div>
        {book.products[0] && (
          <div className={b.headActions}>
            <button
              className={b.primary}
              onClick={() =>
                navigate("vault", book.products[0].id, { action: "deposit" })
              }
            >
              Deposit {book.products[0].token}
            </button>
          </div>
        )}
      </header>
      <Section
        id="against-index"
        title="Against the blue-chip index"
        lede={
          <>
            <button className={b.linkButton} onClick={() => navigate("index")}>
              The blue-chip index
            </button>{" "}
            is the market average Thesauros measures itself against:{" "}
            {INDEX_DEFINITION.charAt(0).toLowerCase() + INDEX_DEFINITION.slice(1)}
          </>
        }
        className={b.firstSection}
      >
        <IndexComparison book={book} compact />
      </Section>
      <Section
        id="vaults"
        title="Vaults"
        lede="Choose the stablecoin and how fast you want to be able to leave. Where it is deposited is a detail inside."
      >
        <Products book={book} navigate={navigate} user={user} />
        <details className={b.disclosure}>
          <summary>
            How to read this table
            <small>Rate now, 30-day rate, the index, stages, withdrawals</small>
          </summary>
          <dl className={b.definitions}>
            <div>
              <dt>30-day rate</dt>
              <dd>
                What holders received over 30 days, from the share price, a
                year. Shown once a vault holds over 10,000 USD: below that, a
                cent would move it by whole points.
              </dd>
            </div>
            <div>
              <dt>Against the index</dt>
              <dd>
                The 30-day rate minus the blue-chip index for the same
                stablecoin over the same days, in percentage points. Where there
                is no 30-day rate, today’s rates are compared and marked “now”.
              </dd>
            </div>
            <div>
              <dt>Rate now</dt>
              <dd>
                Today’s lending rates read from the market contracts, weighted
                by where the money is, a year, before fees. Cash counts at 0%.
              </dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>
                Live: holds over 10,000 USD and runs code an outside firm has
                reviewed. Early: smaller, or its code review is not confirmed.
                Pilot: runs with team funds and has no external audit; outside
                deposits are not part of its plan yet. A product shows its
                largest vault’s stage; each network’s is on its page.
              </dd>
            </div>
            <div>
              <dt>Withdraw in</dt>
              <dd>
                Now: paid in one transaction, up to what the markets can pay.
                Next batch: requests settle together, then you collect. No time
                is promised.
              </dd>
            </div>
          </dl>
        </details>
      </Section>
      <WhatIf book={book} navigate={navigate} />
    </div>
  );
}
