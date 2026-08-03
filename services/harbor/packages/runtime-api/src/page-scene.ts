import { opaqueRef } from "./refs.js";
import {
  isRuntimeSessionReadable,
  type LifecycleState,
  type RuntimeSessionFacts
} from "./runtime-session-types.js";

export const HARBOR_PAGE_SCENE_REFS_SCHEMA = "harbor-page-scene-refs/v0";
export const HARBOR_EVIDENCE_STATUS_FIXTURE_SCHEMA = "harbor-evidence-status-fixture/v0";

export type CaptureFailureClass =
  | "snapshot_missing"
  | "snapshot_stale"
  | "refmap_missing"
  | "refmap_stale"
  | "evidence_missing"
  | "evidence_expired"
  | "capture_denied"
  | "source_unavailable"
  | "selector_unstable";
export type CaptureMethod = "provided_context" | "fixture" | "cdp_screenshot";
export type EvidenceAccessState = "available" | "missing" | "stale" | "expired" | "redacted" | "access_denied";
export type EvidenceType = "snapshot" | "refmap" | "source_trace" | "screenshot";
export type EvidenceFreshnessState = "fresh" | "stale" | "expired" | "missing";
export type EvidenceStatusDisplayState = "available" | "redacted" | "private" | "stale" | "expired" | "missing" | "unavailable";
export type RedactionState = "not_required" | "redacted" | "capture_denied";
export type RetentionState = "ephemeral" | "retained" | "expired";
export type StorageScope = "process_memory";
export type ExportConsentState = "not_requested" | "granted" | "denied";

export interface PageSceneSessionFacts {
  runtime_session_ref: string;
  profile_ref: string;
  provider_ref: string;
  lifecycle_state: LifecycleState;
  control_owner?: RuntimeSessionFacts["control_owner"];
  control_lock?: RuntimeSessionFacts["control_lock"];
}

export interface EvidenceCapturePolicy {
  capture?: "allow" | "deny";
  screenshot?: "allow" | "deny";
  redaction_state?: Exclude<RedactionState, "capture_denied">;
  retention_state?: Exclude<RetentionState, "expired">;
  export_consent?: ExportConsentState;
}

export interface ScreenshotArtifactInput {
  artifact_ref: string;
  mime_type: "image/png";
  byte_length: number;
  sha256: string;
}

export interface RefMapElementInput {
  label: string;
  role?: string;
  text?: string;
  locator_hint?: string;
}

export interface CaptureSnapshotInput {
  title?: string;
  url?: string;
  summary?: string;
  capture_method?: CaptureMethod;
  source_locator?: string;
  elements?: RefMapElementInput[];
  screenshot_artifact?: ScreenshotArtifactInput;
  evidence_policy?: EvidenceCapturePolicy;
}

export interface PageSceneUnavailable {
  status: "unavailable";
  failure_class: CaptureFailureClass;
  message: string;
  retryable: boolean;
}

export interface SourceTrace {
  source_trace_ref: string;
  runtime_session_ref: string;
  profile_ref: string;
  provider_ref: string;
  page_ref: string;
  frame_ref: string;
  capture_method: CaptureMethod;
  captured_at: string;
  producer: "harbor_runtime_api";
  redaction_state: RedactionState;
  source_locator?: string;
}

export interface SnapshotRecord {
  schema_version: typeof HARBOR_PAGE_SCENE_REFS_SCHEMA;
  snapshot_ref: string;
  runtime_session_ref: string;
  profile_ref: string;
  provider_ref: string;
  source_trace: SourceTrace;
  captured_at: string;
  screenshot_ref?: string;
  page: { title: string; url: string; summary: string };
  redaction_state: RedactionState;
  retention_state: RetentionState;
  access_state: EvidenceAccessState;
  evidence_ref: string;
  refmap_ref?: string;
}

export interface RefMapElementRef {
  element_ref: string;
  index: number;
  label: string;
  source_evidence_ref?: string;
  role?: string;
  text?: string;
  locator_hint?: string;
}

