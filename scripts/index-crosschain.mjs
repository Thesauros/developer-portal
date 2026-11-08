import { setTimeout as delay } from "node:timers/promises";
import {
  openCrosschainHistory,
  syncCrosschainHistory,
} from "../lib/crosschain-history.mjs";
import { syncVaultSamples } from "../lib/vault-samples.mjs";
import { syncMarketSamples } from "../lib/market-index.mjs";
import { vaultClients } from "../lib/vault-rpc.mjs";

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
    .catch((error) => console.error("vault samples:", error.message))
    .finally(() => {
      samplesRunning = false;
    });
}
try {
  do {
    try {
      sampleVaults();
      const coverage = await syncCrosschainHistory(store, vaultClients.base);
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
