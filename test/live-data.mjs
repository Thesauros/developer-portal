import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeNetwork, selectMarkets, number } from "../lib/live-data.mjs";
const source = new URL("./fixtures/live-data/", import.meta.url);
const read = (name) =>
  JSON.parse(readFileSync(new URL(name + ".json", source), "utf8"));
const networks = read("networks");
const base = normalizeNetwork(
  read("baseRebalancer"),
  networks[1],
  "2026-09-07T16:00:00Z",
);
assert.equal(base.vaults[0].assets, 4.214289);
assert.equal(base.vaults[0].apy, 5.0754);
assert.equal(base.vaults[0].providers[0].share, 52.52);
assert.equal(base.vaults[0].providers[0].apy, 5.4478);
assert.equal(base.vaults[0].history.length, 0);
assert.equal(base.configuredActive, false);
assert.equal(base.status, "available");
const arb = normalizeNetwork(
  read("arbitrumRebalancer"),
  networks[0],
  "2026-09-07T16:00:00Z",
);
assert.equal(arb.vaults[0].apy, null);
assert.equal(arb.vaults[0].assets, null);
assert.equal(arb.status, "degraded");
assert.equal(arb.vaults[0].lifetime.financialResult, 0.061389);
assert.equal(arb.events.length, 8);
assert.equal(new Set(arb.events.map((e) => e.id)).size, 8);
const timeout = normalizeNetwork(null, networks[1], null, true);
assert.equal(timeout.stale, true);
assert.equal(timeout.vaults.length, 0);
assert.equal(timeout.blockNumber, null);
const unknown = structuredClone(read("baseRebalancer"));
unknown.vaults[0].tvl = "not a number";
unknown.apyData[0].apy = "";
unknown.vaults[0].providerInfo.apy = null;
const sanitized = normalizeNetwork(unknown, networks[1], null);
assert.equal(sanitized.vaults[0].assets, null);
assert.equal(sanitized.vaults[0].apy, null);
assert.equal(number(null), null);
assert.equal(number(""), null);
assert.equal(number("0"), 0);
assert.equal(number("Infinity"), null);
const pools = selectMarkets(read("pools"));
assert.ok(pools.length > 0);
assert.ok(pools.every((p) => p.tvlUsd > 1000000));
assert.ok(pools.some((p) => p.name === "Aave"));
assert.ok(pools.every((p) => Number.isFinite(p.apy)));
assert.ok(!pools.some((p) => p.tvlUsd === base.vaults[0].assets));
console.log(
  "PASS: live financial units, null/error handling, source scope, empty history and event identity.",
);
const { retainIndexed } = await import("../lib/live-data.mjs");
const earlier = read("arbitrumRebalancer"),
  partial = {
    ...structuredClone(earlier),
    vaultLifetimeStats: [],
    events: [],
    lastUpdate: "2026-09-07T18:00:00Z",
  };
const retained = retainIndexed(partial, earlier);
assert.equal(retained.events.length, 8);
assert.equal(retained.eventsObservedAt, earlier.lastUpdate);
assert.equal(
  retained.vaultLifetimeStats[0].updatedAt,
  earlier.vaultLifetimeStats[0].updatedAt,
);
assert.equal(retained.lifetimeRetained, true);
assert.equal(retained.eventsRetained, true);
const fresh = retainIndexed(earlier, retained);
assert.equal(fresh.eventsRetained, false);
assert.equal(fresh.lifetimeRetained, false);
assert.equal(fresh.eventsObservedAt, earlier.lastUpdate);
console.log(
  "PASS: partial source responses preserve indexed records and their observation times; new source records supersede retained records.",
);