export interface RefMapRecord {
  schema_version: typeof HARBOR_PAGE_SCENE_REFS_SCHEMA;
  refmap_ref: string;
  snapshot_ref: string;
  runtime_session_ref: string;
  source_trace: SourceTrace;
  captured_at: string;
  access_state: EvidenceAccessState;
  element_refs: RefMapElementRef[];
  evidence_ref: string;
}

export interface EvidenceRecord {
  schema_version: typeof HARBOR_PAGE_SCENE_REFS_SCHEMA;
  evidence_ref: string;
  evidence_type: EvidenceType;
  owner: "harbor";
  source_trace: SourceTrace;
  source_binding: {
    runtime_session_ref: string;
    snapshot_ref?: string;
    refmap_ref?: string;
    screenshot_ref?: string;
  };
  redaction_state: RedactionState;
  retention_state: RetentionState;
  storage_scope: StorageScope;
  access_state: EvidenceAccessState;
  captured_at: string;
  provenance: {
    producer: "harbor_runtime_api";
    capture_method: CaptureMethod;
    source_locator?: string;
  };
  artifact?: {
    artifact_ref: string;
    mime_type: "image/png";
    byte_length: number;
    sha256: string;
    raw_bytes: "not_exposed";
  };
}

export interface EvidenceStatusEntry {
  evidence_ref: string;
  evidence_type: EvidenceType;
  display_state: EvidenceStatusDisplayState;
  freshness_state: EvidenceFreshnessState;
  redaction_state: RedactionState;
  retention_state: RetentionState;
  storage_scope: StorageScope;
  access_state: EvidenceAccessState;
  captured_at: string;
  provenance: EvidenceRecord["provenance"];
  unavailable_reason: CaptureFailureClass | null;
}

export interface EvidenceStatusFixture {
  schema_version: typeof HARBOR_EVIDENCE_STATUS_FIXTURE_SCHEMA;
  runtime_session_ref: string;
  snapshot_ref: string;
  refmap_ref?: string;
  source_trace_ref: string;
  scene_status: { display_state: "available" | "stale" | "missing" | "unavailable"; freshness_state: EvidenceFreshnessState; blocking_reason: CaptureFailureClass | null; retryable: boolean };
  evidence_status: EvidenceStatusEntry[];
  privacy_boundary: { access_boundary: "harbor_refs_only"; raw_material: "not_exposed"; private_capture: "local_only"; private_capture_store: "process_memory_only"; redacted_export_boundary: "redacted_fixture_refs_only"; export_consent: ExportConsentState; retention_policy: "ephemeral_by_default"; deletion_policy: "expire_or_drop_ref" };
  unavailable: null;
}

export interface CoreSceneReference {
  schema_version: typeof HARBOR_PAGE_SCENE_REFS_SCHEMA;
  runtime_session_ref: string;
  snapshot_ref: string;
  refmap_ref?: string;
  screenshot_ref?: string;
  evidence_refs: string[];
  source_trace_ref: string;
  page_ref: string;
  frame_ref: string;
  captured_at: string;
  page_summary: { title: string; url: string; summary: string };
  unavailable: null;
}

export type SnapshotCaptureResult =
  | { status: "captured"; snapshot_ref: string; refmap_ref?: string; evidence_refs: string[]; core_scene_ref: CoreSceneReference }
  | PageSceneUnavailable;

export class PageSceneStore {
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly refmaps = new Map<string, RefMapRecord>();
  private readonly evidence = new Map<string, EvidenceRecord>();

