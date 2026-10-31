// Server-only, rebuildable event index. No signer, no simulated transactions.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeEventLog, parseAbi } from "viem";
import { crosschain, sameAddress } from "./crosschain-config.mjs";

const eventAbi = parseAbi([
  "event DepositRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 assets)",
  "event RedeemRequested(uint256 indexed requestId,uint64 indexed epoch,address indexed owner,address receiver,uint256 shares)",
  "event RequestCancelled(uint256 indexed requestId)",
  "event DepositClaimed(uint256 indexed requestId,address indexed receiver,uint256 shares)",
  "event RedeemClaimed(uint256 indexed requestId,address indexed receiver,uint256 assets)",
  "event InstantRedeemed(address indexed owner,address indexed receiver,uint64 indexed tickId,uint256 shares,uint256 assets)",
  "event TickCommitted(uint64 indexed tickId,uint8 status,uint8 flags,uint64 referenceTime,uint64 hubBlock,uint256 rateBid,uint256 rateOffer,uint256 navBid,uint256 navOffer,bytes32 navHash)",
  "event TickRatified(uint64 indexed tickId,address indexed by)",
]);
const names = {
  DepositRequested: "deposit_requested",
  RedeemRequested: "redeem_requested",
  RequestCancelled: "request_cancelled",
  DepositClaimed: "deposit_claimed",
  RedeemClaimed: "redeem_claimed",
  InstantRedeemed: "instant_exit",
  TickCommitted: "tick",
  TickRatified: "tick_ratified",
};
export function decodeHistoryLog(log, timestamp) {
  if (
    ![crosschain.vault, crosschain.accountant].some((address) =>
      sameAddress(log.address, address),
    )
  )
    return null;
  try {
    const { eventName, args } = decodeEventLog({
      abi: eventAbi,
      data: log.data,
      topics: log.topics,
    });
    if (
      (eventName.startsWith("Tick")
        ? !sameAddress(log.address, crosschain.accountant)
        : !sameAddress(log.address, crosschain.vault)) ||
      log.removed
    )
      return null;
    return JSON.parse(
      JSON.stringify(
        {
          type: names[eventName],
          eventName,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(log.blockNumber),
          blockHash: log.blockHash,
          at: timestamp * 1000,
          ...args,
        },
        (_, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    );
  } catch {
    return null;
  }
}

export function openCrosschainHistory(
  path = process.env.CROSSCHAIN_HISTORY_DB ||
    resolve(
      dirname(
        process.env.THESAUROS_AUTH_DB ||
          resolve(process.cwd(), "private-state/crosschain/accounts.sqlite"),
      ),
      "history.sqlite",
    ),
) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS history_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chain_events(tx_hash TEXT NOT NULL,log_index INTEGER NOT NULL,block_number INTEGER NOT NULL,event_name TEXT NOT NULL,owner TEXT,receiver TEXT,request_id TEXT,at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tx_hash,log_index));
    CREATE INDEX IF NOT EXISTS chain_events_owner ON chain_events(owner);
    CREATE INDEX IF NOT EXISTS chain_events_request ON chain_events(request_id);`);
  const getMeta = (key) =>
    db.prepare("SELECT value FROM history_meta WHERE key=?").get(key)?.value;
  const setMeta = (key, value) =>
    db
      .prepare(
        "INSERT INTO history_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, String(value));
  const identity = `${crosschain.chainId}:${crosschain.vault.toLowerCase()}:${crosschain.accountant.toLowerCase()}:${crosschain.startBlock}`;
  if (getMeta("identity") && getMeta("identity") !== identity) {
    db.close();
    throw new Error("History database belongs to a different deployment.");
  }
  setMeta("identity", identity);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO chain_events VALUES(?,?,?,?,?,?,?,?,?)",
  );
  return {
    db,
    getMeta,
    setMeta,
    indexedTo: () => Number(getMeta("indexedTo") || crosschain.startBlock - 1),
    save: db.transaction((from, to, events) => {
      // Re-reading a confirmation overlap removes orphaned events after a shallow reorg.
      db.prepare(
        "DELETE FROM chain_events WHERE block_number BETWEEN ? AND ?",
      ).run(from, to);
      for (const event of events)
        insert.run(
          event.txHash,
          event.logIndex,
          event.blockNumber,
          event.eventName,
          event.owner?.toLowerCase() || null,
          event.receiver?.toLowerCase() || null,
          event.requestId ?? null,
          event.at,
          JSON.stringify(event),
        );
      setMeta("indexedTo", to);
      setMeta("lastSync", Date.now());
      setMeta("error", "");
    }),
    close: () => db.close(),
  };
}

export async function syncCrosschainHistory(
  store,
  client,
  { batchSize = 8000, maxBatches = 8 } = {},
) {
  if ((await client.getChainId()) !== crosschain.chainId)
    throw new Error("History RPC returned the wrong network.");
  const head = Number(await client.getBlockNumber({ cacheTime: 0 })) - 5;
  store.setMeta("head", head);
  let from = Math.max(crosschain.startBlock, store.indexedTo() - 20);
  for (let n = 0; n < maxBatches && from <= head; n++) {
    const to = Math.min(head, from + batchSize - 1);
    const logs = await client.getLogs({
      address: [crosschain.vault, crosschain.accountant],
      fromBlock: BigInt(from),
      toBlock: BigInt(to),
    });
    const times = new Map();
    const events = [];
    // Fetch timestamps only for supported logs. Other ERC20/governance logs are irrelevant.
    for (const log of logs) {
      if (!decodeHistoryLog(log, 0)) continue;
      const key = String(log.blockNumber);
      if (!times.has(key))
        times.set(
          key,
          Number(
            (await client.getBlock({ blockNumber: log.blockNumber })).timestamp,
          ),
        );
      const event = decodeHistoryLog(log, times.get(key));
      if (event) events.push(event);
    }
    store.save(from, to, events);
    from = to + 1;
  }
  return historyCoverage(store);
}
export function historyCoverage(store) {
  const head = Number(store.getMeta("head") || 0),
    indexedTo = store.indexedTo();
  const lastSync = Number(store.getMeta("lastSync") || 0);
  return {
    fromBlock: crosschain.startBlock,
    indexedTo,
    headBlock: head || null,
    complete: head > 0 && indexedTo >= head && Date.now() - lastSync < 180000,
    lastSync: lastSync || null,
    error: store.getMeta("error") || "",
  };
}
export function readIndexedActivity(owner, store = openCrosschainHistory()) {
  const ownStore = arguments.length < 2;
  try {
    const wallet = owner.toLowerCase();
    const events = store.db
      .prepare(
        `SELECT payload FROM chain_events WHERE owner=? OR receiver=? OR request_id IN
      (SELECT request_id FROM chain_events WHERE (owner=? OR receiver=?) AND request_id IS NOT NULL)
      ORDER BY block_number DESC,log_index DESC LIMIT 500`,
      )
      .all(wallet, wallet, wallet, wallet)
      .map((row) => JSON.parse(row.payload));
    const requestIds = [
      ...new Set(
        events
          .filter(
            (event) =>
              event.type === "deposit_requested" ||
              event.type === "redeem_requested",
          )
          .map((event) => event.requestId),
      ),
    ];
    const ticks = store.db
      .prepare(
        "SELECT payload FROM chain_events WHERE event_name='TickCommitted' ORDER BY block_number DESC LIMIT 500",
      )
      .all()
      .map((row) => JSON.parse(row.payload));
    const ratified = new Set(
      store.db
        .prepare(
          "SELECT payload FROM chain_events WHERE event_name='TickRatified'",
        )
        .all()
        .map((row) => JSON.parse(row.payload).tickId),
    );
    return {
      address: owner,
      events,
      requestIds,
      ticks: ticks.filter(
        (tick) =>
          tick.status === 1 || tick.status === 3 || ratified.has(tick.tickId),
      ),
      coverage: historyCoverage(store),
      truncated: events.length === 500,
      source: "Indexed EpochVault and TickAccountant events on Base",
    };
  } finally {
    if (ownStore) store.close();
  }
}