const earnAddress = base.vaults[0].address;
const legacyAddress = "0x1111111111111111111111111111111111111111";
const providerAddress = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32);
const richEvent = {
  type: "RebalanceExecuted",
  txHash: hash,
  blockNumber: 500,
  timestamp: "2026-08-10T12:00:00Z",
  token: "USDC",
  vaultAddress: earnAddress,
  vault: "Thesauros USDC Vault",
  logIndex: 0,
  fromProvider: "Morpho",
  toProvider: providerAddress,
  fromAllocation: [
    { address: providerAddress, name: "Morpho", balance: "12.5", share: "100" },
  ],
  toAllocation: [
    { address: providerAddress, name: "Aave", assets: "12.5", share: "100" },
  ],
  assets: "12.5",
  cost: "0",
  costToken: "USDC",
  success: false,
};
const eventRaw = structuredClone(read("baseRebalancer"));
eventRaw.events = [
  richEvent,
  {
    ...richEvent,
    vaultAddress: null,
    fromProvider: undefined,
    toProvider: undefined,
    fromAllocation: undefined,
    toAllocation: undefined,
    assets: undefined,
    cost: undefined,
    costToken: undefined,
    logIndex: undefined,
  },
];
let eventNetwork = normalizeNetwork(eventRaw, networks[1], null);
assert.equal(eventNetwork.events[0].vaultAddress, earnAddress);
assert.equal(eventNetwork.events[0].vaultScopeSource, "event");
assert.equal(eventNetwork.events[0].vaultName, "Thesauros USDC Vault");
assert.equal(eventNetwork.events[0].logIndex, 0);
assert.equal(eventNetwork.events[0].assets, 12.5);
assert.equal(eventNetwork.events[0].cost, 0);
assert.equal(eventNetwork.events[0].success, false);
assert.equal(eventNetwork.events[0].fromAllocation[0].share, 100);
assert.equal(eventNetwork.events[0].toAllocation[0].assets, 12.5);
assert.equal(
  eventNetwork.events[1].vaultAddress,
  null,
  "a shared token/name cannot identify the vault",
);
assert.equal(eventNetwork.events[1].assets, null);
assert.equal(eventNetwork.events[1].cost, null);
assert.equal(eventNetwork.events[1].fromProvider, null);
assert.equal(eventNetwork.events[1].fromAllocation, null);
assert.notEqual(
  eventNetwork.events[0].id,
  eventNetwork.events[1].id,
  "multiple logs in one transaction stay distinct",
);

eventRaw.vaultLifetimeStats = [
  {
    vaultAddress: legacyAddress,
    token: "USDC",
    recentEvents: [eventRaw.events[1]],
  },
];
eventNetwork = normalizeNetwork(eventRaw, networks[1], null);
assert.equal(
  eventNetwork.events[0].vaultAddress,
  earnAddress,
  "explicit event address takes precedence",
);
assert.equal(
  eventNetwork.events[1].vaultAddress,
  legacyAddress,
  "exact nested indexed tuple establishes the actual legacy vault",
);
assert.equal(eventNetwork.events[1].vaultScopeSource, "indexed-vault");
assert.equal(
  eventNetwork.vaults.find((v) => v.address === earnAddress).lifetime,
  null,
);
assert.equal(
  eventNetwork.vaults.find((v) => v.address === legacyAddress).lifetime
    .vaultAddress,
  legacyAddress,
);
eventRaw.vaultLifetimeStats.push({
  vaultAddress: earnAddress,
  recentEvents: [eventRaw.events[1]],
});
assert.equal(
  normalizeNetwork(eventRaw, networks[1], null).events[1].vaultAddress,
  null,
  "ambiguous event tuple cannot establish a vault",
);
eventRaw.vaultLifetimeStats = [
  {
    vaultAddress: legacyAddress,
    recentEvents: [{ ...eventRaw.events[1], type: "Deposit" }],
  },
];
assert.equal(
  normalizeNetwork(eventRaw, networks[1], null).events[1].vaultAddress,
  null,
  "another event type in the same transaction is not a match",
);
eventRaw.vaultLifetimeStats[0].recentEvents = [
  { ...eventRaw.events[1], blockNumber: 501 },
];
assert.equal(
  normalizeNetwork(eventRaw, networks[1], null).events[1].vaultAddress,
  null,
);

