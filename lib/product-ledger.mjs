import { randomUUID } from "node:crypto";
const YEAR = 365 * 86400000;
export const STRATEGY = [
  { provider: "Aave", weight: 0.45, apy: 0.052 },
  { provider: "Morpho", weight: 0.35, apy: 0.068 },
  { provider: "Compound", weight: 0.2, apy: 0.045 },
];
export const GROSS_APY = STRATEGY.reduce((sum, p) => sum + p.weight * p.apy, 0);
export const FEE = 0.1,
  PARTNER_SHARE = 0.2;
export class LedgerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const cents = (value) => {
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    n <= 0 ||
    n > 1e8 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 1e-5
  )
    throw new LedgerError(
      "Enter an amount greater than zero, with up to two decimals.",
    );
  return Math.round(n * 100);
};
const id = (prefix) => prefix + "_" + randomUUID();
function lotValue(lot, now) {
  const gross =
    lot.grossCarry +
    (lot.principal * lot.apy * Math.max(0, now - lot.openedAt)) / YEAR;
  return {
    gross,
    net: gross * (1 - FEE),
    value: lot.principal + gross * (1 - FEE),
  };
}
function seedAccount(
  name,
  kind,
  cash,
  deposit = 0,
  days = 0,
  now = Date.now(),
) {
  const account = {
    id: id("acct"),
    name,
    kind,
    cash: Math.round(cash * 100),
    lots: [],
    events: [],
    realizedNet: 0,
    realizedGross: 0,
  };
  if (deposit)
    applyOperation(
      account,
      { type: "deposit", amount: deposit },
      now - days * 86400000,
    );
  return account;
}
export function createWorkspace(now = Date.now(), empty = false) {
  if (empty)
    return {
      createdAt: now,
      lastSeen: now,
      replays: new Map(),
      individual: seedAccount(
        "Personal test account",
        "individual",
        0,
        0,
        0,
        now,
      ),
      treasury: seedAccount("Treasury test account", "treasury", 0, 0, 0, now),
      customers: [],
      funded: false,
    };
  return {
    createdAt: now,
    lastSeen: now,
    replays: new Map(),
    individual: seedAccount("Personal account", "individual", 10000, 0, 0, now),
    treasury: seedAccount(
      "Company treasury",
      "treasury",
      1000000,
      250000,
      14,
      now,
    ),
    customers: [
      seedAccount("Alex Morgan", "customer", 25000, 15000, 21, now),
      seedAccount("Jamie Park", "customer", 18000, 10000, 12, now),
      seedAccount("Taylor Ellis", "customer", 12000, 6000, 7, now),
      seedAccount("Jordan Blake", "customer", 8000, 0, 0, now),
    ],
  };
}
function accountView(account, now) {
  const principal = account.lots.reduce((n, l) => n + l.principal, 0);
  const gross = account.lots.reduce((n, l) => n + lotValue(l, now).gross, 0);
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    cash: account.cash / 100,
    principal: principal / 100,
    earnBalance: Math.round(principal + gross * (1 - FEE)) / 100,
    earned: Math.round(gross * (1 - FEE) + account.realizedNet) / 100,
    grossEarned: (gross + account.realizedGross) / 100,
    events: account.events.slice(-100).reverse(),
    openedAt: account.events[0]?.at || null,
  };
}
export function snapshot(workspace, mode, now = Date.now()) {
  const account = accountView(
    mode === "individual" ? workspace.individual : workspace.treasury,
    now,
  );
  const customers =
    mode === "institution"
      ? workspace.customers.map((a) => accountView(a, now))
      : [];
  const clientPrincipal = customers.reduce((n, c) => n + c.principal, 0),
    clientBalance = customers.reduce((n, c) => n + c.earnBalance, 0),
    clientEarnings = customers.reduce((n, c) => n + c.earned, 0),
    clientGross = customers.reduce((n, c) => n + c.grossEarned, 0);
  return {
    mode,
    source: "test",
    updatedAt: new Date(now).toISOString(),
    account,
    customers,
    netApy: GROSS_APY * (1 - FEE),
    grossApy: GROSS_APY,
    protocolFee: FEE,
    partnerShare: PARTNER_SHARE,
    strategy: STRATEGY,
    metrics: {
      clientPrincipal,
      clientBalance,
      clientEarnings,
      activeCustomers: customers.filter((c) => c.principal > 0).length,
      partnerRevenue: Math.round(clientGross * FEE * PARTNER_SHARE * 100) / 100,
      annualPartnerRevenue:
        Math.round(clientPrincipal * GROSS_APY * FEE * PARTNER_SHARE * 100) /
        100,
    },
  };
}
function applyOperation(account, { type, amount }, now) {
  const amountCents = cents(amount);
  if (type === "deposit") {
    if (amountCents > account.cash)
      throw new LedgerError("This amount exceeds the available test balance.");
    if (account.lots.length >= 200)
      throw new LedgerError(
        "This account has reached its demo position limit.",
      );
    account.cash -= amountCents;
    account.lots.push({
      id: id("lot"),
      principal: amountCents,
      grossCarry: 0,
      openedAt: now,
      apy: GROSS_APY,
    });
  } else if (type === "withdraw") {
    const available = Math.round(
      account.lots.reduce((n, l) => n + lotValue(l, now).value, 0),
    );
    if (amountCents > available)
      throw new LedgerError("This amount exceeds the current Earn balance.");
    let remaining = amountCents;
    for (const lot of account.lots) {
      if (remaining <= 0) break;
      const value = lotValue(lot, now),
        take = Math.min(remaining, Math.round(value.value));
      const fraction = Math.min(1, take / value.value);
      account.realizedNet += value.net * fraction;
      account.realizedGross += value.gross * fraction;
      lot.principal *= 1 - fraction;
      lot.grossCarry = value.gross * (1 - fraction);
      lot.openedAt = now;
      if (Math.round(value.value) === take) {
        lot.principal = 0;
        lot.grossCarry = 0;
      }
      remaining -= take;
    }
    account.lots = account.lots.filter((l) => l.principal > 0.00001);
    account.cash += amountCents;
  } else throw new LedgerError("Unsupported action.");
  const event = {
    id: id("txn"),
    type,
    amount: amountCents / 100,
    at: new Date(now).toISOString(),
    asset: "USDC",
  };
  account.events.push(event);
  return event;
}
export function transact(
  workspace,
  { mode, accountId, type, amount, requestId },
  now = Date.now(),
) {
  if (!["individual", "institution"].includes(mode))
    throw new LedgerError("Choose an account type.");
  if (
    typeof requestId !== "string" ||
    requestId.length < 8 ||
    requestId.length > 100
  )
    throw new LedgerError("A request identifier is required.");
  const fingerprint = JSON.stringify({ mode, accountId, type, amount });
  const existing = workspace.replays.get(requestId);
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new LedgerError(
        "This request identifier was already used for another operation.",
        409,
      );
    return existing.event;
  }
  const accounts =
    mode === "individual"
      ? [workspace.individual]
      : [workspace.treasury, ...workspace.customers];
  const account = accounts.find((a) => a.id === accountId);
  if (!account)
    throw new LedgerError("Account not found in this workspace.", 404);
  const event = applyOperation(account, { type, amount }, now);
  workspace.replays.set(requestId, { fingerprint, event });
  if (workspace.replays.size > 1000)
    workspace.replays.delete(workspace.replays.keys().next().value);
  return event;
}
