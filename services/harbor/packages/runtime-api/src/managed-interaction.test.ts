import assert from "node:assert/strict";
import test, { after } from "node:test";
import { HarborRuntime, createFixtureLauncher, type LocalProviderLauncher } from "./index.js";
import { identityInput, isolateProfileStorage } from "./identity-environment-mutation-test-helpers.js";
import { trustManagedInteractionOperation, type ManagedInteractionInput, type ManagedInteractionResult } from "./managed-interaction.js";
import type { ManagedInteractionRequest } from "./managed-interaction-request.js";
import { RuntimeSessionStore } from "./runtime-session.js";
import { startHarborRuntimeServer } from "./server.js";

after(isolateProfileStorage("managed-interaction"));
const origin = "http://127.0.0.1:43129";
const holder = "principal:fixture";
const scope = { holder_ref: holder, expected_origin: origin, controlled_origin: origin };

// Fixture checks Runtime/HTTP contracts only; no real Provider or browser is exercised.
async function setup(before?: (input: ManagedInteractionInput, profile: string) => Promise<void>) {
  const calls: { profile: string; input: ManagedInteractionInput }[] = [];
  const launcher: LocalProviderLauncher = async input => {
    const ready = await createFixtureLauncher("ready")(input);
    if (ready.status !== "ready") throw new Error("fixture unavailable");
    let version = 0;
    return { ...ready, execution_surface: "local_provider", interaction: trustManagedInteractionOperation(async action => {
      calls.push({ profile: input.profile_ref, input: action });
      await before?.(action, input.profile_ref);
      version++;
      return { status: "completed", dispatch_state: "dispatched", page: { current_url: `${origin}/fixture`, title: `fixture:${version}`, status: "ready", facts: [] },
        snapshot: { page_ref: `page:${input.profile_ref}`, observation_ref: `observation:${input.profile_ref}:${version}`, controls: [{ target_ref: "target:field", role: "textbox", name: "测试字段", enabled: true }], text: "non-sensitive fixture", truncated: false } };
    }) };
  };
  const runtime = new HarborRuntime(launcher);
  const refs: string[] = [];
  for (const suffix of ["a", "b", "bound"]) {
    runtime.createLocalIdentityEnvironment({ ...identityInput(`identity:${suffix}`, `profile:${suffix}`),
      site: { site_id: "controlled", origin, display_name: "Fixture", ...(suffix === "bound" ? { account_ref: "account:fixture" } : {}) } });
    const session = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: `identity:${suffix}`, url: `${origin}/fixture`, control_owner: "core_task", holder_ref: holder, operation_scope: "profile_management" });
    if ("status" in session) throw new Error("fixture session unavailable");
    refs.push(session.runtime_session_ref);
  }
  const a = refs[0]!, b = refs[1]!, bound = refs[2]!;
  let sequence = 0;
  const request = (action: ManagedInteractionRequest["action"], extra: Record<string, unknown> = {}) => ({ ...scope, operation_ref: `operation:${++sequence}`, action, ...extra });
  const snapshot = async (ref = a) => {
    const result = await runtime.operateManagedInteraction(ref, request("snapshot"));
    assert.equal(result.status, "completed");
    assert.ok("snapshot" in result && result.snapshot);
    return { page_ref: result.snapshot.page_ref, observation_ref: result.snapshot.observation_ref };
  };
  return { runtime, calls, a, b, bound, request, snapshot, close: async () => { for (const ref of refs) await runtime.stopSession(ref); } };
}

function refused(result: ManagedInteractionResult, failure: string) {
  assert.equal(result.status, "unavailable");
  assert.equal(result.dispatch_state, "not_dispatched");
  assert.equal(result.failure_class, failure);
}

test("Core snapshot page_ref is accepted and stale Page refs are refused before Provider dispatch", async () => {
  const f = await setup();
  try {
    const observed = await f.snapshot();
    const accepted = await f.runtime.operateManagedInteraction(f.a, f.request("snapshot", { page_ref: observed.page_ref }));
    assert.equal(accepted.status, "completed");
    const callsBeforeStale = f.calls.length;
    refused(await f.runtime.operateManagedInteraction(f.a, f.request("snapshot", { page_ref: "page:wrong" })), "managed_interaction_observation_stale");
    assert.equal(f.calls.length, callsBeforeStale);
  } finally { await f.close(); }
});

