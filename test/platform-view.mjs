import assert from "node:assert/strict";
import {
  platformVaults,
  platformPortfolio,
  choosePlatformVault,
  scopedEvents,
  historyPeriod,
  onchainPlatformSnapshot,
} from "../lib/platform-view.mjs";
import { vaults as supported } from "../lib/vault-contracts.mjs";

const legacyAddress = "0x1111111111111111111111111111111111111111";
const observedAt = "2026-08-10T12:00:00.000Z";
const legacy = {
  address: legacyAddress,
  token: "USDC",
  name: "Thesauros USDC Vault",
  assets: 100,
  apy: 4,
  history: [{ timestamp: observedAt, apy: 4 }],
  providers: [],
  lifetime: { vaultAddress: legacyAddress, rebalanceCount: 5 },
  status: "active",
};
const current = {
  ...legacy,
  address: supported[0].address.toLowerCase(),
  assets: 0,
  apy: 0,
  history: [],
  lifetime: null,
};
const otherChain = { ...current, address: supported[1].address, assets: null };
const networks = [
  {
    key: "arbitrumRebalancer",
    chainId: 42161,
    name: "Arbitrum",
    explorer: "https://arbiscan.io",
    observedAt,
    fetchedAt: observedAt,
    source: "https://example.test/arbitrum",
    stale: false,
    vaults: [legacy, current, { ...legacy, address: null }],
  },
  {
    key: "baseRebalancer",
    chainId: 8453,
    name: "Base",
    explorer: "https://basescan.org",
    observedAt,
    stale: true,
    vaults: [otherChain, { ...legacy, address: current.address }],
  },
];
const rows = platformVaults(networks);
assert.equal(
  rows.length,
  4,
  "unidentified vaults cannot become selectable financial rows",
);
assert.equal(
  rows[1].key,
  `arbitrumRebalancer:${supported[0].address.toLowerCase()}`,
);
assert.equal(rows[1].earnVaultId, "arbitrum");
assert.equal(rows[1].isEarnVault, true);
assert.equal(
  rows[3].isEarnVault,
  false,
  "same address on another chain is not the supported Earn contract",
);
assert.notEqual(rows[1].key, rows[3].key);
assert.equal(rows[1].assets, 0);
assert.equal(rows[1].apy, 0);
assert.equal(rows[2].assets, null);
assert.deepEqual(
  rows[1].history,
  [],
  "the legacy vault's history does not appear on the current vault",
);
assert.equal(rows[1].lifetime, null);
assert.equal(rows[0].lifetime.rebalanceCount, 5);
assert.equal(rows[0].history.length, 1);
assert.match(rows[0].selectionLabel, /Observed vault/);
assert.match(rows[1].selectionLabel, /Earn vault/);
assert.equal(rows[2].stale, true);
const degraded = platformVaults([{ ...networks[0], status: "degraded" }]);
assert.equal(
  degraded[1].stale,
  true,
  "partial source failure cannot be labelled fresh",
);
assert.equal(degraded[1].networkStatus, "degraded");
assert.equal(rows[0].observedAt, observedAt);
const snapshotRows = platformVaults([
  {
    ...networks[0],
    observedAt: "2026-09-21T10:00:00Z",
    vaults: [
      { ...legacy, snapshotRetained: true, snapshotObservedAt: observedAt },
      {
        ...current,
        snapshotRetained: false,
        snapshotObservedAt: "2026-09-21T09:59:00Z",
      },
    ],
  },
]);
assert.equal(snapshotRows[0].stale, true);
assert.equal(snapshotRows[0].snapshotRetained, true);
assert.equal(
  snapshotRows[0].observedAt,
  observedAt,
  "retained row shows its own observation time",
);
assert.equal(
  snapshotRows[1].stale,
  false,
  "a fresh observed row does not inherit another contract’s retention flag",
);
assert.equal(snapshotRows[1].observedAt, "2026-09-21T09:59:00Z");
const noSnapshotTime = platformVaults([
  {
    ...networks[0],
    vaults: [{ ...legacy, snapshotRetained: true, snapshotObservedAt: null }],
  },
])[0];
assert.equal(
  noSnapshotTime.observedAt,
  null,
  "missing retained observation time cannot fall back to the newer network time",
);
assert.equal(choosePlatformVault(rows), rows[1]);
assert.equal(
  choosePlatformVault(rows, rows[0].key),
  rows[0],
  "explicit legacy selection is respected",
);
assert.equal(choosePlatformVault(rows, "removed-vault"), rows[1]);
assert.equal(choosePlatformVault([rows[0]]), rows[0]);
assert.equal(choosePlatformVault([]), null);
assert.deepEqual(platformVaults([]), []);
assert.equal(
  choosePlatformVault([
    { ...rows[0], assets: 10 },
    { ...rows[1], assets: null },
  ]).isEarnVault,
  true,
);

