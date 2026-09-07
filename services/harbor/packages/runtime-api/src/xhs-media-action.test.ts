import assert from "node:assert/strict";
import test from "node:test";
import {
  admitXhsMediaAction,
  completeXhsMediaAction,
  unavailableXhsMediaAction,
  XhsMediaActionObservationStore,
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

const fieldFill = {
  ...upload,
  action_id: "xhs_publish_note_image_text_fields.compose" as const,
  requested_path: "image_text_upload" as const,
  refs: [
    "draft:app-protected/11111111-1111-4111-8111-111111111111/title",
    "draft:app-protected/11111111-1111-4111-8111-111111111111/body"
  ],
  summary: "bounded title and body intent",
  authorization_binding: {
    ...upload.authorization_binding,
    action_id: "xhs_publish_note_image_text_fields.compose" as const
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
  assert.equal(admitXhsMediaAction(fieldFill)?.refs.length, 2);
  assert.equal(xhsMediaActionEffect(fieldFill.action_id), "modify");
  assert.equal(admitXhsMediaAction({ ...fieldFill, refs: [...fieldFill.refs].reverse() }), null);
});

test("normalizes field fill without exposing protected values", () => {
  const completed = completeXhsMediaAction("session_1", fieldFill, {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_url: fieldFill.url,
    page: { current_url: fieldFill.url, title: "creator", status: "ready", facts: [] },
    action_id: fieldFill.action_id,
    requested_path: fieldFill.requested_path,
    effect_kind: "modify",
    effect_status: "observed",
    operation_status: "terminal",
    operation_ref: "media_operation_field_1",
    terminal_state: "success",
    field_readback: {
      status: "observed",
      title: { status: "observed", value_state: "matched" },
      body: { status: "observed", value_state: "matched" },
      validation_status: "passed"
    },
    page_readback: { status: "observed", page_state_ref: "page_state_field_1", route_state: "observed" },
    source_refs: [
      { kind: "field_action_summary", ref: "source_field_1" },
      { kind: "creator_publish_page_summary", ref: "source_field_2" },
      { kind: "business_state_summary", ref: "source_field_3" }
    ],
    evidence_ref_kinds: [{ kind: "operation_ref", ref: "media_operation_field_1" }],
    submitted: false
  });
  assert.equal(completed.schema_version, "harbor-xhs-publish-note-image-text-fields/v0");
  assert.equal("result_kind" in completed && completed.result_kind, "xhs_publish_note_image_text_fields");
  assert.equal(completed.status, "available");
  assert.equal(completed.normalized.business_effect.kind, "modify");
  assert.equal("field_readback" in completed.normalized && completed.normalized.field_readback.validation_status, "passed");
  assert.equal("summary" in completed.normalized, false);
  assert.equal("media_readback" in completed.normalized, false);
  assert.equal(JSON.stringify(completed).includes(fieldFill.summary), false);
  const observation = new XhsMediaActionObservationStore();
  observation.record(completed);
  assert.equal(observation.get(completed.normalized.operation.operation_ref)?.operation_status, "terminal");

  const unknown = unavailableXhsMediaAction("session_1", fieldFill, "operation_result_unknown");
  assert.equal(unknown.schema_version, "harbor-xhs-publish-note-image-text-fields/v0");
  assert.equal(unknown.normalized.operation.status, "unknown_outcome");
  assert.equal(unknown.normalized.recovery.entrypoint, "manual_reconciliation");
  assert.equal(unknown.normalized.submitted, false);
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
  assert.equal(unavailableXhsMediaAction("session_1", upload, "resource_unavailable").unavailable_reason, "resource_unavailable");
});

test("operation refs resolve to the same public media action observation", () => {
  const store = new XhsMediaActionObservationStore();
  const result = store.record(unavailableXhsMediaAction("session_1", upload, "media_ref_unavailable"), {
    failure_stage: "file_input_missing",
    image_input_candidate_count: 0,
    image_path_candidate_count: 1,
    set_file_input_files: "not_called"
  });
  const operationRef = result.normalized.operation.operation_ref;
  const observation = store.get(operationRef);
  assert.equal(observation?.evidence_ref, operationRef);
  assert.equal(observation?.access_state, "available");
  assert.equal(observation?.operation_status, "terminal");
  assert.equal(observation?.terminal_state, "failure");
  assert.equal(observation?.business_effect_status, "failed");
  assert.equal(observation?.unavailable_reason, "media_ref_unavailable");
  assert.equal(observation?.retention_state, "ephemeral");
  assert.equal(observation?.storage_scope, "process_memory");
  assert.deepEqual(observation?.diagnostics, {
    failure_stage: "file_input_missing",
    image_input_candidate_count: 0,
    image_path_candidate_count: 1,
    set_file_input_files: "not_called"
  });
  assert.equal(JSON.stringify(observation).includes(upload.summary), false);
  assert.equal(JSON.stringify(observation).includes(upload.url), false);
  assert.notEqual(store.get(operationRef), observation);
  assert.equal(store.get(result.normalized.post_check.ref), undefined);
  assert.equal(store.get("media_operation_missing"), undefined);
});

test("does not promote a terminal effect without page/media readback", () => {
  const result = completeXhsMediaAction("session_1", upload, {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_url: "https://creator.xiaohongshu.com/login",
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
  assert.equal(result.normalized.canonical_url, upload.url);
  assert.equal(result.normalized.reconciliation.status, "unknown");
  assert.equal(result.normalized.submitted, false);
});
