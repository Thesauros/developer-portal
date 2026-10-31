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
      throw new Error("The cross-chain API is not healthy.");
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
      throw new Error("The allocation does not match the stand's contracts.");
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
