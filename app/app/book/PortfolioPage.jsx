"use client";
import { useMemo, useState } from "react";
import { exposure, CASH_COLOR } from "../../../lib/vault-book.mjs";
import { positionSeries } from "../../../lib/crosschain-feed.mjs";
import { MIGRATION_VAULT_IDS } from "../../../lib/migration-state.mjs";
import { DAY } from "../../../lib/vault-metrics.mjs";
import { RequestRow, batchClosing } from "./ActionPanel";
import BalanceChart from "./BalanceChart";
import { LedgerRows } from "./ledger";
import { mineLedger, vaultNamer } from "./activity";
import {
  MeasuredRate,
  money,
  NetworkMarks,
  pct,
  Section,
  Segmented,
  TokenMark,
  VsIndex,
} from "./parts";
import { ConnectAction } from "../wallet/WalletAccess";
import b from "./book.module.css";
import c from "./portfolio.module.css";

const small = (value) => money(value, Math.abs(value) < 1 ? 4 : 2);

// The balance, on the one blue surface of the screen.
function Plate({ book, move, navigate }) {
  const { vault } = book;
  const account = book.account;
  const { position } = vault;
  const holds = account.balance > 0;
  const leaving = (position.leaving || 0) + (position.out || 0);
  const buckets = [
    position.arriving > 0 && ["arriving", position.arriving],
    position.ready > 0 && ["to collect", position.ready],
    leaving > 0 && ["leaving", leaving],
  ].filter(Boolean);
  const ready = account.ready;
  // Money in a previous vault is the person's money with Thesauros too: the
  // figure on top counts it, and says where each part is.
  const before = account.previousBalance || 0;
  const split = before > 0;
  const unit = split && account.previousUnit !== "USDC" ? "USD" : "USDC";
  return (
    <section className={c.plate} aria-label="Your balance">
      <div className={c.plateMain}>
        <span>{split ? "With Thesauros" : `In ${vault.title}`}</span>
        <strong>
          {account.known ? money(account.balance + before) : "—"} <small>{unit}</small>
        </strong>
        {(split || buckets.length > 0) && (
          <div className={c.buckets}>
            {split && (
              <>
                <span>
                  <b>{money(account.balance)}</b> in {vault.title}
                </span>
                <span>
                  <b>{money(before)}</b> in previous vaults
                </span>
              </>
            )}
            {!split && position.earning > 0 && (
              <span>
                <b>{money(position.earning)}</b> earning
              </span>
            )}
            {buckets.map(([label, amount]) => (
              <span key={label} data-part={split || undefined}>
                {split ? "of it, " : ""}
                <b>{money(amount)}</b> {label}
              </span>
            ))}
          </div>
        )}
        {!holds && (
          <p>
            {!account.known
              ? "Reading your balance from the vault…"
              : split
                ? "It keeps earning in the previous vault until you move or withdraw it."
                : move?.amount > 0
                  ? `Nothing in the vault yet. ${money(move.amount)} USDC you withdrew from a previous vault is waiting in your wallet: see below.`
                  : ready
                  ? `You have ${money(ready.amount)} USDC on ${ready.network}, ready to deposit.`
                  : `Nothing deposited yet. The vault takes USDC on ${vault.depositNetwork}.`}
          </p>
        )}
      </div>
      <div className={c.plateActions}>
        <button data-main onClick={() => navigate("earn", null, { action: "deposit" })}>
          Deposit
        </button>
        {holds && (
          <button onClick={() => navigate("earn", null, { action: "withdraw" })}>
            Withdraw
          </button>
        )}
      </div>
      {holds && (
        <dl className={c.plateFacts}>
          <div>
            <dt>{split ? `Earned in ${vault.title}` : "Earned"}</dt>
            <dd>
              {account.earned == null ? (
                "—"
              ) : (
                <>
                  {Math.abs(account.earned) < 0.00005 ? "" : account.earned > 0 ? "+" : "−"}
                  {Math.abs(account.earned) < 0.00005 ? "0.00" : small(Math.abs(account.earned))}{" "}
                  <small>USDC</small>
                </>
              )}
            </dd>
            <small>
              {account.earned == null ? "your history is still being read" : "since your first deposit"}
            </small>
          </div>
          <div>
            <dt>{split ? "Its rate now" : "Rate now"}</dt>
            <dd>{pct(account.rateNow)}</dd>
            {book.index?.rateNow != null && (
              <small>Market Average {pct(book.index.rateNow)}</small>
            )}
          </div>
          <div>
            <dt>At this rate, a month</dt>
            <dd>
              {money(account.perMonth)} <small>USDC</small>
            </dd>
            <small>before fees; rates change</small>
          </div>
          <div>
            <dt>At this rate, a year</dt>
            <dd>
              {money(account.perYear)} <small>USDC</small>
            </dd>
            <small>if the rate held</small>
          </div>
        </dl>
      )}
    </section>
  );
}

