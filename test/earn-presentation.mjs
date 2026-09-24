import assert from "node:assert/strict";
import {
  allocationSummary,
  balanceLabel,
  amountFeedback,
} from "../lib/earn-presentation.mjs";
const provider = (address, name, assets) => ({ address, name, assets });
const rows = [
  provider("a", "Morpho_Provider", "45000000"),
  provider("b", "Aave_V3_Provider", "40000000"),
  provider("c", "Morpho_Provider", "15000000"),
  provider("d", "Compound_V3_Provider", "0"),
];
let summary = allocationSummary(rows, true);
assert.deepEqual(
  summary.rows.map((r) => [r.name, r.assets, r.shareBps, r.count]),
  [
    ["Morpho", 60000000n, 6000, 2],
    ["Aave", 40000000n, 4000, 1],
  ],
);
assert.equal(summary.idle, 1);
assert.equal(summary.total, 100000000n);
summary = allocationSummary(
  [...rows, provider("e", "Morpho_Provider", null)],
  true,
);
assert.equal(summary.coverage, false);
assert.equal(summary.rows.find((r) => r.name === "Morpho").assets, null);
assert(summary.rows.every((r) => r.shareBps === null));
assert(allocationSummary(rows, false).rows.every((r) => r.shareBps === null));
assert.equal(
  allocationSummary(
    [
      provider("a", "Lending provider", "1"),
      provider("b", "Lending provider", "2"),
    ],
    true,
  ).rows.length,
  2,
);
assert.equal(
  allocationSummary([provider("d", "Compound_V3_Provider", "0")], true).rows
    .length,
  0,
);
assert.equal(balanceLabel("1"), "<0.01");
assert.equal(balanceLabel("0"), "0.00");
assert.equal(balanceLabel(null), "—");
const position = {
  status: "ready",
  cash: "5123456",
  minAssets: "1000000",
  positionAssets: "1234567",
};
assert.equal(
  amountFeedback({ amount: "5.123456", mode: "deposit", position }),
  "",
);
assert.match(
  amountFeedback({ amount: "5.123457", mode: "deposit", position }),
  /above your wallet/,
);
assert.match(
  amountFeedback({ amount: "0.9", mode: "deposit", position }),
  /minimum deposit/,
);
assert.match(
  amountFeedback({ amount: "1.234568", mode: "withdraw", position }),
  /above your current Earn/,
);
assert.match(
  amountFeedback({ amount: "1e6", mode: "deposit", position }),
  /decimal/,
);
assert.equal(
  amountFeedback({ amount: "1.234567", mode: "withdraw", position, all: true }),
  "",
);
console.log(
  "Earn presentation: grouped allocations preserve balances and missing data; input feedback preserves exact USDC precision.",
);
