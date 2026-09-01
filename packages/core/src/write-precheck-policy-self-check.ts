import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileAuthorizationDecisionStore, type FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { projectRunSummary } from "./run-query.js";
import { continueWritePrecheckTask, continueXhsMediaActionTask, recoverInterruptedCoreTaskSessions, submitRuntimeTask, type HarborRuntimeClient } from "./runtime-task-chain.js";
import type { HarborAdmissionInput } from "./harbor-admission.js";
import type { ExecutionPolicyMode, SingleActionDecision } from "./execution-policy.js";
import {
  xhsMediaActionPaths,
  xhsMediaCapabilityId,
  xhsMediaLockRef,
  xhsMediaOperationId,
  xhsMediaPackageRef,
  type LodePackageAdmissionContract,
  type XhsMediaActionId
} from "./lode-admission.js";
import type { AuthorizationDecisionSummary } from "./authorization-decision.js";
import type { TaskIntentEnvelope } from "./task-submission.js";
import {
  evaluateWritePrecheckTaskPolicy,
  isUnifiedWritePrecheckTask,
  isXhsPathPrepareTask,
  writePrecheckPolicyFailure,
  type WritePrecheckAuthorizationContext
} from "./write-precheck-policy.js";

const evaluatedAt = "2026-08-31T08:00:00.000Z";
const context: WritePrecheckAuthorizationContext = {
  thread_id: "thread_11111111111111111111111111111111",
  turn_id: "turn_22222222222222222222222222222222",
  turn_sequence: 1,
  idempotency_key: "turn-policy-check"
};

function contract(): LodePackageAdmissionContract {
  return {
    package_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
    source_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1",
    capability_id: "publish-note-precheck",
    operation_id: "xhs_publish_note_precheck",
    operation_mode: "validate_only",
    version: "0.1.0",
    runtime_admission: { enabled: true, status: "current", recheck_condition: "not_applicable" },
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: "xhs_publish_note_precheck",
        category: "prepare",
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["creator_publish_page"],
          supported_origins: ["https://creator.xiaohongshu.com"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: "xiaohongshu.publish-note-precheck.resources",
          profile_ids: ["xhs-creator-publish-page-precheck"]
        },
        external_effects: []
      }]
    },
    resource_requirements: {
      resource_requirements_id: "xiaohongshu.publish-note-precheck.resources",
      package_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
      operation_mode: "validate_only",
      resource_requirement_profiles: [{ requirement_profile_id: "xhs-creator-publish-page-precheck" }]
    }
  };
}

function taskIntent(): TaskIntentEnvelope {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: "intent_write_precheck_policy",
    entrypoint: "app",
    user_intent: { summary: "验证发布前页面" },
    capability: {
      ref: "lode:capability/publish-note-precheck",
      version: "0.1.0",
      source_ref: contract().package_ref,
      lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1"
    },
    input: { summary: "仅验证，不提交" },
    scope: {
      target_type: "creator_publish_page",
      target_ref: "https://creator.xiaohongshu.com/publish/publish"
    },
    policy: { risk: "write", execution_intent: "validate_only" },
    resource_requirement_refs: ["xiaohongshu.publish-note-precheck.resources"],
    resource_requirement_profile_id: "xhs-creator-publish-page-precheck",
    evidence_policy_ref: "policy:no-raw-evidence"
  };
}

function pathPrepareContract(): LodePackageAdmissionContract {
  return {
    package_ref: "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0",
    source_ref: "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-path-prepare@0.1.0",
    capability_id: "publish-note-path-prepare",
    operation_id: "xhs_publish_note_path_prepare",
    operation_mode: "validate_only",
    version: "0.1.0",
    lifecycle: "proposed",
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: "xhs_publish_note_path_prepare",
        category: "prepare",
        target_scope: { site_slug: "xiaohongshu", target_types: ["creator_publish_page"], supported_origins: ["https://creator.xiaohongshu.com"] },
        resource_requirements: { path: "resource-requirements.json", id: "xiaohongshu.publish-note-path-prepare.resources", profile_ids: ["xhs-creator-publish-page-path-prepare"] },
        external_effects: []
      }]
    },
    resource_requirements: {
      resource_requirements_id: "xiaohongshu.publish-note-path-prepare.resources",
      package_ref: "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0",
      operation_mode: "validate_only",
      resource_requirement_profiles: [{ requirement_profile_id: "xhs-creator-publish-page-path-prepare" }]
    }
  };
}

function pathPrepareTaskIntent(contractValue = pathPrepareContract()): TaskIntentEnvelope {
  return {
    ...taskIntent(),
    intent_id: "intent_path_prepare_policy",
    capability: { ref: "lode:capability/publish-note-path-prepare", version: "0.1.0", source_ref: contractValue.package_ref, lock_ref: contractValue.lock_ref! },
    input: { summary: "选择图文路径", requested_path: "image_text_upload" },
    resource_requirement_refs: ["xiaohongshu.publish-note-path-prepare.resources"],
    resource_requirement_profile_id: "xhs-creator-publish-page-path-prepare"
  };
}

function configStore(mode: ExecutionPolicyMode): FileExecutionPolicyConfigStore {
  return {
    resolveSources: async () => ({
      global_user_config: {
        source_ref: "execution-policy:global_user_config:global",
        source_version: "1",
        modes: { read: "auto", prepare: mode, commit: "confirm", destructive: "deny" }
      }
    })
  } as unknown as FileExecutionPolicyConfigStore;
}

function mediaConfigStore(mode: ExecutionPolicyMode): FileExecutionPolicyConfigStore {
  return {
    resolveSources: async () => ({
      global_user_config: {
        source_ref: "execution-policy:global_user_config:media",
        source_version: "1",
        modes: { read: "auto", prepare: "auto", commit: mode, destructive: "deny" }
      }
    })
  } as unknown as FileExecutionPolicyConfigStore;
}

function mediaContract(): LodePackageAdmissionContract {
  const action = (actionId: XhsMediaActionId, profileId: string, effect: string) => ({
    action_id: actionId,
    category: "commit" as const,
    target_scope: {
      site_slug: "xiaohongshu",
      target_types: ["creator_publish_page"],
      supported_origins: ["https://creator.xiaohongshu.com"]
    },
    resource_requirements: {
      path: "resource-requirements.json",
      id: "xiaohongshu.publish-note-image-text-media.resources",
      profile_ids: [profileId]
    },
    external_effects: [effect]
  });
  return {
    package_ref: xhsMediaPackageRef,
    source_ref: xhsMediaPackageRef,
    lock_ref: xhsMediaLockRef,
    capability_id: xhsMediaCapabilityId,
    operation_id: xhsMediaOperationId,
    operation_mode: "write",
    version: "0.1.0",
    lifecycle: "proposed",
    runtime_admission: {
      enabled: true,
      status: "controlled_evidence",
      recheck_condition: "formal_live_evidence_required"
    },
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [
        action("xhs_publish_note_image_text_media.image_upload", "xhs-image-upload", "upload"),
        action("xhs_publish_note_image_text_media.text_to_image_generate", "xhs-text-to-image-generate", "create")
      ]
    },
    resource_requirements: {
      schema_version: "lode.resource-requirements.v0",
      resource_requirements_id: "xiaohongshu.publish-note-image-text-media.resources",
      package_ref: xhsMediaPackageRef,
      operation_mode: "write",
      resource_requirement_profiles: [
        { requirement_profile_id: "xhs-image-upload" },
        { requirement_profile_id: "xhs-text-to-image-generate" }
      ]
    }
  };
}

