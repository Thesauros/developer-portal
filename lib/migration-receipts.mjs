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
    !same(tx.from, owner) ||
    !same(receipt.from, owner) ||
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
