import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  zeroAddress,
} from "viem";
import {
  amountUnits,
  getVault,
  tokenAbi,
  vaultAbi,
} from "./vault-contracts.mjs";
import { readPosition, userError } from "./vault-reads.mjs";

const fail = (message, code, extra = {}) =>
  Object.assign(userError(message), { code, ...extra });
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const notify = (callback, ...args) => {
  try {
    Promise.resolve(callback?.(...args)).catch(() => {});
  } catch {
    // Rendering a progress update must not interrupt transaction tracking.
  }
};
const hashValid = (hash) => /^0x[0-9a-f]{64}$/i.test(hash || "");
function userRejected(error) {
  for (
    let current = error, depth = 0;
    current && depth < 8;
    current = current.cause, depth++
  ) {
    if (
      current.code === 4001 ||
      /UserRejected|User rejected|user denied|rejected the request/i.test(
        `${current.name} ${current.message}`,
      )
    )
      return true;
  }
  return false;
}

function accountAddress(owner) {
  try {
    const address = getAddress(owner);
    if (address === zeroAddress) throw new Error();
    return address;
  } catch {
    throw fail(
      "Connect a valid wallet before preparing a transaction.",
      "INVALID_ACCOUNT",
    );
  }
}

function transactionMatches(transaction, expected) {
  return (
    transaction &&
    same(transaction.from, expected.from) &&
    same(transaction.to, expected.to) &&
    same(transaction.input ?? transaction.data, expected.input) &&
    transaction.value === 0n &&
    (transaction.chainId == null || transaction.chainId === expected.chainId)
  );
}

async function verifyWallet(walletClient, owner, vault) {
  // Read the connector, not walletClient.account: accounts can change while a
  // simulation or receipt is pending. A cached account does not establish consent.
  const [accounts, chainId] = await Promise.all([
    walletClient.getAddresses(),
    walletClient.getChainId(),
  ]);
  if (!same(accounts?.[0], owner))
    throw fail(
      "Your connected wallet changed. Review this action again.",
      "ACCOUNT_CHANGED",
    );
  if (chainId !== vault.chainId)
    throw fail(
      `Switch your wallet to ${vault.name} and review this action again.`,
      "CHAIN_CHANGED",
    );
}

/**
 * The factory permits isolated tests of transaction orchestration. The exported
 * production functions below always use readPosition, including bytecode, chain,
 * asset and decimals verification. No caller-supplied verification bypass exists
 * in prepareTransaction or executeTransaction.
 */
