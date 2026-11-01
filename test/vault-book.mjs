import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY,
  indexRate,
  measuredRate,
  sharesForAmount,
  sinceMeasurable,
  valuationGaps,
} from "../lib/vault-metrics.mjs";
import {
  batchPosition,
  capitalMap,
  crosschainEarned,
  rateOnAllCapital,
} from "../lib/crosschain-feed.mjs";
import {
  buildBook,
  exposure,
  marketName,
  walletBalances,
} from "../lib/vault-book.mjs";

const now = 1000 * DAY;
const daily = (days, price = (i) => 1 + i * 0.0001, tvl = 50000) =>
  Array.from({ length: days + 1 }, (_, i) => ({
    at: now - (days - i) * DAY,
    price: price(i),
    tvl,
  }));

test("the 30-day rate is a simple annual rate over the real window", () => {
  const m = measuredRate(daily(60), 30, { now });
  assert.equal(m.status, "ok");
  assert.equal(m.days, 30);
  const expected = ((1.006 / 1.003 - 1) * 365 * 100) / 30;
  assert.ok(Math.abs(m.rate - expected) < 1e-9);
});
test("a vault under 10,000 USD at any point in the window is too small", () => {
  const points = daily(60).map((point, i) => ({
    ...point,
    tvl: i === 45 ? 9999 : 50000,
  }));
  assert.equal(measuredRate(points, 30, { now }).status, "small");
  assert.equal(measuredRate(daily(60, undefined, 11), 30, { now }).status, "small");
  // The dip is before the window, so it does not count.
  const earlier = daily(60).map((point, i) => ({
    ...point,
    tvl: i === 10 ? 1 : 50000,
  }));
  assert.equal(measuredRate(earlier, 30, { now }).status, "ok");
});
test("the window is never quietly replaced by a shorter or longer one", () => {
  // Readings 22 days and 0 days ago only: nothing close to 7 days back.
  const sparse = [
    { at: now - 22 * DAY, price: 1, tvl: 50000 },
    { at: now, price: 1.01, tvl: 50000 },
  ];
  assert.equal(measuredRate(sparse, 7, { now }).status, "gap");
  // Younger than the window: says it is since launch, and how long.
  const young = measuredRate(daily(12), 30, { now });
  assert.equal(young.sinceLaunch, true);
  assert.equal(young.days, 12);
  // Under a week says nothing at all.
  assert.equal(measuredRate(daily(3), 30, { now }).status, "young");
  assert.equal(measuredRate([], 30, { now }).status, "none");
});
test("a short window allows for readings a day apart", () => {
  // Readings at midnight, last one mid-day: nearly eight days, still a 7-day rate.
  const points = daily(20);
  points.at(-1).at += 0.84 * DAY;
  assert.equal(measuredRate(points, 7, { now: now + DAY }).status, "ok");
});
test("the longer record starts once a vault has enough in it to be measured", () => {
  const points = daily(60).map((point, i) => ({
    ...point,
    tvl: i < 20 ? 1 : 50000,
  }));
  const grown = sinceMeasurable(points, { now });
  assert.equal(grown.days, 40);
  assert.equal(grown.from, points[20].at);
  assert.equal(sinceMeasurable(daily(60, undefined, 11), { now }), null);
  assert.equal(sinceMeasurable(daily(3), { now }), null);
});
test("an old last reading is flagged", () => {
  const points = daily(60).map((point) => ({ ...point, at: point.at - 3 * DAY }));
  assert.equal(measuredRate(points, 30, { now }).stale, true);
  assert.equal(measuredRate(daily(60), 30, { now }).stale, false);
});
test("the Aave comparison uses the index over the same days, or nothing", () => {
  const points = daily(60).map((point, i) => ({
    ...point,
    index: 1 + i * 0.0002,
  }));
  const m = measuredRate(points, 30, { now });
  const rate = indexRate(points, m.from.at, m.to.at);
  const expected = ((1.012 / 1.006 - 1) * 365 * 100) / 30;
  assert.ok(Math.abs(rate - expected) < 1e-9);
  assert.equal(indexRate(points.slice(0, 5), m.from.at, m.to.at), null);
  assert.equal(indexRate([], m.from.at, m.to.at), null);
});
test("a valuation outage is dated and counted in the time out of date", () => {
  const hour = 3600000;
  const ticks = [];
  for (let i = 0; i < 48; i++) ticks.push({ at: i * hour });
  // 404.8 hours without a valuation, then hourly again for a day.
  const back = 47 * hour + 404.8 * hour;
  for (let i = 0; i < 24; i++) ticks.push({ at: back + i * hour });
  const end = back + 23 * hour;
  const { gaps, staleShare, since } = valuationGaps(ticks, {
    now: end,
    maxAgeMs: 2 * hour,
  });
  assert.equal(since, 0);
  assert.equal(gaps.length, 1);
  assert.ok(Math.abs(gaps[0].hours - 404.8) < 1e-9);
  assert.ok(Math.abs(staleShare - ((402.8 * hour) / end) * 100) < 1e-9);
  // A gap still running has no end.
  const running = valuationGaps(ticks, { now: end + 10 * hour });
  assert.equal(running.gaps.at(-1).to, null);
});

