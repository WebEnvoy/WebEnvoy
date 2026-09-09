import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileManagedAccessStore, managedOperations } from "./managed-access.js";
import { createManagedBrowserService } from "./managed-browser.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import { createFileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { executionPolicyMutationSchemaVersion } from "./execution-policy-config.js";

const directory = await mkdtemp(join(tmpdir(), "managed-browser-check-"));
const profiles: Record<string, unknown>[] = [];
let creates = 0;
let dropResponse = false;
const receipts = new Map<string, unknown>();
let afterCreate: (() => Promise<void>) | undefined;
const server = createServer((req, res) => { void (async () => {
  assert.equal(req.headers.authorization, "Bearer fixture-supervisor");
  let value: unknown;
  if (req.url === "/runtime/managed-operation-catalog") value = {
    schema_version: "webenvoy.harbor-operation-catalog.v0", catalog_ref: "harbor://managed-operations", catalog_version: "1",
    operations: managedOperations.map(operation_id => ({ operation_id, category: ["profile.create", "account.bind"].includes(operation_id) ? "commit" : "read", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile"] }))
  };
  else if (req.url === "/runtime/identity-environment-mutations") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.identity_environment.requested_provider_id, "camoufox");
    creates++;
    const record = { refs: { profile_ref: `profile:${creates}` }, identity_environment_ref: `identity:${creates}`, site: { origin: "https://example.com" }, status: { readiness: "ready" }, account_bindings: [] };
    profiles.push(record); value = { status: "completed", record };
    receipts.set(input.idempotency_key, value);
    await afterCreate?.();
    if (dropResponse) { req.socket.destroy(); return; }
  } else if (req.url?.startsWith("/runtime/identity-environment-mutations/")) value = receipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
  else if (req.url === "/runtime/identity-environments") value = { identity_environments: profiles };
  else { res.writeHead(404); res.end('{}'); return; }
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value));
})().catch(() => { res.writeHead(500); res.end('{}'); }); });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const accessStore = createFileManagedAccessStore({ directory: join(directory, "access") });
  const runRecordStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  const executionPolicyConfigStore = createFileExecutionPolicyConfigStore({ directory: join(directory, "policy") });
  await executionPolicyConfigStore.putGlobalConfiguration({ schema_version: executionPolicyMutationSchemaVersion, idempotency_key: "allow", expected_source_version: null, modes: { read: "auto", prepare: "confirm", commit: "auto", destructive: "deny" } });
  const service = createManagedBrowserService({ accessStore, runRecordStore, executionPolicyConfigStore,
    authorizationDecisionStore: createFileAuthorizationDecisionStore({ directory: join(directory, "decisions"), runRecordStore }),
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor" });
  const credentialHash = createHash("sha256").update("fixture-agent").digest("hex");
  const principal = await accessStore.registerPrincipal({ idempotency_key: "register", display_name: "Fixture Agent", credential_hash: credentialHash });
  const connection = await accessStore.connect(credentialHash);
  const grant = await accessStore.createGrant({ idempotency_key: "grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: [...managedOperations], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 2,
    creation_template: { template_ref: "template:example", provider_id: "camoufox", site: { site_id: "example", origin: "https://example.com", display_name: "Example" }, language: "en-US", timezone: "UTC", permission_ceiling: { allowed_operations: ["profile.list", "profile.read"], allowed_origins: ["https://example.com"] } } });
  const request = { idempotency_key: "create-one", connection_id: connection.connection_id, grant_id: grant.grant_id, operation: "profile.create", template_ref: "template:example", task_scope: { operations: [...managedOperations], profile_refs: ["profile:1", "profile:2"], origins: ["https://example.com"] } };
  const first = await service.submit(credentialHash, request);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(await service.submit(credentialHash, request), first);
  assert.equal(creates, 1);
  await assert.rejects(service.submit(credentialHash, { ...request, template_ref: "template:wider" }), /idempotency_conflict/);
  const listed = await service.submit(credentialHash, { ...request, idempotency_key: "list", operation: "profile.list", template_ref: undefined });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal((listed.result as { profiles: unknown[] }).profiles.length, 1);
  await assert.rejects(service.submit(credentialHash, { ...request, idempotency_key: "elevate", operation: "instance.start", template_ref: undefined, profile_ref: "profile:1", origin: "https://example.com" }), /managed_access_denied/);
  afterCreate = async () => { await accessStore.revokeGrant({ idempotency_key: "revoke-in-flight", grant_id: grant.grant_id }); };
  const second = await service.submit(credentialHash, { ...request, idempotency_key: "create-two" });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(creates, 2);
  assert.equal((await accessStore.list()).grants[0]!.created_profile_refs.length, 2);
  const reconnect = await accessStore.connect(credentialHash);
  await assert.rejects(service.submit(credentialHash, { ...request, idempotency_key: "after-revoke", connection_id: reconnect.connection_id }), /grant_unavailable/);
  assert.deepEqual(await service.query(credentialHash, second.run_id), second);
  assert.equal((await runRecordStore.listRunRecords()).filter(run => run.status === "succeeded").length, 3);
  const recoveryGrant = await accessStore.createGrant({ idempotency_key: "recovery-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: grant.allowed_operations, allowed_origins: grant.allowed_origins, expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 2, creation_template: grant.creation_template });
  afterCreate = undefined; dropResponse = true;
  const unknown = await service.submit(credentialHash, { ...request, idempotency_key: "lost-response", grant_id: recoveryGrant.grant_id });
  assert.equal(unknown.status, "unknown_outcome");
  assert.equal(creates, 3);
  dropResponse = false;
  const blocked = await service.submit(credentialHash, { ...request, idempotency_key: "do-not-repeat", grant_id: recoveryGrant.grant_id });
  assert.equal(blocked.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal(creates, 3);
  await accessStore.revokeGrant({ idempotency_key: "revoke-before-query", grant_id: recoveryGrant.grant_id });
  const reconciled = await service.query(credentialHash, unknown.run_id);
  assert.equal(reconciled.status, "unknown_outcome", "original unknown history must remain visible");
  assert.equal((reconciled.result as { profile: { profile_ref: string } }).profile.profile_ref, "profile:3");
  assert.equal(creates, 3, "receipt query must not replay creation");
  assert.equal((await accessStore.list()).grants.find(item => item.grant_id === recoveryGrant.grant_id)?.created_profile_refs.length, 1);
  console.log("managed browser Core HTTP boundary self-check passed");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
