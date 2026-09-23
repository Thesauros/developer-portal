// Account insights: per-wallet earnings and history from the Thesauros vault
// data service, and vault performance against the lending market.
// Source: https://api-prod-v2-production.up.railway.app (same service the
// public app at app.thesauros.io reads). Amounts in history are token units.
import { protocolData, protocolLogo } from "./live-data.mjs";
import { vaultClients } from "./vault-rpc.mjs";
import { readAllocation } from "./vault-reads.mjs";

const lower = (s) => String(s || "").toLowerCase();

export const VAULT_DATA =
  process.env.THESAUROS_VAULT_DATA_URL ||
  "https://api-prod-v2-production.up.railway.app";

// Every vault the protocol runs. `depositable` marks the ones this app can
// transact with (see lib/vault-contracts.mjs); the rest are shown read-only.
export const VAULTS = [
  {
    id: "arbitrum",
    network: "Arbitrum",
    monitorKey: "arbitrumRebalancer",
    token: "USDC",
    decimals: 6,
    explorer: "https://arbiscan.io",
    icon: "/brand/tokens/arb.png",
    depositable: true,
  },
  {
    id: "base",
    network: "Base",
    monitorKey: "baseRebalancer",
    token: "USDC",
    decimals: 6,
    explorer: "https://basescan.org",
    icon: "/brand/tokens/base.svg",
    depositable: true,
  },
  {
    id: "monad",
    network: "Monad",
    monitorKey: "monad",
    token: "USDC",
    decimals: 6,
    explorer: "https://monadscan.com",
    icon: "/brand/tokens/monad.png",
    depositable: false,
  },
  {
    id: "plasma",
    network: "Plasma",
    monitorKey: "plasma",
    token: "USDT0",
    decimals: 6,
    explorer: "https://plasmascan.to",
    icon: "/brand/tokens/plasma.png",
    depositable: false,
  },
];

// Provider adapters from bastardgreeks.thesauros.io/deployments/*/deployed-vaults.json.
// Morpho adapters report a generic identifier onchain, so names come from here.
const PROVIDERS = {
  "0xa34574dae6284edc7348c36a80242b92cfbd13a5": ["Aave V3", "core"],
  "0xd5209c39b3ca78a3ef952c311a29326e7f316e67": ["Compound V3", "core"],
  "0xeb98d46937c537eff376361536d58d78c57c40d7": [
    "Gauntlet Core Morpho",
    "satellite",
  ],
  "0x6240402d3cb33777d4e5e6b5791bc8518aeb8b99": [
    "Steakhouse High Yield Morpho",
    "satellite",
  ],
  "0x0d9fd60e25b0c3b2416d46f7dd311b0ed6743484": [
    "Steakhouse Prime Morpho",
    "satellite",
  ],
  "0xddaa9700c0da1020ae5dabc7aa0a0bb750dd317c": ["Aave V3", "core"],
  "0x7ebd3e69954f0af98adbfe80b8f28c0b82b3b74c": ["Compound V3", "core"],
  "0x51b8bdcda5e41893737c9c3a08f528c97fcc1b8b": [
    "Gauntlet Core Morpho",
    "satellite",
  ],
  "0x9c35b8a92fc3a305712b9dd8a1c34310ea09c61c": [
    "Steakhouse High Yield Morpho",
    "satellite",
  ],
  "0xddf2c1f8eaf567c084dee07658ed3906029395b1": [
    "Steakhouse Prime Morpho",
    "satellite",
  ],
  "0xaeecf7f780e88b155df330434ef29b2b077024e0": ["Aave V3", "core"],
  "0x27a1c09eb8d7536a76010c14dea14e3fd5c828b5": ["Aave V3", "core"],
};
export const providerName = (address) => PROVIDERS[lower(address)]?.[0] || null;

