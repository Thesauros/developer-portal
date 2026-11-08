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

const abi = parseAbi([
  "function getProviders() view returns (address[])",
  "function asset() view returns (address)",
  "function getSource(address,address,address) view returns (address)",
  "function getDepositRate(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function baseToken() view returns (address)",
  "function MORPHO() view returns (address)",
  "function adaptersLength() view returns (uint256)",
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
async function describe(client, network, source, asset) {
  const key = network + ":" + source.toLowerCase();
  if (kinds.has(key)) return kinds.get(key);
  const read = (address, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
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
    client.readContract({ address, abi, functionName, args, blockNumber: block });
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
        abi,
        functionName: "getProviders",
        blockNumber: block,
      });
    } catch {
      continue; // not deployed yet on this block
    }
    const asset = await client.readContract({
      address: holder.address,
      abi,
      functionName: "asset",
      blockNumber: block,
    });
    for (const provider of providers) {
      const [source, rate] = await Promise.all([
        client
          .readContract({
            address: provider,
            abi,
            functionName: "getSource",
            args: [asset, holder.address, holder.address],
            blockNumber: block,
          })
          .catch(() => null),
        client
          .readContract({
            address: provider,
            abi,
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

export function readMarketSamples(store) {
  return store.db
    .prepare("SELECT * FROM market_samples WHERE kind!='none' ORDER BY day")
    .all()
    .map((row) => ({
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
      rate: row.rate == null ? null : Number(row.rate),
      vaults: row.vaults ? JSON.parse(row.vaults) : [],
    }));
}
