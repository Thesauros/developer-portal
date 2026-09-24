import { getVault } from "../../../lib/vault-contracts.mjs";

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

// Rebalances count as your activity only while you held a position in that
// vault: net deposits into it were positive at the time.
export function rebalancesWhileHeld(vaultRows, transactions) {
  const out = [];
  for (const v of vaultRows) {
    const own = transactions
      .filter((t) => t.network === v.network && t.at)
      .sort((a, b) => a.at - b.at);
    if (!own.length) continue;
    for (const e of v.rebalances || []) {
      const net = own
        .filter((t) => t.at <= e.at)
        .reduce(
          (sum, t) => sum + (t.kind === "withdraw" ? -1 : 1) * (t.amount || 0),
          0,
        );
      if (net > 0.000001)
        out.push({
          kind: "rebalance",
          at: e.at,
          amount: e.amount,
          token: v.token,
          network: v.network,
          fromName: e.fromName,
          toName: e.toName,
          txHash: e.txHash,
          url: v.explorer + "/tx/" + e.txHash,
        });
    }
  }
  return out;
}

// Daily earnings summed across vaults, one row per day with a positive value.
export function earningDays(mineVaults) {
  const byDay = new Map();
  for (const v of mineVaults || [])
    for (const t of v.dailyEarned || [])
      if (t.v > 0) byDay.set(t.t, (byDay.get(t.t) || 0) + t.v);
  return [...byDay.entries()].map(([at, amount]) => ({
    kind: "earned",
    at,
    amount,
    token: "USDC",
  }));
}
