import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  createFileRunRecordStore,
  createHttpHarborRuntimeClient,
  createLocalLodePackageResolver,
  recoverInterruptedCoreTaskSessions,
  submitRuntimeTask,
  type CreateRunRecordInput,
  type FileRunRecordStore,
  type HarborRuntimeClient,
  type RunRecord
} from "@webenvoy/core-runtime";
import { createApiServer } from "./server.js";

type JsonObject = Record<string, unknown>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as JsonObject).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonObject)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function fixtureAllowlistSha256(value: JsonObject): string {
  const semantic = { schema_version: value.schema_version, allowlist_id: value.allowlist_id, allowlist_version: value.allowlist_version, asset_owner: value.asset_owner, consumer_boundary: value.consumer_boundary, entries: value.entries, fail_closed: value.fail_closed };
  return createHash("sha256").update(canonicalJson(semantic)).digest("hex");
}

function detailRefForRun(runId: string): string {
  const hex = createHash("sha256").update(runId).digest("hex");
  return `detail_ref_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function opaqueRefForRun(prefix: string, runId: string): string {
  return detailRefForRun(`${prefix}:${runId}`).replace("detail_ref_", `${prefix}_`);
}

async function publishedDetailTargetPath(runDir: string, detailRef: string): Promise<string> {
  const root = join(runDir, ".detail-targets", "published");
  const fileName = `${createHash("sha256").update(detailRef).digest("hex")}.json`;
  for (const batch of await readdir(root)) {
    const path = join(root, batch, fileName);
    try {
      await readFile(path);
      return path;
    } catch {}
  }
  throw new Error(`published detail target not found: ${detailRef}`);
}

const packageRef = "lode://site-capability/example/read-public-page@0.1.0";
const lockRef = "lode://lock/site-capability/example/read-public-page@0.1.0";
const resourceRef = "example.read-public-page.resources";
const xiaohongshuPackageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuLockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuResourceRef = "xiaohongshu.search-notes.resources";
const xiaohongshuDetailPackageRef = "lode://site-capability/xiaohongshu/read-note-detail@0.1.0";
const xiaohongshuDetailLockRef = "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0";
const xiaohongshuDetailResourceRef = "xiaohongshu.read-note-detail.resources";
const xiaohongshuWritePrecheckPackageRef = "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0";
const xiaohongshuWritePrecheckLockRef = "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1";
const xiaohongshuWritePrecheckResourceRef = "xiaohongshu.publish-note-precheck.resources";
const bossPackageRef = "lode://site-capability/boss/job-search@0.1.0";
const bossLockRef = "lode://lock/site-capability/boss/job-search@0.1.0";
const bossResourceRef = "boss.job-search.resources";
const bossDetailPackageRef = "lode://site-capability/boss/read-job-detail@0.1.1";
const bossPrecheckPackageRef = "lode://site-capability/boss/greet-precheck@0.1.0";
const currentRuntimeAdmission = { enabled: true, status: "current", recheck_condition: "not_applicable" } as const;
const deferredRuntimeAdmission = {
  enabled: false,
  status: "deferred_experimental",
  recheck_condition: "deferred_milestone_scope_restored_with_current_head_review_and_runtime_live_evidence"
} as const;
const harborSupervisorToken = "runtime-supervisor-self-check-token";
const readyResourceFacts: JsonObject = {
  schema_version: "harbor-core-resource-facts/v0",
  resource_facts: [
    { fact_key: "runtime.execution_surface.available", state: "available" },
    { fact_key: "runtime.public_https_navigation.allowed", state: "available" },
    { fact_key: "snapshot.document_summary.available", state: "available" },
    { fact_key: "refmap.source_refs.available", state: "available" },
    { fact_key: "evidence.snapshot_ref.available", state: "available" }
  ],
  consumer_boundary: "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material."
};
const readyXiaohongshuSiteFacts: JsonObject = {
  schema_version: "harbor-site-resource-facts/v0",
  runtime_session_ref: "session_runtime_api_ready",
  provider_ref: "harbor:provider/cloakbrowser",
  profile_ref: "profile_runtime_api",
  site_id: "xiaohongshu",
  task_kind: "search_notes",
  generated_at: "2026-07-09T00:00:00.000Z",
  page: {
    requested_url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
    current_url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
    origin: "https://www.xiaohongshu.com",
    title: "Xiaohongshu search",
    status: "ready",
    failure: null
  },
  resource_facts: [
    { key: "runtime.execution_surface.available", state: "available", source: "observed", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "runtime.origin.www_xiaohongshu_com.available", state: "available", source: "observed", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "identity.user_logged_in.confirmed", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "page.vue_app.ready", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "page.pinia_store.ready", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "source.refs.available", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "page.future_probe.ready", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "network.future_probe.available", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "evidence.snapshot_ref.available", state: "available", source: "validation_evidence", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" },
    { key: "safety.challenge.absent", state: "available", source: "derived", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" }
  ],
  evidence_refs: ["evidence_runtime_api_snapshot"],
  snapshot_ref: "snapshot_runtime_api_ready",
  refmap_ref: "refmap_runtime_api_ready",
  public_boundary: {
    output: "public_runtime_facts_and_refs_only",
    raw_credentials: "not_exposed",
    raw_profile_storage: "not_exposed",
    raw_cdp_endpoint: "not_exposed",
    raw_dom: "not_exposed",
    raw_har: "not_exposed",
    raw_network_bodies: "not_exposed",
    screenshot_body: "not_exposed",
    external_write_actions: "not_performed"
  },
  unavailable: null
};
const readyBossSiteFacts: JsonObject = {
  schema_version: "harbor-site-resource-facts/v0",
  runtime_session_ref: "session_runtime_api_ready",
  provider_ref: "harbor:provider/cloakbrowser",
  profile_ref: "profile_runtime_api",
  site_id: "boss",
  task_kind: "job_search",
  generated_at: "2026-07-11T00:00:00.000Z",
  page: { requested_url: "https://www.zhipin.com/web/geek/jobs?query=AI", current_url: "https://www.zhipin.com/web/geek/jobs?query=AI", origin: "https://www.zhipin.com", title: "BOSS jobs", status: "ready", failure: null },
  resource_facts: ["runtime.execution_surface.available", "runtime.origin.www_zhipin_com.available", "identity.boss_geek_logged_in.confirmed", "page.boss_spa.ready", "network.wapi_zpgeek.available", "source.refs.available", "evidence.snapshot_ref.available", "safety.challenge.absent"].map((key) => ({ key, state: "available", source: "observed", severity: "info", message: "ready", evidence_ref: "evidence_runtime_api_snapshot" })),
  evidence_refs: ["evidence_runtime_api_snapshot"],
  snapshot_ref: "snapshot_runtime_api_ready",
  refmap_ref: "refmap_runtime_api_ready",
  public_boundary: { output: "public_runtime_facts_and_refs_only", raw_material: "not_exposed" }
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

function asRecord(value: unknown): JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

function liveSessionIdentity(siteId: string, origin: string, overrides: JsonObject = {}): JsonObject {
  const loginOverrides = asRecord(overrides.login_state ?? {});
  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref: "identity-env_runtime_api",
    execution_identity_ref: "identity-env_runtime_api:execution",
    profile_ref: "profile_runtime_api",
    site_binding: { site_id: siteId, origin },
    browser_storage: { state: "present" },
    provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "default_provider_available" },
    consumer_boundary: {
      core: "admission_facts_refs_and_blocking_reasons_only",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
    },
    ...overrides,
    login_state: { state: "logged_in", reason: "user_confirmed_managed_session", manual_authentication_state: "completed", recovery_required: false, ...loginOverrides }
  };
}

function liveRuntimeFacts(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: "harbor-core-runtime-facts/v0",
    runtime_session_ref: "session_runtime_api_ready",
    identity_environment_ref: "identity-env_runtime_api",
    execution_identity_ref: "identity-env_runtime_api:execution",
    profile_ref: "profile_runtime_api",
    provider_ref: "harbor:provider/cloakbrowser",
    provider_mode: "local_dedicated_profile",
    lifecycle_state: "active",
    availability: { cdp: "available", viewer: "unsupported", snapshot: "available", evidence: "available" },
    viewer: { viewer_ref: "viewer_runtime_api", availability: "unsupported", access_mode: "none", expires_at: "2026-07-08T01:00:00.000Z" },
    control: { owner: "core_task", handoff_reason: null, takeover: { available: false, unavailable_reason: "viewer_unavailable" }, updated_at: "2026-07-08T00:00:00.000Z" },
    current_error: null,
    fact_refs: { session: "session_runtime_api_ready", viewer: "viewer_runtime_api" },
    unavailable: null,
    ...overrides
  };
}

async function postJson(port: number, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

function portOf(server: Server): number {
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return portOf(server);
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function readRequestJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function taskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read Example Domain through a real Harbor runtime session." },
    capability: {
      ref: "lode:capability/read-public-page",
      version: "0.1.0",
      source_ref: packageRef,
      lock_ref: lockRef
    },
    input: {
      summary: "Read the current public page summary.",
      refs: ["https://example.org/"]
    },
    scope: {
      target_type: "public_page",
      target_ref: "https://example.org/"
    },
    policy: {
      risk: "read",
      execution_intent: "read",
      timeout_ms: 5000
    },
    resource_requirement_refs: [resourceRef],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function xiaohongshuTaskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read Xiaohongshu search results through Harbor runtime facts." },
    capability: {
      ref: "lode:capability/xiaohongshu-search-notes",
      version: "0.1.0",
      source_ref: xiaohongshuPackageRef,
      lock_ref: xiaohongshuLockRef
    },
    input: {
      summary: "Read current Xiaohongshu search page summary.",
      refs: ["https://www.xiaohongshu.com/search_result/?keyword=city%20coffee"]
    },
    scope: {
      target_type: "xiaohongshu_search",
      target_ref: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee"
    },
    policy: {
      risk: "read",
      execution_intent: "read",
      timeout_ms: 5000
    },
    resource_requirement_refs: [xiaohongshuResourceRef],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function xiaohongshuDetailTaskIntent(intentId: string, detailRef: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read one Xiaohongshu note detail from a persisted search ref." },
    capability: { ref: "lode:capability/read-note-detail", version: "0.1.0", source_ref: xiaohongshuDetailPackageRef, lock_ref: xiaohongshuDetailLockRef },
    input: { summary: "Read the selected note detail.", refs: [detailRef] },
    scope: { target_type: "xiaohongshu_note_detail", target_ref: detailRef },
    policy: { risk: "read", execution_intent: "read", timeout_ms: 5000 },
    resource_requirement_refs: [xiaohongshuDetailResourceRef],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function xiaohongshuWritePrecheckTaskIntent(intentId: string, url: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0", intent_id: intentId, entrypoint: "app",
    user_intent: { summary: "Validate the Xiaohongshu creator page without publishing." },
    capability: { ref: "lode:capability/publish-note-precheck", version: "0.1.0", source_ref: xiaohongshuWritePrecheckPackageRef, lock_ref: xiaohongshuWritePrecheckLockRef },
    input: { summary: "Validate public creator fields without storing draft content." },
    scope: { target_type: "xiaohongshu_publish_note_precheck", target_ref: url },
    policy: { risk: "write", execution_intent: "validate_only" },
    resource_requirement_refs: [xiaohongshuWritePrecheckResourceRef], evidence_policy_ref: "evidence-policy:refs-only"
  };
}

async function assertXiaohongshuValidateOnlyTask(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-xhs-write-precheck-"));
  const url = "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image";
  const targetRef = "writable-target:xiaohongshu/creator-publish-note";
  const sourceRefs = ["source_11111111-1111-4111-8111-111111111111", "source_22222222-2222-4222-8222-222222222222"];
  const snapshotRef = "screenshot_11111111-1111-4111-8111-111111111111";
  const postCheckRef = "post_check_11111111-1111-4111-8111-111111111111";
  const pageRef = "page_11111111-1111-4111-8111-111111111111";
  let capturedRequest: unknown;
  let responseIdentity = "identity-env_runtime_api";
  let responseTarget = targetRef;
  let legacyFieldSuccess = false;
  let operationMode: "completed" | "unknown" | "timeout" = "completed";
  let cleanupFailure = false;
  let pinVersion = "0.1.0";
  let pinOrigin = "https://creator.xiaohongshu.com";
  const runtimeConsumption = {
    allowlist_id: "lode.xhs-boss.write-precheck.runtime-consumption", allowlist_version: "0.1.0", asset_owner: "Lode",
    consumer: { repository: "WebEnvoy/WebEnvoy", issue: "#231", purpose: "admit and record an exact validate-only precheck" },
    package_ref: xiaohongshuWritePrecheckPackageRef, lock_ref: xiaohongshuWritePrecheckLockRef, version: "0.1.0", site_slug: "xiaohongshu",
    operation_id: "xhs_publish_note_precheck", operation_mode: "validate_only", lifecycle: "proposed",
    allowed_origins: ["https://www.xiaohongshu.com", "https://creator.xiaohongshu.com"], resource_requirements_id: xiaohongshuWritePrecheckResourceRef,
    failure_mapping_id: "xiaohongshu.publish-note-precheck.failure-mapping", required_failure_classes: ["invalid_contract", "resource_unavailable", "site_changed", "empty_result", "preview_unavailable", "page_changed", "user_cancelled", "post_check_failed", "evidence_expired", "login_required", "permission_insufficient", "composition_not_initialized", "target_not_writable", "safety_challenge"],
    required_source_ref_kinds: ["creator_publish_page_summary", "dom_snapshot_summary"], required_evidence_ref_kinds: ["snapshot_ref", "post_check_ref"],
    post_check_id: "xiaohongshu.publish-note-precheck.post-check", required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs", "submitted"]
  } as const;
  const resolver = async () => ({
    package_ref: xiaohongshuWritePrecheckPackageRef, source_ref: xiaohongshuWritePrecheckPackageRef, lock_ref: xiaohongshuWritePrecheckLockRef,
    capability_id: "publish-note-precheck", operation_id: "xhs_publish_note_precheck", operation_mode: "validate_only", version: "0.1.0", lifecycle: "proposed",
    runtime_admission: currentRuntimeAdmission,
    resource_requirements: {
      schema_version: "lode.resource-requirements.v0", resource_requirements_id: xiaohongshuWritePrecheckResourceRef, package_ref: xiaohongshuWritePrecheckPackageRef, operation_mode: "validate_only",
      resource_requirement_profiles: [{ requirement_profile_id: "xhs-creator-publish-page-precheck", operation_boundary: "validate_only", required_harbor_facts: [
        "runtime.execution_surface.available", "runtime.public_https_navigation.allowed", "runtime.site_identity.logged_in", "snapshot.creator_publish_entrypoint.available", "refmap.entrypoint_refs.available", "evidence.snapshot_ref.available"
      ].map((fact_key) => ({ fact_key, owner: "Harbor" as const, required: true, freshness: "current_execution_window" })) }]
    }, runtime_consumption: runtimeConsumption
  });
  const client: HarborRuntimeClient = {
    async collectAdmissionFacts() {
      return {
        harbor_identity_environment_facts: liveSessionIdentity("xiaohongshu", "https://www.xiaohongshu.com"),
        harbor_provider_status: { schema_version: "harbor-browser-provider-status/v0", providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }] },
        harbor_runtime_facts: liveRuntimeFacts(), harbor_scene_ref: { status: "unavailable", failure_class: "not_required", retryable: false },
        harbor_resource_facts: { schema_version: "harbor-core-resource-facts/v0", resource_facts: ["runtime.execution_surface.available", "runtime.public_https_navigation.allowed", "runtime.site_identity.logged_in", "snapshot.creator_publish_entrypoint.available", "refmap.entrypoint_refs.available", "evidence.snapshot_ref.available"].map((fact_key) => ({ fact_key, state: "available" })), consumer_boundary: "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material." },
        harbor_write_precheck_facts: {
          schema_version: "harbor-write-precheck-facts/v0", runtime_session_ref: "session_runtime_api_ready", provider_ref: "harbor:provider/cloakbrowser", profile_ref: "profile_runtime_api",
          writable_target: { target_ref: targetRef, runtime_session_ref: "session_runtime_api_ready", snapshot_ref: snapshotRef, refmap_ref: "refmap_write_precheck", evidence_refs: [snapshotRef] },
          form_state: { snapshot_ref: snapshotRef, fields: [{ field_ref: "field_title", target_ref: targetRef, input_kind: "text", required: true, sensitivity: "public", export_policy: "safe_summary", value_state: "empty" }], state_summary: "Public field states only." },
          pre_write_guard: { status: "active", no_submit_guard: "active", blocked_events: ["publish", "save", "upload", "submit", "schedule"], enforcement: "facts_only_no_real_submit", runtime_ready: true, blocking_reasons: [] },
          privacy_boundary: { raw_values: "not_exposed", credential_profile_storage: "not_exposed", page_network_capture: "not_exposed", export_boundary: "refs_and_redacted_field_state_only" }, unavailable: null
        }
      } as unknown as Awaited<ReturnType<HarborRuntimeClient["collectAdmissionFacts"]>>;
    },
    async executeReadOperation() { throw new Error("read operation must not run"); },
    async executeValidateOnlyWritePrecheck(input) {
      capturedRequest = input.request;
      if (operationMode === "unknown") return { category: "runtime_execution", code: "harbor_write_precheck_outcome_unknown", phase: "verification", recovery_hint: "reconcile_status" };
      if (operationMode === "timeout") return new Promise((resolve) => input.signal?.addEventListener("abort", () => resolve({ category: "runtime_execution", code: "timeout", phase: "verification", recovery_hint: "reconcile_status" }), { once: true }));
      const sources = [{ kind: "creator_publish_page_summary", ref: sourceRefs[0] }, { kind: "dom_snapshot_summary", ref: sourceRefs[1] }];
      const evidence = [{ kind: "snapshot_ref", ref: snapshotRef }, { kind: "post_check_ref", ref: postCheckRef }];
      return {
        schema_version: "harbor-validate-only-write-precheck/v0", status: "completed", runtime_session_ref: input.runtime_session_ref,
        identity_ref: responseIdentity, page_ref: pageRef, merged_head_ref: "d18d79cbe280d93b3e855ca906e254bcb9eadf00",
        operation_ref: "write_precheck_11111111-1111-4111-8111-111111111111", result_ref: "write_precheck_result_11111111-1111-4111-8111-111111111111", submitted_result_ref: "submitted_result_11111111-1111-4111-8111-111111111111",
        observed_at: "2026-07-13T00:00:00.000Z", submitted: false, source_refs: sources, evidence_ref_kinds: evidence, target_ref: responseTarget,
        precheck_scope: "entrypoint_only", classification: "partial_result", composition_state: "composition_not_initialized",
        entrypoint_observations: { route_loaded: true, user_confirmed_identity: true, challenge_absent: true, publish_vue_container_visible: true, upload_image_tab_active: true, upload_image_entry_visible: true, text_image_entry_visible: true },
        field_states: Object.fromEntries(["title_input", "content_editor", "publish_control"].map((field) => [field, legacyFieldSuccess ? { state: "available" } : { availability: "unavailable", observation: "not_observed" }])),
        prohibited_actions_observed: { upload: false, generate: false, save: false, publish: false }, no_submit_guard: "active",
        post_check: { status: "passed", reason: "validated_creator_entrypoint_without_submission", source_refs: sources, evidence_refs: [evidence[0]], post_check_ref: postCheckRef, submitted: false, no_submit_guard: "active" },
        lode_pin: { package_ref: xiaohongshuWritePrecheckPackageRef, lock_ref: xiaohongshuWritePrecheckLockRef, version: pinVersion, operation_id: "xhs_publish_note_precheck", operation_mode: "validate_only", origin: pinOrigin, repository: "WebEnvoy/Lode", commit: "d18d79cbe280d93b3e855ca906e254bcb9eadf00", asset_path: "registry/validate-only-runtime-consumption.json", asset_sha256: "f03577c3290fc8c7b52ed8157b0411d66242f18acdf334200968901ee6121dcd" },
        public_boundary: { raw_dom: "not_exposed", raw_har: "not_exposed", screenshot_body: "not_exposed", credentials: "not_exposed", external_write_actions: "not_performed" }
      };
    },
    async releaseCoreTaskSession() { return cleanupFailure ? { category: "runtime_execution", code: "session_release_failed", phase: "verification", recovery_hint: "retry_cleanup" } : undefined; }
  };
  try {
    const store = createFileRunRecordStore({ directory });
    const server = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: client });
    const port = await listen(server);
    try {
      const validate_only = { url, target_ref: targetRef, no_submit_guard: "active", requested_fields: ["title", "summary", "canonical_url", "source_status"], include_source_refs: true, proposed_input_summary: "Validate creator fields without saving, uploading, or publishing." };
      const response = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(response.status, 202, JSON.stringify(response.body));
      assert.deepEqual(capturedRequest, validate_only);
      const record = await store.getRunRecord("run_xhs_validate_only");
      assert.equal(record?.status, "succeeded"); assert.equal(record?.preview_result?.submitted, false);
      assert.deepEqual(record?.preview_result?.expected_change && {
        identity_ref: record.preview_result.expected_change.identity_ref,
        page_ref: record.preview_result.expected_change.page_ref,
        merged_head_ref: record.preview_result.expected_change.merged_head_ref,
        run_ref: record.preview_result.expected_change.run_ref
      }, { identity_ref: "identity-env_runtime_api", page_ref: pageRef, merged_head_ref: "d18d79cbe280d93b3e855ca906e254bcb9eadf00", run_ref: "run_xhs_validate_only" });
      assert.equal(record?.preview_result?.expected_change?.semantic_sha256, "f03577c3290fc8c7b52ed8157b0411d66242f18acdf334200968901ee6121dcd");
      assert.equal(record?.preview_result?.expected_change?.classification, "partial_result");
      assert.equal(record?.preview_result?.expected_change?.precheck_scope, "entrypoint_only");
      assert.equal(record?.preview_result?.expected_change?.composition_state, "composition_not_initialized");
      assert.deepEqual(record?.source_refs, sourceRefs); assert.deepEqual(record?.evidence_refs, [snapshotRef, postCheckRef]);
      responseIdentity = "identity-env_wrong";
      const mismatched = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_identity_mismatch", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_identity_mismatch", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(mismatched.status, 503); assert.equal(asRecord(asRecord(mismatched.body).error).code, "write_precheck_contract_drift");
      responseIdentity = "identity-env_runtime_api"; responseTarget = "writable-target:xiaohongshu/other-target";
      const targetMismatch = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_target_mismatch", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_target_mismatch", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(targetMismatch.status, 503); assert.equal(asRecord(asRecord(targetMismatch.body).error).code, "write_precheck_contract_drift");
      responseTarget = targetRef; legacyFieldSuccess = true;
      const legacyFields = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_legacy_fields", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_legacy_fields", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(legacyFields.status, 503); assert.equal(asRecord(asRecord(legacyFields.body).error).code, "write_precheck_contract_drift");
      legacyFieldSuccess = false; operationMode = "unknown";
      cleanupFailure = true;
      const unknown = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_unknown", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_unknown", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(unknown.status, 202); assert.equal(asRecord(asRecord(unknown.body).run).status, "unknown_outcome");
      const unknownRecord = await store.getRunRecord("run_xhs_validate_only_unknown");
      assert.equal(unknownRecord?.status, "unknown_outcome"); assert.match(unknownRecord?.post_check?.summary ?? "", /session cleanup also failed with session_release_failed/);
      cleanupFailure = false;
      operationMode = "timeout";
      const timeout = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_timeout", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_timeout", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url, timeout_ms: 5 }, validate_only });
      assert.equal(timeout.status, 202); assert.equal(asRecord(asRecord(timeout.body).run).status, "unknown_outcome"); assert.equal(asRecord(asRecord(timeout.body).error).code, "timeout");
      operationMode = "completed"; pinVersion = "9.9.9";
      const versionMismatch = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_pin_version_mismatch", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_pin_version_mismatch", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(versionMismatch.status, 503); assert.equal(asRecord(asRecord(versionMismatch.body).error).code, "write_precheck_contract_drift");
      pinVersion = "0.1.0"; pinOrigin = "https://www.xiaohongshu.com";
      const originMismatch = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_pin_origin_mismatch", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_pin_origin_mismatch", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only });
      assert.equal(originMismatch.status, 503); assert.equal(asRecord(asRecord(originMismatch.body).error).code, "write_precheck_contract_drift");
      const drifted = await postJson(port, "/tasks", { run_id: "run_xhs_validate_only_bad", package_ref: xiaohongshuWritePrecheckPackageRef, task_intent: xiaohongshuWritePrecheckTaskIntent("intent_xhs_validate_only_bad", url), harbor: { identity_environment_ref: "identity-env_runtime_api", url }, validate_only: { ...validate_only, no_submit_guard: "inactive" } });
      assert.equal(drifted.status, 400);
    } finally { await close(server); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function assertWritePrecheckEvidenceReadback(): Promise<void> {
  const refs = [
    "page_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "write_precheck_result_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "submitted_result_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "source_dddddddd-dddd-4ddd-8ddd-dddddddddddd", "source_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "screenshot_ffffffff-ffff-4fff-8fff-ffffffffffff", "post_check_11111111-1111-4111-8111-111111111111"
  ];
  let unavailableRef: string | undefined;
  let evidenceIdentity = "identity-env_runtime_api";
  let responseMode: "completed" | "malformed" = "completed";
  const reads: string[] = [];
  let authorization: string | undefined;
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/runtime/sessions/session_write_precheck/validate-only-write-precheck") {
      authorization = request.headers.authorization;
      await readRequestJson(request);
      if (responseMode === "malformed") { sendJson(response, 200, { status: "completed" }); return; }
      const sources = [{ kind: "creator_publish_page_summary", ref: refs[3] }, { kind: "dom_snapshot_summary", ref: refs[4] }];
      const evidence = [{ kind: "snapshot_ref", ref: refs[5] }, { kind: "post_check_ref", ref: refs[6] }];
      sendJson(response, 200, { schema_version: "harbor-validate-only-write-precheck/v0", status: "completed", runtime_session_ref: "session_write_precheck", identity_ref: "identity-env_runtime_api", page_ref: refs[0], merged_head_ref: "d18d79cbe280d93b3e855ca906e254bcb9eadf00", operation_ref: "write_precheck_22222222-2222-4222-8222-222222222222", result_ref: refs[1], submitted_result_ref: refs[2], observed_at: "2026-07-13T00:00:00.000Z", submitted: false, source_refs: sources, evidence_ref_kinds: evidence, target_ref: "writable-target:xiaohongshu/creator-publish-note", precheck_scope: "entrypoint_only", classification: "partial_result", composition_state: "composition_not_initialized", field_states: Object.fromEntries(["title_input", "content_editor", "publish_control"].map((field) => [field, { availability: "unavailable", observation: "not_observed" }])), no_submit_guard: "active", post_check: { status: "passed", reason: "validated_creator_entrypoint_without_submission", source_refs: sources, evidence_refs: [evidence[0]], post_check_ref: refs[6], submitted: false, no_submit_guard: "active" }, lode_pin: {}, public_boundary: {} });
      return;
    }
    const match = /^\/runtime\/evidence\/(.+)$/.exec(request.url ?? "");
    if (request.method === "GET" && match) {
      const ref = decodeURIComponent(match[1]!); reads.push(ref);
      sendJson(response, 200, { evidence_ref: ref, access_state: ref === unavailableRef ? "expired" : "available", runtime_session_ref: "session_write_precheck", identity_ref: evidenceIdentity });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });
  const previous = process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
  process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = harborSupervisorToken;
  try {
    const port = await listen(server);
    const client = createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${port}` });
    const request = { url: "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image", target_ref: "writable-target:xiaohongshu/creator-publish-note", no_submit_guard: "active" as const };
    const completed = await client.executeValidateOnlyWritePrecheck({ runtime_session_ref: "session_write_precheck", identity_ref: "identity-env_runtime_api", request });
    assert.equal(asRecord(completed).status, "completed"); assert.deepEqual(reads, refs); assert.equal(authorization, `Bearer ${harborSupervisorToken}`);
    evidenceIdentity = "identity-env_wrong"; reads.length = 0;
    const wrongBinding = await client.executeValidateOnlyWritePrecheck({ runtime_session_ref: "session_write_precheck", identity_ref: "identity-env_runtime_api", request });
    assert.equal(asRecord(wrongBinding).code, "evidence_unavailable");
    evidenceIdentity = "identity-env_runtime_api";
    unavailableRef = refs[0]; reads.length = 0;
    const unavailable = await client.executeValidateOnlyWritePrecheck({ runtime_session_ref: "session_write_precheck", identity_ref: "identity-env_runtime_api", request });
    assert.equal(asRecord(unavailable).code, "evidence_unavailable");
    unavailableRef = undefined; responseMode = "malformed";
    const malformed = await client.executeValidateOnlyWritePrecheck({ runtime_session_ref: "session_write_precheck", identity_ref: "identity-env_runtime_api", request });
    assert.equal(asRecord(malformed).code, "harbor_write_precheck_outcome_unknown");
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN; else process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = previous;
  }
}

function bossTaskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read BOSS job search through Harbor." },
    capability: { ref: "lode:capability/job-search", version: "0.1.0", source_ref: bossPackageRef, lock_ref: bossLockRef },
    input: { summary: "Read BOSS job search.", refs: ["https://www.zhipin.com/web/geek/job?query=AI&city=101010100"] },
    scope: { target_type: "boss_job_search", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
    policy: { risk: "read", execution_intent: "read", timeout_ms: 5000 },
    resource_requirement_refs: [bossResourceRef],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

async function writeLodeRegistry(
  root: string,
  options: { bossFixtureEnabled?: boolean } = {}
): Promise<{ registryPath: string; allowlistAssetSha256: string; runtimeAdmissionAssetSha256: Record<string, string> }> {
  const bossRuntimeAdmission = options.bossFixtureEnabled ? currentRuntimeAdmission : deferredRuntimeAdmission;
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(join(root, "sites", "example", "read-public-page"), { recursive: true });
  await mkdir(join(root, "sites", "xiaohongshu", "search-notes"), { recursive: true });
  await mkdir(join(root, "sites", "xiaohongshu", "read-note-detail"), { recursive: true });
  await mkdir(join(root, "sites", "boss", "job-search"), { recursive: true });
  await writeFile(
    join(root, "registry", "local-packages.json"),
    JSON.stringify({
      schema_version: "lode.local-package-registry.v0",
      entries: [
        {
          package_ref: packageRef,
          package_type: "site-capability",
          package_path: "sites/example/read-public-page",
          manifest_path: "sites/example/read-public-page/manifest.json",
          lock_ref: lockRef,
          capability_id: "read-public-page",
          operation_id: "content_detail_by_url",
          operation_mode: "read",
          version: "0.1.0",
          lifecycle: "proposed"
        },
        {
          package_ref: xiaohongshuPackageRef,
          package_type: "site-capability",
          package_path: "sites/xiaohongshu/search-notes",
          manifest_path: "sites/xiaohongshu/search-notes/manifest.json",
          lock_ref: xiaohongshuLockRef,
          capability_id: "xiaohongshu-search-notes",
          operation_id: "xhs_search_notes",
          operation_mode: "read",
          version: "0.1.0",
          lifecycle: "proposed",
          task_kind: "real_site_read",
          runtime_admission: currentRuntimeAdmission
        },
        {
          package_ref: xiaohongshuDetailPackageRef,
          package_type: "site-capability",
          package_path: "sites/xiaohongshu/read-note-detail",
          manifest_path: "sites/xiaohongshu/read-note-detail/manifest.json",
          lock_ref: xiaohongshuDetailLockRef,
          capability_id: "read-note-detail",
          operation_id: "xhs_read_note_detail",
          operation_mode: "read",
          version: "0.1.0",
          lifecycle: "proposed",
          task_kind: "real_site_read",
          runtime_admission: currentRuntimeAdmission
        },
        {
          package_ref: bossPackageRef,
          package_type: "site-capability",
          package_path: "sites/boss/job-search",
          manifest_path: "sites/boss/job-search/manifest.json",
          lock_ref: bossLockRef,
          capability_id: "job-search",
          operation_id: "boss_job_search",
          operation_mode: "read",
          version: "0.1.0",
          lifecycle: "proposed",
          task_kind: "real_site_read",
          runtime_admission: bossRuntimeAdmission
        },
        {
          package_ref: bossDetailPackageRef,
          site_slug: "boss",
          operation_id: "boss_read_job_detail",
          runtime_admission: bossRuntimeAdmission
        },
        {
          package_ref: bossPrecheckPackageRef,
          site_slug: "boss",
          operation_id: "boss_greet_precheck",
          runtime_admission: bossRuntimeAdmission
        }
      ]
    })
  );
  const runtimeAllowlist = {
      schema_version: "lode.runtime-consumption-allowlist.v0",
      allowlist_id: "lode.xhs-boss.read.runtime-consumption",
      allowlist_version: "0.1.0",
      asset_owner: "Lode",
      consumer_boundary: { allowed_consumers: [{ repository: "WebEnvoy/WebEnvoy", issue: "#267", purpose: "lock-bound read-only task admission and run recording" }] },
      entries: [{
        package_ref: xiaohongshuPackageRef,
        lock_ref: xiaohongshuLockRef,
        version: "0.1.0",
        site_slug: "xiaohongshu",
        operation_id: "xhs_search_notes",
        operation_mode: "read",
        lifecycle: "proposed",
        runtime_admission: currentRuntimeAdmission,
        allowed_origins: ["https://www.xiaohongshu.com"],
        resource_requirements: { resource_requirements_id: xiaohongshuResourceRef },
        failure_taxonomy: { failure_mapping_id: "xiaohongshu.search-notes.failure-mapping", required_classes: ["invalid_contract", "resource_unavailable", "site_changed", "not_logged_in", "login_expired", "page_not_ready", "safety_challenge", "field_missing", "network_resource_unavailable"] },
        evidence_and_post_check: {
          required_ref_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary", "snapshot_ref", "post_check_ref"],
          post_check_id: "xiaohongshu.search-notes.post-check",
          required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"]
        }
      }, {
        package_ref: bossPackageRef,
        lock_ref: bossLockRef,
        version: "0.1.0",
        site_slug: "boss",
        operation_id: "boss_job_search",
        operation_mode: "read",
        lifecycle: "proposed",
        runtime_admission: bossRuntimeAdmission,
        allowed_origins: ["https://www.zhipin.com"],
        resource_requirements: { resource_requirements_id: bossResourceRef },
        failure_taxonomy: { failure_mapping_id: "boss.job-search.failure-mapping", required_classes: ["invalid_contract", "resource_unavailable", "site_changed", "not_logged_in", "identity_insufficient", "captcha_required", "page_not_ready", "field_missing", "network_resource_unavailable"] },
        evidence_and_post_check: { required_ref_kinds: ["snapshot_ref", "network_summary_ref", "post_check_ref"], post_check_id: "boss.job-search.post-check", required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"] }
      }],
      fail_closed: { unknown_operation: "reject" }
    };
  await writeFile(join(root, "registry", "runtime-consumption-allowlist.json"), JSON.stringify(runtimeAllowlist));
  const detailRuntimeConsumption = {
    schema_version: "lode.detail-runtime-consumption.v0",
    truth_id: "lode.xhs-boss.detail-read.runtime-consumption",
    asset_owner: "Lode",
    entries: [{
      package_ref: xiaohongshuDetailPackageRef,
      lock_ref: xiaohongshuDetailLockRef,
      version: "0.1.0",
      operation_id: "xhs_read_note_detail",
      operation_mode: "read",
      site_slug: "xiaohongshu",
      lifecycle: "proposed",
      required_ref_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary", "snapshot_ref", "post_check_ref"],
      runtime_admission: currentRuntimeAdmission
    }, { package_ref: bossDetailPackageRef, runtime_admission: bossRuntimeAdmission }]
  };
  const validateOnlyRuntimeConsumption = {
    entries: [{ package_ref: bossPrecheckPackageRef, runtime_admission: bossRuntimeAdmission }]
  };
  await writeFile(join(root, "registry", "detail-runtime-consumption.json"), JSON.stringify(detailRuntimeConsumption));
  await writeFile(join(root, "registry", "validate-only-runtime-consumption.json"), JSON.stringify(validateOnlyRuntimeConsumption));
  await writeFile(
    join(root, "sites", "example", "read-public-page", "manifest.json"),
    JSON.stringify({
      manifest_version: "lode.site-capability.manifest.v0",
      package_ref: packageRef,
      package_type: "site-capability",
      capability: {
        capability_id: "read-public-page",
        operation_id: "content_detail_by_url",
        operation_mode: "read",
        version: "0.1.0",
        lifecycle: "proposed"
      },
      asset_refs: [
        { role: "resource_requirements", path: "resource-requirements.json", status: "present" },
        { role: "package_lock", path: "package-lock.json", status: "present", lock_ref: lockRef }
      ]
    })
  );
  await writeFile(
    join(root, "sites", "xiaohongshu", "search-notes", "manifest.json"),
    JSON.stringify({
      manifest_version: "lode.site-capability.manifest.v0",
      package_ref: xiaohongshuPackageRef,
      package_type: "site-capability",
      capability: {
        capability_id: "xiaohongshu-search-notes",
        operation_id: "xhs_search_notes",
        operation_mode: "read",
        version: "0.1.0",
        lifecycle: "proposed"
      },
      asset_refs: [
        { role: "resource_requirements", path: "resource-requirements.json", status: "present" },
        { role: "package_lock", path: "package-lock.json", status: "present", lock_ref: xiaohongshuLockRef }
      ]
    })
  );
  await writeFile(
    join(root, "sites", "xiaohongshu", "read-note-detail", "manifest.json"),
    JSON.stringify({
      manifest_version: "lode.site-capability.manifest.v0",
      package_ref: xiaohongshuDetailPackageRef,
      package_type: "site-capability",
      capability: { capability_id: "read-note-detail", operation_id: "xhs_read_note_detail", operation_mode: "read", version: "0.1.0", lifecycle: "proposed" },
      asset_refs: [
        { role: "resource_requirements", path: "resource-requirements.json", status: "present" },
        { role: "package_lock", path: "package-lock.json", status: "present", lock_ref: xiaohongshuDetailLockRef }
      ]
    })
  );
  await writeFile(join(root, "sites", "boss", "job-search", "manifest.json"), JSON.stringify({
    manifest_version: "lode.site-capability.manifest.v0",
    package_ref: bossPackageRef,
    capability: { capability_id: "job-search", operation_id: "boss_job_search", operation_mode: "read", version: "0.1.0", lifecycle: "proposed" },
    asset_refs: [{ role: "resource_requirements", path: "resource-requirements.json", status: "present" }, { role: "package_lock", path: "package-lock.json", status: "present", lock_ref: bossLockRef }]
  }));
  await writeFile(
    join(root, "sites", "example", "read-public-page", "resource-requirements.json"),
    JSON.stringify({
      schema_version: "lode.resource-requirements.v0",
      resource_requirements_id: resourceRef,
      resource_requirements_version: "0.1.0",
      package_ref: packageRef,
      operation_mode: "read",
      resource_requirement_profiles: [
        {
          requirement_profile_id: "example-read-with-snapshot",
          operation_boundary: "read",
          required_harbor_facts: [
            { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true },
            { fact_key: "runtime.public_https_navigation.allowed", owner: "Harbor", required: true },
            { fact_key: "snapshot.document_summary.available", owner: "Harbor", required: true },
            { fact_key: "refmap.source_refs.available", owner: "Harbor", required: true },
            { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true }
          ]
        }
      ]
    })
  );
  await writeFile(
    join(root, "sites", "xiaohongshu", "search-notes", "resource-requirements.json"),
    JSON.stringify({
      schema_version: "lode.resource-requirements.v0",
      resource_requirements_id: xiaohongshuResourceRef,
      resource_requirements_version: "0.1.0",
      package_ref: xiaohongshuPackageRef,
      operation_mode: "read",
      resource_requirement_profiles: [
        {
          requirement_profile_id: "xiaohongshu-search-notes-live-runtime",
          operation_boundary: "read",
          required_harbor_facts: [
            { fact_key: "runtime.execution_surface.available", owner: "Harbor", required: true },
            { fact_key: "runtime.origin.www_xiaohongshu_com.available", owner: "Harbor", required: true },
            { fact_key: "identity.user_logged_in.confirmed", owner: "Harbor", required: true },
            { fact_key: "page.vue_app.ready", owner: "Harbor", required: true },
            { fact_key: "page.pinia_store.ready", owner: "Harbor", required: true },
            { fact_key: "source.refs.available", owner: "Harbor", required: true },
            { fact_key: "page.future_probe.ready", owner: "Harbor", required: true },
            { fact_key: "network.future_probe.available", owner: "Harbor", required: true },
            { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true },
            { fact_key: "safety.challenge.absent", owner: "Harbor", required: true }
          ]
        }
      ]
    })
  );
  await writeFile(
    join(root, "sites", "xiaohongshu", "read-note-detail", "resource-requirements.json"),
    JSON.stringify({
      schema_version: "lode.resource-requirements.v0",
      resource_requirements_id: xiaohongshuDetailResourceRef,
      resource_requirements_version: "0.1.0",
      package_ref: xiaohongshuDetailPackageRef,
      operation_mode: "read",
      resource_requirement_profiles: [{
        requirement_profile_id: "xiaohongshu-read-note-detail-live-runtime",
        operation_boundary: "read",
        required_harbor_facts: [
          "runtime.execution_surface.available", "runtime.origin.www_xiaohongshu_com.available", "identity.user_logged_in.confirmed",
          "page.vue_app.ready", "page.pinia_store.ready", "source.refs.available", "evidence.snapshot_ref.available", "safety.challenge.absent", "input.signed_note_ref.available"
        ].map((fact_key) => ({ fact_key, owner: "Harbor", required: true }))
      }]
    })
  );
  await writeFile(join(root, "sites", "boss", "job-search", "resource-requirements.json"), JSON.stringify({
    schema_version: "lode.resource-requirements.v0",
    resource_requirements_id: bossResourceRef,
    resource_requirements_version: "0.1.0",
    package_ref: bossPackageRef,
    operation_mode: "read",
    resource_requirement_profiles: [{ requirement_profile_id: "boss-job-search-live-runtime", operation_boundary: "read", required_harbor_facts: ["runtime.execution_surface.available", "runtime.origin.www_zhipin_com.available", "identity.boss_geek_logged_in.confirmed", "page.boss_spa.ready", "network.wapi_zpgeek.available", "source.refs.available", "evidence.snapshot_ref.available", "safety.challenge.absent"].map((fact_key) => ({ fact_key, owner: "Harbor", required: true })) }]
  }));
  return {
    registryPath: join(root, "registry", "local-packages.json"),
    allowlistAssetSha256: fixtureAllowlistSha256(runtimeAllowlist),
    runtimeAdmissionAssetSha256: {
      "registry/detail-runtime-consumption.json": createHash("sha256").update(canonicalJson(detailRuntimeConsumption)).digest("hex"),
      "registry/validate-only-runtime-consumption.json": createHash("sha256").update(canonicalJson(validateOnlyRuntimeConsumption)).digest("hex")
    }
  };
}

function createHarborMock(
  ready: boolean,
  paths: string[],
  bodies: Array<{ path: string; body: JsonObject }> = [],
  sceneOverrides: JsonObject = {},
  evidenceBody: JsonObject = { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
  sessionOverrides: JsonObject = {},
  siteResourceBody: JsonObject | undefined = undefined,
  readOperationOverrides: JsonObject | ((body: JsonObject, holderRef: string) => JsonObject) = {},
  identityRecordOverrides: JsonObject = {},
  cleanupBehavior: "success" | "unavailable" | "hang" | "inconsistent" | "owner_none_held" = "success"
): Server {
  const sessionRef = "session_runtime_api_ready";
  let currentHolderRef = "";
  let cleanupState: "held" | "released" | "closed" | "inconsistent" = "held";
  const sitePage = siteResourceBody?.page as JsonObject | undefined;
  const sessionOrigin = typeof sitePage?.origin === "string" ? sitePage.origin : "https://example.org";
  const sessionSiteId = typeof siteResourceBody?.site_id === "string" ? siteResourceBody.site_id : "example";
  const scene = {
    schema_version: "harbor-page-scene-refs/v0",
    runtime_session_ref: sessionRef,
    snapshot_ref: "snapshot_runtime_api_ready",
    refmap_ref: "refmap_runtime_api_ready",
    source_trace_ref: "source_trace_runtime_api_ready",
    evidence_refs: ["evidence_runtime_api_snapshot"],
    captured_at: "2026-07-08T00:00:00.000Z",
    page_summary: {
      title: "Example Domain",
      url: "https://example.org/",
      summary: "Public page summary captured by Harbor refs."
    },
    unavailable: null,
    ...sceneOverrides
  };

  return createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    const protectedRequest = request.method === "POST" && (
      request.url === "/runtime/identity-environment-sessions" ||
      /^\/runtime\/(?:identity-environment-)?sessions\/[^/]+\/(?:lock|release|stop|snapshot|write-precheck-facts|read-operations|validate-only-write-precheck)$/.test(request.url ?? "")
    );
    if (protectedRequest && request.headers.authorization !== `Bearer ${harborSupervisorToken}`) {
      sendJson(response, 401, { status: "unavailable", failure_class: "supervisor_authorization_required", retryable: false });
      return;
    }
    void readRequestJson(request).then((body) => {
      if (request.method === "POST") bodies.push({ path: `${request.method} ${request.url}`, body });
      if (request.method === "GET" && request.url === "/readiness") {
        sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready" });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/browser-providers") {
        sendJson(response, 200, {
          schema_version: "harbor-browser-provider-status/v0",
          providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }]
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/identity-environments/identity-env_runtime_api") {
        sendJson(response, 200, {
          schema_version: "harbor-local-identity-environment-store/v0",
          identity_environment_ref: "identity-env_runtime_api",
          site: { site_id: sessionSiteId, origin: sessionOrigin, display_name: "Runtime identity", account_ref: "account_runtime_api" },
          status: {
            readiness: "ready",
            login_state: "logged_in",
            authentication_provenance: "user_confirmed_managed_session",
            browser_storage_state: "present",
            manual_authentication_state: "completed",
            recovery_required: false,
            blocking_reasons: []
          },
          refs: {
            execution_identity_ref: "identity-env_runtime_api:execution",
            profile_ref: "profile_runtime_api",
            profile_storage_ref: "profile_storage_ref_runtime_api"
          },
          environment_summary: {
            provider_id: "cloakbrowser",
            proxy_state: "configured",
            region: "CN",
            language: "zh-CN",
            timezone: "Asia/Shanghai",
            browser_family: "cloakbrowser",
            fingerprint_summary: "provider_claim"
          },
          public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed" },
          ...identityRecordOverrides
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/identity-environment-sessions") {
        currentHolderRef = typeof body.holder_ref === "string" ? body.holder_ref : "";
        cleanupState = "held";
        sendJson(response, 200, {
          identity_environment_facts: liveSessionIdentity(sessionSiteId, sessionOrigin),
          runtime_facts: liveRuntimeFacts(),
          ...sessionOverrides
        });
        return;
      }
      if (request.method === "GET" && request.url === `/runtime/sessions/${sessionRef}`) {
        if (cleanupBehavior === "hang") return;
        if (cleanupBehavior === "owner_none_held") {
          sendJson(response, 200, {
            runtime_session_ref: sessionRef,
            lifecycle_state: "idle",
            control_owner: "none",
            control_lock: { owner: "core_task", state: "held", holder_ref: currentHolderRef }
          });
          return;
        }
        if (cleanupState === "released" || cleanupState === "closed") {
          sendJson(response, 200, {
            runtime_session_ref: sessionRef,
            lifecycle_state: cleanupState === "closed" ? "closed" : "idle",
            control_owner: "none",
            control_lock: { owner: "none", state: "released", holder_ref: null }
          });
          return;
        }
        if (cleanupState === "inconsistent") {
          sendJson(response, 200, {
            runtime_session_ref: sessionRef,
            lifecycle_state: "idle",
            control_owner: "none",
            control_lock: { owner: "core_task", state: "held", holder_ref: currentHolderRef }
          });
          return;
        }
        sendJson(response, 200, {
          runtime_session_ref: sessionRef,
          lifecycle_state: "active",
          control_owner: "core_task",
          control_lock: { owner: "core_task", state: "held", holder_ref: currentHolderRef }
        });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/snapshot`) {
        sendJson(response, 200, { status: "captured", core_scene_ref: scene, evidence_refs: scene.evidence_refs });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/write-precheck-facts`) {
        sendJson(response, 200, {
          schema_version: "harbor-write-precheck-facts/v0", runtime_session_ref: sessionRef, provider_ref: "harbor:provider/cloakbrowser", profile_ref: "profile_runtime_api",
          writable_target: { target_ref: body.target_ref, runtime_session_ref: sessionRef, snapshot_ref: "snapshot_runtime_api_ready", refmap_ref: "refmap_runtime_api_ready", evidence_refs: ["evidence_runtime_api_snapshot"] },
          form_state: { snapshot_ref: "snapshot_runtime_api_ready", fields: [], state_summary: "Public field states only." },
          pre_write_guard: { status: "active", no_submit_guard: "active", blocked_events: ["publish", "save", "upload", "submit", "schedule"], enforcement: "facts_only_no_real_submit", runtime_ready: true, blocking_reasons: [] },
          privacy_boundary: { raw_values: "not_exposed", credential_profile_storage: "not_exposed", page_network_capture: "not_exposed", export_boundary: "refs_and_redacted_field_state_only" }, unavailable: null
        });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/read-operations`) {
        const operationOverrides = typeof readOperationOverrides === "function"
          ? readOperationOverrides(body, currentHolderRef)
          : readOperationOverrides;
        sendJson(response, 200, {
          schema_version: "harbor-allowlisted-read-operation/v0",
          status: "completed",
          operation_ref: "read_operation_11111111-1111-4111-8111-111111111111",
          runtime_session_ref: sessionRef,
          site_id: "xiaohongshu",
          operation_id: "xhs_search_notes",
          operation_mode: "read",
          observed_at: new Date().toISOString(),
          public_summary_ref: "read_result_22222222-2222-4222-8222-222222222222",
          public_summary: { schema_version: "harbor-read-operation-public-summary/v0", operation_id: "xhs_search_notes", result_kind: "xiaohongshu_search_notes_surface", surface: "search_result", result_state: "operation_read_response_observed", response_status: 200, result_count: 1, detail_refs: [detailRefForRun(currentHolderRef)], source_signals: ["pinia_store", "xhs_search_read_network"] },
          source_refs: [{ kind: "pinia_store_summary", ref: "source_11111111-1111-4111-8111-111111111111" }, { kind: "network_summary", ref: "source_22222222-2222-4222-8222-222222222222" }, { kind: "dom_snapshot_summary", ref: "source_33333333-3333-4333-8333-333333333333" }],
          evidence_refs: ["evidence_11111111-1111-4111-8111-111111111111"],
          evidence_ref_kinds: [{ kind: "snapshot_ref", ref: "evidence_11111111-1111-4111-8111-111111111111" }, { kind: "post_check_ref", ref: "post_check_11111111-1111-4111-8111-111111111111" }],
          post_check: { post_check_ref: "post_check_11111111-1111-4111-8111-111111111111", status: "passed", reason: "managed_provider_read_probe_completed" },
          lode_pin: { repository: "WebEnvoy/Lode", commit: "e36a4a7", asset_path: "registry/runtime-consumption-allowlist.json", asset_sha256: "5aa6be8bd416bbd19f73dcfab995f62f769849923f2aa2e995da974b0f329184", mirror_payload_sha256: "3b32e37e04cb008c7e1c072ead35919cde6e498ebfcea34a57de889559a0f141", allowlist_id: "lode.xhs-boss.read.runtime-consumption", allowlist_version: "0.1.0", asset_owner: "Lode", consumer: { repository: "WebEnvoy/Harbor", issue: "#245", purpose: "allowlisted one-shot read-only operation admission" } },
          public_boundary: { output: "public_summary_and_refs_only", raw_credentials: "not_exposed", raw_profile_storage: "not_exposed", raw_cdp_endpoint: "not_exposed", raw_dom: "not_exposed", raw_har: "not_exposed", raw_network_bodies: "not_exposed", screenshot_body: "not_exposed", external_write_actions: "not_performed" },
          ...operationOverrides
        });
        return;
      }
      if (request.method === "POST" && (request.url === `/runtime/sessions/${sessionRef}/release` || request.url === `/runtime/sessions/${sessionRef}/stop`)) {
        if (cleanupBehavior === "unavailable") {
          sendJson(response, 200, { status: "unavailable", failure_class: "session_cleanup_failed", retryable: true });
          return;
        }
        cleanupState = cleanupBehavior === "inconsistent"
          ? "inconsistent"
          : request.url.endsWith("/stop") ? "closed" : "released";
        sendJson(response, 200, {
          status: request.url.endsWith("/stop") ? "stopped" : "released",
          runtime_session_ref: sessionRef,
          control_owner: "none",
          control_lock: { owner: "none", state: "released", holder_ref: null }
        });
        return;
      }
      if (request.method === "GET" && request.url?.startsWith(`/runtime/sessions/${sessionRef}/site-resource-facts`)) {
        sendJson(response, 200, siteResourceBody ?? {
          status: "unavailable",
          failure_class: "unsupported_site",
          retryable: false
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/evidence/evidence_runtime_api_snapshot") {
        sendJson(response, 200, evidenceBody);
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    });
  });
}

function createBadJsonHarborMock(): Server {
  return createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end("{");
  });
}

function createIdentityRequiredHarborMock(): Server {
  return createServer((request, response) => {
    void readRequestJson(request).then(() => {
      if (request.method === "GET" && request.url === "/readiness") {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/browser-providers") {
        sendJson(response, 200, {
          schema_version: "harbor-browser-provider-status/v0",
          providers: [{ provider_id: "chrome_official", install: { status: "installed", launchability: "launchable" } }]
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/identity-environment-sessions") {
        sendJson(response, 400, {
          status: "unavailable",
          failure_class: "identity_environment_required",
          retryable: true,
          public_boundary: {
            output: "status_and_redacted_refs_only",
            raw_material: "not_exposed"
          }
        });
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    });
  });
}

async function assertLodeResolverStaysUnderRoot(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-lode-confined-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "webenvoy-lode-outside-"));
  try {
    await mkdir(join(root, "registry"), { recursive: true });
    await mkdir(join(root, "sites", "example", "read-public-page"), { recursive: true });
    await writeFile(
      join(root, "registry", "local-packages.json"),
      JSON.stringify({
        schema_version: "lode.local-package-registry.v0",
        entries: [
          {
            package_ref: packageRef,
            package_path: "sites/example/read-public-page",
            manifest_path: "sites/example/read-public-page/manifest.json",
            lock_ref: lockRef,
            capability_id: "read-public-page",
            operation_mode: "read",
            version: "0.1.0",
            resource_requirements_path: "../outside-resource-requirements.json"
          },
          {
            package_ref: "lode://site-capability/example/escape-manifest@0.1.0",
            package_path: "sites/example/read-public-page",
            manifest_path: "../outside-manifest.json",
            lock_ref: lockRef,
            capability_id: "read-public-page",
            operation_mode: "read",
            version: "0.1.0"
          }
        ]
      })
    );
    await writeFile(
      join(root, "sites", "example", "read-public-page", "manifest.json"),
      JSON.stringify({
        manifest_version: "lode.site-capability.manifest.v0",
        package_ref: packageRef,
        capability: {
          capability_id: "read-public-page",
          operation_mode: "read",
          version: "0.1.0"
        }
      })
    );
    await writeFile(
      join(outsideRoot, "resource-requirements.json"),
      JSON.stringify({
        schema_version: "lode.resource-requirements.v0",
        resource_requirements_id: resourceRef,
        resource_requirements_version: "0.1.0",
        package_ref: packageRef,
        operation_mode: "read",
        resource_requirement_profiles: []
      })
    );
    await symlink(join(outsideRoot, "resource-requirements.json"), join(root, "sites", "example", "read-public-page", "symlink-resource-requirements.json"));
    const resolver = createLocalLodePackageResolver({ registryPath: join(root, "registry", "local-packages.json") });
    assert.equal(asRecord(await resolver({ package_ref: packageRef, task_intent: {} })).code, "resource_requirements_missing");
    assert.equal(asRecord(await resolver({ package_ref: "lode://site-capability/example/escape-manifest@0.1.0", task_intent: {} })).code, "asset_missing");
    await writeFile(
      join(root, "registry", "local-packages.json"),
      JSON.stringify({
        schema_version: "lode.local-package-registry.v0",
        entries: [
          {
            package_ref: packageRef,
            package_path: "sites/example/read-public-page",
            manifest_path: "sites/example/read-public-page/manifest.json",
            lock_ref: lockRef,
            capability_id: "read-public-page",
            operation_mode: "read",
            version: "0.1.0",
            resource_requirements_path: "sites/example/read-public-page/symlink-resource-requirements.json"
          }
        ]
      })
    );
    assert.equal(asRecord(await resolver({ package_ref: packageRef, task_intent: {} })).code, "resource_requirements_missing");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
}

function bossDeferredTaskIntent(packageRef: string, entrypoint: "api" | "cli" | "mcp" | "sdk" | "app", intentId: string): JsonObject {
  const detail = packageRef === bossDetailPackageRef;
  const precheck = packageRef === bossPrecheckPackageRef;
  const targetRef = detail || precheck
    ? "https://www.zhipin.com/"
    : "https://www.zhipin.com/web/geek/job?query=AI&city=101010100";
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint,
    user_intent: { summary: "Exercise the BOSS production admission gate." },
    capability: {
      ref: `lode:capability/${detail ? "read-job-detail" : precheck ? "greet-precheck" : "job-search"}`,
      version: detail ? "0.1.1" : "0.1.0",
      source_ref: packageRef
    },
    input: { summary: "Refs-only admission check." },
    scope: { target_type: precheck ? "boss_greet_precheck" : detail ? "boss_job_detail" : "boss_job_search", target_ref: targetRef },
    policy: { risk: precheck ? "write" : "read", execution_intent: precheck ? "validate_only" : "read" },
    resource_requirement_refs: [`${detail ? "boss.read-job-detail" : precheck ? "boss.greet-precheck" : "boss.job-search"}.resources`],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

async function assertBossProductionAdmissionDisabled(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-boss-production-policy-"));
  const runDir = await mkdtemp(join(tmpdir(), "webenvoy-boss-production-runs-"));
  let harborCalls = 0;
  const harborRuntimeClient: HarborRuntimeClient = {
    async collectAdmissionFacts() { harborCalls += 1; throw new Error("Harbor must not be called"); },
    async executeReadOperation() { harborCalls += 1; throw new Error("Harbor must not be called"); },
    async executeValidateOnlyWritePrecheck() { harborCalls += 1; throw new Error("Harbor must not be called"); },
    async releaseCoreTaskSession() { harborCalls += 1; throw new Error("Harbor must not be called"); }
  };
  try {
    const { registryPath, allowlistAssetSha256, runtimeAdmissionAssetSha256 } = await writeLodeRegistry(root);
    const resolver = createLocalLodePackageResolver({ registryPath, allowlistAssetSha256, runtimeAdmissionAssetSha256 });
    const store = createFileRunRecordStore({ directory: runDir });
    const server = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient });
    const port = await listen(server);
    try {
      const entrypoints = ["api", "cli", "mcp", "sdk", "app"] as const;
      const packageRefs = [bossPackageRef, bossDetailPackageRef, bossPrecheckPackageRef];
      for (const entrypoint of entrypoints) {
        for (const packageRef of packageRefs) {
          const suffix = `${entrypoint}_${packageRef.includes("read-job-detail") ? "detail" : packageRef.includes("greet-precheck") ? "precheck" : "search"}`;
          const response = await postJson(port, "/tasks", {
            run_id: `run_boss_disabled_${suffix}`,
            package_ref: packageRef,
            task_intent: bossDeferredTaskIntent(packageRef, entrypoint, `intent_boss_disabled_${suffix}`),
            ...(packageRef === bossPackageRef ? { public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 }, harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" } } : {})
          });
          assert.equal(response.status, 422, suffix);
          const body = asRecord(response.body);
          const error = asRecord(body.error);
          const run = asRecord(body.run);
          assert.equal(error.category, "capability_contract", suffix);
          assert.equal(error.code, "runtime_admission_disabled", suffix);
          assert.equal(error.recovery_hint, "wait_for_scope_activation", suffix);
          assert.equal(run.status, "failed", suffix);
          assert.equal(asRecord(run.admission).decision, "blocked_pre_admission", suffix);
          assert.equal(run.result_ref, undefined, suffix);
          assert.deepEqual(run.evidence_refs ?? [], [], suffix);
        }
      }
      const direct = await submitRuntimeTask(store, {
        run_id: "run_boss_disabled_direct_core",
        package_ref: bossPackageRef,
        task_intent: bossDeferredTaskIntent(bossPackageRef, "sdk", "intent_boss_disabled_direct_core")
      }, { lodePackageResolver: resolver, harborRuntimeClient });
      assert.equal(direct.ok, false);
      if (direct.ok) throw new Error("Direct Core BOSS task must be blocked");
      assert.equal(direct.failure.code, "runtime_admission_disabled");
      assert.equal(direct.run_record?.admission.decision, "blocked_pre_admission");
      const unknownPackageRef = "lode://site-capability/boss/unknown-operation@0.1.0";
      const unknown = await postJson(port, "/tasks", {
        run_id: "run_boss_disabled_unknown_operation",
        package_ref: unknownPackageRef,
        task_intent: bossDeferredTaskIntent(unknownPackageRef, "api", "intent_boss_disabled_unknown_operation")
      });
      assert.equal(unknown.status, 422);
      assert.equal(asRecord(asRecord(unknown.body).error).code, "package_not_found");
      assert.equal(harborCalls, 0);
    } finally {
      await close(server);
    }

    for (const [name, mutate, code] of [
      ["missing", (entry: JsonObject) => { delete entry.runtime_admission; }, "runtime_admission_policy_missing"],
      ["unknown", (entry: JsonObject) => { entry.runtime_admission = { enabled: false, status: "unknown", recheck_condition: "not_applicable" }; }, "runtime_admission_policy_invalid"],
      ["drift", (_entry: JsonObject, operation: JsonObject) => { operation.runtime_admission = currentRuntimeAdmission; }, "runtime_admission_policy_drift"]
    ] as const) {
      const caseRoot = join(root, name);
      const fixture = await writeLodeRegistry(caseRoot);
      const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as JsonObject;
      const registryEntry = (registry.entries as JsonObject[]).find((entry) => entry.package_ref === bossPackageRef)!;
      const allowlistPath = join(caseRoot, "registry", "runtime-consumption-allowlist.json");
      const allowlist = JSON.parse(await readFile(allowlistPath, "utf8")) as JsonObject;
      const operationEntry = (allowlist.entries as JsonObject[]).find((entry) => entry.package_ref === bossPackageRef)!;
      mutate(registryEntry, operationEntry);
      await writeFile(fixture.registryPath, JSON.stringify(registry));
      await writeFile(allowlistPath, JSON.stringify(allowlist));
      const result = await createLocalLodePackageResolver({ registryPath: fixture.registryPath, allowlistAssetSha256: fixtureAllowlistSha256(allowlist) })({
        package_ref: bossPackageRef,
        task_intent: bossDeferredTaskIntent(bossPackageRef, "api", `intent_boss_policy_${name}`)
      });
      assert("category" in result);
      assert.equal(result.code, code, name);
    }

    for (const [packageRef, assetName] of [
      [bossDetailPackageRef, "detail-runtime-consumption.json"],
      [bossPrecheckPackageRef, "validate-only-runtime-consumption.json"]
    ] as const) {
      const caseRoot = join(root, `coordinated-${assetName}`);
      const fixture = await writeLodeRegistry(caseRoot);
      const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as JsonObject;
      const registryEntry = (registry.entries as JsonObject[]).find((entry) => entry.package_ref === packageRef)!;
      registryEntry.runtime_admission = currentRuntimeAdmission;
      await writeFile(fixture.registryPath, JSON.stringify(registry));
      const operationPath = join(caseRoot, "registry", assetName);
      const operationAsset = JSON.parse(await readFile(operationPath, "utf8")) as JsonObject;
      const operationEntry = (operationAsset.entries as JsonObject[]).find((entry) => entry.package_ref === packageRef)!;
      operationEntry.runtime_admission = currentRuntimeAdmission;
      await writeFile(operationPath, JSON.stringify(operationAsset));
      const result = await createLocalLodePackageResolver({
        registryPath: fixture.registryPath,
        allowlistAssetSha256: fixture.allowlistAssetSha256,
        runtimeAdmissionAssetSha256: fixture.runtimeAdmissionAssetSha256
      })({ package_ref: packageRef, task_intent: bossDeferredTaskIntent(packageRef, "api", `intent_boss_coordinated_${assetName}`) });
      assert("category" in result);
      assert.equal(result.code, "runtime_admission_policy_pin_mismatch", assetName);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
}

function createDuplicateRunRaceStore(store: FileRunRecordStore): FileRunRecordStore {
  return {
    ...store,
    async getRunRecord(runId: string): Promise<RunRecord | undefined> {
      if (runId === "run_api_submit_race_duplicate") return undefined;
      return store.getRunRecord(runId);
    },
    async createRunRecord(input: CreateRunRecordInput): Promise<RunRecord> {
      if (input.run_id === "run_api_submit_race_duplicate") {
        throw new Error(`run record already exists: ${input.run_id}`);
      }
      return store.createRunRecord(input);
    }
  };
}

function createTransientFinalizationFailureStore(store: FileRunRecordStore): FileRunRecordStore {
  let failed = false;
  return {
    ...store,
    async updateRunRecord(runId, patch) {
      if (runId === "run_api_submit_persistence_failure" && patch.status === "succeeded" && !failed) {
        failed = true;
        throw new Error("injected terminal persistence failure");
      }
      return store.updateRunRecord(runId, patch);
    }
  };
}

export async function assertRuntimeTaskSubmitApi(): Promise<void> {
  await assertXiaohongshuValidateOnlyTask();
  await assertWritePrecheckEvidenceReadback();
  await assertBossProductionAdmissionDisabled();
  const previousSupervisorToken = process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
  process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = harborSupervisorToken;
  const root = await mkdtemp(join(tmpdir(), "webenvoy-lode-registry-"));
  const runDir = await mkdtemp(join(tmpdir(), "webenvoy-api-submit-runs-"));
  const paths: string[] = [];
  const bodies: Array<{ path: string; body: JsonObject }> = [];
  const harbor = createHarborMock(true, paths, bodies);
  const mismatchedSceneHarbor = createHarborMock(true, [], [], {
    page_summary: {
      title: "Unexpected Origin",
      url: "https://evil.example/",
      summary: "A mismatched origin must not complete the Core read result."
    }
  });
  const missingSceneUrlHarbor = createHarborMock(true, [], [], {
    page_summary: {
      title: "Missing URL",
      summary: "A scene without a valid page URL must not complete the Core read result."
    }
  });
  const invalidSceneUrlHarbor = createHarborMock(true, [], [], {
    page_summary: {
      title: "Invalid URL",
      url: "not-a-valid-url",
      summary: "A scene without a parseable page URL must not complete the Core read result."
    }
  });
  const invalidEvidenceHarbor = createHarborMock(true, [], [], {
    evidence_refs: ["evidence_runtime_api_snapshot", ""]
  });
  const malformedEvidenceHarbor = createHarborMock(true, [], [], {}, { access_state: "available" }, { resource_facts: readyResourceFacts });
  const mismatchedEvidenceHarbor = createHarborMock(
    true,
    [],
    [],
    {},
    { evidence_ref: "evidence_other_snapshot", access_state: "available" },
    { resource_facts: readyResourceFacts }
  );
  const xiaohongshuPaths: string[] = [];
  const xiaohongshuBodies: Array<{ path: string; body: JsonObject }> = [];
  const xiaohongshuScene = {
    page_summary: {
      title: "Xiaohongshu search",
      url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
      summary: "Xiaohongshu search page summary captured by Harbor refs."
    }
  };
  const xiaohongshuDetailOperation = (body: JsonObject, holderRef: string): JsonObject => {
    if (body.operation_id !== "xhs_read_note_detail") {
      const searchEvidenceRef = opaqueRefForRun("evidence", holderRef);
      const searchPostCheckRef = opaqueRefForRun("post_check", holderRef);
      return {
        operation_ref: opaqueRefForRun("read_operation", holderRef),
        public_summary_ref: opaqueRefForRun("read_result", holderRef),
        source_refs: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"].map((kind) => ({ kind, ref: opaqueRefForRun("source", `${kind}:${holderRef}`) })),
        evidence_refs: [searchEvidenceRef],
        evidence_ref_kinds: [{ kind: "snapshot_ref", ref: searchEvidenceRef }, { kind: "post_check_ref", ref: searchPostCheckRef }],
        post_check: { post_check_ref: searchPostCheckRef, status: "passed", reason: "managed_provider_read_probe_completed" }
      };
    }
    if (holderRef.includes("challenge")) return { status: "unavailable", failure_class: "safety_challenge", retryable: false };
    if (holderRef.includes("unavailable")) return { status: "unavailable", failure_class: "provider_probe_unavailable", retryable: true };
    if (holderRef.includes("malformed")) return { schema_version: "malformed-detail-operation" };
    const sourceRefs = ["pinia_store_summary", "network_summary", "dom_snapshot_summary"].map((kind) => ({
      kind,
      ref: opaqueRefForRun("source", `${kind}:${holderRef}`)
    }));
    const evidenceRefs = [opaqueRefForRun("evidence", holderRef)];
    const postCheckRef = opaqueRefForRun("post_check", holderRef);
    const evidenceRefKinds = [
      { kind: "snapshot_ref", ref: evidenceRefs[0] },
      { kind: "post_check_ref", ref: postCheckRef }
    ];
    return {
      operation_ref: opaqueRefForRun("read_operation", holderRef),
      public_summary_ref: opaqueRefForRun("read_result", holderRef),
      site_id: "xiaohongshu",
      operation_id: "xhs_read_note_detail",
      public_summary: {
        schema_version: "harbor-read-operation-public-summary/v0",
        operation_id: "xhs_read_note_detail",
        result_kind: "xiaohongshu_note_detail_surface",
        surface: "note_detail",
        result_state: "operation_read_response_observed",
        response_status: 200,
        normalized: {
          kind: "xiaohongshu_note_detail",
          canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
          note_id: "0123456789abcdef01234567",
          title: "公开笔记标题",
          summary: "公开笔记摘要",
          body_summary: "公开正文摘要",
          author: { display_name: "公开作者", author_id: "author_270", profile_url: "https://www.xiaohongshu.com/user/profile/author_270" },
          interaction_metrics: { likes: "10", comments: "2", collects: "3", shares: "1" },
          source_citation: {
            kind: "xhs_note_detail_ref",
            note_id: "0123456789abcdef01234567",
            url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
            field_sources: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
          },
          source_status: "located"
        },
        source_signals: ["pinia_note_store_ready", "xhs_note_detail_document", "xhs_note_detail_rendered"]
      },
      source_refs: holderRef.includes("missing_refs") ? sourceRefs.slice(0, 2) : holderRef.includes("extra_refs")
        ? [...sourceRefs, { kind: "raw_dom_ref", ref: opaqueRefForRun("source", `raw:${holderRef}`) }]
        : sourceRefs,
      evidence_refs: evidenceRefs,
      evidence_ref_kinds: evidenceRefKinds,
      post_check: {
        post_check_ref: postCheckRef,
        status: holderRef.includes("post_check_failure") ? "failed" : "passed",
        reason: "managed_provider_read_probe_completed"
      },
      lode_pin: {
        repository: "WebEnvoy/Lode",
        issue: "#268",
        merge_commit: "66d79b4e600565a00515b1c801e84291edc7b0c1",
        asset_path: "registry/detail-runtime-consumption.json",
        asset_sha256: "dca2761b7feb09a0ab86f7202e153da3c97b21a75299af6adaf64eade319deef",
        truth_id: "lode.xhs-boss.detail-read.runtime-consumption",
        asset_owner: "Lode"
      }
    };
  };
  const xiaohongshuHarbor = createHarborMock(
    true,
    xiaohongshuPaths,
    xiaohongshuBodies,
    xiaohongshuScene,
    { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
    {},
    {
      ...readyXiaohongshuSiteFacts,
      resource_facts: (readyXiaohongshuSiteFacts.resource_facts as JsonObject[]).map((fact) =>
        ["page.vue_app.ready", "page.pinia_store.ready", "source.refs.available", "input.signed_note_ref.available"].includes(String(fact.key))
          ? { ...fact, state: "unknown", severity: "warning", message: "Target-page fact is observable only after detail navigation." }
          : fact
      ).concat([{ key: "input.signed_note_ref.available", state: "unknown", source: "validation_evidence", severity: "warning", message: "Opaque detail ref is validated by Core before dispatch." }])
    },
    xiaohongshuDetailOperation
  );
  const bossPaths: string[] = [];
  const bossBodies: Array<{ path: string; body: JsonObject }> = [];
  const bossHarbor = createHarborMock(true, bossPaths, bossBodies, {
    page_summary: { title: "BOSS jobs", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", summary: "BOSS job search." }
  }, undefined, {}, readyBossSiteFacts, {
    site_id: "boss",
    operation_id: "boss_job_search",
    public_summary: { schema_version: "harbor-read-operation-public-summary/v0", operation_id: "boss_job_search", result_kind: "boss_job_search_surface", surface: "web_geek_jobs", result_state: "operation_read_response_observed", response_status: 200, query: "AI", city_code: "101010100", business_code: 0, job_count: 2, source_signals: ["boss_wapi_zpgeek_read_network"] },
    source_refs: [{ kind: "network_summary", ref: "source_44444444-4444-4444-8444-444444444444" }],
    evidence_refs: ["evidence_55555555-5555-4555-8555-555555555555", "evidence_66666666-6666-4666-8666-666666666666"],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: "evidence_55555555-5555-4555-8555-555555555555" }, { kind: "network_summary_ref", ref: "evidence_66666666-6666-4666-8666-666666666666" }, { kind: "post_check_ref", ref: "post_check_77777777-7777-4777-8777-777777777777" }],
    post_check: { post_check_ref: "post_check_77777777-7777-4777-8777-777777777777", status: "passed", reason: "managed_provider_read_probe_completed" }
  });
  const unavailableOperationHarbor = createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, { status: "unavailable", failure_class: "provider_probe_unavailable", retryable: true });
  const safetyChallengeHarbor = createHarborMock(true, [], [], {
    page_summary: { title: "BOSS verification", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", summary: "BOSS verification challenge." }
  }, undefined, {}, readyBossSiteFacts, { site_id: "boss", operation_id: "boss_job_search", status: "unavailable", failure_class: "safety_challenge", retryable: false });
  const unknownFailureHarbor = createHarborMock(true, [], [], {
    page_summary: { title: "BOSS jobs", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", summary: "BOSS job search." }
  }, undefined, {}, readyBossSiteFacts, { site_id: "boss", operation_id: "boss_job_search", status: "unavailable", failure_class: "future_unknown_failure", retryable: true });
  const missingRefsOperationHarbor = createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, { evidence_ref_kinds: [] });
  const driftedSessionOperationHarbor = createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, { runtime_session_ref: "session_other" });
  const driftedBoundaryOperationHarbor = createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, { public_boundary: { output: "public_summary_and_refs_only", raw_credentials: "not_exposed" } });
  const unknownOutcomeHarbor = createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, { schema_version: "malformed-after-dispatch" });
  const operationRefDriftCases: Array<{ name: string; override: JsonObject }> = [
    {
      name: "extra_source_kind",
      override: {
        source_refs: [
          { kind: "pinia_store_summary", ref: "source_11111111-1111-4111-8111-111111111111" },
          { kind: "network_summary", ref: "source_22222222-2222-4222-8222-222222222222" },
          { kind: "dom_snapshot_summary", ref: "source_33333333-3333-4333-8333-333333333333" },
          { kind: "raw_dom_ref", ref: "source_44444444-4444-4444-8444-444444444444" }
        ]
      }
    },
    {
      name: "duplicate_source_kind",
      override: {
        source_refs: [
          { kind: "pinia_store_summary", ref: "source_11111111-1111-4111-8111-111111111111" },
          { kind: "network_summary", ref: "source_22222222-2222-4222-8222-222222222222" },
          { kind: "dom_snapshot_summary", ref: "source_33333333-3333-4333-8333-333333333333" },
          { kind: "network_summary", ref: "source_44444444-4444-4444-8444-444444444444" }
        ]
      }
    },
    {
      name: "extra_evidence_kind",
      override: {
        evidence_refs: ["evidence_11111111-1111-4111-8111-111111111111", "evidence_22222222-2222-4222-8222-222222222222"],
        evidence_ref_kinds: [
          { kind: "snapshot_ref", ref: "evidence_11111111-1111-4111-8111-111111111111" },
          { kind: "har_ref", ref: "evidence_22222222-2222-4222-8222-222222222222" },
          { kind: "post_check_ref", ref: "post_check_11111111-1111-4111-8111-111111111111" }
        ]
      }
    },
    {
      name: "duplicate_source_ref",
      override: {
        source_refs: [
          { kind: "pinia_store_summary", ref: "source_11111111-1111-4111-8111-111111111111" },
          { kind: "network_summary", ref: "source_11111111-1111-4111-8111-111111111111" },
          { kind: "dom_snapshot_summary", ref: "source_33333333-3333-4333-8333-333333333333" }
        ]
      }
    },
    {
      name: "duplicate_evidence_ref",
      override: {
        evidence_refs: ["evidence_11111111-1111-4111-8111-111111111111", "evidence_11111111-1111-4111-8111-111111111111"],
        evidence_ref_kinds: [
          { kind: "snapshot_ref", ref: "evidence_11111111-1111-4111-8111-111111111111" },
          { kind: "post_check_ref", ref: "evidence_11111111-1111-4111-8111-111111111111" }
        ],
        post_check: { post_check_ref: "evidence_11111111-1111-4111-8111-111111111111", status: "passed", reason: "managed_provider_read_probe_completed" }
      }
    },
    {
      name: "source_evidence_ref_reuse",
      override: {
        evidence_refs: ["source_11111111-1111-4111-8111-111111111111"],
        evidence_ref_kinds: [
          { kind: "snapshot_ref", ref: "source_11111111-1111-4111-8111-111111111111" },
          { kind: "post_check_ref", ref: "post_check_11111111-1111-4111-8111-111111111111" }
        ]
      }
    }
  ];
  const operationRefDriftHarbors = operationRefDriftCases.map((entry) =>
    createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, entry.override)
  );
  const bossSummary = asRecord(asRecord({ public_summary: {
    schema_version: "harbor-read-operation-public-summary/v0", operation_id: "boss_job_search", result_kind: "boss_job_search_surface", surface: "web_geek_jobs",
    result_state: "operation_read_response_observed", response_status: 200, query: "AI", city_code: "101010100", business_code: 0, job_count: 2,
    source_signals: ["boss_wapi_zpgeek_read_network"]
  } }).public_summary);
  const bossContractDriftCases: Array<{ name: string; override: JsonObject }> = [
    { name: "query", override: { public_summary: { ...bossSummary, query: "other" } } },
    { name: "city", override: { public_summary: { ...bossSummary, city_code: "101020100" } } },
    { name: "result_kind", override: { public_summary: { ...bossSummary, result_kind: "xiaohongshu_search_notes_surface" } } },
    { name: "surface", override: { public_summary: { ...bossSummary, surface: "search_result" } } },
    { name: "source_signal", override: { public_summary: { ...bossSummary, source_signals: ["pinia_store"] } } },
    { name: "duplicate_signal", override: { public_summary: { ...bossSummary, source_signals: ["boss_wapi_zpgeek_read_network", "boss_wapi_zpgeek_read_network"] } } },
    { name: "extra_summary", override: { public_summary: { ...bossSummary, raw_jobs: [] } } },
    { name: "lode_pin", override: { lode_pin: { repository: "WebEnvoy/Lode", commit: "wrong" } } },
    { name: "extra_ref_kind", override: { source_refs: [{ kind: "network_summary", ref: "source_44444444-4444-4444-8444-444444444444" }, { kind: "raw_network", ref: "source_88888888-8888-4888-8888-888888888888" }] } },
    { name: "duplicate_ref_kind", override: { evidence_ref_kinds: [{ kind: "snapshot_ref", ref: "evidence_55555555-5555-4555-8555-555555555555" }, { kind: "network_summary_ref", ref: "evidence_66666666-6666-4666-8666-666666666666" }, { kind: "network_summary_ref", ref: "evidence_88888888-8888-4888-8888-888888888888" }, { kind: "post_check_ref", ref: "post_check_77777777-7777-4777-8777-777777777777" }] } },
    { name: "unknown_outcome", override: { schema_version: "unknown" } }
  ];
  const bossContractDriftHarbors = bossContractDriftCases.map((entry) => createHarborMock(
    true, [], [], { page_summary: { title: "BOSS jobs", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", summary: "BOSS job search." } },
    undefined, {}, readyBossSiteFacts, { site_id: "boss", operation_id: "boss_job_search", public_summary: bossSummary,
      source_refs: [{ kind: "network_summary", ref: "source_44444444-4444-4444-8444-444444444444" }],
      evidence_refs: ["evidence_55555555-5555-4555-8555-555555555555", "evidence_66666666-6666-4666-8666-666666666666"],
      evidence_ref_kinds: [{ kind: "snapshot_ref", ref: "evidence_55555555-5555-4555-8555-555555555555" }, { kind: "network_summary_ref", ref: "evidence_66666666-6666-4666-8666-666666666666" }, { kind: "post_check_ref", ref: "post_check_77777777-7777-4777-8777-777777777777" }],
      post_check: { post_check_ref: "post_check_77777777-7777-4777-8777-777777777777", status: "passed", reason: "managed_provider_read_probe_completed" }, ...entry.override }
  ));
  const bossAdmissionCases: Array<{ name: string; session?: JsonObject; siteFacts?: JsonObject }> = [
    { name: "session", session: { runtime_facts: liveRuntimeFacts({ lifecycle_state: "closed" }) } },
    { name: "control", session: { runtime_facts: liveRuntimeFacts({ control: { owner: "user", takeover: { available: false } } }) } },
    { name: "challenge", siteFacts: { ...readyBossSiteFacts, resource_facts: (readyBossSiteFacts.resource_facts as JsonObject[]).map((fact) => fact.key === "safety.challenge.absent" ? { ...fact, state: "unknown" } : fact) } }
  ];
  const bossAdmissionPaths = bossAdmissionCases.map(() => [] as string[]);
  const bossAdmissionHarbors = bossAdmissionCases.map((entry, index) => createHarborMock(
    true, bossAdmissionPaths[index]!, [], { page_summary: { title: "BOSS jobs", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", summary: "BOSS job search." } },
    undefined, entry.session ?? {}, entry.siteFacts ?? readyBossSiteFacts
  ));
  const deferredXiaohongshuFactsPaths: string[] = [];
  const deferredXiaohongshuFactsHarbor = createHarborMock(
    true,
    deferredXiaohongshuFactsPaths,
    [],
    xiaohongshuScene,
    { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
    {},
    {
      ...readyXiaohongshuSiteFacts,
      resource_facts: (readyXiaohongshuSiteFacts.resource_facts as JsonObject[]).map((fact) =>
        ["identity.user_logged_in.confirmed", "page.vue_app.ready", "page.pinia_store.ready", "source.refs.available"].includes(String(fact.key))
          ? { ...fact, state: "unknown", severity: "warning", message: "Read-operation probe fact is not safely observable before dispatch." }
          : fact
      )
    }
  );
  const factState = (key: string, state: string): JsonObject => ({
    ...readyXiaohongshuSiteFacts,
    resource_facts: (readyXiaohongshuSiteFacts.resource_facts as JsonObject[]).map((fact) => fact.key === key ? { ...fact, state } : fact)
  });
  const blockedIdentityCases: Array<{ name: string; session: JsonObject; siteFacts?: JsonObject; identityRef?: string; identityRecord?: JsonObject }> = [
    { name: "missing_reason", session: { identity_environment_facts: liveSessionIdentity("xiaohongshu", "https://www.xiaohongshu.com", { login_state: { reason: undefined } }) } },
    { name: "auth_incomplete", session: { identity_environment_facts: liveSessionIdentity("xiaohongshu", "https://www.xiaohongshu.com", { login_state: { manual_authentication_state: "pending" } }) } },
    { name: "recovery_required", session: { identity_environment_facts: liveSessionIdentity("xiaohongshu", "https://www.xiaohongshu.com", { login_state: { recovery_required: true } }) } },
    { name: "wrong_origin", session: { identity_environment_facts: liveSessionIdentity("xiaohongshu", "https://evil.example") } },
    {
      name: "unknown_schema",
      session: { identity_environment_facts: liveSessionIdentity("xiaohongshu", "https://www.xiaohongshu.com", { schema_version: "harbor-local-identity-environment/v999" }) },
      identityRecord: { schema_version: "harbor-local-identity-environment-store/v999" }
    },
    { name: "wrong_site", session: { identity_environment_facts: liveSessionIdentity("boss", "https://www.xiaohongshu.com") } },
    { name: "wrong_ref", session: {}, identityRef: "identity-env_other" },
    { name: "challenge_unknown", session: {}, siteFacts: factState("safety.challenge.absent", "unknown") },
    { name: "lifecycle_closed", session: { runtime_facts: liveRuntimeFacts({ lifecycle_state: "closed" }) } },
    { name: "control_busy", session: { runtime_facts: liveRuntimeFacts({ control: { owner: "user", takeover: { available: false } } }) } },
    { name: "control_agent_takeover", session: { runtime_facts: liveRuntimeFacts({ control: { owner: "agent", takeover: { available: true } } }) } },
    { name: "control_lock_agent", session: { runtime_facts: liveRuntimeFacts({ schema_version: undefined, control_owner: "core_task", control_lock: { owner: "agent" } }) } },
    { name: "future_page_unknown", session: {}, siteFacts: factState("page.future_probe.ready", "unknown") },
    { name: "future_network_unknown", session: {}, siteFacts: factState("network.future_probe.available", "unknown") }
  ];
  const blockedIdentityPaths = blockedIdentityCases.map(() => [] as string[]);
  const blockedIdentityHarbors = blockedIdentityCases.map((entry, index) => createHarborMock(
    true,
    blockedIdentityPaths[index]!,
    [],
    xiaohongshuScene,
    { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
    entry.session,
    entry.siteFacts ?? readyXiaohongshuSiteFacts,
    {},
    entry.identityRecord
  ));
  const publicIdentityPaths: string[] = [];
  const publicIdentityHarbor = createHarborMock(
    true,
    publicIdentityPaths,
    [],
    {},
    { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
    { identity_environment_facts: undefined }
  );
  const offlineHarbor = createHarborMock(false, []);
  const cleanupFailureHarborPaths: string[] = [];
  const cleanupFailureHarbor = createHarborMock(true, cleanupFailureHarborPaths, [], {}, undefined, {}, undefined, {}, {}, "unavailable");
  const cleanupTimeoutHarborPaths: string[] = [];
  const cleanupTimeoutHarbor = createHarborMock(true, cleanupTimeoutHarborPaths, [], {}, undefined, {}, undefined, {}, {}, "hang");
  const inconsistentCleanupHarborPaths: string[] = [];
  const inconsistentCleanupHarbor = createHarborMock(true, inconsistentCleanupHarborPaths, [], {}, undefined, {}, undefined, {}, {}, "inconsistent");
  const ownerNoneHeldHarborPaths: string[] = [];
  const ownerNoneHeldHarbor = createHarborMock(true, ownerNoneHeldHarborPaths, [], {}, undefined, {}, undefined, {}, {}, "owner_none_held");
  const dualFailureHarborPaths: string[] = [];
  const dualFailureHarbor = createHarborMock(true, dualFailureHarborPaths, [], {}, undefined, {
    runtime_facts: {
      runtime_session_ref: "session_runtime_api_ready",
      provider_ref: "harbor:provider/cloakbrowser",
      provider_mode: "local_dedicated_profile",
      lifecycle_state: "active",
      viewer_ref: "viewer_runtime_api"
    }
  }, undefined, {}, {}, "unavailable");
  const badJsonHarbor = createBadJsonHarborMock();
  const identityRequiredHarbor = createIdentityRequiredHarborMock();
  try {
    const { registryPath, allowlistAssetSha256, runtimeAdmissionAssetSha256 } = await writeLodeRegistry(root, { bossFixtureEnabled: true });
    const resolver = createLocalLodePackageResolver({ registryPath, allowlistAssetSha256, runtimeAdmissionAssetSha256 });
    const nonPinnedResolver = async (input: Parameters<typeof resolver>[0]) => {
      const resolved = await resolver(input);
      if ("category" in resolved || !resolved.runtime_consumption) return resolved;
      return {
        ...resolved,
        runtime_consumption: { ...resolved.runtime_consumption, package_ref: "lode://site-capability/other/search-notes@0.1.0" }
      };
    };
    const pinDrift = await createLocalLodePackageResolver({ registryPath })({ package_ref: xiaohongshuPackageRef, task_intent: xiaohongshuTaskIntent("intent_pin_drift") });
    assert("category" in pinDrift && pinDrift.code === "runtime_consumption_allowlist_pin_mismatch");
    const harborPort = await listen(harbor);
    const mismatchedSceneHarborPort = await listen(mismatchedSceneHarbor);
    const missingSceneUrlHarborPort = await listen(missingSceneUrlHarbor);
    const invalidSceneUrlHarborPort = await listen(invalidSceneUrlHarbor);
    const invalidEvidenceHarborPort = await listen(invalidEvidenceHarbor);
    const malformedEvidenceHarborPort = await listen(malformedEvidenceHarbor);
    const mismatchedEvidenceHarborPort = await listen(mismatchedEvidenceHarbor);
    const xiaohongshuHarborPort = await listen(xiaohongshuHarbor);
    const bossHarborPort = await listen(bossHarbor);
    const unavailableOperationHarborPort = await listen(unavailableOperationHarbor);
    const safetyChallengeHarborPort = await listen(safetyChallengeHarbor);
    const unknownFailureHarborPort = await listen(unknownFailureHarbor);
    const missingRefsOperationHarborPort = await listen(missingRefsOperationHarbor);
    const driftedSessionOperationHarborPort = await listen(driftedSessionOperationHarbor);
    const driftedBoundaryOperationHarborPort = await listen(driftedBoundaryOperationHarbor);
    const unknownOutcomeHarborPort = await listen(unknownOutcomeHarbor);
    const operationRefDriftHarborPorts = await Promise.all(operationRefDriftHarbors.map(listen));
    const bossContractDriftHarborPorts = await Promise.all(bossContractDriftHarbors.map(listen));
    const bossAdmissionHarborPorts = await Promise.all(bossAdmissionHarbors.map(listen));
    const deferredXiaohongshuFactsHarborPort = await listen(deferredXiaohongshuFactsHarbor);
    const blockedIdentityHarborPorts = await Promise.all(blockedIdentityHarbors.map(listen));
    const publicIdentityHarborPort = await listen(publicIdentityHarbor);
    const offlineHarborPort = await listen(offlineHarbor);
    const cleanupFailureHarborPort = await listen(cleanupFailureHarbor);
    const cleanupTimeoutHarborPort = await listen(cleanupTimeoutHarbor);
    const inconsistentCleanupHarborPort = await listen(inconsistentCleanupHarbor);
    const ownerNoneHeldHarborPort = await listen(ownerNoneHeldHarbor);
    const dualFailureHarborPort = await listen(dualFailureHarbor);
    const badJsonHarborPort = await listen(badJsonHarbor);
    const identityRequiredHarborPort = await listen(identityRequiredHarbor);
    delete process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
    const missingTokenClient = createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` });
    process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = harborSupervisorToken;
    const missingTokenAdmission = await missingTokenClient.collectAdmissionFacts({
      run_id: "run_missing_harbor_supervisor_token",
      task_intent: taskIntent("intent_missing_harbor_supervisor_token"),
      package_ref: packageRef,
      harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
    });
    assert("category" in missingTokenAdmission && missingTokenAdmission.code === "harbor_runtime_supervisor_token_missing");
    let remoteAuthorization: string | null = null;
    const remoteClient = createHttpHarborRuntimeClient({
      baseUrl: "https://harbor.example",
      fetch: async (_url, init) => {
        remoteAuthorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({
          schema_version: "harbor-allowlisted-read-operation/v0",
          status: "unavailable",
          runtime_session_ref: "session_remote",
          site_id: "xiaohongshu",
          operation_id: "xhs_search_notes",
          failure_class: "provider_probe_unavailable",
          retryable: true
        }), { status: 409, headers: { "content-type": "application/json" } });
      }
    });
    await remoteClient.executeReadOperation({ runtime_session_ref: "session_remote", site_id: "xiaohongshu", operation_id: "xhs_search_notes", query: "city coffee" });
    assert.equal(remoteAuthorization, null);
    let ipv6Authorization: string | null = null;
    const ipv6Client = createHttpHarborRuntimeClient({
      baseUrl: "http://[::1]:8787",
      fetch: async (_url, init) => {
        ipv6Authorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({
          schema_version: "harbor-allowlisted-read-operation/v0",
          status: "unavailable",
          runtime_session_ref: "session_ipv6",
          site_id: "xiaohongshu",
          operation_id: "xhs_search_notes",
          failure_class: "provider_probe_unavailable",
          retryable: true
        }), { status: 409, headers: { "content-type": "application/json" } });
      }
    });
    await ipv6Client.executeReadOperation({ runtime_session_ref: "session_ipv6", site_id: "xiaohongshu", operation_id: "xhs_search_notes", query: "city coffee" });
    assert.equal(ipv6Authorization, `Bearer ${harborSupervisorToken}`);
    const timeoutController = new AbortController();
    const timeoutClient = createHttpHarborRuntimeClient({
      baseUrl: "https://harbor.example",
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })
    });
    const timedOperation = timeoutClient.executeReadOperation({
      runtime_session_ref: "session_timeout",
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "city coffee",
      signal: timeoutController.signal
    });
    timeoutController.abort(new Error("timeout"));
    const timedFailure = await timedOperation;
    assert.equal(asRecord(timedFailure).code, "timeout");
    const legacyWriteFactsClient = createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${xiaohongshuHarborPort}` });
    const creatorUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image";
    const legacyWriteFacts = await legacyWriteFactsClient.collectAdmissionFacts({
      run_id: "run_legacy_write_facts_token",
      task_intent: xiaohongshuWritePrecheckTaskIntent("intent_legacy_write_facts_token", creatorUrl),
      package_ref: xiaohongshuWritePrecheckPackageRef,
      harbor: { identity_environment_ref: "identity-env_runtime_api", url: creatorUrl },
      validate_only: { url: creatorUrl, target_ref: "writable-target:xiaohongshu/creator-publish-note", no_submit_guard: "active" }
    });
    assert.equal(xiaohongshuPaths.includes("POST /runtime/sessions/session_runtime_api_ready/write-precheck-facts"), true);
    assert.equal("harbor_write_precheck_facts" in legacyWriteFacts, true);
    const store = createFileRunRecordStore({ directory: runDir });
    const server = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` })
    });
    const offlineServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${offlineHarborPort}` })
    });
    const cleanupFailureServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${cleanupFailureHarborPort}` })
    });
    const cleanupTimeoutClient = createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${cleanupTimeoutHarborPort}`, cleanupTimeoutMs: 25 });
    const cleanupTimeoutServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: cleanupTimeoutClient });
    const inconsistentCleanupServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${inconsistentCleanupHarborPort}` })
    });
    const ownerNoneHeldServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${ownerNoneHeldHarborPort}` })
    });
    const dualFailureServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${dualFailureHarborPort}` })
    });
    const mismatchedSceneServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${mismatchedSceneHarborPort}` })
    });
    const missingSceneUrlServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${missingSceneUrlHarborPort}` })
    });
    const invalidSceneUrlServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${invalidSceneUrlHarborPort}` })
    });
    const invalidEvidenceServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${invalidEvidenceHarborPort}` })
    });
    const malformedEvidenceServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${malformedEvidenceHarborPort}` })
    });
    const mismatchedEvidenceServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${mismatchedEvidenceHarborPort}` })
    });
    const xiaohongshuServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${xiaohongshuHarborPort}` })
    });
    const bossServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${bossHarborPort}` }) });
    const unavailableOperationServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${unavailableOperationHarborPort}` }) });
    const safetyChallengeServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${safetyChallengeHarborPort}` }) });
    const unknownFailureServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${unknownFailureHarborPort}` }) });
    const missingRefsOperationServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${missingRefsOperationHarborPort}` }) });
    const driftedSessionOperationServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${driftedSessionOperationHarborPort}` }) });
    const driftedBoundaryOperationServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${driftedBoundaryOperationHarborPort}` }) });
    const unknownOutcomeServer = createApiServer({ runRecordStore: store, lodePackageResolver: resolver, harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${unknownOutcomeHarborPort}` }) });
    const deferredXiaohongshuFactsServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${deferredXiaohongshuFactsHarborPort}` })
    });
    const nonPinnedDeferredFactsServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: nonPinnedResolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${deferredXiaohongshuFactsHarborPort}` })
    });
    const operationRefDriftServers = operationRefDriftHarborPorts.map((driftPort) => createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${driftPort}` })
    }));
    const bossContractDriftServers = bossContractDriftHarborPorts.map((driftPort) => createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${driftPort}` })
    }));
    const bossAdmissionServers = bossAdmissionHarborPorts.map((admissionPort) => createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${admissionPort}` })
    }));
    const blockedIdentityServers = blockedIdentityHarborPorts.map((blockedPort) => createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${blockedPort}` })
    }));
    const publicIdentityServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${publicIdentityHarborPort}` })
    });
    const badJsonServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${badJsonHarborPort}` })
    });
    const identityRequiredServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${identityRequiredHarborPort}` })
    });
    const raceDuplicateServer = createApiServer({
      runRecordStore: createDuplicateRunRaceStore(store),
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` })
    });
    const persistenceFailureServer = createApiServer({
      runRecordStore: createTransientFinalizationFailureStore(store),
      lodePackageResolver: resolver,
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` })
    });
    const port = await listen(server);
    const mismatchedScenePort = await listen(mismatchedSceneServer);
    const missingSceneUrlPort = await listen(missingSceneUrlServer);
    const invalidSceneUrlPort = await listen(invalidSceneUrlServer);
    const invalidEvidencePort = await listen(invalidEvidenceServer);
    const malformedEvidencePort = await listen(malformedEvidenceServer);
    const mismatchedEvidencePort = await listen(mismatchedEvidenceServer);
    const xiaohongshuPort = await listen(xiaohongshuServer);
    const bossPort = await listen(bossServer);
    const unavailableOperationPort = await listen(unavailableOperationServer);
    const safetyChallengePort = await listen(safetyChallengeServer);
    const unknownFailurePort = await listen(unknownFailureServer);
    const missingRefsOperationPort = await listen(missingRefsOperationServer);
    const driftedSessionOperationPort = await listen(driftedSessionOperationServer);
    const driftedBoundaryOperationPort = await listen(driftedBoundaryOperationServer);
    const unknownOutcomePort = await listen(unknownOutcomeServer);
    const deferredXiaohongshuFactsPort = await listen(deferredXiaohongshuFactsServer);
    const nonPinnedDeferredFactsPort = await listen(nonPinnedDeferredFactsServer);
    const operationRefDriftPorts = await Promise.all(operationRefDriftServers.map(listen));
    const bossContractDriftPorts = await Promise.all(bossContractDriftServers.map(listen));
    const bossAdmissionPorts = await Promise.all(bossAdmissionServers.map(listen));
    const blockedIdentityPorts = await Promise.all(blockedIdentityServers.map(listen));
    const publicIdentityPort = await listen(publicIdentityServer);
    const offlinePort = await listen(offlineServer);
    const cleanupFailurePort = await listen(cleanupFailureServer);
    const cleanupTimeoutPort = await listen(cleanupTimeoutServer);
    const inconsistentCleanupPort = await listen(inconsistentCleanupServer);
    const ownerNoneHeldPort = await listen(ownerNoneHeldServer);
    const dualFailurePort = await listen(dualFailureServer);
    const badJsonPort = await listen(badJsonServer);
    const identityRequiredPort = await listen(identityRequiredServer);
    const raceDuplicatePort = await listen(raceDuplicateServer);
    const persistenceFailurePort = await listen(persistenceFailureServer);
    try {
      const submit = await postJson(port, "/tasks", {
        run_id: "run_api_submit_runtime_chain",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_runtime_chain"),
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://example.org/",
          session: { run_id: "attacker", package_ref: "attacker", holder_ref: "attacker", url: "https://evil.example/" },
          snapshot: { run_id: "attacker", package_ref: "attacker" }
        }
      });
      assert.equal(submit.status, 202);
      const submitBody = asRecord(submit.body);
      assert.equal(submitBody.ok, true);
      const run = asRecord(submitBody.run);
      assert.equal(run.status, "succeeded");
      assert.equal(run.entrypoint_ref, "entrypoint:app");
      assert.equal(run.result_ref, "result:core/intent_api_submit_runtime_chain");
      assert.equal(run.result_kind, "read-public-page.read_result");
      assert.equal(run.output_schema_id, "lode://schema/site-capability/example/read-public-page/output@0.1.0");
      assert.deepEqual(run.evidence_refs, ["evidence_runtime_api_snapshot"]);
      assert.deepEqual(run.runtime_binding_refs, [
        "session_runtime_api_ready",
        "profile_runtime_api",
        "harbor:provider/cloakbrowser",
        "viewer_runtime_api",
        "identity-env_runtime_api",
        "identity-env_runtime_api:execution",
        "snapshot_runtime_api_ready",
        "refmap_runtime_api_ready",
        "source_trace_runtime_api_ready"
      ]);
      assert(paths.includes("GET /readiness"));
      assert(paths.includes("GET /runtime/browser-providers"));
      assert(paths.includes("GET /runtime/identity-environments/identity-env_runtime_api"));
      assert(paths.includes("POST /runtime/identity-environment-sessions"));
      assert(paths.includes("POST /runtime/sessions/session_runtime_api_ready/snapshot"));
      assert(paths.includes("GET /runtime/evidence/evidence_runtime_api_snapshot"));
      assert(paths.includes("POST /runtime/sessions/session_runtime_api_ready/release"));
      const sessionBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/identity-environment-sessions")?.body);
      assert.equal(JSON.stringify(sessionBody).includes(harborSupervisorToken), false);
      const protectedSnapshotBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/sessions/session_runtime_api_ready/snapshot")?.body);
      assert.equal(JSON.stringify(protectedSnapshotBody).includes(harborSupervisorToken), false);
      assert.equal(sessionBody.run_id, "run_api_submit_runtime_chain");
      assert.equal(sessionBody.package_ref, packageRef);
      assert.equal(sessionBody.holder_ref, "run_api_submit_runtime_chain");
      assert.equal(sessionBody.headless, false);
      assert.equal(sessionBody.url, "https://example.org/");
      const snapshotBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/sessions/session_runtime_api_ready/snapshot")?.body);
      assert.equal(snapshotBody.run_id, "run_api_submit_runtime_chain");
      assert.equal(snapshotBody.package_ref, packageRef);
      const releaseBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/sessions/session_runtime_api_ready/release")?.body);
      assert.equal(releaseBody.control_owner, "core_task");
      assert.equal(releaseBody.holder_ref, "run_api_submit_runtime_chain");

      const evidence = await getJson(port, "/runs/run_api_submit_runtime_chain/evidence-refs");
      assert.equal(evidence.status, 200);
      assert.equal(asRecord(evidence.body).ok, true);

      const result = await getJson(port, "/runs/run_api_submit_runtime_chain/result");
      assert.equal(result.status, 200);
      const resultBody = asRecord(result.body);
      assert.equal(resultBody.ok, true);
      const resultEnvelope = asRecord(asRecord(asRecord(resultBody.result).result).result_envelope);
      assert.equal(resultEnvelope.ok, true);
      assert.equal(resultEnvelope.result_ref, "result:core/intent_api_submit_runtime_chain");
      assert.equal(resultEnvelope.projection_ref, "projection:core/intent_api_submit_runtime_chain");

      const capabilityRuns = await getJson(
        port,
        "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0&package_ref=lode%3A%2F%2Fsite-capability%2Fexample%2Fread-public-page%400.1.0"
      );
      assert.equal(capabilityRuns.status, 200);
      const statusCounts = asRecord(asRecord(asRecord(capabilityRuns.body).capability_runs).status_counts);
      assert.equal(statusCounts.succeeded, 1);

      const xiaohongshuSubmit = await postJson(xiaohongshuPort, "/tasks", {
        run_id: "run_api_submit_xiaohongshu_site_facts",
        package_ref: xiaohongshuPackageRef,
        task_intent: xiaohongshuTaskIntent("intent_api_submit_xiaohongshu_site_facts"),
        public_query: { query: "city coffee" },
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee"
        }
      });
      assert.equal(xiaohongshuSubmit.status, 202, JSON.stringify(xiaohongshuSubmit.body));
      const xiaohongshuRun = asRecord(asRecord(xiaohongshuSubmit.body).run);
      assert.equal(xiaohongshuRun.status, "succeeded");
      assert.equal(xiaohongshuRun.package_ref, xiaohongshuPackageRef);
      assert.equal(xiaohongshuRun.result_ref, "result:core/intent_api_submit_xiaohongshu_site_facts");
      assert(xiaohongshuPaths.some((entry) =>
        entry === "GET /runtime/sessions/session_runtime_api_ready/site-resource-facts?site_id=xiaohongshu&task_kind=search_notes"
      ));
      assert(xiaohongshuPaths.includes("POST /runtime/sessions/session_runtime_api_ready/snapshot"));
      assert(xiaohongshuPaths.includes("POST /runtime/sessions/session_runtime_api_ready/read-operations"));
      const readOperationBody = asRecord(xiaohongshuBodies.find((entry) => entry.path === "POST /runtime/sessions/session_runtime_api_ready/read-operations")?.body);
      assert.equal(readOperationBody.query, "city coffee");
      assert.equal(JSON.stringify(readOperationBody).includes(harborSupervisorToken), false);
      const xiaohongshuSessionBody = asRecord(xiaohongshuBodies.find((entry) => entry.path === "POST /runtime/identity-environment-sessions" && entry.body.package_ref === xiaohongshuPackageRef)?.body);
      assert.equal(xiaohongshuSessionBody.package_ref, xiaohongshuPackageRef);
      assert.equal(xiaohongshuSessionBody.headless, false);
      assert.equal(xiaohongshuSessionBody.url, "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee");

      const submitXiaohongshuSearch = async (suffix: string) => {
        const runId = `run_api_xhs_detail_search_${suffix}`;
        const submitted = await postJson(xiaohongshuPort, "/tasks", {
          run_id: runId,
          package_ref: xiaohongshuPackageRef,
          task_intent: xiaohongshuTaskIntent(`intent_${runId}`),
          public_query: { query: "city coffee" },
          harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" }
        });
        assert.equal(asRecord(asRecord(submitted.body).run).status, "succeeded", suffix);
        return { runId, detailRef: detailRefForRun(runId) };
      };
      const submitXiaohongshuDetail = (suffix: string, detailRef: string) => postJson(xiaohongshuPort, "/tasks", {
        run_id: `run_api_xhs_detail_${suffix}`,
        package_ref: xiaohongshuDetailPackageRef,
        task_intent: xiaohongshuDetailTaskIntent(`intent_api_xhs_detail_${suffix}`, detailRef),
        harbor: { identity_environment_ref: "identity-env_runtime_api" }
      });
      const assertNoSuccessRefs = (value: unknown, name: string) => {
        const run = asRecord(asRecord(value).run);
        assert(["blocked", "failed", "unknown_outcome"].includes(String(run.status)), `${name}: ${JSON.stringify(run)}`);
        assert.equal(run.result_ref, undefined, name);
        assert.equal(run.projection_ref, undefined, name);
        assert.equal(Array.isArray(run.source_refs) && run.source_refs.length > 0, false, name);
        assert.equal(Array.isArray(run.evidence_refs) && run.evidence_refs.some((ref) => String(ref).startsWith("post_check_")), false, name);
        assert.notEqual(asRecord(run.post_check ?? {}).status, "passed", name);
      };
      const assertRejectedBeforeReadOperation = (value: unknown, name: string) => {
        const run = asRecord(asRecord(value).run);
        assert(["blocked", "failed"].includes(String(run.status)), name);
        assert.equal(run.result_ref, undefined, name);
        assert.equal(run.projection_ref, undefined, name);
        assert.equal(Array.isArray(run.source_refs) && run.source_refs.length > 0, false, name);
        assert.notEqual(asRecord(run.post_check ?? {}).status, "passed", name);
      };

      const successfulSearch = await submitXiaohongshuSearch("success");
      const successfulDetail = await submitXiaohongshuDetail("success", successfulSearch.detailRef);
      assert.equal(successfulDetail.status, 202, JSON.stringify(successfulDetail.body));
      const successfulDetailRun = asRecord(asRecord(successfulDetail.body).run);
      assert.equal(successfulDetailRun.status, "succeeded");
      assert.equal(successfulDetailRun.result_kind, "read-note-detail.read_result");
      assert.equal(successfulDetailRun.result_ref, "result:core/intent_api_xhs_detail_success");
      assert.deepEqual(successfulDetailRun.source_refs, [
        opaqueRefForRun("source", "pinia_store_summary:run_api_xhs_detail_success"),
        opaqueRefForRun("source", "network_summary:run_api_xhs_detail_success"),
        opaqueRefForRun("source", "dom_snapshot_summary:run_api_xhs_detail_success")
      ]);
      assert.deepEqual(successfulDetailRun.evidence_refs, [
        opaqueRefForRun("evidence", "run_api_xhs_detail_success"),
        opaqueRefForRun("post_check", "run_api_xhs_detail_success")
      ]);
      assert.equal(asRecord(successfulDetailRun.post_check).status, "passed");
      const successfulDetailRead = asRecord(xiaohongshuBodies.find((entry) =>
        entry.path.endsWith("/read-operations") && entry.body.operation_id === "xhs_read_note_detail" && entry.body.detail_ref === successfulSearch.detailRef
      )?.body);
      assert.equal(successfulDetailRead.detail_ref, successfulSearch.detailRef);
      assert.equal(successfulDetailRead.query, undefined);
      assert.equal(successfulDetailRead.url, undefined);

      const readOperationsBeforeForgedRefs = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
      for (const [name, forgedRef] of [
        ["raw_url", "https://www.xiaohongshu.com/explore/0123456789abcdef01234567"],
        ["raw_note_id", "0123456789abcdef01234567"],
        ["xsec", "xsec_token=forbidden"],
        ["unknown_ref", detailRefForRun("unknown-search-run")]
      ] as const) {
        const forged = await submitXiaohongshuDetail(name, forgedRef);
        assertRejectedBeforeReadOperation(forged.body, name);
      }
      assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readOperationsBeforeForgedRefs);

      const crossBinding = await submitXiaohongshuSearch("cross_binding");
      const crossBindingPath = await publishedDetailTargetPath(runDir, crossBinding.detailRef);
      const crossBindingRecord = asRecord(JSON.parse(await readFile(crossBindingPath, "utf8")));
      await writeFile(crossBindingPath, `${JSON.stringify({ ...crossBindingRecord, identity_environment_ref: "identity-env_other" })}\n`);
      const readOperationsBeforeCrossBinding = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
      assertRejectedBeforeReadOperation((await submitXiaohongshuDetail("cross_binding", crossBinding.detailRef)).body, "cross_binding");
      assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readOperationsBeforeCrossBinding);

      const expired = await submitXiaohongshuSearch("expired");
      const expiredPath = await publishedDetailTargetPath(runDir, expired.detailRef);
      const expiredRecord = asRecord(JSON.parse(await readFile(expiredPath, "utf8")));
      await writeFile(expiredPath, `${JSON.stringify({ ...expiredRecord, expires_at: "2000-01-01T00:00:00.000Z" })}\n`);
      const readOperationsBeforeExpired = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
      assertRejectedBeforeReadOperation((await submitXiaohongshuDetail("expired", expired.detailRef)).body, "expired");
      assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readOperationsBeforeExpired);

      const readOperationsBeforeReplay = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
      assertRejectedBeforeReadOperation((await submitXiaohongshuDetail("replay", successfulSearch.detailRef)).body, "replay");
      assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readOperationsBeforeReplay);

      for (const name of ["challenge", "unavailable", "malformed", "missing_refs", "extra_refs", "post_check_failure"] as const) {
        const search = await submitXiaohongshuSearch(name);
        const terminal = await submitXiaohongshuDetail(name, search.detailRef);
        assertNoSuccessRefs(terminal.body, name);
        if (name === "unavailable") {
          const retry = await submitXiaohongshuDetail("recovered", search.detailRef);
          assert.equal(asRecord(asRecord(retry.body).run).status, "succeeded", JSON.stringify(retry.body));
        }
        if (name === "malformed") {
          const readsBeforeUnknownRetry = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
          assertRejectedBeforeReadOperation((await submitXiaohongshuDetail("unknown_retry", search.detailRef)).body, "unknown_retry");
          assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readsBeforeUnknownRetry);
        }
        if (["missing_refs", "extra_refs", "post_check_failure"].includes(name)) {
          const retry = await submitXiaohongshuDetail(`contract_recovered_${["missing_refs", "extra_refs", "post_check_failure"].indexOf(name)}`, search.detailRef);
          assert.equal(asRecord(asRecord(retry.body).run).status, "succeeded", JSON.stringify(retry.body));
        }
      }

      const reserveFailure = await submitXiaohongshuSearch("reserve_failure");
      const lookupFailure = await submitXiaohongshuSearch("lookup_failure");
      const searchRunPath = join(runDir, `${lookupFailure.runId}.json`);
      const searchRunRecord = await readFile(searchRunPath, "utf8");
      await writeFile(searchRunPath, "{invalid-json\n");
      const readsBeforeLookupFailure = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
      const releasesBeforeLookupFailure = xiaohongshuPaths.filter((path) => path.endsWith("/release")).length;
      const lookupFailureRun = await submitXiaohongshuDetail("lookup_failure", lookupFailure.detailRef);
      assertNoSuccessRefs(lookupFailureRun.body, "lookup_failure");
      assert.equal(asRecord(asRecord(lookupFailureRun.body).run).status, "unknown_outcome");
      assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readsBeforeLookupFailure);
      assert.equal(xiaohongshuPaths.filter((path) => path.endsWith("/release")).length, releasesBeforeLookupFailure + 1);
      await writeFile(searchRunPath, searchRunRecord);

      const claimsPath = join(runDir, ".detail-targets", "claims");
      await rm(claimsPath, { recursive: true });
      await symlink(runDir, claimsPath);
      const readsBeforeReserveFailure = xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length;
      const releasesBeforeReserveFailure = xiaohongshuPaths.filter((path) => path.endsWith("/release")).length;
      const reserveFailureRun = await submitXiaohongshuDetail("reserve_failure", reserveFailure.detailRef);
      assertNoSuccessRefs(reserveFailureRun.body, "reserve_failure");
      assert.equal(asRecord(asRecord(reserveFailureRun.body).run).status, "unknown_outcome");
      assert.equal(xiaohongshuBodies.filter((entry) => entry.path.endsWith("/read-operations")).length, readsBeforeReserveFailure);
      assert.equal(xiaohongshuPaths.filter((path) => path.endsWith("/release")).length, releasesBeforeReserveFailure + 1);
      await rm(claimsPath);
      await mkdir(claimsPath, { mode: 0o700 });

      const bossSubmit = await postJson(bossPort, "/tasks", {
        run_id: "run_api_submit_boss_operation",
        package_ref: bossPackageRef,
        task_intent: bossTaskIntent("intent_api_submit_boss_operation"),
        public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
      });
      assert.equal(bossSubmit.status, 202, JSON.stringify(bossSubmit.body));
      const bossRun = asRecord(asRecord(bossSubmit.body).run);
      assert.equal(bossRun.status, "succeeded");
      assert.equal(bossRun.result_kind, "job-search.read_result");
      assert.deepEqual(bossRun.source_refs, ["source_44444444-4444-4444-8444-444444444444"]);
      assert.deepEqual(bossRun.evidence_refs, ["evidence_55555555-5555-4555-8555-555555555555", "evidence_66666666-6666-4666-8666-666666666666", "post_check_77777777-7777-4777-8777-777777777777"]);
      assert(bossPaths.includes("POST /runtime/sessions/session_runtime_api_ready/snapshot"));
      const bossReadBody = asRecord(bossBodies.find((entry) => entry.path.endsWith("/read-operations"))?.body);
      assert.equal(bossReadBody.query, "AI");
      assert.equal(bossReadBody.city_code, "101010100");
      assert.equal(JSON.stringify(bossReadBody).includes(harborSupervisorToken), false);

      for (const [index, driftCase] of bossContractDriftCases.entries()) {
        const drift = await postJson(bossContractDriftPorts[index]!, "/tasks", {
          run_id: `run_api_submit_boss_${driftCase.name}`,
          package_ref: bossPackageRef,
          task_intent: bossTaskIntent(`intent_api_submit_boss_${driftCase.name}`),
          public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
          harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
        });
        const driftRun = asRecord(asRecord(drift.body).run);
        if (driftCase.name === "unknown_outcome") {
          assert.equal(driftRun.status, "unknown_outcome", driftCase.name);
        } else {
          assert.equal(asRecord(drift.body).ok, false, driftCase.name);
          assert.equal(driftRun.status, "failed", driftCase.name);
          assert.equal(driftRun.result_ref, undefined, driftCase.name);
        }
      }
      for (const [index, admissionCase] of bossAdmissionCases.entries()) {
        const blocked = await postJson(bossAdmissionPorts[index]!, "/tasks", {
          run_id: `run_api_submit_boss_${admissionCase.name}`,
          package_ref: bossPackageRef,
          task_intent: bossTaskIntent(`intent_api_submit_boss_${admissionCase.name}`),
          public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
          harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
        });
        assert.equal(asRecord(blocked.body).ok, false, admissionCase.name);
        assert.equal(bossAdmissionPaths[index]!.some((path) => path.endsWith("/read-operations")), false, admissionCase.name);
      }

      for (const [targetPort, runId, status, httpStatus] of [[unavailableOperationPort, "run_api_submit_operation_unavailable", "blocked", 503], [missingRefsOperationPort, "run_api_submit_operation_missing_refs", "failed", 400]] as const) {
        const failedOperation = await postJson(targetPort, "/tasks", {
          run_id: runId,
          package_ref: xiaohongshuPackageRef,
          task_intent: xiaohongshuTaskIntent(`intent_${runId}`),
          public_query: { query: "city coffee" },
          harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" }
        });
        assert.equal(failedOperation.status, httpStatus);
        assert.equal(asRecord(asRecord(failedOperation.body).run).status, status);
        assert.equal(asRecord(failedOperation.body).ok, false);
      }
      const challenge = await postJson(safetyChallengePort, "/tasks", {
        run_id: "run_api_submit_boss_safety_challenge",
        package_ref: bossPackageRef,
        task_intent: bossTaskIntent("intent_api_submit_boss_safety_challenge"),
        public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
      });
      const challengeRun = asRecord(asRecord(challenge.body).run);
      assert.equal(asRecord(challengeRun.failure).code, "captcha_required");
      assert.equal(asRecord(challengeRun.failure).code === "site_changed", false);
      assert.equal(asRecord(challengeRun.post_check).summary, "Harbor read operation ended with captcha_required.");

      const unknownFailure = await postJson(unknownFailurePort, "/tasks", {
        run_id: "run_api_submit_boss_unknown_failure",
        package_ref: bossPackageRef,
        task_intent: bossTaskIntent("intent_api_submit_boss_unknown_failure"),
        public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
      });
      const unknownFailureRun = asRecord(asRecord(unknownFailure.body).run);
      assert.equal(asRecord(unknownFailureRun.failure).code, "site_changed");
      assert.equal(asRecord(unknownFailureRun.post_check).summary, "Core rejected a Harbor unavailable response outside the pinned Lode failure taxonomy.");
      for (const [targetPort, runId] of [[driftedSessionOperationPort, "run_api_submit_operation_session_drift"], [driftedBoundaryOperationPort, "run_api_submit_operation_boundary_drift"]] as const) {
        const drift = await postJson(targetPort, "/tasks", { run_id: runId, package_ref: xiaohongshuPackageRef, task_intent: xiaohongshuTaskIntent(`intent_${runId}`), public_query: { query: "city coffee" }, harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" } });
        assert.equal(asRecord(asRecord(drift.body).run).status, "failed");
      }
      const unknown = await postJson(unknownOutcomePort, "/tasks", { run_id: "run_api_submit_operation_unknown", package_ref: xiaohongshuPackageRef, task_intent: xiaohongshuTaskIntent("intent_operation_unknown"), public_query: { query: "city coffee" }, harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" } });
      assert.equal(unknown.status, 202);
      assert.equal(asRecord(asRecord(unknown.body).run).status, "unknown_outcome");

      const privateQuery = await postJson(port, "/tasks", { run_id: "run_api_submit_private_query", package_ref: xiaohongshuPackageRef, task_intent: xiaohongshuTaskIntent("intent_private_query"), public_query: { query: "city coffee", token: "forbidden" } });
      assert.equal(privateQuery.status, 400);
      assert.equal(asRecord(asRecord(privateQuery.body).error).code, "public_query_invalid");

      const xiaohongshuDeferredFacts = await postJson(deferredXiaohongshuFactsPort, "/tasks", {
        run_id: "run_api_submit_xiaohongshu_deferred_facts",
        package_ref: xiaohongshuPackageRef,
        task_intent: xiaohongshuTaskIntent("intent_api_submit_xiaohongshu_deferred_facts"),
        public_query: { query: "city coffee" },
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee"
        }
      });
      assert.equal(xiaohongshuDeferredFacts.status, 202, JSON.stringify(xiaohongshuDeferredFacts.body));
      assert.equal(asRecord(xiaohongshuDeferredFacts.body).ok, true);
      assert.equal(asRecord(asRecord(xiaohongshuDeferredFacts.body).run).status, "succeeded");
      assert(deferredXiaohongshuFactsPaths.includes("GET /runtime/identity-environments/identity-env_runtime_api"));
      assert(deferredXiaohongshuFactsPaths.includes("POST /runtime/sessions/session_runtime_api_ready/read-operations"));

      const nonPinnedDeferredFacts = await postJson(nonPinnedDeferredFactsPort, "/tasks", {
        run_id: "run_api_submit_non_pinned_deferred_facts",
        package_ref: xiaohongshuPackageRef,
        task_intent: xiaohongshuTaskIntent("intent_api_submit_non_pinned_deferred_facts"),
        public_query: { query: "city coffee" },
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" }
      });
      assert.equal(asRecord(nonPinnedDeferredFacts.body).ok, false);
      assert.equal(asRecord(asRecord(nonPinnedDeferredFacts.body).error).code, "resource_fact_missing:page.vue_app.ready");

      for (const [index, driftCase] of operationRefDriftCases.entries()) {
        const drift = await postJson(operationRefDriftPorts[index]!, "/tasks", {
          run_id: `run_api_submit_operation_refs_${driftCase.name}`,
          package_ref: xiaohongshuPackageRef,
          task_intent: xiaohongshuTaskIntent(`intent_api_submit_operation_refs_${driftCase.name}`),
          public_query: { query: "city coffee" },
          harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" }
        });
        assert.equal(asRecord(drift.body).ok, false, driftCase.name);
        assert.equal(asRecord(asRecord(drift.body).run).status, "failed", driftCase.name);
        assert.equal(asRecord(asRecord(drift.body).run).result_ref, undefined, driftCase.name);
      }

      for (const [index, identityCase] of blockedIdentityCases.entries()) {
        const blockedIdentity = await postJson(blockedIdentityPorts[index]!, "/tasks", {
          run_id: `run_api_submit_identity_${identityCase.name}`,
          package_ref: xiaohongshuPackageRef,
          task_intent: xiaohongshuTaskIntent(`intent_api_submit_identity_${identityCase.name}`),
          public_query: { query: "city coffee" },
          harbor: { identity_environment_ref: identityCase.identityRef ?? "identity-env_runtime_api", url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee" }
        });
        assert.equal(asRecord(blockedIdentity.body).ok, false, identityCase.name);
        assert.equal(blockedIdentityPaths[index]!.some((path) => path.endsWith("/read-operations")), false, identityCase.name);
      }

      const publicIdentitySubmit = await postJson(publicIdentityPort, "/tasks", {
        run_id: "run_api_submit_public_identity_record",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_public_identity_record"),
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://example.org/"
        }
      });
      assert.equal(publicIdentitySubmit.status, 202);
      assert(publicIdentityPaths.includes("GET /runtime/identity-environments/identity-env_runtime_api"));
      assert.equal(asRecord(asRecord(publicIdentitySubmit.body).run).status, "succeeded");

      const failed = await postJson(offlinePort, "/tasks", {
        run_id: "run_api_submit_no_harbor",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_no_harbor"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(failed.status, 503);
      const failedBody = asRecord(failed.body);
      assert.equal(failedBody.ok, false);
      assert.equal(asRecord(failedBody.error).code, "harbor_runtime_api_unavailable");
      assert.equal(asRecord(failedBody.run).status, "failed");

      const mismatchedScene = await postJson(mismatchedScenePort, "/tasks", {
        run_id: "run_api_submit_mismatched_scene",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_mismatched_scene"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(mismatchedScene.status, 400);
      const mismatchedSceneBody = asRecord(mismatchedScene.body);
      assert.equal(mismatchedSceneBody.ok, false);
      assert.equal(asRecord(mismatchedSceneBody.error).code, "page_changed");
      const mismatchedSceneRun = asRecord(mismatchedSceneBody.run);
      assert.equal(mismatchedSceneRun.status, "blocked");
      assert.equal(mismatchedSceneRun.result_ref, undefined);
      assert.deepEqual(mismatchedSceneRun.evidence_refs, ["evidence_runtime_api_snapshot"]);

      const missingSceneUrl = await postJson(missingSceneUrlPort, "/tasks", {
        run_id: "run_api_submit_missing_scene_url",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_missing_scene_url"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(missingSceneUrl.status, 400);
      const missingSceneUrlBody = asRecord(missingSceneUrl.body);
      assert.equal(missingSceneUrlBody.ok, false);
      assert.equal(asRecord(missingSceneUrlBody.error).code, "page_not_ready");
      const missingSceneUrlRun = asRecord(missingSceneUrlBody.run);
      assert.equal(missingSceneUrlRun.status, "blocked");
      assert.equal(missingSceneUrlRun.result_ref, undefined);

      const invalidSceneUrl = await postJson(invalidSceneUrlPort, "/tasks", {
        run_id: "run_api_submit_invalid_scene_url",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_invalid_scene_url"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(invalidSceneUrl.status, 400);
      const invalidSceneUrlBody = asRecord(invalidSceneUrl.body);
      assert.equal(invalidSceneUrlBody.ok, false);
      assert.equal(asRecord(invalidSceneUrlBody.error).code, "page_not_ready");
      const invalidSceneUrlRun = asRecord(invalidSceneUrlBody.run);
      assert.equal(invalidSceneUrlRun.status, "blocked");
      assert.equal(invalidSceneUrlRun.result_ref, undefined);

      const invalidEvidence = await postJson(invalidEvidencePort, "/tasks", {
        run_id: "run_api_submit_invalid_evidence_ref",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_invalid_evidence_ref"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(invalidEvidence.status, 503);
      const invalidEvidenceBody = asRecord(invalidEvidence.body);
      assert.equal(invalidEvidenceBody.ok, false);
      assert.equal(asRecord(invalidEvidenceBody.error).code, "resource_fact_missing:snapshot.document_summary.available");
      assert.equal(asRecord(invalidEvidenceBody.run).status, "failed");

      const malformedEvidence = await postJson(malformedEvidencePort, "/tasks", {
        run_id: "run_api_submit_malformed_evidence_lookup",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_malformed_evidence_lookup"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(malformedEvidence.status, 503);
      const malformedEvidenceBody = asRecord(malformedEvidence.body);
      assert.equal(malformedEvidenceBody.ok, false);
      assert.equal(asRecord(malformedEvidenceBody.error).code, "evidence_unavailable");
      const malformedEvidenceRun = asRecord(malformedEvidenceBody.run);
      assert.equal(malformedEvidenceRun.status, "failed");
      assert.equal(malformedEvidenceRun.evidence_refs, undefined);

      const mismatchedEvidence = await postJson(mismatchedEvidencePort, "/tasks", {
        run_id: "run_api_submit_mismatched_evidence_lookup",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_mismatched_evidence_lookup"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(mismatchedEvidence.status, 503);
      const mismatchedEvidenceBody = asRecord(mismatchedEvidence.body);
      assert.equal(mismatchedEvidenceBody.ok, false);
      assert.equal(asRecord(mismatchedEvidenceBody.error).code, "evidence_unavailable");
      const mismatchedEvidenceRun = asRecord(mismatchedEvidenceBody.run);
      assert.equal(mismatchedEvidenceRun.status, "failed");
      assert.equal(mismatchedEvidenceRun.evidence_refs, undefined);

      const badJson = await postJson(badJsonPort, "/tasks", {
        run_id: "run_api_submit_bad_harbor_json",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_bad_harbor_json"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(badJson.status, 503);
      const badJsonBody = asRecord(badJson.body);
      assert.equal(badJsonBody.ok, false);
      assert.equal(asRecord(badJsonBody.error).code, "harbor_runtime_api_unavailable");
      assert.equal(asRecord(badJsonBody.run).status, "failed");

      const identityRequired = await postJson(identityRequiredPort, "/tasks", {
        run_id: "run_api_submit_identity_required",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_identity_required"),
        harbor: { url: "https://example.org/" }
      });
      assert.equal(identityRequired.status, 503);
      const identityRequiredBody = asRecord(identityRequired.body);
      assert.equal(identityRequiredBody.ok, false);
      assert.equal(asRecord(identityRequiredBody.error).code, "identity_environment_required");
      const identityRequiredRun = asRecord(identityRequiredBody.run);
      assert.equal(identityRequiredRun.status, "requires_user_action");
      assert.equal(asRecord(identityRequiredRun.admission).decision, "requires_user_action");

      const privateEvidencePolicy = await postJson(port, "/tasks", {
        run_id: "run_api_submit_private_evidence_policy",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_private_evidence_policy"),
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://example.org/",
          evidence_policy: { token: "must-not-leave-core" }
        }
      });
      assert.equal(privateEvidencePolicy.status, 400);
      assert.equal(asRecord(asRecord(privateEvidencePolicy.body).error).code, "private_field_rejected:token");

      const payloadSupervisorToken = await postJson(port, "/tasks", {
        run_id: "run_api_submit_payload_supervisor_token",
        package_ref: xiaohongshuPackageRef,
        task_intent: xiaohongshuTaskIntent("intent_api_submit_payload_supervisor_token"),
        public_query: { query: "city coffee" },
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
          supervisor_token: harborSupervisorToken
        }
      });
      assert.equal(payloadSupervisorToken.status, 400);
      assert.equal(asRecord(asRecord(payloadSupervisorToken.body).error).code, "unsupported_harbor_field:supervisor_token");
      assert.equal(JSON.stringify(payloadSupervisorToken.body).includes(harborSupervisorToken), false);

      const raceDuplicate = await postJson(raceDuplicatePort, "/tasks", {
        run_id: "run_api_submit_race_duplicate",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_race_duplicate"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(raceDuplicate.status, 409);
      assert.equal(asRecord(asRecord(raceDuplicate.body).error).code, "run_id_already_exists");

      const invalidRunId = await postJson(port, "/tasks", {
        run_id: "../bad",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_invalid_run_id")
      });
      assert.equal(invalidRunId.status, 400);
      assert.equal(asRecord(asRecord(invalidRunId.body).error).code, "run_id_invalid");

      const duplicateRunId = await postJson(port, "/tasks", {
        run_id: "run_api_submit_runtime_chain",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_duplicate_run_id")
      });
      assert.equal(duplicateRunId.status, 409);
      assert.equal(asRecord(asRecord(duplicateRunId.body).error).code, "run_id_already_exists");

      const persistenceFailure = await postJson(persistenceFailurePort, "/tasks", {
        run_id: "run_api_submit_persistence_failure",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_persistence_failure"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(persistenceFailure.status, 500);
      const persistenceRun = asRecord(asRecord(persistenceFailure.body).run);
      assert.equal(persistenceRun.status, "failed");
      assert.equal(asRecord(persistenceRun.failure).code, "run_finalization_persistence_failed");

      const cleanupFailure = await postJson(cleanupFailurePort, "/tasks", {
        run_id: "run_api_submit_cleanup_failure",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_cleanup_failure"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(cleanupFailure.status, 503);
      const cleanupFailureRun = asRecord(asRecord(cleanupFailure.body).run);
      assert.equal(cleanupFailureRun.status, "failed");
      assert.equal(asRecord(cleanupFailureRun.failure).code, "core_task_session_cleanup_failed");
      assert.equal(asRecord(cleanupFailureRun.post_check).code, "core_task_session_cleanup_failed");
      assert(cleanupFailureHarborPaths.includes("POST /runtime/sessions/session_runtime_api_ready/release"));
      assert(cleanupFailureHarborPaths.includes("POST /runtime/sessions/session_runtime_api_ready/stop"));

      const cleanupTimeoutStarted = Date.now();
      const cleanupTimeout = await postJson(cleanupTimeoutPort, "/tasks", {
        run_id: "run_api_submit_cleanup_timeout",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_cleanup_timeout"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert(Date.now() - cleanupTimeoutStarted < 1_000);
      assert.equal(cleanupTimeout.status, 503);
      const cleanupTimeoutRun = asRecord(asRecord(cleanupTimeout.body).run);
      assert.equal(cleanupTimeoutRun.status, "failed");
      assert.equal(asRecord(cleanupTimeoutRun.failure).code, "core_task_session_cleanup_timeout");
      assert.deepEqual(asRecord(cleanupTimeoutRun.post_check).source_refs, ["session_runtime_api_ready"]);

      const inconsistentCleanup = await postJson(inconsistentCleanupPort, "/tasks", {
        run_id: "run_api_submit_inconsistent_cleanup",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_inconsistent_cleanup"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(inconsistentCleanup.status, 503);
      assert.equal(asRecord(asRecord(asRecord(inconsistentCleanup.body).run).failure).code, "core_task_session_cleanup_failed");
      assert(inconsistentCleanupHarborPaths.includes("POST /runtime/sessions/session_runtime_api_ready/release"));
      assert(inconsistentCleanupHarborPaths.includes("POST /runtime/sessions/session_runtime_api_ready/stop"));
      assert(inconsistentCleanupHarborPaths.filter((path) => path === "GET /runtime/sessions/session_runtime_api_ready").length >= 3);

      const ownerNoneHeld = await postJson(ownerNoneHeldPort, "/tasks", {
        run_id: "run_api_submit_owner_none_held",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_owner_none_held"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(ownerNoneHeld.status, 503);
      assert.equal(asRecord(asRecord(asRecord(ownerNoneHeld.body).run).failure).code, "core_task_session_lock_mismatch");
      assert.equal(ownerNoneHeldHarborPaths.some((path) => path.endsWith("/release") || path.endsWith("/stop")), false);

      const dualFailure = await postJson(dualFailurePort, "/tasks", {
        run_id: "run_api_submit_dual_failure",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_dual_failure"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(dualFailure.status, 503);
      const dualFailureRun = asRecord(asRecord(dualFailure.body).run);
      assert.equal(asRecord(dualFailureRun.failure).code, "runtime_ref_missing");
      assert.equal(asRecord(dualFailureRun.failure).recovery_hint, "connect_runtime");
      assert.equal(asRecord(dualFailureRun.post_check).code, "core_task_session_cleanup_failed");
      assert.equal(asRecord(dualFailureRun.post_check).recovery_hint, "retry_session_cleanup");
      assert.deepEqual(asRecord(dualFailureRun.post_check).source_refs, ["session_runtime_api_ready"]);
      assert(dualFailureHarborPaths.includes("POST /runtime/sessions/session_runtime_api_ready/release"));
      assert(dualFailureHarborPaths.includes("POST /runtime/sessions/session_runtime_api_ready/stop"));

      const recoveryTimeoutAdmission = await cleanupTimeoutClient.collectAdmissionFacts({
        run_id: "run_api_recover_cleanup_timeout",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_recover_cleanup_timeout"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal("kind" in recoveryTimeoutAdmission, false);
      await store.createRunRecord({
        run_id: "run_api_recover_cleanup_timeout",
        status: "admitted",
        task_intent_ref: "intent:recovery/cleanup-timeout",
        capability_ref: "lode:capability/read-public-page",
        admission: {
          decision: "accepted",
          action_risk: "read",
          runtime_session_binding: {
            schema_version: "webenvoy.runtime-session-binding.v0",
            identity_environment_ref: "identity-env_runtime_api",
            execution_identity_ref: "identity-env_runtime_api:execution",
            runtime_session_ref: "session_runtime_api_ready",
            profile_ref: "profile_runtime_api",
            provider_ref: "harbor:provider/cloakbrowser",
            provider_mode: "local_dedicated_profile",
            lifecycle_state: "active",
            control_owner: "core_task",
            session_use: "core_task_run",
            core_task_run: true,
            consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
          }
        }
      });
      await store.updateRunRecord("run_api_recover_cleanup_timeout", { status: "running" });
      const recoveryTimeoutStarted = Date.now();
      const recoveryTimeout = await recoverInterruptedCoreTaskSessions(store, cleanupTimeoutClient);
      assert(Date.now() - recoveryTimeoutStarted < 1_000);
      assert(recoveryTimeout.cleanup_failed.includes("run_api_recover_cleanup_timeout"));
      const recoveryTimeoutRun = await store.getRunRecord("run_api_recover_cleanup_timeout");
      assert.equal(recoveryTimeoutRun?.status, "failed");
      assert.equal(recoveryTimeoutRun?.failure?.code, "core_task_session_cleanup_timeout");

      const recoveryClient = createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` });
      const recoveryAdmission = await recoveryClient.collectAdmissionFacts({
        run_id: "run_api_recover_interrupted_core_task",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_recover_interrupted_core_task"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal("category" in recoveryAdmission, false);
      await store.createRunRecord({
        run_id: "run_api_recover_interrupted_core_task",
        status: "admitted",
        task_intent_ref: "intent:recovery/core-task",
        capability_ref: "lode:capability/read-public-page",
        admission: {
          decision: "accepted",
          action_risk: "read",
          runtime_session_binding: {
            schema_version: "webenvoy.runtime-session-binding.v0",
            identity_environment_ref: "identity-env_runtime_api",
            execution_identity_ref: "identity-env_runtime_api:execution",
            runtime_session_ref: "session_runtime_api_ready",
            profile_ref: "profile_runtime_api",
            provider_ref: "harbor:provider/cloakbrowser",
            provider_mode: "local_dedicated_profile",
            lifecycle_state: "active",
            control_owner: "core_task",
            session_use: "core_task_run",
            core_task_run: true,
            consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
          }
        }
      });
      await store.updateRunRecord("run_api_recover_interrupted_core_task", { status: "running" });
      await store.createRunRecord({
        run_id: "run_api_preserve_manual_session",
        status: "admitted",
        task_intent_ref: "intent:recovery/manual-session",
        capability_ref: "lode:capability/read-public-page",
        admission: {
          decision: "accepted",
          action_risk: "read",
          runtime_session_binding: {
            schema_version: "webenvoy.runtime-session-binding.v0",
            identity_environment_ref: "identity-env_runtime_api",
            execution_identity_ref: "identity-env_runtime_api:execution",
            runtime_session_ref: "session_manual_user",
            profile_ref: "profile_runtime_api",
            provider_ref: "harbor:provider/cloakbrowser",
            provider_mode: "local_dedicated_profile",
            lifecycle_state: "active",
            control_owner: "user",
            session_use: "manual_browsing",
            core_task_run: true,
            consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
          }
        }
      });
      await store.updateRunRecord("run_api_preserve_manual_session", { status: "running" });
      const recovered = await recoverInterruptedCoreTaskSessions(store, recoveryClient);
      assert.deepEqual(recovered, { recovered: ["run_api_recover_interrupted_core_task"], cleanup_failed: [] });
      const recoveredRun = await store.getRunRecord("run_api_recover_interrupted_core_task");
      assert.equal(recoveredRun?.status, "failed");
      assert.equal(recoveredRun?.failure?.code, "core_task_interrupted");
      assert.equal((await store.getRunRecord("run_api_preserve_manual_session"))?.status, "running");
    } finally {
      await close(server);
      await close(mismatchedSceneServer);
      await close(missingSceneUrlServer);
      await close(invalidSceneUrlServer);
      await close(invalidEvidenceServer);
      await close(malformedEvidenceServer);
      await close(mismatchedEvidenceServer);
      await close(xiaohongshuServer);
      await close(bossServer);
      await close(unavailableOperationServer);
      await close(safetyChallengeServer);
      await close(unknownFailureServer);
      await close(missingRefsOperationServer);
      await close(driftedSessionOperationServer);
      await close(driftedBoundaryOperationServer);
      await close(unknownOutcomeServer);
      await close(deferredXiaohongshuFactsServer);
      await close(nonPinnedDeferredFactsServer);
      await Promise.all(operationRefDriftServers.map(close));
      await Promise.all(bossContractDriftServers.map(close));
      await Promise.all(bossAdmissionServers.map(close));
      await Promise.all(blockedIdentityServers.map(close));
      await close(publicIdentityServer);
      await close(offlineServer);
      await close(cleanupFailureServer);
      await close(cleanupTimeoutServer);
      await close(inconsistentCleanupServer);
      await close(ownerNoneHeldServer);
      await close(dualFailureServer);
      await close(badJsonServer);
      await close(identityRequiredServer);
      await close(raceDuplicateServer);
      await close(persistenceFailureServer);
    }
  } finally {
    await close(harbor);
    await close(mismatchedSceneHarbor);
    await close(missingSceneUrlHarbor);
    await close(invalidSceneUrlHarbor);
    await close(invalidEvidenceHarbor);
    await close(malformedEvidenceHarbor);
    await close(mismatchedEvidenceHarbor);
    await close(xiaohongshuHarbor);
    await close(bossHarbor);
    await close(unavailableOperationHarbor);
    await close(safetyChallengeHarbor);
    await close(unknownFailureHarbor);
    await close(missingRefsOperationHarbor);
    await close(driftedSessionOperationHarbor);
    await close(driftedBoundaryOperationHarbor);
    await close(unknownOutcomeHarbor);
    await close(deferredXiaohongshuFactsHarbor);
    await Promise.all(operationRefDriftHarbors.map(close));
    await Promise.all(bossContractDriftHarbors.map(close));
    await Promise.all(bossAdmissionHarbors.map(close));
    await Promise.all(blockedIdentityHarbors.map(close));
    await close(publicIdentityHarbor);
    await close(offlineHarbor);
    await close(cleanupFailureHarbor);
    await close(cleanupTimeoutHarbor);
    await close(inconsistentCleanupHarbor);
    await close(ownerNoneHeldHarbor);
    await close(dualFailureHarbor);
    await close(badJsonHarbor);
    await close(identityRequiredHarbor);
    if (previousSupervisorToken === undefined) delete process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
    else process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = previousSupervisorToken;
    await rm(root, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
  await assertLodeResolverStaysUnderRoot();
}
