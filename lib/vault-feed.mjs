// One public record of what happened across all vaults: money moved between
// markets and networks, batches settled, valuations missed. No wallet appears here.
import {
  openCrosschainHistory,
  readAcceptedTicks,
  readBatchRequests,
} from "./crosschain-history.mjs";
import { readBatchDetails } from "./crosschain-reads.mjs";
import { readCrosschainMoves } from "./crosschain-api.mjs";
import { marketInsights } from "./insights.mjs";
import { BATCH_VAULT_ID } from "./vault-facts.mjs";
import { valuationGaps } from "./vault-metrics.mjs";
import { readVaultSamples } from "./vault-samples.mjs";

const strip = (name) => String(name || "").replace(/ Morpho$/, "");

export function readHistoryBundle() {
  const store = openCrosschainHistory();
  try {
    return {
      ticks: readAcceptedTicks(store),
      samples: readVaultSamples(store),
      batches: readBatchRequests(store),
    };
  } finally {
    store.close();
  }
}

export async function publicFeed() {
  const items = [];
  const sources = {};
  const [bundle, market, moves] = await Promise.allSettled([
    Promise.resolve().then(readHistoryBundle),
    marketInsights("30d"),
    readCrosschainMoves(),
  ]);
  sources.valuations = bundle.status === "fulfilled";
  sources.markets = market.status === "fulfilled";
  sources.transfers = moves.status === "fulfilled";
  if (market.status === "fulfilled") {
    sources.rebalances = {};
    for (const vault of market.value.vaults) {
      sources.rebalances[vault.id] = !!vault.rebalanceHistoryComplete;
      for (const event of vault.rebalances || [])
        items.push({
          id: event.txHash + ":" + event.logIndex,
          kind: "rebalance",
          at: event.at,
          vaultId: vault.id,
          amount: event.amount,
          token: vault.token,
          fromName: strip(event.fromName) || "A market",
          toName: strip(event.toName) || "another market",
          url: vault.explorer + "/tx/" + event.txHash,
        });
    }
  }
  if (moves.status === "fulfilled")
    for (const move of moves.value?.moves || [])
      items.push({
        id: "move:" + move.id,
        kind: "transfer",
        at: move.sentAt,
        arrivedAt: move.receivedAt ?? null,
        vaultId: BATCH_VAULT_ID,
        amount: Number(move.amount) / 1e6,
        token: "USDC",
        fromName: move.from,
        toName: move.to,
        url: move.tx ? move.explorer + "/tx/" + move.tx : null,
      });
  if (bundle.status === "fulfilled") {
    for (const gap of valuationGaps(bundle.value.ticks).gaps)
      items.push({
        id: "gap:" + gap.from,
        kind: "gap",
        at: gap.from,
        until: gap.to,
        hours: gap.hours,
        vaultId: BATCH_VAULT_ID,
      });
    const batches = await readBatchDetails(bundle.value.batches).catch(() => []);
    for (const batch of batches)
      items.push({
        id: "batch:" + batch.epoch,
        kind: "batch",
        at: batch.closedAt || batch.firstAt,
        settled: batch.settled,
        requests: batch.requests,
        deposits: Number(batch.deposits) / 1e6,
        redeems: Number(batch.redeems) / 1e6,
        vaultId: BATCH_VAULT_ID,
        token: "USDC",
      });
  }
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { items, sources, updatedAt: Date.now() };
}
