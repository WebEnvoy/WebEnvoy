import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManagedBrowserService, createFileRunRecordStore, createFileAuthorizationDecisionStore, createFileExecutionPolicyConfigStore, createFileManagedAccessStore } from "@webenvoy/core-runtime";
import { createApiServer } from "./server.js";
import { listen, closeServer } from "./self-check-process-support.js";

export async function assertManagedAccessApi(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-managed-api-"));
  const owner = "owner_test_credential_00000000000000000000";
  const agent = "agent_test_credential_00000000000000000000";
  const hash = createHash("sha256").update(agent).digest("hex");
  const access = createFileManagedAccessStore({ directory });
  let dispatches = 0;
  const server = createApiServer({ supervisorToken: owner, managedAccessStore: access, managedBrowserService: {
    async submit(credentialHash) { assert.equal(credentialHash, hash); dispatches++; return { ok: true, run_id: "managed-run", status: "succeeded" }; },
    async query(credentialHash, runId) { assert.equal(credentialHash, hash); assert.equal(runId, "managed-run"); return { ok: true, run_id: runId, status: "succeeded" }; },
  } });
  const port = await listen(server);
  const call = async (path: string, token?: string, input?: unknown) => {
    const result = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers: { ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }), ...(input === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: result.status, body: await result.json() as Record<string, any> };
  };
  try {
    assert.equal((await call("/health")).status, 200);
    for (const path of ["/agent-access", "/runs/missing", "/execution-policy-configs/global", "/threads"]) {
      assert.equal((await call(path)).status, 401);
      assert.equal((await call(path, agent)).status, 401);
    }
    const input = { idempotency_key: "register", display_name: "Test Agent", credential_hash: hash };
    const registered = await call("/agent-access/principals", owner, input);
    assert.equal(registered.status, 201);
    const principal = registered.body.principal;
    assert.equal(JSON.stringify(registered.body).includes(hash), false);
    assert.deepEqual((await call("/agent-access/principals", owner, input)).body, registered.body);
    assert.equal((await call("/agent-access/operations/register", owner)).body.operation.status, "completed");
    assert.equal((await call("/agent-access/operations/missing", owner)).status, 404);
    const connected = await call("/agent-connections", agent, {});
    assert.equal(connected.status, 201);
    assert.equal(connected.body.connection.principal_id, principal.principal_id);
    assert.equal((await call("/agent-connections", owner, {})).status, 401);
    const grant = await call("/agent-access/grants", owner, {
      idempotency_key: "grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.list"], allowed_origins: ["https://example.com"],
      expires_at: new Date(Date.now() + 60_000).toISOString(), creation_template: null, max_created_profiles: 0,
    });
    assert.equal(grant.status, 201);
    const policy = { idempotency_key: "profile-policy", profile_ref: "profile:test", allowed_operations: ["instance.snapshot", "instance.input"], allowed_origins: ["http://127.0.0.1:18794"], controlled_interaction_origins: ["http://127.0.0.1:18794"] };
    assert.equal((await call("/agent-access/profile-policies", agent, policy)).status, 401);
    const ownerPolicy = await call("/agent-access/profile-policies", owner, policy);
    assert.equal(ownerPolicy.status, 200);
    assert.deepEqual(ownerPolicy.body.profile_policy.controlled_interaction_origins, policy.controlled_interaction_origins);
    assert.equal((await call("/agent-access/operations/profile-policy", owner)).body.operation.status, "completed");
    const reconnected = await call("/agent-connections", agent, {});
    assert.deepEqual(reconnected.body.grants, [grant.body.grant]);
    assert.notEqual(reconnected.body.connection.connection_id, connected.body.connection.connection_id);
    const secondCredential = "another-agent-credential-long-enough";
    await call("/agent-access/principals", owner, { ...input, idempotency_key: "register-second", credential_hash: createHash("sha256").update(secondCredential).digest("hex") });
    assert.deepEqual((await call("/agent-connections", secondCredential, {})).body.grants, []);
    assert.equal((await call("/agent-access/grants", agent, {})).status, 401);
    for (const path of ["/owner/recovery/backup", "/owner/recovery/apply"]) {
      assert.equal((await call(path, agent, {})).status, 401);
      const ownerResponse = await call(path, owner, {});
      assert.equal(ownerResponse.status, 503);
      assert.equal(ownerResponse.body.error.code, "recovery_unavailable");
    }
    assert.equal((await call("/managed-browser/operations", agent, {})).body.ok, true);
    assert.equal((await call("/managed-browser/operations/managed-run", agent)).body.run_id, "managed-run");
    assert.equal((await call("/managed-browser/operations", undefined, {})).status, 401);
    assert.equal(dispatches, 1);
    const revoked = await call(`/agent-access/grants/${encodeURIComponent(grant.body.grant.grant_id)}/revoke`, owner, { idempotency_key: "revoke" });
    assert.equal(revoked.status, 200);
    assert((await call("/agent-access", owner)).body.grants[0].revoked_at);
    assert((await call("/agent-access/operations/revoke", owner)).body.operation.result.revoked_at);
    const duplicateStatus = await new Promise<number>(resolve => {
      const request = httpRequest({ host: "127.0.0.1", port, path: "/agent-access", headers: ["Host", `127.0.0.1:${port}`, "Authorization", `Bearer ${owner}`, "Authorization", `Bearer ${owner}`] }, response => { response.resume(); resolve(response.statusCode ?? 0); });
      request.end();
    });
    assert.equal(duplicateStatus, 401);
    await call(`/agent-access/principals/${encodeURIComponent(principal.principal_id)}/revoke`, owner, { idempotency_key: "revoke-principal" });
    assert.equal((await call("/managed-browser/operations", agent, {})).status, 401);
    assert.equal(dispatches, 1);
    assert.equal(JSON.stringify((await call("/agent-access", owner)).body).includes(agent), false);
    const unconfigured = createApiServer({ managedAccessStore: access });
    const unconfiguredPort = await listen(unconfigured);
    try { assert.equal((await fetch(`http://127.0.0.1:${unconfiguredPort}/agent-access`)).status, 401); }
    finally { await closeServer(unconfigured); }
    await assertManagementPolicyApi();
    console.log("Validated owner/Agent API authentication, duplicate-header rejection, redacted receipts and revocation.");
  } finally {
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
}


