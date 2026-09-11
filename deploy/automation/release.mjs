import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  symlinkSync,
  existsSync,
  readdirSync,
  lstatSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const stateRoot = "/var/lib/thesauros-portal-v2";
const checkout = "/root/developer-portal-v2";
const releases = join(stateRoot, "releases");
const node = "/opt/node-v24.21.0-linux-x64/bin/node";
const npm = "/opt/node-v24.21.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js";
const pm2 = "/usr/local/lib/node_modules/pm2/bin/pm2";
const processName = "developer-portal-v2";
const origin = "https://app-v2-dev.thesauros.io";
const toolEnv = {
  ...process.env,
  PATH: "/opt/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin",
  GIT_TERMINAL_PROMPT: "0",
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: toolEnv,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
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

export function processConfig(release) {
  return {
    apps: [
      {
        name: processName,
        cwd: release,
        script: join(release, "node_modules/next/dist/bin/next"),
        args: "start --hostname 127.0.0.1 --port 18880",
        interpreter: node,
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        min_uptime: "10s",
        max_restarts: 10,
        restart_delay: 3000,
        kill_timeout: 10000,
        time: true,
        env: {
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          PATH: toolEnv.PATH,
        },
      },
    ],
  };
}

export async function activateRelease(next, previous, operations) {
  try {
    await operations.apply(next);
    await operations.healthy(next);
    await operations.persist(next);
  } catch (cause) {
    console.error(
      "Activation failed; restoring the previous application release.",
    );
    try {
      await operations.apply(previous);
      await operations.healthy(previous);
      await operations.persist(previous);
    } catch (rollback) {
      throw new AggregateError(
        [cause, rollback],
        "Activation and rollback failed; operator intervention is required",
      );
    }
    throw new Error(
      "Activation failed; previous application release restored",
      { cause },
    );
  }
}

async function health(port) {
  const local = `http://127.0.0.1:${port}`;
  const options = () => ({
    headers: { Host: "app-v2-dev.thesauros.io", "X-Forwarded-Proto": "https" },
    signal: AbortSignal.timeout(5000),
  });
  const page = await fetch(local + "/developers/customer", options());
  if (page.status !== 200) throw new Error("Sign-in page is not healthy");
  const html = await page.text();
  if (!html.includes("Welcome back."))
    throw new Error("Sign-in page content is missing");
  const asset = html.match(/src="(\/developers\/_next\/static\/[^" ]+\.js)"/);
  if (!asset || !(await fetch(local + asset[1], options())).ok)
    throw new Error("Application assets are not healthy");
  const session = await fetch(
    local + "/developers/api/auth/get-session",
    options(),
  );
  if (session.status !== 200 || (await session.json()) !== null)
    throw new Error("Session endpoint is not healthy");
  const workspace = await fetch(
    local + "/developers/customer/api?mode=individual",
    options(),
  );
  if (workspace.status !== 401)
    throw new Error("Workspace authentication check failed");
}

async function waitHealthy(port) {
  let last;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await health(port);
      return;
    } catch (error) {
      last = error;
      await delay(1000);
    }
  }
  throw last;
}

async function apply(release) {
  const path = join(stateRoot, "pm2-current.json");
  saveJSON(path, processConfig(release.release));
  const before = JSON.parse(
    execFileSync(node, [pm2, "jlist"], { env: toolEnv, encoding: "utf8" }),
  );
  // PM2 reload merges environment settings but retains resolved cwd/script paths.
  // Recreate this single process to switch both source and dependencies.
  if (before.some((app) => app.name === processName))
    await run(node, [pm2, "delete", processName]);
  await run(node, [pm2, "start", path, "--only", processName]);
  const list = JSON.parse(
    execFileSync(node, [pm2, "jlist"], { env: toolEnv, encoding: "utf8" }),
  );
  if (
    list.find((app) => app.name === processName)?.pm2_env.pm_cwd !==
    release.release
  ) {
    throw new Error("PM2 did not switch to the requested release");
  }
}

function prune(current, previous) {
  const managed = readdirSync(releases)
    .filter((name) => /^[a-f0-9]{40}-[A-Za-z0-9]{6}$/.test(name))
    .map((name) => join(releases, name))
    .filter(
      (path) =>
        !lstatSync(path).isSymbolicLink() &&
        existsSync(join(path, ".portal-release.json")),
    )
    .sort((a, b) => lstatSync(b).mtimeMs - lstatSync(a).mtimeMs);
  const keep = new Set([current, previous, ...managed.slice(0, 5)]);
  for (const path of managed) {
    if (!keep.has(path)) rmSync(path, { recursive: true });
  }
}

async function deploy(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw new Error("A full commit SHA is required");
  mkdirSync(releases, { recursive: true, mode: 0o700 });
  const currentPath = join(stateRoot, "current.json");
  const previous = JSON.parse(readFileSync(currentPath, "utf8"));
  await run("git", ["-C", checkout, "fetch", "--quiet", "origin", "v2"]);
  if (git(["rev-parse", "FETCH_HEAD"]) !== sha) {
    console.log("A newer commit exists on v2; skipping.");
    return 3;
  }
  if (previous.sha === sha && previous.release !== checkout) {
    await waitHealthy(18880);
    console.log("This commit is already healthy.");
    return 0;
  }
  const runtime = {
    ...toolEnv,
    ...parseEnv(readFileSync(join(stateRoot, "runtime.env"), "utf8")),
    NODE_OPTIONS: "--max-old-space-size=3072",
  };
  if (
    runtime.BETTER_AUTH_URL !== origin ||
    runtime.THESAUROS_AUTH_DB !== join(stateRoot, "accounts.sqlite")
  ) {
    throw new Error("Unexpected production environment");
  }
  const release = mkdtempSync(join(releases, sha + "-"));
  saveJSON(join(release, ".portal-release.json"), {
    sha,
    createdAt: new Date().toISOString(),
  });
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
  rmSync(archive);
  symlinkSync(join(stateRoot, "runtime.env"), join(release, ".env.local"));
  if (!existsSync(join(releases, "private-state")))
    symlinkSync("/root/private-state", join(releases, "private-state"));
  console.log("Installing and building commit " + sha);
  const buildEnv = {
    ...runtime,
    THESAUROS_AUTH_DB: join(release, ".build-auth.sqlite"),
  };
  const buildOptions = { cwd: release, env: buildEnv };
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
  await run(
    "/usr/bin/timeout",
    ["--kill-after=15s", "15m", node, npm, "run", "build"],
    buildOptions,
  );
  if (git(["ls-remote", "origin", "refs/heads/v2"]).split(/\s/)[0] !== sha) {
    console.log(
      "A newer commit arrived during the build; skipping activation.",
    );
    return 3;
  }

  const backupDir = join(stateRoot, "backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const Database = createRequire(join(release, "package.json"))(
    "better-sqlite3",
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
    await waitHealthy(18881);
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
  const next = { sha, release, deployedAt: new Date().toISOString() };
  await activateRelease(next, previous, {
    apply,
    healthy: () => waitHealthy(18880),
    persist: async (value) => {
      await run(node, [pm2, "save"]);
      saveJSON(currentPath, value);
    },
  });
  prune(release, previous.release);
  console.log("Deployment succeeded: " + sha);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  deploy(process.argv[2])
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      if (error.cause) console.error(error.cause.message);
      process.exitCode = 1;
    });
}
