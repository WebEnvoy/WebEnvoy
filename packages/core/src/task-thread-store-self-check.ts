import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFileOwnership } from "./file-ownership.js";
import { createFileRunRecordStore, type CreateRunRecordInput } from "./run-record-store.js";
import type { TaskTurnInputPolicyResolver } from "./task-turn-input-policy.js";
import {
  createFileTaskThreadStore,
  taskTurnInputConsumerBoundary,
  taskTurnInputSchemaVersion,
  validateTaskTurnInputSnapshot,
  type ReserveTaskTurnInput
} from "./task-thread-store.js";

let tick = 0;
const packageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const resolveInputPolicy: TaskTurnInputPolicyResolver = async ({ package_ref, capability_ref }) => ({
  package_ref,
  capability_ref,
  input_schema_ref: "lode://schema/test/input@0.1.0",
  fields: new Map([
    ["keyword", { field_id: "keyword", projection: "safe_summary" }],
    ["count", { field_id: "count", projection: "safe_summary" }],
    ["reference_file", { field_id: "reference_file", projection: "owner_ref" }],
    ["url", { field_id: "url", projection: "sanitized_url" }]
  ])
});

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 19, 6, 0, tick));
  tick += 1;
  return instant;
}

function runInput(runId: string): CreateRunRecordInput {
  return {
    run_id: runId,
    task_intent_ref: `intent:${runId}`,
    entrypoint_ref: "entrypoint:app",
    capability_ref: "lode:capability/search-notes",
    admission: {
      decision: "accepted",
      action_risk: "read"
    }
  };
}

