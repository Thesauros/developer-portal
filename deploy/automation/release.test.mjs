import { test } from "node:test";
import assert from "node:assert/strict";
import { activateRelease, processConfig } from "./release.mjs";

test("activation only persists a healthy release", async () => {
  const events = [];
  await activateRelease("next", "previous", {
    apply: async (value) => events.push("apply " + value),
    healthy: async (value) => events.push("health " + value),
    persist: async (value) => events.push("persist " + value),
  });
  assert.deepEqual(events, ["apply next", "health next", "persist next"]);
});
test("failed startup restores and verifies the previous release", async () => {
  const events = [];
  await assert.rejects(
    activateRelease("broken", "previous", {
      apply: async (value) => events.push("apply " + value),
      healthy: async (value) => {
        events.push("health " + value);
        if (value === "broken") throw new Error("HTTP 500");
      },
      persist: async (value) => events.push("persist " + value),
    }),
    /previous application release restored/,
  );
  assert.deepEqual(events, [
    "apply broken",
    "health broken",
    "apply previous",
    "health previous",
    "persist previous",
  ]);
});
test("failed rollback is reported instead of claiming success", async () => {
  await assert.rejects(
    activateRelease("broken", "previous", {
      apply: async () => {},
      healthy: async () => {
        throw new Error("unavailable");
      },
      persist: async () => {},
    }),
    /operator intervention/,
  );
});
test("PM2 switches both source and dependencies without touching the points service", () => {
  const config = processConfig("/var/lib/thesauros-portal-v2/releases/example");
  assert.equal(config.apps.length, 1);
  assert.equal(config.apps[0].name, "developer-portal-v2");
  assert.equal(
    config.apps[0].cwd,
    "/var/lib/thesauros-portal-v2/releases/example",
  );
  assert.equal(
    config.apps[0].script,
    "/var/lib/thesauros-portal-v2/releases/example/node_modules/next/dist/bin/next",
  );
  assert.match(config.apps[0].args, /127\.0\.0\.1 --port 18880/);
});

// Exercise the HTTP transport without OIDC network access or a real deployment.
const { createDeploymentServer, deploymentCommand } =
  await import("./server.mjs");
const { mkdtempSync, rmSync, writeFileSync, readFileSync } =
  await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { EventEmitter } = await import("node:events");
const identity = { id: "123-1", sha: "a".repeat(40), branch: "migration" };
async function transport(t, options = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "portal-transport-"));
  options.prepare?.(stateDir);
  const children = [],
    commands = [];
  const server = createDeploymentServer({
    stateDir,
    verifyToken: async (token) => {
      if (token === "denied") throw new Error("Rejected");
      return {
        ...identity,
        ...(token === "other"
          ? { sha: "b".repeat(40) }
          : token === "next"
            ? { id: "124-1" }
            : {}),
      };
    },
    spawnProcess: (...args) => {
      commands.push(args);
      if (options.spawnError) throw new Error("Spawn failed");
      const child = new EventEmitter();
      children.push(child);
      return child;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(stateDir, { recursive: true, force: true });
  });
  const request = (method = "POST", token = "valid") =>
    fetch(`http://127.0.0.1:${server.address().port}/__deploy/v2`, {
      method,
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
  return { request, children, commands, stateDir };
}

test("OIDC transport launches the migration runner without an outer flock", async (t) => {
  const { request, children, commands } = await transport(t);
  const first = await request();
  assert.equal(first.status, 202);
  assert.equal((await first.json()).branch, "migration");
  assert.equal((await request()).status, 200);
  assert.equal((await request("GET")).status, 200);
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], "/usr/bin/timeout");
  assert.ok(
    commands[0][1].some((value) => value.endsWith("/release-migration.mjs")),
  );
  assert.ok(!commands[0][1].some((value) => /flock|release\.mjs$/.test(value)));
  children[0].emit("exit", 0);
  assert.equal((await (await request("GET")).json()).status, "succeeded");
  assert.equal((await request()).status, 200);
  assert.equal(commands.length, 1);
  assert.throws(() => deploymentCommand("HEAD"));
});
test("transport rejects unauthenticated requests, mismatched replays and parallel runs", async (t) => {
  const { request, commands, children } = await transport(t);
  assert.equal((await request("POST", "")).status, 401);
  assert.equal((await request("POST", "denied")).status, 403);
  assert.equal((await request("GET")).status, 404);
  assert.equal(commands.length, 0);
  await request();
  assert.equal((await request("POST", "other")).status, 403);
  assert.equal((await request("POST", "next")).status, 409);
  children[0].emit("exit", 1);
  assert.equal((await (await request("GET")).json()).status, "failed");
  assert.equal(commands.length, 1);
});
test("service restart and spawn failures cannot report success or replay a run", async (t) => {
  const restarted = await transport(t, {
    prepare: (dir) =>
      writeFileSync(
        join(dir, "123-1.json"),
        JSON.stringify({ ...identity, status: "running" }),
      ),
  });
  assert.equal((await (await restarted.request()).json()).status, "failed");
  assert.equal(restarted.commands.length, 0);
  const broken = await transport(t, { spawnError: true });
  assert.equal((await broken.request()).status, 500);
  assert.equal(
    JSON.parse(readFileSync(join(broken.stateDir, "123-1.json"))).status,
    "failed",
  );
  assert.equal((await (await broken.request()).json()).status, "failed");
  assert.equal(broken.commands.length, 1);
});
