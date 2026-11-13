import {
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  zeroAddress,
} from "viem";
import { base } from "viem/chains";
import { getVault, tokenAbi, vaultAbi } from "./vault-contracts.mjs";
import { inspectEarnTransaction } from "./transaction-history.mjs";
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
 * safe when the original prompt or broadcast result is unknown: at most one
 * transaction using this nonce can execute on this account and chain.
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
