// Daily readings of every lending market a Thesauros vault may use, for the
// blue-chip index (lib/blue-chip-index.mjs). Everything is read from contracts:
// each vault and each strategy of the batch vault lists its providers
// (getProviders), each provider names the market behind it (getSource), and the
// market reports its own size and interest index. No outside data service.
import { parseAbi } from "viem";
import { vaults } from "./vault-contracts.mjs";
import { crosschain } from "./crosschain-config.mjs";
import { CHAINS, chainByChainId } from "./chains.mjs";
import { BATCH_VAULT_ID } from "./vault-facts.mjs";
import { archiveClient, blockNear } from "./vault-samples.mjs";
import { DAY } from "./vault-metrics.mjs";

export const marketAbi = parseAbi([
  "function getProviders() view returns (address[])",
  "function asset() view returns (address)",
  "function getSource(address,address,address) view returns (address)",
  "function getDepositRate(address) view returns (uint256)",
  "function getDepositBalance(address,address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function baseToken() view returns (address)",
  "function MORPHO() view returns (address)",
  "function adaptersLength() view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function getReserveNormalizedIncome(address) view returns (uint256)",
  "function getReserveData(address) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))",
  "function totalsBasic() view returns ((uint64 baseSupplyIndex,uint64 baseBorrowIndex,uint64 trackingSupplyIndex,uint64 trackingBorrowIndex,uint104 totalSupplyBase,uint104 totalBorrowBase,uint40 lastAccrualTime,uint8 pauseFlags))",
]);
const HISTORY_DAYS = 95;

// Who may lend where: every standard vault and every strategy of the batch vault.
export function indexHolders() {
  const holders = vaults.map((vault) => ({
    network: vault.network,
    address: vault.address,
    vault: vault.id,
  }));
  for (const network of crosschain.networks) {
    const chain = chainByChainId(network.chainId);
    if (chain && network.strategy)
      holders.push({
        network: chain.id,
        address: network.strategy,
        vault: BATCH_VAULT_ID,
      });
  }
  return holders;
}

