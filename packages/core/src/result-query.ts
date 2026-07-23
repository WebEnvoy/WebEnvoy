import { resultEnvelopeSchemaVersion, type ResultEnvelope, type ResultOutcome } from "./result-envelope.js";
import { normalizeFailureRecord } from "./failure-attribution.js";
import {
  terminalRunRecordStatuses,
  type FailureRecord,
  type FileRunRecordStore,
  type RetentionState,
  type RunRecord,
  type RunRecordStatus
} from "./run-record-store.js";

export const resultQuerySchemaVersion = "webenvoy.result-query.v0";
export const evidenceRefsQuerySchemaVersion = "webenvoy.evidence-refs-query.v0";
export const failureReasonQuerySchemaVersion = "webenvoy.failure-reason-query.v0";

export type EvidenceRefSource = "admission" | "terminal" | "admission_and_terminal";
export type EvidenceRefState = "available" | "missing" | "expired" | "redacted" | "access_denied" | "deleted_by_policy";
export type ResultEnvelopeState = "available" | "unavailable" | "redacted";
export type ResultPayloadState = "available" | "not_persisted_in_core" | "unavailable" | "redacted" | "expired" | "access_denied" | "deleted_by_policy";
export type ResultUnavailableReason = "run_not_terminal" | "result_ref_missing";
export type FailureReasonClass =
  | "none"
  | "login_required"
  | "page_changed"
  | "field_unavailable"
  | "risk_prompt"
  | "runtime_unavailable"
  | "resource_unavailable"
  | "evidence_unavailable"
  | "capability_failure"
  | "request_invalid"
  | "unknown";

export type EvidenceRefSummary = {
  ref: string;
  source: EvidenceRefSource;
  state: EvidenceRefState;
  retention_state?: RetentionState;
  redaction_state?: "none" | "summary_only" | "redacted";
  raw_access: "not_available_from_core";
  recorded_at: string;
  runtime_session_ref?: string;
  consumer_boundary: string;
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  package_ref?: string;
};

export type ResultQueryEnvelope = {
  schema_version: typeof resultQuerySchemaVersion;
  run_id: string;
  status: RunRecordStatus;
  terminal: boolean;
  result: {
    envelope_state: ResultEnvelopeState;
    payload_state: ResultPayloadState;
    unavailable_reason?: ResultUnavailableReason;
    result_ref?: string;
    result_envelope?: ResultEnvelope;
    retention_state?: RetentionState;
  };
  failure?: FailureRecord;
  evidence_refs: EvidenceRefSummary[];
};

export type FailureReasonQueryEnvelope = {
  schema_version: typeof failureReasonQuerySchemaVersion;
  run_id: string;
  status: RunRecordStatus;
  terminal: boolean;
  failure_present: boolean;
  reason_class: FailureReasonClass;
  failure?: FailureRecord;
  recovery_hint?: string;
  app_action: string;
  retryable: boolean;
  evidence_refs: EvidenceRefSummary[];
  consumer_boundary: string;
};

export type EvidenceRefsQueryEnvelope = {
  schema_version: typeof evidenceRefsQuerySchemaVersion;
  run_id: string;
  status: RunRecordStatus;
  evidence_refs: EvidenceRefSummary[];
};

export type ResultQueryResult =
  | {
      ok: true;
      result: ResultQueryEnvelope;
    }
  | {
      ok: false;
      failure: FailureRecord;
    };

export type FailureReasonQueryResult =
  | {
      ok: true;
      failure_reason: FailureReasonQueryEnvelope;
    }
  | {
      ok: false;
      failure: FailureRecord;
    };

export type EvidenceRefsQueryResult =
  | {
      ok: true;
      evidence: EvidenceRefsQueryEnvelope;
    }
  | {
      ok: false;
      failure: FailureRecord;
    };

