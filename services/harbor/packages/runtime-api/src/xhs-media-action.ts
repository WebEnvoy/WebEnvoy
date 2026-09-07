import { opaqueRef } from "./refs.js";
import type {
  LocalProviderMediaActionInput,
  LocalProviderMediaActionResult,
  LocalProviderReadProbeRef,
  XhsMediaActionId,
  XhsMediaActionPath,
  XhsMediaEffectKind
} from "./runtime-session-types.js";

export type {
  XhsMediaActionId,
  XhsMediaActionPath,
  XhsMediaEffectKind,
  XhsMediaOperationStatus
} from "./runtime-session-types.js";

export const HARBOR_XHS_MEDIA_ACTION_SCHEMA = "harbor-xhs-publish-note-image-text-media/v0";
export const HARBOR_XHS_FIELD_ACTION_SCHEMA = "harbor-xhs-publish-note-image-text-fields/v0";
export const HARBOR_XHS_COMMIT_ACTION_SCHEMA = "harbor-xhs-publish-note-image-text-commit/v0";
export const XHS_MEDIA_ACTION_PACKAGE_REF = "lode://site-capability/xiaohongshu/publish-note-image-text-media@0.1.0";
export const XHS_MEDIA_ACTION_LOCK_REF = "lode://lock/site-capability/xiaohongshu/publish-note-image-text-media@0.1.0";
export const XHS_FIELD_ACTION_PACKAGE_REF = "lode://site-capability/xiaohongshu/publish-note-image-text-fields@0.1.1";
export const XHS_FIELD_ACTION_LOCK_REF = "lode://lock/site-capability/xiaohongshu/publish-note-image-text-fields@0.1.1";
export const XHS_COMMIT_ACTION_PACKAGE_REF = "lode://site-capability/xiaohongshu/publish-note-image-text-commit@0.1.1";
export const XHS_COMMIT_ACTION_LOCK_REF = "lode://lock/site-capability/xiaohongshu/publish-note-image-text-commit@0.1.1";

const actionPaths: Readonly<Record<XhsMediaActionId, XhsMediaActionPath>> = {
  "xhs_publish_note_image_text_media.image_upload": "image_text_upload",
  "xhs_publish_note_image_text_media.text_to_image_generate": "image_text_generate",
  "xhs_publish_note_image_text_fields.compose": "image_text_upload",
  "xhs_publish_note_image_text_commit.save_draft": "image_text_upload",
  "xhs_publish_note_image_text_commit.publish": "image_text_upload",
  "xhs_publish_note_image_text_commit.cleanup": "image_text_upload"
};

const actionEffects: Readonly<Record<XhsMediaActionId, XhsMediaEffectKind>> = {
  "xhs_publish_note_image_text_media.image_upload": "upload",
  "xhs_publish_note_image_text_media.text_to_image_generate": "generate",
  "xhs_publish_note_image_text_fields.compose": "modify",
  "xhs_publish_note_image_text_commit.save_draft": "save_draft",
  "xhs_publish_note_image_text_commit.publish": "publish",
  "xhs_publish_note_image_text_commit.cleanup": "cleanup"
};

const allowedKeys = new Set([
  "url", "target_ref", "holder_ref", "no_submit_guard", "action_id", "requested_path", "refs", "summary", "marker", "visibility", "authorization_binding"
]);
const bindingKeys = new Set(["decision_ref", "action_id", "target_ref", "idempotency_key"]);
const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const opaquePublicRef = (value: unknown): value is string => safeText(value, 2_048) && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
const isCommitActionId = (value: unknown): value is XhsCommitActionNormalizedResult["action_id"] =>
  typeof value === "string" && value.startsWith("xhs_publish_note_image_text_commit.");

export interface AdmittedXhsMediaAction {
  url: string;
  target_ref: string;
  holder_ref?: string;
  no_submit_guard: "active";
  action_id: XhsMediaActionId;
  requested_path: XhsMediaActionPath;
  refs: readonly string[];
  summary: string;
  marker?: string;
  visibility?: "not_applicable" | "only_me" | "public";
  authorization_binding: LocalProviderMediaActionInput["authorization_binding"];
}

