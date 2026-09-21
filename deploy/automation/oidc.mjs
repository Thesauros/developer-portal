import { createRemoteJWKSet, jwtVerify } from "jose";

export const audience = "https://app-v2-dev.thesauros.io/__deploy/v2";
export const issuer = "https://token.actions.githubusercontent.com";
const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"), {
  timeoutDuration: 10_000,
});
const repository = "Thesauros/developer-portal";
const repositoryId = "1330248577";
const ownerId = "222436395";
const ref = "refs/heads/v2";

export function deploymentClaims(payload) {
  const subjects = [
    `repo:${repository}:ref:${ref}`,
    `repo:Thesauros@${ownerId}/developer-portal@${repositoryId}:ref:${ref}`,
  ];
  if (
    payload.repository !== repository ||
    payload.repository_id !== repositoryId ||
    payload.repository_owner_id !== ownerId ||
    payload.ref !== ref ||
    payload.ref_type !== "branch" ||
    !subjects.includes(payload.sub) ||
    payload.workflow_ref !== `${repository}/.github/workflows/web.yml@${ref}` ||
    payload.workflow_sha !== payload.sha ||
    payload.runner_environment !== "github-hosted" ||
    !["push", "workflow_dispatch"].includes(payload.event_name) ||
    !/^[a-f0-9]{40}$/.test(payload.sha || "") ||
    !/^[0-9]{1,20}$/.test(payload.run_id || "") ||
    !/^[0-9]{1,8}$/.test(payload.run_attempt || "")
  ) {
    throw new Error("This workflow is not authorized to deploy");
  }
  return { id: payload.run_id + "-" + payload.run_attempt, sha: payload.sha };
}

export async function verifyDeploymentToken(token, keySet = keys) {
  const { payload } = await jwtVerify(token, keySet, {
    issuer,
    audience,
    algorithms: ["RS256"],
    clockTolerance: 5,
    maxTokenAge: "10m",
    requiredClaims: ["exp", "iat", "nbf", "sub"],
  });
  return deploymentClaims(payload);
}
