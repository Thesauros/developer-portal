import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
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
const instant = (v) =>
  Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const clean = (v) => String(v || "").split(" • ")[0];
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
  const keepLifetime =
    !raw.vaultLifetimeStats?.length && !!previous.vaultLifetimeStats?.length;
  const keepEvents = !raw.events?.length && !!previous.events?.length;
  return {
    ...raw,
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
  const lifetime = (raw?.vaultLifetimeStats || []).map((v) => ({
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
    const rate = (raw.apyData || []).find(
      (a) => a.vaultAddress?.toLowerCase() === v.address?.toLowerCase(),
    );
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
                    balance: v.tvl,
                    share: 100,
                  },
                ]
              : []),
          ]
    ).map((p) => {
      const full = (raw.providers || []).find(
        (r) => r.address?.toLowerCase() === p.address?.toLowerCase(),
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
                (v.providerInfo?.address === p.address
                  ? v.providerInfo.apy
                  : null),
            ),
        riskTier: full?.riskTier || null,
      };
    });
    const analytics = raw.apyAnalytics?.series?.find(
      (a) => a.vaultAddress?.toLowerCase() === v.address?.toLowerCase(),
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
      status: invalid ? "unavailable" : v.status || "unknown",
      providers,
      history: (analytics?.points || [])
        .filter((p) => instant(p.timestamp) && number(p.apy) !== null)
        .map((p) => ({ timestamp: instant(p.timestamp), apy: number(p.apy) })),
      lifetime:
        lifetime.find(
          (l) => l.vaultAddress?.toLowerCase() === v.address?.toLowerCase(),
        ) || null,
    };
  });
  // Lifetime records remain useful if the current RPC read returned no vault objects.
  for (const l of lifetime)
    if (
      !vaults.some(
        (v) => v.address?.toLowerCase() === l.vaultAddress?.toLowerCase(),
      )
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
  return {
    key: meta.key,
    name: meta.name.replace(" Rebalancer", ""),
    chainId: meta.chainId,
    explorer: meta.explorer,
    configuredActive: meta.isActive,
    status:
      failed || vaults.some((v) => v.status === "unavailable")
        ? "degraded"
        : stale
          ? "stale"
          : "available",
    blockNumber: number(raw?.networkInfo?.blockNumber),
    gasGwei: number(raw?.networkInfo?.gasPrice),
    observedAt:
      instant(raw?.networkInfo?.lastUpdate) || instant(raw?.lastUpdate),
    fetchedAt,
    stale,
    source: MONITOR + "/dashboard?network=" + meta.key,
    vaults,
    eventsRetained: !!raw?.eventsRetained,
    eventsObservedAt: instant(raw?.eventsObservedAt || raw?.lastUpdate),
    events: (raw?.events || [])
      .filter((e) => /^0x[0-9a-f]{64}$/i.test(e.txHash))
      .map((e, i) => ({
        id: e.txHash + ":" + e.type + ":" + i,
        type: e.type,
        txHash: e.txHash,
        blockNumber: number(e.blockNumber),
        token: e.token,
        timestamp: instant(e.timestamp),
        success: e.success !== false,
      })),
    alerts: raw?.alerts
      ? {
          total: number(raw.alerts.total),
          high: number(raw.alerts.high),
          medium: number(raw.alerts.medium),
          low: number(raw.alerts.low),
          observedAt: instant(raw.alerts.lastUpdate),
          recent: (raw.alerts.recent || [])
            .slice(0, 20)
            .map((a) => ({
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
const cacheDir = resolve(process.cwd(), "../private-state/live-cache");
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
