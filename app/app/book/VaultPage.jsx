"use client";
import { useMemo, useState } from "react";
import { allMarkets } from "../../../lib/crosschain-feed.mjs";
import {
  CASH_COLOR,
  compositeMeasure,
  marketColor,
} from "../../../lib/vault-book.mjs";
import { DAY, measuredRate, pricePoints } from "../../../lib/vault-metrics.mjs";
import { earnedSeries, weeklyGaps } from "../../../lib/blue-chip-index.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import ActionPanel, { RequestRow, batchClosing } from "./ActionPanel";
import {
  AllocationBar,
  AllocationHistory,
  ComparisonChart,
  GapChart,
  MoneyMap,
  PriceChart,
  RateChart,
} from "./charts";
import { LedgerRows } from "./ledger";
import {
  compareLines,
  curatedShare,
  GapSplit,
  indexMarkers,
  PERIODS,
  referenceNote,
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
  Stage,
  Tier,
  usePublicResource,
  NetworkMarks,
  TokenMark,
  VsIndex,
  MeasureNote,
} from "./parts";
import b from "./book.module.css";



// "USDC index", and for an index of one market, which market that is.
const listOf = (items) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);
const listNetworks = (rows) =>
  "On " + [...new Set(rows.map((row) => row.network))].join(", ");
const indexName = (index) =>
  index?.symbol ? `${index.symbol} index` : "the index";
function indexLong(index) {
  if (!index) return "the blue-chip index";
  const only = index.constituents?.length === 1 ? index.constituents[0] : null;
  return only
    ? `the ${index.symbol} index (one market: ${only.name} on ${only.network.charAt(0).toUpperCase() + only.network.slice(1)})`
    : `the ${index.symbol} blue-chip index`;
}

function StageLine({ view }) {
  // One stage for the product: its best network's. Which network is at which
  // stage is in "Networks and contracts".
  return <Stage stage={view.stages?.[0]?.stage || view.stage} />;
}