export type XhsMediaActionResult =
  | {
      schema_version: typeof HARBOR_XHS_MEDIA_ACTION_SCHEMA;
      status: "available" | "unavailable";
      classification: "success_result" | "partial_result" | "not_normalizable";
      runtime_session_ref: string;
      normalized: XhsMediaActionNormalizedResult;
      source_refs: readonly XhsMediaSourceRef[];
      evidence_refs: readonly XhsMediaEvidenceRef[];
      unavailable_reason?: XhsMediaUnavailableReason;
    }
  | {
      schema_version: typeof HARBOR_XHS_FIELD_ACTION_SCHEMA;
      result_kind: "xhs_publish_note_image_text_fields";
      status: "available" | "unavailable";
      classification: "success_result" | "partial_result" | "not_normalizable";
      runtime_session_ref: string;
      normalized: XhsFieldActionNormalizedResult;
      source_refs: readonly XhsMediaSourceRef[];
      evidence_refs: readonly XhsMediaEvidenceRef[];
      unavailable_reason?: XhsMediaUnavailableReason;
    }
  | {
      schema_version: typeof HARBOR_XHS_COMMIT_ACTION_SCHEMA;
      result_kind: "xhs_publish_note_image_text_commit";
      status: "available" | "unavailable";
      classification: "success_result" | "partial_result" | "not_normalizable";
      runtime_session_ref: string;
      normalized: XhsCommitActionNormalizedResult;
      source_refs: readonly XhsMediaSourceRef[];
      evidence_refs: readonly XhsMediaEvidenceRef[];
      unavailable_reason?: XhsMediaUnavailableReason;
    };

export type XhsMediaActionNormalizedResult = {
  action_id: "xhs_publish_note_image_text_media.image_upload" | "xhs_publish_note_image_text_media.text_to_image_generate";
  requested_path: XhsMediaActionPath;
  canonical_url: string;
  target_ref: string;
  summary: string;
  source_status: "located" | "partially_located" | "unknown";
  business_effect: { kind: XhsMediaEffectKind; status: "requested" | "observed" | "unknown" | "failed" };
  operation: { status: "accepted" | "running" | "terminal" | "unknown_outcome"; operation_ref: string; terminal_state?: "success" | "failure" };
  media_readback: {
    status: "observed" | "unknown" | "mismatch" | "not_applicable";
    media_count: number | null;
    order_status: "observed" | "unknown" | "not_applicable";
    ordered_item_refs?: readonly string[];
    generation_result_ref: string | null;
  };
  page_readback: { status: "observed" | "unknown" | "mismatch"; page_state_ref: string; route_state: "observed" | "unknown" | "mismatch" };
  post_check: { status: "passed" | "failed" | "skipped"; ref: string };
  reconciliation: { status: "matched" | "mismatched" | "unknown" | "not_run"; ref: string };
  recovery: { status: "not_required" | "required" | "unknown"; entrypoint: "inspect_operation_ref" | "await_post_check" | "manual_reconciliation" | "none" };
  save_draft: "not_in_scope";
  publish: "not_in_scope";
  submitted: false;
};

export type XhsFieldActionNormalizedResult = {
  action_id: "xhs_publish_note_image_text_fields.compose";
  requested_path: "image_text_upload";
  canonical_url: string;
  target_ref: string;
  source_status: "located" | "partially_located" | "unknown";
  business_effect: { kind: "modify"; status: "requested" | "observed" | "unknown" | "failed" };
  operation: { status: "accepted" | "running" | "terminal" | "unknown_outcome"; operation_ref: string; terminal_state?: "success" | "failure" };
  field_readback: {
    status: "observed" | "unknown" | "mismatch";
    title: { status: "observed" | "unknown" | "mismatch"; value_state: "matched" | "mismatch" | "unknown" };
    body: { status: "observed" | "unknown" | "mismatch"; value_state: "matched" | "mismatch" | "unknown" };
    validation_status: "passed" | "failed" | "unknown";
  };
  page_readback: { status: "observed" | "unknown" | "mismatch"; page_state_ref: string; route_state: "observed" | "unknown" | "mismatch" };
  post_check: { status: "passed" | "failed" | "skipped"; ref: string };
  reconciliation: { status: "matched" | "mismatched" | "unknown" | "not_run"; ref: string };
  recovery: { status: "not_required" | "required" | "unknown"; entrypoint: "inspect_operation_ref" | "await_post_check" | "manual_reconciliation" | "none" };
  save_draft: "not_in_scope";
  publish: "not_in_scope";
  submitted: false;
};

