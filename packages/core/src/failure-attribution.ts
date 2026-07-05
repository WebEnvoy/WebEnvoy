import type { FailureRecord } from "./run-record-store.js";

export type FailureAttribution = "capability" | "input" | "runtime" | "site" | "evidence" | "unknown";

const inputCodes = new Set(["input_invalid", "input_missing", "scope_invalid", "schema_version_unsupported"]);
const runtimeCodes = new Set(["runtime_ref_missing", "runtime_ref_expired", "runtime_session_unavailable", "provider_unavailable", "profile_locked", "session_lost"]);
const siteCodes = new Set(["site_changed", "source_shape_changed", "page_changed", "source_schema_changed"]);
const evidenceCodes = new Set(["snapshot_missing", "evidence_missing", "evidence_unavailable", "evidence_expired", "capture_denied", "refmap_stale"]);

export function inferFailureAttribution(failure: Pick<FailureRecord, "category" | "code">): FailureAttribution {
  if (inputCodes.has(failure.code) || failure.code.startsWith("private_field_rejected:")) {
    return "input";
  }
  if (runtimeCodes.has(failure.code)) {
    return "runtime";
  }
  if (siteCodes.has(failure.code)) {
    return "site";
  }
  if (evidenceCodes.has(failure.code)) {
    return "evidence";
  }

  switch (failure.category) {
    case "request_invalid":
    case "action_risk":
      return "input";
    case "capability_contract":
      return "capability";
    case "resource_admission":
    case "runtime_execution":
      return "runtime";
    case "evidence_reference":
      return "evidence";
    case "result_projection":
      return "capability";
    case "persistence_observability":
    case "write_outcome":
      return "unknown";
  }
}

export function normalizeFailureRecord(failure: FailureRecord): FailureRecord {
  return failure.attribution === undefined ? { ...failure, attribution: inferFailureAttribution(failure) } : failure;
}
