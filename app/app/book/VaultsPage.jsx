"use client";
import { useMemo, useState } from "react";
import { measuredRate, pricePoints } from "../../../lib/vault-metrics.mjs";
import { marketColor } from "../../../lib/vault-book.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import { useLive } from "../LivePanels";
import { AllocationBar, Sparkline } from "./charts";
import {
  compact,
  dateLabel,
  MeasuredRate,
  money,
  pct,
  Section,
  Segmented,
  signed,
  Stage,
  Tier,
  VaultTitle,
} from "./parts";
import b from "./book.module.css";

function whereLabel(vault) {
  const names = new Set(
    vault.allocation
      .filter((row) => row.kind === "market")
      .map((row) => row.name),
  );
  if (!names.size) return "—";
  return names.size === 1 ? [...names][0] : names.size + " markets";
}

function VaultRow({ vault, navigate, showBalance }) {
  const open = () => navigate("vault", vault.id);
  const recent = pricePoints(vault.samples, 30, Date.now());
  const logos = [
    ...new Set(vault.allocation.map((row) => row.logo).filter(Boolean)),
  ].slice(0, 4);
  return (
    <tr className={b.vaultRow} onClick={open}>
      <td data-cell="vault">
        <div className={b.vaultCell}>
          <button className={b.rowLink} onClick={open}>
            <VaultTitle vault={vault} />
          </button>
          <Stage stage={vault.stage} />
        </div>
      </td>
      <td data-cell="where">
        <AllocationBar rows={vault.allocation} />
        <span className={b.logoRow}>
          {logos.map((logo) => (
            <img
              key={logo}
              src={"/brand/protocols/" + logo + ".png"}
              width="16"
              height="16"
              alt=""
            />
          ))}
          {whereLabel(vault)}
        </span>
      </td>
      <td className={b.num} data-label="Total value">
        {compact(vault.tvl)} <small>{vault.token}</small>
      </td>
      <td className={b.num} data-label="Rate now">
        {pct(vault.rateNow)}
      </td>
      <td className={b.num} data-label="30-day rate">
        <MeasuredRate measure={vault.measured.r30} />
      </td>
      <td data-cell="spark" aria-hidden="true">
        <Sparkline points={recent} />
      </td>
      <td data-label="Withdraw in">
        <span className={b.exit}>{vault.exit.label}</span>
        <small className={b.quietBlock}>{vault.exit.note}</small>
      </td>
      <td data-label="Deposit on">{vault.depositNetwork}</td>
      {showBalance && (
        <td className={b.num} data-label="Your balance">
          {vault.position.balance > 0 ? money(vault.position.balance) : "—"}
        </td>
      )}
    </tr>
  );
}

function Directory({ book, navigate, user }) {
  const showBalance = !!user?.walletAddress;
  return (
    <>
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.directory}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th>Where the money is</th>
              <th className={b.num}>Total value</th>
              <th className={b.num}>Rate now</th>
              <th className={b.num}>30-day rate</th>
              <th aria-hidden="true" />
              <th>Withdraw in</th>
              <th>Deposit on</th>
              {showBalance && <th className={b.num}>Your balance</th>}
            </tr>
          </thead>
          <tbody>
            {book.vaults.map((vault) => (
              <VaultRow
                key={vault.id}
                vault={vault}
                navigate={navigate}
                showBalance={showBalance}
              />
            ))}
          </tbody>
        </table>
      </div>
      <dl className={b.definitions}>
        <div>
          <dt>Rate now</dt>
          <dd>
            Today’s lending rates, weighted by where the money is, a year,
            before fees. Cash counts at 0%.
          </dd>
        </div>
        <div>
          <dt>30-day rate</dt>
          <dd>
            What holders received over 30 days, from the share price, a year.
            Shown once a vault holds over 10,000 USD: below that, a cent would
            move it by whole points.
          </dd>
        </div>
        <div>
          <dt>Withdraw in</dt>
          <dd>
            Now: paid in one transaction, up to what the markets can pay. Next
            batch: requests settle together, then you collect. No time is
            promised.
          </dd>
        </div>
      </dl>
    </>
  );
}

const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 36500, label: "Since launch" },
];

