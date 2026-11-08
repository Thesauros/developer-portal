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
  for (const event of batch?.activity?.events || []) {
    const known = BATCH_EVENT[event.type];
    if (!known) continue;
    const [kind, title] = known;
    const shares = event.type === "redeem_requested" || event.type === "deposit_claimed";
    rows.push({
      id: event.txHash + ":" + event.logIndex,
      kind,
      title,
      at: event.at,
      vaultId: BATCH_VAULT_ID,
      amount:
        event.assets != null
          ? Number(event.assets) / 1e6
          : event.shares != null
            ? Number(event.shares) / 1e6
            : null,
      token: "USDC",
      unit: shares ? "shares" : "USDC",
      url: crosschain.explorer + "/tx/" + event.txHash,
    });
  }
  return rows.sort((a, c) => (c.at || 0) - (a.at || 0));
}

export const vaultNamer = (book) => (id) => {
  const vault = book.byId[id];
  if (!vault) return "";
  return vault.kind === "batch" ? vault.title : `${vault.title}, ${vault.place}`;
};

export function ledgerCsv(rows, name) {
  const lines = [
    "date,type,vault,detail,amount,unit,transaction",
    ...rows.map((row) =>
      [
        row.at ? new Date(row.at).toISOString() : "",
        row.kind,
        `"${name(row.vaultId)}"`,
        `"${row.title || (row.fromName ? row.fromName + " to " + row.toName : "")}"`,
        row.amount ?? "",
        row.unit || row.token || "",
        row.url || "",
      ].join(","),
    ),
  ];
  return "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
}
