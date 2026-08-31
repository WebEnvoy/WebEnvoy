import { opaqueRef } from "./refs.js";
import type {
  LocalProviderWritePrecheckProbeResult,
  XhsWritePrecheckCompositionPath,
  XhsWritePrecheckCompositionState,
  XhsWritePrecheckFieldState,
  XhsWritePrecheckMediaState
} from "./runtime-session-types.js";

export const HARBOR_VALIDATE_ONLY_WRITE_PRECHECK_SCHEMA = "harbor-validate-only-write-precheck/v0";
export const XHS_PUBLISH_PRECHECK_PIN = {
  package_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
  lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1",
  input_schema_ref: "lode://schema/site-capability/xiaohongshu/publish-note-precheck/input@0.1.0",
  output_schema_ref: "lode://schema/site-capability/xiaohongshu/publish-note-precheck/output@0.1.0",
  version: "0.1.0",
  operation_id: "xhs_publish_note_precheck",
  operation_mode: "validate_only",
  origin: "https://creator.xiaohongshu.com",
  repository: "WebEnvoy/Lode",
  commit: "6bff1afd059a30571f8ed219d1dcd25e6fb20c6b",
  asset_path: "registry/validate-only-runtime-consumption.json",
  asset_sha256: "c62ba191357e0056b03523a46c0bb26424c916333f388898a4cc457f9c1cc6fc",
  asset_semantic_sha256: "21f57cfd9f395bb13b322aec9e5dd0c9c5f01ea959052e3ceb0aeaf14e636ce0"
} as const;

export const XHS_PUBLISH_PRECHECK_ALLOWED_ORIGINS = [
  "https://www.xiaohongshu.com",
  XHS_PUBLISH_PRECHECK_PIN.origin
] as const;

export type WritePrecheckFailureClass =
  | "invalid_contract"
  | "login_required"
  | "page_changed"
  | "target_not_writable"
  | "safety_challenge"
  | "evidence_unavailable"
  | "fixture_runtime"
  | "provider_probe_unavailable"
  | "session_missing"
  | "session_not_ready"
  | "session_user_controlled";

export interface AdmittedWritePrecheck {
  url: string;
  target_ref: string;
  holder_ref?: string;
  composition_path?: XhsWritePrecheckCompositionPath;
  requested_fields?: readonly ("title" | "summary" | "canonical_url" | "source_status")[];
  include_source_refs?: boolean;
  proposed_input_summary?: string;
}

export type ValidateOnlyWritePrecheckResult =
  | {
      schema_version: typeof HARBOR_VALIDATE_ONLY_WRITE_PRECHECK_SCHEMA;
      status: "completed";
      runtime_session_ref: string;
      identity_ref: string;
      page_ref: string;
      merged_head_ref: string;
      operation_ref: string;
      result_ref: string;
      submitted_result_ref: string;
      observed_at: string;
      submitted: false;
      source_refs: readonly { kind: string; ref: string }[];
      evidence_ref_kinds: readonly { kind: string; ref: string }[];
      target_ref: string;
      classification: "partial_result";
      precheck_scope: "entrypoint_only" | "composition_observation";
      composition_path: XhsWritePrecheckCompositionPath;
      composition_state: XhsWritePrecheckCompositionState;
      entrypoint_observations: Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }>["entrypoint_observations"] & {
        user_confirmed_identity: true;
        challenge_absent: true;
      };
      field_states: Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }>["field_states"];
      media_state: XhsWritePrecheckMediaState;
      validation_state: XhsWritePrecheckFieldState;
      save_draft_control: XhsWritePrecheckFieldState;
      publish_control: XhsWritePrecheckFieldState;
      prohibited_actions_observed: Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }>["prohibited_actions_observed"];
      no_submit_guard: "active";
      post_check: {
        status: "passed";
        reason: "validated_creator_entrypoint_without_submission";
        source_refs: readonly { kind: string; ref: string }[];
        evidence_refs: readonly { kind: string; ref: string }[];
        post_check_ref: string;
        submitted: false;
        no_submit_guard: "active";
      };
      lode_pin: typeof XHS_PUBLISH_PRECHECK_PIN;
      public_boundary: {
        raw_dom: "not_exposed";
        raw_har: "not_exposed";
        screenshot_body: "not_exposed";
        credentials: "not_exposed";
        external_write_actions: "not_performed";
      };
    }
  | {
      schema_version: typeof HARBOR_VALIDATE_ONLY_WRITE_PRECHECK_SCHEMA;
      status: "unavailable";
      runtime_session_ref: string;
      failure_class: WritePrecheckFailureClass;
      retryable: boolean;
      submitted: false;
    };

