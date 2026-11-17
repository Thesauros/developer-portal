import assert from "node:assert/strict";
import { test } from "node:test";
import { positionSeries } from "../lib/crosschain-feed.mjs";

const DAY = 86400000;
const t0 = Date.UTC(2026, 10, 1);
const wad = (price) => BigInt(Math.round(price * 1e9)) * 10n ** 9n + "";
const units = (amount) => String(Math.round(amount * 1e6));
// A share that gains 0.01% a day.
const ticks = Array.from({ length: 40 }, (_, day) => ({
  at: t0 + day * DAY,
  rateBid: wad(1 + day * 0.0001),
}));
const priceOn = (day) => 1 + day * 0.0001;

test("a deposit counts at face value until it settles, then grows with the share price", () => {
  // 1,000 USDC requested on day 2, settled at the day-3 price, collected on day 5.
  const shares = 1000 / priceOn(3);
  const events = [
    { type: "deposit_requested", requestId: "1", at: t0 + 2 * DAY + 3600000, assets: units(1000) },
    { type: "deposit_claimed", requestId: "1", at: t0 + 5 * DAY, shares: units(shares) },
  ];
  const series = positionSeries(events, ticks, { now: t0 + 30 * DAY });
  assert.equal(series[0].at, t0 + 2 * DAY + 3600000);
  assert.equal(series[0].value, 1000);
  assert.equal(series[0].earned, 0);
  const last = series.at(-1);
  assert.ok(Math.abs(last.value - shares * priceOn(30)) < 0.01);
  assert.ok(Math.abs(last.earned - (shares * priceOn(30) - 1000)) < 0.01);
  assert.equal(last.invested, 1000);
  // Never below what went in while the price only rises.
  assert.ok(series.every((point) => point.value >= 1000 - 1e-9));
  // One point a day plus the moments something happened, in order.
  assert.ok(series.every((point, i) => i === 0 || point.at > series[i - 1].at));
});

test("a collected withdrawal leaves the balance and stays in what was earned", () => {
  const shares = 1000 / priceOn(1);
  const out = 400; // shares redeemed on day 10, settled at the day-11 price
  const paid = out * priceOn(11);
  const events = [
    { type: "deposit_requested", requestId: "1", at: t0 + DAY - 1000, assets: units(1000) },
    { type: "deposit_claimed", requestId: "1", at: t0 + 2 * DAY, shares: units(shares) },
    { type: "redeem_requested", requestId: "2", at: t0 + 10 * DAY + 1000, shares: units(out) },
    { type: "redeem_claimed", requestId: "2", at: t0 + 12 * DAY, assets: units(paid) },
  ];
  const series = positionSeries(events, ticks, { now: t0 + 20 * DAY });
  const last = series.at(-1);
  assert.ok(Math.abs(last.value - (shares - out) * priceOn(20)) < 0.01);
  assert.ok(Math.abs(last.invested - (1000 - paid)) < 0.01);
  // Earned is unchanged by taking money out: only the share price adds to it.
  const before = series.find((point) => point.at === t0 + 10 * DAY);
  const after = series.find((point) => point.at === t0 + 13 * DAY);
  assert.ok(after.earned > before.earned);
  assert.ok(after.earned - before.earned < 1);
  // While the withdrawal waits to be collected it is still the holder's money.
  const waiting = series.find((point) => point.at === t0 + 11 * DAY);
  assert.ok(Math.abs(waiting.value - shares * priceOn(11)) < 0.05);
});

test("a cancelled deposit comes back out, and a wallet with no requests has no chart", () => {
  const events = [
    { type: "deposit_requested", requestId: "7", at: t0 + DAY, assets: units(250) },
    { type: "request_cancelled", requestId: "7", at: t0 + DAY + 600000 },
  ];
  const series = positionSeries(events, ticks, { now: t0 + 3 * DAY });
  assert.equal(series[0].value, 250);
  assert.equal(series.at(-1).value, 0);
  assert.equal(series.at(-1).invested, 0);
  assert.equal(series.at(-1).earned, 0);
  assert.deepEqual(positionSeries([], ticks), []);
  assert.deepEqual(positionSeries(events, []), []);
});

test("an instant exit takes its shares out at once", () => {
  const shares = 100 / priceOn(0);
  const events = [
    { type: "deposit_requested", requestId: "1", at: t0, assets: units(100) },
    { type: "deposit_claimed", requestId: "1", at: t0 + DAY, shares: units(shares) },
    { type: "instant_exit", at: t0 + 5 * DAY, shares: units(20), assets: units(20 * priceOn(5) * 0.9975) },
  ];
  const last = positionSeries(events, ticks, { now: t0 + 6 * DAY }).at(-1);
  assert.ok(Math.abs(last.value - (shares - 20) * priceOn(6)) < 0.01);
});

