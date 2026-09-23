"use client";
import { useMemo, useState } from "react";
import { getVault } from "../../../lib/vault-contracts.mjs";
import { ActivityRows } from "./Portfolio";
import { money } from "./format";
import c from "./cabinet.module.css";

// Onchain history from the vault data service, plus transactions sent from this
// browser that the indexer has not picked up yet.
export function mergeActivity(indexed, local) {
  const known = new Set(indexed.map((t) => t.txHash.toLowerCase()));
  const pending = local
    .filter((t) => t.kind !== "approve")
    .filter((t) => !known.has((t.replacementHash || t.hash).toLowerCase()))
    .filter((t) => t.status !== "cancelled" && t.status !== "reverted")
    .map((t) => {
      const vault = getVault(t.vaultId);
      const hash = t.replacementHash || t.hash;
      return {
        txHash: hash,
        kind: t.kind,
        network: vault.name,
        token: vault.symbol,
        at: t.createdAt ? Date.parse(t.createdAt) || t.createdAt : null,
        amount: Number(t.amount) || null,
        url: vault.explorer + "/tx/" + hash,
        status: t.status,
      };
    });
  return [...pending, ...indexed].sort((a, b) => (b.at || 0) - (a.at || 0));
}

function csv(rows) {
  const lines = [
    "date,type,network,token,amount,transaction",
    ...rows.map((r) =>
      [
        r.at ? new Date(r.at).toISOString() : "",
        r.kind,
        r.network,
        r.token,
        r.amount ?? "",
        r.txHash,
      ].join(","),
    ),
  ];
  return "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
}

export default function Activity({ account, mine }) {
  const [filter, setFilter] = useState("all");
  const all = useMemo(
    () =>
      mergeActivity(mine.data?.transactions || [], account.transactions || []),
    [mine.data, account.transactions],
  );
  const rows = filter === "all" ? all : all.filter((r) => r.kind === filter);
  const deposited = all
    .filter((r) => r.kind === "deposit")
    .reduce((s, r) => s + (r.amount || 0), 0);
  const withdrawn = all
    .filter((r) => r.kind === "withdraw")
    .reduce((s, r) => s + (r.amount || 0), 0);
  return (
    <div className={c.page}>
      <dl className={c.summaryRow}>
        <div>
          <dt>Deposited</dt>
          <dd>{money(deposited)}</dd>
        </div>
        <div>
          <dt>Withdrawn</dt>
          <dd>{money(withdrawn)}</dd>
        </div>
        <div>
          <dt>Net deposited</dt>
          <dd>{money(deposited - withdrawn)}</dd>
        </div>
        <div>
          <dt>Transactions</dt>
          <dd>{all.length}</dd>
        </div>
      </dl>
      <section className={c.section}>
        <header className={c.sectionHead}>
          <div className={c.segmented} role="group" aria-label="Filter">
            {[
              ["all", "All"],
              ["deposit", "Deposits"],
              ["withdraw", "Withdrawals"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {all.length > 0 && (
            <a
              className={c.secondary}
              href={csv(rows)}
              download="thesauros-activity.csv"
            >
              Export CSV
            </a>
          )}
        </header>
        {mine.error && <p className={c.notice}>{mine.error}</p>}
        {mine.loading && !mine.data ? (
          <p className={c.emptyLine}>Loading your history…</p>
        ) : (
          <ActivityRows
            rows={rows}
            empty={
              filter === "all"
                ? "No deposits or withdrawals yet. Your first deposit will appear here with its receipt."
                : "Nothing here for this filter."
            }
          />
        )}
        <p className={c.footnote}>
          History comes from indexed vault events for your wallet on Arbitrum,
          Base, Monad and Plasma. New transactions appear within a few minutes
          of confirmation.
        </p>
      </section>
    </div>
  );
}
