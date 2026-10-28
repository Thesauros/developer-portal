import { parseAbi, decodeEventLog } from "viem";
import { crosschain, sameAddress } from "./crosschain-config.mjs";
import {
  epochAbi,
  verifyCrosschain,
  requestId,
} from "./crosschain-transactions.mjs";
import { vaultClients } from "./vault-rpc.mjs";
import { jsonSafe } from "./vault-reads.mjs";

const epoch =
  "(uint64 openedAt,uint64 closedAt,uint64 openTickId,uint64 depositTickId,uint64 redeemTickId,bool depositsCleared,bool redeemsCleared,bool funded,uint128 openRateBid,uint128 depositAssets,uint128 redeemShares,uint128 rateOffer,uint128 priceRedeem,uint128 sharesMinted,uint128 assetsOwed,uint128 redeemSharesClaimed,uint128 assetsPaid)";
const tick =
  "(uint64 referenceTime,uint64 committedAt,uint64 hubBlock,uint8 status,uint8 flags,uint128 rateBid,uint128 rateOffer,uint128 navBid,uint128 navOffer,bytes32 navHash)";
const readAbi = parseAbi([
  "function currentEpoch() view returns (uint64)",
  `function getEpoch(uint64) view returns (${epoch})`,
  "function epochConfig() view returns ((uint64 minDuration,uint64 maxDuration,uint64 minTicks,uint64 maxClearingDelay))",
]);
const accountantAbi = parseAbi([
  `function latestAccepted() view returns (uint64 tickId,${tick} tick)`,
  "function frozen() view returns (bool)",
  "function quarantined() view returns (bool)",
  "function config() view returns ((uint64 minTickInterval,uint64 maxSnapshotAge,uint64 maxTickAge,uint64 maxTransit,uint128 maxSpread,uint128 depositClearingMaxDown,uint128 maxInFlightRatio,uint128 maxOverdueInFlight))",
]);
const agentAbi = parseAbi([
  "function idle() view returns (uint256)",
  "function strategy() view returns (address)",
  "function strategyShares() view returns (uint256)",
]);
const strategyAbi = parseAbi([
  "function convertToAssets(uint256) view returns (uint256)",
]);
export const requestEvents = parseAbi([
  "event DepositRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 assets)",
  "event RedeemRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 shares)",
]);

export async function readCrosschainVault() {
  const client = vaultClients.base;
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  await verifyCrosschain(client, blockNumber);
  const read = (address, abi, functionName, args) =>
    client.readContract({ address, abi, functionName, args, blockNumber });
  const [current, timing, latest, risk, frozen, quarantined, block] =
    await Promise.all([
      read(crosschain.vault, readAbi, "currentEpoch"),
      read(crosschain.vault, readAbi, "epochConfig"),
      read(crosschain.accountant, accountantAbi, "latestAccepted"),
      read(crosschain.accountant, accountantAbi, "config"),
      read(crosschain.accountant, accountantAbi, "frozen"),
      read(crosschain.accountant, accountantAbi, "quarantined"),
      client.getBlock({ blockNumber }),
    ]);
  const currentEpoch = await read(crosschain.vault, readAbi, "getEpoch", [
    current,
  ]);
  const [tickId, value] = latest;
  return jsonSafe({
    chainId: crosschain.chainId,
    vault: crosschain.vault,
    asset: crosschain.asset,
    profile: crosschain.profile,
    decimals: 6,
    source: "Base RPC",
    blockNumber,
    tick: {
      ...value,
      id: Number(tickId),
      frozen,
      quarantined,
      ageSeconds:
        tickId > 0n ? Number(block.timestamp - value.committedAt) : null,
    },
    risk: { maxTickAge: Number(risk.maxTickAge) },
    epoch: {
      id: Number(current),
      earliestCloseAt: Number(currentEpoch.openedAt + timing.minDuration),
      latestCloseAt: Number(currentEpoch.openedAt + timing.maxDuration),
    },
  });
}
export async function readCrosschainAllocation() {
  const chains = await Promise.all(
    crosschain.networks.map(async (network) => {
      const client =
        network.chainId === 8453 ? vaultClients.base : vaultClients.arbitrum;
      if ((await client.getChainId()) !== network.chainId)
        throw new Error("Wrong allocation RPC network.");
      const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      const read = (functionName) =>
        client.readContract({
          address: network.agent,
          abi: agentAbi,
          functionName,
          blockNumber,
        });
      const [idle, strategy, shares] = await Promise.all([
        read("idle"),
        read("strategy"),
        read("strategyShares"),
      ]);
      if (!sameAddress(strategy, network.strategy))
        throw new Error("The chain agent strategy has changed.");
      const strategyValue = await client.readContract({
        address: strategy,
        abi: strategyAbi,
        functionName: "convertToAssets",
        args: [shares],
        blockNumber,
      });
      return { ...network, idle, strategyValue, blockNumber };
    }),
  );
  // There is no transfer index in the supplied API. Unknown is never reported as zero.
  return jsonSafe({ chains, inFlight: null, source: "Chain RPCs" });
}

export function deriveEpochRequest(request, current, epoch) {
  if (request.status === 0) throw new Error("Request does not exist.");
  const kind = request.kind === 0 ? "deposit" : "redeem";
  let state,
    cancellable = false;
  if (request.status === 2) state = "cancelled";
  else if (request.status === 3) state = "claimed";
  else if (request.epoch === current) {
    state = "pending";
    cancellable = true;
  } else if (kind === "deposit") {
    state = epoch.depositsCleared ? "claimable" : "clearing";
    cancellable = !epoch.depositsCleared;
  } else
    state = !epoch.redeemsCleared
      ? "clearing"
      : epoch.funded
        ? "claimable"
        : "awaiting_liquidity";
  return { ...request, epoch: Number(request.epoch), kind, state, cancellable };
}
export function receiptRequestIds(receipt, owner) {
  return receipt.logs.flatMap((log) => {
    if (!sameAddress(log.address, crosschain.vault)) return [];
    try {
      const event = decodeEventLog({
        abi: requestEvents,
        data: log.data,
        topics: log.topics,
      });
      return sameAddress(event.args.owner, owner) &&
        sameAddress(event.args.receiver, owner)
        ? [event.args.requestId.toString()]
        : [];
    } catch {
      return [];
    }
  });
}
export async function readCrosschainUser(owner, ids = []) {
  const client = vaultClients.base;
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  await verifyCrosschain(client, blockNumber);
  const read = (abi, functionName, args) =>
    client.readContract({
      address: crosschain.vault,
      abi,
      functionName,
      args,
      blockNumber,
    });
  const [shares, current, latest] = await Promise.all([
    read(epochAbi, "balanceOf", [owner]),
    read(readAbi, "currentEpoch"),
    client.readContract({
      address: crosschain.accountant,
      abi: accountantAbi,
      functionName: "latestAccepted",
      blockNumber,
    }),
  ]);
  const requests = await Promise.all(
    ids.map(async (id) => {
      const request = await read(epochAbi, "getRequest", [requestId(id)]);
      if (
        !sameAddress(request.owner, owner) &&
        !sameAddress(request.receiver, owner)
      )
        throw new Error("Request belongs to a different wallet.");
      const epoch = await read(readAbi, "getEpoch", [request.epoch]);
      return { ...deriveEpochRequest(request, current, epoch), id };
    }),
  );
  return jsonSafe({
    address: owner,
    shares,
    valueBid: (shares * latest[1].rateBid) / 10n ** 18n,
    requests,
    historyScope: "Browser-tracked request IDs; verified on chain",
    blockNumber,
  });
}