function turnInput(runId: string, idempotencyKey: string, requestHash: string): ReserveTaskTurnInput {
  return {
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    run_id: runId,
    creation_channel: "app",
    package_ref: packageRef,
    input: {
      schema_version: taskTurnInputSchemaVersion,
      fields: [
        { field_id: "keyword", kind: "scalar", summary: "AI tools" },
        { field_id: "count", kind: "scalar", summary: "8" },
        { field_id: "reference_file", kind: "file", owner_ref: "attachment:fixture/reference" }
      ],
      attachment_refs: ["attachment:fixture/reference"]
    }
  };
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await readFile(path, "utf8").then(() => true).catch(() => false)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function startLockOwner(lockPath: string, readyPath: string): Promise<ChildProcess> {
  const moduleUrl = new URL("./file-ownership.js", import.meta.url).href;
  const script = `
    import { writeFile } from "node:fs/promises";
    import { withFileOwnershipLock } from ${JSON.stringify(moduleUrl)};
    await withFileOwnershipLock(${JSON.stringify(lockPath)}, 30000, async () => {
      await writeFile(${JSON.stringify(readyPath)}, "ready\\n", "utf8");
      await new Promise(() => setInterval(() => {}, 1000));
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
  await waitForFile(readyPath);
  return child;
}

async function startRunClaimOwner(runDirectory: string, runId: string, ownerRef: string, readyPath: string): Promise<ChildProcess> {
  const moduleUrl = new URL("./run-record-store.js", import.meta.url).href;
  const script = `
    import { writeFile } from "node:fs/promises";
    import { createFileRunRecordStore } from ${JSON.stringify(moduleUrl)};
    const token = await createFileRunRecordStore({ directory: ${JSON.stringify(runDirectory)} }).claimRunId(${JSON.stringify(runId)}, ${JSON.stringify(ownerRef)});
    if (!token) throw new Error("claim unavailable");
    await writeFile(${JSON.stringify(readyPath)}, "ready\\n", "utf8");
    await new Promise(() => setInterval(() => {}, 1000));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
  await waitForFile(readyPath);
  return child;
}

async function kill(child: ChildProcess): Promise<number> {
  const pid = child.pid;
  assert(pid);
  child.kill("SIGKILL");
  await once(child, "exit");
  return pid;
}

export async function assertTaskThreadStore(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-task-thread-"));
  const runDirectory = join(directory, "runs");
  const threadDirectory = join(directory, "threads");
  const runStore = createFileRunRecordStore({ directory: runDirectory, clock: nextInstant });
  const unavailableOwnerRefs = new Set<string>();
  const checkOwnerRef = async (ownerRef: string) => !unavailableOwnerRefs.has(ownerRef);
  const store = createFileTaskThreadStore({ directory: threadDirectory, runRecordStore: runStore, clock: nextInstant, checkOwnerRef, resolveInputPolicy });
  const harborIdentityRef = "identity-env_0123456789abcdef01234567";

  try {
    const publicUrl = validateTaskTurnInputSnapshot({
      schema_version: taskTurnInputSchemaVersion,
      fields: [{ field_id: "source_url", kind: "url", summary: "https://example.test/notes?q=public-value#section" }]
    });
    assert.equal(publicUrl.fields[0]?.summary, "https://example.test/notes");
    assert.throws(() => validateTaskTurnInputSnapshot({
      schema_version: taskTurnInputSchemaVersion,
      fields: [{ field_id: "reference_file", kind: "file", owner_ref: "s3:bucket/private-object" }]
    }), /field_owner_ref_invalid/);
    const creates = await Promise.all(Array.from({ length: 8 }, () => store.createOrGetTaskThread({
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: harborIdentityRef
    })));
    assert.equal(new Set(creates.map((result) => result.thread.thread_id)).size, 1);
    assert.equal(creates.filter((result) => result.created).length, 1);
    assert.equal(creates[0]?.thread.identity_environment_ref, harborIdentityRef);
    const threadId = creates.at(0)!.thread.thread_id;
    const otherIdentity = await store.createOrGetTaskThread({
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env_89abcdef0123456701234567"
    });
    assert.notEqual(otherIdentity.thread.thread_id, threadId);
    for (const identity_environment_ref of [
      "identity-env_deadbeef",
      "identity-env_0123456789abcdef0123456g",
      "harbor://identity-environment/xhs-brand",
      "https://example.test/identity/xhs-brand",
      "identity-env:https://example.test/identity/xhs-brand",
      "identity-env:foo/https://example.test/private",
      "identity-env:user:password",
      "identity-env:foo/user:password",
      "identity-env:credential-reference",
      "identity-env:cookie-reference",
      "identity-env:Mixed-SeCrEt-reference",
      "identity-env:token-secret",
      "identity-env_token-secret",
      `identity-env:${"a".repeat(2032)}`
    ]) {
      await assert.rejects(() => store.createOrGetTaskThread({
        capability_ref: "lode:capability/search-notes",
        identity_environment_ref
      }), /identity_environment_ref_invalid/);
    }
    for (const identity_environment_ref of ["identity-env:xhs:brand", "identity-env:fixture/real-query:execution"]) {
      assert.equal((await store.createOrGetTaskThread({
        capability_ref: "lode:capability/legacy-compatible",
        identity_environment_ref
      })).thread.identity_environment_ref, identity_environment_ref);
    }
    await assert.rejects(() => store.createOrGetTaskThread({
      capability_ref: "lode:capability/search-notes?token=private",
      identity_environment_ref: harborIdentityRef
    }), /capability_ref_invalid/);

    const uncheckedStore = createFileTaskThreadStore({
      directory: join(directory, "unchecked-owner-refs"),
      runRecordStore: runStore,
      resolveInputPolicy
    });
    const uncheckedThread = await uncheckedStore.createOrGetTaskThread({
      capability_ref: "lode:capability/unchecked-owner-refs",
      identity_environment_ref: "identity-env:unchecked-owner-refs"
    });
    assert.equal((await uncheckedStore.reserveTaskTurn(
      uncheckedThread.thread.thread_id,
      turnInput("run_unchecked_owner", "submit-unchecked-owner", "hash-unchecked-owner")
    )).turn.status, "submitting");

    const hangingStore = createFileTaskThreadStore({
      directory: join(directory, "hanging-owner-check"),
      runRecordStore: runStore,
      ownerRefCheckTimeoutMs: 10,
      checkOwnerRef: async () => new Promise<boolean>(() => {}),
      resolveInputPolicy
    });
    const hangingThread = await hangingStore.createOrGetTaskThread({
      capability_ref: "lode:capability/hanging-owner-check",
      identity_environment_ref: "identity-env:hanging-owner-check"
    });
    await assert.rejects(
      () => hangingStore.reserveTaskTurn(hangingThread.thread.thread_id, turnInput("run_hanging_owner", "submit-hanging-owner", "hash-hanging-owner")),
      /owner_ref_check_unavailable:field:reference_file/
    );
    assert.equal((await hangingStore.createOrGetTaskThread({
      capability_ref: "lode:capability/hanging-owner-check",
      identity_environment_ref: "identity-env:hanging-owner-check"
    })).created, false);

    const lockPath = join(threadDirectory, ".locks", `${threadId}.lock`);
    const lockOwner = await startLockOwner(lockPath, join(directory, "lock-ready"));
    const lockContender = createFileTaskThreadStore({
      directory: threadDirectory,
      runRecordStore: runStore,
      clock: nextInstant,
      lockTimeoutMs: 20,
      checkOwnerRef,
      resolveInputPolicy
    });
    await assert.rejects(
      () => lockContender.createOrGetTaskThread({
        capability_ref: "lode:capability/search-notes",
        identity_environment_ref: harborIdentityRef
      }),
      /thread_lock_timeout/
    );
    assert.equal(lockOwner.exitCode, null);
    const deadPid = await kill(lockOwner);
    const recoveryDirectory = `${lockPath}.recovery`;
    const recoveryMarker = join(recoveryDirectory, "00000000-0000-0000-0000-000000000001.json");
    await mkdir(recoveryDirectory, { recursive: true });
    await writeFile(recoveryMarker, `${JSON.stringify({
      token: "00000000-0000-0000-0000-000000000001",
      pid: process.pid,
      owner_ref: "test:live-recovery-fence",
      created_at: new Date().toISOString()
    })}\n`, "utf8");
    await assert.rejects(
      () => lockContender.createOrGetTaskThread({
        capability_ref: "lode:capability/search-notes",
        identity_environment_ref: harborIdentityRef
      }),
      /thread_lock_timeout/
    );
    await unlink(recoveryMarker);
    assert.equal((await lockContender.createOrGetTaskThread({
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: harborIdentityRef
    })).created, false);

    const first = await store.reserveTaskTurn(threadId, turnInput("run_thread_001", "submit-001", "hash-001"));
    assert.equal(first.turn.sequence, 1);
    assert.equal(first.turn.status, "submitting");
    assert.equal(first.turn.input.consumer_boundary, taskTurnInputConsumerBoundary);
    await assert.rejects(() => store.terminateTaskTurn(threadId, first.turn.turn_id), /turn_run_still_active/);
    await assert.rejects(
      () => store.reserveTaskTurn(threadId, turnInput("run_thread_in_flight", "submit-in-flight", "hash-in-flight")),
      /thread_has_active_turn/
    );
    await runStore.createRunRecord(runInput("run_thread_001"), first.run_claim_token);
    await store.recordTaskTurnSubmission(threadId, first.turn.turn_id, { accepted: true, http_status: 202, ok: true });
    const accepted = await store.getTaskThread(threadId);
    assert.equal(accepted?.turns.at(0)?.status, "accepted");
    await assert.rejects(
      () => store.reserveTaskTurn(threadId, turnInput("run_thread_blocked", "submit-blocked", "hash-blocked")),
      /thread_has_active_turn/
    );

    await runStore.updateRunRecord("run_thread_001", { status: "admitted" });
    await runStore.updateRunRecord("run_thread_001", { status: "running" });
    await runStore.updateRunRecord("run_thread_001", { status: "succeeded" });
    assert.equal((await store.getTaskThread(threadId))?.turns.at(0)?.status, "completed");
    unavailableOwnerRefs.add("attachment:fixture/reference");
    assert.deepEqual((await store.getTaskThread(threadId))?.turns.at(0)?.input_gaps, [
      { location: "field:reference_file", code: "owner_ref_unavailable", recovery_action: "reselect_attachment" },
      { location: "attachment:0", code: "owner_ref_unavailable", recovery_action: "reselect_attachment" }
    ]);
    const unavailableReplay = await store.reserveTaskTurn(threadId, turnInput("run_thread_001", "submit-001", "hash-001"));
    assert.equal(unavailableReplay.replayed, true);
    assert.equal(unavailableReplay.turn.turn_id, first.turn.turn_id);
    assert.equal(unavailableReplay.turn.input_gaps?.at(0)?.code, "owner_ref_unavailable");
    unavailableOwnerRefs.clear();

    const duplicateRequest = turnInput("run_thread_002", "submit-002", "hash-002");
    const duplicate = await Promise.all([
      store.reserveTaskTurn(threadId, duplicateRequest),
      store.reserveTaskTurn(threadId, duplicateRequest)
    ]);
    assert.equal(duplicate.at(0)!.turn.turn_id, duplicate.at(1)!.turn.turn_id);
    assert.equal(duplicate.filter((result) => result.replayed).length, 1);
    await assert.rejects(
      () => store.reserveTaskTurn(threadId, { ...duplicateRequest, request_hash: "hash-mismatch" }),
      /idempotency_payload_mismatch/
    );
    await store.recordTaskTurnSubmission(threadId, duplicate.at(0)!.turn.turn_id, {
      accepted: false,
      http_status: 400,
      ok: false,
      failure_code: "task_intent_invalid"
    });
    assert.equal((await store.getTaskThread(threadId))?.turns.at(1)?.status, "failed");

    const acceptedBeforeThreadUpdate = await store.reserveTaskTurn(
      threadId,
      turnInput("run_thread_003", "submit-003", "hash-003")
    );
    await runStore.createRunRecord(runInput("run_thread_003"), acceptedBeforeThreadUpdate.run_claim_token);
    const recoveredStore = createFileTaskThreadStore({ directory: threadDirectory, runRecordStore: runStore, clock: nextInstant, checkOwnerRef, resolveInputPolicy });
    const recoveredAccepted = await recoveredStore.getTaskThread(threadId);
    assert.equal(recoveredAccepted?.turns.at(2)?.submission_state, "accepted");
    assert.equal(recoveredAccepted?.turns.at(2)?.status, "accepted");
    const acceptedReplay = await recoveredStore.reserveTaskTurn(
      threadId,
      turnInput("run_thread_003", "submit-003", "hash-003")
    );
    assert.equal(acceptedReplay.replayed, true);
    assert.equal(acceptedReplay.turn.turn_id, acceptedBeforeThreadUpdate.turn.turn_id);
    await runStore.updateRunRecord("run_thread_003", { status: "admitted" });
    await runStore.updateRunRecord("run_thread_003", { status: "running" });
    await runStore.updateRunRecord("run_thread_003", { status: "succeeded" });
    const recoveredCompleted = await recoveredStore.getTaskThread(threadId);
    assert.equal(recoveredCompleted?.turns.at(2)?.status, "completed");
    assert.equal(recoveredCompleted?.turns.at(2)?.terminal_at, recoveredCompleted?.turns.at(2)?.updated_at);
    assert.equal(recoveredCompleted?.updated_at, recoveredCompleted?.turns.at(2)?.updated_at);

    const interrupted = await recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_004", "submit-004", "hash-004"));
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_005", "submit-005", "hash-005")),
      /thread_has_active_turn/
    );
    const interruptedClaimPath = join(`${runDirectory}.run-id-claims`, "run_thread_004.claim");
    const interruptedOwner = await readFileOwnership(interruptedClaimPath);
    assert(interruptedOwner);
    await writeFile(interruptedClaimPath, `${JSON.stringify({ ...interruptedOwner, pid: deadPid })}\n`, "utf8");
    assert.equal((await recoveredStore.getTaskThread(threadId))?.turns.at(3)?.status, "status_unknown");
    await recoveredStore.terminateTaskTurn(threadId, interrupted.turn.turn_id);
    assert.equal((await recoveredStore.getTaskThread(threadId))?.turns.at(3)?.status, "cancelled");

    const waiting = await recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_005", "submit-005", "hash-005"));
    await runStore.createRunRecord({
      ...runInput("run_thread_005"),
      status: "requires_user_action",
      admission: { decision: "requires_user_action", action_risk: "read" }
    }, waiting.run_claim_token);
    await recoveredStore.recordTaskTurnSubmission(threadId, waiting.turn.turn_id, { accepted: true, http_status: 409, ok: false });
    assert.equal((await recoveredStore.getTaskThread(threadId))?.turns.at(4)?.status, "waiting_for_user");
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_waiting_blocked", "submit-waiting-blocked", "hash-waiting-blocked")),
      /thread_has_active_turn/
    );
    await recoveredStore.terminateTaskTurn(threadId, waiting.turn.turn_id);
    assert.equal((await runStore.getRunRecord("run_thread_005"))?.status, "requires_user_action");
    assert.equal((await recoveredStore.getTaskThread(threadId))?.turns.at(4)?.status, "cancelled");

    const unknown = await recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_006", "submit-006", "hash-006"));
    await runStore.createRunRecord(runInput("run_thread_006"), unknown.run_claim_token);
    await runStore.updateRunRecord("run_thread_006", { status: "admitted" });
    await runStore.updateRunRecord("run_thread_006", { status: "running" });
    await recoveredStore.recordTaskTurnSubmission(threadId, unknown.turn.turn_id, { accepted: true, http_status: 202, ok: true });
    await assert.rejects(() => recoveredStore.terminateTaskTurn(threadId, unknown.turn.turn_id), /turn_run_still_active/);
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_007", "submit-007", "hash-007")),
      /thread_has_active_turn/
    );
    await runStore.updateRunRecord("run_thread_006", { status: "unknown_outcome" });
    assert.equal((await recoveredStore.getTaskThread(threadId))?.turns.at(5)?.status, "status_unknown");
    await recoveredStore.terminateTaskTurn(threadId, unknown.turn.turn_id);

    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, {
        ...turnInput("run_thread_invalid", "submit-invalid", "hash-invalid"),
        input: {
          schema_version: taskTurnInputSchemaVersion,
          fields: [{ field_id: "draft", kind: "long_text" }]
        }
      }),
      /field_owner_ref_required/
    );
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, {
        ...turnInput("run_thread_raw", "submit-raw", "hash-raw"),
        input: {
          schema_version: taskTurnInputSchemaVersion,
          fields: [{ field_id: "draft", kind: "long_text", owner_ref: "draft:fixture", content: "RAW-SECRET" }]
        } as never
      }),
      /field_property_unsupported:content/
    );
    const boundaryTurn = await recoveredStore.reserveTaskTurn(threadId, {
      ...turnInput("run_thread_boundary", "submit-boundary", "hash-boundary"),
      input: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "keyword", kind: "scalar", summary: "AI tools" }],
        consumer_boundary: taskTurnInputConsumerBoundary
      }
    });
    assert.equal(boundaryTurn.turn.input.consumer_boundary, taskTurnInputConsumerBoundary);
    await runStore.createRunRecord(runInput("run_thread_boundary"), boundaryTurn.run_claim_token);
    await runStore.updateRunRecord("run_thread_boundary", { status: "admitted" });
    await runStore.updateRunRecord("run_thread_boundary", { status: "running" });
    await runStore.updateRunRecord("run_thread_boundary", { status: "succeeded" });
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, {
        ...turnInput("run_thread_invalid_boundary", "submit-invalid-boundary", "hash-invalid-boundary"),
        input: {
          schema_version: taskTurnInputSchemaVersion,
          fields: [{ field_id: "keyword", kind: "scalar", summary: "AI tools" }],
          consumer_boundary: "caller-controlled"
        }
      }),
      /consumer_boundary_invalid/
    );
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, {
        ...turnInput("run_thread_password", "submit-password", "hash-password"),
        input: {
          schema_version: taskTurnInputSchemaVersion,
          fields: [{ field_id: "password", kind: "scalar", summary: "must-not-persist" }]
        }
      }),
      /private_field_rejected:password/
    );
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, {
        ...turnInput("run_thread_sensitive_url", "submit-sensitive-url", "hash-sensitive-url"),
        input: {
          schema_version: taskTurnInputSchemaVersion,
          fields: [{ field_id: "callback_url", kind: "url", summary: "https://example.test/callback?access_token=secret" }]
        }
      }),
      /field_url_sensitive_value_rejected/
    );
    unavailableOwnerRefs.add("attachment:fixture/reference");
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(threadId, turnInput("run_thread_missing_owner", "submit-missing-owner", "hash-missing-owner")),
      /owner_ref_unavailable:field:reference_file/
    );
    unavailableOwnerRefs.clear();

    const orphanClaimRunId = "run_thread_orphan_claim";
    const orphanClaimOwner = await startRunClaimOwner(
      runDirectory,
      orphanClaimRunId,
      "thread:crashed-before-persist",
      join(directory, "claim-ready")
    );
    await kill(orphanClaimOwner);
    const recoveredClaimThread = await recoveredStore.createOrGetTaskThread({
      capability_ref: "lode:capability/recovered-claim",
      identity_environment_ref: "identity-env:recovered-claim"
    });
    const recoveredClaim = await recoveredStore.reserveTaskTurn(
      recoveredClaimThread.thread.thread_id,
      turnInput(orphanClaimRunId, "submit-recovered-claim", "hash-recovered-claim")
    );
    assert.equal(recoveredClaim.turn.status, "submitting");

    const globalA = await recoveredStore.createOrGetTaskThread({
      capability_ref: "lode:capability/global-a",
      identity_environment_ref: "identity-env:global-a"
    });
    const globalB = await recoveredStore.createOrGetTaskThread({
      capability_ref: "lode:capability/global-b",
      identity_environment_ref: "identity-env:global-b"
    });
    const globalReservation = await recoveredStore.reserveTaskTurn(globalA.thread.thread_id, turnInput("run_thread_global", "submit-global-a", "hash-global-a"));
    const globalClaimPath = join(`${runDirectory}.run-id-claims`, "run_thread_global.claim");
    const globalOwner = await readFileOwnership(globalClaimPath);
    assert(globalOwner);
    await writeFile(globalClaimPath, `${JSON.stringify({ ...globalOwner, pid: deadPid })}\n`, "utf8");
    await assert.rejects(
      () => recoveredStore.reserveTaskTurn(globalB.thread.thread_id, turnInput("run_thread_global", "submit-global-b", "hash-global-b")),
      /run_id_already_linked/
    );
    assert.equal((await recoveredStore.getTaskThread(globalA.thread.thread_id))?.turns.at(0)?.turn_id, globalReservation.turn.turn_id);

    const atomicCreates = await Promise.allSettled([
      runStore.createRunRecord(runInput("run_thread_atomic")),
      runStore.createRunRecord({ ...runInput("run_thread_atomic"), capability_ref: "lode:capability/other" })
    ]);
    assert.equal(atomicCreates.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(atomicCreates.filter((result) => result.status === "rejected").length, 1);
    const atomicWinner = atomicCreates.find((result) => result.status === "fulfilled");
    assert(atomicWinner?.status === "fulfilled");
    assert.equal((await runStore.getRunRecord("run_thread_atomic"))?.capability_ref, atomicWinner.value.capability_ref);

    await runStore.createRunRecord(runInput("run_thread_late_success"));
    await runStore.updateRunRecord("run_thread_late_success", { status: "admitted" });
    await runStore.updateRunRecord("run_thread_late_success", { status: "running" });
    await runStore.updateRunRecord("run_thread_late_success", { status: "cancelled" });
    await assert.rejects(() => runStore.updateRunRecord("run_thread_late_success", { status: "succeeded" }), /terminal/);
    assert.equal((await runStore.getRunRecord("run_thread_late_success"))?.status, "cancelled");

    await runStore.createRunRecord(runInput("run_thread_terminal_race"));
    await runStore.updateRunRecord("run_thread_terminal_race", { status: "admitted" });
    await runStore.updateRunRecord("run_thread_terminal_race", { status: "running" });
    const terminalRace = await Promise.allSettled([
      runStore.updateRunRecord("run_thread_terminal_race", { status: "cancelled" }),
      runStore.updateRunRecord("run_thread_terminal_race", { status: "succeeded" })
    ]);
    assert.equal(terminalRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(terminalRace.filter((result) => result.status === "rejected").length, 1);

    const finalThread = await recoveredStore.getTaskThread(threadId);
    assert.deepEqual(finalThread?.turns.map((turn) => turn.sequence), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(finalThread?.schema_version, "webenvoy.task-thread.v0");
    assert.equal(finalThread?.turns.some((turn) => Object.hasOwn(turn, "request_hash")), false);
    assert.equal((await recoveredStore.listTaskThreads()).some((thread) => thread.thread_id === threadId), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