const event = (
  id,
  vaultAddress,
  timestamp = observedAt,
  type = "RebalanceExecuted",
) => ({
  id,
  vaultAddress,
  timestamp,
  type,
  txHash: `0x${"ab".repeat(32)}`,
  blockNumber: 100,
  assets: null,
  cost: null,
});
const eventNetworks = [
  {
    ...networks[0],
    eventsRetained: true,
    eventsObservedAt: "2026-08-11T00:00:00Z",
    events: [
      event("legacy", legacyAddress),
      event("current", supported[0].address, "2026-08-10T13:00:00Z"),
      event("unknown", null),
      event("missing-time", current.address, null),
      event("deposit", current.address, observedAt, "Deposit"),
      event("malformed-address", "Thesauros USDC Vault"),
    ],
  },
  { ...networks[1], events: [event("another-chain", current.address)] },
];
const all = scopedEvents(eventNetworks);
assert.equal(all.length, 7);
assert.equal(all[0].id, "current");
assert.equal(all.at(-1).id, "missing-time");
assert.equal(all.find((e) => e.id === "unknown").scope, "network");
assert.equal(all.find((e) => e.id === "legacy").scope, "vault");
assert.equal(all.find((e) => e.id === "malformed-address").vaultAddress, null);
const selected = scopedEvents(eventNetworks, rows[1], "RebalanceExecuted");
assert.deepEqual(
  selected.map((e) => e.id),
  ["current", "unknown", "malformed-address", "missing-time"],
);
assert.equal(selected[0].stale, true);
assert.equal(selected[0].observedAt, "2026-08-11T00:00:00Z");
assert.equal(selected[0].network, "Arbitrum");
assert.equal(selected[0].assets, null);
assert.equal(
  selected[1].scope,
  "network",
  "unknown events remain network-wide with a selected vault",
);
assert.equal(scopedEvents(eventNetworks, rows[1], "Deposit").length, 1);
assert.equal(scopedEvents(eventNetworks, rows[1], "all").length, 5);
assert.equal(scopedEvents(eventNetworks, { ...rows[1], chainId: 1 }).length, 0);
assert.deepEqual(scopedEvents([]), []);

// Use a deliberately old source series: wall-clock time must never empty it.
const points = [
  { timestamp: "2001-02-01T00:00:00Z", apy: 3, marker: "latest" },
  { timestamp: "2001-01-31T00:00:00Z", apy: 0 },
  { timestamp: "2001-01-30T23:59:59Z", apy: 4 },
  { timestamp: "2001-01-25T00:00:00Z", apy: 5 },
  { timestamp: "2001-01-24T23:59:59Z", apy: 6 },
  { timestamp: "2001-01-02T00:00:00Z", apy: 7 },
  { timestamp: "2001-01-01T23:59:59Z", apy: 8 },
  { timestamp: "invalid", apy: 5 },
  { timestamp: "2001-01-31T12:00:00Z", apy: null },
  null,
];
const unchanged = structuredClone(points);
assert.deepEqual(historyPeriod(points, "24h"), [
  points[1],
  points[8],
  points[0],
]);
assert.equal(historyPeriod(points, "7d").length, 5);
assert.equal(historyPeriod(points, "30d").length, 7);
assert.equal(historyPeriod(points, "all").length, 8);
assert.deepEqual(
  points,
  unchanged,
  "filters do not mutate shared source history",
);
assert.equal(
  historyPeriod(points, "24h").at(-1),
  points[0],
  "timestamps and source point fields survive untouched",
);
assert.deepEqual(historyPeriod([], "24h"), []);
assert.equal(
  historyPeriod([{ timestamp: observedAt, apy: 5 }], "7d").length,
  1,
  "a single point remains a single point, never a manufactured line",
);
const latestGap = { timestamp: "2001-02-02T00:00:00Z", apy: null };
assert.deepEqual(
  historyPeriod([...points, latestGap], "24h"),
  [points[0], latestGap],
  "a missing-rate observation anchors the period and remains a visible gap",
);
assert.throws(() => historyPeriod(points, "90d"), RangeError);

