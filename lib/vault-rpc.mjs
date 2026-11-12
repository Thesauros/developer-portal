import { createPublicClient, fallback, http } from "viem";
import { vaults } from "./vault-contracts.mjs";

export function privateRpcUrls(network, env = process.env) {
  if (!["base", "arbitrum"].includes(network)) return [];
  const prefix =
    network === "base" ? "MIGRATION_BASE_RPC" : "MIGRATION_ARBITRUM_RPC";
  const raw = env[`${prefix}_URLS`]?.trim() || env[`${prefix}_URL`] || "";
  const endpoints = [];
  for (const value of raw.split(",")) {
    try {
      const url = new URL(value.trim());
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !endpoints.includes(url.href)
      )
        endpoints.push(url.href);
    } catch {
      // Invalid runtime settings never enter the browser or a request target.
    }
    if (endpoints.length === 6) break;
  }
  return endpoints;
}

export function vaultRpcUrls(
  vault,
  { browser = typeof window !== "undefined", env = process.env } = {},
) {
  if (browser) return [`/api/migration/rpc/${vault.id}`, ...vault.rpcs];
  return [...privateRpcUrls(vault.id, env), ...vault.rpcs];
}

// Viem includes the transport URL and upstream response in RPC errors. Server
// consumers must never serialize a private provider URL through a read API.
export function privateRpcTransport(endpoint, options) {
  const transport = http(endpoint, options);
  return (parameters) => {
    const value = transport(parameters);
    const request = async (...args) => {
      try {
        return await value.request(...args);
      } catch (cause) {
        let code = -32603;
        let data;
        for (
          let error = cause, depth = 0;
          error && depth < 8;
          error = error.cause, depth++
        ) {
          if (Number.isInteger(error.code)) code = error.code;
          if (
            typeof error.data === "string" &&
            /^0x[\da-f]*$/i.test(error.data)
          )
            data = error.data;
        }
        throw Object.assign(new Error("Private RPC request failed."), {
          code,
          ...(data ? { data } : {}),
        });
      }
    };
    return {
      ...value,
      config: { ...value.config, request },
      request,
      value: { ...value.value, url: "Private server RPC" },
    };
  };
}

export const vaultClients = Object.fromEntries(
  vaults.map((vault) => [
    vault.id,
    createPublicClient({
      chain: vault.chain,
      transport: fallback(
        vaultRpcUrls(vault).map((url) => {
          const options = {
            timeout: url.startsWith("/api/migration/rpc/") ? 22_000 : 10_000,
            retryCount: 0,
            batch: { wait: 20, batchSize: 30 },
          };
          return typeof window === "undefined" && !vault.rpcs.includes(url)
            ? privateRpcTransport(url, options)
            : http(url, options);
        }),
        { retryCount: 0 },
      ),
    }),
  ]),
);
