import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type HarborBrowserProviderCatalog, type HarborCoreRuntimeFacts, type HarborCoreSceneReference, type HarborIdentityEnvironmentFacts, type HarborResourceFacts } from "./harbor-admission.js";
import { type LodePackageAdmissionContract } from "./lode-admission.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";
import { createFileRunRecordStore, type FailureRecord, type FileRunRecordStore, type RunRecordStatus } from "./run-record-store.js";
import { getCapabilityRunSummary } from "./capability-query.js";
import { getRunSummary } from "./run-query.js";
import { getRunResult } from "./result-query.js";
import { acceptReadOnlyTaskSubmission, type TaskIntentEnvelope } from "./task-submission.js";

type ReadOnlySiteSpec = {
  site: "xiaohongshu" | "boss";
  origin: string;
  capabilityId: "search-notes" | "read-note-detail" | "job-search" | "read-job-detail";
  operationId: string;
  packageRef: string;
  lockRef: string;
  resourceRequirementRef: string;
  inputSummary: string;
  inputRefs: readonly string[];
  targetRef: string;
  resultKind: string;
  outputSchemaId: string;
  resultData: Record<string, unknown>;
  extraRequiredHarborFacts: readonly string[];
};

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 6, 10, 0, tick));
  tick += 1;
  return instant;
}

