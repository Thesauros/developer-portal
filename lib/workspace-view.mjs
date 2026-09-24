// A null selection includes networks discovered on subsequent data refreshes.
// An empty selection deliberately shows no results.
export function filterNetworks(items, selection, name = (item) => item.name) {
  return selection === null
    ? items
    : items.filter((item) => selection.includes(name(item)));
}

export function toggleNetwork(selection, network, options) {
  const next = new Set(selection === null ? options : selection);
  if (next.has(network)) next.delete(network);
  else next.add(network);
  return options.every((name) => next.has(name)) ? null : [...next];
}

export function vaultRows(networks) {
  return networks.flatMap((network) =>
    network.vaults.map((vault) => ({
      ...vault,
      network,
      id: `${network.key}:${vault.address}`,
    })),
  );
}

export function assetTotals(networks) {
  const tokens = new Map();
  for (const vault of vaultRows(networks)) {
    const total = tokens.get(vault.token) || {
      token: vault.token,
      assets: null,
      reporting: 0,
      count: 0,
      stale: false,
    };
    total.count++;
    if (typeof vault.assets === "number" && Number.isFinite(vault.assets)) {
      total.assets = (total.assets ?? 0) + vault.assets;
      total.reporting++;
    }
    total.stale ||=
      !!vault.network.stale || vault.network.status === "degraded";
    tokens.set(vault.token, total);
  }
  return [...tokens.values()].sort((a, b) => a.token.localeCompare(b.token));
}

export function csvContent(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? "");
          if (typeof value === "string" && /^[=+\-@\t\r]/.test(text))
            text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}

export function vaultReport(networks) {
  return csvContent([
    [
      "Network",
      "Vault",
      "Asset",
      "Reported assets",
      "Supply APY %",
      "Data status",
      "Observed UTC",
    ],
    ...vaultRows(networks).map((vault) => [
      vault.network.name,
      vault.address,
      vault.token,
      vault.assets,
      vault.apy,
      vault.assets == null
        ? "Unavailable"
        : vault.network.stale || vault.network.status === "degraded"
          ? "Last received"
          : "Available",
      vault.network.observedAt || "",
    ]),
    ...networks
      .filter((network) => !network.vaults.length)
      .map((network) => [
        network.name,
        "",
        "",
        null,
        null,
        "Unavailable",
        network.observedAt || "",
      ]),
  ]);
}
