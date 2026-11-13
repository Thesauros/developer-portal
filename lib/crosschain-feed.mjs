import { marketInfo } from "./crosschain-config.mjs";
// Every screen consumes the same verified sources. A backend mismatch is separate
// from an allocation or account read failure.

// Preserve caller priority: verified active requests can precede manually
// tracked IDs while the event index catches up. Never send an invalid or
// oversized request list to the account endpoint.
export function mergeTrackedRequestIds(primary = [], secondary = []) {
  const ids = [],
    seen = new Set();
  for (const group of [primary, secondary]) {
    if (!Array.isArray(group)) continue;
    for (const id of group) {
      if (
        typeof id !== "string" ||
        !/^(?:0|[1-9]\d{0,77})$/.test(id) ||
        BigInt(id) >= 2n ** 256n ||
        seen.has(id)
      )
        continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === 20) return ids;
    }
  }
  return ids;
}

export async function loadCrosschainFeed(owner, ids, read) {
  const sources = [
    "vault",
    "allocation",
    owner ? "user?requests=" + ids.join(",") : null,
    "health",
    "backend-base",
    "backend-arbitrum",
    owner ? "activity" : null,
  ];
  const results = await Promise.allSettled(
    sources.map((resource) =>
      resource ? read(resource) : Promise.resolve(null),
    ),
  );
  const data = (index) =>
    results[index].status === "fulfilled" ? results[index].value : null;
  const failure = (index) =>
    results[index].status === "rejected" ? results[index].reason.message : "";
  const backendErrors = [3, 4, 5].map(failure).filter(Boolean);
  return {
    vault: data(0),
    allocation: data(1),
    user: data(2),
    health: data(3),
    activity: data(6),
    sourceErrors: {
      vault: failure(0),
      allocation: failure(1),
      account: failure(2),
      activity: failure(6),
    },
    backendError: [...new Set(backendErrors)].join(" "),
    observedAt: Date.now(),
  };
}
const usdc = (value) => (value == null ? null : Number(value) / 1e6);
const rayPercent = (value) => (value == null ? null : Number(value) / 1e25);

// Everything the vault holds, followed down to each lending market. A strategy
// also holds money that is not the vault's, so each market counts only the
// vault's share of it, and the parts add up to what the vault holds.
export function capitalMap(vault, allocation) {
  if (!vault || !allocation?.chains) return null;
  const networks = allocation.chains.map((chain) => {
    const value = usdc(chain.strategyValue) || 0;
    const total = usdc(chain.totalAssets);
    const ownShare = total ? value / total : 1;
    const markets = (chain.markets || []).map((row) => {
      const info = marketInfo(row.address);
      const amount = row.assets == null ? null : usdc(row.assets) * ownShare;
      return {
        key: chain.name + ":" + row.address,
        address: row.address,
        network: chain.name,
        explorer: chain.explorer,
        name: info.name,
        logo: info.logo,
        tier: info.tier,
        amount,
        rate: rayPercent(row.rateRay),
        limit: row.capBps == null ? null : Number(row.capBps) / 100,
      };
    });
    return {
      key: chain.name,
      name: chain.name,
      role: chain.role,
      amount: value + (usdc(chain.idle) || 0),
      idle: usdc(chain.idle) || 0,
      rate: rayPercent(chain.rateRay),
      markets,
    };
  });
  const cash = usdc(vault.accounting.cash);
  const pendingDeposits = usdc(vault.accounting.pendingDeposits) || 0;
  const owed = usdc(vault.accounting.liabilities) || 0;
  // Cash holds money that is not the vault's to lend or pay out: deposits still
  // waiting to become shares and withdrawals already owed.
  const free = Math.max(cash - pendingDeposits - owed, 0);
  const lent = networks.reduce((sum, net) => sum + net.amount, 0);
  const held = lent + cash;
  const working = lent + free;
  const share = (amount) =>
    held && amount != null ? (amount / held) * 100 : 0;
  return {
    held,
    working,
    cash,
    free,
    cashShare: share(free),
    pendingShare: share(pendingDeposits),
    owedShare: share(owed),
    networks: networks.map((net) => ({
      ...net,
      share: share(net.amount),
      markets: net.markets.map((row) => ({ ...row, share: share(row.amount) })),
    })),
    pendingDeposits,
    owed,
  };
}

