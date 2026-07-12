import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, type ApprovalRequest, type RunRecord } from "./run-record-store.js";
import type { HarborBrowserProviderCatalog, HarborCoreRuntimeFacts, HarborIdentityEnvironmentFacts, HarborResourceFacts, HarborWritePrecheckFacts } from "./harbor-admission.js";
import type { LodePackageAdmissionContract } from "./lode-admission.js";
import { getApprovalCancellationSummary } from "./run-query.js";
import { getRunFailureReason, getRunResult } from "./result-query.js";
import { recordRealSiteWritePreviewResult, type RealSiteWritePreviewInput } from "./real-site-write-preview.js";

type SiteConfig = {
  site: "xiaohongshu" | "boss";
  origin: string;
  run_id: string;
  intent_id: string;
  capability_ref: string;
  capability_id: string;
  source_ref: string;
  lock_ref: string;
  package_ref: string;
  resource_ref: string;
  execution_intent: "draft" | "preview";
  target_ref: string;
  target_url: string;
  result_ref: string;
  change_kind: string;
};

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 7, 3, 10, tick));
  tick += 1;
  return instant;
}

const providerStatus = {
  schema_version: "harbor-browser-provider-status/v0",
  providers: [
    {
      provider_id: "cloakbrowser",
      install: {
        status: "installed",
        launchability: "launchable"
      }
    }
  ]
} satisfies HarborBrowserProviderCatalog;

function config(site: SiteConfig["site"], suffix = ""): SiteConfig {
  if (site === "xiaohongshu") {
    return {
      site,
      origin: "https://www.xiaohongshu.com",
      run_id: `run_self_check_xhs_write_preview${suffix}`,
      intent_id: `intent_real_site_xiaohongshu_draft_preview${suffix}`,
      capability_ref: "lode:capability/xiaohongshu-draft-precheck",
      capability_id: "xiaohongshu-draft-precheck",
      source_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      lock_ref: "lode://lock/site-capability/xiaohongshu/draft-precheck@0.1.0",
      package_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      resource_ref: "xiaohongshu.draft-precheck.resources",
      execution_intent: "draft",
      target_ref: "harbor:writable-target/xiaohongshu/draft-editor",
      target_url: "https://www.xiaohongshu.com/publish",
      result_ref: `result:core/xiaohongshu/draft-precheck/self-check${suffix}`,
      change_kind: "xiaohongshu_draft_preview"
    };
  }
  return {
    site,
    origin: "https://www.zhipin.com",
    run_id: `run_self_check_boss_write_preview${suffix}`,
    intent_id: `intent_real_site_boss_greeting_preview${suffix}`,
    capability_ref: "lode:capability/boss-greeting-precheck",
    capability_id: "boss-greeting-precheck",
    source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    lock_ref: "lode://lock/site-capability/boss/greeting-precheck@0.1.0",
    package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    resource_ref: "boss.greeting-precheck.resources",
    execution_intent: "preview",
    target_ref: "harbor:writable-target/boss/greeting-box",
    target_url: "https://www.zhipin.com/web/geek/job",
    result_ref: `result:core/boss/greeting-precheck/self-check${suffix}`,
    change_kind: "boss_greeting_preview"
  };
}

function taskIntent(value: SiteConfig): Record<string, unknown> {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: value.intent_id,
    entrypoint: "api",
    user_intent: {
      summary: `${value.site} write precheck preview`
    },
    capability: {
      ref: value.capability_ref,
      version: "0.1.0",
      source_ref: value.source_ref,
      lock_ref: value.lock_ref
    },
    input: {
      summary: `${value.site} validate-only page write preview`,
      refs: [`input:${value.site}/redacted-business-fields`]
    },
    scope: {
      target_type: "page",
      target_ref: value.target_url
    },
    policy: {
      risk: "write",
      execution_intent: value.execution_intent
    },
    resource_requirement_refs: [value.resource_ref],
    evidence_policy_ref: `evidence-policy:${value.site}/refs-only`
  };
}

