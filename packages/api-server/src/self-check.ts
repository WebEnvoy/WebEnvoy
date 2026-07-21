import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { completeRunWithFailure, completeRunWithResult, createFileRunRecordStore, identityCompatibilityPreviewRequestSchemaVersion, taskTurnInputConsumerBoundary, taskTurnInputSchemaVersion, type HarborIdentityFactsReader, type LodePackageResolver, type TaskTurnInputPolicyResolver } from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";
import { apiServerHost } from "./index.js";
import { createApiServer } from "./server.js";
import { assertRuntimeTaskSubmitApi } from "./runtime-task-submit-self-check.js";
import { assertTaskThreadApiRaces } from "./task-thread-api-self-check.js";
import { assertExecutionPolicyApi } from "./execution-policy-api-self-check.js";

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

async function postJson(port: number, path: string, body?: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json() };
}
async function requestBody(port: number, path: string, method: string, body?: string, contentType?: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: contentType === undefined ? {} : { "content-type": contentType },
    ...(body === undefined ? {} : { body })
  });
  return { status: response.status, body: await response.json() };
}
function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 2, 0, tick));
  tick += 1;
  return instant;
}

async function main(): Promise<void> {
  assert.equal(apiServerHost, "127.0.0.1");
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-api-server-"));
  const store = createFileRunRecordStore({ directory, clock: nextInstant });
  const threadInputPolicyResolver: TaskTurnInputPolicyResolver = async ({ package_ref, capability_ref }) => ({
    package_ref,
    capability_ref,
    input_schema_ref: "lode://schema/site-capability/xiaohongshu/search-notes/input@0.1.0",
    fields: new Map([
      ["keyword", { field_id: "keyword", projection: "safe_summary" }],
      ["limit", { field_id: "limit", projection: "safe_summary" }],
      ["url", { field_id: "url", projection: "sanitized_url" }]
    ])
  });
  const taskThreadStore = createFileTaskThreadStore({
    directory: join(directory, "threads"),
    runRecordStore: store,
    clock: nextInstant,
    resolveInputPolicy: threadInputPolicyResolver
  });
  const threadLodeResolver: LodePackageResolver = async () => ({
    package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    source_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    capability_id: "search-notes",
    operation_id: "xhs_search_notes",
    operation_mode: "read",
    version: "0.1.0",
    lifecycle: "active",
    runtime_admission: { enabled: true, status: "current", recheck_condition: "not_applicable" },
    resource_requirements: {
      resource_requirements_id: "xiaohongshu.search-notes.resources",
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      operation_mode: "read",
      resource_requirement_profiles: [{
        requirement_profile_id: "fixture",
        required_harbor_facts: [{ fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" }]
      }]
    },
    runtime_consumption: {
      allowlist_id: "lode.runtime-consumption.v0", allowlist_version: "0.1.0", asset_owner: "Lode",
      consumer: { repository: "WebEnvoy/WebEnvoy", issue: "299", purpose: "identity compatibility preview" },
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0", version: "0.1.0",
      site_slug: "xiaohongshu", operation_id: "xhs_search_notes", operation_mode: "read", lifecycle: "active",
      allowed_origins: ["https://www.xiaohongshu.com"], resource_requirements_id: "xiaohongshu.search-notes.resources",
      failure_mapping_id: "xhs-search-failures", required_failure_classes: ["resource_requirement_unmatched"],
      required_source_ref_kinds: ["source_trace_ref"], required_evidence_ref_kinds: ["snapshot_ref"],
      post_check_id: "xhs-search-post-check", required_post_check_fields: ["status"]
    }
  });
  let compatibilityFactReads = 0;
  const harborIdentityFactsReader: HarborIdentityFactsReader = async (identityEnvironmentRef) => {
    compatibilityFactReads += 1;
    return {
      ok: true,
      owner_readiness: "ready",
      provider_status: {
        schema_version: "harbor-browser-provider-status/v0",
        providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }]
      },
      observed_at: new Date().toISOString(),
      facts: {
        schema_version: "harbor-local-identity-environment/v0",
        identity_environment_ref: identityEnvironmentRef,
        execution_identity_ref: `execution:${identityEnvironmentRef}`,
        profile_ref: `profile:${identityEnvironmentRef}`,
        site_binding: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
        login_state: { state: "logged_in", authentication_provenance: "user_confirmed_managed_session", manual_authentication_state: "completed", recovery_required: false },
        browser_storage: { state: "present" },
        provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "public_record_provider_available" },
        consumer_boundary: { core: "admission_facts_refs_and_blocking_reasons_only", not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"] }
      }
    };
  };
  const runId = "run_api_query_001";

  await store.createRunRecord({
    run_id: runId,
    task_intent_ref: "intent_fixture_read_only_001",
    entrypoint_ref: "entrypoint:api",
    capability_ref: "lode:capability/read-public-page",
    capability_version: "0.1.0",
    capability_source_ref: "lode://site-capability/example/read-public-page@0.1.0",
    capability_lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
    package_ref: "lode://site-capability/example/read-public-page@0.1.0",
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
      evidence_refs: ["evidence:fixture/read-public-page"],
      resource_match_ref: "resource-match:fixture/ready"
    },
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/read-public-page"]
  });
  await store.updateRunRecord(runId, {
    status: "admitted",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/read-public-page"]
  });
  await store.updateRunRecord(runId, {
    status: "running",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/read-public-page"]
  });
  await completeRunWithResult(store, runId, {
    result_ref: "result:fixture/read-public-page",
    result_kind: "content_detail",
    projection_ref: "projection:fixture/read-public-page",
    evidence_refs: ["evidence:fixture/read-public-page"],
    retention_state: "active"
  });
  const failureRunId = "run_api_failure_001";
  await store.createRunRecord({
    run_id: failureRunId,
    task_intent_ref: "intent_fixture_read_only_001",
    entrypoint_ref: "entrypoint:api",
    capability_ref: "lode:capability/read-public-page",
    capability_version: "0.1.0",
    capability_source_ref: "lode://site-capability/example/read-public-page@0.1.0",
    capability_lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
    package_ref: "lode://site-capability/example/read-public-page@0.1.0",
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
      evidence_refs: ["evidence:fixture/failure-admission"],
      resource_match_ref: "resource-match:fixture/ready"
    },
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/failure-admission"]
  });
  await store.updateRunRecord(failureRunId, {
    status: "admitted",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/failure-admission"]
  });
  await store.updateRunRecord(failureRunId, {
    status: "running",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/failure-admission"]
  });
  await completeRunWithFailure(store, failureRunId, {
    evidence_refs: ["evidence:fixture/output-invalid"],
    failure: {
      category: "result_projection",
      code: "output_invalid",
      phase: "projection",
      recovery_hint: "repair_package"
    },
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "failed",
      summary: "Normalized output did not satisfy the public result contract.",
      checked_at: "2026-07-01T02:00:07.000Z",
      code: "output_invalid",
      attribution: "capability",
      recovery_hint: "repair_package",
      evidence_refs: ["evidence:fixture/output-invalid"],
      consumer_boundary: "Core stores post-check refs and public status only."
    },
    retention_state: "redacted"
  });

  const server = createApiServer({ runRecordStore: store, taskThreadStore, lodePackageResolver: threadLodeResolver, harborIdentityFactsReader });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;

  try {
    assert.deepEqual(await getJson(port, "/health"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ok"
      }
    });

    assert.deepEqual(await getJson(port, "/readiness"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ready",
        checks: {
          apiServer: "ok"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/admission/health"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "degraded",
        checks: {
          runRecordStore: "configured",
          authorizationDecisionStore: "missing",
          executionPolicyConfigStore: "missing",
          taskThreadStore: "configured",
          lodePackageResolver: "configured",
          harborIdentityFactsReader: "configured",
          harborRuntimeClient: "missing"
        },
        consumer_boundary: "Core admission health reports API wiring only; it does not launch Harbor, open a browser, or prove live site execution."
      }
    });

    const recordsBeforePreview = (await store.listRunRecords()).length;
    const compatibility = await postJson(port, "/identity-compatibility-preview", {
      schema_version: identityCompatibilityPreviewRequestSchemaVersion,
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
      version: "0.1.0",
      operation_id: "xhs_search_notes",
      operation_mode: "read",
      target_ref: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
      target_origin: "https://www.xiaohongshu.com",
      resource_requirement_ref: "xiaohongshu.search-notes.resources",
      resource_requirement_profile_id: "fixture",
      identity_environment_refs: ["identity-env-preview"]
    });
    assert.equal(compatibility.status, 200);
    const compatibilityBody = asRecord(compatibility.body);
    assert.equal(compatibilityBody.schema_version, "webenvoy.identity-compatibility-preview.v0");
    assert.equal(asRecord((compatibilityBody.candidates as unknown[])[0]).status, "unknown_until_runtime");
    assert.equal(compatibilityFactReads, 1);
    assert.equal((await store.listRunRecords()).length, recordsBeforePreview, "compatibility preview must not create a Run Record");
    const rejectedCompatibility = await postJson(port, "/identity-compatibility-preview", {
      schema_version: identityCompatibilityPreviewRequestSchemaVersion,
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
      version: "0.1.0",
      operation_id: "xhs_search_notes",
      operation_mode: "read",
      target_ref: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
      target_origin: "https://www.xiaohongshu.com",
      resource_requirement_ref: "xiaohongshu.search-notes.resources",
      resource_requirement_profile_id: "fixture",
      identity_environment_refs: ["identity-env-preview"],
      cookies: []
    });
    assert.equal(rejectedCompatibility.status, 400);
    assert.equal(asRecord(asRecord(rejectedCompatibility.body).error).code, "private_field_rejected:cookies");

    for (const unsafeTarget of [
      "https://preview-user:preview-password@www.xiaohongshu.com/search_result/",
      "https://www.xiaohongshu.com/search_result/?access_token=must-not-echo",
      "arbitrary-opaque-target"
    ]) {
      const unsafeCompatibility = await postJson(port, "/identity-compatibility-preview", {
        schema_version: identityCompatibilityPreviewRequestSchemaVersion,
        package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
        lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
        version: "0.1.0",
        operation_id: "xhs_search_notes",
        operation_mode: "read",
        target_ref: unsafeTarget,
        target_origin: "https://www.xiaohongshu.com",
        resource_requirement_ref: "xiaohongshu.search-notes.resources",
        resource_requirement_profile_id: "fixture",
        identity_environment_refs: ["identity-env-preview"]
      });
      assert.equal(unsafeCompatibility.status, 400);
      assert.equal(asRecord(asRecord(unsafeCompatibility.body).error).code, "identity_compatibility_request_invalid");
      assert.equal(JSON.stringify(unsafeCompatibility.body).includes("must-not-echo"), false);
      assert.equal(JSON.stringify(unsafeCompatibility.body).includes("preview-password"), false);
    }

    const previewPath = "/identity-compatibility-preview";
    const missingMediaType = await requestBody(port, previewPath, "POST", "{}");
    assert.equal(missingMediaType.status, 415);
    assert.equal(asRecord(asRecord(missingMediaType.body).error).code, "content_type_unsupported");
    assert.equal((await requestBody(port, previewPath, "POST", "{}", "text/plain")).status, 415);
    const malformedPreview = await requestBody(port, previewPath, "POST", "{", "application/json; charset=utf-8");
    assert.equal(malformedPreview.status, 400);
    assert.equal(asRecord(asRecord(malformedPreview.body).error).code, "invalid_json_body");
    const oversizedPreview = await requestBody(port, previewPath, "POST", JSON.stringify({ padding: "x".repeat(64 * 1024) }), "application/json");
    assert.equal(oversizedPreview.status, 413);
    assert.equal(asRecord(asRecord(oversizedPreview.body).error).code, "request_body_too_large");
    const previewGet = await getJson(port, previewPath);
    assert.equal(previewGet.status, 405);
    assert.equal(asRecord(asRecord(previewGet.body).error).code, "method_not_allowed");

    const unavailableServer = createApiServer({});
    await new Promise<void>((resolve) => unavailableServer.listen(0, "127.0.0.1", resolve));
    try {
      const unavailableAddress = unavailableServer.address();
      assert(unavailableAddress && typeof unavailableAddress === "object");
      const ownerUnavailable = await postJson(unavailableAddress.port, previewPath, {
        schema_version: identityCompatibilityPreviewRequestSchemaVersion,
        package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
        lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
        version: "0.1.0",
        operation_id: "xhs_search_notes",
        operation_mode: "read",
        target_ref: "https://www.xiaohongshu.com/search_result/",
        target_origin: "https://www.xiaohongshu.com",
        resource_requirement_ref: "xiaohongshu.search-notes.resources",
        resource_requirement_profile_id: "fixture",
        identity_environment_refs: ["identity-env-preview"]
      });
      assert.equal(ownerUnavailable.status, 503);
      assert.equal(asRecord(asRecord(ownerUnavailable.body).error).code, "identity_compatibility_owner_unavailable");
      const decisionStoreUnavailable = await getJson(unavailableAddress.port, "/authorization-decisions");
      assert.equal(decisionStoreUnavailable.status, 503);
      assert.equal(asRecord(asRecord(decisionStoreUnavailable.body).error).code, "authorization_decision_store_unavailable");
    } finally {
      await new Promise<void>((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve()));
    }

    assert.deepEqual(await getJson(port, `/runs/${runId}`), {
      status: 200,
      body: {
        ok: true,
        run: {
          schema_version: "webenvoy.run-query.v0",
          run_id: runId,
          status: "succeeded",
          timeline: {
            created_at: "2026-07-01T02:00:00.000Z",
            updated_at: "2026-07-01T02:00:03.000Z",
            terminal_at: "2026-07-01T02:00:03.000Z"
          },
          task: {
            task_intent_ref: "intent_fixture_read_only_001",
            capability_ref: "lode:capability/read-public-page",
            capability_version: "0.1.0",
            capability_source_ref: "lode://site-capability/example/read-public-page@0.1.0",
            capability_lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
            entrypoint_ref: "entrypoint:api",
            package_ref: "lode://site-capability/example/read-public-page@0.1.0"
          },
          admission: {
            decision: "accepted",
            action_risk: "read",
            resource_requirement_refs: ["example.read-public-page.resources"],
            resource_match_ref: "resource-match:fixture/ready"
          },
          runtime_refs: {
            binding_refs: ["harbor:runtime-session/fixture-ready"],
            admission_binding_refs: ["harbor:runtime-session/fixture-ready"]
          },
          terminal_summary: {
            terminal: true,
            status: "succeeded",
            terminal_at: "2026-07-01T02:00:03.000Z",
            result_ref: "result:fixture/read-public-page",
            retention_state: "active"
          }
        }
      }
    });

    const resultResponse = await getJson(port, `/runs/${runId}/result`);
    assert.equal(resultResponse.status, 200);
    const resultBody = asRecord(resultResponse.body);
    assert.equal(resultBody.ok, true);
    const resultEnvelope = asRecord(resultBody.result);
    assert.equal(resultEnvelope.schema_version, "webenvoy.result-query.v0");
    assert.equal(resultEnvelope.run_id, runId);
    assert.equal(resultEnvelope.status, "succeeded");
    assert.equal(asRecord(resultEnvelope.result).envelope_state, "available");
    assert.equal(asRecord(resultEnvelope.result).payload_state, "not_persisted_in_core");
    assert.equal(asRecord(asRecord(resultEnvelope.result).result_envelope).result_ref, "result:fixture/read-public-page");

    const evidenceResponse = await getJson(port, `/runs/${runId}/evidence-refs`);
    assert.equal(evidenceResponse.status, 200);
    const evidenceBody = asRecord(evidenceResponse.body);
    assert.equal(evidenceBody.ok, true);
    const evidenceEnvelope = asRecord(evidenceBody.evidence);
    assert.equal(evidenceEnvelope.schema_version, "webenvoy.evidence-refs-query.v0");
    assert.equal(evidenceEnvelope.run_id, runId);
    const evidenceRefs = evidenceEnvelope.evidence_refs as unknown[];
    assert.equal(evidenceRefs.length, 1);
    assert.equal(asRecord(evidenceRefs[0]).source, "admission_and_terminal");
    assert.equal(asRecord(evidenceRefs[0]).state, "available");
    assert.equal(asRecord(evidenceRefs[0]).recorded_at, "2026-07-01T02:00:03.000Z");

    const sessionRefsResponse = await getJson(port, `/runs/${runId}/session-refs`);
    assert.equal(sessionRefsResponse.status, 200);
    const sessionRefsBody = asRecord(sessionRefsResponse.body);
    assert.equal(sessionRefsBody.ok, true);
    const sessionRefsEnvelope = asRecord(sessionRefsBody.session_refs);
    assert.equal(sessionRefsEnvelope.schema_version, "webenvoy.session-refs-query.v0");
    assert.deepEqual(asRecord(sessionRefsEnvelope.session_refs).binding_refs, ["harbor:runtime-session/fixture-ready"]);
    assert.equal(asRecord(sessionRefsEnvelope.session_refs).raw_access, "not_available_from_core");

    const failureResponse = await getJson(port, `/runs/${failureRunId}/result`);
    assert.equal(failureResponse.status, 200);
    const failureBody = asRecord(failureResponse.body);
    assert.equal(failureBody.ok, true);
    const failureEnvelope = asRecord(failureBody.result);
    assert.equal(asRecord(failureEnvelope.failure).code, "output_invalid");
    assert.equal(asRecord(failureEnvelope.failure).attribution, "capability");
    assert.equal(asRecord(failureEnvelope.result).envelope_state, "redacted");
    assert.equal(asRecord(failureEnvelope.result).payload_state, "redacted");
    assert.equal(asRecord(asRecord(failureEnvelope.result).result_envelope).ok, false);

    const failureReasonResponse = await getJson(port, `/runs/${failureRunId}/failure`);
    assert.equal(failureReasonResponse.status, 200);
    const failureReasonBody = asRecord(failureReasonResponse.body);
    assert.equal(failureReasonBody.ok, true);
    const failureReason = asRecord(failureReasonBody.failure_reason);
    assert.equal(failureReason.schema_version, "webenvoy.failure-reason-query.v0");
    assert.equal(failureReason.reason_class, "capability_failure");
    assert.equal(failureReason.app_action, "repair_package");
    assert.equal(failureReason.retryable, false);

    const capabilityRunsResponse = await getJson(port, "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0");
    assert.equal(capabilityRunsResponse.status, 200);
    const capabilityRunsBody = asRecord(capabilityRunsResponse.body);
    assert.equal(capabilityRunsBody.ok, true);
    const capabilityRuns = asRecord(capabilityRunsBody.capability_runs);
    assert.equal(capabilityRuns.schema_version, "webenvoy.capability-run-query.v0");
    assert.equal(capabilityRuns.total_runs, 2);
    assert.equal(asRecord(capabilityRuns.status_counts).succeeded, 1);
    assert.equal(asRecord(capabilityRuns.status_counts).failed, 1);
    assert.equal(asRecord(capabilityRuns.failure_attribution_counts).capability, 1);
    assert.equal(asRecord(capabilityRuns.latest_failure).run_id, failureRunId);

    assert.deepEqual(await getJson(port, "/capability-runs"), {
      status: 400,
      body: {
        ok: false,
        error: {
          category: "request_invalid",
          code: "capability_ref_required",
          phase: "query",
          recovery_hint: "fix_input",
          attribution: "input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/missing_run"), {
      status: 404,
      body: {
        ok: false,
        error: {
          category: "persistence_observability",
          code: "run_not_found",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/missing_run/result"), {
      status: 404,
      body: {
        ok: false,
        error: {
          category: "persistence_observability",
          code: "run_not_found",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/%E0%A4%A"), {
      status: 400,
      body: {
        ok: false,
        error: {
          category: "request_invalid",
          code: "run_id_invalid",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/%E0%A4%A/evidence-refs"), {
      status: 400,
      body: {
        ok: false,
        error: {
          category: "request_invalid",
          code: "run_id_invalid",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/%E0%A4%A/failure"), {
      status: 400,
      body: {
        ok: false,
        error: {
          category: "request_invalid",
          code: "run_id_invalid",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    const createThreadResponse = await postJson(port, "/threads", {
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env:xhs-brand"
    });
    assert.equal(createThreadResponse.status, 201);
    const createThreadBody = asRecord(createThreadResponse.body);
    const createdThread = asRecord(createThreadBody.thread);
    const threadId = createdThread.thread_id as string;
    assert.equal((createdThread.turns as unknown[]).length, 0);

    assert.equal((await postJson(port, "/threads", {
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env:xhs-brand"
    })).status, 200);

    const taskTurnRequest = {
      idempotency_key: "api-thread-submit-001",
      run_id: "run_api_thread_001",
      input_snapshot: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [
          { field_id: "keyword", kind: "scalar", summary: "AI tools" },
          { field_id: "limit", kind: "scalar", summary: "8" }
        ],
        consumer_boundary: taskTurnInputConsumerBoundary
      },
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      task_intent: {
        schema_version: "webenvoy.task-intent.v0",
        intent_id: "intent_api_thread_001",
        entrypoint: "app",
        user_intent: { summary: "Prepare a guarded task turn." },
        capability: {
          ref: "lode:capability/search-notes",
          version: "0.1.0",
          source_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0"
        },
        input: { summary: "keyword=AI tools; limit=8" },
        scope: { target_type: "xiaohongshu_notes", target_ref: "xhs:search/ai-tools" },
        policy: { risk: "submit", execution_intent: "execute_after_approval" },
        resource_requirement_refs: [],
        evidence_policy_ref: "policy:no-raw-evidence"
      },
      harbor: { identity_environment_ref: "identity-env:xhs-brand" }
    };
    const turnResponse = await postJson(port, `/threads/${threadId}/turns`, taskTurnRequest);
    assert.equal(turnResponse.status, 409);
    const turnBody = asRecord(turnResponse.body);
    assert.equal(turnBody.replayed, false);
    assert.equal(asRecord(turnBody.turn).status, "failed");
    assert.equal(asRecord(turnBody.turn).failure_code, "true_write_deferred");
    assert.equal(asRecord(turnBody.turn).sequence, 1);
    assert.equal(asRecord(asRecord(turnBody.turn).input).consumer_boundary, taskTurnInputConsumerBoundary);

    const replayResponse = await postJson(port, `/threads/${threadId}/turns`, taskTurnRequest);
    assert.equal(replayResponse.status, 409);
    const replayBody = asRecord(replayResponse.body);
    assert.equal(replayBody.ok, false);
    assert.equal(replayBody.replayed, true);
    assert.equal(asRecord(replayBody.turn).turn_id, asRecord(turnBody.turn).turn_id);
    assert.equal(Object.hasOwn(asRecord(replayBody.turn), "run_claim_token"), false);

    const invalidBoundaryResponse = await postJson(port, `/threads/${threadId}/turns`, {
      ...taskTurnRequest,
      idempotency_key: "api-thread-invalid-boundary",
      run_id: "run_api_thread_invalid_boundary",
      input_snapshot: {
        ...taskTurnRequest.input_snapshot,
        consumer_boundary: "caller-controlled"
      }
    });
    assert.equal(invalidBoundaryResponse.status, 400);
    assert.equal(asRecord(asRecord(invalidBoundaryResponse.body).error).code, "consumer_boundary_invalid");

    const undeclaredDraftResponse = await postJson(port, `/threads/${threadId}/turns`, {
      ...taskTurnRequest,
      idempotency_key: "api-thread-undeclared-draft",
      run_id: "run_api_thread_undeclared_draft",
      input_snapshot: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "draft_body", kind: "scalar", summary: "RAW DRAFT BODY" }]
      }
    });
    assert.equal(undeclaredDraftResponse.status, 400);
    assert.equal(asRecord(asRecord(undeclaredDraftResponse.body).error).code, "input_field_not_declared:draft_body");

    const invalidIntentResponse = await postJson(port, `/threads/${threadId}/turns`, {
      ...taskTurnRequest,
      idempotency_key: "api-thread-invalid-intent",
      run_id: "run_api_thread_invalid",
      task_intent: {
        ...taskTurnRequest.task_intent,
        entrypoint: "agent"
      }
    });
    assert.equal(invalidIntentResponse.status, 400);
    assert.equal(asRecord(asRecord(invalidIntentResponse.body).error).code, "entrypoint_unsupported");
    assert.equal((asRecord(asRecord((await getJson(port, `/threads/${threadId}`)).body).thread).turns as unknown[]).length, 1);

    const invalidSnapshotBeforeBinding = await postJson(port, `/threads/${threadId}/turns`, {
      ...taskTurnRequest,
      idempotency_key: "api-thread-invalid-snapshot",
      run_id: "run_api_thread_invalid_snapshot",
      input_snapshot: {
        ...taskTurnRequest.input_snapshot,
        fields: [{ field_id: "draft", kind: "long_text", owner_ref: "draft:fixture", content: "RAW-SECRET" }]
      },
      harbor: { identity_environment_ref: "identity-env:other" }
    });
    assert.equal(invalidSnapshotBeforeBinding.status, 400);
    assert.equal(asRecord(asRecord(invalidSnapshotBeforeBinding.body).error).code, "field_property_unsupported:content");

    const bindingMismatch = await postJson(port, `/threads/${threadId}/turns`, {
      ...taskTurnRequest,
      idempotency_key: "api-thread-submit-mismatch",
      run_id: "run_api_thread_mismatch",
      harbor: { identity_environment_ref: "identity-env:other" }
    });
    assert.equal(bindingMismatch.status, 409);
    assert.equal(asRecord(asRecord(bindingMismatch.body).error).code, "thread_binding_mismatch");

    const reserved = await taskThreadStore.reserveTaskTurn(threadId, {
      idempotency_key: "api-thread-interrupted",
      request_hash: "interrupted-hash",
      run_id: "run_api_thread_interrupted",
      creation_channel: "api",
      package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      input: {
        schema_version: taskTurnInputSchemaVersion,
        fields: [{ field_id: "url", kind: "url", summary: "https://example.org/" }]
      }
    });
    assert.equal(reserved.turn.status, "submitting");
    const terminateResponse = await postJson(port, `/threads/${threadId}/turns/${reserved.turn.turn_id}/terminate`);
    assert.equal(terminateResponse.status, 409);
    assert.equal(asRecord(asRecord(terminateResponse.body).error).code, "turn_run_still_active");

    const threadResponse = await getJson(port, `/threads/${threadId}`);
    assert.equal(threadResponse.status, 200);
    const threadView = asRecord(asRecord(threadResponse.body).thread);
    assert.deepEqual((threadView.turns as unknown[]).map((turn) => asRecord(turn).sequence), [1, 2]);
    const threadList = asRecord(await getJson(port, "/threads").then((result) => result.body));
    assert.equal((threadList.threads as unknown[]).length, 1);

    assert.deepEqual(await getJson(port, "/missing"), {
      status: 404,
      body: {
        error: {
          code: "not_found",
          message: "Route not found"
        }
      }
    });

    await assertRuntimeTaskSubmitApi();
    await assertTaskThreadApiRaces();
    await assertExecutionPolicyApi();
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