export interface WritePrecheckObservationRecord {
  schema_version: "harbor-write-precheck-observation/v0";
  ref: string;
  evidence_ref: string;
  access_state: "available";
  kind: "operation" | "source_observation" | "evidence" | "post_check" | "result" | "submitted_result" | "page";
  runtime_session_ref: string;
  identity_ref: string;
  observed_at: string;
  submitted: false;
  public_boundary: {
    raw_dom: "not_exposed";
    screenshot_body: "not_exposed";
    credentials: "not_exposed";
  };
}

export class WritePrecheckObservationStore {
  private readonly records = new Map<string, WritePrecheckObservationRecord>();

  record(result: Extract<ValidateOnlyWritePrecheckResult, { status: "completed" }>): void {
    const refs: (readonly [string, WritePrecheckObservationRecord["kind"]])[] = [
      [result.operation_ref, "operation"],
      [result.page_ref, "page"],
      [result.result_ref, "result"],
      [result.submitted_result_ref, "submitted_result"],
      [result.post_check.post_check_ref, "post_check"],
      ...result.source_refs.map(({ ref }) => [ref, "source_observation"] as const),
      ...result.evidence_ref_kinds
        .filter(({ kind }) => kind !== "post_check_ref")
        .map(({ ref }) => [ref, "evidence"] as const)
    ];
    for (const [ref, kind] of refs) {
      this.records.set(ref, {
        schema_version: "harbor-write-precheck-observation/v0",
        ref,
        evidence_ref: ref,
        access_state: "available",
        kind,
        runtime_session_ref: result.runtime_session_ref,
        identity_ref: result.identity_ref,
        observed_at: result.observed_at,
        submitted: false,
        public_boundary: { raw_dom: "not_exposed", screenshot_body: "not_exposed", credentials: "not_exposed" }
      });
    }
    while (this.records.size > 256) this.records.delete(this.records.keys().next().value!);
  }

  get(ref: string): WritePrecheckObservationRecord | null {
    const record = this.records.get(ref);
    return record ? structuredClone(record) : null;
  }
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const sensitivePublicFragments = [
  "cookie", "token", "password", "xsec", "secret", "credential", "authorization", "apikey", "accesskey",
  "providerkey", "harborprofileid", "profilepath", "profilestorage", "profilestate", "storagevalue", "storageurl",
  "rawpayload", "rawbody", "rawevidencebody", "rawdom", "rawhar", "networkbody", "networkresponsebody",
  "verificationcode", "onetimepassword", "onetimecode", "passcode", "sessiontoken", "runtimesession",
  "livetabstate", "localpath", "fulldom", "cdpendpoint", "viewerurl", "websocketdebuggerurl", "screenshotbody",
  "productionpayload", "userbusinessdata"
] as const;
const sensitivePublicSegments = new Set(["auth", "otp", "jwt", "bearer", "proxy", "profile", "storage", "dom", "har", "screenshot"]);
const containsSensitivePublicMaterial = (value: string) => {
  let decoded = value;
  for (;;) {
    const lower = decoded.toLowerCase();
    const segments = lower.split(/[^a-z0-9]+/).filter(Boolean);
    const normalized = segments.join("");
    if (decoded.includes("验证码") ||
      segments.some((segment) => sensitivePublicSegments.has(segment)) ||
      sensitivePublicFragments.some((fragment) => normalized.includes(fragment))) return true;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      next = decoded
        .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/%[0-9a-z]{2}/gi, "_");
    }
    if (next === decoded) return false;
    decoded = next;
  }
};
const safePublic = (value: unknown, max: number): value is string =>
  bounded(value, max) && !containsSensitivePublicMaterial(value);
const opaquePublicRef = (value: unknown): value is string =>
  safePublic(value, 200) && /^[A-Za-z][A-Za-z0-9._:/-]*$/.test(value);
const requestedFieldSet = new Set(["title", "summary", "canonical_url", "source_status"]);
const compositionPathSet = new Set<XhsWritePrecheckCompositionPath>([
  "image_text_upload", "image_text_generate", "video", "long_article", "podcast"
]);

