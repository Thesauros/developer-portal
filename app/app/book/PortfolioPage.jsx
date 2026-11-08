"use client";
import { useMemo, useState } from "react";
import { exposure, CASH_COLOR } from "../../../lib/vault-book.mjs";
import { pricePoints } from "../../../lib/vault-metrics.mjs";
import { RequestRow } from "./ActionPanel";
import { EarnedSpark, Sparkline } from "./charts";
import { LedgerRows } from "./ledger";
import { mineLedger, vaultNamer } from "./activity";
import {
  compact,
  MeasuredRate,
  money,
  pct,
  Section,
  Segmented,
  Stage,
  VaultTitle,
  VsIndex,
} from "./parts";
import { Products } from "./VaultsPage";
import b from "./book.module.css";

// Vaults side by side, for anyone choosing where to start.
// The same three products as Earn: where to start is the same choice everywhere.
function Compare({ book, navigate }) {
  return (
    <Section
      title="Where to start"
      lede="Choose the stablecoin and how fast you want to be able to leave. The network you deposit from is chosen inside."
      aside={
        <button className={b.linkButton} onClick={() => navigate("vaults")}>
          Earn: the index and what-if
        </button>
      }
    >
      <Products book={book} navigate={navigate} user={null} />
    </Section>
  );
}

function positionNote(vault) {
  const { position } = vault;
  const leaving = position.leaving + position.out;
  const parts = [
    leaving > 0 && `${money(leaving)} leaving`,
    position.arriving > 0 && `${money(position.arriving)} arriving`,
    position.ready > 0 && `${money(position.ready)} to collect`,
    (leaving > 0 || position.arriving > 0) &&
      position.earning > 0 &&
      `${money(position.earning)} earning`,
  ].filter(Boolean);
  return parts.join(", ");
}

