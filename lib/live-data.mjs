import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { cacheDirectory } from "./cache-directory.mjs";
export const MONITOR = "https://bastardgreeks.thesauros.io/api";
export const PROJECTS = {
  "aave-v3": "Aave",
  "morpho-blue": "Morpho",
  "compound-v3": "Compound",
  "fluid-lending": "Fluid",
  spark: "Spark",
  "moonwell-lending": "Moonwell",
  "euler-v2": "Euler",
};
export const number = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
const address = (v) => (/^0x[0-9a-f]{40}$/i.test(v || "") ? v : null);
const sameAddress = (a, b) =>
  !!address(a) && !!address(b) && a.toLowerCase() === b.toLowerCase();
const instant = (v) =>
  Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const clean = (v) => String(v || "").split(" • ")[0];
const text = (v) => (typeof v === "string" && v.trim() ? v : null);

function historyPoints(series) {
  return (Array.isArray(series?.points) ? series.points : [])
    .filter((p) => p && instant(p.timestamp))
    .map((p) => ({ timestamp: instant(p.timestamp), apy: number(p.apy) }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function allocation(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      address: address(p.address || p.providerAddress),
      name: text(p.name || p.provider),
      balance: number(p.balance),
      assets: number(p.assets),
      share: number(p.share),
    }));
}