const historyRaw = structuredClone(read("baseRebalancer"));
historyRaw.apyAnalytics.series = [
  {
    vaultAddress: legacyAddress,
    token: "USDC",
    points: [
      { timestamp: "2026-08-02T00:00:00Z", apy: "4.2" },
      { timestamp: "invalid", apy: 5 },
      { timestamp: "2026-08-01T00:00:00Z", apy: "0" },
      { timestamp: "2026-08-03T00:00:00Z", apy: null },
      null,
    ],
  },
  { vaultAddress: earnAddress, token: "USDC", points: [] },
];
const scopedHistory = normalizeNetwork(historyRaw, networks[1], null);
assert.deepEqual(
  scopedHistory.vaults.find((v) => v.address === earnAddress).history,
  [],
);
assert.deepEqual(
  scopedHistory.vaults.find((v) => v.address === legacyAddress).history,
  [
    { timestamp: "2026-08-01T00:00:00.000Z", apy: 0 },
    { timestamp: "2026-08-02T00:00:00.000Z", apy: 4.2 },
    { timestamp: "2026-08-03T00:00:00.000Z", apy: null },
  ],
);
assert.equal(
  scopedHistory.vaults.find((v) => v.address === legacyAddress).assets,
  null,
  "history does not create a current balance",
);
const laterHistory = structuredClone(historyRaw);
laterHistory.lastUpdate = "2026-09-21T00:00:00Z";
laterHistory.apyAnalytics.series = [
  { vaultAddress: earnAddress, token: "USDC", points: [] },
];
const retainedHistory = retainIndexed(laterHistory, historyRaw);
const normalizedRetained = normalizeNetwork(retainedHistory, networks[1], null);
const retainedLegacy = normalizedRetained.vaults.find(
  (v) => v.address === legacyAddress,
);
assert.equal(retainedLegacy.historyRetained, true);
assert.equal(
  retainedLegacy.historyObservedAt,
  new Date(historyRaw.lastUpdate).toISOString(),
);
assert.equal(retainedLegacy.history.length, 3);
assert.deepEqual(
  normalizedRetained.vaults.find((v) => v.address === earnAddress).history,
  [],
);
assert.deepEqual(
  retainIndexed({ ...laterHistory, network: "other-chain" }, historyRaw)
    .apyAnalytics.series,
  laterHistory.apyAnalytics.series,
);

const freshHistory = structuredClone(historyRaw);
freshHistory.lastUpdate = "2026-09-21T00:00:00Z";
freshHistory.apyAnalytics.series[0].points = [
  { timestamp: "2026-09-20T00:00:00Z", apy: 2 },
];
const replacedHistory = normalizeNetwork(
  retainIndexed(freshHistory, retainedHistory),
  networks[1],
  null,
).vaults.find((v) => v.address === legacyAddress);
assert.equal(
  replacedHistory.history.length,
  1,
  "fresh source series supersedes retained history",
);
assert.equal(replacedHistory.historyRetained, false);
assert.equal(replacedHistory.historyObservedAt, "2026-09-21T00:00:00.000Z");

const allocationUnknown = structuredClone(read("baseRebalancer"));
allocationUnknown.vaults[0].providerAllocations = [];
const providerOnly = normalizeNetwork(allocationUnknown, networks[1], null)
  .vaults[0].providers[0];
