import { normalizeFailureRecord } from "./failure-attribution.js";
import type { FailureRecord, FileRunRecordStore, PostCheckResult, PreviewFailureClass, PreviewResult, PreviewResultState, RetentionState, RunRecord, RunRecordStatus } from "./run-record-store.js";

export const resultEnvelopeSchemaVersion = "webenvoy.result-envelope.v0";

export type ResultOutcome = "success" | "failed" | "blocked" | "requires_user_action" | "manual_recovery_required" | "unknown_outcome" | "cancelled";
export type FailureTerminalStatus = Extract<RunRecordStatus, "failed" | "blocked" | "requires_user_action" | "manual_recovery_required" | "unknown_outcome" | "cancelled">;

export type ResultEnvelope = {
  schema_version: typeof resultEnvelopeSchemaVersion;
  run_record_ref: string;
  ok: boolean;
  outcome: ResultOutcome;
  terminal: true;
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  capability_lock_ref?: string;
  result_ref?: string;
  result_kind?: string;
  package_ref?: string;
  output_schema_id?: string;
  data?: Record<string, unknown>;
  projection_ref?: string;
  raw_payload_refs?: string[];
  source_refs?: string[];
  evidence_refs?: string[];
  preview_result?: PreviewResult;
  failure?: FailureRecord;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type CompleteRunResultInput = {
  result_ref: string;
  result_kind: string;
  output_schema_id?: string;
  data?: Record<string, unknown>;
  persisted_public_summary?: Record<string, unknown>;
  projection_ref?: string;
  raw_payload_refs?: readonly string[];
  source_refs?: readonly string[];
  evidence_refs?: readonly string[];
  retention_state?: RetentionState;
  post_check?: PostCheckResult;
};

export type CompleteRunFailureInput = {
  status?: FailureTerminalStatus;
  failure: FailureRecord;
  evidence_refs?: readonly string[];
  retention_state?: RetentionState;
  post_check?: PostCheckResult;
};

export type CompleteRunPreviewInput = {
  result_ref: string;
  expected_change?: Record<string, unknown>;
  action_request_id?: string;
  evidence_refs?: readonly string[];
  preview_state?: PreviewResultState;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type CompletedRunOutput = {
  result_envelope: ResultEnvelope;
  run_record: RunRecord;
};

const resultForbiddenFieldNames = new Set([
  "raw_payload",
  "dom",
  "har",
  "screenshot",
  "video",
  "cookie",
  "cookies",
  "token",
  "tokens",
  "local_path",
  "profile_path",
  "runtime_session",
  "cdp_ref",
  "cdp_endpoint",
  "vnc_url",
  "viewer_url",
  "webSocketDebuggerUrl",
  "raw_evidence_body",
  "full_dom",
  "network_response_body",
  "provider_private_object"
]);

function requireRef(value: string, label: string): string {
  if (value.length === 0) throw new Error(`${label} must not be empty`);
  return value;
}

function copyRefs(values: readonly string[] | undefined, label: string): string[] | undefined {
  if (values === undefined) return undefined;
  return copyRequiredRefs(values, label);
}

function copyRequiredRefs(values: readonly string[], label: string): string[] {
  return values.map((value, index) => requireRef(value, `${label}[${index}]`));
}

function findForbiddenField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenField(entry);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (resultForbiddenFieldNames.has(key)) return key;
    const found = findForbiddenField(entry);
    if (found) return found;
  }
  return undefined;
}

function assertPublicData(data: Record<string, unknown> | undefined): void {
  const forbidden = findForbiddenField(data);
  if (forbidden) throw new Error(`result data contains forbidden field: ${forbidden}`);
}

function envelopeBase(
  record: RunRecord
): Pick<ResultEnvelope, "schema_version" | "run_record_ref" | "terminal" | "capability_ref" | "capability_version" | "capability_source_ref" | "capability_lock_ref" | "package_ref"> {
  return {
    schema_version: resultEnvelopeSchemaVersion,
    run_record_ref: record.run_id,
    terminal: true,
    capability_ref: record.capability_ref,
    ...(record.capability_version === undefined ? {} : { capability_version: record.capability_version }),
    ...(record.capability_source_ref === undefined ? {} : { capability_source_ref: record.capability_source_ref }),
    ...(record.capability_lock_ref === undefined ? {} : { capability_lock_ref: record.capability_lock_ref }),
    ...(record.package_ref === undefined ? {} : { package_ref: record.package_ref })
  };
}