function mediaTaskIntent(
  actionId: XhsMediaActionId = "xhs_publish_note_image_text_media.image_upload",
  intentId = "intent_xhs_media_action",
  refs = ["attachment:fixture/image-1"]
): TaskIntentEnvelope {
  const requestedPath = xhsMediaActionPaths[actionId];
  const profileId = actionId === "xhs_publish_note_image_text_media.image_upload"
    ? "xhs-image-upload"
    : "xhs-text-to-image-generate";
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "准备小红书图文媒体" },
    capability: {
      ref: `lode:capability/${xhsMediaCapabilityId}`,
      version: "0.1.0",
      source_ref: xhsMediaPackageRef,
      lock_ref: xhsMediaLockRef
    },
    input: { summary: "准备一条图文媒体动作", action_id: actionId, requested_path: requestedPath, refs },
    scope: {
      target_type: "creator_publish_page",
      target_ref: "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image"
    },
    policy: { risk: "write", execution_intent: "execute_after_approval" },
    resource_requirement_refs: ["xiaohongshu.publish-note-image-text-media.resources"],
    resource_requirement_profile_id: profileId,
    evidence_policy_ref: "policy:no-raw-evidence"
  };
}

function mediaOutput(input: {
  action_id: XhsMediaActionId;
  requested_path: string;
  canonical_url: string;
  target_ref: string;
  runtime_session_ref: string;
  suffix: string;
  producer?: "core" | "harbor" | "fixture";
  operation_status?: "accepted" | "running" | "terminal" | "unknown_outcome";
}): Record<string, unknown> {
  const producer = input.producer ?? "harbor";
  const operationStatus = input.operation_status ?? "terminal";
  const operationRef = `operation_media_${input.suffix}`;
  const postCheckRef = `postcheck_media_${input.suffix}`;
  const reconciliationRef = `reconcile_media_${input.suffix}`;
  const mediaRefId = `media_readback_${input.suffix}`;
  const pageRef = `page_readback_${input.suffix}`;
  const recovery = operationStatus === "unknown_outcome"
    ? { status: "required", entrypoint: "manual_reconciliation" }
    : { status: "not_required", entrypoint: "none" };
  return {
    result_kind: "xhs_publish_note_image_text_media",
    status: "available",
    classification: "success_result",
    normalized: {
      action_id: input.action_id,
      requested_path: input.requested_path,
      canonical_url: input.canonical_url,
      target_ref: input.target_ref,
      summary: "Harbor returned bounded media action evidence.",
      source_status: "located",
      business_effect: {
        kind: input.action_id === "xhs_publish_note_image_text_media.image_upload" ? "upload" : "generate",
        status: operationStatus === "terminal" ? "observed" : "unknown"
      },
      operation: {
        status: operationStatus,
        operation_ref: operationRef,
        ...(operationStatus === "terminal" ? { terminal_state: "success" } : {})
      },
      media_readback: {
        status: operationStatus === "terminal" ? "observed" : "unknown",
        media_count: operationStatus === "terminal" ? 1 : null,
        order_status: operationStatus === "terminal" ? "observed" : "unknown",
        generation_result_ref: null,
        ordered_item_refs: operationStatus === "terminal" ? [mediaRefId] : []
      },
      page_readback: {
        status: operationStatus === "terminal" ? "observed" : "unknown",
        page_state_ref: pageRef,
        route_state: operationStatus === "terminal" ? "observed" : "unknown"
      },
      post_check: { status: operationStatus === "terminal" ? "passed" : "skipped", ref: postCheckRef },
      reconciliation: { status: operationStatus === "terminal" ? "matched" : "unknown", ref: reconciliationRef },
      recovery,
      save_draft: "not_in_scope",
      publish: "not_in_scope",
      submitted: false
    },
    source_refs: [
      { ref_id: `source_media_${input.suffix}`, source_kind: "media_action_summary", producer, redaction: "summary_only", schema_hint: "harbor-xhs-publish-note-image-text-media/v0" },
      { ref_id: pageRef, source_kind: "creator_publish_page_summary", producer, redaction: "summary_only", schema_hint: "harbor-xhs-publish-note-image-text-media/v0" }
    ],
    evidence_refs: [
      { ref_id: operationRef, evidence_kind: "operation_ref", producer, redaction: "placeholder_only" },
      { ref_id: postCheckRef, evidence_kind: "post_check_ref", producer, redaction: "placeholder_only" },
      { ref_id: reconciliationRef, evidence_kind: "reconciliation_ref", producer, redaction: "placeholder_only" }
    ]
  };
}

function mediaDecisionFromConfirmation(confirmation: AuthorizationDecisionSummary): SingleActionDecision {
  if (!confirmation.business_action || !confirmation.owner_declaration || !confirmation.effective_policy ||
    confirmation.effective_policy.source === "single_action" || confirmation.expires_at === null) {
    throw new Error("media_confirmation_summary_invalid");
  }
  return {
    schema_version: "webenvoy.single-action-decision.v0",
    confirmation_decision_ref: confirmation.decision_ref,
    source_ref: "execution-policy:single-action:media",
    source_version: "1",
    action_instance_ref: confirmation.business_action.action_instance_ref,
    action_id: confirmation.business_action.action_id,
    category: confirmation.business_action.category ?? "commit",
    target: confirmation.business_action.target,
    owner_matcher: confirmation.owner_declaration.matcher,
    owner_declaration_ref: confirmation.owner_declaration.declaration_ref,
    owner_declaration_version: confirmation.owner_declaration.declaration_version,
    resource_match_ref: confirmation.owner_declaration.resource_match_ref,
    resource_match_version: confirmation.owner_declaration.resource_match_version,
    effective_policy_source_ref: confirmation.applicability.config_refs[0]!,
    effective_policy_source_version: confirmation.effective_policy.source_version,
    effective_policy_source: confirmation.effective_policy.source,
    mode: "auto",
    state: "active",
    issued_at: confirmation.decided_at,
    expires_at: confirmation.expires_at
  };
}

function runtimeBindingFacts(runtimeSessionRef: string, identityRef = "identity-env_xhs-policy"): HarborAdmissionInput {
  const executionIdentityRef = `${identityRef}:execution`;
  const profileRef = `${identityRef}:profile`;
  const providerRef = "provider_xhs";
  const viewerRef = `${runtimeSessionRef}:viewer`;
  return {
    harbor_identity_environment_facts: {
      schema_version: "harbor-local-identity-environment/v0",
      identity_environment_ref: identityRef,
      execution_identity_ref: executionIdentityRef,
      profile_ref: profileRef,
      site_binding: { site_id: "xiaohongshu", origin: "https://creator.xiaohongshu.com" },
      login_state: {
        state: "logged_in",
        authentication_provenance: "user_confirmed_managed_session",
        manual_authentication_state: "completed",
        recovery_required: false
      },
      browser_storage: { state: "present" },
      provider_binding: { selected_provider_id: providerRef, binding_status: "default_provider_available" },
      consumer_boundary: {
        core: "admission_facts_refs_and_blocking_reasons_only",
        not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
      }
    },
    harbor_provider_status: {
      schema_version: "harbor-browser-provider-status/v0",
      providers: [{ provider_id: providerRef, install: { status: "installed", launchability: "launchable" } }]
    },
    harbor_runtime_facts: {
      schema_version: "harbor-core-runtime-facts/v0",
      runtime_session_ref: runtimeSessionRef,
      identity_environment_ref: identityRef,
      execution_identity_ref: executionIdentityRef,
      profile_ref: profileRef,
      provider_ref: providerRef,
      provider_mode: "local_dedicated_profile",
      lifecycle_state: "active",
      availability: { cdp: "available", viewer: "unsupported", snapshot: "available", evidence: "available" },
      viewer: { viewer_ref: viewerRef, availability: "unsupported", access_mode: "none", expires_at: evaluatedAt },
      control: { owner: "core_task", handoff_reason: null, takeover: { available: false, unavailable_reason: "viewer_unavailable" }, updated_at: evaluatedAt },
      current_error: null,
      fact_refs: { session: runtimeSessionRef, viewer: viewerRef },
      unavailable: null
    }
  } as unknown as HarborAdmissionInput;
}

