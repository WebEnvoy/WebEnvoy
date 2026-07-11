import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  createFileRunRecordStore,
  createHttpHarborRuntimeClient,
  createLocalLodePackageResolver,
  type CreateRunRecordInput,
  type FileRunRecordStore,
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

const packageRef = "lode://site-capability/example/read-public-page@0.1.0";
const lockRef = "lode://lock/site-capability/example/read-public-page@0.1.0";
const resourceRef = "example.read-public-page.resources";
const xiaohongshuPackageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuLockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuResourceRef = "xiaohongshu.search-notes.resources";
const bossPackageRef = "lode://site-capability/boss/job-search@0.1.0";
const bossLockRef = "lode://lock/site-capability/boss/job-search@0.1.0";
const bossResourceRef = "boss.job-search.resources";
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

function bossTaskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read BOSS job search through Harbor." },
    capability: { ref: "lode:capability/job-search", version: "0.1.0", source_ref: bossPackageRef, lock_ref: bossLockRef },
    input: { summary: "Read BOSS job search.", refs: ["https://www.zhipin.com/web/geek/jobs?query=AI"] },
    scope: { target_type: "boss_job_search", target_ref: "https://www.zhipin.com/web/geek/jobs?query=AI" },
    policy: { risk: "read", execution_intent: "read", timeout_ms: 5000 },
    resource_requirement_refs: [bossResourceRef],
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

async function writeLodeRegistry(root: string): Promise<{ registryPath: string; allowlistAssetSha256: string }> {
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(join(root, "sites", "example", "read-public-page"), { recursive: true });
  await mkdir(join(root, "sites", "xiaohongshu", "search-notes"), { recursive: true });
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
          task_kind: "real_site_read"
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
          task_kind: "real_site_read"
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
        allowed_origins: ["https://www.zhipin.com"],
        resource_requirements: { resource_requirements_id: bossResourceRef },
        failure_taxonomy: { failure_mapping_id: "boss.job-search.failure-mapping", required_classes: ["invalid_contract", "resource_unavailable", "site_changed", "not_logged_in", "identity_insufficient", "captcha_required", "page_not_ready", "field_missing", "network_resource_unavailable"] },
        evidence_and_post_check: { required_ref_kinds: ["snapshot_ref", "network_summary_ref", "post_check_ref"], post_check_id: "boss.job-search.post-check", required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"] }
      }],
      fail_closed: { unknown_operation: "reject" }
    };
  await writeFile(join(root, "registry", "runtime-consumption-allowlist.json"), JSON.stringify(runtimeAllowlist));
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
  await writeFile(join(root, "sites", "boss", "job-search", "resource-requirements.json"), JSON.stringify({
    schema_version: "lode.resource-requirements.v0",
    resource_requirements_id: bossResourceRef,
    resource_requirements_version: "0.1.0",
    package_ref: bossPackageRef,
    operation_mode: "read",
    resource_requirement_profiles: [{ requirement_profile_id: "boss-job-search-live-runtime", operation_boundary: "read", required_harbor_facts: ["runtime.execution_surface.available", "runtime.origin.www_zhipin_com.available", "identity.boss_geek_logged_in.confirmed", "page.boss_spa.ready", "network.wapi_zpgeek.available", "source.refs.available", "evidence.snapshot_ref.available", "safety.challenge.absent"].map((fact_key) => ({ fact_key, owner: "Harbor", required: true })) }]
  }));
  return { registryPath: join(root, "registry", "local-packages.json"), allowlistAssetSha256: fixtureAllowlistSha256(runtimeAllowlist) };
}

