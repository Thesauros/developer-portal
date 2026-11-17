"use client";
import { useMemo, useState } from "react";
import { CASH_COLOR, marketColor } from "../../../lib/vault-book.mjs";
import { DAY, measuredRate, pricePoints } from "../../../lib/vault-metrics.mjs";
import ActionPanel, { Notice, RequestRow, batchClosing } from "./ActionPanel";
import WhatIf from "./WhatIf";
import { AllocationBar, ComparisonChart, PriceChart } from "./charts";
import {
  compareLines,
  indexMarkers,
  PERIODS,
  viewLede,
  windowVerdict,
} from "./IndexPage";
import {
  ago,
  compact,
  MeasuredRate,
  money,
  pct,
  Section,
  Segmented,
  Stage,
  NetworkMarks,
  TokenMark,
  VsIndex,
} from "./parts";
import b from "./book.module.css";

// Earn is the page a deposit is decided on: what the vault pays and against
// what, where the money is lent, the terms, and the form. Everything that
// proves those figures (every market and its limit, the map by network, the
// results by vault, the contracts, every move) is in Transparency, in the
// open. Nothing on this page is folded away.

const listOf = (items) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);
// The line the product is compared by: what Thesauros earned for depositors.
const RECORD_NAME = "Thesauros USDC";

// How often a batch closes, from the open batch's own limits.
function batchEvery(vault) {
  const epoch = vault.epoch;
  if (!epoch?.openedAt || !epoch.earliestCloseAt || !epoch.latestCloseAt) return null;
  const hours = (seconds) => {
    const value = seconds / 3600;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  };
  const min = epoch.earliestCloseAt - epoch.openedAt;
  const max = epoch.latestCloseAt - epoch.openedAt;
  if (!(min > 0) || !(max >= min)) return null;
  return min === max ? `${hours(min)} hours` : `${hours(min)} to ${hours(max)} hours`;
}

function Header({ vault, product }) {
  const record = product.record;
  const every = batchEvery(vault);
  const longest = Math.max(0, ...(vault.gaps?.gaps || []).map((gap) => gap.hours));
  return (
    <header className={b.vaultHead}>
      <div className={b.vaultName}>
        <TokenMark token={vault.token} size={44} />
        <div>
          <h1 tabIndex={-1}>
            {vault.token} <span>{vault.product.tag}</span>
          </h1>
          <p>{vault.product.line}</p>
          <p className={b.headMeta}>
            <span className={b.quiet}>
              <NetworkMarks networks={vault.networks} size={14} />
              Lends on {listOf(vault.networks)}
            </span>
            <Stage stage={vault.stage} />
          </p>
        </div>
      </div>
      <dl className={b.facts}>
        <div>
          <dt>Rate now</dt>
          <dd>{pct(vault.rateNow)}</dd>
          <small>
            {vault.rateNow == null ? (
              "being read from the markets"
            ) : record.vs?.nowDiff != null ? (
              <VsIndex diff={record.vs.nowDiff} suffix=" vs Market Average" />
            ) : (
              "a year, before fees"
            )}
          </small>
        </div>
        <div>
          <dt>Thesauros, 30 days</dt>
          <dd>
            <MeasuredRate measure={record.measure} />
          </dd>
          <small>
            {record.vs?.r30Diff != null ? (
              <VsIndex diff={record.vs.r30Diff} suffix=" vs Market Average" />
            ) : (
              "all its USDC vaults, a year"
            )}
          </small>
        </div>
        <div>
          <dt>In the vault</dt>
          <dd>
            {compact(vault.tvl)} <small>{vault.token}</small>
          </dd>
          <small>
            {vault.batchLimit != null
              ? `up to ${money(vault.batchLimit, 0)} USDC per batch`
              : "read from the contract"}
          </small>
        </div>
        <div>
          <dt>Withdrawals</dt>
          <dd>In batches</dd>
          <small>
            {every ? `every ${every}` : "no time is promised"}
            {longest >= 24 ? `, longest wait ${Math.round(longest / 24)} days` : ""}
          </small>
        </div>
      </dl>
    </header>
  );
}

function ValuationBanner({ vault }) {
  const state = vault.valuation;
  if (!state || state.level === "ok" || state.level === "unknown") return null;
  const text =
    state.level === "stale"
      ? `The vault was last valued ${ago(state.ageSeconds)}. New requests and settlement wait until the next valuation.`
      : state.level === "frozen"
        ? "Settlement is paused while the vault’s valuation is frozen. New requests and settlements wait until it resumes."
        : "A valuation is under review. New requests and settlements wait until it is resolved.";
  return (
    <p className={b.banner} role="status">
      {text}
    </p>
  );
}

