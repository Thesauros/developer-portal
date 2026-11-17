import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData } from "viem";
import { crosschain } from "../lib/crosschain-config.mjs";
import { vaults, tokenAbi } from "../lib/vault-contracts.mjs";
import {
  cleanMigrationRpcResponse,
  handleMigrationRpc,
  migrationRpcTargets,
  privateMigrationRpcUrl,
  validateMigrationRpc,
} from "../lib/migration-rpc.mjs";
import {
  patientTransport,
  privateRpcTransport,
  privateRpcUrls,
  vaultRpcUrls,
  PROXIED_NETWORKS,
} from "../lib/vault-rpc.mjs";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const endpoint = "https://base.example.test/v2/private-test-key";
const env = {
  MIGRATION_BASE_RPC_URL: endpoint,
  MIGRATION_ARBITRUM_RPC_URL:
    "https://arb.example.test/rpc?key=private-arb-key",
};
const session = { user: { id: "signed-in-user", walletAddress: owner } };
const call = (method, params = [], id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
const request = (payload, extra = {}) =>
  new Request("https://app.example.test/api/migration/rpc/base", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.example.test",
      Cookie: "session=private",
      ...extra.headers,
    },
    body: JSON.stringify(payload),
    ...Object.fromEntries(
      Object.entries(extra).filter(([key]) => key !== "headers"),
    ),
  });
const options = (patch = {}) => ({ network: "base", session, env, ...patch });

test("server uses private HTTPS providers first, browser only knows same-origin proxy and public fallbacks", () => {
  // Only Base and Arbitrum have a proxy; every other network reads public RPCs.
  for (const vault of vaults.filter(
    (entry) => !PROXIED_NETWORKS.includes(entry.id),
  )) {
    assert.deepEqual(vaultRpcUrls(vault, { browser: true, env }), vault.rpcs);
    assert.deepEqual(vaultRpcUrls(vault, { browser: false, env }), vault.rpcs);
  }
  for (const vault of vaults.filter((entry) =>
    PROXIED_NETWORKS.includes(entry.id),
  )) {
    const browser = vaultRpcUrls(vault, { browser: true, env });
    assert.deepEqual(browser, [
      `/api/migration/rpc/${vault.id}`,
      ...vault.rpcs,
    ]);
    assert.doesNotMatch(
      JSON.stringify(browser),
      /private-test-key|private-arb-key/,
    );
    assert.deepEqual(vaultRpcUrls(vault, { browser: false, env }), [
      env[
        vault.id === "base"
          ? "MIGRATION_BASE_RPC_URL"
          : "MIGRATION_ARBITRUM_RPC_URL"
      ],
      ...vault.rpcs,
    ]);
    assert.deepEqual(
      vaultRpcUrls(vault, { browser: false, env: {} }),
      vault.rpcs,
    );
  }
  for (const value of [
    "http://rpc.test/key",
    "file:///secret",
    "https://name:pass@rpc.test",
    "https://rpc.test/#secret",
    "bad",
  ])
    assert.equal(
      privateMigrationRpcUrl("base", { MIGRATION_BASE_RPC_URL: value }),
      null,
    );
  assert.equal(privateMigrationRpcUrl("__proto__", env), null);
});

test("private URL lists preserve order, trim, deduplicate, cap six endpoints and retain singular compatibility", () => {
  const endpoints = Array.from(
    { length: 8 },
    (_, index) => `https://rpc${index}.example.test/private-key-${index}`,
  );
  const listEnv = {
    ...env,
    MIGRATION_BASE_RPC_URLS: ` ${endpoints[0]}, ${endpoints[1]}, ${endpoints[0]}, http://insecure.test, https://name:pass@rpc.test, bad, ${endpoints.slice(2).join(",")}`,
    MIGRATION_ARBITRUM_RPC_URLS: `${endpoints[6]},${endpoints[7]}`,
  };
  assert.deepEqual(privateRpcUrls("base", listEnv), endpoints.slice(0, 6));
  assert.deepEqual(privateRpcUrls("arbitrum", listEnv), endpoints.slice(6));
  assert.deepEqual(
    vaultRpcUrls(
      vaults.find((vault) => vault.id === "base"),
      { browser: false, env: listEnv },
    ),
    [
      ...endpoints.slice(0, 6),
      ...vaults.find((vault) => vault.id === "base").rpcs,
    ],
  );
  assert.deepEqual(
    privateRpcUrls("base", { ...env, MIGRATION_BASE_RPC_URLS: "  " }),
    [endpoint],
  );
  assert.deepEqual(
    privateRpcUrls("base", { ...env, MIGRATION_BASE_RPC_URLS: "bad" }),
    [],
  );
  assert.deepEqual(privateRpcUrls("constructor", listEnv), []);
  const browser = vaultRpcUrls(
    vaults.find((vault) => vault.id === "base"),
    { browser: true, env: listEnv },
  );
  assert.doesNotMatch(JSON.stringify(browser), /private-key|rpc\d\.example/);
});