function Header({ view, index, navigate }) {
  return (
    <header className={b.vaultHead}>
      <button className={b.back} onClick={() => navigate("vaults")}>
        Earn
      </button>
      <div className={b.vaultName}>
        <TokenMark token={view.token} size={44} />
        <div>
          <h1 tabIndex={-1}>
            {view.token} <span>{view.product.tag}</span>
          </h1>
          <p>
            {view.product.line}{" "}
            {Number.isFinite(view.since) ? `Since ${dateLabel(view.since)}.` : ""}
          </p>
          <p className={b.headMeta}>
            <StageLine view={view} />
            <span className={b.quiet}>
              <NetworkMarks networks={view.networks} size={14} />
              {view.kind === "batch"
                ? `Lends on ${view.networks.join(" and ")}`
                : `On ${view.networks.length} ${view.networks.length === 1 ? "network" : "networks"}`}
            </span>
          </p>
        </div>
      </div>
      <dl className={b.facts}>
        <div>
          <dt>30-day rate</dt>
          <dd>
            <MeasuredRate measure={view.measured.r30} />
          </dd>
          <small>
            {view.vsIndex?.r30Diff != null ? (
              <VsIndex
                diff={view.vsIndex.r30Diff}
                suffix={` vs ${indexName(index)}, same days`}
              />
            ) : view.measured.r30?.status === "small" ? (
              "too small to measure: under 10,000 USD"
            ) : view.measured.r30?.status === "young" ? (
              "too new to measure"
            ) : (
              "received, from the share price"
            )}
          </small>
        </div>
        <div>
          <dt>Rate now</dt>
          <dd>{pct(view.rateNow)}</dd>
          <small>quoted by its markets, a year, before fees</small>
        </div>
        <div>
          <dt>Total value</dt>
          <dd>
            {compact(view.tvl)} <small>{view.token}</small>
          </dd>
          {view.members?.length > 1 && (
            <small>across {view.members.length} networks</small>
          )}
        </div>
        <div>
          <dt>Withdraw in</dt>
          <dd>{view.exit.label}</dd>
          <small>{view.exit.note}</small>
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

// The same periods as every other comparison chart.
const RANGES = PERIODS;

// One sentence against the blue-chip index on the same days. One rule for
// small vaults everywhere: the raw change in the share price is a fact, a
// yearly rate is not.
function Comparison({ vault, index }) {
  const m = vault.measured.r30;
  const indexRate = vault.vsIndex?.r30;
  if (!m?.from) return null;
  const days = Math.round(m.days ?? 30);
  const only = vault.onlyMarket
    ? ` It holds one market only, so its rate follows that market.`
    : "";
  const name = indexLong(index);
  if (m.status !== "ok")
    return (
      <p className={b.compare}>
        {m.change != null && (
          <>
            Over the last {days} days the share price rose{" "}
            <strong>{Math.abs(m.change).toFixed(3)}%</strong>.{" "}
          </>
        )}
        {indexRate != null && (
          <>
            {name.charAt(0).toUpperCase() + name.slice(1)} paid{" "}
            <strong>{pct(indexRate)}</strong> a year over the same days.{" "}
          </>
        )}
        This vault holds too little for a yearly rate to mean much.{only}
      </p>
    );
  const after = m.rate * (1 - PLANNED_PERFORMANCE_FEE / 100);
  return (
    <p className={b.compare}>
      Over the last {days} days this vault paid <strong>{pct(m.rate)}</strong> a
      year, or {pct(after)} after the planned {PLANNED_PERFORMANCE_FEE}% fee,
      which is not charged today.{" "}
      {indexRate != null && (
        <>
          {name.charAt(0).toUpperCase() + name.slice(1)} paid{" "}
          <strong>{pct(indexRate)}</strong> over the same days:{" "}
          <VsIndex diff={m.rate - indexRate} />.
        </>
      )}
      {only}
    </p>
  );
}

function GapBlock({ vault }) {
  const local = vault.local;
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
        total={vault.vsIndex?.r30Diff}
        curated={curatedShare(vault.members || [vault])}
      />
    </details>
  );
}

function StrategyRates({ vault, index }) {
  const [period, setPeriod] = useState("30d");
  const [network, setNetwork] = useState(vault.depositNetwork);
  const { data, error } = usePublicResource(
    "/api/crosschain/rates?period=" + period,
  );
  const row = data?.networks?.find((net) => net.name === network);
  return (
    <>
      <div className={b.controlsRow}>
        <Segmented
          label="Network"
          value={network}
          onChange={setNetwork}
          options={vault.networks.map((name) => ({ value: name, label: name }))}
        />
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "7d", label: "7d" },
            { value: "30d", label: "30d" },
          ]}
        />
      </div>
      {row ? (
        <RateChart
          series={{ vault: row.vault, market: indexRates(index, row.vault) }}
          vaultLabel={"Lent on " + network}
        />
      ) : (
        <p className={b.quiet}>
          {error
            ? "Rate history is not available right now."
            : "Loading rate history…"}
        </p>
      )}
      <MeasureNote>
        What the money lent on one network earned, against the blue-chip index.
        The data service has these from 29 October. It leaves out cash, so it
        is not this vault’s rate.
      </MeasureNote>
    </>
  );
}

// What the index earned over each previous week, over the same days as a vault
// series, in the chart's shape.
function indexRates(index, series) {
  if (!index?.earned?.length) return [];
  const from = series?.[0]?.t ?? -Infinity;
  return index.earned
    .filter((point) => point.at >= from - DAY)
    .map((point) => ({ t: point.at, v: point.rate }));
}