const cleanName = (name) =>
  String(name || "")
    .replace(/\b(USDC|USDT0|USDT|USD₮0)\b/g, "")
    .replace(/\bv\d+(\.\d+)*\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

// What kind of market an address is, decided once from what it answers.
const kinds = new Map();
export async function describe(client, network, source, asset) {
  const key = network + ":" + source.toLowerCase();
  if (kinds.has(key)) return kinds.get(key);
  const read = (address, functionName, args = []) =>
    client.readContract({ address, abi: marketAbi, functionName, args });
  let info = null;
  try {
    await read(source, "totalAssets");
    const [shareDecimals, name] = await Promise.all([
      read(source, "decimals"),
      read(source, "name"),
    ]);
    const morpho =
      (await read(source, "MORPHO").then(() => true, () => false)) ||
      (await read(source, "adaptersLength").then(() => true, () => false));
    const protocol = morpho ? "Morpho" : /fluid/i.test(name) ? "Fluid" : "Vault";
    info = {
      kind: "erc4626",
      protocol,
      name: cleanName(name) || name,
      shareDecimals: Number(shareDecimals),
    };
  } catch {}
  if (!info)
    try {
      const reserve = await read(source, "getReserveData", [asset]);
      info = {
        kind: "aave",
        protocol: "Aave",
        name: "Aave V3",
        aToken: reserve.aTokenAddress,
      };
    } catch {}
  if (!info)
    try {
      await read(source, "baseToken");
      info = { kind: "comet", protocol: "Compound", name: "Compound V3" };
    } catch {}
  if (info) {
    const [symbol, decimals] = await Promise.all([
      read(asset, "symbol"),
      read(asset, "decimals"),
    ]);
    info = { ...info, asset, symbol, decimals: Number(decimals) };
    kinds.set(key, info);
  }
  return info;
}

// Interest index and size of one market on one block.
async function readMarket(client, source, info, block) {
  const read = (address, functionName, args = []) =>
    client.readContract({ address, abi: marketAbi, functionName, args, blockNumber: block });
  if (info.kind === "erc4626") {
    const [idx, tvl] = await Promise.all([
      read(source, "convertToAssets", [10n ** BigInt(info.shareDecimals)]),
      read(source, "totalAssets"),
    ]);
    return { idx: Number(idx) / 10 ** info.decimals, tvl: Number(tvl) / 10 ** info.decimals };
  }
  if (info.kind === "aave") {
    const [idx, tvl] = await Promise.all([
      read(source, "getReserveNormalizedIncome", [info.asset]),
      read(info.aToken, "totalSupply"),
    ]);
    return { idx: Number(idx) / 1e27, tvl: Number(tvl) / 10 ** info.decimals };
  }
  const [totals, tvl] = await Promise.all([
    read(source, "totalsBasic"),
    read(source, "totalSupply"),
  ]);
  return {
    idx: Number(totals.baseSupplyIndex) / 1e15,
    tvl: Number(tvl) / 10 ** info.decimals,
  };
}

// Every approved market of every holder on one network, on one block.
async function readNetworkDay(client, network, holders, block) {
  const markets = new Map();
  for (const holder of holders) {
    let providers;
    try {
      providers = await client.readContract({
        address: holder.address,
        abi: marketAbi,
        functionName: "getProviders",
        blockNumber: block,
      });
    } catch {
      continue; // not deployed yet on this block
    }
    const asset = await client.readContract({
      address: holder.address,
      abi: marketAbi,
      functionName: "asset",
      blockNumber: block,
    });
    for (const provider of providers) {
      const [source, rate] = await Promise.all([
        client
          .readContract({
            address: provider,
            abi: marketAbi,
            functionName: "getSource",
            args: [asset, holder.address, holder.address],
            blockNumber: block,
          })
          .catch(() => null),
        client
          .readContract({
            address: provider,
            abi: marketAbi,
            functionName: "getDepositRate",
            args: [holder.address],
            blockNumber: block,
          })
          .catch(() => null),
      ]);
      if (!source || /^0x0{40}$/i.test(source)) continue;
      const key = network + ":" + source.toLowerCase();
      const known = markets.get(key);
      if (known) {
        if (!known.vaults.includes(holder.vault)) known.vaults.push(holder.vault);
        if (known.rate == null && rate != null) known.rate = Number(rate) / 1e25;
        continue;
      }
      markets.set(key, {
        key,
        source,
        asset,
        vaults: [holder.vault],
        rate: rate == null ? null : Number(rate) / 1e25,
      });
    }
  }
  const rows = [];
  for (const market of markets.values()) {
    const info = await describe(client, network, market.source, market.asset);
    if (!info) continue;
    const reading = await readMarket(client, market.source, info, block).catch(
      () => null,
    );
    if (!reading) continue;
    rows.push({ ...market, ...info, ...reading });
  }
  return rows;
}

// Reads what is missing, at most `limit` days per network a run, newest first.
// A day uses the same block as the vault's own sample where there is one.
export async function syncMarketSamples(store, { limit = 6, log = () => {} } = {}) {
  const insert = store.db.prepare(
    "INSERT OR REPLACE INTO market_samples(network,source,day,block,at,kind,protocol,name,symbol,idx,tvl,rate,vaults) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const done = store.db.prepare(
    "SELECT DISTINCT day FROM market_samples WHERE network=?",
  );
  const vaultBlock = store.db.prepare(
    "SELECT block,at FROM vault_samples WHERE vault=? AND day=?",
  );
  const holders = indexHolders();
  const today = Math.floor(Date.now() / DAY);
  await Promise.all(
    Object.keys(CHAINS).map(async (network) => {
      const mine = holders.filter((h) => h.network === network);
      if (!mine.length) return;
      const client = archiveClient(network);
      const save = (day, block, at, rows) => {
        for (const row of rows)
          insert.run(
            network,
            row.source.toLowerCase(),
            day,
            Number(block),
            at,
            row.kind,
            row.protocol,
            row.name,
            row.symbol,
            String(row.idx),
            String(row.tvl),
            row.rate == null ? null : String(row.rate),
            JSON.stringify(row.vaults),
          );
      };
      try {
        const head = await client.getBlockNumber({ cacheTime: 0 });
        const headBlock = await client.getBlock({ blockNumber: head });
        save(
          today,
          head,
          Number(headBlock.timestamp) * 1000,
          await readNetworkDay(client, network, mine, head),
        );
        const known = new Set(done.all(network).map((row) => row.day));
        const stamps = new Map();
        const getTimestamp = async (blockNumber) => {
          const key = String(blockNumber);
          if (!stamps.has(key))
            stamps.set(key, (await client.getBlock({ blockNumber })).timestamp);
          return stamps.get(key);
        };
        let count = 0;
        for (let day = today - 1; day >= today - HISTORY_DAYS && count < limit; day--) {
          if (known.has(day)) continue;
          count += 1;
          try {
            const seen = vaultBlock.get(network, day);
            const found = seen
              ? { block: BigInt(seen.block), ts: seen.at / 1000 }
              : await blockNear(
                  getTimestamp,
                  (day * DAY) / 1000,
                  1n,
                  head,
                  CHAINS[network].blockSeconds,
                );
            if (!found) continue;
            const rows = await readNetworkDay(client, network, mine, found.block);
            // A day before any holder existed is recorded as checked and empty.
            if (!rows.length) {
              insert.run(network, "", day, Number(found.block), found.ts * 1000, "none", null, null, null, "0", "0", null, "[]");
              continue;
            }
            save(day, found.block, found.ts * 1000, rows);
          } catch (error) {
            log(`${network} day ${day}: ${error.shortMessage || error.message}`);
          }
        }
      } catch (error) {
        log(`${network}: ${error.shortMessage || error.message}`);
      }
    }),
  );
}

// Every daily reading, with its quote settled (see settledQuote below), and,
// for the interval since the market's previous reading, the average of its
// settled quotes and whether any quote in it jumped. The index uses these to
// leave out interest paid during a jump.
export function readMarketSamples(store) {
  const quotes = readFixedQuotes(store);
  const rows = readDailyRows(store, quotes);
  const settledFixed = new Map();
  for (const [key, list] of quotes)
    settledFixed.set(
      key,
      list.map((q, i) => {
        const settled = settledQuote(list.slice(0, i), q.at, q.rate);
        // Only a jump up can have paid extra interest.
        return { at: q.at, rate: settled.rate, held: settled.held != null && settled.held > settled.rate };
      }),
    );
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, []);
    byKey.get(row.key).push(row);
  }
  for (const [key, list] of byKey) {
    list.sort((a, c) => a.at - c.at);
    const fixed = settledFixed.get(key) || [];
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1],
        row = list[i];
      const inside = fixed.filter((q) => q.at > prev.at && q.at <= row.at);
      const rates = [prev.rate, ...inside.map((q) => q.rate), row.rate].filter(
        (rate) => rate != null && Number.isFinite(rate),
      );
      row.quoteMean = inside.length && rates.length
        ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length
        : null;
      const up = (r) => r.heldRate != null && r.rate != null && r.heldRate > r.rate;
      row.jumped = up(prev) || up(row) || inside.some((q) => q.held);
    }
  }
  return rows;
}

