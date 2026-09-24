// Vault event history read from the contracts: deposits, withdrawals and
// rebalances for all four vaults. The data service returns an empty per-user
// history for some wallets and its daily earnings count unindexed deposits as
// yield, so balances, earnings and statements are built from these logs.
// Scans are incremental and cached; the first run backfills in the background.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  fallback,
  http,
  parseAbi,
  parseAbiItem,
} from "viem";

const EVENTS = [
  parseAbiItem(
    "event RebalanceExecuted(uint256 assetsFrom, uint256 assetsTo, address indexed from, address indexed to)",
  ),
  parseAbiItem(
    "event RebalanceExecuted(uint256 assets, address indexed from, address indexed to)",
  ),
  parseAbiItem(
    "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  ),
  parseAbiItem(
    "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  ),
];
const VAULT_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
]);

// Deployment blocks from bastardgreeks.thesauros.io/deployments. `span` is the
// widest getLogs range the public RPCs accept.
export const SOURCES = {
  arbitrum: {
    address: "0x4E5c0A4C11d713002D74bA43a458efc31bc76378",
    start: 491503900n,
    span: 5_000_000n,
    parallel: 1,
    decimals: 6,
    rpcs: [
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum-one-rpc.publicnode.com",
    ],
  },
  base: {
    address: "0x3C7739173cca612B6394EE57131458185A5beC44",
    start: 49576041n,
    span: 2_000n,
    parallel: 6,
    decimals: 6,
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  },
  monad: {
    address: "0x40F1fBf6a92155a6D321c09936234BFEb9Ec4760",
    start: 93601297n,
    span: 1_000_000n,
    parallel: 1,
    decimals: 6,
    rpcs: ["https://rpc1.monad.xyz"],
  },
  plasma: {
    address: "0x2Ed9B7fB6Bbe0920145B2a79c18C3f7cFCAE3C99",
    start: 29065973n,
    span: 10_000n,
    parallel: 4,
    decimals: 6,
    rpcs: ["https://rpc.plasma.to"],
  },
};

const clients = (globalThis.__thesaurosEventClients ??= {});
function client(id) {
  return (clients[id] ??= createPublicClient({
    transport: fallback(
      SOURCES[id].rpcs.map((url) =>
        http(url, { timeout: 20000, retryCount: 1 }),
      ),
    ),
  }));
}

const dir = resolve(process.cwd(), "../private-state/live-cache");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = (id) => resolve(dir, "vault-events-" + id + ".json");
const states = (globalThis.__thesaurosVaultEvents ??= new Map());
const running = (globalThis.__thesaurosVaultEventScans ??= new Map());

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
  const c = client(id);
  const state = load(id);
  const head = await c.getBlockNumber();
  let from =
    state.scannedTo == null ? source.start : BigInt(state.scannedTo) + 1n;
  const unit = 10 ** source.decimals;
  const times = new Map();
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
        c.getLogs({
          address: source.address,
          events: EVENTS,
          fromBlock,
          toBlock,
        }),
      ),
    );
    for (const log of results.flat()) {
      const key = log.blockNumber.toString();
      if (!times.has(key))
        times.set(
          key,
          Number(
            (await c.getBlock({ blockNumber: log.blockNumber })).timestamp,
          ) * 1000,
        );
      const base = {
        block: Number(log.blockNumber),
        at: times.get(key),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
      };
      const a = log.args;
      if (log.eventName === "RebalanceExecuted")
        state.events.push({
          ...base,
          kind: "rebalance",
          from: a.from,
          to: a.to,
          amount: Number(a.assetsFrom ?? a.assets) / unit,
        });
      else if (log.eventName === "Deposit")
        state.events.push({
          ...base,
          kind: "deposit",
          owner: a.owner.toLowerCase(),
          amount: Number(a.assets) / unit,
        });
      else if (log.eventName === "Withdraw")
        state.events.push({
          ...base,
          kind: "withdraw",
          owner: a.owner.toLowerCase(),
          amount: Number(a.assets) / unit,
        });
    }
    state.scannedTo = windows.at(-1)[1].toString();
    if (++chunks % 25 === 0) save(id, state);
  }
  state.checkedAt = Date.now();
  save(id, state);
}

// What is known now; refreshes in the background when stale.
export function vaultEvents(id, maxAge = 120000) {
  if (!SOURCES[id]) return null;
  const state = load(id);
  if (Date.now() - state.checkedAt > maxAge && !running.has(id)) {
    const job = scan(id)
      .catch(() => {})
      .finally(() => running.delete(id));
    running.set(id, job);
  }
  return {
    complete: state.checkedAt > 0,
    events: [...state.events].sort((a, b) => b.at - a.at),
  };
}

export function rebalanceHistory(id) {
  const all = vaultEvents(id);
  return (
    all && {
      complete: all.complete,
      events: all.events.filter((e) => e.kind === "rebalance"),
    }
  );
}

// Current position value in the vault's asset.
export async function positionValue(id, owner) {
  const source = SOURCES[id];
  const c = client(id);
  const shares = await c.readContract({
    address: source.address,
    abi: VAULT_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  if (shares === 0n) return 0;
  const assets = await c.readContract({
    address: source.address,
    abi: VAULT_ABI,
    functionName: "convertToAssets",
    args: [shares],
  });
  return Number(assets) / 10 ** source.decimals;
}
