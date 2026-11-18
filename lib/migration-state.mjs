import { amountUnits, tokenAmount } from "./vault-contracts.mjs";

const address = /^0x[0-9a-f]{40}$/i;
export const migrationHash = (value) => /^0x[0-9a-f]{64}$/i.test(value || "");
// The previous vaults whose holders move into the EpochVault: both hold native
// USDC on a network Circle's CCTP serves. Vaults on other networks are outside
// this journal; their holders withdraw to their wallet.
export const MIGRATION_VAULT_IDS = Object.freeze(["arbitrum", "base"]);
export const migrationKey = (owner) => {
  if (!address.test(owner || "")) throw new Error("Connect a valid wallet.");
  return "thesauros.migration.v1." + owner.toLowerCase();
};
export function emptyMigration(owner) {
  return { version: 1, owner: owner.toLowerCase(), products: {} };
}
export function parseMigration(raw, owner) {
  if (!raw) return emptyMigration(owner);
  const value = JSON.parse(raw);
  if (
    value.version !== 1 ||
    value.owner !== owner.toLowerCase() ||
    !value.products
  )
    throw new Error("Saved migration does not match this wallet.");
  const products = {};
  const depositsSeen = new Set();
  for (const [id, record] of Object.entries(value.products)) {
    if (!MIGRATION_VAULT_IDS.includes(id))
      throw new Error("Unknown legacy product.");
    if (
      !record ||
      !Array.isArray(record.withdrawals) ||
      !Array.isArray(record.deposits)
    )
      throw new Error("Saved migration is incomplete.");
    const hashes = (rows) => {
      if (rows.length > 200 || rows.some((hash) => !migrationHash(hash)))
        throw new Error("Invalid saved transaction hash.");
      return [...new Set(rows.map((hash) => hash.toLowerCase()))];
    };
    const pending = record.pending;
    if (
      pending &&
      (!["withdraw", "approve", "deposit", "claim"].includes(pending.kind) ||
        ![8453, 42161].includes(pending.chainId) ||
        !address.test(pending.address || "") ||
        !/^0x(?:[0-9a-f]{2})+$/i.test(pending.data || "") ||
        pending.data.length > 4096 ||
        (pending.hash && !migrationHash(pending.hash)))
    )
      throw new Error("Saved operation cannot be verified.");
    if (
      pending &&
      (pending.chainId !==
        (pending.kind === "withdraw" && id === "arbitrum" ? 42161 : 8453) ||
        (pending.nonce != null &&
          (!Number.isSafeInteger(pending.nonce) || pending.nonce < 0)))
    )
      throw new Error("Saved operation has an invalid network or nonce.");
    const deposits = hashes(record.deposits);
    let actions;
    if (record.actions != null) {
      if (
        !Array.isArray(record.actions) ||
        record.actions.length > 400 ||
        record.actions.some(
          (action) =>
            !["approve", "claim"].includes(action?.kind) ||
            !migrationHash(action?.hash),
        )
      )
        throw new Error("Invalid saved approval or claim hash.");
      actions = [
        ...new Map(
          record.actions.map((action) => [
            action.hash.toLowerCase(),
            { kind: action.kind, hash: action.hash.toLowerCase() },
          ]),
        ).values(),
      ];
    }
    for (const hash of deposits) {
      if (depositsSeen.has(hash))
        throw new Error("A deposit cannot belong to two migrations.");
      depositsSeen.add(hash);
    }
    products[id] = {
      withdrawals: hashes(record.withdrawals),
      deposits,
      pending: pending || null,
      ...(actions ? { actions } : {}),
    };
  }
  // Hashes and calldata are recovery hints. None of their cached statuses or
  // amounts establish financial progress; every load verifies receipts again.
  return { version: 1, owner: value.owner, products };
}
export function migrationRecord(journal, id) {
  return (
    journal.products[id] || { withdrawals: [], deposits: [], pending: null }
  );
}

// Display follows the freshly checked legacy share balance, independently of
// historical migration receipts or the current stage in the new vault. Keep
// the original objects so transaction recovery handlers and their intents are
// available when closed positions move into the new vault's interface.
export function partitionMigrationDisplay(products = []) {
  const legacyProducts = [],
    closedProducts = [];
  for (const product of products) {
    const shares = product?.shares;
    const validShares =
      (typeof shares === "bigint" && shares >= 0n) ||
      (typeof shares === "string" && /^\d+$/.test(shares));
    if (
      product?.positionStatus === "ready" &&
      validShares &&
      BigInt(shares) === 0n
    )
      closedProducts.push(product);
    else legacyProducts.push(product);
  }
  const pendingTransactions = closedProducts.filter(
    (product) =>
      product.recovery ||
      product.pending ||
      ["withdraw_pending", "deposit_pending", "recover"].includes(
        product.stage,
      ),
  );
  return { legacyProducts, closedProducts, pendingTransactions };
}

