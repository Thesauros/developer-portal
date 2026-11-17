// Shared manual/OIDC release for the authorized migration branch and domain.
import { checkApplication } from "./health.mjs";
import { activateRelease, processConfig } from "./release.mjs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  openSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  symlinkSync,
  existsSync,
  unlinkSync,
  chmodSync,
  realpathSync,
  linkSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const stateRoot = "/var/lib/thesauros-portal-v2";
const checkout = "/root/developer-portal-v2";
const branch = "migration";
const ref = "refs/heads/migration";
const origin = "https://app-v2-dev.thesauros.io";
const node = "/opt/node-v24.21.0-linux-x64/bin/node";
const npm = "/opt/node-v24.21.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js";
const pm2 = "/usr/local/lib/node_modules/pm2/bin/pm2";
const processName = "developer-portal-v2";
const indexerName = "developer-portal-migration-indexer";
const historyPath = join(stateRoot, "history.sqlite");
const historySeedPath =
  "/var/lib/docker/volumes/deploy_crosschain-accounts/_data/history.sqlite";
const toolEnv = {
  ...process.env,
  PATH: "/opt/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin",
  GIT_TERMINAL_PROMPT: "0",
};

export function validateCommit(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw new Error("A full lowercase commit SHA is required");
  return sha;
}

export function migrationHead(output) {
  const rows = output.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) throw new Error("Expected exactly one migration head");
  const [sha, name, ...extra] = rows[0].split(/\s+/);
  if (name !== ref || extra.length)
    throw new Error("Remote response is not the migration branch");
  return validateCommit(sha);
}

// flock locks the inherited open file description. The parent keeps its fd open
// for the entire deployment, so no environment flag or caller claim bypasses it.
export function acquireDeploymentLock(path = join(stateRoot, "deploy.lock")) {
  const fd = openSync(path, "a", 0o600);
  try {
    execFileSync("/usr/bin/flock", ["--nonblock", "3"], {
      stdio: ["ignore", "inherit", "inherit", fd],
    });
  } catch (cause) {
    closeSync(fd);
    throw new Error("Another portal deployment holds the deployment lock", {
      cause,
    });
  }
  return () => closeSync(fd);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: toolEnv,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolve();
      const error = new Error(`${command} exited with ${code}`);
      error.exitCode = code;
      reject(error);
    });
  });
}

export function hasFreshBuildNudge(release, startedAt, now = Date.now()) {
  try {
    const { version } = JSON.parse(
      readFileSync(join(release, "node_modules/next/package.json"), "utf8"),
    );
    if (typeof version !== "string") return false;
    const identity = createHash("sha256")
      .update(`${realpathSync(release)}\0${version}\0build\0security`)
      .digest("hex");
    const receipt = join(
      release,
      ".next/cache/next-agentic-upgrade-retries",
      identity + ".json",
    );
    if (!lstatSync(receipt).isFile()) return false;
    const { issuedAt } = JSON.parse(readFileSync(receipt, "utf8"));
    return (
      Number.isFinite(issuedAt) &&
      issuedAt >= startedAt &&
      issuedAt <= now &&
      now - issuedAt < 240_000
    );
  } catch {
    return false;
  }
}

export async function buildMigration(
  release,
  options,
  execute = run,
  now = Date.now,
) {
  const args = ["--kill-after=15s", "15m", node, npm, "run", "build"];
  const startedAt = now();
  try {
    await execute("/usr/bin/timeout", args, options);
  } catch (error) {
    // Next's security advisory issues a short-lived, cwd/version-specific
    // receipt for one supported identical retry. Ordinary build errors, old
    // receipts, other commands/versions and timeouts must never trigger it.
    if (error.exitCode !== 1 || !hasFreshBuildNudge(release, startedAt, now()))
      throw error;
    console.warn(
      "Next security advisory recorded; retrying this identical build once.",
    );
    await execute("/usr/bin/timeout", args, options);
  }
}