function queryFailure(code: string, category: FailureRecord["category"], recoveryHint: string): FailureRecord {
  return {
    category,
    code,
    phase: "query",
    recovery_hint: recoveryHint
  };
}

function resultOutcome(status: RunRecordStatus): ResultOutcome {
  return status === "succeeded" ? "success" : (status as ResultOutcome);
}

function evidenceState(retentionState: RetentionState | undefined): Pick<EvidenceRefSummary, "state" | "retention_state" | "redaction_state"> {
  if (retentionState === "expired") {
    return { state: "expired", retention_state: retentionState };
  }
  if (retentionState === "access_denied") {
    return { state: "access_denied", retention_state: retentionState };
  }
  if (retentionState === "deleted_by_policy") {
    return { state: "deleted_by_policy", retention_state: retentionState };
  }
  if (retentionState === "summary_only") {
    return { state: "redacted", retention_state: retentionState, redaction_state: "summary_only" };
  }
  if (retentionState === "redacted") {
    return { state: "redacted", retention_state: retentionState, redaction_state: "redacted" };
  }
  return { state: "available", ...(retentionState === undefined ? {} : { retention_state: retentionState }), redaction_state: "none" };
}

function resultStates(record: RunRecord): Pick<ResultQueryEnvelope["result"], "envelope_state" | "payload_state" | "unavailable_reason"> {
  if (!terminalRunRecordStatuses.has(record.status)) {
    return {
      envelope_state: "unavailable",
      payload_state: "unavailable",
      unavailable_reason: "run_not_terminal"
    };
  }
  if (record.status === "expired") {
    return {
      envelope_state: "unavailable",
      payload_state: "expired"
    };
  }
  if (record.status === "succeeded" && record.result_ref === undefined) {
    return {
      envelope_state: "unavailable",
      payload_state: "unavailable",
      unavailable_reason: "result_ref_missing"
    };
  }
  if (record.retention_state === "summary_only" || record.retention_state === "redacted") {
    return {
      envelope_state: "redacted",
      payload_state: "redacted"
    };
  }
  if (record.retention_state === "expired") {
    return {
      envelope_state: "available",
      payload_state: "expired"
    };
  }
  if (record.retention_state === "access_denied") {
    return {
      envelope_state: "available",
      payload_state: "access_denied"
    };
  }
  if (record.retention_state === "deleted_by_policy") {
    return {
      envelope_state: "available",
      payload_state: "deleted_by_policy"
    };
  }
  return {
    envelope_state: "available",
    payload_state: record.public_result_summary === undefined ? "not_persisted_in_core" : "available"
  };
}

function resultEnvelope(record: RunRecord): ResultEnvelope | undefined {
  if (!terminalRunRecordStatuses.has(record.status) || record.status === "expired") {
    return undefined;
  }
  const ok = record.status === "succeeded";
  return {
    schema_version: resultEnvelopeSchemaVersion,
    run_record_ref: record.run_id,
    ok,
    outcome: resultOutcome(record.status),
    terminal: true,
    capability_ref: record.capability_ref,
    ...(record.capability_version === undefined ? {} : { capability_version: record.capability_version }),
    ...(record.capability_source_ref === undefined ? {} : { capability_source_ref: record.capability_source_ref }),
    ...(record.capability_lock_ref === undefined ? {} : { capability_lock_ref: record.capability_lock_ref }),
    ...(record.result_ref === undefined ? {} : { result_ref: record.result_ref }),
    ...(record.result_kind === undefined ? {} : { result_kind: record.result_kind }),
    ...(record.output_schema_id === undefined ? {} : { output_schema_id: record.output_schema_id }),
    ...(record.projection_ref === undefined ? {} : { projection_ref: record.projection_ref }),
    ...(record.public_result_summary === undefined || (record.retention_state !== undefined && record.retention_state !== "active")
      ? {}
      : { data: record.public_result_summary }),
    ...(record.package_ref === undefined ? {} : { package_ref: record.package_ref }),
    ...(record.source_refs === undefined ? {} : { source_refs: [...record.source_refs] }),
    ...(record.evidence_refs === undefined ? {} : { evidence_refs: [...record.evidence_refs] }),
    ...(record.preview_result === undefined ? {} : { preview_result: record.preview_result }),
    ...(record.failure === undefined ? {} : { failure: normalizeFailureRecord(record.failure) }),
    ...(record.post_check === undefined ? {} : { post_check: record.post_check }),
    ...(record.retention_state === undefined ? {} : { retention_state: record.retention_state })
  };
}

