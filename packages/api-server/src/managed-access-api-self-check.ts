import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileManagedAccessStore } from "@webenvoy/core-runtime";
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
    assert.equal((await call("/agent-access/grants", agent, {})).status, 401);
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
    console.log("Validated owner/Agent API authentication, duplicate-header rejection, redacted receipts and revocation.");
  } finally {
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
}