test("proxy fails over fixed providers in order after HTTP, network and quota failures", async () => {
  const endpoints = Array.from(
    { length: 4 },
    (_, index) => `https://rpc${index}.example.test/private-key-${index}`,
  );
  const attempted = [];
  const response = await handleMigrationRpc(
    request(call("eth_chainId")),
    options({
      env: { MIGRATION_BASE_RPC_URLS: endpoints.join(",") },
      fetcher: async (url, init) => {
        attempted.push(url);
        assert.ok(init.signal instanceof AbortSignal);
        if (url === endpoints[0])
          return new Response("key must remain private", { status: 502 });
        if (url === endpoints[1]) throw new Error(`Network failure ${url}`);
        if (url === endpoints[2])
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32005, message: `Quota exceeded ${url}` },
          });
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2105" });
      },
    }),
  );
  assert.deepEqual(attempted, endpoints);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: 1,
    result: "0x2105",
  });
});

test("a contract revert remains a user result instead of trying every private provider", async () => {
  let calls = 0;
  const response = await handleMigrationRpc(
    request(
      call("eth_call", [
        { to: crosschain.vault, from: owner, data: "0x12345678" },
        "latest",
      ]),
    ),
    options({
      env: {
        MIGRATION_BASE_RPC_URLS: `${endpoint},https://second.example.test/private-key`,
      },
      fetcher: async () => {
        calls++;
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32000,
            message: `execution reverted ${endpoint}`,
            data: "0x12345678",
          },
        });
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).error, {
    code: -32000,
    message: "Contract call reverted.",
    data: "0x12345678",
  });
});

test("proxy stops provider failover when the total request budget is exhausted", async (context) => {
  let observedTime = 1000;
  context.mock.method(Date, "now", () => observedTime);
  let calls = 0;
  const endpoints = Array.from(
    { length: 6 },
    (_, index) => `https://rpc${index}.example.test/private-key`,
  );
  const response = await handleMigrationRpc(
    request(call("eth_chainId")),
    options({
      env: { MIGRATION_BASE_RPC_URLS: endpoints.join(",") },
      fetcher: async () => {
        calls++;
        observedTime += 11_000;
        throw new Error("Provider outage.");
      },
    }),
  );
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-key|rpc\d\.example/);
});

test("pinned legacy implementations and crosschain deployment targets are admitted only on their configured networks", () => {
  const baseTargets = migrationRpcTargets("base");
  const arbTargets = migrationRpcTargets("arbitrum");
  assert.ok(baseTargets.has(crosschain.vault.toLowerCase()));
  assert.ok(baseTargets.has(crosschain.logic.toLowerCase()));
  assert.ok(baseTargets.has("0xd4ac8bcec0790adda563db1b35c072b485fe2708"));
  assert.ok(arbTargets.has("0xed3296117daaa46fe4cf94036bb42ee86100f8c7"));
  assert.ok(!arbTargets.has(crosschain.vault.toLowerCase()));
  for (const network of [
    "__proto__",
    "constructor",
    "https://evil.test",
    "base/../arb",
  ])
    assert.throws(() => migrationRpcTargets(network));
});

