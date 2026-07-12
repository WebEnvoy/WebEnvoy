import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, runLifecycleTransitions, type RunRecord } from "./run-record-store.js";
import { type HarborBrowserProviderCatalog, type HarborCoreRuntimeFacts, type HarborCoreSceneReference, type HarborIdentityEnvironmentFacts, type HarborResourceFacts, type HarborWritePrecheckFacts } from "./harbor-admission.js";
import { type LodePackageAdmissionContract } from "./lode-admission.js";
import { completeRunWithFailure, completeRunWithPreviewResult, completeRunWithResult } from "./result-envelope.js";
import { approvalCancellationQuerySchemaVersion, getApprovalCancellationSummary, getRunSummary, projectRunSummary, runQuerySchemaVersion } from "./run-query.js";
import { getRunEvidenceRefs, getRunResult, projectRunResult } from "./result-query.js";
import { acceptReadOnlyTaskSubmission } from "./task-submission.js";
import { capabilityRunQuerySchemaVersion, getCapabilityRunSummary } from "./capability-query.js";
import { assertRealSiteReadOnlyTaskExecution } from "./real-site-readonly-self-check.js";
import { assertRealSiteReadOnlyResultProjection } from "./real-site-readonly-result-self-check.js";
import { assertRealRunQueryEvidence } from "./real-run-query-self-check.js";
import { assertRealSiteWritePreviewResults } from "./real-site-write-preview-self-check.js";
import { claimDetailTarget, commitDetailTargetReservation, compensatePublishedSearchDetailTargets, detailTargetTtlMs, inspectDetailTarget, persistSearchDetailTargets, publishSearchDetailTargets, recoverPublishedSearchDetailTargetReservations, releaseDetailTargetReservation, reserveDetailTarget, rollbackSearchDetailTargets, stageSearchDetailTargets } from "./detail-target-store.js";
import { createHttpHarborRuntimeClient } from "./runtime-task-chain.js";

let tick = 0;

