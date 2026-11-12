import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateCommit,
  migrationHead,
  acquireDeploymentLock,
  verifyVersion,
  historyProcessConfig,
  historyWorkerSnapshot,
  readHistoryState,
  seedHistory,
  activateMigrationServices,
} from "../deploy/automation/release-migration.mjs";
import Database from "better-sqlite3";

const sha = "a".repeat(40);

test("release accepts only a full SHA and the exact migration remote head", () => {
  assert.equal(validateCommit(sha), sha);
  for (const value of [null, "HEAD", "a".repeat(39), "A".repeat(40), sha + ";"])
    assert.throws(() => validateCommit(value));
  assert.equal(migrationHead(`${sha}\trefs/heads/migration\n`), sha);
  for (const value of [
    "",
    `${sha}\trefs/heads/master`,
    `${sha}\trefs/heads/migration\n${sha}\trefs/heads/master`,
    `${sha}\trefs/heads/migration extra`,
  ])
    assert.throws(() => migrationHead(value));
});

test("deployment owns the lock until it explicitly releases its fd", () => {
  const dir = mkdtempSync(join(tmpdir(), "migration-lock-"));
  const path = join(dir, "deploy.lock");
  let unlock;
  try {
    unlock = acquireDeploymentLock(path);
    assert.throws(
      () => acquireDeploymentLock(path),
      /holds the deployment lock/,
    );
    unlock();
    unlock = acquireDeploymentLock(path);
  } finally {
    unlock?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP provenance rejects stale commits, other branches and extra fields", async () => {
  const fetcher =
    (value, status = 200) =>
    async (_url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      return Response.json(value, { status });
    };
  await verifyVersion(
    "https://example.invalid",
    sha,
    fetcher({ branch: "migration", sha }),
  );
  for (const value of [
    { branch: "master", sha },
    { branch: "migration", sha: "b".repeat(40) },
    { branch: "migration", sha, release: "/private/path" },
  ])
    await assert.rejects(
      verifyVersion("https://example.invalid", sha, fetcher(value)),
    );
  await assert.rejects(
    verifyVersion("https://example.invalid", sha, fetcher({}, 503)),
    /not healthy/,
  );
});

test("version route projects only branch and SHA and fails closed in production", async () => {
  // Load the route independently of Next; it uses only standard Node APIs.
  const source = readFileSync(
    new URL("../app/api/version/route.js", import.meta.url),
    "utf8",
  );
  const { GET } = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
  const previousCwd = process.cwd();
  const previousEnv = process.env.NODE_ENV;
  const dir = mkdtempSync(join(tmpdir(), "migration-version-"));
  try {
    process.chdir(dir);
    process.env.NODE_ENV = "production";
    let response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { branch: null, sha: null });
    writeFileSync(
      join(dir, ".portal-release.json"),
      JSON.stringify({
        branch: "migration",
        sha,
        origin: "https://app-v2-dev.thesauros.io",
        privateSetting: "never expose",
      }),
    );
    response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { branch: "migration", sha });
    writeFileSync(
      join(dir, ".portal-release.json"),
      JSON.stringify({ branch: "master", sha }),
    );
    assert.equal((await GET()).status, 503);
    process.env.NODE_ENV = "development";
    response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      branch: "development",
      sha: null,
    });
  } finally {
    process.chdir(previousCwd);
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("history worker pins Node, release, one process and the same persistent history DB", () => {
  const [config] = historyProcessConfig("/releases/new").apps;
  assert.equal(config.name, "developer-portal-migration-indexer");
  assert.equal(config.cwd, "/releases/new");
  assert.equal(config.script, "/releases/new/scripts/index-crosschain.mjs");
  assert.equal(config.interpreter, "/opt/node-v24.21.0-linux-x64/bin/node");
  assert.deepEqual(config.node_args, ["--env-file=.env.local"]);
  assert.equal(config.instances, 1);
  assert.equal(
    config.env.CROSSCHAIN_HISTORY_DB,
    "/var/lib/thesauros-portal-v2/history.sqlite",
  );
  const worker = {
    name: config.name,
    pm2_env: {
      ...config.env,
      pm_cwd: config.cwd,
      pm_exec_path: config.script,
      exec_interpreter: config.interpreter,
      exec_mode: "fork_mode",
      node_args: config.node_args,
      status: "online",
    },
  };
  assert.deepEqual(historyWorkerSnapshot([worker]), {
    release: "/releases/new",
    status: "online",
  });
  assert.equal(
    historyWorkerSnapshot([{ name: "unrelated-crosschain-indexer" }]),
    null,
  );
  assert.throws(() => historyWorkerSnapshot([worker, worker]), /More than one/);
  assert.throws(
    () =>
      historyWorkerSnapshot([
        {
          ...worker,
          pm2_env: {
            ...worker.pm2_env,
            CROSSCHAIN_HISTORY_DB: "/other/history.sqlite",
          },
        },
      ]),
    /unexpected configuration/,
  );
});

test("history seed is a consistent contract-scoped backup and never overwrites a target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "migration-history-seed-"));
  const source = join(dir, "source.sqlite");
  const target = join(dir, "target.sqlite");
  const identity = "8453:0xvault:0xaccountant:100";
  const db = new Database(source);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(
      "CREATE TABLE history_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    const set = db.prepare("INSERT OR REPLACE INTO history_meta VALUES(?,?)");
    for (const [key, value] of Object.entries({
      identity,
      indexedTo: 150,
      head: 200,
      lastSync: 123,
      error: "",
    }))
      set.run(key, String(value));
    const seeded = await seedHistory(Database, identity, target, source);
    assert.equal(seeded.seeded, true);
    assert.equal(seeded.indexedTo, 150);
    assert.equal(seeded.complete, false);
    set.run("indexedTo", "200");
    assert.equal(
      (await seedHistory(Database, identity, target, source)).seeded,
      false,
    );
    assert.equal(readHistoryState(Database, target, identity).indexedTo, 150);
    assert.equal(readHistoryState(Database, source, identity).indexedTo, 200);
    const wrongTarget = join(dir, "wrong.sqlite");
    await assert.rejects(
      seedHistory(Database, "other-deployment", wrongTarget, source),
      /different contract deployment/,
    );
    assert.equal(existsSync(wrongTarget), false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release starts history only after web health and persists both healthy services", async () => {
  const next = { release: "new" },
    previous = { release: "old" };
  const calls = [];
  await activateMigrationServices(next, previous, null, {
    applyWeb: async (value) => calls.push("apply:" + value.release),
    webHealthy: async (value) => calls.push("web:" + value.release),
    startWorker: async (value) => calls.push("start:" + value.release),
    workerHealthy: async (value) => calls.push("worker:" + value.release),
    restoreWorker: async () => calls.push("restore"),
    persist: async (value) => calls.push("persist:" + value.release),
  });
  assert.deepEqual(calls, [
    "apply:new",
    "web:new",
    "start:new",
    "worker:new",
    "persist:new",
  ]);
});

test("history failure rolls web back and restores the previous worker or its absence", async () => {
  const next = { release: "new" },
    previous = { release: "old" };
  for (const snapshot of [null, { release: "old-worker", status: "online" }]) {
    const calls = [];
    await assert.rejects(
      activateMigrationServices(next, previous, snapshot, {
        applyWeb: async (value) => calls.push("apply:" + value.release),
        webHealthy: async (value) => calls.push("web:" + value.release),
        startWorker: async (value) => calls.push("start:" + value.release),
        workerHealthy: async () => {
          throw Error("RPC offline");
        },
        restoreWorker: async (value) => {
          assert.equal(value, snapshot);
          calls.push("restore:" + (value?.release || "absent"));
        },
        persist: async (value) => calls.push("persist:" + value.release),
      }),
      /previous application release restored/,
    );
    assert.deepEqual(calls, [
      "apply:new",
      "web:new",
      "start:new",
      "restore:" + (snapshot?.release || "absent"),
      "apply:old",
      "web:old",
      "persist:old",
    ]);
  }
});
