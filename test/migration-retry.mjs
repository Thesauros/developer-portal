import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { encodeFunctionData } from "viem";
import { retryMigrationIntent } from "../lib/migration-retry.mjs";
import { crosschain } from "../lib/crosschain-config.mjs";
import { epochAbi } from "../lib/crosschain-transactions.mjs";
import { getVault, tokenAbi, vaultAbi } from "../lib/vault-contracts.mjs";
import {
  workflowFixture,
  workflowOwner as owner,
} from "./fixtures/migration-workflow.mjs";

// Verified legacy implementation runtime from the committed deployment artifact;
// its real keccak is checked by readMigrationLegacy in every successful test.
const legacyGzip =
  "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";
const legacyCode =
  "0x" + gunzipSync(Buffer.from(legacyGzip, "base64")).toString("hex");
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32);

function newOperation(kind = "deposit") {
  const f = workflowFixture();
  const readCode = f.client.getBytecode;
  f.client.getBytecode = async (args) =>
    args.address.toLowerCase() === owner.toLowerCase() ? "0x" : readCode(args);
  f.state.allowance = 2000000n;
  f.state.shares = 2000000n;
  f.state.request = {
    owner,
    receiver: owner,
    status: 1,
    epoch: 2n,
    kind: 0,
    amount: 2000000n,
  };
  f.client.getTransactionCount = async ({ blockTag }) => {
    assert.equal(blockTag, "latest");
    return 0;
  };
  const functions = {
    approve: "approve",
    deposit: "requestDeposit",
    redeem: "requestRedeem",
    claim: "claim",
    cancel: "cancel",
  };
  const args =
    kind === "approve"
      ? [crosschain.vault, 2000000n]
      : kind === "deposit"
        ? [2000000n, owner]
        : kind === "redeem"
          ? [2000000n, owner, owner]
          : [17n];
  const abi = kind === "approve" ? tokenAbi : epochAbi;
  const pending = {
    kind,
    chainId: 8453,
    nonce: 7,
    address: kind === "approve" ? crosschain.asset : crosschain.vault,
    data: encodeFunctionData({ abi, functionName: functions[kind], args }),
  };
  return { ...f, pending };
}

function oldOperation(vaultId = "base", functionName = "redeem") {
  const vault = getVault(vaultId);
  const writes = [];
  const state = { nonce: 0, paused: false, owner, chainId: vault.chainId };
  const pending = {
    kind: "withdraw",
    chainId: vault.chainId,
    address: vault.address,
    nonce: 7,
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName,
      args: [2000000n, owner, owner],
    }),
  };
  const client = {
    getChainId: async () => vault.chainId,
    getTransactionCount: async ({ blockTag }) => {
      assert.equal(blockTag, "latest");
      return state.nonce;
    },
    getBlockNumber: async () => 100n,
    getStorageAt: async () => "0x" + "0".repeat(24) + other.slice(2),
    getBytecode: async ({ address }) =>
      address.toLowerCase() === owner.toLowerCase() ? "0x" : legacyCode,
    readContract: async ({ address, functionName, args }) => {
      switch (functionName) {
        case "asset":
          return vault.asset;
        case "decimals":
          return 6;
        case "balanceOf":
          return address.toLowerCase() === vault.address.toLowerCase()
            ? 2000000n
            : 0n;
        case "allowance":
        case "getManagementFee":
        case "getPerformanceFee":
          return 0n;
        case "totalAssets":
          return 2000000n;
        case "getMinAssets":
          return 1000000n;
        case "paused":
          return state.paused;
        case "previewRedeem":
          return args[0];
        default:
          throw new Error("Unexpected legacy read " + functionName);
      }
    },
    simulateContract: async (request) => ({ request }),
  };
  const wallet = {
    getAddresses: async () => [state.owner],
    getChainId: async () => state.chainId,
    writeContract: async (request) => {
      writes.push(request);
      return hash;
    },
  };
  return { client, wallet, pending, writes, state };
}