function failureReasonClass(failure: FailureRecord | undefined): FailureReasonClass {
  if (!failure) return "none";
  if (["identity_auth_required", "not_logged_in", "login_expired", "identity_insufficient"].includes(failure.code)) return "login_required";
  if (["page_changed", "page_not_ready", "site_changed", "source_shape_changed", "source_schema_changed"].includes(failure.code)) return "page_changed";
  if (["field_missing", "field_not_visible", "field_unavailable", "writable_target_missing", "selector_unstable", "mapping_incomplete"].includes(failure.code)) return "field_unavailable";
  if (["risk_prompt", "risk_challenge", "captcha_required", "safety_challenge", "anti_automation_challenge"].includes(failure.code)) return "risk_prompt";
  if (failure.category === "evidence_reference" || failure.code.startsWith("evidence_") || failure.code === "snapshot_missing") return "evidence_unavailable";
  if (failure.category === "capability_contract" || failure.category === "result_projection") return "capability_failure";
  if (failure.category === "request_invalid") return "request_invalid";
  if (failure.category === "resource_admission") return failure.phase === "runtime_binding" ? "runtime_unavailable" : "resource_unavailable";
  if (failure.category === "runtime_execution") return "runtime_unavailable";
  if (failure.category === "action_risk") return "risk_prompt";
  return "unknown";
}

function appActionForFailure(failure: FailureRecord | undefined, reasonClass: FailureReasonClass): string {
  if (!failure) return "none";
  if (failure.recovery_hint) return failure.recovery_hint;
  switch (reasonClass) {
    case "login_required":
      return "open_manual_auth";
    case "page_changed":
    case "field_unavailable":
      return "retry_after_refresh";
    case "risk_prompt":
      return "manual_handoff";
    case "runtime_unavailable":
      return "connect_runtime";
    case "evidence_unavailable":
      return "rerun_with_evidence";
    case "capability_failure":
      return "repair_package";
    case "request_invalid":
      return "fix_input";
    case "resource_unavailable":
      return "select_matching_runtime";
    case "unknown":
      return "contact_operator";
    case "none":
      return "none";
  }
}

function isRetryable(reasonClass: FailureReasonClass, appAction: string): boolean {
  if (reasonClass === "none" || reasonClass === "risk_prompt" || reasonClass === "request_invalid") return false;
  return ["connect_runtime", "open_manual_auth", "retry_after_refresh", "rerun_with_evidence", "select_matching_runtime"].includes(appAction);
}

function projectFailureReason(record: RunRecord): FailureReasonQueryEnvelope {
  const failure = record.failure === undefined ? undefined : normalizeFailureRecord(record.failure);
  const reasonClass = failureReasonClass(failure);
  const appAction = appActionForFailure(failure, reasonClass);
  return {
    schema_version: failureReasonQuerySchemaVersion,
    run_id: record.run_id,
    status: record.status,
    terminal: terminalRunRecordStatuses.has(record.status),
    failure_present: failure !== undefined,
    reason_class: reasonClass,
    ...(failure === undefined ? {} : { failure, recovery_hint: failure.recovery_hint }),
    app_action: appAction,
    retryable: isRetryable(reasonClass, appAction),
    evidence_refs: projectEvidenceRefs(record),
    consumer_boundary: "Core query returns machine-readable failure reason, recovery hint, and refs only; it does not execute recovery or expose raw browser evidence."
  };
}