function Performance({ view, vault, index }) {
  // A product too small to compare opens on its share price, not an empty box.
  // Until the reader picks, the default follows the data as it arrives.
  const [picked, setTab] = useState(null);
  const tab = picked ?? (view.measured.r30.status === "ok" ? "versus" : "price");
  const [days, setDays] = useState(30);
  const members = view.members || [vault];
  // The line chains the vaults the 30-day figure comes from, so the chart,
  // its weekly bars and the figure agree; before any is measurable, all of them.
  const chained = useMemo(
    () => view.measured.r30.series || compositeMeasure(members, 30).series || [],
    [view.measured.r30.series, members],
  );
  // With several networks the product comes first: its vaults chained by size.
  // One network's own share price is a choice away.
  const whole = useMemo(
    () =>
      members.length > 1 && chained.length > 1
        ? {
            id: "product",
            place: "All networks",
            token: view.token,
            kind: view.kind,
            sharePrice: null,
            samples: chained.map((point) => ({ at: point.at, price: point.level, tvl: view.tvl })),
          }
        : null,
    [members.length, chained, view.token, view.kind, view.tvl],
  );
  const [chosen, setShown] = useState(null);
  const shown = chosen ?? (whole ? "product" : vault.id);
  const priced =
    (shown === "product" && whole) || members.find((item) => item.id === shown) || vault;
  // The same window as the rate above, so a period never shows two answers.
  const window = days ? measuredRate(priced.samples, days) : null;
  const points = window?.from
    ? priced.samples.filter((point) => point.at >= window.from.at)
    : pricePoints(priced.samples, days);
  const first = points[0],
    last = points.at(-1);
  const change =
    window?.change ??
    (first && last && last !== first ? (last.price / first.price - 1) * 100 : null);
  const age = chained.length ? (Date.now() - chained[0].at) / 86400000 : 0;
  // The window ends where the index ends, so the index line is the same on
  // every page.
  const end = index?.series?.at(-1)?.at ?? chained.at(-1)?.at ?? Date.now();
  const from = days ? end - days * DAY : -Infinity;
  const measurable = view.measured.r30.status === "ok";
  const gaps = useMemo(() => weeklyGaps(chained, index, from), [chained, index, from]);
  const weekRates = useMemo(
    () => earnedSeries(chained, 7).map((point) => ({ t: point.at, v: point.rate })),
    [chained],
  );
  const v30 = days === 30 && view.measured.r30.status === "ok";
  const lines = useMemo(
    () =>
      compareLines(chained, index, view.title || "This product", {
        oursRate: v30 ? view.measured.r30.rate : null,
        indexRate: v30 ? view.vsIndex?.r30 : null,
      }),
    [chained, index, view, v30],
  );
  const verdict = windowVerdict(lines, from);
  const periodControl = (
    <Segmented
      label="Period"
      value={days}
      onChange={setDays}
      options={RANGES.map((range) => ({
        ...range,
        disabled: range.value && age < range.value * 0.5,
      }))}
    />
  );
  const networkControl =
    members.length > 1 ? (
      <Segmented
        label="Network"
        value={priced.id}
        onChange={setShown}
        options={[
          ...(whole ? [{ value: "product", label: "All networks" }] : []),
          ...members.map((item) => ({ value: item.id, label: item.place })),
        ]}
      />
    ) : null;
  return (
    <Section
      title="Performance"
      aside={
        <Segmented
          label="Chart"
          value={tab}
          onChange={setTab}
          options={[
            { value: "versus", label: "Against the index" },
            { value: "price", label: "Share price" },
            { value: "rate", label: "Rate" },
          ]}
        />
      }
    >
      {tab === "versus" ? (
        <>
          <div className={b.priceHead}>
            <p className={b.quiet}>
              What 10,000 {vault.token} earned since{" "}
              {dateLabel(lines[0]?.series?.find((point) => point.at >= from - DAY / 2)?.at ?? from, false)},
              and the rate it works out to a year
            </p>
            {periodControl}
          </div>
          {measurable ? (
            <>
              <ComparisonChart
                lines={lines}
                from={from}
                token={vault.token}
                markers={indexMarkers(index)}
              />
              {verdict && (
                <p className={b.verdictLine}>
                  {days ? `Over ${days} days` : "Since launch"}:{" "}
                  {view.title || "this product"} {pct(verdict.ours)}, the index{" "}
                  {pct(verdict.index)}, <VsIndex diff={verdict.gap} />.
                </p>
              )}
              <MeasureNote>
                {view.title || "This product"}: its vaults large enough to
                measure, weighted by size, from share prices. Index: what its
                markets paid, weighted by size. {referenceNote(index)} Interest
                only, before fees.
              </MeasureNote>
              <details className={b.disclosure}>
                <summary>Week by week against the index</summary>
                <GapChart points={gaps} label={view.title || "This product"} />
                <p className={b.footnote}>
                  Each bar is that week’s part of the gap, in points; together
                  they add up to the gap over the period. The first bar may
                  cover fewer than seven days.
                </p>
              </details>
            </>
          ) : (
            <p className={b.chartEmpty} style={{ height: 120 }}>
              This vault holds too little for a comparison to mean anything
              yet. The share price chart shows its raw change.
            </p>
          )}
        </>
      ) : tab === "price" ? (
        <>
          <div className={b.priceHead}>
            <p>
              {priced.id === "product" ? (
                <strong>{view.title}, all networks</strong>
              ) : (
                <>
                  <strong>
                    {priced.sharePrice != null ? priced.sharePrice.toFixed(6) : "—"}
                  </strong>{" "}
                  {priced.token} a share
                  {members.length > 1 ? ` on ${priced.place}` : ""}
                </>
              )}
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
          {networkControl && <div className={b.controlsRow}>{networkControl}</div>}
          <PriceChart
            points={points}
            silenceMs={priced.kind === "batch" ? 6 * 3600000 : 3 * 86400000}
            gapLabel={priced.kind === "batch" ? "No valuation" : "No reading"}
          />
          <MeasureNote>
            {priced.id === "product"
              ? "The product’s vaults on every network, chained and weighted by size: how a deposit spread like its money grew. Each network’s vault has its own share price; choose one above."
              : "What one share is worth. It rises as the markets pay interest, so holders earn without receiving anything."}
            {priced.kind === "batch"
              ? " A dashed line marks a period with no valuation."
              : " One reading a day, from the contract."}
          </MeasureNote>
        </>
      ) : measurable ? (
        <>
          <div className={b.priceHead}>
            <p className={b.quiet}>
              What each earned over the seven days before every reading, a year
            </p>
            {periodControl}
          </div>
          <RateChart
            series={{
              vault: weekRates.filter((point) => point.t >= from),
              market: indexRates(index, weekRates.filter((point) => point.t >= from)),
            }}
            vaultLabel={view.title || "This product"}
            compareLabel={`${index?.symbol || "USDC"} index`}
          />
          <MeasureNote>
            The same measure on both sides: share prices for {view.title || "the product"},
            each market’s interest index for the index. A week smooths single
            days; quotes never enter it.
          </MeasureNote>
        </>
      ) : priced.rateHistory ? (
        <>
          {networkControl && <div className={b.controlsRow}>{networkControl}</div>}
          <RateChart
            series={{
              vault: priced.rateHistory.vault,
              market: indexRates(index, priced.rateHistory.vault),
            }}
            vaultLabel={members.length > 1 ? "On " + priced.place : "This vault"}
          />
          <MeasureNote>
            Too small to measure from its share price yet, so this is the daily
            rate the Thesauros data service reports, against what the index
            earned over the week before each day.
          </MeasureNote>
        </>
      ) : (
        <StrategyRates vault={priced.id === "product" ? vault : priced} index={index} />
      )}
      <Comparison vault={view} index={index} />
      <GapBlock vault={view} />
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
                        title="Under 1 million USD, so the blue-chip index leaves it out"
                      >
                        not in the index
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
          million USD, so the blue-chip index leaves{" "}
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
          same readings the blue-chip index uses. A sudden jump in a quote
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
      blue-chip index is <strong>{pct(theirs, 0)}</strong> core. Curated vaults
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
      lede={
        vault.kind === "batch"
          ? "One deposit, lent across markets on several networks, with cash kept for withdrawals. Each market’s rate times its share adds up to the vault’s rate."
          : vault.allocation.filter((row) => row.kind === "market").length === 1
            ? `The vault lends to ${vault.allocation.find((row) => row.kind === "market").name}, the one market approved for it so far. With a second market it will move money towards the better rate.`
            : "The vault lends across approved markets and moves money towards the better rate. Each market’s rate times its share adds up to the vault’s rate."
      }
    >
      {vault.allocation.length ? (
        <>
          <AllocationBar rows={vault.allocation} height={10} />
          <ApprovedMarkets vault={vault} />
          {vault.local?.selection == null && <TierSplit vault={vault} index={index} />}
          {vault.allocationHistory && (
            <div className={b.subBlock}>
              <h3>How the split changed</h3>
              <AllocationHistory history={vault.allocationHistory} />
              <p className={b.footnote}>
                One reading a day, from the contracts. Hover or tap to see any day.
              </p>
            </div>
          )}
          {!vault.onlyMarket && (
            <details className={b.disclosure}>
              <summary>
                Map by network
                <small>
                  {vault.networks.length > 1
                    ? `How the money is split across ${listOf(vault.networks)}`
                    : `All of it on ${vault.networks[0]}`}
                </small>
              </summary>
              <MoneyMap vault={vault} />
            </details>
          )}
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
            blue-chip index.
          </MeasureNote>
        </>
      ) : (
        <p className={b.quiet}>This could not be read right now.</p>
      )}
    </Section>
  );
}

