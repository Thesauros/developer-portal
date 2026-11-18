import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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

function relay(f) {
  f.transaction.from = other;
  f.transaction.to = "0x5555555555555555555555555555555555555555";
  f.transaction.input = "0xcef6d209";
  f.transaction.nonce = 303672;
  f.receipt.from = f.transaction.from;
  f.receipt.to = f.transaction.to;
  return f;
}

function pending(f) {
  return {
    kind: "withdraw",
    chainId: f.vault.chainId,
    address: f.vault.address,
    data: f.transaction.input,
    nonce: f.transaction.nonce ?? 7,
    hash,
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

test("recovers the actual Base relay withdrawal using its vault and native USDC events", async () => {
  const captured = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/legacy-relayed-base-withdrawal.json",
        import.meta.url,
      ),
    ),
  );
  const transaction = {
    ...captured.transaction,
    value: BigInt(captured.transaction.value),
    blockNumber: BigInt(captured.transaction.blockNumber),
  };
  const receipt = {
    ...captured.receipt,
    blockNumber: BigInt(captured.receipt.blockNumber),
    logs: captured.receipt.logs.map((log) => ({
      ...log,
      blockNumber: BigInt(log.blockNumber),
    })),
  };
  const client = {
    getChainId: async () => captured.chainId,
    getTransaction: async () => transaction,
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => BigInt(captured.head),
  };
  const intent = {
    kind: "withdraw",
    chainId: 8453,
    address: getVault("base").address,
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName: "redeem",
      args: [9885n, captured.owner, captured.owner],
    }),
    nonce: 7,
    hash: transaction.hash,
  };
  const expected = {
    hash: transaction.hash,
    amount: 10013n,
    shares: 9885n,
    blockNumber: receipt.blockNumber,
  };
  assert.deepEqual(
    await confirmMigrationWithdrawal(
      client,
      "base",
      captured.owner,
      transaction.hash,
      intent,
    ),
    expected,
  );
  // Subsequent page loads/imports retain only the hash, not the inner call or
  // a fabricated owner nonce. The same financial proof must still work.
  assert.deepEqual(
    await confirmMigrationWithdrawal(
      client,
      "base",
      captured.owner,
      transaction.hash,
    ),
    expected,
  );
});

test("relayed withdraw and redeem verify the saved exact assets or shares, not relayer nonce", async () => {
  for (const method of ["withdraw", "redeem"]) {
    const f = fixture("base", method);
    const intent = pending(f);
    relay(f);
    assert.deepEqual(
      await confirmMigrationWithdrawal(f.client, "base", owner, hash, intent),
      {
        hash,
        amount: f.amount,
        shares: f.shares,
        blockNumber: 100n,
      },
    );
    const wrong = {
      ...intent,
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: method,
        args: [
          method === "withdraw" ? f.amount + 1n : f.shares + 1n,
          owner,
          owner,
        ],
      }),
    };
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash, wrong),
      { code: "WITHDRAWAL_PROCEEDS_UNVERIFIED" },
    );
  }
});

test("a relay can settle a pending intent only through its known wallet-returned hash", async () => {
  const f = fixture("base");
  const intent = pending(f);
  relay(f);
  for (const changed of [
    { ...intent, hash: undefined },
    { ...intent, hash: "0x" + "ef".repeat(32) },
  ]) {
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash, changed),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
  assert.equal(
    (await confirmMigrationWithdrawal(f.client, "base", owner, hash)).amount,
    f.amount,
  );
});

test("relay recovery rejects noncanonical intent, wrong vault, receiver, owner or network", async () => {
  const f = fixture("base");
  const intent = pending(f);
  relay(f);
  for (const change of [
    { address: other },
    { kind: "deposit" },
    { chainId: 42161 },
    { nonce: -1 },
    { data: intent.data + "00" },
    {
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "deposit",
        args: [f.amount, owner],
      }),
    },
    {
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "redeem",
        args: [f.shares, other, owner],
      }),
    },
    {
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "redeem",
        args: [f.shares, owner, other],
      }),
    },
  ]) {
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash, {
        ...intent,
        ...change,
      }),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
});

test("direct pending intent keeps canonical calldata, target and owner nonce checks", async () => {
  const f = fixture("base");
  f.transaction.nonce = 7;
  const intent = pending(f);
  assert.equal(
    (await confirmMigrationWithdrawal(f.client, "base", owner, hash, intent))
      .amount,
    f.amount,
  );
  for (const changed of [
    { ...intent, nonce: 8 },
    { ...intent, address: other },
    {
      ...intent,
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "withdraw",
        args: [f.amount, owner, owner],
      }),
    },
  ]) {
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash, changed),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
  // Even authentic logs cannot turn a different direct outer call into the
  // canonical withdrawal this owner was asked to sign.
  f.transaction.input = "0xcef6d209";
  await assert.rejects(
    confirmMigrationWithdrawal(f.client, "base", owner, hash),
    { code: "WITHDRAWAL_MISMATCH" },
  );
});

