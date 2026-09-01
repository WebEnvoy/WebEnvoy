import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, taskTurnInputSchemaVersion, type FileAuthorizationDecisionStore, type RunRecord, type TaskTurnInputPolicyResolver } from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";
import { createApiServer } from "./server.js";
import { handleTaskThreadApi, takePendingWritePrecheckContinuation, withWritePrecheckRunLock } from "./task-thread-api.js";

function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(body: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

const packageRef = "lode://site-capability/test/thread@0.1.0";
const inputSchemaRef = "lode://schema/test/thread-input@0.1.0";
const resolveInputPolicy: TaskTurnInputPolicyResolver = async ({ package_ref, capability_ref }) => ({
  package_ref,
  capability_ref,
  input_schema_ref: inputSchemaRef,
  fields: new Map([["keyword", { field_id: "keyword", projection: "safe_summary" }]])
});

async function waitForTurn(store: ReturnType<typeof createFileTaskThreadStore>, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await store.getTaskThread(threadId))?.turns.length === 1) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for in-flight turn");
}

async function assertInFlightReplay(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-thread-api-in-flight-"));
  const runDirectory = join(directory, "runs");
  const runStore = createFileRunRecordStore({ directory: runDirectory });
  const store = createFileTaskThreadStore({ directory: join(directory, "threads"), runRecordStore: runStore, resolveInputPolicy });
  let releaseSubmit: (() => void) | undefined;
  const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  try {
    const created = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/in-flight",
      identity_environment_ref: "identity-env_111111111111111111111111"
    });
    const body = {
      idempotency_key: "submit-in-flight",
      run_id: "run_api_in_flight",
      package_ref: packageRef,
      input_snapshot: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "keyword", kind: "scalar", summary: "AI tools" }]
      },
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/in-flight", source_ref: packageRef } },
      harbor: { identity_environment_ref: "identity-env_111111111111111111111111" }
    };
    const submit = handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns`,
      body,
      store,
      validateTask: async () => undefined,
      submitTask: async (_request, claimToken) => {
        await submitGate;
        await runStore.createRunRecord({
          run_id: body.run_id,
          task_intent_ref: "intent:in-flight",
          entrypoint_ref: "entrypoint:app",
          capability_ref: "lode:capability/in-flight",
          admission: { decision: "accepted", action_risk: "read" }
        }, claimToken);
        return { status: 202, body: { ok: true }, run_record_present: true };
      }
    });
    await waitForTurn(store, created.thread.thread_id);
    const inFlight = (await store.getTaskThread(created.thread.thread_id))!.turns[0]!;
    assert.equal(inFlight.status, "submitting");
    assert.equal(inFlight.package_ref, packageRef);
    assert.equal(inFlight.input_schema_ref, inputSchemaRef);

    const terminate = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns/${inFlight.turn_id}/terminate`,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("unexpected submit"); }
    });
    assert.equal(terminate.handled && terminate.status, 409);

    const replay = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns`,
      body,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("replay must not resubmit"); }
    });
    assert(replay.handled);
    assert.equal(replay.status, 202);
    assert.equal(replay.body.pending, true);
    assert.equal(replay.body.outcome, "submission_in_flight");
    assert.equal(record(replay.body.turn).turn_id, inFlight.turn_id);
    assert.equal(record(replay.body.turn).package_ref, packageRef);
    assert.equal(record(replay.body.turn).input_schema_ref, inputSchemaRef);
    assert.equal(record(replay.body.thread).thread_id, created.thread.thread_id);

    releaseSubmit!();
    const completed = await submit;
    assert(completed.handled);
    assert.equal(completed.status, 202);
    assert.equal(record(completed.body.turn).turn_id, inFlight.turn_id);
    assert.equal((await store.getTaskThread(created.thread.thread_id))?.turns.length, 1);

    const recoveredThread = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/recovered",
      identity_environment_ref: "identity-env_222222222222222222222222"
    });
    const recoveredBody = {
      ...body,
      idempotency_key: "submit-recovered",
      run_id: "run_api_recovered",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/recovered", source_ref: packageRef } },
      harbor: {
        identity_environment_ref: "identity-env_222222222222222222222222",
        session: { cookie: "must-not-enter-continuation" }
      }
    };
    const recoveredTurn = await store.reserveTaskTurn(recoveredThread.thread.thread_id, {
      idempotency_key: recoveredBody.idempotency_key,
      request_hash: requestHash(recoveredBody),
      run_id: recoveredBody.run_id,
      creation_channel: "app",
      package_ref: packageRef,
      input: recoveredBody.input_snapshot
    });
    await runStore.createRunRecord({
      run_id: recoveredBody.run_id,
      task_intent_ref: "intent:recovered",
      entrypoint_ref: "entrypoint:app",
      capability_ref: "lode:capability/recovered",
      admission: { decision: "accepted", action_risk: "read" }
    }, recoveredTurn.run_claim_token);
    const recoveredReplay = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${recoveredThread.thread.thread_id}/turns`,
      body: recoveredBody,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("recovered replay must not resubmit"); }
    });
    assert(recoveredReplay.handled);
    assert.equal(recoveredReplay.status, 202);
    assert.equal(recoveredReplay.body.ok, true);
    assert.equal(recoveredReplay.body.outcome, "submission_recovered");
    assert.equal(record(recoveredReplay.body.turn).run_status, "pending");

    const waitingThread = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/waiting-recovered",
      identity_environment_ref: "identity-env_333333333333333333333333"
    });
    const waitingBody = {
      ...body,
      idempotency_key: "submit-waiting-recovered",
      run_id: "run_api_waiting_recovered",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/waiting-recovered", source_ref: packageRef } },
      harbor: { identity_environment_ref: "identity-env_333333333333333333333333" }
    };
    const waitingTurn = await store.reserveTaskTurn(waitingThread.thread.thread_id, {
      idempotency_key: waitingBody.idempotency_key,
      request_hash: requestHash(waitingBody),
      run_id: waitingBody.run_id,
      creation_channel: "app",
      package_ref: packageRef,
      input: waitingBody.input_snapshot
    });
    await runStore.createRunRecord({
      run_id: waitingBody.run_id,
      task_intent_ref: "intent:waiting-recovered",
      entrypoint_ref: "entrypoint:app",
      capability_ref: "lode:capability/waiting-recovered",
      status: "requires_user_action",
      admission: { decision: "requires_user_action", action_risk: "read" },
      failure: {
        category: "resource_admission",
        code: "identity_login_required",
        phase: "runtime_binding",
        recovery_hint: "restore_identity_login"
      }
    }, waitingTurn.run_claim_token);
    const waitingReplay = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${waitingThread.thread.thread_id}/turns`,
      body: waitingBody,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("waiting replay must not resubmit"); }
    });
    assert(waitingReplay.handled);
    assert.equal(waitingReplay.status, 503);
    assert.equal(waitingReplay.body.ok, false);
    assert.equal(waitingReplay.body.outcome, "submission_requires_user_action");
    assert.equal(record(waitingReplay.body.error).code, "identity_login_required");
    assert.equal(record(waitingReplay.body.turn).status, "waiting_for_user");

    const interruptedThread = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/interrupted",
      identity_environment_ref: "identity-env_444444444444444444444444"
    });
    const interruptedBody = {
      ...body,
      idempotency_key: "submit-interrupted",
      run_id: "run_api_interrupted",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/interrupted", source_ref: packageRef } },
      harbor: { identity_environment_ref: "identity-env_444444444444444444444444" }
    };
    const interrupted = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${interruptedThread.thread.thread_id}/turns`,
      body: interruptedBody,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("submission transport interrupted"); }
    });
    assert(interrupted.handled);
    assert.equal(interrupted.status, 500);
    assert.equal(record(interrupted.body.error).code, "task_submission_interrupted");
    assert.equal(record(interrupted.body.turn).status, "status_unknown");
    assert.equal(record(interrupted.body.turn).submission_state, "accepted");
    const interruptedReplay = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${interruptedThread.thread.thread_id}/turns`,
      body: interruptedBody,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("interrupted replay must not resubmit"); }
    });
    assert(interruptedReplay.handled);
    assert.equal(interruptedReplay.status, 500);
    assert.equal(interruptedReplay.body.replayed, true);
    assert.deepEqual(interruptedReplay.body.error, interrupted.body.error);

    const unknownThread = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/unknown-replay",
      identity_environment_ref: "identity-env_555555555555555555555555"
    });
    const unknownBody = {
      ...body,
      idempotency_key: "submit-unknown-replay",
      run_id: "run_api_unknown_replay",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/unknown-replay", source_ref: packageRef } },
      harbor: { identity_environment_ref: "identity-env_555555555555555555555555" }
    };
    const unknownTurn = await store.reserveTaskTurn(unknownThread.thread.thread_id, {
      idempotency_key: unknownBody.idempotency_key,
      request_hash: requestHash(unknownBody),
      run_id: unknownBody.run_id,
      creation_channel: "app",
      package_ref: packageRef,
      input: unknownBody.input_snapshot
    });
    const claimPath = join(`${runDirectory}.run-id-claims`, `${unknownBody.run_id}.claim`);
    const claim = JSON.parse(await readFile(claimPath, "utf8")) as Record<string, unknown>;
    await writeFile(claimPath, `${JSON.stringify({ ...claim, pid: 2_147_483_647 })}\n`, "utf8");
    assert.equal((await store.getTaskThread(unknownThread.thread.thread_id))?.turns[0]?.status, "status_unknown");
    const unknownReplay = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${unknownThread.thread.thread_id}/turns`,
      body: unknownBody,
      store,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("unknown replay must not resubmit"); }
    });
    assert(unknownReplay.handled);
    assert.equal(unknownReplay.status, 202);
    assert.equal(unknownReplay.body.ok, false);
    assert.equal(unknownReplay.body.pending, false);
    assert.equal(unknownReplay.body.outcome, "submission_status_unknown");
    assert.equal(record(unknownReplay.body.turn).turn_id, unknownTurn.turn.turn_id);
    assert.equal(record(unknownReplay.body.thread).thread_id, unknownThread.thread.thread_id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertMissingRunStorePrecedesBodyParsing(): Promise<void> {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    assert.equal(response.status, 503);
    assert.equal(record(record(await response.json()).error).code, "run_store_unavailable");
    const threadResponse = await fetch(`http://127.0.0.1:${address.port}/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    assert.equal(threadResponse.status, 503);
    assert.equal(record(record(await threadResponse.json()).error).code, "task_thread_store_unavailable");
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

async function assertAuthorizationCancellation(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-thread-api-cancel-"));
  const decisionRef = "authorization-decision:11111111111111111111111111111111:22222222222222222222222222222222";
  const baseRunStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  const runStore = {
    ...baseRunStore,
    getRunRecord: async (runId: string) => {
      const record = await baseRunStore.getRunRecord(runId);
      return record && runId === "run_api_cancel"
        ? { ...record, authorization_decision_refs: [decisionRef] }
        : record;
    }
  };
  const store = createFileTaskThreadStore({ directory: join(directory, "threads"), runRecordStore: runStore, resolveInputPolicy });
  const invalidated: string[] = [];
  let activeTurnId = "";
  let activeThreadId = "";
  const authorizationDecisionStore = {
    getAuthorizationDecision: async (ref: string) => ref === decisionRef
      ? {
          decision_ref: decisionRef,
          applicability: { scope: "task", run_id: "run_api_cancel", thread_id: activeThreadId, turn_id: activeTurnId, config_refs: [] },
          outcome: "confirm",
          state: invalidated.includes(ref) ? "invalidated" : "active",
          expires_at: new Date(Date.now() + 60_000).toISOString()
        }
      : undefined,
    invalidateAuthorizationDecision: async (ref: string) => {
      invalidated.push(ref);
      return {};
    }
  } as unknown as FileAuthorizationDecisionStore;
  try {
    const created = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/cancel",
      identity_environment_ref: "identity-env_111111111111111111111111"
    });
    const body = {
      idempotency_key: "submit-cancel",
      run_id: "run_api_cancel",
      package_ref: packageRef,
      input_snapshot: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "keyword", kind: "scalar", summary: "cancel" }]
      },
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/cancel", source_ref: packageRef } },
      harbor: { identity_environment_ref: "identity-env_111111111111111111111111" }
    };
    const submitted = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns`,
      body,
      store,
      validateTask: async () => undefined,
      submitTask: async (_request, claimToken, authorizationContext) => {
        activeThreadId = authorizationContext.thread_id;
        activeTurnId = authorizationContext.turn_id;
        await runStore.createRunRecord({
          run_id: body.run_id,
          task_intent_ref: "intent:cancel",
          entrypoint_ref: "entrypoint:app",
          capability_ref: "lode:capability/cancel",
          status: "requires_user_action",
          admission: { decision: "requires_user_action", action_risk: "write" }
        }, claimToken);
        return {
          status: 202,
          body: {
            ok: false,
            error: {
              category: "action_risk",
              code: "authorization_confirmation_required",
              phase: "policy",
              recovery_hint: "confirm_action"
            },
            run: { run_id: body.run_id, authorization_decision_refs: [decisionRef] }
          },
          run_record_present: true,
          failure_code: "authorization_confirmation_required"
        };
      }
    });
    assert(submitted.handled);
    assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
    const turn = record(submitted.body.turn);
    assert.equal(turn.status, "waiting_for_user");
    assert.deepEqual(turn.authorization_decision_refs, [decisionRef]);
      const terminated = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns/${String(turn.turn_id)}/terminate`,
      store,
      runRecordStore: runStore,
      authorizationDecisionStore,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("unexpected submit"); }
    });
    assert(terminated.handled);
    assert.equal(terminated.status, 200);
    assert.deepEqual(invalidated, [], "generic task termination must not invalidate its policy decision");
    assert.equal(takePendingWritePrecheckContinuation(decisionRef), undefined, "cancellation clears pending continuation");
    const genericRun = await runStore.getRunRecord(body.run_id);
    assert.equal(genericRun?.status, "requires_user_action", "generic task termination must not use the XHS cancellation seam");
    assert.equal(genericRun?.failure, undefined);
    assert.equal(genericRun?.public_result_summary, undefined);
    const cancelledTurn = record(terminated.body.turn);
    assert.equal(cancelledTurn.status, "cancelled");
    assert.equal(cancelledTurn.run_status, "requires_user_action");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertExactWritePrecheckCancellation(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-thread-api-precheck-cancel-"));
  const decisionRef = "authorization-decision:33333333333333333333333333333333:44444444444444444444444444444444";
  const packageRef = "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0";
  const lockRef = "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1";
  const baseRunStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  let syntheticUnknownRun: RunRecord | undefined;
  const runStore = {
    ...baseRunStore,
    getRunRecord: async (runId: string) => {
      if (runId === "run_api_precheck_unknown") return syntheticUnknownRun;
      const stored = await baseRunStore.getRunRecord(runId);
      return stored && (runId === "run_api_cancel" || runId === "run_api_precheck_cancel")
        ? { ...stored, authorization_decision_refs: [decisionRef] }
        : stored;
    }
  };
  const store = createFileTaskThreadStore({ directory: join(directory, "threads"), runRecordStore: runStore, resolveInputPolicy });
  let activeThreadId = "";
  let activeTurnId = "";
  let invalidated = false;
  const authorizationDecisionStore = {
    getAuthorizationDecision: async (ref: string) => ref === decisionRef
      ? {
          decision_ref: decisionRef,
          applicability: { scope: "task", run_id: "run_api_precheck_cancel", thread_id: activeThreadId, turn_id: activeTurnId, config_refs: [] },
          outcome: "confirm",
          state: invalidated ? "invalidated" : "active",
          expires_at: new Date(Date.now() + 60_000).toISOString()
        }
      : undefined,
    invalidateAuthorizationDecision: async () => {
      invalidated = true;
      return {};
    }
  } as unknown as FileAuthorizationDecisionStore;
  try {
    const created = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/publish-note-precheck",
      identity_environment_ref: "identity-env_222222222222222222222222"
    });
    const body = {
      idempotency_key: "submit-precheck-cancel",
      run_id: "run_api_precheck_cancel",
      package_ref: packageRef,
      input_snapshot: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "keyword", kind: "scalar", summary: "cancel" }]
      },
      task_intent: {
        intent_id: "intent:precheck-cancel",
        entrypoint: "app",
        capability: {
          ref: "lode:capability/publish-note-precheck",
          version: "0.1.0",
          source_ref: packageRef,
          lock_ref: lockRef
        },
        policy: { risk: "write", execution_intent: "validate_only" }
      },
      harbor: { identity_environment_ref: "identity-env_222222222222222222222222" }
    };
    const submitted = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns`,
      body,
      store,
      runRecordStore: runStore,
      authorizationDecisionStore,
      validateTask: async () => undefined,
      submitTask: async (_request, claimToken, authorizationContext) => {
        activeThreadId = authorizationContext.thread_id;
        activeTurnId = authorizationContext.turn_id;
        await runStore.createRunRecord({
          run_id: body.run_id,
          task_intent_ref: body.task_intent.intent_id,
          capability_ref: body.task_intent.capability.ref,
          capability_version: "0.1.0",
          capability_source_ref: packageRef,
          capability_lock_ref: lockRef,
          package_ref: packageRef,
          scope_target_ref: "https://creator.xiaohongshu.com/publish/publish",
          status: "requires_user_action",
          admission: { decision: "requires_user_action", action_risk: "write" },
          action_request: {
            schema_version: "webenvoy.action-request.v0",
            action_request_id: "action-request:precheck-cancel",
            task_intent_ref: body.task_intent.intent_id,
            capability_ref: body.task_intent.capability.ref,
            capability_version: "0.1.0",
            capability_source_ref: packageRef,
            capability_lock_ref: lockRef,
            package_ref: packageRef,
            operation_mode: "validate_only",
            risk_classification: {
              risk: "write",
              execution_intent: "validate_only",
              level: "medium",
              true_write_requested: false,
              reasons: ["validate_only_precheck"]
            },
            no_submit_guard: {
              status: "active",
              enforced_by: "core",
              blocked_execution_intents: ["execute_after_approval", "reconcile_status", "request_cancel"],
              source_refs: [packageRef, lockRef]
            },
            target_refs: { scope_target_ref: "https://creator.xiaohongshu.com/publish/publish" },
            consumer_boundary: "Test fixture contains public refs only."
          },
          policy_binding_snapshot: {
            schema_version: "webenvoy.policy-binding-snapshot.v0",
            decision_ref: decisionRef,
            effective_policy_source: "global_user_config",
            effective_policy_source_ref: "execution-policy:global",
            effective_policy_source_version: "1",
            action_fingerprint: `sha256:${"a".repeat(64)}`,
            resource_match_ref: "resource-match:precheck-cancel",
            resource_match_version: "1",
            expires_at: new Date(Date.now() + 60_000).toISOString()
          }
        }, claimToken);
        return {
          status: 202,
          body: {
            ok: false,
            error: {
              category: "action_risk",
              code: "authorization_confirmation_required",
              phase: "policy",
              recovery_hint: "confirm_action"
            },
            run: { run_id: body.run_id, authorization_decision_refs: [decisionRef] }
          },
          run_record_present: true,
          failure_code: "authorization_confirmation_required"
        };
      }
    });
    assert(submitted.handled);
    assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
    const turn = record(submitted.body.turn);
    const pending = takePendingWritePrecheckContinuation(decisionRef);
    assert(pending);
    assert.equal(Object.hasOwn(pending.harbor ?? {}, "session"), false);
    assert.equal(JSON.stringify(pending).includes("must-not-enter-continuation"), false);
    const terminated = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns/${String(turn.turn_id)}/terminate`,
      store,
      runRecordStore: runStore,
      authorizationDecisionStore,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("unexpected submit"); }
    });
    assert(terminated.handled);
    assert.equal(terminated.status, 200);
    assert.equal(invalidated, true);
    assert.equal(takePendingWritePrecheckContinuation(decisionRef), undefined);
    const cancelledRun = await runStore.getRunRecord(body.run_id);
    assert(cancelledRun);
    assert.equal(cancelledRun?.status, "cancelled");
    assert.equal(cancelledRun?.failure?.code, "user_cancelled");
    assert.equal(cancelledRun?.public_result_summary?.submitted, false);
    const cancelledTurn = record(terminated.body.turn);
    assert.equal(cancelledTurn.status, "cancelled");
    assert.equal(typeof cancelledTurn.terminated_at, "string");
    assert.equal(cancelledTurn.failure_code, "user_cancelled");
    const persistedThread = record(JSON.parse(await readFile(join(directory, "threads", `${created.thread.thread_id}.json`), "utf8")));
    const persistedTurn = record((persistedThread.turns as unknown[])[0]);
    assert.equal(persistedTurn.failure_code, undefined);
    assert.equal(persistedTurn.submission_error, undefined);

    const unknownRunId = "run_api_precheck_unknown";
    syntheticUnknownRun = {
      ...cancelledRun,
      run_id: unknownRunId,
      status: "unknown_outcome",
      authorization_decision_refs: [decisionRef]
    };
    const unknownBody = { ...body, idempotency_key: "submit-precheck-unknown", run_id: unknownRunId };
    const unknownTurn = await store.reserveTaskTurn(created.thread.thread_id, {
      idempotency_key: unknownBody.idempotency_key,
      request_hash: requestHash(unknownBody),
      run_id: unknownBody.run_id,
      creation_channel: "app",
      package_ref: packageRef,
      input: unknownBody.input_snapshot
    });
    const unknownBefore = await store.getTaskThread(created.thread.thread_id);
    assert(unknownBefore);
    assert.equal(unknownBefore.turns.at(-1)?.status, "status_unknown");
    const terminatedUnknown = await handleTaskThreadApi({
      method: "POST",
      path: `/threads/${created.thread.thread_id}/turns/${unknownTurn.turn.turn_id}/terminate`,
      store,
      runRecordStore: runStore,
      validateTask: async () => undefined,
      submitTask: async () => { throw new Error("unexpected submit"); }
    });
    assert(terminatedUnknown.handled);
    assert.equal(terminatedUnknown.status, 200);
    const unknownAfter = await runStore.getRunRecord(unknownBody.run_id);
    assert.equal(unknownAfter?.status, "unknown_outcome");
    const terminatedUnknownTurn = record(terminatedUnknown.body.turn);
    assert.equal(terminatedUnknownTurn.status, "cancelled");
    assert.equal(terminatedUnknownTurn.run_status, "unknown_outcome");
    assert.equal(typeof terminatedUnknownTurn.terminated_at, "string");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertWritePrecheckCancellationWinsBarrier(): Promise<void> {
  let releaseCancellation!: () => void;
  let cancellationEntered!: () => void;
  const cancellationGate = new Promise<void>((resolve) => { releaseCancellation = resolve; });
  const entered = new Promise<void>((resolve) => { cancellationEntered = resolve; });
  let cancelled = false;
  let harborCalls = 0;
  const cancel = withWritePrecheckRunLock("run_api_barrier", async () => {
    cancelled = true;
    cancellationEntered();
    await cancellationGate;
  });
  await entered;
  const allow = withWritePrecheckRunLock("run_api_barrier", async () => {
    if (!cancelled) harborCalls += 1;
  });
  releaseCancellation();
  await Promise.all([cancel, allow]);
  assert.equal(harborCalls, 0, "cancel-first run barrier must suppress continuation dispatch");
}

async function assertInternalErrorsAreRedacted(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-thread-api-redaction-"));
  const blockedDirectory = join(directory, "not-a-directory");
  await writeFile(blockedDirectory, "blocked\n", "utf8");
  const runStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  const server = createApiServer({
    runRecordStore: runStore,
    taskThreadStore: createFileTaskThreadStore({ directory: blockedDirectory, runRecordStore: runStore })
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/threads`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: "internal_error", message: "Internal server error" }
    });
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
}

export async function assertTaskThreadApiRaces(): Promise<void> {
  await assertInFlightReplay();
  await assertMissingRunStorePrecedesBodyParsing();
  await assertAuthorizationCancellation();
  await assertExactWritePrecheckCancellation();
  await assertWritePrecheckCancellationWinsBarrier();
  await assertInternalErrorsAreRedacted();
}