function readDailyRows(store, quotes) {
  return store.db
    .prepare("SELECT * FROM market_samples WHERE kind!='none' ORDER BY day")
    .all()
    .map((row) => {
      const key = row.network + ":" + row.source;
      const raw = row.rate == null ? null : Number(row.rate);
      const quote = settledQuote(quotes.get(key), row.at, raw);
      return {
      key: row.network + ":" + row.source,
      network: row.network,
      source: row.source,
      day: row.day,
      at: row.at,
      kind: row.kind,
      protocol: row.protocol,
      name: row.name,
      symbol: row.symbol,
      idx: Number(row.idx),
      tvl: Number(row.tvl),
      rate: quote.rate,
      rateAt: quote.at,
      // A quote that jumped and was not counted, kept for the record.
      heldRate: quote.held ?? null,
      vaults: row.vaults ? JSON.parse(row.vaults) : [],
      };
    });
}

// ---------------------------------------------------------------------------
// Quoted rates, settled. A market's quote can jump for a short while: Aave on
// Ethereum quoted about 12.5% instead of 3.7% from about 23:40 to 00:20 UTC on
// many days from September to early November, right where a daily reading
// sits. So each market's quote is also read three times a day, at 04:00, 12:00
// and 20:00 UTC, away from midnight. A quote counts as it is read unless it
// sits more than JUMP away from both of the two fixed readings before it; then
// the nearer of those stands in, until a later fixed reading confirms the new
// level. What the index earned is not affected either way: it comes from each
// market's interest index, which grows by what was actually paid.
export const QUOTE_HOURS = [4, 12, 20];
// The larger of 1.5 points and 30% of the higher of the two readings before.
const jumpOf = (level) => Math.max(1.5, 0.3 * level);
const providerSources = new Map();

