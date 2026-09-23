import assert from "node:assert/strict";
import {
  assetTotals,
  csvContent,
  filterNetworks,
  toggleNetwork,
  vaultReport,
  vaultRows,
} from "../lib/workspace-view.mjs";

const make = (name, key, token, assets, stale = false) => ({
  name,
  key,
  stale,
  status: "available",
  observedAt: "2026-09-20T12:00:00Z",
  vaults: [
    { address: "0x123", token, assets, apy: assets === null ? null : 4.5 },
  ],
});
const networks = [
  make("Base", "base", "USDC", 100),
  make("Arbitrum", "arb", "USDC", 25, true),
  make("Plasma", "plasma", "USDT0", 40),
  make("Monad", "monad", "USDC", null),
];
const names = networks.map((network) => network.name);
assert.equal(
  filterNetworks(networks, null).length,
  4,
  "All networks is the default",
);
assert.deepEqual(
  filterNetworks(networks, []),
  [],
  "No selection is not silently interpreted as all",
);
assert.deepEqual(
  filterNetworks(networks, ["Base", "Plasma"]).map((n) => n.name),
  ["Base", "Plasma"],
  "Arbitrary subsets work",
);
assert.deepEqual(toggleNetwork(null, "Base", names), [
  "Arbitrum",
  "Plasma",
  "Monad",
]);
assert.equal(
  toggleNetwork(["Arbitrum", "Plasma", "Monad"], "Base", names),
  null,
  "Checking the final network restores all",
);
assert.equal(
  filterNetworks([...networks, make("Ethereum", "eth", "USDC", 2)], null)
    .length,
  5,
  "All includes newly discovered networks",
);
assert.deepEqual(
  filterNetworks(networks, ["Ethereum"]),
  [],
  "Unsupported scopes remain empty",
);
assert.equal(
  new Set(vaultRows(networks).map((v) => v.id)).size,
  4,
  "The same address on different chains remains distinct",
);
assert.deepEqual(
  assetTotals(networks),
  [
    { token: "USDC", assets: 125, reporting: 2, count: 3, stale: true },
    { token: "USDT0", assets: 40, reporting: 1, count: 1, stale: false },
  ],
  "Totals preserve token units, incomplete coverage and stale data",
);
assert.equal(
  assetTotals([make("Base", "base", "USDC", null)])[0].assets,
  null,
  "Missing balances are not zero",
);
assert.equal(
  assetTotals([make("Base", "base", "USDC", 0)])[0].assets,
  0,
  "An actual zero is retained",
);
const csv = vaultReport(filterNetworks(networks, ["Arbitrum", "Monad"]));
assert(
  csv.includes("Arbitrum") &&
    csv.includes("Monad") &&
    !csv.includes("Base") &&
    !csv.includes("Plasma"),
  "Export follows selected networks",
);
assert(
  csv.includes("Last received") && csv.includes("Unavailable"),
  "Export identifies stale and missing data",
);
const degraded = make("Base", "base", "USDC", 100);
degraded.status = "degraded";
assert(
  vaultReport([degraded]).includes("Last received"),
  "Degraded RPC is not exported as current data",
);
assert.equal(
  csvContent([["=SUM(A1)", "a,b", 'a"b', null, -2]]),
  '\"\'=SUM(A1)\",\"a,b\",\"a\"\"b\",\"\",\"-2\"',
  "CSV quotes values and neutralizes spreadsheet formulas without changing numbers",
);
assert(
  vaultReport([{ name: "Base", vaults: [] }]).includes(
    '"Base","","","","","Unavailable",""',
  ),
  "Missing network data remains visible in exports",
);
console.log("Workspace selection and reporting: 16 checks passed.");
