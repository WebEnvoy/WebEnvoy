import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { completeRunWithResult } from "./result-envelope.js";
import { createFileRunRecordStore, type FailureRecord, type RunRecordStatus } from "./run-record-store.js";
import { getRunEvidenceRefs, getRunFailureReason } from "./result-query.js";
import { getRunSessionRefs } from "./run-query.js";

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 3, 0, tick));
  tick += 1;
  return instant;
}

const sessionBinding = {
  schema_version: "webenvoy.runtime-session-binding.v0",
  identity_environment_ref: "identity-env:fixture/real-query",
  execution_identity_ref: "identity-env:fixture/real-query:execution",
  runtime_session_ref: "harbor:runtime-session/real-query",
  profile_ref: "harbor:profile/real-query",
  provider_ref: "harbor:provider/cloakbrowser",
  provider_mode: "local_dedicated_profile",
  lifecycle_state: "active",
  control_owner: "core_task",
  session_use: "core_task_run",
  core_task_run: true,
  consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
} as const;

const runtimeBindingRefs = [
  sessionBinding.runtime_session_ref,
  sessionBinding.profile_ref,
  sessionBinding.provider_ref,
  "harbor:viewer/real-query",
  sessionBinding.identity_environment_ref,
  sessionBinding.execution_identity_ref,
  "harbor:snapshot/real-query",
  "harbor:refmap/real-query",
  "harbor:source-trace/real-query"
];

function baseInput(runId: string) {
  return {
    run_id: runId,
    task_intent_ref: "intent_fixture_real_query_001",
    entrypoint_ref: "entrypoint:api",
    capability_ref: "lode:capability/read-public-page",
    capability_version: "0.1.0",
    capability_source_ref: "lode://site-capability/example/read-public-page@0.1.0",
    capability_lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
    package_ref: "lode://site-capability/example/read-public-page@0.1.0",
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      runtime_binding_refs: runtimeBindingRefs,
      evidence_refs: ["harbor:evidence/real-query/admission"],
      resource_match_ref: "resource-match:fixture/real-query",
      runtime_session_binding: sessionBinding
    },
    runtime_binding_refs: runtimeBindingRefs,
    evidence_refs: ["harbor:evidence/real-query/admission"]
  } as const;
}

async function createFailureRun(
  store: ReturnType<typeof createFileRunRecordStore>,
  runId: string,
  status: Extract<RunRecordStatus, "failed" | "blocked" | "requires_user_action">,
  failure: FailureRecord
): Promise<void> {
  await store.createRunRecord({
    ...baseInput(runId),
    status,
    failure,
    evidence_refs: [`harbor:evidence/${runId}`]
  });
}

export async function assertRealRunQueryEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-real-run-query-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const runId = "run_self_check_real_query_success";

    await store.createRunRecord(baseInput(runId));
    await store.updateRunRecord(runId, { status: "admitted", runtime_binding_refs: runtimeBindingRefs });
    await store.updateRunRecord(runId, { status: "running", runtime_binding_refs: runtimeBindingRefs });
    await completeRunWithResult(store, runId, {
      result_ref: "result:fixture/real-query",
      result_kind: "content_detail",
      projection_ref: "projection:fixture/real-query",
      evidence_refs: ["harbor:evidence/real-query/result"],
      retention_state: "active"
    });

    const evidence = await getRunEvidenceRefs(store, runId);
    if (!evidence.ok) assert.fail(evidence.failure.code);
    assert.equal(evidence.evidence.evidence_refs.length, 2);
    assert.equal(evidence.evidence.evidence_refs[0]?.recorded_at, "2026-07-01T03:00:03.000Z");
    assert.equal(evidence.evidence.evidence_refs[0]?.runtime_session_ref, sessionBinding.runtime_session_ref);
    assert.equal(evidence.evidence.evidence_refs[1]?.source, "terminal");
    assert.equal(evidence.evidence.evidence_refs.every((entry) => entry.raw_access === "not_available_from_core"), true);

    const sessionRefs = await getRunSessionRefs(store, runId);
    if (!sessionRefs.ok) assert.fail(sessionRefs.failure.code);
    assert.equal(sessionRefs.session_refs.schema_version, "webenvoy.session-refs-query.v0");
    assert.equal(sessionRefs.session_refs.session_refs.runtime_session_ref, sessionBinding.runtime_session_ref);
    assert.equal(sessionRefs.session_refs.session_refs.profile_ref, sessionBinding.profile_ref);
    assert.equal(sessionRefs.session_refs.session_refs.raw_access, "not_available_from_core");

    const noFailure = await getRunFailureReason(store, runId);
    if (!noFailure.ok) assert.fail(noFailure.failure.code);
    assert.equal(noFailure.failure_reason.reason_class, "none");
    assert.equal(noFailure.failure_reason.app_action, "none");

    await createFailureRun(store, "run_self_check_login_required", "requires_user_action", {
      category: "resource_admission",
      code: "identity_auth_required",
      phase: "runtime_binding",
      recovery_hint: "open_manual_auth"
    });
    await createFailureRun(store, "run_self_check_page_changed", "failed", {
      category: "runtime_execution",
      code: "page_changed",
      phase: "execution",
      recovery_hint: "retry_after_refresh"
    });
    await createFailureRun(store, "run_self_check_field_not_visible", "failed", {
      category: "resource_admission",
      code: "field_not_visible",
      phase: "resource_matching",
      recovery_hint: "retry_after_refresh"
    });
    await createFailureRun(store, "run_self_check_risk_prompt", "blocked", {
      category: "runtime_execution",
      code: "risk_prompt",
      phase: "execution",
      recovery_hint: "manual_handoff"
    });

    const expected = [
      ["run_self_check_login_required", "login_required", "open_manual_auth", true],
      ["run_self_check_page_changed", "page_changed", "retry_after_refresh", true],
      ["run_self_check_field_not_visible", "field_unavailable", "retry_after_refresh", true],
      ["run_self_check_risk_prompt", "risk_prompt", "manual_handoff", false]
    ] as const;
    for (const [id, reasonClass, action, retryable] of expected) {
      const result = await getRunFailureReason(store, id);
      if (!result.ok) assert.fail(result.failure.code);
      assert.equal(result.failure_reason.failure_present, true);
      assert.equal(result.failure_reason.reason_class, reasonClass);
      assert.equal(result.failure_reason.app_action, action);
      assert.equal(result.failure_reason.retryable, retryable);
      assert.equal(result.failure_reason.evidence_refs[0]?.runtime_session_ref, sessionBinding.runtime_session_ref);
      assert.equal(Object.hasOwn(result.failure_reason, "cookie"), false);
      assert.equal(Object.hasOwn(result.failure_reason, "cdp_endpoint"), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
