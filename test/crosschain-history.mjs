import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { crosschain } from "../lib/crosschain-config.mjs";
import {
  decodeHistoryLog,
  openCrosschainHistory,
  syncCrosschainHistory,
  readIndexedActivity,
} from "../lib/crosschain-history.mjs";
import {
  loadCrosschainFeed,
  crosschainAccountViews,
  mergeTrackedRequestIds,
} from "../lib/crosschain-feed.mjs";

const owner = "0x1111111111111111111111111111111111111111",
  other = "0x2222222222222222222222222222222222222222";
const abi = parseAbi([
  "event DepositRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 assets)",
  "event DepositClaimed(uint256 indexed requestId,address indexed receiver,uint256 shares)",
]);

test("verified active request IDs take priority and merge without duplicate or input mutation", () => {
  const primary = Object.freeze(["17", "4", "17", "0"]);
  const secondary = Object.freeze(["4", "9", "17", "10", "0"]);
  assert.deepEqual(mergeTrackedRequestIds(primary, secondary), [
    "17",
    "4",
    "0",
    "9",
    "10",
  ]);
  assert.deepEqual(primary, ["17", "4", "17", "0"]);
  assert.deepEqual(secondary, ["4", "9", "17", "10", "0"]);
});

test("tracked request queries retain at most twenty IDs with primary priority", () => {
  const manual = Array.from({ length: 30 }, (_, index) => String(index + 1));
  assert.deepEqual(mergeTrackedRequestIds(["900", "901"], manual), [
    "900",
    "901",
    ...manual.slice(0, 18),
  ]);
  const active = Array.from({ length: 25 }, (_, index) => String(index + 100));
  assert.deepEqual(
    mergeTrackedRequestIds(active, ["999"]),
    active.slice(0, 20),
  );
  assert.equal(mergeTrackedRequestIds(["1", "1"], ["1", ...manual]).length, 20);
});

test("only canonical decimal uint256 IDs enter a tracked request query", () => {
  const maximum = (2n ** 256n - 1n).toString();
  const invalid = [
    "",
    "01",
    "00",
    "-1",
    "+1",
    "1.0",
    "1e2",
    " 1",
    "1 ",
    "0x01",
    "NaN",
    "1,2",
    "1&owner=other",
    (2n ** 256n).toString(),
    "9".repeat(79),
    null,
    undefined,
    1,
    1n,
    {},
    [],
  ];
  assert.deepEqual(mergeTrackedRequestIds(invalid, [maximum, "0", "12"]), [
    maximum,
    "0",
    "12",
  ]);
  assert.deepEqual(mergeTrackedRequestIds(), []);
  assert.deepEqual(mergeTrackedRequestIds(null, ["7"]), ["7"]);
  assert.deepEqual(mergeTrackedRequestIds("1,2", ["7"]), ["7"]);
});

test("request-ID merging and account feeds do not retain another wallet's tracked IDs", async () => {
  const first = mergeTrackedRequestIds(["17"], ["1"]);
  const second = mergeTrackedRequestIds(["22"], ["2"]);
  const firstCalls = [],
    secondCalls = [],
    anonymousCalls = [];
  const firstFeed = await loadCrosschainFeed(owner, first, async (resource) => {
    firstCalls.push(resource);
    return { resource };
  });
  const secondFeed = await loadCrosschainFeed(
    other,
    second,
    async (resource) => {
      secondCalls.push(resource);
      return { resource };
    },
  );
  assert.equal(firstFeed.user.resource, "user?requests=17,1");
  assert.equal(secondFeed.user.resource, "user?requests=22,2");
  assert.ok(!secondCalls.some((resource) => resource.includes("17")));
  assert.ok(!firstCalls.some((resource) => resource.includes("22")));
  const anonymous = await loadCrosschainFeed(null, first, async (resource) => {
    anonymousCalls.push(resource);
    return {};
  });
  assert.equal(anonymous.user, null);
  assert.equal(anonymous.activity, null);
  assert.ok(
    !anonymousCalls.some(
      (resource) => resource.startsWith("user") || resource === "activity",
    ),
  );
  assert.deepEqual(mergeTrackedRequestIds([], []), []);
});

