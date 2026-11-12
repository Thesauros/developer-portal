import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveMigration,
  emptyMigration,
  migrationKey,
  migrationRecord,
  parseMigration,
} from "../lib/migration-state.mjs";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32);
const secondHash = "0x" + "cd".repeat(32);
const ready = (shares = 0n) => ({ status: "ready", shares: shares.toString() });
const withdrawn = (amount = 3000000n) => [{ hash, amount }];

test("a verified zero legacy position hides that legacy product", () => {
  const state = deriveMigration({ position: ready() });
  assert.equal(state.visible, false);
  assert.equal(state.canAct, false);
  assert.equal(state.amount, "0");
});

test("loading and failed RPC never imply a zero or completed position", () => {
  for (const position of [
    undefined,
    { status: "loading" },
    { status: "unavailable", shares: "0" },
  ]) {
    const state = deriveMigration({ position });
    assert.equal(state.visible, true);
    assert.equal(state.stage, "check");
    assert.equal(state.canAct, false);
  }
  const error = deriveMigration({
    position: ready(),
    verificationError: "RPC unavailable",
  });
  assert.equal(error.visible, true);
  assert.equal(error.stage, "check");
  assert.equal(error.error, "RPC unavailable");
});

test("each legacy product independently retains its nonzero shares", () => {
  const base = deriveMigration({ position: ready(1000000n) });
  const arbitrum = deriveMigration({ position: ready() });
  assert.equal(base.stage, "withdraw");
  assert.equal(base.visible, true);
  assert.equal(base.canAct, true);
  assert.equal(arbitrum.visible, false);
  const both = [ready(500000n), ready(1n)].map((position) =>
    deriveMigration({ position }),
  );
  assert.ok(both.every((state) => state.visible && state.stage === "withdraw"));
});

test("withdrawal proceeds remain recoverable after legacy shares reach zero", () => {
  const state = deriveMigration({
    position: ready(),
    withdrawals: withdrawn(),
    cash: 3000000n,
    allowance: 0n,
  });
  assert.equal(state.visible, true);
  assert.equal(state.stage, "approve");
  assert.equal(state.selected, "3000000");
  assert.equal(state.canAct, true);
});

test("Base balance and allowance govern distinct funding, approve and deposit steps", () => {
  const input = { position: ready(), withdrawals: withdrawn() };
  const unavailable = deriveMigration(input);
  assert.equal(unavailable.canAct, false);
  assert.match(unavailable.error, /Base/);
  const funding = deriveMigration({ ...input, cash: 2999999n, allowance: 0n });
  assert.equal(funding.stage, "base");
  assert.equal(funding.canAct, false);
  const approved = deriveMigration({
    ...input,
    cash: 3000000n,
    allowance: 3000000n,
  });
  assert.equal(approved.stage, "deposit");
  assert.equal(approved.canAct, true);
  const insufficientApproval = deriveMigration({
    ...input,
    cash: 3000000n,
    allowance: 2999999n,
  });
  assert.equal(insufficientApproval.stage, "approve");
});

test("pending signatures and broadcasts block duplicates across every stage", () => {
  for (const kind of ["withdraw", "approve", "deposit", "claim"]) {
    const state = deriveMigration({
      position: ready(10n),
      withdrawals: withdrawn(),
      cash: 3000000n,
      allowance: 3000000n,
      pending: { kind },
    });
    assert.equal(
      state.stage,
      kind === "withdraw"
        ? "withdraw_pending"
        : kind === "deposit"
          ? "deposit_pending"
          : "recover",
    );
    assert.equal(state.visible, true);
    assert.equal(state.canAct, false);
  }
});

test("partial withdrawals and deposits preserve remaining legacy obligations", () => {
  const input = {
    position: ready(2000000n),
    withdrawals: withdrawn(),
    cash: 3000000n,
    allowance: 3000000n,
  };
  const deposit = deriveMigration({ ...input, amountInput: "1.000001" });
  assert.equal(deposit.stage, "deposit");
  assert.equal(deposit.selected, "1000001");
  const partial = deriveMigration({
    ...input,
    requests: [{ id: "1", state: "claimed", amount: 1000001n }],
  });
  assert.equal(partial.stage, "deposit");
  assert.equal(partial.amount, "1999999");
  const moreWithdrawal = deriveMigration({
    ...input,
    requests: [{ id: "1", state: "claimed", amount: 3000000n }],
  });
  assert.equal(moreWithdrawal.stage, "withdraw");
  assert.equal(moreWithdrawal.visible, true);
  assert.equal(moreWithdrawal.canAct, true);
});

