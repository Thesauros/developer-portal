"use client";
import { useMemo, useState } from "react";
import { DAY } from "../../../lib/vault-metrics.mjs";
import { chainList } from "../../../lib/chains.mjs";
import { groupConstituents } from "../../../lib/blue-chip-index.mjs";
import { marketColor } from "../../../lib/vault-book.mjs";
import { commonStart, COMPARE_COLORS, ComparisonChart, RateChart, windowOf } from "./charts";
import {
  dateLabel,
  pct,
  Section,
  Segmented,
  VsIndex,
  MeasureNote,
} from "./parts";
import b from "./book.module.css";

const NETWORK = Object.fromEntries(chainList.map((c) => [c.id, c]));
const billions = (value) =>
  value >= 1e9
    ? (value / 1e9).toFixed(2) + " bn"
    : value >= 1e6
      ? (value / 1e6).toFixed(1) + " m"
      : Math.round(value).toLocaleString("en-US");
const PROTOCOL_LOGO = { Aave: "aave", Compound: "compound", Morpho: "morpho", Fluid: "fluid" };

export const INDEX_DEFINITION =
  "The lending rate of every blue-chip market Thesauros vaults are approved to use and that holds at least 1 million USD, weighted by how much each market holds.";

// The same periods on every comparison chart.
export const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: null, label: "All" },
];
// The same window as every rate in the tables beside it.
const DEFAULT_DAYS = 30;

// The lines of the comparison chart: Thesauros, the index, then the references
// the index carries (T-bills and the largest lenders on their own).
// Over the 30 days of the figures above the chart, the line ends carry those
// same figures, so a page never shows two rates for one period.
export function compareLines(ours, index, oursName = "Thesauros", { oursRate, indexRate } = {}) {
  if (!index) return [];
  return [
    {
      id: "thesauros",
      name: oursName,
      short: oursName.length <= 13 ? oursName : "Thesauros",
      // One name for the line on every screen.
      tiny: oursName.length <= 13 ? oursName : "Thesauros",
      color: COMPARE_COLORS.thesauros,
      strong: true,
      series: ours || [],
      rate: oursRate ?? undefined,
    },
    {
      id: "index",
      name: `${index.symbol || "USDC"} Market Average`,
      short: "Market Average",
      tiny: "Market Average",
      color: COMPARE_COLORS.index,
      strong: true,
      series: index.series || [],
      rate: indexRate ?? undefined,
    },
    // References say what they are where they are drawn.
    // Two references for scale: Aave on its own and T-bills.
    ...(index.references || []).filter((ref) => ref.id === "aave" || ref.id === "tbills").map((ref) => ({
      id: ref.id,
      name: ref.name,
      short:
        ref.id === "tbills"
          ? "T-bills (Ondo USDY)"
          : ref.share != null
            ? `${ref.name.replace(" alone", "")} only, ${ref.share.toFixed(0)}% of Market Average`
            : ref.name,
      tiny: ref.id === "tbills" ? "T-bills" : ref.name.replace(" alone", ""),
      color: COMPARE_COLORS[ref.id] || "#8a94a6",
      series: ref.series,
    })),
  ];
}

// Where the index changed what it holds, for the large members only: a line
// that changes basis says so where it happens.
export function indexMarkers(index) {
  const weight = new Map((index?.constituents || []).map((row) => [row.key, row.weight]));
  const days = new Map();
  for (const change of index?.changes || []) {
    if (change.kind !== "joined" || (weight.get(change.key) || 0) < 5) continue;
    if (!days.has(change.day)) days.set(change.day, []);
    days.get(change.day).push(change);
  }
  // One mark a day: markets that joined together are named together.
  return [...days.values()].map((list) => {
    const networks = [...new Set(list.map((change) => NETWORK[change.network]?.name || change.network))];
    const label =
      list.length === 1
        ? `${list[0].name} on ${networks[0]} joins`
        : networks.length === 1
          ? `${networks[0]} markets join (${list.map((change) => change.name).join(", ")})`
          : `${list.length} markets join`;
    const short =
      networks.length === 1 ? `${networks[0]} joins` : `${list.length} markets join`;
    return { at: list[0].at, label, short };
  });
}