// One chart, three readings: the 30-day rate against the Market Average, what
// 10,000 earned, and the vault's own share price.
function Performance({ book, navigate }) {
  const { vault, product } = book;
  const index = product.index;
  const record = product.record;
  const measurable = record.measure.status === "ok";
  // Until the reader picks, the default follows the data as it arrives.
  const [picked, setTab] = useState(null);
  const tab = picked ?? (measurable ? "rate" : "price");
  const [days, setDays] = useState(30);
  const chained = record.measure.series || [];
  // The same window as the rate above, so a period never shows two answers.
  const window = days ? measuredRate(vault.samples, days) : null;
  const points = window?.from
    ? vault.samples.filter((point) => point.at >= window.from.at)
    : pricePoints(vault.samples, days);
  const first = points[0],
    last = points.at(-1);
  const change =
    window?.change ??
    (first && last && last !== first ? (last.price / first.price - 1) * 100 : null);
  const series = tab === "price" ? vault.samples : chained;
  const age = series.length ? (Date.now() - series[0].at) / 86400000 : 0;
  // The window ends where the index ends, so the index line is the same on
  // every page.
  const end = index?.series?.at(-1)?.at ?? chained.at(-1)?.at ?? Date.now();
  const from = days ? end - days * DAY : -Infinity;
  const v30 = days === 30 && measurable;
  const lines = useMemo(
    () =>
      compareLines(chained, index, RECORD_NAME, {
        oursRate: v30 ? record.measure.rate : null,
        indexRate: v30 ? record.vs?.r30 : null,
      }),
    [chained, index, record, v30],
  );
  const verdict = windowVerdict(lines, from);
  const periodControl = (
    <Segmented
      label="Period"
      value={days}
      onChange={setDays}
      options={PERIODS.map((range) => ({
        ...range,
        disabled: range.value && age < range.value * 0.5,
      }))}
    />
  );
  return (
    <Section
      id="performance"
      title="Performance"
      aside={
        <>
          <Segmented
            label="Chart"
            value={tab}
            onChange={setTab}
            options={[
              ...(measurable
                ? [
                    { value: "rate", label: "30-day rate" },
                    { value: "earned", label: "Earned" },
                  ]
                : []),
              { value: "price", label: "Share price" },
            ]}
          />
          {periodControl}
        </>
      }
    >
      {tab !== "price" ? (
        <>
          <p className={b.chartCaption}>
            {viewLede(
              tab,
              vault.token,
              lines[0]?.series?.find((point) => point.at >= from - DAY / 2)?.at ?? from,
            )}
            . Thesauros is all its USDC vaults, by size.
          </p>
          <ComparisonChart
            lines={lines}
            from={from}
            token={vault.token}
            markers={indexMarkers(index)}
            mode={tab}
          />
          <p className={b.verdictLine}>
            {verdict && (
              <>
                {days ? `Over ${days} days` : "Since launch"}: Thesauros{" "}
                {pct(verdict.ours)}, Market Average {pct(verdict.index)},{" "}
                <VsIndex diff={verdict.gap} />.{" "}
              </>
            )}
            <button className={b.linkButton} onClick={() => navigate("index")}>
              How this is measured
            </button>
          </p>
        </>
      ) : (
        <>
          <p className={b.chartCaption}>
            <strong>
              {vault.sharePrice != null ? vault.sharePrice.toFixed(6) : "—"}
            </strong>{" "}
            {vault.token} a share
            {change != null && (
              <span className={b.change}>
                {change >= 0 ? "+" : "−"}
                {Math.abs(change).toFixed(3)}%
                {days
                  ? ` over ${Math.round(window?.days ?? Math.max(1, (last.at - first.at) / DAY))} days`
                  : " since launch"}
              </span>
            )}
          </p>
          <PriceChart points={points} silenceMs={6 * 3600000} gapLabel="No valuation" />
          <p className={b.verdictLine}>
            What one share of this vault is worth: it rises as the markets pay
            interest. A dashed line marks a period with no valuation.
          </p>
        </>
      )}
    </Section>
  );
}