// Every market by name down to 1% of the money, the rest as one line, and
// uninvested cash, so the list adds up to the figure above it.
function exitList(vault) {
  const capacity = vault.exit.capacity;
  const many = vault.members?.length > 1;
  const big = capacity.markets.filter((market) => market.position >= 0.01 * capacity.held);
  const rest = capacity.markets.filter((market) => market.position < 0.01 * capacity.held);
  // "All of it" where a market can pay the whole position, the two amounts
  // only where it cannot.
  const part = (label, canLeave, position) =>
    canLeave >= position * 0.999
      ? `${label} all ${money(position)}`
      : `${label} ${money(canLeave)} of ${money(position)}`;
  const parts = big.map((market) =>
    part(
      `${market.name}${market.network && many ? " on " + market.network : ""}`,
      market.canLeave,
      market.position,
    ),
  );
  if (rest.length)
    parts.push(
      part(
        `${rest.length} small positions`,
        rest.reduce((sum, market) => sum + market.canLeave, 0),
        rest.reduce((sum, market) => sum + market.position, 0),
      ),
    );
  if (capacity.cash >= 0.01) parts.push(`cash in the vault ${money(capacity.cash)}`);
  return parts.join(", ");
}

function GettingOut({ vault, feedItems, name }) {
  if (vault.kind !== "batch")
    return (
      <Section id="exit" title="Getting your money out">
        <dl className={b.terms}>
          <div>
            <dt>Paid so far</dt>
            <dd>
              {vault.exit.record
                ? `${vault.exit.record.count} ${vault.exit.record.count === 1 ? "withdrawal" : "withdrawals"}`
                : "—"}
            </dd>
            {vault.exit.record?.largest > 0 && (
              <small>
                The largest was {compact(vault.exit.record.largest)} {vault.token},
                in one transaction.
              </small>
            )}
            {!vault.exit.record && (
              <small>Not measured for this vault yet.</small>
            )}
            {vault.exit.record?.partial && (
              <small>
                Counted on the networks with a full withdrawal history so far.
              </small>
            )}
          </div>
          <div>
            <dt>Could leave now</dt>
            <dd>
              {vault.exit.capacity ? (
                <>
                  {compact(vault.exit.capacity.canLeave)} <small>{vault.token}</small>
                  {vault.exit.capacity.held > 0 &&
                    vault.exit.capacity.canLeave >= vault.exit.capacity.held * 0.999 && (
                      <small> · all of it</small>
                    )}
                </>
              ) : (
                "What the markets can pay"
              )}
            </dd>
            <small>
              {vault.exit.capacity
                ? `For each market, the smaller of the vault’s position and the cash that market can pay out now: ${exitList(vault)}. Read from the contracts at ${clock(Date.parse(vault.exit.capacity.at))}.`
                : "Paid at once, up to the liquidity the markets have at that moment."}{" "}
              The contract checks this when you confirm.
              {vault.open.withdrawals ? "" : " Withdrawals are paused right now."}
            </small>
          </div>
        </dl>
      </Section>
    );
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
        <div className={b.subBlock}>
          <h3>When settlement had to wait</h3>
          {vault.gaps?.staleShare != null && (
            <p className={b.lede}>
              The valuation was out of date {vault.gaps.staleShare.toFixed(1)}%
              of the time since {dateLabel(vault.gaps.since, false)}.
            </p>
          )}
          <LedgerRows rows={gaps} hideVault />
        </div>
      )}
    </Section>
  );
}