function createHarborMock(
  ready: boolean,
  paths: string[],
  bodies: Array<{ path: string; body: JsonObject }> = [],
  sceneOverrides: JsonObject = {},
  evidenceBody: JsonObject = { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
  sessionOverrides: JsonObject = {},
  siteResourceBody: JsonObject | undefined = undefined,
  readOperationOverrides: JsonObject = {},
  identityRecordOverrides: JsonObject = {}
): Server {
  const sessionRef = "session_runtime_api_ready";
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
      /^\/runtime\/(?:identity-environment-)?sessions\/[^/]+\/(?:lock|release|stop|snapshot|read-operations)$/.test(request.url ?? "")
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
        sendJson(response, 200, {
          identity_environment_facts: liveSessionIdentity(sessionSiteId, sessionOrigin),
          runtime_facts: liveRuntimeFacts(),
          ...sessionOverrides
        });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/snapshot`) {
        sendJson(response, 200, { status: "captured", core_scene_ref: scene, evidence_refs: scene.evidence_refs });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/read-operations`) {
        sendJson(response, 200, {
          schema_version: "harbor-allowlisted-read-operation/v0",
          status: "completed",
          operation_ref: "read_operation_11111111-1111-4111-8111-111111111111",
          runtime_session_ref: sessionRef,
          site_id: "xiaohongshu",
          operation_id: "xhs_search_notes",
          operation_mode: "read",
          observed_at: "2026-07-11T00:00:00.000Z",
          public_summary_ref: "read_result_22222222-2222-4222-8222-222222222222",
          public_summary: { schema_version: "harbor-read-operation-public-summary/v0", operation_id: "xhs_search_notes", result_kind: "xiaohongshu_search_notes_surface", surface: "search_result", result_state: "operation_read_response_observed", response_status: 200, source_signals: ["pinia_store", "xhs_search_read_network"] },
          source_refs: [{ kind: "pinia_store_summary", ref: "source_11111111-1111-4111-8111-111111111111" }, { kind: "network_summary", ref: "source_22222222-2222-4222-8222-222222222222" }, { kind: "dom_snapshot_summary", ref: "source_33333333-3333-4333-8333-333333333333" }],
          evidence_refs: ["evidence_11111111-1111-4111-8111-111111111111"],
          evidence_ref_kinds: [{ kind: "snapshot_ref", ref: "evidence_11111111-1111-4111-8111-111111111111" }, { kind: "post_check_ref", ref: "post_check_11111111-1111-4111-8111-111111111111" }],
          post_check: { post_check_ref: "post_check_11111111-1111-4111-8111-111111111111", status: "passed", reason: "managed_provider_read_probe_completed" },
          lode_pin: { repository: "WebEnvoy/Lode", commit: "e36a4a7", asset_path: "registry/runtime-consumption-allowlist.json", asset_sha256: "5aa6be8bd416bbd19f73dcfab995f62f769849923f2aa2e995da974b0f329184", mirror_payload_sha256: "bbc17210563ed91fc320f006bbd81a9a965ed43f18ffd3018ee9b25f6c5bdf2e", allowlist_id: "lode.xhs-boss.read.runtime-consumption", allowlist_version: "0.1.0", asset_owner: "Lode", consumer: { repository: "WebEnvoy/Harbor", issue: "#245", purpose: "allowlisted one-shot read-only operation admission" } },
          public_boundary: { output: "public_summary_and_refs_only", raw_credentials: "not_exposed", raw_profile_storage: "not_exposed", raw_cdp_endpoint: "not_exposed", raw_dom: "not_exposed", raw_har: "not_exposed", raw_network_bodies: "not_exposed", screenshot_body: "not_exposed", external_write_actions: "not_performed" },
          ...readOperationOverrides
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

export async function assertRuntimeTaskSubmitApi(): Promise<void> {
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
  const xiaohongshuHarbor = createHarborMock(
    true,
    xiaohongshuPaths,
    xiaohongshuBodies,
    xiaohongshuScene,
    { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
    {},
    readyXiaohongshuSiteFacts
  );
  const bossPaths: string[] = [];
  const bossBodies: Array<{ path: string; body: JsonObject }> = [];
  const bossHarbor = createHarborMock(true, bossPaths, bossBodies, {
    page_summary: { title: "BOSS jobs", url: "https://www.zhipin.com/web/geek/jobs?query=AI", summary: "BOSS job search." }
  }, undefined, {}, readyBossSiteFacts, {
    site_id: "boss",
    operation_id: "boss_job_search",
    public_summary: { schema_version: "harbor-read-operation-public-summary/v0", operation_id: "boss_job_search", result_kind: "boss_job_search_surface", surface: "web_geek_jobs", result_state: "operation_read_response_observed", response_status: 200, source_signals: ["boss_wapi_zpgeek_read_network"] },
    source_refs: [{ kind: "network_summary", ref: "source_44444444-4444-4444-8444-444444444444" }],
    evidence_refs: ["evidence_55555555-5555-4555-8555-555555555555", "evidence_66666666-6666-4666-8666-666666666666"],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: "evidence_55555555-5555-4555-8555-555555555555" }, { kind: "network_summary_ref", ref: "evidence_66666666-6666-4666-8666-666666666666" }, { kind: "post_check_ref", ref: "post_check_77777777-7777-4777-8777-777777777777" }],
    post_check: { post_check_ref: "post_check_77777777-7777-4777-8777-777777777777", status: "passed", reason: "managed_provider_read_probe_completed" }
  });
  const unavailableOperationHarbor = createHarborMock(true, [], [], xiaohongshuScene, undefined, {}, readyXiaohongshuSiteFacts, { status: "unavailable", failure_class: "provider_probe_unavailable", retryable: true });
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
  const badJsonHarbor = createBadJsonHarborMock();
  const identityRequiredHarbor = createIdentityRequiredHarborMock();
  try {
    const { registryPath, allowlistAssetSha256 } = await writeLodeRegistry(root);
    const resolver = createLocalLodePackageResolver({ registryPath, allowlistAssetSha256 });
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
    const missingRefsOperationHarborPort = await listen(missingRefsOperationHarbor);
    const driftedSessionOperationHarborPort = await listen(driftedSessionOperationHarbor);
    const driftedBoundaryOperationHarborPort = await listen(driftedBoundaryOperationHarbor);
    const unknownOutcomeHarborPort = await listen(unknownOutcomeHarbor);
    const operationRefDriftHarborPorts = await Promise.all(operationRefDriftHarbors.map(listen));
    const deferredXiaohongshuFactsHarborPort = await listen(deferredXiaohongshuFactsHarbor);
    const blockedIdentityHarborPorts = await Promise.all(blockedIdentityHarbors.map(listen));
    const publicIdentityHarborPort = await listen(publicIdentityHarbor);
    const offlineHarborPort = await listen(offlineHarbor);
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
    const missingRefsOperationPort = await listen(missingRefsOperationServer);
    const driftedSessionOperationPort = await listen(driftedSessionOperationServer);
    const driftedBoundaryOperationPort = await listen(driftedBoundaryOperationServer);
    const unknownOutcomePort = await listen(unknownOutcomeServer);
    const deferredXiaohongshuFactsPort = await listen(deferredXiaohongshuFactsServer);
    const nonPinnedDeferredFactsPort = await listen(nonPinnedDeferredFactsServer);
    const operationRefDriftPorts = await Promise.all(operationRefDriftServers.map(listen));
    const blockedIdentityPorts = await Promise.all(blockedIdentityServers.map(listen));
    const publicIdentityPort = await listen(publicIdentityServer);
    const offlinePort = await listen(offlineServer);
    const badJsonPort = await listen(badJsonServer);
    const identityRequiredPort = await listen(identityRequiredServer);
    const raceDuplicatePort = await listen(raceDuplicateServer);
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
      const sessionBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/identity-environment-sessions")?.body);
      assert.equal(JSON.stringify(sessionBody).includes(harborSupervisorToken), false);
      const protectedSnapshotBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/sessions/session_runtime_api_ready/snapshot")?.body);
      assert.equal(JSON.stringify(protectedSnapshotBody).includes(harborSupervisorToken), false);
      assert.equal(sessionBody.run_id, "run_api_submit_runtime_chain");
      assert.equal(sessionBody.package_ref, packageRef);
      assert.equal(sessionBody.holder_ref, "run_api_submit_runtime_chain");
      assert.equal(sessionBody.url, "https://example.org/");
      const snapshotBody = asRecord(bodies.find((entry) => entry.path === "POST /runtime/sessions/session_runtime_api_ready/snapshot")?.body);
      assert.equal(snapshotBody.run_id, "run_api_submit_runtime_chain");
      assert.equal(snapshotBody.package_ref, packageRef);

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
      assert.equal(xiaohongshuSubmit.status, 202);
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
      const xiaohongshuSessionBody = asRecord(xiaohongshuBodies.find((entry) => entry.path === "POST /runtime/identity-environment-sessions")?.body);
      assert.equal(xiaohongshuSessionBody.package_ref, xiaohongshuPackageRef);
      assert.equal(xiaohongshuSessionBody.url, "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee");

      const bossSubmit = await postJson(bossPort, "/tasks", {
        run_id: "run_api_submit_boss_operation",
        package_ref: bossPackageRef,
        task_intent: bossTaskIntent("intent_api_submit_boss_operation"),
        public_query: { query: "AI" },
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://www.zhipin.com/web/geek/jobs?query=AI" }
      });
      assert.equal(bossSubmit.status, 202, JSON.stringify(bossSubmit.body));
      assert.equal(asRecord(asRecord(bossSubmit.body).run).status, "succeeded");
      assert(bossPaths.includes("POST /runtime/sessions/session_runtime_api_ready/snapshot"));
      assert.equal(asRecord(bossBodies.find((entry) => entry.path.endsWith("/read-operations"))?.body).query, "AI");

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
      await close(missingRefsOperationServer);
      await close(driftedSessionOperationServer);
      await close(driftedBoundaryOperationServer);
      await close(unknownOutcomeServer);
      await close(deferredXiaohongshuFactsServer);
      await close(nonPinnedDeferredFactsServer);
      await Promise.all(operationRefDriftServers.map(close));
      await Promise.all(blockedIdentityServers.map(close));
      await close(publicIdentityServer);
      await close(offlineServer);
      await close(badJsonServer);
      await close(identityRequiredServer);
      await close(raceDuplicateServer);
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
    await close(missingRefsOperationHarbor);
    await close(driftedSessionOperationHarbor);
    await close(driftedBoundaryOperationHarbor);
    await close(unknownOutcomeHarbor);
    await close(deferredXiaohongshuFactsHarbor);
    await Promise.all(operationRefDriftHarbors.map(close));
    await Promise.all(blockedIdentityHarbors.map(close));
    await close(publicIdentityHarbor);
    await close(offlineHarbor);
    await close(badJsonHarbor);
    await close(identityRequiredHarbor);
    if (previousSupervisorToken === undefined) delete process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
    else process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN = previousSupervisorToken;
    await rm(root, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
  await assertLodeResolverStaysUnderRoot();
}
