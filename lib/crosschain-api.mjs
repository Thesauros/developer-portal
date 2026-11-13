import {
  CROSSCHAIN_API_ORIGIN,
  assertCrosschainIdentity,
  crosschain,
  sameAddress,
} from "./crosschain-config.mjs";

export function crosschainPath(resource, owner) {
  const paths = {
    health: "/health",
    "backend-base": "/lending?network=Base",
    "backend-arbitrum": "/lending?network=Arbitrum",
  };
  if (Object.hasOwn(paths, resource)) return paths[resource];
  throw new Error("Unknown cross-chain resource.");
}

export function validateCrosschainResponse(resource, value, owner) {
  if (resource === "vault") return assertCrosschainIdentity(value);
  if (resource === "health") {
    if (value?.status !== "ok" || value?.service !== "api")
      throw new Error("The vault's data service is not healthy.");
    return { ...value, healthy: true };
  }
  if (resource === "backend-base" || resource === "backend-arbitrum") {
    const network = crosschain.networks[resource === "backend-base" ? 0 : 1];
    const rows = Array.isArray(value)
      ? value.filter((row) => row.token === "USDC")
      : [];
    // Deposits always target the Base EpochVault; each network has its own strategy.
    if (
      !rows.length ||
      rows.some(
        (row) =>
          !sameAddress(row.vaultAddress, crosschain.vault) ||
          !sameAddress(row.strategyAddress, network.strategy),
      )
    )
      throw new Error(
        `The API is reachable, but its ${network.name} USDC data does not reference the cross-chain contracts. Configure the backend vault and strategy addresses.`,
      );
  }
  if (resource === "user" && !sameAddress(value?.address, owner))
    throw new Error("The response belongs to a different wallet.");
  if (resource === "allocation") {
    if (
      !Array.isArray(value?.chains) ||
      value.chains.length !== crosschain.networks.length ||
      !crosschain.networks.every((expected) =>
        value.chains.some(
          (chain) =>
            chain.chainId === expected.chainId &&
            chain.role === expected.role &&
            sameAddress(chain.agent, expected.agent) &&
            sameAddress(chain.strategy, expected.strategy),
        ),
      )
    )
      throw new Error("The allocation does not match the vault's contracts.");
  }
  return value;
}

export async function readCrosschain(resource, owner, fetcher = fetch) {
  const path = crosschainPath(resource, owner);
  const response = await fetcher(CROSSCHAIN_API_ORIGIN + path, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Cross-chain API unavailable (HTTP ${response.status}).`);
  const value = await response.json();
  return validateCrosschainResponse(resource, value, owner);
}

const rateCache = new Map();
const OPS_API =
  process.env.CROSSCHAIN_OPS_API ||
  "https://xc-api.sandbox-test-1488.thesauros.io";
async function getUpstream(url, ms = 10000) {
  const response = await fetch(url, {
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(ms),
  });
  if (!response.ok) throw new Error("The data service did not answer.");
  return response.json();
}
const dailyPoints = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      t: Date.parse(row.from),
      // Number(null) is 0: a missing day must stay missing, not become a 0% rate.
      v: row.value == null || row.value === "" ? NaN : Number(row.value),
    }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.v))
    .sort((a, b) => a.t - b.t);

// Each strategy's rate against the average of its approved markets, per network.
export async function readCrosschainRates(period = "30d") {
  if (!["7d", "30d", "180d"].includes(period)) period = "30d";
  const hit = rateCache.get(period);
  if (hit && Date.now() - hit.at < 600000) return hit.value;
  const networks = await Promise.all(
    crosschain.networks.map(async (network) => {
      const query = "/" + period + "?network=" + network.name;
      const [vault, market] = await Promise.all([
        getUpstream(CROSSCHAIN_API_ORIGIN + "/lending/USDC/apr-ticks" + query),
        getUpstream(
          CROSSCHAIN_API_ORIGIN + "/lending/USDC/market-avg-apr-ticks" + query,
        ),
      ]);
      return {
        name: network.name,
        vault: dailyPoints(vault),
        market: dailyPoints(market),
      };
    }),
  );
  const value = { period, networks };
  rateCache.set(period, { at: Date.now(), value });
  return value;
}

// Money moved between networks, from the operations indexer. Every field is
// checked: this data ends up in links and must not be trusted as it arrives.
let movesCache = null;
export async function readCrosschainMoves() {
  if (movesCache && Date.now() - movesCache.at < 60000) return movesCache.value;
  const names = Object.fromEntries(
    crosschain.networks.map((network) => [network.chainId, network]),
  );
  const rows = await getUpstream(OPS_API + "/v1/transfers?limit=50");
  if (!Array.isArray(rows)) throw new Error("Unexpected transfer data.");
  const seconds = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0
      ? Number(value) * 1000
      : null;
  const value = {
    moves: rows
      .filter(
        (row) =>
          names[row.src_chain] &&
          names[row.dst_chain] &&
          /^\d+$/.test(String(row.amount ?? "")),
      )
      .map((row) => ({
        id: String(row.id),
        from: names[row.src_chain].name,
        to: names[row.dst_chain].name,
        amount: String(row.amount),
        sentAt: seconds(row.sent_at),
        receivedAt: seconds(row.received_at),
        tx: /^0x[0-9a-f]{64}$/i.test(row.sent_tx || "") ? row.sent_tx : null,
        explorer: names[row.src_chain].explorer,
      })),
  };
  movesCache = { at: Date.now(), value };
  return value;
}
