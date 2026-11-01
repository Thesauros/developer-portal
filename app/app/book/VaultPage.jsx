"use client";
import { useState } from "react";
import { allMarkets } from "../../../lib/crosschain-feed.mjs";
import { CASH_COLOR, marketColor } from "../../../lib/vault-book.mjs";
import { measuredRate, pricePoints } from "../../../lib/vault-metrics.mjs";
import { PLANNED_PERFORMANCE_FEE } from "../../../lib/vault-facts.mjs";
import ActionPanel, { RequestRow, batchClosing } from "./ActionPanel";
import {
  AllocationBar,
  AllocationHistory,
  MoneyMap,
  PriceChart,
  RateChart,
} from "./charts";
import { LedgerRows } from "./ledger";
import {
  ago,
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
  Marks,
} from "./parts";
import b from "./book.module.css";

function Header({ vault, navigate }) {
  return (
    <header className={b.vaultHead}>
      <button className={b.back} onClick={() => navigate("vaults")}>
        Vaults
      </button>
      <div className={b.vaultName}>
        <Marks vault={vault} size={44} />
        <div>
          <h1 tabIndex={-1}>
            {vault.token} <span>{vault.networkLabel}</span>
          </h1>
          <p>
            <Stage stage={vault.stage} />
            Deposit on {vault.depositNetwork}
            {vault.since ? `. Since ${dateLabel(vault.since)}` : ""}.{" "}
            {vault.audit.label}.
          </p>
        </div>
      </div>
      <dl className={b.facts}>
        <div>
          <dt>Total value</dt>
          <dd>
            {compact(vault.tvl)} <small>{vault.token}</small>
          </dd>
        </div>
        <div>
          <dt>Rate now</dt>
          <dd>{pct(vault.rateNow)}</dd>
          <small>a year, before fees</small>
        </div>
        <div>
          <dt>30-day rate</dt>
          <dd>
            <MeasuredRate measure={vault.measured.r30} />
          </dd>
          <small>received, from the share price</small>
        </div>
        <div>
          <dt>Withdraw in</dt>
          <dd>{vault.exit.label}</dd>
          <small>{vault.exit.note}</small>
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

const RANGES = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: null, label: "All" },
];

// One sentence with a named comparison. One rule for small vaults everywhere: the
// raw change in the share price is a fact, a yearly rate is not.
function Comparison({ vault }) {
  if (vault.onlyMarket)
    return (
      <p className={b.compare}>
        This vault holds Aave only, so its rate follows Aave on{" "}
        {vault.depositNetwork}.
      </p>
    );
  const m = vault.measured.r30;
  if (!vault.benchmark || !m?.from) return null;
  const days = Math.round(m.days);
  const held = vault.capital
    ? [
        `${pct(vault.capital.cashShare, 0)} of it is cash`,
        ...vault.capital.networks
          .filter((net) => net.name !== "Base" && net.amount > 0)
          .map((net) => `${pct(net.share, 0)} is on ${net.name}`),
      ].join(" and ")
    : null;
  if (m.status !== "ok")
    return (
      <p className={b.compare}>
        Over the last {days} days the share price rose{" "}
        <strong>{Math.abs(m.change).toFixed(3)}%</strong>
        {held ? `; ${held}` : ""}. {vault.benchmark.name}, without rewards, paid{" "}
        <strong>{pct(vault.benchmark.rate)}</strong> a year. This vault holds too
        little for a yearly rate to mean much.
      </p>
    );
  const after = m.rate * (1 - PLANNED_PERFORMANCE_FEE / 100);
  return (
    <p className={b.compare}>
      Over the last {days} days: this vault paid <strong>{pct(m.rate)}</strong> a
      year, or {pct(after)} after the planned {PLANNED_PERFORMANCE_FEE}% fee, which
      is not charged today. {vault.benchmark.name}, without rewards, paid{" "}
      <strong>{pct(vault.benchmark.rate)}</strong>.
    </p>
  );
}

function StrategyRates() {
  const [period, setPeriod] = useState("30d");
  const [network, setNetwork] = useState("Base");
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
          options={[
            { value: "Base", label: "Base" },
            { value: "Arbitrum", label: "Arbitrum" },
          ]}
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
          series={{ vault: row.vault, market: row.market }}
          vaultLabel={network + " strategy"}
        />
      ) : (
        <p className={b.quiet}>
          {error
            ? "Rate history is not available right now."
            : "Loading rate history…"}
        </p>
      )}
      <p className={b.footnote}>
        What the strategy on one network paid, against the plain average of its
        approved markets. The data service has these from 29 October. It leaves
        out cash, so it is not this vault’s rate.
      </p>
    </>
  );
}

