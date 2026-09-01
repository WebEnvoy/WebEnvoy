import assert from "node:assert/strict";
import test from "node:test";
import {
  admitXhsMediaAction,
  completeXhsMediaAction,
  unavailableXhsMediaAction,
  xhsMediaActionEffect,
  xhsMediaActionPath
} from "./xhs-media-action.js";

const upload = {
  url: "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image",
  target_ref: "target-ref:xiaohongshu/creator-publish-page",
  no_submit_guard: "active" as const,
  action_id: "xhs_publish_note_image_text_media.image_upload" as const,
  requested_path: "image_text_upload" as const,
  refs: ["local_file_ref_11111111-1111-4111-8111-111111111111"],
  summary: "bounded image upload intent",
  authorization_binding: {
    decision_ref: "authorization-decision:11111111111111111111111111111111:22222222222222222222222222222222",
    action_id: "xhs_publish_note_image_text_media.image_upload" as const,
    target_ref: "target-ref:xiaohongshu/creator-publish-page",
    idempotency_key: "turn-media-upload-1"
  }
};

const generate = {
  ...upload,
  action_id: "xhs_publish_note_image_text_media.text_to_image_generate" as const,
  requested_path: "image_text_generate" as const,
  refs: [],
  summary: "bounded text to image intent",
  authorization_binding: {
    ...upload.authorization_binding,
    action_id: "xhs_publish_note_image_text_media.text_to_image_generate" as const
  }
};

test("keeps the two media actions independent and exact", () => {
  const admittedUpload = admitXhsMediaAction(upload);
  const admittedGenerate = admitXhsMediaAction(generate);
  assert.equal(admittedUpload?.requested_path, "image_text_upload");
  assert.equal(admittedGenerate?.requested_path, "image_text_generate");
  assert.equal(xhsMediaActionEffect(upload.action_id), "upload");
  assert.equal(xhsMediaActionEffect(generate.action_id), "generate");
  assert.equal(xhsMediaActionPath(upload.action_id), "image_text_upload");
  assert.equal(xhsMediaActionPath(generate.action_id), "image_text_generate");
  assert.equal(admitXhsMediaAction({ ...generate, refs: ["local_file_ref_11111111-1111-4111-8111-111111111111"] }), null);
  assert.equal(admitXhsMediaAction({ ...upload, requested_path: "image_text_generate" }), null);
});

test("preserves unknown upload outcome and never retries", () => {
  const result = unavailableXhsMediaAction("session_1", upload, "operation_result_unknown");
  assert.equal(result.status, "unavailable");
  assert.equal(result.unavailable_reason, "operation_result_unknown");
  assert.equal(result.normalized.operation.status, "unknown_outcome");
  assert.equal(result.normalized.recovery.entrypoint, "manual_reconciliation");
  assert.equal(result.normalized.submitted, false);
  assert.equal(result.normalized.save_draft, "not_in_scope");
  assert.equal(result.normalized.publish, "not_in_scope");
  const resolverFailure = unavailableXhsMediaAction("session_1", upload, "media_ref_unavailable");
  assert.equal(resolverFailure.normalized.business_effect.status, "failed");
  assert.equal(resolverFailure.normalized.operation.status, "terminal");
  assert.equal(resolverFailure.normalized.operation.terminal_state, "failure");
  assert.equal(resolverFailure.normalized.recovery.entrypoint, "inspect_operation_ref");
  assert.equal(resolverFailure.normalized.submitted, false);
});

test("does not promote a terminal effect without page/media readback", () => {
  const result = completeXhsMediaAction("session_1", upload, {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_url: upload.url,
    page: {
      current_url: upload.url,
      title: "creator",
      status: "ready",
      facts: []
    },
    action_id: upload.action_id,
    requested_path: upload.requested_path,
    effect_kind: "upload",
    effect_status: "observed",
    operation_status: "terminal",
    operation_ref: "media_operation_1",
    terminal_state: "success",
    media_readback: {
      status: "unknown",
      media_count: null,
      order_status: "unknown",
      generation_result_ref: null
    },
    page_readback: {
      status: "unknown",
      page_state_ref: "page-state_1",
      route_state: "unknown"
    },
    source_refs: [
      { kind: "media_action_summary", ref: "source_1" },
      { kind: "creator_publish_page_summary", ref: "source_2" },
      { kind: "business_state_summary", ref: "source_3" }
    ],
    evidence_ref_kinds: [
      { kind: "operation_ref", ref: "media_operation_1" },
      { kind: "snapshot_ref", ref: "evidence_1" }
    ],
    submitted: false
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.unavailable_reason, "operation_result_unknown");
  assert.equal(result.normalized.reconciliation.status, "unknown");
  assert.equal(result.normalized.submitted, false);
});
