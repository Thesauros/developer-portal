"use client";
import { useMemo, useState } from "react";
import { ledgerCsv, mineLedger, vaultNamer } from "./activity";
import { LedgerRows } from "./ledger";
import { money, Segmented, usePublicResource } from "./parts";
import b from "./book.module.css";

const TYPES = {
  mine: [
    ["all", "All", () => true],
    ["money", "Deposits and withdrawals", (row) => ["deposit", "withdraw", "request", "collect", "cancel"].includes(row.kind)],
    ["earned", "Earnings", (row) => row.kind === "earned"],
  ],
  all: [
    ["all", "All", () => true],
    ["moved", "Money moved", (row) => ["rebalance", "transfer"].includes(row.kind)],
    ["batch", "Batches", (row) => row.kind === "batch"],
    ["gap", "Valuation gaps", (row) => row.kind === "gap"],
  ],
};

// One record: a wallet's own history, or what every vault did. The vault-wide
// record has no wallet in it, so anyone can read it; it lives in Transparency.
export function Ledger({ book, scope, mine, account, batch, limit = 200 }) {
  const [all, setAll] = useState(false);
  const [type, setType] = useState("all");
  const [vaultId, setVaultId] = useState("");
  const publicFeed = usePublicResource("/api/vaults/feed", { refreshMs: 120000 });
  const name = useMemo(() => vaultNamer(book), [book]);
  const mineRows = useMemo(
    () =>
      scope === "mine"
        ? mineLedger({ mine: mine?.data, account, batch: batch?.feed })
        : [],
    [scope, mine?.data, account, batch?.feed],
  );
  const source = scope === "mine" ? mineRows : publicFeed.data?.items || [];
  const filter = (TYPES[scope].find(([id]) => id === type) || TYPES[scope][0])[2];
  const rows = source.filter(
    (row) => filter(row) && (!vaultId || row.vaultId === vaultId),
  );
  const sum = (kind) =>
    mineRows
      .filter((row) => row.kind === kind && row.unit !== "shares")
      .reduce((total, row) => total + (row.amount || 0), 0);
  const unreadable = Object.entries(publicFeed.data?.sources?.rebalances || {})
    .filter(([, complete]) => !complete)
    .map(([id]) => {
      const vault = book.byId[id];
      return vault ? `${vault.title} on ${vault.place}` : null;
    })
    .filter(Boolean);
  return (
    <>
      {scope === "mine" && mineRows.length > 0 && (
        <dl className={b.facts}>
          <div>
            <dt>Deposited</dt>
            <dd>{money(sum("deposit"))}</dd>
          </div>
          <div>
            <dt>Withdrawn</dt>
            <dd>{money(sum("withdraw"))}</dd>
          </div>
          <div>
            <dt>Earned, 30 days</dt>
            <dd>{money(sum("earned"))}</dd>
            <small>estimate from each day’s rate</small>
          </div>
        </dl>
      )}
      <div className={b.filterBar}>
        <Segmented
          label="Type"
          value={type}
          onChange={setType}
          options={TYPES[scope].map(([value, label]) => ({ value, label }))}
        />
        <select
          className={b.select}
          value={vaultId}
          onChange={(event) => setVaultId(event.target.value)}
          aria-label="Vault"
        >
          <option value="">All vaults</option>
          {book.vaults.map((vault) => (
            <option key={vault.id} value={vault.id}>
              {name(vault.id)}
            </option>
          ))}
        </select>
        {rows.length > 0 && (
          <a
            className={b.linkOut}
            href={ledgerCsv(rows, name)}
            download="thesauros-activity.csv"
          >
            Export CSV
          </a>
        )}
      </div>
      {rows.length ? (
        <>
          <LedgerRows rows={rows.slice(0, all ? 200 : limit)} vaultName={name} byDay />
          {!all && rows.length > limit && (
            <button
              className={`${b.linkButton} ${b.moreButton}`}
              onClick={() => setAll(true)}
            >
              Show all {Math.min(rows.length, 200)}
            </button>
          )}
        </>
      ) : (
        <p className={b.emptyBlock}>
          {scope === "mine"
            ? mine.loading
              ? "Loading your history…"
              : "Nothing here yet. Your deposits, withdrawals and requests will appear here."
            : publicFeed.loading
              ? "Loading…"
              : "Nothing here for this filter."}
        </p>
      )}
      {scope === "all" && unreadable.length > 0 && (
        <p className={b.footnote}>
          Moves between markets in the {unreadable.join(" and ")}{" "}
          {unreadable.length === 1 ? "vault" : "vaults"} cannot be read from
          public nodes yet, so they are missing from this list.
        </p>
      )}
      {scope === "mine" && (
        <p className={b.footnote}>
          Read from the vault contracts. Daily earnings are estimated from the
          amount held each day and that day’s rate; the Earned figure in your
          portfolio is exact when the history explains your whole balance.
        </p>
      )}
    </>
  );
}

export default function ActivityPage({ book, user, mine, account, batch, navigate }) {
  const signedIn = !!user?.walletAddress;
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Activity</h1>
          <p className={b.pageLede}>
            {signedIn
              ? "Your deposits, withdrawals, requests and estimated earnings, across every vault."
              : "Connect a wallet to see your own history here."}
          </p>
          <p className={b.footnote}>
            What every vault did, every move between markets and networks, is in{" "}
            <button className={b.linkButton} onClick={() => navigate("transparency")}>
              Transparency
            </button>
            .
          </p>
        </div>
      </header>
      {signedIn && (
        <Ledger book={book} scope="mine" mine={mine} account={account} batch={batch} />
      )}
    </div>
  );
}
