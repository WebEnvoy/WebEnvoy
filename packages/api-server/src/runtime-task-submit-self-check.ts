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
  return join(root, "registry", "local-packages.json");
}

function createHarborMock(ready: boolean, paths: string[], bodies: Array<{ path: string; body: JsonObject }> = []): Server {
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
    unavailable: null
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
          }
        });
        return;
      }
      if (request.method === "POST" && request.url === `/runtime/sessions/${sessionRef}/snapshot`) {
        sendJson(response, 200, { status: "captured", core_scene_ref: scene, evidence_refs: scene.evidence_refs });
        return;
      }
      if (request.method === "GET" && request.url === "/runtime/evidence/evidence_runtime_api_snapshot") {
        sendJson(response, 200, { evidence_ref: "evidence_runtime_api_snapshot", access_state: "available" });
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
  const offlineHarbor = createHarborMock(false, []);
  const badJsonHarbor = createBadJsonHarborMock();
  try {
    const registryPath = await writeLodeRegistry(root);
    const harborPort = await listen(harbor);
    const offlineHarborPort = await listen(offlineHarbor);
    const badJsonHarborPort = await listen(badJsonHarbor);
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
    const badJsonServer = createApiServer({
      runRecordStore: store,
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${badJsonHarborPort}` })
    });
    const raceDuplicateServer = createApiServer({
      runRecordStore: createDuplicateRunRaceStore(store),
      lodePackageResolver: createLocalLodePackageResolver({ registryPath }),
      harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: `http://127.0.0.1:${harborPort}` })
    });
    const port = await listen(server);
    const offlinePort = await listen(offlineServer);
    const badJsonPort = await listen(badJsonServer);
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
      assert.equal(run.status, "admitted");
      assert.equal(run.entrypoint_ref, "entrypoint:app");
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
      await close(offlineServer);
      await close(badJsonServer);
      await close(raceDuplicateServer);
    }
  } finally {
    await close(harbor);
    await close(offlineHarbor);
    await close(badJsonHarbor);
    await rm(root, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
  await assertLodeResolverStaysUnderRoot();
}