const siteSpecs: readonly ReadOnlySiteSpec[] = [
  {
    site: "xiaohongshu",
    origin: "https://www.xiaohongshu.com",
    capabilityId: "search-notes",
    operationId: "xhs_search_notes",
    packageRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    lockRef: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    resourceRequirementRef: "xiaohongshu.search-notes.resources",
    inputSummary: "Search Xiaohongshu notes for city coffee using a signed read-only page ref.",
    inputRefs: ["https://www.xiaohongshu.com/search_result/?keyword=city%20coffee", "input:fixture/xiaohongshu/search-notes"],
    targetRef: "site:xiaohongshu/search-notes",
    resultKind: "xiaohongshu.search_notes",
    outputSchemaId: "lode.xiaohongshu.search-notes.output.v0",
    resultData: {
      site: "xiaohongshu",
      task: "search_notes",
      query: "city coffee",
      count: 2,
      notes: [
        { note_ref: "xhs-note:fixture/city-coffee-1", title: "City coffee route", author_ref: "xhs-author:fixture/1", follow_up_ref: "input:fixture/xhs-note-detail-1" },
        { note_ref: "xhs-note:fixture/city-coffee-2", title: "Quiet cafe shortlist", author_ref: "xhs-author:fixture/2", follow_up_ref: "input:fixture/xhs-note-detail-2" }
      ]
    },
    extraRequiredHarborFacts: ["page.vue_app.ready", "page.pinia_store.ready", "safety.challenge.absent"]
  },
  {
    site: "xiaohongshu",
    origin: "https://www.xiaohongshu.com",
    capabilityId: "read-note-detail",
    operationId: "xhs_read_note_detail",
    packageRef: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
    lockRef: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
    resourceRequirementRef: "xiaohongshu.read-note-detail.resources",
    inputSummary: "Read a Xiaohongshu note detail from a persisted public note ref.",
    inputRefs: ["https://www.xiaohongshu.com/explore/fixture-note-1", "input:fixture/xiaohongshu/read-note-detail"],
    targetRef: "site:xiaohongshu/read-note-detail",
    resultKind: "xiaohongshu.note_detail",
    outputSchemaId: "lode.xiaohongshu.read-note-detail.output.v0",
    resultData: {
      site: "xiaohongshu",
      task: "read_note_detail",
      note_ref: "xhs-note:fixture/city-coffee-1",
      title: "City coffee route",
      author_ref: "xhs-author:fixture/1",
      content_summary: "Public note summary projected by Lode package.",
      tags: ["coffee", "city-walk"]
    },
    extraRequiredHarborFacts: ["page.vue_app.ready", "page.pinia_store.ready", "safety.challenge.absent", "input.signed_note_ref.available"]
  },
  {
    site: "boss",
    origin: "https://www.zhipin.com",
    capabilityId: "job-search",
    operationId: "boss_job_search",
    packageRef: "lode://site-capability/boss/job-search@0.1.0",
    lockRef: "lode://lock/site-capability/boss/job-search@0.1.0",
    resourceRequirementRef: "boss.job-search.resources",
    inputSummary: "Search BOSS job cards for AI agent roles using a logged-in job-seeker read session.",
    inputRefs: ["https://www.zhipin.com/web/geek/job?query=AI%20agent&city=101010100", "input:fixture/boss/job-search"],
    targetRef: "site:boss/job-search",
    resultKind: "boss.job_search",
    outputSchemaId: "lode.boss.job-search.output.v0",
    resultData: {
      site: "boss",
      task: "job_search",
      query: "AI agent",
      city_ref: "boss-city:101010100",
      count: 2,
      jobs: [
        { job_ref: "boss-job:fixture/ai-agent-1", title: "AI Agent Engineer", company_ref: "boss-company:fixture/1", detail_ref: "input:fixture/boss/job-detail-1" },
        { job_ref: "boss-job:fixture/ai-agent-2", title: "LLM Platform Engineer", company_ref: "boss-company:fixture/2", detail_ref: "input:fixture/boss/job-detail-2" }
      ]
    },
    extraRequiredHarborFacts: ["page.boss_spa.ready", "network.wapi_zpgeek.available", "safety.challenge.absent"]
  },
  {
    site: "boss",
    origin: "https://www.zhipin.com",
    capabilityId: "read-job-detail",
    operationId: "boss_read_job_detail",
    packageRef: "lode://site-capability/boss/read-job-detail@0.1.0",
    lockRef: "lode://lock/site-capability/boss/read-job-detail@0.1.0",
    resourceRequirementRef: "boss.read-job-detail.resources",
    inputSummary: "Read a BOSS job detail page using securityId and encryptJobId refs.",
    inputRefs: ["https://www.zhipin.com/job_detail/fixture-job-1.html", "input:fixture/boss/read-job-detail"],
    targetRef: "site:boss/read-job-detail",
    resultKind: "boss.job_detail",
    outputSchemaId: "lode.boss.read-job-detail.output.v0",
    resultData: {
      site: "boss",
      task: "read_job_detail",
      job_ref: "boss-job:fixture/ai-agent-1",
      title: "AI Agent Engineer",
      company_ref: "boss-company:fixture/1",
      recruiter_ref: "boss-recruiter:fixture/1",
      description_summary: "Public job detail summary projected by Lode package."
    },
    extraRequiredHarborFacts: ["page.boss_spa.ready", "network.wapi_zpgeek.available", "input.boss_security_id.available", "safety.challenge.absent"]
  }
];

const forbiddenKeys = ["raw_payload", "dom", "har", "screenshot", "video", "cookie", "cookies", "token", "tokens", "local_path", "profile_path", "runtime_session", "cdp_endpoint", "viewer_url"];

function assertPublicRefsOnly(value: unknown): void {
  const text = JSON.stringify(value);
  for (const key of forbiddenKeys) {
    assert.equal(text.includes(`"${key}"`), false, `${key} must not be stored`);
  }
}