test("a falling share price shows as a loss once the shares are collected", () => {
  const falling = Array.from({ length: 10 }, (_, day) => ({
    at: t0 + day * DAY,
    rateBid: wad(1 - day * 0.003),
  }));
  const events = [
    { type: "deposit_requested", requestId: "1", at: t0 + 1000, assets: units(1000) },
    { type: "deposit_claimed", requestId: "1", at: t0 + 3600000, shares: units(1000) },
  ];
  const last = positionSeries(events, falling, { now: t0 + 9 * DAY }).at(-1);
  assert.ok(Math.abs(last.value - 973) < 0.01, String(last.value));
  assert.ok(Math.abs(last.earned + 27) < 0.01, String(last.earned));
});

test("a request and its cancellation in one block are read in order, whatever order they arrive in", () => {
  const at = t0 + DAY;
  const events = [
    { type: "request_cancelled", requestId: "7", at, blockNumber: 10, logIndex: 5 },
    { type: "deposit_requested", requestId: "7", at, blockNumber: 10, logIndex: 2, assets: units(250) },
  ];
  const series = positionSeries(events, ticks, { now: t0 + 3 * DAY });
  assert.equal(series.at(-1).value, 0);
  assert.equal(series.at(-1).invested, 0);
});

test("a wallet's requests read in USDC, and only money that moved counts in the totals", async () => {
  const { requestRows } = await import("../lib/crosschain-feed.mjs");
  const rows = requestRows(
    [
      { type: "deposit_requested", requestId: "1", assets: "50000000", txHash: "0xa", logIndex: 0, at: 1 },
      { type: "deposit_claimed", requestId: "1", shares: "49870000", txHash: "0xb", logIndex: 0, at: 2 },
      { type: "deposit_requested", requestId: "2", assets: "40000000", txHash: "0xc", logIndex: 0, at: 3 },
      { type: "request_cancelled", requestId: "2", txHash: "0xd", logIndex: 0, at: 4 },
      { type: "redeem_requested", requestId: "3", shares: "99730000", txHash: "0xe", logIndex: 0, at: 5 },
      { type: "redeem_claimed", requestId: "3", assets: "100000000", txHash: "0xf", logIndex: 0, at: 6 },
      { type: "tick", txHash: "0x10", logIndex: 0, at: 7 },
    ],
    "1002707000000000000",
  );
  assert.equal(rows.length, 6);
  const by = Object.fromEntries(rows.map((row) => [row.txHash, row]));
  // The shares of a collected deposit stand for exactly what was requested.
  assert.equal(by["0xb"].stands, 50);
  assert.equal(by["0xb"].about, false);
  // A withdrawal that has not settled is valued at today's price, as an estimate.
  assert.ok(Math.abs(by["0xe"].stands - 100) < 0.01);
  assert.equal(by["0xe"].about, true);
  const total = (flow) =>
    rows.filter((row) => row.flow === flow).reduce((sum, row) => sum + row.amount, 0);
  // The cancelled request never went in; the withdrawal counts once, when collected.
  assert.equal(total("in"), 50);
  assert.equal(total("out"), 100);
  // Without a price a share amount is left as shares.
  assert.equal(requestRows([{ type: "redeem_requested", requestId: "9", shares: "1000000", txHash: "0x1", logIndex: 0 }]).at(0).stands, null);
});

test("the balance steps at the moment money moves, not over the hours before it", () => {
  const hour = 3600000;
  const series = positionSeries(
    [
      { type: "deposit_requested", requestId: "1", assets: "1000000000", at: 10 * hour },
      { type: "deposit_claimed", requestId: "1", shares: "1000000000", at: 12 * hour },
      { type: "redeem_requested", requestId: "2", shares: "100000000", at: 20 * hour },
      { type: "redeem_claimed", requestId: "2", assets: "100000000", at: 30 * hour },
    ],
    [{ at: 0, price: 1 }],
    { now: 40 * hour, step: 1000 * hour },
  );
  const just = (time) => series.find((point) => point.at === time);
  // An instant before the withdrawal is collected the balance is still whole.
  assert.equal(just(30 * hour - 1).value, 1000);
  assert.equal(just(30 * hour - 1).invested, 1000);
  assert.equal(just(30 * hour).value, 900);
  assert.equal(just(30 * hour).invested, 900);
  // Nothing was earned or lost at any point: the line and the step agree.
  assert.ok(series.every((point) => Math.abs(point.earned) < 1e-9));
});