test("required reads and eth_call simulations pass without allowing writes or state overrides", () => {
  const reads = [
    call("eth_chainId"),
    call("eth_blockNumber"),
    call("eth_getCode", [crosschain.implementation, "latest"]),
    call("eth_getStorageAt", [
      crosschain.vault,
      `0x${"3".repeat(64)}`,
      "0x1234",
    ]),
    call("eth_getBalance", [owner, "latest"]),
    call("eth_getTransactionCount", [owner, "pending"]),
    call("eth_getBlockByNumber", ["safe", false]),
    call("eth_getBlockByNumber", ["0x123", true]),
    call("eth_getTransactionReceipt", [hash]),
    call("eth_getTransactionByHash", [hash]),
    call("eth_call", [
      {
        to: crosschain.asset,
        from: owner,
        data: encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [crosschain.vault, 1_000_000n],
        }),
      },
      "latest",
    ]),
  ];
  for (const value of reads)
    assert.equal(validateMigrationRpc(value, "base", owner), value);
  const batch = reads.map((value, index) => ({ ...value, id: index }));
  assert.equal(validateMigrationRpc(batch, "base", owner), batch);
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "eth_sign",
    "personal_sign",
    "eth_estimateGas",
    "eth_getLogs",
    "debug_traceCall",
    "eth_getProof",
  ])
    assert.throws(() => validateMigrationRpc(call(method, []), "base", owner));
  for (const params of [
    [{ to: other, data: "0x12345678" }, "latest"],
    [{ to: crosschain.vault, from: other, data: "0x12345678" }, "latest"],
    [{ to: crosschain.vault, data: "0x12345678", value: "0x1" }, "latest"],
    [{ to: crosschain.vault, data: "0x12345678", gas: "0xfffffff" }, "latest"],
    [
      { to: crosschain.vault, data: "0x12345678", blobVersionedHashes: [] },
      "latest",
    ],
    [
      { to: crosschain.vault, data: "0x12345678" },
      "latest",
      { [other]: { balance: "0xffff" } },
    ],
    [
      { to: crosschain.vault, data: "0x12345678", input: "0xffffffff" },
      "latest",
    ],
  ])
    assert.throws(() =>
      validateMigrationRpc(call("eth_call", params), "base", owner),
    );
  assert.throws(() =>
    validateMigrationRpc(
      call("eth_getBalance", [other, "latest"]),
      "base",
      owner,
    ),
  );
  assert.throws(() =>
    validateMigrationRpc(call("eth_getCode", [other, "latest"]), "base", owner),
  );
});

test("malformed envelopes, notifications, duplicate IDs and oversized batches are rejected", () => {
  for (const value of [
    null,
    [],
    {},
    { ...call("eth_chainId"), id: null },
    { ...call("eth_chainId"), jsonrpc: "1.0" },
    { ...call("eth_chainId"), url: endpoint },
    { ...call("eth_chainId"), params: {} },
    [call("eth_chainId"), call("eth_blockNumber")],
    Array.from({ length: 31 }, (_, i) => call("eth_chainId", [], i)),
  ])
    assert.throws(() => validateMigrationRpc(value, "base", owner));
});

test("proxy requires a session, fixed network, same origin and JSON before contacting upstream", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error("Must not contact upstream.");
  };
  for (const [req, patch, status] of [
    [request(call("eth_chainId")), { session: null }, 401],
    [request(call("eth_chainId")), { network: "constructor" }, 404],
    [
      request(call("eth_chainId"), {
        headers: { Origin: "https://evil.test" },
      }),
      {},
      403,
    ],
    [
      request(call("eth_chainId"), {
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      {},
      403,
    ],
    [
      request(call("eth_chainId"), {
        headers: { "Content-Type": "text/plain" },
      }),
      {},
      415,
    ],
    [request(call("eth_chainId")), { env: {} }, 503],
    [request(call("eth_sendRawTransaction", [hash])), {}, 400],
  ])
    assert.equal(
      (await handleMigrationRpc(req, options({ ...patch, fetcher }))).status,
      status,
    );
  assert.equal(calls, 0);
});

test("proxy accepts the origin visitors use when the server listens under another name", async () => {
  // Behind a proxy (or on localhost beside 127.0.0.1) the URL the server builds
  // is not the one in the browser; the Host the browser sent is.
  const behind = (headers) =>
    new Request("http://localhost:3000/api/migration/rpc/base", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(call("eth_chainId")),
    });
  const status = async (headers) =>
    (await handleMigrationRpc(behind(headers), options({ env: {} }))).status;
  // 503 here means the origin check passed: no private RPC in this env.
  assert.equal(
    await status({ Origin: "https://app.example.test", Host: "app.example.test" }),
    503,
  );
  assert.equal(
    await status({
      Origin: "https://app.example.test",
      Host: "localhost:3000",
      "X-Forwarded-Host": "app.example.test",
    }),
    503,
  );
  assert.equal(
    await status({ Origin: "https://evil.test", Host: "app.example.test" }),
    403,
  );
  assert.equal(await status({ Origin: "null", Host: "app.example.test" }), 403);
});

test("proxy bounds streamed payloads independently of Content-Length", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error();
  };
  const large = request({
    ...call("eth_chainId"),
    padding: "x".repeat(65_536),
  });
  assert.equal(
    (await handleMigrationRpc(large, options({ fetcher }))).status,
    400,
  );
  const declared = request(call("eth_chainId"), {
    headers: { "Content-Length": "65537" },
  });
  assert.equal(
    (await handleMigrationRpc(declared, options({ fetcher }))).status,
    400,
  );
  assert.equal(calls, 0);
});

