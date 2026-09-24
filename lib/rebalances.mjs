// Rebalance history read from the vault contracts. The data service only
// exposes the latest rebalance and the monitor keeps a handful of recent
// events without amounts, so the full list comes from RebalanceExecuted logs.
// Scans are incremental and persisted: the first run backfills from the
// deployment block, later runs read only new blocks.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cacheDirectory } from "./cache-directory.mjs";
import { createPublicClient, fallback, http, parseAbiItem } from "viem";
import { arbitrum, base } from "viem/chains";

const events = [
  parseAbiItem(
    "event RebalanceExecuted(uint256 assetsFrom, uint256 assetsTo, address indexed from, address indexed to)",
  ),
  parseAbiItem(
    "event RebalanceExecuted(uint256 assets, address indexed from, address indexed to)",
  ),
];

// Deployment blocks from bastardgreeks.thesauros.io/deployments. `span` is the
// widest getLogs range the public RPCs accept.
const SOURCES = {
  arbitrum: {
    chain: arbitrum,
    address: "0x4E5c0A4C11d713002D74bA43a458efc31bc76378",
    start: 491503900n,
    span: 5_000_000n,
    parallel: 1,
    rpcs: ["https://arb1.arbitrum.io/rpc"],
  },
  base: {
    chain: base,
    address: "0x3C7739173cca612B6394EE57131458185A5beC44",
    start: 49576041n,
    span: 2_000n,
    parallel: 6,
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  },
};

const dir = cacheDirectory;
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = (id) => resolve(dir, "rebalances-" + id + ".json");
const states = (globalThis.__thesaurosRebalances ??= new Map());
const running = (globalThis.__thesaurosRebalanceScans ??= new Map());

function load(id) {
  if (states.has(id)) return states.get(id);
  let state = { scannedTo: null, events: [], checkedAt: 0 };
  try {
    state = JSON.parse(readFileSync(file(id), "utf8"));
  } catch {}
  states.set(id, state);
  return state;
}
function save(id, state) {
  writeFileSync(file(id) + ".tmp", JSON.stringify(state), { mode: 0o600 });
  renameSync(file(id) + ".tmp", file(id));
}

async function scan(id) {
  const source = SOURCES[id];
  const client = createPublicClient({
    chain: source.chain,
    transport: fallback(
      source.rpcs.map((url) => http(url, { timeout: 20000, retryCount: 1 })),
    ),
  });
  const state = load(id);
  const head = await client.getBlockNumber();
  let from =
    state.scannedTo == null ? source.start : BigInt(state.scannedTo) + 1n;
  let chunks = 0;
  while (from <= head) {
    const windows = [];
    for (let i = 0; i < source.parallel && from <= head; i++) {
      const to =
        from + source.span - 1n > head ? head : from + source.span - 1n;
      windows.push([from, to]);
      from = to + 1n;
    }
    const results = await Promise.all(
      windows.map(([fromBlock, toBlock]) =>
        client.getLogs({ address: source.address, events, fromBlock, toBlock }),
      ),
    );
    for (const log of results.flat()) {
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      state.events.push({
        block: Number(log.blockNumber),
        at: Number(block.timestamp) * 1000,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        from: log.args.from,
        to: log.args.to,
        amount: Number(log.args.assetsFrom ?? log.args.assets) / 1e6,
      });
    }
    state.scannedTo = windows.at(-1)[1].toString();
    if (++chunks % 25 === 0) save(id, state);
  }
  state.checkedAt = Date.now();
  save(id, state);
}

// Returns what is known now and refreshes in the background when stale.
export function rebalanceHistory(id, maxAge = 120000) {
  if (!SOURCES[id]) return null;
  const state = load(id);
  if (Date.now() - state.checkedAt > maxAge && !running.has(id)) {
    const job = scan(id)
      .catch(() => {})
      .finally(() => running.delete(id));
    running.set(id, job);
  }
  const complete = state.checkedAt > 0;
  return {
    complete,
    events: [...state.events].sort((a, b) => b.at - a.at),
  };
}