test("owner-to-self and owner-to-manager batches use proof events and known hash instead of outer nonce", async () => {
  for (const target of [owner, other]) {
    const f = fixture("base");
    const intent = pending(f);
    relay(f);
    f.transaction.from = owner;
    f.receipt.from = owner;
    f.transaction.to = target;
    f.receipt.to = target;
    assert.deepEqual(
      await confirmMigrationWithdrawal(f.client, "base", owner, hash, intent),
      { hash, amount: f.amount, shares: f.shares, blockNumber: 100n },
    );
    assert.equal(
      (await confirmMigrationWithdrawal(f.client, "base", owner, hash)).amount,
      f.amount,
    );
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash, {
        ...intent,
        hash: "0x" + "ef".repeat(32),
      }),
      { code: "WITHDRAWAL_MISMATCH" },
    );
  }
});

test("relay logs require unique matching sender, owner, receiver and exact native USDC proceeds", async () => {
  for (const mutation of [
    (f) => {
      f.receipt.logs = [f.withdrawLog];
    },
    (f) => {
      f.receipt.logs = [f.transferLog];
    },
    (f) => {
      f.withdrawLog.address = other;
    },
    (f) => {
      f.transferLog.address = other;
    },
    (f) => {
      f.withdrawLog.removed = true;
    },
    (f) => {
      f.transferLog.removed = true;
    },
    (f) => {
      f.withdrawLog.transactionHash = "0x" + "ef".repeat(32);
    },
    (f) => {
      f.transferLog.transactionHash = "0x" + "ef".repeat(32);
    },
    (f) => {
      f.withdrawLog.blockNumber = 99n;
    },
    (f) => {
      f.transferLog.blockHash = "0x" + "ef".repeat(32);
    },
    (f) => {
      f.receipt.logs.push({ ...f.withdrawLog });
    },
    (f) => {
      f.receipt.logs.push({ ...f.transferLog });
    },
    (f) => {
      f.transferLog.data = encodeAbiParameters(
        [{ type: "uint256" }],
        [f.amount - 1n],
      );
    },
    (f) => {
      f.withdrawLog.data = encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        [f.amount, 0n],
      );
    },
    ...["sender", "receiver", "owner"].map((field) => (f) => {
      f.withdrawLog.topics = encodeEventTopics({
        abi: vaultAbi,
        eventName: "Withdraw",
        args: { sender: owner, receiver: owner, owner, [field]: other },
      });
    }),
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
  ]) {
    const f = relay(fixture("base"));
    mutation(f);
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash),
      { code: "WITHDRAWAL_PROCEEDS_UNVERIFIED" },
    );
  }
});

test("relay envelope and confirmation cannot be replaced by valid-looking event logs", async () => {
  for (const mutation of [
    (f) => {
      f.client.getChainId = async () => 42161;
    },
    (f) => {
      f.transaction.chainId = 42161;
    },
    (f) => {
      f.transaction.value = 1n;
    },
    (f) => {
      f.receipt.from = owner;
    },
    (f) => {
      f.receipt.to = owner;
    },
    (f) => {
      f.transaction.hash = "0x" + "ef".repeat(32);
    },
    (f) => {
      f.receipt.transactionHash = "0x" + "ef".repeat(32);
    },
    (f) => {
      f.transaction.blockNumber = 99n;
    },
    (f) => {
      f.receipt.blockHash = "0x" + "ef".repeat(32);
    },
    (f) => {
      f.client.getBlockNumber = async () => 99n;
    },
  ]) {
    const f = relay(fixture("base"));
    mutation(f);
    await assert.rejects(
      confirmMigrationWithdrawal(f.client, "base", owner, hash),
    );
  }
});

test("reverted relay receipts must be confirmed before classifying a pending withdrawal as reverted", async () => {
  const f = fixture("base");
  const intent = pending(f);
  relay(f);
  f.receipt.status = "reverted";
  f.client.getBlockNumber = async () => 99n;
  await assert.rejects(
    confirmMigrationWithdrawal(f.client, "base", owner, hash, intent),
    { code: "WITHDRAWAL_PENDING", status: "pending" },
  );
  f.client.getBlockNumber = async () => 100n;
  await assert.rejects(
    confirmMigrationWithdrawal(f.client, "base", owner, hash, intent),
    { code: "WITHDRAWAL_REVERTED", status: "reverted" },
  );
});
