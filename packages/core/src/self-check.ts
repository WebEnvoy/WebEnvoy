import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, runLifecycleTransitions, type RunRecord } from "./run-record-store.js";
import { type HarborCoreRuntimeFacts, type HarborCoreSceneReference, type HarborWritePrecheckFacts } from "./harbor-admission.js";
import { type LodePackageAdmissionContract } from "./lode-admission.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";
import { approvalCancellationQuerySchemaVersion, getApprovalCancellationSummary, getRunSummary, projectRunSummary, runQuerySchemaVersion } from "./run-query.js";
import { getRunEvidenceRefs, getRunResult, projectRunResult } from "./result-query.js";
import { acceptReadOnlyTaskSubmission } from "./task-submission.js";
import { capabilityRunQuerySchemaVersion, getCapabilityRunSummary } from "./capability-query.js";

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 0, 0, tick));
  tick += 1;
  return instant;
}

const lodeReadPublicPageContract = {
  package_ref: "lode://site-capability/example/read-public-page@0.1.0",
  source_ref: "lode://site-capability/example/read-public-page@0.1.0",
  lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
  capability_id: "read-public-page",
  operation_id: "content_detail_by_url",
  operation_mode: "read",
  version: "0.1.0",
  lifecycle: "proposed",
  resource_requirements: {
    schema_version: "lode.resource-requirements.v0",
    resource_requirements_id: "example.read-public-page.resources",
    resource_requirements_version: "0.1.0",
    package_ref: "lode://site-capability/example/read-public-page@0.1.0",
    operation_mode: "read",
    resource_requirement_profiles: [
      {
        requirement_profile_id: "public-page-read-with-snapshot-refmap-evidence",
        operation_boundary: "read",
        required_harbor_facts: [
          { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "runtime.public_https_navigation.allowed", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "snapshot.document_summary.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "refmap.source_refs.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true, freshness: "current_execution_window" }
        ]
      }
    ]
  }
} satisfies LodePackageAdmissionContract;

const harborRuntimeBindingRefs = [
  "session_fixture_ready",
  "profile_fixture_public",
  "provider_fixture_local",
  "viewer_fixture_readonly",
  "snapshot_fixture_example",
  "refmap_fixture_example",
  "source_trace_fixture_example"
];
const harborEvidenceRefs = ["evidence_fixture_snapshot", "evidence_fixture_source_trace", "evidence_fixture_refmap"];

const harborRuntimeFacts = {
  schema_version: "harbor-core-runtime-facts/v0",
  runtime_session_ref: "session_fixture_ready",
  profile_ref: "profile_fixture_public",
  provider_ref: "provider_fixture_local",
  provider_mode: "local_dedicated_profile",
  lifecycle_state: "active",
  availability: {
    cdp: "available",
    viewer: "unsupported",
    snapshot: "available",
    evidence: "available"
  },
  viewer: {
    viewer_ref: "viewer_fixture_readonly",
    availability: "unsupported",
    access_mode: "none",
    expires_at: "2026-07-01T01:00:00.000Z"
  },
  control: {
    owner: "system",
    handoff_reason: null,
    takeover: {
      available: false,
      unavailable_reason: "viewer_unavailable"
    },
    updated_at: "2026-07-01T00:00:00.000Z"
  },
  current_error: null,
  fact_refs: {
    session: "session_fixture_ready",
    viewer: "viewer_fixture_readonly"
  },
  unavailable: null
} satisfies HarborCoreRuntimeFacts;

const harborSceneRef = {
  schema_version: "harbor-page-scene-refs/v0",
  runtime_session_ref: "session_fixture_ready",
  snapshot_ref: "snapshot_fixture_example",
  refmap_ref: "refmap_fixture_example",
  evidence_refs: harborEvidenceRefs,
  source_trace_ref: "source_trace_fixture_example",
  captured_at: "2026-07-01T00:00:00.000Z",
  page_summary: {
    title: "Example Domain",
    url: "https://example.org/",
    summary: "Reserved public Example Domain fixture summary."
  },
  unavailable: null
} satisfies HarborCoreSceneReference;