// Every approved market in one list, largest first, the ones in use on top.
export const allMarkets = (map) =>
  (map?.networks || [])
    .flatMap((net) => net.markets)
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));

// The one current rate for the vault: each network's rate weighted by its share of
// the capital at work, with free cash earning nothing. Deposits that have not yet
// become shares and withdrawals already owed are not capital at work. Unknown if
// any strategy's rate is unknown.
export function rateOnAllCapital(map) {
  if (!map?.working) return null;
  let weighted = 0;
  for (const net of map.networks) {
    if (net.amount > 0 && net.rate == null) return null;
    weighted += net.amount * (net.rate || 0);
  }
  return weighted / map.working;
}

const big = (value) => BigInt(value ?? 0);
const WAD = 10n ** 18n;

// What a wallet has in the vault, read from one response, in every request state.
// Each amount sits in exactly one bucket, so nothing is counted twice or dropped:
//   earning   shares in the wallet, at the bid
//   arriving  deposits not yet settled, at face value
//   ready     settled deposits (shares at the bid) waiting to be collected
//   leaving   withdrawals not yet settled, at the bid
//   out       settled withdrawals at their fixed value, waiting for funds or collection
export function batchPosition(user) {
  if (!user || !/^\d+$/.test(String(user.rateBid ?? ""))) return null;
  const bid = big(user.rateBid);
  let earning = (big(user.shares) * bid) / WAD,
    arriving = 0n,
    ready = 0n,
    leaving = 0n,
    out = 0n;
  for (const request of user.requests || []) {
    if (["claimed", "cancelled"].includes(request.state)) continue;
    const amount = big(request.amount);
    if (request.kind === "deposit") {
      if (request.state === "claimable")
        ready += (big(request.claimable) * bid) / WAD;
      else arriving += amount;
    } else if (["claimable", "awaiting_liquidity"].includes(request.state))
      out += big(request.owed ?? request.claimable);
    else leaving += (amount * bid) / WAD;
  }
  const units = { earning, arriving, ready, leaving, out };
  const total = earning + arriving + ready + leaving + out;
  return {
    total: Number(total) / 1e6,
    earning: Number(units.earning) / 1e6,
    arriving: Number(units.arriving) / 1e6,
    ready: Number(units.ready) / 1e6,
    leaving: Number(units.leaving) / 1e6,
    out: Number(units.out) / 1e6,
    totalUnits: total.toString(),
  };
}

// What a holder has earned: what the position is worth now plus what came out,
// minus what went in. Null unless the history explains the wallet's exact share
// balance; a transfer, an unindexed claim or a truncated list gives no figure.
export function crosschainEarned(user, history) {
  if (!user || !history?.coverage?.complete || history.truncated) return null;
  if (user.truncated) return null;
  const position = batchPosition(user);
  if (!position) return null;
  const events = history.events || [];
  const byRequest = (type) =>
    new Map(
      events
        .filter((event) => event.type === type)
        .map((event) => [String(event.requestId), event]),
    );
  const sharesIn = byRequest("deposit_claimed"),
    assetsOut = byRequest("redeem_claimed");
  let invested = 0n,
    out = 0n,
    shares = 0n;
  for (const request of user.requests || []) {
    if (request.state === "cancelled") continue;
    const amount = big(request.amount),
      id = String(request.id);
    if (request.kind === "deposit") {
      invested += amount;
      if (request.state === "claimed") {
        if (!sharesIn.has(id)) return null;
        shares += big(sharesIn.get(id).shares);
      }
    } else {
      shares -= amount;
      if (request.state === "claimed") {
        if (!assetsOut.has(id)) return null;
        out += big(assetsOut.get(id).assets);
      }
    }
  }
  const owner = String(user.address || "").toLowerCase();
  for (const event of events)
    if (
      event.type === "instant_exit" &&
      String(event.owner || "").toLowerCase() === owner
    ) {
      out += big(event.assets);
      shares -= big(event.shares);
    }
  if (shares !== big(user.shares)) return null;
  return Number(big(position.totalUnits) + out - invested) / 1e6;
}

