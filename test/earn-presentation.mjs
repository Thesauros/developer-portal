import assert from "node:assert/strict";
import {
  allocationSummary,
  balanceLabel,
  amountFeedback,
  marketComparison,
  totalUnit,
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
// The table and the detail view read one comparison, and a loss stays visible.
{
  const day = (t, v) => ({ t, v });
  const below = marketComparison(
    [day(1, 4), day(2, 4)],
    [day(1, 4.5), day(2, 4.7)],
  );
  assert.equal(below.apr30d, 4);
  assert.ok(Math.abs(below.marketSpread30d + 0.6) < 1e-9);
  assert.equal(below.singleMarket, false);
  const one = marketComparison(
    [day(1, 4), day(2, 5)],
    [day(1, 4), day(2, 5)],
  );
  assert.equal(one.singleMarket, true);
  assert.equal(one.marketSpread30d, null);
  const none = marketComparison([], [day(1, 4)]);
  assert.equal(none.apr30d, null);
  assert.equal(none.marketSpread30d, null);
  assert.equal(totalUnit([{ token: "USDC" }, { token: "USDC" }]), "USDC");
  assert.equal(totalUnit([{ token: "USDC" }, { token: "USDT0" }]), "USD");
  assert.equal(totalUnit([{ token: "USDT0" }]), "USDT0");
  assert.equal(totalUnit([]), "USDC");
}

console.log(
  "Earn presentation: grouped allocations preserve balances and missing data; input feedback preserves exact USDC precision.",
);
