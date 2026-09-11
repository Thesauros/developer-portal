import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import {
  deploymentClaims,
  verifyDeploymentToken,
  audience,
  issuer,
} from "./oidc.mjs";

const claims = {
  repository: "Thesauros/developer-portal",
  repository_id: "1330248577",
  repository_owner_id: "222436395",
  ref: "refs/heads/v2",
  ref_type: "branch",
  sub: "repo:Thesauros@222436395/developer-portal@1330248577:ref:refs/heads/v2",
  workflow_ref:
    "Thesauros/developer-portal/.github/workflows/web.yml@refs/heads/v2",
  sha: "a".repeat(40),
  workflow_sha: "a".repeat(40),
  event_name: "push",
  runner_environment: "github-hosted",
  run_id: "123456",
  run_attempt: "1",
};
const { privateKey, publicKey } = await generateKeyPair("RS256");
async function token(overrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    ...claims,
    iss: issuer,
    aud: audience,
    iat: now,
    nbf: now,
    exp: now + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(signingKey);
}

test("accepts a signed v2 deployment, including GitHub immutable subjects", async () => {
  assert.deepEqual(await verifyDeploymentToken(await token(), publicKey), {
    id: "123456-1",
    sha: "a".repeat(40),
  });
  assert.doesNotThrow(() =>
    deploymentClaims({
      ...claims,
      event_name: "workflow_dispatch",
      sub: "repo:Thesauros/developer-portal:ref:refs/heads/v2",
    }),
  );
});
test("rejects wrong signatures, expired tokens and wrong issuer or audience", async () => {
  const other = await generateKeyPair("RS256");
  await assert.rejects(
    verifyDeploymentToken(await token({}, other.privateKey), publicKey),
  );
  for (const overrides of [
    { exp: 1 },
    { nbf: Math.floor(Date.now() / 1000) + 300 },
    { iss: "https://example.invalid" },
    { aud: "other-server" },
  ]) {
    await assert.rejects(
      verifyDeploymentToken(await token(overrides), publicKey),
    );
  }
});
test("rejects forks, renamed repositories, other branches, PRs and other workflows", async () => {
  for (const overrides of [
    { repository: "someone/developer-portal" },
    { repository_id: "2" },
    { repository_owner_id: "3" },
    { ref: "refs/heads/master" },
    { ref_type: "tag" },
    { event_name: "pull_request" },
    { event_name: "pull_request_target" },
    { event_name: "dynamic" },
    {
      workflow_ref:
        "Thesauros/developer-portal/.github/workflows/security.yml@refs/heads/v2",
    },
    { workflow_sha: "b".repeat(40) },
    { runner_environment: "self-hosted" },
    { sub: "repo:Thesauros/developer-portal:pull_request" },
    { sha: "; touch /tmp/unwanted" },
    { run_id: "../escape" },
    { run_attempt: "../escape" },
  ])
    await assert.rejects(
      verifyDeploymentToken(await token(overrides), publicKey),
    );
});