test("fixed upstream receives only the bounded JSON body, no account cookies or caller headers", async () => {
  const payload = [call("eth_chainId", [], 1), call("eth_blockNumber", [], 2)];
  const response = await handleMigrationRpc(
    request(payload),
    options({
      fetcher: async (url, init) => {
        assert.equal(url, endpoint);
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "error");
        assert.equal(init.cache, "no-store");
        assert.ok(init.signal instanceof AbortSignal);
        assert.deepEqual(init.headers, {
          Accept: "application/json",
          "Content-Type": "application/json",
        });
        assert.deepEqual(JSON.parse(init.body), payload);
        return Response.json([
          { jsonrpc: "2.0", id: 2, result: "0x123" },
          { jsonrpc: "2.0", id: 1, result: "0x2105" },
        ]);
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), [
    { jsonrpc: "2.0", id: 2, result: "0x123" },
    { jsonrpc: "2.0", id: 1, result: "0x2105" },
  ]);
});

test("upstream errors never expose private URLs, while EVM revert bytes remain available for transaction feedback", async () => {
  const payload = call("eth_chainId");
  const response = await handleMigrationRpc(
    request(payload),
    options({
      fetcher: async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32000,
            message: endpoint,
            data: { url: endpoint, data: "0x12345678" },
          },
        }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: 1,
    error: {
      code: -32000,
      message: "Contract call reverted.",
      data: "0x12345678",
    },
  });
  for (const fetcher of [
    async () => {
      throw new Error(endpoint);
    },
    async () => new Response(endpoint, { status: 429 }),
    async () => new Response(endpoint),
    async () => Response.json({ jsonrpc: "2.0", id: 99, result: "0x1" }),
    async () => Response.json({ jsonrpc: "2.0", id: 1, result: endpoint }),
    async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { hash, debug: endpoint },
      }),
  ]) {
    const failed = await handleMigrationRpc(
      request(payload),
      options({ fetcher }),
    );
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /private-test-key|base\.example/);
  }
  assert.throws(() =>
    cleanMigrationRpcResponse(
      [{ jsonrpc: "2.0", id: 1, result: "0x1" }],
      payload,
    ),
  );
});

test("direct server private transport scrubs both nested errors and transport metadata", async () => {
  const transport = privateRpcTransport(endpoint, {
    retryCount: 0,
    fetchFn: async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 3, message: endpoint, data: "0x12345678" },
      }),
  });
  const client = transport({
    chain: vaults.find((vault) => vault.id === "base").chain,
    retryCount: 0,
  });
  assert.equal(client.value.url, "Private server RPC");
  await assert.rejects(client.request({ method: "eth_chainId" }), (error) => {
    assert.equal(error.code, 3);
    assert.equal(error.data, "0x12345678");
    assert.doesNotMatch(String(error), /private-test-key|base\.example/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("a rationed public endpoint is asked again after a pause, and no other failure is", async () => {
  const chain = vaults.find((vault) => vault.id === "monad").chain;
  const answer = (id) => Response.json({ jsonrpc: "2.0", id, result: "0x8f" });
  const refusal = () => new Response("Rate limit exceeded", { status: 429 });
  const run = async (responses) => {
    const pauses = [];
    let asked = 0;
    const transport = patientTransport(
      "https://rpc.monad.example",
      {
        retryCount: 0,
        fetchFn: async (_, init) =>
          responses[asked++](JSON.parse(init.body).id),
      },
      { sleep: async (ms) => pauses.push(ms) },
    );
    const client = transport({ chain, retryCount: 0 });
    let result, failure;
    try {
      result = await client.request({ method: "eth_chainId" });
    } catch (error) {
      failure = error;
    }
    return { result, failure, asked, pauses };
  };
  // Refused twice, then answered: the read succeeds after both pauses.
  let outcome = await run([refusal, refusal, answer]);
  assert.equal(outcome.result, "0x8f");
  assert.deepEqual(outcome.pauses, [400, 900]);
  // Still refused after the last pause: the refusal reaches the caller, so the
  // next endpoint is tried.
  outcome = await run([refusal, refusal, refusal, answer]);
  assert.equal(outcome.failure.status, 429);
  assert.equal(outcome.asked, 3);
  // An endpoint that is down is not waited on.
  outcome = await run([() => new Response("down", { status: 503 }), answer]);
  assert.equal(outcome.failure.status, 503);
  assert.equal(outcome.asked, 1);
  assert.deepEqual(outcome.pauses, []);
});

test("Monad reads travel as single calls grouped in a contract call, the other networks as JSON-RPC batches", () => {
  for (const vault of vaults)
    assert.equal(
      vault.groupReads,
      vault.id === "monad" ? "multicall" : "batch",
      vault.id,
    );
  assert.ok(vaults.find((vault) => vault.id === "monad").chain.contracts.multicall3);
});