// For a wallet with nothing in the vault: what the product is and how a deposit
// goes, in the order it happens.
function Start({ book, navigate }) {
  const { vault, product } = book;
  const record = product.record;
  return (
    <section className={c.start} aria-label="Start earning">
      <div>
        <div className={c.startHead}>
          <TokenMark token="USDC" size={36} />
          <h2>
            USDC <span>{vault.product.tag}</span>
          </h2>
        </div>
        <p>{vault.product.line}</p>
        <dl className={c.startFacts}>
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
            <small>all its USDC vaults, a year</small>
          </div>
          <div>
            <dt>Withdrawals</dt>
            <dd>In batches</dd>
            <small>no time is promised</small>
          </div>
        </dl>
        <div className={c.startActions}>
          <button
            className={b.primary}
            disabled={!vault.open.deposits}
            onClick={() => navigate("earn", null, { action: "deposit" })}
          >
            Deposit USDC
          </button>
          <button className={b.linkButton} onClick={() => navigate("earn")}>
            Everything about the vault
          </button>
        </div>
      </div>
      <ol className={c.steps}>
        <li>
          <strong>Deposit USDC on {vault.depositNetwork}</strong>
          <span>
            Approve the exact amount, then request the deposit. Two
            confirmations in your wallet.
          </span>
        </li>
        <li>
          <strong>The batch settles</strong>
          <span>
            Deposits settle together at the vault’s next valuation. From then
            on yours earns.
          </span>
        </li>
        <li>
          <strong>Collect your shares</strong>
          <span>
            One more confirmation. Their price rises as the lending markets
            pay interest.
          </span>
        </li>
      </ol>
    </section>
  );
}

const SPANS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 0, label: "All" },
];

function Growth({ book, batch }) {
  const [mode, setMode] = useState("balance");
  const [days, setDays] = useState(0);
  const feed = batch.feed;
  const complete =
    !!feed?.activity?.coverage?.complete && !feed.activity.truncated && book.account.earned != null;
  const series = useMemo(() => {
    if (!complete) return [];
    // Every accepted valuation, from the public history: the wallet's own feed
    // carries only the latest few hundred.
    const points = positionSeries(feed.activity.events, book.vault.samples, {
      now: book.vault.observedAt || Date.now(),
    });
    if (!points.length) return points;
    // The last point is the figure the page states everywhere else.
    const last = points.at(-1);
    last.value = book.account.balance;
    last.earned = book.account.earned;
    last.invested = book.account.balance - book.account.earned;
    return points;
  }, [complete, feed?.activity, book.vault.samples, book.vault.observedAt, book.account.balance, book.account.earned]);
  if (series.length < 2) return null;
  const from = days ? series.at(-1).at - days * DAY : -Infinity;
  const points = series.filter((point) => point.at >= from);
  const age = (series.at(-1).at - series[0].at) / DAY;
  return (
    <Section
      id="growth"
      title="Your balance over time"
      lede={
        mode === "balance"
          ? "What your position was worth each day, above what you had put in."
          : "What the vault has added to your deposits, day by day."
      }
      aside={
        <div className={c.chartControls}>
          <Segmented
            label="Chart"
            value={mode}
            onChange={setMode}
            options={[
              { value: "balance", label: "Balance" },
              { value: "earned", label: "Earned" },
            ]}
          />
          <Segmented
            label="Period"
            value={days}
            onChange={setDays}
            options={SPANS.map((span) => ({
              ...span,
              disabled: !!span.value && age < span.value * 0.5,
            }))}
          />
        </div>
      }
    >
      <BalanceChart points={points.length > 1 ? points : series} mode={mode} />
    </Section>
  );
}

