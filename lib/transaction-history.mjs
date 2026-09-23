import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
} from "viem";
import { getVault, tokenAbi, vaultAbi } from "./vault-contracts.mjs";

const hashPattern = /^0x[\da-f]{64}$/i;
const addressPattern = /^0x[\da-f]{40}$/i;
export const validNonce = (value) => Number.isSafeInteger(value) && value >= 0;
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const statuses = new Set([
  "pending",
  "success",
  "reverted",
  "cancelled",
  "unknown",
]);
export const isPendingTransaction = (record) =>
  record.status === "pending" || record.status === "unknown";
export const historyKey = (owner) =>
  addressPattern.test(owner || "")
    ? "thesauros.earn.transactions." + owner.toLowerCase()
    : null;

// Used by the authenticated receipt endpoint as well as client reconciliation.
// Receipt status alone proves neither what was called nor who receives funds.
export function inspectEarnTransaction(transaction, vaultId, owner) {
  const vault = getVault(vaultId);
  if (
    !addressPattern.test(owner || "") ||
    !same(transaction.from, owner) ||
    BigInt(transaction.value ?? -1) !== 0n ||
    (transaction.chainId != null &&
      Number(transaction.chainId) !== vault.chainId)
  )
    throw new Error("Transaction account, value or network does not match.");

  const abi = same(transaction.to, vault.asset) ? tokenAbi : vaultAbi;
  if (
    !same(transaction.to, vault.asset) &&
    !same(transaction.to, vault.address)
  )
    throw new Error("Transaction destination does not match the vault.");
  const input = transaction.input;
  if (typeof input !== "string" || input.length > 4096)
    throw new Error("Transaction input is missing or invalid.");
  const { functionName, args } = decodeFunctionData({ abi, data: input });
  // Reject trailing bytes and malformed encodings instead of loosely decoding.
  if (!same(encodeFunctionData({ abi, functionName, args }), input))
    throw new Error("Transaction input is not a canonical vault call.");
  let kind;
  if (same(transaction.to, vault.asset)) {
    if (functionName !== "approve" || !same(args[0], vault.address))
      throw new Error("Approval spender does not match the vault.");
    kind = "approve";
  } else if (functionName === "deposit") {
    if (!same(args[1], owner))
      throw new Error("Deposit receiver does not match this account.");
    kind = "deposit";
  } else if (functionName === "withdraw" || functionName === "redeem") {
    if (!same(args[1], owner) || !same(args[2], owner))
      throw new Error(
        "Withdrawal receiver or owner does not match this account.",
      );
    kind = "withdraw";
  } else {
    throw new Error("This call is not an Earn transaction.");
  }
  return {
    vaultId,
    kind,
    functionName,
    input,
    value: "0",
    owner: owner.toLowerCase(),
  };
}

export function validateTransaction(record, now = Date.now()) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return null;
  let vault;
  try {
    vault = getVault(record.vaultId);
  } catch {
    return null;
  }
  if (
    !hashPattern.test(record.hash || "") ||
    !["approve", "deposit", "withdraw"].includes(record.kind) ||
    !statuses.has(record.status) ||
    typeof record.amount !== "string" ||
    record.amount.length > 60 ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(record.amount) ||
    !Number.isFinite(record.createdAt) ||
    record.createdAt <= 0 ||
    record.createdAt > now + 300000
  )
    return null;
  const result = {
    hash: record.hash.toLowerCase(),
    vaultId: vault.id,
    kind: record.kind,
    amount: record.amount,
    amountEstimated: record.amountEstimated === true,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt:
      Number.isFinite(record.updatedAt) && record.updatedAt <= now + 300000
        ? Math.max(record.createdAt, record.updatedAt)
        : record.createdAt,
  };
  if (record.input != null) {
    if (
      !/^0x(?:[\da-f]{2})+$/i.test(record.input) ||
      record.input.length > 4096
    )
      return null;
    result.input = record.input.toLowerCase();
  }
  if (record.replacedHash != null) {
    if (
      !hashPattern.test(record.replacedHash) ||
      record.replacedHash.toLowerCase() === result.hash
    )
      return null;
    result.replacedHash = record.replacedHash.toLowerCase();
  }
  if (record.replacementHash != null) {
    if (
      !hashPattern.test(record.replacementHash) ||
      same(record.replacementHash, result.hash)
    )
      return null;
    result.replacementHash = record.replacementHash.toLowerCase();
  }
  if (record.nonce != null) {
    if (!validNonce(record.nonce)) return null;
    result.nonce = record.nonce;
  }
  return result;
}

