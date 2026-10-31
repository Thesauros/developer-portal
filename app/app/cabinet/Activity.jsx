"use client";
import { useMemo, useState } from "react";
import { ActivityRows, combine } from "./Portfolio";
import Rail, { RailLayout } from "./Rail";
import { money } from "./format";
import { earningDays, mergeActivity, rebalancesWhileHeld } from "./feed";
import c from "./cabinet.module.css";

function csv(rows) {
  const lines = [
    "date,type,network,token,amount,from,to,transaction",
    ...rows.map((r) =>
      [
        r.at ? new Date(r.at).toISOString() : "",
        r.kind,
        r.network || "",
        r.token || "",
        r.amount ?? "",
        r.fromName || "",
        r.toName || "",
        r.txHash || "",
      ].join(","),
    ),
  ];
  return "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
}

const FILTERS = [
  ["all", "All"],
  ["money", "Deposits & withdrawals"],
  ["earned", "Earnings"],
  ["rebalance", "Rebalances"],
];

export default function Activity({
  account,
  mine,
  market,
  onEarn,
  navigate,
  needsWallet,
}) {
  const vaultRows = useMemo(
    () => combine(market.data, account, mine.data),
    [market.data, account, mine.data],
  );
  const [filter, setFilter] = useState("all");
  const money_ = useMemo(
    () =>
      mergeActivity(mine.data?.transactions || [], account.transactions || []),
    [mine.data, account.transactions],
  );
  const feed = useMemo(
    () =>
      [
        ...money_,
        ...earningDays(mine.data?.vaults),
        ...rebalancesWhileHeld(vaultRows, money_),
      ].sort((a, b) => (b.at || 0) - (a.at || 0)),
    [money_, mine.data, vaultRows],
  );
  const rows = feed.filter((r) =>
    filter === "all"
      ? true
      : filter === "money"
        ? r.kind === "deposit" || r.kind === "withdraw"
        : r.kind === filter,
  );
  const sum = (kind) =>
    feed
      .filter((r) => r.kind === kind)
      .reduce((s, r) => s + (r.amount || 0), 0);
  const moves = feed.filter((r) => r.kind === "rebalance").length;
  return (
    <RailLayout
      rail={
        <Rail
          rows={vaultRows}
          onEarn={onEarn}
          navigate={navigate}
          needsWallet={needsWallet}
        />
      }
    >
      <dl className={c.summaryRow}>
        <div>
          <dt>Deposited</dt>
          <dd>{money(sum("deposit"))}</dd>
        </div>
        <div>
          <dt>Withdrawn</dt>
          <dd>{money(sum("withdraw"))}</dd>
        </div>
        <div>
          <dt>Earned, 30 days (est.)</dt>
          <dd className={c.positive}>{money(sum("earned"))}</dd>
        </div>
        <div>
          <dt>Rebalances of your vaults</dt>
          <dd>{moves}</dd>
        </div>
      </dl>
      <section className={c.section}>
        <header className={c.sectionHead}>
          <div className={c.segmented} role="group" aria-label="Filter">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {feed.length > 0 && (
            <a
              className={c.secondary}
              href={csv(rows)}
              download="thesauros-statement.csv"
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
                ? "Nothing yet. Your deposits, daily earnings and the rebalances that move your money will appear here."
                : "Nothing here for this filter."
            }
          />
        )}
        <p className={c.footnote}>
          Deposits, withdrawals and rebalances are read from the vault contracts
          on all four networks. Daily earnings are estimated from the amount you
          held each day and that day’s vault rate; total earned in the account
          panel is exact (current value minus net deposits). Rebalances show
          what the whole vault moved, not only your share.
        </p>
      </section>
    </RailLayout>
  );
}
