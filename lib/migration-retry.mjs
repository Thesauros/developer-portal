import {
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  zeroAddress,
} from "viem";
import { base } from "viem/chains";
import { getVault, tokenAbi, vaultAbi } from "./vault-contracts.mjs";
import {
  inspectEarnTransaction,
  isTransactionNotFound,
} from "./transaction-history.mjs";
import { readMigrationLegacy } from "./migration-legacy.mjs";
import { crosschain } from "./crosschain-config.mjs";
import { epochAbi, prepareCrosschain } from "./crosschain-transactions.mjs";

const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const fail = (message, code, extra = {}) =>
  Object.assign(new Error(message), { userFacing: true, code, ...extra });

/**
 * Retry the exact saved intent with its already reserved nonce. This remains
 * safe for a direct transaction when the original prompt or broadcast result
 * is unknown: at most one transaction with this EOA nonce can execute. A known
 * wallet relay must instead be reconciled; its nonce belongs to another sender.
 * The caller retains the saved intent, including after rejection or RPC error.
 */
export async function retryMigrationIntent({
  publicClient,
  walletClient,
  owner,
  vaultId,
  pending,
  onHash,
  beforeRetry = async () => {},
}) {
  try {
    owner = getAddress(owner);
    if (owner === zeroAddress) throw new Error();
  } catch {
    throw fail("Connect a valid wallet.", "INVALID_ACCOUNT");
  }
  if (!pending || !Number.isSafeInteger(pending.nonce) || pending.nonce < 0)
    throw fail(
      "The saved transaction nonce is unavailable. Check the operation using its hash from your wallet.",
      "INVALID_NONCE",
    );
  if (
    !/^0x(?:[0-9a-f]{2})+$/i.test(pending.data || "") ||
    pending.data.length > 4096
  )
    throw fail("The saved transaction data is invalid.", "INVALID_INTENT");

  const legacy = pending.kind === "withdraw";
  const vault = legacy ? getVault(vaultId) : null;
  const chain = legacy ? vault.chain : base;
  if (pending.chainId !== chain.id)
    throw fail(
      "The saved network does not match this operation.",
      "CHAIN_MISMATCH",
    );
  const checkWallet = async () => {
    const [accounts, chainId] = await Promise.all([
      walletClient.getAddresses(),
      walletClient.getChainId(),
    ]);
    if (!same(accounts?.[0], owner) || chainId !== chain.id)
      throw fail(
        "Your wallet or network changed. Review the operation again.",
        "WALLET_CHANGED",
      );
  };
  const checkNonce = async () => {
    if ((await publicClient.getChainId()) !== chain.id)
      throw fail("The RPC returned a different network.", "CHAIN_MISMATCH");
    const confirmed = await publicClient.getTransactionCount({
      address: owner,
      blockTag: "latest",
    });
    if (!Number.isSafeInteger(confirmed) || confirmed < 0)
      throw fail(
        "The wallet nonce could not be verified.",
        "NONCE_UNAVAILABLE",
      );
    if (confirmed > pending.nonce)
      throw fail(
        "This nonce has already been used. Enter the confirmed transaction hash or its replacement hash.",
        "NONCE_CONSUMED",
      );
  };

  let call;
  try {
    if (legacy) {
      const inspected = inspectEarnTransaction(
        {
          from: owner,
          to: pending.address,
          input: pending.data,
          value: 0n,
          chainId: pending.chainId,
        },
        vaultId,
        owner,
      );
      if (inspected.kind !== "withdraw") throw new Error();
      const decoded = decodeFunctionData({ abi: vaultAbi, data: pending.data });
      call = { address: vault.address, abi: vaultAbi, ...decoded };
    } else {
      const approval = pending.kind === "approve";
      const expectedAddress = approval ? crosschain.asset : crosschain.vault;
      if (!same(pending.address, expectedAddress)) throw new Error();
      const abi = approval ? tokenAbi : epochAbi;
      const decoded = decodeFunctionData({ abi, data: pending.data });
      const methods = {
        approve: "approve",
        deposit: "requestDeposit",
        redeem: "requestRedeem",
        claim: "claim",
        cancel: "cancel",
      };
      if (decoded.functionName !== methods[pending.kind]) throw new Error();
      if (approval && !same(decoded.args[0], crosschain.vault))
        throw new Error();
      if (pending.kind === "deposit" && !same(decoded.args[1], owner))
        throw new Error();
      if (
        pending.kind === "redeem" &&
        (!same(decoded.args[1], owner) || !same(decoded.args[2], owner))
      )
        throw new Error();
      call = { address: expectedAddress, abi, ...decoded };
    }
    if (!same(encodeFunctionData(call), pending.data)) throw new Error();
  } catch {
    throw fail(
      "The saved operation does not match the product, receiver or approval recipient.",
      "INVALID_INTENT",
    );
  }

  const checkOriginal = async () => {
    if (!pending.hash) return;
    const unavailable = (cause) =>
      fail(
        "The original transaction could not be verified. Check it again before sending anything; your saved operation is unchanged.",
        "TRANSACTION_STATUS_UNAVAILABLE",
        { hash: pending.hash, status: "pending", cause },
      );
    if (!/^0x[\da-f]{64}$/i.test(pending.hash))
      throw fail("The saved transaction hash is invalid.", "INVALID_HASH");
    let chainId;
    try {
      chainId = await publicClient.getChainId();
    } catch (cause) {
      throw unavailable(cause);
    }
    if (chainId !== chain.id)
      throw fail("The RPC returned a different network.", "CHAIN_MISMATCH");
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        publicClient.getTransaction({ hash: pending.hash }),
      ),
      Promise.resolve().then(() =>
        publicClient.getTransactionReceipt({ hash: pending.hash }),
      ),
    ]);
    for (const result of results)
      if (result.status === "rejected" && !isTransactionNotFound(result.reason))
        throw unavailable(result.reason);
    const [transaction, receipt] = results.map((result) =>
      result.status === "fulfilled" ? result.value : null,
    );
    if (
      (transaction &&
        (!same(transaction.hash, pending.hash) ||
          (transaction.chainId != null &&
            Number(transaction.chainId) !== chain.id))) ||
      (receipt &&
        (!same(receipt.transactionHash, pending.hash) ||
          (receipt.chainId != null && Number(receipt.chainId) !== chain.id)))
    )
      throw unavailable();
    if (receipt) {
      if (
        !["success", "reverted"].includes(receipt.status) ||
        typeof receipt.blockNumber !== "bigint" ||
        receipt.blockNumber < 0n ||
        !/^0x[\da-f]{64}$/i.test(receipt.blockHash || "") ||
        (transaction &&
          (transaction.blockNumber !== receipt.blockNumber ||
            !same(transaction.blockHash, receipt.blockHash)))
      )
        throw unavailable();
      // Inclusion is a stop signal, never proof that the intended funds moved.
      // The caller must reconcile the exact receipt and product outcome.
      throw fail(
        "This transaction is already included in a block. Check its result before continuing; do not send it again.",
        "TRANSACTION_CONFIRMED",
        { hash: pending.hash, status: "confirmed" },
      );
    }
    // Absence on one RPC cannot prove a wallet submission was a direct EOA
    // transaction. A known hash requires positive proof before a replacement.
    if (!transaction) throw unavailable();
    if (
      !same(transaction.from, owner) ||
      !same(transaction.to, pending.address) ||
      !same(transaction.input, pending.data)
    )
      throw fail(
        "Your wallet submitted this through a relay or with different transaction data. It cannot be sent again safely. Check the original transaction instead.",
        "RELAY_PENDING",
        { hash: pending.hash, status: "pending" },
      );
    if (
      transaction.nonce !== pending.nonce ||
      transaction.value !== 0n ||
      transaction.blockNumber != null ||
      transaction.blockHash != null
    )
      throw unavailable();
  };
  const checkAccountCode = async () => {
    let chainId, code;
    try {
      [chainId, code] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getBytecode({ address: owner }),
      ]);
    } catch (cause) {
      throw fail(
        "Your wallet's transaction type could not be verified. Check its transaction hash before retrying.",
        "TRANSACTION_STATUS_UNAVAILABLE",
        { hash: pending.hash, status: "pending", cause },
      );
    }
    if (chainId !== chain.id)
      throw fail("The RPC returned a different network.", "CHAIN_MISMATCH");
    if (code === undefined || code === "0x") return;
    if (typeof code !== "string" || !/^0x(?:[\da-f]{2})+$/i.test(code))
      throw fail(
        "Your wallet's transaction type could not be verified. Check its transaction hash before retrying.",
        "TRANSACTION_STATUS_UNAVAILABLE",
        { hash: pending.hash, status: "pending" },
      );
    // A delegated or contract wallet may relay a new prompt independently of
    // the saved EOA nonce, even when the previous transaction was direct.
    throw fail(
      "This wallet may have sent a relayed transaction. Check its transaction hash before retrying.",
      "RELAY_PENDING",
      { hash: pending.hash, status: "pending" },
    );
  };

  await checkOriginal();
  await checkAccountCode();
  await checkWallet();
  await checkNonce();
  if (!legacy && ["approve", "deposit", "redeem"].includes(pending.kind))
    await beforeRetry(pending.kind);
  if (legacy) {
    const position = await readMigrationLegacy(publicClient, vaultId, owner);
    if (position.withdrawPaused || position.shares <= 0n || call.args[0] <= 0n)
      throw fail(
        "The withdrawal from the previous vault is unavailable right now. Refresh to check your position again.",
        "WITHDRAWAL_UNAVAILABLE",
      );
    const simulated = await publicClient.simulateContract({
      ...call,
      account: owner,
    });
    if (!simulated?.request)
      throw fail(
        "The withdrawal retry could not be simulated.",
        "SIMULATION_UNAVAILABLE",
      );
  } else {
    const input = ["claim", "cancel"].includes(pending.kind)
      ? call.args[0].toString()
      : formatUnits(
          pending.kind === "approve" ? call.args[1] : call.args[0],
          6,
        );
    const prepared = await prepareCrosschain(
      publicClient,
      owner,
      pending.kind,
      input,
    );
    if (
      !same(prepared.address, pending.address) ||
      !same(encodeFunctionData(prepared), pending.data)
    )
      throw fail(
        "The verified operation differs from the saved transaction.",
        "INTENT_CHANGED",
      );
  }
  await checkNonce();
  await checkOriginal();
  await checkAccountCode();
  await checkWallet();
  const hash = await walletClient.writeContract({
    ...call,
    account: owner,
    chain,
    chainId: chain.id,
    value: 0n,
    nonce: pending.nonce,
  });
  if (!/^0x[0-9a-f]{64}$/i.test(hash || ""))
    throw fail(
      "Your wallet did not return a valid transaction hash. Check its activity before continuing.",
      "HASH_UNAVAILABLE",
      { status: "pending" },
    );
  try {
    await onHash?.(hash);
  } catch (cause) {
    throw fail(
      "The transaction was sent, but its hash could not be saved. Keep its transaction link from your wallet.",
      "HASH_NOT_SAVED",
      { hash, status: "pending", cause },
    );
  }
  return { hash };
}
