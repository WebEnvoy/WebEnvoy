import assert from "node:assert/strict";
import { ManagedAccessError } from "@webenvoy/core-runtime";
import { createApiServer } from "./server.js";
import { createHttpAccountBindingOwnerApiService, type AccountBindingOwnerRequest } from "./account-binding-owner-api.js";

const ownerToken = "owner-account-binding-token-0123456789abcdef";
const agentToken = "a".repeat(32);
const identityEnvironmentRef = "identity:profile:github";
const profileRef = "profile:github";
const runtimeSessionRef = "session:github:one";
const observationRef = "observation:github:one";
const accountSystemRef = "account-system:github";
const accountRef = `account:sha256:${"a".repeat(64)}`;
const boundAt = "2026-09-28T10:00:00.000Z";
const calls: Array<{ operation: string; input?: unknown }> = [];

const service = {
  async inspect(ref: string) {
    calls.push({ operation: "inspect", input: ref });
    return { identity_environment_ref: ref, account_bindings: [], legacy_binding_present: false };
  },
  async bind(input: AccountBindingOwnerRequest) {
    calls.push({ operation: "bind", input });
    return { identity_environment_ref: input.identity_environment_ref, profile_ref: input.profile_ref, account_binding: {
      account_system_ref: input.account_system_ref, account_ref: input.account_ref, observation_ref: input.observation_ref, bound_at: boundAt
    } };
  }
};

const server = createApiServer({ supervisorToken: ownerToken, accountBindingOwnerService: service });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const route = `http://127.0.0.1:${address.port}/owner/account-bindings/operations`;
async function post(input: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(input)
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

try {
  const inspect = { schema_version: "webenvoy.account-binding-owner-operation/v1", operation: "inspect", identity_environment_ref: identityEnvironmentRef };
  assert.equal((await post(inspect)).status, 401);
  assert.equal((await post(inspect, agentToken)).status, 401);
  assert.equal((await post(inspect, ownerToken)).status, 200);
  assert.deepEqual(calls, [{ operation: "inspect", input: identityEnvironmentRef }]);

  const bind = {
    schema_version: "webenvoy.account-binding-owner-operation/v1", operation: "bind",
    identity_environment_ref: identityEnvironmentRef, profile_ref: profileRef, runtime_session_ref: runtimeSessionRef,
    observation_ref: observationRef, account_system_ref: accountSystemRef, account_ref: accountRef,
    idempotency_key: "bind-github-once-001", confirm: true
  };
  const unconfirmed = await post({ ...bind, confirm: undefined }, ownerToken);
  assert.equal(unconfirmed.status, 400);
  assert.equal(calls.length, 1, "an unconfirmed request cannot reach the binding owner");
  const bound = await post(bind, ownerToken);
  assert.equal(bound.status, 200);
  assert.deepEqual((bound.body.result as Record<string, unknown>).account_binding, {
    account_system_ref: accountSystemRef, account_ref: accountRef, observation_ref: observationRef, bound_at: boundAt
  });
  assert.deepEqual(calls.at(-1), { operation: "bind", input: {
    identity_environment_ref: identityEnvironmentRef, profile_ref: profileRef, runtime_session_ref: runtimeSessionRef,
    observation_ref: observationRef, account_system_ref: accountSystemRef, account_ref: accountRef, idempotency_key: "bind-github-once-001"
  } });
  const withCallerHolder = await post({ ...bind, holder_ref: "run:caller" }, ownerToken);
  assert.equal(withCallerHolder.status, 400);
  assert.equal(calls.length, 2, "the owner caller cannot provide Harbor's control holder");
  assert.equal((await fetch(route, { headers: { authorization: `Bearer ${ownerToken}` } })).status, 405);
} finally {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

const harborCalls: Array<{ path: string; method: string; body?: Record<string, unknown>; authorization?: string }> = [];
let sessionFacts: Record<string, unknown> = {
  runtime_session_ref: runtimeSessionRef, identity_environment_ref: identityEnvironmentRef, profile_ref: profileRef,
  lifecycle_state: "active", control_owner: "core_task",
  control_lock: { owner: "core_task", state: "held", holder_ref: "run:harbor-derived" }
};
const harborBinding = { account_system_ref: accountSystemRef, account_ref: accountRef, observation_ref: observationRef, bound_at: boundAt };
const harborFetch: typeof fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
  const authorization = new Headers(init?.headers).get("authorization");
  harborCalls.push({ path: url.pathname, method, ...(body === undefined ? {} : { body }), ...(authorization === null ? {} : { authorization }) });
  if (url.pathname === `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}`) return Response.json(sessionFacts);
  if (url.pathname === `/runtime/identity-environments/${encodeURIComponent(identityEnvironmentRef)}`) {
    return Response.json({ identity_environment_ref: identityEnvironmentRef, account_bindings: [harborBinding], site: { account_ref: "legacy-private-label" } });
  }
  if (url.pathname === `/runtime/identity-environments/${encodeURIComponent(identityEnvironmentRef)}/account-bindings` && method === "POST") {
    return Response.json({ identity_environment_ref: identityEnvironmentRef, account_bindings: [harborBinding], site: { account_ref: null } });
  }
  return Response.json({ error: "not_found" }, { status: 404 });
};
const harbor = createHttpAccountBindingOwnerApiService({
  baseUrl: "http://127.0.0.1:8788", supervisorToken: "harbor-supervisor-token-0123456789abcdef", fetch: harborFetch
});
const request: AccountBindingOwnerRequest = {
  identity_environment_ref: identityEnvironmentRef, profile_ref: profileRef, runtime_session_ref: runtimeSessionRef,
  observation_ref: observationRef, account_system_ref: accountSystemRef, account_ref: accountRef, idempotency_key: "bind-github-once-001"
};
assert.deepEqual(await harbor.bind(request), {
  identity_environment_ref: identityEnvironmentRef, profile_ref: profileRef, account_binding: harborBinding
});
assert.deepEqual(harborCalls.map(call => [call.method, call.path]), [
  ["GET", `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}`],
  ["POST", `/runtime/identity-environments/${encodeURIComponent(identityEnvironmentRef)}/account-bindings`]
]);
assert.equal(harborCalls[0]?.authorization, "Bearer harbor-supervisor-token-0123456789abcdef");
assert.deepEqual(harborCalls[1]?.body, {
  observation_ref: observationRef, runtime_session_ref: runtimeSessionRef, account_system_ref: accountSystemRef, account_ref: accountRef,
  idempotency_key: "bind-github-once-001", holder_ref: "run:harbor-derived"
});

harborCalls.length = 0;
sessionFacts = { ...sessionFacts, control_lock: { owner: "user", state: "held", holder_ref: "user:holder" } };
await assert.rejects(harbor.bind(request), (error: unknown) => error instanceof ManagedAccessError && error.code === "account_binding_control_not_held");
assert.deepEqual(harborCalls.map(call => call.method), ["GET"], "an unheld Core lease cannot reach Harbor's binding mutation");

const inspected = await harbor.inspect(identityEnvironmentRef) as Record<string, unknown>;
assert.equal(inspected.legacy_binding_present, true);
assert.equal(JSON.stringify(inspected).includes("legacy-private-label"), false, "inspection does not expose the legacy raw account label");

console.log("Validated owner-only account binding, explicit confirmation, Core-derived Harbor holder, and read projection.");
