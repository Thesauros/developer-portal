import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { getVault, vaultAbi } from "../lib/vault-contracts.mjs";
import {
  confirmMigrationWithdrawal,
  readMigrationLegacy,
} from "../lib/migration-legacy.mjs";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32);
const blockHash = "0x" + "cd".repeat(32);
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

function fixture(vaultId = "arbitrum", method = "redeem") {
  const vault = getVault(vaultId);
  const amount = 1234567n,
    shares = 1200000n;
  const withdrawLog = {
    address: vault.address,
    transactionHash: hash,
    topics: encodeEventTopics({
      abi: vaultAbi,
      eventName: "Withdraw",
      args: { sender: owner, receiver: owner, owner },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [amount, shares],
    ),
  };
  const transferLog = {
    address: vault.asset,
    transactionHash: hash,
    topics: encodeEventTopics({
      abi: transferAbi,
      eventName: "Transfer",
      args: { from: vault.address, to: owner },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
  const transaction = {
    hash,
    from: owner,
    to: vault.address,
    chainId: vault.chainId,
    value: 0n,
    input: encodeFunctionData({
      abi: vaultAbi,
      functionName: method,
      args: [method === "redeem" ? shares : amount, owner, owner],
    }),
    blockNumber: 100n,
    blockHash,
  };
  const receipt = {
    transactionHash: hash,
    from: owner,
    to: vault.address,
    status: "success",
    blockNumber: 100n,
    blockHash,
    logs: [withdrawLog, transferLog],
  };
  const client = {
    getChainId: async () => vault.chainId,
    getTransaction: async () => transaction,
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 100n,
  };
  return {
    vault,
    amount,
    shares,
    transaction,
    receipt,
    client,
    withdrawLog,
    transferLog,
  };
}

for (const vaultId of ["arbitrum", "base"]) {
  for (const method of ["redeem", "withdraw"]) {
    test(`verifies actual ${method} USDC proceeds on ${vaultId}`, async () => {
      const f = fixture(vaultId, method);
      assert.deepEqual(
        await confirmMigrationWithdrawal(f.client, vaultId, owner, hash),
        {
          hash,
          amount: f.amount,
          shares: f.shares,
          blockNumber: 100n,
        },
      );
    });
  }
}

test("RPC failure reading a legacy position never becomes zero", async () => {
  const failure = new Error("RPC offline");
  await assert.rejects(
    readMigrationLegacy(
      {
        getBlockNumber: async () => {
          throw failure;
        },
      },
      "base",
      owner,
    ),
    (error) => error === failure,
  );
});

test("rejects wrong RPC chain and transaction receiver/owner/target", async () => {
  const wrongChain = fixture();
  wrongChain.client.getChainId = async () => 8453;
  await assert.rejects(
    confirmMigrationWithdrawal(wrongChain.client, "arbitrum", owner, hash),
    { code: "CHAIN_MISMATCH" },
  );
  for (const field of ["from", "to"]) {
    const f = fixture();
    f.transaction[field] = other;
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "arbitrum", owner, hash),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
  for (const index of [1, 2]) {
    const f = fixture();
    const args = [f.shares, owner, owner];
    args[index] = other;
    f.transaction.input = encodeFunctionData({
      abi: vaultAbi,
      functionName: "redeem",
      args,
    });
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "arbitrum", owner, hash),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
});

test("rejects deposit calls and noncanonical calldata", async () => {
  const f = fixture();
  f.transaction.input = encodeFunctionData({
    abi: vaultAbi,
    functionName: "deposit",
    args: [f.amount, owner],
  });
  await assert.rejects(
    confirmMigrationWithdrawal(f.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_MISMATCH" },
  );
  const malformed = fixture();
  malformed.transaction.input += "00";
  await assert.rejects(
    confirmMigrationWithdrawal(malformed.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_MISMATCH" },
  );
});

test("requires matching receipt identity and block", async () => {
  for (const field of ["from", "to", "transactionHash"]) {
    const f = fixture();
    f.receipt[field] =
      field === "transactionHash" ? "0x" + "ef".repeat(32) : other;
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "arbitrum", owner, hash),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
  const f = fixture();
  f.transaction.blockNumber = 99n;
  await assert.rejects(
    confirmMigrationWithdrawal(f.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_MISMATCH" },
  );
});

test("requires Withdraw and exact native USDC transfer from proxy to owner", async () => {
  for (const mutation of [
    (f) => {
      f.receipt.logs = [f.withdrawLog];
    },
    (f) => {
      f.receipt.logs = [f.transferLog];
    },
    (f) => {
      f.transferLog.address = other;
    },
    (f) => {
      f.withdrawLog.address = other;
    },
    (f) => {
      f.transferLog.topics = encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from: other, to: owner },
      });
    },
    (f) => {
      f.transferLog.topics = encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from: f.vault.address, to: other },
      });
    },
    (f) => {
      f.transferLog.data = encodeAbiParameters(
        [{ type: "uint256" }],
        [f.amount - 1n],
      );
    },
    (f) => {
      f.receipt.logs.push(f.withdrawLog);
    },
    (f) => {
      f.transferLog.removed = true;
    },
    (f) => {
      f.transaction.input = encodeFunctionData({
        abi: vaultAbi,
        functionName: "redeem",
        args: [f.shares - 1n, owner, owner],
      });
    },
  ]) {
    const f = fixture();
    mutation(f);
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "arbitrum", owner, hash),
      { code: "WITHDRAWAL_PROCEEDS_UNVERIFIED" },
    );
  }
});

test("distinguishes reverted, pending and RPC-unavailable confirmations", async () => {
  const reverted = fixture();
  reverted.receipt.status = "reverted";
  await assert.rejects(
    confirmMigrationWithdrawal(reverted.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_REVERTED", status: "reverted" },
  );
  const pending = fixture();
  pending.client.getTransactionReceipt = async () => {
    throw Object.assign(new Error(), {
      name: "TransactionReceiptNotFoundError",
    });
  };
  await assert.rejects(
    confirmMigrationWithdrawal(pending.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_PENDING", status: "pending" },
  );
  const rpc = fixture();
  rpc.client.getTransactionReceipt = async () => {
    throw new Error("offline");
  };
  await assert.rejects(
    confirmMigrationWithdrawal(rpc.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_RPC_UNAVAILABLE", status: "pending" },
  );
  const head = fixture();
  head.client.getBlockNumber = async () => 99n;
  await assert.rejects(
    confirmMigrationWithdrawal(head.client, "arbitrum", owner, hash),
    { code: "WITHDRAWAL_PENDING", status: "pending" },
  );
});
