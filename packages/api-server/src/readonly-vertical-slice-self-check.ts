import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { createLocalLodePackageResolver } from "@webenvoy/core-runtime";

type JsonResponse = {
  status: number;
  body: unknown;
};
type JsonObject = Record<string, unknown>;

const identityPrivateBoundary = ["password", "verification_code", "cookie_value", "storage_value", "session_token"];
const harborSupervisorToken = "runtime-process-supervisor-token";
const apiServerEntry = join(dirname(fileURLToPath(import.meta.url)), "index.js");

const xiaohongshuPackageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuLockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const xiaohongshuResourceRef = "xiaohongshu.search-notes.resources";
const pinnedCoreCommit = "a8325687abf01833a4b477f39f66cca4c9979ce1";
const pinnedHarborCommit = "bcfc1b902c3fb8c2fd691c805a2ada1ddae51181";
const pinnedLodeCommit = "6238d3f9de0cd09157c9769e27d90174c299406a";
const execFileAsync = promisify(execFile);

type PinnedLodeArtifact = {
  root: string;
  registryPath: string;
  source: "checkout" | "git-archive";
  cleanup?: () => Promise<void>;
};

type VerticalSliceMode =
  | "success"
  | "unavailable"
  | "failure"
  | "rollback"
  | "canonical-network"
  | "canonical-5xx"
  | "canonical-session-missing"
  | "canonical-malformed";

