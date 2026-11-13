"use client";
import { useMemo, useState } from "react";
import { allMarkets } from "../../../lib/crosschain-feed.mjs";
import { CASH_COLOR, marketColor } from "../../../lib/vault-book.mjs";
import { DAY, measuredRate, pricePoints } from "../../../lib/vault-metrics.mjs";
import { weeklyGaps } from "../../../lib/blue-chip-index.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import ActionPanel, { RequestRow, batchClosing } from "./ActionPanel";
import WhatIf from "./WhatIf";
import {
  AllocationBar,
  AllocationHistory,
  ComparisonChart,
  GapChart,
  MoneyMap,
  PriceChart,
} from "./charts";
import { groupEvents, LedgerRows } from "./ledger";
import {
  compareLines,
  curatedShare,
  GapSplit,
  indexMarkers,
  PERIODS,
  referenceNote,
  viewLede,
  windowVerdict,
} from "./IndexPage";
import {
  ago,
  clock,
  compact,
  dateLabel,
  MeasuredRate,
  money,
  pct,
  Section,
  Segmented,
  short,
  Tier,
  usePublicResource,
  NetworkMarks,
  TokenMark,
  VsIndex,
  MeasureNote,
} from "./parts";
import b from "./book.module.css";



const listOf = (items) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);
const listNetworks = (rows) =>
  "On " + [...new Set(rows.map((row) => row.network))].join(", ");
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