assert.equal(
  providerOnly.share,
  null,
  "an entry provider does not prove 100% allocation",
);
assert.equal(providerOnly.balance, null);
const sourceStale = normalizeNetwork(
  { ...allocationUnknown, payloadMeta: { stale: true } },
  networks[1],
  "2026-09-21T00:00:00Z",
);
assert.equal(
  sourceStale.stale,
  true,
  "successful HTTP does not erase upstream cache staleness",
);
assert.equal(sourceStale.status, "stale");
const emptySnapshot = normalizeNetwork(
  { vaults: [], networkInfo: { lastUpdate: "2026-09-21T00:00:00Z" } },
  networks[1],
  "2026-09-21T00:00:01Z",
);
assert.equal(
  emptySnapshot.status,
  "degraded",
  "a fresh HTTP response with no vault data is incomplete",
);
assert.deepEqual(emptySnapshot.vaults, []);
const missingIdentity = {
  vaults: [{ token: "USDC", status: "active" }],
  apyData: [{ apy: 99 }],
  apyAnalytics: {
    series: [{ points: [{ timestamp: "2026-08-01T00:00:00Z", apy: 99 }] }],
  },
  vaultLifetimeStats: [{ totalDeposits: 99 }],
};
const unidentified = normalizeNetwork(missingIdentity, networks[1], null);
assert.equal(unidentified.vaults[0].apy, null);
assert.deepEqual(unidentified.vaults[0].history, []);
assert.equal(
  unidentified.vaults[0].lifetime,
  null,
  "missing addresses never compare as matching",
);
console.log(
  "PASS: explicit and nested event scope, ambiguous identity, rich rebalance fields, address-specific retained history, provider allocation uncertainty and source freshness.",
);

const beforeOmission = structuredClone(read("baseRebalancer"));
const originalSnapshot = structuredClone(beforeOmission);
const snapshotTime = new Date(
  beforeOmission.networkInfo.lastUpdate,
).toISOString();
const afterOmission = {
  ...structuredClone(beforeOmission),
  vaults: [],
  lastUpdate: "2026-09-21T10:01:00Z",
  networkInfo: {
    ...beforeOmission.networkInfo,
    lastUpdate: "2026-09-21T10:00:00Z",
  },
};
afterOmission.apyData[0].apy = "99";
for (const provider of afterOmission.providers)
  provider.depositRates = { USDC: 99 };
const retainedSnapshot = retainIndexed(afterOmission, beforeOmission);
const retainedSnapshotNetwork = normalizeNetwork(
  retainedSnapshot,
  networks[1],
  "2026-09-21T10:02:00Z",
);
const oldVault = retainedSnapshotNetwork.vaults.find(
  (v) => v.address === earnAddress,
);
assert.equal(oldVault.assets, base.vaults[0].assets);
assert.equal(
  oldVault.apy,
  base.vaults[0].apy,
  "retained allocation does not inherit a newer orphan rate",
);
assert.equal(
  oldVault.providers[0].apy,
  base.vaults[0].providers[0].apy,
  "retained provider context stays with its observation",
);
assert.equal(oldVault.snapshotRetained, true);
assert.equal(oldVault.snapshotObservedAt, snapshotTime);
assert.equal(retainedSnapshotNetwork.observedAt, "2026-09-21T10:00:00.000Z");
assert.deepEqual(
  beforeOmission,
  originalSnapshot,
  "retaining a snapshot does not mutate the previous cache",
);
const repeatedOmission = retainIndexed(
  { ...afterOmission, lastUpdate: "2026-09-22T00:00:00Z" },
  retainedSnapshot,
);
const repeatedVault = normalizeNetwork(repeatedOmission, networks[1], null)
  .vaults[0];
assert.equal(
  repeatedVault.snapshotObservedAt,
  snapshotTime,
  "repeated partial refreshes cannot renew the snapshot timestamp",
);
assert.equal(repeatedVault.apy, base.vaults[0].apy);
assert.equal(repeatedVault.providers[0].apy, base.vaults[0].providers[0].apy);

