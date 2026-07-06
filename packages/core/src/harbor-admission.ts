import type { FailureRecord } from "./run-record-store.js";
import type { LodeRequiredHarborFact } from "./lode-admission.js";

export type HarborUnavailable = {
  status: "unavailable";
  failure_class: string;
  retryable: boolean;
};

export type HarborCoreRuntimeFacts = {
  schema_version: "harbor-core-runtime-facts/v0";
  runtime_session_ref: string;
  identity_environment_ref?: string;
  execution_identity_ref?: string;
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

export type HarborIdentityEnvironmentFacts = {
  schema_version: "harbor-local-identity-environment/v0";
  identity_environment_ref: string;
  execution_identity_ref: string;
  profile_ref: string;
  site_binding: {
    site_id: string;
    origin: string;
  };
  login_state: {
    state: string;
    recovery_required: boolean;
  };
  browser_storage: {
    state: string;
  };
  provider_binding: {
    selected_provider_id: string | null;
    binding_status: string;
  };
  consumer_boundary: {
    core: string;
    not_exposed: readonly string[];
  };
};

export type RuntimeSessionUse = "manual_browsing" | "agent_direct_browsing" | "direct_session" | "core_task_run";

export type RuntimeSessionBindingFacts = {
  schema_version: "webenvoy.runtime-session-binding.v0";
  identity_environment_ref: string;
  execution_identity_ref: string;
  runtime_session_ref: string;
  profile_ref: string;
  provider_ref: string;
  provider_mode: string;
  lifecycle_state: string;
  control_owner: string;
  session_use: RuntimeSessionUse;
  core_task_run: true;
  consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence.";
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
  harbor_identity_environment_facts?: HarborIdentityEnvironmentFacts | HarborUnavailable;
  harbor_provider_status?: HarborBrowserProviderCatalog | HarborUnavailable;
  harbor_runtime_facts?: HarborCoreRuntimeFacts | HarborUnavailable;
  harbor_scene_ref?: HarborCoreSceneReference | HarborUnavailable;
  harbor_write_precheck_facts?: HarborWritePrecheckFacts | HarborUnavailable;
  harbor_resource_facts?: HarborResourceFacts | HarborUnavailable;
};

export type HarborAdmission =
  | {
      ok: true;
      runtime_binding_refs: readonly string[];
      evidence_refs: readonly string[];
      runtime_session_binding?: RuntimeSessionBindingFacts;
    }
  | {
      ok: false;
      failure: FailureRecord;
      runtime_binding_refs?: readonly string[];
      evidence_refs?: readonly string[];
      runtime_session_binding?: RuntimeSessionBindingFacts;
    };

type RuntimeAdmission =
  | {
      ok: true;
      runtime_session_ref: string;
      runtime_binding_refs: readonly string[];
      availability: Record<string, unknown>;
      session_binding: RuntimeSessionBindingFacts;
    }
  | {
      ok: false;
      failure: FailureRecord;
      runtime_binding_refs?: readonly string[];
      session_binding?: RuntimeSessionBindingFacts;
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

export type HarborBrowserProviderCatalog = {
  schema_version: "harbor-browser-provider-status/v0";
  providers: readonly {
    provider_id: string;
    install: {
      status: string;
      launchability: string;
    };
  }[];
};

export type HarborResourceFacts = {
  schema_version: "harbor-core-resource-facts/v0";
  resource_facts: readonly {
    fact_key: string;
    state: "available" | "unavailable" | "stale" | "unknown";
    source_ref?: string;
  }[];
  consumer_boundary: "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material.";
};

const activeRuntimeStates = new Set(["active", "idle"]);
const busyRuntimeStates = new Set(["locked"]);
const expiredRuntimeStates = new Set(["closed", "expired"]);
const unreachableRuntimeStates = new Set(["disconnected", "failed"]);
const busyControlOwners = new Set(["user", "agent", "app", "provider"]);
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
const identityRequiredPrivateBoundary = ["password", "verification_code", "cookie_value", "storage_value", "session_token"];

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
  if (expiredRuntimeStates.has(lifecycleState)) return "runtime_ref_expired";
  if (unreachableRuntimeStates.has(lifecycleState)) return "runtime_session_unreachable";
  if (busyRuntimeStates.has(lifecycleState)) return "runtime_session_busy";
  return "runtime_session_unavailable";
}

function sessionUse(owner: string): RuntimeSessionUse {
  if (owner === "user") return "manual_browsing";
  if (owner === "agent") return "agent_direct_browsing";
  if (owner === "core_task") return "core_task_run";
  return "direct_session";
}

function providerIdFromRef(ref: string): string {
  return ref.split("/").at(-1) ?? ref;
}

function validateProviderStatus(input: HarborAdmissionInput, identity: HarborIdentityEnvironmentFacts): FailureRecord | undefined {
  if (!input.harbor_provider_status) return undefined;
  if (isUnavailable(input.harbor_provider_status)) {
    return failure("resource_admission", "browser_provider_unavailable", "runtime_binding", input.harbor_provider_status.retryable ? "install_or_select_provider" : "open_manual_auth");
  }
  const providerBinding = contractObject(identity.provider_binding);
  const selectedProviderId = contractString(providerBinding?.selected_provider_id);
  const catalog = contractObject(input.harbor_provider_status);
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : undefined;
  if (catalog?.schema_version !== "harbor-browser-provider-status/v0" || !selectedProviderId || !providers) {
    return failure("resource_admission", "browser_provider_unavailable", "runtime_binding", "install_or_select_provider");
  }
  const selected = providers.map(contractObject).find((provider) => provider?.provider_id === selectedProviderId);
  const install = contractObject(selected?.install);
  if (!selected || install?.status !== "installed" || install.launchability !== "launchable") {
    return failure("resource_admission", "browser_provider_unavailable", "runtime_binding", "install_or_select_provider");
  }
  return undefined;
}

function validateIdentityFacts(identityFacts: HarborAdmissionInput["harbor_identity_environment_facts"]): HarborIdentityEnvironmentFacts | FailureRecord {
  if (!identityFacts) {
    return failure("resource_admission", "identity_environment_ref_missing", "runtime_binding", "connect_identity_environment");
  }
  if (isUnavailable(identityFacts)) {
    return failure("resource_admission", "identity_environment_unavailable", "runtime_binding", identityFacts.retryable ? "connect_identity_environment" : "open_manual_auth");
  }

  const identity = contractObject(identityFacts);
  const identityRef = contractString(identity?.identity_environment_ref);
  const executionRef = contractString(identity?.execution_identity_ref);
  const profileRef = contractString(identity?.profile_ref);
  const site = contractObject(identity?.site_binding);
  const login = contractObject(identity?.login_state);
  const storage = contractObject(identity?.browser_storage);
  const provider = contractObject(identity?.provider_binding);
  const boundary = contractObject(identity?.consumer_boundary);
  const notExposed = Array.isArray(boundary?.not_exposed) ? boundary.not_exposed : [];

  if (identity?.schema_version !== "harbor-local-identity-environment/v0" || !identityRef || !executionRef || !profileRef || !contractString(site?.origin)) {
    return failure("resource_admission", "identity_environment_ref_missing", "runtime_binding", "connect_identity_environment");
  }
  if (login?.recovery_required === true || login?.state === "logged_out" || login?.state === "expired" || login?.state === "manual_auth_required") {
    return failure("resource_admission", "identity_auth_required", "runtime_binding", "open_manual_auth");
  }
  if (storage?.state !== "present") {
    return failure("resource_admission", "identity_storage_unavailable", "runtime_binding", "open_manual_auth");
  }
  if (!contractString(provider?.selected_provider_id) || provider?.binding_status === "no_launchable_provider") {
    return failure("resource_admission", "browser_provider_unavailable", "runtime_binding", "install_or_select_provider");
  }
  if (boundary?.core !== "admission_facts_refs_and_blocking_reasons_only" || identityRequiredPrivateBoundary.some((entry) => !notExposed.includes(entry))) {
    return failure("resource_admission", "private_boundary_invalid", "runtime_binding", "remove_private_field");
  }
  return identityFacts as HarborIdentityEnvironmentFacts;
}

function validateRuntimeFacts(runtimeFacts: HarborAdmissionInput["harbor_runtime_facts"], identity: HarborIdentityEnvironmentFacts): RuntimeAdmission {
  if (!runtimeFacts) {
    return { ok: false, failure: failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime") };
  }
  if (isUnavailable(runtimeFacts)) {
    return { ok: false, failure: failure("resource_admission", unavailableRuntimeCode(runtimeFacts), "runtime_binding", "connect_runtime") };
  }

  const runtime = contractObject(runtimeFacts);
  const runtimeSessionRef = contractString(runtime?.runtime_session_ref);
  const identityRef = contractString(runtime?.identity_environment_ref);
  const executionRef = contractString(runtime?.execution_identity_ref);
  const profileRef = contractString(runtime?.profile_ref);
  const providerRef = contractString(runtime?.provider_ref);
  const providerMode = contractString(runtime?.provider_mode);
  const lifecycleState = contractString(runtime?.lifecycle_state);
  const control = contractObject(runtime?.control);
  const viewer = contractObject(runtime?.viewer);
  const factRefs = contractObject(runtime?.fact_refs);
  const availability = contractObject(runtime?.availability) ?? {};
  const viewerRef = contractString(viewer?.viewer_ref);
  const controlOwner = contractString(control?.owner) ?? "unknown";
  const takeover = contractObject(control?.takeover);

  if (runtime?.schema_version !== "harbor-core-runtime-facts/v0" || !runtimeSessionRef || !profileRef || !providerRef || !providerMode || !lifecycleState || !viewerRef) {
    return { ok: false, failure: failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime") };
  }
  const selectedProviderId = contractString(contractObject(identity.provider_binding)?.selected_provider_id);
  if (selectedProviderId && providerRef.includes("/") && providerIdFromRef(providerRef) !== selectedProviderId) {
    return { ok: false, failure: failure("resource_admission", "identity_runtime_mismatch", "runtime_binding", "select_matching_runtime") };
  }
  if (profileRef !== identity.profile_ref || (identityRef !== undefined && identityRef !== identity.identity_environment_ref) || (executionRef !== undefined && executionRef !== identity.execution_identity_ref)) {
    return { ok: false, failure: failure("resource_admission", "identity_runtime_mismatch", "runtime_binding", "select_matching_runtime") };
  }
  if (factRefs?.session !== runtimeSessionRef || factRefs.viewer !== viewerRef) {
    return { ok: false, failure: failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime") };
  }
  if (!activeRuntimeStates.has(lifecycleState)) {
    return { ok: false, failure: failure("resource_admission", runtimeExpiredCode(lifecycleState), "runtime_binding", lifecycleState === "locked" ? "wait_or_request_handoff" : "connect_runtime") };
  }
  const binding: RuntimeSessionBindingFacts = {
    schema_version: "webenvoy.runtime-session-binding.v0",
    identity_environment_ref: identity.identity_environment_ref,
    execution_identity_ref: identity.execution_identity_ref,
    runtime_session_ref: runtimeSessionRef,
    profile_ref: profileRef,
    provider_ref: providerRef,
    provider_mode: providerMode,
    lifecycle_state: lifecycleState,
    control_owner: controlOwner,
    session_use: sessionUse(controlOwner),
    core_task_run: true,
    consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
  };
  const busyOwner = busyControlOwners.has(controlOwner) && takeover?.available !== true;
  if (busyOwner) {
    return {
      ok: false,
      failure: failure("resource_admission", "runtime_session_busy", "runtime_binding", "wait_or_request_handoff"),
      runtime_binding_refs: uniqueRefs([runtimeSessionRef, profileRef, providerRef, viewerRef, identity.identity_environment_ref, identity.execution_identity_ref]),
      session_binding: binding
    };
  }

  const runtimeBindingRefs = uniqueRefs([runtimeSessionRef, profileRef, providerRef, viewerRef, identity.identity_environment_ref, identity.execution_identity_ref]);
  return { ok: true, runtime_session_ref: runtimeSessionRef, runtime_binding_refs: runtimeBindingRefs, availability, session_binding: binding };
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

function addInferredResourceFacts(input: HarborAdmissionInput, facts: Set<string>): void {
  const identity = contractObject(input.harbor_identity_environment_facts);
  const runtime = contractObject(input.harbor_runtime_facts);
  const scene = contractObject(input.harbor_scene_ref);
  const writeFacts = contractObject(input.harbor_write_precheck_facts);
  const identityLogin = contractObject(identity?.login_state);
  const siteBinding = contractObject(identity?.site_binding);
  const availability = contractObject(runtime?.availability);
  const origin = contractString(siteBinding?.origin);

  if (availability?.cdp === "available" && activeRuntimeStates.has(contractString(runtime?.lifecycle_state) ?? "")) {
    facts.add("runtime.execution_surface.available");
  }
  if (origin?.startsWith("https://")) {
    facts.add("runtime.public_https_navigation.allowed");
  }
  if (origin === "https://www.xiaohongshu.com") {
    facts.add("runtime.origin.www_xiaohongshu_com.available");
  }
  if (origin === "https://www.zhipin.com") {
    facts.add("runtime.origin.www_zhipin_com.available");
  }
  if (identityLogin?.state === "logged_in" && identityLogin.recovery_required !== true) {
    facts.add("identity.user_logged_in.confirmed");
    if (origin === "https://www.zhipin.com") facts.add("identity.boss_geek_logged_in.confirmed");
  }
  if (contractString(scene?.snapshot_ref) || contractString(contractObject(writeFacts?.writable_target)?.snapshot_ref)) {
    facts.add("snapshot.document_summary.available");
    facts.add("evidence.snapshot_ref.available");
  }
  if (contractString(scene?.source_trace_ref) || contractString(scene?.refmap_ref) || contractString(contractObject(writeFacts?.writable_target)?.refmap_ref)) {
    facts.add("source.refs.available");
    facts.add("refmap.source_refs.available");
  }
}

function publicResourceFacts(input: HarborAdmissionInput): Set<string> | FailureRecord {
  if (isUnavailable(input.harbor_resource_facts)) {
    return failure("resource_admission", "resource_requirement_unmatched", "resource_matching", input.harbor_resource_facts.retryable ? "rerun_with_fresh_runtime" : "open_manual_auth");
  }
  const facts = new Set<string>();
  addInferredResourceFacts(input, facts);
  if (input.harbor_resource_facts !== undefined) {
    const resource = contractObject(input.harbor_resource_facts);
    const entries = Array.isArray(resource?.resource_facts) ? resource.resource_facts : undefined;
    if (
      resource?.schema_version !== "harbor-core-resource-facts/v0" ||
      resource.consumer_boundary !== "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material." ||
      !entries
    ) {
      return failure("resource_admission", "resource_requirement_unmatched", "resource_matching", "rerun_with_fresh_runtime");
    }
    for (const value of entries) {
      const fact = contractObject(value);
      const factKey = contractString(fact?.fact_key);
      if (factKey && fact?.state === "available") facts.add(factKey);
    }
  }
  return facts;
}

function validateRequiredHarborFacts(input: HarborAdmissionInput, requiredFacts: readonly LodeRequiredHarborFact[]): FailureRecord | undefined {
  if (requiredFacts.length === 0) return undefined;
  const availableFacts = publicResourceFacts(input);
  if ("category" in availableFacts) return availableFacts;
  const missing = requiredFacts.find((fact) => !availableFacts.has(fact.fact_key));
  if (!missing) return undefined;
  return failure("resource_admission", `resource_fact_missing:${missing.fact_key}`, "resource_matching", "rerun_with_fresh_runtime");
}

export function validateHarborAdmission(input: HarborAdmissionInput, mode: HarborAdmissionMode = "read", requiredFacts: readonly LodeRequiredHarborFact[] = []): HarborAdmission {
  const forbiddenField = findForbiddenField(input);
  if (forbiddenField) {
    return { ok: false, failure: failure("resource_admission", `forbidden_field:${forbiddenField}`, "runtime_binding", "remove_private_field") };
  }

  const identity = validateIdentityFacts(input.harbor_identity_environment_facts);
  if ("category" in identity) {
    return { ok: false, failure: identity };
  }
  const providerStatusFailure = validateProviderStatus(input, identity);
  if (providerStatusFailure) {
    return { ok: false, failure: providerStatusFailure };
  }

  const runtime = validateRuntimeFacts(input.harbor_runtime_facts, identity);
  if (!runtime.ok) {
    return {
      ok: false,
      failure: runtime.failure,
      ...(runtime.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: runtime.runtime_binding_refs }),
      ...(runtime.session_binding === undefined ? {} : { runtime_session_binding: runtime.session_binding })
    };
  }
  const resourceFailure = validateRequiredHarborFacts(input, requiredFacts);
  if (resourceFailure) {
    return {
      ok: false,
      failure: resourceFailure,
      runtime_binding_refs: runtime.runtime_binding_refs,
      runtime_session_binding: runtime.session_binding
    };
  }
  if (mode === "write_precheck") {
    const admission = validateWritePrecheckFacts(input.harbor_write_precheck_facts, runtime.runtime_session_ref, runtime.runtime_binding_refs);
    return admission.ok ? { ...admission, runtime_session_binding: runtime.session_binding } : { ...admission, runtime_session_binding: runtime.session_binding };
  }
  const admission = validateSceneRef(input.harbor_scene_ref, runtime.runtime_session_ref, runtime.runtime_binding_refs, runtime.availability);
  return admission.ok ? { ...admission, runtime_session_binding: runtime.session_binding } : { ...admission, runtime_session_binding: runtime.session_binding };
}
