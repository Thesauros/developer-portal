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