// An execution amount is taken only from the selected vault's matching event.
// In particular, previewRedeem before mining is not the amount actually received.
export function confirmedAssetAmount(receipt, vaultId, owner, kind) {
  if (receipt?.status !== "success" || !["deposit", "withdraw"].includes(kind))
    return null;
  const vault = getVault(vaultId);
  const matching = [];
  for (const log of receipt.logs || []) {
    if (!same(log.address, vault.address)) continue;
    try {
      const event = decodeEventLog({
        abi: vaultAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (
        event.eventName === (kind === "deposit" ? "Deposit" : "Withdraw") &&
        same(event.args.sender, owner) &&
        same(event.args.owner, owner) &&
        (kind === "deposit" || same(event.args.receiver, owner))
      )
        matching.push(event.args.assets);
    } catch {
      /* Other events are not evidence of an Earn asset movement. */
    }
  }
  return matching.length === 1
    ? formatUnits(matching[0], vault.decimals)
    : null;
}

export function replacementOutcome(original, response, owner) {
  if (
    !hashPattern.test(response?.hash || "") ||
    same(response.hash, original.hash) ||
    !same(response.originalHash, original.hash) ||
    !same(response.owner, owner) ||
    response.vaultId !== original.vaultId ||
    !validNonce(response.nonce) ||
    !["success", "reverted"].includes(response.status) ||
    (validNonce(original.nonce) && original.nonce !== response.nonce) ||
    (!validNonce(original.nonce) && response.originalVerified !== true)
  )
    throw new Error("The replacement does not match this pending transaction.");
  const vault = getVault(original.vaultId);
  const input =
    original.input ||
    (response.originalVerified ? response.originalInput : null);
  const samePayload =
    input &&
    same(input, response.input) &&
    same(
      response.to,
      original.kind === "approve" ? vault.asset : vault.address,
    ) &&
    response.value === "0";
  const originalUpdate = {
    ...original,
    status: "cancelled",
    nonce: response.nonce,
    replacementHash: response.hash.toLowerCase(),
    updatedAt: Date.now(),
  };
  const verification = response.originalVerified
    ? "original-transaction"
    : "saved-nonce";
  const verificationNote = response.originalVerified
    ? ""
    : "The original is no longer available from the network. The replacement matches the nonce saved in this browser.";
  if (!samePayload)
    return {
      status: "cancelled",
      original: originalUpdate,
      replacement: null,
      verification,
      verificationNote,
    };
  const inspected = inspectEarnTransaction(
    {
      from: owner,
      to: response.to,
      value: response.value,
      input: response.input,
    },
    original.vaultId,
    owner,
  );
  if (inspected.kind !== original.kind)
    throw new Error("The replacement changed the requested action.");
  const replacement = validateTransaction({
    ...original,
    hash: response.hash,
    nonce: response.nonce,
    status: response.status,
    input: response.input,
    replacedHash: original.hash,
    replacementHash: undefined,
    amount:
      response.status === "success" && response.actualAmount != null
        ? response.actualAmount
        : original.amount,
    amountEstimated:
      response.status === "success" && response.actualAmount != null
        ? false
        : original.amountEstimated === true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!replacement)
    throw new Error("The replacement details could not be saved.");
  return {
    status: response.status,
    original: originalUpdate,
    replacement,
    verification,
    verificationNote,
  };
}

export function mergeTransactions(current, incoming) {
  const byHash = new Map();
  for (const raw of [...current, ...incoming]) {
    const record = validateTransaction(raw);
    if (!record) continue;
    const id = record.vaultId + ":" + record.hash;
    const prior = byHash.get(id);
    if (prior && prior.updatedAt > record.updatedAt) continue;
    // A late poll or stale tab cannot turn a completed operation back to pending.
    if (prior && !isPendingTransaction(prior) && isPendingTransaction(record))
      continue;
    byHash.set(id, { ...prior, ...record });
  }
  const rows = [...byHash.values()].sort((a, b) => b.createdAt - a.createdAt);
  // Retain every outstanding receipt; limit only the completed browser history.
  return rows
    .filter(isPendingTransaction)
    .concat(rows.filter((row) => !isPendingTransaction(row)).slice(0, 100))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function parseTransactionHistory(serialized, owner) {
  if (!serialized) return [];
  if (serialized.length > 512000)
    throw new Error("Saved transaction history is too large.");
  const saved = JSON.parse(serialized);
  if (
    saved?.version !== 1 ||
    saved.owner !== owner.toLowerCase() ||
    !Array.isArray(saved.transactions) ||
    saved.transactions.length > 500
  )
    throw new Error("Saved transaction history could not be read.");
  return mergeTransactions([], saved.transactions);
}

export function receiptMatches(record, receipt, owner, allowPending = false) {
  if (
    !["success", "reverted", ...(allowPending ? ["pending"] : [])].includes(
      receipt?.status,
    ) ||
    receipt.hash?.toLowerCase() !== record.hash.toLowerCase() ||
    receipt.vaultId !== record.vaultId ||
    receipt.kind !== record.kind ||
    receipt.owner?.toLowerCase() !== owner.toLowerCase() ||
    (validNonce(record.nonce) && receipt.nonce !== record.nonce) ||
    (record.input &&
      receipt.input?.toLowerCase() !== record.input.toLowerCase())
  )
    return false;
  try {
    const vault = getVault(record.vaultId);
    const parsed = inspectEarnTransaction(
      {
        from: owner,
        to: record.kind === "approve" ? vault.asset : vault.address,
        input: receipt.input,
        value: receipt.value,
      },
      record.vaultId,
      owner,
    );
    return parsed.kind === record.kind;
  } catch {
    return false;
  }
}

export function isTransactionNotFound(error) {
  const seen = new Set();
  for (
    let current = error;
    current && !seen.has(current);
    current = current.cause
  ) {
    seen.add(current);
    if (
      ["TransactionNotFoundError", "TransactionReceiptNotFoundError"].includes(
        current.name,
      )
    )
      return true;
  }
  return false;
}