// The verdict for the window on screen, from the same readings as the chart.
export function windowVerdict(lines, from) {
  const [ours, index] = lines;
  const start = commonStart(lines, from);
  const a = ours && (ours.rate ?? windowOf(ours.series, start)?.rate);
  const c = index && (index.rate ?? windowOf(index.series, start)?.rate);
  // The gap from the rates as shown, to the hundredth.
  const r = (x) => Math.round(x * 100) / 100;
  return a != null && c != null ? { ours: a, index: c, gap: r(r(a) - r(c)) } : null;
}

// What each reference line is, for the note under the chart.
export function referenceNote(index) {
  const refs = (index?.references || []).filter((ref) => ref.id === "aave" || ref.id === "tbills");
  const lenders = refs.filter((ref) => ref.id !== "tbills");
  const bills = refs.find((ref) => ref.id === "tbills");
  const parts = [];
  if (lenders.length)
    parts.push(
      `${lenders.map((ref) => ref.name).join(" and ")}: the Market Average built only from that lender’s markets` +
        (lenders.every((ref) => ref.share != null)
          ? `, ${lenders.map((ref) => ref.share.toFixed(0) + "%").join(" and ")} of it.`
          : "."),
    );
  if (bills) parts.push("T-bills: Ondo USDY, a token backed by short US Treasuries, after its issuer’s fee.");
  return parts.join(" ") || null;
}

// The gap to the index in two parts: the choice among the markets a vault can
// use, and how those markets' networks paid against the whole index.
// How much of a set of vaults sits in curated vaults rather than core lenders.
export function curatedShare(vaults) {
  let total = 0,
    curated = 0;
  for (const vault of vaults)
    for (const row of vault.allocation || [])
      if (row.kind === "market" && row.amount > 0) {
        total += row.amount;
        if (row.tier === "satellite") curated += row.amount;
      }
  return total ? (curated / total) * 100 : null;
}

// The split over the period on screen: the vault against the markets where it
// lends, and those markets against the whole index. Over 30 days it is the
// stored split, so it matches the figures above to the cent.
export function splitFor(local, verdict, from, days) {
  if (!local) return null;
  if (days === 30 || !verdict) return { ...local, total: verdict?.gap ?? null };
  const parts = local.parts?.length ? local.parts : local.series ? [{ tvl: 1, series: local.series }] : [];
  let weight = 0,
    sum = 0;
  for (const part of parts) {
    const rate = windowOf(part.series, from)?.rate;
    if (rate == null) return null;
    weight += part.tvl;
    sum += part.tvl * rate;
  }
  if (!weight) return null;
  const r = (x) => Math.round(x * 100) / 100;
  const localRate = r(sum / weight);
  return {
    ...local,
    selection: r(r(verdict.ours) - localRate),
    place: r(localRate - r(verdict.index)),
    total: verdict.gap,
  };
}