const explicitFailure = {
  ...afterOmission,
  vaults: [
    {
      ...beforeOmission.vaults[0],
      address: earnAddress.toLowerCase(),
      status: "error",
      error: "RPC read failed",
      tvl: null,
    },
  ],
};
const failedSnapshot = normalizeNetwork(
  retainIndexed(explicitFailure, retainedSnapshot),
  networks[1],
  null,
);
assert.equal(
  failedSnapshot.vaults.length,
  1,
  "a present failed contract is not duplicated by an old snapshot",
);
assert.equal(failedSnapshot.vaults[0].assets, null);
assert.equal(failedSnapshot.vaults[0].apy, null);
assert.equal(failedSnapshot.vaults[0].status, "unavailable");
assert.equal(failedSnapshot.vaults[0].snapshotRetained, false);
assert.equal(
  failedSnapshot.vaults[0].snapshotObservedAt,
  "2026-09-21T10:00:00.000Z",
);
const explicitInvalid = {
  ...afterOmission,
  vaults: [{ ...beforeOmission.vaults[0], tvl: "invalid numeric value" }],
};
const invalidSnapshot = normalizeNetwork(
  retainIndexed(explicitInvalid, retainedSnapshot),
  networks[1],
  null,
).vaults[0];
assert.equal(
  invalidSnapshot.assets,
  null,
  "a present invalid amount must remain unknown, not resurrect the old amount",
);
assert.equal(invalidSnapshot.snapshotRetained, false);

const otherVaultFresh = {
  ...afterOmission,
  vaults: [
    {
      ...beforeOmission.vaults[0],
      address: legacyAddress,
      tvl: "77",
      providerInfo: { apy: "2.5" },
    },
  ],
};
const mixedSnapshots = normalizeNetwork(
  retainIndexed(otherVaultFresh, retainedSnapshot),
  networks[1],
  null,
);
assert.equal(mixedSnapshots.vaults.length, 2);
assert.equal(
  mixedSnapshots.vaults.find((v) => v.address === legacyAddress).assets,
  77,
);
assert.equal(
  mixedSnapshots.vaults.find((v) => v.address === legacyAddress)
    .snapshotRetained,
  false,
);
assert.equal(
  mixedSnapshots.vaults.find((v) => v.address === earnAddress).assets,
  base.vaults[0].assets,
);
assert.equal(
  mixedSnapshots.vaults.find((v) => v.address === earnAddress).snapshotRetained,
  true,
);
assert.deepEqual(
  retainIndexed(
    { ...afterOmission, network: "arbitrumRebalancer" },
    beforeOmission,
  ).vaults,
  [],
);
assert.deepEqual(
  retainIndexed(
    {
      ...afterOmission,
      networkInfo: { ...afterOmission.networkInfo, chainId: 42161 },
    },
    beforeOmission,
  ).vaults,
  [],
);
assert.deepEqual(
  retainIndexed(afterOmission, null).vaults,
  [],
  "cold missing data remains missing",
);

const recovered = normalizeNetwork(
  retainIndexed(
    { ...afterOmission, vaults: beforeOmission.vaults },
    retainedSnapshot,
  ),
  networks[1],
  null,
).vaults[0];
assert.equal(recovered.snapshotRetained, false);
assert.equal(recovered.snapshotObservedAt, "2026-09-21T10:00:00.000Z");
assert.equal(
  recovered.apy,
  99,
  "a newly present snapshot uses its newly supplied rate",
);
const unknownTimePrevious = {
  ...beforeOmission,
  networkInfo: {},
  lastUpdate: null,
};
const unknownTimeRetained = retainIndexed(afterOmission, unknownTimePrevious);
assert.equal(
  normalizeNetwork(unknownTimeRetained, networks[1], null).vaults[0]
    .snapshotObservedAt,
  null,
);
assert.equal(
  normalizeNetwork(
    retainIndexed(afterOmission, unknownTimeRetained),
    networks[1],
    null,
  ).vaults[0].snapshotObservedAt,
  null,
  "unknown original observation time never becomes the time of a partial refresh",
);
console.log(
  "PASS: omitted snapshot retention, original rate/provider context and timestamps, explicit failures, new contract identity, cold omissions and recovery.",
);