function Performance({ vault }) {
  const [view, setView] = useState("price");
  const [days, setDays] = useState(30);
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
  const age = vault.samples.length
    ? (Date.now() - vault.samples[0].at) / 86400000
    : 0;
  return (
    <Section
      title="Performance"
      aside={
        <Segmented
          label="Chart"
          value={view}
          onChange={setView}
          options={[
            { value: "price", label: "Share price" },
            { value: "rate", label: "Rate" },
          ]}
        />
      }
    >
      {view === "price" ? (
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
            <Segmented
              label="Period"
              value={days}
              onChange={setDays}
              options={RANGES.map((range) => ({
                ...range,
                disabled: range.value && age < range.value * 0.5,
              }))}
            />
          </div>
          <PriceChart
            points={points}
            silenceMs={vault.kind === "batch" ? 6 * 3600000 : 3 * 86400000}
            gapLabel={vault.kind === "batch" ? "No valuation" : "No reading"}
          />
          <p className={b.footnote}>
            What one share is worth. It rises as the markets pay interest, so
            holders earn without receiving anything.
            {vault.kind === "batch"
              ? " A dashed line marks a period with no valuation."
              : " One reading a day, from the contract."}
          </p>
        </>
      ) : vault.rateHistory ? (
        <>
          <RateChart series={vault.rateHistory} />
          <p className={b.footnote}>
            This vault’s daily rate against the plain average of its network’s
            lending markets, from the Thesauros data service.
          </p>
        </>
      ) : (
        <StrategyRates />
      )}
      <Comparison vault={vault} />
    </Section>
  );
}