export function GapSplit({ local, total, curated, days = 30 }) {
  const where = local.networks.join(" and ");
  return (
    <div className={b.gapSplit}>
      <p className={b.gapTitle}>Where the gap comes from, over {days ? `${days} days` : "the whole period"}</p>
      <dl>
        <div>
          <dt>
            Market choice
            <small>
              the vault’s markets against the blue-chip markets on {where},
              weighted by size
              {curated != null && curated > 0.5
                ? `; ${Math.round(curated)}% of it is in curated Morpho vaults, which pay more for more risk`
                : ""}
            </small>
          </dt>
          <dd>
            <VsIndex diff={local.selection} />
          </dd>
        </div>
        <div>
          <dt>
            Where the money sits
            <small>
              the blue-chip markets on {where} against the whole USDC Market Average
            </small>
          </dt>
          <dd>
            <VsIndex diff={local.place} />
          </dd>
        </div>
        {total != null && (
          <div className={b.gapTotal}>
            <dt>
              Gap to the index
              <small>over the same days; parts are rounded</small>
            </dt>
            <dd>
              <VsIndex diff={total} />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// The two views of the comparison chart.
export const VIEWS = [
  { value: "rate", label: "30-day rate" },
  { value: "earned", label: "Earned" },
];
export const viewLede = (view, token, start) =>
  view === "rate"
    ? `Each one’s rate over the 30 days before every day, a year; the right edge is today’s 30-day figure`
    : `What 10,000 ${token} earned since ${dateLabel(start, false)}, and the rate it works out to a year`;

export function IndexComparison({ book, compact = false }) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [view, setView] = useState("rate");
  const index = book.index;
  const ours = book.totals.measured.r30?.series;
  const from = days ? (index?.series.at(-1)?.at ?? Date.now()) - days * DAY : -Infinity;
  const t30 = days === 30 && book.totals.measured.r30?.status === "ok";
  const lines = useMemo(
    () =>
      compareLines(ours, index, "Thesauros", {
        oursRate: t30 ? book.totals.measured.r30.rate : null,
        indexRate: t30 ? book.totals.vsIndex?.r30 : null,
      }),
    [ours, index, t30, book.totals],
  );
  const start = lines[0]?.series?.find((point) => point.at >= from - DAY / 2)?.at ?? from;
  const verdict = windowVerdict(lines, from);
  const t = book.totals;
  const split = splitFor(t.local, verdict, commonStart(lines, from), days);
  return (
    <div className={b.versus}>
      <div className={b.versusChart}>
        <div className={b.versusHead}>
          <span className={b.quiet}>{viewLede(view, "USDC", start)}</span>
          <div className={b.controlsRow}>
            <Segmented label="View" value={view} onChange={setView} options={VIEWS} />
            <Segmented label="Period" value={days} onChange={setDays} options={PERIODS} />
          </div>
        </div>
        <ComparisonChart
          lines={lines}
          from={from}
          height={compact ? 240 : 280}
          markers={indexMarkers(index)}
          mode={view}
        />
      </div>
      {!compact && verdict && days !== 30 && (
        <p className={b.verdictLine}>
          {days ? `Over ${days} days` : "Over the whole period"}: Thesauros{" "}
          {pct(verdict.ours)}, the Market Average{" "}
          {pct(verdict.index)}, <VsIndex diff={verdict.gap} />. The table is
          over 30 days.
        </p>
      )}
      {!compact && (
      <table className={`${b.table} ${b.scoreTable}`}>
        <thead>
          <tr>
            <th />
            <th className={b.num} title="Thesauros USDC vaults">Thesauros</th>
            <th className={b.num} title="USDC Market Average">Market Average</th>
            <th className={b.num}>Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Last 30 days</th>
            <td className={b.num}>
              {t.measured.r30?.status === "ok" ? pct(t.measured.r30.rate) : "—"}
            </td>
            <td className={b.num}>{pct(t.vsIndex?.r30 ?? index?.r30)}</td>
            <td className={b.num}>
              <VsIndex diff={t.vsIndex?.r30Diff} />
            </td>
          </tr>
          <tr className={b.secondaryRow}>
            <th scope="row">Rate now</th>
            <td className={b.num}>{pct(t.rateNow)}</td>
            <td className={b.num}>{pct(index?.rateNow)}</td>
            <td className={b.num}>
              <VsIndex diff={t.vsIndex?.nowDiff} />
            </td>
          </tr>
        </tbody>
      </table>
      )}
      {split?.selection != null && split?.place != null &&
        (compact ? (
          <details className={`${b.disclosure} ${b.gapDisclosure}`}>
            <summary>
              {verdict
                ? `${verdict.gap >= 0 ? "+" : "−"}${Math.abs(verdict.gap).toFixed(2)} pts against the USDC Market Average over ${days ? days + " days" : "the whole period"}`
                : `Against the USDC Market Average`}
              <small>Why</small>
            </summary>
            <GapSplit
              local={split}
              total={split.total}
              days={days}
              curated={curatedShare(book.vaults)}
            />
          </details>
        ) : (
          <GapSplit
            local={split}
            total={split.total}
            days={days}
            curated={curatedShare(book.vaults)}
          />
        ))}
      <MeasureNote>
        Thesauros: every Thesauros USDC vault, the current one and the ones
        before it, chained day by day and weighted by the money each held, from
        share prices. Market Average: what its markets paid, weighted by size.{" "}
        {referenceNote(index)} Interest only, before fees.
      </MeasureNote>
    </div>
  );
}

const NAME = (row) => `${row.name}${row.protocol === "Morpho" ? " (Morpho)" : ""}`;

export default function IndexPage({ book, navigate }) {
  const [by, setBy] = useState("market");
  const symbols = Object.keys(book.indexes || {}).filter(
    (symbol) => book.indexes[symbol],
  );
  const [symbol, setSymbol] = useState("USDC");
  const index = book.indexes?.[symbol] || book.index;
  if (!index)
    return (
      <div className={b.page}>
        <header className={b.pageHead}>
          <div>
            <h1 tabIndex={-1}>Market Average</h1>
            <p className={b.pageLede}>{INDEX_DEFINITION}</p>
          </div>
        </header>
        <p className={b.quiet}>
          The index is built from daily contract readings. They are not
          available right now.
        </p>
      </div>
    );
  const groups =
    by === "market" ? null : groupConstituents(index.constituents, by);
  const name = (id) => book.byId[id]?.title || null;
  const approvedFor = (ids) => [...new Set(ids.map(name).filter(Boolean))].join(", ");
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Market Average</h1>
          <p className={b.pageLede}>
            What Thesauros measures itself against, a TVL-weighted blue-chip index, one for each
            stablecoin. {INDEX_DEFINITION}
          </p>
        </div>
      </header>
      {symbols.length > 1 && (
        <div className={b.tabsRow}>
          <Segmented
            label="Stablecoin"
            value={symbol}
            onChange={setSymbol}
            options={symbols.map((item) => ({
              value: item,
              label: item + " markets",
            }))}
          />
        </div>
      )}
      <dl className={`${b.facts} ${b.factsTop}`}>
        <div>
          <dt>Last 30 days</dt>
          <dd>{pct(index.r30)}</dd>
          <small>a year, from the markets’ own interest</small>
        </div>
        <div>
          <dt>Rate now</dt>
          <dd>{pct(index.rateNow)}</dd>
          <small>a year, what the markets pay lenders today</small>
        </div>
        <div>
          <dt>Markets</dt>
          <dd>{index.constituents.length}</dd>
          <small>
            on {index.networks.length} network{index.networks.length === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <dt>Money in them</dt>
          <dd>{billions(index.total)}</dd>
          <small>USD, read from the contracts</small>
        </div>
      </dl>

      {index.constituents.length > 0 && (
        <p className={b.compare}>
          {index.constituents.length === 1 ? (
            <>
              One market makes up this Market Average: {NAME(index.constituents[0])} on{" "}
              {NETWORK[index.constituents[0].network]?.name}. The only{" "}
              {symbol} vault lends there too, so this index mostly shows that
              it keeps pace.
            </>
          ) : (
            <>
              The index follows the money, so it is concentrated:{" "}
              {NAME(index.constituents[0])} on{" "}
              {NETWORK[index.constituents[0].network]?.name} is{" "}
              <strong>{pct(index.constituents[0].weight, 0)}</strong> of it, and
              the two largest markets are{" "}
              <strong>
                {pct(index.constituents[0].weight + (index.constituents[1]?.weight || 0), 0)}
              </strong>
              . That is where a dollar of {symbol} lending actually sits.
            </>
          )}
        </p>
      )}
      {symbol === "USDC" && (
        <Section
          id="against"
          title="Thesauros against the index"
          lede="The same calculation on both sides, over the same days."
        >
          <IndexComparison book={book} />
        </Section>
      )}

      <Section
        id="rate"
        title="What the index earned"
        lede="At each daily reading, what the index earned over the week before, a year. Earned, not quoted: a market’s quoted rate can differ from what it paid."
      >
        <RateChart
          series={{
            vault: (index.earned || []).map((point) => ({ t: point.at, v: point.rate })),
            market: [],
          }}
          vaultLabel={`${index.symbol || "USDC"} Market Average, earned over the week before`}
          height={220}
        />
      </Section>

      <Section
        id="members"
        title="What is in it"
        lede={`As of ${dateLabel(index.to)}. Weight is each market’s share of all the money in the index.`}
        aside={
          <Segmented
            label="Group by"
            value={by}
            onChange={setBy}
            options={[
              { value: "market", label: "Market" },
              { value: "protocol", label: "Protocol" },
              { value: "network", label: "Network" },
            ]}
          />
        }
      >
        <div className={b.tableWrap}>
          <table className={`${b.table} ${b.stack} ${b.indexTable}`}>
            <thead>
              <tr>
                <th>{by === "market" ? "Market" : by === "network" ? "Network" : "Protocol"}</th>
                {by === "market" && <th>Network</th>}
                {by === "market" && <th>Asset</th>}
                <th className={b.weightHead}>Weight</th>
                <th className={b.num}>Size, USD</th>
                <th className={b.num}>Rate now</th>
                {by === "market" && <th>Approved for</th>}
              </tr>
            </thead>
            <tbody>
              {by === "market"
                ? index.constituents.map((row) => (
                    <tr key={row.key}>
                      <td data-cell="vault">
                        <span className={b.market}>
                          <i
                            className={b.swatch}
                            style={{ background: marketColor(row.name) }}
                          />
                          {PROTOCOL_LOGO[row.protocol] && (
                            <img
                              src={"/brand/protocols/" + PROTOCOL_LOGO[row.protocol] + ".png"}
                              width="18"
                              height="18"
                              alt=""
                            />
                          )}
                          {row.name}
                          {row.protocol === "Morpho" && (
                            <small className={b.quiet}> on Morpho</small>
                          )}
                          <small className={b.phoneInline}>
                            {NETWORK[row.network]?.name || row.network}
                          </small>
                        </span>
                      </td>
                      <td data-label="Network">
                        <span className={b.inlineMark}>
                          {NETWORK[row.network]?.icon && (
                            <img src={NETWORK[row.network].icon} width="14" height="14" alt="" />
                          )}
                          {NETWORK[row.network]?.name || row.network}
                        </span>
                      </td>
                      <td data-label="Asset">{row.symbol}</td>
                      <td data-label="Weight">
                        <span className={b.weight}>
                          <span className={b.weightTrack}>
                            <i style={{ width: Math.max(row.weight, 0.4) + "%" }} />
                          </span>
                          {row.weight < 0.01 ? "<0.01" : row.weight.toFixed(2)}%
                        </span>
                      </td>
                      <td className={b.num} data-label="Size, USD">
                        {billions(row.tvl)}
                      </td>
                      <td className={b.num} data-label="Rate now">
                        {row.rate == null ? (
                          <span className={b.quiet} title="The rate could not be read; the market still counts in the 30-day figure.">
                            Not read
                          </span>
                        ) : (
                          pct(row.rate)
                        )}
                      </td>
                      <td data-label="Approved for">
                        <span className={b.quiet}>
                          {approvedFor(row.vaults)}
                        </span>
                      </td>
                    </tr>
                  ))
                : groups.map((row) => (
                    <tr key={row.name}>
                      <td data-cell="vault">
                        <span className={b.market}>
                          {by === "network" && NETWORK[row.name]?.icon && (
                            <img src={NETWORK[row.name].icon} width="18" height="18" alt="" />
                          )}
                          {by === "protocol" && PROTOCOL_LOGO[row.name] && (
                            <img src={"/brand/protocols/" + PROTOCOL_LOGO[row.name] + ".png"} width="18" height="18" alt="" />
                          )}
                          {by === "network" ? NETWORK[row.name]?.name || row.name : row.name}
                          <small className={b.quiet}>
                            {" "}
                            {row.count} {row.count === 1 ? "market" : "markets"}
                          </small>
                        </span>
                      </td>
                      <td data-label="Weight">
                        <span className={b.weight}>
                          <span className={b.weightTrack}>
                            <i style={{ width: Math.max(row.weight, 0.4) + "%" }} />
                          </span>
                          {row.weight.toFixed(2)}%
                        </span>
                      </td>
                      <td className={b.num} data-label="Size, USD">
                        {billions(row.tvl)}
                      </td>
                      <td className={b.num} data-label="Rate now">
                        {pct(row.rate)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Section>

      {index.changes?.length > 0 && (
        <Section
          id="changes"
          title="Changes to the members"
          lede="Dates when a market joined or left. A market joins when a vault is approved to use it and it holds 1 million USD, and leaves when either stops being true."
        >
          <ul className={b.changeList}>
            {index.changes.slice(0, 20).map((change) => (
              <li key={change.key + change.kind + change.day}>
                <span className={b.quiet}>{dateLabel(change.at)}</span>
                <span>
                  {NAME(change)} on {NETWORK[change.network]?.name || change.network}
                </span>
                <span className={b.tag}>{change.kind === "joined" ? "Joined" : "Left"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="method" title="How it is built">
        <dl className={b.method}>
          <div>
            <dt>Members</dt>
            <dd>
              Every market a Thesauros vault is approved to lend to, on every
              network, as the vault contracts list them that day, that holds at
              least 1 million USD. One index per stablecoin: USDC vaults are
              measured against USDC markets. Because approval decides
              membership, every change is listed above.
            </dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd>
              How much each market holds, read on the same block as its
              interest. Large markets count for more, the way a dollar in the
              market is most likely to be lent.
            </dd>
          </div>
          <div>
            <dt>Return</dt>
            <dd>
              Each market’s own interest index from one daily reading to the
              next, added up by weight and chained day to day. It is what the
              markets paid, not what they quoted, with one exception: interest
              paid while a market’s quote jumped is left out. In an interval
              with a jump the market earns at most the average of its settled
              quotes.
              {index.jumpEffect?.r30 != null && index.jumpEffect.r30 > 0.005
                ? ` Over the last 30 days this took ${index.jumpEffect.r30.toFixed(2)} pts off the index.`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Rate now</dt>
            <dd>
              The rate each market quotes lenders on the latest reading,
              weighted the same way. Each quote is also read at 04:00, 12:00
              and 20:00 UTC. A quote more than 1.5 points (or 30%) away from
              both of the two readings before it counts only once a later
              reading confirms it; until then the nearer earlier reading
              stands in. This keeps out short jumps: Aave on Ethereum quoted
              about 12.5% instead of 3.7% for some 40 minutes around midnight
              UTC on most days from September to early November. A market whose
              rate cannot be read is left out of this figure only.
            </dd>
          </div>
          <div>
            <dt>Reference lines</dt>
            <dd>
              T-bills: the on-chain price of Ondo USDY, a token backed by short
              US Treasuries and bank deposits, which grows by what it pays after
              its issuer’s fee. Aave alone: the Market Average built only from
              Aave’s markets, to show how much of it one lender is. The hatched
              area marks where Thesauros earned more than the Market Average.
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              Only the contracts: each vault’s list of markets, each market’s
              size, quote and interest index, and the USDY price contract. No
              outside data service.
            </dd>
          </div>
          <div>
            <dt>Rewards and fees</dt>
            <dd>
              Neither is in the index. It counts interest only: token rewards
              some markets pay on top are left out.
            </dd>
          </div>
        </dl>
        <p className={b.footnote}>
          Readings since {dateLabel(index.from)}.{" "}
          <button className={b.linkButton} onClick={() => navigate("vaults")}>
            Compare each vault on Earn
          </button>
        </p>
      </Section>
    </div>
  );
}
