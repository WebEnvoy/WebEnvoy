import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFileRunRecordStore } from "@webenvoy/core-runtime";

type JsonResponse = {
  status: number;
  body: unknown;
};
type JsonObject = Record<string, unknown>;

const packageRef = "lode://site-capability/example/read-public-page@0.1.0";
const bossPackageRef = "lode://site-capability/boss/job-search@0.1.0";
const lockRef = "lode://lock/site-capability/example/read-public-page@0.1.0";
const resourceRef = "example.read-public-page.resources";
const requiredHarborFactKeys = [
  "runtime.execution_surface.available",
  "runtime.public_https_navigation.allowed",
  "snapshot.document_summary.available",
  "refmap.source_refs.available",
  "evidence.snapshot_ref.available"
];
const identityPrivateBoundary = ["password", "verification_code", "cookie_value", "storage_value", "session_token"];
const expectedRuntimeBindingRefs = ["session_process_ready", "profile_process", "harbor:provider/cloakbrowser", "viewer_process", "identity-env_process", "identity-env_process:execution", "snapshot_process_ready", "refmap_process_ready", "source_trace_process_ready"];
const harborSupervisorToken = "runtime-process-supervisor-token";
const apiServerEntry = join(dirname(fileURLToPath(import.meta.url)), "index.js");

function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readRequestJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length === 0 ? {} : asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function getJson(port: number, path: string): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    body: await response.json()
  };
}