function lodeContract(spec: ReadOnlySiteSpec): LodePackageAdmissionContract {
  return {
    package_ref: spec.packageRef,
    source_ref: spec.packageRef,
    lock_ref: spec.lockRef,
    capability_id: spec.capabilityId,
    operation_id: spec.operationId,
    operation_mode: "read",
    version: "0.1.0",
    lifecycle: "proposed",
    runtime_admission: {
      enabled: true,
      status: "current",
      recheck_condition: "not_applicable"
    },
    resource_requirements: {
      schema_version: "lode.resource-requirements.v0",
      resource_requirements_id: spec.resourceRequirementRef,
      resource_requirements_version: "0.1.0",
      package_ref: spec.packageRef,
      operation_mode: "read",
      resource_requirement_profiles: [
        {
          requirement_profile_id: `${spec.site}.${spec.capabilityId}.core-read`,
          operation_boundary: "read",
          required_harbor_facts: [
            { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: spec.site === "boss" ? "runtime.origin.www_zhipin_com.available" : "runtime.origin.www_xiaohongshu_com.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: spec.site === "boss" ? "identity.boss_geek_logged_in.confirmed" : "identity.user_logged_in.confirmed", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: "source.refs.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
            ...spec.extraRequiredHarborFacts.map((fact_key) => ({ fact_key, owner: "Harbor" as const, required: true, freshness: "current_execution_window" }))
          ]
        }
      ]
    }
  };
}

function harborProviderStatus(): HarborBrowserProviderCatalog {
  return {
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
  };
}

function harborResourceFacts(spec: ReadOnlySiteSpec): HarborResourceFacts {
  return {
    schema_version: "harbor-core-resource-facts/v0",
    resource_facts: spec.extraRequiredHarborFacts.map((fact_key) => ({
      fact_key,
      state: "available"
    })),
    consumer_boundary: "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material."
  };
}

function taskIntent(spec: ReadOnlySiteSpec, suffix: string): TaskIntentEnvelope {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: `intent_real_site_${spec.site}_${spec.capabilityId}_${suffix}`,
    entrypoint: "api",
    user_intent: { summary: spec.inputSummary },
    capability: {
      ref: `lode:capability/${spec.capabilityId}`,
      version: "0.1.0",
      source_ref: spec.packageRef,
      lock_ref: spec.lockRef
    },
    input: {
      summary: spec.inputSummary,
      refs: [...spec.inputRefs]
    },
    scope: {
      target_type: "real_site_readonly",
      target_ref: spec.targetRef
    },
    policy: {
      risk: "read",
      execution_intent: "read",
      timeout_ms: 30_000
    },
    resource_requirement_refs: [spec.resourceRequirementRef],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function harborIdentity(spec: ReadOnlySiteSpec): HarborIdentityEnvironmentFacts {
  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref: `harbor:identity-env/${spec.site}/readonly`,
    execution_identity_ref: `harbor:execution-identity/${spec.site}/readonly`,
    profile_ref: `harbor:profile/${spec.site}/readonly`,
    site_binding: {
      site_id: spec.site,
      origin: spec.origin
    },
    login_state: {
      state: "logged_in",
      authentication_provenance: "user_confirmed_managed_session",
      manual_authentication_state: "completed",
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

function harborRuntime(spec: ReadOnlySiteSpec, owner = "core_task"): HarborCoreRuntimeFacts {
  const takeover =
    owner === "user"
      ? { available: true }
      : {
          available: false,
          unavailable_reason: "viewer_unavailable"
        };
  return {
    schema_version: "harbor-core-runtime-facts/v0",
    runtime_session_ref: `harbor:runtime-session/${spec.site}/readonly`,
    identity_environment_ref: `harbor:identity-env/${spec.site}/readonly`,
    execution_identity_ref: `harbor:execution-identity/${spec.site}/readonly`,
    profile_ref: `harbor:profile/${spec.site}/readonly`,
    provider_ref: "harbor:provider/cloakbrowser",
    provider_mode: "local_dedicated_profile",
    lifecycle_state: "active",
    availability: {
      cdp: "available",
      viewer: "unsupported",
      snapshot: "available",
      evidence: "available"
    },
    viewer: {
      viewer_ref: `harbor:viewer/${spec.site}/readonly`,
      availability: "unsupported",
      access_mode: "none",
      expires_at: "2026-07-06T11:00:00.000Z"
    },
    control: {
      owner,
      handoff_reason: owner === "user" ? "user_takeover" : null,
      takeover,
      updated_at: "2026-07-06T10:00:00.000Z"
    },
    current_error: null,
    fact_refs: {
      session: `harbor:runtime-session/${spec.site}/readonly`,
      viewer: `harbor:viewer/${spec.site}/readonly`
    },
    unavailable: null
  };
}

function harborScene(spec: ReadOnlySiteSpec): HarborCoreSceneReference {
  return {
    schema_version: "harbor-page-scene-refs/v0",
    runtime_session_ref: `harbor:runtime-session/${spec.site}/readonly`,
    snapshot_ref: `harbor:snapshot/${spec.site}/${spec.capabilityId}`,
    refmap_ref: `harbor:refmap/${spec.site}/${spec.capabilityId}`,
    source_trace_ref: `harbor:source-trace/${spec.site}/${spec.capabilityId}`,
    evidence_refs: [`harbor:evidence/${spec.site}/${spec.capabilityId}/snapshot`, `harbor:evidence/${spec.site}/${spec.capabilityId}/source-trace`],
    captured_at: "2026-07-06T10:00:00.000Z",
    page_summary: {
      title: `${spec.site} ${spec.capabilityId} fixture page`,
      url: spec.inputRefs[0] ?? spec.origin,
      summary: "Public page summary ref captured by Harbor; Core stores refs only."
    },
    unavailable: null
  };
}

async function admitRun(store: FileRunRecordStore, spec: ReadOnlySiteSpec, suffix: string, owner = "core_task") {
  const admitted = await acceptReadOnlyTaskSubmission(store, {
    run_id: `run_real_site_${spec.site}_${spec.capabilityId}_${suffix}`,
    task_intent: taskIntent(spec, suffix),
    package_ref: spec.packageRef,
    lode_package_contract: lodeContract(spec),
    resource_match_ref: `resource-match:${spec.site}/${spec.capabilityId}/readonly`,
    harbor_identity_environment_facts: harborIdentity(spec),
    harbor_provider_status: harborProviderStatus(),
    harbor_runtime_facts: harborRuntime(spec, owner),
    harbor_scene_ref: harborScene(spec),
    harbor_resource_facts: harborResourceFacts(spec)
  });
  if (!admitted.ok) {
    throw new Error(`real-site run must admit: ${admitted.failure.code}`);
  }
  assert.equal(admitted.ok, true);
  assert.equal(admitted.run_record.capability_version, "0.1.0");
  assert.equal(admitted.run_record.capability_source_ref, spec.packageRef);
  assert.equal(admitted.run_record.capability_lock_ref, spec.lockRef);
  assert.equal(admitted.run_record.package_ref, spec.packageRef);
  assert.equal(admitted.run_record.admission.resource_requirement_refs?.[0], spec.resourceRequirementRef);
  assert.equal(admitted.run_record.admission.runtime_session_binding?.core_task_run, true);
  assert.equal(admitted.run_record.admission.runtime_session_binding?.identity_environment_ref, `harbor:identity-env/${spec.site}/readonly`);
  assertPublicRefsOnly(admitted.run_record);
  return admitted.run_record;
}

function requireEvidenceRefs(refs: readonly string[] | undefined): string[] {
  assert(refs?.length, "real-site run must carry evidence refs");
  return [...refs];
}

async function completeSuccessfulRead(store: FileRunRecordStore, spec: ReadOnlySiteSpec): Promise<void> {
  const record = await admitRun(store, spec, "success");
  const evidenceRefs = requireEvidenceRefs(record.evidence_refs);
  await store.updateRunRecord(record.run_id, { status: "running", evidence_refs: evidenceRefs });
  const completed = await completeRunWithResult(store, record.run_id, {
    result_ref: `result:core/${spec.site}/${spec.capabilityId}/fixture`,
    result_kind: spec.resultKind,
    output_schema_id: spec.outputSchemaId,
    data: spec.resultData,
    projection_ref: `projection:core/${spec.site}/${spec.capabilityId}/fixture`,
    source_refs: [`harbor:source-trace/${spec.site}/${spec.capabilityId}`],
    evidence_refs: evidenceRefs,
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Projected public fields satisfy the Lode read-only package contract.",
      checked_at: "2026-07-06T10:00:10.000Z",
      evidence_refs: evidenceRefs,
      source_refs: [`harbor:source-trace/${spec.site}/${spec.capabilityId}`],
      consumer_boundary: "Core stores public projection status and refs only."
    },
    retention_state: "active"
  });
  assert.equal(completed.run_record.status, "succeeded");
  assert.equal(completed.result_envelope.output_schema_id, spec.outputSchemaId);
  assert.equal(completed.result_envelope.data?.site, spec.site);
  assertPublicRefsOnly(completed.run_record);

  const summary = await getRunSummary(store, record.run_id);
  assert.equal(summary.ok, true);
  if (!summary.ok) throw new Error("run summary must be available");
  assert.equal(summary.run.task.capability_source_ref, spec.packageRef);
  assert.equal(summary.run.admission.resource_match_ref, `resource-match:${spec.site}/${spec.capabilityId}/readonly`);

  const result = await getRunResult(store, record.run_id);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("run result must be available");
  assert.equal(result.result.result.result_envelope?.capability_lock_ref, spec.lockRef);
}

type InterruptedStatus = Extract<RunRecordStatus, "cancelled" | "expired" | "manual_recovery_required">;

async function completeInterruptedRead(store: FileRunRecordStore, spec: ReadOnlySiteSpec, status: InterruptedStatus, failure: FailureRecord): Promise<void> {
  const record = await admitRun(store, spec, status, status === "manual_recovery_required" ? "user" : "core_task");
  const evidenceRefs = requireEvidenceRefs(record.evidence_refs);
  await store.updateRunRecord(record.run_id, { status: "running", evidence_refs: evidenceRefs });
  const patch =
    status === "expired"
      ? await store.updateRunRecord(record.run_id, {
          status,
          evidence_refs: evidenceRefs,
          failure,
          retention_state: "active"
        })
      : (await completeRunWithFailure(store, record.run_id, {
          status: status === "cancelled" || status === "manual_recovery_required" ? status : "failed",
          failure,
          evidence_refs: evidenceRefs,
          retention_state: "active"
        })).run_record;
  assert.equal(patch.status, status);
  assert.equal(patch.failure?.code, failure.code);
  assertPublicRefsOnly(patch);
}

export async function assertRealSiteReadOnlyTaskExecution(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-real-site-readonly-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const [xhsSearch, , bossSearch, bossDetail] = siteSpecs;
    assert(xhsSearch);
    assert(bossSearch);
    assert(bossDetail);
    for (const spec of siteSpecs) {
      await completeSuccessfulRead(store, spec);
    }

    await completeInterruptedRead(store, xhsSearch, "cancelled", {
      category: "runtime_execution",
      code: "user_cancelled",
      phase: "execution",
      recovery_hint: "record_cancellation"
    });
    await completeInterruptedRead(store, bossSearch, "expired", {
      category: "runtime_execution",
      code: "timeout",
      phase: "execution",
      recovery_hint: "retry_with_fresh_runtime"
    });
    await completeInterruptedRead(store, bossDetail, "manual_recovery_required", {
      category: "runtime_execution",
      code: "user_takeover",
      phase: "execution",
      recovery_hint: "show_user_takeover_state"
    });

    const xhsRuns = await getCapabilityRunSummary(store, {
      capability_ref: "lode:capability/search-notes",
      capability_version: "0.1.0",
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0"
    });
    assert.equal(xhsRuns.ok, true);
    if (!xhsRuns.ok) throw new Error("capability run summary must be available");
    assert.equal(xhsRuns.capability_runs.status_counts.succeeded, 1);
    assert.equal(xhsRuns.capability_runs.status_counts.cancelled, 1);
    assert.equal(xhsRuns.capability_runs.latest_failure?.failure.code, "user_cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
