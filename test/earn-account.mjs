import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
} from "viem";
import { getVault, tokenAbi, vaultAbi } from "../lib/vault-contracts.mjs";
import {
  historyKey,
  confirmedAssetAmount,
  inspectEarnTransaction,
  isPendingTransaction,
  isTransactionNotFound,
  mergeTransactions,
  parseTransactionHistory,
  receiptMatches,
  replacementOutcome,
  validateTransaction,
  validNonce,
} from "../lib/transaction-history.mjs";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const vault = getVault("arbitrum");
const hash = "0x" + "a".repeat(64);
const now = Date.now();
let checks = 0;
function check(name, run) {
  run();
  checks++;
  console.log("✓ " + name);
}
function transaction(functionName, args, overrides = {}) {
  const token = functionName === "approve";
  return {
    from: owner,
    to: token ? vault.asset : vault.address,
    value: 0n,
    chainId: vault.chainId,
    input: encodeFunctionData({
      abi: token ? tokenAbi : vaultAbi,
      functionName,
      args,
    }),
    ...overrides,
  };
}
const deposit = transaction("deposit", [1000000n, owner]);
const record = {
  hash,
  vaultId: vault.id,
  kind: "deposit",
  amount: "1",
  status: "pending",
  createdAt: now - 1000,
  updatedAt: now - 1000,
  input: deposit.input,
};
const receipt = {
  ...inspectEarnTransaction(deposit, vault.id, owner),
  hash,
  status: "success",
};
check("supported deposit, recipient and network decode", () => {
  assert.equal(
    inspectEarnTransaction(deposit, vault.id, owner).kind,
    "deposit",
  );
});
check("exact vault approval decodes", () => {
  assert.equal(
    inspectEarnTransaction(
      transaction("approve", [vault.address, 1000000n]),
      vault.id,
      owner,
    ).kind,
    "approve",
  );
});
check("approval for a different spender is rejected", () => {
  assert.throws(() =>
    inspectEarnTransaction(
      transaction("approve", [other, 1000000n]),
      vault.id,
      owner,
    ),
  );
});
check("approval of zero for the same vault can be recognized", () => {
  assert.equal(
    inspectEarnTransaction(
      transaction("approve", [vault.address, 0n]),
      vault.id,
      owner,
    ).kind,
    "approve",
  );
});
check("partial withdrawal requires account as owner and receiver", () => {
  assert.equal(
    inspectEarnTransaction(
      transaction("withdraw", [1n, owner, owner]),
      vault.id,
      owner,
    ).kind,
    "withdraw",
  );
  assert.throws(() =>
    inspectEarnTransaction(
      transaction("withdraw", [1n, other, owner]),
      vault.id,
      owner,
    ),
  );
  assert.throws(() =>
    inspectEarnTransaction(
      transaction("withdraw", [1n, owner, other]),
      vault.id,
      owner,
    ),
  );
});
check("full-share redemption maps to withdrawal", () => {
  assert.equal(
    inspectEarnTransaction(
      transaction("redeem", [12n, owner, owner]),
      vault.id,
      owner,
    ).functionName,
    "redeem",
  );
});
check("deposit to a third party is rejected", () => {
  assert.throws(() =>
    inspectEarnTransaction(
      transaction("deposit", [1n, other]),
      vault.id,
      owner,
    ),
  );
});
check("unowned transaction is rejected", () => {
  assert.throws(() =>
    inspectEarnTransaction({ ...deposit, from: other }, vault.id, owner),
  );
});
check("unknown destination, network and native value are rejected", () => {
  for (const overrides of [{ to: other }, { chainId: 8453 }, { value: 1n }])
    assert.throws(() =>
      inspectEarnTransaction({ ...deposit, ...overrides }, vault.id, owner),
    );
});
check("missing native value and bad input are rejected", () => {
  assert.throws(() =>
    inspectEarnTransaction({ ...deposit, value: undefined }, vault.id, owner),
  );
  assert.throws(() =>
    inspectEarnTransaction({ ...deposit, input: "0x1234" }, vault.id, owner),
  );
});
check("read calls do not qualify as Earn transactions", () => {
  assert.throws(() =>
    inspectEarnTransaction(transaction("totalAssets", []), vault.id, owner),
  );
});
check("trailing calldata cannot evade exact input matching", () => {
  assert.throws(() =>
    inspectEarnTransaction(
      { ...deposit, input: deposit.input + "00" },
      vault.id,
      owner,
    ),
  );
});
check("history accepts bounded typed records", () => {
  assert.equal(validateTransaction(record).hash, hash);
  for (const overrides of [
    { hash: "<script>" },
    { vaultId: "ethereum" },
    { status: "complete" },
    { amount: "Infinity" },
    { amount: "1e6" },
    { amount: "1.0000001" },
    { createdAt: now + 10000000 },
    { input: "javascript:alert(1)" },
  ])
    assert.equal(validateTransaction({ ...record, ...overrides }), null);
});
check("wallet history keys are scoped and reject non-addresses", () => {
  assert.notEqual(historyKey(owner), historyKey(other));
  assert.equal(historyKey("invalid"), null);
});
check("valid saved history round trips and other wallet is rejected", () => {
  const saved = JSON.stringify({ version: 1, owner, transactions: [record] });
  assert.equal(parseTransactionHistory(saved, owner).length, 1);
  assert.throws(() => parseTransactionHistory(saved, other));
  assert.throws(() => parseTransactionHistory("{", owner));
  assert.throws(() => parseTransactionHistory("a".repeat(512001), owner));
});
check("hash updates preserve input and deduplicate", () => {
  const next = mergeTransactions(
    [record],
    [{ ...record, input: undefined, status: "success", updatedAt: now }],
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "success");
  assert.equal(next[0].input, deposit.input);
});
check("stale tab cannot rewind confirmed transaction to pending", () => {
  const done = { ...record, status: "success", updatedAt: now };
  assert.equal(
    mergeTransactions([done], [{ ...record, updatedAt: now + 1 }])[0].status,
    "success",
  );
  assert.equal(mergeTransactions([done], [record])[0].status, "success");
});
check("history cap does not drop pending receipts", () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    ...record,
    hash: "0x" + (index + 1).toString(16).padStart(64, "0"),
    status: index < 20 ? "pending" : "success",
    createdAt: now - index,
  }));
  const merged = mergeTransactions([], rows);
  assert.equal(merged.filter(isPendingTransaction).length, 20);
  assert.equal(merged.length, 120);
});
check("success and reverted receipts match exact recorded call", () => {
  assert.equal(receiptMatches(record, receipt, owner), true);
  assert.equal(
    receiptMatches(record, { ...receipt, status: "reverted" }, owner),
    true,
  );
});
check("receipt mismatch never becomes success", () => {
  for (const overrides of [
    { input: transaction("deposit", [2000000n, owner]).input },
    { kind: "approve" },
    { vaultId: "base" },
    { owner: other },
    { hash: "0x" + "b".repeat(64) },
    { value: "1" },
    { status: "pending" },
  ])
    assert.equal(
      receiptMatches(record, { ...receipt, ...overrides }, owner),
      false,
    );
});
check(
  "legacy history without input still requires valid scoped calldata",
  () => {
    assert.equal(
      receiptMatches({ ...record, input: undefined }, receipt, owner),
      true,
    );
    assert.equal(
      receiptMatches(
        { ...record, input: undefined },
        { ...receipt, input: transaction("deposit", [1n, other]).input },
        owner,
      ),
      false,
    );
  },
);
check("only typed not-found errors qualify as pending", () => {
  assert.equal(
    isTransactionNotFound({ name: "TransactionNotFoundError" }),
    true,
  );
  assert.equal(
    isTransactionNotFound({
      cause: { name: "TransactionReceiptNotFoundError" },
    }),
    true,
  );
  assert.equal(isTransactionNotFound(new Error("RPC not found")), false);
  assert.equal(isTransactionNotFound({ name: "TimeoutError" }), false);
});
check("unknown remains outstanding while cancelled does not", () => {
  assert.equal(isPendingTransaction({ status: "unknown" }), true);
  assert.equal(isPendingTransaction({ status: "cancelled" }), false);
});
check("replacement cannot name itself", () => {
  assert.equal(validateTransaction({ ...record, replacedHash: hash }), null);
  assert.equal(
    validateTransaction({ ...record, replacedHash: "0x" + "b".repeat(64) })
      .replacedHash,
    "0x" + "b".repeat(64),
  );
});
const replacementHash = "0x" + "b".repeat(64);
const replacementResponse = {
  ...receipt,
  hash: replacementHash,
  originalHash: hash,
  nonce: 12,
  originalVerified: true,
  originalInput: deposit.input,
  to: vault.address,
  actualAmount: "1.000004",
};
check("nonce must be a nonnegative safe integer", () => {
  for (const value of [-1, 1.1, Infinity, "12", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validNonce(value), false);
    assert.equal(validateTransaction({ ...record, nonce: value }), null);
  }
  assert.equal(validateTransaction({ ...record, nonce: 0 }).nonce, 0);
});
check(
  "estimated redemption amount remains explicitly labelled in saved history",
  () => {
    assert.equal(
      validateTransaction({ ...record, amountEstimated: true }).amountEstimated,
      true,
    );
    assert.equal(validateTransaction(record).amountEstimated, false);
  },
);
check(
  "pending receipt can teach a nonce only for the exact saved request",
  () => {
    assert.equal(
      receiptMatches(
        record,
        { ...receipt, status: "pending", nonce: 12 },
        owner,
        true,
      ),
      true,
    );
    assert.equal(
      receiptMatches(
        { ...record, nonce: 13 },
        { ...receipt, status: "pending", nonce: 12 },
        owner,
        true,
      ),
      false,
    );
  },
);
check(
  "verified same-payload replacement closes old hash and records confirmed amount",
  () => {
    const result = replacementOutcome(
      { ...record, nonce: 12, amountEstimated: true },
      replacementResponse,
      owner,
    );
    assert.equal(result.original.status, "cancelled");
    assert.equal(result.original.replacementHash, replacementHash);
    assert.equal(result.replacement.status, "success");
    assert.equal(result.replacement.replacedHash, hash);
    assert.equal(result.replacement.amount, "1.000004");
    assert.equal(result.replacement.amountEstimated, false);
  },
);
check(
  "reverted same-payload replacement is recorded as reverted, not successful",
  () => {
    assert.equal(
      replacementOutcome(
        { ...record, nonce: 12 },
        { ...replacementResponse, status: "reverted" },
        owner,
      ).replacement.status,
      "reverted",
    );
  },
);
check(
  "same-nonce self-send cancellation does not fabricate an Earn operation",
  () => {
    const result = replacementOutcome(
      { ...record, nonce: 12 },
      { ...replacementResponse, to: owner, input: "0x", kind: null },
      owner,
    );
    assert.equal(result.status, "cancelled");
    assert.equal(result.replacement, null);
  },
);
check(
  "changed payload closes old intent without inventing its execution",
  () => {
    const result = replacementOutcome(
      { ...record, nonce: 12 },
      {
        ...replacementResponse,
        input: transaction("deposit", [2000000n, owner]).input,
      },
      owner,
    );
    assert.equal(result.status, "cancelled");
    assert.equal(result.replacement, null);
  },
);
check(
  "wrong nonce, wallet, original hash or pending replacement cannot unlock",
  () => {
    for (const changes of [
      { nonce: 13 },
      { owner: other },
      { originalHash: replacementHash },
      { status: "pending" },
    ])
      assert.throws(() =>
        replacementOutcome(
          { ...record, nonce: 12 },
          { ...replacementResponse, ...changes },
          owner,
        ),
      );
  },
);
check(
  "missing original RPC requires a saved nonce and discloses that limitation",
  () => {
    assert.throws(() =>
      replacementOutcome(
        record,
        { ...replacementResponse, originalVerified: false },
        owner,
      ),
    );
    const result = replacementOutcome(
      { ...record, nonce: 12 },
      { ...replacementResponse, originalVerified: false },
      owner,
    );
    assert.equal(result.verification, "saved-nonce");
    assert(result.verificationNote.includes("saved in this browser"));
  },
);
const depositLog = {
  address: vault.address,
  topics: encodeEventTopics({
    abi: vaultAbi,
    eventName: "Deposit",
    args: { sender: owner, owner },
  }),
  data: encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [1000004n, 999999n],
  ),
};
const withdrawLog = {
  address: vault.address,
  topics: encodeEventTopics({
    abi: vaultAbi,
    eventName: "Withdraw",
    args: { sender: owner, receiver: owner, owner },
  }),
  data: encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [14000005n, 12000000n],
  ),
};
check(
  "confirmed vault events provide actual deposit and withdrawal amounts",
  () => {
    assert.equal(
      confirmedAssetAmount(
        { status: "success", logs: [depositLog] },
        vault.id,
        owner,
        "deposit",
      ),
      "1.000004",
    );
    assert.equal(
      confirmedAssetAmount(
        { status: "success", logs: [withdrawLog] },
        vault.id,
        owner,
        "withdraw",
      ),
      "14.000005",
    );
  },
);
check(
  "unrelated, missing, ambiguous or reverted logs cannot invent actual proceeds",
  () => {
    for (const sample of [
      { status: "success", logs: [] },
      { status: "success", logs: [{ ...depositLog, address: other }] },
      { status: "success", logs: [depositLog, depositLog] },
      { status: "reverted", logs: [depositLog] },
    ])
      assert.equal(
        confirmedAssetAmount(sample, vault.id, owner, "deposit"),
        null,
      );
    assert.equal(
      confirmedAssetAmount(
        { status: "success", logs: [depositLog] },
        vault.id,
        other,
        "deposit",
      ),
      null,
    );
  },
);
console.log(`\n${checks} Earn account safety checks passed.`);
