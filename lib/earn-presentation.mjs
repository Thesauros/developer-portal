import { amountUnits, displayAmount, tokenAmount } from "./vault-contracts.mjs";

const protocols = {
  Aave_V3_Provider: { key: "aave", name: "Aave" },
  Compound_V3_Provider: { key: "compound", name: "Compound" },
  Morpho_Provider: { key: "morpho", name: "Morpho" },
};

// A protocol-level account summary. Individual adapters remain inspectable in
// Vault explorer. A partial read must never become a complete-looking chart.
export function allocationSummary(providers = [], complete = false) {
  const grouped = new Map();
  let total = 0n,
    idle = 0;
  const coverage =
    complete &&
    providers.length > 0 &&
    providers.every((row) => row.assets != null);
  for (const row of providers) {
    const identity = protocols[row.name] || {
      key: row.address,
      name: (row.name || "Lending provider")
        .replace(/_Provider$/, "")
        .replaceAll("_", " "),
    };
    const assets = row.assets == null ? null : BigInt(row.assets);
    if (assets === 0n) {
      idle++;
      continue;
    }
    if (assets != null) total += assets;
    const group = grouped.get(identity.key) || {
      ...identity,
      logo: protocols[row.name]?.key,
      assets: 0n,
      count: 0,
    };
    group.assets =
      group.assets == null || assets == null ? null : group.assets + assets;
    group.count++;
    grouped.set(identity.key, group);
  }
  const rows = [...grouped.values()]
    .sort((a, b) => {
      if (a.assets == null)
        return b.assets == null ? a.name.localeCompare(b.name) : 1;
      if (b.assets == null) return -1;
      return a.assets === b.assets
        ? a.name.localeCompare(b.name)
        : a.assets > b.assets
          ? -1
          : 1;
    })
    .map((row) => ({
      ...row,
      shareBps:
        coverage && total > 0n && row.assets != null
          ? Number((row.assets * 10000n) / total)
          : null,
    }));
  return { rows, total, idle, coverage };
}

export function balanceLabel(units) {
  return units != null && BigInt(units) > 0n && BigInt(units) < 10000n
    ? "<0.01"
    : displayAmount(units);
}

// This is immediate input feedback only. The transaction engine still re-reads
// balances, minimums and pause state and simulates before every wallet request.
export function amountFeedback({ amount, mode, position, all = false }) {
  if (!amount || position?.status !== "ready") return "";
  if (all && mode === "withdraw") return "";
  try {
    const units = amountUnits(amount);
    if (mode === "deposit" && units < BigInt(position.minAssets))
      return `The minimum deposit is ${tokenAmount(position.minAssets)} USDC.`;
    if (
      units >
      BigInt(mode === "deposit" ? position.cash : position.positionAssets)
    )
      return mode === "deposit"
        ? "This amount is above your wallet balance on this network."
        : "This amount is above your current Earn balance.";
    return "";
  } catch (error) {
    return error.message;
  }
}