function git(args) {
  return execFileSync("git", ["-C", checkout, ...args], {
    env: toolEnv,
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

function saveJSON(path, value) {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(path + ".tmp", path);
}

function assertRemoteCommit(sha) {
  if (migrationHead(git(["ls-remote", "--heads", "origin", ref])) !== sha)
    throw new Error("migration changed; refusing to activate a stale commit");
}

export async function verifyVersion(base, expected, fetcher = fetch) {
  const response = await fetcher(base + "/api/version", {
    headers: { Host: "app-v2-dev.thesauros.io", "X-Forwarded-Proto": "https" },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
    cache: "no-store",
  });
  if (response.status !== 200)
    throw new Error("The release version endpoint is not healthy");
  const value = await response.json();
  if (
    value.branch !== branch ||
    value.sha !== expected ||
    Object.keys(value).sort().join(",") !== "branch,sha"
  )
    throw new Error("The HTTP release version does not match migration");
}

async function waitHealthy(port, value) {
  const legacy = !existsSync(join(value.release, "app/app/page.jsx"));
  let last;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await checkApplication(`http://127.0.0.1:${port}`, { legacy });
      if (value.branch === branch)
        await verifyVersion(`http://127.0.0.1:${port}`, value.sha);
      return;
    } catch (error) {
      last = error;
      await delay(1000);
    }
  }
  throw last;
}

function pm2List() {
  return JSON.parse(
    execFileSync(node, [pm2, "jlist"], { env: toolEnv, encoding: "utf8" }),
  );
}

export function historyProcessConfig(release) {
  return {
    apps: [
      {
        name: indexerName,
        cwd: release,
        script: join(release, "scripts/index-crosschain.mjs"),
        interpreter: node,
        node_args: ["--env-file=.env.local"],
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        watch: false,
        max_memory_restart: "512M",
        min_uptime: "10s",
        max_restarts: 10,
        restart_delay: 3000,
        kill_timeout: 10000,
        time: true,
        env: {
          NODE_ENV: "production",
          PATH: toolEnv.PATH,
          THESAUROS_AUTH_DB: join(stateRoot, "accounts.sqlite"),
          CROSSCHAIN_HISTORY_DB: historyPath,
        },
      },
    ],
  };
}

export function historyWorkerSnapshot(list) {
  const workers = list.filter((app) => app.name === indexerName);
  if (workers.length > 1)
    throw new Error("More than one migration history worker exists");
  if (!workers.length) return null;
  const env = workers[0].pm2_env;
  if (
    !env?.pm_cwd ||
    env.pm_exec_path !== join(env.pm_cwd, "scripts/index-crosschain.mjs") ||
    env.exec_interpreter !== node ||
    env.exec_mode !== "fork_mode" ||
    JSON.stringify(env.node_args) !==
      JSON.stringify(["--env-file=.env.local"]) ||
    env.CROSSCHAIN_HISTORY_DB !== historyPath ||
    env.THESAUROS_AUTH_DB !== join(stateRoot, "accounts.sqlite")
  )
    throw new Error(
      "Existing migration worker has an unexpected configuration",
    );
  return { release: env.pm_cwd, status: env.status };
}

export function readHistoryState(Database, path, identity) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const meta = Object.fromEntries(
      db
        .prepare("SELECT key,value FROM history_meta")
        .all()
        .map((row) => [row.key, row.value]),
    );
    if (meta.identity !== identity)
      throw new Error("History belongs to a different contract deployment");
    const indexedTo = Number(
      meta.indexedTo || Number(identity.split(":").at(-1)) - 1,
    );
    const head = Number(meta.head || 0);
    const lastSync = Number(meta.lastSync || 0);
    if (![indexedTo, head, lastSync].every(Number.isSafeInteger))
      throw new Error("History cursor metadata is invalid");
    return {
      indexedTo,
      head,
      lastSync,
      error: Boolean(meta.error),
      complete: head > 0 && indexedTo >= head,
    };
  } finally {
    db.close();
  }
}

