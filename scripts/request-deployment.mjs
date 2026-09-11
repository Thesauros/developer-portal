import { setTimeout as delay } from "node:timers/promises";
import { appendFileSync } from "node:fs";

const endpoint = "https://app-v2-dev.thesauros.io/__deploy/v2";
const deadline = Date.now() + 22 * 60_000;

async function request(method) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:") throw new Error("GitHub OIDC requires HTTPS");
  url.searchParams.set("audience", endpoint);
  const tokenResponse = await fetch(url, {
    headers: {
      Authorization: "Bearer " + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!tokenResponse.ok)
    throw new Error("GitHub OIDC request failed: HTTP " + tokenResponse.status);
  const { value: token } = await tokenResponse.json();
  if (!token) throw new Error("GitHub did not return an OIDC token");
  console.log("::add-mask::" + token);
  const response = await fetch(endpoint, {
    method,
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (response.status === 409) return { status: "busy" };
  if (!response.ok)
    throw new Error("Deployment request failed: HTTP " + response.status);
  if (result.sha !== process.env.GITHUB_SHA)
    throw new Error("Deployment commit does not match this workflow");
  return result;
}

let accepted = false;
let previousStatus;
while (Date.now() < deadline) {
  const result = await request(accepted ? "GET" : "POST");
  accepted ||= result.status !== "busy";
  if (result.status !== previousStatus)
    console.log("Deployment: " + result.status);
  previousStatus = result.status;
  if (["succeeded", "skipped"].includes(result.status)) {
    const summary =
      result.status === "succeeded"
        ? `Deployed ${result.sha} to https://app-v2-dev.thesauros.io/app/`
        : `Skipped ${result.sha}: a newer commit is already on v2.`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    process.exit(0);
  }
  if (result.status === "failed")
    throw new Error(
      "Server deployment failed; inspect the deployment service logs. The previous release is retained.",
    );
  await delay(5000);
}
throw new Error("Timed out waiting for the server deployment");