// Onchain fallback when the monitor cannot read a vault.
async function chainAllocation(vault) {
  const client = vaultClients[vault.id];
  if (!client) return null;
  const allocation = await readAllocation(client, vault.id);
  const total = allocation.providers.reduce(
    (s, p) => s + Number(p.assets ?? 0n),
    0,
  );
  if (!total) return null;
  const ray = (r) => (r == null ? null : (Number(r) / 1e27) * 100);
  return {
    apyNow: ray(allocation.rateRay),
    providers: allocation.providers
      .map((p) => {
        const known = PROVIDERS[lower(p.address)];
        const name =
          known?.[0] ||
          String(p.name)
            .replace(/_Provider$/, "")
            .replace(/_/g, " ");
        return {
          name,
          logo: protocolLogo(name),
          address: p.address,
          share: (Number(p.assets ?? 0n) / total) * 100,
          apy: ray(p.rateRay),
          riskTier: known?.[1] || null,
        };
      })
      .filter((p) => p.share > 0.05)
      .sort((a, b) => b.share - a.share),
  };
}
const lastGood = (globalThis.__thesaurosAllocation ??= new Map());

const memory = (globalThis.__thesaurosInsights ??= new Map());
const inflight = (globalThis.__thesaurosInsightsPending ??= new Map());