// Where the money is lent now, in four columns. Every approved market, its
// limit and the map by network are in Transparency.
function Lent({ vault }) {
  const total =
    vault.capital?.held ??
    vault.allocation.reduce((sum, row) => sum + (row.amount || 0), 0);
  // Positions under 0.1% of the vault are one line, not five rows of 0.0%.
  const big = vault.allocation.filter((row) => (row.share ?? 0) >= 0.1 || row.kind !== "market");
  const small = vault.allocation.filter((row) => row.kind === "market" && (row.share ?? 0) < 0.1);
  const rows =
    small.length > 1
      ? [
          ...big,
          {
            key: "small",
            kind: "rest",
            name: `${small.length} small positions`,
            amount: small.reduce((sum, row) => sum + (row.amount || 0), 0),
            share: small.reduce((sum, row) => sum + (row.share || 0), 0),
            rate: null,
          },
        ]
      : vault.allocation;
  return (
    <Section
      id="where"
      title="Where it is lent"
      lede="One deposit, lent across markets on several networks, with cash kept for withdrawals."
    >
      {rows.length ? (
        <>
          <AllocationBar rows={vault.allocation} height={10} />
          <div className={b.tableWrap}>
            <table className={`${b.table} ${b.lentTable}`}>
              <thead>
                <tr>
                  <th>Market</th>
                  <th className={b.num}>Rate now</th>
                  <th className={b.num}>Share</th>
                  <th className={`${b.num} ${b.wideOnly}`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className={b.market}>
                        <i
                          className={b.swatch}
                          style={{
                            background: row.kind === "market" ? marketColor(row.name) : CASH_COLOR,
                          }}
                        />
                        {row.logo && (
                          <img src={"/brand/protocols/" + row.logo + ".png"} width="18" height="18" alt="" />
                        )}
                        <span>
                          {row.name}
                          {row.network && row.kind !== "rest" && (
                            <small className={b.onNetwork}> {row.network}</small>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className={b.num}>{row.rate == null ? "—" : pct(row.rate)}</td>
                    <td className={b.num}>
                      {row.share == null
                        ? "—"
                        : row.share > 0 && row.share < 0.1
                          ? "under 0.1%"
                          : row.share.toFixed(1) + "%"}
                    </td>
                    <td className={`${b.num} ${b.wideOnly}`}>{compact(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>The vault</th>
                  <td className={b.num}>{pct(vault.rateNow)}</td>
                  <td className={b.num}>100%</td>
                  <td className={`${b.num} ${b.wideOnly}`}>
                    {compact(total)} {vault.token}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <p className={b.quiet}>This could not be read right now.</p>
      )}
    </Section>
  );
}

// Getting out and what it costs, as four facts.
function Terms({ vault }) {
  const fee = (value) => (value == null ? "—" : value.toFixed(2) + "%");
  const closing = batchClosing(vault);
  const limits = vault.limits;
  return (
    <Section id="terms" title="Terms">
      <dl className={b.terms}>
        <div>
          <dt>Open batch</dt>
          <dd>{closing?.late ? "Late" : vault.open.withdrawals ? "Open" : "Paused"}</dd>
          <small>
            {closing?.text ||
              "Requests settle together at the next valuation. No time is promised."}
          </small>
        </div>
        <div>
          <dt>Free cash now</dt>
          <dd>
            {money(vault.capital?.free)} <small>USDC</small>
          </dd>
          <small>A larger withdrawal waits for funds to return from other networks.</small>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{fee(vault.fees.performance)} now</dd>
          <small>
            Planned: {vault.fees.planned}% of yield, not charged yet. No
            management fee.
          </small>
        </div>
        <div>
          <dt>Deposit</dt>
          <dd>
            From {vault.minDeposit != null ? money(vault.minDeposit) : "—"}{" "}
            <small>{vault.token}</small>
          </dd>
          {limits?.maxEpochDeposits && (
            <small>
              Up to {money(Number(limits.maxEpochDeposits) / 1e6, 0)} USDC per
              batch, for all depositors together.
            </small>
          )}
        </div>
      </dl>
    </Section>
  );
}

// The way to everything that backs this page.
function More({ navigate }) {
  const to = (section) => () => navigate("transparency", null, { section });
  return (
    <nav className={b.more} aria-label="More about this vault">
      <span>In Transparency</span>
      <button onClick={to("markets")}>Markets and the map by network</button>
      <button onClick={to("results")}>Results by vault</button>
      <button onClick={to("contracts")}>Contracts</button>
      <button onClick={to("record")}>Every move</button>
    </nav>
  );
}

export default function VaultPage({ book, user, batch, navigate, intent }) {
  const { vault, product } = book;
  const active = vault.position.active || [];
  return (
    <div className={b.page}>
      <Header vault={vault} product={product} />
      <ValuationBanner vault={vault} />
      <div className={b.vaultLayout}>
        <div className={b.vaultMain}>
          {active.length > 0 && (
            <Section title="In progress">
              <div className={b.requests}>
                {active.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    price={batch.feed?.vault?.tick?.rateBid}
                    batch={batch}
                    closing={batchClosing(vault)}
                  />
                ))}
              </div>
            </Section>
          )}
          <Performance book={book} navigate={navigate} />
          <WhatIf book={book} navigate={navigate} />
          <Lent vault={vault} />
          <Terms vault={vault} />
          {/* Beside the form on a wide screen; here where the form is a sheet. */}
          <div className={b.sheetLayoutOnly}>
            <Notice vault={vault} />
          </div>
          <More navigate={navigate} />
        </div>
        <ActionPanel
          vault={vault}
          user={user}
          batch={batch}
          wallet={book.account.wallet}
          navigate={navigate}
          intent={intent}
        />
      </div>
    </div>
  );
}