function deposit(wallet = owner, index = 0) {
  return {
    address: crosschain.vault,
    transactionHash: "0x" + "ab".repeat(32),
    logIndex: index,
    blockNumber: BigInt(crosschain.startBlock + index),
    blockHash: "0x" + "cd".repeat(32),
    topics: encodeEventTopics({
      abi,
      eventName: "DepositRequested",
      args: { requestId: BigInt(index + 1), epoch: 1n, owner: wallet },
    }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [wallet, 1234567n],
    ),
  };
}
test("decode only genuine stand events, preserving exact units and transaction identity", () => {
  const log = deposit();
  const event = decodeHistoryLog(log, 100);
  assert.equal(event.type, "deposit_requested");
  assert.equal(event.assets, "1234567");
  assert.equal(event.requestId, "1");
  assert.equal(event.at, 100000);
  assert.equal(decodeHistoryLog({ ...log, address: other }, 100), null);
  assert.equal(decodeHistoryLog({ ...log, removed: true }, 100), null);
  assert.equal(decodeHistoryLog({ ...log, data: "0x" }, 100), null);
});
test("persistent index scopes wallets, joins claim events and deduplicates overlap", async () => {
  const store = openCrosschainHistory(":memory:");
  try {
    const log = deposit(),
      unrelated = deposit(other, 1);
    const claim = {
      ...log,
      logIndex: 2,
      blockNumber: BigInt(crosschain.startBlock + 2),
      topics: encodeEventTopics({
        abi,
        eventName: "DepositClaimed",
        args: { requestId: 1n, receiver: owner },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [1234000n]),
    };
    const logs = [log, unrelated, claim];
    const client = {
      getChainId: async () => 8453,
      getBlockNumber: async () => BigInt(crosschain.startBlock + 15),
      getLogs: async ({ fromBlock, toBlock }) =>
        logs.filter(
          (item) =>
            item.blockNumber >= fromBlock && item.blockNumber <= toBlock,
        ),
      getBlock: async ({ blockNumber }) => ({ timestamp: blockNumber + 1000n }),
    };
    await syncCrosschainHistory(store, client);
    const history = readIndexedActivity(owner, store);
    assert.equal(history.coverage.complete, true);
    assert.equal(history.events.length, 2);
    assert.deepEqual(history.requestIds, ["1"]);
    assert.equal(readIndexedActivity(other, store).events.length, 1);
    await syncCrosschainHistory(store, client);
    assert.equal(readIndexedActivity(owner, store).events.length, 2);
    logs.pop(); // A disappeared overlap event is removed, not retained as a success.
    await syncCrosschainHistory(store, client);
    assert.equal(readIndexedActivity(owner, store).events.length, 1);
  } finally {
    store.close();
  }
});
test("history scan errors do not advance the cursor or fabricate an empty complete history", async () => {
  const store = openCrosschainHistory(":memory:");
  try {
    await assert.rejects(
      syncCrosschainHistory(store, {
        getChainId: async () => 8453,
        getBlockNumber: async () => BigInt(crosschain.startBlock + 100),
        getLogs: async () => {
          throw new Error("RPC offline");
        },
      }),
      /RPC offline/,
    );
    const history = readIndexedActivity(owner, store);
    assert.equal(history.coverage.complete, false);
    assert.equal(history.coverage.indexedTo, crosschain.startBlock - 1);
  } finally {
    store.close();
  }
});
test("all account tabs use one cross-chain feed; backend mismatch is not an allocation failure", async () => {
  for (const view of ["overview", "vaults", "activity", "earn"])
    assert.ok(crosschainAccountViews.includes(view));
  const calls = [];
  const feed = await loadCrosschainFeed(owner, ["1"], async (resource) => {
    calls.push(resource);
    if (resource.startsWith("backend-")) throw new Error("wrong backend vault");
    return { source: resource };
  });
  assert.equal(feed.sourceErrors.allocation, "");
  assert.equal(feed.sourceErrors.account, "");
  assert.equal(feed.backendError, "wrong backend vault");
  assert.equal(feed.user.source, "user?requests=1");
  assert.equal(feed.activity.source, "activity");
  assert.ok(
    !calls.some(
      (call) => call.includes("/app/insights") || call.includes("/app/onchain"),
    ),
  );
  const failed = await loadCrosschainFeed(owner, [], async (resource) => {
    if (resource === "allocation") throw new Error("Base RPC unavailable");
    return {};
  });
  assert.equal(failed.sourceErrors.allocation, "Base RPC unavailable");
  assert.equal(failed.sourceErrors.account, "");
});
