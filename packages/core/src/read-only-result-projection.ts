import { completeRunWithFailure, completeRunWithResult, type CompletedRunOutput } from "./result-envelope.js";
import type { FailureRecord, FileRunRecordStore, PostCheckResult, RetentionState } from "./run-record-store.js";

export type LodeProjectionRef = string | ({ ref_id: string } & Record<string, unknown>);

export type LodeReadOnlyProjection = {
  result_kind: string;
  status: "available" | "empty" | "unavailable";
  classification: "success_result" | "partial_result" | "empty_result" | "not_normalizable";
  normalized: Record<string, unknown> | null;
  source_refs: readonly LodeProjectionRef[];
  evidence_refs: readonly LodeProjectionRef[];
  empty_reason?: string;
  unavailable_reason?: string;
  warnings?: readonly string[];
};

export type LodeReadOnlyFailureClass =
  | "invalid_contract"
  | "empty_result"
  | "not_logged_in"
  | "login_expired"
  | "identity_insufficient"
  | "captcha_required"
  | "safety_challenge"
  | "page_changed"
  | "page_not_ready"
  | "site_changed"
  | "field_missing"
  | "network_resource_unavailable"
  | "resource_unavailable"
  | "signed_ref_missing"
  | "input_missing_security_id"
  | "query_missing"
  | "city_unresolved"
  | "pagination_limited"
  | "job_expired"
  | "permission_denied";

export type CompleteReadOnlyProjectionInput = {
  result_ref: string;
  output_schema_id: string;
  projection: LodeReadOnlyProjection;
  projection_ref?: string;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type CompleteReadOnlyFailureInput = {
  lode_failure_class: LodeReadOnlyFailureClass;
  evidence_refs?: readonly string[];
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

function refId(value: LodeProjectionRef, label: string): string {
  const ref = typeof value === "string" ? value : value.ref_id;
  if (ref.length === 0) throw new Error(`${label} must not be empty`);
  return ref;
}

function projectionRefs(values: readonly LodeProjectionRef[], label: string): string[] {
  return values.map((value, index) => refId(value, `${label}[${index}]`));
}

function lodeFailure(failureClass: LodeReadOnlyFailureClass): { status: "failed" | "blocked" | "requires_user_action"; failure: FailureRecord } {
  switch (failureClass) {
    case "invalid_contract":
      return { status: "failed", failure: { category: "capability_contract", code: failureClass, phase: "projection", recovery_hint: "repair_package" } };
    case "empty_result":
      return { status: "failed", failure: { category: "result_projection", code: failureClass, phase: "projection", recovery_hint: "fix_input" } };
    case "not_logged_in":
    case "login_expired":
      return { status: "requires_user_action", failure: { category: "resource_admission", code: failureClass, phase: "runtime_binding", recovery_hint: "open_manual_auth" } };
    case "identity_insufficient":
      return { status: "requires_user_action", failure: { category: "resource_admission", code: failureClass, phase: "runtime_binding", recovery_hint: "switch_identity" } };
    case "captcha_required":
    case "safety_challenge":
      return { status: "blocked", failure: { category: "runtime_execution", code: failureClass, phase: "execution", recovery_hint: "manual_handoff" } };
    case "page_changed":
    case "page_not_ready":
      return { status: "blocked", failure: { category: "runtime_execution", code: failureClass, phase: "execution", recovery_hint: "retry_after_refresh" } };
    case "network_resource_unavailable":
      return { status: "blocked", failure: { category: "evidence_reference", code: failureClass, phase: "evidence", recovery_hint: "rerun_with_evidence" } };
    case "resource_unavailable":
      return { status: "blocked", failure: { category: "runtime_execution", code: failureClass, phase: "execution", recovery_hint: "retry_after_refresh" } };
    case "signed_ref_missing":
    case "input_missing_security_id":
    case "query_missing":
    case "city_unresolved":
    case "pagination_limited":
      return { status: "failed", failure: { category: "request_invalid", code: failureClass, phase: "projection", recovery_hint: "fix_input" } };
    case "job_expired":
      return { status: "failed", failure: { category: "result_projection", code: failureClass, phase: "projection", recovery_hint: "choose_another_result" } };
    case "permission_denied":
      return { status: "requires_user_action", failure: { category: "resource_admission", code: failureClass, phase: "runtime_binding", recovery_hint: "open_manual_auth" } };
    case "site_changed":
    case "field_missing":
      return { status: "failed", failure: { category: "result_projection", code: failureClass, phase: "projection", recovery_hint: "repair_package" } };
  }
}

export async function completeRunWithReadOnlyProjection(store: FileRunRecordStore, runId: string, input: CompleteReadOnlyProjectionInput): Promise<CompletedRunOutput> {
  const projection = input.projection;
  const evidenceRefs = projectionRefs(projection.evidence_refs, "projection.evidence_refs");
  if (projection.status === "unavailable" || projection.classification === "not_normalizable" || projection.normalized === null) {
    return completeRunWithFailure(store, runId, {
      failure: {
        category: "result_projection",
        code: projection.unavailable_reason ?? projection.empty_reason ?? projection.classification,
        phase: "projection",
        recovery_hint: "repair_package"
      },
      evidence_refs: evidenceRefs,
      ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
      ...(input.retention_state === undefined ? {} : { retention_state: input.retention_state })
    });
  }

  return completeRunWithResult(store, runId, {
    result_ref: input.result_ref,
    result_kind: projection.result_kind,
    output_schema_id: input.output_schema_id,
    data: { projection },
    persisted_public_summary: { projection },
    source_refs: projectionRefs(projection.source_refs, "projection.source_refs"),
    evidence_refs: evidenceRefs,
    ...(input.projection_ref === undefined ? {} : { projection_ref: input.projection_ref }),
    ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
    ...(input.retention_state === undefined ? {} : { retention_state: input.retention_state })
  });
}

export async function completeRunWithReadOnlyFailure(store: FileRunRecordStore, runId: string, input: CompleteReadOnlyFailureInput): Promise<CompletedRunOutput> {
  const mapped = lodeFailure(input.lode_failure_class);
  return completeRunWithFailure(store, runId, {
    status: mapped.status,
    failure: mapped.failure,
    ...(input.evidence_refs === undefined ? {} : { evidence_refs: input.evidence_refs }),
    ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
    ...(input.retention_state === undefined ? {} : { retention_state: input.retention_state })
  });
}
