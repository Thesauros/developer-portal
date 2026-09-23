import { vaults as earnVaults } from "./vault-contracts.mjs";
import { allocationSummary } from "./earn-presentation.mjs";
import { formatUnits } from "viem";

const validAddress = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const time = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null;
const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const uint = (value) => {
  if (
    (typeof value === "string" && /^\d+$/.test(value)) ||
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    const parsed = BigInt(value);
    if (parsed >= 0n && parsed < 2n ** 256n) return parsed;
  }
  return null;
};
const decimal = (value, decimals) =>
  value === null ? null : finite(Number(formatUnits(value, decimals)));

/**
 * A separate, read-only source for the exact selected supported contract.
 * Supply rates are gross APR, never monitor APY or historical performance.
 */
export function onchainPlatformSnapshot(
  accountRows = [],
  selectedVault = null,
) {
  if (!validAddress(selectedVault?.address)) return null;
  const definition = earnVaults.find(
    (vault) =>
      vault.chainId === Number(selectedVault.chainId) &&
      vault.address.toLowerCase() === selectedVault.address.toLowerCase(),
  );
  if (!definition) return null;
  const snapshot = accountRows.find((row) => row?.id === definition.id);
  if (snapshot?.status !== "ready") return null;
  const observedProviders = Array.isArray(snapshot.providers)
    ? snapshot.providers
    : [];
  const providerRows = observedProviders.map((provider, index) => ({
    address: validAddress(provider?.address)
      ? provider.address
      : `unknown-provider-${index}`,
    name:
      typeof provider?.name === "string" ? provider.name : "Lending provider",
    assets: uint(provider?.assets),
  }));
  const allocation = allocationSummary(
    providerRows,
    snapshot.complete === true &&
      providerRows.every((provider) => validAddress(provider.address)),
  );
  const assetsRaw = uint(snapshot.totalAssets);
  const rateRay = uint(snapshot.rateRay);
  const blockNumber = uint(snapshot.blockNumber);
  return {
    id: definition.id,
    chainId: definition.chainId,
    address: definition.address,
    token: definition.symbol,
    assets: decimal(assetsRaw, definition.decimals),
    assetsRaw: assetsRaw?.toString() ?? null,
    grossApr: allocation.coverage ? decimal(rateRay, 25) : null,
    rateRay: allocation.coverage ? (rateRay?.toString() ?? null) : null,
    rateKind: "apr",
    providers: allocation.rows.map((provider) => ({
      key: provider.key,
      address: validAddress(provider.key) ? provider.key : null,
      name: provider.name,
      logo: provider.logo || null,
      balance: decimal(provider.assets, definition.decimals),
      share: provider.shareBps === null ? null : provider.shareBps / 100,
      apy: null,
      count: provider.count,
    })),
    configuredProviders: observedProviders.length,
    allocationComplete: allocation.coverage,
    observedAt: time(snapshot.observedAt) === null ? null : snapshot.observedAt,
    blockNumber: blockNumber?.toString() ?? null,
    source: `${definition.explorer}/address/${definition.address}`,
  };
}

/** Observed contracts only; identity is network + address, never token or name. */
export function platformVaults(networks = []) {
  return networks.flatMap((network) =>
    (network.vaults || [])
      .filter((vault) => validAddress(vault.address))
      .map((vault) => {
        const supported = earnVaults.find(
          (candidate) =>
            candidate.chainId === Number(network.chainId) &&
            candidate.address.toLowerCase() === vault.address.toLowerCase(),
        );
        const networkName = network.name || network.key;
        const key = `${network.key}:${vault.address.toLowerCase()}`;
        const history = historyPeriod(vault.history || [], "all");
        return {
          key,
          id: key,
          networkKey: network.key,
          chainId: Number(network.chainId),
          network: networkName,
          name: vault.name || `${vault.token || "Asset"} vault`,
          token: vault.token || null,
          address: vault.address,
          asset: validAddress(vault.asset) ? vault.asset : null,
          assets: finite(vault.assets),
          apy: finite(vault.apy),
          apySource: vault.apySource || null,
          history,
          historyRetained: !!vault.historyRetained,
          historyObservedAt:
            vault.historyObservedAt || network.observedAt || null,
          providers: vault.providers || [],
          lifetime: vault.lifetime || null,
          snapshotRetained: !!vault.snapshotRetained,
          snapshotObservedAt: vault.snapshotObservedAt || null,
          stale:
            !!vault.snapshotRetained ||
            !!network.stale ||
            network.status === "degraded",
          networkStatus: network.status || "unknown",
          observedAt: vault.snapshotRetained
            ? vault.snapshotObservedAt || null
            : vault.snapshotObservedAt || network.observedAt || null,
          fetchedAt: network.fetchedAt || null,
          explorer: network.explorer || null,
          source: network.source || null,
          status: vault.status || "unavailable",
          earnVaultId: supported?.id || null,
          isEarnVault: !!supported,
          selectionLabel: `${networkName} · ${vault.token || "Asset"} · ${supported ? "Earn vault" : "Observed vault"} · ${shortAddress(vault.address)}`,
        };
      }),
  );
}

/** Keep an explicit selection; otherwise prefer a current supported deployment. */
export function choosePlatformVault(rows = [], selectedKey = null) {
  const selected = rows.find((row) => row.key === selectedKey);
  if (selected) return selected;
  const supported = rows.filter((row) => row.isEarnVault);
  const candidates = supported.length ? supported : rows;
  return (
    candidates.find((row) => row.assets !== null && !row.stale) ||
    candidates.find((row) => row.assets !== null) ||
    candidates[0] ||
    null
  );
}