function lodeContract(value: SiteConfig): LodePackageAdmissionContract {
  const originFact = value.site === "xiaohongshu" ? "runtime.origin.www_xiaohongshu_com.available" : "runtime.origin.www_zhipin_com.available";
  return {
    package_ref: value.package_ref,
    source_ref: value.source_ref,
    lock_ref: value.lock_ref,
    capability_id: value.capability_id,
    operation_id: value.change_kind,
    operation_mode: value.execution_intent,
    version: "0.1.0",
    lifecycle: "active",
    runtime_admission: {
      enabled: true,
      status: "current",
      recheck_condition: "not_applicable"
    },
    resource_requirements: {
      schema_version: "lode.resource-requirements.v0",
      resource_requirements_id: value.resource_ref,
      resource_requirements_version: "0.1.0",
      package_ref: value.package_ref,
      operation_mode: value.execution_intent,
      resource_requirement_profiles: [
        {
          requirement_profile_id: `${value.site}-write-precheck-with-runtime-refs`,
          operation_boundary: value.execution_intent,
          required_harbor_facts: [
            { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: originFact, owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: "identity.user_logged_in.confirmed", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: "snapshot.document_summary.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: "refmap.source_refs.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true, freshness: "current_execution_window" }
          ]
        }
      ]
    }
  };
}

function identityFacts(value: SiteConfig): HarborIdentityEnvironmentFacts {
  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref: `harbor:identity-env/${value.site}/write-precheck`,
    execution_identity_ref: `harbor:execution-identity/${value.site}/write-precheck`,
    profile_ref: `harbor:profile/${value.site}/write-precheck`,
    site_binding: {
      site_id: value.site,
      origin: value.origin
    },
    login_state: {
      state: "logged_in",
      recovery_required: false
    },
    browser_storage: {
      state: "present"
    },
    provider_binding: {
      selected_provider_id: "cloakbrowser",
      binding_status: "default_provider_available"
    },
    consumer_boundary: {
      core: "admission_facts_refs_and_blocking_reasons_only",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
    }
  };
}

function runtimeFacts(value: SiteConfig): HarborCoreRuntimeFacts {
  return {
    schema_version: "harbor-core-runtime-facts/v0",
    runtime_session_ref: `harbor:runtime-session/${value.site}/write-precheck`,
    identity_environment_ref: `harbor:identity-env/${value.site}/write-precheck`,
    execution_identity_ref: `harbor:execution-identity/${value.site}/write-precheck`,
    profile_ref: `harbor:profile/${value.site}/write-precheck`,
    provider_ref: "harbor:provider/cloakbrowser",
    provider_mode: "local_dedicated_profile",
    lifecycle_state: "active",
    availability: {
      cdp: "available",
      viewer: "available",
      snapshot: "available",
      evidence: "available"
    },
    viewer: {
      viewer_ref: `harbor:viewer/${value.site}/write-precheck`,
      availability: "available",
      access_mode: "local",
      expires_at: "2026-07-07T04:10:00.000Z"
    },
    control: {
      owner: "core_task",
      handoff_reason: null,
      takeover: {
        available: true
      },
      updated_at: "2026-07-07T03:10:00.000Z"
    },
    current_error: null,
    fact_refs: {
      session: `harbor:runtime-session/${value.site}/write-precheck`,
      viewer: `harbor:viewer/${value.site}/write-precheck`
    },
    unavailable: null
  };
}

