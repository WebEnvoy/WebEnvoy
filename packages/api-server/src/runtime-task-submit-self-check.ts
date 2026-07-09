import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const packageRef = "lode://site-capability/example/read-public-page@0.1.0";
const lockRef = "lode://lock/site-capability/example/read-public-page@0.1.0";
const resourceRef = "example.read-public-page.resources";
const xiaohongshuPackageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuLockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuResourceRef = "xiaohongshu.search-notes.resources";
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

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

function asRecord(value: unknown): JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
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

async function writeLodeRegistry(root: string): Promise<string> {
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(join(root, "sites", "example", "read-public-page"), { recursive: true });
  await mkdir(join(root, "sites", "xiaohongshu", "search-notes"), { recursive: true });
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
          lifecycle: "proposed"
        }
      ]
    })
  );
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
            { fact_key: "evidence.snapshot_ref.available", owner: "Harbor", required: true },
            { fact_key: "safety.challenge.absent", owner: "Harbor", required: true }
          ]
        }
      ]
    })
  );
  return join(root, "registry", "local-packages.json");
}

function createHarborMock(
  ready: boolean,
  paths: string[],
  bodies: Array<{ path: string; body: JsonObject }> = [],
  sceneOverrides: JsonObject = {},
  evidenceBody: JsonObject = { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
  sessionOverrides: JsonObject = {},
  siteResourceBody: JsonObject | undefined = undefined
): Server {
  const sessionRef = "session_runtime_api_ready";
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
          site: { site_id: "example", origin: "https://example.org", display_name: "Example", account_ref: "account_runtime_api" },
          status: {
            readiness: "ready",
            login_state: "logged_in",
            browser_storage_state: "present",
            manual_authentication_state: "not_required",
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
          public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed" }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/identity-environment-sessions") {
        sendJson(response, 200, {
          identity_environment_facts: {
            schema_version: "harbor-local-identity-environment/v0",
            identity_environment_ref: "identity-env_runtime_api",
            execution_identity_ref: "identity-env_runtime_api:execution",
            profile_ref: "profile_runtime_api",
            site_binding: { site_id: "example", origin: "https://example.org" },
            login_state: { state: "logged_in", recovery_required: false },
            browser_storage: { state: "present" },
            provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "default_provider_available" },
            consumer_boundary: {
              core: "admission_facts_refs_and_blocking_reasons_only",
              not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
            }
          },
          runtime_facts: {
            schema_version: "harbor-core-runtime-facts/v0",
            runtime_session_ref: sessionRef,
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
            fact_refs: { session: sessionRef, viewer: "viewer_runtime_api" },
            unavailable: null
          },
          ...sessionOverrides
        });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/snapshot`) {
        sendJson(response, 200, { status: "captured", core_scene_ref: scene, evidence_refs: scene.evidence_refs });
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
  const missingXiaohongshuFactHarbor = createHarborMock(
    true,
    [],
    [],
    xiaohongshuScene,
    { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" },
    {},
    {
      ...readyXiaohongshuSiteFacts,
      resource_facts: (readyXiaohongshuSiteFacts.resource_facts as JsonObject[]).map((fact) =>
        fact.key === "page.pinia_store.ready" ? { ...fact, state: "unknown", severity: "warning", message: "Pinia readiness is not safely observable." } : fact
      )
    }
  );
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
    const registryPath = await writeLodeRegistry(root);
    const harborPort = await listen(harbor);
    const mismatchedSceneHarborPort = await listen(mismatchedSceneHarbor);
    const missingSceneUrlHarborPort = await listen(missingSceneUrlHarbor);
    const invalidSceneUrlHarborPort = await listen(invalidSceneUrlHarbor);
    const invalidEvidenceHarborPort = await listen(invalidEvidenceHarbor);
    const malformedEvidenceHarborPort = await listen(malformedEvidenceHarbor);
    const mismatchedEvidenceHarborPort = await listen(mismatchedEvidenceHarbor);
    const xiaohongshuHarborPort = await listen(xiaohongshuHarbor);
    const missingXiaohongshuFactHarborPort = await listen(missingXiaohongshuFactHarbor);
    const publicIdentityHarborPort = await listen(publicIdentityHarbor);
    const offlineHarborPort = await listen(offlineHarbor);
    const badJsonHarborPort = await listen(badJsonHarbor);
    const identityRequiredHarborPort = await listen(identityRequiredHarbor);
    const store = createFileRunRecordStore({ directory: runDir });
    const server = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` })
    });
    const offlineServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${offlineHarborPort}` })
    });
    const mismatchedSceneServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${mismatchedSceneHarborPort}` })
    });
    const missingSceneUrlServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${missingSceneUrlHarborPort}` })
    });
    const invalidSceneUrlServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${invalidSceneUrlHarborPort}` })
    });
    const invalidEvidenceServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${invalidEvidenceHarborPort}` })
    });
    const malformedEvidenceServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${malformedEvidenceHarborPort}` })
    });
    const mismatchedEvidenceServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${mismatchedEvidenceHarborPort}` })
    });
    const xiaohongshuServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${xiaohongshuHarborPort}` })
    });
    const missingXiaohongshuFactServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${missingXiaohongshuFactHarborPort}` })
    });
    const publicIdentityServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${publicIdentityHarborPort}` })
    });
    const badJsonServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${badJsonHarborPort}` })
    });
    const identityRequiredServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${identityRequiredHarborPort}` })
    });
    const raceDuplicateServer = createApiServer({
      runRecordStore: createDuplicateRunRaceStore(store),
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
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
    const missingXiaohongshuFactPort = await listen(missingXiaohongshuFactServer);
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
      const xiaohongshuSessionBody = asRecord(xiaohongshuBodies.find((entry) => entry.path === "POST /runtime/identity-environment-sessions")?.body);
      assert.equal(xiaohongshuSessionBody.package_ref, xiaohongshuPackageRef);
      assert.equal(xiaohongshuSessionBody.url, "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee");

      const xiaohongshuMissingFact = await postJson(missingXiaohongshuFactPort, "/tasks", {
        run_id: "run_api_submit_xiaohongshu_missing_fact",
        package_ref: xiaohongshuPackageRef,
        task_intent: xiaohongshuTaskIntent("intent_api_submit_xiaohongshu_missing_fact"),
        harbor: {
          identity_environment_ref: "identity-env_runtime_api",
          url: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee"
        }
      });
      assert.equal(xiaohongshuMissingFact.status, 503);
      const xiaohongshuMissingFactBody = asRecord(xiaohongshuMissingFact.body);
      assert.equal(xiaohongshuMissingFactBody.ok, false);
      assert.equal(asRecord(xiaohongshuMissingFactBody.error).code, "resource_fact_missing:page.pinia_store.ready");
      assert.equal(asRecord(xiaohongshuMissingFactBody.run).status, "failed");

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
      assert.equal(mismatchedScene.status, 202);
      const mismatchedSceneRun = asRecord(asRecord(mismatchedScene.body).run);
      assert.equal(mismatchedSceneRun.status, "admitted");
      assert.equal(mismatchedSceneRun.result_ref, undefined);

      const missingSceneUrl = await postJson(missingSceneUrlPort, "/tasks", {
        run_id: "run_api_submit_missing_scene_url",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_missing_scene_url"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(missingSceneUrl.status, 202);
      const missingSceneUrlRun = asRecord(asRecord(missingSceneUrl.body).run);
      assert.equal(missingSceneUrlRun.status, "admitted");
      assert.equal(missingSceneUrlRun.result_ref, undefined);

      const invalidSceneUrl = await postJson(invalidSceneUrlPort, "/tasks", {
        run_id: "run_api_submit_invalid_scene_url",
        package_ref: packageRef,
        task_intent: taskIntent("intent_api_submit_invalid_scene_url"),
        harbor: { identity_environment_ref: "identity-env_runtime_api", url: "https://example.org/" }
      });
      assert.equal(invalidSceneUrl.status, 202);
      const invalidSceneUrlRun = asRecord(asRecord(invalidSceneUrl.body).run);
      assert.equal(invalidSceneUrlRun.status, "admitted");
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
      await close(missingXiaohongshuFactServer);
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
    await close(missingXiaohongshuFactHarbor);
    await close(publicIdentityHarbor);
    await close(offlineHarbor);
    await close(badJsonHarbor);
    await close(identityRequiredHarbor);
    await rm(root, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
  await assertLodeResolverStaysUnderRoot();
}