async function readQuotesAt(client, network, holders, block) {
  const out = new Map();
  for (const holder of holders) {
    let providers;
    try {
      providers = await client.readContract({
        address: holder.address,
        abi: marketAbi,
        functionName: "getProviders",
        blockNumber: block,
      });
    } catch {
      continue; // not deployed yet on this block
    }
    const asset = await client.readContract({
      address: holder.address,
      abi: marketAbi,
      functionName: "asset",
      blockNumber: block,
    });
    for (const provider of providers) {
      const id = network + ":" + provider.toLowerCase() + ":" + asset.toLowerCase();
      if (!providerSources.has(id))
        providerSources.set(
          id,
          await client
            .readContract({
              address: provider,
              abi: marketAbi,
              functionName: "getSource",
              args: [asset, holder.address, holder.address],
              blockNumber: block,
            })
            .catch(() => null),
        );
      const source = providerSources.get(id);
      if (!source || /^0x0{40}$/i.test(source) || out.has(source.toLowerCase())) continue;
      const rate = await client
        .readContract({
          address: provider,
          abi: marketAbi,
          functionName: "getDepositRate",
          args: [holder.address],
          blockNumber: block,
        })
        .catch(() => null);
      if (rate != null) out.set(source.toLowerCase(), Number(rate) / 1e25);
    }
  }
  return out;
}

// Reads the fixed quote times still missing, newest first, at most `limit` a
// network a run, back `days` days.
export async function syncQuoteSamples(store, { limit = 15, days = 97, log = () => {} } = {}) {
  const insert = store.db.prepare(
    "INSERT OR REPLACE INTO market_quotes(network,source,at,rate) VALUES(?,?,?,?)",
  );
  const have = store.db.prepare(
    "SELECT COUNT(*) AS n FROM market_quotes WHERE network=? AND at BETWEEN ? AND ?",
  );
  const holders = indexHolders();
  const today = Math.floor(Date.now() / DAY);
  await Promise.all(
    Object.keys(CHAINS).map(async (network) => {
      const mine = holders.filter((h) => h.network === network);
      if (!mine.length) return;
      const client = archiveClient(network);
      try {
        const head = await client.getBlockNumber({ cacheTime: 0 });
        const stamps = new Map();
        const getTimestamp = async (blockNumber) => {
          const key = String(blockNumber);
          if (!stamps.has(key))
            stamps.set(key, (await client.getBlock({ blockNumber })).timestamp);
          return stamps.get(key);
        };
        let count = 0;
        for (let day = today; day >= today - days && count < limit; day--)
          for (const hour of [...QUOTE_HOURS].reverse()) {
            const target = day * DAY + hour * 3600000;
            // A reading needs a few minutes of blocks after its time.
            if (target > Date.now() - 600000 || count >= limit) continue;
            if (have.get(network, target - 1800000, target + 1800000).n > 0) continue;
            count += 1;
            try {
              const found = await blockNear(
                getTimestamp,
                target / 1000,
                1n,
                head,
                CHAINS[network].blockSeconds,
              );
              if (!found) continue;
              const quotes = await readQuotesAt(client, network, mine, found.block);
              const at = Number(found.ts) * 1000;
              // A time before any vault existed is still marked as read.
              if (!quotes.size) insert.run(network, "", at, "0");
              for (const [source, rate] of quotes)
                insert.run(network, source, at, String(rate));
            } catch (error) {
              log(`${network} quotes ${day}/${hour}: ${error.shortMessage || error.message}`);
            }
          }
      } catch (error) {
        log(`${network} quotes: ${error.shortMessage || error.message}`);
      }
    }),
  );
}