export type XhsCommitActionNormalizedResult = {
  action_id: "xhs_publish_note_image_text_commit.save_draft" | "xhs_publish_note_image_text_commit.publish" | "xhs_publish_note_image_text_commit.cleanup";
  requested_path: "image_text_upload";
  canonical_url: string;
  target_ref: string;
  marker_state: "matched" | "mismatched" | "unknown";
  visibility_state: "not_applicable" | "only_me" | "public" | "unknown";
  business_effect: { kind: "save_draft" | "publish" | "cleanup"; status: "observed" | "not_observed" | "unknown" };
  operation: { status: "terminal" | "unknown_outcome"; operation_ref: string; terminal_state?: "success" | "failure" };
  content_readback: Extract<LocalProviderMediaActionResult, { status: "completed"; action_id: "xhs_publish_note_image_text_commit.save_draft" | "xhs_publish_note_image_text_commit.publish" | "xhs_publish_note_image_text_commit.cleanup" }>["content_readback"];
  post_check: { status: "passed" | "failed" | "skipped"; ref: string };
  reconciliation: { status: "matched" | "mismatched" | "unknown" | "not_run"; ref: string };
  recovery: { status: "not_required" | "required" | "unknown"; entrypoint: "inspect_operation_ref" | "await_post_check" | "manual_reconciliation" | "none" };
  submitted: boolean;
};

export interface XhsMediaSourceRef {
  ref_id: string;
  source_kind: "media_action_summary" | "field_action_summary" | "commit_action_summary" | "creator_publish_page_summary" | "business_state_summary";
  producer: "harbor";
  redaction: "summary_only";
  schema_hint: string;
}

export interface XhsMediaEvidenceRef {
  ref_id: string;
  evidence_kind: "operation_ref" | "post_check_ref" | "reconciliation_ref" | "snapshot_ref";
  producer: "harbor";
  redaction: "refs_only";
}

export interface XhsMediaActionObservationRecord {
  schema_version: "harbor-xhs-media-action-observation/v0";
  ref: string;
  evidence_ref: string;
  access_state: "available";
  kind: "operation";
  runtime_session_ref: string;
  observed_at: string;
  operation_status: XhsMediaActionResult["normalized"]["operation"]["status"];
  terminal_state?: NonNullable<XhsMediaActionResult["normalized"]["operation"]["terminal_state"]>;
  business_effect_status: XhsMediaActionResult["normalized"]["business_effect"]["status"];
  unavailable_reason?: XhsMediaUnavailableReason;
  reconciliation: XhsMediaActionResult["normalized"]["reconciliation"];
  diagnostics?: NonNullable<Extract<LocalProviderMediaActionResult, { status: "unavailable" }>["diagnostics"]>;
  submitted: boolean;
  redaction_state: "summary_only";
  retention_state: "ephemeral";
  storage_scope: "process_memory";
  public_boundary: {
    raw_dom: "not_exposed";
    screenshot_body: "not_exposed";
    credentials: "not_exposed";
    request_summary: "not_exposed";
  };
}

export class XhsMediaActionObservationStore {
  private readonly records = new Map<string, XhsMediaActionObservationRecord>();

  record(
    result: XhsMediaActionResult,
    diagnostics?: NonNullable<Extract<LocalProviderMediaActionResult, { status: "unavailable" }>["diagnostics"]>
  ): XhsMediaActionResult {
    const ref = result.normalized.operation.operation_ref;
    this.records.set(ref, {
      schema_version: "harbor-xhs-media-action-observation/v0",
      ref,
      evidence_ref: ref,
      access_state: "available",
      kind: "operation",
      runtime_session_ref: result.runtime_session_ref,
      observed_at: new Date().toISOString(),
      operation_status: result.normalized.operation.status,
      ...(result.normalized.operation.terminal_state === undefined ? {} : { terminal_state: result.normalized.operation.terminal_state }),
      business_effect_status: result.normalized.business_effect.status,
      ...(result.unavailable_reason === undefined ? {} : { unavailable_reason: result.unavailable_reason }),
      reconciliation: structuredClone(result.normalized.reconciliation),
      ...(diagnostics === undefined ? {} : { diagnostics: structuredClone(diagnostics) }),
      submitted: result.normalized.submitted,
      redaction_state: "summary_only",
      retention_state: "ephemeral",
      storage_scope: "process_memory",
      public_boundary: {
        raw_dom: "not_exposed",
        screenshot_body: "not_exposed",
        credentials: "not_exposed",
        request_summary: "not_exposed"
      }
    });
    while (this.records.size > 256) this.records.delete(this.records.keys().next().value!);
    return result;
  }

