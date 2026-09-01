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
export const XHS_MEDIA_ACTION_PACKAGE_REF = "lode://site-capability/xiaohongshu/publish-note-image-text-media@0.1.0";
export const XHS_MEDIA_ACTION_LOCK_REF = "lode://lock/site-capability/xiaohongshu/publish-note-image-text-media@0.1.0";

const actionPaths: Readonly<Record<XhsMediaActionId, XhsMediaActionPath>> = {
  "xhs_publish_note_image_text_media.image_upload": "image_text_upload",
  "xhs_publish_note_image_text_media.text_to_image_generate": "image_text_generate"
};

const actionEffects: Readonly<Record<XhsMediaActionId, XhsMediaEffectKind>> = {
  "xhs_publish_note_image_text_media.image_upload": "upload",
  "xhs_publish_note_image_text_media.text_to_image_generate": "generate"
};

const allowedKeys = new Set([
  "url", "target_ref", "holder_ref", "no_submit_guard", "action_id", "requested_path", "refs", "summary", "authorization_binding"
]);
const bindingKeys = new Set(["decision_ref", "action_id", "target_ref", "idempotency_key"]);
const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const opaquePublicRef = (value: unknown): value is string => safeText(value, 2_048) && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);

export interface AdmittedXhsMediaAction {
  url: string;
  target_ref: string;
  holder_ref?: string;
  no_submit_guard: "active";
  action_id: XhsMediaActionId;
  requested_path: XhsMediaActionPath;
  refs: readonly string[];
  summary: string;
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
    };

export type XhsMediaActionNormalizedResult = {
  action_id: XhsMediaActionId;
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

export interface XhsMediaSourceRef {
  ref_id: string;
  source_kind: "media_action_summary" | "creator_publish_page_summary" | "business_state_summary";
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

export type XhsMediaUnavailableReason =
  | "invalid_contract"
  | "resource_unavailable"
  | "login_required"
  | "permission_insufficient"
  | "safety_challenge"
  | "page_changed"
  | "media_ref_unavailable"
  | "generation_unavailable"
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
  if (!(actionId === "xhs_publish_note_image_text_media.image_upload" || actionId === "xhs_publish_note_image_text_media.text_to_image_generate") ||
    requestedPath !== actionPaths[actionId]) return null;
  if (input.no_submit_guard !== "active" || !opaquePublicRef(input.target_ref) || !safeText(input.summary, 512)) return null;
  if (input.holder_ref !== undefined && !opaquePublicRef(input.holder_ref)) return null;
  if (!Array.isArray(input.refs) || input.refs.length > 18 || !input.refs.every(opaquePublicRef)) return null;
  if (actionId.endsWith("image_upload") ? input.refs.length < 1 : input.refs.length !== 0) return null;
  if (!safeCreatorPublishUrl(input.url)) return null;
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
    authorization_binding: {
      decision_ref: binding.decision_ref as string,
      action_id: actionId,
      target_ref: input.target_ref as string,
      idempotency_key: binding.idempotency_key as string
    }
  };
}

function safeCreatorPublishUrl(value: unknown): value is string {
  if (!safeText(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://creator.xiaohongshu.com" && url.pathname === "/publish/publish" &&
      !url.username && !url.password && !url.hash &&
      [...url.searchParams].every(([key, item]) => safeText(key, 200) && (item === "" || safeText(item, 500)));
  } catch {
    return false;
  }
}

export function unavailableXhsMediaAction(
  runtimeSessionRef: string,
  input: Pick<AdmittedXhsMediaAction, "url" | "target_ref" | "action_id" | "requested_path" | "summary">,
  reason: XhsMediaUnavailableReason,
  operationRef = opaqueRef("media_operation")
): XhsMediaActionResult {
  const operationStatus = reason === "operation_result_unknown" || reason === "reconciliation_unknown" ? "unknown_outcome" : "terminal";
  const operation: XhsMediaActionNormalizedResult["operation"] = {
    status: operationStatus,
    operation_ref: operationRef,
    ...(operationStatus === "terminal" ? { terminal_state: "failure" as const } : {})
  };
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
  input: Pick<AdmittedXhsMediaAction, "url" | "target_ref" | "action_id" | "requested_path" | "summary">,
  result: Extract<LocalProviderMediaActionResult, { status: "completed" }>
): XhsMediaActionResult {
  const postCheckRef = opaqueRef("post_check");
  const reconciliationRef = opaqueRef("reconciliation");
  const operationStatus = result.operation_status;
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
      canonical_url: result.observed_url,
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
    source_refs: mediaSourceRefs(result.source_refs),
    evidence_refs: mediaEvidenceRefs(result, postCheckRef, reconciliationRef)
  };
}

function mediaSourceRefs(refs: readonly LocalProviderReadProbeRef[]): XhsMediaSourceRef[] {
  const kinds: XhsMediaSourceRef["source_kind"][] = ["media_action_summary", "creator_publish_page_summary", "business_state_summary"];
  return refs.slice(0, 3).map((entry, index) => ({
    ref_id: entry.ref,
    source_kind: kinds[index] ?? "business_state_summary",
    producer: "harbor",
    redaction: "summary_only",
    schema_hint: "harbor-xhs-media-action-summary.v0"
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
