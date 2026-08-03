import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import { readRequestJson, sendJson, type JsonObject } from "./self-check-process-support.js";

export const packageRef = "lode://site-capability/example/read-public-page@0.1.0";
export const bossPackageRef = "lode://site-capability/boss/job-search@0.1.0";
export const lockRef = "lode://lock/site-capability/example/read-public-page@0.1.0";
export const resourceRef = "example.read-public-page.resources";
export const harborSupervisorToken = "runtime-process-supervisor-token";
export const requiredHarborFactKeys = [
  "runtime.execution_surface.available",
  "runtime.public_https_navigation.allowed",
  "snapshot.document_summary.available",
  "refmap.source_refs.available",
  "evidence.snapshot_ref.available"
];
export const expectedRuntimeBindingRefs = [
  "session_process_ready", "profile_process", "harbor:provider/cloakbrowser", "viewer_process",
  "identity-env_process", "identity-env_process:execution", "snapshot_process_ready",
  "refmap_process_ready", "source_trace_process_ready"
];

const identityPrivateBoundary = ["password", "verification_code", "cookie_value", "storage_value", "session_token"];
type FixtureState = { currentHolderRef: string; cleanupState: "held" | "released" };

export async function writeLodeRegistry(root: string): Promise<string> {
  const packageRoot = join(root, "sites", "example", "read-public-page");
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(root, "registry", "local-packages.json"), JSON.stringify({
    schema_version: "lode.local-package-registry.v0",
    entries: [{
      package_ref: packageRef, package_type: "site-capability", package_path: "sites/example/read-public-page",
      manifest_path: "sites/example/read-public-page/manifest.json", lock_ref: lockRef,
      capability_id: "read-public-page", operation_id: "content_detail_by_url", operation_mode: "read",
      version: "0.1.0", lifecycle: "proposed"
    }]
  }));
  await writeFile(join(packageRoot, "manifest.json"), JSON.stringify({
    manifest_version: "lode.site-capability.manifest.v0", package_ref: packageRef, package_type: "site-capability",
    capability: {
      capability_id: "read-public-page", operation_id: "content_detail_by_url", operation_mode: "read",
      version: "0.1.0", lifecycle: "proposed"
    },
    asset_refs: [
      { role: "resource_requirements", path: "resource-requirements.json", status: "present" },
      { role: "package_lock", path: "package-lock.json", status: "present", lock_ref: lockRef }
    ]
  }));
  await writeFile(join(packageRoot, "resource-requirements.json"), JSON.stringify({
    schema_version: "lode.resource-requirements.v0", resource_requirements_id: resourceRef,
    resource_requirements_version: "0.1.0", package_ref: packageRef, operation_mode: "read",
    resource_requirement_profiles: [{
      requirement_profile_id: "example-read-with-snapshot", operation_boundary: "read",
      required_harbor_facts: requiredHarborFactKeys.map((fact_key) => ({ fact_key, owner: "Harbor", required: true }))
    }]
  }));
  return join(root, "registry", "local-packages.json");
}

export function taskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0", intent_id: intentId, entrypoint: "app",
    user_intent: { summary: "Read Example Domain through a Harbor runtime session." },
    capability: { ref: "lode:capability/read-public-page", version: "0.1.0", source_ref: packageRef, lock_ref: lockRef },
    input: { summary: "Read the current public page summary.", refs: ["https://example.org/"] },
    scope: { target_type: "public_page", target_ref: "https://example.org/" },
    policy: { risk: "read", execution_intent: "read", timeout_ms: 5000 },
    resource_requirement_refs: [resourceRef], resource_requirement_profile_id: "example-read-with-snapshot",
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

export function bossTaskIntent(intentId: string): JsonObject {
  return {
    ...taskIntent(intentId),
    capability: {
      ref: "lode:capability/job-search", version: "0.1.0", source_ref: bossPackageRef,
      lock_ref: "lode://lock/site-capability/boss/job-search@0.1.0"
    },
    scope: { target_type: "boss_job_search", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
    resource_requirement_profile_id: "boss-job-search-live-runtime"
  };
}

function handleIdentityRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  body: JsonObject,
  state: FixtureState
): boolean {
  if (request.method === "GET" && request.url === "/runtime/identity-environments/identity-env_process") {
    sendJson(response, 200, {
      schema_version: "harbor-local-identity-environment-store/v0", identity_environment_ref: "identity-env_process",
      site: { site_id: "example", origin: "https://example.org", display_name: "Example" },
      status: {
        login_state: "logged_in", authentication_provenance: "user_confirmed_managed_session",
        manual_authentication_state: "completed", browser_storage_state: "present", recovery_required: false,
        blocking_reasons: [], repair_reasons: []
      },
      refs: { execution_identity_ref: "identity-env_process:execution", profile_ref: "profile_process" },
      environment_summary: { provider_id: "cloakbrowser" }
    });
    return true;
  }
  if (request.method !== "POST" || request.url !== "/runtime/identity-environment-sessions") return false;
  state.currentHolderRef = typeof body.holder_ref === "string" ? body.holder_ref : "";
  state.cleanupState = "held";
  sendJson(response, 200, {
    runtime_session_ref: "session_process_ready", identity_environment_ref: "identity-env_process",
    execution_identity_ref: "identity-env_process:execution", profile_ref: "profile_process",
    provider_ref: "harbor:provider/cloakbrowser", provider_mode: "local", lifecycle_state: "active",
    viewer_ref: "viewer_process", availability: { cdp: "available", viewer: "available", snapshot: "available", evidence: "available" },
    last_seen_at: "2026-07-09T00:00:00.000Z",
    facts: requiredHarborFactKeys.map((key) => ({ key, state: "available", evidence_ref: "evidence_process_snapshot" })),
    harbor_identity_environment_facts: {
      schema_version: "harbor-local-identity-environment/v0", identity_environment_ref: "identity-env_process",
      execution_identity_ref: "identity-env_process:execution", profile_ref: "profile_process",
      site_binding: { site_id: "example", origin: "https://example.org" },
      login_state: { state: "logged_in", authentication_provenance: "user_confirmed_managed_session", manual_authentication_state: "completed", recovery_required: false },
      browser_storage: { state: "present" },
      provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "default_provider_available" },
      consumer_boundary: { core: "admission_facts_refs_and_blocking_reasons_only", not_exposed: identityPrivateBoundary }
    }
  });
  return true;
}