function singleActionDecision(evaluation: Awaited<ReturnType<typeof evaluate>>, mode: "auto" | "deny" = "auto"): SingleActionDecision {
  if ("category" in evaluation || evaluation.evaluation.status !== "evaluated" || !evaluation.evaluation.confirmation_request) {
    throw new Error("confirmation evaluation required");
  }
  const confirmation = evaluation.evaluation.confirmation_request;
  return {
    schema_version: "webenvoy.single-action-decision.v0",
    confirmation_decision_ref: "authorization-decision:11111111111111111111111111111111:22222222222222222222222222222222",
    source_ref: "execution-policy:single-action:precheck",
    source_version: "1",
    action_instance_ref: confirmation.action_instance_ref,
    action_id: confirmation.action_id,
    category: confirmation.category,
    target: confirmation.target,
    owner_matcher: confirmation.owner_matcher,
    owner_declaration_ref: confirmation.owner_declaration_ref,
    owner_declaration_version: confirmation.owner_declaration_version,
    resource_match_ref: confirmation.resource_match_ref,
    resource_match_version: confirmation.resource_match_version,
    effective_policy_source_ref: confirmation.effective_policy_source_ref,
    effective_policy_source_version: confirmation.effective_policy_source_version,
    effective_policy_source: confirmation.effective_policy_source,
    mode,
    state: "active",
    issued_at: "2026-08-31T07:59:59.000Z",
    expires_at: "2026-08-31T08:10:00.000Z"
  };
}

function completedWritePrecheckOperation(input: {
  runtime_session_ref: string;
  target_ref: string;
  suffix: string;
}): Record<string, unknown> {
  const pageSourceRef = `source_page_${input.suffix}`;
  const domSourceRef = `source_dom_${input.suffix}`;
  const snapshotRef = `evidence_snapshot_${input.suffix}`;
  const postCheckRef = `postcheck_${input.suffix}`;
  return {
    schema_version: "harbor-validate-only-write-precheck/v0",
    status: "completed",
    runtime_session_ref: input.runtime_session_ref,
    target_ref: input.target_ref,
    page_ref: `page_${input.suffix}`,
    operation_ref: `operation_${input.suffix}`,
    result_ref: `result_${input.suffix}`,
    submitted_result_ref: `submitted_result_${input.suffix}`,
    observed_at: evaluatedAt,
    classification: "partial_result",
    precheck_scope: "entrypoint_only",
    composition_path: "image_text_upload",
    composition_state: "composition_not_initialized",
    no_submit_guard: "active",
    submitted: false,
    lode_pin: {
      package_ref: contract().package_ref,
      lock_ref: contract().lock_ref,
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
    },
    public_boundary: {
      raw_dom: "not_exposed",
      raw_har: "not_exposed",
      screenshot_body: "not_exposed",
      credentials: "not_exposed",
      external_write_actions: "not_performed"
    },
    source_refs: [
      { kind: "creator_publish_page_summary", ref: pageSourceRef },
      { kind: "dom_snapshot_summary", ref: domSourceRef }
    ],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: snapshotRef }, { kind: "post_check_ref", ref: postCheckRef }],
    post_check: {
      status: "passed",
      reason: "validated_creator_entrypoint_without_submission",
      submitted: false,
      no_submit_guard: "active",
      post_check_ref: postCheckRef,
      source_refs: [{ ref: pageSourceRef }, { ref: domSourceRef }],
      evidence_refs: [{ ref: snapshotRef }]
    },
    entrypoint_observations: {
      route_loaded: true,
      publish_vue_container_visible: true,
      upload_image_tab_active: true,
      upload_image_entry_visible: true,
      text_image_entry_visible: true,
      path_observed: "observed",
      path_entry_visible: "observed",
      user_confirmed_identity: true,
      challenge_absent: true
    },
    field_states: {
      title_input: { availability: "unavailable", observation: "not_observed" },
      content_editor: { availability: "unavailable", observation: "not_observed" },
      publish_control: { availability: "unavailable", observation: "not_observed" }
    },
    media_state: { availability: "unknown", observation: "unknown", controls: {} },
    validation_state: { availability: "unknown", observation: "unknown" },
    save_draft_control: { availability: "unknown", observation: "unknown" },
    publish_control: { availability: "unavailable", observation: "not_observed" },
    prohibited_actions_observed: { submit: false, publish: false, upload: false, generate: false, save: false }
  };
}

function completedPathPrepareOperation(input: {
  runtime_session_ref: string;
  identity_ref: string;
  canonical_url: string;
  target_ref: string;
  suffix: string;
}): Record<string, unknown> {
  const sourceRefs = ["page", "dom", "business"].map((name) => `source_${name}_${input.suffix}`);
  const snapshotRef = `evidence_snapshot_${input.suffix}`;
  const postCheckRef = `postcheck_${input.suffix}`;
  const businessState = { route_state: "observed", control_owner_state: "observed", observed_path: "observed", composition_state: "not_initialized", submitted: false };
  return {
    schema_version: "harbor-xhs-publish-note-path-prepare/v0",
    status: "completed",
    runtime_session_ref: input.runtime_session_ref,
    identity_ref: input.identity_ref,
    observed_at: evaluatedAt,
    submitted: false,
    target_ref: input.target_ref,
    result_kind: "xhs_publish_note_path_prepare",
    normalized: {
      canonical_url: input.canonical_url,
      target_ref: input.target_ref,
      title: "小红书图文创作页",
      summary: "已回读图文子路径与 composition 业务状态。",
      source_status: "located",
      requested_path: "image_text_upload",
      observed_path: "observed",
      composition_state: "not_initialized",
      business_state_before: { ...businessState, observed_path: "unknown", composition_state: "unknown" },
      business_state_after: businessState,
      interaction: { allowed_action: "exact_visible_path_control_selection", requested_control: "upload_image", selection_status: "selected", readback_status: "read" },
      composition_state_proof: { basis: "unknown", path_entry_alone_proves_initialized: false },
      submitted: false,
      prohibited_actions_observed: { file_chooser: false, file_select: false, upload: false, generate: false, field_fill: false, save_draft: false, publish: false, submit: false, retry: false, bypass: false },
      no_submit_guard_status: "active"
    },
    source_refs: [
      { kind: "creator_publish_page_summary", ref: sourceRefs[0] },
      { kind: "dom_snapshot_summary", ref: sourceRefs[1] },
      { kind: "business_state_summary", ref: sourceRefs[2] }
    ],
    evidence_refs: [{ kind: "snapshot_ref", ref: snapshotRef }, { kind: "post_check_ref", ref: postCheckRef }],
    post_check: {
      status: "passed",
      reason: "validated_creator_path_without_submission",
      post_check_ref: postCheckRef,
      source_refs: [
        { kind: "creator_publish_page_summary", ref: sourceRefs[0] },
        { kind: "dom_snapshot_summary", ref: sourceRefs[1] },
        { kind: "business_state_summary", ref: sourceRefs[2] }
      ],
      evidence_refs: [{ kind: "snapshot_ref", ref: snapshotRef }, { kind: "post_check_ref", ref: postCheckRef }],
      submitted: false,
      requested_path: "image_text_upload",
      observed_path: "observed",
      composition_state: "not_initialized",
      business_state_before: { ...businessState, observed_path: "unknown", composition_state: "unknown" },
      business_state_after: businessState,
      no_submit_guard_status: "active"
    },
    lode_pin: {
      package_ref: "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0",
      lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-path-prepare@0.1.0",
      input_schema_ref: "lode://schema/site-capability/xiaohongshu/publish-note-path-prepare/input@0.1.0",
      output_schema_ref: "lode://schema/site-capability/xiaohongshu/publish-note-path-prepare/output@0.1.0",
      version: "0.1.0",
      operation_id: "xhs_publish_note_path_prepare",
      operation_mode: "validate_only",
      origin: "https://creator.xiaohongshu.com",
      repository: "WebEnvoy/Lode",
      commit: "d09a2d683007c9f396838bdab92ecf7c0e6b339c",
      asset_path: "sites/xiaohongshu/publish-note-path-prepare/manifest.json"
    },
    public_boundary: { raw_dom: "not_exposed", raw_har: "not_exposed", screenshot_body: "not_exposed", credentials: "not_exposed", external_write_actions: "not_performed" }
  };
}