  capture(session: PageSceneSessionFacts | null, input: CaptureSnapshotInput = {}): SnapshotCaptureResult {
    if (!session) {
      return unavailableScene("snapshot_missing", "Runtime Session is missing; no snapshot can be captured.", true);
    }
    if (input.evidence_policy?.capture === "deny") {
      return unavailableScene("capture_denied", "Evidence policy denied snapshot capture for this Runtime Session.", false);
    }
    if (!isRuntimeSessionReadable(session)) {
      return unavailableScene("source_unavailable", "Runtime Session is not readable for snapshot capture.", true);
    }

    const captured_at = new Date().toISOString();
    const source_trace = createSourceTrace(session, input, captured_at);
    const redaction_state = input.evidence_policy?.redaction_state ?? "redacted";
    const retention_state = input.evidence_policy?.retention_state ?? "ephemeral";
    const snapshot_ref = opaqueRef("snapshot");
    const snapshot_evidence = this.createEvidence("snapshot", source_trace, {
      runtime_session_ref: session.runtime_session_ref,
      snapshot_ref
    }, redaction_state, retention_state);

    const element_refs = (input.elements ?? []).map((element, index): RefMapElementRef => ({
      element_ref: opaqueRef("element"),
      index,
      label: normalizeText(element.label || `element ${index + 1}`, 160),
      role: element.role ? normalizeText(element.role, 80) : undefined,
      text: element.text ? normalizeText(element.text, 240) : undefined,
      locator_hint: element.locator_hint ? normalizeText(element.locator_hint, 240) : undefined
    }));

    let refmap_ref: string | undefined;
    let refmap_evidence: EvidenceRecord | undefined;
    if (element_refs.length > 0) {
      refmap_ref = opaqueRef("refmap");
      refmap_evidence = this.createEvidence("refmap", source_trace, {
        runtime_session_ref: session.runtime_session_ref,
        snapshot_ref,
        refmap_ref
      }, redaction_state, retention_state);
      for (const element of element_refs) element.source_evidence_ref = refmap_evidence.evidence_ref;
      this.refmaps.set(refmap_ref, {
        schema_version: HARBOR_PAGE_SCENE_REFS_SCHEMA,
        refmap_ref,
        snapshot_ref,
        runtime_session_ref: session.runtime_session_ref,
        source_trace,
        captured_at,
        access_state: "available",
        element_refs,
        evidence_ref: refmap_evidence.evidence_ref
      });
    }

    const source_trace_evidence = this.createEvidence("source_trace", source_trace, {
      runtime_session_ref: session.runtime_session_ref,
      snapshot_ref,
      refmap_ref
    }, redaction_state, retention_state);
    const screenshot_ref = input.evidence_policy?.screenshot === "deny" ? undefined : input.screenshot_artifact?.artifact_ref ?? opaqueRef("screenshot");
    const screenshot_evidence = screenshot_ref ? this.createEvidence("screenshot", source_trace, {
      runtime_session_ref: session.runtime_session_ref,
      snapshot_ref,
      screenshot_ref
    }, redaction_state, retention_state, input.screenshot_artifact) : undefined;
    const snapshot_record: SnapshotRecord = {
      schema_version: HARBOR_PAGE_SCENE_REFS_SCHEMA,
      snapshot_ref,
      runtime_session_ref: session.runtime_session_ref,
      profile_ref: session.profile_ref,
      provider_ref: session.provider_ref,
      source_trace,
      captured_at,
      screenshot_ref,
      page: normalizePageContext(input),
      redaction_state,
      retention_state,
      access_state: "available",
      evidence_ref: snapshot_evidence.evidence_ref,
      refmap_ref
    };
    this.snapshots.set(snapshot_ref, snapshot_record);

    const evidence_refs = [snapshot_evidence.evidence_ref, source_trace_evidence.evidence_ref];
    if (screenshot_evidence) evidence_refs.push(screenshot_evidence.evidence_ref);
    if (refmap_evidence) evidence_refs.push(refmap_evidence.evidence_ref);
    return {
      status: "captured",
      snapshot_ref,
      refmap_ref,
      evidence_refs,
      core_scene_ref: coreSceneReference(snapshot_record, evidence_refs)
    };
  }

  getSnapshot(snapshot_ref: string, isSessionReadable: (runtime_session_ref: string) => boolean): SnapshotRecord | PageSceneUnavailable {
    const record = this.snapshots.get(snapshot_ref);
    if (!record) return unavailableScene("snapshot_missing", "Snapshot ref is missing.", true);
    if (!isSessionReadable(record.runtime_session_ref)) {
      return unavailableScene("snapshot_stale", "Snapshot source session is no longer active.", true);
    }
    return clone(record);
  }

  getRefMap(refmap_ref: string, isSessionReadable: (runtime_session_ref: string) => boolean): RefMapRecord | PageSceneUnavailable {
    const record = this.refmaps.get(refmap_ref);
    if (!record) return unavailableScene("refmap_missing", "RefMap ref is missing.", true);
    if (!isSessionReadable(record.runtime_session_ref)) {
      return unavailableScene("refmap_stale", "RefMap source session is no longer active.", true);
    }
    return clone(record);
  }

