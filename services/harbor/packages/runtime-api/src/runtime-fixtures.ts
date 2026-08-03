import type {
  CaptureSnapshotInput,
  CoreSceneReference,
  EvidenceStatusEntry,
  EvidenceStatusFixture
} from "./page-scene.js";
import type { RuntimeErrorFact } from "./runtime-session-types.js";

export const HARBOR_WRITE_PRECHECK_FACTS_SCHEMA = "harbor-write-precheck-facts/v0";
export const HARBOR_PREVIEW_EVIDENCE_STATUS_FIXTURE_SCHEMA = "harbor-preview-evidence-status-fixture/v0";
export const HARBOR_REDACTED_PREVIEW_EXPORT_FIXTURE_SCHEMA = "harbor-redacted-preview-export-fixture/v0";

export type WritableTargetRole = "form" | "button" | "input" | "contenteditable" | "navigation";
export type InputSensitivity = "public" | "sensitive" | "secret";
export type InputExportPolicy = "safe_summary" | "redacted" | "never_export";
export type InputValueState = "empty" | "present" | "redacted" | "unavailable";
export type PreWriteGuardStatus = "active" | "blocked";
export type PreviewEvidenceState = "available" | "stale_refmap" | "page_changed" | "evidence_unavailable";

export interface WritableTargetRef {
  target_ref: string;
  runtime_session_ref: string;
  snapshot_ref: string;
  refmap_ref: string;
  evidence_refs: string[];
  role: WritableTargetRole;
  label: string;
  locator_hint: string;
  provenance: {
    source: "fixture" | "provided_context";
    captured_at: string;
  };
}

export interface FormInputStateField {
  field_ref: string;
  target_ref: string;
  label: string;
  input_kind: string;
  required: boolean;
  sensitivity: InputSensitivity;
  export_policy: InputExportPolicy;
  value_state: InputValueState;
}

export interface WritePrecheckFacts {
  schema_version: typeof HARBOR_WRITE_PRECHECK_FACTS_SCHEMA;
  runtime_session_ref: string;
  provider_ref: string;
  profile_ref: string;
  writable_target: WritableTargetRef;
  submitted: false;
  form_state: {
    snapshot_ref: string;
    fields: FormInputStateField[];
    state_summary: string;
  };
  pre_write_guard: {
    status: PreWriteGuardStatus;
    no_submit_guard: "active";
    blocked_events: string[];
    enforcement: "facts_only_no_real_submit";
    runtime_ready: boolean;
    blocking_reasons: RuntimeErrorFact[];
  };
  privacy_boundary: {
    raw_values: "not_exposed";
    credential_profile_storage: "not_exposed";
    page_network_capture: "not_exposed";
    export_boundary: "refs_and_redacted_field_state_only";
  };
  unavailable: null;
}

export interface WritePrecheckInput {
  title?: string;
  url?: string;
  summary?: string;
  target_label?: string;
  locator_hint?: string;
  fields?: readonly {
    label: string;
    input_kind?: string;
    required?: boolean;
    sensitivity?: InputSensitivity;
    export_policy?: InputExportPolicy;
    value_state?: InputValueState;
  }[];
}

export interface PreviewEvidenceInput extends CaptureSnapshotInput {
  current_url?: string;
}

export interface PreviewEvidenceStatusFixture {
  schema_version: typeof HARBOR_PREVIEW_EVIDENCE_STATUS_FIXTURE_SCHEMA;
  runtime_session_ref: string;
  before_preview: CoreSceneReference;
  target_state_provenance: {
    snapshot_ref: string;
    refmap_ref?: string;
    source_trace_ref: string;
    captured_at: string;
    captured_url: string;
    current_url: string;
    producer: "harbor_runtime_api";
  };
  freshness: {
    state: PreviewEvidenceState;
    blocking_reason: "snapshot_stale" | "refmap_stale" | "page_changed" | "evidence_unavailable" | null;
    retryable: boolean;
  };
  viewer_evidence_status: EvidenceStatusFixture;
  privacy_boundary: {
    raw_material: "not_exposed";
    export_boundary: "refs_and_redacted_status_only";
    credential_storage: "not_exposed";
  };
  unavailable: null;
}

export interface RedactedPreviewExportFixture {
  schema_version: typeof HARBOR_REDACTED_PREVIEW_EXPORT_FIXTURE_SCHEMA;
  runtime_session_ref: string;
  before_preview_refs: {
    snapshot_ref: string;
    refmap_ref?: string;
    source_trace_ref: string;
    evidence_refs: string[];
  };
  preview_state: PreviewEvidenceState;
  no_submit_guard: {
    status: "active";
    blocked_events: string[];
    enforcement: "facts_only_no_real_submit";
  };
  private_boundary: {
    local_capture_store: "process_memory_only";
    restricted_material: "not_exported";
    export_boundary: "redacted_preview_refs_only";
  };
  redacted_export: {
    page_summary: CoreSceneReference["page_summary"];
    evidence_status: readonly EvidenceStatusEntry[];
  };
  unavailable: null;
}