for (const kind of ["approve", "deposit", "redeem", "claim", "cancel"]) {
  test(`retries saved ${kind} on Base with identical calldata and reserved nonce`, async () => {
    const f = newOperation(kind);
    const original = JSON.stringify(f.pending);
    let persisted = null,
      checked = 0;
    const result = await retryMigrationIntent({
      publicClient: f.client,
      walletClient: f.wallet,
      owner,
      pending: f.pending,
      beforeRetry: async (action) => {
        checked++;
        assert.equal(action, kind);
      },
      onHash: (value) => {
        persisted = value;
      },
    });
    assert.equal(persisted, result.hash);
    assert.equal(f.state.writes.length, 1);
    const request = f.state.writes[0];
    assert.equal(request.nonce, 7);
    assert.equal(request.chain.id, 8453);
    assert.equal(request.chainId, 8453);
    assert.equal(request.value, 0n);
    assert.equal(request.address, f.pending.address);
    assert.equal(encodeFunctionData(request), f.pending.data);
    assert.equal(
      JSON.stringify(f.pending),
      original,
      "retry must not clear original recovery intent",
    );
    assert.equal(checked, ["claim", "cancel"].includes(kind) ? 0 : 1);
  });
}

for (const vaultId of ["base", "arbitrum"]) {
  for (const method of ["withdraw", "redeem"]) {
    test(`legacy ${vaultId} ${method} rechecks deployed code and exact saved arguments`, async () => {
      const f = oldOperation(vaultId, method);
      const result = await retryMigrationIntent({
        publicClient: f.client,
        walletClient: f.wallet,
        owner,
        vaultId,
        pending: f.pending,
        beforeRetry: () =>
          assert.fail("legacy exit must not depend on new backend"),
        onHash: (value) => assert.equal(value, hash),
      });
      assert.equal(result.hash, hash);
      assert.equal(f.writes[0].nonce, 7);
      assert.equal(f.writes[0].chain.id, getVault(vaultId).chainId);
      assert.equal(encodeFunctionData(f.writes[0]), f.pending.data);
    });
  }
}

test("consumed nonce before or during preflight never sends another operation", async () => {
  for (const consumedAt of [1, 2]) {
    const f = newOperation();
    let checks = 0;
    f.client.getTransactionCount = async () => (++checks >= consumedAt ? 8 : 0);
    await assert.rejects(
      retryMigrationIntent({
        publicClient: f.client,
        walletClient: f.wallet,
        owner,
        pending: f.pending,
      }),
      { code: "NONCE_CONSUMED" },
    );
    assert.equal(f.state.writes.length, 0);
  }
});

test("repeated ambiguous retries retain the original nonce rather than allocating another", async () => {
  const f = newOperation("approve");
  const args = {
    publicClient: f.client,
    walletClient: f.wallet,
    owner,
    pending: f.pending,
  };
  await retryMigrationIntent(args);
  await retryMigrationIntent(args);
  assert.deepEqual(
    f.state.writes.map((request) => request.nonce),
    [7, 7],
  );
  assert.ok(
    f.state.writes.every(
      (request) => encodeFunctionData(request) === f.pending.data,
    ),
  );
});

test("invalid nonce, target, spender, receiver or calldata is rejected before signature", async () => {
  for (const mutate of [
    (p) => {
      p.nonce = null;
    },
    (p) => {
      p.nonce = -1;
    },
    (p) => {
      p.chainId = 42161;
    },
    (p) => {
      p.address = other;
    },
    (p) => {
      p.data += "00";
    },
    (p) => {
      p.data = encodeFunctionData({
        abi: epochAbi,
        functionName: "requestDeposit",
        args: [2000000n, other],
      });
    },
  ]) {
    const f = newOperation();
    mutate(f.pending);
    await assert.rejects(
      retryMigrationIntent({
        publicClient: f.client,
        walletClient: f.wallet,
        owner,
        pending: f.pending,
      }),
    );
    assert.equal(f.state.writes.length, 0);
  }
  const approval = newOperation("approve");
  approval.pending.data = encodeFunctionData({
    abi: tokenAbi,
    functionName: "approve",
    args: [other, 2000000n],
  });
  await assert.rejects(
    retryMigrationIntent({
      publicClient: approval.client,
      walletClient: approval.wallet,
      owner,
      pending: approval.pending,
    }),
    { code: "INVALID_INTENT" },
  );
  const legacy = oldOperation();
  legacy.pending.data = encodeFunctionData({
    abi: vaultAbi,
    functionName: "redeem",
    args: [2000000n, other, owner],
  });
  await assert.rejects(
    retryMigrationIntent({
      publicClient: legacy.client,
      walletClient: legacy.wallet,
      owner,
      vaultId: "base",
      pending: legacy.pending,
    }),
    { code: "INVALID_INTENT" },
  );
});

