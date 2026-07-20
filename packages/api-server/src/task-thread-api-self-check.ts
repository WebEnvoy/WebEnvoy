import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, taskTurnInputSchemaVersion } from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";
import { createApiServer } from "./server.js";
import { handleTaskThreadApi } from "./task-thread-api.js";

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
  const store = createFileTaskThreadStore({ directory: join(directory, "threads"), runRecordStore: runStore });
  let releaseSubmit: (() => void) | undefined;
  const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  try {
    const created = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/in-flight",
      identity_environment_ref: "identity-env:in-flight"
    });
    const body = {
      idempotency_key: "submit-in-flight",
      run_id: "run_api_in_flight",
      input_snapshot: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "keyword", kind: "scalar", summary: "AI tools" }]
      },
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/in-flight" } },
      harbor: { identity_environment_ref: "identity-env:in-flight" }
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
    assert.equal(record(replay.body.thread).thread_id, created.thread.thread_id);

    releaseSubmit!();
    const completed = await submit;
    assert(completed.handled);
    assert.equal(completed.status, 202);
    assert.equal(record(completed.body.turn).turn_id, inFlight.turn_id);
    assert.equal((await store.getTaskThread(created.thread.thread_id))?.turns.length, 1);

    const recoveredThread = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/recovered",
      identity_environment_ref: "identity-env:recovered"
    });
    const recoveredBody = {
      ...body,
      idempotency_key: "submit-recovered",
      run_id: "run_api_recovered",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/recovered" } },
      harbor: { identity_environment_ref: "identity-env:recovered" }
    };
    const recoveredTurn = await store.reserveTaskTurn(recoveredThread.thread.thread_id, {
      idempotency_key: recoveredBody.idempotency_key,
      request_hash: requestHash(recoveredBody),
      run_id: recoveredBody.run_id,
      creation_channel: "app",
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
      identity_environment_ref: "identity-env:waiting-recovered"
    });
    const waitingBody = {
      ...body,
      idempotency_key: "submit-waiting-recovered",
      run_id: "run_api_waiting_recovered",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/waiting-recovered" } },
      harbor: { identity_environment_ref: "identity-env:waiting-recovered" }
    };
    const waitingTurn = await store.reserveTaskTurn(waitingThread.thread.thread_id, {
      idempotency_key: waitingBody.idempotency_key,
      request_hash: requestHash(waitingBody),
      run_id: waitingBody.run_id,
      creation_channel: "app",
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
      identity_environment_ref: "identity-env:interrupted"
    });
    const interruptedBody = {
      ...body,
      idempotency_key: "submit-interrupted",
      run_id: "run_api_interrupted",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/interrupted" } },
      harbor: { identity_environment_ref: "identity-env:interrupted" }
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
      identity_environment_ref: "identity-env:unknown-replay"
    });
    const unknownBody = {
      ...body,
      idempotency_key: "submit-unknown-replay",
      run_id: "run_api_unknown_replay",
      task_intent: { entrypoint: "app", capability: { ref: "lode:capability/unknown-replay" } },
      harbor: { identity_environment_ref: "identity-env:unknown-replay" }
    };
    const unknownTurn = await store.reserveTaskTurn(unknownThread.thread.thread_id, {
      idempotency_key: unknownBody.idempotency_key,
      request_hash: requestHash(unknownBody),
      run_id: unknownBody.run_id,
      creation_channel: "app",
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

export async function assertTaskThreadApiRaces(): Promise<void> {
  await assertInFlightReplay();
  await assertMissingRunStorePrecedesBodyParsing();
  await assertInternalErrorsAreRedacted();
}
