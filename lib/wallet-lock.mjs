// One wallet prepares one transaction at a time, across tabs.
//
// Browsers give pages a lock for this (Web Locks), but only on a secure origin.
// Where it is missing (plain HTTP on anything but localhost, or an old browser)
// the same promise is kept with a lease in browser storage: a tab writes its
// name with an expiry, keeps it fresh while it works, and removes it when done.
// A tab that closes without removing it stops blocking once the lease runs out.
//
// The lease is the second guard, not the first: a request is saved to storage
// before the wallet is asked to sign, and every tab checks for a saved request
// before starting its own.

export const LOCK_BUSY = Symbol("another tab holds the wallet lock");
export const LOCK_UNAVAILABLE = Symbol("the wallet lock cannot be kept here");

const LEASE_MS = 60_000;
const RENEW_MS = 10_000;
// Long enough for a tab that found the lease free at the same moment to have
// written its own; reading and writing are one synchronous step in each tab.
const SETTLE_MS = 80;

const tab =
  Math.random().toString(36).slice(2) + "." + Date.now().toString(36);
let taken = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repeat = (task, ms) => {
  const timer = setInterval(task, ms);
  return () => clearInterval(timer);
};

// Reaching for storage can itself throw where a browser blocks it.
function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function holder(storage, key, now) {
  try {
    const lease = JSON.parse(storage.getItem(key) || "null");
    return lease && typeof lease.id === "string" && lease.until > now
      ? lease.id
      : null;
  } catch {
    // A value nobody can read is a lease nobody holds.
    return null;
  }
}

async function underLease(name, task, { storage, now, wait, every, page }) {
  const key = "thesauros.lock." + name;
  const id = tab + "." + ++taken;
  const write = () =>
    storage.setItem(key, JSON.stringify({ id, until: now() + LEASE_MS }));
  try {
    if (holder(storage, key, now())) return LOCK_BUSY;
    write();
  } catch {
    return LOCK_UNAVAILABLE;
  }
  await wait(SETTLE_MS);
  if (holder(storage, key, now()) !== id) return LOCK_BUSY;
  const stop = every(() => {
    try {
      if (holder(storage, key, now()) === id) write();
    } catch {
      /* The saved request still guards the wallet. */
    }
  }, RENEW_MS);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stop();
    try {
      if (holder(storage, key, now()) === id) storage.removeItem(key);
    } catch {
      /* It expires by itself. */
    }
    page?.removeEventListener?.("pagehide", release);
  };
  // A reload must not leave the next page waiting for its own old lease.
  page?.addEventListener?.("pagehide", release);
  try {
    return await task();
  } finally {
    release();
  }
}

// Runs `task` while this tab alone holds the lock named `name`. Resolves to the
// task's result, to LOCK_BUSY when another tab holds the lock (the task did not
// run), or to LOCK_UNAVAILABLE when the browser offers neither Web Locks nor
// storage to keep a lease in.
export async function underWalletLock(name, task, environment = {}) {
  const {
    locks = globalThis.navigator?.locks,
    storage = browserStorage(),
    now = Date.now,
    wait = sleep,
    every = repeat,
    page = globalThis.window,
  } = environment;
  if (locks)
    return locks.request(name, { ifAvailable: true }, (lock) =>
      lock ? task() : LOCK_BUSY,
    );
  if (!storage) return LOCK_UNAVAILABLE;
  return underLease(name, task, { storage, now, wait, every, page });
}