export function admitXhsPublishPrecheck(value: unknown): AdmittedWritePrecheck | null {
  const input = object(value);
  if (!input || Object.keys(input).some((key) =>
    !["url", "target_ref", "holder_ref", "no_submit_guard", "composition_path", "requested_fields", "include_source_refs", "proposed_input_summary"].includes(key)
  )) return null;
  if (!opaquePublicRef(input.target_ref) || input.no_submit_guard !== "active") return null;
  if (input.holder_ref !== undefined && !safePublic(input.holder_ref, 200)) return null;
  if (input.composition_path !== undefined && (
    typeof input.composition_path !== "string" || !compositionPathSet.has(input.composition_path as XhsWritePrecheckCompositionPath)
  )) return null;
  const requestedFields = input.requested_fields;
  if (requestedFields !== undefined && (
    !Array.isArray(requestedFields) ||
    requestedFields.length < 1 ||
    requestedFields.length > 4 ||
    new Set(requestedFields).size !== requestedFields.length ||
    !requestedFields.every((field) => typeof field === "string" && requestedFieldSet.has(field))
  )) return null;
  if (input.include_source_refs !== undefined && typeof input.include_source_refs !== "boolean") return null;
  if (input.proposed_input_summary !== undefined && !safePublic(input.proposed_input_summary, 500)) return null;
  if (typeof input.url !== "string" || !safePublic(input.url, 2_048)) return null;
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(input.url);
  } catch {
    return null;
  }
  if (!safePublic(decodedUrl, 2_048)) return null;
  try {
    const url = new URL(input.url);
    if (
      url.origin !== XHS_PUBLISH_PRECHECK_PIN.origin ||
      url.pathname !== "/publish/publish" ||
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams].some(([key, value]) =>
        !bounded(key, 200) ||
        (value !== "" && !bounded(value, 500)) ||
        containsSensitivePublicMaterial(key) ||
        containsSensitivePublicMaterial(value)
      )
    ) return null;
    return {
      url: url.href,
      target_ref: input.target_ref,
      ...(input.holder_ref === undefined ? {} : { holder_ref: input.holder_ref as string }),
      ...(input.composition_path === undefined ? {} : { composition_path: input.composition_path as XhsWritePrecheckCompositionPath }),
      ...(requestedFields === undefined ? {} : { requested_fields: requestedFields as AdmittedWritePrecheck["requested_fields"] }),
      ...(input.include_source_refs === undefined ? {} : { include_source_refs: input.include_source_refs }),
      ...(input.proposed_input_summary === undefined ? {} : { proposed_input_summary: input.proposed_input_summary as string })
    };
  } catch {
    return null;
  }
}

export function unavailableWritePrecheck(
  runtime_session_ref: string,
  failure_class: WritePrecheckFailureClass,
  retryable = true
): ValidateOnlyWritePrecheckResult {
  return {
    schema_version: HARBOR_VALIDATE_ONLY_WRITE_PRECHECK_SCHEMA,
    status: "unavailable",
    runtime_session_ref,
    failure_class,
    retryable,
    submitted: false
  };
}

export function completeWritePrecheck(
  runtime_session_ref: string,
  identity_ref: string,
  probe: Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }>
): Extract<ValidateOnlyWritePrecheckResult, { status: "completed" }> {
  const postCheckRef = opaqueRef("post_check");
  const postCheckEvidence = probe.evidence_ref_kinds.filter((entry) => entry.kind === "snapshot_ref");
  return {
    schema_version: HARBOR_VALIDATE_ONLY_WRITE_PRECHECK_SCHEMA,
    status: "completed",
    runtime_session_ref,
    identity_ref,
    page_ref: opaqueRef("page"),
    merged_head_ref: XHS_PUBLISH_PRECHECK_PIN.commit,
    operation_ref: opaqueRef("write_precheck"),
    result_ref: opaqueRef("write_precheck_result"),
    submitted_result_ref: opaqueRef("submitted_result"),
    observed_at: probe.observed_at,
    submitted: false,
    source_refs: probe.source_refs,
    evidence_ref_kinds: [...probe.evidence_ref_kinds, { kind: "post_check_ref", ref: postCheckRef }],
    target_ref: probe.target_ref,
    classification: probe.classification,
    precheck_scope: probe.precheck_scope,
    composition_path: probe.composition_path,
    composition_state: probe.composition_state,
    entrypoint_observations: { ...probe.entrypoint_observations, user_confirmed_identity: true, challenge_absent: true },
    field_states: probe.field_states,
    media_state: probe.media_state,
    validation_state: probe.validation_state,
    save_draft_control: probe.save_draft_control,
    publish_control: probe.publish_control,
    prohibited_actions_observed: probe.prohibited_actions_observed,
    no_submit_guard: "active",
    post_check: {
      status: "passed",
      reason: "validated_creator_entrypoint_without_submission",
      source_refs: probe.source_refs,
      evidence_refs: postCheckEvidence,
      post_check_ref: postCheckRef,
      submitted: false,
      no_submit_guard: "active"
    },
    lode_pin: XHS_PUBLISH_PRECHECK_PIN,
    public_boundary: {
      raw_dom: "not_exposed",
      raw_har: "not_exposed",
      screenshot_body: "not_exposed",
      credentials: "not_exposed",
      external_write_actions: "not_performed"
    }
  };
}

