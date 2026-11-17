"use client";
import { useState } from "react";
import { allMarkets } from "../../../lib/crosschain-feed.mjs";
import { CASH_COLOR, marketColor } from "../../../lib/vault-book.mjs";
import { AllocationBar, AllocationHistory, MoneyMap } from "./charts";
import { clock, compact, money, pct, Segmented, short, Tier } from "./parts";
import b from "./book.module.css";

// The detail behind the vault's page: every market with its limit, how the
// rate adds up, the map by network and the contracts. It lives in
// Transparency, in the open; Earn keeps only what a deposit needs.

const listOf = (items) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);
const listNetworks = (rows) =>
  "On " + [...new Set(rows.map((row) => row.network))].join(", ");

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
      {sum.length > 1 && sum.length <= 6 && vault.rateNow != null && (
        <p className={b.sumLine}>
          <span>How the rate adds up</span>
          {sum
            .map((row) => `${pct(row.rate)} × ${row.share.toFixed(1)}%`)
            .join(" + ")}{" "}
          = <strong>{pct(vault.rateNow)}</strong>
        </p>
      )}
      {vault.ratesAt && (
        <p className={b.footnote}>
          Rates read from the market contracts at {clock(vault.ratesAt)}, the
          same readings the Market Average uses. A sudden jump in a quote
          counts only once a second reading confirms it.
        </p>
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

// Market by market, then the same money as a map by network.
export function VaultMarkets({ vault, index }) {
  const limits = vault.limits;
  const buffer = limits?.minimumBuffer ? Number(limits.minimumBuffer) / 1e6 : null;
  const ratio = limits?.minBufferRatio ? Number(limits.minBufferRatio) / 1e16 : null;
  if (!vault.allocation.length)
    return <p className={b.quiet}>This could not be read right now.</p>;
  return (
    <>
      <AllocationBar rows={vault.allocation} height={10} />
      <ApprovedMarkets vault={vault} />
      {vault.local?.selection == null && <TierSplit vault={vault} index={index} />}
      <figure className={b.figure}>
        <figcaption>
          <strong>By network</strong>
          How the money is split across {listOf(vault.networks)}, and where
          each part is lent.
        </figcaption>
        <MoneyMap vault={vault} />
      </figure>
      {vault.allocationHistory && (
        <figure className={b.figure}>
          <figcaption>
            <strong>How the split changed</strong>
            One reading a day, from the contracts.
          </figcaption>
          <AllocationHistory history={vault.allocationHistory} />
        </figure>
      )}
      <p className={b.footnote}>
        {(buffer > 0 || ratio > 0) && (
          <>
            The vault keeps{" "}
            {buffer > 0 && ratio > 0
              ? `at least ${money(buffer)} ${vault.token} or ${ratio.toFixed(0)}% of its value, whichever is more,`
              : buffer > 0
                ? `at least ${money(buffer)} ${vault.token}`
                : `${ratio.toFixed(0)}% of its value`}{" "}
            as cash on {vault.depositNetwork} to pay withdrawals. Cash earns
            nothing, which is why the vault’s rate is below its markets’.{" "}
          </>
        )}
        {vault.capital && (vault.capital.pendingDeposits > 0 || vault.capital.owed > 0)
          ? "Deposits waiting to settle and withdrawals already owed are shown but not counted as capital at work. "
          : ""}
        Core means Aave and Compound; Satellite means curated Morpho vaults.
      </p>
    </>
  );
}

// Where the vault lives: its networks and every contract behind it.
export function VaultContracts({ vault }) {
  return (
    <>
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
      <p className={b.footnote}>
        Balances, share prices and allocation are read from these contracts.
        The valuation is calculated by Thesauros and published to the valuation
        contract.
      </p>
    </>
  );
}