const providerAddress = (digit) => "0x" + digit.repeat(40);
const chainRow = {
  id: "arbitrum",
  status: "ready",
  totalAssets: "100123456",
  rateRay: (5n * 10n ** 25n).toString(),
  complete: true,
  observedAt: "2026-09-21T11:23:45.000Z",
  blockNumber: "507000001",
  providers: [
    {
      address: providerAddress("1"),
      name: "Morpho_Provider",
      assets: "60000000",
    },
    {
      address: providerAddress("2"),
      name: "Morpho_Provider",
      assets: "20000000",
    },
    {
      address: providerAddress("3"),
      name: "Aave_V3_Provider",
      assets: "20000000",
    },
    {
      address: providerAddress("4"),
      name: "Compound_V3_Provider",
      assets: "0",
    },
  ],
};
const unchangedChainRow = structuredClone(chainRow);
const onchain = onchainPlatformSnapshot([chainRow], rows[1]);
assert.equal(onchain.assets, 100.123456, "raw USDC units use six decimals");
assert.equal(onchain.assetsRaw, "100123456");
assert.equal(
  onchain.grossApr,
  5,
  "ray APR becomes percentage points, without compounding",
);
assert.equal(onchain.rateKind, "apr");
assert.equal(onchain.chainId, 42161);
assert.equal(onchain.address, supported[0].address);
assert.equal(
  onchain.configuredProviders,
  4,
  "idle providers still count as configured",
);
assert.equal(
  onchain.providers.length,
  2,
  "protocol grouping includes two Morpho adapters and omits idle balances",
);
assert.equal(onchain.providers[0].name, "Morpho");
assert.equal(onchain.providers[0].balance, 80);
assert.equal(onchain.providers[0].share, 80);
assert.equal(onchain.providers[0].count, 2);
assert.equal(
  onchain.providers[0].address,
  null,
  "a protocol aggregate must not acquire a fake adapter address",
);
assert.ok(
  onchain.providers.every((provider) => provider.apy === null),
  "APR is never inserted into APY fields",
);
assert.equal(onchain.allocationComplete, true);
assert.equal(onchain.observedAt, chainRow.observedAt);
assert.equal(onchain.blockNumber, "507000001");
assert.equal(
  onchain.source,
  `${supported[0].explorer}/address/${supported[0].address}`,
);
assert.equal(
  Object.hasOwn(onchain, "history"),
  false,
  "a current RPC read does not create performance history",
);
assert.deepEqual(chainRow, unchangedChainRow);
assert.equal(
  onchainPlatformSnapshot([chainRow], rows[0]),
  null,
  "legacy contract selection cannot receive current Earn assets",
);
assert.equal(
  onchainPlatformSnapshot([chainRow], { ...rows[1], chainId: 8453 }),
  null,
  "matching address without chain is insufficient",
);
assert.equal(
  onchainPlatformSnapshot([{ ...chainRow, id: "base" }], rows[1]),
  null,
  "another account-row id cannot supply the selected contract",
);
assert.equal(
  onchainPlatformSnapshot([{ ...chainRow, status: "unavailable" }], rows[1]),
  null,
  "a stale account row retaining old values is not a ready observation",
);
assert.equal(onchainPlatformSnapshot([], rows[1]), null);
assert.equal(onchainPlatformSnapshot([chainRow], null), null);
const partialOnchain = onchainPlatformSnapshot(
  [
    {
      ...chainRow,
      complete: false,
      providers: chainRow.providers.map((provider, index) =>
        index === 0 ? { ...provider, assets: null } : provider,
      ),
    },
  ],
  rows[1],
);
assert.equal(
  partialOnchain.assets,
  100.123456,
  "vault total remains usable when a provider read fails",
);
assert.equal(
  partialOnchain.grossApr,
  null,
  "partial provider reads must not produce a complete-looking gross rate",
);
assert.equal(partialOnchain.rateRay, null);
assert.equal(partialOnchain.allocationComplete, false);
assert.ok(
  partialOnchain.providers.every((provider) => provider.share === null),
);
assert.equal(
  partialOnchain.providers.find((provider) => provider.name === "Morpho")
    .balance,
  null,
  "one missing adapter makes its protocol aggregate unknown",
);
const malformedOnchain = onchainPlatformSnapshot(
  [
    {
      ...chainRow,
      totalAssets: "invalid",
      rateRay: "-1",
      blockNumber: "no-block",
      observedAt: "no-date",
    },
  ],
  rows[1],
);
assert.equal(malformedOnchain.assets, null);
assert.equal(malformedOnchain.grossApr, null);
assert.equal(malformedOnchain.blockNumber, null);
assert.equal(malformedOnchain.observedAt, null);
const noAllocation = onchainPlatformSnapshot(
  [{ ...chainRow, providers: [], complete: false }],
  rows[1],
);
assert.equal(noAllocation.assets, 100.123456);
assert.equal(noAllocation.grossApr, null);
assert.equal(noAllocation.allocationComplete, false);
assert.deepEqual(noAllocation.providers, []);
const zeroChainRow = onchainPlatformSnapshot(
  [{ ...chainRow, totalAssets: "0", rateRay: "0" }],
  rows[1],
);
assert.equal(zeroChainRow.assets, 0);
assert.equal(zeroChainRow.grossApr, 0);
console.log(
  "PASS: chain-and-address selection, observed-vault fallback, scoped and network-wide events, source freshness, null balances, retained-date history windows and no interpolation.",
);
console.log(
  "PASS: exact-contract onchain summaries, six-decimal assets, gross APR units, grouped allocation coverage, retained failures and separate source metadata.",
);