/**
 * Unknown-address events remain explicitly network-wide even with a vault
 * selection. Consumers can separate scope === 'network' from confirmed events.
 */
export function scopedEvents(networks = [], selectedVault = null, type = null) {
  const selectedAddress = validAddress(selectedVault?.address)
    ? selectedVault.address.toLowerCase()
    : null;
  return networks
    .filter(
      (network) =>
        !selectedVault ||
        (network.key === selectedVault.networkKey &&
          Number(network.chainId) === Number(selectedVault.chainId)),
    )
    .flatMap((network) =>
      (network.events || [])
        .filter((event) => !type || type === "all" || event.type === type)
        .filter(
          (event) =>
            !selectedVault ||
            !validAddress(event.vaultAddress) ||
            event.vaultAddress.toLowerCase() === selectedAddress,
        )
        .map((event) => {
          const vaultAddress = validAddress(event.vaultAddress)
            ? event.vaultAddress
            : null;
          return {
            ...event,
            key: `${network.key}:${event.id}`,
            vaultAddress,
            scope: vaultAddress ? "vault" : "network",
            networkKey: network.key,
            network: network.name || network.key,
            chainId: Number(network.chainId),
            explorer: network.explorer || null,
            source: network.source || null,
            stale:
              !!network.stale ||
              !!network.eventsRetained ||
              network.status === "degraded",
            observedAt: network.eventsObservedAt || network.observedAt || null,
          };
        }),
    )
    .sort((a, b) => {
      const aTime = time(a.timestamp);
      const bTime = time(b.timestamp);
      if (aTime !== bTime) {
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        return bTime - aTime;
      }
      return (finite(b.blockNumber) ?? -1) - (finite(a.blockNumber) ?? -1);
    });
}

/** Filter actual observations; retained series use their own latest timestamp. */
export function historyPeriod(points = [], period = "all") {
  const durations = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
  if (period !== "all" && !Object.hasOwn(durations, period))
    throw new RangeError("Choose 24h, 7d, 30d or all history.");
  const sorted = points
    .filter((point) => time(point?.timestamp) !== null)
    .map((point) =>
      finite(point.apy) !== null || point.apy === null
        ? point
        : { ...point, apy: null },
    )
    .sort((a, b) => time(a.timestamp) - time(b.timestamp));
  if (period === "all" || !sorted.length) return sorted;
  const cutoff = time(sorted.at(-1).timestamp) - durations[period];
  return sorted.filter((point) => time(point.timestamp) >= cutoff);
}

// Portfolio presentation keeps every asset denomination separate. Contract
// observations take precedence only for the exact supported chain/address.
export function platformPortfolio(networks = [], accountRows = []) {
  const observed = platformVaults(networks);
  for (const definition of earnVaults) {
    if (
      observed.some(
        (row) =>
          row.chainId === definition.chainId &&
          row.address.toLowerCase() === definition.address.toLowerCase(),
      )
    )
      continue;
    observed.push({
      key: `${definition.id}:${definition.address.toLowerCase()}`,
      networkKey: definition.id,
      chainId: definition.chainId,
      network: definition.name,
      name: `${definition.symbol} vault`,
      token: definition.symbol,
      address: definition.address,
      asset: definition.asset,
      assets: null,
      apy: null,
      providers: [],
      history: [],
      lifetime: null,
      stale: false,
      status: "unavailable",
      observedAt: null,
      source: null,
      sourceKind: "contract",
      explorer: definition.explorer,
      isEarnVault: true,
      earnVaultId: definition.id,
    });
  }
  const unique = new Map();
  for (const row of observed)
    unique.set(`${row.chainId}:${row.address.toLowerCase()}`, row);
  const entries = [...unique.values()]
    .map((row) => {
      const snapshot = onchainPlatformSnapshot(accountRows, row);
      const contractRate = finite(snapshot?.grossApr) !== null;
      const assets = finite(snapshot?.assets) ?? finite(row.assets);
      return {
        ...row,
        snapshot,
        displayAssets: assets,
        displayRate: contractRate ? snapshot.grossApr : row.apy,
        rateKind: contractRate ? "APR" : "APY",
        assetsDelayed: finite(snapshot?.assets) === null && row.stale,
        rateDelayed: !contractRate && row.stale,
      };
    })
    .sort(
      (a, b) =>
        Number(b.isEarnVault) - Number(a.isEarnVault) ||
        a.network.localeCompare(b.network) ||
        (a.token || "").localeCompare(b.token || "") ||
        a.address.localeCompare(b.address),
    );
  const totals = new Map();
  for (const row of entries) {
    if (!row.token) continue;
    const total = totals.get(row.token) || {
      token: row.token,
      assets: null,
      reporting: 0,
      count: 0,
      delayed: false,
    };
    total.count++;
    if (finite(row.displayAssets) !== null) {
      total.assets = (total.assets ?? 0) + row.displayAssets;
      total.reporting++;
      total.delayed ||= row.assetsDelayed;
    }
    totals.set(row.token, total);
  }
  return {
    entries,
    totals: [...totals.values()].sort((a, b) => a.token.localeCompare(b.token)),
    networks: new Set(entries.map((row) => row.chainId)).size,
  };
}