test("USDC to shares rounds up, never exceeds the balance and sweeps dust", () => {
  const price = 1001728000000000000n;
  const held = 10_000_000n;
  // Asked for 5 USDC: the shares pay at least that at this price.
  const shares = sharesForAmount(5_000_000n, price, held);
  assert.ok((shares * price) / 10n ** 18n >= 5_000_000n);
  assert.ok(((shares - 1n) * price) / 10n ** 18n < 5_000_000n);
  // Asked for more than the balance is worth: all of it, never more.
  assert.equal(sharesForAmount(50_000_000n, price, held), held);
  // A remainder under one cent goes along rather than being left behind.
  assert.equal(sharesForAmount(10_012_000n, price, held), held);
  assert.equal(sharesForAmount(0n, price, held), 0n);
});

const vault = {
  accounting: {
    cash: "505000000",
    pendingDeposits: "500000000",
    liabilities: "0",
    reserved: "0",
  },
  tick: { navBid: "11000000" },
};
const allocation = {
  chains: [
    {
      name: "Base",
      strategyValue: "4000000",
      totalAssets: "5000000",
      idle: "0",
      rateRay: String(6n * 10n ** 25n),
      markets: [],
    },
    {
      name: "Arbitrum",
      strategyValue: "2000000",
      totalAssets: "3000000",
      idle: "0",
      rateRay: String(3n * 10n ** 25n),
      markets: [],
    },
  ],
};
test("deposits still waiting and withdrawals owed are not capital at work", () => {
  const map = capitalMap(vault, allocation);
  assert.equal(map.held, 511);
  assert.equal(map.working, 11);
  assert.equal(map.free, 5);
  assert.equal(map.pendingDeposits, 500);
  // 500 USDC waiting to settle must not turn 2.73% into 0.06%.
  assert.ok(Math.abs(rateOnAllCapital(map) - 30 / 11) < 1e-9);
  const owing = capitalMap(
    {
      ...vault,
      accounting: {
        cash: "8000000",
        pendingDeposits: "0",
        liabilities: "6000000",
        reserved: "0",
      },
    },
    allocation,
  );
  assert.equal(owing.free, 2);
  assert.equal(owing.owed, 6);
});

