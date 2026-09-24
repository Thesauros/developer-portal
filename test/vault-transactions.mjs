import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
} from "viem";
import {
  createTransactionEngine,
  prepareTransaction,
} from "../lib/vault-transactions.mjs";
import { getVault, vaultAbi } from "../lib/vault-contracts.mjs";

// No signing, RPC or real provider is used. Verify the unsigned call and the
// asynchronous wallet/receipt boundary independently from chain-data loading.
const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "a".repeat(64);
const replacementHash = "0x" + "b".repeat(64);
const vault = getVault("arbitrum");
let passed = 0;
async function test(name, run) {
  try {
    await run();
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
const expectCode = (code) => (error) => {
  assert.equal(error.code, code);
  return true;
};
function harness(overrides = {}) {
  const state = {
    calls: [],
    writes: [],
    walletOwner: owner,
    chainId: vault.chainId,
    nativeBalance: 1_000_000_000_000_000n,
    ...overrides,
    position: {
      id: vault.id,
      owner,
      blockNumber: 100n,
      implementation: other,
      cash: 200_000_000n,
      allowance: 100_000_000n,
      shares: 100_000_000n,
      positionAssets: 101_000_000n,
      minAssets: 1_000_000n,
      depositPaused: false,
      withdrawPaused: false,
      managementFee: 0n,
      performanceFee: 0n,
      ...overrides.position,
    },
  };
  const engine = createTransactionEngine({
    positionReader: async (_client, vaultId, account) => {
      state.calls.push("position");
      assert.equal(vaultId, vault.id);
      assert.equal(account.toLowerCase(), owner.toLowerCase());
      return { ...state.position };
    },
  });
  const publicClient = {
    async readContract({ functionName, args, blockNumber }) {
      state.calls.push(functionName);
      if (functionName === "allowance") {
        assert.deepEqual(args, [owner, vault.address]);
        assert.equal(
          blockNumber,
          undefined,
          "approval reads current allowance after the receipt",
        );
        if (state.allowanceError) throw state.allowanceError;
        return (
          state.allowanceAfterReceipt ?? state.writes.at(-1)?.args[1] ?? 0n
        );
      }
      assert.equal(blockNumber, state.position.blockNumber);
      if (state.readError) throw state.readError;
      if (state.preview != null) return state.preview;
      if (functionName === "previewDeposit") return (args[0] * 100n) / 101n;
      if (functionName === "previewWithdraw")
        return (args[0] * 100n + 100n) / 101n;
      throw new Error(`Unexpected read: ${functionName}`);
    },
    async getBalance() {
      return state.nativeBalance;
    },
    async simulateContract(request) {
      state.calls.push(`simulate:${request.functionName}`);
      if (state.simulationError) throw state.simulationError;
      state.afterSimulation?.();
      if (state.simulationResponse) return state.simulationResponse;
      return {
        request,
        result: request.functionName === "approve" ? true : 1n,
      };
    },
    async waitForTransactionReceipt(options) {
      state.calls.push("receipt");
      if (state.wait) return state.wait(options);
      if (state.waitError) throw state.waitError;
      return {
        status: state.receiptStatus || "success",
        transactionHash: hash,
      };
    },
    async getTransaction() {
      state.calls.push("transaction");
      if (state.transactionError) throw state.transactionError;
      return state.actual || state.sent;
    },
  };
  const walletClient = {
    async getAddresses() {
      state.calls.push("accounts");
      return [state.walletOwner];
    },
    async getChainId() {
      state.calls.push("chain");
      return state.chainId;
    },
    async writeContract(request) {
      state.calls.push(`write:${request.functionName}`);
      state.writes.push(request);
      if (state.writeError) throw state.writeError;
      assert.equal(request.chain.id, vault.chainId);
      state.sent = {
        hash,
        from: request.account,
        to: request.address,
        input: encodeFunctionData(request),
        value: request.value,
        chainId: request.chain.id,
      };
      return hash;
    },
  };
  const prepare = (options = {}) =>
    engine.prepareTransaction({
      publicClient,
      vaultId: vault.id,
      owner,
      kind: "deposit",
      amount: "10.123456",
      ...options,
    });
  const execute = (prepared, options = {}) =>
    engine.executeTransaction({
      publicClient,
      walletClient,
      prepared,
      ...options,
    });
  return { state, publicClient, walletClient, prepare, execute };
}

await test("decimal strings preserve precision beyond Number safe integer", async () => {
  const h = harness({ position: { cash: 10n ** 30n, allowance: 10n ** 30n } });
  const prepared = await h.prepare({ amount: "9007199254740993.123456" });
  assert.equal(prepared.rawAmount, 9007199254740993123456n);
  assert.equal(prepared.args[0], prepared.rawAmount);
  assert.equal(prepared.args[1], owner);
});
await test("fraction precision, exponent, negative and zero rejected", async () => {
  for (const amount of ["0", "-1", "1e6", "1.1234567", "NaN", "  "])
    await assert.rejects(harness().prepare({ amount }));
  await assert.rejects(
    harness().prepare({ amount: 1.25 }),
    expectCode("INVALID_AMOUNT"),
  );
});
await test("unknown vault, action, account and deposit-all rejected", async () => {
  await assert.rejects(harness().prepare({ vaultId: "unlisted" }));
  await assert.rejects(
    harness().prepare({ kind: "transfer" }),
    expectCode("INVALID_ACTION"),
  );
  await assert.rejects(
    harness().prepare({ owner: "0x" }),
    expectCode("INVALID_ACCOUNT"),
  );
  await assert.rejects(
    harness().prepare({ all: true }),
    expectCode("INVALID_ACTION"),
  );
});
await test("deposit pause enforced independently of withdrawal", async () => {
  const h = harness({ position: { depositPaused: true } });
  await assert.rejects(h.prepare(), expectCode("DEPOSIT_PAUSED"));
  assert.equal(
    (await h.prepare({ kind: "withdraw" })).functionName,
    "withdraw",
  );
});
await test("withdrawal pause enforced independently of deposit", async () => {
  const h = harness({ position: { withdrawPaused: true } });
  await assert.rejects(
    h.prepare({ kind: "withdraw" }),
    expectCode("WITHDRAW_PAUSED"),
  );
  assert.equal((await h.prepare()).functionName, "deposit");
});
await test("minimum and USDC balance enforced", async () => {
  await assert.rejects(
    harness().prepare({ amount: "0.999999" }),
    expectCode("BELOW_MINIMUM"),
  );
  await assert.rejects(
    harness().prepare({ amount: "200.000001" }),
    expectCode("INSUFFICIENT_CASH"),
  );
  assert.equal(
    (await harness().prepare({ amount: "1" })).rawAmount,
    1_000_000n,
  );
});
await test("zero preview shares rejected", async () => {
  await assert.rejects(
    harness({ preview: 0n }).prepare(),
    expectCode("ZERO_SHARES"),
  );
});
await test("exact allowance is sufficient, one unit short needs approval", async () => {
  assert.equal(
    (await harness({ position: { allowance: 10_123_456n } }).prepare())
      .needsApproval,
    false,
  );
  assert.equal(
    (await harness({ position: { allowance: 10_123_455n } }).prepare())
      .needsApproval,
    true,
  );
});
await test("partial withdrawal verifies ceil share requirement", async () => {
  const h = harness();
  const p = await h.prepare({ kind: "withdraw", amount: "1.000001" });
  assert.equal(p.shares, (1_000_001n * 100n + 100n) / 101n);
  assert.deepEqual(p.args, [1_000_001n, owner, owner]);
  assert.equal(p.needsApproval, false);
});
await test("withdraw all redeems exact shares including sub-cent dust", async () => {
  const h = harness({
    position: { shares: 12_345_678n, positionAssets: 12_987_654n },
  });
  const p = await h.prepare({ kind: "withdraw", all: true, amount: undefined });
  assert.equal(p.functionName, "redeem");
  assert.deepEqual(p.args, [12_345_678n, owner, owner]);
  assert.equal(p.rawAmount, 12_987_654n);
  assert.equal(p.amount, null);
  const result = await h.execute(p);
  assert.equal(result.status, "success");
  assert.equal(h.state.writes[0].functionName, "redeem");
});
await test("empty, insufficient position and rounded shares are rejected", async () => {
  await assert.rejects(
    harness({ position: { shares: 0n } }).prepare({ kind: "withdraw" }),
    expectCode("NO_POSITION"),
  );
  await assert.rejects(
    harness().prepare({ kind: "withdraw", amount: "101.000001" }),
    expectCode("INSUFFICIENT_POSITION"),
  );
  await assert.rejects(
    harness({ preview: 100_000_001n }).prepare({ kind: "withdraw" }),
    expectCode("INSUFFICIENT_SHARES"),
  );
});
await test("read failures are not converted into zero balances", async () => {
  const error = new Error("RPC unavailable");
  await assert.rejects(
    harness({ readError: error }).prepare(),
    (e) => e === error,
  );
});
await test("deposit cannot skip required approval", async () => {
  const h = harness({ position: { allowance: 0n } });
  await assert.rejects(
    h.execute(await h.prepare()),
    expectCode("APPROVAL_REQUIRED"),
  );
  assert.equal(h.state.writes.length, 0);
});
await test("approval uses exact spender/amount and never submits deposit", async () => {
  const h = harness({ position: { allowance: 0n } });
  const callbacks = [];
  const result = await h.execute(await h.prepare(), {
    action: "approve",
    onHash: (v) => callbacks.push(v),
  });
  assert.equal(result.status, "success");
  assert.equal(result.action, "approve");
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.writes[0].address, vault.asset);
  assert.equal(h.state.writes[0].functionName, "approve");
  assert.deepEqual(h.state.writes[0].args, [vault.address, 10_123_456n]);
  assert.deepEqual(callbacks, [hash]);
  assert(
    h.state.calls.indexOf("receipt") > h.state.calls.indexOf("write:approve"),
  );
});
await test("unnecessary approval and withdrawal approval are rejected", async () => {
  const h = harness();
  await assert.rejects(
    h.execute(await h.prepare(), { action: "approve" }),
    expectCode("ALREADY_APPROVED"),
  );
  await assert.rejects(
    h.execute(await h.prepare({ kind: "withdraw" }), { action: "approve" }),
    expectCode("INVALID_APPROVAL"),
  );
});
await test("fresh allowance is re-read after approval", async () => {
  const h = harness({ position: { allowance: 0n } });
  const p = await h.prepare();
  await h.execute(p, { action: "approve" });
  h.state.position.allowance = p.rawAmount;
  await h.execute(p);
  assert.deepEqual(
    h.state.writes.map((w) => w.functionName),
    ["approve", "deposit"],
  );
});
await test("fresh pause and balances invalidate an earlier review", async () => {
  for (const [change, code] of [
    [{ depositPaused: true }, "DEPOSIT_PAUSED"],
    [{ cash: 0n }, "INSUFFICIENT_CASH"],
    [{ minAssets: 100_000_000n }, "BELOW_MINIMUM"],
    [{ allowance: 0n }, "APPROVAL_REQUIRED"],
  ]) {
    const h = harness();
    const p = await h.prepare();
    Object.assign(h.state.position, change);
    await assert.rejects(h.execute(p), expectCode(code));
    assert.equal(h.state.writes.length, 0);
  }
});
await test("withdraw all does not silently expand reviewed amount", async () => {
  const h = harness();
  const p = await h.prepare({ kind: "withdraw", all: true });
  h.state.position.shares += 1n;
  await assert.rejects(h.execute(p), expectCode("POSITION_CHANGED"));
  assert.equal(h.state.writes.length, 0);
});
await test("zero ETH prevents wallet requests", async () => {
  const h = harness({ nativeBalance: 0n });
  await assert.rejects(
    h.execute(await h.prepare()),
    expectCode("NO_GAS_BALANCE"),
  );
  assert.equal(h.state.writes.length, 0);
});
await test("simulation revert stops before signing", async () => {
  const error = new Error("InsufficientLiquidity");
  const h = harness({ simulationError: error });
  await assert.rejects(
    h.execute(await h.prepare({ kind: "withdraw" })),
    (e) => e === error,
  );
  assert.equal(h.state.writes.length, 0);
});
await test("initial account and network mismatch stop transaction", async () => {
  for (const [settings, code] of [
    [{ walletOwner: other }, "ACCOUNT_CHANGED"],
    [{ chainId: 8453 }, "CHAIN_CHANGED"],
  ]) {
    const h = harness(settings);
    await assert.rejects(h.execute(await h.prepare()), expectCode(code));
    assert.equal(h.state.writes.length, 0);
  }
});
await test("account and network rechecked after asynchronous simulation", async () => {
  for (const [key, value, code] of [
    ["walletOwner", other, "ACCOUNT_CHANGED"],
    ["chainId", 8453, "CHAIN_CHANGED"],
  ]) {
    const h = harness();
    h.state.afterSimulation = () => {
      h.state[key] = value;
    };
    await assert.rejects(h.execute(await h.prepare()), expectCode(code));
    assert.equal(h.state.writes.length, 0);
  }
});
await test("a successful hash alone does not complete an action", async () => {
  const h = harness({ receiptStatus: "reverted" });
  await assert.rejects(h.execute(await h.prepare()), (error) => {
    assert.equal(error.code, "TRANSACTION_REVERTED");
    assert.equal(error.hash, hash);
    assert.equal(error.status, "reverted");
    return true;
  });
});
await test("timeout and post-receipt RPC loss retain recovery hash", async () => {
  for (const state of [
    { waitError: new Error("Timeout") },
    { transactionError: new Error("RPC lost") },
  ]) {
    const h = harness(state);
    await assert.rejects(h.execute(await h.prepare()), (error) => {
      assert.equal(error.code, "CONFIRMATION_PENDING");
      assert.equal(error.status, "pending");
      assert.equal(error.hash, hash);
      return true;
    });
  }
});
await test("matching repriced replacement completes and updates hash", async () => {
  const h = harness();
  const callbacks = [],
    replacements = [];
  h.state.wait = async ({ onReplaced }) => {
    h.state.actual = { ...h.state.sent, hash: replacementHash };
    onReplaced({ reason: "repriced", transaction: h.state.actual });
    return { status: "success", transactionHash: replacementHash };
  };
  const result = await h.execute(await h.prepare(), {
    onHash: (h) => callbacks.push(h),
    onReplacement: (info) => replacements.push(info.reason),
  });
  assert.equal(result.hash, replacementHash);
  assert.deepEqual(callbacks, [hash, replacementHash]);
  assert.deepEqual(replacements, ["repriced"]);
});
await test("cancelled replacement never reports original deposit success", async () => {
  const h = harness();
  h.state.wait = async ({ onReplaced }) => {
    onReplaced({
      reason: "cancelled",
      transaction: {
        ...h.state.sent,
        hash: replacementHash,
        to: owner,
        input: "0x",
      },
    });
    return { status: "success", transactionHash: replacementHash };
  };
  await assert.rejects(h.execute(await h.prepare()), (e) => {
    assert.equal(e.code, "TRANSACTION_CANCELLED");
    assert.equal(e.hash, replacementHash);
    return true;
  });
});
await test("replacement sender, target, calldata and value must match", async () => {
  for (const change of [
    { from: other },
    { to: other },
    { input: "0x" },
    { value: 1n },
    { chainId: 8453 },
  ]) {
    const h = harness();
    h.state.wait = async ({ onReplaced }) => {
      onReplaced({
        reason: "repriced",
        transaction: { ...h.state.sent, hash: replacementHash, ...change },
      });
      return { status: "success", transactionHash: replacementHash };
    };
    await assert.rejects(
      h.execute(await h.prepare()),
      expectCode("TRANSACTION_REPLACED"),
    );
  }
});
await test("final transaction is checked even without replacement callback", async () => {
  const h = harness();
  h.state.wait = async () => {
    h.state.actual = { ...h.state.sent, to: other };
    return { status: "success", transactionHash: hash };
  };
  await assert.rejects(
    h.execute(await h.prepare()),
    expectCode("TRANSACTION_MISMATCH"),
  );
});
await test("UI progress callback errors do not stop receipt tracking", async () => {
  const h = harness();
  const result = await h.execute(await h.prepare(), {
    onHash() {
      throw new Error("UI error");
    },
  });
  assert.equal(result.status, "success");
});
await test("successful deposit is sent once after simulation and recheck", async () => {
  const h = harness();
  const p = await h.prepare();
  const result = await h.execute(p);
  assert.equal(result.status, "success");
  assert.equal(h.state.writes.length, 1);
  const simulateIndex = h.state.calls.indexOf("simulate:deposit");
  const writeIndex = h.state.calls.indexOf("write:deposit");
  assert(
    h.state.calls.slice(simulateIndex + 1, writeIndex).includes("accounts"),
  );
  assert(h.state.calls.slice(simulateIndex + 1, writeIndex).includes("chain"));
  assert.equal(h.state.writes[0].address, vault.address);
  assert.deepEqual(h.state.writes[0].args, [10_123_456n, owner]);
  assert.equal(h.state.writes[0].value, 0n);
});
await test("fee changes require a fresh review", async () => {
  for (const field of ["managementFee", "performanceFee"]) {
    const h = harness();
    const p = await h.prepare();
    h.state.position[field] = 10n ** 16n;
    await assert.rejects(h.execute(p), expectCode("TERMS_CHANGED"));
    assert.equal(h.state.writes.length, 0);
  }
});
await test("explicit wallet rejection remains distinct from unknown submission", async () => {
  const rejected = Object.assign(new Error("User rejected the request"), {
    code: 4001,
  });
  const h = harness({ writeError: rejected });
  await assert.rejects(
    h.execute(await h.prepare()),
    (error) => error === rejected,
  );
  assert(!h.state.calls.includes("receipt"));
  const unknown = harness({
    writeError: new Error("Provider disconnected during request"),
  });
  await assert.rejects(unknown.execute(await unknown.prepare()), (error) => {
    assert.equal(error.code, "SUBMISSION_UNCERTAIN");
    assert.equal(error.status, "pending");
    assert.equal(error.hash, undefined);
    return true;
  });
});
await test("false approval simulation never becomes a wallet request", async () => {
  const h = harness({
    position: { allowance: 0n },
    simulationResponse: { request: {}, result: false },
  });
  await assert.rejects(
    h.execute(await h.prepare(), { action: "approve" }),
    expectCode("APPROVAL_REJECTED"),
  );
  assert.equal(h.state.writes.length, 0);
});
await test("simulation request cannot override reviewed call", async () => {
  const h = harness({
    simulationResponse: {
      request: {
        address: other,
        account: other,
        functionName: "transfer",
        args: [other, 999n],
        value: 10n,
      },
      result: 1n,
    },
  });
  const result = await h.execute(await h.prepare());
  assert.equal(result.status, "success");
  assert.equal(h.state.writes[0].address, vault.address);
  assert.equal(h.state.writes[0].account, owner);
  assert.equal(h.state.writes[0].functionName, "deposit");
  assert.deepEqual(h.state.writes[0].args, [10_123_456n, owner]);
  assert.equal(h.state.writes[0].value, 0n);
});
await test("unknown receipt status cannot be presented as success", async () => {
  const h = harness({ receiptStatus: "unknown" });
  await assert.rejects(
    h.execute(await h.prepare()),
    expectCode("CONFIRMATION_PENDING"),
  );
});
await test("approval receipt must be followed by sufficient live allowance", async () => {
  const h = harness({
    position: { allowance: 0n },
    allowanceAfterReceipt: 10_123_455n,
  });
  await assert.rejects(
    h.execute(await h.prepare(), { action: "approve" }),
    (error) => {
      assert.equal(error.code, "APPROVAL_NOT_EFFECTIVE");
      assert.equal(error.status, "approval_missing");
      assert.equal(error.hash, hash);
      return true;
    },
  );
  assert(h.state.calls.indexOf("allowance") > h.state.calls.indexOf("receipt"));
  assert.equal(h.state.writes.length, 1);
});
await test("allowance read failure after receipt retains pending recovery", async () => {
  const h = harness({
    position: { allowance: 0n },
    allowanceError: new Error("RPC unavailable"),
  });
  await assert.rejects(
    h.execute(await h.prepare(), { action: "approve" }),
    (error) => {
      assert.equal(error.code, "ALLOWANCE_UNVERIFIED");
      assert.equal(error.status, "pending");
      assert.equal(error.hash, hash);
      return true;
    },
  );
});
await test("hash callbacks carry exact intent and refreshed withdrawal preview", async () => {
  const h = harness();
  const p = await h.prepare({ kind: "withdraw", all: true });
  h.state.position.positionAssets = 102_000_000n;
  const contexts = [];
  h.state.wait = async ({ onReplaced }) => {
    h.state.actual = { ...h.state.sent, hash: replacementHash };
    onReplaced({ reason: "repriced", transaction: h.state.actual });
    return { status: "success", transactionHash: replacementHash };
  };
  await h.execute(p, { onHash: (_, context) => contexts.push(context) });
  assert.equal(contexts.length, 2);
  for (const context of contexts) {
    assert.equal(context.input, h.state.sent.input);
    assert.equal(context.rawAmount, 102_000_000n);
    assert.equal(context.prepared.rawAmount, 102_000_000n);
    assert.equal(context.shares, p.shares);
  }
});
await test("redeem receipt reports actual assets rather than preview", async () => {
  const h = harness();
  const p = await h.prepare({ kind: "withdraw", all: true });
  h.state.wait = async () => ({
    status: "success",
    transactionHash: hash,
    logs: [
      {
        address: vault.address,
        topics: encodeEventTopics({
          abi: vaultAbi,
          eventName: "Withdraw",
          args: { sender: owner, receiver: owner, owner },
        }),
        data: encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          [101_000_007n, p.shares],
        ),
      },
    ],
  });
  const result = await h.execute(p);
  assert.equal(result.prepared.rawAmount, 101_000_000n);
  assert.equal(result.actualAmount, 101_000_007n);
  assert.equal(result.actualShares, p.shares);
});
await test("production export invokes chain verification before previews", async () => {
  const publicClient = {
    async getBlockNumber() {
      return 100n;
    },
    async getChainId() {
      return 1;
    },
  };
  await assert.rejects(
    prepareTransaction({
      publicClient,
      vaultId: "arbitrum",
      owner,
      kind: "deposit",
      amount: "10",
    }),
    /RPC returned a different network/,
  );
});
await test("production export rejects unknown implementation bytecode", async () => {
  const publicClient = {
    async getBlockNumber() {
      return 100n;
    },
    async getChainId() {
      return 42161;
    },
    async getStorageAt() {
      return "0x" + "0".repeat(24) + other.slice(2);
    },
    async getBytecode() {
      return "0x1234";
    },
  };
  await assert.rejects(
    prepareTransaction({
      publicClient,
      vaultId: "arbitrum",
      owner,
      kind: "deposit",
      amount: "10",
    }),
    /implementation has changed/,
  );
});

console.log(
  `${passed} vault transaction tests passed. No signing or network calls.`,
);