  get(ref: string): XhsMediaActionObservationRecord | undefined {
    const record = this.records.get(ref);
    return record ? structuredClone(record) : undefined;
  }
}

export type XhsMediaUnavailableReason =
  | "invalid_contract"
  | "resource_unavailable"
  | "login_required"
  | "permission_insufficient"
  | "safety_challenge"
  | "page_changed"
  | "media_ref_unavailable"
  | "generation_unavailable"
  | "field_unavailable"
  | "validation_failed"
  | "commit_control_unavailable"
  | "operation_result_unknown"
  | "post_check_failed"
  | "reconciliation_unknown";

export function xhsMediaActionPath(actionId: XhsMediaActionId): XhsMediaActionPath {
  return actionPaths[actionId];
}

export function xhsMediaActionEffect(actionId: XhsMediaActionId): XhsMediaEffectKind {
  return actionEffects[actionId];
}

export function admitXhsMediaAction(value: unknown): AdmittedXhsMediaAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  const actionId = input.action_id;
  const requestedPath = input.requested_path;
  const commitAction = isCommitActionId(actionId);
  if (!(actionId === "xhs_publish_note_image_text_media.image_upload" || actionId === "xhs_publish_note_image_text_media.text_to_image_generate" ||
      actionId === "xhs_publish_note_image_text_fields.compose" || commitAction) ||
    requestedPath !== actionPaths[actionId]) return null;
  if (input.no_submit_guard !== "active" || !opaquePublicRef(input.target_ref) || !safeText(input.summary, 512)) return null;
  if (input.holder_ref !== undefined && !opaquePublicRef(input.holder_ref)) return null;
  if (!Array.isArray(input.refs) || input.refs.length > 18 || !input.refs.every(opaquePublicRef)) return null;
  if ((actionId.endsWith("image_upload") && input.refs.length < 1) ||
    (actionId.endsWith("text_to_image_generate") && input.refs.length !== 0) ||
    (actionId.endsWith(".compose") && (input.refs.length !== 2 || !String(input.refs[0]).endsWith("/title") || !String(input.refs[1]).endsWith("/body"))) ||
    (commitAction && ((actionId.endsWith(".cleanup") ? input.refs.length !== 1 || !String(input.refs[0]).startsWith("xhs_content_") : input.refs.length !== 0) ||
      !safeText(input.marker, 128) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input.marker) ||
      (actionId.endsWith(".publish") ? input.visibility !== "only_me" && input.visibility !== "public" : input.visibility !== "not_applicable")))) return null;
  if (!safeCreatorPublishUrl(input.url, actionId === "xhs_publish_note_image_text_fields.compose")) return null;
  const binding = input.authorization_binding && typeof input.authorization_binding === "object" && !Array.isArray(input.authorization_binding)
    ? input.authorization_binding as Record<string, unknown>
    : undefined;
  if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
    Object.keys(binding).some((key) => !bindingKeys.has(key)) ||
    !Object.keys(binding).every((key) => Object.hasOwn(binding, key)) ||
    !safeText(binding.decision_ref, 512) || !safeText(binding.idempotency_key, 128) ||
    binding.action_id !== actionId || binding.target_ref !== input.target_ref) return null;
  return {
    url: input.url as string,
    target_ref: input.target_ref as string,
    ...(input.holder_ref === undefined ? {} : { holder_ref: input.holder_ref as string }),
    no_submit_guard: "active",
    action_id: actionId,
    requested_path: requestedPath as XhsMediaActionPath,
    refs: [...input.refs] as string[],
    summary: input.summary as string,
    ...(commitAction ? { marker: input.marker as string, visibility: input.visibility as "not_applicable" | "only_me" | "public" } : {}),
    authorization_binding: {
      decision_ref: binding.decision_ref as string,
      action_id: actionId,
      target_ref: input.target_ref as string,
      idempotency_key: binding.idempotency_key as string
    }
  };
}