function writePrecheckFacts(value: SiteConfig): HarborWritePrecheckFacts {
  return {
    schema_version: "harbor-write-precheck-facts/v0",
    runtime_session_ref: `harbor:runtime-session/${value.site}/write-precheck`,
    provider_ref: "harbor:provider/cloakbrowser",
    profile_ref: `harbor:profile/${value.site}/write-precheck`,
    writable_target: {
      target_ref: value.target_ref,
      runtime_session_ref: `harbor:runtime-session/${value.site}/write-precheck`,
      snapshot_ref: `harbor:snapshot/${value.site}/write-precheck`,
      refmap_ref: `harbor:refmap/${value.site}/write-precheck`,
      evidence_refs: [`harbor:evidence/${value.site}/write-precheck/precheck`]
    },
    form_state: {
      snapshot_ref: `harbor:snapshot/${value.site}/write-precheck`,
      fields: [
        {
          field_ref: `harbor:field/${value.site}/write-precheck/primary`,
          target_ref: value.target_ref,
          input_kind: "text",
          required: true,
          sensitivity: "public",
          export_policy: "safe_summary",
          value_state: "redacted_present"
        }
      ],
      state_summary: "Writable fields are present; raw values are not exported."
    },
    pre_write_guard: {
      status: "active",
      no_submit_guard: "active",
      blocked_events: ["submit", "publish", "send"],
      enforcement: "facts_only_no_real_submit",
      runtime_ready: true,
      blocking_reasons: []
    },
    privacy_boundary: {
      raw_values: "not_exposed",
      credential_profile_storage: "not_exposed",
      page_network_capture: "not_exposed",
      export_boundary: "refs_and_redacted_field_state_only"
    },
    unavailable: null
  };
}

function resourceFacts(): HarborResourceFacts {
  return {
    schema_version: "harbor-core-resource-facts/v0",
    resource_facts: [],
    consumer_boundary: "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material."
  };
}

function approvalRequest(value: SiteConfig, status: ApprovalRequest["status"] = "pending"): ApprovalRequest {
  return {
    schema_version: "webenvoy.approval-request.v0",
    approval_request_id: `approval-request:${value.site}/write-precheck${status === "pending" ? "" : `-${status}`}`,
    action_request_id: `action-request:${value.intent_id}`,
    task_intent_ref: value.intent_id,
    status,
    requested_at: "2026-07-07T03:10:01.000Z",
    expires_at: status === "expired" ? "2026-07-07T03:10:02.000Z" : "2026-07-07T03:20:01.000Z",
    risk: "write",
    blocking_reasons: status === "expired" ? ["approval_required_before_submit", "approval_window_expired"] : ["approval_required_before_submit"],
    source_refs: [value.source_ref],
    evidence_refs: [`harbor:evidence/${value.site}/write-precheck/precheck`],
    consumer_boundary: status === "expired" ? "Core stores approval expiry and refs only; this is not approval execution or submitted result evidence." : "Core stores approval state and refs only; this is not approval execution or submitted result evidence."
  };
}

function previewInput(value: SiteConfig, overrides: Partial<RealSiteWritePreviewInput> = {}): RealSiteWritePreviewInput {
  return {
    run_id: value.run_id,
    task_intent: taskIntent(value),
    package_ref: value.package_ref,
    lode_package_contract: lodeContract(value),
    resource_match_ref: `resource-match:${value.site}/write-precheck`,
    harbor_identity_environment_facts: identityFacts(value),
    harbor_provider_status: providerStatus,
    harbor_runtime_facts: runtimeFacts(value),
    harbor_write_precheck_facts: writePrecheckFacts(value),
    harbor_resource_facts: resourceFacts(),
    result_ref: value.result_ref,
    expected_change: {
      change_kind: value.change_kind,
      target_ref: value.target_ref,
      external_submit: false
    },
    approval_request: approvalRequest(value),
    evidence_refs: [`harbor:evidence/${value.site}/write-precheck/precheck`],
    retention_state: "active",
    ...overrides
  };
}

function assertNoSubmit(record: RunRecord): void {
  assert.equal(record.action_request?.risk_classification.true_write_requested, false);
  assert.equal(record.action_request?.no_submit_guard.status, "active");
  const forbiddenKeys = new Set(["submitted_result", "cookie", "cookies", "token", "tokens", "raw_evidence_body", "full_dom", "network_response_body"]);
  const stack: unknown[] = [record];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `${record.run_id} must not contain ${key}`);
      stack.push(entry);
    }
  }
}

