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

// Everything the vault holds, in the order a reader follows the money. The parts
// add up to the assets held; deposits not yet turned into shares and money owed
// to settled withdrawals are held but are not part of the shareholders' value.
export function capitalMap(vault, allocation) {
  if (!vault || !allocation?.chains) return null;
  const earning = allocation.chains.map((chain) => ({
    key: chain.name,
    label: "Earning on " + chain.name,
    amount: usdc(chain.strategyValue) + (usdc(chain.idle) || 0),
    rate: chain.rateRay == null ? null : Number(chain.rateRay) / 1e25,
  }));
  const cash = {
    key: "cash",
    label: "Cash on Base",
    amount: usdc(vault.accounting.cash),
    rate: 0,
  };
  const parts = [...earning, cash];
  const held = parts.reduce((sum, part) => sum + part.amount, 0);
  return {
    parts: parts.map((part) => ({
      ...part,
      share: held ? (part.amount / held) * 100 : 0,
    })),
    held,
    pendingDeposits: usdc(vault.accounting.pendingDeposits),
    owed: usdc(vault.accounting.liabilities),
  };
}

// The one yield figure for all capital: each strategy's current rate weighted by
// its share of everything held, with cash earning nothing. It is lower than any
// single strategy's rate by design. Unknown if any strategy's rate is unknown.
export function rateOnAllCapital(map) {
  if (!map?.held) return null;
  let weighted = 0;
  for (const part of map.parts) {
    if (part.amount > 0 && part.rate == null) return null;
    weighted += part.amount * (part.rate || 0);
  }
  return weighted / map.held;
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
