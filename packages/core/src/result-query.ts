import { resultEnvelopeSchemaVersion, type ResultEnvelope, type ResultOutcome } from "./result-envelope.js";
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

export type EvidenceRefSource = "admission" | "terminal" | "admission_and_terminal";
export type EvidenceRefState = "available" | "missing" | "expired" | "redacted" | "access_denied" | "deleted_by_policy";
export type ResultEnvelopeState = "available" | "unavailable" | "redacted";
export type ResultPayloadState = "not_persisted_in_core" | "unavailable" | "redacted" | "expired" | "access_denied" | "deleted_by_policy";
export type ResultUnavailableReason = "run_not_terminal" | "result_ref_missing";

export type EvidenceRefSummary = {
  ref: string;
  source: EvidenceRefSource;
  state: EvidenceRefState;
  retention_state?: RetentionState;
  redaction_state?: "none" | "summary_only" | "redacted";
  raw_access: "not_available_from_core";
  consumer_boundary: string;
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
    payload_state: "not_persisted_in_core"
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
    ...(record.result_ref === undefined ? {} : { result_ref: record.result_ref }),
    ...(record.package_ref === undefined ? {} : { package_ref: record.package_ref }),
    ...(record.evidence_refs === undefined ? {} : { evidence_refs: [...record.evidence_refs] }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.retention_state === undefined ? {} : { retention_state: record.retention_state })
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
  return [...refs.entries()].map(([ref, source]) => ({
    ref,
    source,
    ...state,
    raw_access: "not_available_from_core",
    consumer_boundary: "Core query returns refs and public state only; raw evidence bodies, screenshots, HAR, DOM, cookies, tokens, and viewer endpoints remain outside Core."
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
    ...(record.failure === undefined ? {} : { failure: record.failure }),
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
