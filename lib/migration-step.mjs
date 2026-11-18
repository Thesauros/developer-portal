import { getVault } from "./vault-contracts.mjs";
import { confirmMigrationWithdrawal } from "./migration-legacy.mjs";
import { confirmMigrationOperation } from "./migration-receipts.mjs";
import { isTransactionNotFound, validNonce } from "./transaction-history.mjs";
import { migrationHash } from "./migration-state.mjs";

const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const fail = (message) => {
  throw Object.assign(new Error(message), { userFacing: true });
};
const chainMatches = (tx, chainId) =>
  tx.chainId == null || Number(tx.chainId) === chainId;
const directIntent = (tx, intent, owner) =>
  tx &&
  same(tx.from, owner) &&
  same(tx.to, intent.address) &&
  same(tx.input, intent.data) &&
  tx.value === 0n &&
  chainMatches(tx, intent.chainId) &&
  validNonce(tx.nonce);

/** Read-only reconciliation. The caller alone decides when to persist a result. */
export async function confirmMigrationStep({
  client,
  destination,
  vaultId,
  owner,
  pending,
  hash,
}) {
  if (
    !pending ||
    !["withdraw", "approve", "deposit", "claim"].includes(pending.kind) ||
    !migrationHash(hash) ||
    !/^0x[0-9a-f]{40}$/i.test(owner || "")
  )
    fail("Connect your wallet and enter the saved transaction hash.");
  const expectedChain =
    pending.kind === "withdraw"
      ? getVault(vaultId).chainId
      : destination.chainId;
  if (
    pending.chainId !== expectedChain ||
    (await client.getChainId()) !== pending.chainId
  )
    fail("The transaction network does not match the saved operation.");
  const tx = await client.getTransaction({ hash });
  if (!tx || !same(tx.hash, hash) || !chainMatches(tx, pending.chainId))
    fail("The transaction does not match the requested hash and network.");
  const known = same(hash, pending.hash);
  // The nonce reserved before opening the wallet can differ from the one the
  // wallet actually signed. Only the original exact direct call can correct it.
  const intent =
    known && directIntent(tx, pending, owner)
      ? { ...pending, nonce: tx.nonce }
      : { ...pending };

  async function proveEOAReplacement() {
    if (
      !validNonce(intent.nonce) ||
      tx.nonce !== intent.nonce ||
      !same(tx.from, owner) ||
      !validNonce(tx.nonce)
    )
      fail("This transaction cannot replace the saved wallet operation.");
    let original;
    if (migrationHash(pending.hash)) {
      try {
        original = known
          ? tx
          : await client.getTransaction({ hash: pending.hash });
      } catch (error) {
        if (!isTransactionNotFound(error)) throw error;
      }
    }
    if (original) {
      if (
        !same(original.hash, pending.hash) ||
        !chainMatches(original, pending.chainId)
      )
        fail(
          "The original transaction could not be matched to the saved operation.",
        );
      if (
        directIntent(original, intent, owner) &&
        original.nonce === intent.nonce
      )
        return;
      // A relayer's nonce and this account's nonce are independent, including
      // when the account has since removed its delegation.
      if (!known)
        fail(
          "Check the original wallet transaction. An unrelated transaction cannot replace its relay.",
        );
    }
    const code = await client.getBytecode({ address: owner });
    if (code !== undefined && code !== "0x")
      fail(
        "This wallet can relay transactions. Check the original transaction before clearing this step.",
      );
  }

  async function cancelledWithdrawal() {
    if (
      same(tx.to, intent.address) &&
      same(tx.input, intent.data) &&
      tx.value === 0n
    )
      fail("The receipt does not prove the saved withdrawal.");
    await proveEOAReplacement();
    const [receipt, head] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getBlockNumber({ cacheTime: 0 }),
    ]);
    if (
      !receipt ||
      !same(receipt.transactionHash, hash) ||
      !same(receipt.from, owner) ||
      !same(receipt.to, tx.to) ||
      !["success", "reverted"].includes(receipt.status) ||
      typeof receipt.blockNumber !== "bigint" ||
      receipt.blockNumber < 0n ||
      tx.blockNumber !== receipt.blockNumber ||
      !migrationHash(receipt.blockHash) ||
      !same(tx.blockHash, receipt.blockHash) ||
      typeof head !== "bigint" ||
      head < receipt.blockNumber
    )
      fail(
        "The replacement transaction does not have a verified confirmation yet.",
      );
    return { kind: "withdraw", hash, cancelled: true };
  }

  if (pending.kind === "withdraw") {
    let result;
    try {
      result = await confirmMigrationWithdrawal(
        client,
        vaultId,
        owner,
        hash,
        intent,
      );
    } catch (error) {
      if (error.code === "WITHDRAWAL_REVERTED") {
        if (!directIntent(tx, intent, owner))
          fail(
            "The relayed withdrawal reverted. Check the original operation in your wallet before continuing; its authorization cannot be verified as consumed.",
          );
        if (!known) await proveEOAReplacement();
        return { kind: "withdraw", hash, reverted: true };
      }
      if (error.code !== "WITHDRAWAL_MISMATCH") throw error;
      return cancelledWithdrawal();
    }
    if (!known) await proveEOAReplacement();
    return { kind: "withdraw", ...result };
  }
  const result = await confirmMigrationOperation(
    client,
    destination,
    owner,
    hash,
    intent,
  );
  if (
    !result ||
    (result.kind && result.kind !== pending.kind) ||
    (!result.cancelled && !result.reverted && result.kind !== pending.kind)
  )
    fail("The confirmed operation type does not match the saved step.");
  if (result.cancelled || !known) await proveEOAReplacement();
  return { kind: pending.kind, ...result };
}
