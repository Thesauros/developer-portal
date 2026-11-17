import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCK_BUSY,
  LOCK_UNAVAILABLE,
  underWalletLock,
} from "../lib/wallet-lock.mjs";

const name = "thesauros.migration.v1.0x1111111111111111111111111111111111111111";
const leaseKey = "thesauros.lock." + name;

function memory() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}
// A browser without Web Locks, with a clock and timers the test moves by hand.
function tabless(storage, extra = {}) {
  const clock = { now: 1_000_000, beats: [], waits: [] };
  return {
    clock,
    environment: {
      locks: null,
      storage,
      page: null,
      now: () => clock.now,
      wait: (ms) => {
        clock.waits.push(ms);
        return extra.duringWait ? extra.duringWait() : Promise.resolve();
      },
      every: (task) => {
        clock.beats.push(task);
        return () => clock.beats.splice(clock.beats.indexOf(task), 1);
      },
    },
  };
}

test("Web Locks, where the browser has them, decide who runs", async () => {
  const asked = [];
  const locks = (free) => ({
    request: async (lockName, options, callback) => {
      asked.push([lockName, options]);
      return callback(free ? { name: lockName } : null);
    },
  });
  assert.equal(
    await underWalletLock(name, async () => "signed", { locks: locks(true) }),
    "signed",
  );
  let ran = false;
  assert.equal(
    await underWalletLock(name, async () => (ran = true), {
      locks: locks(false),
    }),
    LOCK_BUSY,
  );
  assert.equal(ran, false);
  assert.deepEqual(asked[0], [name, { ifAvailable: true }]);
});

test("without Web Locks the task runs under a lease and the lease is removed after", async () => {
  const storage = memory();
  const { environment, clock } = tabless(storage);
  let heldDuring;
  const result = await underWalletLock(
    name,
    async () => {
      heldDuring = JSON.parse(storage.getItem(leaseKey));
      return "signed";
    },
    environment,
  );
  assert.equal(result, "signed");
  assert.equal(heldDuring.until, clock.now + 60_000);
  assert.equal(storage.getItem(leaseKey), null);
  assert.equal(clock.beats.length, 0);
});

test("a second tab is refused while the first works, and admitted once it is done", async () => {
  const storage = memory();
  const first = tabless(storage);
  const second = tabless(storage);
  let finish;
  const working = underWalletLock(
    name,
    () => new Promise((resolve) => (finish = resolve)),
    first.environment,
  );
  await new Promise((resolve) => setImmediate(resolve));
  let ran = false;
  assert.equal(
    await underWalletLock(name, async () => (ran = true), second.environment),
    LOCK_BUSY,
  );
  assert.equal(ran, false);
  finish("first");
  assert.equal(await working, "first");
  assert.equal(
    await underWalletLock(name, async () => "second", second.environment),
    "second",
  );
});

test("two tabs that find the lease free at once: the later writer runs, the other stands down", async () => {
  const storage = memory();
  const rival = JSON.stringify({ id: "rival.1", until: 1_000_000 + 60_000 });
  const { environment } = tabless(storage, {
    // The other tab wrote after this one did, before this one looked again.
    duringWait: async () => storage.setItem(leaseKey, rival),
  });
  let ran = false;
  assert.equal(
    await underWalletLock(name, async () => (ran = true), environment),
    LOCK_BUSY,
  );
  assert.equal(ran, false);
  assert.equal(storage.getItem(leaseKey), rival);
});

test("a lease left by a closed tab stops blocking when it runs out", async () => {
  const storage = memory();
  storage.setItem(leaseKey, JSON.stringify({ id: "gone.1", until: 999_999 }));
  const { environment } = tabless(storage);
  assert.equal(
    await underWalletLock(name, async () => "signed", environment),
    "signed",
  );
  storage.setItem(leaseKey, "not json");
  assert.equal(
    await underWalletLock(name, async () => "again", environment),
    "again",
  );
});

test("the lease is kept fresh while the task waits for the wallet", async () => {
  const storage = memory();
  const { environment, clock } = tabless(storage);
  let finish;
  const working = underWalletLock(
    name,
    () => new Promise((resolve) => (finish = resolve)),
    environment,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clock.beats.length, 1);
  clock.now += 50_000;
  clock.beats[0]();
  assert.equal(JSON.parse(storage.getItem(leaseKey)).until, clock.now + 60_000);
  // Another tab took over after this one stalled: its lease is left alone.
  const rival = JSON.stringify({ id: "rival.1", until: clock.now + 60_000 });
  storage.setItem(leaseKey, rival);
  clock.beats[0]();
  finish("done");
  await working;
  assert.equal(storage.getItem(leaseKey), rival);
});

test("leaving the page gives the lease back at once", async () => {
  const storage = memory();
  const { environment } = tabless(storage);
  const listeners = {};
  environment.page = {
    addEventListener: (event, handler) => (listeners[event] = handler),
    removeEventListener: (event) => delete listeners[event],
  };
  let finish;
  const working = underWalletLock(
    name,
    () => new Promise((resolve) => (finish = resolve)),
    environment,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(storage.getItem(leaseKey), null);
  listeners.pagehide();
  assert.equal(storage.getItem(leaseKey), null);
  finish();
  await working;
  assert.equal(listeners.pagehide, undefined);
});

test("no Web Locks and no storage: the caller is told the lock cannot be kept", async () => {
  let ran = false;
  const task = async () => (ran = true);
  assert.equal(
    await underWalletLock(name, task, { locks: null, storage: null }),
    LOCK_UNAVAILABLE,
  );
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  assert.equal(
    await underWalletLock(name, task, tabless(refusing).environment),
    LOCK_UNAVAILABLE,
  );
  assert.equal(ran, false);
});

test("a task that fails still gives the lease back", async () => {
  const storage = memory();
  const { environment } = tabless(storage);
  await assert.rejects(
    underWalletLock(
      name,
      async () => {
        throw new Error("wallet refused");
      },
      environment,
    ),
    /wallet refused/,
  );
  assert.equal(storage.getItem(leaseKey), null);
});
