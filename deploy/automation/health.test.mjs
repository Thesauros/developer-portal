import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApplication } from "./health.mjs";
const origin = "http://127.0.0.1:18881";
function fixture(legacy, overrides = {}) {
  const prefix = legacy ? "/developers" : "",
    entry = legacy ? prefix + "/customer" : "/app";
  const responses = {
    [entry]: new Response(
      `${legacy ? "Welcome back." : "Sign in with your wallet"}<script src="${prefix}/_next/static/test.js"></script>`,
    ),
    [prefix + "/_next/static/test.js"]: new Response("/* application */"),
    [prefix + "/api/auth/get-session"]: Response.json(null),
    [entry + "/api?mode=individual"]: new Response("", { status: 401 }),
    ...overrides,
  };
  return async (url) =>
    responses[url.slice(origin.length)] || new Response("", { status: 404 });
}
test("checks the wallet interface on native routes", async () => {
  await checkApplication(origin, { fetcher: fixture(false) });
});
test("can verify the previous prefixed email release during rollback", async () => {
  await checkApplication(origin, { legacy: true, fetcher: fixture(true) });
});
test("rejects a missing native route, broken assets and an unprotected ledger", async () => {
  for (const overrides of [
    { "/app": new Response("", { status: 404 }) },
    { "/_next/static/test.js": new Response("", { status: 404 }) },
    { "/app/api?mode=individual": Response.json({}) },
  ])
    await assert.rejects(
      checkApplication(origin, { fetcher: fixture(false, overrides) }),
    );
});
