import { mergeActivity } from "./feed";
import { BATCH_VAULT_ID } from "../../../lib/vault-facts.mjs";
import { crosschain } from "../../../lib/crosschain-config.mjs";

const BATCH_EVENT = {
  deposit_requested: ["request", "Deposit requested"],
  redeem_requested: ["request", "Withdrawal requested"],
  request_cancelled: ["cancel", "Request cancelled"],
  deposit_claimed: ["collect", "Deposit collected"],
  redeem_claimed: ["collect", "Withdrawal collected"],
  instant_exit: ["withdraw", "Instant withdrawal"],
};

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
  // The vault's requests. A share amount is shown with the USDC it stands for:
  // what was requested for a collected deposit, today's price for a withdrawal
  // that has not settled yet.
  const events = batch?.activity?.events || [];
  const cancelled = new Set(
    events.filter((event) => event.type === "request_cancelled").map((event) => event.requestId),
  );
  const asked = new Map(
    events
      .filter((event) => event.type === "deposit_requested" && event.assets != null)
      .map((event) => [event.requestId, Number(event.assets) / 1e6]),
  );
  const price = /^\d+$/.test(String(batch?.vault?.tick?.rateBid ?? ""))
    ? Number(batch.vault.tick.rateBid) / 1e18
    : null;
  for (const event of events) {
    const known = BATCH_EVENT[event.type];
    if (!known) continue;
    const [kind, title] = known;
    const shares = event.type === "redeem_requested" || event.type === "deposit_claimed";
    const amount =
      event.assets != null
        ? Number(event.assets) / 1e6
        : event.shares != null
          ? Number(event.shares) / 1e6
          : null;
    const stands =
      !shares || amount == null
        ? null
        : event.type === "deposit_claimed"
          ? (asked.get(event.requestId) ?? null)
          : price != null
            ? amount * price
            : null;
    rows.push({
      id: event.txHash + ":" + event.logIndex,
      kind,
      title,
      at: event.at,
      vaultId: BATCH_VAULT_ID,
      amount,
      token: "USDC",
      unit: shares ? "shares" : "USDC",
      // What a share amount is in USDC, and whether that figure is exact.
      stands,
      about: stands != null && event.type !== "deposit_claimed",
      // Money that went in or came out, for the totals: a deposit counts when
      // it is requested unless it was cancelled, a withdrawal when collected.
      flow:
        event.type === "deposit_requested" && !cancelled.has(event.requestId)
          ? "in"
          : event.type === "redeem_claimed" || event.type === "instant_exit"
            ? "out"
            : null,
      url: crosschain.explorer + "/tx/" + event.txHash,
    });
  }
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
