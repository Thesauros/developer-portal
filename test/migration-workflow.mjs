import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { migrationDestination } from "../lib/migration-destination.mjs";
import { crosschain } from "../lib/crosschain-config.mjs";
import {
  epochAbi,
  executeCrosschain,
  prepareCrosschain,
} from "../lib/crosschain-transactions.mjs";
import { vaultClients } from "../lib/vault-rpc.mjs";
import { tokenAbi } from "../lib/vault-contracts.mjs";
import { confirmMigrationOperation } from "../lib/migration-receipts.mjs";
import { deriveMigration } from "../lib/migration-state.mjs";

import {
  workflowFixture as fixture,
  workflowOwner as owner,
} from "./fixtures/migration-workflow.mjs";
const other = "0x2222222222222222222222222222222222222222";

async function withAdapter(f, run) {
  const previousClient = vaultClients.base;
  const previousFetch = globalThis.fetch;
  vaultClients.base = f.client;
  globalThis.fetch = async (path) => {
    assert.match(
      path,
      /^\/api\/crosschain\/(health|backend-base|backend-arbitrum)$/,
    );
    return Response.json({ healthy: true });
  };
  try {
    return await run();
  } finally {
    vaultClients.base = previousClient;
    globalThis.fetch = previousFetch;
  }
}

test("confirmed hub adapter runs separate approve, deposit and claim with receipt-driven progress", async () => {
  const f = fixture();
  await withAdapter(f, async () => {
    assert.equal(migrationDestination.config.address, crosschain.vault);
    assert.equal(migrationDestination.chain.id, 8453);
    await migrationDestination.check("approve");
    const withdrawals = [{ hash: "0x" + "12".repeat(32), amount: 2000000n }];
    const position = { status: "ready", shares: "0" };
    let user = await migrationDestination.readUser(owner, []);
    assert.equal(
      deriveMigration({ position, withdrawals, ...user }).stage,
      "approve",
    );
    const events = [];
    const onSigning = (intent) => events.push({ kind: "sign", ...intent });
    const onHash = (hash) => events.push({ kind: "hash", hash });
    const approval = await migrationDestination.execute(
      f.wallet,
      owner,
      "approve",
      "2",
      onHash,
      onSigning,
    );
    assert.equal(
      f.state.writes.length,
      1,
      "approval must not submit a deposit",
    );
    const approvalCall = f.state.writes[0];
    assert.equal(approvalCall.address, crosschain.asset);
    assert.deepEqual(approvalCall.args, [crosschain.vault, 2000000n]);
    assert.equal(approvalCall.chainId, 8453);
    assert.equal(approvalCall.value, 0n);
    assert.equal(events[0].kind, "sign");
    assert.equal(events[1].kind, "hash");
    await confirmMigrationOperation(
      f.client,
      migrationDestination.config,
      owner,
      approval.transactionHash,
    );
    user = await migrationDestination.readUser(owner, []);
    assert.equal(
      deriveMigration({ position, withdrawals, ...user }).stage,
      "deposit",
    );
    await migrationDestination.check("deposit");
    const receipt = await migrationDestination.execute(
      f.wallet,
      owner,
      "deposit",
      "2",
      onHash,
      onSigning,
    );
    assert.equal(f.state.writes.length, 2);
    assert.deepEqual(f.state.writes[1].args, [2000000n, owner]);
    const deposit = await confirmMigrationOperation(
      f.client,
      migrationDestination.config,
      owner,
      receipt.transactionHash,
    );
    user = await migrationDestination.readUser(owner, [deposit.requestId]);
    assert.equal(
      deriveMigration({ position, withdrawals, ...user }).stage,
      "settlement",
    );
    assert.equal(
      user.shares,
      "0",
      "a queued deposit is not already a share position",
    );
    f.state.current = 3n;
    user = await migrationDestination.readUser(owner, [deposit.requestId]);
    assert.equal(
      deriveMigration({ position, withdrawals, ...user }).stage,
      "claim",
    );
    await migrationDestination.execute(
      f.wallet,
      owner,
      "claim",
      deposit.requestId,
      onHash,
      onSigning,
    );
    user = await migrationDestination.readUser(owner, [deposit.requestId]);
    assert.equal(
      deriveMigration({ position, withdrawals, ...user }).stage,
      "complete",
    );
    assert.equal(user.shares, "2000000");
  });
});