function handleSessionRoutes(request: IncomingMessage, response: ServerResponse, body: JsonObject, state: FixtureState): boolean {
  if (request.method === "GET" && request.url === "/runtime/sessions/session_process_ready") {
    const released = state.cleanupState === "released";
    sendJson(response, 200, {
      runtime_session_ref: "session_process_ready", lifecycle_state: released ? "idle" : "active",
      control_owner: released ? "none" : "core_task",
      control_lock: released ? { owner: "none", state: "released", holder_ref: null } : { owner: "core_task", state: "held", holder_ref: state.currentHolderRef }
    });
    return true;
  }
  if (request.method === "GET" && request.url === "/runtime/sessions/session_process_ready/runtime-facts") {
    sendJson(response, 404, { status: "unavailable", failure_class: "runtime_facts_unsupported", retryable: false });
    return true;
  }
  if (request.method === "POST" && request.url === "/runtime/sessions/session_process_ready/snapshot") {
    const runId = typeof body.run_id === "string" ? body.run_id : "";
    sendJson(response, 200, { harbor_scene_ref: {
      schema_version: "harbor-page-scene-refs/v0", runtime_session_ref: "session_process_ready",
      snapshot_ref: "snapshot_process_ready", refmap_ref: "refmap_process_ready",
      source_trace_ref: "source_trace_process_ready", evidence_refs: ["evidence_process_snapshot"],
      captured_at: "2026-07-09T00:00:00.000Z",
      page_summary: { title: "Example Domain", url: runId === "run_process_mismatched_scene" ? "https://other.example/" : "https://example.org/", summary: "Public page summary captured by Harbor refs." },
      unavailable: null
    } });
    return true;
  }
  if (request.method === "POST" && request.url === "/runtime/sessions/session_process_ready/release") {
    state.cleanupState = "released";
    sendJson(response, 200, { status: "released", runtime_session_ref: "session_process_ready", control_owner: "none", control_lock: { owner: "none", state: "released", holder_ref: null } });
    return true;
  }
  return false;
}

export function createHarborMock(paths: string[], protectedAuthorization: string[], initialHolderRef = ""): Server {
  const state: FixtureState = { currentHolderRef: initialHolderRef, cleanupState: "held" };
  return createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    const protectedRequest = request.method === "POST" && (
      request.url === "/runtime/identity-environment-sessions" ||
      /^\/runtime\/(?:identity-environment-)?sessions\/[^/]+\/(?:lock|release|stop|snapshot|read-operations)$/.test(request.url ?? "")
    );
    if (protectedRequest) protectedAuthorization.push(request.headers.authorization ?? "");
    if (protectedRequest && request.headers.authorization !== `Bearer ${harborSupervisorToken}`) {
      sendJson(response, 401, { status: "unavailable", failure_class: "supervisor_authorization_required", retryable: false });
      return;
    }
    void readRequestJson(request).then((body) => {
      if (request.method === "GET" && request.url === "/readiness") return sendJson(response, 200, { status: "ready" });
      if (request.method === "GET" && request.url === "/runtime/browser-providers") {
        return sendJson(response, 200, { schema_version: "harbor-browser-provider-status/v0", providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }] });
      }
      if (handleIdentityRoutes(request, response, body, state) || handleSessionRoutes(request, response, body, state)) return;
      if (request.method === "GET" && request.url === "/runtime/evidence/evidence_process_snapshot") {
        return sendJson(response, 200, { evidence_ref: "evidence_process_snapshot", access_state: "available" });
      }
      sendJson(response, 404, { error: { category: "resource_admission", code: "mock_route_missing", phase: "runtime_binding", recovery_hint: "repair_mock" } });
    }).catch((error: unknown) => sendJson(response, 500, {
      error: { category: "resource_admission", code: "mock_failure", phase: "runtime_binding", recovery_hint: error instanceof Error ? error.message : "repair_mock" }
    }));
  });
}
