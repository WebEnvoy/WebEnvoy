import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, runLifecycleTransitions, type RunRecord } from "./run-record-store.js";
import { acceptReadOnlyTaskSubmission } from "./task-submission.js";

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 0, 0, tick));
  tick += 1;
  return instant;
}

function baseInput(runId: string) {
  return {
    run_id: runId,
    task_intent_ref: "intent_fixture_read_only_001",
    entrypoint_ref: "entrypoint:api",
    capability_ref: "lode:capability/read-page-summary",
    package_ref: "lode:package/read-page-summary@0.1.0",
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_match_ref: "resource-match:fixture/ready"
    }
  } as const;
}

async function readTaskIntentFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL("../../schemas/fixtures/read-only-submit.fixture.json", import.meta.url), "utf8")) as Record<string, unknown>;
}

function assertRefsOnly(record: RunRecord): void {
  assert(!Object.hasOwn(record, "raw_payload"), "Run Record must not inline raw_payload");
  assert(!Object.hasOwn(record, "dom"), "Run Record must not inline DOM");
  assert(!Object.hasOwn(record, "screenshot"), "Run Record must not inline screenshots");
  assert(!Object.hasOwn(record, "cookie"), "Run Record must not inline cookies");
  assert(!Object.hasOwn(record, "token"), "Run Record must not inline tokens");
}

async function assertTaskSubmissionAdmission(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-task-submission-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const taskIntent = await readTaskIntentFixture();
    const accepted = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_submit_accepted",
      task_intent: taskIntent,
      resource_match_ref: "resource-match:fixture/ready",
      evidence_refs: ["evidence:fixture/admission-ready"]
    });

    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      throw new Error("read-only submission must be accepted");
    }
    assert.equal(accepted.run_record.status, "admitted");
    assert.equal(accepted.run_record.admission.decision, "accepted");
    assert.equal(accepted.run_record.task_intent_ref, "intent_fixture_read_only_001");
    assert.equal(accepted.run_record.capability_ref, "lode:capability/read-page-summary");
    assert.deepEqual(await store.getRunRecord("run_self_check_submit_accepted"), accepted.run_record);

    const invalid = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_submit_invalid",
      task_intent: {
        ...taskIntent,
        token: "must-not-enter-core"
      }
    });
    assert.equal(invalid.ok, false);
    if (invalid.ok) {
      throw new Error("private-field submission must fail");
    }
    assert.equal(invalid.failure.code, "private_field_rejected:token");
    assert.equal(await store.getRunRecord("run_self_check_submit_invalid"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const directory = await mkdtemp(join(tmpdir(), "webenvoy-run-record-store-"));

try {
  const store = createFileRunRecordStore({ directory, clock: nextInstant });
  const runId = "run_self_check_read_001";

  const pending = await store.createRunRecord(baseInput(runId));
  assert.equal(pending.status, "pending");
  assert.equal(pending.schema_version, "webenvoy.run-record.v0");
  assert.deepEqual(runLifecycleTransitions.pending, ["admitted", "failed", "cancelled", "expired"]);
  await assert.rejects(() => store.updateRunRecord(runId, { status: "running" }), /illegal run status transition/);

  const admitted = await store.updateRunRecord(runId, {
    status: "admitted",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/admission-ready"]
  });
  assert.equal(admitted.status, "admitted");
  await assert.rejects(() => store.updateRunRecord(runId, { status: "succeeded", result_ref: "result:fixture/too-early" }), /illegal run status transition/);

  const running = await store.updateRunRecord(runId, {
    status: "running",
    evidence_refs: ["evidence:fixture/admission-ready", "evidence:fixture/run-started"]
  });
  assert.equal(running.status, "running");

  const succeeded = await store.updateRunRecord(runId, {
    status: "succeeded",
    result_ref: "result:fixture/read-page-summary",
    evidence_refs: ["evidence:fixture/result-summary"],
    retention_state: "active"
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.terminal_at, "2026-07-01T00:00:03.000Z");
  assertRefsOnly(succeeded);

  const reloaded = await store.getRunRecord(runId);
  assert.deepEqual(reloaded, succeeded);
  const detachedGetRunRecord = store.getRunRecord;
  assert.deepEqual(await detachedGetRunRecord(runId), succeeded);
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${runId}.json`), "utf8")), succeeded);

  const failedId = "run_self_check_failure_001";
  await store.createRunRecord({
    ...baseInput(failedId),
    admission: {
      decision: "blocked_pre_admission",
      action_risk: "read",
      resource_match_ref: "resource-match:fixture/runtime-facts-stale"
    }
  });
  const failed = await store.updateRunRecord(failedId, {
    status: "failed",
    evidence_refs: ["evidence:fixture/runtime-facts-stale"],
    failure: {
      category: "resource_admission",
      code: "runtime_facts_stale",
      phase: "resource_matching",
      recovery_hint: "connect_runtime"
    },
    retention_state: "active"
  });
  assert.equal(failed.failure?.category, "resource_admission");
  assert.equal(failed.terminal_at, "2026-07-01T00:00:05.000Z");

  const cancelledId = "run_self_check_cancelled_001";
  await store.createRunRecord(baseInput(cancelledId));
  const cancelled = await store.updateRunRecord(cancelledId, {
    status: "cancelled",
    evidence_refs: ["evidence:fixture/cancelled-by-user"]
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.terminal_at, "2026-07-01T00:00:07.000Z");

  await assert.rejects(() => store.updateRunRecord(runId, { status: "running" }), /terminal/);
  await assert.rejects(() => store.updateRunRecord(cancelledId, { status: "running" }), /terminal/);
  await assert.rejects(() => store.createRunRecord({ ...baseInput("../bad"), run_id: "../bad" }), /run_id/);
  await assert.rejects(() => store.createRunRecord({ ...baseInput("run_self_check_empty_ref"), entrypoint_ref: "" }), /entrypoint_ref/);
  const invalidRefId = "run_self_check_invalid_ref_patch";
  await store.createRunRecord(baseInput(invalidRefId));
  await assert.rejects(() => store.updateRunRecord(invalidRefId, { result_ref: "" }), /result_ref/);

  const detachedListRunRecords = store.listRunRecords;
  assert.deepEqual(
    (await detachedListRunRecords()).map((record) => record.run_id),
    [cancelledId, failedId, invalidRefId, runId]
  );

  console.log("Validated Run Record file store with 4 durable records.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

await assertTaskSubmissionAdmission();
console.log("Validated read-only task submission admission.");
