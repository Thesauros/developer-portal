import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyDeploymentToken } from "./oidc.mjs";

const stateDir = "/var/lib/thesauros-portal-v2/deployments";
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
function save(state) {
  const path = `${stateDir}/${state.id}.json`;
  writeFileSync(path + ".tmp", JSON.stringify(state), { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
function read(id) {
  try {
    return JSON.parse(readFileSync(`${stateDir}/${id}.json`, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
for (const file of readdirSync(stateDir).filter((name) =>
  /^[0-9]+-[0-9]+\.json$/.test(name),
)) {
  const state = read(file.slice(0, -5));
  if (state.status === "running")
    save({ ...state, status: "failed", finishedAt: new Date().toISOString() });
}
let running = false;
function reply(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const server = createServer(
  { maxHeaderSize: 16_384 },
  async (request, response) => {
    if (request.url === "/health" && request.method === "GET")
      return reply(response, 200, { ready: true });
    if (request.url !== "/__deploy/v2")
      return reply(response, 404, { error: "Not found" });
    if (!["GET", "POST"].includes(request.method))
      return reply(response, 405, { error: "Method not allowed" });
    const header = request.headers.authorization || "";
    if (!header.startsWith("Bearer ") || header.length > 12_000)
      return reply(response, 401, { error: "GitHub OIDC token required" });
    let deployment;
    try {
      deployment = await verifyDeploymentToken(header.slice(7));
    } catch {
      return reply(response, 403, { error: "Workflow authorization failed" });
    }
    request.resume();
    try {
      const existing = read(deployment.id);
      if (existing) {
        if (existing.sha !== deployment.sha)
          return reply(response, 403, { error: "Commit mismatch" });
        return reply(response, 200, existing);
      }
      if (request.method === "GET")
        return reply(response, 404, { error: "Deployment not found" });
      if (running) return reply(response, 409, { status: "busy" });
      running = true;
      const state = {
        ...deployment,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      save(state);
      const log = openSync(`${stateDir}/${deployment.id}.log`, "a", 0o600);
      const child = spawn(
        "/usr/bin/timeout",
        [
          "--kill-after=30s",
          "20m",
          "/usr/bin/flock",
          "-n",
          "/var/lib/thesauros-portal-v2/deploy.lock",
          process.execPath,
          fileURLToPath(new URL("./release.mjs", import.meta.url)),
          deployment.sha,
        ],
        { stdio: ["ignore", log, log] },
      );
      closeSync(log);
      const finish = (code) => {
        save({
          ...state,
          status: code === 0 ? "succeeded" : code === 3 ? "skipped" : "failed",
          finishedAt: new Date().toISOString(),
        });
        running = false;
        console.log(
          `Deployment ${deployment.id} (${deployment.sha}) finished with code ${code}`,
        );
      };
      child.once("error", () => finish(1));
      child.once("exit", finish);
      reply(response, 202, state);
    } catch (error) {
      running = false;
      console.error(error.message);
      reply(response, 500, { error: "Deployment service error" });
    }
  },
);
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.maxConnections = 32;
server.listen(18882, "127.0.0.1", () =>
  console.log("Portal deployment service listening on 127.0.0.1:18882"),
);
