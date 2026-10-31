import { marketInfo } from "./crosschain-config.mjs";
// All four account tabs consume the same verified sources. A backend mismatch
// is separate from an allocation/account read failure.
export const crosschainAccountViews = [
  "overview",
  "vaults",
  "activity",
  "earn",
  "crosschain",
];
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
export function crosschainPersonalTotals(user) {
  if (!user) return null;
  const requests = user.requests || [];
  let pendingDeposit = 0n,
    unclaimedShares = 0n,
    redeemAssets = 0n;
  for (const request of requests) {
    if (["claimed", "cancelled"].includes(request.state)) continue;
    if (request.kind === "deposit") {
      if (request.state === "claimable")
        unclaimedShares += BigInt(request.claimable);
      else pendingDeposit += BigInt(request.amount);
    } else if (request.state === "claimable" && request.claimable != null)
      redeemAssets += BigInt(request.claimable);
  }
  return {
    pendingDeposit: pendingDeposit.toString(),
    unclaimedShares: unclaimedShares.toString(),
    redeemAssets: redeemAssets.toString(),
    activeRequests: requests.filter(
      (request) => !["claimed", "cancelled"].includes(request.state),
    ).length,
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
  const held = networks.reduce((sum, net) => sum + net.amount, 0) + cash;
  const share = (amount) =>
    held && amount != null ? (amount / held) * 100 : 0;
  return {
    held,
    cash,
    cashShare: share(cash),
    networks: networks.map((net) => ({
      ...net,
      share: share(net.amount),
      markets: net.markets.map((row) => ({ ...row, share: share(row.amount) })),
    })),
    pendingDeposits: usdc(vault.accounting.pendingDeposits),
    owed: usdc(vault.accounting.liabilities),
  };
}

// Every approved market in one list, largest first, the ones in use on top.
export const allMarkets = (map) =>
  (map?.networks || [])
    .flatMap((net) => net.markets)
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));

// The one yield figure for all capital: each network's current rate weighted by
// its share of everything held, with cash earning nothing. It is lower than any
// single strategy's rate by design. Unknown if any strategy's rate is unknown.
export function rateOnAllCapital(map) {
  if (!map?.held) return null;
  let weighted = 0;
  for (const net of map.networks) {
    if (net.amount > 0 && net.rate == null) return null;
    weighted += net.amount * (net.rate || 0);
  }
  return weighted / map.held;
}

// What a holder has earned: what the position is worth now plus what came out,
// minus what went in. Null until the history is complete, never a guess.
export function crosschainEarned(user, history) {
  if (!user || !history?.coverage?.complete || history.truncated) return null;
  if (user.truncated || !/^\d+$/.test(String(user.valueBid ?? ""))) return null;
  const price = user.rateBid == null ? null : BigInt(user.rateBid);
  if (price == null) return null;
  // The index trails the chain by minutes. A claim it has not seen yet would
  // look like money lost, so wait for it rather than show a wrong figure.
  const paid = new Set(
    (history.events || [])
      .filter((event) => event.type === "redeem_claimed")
      .map((event) => String(event.requestId)),
  );
  if (
    (user.requests || []).some(
      (request) =>
        request.kind === "redeem" &&
        request.state === "claimed" &&
        !paid.has(String(request.id)),
    )
  )
    return null;
  let invested = 0n,
    now = BigInt(user.valueBid),
    out = 0n;
  for (const request of user.requests || []) {
    const amount = BigInt(request.amount);
    if (request.state === "cancelled") continue;
    if (request.kind === "deposit") {
      invested += amount;
      if (request.state === "claimable")
        now += (BigInt(request.claimable) * price) / 10n ** 18n;
      else if (request.state !== "claimed") now += amount;
    } else if (request.state === "claimable" && request.claimable != null)
      now += BigInt(request.claimable);
    else if (request.state !== "claimed") now += (amount * price) / 10n ** 18n;
  }
  for (const event of history.events || [])
    if (["redeem_claimed", "instant_exit"].includes(event.type))
      out += BigInt(event.assets ?? 0);
  return Number(now + out - invested) / 1e6;
}

// What shareholders actually received over a window, from the share price.
export function realizedRate(ticks = [], days, now = Date.now()) {
  const points = ticks
    .filter((tick) => tick.rateBid != null && tick.at != null)
    .map((tick) => ({ at: tick.at, price: Number(tick.rateBid) / 1e18 }))
    .sort((a, b) => a.at - b.at);
  if (points.length < 2) return null;
  const last = points.at(-1);
  const start =
    points.filter((point) => point.at <= now - days * 86400000).at(-1) ||
    points[0];
  const span = (last.at - start.at) / 86400000;
  // Under a day of history is noise rather than a rate.
  if (span < 1 || !(start.price > 0)) return null;
  return {
    rate: ((last.price / start.price - 1) / span) * 365 * 100,
    days: Math.round(span),
  };
}

// Where a request is on its way, in the order the person experiences it.
export const REQUEST_STEPS = [
  "Requested",
  "Batch closed",
  "Settled",
  "Claimed",
];
export function requestStage(request) {
  const redeem = request.kind !== "deposit";
  switch (request.state) {
    case "pending":
      return { step: 0, note: "Joins the current batch when it closes." };
    case "clearing":
      return { step: 1, note: "The batch closed. Settlement is in progress." };
    case "awaiting_liquidity":
      return {
        step: 1,
        note: "Settled. Waiting for funds to return to Base before you can claim.",
      };
    case "claimable":
      return {
        step: 2,
        ready: true,
        note: redeem
          ? "Your USDC is ready to claim."
          : "Your shares are ready to claim.",
      };
    case "claimed":
      return { step: 3, note: redeem ? "USDC claimed." : "Shares claimed." };
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
