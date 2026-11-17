import { setTimeout as delay } from "node:timers/promises";
import {
  openCrosschainHistory,
  syncCrosschainHistory,
} from "../lib/crosschain-history.mjs";
import { syncVaultSamples } from "../lib/vault-samples.mjs";
import {
  syncMarketSamples,
  syncQuoteSamples,
  syncReferenceSamples,
} from "../lib/market-index.mjs";
import { vaultClients } from "../lib/vault-rpc.mjs";
import { chainByChainId } from "../lib/chains.mjs";
import { crosschain } from "../lib/crosschain-config.mjs";

const store = openCrosschainHistory();
let stopped = false;
const shutdown = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
    shutdown.abort();
  });
// Share prices of the other vaults run beside the valuation index, never in its
// way: a failed endpoint here must not stop that loop.
let samplesRunning = false,
  samplesAt = 0;
function sampleVaults() {
  if (samplesRunning || Date.now() - samplesAt < 300000) return;
  samplesRunning = true;
  samplesAt = Date.now();
  syncVaultSamples(store, {
    log: (line) => console.error("vault samples:", line),
  })
    .then(() =>
      // The blue-chip index reuses the blocks the vault samples just found.
      syncMarketSamples(store, {
        log: (line) => console.error("market samples:", line),
      }),
    )
    // Quotes three times a day, so a short jump in one never counts.
    .then(() =>
      syncQuoteSamples(store, {
        log: (line) => console.error("market quotes:", line),
      }),
    )
    // Reference lines for the comparison chart, on the same blocks.
    .then(() =>
      syncReferenceSamples(store, {
        log: (line) => console.error("references:", line),
      }),
    )
    .catch((error) => console.error("vault samples:", error.message))
    .finally(() => {
      samplesRunning = false;
    });
}
try {
  do {
    try {
      sampleVaults();
      const coverage = await syncCrosschainHistory(store, vaultClients[chainByChainId(crosschain.chainId).id]);
      console.log(
        `crosschain history: ${coverage.indexedTo}/${coverage.headBlock}, ${coverage.complete ? "current" : "backfilling"}`,
      );
      if (process.argv.includes("--once")) break;
      await delay(coverage.complete ? 30000 : 500, undefined, {
        signal: shutdown.signal,
      }).catch(() => {});
    } catch (error) {
      store.setMeta("error", error.shortMessage || error.message);
      console.error("crosschain history:", error.shortMessage || error.message);
      if (process.argv.includes("--once")) {
        process.exitCode = 1;
        break;
      }
      await delay(10000, undefined, { signal: shutdown.signal }).catch(
        () => {},
      );
    }
  } while (!stopped);
} finally {
  store.close();
}