async function postJson(port: number, path: string, body: unknown): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function waitForJson(port: number, path: string, child: ChildProcess): Promise<JsonResponse> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 5_000) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited before ${path} became available.`);
    }
    try {
      return await getJson(port, path);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function spawnApiServer(port: number, runRecordDir: string, env: Record<string, string> = {}): { child: ChildProcess; output: () => string } {
  const child = spawn(process.execPath, [apiServerEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      WEBENVOY_RUN_RECORD_DIR: runRecordDir,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    child,
    output: () => `API server stdout:\n${stdout}\nAPI server stderr:\n${stderr}`
  };
}

async function writeLodeRegistry(root: string): Promise<string> {
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(join(root, "sites", "example", "read-public-page"), { recursive: true });
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
          required_harbor_facts: requiredHarborFactKeys.map((fact_key) => ({ fact_key, owner: "Harbor", required: true }))
        }
      ]
    })
  );
  return join(root, "registry", "local-packages.json");
}

function taskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read Example Domain through a Harbor runtime session." },
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
    resource_requirement_profile_id: "example-read-with-snapshot",
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function bossTaskIntent(intentId: string): JsonObject {
  return {
    ...taskIntent(intentId),
    capability: { ref: "lode:capability/job-search", version: "0.1.0", source_ref: bossPackageRef, lock_ref: "lode://lock/site-capability/boss/job-search@0.1.0" },
    scope: { target_type: "boss_job_search", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
    resource_requirement_profile_id: "boss-job-search-live-runtime"
  };
}

function createHarborMock(paths: string[], protectedAuthorization: string[], initialHolderRef = ""): Server {
  let currentHolderRef = initialHolderRef;
  let cleanupState: "held" | "released" = "held";
  return createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    const protectedRequest = request.method === "POST" && (
      request.url === "/runtime/identity-environment-sessions" ||
      /^\/runtime\/(?:identity-environment-)?sessions\/[^/]+\/(?:lock|release|stop|snapshot|read-operations)$/.test(request.url ?? "")
    );
    if (protectedRequest) {
      protectedAuthorization.push(request.headers.authorization ?? "");
      if (request.headers.authorization !== `Bearer ${harborSupervisorToken}`) {
        sendJson(response, 401, { status: "unavailable", failure_class: "supervisor_authorization_required", retryable: false });
        return;
      }
    }
    void readRequestJson(request).then((body) => {
      if (request.method === "GET" && request.url === "/readiness") {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/browser-providers") {
        sendJson(response, 200, {
          schema_version: "harbor-browser-provider-status/v0",
          providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }]
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/identity-environments/identity-env_process") {
        sendJson(response, 200, {
          schema_version: "harbor-local-identity-environment-store/v0",
          identity_environment_ref: "identity-env_process",
          site: { site_id: "example", origin: "https://example.org", display_name: "Example" },
          status: {
            login_state: "logged_in",
            authentication_provenance: "user_confirmed_managed_session",
            manual_authentication_state: "completed",
            browser_storage_state: "present",
            recovery_required: false,
            blocking_reasons: [],
            repair_reasons: []
          },
          refs: { execution_identity_ref: "identity-env_process:execution", profile_ref: "profile_process" },
          environment_summary: { provider_id: "cloakbrowser" }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/identity-environment-sessions") {
        currentHolderRef = typeof body.holder_ref === "string" ? body.holder_ref : "";
        cleanupState = "held";
        sendJson(response, 200, {
          runtime_session_ref: "session_process_ready",
          identity_environment_ref: "identity-env_process",
          execution_identity_ref: "identity-env_process:execution",
          profile_ref: "profile_process",
          provider_ref: "harbor:provider/cloakbrowser",
          provider_mode: "local",
          lifecycle_state: "active",
          viewer_ref: "viewer_process",
          availability: { cdp: "available", viewer: "available", snapshot: "available", evidence: "available" },
          last_seen_at: "2026-07-09T00:00:00.000Z",
          facts: requiredHarborFactKeys.map((key) => ({ key, state: "available", evidence_ref: "evidence_process_snapshot" })),
          harbor_identity_environment_facts: {
            schema_version: "harbor-local-identity-environment/v0",
            identity_environment_ref: "identity-env_process",
            execution_identity_ref: "identity-env_process:execution",
            profile_ref: "profile_process",
            site_binding: { site_id: "example", origin: "https://example.org" },
            login_state: { state: "logged_in", recovery_required: false },
            browser_storage: { state: "present" },
            provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "default_provider_available" },
            consumer_boundary: {
              core: "admission_facts_refs_and_blocking_reasons_only",
              not_exposed: identityPrivateBoundary
            }
          }
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/sessions/session_process_ready") {
        sendJson(response, 200, {
          runtime_session_ref: "session_process_ready",
          lifecycle_state: cleanupState === "released" ? "idle" : "active",
          control_owner: cleanupState === "released" ? "none" : "core_task",
          control_lock: cleanupState === "released"
            ? { owner: "none", state: "released", holder_ref: null }
            : { owner: "core_task", state: "held", holder_ref: currentHolderRef }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/sessions/session_process_ready/snapshot") {
        const runId = typeof body.run_id === "string" ? body.run_id : "";
        sendJson(response, 200, {
          harbor_scene_ref: {
            schema_version: "harbor-page-scene-refs/v0",
            runtime_session_ref: "session_process_ready",
            snapshot_ref: "snapshot_process_ready",
            refmap_ref: "refmap_process_ready",
            source_trace_ref: "source_trace_process_ready",
            evidence_refs: ["evidence_process_snapshot"],
            captured_at: "2026-07-09T00:00:00.000Z",
            page_summary: {
              title: "Example Domain",
              url: runId === "run_process_mismatched_scene" ? "https://other.example/" : "https://example.org/",
              summary: "Public page summary captured by Harbor refs."
            },
            unavailable: null
          }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/sessions/session_process_ready/release") {
        cleanupState = "released";
        sendJson(response, 200, {
          status: "released",
          runtime_session_ref: "session_process_ready",
          control_owner: "none",
          control_lock: { owner: "none", state: "released", holder_ref: null }
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/evidence/evidence_process_snapshot") {
        sendJson(response, 200, { evidence_ref: "evidence_process_snapshot", access_state: "available" });
        return;
      }
      sendJson(response, 404, {
        error: {
          category: "resource_admission",
          code: "mock_route_missing",
          phase: "runtime_binding",
          recovery_hint: "repair_mock"
        }
      });
    }).catch((error: unknown) => {
      sendJson(response, 500, {
        error: {
          category: "resource_admission",
          code: "mock_failure",
          phase: "runtime_binding",
          recovery_hint: error instanceof Error ? error.message : "repair_mock"
        }
      });
    });
  });
}

async function assertDegradedProcessSmoke(): Promise<void> {
  const port = await reservePort();
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-runs-"));
  const { child, output } = spawnApiServer(port, runRecordDir);

  try {
    assert.deepEqual(await waitForJson(port, "/health", child), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ok"
      }
    });

    const admission = await getJson(port, "/admission/health");
    assert.equal(admission.status, 200);
    const admissionBody = asRecord(admission.body);
    assert.equal(admissionBody.service, "webenvoy-api-server");
    assert.equal(admissionBody.status, "degraded");
    const checks = asRecord(admissionBody.checks);
    assert.equal(checks.runRecordStore, "configured");
    assert.equal(checks.lodePackageResolver, "missing");
    assert.equal(checks.harborRuntimeClient, "missing");

    const capabilityRuns = await getJson(
      port,
      "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0&limit=8"
    );
    assert.equal(capabilityRuns.status, 200);
    const capabilityRunsBody = asRecord(capabilityRuns.body);
    assert.equal(capabilityRunsBody.ok, true);
    const envelope = asRecord(capabilityRunsBody.capability_runs);
    assert.equal(envelope.schema_version, "webenvoy.capability-run-query.v0");
    assert.equal(envelope.total_runs, 0);
    assert.equal(envelope.returned_runs, 0);
    assert.deepEqual(envelope.runs, []);

    const missingCapabilityRef = await getJson(port, "/capability-runs");
    assert.equal(missingCapabilityRef.status, 400);
    const missingCapabilityRefBody = asRecord(missingCapabilityRef.body);
    assert.equal(missingCapabilityRefBody.ok, false);
    assert.equal(asRecord(missingCapabilityRefBody.error).code, "capability_ref_required");

    const validBossQuery = await postJson(port, "/tasks", {
      run_id: "run_process_boss_query_valid",
      package_ref: bossPackageRef,
      task_intent: bossTaskIntent("intent_process_boss_query_valid"),
      public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
      harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
    });
    assert.equal(validBossQuery.status, 422);
    assert.equal(asRecord(asRecord(validBossQuery.body).error).code, "lode_resolver_unconfigured");

    const invalidBossQueries: Array<{ name: string; public_query: JsonObject }> = [
      { name: "city_missing", public_query: { query: "AI", page: 1, limit: 15 } },
      { name: "city_invalid", public_query: { query: "AI", city_code: "beijing", page: 1, limit: 15 } },
      { name: "page", public_query: { query: "AI", city_code: "101010100", page: 2, limit: 15 } },
      { name: "limit", public_query: { query: "AI", city_code: "101010100", page: 1, limit: 16 } },
      { name: "query_length", public_query: { query: "A".repeat(81), city_code: "101010100", page: 1, limit: 15 } },
      { name: "unknown", public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15, sort: "latest" } }
    ];
    for (const invalid of invalidBossQueries) {
      const response = await postJson(port, "/tasks", {
        run_id: `run_process_boss_query_${invalid.name}`,
        package_ref: bossPackageRef,
        task_intent: bossTaskIntent(`intent_process_boss_query_${invalid.name}`),
        public_query: invalid.public_query,
        harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
      });
      assert.equal(response.status, 400, invalid.name);
      assert.equal(asRecord(asRecord(response.body).error).code, "public_query_invalid", invalid.name);
    }
    const missingBossQuery = await postJson(port, "/tasks", {
      run_id: "run_process_boss_query_missing",
      package_ref: bossPackageRef,
      task_intent: bossTaskIntent("intent_process_boss_query_missing"),
      harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
    });
    assert.equal(missingBossQuery.status, 400);
    assert.equal(asRecord(asRecord(missingBossQuery.body).error).code, "public_query_invalid");

    const targetDriftCases: Array<{ name: string; target_ref?: string; harbor_url?: string }> = [
      { name: "target_ref_missing", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
      { name: "target_ref_path", target_ref: "https://www.zhipin.com/web/geek/jobs?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
      { name: "harbor_missing", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
      { name: "harbor_query", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=other&city=101010100" },
      { name: "harbor_city", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101020100" },
      { name: "harbor_extra", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100&extra=1" },
      { name: "harbor_duplicate", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&query=AI&city=101010100" }
    ];
    for (const drift of targetDriftCases) {
      const intent = bossTaskIntent(`intent_process_boss_target_${drift.name}`);
      intent.scope = { ...asRecord(intent.scope), target_ref: drift.target_ref };
      const response = await postJson(port, "/tasks", {
        run_id: `run_process_boss_target_${drift.name}`,
        package_ref: bossPackageRef,
        task_intent: intent,
        public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
        ...(drift.harbor_url === undefined ? {} : { harbor: { url: drift.harbor_url } })
      });
      assert.equal(response.status, 400, drift.name);
      assert.equal(asRecord(asRecord(response.body).error).code, "boss_target_invalid", drift.name);
    }

    for (const [name, field] of [["city", { city_code: "101010100" }], ["page", { page: 1 }], ["limit", { limit: 15 }]] as const) {
      const response = await postJson(port, "/tasks", {
        run_id: `run_process_xhs_query_${name}`,
        package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
        task_intent: taskIntent(`intent_process_xhs_query_${name}`),
        public_query: { query: "coffee", ...field }
      });
      assert.equal(response.status, 400, name);
      assert.equal(asRecord(asRecord(response.body).error).code, "public_query_invalid", name);
    }
  } catch (error) {
    console.error(output());
    throw error;
  } finally {
    await stopProcess(child);
    await rm(runRecordDir, { recursive: true, force: true });
  }
}

async function assertConfiguredTaskProcessSmoke(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-assets-"));
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-runs-"));
  const registryPath = await writeLodeRegistry(root);
  const harborPaths: string[] = [];
  const protectedAuthorization: string[] = [];
  const interruptedRunId = "run_process_recover_interrupted_core_task";
  const harbor = createHarborMock(harborPaths, protectedAuthorization, interruptedRunId);
  const harborPort = await listen(harbor);
  const apiPort = await reservePort();
  const recoveryStore = createFileRunRecordStore({ directory: runRecordDir });
  await recoveryStore.createRunRecord({
    run_id: interruptedRunId,
    status: "admitted",
    task_intent_ref: "intent:process/recover-interrupted-core-task",
    capability_ref: "lode:capability/read-public-page",
    admission: {
      decision: "accepted",
      action_risk: "read",
      runtime_session_binding: {
        schema_version: "webenvoy.runtime-session-binding.v0",
        identity_environment_ref: "identity-env_process",
        execution_identity_ref: "identity-env_process:execution",
        runtime_session_ref: "session_process_ready",
        profile_ref: "profile_process",
        provider_ref: "harbor:provider/cloakbrowser",
        provider_mode: "local",
        lifecycle_state: "active",
        control_owner: "core_task",
        session_use: "core_task_run",
        core_task_run: true,
        consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
      }
    }
  });
  await recoveryStore.updateRunRecord(interruptedRunId, { status: "running" });
  const { child, output } = spawnApiServer(apiPort, runRecordDir, {
    WEBENVOY_LODE_REGISTRY_PATH: registryPath,
    WEBENVOY_HARBOR_RUNTIME_URL: `http://127.0.0.1:${harborPort}`,
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: harborSupervisorToken
  });

  try {
    await waitForJson(apiPort, "/health", child);
    const recoveredRun = await getJson(apiPort, `/runs/${interruptedRunId}`);
    assert.equal(recoveredRun.status, 200);
    const recoveredRunBody = asRecord(asRecord(recoveredRun.body).run);
    assert.equal(recoveredRunBody.status, "failed");
    assert.equal(asRecord(asRecord(recoveredRunBody.terminal_summary).failure).code, "core_task_interrupted");
    const admission = await getJson(apiPort, "/admission/health");
    assert.equal(admission.status, 200);
    const admissionBody = asRecord(admission.body);
    assert.equal(admissionBody.status, "ready");
    const checks = asRecord(admissionBody.checks);
    assert.equal(checks.runRecordStore, "configured");
    assert.equal(checks.lodePackageResolver, "configured");
    assert.equal(checks.harborRuntimeClient, "configured");

    const submit = await postJson(apiPort, "/tasks", {
      run_id: "run_process_submit_runtime_chain",
      package_ref: packageRef,
      task_intent: taskIntent("intent_process_submit_runtime_chain"),
      harbor: {
        identity_environment_ref: "identity-env_process",
        url: "https://example.org/"
      }
    });
    assert.equal(submit.status, 202, JSON.stringify(submit.body));
    const submitBody = asRecord(submit.body);
    assert.equal(submitBody.ok, true);
    const run = asRecord(submitBody.run);
    assert.equal(run.status, "succeeded");
    assert.equal(run.result_ref, "result:core/intent_process_submit_runtime_chain");
    assert.deepEqual(run.evidence_refs, ["evidence_process_snapshot"]);
    assert.deepEqual(asRecord(run.admission).runtime_binding_refs, expectedRuntimeBindingRefs);

    const result = await getJson(apiPort, "/runs/run_process_submit_runtime_chain/result");
    assert.equal(result.status, 200);
    const resultEnvelope = asRecord(asRecord(asRecord(asRecord(result.body).result).result).result_envelope);
    assert.equal(resultEnvelope.ok, true);
    assert.equal(resultEnvelope.projection_ref, "projection:core/intent_process_submit_runtime_chain");

    const evidence = await getJson(apiPort, "/runs/run_process_submit_runtime_chain/evidence-refs");
    assert.equal(evidence.status, 200);
    const evidenceRefs = asRecord(asRecord(evidence.body).evidence).evidence_refs;
    assert(Array.isArray(evidenceRefs));
    assert.equal(evidenceRefs.length, 1);

    const session = await getJson(apiPort, "/runs/run_process_submit_runtime_chain/session-refs");
    assert.equal(session.status, 200);
    const sessionRefs = asRecord(asRecord(asRecord(session.body).session_refs).session_refs);
    assert.equal(sessionRefs.runtime_session_ref, "session_process_ready");
    assert.equal(sessionRefs.identity_environment_ref, "identity-env_process");

    const capabilityRuns = await getJson(
      apiPort,
      "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0&package_ref=lode%3A%2F%2Fsite-capability%2Fexample%2Fread-public-page%400.1.0&limit=8"
    );
    assert.equal(capabilityRuns.status, 200);
    const statusCounts = asRecord(asRecord(asRecord(capabilityRuns.body).capability_runs).status_counts);
    assert.equal(statusCounts.succeeded, 1);

    const mismatchedScene = await postJson(apiPort, "/tasks", {
      run_id: "run_process_mismatched_scene",
      package_ref: packageRef,
      task_intent: taskIntent("intent_process_mismatched_scene"),
      harbor: {
        identity_environment_ref: "identity-env_process",
        url: "https://example.org/"
      }
    });
    assert.equal(mismatchedScene.status, 400);
    const mismatchedSceneBody = asRecord(mismatchedScene.body);
    assert.equal(mismatchedSceneBody.ok, false);
    assert.equal(asRecord(mismatchedSceneBody.error).code, "page_changed");
    const mismatchedRun = asRecord(mismatchedSceneBody.run);
    assert.equal(mismatchedRun.status, "blocked");
    assert.deepEqual(mismatchedRun.evidence_refs, ["evidence_process_snapshot"]);

    assert(harborPaths.includes("GET /readiness"));
    assert(harborPaths.includes("GET /runtime/browser-providers"));
    assert(harborPaths.includes("GET /runtime/identity-environments/identity-env_process"));
    assert(harborPaths.includes("POST /runtime/identity-environment-sessions"));
    assert(harborPaths.includes("POST /runtime/sessions/session_process_ready/snapshot"));
    assert(harborPaths.includes("GET /runtime/evidence/evidence_process_snapshot"));
    assert(protectedAuthorization.length > 0);
    assert(protectedAuthorization.every((value) => value === `Bearer ${harborSupervisorToken}`));
    assert.equal(JSON.stringify([submit.body, result.body, evidence.body, session.body]).includes(harborSupervisorToken), false);
    const persistedRunRecords = await Promise.all((await readdir(runRecordDir)).map((file) => readFile(join(runRecordDir, file), "utf8")));
    assert.equal(persistedRunRecords.some((record) => record.includes(harborSupervisorToken)), false);
    assert.equal(output().includes(harborSupervisorToken), false);
  } catch (error) {
    console.error(output());
    throw error;
  } finally {
    await stopProcess(child);
    await closeServer(harbor);
    await rm(root, { recursive: true, force: true });
    await rm(runRecordDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await assertDegradedProcessSmoke();
  await assertConfiguredTaskProcessSmoke();
}

await main();