export async function completeRunWithResult(store: FileRunRecordStore, runId: string, input: CompleteRunResultInput): Promise<CompletedRunOutput> {
  const current = await store.getRunRecord(runId);
  if (!current) throw new Error(`run record not found: ${runId}`);
  if (input.data === undefined && input.projection_ref === undefined) throw new Error("result envelope requires data or projection_ref");
  assertPublicData(input.data);
  assertPublicData(input.persisted_public_summary);

  const evidenceRefs = copyRefs(input.evidence_refs ?? current.evidence_refs, "evidence_refs");
  if (!evidenceRefs?.length) throw new Error("result envelope requires evidence_refs");
  const retentionState = input.retention_state ?? "active";
  const updated = await store.updateRunRecord(runId, {
    status: "succeeded",
    result_ref: requireRef(input.result_ref, "result_ref"),
    result_kind: requireRef(input.result_kind, "result_kind"),
    ...(input.output_schema_id === undefined ? {} : { output_schema_id: requireRef(input.output_schema_id, "output_schema_id") }),
    ...(input.projection_ref === undefined ? {} : { projection_ref: requireRef(input.projection_ref, "projection_ref") }),
    ...(input.persisted_public_summary === undefined ? {} : { public_result_summary: input.persisted_public_summary }),
    ...(input.source_refs === undefined ? {} : { source_refs: copyRequiredRefs(input.source_refs, "source_refs") }),
    evidence_refs: evidenceRefs,
    retention_state: retentionState,
    ...(input.post_check === undefined ? {} : { post_check: input.post_check })
  });

  return {
    run_record: updated,
    result_envelope: {
      ...envelopeBase(updated),
      ok: true,
      outcome: "success",
      result_ref: input.result_ref,
      result_kind: requireRef(input.result_kind, "result_kind"),
      ...(input.output_schema_id === undefined ? {} : { output_schema_id: requireRef(input.output_schema_id, "output_schema_id") }),
      ...(input.data === undefined ? {} : { data: input.data }),
      ...(input.projection_ref === undefined ? {} : { projection_ref: requireRef(input.projection_ref, "projection_ref") }),
      ...(input.raw_payload_refs === undefined ? {} : { raw_payload_refs: copyRequiredRefs(input.raw_payload_refs, "raw_payload_refs") }),
      ...(input.source_refs === undefined ? {} : { source_refs: copyRequiredRefs(input.source_refs, "source_refs") }),
      evidence_refs: evidenceRefs,
      ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
      retention_state: retentionState
    }
  };
}

export async function completeRunWithFailure(store: FileRunRecordStore, runId: string, input: CompleteRunFailureInput): Promise<CompletedRunOutput> {
  const status = input.status ?? "failed";
  const evidenceRefs = copyRefs(input.evidence_refs, "evidence_refs");
  const retentionState = input.retention_state ?? "active";
  const failure = normalizeFailureRecord(input.failure);
  const updated = await store.updateRunRecord(runId, {
    status,
    failure,
    ...(evidenceRefs === undefined ? {} : { evidence_refs: evidenceRefs }),
    retention_state: retentionState,
    ...(input.post_check === undefined ? {} : { post_check: input.post_check })
  });

  return {
    run_record: updated,
    result_envelope: {
      ...envelopeBase(updated),
      ok: false,
      outcome: status,
      ...(updated.evidence_refs === undefined ? {} : { evidence_refs: updated.evidence_refs }),
      failure,
      ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
      retention_state: retentionState
    }
  };
}

export async function completeRunWithPreviewResult(store: FileRunRecordStore, runId: string, input: CompleteRunPreviewInput): Promise<CompletedRunOutput> {
  const current = await store.getRunRecord(runId);
  if (!current) throw new Error(`run record not found: ${runId}`);
  assertPublicData(input.expected_change);
  const evidenceRefs = copyRefs(input.evidence_refs ?? current.evidence_refs ?? current.action_request?.evidence_refs, "evidence_refs");
  if (!evidenceRefs?.length) throw new Error("preview result envelope requires evidence_refs");
  const state = input.preview_state ?? "available";
  const action_request_id = requireRef(input.action_request_id ?? current.action_request?.action_request_id ?? "", "action_request_id");
  const failure_class = state === "available" ? undefined : (state as PreviewFailureClass);
  const preview_result: PreviewResult = {
    schema_version: "webenvoy.preview-result.v0",
    state,
    submitted: false,
    ...(input.expected_change === undefined ? {} : { expected_change: input.expected_change }),
    action_refs: { action_request_id },
    capability: {
      capability_ref: current.capability_ref,
      ...(current.capability_version === undefined ? {} : { capability_version: current.capability_version }),
      ...(current.capability_source_ref === undefined ? {} : { capability_source_ref: current.capability_source_ref }),
      ...(current.capability_lock_ref === undefined ? {} : { capability_lock_ref: current.capability_lock_ref }),
      ...(current.package_ref === undefined ? {} : { package_ref: current.package_ref })
    },
    evidence_refs: evidenceRefs,
    ...(failure_class === undefined ? {} : { failure_class }),
    consumer_boundary: "Core preview result is validate-only/draft/preview projection; it is not submitted result, approval execution, reconciliation, or post-submit truth."
  };
  const retentionState = input.retention_state ?? "active";
  const failure = failure_class === undefined ? undefined : normalizeFailureRecord({
    category: failure_class === "user_cancelled" ? "action_risk" : "evidence_reference",
    code: failure_class,
    phase: failure_class === "user_cancelled" ? "admission" : "evidence",
    recovery_hint: failure_class === "page_changed" ? "refresh_preview_evidence" : failure_class === "preview_unavailable" ? "retry_preview_capture" : "record_cancellation_without_submit"
  });
  const updated = await store.updateRunRecord(runId, {
    status: failure_class === undefined ? "succeeded" : failure_class === "user_cancelled" ? "cancelled" : "failed",
    result_ref: requireRef(input.result_ref, "result_ref"),
    preview_result,
    evidence_refs: evidenceRefs,
    ...(failure === undefined ? {} : { failure }),
    retention_state: retentionState,
    ...(input.post_check === undefined ? {} : { post_check: input.post_check })
  });
  return {
    run_record: updated,
    result_envelope: {
      ...envelopeBase(updated),
      ok: failure_class === undefined,
      outcome: failure_class === undefined ? "success" : failure_class === "user_cancelled" ? "cancelled" : "failed",
      result_ref: input.result_ref,
      result_kind: "validate_only_preview",
      ...(input.expected_change === undefined ? {} : { data: { expected_change: input.expected_change, submitted: false } }),
      evidence_refs: evidenceRefs,
      preview_result,
      ...(failure === undefined ? {} : { failure }),
      ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
      retention_state: retentionState
    }
  };
}