async function assertDetailTargetStore(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-detail-target-"));
  const observedAt = new Date("2026-07-12T00:00:00.000Z");
  const refs = {
    positive: "detail_ref_11111111-1111-4111-8111-111111111111",
    crossIdentity: "detail_ref_22222222-2222-4222-8222-222222222222",
    crossSession: "detail_ref_33333333-3333-4333-8333-333333333333",
    expired: "detail_ref_44444444-4444-4444-8444-444444444444"
  };
  const expected = {
    site_slug: "xiaohongshu" as const,
    identity_environment_ref: "identity-env-detail",
    runtime_session_ref: "session-detail"
  };
  try {
    const input = {
      ...expected,
      detail_refs: Object.values(refs),
      search_run_ref: "run-search-detail",
      search_result_ref: "result-search-detail",
      observed_at: observedAt.toISOString()
    };
    const batch = await stageSearchDetailTargets(directory, input, observedAt);
    assert.deepEqual(await inspectDetailTarget(directory, refs.positive, expected, observedAt), { ok: false, code: "detail_ref_unknown" });
    await publishSearchDetailTargets(batch);
    assert.deepEqual(await claimDetailTarget(directory, "detail_ref_forged", { ...expected, detail_run_ref: "run-forged" }, observedAt), { ok: false, code: "detail_ref_unknown" });
    assert.deepEqual(await claimDetailTarget(directory, refs.crossIdentity, { ...expected, identity_environment_ref: "identity-env-other", detail_run_ref: "run-cross-identity" }, observedAt), { ok: false, code: "detail_ref_binding_mismatch" });
    assert.deepEqual(await claimDetailTarget(directory, refs.crossSession, { ...expected, runtime_session_ref: "session-other", detail_run_ref: "run-cross-session" }, observedAt), { ok: false, code: "detail_ref_binding_mismatch" });
    const claimed = await claimDetailTarget(directory, refs.positive, { ...expected, detail_run_ref: "run-detail" }, observedAt);
    assert.equal(claimed.ok, true);
    if (claimed.ok) {
      assert.equal(claimed.binding.search_run_ref, "run-search-detail");
      assert.equal(claimed.binding.search_result_ref, "result-search-detail");
    }
    assert.deepEqual(await claimDetailTarget(directory, refs.positive, { ...expected, detail_run_ref: "run-replay" }, observedAt), { ok: false, code: "detail_ref_already_consumed" });
    assert.deepEqual(
      await claimDetailTarget(directory, refs.expired, { ...expected, detail_run_ref: "run-expired" }, new Date(observedAt.getTime() + detailTargetTtlMs)),
      { ok: false, code: "detail_ref_expired" }
    );
    await assert.rejects(() => persistSearchDetailTargets(directory, { ...input, search_run_ref: "run-republish", detail_refs: [refs.positive] }, observedAt), /already exists/);

    const rollbackRef = "detail_ref_55555555-5555-4555-8555-555555555555";
    const rollbackBatch = await stageSearchDetailTargets(directory, { ...input, search_run_ref: "run-rollback", detail_refs: [rollbackRef] }, observedAt);
    const [claimWhileStaged] = await Promise.all([
      claimDetailTarget(directory, rollbackRef, { ...expected, detail_run_ref: "run-concurrent-claim" }, observedAt),
      rollbackSearchDetailTargets(rollbackBatch)
    ]);
    assert.deepEqual(claimWhileStaged, { ok: false, code: "detail_ref_unknown" });
    assert.deepEqual(await inspectDetailTarget(directory, rollbackRef, expected, observedAt), { ok: false, code: "detail_ref_unknown" });

    const concurrentRef = "detail_ref_66666666-6666-4666-8666-666666666666";
    await persistSearchDetailTargets(directory, { ...input, search_run_ref: "run-concurrent", detail_refs: [concurrentRef] }, observedAt);
    const concurrentClaims = await Promise.all([
      claimDetailTarget(directory, concurrentRef, { ...expected, detail_run_ref: "run-claim-a" }, observedAt),
      claimDetailTarget(directory, concurrentRef, { ...expected, detail_run_ref: "run-claim-b" }, observedAt)
    ]);
    assert.equal(concurrentClaims.filter((claim) => claim.ok).length, 1);
    assert.equal(concurrentClaims.filter((claim) => !claim.ok && claim.code === "detail_ref_already_consumed").length, 1);

    const reservableRef = "detail_ref_99999999-9999-4999-8999-999999999999";
    await persistSearchDetailTargets(directory, { ...input, search_run_ref: "run-reservable", detail_refs: [reservableRef] }, observedAt);
    const reservation = await reserveDetailTarget(directory, reservableRef, { ...expected, detail_run_ref: "run-reserve-a" }, observedAt);
    assert.equal(reservation.ok, true);
    assert.deepEqual(await reserveDetailTarget(directory, reservableRef, { ...expected, detail_run_ref: "run-reserve-b" }, observedAt), { ok: false, code: "detail_ref_already_consumed" });
    if (!reservation.ok) throw new Error("detail target reservation failed");
    // Unknown outcomes intentionally retain this reservation until reconciliation.
    assert.equal((await inspectDetailTarget(directory, reservableRef, expected, observedAt)).ok, true);
    await releaseDetailTargetReservation(reservation.reservation);
    const retryReservation = await reserveDetailTarget(directory, reservableRef, { ...expected, detail_run_ref: "run-reserve-retry" }, observedAt);
    if (!retryReservation.ok) throw new Error("released detail target could not be reserved again");
    assert.equal((await commitDetailTargetReservation(retryReservation.reservation, observedAt)).ok, true);
    assert.deepEqual(await claimDetailTarget(directory, reservableRef, { ...expected, detail_run_ref: "run-reserve-replay" }, observedAt), { ok: false, code: "detail_ref_already_consumed" });

    const compensatedRef = "detail_ref_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const compensatedBatch = await stageSearchDetailTargets(directory, { ...input, search_run_ref: "run-compensate", detail_refs: [compensatedRef] }, observedAt);
    await publishSearchDetailTargets(compensatedBatch);
    assert.equal((await inspectDetailTarget(directory, compensatedRef, expected, observedAt)).ok, true);
    await compensatePublishedSearchDetailTargets(compensatedBatch);
    assert.deepEqual(await inspectDetailTarget(directory, compensatedRef, expected, observedAt), { ok: false, code: "detail_ref_unknown" });
    await assert.rejects(() => compensatePublishedSearchDetailTargets({ directory, batch_id: "../../outside" }), /batch is invalid/);

    const cleanupRef = "detail_ref_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const cleanupBatch = await stageSearchDetailTargets(directory, { ...input, search_run_ref: "run-cleanup-recovery", detail_refs: [cleanupRef] }, observedAt);
    const cleanupReservation = join(directory, ".detail-targets", "reservations", createHash("sha256").update(cleanupRef).digest("hex"));
    await unlink(cleanupReservation);
    await mkdir(cleanupReservation);
    await publishSearchDetailTargets(cleanupBatch);
    assert.equal((await inspectDetailTarget(directory, cleanupRef, expected, observedAt)).ok, true);
    await rm(cleanupReservation, { recursive: true, force: true });
    await recoverPublishedSearchDetailTargetReservations(cleanupBatch);
    await compensatePublishedSearchDetailTargets(cleanupBatch);

    await assert.rejects(() => stageSearchDetailTargets(directory, { ...input, search_run_ref: "run-sensitive", search_result_ref: "https://example.test/xsec_token", detail_refs: ["detail_ref_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] }, observedAt), /search result ref is invalid/);

    const skewRef = "detail_ref_77777777-7777-4777-8777-777777777777";
    await assert.rejects(() => stageSearchDetailTargets(directory, { ...input, search_run_ref: "run-stale", detail_refs: [skewRef], observed_at: new Date(observedAt.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() }, observedAt), /skew/);
    await assert.rejects(() => stageSearchDetailTargets(directory, { ...input, search_run_ref: "run-future", detail_refs: [skewRef], observed_at: new Date(observedAt.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString() }, observedAt), /skew/);
    const consumedDirectory = join(directory, ".detail-targets", "consumed");
    const persisted = (await Promise.all((await readdir(consumedDirectory)).map((name) => readFile(join(consumedDirectory, name), "utf8")))).join("\n");
    assert(!/(https?:\/\/|xsec|cookie|token|raw_dom|raw_har)/i.test(persisted));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const symlinkDirectory = await mkdtemp(join(tmpdir(), "webenvoy-detail-target-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "webenvoy-detail-target-outside-"));
  try {
    await symlink(outside, join(symlinkDirectory, ".detail-targets"));
    await assert.rejects(() => persistSearchDetailTargets(symlinkDirectory, {
      site_slug: "xiaohongshu", identity_environment_ref: "identity", runtime_session_ref: "session",
      search_run_ref: "run-symlink", search_result_ref: "result-symlink",
      detail_refs: ["detail_ref_88888888-8888-4888-8888-888888888888"], observed_at: observedAt.toISOString()
    }, observedAt), /secure directory/);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(symlinkDirectory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

async function assertDetailRequestOmitsRawUrl(): Promise<void> {
  let body = "";
  const previousToken = process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
  process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = "core-detail-self-check-token";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unavailable" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const client = createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    await client.executeReadOperation({
      runtime_session_ref: "session-detail", site_id: "xiaohongshu", operation_id: "xhs_read_note_detail",
      detail_ref: "detail_ref_99999999-9999-4999-8999-999999999999", url: "https://www.xiaohongshu.com/explore/forbidden"
    });
    assert.equal(JSON.parse(body).url, undefined);
  } finally {
    if (previousToken === undefined) delete process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
    else process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = previousToken;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 0, 0, tick));
  tick += 1;
  return instant;
}

const lodeReadPublicPageContract = {
  package_ref: "lode://site-capability/example/read-public-page@0.1.0",
  source_ref: "lode://site-capability/example/read-public-page@0.1.0",
  lock_ref: "lode://lock/site-capability/example/read-public-page@0.1.0",
  capability_id: "read-public-page",
  operation_id: "content_detail_by_url",
  operation_mode: "read",
  version: "0.1.0",
  lifecycle: "proposed",
  resource_requirements: {
    schema_version: "lode.resource-requirements.v0",
    resource_requirements_id: "example.read-public-page.resources",
    resource_requirements_version: "0.1.0",
    package_ref: "lode://site-capability/example/read-public-page@0.1.0",
    operation_mode: "read",
    resource_requirement_profiles: [
      {
        requirement_profile_id: "public-page-read-with-snapshot-refmap-evidence",
        operation_boundary: "read",
        required_harbor_facts: [
          { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "runtime.public_https_navigation.allowed", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "snapshot.document_summary.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "refmap.source_refs.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true, freshness: "current_execution_window" }
        ]
      }
    ]
  }
} satisfies LodePackageAdmissionContract;

const harborRuntimeBindingRefs = [
  "session_fixture_ready",
  "profile_fixture_public",
  "provider_fixture_local",
  "viewer_fixture_readonly",
  "identity-env_fixture",
  "identity-env_fixture:execution",
  "snapshot_fixture_example",
  "refmap_fixture_example",
  "source_trace_fixture_example"
];
const harborEvidenceRefs = ["evidence_fixture_snapshot", "evidence_fixture_source_trace", "evidence_fixture_refmap"];

const harborRuntimeFacts = {
  schema_version: "harbor-core-runtime-facts/v0",
  runtime_session_ref: "session_fixture_ready",
  identity_environment_ref: "identity-env_fixture",
  execution_identity_ref: "identity-env_fixture:execution",
  profile_ref: "profile_fixture_public",
  provider_ref: "provider_fixture_local",
  provider_mode: "local_dedicated_profile",
  lifecycle_state: "active",
  availability: {
    cdp: "available",
    viewer: "unsupported",
    snapshot: "available",
    evidence: "available"
  },
  viewer: {
    viewer_ref: "viewer_fixture_readonly",
    availability: "unsupported",
    access_mode: "none",
    expires_at: "2026-07-01T01:00:00.000Z"
  },
  control: {
    owner: "system",
    handoff_reason: null,
    takeover: {
      available: false,
      unavailable_reason: "viewer_unavailable"
    },
    updated_at: "2026-07-01T00:00:00.000Z"
  },
  current_error: null,
  fact_refs: {
    session: "session_fixture_ready",
    viewer: "viewer_fixture_readonly"
  },
  unavailable: null
} satisfies HarborCoreRuntimeFacts;

const harborIdentityEnvironmentFacts = {
  schema_version: "harbor-local-identity-environment/v0",
  identity_environment_ref: "identity-env_fixture",
  execution_identity_ref: "identity-env_fixture:execution",
  profile_ref: "profile_fixture_public",
  site_binding: {
    site_id: "example",
    origin: "https://example.org"
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
} satisfies HarborIdentityEnvironmentFacts;

const harborProviderStatus = {
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

const harborResourceFacts = {
  schema_version: "harbor-core-resource-facts/v0",
  resource_facts: [
    { fact_key: "runtime.public_https_navigation.allowed", state: "available" },
    { fact_key: "runtime.execution_surface.available", state: "available" },
    { fact_key: "snapshot.document_summary.available", state: "available" },
    { fact_key: "refmap.source_refs.available", state: "available" },
    { fact_key: "evidence.snapshot_ref.available", state: "available" }
  ],
  consumer_boundary: "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material."
} satisfies HarborResourceFacts;

const harborSceneRef = {
  schema_version: "harbor-page-scene-refs/v0",
  runtime_session_ref: "session_fixture_ready",
  snapshot_ref: "snapshot_fixture_example",
  refmap_ref: "refmap_fixture_example",
  evidence_refs: harborEvidenceRefs,
  source_trace_ref: "source_trace_fixture_example",
  captured_at: "2026-07-01T00:00:00.000Z",
  page_summary: {
    title: "Example Domain",
    url: "https://example.org/",
    summary: "Reserved public Example Domain fixture summary."
  },
  unavailable: null
} satisfies HarborCoreSceneReference;

const lodePreviewContactFormContract = {
  package_ref: "lode://site-capability/example/preview-contact-form@0.1.0",
  source_ref: "lode://site-capability/example/preview-contact-form@0.1.0",
  lock_ref: "lode://lock/site-capability/example/preview-contact-form@0.1.0",
  capability_id: "preview-contact-form",
  operation_id: "contact_form_preview",
  operation_mode: "validate_only",
  version: "0.1.0",
  lifecycle: "proposed",
  resource_requirements: {
    schema_version: "lode.resource-requirements.v0",
    resource_requirements_id: "example.preview-contact-form.resources",
    resource_requirements_version: "0.1.0",
    package_ref: "lode://site-capability/example/preview-contact-form@0.1.0",
    operation_mode: "validate_only",
    resource_requirement_profiles: [
      {
        requirement_profile_id: "public-page-read-with-snapshot-refmap-evidence",
        operation_boundary: "validate_only",
        required_harbor_facts: [
          { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "snapshot.document_summary.available", owner: "Harbor", required: true, freshness: "current_execution_window" },
          { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true, freshness: "current_execution_window" }
        ]
      }
    ]
  }
} satisfies LodePackageAdmissionContract;

const harborWritePrecheckFacts = {
  schema_version: "harbor-write-precheck-facts/v0",
  runtime_session_ref: "session_fixture_ready",
  provider_ref: "provider_fixture_local",
  profile_ref: "profile_fixture_public",
  writable_target: {
    target_ref: "target:fixture/contact-form",
    runtime_session_ref: "session_fixture_ready",
    snapshot_ref: "snapshot_fixture_write_precheck",
    refmap_ref: "refmap_fixture_write_precheck",
    evidence_refs: ["evidence_fixture_write_precheck"]
  },
  form_state: {
    snapshot_ref: "snapshot_fixture_write_precheck",
    fields: [
      {
        field_ref: "field:fixture/message",
        target_ref: "target:fixture/contact-form",
        label: "Message",
        input_kind: "textarea",
        required: true,
        sensitivity: "public",
        export_policy: "safe_summary",
        value_state: "empty"
      }
    ],
    state_summary: "One public message field is visible; no raw input values are exported."
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
} satisfies HarborWritePrecheckFacts;

function baseInput(runId: string) {
  return {
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
      runtime_binding_refs: harborRuntimeBindingRefs,
      evidence_refs: harborEvidenceRefs,
      resource_match_ref: "resource-match:fixture/ready"
    }
  } as const;
}

async function readTaskIntentFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL("../../schemas/fixtures/read-only-submit.fixture.json", import.meta.url), "utf8")) as Record<string, unknown>;
}

function assertRefsOnly(record: RunRecord): void {
  assert(!Object.hasOwn(record, "raw_payload"), "Run Record must not inline raw_payload");
  assert(!Object.hasOwn(record, "dom"), "Run Record must not inline DOM");
  assert(!Object.hasOwn(record, "screenshot"), "Run Record must not inline screenshots");
  assert(!Object.hasOwn(record, "cookie"), "Run Record must not inline cookies");
  assert(!Object.hasOwn(record, "token"), "Run Record must not inline tokens");
  assert(!Object.hasOwn(record, "cdp_ref"), "Run Record must not inline CDP refs");
  assert(!Object.hasOwn(record, "viewer_url"), "Run Record must not inline viewer URLs");
}

async function assertTaskSubmissionAdmission(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-task-submission-"));
  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const taskIntent = await readTaskIntentFixture();
    const accepted = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_submit_accepted",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      resource_match_ref: "resource-match:fixture/ready",
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: harborSceneRef,
      harbor_resource_facts: harborResourceFacts
    });

    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      throw new Error("read-only submission must be accepted");
    }
    assert.equal(accepted.run_record.status, "admitted");
    assert.equal(accepted.run_record.admission.decision, "accepted");
    assert.equal(accepted.run_record.task_intent_ref, "intent_fixture_read_only_001");
    assert.equal(accepted.run_record.capability_ref, "lode:capability/read-public-page");
    assert.equal(accepted.run_record.capability_version, "0.1.0");
    assert.equal(accepted.run_record.capability_source_ref, lodeReadPublicPageContract.source_ref);
    assert.equal(accepted.run_record.capability_lock_ref, lodeReadPublicPageContract.lock_ref);
    assert.equal(accepted.run_record.package_ref, lodeReadPublicPageContract.package_ref);
    assert.deepEqual(accepted.run_record.admission.resource_requirement_refs, ["example.read-public-page.resources"]);
    assert.deepEqual(accepted.run_record.admission.runtime_binding_refs, harborRuntimeBindingRefs);
    assert.deepEqual(accepted.run_record.admission.evidence_refs, harborEvidenceRefs);
    assert.equal(accepted.run_record.admission.runtime_session_binding?.identity_environment_ref, "identity-env_fixture");
    assert.equal(accepted.run_record.admission.runtime_session_binding?.runtime_session_ref, "session_fixture_ready");
    assert.equal(accepted.run_record.admission.runtime_session_binding?.session_use, "direct_session");
    assert.equal(JSON.stringify(accepted.run_record).includes("cookie_value"), false);
    assert.deepEqual(accepted.run_record.runtime_binding_refs, harborRuntimeBindingRefs);
    assert.deepEqual(accepted.run_record.evidence_refs, harborEvidenceRefs);
    assert.deepEqual(await store.getRunRecord("run_self_check_submit_accepted"), accepted.run_record);

    const missingRuntime = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_harbor_missing_runtime",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus
    });
    assert.equal(missingRuntime.ok, false);
    assert.equal(missingRuntime.failure.code, "runtime_ref_missing");
    assert.equal(missingRuntime.run_record?.status, "failed");

    const captureDenied = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_harbor_capture_denied",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: {
        status: "unavailable",
        failure_class: "capture_denied",
        retryable: false
      },
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(captureDenied.ok, false);
    assert.equal(captureDenied.failure.category, "evidence_reference");
    assert.equal(captureDenied.failure.code, "capture_denied");
    assert.deepEqual(captureDenied.run_record?.admission.runtime_binding_refs, harborRuntimeBindingRefs.slice(0, 6));

    const expiredIdentity = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_identity_expired",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_identity_environment_facts: {
        ...harborIdentityEnvironmentFacts,
        login_state: { state: "expired", recovery_required: true }
      },
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: harborSceneRef,
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(expiredIdentity.ok, false);
    assert.equal(expiredIdentity.failure.code, "identity_auth_required");
    assert.equal(expiredIdentity.run_record?.status, "requires_user_action");
    assert.equal(expiredIdentity.run_record?.admission.decision, "requires_user_action");

    const busySession = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_runtime_busy",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: {
        ...harborRuntimeFacts,
        control: {
          ...harborRuntimeFacts.control,
          owner: "agent",
          takeover: { available: false, unavailable_reason: "viewer_unavailable" }
        }
      },
      harbor_scene_ref: harborSceneRef,
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(busySession.ok, false);
    assert.equal(busySession.failure.code, "runtime_session_busy");
    assert.equal(busySession.run_record?.admission.runtime_session_binding?.session_use, "agent_direct_browsing");

    const rawEndpointRejected = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_raw_endpoint_rejected",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: {
        ...harborRuntimeFacts,
        cdp_endpoint: "ws://127.0.0.1/private"
      } as unknown as HarborCoreRuntimeFacts,
      harbor_scene_ref: harborSceneRef,
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(rawEndpointRejected.ok, false);
    assert.equal(rawEndpointRejected.failure.code, "forbidden_field:cdp_endpoint");
    assert.equal(await store.getRunRecord("run_self_check_raw_endpoint_rejected"), undefined);

    const invalid = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_submit_invalid",
      task_intent: {
        ...taskIntent,
        token: "must-not-enter-core"
      }
    });
    assert.equal(invalid.ok, false);
    if (invalid.ok) {
      throw new Error("private-field submission must fail");
    }
    assert.equal(invalid.failure.code, "private_field_rejected:token");
    assert.equal(await store.getRunRecord("run_self_check_submit_invalid"), undefined);

    const submitActionRequest = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_true_write_deferred",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_fixture_submit_deferred_001",
        policy: {
          risk: "submit",
          execution_intent: "execute_after_approval"
        }
      },
      package_ref: lodeReadPublicPageContract.package_ref
    });
    assert.equal(submitActionRequest.ok, false);
    assert.equal(submitActionRequest.failure.category, "action_risk");
    assert.equal(submitActionRequest.failure.code, "true_write_deferred");
    assert.equal(submitActionRequest.failure.recovery_hint, "use_validate_or_preview");
    assert.equal(submitActionRequest.run_record?.status, "failed");
    assert.equal(submitActionRequest.run_record?.admission.decision, "deferred_true_write");
    assert.equal(submitActionRequest.run_record?.admission.action_risk, "submit");
    assert.equal(submitActionRequest.run_record?.package_ref, lodeReadPublicPageContract.package_ref);
    assert.equal(submitActionRequest.run_record?.action_request?.operation_mode, "blocked_true_write");
    assert.equal(submitActionRequest.run_record?.action_request?.risk_classification.level, "blocked");
    assert.equal(submitActionRequest.run_record?.action_request?.no_submit_guard.status, "active");
    const submitQuery = await getRunResult(store, "run_self_check_true_write_deferred");
    assert.equal(submitQuery.ok, true);
    if (!submitQuery.ok) {
      throw new Error("true-write guardrail run must be queryable");
    }
    assert.equal(submitQuery.result.failure?.code, "true_write_deferred");
    assert.equal(submitQuery.result.result.result_envelope?.ok, false);
    assert.equal(submitQuery.result.result.result_envelope?.failure?.category, "action_risk");

    const validateOnlyActionRequest = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_validate_only_admitted",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_fixture_validate_only_001",
        capability: {
          ref: "lode:capability/preview-contact-form",
          version: "0.1.0",
          source_ref: lodePreviewContactFormContract.source_ref,
          lock_ref: lodePreviewContactFormContract.lock_ref
        },
        resource_requirement_refs: ["example.preview-contact-form.resources"],
        policy: {
          risk: "write",
          execution_intent: "validate_only"
        }
      },
      package_ref: lodePreviewContactFormContract.package_ref,
      lode_package_contract: lodePreviewContactFormContract,
      resource_match_ref: "resource-match:fixture/write-precheck-ready",
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_write_precheck_facts: harborWritePrecheckFacts,
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(validateOnlyActionRequest.ok, true);
    if (!validateOnlyActionRequest.ok) {
      throw new Error("validate-only action request must be admitted");
    }
    assert.equal(validateOnlyActionRequest.run_record.status, "admitted");
    assert.equal(validateOnlyActionRequest.run_record.admission.decision, "accepted_with_warnings");
    assert.equal(validateOnlyActionRequest.run_record.admission.action_risk, "write");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.schema_version, "webenvoy.action-request.v0");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.operation_mode, "validate_only");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.risk_classification.level, "low");
    assert.equal(validateOnlyActionRequest.run_record.action_request?.risk_classification.true_write_requested, false);
    assert.equal(validateOnlyActionRequest.run_record.action_request?.no_submit_guard.status, "active");
    assert.deepEqual(validateOnlyActionRequest.run_record.action_request?.no_submit_guard.blocked_execution_intents, ["execute_after_approval", "reconcile_status", "request_cancel"]);
    assert.equal(validateOnlyActionRequest.run_record.action_request?.target_refs?.writable_target_ref, "target:fixture/contact-form");
    assert.deepEqual(validateOnlyActionRequest.run_record.evidence_refs, ["evidence_fixture_write_precheck"]);
    const actionRequest = validateOnlyActionRequest.run_record.action_request;
    assert(actionRequest, "validate-only run must carry action request");
    const approvalEvidenceRefs = [...(actionRequest.evidence_refs ?? [])];
    const approvalRunBase = {
      task_intent_ref: actionRequest.task_intent_ref,
      entrypoint_ref: "entrypoint:app",
      capability_ref: actionRequest.capability_ref,
      ...(actionRequest.capability_version === undefined ? {} : { capability_version: actionRequest.capability_version }),
      ...(actionRequest.capability_source_ref === undefined ? {} : { capability_source_ref: actionRequest.capability_source_ref }),
      ...(actionRequest.capability_lock_ref === undefined ? {} : { capability_lock_ref: actionRequest.capability_lock_ref }),
      ...(actionRequest.package_ref === undefined ? {} : { package_ref: actionRequest.package_ref })
    };
    const approvalRequest = {
      schema_version: "webenvoy.approval-request.v0" as const,
      approval_request_id: "approval-request:fixture/preview-contact-form",
      action_request_id: actionRequest.action_request_id,
      task_intent_ref: actionRequest.task_intent_ref,
      status: "pending" as const,
      requested_at: "2026-07-01T00:00:10.000Z",
      expires_at: "2026-07-01T00:10:10.000Z",
      risk: "write" as const,
      blocking_reasons: ["approval_required_before_submit"],
      source_refs: actionRequest.no_submit_guard.source_refs,
      evidence_refs: approvalEvidenceRefs,
      consumer_boundary: "Core stores approval state and refs only; this is not approval execution or submitted result evidence."
    };
    const pendingApproval = await store.createRunRecord({
      run_id: "run_self_check_approval_pending",
      status: "requires_user_action",
      ...approvalRunBase,
      admission: {
        decision: "requires_user_action",
        action_risk: "write",
        evidence_refs: approvalEvidenceRefs
      },
      action_request: actionRequest,
      approval_request: approvalRequest,
      evidence_refs: approvalEvidenceRefs,
      retention_state: "active"
    });
    assert.equal(pendingApproval.status, "requires_user_action");
    assert.equal(pendingApproval.approval_request?.status, "pending");

    await store.createRunRecord({
      run_id: "run_self_check_approval_expired",
      status: "expired",
      ...approvalRunBase,
      admission: { decision: "requires_user_action", action_risk: "write" },
      action_request: actionRequest,
      approval_request: { ...approvalRequest, approval_request_id: "approval-request:fixture/expired", status: "expired", expires_at: "2026-07-01T00:00:00.000Z" },
      retention_state: "active"
    });
    await store.createRunRecord({
      run_id: "run_self_check_approval_blocked",
      status: "failed",
      ...approvalRunBase,
      admission: { decision: "blocked_pre_admission", action_risk: "write" },
      action_request: actionRequest,
      approval_request: { ...approvalRequest, approval_request_id: "approval-request:fixture/blocked", status: "blocked", blocking_reasons: ["approval_blocked_by_policy"] },
      failure: {
        category: "action_risk",
        code: "approval_blocked",
        phase: "admission",
        recovery_hint: "show_blocked_approval_state"
      },
      retention_state: "active"
    });
    const cancelledApproval = await store.createRunRecord({
      run_id: "run_self_check_approval_cancelled",
      status: "cancelled",
      ...approvalRunBase,
      admission: { decision: "requires_user_action", action_risk: "write" },
      action_request: actionRequest,
      failure: {
        category: "action_risk",
        code: "user_cancelled",
        phase: "admission",
        recovery_hint: "record_cancellation_without_submit"
      },
      retention_state: "active"
    });
    assert.equal(cancelledApproval.status, "cancelled");
    const approvalQuery = await getApprovalCancellationSummary(store, actionRequest.action_request_id);
    assert.equal(approvalQuery.schema_version, approvalCancellationQuerySchemaVersion);
    assert.equal(approvalQuery.latest_status, "cancelled");
    assert.equal(approvalQuery.approval_requests.length, 3);
    assert.equal(approvalQuery.cancellations[0]?.failure_code, "user_cancelled");
    assert.equal(JSON.stringify(approvalQuery).includes("submitted_result_ref"), false);

    const previewRunBase = {
      ...approvalRunBase,
      admission: {
        decision: "accepted_with_warnings" as const,
        action_risk: "write" as const,
        evidence_refs: approvalEvidenceRefs
      },
      action_request: actionRequest,
      evidence_refs: approvalEvidenceRefs,
      retention_state: "active" as const
    };
    await store.createRunRecord({
      run_id: "run_self_check_preview_available",
      status: "admitted",
      ...previewRunBase
    });
    await store.updateRunRecord("run_self_check_preview_available", { status: "running", evidence_refs: approvalEvidenceRefs });
    const preview = await completeRunWithPreviewResult(store, "run_self_check_preview_available", {
      result_ref: "result:fixture/preview-contact-form",
      expected_change: {
        change_kind: "form_input_preview",
        target_ref: "target:fixture/contact-form",
        external_submit: false
      },
      evidence_refs: approvalEvidenceRefs
    });
    assert.equal(preview.result_envelope.ok, true);
    assert.equal(preview.result_envelope.result_kind, "validate_only_preview");
    assert.equal(preview.result_envelope.preview_result?.submitted, false);
    assert.equal(preview.result_envelope.preview_result?.state, "available");
    assert.equal(preview.result_envelope.preview_result?.action_refs.action_request_id, actionRequest.action_request_id);
    assert.equal(preview.result_envelope.preview_result?.capability.capability_version, "0.1.0");
    assert.equal(JSON.stringify(preview.result_envelope).includes("submitted_result"), false);
    const previewQuery = await getRunResult(store, "run_self_check_preview_available");
    assert.equal(previewQuery.ok, true);
    if (!previewQuery.ok) throw new Error("preview result must be queryable");
    assert.equal(previewQuery.result.result.result_envelope?.preview_result?.submitted, false);

    await store.createRunRecord({
      run_id: "run_self_check_preview_page_changed",
      status: "admitted",
      ...previewRunBase
    });
    await store.updateRunRecord("run_self_check_preview_page_changed", { status: "running", evidence_refs: ["evidence:fixture/page-changed"] });
    const pageChanged = await completeRunWithPreviewResult(store, "run_self_check_preview_page_changed", {
      result_ref: "result:fixture/preview-page-changed",
      preview_state: "page_changed",
      evidence_refs: ["evidence:fixture/page-changed"]
    });
    assert.equal(pageChanged.run_record.status, "failed");
    assert.equal(pageChanged.result_envelope.preview_result?.failure_class, "page_changed");
    assert.equal(pageChanged.result_envelope.failure?.code, "page_changed");

    await store.createRunRecord({
      run_id: "run_self_check_preview_user_cancelled",
      status: "admitted",
      ...previewRunBase
    });
    await store.updateRunRecord("run_self_check_preview_user_cancelled", { status: "running", evidence_refs: approvalEvidenceRefs });
    const userCancelled = await completeRunWithPreviewResult(store, "run_self_check_preview_user_cancelled", {
      result_ref: "result:fixture/preview-user-cancelled",
      preview_state: "user_cancelled",
      evidence_refs: approvalEvidenceRefs
    });
    assert.equal(userCancelled.run_record.status, "cancelled");
    assert.equal(userCancelled.result_envelope.outcome, "cancelled");
    assert.equal(userCancelled.result_envelope.preview_result?.failure_class, "user_cancelled");
    assert.equal(userCancelled.result_envelope.failure?.code, "user_cancelled");

    const brokenResourceContract = {
      ...lodeReadPublicPageContract,
      resource_requirements: {
        ...lodeReadPublicPageContract.resource_requirements,
        package_ref: "lode://site-capability/example/other@0.1.0"
      }
    };
    const invalidContract = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_invalid_contract",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: brokenResourceContract
    });
    assert.equal(invalidContract.ok, false);
    if (invalidContract.ok || !invalidContract.run_record) {
      throw new Error("invalid Lode contract must create a failed Run Record");
    }
    assert.equal(invalidContract.failure.code, "invalid_contract");
    assert.equal(invalidContract.run_record.status, "failed");
    assert.equal(invalidContract.run_record.failure?.category, "capability_contract");
    assert.deepEqual(await store.getRunRecord("run_self_check_lode_invalid_contract"), invalidContract.run_record);

    const lockMismatch = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_lock_mismatch",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_fixture_lock_mismatch_001",
        capability: {
          ...(taskIntent.capability as Record<string, unknown>),
          lock_ref: "lode://lock/site-capability/example/read-public-page@0.0.9"
        }
      },
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract
    });
    assert.equal(lockMismatch.ok, false);
    assert.equal(lockMismatch.failure.code, "package_lock_mismatch");

    const brokenLifecycle = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_broken_lifecycle",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: {
        ...lodeReadPublicPageContract,
        lifecycle: "broken"
      }
    });
    assert.equal(brokenLifecycle.ok, false);
    assert.equal(brokenLifecycle.failure.code, "capability_broken");
    assert.equal(brokenLifecycle.failure.attribution, "capability");

    const disabledBossPackageRef = "lode://site-capability/boss/job-search@0.1.0";
    const disabledBoss = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_boss_runtime_admission_disabled",
      task_intent: {
        ...taskIntent,
        intent_id: "intent_self_check_boss_runtime_admission_disabled",
        capability: {
          ref: "lode:capability/read-public-page",
          version: "0.1.0",
          source_ref: disabledBossPackageRef
        }
      },
      package_ref: disabledBossPackageRef,
      lode_package_contract: {
        ...lodeReadPublicPageContract,
        package_ref: disabledBossPackageRef,
        source_ref: disabledBossPackageRef,
        runtime_admission: {
          enabled: false,
          status: "deferred_experimental",
          recheck_condition: "deferred_milestone_scope_restored_with_current_head_review_and_runtime_live_evidence"
        },
        resource_requirements: {
          ...lodeReadPublicPageContract.resource_requirements,
          package_ref: disabledBossPackageRef
        }
      }
    });
    assert.equal(disabledBoss.ok, false);
    assert.equal(disabledBoss.failure.category, "capability_contract");
    assert.equal(disabledBoss.failure.code, "runtime_admission_disabled");
    assert.equal(disabledBoss.failure.recovery_hint, "wait_for_scope_activation");
    assert.equal(disabledBoss.run_record?.admission.decision, "blocked_pre_admission");
    assert.equal(disabledBoss.run_record?.result_ref, undefined);
    assert.deepEqual(disabledBoss.run_record?.evidence_refs ?? [], []);

    const writeContract = {
      ...lodeReadPublicPageContract,
      operation_mode: "write",
      resource_requirements: {
        ...lodeReadPublicPageContract.resource_requirements,
        operation_mode: "write"
      }
    };
    const writeRejected = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_lode_write_deferred",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: writeContract
    });
    assert.equal(writeRejected.ok, false);
    assert.equal(writeRejected.failure.code, "true_write_deferred");
    assert.equal(writeRejected.run_record?.status, "failed");
    assert.equal(writeRejected.run_record?.admission.decision, "deferred_true_write");
    assert.equal(writeRejected.run_record?.admission.action_risk, "write");

    const missingResourceFact = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_resource_fact_missing",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: {
        ...lodeReadPublicPageContract,
        resource_requirements: {
          ...lodeReadPublicPageContract.resource_requirements,
          resource_requirement_profiles: [
            {
              ...lodeReadPublicPageContract.resource_requirements.resource_requirement_profiles[0]!,
              required_harbor_facts: [
                ...lodeReadPublicPageContract.resource_requirements.resource_requirement_profiles[0]!.required_harbor_facts!,
                { fact_key: "page.real_fixture.ready", owner: "Harbor", required: true, freshness: "current_execution_window" }
              ]
            }
          ]
        }
      },
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: harborProviderStatus,
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: harborSceneRef,
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(missingResourceFact.ok, false);
    assert.equal(missingResourceFact.failure.code, "resource_fact_missing:page.real_fixture.ready");
    assert.equal(missingResourceFact.run_record?.status, "failed");

    const providerUnavailable = await acceptReadOnlyTaskSubmission(store, {
      run_id: "run_self_check_provider_unavailable",
      task_intent: taskIntent,
      package_ref: lodeReadPublicPageContract.package_ref,
      lode_package_contract: lodeReadPublicPageContract,
      harbor_identity_environment_facts: harborIdentityEnvironmentFacts,
      harbor_provider_status: {
        schema_version: "harbor-browser-provider-status/v0",
        providers: [
          {
            provider_id: "cloakbrowser",
            install: { status: "missing", launchability: "not_checked" }
          }
        ]
      },
      harbor_runtime_facts: harborRuntimeFacts,
      harbor_scene_ref: harborSceneRef,
      harbor_resource_facts: harborResourceFacts
    });
    assert.equal(providerUnavailable.ok, false);
    assert.equal(providerUnavailable.failure.code, "browser_provider_unavailable");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const directory = await mkdtemp(join(tmpdir(), "webenvoy-run-record-store-"));