test("fixture HTTP interaction rejects unprivileged callers and malformed scope/actions without dispatch; receipts require supervisor", async () => {
  const f = await setup();
  const token = Buffer.alloc(32, 23).toString("base64url");
  const server = await startHarborRuntimeServer({ port: 0, runtime: f.runtime, manual_authentication_supervisor_token: token });
  const path = `${server.url}/runtime/sessions/${encodeURIComponent(f.a)}/interactions`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const post = (body: unknown) => fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    const input = f.request("snapshot");
    assert.equal((await fetch(path, { method: "POST", body: JSON.stringify(input) })).status, 403);
    assert.equal((await fetch(path, { method: "POST", headers: { authorization: "Bearer ordinary-agent" }, body: JSON.stringify(input) })).status, 403);
    for (const invalid of [null, [], { ...input, arbitrary: "unsupported" }, { ...input, controlled_origin: "https://other.invalid" },
      { ...input, expected_origin: `${origin}/path`, controlled_origin: `${origin}/path` },
      { ...input, expected_origin: "https://creator.xiaohongshu.com", controlled_origin: "https://creator.xiaohongshu.com" },
      { ...input, holder_ref: "" }, { ...input, operation_ref: "" }, { ...input, action: "execute" },
      f.request("click", { page_ref: "p", observation_ref: "o" }),
      f.request("input", { page_ref: "p", observation_ref: "o", target_ref: "t", text: "x".repeat(513) }),
      f.request("input", { page_ref: "p", observation_ref: "o", target_ref: "t", text: "line\nbreak" }),
      f.request("press", { page_ref: "p", observation_ref: "o", target_ref: "t", key: "Control+V" }),
      f.request("scroll", { page_ref: "p", observation_ref: "o", delta_y: 2001 }),
      f.request("wait", { page_ref: "p", observation_ref: "o", wait_for: "text", text: "ready", timeout_ms: 10_001 }),
      f.request("wait", { page_ref: "p", observation_ref: "o", wait_for: "enabled" })]) {
      const response = await post(invalid);
      assert.equal(response.status, 409);
      refused(await response.json() as ManagedInteractionResult, "managed_interaction_invalid_input");
    }
    assert.equal(f.calls.length, 0);
    const response = await post(input);
    assert.equal(response.status, 200);
    const result = await response.json();
    const receiptPath = `${server.url}/runtime/managed-interactions/${encodeURIComponent(input.operation_ref)}`;
    assert.equal((await fetch(receiptPath)).status, 403);
    assert.deepEqual(await fetch(receiptPath, { headers }).then(r => r.json()), result);
    assert.deepEqual(await (await post(input)).json(), result);
    assert.equal(f.calls.length, 1);
    assert.equal((await fetch(`${server.url}/runtime/managed-interactions/missing`, { headers })).status, 404);
    const conflict = await post({ ...input, action: "snapshot", expected_origin: "https://other.invalid", controlled_origin: "https://other.invalid" });
    refused(await conflict.json() as ManagedInteractionResult, "managed_interaction_idempotency_conflict");
  } finally { await server.close(); await f.close(); }
});

test("fixture interaction requires matching holder, lease, Page and observation; bound identity rejects and handoff isolates the other Profile", async () => {
  const f = await setup();
  try {
    const observed = await f.snapshot();
    const input = () => f.request("input", { ...observed, target_ref: "target:field", text: "test" });
    for (const [ref, body, failure] of [
      ["session:missing", input(), "session_missing"],
      [f.bound, f.request("snapshot"), "managed_interaction_identity_required"],
      [f.a, { ...input(), holder_ref: "principal:other" }, "control_lock_conflict"],
      [f.a, { ...input(), page_ref: "page:wrong" }, "managed_interaction_observation_stale"],
      [f.a, { ...input(), observation_ref: "observation:wrong" }, "managed_interaction_observation_stale"],
      [f.b, input(), "managed_interaction_observation_stale"],
    ] as const) refused(await f.runtime.operateManagedInteraction(ref, body), failure);
    assert.equal(f.calls.length, 1);
    assert.equal("status" in f.runtime.recordHandoff(f.a, { control_owner: "user", handoff_reason: "user_requested" }), false);
    refused(await f.runtime.operateManagedInteraction(f.a, input()), "control_lock_conflict");
    const bObserved = await f.snapshot(f.b);
    assert.equal((await f.runtime.operateManagedInteraction(f.b, f.request("input", { ...bObserved, target_ref: "target:field", text: "other Profile" }))).status, "completed");
    assert.equal("status" in f.runtime.releaseSession(f.a, { control_owner: "user" }), false);
    refused(await f.runtime.operateManagedInteraction(f.a, input()), "control_lock_conflict");
    assert.equal("status" in f.runtime.lockSession(f.a, { control_owner: "core_task", holder_ref: holder }), false);
    refused(await f.runtime.operateManagedInteraction(f.a, input()), "managed_interaction_observation_stale");
    const fresh = await f.snapshot();
    assert.notEqual(fresh.observation_ref, observed.observation_ref);
    for (const [action, extra] of [["click", { target_ref: "target:field" }], ["input", { target_ref: "target:field", text: "changed" }],
      ["press", { target_ref: "target:field", key: "Enter" }], ["scroll", { delta_y: 300 }], ["wait", { wait_for: "text", text: "ready", timeout_ms: 50 }]] as const) {
      const current = await f.snapshot();
      const result = await f.runtime.operateManagedInteraction(f.a, f.request(action, { ...current, ...extra }));
      assert.equal(result.status, "completed");
      assert.ok("runtime_session_ref" in result && result.runtime_session_ref === f.a);
    }
    assert.ok(f.calls.filter(call => call.profile === "profile:a").at(-1)!.input.control_generation > f.calls[0]!.input.control_generation);
  } finally { await f.close(); }
});