function MoneyMoved({ vault, feed }) {
  const ids = (vault.members || [vault]).map((item) => item.id);
  const items = (feed.data?.items || []).filter(
    (item) => ids.includes(item.vaultId) && item.kind !== "gap",
  );
  const known =
    vault.kind === "batch" ||
    ids.some((id) => feed.data?.sources?.rebalances?.[id] ?? false);
  return (
    <Section
      id="moved"
      title="Money moved"
      lede={
        vault.kind === "batch"
          ? "Batches settled and moves between networks, from the contracts. It has not moved money between markets yet."
          : "Every move between lending markets, from its vaults’ contracts."
      }
    >
      {feed.loading && !feed.data ? (
        <p className={b.quiet}>Loading…</p>
      ) : items.length ? (
        <LedgerRows rows={items} limit={12} hideVault />
      ) : (
        <p className={b.quiet}>
          {known
            ? "Nothing has moved yet."
            : "Moves for this vault are not listed here yet; its allocation now is above."}
        </p>
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

function Networks({ view }) {
  const members = view.members || [view];
  const many = members.length > 1;
  return (
    <Section id="contracts" title="Networks and contracts">
      <details className={b.disclosure}>
        <summary>
          {many ? "Each network’s vault" : "Where this vault lives"}
          <small>
            {view.kind === "batch"
              ? `Deposits on ${view.depositNetwork}; lends on ${view.networks.join(", ")}`
              : many
                ? `${members.length} vaults, one per network, ${view.token} on each`
                : `${view.token} on ${view.depositNetwork}`}
            {" · "}
            {view.contracts.length}{" "}
            {view.contracts.length === 1 ? "contract" : "contracts"}
          </small>
        </summary>
        {many && (
          <div className={b.tableWrap}>
            <table className={`${b.table} ${b.stack}`}>
              <thead>
                <tr>
                  <th>Network</th>
                  <th>Stage</th>
                  <th>Code review</th>
                  <th className={b.num}>Total value</th>
                  <th className={b.num}>Rate now</th>
                  <th className={b.num}>30-day rate</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td data-cell="vault">
                      <span className={b.inlineMark}>
                        <NetworkMarks vault={member} size={16} />
                        {member.place}
                      </span>
                      <small className={b.quietBlock}>
                        fees in {member.gasToken}
                      </small>
                    </td>
                    <td data-label="Stage">
                      <Stage stage={member.stage} />
                    </td>
                    <td data-label="Code review">{member.audit.label}</td>
                    <td className={b.num} data-label="Total value">
                      {compact(member.tvl)} <small>{member.token}</small>
                    </td>
                    <td className={b.num} data-label="Rate now">
                      {pct(member.rateNow)}
                    </td>
                    <td className={b.num} data-label="30-day rate">
                      <MeasuredRate measure={member.measured.r30} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!many && (
          <dl className={b.terms}>
            <div>
              <dt>Deposit from</dt>
              <dd>
                {view.token} on {view.depositNetwork}
              </dd>
              <small>Network fees are paid in {view.gasToken}.</small>
            </div>
            <div>
              <dt>Lends on</dt>
              <dd>{view.networks.join(", ")}</dd>
              {view.kind === "batch" && (
                <small>Money moves between networks through Circle’s CCTP.</small>
              )}
            </div>
          </dl>
        )}
        <ul className={b.contractList}>
          {view.contracts.map((contract) => (
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
          {view.kind === "batch"
            ? " The valuation is calculated by Thesauros and published to the valuation contract."
            : " Rates now are read from the market contracts; the daily rate history comes from the Thesauros data service."}
          {many
            ? " Each network’s vault is its own contract with its own share price; you choose which one in the deposit panel."
            : ""}
        </MeasureNote>
      </details>
    </Section>
  );
}

export default function VaultPage({
  view,
  vault,
  product,
  chooseVault,
  index,
  user,
  account,
  batch,
  wallet,
  navigate,
  intent,
}) {
  const feed = usePublicResource("/api/vaults/feed", { refreshMs: 120000 });
  const ids = (view.members || [vault]).map((item) => item.id);
  const feedItems = (feed.data?.items || []).filter((item) =>
    ids.includes(item.vaultId),
  );
  const active = (view.members || [vault]).flatMap(
    (member) => member.position.active || [],
  );
  return (
    <div className={b.page}>
      <Header view={view} index={index} navigate={navigate} />
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
          <Performance view={view} vault={vault} index={index} />
          <WhereTheMoneyIs vault={view} index={index} />
          <GettingOut vault={view} feedItems={feedItems} />
          <MoneyMoved vault={view} feed={feed} />
          <Terms vault={vault} />
          <Risks vault={view} />
          <Networks view={view} />
        </div>
        <ActionPanel
          key={vault.id}
          vault={vault}
          choices={product.vaults}
          onChoose={chooseVault}
          user={user}
          account={account}
          batch={batch}
          wallet={wallet}
          navigate={navigate}
          intent={intent}
        />
      </div>
    </div>
  );
}
