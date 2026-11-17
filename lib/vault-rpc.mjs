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

// The same-origin proxy answers for the networks a private RPC can be set for.
export const PROXIED_NETWORKS = Object.freeze(["base", "arbitrum"]);
export const rpcProxyPath = (network) => `/api/migration/rpc/${network}`;

export function vaultRpcUrls(
  vault,
  { browser = typeof window !== "undefined", env = process.env } = {},
) {
  if (browser)
    return PROXIED_NETWORKS.includes(vault.id)
      ? [rpcProxyPath(vault.id), ...vault.rpcs]
      : [...vault.rpcs];
  return [...privateRpcUrls(vault.id, env), ...vault.rpcs];
}

// A deployment without a private RPC answers 503 from the proxy, and a guest
// gets 401. Asking again on every read would put a failed round trip in front
// of each public call, so the browser stops asking for a while.
const proxyRest = new Map();
export function restingProxyTransport(endpoint, options, now = Date.now) {
  const transport = http(endpoint, options);
  return (parameters) => {
    const value = transport(parameters);
    const request = async (...args) => {
      if ((proxyRest.get(endpoint) || 0) > now())
        throw new Error("The RPC proxy is resting.");
      try {
        return await value.request(...args);
      } catch (cause) {
        let status;
        for (
          let error = cause, depth = 0;
          error && depth < 8;
          error = error.cause, depth++
        )
          if (Number.isInteger(error.status)) status = error.status;
        // 503: no private RPC here. 401: no session yet, which sign-in changes.
        // 403: the proxy does not accept this origin, which no retry changes.
        if (status === 503 || status === 403)
          proxyRest.set(endpoint, now() + 10 * 60_000);
        else if (status === 401 || status === 404)
          proxyRest.set(endpoint, now() + 30_000);
        throw cause;
      }
    };
    return { ...value, config: { ...value.config, request }, request };
  };
}

// A rationed public endpoint answers 429 and takes calls again within a second.
// Waiting and asking once more costs less than failing a read the person is
// waiting on. Every other failure still goes to the next endpoint at once.
export function patientTransport(
  endpoint,
  options,
  {
    waits = [400, 900],
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const transport = http(endpoint, options);
  return (parameters) => {
    const value = transport(parameters);
    const request = async (...args) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await value.request(...args);
        } catch (cause) {
          let rationed = false;
          for (
            let error = cause, depth = 0;
            error && depth < 8;
            error = error.cause, depth++
          )
            if (error.status === 429) rationed = true;
          if (!rationed || attempt >= waits.length) throw cause;
          await sleep(waits[attempt]);
        }
      }
    };
    return { ...value, config: { ...value.config, request }, request };
  };
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
      // Calls made at the same moment share a round trip: as one JSON-RPC
      // batch, or, where the endpoint rations batches, as one contract call for
      // the reads of a block. A simulation names its sender and travels alone.
      ...(vault.groupReads === "multicall"
        ? { batch: { multicall: { wait: 20 } } }
        : {}),
      transport: fallback(
        vaultRpcUrls(vault).map((url) => {
          const options = {
            timeout: url.startsWith("/api/migration/rpc/") ? 22_000 : 10_000,
            retryCount: 0,
            batch:
              vault.groupReads === "multicall"
                ? false
                : { wait: 20, batchSize: 30 },
          };
          if (url.startsWith("/api/migration/rpc/"))
            return restingProxyTransport(url, options);
          if (typeof window === "undefined" && !vault.rpcs.includes(url))
            return privateRpcTransport(url, options);
          return vault.groupReads === "multicall"
            ? patientTransport(url, options)
            : http(url, options);
        }),
        { retryCount: 0 },
      ),
    }),
  ]),
);