test("rejection, RPC failure and signing-time wallet changes preserve original pending", async () => {
  const rejected = newOperation();
  const before = JSON.stringify(rejected.pending);
  rejected.wallet.writeContract = async () => {
    throw Object.assign(new Error("User rejected"), { code: 4001 });
  };
  await assert.rejects(
    retryMigrationIntent({
      publicClient: rejected.client,
      walletClient: rejected.wallet,
      owner,
      pending: rejected.pending,
    }),
    { code: 4001 },
  );
  assert.equal(JSON.stringify(rejected.pending), before);
  const offline = newOperation();
  offline.client.getTransactionCount = async () => {
    throw new Error("RPC offline");
  };
  await assert.rejects(
    retryMigrationIntent({
      publicClient: offline.client,
      walletClient: offline.wallet,
      owner,
      pending: offline.pending,
    }),
    /RPC offline/,
  );
  assert.equal(offline.state.writes.length, 0);
  for (const field of ["walletOwner", "walletChain"]) {
    const changed = newOperation();
    await assert.rejects(
      retryMigrationIntent({
        publicClient: changed.client,
        walletClient: changed.wallet,
        owner,
        pending: changed.pending,
        beforeRetry: () => {
          changed.state[field] = field === "walletOwner" ? other : 42161;
        },
      }),
      { code: "WALLET_CHANGED" },
    );
    assert.equal(changed.state.writes.length, 0);
  }
});

test("failed readiness check or paused legacy exit cannot reach a wallet", async () => {
  const f = newOperation();
  await assert.rejects(
    retryMigrationIntent({
      publicClient: f.client,
      walletClient: f.wallet,
      owner,
      pending: f.pending,
      beforeRetry: () => {
        throw new Error("backend unavailable");
      },
    }),
    /backend unavailable/,
  );
  assert.equal(f.state.writes.length, 0);
  const legacy = oldOperation();
  legacy.state.paused = true;
  await assert.rejects(
    retryMigrationIntent({
      publicClient: legacy.client,
      walletClient: legacy.wallet,
      owner,
      vaultId: "base",
      pending: legacy.pending,
    }),
    { code: "WITHDRAWAL_UNAVAILABLE" },
  );
  assert.equal(legacy.writes.length, 0);
});

test("hash persistence failure preserves the sent hash for recovery", async () => {
  const f = newOperation();
  await assert.rejects(
    retryMigrationIntent({
      publicClient: f.client,
      walletClient: f.wallet,
      owner,
      pending: f.pending,
      onHash: () => {
        throw new Error("storage full");
      },
    }),
    (error) =>
      error.code === "HASH_NOT_SAVED" && /^0x[\da-f]{64}$/.test(error.hash),
  );
  assert.equal(f.state.writes.length, 1);
});

const blockHash = "0x" + "cd".repeat(32);
const notFound = (receipt = false) =>
  Object.assign(new Error("Not found"), {
    name: receipt
      ? "TransactionReceiptNotFoundError"
      : "TransactionNotFoundError",
  });
function knownOperation(f, transaction = {}, receipt = null) {
  f.pending.hash = hash;
  f.client.getTransaction = async ({ hash: requested }) => {
    assert.equal(requested, hash);
    return {
      hash,
      from: owner,
      to: f.pending.address,
      input: f.pending.data,
      nonce: f.pending.nonce,
      chainId: f.pending.chainId,
      value: 0n,
      blockNumber: null,
      blockHash: null,
      ...transaction,
    };
  };
  f.client.getTransactionReceipt = async ({ hash: requested }) => {
    assert.equal(requested, hash);
    if (receipt) return receipt;
    throw notFound(true);
  };
  return f;
}
async function blockedBeforeWallet(f, code, vaultId) {
  let walletReads = 0,
    readiness = 0,
    simulations = 0;
  const original = JSON.stringify(f.pending);
  f.wallet.getAddresses = f.wallet.getChainId = async () => {
    walletReads++;
    assert.fail(
      "Original transaction must be checked before opening the wallet",
    );
  };
  f.client.simulateContract = async () => {
    simulations++;
    assert.fail("No simulation before reconciliation");
  };
  await assert.rejects(
    retryMigrationIntent({
      publicClient: f.client,
      walletClient: f.wallet,
      owner,
      vaultId,
      pending: f.pending,
      beforeRetry: () => {
        readiness++;
      },
    }),
    (error) => error.code === code && error.userFacing === true,
  );
  assert.equal(walletReads, 0);
  assert.equal(readiness, 0);
  assert.equal(simulations, 0);
  assert.equal((f.writes || f.state.writes).length, 0);
  assert.equal(JSON.stringify(f.pending), original);
}