function readFixedQuotes(store) {
  const out = new Map();
  let rows = [];
  try {
    rows = store.db
      .prepare("SELECT network,source,at,rate FROM market_quotes WHERE source!='' ORDER BY at")
      .all();
  } catch {
    return out; // an older history file without the table
  }
  for (const row of rows) {
    const key = row.network + ":" + row.source;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ at: row.at, rate: Number(row.rate) });
  }
  return out;
}

/**
 * The settled quote at `at` for a reading of `raw`: the reading itself, unless
 * it jumped away from both of the last two fixed readings taken at least two
 * hours before it (and within a day and a half); then the nearer of the two.
 */
export function settledQuote(quotes, at, raw) {
  if (raw == null) return { rate: null, at, settled: false };
  const before = [];
  for (let i = (quotes || []).length - 1; i >= 0 && before.length < 2; i--)
    if (quotes[i].at <= at - 2 * 3600000) before.push(quotes[i]);
  if (before.length < 2 || at - before[1].at > 36 * 3600000)
    return { rate: raw, at, settled: false };
  const lo = Math.min(before[0].rate, before[1].rate),
    hi = Math.max(before[0].rate, before[1].rate);
  const jump = jumpOf(hi);
  if (raw >= lo - jump && raw <= hi + jump) return { rate: raw, at, settled: true };
  const stand = raw > hi ? (before[0].rate === hi ? before[0] : before[1]) : before[0].rate === lo ? before[0] : before[1];
  return { rate: stand.rate, at: stand.at, settled: true, held: raw };
}

// ---------------------------------------------------------------------------
// Reference lines for the comparison chart that are not lending markets.
// T-bills: the on-chain price of Ondo USDY, a tokenized note backed by short
// US Treasuries; its price grows at the rate Ondo sets, a little under T-bills.
export const REFERENCES = [
  {
    id: "tbills",
    name: "T-bills (Ondo USDY)",
    network: "ethereum",
    address: "0xA0219AA5B31e65Bc920B5b6DFb8EdF0988121De0",
    fn: "getPrice",
    decimals: 18,
  },
];
const referenceAbi = parseAbi(["function getPrice() view returns (uint256)"]);

// One reading a day on the same blocks as that network's market readings.
export async function syncReferenceSamples(store, { log = () => {} } = {}) {
  const insert = store.db.prepare(
    "INSERT OR REPLACE INTO reference_samples(id,day,block,at,value) VALUES(?,?,?,?,?)",
  );
  for (const ref of REFERENCES) {
    const client = archiveClient(ref.network);
    const days = store.db
      .prepare(
        "SELECT day, MAX(block) AS block, MAX(at) AS at FROM market_samples WHERE network=? GROUP BY day",
      )
      .all(ref.network);
    const known = new Set(
      store.db.prepare("SELECT day FROM reference_samples WHERE id=?").all(ref.id).map((r) => r.day),
    );
    const today = Math.floor(Date.now() / DAY);
    for (const day of days) {
      if (known.has(day.day) && day.day !== today) continue;
      try {
        const value = await client.readContract({
          address: ref.address,
          abi: referenceAbi,
          functionName: ref.fn,
          blockNumber: BigInt(day.block),
        });
        insert.run(ref.id, day.day, day.block, day.at, String(Number(value) / 10 ** ref.decimals));
      } catch (error) {
        log(`${ref.id} day ${day.day}: ${error.shortMessage || error.message}`);
      }
    }
  }
}

export function readReferenceSamples(store) {
  const out = {};
  for (const row of store.db
    .prepare("SELECT * FROM reference_samples ORDER BY id, day")
    .all()) {
    (out[row.id] ||= []).push({ day: row.day, at: row.at, level: Number(row.value) });
  }
  return out;
}
