import type { FailureRecord } from "./run-record-store.js";

export type HarborUnavailable = {
  status: "unavailable";
  failure_class: string;
  retryable: boolean;
};

export type HarborCoreRuntimeFacts = {
  schema_version: "harbor-core-runtime-facts/v0";
  runtime_session_ref: string;
  profile_ref: string;
  provider_ref: string;
  provider_mode: string;
  lifecycle_state: string;
  availability: {
    cdp: string;
    viewer: string;
    snapshot: string;
    evidence: string;
  };
  viewer: {
    viewer_ref: string;
    availability: string;
    access_mode: string;
    expires_at: string;
  };
  control: {
    owner: string;
    handoff_reason: string | null;
    takeover: {
      available: boolean;
      unavailable_reason?: string;
    };
    updated_at: string;
  };
  current_error: unknown;
  fact_refs: {
    session: string;
    viewer: string;
  };
  unavailable: null;
};

export type HarborCoreSceneReference = {
  schema_version: "harbor-page-scene-refs/v0";
  runtime_session_ref: string;
  snapshot_ref: string;
  refmap_ref?: string;
  evidence_refs: readonly string[];
  source_trace_ref: string;
  captured_at: string;
  page_summary: {
    title: string;
    url: string;
    summary: string;
  };
  unavailable: null;
};

export type HarborAdmissionInput = {
  harbor_runtime_facts?: HarborCoreRuntimeFacts | HarborUnavailable;
  harbor_scene_ref?: HarborCoreSceneReference | HarborUnavailable;
  harbor_write_precheck_facts?: HarborWritePrecheckFacts | HarborUnavailable;
};

export type HarborAdmission =
  | {
      ok: true;
      runtime_binding_refs: readonly string[];
      evidence_refs: readonly string[];
    }
  | {
      ok: false;
      failure: FailureRecord;
      runtime_binding_refs?: readonly string[];
      evidence_refs?: readonly string[];
    };

type RuntimeAdmission =
  | {
      ok: true;
      runtime_session_ref: string;
      runtime_binding_refs: readonly string[];
      availability: Record<string, unknown>;
    }
  | {
      ok: false;
      failure: FailureRecord;
    };

export type HarborWritePrecheckFacts = {
  schema_version: "harbor-write-precheck-facts/v0";
  runtime_session_ref: string;
  provider_ref: string;
  profile_ref: string;
  writable_target: {
    target_ref: string;
    runtime_session_ref: string;
    snapshot_ref: string;
    refmap_ref: string;
    evidence_refs: readonly string[];
  };
  form_state: {
    snapshot_ref: string;
    fields: readonly unknown[];
    state_summary: string;
  };
  pre_write_guard: {
    status: "active" | "blocked";
    no_submit_guard: "active";
    blocked_events: readonly string[];
    enforcement: "facts_only_no_real_submit";
    runtime_ready: boolean;
    blocking_reasons: readonly unknown[];
  };
  privacy_boundary: {
    raw_values: "not_exposed";
    credential_profile_storage: "not_exposed";
    page_network_capture: "not_exposed";
    export_boundary: "refs_and_redacted_field_state_only";
  };
  unavailable: null;
};

export type HarborAdmissionMode = "read" | "write_precheck";

const activeRuntimeStates = new Set(["active", "idle"]);
const harborForbiddenFieldNames = new Set([
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

function failure(category: FailureRecord["category"], code: string, phase: FailureRecord["phase"], recoveryHint: string): FailureRecord {
  return {
    category,
    code,
    phase,
    recovery_hint: recoveryHint
  };
}

function contractObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function contractString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isUnavailable(value: unknown): value is HarborUnavailable {
  const object = contractObject(value);
  return object?.status === "unavailable" && typeof object.failure_class === "string";
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
    if (harborForbiddenFieldNames.has(key)) return key;
    const found = findForbiddenField(entry);
    if (found) return found;
  }
  return undefined;
}

function uniqueRefs(refs: readonly (string | undefined)[]): string[] {
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref)))];
}

