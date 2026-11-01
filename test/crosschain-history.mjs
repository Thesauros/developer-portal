import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { crosschain } from "../lib/crosschain-config.mjs";
import {
  decodeHistoryLog,
  openCrosschainHistory,
  syncCrosschainHistory,
  readAcceptedTicks,
  readBatchRequests,
  readIndexedActivity,
} from "../lib/crosschain-history.mjs";
import { loadCrosschainFeed } from "../lib/crosschain-feed.mjs";

const owner = "0x1111111111111111111111111111111111111111",
  other = "0x2222222222222222222222222222222222222222";
const abi = parseAbi([
  "event DepositRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 assets)",
  "event DepositClaimed(uint256 indexed requestId,address indexed receiver,uint256 shares)",
]);
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
test("the valuation history is never capped, so no outage can fall off it", () => {
  const store = openCrosschainHistory(":memory:");
  try {
    const insert = store.db.prepare(
      "INSERT INTO chain_events VALUES(?,?,?,?,?,?,?,?,?)",
    );
    for (let i = 0; i < 700; i++)
      insert.run(
        "0x" + String(i).padStart(64, "0"),
        0,
        i,
        "TickCommitted",
        null,
        null,
        null,
        i * 1000,
        JSON.stringify({
          at: i * 1000,
          tickId: String(i),
          status: 1,
          rateBid: "1",
          navBid: "1",
        }),
      );
    const ticks = readAcceptedTicks(store);
    assert.equal(ticks.length, 700);
    assert.equal(ticks[0].at, 0);
    assert.deepEqual(Object.keys(ticks[0]).sort(), [
      "at",
      "navBid",
      "rateBid",
      "tickId",
    ]);
  } finally {
    store.close();
  }
});
test("batches are grouped without naming any wallet", () => {
  const store = openCrosschainHistory(":memory:");
  try {
    const insert = store.db.prepare(
      "INSERT INTO chain_events VALUES(?,?,?,?,?,?,?,?,?)",
    );
    const add = (i, name, fields) =>
      insert.run(
        "0x" + String(i).padStart(64, "0"),
        0,
        i,
        name,
        owner,
        owner,
        String(i),
        i * 1000,
        JSON.stringify({ eventName: name, at: i * 1000, owner, ...fields }),
      );
    add(1, "DepositRequested", { epoch: "14", assets: "10000000" });
    add(2, "DepositRequested", { epoch: "14", assets: "5000000" });
    add(3, "RedeemRequested", { epoch: "19", shares: "3000000" });
    const batches = readBatchRequests(store);
    assert.equal(batches.length, 2);
    assert.equal(batches[0].deposits, "15000000");
    assert.equal(batches[0].requests, 2);
    assert.equal(batches[1].redeems, "3000000");
    assert.ok(!JSON.stringify(batches).includes(owner));
  } finally {
    store.close();
  }
});
test("a backend mismatch is not an allocation failure", async () => {
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