export function deriveMigration({
  position,
  withdrawals = [],
  requests = [],
  pending,
  cash,
  allowance,
  minDeposit,
  amountInput = "",
  verificationError = "",
  // What the holder chose to keep in their wallet instead of depositing, in
  // token units. It changes what the move still asks for, never an amount read
  // from the chain.
  kept = 0n,
}) {
  const withdrawn = withdrawals.reduce(
    (sum, row) => sum + BigInt(row.amount),
    0n,
  );
  const committed = requests
    .filter((row) => row.state !== "cancelled")
    .reduce((sum, row) => sum + BigInt(row.amount), 0n);
  // A migration deposit can include additional wallet funds. Only the part
  // covering legacy proceeds receives migration credit; the entire request
  // still has to settle and be claimed before migration can complete.
  const credited = committed < withdrawn ? committed : withdrawn;
  const outstanding = withdrawn - credited;
  let keptUnits = 0n;
  try {
    keptUnits = BigInt(kept ?? 0);
  } catch {
    keptUnits = 0n;
  }
  if (keptUnits < 0n) keptUnits = 0n;
  if (keptUnits > outstanding) keptUnits = outstanding;
  let remaining = outstanding - keptUnits;
  const knownMinimum =
    ["bigint", "string"].includes(typeof minDeposit) &&
    /^\d+$/.test(String(minDeposit))
      ? BigInt(minDeposit)
      : null;
  const queuedRequest = requests.find(
    (row) => !["claimed", "cancelled"].includes(row.state),
  );
  // After a deposit, what is left of the proceeds can be less than the vault
  // accepts: a bridge kept a fee. It can never be deposited on its own, so it
  // does not keep the move open. A first withdrawal below the minimum is a
  // different case and keeps its top-up path.
  if (
    credited > 0n &&
    !queuedRequest &&
    knownMinimum != null &&
    remaining > 0n &&
    remaining < knownMinimum
  )
    remaining = 0n;
  const active = queuedRequest;
  const hasPosition =
    position?.status === "ready" && BigInt(position.shares) > 0n;
  const known = position?.status === "ready";
  const result = {
    visible:
      !known ||
      hasPosition ||
      withdrawn > 0n ||
      !!pending ||
      !!verificationError,
    amount: remaining.toString(),
    withdrawn: withdrawn.toString(),
    credited: credited.toString(),
    // Withdrawn and neither deposited nor still asked for: kept by choice, or
    // too small to deposit.
    left: (outstanding - remaining).toString(),
    // In a request that has not been collected yet.
    queued: (active ? BigInt(active.amount) : 0n).toString(),
    requestId: active?.id,
    state: active?.state,
    canAct: false,
    stage: "check",
    error: verificationError,
  };
  if (verificationError) return result;
  if (pending)
    return {
      ...result,
      stage:
        pending.kind === "withdraw"
          ? "withdraw_pending"
          : pending.kind === "deposit"
            ? "deposit_pending"
            : "recover",
      pendingKind: pending.kind,
      pendingChainId: pending.chainId,
    };
  if (active)
    return {
      ...result,
      stage: active.state === "claimable" ? "claim" : "settlement",
      canAct: active.state === "claimable",
    };
  if (remaining > 0n) {
    if (cash == null || allowance == null)
      return {
        ...result,
        error:
          "Your USDC balance on Base could not be verified. Refresh to try again.",
      };
    let minimum = 0n;
    if (minDeposit != null) {
      if (
        !["bigint", "string"].includes(typeof minDeposit) ||
        !/^\d+$/.test(String(minDeposit))
      )
        return {
          ...result,
          error:
            "The current minimum deposit could not be verified. Refresh to try again.",
        };
      minimum = BigInt(minDeposit);
    }
    let selected = remaining > minimum ? remaining : minimum;
    const available = BigInt(cash);
    // A move can be funded in parts. A verified depositable Base balance is
    // enough for the next request; it need not cover the whole withdrawal.
    // A first withdrawal below the minimum still needs its explicit top-up.
    if (knownMinimum != null && available > 0n && available >= minimum)
      selected = selected < available ? selected : available;
    try {
      if (amountInput) selected = amountUnits(amountInput);
    } catch (failure) {
      return { ...result, stage: "base", error: failure.message };
    }
    const selection = {
      ...result,
      selected: selected.toString(),
      migrationCredit: (selected < remaining ? selected : remaining).toString(),
      additionalFunds: (selected > remaining
        ? selected - remaining
        : 0n
      ).toString(),
      minDeposit: minimum.toString(),
    };
    if (selected < minimum)
      return {
        ...selection,
        stage: "base",
        error: `The minimum deposit is ${tokenAmount(minimum)} USDC on Base.`,
      };
    if (available < selected)
      return {
        ...selection,
        stage: "base",
        error: "This amount exceeds your USDC balance on Base.",
      };
    return {
      ...selection,
      stage: BigInt(allowance) < selected ? "approve" : "deposit",
      canAct: true,
    };
  }
  if (hasPosition)
    return {
      ...result,
      stage: "withdraw",
      canAct: !position.withdrawPaused,
      error: position.withdrawPaused
        ? "Withdrawals from the previous vault are paused. Your position remains visible."
        : "",
    };
  if (!known) return result;
  return {
    ...result,
    stage: withdrawn > 0n ? "complete" : "check",
    visible: withdrawn > 0n,
  };
}