function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function gitOutput(root: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return typeof result.stdout === "string" ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function archivePinnedLode(repository: string): Promise<PinnedLodeArtifact | undefined> {
  try {
    const archive = await execFileAsync("git", ["-C", repository, "archive", "--format=tar", pinnedLodeCommit], {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024
    });
    const root = await mkdtemp(join(tmpdir(), "webenvoy-lode-pinned-"));
    const archivePath = join(root, "lode.tar");
    await writeFile(archivePath, archive.stdout as Buffer);
    await execFileAsync("tar", ["-xf", archivePath, "-C", root]);
    await rm(archivePath, { force: true });
    return {
      root,
      registryPath: join(root, "registry", "local-packages.json"),
      source: "git-archive",
      cleanup: () => rm(root, { recursive: true, force: true })
    };
  } catch {
    return undefined;
  }
}

async function resolvePinnedLodeArtifact(): Promise<PinnedLodeArtifact | undefined> {
  const configuredRoot = process.env.WEBENVOY_LODE_ROOT;
  const configuredRegistry = process.env.WEBENVOY_LODE_REGISTRY_PATH;
  const candidates = [
    ...(configuredRoot === undefined ? [] : [configuredRoot]),
    ...(configuredRegistry === undefined ? [] : [dirname(dirname(configuredRegistry))]),
    join(process.cwd(), "..", "Lode"),
    join(process.cwd(), "..", "Lode.worktrees", "lode-290-search-pin"),
    join(process.cwd(), "..", "..", "Lode"),
    join(process.cwd(), "..", "..", "Lode.worktrees", "lode-290-search-pin")
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const head = await gitOutput(candidate, ["rev-parse", "HEAD"]);
    if (head === pinnedLodeCommit && await gitOutput(candidate, ["status", "--porcelain"]) === "") {
      const registryPath = join(candidate, "registry", "local-packages.json");
      if (await gitOutput(candidate, ["cat-file", "-e", "HEAD:registry/local-packages.json"]) !== undefined) {
        return { root: candidate, registryPath, source: "checkout" };
      }
    }
    if (await gitOutput(candidate, ["cat-file", "-e", `${pinnedLodeCommit}^{commit}`]) !== undefined) {
      const archived = await archivePinnedLode(candidate);
      if (archived) return archived;
    }
  }
  return undefined;
}

function verticalRef(prefix: string, seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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

function spawnApiServer(port: number, runRecordDir: string, env: Record<string, string | undefined> = {}): { child: ChildProcess; output: () => string } {
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const child = spawn(process.execPath, [apiServerEntry], {
    env: { ...childEnv, PORT: String(port), WEBENVOY_RUN_RECORD_DIR: runRecordDir },
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

function xiaohongshuTaskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: intentId,
    entrypoint: "app",
    user_intent: { summary: "Read Xiaohongshu search results from an offline Harbor fixture." },
    capability: {
      ref: "lode:capability/search-notes",
      version: "0.1.0",
      source_ref: xiaohongshuPackageRef,
      lock_ref: xiaohongshuLockRef
    },
    input: {
      summary: "Read the current public search result summary.",
      refs: ["https://www.xiaohongshu.com/search_result/?keyword=coffee"]
    },
    scope: {
      target_type: "search_results_page",
      target_ref: "https://www.xiaohongshu.com/search_result/?keyword=coffee"
    },
    policy: {
      risk: "read",
      execution_intent: "read",
      timeout_ms: 5000
    },
    resource_requirement_refs: [xiaohongshuResourceRef],
    resource_requirement_profile_id: "search-notes-logged-in-ready-page",
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function verticalMode(runId: string): VerticalSliceMode {
  const match = /^(?:run|intent)_vertical_(success|unavailable|failure|rollback|canonical-network|canonical-5xx|canonical-session-missing|canonical-malformed)/.exec(runId);
  return (match?.[1] as VerticalSliceMode | undefined) ?? "success";
}

function createReadonlyVerticalHarborMock(paths: string[]): Server {
  let currentHolderRef = "";
  let released = false;
  return createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    const protectedRequest = request.method === "POST" && (
      request.url === "/runtime/identity-environment-sessions" ||
      /^\/runtime\/sessions\/[^/]+\/(?:release|snapshot|read-operations)$/.test(request.url ?? "")
    );
    if (protectedRequest && request.headers.authorization !== `Bearer ${harborSupervisorToken}`) {
      sendJson(response, 401, { status: "unavailable", failure_class: "supervisor_authorization_required", retryable: false });
      return;
    }
    void readRequestJson(request).then((body) => {
      const mode = verticalMode(currentHolderRef);
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
      if (request.method === "GET" && request.url === "/runtime/identity-environments/identity-env_vertical") {
        sendJson(response, 200, {
          schema_version: "harbor-local-identity-environment-store/v0",
          identity_environment_ref: "identity-env_vertical",
          execution_identity_ref: "identity-env_vertical:execution",
          profile_ref: "profile_vertical",
          site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
          status: {
            login_state: "logged_in",
            authentication_provenance: "user_confirmed_managed_session",
            manual_authentication_state: "completed",
            browser_storage_state: "present",
            recovery_required: false,
            blocking_reasons: [],
            repair_reasons: []
          },
          refs: { execution_identity_ref: "identity-env_vertical:execution", profile_ref: "profile_vertical" },
          environment_summary: { provider_id: "cloakbrowser" },
          consumer_boundary: {
            core: "admission_facts_refs_and_blocking_reasons_only",
            not_exposed: identityPrivateBoundary
          }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/identity-environment-sessions") {
        currentHolderRef = typeof body.holder_ref === "string" ? body.holder_ref : "";
        released = false;
        sendJson(response, 200, {
          identity_environment_facts: {
            schema_version: "harbor-local-identity-environment/v0",
            identity_environment_ref: "identity-env_vertical",
            execution_identity_ref: "identity-env_vertical:execution",
            profile_ref: "profile_vertical",
            site_binding: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
            login_state: { state: "logged_in", authentication_provenance: "user_confirmed_managed_session", manual_authentication_state: "completed", recovery_required: false },
            browser_storage: { state: "present" },
            provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "default_provider_available" },
            consumer_boundary: { core: "admission_facts_refs_and_blocking_reasons_only", not_exposed: identityPrivateBoundary }
          },
          runtime_facts: {
            runtime_session_ref: "session_vertical",
            identity_environment_ref: "identity-env_vertical",
            execution_identity_ref: "identity-env_vertical:execution",
            profile_ref: "profile_vertical",
            provider_ref: "harbor:provider/cloakbrowser",
            provider_mode: "local_dedicated_profile",
            lifecycle_state: "active",
            viewer_ref: "viewer_vertical",
            availability: { cdp: "available", viewer: "unsupported", snapshot: "available", evidence: "available" },
            control_owner: "core_task",
            control_lock: { owner: "core_task", state: "held", holder_ref: currentHolderRef },
            last_seen_at: "2026-08-03T00:00:00.000Z"
          }
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/sessions/session_vertical/runtime-facts") {
        if (mode === "rollback") {
          sendJson(response, 404, { status: "unavailable", failure_class: "runtime_facts_unsupported", retryable: false });
          return;
        }
        if (mode === "canonical-5xx") {
          sendJson(response, 503, { status: "unavailable", failure_class: "runtime_facts_unavailable", retryable: true });
          return;
        }
        if (mode === "canonical-session-missing") {
          sendJson(response, 404, { status: "unavailable", failure_class: "session_missing", retryable: false });
          return;
        }
        if (mode === "canonical-malformed") {
          sendJson(response, 200, { schema_version: "harbor-runtime-facts/v0", runtime_session_ref: "session_vertical" });
          return;
        }
        if (mode === "canonical-network") {
          response.destroy();
          return;
        }
        sendJson(response, 200, {
          schema_version: "harbor-core-runtime-facts/v0",
          runtime_session_ref: "session_vertical",
          identity_environment_ref: "identity-env_vertical",
          execution_identity_ref: "identity-env_vertical:execution",
          profile_ref: "profile_vertical",
          provider_ref: "harbor:provider/cloakbrowser",
          provider_mode: "local_dedicated_profile",
          lifecycle_state: "active",
          availability: { cdp: "available", viewer: "unsupported", snapshot: "available", evidence: "available" },
          viewer: { viewer_ref: "viewer_vertical", availability: "unsupported", access_mode: "none", expires_at: "2026-08-03T01:00:00.000Z" },
          control: { owner: "core_task", handoff_reason: null, takeover: { available: false, unavailable_reason: "viewer_unavailable" }, updated_at: "2026-08-03T00:00:00.000Z" },
          current_error: null,
          fact_refs: { session: "session_vertical", viewer: "viewer_vertical" },
          unavailable: null
        });
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/runtime/sessions/session_vertical/site-resource-facts?")) {
        const keys = [
          "runtime.execution_surface.available",
          "runtime.origin.www_xiaohongshu_com.available",
          "identity.user_logged_in.confirmed",
          "page.vue_app.ready",
          "page.pinia_store.ready",
          "source.refs.available",
          "evidence.snapshot_ref.available",
          "safety.challenge.absent"
        ];
        sendJson(response, 200, {
          schema_version: "harbor-site-resource-facts/v0",
          runtime_session_ref: "session_vertical",
          site_id: "xiaohongshu",
          task_kind: "search_notes",
          generated_at: "2026-08-03T00:00:00.000Z",
          resource_facts: keys.map((key) => ({ key, state: "available", evidence_ref: "evidence_vertical" })),
          evidence_refs: ["evidence_vertical"],
          public_boundary: { output: "public_runtime_facts_and_refs_only", raw_material: "not_exposed" }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/sessions/session_vertical/snapshot") {
        sendJson(response, 200, {
          harbor_scene_ref: {
            schema_version: "harbor-page-scene-refs/v0",
            runtime_session_ref: "session_vertical",
            snapshot_ref: "snapshot_vertical",
            refmap_ref: "refmap_vertical",
            source_trace_ref: "source_trace_vertical",
            evidence_refs: ["evidence_vertical"],
            captured_at: "2026-08-03T00:00:00.000Z",
            page_summary: {
              title: "Xiaohongshu search",
              url: "https://www.xiaohongshu.com/search_result/?keyword=coffee",
              summary: "Redacted public search result fixture."
            },
            unavailable: null
          }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/sessions/session_vertical/read-operations") {
        if (mode === "unavailable") {
          sendJson(response, 200, {
            schema_version: "harbor-allowlisted-read-operation/v0",
            status: "unavailable",
            runtime_session_ref: "session_vertical",
            site_id: "xiaohongshu",
            operation_id: "xhs_search_notes",
            failure_class: "resource_unavailable",
            retryable: true
          });
          return;
        }
        const detailRef = verticalRef("detail_ref", currentHolderRef);
        const sourceRefs = [
          { kind: "pinia_store_summary", ref: verticalRef("source", `${currentHolderRef}:pinia`) },
          { kind: "network_summary", ref: verticalRef("source", `${currentHolderRef}:network`) },
          { kind: "dom_snapshot_summary", ref: verticalRef("source", `${currentHolderRef}:dom`) }
        ];
        const evidenceRef = verticalRef("evidence", currentHolderRef);
        const postCheckRef = verticalRef("post_check", currentHolderRef);
        sendJson(response, 200, {
          schema_version: "harbor-allowlisted-read-operation/v0",
          status: "completed",
          operation_ref: verticalRef("read_operation", currentHolderRef),
          runtime_session_ref: "session_vertical",
          site_id: "xiaohongshu",
          operation_id: "xhs_search_notes",
          operation_mode: "read",
          observed_at: "2026-08-03T00:00:00.000Z",
          public_summary_ref: verticalRef("read_result", currentHolderRef),
          public_summary: {
            schema_version: "harbor-read-operation-public-summary/v1",
            operation_id: "xhs_search_notes",
            result_kind: "xiaohongshu_search_notes_surface",
            surface: "search_result",
            result_state: "operation_read_response_observed",
            response_status: 200,
            result_count: 1,
            detail_refs: [detailRef],
            items: [{
              detail_ref: detailRef,
              title: "城市咖啡公开笔记",
              author_display_name: "公开作者",
              interaction_metrics: { likes: "12", comments: "3", collects: "4" }
            }],
            source_signals: ["pinia_store", "xhs_search_read_network"],
            ...(mode === "failure" ? { token: "forbidden" } : {})
          },
          source_refs: sourceRefs,
          evidence_refs: [evidenceRef],
          evidence_ref_kinds: [{ kind: "snapshot_ref", ref: evidenceRef }, { kind: "post_check_ref", ref: postCheckRef }],
          post_check: { post_check_ref: postCheckRef, status: "passed", reason: "managed_provider_read_probe_completed" },
          public_boundary: {
            output: "public_summary_and_refs_only",
            raw_credentials: "not_exposed",
            raw_profile_storage: "not_exposed",
            raw_cdp_endpoint: "not_exposed",
            raw_dom: "not_exposed",
            raw_har: "not_exposed",
            raw_network_bodies: "not_exposed",
            screenshot_body: "not_exposed",
            external_write_actions: "not_performed"
          }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/runtime/sessions/session_vertical/release") {
        released = true;
        sendJson(response, 200, { status: "released", runtime_session_ref: "session_vertical", control_owner: "none", control_lock: { owner: "none", state: "released", holder_ref: null } });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/sessions/session_vertical") {
        sendJson(response, 200, {
          runtime_session_ref: "session_vertical",
          lifecycle_state: released ? "idle" : "active",
          control_owner: released ? "none" : "core_task",
          control_lock: released ? { owner: "none", state: "released", holder_ref: null } : { owner: "core_task", state: "held", holder_ref: currentHolderRef }
        });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/evidence/evidence_vertical") {
        sendJson(response, 200, { evidence_ref: "evidence_vertical", access_state: "available" });
        return;
      }
      sendJson(response, 404, { error: { category: "resource_admission", code: "mock_route_missing", phase: "runtime_binding", recovery_hint: "repair_mock" } });
    }).catch(() => sendJson(response, 500, { error: { category: "resource_admission", code: "mock_failure", phase: "runtime_binding", recovery_hint: "repair_mock" } }));
  });
}

function assertNoPrivateKeys(value: unknown): void {
  const privateKey = /^(?:password|verification_code|cookie|cookies|token|tokens|profile_storage|raw_dom|raw_har|screenshot_body|network_response_body|provider_key|local_path)$/i;
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      assert.equal(privateKey.test(key), false, `private Harbor field leaked: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

async function assertReadonlyVerticalSlice(): Promise<void> {
  const artifact = await resolvePinnedLodeArtifact();
  if (!artifact) {
    console.log(JSON.stringify({
      schema_version: "webenvoy.offline-readonly-vertical-slice-provenance.v0",
      state: "structured_unavailable",
      core_commit: pinnedCoreCommit,
      harbor_commit: pinnedHarborCommit,
      lode_commit: pinnedLodeCommit,
      recovery: "Set WEBENVOY_LODE_ROOT to a clean checkout or make the pinned commit available to git archive."
    }));
    return;
  }

  const resolvedRegistry = artifact.registryPath;
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-vertical-runs-"));
  const harborPaths: string[] = [];
  const harbor = createReadonlyVerticalHarborMock(harborPaths);
  const harborPort = await listen(harbor);
  const apiPort = await reservePort();
  const { child, output } = spawnApiServer(apiPort, runRecordDir, {
    WEBENVOY_LODE_REGISTRY_PATH: resolvedRegistry,
    WEBENVOY_HARBOR_RUNTIME_URL: `http://127.0.0.1:${harborPort}`,
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: harborSupervisorToken
  });
  const resolver = createLocalLodePackageResolver({ registryPath: resolvedRegistry });
  const resolved = await resolver({ package_ref: xiaohongshuPackageRef, task_intent: xiaohongshuTaskIntent("intent_vertical_resolve") });
  assert.equal("category" in resolved, false, JSON.stringify(resolved));
  if ("category" in resolved) throw new Error("Pinned Lode search package did not resolve.");
  assert.equal(resolved.package_ref, xiaohongshuPackageRef);
  assert.equal(resolved.lock_ref, xiaohongshuLockRef);
  assert.equal(resolved.runtime_consumption_declaration?.declaration_path, "registry/search-runtime-consumption.json");
  assert.equal(Object.keys(resolved.runtime_consumption_declaration?.asset_hashes ?? {}).sort().join(","), "failure_mapping,input_schema,manifest,output_schema,package_lock,post_check,resource_requirements,runtime_consumption_allowlist");

  const submit = async (runId: string): Promise<{ status: number; body: JsonObject; paths: string[] }> => {
    const start = harborPaths.length;
    const response = await postJson(apiPort, "/tasks", {
      run_id: runId,
      package_ref: xiaohongshuPackageRef,
      task_intent: xiaohongshuTaskIntent(`intent_${runId}`),
      public_query: { query: "coffee", limit: 1 },
      harbor: {
        identity_environment_ref: "identity-env_vertical",
        url: "https://www.xiaohongshu.com/search_result/?keyword=coffee"
      }
    });
    return { status: response.status, body: asRecord(response.body), paths: harborPaths.slice(start) };
  };

  try {
    assert.deepEqual(await waitForJson(apiPort, "/health", child), {
      status: 200,
      body: { service: "webenvoy-api-server", status: "ok" }
    });

    const success = await submit("run_vertical_success");
    assert.equal(success.status, 202, JSON.stringify(success.body));
    assert.equal(success.body.ok, true);
    const successRun = asRecord(success.body.run);
    assert.equal(successRun.status, "succeeded");
    assert.deepEqual(asRecord(successRun.admission).runtime_binding_refs, [
      "session_vertical",
      "profile_vertical",
      "harbor:provider/cloakbrowser",
      "viewer_vertical",
      "identity-env_vertical",
      "identity-env_vertical:execution",
      "snapshot_vertical",
      "refmap_vertical",
      "source_trace_vertical"
    ]);
    assert(success.paths.includes("GET /runtime/sessions/session_vertical/runtime-facts"));
    assert(success.paths.includes("POST /runtime/sessions/session_vertical/read-operations"));
    const successResult = await getJson(apiPort, "/runs/run_vertical_success/result");
    assert.equal(successResult.status, 200);
    assert.equal(asRecord(successResult.body).ok, true);
    const successFailure = await getJson(apiPort, "/runs/run_vertical_success/failure");
    assert.equal(successFailure.status, 200);
    assert.equal(asRecord(asRecord(successFailure.body).failure_reason).failure_present, false);

    const unavailable = await submit("run_vertical_unavailable");
    assert.equal(unavailable.body.ok, false);
    const unavailableRun = asRecord(unavailable.body.run);
    assert.equal(unavailableRun.status, "blocked");
    assert.equal(asRecord(unavailableRun.failure).code, "resource_unavailable");
    assert.equal(asRecord(unavailableRun.failure).category, "runtime_execution");
    const unavailableFailure = await getJson(apiPort, "/runs/run_vertical_unavailable/failure");
    assert.equal(unavailableFailure.status, 200);
    const unavailableReason = asRecord(asRecord(unavailableFailure.body).failure_reason);
    assert.equal(unavailableReason.failure_present, true);
    assert.equal(asRecord(unavailableReason.failure).attribution, "runtime");

    const failure = await submit("run_vertical_failure");
    assert.equal(failure.body.ok, false);
    const failureRun = asRecord(failure.body.run);
    assert.equal(failureRun.status, "failed");
    assert.equal(asRecord(failureRun.failure).code, "output_invalid");
    assert.equal(asRecord(failureRun.failure).category, "result_projection");
    assert.equal(asRecord(failureRun.failure).attribution, "capability");
    const failureReason = await getJson(apiPort, "/runs/run_vertical_failure/failure");
    assert.equal(failureReason.status, 200);
    assert.equal(asRecord(asRecord(asRecord(failureReason.body).failure_reason).failure).attribution, "capability");

    const rollback = await submit("run_vertical_rollback");
    assert.equal(rollback.status, 202, JSON.stringify(rollback.body));
    assert.equal(asRecord(rollback.body.run).status, "succeeded");
    assert(rollback.paths.includes("GET /runtime/sessions/session_vertical/runtime-facts"));
    assert(rollback.paths.includes("POST /runtime/sessions/session_vertical/read-operations"));

    for (const mode of ["canonical-network", "canonical-5xx", "canonical-session-missing", "canonical-malformed"] as const) {
      const guarded = await submit(`run_vertical_${mode}`);
      assert.equal(guarded.body.ok, false, mode);
      assert(guarded.paths.includes("GET /runtime/sessions/session_vertical/runtime-facts"), mode);
      assert.equal(guarded.paths.some((path) => path.includes("site-resource-facts")), false, mode);
      assert.equal(guarded.paths.some((path) => path.endsWith("/snapshot")), false, mode);
      assert.equal(guarded.paths.some((path) => path.endsWith("/read-operations")), false, mode);
    }

    const serialized = JSON.stringify([
      success.body,
      successResult.body,
      successFailure.body,
      unavailable.body,
      unavailableFailure.body,
      failure.body,
      failureReason.body,
      rollback.body
    ]);
    assert.equal(serialized.includes(harborSupervisorToken), false);
    assertNoPrivateKeys(JSON.parse(serialized));
    const persisted = await Promise.all((await readdir(runRecordDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(runRecordDir, entry.name), "utf8")));
    assert.equal(persisted.some((record) => record.includes(harborSupervisorToken)), false);
    assert.equal(persisted.some((record) => /forbidden|cookie-value|secret-token/i.test(record)), false);

    console.log(JSON.stringify({
      schema_version: "webenvoy.offline-readonly-vertical-slice-provenance.v0",
      state: "passed",
      core_commit: pinnedCoreCommit,
      harbor_commit: pinnedHarborCommit,
      lode_commit: pinnedLodeCommit,
      lode_source: artifact.source,
      artifacts: {
        registry: "registry/local-packages.json",
        package_ref: xiaohongshuPackageRef,
        declaration: "registry/search-runtime-consumption.json",
        asset_hashes: resolved.runtime_consumption_declaration?.asset_hashes,
        run_ids: ["run_vertical_success", "run_vertical_unavailable", "run_vertical_failure", "run_vertical_rollback"]
      },
      modes: ["success", "structured_unavailable", "failure_attribution", "bounded_rollback", "canonical_fail_closed"]
    }));
  } catch (error) {
    console.error(output());
    throw error;
  } finally {
    await stopProcess(child);
    await closeServer(harbor);
    await rm(runRecordDir, { recursive: true, force: true });
    await artifact.cleanup?.();
  }
}


export async function runReadonlyVerticalSlice(): Promise<void> {
  await assertReadonlyVerticalSlice();
}