export async function seedHistory(
  Database,
  identity,
  target = historyPath,
  source = historySeedPath,
) {
  if (existsSync(target))
    return { seeded: false, ...readHistoryState(Database, target, identity) };
  if (!existsSync(source)) return { seeded: false, unavailable: true };
  // Only the rebuildable event index is read; source accounts are never opened.
  readHistoryState(Database, source, identity);
  const temporary = `${target}.seed-${process.pid}-${Date.now()}`;
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(temporary);
    chmodSync(temporary, 0o600);
    const coverage = readHistoryState(Database, temporary, identity);
    try {
      // Hard-link publication cannot overwrite a DB created by another reader.
      linkSync(temporary, target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return { seeded: false, ...readHistoryState(Database, target, identity) };
    }
    return { seeded: true, ...coverage };
  } finally {
    db.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function applyWeb(value) {
  const path = join(stateRoot, "pm2-current.json");
  const config = processConfig(value.release);
  if (value.branch === branch)
    config.apps[0].env.CROSSCHAIN_HISTORY_DB = historyPath;
  saveJSON(path, config);
  if (pm2List().some((app) => app.name === processName))
    await run(node, [pm2, "delete", processName]);
  await run(node, [pm2, "start", path, "--only", processName]);
  if (
    pm2List().find((app) => app.name === processName)?.pm2_env.pm_cwd !==
    value.release
  )
    throw new Error("PM2 did not switch to the requested release");
}

async function stopHistoryWorker() {
  const previous = historyWorkerSnapshot(pm2List());
  if (previous) await run(node, [pm2, "delete", indexerName]);
}

async function startHistoryWorker(value) {
  await stopHistoryWorker();
  const configPath = join(stateRoot, "pm2-migration-indexer.json");
  saveJSON(configPath, historyProcessConfig(value.release));
  await run(node, [pm2, "start", configPath, "--only", indexerName]);
}

async function waitHistoryWorker(value, Database, identity, since) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const worker = historyWorkerSnapshot(pm2List());
    if (
      worker?.release === value.release &&
      worker.status === "online" &&
      existsSync(historyPath)
    ) {
      let coverage;
      try {
        coverage = readHistoryState(Database, historyPath, identity);
      } catch (error) {
        // The first worker may still be creating its SQLite schema. Identity
        // mismatches are definitive; a transient open/lock failure can retry.
        if (
          error.message === "History belongs to a different contract deployment"
        )
          throw error;
      }
      if (coverage?.lastSync >= since && coverage.head > 0 && !coverage.error) {
        console.log(
          `Migration history: ${coverage.indexedTo}/${coverage.head}, ${coverage.complete ? "current" : "backfilling"}`,
        );
        return;
      }
    }
    await delay(1000);
  }
  throw new Error(
    "Migration history worker did not produce a fresh confirmed cursor",
  );
}

// Keep service switching reviewable and testable without invoking PM2. The
// worker starts only after the new web release passes local and public checks.
export async function activateMigrationServices(
  next,
  previous,
  oldWorker,
  operations,
) {
  let changedWorker = false;
  await activateRelease(next, previous, {
    apply: async (value) => {
      if (value !== previous || !changedWorker)
        return operations.applyWeb(value);
      const failures = [];
      try {
        await operations.restoreWorker(oldWorker);
      } catch (error) {
        failures.push(error);
      }
      try {
        await operations.applyWeb(value);
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, "Service rollback failed");
    },
    healthy: async (value) => {
      await operations.webHealthy(value);
      if (value === next) {
        changedWorker = true;
        await operations.startWorker(value);
        await operations.workerHealthy(value);
      }
    },
    persist: operations.persist,
  });
}

export async function deployMigration(sha) {
  validateCommit(sha);
  if (realpathSync(process.execPath) !== realpathSync(node))
    throw new Error(`Run this release with ${node}`);
  const unlock = acquireDeploymentLock();
  try {
    return await deployLocked(sha);
  } finally {
    unlock();
  }
}

