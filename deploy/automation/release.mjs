// Shared PM2 configuration and rollback; all deployment entry points use the
// same migration runner, which owns branch verification and the host lock.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const node = "/opt/node-v24.21.0-linux-x64/bin/node";
const processName = "developer-portal-v2";
const toolEnv = {
  PATH: "/opt/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin",
};

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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { deployMigration } = await import("./release-migration.mjs");
  deployMigration(process.argv[2]).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
