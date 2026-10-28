// Isolated local stand. Generates its own private settings once; never prints secrets.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dirname, "..");
const settings = resolve(root, ".env.crosschain.local");
const state = resolve(root, "private-state/crosschain");
mkdirSync(state, { recursive: true, mode: 0o700 });
if (!existsSync(settings)) {
  writeFileSync(
    settings,
    [
      "# Private local cross-chain stand settings. Never commit this file.",
      `BETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}`,
      "BETTER_AUTH_URL=http://127.0.0.1:18890",
      `THESAUROS_AUTH_DB=${resolve(state, "accounts.sqlite")}`,
      "THESAUROS_NEXT_DIST=.next-crosschain",
      "NEXT_PUBLIC_API_BASE=/api/v1",
      "NEXT_PUBLIC_DATA_SOURCE=sandbox",
      "NEXT_TELEMETRY_DISABLED=1",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
}
const env = { ...process.env, ...parseEnv(readFileSync(settings, "utf8")) };
// A local stand always uses its own SQLite, regardless of the caller's cloud env.
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;
delete env.VERCEL;
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(["scripts/init-auth.mjs"]);
if (process.argv.includes("--init-only")) process.exit(0);
if (
  process.argv.includes("--build") ||
  !existsSync(resolve(root, env.THESAUROS_NEXT_DIST, "BUILD_ID"))
)
  run(["node_modules/next/dist/bin/next", "build"]);
const origin = new URL(env.BETTER_AUTH_URL);
if (!["127.0.0.1", "localhost"].includes(origin.hostname))
  throw new Error(
    "Local launcher binds loopback only. Use the container configuration for the remote server.",
  );
console.log(`Cross-chain stand: ${origin.origin}/app/individual#crosschain`);
console.log(`Account database: ${env.THESAUROS_AUTH_DB}`);
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    origin.port || "18890",
  ],
  { cwd: root, env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code || 0));