// What a real amount would have done over a real period. Uses only readings
// taken from the chain, shows the same comparison for each vault, and says which
// vaults are too small for the result to mean much.
function WhatIf({ book, navigate }) {
  const [amount, setAmount] = useState("5000");
  const [days, setDays] = useState(30);
  const value = Number(String(amount).replace(/[^\d.]/g, "")) || 0;
  const rows = useMemo(() => {
    const all = book.vaults.map((vault) => {
      const measure = measuredRate(vault.samples, days);
      return {
        vault,
        measure,
        gain: measure.from ? (value * measure.change) / 100 : null,
      };
    });
    return {
      measured: all.filter((row) => row.measure.status === "ok"),
      small: all.filter((row) => row.measure.status !== "ok"),
    };
  }, [book.vaults, days, value]);
  const comparisons = useMemo(() => {
    const out = [];
    for (const id of ["arbitrum", "base"]) {
      const vault = book.byId[id];
      const series = (vault?.samples || []).filter((point) => point.index);
      const measure = measuredRate(
        series.map((point) => ({ ...point, price: point.index })),
        days,
        { minTvl: 0 },
      );
      if (measure.from)
        out.push({
          name: "Aave V3 USDC on " + vault.networkLabel + ", without rewards",
          gain: (value * measure.change) / 100,
        });
    }
    return out;
  }, [book.byId, days, value]);
  const maxGain = Math.max(
    ...rows.measured.map((row) => row.gain ?? 0),
    ...rows.small.map((row) => row.gain ?? 0),
    ...comparisons.map((row) => row.gain),
    0.000001,
  );
  const bar = (gain, color, opacity = 1) => (
    <span className={b.gain}>
      <span className={b.gainTrack}>
        <i
          style={{
            width: Math.max((gain / maxGain) * 100, 1) + "%",
            background: color,
            opacity,
          }}
        />
      </span>
      {signed(gain)}
    </span>
  );
  const vaultRow = ({ vault, measure, gain }) => (
    <tr key={vault.id}>
      <td data-cell="vault">
        <button
          className={b.rowLink}
          onClick={() => navigate("vault", vault.id)}
        >
          <VaultTitle vault={vault} size={22} />
        </button>
        {measure.sinceLaunch && measure.days && (
          <small className={b.quietBlock}>
            {Math.round(measure.days)} days of history
          </small>
        )}
      </td>
      <td data-label="Gain">
        {gain == null ? (
          <span className={b.quiet}>Not enough history</span>
        ) : (
          bar(gain, measure.status === "ok" ? "var(--blue)" : "var(--ink-4)")
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
      lede="Worked out from each vault’s real share price. Past results; rates change."
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
            {rows.measured.map(vaultRow)}
            {comparisons.map((row) => (
              <tr key={row.name} className={b.comparisonRow}>
                <td data-cell="vault">{row.name}</td>
                <td data-label="Gain">
                  {bar(row.gain, marketColor("Aave V3"), 0.45)}
                </td>
                <td className={b.num} data-label="Value now">
                  {money(value + row.gain)}
                </td>
                <td className={b.num} data-label="After fees">
                  {money(value + row.gain)}
                </td>
              </tr>
            ))}
            {rows.small.length > 0 && (
              <tr className={b.tableNote}>
                <td colSpan="4">
                  These hold too little for the result to be a reliable guide
                </td>
              </tr>
            )}
            {rows.small.map(vaultRow)}
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        No vault charges a fee today; the planned fee is shown for comparison.
        Network costs are not included.
      </p>
    </Section>
  );
}

function OurMarkets({ book }) {
  const rows = book.vaults.flatMap((vault) =>
    vault.allocation
      .filter((row) => row.kind === "market")
      .map((row) => ({ ...row, vault })),
  );
  rows.sort((a, c) => (c.amount || 0) - (a.amount || 0));
  if (!rows.length) return null;
  return (
    <Section
      title="Where Thesauros lends"
      lede="Every market holding money from a vault now, with the rate read from its contract."
    >
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.stack}`}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Network</th>
              <th>Vault</th>
              <th>Group</th>
              <th className={b.num}>Rate now</th>
              <th className={b.num}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.vault.id + row.key}>
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
                    {row.name}
                  </span>
                </td>
                <td data-label="Network">{row.network}</td>
                <td data-label="Vault">
                  {row.vault.token}, {row.vault.networkLabel}
                </td>
                <td data-label="Group">
                  <Tier tier={row.tier} />
                </td>
                <td className={b.num} data-label="Rate now">
                  {pct(row.rate)}
                </td>
                <td className={b.num} data-label="Amount">
                  {compact(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={b.footnote}>
        Core: Aave and Compound. Satellite: curated Morpho vaults.
      </p>
    </Section>
  );
}

// Rates across the wider market, with the markets Thesauros uses marked. Only tokens
// people know: the feed's raw pool tickers mean nothing to a reader.
const READABLE_TOKEN =
  /^(USDC|USDT|USDT0|USDC\.E|USDE|SUSDE|DAI|USDS|SUSDS|GHO|SGHO|PYUSD|RLUSD|FRAX|USDG|AUSD)$/;
function WiderMarket({ book }) {
  const feed = useLive("markets", true);
  const [all, setAll] = useState(false);
  // Protocol, network and token must all match: Aave on Monad also lists tokens
  // no vault holds. Morpho's curated vaults go by other names in this feed, so
  // they are left unmarked rather than guessed.
  const ours = new Set(
    book.vaults.flatMap((vault) =>
      vault.allocation
        .filter((row) => row.kind === "market")
        .map((row) => `${row.name.split(" ")[0]}:${row.network}:${vault.token}`),
    ),
  );
  const rows = (feed.data?.data || [])
    .filter((row) => row.apy > 0 && READABLE_TOKEN.test(row.token))
    .sort((a, c) => (c.tvlUsd || 0) - (a.tvlUsd || 0));
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <Section
      title="The wider market"
      lede="Stablecoin lending across DeFi, largest first, for comparison. From DefiLlama, and it includes rewards where a market pays them, so it can differ from the contract rates above."
      aside={
        <a
          className={b.linkOut}
          href="/app/bluechips"
          target="_blank"
          rel="noopener"
        >
          Blue chips ↗
        </a>
      }
    >
      {!rows.length ? (
        <p className={b.quiet}>
          {feed.loading ? "Loading…" : "Market data is not available right now."}
        </p>
      ) : (
        <>
          <div className={b.tableWrap}>
            <table className={`${b.table} ${b.stack}`}>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Token</th>
                  <th>Network</th>
                  <th className={b.num}>Rate now</th>
                  <th className={b.num}>Size</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td data-cell="vault">
                      <span className={b.market}>
                        {row.logo && (
                          <img
                            src={"/brand/protocols/" + row.logo + ".png"}
                            width="18"
                            height="18"
                            alt=""
                          />
                        )}
                        {row.name}
                        {ours.has(`${row.name.split(" ")[0]}:${row.chain}:${row.token}`) && (
                          <span className={b.stage} data-stage="Live">
                            Thesauros lends here
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="Token">{row.token}</td>
                    <td data-label="Network">{row.chain}</td>
                    <td className={b.num} data-label="Rate now">
                      {pct(row.apy)}
                    </td>
                    <td className={b.num} data-label="Size">
                      {row.tvlUsd >= 1e6
                        ? money(row.tvlUsd / 1e6, 1) + "M"
                        : compact(row.tvlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length && (
            <button
              className={`${b.linkButton} ${b.moreButton}`}
              onClick={() => setAll(true)}
            >
              Show all {rows.length}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function MarketsTab({ book }) {
  return (
    <>
      <OurMarkets book={book} />
      <WiderMarket book={book} />
    </>
  );
}

export default function VaultsPage({ book, navigate, user, tab = "vaults" }) {
  const { totals } = book;
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Vaults</h1>
          <p className={b.pageLede}>
            {money(totals.tvl, 0)} {totals.unit} in {book.vaults.length} vaults
            on {totals.networks} networks
            {Number.isFinite(totals.since)
              ? `, since ${dateLabel(totals.since, false)}`
              : ""}
            . Deposit stablecoins; the vault lends them across markets and you
            can see where every dollar is.
          </p>
        </div>
        <Segmented
          label="View"
          value={tab}
          onChange={(next) =>
            navigate(next === "markets" ? "markets" : "vaults")
          }
          options={[
            { value: "vaults", label: "Vaults" },
            { value: "markets", label: "Markets" },
          ]}
        />
      </header>
      {tab === "markets" ? (
        <MarketsTab book={book} />
      ) : (
        <>
          <Directory book={book} navigate={navigate} user={user} />
          <WhatIf book={book} navigate={navigate} />
        </>
      )}
    </div>
  );
}