try {
  const store = createFileRunRecordStore({ directory, clock: nextInstant });
  const runId = "run_self_check_read_001";

  const pending = await store.createRunRecord(baseInput(runId));
  assert.equal(pending.status, "pending");
  assert.equal(pending.schema_version, "webenvoy.run-record.v0");
  assert.deepEqual(runLifecycleTransitions.pending, ["admitted", "failed", "cancelled", "expired"]);
  await assert.rejects(() => store.updateRunRecord(runId, { status: "running" }), /illegal run status transition/);

  const admitted = await store.updateRunRecord(runId, {
    status: "admitted",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  assert.equal(admitted.status, "admitted");
  await assert.rejects(() => store.updateRunRecord(runId, { status: "succeeded", result_ref: "result:fixture/too-early" }), /illegal run status transition/);

  const running = await store.updateRunRecord(runId, {
    status: "running",
    evidence_refs: ["evidence:fixture/admission-ready", "evidence:fixture/run-started"]
  });
  assert.equal(running.status, "running");

  const completed = await completeRunWithResult(store, runId, {
    result_ref: "result:fixture/read-page-summary",
    result_kind: "content_detail",
    output_schema_id: "example.read-public-page.output",
    data: {
      title: "Example Domain",
      summary: "Reserved public Example Domain fixture summary."
    },
    projection_ref: "projection:fixture/read-page-summary",
    raw_payload_refs: ["raw-payload:fixture/redacted"],
    source_refs: ["source-trace:fixture/read-public-page"],
    evidence_refs: ["evidence:fixture/result-summary"],
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Required public title and summary fields were projected.",
      checked_at: "2026-07-01T00:00:03.000Z",
      evidence_refs: ["evidence:fixture/result-summary"],
      source_refs: ["source-trace:fixture/read-public-page"],
      consumer_boundary: "Core stores post-check refs and public status only."
    },
    retention_state: "active"
  });
  const succeeded = completed.run_record;
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.terminal_at, "2026-07-01T00:00:03.000Z");
  assert.equal(completed.result_envelope.ok, true);
  assert.equal(completed.result_envelope.outcome, "success");
  assert.equal(completed.result_envelope.run_record_ref, runId);
  assert.equal(completed.result_envelope.result_ref, succeeded.result_ref);
  assert.equal(completed.result_envelope.output_schema_id, "example.read-public-page.output");
  assertRefsOnly(succeeded);
  assert.deepEqual(projectRunSummary(succeeded), {
    schema_version: runQuerySchemaVersion,
    run_id: runId,
    status: "succeeded",
    timeline: {
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:03.000Z",
      terminal_at: "2026-07-01T00:00:03.000Z"
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
      binding_refs: harborRuntimeBindingRefs,
      admission_binding_refs: harborRuntimeBindingRefs
    },
    terminal_summary: {
      terminal: true,
      status: "succeeded",
      terminal_at: "2026-07-01T00:00:03.000Z",
      result_ref: "result:fixture/read-page-summary",
      post_check: {
        schema_version: "webenvoy.post-check-result.v0",
        status: "passed",
        summary: "Required public title and summary fields were projected.",
        checked_at: "2026-07-01T00:00:03.000Z"
      },
      retention_state: "active"
    }
  });

  const reloaded = await store.getRunRecord(runId);
  assert.deepEqual(reloaded, succeeded);
  assert.deepEqual(await getRunSummary(store, runId), {
    ok: true,
    run: projectRunSummary(succeeded)
  });
  const successResultQuery = projectRunResult(succeeded);
  assert.equal(successResultQuery.result.envelope_state, "available");
  assert.equal(successResultQuery.result.payload_state, "not_persisted_in_core");
  assert.equal(successResultQuery.result.result_envelope?.ok, true);
  assert.equal(successResultQuery.result.result_envelope?.result_ref, "result:fixture/read-page-summary");
  assert.deepEqual(
    successResultQuery.evidence_refs.map((ref) => ({
      ref: ref.ref,
      source: ref.source,
      state: ref.state,
      raw_access: ref.raw_access,
      capability_ref: ref.capability_ref,
      capability_version: ref.capability_version
    })),
    [
      ...harborEvidenceRefs.map((ref) => ({
        ref,
        source: "admission" as const,
        state: "available" as const,
        raw_access: "not_available_from_core" as const,
        capability_ref: "lode:capability/read-public-page",
        capability_version: "0.1.0"
      })),
      {
        ref: "evidence:fixture/result-summary",
        source: "terminal",
        state: "available",
        raw_access: "not_available_from_core",
        capability_ref: "lode:capability/read-public-page",
        capability_version: "0.1.0"
      }
    ]
  );
  assert.deepEqual(await getRunResult(store, runId), {
    ok: true,
    result: successResultQuery
  });
  assert.deepEqual(await getRunEvidenceRefs(store, runId), {
    ok: true,
    evidence: {
      schema_version: "webenvoy.evidence-refs-query.v0",
      run_id: runId,
      status: "succeeded",
      evidence_refs: successResultQuery.evidence_refs
    }
  });
  assert.deepEqual(await getRunSummary(store, "missing_run"), {
    ok: false,
    failure: {
      category: "persistence_observability",
      code: "run_not_found",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  assert.deepEqual(await getRunResult(store, "missing_run"), {
    ok: false,
    failure: {
      category: "persistence_observability",
      code: "run_not_found",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  assert.deepEqual(await getRunSummary(store, "../bad"), {
    ok: false,
    failure: {
      category: "request_invalid",
      code: "run_id_invalid",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  assert.deepEqual(await getRunEvidenceRefs(store, "../bad"), {
    ok: false,
    failure: {
      category: "request_invalid",
      code: "run_id_invalid",
      phase: "query",
      recovery_hint: "fix_input"
    }
  });
  const detachedGetRunRecord = store.getRunRecord;
  assert.deepEqual(await detachedGetRunRecord(runId), succeeded);
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${runId}.json`), "utf8")), succeeded);

  const failedId = "run_self_check_failure_001";
  await store.createRunRecord({
    ...baseInput(failedId),
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      runtime_binding_refs: harborRuntimeBindingRefs,
      evidence_refs: harborEvidenceRefs,
      resource_match_ref: "resource-match:fixture/ready"
    }
  });
  await store.updateRunRecord(failedId, {
    status: "admitted",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  await store.updateRunRecord(failedId, {
    status: "running",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  const failedOutput = await completeRunWithFailure(store, failedId, {
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
      checked_at: "2026-07-01T00:00:07.000Z",
      code: "output_invalid",
      attribution: "capability",
      recovery_hint: "repair_package",
      evidence_refs: ["evidence:fixture/output-invalid"],
      consumer_boundary: "Core stores post-check refs and public status only."
    },
    retention_state: "active"
  });
  const failed = failedOutput.run_record;
  assert.equal(failed.failure?.category, "result_projection");
  assert.equal(failed.failure?.attribution, "capability");
  assert.equal(failed.terminal_at, "2026-07-01T00:00:07.000Z");
  assert.equal(failedOutput.result_envelope.ok, false);
  assert.equal(failedOutput.result_envelope.outcome, "failed");
  assert.equal(failedOutput.result_envelope.failure?.code, "output_invalid");
  assert.equal(failedOutput.result_envelope.post_check?.status, "failed");
  const failedResultQuery = await getRunResult(store, failedId);
  assert.equal(failedResultQuery.ok, true);
  if (!failedResultQuery.ok) {
    throw new Error("failed run result query must be available");
  }
  assert.equal(failedResultQuery.result.result.result_envelope?.ok, false);
  assert.equal(failedResultQuery.result.failure?.code, "output_invalid");
  assert.equal(failedResultQuery.result.failure?.attribution, "capability");
  assert.equal(failedResultQuery.result.result.payload_state, "not_persisted_in_core");

  const capabilityRuns = await getCapabilityRunSummary(store, {
    capability_ref: "lode:capability/read-public-page",
    capability_version: "0.1.0"
  });
  assert.equal(capabilityRuns.ok, true);
  if (!capabilityRuns.ok) {
    throw new Error("capability run query must succeed");
  }
  assert.equal(capabilityRuns.capability_runs.schema_version, capabilityRunQuerySchemaVersion);
  assert.equal(capabilityRuns.capability_runs.total_runs, 2);
  assert.equal(capabilityRuns.capability_runs.status_counts.succeeded, 1);
  assert.equal(capabilityRuns.capability_runs.status_counts.failed, 1);
  assert.equal(capabilityRuns.capability_runs.failure_attribution_counts.capability, 1);
  assert.equal(capabilityRuns.capability_runs.latest_failure?.run_id, failedId);
  assert.equal(capabilityRuns.capability_runs.latest_failure?.post_check?.status, "failed");

  await writeFile(
    join(directory, "run_self_check_stale_partial.json"),
    JSON.stringify({
      schema_version: "webenvoy.run-record.v0",
      run_id: "run_self_check_stale_partial",
      status: "pending",
      created_at: "2026-07-01T00:00:08.000Z",
      updated_at: "2026-07-01T00:00:08.000Z"
    })
  );
  const capabilityRunsWithStaleRecord = await getCapabilityRunSummary(store, {
    capability_ref: "lode:capability/read-public-page",
    capability_version: "0.1.0"
  });
  assert.equal(capabilityRunsWithStaleRecord.ok, true);
  if (!capabilityRunsWithStaleRecord.ok) {
    throw new Error("capability run query must ignore stale partial run records");
  }
  assert.equal(capabilityRunsWithStaleRecord.capability_runs.total_runs, 2);

  const cancelledId = "run_self_check_cancelled_001";
  await store.createRunRecord(baseInput(cancelledId));
  const cancelled = await store.updateRunRecord(cancelledId, {
    status: "cancelled",
    evidence_refs: ["evidence:fixture/cancelled-by-user"]
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.terminal_at, "2026-07-01T00:00:09.000Z");

  const redactedId = "run_self_check_redacted_001";
  await store.createRunRecord(baseInput(redactedId));
  await store.updateRunRecord(redactedId, {
    status: "admitted",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  await store.updateRunRecord(redactedId, {
    status: "running",
    runtime_binding_refs: harborRuntimeBindingRefs,
    evidence_refs: harborEvidenceRefs
  });
  await completeRunWithResult(store, redactedId, {
    result_ref: "result:fixture/redacted-summary",
    result_kind: "content_detail",
    projection_ref: "projection:fixture/redacted-summary",
    evidence_refs: ["evidence:fixture/redacted-summary"],
    retention_state: "redacted"
  });
  const redactedResultQuery = await getRunResult(store, redactedId);
  assert.equal(redactedResultQuery.ok, true);
  if (!redactedResultQuery.ok) {
    throw new Error("redacted run result query must be available");
  }
  assert.equal(redactedResultQuery.result.result.envelope_state, "redacted");
  assert.equal(redactedResultQuery.result.result.payload_state, "redacted");
  assert.equal(redactedResultQuery.result.evidence_refs.at(-1)?.state, "redacted");

  await assert.rejects(() => store.updateRunRecord(runId, { status: "running" }), /terminal/);
  await assert.rejects(() => store.updateRunRecord(cancelledId, { status: "running" }), /terminal/);
  await assert.rejects(() => store.createRunRecord({ ...baseInput("../bad"), run_id: "../bad" }), /run_id/);
  await assert.rejects(() => store.createRunRecord({ ...baseInput("run_self_check_empty_ref"), entrypoint_ref: "" }), /entrypoint_ref/);
  await assert.rejects(
    () =>
      store.createRunRecord({
        ...baseInput("run_self_check_private_material_refused"),
        admission: {
          ...baseInput("run_self_check_private_material_refused").admission,
          runtime_session_binding: {
            schema_version: "webenvoy.runtime-session-binding.v0",
            identity_environment_ref: "identity-env_fixture",
            execution_identity_ref: "identity-env_fixture:execution",
            runtime_session_ref: "session_fixture_ready",
            profile_ref: "profile_fixture_public",
            provider_ref: "provider_fixture_local",
            provider_mode: "local_dedicated_profile",
            lifecycle_state: "active",
            control_owner: "system",
            session_use: "direct_session",
            core_task_run: true,
            consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence.",
            cdp_endpoint: "ws://127.0.0.1/private"
          } as never
        }
      }),
    /private browser material: cdp_endpoint/
  );
  const invalidRefId = "run_self_check_invalid_ref_patch";
  await store.createRunRecord(baseInput(invalidRefId));
  await assert.rejects(() => store.updateRunRecord(invalidRefId, { result_ref: "" }), /result_ref/);
  const pendingResultQuery = await getRunResult(store, invalidRefId);
  assert.equal(pendingResultQuery.ok, true);
  if (!pendingResultQuery.ok) {
    throw new Error("pending run result query must return unavailable state");
  }
  assert.equal(pendingResultQuery.result.result.envelope_state, "unavailable");
  assert.equal(pendingResultQuery.result.result.unavailable_reason, "run_not_terminal");
  await assert.rejects(
    () =>
      completeRunWithResult(store, invalidRefId, {
        result_ref: "result:fixture/unsafe",
        result_kind: "content_detail",
        data: {
          token: "must-not-enter-core"
        },
        evidence_refs: ["evidence:fixture/unsafe"]
      }),
    /forbidden field: token/
  );

  const detachedListRunRecords = store.listRunRecords;
  assert.deepEqual(
    (await detachedListRunRecords()).map((record) => record.run_id),
    [cancelledId, failedId, invalidRefId, runId, redactedId]
  );

  console.log("Validated Run Record file store with 5 durable records.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

await assertTaskSubmissionAdmission();
console.log("Validated read-only task submission admission.");
await assertDetailTargetStore();
console.log("Validated bound, expiring, single-use detail targets.");
await assertDetailRequestOmitsRawUrl();
console.log("Validated detail dispatch omits caller-provided Harbor URL.");
await assertRealSiteReadOnlyTaskExecution();
console.log("Validated real-site read-only task execution.");
await assertRealSiteReadOnlyResultProjection();
console.log("Validated real-site read-only result projection.");
await assertRealRunQueryEvidence();
console.log("Validated real run query evidence and failure reasons.");
await assertRealSiteWritePreviewResults();
console.log("Validated real-site write preview records.");