test("new asynchronous deposit is unfinished until shares can be claimed", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(),
    cash: 0n,
    allowance: 3000000n,
  };
  for (const state of ["pending", "settled", "waiting"]) {
    const result = deriveMigration({
      ...input,
      requests: [{ id: "7", state, amount: 3000000n }],
    });
    assert.equal(result.stage, "settlement");
    assert.equal(result.requestId, "7");
    assert.equal(result.canAct, false);
  }
  const claimable = deriveMigration({
    ...input,
    requests: [{ id: "7", state: "claimable", amount: 3000000n }],
  });
  assert.equal(claimable.stage, "claim");
  assert.equal(claimable.canAct, true);
  const complete = deriveMigration({
    ...input,
    requests: [{ id: "7", state: "claimed", amount: 3000000n }],
  });
  assert.equal(complete.stage, "complete");
  assert.equal(complete.amount, "0");
  assert.equal(complete.canAct, false);
});

test("cancelled new deposits restore exactly the undeposited migration amount", () => {
  const result = deriveMigration({
    position: ready(),
    withdrawals: withdrawn(),
    requests: [{ id: "7", state: "cancelled", amount: 3000000n }],
    cash: 3000000n,
    allowance: 3000000n,
  });
  assert.equal(result.stage, "deposit");
  assert.equal(result.amount, "3000000");
});

test("transaction amounts keep six decimal precision and reject excess or rounded input", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(),
    cash: 3000000n,
    allowance: 3000000n,
  };
  for (const amountInput of [
    "3.000001",
    "1.0000001",
    "0",
    "-1",
    "1e-6",
    "NaN",
  ]) {
    const result = deriveMigration({ ...input, amountInput });
    assert.equal(result.canAct, false);
    assert.ok(result.error);
  }
  const oneUnit = deriveMigration({ ...input, amountInput: "0.000001" });
  assert.equal(oneUnit.selected, "1");
  assert.equal(oneUnit.stage, "deposit");
});

test("a migration deposit may use the full verified wallet balance beyond legacy proceeds", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(22641n),
    cash: 12205713n,
    allowance: 12205713n,
  };
  const unchangedDefault = deriveMigration(input);
  assert.equal(
    unchangedDefault.selected,
    "22641",
    "default must not silently select all wallet funds",
  );
  const maximum = deriveMigration({ ...input, amountInput: "12.205713" });
  assert.equal(maximum.stage, "deposit");
  assert.equal(maximum.canAct, true);
  assert.equal(maximum.amount, "22641");
  assert.equal(maximum.selected, "12205713");
  assert.equal(maximum.migrationCredit, "22641");
  assert.equal(maximum.additionalFunds, "12183072");
  const aboveCash = deriveMigration({ ...input, amountInput: "12.205714" });
  assert.equal(aboveCash.canAct, false);
  assert.equal(aboveCash.stage, "base");
  assert.match(aboveCash.error, /balance on Base/);
});

test("an additional 20 USDC request only credits legacy proceeds and still requires a claim", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(22641n),
    cash: 20000000n,
    allowance: 20000000n,
  };
  const selected = deriveMigration({ ...input, amountInput: "20" });
  assert.equal(selected.selected, "20000000");
  assert.equal(selected.migrationCredit, "22641");
  assert.equal(selected.additionalFunds, "19977359");
  const request = { id: "20", state: "pending", amount: 20000000n };
  const queued = deriveMigration({ ...input, requests: [request] });
  assert.equal(queued.stage, "settlement");
  assert.equal(queued.amount, "0");
  assert.equal(queued.credited, "22641");
  assert.equal(queued.canAct, false);
  const claim = deriveMigration({
    ...input,
    requests: [{ ...request, state: "claimable" }],
  });
  assert.equal(claim.stage, "claim");
  const complete = deriveMigration({
    ...input,
    requests: [{ ...request, state: "claimed" }],
  });
  assert.equal(complete.stage, "complete");
  assert.equal(complete.credited, "22641");
  assert.equal(complete.error, "");
  const legacyStillOpen = deriveMigration({
    ...input,
    position: ready(260n),
    requests: [{ ...request, state: "claimed" }],
  });
  assert.equal(legacyStillOpen.stage, "withdraw");
  const legacyUnknown = deriveMigration({
    ...input,
    position: { status: "unavailable" },
    requests: [{ ...request, state: "claimed" }],
  });
  assert.equal(legacyUnknown.stage, "check");
  assert.equal(legacyUnknown.canAct, false);
});

test("partial migration credit and cancelled top-ups preserve exact outstanding proceeds", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(22641n),
    cash: 12205713n,
    allowance: 12205713n,
  };
  const partial = { id: "1", state: "claimed", amount: 10000n };
  const cancelled = { id: "2", state: "cancelled", amount: 20000000n };
  const outstanding = deriveMigration({
    ...input,
    requests: [partial, cancelled],
  });
  assert.equal(outstanding.credited, "10000");
  assert.equal(outstanding.amount, "12641");
  assert.equal(outstanding.selected, "12641");
  const topUp = deriveMigration({
    ...input,
    requests: [partial, cancelled],
    amountInput: "1",
  });
  assert.equal(topUp.migrationCredit, "12641");
  assert.equal(topUp.additionalFunds, "987359");
  const restored = deriveMigration({
    ...input,
    requests: [{ ...partial, state: "cancelled" }, cancelled],
  });
  assert.equal(restored.credited, "0");
  assert.equal(restored.amount, "22641");
  assert.equal(restored.stage, "deposit");
});