const PRICE = 1100000n * 10n ** 12n;
const wallet = "0x1111111111111111111111111111111111111111";
const request = (fields) => ({ owner: wallet, receiver: wallet, ...fields });
test("a position counts every amount exactly once through a request's life", () => {
  const base = { address: wallet, shares: "1000000", rateBid: String(PRICE) };
  const value = (requests, shares = base.shares) =>
    batchPosition({ ...base, shares, requests });
  assert.equal(value([]).total, 1.1);
  // 10 USDC deposit: pending, then clearing, both at face value.
  const pending = value([
    request({ id: "1", kind: "deposit", state: "pending", amount: "10000000" }),
  ]);
  assert.equal(pending.arriving, 10);
  assert.equal(pending.total, 11.1);
  // Settled into 9.09 shares at the deposit price: now at the bid, not both.
  const ready = value([
    request({
      id: "1",
      kind: "deposit",
      state: "claimable",
      amount: "10000000",
      claimable: "9090909",
    }),
  ]);
  assert.equal(ready.arriving, 0);
  assert.ok(Math.abs(ready.ready - 9.999999) < 1e-6);
  // Once collected the shares are simply in the wallet.
  const claimed = value(
    [request({ id: "1", kind: "deposit", state: "claimed", amount: "10000000" })],
    "10090909",
  );
  assert.equal(claimed.ready, 0);
  assert.ok(Math.abs(claimed.total - 11.099999) < 1e-6);
  // Withdrawal: shares left the wallet, still counted, at the bid until settled.
  const leaving = value(
    [request({ id: "2", kind: "redeem", state: "pending", amount: "500000" })],
    "500000",
  );
  assert.equal(leaving.leaving, 0.55);
  assert.equal(leaving.total, 1.1);
  // Settled, waiting for funds: a fixed amount that no longer floats on the bid.
  const waiting = value(
    [
      request({
        id: "2",
        kind: "redeem",
        state: "awaiting_liquidity",
        amount: "500000",
        owed: "540000",
      }),
    ],
    "500000",
  );
  assert.equal(waiting.out, 0.54);
  assert.equal(waiting.total, 1.09);
  assert.equal(batchPosition(null), null);
});
test("earned is given only when the history explains the exact share balance", () => {
  const history = {
    coverage: { complete: true },
    truncated: false,
    events: [
      { type: "deposit_claimed", requestId: "1", shares: "9000000" },
      { type: "redeem_claimed", requestId: "2", assets: "2200000" },
    ],
  };
  const user = {
    address: wallet,
    rateBid: String(PRICE),
    shares: "7000000",
    truncated: false,
    requests: [
      request({ id: "1", kind: "deposit", state: "claimed", amount: "9000000" }),
      request({ id: "2", kind: "redeem", state: "claimed", amount: "2000000" }),
    ],
  };
  // Worth 7.70, 2.20 came out, 9.00 went in.
  assert.ok(Math.abs(crosschainEarned(user, history) - 0.9) < 1e-9);
  // Shares arrived from a transfer: unexplained, so no figure rather than a false one.
  assert.equal(crosschainEarned({ ...user, shares: "8000000" }, history), null);
  // A collect the index has not seen yet.
  assert.equal(
    crosschainEarned(user, { ...history, events: history.events.slice(0, 1) }),
    null,
  );
  assert.equal(
    crosschainEarned(user, { ...history, coverage: { complete: false } }),
    null,
  );
  assert.equal(crosschainEarned(user, { ...history, truncated: true }), null);
  // Someone else's withdrawal paid to this wallet is not this wallet's income.
  const stranger = {
    ...history,
    events: [
      ...history.events,
      { type: "redeem_claimed", requestId: "99", assets: "5000000" },
    ],
  };
  assert.ok(Math.abs(crosschainEarned(user, stranger) - 0.9) < 1e-9);
});

