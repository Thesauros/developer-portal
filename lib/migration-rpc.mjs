import { crosschain } from "./crosschain-config.mjs";
import { vaults } from "./vault-contracts.mjs";
import { privateRpcUrls } from "./vault-rpc.mjs";

const requestLimit = 64 * 1024;
const responseLimit = 4 * 1024 * 1024;
const addressPattern = /^0x[\da-f]{40}$/i;
const hashPattern = /^0x[\da-f]{64}$/i;
const hexPattern = /^0x(?:[\da-f]{2})*$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][\da-f]{0,63})$/i;
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const implementations = {
  base: "0xd4aC8Bcec0790ADDa563dB1B35c072B485fE2708",
  arbitrum: "0xEd3296117dAAa46FE4Cf94036bb42EE86100F8c7",
};
const validNetwork = (network) => ["base", "arbitrum"].includes(network);
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const block = (value) =>
  ["latest", "pending", "earliest", "safe", "finalized"].includes(value) ||
  (typeof value === "string" && quantityPattern.test(value));
const bad = () => {
  throw new Error("Invalid migration RPC request.");
};

export function migrationRpcTargets(network) {
  if (!validNetwork(network)) return bad();
  const vault = vaults.find((entry) => entry.id === network);
  const targets = [vault.address, vault.asset, implementations[network]];
  const allocation = crosschain.networks.find(
    (entry) => entry.chainId === vault.chainId,
  );
  if (allocation)
    targets.push(allocation.agent, allocation.strategy, allocation.adapter);
  if (vault.chainId === crosschain.chainId)
    targets.push(
      crosschain.vault,
      crosschain.asset,
      crosschain.implementation,
      crosschain.logic,
      crosschain.accountant,
    );
  return new Set(targets.map((value) => value.toLowerCase()));
}

export function privateMigrationRpcUrl(network, env = process.env) {
  return privateRpcUrls(network, env)[0] || null;
}

export function validateMigrationRpc(payload, network, owner) {
  const targets = migrationRpcTargets(network);
  const allowedAddress = (value) =>
    typeof value === "string" &&
    addressPattern.test(value) &&
    targets.has(value.toLowerCase());
  const ownAddress = (value) =>
    typeof value === "string" &&
    addressPattern.test(value) &&
    (value.toLowerCase() === owner?.toLowerCase() || allowedAddress(value));
  const calls = Array.isArray(payload) ? payload : [payload];
  if (!calls.length || calls.length > 30) return bad();
  const ids = new Set();
  for (const call of calls) {
    if (
      !plain(call) ||
      call.jsonrpc !== "2.0" ||
      !Object.keys(call).every((key) =>
        ["jsonrpc", "id", "method", "params"].includes(key),
      ) ||
      !(
        (Number.isSafeInteger(call.id) && call.id >= 0) ||
        (typeof call.id === "string" &&
          call.id.length > 0 &&
          call.id.length <= 128)
      ) ||
      ids.has(`${typeof call.id}:${call.id}`)
    )
      return bad();
    ids.add(`${typeof call.id}:${call.id}`);
    const params = call.params ?? [];
    if (!Array.isArray(params)) return bad();
    switch (call.method) {
      case "eth_chainId":
      case "eth_blockNumber":
        if (params.length) return bad();
        break;
      case "eth_call": {
        if (params.length !== 2 || !plain(params[0]) || !block(params[1]))
          return bad();
        const transaction = params[0];
        if (
          !Object.keys(transaction).every((key) =>
            [
              "to",
              "from",
              "data",
              "input",
              "value",
              "gas",
              "gasPrice",
              "maxFeePerGas",
              "maxPriorityFeePerGas",
              "type",
              "nonce",
            ].includes(key),
          ) ||
          !allowedAddress(transaction.to) ||
          (transaction.from != null &&
            (!addressPattern.test(transaction.from) ||
              transaction.from.toLowerCase() !== owner?.toLowerCase())) ||
          (transaction.data != null &&
            transaction.input != null &&
            transaction.data !== transaction.input)
        )
          return bad();
        const data = transaction.data ?? transaction.input;
        if (
          typeof data !== "string" ||
          !hexPattern.test(data) ||
          data.length > 16_386
        )
          return bad();
        for (const key of [
          "value",
          "gas",
          "gasPrice",
          "maxFeePerGas",
          "maxPriorityFeePerGas",
          "type",
          "nonce",
        ])
          if (
            transaction[key] != null &&
            (typeof transaction[key] !== "string" ||
              !quantityPattern.test(transaction[key]))
          )
            return bad();
        if (
          (transaction.value != null && BigInt(transaction.value) !== 0n) ||
          (transaction.gas != null && BigInt(transaction.gas) > 5_000_000n)
        )
          return bad();
        break;
      }
      case "eth_getCode":
        if (
          params.length !== 2 ||
          !allowedAddress(params[0]) ||
          !block(params[1])
        )
          return bad();
        break;
      case "eth_getStorageAt":
        if (
          params.length !== 3 ||
          !allowedAddress(params[0]) ||
          typeof params[1] !== "string" ||
          !/^0x[\da-f]{1,64}$/i.test(params[1]) ||
          !block(params[2])
        )
          return bad();
        break;
      case "eth_getBalance":
      case "eth_getTransactionCount":
        if (params.length !== 2 || !ownAddress(params[0]) || !block(params[1]))
          return bad();
        break;
      case "eth_getBlockByNumber":
        if (
          params.length !== 2 ||
          !block(params[0]) ||
          typeof params[1] !== "boolean"
        )
          return bad();
        break;
      case "eth_getTransactionReceipt":
      case "eth_getTransactionByHash":
        if (
          params.length !== 1 ||
          typeof params[0] !== "string" ||
          !hashPattern.test(params[0])
        )
          return bad();
        break;
      default:
        return bad();
    }
  }
  return payload;
}