async function assertPreviewAvailable(input: RealSiteWritePreviewInput, expectedOperationMode: "draft" | "preview", expectedChangeKind: string): Promise<RunRecord> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-real-site-write-preview-one-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const result = await recordRealSiteWritePreviewResult(store, input);
    if (!result.ok) throw new Error(result.failure.code);
    assert.equal(result.ok, true);
    assert.equal(result.run_record.status, "succeeded");
    assert.equal(result.run_record.action_request?.operation_mode, expectedOperationMode);
    assert.equal(result.run_record.preview_result?.state, "available");
    assert.equal(result.run_record.preview_result?.submitted, false);
    assert.equal(result.run_record.preview_result?.expected_change?.change_kind, expectedChangeKind);
    assert.equal(result.run_record.preview_result?.expected_change?.external_submit, false);
    assertNoSubmit(result.run_record);
    const query = await getRunResult(store, result.run_record.run_id);
    if (!query.ok) throw new Error(query.failure.code);
    assert.equal(query.result.result.result_envelope?.preview_result?.submitted, false);
    return result.run_record;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function assertRealSiteWritePreviewResults(): Promise<void> {
  await assertPreviewAvailable(previewInput(config("xiaohongshu")), "draft", "xiaohongshu_draft_preview");
  await assertPreviewAvailable(previewInput(config("boss")), "preview", "boss_greeting_preview");

  const directory = await mkdtemp(join(tmpdir(), "webenvoy-real-site-write-preview-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });

    const pageChanged = await recordRealSiteWritePreviewResult(
      store,
      previewInput(config("xiaohongshu", "_page_changed"), {
        result_ref: "result:core/xiaohongshu/draft-precheck/page-changed",
        preview_state: "page_changed",
        approval_request: approvalRequest(config("xiaohongshu", "_page_changed")),
        evidence_refs: ["harbor:evidence/xiaohongshu/write-precheck/page-changed"]
      })
    );
    if (!pageChanged.ok) throw new Error(pageChanged.failure.code);
    assert.equal(pageChanged.ok, true);
    assert.equal(pageChanged.run_record.status, "failed");
    assert.equal(pageChanged.run_record.preview_result?.failure_class, "page_changed");
    const pageChangedFailure = await getRunFailureReason(store, pageChanged.run_record.run_id);
    if (!pageChangedFailure.ok) throw new Error(pageChangedFailure.failure.code);
    assert.equal(pageChangedFailure.failure_reason.reason_class, "page_changed");

    const cancelled = await recordRealSiteWritePreviewResult(
      store,
      previewInput(config("boss", "_cancelled"), {
        result_ref: "result:core/boss/greeting-precheck/cancelled",
        preview_state: "user_cancelled",
        approval_request: approvalRequest(config("boss", "_cancelled")),
        evidence_refs: ["harbor:evidence/boss/write-precheck/cancelled"]
      })
    );
    if (!cancelled.ok) throw new Error(cancelled.failure.code);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.run_record.status, "cancelled");
    assert.equal(cancelled.run_record.failure?.code, "user_cancelled");
    assertNoSubmit(cancelled.run_record);

    const expiredConfig = config("boss", "_expired");
    const expired = await recordRealSiteWritePreviewResult(
      store,
      previewInput(expiredConfig, {
        result_ref: "result:core/boss/greeting-precheck/expired",
        approval_request: approvalRequest(expiredConfig, "expired")
      })
    );
    if (!expired.ok) throw new Error(expired.failure.code);
    assert.equal(expired.ok, true);
    assert.equal(expired.run_record.status, "expired");
    assert.equal(expired.run_record.approval_request?.status, "expired");
    assertNoSubmit(expired.run_record);
    const expiredApproval = await getApprovalCancellationSummary(store, expired.run_record.action_request?.action_request_id ?? "");
    assert.equal(expiredApproval.latest_status, "expired");
    const expiredResult = await getRunResult(store, expired.run_record.run_id);
    if (!expiredResult.ok) throw new Error(expiredResult.failure.code);
    assert.equal(expiredResult.result.result.payload_state, "expired");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
