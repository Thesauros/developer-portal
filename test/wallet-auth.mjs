import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
const directory = mkdtempSync(join(tmpdir(), "thesauros-wallet-test-"));
const origin = "http://localhost:8879";
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_SECRET = "isolated-test-secret-only-not-for-deployment";
process.env.NEXT_PUBLIC_BASE_PATH = "/developers";
process.env.THESAUROS_AUTH_DB = join(directory, "accounts.sqlite");
if (process.argv.includes("--libsql"))
  process.env.TURSO_DATABASE_URL = "file:" + join(directory, "accounts.sqlite");
else delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
// No network dependency for invalid-signature checks. EOA success is verified
// cryptographically; contract-wallet fallback must fail closed here.
globalThis.fetch = async () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }), {
    headers: { "Content-Type": "application/json" },
  });
await import("../scripts/init-auth.mjs");
const route = await import("../app/api/auth/[...all]/route.js");
const ledger = await import("../app/customer/api/route.js");
const { auth, database, userSession } = await import("../lib/auth.mjs");
const { walletStatement } = await import("../lib/wallet-auth.mjs");
let checks = 0;
function check(value, label) {
  assert.ok(value, label);
  checks++;
}
let browserCount = 10;
function browser() {
  return { cookies: new Map(), ip: "192.0.2." + browserCount++ };
}
function cookieHeader(browser) {
  return [...browser.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
}
function updateCookies(browser, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";"),
      index = pair.indexOf("="),
      name = pair.slice(0, index),
      value = pair.slice(index + 1);
    if (/Max-Age=0(?:;|$)/i.test(line)) browser.cookies.delete(name);
    else browser.cookies.set(name, value);
  }
}
async function post(browser, path, body = {}, options = {}) {
  const request = new Request(origin + "/developers/api/auth/" + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin || origin,
      "x-real-ip": browser.ip,
      "x-forwarded-for": browser.ip,
      cookie: cookieHeader(browser),
    },
    body: JSON.stringify(body),
  });
  const response = await route.POST(request);
  updateCookies(browser, response);
  return response;
}
async function challenge(browser, account, changes = {}) {
  const result = await post(browser, "siwe/nonce");
  check(result.ok, "nonce created");
  const { nonce } = await result.json(),
    issuedAt = new Date();
  const message = createSiweMessage({
    address: account.address,
    domain: new URL(origin).host,
    uri: origin,
    version: "1",
    statement: walletStatement,
    chainId: 42161,
    nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 300_000),
    ...changes,
  });
  return { message, signature: await account.signMessage({ message }) };
}
async function api(browser, mode = "individual", body) {
  const request = new Request(
    origin + "/developers/customer/api?mode=" + mode,
    {
      headers: {
        origin,
        cookie: cookieHeader(browser),
        "content-type": "application/json",
      },
      ...(body
        ? { method: "POST", body: JSON.stringify({ mode, ...body }) }
        : {}),
    },
  );
  return body ? ledger.POST(request) : ledger.GET(request);
}
try {
  const account = privateKeyToAccount(generatePrivateKey()),
    second = privateKeyToAccount(generatePrivateKey());
  const a = browser(),
    b = browser();
  check((await api(a)).status === 401, "ledger rejects unsigned address");
  check(
    (await post(a, "sign-up/email", { accountType: "institution" })).status ===
      410,
    "email signup closed",
  );
  check(
    (await post(a, "sign-in/email")).status === 410,
    "email sign-in closed",
  );
  check(
    (await post(a, "siwe/nonce", {}, { origin: "https://foreign.invalid" }))
      .status === 403,
    "foreign origin rejected",
  );
  let payload = await challenge(a, account);
  check(
    (await post(b, "siwe/verify", payload)).status === 401,
    "challenge bound to browser",
  );
  const savedChallenge = a.cookies.get("thesauros.wallet-challenge");
  const verified = await post(a, "siwe/verify", payload);
  check(verified.ok, "wallet sign-in accepted");
  const data = await verified.json();
  check(!("token" in data), "session token not exposed to client JS");
  check(
    verified.headers
      .getSetCookie()
      .some((v) => v.includes("session_token") && /httponly/i.test(v)),
    "HttpOnly session issued",
  );
  check(
    (await userSession(new Headers({ cookie: cookieHeader(a) })))?.user
      .walletAddress === account.address,
    "session owns verified wallet",
  );
  a.cookies.set("thesauros.wallet-challenge", savedChallenge);
  check(
    (await post(a, "siwe/verify", payload)).status === 401,
    "signature cannot be replayed",
  );
  check(
    (await api(a, "institution")).status === 403,
    "Institution ledger closed to wallet account",
  );
  const fresh = await (await api(a)).json();
  check(!fresh.funded, "wallet starts without test funds");
  check(
    (await api(a, "individual", { type: "fund" })).ok,
    "test balance can be funded",
  );
  payload = await challenge(b, second);
  check((await post(b, "siwe/verify", payload)).ok, "second wallet signs in");
  check(!(await (await api(b)).json()).funded, "wallet balances isolated");
  const again = browser();
  payload = await challenge(again, account, { chainId: 8453 });
  check(
    (await post(again, "siwe/verify", payload)).ok,
    "same wallet accepted on another supported chain",
  );
  check(
    (await (await api(again)).json()).funded,
    "wallet identity persists across chain and session",
  );
  for (const [label, changes] of [
    ["wrong domain", { domain: "foreign.invalid" }],
    ["wrong URI", { uri: "https://foreign.invalid" }],
    ["wrong statement", { statement: "Authorize spending" }],
    ["unsupported chain", { chainId: 137 }],
    [
      "expired message",
      {
        issuedAt: new Date(Date.now() - 600_000),
        expirationTime: new Date(Date.now() - 300_000),
      },
    ],
  ]) {
    const c = browser();
    const bad = await challenge(c, account, changes);
    check(
      (await post(c, "siwe/verify", bad)).status === 401,
      label + " rejected",
    );
  }
  const c = browser();
  const bad = await challenge(c, account);
  bad.signature = await second.signMessage({ message: bad.message });
  check(
    (await post(c, "siwe/verify", bad)).status === 401,
    "another wallet cannot impersonate account",
  );
  check((await post(a, "sign-out")).ok, "logout succeeds");
  check((await api(a)).status === 401, "logout revokes access");
  console.log(
    `Wallet authentication: ${checks} checks passed (${process.argv.includes("--libsql") ? "libSQL" : "SQLite"}).`,
  );
} finally {
  if (process.env.TURSO_DATABASE_URL) database.close();
  else database.close();
  rmSync(directory, { recursive: true, force: true });
}
