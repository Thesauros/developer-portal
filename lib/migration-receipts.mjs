import {
  decodeFunctionData,
  encodeFunctionData,
  decodeEventLog,
  parseAbi,
} from "viem";
import { tokenAbi } from "./vault-contracts.mjs";
import { epochAbi } from "./crosschain-transactions.mjs";
import { requestEvents } from "./crosschain-reads.mjs";
import { migrationHash } from "./migration-state.mjs";

const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const actionAbi = parseAbi([
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event DepositClaimed(uint256 indexed requestId,address indexed receiver,uint256 shares)",
  "event RedeemClaimed(uint256 indexed requestId,address indexed receiver,uint256 assets)",
]);
const invalid = (message) =>
  Object.assign(new Error(message), { userFacing: true });

// A relay's envelope identifies its sponsor, not the wallet's contract call.
// Only the configured contracts' own events can prove the requested effect.
function confirmRelayedOperation(receipt, destination, owner, hash, intent) {
  if (receipt.status !== "success")
    throw invalid(
      "The relayed transaction did not confirm this step. Check its result in your wallet.",
    );
  let expected;
  if (intent) {
    if (!migrationHash(intent.hash) || !same(intent.hash, hash))
      throw invalid(
        "A relayed transaction must match the saved transaction hash. Check the original transaction in your wallet.",
      );
    const token = intent.kind === "approve";
    const address = token ? destination.asset : destination.address;
    const abi = token ? tokenAbi : epochAbi;
    try {
      const call = decodeFunctionData({ abi, data: intent.data });
      const method = {
        approve: "approve",
        deposit: "requestDeposit",
        claim: "claim",
      }[intent.kind];
      if (
        !method ||
        call.functionName !== method ||
        !same(intent.address, address) ||
        !same(encodeFunctionData({ abi, ...call }), intent.data) ||
        (intent.chainId != null && intent.chainId !== destination.chainId) ||
        (token && !same(call.args[0], destination.address)) ||
        (intent.kind === "deposit" && !same(call.args[1], owner))
      )
        throw new Error();
      expected = { kind: intent.kind, args: call.args };
    } catch {
      throw invalid(
        "The saved operation does not match this vault, asset or receiver.",
      );
    }
  }
  const deposits = [],
    transfers = [],
    approvals = [],
    claims = [];
  for (const log of receipt.logs || []) {
    if (
      log.removed ||
      (log.transactionHash && !same(log.transactionHash, hash)) ||
      (log.blockHash && !same(log.blockHash, receipt.blockHash)) ||
      (log.blockNumber != null && log.blockNumber !== receipt.blockNumber)
    )
      continue;
    try {
      if (same(log.address, destination.address)) {
        try {
          const event = decodeEventLog({
            abi: requestEvents,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (
            event.eventName === "DepositRequested" &&
            same(event.args.owner, owner) &&
            same(event.args.receiver, owner)
          )
            deposits.push(event.args);
        } catch {
          /* A claim has another event signature. */
        }
        try {
          const event = decodeEventLog({
            abi: actionAbi,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (
            ["DepositClaimed", "RedeemClaimed"].includes(event.eventName) &&
            same(event.args.receiver, owner)
          )
            claims.push(event.args);
        } catch {
          /* A deposit request has another event signature. */
        }
      } else if (same(log.address, destination.asset)) {
        try {
          const event = decodeEventLog({
            abi: transferAbi,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (
            same(event.args.from, owner) &&
            same(event.args.to, destination.address)
          )
            transfers.push(event.args.value);
        } catch {
          /* An approval has another event signature. */
        }
        try {
          const event = decodeEventLog({
            abi: actionAbi,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (
            event.eventName === "Approval" &&
            same(event.args.owner, owner) &&
            same(event.args.spender, destination.address)
          )
            approvals.push(event.args.value);
        } catch {
          /* A transfer has another event signature. */
        }
      }
    } catch {
      /* Unrelated logs never prove this wallet's action. */
    }
  }
  // Historical move deposits retain only their hash. Rebuild their identity
  // from the unique vault request and actual USDC transfer on every reload.
  if (!expected) {
    if (deposits.length !== 1)
      throw invalid(
        "The receipt does not identify one deposit for this wallet in the new vault.",
      );
    expected = { kind: "deposit", args: [deposits[0].assets, owner] };
  }
  if (expected.kind === "approve") {
    if (approvals.filter((value) => value === expected.args[1]).length !== 1)
      throw invalid(
        "The receipt does not confirm the expected USDC approval recipient and amount.",
      );
    return { kind: "approve", hash, amount: expected.args[1] };
  }
  if (expected.kind === "claim") {
    if (
      claims.filter((claim) => claim.requestId === expected.args[0]).length !==
      1
    )
      throw invalid(
        "The receipt does not confirm that this wallet collected the saved request.",
      );
    return { kind: "claim", hash, requestId: expected.args[0].toString() };
  }
  const amount = expected.args[0];
  if (
    amount <= 0n ||
    deposits.length !== 1 ||
    transfers.length !== 1 ||
    deposits[0].assets !== amount ||
    transfers[0] !== amount
  )
    throw invalid(
      "The receipt does not confirm that the expected USDC reached the new vault.",
    );
  return {
    kind: "deposit",
    hash,
    requestId: deposits[0].requestId.toString(),
    amount,
  };
}

/** The destination is supplied explicitly; there is no legacy→new product mapping here. */
export async function confirmMigrationOperation(
  client,
  destination,
  owner,
  hash,
  intent = null,
) {
  if (!migrationHash(hash)) throw new Error("Enter a valid transaction hash.");
  const [chainId, tx, receipt, head] = await Promise.all([
    client.getChainId(),
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
    client.getBlockNumber({ cacheTime: 0 }),
  ]);
  if (
    chainId !== 8453 ||
    destination.chainId !== 8453 ||
    !same(tx.hash, hash) ||
    !same(receipt.transactionHash, hash) ||
    !same(tx.from, receipt.from) ||
    !same(tx.to, receipt.to) ||
    tx.value !== 0n ||
    tx.blockNumber !== receipt.blockNumber ||
    typeof receipt.blockNumber !== "bigint" ||
    receipt.blockNumber < 0n ||
    typeof head !== "bigint" ||
    head < receipt.blockNumber ||
    (receipt.blockHash && !same(tx.blockHash, receipt.blockHash)) ||
    (tx.chainId != null && Number(tx.chainId) !== 8453)
  )
    throw new Error("The transaction does not match this wallet on Base.");
  if (!["success", "reverted"].includes(receipt.status))
    throw new Error("The transaction is not confirmed yet.");
  const expectedPayload =
    intent && same(tx.input, intent.data) && same(tx.to, intent.address);
  const relay =
    !same(tx.from, owner) ||
    (!same(tx.to, destination.asset) && !same(tx.to, destination.address)) ||
    (intent &&
      !expectedPayload &&
      same(intent.hash, hash) &&
      tx.input !== "0x");
  if (relay) {
    // A direct same-nonce cancellation has no effects to attribute to a relay.
    // Keep that path below; every relayed success must prove its actual effect.
    if (!(intent && same(tx.from, owner) && tx.input === "0x")) {
      try {
        return confirmRelayedOperation(
          receipt,
          destination,
          owner,
          hash,
          intent,
        );
      } catch (error) {
        // A direct same-nonce replacement may call another method. It proves
        // no deposit; the settlement layer must additionally bind the original
        // direct transaction before clearing a pending operation.
        if (!(intent && same(tx.from, owner) && tx.nonce === intent.nonce))
          throw error;
      }
    }
  }
  // A matching payload with a different nonce is another operation, not a
  // replacement. Clearing the original here could allow it to execute twice.
  if (intent?.nonce != null && tx.nonce !== intent.nonce)
    throw new Error(
      "This transaction uses a different nonce and cannot replace the saved operation.",
    );
  if (
    intent &&
    (!same(tx.input, intent.data) || !same(tx.to, intent.address))
  ) {
    if (intent.nonce != null && tx.nonce === intent.nonce)
      return { cancelled: true, hash };
    throw new Error("The transaction does not match the saved operation.");
  }
  if (receipt.status === "reverted") return { reverted: true, hash };
  const token = same(tx.to, destination.asset);
  if (!token && !same(tx.to, destination.address))
    throw new Error(
      "The contract address does not match the selected product.",
    );
  const abi = token ? tokenAbi : epochAbi;
  const decoded = decodeFunctionData({ abi, data: tx.input });
  if (!same(encodeFunctionData({ abi, ...decoded }), tx.input))
    throw new Error("The transaction data could not be verified.");
  const { functionName, args } = decoded;
  if (token) {
    if (functionName !== "approve" || !same(args[0], destination.address))
      throw new Error("The USDC approval recipient does not match the vault.");
    return { kind: "approve", hash, amount: args[1] };
  }
  if (functionName === "claim")
    return { kind: "claim", hash, requestId: args[0].toString() };
  if (functionName !== "requestDeposit" || !same(args[1], owner))
    throw new Error("The deposit receiver does not match your wallet.");
  const events = [];
  const transfers = [];
  for (const log of receipt.logs || []) {
    if (
      log.removed ||
      (log.transactionHash && !same(log.transactionHash, hash))
    )
      continue;
    try {
      if (same(log.address, destination.address)) {
        const event = decodeEventLog({
          abi: requestEvents,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (
          event.eventName === "DepositRequested" &&
          same(event.args.owner, owner) &&
          same(event.args.receiver, owner)
        )
          events.push(event.args);
      } else if (same(log.address, destination.asset)) {
        const event = decodeEventLog({
          abi: transferAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (
          same(event.args.from, owner) &&
          same(event.args.to, destination.address)
        )
          transfers.push(event.args.value);
      }
    } catch {
      /* Unrelated events cannot establish a deposit. */
    }
  }
  if (
    args[0] <= 0n ||
    events.length !== 1 ||
    transfers.length !== 1 ||
    events[0].assets !== args[0] ||
    transfers[0] !== args[0]
  )
    throw new Error(
      "The receipt does not confirm that USDC reached the new vault.",
    );
  return {
    kind: "deposit",
    hash,
    requestId: events[0].requestId.toString(),
    amount: args[0],
  };
}