export function projectEvidenceRefs(record: RunRecord): EvidenceRefSummary[] {
  const refs = new Map<string, EvidenceRefSource>();
  for (const ref of record.admission.evidence_refs ?? []) {
    refs.set(ref, "admission");
  }
  for (const ref of record.evidence_refs ?? []) {
    refs.set(ref, refs.has(ref) ? "admission_and_terminal" : "terminal");
  }
  const state = evidenceState(record.retention_state);
  const recordedAt = record.terminal_at ?? record.updated_at;
  const runtimeSessionRef = record.admission.runtime_session_binding?.runtime_session_ref;
  return [...refs.entries()].map(([ref, source]) => ({
    ref,
    source,
    ...state,
    raw_access: "not_available_from_core",
    recorded_at: recordedAt,
    ...(runtimeSessionRef === undefined ? {} : { runtime_session_ref: runtimeSessionRef }),
    consumer_boundary: "Core query returns refs and public state only; raw evidence bodies, screenshots, HAR, DOM, cookies, tokens, and viewer endpoints remain outside Core.",
    capability_ref: record.capability_ref,
    ...(record.capability_version === undefined ? {} : { capability_version: record.capability_version }),
    ...(record.capability_source_ref === undefined ? {} : { capability_source_ref: record.capability_source_ref }),
    ...(record.package_ref === undefined ? {} : { package_ref: record.package_ref })
  }));
}

export function projectRunResult(record: RunRecord): ResultQueryEnvelope {
  const states = resultStates(record);
  const envelope = resultEnvelope(record);
  return {
    schema_version: resultQuerySchemaVersion,
    run_id: record.run_id,
    status: record.status,
    terminal: terminalRunRecordStatuses.has(record.status),
    result: {
      ...states,
      ...(record.result_ref === undefined ? {} : { result_ref: record.result_ref }),
      ...(envelope === undefined ? {} : { result_envelope: envelope }),
      ...(record.retention_state === undefined ? {} : { retention_state: record.retention_state })
    },
    ...(record.failure === undefined ? {} : { failure: normalizeFailureRecord(record.failure) }),
    evidence_refs: projectEvidenceRefs(record)
  };
}

async function getRecord(store: FileRunRecordStore, runId: string): Promise<{ ok: true; record: RunRecord } | { ok: false; failure: FailureRecord }> {
  let record: RunRecord | undefined;
  try {
    record = await store.getRunRecord(runId);
  } catch (error) {
    if (error instanceof Error && /run_id/.test(error.message)) {
      return { ok: false, failure: queryFailure("run_id_invalid", "request_invalid", "fix_input") };
    }
    throw error;
  }
  if (!record) {
    return { ok: false, failure: queryFailure("run_not_found", "persistence_observability", "fix_input") };
  }
  return { ok: true, record };
}

export async function getRunResult(store: FileRunRecordStore, runId: string): Promise<ResultQueryResult> {
  const record = await getRecord(store, runId);
  if (!record.ok) return record;
  return {
    ok: true,
    result: projectRunResult(record.record)
  };
}

export async function getRunEvidenceRefs(store: FileRunRecordStore, runId: string): Promise<EvidenceRefsQueryResult> {
  const record = await getRecord(store, runId);
  if (!record.ok) return record;
  return {
    ok: true,
    evidence: {
      schema_version: evidenceRefsQuerySchemaVersion,
      run_id: record.record.run_id,
      status: record.record.status,
      evidence_refs: projectEvidenceRefs(record.record)
    }
  };
}

export async function getRunFailureReason(store: FileRunRecordStore, runId: string): Promise<FailureReasonQueryResult> {
  const record = await getRecord(store, runId);
  if (!record.ok) return record;
  return {
    ok: true,
    failure_reason: projectFailureReason(record.record)
  };
}
