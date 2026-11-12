import {
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  parseAbi,
  parseUnits,
  zeroAddress,
} from "viem";
import { getVault, vaultAbi } from "./vault-contracts.mjs";
import { readPosition, userError } from "./vault-reads.mjs";
import {
  confirmedAssetAmount,
  inspectEarnTransaction,
  isTransactionNotFound,
} from "./transaction-history.mjs";

const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const hashValid = (hash) => /^0x[\da-f]{64}$/i.test(hash || "");
const fail = (message, code, status = "invalid", extra = {}) =>
  Object.assign(userError(message), { code, status, ...extra });

// Keep the deployed legacy implementation verification, pinned reads and error
// semantics. An RPC error is never interpreted as an empty migration position.
export function readMigrationLegacy(client, vaultId, owner) {
  return readPosition(client, vaultId, owner);
}

/**
 * Reconcile an existing withdrawal without sending a transaction. A successful
 * receipt alone does not prove that USDC reached this wallet: require both the
 * legacy vault's exact withdrawal and its native USDC transfer to the owner.
 */
export async function confirmMigrationWithdrawal(client, vaultId, owner, hash) {
  const vault = getVault(vaultId);
  try {
    owner = getAddress(owner);
    if (owner === zeroAddress) throw new Error();
  } catch {
    throw fail(
      "Connect a valid wallet to check this withdrawal.",
      "INVALID_ACCOUNT",
    );
  }
  if (!hashValid(hash))
    throw fail("Enter a valid withdrawal transaction hash.", "INVALID_HASH");

  let receipt, transaction, chainId;
  try {
    [receipt, transaction, chainId] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash }),
      client.getChainId(),
    ]);
  } catch (cause) {
    if (isTransactionNotFound(cause))
      throw fail(
        "The withdrawal is awaiting confirmation. Check its status before submitting again.",
        "WITHDRAWAL_PENDING",
        "pending",
        { hash, cause },
      );
    throw fail(
      "The network could not verify this withdrawal. Keep its transaction link and retry the check.",
      "WITHDRAWAL_RPC_UNAVAILABLE",
      "pending",
      { hash, cause },
    );
  }
  if (chainId !== vault.chainId)
    throw fail("The RPC returned a different network.", "CHAIN_MISMATCH");
  if (
    !receipt ||
    !transaction ||
    !same(receipt.transactionHash, hash) ||
    !same(transaction.hash, hash) ||
    !same(receipt.from, owner) ||
    !same(receipt.to, vault.address)
  )
    throw fail(
      "The withdrawal receipt does not match this wallet and legacy product.",
      "WITHDRAWAL_MISMATCH",
    );
  let inspected;
  try {
    inspected = inspectEarnTransaction(transaction, vaultId, owner);
    if (inspected.kind !== "withdraw") throw new Error();
  } catch (cause) {
    throw fail(
      "This transaction is not a withdrawal from the selected legacy product to your wallet.",
      "WITHDRAWAL_MISMATCH",
      "invalid",
      { hash, cause },
    );
  }
  if (receipt.status === "reverted")
    throw fail(
      "The withdrawal reverted. It did not move your position or receive USDC.",
      "WITHDRAWAL_REVERTED",
      "reverted",
      { hash },
    );
  if (
    receipt.status !== "success" ||
    typeof receipt.blockNumber !== "bigint" ||
    receipt.blockNumber < 0n ||
    transaction.blockNumber == null
  )
    throw fail(
      "The withdrawal is awaiting confirmation. Check its status before submitting again.",
      "WITHDRAWAL_PENDING",
      "pending",
      { hash },
    );
  if (
    transaction.blockNumber !== receipt.blockNumber ||
    (receipt.blockHash && !same(transaction.blockHash, receipt.blockHash))
  )
    throw fail(
      "The transaction and receipt do not identify the same confirmed block.",
      "WITHDRAWAL_MISMATCH",
    );

  let head;
  try {
    head = await client.getBlockNumber({ cacheTime: 0 });
  } catch (cause) {
    throw fail(
      "The network could not verify withdrawal confirmations. Retry the check before continuing.",
      "WITHDRAWAL_RPC_UNAVAILABLE",
      "pending",
      { hash, cause },
    );
  }
  // Inclusion in the latest observed block is one confirmation.
  if (typeof head !== "bigint" || head < receipt.blockNumber)
    throw fail(
      "The withdrawal does not have a verified confirmation yet.",
      "WITHDRAWAL_PENDING",
      "pending",
      { hash },
    );

  const actual = confirmedAssetAmount(receipt, vaultId, owner, "withdraw");
  const withdrawals = [],
    transfers = [];
  for (const log of receipt.logs || []) {
    if (
      log.removed ||
      (log.transactionHash && !same(log.transactionHash, hash))
    )
      continue;
    try {
      if (same(log.address, vault.address)) {
        const event = decodeEventLog({
          abi: vaultAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (
          event.eventName === "Withdraw" &&
          same(event.args.sender, owner) &&
          same(event.args.owner, owner) &&
          same(event.args.receiver, owner)
        )
          withdrawals.push(event.args);
      } else if (same(log.address, vault.asset)) {
        const event = decodeEventLog({
          abi: transferAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (same(event.args.from, vault.address) && same(event.args.to, owner))
          transfers.push(event.args.value);
      }
    } catch {
      // Provider events and unrelated token transfers are not evidence of exit.
    }
  }
  const withdrawal = withdrawals[0];
  const { functionName, args } = decodeFunctionData({
    abi: vaultAbi,
    data: inspected.input,
  });
  if (
    actual == null ||
    withdrawals.length !== 1 ||
    transfers.length !== 1 ||
    withdrawal.assets <= 0n ||
    withdrawal.shares <= 0n ||
    parseUnits(actual, vault.decimals) !== withdrawal.assets ||
    transfers[0] !== withdrawal.assets ||
    (functionName === "withdraw" && args[0] !== withdrawal.assets) ||
    (functionName === "redeem" && args[0] !== withdrawal.shares)
  )
    throw fail(
      "The receipt does not prove that the expected USDC reached your wallet. Retry verification before continuing.",
      "WITHDRAWAL_PROCEEDS_UNVERIFIED",
      "invalid",
      { hash },
    );
  return {
    hash: hash.toLowerCase(),
    amount: withdrawal.assets,
    shares: withdrawal.shares,
    blockNumber: receipt.blockNumber,
  };
}
