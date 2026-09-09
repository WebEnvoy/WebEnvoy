import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileManagedAccessStore, managedOperations, managedInteractionOperations } from "./managed-access.js";
import { createManagedBrowserService } from "./managed-browser.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import { createFileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { executionPolicyMutationSchemaVersion } from "./execution-policy-config.js";

const directory = await mkdtemp(join(tmpdir(), "managed-browser-check-"));
const profiles: Record<string, unknown>[] = [];
let creates = 0;
let navigations = 0, observations = 0;
let managedSession: Record<string, unknown>;
let dropResponse = false;
let interactions = 0, dropInteractionResponse = false, refuseInteraction = false;
const receipts = new Map<string, unknown>();
let afterCreate: (() => Promise<void>) | undefined;
const server = createServer((req, res) => { void (async () => {
  assert.equal(req.headers.authorization, "Bearer fixture-supervisor");
  let value: unknown;
  if (req.url === "/runtime/managed-operation-catalog") value = {
    schema_version: "webenvoy.harbor-operation-catalog.v0", catalog_ref: "harbor://managed-operations", catalog_version: "1",
    operations: [...managedOperations.filter(op => !(managedInteractionOperations as readonly string[]).includes(op)).map(operation_id => ({ operation_id, category: ["profile.create", "account.bind"].includes(operation_id) ? "commit" : "read", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile"] })),
      ...["controlled-page.observe", "controlled-page.interact"].map(operation_id => ({ operation_id, category: operation_id === "controlled-page.interact" ? "prepare" : "read", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile", "harbor://controlled-page"] }))]
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
  else if (req.url === "/runtime/identity-environments/identity%3A1/session") value = { runtime_session: managedSession };
  else if (req.url === "/runtime/sessions/session%3Aone/observe") { observations++; value = { status: "completed" }; }
  else if (["/runtime/sessions/session%3Aone/navigate", "/runtime/sessions/session%3Aone/read"].includes(req.url ?? "")) {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (req.url!.endsWith("/navigate")) { navigations++; managedSession.current_page = { current_url: input.url }; }
    value = { status: "completed", session: managedSession, observed_at: new Date().toISOString(), ...(req.url!.endsWith("/read") ? { text: "Example Domain is for use in documentation examples.", truncated: false } : {}) };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/interactions") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.controlled_origin, input.expected_origin);
    assert.equal(input.expected_origin, "http://127.0.0.1:18794");
    if (!refuseInteraction) interactions++;
    value = { status: refuseInteraction ? "unavailable" : "completed", dispatch_state: refuseInteraction ? "not_dispatched" : "dispatched",
      operation_ref: input.operation_ref, runtime_session_ref: "session:one", ...(refuseInteraction ? { failure_class: "managed_interaction_observation_stale" } : { snapshot: { page_ref: "page:one", observation_ref: `observation:${interactions}`, controls: [], text: "Ready", truncated: false } }) };
    receipts.set(input.operation_ref, value);
    if (dropInteractionResponse) { req.socket.destroy(); return; }
  } else if (req.url?.startsWith("/runtime/managed-interactions/")) value = receipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
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
  const browserOps = ["instance.navigate", "instance.read"];
  await accessStore.setProfilePolicy({ idempotency_key: "public-policy", profile_ref: "profile:1", allowed_operations: browserOps, allowed_origins: ["https://example.com"] });
  const publicGrant = await accessStore.createGrant({ idempotency_key: "public-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: browserOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  managedSession = { runtime_session_ref: "session:one", profile_ref: "profile:1", control_owner: "core_task", control_lock: { state: "held", holder_ref: principal.principal_id }, current_page: { current_url: "https://example.com/" } };
  const navigation = { idempotency_key: "navigate-one", connection_id: connection.connection_id, grant_id: publicGrant.grant_id, operation: "instance.navigate", profile_ref: "profile:1", origin: "https://example.com", url: "https://example.com/one", runtime_session_ref: "session:one", task_scope: { operations: browserOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  await assert.rejects(service.submit(credentialHash, { ...navigation, runtime_session_ref: undefined }), /invalid_input/);
  const stale = await service.submit(credentialHash, { ...navigation, idempotency_key: "old-session", runtime_session_ref: "session:old" });
  assert.equal(stale.failure?.code, "managed_browser_session_mismatch");
  assert.equal(navigations, 0);
  const navigated = await service.submit(credentialHash, navigation);
  assert.equal(navigated.status, "succeeded", JSON.stringify(navigated));
  assert.equal(navigations, 1);
  assert.equal(observations, 1, "fresh observation precedes navigation after reconnect or handback");
  assert.deepEqual(await service.query(credentialHash, navigated.run_id), navigated);
  assert.deepEqual(await service.submit(credentialHash, navigation), navigated);
  assert.equal(navigations, 1, "query and duplicate submission never replay navigation");
  const content = await service.submit(credentialHash, { ...navigation, idempotency_key: "read-one", operation: "instance.read", url: undefined });
  assert.equal((content.result as { text: string }).text, "Example Domain is for use in documentation examples.");
  for (const denied of [{ ...navigation, profile_ref: "profile:2" }, { ...navigation, origin: "https://denied.example", url: "https://denied.example/" }, { ...navigation, task_scope: { ...navigation.task_scope, operations: ["instance.read"] } }]) {
    await assert.rejects(service.submit(credentialHash, { ...denied, idempotency_key: "denied" }), /managed_access_denied/);
  }
  await accessStore.revokeGrant({ idempotency_key: "revoke-public", grant_id: publicGrant.grant_id });
  const publicReconnect = await accessStore.connect(credentialHash);
  await assert.rejects(service.submit(credentialHash, { ...navigation, connection_id: publicReconnect.connection_id, idempotency_key: "after-public-revoke" }), /grant_unavailable/);
  assert.equal(navigations, 1);
  assert.deepEqual(await service.query(credentialHash, navigated.run_id), navigated);
  const origin = "http://127.0.0.1:18794";
  const interactionOps = [...managedInteractionOperations];
  const policy = { profile_ref: "profile:1", allowed_operations: interactionOps, allowed_origins: [origin] };
  await accessStore.setProfilePolicy({ idempotency_key: "no-declaration", ...policy });
  const interactiveGrant = await accessStore.createGrant({ idempotency_key: "controlled-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: interactionOps, allowed_origins: [origin], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const interactive = { idempotency_key: "snapshot", connection_id: connection.connection_id, grant_id: interactiveGrant.grant_id,
    operation: "instance.snapshot", profile_ref: "profile:1", origin, runtime_session_ref: "session:one", task_scope: { operations: interactionOps, profile_refs: ["profile:1"], origins: [origin] } };
  await assert.rejects(service.submit(credentialHash, interactive), /controlled_origin_required/);
  await assert.rejects(accessStore.setProfilePolicy({ idempotency_key: "invalid-declaration", ...policy, controlled_interaction_origins: ["http://127.0.0.1:18795"] }), /invalid_input/);
  await accessStore.setProfilePolicy({ idempotency_key: "controlled-declaration", ...policy, controlled_interaction_origins: [origin] });
  const snapshot = await service.submit(credentialHash, interactive);
  assert.equal(snapshot.status, "succeeded", JSON.stringify(snapshot));
  const input = { ...interactive, idempotency_key: "input-one", operation: "instance.input", page_ref: "page:one", observation_ref: "observation:1", target_ref: "target:one", text: "ordinary test" };
  const deniedPolicy = await service.submit(credentialHash, { ...input, idempotency_key: "prepare-not-allowed" });
  assert.equal(deniedPolicy.failure?.code, "managed_browser_policy_refused");
  assert.equal(deniedPolicy.dispatch_state, "not_dispatched");
  assert.equal(interactions, 1);
  await service.putManagementPolicy({ schema_version: executionPolicyMutationSchemaVersion, idempotency_key: "allow-controlled", expected_source_version: null, modes: { read: "auto", prepare: "auto", commit: "auto" } });
  for (const override of [{ task_scope: { ...input.task_scope, operations: ["instance.snapshot"] } }, { profile_ref: "profile:2" }, { origin: "http://127.0.0.1:18795" }]) {
    await assert.rejects(service.submit(credentialHash, { ...input, ...override }), /managed_access_denied/);
  }
  const readOnlyGrant = await accessStore.createGrant({ idempotency_key: "read-only-controlled", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: ["instance.snapshot"], allowed_origins: [origin], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  await assert.rejects(service.submit(credentialHash, { ...input, grant_id: readOnlyGrant.grant_id }), /managed_access_denied/);
  const wrongInstance = await service.submit(credentialHash, { ...input, idempotency_key: "wrong-instance", runtime_session_ref: "session:other" });
  assert.equal(wrongInstance.dispatch_state, "not_dispatched");
  assert.equal(interactions, 1);
  refuseInteraction = true;
  const refused = await service.submit(credentialHash, { ...input, idempotency_key: "stale-target" });
  assert.equal(refused.status, "failed"); assert.equal(refused.dispatch_state, "not_dispatched");
  assert.equal(interactions, 1);
  refuseInteraction = false;
  dropInteractionResponse = true;
  const lost = await service.submit(credentialHash, input);
  assert.equal(lost.status, "unknown_outcome"); assert.equal(lost.dispatch_state, "dispatched");
  assert.equal(interactions, 2);
  dropInteractionResponse = false;
  assert.deepEqual(await service.submit(credentialHash, input), lost, "same key cannot replay input");
  await accessStore.revokeGrant({ idempotency_key: "revoke-controlled", grant_id: interactiveGrant.grant_id });
  const interactiveReconnect = await accessStore.connect(credentialHash);
  await assert.rejects(service.submit(credentialHash, { ...input, idempotency_key: "after-controlled-revoke", connection_id: interactiveReconnect.connection_id }), /grant_unavailable/);
  const queried = await service.query(credentialHash, lost.run_id);
  assert.equal(queried.status, "unknown_outcome", "receipt adds fact without erasing lost-response history");
  assert.equal(queried.reconciliation, "completed");
  assert.equal((queried.result as { snapshot: { text: string } }).snapshot.text, "Ready");
  assert.equal(interactions, 2, "query after revocation does not replay input");
  console.log("managed browser Core HTTP boundary self-check passed");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