function Positions({ held, navigate }) {
  return (
    <Section id="positions" title="Your vaults">
      <div className={b.tableWrap}>
        <table className={`${b.table} ${b.directory}`}>
          <thead>
            <tr>
              <th>Vault</th>
              <th className={b.num}>Balance</th>
              <th className={b.num}>Earned</th>
              <th className={b.num}>Rate now</th>
              <th className={b.num}>Against the index</th>
              <th aria-hidden="true" />
              <th>Withdraw in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {held.map((vault) => (
              <tr key={vault.id}>
                <td data-cell="vault">
                  <button
                    className={b.rowLink}
                    onClick={() => navigate("vault", vault.id)}
                  >
                    <VaultTitle vault={vault} />
                  </button>
                </td>
                <td className={b.num} data-label="Balance">
                  {money(vault.position.balance)} <small>{vault.token}</small>
                  {positionNote(vault) && (
                    <small className={b.quietBlock}>{positionNote(vault)}</small>
                  )}
                </td>
                <td className={b.num} data-label="Earned">
                  {vault.position.earned == null
                    ? "—"
                    : money(
                        vault.position.earned,
                        Math.abs(vault.position.earned) < 1 ? 4 : 2,
                      )}
                </td>
                <td className={b.num} data-label="Rate now">
                  {pct(vault.rateNow)}
                </td>
                <td className={b.num} data-label="Against the index">
                  <VsIndex diff={vault.vsIndex?.nowDiff} />
                </td>
                <td data-cell="spark" aria-hidden="true">
                  <Sparkline points={pricePoints(vault.samples, 30)} />
                </td>
                <td data-label="Withdraw in">
                  <span className={b.exit}>{vault.exit.label}</span>
                </td>
                <td className={b.right} data-cell="action">
                  <span className={b.rowActions}>
                    <button
                      className={b.secondary}
                      disabled={!vault.open.deposits}
                      onClick={() =>
                        navigate("vault", vault.id, { action: "deposit" })
                      }
                    >
                      Deposit
                    </button>
                    <button
                      className={b.secondary}
                      onClick={() =>
                        navigate("vault", vault.id, { action: "withdraw" })
                      }
                    >
                      Withdraw
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Exposure({ held }) {
  const [by, setBy] = useState("market");
  const rows = useMemo(
    () => exposure(held, (vault) => vault.position.balance, by),
    [held, by],
  );
  return (
    <Section
      id="where"
      title="Where the money is"
      lede="Your balance by market or network, at each vault’s current allocation."
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
              flexGrow: Math.max(row.share, 1.2),
              background:
                row.color ||
                ["#196aff", "#0b1b2b", "#7fa7f5", CASH_COLOR][index % 4],
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
              <th className={b.num}>Share</th>
              <th className={b.num}>Yours</th>
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
                        background:
                          row.color ||
                          ["#196aff", "#0b1b2b", "#7fa7f5", CASH_COLOR][
                            index % 4
                          ],
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
                    {row.icon && <img src={row.icon} width="18" height="18" alt="" />}
                    {row.name}
                  </span>
                </td>
                <td className={b.num} data-label="Rate now">
                  {pct(row.rate)}
                </td>
                <td className={b.num} data-label="Share">
                  {row.share.toFixed(1)}%
                </td>
                <td className={b.num} data-label="Yours">
                  {money(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function PortfolioPage({
  book,
  user,
  batch,
  mine,
  account,
  navigate,
  institution,
}) {
  const { account: holdings } = book;
  const ledger = useMemo(
    () => mineLedger({ mine: mine.data, account, batch: batch.feed }),
    [mine.data, account, batch.feed],
  );
  const name = useMemo(() => vaultNamer(book), [book]);
  const title = institution ? "Treasury" : "Portfolio";
  if (!user)
    return (
      <div className={b.page}>
        <header className={b.pageHead}>
          <div>
            <h1 tabIndex={-1}>{title}</h1>
            <p className={b.pageLede}>
              Connect a wallet to see your balance across every vault, what it
              has earned and where it is.
            </p>
          </div>
        </header>
        <Compare book={book} navigate={navigate} />
      </div>
    );
  if (!user.walletAddress)
    return (
      <div className={b.page}>
        <header className={b.pageHead}>
          <div>
            <h1 tabIndex={-1}>{title}</h1>
            <p className={b.pageLede}>
              Link your treasury wallet to see its balance, earnings and
              activity here. Transactions are signed in that wallet.
            </p>
          </div>
          <button className={b.primary} onClick={() => navigate("settings")}>
            Link a wallet
          </button>
        </header>
        <Compare book={book} navigate={navigate} />
      </div>
    );
  const { held, wallet, attention } = holdings;
  const holds = held.length > 0;
  const price = batch.feed?.vault?.tick?.rateBid;
  // Each vault's daily estimate, added up by day.
  const earnedByDay = new Map();
  for (const row of mine.data?.vaults || [])
    for (const day of row.dailyEarned || [])
      earnedByDay.set(day.t, (earnedByDay.get(day.t) || 0) + (day.v || 0));
  const earnedDays = [...earnedByDay.entries()]
    .sort((a, c) => a[0] - c[0])
    .map(([t, v]) => ({ t, v }));
  return (
    <div className={b.page}>
      <h1 className={b.srOnly} tabIndex={-1}>
        {title}
      </h1>
      <section className={b.hero} aria-label="Your balance">
        <div>
          <span>{holdings.atLeast && holds ? "In vaults, at least" : "In vaults"}</span>
          <strong>
            {money(holdings.balance)} <small>{holds ? holdings.unit : "USDC"}</small>
          </strong>
          {holds && holdings.unit === "USD" && (
            <p>USDC and USDT0, added at face value.</p>
          )}
          {holdings.atLeast && (
            <p>Some vaults could not be read, so this may be incomplete.</p>
          )}
          {!holds && (
            <p>
              {wallet.length
                ? `You have ${wallet.map((row) => `${money(row.amount)} ${row.token} on ${row.network}`).join(", ")} ready to deposit.`
                : "Nothing deposited yet. You need USDC or USDT0 in your wallet to start."}
            </p>
          )}
        </div>
        {holds && (
          <dl>
            <div>
              <dt>{holdings.earnedPartial ? "Earned, some vaults" : "Earned"}</dt>
              <dd>
                {holdings.earned == null
                  ? "—"
                  : money(holdings.earned, Math.abs(holdings.earned) < 1 ? 4 : 2)}
              </dd>
            </div>
            <div>
              <dt>Rate now</dt>
              <dd>{pct(holdings.rateNow)}</dd>
              {book.index?.rateNow != null && holdings.rateNow != null && (
                <small>
                  Blue-chip index {pct(book.index.rateNow)}
                </small>
              )}
            </div>
            <div>
              <dt>At this rate</dt>
              <dd>{money(holdings.perMonth)} a month</dd>
            </div>
          </dl>
        )}
        {earnedDays.length > 1 && (
          <div className={b.heroSpark}>
            <span>Earned, last 30 days (estimate)</span>
            <EarnedSpark days={earnedDays} />
          </div>
        )}
      </section>
      {attention.length > 0 && (
        <Section title="In progress">
          <div className={b.requests}>
            {attention.map(({ vault, request }) => (
              <RequestRow
                key={vault.id + request.id}
                request={request}
                price={price}
                batch={batch}
                compactVault={vault.kind === "batch" ? vault.title : `${vault.title}, ${vault.place}`}
              />
            ))}
          </div>
        </Section>
      )}
      {holds ? (
        <>
          <Positions held={held} navigate={navigate} />
          <Exposure held={held} />
        </>
      ) : (
        <Compare book={book} navigate={navigate} />
      )}
      {holds && wallet.length > 0 && (
        <Section title="In your wallet" lede="Ready to deposit. Never counted in the balance above.">
          <ul className={b.walletList}>
            {wallet.map((row) => (
              <li key={row.network + row.token}>
                <strong>
                  {money(row.amount)} {row.token}
                </strong>
                <span>on {row.network}</span>
                <button
                  className={b.linkButton}
                  onClick={() => {
                    const target = book.vaults.find(
                      (vault) =>
                        vault.kind === "instant" &&
                        vault.depositNetwork === row.network &&
                        vault.token === row.token,
                    );
                    if (target)
                      navigate("vault", target.id, { action: "deposit" });
                  }}
                >
                  Deposit
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {ledger.length > 0 && (
        <Section
          title="Recent activity"
          aside={
            <button
              className={b.linkButton}
              onClick={() => navigate("activity")}
            >
              Full activity
            </button>
          }
        >
          <LedgerRows rows={ledger.slice(0, 5)} vaultName={name} />
        </Section>
      )}
    </div>
  );
}