// Where a request is on its way, in the order the person experiences it.
export const REQUEST_STEPS = ["Requested", "Batch closed", "Ready", "Done"];
export function requestStage(request) {
  const redeem = request.kind !== "deposit";
  switch (request.state) {
    case "pending":
      return { step: 0, note: "In the open batch." };
    case "clearing":
      return { step: 1, note: "The batch closed. Settlement is in progress." };
    case "awaiting_liquidity":
      return {
        step: 1,
        note: "Settled. Waiting for funds to return to Base. No time is promised.",
      };
    case "claimable":
      return {
        step: 2,
        ready: true,
        note: redeem
          ? "Your USDC is ready to collect."
          : "Your deposit is earning. Collect your shares any time.",
      };
    case "claimed":
      return { step: 3, note: redeem ? "Withdrawn to your wallet." : "Deposit complete." };
    case "cancelled":
      return { step: 0, cancelled: true, note: "Cancelled." };
    default:
      return { step: 0, note: "Status is unavailable." };
  }
}

// Whether the valuation behind balances and new requests can be relied on.
export function valuationState(vault) {
  const tick = vault?.tick;
  if (!tick) return { level: "unknown" };
  if (tick.frozen) return { level: "frozen" };
  if (tick.quarantined) return { level: "review" };
  if (
    !Number.isFinite(tick.ageSeconds) ||
    tick.ageSeconds < 0 ||
    tick.ageSeconds > vault.risk?.maxTickAge
  )
    return { level: "stale", ageSeconds: tick.ageSeconds };
  return { level: "ok", ageSeconds: tick.ageSeconds };
}

// A wallet's balance in the vault over time, and what it has earned, from its
// own events and the vault's accepted valuations. For charts only: figures a
// person acts on come from `batchPosition` and `crosschainEarned`.
//
// Each request is followed on its own. A deposit counts at face value until it
// settles and as shares at the valuation once collected; a withdrawal
// counts as shares at the valuation until it reaches the amount it was paid,
// which is the moment it settled. Money that left the vault (a collected
// withdrawal, an instant exit, a cancelled deposit) stops counting as balance
// and still counts towards what was earned.
export function positionSeries(events = [], ticks = [], { now = Date.now(), step = 86400000 } = {}) {
  const prices = ticks
    // A valuation as the contract emits it, or a price already worked out.
    .map((tick) => ({
      at: tick.at,
      price: tick.price ?? Number(tick.rateBid) / 1e18,
    }))
    .filter((tick) => Number.isFinite(tick.at) && tick.price > 0)
    .sort((a, c) => a.at - c.at);
  if (!prices.length) return [];
  const priceAt = (at) => {
    let low = 0,
      high = prices.length - 1;
    if (at < prices[0].at) return prices[0].price;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (prices[mid].at <= at) low = mid;
      else high = mid - 1;
    }
    return prices[low].price;
  };
  const requests = new Map();
  const exits = [];
  // In the order they happened: a request and its cancellation can share a
  // block, and the feed arrives newest first.
  const inOrder = [...events].sort(
    (a, c) =>
      a.at - c.at ||
      (a.blockNumber ?? 0) - (c.blockNumber ?? 0) ||
      (a.logIndex ?? 0) - (c.logIndex ?? 0),
  );
  for (const event of inOrder) {
    const id = String(event.requestId);
    if (event.type === "deposit_requested")
      requests.set(id, { kind: "deposit", at: event.at, assets: Number(event.assets) / 1e6 });
    else if (event.type === "redeem_requested")
      requests.set(id, { kind: "redeem", at: event.at, shares: Number(event.shares) / 1e6 });
    else if (event.type === "request_cancelled" && requests.has(id))
      requests.get(id).cancelledAt = event.at;
    else if (event.type === "deposit_claimed" && requests.has(id)) {
      requests.get(id).shares = Number(event.shares) / 1e6;
      requests.get(id).collectedAt = event.at;
    }
    else if (event.type === "redeem_claimed" && requests.has(id)) {
      requests.get(id).paid = Number(event.assets) / 1e6;
      requests.get(id).claimedAt = event.at;
    } else if (event.type === "instant_exit")
      exits.push({
        at: event.at,
        shares: Number(event.shares) / 1e6,
        assets: Number(event.assets) / 1e6,
      });
  }
  const list = [...requests.values()];
  if (!list.length) return [];
  const start = Math.min(...list.map((request) => request.at));
  const at = (time) => {
    const price = priceAt(time);
    let value = 0,
      invested = 0;
    for (const request of list) {
      if (time < request.at) continue;
      if (request.kind === "deposit") {
        if (request.cancelledAt != null && time >= request.cancelledAt) continue;
        invested += request.assets;
        // Face value until it settles. When exactly it settled is not in the
        // events, so until the shares are collected it counts at whichever is
        // higher; from then on it is shares at the valuation, up or down.
        value +=
          request.shares == null
            ? request.assets
            : time >= request.collectedAt
              ? request.shares * price
              : Math.max(request.assets, request.shares * price);
      } else {
        if (request.cancelledAt != null) continue;
        // The shares left the wallet at the request; until paid they are still
        // the holder's, as shares and then as a fixed amount.
        value -= request.shares * price;
        if (request.claimedAt != null && time >= request.claimedAt)
          invested -= request.paid;
        else
          value +=
            request.paid != null
              ? Math.min(request.shares * price, request.paid)
              : request.shares * price;
      }
    }
    for (const exit of exits)
      if (time >= exit.at) {
        value -= exit.shares * price;
        invested -= exit.assets;
      }
    return {
      at: time,
      value: Math.max(0, value),
      invested,
      earned: Math.max(0, value) - invested,
    };
  };
  const times = new Set([start, now]);
  for (let time = Math.ceil(start / step) * step; time < now; time += step) times.add(time);
  for (const request of list)
    for (const moment of [request.at, request.cancelledAt, request.claimedAt, request.collectedAt])
      if (moment != null && moment <= now) times.add(moment);
  for (const exit of exits) if (exit.at <= now) times.add(exit.at);
  return [...times].sort((a, c) => a - c).map(at);
}

