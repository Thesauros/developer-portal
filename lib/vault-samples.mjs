// Daily share price and size of each standard vault, and the Aave reserve index
// on the same block, read from the chain by the indexer process and never on a
// request. One row a day with the block's own timestamp; nothing is interpolated
// and a day that cannot be read stays missing. Today's row is overwritten until
// the day ends, so it also serves as the latest reading.
import { createPublicClient, fallback, http, parseAbi } from "viem";
import { SOURCES } from "./vault-events.mjs";
import { readAllocation } from "./vault-reads.mjs";
import { providerName } from "./insights.mjs";
import { DAY } from "./vault-metrics.mjs";

const vaultAbi = parseAbi([
  "function convertToAssets(uint256) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
const aaveAbi = parseAbi([
  "function getReserveNormalizedIncome(address) view returns (uint256)",
]);
const ONE_SHARE = 10n ** 12n;
// Archive reads need different public endpoints than log scans. Monad and Plasma
// vaults hold Aave only, so they carry no separate benchmark.
const TARGETS = {
  arbitrum: {
    rpcs: [
      "https://arbitrum-one.public.blastapi.io",
      "https://arb1.arbitrum.io/rpc",
    ],
    blockSeconds: 0.25,
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  },
  base: {
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    blockSeconds: 2,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  },
  monad: { rpcs: ["https://rpc1.monad.xyz"], blockSeconds: 0.4 },
  plasma: { rpcs: ["https://rpc.plasma.to"], blockSeconds: 1 },
};
const clients = {};
const clientFor = (id) =>
  (clients[id] ??= createPublicClient({
    transport: fallback(
      TARGETS[id].rpcs.map((url) =>
        http(url, { timeout: 15000, retryCount: 2, retryDelay: 1500 }),
      ),
    ),
  }));

// The block closest to a moment, within ten minutes. Interpolates, then narrows.
export async function blockNear(getTimestamp, target, low, high, blockSeconds) {
  let lo = low,
    hi = high;
  let guess =
    high - BigInt(Math.round((Number(await getTimestamp(high)) - target) / blockSeconds));
  for (let step = 0; step < 24; step++) {
    if (guess < lo) guess = lo;
    if (guess > hi) guess = hi;
    const ts = Number(await getTimestamp(guess));
    if (Math.abs(ts - target) <= 600) return { block: guess, ts };
    if (ts < target) lo = guess + 1n;
    else hi = guess - 1n;
    if (lo > hi) return { block: guess, ts };
    const next = guess + BigInt(Math.round((target - ts) / blockSeconds));
    guess = next > lo && next < hi ? next : lo + (hi - lo) / 2n;
  }
  return null;
}

async function sampleAt(client, id, block) {
  const { address } = SOURCES[id];
  const target = TARGETS[id];
  const read = (functionName, args) =>
    client.readContract({
      address,
      abi: vaultAbi,
      functionName,
      args,
      blockNumber: block,
    });
  const [price, totalAssets, totalSupply, index] = await Promise.all([
    read("convertToAssets", [ONE_SHARE]),
    read("totalAssets"),
    read("totalSupply"),
    target.aavePool
      ? client
          .readContract({
            address: target.aavePool,
            abi: aaveAbi,
            functionName: "getReserveNormalizedIncome",
            args: [target.asset],
            blockNumber: block,
          })
          .catch(() => null)
      : null,
  ]);
  // Where the money was on this block. A failed read leaves the day without one.
  const allocation = await readAllocation(client, id, block)
    .then(({ providers, complete }) =>
      complete
        ? JSON.stringify(
            providers
              .filter((row) => row.assets > 0n)
              .map((row) => ({
                name:
                  providerName(row.address) ||
                  String(row.name)
                    .replace(/_Provider$/, "")
                    .replace(/_/g, " "),
                amount: Number(row.assets) / 1e6,
              })),
          )
        : null,
    )
    .catch(() => null);
  return { price, totalAssets, totalSupply, index, allocation };
}

// Reads what is missing and stops at `limit` days for each vault, so one slow
// endpoint cannot hold up the valuation index running in the same process.
export async function syncVaultSamples(store, { limit = 12, log = () => {} } = {}) {
  const insert = store.db.prepare(
    "INSERT OR REPLACE INTO vault_samples(vault,day,block,at,price,total_assets,total_supply,reserve_index,allocation) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  const existing = store.db.prepare(
    "SELECT day,block,at FROM vault_samples WHERE vault=?",
  );
  const complete = store.db.prepare(
    "SELECT day FROM vault_samples WHERE vault=? AND allocation IS NOT NULL",
  );
  const today = Math.floor(Date.now() / DAY);
  await Promise.all(
    Object.keys(TARGETS).map(async (id) => {
      const client = clientFor(id);
      try {
        const head = await client.getBlockNumber({ cacheTime: 0 });
        const headBlock = await client.getBlock({ blockNumber: head });
        const save = (day, block, ts, sample) =>
          insert.run(
            id,
            day,
            Number(block),
            ts * 1000,
            sample.price.toString(),
            sample.totalAssets.toString(),
            sample.totalSupply.toString(),
            sample.index == null ? null : sample.index.toString(),
            sample.allocation ?? null,
          );
        save(
          today,
          head,
          Number(headBlock.timestamp),
          await sampleAt(client, id, head),
        );
        const known = new Set(complete.all(id).map((row) => row.day));
        // A day read before allocation was added keeps its block: no search again.
        const located = new Map(existing.all(id).map((row) => [row.day, row]));
        const first = await client.getBlock({
          blockNumber: SOURCES[id].start,
        });
        const firstDay = Math.ceil((Number(first.timestamp) * 1000) / DAY);
        const stamps = new Map();
        const getTimestamp = async (blockNumber) => {
          const key = String(blockNumber);
          if (!stamps.has(key))
            stamps.set(
              key,
              (await client.getBlock({ blockNumber })).timestamp,
            );
          return stamps.get(key);
        };
        let done = 0;
        for (let day = today - 1; day >= firstDay && done < limit; day--) {
          if (known.has(day)) continue;
          done += 1;
          try {
            const seen = located.get(day);
            const found = seen
              ? { block: BigInt(seen.block), ts: seen.at / 1000 }
              : await blockNear(
                  getTimestamp,
                  (day * DAY) / 1000,
                  SOURCES[id].start,
                  head,
                  TARGETS[id].blockSeconds,
                );
            if (!found) continue;
            save(day, found.block, found.ts, await sampleAt(client, id, found.block));
          } catch (error) {
            log(`${id} day ${day}: ${error.shortMessage || error.message}`);
          }
        }
      } catch (error) {
        log(`${id}: ${error.shortMessage || error.message}`);
      }
    }),
  );
}

export function readVaultSamples(store) {
  const out = {};
  for (const row of store.db
    .prepare("SELECT * FROM vault_samples ORDER BY vault,at")
    .all()) {
    (out[row.vault] ||= []).push({
      at: row.at,
      block: row.block,
      price: Number(row.price) / 1e12,
      tvl: Number(row.total_assets) / 1e6,
      index: row.reserve_index == null ? null : Number(row.reserve_index) / 1e27,
      allocation: row.allocation ? JSON.parse(row.allocation) : null,
    });
  }
  return out;
}