export function createTransactionEngine({
  positionReader = readPosition,
} = {}) {
  async function prepareTransaction({
    publicClient,
    vaultId,
    owner,
    kind,
    amount,
    all = false,
  }) {
    const vault = getVault(vaultId);
    owner = accountAddress(owner);
    if (!["deposit", "withdraw"].includes(kind))
      throw fail("Choose deposit or withdraw.", "INVALID_ACTION");
    if (all && kind !== "withdraw")
      throw fail(
        "Withdraw all is available only for a vault position.",
        "INVALID_ACTION",
      );
    if (!all && typeof amount !== "string")
      throw fail("Enter the amount as a decimal value.", "INVALID_AMOUNT");

    // One pinned block gives the review internally consistent balances and state.
    const position = await positionReader(publicClient, vaultId, owner);
    const read = (functionName, args) =>
      publicClient.readContract({
        address: vault.address,
        abi: vaultAbi,
        functionName,
        args,
        blockNumber: position.blockNumber,
      });
    let rawAmount,
      shares,
      functionName,
      args,
      needsApproval = false;
    if (kind === "deposit") {
      if (position.depositPaused)
        throw fail(
          "Deposits are currently paused for this vault.",
          "DEPOSIT_PAUSED",
        );
      rawAmount = amountUnits(amount);
      if (rawAmount < position.minAssets)
        throw fail(
          "The deposit is below the vault’s current minimum.",
          "BELOW_MINIMUM",
        );
      if (rawAmount > position.cash)
        throw fail(
          "This amount exceeds your token balance on the selected network.",
          "INSUFFICIENT_CASH",
        );
      shares = await read("previewDeposit", [rawAmount]);
      if (shares <= 0n)
        throw fail(
          "This amount would not produce any vault shares.",
          "ZERO_SHARES",
        );
      needsApproval = position.allowance < rawAmount;
      functionName = "deposit";
      args = [rawAmount, owner];
    } else {
      if (position.withdrawPaused)
        throw fail(
          "Withdrawals are currently paused for this vault.",
          "WITHDRAW_PAUSED",
        );
      if (position.shares <= 0n)
        throw fail(
          "This wallet has no shares in the selected vault.",
          "NO_POSITION",
        );
      if (all) {
        shares = position.shares;
        rawAmount = position.positionAssets;
        functionName = "redeem";
        args = [shares, owner, owner];
      } else {
        rawAmount = amountUnits(amount);
        if (rawAmount > position.positionAssets)
          throw fail(
            "This amount exceeds the current value of your vault position.",
            "INSUFFICIENT_POSITION",
          );
        shares = await read("previewWithdraw", [rawAmount]);
        functionName = "withdraw";
        args = [rawAmount, owner, owner];
      }
      if (shares <= 0n || shares > position.shares || rawAmount <= 0n)
        throw fail(
          "Your position changed. Refresh and choose an available withdrawal amount.",
          "INSUFFICIENT_SHARES",
        );
    }
    return Object.freeze({
      vaultId,
      owner,
      kind,
      amount: all ? null : amount.trim(),
      all: !!all,
      position: Object.freeze(position),
      rawAmount,
      shares,
      needsApproval,
      functionName,
      args: Object.freeze(args),
      address: vault.address,
      abi: vaultAbi,
    });
  }

  /**
   * One user action only. action:'approve' approves exactly the deposit amount;
   * action:'submit' deposits/withdraws. Approval never automatically deposits.
   * Success means a matching transaction with a successful receipt. Errors after
   * broadcast carry hash, submittedHash and status for accurate recovery UI.
   */
  async function executeTransaction({
    publicClient,
    walletClient,
    prepared,
    action = prepared?.action || "submit",
    onHash,
    onReplacement,
  }) {
    if (!prepared || !["approve", "submit"].includes(action))
      throw fail("Review the transaction before continuing.", "INVALID_ACTION");
    const vault = getVault(prepared.vaultId);
    await verifyWallet(walletClient, prepared.owner, vault);
    // Rebuild from intent. Never reuse cached balances, ABI, target, args or a
    // successful simulation attached to an earlier review.
    const fresh = await prepareTransaction({
      publicClient,
      vaultId: prepared.vaultId,
      owner: prepared.owner,
      kind: prepared.kind,
      amount: prepared.amount,
      all: prepared.all,
    });
    if (fresh.all && fresh.shares !== prepared.shares)
      throw fail(
        "Your share balance changed. Review Withdraw all again.",
        "POSITION_CHANGED",
      );
    if (
      fresh.position.managementFee !== prepared.position?.managementFee ||
      fresh.position.performanceFee !== prepared.position?.performanceFee
    )
      throw fail(
        "The vault’s fee settings changed. Review the transaction again.",
        "TERMS_CHANGED",
      );
    if (action === "approve" && fresh.kind !== "deposit")
      throw fail(
        "This withdrawal does not need a token approval.",
        "INVALID_APPROVAL",
      );
    if (action === "approve" && !fresh.needsApproval)
      throw fail(
        "The token is already approved for this amount. Continue to deposit.",
        "ALREADY_APPROVED",
      );
    if (action === "submit" && fresh.needsApproval)
      throw fail("Approve this amount before depositing.", "APPROVAL_REQUIRED");
    const nativeBalance = await publicClient.getBalance({
      address: fresh.owner,
      blockNumber: fresh.position.blockNumber,
    });
    if (nativeBalance <= 0n)
      throw fail(
        `Your wallet needs ETH on ${vault.name} to pay the transaction fee.`,
        "NO_GAS_BALANCE",
      );

    const call =
      action === "approve"
        ? {
            address: vault.asset,
            abi: tokenAbi,
            functionName: "approve",
            args: [vault.address, fresh.rawAmount],
          }
        : {
            address: vault.address,
            abi: vaultAbi,
            functionName: fresh.functionName,
            args: fresh.args,
          };
    // Simulation uses current state, not the prior pinned review block.
    const simulation = await publicClient.simulateContract({
      ...call,
      account: fresh.owner,
    });
    if (!simulation?.request)
      throw fail(
        "The transaction could not be simulated. Refresh and try again.",
        "SIMULATION_UNAVAILABLE",
      );
    if (action === "approve" && simulation.result === false)
      throw fail(
        "The token did not accept the approval in simulation. No approval was sent.",
        "APPROVAL_REJECTED",
      );
    await verifyWallet(walletClient, fresh.owner, vault);
    const expected = {
      from: fresh.owner,
      to: call.address,
      value: 0n,
      chainId: vault.chainId,
      input: encodeFunctionData(call),
    };
    // Reassert the reviewed contract call after simulation. Provider responses
    // cannot change the receiver, spender, amount, target or selected chain.
    let submittedHash;
    try {
      submittedHash = await walletClient.writeContract({
        ...simulation.request,
        ...call,
        account: fresh.owner,
        chain: vault.chain,
        value: 0n,
      });
    } catch (cause) {
      if (userRejected(cause)) throw cause;
      // A transport failure during submission does not prove the wallet failed
      // to broadcast. Do not invite an immediate duplicate transaction.
      throw fail(
        "The wallet did not return a transaction hash. Check its activity before trying this action again.",
        "SUBMISSION_UNCERTAIN",
        { status: "pending", cause },
      );
    }
    if (!hashValid(submittedHash))
      throw fail(
        "The wallet did not return a valid transaction hash. Check your wallet activity before retrying.",
        "HASH_UNAVAILABLE",
        { status: "pending" },
      );
    let hash = submittedHash,
      replacementProblem = null;
    const progress = {
      action,
      input: expected.input,
      prepared: fresh,
      rawAmount: fresh.rawAmount,
      shares: fresh.shares,
      status: "pending",
      submittedHash,
    };
    notify(onHash, hash, {
      ...progress,
      replacement: false,
    });
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: submittedHash,
        confirmations: 1,
        timeout: 180_000,
        onReplaced(info) {
          if (hashValid(info.transaction?.hash)) hash = info.transaction.hash;
          else if (hashValid(info.transactionReceipt?.transactionHash))
            hash = info.transactionReceipt.transactionHash;
          if (info.reason === "cancelled")
            replacementProblem = fail(
              "The transaction was cancelled in your wallet.",
              "TRANSACTION_CANCELLED",
              { status: "cancelled" },
            );
          else if (!transactionMatches(info.transaction, expected))
            replacementProblem = fail(
              "The transaction was replaced with a different action. Review its details in your wallet.",
              "TRANSACTION_REPLACED",
              { status: "replaced" },
            );
          notify(onReplacement, info);
          notify(onHash, hash, {
            ...progress,
            replacement: true,
          });
        },
      });
    } catch (cause) {
      throw Object.assign(
        replacementProblem ||
          fail(
            "The transaction was sent, but confirmation is still unavailable. Check its status before submitting again.",
            "CONFIRMATION_PENDING",
            { status: "pending", cause },
          ),
        { hash, submittedHash },
      );
    }
    if (replacementProblem)
      throw Object.assign(replacementProblem, { hash, submittedHash });
    if (!receipt || !hashValid(receipt.transactionHash))
      throw fail(
        "The transaction was sent, but its receipt could not be verified. Check its status before retrying.",
        "CONFIRMATION_PENDING",
        { status: "pending", hash, submittedHash },
      );
    hash = receipt.transactionHash;
    if (receipt.status === "reverted")
      throw fail(
        "The transaction was confirmed but reverted. It did not complete the requested action; a network fee may still apply.",
        "TRANSACTION_REVERTED",
        { status: "reverted", hash, submittedHash, receipt },
      );
    if (receipt.status !== "success")
      throw fail(
        "The transaction receipt does not confirm success yet.",
        "CONFIRMATION_PENDING",
        { status: "pending", hash, submittedHash },
      );
    let actual;
    try {
      actual = await publicClient.getTransaction({ hash });
    } catch (cause) {
      throw fail(
        "The transaction has a receipt, but its details could not be verified. Check its status before retrying.",
        "CONFIRMATION_PENDING",
        { status: "pending", hash, submittedHash, receipt, cause },
      );
    }
    if (!transactionMatches(actual, expected))
      throw fail(
        "The confirmed transaction differs from the action you reviewed. Open its transaction details.",
        "TRANSACTION_MISMATCH",
        { status: "replaced", hash, submittedHash, receipt },
      );
    let allowance = null;
    if (action === "approve") {
      try {
        allowance = await publicClient.readContract({
          address: vault.asset,
          abi: tokenAbi,
          functionName: "allowance",
          args: [fresh.owner, vault.address],
        });
      } catch (cause) {
        throw fail(
          "The approval has a receipt, but its allowance could not be checked. Refresh before continuing to deposit.",
          "ALLOWANCE_UNVERIFIED",
          { status: "pending", hash, submittedHash, receipt, cause },
        );
      }
      if (allowance < fresh.rawAmount)
        throw fail(
          "The approval transaction confirmed, but the token allowance is not sufficient. Refresh before continuing to deposit.",
          "APPROVAL_NOT_EFFECTIVE",
          { status: "approval_missing", hash, submittedHash, receipt },
        );
    }
    // Receipt events, when present, provide execution amounts (especially useful
    // for redeem-all); an earlier preview is never labelled as actual proceeds.
    let actualAmount = action === "approve" ? fresh.rawAmount : null;
    let actualShares = null;
    if (action === "submit") {
      for (const log of receipt.logs || []) {
        if (!same(log.address, vault.address)) continue;
        try {
          const event = decodeEventLog({
            abi: vaultAbi,
            data: log.data,
            topics: log.topics,
          });
          if (
            event.eventName ===
              (fresh.kind === "deposit" ? "Deposit" : "Withdraw") &&
            same(event.args.sender, fresh.owner) &&
            same(event.args.owner, fresh.owner) &&
            (fresh.kind === "deposit" || same(event.args.receiver, fresh.owner))
          ) {
            actualAmount = event.args.assets;
            actualShares = event.args.shares;
          }
        } catch {
          /* Ignore unrelated logs, never infer a financial amount. */
        }
      }
    }
    return {
      status: "success",
      action,
      hash,
      submittedHash,
      receipt,
      prepared: fresh,
      allowance,
      actualAmount,
      actualShares,
    };
  }
  return { prepareTransaction, executeTransaction };
}

export const { prepareTransaction, executeTransaction } =
  createTransactionEngine();
