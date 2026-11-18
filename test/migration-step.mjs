import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { getVault, vaultAbi, tokenAbi } from "../lib/vault-contracts.mjs";
import { epochAbi } from "../lib/crosschain-transactions.mjs";
import { requestEvents } from "../lib/crosschain-reads.mjs";
import { confirmMigrationStep } from "../lib/migration-step.mjs";

const owner = "0xd15ce3b61598D5705B17426111F203e172278B7b";
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32),
  originalHash = "0x" + "cd".repeat(32);
const blockHash = "0x" + "ef".repeat(32);
const destination = {
  chainId: 8453,
  address: "0x3333333333333333333333333333333333333333",
  asset: "0x4444444444444444444444444444444444444444",
};
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const delegatedCode = "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b";

function event(address, abi, eventName, indexed, types, values) {
  return {
    address,
    transactionHash: hash,
    blockNumber: 100n,
    blockHash,
    removed: false,
    topics: encodeEventTopics({ abi, eventName, args: indexed }),
    data: encodeAbiParameters(
      types.map((type) => ({ type })),
      values,
    ),
  };
}
function fixture(kind = "withdraw") {
  const vault = getVault("base"),
    amount = 10013n,
    shares = 9885n;
  const call =
    kind === "withdraw"
      ? { abi: vaultAbi, functionName: "redeem", args: [shares, owner, owner] }
      : kind === "approve"
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
  const address =
    kind === "withdraw"
      ? vault.address
      : kind === "approve"
        ? destination.asset
        : destination.address;
  const tx = {
    hash,
    from: owner,
    to: address,
    value: 0n,
    nonce: 7,
    chainId: 8453,
    input: encodeFunctionData(call),
    blockNumber: 100n,
    blockHash,
  };
  const pending = {
    kind,
    chainId: 8453,
    address,
    data: tx.input,
    nonce: 7,
    hash,
  };
  let logs = [];
  if (kind === "withdraw")
    logs = [
      event(
        vault.address,
        vaultAbi,
        "Withdraw",
        { sender: owner, receiver: owner, owner },
        ["uint256", "uint256"],
        [amount, shares],
      ),
      event(
        vault.asset,
        transferAbi,
        "Transfer",
        { from: vault.address, to: owner },
        ["uint256"],
        [amount],
      ),
    ];
  if (kind === "deposit")
    logs = [
      event(
        destination.address,
        requestEvents,
        "DepositRequested",
        { requestId: 17n, epoch: 5n, owner },
        ["address", "uint256"],
        [owner, amount],
      ),
      event(
        destination.asset,
        transferAbi,
        "Transfer",
        { from: owner, to: destination.address },
        ["uint256"],
        [amount],
      ),
    ];
  if (kind === "approve")
    logs = [
      event(
        destination.asset,
        tokenAbi,
        "Approval",
        { owner, spender: destination.address },
        ["uint256"],
        [amount],
      ),
    ];
  const receipt = {
    transactionHash: hash,
    from: owner,
    to: address,
    status: "success",
    blockNumber: 100n,
    blockHash,
    logs,
  };
  const f = {
    vault,
    amount,
    shares,
    tx,
    pending,
    receipt,
    code: "0x",
    head: 100n,
  };
  f.client = {
    getChainId: async () => 8453,
    getTransaction: async ({ hash: requested }) => {
      if (requested.toLowerCase() === f.tx.hash.toLowerCase()) return f.tx;
      if (
        f.original &&
        requested.toLowerCase() === f.original.hash.toLowerCase()
      )
        return f.original;
      throw Object.assign(new Error("Not found"), {
        name: "TransactionNotFoundError",
      });
    },
    getTransactionReceipt: async () => f.receipt,
    getBlockNumber: async () => f.head,
    getBytecode: async () => f.code,
  };
  f.run = () =>
    confirmMigrationStep({
      client: f.client,
      destination,
      vaultId: "base",
      owner,
      pending: f.pending,
      hash: f.tx.hash,
    });
  return f;
}
function replacement(f, original = true) {
  if (original)
    f.original = {
      ...f.tx,
      hash: originalHash,
      blockNumber: null,
      blockHash: null,
    };
  f.pending = { ...f.pending, hash: originalHash };
  f.tx.to = owner;
  f.tx.input = "0x";
  f.receipt.to = owner;
  f.receipt.logs = [];
  return f;
}

test("recovers the actual Base relay withdrawal effects without adopting the relayer nonce", async () => {
  const f = fixture();
  // Public mined envelope and effect payloads from the reported transaction.
  // Its relay calldata is opaque; only its selector is needed by this verifier.
  f.tx.hash =
    "0x90e73066321009b1bafe3d48e5c4c3ccfe93846a91ad273453f69e5485a59f89";
  f.tx.from = "0xb01caea8c6c47bbf4f4b4c5080ca642043359c2e";
  f.tx.to = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
  f.tx.input = "0xcef6d209";
  f.tx.nonce = 303672;
  f.tx.blockNumber = 58255704n;
  f.tx.blockHash =
    "0x17bcdd3b38cc2f8b39b59e450ed5815125bbdecd32879a04dbe97df2b57500fb";
  Object.assign(f.receipt, {
    from: f.tx.from,
    to: f.tx.to,
    transactionHash: f.tx.hash,
    blockNumber: f.tx.blockNumber,
    blockHash: f.tx.blockHash,
  });
  for (const log of f.receipt.logs)
    Object.assign(log, {
      transactionHash: f.tx.hash,
      blockNumber: f.tx.blockNumber,
      blockHash: f.tx.blockHash,
    });
  f.pending = Object.freeze({ ...f.pending, hash: f.tx.hash });
  f.head = 59121356n;
  f.code = delegatedCode;
  const before = structuredClone(f.pending);
  assert.deepEqual(await f.run(), {
    kind: "withdraw",
    hash: f.tx.hash,
    amount: 10013n,
    shares: 9885n,
    blockNumber: 58255704n,
  });
  assert.deepEqual(f.pending, before);
});

