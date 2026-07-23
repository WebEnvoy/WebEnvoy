import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { completeRunWithReadOnlyEmptyResult, completeRunWithReadOnlyFailure, completeRunWithReadOnlyProjection, type LodeReadOnlyFailureClass, type LodeReadOnlyProjection } from "./read-only-result-projection.js";
import { getRunFailureReason, getRunResult } from "./result-query.js";
import { getRunSummary } from "./run-query.js";
import { createFileRunRecordStore, type FileRunRecordStore } from "./run-record-store.js";

type ProjectionSpec = {
  runId: string;
  capabilityRef: string;
  capabilityVersion: string;
  packageRef: string;
  lockRef: string;
  resourceRef: string;
  runtimeSessionRef: string;
  resultRef: string;
  projectionRef: string;
  outputSchemaId: string;
  sourceRef: string;
  evidenceRefs: readonly string[];
  projection: LodeReadOnlyProjection;
};

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 6, 11, 0, tick));
  tick += 1;
  return instant;
}

const specs: readonly ProjectionSpec[] = [
  {
    runId: "run_real_projection_xhs_search",
    capabilityRef: "lode:capability/search-notes",
    capabilityVersion: "0.1.0",
    packageRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    lockRef: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    resourceRef: "xiaohongshu.search-notes.resources",
    runtimeSessionRef: "harbor:runtime-session/xiaohongshu/readonly",
    resultRef: "result:core/xiaohongshu/search-notes/live-read",
    projectionRef: "projection:core/xiaohongshu/search-notes/live-read",
    outputSchemaId: "lode://schema/site-capability/xiaohongshu/search-notes/output@0.1.0",
    sourceRef: "harbor:source-trace/xiaohongshu/search-notes",
    evidenceRefs: ["harbor:evidence/xiaohongshu/search-notes/snapshot", "harbor:evidence/xiaohongshu/search-notes/source-trace"],
    projection: {
      result_kind: "xhs_note_search",
      status: "available",
      classification: "success_result",
      normalized: {
        canonical_url: "https://www.xiaohongshu.com/search_result?keyword=city%20coffee",
        title: "Xiaohongshu search results for city coffee",
        summary: "Two public note cards projected from Xiaohongshu search.",
        source_status: "located",
        keyword: "city coffee",
        result_count: 2,
        notes: [{ note_ref: "xhs-note:fixture/city-coffee-1", title: "City coffee route", follow_up_ref: "input:fixture/xhs-note-detail-1" }]
      },
      source_refs: [{ ref_id: "harbor:source-trace/xiaohongshu/search-notes", source_kind: "pinia_store_summary", producer: "Harbor", redaction: "summary_only", schema_hint: "xhs.search-notes.source.pinia-search-store" }],
      evidence_refs: [{ ref_id: "harbor:evidence/xiaohongshu/search-notes/snapshot", evidence_kind: "snapshot_ref", producer: "Harbor", redaction: "summary_only" }]
    }
  },
  {
    runId: "run_real_projection_xhs_detail",
    capabilityRef: "lode:capability/read-note-detail",
    capabilityVersion: "0.1.0",
    packageRef: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
    lockRef: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
    resourceRef: "xiaohongshu.read-note-detail.resources",
    runtimeSessionRef: "harbor:runtime-session/xiaohongshu/readonly",
    resultRef: "result:core/xiaohongshu/read-note-detail/live-read",
    projectionRef: "projection:core/xiaohongshu/read-note-detail/live-read",
    outputSchemaId: "lode://schema/site-capability/xiaohongshu/read-note-detail/output@0.1.0",
    sourceRef: "harbor:source-trace/xiaohongshu/read-note-detail",
    evidenceRefs: ["harbor:evidence/xiaohongshu/read-note-detail/snapshot"],
    projection: {
      result_kind: "xhs_note_detail",
      status: "available",
      classification: "success_result",
      normalized: {
        canonical_url: "https://www.xiaohongshu.com/explore/fixture-note-1?xsec_token=fixture",
        title: "City coffee route",
        summary: "Public Xiaohongshu note detail summary.",
        source_status: "located",
        note_id: "fixture-note-1",
        author: { author_ref: "xhs-author:fixture/1" },
        body_summary: "Public note text summary projected by Lode.",
        interaction_metrics: { likes: 12, collects: 4 },
        source_citation: { source_ref: "harbor:source-trace/xiaohongshu/read-note-detail" }
      },
      source_refs: [{ ref_id: "harbor:source-trace/xiaohongshu/read-note-detail", source_kind: "pinia_note_store_summary", producer: "Harbor", redaction: "summary_only", schema_hint: "xhs.read-note-detail.source.pinia-note-store" }],
      evidence_refs: [{ ref_id: "harbor:evidence/xiaohongshu/read-note-detail/snapshot", evidence_kind: "snapshot_ref", producer: "Harbor", redaction: "summary_only" }]
    }
  },
  {
    runId: "run_real_projection_boss_search",
    capabilityRef: "lode:capability/job-search",
    capabilityVersion: "0.1.0",
    packageRef: "lode://site-capability/boss/job-search@0.1.0",
    lockRef: "lode://lock/site-capability/boss/job-search@0.1.0",
    resourceRef: "boss.job-search.resources",
    runtimeSessionRef: "harbor:runtime-session/boss/readonly",
    resultRef: "result:core/boss/job-search/live-read",
    projectionRef: "projection:core/boss/job-search/live-read",
    outputSchemaId: "lode://schema/site-capability/boss/job-search/output@0.1.0",
    sourceRef: "harbor:source-trace/boss/job-search",
    evidenceRefs: ["harbor:evidence/boss/job-search/snapshot"],
    projection: {
      result_kind: "boss_job_search",
      status: "available",
      classification: "success_result",
      normalized: {
        canonical_url: "https://www.zhipin.com/web/geek/job?query=AI%20agent&city=101010100",
        title: "BOSS AI agent job search",
        summary: "Two public job cards projected from BOSS search.",
        source_status: "located",
        query: "AI agent",
        city: { city_ref: "boss-city:101010100", name: "Beijing" },
        result_count: 2,
        jobs: [{ job_ref: "boss-job:fixture/ai-agent-1", title: "AI Agent Engineer", detail_ref: "input:fixture/boss/job-detail-1" }]
      },
      source_refs: [{ ref_id: "harbor:source-trace/boss/job-search", source_kind: "wapi_joblist_summary", producer: "Harbor", redaction: "summary_only", schema_hint: "boss.job-search.source.wapi-joblist-summary" }],
      evidence_refs: [{ ref_id: "harbor:evidence/boss/job-search/snapshot", evidence_kind: "snapshot_ref", producer: "Harbor", redaction: "summary_only" }]
    }
  },
  {
    runId: "run_real_projection_boss_detail",
    capabilityRef: "lode:capability/read-job-detail",
    capabilityVersion: "0.1.0",
    packageRef: "lode://site-capability/boss/read-job-detail@0.1.0",
    lockRef: "lode://lock/site-capability/boss/read-job-detail@0.1.0",
    resourceRef: "boss.read-job-detail.resources",
    runtimeSessionRef: "harbor:runtime-session/boss/readonly",
    resultRef: "result:core/boss/read-job-detail/live-read",
    projectionRef: "projection:core/boss/read-job-detail/live-read",
    outputSchemaId: "lode://schema/site-capability/boss/read-job-detail/output@0.1.0",
    sourceRef: "harbor:source-trace/boss/read-job-detail",
    evidenceRefs: ["harbor:evidence/boss/read-job-detail/snapshot"],
    projection: {
      result_kind: "boss_job_detail",
      status: "available",
      classification: "success_result",
      normalized: {
        canonical_url: "https://www.zhipin.com/job_detail/fixture-job-1.html",
        title: "AI Agent Engineer",
        summary: "Public BOSS job detail summary.",
        source_status: "located",
        securityId: "security-fixture",
        job: { job_ref: "boss-job:fixture/ai-agent-1", salary: "30-50K" },
        company: { company_ref: "boss-company:fixture/1" },
        recruiter: { recruiter_ref: "boss-recruiter:fixture/1" },
        source_citation: { source_ref: "harbor:source-trace/boss/read-job-detail" }
      },
      source_refs: [{ ref_id: "harbor:source-trace/boss/read-job-detail", source_kind: "wapi_detail_summary", producer: "Harbor", redaction: "summary_only", schema_hint: "boss.read-job-detail.source.wapi-detail-summary" }],
      evidence_refs: [{ ref_id: "harbor:evidence/boss/read-job-detail/snapshot", evidence_kind: "snapshot_ref", producer: "Harbor", redaction: "summary_only" }]
    }
  }
];

