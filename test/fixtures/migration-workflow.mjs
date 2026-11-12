import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { crosschain } from "../../lib/crosschain-config.mjs";
import { requestEvents } from "../../lib/crosschain-reads.mjs";
// Public Base runtime code fetched on 2026-11-12. All three keccak hashes match
// crosschain-config.mjs. Compression keeps the offline fixture compact; tests
// exercise the real production bytecode verification without replacing hashes.
const pinnedCodeGzip =
  "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";
const pinnedCode = JSON.parse(
  gunzipSync(Buffer.from(pinnedCodeGzip, "base64")),
);
const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function fixture() {
  const state = {
    cash: 2000000n,
    allowance: 0n,
    shares: 0n,
    eth: 1000000n,
    minDeposit: 1000000n,
    current: 2n,
    request: null,
    frozen: false,
    quarantined: false,
    age: 20n,
    paused: false,
    approvalAccepted: true,
    walletOwner: owner,
    walletChain: 8453,
    simulationFailure: null,
    writes: [],
    reads: [],
    receipts: new Map(),
  };
  const client = {
    getChainId: async () => 8453,
    getBlockNumber: async () => 100n,
    getTransactionCount: async ({ address, blockTag }) => {
      assert.equal(address, owner);
      assert.equal(blockTag, "pending");
      return state.writes.length + 1;
    },
    getStorageAt: async () =>
      "0x" + "0".repeat(24) + crosschain.implementation.slice(2),
    getBytecode: async ({ address }) => {
      if (same(address, crosschain.vault)) return pinnedCode.vault;
      if (same(address, crosschain.implementation))
        return pinnedCode.implementation;
      if (same(address, crosschain.logic)) return pinnedCode.logic;
      throw new Error("Unexpected bytecode target");
    },
    getBalance: async () => state.eth,
    getBlock: async () => ({ timestamp: 1000n }),
    readContract: async ({ address, functionName, args }) => {
      state.reads.push({ address, functionName, args });
      switch (functionName) {
        case "asset":
          return crosschain.asset;
        case "accountant":
          return crosschain.accountant;
        case "decimals":
          return 6;
        case "balanceOf":
          return same(address, crosschain.asset) ? state.cash : state.shares;
        case "allowance":
          return state.allowance;
        case "paused":
          return state.paused;
        case "limits":
          return { minDeposit: state.minDeposit };
        case "currentEpoch":
          return state.current;
        case "epochConfig":
          return { minDuration: 60n, maxDuration: 120n };
        case "latestAccepted":
          return [
            1n,
            {
              committedAt: 1000n - state.age,
              rateBid: 10n ** 18n,
              rateOffer: 10n ** 18n,
            },
          ];
        case "frozen":
          return state.frozen;
        case "quarantined":
          return state.quarantined;
        case "config":
          return { maxTickAge: 100n };
        case "accounting":
          return [0n, 0n, 0n, 0n];
        case "totalSupply":
          return state.shares;
        case "symbol":
          return "xcUSDC";
        case "getEpoch":
          return {
            openedAt: 900n,
            depositsCleared: state.current > 2n,
            rateOffer: 10n ** 18n,
          };
        case "getRequest":
          return (
            state.request || {
              owner,
              receiver: owner,
              status: 0,
              kind: 0,
              epoch: 2n,
              amount: 0n,
            }
          );
        default:
          throw new Error("Unexpected read " + functionName);
      }
    },
    simulateContract: async (request) => {
      if (state.simulationFailure) throw state.simulationFailure;
      return {
        request,
        result:
          request.functionName === "approve" ? state.approvalAccepted : 17n,
      };
    },
    getTransaction: async ({ hash }) => state.receipts.get(hash).transaction,
    getTransactionReceipt: async ({ hash }) => state.receipts.get(hash).receipt,
    waitForTransactionReceipt: async ({ hash, confirmations }) => {
      assert.equal(confirmations, 1);
      return state.receipts.get(hash).receipt;
    },
  };
  const wallet = {
    getAddresses: async () => [state.walletOwner],
    getChainId: async () => state.walletChain,
    writeContract: async (request) => {
      state.writes.push(request);
      const hash = "0x" + state.writes.length.toString(16).padStart(64, "0");
      const transaction = {
        hash,
        from: owner,
        to: request.address,
        value: 0n,
        chainId: 8453,
        input: encodeFunctionData(request),
        nonce: state.writes.length,
        blockNumber: 100n,
        blockHash: "0x" + "ab".repeat(32),
      };
      const logs = [];
      if (request.functionName === "approve") state.allowance = request.args[1];
      if (request.functionName === "requestDeposit") {
        const amount = request.args[0];
        state.cash -= amount;
        state.allowance -= amount;
        state.request = {
          owner,
          receiver: owner,
          status: 1,
          kind: 0,
          epoch: 2n,
          amount,
        };
        logs.push(
          {
            address: crosschain.vault,
            transactionHash: hash,
            topics: encodeEventTopics({
              abi: requestEvents,
              eventName: "DepositRequested",
              args: { requestId: 17n, epoch: 2n, owner },
            }),
            data: encodeAbiParameters(
              [{ type: "address" }, { type: "uint256" }],
              [owner, amount],
            ),
          },
          {
            address: crosschain.asset,
            transactionHash: hash,
            topics: encodeEventTopics({
              abi: transferAbi,
              eventName: "Transfer",
              args: { from: owner, to: crosschain.vault },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [amount]),
          },
        );
      }
      if (request.functionName === "claim") {
        state.shares += state.request.amount;
        state.request.status = 3;
      }
      const receipt = {
        transactionHash: hash,
        from: owner,
        to: request.address,
        status: "success",
        blockNumber: 100n,
        blockHash: transaction.blockHash,
        logs,
      };
      state.receipts.set(hash, { transaction, receipt });
      return hash;
    },
  };
  return { state, client, wallet };
}

export { fixture as workflowFixture, owner as workflowOwner };