function ApprovedMarkets({ vault }) {
  const [all, setAll] = useState(false);
  const rows = vault.capital ? allMarkets(vault.capital) : null;
  const inUse = vault.allocation;
  const notUsed = rows ? rows.filter((row) => !(row.amount > 0)) : [];
  const showLimit = !!vault.capital;
  const many = vault.networks.length > 1;
  // The same total as the header unless live balances really differ from it.
  const total = vault.capital?.held ?? vault.tvl;
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
              {many && <th>Network</th>}
              <th>Group</th>
              <th className={b.num}>Rate now</th>
              <th className={b.num}>Amount</th>
              <th className={b.num}>Share</th>
              {showLimit && <th className={b.num}>Limit</th>}
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
                </td>
                {many && <td data-label="Network">{row.network}</td>}
                <td data-label="Group">
                  <Tier tier={row.tier} />
                </td>
                <td className={b.num} data-label="Rate now">
                  {row.rate == null ? "—" : pct(row.rate)}
                </td>
                <td className={b.num} data-label="Amount">
                  {compact(row.amount)}
                </td>
                <td className={b.num} data-label="Share">
                  {row.share == null ? "—" : row.share.toFixed(1) + "%"}
                </td>
                {showLimit && (
                  <td className={b.num} data-label="Limit">
                    {row.limit == null
                      ? "—"
                      : row.limit === 0
                        ? "None"
                        : row.limit + "%"}
                  </td>
                )}
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
                  </td>
                  {many && <td data-label="Network">{row.network}</td>}
                  <td data-label="Group">
                    <Tier tier={row.tier} />
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
                  {showLimit && (
                    <td className={b.num} data-label="Limit">
                      {row.limit == null
                        ? "—"
                        : row.limit === 0
                          ? "None"
                          : row.limit + "%"}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={many ? 3 : 2} data-cell="vault">
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
              {showLimit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {sum.length > 1 && sum.length <= 6 && vault.rateNow != null && (
        <p className={b.sum}>
          {sum
            .map((row) => `${pct(row.rate)} × ${row.share.toFixed(1)}%`)
            .join(" + ")}{" "}
          = <strong>{pct(vault.rateNow)}</strong>
        </p>
      )}
    </>
  );
}

function WhereTheMoneyIs({ vault }) {
  const limits = vault.limits;
  const buffer = limits?.minimumBuffer ? Number(limits.minimumBuffer) / 1e6 : null;
  const ratio = limits?.minBufferRatio
    ? Number(limits.minBufferRatio) / 1e16
    : null;
  return (
    <Section
      id="where"
      title="Where the money is"
      lede={
        vault.onlyMarket ||
        (vault.kind === "batch"
          ? "You deposit on Base. The vault lends across markets on both networks and keeps cash for withdrawals."
          : `The vault lends across markets on ${vault.depositNetwork} and moves money towards the better rate.`)
      }
    >
      {vault.allocation.length ? (
        <>
          {vault.onlyMarket ? (
            <AllocationBar rows={vault.allocation} height={10} />
          ) : (
            <MoneyMap vault={vault} />
          )}
          <ApprovedMarkets vault={vault} />
          {vault.allocationHistory && (
            <div className={b.subBlock}>
              <h3>How the split changed</h3>
              <AllocationHistory history={vault.allocationHistory} />
              <p className={b.footnote}>
                One reading a day, from the contracts. Hover to see any day.
              </p>
            </div>
          )}
          {buffer != null && (
            <p className={b.footnote}>
              The vault keeps at least {money(buffer)} USDC
              {ratio != null ? ` or ${ratio.toFixed(0)}% of its value` : ""} as
              cash on Base. At this size that floor is a large part of the
              vault, which pulls the rate down; it weighs less as the vault
              grows.
            </p>
          )}
          {vault.capital && (vault.capital.pendingDeposits > 0 || vault.capital.owed > 0) && (
            <p className={b.footnote}>
              Deposits waiting to settle and withdrawals already owed are shown
              but not counted as capital at work.
            </p>
          )}
          {vault.kind === "instant" && (
            <p className={b.footnote}>
              Core: Aave and Compound. Satellite: curated Morpho vaults.
            </p>
          )}
        </>
      ) : (
        <p className={b.quiet}>This could not be read right now.</p>
      )}
    </Section>
  );
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
              <small>This vault’s history cannot be read from public nodes yet.</small>
            )}
          </div>
          <div>
            <dt>Limit</dt>
            <dd>What the markets can pay</dd>
            <small>
              Paid at once, up to the liquidity the markets have at that moment.
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
              {(Number(limits.instantFee) / 1e16).toFixed(2)}% fee. This app
              does not offer it yet.
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
  const items = (feed.data?.items || []).filter(
    (item) => item.vaultId === vault.id && item.kind !== "gap",
  );
  const known =
    vault.kind === "batch" ||
    (feed.data?.sources?.rebalances?.[vault.id] ?? false);
  return (
    <Section
      id="moved"
      title="Money moved"
      lede={
        vault.kind === "batch"
          ? "Batches settled and moves between networks, from the contracts. It has not moved money between markets yet."
          : "Every move between lending markets, from the vault’s contract."
      }
    >
      {feed.loading && !feed.data ? (
        <p className={b.quiet}>Loading…</p>
      ) : items.length ? (
        <LedgerRows rows={items.slice(0, 12)} hideVault />
      ) : (
        <p className={b.quiet}>
          {known
            ? "Nothing has moved yet."
            : "This vault’s history cannot be read from public nodes yet."}
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
        <div>
          <dt>Asset</dt>
          <dd>
            {vault.token} on {vault.depositNetwork}
          </dd>
          <small>Network fees are paid in {vault.gasToken}.</small>
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
    <Section id="contracts" title="Contracts and sources">
      <ul className={b.contractList}>
        {vault.contracts.map((contract) => (
          <li key={contract.label}>
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
      <p className={b.footnote}>
        Balances, share prices and allocation are read from these contracts.
        {vault.kind === "batch"
          ? " The valuation is calculated by Thesauros and published to the valuation contract."
          : " Daily rates come from the Thesauros data service."}
      </p>
    </Section>
  );
}

export default function VaultPage({
  vault,
  user,
  account,
  batch,
  wallet,
  navigate,
  intent,
}) {
  const feed = usePublicResource("/api/vaults/feed", { refreshMs: 120000 });
  const feedItems = (feed.data?.items || []).filter(
    (item) => item.vaultId === vault.id,
  );
  const active = vault.position.active || [];
  return (
    <div className={b.page}>
      <Header vault={vault} navigate={navigate} />
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
          <Performance vault={vault} />
          <WhereTheMoneyIs vault={vault} />
          <GettingOut vault={vault} feedItems={feedItems} />
          <MoneyMoved vault={vault} feed={feed} />
          <Terms vault={vault} />
          <Risks vault={vault} />
          <Contracts vault={vault} />
        </div>
        <ActionPanel
          key={vault.id}
          vault={vault}
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