test("a live minimum lets a tiny legacy withdrawal be topped up without selecting all cash", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(263n),
    cash: 12205713n,
    allowance: 0n,
    minDeposit: "1000000",
  };
  const toppedUp = deriveMigration(input);
  assert.equal(toppedUp.stage, "approve");
  assert.equal(toppedUp.amount, "263");
  assert.equal(toppedUp.selected, "1000000");
  assert.equal(toppedUp.migrationCredit, "263");
  assert.equal(toppedUp.additionalFunds, "999737");
  const belowMinimum = deriveMigration({ ...input, amountInput: "0.000263" });
  assert.equal(belowMinimum.canAct, false);
  assert.match(belowMinimum.error, /minimum deposit is 1 USDC/);
  const insufficientCash = deriveMigration({ ...input, cash: 999999n });
  assert.equal(insufficientCash.stage, "base");
  assert.equal(insufficientCash.canAct, false);
  assert.equal(insufficientCash.selected, "1000000");
  assert.equal(
    deriveMigration({ ...input, minDeposit: 1000000n }).selected,
    "1000000",
  );
  assert.equal(
    deriveMigration({ ...input, minDeposit: undefined }).selected,
    "263",
  );
  assert.equal(deriveMigration({ ...input, minDeposit: 0n }).selected, "263");
  const invalidMinimum = deriveMigration({
    ...input,
    minDeposit: "unavailable",
  });
  assert.equal(invalidMinimum.canAct, false);
  assert.match(invalidMinimum.error, /minimum deposit could not be verified/);
});

test("top-up support retains pending and verification-error barriers", () => {
  const input = {
    position: ready(),
    withdrawals: withdrawn(22641n),
    cash: 12205713n,
    allowance: 12205713n,
    minDeposit: 1000000n,
    amountInput: "12.205713",
  };
  for (const kind of ["withdraw", "deposit", "approve", "claim"]) {
    assert.equal(
      deriveMigration({ ...input, pending: { kind } }).canAct,
      false,
    );
  }
  const failed = deriveMigration({
    ...input,
    verificationError: "History RPC failed",
  });
  assert.equal(failed.stage, "check");
  assert.equal(failed.canAct, false);
  assert.equal(failed.error, "History RPC failed");
  const missingCash = deriveMigration({ ...input, cash: null });
  assert.equal(missingCash.canAct, false);
  assert.match(missingCash.error, /could not be verified/);
});

test("reloaded journals are wallet-scoped recovery hints with deduplicated hashes", () => {
  const pending = {
    kind: "deposit",
    chainId: 8453,
    address: other,
    data: "0x1234",
    hash: secondHash,
  };
  const saved = {
    version: 1,
    owner,
    products: {
      base: {
        withdrawals: [hash, hash],
        deposits: [secondHash],
        pending,
        amount: "999999999999",
        complete: true,
      },
    },
  };
  const parsed = parseMigration(JSON.stringify(saved), owner);
  assert.deepEqual(parsed.products.base, {
    withdrawals: [hash],
    deposits: [secondHash],
    pending,
  });
  assert.throws(() => parseMigration(JSON.stringify(saved), other), /wallet/);
  assert.deepEqual(parseMigration(null, owner), emptyMigration(owner));
  assert.deepEqual(migrationRecord(parsed, "arbitrum"), {
    withdrawals: [],
    deposits: [],
    pending: null,
  });
  assert.notEqual(migrationKey(owner), migrationKey(other));
});

test("malformed saved operations cannot be resumed as trusted migration", () => {
  for (const pending of [
    { kind: "transfer", chainId: 8453, address: other, data: "0x1234" },
    { kind: "deposit", chainId: 1, address: other, data: "0x1234" },
    { kind: "deposit", chainId: 8453, address: "invalid", data: "0x1234" },
    { kind: "deposit", chainId: 8453, address: other, data: "0x123" },
    {
      kind: "deposit",
      chainId: 8453,
      address: other,
      data: "0x1234",
      hash: "invalid",
    },
  ]) {
    assert.throws(
      () =>
        parseMigration(
          JSON.stringify({
            version: 1,
            owner,
            products: { base: { withdrawals: [], deposits: [], pending } },
          }),
          owner,
        ),
      /operation/,
    );
  }
  assert.throws(
    () =>
      parseMigration(
        JSON.stringify({
          version: 1,
          owner,
          products: { base: { withdrawals: ["invalid"], deposits: [] } },
        }),
        owner,
      ),
    /hash/,
  );
});
