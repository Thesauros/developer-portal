import { setTimeout as delay } from "node:timers/promises";
import {
  openCrosschainHistory,
  syncCrosschainHistory,
} from "../lib/crosschain-history.mjs";
import { vaultClients } from "../lib/vault-rpc.mjs";

const store = openCrosschainHistory();
let stopped = false;
const shutdown = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
    shutdown.abort();
  });
try {
  do {
    try {
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