const failureCases: readonly [Exclude<LodeReadOnlyFailureClass, "empty_result">, string][] = [
  ["invalid_contract", "capability_failure"],
  ["not_logged_in", "login_required"],
  ["captcha_required", "risk_prompt"],
  ["page_not_ready", "page_changed"],
  ["page_changed", "page_changed"],
  ["field_missing", "field_unavailable"],
  ["network_resource_unavailable", "evidence_unavailable"]
];

function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  for (const [key, entry] of Object.entries(value)) {
    if (["raw_payload", "dom", "har", "screenshot", "video", "cookie", "cookies", "token", "tokens", "profile_path", "cdp_endpoint", "viewer_url"].includes(key)) return true;
    if (hasForbiddenKey(entry)) return true;
  }
  return false;
}

async function createRun(store: FileRunRecordStore, spec: ProjectionSpec, suffix = "success"): Promise<void> {
  await store.createRunRecord({
    run_id: suffix === "success" ? spec.runId : `${spec.runId}_${suffix}`,
    status: "admitted",
    task_intent_ref: `intent:${spec.runId}:${suffix}`,
    entrypoint_ref: "entrypoint:api",
    capability_ref: spec.capabilityRef,
    capability_version: spec.capabilityVersion,
    capability_source_ref: spec.packageRef,
    capability_lock_ref: spec.lockRef,
    package_ref: spec.packageRef,
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: [spec.resourceRef],
      runtime_binding_refs: [spec.runtimeSessionRef, spec.sourceRef],
      evidence_refs: [...spec.evidenceRefs],
      resource_match_ref: `resource-match:${spec.runId}`,
      runtime_session_binding: {
        schema_version: "webenvoy.runtime-session-binding.v0",
        identity_environment_ref: `harbor:identity-env/${spec.runId}`,
        execution_identity_ref: `harbor:execution-identity/${spec.runId}`,
        runtime_session_ref: spec.runtimeSessionRef,
        profile_ref: `harbor:profile/${spec.runId}`,
        provider_ref: "harbor:provider/cloakbrowser",
        provider_mode: "local_dedicated_profile",
        lifecycle_state: "active",
        control_owner: "core_task",
        session_use: "core_task_run",
        core_task_run: true,
        consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
      }
    },
    runtime_binding_refs: [spec.runtimeSessionRef, spec.sourceRef],
    evidence_refs: [...spec.evidenceRefs]
  });
  await store.updateRunRecord(suffix === "success" ? spec.runId : `${spec.runId}_${suffix}`, { status: "running" });
}