  getEvidence(evidence_ref: string): EvidenceRecord | PageSceneUnavailable {
    const record = this.evidence.get(evidence_ref);
    if (!record) return unavailableScene("evidence_missing", "Evidence ref is missing.", true);
    if (record.access_state === "expired") {
      return unavailableScene("evidence_expired", "Evidence ref expired under its retention policy.", false);
    }
    return clone(record);
  }

  expireEvidence(evidence_ref: string): EvidenceRecord | PageSceneUnavailable {
    const record = this.evidence.get(evidence_ref);
    if (!record) return unavailableScene("evidence_missing", "Evidence ref is missing.", true);
    record.retention_state = "expired";
    record.access_state = "expired";
    return clone(record);
  }

  getCoreSceneReference(snapshot_ref: string, isSessionReadable: (runtime_session_ref: string) => boolean): CoreSceneReference | PageSceneUnavailable {
    const record = this.snapshots.get(snapshot_ref);
    if (!record) return unavailableScene("snapshot_missing", "Snapshot ref is missing.", true);
    if (!isSessionReadable(record.runtime_session_ref)) {
      return unavailableScene("snapshot_stale", "Snapshot source session is no longer active.", true);
    }
    const evidence_refs = [...this.evidence.values()]
      .filter((entry) => entry.source_binding.snapshot_ref === snapshot_ref)
      .sort(compareEvidenceRecords)
      .map((entry) => entry.evidence_ref);
    return coreSceneReference(record, evidence_refs);
  }

  getEvidenceStatusFixture(snapshot_ref: string, isSessionReadable: (runtime_session_ref: string) => boolean): EvidenceStatusFixture | PageSceneUnavailable {
    const record = this.snapshots.get(snapshot_ref);
    if (!record) return unavailableScene("snapshot_missing", "Snapshot ref is missing.", true);
    const sessionReadable = isSessionReadable(record.runtime_session_ref);
    const evidence = [...this.evidence.values()]
      .filter((entry) => entry.source_binding.snapshot_ref === snapshot_ref)
      .sort(compareEvidenceRecords);
    return {
      schema_version: HARBOR_EVIDENCE_STATUS_FIXTURE_SCHEMA,
      runtime_session_ref: record.runtime_session_ref,
      snapshot_ref: record.snapshot_ref,
      refmap_ref: record.refmap_ref,
      source_trace_ref: record.source_trace.source_trace_ref,
      scene_status: {
        display_state: sessionReadable ? "available" : "stale",
        freshness_state: sessionReadable ? "fresh" : "stale",
        blocking_reason: sessionReadable ? null : "snapshot_stale",
        retryable: !sessionReadable
      },
      evidence_status: evidence.map((entry) => evidenceStatusEntry(entry, sessionReadable)),
      privacy_boundary: {
        access_boundary: "harbor_refs_only",
        raw_material: "not_exposed",
        private_capture: "local_only",
        private_capture_store: "process_memory_only",
        redacted_export_boundary: "redacted_fixture_refs_only",
        export_consent: exportConsent(evidence),
        retention_policy: "ephemeral_by_default",
        deletion_policy: "expire_or_drop_ref"
      },
      unavailable: null
    };
  }

  private createEvidence(
    evidence_type: EvidenceType,
    source_trace: SourceTrace,
    source_binding: EvidenceRecord["source_binding"],
    redaction_state: RedactionState,
    retention_state: RetentionState,
    screenshot_artifact?: ScreenshotArtifactInput
  ): EvidenceRecord {
    const evidence_ref = opaqueRef("evidence");
    const record: EvidenceRecord = {
      schema_version: HARBOR_PAGE_SCENE_REFS_SCHEMA,
      evidence_ref,
      evidence_type,
      owner: "harbor",
      source_trace,
      source_binding,
      redaction_state,
      retention_state,
      storage_scope: "process_memory",
      access_state: "available",
      captured_at: source_trace.captured_at,
      provenance: {
        producer: "harbor_runtime_api",
        capture_method: source_trace.capture_method,
        source_locator: source_trace.source_locator
      },
      artifact: screenshot_artifact && evidence_type === "screenshot" ? {
        ...screenshot_artifact,
        raw_bytes: "not_exposed"
      } : undefined
    };
    this.evidence.set(evidence_ref, record);
    return record;
  }
}