function unavailableRuntimeCode(value: HarborUnavailable): string {
  return value.failure_class === "session_missing" ? "runtime_ref_missing" : "runtime_session_unavailable";
}

function runtimeExpiredCode(lifecycleState: string): string {
  return lifecycleState === "closed" || lifecycleState === "expired" ? "runtime_ref_expired" : "runtime_session_unavailable";
}

function validateRuntimeFacts(runtimeFacts: HarborAdmissionInput["harbor_runtime_facts"]): RuntimeAdmission {
  if (!runtimeFacts) {
    return { ok: false, failure: failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime") };
  }
  if (isUnavailable(runtimeFacts)) {
    return { ok: false, failure: failure("resource_admission", unavailableRuntimeCode(runtimeFacts), "runtime_binding", "connect_runtime") };
  }

  const runtime = contractObject(runtimeFacts);
  const runtimeSessionRef = contractString(runtime?.runtime_session_ref);
  const profileRef = contractString(runtime?.profile_ref);
  const providerRef = contractString(runtime?.provider_ref);
  const lifecycleState = contractString(runtime?.lifecycle_state);
  const viewer = contractObject(runtime?.viewer);
  const factRefs = contractObject(runtime?.fact_refs);
  const availability = contractObject(runtime?.availability) ?? {};
  const viewerRef = contractString(viewer?.viewer_ref);

  if (runtime?.schema_version !== "harbor-core-runtime-facts/v0" || !runtimeSessionRef || !profileRef || !providerRef || !lifecycleState || !viewerRef) {
    return { ok: false, failure: failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime") };
  }
  if (factRefs?.session !== runtimeSessionRef || factRefs.viewer !== viewerRef) {
    return { ok: false, failure: failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime") };
  }
  if (!activeRuntimeStates.has(lifecycleState)) {
    return { ok: false, failure: failure("resource_admission", runtimeExpiredCode(lifecycleState), "runtime_binding", "connect_runtime") };
  }

  const runtimeBindingRefs = uniqueRefs([runtimeSessionRef, profileRef, providerRef, viewerRef]);
  return { ok: true, runtime_session_ref: runtimeSessionRef, runtime_binding_refs: runtimeBindingRefs, availability };
}

function validateSceneRef(
  sceneRef: HarborAdmissionInput["harbor_scene_ref"],
  runtimeSessionRef: string,
  runtimeBindingRefs: readonly string[],
  availability: Record<string, unknown>
): HarborAdmission {
  if (!sceneRef) {
    return { ok: false, failure: failure("evidence_reference", "snapshot_missing", "evidence", "rerun_with_evidence"), runtime_binding_refs: runtimeBindingRefs };
  }
  if (isUnavailable(sceneRef)) {
    return {
      ok: false,
      failure: failure("evidence_reference", sceneRef.failure_class, "evidence", sceneRef.retryable ? "rerun_with_evidence" : "connect_runtime"),
      runtime_binding_refs: runtimeBindingRefs
    };
  }

  const scene = contractObject(sceneRef);
  const snapshotRef = contractString(scene?.snapshot_ref);
  const refmapRef = contractString(scene?.refmap_ref);
  const sourceTraceRef = contractString(scene?.source_trace_ref);
  const evidenceRefs = Array.isArray(scene?.evidence_refs) ? scene.evidence_refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0) : [];

  if (
    scene?.schema_version !== "harbor-page-scene-refs/v0" ||
    scene.runtime_session_ref !== runtimeSessionRef ||
    !snapshotRef ||
    !sourceTraceRef ||
    evidenceRefs.length === 0
  ) {
    return { ok: false, failure: failure("evidence_reference", "evidence_missing", "evidence", "rerun_with_evidence"), runtime_binding_refs: runtimeBindingRefs };
  }
  if (availability?.snapshot !== "available" || availability.evidence !== "available") {
    return { ok: false, failure: failure("resource_admission", "runtime_session_unavailable", "runtime_binding", "connect_runtime"), runtime_binding_refs: runtimeBindingRefs };
  }

  return {
    ok: true,
    runtime_binding_refs: uniqueRefs([...runtimeBindingRefs, snapshotRef, refmapRef, sourceTraceRef]),
    evidence_refs: evidenceRefs
  };
}

function validateWritePrecheckFacts(
  writeFacts: HarborAdmissionInput["harbor_write_precheck_facts"],
  runtimeSessionRef: string,
  runtimeBindingRefs: readonly string[]
): HarborAdmission {
  if (!writeFacts) {
    return { ok: false, failure: failure("resource_admission", "writable_target_missing", "runtime_binding", "connect_runtime"), runtime_binding_refs: runtimeBindingRefs };
  }
  if (isUnavailable(writeFacts)) {
    return {
      ok: false,
      failure: failure("resource_admission", writeFacts.failure_class, "runtime_binding", writeFacts.retryable ? "connect_runtime" : "remove_private_field"),
      runtime_binding_refs: runtimeBindingRefs
    };
  }

  const facts = contractObject(writeFacts);
  const target = contractObject(facts?.writable_target);
  const formState = contractObject(facts?.form_state);
  const guard = contractObject(facts?.pre_write_guard);
  const privacy = contractObject(facts?.privacy_boundary);
  const targetRef = contractString(target?.target_ref);
  const snapshotRef = contractString(target?.snapshot_ref) ?? contractString(formState?.snapshot_ref);
  const refmapRef = contractString(target?.refmap_ref);
  const evidenceRefs = Array.isArray(target?.evidence_refs) ? target.evidence_refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0) : [];

  if (
    facts?.schema_version !== "harbor-write-precheck-facts/v0" ||
    facts.runtime_session_ref !== runtimeSessionRef ||
    target?.runtime_session_ref !== runtimeSessionRef ||
    !contractString(facts.provider_ref) ||
    !contractString(facts.profile_ref) ||
    !targetRef ||
    !snapshotRef ||
    !refmapRef ||
    evidenceRefs.length === 0 ||
    !Array.isArray(formState?.fields)
  ) {
    return { ok: false, failure: failure("resource_admission", "writable_target_missing", "runtime_binding", "connect_runtime"), runtime_binding_refs: runtimeBindingRefs };
  }
  if (guard?.status !== "active" || guard.no_submit_guard !== "active" || guard.enforcement !== "facts_only_no_real_submit" || guard.runtime_ready !== true) {
    return { ok: false, failure: failure("action_risk", "no_submit_guard_missing", "admission", "use_validate_or_preview"), runtime_binding_refs: runtimeBindingRefs };
  }
  if (
    privacy?.raw_values !== "not_exposed" ||
    privacy.credential_profile_storage !== "not_exposed" ||
    privacy.page_network_capture !== "not_exposed" ||
    privacy.export_boundary !== "refs_and_redacted_field_state_only"
  ) {
    return { ok: false, failure: failure("resource_admission", "private_boundary_invalid", "runtime_binding", "remove_private_field"), runtime_binding_refs: runtimeBindingRefs };
  }

  return {
    ok: true,
    runtime_binding_refs: uniqueRefs([...runtimeBindingRefs, targetRef, snapshotRef, refmapRef]),
    evidence_refs: evidenceRefs
  };
}

export function validateHarborAdmission(input: HarborAdmissionInput, mode: HarborAdmissionMode = "read"): HarborAdmission {
  const forbiddenField = findForbiddenField(input);
  if (forbiddenField) {
    return { ok: false, failure: failure("resource_admission", `forbidden_field:${forbiddenField}`, "runtime_binding", "remove_private_field") };
  }

  const runtime = validateRuntimeFacts(input.harbor_runtime_facts);
  if (!runtime.ok) {
    return runtime;
  }
  if (mode === "write_precheck") {
    return validateWritePrecheckFacts(input.harbor_write_precheck_facts, runtime.runtime_session_ref, runtime.runtime_binding_refs);
  }
  return validateSceneRef(input.harbor_scene_ref, runtime.runtime_session_ref, runtime.runtime_binding_refs, runtime.availability);
}
