import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { tokenAbi } from "../lib/vault-contracts.mjs";
import { epochAbi } from "../lib/crosschain-transactions.mjs";
import { requestEvents } from "../lib/crosschain-reads.mjs";
import { confirmMigrationOperation } from "../lib/migration-receipts.mjs";

// An explicit synthetic destination ensures the tests do not introduce or
// implicitly approve any legacy-to-new product binding.
const destination = {
  chainId: 8453,
  address: "0x3333333333333333333333333333333333333333",
  asset: "0x4444444444444444444444444444444444444444",
};
const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32);
const otherHash = "0x" + "cd".repeat(32);
const blockHash = "0x" + "ef".repeat(32);
const amount = 1234567n;
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

function fixture(kind = "deposit") {
  const call =
    kind === "approve"
      ? {
          abi: tokenAbi,
          functionName: "approve",
          args: [destination.address, amount],
        }
      : kind === "claim"
        ? { abi: epochAbi, functionName: "claim", args: [17n] }
        : {
            abi: epochAbi,
            functionName: "requestDeposit",
            args: [amount, owner],
          };
  const address = kind === "approve" ? destination.asset : destination.address;
  const transaction = {
    hash,
    from: owner,
    to: address,
    value: 0n,
    chainId: 8453,
    nonce: 7,
    blockNumber: 100n,
    blockHash,
    input: encodeFunctionData(call),
  };
  const requested = {
    address: destination.address,
    transactionHash: hash,
    topics: encodeEventTopics({
      abi: requestEvents,
      eventName: "DepositRequested",
      args: { requestId: 17n, epoch: 5n, owner },
    }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [owner, amount],
    ),
  };
  const transfer = {
    address: destination.asset,
    transactionHash: hash,
    topics: encodeEventTopics({
      abi: transferAbi,
      eventName: "Transfer",
      args: { from: owner, to: destination.address },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
  const receipt = {
    transactionHash: hash,
    from: owner,
    to: address,
    status: "success",
    blockNumber: 100n,
    blockHash,
    logs: kind === "deposit" ? [requested, transfer] : [],
  };
  const client = {
    getChainId: async () => 8453,
    getTransaction: async () => transaction,
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 100n,
  };
  const intent = { kind, address, data: transaction.input, nonce: 7 };
  return { transaction, receipt, client, requested, transfer, intent };
}

test("requires exact DepositRequested and actual USDC funding on Base", async () => {
  const f = fixture();
  assert.deepEqual(
    await confirmMigrationOperation(
      f.client,
      destination,
      owner,
      hash,
      f.intent,
    ),
    {
      kind: "deposit",
      hash,
      requestId: "17",
      amount,
    },
  );
});

test("separately confirms exact approval spender and claim call", async () => {
  const approval = fixture("approve");
  assert.deepEqual(
    await confirmMigrationOperation(
      approval.client,
      destination,
      owner,
      hash,
      approval.intent,
    ),
    { kind: "approve", hash, amount },
  );
  const claim = fixture("claim");
  assert.deepEqual(
    await confirmMigrationOperation(
      claim.client,
      destination,
      owner,
      hash,
      claim.intent,
    ),
    { kind: "claim", hash, requestId: "17" },
  );
  approval.transaction.input = encodeFunctionData({
    abi: tokenAbi,
    functionName: "approve",
    args: [other, amount],
  });
  await assert.rejects(
    confirmMigrationOperation(approval.client, destination, owner, hash),
    /разрешения/,
  );
});

test("rejects incorrect RPC or transaction chain, owner, target, receipt and block", async () => {
  for (const change of [
    (f) => {
      f.client.getChainId = async () => 42161;
    },
    (f) => {
      f.transaction.chainId = 42161;
    },
    (f) => {
      f.transaction.from = other;
    },
    (f) => {
      f.receipt.from = other;
    },
    (f) => {
      f.transaction.to = other;
      f.receipt.to = other;
    },
    (f) => {
      f.receipt.to = other;
    },
    (f) => {
      f.transaction.hash = otherHash;
    },
    (f) => {
      f.receipt.transactionHash = otherHash;
    },
    (f) => {
      f.transaction.value = 1n;
    },
    (f) => {
      f.transaction.blockNumber = 99n;
    },
    (f) => {
      f.transaction.blockHash = otherHash;
    },
    (f) => {
      f.client.getBlockNumber = async () => 99n;
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(
      confirmMigrationOperation(f.client, destination, owner, hash),
    );
  }
  const f = fixture();
  await assert.rejects(
    confirmMigrationOperation(
      f.client,
      { ...destination, chainId: 42161 },
      owner,
      hash,
    ),
  );
});

test("rejects another deposit receiver and noncanonical or unrelated calls", async () => {
  for (const input of [
    encodeFunctionData({
      abi: epochAbi,
      functionName: "requestDeposit",
      args: [amount, other],
    }),
    encodeFunctionData({ abi: epochAbi, functionName: "cancel", args: [17n] }),
    fixture().transaction.input + "00",
  ]) {
    const f = fixture();
    f.transaction.input = input;
    await assert.rejects(
      confirmMigrationOperation(f.client, destination, owner, hash),
    );
  }
});

test("missing, wrong, removed or duplicated token/event logs cannot prove a deposit", async () => {
  for (const change of [
    (f) => {
      f.receipt.logs = [f.requested];
    },
    (f) => {
      f.receipt.logs = [f.transfer];
    },
    (f) => {
      f.transfer.address = other;
    },
    (f) => {
      f.requested.address = other;
    },
    (f) => {
      f.transfer.topics = encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from: other, to: destination.address },
      });
    },
    (f) => {
      f.transfer.topics = encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from: owner, to: other },
      });
    },
    (f) => {
      f.transfer.data = encodeAbiParameters(
        [{ type: "uint256" }],
        [amount - 1n],
      );
    },
    (f) => {
      f.requested.data = encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [owner, amount - 1n],
      );
    },
    (f) => {
      f.requested.data = encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [other, amount],
      );
    },
    (f) => {
      f.requested.topics = encodeEventTopics({
        abi: requestEvents,
        eventName: "DepositRequested",
        args: { requestId: 17n, epoch: 5n, owner: other },
      });
    },
    (f) => {
      f.receipt.logs.push(f.transfer);
    },
    (f) => {
      f.receipt.logs.push(f.requested);
    },
    (f) => {
      f.transfer.removed = true;
    },
    (f) => {
      f.requested.transactionHash = otherHash;
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(
      confirmMigrationOperation(f.client, destination, owner, hash),
      /USDC/,
    );
  }
});

