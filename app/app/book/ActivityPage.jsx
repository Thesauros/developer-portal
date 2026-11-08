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

// One record of everything, for one wallet or for all vaults. The vault-wide view
// has no wallet in it, so anyone can read it.
export default function ActivityPage({ book, user, mine, account, batch }) {
  const signedIn = !!user?.walletAddress;
  const [scope, setScope] = useState(signedIn ? "mine" : "all");
  const [type, setType] = useState("all");
  const [vaultId, setVaultId] = useState("");
  const publicFeed = usePublicResource("/api/vaults/feed", { refreshMs: 120000 });
  const name = useMemo(() => vaultNamer(book), [book]);
  const mineRows = useMemo(
    () => mineLedger({ mine: mine.data, account, batch: batch.feed }),
    [mine.data, account, batch.feed],
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
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Activity</h1>
          <p className={b.pageLede}>
            {scope === "mine"
              ? "Your deposits, withdrawals, requests and estimated earnings, across every vault."
              : "What every vault did: money moved between markets and networks, batches settled and any gap in valuations."}
          </p>
        </div>
        {signedIn && (
          <Segmented
            label="Whose activity"
            value={scope}
            onChange={(next) => {
              setScope(next);
              setType("all");
            }}
            options={[
              { value: "mine", label: "Mine" },
              { value: "all", label: "All vaults" },
            ]}
          />
        )}
      </header>
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
        <LedgerRows rows={rows.slice(0, 200)} vaultName={name} byDay />
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
    </div>
  );
}
