import { test } from "node:test";
import assert from "node:assert/strict";
import { settledQuote } from "../lib/market-index.mjs";
import { blockNear } from "../lib/vault-samples.mjs";

const H = 3600000;
const day = Date.UTC(2026, 9, 20);
// Fixed readings at 04:00, 12:00 and 20:00 UTC the day before.
const fixed = [
  { at: day - 20 * H, rate: 3.7 },
  { at: day - 12 * H, rate: 3.69 },
  { at: day - 4 * H, rate: 3.71 },
];

test("a midnight jump in a quote does not count; the nearer reading stands in", () => {
  const q = settledQuote(fixed, day + 5 * 60000, 12.55);
  assert.equal(q.rate, 3.71);
  assert.equal(q.held, 12.55);
  assert.equal(q.at, day - 4 * H);
});

test("a quote within reach of the readings before counts as read", () => {
  const q = settledQuote(fixed, day + 5 * 60000, 4.6);
  assert.equal(q.rate, 4.6);
  assert.equal(q.held, undefined);
});

test("a new level counts once a later fixed reading confirms it", () => {
  // Before any fixed reading at the new level: held.
  assert.equal(settledQuote(fixed, day + 3 * H, 9.2).rate, 3.71);
  // The 04:00 reading at the new level confirms it.
  const confirmed = [...fixed, { at: day + 4 * H, rate: 9.1 }];
  assert.equal(settledQuote(confirmed, day + 7 * H, 9.2).rate, 9.2);
});

test("without two recent fixed readings a quote counts as read", () => {
  assert.equal(settledQuote([], day, 12.55).rate, 12.55);
  assert.equal(settledQuote(fixed, day + 3 * 24 * H, 12.55).rate, 12.55);
});

test("block search finds a time when the block time changed (Base 2 s to 0.2 s)", async () => {
  // Blocks every 2 s up to block 1,000,000, then every 0.2 s.
  const switchAt = 1_000_000n;
  const t0 = 1_700_000_000;
  const tsOf = (n) =>
    n <= switchAt ? t0 + Number(n) * 2 : t0 + Number(switchAt) * 2 + Number(n - switchAt) * 0.2;
  const head = 5_000_000n;
  let reads = 0;
  const getTimestamp = async (n) => {
    reads += 1;
    return BigInt(Math.floor(tsOf(n)));
  };
  for (const target of [tsOf(4_900_000n), tsOf(1_500_000n), tsOf(400_000n)]) {
    reads = 0;
    const found = await blockNear(getTimestamp, target, 1n, head, 0.2);
    assert.ok(found, "found a block");
    assert.ok(Math.abs(Number(found.ts) - target) <= 600, "within ten minutes");
    assert.ok(reads < 40, `few reads (${reads})`);
  }
});