async function boundedJson(message, limit) {
  const declared = message.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new Error("Payload too large.");
  if (!message.body) throw new Error("Missing JSON payload.");
  const reader = message.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Payload too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Preserve only EVM revert bytes, never upstream messages, URLs or debug data.
function validRpcResult(value, depth = 0) {
  if (depth > 10) return false;
  if (value == null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  // Standard Ethereum reads return hex strings; OP fee scalars can be decimal.
  if (typeof value === "string")
    return /^0x[\da-f]*$/i.test(value) || /^\d+(?:\.\d+)?$/.test(value);
  if (Array.isArray(value))
    return (
      value.length <= 10_000 &&
      value.every((entry) => validRpcResult(entry, depth + 1))
    );
  return (
    plain(value) &&
    Object.entries(value).every(
      ([key, entry]) =>
        /^[a-z][a-z\d_]*$/i.test(key) && validRpcResult(entry, depth + 1),
    )
  );
}

export function cleanMigrationRpcResponse(payload, request) {
  const calls = Array.isArray(request) ? request : [request];
  const responses = Array.isArray(payload) ? payload : [payload];
  if (
    responses.length !== calls.length ||
    Array.isArray(payload) !== Array.isArray(request)
  )
    return bad();
  const seen = new Set();
  const result = responses.map((entry) => {
    if (
      !plain(entry) ||
      entry.jsonrpc !== "2.0" ||
      !calls.some((call) => call.id === entry.id) ||
      seen.has(`${typeof entry.id}:${entry.id}`)
    )
      return bad();
    seen.add(`${typeof entry.id}:${entry.id}`);
    const result = { jsonrpc: "2.0", id: entry.id };
    if (entry.error) {
      const raw = entry.error.data;
      const data =
        typeof raw === "string" ? raw : (raw?.data ?? raw?.originalError?.data);
      const safeData =
        typeof data === "string" &&
        hexPattern.test(data) &&
        data.length <= 32_770
          ? data
          : undefined;
      return {
        ...result,
        error: {
          code: Number.isSafeInteger(entry.error.code)
            ? entry.error.code
            : -32603,
          message: safeData ? "Contract call reverted." : "RPC request failed.",
          ...(safeData ? { data: safeData } : {}),
        },
      };
    }
    if (!Object.hasOwn(entry, "result") || !validRpcResult(entry.result))
      return bad();
    return { ...result, result: entry.result };
  });
  return Array.isArray(request) ? result : result[0];
}

function providerOutage(payload) {
  return (Array.isArray(payload) ? payload : [payload]).some((entry) => {
    const error = entry?.error;
    if (!error) return false;
    const raw = error.data;
    const data =
      typeof raw === "string" ? raw : (raw?.data ?? raw?.originalError?.data);
    // A simulated EVM revert is a contract result, not a provider outage.
    if (typeof data === "string" && data !== "0x" && hexPattern.test(data))
      return false;
    return (
      [-32603, -32005, -32002, -32016, -32001].includes(error.code) ||
      /rate.?limit|quota|too many|unavailable|timeout|timed out|upstream|overload|capacity|credits|compute units|access denied|api.?key|unauthoriz|forbidden|daily limit|batch.*limit/i.test(
        String(error.message || ""),
      )
    );
  });
}

export async function handleMigrationRpc(
  request,
  { network, session, env = process.env, fetcher = fetch },
) {
  const errorResponse = (error, status) =>
    Response.json({ error }, { status, headers });
  if (request.method !== "POST")
    return errorResponse("Method not allowed.", 405);
  if (!session?.user?.id)
    return errorResponse("Sign in to read migration contracts.", 401);
  if (!validNetwork(network))
    return errorResponse("Unknown migration network.", 404);
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return errorResponse("Use the application origin.", 403);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return errorResponse("Use a JSON RPC payload.", 415);
  const endpoints = privateRpcUrls(network, env);
  if (!endpoints.length)
    return errorResponse("Private migration RPC is not configured.", 503);
  let payload;
  try {
    payload = validateMigrationRpc(
      await boundedJson(request, requestLimit),
      network,
      session.user.walletAddress,
    );
  } catch {
    return errorResponse("Invalid or oversized migration RPC request.", 400);
  }
  const deadline = Date.now() + 20_000;
  for (let index = 0; index < endpoints.length; index++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Reserve time for later providers, including body consumption, so every
    // configured endpoint can be attempted within one bounded proxy request.
    const timeout = Math.max(
      1,
      Math.min(10_000, Math.floor(remaining / (endpoints.length - index))),
    );
    try {
      const upstream = await fetcher(endpoints[index], {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
      if (!upstream.ok) throw new Error("Provider unavailable.");
      const response = await boundedJson(upstream, responseLimit);
      const result = cleanMigrationRpcResponse(response, payload);
      if (providerOutage(response)) continue;
      return Response.json(result, { headers });
    } catch {
      // Network errors, quota responses and invalid replies try the next fixed
      // provider. No upstream response body or URL reaches the application.
    }
  }
  return errorResponse(
    "Migration RPC is temporarily unavailable. Retry the contract check.",
    502,
  );
}
