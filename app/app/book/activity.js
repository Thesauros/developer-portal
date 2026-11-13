import { mergeActivity } from "./feed";
import { BATCH_VAULT_ID } from "../../../lib/vault-facts.mjs";
import { crosschain } from "../../../lib/crosschain-config.mjs";
import { requestRows } from "../../../lib/crosschain-feed.mjs";

// Everything this wallet did, in every vault, as one list.
export function mineLedger({ mine, account, batch }) {
  const rows = [];
  for (const tx of mergeActivity(
    mine?.transactions || [],
    account?.transactions || [],
  ))
    rows.push({
      id: tx.txHash + tx.kind,
      kind: tx.kind,
      title: tx.kind === "deposit" ? "Deposit" : "Withdrawal",
      at: tx.at,
      vaultId: tx.vaultId || tx.network?.toLowerCase(),
      amount: tx.amount,
      token: tx.token,
      url: tx.url,
      note:
        tx.status && tx.status !== "success" ? "Awaiting confirmation" : "",
    });
  for (const vault of mine?.vaults || [])
    for (const day of vault.dailyEarned || [])
      if (day.v > 0)
        rows.push({
          id: "earned:" + vault.vaultId + day.t,
          kind: "earned",
          title: "Earned (estimate)",
          at: day.t,
          vaultId: vault.vaultId,
          amount: day.v,
          token: vault.vaultId === "plasma" ? "USDT0" : "USDC",
        });
  for (const row of requestRows(batch?.activity?.events, batch?.vault?.tick?.rateBid))
    rows.push({
      ...row,
      vaultId: BATCH_VAULT_ID,
      url: crosschain.explorer + "/tx/" + row.txHash,
    });
  return rows.sort((a, c) => (c.at || 0) - (a.at || 0));
}

export const vaultNamer = (book) => (id) => {
  const vault = book.byId[id];
  if (!vault) return "";
  return vault.previous ? `${vault.title}, previous vault` : vault.title;
};

// What a row says in the file: a batch carries its size, a gap its length.
function csvDetail(row) {
  if (row.kind === "batch")
    return `${row.settled ? "Batch settled" : "Batch in progress"}, ${row.requests} ${row.requests === 1 ? "request" : "requests"}${row.redeems ? `, ${row.redeems} shares out` : ""}`;
  if (row.kind === "gap")
    return `No valuation published for ${Math.round(row.hours)} hours${row.until ? ", until " + new Date(row.until).toISOString() : ""}`;
  return row.title || (row.fromName ? row.fromName + " to " + row.toName : "");
}

export function ledgerCsv(rows, name) {
  const lines = [
    "date,type,vault,detail,amount,unit,transaction",
    ...rows.map((row) =>
      [
        row.at ? new Date(row.at).toISOString() : "",
        row.kind,
        `"${name(row.vaultId)}"`,
        `"${csvDetail(row)}"`,
        row.kind === "batch" ? (row.deposits ?? "") : (row.stands ?? row.amount ?? ""),
        row.kind === "batch"
          ? "USDC deposited"
          : row.stands != null
            ? row.about
              ? "USDC (estimate)"
              : "USDC"
            : row.unit || row.token || "",
        row.url || "",
      ].join(","),
    ),
  ];
  return "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
}
