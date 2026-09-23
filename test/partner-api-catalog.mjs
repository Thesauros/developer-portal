import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  PARTNER_API_CATALOG,
  PARTNER_API_GROUPS,
  buildPartnerRequest,
  filterPartnerEndpoints,
} from "../lib/partner-api-catalog.mjs";

const operation = (method, path) =>
  PARTNER_API_CATALOG.find(
    (entry) => entry.method === method && entry.path === path,
  );

test("catalog separates customer operations, protocol reads and administration", () => {
  assert.equal(PARTNER_API_CATALOG.length, 41);
  assert.equal(new Set(PARTNER_API_CATALOG.map((entry) => entry.id)).size, 41);
  for (const entry of PARTNER_API_CATALOG) {
    assert.ok(PARTNER_API_GROUPS.includes(entry.group));
    assert.match(entry.source, /^src\/.+\.controller\.ts$/);
    assert.ok(!entry.path.includes("/points"));
    assert.ok(!entry.path.includes("/partner/yield/history/"));
    assert.ok(!entry.path.includes("/positions") || entry.method === "GET");
  }
  assert.equal(operation("POST", "/api/v1/users").requiresPartner, true);
  assert.equal(operation("POST", "/api/v1/users").access, "Partner");
  assert.equal(operation("POST", "/api/v1/keys").access, "Administrative");
  assert.equal(operation("GET", "/api/v1/vaults").access, "Protocol");
  assert.equal(operation("GET", "/api/v1/status").access, "Public");
});

test("handler checks supplement Swagger scopes and DTO required metadata", () => {
  for (const path of [
    "/analytics/uplift",
    "/analytics/decisions",
    "/analytics/advisor",
    "/reconciliation/balances",
    "/reconciliation/ledger",
    "/reconciliation/snapshots",
  ]) {
    const entry = operation("GET", "/api/v1" + path);
    assert.deepEqual(entry.scopes, ["read", "partner:read"]);
    assert.equal(entry.requiresPartner, true);
  }
  const history = operation("GET", "/api/v1/apy/history");
  assert.equal(
    history.inputs.find((input) => input.name === "vault").required,
    true,
  );
  assert.match(buildPartnerRequest(history), /\?vault=vault_example/);
  for (const path of [
    "/api/v1/analytics/uplift",
    "/api/v1/reconciliation/balances",
  ]) {
    assert.equal(
      operation("GET", path).inputs.some(
        (input) => input.name === "position_id",
      ),
      false,
    );
  }
});

test("every copyable request is valid shell syntax with no live secrets or legacy proxy", () => {
  for (const entry of PARTNER_API_CATALOG) {
    const request = buildPartnerRequest(entry);
    const parsed = spawnSync("bash", ["-n"], {
      input: request,
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, entry.id + ": " + parsed.stderr);
    assert.match(
      request,
      /\$\{PARTNER_API_ORIGIN:\?Set your Partner API origin\}/,
    );
    assert.doesNotMatch(
      request,
      /tsk_(test|live)_|\/api\/v1\/real|80\.241|localhost/,
    );
    assert.doesNotMatch(request, /\{id\}|\{asset\}|\{campaignId\}/);
    if (entry.access === "Public")
      assert.doesNotMatch(request, /Authorization/);
    else if (entry.access === "Administrative")
      assert.match(request, /\$\{ADMIN_API_KEY:/);
    else assert.match(request, /\$\{PARTNER_API_KEY:/);
  }
});

test("copy formatter uses catalog values and rejects unknown operations", () => {
  const status = operation("GET", "/api/v1/status");
  assert.equal(
    buildPartnerRequest({ ...status, path: "https://invalid.example" }),
    buildPartnerRequest(status),
  );
  assert.throws(
    () => buildPartnerRequest({ id: "unknown" }),
    /Unknown Partner API operation/,
  );
});

test("search composes text, method, access and capability filters", () => {
  assert.equal(filterPartnerEndpoints().length, 41);
  assert.equal(
    filterPartnerEndpoints({ query: "  VAULT required  " }).some(
      (entry) => entry.path === "/api/v1/apy/history",
    ),
    true,
  );
  const reads = filterPartnerEndpoints({ group: "Webhooks", method: "GET" });
  assert.equal(reads.length, 3);
  assert.ok(
    reads.every(
      (entry) => entry.group === "Webhooks" && entry.method === "GET",
    ),
  );
  assert.equal(filterPartnerEndpoints({ access: "Public" }).length, 1);
  assert.equal(
    filterPartnerEndpoints({ query: "no such capability" }).length,
    0,
  );
  assert.equal(
    filterPartnerEndpoints({ group: "Customers", access: "Administrative" })
      .length,
    0,
  );
});