const standard = (id, network, token, tvl, providers) => ({
  id,
  network,
  token,
  decimals: 6,
  explorer: "https://example.invalid",
  address: "0x" + "a".repeat(40),
  tvl,
  apyNow: 4,
  providers,
  series: { vault: [], market: [] },
});
const market = {
  vaults: [
    standard("arbitrum", "Arbitrum", "USDC", 50000, [
      { name: "Compound V3", address: "0x1", share: 60, apy: 3, riskTier: "core" },
      {
        name: "Gauntlet Core Morpho",
        address: "0x2",
        share: 40,
        apy: 5,
        riskTier: "satellite",
      },
    ]),
    standard("base", "Base", "USDC", 1, [
      { name: "Aave V3", address: "0x3", share: 100, apy: 4, riskTier: "core" },
    ]),
    standard("monad", "Monad", "USDC", 6, [
      { name: "Aave V3", address: "0x4", share: 100, apy: 4, riskTier: "core" },
    ]),
    standard("plasma", "Plasma", "USDT0", 4, [
      { name: "Aave V3", address: "0x5", share: 100, apy: 4, riskTier: "core" },
    ]),
  ],
};
const chain = (id, cash, assets) => ({
  id,
  status: "ready",
  cash,
  shares: assets,
  positionAssets: assets,
  totalAssets: null,
  minAssets: "1000000",
  depositPaused: false,
  withdrawPaused: false,
});
const batchFeed = {
  vault: {
    ...vault,
    accounting: {
      cash: "5000000",
      pendingDeposits: "0",
      liabilities: "0",
      reserved: "0",
    },
    tick: { navBid: "11000000", rateBid: String(PRICE), ageSeconds: 60 },
    risk: { maxTickAge: 7200 },
    observedAt: now,
    fees: { performanceFee: "0", managementFee: "0" },
    limits: { minDeposit: "1000000" },
  },
  allocation,
  user: {
    address: wallet,
    shares: "1000000",
    cash: "7000000",
    rateBid: String(PRICE),
    requests: [],
  },
};
test("every vault comes out in one shape, the largest first", () => {
  const book = buildBook({ market, batch: batchFeed, now });
  assert.deepEqual(
    book.vaults.map((row) => row.id),
    ["arbitrum", "base-arbitrum", "monad", "plasma", "base"],
  );
  for (const row of book.vaults)
    for (const key of [
      "kind",
      "token",
      "networkLabel",
      "depositNetwork",
      "stage",
      "exit",
      "open",
      "measured",
      "allocation",
      "position",
      "risks",
      "audit",
    ])
      assert.ok(row[key] !== undefined, `${row.id} has ${key}`);
  assert.equal(book.byId.arbitrum.stage, "Live");
  assert.equal(book.byId.monad.stage, "Early");
  assert.equal(book.byId["base-arbitrum"].stage, "Pilot");
  assert.equal(book.byId["base-arbitrum"].networkLabel, "Base + Arbitrum");
  assert.equal(book.byId["base-arbitrum"].depositNetwork, "Base");
  assert.equal(book.byId["base-arbitrum"].audit.state, "none");
  assert.ok(book.byId["base-arbitrum"].notice.length >= 3);
  // Names from different sources line up.
  assert.equal(marketName("Gauntlet Core Morpho"), "Gauntlet Core");
  // A batch vault that leaves deposits closed still lets people out.
  assert.equal(book.byId["base-arbitrum"].open.deposits, false);
  assert.equal(book.byId["base-arbitrum"].open.withdrawals, true);
  const open = buildBook({ market, batch: batchFeed, depositsOpen: true, now });
  assert.equal(open.byId["base-arbitrum"].open.deposits, true);
  // A build without the batch vault simply has four.
  const four = buildBook({ market, includeBatch: false, now });
  assert.equal(four.vaults.length, 4);
});
test("the same USDC on Base counts once, and wallet money is never in the balance", () => {
  const book = buildBook({
    market,
    chainRows: [
      chain("arbitrum", "5000000000", "4000000"),
      chain("base", "7000000", "0"),
    ],
    batch: batchFeed,
    now,
  });
  const base = book.account.wallet.filter((row) => row.network === "Base");
  assert.equal(base.length, 1);
  assert.equal(base[0].amount, 7);
  assert.equal(
    walletBalances(book.vaults).reduce((sum, row) => sum + row.amount, 0),
    5007,
  );
  // 4.00 in Arbitrum and 1.10 in the batch vault; nothing from the wallets.
  assert.ok(Math.abs(book.account.balance - 5.1) < 1e-9);
  assert.equal(book.account.unit, "USDC");
});
test("a vault that cannot be read makes the total say so, and earned wait", () => {
  const book = buildBook({
    market,
    chainRows: [chain("arbitrum", "0", "4000000")],
    batch: batchFeed,
    now,
  });
  // Base, Monad and Plasma were not read: they are unknown, not zero.
  assert.equal(book.account.atLeast, true);
  assert.equal(book.account.earned, null);
  const mine = {
    vaults: [
      { vaultId: "arbitrum", balance: 4, reconciled: true, earned: 0.25 },
    ],
  };
  const known = buildBook({
    market,
    chainRows: [chain("arbitrum", "0", "4000000")],
    mine,
    includeBatch: false,
    now,
  });
  assert.equal(known.byId.arbitrum.position.earned, 0.25);
  const unexplained = buildBook({
    market,
    chainRows: [chain("arbitrum", "0", "4000000")],
    mine: {
      vaults: [
        { vaultId: "arbitrum", balance: 4, reconciled: false, earned: 0.25 },
      ],
    },
    includeBatch: false,
    now,
  });
  assert.equal(unexplained.byId.arbitrum.position.earned, null);
});
test("exposure adds up by market and by network, across vaults", () => {
  const book = buildBook({ market, batch: batchFeed, now });
  const byMarket = exposure(book.vaults, (row) => row.tvl);
  const total = byMarket.reduce((sum, row) => sum + row.amount, 0);
  assert.ok(Math.abs(total - (50000 + 1 + 6 + 4 + 11)) < 1e-6);
  assert.equal(byMarket[0].name, "Compound V3");
  assert.ok(Math.abs(byMarket.reduce((s, r) => s + r.share, 0) - 100) < 1e-9);
  const byNetwork = exposure(book.vaults, (row) => row.tvl, "network");
  assert.equal(byNetwork[0].name, "Arbitrum");
  assert.ok(byNetwork.some((row) => row.name === "Plasma"));
});