const REQUEST_EVENT = {
  deposit_requested: ["request", "Deposit requested"],
  redeem_requested: ["request", "Withdrawal requested"],
  request_cancelled: ["cancel", "Request cancelled"],
  deposit_claimed: ["collect", "Deposit collected"],
  redeem_claimed: ["collect", "Withdrawal collected"],
  instant_exit: ["withdraw", "Instant withdrawal"],
};

// A wallet's requests as rows of its activity list. A share amount is shown
// with the USDC it stands for: what was requested for a collected deposit,
// today's price for a withdrawal that has not settled yet. `flow` says which
// way money went, for the totals: a deposit counts when it is requested unless
// it was cancelled, a withdrawal when it is collected.
export function requestRows(events, rateBid) {
  const list = events || [];
  const cancelled = new Set(
    list.filter((event) => event.type === "request_cancelled").map((event) => event.requestId),
  );
  const asked = new Map(
    list
      .filter((event) => event.type === "deposit_requested" && event.assets != null)
      .map((event) => [event.requestId, Number(event.assets) / 1e6]),
  );
  const price = /^\d+$/.test(String(rateBid ?? "")) ? Number(rateBid) / 1e18 : null;
  const rows = [];
  for (const event of list) {
    const known = REQUEST_EVENT[event.type];
    if (!known) continue;
    const [kind, title] = known;
    const shares = event.type === "redeem_requested" || event.type === "deposit_claimed";
    const amount =
      event.assets != null
        ? Number(event.assets) / 1e6
        : event.shares != null
          ? Number(event.shares) / 1e6
          : null;
    const stands =
      !shares || amount == null
        ? null
        : event.type === "deposit_claimed"
          ? (asked.get(event.requestId) ?? null)
          : price != null
            ? amount * price
            : null;
    rows.push({
      id: event.txHash + ":" + event.logIndex,
      txHash: event.txHash,
      kind,
      title,
      at: event.at,
      amount,
      token: "USDC",
      unit: shares ? "shares" : "USDC",
      stands,
      about: stands != null && event.type !== "deposit_claimed",
      flow:
        event.type === "deposit_requested" && !cancelled.has(event.requestId)
          ? "in"
          : event.type === "redeem_claimed" || event.type === "instant_exit"
            ? "out"
            : null,
    });
  }
  return rows;
}