for (const lost of [false, true]) test(`fixture in-flight interaction blocks handoff and stale completion cannot overwrite stopped facts (${lost ? "throw" : "response"})`, async () => {
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = await setup(async action => { if (action.action === "input") { started(); await gate; if (lost) throw new Error("private fixture driver error"); } });
  try {
    const observed = await f.snapshot();
    const input = f.request("input", { ...observed, target_ref: "target:field", text: "pending" });
    const pending = f.runtime.operateManagedInteraction(f.a, input);
    await entered;
    const store = (f.runtime as unknown as { runtimeSessions: RuntimeSessionStore }).runtimeSessions;
    const record = store.getRecord(f.a)!;
    const generation = record.control_generation;
    for (const result of [f.runtime.recordHandoff(f.a, { control_owner: "user" }), f.runtime.releaseSession(f.a, { control_owner: "core_task" }), f.runtime.lockSession(f.a, { control_owner: "user" })]) {
      assert.ok("failure_class" in result && result.failure_class === "session_locked");
    }
    assert.equal(record.control_generation, generation);
    assert.equal(record.active_provider_interactions, 1);
    const inProgress = f.runtime.getManagedInteraction(input.operation_ref);
    assert.equal(inProgress?.status, "unknown_outcome");
    assert.equal(inProgress?.dispatch_state, "dispatched");
    assert.deepEqual(await f.runtime.operateManagedInteraction(f.a, input), inProgress);
    refused(await f.runtime.operateManagedInteraction(f.a, f.request("snapshot")), "session_not_ready");
    await f.snapshot(f.b);
    assert.equal(f.calls.filter(call => call.input.action === "input").length, 1);
    await f.runtime.stopSession(f.a);
    const stopped = f.runtime.getSession(f.a);
    assert.equal(stopped?.lifecycle_state, "closed");
    finish();
    const result = await pending;
    assert.equal(result.status, "unknown_outcome");
    assert.equal(result.dispatch_state, "dispatched");
    assert.equal(result.failure_class, lost ? "managed_interaction_outcome_unknown" : "managed_interaction_control_changed");
    assert.deepEqual(f.runtime.getSession(f.a), stopped);
    assert.equal(record.active_provider_interactions, 0);
    assert.equal(JSON.stringify(result).includes("private fixture"), false);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(f.runtime.getManagedInteraction(input.operation_ref), result);
      assert.deepEqual(await f.runtime.operateManagedInteraction(f.a, input), result);
    }
    assert.equal(f.calls.filter(call => call.input.action === "input").length, 1);
  } finally { finish(); await f.close(); }
});

test("fixture dispatched exception preserves unknown receipt and requires a fresh snapshot without replaying input", async () => {
  const f = await setup(async action => { if (action.action === "input") throw new Error("private fixture driver error"); });
  const token = Buffer.alloc(32, 29).toString("base64url");
  const server = await startHarborRuntimeServer({ port: 0, runtime: f.runtime, manual_authentication_supervisor_token: token });
  try {
    const observed = await f.snapshot();
    const input = f.request("input", { ...observed, target_ref: "target:field", text: "test" });
    const result = await f.runtime.operateManagedInteraction(f.a, input);
    assert.equal(result.status, "unknown_outcome");
    assert.equal(result.dispatch_state, "dispatched");
    assert.equal(result.failure_class, "managed_interaction_outcome_unknown");
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.deepEqual(f.runtime.getManagedInteraction(input.operation_ref), result);
      const receipt = await fetch(`${server.url}/runtime/managed-interactions/${encodeURIComponent(input.operation_ref)}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(receipt.status, 200);
      assert.deepEqual(await receipt.json(), result);
      assert.deepEqual(await f.runtime.operateManagedInteraction(f.a, input), result);
    }
    refused(await f.runtime.operateManagedInteraction(f.a, f.request("click", { ...observed, target_ref: "target:field" })), "managed_interaction_observation_stale");
    const fresh = await f.snapshot();
    assert.notEqual(fresh.observation_ref, observed.observation_ref);
    assert.equal(f.calls.filter(call => call.input.action === "input").length, 1);
  } finally { await server.close(); await f.close(); }
});