const lodePreviewContactFormContract = {
  package_ref: "lode://site-capability/example/preview-contact-form@0.1.0",
  source_ref: "lode://site-capability/example/preview-contact-form@0.1.0",
  lock_ref: "lode://lock/site-capability/example/preview-contact-form@0.1.0",
  capability_id: "preview-contact-form",
  operation_id: "contact_form_preview",
  operation_mode: "validate_only",
  version: "0.1.0",
  lifecycle: "proposed",
  resource_requirements: {
    schema_version: "lode.resource-requirements.v0",
    resource_requirements_id: "example.preview-contact-form.resources",
    resource_requirements_version: "0.1.0",
    package_ref: "lode://site-capability/example/preview-contact-form@0.1.0",
    operation_mode: "validate_only",
    resource_requirement_profiles: [
      {
        requirement_profile_id: "public-page-read-with-snapshot-refmap-evidence",
        operation_boundary: "validate_only",
        required_harbor_facts: [
          { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "snapshot.document_summary.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true, freshness: "current_execution_window" }
        ]
      }
    ]
  }
} satisfies LodePackageAdmissionContract;

const harborWritePrecheckFacts = {
  schema_version: "harbor-write-precheck-facts/v0",
  runtime_session_ref: "session_fixture_ready",
  provider_ref: "provider_fixture_local",
  profile_ref: "profile_fixture_public",
  writable_target: {
    target_ref: "target:fixture/contact-form",
    runtime_session_ref: "session_fixture_ready",
    snapshot_ref: "snapshot_fixture_write_precheck",
    refmap_ref: "refmap_fixture_write_precheck",
    evidence_refs: ["evidence_fixture_write_precheck"]
  },
  form_state: {
    snapshot_ref: "snapshot_fixture_write_precheck",
    fields: [
      {
        field_ref: "field:fixture/message",
        target_ref: "target:fixture/contact-form",
        label: "Message",
        input_kind: "textarea",
        required: true,
        sensitivity: "public",
        export_policy: "safe_summary",
        value_state: "empty"
      }
    ],
    state_summary: "One public message field is visible; no raw input values are exported."
  },
  pre_write_guard: {
    status: "active",
    no_submit_guard: "active",
    blocked_events: ["submit", "publish", "send"],
    enforcement: "facts_only_no_real_submit",
    runtime_ready: true,
    blocking_reasons: []
  },
  privacy_boundary: {
    raw_values: "not_exposed",
    credential_profile_storage: "not_exposed",
    page_network_capture: "not_exposed",
    export_boundary: "refs_and_redacted_field_state_only"
  },
  unavailable: null
} satisfies HarborWritePrecheckFacts;

function baseInput(runId: string) {
  return {
    run_id: runId,
    task_intent_ref: "intent_fixture_read_only_001",
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
      runtime_binding_refs: harborRuntimeBindingRefs,
      evidence_refs: harborEvidenceRefs,
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
  assert(!Object.hasOwn(record, "cdp_ref"), "Run Record must not inline CDP refs");
  assert(!Object.hasOwn(record, "viewer_url"), "Run Record must not inline viewer URLs");
}

async function assertTaskSubmissionAdmission(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-task-submission-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const taskIntent = await readTaskIntentFixture();
    const accepted = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_submit_accepted",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      resource_match_ref: "resource-match:fixture/ready",
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: harborSceneRef
    });

    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      throw new Error("read-only submission must be accepted");
    }
    assert.equal(accepted.run_record.status, "admitted");
    assert.equal(accepted.run_record.admission.decision, "accepted");
    assert.equal(accepted.run_record.task_intent_ref, "intent_fixture_read_only_001");
    assert.equal(accepted.run_record.capability_ref, "lode:capability/read-public-page");
    assert.equal(accepted.run_record.capability_version, "0.1.0");
    assert.equal(accepted.run_record.capability_source_ref, lodeReadPublicPageContract.source_ref);
    assert.equal(accepted.run_record.capability_lock_ref, lodeReadPublicPageContract.lock_ref);
    assert.equal(accepted.run_record.package_ref, lodeReadPublicPageContract.package_ref);
    assert.deepEqual(accepted.run_record.admission.resource_requirement_refs, ["example.read-public-page.resources"]);
    assert.deepEqual(accepted.run_record.admission.runtime_binding_refs, harborRuntimeBindingRefs);
    assert.deepEqual(accepted.run_record.admission.evidence_refs, harborEvidenceRefs);
    assert.deepEqual(accepted.run_record.runtime_binding_refs, harborRuntimeBindingRefs);
    assert.deepEqual(accepted.run_record.evidence_refs, harborEvidenceRefs);
    assert.deepEqual(await store.getRunRecord("run_self_check_submit_accepted"), accepted.run_record);

    const missingRuntime = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_harbor_missing_runtime",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract
    });
    assert.equal(missingRuntime.ok, false);
    assert.equal(missingRuntime.failure.code, "runtime_ref_missing");
    assert.equal(missingRuntime.run_record?.status, "failed");

    const captureDenied = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_harbor_capture_denied",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: {
        status: "unavailable",
        failure_class: "capture_denied",
        retryable: false
      }
    });
    assert.equal(captureDenied.ok, false);
    assert.equal(captureDenied.failure.category, "evidence_reference");
    assert.equal(captureDenied.failure.code, "capture_denied");
    assert.deepEqual(captureDenied.run_record?.admission.runtime_binding_refs, harborRuntimeBindingRefs.slice(0, 4));

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

    const submitActionRequest = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_true_write_deferred",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_fixture_submit_deferred_001",
        policy: {
          risk: "submit",
          execution_intent: "execute_after_approval"
        }
      },
      package_ref: lodeReadPublicPageContract.package_ref
    });
    assert.equal(submitActionRequest.ok, false);
    assert.equal(submitActionRequest.failure.category, "action_risk");
    assert.equal(submitActionRequest.failure.code, "true_write_deferred");
    assert.equal(submitActionRequest.failure.recovery_hint, "use_validate_or_preview");
    assert.equal(submitActionRequest.run_record?.status, "failed");
    assert.equal(submitActionRequest.run_record?.admission.decision, "deferred_true_write");
    assert.equal(submitActionRequest.run_record?.admission.action_risk, "submit");
    assert.equal(submitActionRequest.run_record?.package_ref, lodeReadPublicPageContract.package_ref);
    assert.equal(submitActionRequest.run_record?.action_request?.operation_mode, "blocked_true_write");
    assert.equal(submitActionRequest.run_record?.action_request?.risk_classification.level, "blocked");
    assert.equal(submitActionRequest.run_record?.action_request?.no_submit_guard.status, "active");
    const submitQuery = await getRunResult(store, "run_self_check_true_write_deferred");
    assert.equal(submitQuery.ok, true);
    if (!submitQuery.ok) {
      throw new Error("true-write guardrail run must be queryable");
    }
    assert.equal(submitQuery.result.failure?.code, "true_write_deferred");
    assert.equal(submitQuery.result.result.result_envelope?.ok, false);
    assert.equal(submitQuery.result.result.result_envelope?.failure?.category, "action_risk");

    const validateOnlyActionRequest = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_validate_only_admitted",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_fixture_validate_only_001",
        capability: {
          ref: "lode:capability/preview-contact-form",
          version: "0.1.0",
          source_ref: lodePreviewContactFormContract.source_ref,
          lock_ref: lodePreviewContactFormContract.lock_ref
        },
        resource_requirement_refs: ["example.preview-contact-form.resources"],
        policy: {
          risk: "write",
          execution_intent: "validate_only"
        }
      },
      package_ref: lodePreviewContactFormContract.package_ref,
      lode_package_contract: lodePreviewContactFormContract,
      resource_match_ref: "resource-match:fixture/write-precheck-ready",
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_write_precheck_facts: harborWritePrecheckFacts
    });
    assert.equal(validateOnlyActionRequest.ok, true);
    if (!validateOnlyActionRequest.ok) {
      throw new Error("validate-only action request must be admitted");
    }
    assert.equal(validateOnlyActionRequest.run_record.status, "admitted");
    assert.equal(validateOnlyActionRequest.run_record.admission.decision, "accepted_with_warnings");
    assert.equal(validateOnlyActionRequest.run_record.admission.action_risk, "write");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.schema_version, "webenvoy.action-request.v0");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.operation_mode, "validate_only");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.risk_classification.level, "low");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.risk_classification.true_write_requested, false);
    assert.equal(validateOnlyActionRequest.run_record.action_request?.no_submit_guard.status, "active");
    assert.deepEqual(validateOnlyActionRequest.run_record.action_request?.no_submit_guard.blocked_execution_intents, ["execute_after_approval", "reconcile_status", "request_cancel"]);
    assert.equal(validateOnlyActionRequest.run_record.action_request?.target_refs?.writable_target_ref, "target:fixture/contact-form");
    assert.deepEqual(validateOnlyActionRequest.run_record.evidence_refs, ["evidence_fixture_write_precheck"]);
    const actionRequest = validateOnlyActionRequest.run_record.action_request;
    assert(actionRequest, "validate-only run must carry action request");
    const approvalEvidenceRefs = [...(actionRequest.evidence_refs ?? [])];
    const approvalRunBase = {
      task_intent_ref: actionRequest.task_intent_ref,
      entrypoint_ref: "entrypoint:app",
      capability_ref: actionRequest.capability_ref,
      ...(actionRequest.capability_version === undefined ? {} : { capability_version: actionRequest.capability_version }),
      ...(actionRequest.capability_source_ref === undefined ? {} : { capability_source_ref: actionRequest.capability_source_ref }),
      ...(actionRequest.capability_lock_ref === undefined ? {} : { capability_lock_ref: actionRequest.capability_lock_ref }),
      ...(actionRequest.package_ref === undefined ? {} : { package_ref: actionRequest.package_ref })
    };
    const approvalRequest = {
      schema_version: "webenvoy.approval-request.v0" as const,
      approval_request_id: "approval-request:fixture/preview-contact-form",
      action_request_id: actionRequest.action_request_id,
      task_intent_ref: actionRequest.task_intent_ref,
      status: "pending" as const,
      requested_at: "2026-07-01T00:00:10.000Z",
      expires_at: "2026-07-01T00:10:10.000Z",
      risk: "write" as const,
      blocking_reasons: ["approval_required_before_submit"],
      source_refs: actionRequest.no_submit_guard.source_refs,
      evidence_refs: approvalEvidenceRefs,
      consumer_boundary: "Core stores approval state and refs only; this is not approval execution or submitted result evidence."
    };
    const pendingApproval = await store.createRunRecord({
      run_id: "run_self_check_approval_pending",
      status: "requires_user_action",
      ...approvalRunBase,
      admission: {
        decision: "requires_user_action",
        action_risk: "write",
        evidence_refs: approvalEvidenceRefs
      },
      action_request: actionRequest,
      approval_request: approvalRequest,
      evidence_refs: approvalEvidenceRefs,
      retention_state: "active"
    });
    assert.equal(pendingApproval.status, "requires_user_action");
    assert.equal(pendingApproval.approval_request?.status, "pending");

    await store.createRunRecord({
      run_id: "run_self_check_approval_expired",
      status: "expired",
      ...approvalRunBase,
      admission: { decision: "requires_user_action", action_risk: "write" },
      action_request: actionRequest,
      approval_request: { ...approvalRequest, approval_request_id: "approval-request:fixture/expired", status: "expired", expires_at: "2026-07-01T00:00:00.000Z" },
      retention_state: "active"
    });
    await store.createRunRecord({
      run_id: "run_self_check_approval_blocked",
      status: "failed",
      ...approvalRunBase,
      admission: { decision: "blocked_pre_admission", action_risk: "write" },
      action_request: actionRequest,
      approval_request: { ...approvalRequest, approval_request_id: "approval-request:fixture/blocked", status: "blocked", blocking_reasons: ["approval_blocked_by_policy"] },
      failure: {
        category: "action_risk",
        code: "approval_blocked",
        phase: "admission",
        recovery_hint: "show_blocked_approval_state"
      },
      retention_state: "active"
    });
    const cancelledApproval = await store.createRunRecord({
      run_id: "run_self_check_approval_cancelled",
      status: "cancelled",
      ...approvalRunBase,
      admission: { decision: "requires_user_action", action_risk: "write" },
      action_request: actionRequest,
      failure: {
        category: "action_risk",
        code: "user_cancelled",
        phase: "admission",
        recovery_hint: "record_cancellation_without_submit"
      },
      retention_state: "active"
    });
    assert.equal(cancelledApproval.status, "cancelled");
    const approvalQuery = await getApprovalCancellationSummary(store, actionRequest.action_request_id);
    assert.equal(approvalQuery.schema_version, approvalCancellationQuerySchemaVersion);
    assert.equal(approvalQuery.latest_status, "cancelled");
    assert.equal(approvalQuery.approval_requests.length, 3);
    assert.equal(approvalQuery.cancellations[0]?.failure_code, "user_cancelled");
    assert.equal(JSON.stringify(approvalQuery).includes("submitted_result_ref"), false);

    const brokenResourceContract = {
      ...lodeReadPublicPageContract,
      resource_requirements: {
        ...lodeReadPublicPageContract.resource_requirements,
        package_ref: "lode://site-capability/example/other@0.1.0"
      }
    };
    const invalidContract = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_invalid_contract",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: brokenResourceContract
    });
    assert.equal(invalidContract.ok, false);
    if (invalidContract.ok || !invalidContract.run_record) {
      throw new Error("invalid Lode contract must create a failed Run Record");
    }
    assert.equal(invalidContract.failure.code, "invalid_contract");
    assert.equal(invalidContract.run_record.status, "failed");
    assert.equal(invalidContract.run_record.failure?.category, "capability_contract");
    assert.deepEqual(await store.getRunRecord("run_self_check_lode_invalid_contract"), invalidContract.run_record);

    const lockMismatch = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_lock_mismatch",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_fixture_lock_mismatch_001",
        capability: {
          ...(taskIntent.capability as Record<string, unknown>),
          lock_ref: "lode://lock/site-capability/example/read-public-page@0.0.9"
        }
      },
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract
    });
    assert.equal(lockMismatch.ok, false);
    assert.equal(lockMismatch.failure.code, "package_lock_mismatch");

    const brokenLifecycle = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_broken_lifecycle",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: {
        ...lodeReadPublicPageContract,
        lifecycle: "broken"
      }
    });
    assert.equal(brokenLifecycle.ok, false);
    assert.equal(brokenLifecycle.failure.code, "capability_broken");
    assert.equal(brokenLifecycle.failure.attribution, "capability");

    const writeContract = {
      ...lodeReadPublicPageContract,
      operation_mode: "write",
      resource_requirements: {
        ...lodeReadPublicPageContract.resource_requirements,
        operation_mode: "write"
      }
    };
    const writeRejected = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_write_deferred",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: writeContract
    });
    assert.equal(writeRejected.ok, false);
    assert.equal(writeRejected.failure.code, "true_write_deferred");
    assert.equal(writeRejected.run_record?.status, "failed");
    assert.equal(writeRejected.run_record?.admission.decision, "deferred_true_write");
    assert.equal(writeRejected.run_record?.admission.action_risk, "write");
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
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  assert.equal(admitted.status, "admitted");
  await assert.rejects(() => store.updateRunRecord(runId, { status: "succeeded", result_ref: "result:fixture/too-early" }), /illegal run status transition/);

  const running = await store.updateRunRecord(runId, {
    status: "running",
    evidence_refs: ["evidence:fixture/admission-ready", "evidence:fixture/run-started"]
  });
  assert.equal(running.status, "running");

  const completed = await completeRunWithResult(store, runId, {
    result_ref: "result:fixture/read-page-summary",
    result_kind: "content_detail",
    output_schema_id: "example.read-public-page.output",
    data: {
      title: "Example Domain",
      summary: "Reserved public Example Domain fixture summary."
    },
    projection_ref: "projection:fixture/read-page-summary",
    raw_payload_refs: ["raw-payload:fixture/redacted"],
    source_refs: ["source-trace:fixture/read-public-page"],
    evidence_refs: ["evidence:fixture/result-summary"],
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Required public title and summary fields were projected.",
      checked_at: "2026-07-01T00:00:03.000Z",
      evidence_refs: ["evidence:fixture/result-summary"],
      source_refs: ["source-trace:fixture/read-public-page"],
      consumer_boundary: "Core stores post-check refs and public status only."
    },
    retention_state: "active"
  });
  const succeeded = completed.run_record;
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.terminal_at, "2026-07-01T00:00:03.000Z");
  assert.equal(completed.result_envelope.ok, true);
  assert.equal(completed.result_envelope.outcome, "success");
  assert.equal(completed.result_envelope.run_record_ref, runId);
  assert.equal(completed.result_envelope.result_ref, succeeded.result_ref);
  assert.equal(completed.result_envelope.output_schema_id, "example.read-public-page.output");
  assertRefsOnly(succeeded);
  assert.deepEqual(projectRunSummary(succeeded), {
    schema_version: runQuerySchemaVersion,
    run_id: runId,
    status: "succeeded",
    timeline: {
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:03.000Z",
      terminal_at: "2026-07-01T00:00:03.000Z"
    },
    task: {
      task_intent_ref: "intent_fixture_read_only_001",
      capability_ref: "lode:capability/read-public-page",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/example/read-public-page@0.1.0",
      capability_lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
      entrypoint_ref: "entrypoint:api",
      package_ref: "lode://site-capability/example/read-public-page@0.1.0"
    },
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      resource_match_ref: "resource-match:fixture/ready"
    },
    runtime_refs: {
      binding_refs: harborRuntimeBindingRefs,
      admission_binding_refs: harborRuntimeBindingRefs
    },
    terminal_summary: {
      terminal: true,
      status: "succeeded",
      terminal_at: "2026-07-01T00:00:03.000Z",
      result_ref: "result:fixture/read-page-summary",
      post_check: {
        schema_version: "webenvoy.post-check-result.v0",
        status: "passed",
        summary: "Required public title and summary fields were projected.",
        checked_at: "2026-07-01T00:00:03.000Z"
      },
      retention_state: "active"
    }
  });

  const reloaded = await store.getRunRecord(runId);
  assert.deepEqual(reloaded, succeeded);
  assert.deepEqual(await getRunSummary(store, runId), {
    ok: true,
    run: projectRunSummary(succeeded)
  });
  const successResultQuery = projectRunResult(succeeded);
  assert.equal(successResultQuery.result.envelope_state, "available");
  assert.equal(successResultQuery.result.payload_state, "not_persisted_in_core");
  assert.equal(successResultQuery.result.result_envelope?.ok, true);
  assert.equal(successResultQuery.result.result_envelope?.result_ref, "result:fixture/read-page-summary");
  assert.deepEqual(
    successResultQuery.evidence_refs.map((ref) => ({
      ref: ref.ref,
      source: ref.source,
      state: ref.state,
      raw_access: ref.raw_access,
      capability_ref: ref.capability_ref,
      capability_version: ref.capability_version
    })),
    [
      ...harborEvidenceRefs.map((ref) => ({
        ref,
        source: "admission" as const,
        state: "available" as const,
        raw_access: "not_available_from_core" as const,
        capability_ref: "lode:capability/read-public-page",
        capability_version: "0.1.0"
      })),
      {
        ref: "evidence:fixture/result-summary",
        source: "terminal",
        state: "available",
        raw_access: "not_available_from_core",
        capability_ref: "lode:capability/read-public-page",
        capability_version: "0.1.0"
      }
    ]
  );
  assert.deepEqual(await getRunResult(store, runId), {
    ok: true,
    result: successResultQuery
  });
  assert.deepEqual(await getRunEvidenceRefs(store, runId), {
    ok: true,
    evidence: {
      schema_version: "webenvoy.evidence-refs-query.v0",
      run_id: runId,
      status: "succeeded",
      evidence_refs: successResultQuery.evidence_refs
    }
  });
  assert.deepEqual(await getRunSummary(store, "missing_run"), {
    ok: false,
    failure: {
      category: "persistence_observability",
      code: "run_not_found",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  assert.deepEqual(await getRunResult(store, "missing_run"), {
    ok: false,
    failure: {
      category: "persistence_observability",
      code: "run_not_found",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  assert.deepEqual(await getRunSummary(store, "../bad"), {
    ok: false,
    failure: {
      category: "request_invalid",
      code: "run_id_invalid",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  assert.deepEqual(await getRunEvidenceRefs(store, "../bad"), {
    ok: false,
    failure: {
      category: "request_invalid",
      code: "run_id_invalid",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  const detachedGetRunRecord = store.getRunRecord;
  assert.deepEqual(await detachedGetRunRecord(runId), succeeded);
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${runId}.json`), "utf8")), succeeded);

  const failedId = "run_self_check_failure_001";
  await store.createRunRecord({
    ...baseInput(failedId),
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      runtime_binding_refs: harborRuntimeBindingRefs,
      evidence_refs: harborEvidenceRefs,
      resource_match_ref: "resource-match:fixture/ready"
    }
  });
  await store.updateRunRecord(failedId, {
    status: "admitted",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  await store.updateRunRecord(failedId, {
    status: "running",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  const failedOutput = await completeRunWithFailure(store, failedId, {
    evidence_refs: ["evidence:fixture/output-invalid"],
    failure: {
      category: "result_projection",
      code: "output_invalid",
      phase: "projection",
      recovery_hint: "repair_package"
    },
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "failed",
      summary: "Normalized output did not satisfy the public result contract.",
      checked_at: "2026-07-01T00:00:07.000Z",
      code: "output_invalid",
      attribution: "capability",
      recovery_hint: "repair_package",
      evidence_refs: ["evidence:fixture/output-invalid"],
      consumer_boundary: "Core stores post-check refs and public status only."
    },
    retention_state: "active"
  });
  const failed = failedOutput.run_record;
  assert.equal(failed.failure?.category, "result_projection");
  assert.equal(failed.failure?.attribution, "capability");
  assert.equal(failed.terminal_at, "2026-07-01T00:00:07.000Z");
  assert.equal(failedOutput.result_envelope.ok, false);
  assert.equal(failedOutput.result_envelope.outcome, "failed");
  assert.equal(failedOutput.result_envelope.failure?.code, "output_invalid");
  assert.equal(failedOutput.result_envelope.post_check?.status, "failed");
  const failedResultQuery = await getRunResult(store, failedId);
  assert.equal(failedResultQuery.ok, true);
  if (!failedResultQuery.ok) {
    throw new Error("failed run result query must be available");
  }
  assert.equal(failedResultQuery.result.result.result_envelope?.ok, false);
  assert.equal(failedResultQuery.result.failure?.code, "output_invalid");
  assert.equal(failedResultQuery.result.failure?.attribution, "capability");
  assert.equal(failedResultQuery.result.result.payload_state, "not_persisted_in_core");

  const capabilityRuns = await getCapabilityRunSummary(store, {
    capability_ref: "lode:capability/read-public-page",
    capability_version: "0.1.0"
  });
  assert.equal(capabilityRuns.ok, true);
  if (!capabilityRuns.ok) {
    throw new Error("capability run query must succeed");
  }
  assert.equal(capabilityRuns.capability_runs.schema_version, capabilityRunQuerySchemaVersion);
  assert.equal(capabilityRuns.capability_runs.total_runs, 2);
  assert.equal(capabilityRuns.capability_runs.status_counts.succeeded, 1);
  assert.equal(capabilityRuns.capability_runs.status_counts.failed, 1);
  assert.equal(capabilityRuns.capability_runs.failure_attribution_counts.capability, 1);
  assert.equal(capabilityRuns.capability_runs.latest_failure?.run_id, failedId);
  assert.equal(capabilityRuns.capability_runs.latest_failure?.post_check?.status, "failed");

  const cancelledId = "run_self_check_cancelled_001";
  await store.createRunRecord(baseInput(cancelledId));
  const cancelled = await store.updateRunRecord(cancelledId, {
    status: "cancelled",
    evidence_refs: ["evidence:fixture/cancelled-by-user"]
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.terminal_at, "2026-07-01T00:00:09.000Z");

  const redactedId = "run_self_check_redacted_001";
  await store.createRunRecord(baseInput(redactedId));
  await store.updateRunRecord(redactedId, {
    status: "admitted",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  await store.updateRunRecord(redactedId, {
    status: "running",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  await completeRunWithResult(store, redactedId, {
    result_ref: "result:fixture/redacted-summary",
    result_kind: "content_detail",
    projection_ref: "projection:fixture/redacted-summary",
    evidence_refs: ["evidence:fixture/redacted-summary"],
    retention_state: "redacted"
  });
  const redactedResultQuery = await getRunResult(store, redactedId);
  assert.equal(redactedResultQuery.ok, true);
  if (!redactedResultQuery.ok) {
    throw new Error("redacted run result query must be available");
  }
  assert.equal(redactedResultQuery.result.result.envelope_state, "redacted");
  assert.equal(redactedResultQuery.result.result.payload_state, "redacted");
  assert.equal(redactedResultQuery.result.evidence_refs.at(-1)?.state, "redacted");

  await assert.rejects(() => store.updateRunRecord(runId, { status: "running" }), /terminal/);
  await assert.rejects(() => store.updateRunRecord(cancelledId, { status: "running" }), /terminal/);
  await assert.rejects(() => store.createRunRecord({ ...baseInput("../bad"), run_id: "../bad" }), /run_id/);
  await assert.rejects(() => store.createRunRecord({ ...baseInput("run_self_check_empty_ref"), entrypoint_ref: "" }), /entrypoint_ref/);
  const invalidRefId = "run_self_check_invalid_ref_patch";
  await store.createRunRecord(baseInput(invalidRefId));
  await assert.rejects(() => store.updateRunRecord(invalidRefId, { result_ref: "" }), /result_ref/);
  const pendingResultQuery = await getRunResult(store, invalidRefId);
  assert.equal(pendingResultQuery.ok, true);
  if (!pendingResultQuery.ok) {
    throw new Error("pending run result query must return unavailable state");
  }
  assert.equal(pendingResultQuery.result.result.envelope_state, "unavailable");
  assert.equal(pendingResultQuery.result.result.unavailable_reason, "run_not_terminal");
  await assert.rejects(
    () =>
      completeRunWithResult(store, invalidRefId, {
        result_ref: "result:fixture/unsafe",
        result_kind: "content_detail",
        data: {
          token: "must-not-enter-core"
        },
        evidence_refs: ["evidence:fixture/unsafe"]
      }),
    /forbidden field: token/
  );

  const detachedListRunRecords = store.listRunRecords;
  assert.deepEqual(
    (await detachedListRunRecords()).map((record) => record.run_id),
    [cancelledId, failedId, invalidRefId, runId, redactedId]
  );

  console.log("Validated Run Record file store with 5 durable records.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

await assertTaskSubmissionAdmission();
console.log("Validated read-only task submission admission.");
