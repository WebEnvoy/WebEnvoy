import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  console.log(JSON.stringify({ state: "passed", installed_core: true, account_template: templateRef,
    local_definition_ref: projected.body.result.local_definition_ref, local_revision_ref: projected.body.result.local_revision_ref,
    grant_scope_enforced: true, disabled_definition_denied: true, identity_state: "unknown" }));
} finally {
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  await rm(directory, { recursive: true, force: true });
}