test("reverted and unconfirmed receipts are distinct and RPC failure stays an error", async () => {
  const reverted = fixture();
  reverted.receipt.status = "reverted";
  assert.deepEqual(
    await confirmMigrationOperation(
      reverted.client,
      destination,
      owner,
      hash,
      reverted.intent,
    ),
    { reverted: true, hash },
  );
  const pending = fixture();
  pending.receipt.status = "pending";
  await assert.rejects(
    confirmMigrationOperation(pending.client, destination, owner, hash),
    /Подтверждение/,
  );
  const rpc = fixture();
  const failure = new Error("RPC offline");
  rpc.client.getTransactionReceipt = async () => {
    throw failure;
  };
  await assert.rejects(
    confirmMigrationOperation(rpc.client, destination, owner, hash),
    (error) => error === failure,
  );
});

test("same-nonce cancellation is recoverable but another nonce cannot clear pending", async () => {
  const cancelled = fixture();
  cancelled.transaction.to = owner;
  cancelled.receipt.to = owner;
  cancelled.transaction.input = "0x";
  assert.deepEqual(
    await confirmMigrationOperation(
      cancelled.client,
      destination,
      owner,
      hash,
      cancelled.intent,
    ),
    { cancelled: true, hash },
  );
  cancelled.receipt.status = "pending";
  await assert.rejects(
    confirmMigrationOperation(
      cancelled.client,
      destination,
      owner,
      hash,
      cancelled.intent,
    ),
    /Подтверждение/,
  );
  const otherNonce = fixture();
  otherNonce.transaction.nonce = 8;
  await assert.rejects(
    confirmMigrationOperation(
      otherNonce.client,
      destination,
      owner,
      hash,
      otherNonce.intent,
    ),
    /nonce/,
  );
  const unrelated = fixture();
  unrelated.transaction.nonce = 8;
  unrelated.transaction.to = owner;
  unrelated.receipt.to = owner;
  unrelated.transaction.input = "0x";
  await assert.rejects(
    confirmMigrationOperation(
      unrelated.client,
      destination,
      owner,
      hash,
      unrelated.intent,
    ),
    /nonce/,
  );
  const unverified = fixture();
  unverified.intent.nonce = null;
  unverified.transaction.to = owner;
  unverified.receipt.to = owner;
  unverified.transaction.input = "0x";
  await assert.rejects(
    confirmMigrationOperation(
      unverified.client,
      destination,
      owner,
      hash,
      unverified.intent,
    ),
    /операции/,
  );
});
