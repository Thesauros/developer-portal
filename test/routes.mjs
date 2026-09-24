// Exercise the compiled Next server directly: no marketing proxy or rewrites.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { walletStatement } from "../lib/wallet-auth.mjs";
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(join(tmpdir(), "thesauros-native-routes-"));
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_PUBLIC_BASE_PATH: "/developers",
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "isolated-native-route-test-not-production",
  THESAUROS_AUTH_DB: join(directory, "accounts.sqlite"),
};
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;
let server,
  output = "",
  checks = 0;
const cookies = new Map();
function check(value, label) {
  assert.ok(value, label);
  checks++;
}
async function request(path, body) {
  const response = await fetch(origin + path, {
    redirect: "manual",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";")[0],
      index = pair.indexOf("=");
    if (/Max-Age=0(?:;|$)/i.test(line)) cookies.delete(pair.slice(0, index));
    else cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
try {
  execFileSync(process.execPath, ["scripts/init-auth.mjs"], {
    env,
    stdio: "pipe",
  });
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await request("/api/auth/get-session")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  check(ready, "compiled server starts");
  for (const path of [
    "/app",
    "/app/individual",
    "/app/institution",
    "/monitoring",
  ]) {
    const response = await request(path);
    check(
      response.status === 200,
      `${path} exists without a redirect or proxy`,
    );
    const html = await response.text();
    check(
      html.includes(
        path === "/app/institution"
          ? "Sign in to your workspace"
          : "Sign in with your wallet",
      ) && !html.includes("Coming soon."),
      `${path} renders the expected interface`,
    );
    for (const asset of new Set(
      [...html.matchAll(/(?:src|href)="(\/(?:_next|brand)\/[^" ]+)"/g)].map(
        (m) => m[1],
      ),
    )) {
      check(
        (await request(asset.replaceAll("&amp;", "&"))).status === 200,
        `${asset} loads`,
      );
    }
    check(
      !html.includes('href="/customer/'),
      "navigation uses the public account route",
    );
  }
  for (const [from, to] of [
    ["/", "/app"],
    ["/customer/individual", "/app/individual"],
    ["/developers/customer/institution", "/app/institution"],
    ["/developers", "/app/institution"],
  ]) {
    const response = await request(from);
    check(
      [307, 308].includes(response.status) &&
        response.headers.get("location") === to,
      `${from} redirects to ${to}`,
    );
  }
  const old = await request(
    "/developers/customer/individual?next=%2Fapp%2Findividual%23test",
  );
  check(
    new URL(old.headers.get("location"), origin).searchParams.get("next") ===
      "/app/individual#test",
    "legacy redirect retains query parameters",
  );
  for (const path of ["/docs/start/quickstart", "/contact?usecase=launch"]) {
    const response = await request(path),
      location = response.headers.get("location");
    check(
      [307, 308].includes(response.status) && /^https?:\/\//.test(location),
      "separate site link has a public destination",
    );
  }
  check(
    (await request("/app/unknown")).status === 404,
    "unknown account modes return 404",
  );
  check(
    (await request("/app/api?mode=individual")).status === 401,
    "native ledger requires authentication",
  );
  check(
    (await request("/app/live?kind=protocol")).status === 401,
    "native live data requires authentication",
  );
  const account = privateKeyToAccount(generatePrivateKey());
  const nonceResponse = await request("/api/auth/siwe/nonce", {});
  check(nonceResponse.status === 200, "native nonce endpoint works");
  const { nonce } = await nonceResponse.json(),
    issuedAt = new Date();
  const message = createSiweMessage({
    address: account.address,
    domain: new URL(origin).host,
    uri: origin,
    chainId: 42161,
    nonce,
    version: "1",
    statement: walletStatement,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 300000),
  });
  const signed = await request("/api/auth/siwe/verify", {
    message,
    signature: await account.signMessage({ message }),
  });
  check(
    signed.status === 200,
    "signed wallet message creates a session over native HTTP routes",
  );
  const payload = await signed.json();
  check(!payload.token, "session token stays out of the JSON response");
  check(
    (await request("/app/api?mode=individual")).status === 200,
    "authenticated native ledger works",
  );
  check(
    (await request("/app/api?mode=institution")).status === 403,
    "choosing the Institution view does not grant legacy company ledger access",
  );
  const institution = await request("/app/institution");
  const institutionHtml = await institution.text();
  check(
    institution.status === 200,
    "wallet session can visit Institution sign-in",
  );
  check(
    institutionHtml.includes("Sign in to your workspace") &&
      institutionHtml.includes('type="password"'),
    "a wallet session does not bypass Institution account sign-in",
  );
  const logout = await request("/api/auth/sign-out", {});
  check(logout.status === 200, "native logout works");
  check(
    (await request("/app/api?mode=individual")).status === 401,
    "logout closes the native workspace session",
  );
  console.log(
    `Native routes: ${checks} HTTP checks passed against the compiled Next server.`,
  );
} catch (error) {
  console.error(output.slice(-3000));
  throw error;
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  rmSync(directory, { recursive: true, force: true });
}
