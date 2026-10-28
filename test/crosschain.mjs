import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveEpochRequest } from "../lib/crosschain-reads.mjs";
import {
  CROSSCHAIN_API_ORIGIN,
  crosschain,
  assertCrosschainIdentity,
} from "../lib/crosschain-config.mjs";
import {
  crosschainPath,
  readCrosschain,
  validateCrosschainResponse,
} from "../lib/crosschain-api.mjs";
import {
  crosschainAmount,
  requestId,
  verifyCrosschain,
  verifyCrosschainReceipt,
  executeCrosschain,
} from "../lib/crosschain-transactions.mjs";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "a".repeat(64);
const identity = {
  chainId: 8453,
  vault: crosschain.vault,
  asset: crosschain.asset,
  decimals: 6,
  profile: "stand",
};

test("API identity rejects a legacy vault, wrong network, token, decimals or profile", () => {
  assert.equal(assertCrosschainIdentity(identity), identity);
  for (const patch of [
    { vault: other },
    { chainId: 42161 },
    { asset: other },
    { decimals: 18 },
    { profile: "production" },
  ])
    assert.throws(
      () => assertCrosschainIdentity({ ...identity, ...patch }),
      /does not match/,
    );
  assert.throws(() => assertCrosschainIdentity(null));
});
test("proxy admits fixed health and lending resources only", () => {
  assert.equal(crosschainPath("backend-base"), "/lending?network=Base");
  for (const path of [
    "https://evil.test",
    "../keys",
    "__proto__",
    "constructor",
    "vault?url=x",
    "/v1/keys",
  ])
    assert.throws(() => crosschainPath(path, owner));
  for (const address of ["", "../admin", owner + "/../keys"])
    assert.throws(() => crosschainPath("user", address));
});
test("proxy uses the supplied fixed backend without cookies, bearer keys or redirects", async () => {
  let calls = 0;
  const result = await readCrosschain(
    "health",
    undefined,
    async (url, options) => {
      calls++;
      assert.equal(url, CROSSCHAIN_API_ORIGIN + "/health");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.deepEqual(options.headers, { Accept: "application/json" });
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ status: "ok", service: "api" });
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: "ok", service: "api", healthy: true });
});
test("outages, stale health, invalid JSON and mismatched API data fail explicitly", async () => {
  await assert.rejects(
    readCrosschain(
      "health",
      null,
      async () => new Response("bad gateway", { status: 502 }),
    ),
    /502/,
  );
  await assert.rejects(
    readCrosschain("backend-base", null, async () =>
      Response.json([{ token: "USDC", vaultAddress: other }]),
    ),
    /does not reference/,
  );
  await assert.rejects(
    readCrosschain("health", null, async () =>
      Response.json({ healthy: false }),
    ),
    /not healthy/,
  );
  await assert.rejects(
    readCrosschain("health", null, async () => new Response("<html>")),
  );
  await assert.rejects(
    readCrosschain("health", null, async () => {
      throw new Error("timeout");
    }),
    /timeout/,
  );
});
test("legacy backend funds cannot masquerade as cross-chain metrics", () => {
  assert.throws(
    () =>
      validateCrosschainResponse("backend-base", [
        {
          token: "USDC",
          vaultAddress: "0x3C7739173cca612B6394EE57131458185A5beC44",
          funds: 1000000,
        },
      ]),
    /does not reference/,
  );
  const matching = [
    { token: "USDC", vaultAddress: crosschain.networks[0].strategy },
  ];
  assert.equal(validateCrosschainResponse("backend-base", matching), matching);
});
test("requests follow epoch clearing and funding, including late deposit cancellation", () => {
  const request = {
    owner,
    receiver: owner,
    kind: 0,
    status: 1,
    epoch: 1n,
    amount: 100n,
  };
  const epoch = {
    depositsCleared: false,
    redeemsCleared: false,
    funded: false,
  };
  assert.equal(deriveEpochRequest(request, 1n, epoch).state, "pending");
  assert.equal(deriveEpochRequest(request, 2n, epoch).cancellable, true);
  assert.equal(
    deriveEpochRequest(request, 2n, { ...epoch, depositsCleared: true }).state,
    "claimable",
  );
  const redeem = { ...request, kind: 1 };
  assert.equal(deriveEpochRequest(redeem, 2n, epoch).cancellable, false);
  assert.equal(
    deriveEpochRequest(redeem, 2n, { ...epoch, redeemsCleared: true }).state,
    "awaiting_liquidity",
  );
  assert.equal(
    deriveEpochRequest(redeem, 2n, {
      ...epoch,
      redeemsCleared: true,
      funded: true,
    }).state,
    "claimable",
  );
  assert.equal(
    deriveEpochRequest({ ...request, status: 2 }, 2n, epoch).state,
    "cancelled",
  );
  assert.equal(
    deriveEpochRequest({ ...request, status: 3 }, 2n, epoch).state,
    "claimed",
  );
  assert.throws(() => deriveEpochRequest({ ...request, status: 0 }, 2n, epoch));
});
test("allocation must bind both chains to the pinned agents and strategies", () => {
  const allocation = {
    chains: crosschain.networks.map((chain) => ({ ...chain })),
    inFlight: [],
  };
  assert.equal(
    validateCrosschainResponse("allocation", allocation),
    allocation,
  );
  assert.throws(() =>
    validateCrosschainResponse("allocation", {
      chains: [allocation.chains[0]],
    }),
  );
  assert.throws(() =>
    validateCrosschainResponse("allocation", {
      chains: [allocation.chains[0], { ...allocation.chains[1], agent: other }],
    }),
  );
  assert.throws(() =>
    validateCrosschainResponse("user", { address: other }, owner),
  );
});
test("amounts use exact six-decimal arithmetic and enforce uint128 request limits", () => {
  assert.equal(crosschainAmount("1.000001"), 1000001n);
  assert.equal(crosschainAmount("0.000001"), 1n);
  for (const value of [
    "0",
    "-1",
    "1e6",
    "NaN",
    "1.0000001",
    "01",
    "340282366920938463463374607431769",
  ])
    assert.throws(() => crosschainAmount(value));
  assert.equal(requestId("9007199254740993"), 9007199254740993n);
  for (const value of ["-1", "1.5", "1/../2", "1e2", (2n ** 256n).toString()])
    assert.throws(() => requestId(value));
});
test("wrong RPC network and changed implementation stop before simulation", async () => {
  await assert.rejects(
    verifyCrosschain({ getChainId: async () => 42161 }, 1n),
    /Base/,
  );
  await assert.rejects(
    verifyCrosschain(
      {
        getChainId: async () => 8453,
        getStorageAt: async () => "0x" + "0".repeat(24) + other.slice(2),
      },
      1n,
    ),
    /implementation has changed/,
  );
});
test("a hash alone, reverted transaction or unrelated receipt is never success", () => {
  const receipt = {
    status: "success",
    transactionHash: hash,
    from: owner,
    to: crosschain.vault,
  };
  verifyCrosschainReceipt(receipt, hash, owner, crosschain.vault);
  for (const patch of [
    { status: "reverted" },
    { transactionHash: "0x" + "b".repeat(64) },
    { from: other },
    { to: other },
  ])
    assert.throws(() =>
      verifyCrosschainReceipt(
        { ...receipt, ...patch },
        hash,
        owner,
        crosschain.vault,
      ),
    );
});
test("wrong wallet and wrong wallet network cannot reach simulation or signing", async () => {
  const forbidden = () => {
    throw new Error("must not be reached");
  };
  const wallet = {
    getAddresses: async () => [other],
    getChainId: async () => 8453,
    writeContract: forbidden,
  };
  await assert.rejects(
    executeCrosschain({}, wallet, owner, "deposit", "1", forbidden),
    /signed-in wallet/,
  );
  wallet.getAddresses = async () => [owner];
  wallet.getChainId = async () => 42161;
  await assert.rejects(
    executeCrosschain({}, wallet, owner, "deposit", "1", forbidden),
    /signed-in wallet/,
  );
});