export async function assertRealSiteReadOnlyResultProjection(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-real-site-readonly-result-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    for (const spec of specs) {
      await createRun(store, spec);
      const completed = await completeRunWithReadOnlyProjection(store, spec.runId, {
        result_ref: spec.resultRef,
        output_schema_id: spec.outputSchemaId,
        projection: spec.projection,
        projection_ref: spec.projectionRef,
        post_check: {
          schema_version: "webenvoy.post-check-result.v0",
          status: "passed",
          summary: "Projected public fields satisfy the Lode read-only package contract.",
          evidence_refs: [...spec.evidenceRefs],
          source_refs: [spec.sourceRef],
          consumer_boundary: "Core stores public projection status and refs only."
        },
        retention_state: "active"
      });
      assert.equal(completed.result_envelope.output_schema_id, spec.outputSchemaId);
      assert.deepEqual(completed.result_envelope.source_refs, [spec.sourceRef]);
      assert.equal(hasForbiddenKey(completed.result_envelope), false);

      const result = await getRunResult(store, spec.runId);
      if (!result.ok) assert.fail(result.failure.code);
      assert.equal(result.result.result.payload_state, "available");
      assert.equal(result.result.result.result_envelope?.result_kind, spec.projection.result_kind);
      assert.equal(result.result.result.result_envelope?.projection_ref, spec.projectionRef);
      assert.deepEqual(result.result.result.result_envelope?.data, { projection: spec.projection });
      assert.deepEqual(result.result.result.result_envelope?.source_refs, [spec.sourceRef]);
      assert.equal(hasForbiddenKey(result.result), false);

      const restartedStore = createFileRunRecordStore({ directory, clock: nextInstant });
      const restartedResult = await getRunResult(restartedStore, spec.runId);
      if (!restartedResult.ok) assert.fail(restartedResult.failure.code);
      assert.equal(restartedResult.result.result.payload_state, "available");
      assert.deepEqual(restartedResult.result.result.result_envelope?.data, { projection: spec.projection });

      const summary = await getRunSummary(store, spec.runId);
      if (!summary.ok) assert.fail(summary.failure.code);
      assert.equal(summary.run.task.capability_source_ref, spec.packageRef);
      if (spec === specs[0]) {
        for (const retentionState of ["access_denied", "deleted_by_policy", "expired"] as const) {
          await store.updateRunRecord(spec.runId, { retention_state: retentionState });
          const retained = await getRunResult(store, spec.runId);
          if (!retained.ok) assert.fail(retained.failure.code);
          assert.equal(retained.result.result.payload_state, retentionState);
          assert.equal(retained.result.result.result_envelope?.data, undefined);
        }
      }
    }

    const base = specs[0];
    assert(base);
    for (const [failureClass, reasonClass] of failureCases) {
      await createRun(store, base, failureClass);
      const runId = `${base.runId}_${failureClass}`;
      await completeRunWithReadOnlyFailure(store, runId, {
        lode_failure_class: failureClass,
        evidence_refs: [...base.evidenceRefs],
        retention_state: "active"
      });
      const failure = await getRunFailureReason(store, runId);
      if (!failure.ok) assert.fail(failure.failure.code);
      assert.equal(failure.failure_reason.reason_class, reasonClass);
      assert.equal(failure.failure_reason.failure?.code, failureClass);
      assert.equal(hasForbiddenKey(failure.failure_reason), false);
    }

    await createRun(store, base, "empty_result");
    const emptyRunId = `${base.runId}_empty_result`;
    const empty = await completeRunWithReadOnlyEmptyResult(store, emptyRunId, {
      evidence_refs: [...base.evidenceRefs],
      retention_state: "active"
    });
    assert.equal(empty.run_record.status, "succeeded");
    assert.equal(empty.result_envelope.ok, true);
    assert.equal(empty.result_envelope.outcome, "empty");
    assert.deepEqual(empty.result_envelope.data, { status: "empty" });

    const emptyResult = await getRunResult(store, emptyRunId);
    if (!emptyResult.ok) assert.fail(emptyResult.failure.code);
    assert.equal(emptyResult.result.status, "succeeded");
    assert.equal(emptyResult.result.result.payload_state, "available");
    assert.equal(emptyResult.result.result.result_envelope?.outcome, "empty");
    assert.deepEqual(emptyResult.result.result.result_envelope?.data, { status: "empty" });

    const restartedEmptyResult = await getRunResult(createFileRunRecordStore({ directory, clock: nextInstant }), emptyRunId);
    if (!restartedEmptyResult.ok) assert.fail(restartedEmptyResult.failure.code);
    assert.equal(restartedEmptyResult.result.result.result_envelope?.outcome, "empty");
    assert.deepEqual(restartedEmptyResult.result.result.result_envelope?.data, { status: "empty" });

    const emptyFailure = await getRunFailureReason(store, emptyRunId);
    if (!emptyFailure.ok) assert.fail(emptyFailure.failure.code);
    assert.equal(emptyFailure.failure_reason.failure_present, false);
    assert.equal(emptyFailure.failure_reason.reason_class, "none");
    assert.equal(emptyFailure.failure_reason.app_action, "none");
    assert.equal(emptyFailure.failure_reason.retryable, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