test("engine prevents signing without ETH, exact minimum, balance, allowance or accepted approval", async () => {
  for (const scenario of [
    { patch: { eth: 0n }, action: "approve", input: "2", error: /ETH/ },
    {
      patch: { minDeposit: 2000001n },
      action: "approve",
      input: "2",
      error: /minimum/,
    },
    { patch: { cash: 1999999n }, action: "deposit", input: "2", error: /USDC/ },
    {
      patch: { allowance: 1999999n },
      action: "deposit",
      input: "2",
      error: /Approve/,
    },
    {
      patch: { approvalAccepted: false },
      action: "approve",
      input: "2",
      error: /did not accept/,
    },
    { patch: { paused: true }, action: "deposit", input: "2", error: /paused/ },
  ]) {
    const f = fixture();
    Object.assign(f.state, scenario.patch);
    await assert.rejects(
      executeCrosschain(
        f.client,
        f.wallet,
        owner,
        scenario.action,
        scenario.input,
        () => assert.fail("no hash expected"),
      ),
      scenario.error,
    );
    assert.equal(f.state.writes.length, 0);
  }
});

test("simulation failure and account/network changes before signing send no transaction", async () => {
  const failure = fixture();
  failure.state.simulationFailure = new Error("simulation rejected");
  await assert.rejects(
    prepareCrosschain(failure.client, owner, "approve", "2"),
    /simulation rejected/,
  );
  for (const field of ["walletOwner", "walletChain"]) {
    const f = fixture();
    const original = f.client.simulateContract;
    f.client.simulateContract = async (request) => {
      const result = await original(request);
      f.state[field] = field === "walletOwner" ? other : 42161;
      return result;
    };
    await assert.rejects(
      executeCrosschain(f.client, f.wallet, owner, "approve", "2", () =>
        assert.fail("no hash expected"),
      ),
      /signed-in wallet/,
    );
    assert.equal(f.state.writes.length, 0);
  }
});

test("adapter blocks new requests for stale/frozen valuation and backend errors; claim remains independent", async () => {
  for (const patch of [
    { frozen: true },
    { quarantined: true },
    { age: 101n },
    { paused: true },
  ]) {
    const f = fixture();
    Object.assign(f.state, patch);
    await withAdapter(f, async () => {
      await assert.rejects(
        migrationDestination.check("deposit"),
        /unavailable/,
      );
      await migrationDestination.check("claim");
    });
  }
  const f = fixture();
  await withAdapter(f, async () => {
    globalThis.fetch = async () => new Response("offline", { status: 503 });
    await assert.rejects(migrationDestination.check("deposit"), /backend/);
    assert.equal(f.state.writes.length, 0);
  });
});

test("simulation metadata cannot change the reviewed spender, receiver, target or value", async () => {
  const f = fixture();
  f.client.simulateContract = async () => ({
    result: true,
    request: {
      address: other,
      functionName: "approve",
      abi: tokenAbi,
      args: [other, 1n],
      account: other,
      value: 100n,
    },
  });
  const prepared = await prepareCrosschain(f.client, owner, "approve", "2");
  assert.equal(prepared.address, crosschain.asset);
  assert.equal(prepared.account, owner);
  assert.equal(prepared.value, 0n);
  assert.equal(prepared.chainId, 8453);
  assert.deepEqual(
    decodeFunctionData({ abi: tokenAbi, data: encodeFunctionData(prepared) })
      .args,
    [crosschain.vault, 2000000n],
  );
});
