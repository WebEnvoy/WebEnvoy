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
import { createManagedRecoveryService } from "./profile-recovery.js";

const directory = await mkdtemp(join(tmpdir(), "managed-browser-check-"));
const profiles: Record<string, unknown>[] = [];
let creates = 0;
let navigations = 0, observations = 0, sessionReads = 0;
let diagnostics = 0, lockAttempts = 0, dropDiagnosticsResponse = false;
const forwardedDiagnosticsOrigins: string[][] = [];
let managedSession: Record<string, unknown>;
let dropResponse = false;
let interactions = 0, dropInteractionResponse = false, refuseInteraction = false;
const forwardedInteractionOrigins: string[][] = [];
const receipts = new Map<string, unknown>();
let pageLists = 0, pageMutations = 0, dropPageResponse = false;
const pageReceipts = new Map<string, Record<string, unknown>>();
let environmentReads = 0, environmentUpdates = 0, dropEnvironmentResponse = false, environmentUnavailable = false;
let environmentConfigured = { timezone: "UTC", language: "en-US", viewport: "1280x720" };
let environmentEffective = { ...environmentConfigured };
let environmentPending: Record<string, string> | null = null;
const environmentReceipts = new Map<string, Record<string, unknown>>();
let recoveryExpectedProfileRef: string | undefined;
let afterCreate: (() => Promise<void>) | undefined;
let afterProfileList: (() => Promise<void>) | undefined;
let principalId: string | undefined;
const server = createServer((req, res) => { void (async () => {
  assert.equal(req.headers.authorization, "Bearer fixture-supervisor");
  let value: unknown;
  if (req.url === "/runtime/managed-operation-catalog") value = {
    schema_version: "webenvoy.harbor-operation-catalog.v0", catalog_ref: "harbor://managed-operations", catalog_version: "1",
    operations: [...managedOperations.filter(op => !(managedInteractionOperations as readonly string[]).includes(op)).map(operation_id => ({ operation_id, category: operation_id === "environment.update" || operation_id === "recovery.request" || ["page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward"].includes(operation_id) ? "prepare" : ["profile.create", "account.bind"].includes(operation_id) ? "commit" : "read", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile"] })),
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
  } else if (req.url?.startsWith("/runtime/identity-environment-mutations/")) value = receipts.get(decodeURIComponent(req.url.split("/").at(-1)!)) ?? environmentReceipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
  else if (req.url === "/runtime/identity-environments") { await afterProfileList?.(); value = { identity_environments: profiles }; }
  else if (req.url === "/runtime/identity-environments/identity%3A1/environment") {
    if (req.method === "GET") {
      environmentReads++;
      value = environmentUnavailable ? { status: "unavailable", failure_class: "provider_unavailable", retryable: true } :
        { status: "completed", identity_environment_ref: "identity:1", profile_ref: "profile:1",
          configured: { ...environmentConfigured }, effective: { ...environmentEffective }, pending: environmentPending === null ? null : { ...environmentPending },
          drift: "none", last_verified_at: "2026-09-09T00:00:00.000Z",
          provider: { provider_id: "camoufox", provider_version: "0.5.6", browser_version: "135.0", support: "supported" },
          observed: { language: environmentEffective.language, timezone: environmentEffective.timezone, viewport: environmentEffective.viewport } };
    } else {
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body) as { idempotency_key?: string; configuration?: Record<string, string> };
      assert.equal(typeof input.idempotency_key, "string");
      assert.ok(input.configuration && typeof input.configuration === "object");
      const key = input.idempotency_key!;
      const existing = environmentReceipts.get(key);
      if (existing) value = existing;
      else {
        environmentUpdates++;
        const configuration = { ...input.configuration };
        environmentConfigured = { ...environmentConfigured, ...configuration };
        environmentPending = configuration;
        const receipt = { status: "completed", idempotency_key: key, identity_environment_ref: "identity:1", configuration };
        environmentReceipts.set(key, receipt); value = receipt;
      }
      if (dropEnvironmentResponse) { req.socket.destroy(); return; }
    }
  } else if (req.url === "/runtime/identity-environments/identity%3A1/session") { sessionReads++; value = { runtime_session: managedSession };
  } else if (req.url === "/runtime/profile-recovery/inspect") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { profile_ref?: string };
    value = { schema_version: "harbor-profile-recovery/v1", profile_ref: input.profile_ref, status: "compatible" };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/observe") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.holder_ref, principalId);
    assert.equal(input.expected_origin, "https://example.com");
    assert.equal(input.page_id, "page-id:one");
    assert.equal(input.page_ref, "page:one");
    assert.equal(input.document_generation, 1);
    observations++;
    value = { status: "completed", page: { current_url: (managedSession.current_page as { current_url?: string }).current_url, title: "Fixture", status: "ready" } };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/diagnostics") {
    diagnostics++;
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.origin, "https://example.com");
    assert.ok(Array.isArray(input.authorized_origins));
    forwardedDiagnosticsOrigins.push([...input.authorized_origins]);
    if (input.cursor) { assert.equal(input.page_ref, "page:one"); assert.equal(input.limit, 1); }
    if (dropDiagnosticsResponse) { req.socket.destroy(); return; }
    value = { status: "completed", schema_version: "harbor-runtime-diagnostics/v1", runtime_session_ref: "session:one", profile_ref: "profile:1", page_ref: "page:one", document_generation: 1, page: { current_url: "https://example.com/", title: "Fixture", status: "ready" }, cursor: "cursor:2", next_cursor: "cursor:2", truncated: false, observed_at: new Date().toISOString(), network: [{ event_ref: "event:1", kind: "response", observed_at: new Date().toISOString(), method: "GET", url: "https://example.com/health", origin: "https://example.com", resource_kind: "fetch", status: 503, duration_ms: 4 }], console: [{ event_ref: "event:2", level: "error", observed_at: new Date().toISOString(), page_ref: "page:one", document_generation: 1, text: "fixture error", truncated: false }] };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/pages") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { operation?: string; operation_ref?: string; holder_ref?: string; page_ref?: string; url?: string };
    if (input.operation === "page.list") {
      assert.equal(input.holder_ref, principalId);
      pageLists++;
      value = { status: "completed", schema_version: "harbor-page-list/v2", runtime_session_ref: "session:one", active_page_id: "page-id:one", filtered_page_count: 0, observed_at: new Date().toISOString(), pages: [{ page_id: "page-id:one", page_ref: "page:one", document_generation: 1, requested_url: "https://example.com/", current_url: "https://example.com/", origin: "https://example.com", title: "Fixture", status: "ready", active: true, error_reason: null, observed_at: new Date().toISOString() }] };
    } else {
      assert.ok(input.operation_ref);
      if (managedSession.control_owner !== "core_task" || (managedSession.control_lock as { state?: unknown } | undefined)?.state !== "held") value = { status: "unavailable", dispatch_state: "not_dispatched", failure_class: "control_lock_conflict", operation_ref: input.operation_ref, runtime_session_ref: "session:one", observed_at: new Date().toISOString() };
      else {
        const previous = pageReceipts.get(input.operation_ref!);
        if (previous) value = previous;
        else {
          pageMutations++;
          const page = { page_id: "page-id:opened", page_ref: "page:opened", document_generation: 1, requested_url: input.url ?? "https://example.com/", current_url: input.url ?? "https://example.com/", origin: "https://example.com", title: "Opened", status: "ready", active: true, error_reason: null, observed_at: new Date().toISOString() };
          const receipt = { status: "completed", dispatch_state: "dispatched", operation_ref: input.operation_ref!, runtime_session_ref: "session:one", page, observed_at: new Date().toISOString() };
          pageReceipts.set(input.operation_ref!, receipt); value = receipt;
        }
      }
      if (dropPageResponse) { req.socket.destroy(); return; }
    }
  }
  else if (req.url?.startsWith("/runtime/managed-pages/")) value = pageReceipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
  else if (req.url === "/runtime/sessions/session%3Aone/lock") {
    lockAttempts++;
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { control_owner?: string; holder_ref?: string };
    if (managedSession.control_owner === "user" && (managedSession.control_lock as { state?: unknown } | undefined)?.state === "held") value = { status: "unavailable", failure_class: "session_locked", current_error: { code: "session_locked" } };
    else {
      managedSession.control_owner = input.control_owner ?? "core_task";
      managedSession.control_lock = { state: "held", holder_ref: input.holder_ref };
      value = { ...managedSession };
    }
  }
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
    assert.ok(Array.isArray(input.authorized_origins));
    forwardedInteractionOrigins.push([...input.authorized_origins]);
    if (!refuseInteraction) interactions++;
    value = { status: refuseInteraction ? "unavailable" : "completed", dispatch_state: refuseInteraction ? "not_dispatched" : "dispatched",
      operation_ref: input.operation_ref, runtime_session_ref: "session:one", ...(refuseInteraction ? { failure_class: "managed_interaction_observation_stale" } : { snapshot: { page_ref: input.page_ref ?? "page:one", observation_ref: `observation:${interactions}`, controls: [], text: "Ready", truncated: false } }) };
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
  const recoveryStatus = { ok: true, operation_ref: "recovery:status-fixture", status: "apply_completed", run_id: `managed-${"0".repeat(64)}` };
  const recoveryService = {
    inspect: async () => recoveryStatus,
    backup: async () => recoveryStatus,
    plan: async () => recoveryStatus,
    apply: async () => recoveryStatus,
    request: async () => recoveryStatus,
    status: async (_input: unknown, expectedProfileRef?: string) => { recoveryExpectedProfileRef = expectedProfileRef; return recoveryStatus; }
  };
  const service = createManagedBrowserService({ accessStore, runRecordStore, executionPolicyConfigStore,
    authorizationDecisionStore: createFileAuthorizationDecisionStore({ directory: join(directory, "decisions"), runRecordStore }),
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService });
  const credentialHash = createHash("sha256").update("fixture-agent").digest("hex");
  const principal = await accessStore.registerPrincipal({ idempotency_key: "register", display_name: "Fixture Agent", credential_hash: credentialHash });
  principalId = principal.principal_id;
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
  const browserOps = ["instance.navigate", "instance.read", "instance.observe"];
  await accessStore.setProfilePolicy({ idempotency_key: "public-policy", profile_ref: "profile:1", allowed_operations: browserOps, allowed_origins: ["https://example.com"] });
  const publicGrant = await accessStore.createGrant({ idempotency_key: "public-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: browserOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  managedSession = { runtime_session_ref: "session:one", profile_ref: "profile:1", control_owner: "core_task", control_lock: { state: "held", holder_ref: principal.principal_id }, current_page: { current_url: "https://example.com/" } };
  const diagnosticsOps = ["instance.diagnostics"];
  await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-policy", profile_ref: "profile:1", allowed_operations: [...diagnosticsOps, ...browserOps], allowed_origins: ["https://example.com"] });
  const diagnosticsGrant = await accessStore.createGrant({ idempotency_key: "diagnostics-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: diagnosticsOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  managedSession.control_owner = "user";
  managedSession.control_lock = { state: "released", holder_ref: null };
  const diagnosticResult = await service.submit(credentialHash, { idempotency_key: "diagnostics-one", connection_id: connection.connection_id, grant_id: diagnosticsGrant.grant_id, operation: "instance.diagnostics", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one", task_scope: { operations: diagnosticsOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } });
  assert.equal(diagnosticResult.status, "succeeded", JSON.stringify(diagnosticResult));
  assert.equal((diagnosticResult.result as { network: { status: number }[] }).network[0]?.status, 503);
  assert.equal(diagnostics, 1);
  assert.equal(lockAttempts, 0, "diagnostics must not acquire ControlLease");
  const diagnosticRequest = { idempotency_key: "diagnostics-page", connection_id: connection.connection_id, grant_id: diagnosticsGrant.grant_id, operation: "instance.diagnostics", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one", page_ref: "page:one", cursor: "cursor:1", limit: 1, task_scope: { operations: diagnosticsOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  assert.equal((await service.submit(credentialHash, diagnosticRequest)).status, "succeeded");
  for (const invalid of [{ limit: 65 }, { limit: 0 }, { target_ref: "target:one" }, { body: "not allowed" }, { headers: { authorization: "fixture" } }]) {
    await assert.rejects(service.submit(credentialHash, { ...diagnosticRequest, ...invalid, idempotency_key: "invalid-diagnostics" }), /invalid_input/);
  }
  for (const override of [{ profile_ref: "profile:2" }, { origin: "https://denied.example" }, { grant_id: publicGrant.grant_id }, { task_scope: { ...diagnosticRequest.task_scope, operations: [] } }]) {
    await assert.rejects(service.submit(credentialHash, { ...diagnosticRequest, ...override, idempotency_key: "denied-diagnostics" }), /managed_access_denied/);
  }
  assert.equal((await service.submit(credentialHash, { ...diagnosticRequest, idempotency_key: "wrong-instance-diagnostics", runtime_session_ref: "session:wrong" })).failure?.code, "managed_browser_session_mismatch");
  assert.equal(diagnostics, 2, "denials must not reach the provider");
  dropDiagnosticsResponse = true;
  const lostDiagnostics = await service.submit(credentialHash, { ...diagnosticRequest, idempotency_key: "lost-diagnostics" });
  dropDiagnosticsResponse = false;
  const diagnosticReconnect = await accessStore.connect(credentialHash);
  assert.deepEqual(await service.query(credentialHash, lostDiagnostics.run_id), lostDiagnostics);
  assert.equal((await service.submit(credentialHash, { ...diagnosticRequest, connection_id: diagnosticReconnect.connection_id, idempotency_key: "fresh-diagnostics" })).status, "succeeded");
  assert.equal(navigations, 0, "diagnostic response loss and reconnect never generate a page action");
  assert.equal(lockAttempts, 0);
  const diagnosticsExtraOrigin = "https://second.example";
  const diagnosticsScopeOperations = ["instance.diagnostics"];
  await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-scope-wide", profile_ref: "profile:1",
    allowed_operations: diagnosticsScopeOperations, allowed_origins: ["https://example.com", diagnosticsExtraOrigin] });
  const diagnosticsScopeGrant = await accessStore.createGrant({ idempotency_key: "diagnostics-scope-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:1"], allowed_operations: diagnosticsScopeOperations, allowed_origins: ["https://example.com", diagnosticsExtraOrigin],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const diagnosticsScopeRequest = { idempotency_key: "diagnostics-scope", connection_id: connection.connection_id, grant_id: diagnosticsScopeGrant.grant_id,
    operation: "instance.diagnostics", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one",
    task_scope: { operations: diagnosticsScopeOperations, profile_refs: ["profile:1"], origins: [diagnosticsExtraOrigin, "https://example.com"] } };
  afterProfileList = async () => { await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-scope-narrow", profile_ref: "profile:1",
    allowed_operations: diagnosticsScopeOperations, allowed_origins: ["https://example.com"] }); };
  let diagnosticsScopeResult;
  try {
    diagnosticsScopeResult = await service.submit(credentialHash, diagnosticsScopeRequest);
  } finally {
    afterProfileList = undefined;
  }
  assert.equal(diagnosticsScopeResult.status, "succeeded", JSON.stringify(diagnosticsScopeResult));
  assert.deepEqual(forwardedDiagnosticsOrigins.at(-1), ["https://example.com"], "diagnostics forwards the latest checked origin scope");
  await accessStore.revokeGrant({ idempotency_key: "revoke-diagnostics-scope", grant_id: diagnosticsScopeGrant.grant_id });
  await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-scope-restore", profile_ref: "profile:1",
    allowed_operations: [...diagnosticsOps, ...browserOps], allowed_origins: ["https://example.com"] });
  await accessStore.revokeGrant({ idempotency_key: "revoke-diagnostics", grant_id: diagnosticsGrant.grant_id });
  await assert.rejects(service.submit(credentialHash, { ...diagnosticRequest, idempotency_key: "revoked-diagnostics" }), /grant_unavailable/);
  managedSession.control_owner = "core_task";
  managedSession.control_lock = { state: "held", holder_ref: principal.principal_id };
  const navigation = { idempotency_key: "navigate-one", connection_id: connection.connection_id, grant_id: publicGrant.grant_id, operation: "instance.navigate", profile_ref: "profile:1", origin: "https://example.com", url: "https://example.com/one", runtime_session_ref: "session:one", page_id: "page-id:one", page_ref: "page:one", document_generation: 1, task_scope: { operations: browserOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
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
  const observed = await service.submit(credentialHash, { ...navigation, idempotency_key: "observe-one", operation: "instance.observe", url: undefined });
  assert.equal(observed.status, "succeeded", JSON.stringify(observed));
  assert.equal((observed.result as { observation: { page: { current_url: string } } }).observation.page.current_url, "https://example.com/one");
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
    operation: "instance.snapshot", profile_ref: "profile:1", origin, runtime_session_ref: "session:one", page_ref: "page:one", task_scope: { operations: interactionOps, profile_refs: ["profile:1"], origins: [origin] } };
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
  const pageOps = ["page.list", "page.open", "page.navigate"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "page-policy", profile_ref: "profile:1", allowed_operations: [...browserOps, ...pageOps], allowed_origins: ["https://example.com"] });
  const pageGrant = await accessStore.createGrant({ idempotency_key: "page-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: [...pageOps], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const pageRequest = { idempotency_key: "page-list", connection_id: connection.connection_id, grant_id: pageGrant.grant_id, operation: "page.list" as const, profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one", task_scope: { operations: [...pageOps], profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  const prepareDeniedPage = await service.submit(credentialHash, { ...pageRequest, idempotency_key: "page-prepare-denied", operation: "page.open" as const, url: "https://example.com/denied" });
  assert.equal(prepareDeniedPage.status, "failed", JSON.stringify(prepareDeniedPage));
  assert.equal(prepareDeniedPage.failure?.code, "managed_browser_policy_refused");
  assert.equal(prepareDeniedPage.dispatch_state, "not_dispatched");
  assert.equal(pageMutations, 0, "prepare refusal must not reach the Page provider");
  await service.putManagementPolicy({ schema_version: executionPolicyMutationSchemaVersion, idempotency_key: "allow-controlled", expected_source_version: null, modes: { read: "auto", prepare: "auto", commit: "auto" } });
  managedSession.control_owner = "none";
  managedSession.control_lock = { state: "released", holder_ref: null };
  const pageLockAttempts = lockAttempts;
  const listedPages = await service.submit(credentialHash, pageRequest);
  assert.equal(listedPages.status, "succeeded", JSON.stringify(listedPages));
  assert.equal((listedPages.result as { pages: unknown[] }).pages.length, 1);
  assert.equal(listedPages.dispatch_state, undefined, "page.list remains observation-only");
  assert.equal(lockAttempts, pageLockAttempts, "page.list must not acquire ControlLease");
  const pageOpen = { ...pageRequest, idempotency_key: "page-open", operation: "page.open" as const, url: "https://example.com/two" };
  const openedPage = await service.submit(credentialHash, pageOpen);
  assert.equal(openedPage.status, "succeeded", JSON.stringify(openedPage));
  assert.equal(openedPage.dispatch_state, "dispatched");
  assert.equal(lockAttempts, pageLockAttempts + 1, "page.open acquires the Instance ControlLease after handback");
  assert.equal(managedSession.control_owner, "core_task");
  const openedPageFacts = (openedPage.result as { page: { page_ref: string } }).page;
  const pageNavigate = { ...pageRequest, idempotency_key: "page-navigate", operation: "page.navigate" as const, page_ref: openedPageFacts.page_ref, url: "https://example.com/three" };
  const navigatedPage = await service.submit(credentialHash, pageNavigate);
  assert.equal(navigatedPage.status, "succeeded", JSON.stringify(navigatedPage));
  assert.equal(navigatedPage.dispatch_state, "dispatched");
  const pageMutationsBeforeLoss = pageMutations;
  dropPageResponse = true;
  const lostPage = await service.submit(credentialHash, { ...pageNavigate, idempotency_key: "page-lost" });
  dropPageResponse = false;
  assert.equal(lostPage.status, "unknown_outcome", JSON.stringify(lostPage));
  assert.equal(lostPage.dispatch_state, "dispatched");
  assert.equal(pageMutations, pageMutationsBeforeLoss + 1);
  const reconciledPage = await service.query(credentialHash, lostPage.run_id);
  assert.equal(reconciledPage.status, "unknown_outcome", "page receipt must not rewrite the original unknown history");
  assert.equal(reconciledPage.reconciliation, "completed");
  assert.equal((reconciledPage.result as { page: { page_ref: string } }).page.page_ref, openedPageFacts.page_ref);
  assert.equal(pageMutations, pageMutationsBeforeLoss + 1, "page query must not replay the original mutation");
  assert.deepEqual(await service.submit(credentialHash, { ...pageNavigate, idempotency_key: "page-lost" }), reconciledPage);
  managedSession.control_owner = "user";
  managedSession.control_lock = { state: "held", holder_ref: "human" };
  const humanPage = await service.submit(credentialHash, { ...pageNavigate, idempotency_key: "page-human-held" });
  assert.equal(humanPage.status, "failed", JSON.stringify(humanPage));
  assert.equal(humanPage.failure?.code, "control_lock_conflict");
  assert.equal(humanPage.dispatch_state, "not_dispatched");
  assert.equal(pageMutations, pageMutationsBeforeLoss + 1, "human-held Page mutation must not reach the provider");
  managedSession.control_owner = "core_task";
  managedSession.control_lock = { state: "held", holder_ref: principal.principal_id };
  const environmentOps = ["environment.read", "environment.update"];
  await accessStore.setProfilePolicy({ idempotency_key: "environment-policy", profile_ref: "profile:1", allowed_operations: environmentOps, allowed_origins: ["https://example.com"] });
  const environmentGrant = await accessStore.createGrant({ idempotency_key: "environment-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: environmentOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const environmentRead = { idempotency_key: "environment-read", connection_id: connection.connection_id, grant_id: environmentGrant.grant_id,
    operation: "environment.read", profile_ref: "profile:1", origin: "https://example.com", task_scope: { operations: environmentOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  const sessionReadsBeforeEnvironment = sessionReads;
  const environmentResult = await service.submit(credentialHash, environmentRead);
  assert.equal(environmentResult.status, "succeeded", JSON.stringify(environmentResult));
  assert.equal((environmentResult.result as { status: string }).status, "completed");
  assert.equal(environmentReads, 1);
  assert.equal(sessionReads, sessionReadsBeforeEnvironment, "environment reads do not require or create an Instance session");
  environmentUnavailable = true;
  const unavailableEnvironment = await service.submit(credentialHash, { ...environmentRead, idempotency_key: "environment-unavailable" });
  assert.equal(unavailableEnvironment.status, "failed", "a Harbor unavailable envelope is a failed Core Run, not a successful result");
  assert.equal(unavailableEnvironment.failure?.code, "provider_unavailable");
  environmentUnavailable = false;
  const environmentUpdate = { ...environmentRead, idempotency_key: "environment-update", operation: "environment.update", configuration: { timezone: "Asia/Shanghai" } };
  const environmentUpdated = await service.submit(credentialHash, environmentUpdate);
  assert.equal(environmentUpdated.status, "succeeded", JSON.stringify(environmentUpdated));
  assert.equal(environmentUpdates, 1);
  const observedEnvironment = (await service.submit(credentialHash, { ...environmentRead, idempotency_key: "environment-read-after-update" })).result as { configured: { timezone: string }; effective: { timezone: string }; pending: { timezone: string } };
  assert.equal(observedEnvironment.configured.timezone, "Asia/Shanghai");
  assert.equal(observedEnvironment.effective.timezone, "UTC", "configuration does not masquerade as active effective state");
  assert.equal(observedEnvironment.pending.timezone, "Asia/Shanghai");
  for (const invalidConfiguration of [{}, { timezone: "UTC", unknown: "value" }, { timezone: "x".repeat(129) }]) {
    await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: `environment-invalid-${environmentUpdates}`, configuration: invalidConfiguration }), /managed_browser_invalid_input/);
  }
  assert.equal(environmentUpdates, 1, "invalid configuration does not reach Harbor or mutate the Profile");
  await assert.rejects(service.submit(credentialHash, { ...environmentRead, idempotency_key: "environment-config-on-read", operation: "profile.read", configuration: { timezone: "UTC" } }), /managed_browser_invalid_input/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-denied-task", task_scope: { ...environmentUpdate.task_scope, operations: ["environment.read"] } }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-denied-profile", profile_ref: "profile:2" }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-denied-origin", origin: "https://denied.example" }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-missing-origin", origin: undefined }), /managed_access_origin_required/);
  const lostEnvironment = { ...environmentUpdate, idempotency_key: "environment-lost-response", configuration: { language: "zh-CN" } };
  dropEnvironmentResponse = true;
  const unknownEnvironment = await service.submit(credentialHash, lostEnvironment);
  assert.equal(unknownEnvironment.status, "unknown_outcome");
  assert.equal(environmentUpdates, 2);
  dropEnvironmentResponse = false;
  const reconciledEnvironment = await service.query(credentialHash, unknownEnvironment.run_id);
  assert.equal(reconciledEnvironment.status, "unknown_outcome", "recovery preserves the original lost-response history");
  assert.equal(reconciledEnvironment.reconciliation, "completed");
  assert.equal((reconciledEnvironment.result as { receipt: { configuration: { language: string } } }).receipt.configuration.language, "zh-CN");
  assert.equal(environmentUpdates, 2, "query uses the Runtime receipt and never replays the update");
  assert.deepEqual(await service.submit(credentialHash, lostEnvironment), reconciledEnvironment);
  assert.equal(environmentUpdates, 2, "duplicate submission of an unknown key never replays the update");
  for (const operation of environmentOps) {
    const key = `environment-revoked-in-flight-${operation}`;
    const grant = await accessStore.createGrant({ idempotency_key: key, principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: environmentOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
    const before: { environmentReads: number; environmentUpdates: number; configured: typeof environmentConfigured } = { environmentReads, environmentUpdates, configured: { ...environmentConfigured } };
    afterProfileList = async () => { await accessStore.revokeGrant({ idempotency_key: `${key}-revoke`, grant_id: grant.grant_id }); };
    const refused = await service.submit(credentialHash, { ...environmentRead, idempotency_key: key, grant_id: grant.grant_id, operation, ...(operation === "environment.update" ? { configuration: { timezone: "Asia/Tokyo" } } : {}) });
    afterProfileList = undefined;
    assert.equal(refused.status, "failed", "revocation during Profile lookup must block environment dispatch");
    assert.equal(refused.failure?.code, "managed_access_grant_unavailable");
    assert.deepEqual({ environmentReads, environmentUpdates, configured: environmentConfigured }, before);
  }
  await accessStore.revokeGrant({ idempotency_key: "revoke-environment", grant_id: environmentGrant.grant_id });
  await accessStore.setProfilePolicy({ idempotency_key: "controlled-declaration-after-environment", ...policy, controlled_interaction_origins: [origin] });
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
  const interactionExtraOrigin = "http://127.0.0.1:18795";
  const interactionScopePolicy = { profile_ref: "profile:1", allowed_operations: interactionOps,
    allowed_origins: [origin, interactionExtraOrigin], controlled_interaction_origins: [origin, interactionExtraOrigin] };
  await accessStore.setProfilePolicy({ idempotency_key: "interaction-scope-wide", ...interactionScopePolicy });
  const interactionScopeGrant = await accessStore.createGrant({ idempotency_key: "interaction-scope-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:1"], allowed_operations: interactionOps, allowed_origins: [origin, interactionExtraOrigin],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const interactionScopeRequest = { ...interactive, idempotency_key: "interaction-scope", grant_id: interactionScopeGrant.grant_id,
    task_scope: { operations: interactionOps, profile_refs: ["profile:1"], origins: [interactionExtraOrigin, origin] } };
  afterProfileList = async () => { await accessStore.setProfilePolicy({ idempotency_key: "interaction-scope-narrow", profile_ref: "profile:1",
    allowed_operations: interactionOps, allowed_origins: [origin], controlled_interaction_origins: [origin] }); };
  let interactionScopeResult;
  try {
    interactionScopeResult = await service.submit(credentialHash, interactionScopeRequest);
  } finally {
    afterProfileList = undefined;
  }
  assert.equal(interactionScopeResult.status, "succeeded", JSON.stringify(interactionScopeResult));
  assert.deepEqual(forwardedInteractionOrigins.at(-1), [origin], "interaction forwards the latest checked origin scope");
  await accessStore.revokeGrant({ idempotency_key: "revoke-interaction-scope", grant_id: interactionScopeGrant.grant_id });
  const recoveryOperations = ["recovery.status"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "recovery-status-policy", profile_ref: "profile:1", allowed_operations: [...recoveryOperations], allowed_origins: [] });
  const statusGrant = await accessStore.createGrant({ idempotency_key: "recovery-status-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: [...recoveryOperations], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const recoveryStatusRequest = { idempotency_key: "recovery-status", connection_id: connection.connection_id, grant_id: statusGrant.grant_id,
    operation: "recovery.status" as const, profile_ref: "profile:1", operation_ref: "recovery:target", task_scope: { operations: [...recoveryOperations], profile_refs: ["profile:1"], origins: [] } };
  const recoveryStatusResult = await service.submit(credentialHash, recoveryStatusRequest);
  assert.equal(recoveryStatusResult.status, "succeeded", JSON.stringify(recoveryStatusResult));
  assert.equal(recoveryExpectedProfileRef, "profile:1", "recovery status must enforce the Agent's Profile scope");
  const actualRecoveryService = createManagedRecoveryService({ runRecordStore, harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor" });
  const actualInspection = await actualRecoveryService.inspect({ idempotency_key: "recovery-real-inspect", profile_ref: "profile:owner" });
  assert.equal(actualInspection.ok, true, JSON.stringify(actualInspection));
  const crossProfileRecoveryOperations = ["recovery.status"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "recovery-cross-profile-policy", profile_ref: "profile:other", allowed_operations: [...crossProfileRecoveryOperations], allowed_origins: [] });
  const crossProfileGrant = await accessStore.createGrant({ idempotency_key: "recovery-cross-profile-grant", principal_id: principal.principal_id, profile_refs: ["profile:other"], allowed_operations: [...crossProfileRecoveryOperations], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const actualRecoveryBrowser = createManagedBrowserService({ accessStore, runRecordStore, executionPolicyConfigStore,
    authorizationDecisionStore: createFileAuthorizationDecisionStore({ directory: join(directory, "cross-profile-decisions"), runRecordStore }),
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService: actualRecoveryService });
  const crossProfileResult = await actualRecoveryBrowser.submit(credentialHash, { ...recoveryStatusRequest, idempotency_key: "recovery-real-cross-profile", grant_id: crossProfileGrant.grant_id, profile_ref: "profile:other", operation_ref: actualInspection.operation_ref, task_scope: { operations: [...crossProfileRecoveryOperations], profile_refs: ["profile:other"], origins: [] } });
  assert.equal(crossProfileResult.status, "failed", JSON.stringify(crossProfileResult));
  assert.equal(crossProfileResult.failure?.code, "recovery_operation_not_found", JSON.stringify(crossProfileResult));
  console.log("managed browser Core HTTP boundary self-check passed");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