async function deployLocked(sha) {
  const remote = git(["remote", "get-url", "origin"]);
  if (
    ![
      "git@github-thesauros:Thesauros/developer-portal.git",
      "git@github.com:Thesauros/developer-portal.git",
      "https://github.com/Thesauros/developer-portal.git",
    ].includes(remote)
  )
    throw new Error("Unexpected source repository");
  assertRemoteCommit(sha);
  await run("git", ["-C", checkout, "fetch", "--quiet", "origin", ref]);
  if (
    git(["rev-parse", "FETCH_HEAD"]) !== sha ||
    git(["rev-parse", sha + "^{commit}"]) !== sha
  )
    throw new Error(
      "Fetched source does not match the requested migration SHA",
    );
  assertRemoteCommit(sha);

  const currentPath = join(stateRoot, "current.json");
  const previous = JSON.parse(readFileSync(currentPath, "utf8"));
  const runtime = {
    ...toolEnv,
    ...parseEnv(readFileSync(join(stateRoot, "runtime.env"), "utf8")),
    NODE_OPTIONS: "--max-old-space-size=3072",
  };
  if (
    runtime.BETTER_AUTH_URL !== origin ||
    runtime.THESAUROS_AUTH_DB !== join(stateRoot, "accounts.sqlite") ||
    runtime.TURSO_DATABASE_URL ||
    (runtime.CROSSCHAIN_HISTORY_DB &&
      runtime.CROSSCHAIN_HISTORY_DB !== historyPath) ||
    (runtime.THESAUROS_NEXT_DIST && runtime.THESAUROS_NEXT_DIST !== ".next")
  )
    throw new Error(
      "Unexpected production origin, database or build directory",
    );
  runtime.CROSSCHAIN_HISTORY_DB = historyPath;
  const existingWorker = historyWorkerSnapshot(pm2List());
  if (
    previous.sha === sha &&
    previous.branch === branch &&
    existingWorker?.release === previous.release &&
    existingWorker.status === "online"
  ) {
    const Database = createRequire(join(previous.release, "package.json"))(
      "better-sqlite3",
    );
    const { crosschain } = await import(
      pathToFileURL(join(previous.release, "lib/crosschain-config.mjs")).href
    );
    const identity = `${crosschain.chainId}:${crosschain.vault.toLowerCase()}:${crosschain.accountant.toLowerCase()}:${crosschain.startBlock}`;
    await waitHealthy(18880, previous);
    await verifyVersion(origin, sha);
    await waitHistoryWorker(previous, Database, identity, Date.now());
    console.log(
      "This migration commit and history worker are already healthy: " + sha,
    );
    return 0;
  }

  const releases = join(stateRoot, "releases");
  mkdirSync(releases, { recursive: true, mode: 0o700 });
  const release = mkdtempSync(join(releases, sha + "-"));
  const archive = join(release, "source.tar");
  await run("git", [
    "-C",
    checkout,
    "archive",
    "--format=tar",
    "--output=" + archive,
    sha,
  ]);
  await run("tar", ["-xf", archive, "-C", release]);
  unlinkSync(archive);
  if (
    existsSync(join(release, ".env.local")) ||
    existsSync(join(release, ".portal-release.json")) ||
    !existsSync(join(release, "app/api/version/route.js"))
  )
    throw new Error(
      "Source contains private release files or lacks provenance route",
    );
  const provenance = {
    sha,
    branch,
    origin,
    sourceTree: git(["rev-parse", sha + "^{tree}"]),
    createdAt: new Date().toISOString(),
  };
  saveJSON(join(release, ".portal-release.json"), provenance);
  chmodSync(join(release, ".portal-release.json"), 0o444);
  symlinkSync(join(stateRoot, "runtime.env"), join(release, ".env.local"));
  if (!existsSync(join(releases, "private-state")))
    symlinkSync("/root/private-state", join(releases, "private-state"));

  const buildOptions = {
    cwd: release,
    env: {
      ...runtime,
      THESAUROS_AUTH_DB: join(release, ".build-auth.sqlite"),
      CROSSCHAIN_HISTORY_DB: join(release, ".build-history.sqlite"),
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
  };
  console.log("Installing and building migration commit " + sha);
  await run(
    "/usr/bin/timeout",
    [
      "--kill-after=15s",
      "15m",
      node,
      npm,
      "ci",
      "--include=dev",
      "--no-audit",
      "--no-fund",
    ],
    buildOptions,
  );
  await run(node, ["scripts/init-auth.mjs"], buildOptions);
  await buildMigration(release, buildOptions);
  assertRemoteCommit(sha);
  const buildId = readFileSync(join(release, ".next/BUILD_ID"), "utf8").trim();
  if (!buildId) throw new Error("The production build has no build ID");
  saveJSON(join(release, ".portal-build.json"), { ...provenance, buildId });
  chmodSync(join(release, ".portal-build.json"), 0o444);

  const backupDir = join(stateRoot, "backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const Database = createRequire(join(release, "package.json"))(
    "better-sqlite3",
  );
  const { crosschain } = await import(
    pathToFileURL(join(release, "lib/crosschain-config.mjs")).href
  );
  const identity = `${crosschain.chainId}:${crosschain.vault.toLowerCase()}:${crosschain.accountant.toLowerCase()}:${crosschain.startBlock}`;
  const seeded = await seedHistory(Database, identity);
  console.log(
    seeded.unavailable
      ? "No reusable history seed; the migration worker will backfill confirmed blocks."
      : `History ${seeded.seeded ? "seeded" : "retained"}: ${seeded.indexedTo}/${seeded.head}`,
  );
  const database = new Database(runtime.THESAUROS_AUTH_DB, { readonly: true });
  const backupPath = join(backupDir, `${Date.now()}-${sha}.sqlite`);
  try {
    await database.backup(backupPath);
    chmodSync(backupPath, 0o600);
  } finally {
    database.close();
  }
  await run(node, ["scripts/init-auth.mjs"], { cwd: release, env: runtime });

  const next = {
    ...provenance,
    buildId,
    release,
    deployedAt: new Date().toISOString(),
  };
  let candidate;
  try {
    candidate = spawn(
      node,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "18881",
      ],
      { cwd: release, env: runtime, stdio: "inherit" },
    );
    candidate.once("error", (error) => console.error(error.message));
    await waitHealthy(18881, next);
    if (candidate.exitCode !== null || candidate.signalCode !== null)
      throw new Error("The candidate process exited during verification");
  } finally {
    if (candidate && candidate.exitCode === null) {
      candidate.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => candidate.once("exit", resolve)),
        delay(10_000),
      ]);
      if (candidate.exitCode === null) candidate.kill("SIGKILL");
    }
  }
  assertRemoteCommit(sha);
  const oldWorker = historyWorkerSnapshot(pm2List());
  let workerSince;
  await activateMigrationServices(next, previous, oldWorker, {
    applyWeb,
    webHealthy: async (value) => {
      await waitHealthy(18880, value);
      await checkApplication(origin, {
        legacy: !existsSync(join(value.release, "app/app/page.jsx")),
      });
      if (value.branch === branch) await verifyVersion(origin, value.sha);
    },
    startWorker: async (value) => {
      workerSince = Date.now();
      await startHistoryWorker(value);
    },
    workerHealthy: (value) =>
      waitHistoryWorker(value, Database, identity, workerSince),
    restoreWorker: async (snapshot) => {
      await stopHistoryWorker();
      if (!snapshot) return;
      const since = Date.now();
      await startHistoryWorker(snapshot);
      if (snapshot.status === "online")
        await waitHistoryWorker(snapshot, Database, identity, since);
      else await run(node, [pm2, "stop", indexerName]);
    },
    persist: async (value) => {
      await run(node, [pm2, "save"]);
      saveJSON(currentPath, value);
    },
  });
  // Preserve every earlier release and all unrelated files for manual rollback.
  console.log(`Deployment succeeded: ${branch} ${sha} at ${origin}/app/`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  deployMigration(process.argv[2]).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      if (error.cause) console.error(error.cause.message);
      process.exitCode = 1;
    },
  );
}