function safeCreatorPublishUrl(value: unknown, fieldAction = false): value is string {
  if (!safeText(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://creator.xiaohongshu.com" && ["/publish/publish", "/publish/publish/"].includes(url.pathname) &&
      !url.username && !url.password && !url.hash &&
      (!fieldAction || !url.search) &&
      [...url.searchParams].every(([key, item]) => safeText(key, 200) && (item === "" || safeText(item, 500)));
  } catch {
    return false;
  }
}

export function unavailableXhsMediaAction(
  runtimeSessionRef: string,
  input: Pick<AdmittedXhsMediaAction, "url" | "target_ref" | "action_id" | "requested_path" | "summary" | "visibility">,
  reason: XhsMediaUnavailableReason,
  operationRef = opaqueRef("media_operation"),
  submitted = false
): XhsMediaActionResult {
  const operationStatus = reason === "operation_result_unknown" || reason === "reconciliation_unknown" ? "unknown_outcome" : "terminal";
  const operation: XhsFieldActionNormalizedResult["operation"] = {
    status: operationStatus,
    operation_ref: operationRef,
    ...(operationStatus === "terminal" ? { terminal_state: "failure" as const } : {})
  };
  if (isCommitActionId(input.action_id)) {
    return {
      schema_version: HARBOR_XHS_COMMIT_ACTION_SCHEMA,
      result_kind: "xhs_publish_note_image_text_commit",
      status: "unavailable",
      classification: "not_normalizable",
      runtime_session_ref: runtimeSessionRef,
      unavailable_reason: reason,
      normalized: {
        action_id: input.action_id,
        requested_path: "image_text_upload",
        canonical_url: input.url,
        target_ref: input.target_ref,
        marker_state: "unknown",
        visibility_state: input.visibility ?? "unknown",
        business_effect: { kind: input.action_id.endsWith(".save_draft") ? "save_draft" : input.action_id.endsWith(".publish") ? "publish" : "cleanup", status: operationStatus === "unknown_outcome" ? "unknown" : "not_observed" },
        operation: {
          status: operationStatus === "terminal" ? "terminal" : "unknown_outcome",
          operation_ref: operationRef,
          ...(operationStatus === "terminal" ? { terminal_state: "failure" as const } : {})
        },
        content_readback: unknownCommitReadback(),
        post_check: { status: "skipped", ref: opaqueRef("post_check") },
        reconciliation: { status: "unknown", ref: opaqueRef("reconciliation") },
        recovery: { status: "required", entrypoint: operationStatus === "unknown_outcome" ? "manual_reconciliation" : "inspect_operation_ref" },
        submitted
      },
      source_refs: [],
      evidence_refs: [{ ref_id: operationRef, evidence_kind: "operation_ref", producer: "harbor", redaction: "refs_only" }]
    };
  }
  if (input.action_id === "xhs_publish_note_image_text_fields.compose") {
    return {
      schema_version: HARBOR_XHS_FIELD_ACTION_SCHEMA,
      result_kind: "xhs_publish_note_image_text_fields",
      status: "unavailable",
      classification: "not_normalizable",
      runtime_session_ref: runtimeSessionRef,
      unavailable_reason: reason,
      normalized: {
        action_id: input.action_id,
        requested_path: "image_text_upload",
        canonical_url: input.url,
        target_ref: input.target_ref,
        source_status: "unknown",
        business_effect: { kind: "modify", status: operationStatus === "unknown_outcome" ? "unknown" : "failed" },
        operation,
        field_readback: unknownFieldReadback(),
        page_readback: { status: "unknown", page_state_ref: opaqueRef("page_state"), route_state: "unknown" },
        post_check: { status: "skipped", ref: opaqueRef("post_check") },
        reconciliation: { status: "unknown", ref: opaqueRef("reconciliation") },
        recovery: { status: "required", entrypoint: operationStatus === "unknown_outcome" ? "manual_reconciliation" : "inspect_operation_ref" },
        save_draft: "not_in_scope",
        publish: "not_in_scope",
        submitted: false
      },
      source_refs: [],
      evidence_refs: [{ ref_id: operationRef, evidence_kind: "operation_ref", producer: "harbor", redaction: "refs_only" }]
    };
  }
  return {
    schema_version: HARBOR_XHS_MEDIA_ACTION_SCHEMA,
    status: "unavailable",
    classification: "not_normalizable",
    runtime_session_ref: runtimeSessionRef,
    unavailable_reason: reason,
    normalized: {
      action_id: input.action_id,
      requested_path: input.requested_path,
      canonical_url: input.url,
      target_ref: input.target_ref,
      summary: input.summary,
      source_status: "unknown",
      business_effect: { kind: actionEffects[input.action_id], status: reason === "operation_result_unknown" ? "unknown" : "failed" },
      operation,
      media_readback: {
        status: "unknown",
        media_count: null,
        order_status: "unknown",
        ordered_item_refs: [],
        generation_result_ref: null
      },
      page_readback: {
        status: "unknown",
        page_state_ref: opaqueRef("page_state"),
        route_state: "unknown"
      },
      post_check: { status: "skipped", ref: opaqueRef("post_check") },
      reconciliation: { status: "unknown", ref: opaqueRef("reconciliation") },
      recovery: {
        status: "required",
        entrypoint: operationStatus === "unknown_outcome" ? "manual_reconciliation" : "inspect_operation_ref"
      },
      save_draft: "not_in_scope",
      publish: "not_in_scope",
      submitted: false
    },
    source_refs: [],
    evidence_refs: [{ ref_id: operationRef, evidence_kind: "operation_ref", producer: "harbor", redaction: "refs_only" }]
  };
}

export function completeXhsMediaAction(
  runtimeSessionRef: string,
  input: Pick<AdmittedXhsMediaAction, "url" | "target_ref" | "action_id" | "requested_path" | "refs" | "summary" | "visibility">,
  result: Extract<LocalProviderMediaActionResult, { status: "completed" }>
): XhsMediaActionResult {
  const postCheckRef = opaqueRef("post_check");
  const reconciliationRef = opaqueRef("reconciliation");
  const operationStatus = result.operation_status;
  if (isCommitActionId(input.action_id) &&
    result.action_id === input.action_id && "content_readback" in result) {
    const cleanup = input.action_id.endsWith(".cleanup");
    const expectedState = cleanup ? "deleted" : input.action_id.endsWith(".save_draft") ? "draft_saved" : "published";
    const successful = result.effect_status === "observed" && operationStatus === "terminal" && result.terminal_state === "success" &&
      result.content_readback.state === expectedState && result.visibility_state === (input.action_id.endsWith(".publish") ? input.visibility : "not_applicable") &&
      (!cleanup || input.refs.length === 1 && result.content_readback.content_ref === input.refs[0]) &&
      result.marker_state === "matched" && result.content_readback.management_list_state === (cleanup ? "not_found" : "matched") && result.content_readback.detail_state === (cleanup ? "not_run" : "matched") &&
      result.content_readback.fields_state === "matched" && result.content_readback.media_state === "matched" && result.content_readback.marker_state === "matched";
    const unknown = operationStatus === "unknown_outcome" || result.effect_status === "unknown" || result.marker_state === "unknown" ||
      Object.values(result.content_readback).includes("unknown");
    return {
      schema_version: HARBOR_XHS_COMMIT_ACTION_SCHEMA,
      result_kind: "xhs_publish_note_image_text_commit",
      status: successful ? "available" : "unavailable",
      classification: successful ? "success_result" : unknown ? "not_normalizable" : "partial_result",
      runtime_session_ref: runtimeSessionRef,
      ...(!successful ? { unavailable_reason: unknown ? "operation_result_unknown" as const : "post_check_failed" as const } : {}),
      normalized: {
        action_id: input.action_id,
        requested_path: "image_text_upload",
        canonical_url: result.observed_url,
        target_ref: input.target_ref,
        marker_state: result.marker_state,
        visibility_state: result.visibility_state,
        business_effect: { kind: result.effect_kind, status: result.effect_status === "failed" ? "not_observed" : result.effect_status },
        operation: {
          status: operationStatus === "terminal" ? "terminal" : "unknown_outcome",
          operation_ref: result.operation_ref,
          ...(result.terminal_state === undefined ? {} : { terminal_state: result.terminal_state })
        },
        content_readback: result.content_readback,
        post_check: { status: successful ? "passed" : unknown ? "skipped" : "failed", ref: postCheckRef },
        reconciliation: { status: successful ? "matched" : unknown ? "unknown" : "mismatched", ref: reconciliationRef },
        recovery: { status: successful ? "not_required" : "required", entrypoint: successful ? "none" : unknown ? "manual_reconciliation" : "inspect_operation_ref" },
        submitted: true
      },
      source_refs: commitSourceRefs(result.source_refs),
      evidence_refs: mediaEvidenceRefs(result, postCheckRef, reconciliationRef)
    };
  }
  if (input.action_id.startsWith("xhs_publish_note_image_text_commit.") || result.action_id.startsWith("xhs_publish_note_image_text_commit.")) {
    return unavailableXhsMediaAction(runtimeSessionRef, input, "invalid_contract", result.operation_ref, true);
  }
  if (input.action_id === "xhs_publish_note_image_text_fields.compose" && result.action_id === input.action_id) {
    const successful = result.effect_status === "observed" && operationStatus === "terminal" && result.terminal_state === "success" &&
      result.page_readback.status === "observed" && result.field_readback.status === "observed" && result.field_readback.validation_status === "passed";
    const unknown = operationStatus === "unknown_outcome" || result.effect_status === "unknown" || result.page_readback.status === "unknown" ||
      result.field_readback.status === "unknown" || result.field_readback.validation_status === "unknown";
    return {
      schema_version: HARBOR_XHS_FIELD_ACTION_SCHEMA,
      result_kind: "xhs_publish_note_image_text_fields",
      status: unknown ? "unavailable" : "available",
      classification: successful ? "success_result" : unknown ? "not_normalizable" : "partial_result",
      runtime_session_ref: runtimeSessionRef,
      ...(unknown ? { unavailable_reason: "operation_result_unknown" as const } : {}),
      normalized: {
        action_id: input.action_id,
        requested_path: "image_text_upload",
        canonical_url: input.url,
        target_ref: input.target_ref,
        source_status: successful ? "located" : unknown ? "unknown" : "partially_located",
        business_effect: { kind: "modify", status: result.effect_status },
        operation: {
          status: operationStatus,
          operation_ref: result.operation_ref,
          ...(result.terminal_state === undefined ? {} : { terminal_state: result.terminal_state })
        },
        field_readback: result.field_readback,
        page_readback: result.page_readback,
        post_check: { status: successful ? "passed" : unknown ? "skipped" : "failed", ref: postCheckRef },
        reconciliation: { status: successful ? "matched" : unknown ? "unknown" : "mismatched", ref: reconciliationRef },
        recovery: { status: successful ? "not_required" : "required", entrypoint: successful ? "none" : unknown ? "manual_reconciliation" : "inspect_operation_ref" },
        save_draft: "not_in_scope",
        publish: "not_in_scope",
        submitted: false
      },
      source_refs: mediaSourceRefs(result.source_refs, true),
      evidence_refs: mediaEvidenceRefs(result, postCheckRef, reconciliationRef)
    };
  }
  if (input.action_id === "xhs_publish_note_image_text_fields.compose" || result.action_id === "xhs_publish_note_image_text_fields.compose") {
    return unavailableXhsMediaAction(runtimeSessionRef, input, "invalid_contract", result.operation_ref);
  }
  if ((input.action_id !== "xhs_publish_note_image_text_media.image_upload" && input.action_id !== "xhs_publish_note_image_text_media.text_to_image_generate") ||
    (result.action_id !== "xhs_publish_note_image_text_media.image_upload" && result.action_id !== "xhs_publish_note_image_text_media.text_to_image_generate")) {
    return unavailableXhsMediaAction(runtimeSessionRef, input, "invalid_contract", result.operation_ref);
  }
  const successful = result.effect_status === "observed" && operationStatus === "terminal" && result.terminal_state === "success" &&
    result.page_readback.status === "observed" && result.media_readback.status === "observed";
  const unknown = operationStatus === "unknown_outcome" || result.effect_status === "unknown" || result.page_readback.status === "unknown" || result.media_readback.status === "unknown";
  const status: XhsMediaActionResult["status"] = successful ? "available" : "unavailable";
  const classification: XhsMediaActionResult["classification"] = successful ? "success_result" : unknown ? "not_normalizable" : "partial_result";
  const operation: XhsMediaActionNormalizedResult["operation"] = {
    status: operationStatus,
    operation_ref: result.operation_ref,
    ...(result.terminal_state === undefined ? {} : { terminal_state: result.terminal_state })
  };
  const postStatus = successful ? "passed" : unknown ? "skipped" : "failed";
  const reconcileStatus = successful ? "matched" : unknown ? "unknown" : "mismatched";
  return {
    schema_version: HARBOR_XHS_MEDIA_ACTION_SCHEMA,
    status,
    classification,
    runtime_session_ref: runtimeSessionRef,
    ...(status === "unavailable" ? { unavailable_reason: unknown ? "operation_result_unknown" : "post_check_failed" as const } : {}),
    normalized: {
      action_id: input.action_id,
      requested_path: input.requested_path,
      canonical_url: input.url,
      target_ref: input.target_ref,
      summary: input.summary,
      source_status: successful ? "located" : "unknown",
      business_effect: { kind: result.effect_kind, status: result.effect_status },
      operation,
      media_readback: result.media_readback,
      page_readback: result.page_readback,
      post_check: { status: postStatus, ref: postCheckRef },
      reconciliation: { status: reconcileStatus, ref: reconciliationRef },
      recovery: {
        status: successful ? "not_required" : "required",
        entrypoint: successful ? "none" : unknown ? "manual_reconciliation" : "inspect_operation_ref"
      },
      save_draft: "not_in_scope",
      publish: "not_in_scope",
      submitted: false
    },
    source_refs: mediaSourceRefs(result.source_refs, false),
    evidence_refs: mediaEvidenceRefs(result, postCheckRef, reconciliationRef)
  };
}

function unknownFieldReadback(): XhsFieldActionNormalizedResult["field_readback"] {
  return {
    status: "unknown",
    title: { status: "unknown", value_state: "unknown" },
    body: { status: "unknown", value_state: "unknown" },
    validation_status: "unknown"
  };
}

function unknownCommitReadback(): XhsCommitActionNormalizedResult["content_readback"] {
  return {
    state: "unknown",
    management_list_state: "unknown",
    detail_state: "not_run",
    fields_state: "unknown",
    media_state: "unknown",
    marker_state: "unknown",
    content_ref: null,
    canonical_url: null
  };
}

function commitSourceRefs(refs: readonly LocalProviderReadProbeRef[]): XhsMediaSourceRef[] {
  const kinds: XhsMediaSourceRef["source_kind"][] = ["commit_action_summary", "creator_publish_page_summary", "business_state_summary"];
  return refs.slice(0, 3).map((entry, index) => ({
    ref_id: entry.ref,
    source_kind: kinds[index] ?? "business_state_summary",
    producer: "harbor",
    redaction: "summary_only",
    schema_hint: "harbor-xhs-commit-action-summary.v0"
  }));
}

function mediaSourceRefs(refs: readonly LocalProviderReadProbeRef[], fieldAction: boolean): XhsMediaSourceRef[] {
  const kinds: XhsMediaSourceRef["source_kind"][] = [fieldAction ? "field_action_summary" : "media_action_summary", "creator_publish_page_summary", "business_state_summary"];
  return refs.slice(0, 3).map((entry, index) => ({
    ref_id: entry.ref,
    source_kind: kinds[index] ?? "business_state_summary",
    producer: "harbor",
    redaction: "summary_only",
    schema_hint: fieldAction ? "harbor-xhs-field-action-summary.v0" : "harbor-xhs-media-action-summary.v0"
  }));
}

function mediaEvidenceRefs(
  result: Extract<LocalProviderMediaActionResult, { status: "completed" }>,
  postCheckRef: string,
  reconciliationRef: string
): XhsMediaEvidenceRef[] {
  const refs: XhsMediaEvidenceRef[] = result.evidence_ref_kinds.map((entry): XhsMediaEvidenceRef => ({
    ref_id: entry.ref,
    evidence_kind: entry.kind === "operation_ref" || entry.kind === "post_check_ref" || entry.kind === "reconciliation_ref" || entry.kind === "snapshot_ref"
      ? entry.kind
      : "snapshot_ref",
    producer: "harbor",
    redaction: "refs_only"
  }));
  refs.push(
    { ref_id: postCheckRef, evidence_kind: "post_check_ref", producer: "harbor", redaction: "refs_only" },
    { ref_id: reconciliationRef, evidence_kind: "reconciliation_ref", producer: "harbor", redaction: "refs_only" }
  );
  return refs;
}