test("confirmed direct and relayed transactions stop before any wallet access", async () => {
  for (const from of [owner, other]) {
    for (const status of ["success", "reverted"]) {
      const f = knownOperation(
        newOperation(),
        {
          from,
          nonce: from === owner ? 7 : 303672,
          blockNumber: 100n,
          blockHash,
        },
        { transactionHash: hash, status, blockNumber: 100n, blockHash },
      );
      await blockedBeforeWallet(f, "TRANSACTION_CONFIRMED");
    }
  }
  for (const vaultId of ["base", "arbitrum"]) {
    const f = knownOperation(
      oldOperation(vaultId),
      {
        from: other,
        to: owner,
        input: "0x1234",
        nonce: 303672,
        blockNumber: 100n,
        blockHash,
      },
      {
        transactionHash: hash,
        status: "success",
        blockNumber: 100n,
        blockHash,
      },
    );
    await blockedBeforeWallet(f, "TRANSACTION_CONFIRMED", vaultId);
  }
});

test("a pending outer sender, target or calldata mismatch is never retried", async () => {
  for (const patch of [
    { from: other, nonce: 303672 },
    { to: owner },
    { input: "0x1234" },
  ]) {
    const f = knownOperation(newOperation(), patch);
    await blockedBeforeWallet(f, "RELAY_PENDING");
  }
});

test("RPC errors and missing original transactions fail closed instead of implying a direct send", async () => {
  for (const scenario of [
    "chain",
    "transaction",
    "receipt",
    "both missing",
    "wrapped RPC",
    "synchronous RPC",
  ]) {
    const f = knownOperation(newOperation());
    const offline = () => {
      throw new Error("RPC unavailable");
    };
    if (scenario === "chain") f.client.getChainId = offline;
    if (scenario === "transaction")
      f.client.getTransaction = async () => offline();
    if (scenario === "receipt")
      f.client.getTransactionReceipt = async () => offline();
    if (scenario === "both missing")
      f.client.getTransaction = async () => {
        throw notFound();
      };
    if (scenario === "wrapped RPC")
      f.client.getTransaction = async () => {
        throw Object.assign(new Error("Read failed"), {
          cause: new Error("RPC rate limited"),
        });
      };
    if (scenario === "synchronous RPC") f.client.getTransaction = offline;
    await blockedBeforeWallet(f, "TRANSACTION_STATUS_UNAVAILABLE");
  }
});

test("original hash, chain, nonce and block evidence are bound without nonce adoption", async () => {
  for (const patch of [
    { hash: "0x" + "11".repeat(32) },
    { chainId: 42161 },
    { nonce: 303672 },
    { value: 1n },
    { blockNumber: 100n, blockHash },
  ]) {
    await blockedBeforeWallet(
      knownOperation(newOperation(), patch),
      "TRANSACTION_STATUS_UNAVAILABLE",
    );
  }
  for (const patch of [
    { transactionHash: "0x" + "11".repeat(32) },
    { chainId: 42161 },
    { blockNumber: 101n },
    { blockHash: "0x" + "11".repeat(32) },
    { status: "pending" },
    { blockHash: undefined },
  ]) {
    await blockedBeforeWallet(
      knownOperation(
        newOperation(),
        { blockNumber: 100n, blockHash },
        {
          transactionHash: hash,
          status: "success",
          blockNumber: 100n,
          blockHash,
          ...patch,
        },
      ),
      "TRANSACTION_STATUS_UNAVAILABLE",
    );
  }
  const wrongNetwork = knownOperation(newOperation());
  wrongNetwork.client.getChainId = async () => 42161;
  await blockedBeforeWallet(wrongNetwork, "CHAIN_MISMATCH");
});

