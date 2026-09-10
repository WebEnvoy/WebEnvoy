import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const corePort = await reservePort();
const harborPort = await reservePort();
const directory = await mkdtemp(path.join(tmpdir(), "webenvoy-packaged-recovery-entry-"));
const supervisorToken = "packaged-recovery-entry-supervisor-token-00000000";
const coreEndpoint = `http://127.0.0.1:${corePort}`;
const harborEndpoint = `http://127.0.0.1:${harborPort}`;
let inspectCalls = 0;
let inspectBody;
const harbor = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/runtime/profile-recovery/inspect") {
    inspectCalls += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    inspectBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ failure: { code: "profile_not_found", recovery_hint: "select_existing_profile" } }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "fixture_route_not_found" }));
});
await new Promise((resolve, reject) => {
  harbor.once("error", reject);
  harbor.listen(harborPort, "127.0.0.1", resolve);
});
const core = spawn(process.execPath, [path.resolve("dist-electron/runtime/core/start-runtime.mjs")], {
  env: {
    ...process.env,
    PORT: String(corePort),
    WEBENVOY_CORE_SUPERVISOR_TOKEN: supervisorToken,
    WEBENVOY_RUNTIME_DATA_DIR: path.join(directory, "data"),
    WEBENVOY_RUN_RECORD_DIR: path.join(directory, "data", "runs"),
    WEBENVOY_HARBOR_RUNTIME_URL: harborEndpoint,
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: supervisorToken,
    WEBENVOY_LODE_REGISTRY_PATH: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
core.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  await waitForHealth(core);
  const response = await fetch(`${coreEndpoint}/owner/recovery/inspect`, {
    method: "POST",
    headers: { authorization: `Bearer ${supervisorToken}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotency_key: "packaged-recovery-inspect-unknown", profile_ref: "profile:packaged-unknown" }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.status, "rejected", JSON.stringify(result));
  assert.equal(result.failure?.code, "profile_not_found", JSON.stringify(result));
  assert.equal(inspectCalls, 1);
  assert.deepEqual(inspectBody, { profile_ref: "profile:packaged-unknown" });
  console.log("Packaged Core recovery entry smoke passed: unknown Profile rejected through owner inspect without 503.");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`);
} finally {
  await stopChild(core);
  await new Promise((resolve, reject) => harbor.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Packaged Core exited before health became ready (${child.exitCode}).`);
    try {
      if ((await fetch(`${coreEndpoint}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Packaged Core health did not become ready.");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local smoke port.");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