async function getJson(path, ttl) {
  const hit = memory.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  if (inflight.has(path)) return inflight.get(path);
  const promise = (async () => {
    try {
      const response = await fetch(VAULT_DATA + "/" + path, {
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("status " + response.status);
      const text = await response.text();
      const value = text === "" ? null : JSON.parse(text);
      if (memory.size > 2000) memory.delete(memory.keys().next().value);
      memory.set(path, { value, at: Date.now() });
      return value;
    } catch {
      // Serve the last good answer when the source blips.
      return hit ? hit.value : undefined;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, promise);
  return promise;
}

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const toNumber = (v) => {
  const n = typeof v === "string" ? Number(v) : v;
  return finite(n);
};
function ticks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({ t: Date.parse(t.from), v: finite(t.value) }))
    .filter((t) => Number.isFinite(t.t))
    .sort((a, b) => a.t - b.t);
}

async function vaultPerformance(vault, period) {
  const q = "?network=" + vault.network;
  const [summary, apr, market, best, rebalance] = await Promise.all([
    getJson("lending" + q, 300000),
    getJson(`lending/${vault.token}/apr-ticks/${period}${q}`, 600000),
    getJson(
      `lending/${vault.token}/market-avg-apr-ticks/${period}${q}`,
      600000,
    ),
    getJson(
      `lending/${vault.token}/highest-market-apr-ticks/${period}${q}`,
      600000,
    ),
    getJson(
      `stats/protocol/last-rebalance/${vault.network}/${vault.token}`,
      300000,
    ),
  ]);
  const row = Array.isArray(summary)
    ? summary.find((s) => s.token === vault.token)
    : null;
  return {
    tvl: toNumber(row?.funds),
    earnedByVault: toNumber(row?.earned),
    apr30d: toNumber(row?.avgApr30D),
    // Percentage points above the average lending market over 30 days.
    marketSpread30d: toNumber(row?.marketAvg30DAprDiffPercentage),
    series: { vault: ticks(apr), market: ticks(market), best: ticks(best) },
    lastRebalance:
      rebalance && rebalance.transactionHash
        ? {
            at: toNumber(rebalance.timestamp)
              ? rebalance.timestamp * 1000
              : null,
            amount:
              rebalance.amount != null
                ? Number(rebalance.amount) / 10 ** vault.decimals
                : null,
            from: rebalance.fromProvider || null,
            to: rebalance.toProvider || null,
            txHash: rebalance.transactionHash,
          }
        : null,
  };
}

// Protocol context (allocation, fees, pause state) comes from the monitor.
function monitorVault(networks, vault) {
  const network = networks.find((n) => n.key === vault.monitorKey);
  const v = network?.vaults?.find((x) => x.token === vault.token);
  if (!v) return { status: network?.status || "unknown", providers: [] };
  return {
    status: network.status,
    observedAt: network.observedAt,
    apyNow: v.apy,
    address: v.address,
    providers: (v.providers || [])
      .filter((p) => p.share == null || p.share > 0.05)
      .map((p) => ({
        name: p.name,
        logo: p.logo,
        address: p.address,
        share: p.share,
        apy: p.apy,
        riskTier: p.riskTier,
      })),
    rebalances: (network.events || [])
      .filter((e) => e.type === "RebalanceExecuted" && e.timestamp)
      .slice(0, 8)
      .map((e) => ({ at: Date.parse(e.timestamp), txHash: e.txHash })),
    providerNames: Object.fromEntries(
      (v.providers || []).map((p) => [lower(p.address), p.name]),
    ),
  };
}

export async function marketInsights(period = "30d") {
  if (!["7d", "30d", "180d", "365d"].includes(period)) period = "30d";
  const [protocol, ...performance] = await Promise.all([
    protocolData().catch(() => ({ networks: [] })),
    ...VAULTS.map((v) => vaultPerformance(v, period)),
  ]);
  // Allocation: live monitor, else onchain read, else the last good snapshot.
  const allocations = await Promise.all(
    VAULTS.map(async (vault) => {
      const monitor = monitorVault(protocol.networks || [], vault);
      let source = "monitor";
      let alloc =
        monitor.providers.length && monitor.apyNow != null ? monitor : null;
      if (!alloc && vault.depositable) {
        alloc = await chainAllocation(vault).catch(() => null);
        source = "chain";
      }
      if (alloc) lastGood.set(vault.id, { ...alloc, source, at: Date.now() });
      const kept = lastGood.get(vault.id);
      return {
        monitor,
        apyNow: kept?.apyNow ?? null,
        providers: kept?.providers || [],
        allocationSource: kept?.source || null,
        allocationObservedAt: kept?.at || null,
      };
    }),
  );
  return {
    period,
    updatedAt: new Date().toISOString(),
    vaults: VAULTS.map((vault, i) => {
      const { monitor, ...alloc } = allocations[i];
      const perf = performance[i];
      const name = (address) =>
        providerName(address) ||
        monitor.providerNames?.[lower(address)] ||
        null;
      return {
        ...vault,
        ...perf,
        ...monitor,
        ...alloc,
        providerNames: undefined,
        lastRebalance: perf.lastRebalance && {
          ...perf.lastRebalance,
          fromName: name(perf.lastRebalance.from),
          toName: name(perf.lastRebalance.to),
        },
      };
    }),
  };
}

export async function accountInsights(owner) {
  const address = lower(owner);
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Invalid address");
  const rows = await Promise.all(
    VAULTS.map(async (vault) => {
      const q = "?network=" + vault.network;
      const [earned, daily, history] = await Promise.all([
        getJson(`lending/${vault.token}/user-earned/${address}${q}`, 120000),
        getJson(
          `lending/${vault.token}/user-earned-ticks/${address}/1/30${q}`,
          600000,
        ),
        getJson(
          `stats/users/${address}/history/${vault.network}/${vault.token}`,
          120000,
        ),
      ]);
      const transactions = Array.isArray(history)
        ? history.map((tx) => ({
            vaultId: vault.id,
            network: vault.network,
            token: vault.token,
            kind: /withdraw/i.test(tx.type) ? "withdraw" : "deposit",
            txHash: tx.transactionHash,
            url: vault.explorer + "/tx/" + tx.transactionHash,
            at: toNumber(tx.blockTimestamp) ? tx.blockTimestamp * 1000 : null,
            amount:
              tx.assets != null
                ? Number(tx.assets) / 10 ** vault.decimals
                : null,
          }))
        : [];
      const deposited = transactions
        .filter((t) => t.kind === "deposit")
        .reduce((s, t) => s + (t.amount || 0), 0);
      const withdrawn = transactions
        .filter((t) => t.kind === "withdraw")
        .reduce((s, t) => s + (t.amount || 0), 0);
      return {
        vaultId: vault.id,
        earned: toNumber(earned),
        dailyEarned: ticks(daily),
        deposited,
        withdrawn,
        firstDepositAt: transactions.length
          ? Math.min(...transactions.map((t) => t.at || Infinity))
          : null,
        transactions,
        available: earned !== undefined || Array.isArray(history),
      };
    }),
  );
  return {
    owner: address,
    updatedAt: new Date().toISOString(),
    vaults: rows,
    transactions: rows
      .flatMap((r) => r.transactions)
      .sort((a, b) => (b.at || 0) - (a.at || 0)),
  };
}
