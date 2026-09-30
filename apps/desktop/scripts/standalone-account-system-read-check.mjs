import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = resolve(process.argv[2] ?? "");
const lodeRoot = join(packageRoot, "dist-electron/lode");
const runtimeRoot = join(packageRoot, "dist-electron/runtime/core/node_modules/@webenvoy");
const core = await import(pathToFileURL(join(runtimeRoot, "core-runtime/dist/index.js")).href);
const { createApiServer } = await import(pathToFileURL(join(runtimeRoot, "api-server/dist/server.js")).href);

const sitePin = core.approvedManagedSiteTaskPackageFor("lode://site-skill/github/trending");
assert(sitePin, "the installed Core has the exact GitHub Trending code pin");
const siteTask = await core.verifySiteSkillPackageRoot(lodeRoot, sitePin);
assert.equal(siteTask.task_ref, "read-daily-trending-top5");
assert.equal(siteTask.script.sha256, "sha256:d73b66d5711ddd5a4e9295d8df4677f431b62d3f44b513698e095a2a31ffb0ab");
assert.equal(siteTask.capability.operation_id, "instance.snapshot");
assert.equal(siteTask.capability.action, "read");

const directory = await mkdtemp(join(tmpdir(), "webenvoy-installed-account-read-"));
const ownerToken = "owner-installed-account-route-123456789";
const agentToken = "agent-installed-account-route-123456789";
const credentialHash = createHash("sha256").update(agentToken).digest("hex");
const templateRef = "lode://account-system/github@1.0.0";
const access = core.createFileManagedAccessStore({ directory: join(directory, "access") });
const definitions = core.createFileAccountSystemDefinitionStore({ directory: join(directory, "definitions"), lodeAssetsPath: lodeRoot });
const imported = await definitions.importTemplate({ template_ref: templateRef });
const principal = await access.registerPrincipal({ idempotency_key: "register", display_name: "Installed Agent", credential_hash: credentialHash });
const connection = await access.connect(credentialHash);
const grant = await access.createGrant({
  idempotency_key: "grant-template", principal_id: principal.principal_id, profile_refs: [],
  allowed_operations: ["skill.inspect"], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(),
  creation_template: null, max_created_profiles: 0,
  skill_scope: { skill_refs: [templateRef], source_refs: [templateRef] }
});
const unscopedGrant = await access.createGrant({
  idempotency_key: "grant-no-template", principal_id: principal.principal_id, profile_refs: [],
  allowed_operations: ["skill.inspect"], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(),
  creation_template: null, max_created_profiles: 0
});
const server = createApiServer({
  supervisorToken: ownerToken,
  managedAccessStore: access,
  managedAccountSystemService: core.createManagedAccountSystemReadService({ managedAccessStore: access, accountSystemDefinitionService: definitions })
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const address = server.address();
assert(address && typeof address === "object");
const call = async (grantId, extra = {}) => {
  const response = await fetch(`http://127.0.0.1:${address.port}/managed-account-systems/operations`, {
    method: "POST", headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
    body: JSON.stringify({ schema_version: "webenvoy.account-system-agent-operation/v1", operation: "account_system.read",
      connection_id: connection.connection_id, grant_id: grantId, template_ref: templateRef, ...extra })
  });
  return { status: response.status, body: await response.json() };
};

try {
  const projected = await call(grant.grant_id);
  assert.equal(projected.status, 200, JSON.stringify(projected.body));
  assert.equal(projected.body.result.local_definition_ref, imported.local_definition_ref);
  assert.equal(projected.body.result.local_revision_ref, imported.revision_ref);
  assert.equal(projected.body.result.template_ref, templateRef);
  assert.equal(projected.body.result.identity_state, "unknown");
  assert.equal(projected.body.result.evaluation_state, "not_evaluated");
  assert.equal(Object.keys(projected.body.result).some(key => /cookie|credential|identity_method|email/i.test(key)), false);

  const unscoped = await call(unscopedGrant.grant_id);
  assert.equal(unscoped.status, 403);
  assert.equal(unscoped.body.error.code, "managed_access_denied");
  const callerScope = await call(grant.grant_id, { task_scope: { operations: ["identity.read"] } });
  assert.equal(callerScope.status, 400);

  await definitions.disable({ local_definition_ref: imported.local_definition_ref, expected_record_version: imported.record_version });
  const disabled = await call(grant.grant_id);
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.error.code, "account_system_definition_disabled");
  const importedByEntry = await checkPackagedCoreImportEntry(packageRoot, lodeRoot);
  console.log(JSON.stringify({ state: "passed", installed_core: true, account_template: templateRef,
    local_definition_ref: projected.body.result.local_definition_ref, local_revision_ref: projected.body.result.local_revision_ref,
    grant_scope_enforced: true, disabled_definition_denied: true, identity_state: "unknown", generated_entry_import: importedByEntry }));
} finally {
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  await rm(directory, { recursive: true, force: true });
}

async function checkPackagedCoreImportEntry(packageRoot, lodeRoot) {
  const corePort = await reservePort();
  const endpoint = `http://127.0.0.1:${corePort}`;
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-packaged-account-import-entry-"));
  const dataDirectory = join(directory, "data");
  const supervisorToken = "packaged-account-import-supervisor-token-1234567890";
  const agentToken = "packaged-account-import-agent-token-1234567890";
  const harborRuntimeUrl = "http://127.0.0.1:1";
  const entry = spawn(process.execPath, [join(packageRoot, "dist-electron/runtime/core/start-runtime.mjs")], {
    env: { ...process.env, PORT: String(corePort), WEBENVOY_CORE_SUPERVISOR_TOKEN: supervisorToken,
      WEBENVOY_RUNTIME_DATA_DIR: dataDirectory, WEBENVOY_RUN_RECORD_DIR: join(dataDirectory, "core-runs"),
      WEBENVOY_MANAGED_ACCESS_DIR: join(directory, "managed-access"), WEBENVOY_HARBOR_RUNTIME_URL: harborRuntimeUrl,
      HARBOR_RUNTIME_SUPERVISOR_TOKEN: supervisorToken, WEBENVOY_LODE_ASSETS_PATH: lodeRoot, WEBENVOY_LODE_REGISTRY_PATH: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  entry.stderr.on("data", chunk => { stderr += chunk; });
  try {
    await waitForHealth(entry, endpoint);
    const owner = async (path, input) => {
      const response = await fetch(`${endpoint}${path}`, { method: "POST", headers: { authorization: `Bearer ${supervisorToken}`, "content-type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json();
      assert.ok(response.ok, `${path}: ${JSON.stringify(body)}`);
      return body;
    };
    const agent = async (path, input, method = "POST") => {
      const response = await fetch(`${endpoint}${path}`, { method, headers: { authorization: `Bearer ${agentToken}`, ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      return { status: response.status, body: await response.json() };
    };
    const templateRef = "lode://account-system/github@1.0.0";
    const principal = await owner("/agent-access/principals", {
      idempotency_key: "packaged-account-import-principal", display_name: "Packaged Account Import Agent",
      credential_hash: createHash("sha256").update(agentToken).digest("hex")
    });
    const baseGrant = { principal_id: principal.principal.principal_id, profile_refs: [],
      allowed_operations: ["account_system.import_template"], allowed_origins: [],
      expires_at: new Date(Date.now() + 60_000).toISOString(), creation_template: null, max_created_profiles: 0 };
    const deniedGrant = await owner("/agent-access/grants", { ...baseGrant, idempotency_key: "packaged-account-import-wrong-template",
      account_system_scope: { template_refs: ["lode://account-system/other@1.0.0"] } });
    const allowedGrant = await owner("/agent-access/grants", { ...baseGrant, idempotency_key: "packaged-account-import-exact-template",
      account_system_scope: { template_refs: [templateRef] } });
    const connected = await agent("/agent-connections");
    assert.equal(connected.status, 201, JSON.stringify(connected.body));
    const request = grantId => ({ idempotency_key: "packaged-account-import-operation", connection_id: connected.body.connection.connection_id,
      grant_id: grantId, operation: "account_system.import_template", template_ref: templateRef,
      task_scope: { operations: ["account_system.import_template"], template_refs: [templateRef] } });
    const denied = await agent("/managed-browser/operations", request(deniedGrant.grant.grant_id));
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error.code, "managed_access_denied");
    const imported = await agent("/managed-browser/operations", request(allowedGrant.grant.grant_id));
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.status, "succeeded", JSON.stringify(imported.body));
    assert.equal(imported.body.result.template_ref, templateRef);
    const queried = await agent(`/managed-browser/operations/${encodeURIComponent(imported.body.run_id)}`, undefined, "GET");
    assert.equal(queried.status, 200, JSON.stringify(queried.body));
    assert.equal(queried.body.status, "succeeded");
    assert.equal(queried.body.run_id, imported.body.run_id);
    assert.deepEqual(queried.body.result, imported.body.result);
    const retry = await agent("/managed-browser/operations", request(allowedGrant.grant.grant_id));
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.run_id, imported.body.run_id);
    assert.deepEqual(retry.body.result, imported.body.result);
    return { state: "passed", entry: "dist-electron/runtime/core/start-runtime.mjs", authorization_denied: true,
      import_succeeded: true, same_run_query: true, harbor_url: harborRuntimeUrl };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`);
  } finally {
    await stopChild(entry);
    await rm(directory, { recursive: true, force: true });
  }
}

async function waitForHealth(child, endpoint) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Packaged Core exited before health became ready (${child.exitCode}).`);
    try { if ((await fetch(`${endpoint}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Packaged Core health did not become ready.");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function reservePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const address = socket.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}