export function validCompletedWritePrecheckProbe(
  probe: Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }>
): boolean {
  const sourceKinds = probe.source_refs.map((ref) => ref.kind);
  const sourceRefs = probe.source_refs.map((ref) => ref.ref);
  const validFieldState = (field: unknown): field is XhsWritePrecheckFieldState => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return false;
    const value = field as Record<string, unknown>;
    return ["available", "unavailable", "unknown"].includes(String(value.availability)) &&
      ["observed", "not_observed", "unknown"].includes(String(value.observation)) &&
      (value.required === undefined || ["observed", "unobserved", "unknown"].includes(String(value.required))) &&
      (value.editable === undefined || ["observed", "unobserved", "unknown"].includes(String(value.editable))) &&
      (value.value_state === undefined || ["empty", "present", "unknown"].includes(String(value.value_state)));
  };
  const validMediaState = (media: unknown): media is XhsWritePrecheckMediaState => {
    if (!media || typeof media !== "object" || Array.isArray(media)) return false;
    const value = media as Record<string, unknown>;
    return ["available", "unavailable", "unknown"].includes(String(value.availability)) &&
      ["observed", "not_observed", "unknown"].includes(String(value.observation)) &&
      (value.controls === undefined || Boolean(
        value.controls && typeof value.controls === "object" && !Array.isArray(value.controls) &&
        Object.values(value.controls as Record<string, unknown>).every(validFieldState)
      ));
  };
  const fieldKeys = Object.keys(probe.field_states);
  const observations = probe.entrypoint_observations;
  return probe.observed_url.startsWith(`${XHS_PUBLISH_PRECHECK_PIN.origin}/publish/publish`) &&
    Number.isFinite(Date.parse(probe.observed_at)) &&
    sourceKinds.join(",") === "creator_publish_page_summary,dom_snapshot_summary" &&
    new Set(sourceRefs).size === 2 &&
    probe.evidence_ref_kinds.length === 1 &&
    probe.evidence_ref_kinds[0]?.kind === "snapshot_ref" &&
    probe.classification === "partial_result" &&
    ["entrypoint_only", "composition_observation"].includes(probe.precheck_scope) &&
    compositionPathSet.has(probe.composition_path) &&
    ["composition_initialized", "composition_not_initialized", "composition_unknown"].includes(probe.composition_state) &&
    observations.route_loaded === true &&
    observations.publish_vue_container_visible === true &&
    [observations.upload_image_tab_active, observations.upload_image_entry_visible, observations.text_image_entry_visible].every((value) => typeof value === "boolean") &&
    (observations.path_observed === undefined || ["observed", "unobserved", "unknown"].includes(observations.path_observed)) &&
    (observations.path_entry_visible === undefined || ["observed", "unobserved", "unknown"].includes(observations.path_entry_visible)) &&
    fieldKeys.includes("title_input") && fieldKeys.includes("content_editor") && fieldKeys.includes("publish_control") &&
    Object.values(probe.field_states).every(validFieldState) &&
    validMediaState(probe.media_state) &&
    validFieldState(probe.validation_state) &&
    validFieldState(probe.save_draft_control) &&
    validFieldState(probe.publish_control) &&
    Object.keys(probe.prohibited_actions_observed).sort().join(",") === "generate,publish,save,upload" &&
    Object.values(probe.prohibited_actions_observed).every((observed) => observed === false) &&
    bounded(probe.target_ref, 200);
}
