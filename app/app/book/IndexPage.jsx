"use client";
import { useMemo, useState } from "react";
import { DAY } from "../../../lib/vault-metrics.mjs";
import { chainList } from "../../../lib/chains.mjs";
import {
  groupConstituents,
  weeklyGaps,
} from "../../../lib/blue-chip-index.mjs";
import { marketColor } from "../../../lib/vault-book.mjs";
import { GapChart, RateChart } from "./charts";
import {
  dateLabel,
  pct,
  Section,
  Segmented,
  VsIndex,
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

const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];
// The same window as every rate in the tables beside it.
const DEFAULT_DAYS = 30;

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

export function GapSplit({ local, total, curated }) {
  const where = local.networks.join(" and ");
  return (
    <div className={b.gapSplit}>
      <p className={b.gapTitle}>Where the gap comes from</p>
      <dl>
        <div>
          <dt>
            The vault’s markets on {where}
            <small>
              against the blue-chip markets there, weighted by size
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
            {where} instead of the whole market
            <small>
              {where}’s blue-chip markets against the whole USDC index
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
              <small>over the same 30 days; parts are rounded</small>
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

export function IndexComparison({ book, compact = false }) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const index = book.index;
  const ours = book.totals.measured.r30?.series;
  const from = (index?.series.at(-1)?.at ?? Date.now()) - days * DAY;
  const points = useMemo(() => weeklyGaps(ours, index, from), [ours, index, from]);
  const t = book.totals;
  return (
    <div className={b.versus}>
      <div className={b.versusChart}>
        <div className={b.versusHead}>
          <span className={b.quiet}>
            Each week: Thesauros USDC against the USDC index, in points
          </span>
          <Segmented label="Period" value={days} onChange={setDays} options={PERIODS} />
        </div>
        <GapChart points={points} height={compact ? 180 : 210} label="Thesauros" />
      </div>
      {!compact && (
      <table className={`${b.table} ${b.scoreTable}`}>
        <thead>
          <tr>
            <th />
            <th className={b.num} title="Thesauros USDC vaults">Thesauros</th>
            <th className={b.num} title="USDC blue-chip index">Index</th>
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
      {t.local?.selection != null && t.local?.place != null &&
        (compact ? (
          <details className={`${b.disclosure} ${b.gapDisclosure}`}>
            <summary>
              {t.vsIndex?.r30Diff != null
                ? `${t.vsIndex.r30Diff >= 0 ? "+" : "−"}${Math.abs(t.vsIndex.r30Diff).toFixed(2)} pts against the USDC index over 30 days`
                : "Against the USDC index over 30 days"}
              <small>Why</small>
            </summary>
            <GapSplit
              local={t.local}
              total={t.vsIndex?.r30Diff}
              curated={curatedShare(book.products[0]?.vaults || [])}
            />
          </details>
        ) : (
          <GapSplit
            local={t.local}
            total={t.vsIndex?.r30Diff}
            curated={curatedShare(book.products[0]?.vaults || [])}
          />
        ))}
      <p className={b.footnote}>
        Thesauros: every USDC vault, weighted by size, from share prices; the
        30-day figure comes from the vaults large enough to measure. Index: USDC
        markets’ own interest, weighted by size. Both a year, before fees.
      </p>
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
            <h1 tabIndex={-1}>Blue-chip index</h1>
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
          <h1 tabIndex={-1}>Blue-chip index</h1>
          <p className={b.pageLede}>
            The market average Thesauros measures itself against, one for each
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
          <small>on {index.networks.length} networks</small>
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
              One market makes up this index: {NAME(index.constituents[0])} on{" "}
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
          vaultLabel={`${index.symbol || "USDC"} index, earned over the week before`}
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
              markets paid, not what they quoted.
            </dd>
          </div>
          <div>
            <dt>Rate now</dt>
            <dd>
              The rate each market pays lenders on the latest reading, weighted
              the same way. A market whose rate cannot be read is left out of
              this figure only.
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              Only the contracts: each vault’s list of markets, each market’s
              size and interest index. No outside data service.
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