for (const kind of ["withdraw", "approve", "deposit", "claim"]) {
  test(`adopts the wallet-assigned nonce only for the exact known original ${kind}`, async () => {
    const f = fixture(kind);
    f.tx.nonce = 9;
    f.code = delegatedCode;
    f.pending = Object.freeze({ ...f.pending });
    assert.equal((await f.run()).kind, kind);
    assert.equal(f.pending.nonce, 7);
    const unrelated = fixture(kind);
    unrelated.tx.nonce = 9;
    unrelated.pending.hash = originalHash;
    await assert.rejects(unrelated.run(), /nonce|replace|withdrawal/i);
  });
}

test("known relayed Base approvals and deposits retain canonical event proof", async () => {
  for (const kind of ["approve", "deposit"]) {
    const f = fixture(kind);
    f.tx.from = other;
    f.tx.to = owner;
    f.tx.input = "0xcef6d209";
    f.tx.nonce = 888;
    Object.assign(f.receipt, { from: other, to: owner });
    f.code = delegatedCode;
    assert.equal((await f.run()).kind, kind);
    assert.equal(f.pending.nonce, 7);
    f.pending.hash = originalHash;
    await assert.rejects(f.run());
  }
});

test("confirmed direct cancellation is bound to an observed exact original owner transaction", async () => {
  for (const kind of ["withdraw", "approve", "deposit", "claim"]) {
    const f = replacement(fixture(kind));
    f.code = delegatedCode;
    assert.deepEqual(await f.run(), { kind, hash, cancelled: true });
    assert.equal(f.receipt.logs.length, 0);
    for (const change of [
      { from: other },
      { nonce: 8 },
      { chainId: 42161 },
      { input: "0xcef6d209" },
    ]) {
      const bad = replacement(fixture(kind));
      bad.code = delegatedCode;
      Object.assign(bad.original, change);
      await assert.rejects(bad.run());
    }
  }
});

test("only plain EOA accounts retain hashless or missing-original nonce cancellation recovery", async () => {
  for (const kind of ["withdraw", "approve", "deposit", "claim"]) {
    const f = replacement(fixture(kind), false);
    assert.equal((await f.run()).cancelled, true);
    f.pending.hash = null;
    assert.equal((await f.run()).cancelled, true);
    f.code = delegatedCode;
    await assert.rejects(f.run(), /relay|original/i);
  }
});

test("a known relay cannot be cleared using an unrelated owner nonce even after delegation removal", async () => {
  for (const kind of ["withdraw", "approve", "deposit", "claim"]) {
    const f = replacement(fixture(kind));
    Object.assign(f.original, {
      from: other,
      to: owner,
      input: "0xcef6d209",
      nonce: 303672,
    });
    f.code = "0x";
    await assert.rejects(f.run(), /relay|original/i);
  }
});

test("nonce replacement proof never clears unknown RPC or account-code failures", async () => {
  const error = new Error("Synthetic RPC outage");
  const original = replacement(fixture(), false);
  original.client.getTransaction = async ({ hash: value }) => {
    if (value === hash) return original.tx;
    throw error;
  };
  await assert.rejects(original.run(), (value) => value === error);
  const code = replacement(fixture("approve"), false);
  code.client.getBytecode = async () => {
    throw error;
  };
  await assert.rejects(code.run(), (value) => value === error);
});

test("wrong chain, owner, hash or block never yields cancellation or credits", async () => {
  const cases = [
    (f) => {
      f.client.getChainId = async () => 42161;
    },
    (f) => {
      f.tx.chainId = 42161;
    },
    (f) => {
      f.tx.hash = originalHash;
    },
    (f) => {
      f.tx.from = other;
      f.receipt.from = other;
    },
    (f) => {
      f.receipt.transactionHash = originalHash;
    },
    (f) => {
      f.receipt.blockNumber = 99n;
    },
    (f) => {
      f.receipt.blockHash = originalHash;
    },
    (f) => {
      f.head = 99n;
    },
  ];
  for (const kind of ["withdraw", "approve"])
    for (const change of cases) {
      const f = replacement(fixture(kind));
      change(f);
      const requestedHash = hash;
      await assert.rejects(
        confirmMigrationStep({
          client: f.client,
          destination,
          vaultId: "base",
          owner,
          pending: f.pending,
          hash: requestedHash,
        }),
      );
    }
});

test("known exact reverted withdrawals recover without claiming proceeds", async () => {
  const f = fixture();
  f.receipt.status = "reverted";
  f.receipt.logs = [];
  assert.deepEqual(await f.run(), { kind: "withdraw", hash, reverted: true });
});

test("a reverted outer relay does not prove the wallet authorization was consumed", async () => {
  const f = fixture();
  f.tx.from = other;
  f.tx.to = other;
  f.tx.input = "0x12345678";
  f.tx.nonce = 303672;
  f.receipt.from = other;
  f.receipt.to = other;
  f.receipt.status = "reverted";
  f.receipt.logs = [];
  const before = structuredClone(f.pending);
  await assert.rejects(f.run(), /authorization cannot be verified as consumed/);
  assert.deepEqual(f.pending, before);
});

test("an effect of another kind cannot complete the saved step", async () => {
  const f = fixture("deposit");
  f.pending.kind = "approve";
  await assert.rejects(f.run(), /operation type/i);
});