function Header({ vault, product, totals }) {
  const record = product.record;
  const every = batchEvery(vault);
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
              Lends on {listOf(vault.networks)} · deposit and withdraw on{" "}
              {vault.depositNetwork}
            </span>
          </p>
        </div>
      </div>
      <dl className={b.facts}>
        <div>
          <dt>Rate now</dt>
          <dd>{pct(vault.rateNow)}</dd>
          <small>
            {record.vs?.nowDiff != null ? (
              <VsIndex diff={record.vs.nowDiff} suffix=" vs the Market Average" />
            ) : (
              "quoted by its markets, a year, before fees"
            )}
          </small>
        </div>
        <div>
          <dt>Earned, last 30 days</dt>
          <dd>
            <MeasuredRate measure={record.measure} />
          </dd>
          <small>
            {record.vs?.r30Diff != null ? (
              <VsIndex diff={record.vs.r30Diff} suffix=" vs the Market Average" />
            ) : record.measure?.status === "small" ? (
              "too small to measure: under 10,000 USD"
            ) : record.measure?.status === "young" ? (
              "too new to measure"
            ) : (
              "a year, from share prices"
            )}
          </small>
        </div>
        <div>
          <dt>In the vault</dt>
          <dd>
            {compact(vault.tvl)} <small>{vault.token}</small>
          </dd>
          {totals.previousTvl >= 1 && (
            <small>
              {compact(totals.previousTvl)} {totals.previousUnit} more in
              previous vaults
            </small>
          )}
        </div>
        <div>
          <dt>Withdraw in</dt>
          <dd>{vault.exit.label}</dd>
          <small>{every ? `a batch closes every ${every}` : vault.exit.note}</small>
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

// One sentence against the Market Average on the same days.
function Comparison({ record, index }) {
  const m = record.measure;
  const indexRate = record.vs?.r30;
  if (m?.status !== "ok") return null;
  const days = Math.round(m.days ?? 30);
  const after = m.rate * (1 - PLANNED_PERFORMANCE_FEE / 100);
  return (
    <p className={b.compare}>
      Over the last {days} days {RECORD_NAME} paid <strong>{pct(m.rate)}</strong>{" "}
      a year, or {pct(after)} after the planned {PLANNED_PERFORMANCE_FEE}% fee,
      which is not charged today.{" "}
      {indexRate != null && (
        <>
          The {index?.symbol || "USDC"} Market Average paid{" "}
          <strong>{pct(indexRate)}</strong> over the same days:{" "}
          <VsIndex diff={record.vs.r30Diff} />.
        </>
      )}
    </p>
  );
}

function GapBlock({ record, vaults }) {
  const local = record.local;
  if (local?.selection == null || local?.place == null) return null;
  // Folded: the split names the networks, and the network is detail.
  return (
    <details className={`${b.disclosure} ${b.gapDisclosure}`}>
      <summary>
        Where the 30-day gap comes from
        <small>Market choice and network</small>
      </summary>
      <GapSplit
        local={local}
        total={record.vs?.r30Diff}
        curated={curatedShare(vaults)}
      />
    </details>
  );
}

// One row of choices: the comparison as 30-day rates or as what 10,000 earned,
// then the vault's own share price. The period sits with the chart.
function Performance({ book }) {
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
  const gaps = useMemo(() => weeklyGaps(chained, index, from), [chained, index, from]);
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
        <Segmented
          label="Chart"
          value={tab}
          onChange={setTab}
          options={[
            ...(measurable
              ? [
                  { value: "rate", label: "Rate vs Market Average" },
                  { value: "earned", label: "Earned vs Market Average" },
                ]
              : []),
            { value: "price", label: "Share price" },
          ]}
        />
      }
    >
      {tab !== "price" ? (
        <>
          <div className={b.priceHead}>
            <p className={b.quiet}>
              {viewLede(
                tab,
                vault.token,
                lines[0]?.series?.find((point) => point.at >= from - DAY / 2)?.at ?? from,
              )}
            </p>
            {periodControl}
          </div>
          <ComparisonChart
            lines={lines}
            from={from}
            token={vault.token}
            markers={indexMarkers(index)}
            mode={tab}
          />
          {verdict && (
            <p className={b.verdictLine}>
              {days ? `Over ${days} days` : "Since launch"}: {RECORD_NAME}{" "}
              {pct(verdict.ours)}, the Market Average {pct(verdict.index)},{" "}
              <VsIndex diff={verdict.gap} />.
            </p>
          )}
          <MeasureNote>
            {RECORD_NAME} is what Thesauros earned for depositors: this vault
            and the vaults before it, chained day by day and weighted by the
            money each held, from share prices.{" "}
            {record.own
              ? ""
              : "Until depositors move, most of that money is in the previous vaults, so most of this line is theirs. "}
            Market Average: what its markets paid, weighted by size.{" "}
            {referenceNote(index)} Interest only, before fees.
          </MeasureNote>
          <details className={b.disclosure}>
            <summary>Week by week against the Market Average</summary>
            <GapChart points={gaps} label={RECORD_NAME} />
            <p className={b.footnote}>
              Each bar is that week’s part of the gap, in points; together they
              add up to the gap over the period. The first bar may cover fewer
              than seven days.
            </p>
          </details>
          <Comparison record={record} index={index} />
          <GapBlock record={record} vaults={book.vaults} />
        </>
      ) : (
        <>
          <div className={b.priceHead}>
            <p>
              <strong>
                {vault.sharePrice != null ? vault.sharePrice.toFixed(6) : "—"}
              </strong>{" "}
              {vault.token} a share
              {change != null && (
                <span className={b.change}>
                  {change >= 0 ? "+" : "−"}
                  {Math.abs(change).toFixed(3)}%
                  {window?.days ? ` over ${Math.round(window.days)} days` : " since launch"}
                </span>
              )}
            </p>
            {periodControl}
          </div>
          <PriceChart points={points} silenceMs={6 * 3600000} gapLabel="No valuation" />
          <MeasureNote>
            What one share of this vault is worth. It rises as the markets pay
            interest, so holders earn without receiving anything. A dashed line
            marks a period with no valuation.
            {measurable
              ? ""
              : " The vault holds too little for a yearly rate from this price to mean much yet."}
          </MeasureNote>
        </>
      )}
    </Section>
  );
}

