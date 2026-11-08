// The rate each market quoted to the vault on the block just before a move,
// read from the provider contracts. The past does not change, so every reading
// is kept on disk and taken once.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAbi } from "viem";
import { cacheDirectory } from "./cache-directory.mjs";
import { archiveClient } from "./vault-samples.mjs";
import { SOURCES } from "./vault-events.mjs";

const abi = parseAbi(["function getDepositRate(address) view returns (uint256)"]);
const file = resolve(cacheDirectory, "move-rates-v1.json");
const memory = (globalThis.__thesaurosMoveRates ??= { loaded: false, rates: {} });

function load() {
  if (memory.loaded) return;
  try {
    memory.rates = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  memory.loaded = true;
}
function save() {
  writeFileSync(file + ".tmp", JSON.stringify(memory.rates), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

const key = (vaultId, event) => `${vaultId}:${event.txHash}:${event.logIndex}`;

/** Rates for moves already read, without reading anything. */
export function knownMoveRates(vaultId, event) {
  load();
  return memory.rates[key(vaultId, event)] || null;
}

/** Reads up to `limit` moves that have no reading yet. */
export async function readMoveRates(vaultId, events, { limit = 40 } = {}) {
  load();
  const source = SOURCES[vaultId];
  if (!source) return;
  const client = archiveClient(vaultId);
  let done = 0,
    changed = false;
  for (const event of events) {
    if (done >= limit) break;
    const id = key(vaultId, event);
    if (memory.rates[id] || !event.block || !event.from || !event.to) continue;
    done += 1;
    const blockNumber = BigInt(event.block) - 1n;
    const read = (provider) =>
      client
        .readContract({
          address: provider,
          abi,
          functionName: "getDepositRate",
          args: [source.address],
          blockNumber,
        })
        .then((ray) => Number(ray) / 1e25)
        .catch(() => null);
    const [from, to] = await Promise.all([read(event.from), read(event.to)]);
    if (from == null || to == null) continue;
    memory.rates[id] = { from, to, block: event.block };
    changed = true;
  }
  if (changed) save();
}