async function evaluate(
  mode: ExecutionPolicyMode,
  authorizationContext = context,
  single_action_decision?: SingleActionDecision,
) {
  return evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-233",
    task_intent: taskIntent(),
    lode_contract: contract(),
    authorization_context: authorizationContext,
    config_store: configStore(mode),
    ...(single_action_decision === undefined ? {} : { single_action_decision }),
    evaluated_at: evaluatedAt
  });
}

export async function assertWritePrecheckPolicyWiring(): Promise<void> {
  const pathContract = pathPrepareContract();
  const pathTask = pathPrepareTaskIntent(pathContract);
  assert.equal(isXhsPathPrepareTask(pathTask, pathContract), true);
  assert.equal(isXhsPathPrepareTask({ ...pathTask, input: { ...pathTask.input, requested_path: "video" } }, pathContract), false);
  const pathPolicy = await evaluateWritePrecheckTaskPolicy({ run_id: "app-xhs-path-prepare", task_intent: pathTask, lode_contract: pathContract, authorization_context: context, config_store: configStore("auto"), evaluated_at: evaluatedAt });
  assert.ok(!("category" in pathPolicy));
  assert.equal(pathPolicy.evaluation.status === "evaluated" && pathPolicy.evaluation.next_step, "execute");

  const pathDirectory = await mkdtemp(join(tmpdir(), "webenvoy-path-prepare-output-"));
  try {
    let currentRunId = "";
    let mutatePathOperation: ((operation: Record<string, unknown>) => void) | undefined;
    let pathRequestBody: Record<string, unknown> | undefined;
    let pathFailureStage: "session_precheck" | "provider_probe_initial" | "provider_selection" | "provider_readback_freshness" | undefined;
    let bindingAtValidate: string | undefined;
    const identityRef = "identity-env_xhs-path-prepare";
    const runStore = createFileRunRecordStore({ directory: join(pathDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(pathDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: { getTaskThread: async () => ({ thread_id: context.thread_id, turns: [{ turn_id: context.turn_id, run_id: currentRunId }] }) },
      clock: () => new Date(evaluatedAt)
    });
    const harbor = {
      collectAdmissionFacts: async () => runtimeBindingFacts(`session_${currentRunId}`, identityRef),
      validateOnlyWritePrecheck: async (input: { runtime_session_ref: string; target_ref: string; url: string; requested_path?: string; holder_ref?: string; requested_fields?: readonly string[]; include_source_refs?: boolean; proposed_input_summary?: string }) => {
        pathRequestBody = { ...input };
        bindingAtValidate = (await runStore.getRunRecord(currentRunId))?.admission.runtime_session_binding?.runtime_session_ref;
        assert.equal(bindingAtValidate, `session_${currentRunId}`);
        if (pathFailureStage !== undefined) {
          return {
            schema_version: "harbor-xhs-publish-note-path-prepare/v0",
            status: "unavailable",
            runtime_session_ref: input.runtime_session_ref,
            failure_class: "evidence_unavailable",
            retryable: false,
            failure_stage: pathFailureStage,
            submitted: false
          };
        }
        const operation = completedPathPrepareOperation({
          runtime_session_ref: input.runtime_session_ref,
          identity_ref: identityRef,
          canonical_url: input.url,
          target_ref: input.target_ref,
          suffix: currentRunId
        });
        mutatePathOperation?.(operation);
        return operation;
      },
      executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
      releaseCoreTaskSession: async () => undefined
    } as HarborRuntimeClient;
    for (const [name, mutation, succeeds] of [
      ["valid", () => undefined, true],
      ["pin-drift", (operation: Record<string, unknown>) => { (operation.lode_pin as Record<string, unknown>).commit = "attacker"; }, false],
      ["missing-source-ref", (operation: Record<string, unknown>) => { delete ((operation.source_refs as Record<string, unknown>[])[2]!).ref; }, false],
      ["normalized-extra", (operation: Record<string, unknown>) => { (operation.normalized as Record<string, unknown>).raw_dom = "private"; }, false],
      ["composition-unknown", (operation: Record<string, unknown>) => { (operation.normalized as Record<string, unknown>).composition_state = "unknown"; }, false]
    ] as const) {
      currentRunId = `app-xhs-path-prepare-${name}`;
      mutatePathOperation = mutation;
      const intent = { ...pathTask, intent_id: `intent_path_prepare_${name}` };
      const result = await submitRuntimeTask(runStore, {
        run_id: currentRunId,
        task_intent: intent,
        package_ref: pathContract.package_ref,
        authorization_context: { ...context, idempotency_key: `path-prepare-${name}` },
        harbor: { identity_environment_ref: identityRef, url: intent.scope.target_ref, requested_path: "image_text_upload" }
      }, {
        lodePackageResolver: async () => pathContract,
        harborRuntimeClient: harbor,
        executionPolicyConfigStore: configStore("auto"),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(result.ok, succeeds, `${name}:${JSON.stringify(result)}`);
      assert.equal(result.run_record?.status, succeeds ? "succeeded" : "failed", name);
    }
    assert(pathRequestBody);
    assert.deepEqual(Object.keys(pathRequestBody).sort(), ["holder_ref", "requested_path", "runtime_session_ref", "target_ref", "url"]);
    assert.equal(pathRequestBody.requested_path, "image_text_upload");
    assert.equal(pathRequestBody.requested_fields, undefined);
    assert.equal(pathRequestBody.include_source_refs, undefined);
    assert.equal(pathRequestBody.proposed_input_summary, undefined);
    for (const failure_stage of [
      "session_precheck",
      "provider_probe_initial",
      "provider_selection",
      "provider_readback_freshness"
    ] as const) {
      currentRunId = `app-xhs-path-prepare-failure-${failure_stage}`;
      pathFailureStage = failure_stage;
      const result = await submitRuntimeTask(runStore, {
        run_id: currentRunId,
        task_intent: { ...pathTask, intent_id: `intent_path_prepare_failure_${failure_stage}` },
        package_ref: pathContract.package_ref,
        authorization_context: { ...context, idempotency_key: `path-prepare-failure-${failure_stage}` },
        harbor: { identity_environment_ref: identityRef, url: pathTask.scope.target_ref, requested_path: "image_text_upload" }
      }, {
        lodePackageResolver: async () => pathContract,
        harborRuntimeClient: harbor,
        executionPolicyConfigStore: configStore("auto"),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(result.ok, false, failure_stage);
      if (!result.ok) assert.equal(result.failure.failure_stage, failure_stage);
      assert.equal(result.run_record?.failure?.failure_stage, failure_stage);
      assert.equal(projectRunSummary(result.run_record!).terminal_summary?.failure?.failure_stage, failure_stage);
      assert.equal(result.run_record?.status, "failed", failure_stage);
    }
    pathFailureStage = undefined;
  } finally {
    await rm(pathDirectory, { recursive: true, force: true });
  }
  const bindingPersistenceDirectory = await mkdtemp(join(tmpdir(), "webenvoy-path-prepare-binding-persistence-"));
  try {
    const baseStore = createFileRunRecordStore({ directory: join(bindingPersistenceDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const runStore = {
      ...baseStore,
      bindCoreTaskRuntimeSession: async () => { throw new Error("injected binding persistence failure"); }
    };
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(bindingPersistenceDirectory, "decisions"),
      runRecordStore: baseStore,
      taskThreadStore: { getTaskThread: async () => ({ thread_id: context.thread_id, turns: [{ turn_id: context.turn_id, run_id: "app-xhs-path-prepare-binding-persistence" }] }) },
      clock: () => new Date(evaluatedAt)
    });
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-path-prepare-binding-persistence",
      task_intent: { ...pathTask, intent_id: "intent_path_prepare_binding_persistence" },
      package_ref: pathContract.package_ref,
      authorization_context: { ...context, idempotency_key: "path-prepare-binding-persistence" },
      harbor: { identity_environment_ref: "identity-env_xhs-policy", url: pathTask.scope.target_ref, requested_path: "image_text_upload" }
    }, {
      lodePackageResolver: async () => pathContract,
      harborRuntimeClient: {
        collectAdmissionFacts: async () => runtimeBindingFacts("session_binding_persistence"),
        validateOnlyWritePrecheck: async () => { validateCalls += 1; throw new Error("binding persistence must stop before validate"); },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      } as HarborRuntimeClient,
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "runtime_binding_persistence_failed");
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(validateCalls, 0);
    assert.equal(releaseCalls, 1);
  } finally {
    await rm(bindingPersistenceDirectory, { recursive: true, force: true });
  }
  assert.equal(isUnifiedWritePrecheckTask(taskIntent(), contract()), true);
  const spoofedTask = structuredClone(taskIntent());
  spoofedTask.capability.ref = "lode:capability/evil-cap";
  assert.equal(isUnifiedWritePrecheckTask(spoofedTask, contract()), false);
  const spoofedContract = structuredClone(contract());
  spoofedContract.capability_id = "evil-cap";
  assert.equal(isUnifiedWritePrecheckTask(taskIntent(), spoofedContract), false);

  const spoofDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-spoof-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(spoofDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    let harborCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-spoof",
      task_intent: spoofedTask,
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        validateOnlyWritePrecheck: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        executeReadOperation: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        releaseCoreTaskSession: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); }
      } as HarborRuntimeClient
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "write_precheck_binding_invalid");
    assert.equal(harborCalls, 0);
  } finally {
    await rm(spoofDirectory, { recursive: true, force: true });
  }

  const automatic = await evaluate("auto");
  assert.ok(!("category" in automatic));
  assert.equal(automatic.evaluation.status === "evaluated" && automatic.evaluation.next_step, "execute");
  assert.equal(writePrecheckPolicyFailure(automatic.evaluation).code, "harbor_write_precheck_operation_unavailable");

  const confirmation = await evaluate("confirm");
  assert.ok(!("category" in confirmation));
  assert.equal(confirmation.evaluation.status === "evaluated" && confirmation.evaluation.next_step, "request_confirmation");
  assert.equal(writePrecheckPolicyFailure(confirmation.evaluation).code, "authorization_confirmation_required");
  const denied = await evaluate("deny");
  assert.ok(!("category" in denied));
  assert.equal(denied.evaluation.status === "evaluated" && denied.evaluation.next_step, "stop");
  assert.equal(writePrecheckPolicyFailure(denied.evaluation).code, "execution_policy_denied");

  const allowOnce = await evaluate("confirm");
  const allowedOnceDecision = singleActionDecision(allowOnce);
  const allowedOnce = await evaluate("confirm", context, allowedOnceDecision);
  assert.ok(!("category" in allowedOnce));
  assert.equal(allowedOnce.evaluation.status === "evaluated" && allowedOnce.evaluation.next_step, "execute");
  assert.equal(allowedOnce.evaluation.status === "evaluated" && allowedOnce.evaluation.effective_policy.source, "single_action_decision");
  const expiredDecision = { ...allowedOnceDecision, expires_at: evaluatedAt };
  const expired = await evaluate("confirm", context, expiredDecision);
  assert.ok(!("category" in expired));
  assert.equal(expired.evaluation.status === "evaluated" && expired.evaluation.next_step, "request_confirmation");

  const reclassifiedContract = structuredClone(contract());
  reclassifiedContract.action_declaration!.actions[0]!.category = "commit";
  const reclassified = await evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-reclassified",
    task_intent: taskIntent(),
    lode_contract: reclassifiedContract,
    authorization_context: context,
    config_store: configStore("auto"),
    evaluated_at: evaluatedAt
  });
  assert.equal("category" in reclassified && reclassified.code, "execution_policy_owner_declaration_invalid");

  const changedProfileContract = structuredClone(contract());
  changedProfileContract.resource_requirements.resource_requirement_profiles[0]!.requirement_profile_id = "other-profile";
  const changedProfile = await evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-profile-drift",
    task_intent: taskIntent(),
    lode_contract: changedProfileContract,
    authorization_context: context,
    config_store: configStore("auto"),
    evaluated_at: evaluatedAt
  });
  assert.equal("category" in changedProfile && changedProfile.code, "execution_policy_owner_declaration_invalid");

  const unavailable = await evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-owner-unavailable",
    task_intent: taskIntent(),
    lode_contract: contract(),
    authorization_context: context,
    config_store: { resolveSources: async () => { throw new Error("unavailable"); } } as unknown as FileExecutionPolicyConfigStore,
    evaluated_at: evaluatedAt
  });
  assert.equal("category" in unavailable && unavailable.code, "execution_policy_owner_unavailable");

  const first = await evaluate("auto");
  const replay = await evaluate("auto");
  assert.deepEqual(replay, first);

  for (const [mode, expectedStatus, expectedCode] of [
    ["auto", "succeeded", undefined],
    ["confirm", "requires_user_action", "authorization_confirmation_required"],
    ["deny", "failed", "execution_policy_denied"]
  ] as const) {
    const directory = await mkdtemp(join(tmpdir(), `webenvoy-write-policy-${mode}-`));
    try {
      const runStore = createFileRunRecordStore({ directory: join(directory, "runs"), clock: () => new Date(evaluatedAt) });
      const authorizationStore = createFileAuthorizationDecisionStore({
        directory: join(directory, "decisions"),
        runRecordStore: runStore,
        taskThreadStore: {
          getTaskThread: async () => ({
            thread_id: context.thread_id,
            turns: [{ turn_id: context.turn_id, run_id: `app-xhs-write-precheck-${mode}` }]
          })
        },
        clock: () => new Date(evaluatedAt)
      });
      let collectCalls = 0;
      let validateCalls = 0;
      let releaseCalls = 0;
      let legacyRequestBody: Record<string, unknown> | undefined;
      const harbor = {
        collectAdmissionFacts: async () => {
          collectCalls += 1;
          return runtimeBindingFacts(`session_${mode}`);
        },
        validateOnlyWritePrecheck: async (input: { runtime_session_ref: string; target_ref: string }) => {
          validateCalls += 1;
          legacyRequestBody = { ...input };
          return completedWritePrecheckOperation({ runtime_session_ref: input.runtime_session_ref, target_ref: input.target_ref, suffix: mode });
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      } as HarborRuntimeClient;
      const result = await submitRuntimeTask(runStore, {
        run_id: `app-xhs-write-precheck-${mode}`,
        task_intent: { ...taskIntent(), intent_id: `intent_write_precheck_${mode}` },
        package_ref: contract().package_ref,
        authorization_context: context,
        harbor: { identity_environment_ref: "harbor://identity-environment/xhs-policy" }
      }, {
        lodePackageResolver: async () => contract(),
        harborRuntimeClient: harbor,
        executionPolicyConfigStore: configStore(mode),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(result.ok, mode === "auto");
      if (expectedCode) {
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.failure.code, expectedCode);
      }
      assert.equal(result.run_record?.status, expectedStatus);
      assert.equal(result.run_record?.authorization_decision_refs?.length, 1);
      const policySnapshot = result.run_record?.policy_binding_snapshot;
      assert.ok(policySnapshot);
      assert.equal(policySnapshot.schema_version, "webenvoy.policy-binding-snapshot.v0");
      assert.match(policySnapshot.decision_ref, /^authorization-decision:/);
      assert.equal(policySnapshot.effective_policy_source, "global_user_config");
      assert.ok(policySnapshot.effective_policy_source_ref.length > 0);
      assert.ok(policySnapshot.effective_policy_source_version.length > 0);
      assert.match(policySnapshot.action_fingerprint, /^sha256:[a-f0-9]{64}$/);
      assert.equal(policySnapshot.resource_match_ref.length > 0, true);
      assert.equal(policySnapshot.resource_match_version.length > 0, true);
      assert.equal(policySnapshot.expires_at, evaluatedAt.replace("08:00:00", "08:10:00"));
      assert.equal(collectCalls, mode === "auto" ? 1 : 0);
      assert.equal(validateCalls, mode === "auto" ? 1 : 0);
      assert.equal(releaseCalls, mode === "auto" ? 1 : 0);
      if (mode === "auto") {
        assert(legacyRequestBody);
        assert.deepEqual(Object.keys(legacyRequestBody).sort(), ["holder_ref", "include_source_refs", "proposed_input_summary", "requested_fields", "runtime_session_ref", "target_ref", "url"]);
        assert.deepEqual(legacyRequestBody.requested_fields, ["title", "summary", "canonical_url", "source_status"]);
        assert.equal(legacyRequestBody.include_source_refs, true);
        assert.equal(legacyRequestBody.proposed_input_summary, "仅验证，不提交");
        assert.equal(legacyRequestBody.requested_path, undefined);
        assert.equal(result.run_record?.public_result_summary && (result.run_record.public_result_summary as Record<string, unknown>).submitted, false);
        const summary = result.run_record?.public_result_summary as Record<string, unknown> | undefined;
        assert.equal(summary?.composition_path, "image_text_upload");
        assert.deepEqual(summary?.media_state, { availability: "unknown", observation: "unknown", controls: {} });
        assert.deepEqual(summary?.validation_state, { availability: "unknown", observation: "unknown" });
        assert.deepEqual(summary?.save_draft_control, { availability: "unknown", observation: "unknown" });
        assert.deepEqual(summary?.publish_control, { availability: "unavailable", observation: "not_observed" });
        assert.equal(result.run_record?.preview_result?.submitted, false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  const malformedObservationDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-observation-shape-"));
  try {
    let currentRunId = "";
    let mutateOperation: ((operation: Record<string, unknown>) => void) | undefined;
    let requestedCompositionPath: "image_text_upload" | "video" | undefined;
    const runStore = createFileRunRecordStore({ directory: join(malformedObservationDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(malformedObservationDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: currentRunId }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    const harbor = {
      collectAdmissionFacts: async () => runtimeBindingFacts(`session_${currentRunId}`),
      validateOnlyWritePrecheck: async (input: { runtime_session_ref: string; target_ref: string }) => {
        const operation = completedWritePrecheckOperation({
          runtime_session_ref: input.runtime_session_ref,
          target_ref: input.target_ref,
          suffix: currentRunId
        });
        mutateOperation?.(operation);
        return operation;
      },
      executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
      releaseCoreTaskSession: async () => undefined
    } as HarborRuntimeClient;
    const malformedCases: readonly [
      string,
      ((operation: Record<string, unknown>) => void),
      "image_text_upload" | "video" | undefined
    ][] = [
      ["path-mismatch", () => undefined, "video"],
      ["identity-unconfirmed", (operation) => {
        (operation.entrypoint_observations as Record<string, unknown>).user_confirmed_identity = false;
      }, undefined],
      ["challenge-present", (operation) => {
        (operation.entrypoint_observations as Record<string, unknown>).challenge_absent = false;
      }, undefined],
      ["composition-scope-unknown-path", (operation) => {
        operation.precheck_scope = "composition_observation";
        const observations = operation.entrypoint_observations as Record<string, unknown>;
        observations.path_observed = "unknown";
        observations.path_entry_visible = "unknown";
      }, undefined],
      ["field-inner-extra", (operation) => {
        const fields = operation.field_states as Record<string, Record<string, unknown>>;
        fields.title_input = { ...fields.title_input, detail: "unexpected" };
      }, undefined],
      ["media-extra", (operation) => {
        (operation.media_state as Record<string, unknown>).detail = "unexpected";
      }, undefined]
    ];
    for (const [name, mutation, compositionPath] of malformedCases) {
      currentRunId = `app-xhs-write-precheck-${name}`;
      mutateOperation = mutation;
      requestedCompositionPath = compositionPath;
      const result = await submitRuntimeTask(runStore, {
        run_id: currentRunId,
        task_intent: { ...taskIntent(), intent_id: `intent_write_precheck_${name}` },
        package_ref: contract().package_ref,
        authorization_context: { ...context, idempotency_key: `turn-policy-check-${name}` },
        ...(requestedCompositionPath === undefined ? {} : { harbor: { composition_path: requestedCompositionPath } })
      }, {
        lodePackageResolver: async () => contract(),
        harborRuntimeClient: harbor,
        executionPolicyConfigStore: configStore("auto"),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(result.ok, false, name);
      if (!result.ok) assert.equal(result.failure.code, "harbor_write_precheck_outcome_unknown", name);
      assert.equal(result.run_record?.status, "unknown_outcome", name);
      assert.equal(result.run_record?.public_result_summary?.submitted, false, name);
    }
  } finally {
    await rm(malformedObservationDirectory, { recursive: true, force: true });
  }

  const missingSnapshotDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-continuation-binding-"));
  try {
    const baseRunStore = createFileRunRecordStore({ directory: join(missingSnapshotDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(missingSnapshotDirectory, "decisions"),
      runRecordStore: baseRunStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-missing-snapshot" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    const waiting = await submitRuntimeTask(baseRunStore, {
      run_id: "app-xhs-write-precheck-missing-snapshot",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_missing_snapshot" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      executionPolicyConfigStore: configStore("confirm"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(waiting.ok, false);
    const confirmationRef = waiting.run_record?.authorization_decision_refs?.[0];
    assert(confirmationRef);
    const confirmationEvaluation = await evaluate("confirm");
    const decision = { ...singleActionDecision(confirmationEvaluation), confirmation_decision_ref: confirmationRef };
    let harborCalls = 0;
    const runStore = {
      ...baseRunStore,
      getRunRecord: async (runId: string) => {
        const record = await baseRunStore.getRunRecord(runId);
        if (!record) return record;
        const { policy_binding_snapshot: _snapshot, ...withoutSnapshot } = record;
        return withoutSnapshot;
      }
    };
    const continued = await continueWritePrecheckTask(runStore, {
      run_id: "app-xhs-write-precheck-missing-snapshot",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_missing_snapshot" },
      package_ref: contract().package_ref,
      authorization_context: context,
      single_action_decision: decision
    }, {
      harborRuntimeClient: {
        collectAdmissionFacts: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        validateOnlyWritePrecheck: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        executeReadOperation: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        releaseCoreTaskSession: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); }
      } as HarborRuntimeClient
    });
    assert.equal(continued.ok, false);
    if (!continued.ok) assert.equal(continued.failure.code, "single_action_confirmation_binding_mismatch");
    assert.equal(harborCalls, 0);
    assert.equal((await baseRunStore.getRunRecord("app-xhs-write-precheck-missing-snapshot"))?.status, "requires_user_action");
  } finally {
    await rm(missingSnapshotDirectory, { recursive: true, force: true });
  }

  const missingClientDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-missing-client-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(missingClientDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(missingClientDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-missing-client" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-missing-client",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_missing_client" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.category, "resource_admission");
      assert.equal(result.failure.code, "harbor_runtime_api_unconfigured");
    }
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(result.run_record?.preview_result?.submitted, false);
  } finally {
    await rm(missingClientDirectory, { recursive: true, force: true });
  }

  const collectionFailureDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-collection-failure-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(collectionFailureDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(collectionFailureDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-collection-failure" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-collection-failure",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_collection_failure" },
      package_ref: contract().package_ref,
      authorization_context: context,
      harbor: { identity_environment_ref: "harbor://identity-environment/xhs-policy" }
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => ({
          kind: "harbor_admission_collection_failure",
          runtime_session_ref: "session_collection_failure",
          failure: {
            category: "resource_admission",
            code: "harbor_runtime_admission_failed",
            phase: "runtime_binding",
            recovery_hint: "connect_runtime"
          },
          cleanup_failure: {
            category: "runtime_execution",
            code: "core_task_session_cleanup_failed",
            phase: "runtime_binding",
            recovery_hint: "inspect_runtime_session"
          }
        }) as unknown as HarborAdmissionInput,
        validateOnlyWritePrecheck: async () => {
          validateCalls += 1;
          throw new Error("collection failure must stop before operation");
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => {
          releaseCalls += 1;
          return undefined;
        }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.category, "resource_admission");
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.failure?.code, "harbor_runtime_admission_failed");
    assert.deepEqual(result.run_record?.runtime_binding_refs, ["session_collection_failure"]);
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(result.run_record?.preview_result?.submitted, false);
    assert.equal(result.run_record?.post_check?.code, "core_task_session_cleanup_failed");
    assert.deepEqual(result.run_record?.post_check?.source_refs, ["session_collection_failure"]);
    assert.equal(validateCalls, 0);
    assert.equal(releaseCalls, 0, "collection cleanup failure is already recorded; do not retry cleanup");
  } finally {
    await rm(collectionFailureDirectory, { recursive: true, force: true });
  }

  const unavailableDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-unavailable-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(unavailableDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(unavailableDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-unavailable" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let operationCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-unavailable",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_unavailable" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => runtimeBindingFacts("session_unavailable"),
        validateOnlyWritePrecheck: async () => {
          operationCalls += 1;
          return {
            schema_version: "harbor-validate-only-write-precheck/v0",
            status: "unavailable",
            submitted: false,
            failure_class: "browser_provider_unavailable",
            retryable: false
          };
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => undefined
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "write_precheck_browser_provider_unavailable");
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.preview_result?.submitted, false);
    assert.equal(operationCalls, 1);
  } finally {
    await rm(unavailableDirectory, { recursive: true, force: true });
  }

  const incompleteEvidenceDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-incomplete-evidence-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(incompleteEvidenceDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(incompleteEvidenceDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-incomplete-evidence" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-incomplete-evidence",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_incomplete_evidence" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => runtimeBindingFacts("session_incomplete_evidence"),
        validateOnlyWritePrecheck: async (input: { runtime_session_ref: string; target_ref: string }) => {
          const completed = completedWritePrecheckOperation({ runtime_session_ref: input.runtime_session_ref, target_ref: input.target_ref, suffix: "incomplete" });
          completed.evidence_ref_kinds = [{ kind: "post_check_ref", ref: "postcheck_incomplete" }];
          return completed;
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "harbor_write_precheck_outcome_unknown");
    assert.equal(result.run_record?.status, "unknown_outcome");
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(releaseCalls, 1);
  } finally {
    await rm(incompleteEvidenceDirectory, { recursive: true, force: true });
  }

  const persistenceDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-unknown-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(persistenceDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    let collectCalls = 0;
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-unknown",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_unknown" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => {
          collectCalls += 1;
          return runtimeBindingFacts("session_unknown");
        },
        validateOnlyWritePrecheck: async () => {
          validateCalls += 1;
          // A syntactically JSON but incomplete response is still unknown.
          return { schema_version: "harbor-validate-only-write-precheck/v0", status: "completed", submitted: false };
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: {
        recordAuthorizationDecision: async () => { throw new Error("outcome_unknown"); }
      } as unknown as FileAuthorizationDecisionStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, "authorization_decision_persistence_failed");
    assert.equal(result.run_record?.post_check?.code, "authorization_decision_persistence_failed");
    assert.equal(collectCalls, 0);
    assert.equal(validateCalls, 0);
    assert.equal(releaseCalls, 0);
  } finally {
    await rm(persistenceDirectory, { recursive: true, force: true });
  }

  const unknownDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-transport-unknown-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(unknownDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(unknownDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-transport-unknown" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let collectCalls = 0;
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-transport-unknown",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_transport_unknown" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => {
          collectCalls += 1;
          return runtimeBindingFacts("session_transport_unknown");
        },
        validateOnlyWritePrecheck: async () => {
          validateCalls += 1;
          throw new Error("transport timeout");
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; throw new Error("cleanup transport failure"); }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "harbor_write_precheck_outcome_unknown");
    assert.equal(result.run_record?.status, "unknown_outcome");
    assert.equal(collectCalls, 1);
    assert.equal(validateCalls, 1);
    assert.equal(releaseCalls, 1);
    assert.equal(result.run_record?.preview_result?.submitted, false);
    assert.equal(result.run_record?.post_check?.code, "core_task_session_cleanup_unverified");
    assert.deepEqual(result.run_record?.post_check?.source_refs, ["session_transport_unknown"]);
  } finally {
    await rm(unknownDirectory, { recursive: true, force: true });
  }

  await assertXhsMediaActionP1Wiring();
}

async function assertXhsMediaActionP1Wiring(): Promise<void> {
  const mediaPackage = mediaContract();
  const mediaIntent = mediaTaskIntent();

  // Initial submission always creates a user-action checkpoint, even when
  // the global policy says auto. Harbor must not receive a dispatch before
  // the persisted single-action decision is supplied to continuation.
  const autoDirectory = await mkdtemp(join(tmpdir(), "webenvoy-xhs-media-auto-confirm-"));
  try {
    let harborCalls = 0;
    const runStore = createFileRunRecordStore({ directory: join(autoDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(autoDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-media-auto-confirm" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-media-auto-confirm",
      task_intent: mediaIntent,
      package_ref: mediaPackage.package_ref,
      authorization_context: { ...context, idempotency_key: "xhs-media-auto-confirm" }
    }, {
      lodePackageResolver: async () => mediaPackage,
      harborRuntimeClient: {
        collectAdmissionFacts: async () => { harborCalls += 1; throw new Error("auto media action must wait for confirmation"); },
        executeMediaAction: async () => { harborCalls += 1; throw new Error("auto media action must wait for confirmation"); },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        validateOnlyWritePrecheck: async () => { throw new Error("unexpected write-precheck dispatch"); },
        releaseCoreTaskSession: async () => undefined
      } as HarborRuntimeClient,
      executionPolicyConfigStore: mediaConfigStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "authorization_confirmation_required");
    assert.equal(result.run_record?.status, "requires_user_action");
    assert.equal(result.run_record?.action_request?.action_id, mediaIntent.input.action_id);
    assert.deepEqual(result.run_record?.action_request?.target_refs, { scope_target_ref: mediaIntent.scope.target_ref });
    assert.equal(harborCalls, 0);
  } finally {
    await rm(autoDirectory, { recursive: true, force: true });
  }

  for (const testCase of [
    { name: "fixture", producer: "fixture" as const, operation_status: "terminal" as const, expectedStatus: "failed" as const },
    { name: "accepted", producer: "harbor" as const, operation_status: "accepted" as const, expectedStatus: "unknown_outcome" as const },
    { name: "running", producer: "harbor" as const, operation_status: "running" as const, expectedStatus: "unknown_outcome" as const }
  ]) {
    const directory = await mkdtemp(join(tmpdir(), `webenvoy-xhs-media-${testCase.name}-`));
    try {
      const runId = `app-xhs-media-${testCase.name}`;
      let harborCalls = 0;
      let releaseCalls = 0;
      const runStore = createFileRunRecordStore({ directory: join(directory, "runs"), clock: () => new Date(evaluatedAt) });
      const authorizationStore = createFileAuthorizationDecisionStore({
        directory: join(directory, "decisions"),
        runRecordStore: runStore,
        taskThreadStore: {
          getTaskThread: async () => ({
            thread_id: context.thread_id,
            turns: [{ turn_id: context.turn_id, run_id: runId }]
          })
        },
        clock: () => new Date(evaluatedAt)
      });
      const authorizationContext = { ...context, idempotency_key: `xhs-media-${testCase.name}` };
      const initial = await submitRuntimeTask(runStore, {
        run_id: runId,
        task_intent: { ...mediaIntent, intent_id: `${mediaIntent.intent_id}_${testCase.name}` },
        package_ref: mediaPackage.package_ref,
        authorization_context: authorizationContext
      }, {
        lodePackageResolver: async () => mediaPackage,
        executionPolicyConfigStore: mediaConfigStore("auto"),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(initial.ok, false, testCase.name);
      assert.equal(initial.run_record?.status, "requires_user_action", testCase.name);
      const confirmationRef = initial.run_record?.authorization_decision_refs?.[0];
      assert(confirmationRef, testCase.name);
      const confirmation = await authorizationStore.getAuthorizationDecision(confirmationRef);
      assert(confirmation, testCase.name);
      const singleActionDecision = mediaDecisionFromConfirmation(confirmation);
      const runtimeSessionRef = `session_xhs_media_${testCase.name}`;
      const harbor = {
        collectAdmissionFacts: async () => runtimeBindingFacts(runtimeSessionRef),
        executeMediaAction: async (input: Parameters<NonNullable<HarborRuntimeClient["executeMediaAction"]>>[0]) => {
          harborCalls += 1;
          assert.equal(input.authorization_binding.action_id, input.action_id, testCase.name);
          assert.equal(input.authorization_binding.target_ref, input.target_ref, testCase.name);
          assert.equal(input.authorization_binding.idempotency_key, authorizationContext.idempotency_key, testCase.name);
          return mediaOutput({
            action_id: input.action_id,
            requested_path: input.requested_path,
            canonical_url: input.url,
            target_ref: input.target_ref,
            runtime_session_ref: runtimeSessionRef,
            suffix: testCase.name,
            producer: testCase.producer,
            operation_status: testCase.operation_status
          });
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        validateOnlyWritePrecheck: async () => { throw new Error("unexpected write-precheck dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      } as HarborRuntimeClient;
      const continued = await continueXhsMediaActionTask(runStore, {
        run_id: runId,
        task_intent: { ...mediaIntent, intent_id: `${mediaIntent.intent_id}_${testCase.name}` },
        package_ref: mediaPackage.package_ref,
        authorization_context: authorizationContext,
        single_action_decision: singleActionDecision
      }, {
        lodePackageResolver: async () => mediaPackage,
        harborRuntimeClient: harbor,
        // The persisted confirmation records the source as confirm; the
        // continuation consumes it against that same source before dispatch.
        executionPolicyConfigStore: mediaConfigStore("confirm"),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(harborCalls, 1, testCase.name);
      assert.equal(releaseCalls, 1, testCase.name);
      assert.equal(continued.ok, false, testCase.name);
      assert.equal(continued.run_record?.status, testCase.expectedStatus, testCase.name);
      if (!continued.ok && testCase.name === "fixture") {
        assert.equal(continued.failure.code, "harbor_xhs_media_output_invalid");
      }
      if (!continued.ok && testCase.expectedStatus === "unknown_outcome") {
        assert.equal(continued.failure.code, "harbor_xhs_media_operation_unknown", testCase.name);
        assert.equal(continued.run_record?.post_check?.recovery_hint, "reconcile_status", testCase.name);
        assert.equal(continued.run_record?.public_result_summary?.submitted, false, testCase.name);
        const normalized = continued.run_record?.public_result_summary?.normalized as Record<string, unknown> | undefined;
        const operation = normalized?.operation as Record<string, unknown> | undefined;
        assert.equal(operation?.status, testCase.operation_status, testCase.name);
        assert.equal(operation?.operation_ref, `operation_media_${testCase.name}`, testCase.name);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