function Exposure({ vault, balance }) {
  const [by, setBy] = useState("market");
  const rows = useMemo(
    () => exposure([vault], () => balance, by),
    [vault, balance, by],
  );
  if (!rows.length) return null;
  return (
    <Section
      id="where"
      title="Where your money is lent"
      lede="Your balance at the vault’s split right now. The vault moves money between markets and networks; your share follows."
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
        {rows.map((row) => (
          <i
            key={row.name}
            style={{
              flexGrow: Math.max(row.share, 1.2),
              background: row.color || CASH_COLOR,
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
            {rows.map((row) => (
              <tr key={row.name}>
                <td data-cell="vault">
                  <span className={b.market}>
                    <i className={b.swatch} style={{ background: row.color || CASH_COLOR }} />
                    {row.logo && (
                      <img src={"/brand/protocols/" + row.logo + ".png"} width="18" height="18" alt="" />
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
                  {money(row.amount)} <small>USDC</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Versus({ book, navigate }) {
  const { product, index } = book;
  const record = product.record;
  if (!index) return null;
  return (
    <Section
      id="versus"
      title="Against the Market Average"
      lede="The Market Average is what the largest USDC lending markets pay, weighted by their size."
      aside={
        <button className={b.linkButton} onClick={() => navigate("index")}>
          See the comparison
        </button>
      }
    >
      <dl className={c.versus}>
        <div>
          <dt>This vault, now</dt>
          <dd>{pct(product.rateNow)}</dd>
          <small>
            <VsIndex diff={record.vs?.nowDiff} />
          </small>
        </div>
        <div>
          <dt>Market Average, now</dt>
          <dd>{pct(index.rateNow)}</dd>
          <small>what its markets pay today</small>
        </div>
        <div>
          <dt>Thesauros, 30 days</dt>
          <dd>
            <MeasuredRate measure={record.measure} />
          </dd>
          <small>
            <VsIndex diff={record.vs?.r30Diff} /> · all its USDC vaults
          </small>
        </div>
        <div>
          <dt>Market Average, 30 days</dt>
          <dd>{pct(record.vs?.r30 ?? index.r30)}</dd>
          <small>over the same days</small>
        </div>
      </dl>
    </Section>
  );
}

function Wallet({ book, navigate }) {
  const { vault } = book;
  const rows = book.account.wallet.filter((row) => row.token === vault.token);
  if (!rows.length) return null;
  return (
    <Section
      id="wallet"
      title="In your wallet"
      lede="Not in the vault and never counted in the balance above."
    >
      <ul className={c.rows}>
        {rows.map((row) => {
          const here = row.network === vault.depositNetwork;
          return (
            <li key={row.network + row.token}>
              <span className={c.rowName}>
                <strong>
                  <NetworkMarks networks={[row.network]} size={16} />
                  {row.token} on {row.network}
                </strong>
                <small>
                  {here
                    ? "Ready to deposit"
                    : `Send it to ${vault.depositNetwork} with the bridge in your wallet to deposit`}
                </small>
              </span>
              <span className={c.rowAmount}>
                {money(row.amount)} <small>{row.token}</small>
              </span>
              {here ? (
                <button
                  className={b.secondary}
                  disabled={!vault.open.deposits}
                  onClick={() => navigate("earn", null, { action: "deposit" })}
                >
                  Deposit
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// Money in the vaults before the product, and money on its way out of them.
// It stays the holder's; each line says where it is and offers one action.
function Previous({ book, move, navigate, unread = false }) {
  const rows = book.account.previous;
  const moving = (move?.moves || []).flatMap((item) => [
    item.inBatch > 0 && {
      key: item.id + ":batch",
      network: item.network,
      title: `Move from ${item.network}`,
      note: item.collect
        ? "Settled in the new vault · shares ready to collect"
        : "In the new vault’s open batch · waiting to settle",
      amount: item.inBatch,
      action: item.collect ? "Collect" : "See progress",
    },
    item.inWallet > 0 && {
      key: item.id + ":wallet",
      network: item.network,
      title: `Move from ${item.network}`,
      note: "Withdrawn · in your wallet, not earning, waiting to be deposited",
      amount: item.inWallet,
      action: "Continue",
    },
  ]).filter(Boolean);
  if (!rows.length && !moving.length)
    return unread ? (
      <p className={b.footnote} role="status">
        Some previous vaults could not be read right now, so a position there
        may be missing from this page.
      </p>
    ) : null;
  return (
    <section className={c.previous} aria-labelledby="previous-vaults">
      <h2 id="previous-vaults">Previous vaults</h2>
      <p>
        Thesauros now runs on one vault. Money in a previous vault stays yours,
        keeps earning there, and can be moved or withdrawn at any time.
      </p>
      <ul className={c.rows}>
        {rows.map((vault) => {
          const movable = MIGRATION_VAULT_IDS.includes(vault.id);
          return (
            <li key={vault.id}>
              <span className={c.rowName}>
                <strong>
                  <NetworkMarks networks={[vault.place]} size={16} />
                  {vault.title}
                </strong>
                <small>
                  {movable
                    ? "In the previous vault · takes no new deposits"
                    : "In the previous vault · withdraw only"}
                </small>
              </span>
              <span className={c.rowAmount}>
                {money(vault.position.balance)} <small>{vault.token}</small>
              </span>
              <button className={b.secondary} onClick={() => navigate("move")}>
                {movable ? "Move" : "Withdraw"}
              </button>
            </li>
          );
        })}
        {moving.map((item) => (
          <li key={item.key}>
            <span className={c.rowName}>
              <strong>
                <NetworkMarks networks={[item.network]} size={16} />
                {item.title}
              </strong>
              <small>{item.note}</small>
            </span>
            <span className={c.rowAmount}>
              {money(item.amount)} <small>USDC</small>
            </span>
            <button className={b.secondary} onClick={() => navigate("move")}>
              {item.action}
            </button>
          </li>
        ))}
      </ul>
      {unread && (
        <p className={b.footnote} role="status">
          Some previous vaults could not be read right now, so a position there
          may be missing from this list.
        </p>
      )}
    </section>
  );
}

export default function PortfolioPage({
  book,
  user,
  batch,
  mine,
  account,
  move,
  navigate,
  institution,
}) {
  const holdings = book.account;
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
              Connect a wallet to see your balance, what it has earned and
              where it is lent.
            </p>
          </div>
          <ConnectAction className={b.primary} />
        </header>
        <Start book={book} navigate={navigate} />
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
        <Start book={book} navigate={navigate} />
      </div>
    );
  const holds = holdings.balance > 0;
  const price = batch.feed?.vault?.tick?.rateBid;
  return (
    <div className={b.page}>
      <h1 className={b.srOnly} tabIndex={-1}>
        {title}
      </h1>
      <Plate book={book} move={move} navigate={navigate} />
      <Previous
        book={book}
        move={move}
        navigate={navigate}
        unread={book.account.previousUnread > 0 && !account.loading}
      />
      {holdings.attention.length > 0 && (
        <Section title="In progress">
          <div className={b.requests}>
            {holdings.attention.map(({ vault, request }) => (
              <RequestRow
                key={vault.id + request.id}
                request={request}
                price={price}
                batch={batch}
                closing={batchClosing(book.vault)}
              />
            ))}
          </div>
        </Section>
      )}
      {holds ? (
        <>
          <Growth book={book} batch={batch} />
          <Exposure vault={book.vault} balance={holdings.balance} />
          <Versus book={book} navigate={navigate} />
        </>
      ) : (
        <Start book={book} navigate={navigate} />
      )}
      <Wallet book={book} navigate={navigate} />
      {ledger.length > 0 && (
        <Section
          title="Recent activity"
          aside={
            <button className={b.linkButton} onClick={() => navigate("activity")}>
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
