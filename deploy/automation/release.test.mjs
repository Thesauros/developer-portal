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
