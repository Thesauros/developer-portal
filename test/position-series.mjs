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