async function assertManagementPolicyApi(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-management-policy-"));
  const owner = "owner_policy_credential_000000000000000000";
  const agent = "agent_policy_credential_000000000000000000";
  let creates = 0;
  const harbor = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${owner}`);
    response.setHeader("content-type", "application/json");
    if (request.url === "/runtime/managed-operation-catalog") response.end(JSON.stringify({
      schema_version: "webenvoy.harbor-operation-catalog.v0", catalog_ref: "harbor://managed-operations", catalog_version: "1",
      operations: [{ operation_id: "profile.create", category: "commit", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile"] }]
    }));
    else if (request.url === "/runtime/identity-environment-mutations") {
      request.resume(); creates++;
      response.end(JSON.stringify({ status: "completed", record: { refs: { profile_ref: "profile:policy" }, identity_environment_ref: "identity:policy", site: { origin: "https://example.com" }, status: { readiness: "ready" } } }));
    } else { response.writeHead(404); response.end("{}"); }
  });
  const harborPort = await listen(harbor);
  const access = createFileManagedAccessStore({ directory: join(directory, "access") });
  const runs = createFileRunRecordStore({ directory: join(directory, "runs") });
  const policy = createFileExecutionPolicyConfigStore({ directory: join(directory, "policy") });
  const service = createManagedBrowserService({ accessStore: access, runRecordStore: runs, executionPolicyConfigStore: policy,
    authorizationDecisionStore: createFileAuthorizationDecisionStore({ directory: join(directory, "decisions"), runRecordStore: runs }),
    harborBaseUrl: `http://127.0.0.1:${harborPort}`, supervisorToken: owner });
  const server = createApiServer({ supervisorToken: owner, managedAccessStore: access, managedBrowserService: service });
  const port = await listen(server);
  const call = async (path: string, token: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  try {
    const registered = await call("/agent-access/principals", owner, "POST", { idempotency_key: "register", display_name: "Policy Test", credential_hash: createHash("sha256").update(agent).digest("hex") });
    assert.equal(registered.status, 201);
    const connected = await call("/agent-connections", agent, "POST", {});
    const granted = await call("/agent-access/grants", owner, "POST", { idempotency_key: "grant", principal_id: registered.body.principal.principal_id,
      profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1,
      creation_template: { template_ref: "template:policy", provider_id: "camoufox", site: { site_id: "public", origin: "https://example.com", display_name: "Public" }, language: "en-US", timezone: "UTC", permission_ceiling: { allowed_operations: ["profile.read"], allowed_origins: ["https://example.com"] } } });
    assert.equal(granted.status, 201);
    const operation = { idempotency_key: "before-policy", connection_id: connected.body.connection.connection_id, grant_id: granted.body.grant.grant_id,
      operation: "profile.create", template_ref: "template:policy", task_scope: { operations: ["profile.create"], profile_refs: [], origins: ["https://example.com"] } };
    const before = await call("/managed-browser/operations", agent, "POST", operation);
    assert.equal(before.body.failure.code, "managed_browser_policy_refused");
    const denied = await call("/managed-browser/operations", agent, "POST", { ...operation, idempotency_key: "denied-scope", task_scope: { ...operation.task_scope, operations: [] } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, "managed_access_denied");
    assert.equal(denied.body.dispatch_state, "not_dispatched");
    assert.equal(creates, 0);
    const path = "/agent-access/management-policy";
    assert.deepEqual((await call(path, owner)).body, { ok: true, configuration: null });
    const mutation = { schema_version: "webenvoy.execution-policy-mutation.v0", idempotency_key: "allow-management", expected_source_version: null, modes: { read: "auto", commit: "auto" } };
    assert.equal((await call(path, agent)).status, 401);
    assert.equal((await call(path, agent, "PUT", mutation)).status, 401);
    assert.equal((await call(path, owner, "PUT", { ...mutation, modes: { destructive: "auto" } })).status, 400);
    const updated = await call(path, owner, "PUT", mutation);
    assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.equal(updated.body.configuration.source, "installed_skill_user_version");
    assert.equal(updated.body.configuration.skill_ref, "harbor:managed-browser");
    assert.equal(updated.body.configuration.source_version, "1");
    assert.deepEqual((await call(path, owner, "PUT", mutation)).body, updated.body);
    assert.deepEqual((await call(path, owner)).body, updated.body);
    const conflict = await call(path, owner, "PUT", { ...mutation, idempotency_key: "stale-policy" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.current.source_version, "1");
    assert.equal((await call(path, owner, "PUT", { ...mutation, modes: { commit: "deny" } })).status, 409);
    const after = await call("/managed-browser/operations", agent, "POST", { ...operation, idempotency_key: "after-policy" });
    assert.equal(after.body.status, "succeeded", JSON.stringify(after));
    assert.equal(creates, 1);
    assert.equal(await policy.getGlobalConfiguration(), undefined, "scoped management policy must not modify global business policy");
    assert.equal((await policy.resolveSources({ skill_ref: "other:business" })).installed_skill_user_version, undefined);
    await call(`/agent-access/grants/${encodeURIComponent(granted.body.grant.grant_id)}/revoke`, owner, "POST", { idempotency_key: "revoke-policy-grant" });
    const revoked = await call("/managed-browser/operations", agent, "POST", { ...operation, idempotency_key: "after-revoke" });
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body.error.code, "managed_access_grant_unavailable");
    assert.equal(revoked.body.dispatch_state, "not_dispatched");
    assert.equal(creates, 1);
    console.log("Validated owner-scoped management policy, default refusal, CAS/idempotency, Agent rejection and unchanged global policy.");
  } finally { await closeServer(server); await closeServer(harbor); await rm(directory, { recursive: true, force: true }); }
}