function evidenceStatusEntry(record: EvidenceRecord, sessionReadable: boolean): EvidenceStatusEntry {
  const expired = record.access_state === "expired" || record.retention_state === "expired";
  const stale = !sessionReadable;
  return {
    evidence_ref: record.evidence_ref,
    evidence_type: record.evidence_type,
    display_state: evidenceDisplayState(record, stale, expired),
    freshness_state: expired ? "expired" : stale ? "stale" : "fresh",
    redaction_state: record.redaction_state,
    retention_state: record.retention_state,
    storage_scope: record.storage_scope,
    access_state: expired ? "expired" : stale ? "stale" : record.access_state,
    captured_at: record.captured_at,
    provenance: clone(record.provenance),
    unavailable_reason: expired ? "evidence_expired" : stale ? "snapshot_stale" : null
  };
}

function evidenceDisplayState(record: EvidenceRecord, stale: boolean, expired: boolean): EvidenceStatusDisplayState {
  if (expired) return "expired";
  if (stale) return "stale";
  if (record.access_state === "access_denied") return "private";
  if (record.redaction_state === "redacted") return "redacted";
  return "available";
}

function exportConsent(evidence: EvidenceRecord[]): ExportConsentState {
  return evidence.some((entry) => entry.retention_state === "retained") ? "granted" : "not_requested";
}

function createSourceTrace(session: PageSceneSessionFacts, input: CaptureSnapshotInput, captured_at: string): SourceTrace {
  return {
    source_trace_ref: opaqueRef("source_trace"),
    runtime_session_ref: session.runtime_session_ref,
    profile_ref: session.profile_ref,
    provider_ref: session.provider_ref,
    page_ref: opaqueRef("page"),
    frame_ref: opaqueRef("frame"),
    capture_method: input.capture_method ?? "provided_context",
    captured_at,
    producer: "harbor_runtime_api",
    redaction_state: input.evidence_policy?.redaction_state ?? "redacted",
    source_locator: input.source_locator
  };
}

function coreSceneReference(record: SnapshotRecord, evidence_refs: string[]): CoreSceneReference {
  return {
    schema_version: HARBOR_PAGE_SCENE_REFS_SCHEMA,
    runtime_session_ref: record.runtime_session_ref,
    snapshot_ref: record.snapshot_ref,
    refmap_ref: record.refmap_ref,
    screenshot_ref: record.screenshot_ref,
    evidence_refs,
    source_trace_ref: record.source_trace.source_trace_ref,
    page_ref: record.source_trace.page_ref,
    frame_ref: record.source_trace.frame_ref,
    captured_at: record.captured_at,
    page_summary: clone(record.page),
    unavailable: null
  };
}

function unavailableScene(failure_class: CaptureFailureClass, message: string, retryable: boolean): PageSceneUnavailable {
  return { status: "unavailable", failure_class, message, retryable };
}

function compareEvidenceRecords(left: EvidenceRecord, right: EvidenceRecord): number {
  return evidenceTypeOrder(left.evidence_type) - evidenceTypeOrder(right.evidence_type);
}

function evidenceTypeOrder(evidence_type: EvidenceType): number {
  if (evidence_type === "snapshot") return 0;
  if (evidence_type === "source_trace") return 1;
  if (evidence_type === "screenshot") return 2;
  return 3;
}

function normalizePageContext(input: CaptureSnapshotInput): SnapshotRecord["page"] {
  const title = normalizeText(input.title ?? "", 200) || "Untitled page";
  const url = normalizeText(input.url ?? "", 2048) || "about:blank";
  const fallback = title === "Untitled page" ? url : `${title} - ${url}`;
  return {
    title,
    url,
    summary: normalizeText(input.summary ?? fallback, 1000)
  };
}

function normalizeText(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