function ApprovedMarkets({ vault }) {
  const [all, setAll] = useState(false);
  const rows = vault.capital ? allMarkets(vault.capital) : null;
  const notUsed = rows ? rows.filter((row) => !(row.amount > 0)) : [];
  const showLimit = !!vault.capital;
  const many = vault.networks.length > 1;
  // The rows add up to the total: it is their sum, from the same reading.
  const total =
    vault.capital?.held ??
    vault.allocation.reduce((sum, row) => sum + (row.amount || 0), 0);
  // Positions under 0.1% of the vault are one line, not five rows of 0.0%.
  const big = vault.allocation.filter((row) => (row.share ?? 0) >= 0.1 || row.kind !== "market");
  const small = vault.allocation.filter((row) => row.kind === "market" && (row.share ?? 0) < 0.1);
  const inUse = small.length > 1
    ? [
        ...big,
        {
          key: "small",
          kind: "rest",
          name: `${small.length} small positions`,
          note: listNetworks(small),
          amount: small.reduce((sum, row) => sum + (row.amount || 0), 0),
          share: small.reduce((sum, row) => sum + (row.share || 0), 0),
          rate:
            small.reduce((sum, row) => sum + (row.amount || 0), 0) > 0
              ? small.reduce((sum, row) => sum + (row.amount || 0) * (row.rate || 0), 0) /
                small.reduce((sum, row) => sum + (row.amount || 0), 0)
              : null,
        },
      ]
    : vault.allocation;
  const outside = inUse.filter((row) => row.kind === "market" && row.inIndex === false);
  // The current rate, added up so nobody has to take it on trust.
  const sum = inUse
    .filter((row) => row.rate != null && (row.share || 0) > 0)
    .map((row) => ({ rate: row.rate, share: row.share }));
  return (
    <>
      {notUsed.length > 0 && (
        <div className={b.controlsRow}>
          <Segmented
            label="Markets shown"
            value={all}
            onChange={setAll}
            options={[
              { value: false, label: `In use (${rows.length - notUsed.length})` },
              { value: true, label: `All approved (${rows.length})` },
            ]}
          />
        </div>
      )}
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Market</th>
              <th className={b.num}>Rate now</th>
              <th className={b.num}>Amount</th>
              <th className={b.num}>Share</th>
              <th className={b.num} title="Rate times share: what this market adds to the vault's rate">
                Adds
              </th>
              <th className={b.num} title="How much of the whole market this vault's money is">
                Of the market
              </th>
            </tr>
          </thead>
          <tbody>
            {inUse.map((row) => (
              <tr key={row.key}>
                <td data-cell="vault">
                  <span className={b.market}>
                    <i
                      className={b.swatch}
                      style={{
                        background:
                          row.kind === "market"
                            ? marketColor(row.name)
                            : CASH_COLOR,
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
                    {row.address ? (
                      <a
                        href={row.explorer + "/address/" + row.address}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.name}
                      </a>
                    ) : (
                      row.name
                    )}
                  </span>
                  <span className={b.marketMeta}>
                    {many && row.kind !== "rest" && <span>{row.network}</span>}
                    {row.tier && <Tier tier={row.tier} />}
                    {row.inIndex === false && (
                      <small
                        className={b.outside}
                        title="Under 1 million USD, so the Market Average leaves it out"
                      >
                        not in the Market Average
                      </small>
                    )}
                    {row.note && <span>{row.note}</span>}
                    {showLimit && row.limit > 0 && <span>limit {row.limit}%</span>}
                  </span>
                </td>
                <td className={b.num} data-label="Rate now">
                  {row.rate == null ? "—" : pct(row.rate)}
                </td>
                <td className={b.num} data-label="Amount">
                  {compact(row.amount)}
                </td>
                <td className={b.num} data-label="Share">
                  {row.share == null
                    ? "—"
                    : row.share > 0 && row.share < 0.1
                      ? "under 0.1%"
                      : row.share.toFixed(1) + "%"}
                </td>
                <td className={b.num} data-label="Adds">
                  {row.rate != null && row.share != null
                    ? pct((row.rate * row.share) / 100)
                    : "—"}
                </td>
                <td className={b.num} data-label="Of the market">
                  {row.shareOfMarket == null
                    ? "—"
                    : row.shareOfMarket < 0.01
                      ? "<0.01%"
                      : row.shareOfMarket.toFixed(2) + "%"}
                </td>
              </tr>
            ))}
            {all &&
              notUsed.map((row) => (
                <tr key={row.key} className={b.dim}>
                  <td data-cell="vault">
                    <span className={b.market}>
                      <i
                        className={b.swatch}
                        style={{ background: marketColor(row.name) }}
                      />
                      {row.logo && (
                        <img
                          src={"/brand/protocols/" + row.logo + ".png"}
                          width="18"
                          height="18"
                          alt=""
                        />
                      )}
                      <a
                        href={row.explorer + "/address/" + row.address}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.name}
                      </a>
                    </span>
                    <span className={b.marketMeta}>
                      {many && <span>{row.network}</span>}
                      <Tier tier={row.tier} />
                    </span>
                  </td>

                  <td className={b.num} data-label="Rate now">
                    {pct(row.rate)}
                  </td>
                  <td className={b.num} data-label="Amount">
                    —
                  </td>
                  <td className={b.num} data-label="Share">
                    —
                  </td>
                  <td className={b.num} data-label="Adds">
                    —
                  </td>
                  <td className={b.num} data-label="Of the market">
                    —
                  </td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <th data-cell="vault">
                Everything the vault holds
              </th>
              <td className={b.num} data-label="Rate now">
                {pct(vault.rateNow)}
              </td>
              <td className={b.num} data-label="Amount">
                {compact(total)} {vault.token}
              </td>
              <td className={b.num} data-label="Share">
                100%
              </td>
              <td className={b.num} data-label="Adds">
                {pct(vault.rateNow)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {outside.length > 0 && (
        <p className={b.compare}>
          {outside
            .map((row) => `${row.name} on ${row.network}`)
            .join(" and ")}{" "}
          {outside.length === 1 ? "holds" : "hold"}{" "}
          <strong>
            {pct(outside.reduce((sum, row) => sum + (row.share || 0), 0), 0)}
          </strong>{" "}
          of this vault but {outside.length === 1 ? "is" : "are"} under 1
          million USD, so the Market Average leaves{" "}
          {outside.length === 1 ? "it" : "them"} out. The vault is{" "}
          {outside
            .map((row) => `${(row.shareOfMarket ?? 0).toFixed(1)}%`)
            .join(" and ")}{" "}
          of {outside.length === 1 ? "that market" : "those markets"}.
        </p>
      )}
      {vault.ratesAt && (
        <MeasureNote label="Where these rates come from">
          Rates read from the market contracts at {clock(vault.ratesAt)}, the
          same readings the Market Average uses. A sudden jump in a quote
          counts only once a second reading confirms it.
        </MeasureNote>
      )}
      {sum.length > 1 && sum.length <= 6 && vault.rateNow != null && (
        <details className={b.disclosure}>
          <summary>How the rate adds up</summary>
          <p className={b.sum}>
            {sum
              .map((row) => `${pct(row.rate)} × ${row.share.toFixed(1)}%`)
              .join(" + ")}{" "}
            = <strong>{pct(vault.rateNow)}</strong>
          </p>
        </details>
      )}
    </>
  );
}

// How much sits with the core lenders and how much in curated vaults, beside the
// same split of the index, so a higher rate is read with its risk.
function TierSplit({ vault, index }) {
  const lent = vault.allocation.filter((row) => row.kind === "market" && row.amount > 0);
  const total = lent.reduce((sum, row) => sum + row.amount, 0);
  if (!total || !index?.constituents?.length) return null;
  const ours = (lent.filter((row) => row.tier === "core").reduce((s, r) => s + r.amount, 0) / total) * 100;
  if (ours > 99.5) return null; // all with core lenders: nothing extra to explain
  const theirs = index.constituents
    .filter((row) => row.protocol === "Aave" || row.protocol === "Compound")
    .reduce((sum, row) => sum + row.weight, 0);
  return (
    <p className={b.compare}>
      Where a higher rate can come from: this vault lends{" "}
      <strong>{pct(ours, 0)}</strong> to core lenders (Aave, Compound) and{" "}
      <strong>{pct(100 - ours, 0)}</strong> to curated Morpho vaults. The
      Market Average is <strong>{pct(theirs, 0)}</strong> core. Curated vaults
      usually pay more because they lend against a wider set of collateral.
    </p>
  );
}

function WhereTheMoneyIs({ vault, index }) {
  const limits = vault.limits;
  const buffer = limits?.minimumBuffer ? Number(limits.minimumBuffer) / 1e6 : null;
  const ratio = limits?.minBufferRatio
    ? Number(limits.minBufferRatio) / 1e16
    : null;
  return (
    <Section
      id="where"
      title="Where the yield comes from"
      lede="One deposit, lent across markets on several networks, with cash kept for withdrawals. Each market’s rate times its share adds up to the vault’s rate."
    >
      {vault.allocation.length ? (
        <>
          <AllocationBar rows={vault.allocation} height={10} />
          <ApprovedMarkets vault={vault} />
          {vault.local?.selection == null && <TierSplit vault={vault} index={index} />}
          {vault.allocationHistory && (
            <details className={b.disclosure}>
              <summary>
                How the split changed
                <small>One reading a day, from the contracts</small>
              </summary>
              <AllocationHistory history={vault.allocationHistory} />
            </details>
          )}
          <details className={b.disclosure}>
            <summary>
              Map by network
              <small>How the money is split across {listOf(vault.networks)}</small>
            </summary>
            <MoneyMap vault={vault} />
          </details>
          {buffer != null && (
            <p className={b.footnote}>
              The vault keeps at least {money(buffer)} {vault.token}
              {ratio != null ? ` or ${ratio.toFixed(0)}% of its value` : ""} as
              cash where it takes deposits. At this size that floor is a large
              part of the vault, which pulls the rate down; it weighs less as
              the vault grows.
            </p>
          )}
          {vault.capital && (vault.capital.pendingDeposits > 0 || vault.capital.owed > 0) && (
            <p className={b.footnote}>
              Deposits waiting to settle and withdrawals already owed are shown
              but not counted as capital at work.
            </p>
          )}
          <MeasureNote label="What Core and Satellite mean">
            Core: Aave and Compound. Satellite: curated Morpho vaults. Every
            approved market of 1 million USD or more is a member of the
            Market Average.
          </MeasureNote>
        </>
      ) : (
        <p className={b.quiet}>This could not be read right now.</p>
      )}
    </Section>
  );
}

function GettingOut({ vault, feedItems }) {
  const closing = batchClosing(vault);
  const limits = vault.limits;
  const batches = feedItems.filter((item) => item.kind === "batch");
  const gaps = feedItems.filter((item) => item.kind === "gap");
  return (
    <Section
      id="exit"
      title="Getting your money out"
      lede="Requests are collected into a batch and settled together at the next valuation. Then you collect the result."
    >
      <dl className={b.terms}>
        <div>
          <dt>Free cash now</dt>
          <dd>
            {money(vault.capital?.free)} <small>USDC</small>
          </dd>
          <small>
            A larger withdrawal waits for funds to return from other networks.
          </small>
        </div>
        <div>
          <dt>Open batch</dt>
          <dd>{closing?.late ? "Late" : "Open"}</dd>
          <small>{closing?.text}</small>
        </div>
        <div>
          <dt>How long it takes</dt>
          <dd>No time promised</dd>
          <small>
            {batches.length
              ? `${batches.reduce((sum, batch) => sum + batch.requests, 0)} requests so far, not enough for a typical time. `
              : ""}
            A batch settles only with a fresh valuation.
          </small>
        </div>
        <div>
          <dt>Withdrawals</dt>
          <dd>{vault.open.withdrawals ? "Open" : "Paused"}</dd>
          {limits?.maxInstantWithdrawal && (
            <small>
              The contract also allows an instant exit of up to{" "}
              {money(Number(limits.maxInstantWithdrawal) / 1e6, 0)} USDC at a{" "}
              {(Number(limits.instantFee) / 1e16).toFixed(2)}% fee; that
              route is not open here.
            </small>
          )}
        </div>
      </dl>
      <p className={b.footnote}>
        After a batch settles, your deposit earns whether or not you have
        collected it. A settled withdrawal has a fixed value and earns nothing
        while it waits.
      </p>
      {gaps.length > 0 && (
        <details className={b.disclosure}>
          <summary>
            When settlement had to wait
            <small>
              {vault.gaps?.staleShare != null
                ? `No fresh valuation ${vault.gaps.staleShare.toFixed(1)}% of the time since ${dateLabel(vault.gaps.since, false)}`
                : `${gaps.length} periods`}
            </small>
          </summary>
          <LedgerRows rows={gaps} hideVault />
        </details>
      )}
    </Section>
  );
}

function MoneyMoved({ vault, feed }) {
  const items = (feed.data?.items || []).filter(
    (item) => item.vaultId === vault.id && item.kind !== "gap",
  );
  const [allMoves, setAllMoves] = useState(false);
  return (
    <Section
      id="moved"
      title="Money moved"
      lede="Batches settled and moves between networks, from the contracts."
    >
      {feed.loading && !feed.data ? (
        <p className={b.quiet}>Loading…</p>
      ) : items.length ? (
        <>
          {/* The latest few; the rest one click away. */}
          <LedgerRows rows={items} limit={allMoves ? 40 : 4} hideVault />
          {!allMoves && groupEvents(items).length > 4 && (
            <button
              className={`${b.linkButton} ${b.moreButton}`}
              onClick={() => setAllMoves(true)}
            >
              Show {Math.min(groupEvents(items).length, 40) - 4} more
            </button>
          )}
        </>
      ) : (
        <p className={b.quiet}>Nothing has moved yet.</p>
      )}
    </Section>
  );
}

function Terms({ vault }) {
  const fee = (value) => (value == null ? "—" : value.toFixed(2) + "%");
  const limits = vault.limits;
  return (
    <Section id="terms" title="Terms and fees">
      <dl className={b.terms}>
        <div>
          <dt>Performance fee now</dt>
          <dd>{fee(vault.fees.performance)}</dd>
          <small>
            Read from the contract. The planned fee is {vault.fees.planned}% of
            yield; it is not charged yet.
          </small>
        </div>
        <div>
          <dt>Management fee</dt>
          <dd>{fee(vault.fees.management)}</dd>
        </div>
        <div>
          <dt>Minimum deposit</dt>
          <dd>
            {vault.minDeposit != null ? money(vault.minDeposit) : "—"}{" "}
            <small>{vault.token}</small>
          </dd>
          {limits?.maxEpochDeposits && (
            <small>
              At most {money(Number(limits.maxEpochDeposits) / 1e6, 0)} USDC in
              one batch.
            </small>
          )}
        </div>
      </dl>
    </Section>
  );
}

function Risks({ vault }) {
  return (
    <Section
      id="risks"
      title="What can go wrong"
      lede="Yield comes with risk. No Thesauros vault is insured or guaranteed."
    >
      <dl className={b.risks}>
        {vault.risks.map((risk) => (
          <div key={risk.title}>
            <dt>{risk.title}</dt>
            <dd>{risk.text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Contracts({ vault }) {
  return (
    <Section id="contracts" title="Networks and contracts">
      <details className={b.disclosure}>
        <summary>
          Where this vault lives
          <small>
            Deposits on {vault.depositNetwork}; lends on {listOf(vault.networks)}
            {" · "}
            {vault.contracts.length} contracts
          </small>
        </summary>
        <dl className={b.terms}>
          <div>
            <dt>Deposit and withdraw on</dt>
            <dd>
              {vault.token} on {vault.depositNetwork}
            </dd>
            <small>Network fees are paid in {vault.gasToken}.</small>
          </div>
          <div>
            <dt>Lends on</dt>
            <dd>{listOf(vault.networks)}</dd>
            <small>Money moves between networks through Circle’s CCTP.</small>
          </div>
        </dl>
        <ul className={b.contractList}>
          {vault.contracts.map((contract) => (
            <li key={contract.label + contract.address}>
              <span>{contract.label}</span>
              <a
                href={contract.explorer + "/address/" + contract.address}
                target="_blank"
                rel="noreferrer"
              >
                {short(contract.address)} ↗
              </a>
            </li>
          ))}
        </ul>
        <MeasureNote>
          Balances, share prices and allocation are read from these contracts.
          The valuation is calculated by Thesauros and published to the
          valuation contract.
        </MeasureNote>
      </details>
    </Section>
  );
}

// Earn: the product, on one page. What it pays and against what, where the
// money is, how to get it out, what it costs and what can go wrong, with the
// deposit panel beside it.
export default function VaultPage({ book, user, batch, navigate, intent }) {
  const { vault, product, totals } = book;
  const feed = usePublicResource("/api/vaults/feed", { refreshMs: 120000 });
  const feedItems = (feed.data?.items || []).filter(
    (item) => item.vaultId === vault.id,
  );
  const active = vault.position.active || [];
  return (
    <div className={b.page}>
      <Header vault={vault} product={product} totals={totals} />
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
                  />
                ))}
              </div>
            </Section>
          )}
          <Performance book={book} />
          <WhatIf book={book} navigate={navigate} />
          <WhereTheMoneyIs vault={vault} index={product.index} />
          <GettingOut vault={vault} feedItems={feedItems} />
          <MoneyMoved vault={vault} feed={feed} />
          <Terms vault={vault} />
          <Risks vault={vault} />
          <Contracts vault={vault} />
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
