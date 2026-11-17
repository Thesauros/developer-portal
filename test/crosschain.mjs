import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
} from "viem";
import {
  allMarkets,
  capitalMap,
  rateOnAllCapital,
  requestStage,
  valuationState,
} from "../lib/crosschain-feed.mjs";
import {
  deriveEpochRequest,
  receiptRequestIds,
  requestEvents,
} from "../lib/crosschain-reads.mjs";
import {
  CROSSCHAIN_API_ORIGIN,
  crosschain,
  assertCrosschainIdentity,
} from "../lib/crosschain-config.mjs";
import {
  readCrosschainMoves,
  readCrosschainRates,
} from "../lib/crosschain-api.mjs";
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
  epochAbi,
  receiptShowsCall,
} from "../lib/crosschain-transactions.mjs";

const requestEventsAbi = parseAbi([
  "event DepositRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 assets)",
]);

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
    {
      token: "USDC",
      vaultAddress: crosschain.vault,
      strategyAddress: crosschain.networks[0].strategy,
    },
  ];
  assert.equal(validateCrosschainResponse("backend-base", matching), matching);
});
test("both networks use the Base EpochVault and their own strategy", async () => {
  for (const network of crosschain.networks) {
    const resource = `backend-${network.name.toLowerCase()}`;
    const rows = [
      {
        token: "USDC",
        vaultAddress: crosschain.vault.toLowerCase(),
        strategyAddress: network.strategy.toLowerCase(),
        funds: 0,
      },
    ];
    assert.equal(validateCrosschainResponse(resource, rows), rows);
    assert.deepEqual(
      await readCrosschain(resource, undefined, async (url) => {
        assert.equal(
          url,
          `${CROSSCHAIN_API_ORIGIN}/lending?network=${network.name}`,
        );
        return Response.json(rows);
      }),
      rows,
    );
  }
});
test("backend identity requires both the hub vault and the network strategy", () => {
  for (const network of crosschain.networks) {
    const resource = `backend-${network.name.toLowerCase()}`;
    const matching = {
      token: "USDC",
      vaultAddress: crosschain.vault,
      strategyAddress: network.strategy,
    };
    const otherNetwork = crosschain.networks.find(
      (candidate) => candidate.chainId !== network.chainId,
    );
    for (const patch of [
      { vaultAddress: undefined },
      { vaultAddress: null },
      { vaultAddress: "not-an-address" },
      { vaultAddress: other },
      { vaultAddress: network.strategy },
      { vaultAddress: otherNetwork.strategy },
      { strategyAddress: undefined },
      { strategyAddress: null },
      { strategyAddress: "not-an-address" },
      { strategyAddress: other },
      { strategyAddress: crosschain.vault },
      { strategyAddress: otherNetwork.strategy },
    ]) {
      const mismatched = { ...matching, ...patch };
      assert.throws(
        () => validateCrosschainResponse(resource, [mismatched]),
        /does not reference/,
        `${network.name} must reject ${JSON.stringify(patch)}`,
      );
      assert.throws(
        () => validateCrosschainResponse(resource, [matching, mismatched]),
        /does not reference/,
        `${network.name} must validate every USDC row`,
      );
    }
    for (const value of [null, {}, matching, [], [{ token: "USDT" }]])
      assert.throws(
        () => validateCrosschainResponse(resource, value),
        /does not reference/,
      );
  }
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
    rateOffer: 10n ** 18n,
    priceRedeem: 10n ** 18n,
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
    /contract code has changed/,
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
test("a wallet relay is confirmed only by the vault's own matching event", () => {
  const wallet = "0x" + "1".repeat(40);
  const data = encodeFunctionData({
    abi: epochAbi,
    functionName: "requestDeposit",
    args: [5_000_000n, wallet],
  });
  const log = (assets, logOwner = wallet, address = crosschain.vault) => ({
    address,
    topics: encodeEventTopics({
      abi: requestEventsAbi,
      eventName: "DepositRequested",
      args: { requestId: 7n, epoch: 9n, owner: logOwner },
    }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [wallet, assets],
    ),
  });
  const receipt = (logs, status = "success") => ({ status, logs });
  assert.equal(
    receiptShowsCall(
      receipt([log(5_000_000n)]),
      wallet,
      crosschain.vault,
      data,
    ),
    true,
  );
  for (const bad of [
    receipt([]),
    receipt([log(4_999_999n)]),
    receipt([log(5_000_000n, "0x" + "2".repeat(40))]),
    receipt([log(5_000_000n, wallet, "0x" + "3".repeat(40))]),
    receipt([log(5_000_000n)], "reverted"),
  ])
    assert.equal(receiptShowsCall(bad, wallet, crosschain.vault, data), false);
});
test("a request's ID is read from its receipt", () => {
  const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const encode = (eventName, ownerAddress, receiver) => ({
    address: crosschain.vault,
    topics: encodeEventTopics({
      abi: requestEvents,
      eventName,
      args: { requestId: 42n, epoch: 7n, owner: ownerAddress },
    }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [receiver, 10000000n],
    ),
  });
  assert.deepEqual(
    receiptRequestIds(
      { logs: [encode("DepositRequested", owner, owner)] },
      owner,
    ),
    ["42"],
  );
  assert.deepEqual(
    receiptRequestIds(
      { logs: [encode("RedeemRequested", owner, owner)] },
      owner,
    ),
    ["42"],
  );
  // Someone else's request and other contracts' logs are ignored.
  const other = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  assert.deepEqual(
    receiptRequestIds(
      { logs: [encode("DepositRequested", other, other)] },
      owner,
    ),
    [],
  );
  assert.deepEqual(
    receiptRequestIds(
      {
        logs: [{ ...encode("DepositRequested", owner, owner), address: other }],
      },
      owner,
    ),
    [],
  );
});
test("rates and moves are read from fixed sources and never invent points", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes("/v1/transfers")
      ? [
          {
            id: "0x1",
            src_chain: 8453,
            dst_chain: 42161,
            amount: "4000000",
            sent_tx: "0x" + "a".repeat(64),
            sent_at: 100,
            received_at: 200,
          },
          { id: "0x2", src_chain: 1, dst_chain: 8453, amount: "1" },
          {
            id: "0x3",
            src_chain: 8453,
            dst_chain: 42161,
            amount: "not a number",
          },
        ]
      : [
          { from: "2026-10-30T00:00:00Z", value: 6.5 },
          { from: "2026-10-29T00:00:00Z", value: "5" },
          { from: "not a date", value: 1 },
          { from: "2026-10-28T00:00:00Z", value: null },
        ];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const { moves } = await readCrosschainMoves();
    assert.equal(moves.length, 1);
    assert.equal(moves[0].from, "Base");
    assert.equal(moves[0].to, "Arbitrum");
    assert.equal(moves[0].sentAt, 100000);
    assert.equal(moves[0].tx, "0x" + "a".repeat(64));
    const rates = await readCrosschainRates("30d");
    assert.equal(rates.networks.length, 2);
    const [base] = rates.networks;
    assert.equal(base.name, "Base");
    assert.deepEqual(
      base.vault.map((point) => point.v),
      [5, 6.5],
    );
    assert.ok(calls.every((url) => /^https:\/\//.test(url)));
    assert.ok(
      calls.some((url) =>
        url.includes("/lending/USDC/apr-ticks/30d?network=Base"),
      ),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("request stages follow the settlement order", () => {
  assert.equal(requestStage({ kind: "deposit", state: "pending" }).step, 0);
  assert.equal(requestStage({ kind: "redeem", state: "clearing" }).step, 1);
  const waiting = requestStage({ kind: "redeem", state: "awaiting_liquidity" });
  assert.equal(waiting.ready, undefined);
  assert.equal(
    requestStage({ kind: "redeem", state: "claimable" }).ready,
    true,
  );
  assert.equal(requestStage({ kind: "deposit", state: "claimed" }).step, 3);
  assert.equal(
    requestStage({ kind: "deposit", state: "cancelled" }).cancelled,
    true,
  );
  assert.equal(valuationState({ tick: { frozen: true } }).level, "frozen");
  assert.equal(
    valuationState({ tick: { ageSeconds: 9000 }, risk: { maxTickAge: 7200 } })
      .level,
    "stale",
  );
  assert.equal(
    valuationState({ tick: { ageSeconds: 60 }, risk: { maxTickAge: 7200 } })
      .level,
    "ok",
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