test("positively verified direct pending transactions retain their exact saved nonce", async () => {
  const f = knownOperation(newOperation());
  await retryMigrationIntent({
    publicClient: f.client,
    walletClient: f.wallet,
    owner,
    pending: f.pending,
  });
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].nonce, 7);
  assert.equal(encodeFunctionData(f.state.writes[0]), f.pending.data);
});

test("confirmation or a relay appearing during preflight stops the final send", async () => {
  for (const outcome of ["confirmed", "relay", "RPC error"]) {
    const f = knownOperation(newOperation());
    let walletChecks = 0;
    const readWallet = f.wallet.getAddresses;
    f.wallet.getAddresses = async () => {
      walletChecks++;
      return readWallet();
    };
    await assert.rejects(
      retryMigrationIntent({
        publicClient: f.client,
        walletClient: f.wallet,
        owner,
        pending: f.pending,
        beforeRetry: () => {
          if (outcome === "confirmed")
            knownOperation(
              f,
              { blockNumber: 100n, blockHash },
              {
                transactionHash: hash,
                status: "success",
                blockNumber: 100n,
                blockHash,
              },
            );
          if (outcome === "relay")
            knownOperation(f, { from: other, nonce: 303672 });
          if (outcome === "RPC error")
            f.client.getTransactionReceipt = async () => {
              throw new Error("RPC unavailable");
            };
        },
      }),
      {
        code:
          outcome === "confirmed"
            ? "TRANSACTION_CONFIRMED"
            : outcome === "relay"
              ? "RELAY_PENDING"
              : "TRANSACTION_STATUS_UNAVAILABLE",
      },
    );
    assert.equal(f.state.writes.length, 0);
    assert.equal(
      walletChecks,
      1,
      "final wallet prompt must not occur after unsafe original evidence",
    );
  }
});

test("delegated and contract wallets cannot retry with an EOA nonce, even without a hash", async () => {
  for (const code of ["0xef0100" + other.slice(2), "0x60006000f3"]) {
    for (const knownDirect of [false, true]) {
      const f = knownDirect ? knownOperation(newOperation()) : newOperation();
      f.client.getBytecode = async ({ address }) => {
        assert.equal(address, owner);
        return code;
      };
      await blockedBeforeWallet(f, "RELAY_PENDING");
    }
  }
});

test("wallet bytecode RPC errors and malformed responses block before wallet access", async () => {
  for (const code of [null, "", "0xinvalid", false]) {
    const f = newOperation();
    f.client.getBytecode = async () => code;
    await blockedBeforeWallet(f, "TRANSACTION_STATUS_UNAVAILABLE");
  }
  const f = newOperation();
  f.client.getBytecode = async () => {
    throw new Error("RPC unavailable");
  };
  await blockedBeforeWallet(f, "TRANSACTION_STATUS_UNAVAILABLE");
});

test("undefined and empty owner bytecode retain the exact-nonce EOA retry path", async () => {
  for (const code of [undefined, "0x"]) {
    const f = newOperation();
    const readCode = f.client.getBytecode;
    f.client.getBytecode = async (args) =>
      args.address.toLowerCase() === owner.toLowerCase()
        ? code
        : readCode(args);
    await retryMigrationIntent({
      publicClient: f.client,
      walletClient: f.wallet,
      owner,
      pending: f.pending,
    });
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.writes[0].nonce, f.pending.nonce);
    assert.equal(encodeFunctionData(f.state.writes[0]), f.pending.data);
  }
});

test("delegation appearing during preflight blocks the final send", async () => {
  const f = newOperation();
  await assert.rejects(
    retryMigrationIntent({
      publicClient: f.client,
      walletClient: f.wallet,
      owner,
      pending: f.pending,
      beforeRetry: () => {
        const readCode = f.client.getBytecode;
        f.client.getBytecode = async (args) =>
          args.address.toLowerCase() === owner.toLowerCase()
            ? "0xef0100" + other.slice(2)
            : readCode(args);
      },
    }),
    { code: "RELAY_PENDING", userFacing: true },
  );
  assert.equal(f.state.writes.length, 0);
});