function eventVault(event, records) {
  const explicit = address(event.vaultAddress) || address(event.vault);
  if (explicit) return { address: explicit, source: "event" };
  // A vault name or token is not an identity. Only an exact event tuple nested
  // under one known vault can establish scope when the flattened event lacks it.
  const candidates = records.filter(
    (record) =>
      address(record.vaultAddress) &&
      record.recentEvents?.some(
        (indexed) =>
          indexed.txHash?.toLowerCase() === event.txHash?.toLowerCase() &&
          indexed.type === event.type &&
          number(indexed.blockNumber) !== null &&
          number(indexed.blockNumber) === number(event.blockNumber) &&
          (event.logIndex == null ||
            indexed.logIndex == null ||
            number(indexed.logIndex) === number(event.logIndex)),
      ),
  );
  const unique = new Set(candidates.map((v) => v.vaultAddress.toLowerCase()));
  return unique.size === 1
    ? { address: candidates[0].vaultAddress, source: "indexed-vault" }
    : { address: null, source: null };
}
export function protocolLogo(name) {
  const n = String(name).toLowerCase();
  return (
    ["morpho", "aave", "compound", "fluid", "spark", "moonwell", "euler"].find(
      (p) => n.includes(p),
    ) || null
  );
}
export function retainIndexed(raw, previous) {
  if (!previous) return raw;
  if (
    (raw.network && previous.network && raw.network !== previous.network) ||
    (raw.networkInfo?.chainId &&
      previous.networkInfo?.chainId &&
      Number(raw.networkInfo.chainId) !== Number(previous.networkInfo.chainId))
  )
    return raw;
  const keepLifetime =
    !raw.vaultLifetimeStats?.length && !!previous.vaultLifetimeStats?.length;
  const keepEvents = !raw.events?.length && !!previous.events?.length;
  const snapshotObservedAt = instant(
    raw.networkInfo?.lastUpdate || raw.lastUpdate,
  );
  const vaults = (raw.vaults || []).map((vault) => ({
    ...vault,
    snapshotRetained: false,
    snapshotObservedAt,
  }));
  for (const earlier of previous.vaults || []) {
    if (
      !address(earlier.address) ||
      vaults.some((vault) => sameAddress(vault.address, earlier.address))
    )
      continue;
    // A partial dashboard can omit a contract entirely. Preserve the exact old
    // snapshot, including its rate context, without overriding any present read.
    const providerAddresses = [
      earlier.providerInfo?.address,
      ...(earlier.providerAllocations || []).map(
        (provider) => provider.address,
      ),
    ];
    vaults.push({
      ...earlier,
      snapshotRetained: true,
      snapshotObservedAt: earlier.snapshotRetained
        ? instant(earlier.snapshotObservedAt)
        : instant(
            earlier.snapshotObservedAt ||
              previous.networkInfo?.lastUpdate ||
              previous.lastUpdate,
          ),
      snapshotContext: earlier.snapshotRetained
        ? earlier.snapshotContext
        : {
            rate:
              (previous.apyData || []).find((rate) =>
                sameAddress(rate.vaultAddress, earlier.address),
              ) || null,
            providers: (previous.providers || []).filter((provider) =>
              providerAddresses.some((candidate) =>
                sameAddress(candidate, provider.address),
              ),
            ),
          },
    });
  }
  const currentSeries = raw.apyAnalytics?.series || [];
  const previousSeries = previous.apyAnalytics?.series || [];
  const series = currentSeries.map((current) => {
    const earlier = previousSeries.find((v) =>
      sameAddress(v.vaultAddress, current.vaultAddress),
    );
    const retained =
      !historyPoints(current).length && !!historyPoints(earlier).length;
    return {
      ...current,
      points: retained ? earlier.points : current.points,
      historyRetained: retained,
      historyObservedAt: retained
        ? earlier.historyObservedAt || previous.lastUpdate
        : raw.lastUpdate,
    };
  });
  for (const earlier of previousSeries) {
    if (
      address(earlier.vaultAddress) &&
      historyPoints(earlier).length &&
      !series.some((v) => sameAddress(v.vaultAddress, earlier.vaultAddress))
    )
      series.push({
        ...earlier,
        historyRetained: true,
        historyObservedAt: earlier.historyObservedAt || previous.lastUpdate,
      });
  }
  return {
    ...raw,
    vaults,
    apyAnalytics: { ...raw.apyAnalytics, series },
    vaultLifetimeStats: keepLifetime
      ? previous.vaultLifetimeStats
      : raw.vaultLifetimeStats,
    lifetimeRetained: keepLifetime,
    events: keepEvents ? previous.events : raw.events,
    eventsRetained: keepEvents,
    eventsObservedAt: keepEvents
      ? previous.eventsObservedAt || previous.lastUpdate
      : raw.lastUpdate,
  };
}
export function normalizeNetwork(raw, meta, fetchedAt, stale = false) {
  const failed = !!raw?.networkInfo?.error;
  const sourceStale = stale || raw?.payloadMeta?.stale === true;
  const lifetimeRecords = raw?.vaultLifetimeStats || [];
  const lifetime = lifetimeRecords.map((v) => ({
    ...Object.fromEntries(
      [
        "eventsCount",
        "depositsCount",
        "withdrawalsCount",
        "feeChargedCount",
        "rebalanceCount",
        "totalDeposits",
        "totalWithdrawals",
        "netDeposits",
        "currentAssets",
        "currentShares",
        "financialResult",
        "protocolFees",
        "rebalanceCosts",
        "rebalancedAssets",
        "fromBlock",
        "toBlock",
      ].map((k) => [k, number(v[k])]),
    ),
    token: v.token,
    vaultAddress: address(v.vaultAddress),
    updatedAt: instant(v.updatedAt),
    retained: !!raw.lifetimeRetained,
  }));
  const vaults = (raw?.vaults || []).map((v) => {
    const rate = v.snapshotRetained
      ? v.snapshotContext?.rate
      : (raw.apyData || []).find((a) => sameAddress(a.vaultAddress, v.address));
    const providerRecords = v.snapshotRetained
      ? v.snapshotContext?.providers || []
      : raw.providers || [];
    const invalid =
      !!v.error || v.status === "error" || rate?.source === "error";
    const providers = (
      v.providerAllocations?.length
        ? v.providerAllocations
        : [
            ...(v.providerInfo?.address
              ? [
                  {
                    address: v.providerInfo.address,
                    name: v.providerInfo.name,
                    // Entry-provider identity does not establish allocation.
                    balance: null,
                    share: null,
                  },
                ]
              : []),
          ]
    ).map((p) => {
      const full = providerRecords.find((r) =>
        sameAddress(r.address, p.address),
      );
      return {
        address: address(p.address),
        name: clean(full?.baseName || p.name),
        logo: protocolLogo(full?.baseName || p.name),
        balance: invalid ? null : number(p.balance),
        share: invalid ? null : number(p.share),
        apy: invalid
          ? null
          : number(
              full?.depositRates?.[v.token || v.symbol] ??
                (sameAddress(v.providerInfo?.address, p.address)
                  ? v.providerInfo.apy
                  : null),
            ),
        riskTier: full?.riskTier || null,
      };
    });
    const analytics = raw.apyAnalytics?.series?.find((a) =>
      sameAddress(a.vaultAddress, v.address),
    );
    return {
      address: address(v.address),
      asset: address(v.asset),
      name: v.name,
      token: v.token || v.symbol,
      shareSymbol: v.shareSymbol,
      shareDecimals: number(v.shareDecimals),
      assets: invalid ? null : number(v.tvl),
      shares: invalid ? null : number(v.totalShares),
      apy: invalid ? null : number(rate?.apy ?? v.providerInfo?.apy),
      apySource: text(rate?.source),
      status: invalid ? "unavailable" : v.status || "unknown",
      snapshotRetained: !!v.snapshotRetained,
      snapshotObservedAt: v.snapshotRetained
        ? instant(v.snapshotObservedAt)
        : instant(
            v.snapshotObservedAt ||
              raw.networkInfo?.lastUpdate ||
              raw.lastUpdate,
          ),
      providers,
      history: historyPoints(analytics),
      historyRetained: !!analytics?.historyRetained,
      historyObservedAt: instant(
        analytics?.historyObservedAt || raw.lastUpdate,
      ),
      lifetime:
        lifetime.find((l) => sameAddress(l.vaultAddress, v.address)) || null,
    };
  });
  // Lifetime records remain useful if the current RPC read returned no vault objects.
  for (const l of lifetime)
    if (
      l.vaultAddress &&
      !vaults.some((v) => sameAddress(v.address, l.vaultAddress))
    )
      vaults.push({
        address: l.vaultAddress,
        name: "Thesauros " + l.token + " Vault",
        token: l.token,
        assets: null,
        shares: null,
        apy: null,
        status: "unavailable",
        providers: [],
        history: [],
        lifetime: l,
      });
  // Retained historical contracts stay separate from current Earn deployments.
  for (const analytics of raw?.apyAnalytics?.series || []) {
    const points = historyPoints(analytics);
    if (!address(analytics.vaultAddress) || !points.length) continue;
    let vault = vaults.find((v) =>
      sameAddress(v.address, analytics.vaultAddress),
    );
    if (!vault) {
      vault = {
        address: analytics.vaultAddress,
        name: "Thesauros " + (analytics.token || "") + " Vault",
        token: analytics.token || null,
        assets: null,
        shares: null,
        apy: null,
        status: "unavailable",
        providers: [],
        lifetime: null,
      };
      vaults.push(vault);
    }
    vault.history = points;
    vault.historyRetained = !!analytics.historyRetained;
    vault.historyObservedAt = instant(
      analytics.historyObservedAt || raw.lastUpdate,
    );
  }
  return {
    key: meta.key,
    name: meta.name.replace(" Rebalancer", ""),
    chainId: meta.chainId,
    explorer: meta.explorer,
    configuredActive: meta.isActive,
    status:
      failed || !vaults.length || vaults.some((v) => v.status === "unavailable")
        ? "degraded"
        : sourceStale
          ? "stale"
          : "available",
    blockNumber: number(raw?.networkInfo?.blockNumber),
    gasGwei: number(raw?.networkInfo?.gasPrice),
    observedAt:
      instant(raw?.networkInfo?.lastUpdate) || instant(raw?.lastUpdate),
    fetchedAt,
    stale: sourceStale,
    source: MONITOR + "/dashboard?network=" + meta.key,
    vaults,
    eventsRetained: !!raw?.eventsRetained,
    eventsObservedAt: instant(raw?.eventsObservedAt || raw?.lastUpdate),
    events: (raw?.events || [])
      .filter((e) => /^0x[0-9a-f]{64}$/i.test(e.txHash))
      .map((e, i) => {
        const scoped = eventVault(e, lifetimeRecords);
        return {
          id: e.txHash + ":" + e.type + ":" + i,
          type: e.type,
          txHash: e.txHash,
          blockNumber: number(e.blockNumber),
          token: e.token,
          timestamp: instant(e.timestamp),
          success: e.success !== false,
          vaultAddress: scoped.address,
          vaultScopeSource: scoped.source,
          vaultName:
            text(e.vaultName) || (!address(e.vault) ? text(e.vault) : null),
          logIndex: number(e.logIndex),
          fromProvider: text(e.fromProvider),
          toProvider: text(e.toProvider),
          fromAllocation: allocation(e.fromAllocation),
          toAllocation: allocation(e.toAllocation),
          assets: number(e.assets),
          cost: number(e.cost ?? e.rebalanceCost),
          costToken: text(e.costToken),
        };
      }),
    alerts: raw?.alerts
      ? {
          total: number(raw.alerts.total),
          high: number(raw.alerts.high),
          medium: number(raw.alerts.medium),
          low: number(raw.alerts.low),
          observedAt: instant(raw.alerts.lastUpdate),
          recent: (raw.alerts.recent || []).slice(0, 20).map((a) => ({
            type: String(a.type || "Alert"),
            severity: String(a.severity || a.level || "info"),
            message: String(a.message || a.description || "").slice(0, 400),
            timestamp: instant(a.timestamp),
          })),
        }
      : null,
  };
}
export function selectMarkets(raw) {
  const eligible = (raw.data || []).filter(
    (p) =>
      p.stablecoin &&
      PROJECTS[p.project] &&
      ["Ethereum", "Base", "Arbitrum"].includes(p.chain) &&
      /USD|DAI|GHO/.test(p.symbol) &&
      number(p.tvlUsd) > 1e6 &&
      number(p.apy) !== null,
  );
  const chosen = [];
  for (const key of Object.keys(PROJECTS)) {
    const list = eligible
      .filter((p) => p.project === key)
      .sort((a, b) => b.tvlUsd - a.tvlUsd);
    const represented = ["Ethereum", "Base", "Arbitrum"].flatMap((chain) =>
      list
        .filter((p) => p.chain === chain)
        .slice(0, chain === "Ethereum" ? 2 : 1),
    );
    for (const p of represented)
      chosen.push({
        id: p.pool,
        name: PROJECTS[p.project],
        project: p.project,
        logo: protocolLogo(PROJECTS[p.project]),
        chain: p.chain,
        token: p.symbol,
        apy: number(p.apy),
        baseApy: number(p.apyBase),
        rewardApy: number(p.apyReward),
        tvlUsd: number(p.tvlUsd),
        change1d: number(p.apyPct1D),
        change7d: number(p.apyPct7D),
        label: p.poolMeta || null,
      });
  }
  return chosen.sort((a, b) => b.tvlUsd - a.tvlUsd);
}
const cacheDir = cacheDirectory;
mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
const cache = (globalThis.__thesaurosLiveCache ??= new Map());
const pending = (globalThis.__thesaurosLivePending ??= new Map());
export async function cachedSource(
  key,
  url,
  ttl = 60000,
  transform = (v) => v,
) {
  let previous = cache.get(key);
  if (!previous) {
    try {
      previous = JSON.parse(
        readFileSync(resolve(cacheDir, key + ".json"), "utf8"),
      );
      cache.set(key, previous);
    } catch {}
  }
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < ttl)
    return { ...previous, stale: false };
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(18000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Source returned " + response.status);
      const data = transform(await response.json(), previous?.data);
      const result = { data, fetchedAt: new Date().toISOString(), source: url };
      cache.set(key, result);
      const file = resolve(cacheDir, key + ".json");
      writeFileSync(file + ".tmp", JSON.stringify(result), { mode: 0o600 });
      renameSync(file + ".tmp", file);
      return { ...result, stale: false };
    } catch {
      if (previous)
        return {
          ...previous,
          stale: true,
          error:
            "The source could not refresh. Showing the last received data.",
        };
      return {
        data: null,
        fetchedAt: null,
        source: url,
        stale: true,
        error: "The source is temporarily unavailable.",
      };
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, promise);
  return promise;
}
export async function protocolData() {
  const config = await cachedSource(
    "networks",
    MONITOR + "/networks",
    300000,
    (v) => {
      if (!Array.isArray(v) || !v.length) throw new Error("Invalid networks");
      return v.filter(
        (n) => /^[a-zA-Z0-9]+$/.test(n.key) && /^https:\/\//.test(n.explorer),
      );
    },
  );
  if (!config.data) return { networks: [], error: config.error };
  const networks = await Promise.all(
    config.data.map(async (meta) => {
      const result = await cachedSource(
        "network-" + meta.key,
        MONITOR + "/dashboard?network=" + meta.key,
        60000,
        (v, previous) => {
          if (!v || !Array.isArray(v.vaults) || !v.lastUpdate)
            throw new Error("Invalid dashboard");
          return retainIndexed(v, previous);
        },
      );
      return {
        ...normalizeNetwork(result.data, meta, result.fetchedAt, result.stale),
        error: result.error || null,
      };
    }),
  );
  return { networks, source: MONITOR, updatedAt: new Date().toISOString() };
}
export async function marketData() {
  return cachedSource(
    "markets-v2",
    "https://yields.llama.fi/pools",
    600000,
    (v) => {
      const list = selectMarkets(v);
      if (!list.length) throw new Error("Invalid markets");
      return list;
    },
  );
}
export async function marketHistory(pool) {
  const markets = await marketData();
  if (!markets.data?.some((p) => p.id === pool)) return null;
  return cachedSource(
    "history-" + pool,
    "https://yields.llama.fi/chart/" + pool,
    3600000,
    (v) => {
      if (!Array.isArray(v.data)) throw new Error("Invalid history");
      return v.data
        .filter((p) => instant(p.timestamp))
        .map((p) => ({
          timestamp: instant(p.timestamp),
          apy: number(p.apy),
          tvlUsd: number(p.tvlUsd),
        }))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .slice(-370);
    },
  );
}