const portfolioSources = [
  {
    key: "arbitrum",
    name: "Arbitrum",
    chainId: 42161,
    vaults: [
      {
        address: supported[0].address,
        token: "USDC",
        assets: 999,
        apy: 4,
        providers: [],
      },
    ],
  },
  {
    key: "base",
    name: "Base",
    chainId: 8453,
    vaults: [
      {
        address: supported[1].address,
        token: "USDC",
        assets: 20,
        apy: 5,
        providers: [],
      },
    ],
  },
  {
    key: "plasma",
    name: "Plasma",
    chainId: 9745,
    vaults: [
      {
        address: legacyAddress,
        token: "USDT0",
        assets: 7,
        apy: 6,
        providers: [],
      },
    ],
  },
];
const portfolioRead = {
  id: "arbitrum",
  status: "ready",
  totalAssets: "100000000",
  rateRay: "40000000000000000000000000",
  observedAt,
  blockNumber: "123",
  complete: true,
  providers: [
    { address: legacyAddress, name: "Aave_V3_Provider", assets: "100000000" },
  ],
};
const portfolio = platformPortfolio(portfolioSources, [portfolioRead]);
assert.equal(portfolio.entries.length, 3);
assert.equal(portfolio.networks, 3);
assert.equal(
  portfolio.totals.find((t) => t.token === "USDC").assets,
  120,
  "Contract assets override matching monitor balance exactly once",
);
assert.equal(
  portfolio.totals.find((t) => t.token === "USDT0").assets,
  7,
  "USDT0 must never be silently added to USDC",
);
assert.equal(
  portfolio.entries.find((r) => r.networkKey === "arbitrum").rateKind,
  "APR",
);
assert.equal(
  portfolio.entries.find((r) => r.networkKey === "base").rateKind,
  "APY",
  "No average or APR relabelling",
);
const duplicate = platformPortfolio(
  [...portfolioSources, portfolioSources[0]],
  [portfolioRead],
);
assert.equal(
  duplicate.totals.find((t) => t.token === "USDC").assets,
  120,
  "Repeated contract records are not double-counted",
);
const emptyPortfolio = platformPortfolio([], []);
assert.equal(
  emptyPortfolio.totals[0].assets,
  null,
  "Missing observations are not zero balances",
);
assert.equal(emptyPortfolio.totals[0].reporting, 0);
assert.equal(
  emptyPortfolio.totals[0].count,
  2,
  "Configured Earn vaults remain selectable while loading",
);
const partialPortfolio = platformPortfolio([], [portfolioRead]);
assert.equal(partialPortfolio.totals[0].assets, 100);
assert.equal(partialPortfolio.totals[0].reporting, 1);
assert.equal(
  partialPortfolio.totals[0].count,
  2,
  "Partial totals preserve coverage",
);
assert.equal(
  partialPortfolio.entries.find((r) => r.networkKey === "base").displayRate,
  null,
);
console.log(
  "PASS: portfolio totals preserve token units, contract identity, rate type and partial coverage.",
);
