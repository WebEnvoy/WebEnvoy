import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileManagedAccessStore, managedPageOperations, managedSkillOperations, managedTaskOperations } from "./managed-access.js";
import { createManagedTaskService } from "./managed-task.js";
import { ProgramPublicHttpError } from "./program-public-http.js";
import { createFileRunRecordStore, type FileRunRecordStore, type RunRecordStatus } from "./run-record-store.js";
import { completeRunWithFailure } from "./result-envelope.js";
import { createFileSkillLibraryService } from "./skill-library.js";

type Json = Record<string, any>;
type PinnedTask = {
  package: { package_ref: string; revision_ref: string; package_digest: string; task_ref: string };
  source_ref: string;
  origin: string;
  input_schema_ref: string;
  output_schema_ref: string;
  result_kind: string;
  expected: { canonical_url: string; title: string; summary_contains: string };
};
type ScriptTaskPin = {
  package: PinnedTask["package"];
  source_ref: string;
  origin: string;
  input_schema_ref: string;
  output_schema_ref: string;
  result_kind: string;
  script_path: string;
};
type Actor = { credential_hash: string; principal_id: string; connection_id: string; grant_id: string };
type SnapshotHandler = (request: Json, runId: string, timeoutMs?: number) => Promise<Json>;

test("program-side public read prepares without a browser service or Page target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-program-public-read-no-browser-"));
  const credentialHash = "d".repeat(64);
  const profile = "profile:program-public-read-test";
  const origin = "https://github.com";
  const packageRef = "lode://site-skill/github/opencli-trending-repos";
  const revisionRef = `${packageRef}@0.1.0#${"a".repeat(40)}`;
  const sourceRef = `lode://source/site-skill/github/opencli-trending-repos@0.1.0#${"a".repeat(40)}`;
  const source = Buffer.from("export async function run() {}\n");
  const scriptSha = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  const pin = { package_ref: packageRef, revision_ref: revisionRef, package_digest: `sha256:${"b".repeat(64)}`, task_ref: "read-trending" };
  const policy = {
    transport: "program_anonymous_https", origin, pathname: "/trending", allow_one_path_segment: true,
    query_keys: ["since"], headers: { accept: "text/html" }, content_types: ["text/html"],
    max_response_bytes: 1_048_576, max_redirects: 2, timeout_ms: 10_000
  };
  const dispatched = Promise.withResolvers<void>();
  let publicReadCalls = 0;
  const sitePackage = {
    ...pin, version: "0.1.0", source_repository: "WebEnvoy/Lode", package_path: "sites/github/opencli-trending-repos",
    source_ref: sourceRef, lock_ref: "lode://lock/site-skill/github/opencli-trending-repos@0.1.0", source_commit: "a".repeat(40),
    source_admission_ref: "webenvoy.site-task-source-admission/initial", code_admission_ref: "webenvoy.code-admission/site-skill-script/initial",
    task_ref: "read-trending",
    capability: { capability_ref: "lode://site-capability/github/opencli-trending-repos@0.1.0", capability_id: "opencli-trending-repos",
      version: "0.1.0", source_ref: sourceRef, lock_ref: "lode://lock/site-skill/github/opencli-trending-repos@0.1.0", operation_id: "network.public_read", action: "read" },
    script: { script_ref: "lode://script/site-skill/github/opencli-trending-repos/read@0.1.0", version: "0.1.0", sha256: scriptSha,
      runtime_kind: "webenvoy.site-skill-script-abi/v1", entrypoint: "run", broker: "webenvoy.site-skill-broker/v1.1",
      broker_capabilities: ["network.read", "output.write"], path: "scripts/read.mjs", source },
    task: { task_ref: "read-trending", operation_id: "network.public_read", action: "read",
      applicability: { origins: [origin], target_type: "public_http_origin" },
      inputs: { schema_ref: "lode://schema/opencli-trending-input@0.1.0", carrier: "webenvoy.managed-task-inline/v1", max_bytes: 1024 },
      outputs: { schema_ref: "lode://schema/opencli-trending-output@0.1.0", result_kind: "github_trending", completeness: "required" },
      verification: { post_check_ref: "lode://check/opencli-trending@0.1.0" },
      data_handling: { external_egress: "declared" }, network_read: policy },
    input_schema: { type: "object", properties: { limit: { anyOf: [
      { type: "integer", minimum: 1, maximum: 25 }, { type: "string", pattern: "^([1-9]|1[0-9]|2[0-5])$" }
    ], default: 25 } }, additionalProperties: false },
    output_schema: { type: "object", properties: {}, additionalProperties: true }, post_check: {},
    manifest_bytes: Buffer.from("{}"), skill_text: Buffer.from("skill"), files: []
  };
  try {
    const accessStore = createFileManagedAccessStore({ directory: join(directory, "access") });
    const runRecordStore = createFileRunRecordStore({ directory: join(directory, "runs") });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "public-read-principal", display_name: "public-read-agent", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const grant = await accessStore.createGrant({
      idempotency_key: "public-read-grant", principal_id: principal.principal_id,
      allowed_operations: [...managedTaskOperations], profile_refs: [profile], allowed_origins: [origin],
      expires_at: grantExpiry, creation_template: null, max_created_profiles: 0,
      skill_scope: { skill_refs: [packageRef], source_refs: [sourceRef, revisionRef] }
    });
    await accessStore.setProfilePolicy({ idempotency_key: "public-read-profile-policy", profile_ref: profile,
      allowed_operations: [...managedTaskOperations], allowed_origins: [origin] });
    const taskService = createManagedTaskService({
      accessStore, runRecordStore,
      skillLibraryService: { async resolveManagedSiteTask() { return sitePackage; } } as unknown as Parameters<typeof createManagedTaskService>[0]["skillLibraryService"],
      workerIdentity: { owner_uid: 501, agent_uid: 502, mode: "distinct_uid_hardened", owner_socket_acl: "verified" },
      async publicHttpReader(_policy, call, dependencies, signal) {
        publicReadCalls += 1;
        await dependencies?.beforeDispatch?.(new URL("https://github.com/trending"), {
          url_sha256: "a".repeat(64), pathname: "/trending", hop_index: 0
        });
        dispatched.resolve();
        if ((call as Json).url.includes("since=weekly"))
          throw new ProgramPublicHttpError("managed_task_network_content_type_denied", "dispatched", false);
        await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
        throw new ProgramPublicHttpError("managed_task_network_cancelled", "dispatched", true);
      }
      // No managedBrowserService: program-side reads must not need an Instance or Provider.
    });
    const submitRequest = {
      schema_version: "webenvoy.managed-task-operation/v1", operation: "task.submit", idempotency_key: "public-read-no-page-target",
      grant_id: grant.grant_id, connection_id: connection.connection_id,
      task_scope: { operations: ["task.submit"], skill_refs: [packageRef], source_refs: [revisionRef], profile_refs: [profile], origins: [origin] },
      package: pin, input: { schema_ref: "lode://schema/opencli-trending-input@0.1.0", carrier: "webenvoy.managed-task-inline/v1", value: { limit: 2 } },
      intent: { summary: "Read public GitHub Trending data.", policy: { risk: "read", execution_intent: "read", timeout_ms: 10_000 } }
      // Deliberately omit target; the pinned task supplies its exact public origin.
    };
    const submitted = await taskService.operate(credentialHash, submitRequest, { agentSocketIngressVerified: true }) as Json;
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    assert.equal(submitted.run.status, "running");
    const run = await runRecordStore.getRunRecord(submitted.run.run_id);
    assert.equal(run?.public_result_summary?.target_type, "public_http_origin");
    assert.equal(run?.public_result_summary?.target_ref, origin);
    assert.equal(Object.hasOwn(submitted.worker_execution.ticket, "target"), false);
    assert.equal(submitted.worker_execution.ticket.authorization.profile_ref, profile);
    const stringLimit = await taskService.operate(credentialHash, { ...submitRequest, idempotency_key: "public-read-string-limit",
      input: { ...submitRequest.input, value: { limit: "2" } } }, { agentSocketIngressVerified: true }) as Json;
    assert.equal(stringLimit.ok, true, JSON.stringify(stringLimit));
    await rejectsWithCode(taskService.operate(credentialHash, { ...submitRequest, idempotency_key: "public-read-out-of-range",
      input: { ...submitRequest.input, value: { limit: 26 } } }, { agentSocketIngressVerified: true }), ["managed_access_denied"]);
    const timeoutRequest = { ...submitRequest, idempotency_key: "public-read-inflight-timeout",
      intent: { ...submitRequest.intent, policy: { ...submitRequest.intent.policy, timeout_ms: 150 } } };
    const inFlight = await taskService.operate(credentialHash, timeoutRequest, { agentSocketIngressVerified: true }) as Json;
    const ticketId = inFlight.worker_execution.ticket.ticket_id;
    await taskService.workerStarted(credentialHash, { ticket_id: ticketId });
    const pendingRead = taskService.broker(credentialHash, { ticket_id: ticketId, method: "network.read",
      input: { url: "https://github.com/trending", method: "GET", headers: policy.headers } }).catch(() => undefined);
    await dispatched.promise;
    await delay(250);
    await pendingRead;
    const timedOut = await runRecordStore.getRunRecord(inFlight.run.run_id);
    assert.equal(timedOut?.status, "unknown_outcome", "dispatched HTTP with no response remains uncertain");
    assert.equal(timedOut.public_result_summary?.dispatch_state, "dispatched");
    assert.equal(timedOut.failure?.code, "managed_task_timeout");
    const retried = await taskService.operate(credentialHash, timeoutRequest, { agentSocketIngressVerified: true }) as Json;
    assert.equal(retried.run.run_id, inFlight.run.run_id);
    assert.equal(retried.run.status, "unknown_outcome");
    assert.equal(publicReadCalls, 1, "same key never replays a dispatched HTTP request");
    const knownReject = await taskService.operate(credentialHash, {
      ...submitRequest, idempotency_key: "public-read-known-rejection"
    }, { agentSocketIngressVerified: true }) as Json;
    const rejectedTicketId = knownReject.worker_execution.ticket.ticket_id;
    await taskService.workerStarted(credentialHash, { ticket_id: rejectedTicketId });
    await rejectsWithCode(taskService.broker(credentialHash, { ticket_id: rejectedTicketId, method: "network.read",
      input: { url: "https://github.com/trending?since=weekly", method: "GET", headers: policy.headers } }),
    ["managed_task_network_content_type_denied"]);
    const rejected = await taskService.workerFailure(credentialHash, {
      ticket_id: rejectedTicketId, code: "managed_task_network_content_type_denied"
    }) as Json;
    assert.equal(rejected.run.status, "failed", "a known HTTP rejection remains failed");
    assert.equal(rejected.run.dispatch_state, "dispatched");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const lodeRoot = process.env.WEBENVOY_LODE_ROOT;
const profileRef = "profile:managed-site-task-test";
const targetRef = "page_managed_site_task_test_001";
const grantExpiry = "2099-01-01T00:00:00.000Z";
const terminalStatuses = new Set<RunRecordStatus>([
  "succeeded", "failed", "blocked", "requires_user_action", "manual_recovery_required", "unknown_outcome", "cancelled", "expired"
]);

async function readPin(root: string): Promise<PinnedTask> {
  const registry = JSON.parse(await readFile(join(root, "registry/local-packages.json"), "utf8")) as Json;
  assert.equal(registry.schema_version, "lode.local-package-index.v0");
  const entries = registry.entries.filter((entry: Json) => entry.package_ref === "lode://site-skill/controlled-local/page-summary");
  assert.equal(entries.length, 1, "WEBENVOY_LODE_ROOT must contain the approved controlled-local package");
  const entry = entries[0] as Json;
  const manifest = JSON.parse(await readFile(join(root, entry.manifest_path), "utf8")) as Json;
  const taskLocator = manifest.tasks.find((task: Json) => task.task_ref === "read-page-summary") as Json;
  assert(taskLocator, "the pinned package must declare read-page-summary");
  const task = JSON.parse(await readFile(join(root, entry.package_path, taskLocator.path), "utf8")) as Json;
  const outputAsset = manifest.assets.find((asset: Json) => asset.role === "output_schema") as Json;
  const checkAsset = manifest.assets.find((asset: Json) => asset.role === "post_check") as Json;
  const outputSchema = JSON.parse(await readFile(join(root, entry.package_path, outputAsset.path), "utf8")) as Json;
  const check = JSON.parse(await readFile(join(root, entry.package_path, checkAsset.path), "utf8")) as Json;
  const expected = check.requirements[0].expected_normalized_fields as Json;
  assert.equal(task.inputs.carrier, "none");
  assert.equal(task.applicability.target_type, "web_page");
  assert.equal(outputSchema.$id, task.outputs.schema_ref);
  assert.equal(checkAsset.check_ref, task.verification.post_check_ref);
  return {
    package: {
      package_ref: entry.package_ref,
      revision_ref: entry.revision_ref,
      package_digest: entry.package_digest,
      task_ref: task.task_ref
    },
    source_ref: manifest.source.source_ref,
    origin: task.applicability.origins[0],
    input_schema_ref: task.inputs.schema_ref,
    output_schema_ref: task.outputs.schema_ref,
    result_kind: task.outputs.result_kind,
    expected: {
      canonical_url: expected.canonical_url,
      title: expected.title,
      summary_contains: expected.summary.contains
    }
  };
}

async function readScriptTaskPin(root: string, packageRef: string): Promise<ScriptTaskPin> {
  const registry = JSON.parse(await readFile(join(root, "registry/local-packages.json"), "utf8")) as Json;
  const entries = registry.entries.filter((entry: Json) => entry.package_ref === packageRef);
  assert.equal(entries.length, 1, `WEBENVOY_LODE_ROOT must contain ${packageRef}`);
  const entry = entries[0] as Json;
  const manifest = JSON.parse(await readFile(join(root, entry.manifest_path), "utf8")) as Json;
  const taskLocator = manifest.tasks.find((task: Json) => task.task_ref === "read-daily-trending-top5") as Json;
  const task = JSON.parse(await readFile(join(root, entry.package_path, taskLocator.path), "utf8")) as Json;
  const script = manifest.scripts.find((item: Json) => item.script_ref === task.entrypoint.script_ref) as Json;
  assert(script, "the pinned package must declare its script entrypoint");
  assert.equal(task.inputs.carrier, "none");
  assert.equal(task.applicability.target_type, "web_page");
  return {
    package: { package_ref: entry.package_ref, revision_ref: entry.revision_ref, package_digest: entry.package_digest, task_ref: task.task_ref },
    source_ref: manifest.source.source_ref,
    origin: task.applicability.origins[0],
    input_schema_ref: task.inputs.schema_ref,
    output_schema_ref: task.outputs.schema_ref,
    result_kind: task.outputs.result_kind,
    script_path: join(root, entry.package_path, script.path)
  };
}

function taskScope(pin: PinnedTask, operation: string, profile = profileRef, origin = pin.origin): Json {
  return {
    operations: [operation],
    skill_refs: [pin.package.package_ref],
    source_refs: [pin.package.revision_ref],
    profile_refs: [profile],
    origins: [origin]
  };
}

function submitRequest(pin: PinnedTask, actor: Actor, key: string, timeoutMs?: number): Json {
  return {
    schema_version: "webenvoy.managed-task-operation/v1",
    operation: "task.submit",
    idempotency_key: key,
    grant_id: actor.grant_id,
    connection_id: actor.connection_id,
    task_scope: taskScope(pin, "task.submit"),
    package: { ...pin.package },
    target: { target_type: "web_page", target_ref: targetRef },
    input: { schema_ref: pin.input_schema_ref, carrier: "none" },
    intent: {
      summary: "Read the current controlled local catalog summary.",
      policy: { risk: "read", execution_intent: "read", ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }) }
    }
  };
}

function queryRequest(pin: PinnedTask, actor: Actor, selector: Json, profile = profileRef): Json {
  return {
    schema_version: "webenvoy.managed-task-operation/v1",
    operation: "task.query",
    grant_id: actor.grant_id,
    connection_id: actor.connection_id,
    task_scope: taskScope(pin, "task.query", profile),
    selector
  };
}

function stopRequest(pin: PinnedTask, actor: Actor, runId: string, key: string): Json {
  return {
    schema_version: "webenvoy.managed-task-operation/v1",
    operation: "task.stop",
    idempotency_key: key,
    grant_id: actor.grant_id,
    connection_id: actor.connection_id,
    task_scope: taskScope(pin, "task.stop"),
    selector: { run_id: runId }
  };
}

function response(value: unknown): Json {
  assert(value && typeof value === "object" && !Array.isArray(value), "managed-task response must be an object");
  const body = value as Json;
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.equal(body.schema_version, "webenvoy.managed-task-operation-result/v1");
  return body;
}

function guardTerminalWrites(store: FileRunRecordStore): FileRunRecordStore {
  const terminalRuns = new Set<string>();
  return {
    ...store,
    async updateRunRecord(runId, patch) {
      if (terminalRuns.has(runId)) throw new Error("managed_task_terminal_second_write");
      const updated = await store.updateRunRecord(runId, patch);
      if (terminalStatuses.has(updated.status)) terminalRuns.add(runId);
      return updated;
    }
  };
}

function snapshotReceipt(pin: PinnedTask, pageRef: string, runId: string, options: { omitText?: boolean; truncated?: boolean; pageRefMismatch?: boolean } = {}): Json {
  const summary = `${pin.expected.title} ${pin.expected.summary_contains}`;
  const snapshot: Json = {
    schema_version: "harbor-observation-targets/v1",
    page_ref: pageRef,
    observation_ref: `observation:page:1:2:${runId}`,
    captured_at: "2026-09-24T00:00:00.000Z",
    controls: [],
    ...(options.omitText ? {} : { text: summary }),
    truncated: options.truncated ?? false,
    coverage: {
      scope: "main_document_light_dom",
      excluded: ["child_frames", "shadow_roots", "virtualized_not_in_dom"],
      controls: { enumeration_complete: true, captured_count: 0, total: 0, returned_through: 0, complete: true, reason_codes: [] },
      text: { state: "complete", returned_bytes: Buffer.byteLength(summary, "utf8") },
      semantics: { complete: true, reason_codes: [] }
    },
    continuation: { offset: 0, returned_count: 0, has_more: false, next_cursor: null },
    page_id: "page_object_managed_task_test",
    document_generation: 2
  };
  return {
    status: "completed",
    dispatch_state: "not_dispatched",
    page: {
      page_ref: options.pageRefMismatch ? "page_mismatched_observation" : pageRef,
      current_url: pin.expected.canonical_url,
      title: pin.expected.title,
      status: "ready",
      origin: pin.origin,
      document_generation: 2,
      facts: [],
      requested_url: pin.expected.canonical_url,
      error_reason: null,
      observed_at: "2026-09-24T00:00:00.000Z",
      page_id: "page_object_managed_task_test"
    },
    snapshot
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

async function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitUntil(predicate: () => boolean, ms: number, message: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(5);
  }
}

async function rejectsWithCode(promise: Promise<unknown>, expectedCodes: string[]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : String(error);
    assert(expectedCodes.includes(code), `expected one of ${expectedCodes.join(", ")}, received ${code}`);
    return true;
  });
}

async function managedTaskRunCount(store: FileRunRecordStore): Promise<number> {
  return (await store.listRunRecords()).filter(run => run.public_result_summary?.task_kind === "managed_site_task").length;
}

test("managed site task runs the pinned package through one durable Core Run", {
  skip: lodeRoot ? false : "WEBENVOY_LODE_ROOT is not configured; no pinned Lode package source is available",
  timeout: 30_000
}, async t => {
  if (!lodeRoot) return;
  const root = resolve(lodeRoot);
  const pin = await readPin(root);
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-managed-task-test-"));
  const accessDirectory = join(directory, "access");
  const runDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");
  const credentialHash = "a".repeat(64);
  let snapshotHandler: SnapshotHandler = async (request, runId) => snapshotReceipt(pin, request.page_ref, runId);
  const snapshotCalls: Array<{ credentialHash: string; request: Json; runId: string; timeoutMs?: number }> = [];

  const accessStore = createFileManagedAccessStore({ directory: accessDirectory });
  const runRecordStore = createFileRunRecordStore({ directory: runDirectory });
  const skillLibraryService = createFileSkillLibraryService({ directory: libraryDirectory, lodeAssetsPath: root, accessStore, runRecordStore });
  const managedBrowserService = {
    async executeTaskSnapshot(receivedCredentialHash: string, value: unknown, runId: string, timeoutMs?: number): Promise<Json> {
      const request = value as Json;
      snapshotCalls.push({ credentialHash: receivedCredentialHash, request, runId, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      assert.equal(request.operation, "instance.snapshot");
      assert.equal(request.idempotency_key, runId, "Harbor snapshot must be attributed to the managed task Run");
      return snapshotHandler(request, runId, timeoutMs);
    }
  };
  const guardedRunStore = guardTerminalWrites(runRecordStore);
  let managedTaskService = createManagedTaskService({ accessStore, runRecordStore: guardedRunStore, skillLibraryService, managedBrowserService });
  let completedTask: { runId: string; key: string; response: Json } | undefined;

  async function makeGrant(principalId: string, id: string, profile = profileRef, overrides: { allowed_operations?: string[]; allowed_origins?: string[]; skill_scope?: { skill_refs: string[]; source_refs: string[] } } = {}) {
    return accessStore.createGrant({
      idempotency_key: `${id}-grant`, principal_id: principalId,
      profile_refs: [profile], allowed_operations: overrides.allowed_operations ?? [...managedSkillOperations, ...managedTaskOperations],
      allowed_origins: overrides.allowed_origins ?? [pin.origin], expires_at: grantExpiry, creation_template: null, max_created_profiles: 0,
      skill_scope: overrides.skill_scope ?? { skill_refs: [pin.package.package_ref], source_refs: [pin.source_ref, pin.package.revision_ref] }
    });
  }

  async function makeActor(name: string, credential: string, id: string, profile = profileRef): Promise<Actor> {
    const principal = await accessStore.registerPrincipal({ idempotency_key: `${id}-principal`, display_name: name, credential_hash: credential });
    const connection = await accessStore.connect(credential);
    const grant = await makeGrant(principal.principal_id, id, profile);
    return { credential_hash: credential, principal_id: principal.principal_id, connection_id: connection.connection_id, grant_id: grant.grant_id };
  }

  try {
    await accessStore.setProfilePolicy({
      idempotency_key: "managed-task-test-profile-policy", profile_ref: profileRef,
      allowed_operations: [...managedTaskOperations], allowed_origins: [pin.origin]
    });
    const actor = await makeActor("managed-task-test-agent", credentialHash, "managed-task-test");
    const skillScope = { operations: [...managedSkillOperations], skill_refs: [pin.package.package_ref], source_refs: [pin.source_ref, pin.package.revision_ref] };
    const installed = await skillLibraryService.submit(credentialHash, {
      idempotency_key: "managed-task-test-install", connection_id: actor.connection_id, grant_id: actor.grant_id,
      operation: "skill.install", skill_ref: pin.package.package_ref, task_scope: skillScope,
      revision_ref: pin.package.revision_ref, source_ref: pin.source_ref
    });
    assert.equal((installed as Json).ok, true, JSON.stringify(installed));
    assert.equal((installed as Json).result.skill.enabled, false);
    const enabled = await skillLibraryService.submit(credentialHash, {
      idempotency_key: "managed-task-test-enable", connection_id: actor.connection_id, grant_id: actor.grant_id,
      operation: "skill.enable", skill_ref: pin.package.package_ref, task_scope: skillScope,
      target_revision_ref: pin.package.revision_ref, source_ref: pin.source_ref, expected_record_version: 1
    });
    assert.equal((enabled as Json).ok, true, JSON.stringify(enabled));
    assert.equal((enabled as Json).result.skill.enabled, true);

    await t.test("task-declared AccountSystem is resolved before dispatch and pinned to the Run", async () => {
      const templateRef = "lode://account-system/github@1.0.0";
      const baseResolve = skillLibraryService.resolveManagedSiteTask.bind(skillLibraryService);
      const accountBoundLibrary = {
        ...skillLibraryService,
        async resolveManagedSiteTask(request: Parameters<typeof skillLibraryService.resolveManagedSiteTask>[0]) {
          const verified = await baseResolve(request);
          const task = verified.task as Json;
          return { ...verified, task: { ...task, applicability: { ...task.applicability, account_system_ref: templateRef } } };
        }
      };
      const before = await managedTaskRunCount(runRecordStore);
      const missingService = createManagedTaskService({ accessStore, runRecordStore, skillLibraryService: accountBoundLibrary, managedBrowserService });
      await assert.rejects(missingService.operate(credentialHash, submitRequest(pin, actor, "managed-task-account-system-missing")), /account_system_definition_unavailable/);
      assert.equal(await managedTaskRunCount(runRecordStore), before, "a declared local definition must resolve before the first durable Run write");

      const disabledService = createManagedTaskService({ accessStore, runRecordStore, skillLibraryService: accountBoundLibrary, managedBrowserService,
        accountSystemDefinitionService: { async resolveTemplate() { throw new Error("account_system_definition_disabled"); } } });
      await assert.rejects(disabledService.operate(credentialHash, submitRequest(pin, actor, "managed-task-account-system-disabled")), /account_system_definition_disabled/);
      assert.equal(await managedTaskRunCount(runRecordStore), before, "disabled definitions must fail before Run creation and Harbor dispatch");

      const localDefinition = {
        local_definition_ref: "webenvoy:account-system/00000000-0000-4000-8000-000000000001",
        revision_ref: "webenvoy:account-system-revision/00000000-0000-4000-8000-000000000001@1#sha256:" + "a".repeat(64),
        template_ref: templateRef,
        template_sha256: "sha256:8b022fc329a6f75887e465ab561c83ba74d2ab2af1ef0e51a41f3d06b1b4c777",
        historical: false
      };
      const accountAwareService = createManagedTaskService({ accessStore, runRecordStore, skillLibraryService: accountBoundLibrary, managedBrowserService,
        accountSystemDefinitionService: { async resolveTemplate(receivedRef) {
          assert.equal(receivedRef, templateRef);
          return localDefinition;
        } } });
      const submitted = response(await accountAwareService.operate(credentialHash,
        submitRequest(pin, actor, "managed-task-account-system-pinned")));
      assert.equal(submitted.run.status, "succeeded");
      const record = await runRecordStore.getRunRecord(submitted.run.run_id);
      assert(record);
      assert.deepEqual(record.public_result_summary?.account_system, {
        template_ref: templateRef,
        local_definition_ref: localDefinition.local_definition_ref,
        local_revision_ref: localDefinition.revision_ref,
        template_sha256: localDefinition.template_sha256
      });
      assert.equal(snapshotCalls.at(-1)?.runId, submitted.run.run_id, "the Run pins AccountSystem before its Harbor execution begins");
    });

    await t.test("pinned package output and original-key query survive service/store restart", { timeout: 10_000 }, async () => {
      snapshotHandler = async (request, runId) => snapshotReceipt(pin, request.page_ref, runId);
      const key = "managed-task-success-001";
      const submitted = response(await managedTaskService.operate(credentialHash, submitRequest(pin, actor, key)));
      completedTask = { runId: submitted.run.run_id, key, response: submitted };
      assert.equal(submitted.operation, "task.submit");
      assert.equal(submitted.run.status, "succeeded");
      assert.equal(submitted.run.package_ref, pin.package.package_ref);
      assert.equal(submitted.run.dispatch_state, "not_dispatched", "page snapshots are read-only and are not external dispatches");
      assert.equal(submitted.input.schema_ref, pin.input_schema_ref);
      assert.equal(submitted.input.carrier, "none");
      assert.equal(submitted.input.value_present, false);
      assert.equal(Object.hasOwn(submitted.input, "value"), false);
      assert.equal(submitted.result.schema_version, "webenvoy.result-envelope.v0");
      assert.equal(submitted.result.ok, true);
      assert.equal(submitted.result.data.result_kind, pin.result_kind);
      assert.deepEqual(submitted.result.data.normalized, {
        canonical_url: pin.expected.canonical_url,
        title: pin.expected.title,
        summary: `${pin.expected.title} ${pin.expected.summary_contains}`
      });
      assert.equal(submitted.result.post_check.status, "passed", "Core evaluates the verified package's pinned post-check");
      assert.deepEqual(submitted.result.evidence_refs, [`observation:page:1:2:${submitted.run.run_id}`]);

      const record = await runRecordStore.getRunRecord(submitted.run.run_id);
      assert(record);
      assert.equal(record.status, "succeeded");
      assert.equal(record.task_intent_ref, (record.public_result_summary?.task_intent as Json).intent_id,
        "the single Run must retain the exact persisted Task Intent ref");
      assert.equal(record.public_result_summary?.dispatch_state, "not_dispatched");
      assert.deepEqual(record.public_result_summary?.result, submitted.result,
        "terminal status and complete result must persist in the same Run-store write");

      const callCount = snapshotCalls.length;
      const reopenedAccessStore = createFileManagedAccessStore({ directory: accessDirectory });
      const reopenedRunStore = createFileRunRecordStore({ directory: runDirectory });
      const reopenedLibrary = createFileSkillLibraryService({ directory: libraryDirectory, lodeAssetsPath: root, accessStore: reopenedAccessStore, runRecordStore: reopenedRunStore });
      managedTaskService = createManagedTaskService({
        accessStore: reopenedAccessStore, runRecordStore: guardTerminalWrites(reopenedRunStore),
        skillLibraryService: reopenedLibrary, managedBrowserService
      });
      const reconnected = await reopenedAccessStore.connect(credentialHash);
      const reconnectedActor = { ...actor, connection_id: reconnected.connection_id };
      const queried = response(await managedTaskService.operate(credentialHash, queryRequest(pin, reconnectedActor, { original_idempotency_key: key })));
      assert.equal(queried.operation, "task.query");
      assert.equal(queried.run.run_id, submitted.run.run_id);
      assert.equal(queried.run.status, "succeeded");
      assert.deepEqual(queried.result, submitted.result, "query returns the full persisted result envelope");
      assert.equal(snapshotCalls.length, callCount, "query after restart must not dispatch another snapshot or Run");
      const replayed = response(await managedTaskService.operate(credentialHash, submitRequest(pin, reconnectedActor, key)));
      assert.equal(replayed.run.run_id, submitted.run.run_id);
      assert.deepEqual(replayed.result, submitted.result, "same submit key returns its original result without replay");
      assert.equal(snapshotCalls.length, callCount, "submit replay must not execute another snapshot");
    });

    await t.test("query is non-enumerable across principals and narrower current scopes; bad requests never dispatch", { timeout: 10_000 }, async () => {
      assert(completedTask, "the positive scenario must create a completed task");
      const callsBefore = snapshotCalls.length;
      const stranger = await makeActor("managed-task-stranger", "b".repeat(64), "managed-task-stranger");
      await rejectsWithCode(managedTaskService.operate(stranger.credential_hash, queryRequest(pin, stranger, { original_idempotency_key: completedTask.key })), ["managed_task_operation_unavailable"]);
      await rejectsWithCode(managedTaskService.operate(credentialHash, queryRequest(pin, actor, { original_idempotency_key: "unknown-managed-task-key" })), ["managed_task_operation_unavailable"]);

      const narrow = await makeGrant(actor.principal_id, "managed-task-narrow", profileRef, {
        allowed_operations: ["task.query", "task.stop"],
        skill_scope: { skill_refs: [pin.package.package_ref], source_refs: ["lode://site-skill/controlled-local/page-summary@1.0.0#other"] }
      });
      const narrowActor = { ...actor, grant_id: narrow.grant_id };
      await rejectsWithCode(managedTaskService.operate(credentialHash, queryRequest(pin, narrowActor, { run_id: completedTask.runId })), ["managed_task_operation_unavailable"]);

      const wrongVersion = submitRequest(pin, actor, "managed-task-wrong-version");
      wrongVersion.schema_version = "webenvoy.managed-task-operation/v999";
      await rejectsWithCode(managedTaskService.operate(credentialHash, wrongVersion), ["managed_task_version_unsupported"]);
      const wrongPin = submitRequest(pin, actor, "managed-task-wrong-pin");
      wrongPin.package.package_digest = `sha256:${"0".repeat(64)}`;
      const runsBeforeWrongPin = await managedTaskRunCount(runRecordStore);
      await rejectsWithCode(managedTaskService.operate(credentialHash, wrongPin), ["managed_access_denied"]);
      assert.equal(await managedTaskRunCount(runRecordStore), runsBeforeWrongPin, "a conflicting installed package digest is denied before a durable Run");
      assert.equal(snapshotCalls.length, callsBefore, "a conflicting installed package digest never reaches Harbor");

      // Owner-local overlays use the same installed site-skill revision record;
      // exercise that row shape without turning this test into an admission test.
      const libraryStatePath = join(libraryDirectory, "skill-library.json");
      const originalLibraryState = await readFile(libraryStatePath);
      try {
        const libraryState = JSON.parse(originalLibraryState.toString("utf8")) as Json;
        const installedAsset = libraryState.assets.find((item: Json) => item.skill_ref === pin.package.package_ref) as Json;
        const localSourceCommit = "e".repeat(40);
        const localRevisionRef = `${pin.package.package_ref}@1.0.1#${localSourceCommit}`;
        const localSourceRef = `lode://source/site-skill/controlled-local/page-summary@1.0.1#${localSourceCommit}`;
        const localDigest = `sha256:${"1".repeat(64)}`;
        installedAsset.revisions.push({
          ...installedAsset.revisions[0], revision_ref: localRevisionRef, source_ref: localSourceRef,
          source_commit: localSourceCommit, version: "1.0.1", package_digest: localDigest
        });
        installedAsset.enabled_revision_ref = localRevisionRef;
        installedAsset.record_version += 1;
        await writeFile(libraryStatePath, JSON.stringify(libraryState));

        const localGrant = await makeGrant(actor.principal_id, "managed-task-local-overlay", profileRef, {
          skill_scope: { skill_refs: [pin.package.package_ref], source_refs: [localRevisionRef] }
        });
        const localActor = { ...actor, grant_id: localGrant.grant_id };
        const localPin = { ...pin, package: { ...pin.package, revision_ref: localRevisionRef, package_digest: localDigest } };
        const conflictingOverlayRequest = submitRequest(localPin, localActor, "managed-task-local-overlay-wrong-pin");
        conflictingOverlayRequest.package.package_digest = `sha256:${"0".repeat(64)}`;
        await rejectsWithCode(managedTaskService.operate(credentialHash, conflictingOverlayRequest), ["managed_access_denied"]);
        assert.equal(await managedTaskRunCount(runRecordStore), runsBeforeWrongPin, "a conflicting owner-local digest creates no Run");
        assert.equal(snapshotCalls.length, callsBefore, "a conflicting owner-local digest never reaches Harbor");
      } finally {
        await writeFile(libraryStatePath, originalLibraryState);
      }

      const missingRevision = pin.package.revision_ref.replace(/[a-f0-9]{40}$/, "0".repeat(40));
      const missingRevisionPin = { ...pin, package: { ...pin.package, revision_ref: missingRevision } };
      const missingRevisionGrant = await makeGrant(actor.principal_id, "managed-task-missing-revision", profileRef, {
        skill_scope: { skill_refs: [pin.package.package_ref], source_refs: [missingRevision] }
      });
      const missingRevisionActor = { ...actor, grant_id: missingRevisionGrant.grant_id };
      const missingRevisionRequest = submitRequest(missingRevisionPin, missingRevisionActor, "managed-task-missing-revision");
      await rejectsWithCode(managedTaskService.operate(credentialHash, missingRevisionRequest), ["managed_skill_revision_unavailable"]);
      assert.equal(await managedTaskRunCount(runRecordStore), runsBeforeWrongPin, "an unavailable revision is rejected before a durable Run");
      assert.equal(snapshotCalls.length, callsBefore, "an unavailable revision never reaches Harbor");
      const injectedInput = submitRequest(pin, actor, "managed-task-extra-input");
      injectedInput.input.value = { arbitrary: true };
      await rejectsWithCode(managedTaskService.operate(credentialHash, injectedInput), ["managed_task_invalid_input"]);
      const injectedConnection = submitRequest(pin, actor, "managed-task-connection-injection");
      injectedConnection.unexpected = "not part of S2";
      await rejectsWithCode(managedTaskService.operate(credentialHash, injectedConnection), ["managed_task_invalid_input"]);
      const bothSelector = queryRequest(pin, actor, { run_id: completedTask.runId, original_idempotency_key: completedTask.key });
      await rejectsWithCode(managedTaskService.operate(credentialHash, bothSelector), ["managed_task_invalid_input"]);
      const revoked = await accessStore.revokeGrant({ idempotency_key: "managed-task-revoke-query", grant_id: actor.grant_id });
      assert.equal(revoked.revoked_at !== null, true);
      await rejectsWithCode(managedTaskService.operate(credentialHash, queryRequest(pin, actor, { run_id: completedTask.runId })), ["managed_access_grant_unavailable", "managed_task_operation_unavailable"]);
      assert.equal(snapshotCalls.length, callsBefore, "query and invalid admission cases must not reach Harbor");

      for (const [label, options] of [
        ["missing page text", { omitText: true }],
        ["truncated snapshot", { truncated: true }],
        ["mismatched page identity", { pageRefMismatch: true }]
      ] as const) {
        const grant = await makeGrant(actor.principal_id, `managed-task-incomplete-${label.replaceAll(" ", "-")}`);
        snapshotHandler = async (request, runId) => snapshotReceipt(pin, request.page_ref, runId, options);
        const before = snapshotCalls.length;
        const result = response(await managedTaskService.operate(credentialHash, submitRequest(pin, { ...actor, grant_id: grant.grant_id }, `managed-task-incomplete-${label.replaceAll(" ", "-")}`)));
        assert.equal(result.run.status, "failed", `${label} must not be reported as successful`);
        assert.equal(result.run.dispatch_state, "not_dispatched");
        assert.equal(result.failure.code, "site_task_snapshot_incomplete");
        assert.equal(snapshotCalls.length, before + 1);
      }
      snapshotHandler = async (request, runId) => snapshotReceipt(pin, request.page_ref, runId);
    });

    await t.test("stop keys are unique and late snapshots cannot revive a cancelled Run", { timeout: 20_000 }, async () => {
      const grant = await makeGrant(actor.principal_id, "managed-task-stop-grant");
      const executor = { ...actor, grant_id: grant.grant_id };
      const waiting = new Map<string, ReturnType<typeof deferred<Json>>>();
      snapshotHandler = async (_request, runId) => {
        const result = deferred<Json>();
        waiting.set(runId, result);
        return result.promise;
      };
      const pending: Array<{ runId: string; promise: Promise<unknown> }> = [];
      const beforeCount = await managedTaskRunCount(runRecordStore);
      const releaseAll = () => {
        for (const [runId, result] of waiting) result.resolve(snapshotReceipt(pin, targetRef, runId));
      };
      try {
        const firstKey = "managed-task-stop-submit-001";
        const firstCallCount = snapshotCalls.length;
        const firstSubmit = managedTaskService.operate(credentialHash, submitRequest(pin, executor, firstKey));
        await waitUntil(() => snapshotCalls.length === firstCallCount + 1, 2_000, "first controlled snapshot did not start");
        const firstRunId = snapshotCalls.at(-1)!.runId;
        pending.push({ runId: firstRunId, promise: firstSubmit });
        await waitUntil(() => waiting.has(firstRunId), 2_000, "first snapshot was not held by the deferred handler");
        const firstRunning = response(await managedTaskService.operate(credentialHash, queryRequest(pin, executor, { run_id: firstRunId })));
        assert.equal(firstRunning.run.status, "running");

        await rejectsWithCode(managedTaskService.operate(credentialHash, stopRequest(pin, executor, firstRunId, firstKey)), ["managed_access_idempotency_conflict"]);
        const stillRunning = response(await managedTaskService.operate(credentialHash, queryRequest(pin, executor, { run_id: firstRunId })));
        assert.equal(stillRunning.run.status, "running", "a stop request cannot reuse the submit key");

        const firstStopKey = "managed-task-stop-key-001";
        const stopped = response(await managedTaskService.operate(credentialHash, stopRequest(pin, executor, firstRunId, firstStopKey)));
        assert.equal(stopped.run.status, "cancelled");
        const firstTerminal = await runRecordStore.getRunRecord(firstRunId);
        assert(firstTerminal);
        assert.equal(firstTerminal.status, "cancelled");
        assert.equal(await managedTaskRunCount(runRecordStore), beforeCount + 1, "task.stop cancels the original Run instead of creating a second Run");

        await rejectsWithCode(managedTaskService.operate(credentialHash, submitRequest(pin, executor, firstStopKey)), ["managed_access_idempotency_conflict"]);
        assert.equal(snapshotCalls.length, firstCallCount + 1, "a stop key cannot be reused as a new submit key");

        const secondKey = "managed-task-stop-submit-002";
        const secondCallCount = snapshotCalls.length;
        const secondSubmit = managedTaskService.operate(credentialHash, submitRequest(pin, executor, secondKey));
        await waitUntil(() => snapshotCalls.length === secondCallCount + 1, 2_000, "second controlled snapshot did not start");
        const secondRunId = snapshotCalls.at(-1)!.runId;
        pending.push({ runId: secondRunId, promise: secondSubmit });
        await waitUntil(() => waiting.has(secondRunId), 2_000, "second snapshot was not held by the deferred handler");
        await rejectsWithCode(managedTaskService.operate(credentialHash, stopRequest(pin, executor, secondRunId, firstStopKey)), ["managed_access_idempotency_conflict"]);
        const secondStopKey = "managed-task-stop-key-002";
        const secondStopped = response(await managedTaskService.operate(credentialHash, stopRequest(pin, executor, secondRunId, secondStopKey)));
        assert.equal(secondStopped.run.status, "cancelled");
        assert.equal(await managedTaskRunCount(runRecordStore), beforeCount + 2, "a stop key cannot be reused against another Run");

        for (const item of pending) waiting.get(item.runId)!.resolve(snapshotReceipt(pin, targetRef, item.runId));
        for (const item of pending) await within(item.promise, 2_000, "cancelled submit did not settle after its late snapshot was released");
        await delay(20);
        assert.deepEqual(await runRecordStore.getRunRecord(firstRunId), firstTerminal, "late snapshot must not overwrite cancellation facts");
        const secondTerminal = await runRecordStore.getRunRecord(secondRunId);
        assert(secondTerminal);
        assert.equal(secondTerminal.status, "cancelled");
        assert.equal(secondTerminal.public_result_summary?.dispatch_state, "not_dispatched");
      } finally {
        releaseAll();
        for (const item of pending) await within(item.promise.catch(() => undefined), 2_000, `deferred task ${item.runId} did not settle during cleanup`).catch(() => undefined);
      }
    });

    await t.test("timeout is enforced and late snapshot cannot overwrite the terminal result", { timeout: 10_000 }, async () => {
      const grant = await makeGrant(actor.principal_id, "managed-task-timeout-grant");
      const executor = { ...actor, grant_id: grant.grant_id };
      let release: ReturnType<typeof deferred<Json>> | undefined;
      let heldRunId: string | undefined;
      snapshotHandler = async (_request, runId) => {
        heldRunId = runId;
        release = deferred<Json>();
        return release.promise;
      };
      const callCount = snapshotCalls.length;
      const timeoutMs = 250;
      const request = submitRequest(pin, executor, "managed-task-timeout-001", timeoutMs);
      const pending = managedTaskService.operate(credentialHash, request);
      try {
        await waitUntil(() => snapshotCalls.length === callCount + 1, 2_000, "timeout snapshot did not start");
        assert(snapshotCalls.at(-1)!.timeoutMs !== undefined && snapshotCalls.at(-1)!.timeoutMs! > 0 && snapshotCalls.at(-1)!.timeoutMs! <= timeoutMs,
          "Core passes the remaining bounded Task Intent timeout to Harbor");
        assert(heldRunId);
        const timedOut = response(await within(pending, 1_500, "short Task Intent timeout was not enforced"));
        assert.equal(timedOut.run.status, "failed");
        assert.equal(timedOut.run.dispatch_state, "not_dispatched");
        assert.equal(timedOut.failure.code, "managed_task_timeout");
        const terminal = await runRecordStore.getRunRecord(heldRunId);
        assert(terminal);
        assert.equal(terminal.status, "failed");
        assert.equal(timedOut.result.ok, false);
        assert.equal(timedOut.result.outcome, "failed");
        assert.deepEqual(terminal.public_result_summary?.result, timedOut.result,
          "timeout failure envelope and terminal Run status must be committed together");
        release!.resolve(snapshotReceipt(pin, targetRef, heldRunId));
        await delay(40);
        assert.deepEqual(await runRecordStore.getRunRecord(heldRunId), terminal, "late completion after timeout must not replace the terminal failure");
      } finally {
        if (release && heldRunId) release.resolve(snapshotReceipt(pin, targetRef, heldRunId));
        await within(pending.catch(() => undefined), 2_000, "timed-out task did not settle during cleanup").catch(() => undefined);
        snapshotHandler = async (request, runId) => snapshotReceipt(pin, request.page_ref, runId);
      }
    });

    await t.test("ambiguous dispatched receipt remains on the original Run and is never replayed", { timeout: 10_000 }, async () => {
      const grant = await makeGrant(actor.principal_id, "managed-task-unknown-grant");
      const executor = { ...actor, grant_id: grant.grant_id };
      snapshotHandler = async () => {
        const error = new Error("Harbor outcome is ambiguous");
        Object.assign(error, { receipt: { status: "unknown", dispatch_state: "dispatched" } });
        throw error;
      };
      const key = "managed-task-unknown-001";
      const callCount = snapshotCalls.length;
      const ambiguous = response(await managedTaskService.operate(credentialHash, submitRequest(pin, executor, key)));
      assert.equal(ambiguous.run.status, "unknown_outcome");
      assert.equal(ambiguous.run.dispatch_state, "dispatched");
      const original = await runRecordStore.getRunRecord(ambiguous.run.run_id);
      assert(original);
      assert.equal(original.status, "unknown_outcome");
      assert.equal(original.public_result_summary?.dispatch_state, "dispatched");

      const queried = response(await managedTaskService.operate(credentialHash, queryRequest(pin, executor, { original_idempotency_key: key })));
      assert.equal(queried.run.run_id, ambiguous.run.run_id);
      assert.equal(queried.run.status, "unknown_outcome");
      assert.equal(queried.run.dispatch_state, "dispatched");
      const replayed = response(await managedTaskService.operate(credentialHash, submitRequest(pin, executor, key)));
      assert.equal(replayed.run.run_id, ambiguous.run.run_id);
      assert.equal(replayed.run.status, "unknown_outcome");
      assert.equal(snapshotCalls.length, callCount + 1, "query and same-key submit cannot replay an ambiguous snapshot");
      assert.deepEqual(await runRecordStore.getRunRecord(ambiguous.run.run_id), original,
        "query and same-key submit must preserve the original unknown outcome facts");
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("GitHub Trending package executes through the Core broker after install and enable", {
  skip: lodeRoot ? false : "WEBENVOY_LODE_ROOT is not configured; no pinned Lode package source is available",
  timeout: 30_000
}, async t => {
  if (!lodeRoot) return;
  const root = resolve(lodeRoot);
  const pin = await readScriptTaskPin(root, "lode://site-skill/github/trending");
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-managed-script-task-test-"));
  const accessDirectory = join(directory, "access");
  const runDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");
  const credentialHash = "c".repeat(64);
  const targetRef = "page_github_trending_test_001";
  const names = ["alpha/one", "beta/two", "gamma/three", "delta/four", "epsilon/five"];
  const trendingText = [
    "Skip to content", "Navigation Menu", "Sign in", "Trending", "Repositories", "Developers",
    "Spoken Language: Any", "Language: Any", "Date range: Today", "",
    ...names.flatMap((name, index) => [name, `Description for ${name}`, `${["Python", "TypeScript", "Rust", "Go", "Java"][index]} 1,234 5,678 Built by`, `${310 - index * 20} stars today`, ""])
  ].join("\n");
  let managedTaskService: ReturnType<typeof createManagedTaskService>;
  const snapshotCalls: Json[] = [];
  let nextSnapshotFailure: Json | undefined;
  const accessStore = createFileManagedAccessStore({ directory: accessDirectory });
  const runRecordStore = createFileRunRecordStore({ directory: runDirectory });
  const skillLibraryService = createFileSkillLibraryService({ directory: libraryDirectory, lodeAssetsPath: root, accessStore, runRecordStore });
  const managedBrowserService = {
    async executeTaskSnapshot(_credentialHash: string, value: unknown, runId: string): Promise<Json> {
      const request = value as Json;
      snapshotCalls.push(request);
      assert.equal(request.operation, "instance.snapshot");
      assert.equal(request.idempotency_key, runId);
      if (nextSnapshotFailure) {
        const receipt = nextSnapshotFailure;
        nextSnapshotFailure = undefined;
        throw Object.assign(new Error("managed_task_snapshot_unavailable"), { code: "managed_task_snapshot_unavailable", receipt });
      }
      return {
        status: "completed", dispatch_state: "not_dispatched",
        page: { page_ref: targetRef, current_url: "https://github.com/trending", title: "Trending repositories" },
        snapshot: { page_ref: targetRef, observation_ref: `observation:${runId}`, text: trendingText, truncated: false,
          coverage: { text: { state: "complete" } }, continuation: { has_more: false } }
      };
    }
  };
  const actor = await accessStore.registerPrincipal({ idempotency_key: "github-script-principal", display_name: "github-script-agent", credential_hash: credentialHash });
  const connection = await accessStore.connect(credentialHash);
  const grant = await accessStore.createGrant({
    idempotency_key: "github-script-grant", principal_id: actor.principal_id,
    allowed_operations: [...managedSkillOperations, ...managedTaskOperations, ...managedPageOperations], profile_refs: [profileRef], allowed_origins: [pin.origin],
    expires_at: grantExpiry, creation_template: null, max_created_profiles: 0,
    skill_scope: { skill_refs: [pin.package.package_ref], source_refs: [pin.source_ref, pin.package.revision_ref] }
  });
  await accessStore.setProfilePolicy({
    idempotency_key: "github-script-profile-policy", profile_ref: profileRef,
    allowed_operations: [...managedTaskOperations, ...managedPageOperations], allowed_origins: [pin.origin]
  });
  const skillScope = { operations: [...managedSkillOperations], skill_refs: [pin.package.package_ref], source_refs: [pin.source_ref, pin.package.revision_ref] };
  const installed = await skillLibraryService.submit(credentialHash, {
    idempotency_key: "github-script-install", connection_id: connection.connection_id, grant_id: grant.grant_id,
    operation: "skill.install", skill_ref: pin.package.package_ref, task_scope: skillScope,
    revision_ref: pin.package.revision_ref, source_ref: pin.source_ref
  });
  assert.equal((installed as Json).ok, true, JSON.stringify(installed));
  const enabled = await skillLibraryService.submit(credentialHash, {
    idempotency_key: "github-script-enable", connection_id: connection.connection_id, grant_id: grant.grant_id,
    operation: "skill.enable", skill_ref: pin.package.package_ref, task_scope: skillScope,
    target_revision_ref: pin.package.revision_ref, source_ref: pin.source_ref, expected_record_version: 1
  });
  assert.equal((enabled as Json).ok, true, JSON.stringify(enabled));
  managedTaskService = createManagedTaskService({ accessStore, runRecordStore, skillLibraryService, managedBrowserService,
    workerIdentity: { owner_uid: 501, agent_uid: 502, mode: "distinct_uid_hardened", owner_socket_acl: "verified" } });
  const request = (operation: string, idempotencyKey: string) => ({
    schema_version: "webenvoy.managed-task-operation/v1", operation, idempotency_key: idempotencyKey,
    grant_id: grant.grant_id, connection_id: connection.connection_id,
    task_scope: { operations: [operation], skill_refs: [pin.package.package_ref], source_refs: [pin.package.revision_ref], profile_refs: [profileRef], origins: [pin.origin] },
    package: { ...pin.package }, target: { target_type: "web_page", target_ref: targetRef },
    input: { schema_ref: pin.input_schema_ref, carrier: "none" },
    intent: { summary: "Read the first five daily trending repositories.", policy: { risk: "read", execution_intent: "read", timeout_ms: 10_000 } }
  });
  try {
    await t.test("the first durable Run write pins script execution and recovers an admitted crash", async () => {
      const key = "github-script-crash-after-create-001";
      let injected = false;
      const crashStore: FileRunRecordStore = {
        ...runRecordStore,
        async updateRunRecord(runId, patch) {
          if (!injected && patch.status === "running") {
            injected = true;
            throw new Error("simulated_core_exit_after_run_create");
          }
          return runRecordStore.updateRunRecord(runId, patch);
        }
      };
      const interrupted = createManagedTaskService({ accessStore, runRecordStore: crashStore, skillLibraryService, managedBrowserService,
        workerIdentity: { owner_uid: 501, agent_uid: 502, mode: "distinct_uid_hardened", owner_socket_acl: "verified" } });
      await assert.rejects(interrupted.operate(credentialHash, request("task.submit", key), { agentSocketIngressVerified: true }), /simulated_core_exit_after_run_create/);
      assert.equal(injected, true);
      const runId = `managed-task-${createHash("sha256").update(`${actor.principal_id}\0${key}`).digest("hex")}`;
      const stranded = await runRecordStore.getRunRecord(runId);
      assert.equal(stranded?.status, "admitted");
      assert.equal(stranded?.public_result_summary?.script_execution, true, "script identity must be written atomically with the Run");
      assert.equal(stranded?.public_result_summary?.script_sha256, `sha256:${createHash("sha256").update(await readFile(pin.script_path)).digest("hex")}`);
      const restarted = createManagedTaskService({ accessStore, runRecordStore, skillLibraryService, managedBrowserService,
        workerIdentity: { owner_uid: 501, agent_uid: 502, mode: "distinct_uid_hardened", owner_socket_acl: "verified" } });
      const queried = response(await restarted.operate(credentialHash, {
        schema_version: "webenvoy.managed-task-operation/v1", operation: "task.query", grant_id: grant.grant_id,
        connection_id: connection.connection_id,
        task_scope: { operations: ["task.query"], skill_refs: [pin.package.package_ref], source_refs: [pin.package.revision_ref], profile_refs: [profileRef], origins: [pin.origin] },
        selector: { run_id: runId }
      }));
      assert.equal(queried.run.run_id, runId);
      assert.equal(queried.run.status, "failed");
      assert.equal(queried.run.dispatch_state, "not_dispatched");
      const replay = response(await restarted.operate(credentialHash, request("task.submit", key), { agentSocketIngressVerified: true }));
      assert.equal(replay.run.run_id, runId);
      assert.equal(replay.run.status, "failed");
      assert.equal(Object.hasOwn(replay, "worker_execution"), false);
      assert.equal(snapshotCalls.length, 0, "recovery cannot create a replacement ticket or call Harbor");
    });

    await t.test("a direct Core API submit cannot receive script source or a worker ticket", async () => {
      const direct = await managedTaskService.operate(credentialHash, request("task.submit", "github-script-direct-api-001")) as Json;
      assert.equal(direct.run.status, "failed");
      assert.equal(direct.run.dispatch_state, "not_dispatched");
      assert.equal(direct.failure.code, "managed_site_worker_host_unavailable");
      assert.equal(Object.hasOwn(direct, "worker_execution"), false);
      assert.equal(JSON.stringify(direct).includes(await readFile(pin.script_path, "utf8")), false);
      assert.equal(snapshotCalls.length, 0, "unattested direct Core calls cannot reach Harbor");
    });

    const prepared = await managedTaskService.operate(credentialHash, request("task.submit", "github-script-run-001"), { agentSocketIngressVerified: true }) as Json;
    const ticket = prepared.worker_execution.ticket as Json;
    assert.equal(prepared.run.status, "running");
    assert.equal(ticket.run_id, ticket.context.run_id);
    assert.equal(ticket.package.package_ref, pin.package.package_ref);
    assert.equal(ticket.package.revision_ref, pin.package.revision_ref);
    assert.deepEqual(ticket.script.broker_capabilities, ["runtime.invoke", "output.write"]);
    assert.equal(await readFile(pin.script_path, "utf8"), ticket.script.source);
    assert.equal(JSON.stringify(prepared).includes("observation:"), false, "prepare ticket does not contain a browser receipt");

    await managedTaskService.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
    const snapshot = await managedTaskService.broker(credentialHash, {
      ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" }
    }) as Json;
    assert.equal(snapshot.status, "completed");
    assert.equal(snapshot.page.current_url, "https://github.com/trending");
    assert.equal(snapshot.snapshot.text, trendingText);
    const output = {
      result_kind: "github_trending_daily_top5", status: "available",
      normalized: { period: "daily", requested_count: 5,
        rows: names.map((name, index) => ({ name, url: `https://github.com/${name}`, language: ["Python", "TypeScript", "Rust", "Go", "Java"][index],
          language_state: "observed", today_stars: 310 - index * 20, today_stars_state: "observed" })),
        completeness: "complete", snapshot_coverage: "complete" },
      source_refs: [{ ref_id: targetRef, source_kind: "harbor_page" }],
      evidence_refs: [{ ref_id: `observation:${ticket.run_id}`, evidence_kind: "snapshot_ref", producer: "harbor", redaction: "summary_only" }]
    };
    await managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "output.write", input: output });
    const submitted = response(await managedTaskService.workerComplete(credentialHash, { ticket_id: ticket.ticket_id }));
    assert.equal(submitted.run.status, "succeeded", JSON.stringify(submitted));
    assert.equal(submitted.run.package_ref, pin.package.package_ref);
    assert.equal(submitted.run.dispatch_state, "dispatched", "script execution is a one-time dispatched Run");
    assert.equal(submitted.result.ok, true);
    assert.equal(submitted.result.data.result_kind, "github_trending_daily_top5");
    assert.deepEqual(submitted.result.data.normalized.rows.map((row: Json) => row.name), names);
    assert.deepEqual(submitted.result.evidence_refs, [`observation:${submitted.run.run_id}`]);
    assert.equal(submitted.result.post_check.status, "passed");
    assert.equal(snapshotCalls.length, 1, "the script's single runtime.invoke maps to one Harbor snapshot");

    const record = await runRecordStore.getRunRecord(submitted.run.run_id);
    assert(record);
    const reopenAccess = createFileManagedAccessStore({ directory: accessDirectory });
    const reopenedRuns = createFileRunRecordStore({ directory: runDirectory });
    const reopenedLibrary = createFileSkillLibraryService({ directory: libraryDirectory, lodeAssetsPath: root, accessStore: reopenAccess, runRecordStore: reopenedRuns });
    const reopened = createManagedTaskService({ accessStore: reopenAccess, runRecordStore: reopenedRuns, skillLibraryService: reopenedLibrary, managedBrowserService });
    const reconnected = await reopenAccess.connect(credentialHash);
    const queried = response(await reopened.operate(credentialHash, {
      schema_version: "webenvoy.managed-task-operation/v1", operation: "task.query", grant_id: grant.grant_id,
      connection_id: reconnected.connection_id,
      task_scope: { operations: ["task.query"], skill_refs: [pin.package.package_ref], source_refs: [pin.package.revision_ref], profile_refs: [profileRef], origins: [pin.origin] },
      selector: { original_idempotency_key: "github-script-run-001" }
    }));
    assert.equal(queried.run.run_id, submitted.run.run_id);
    assert.deepEqual(queried.result, submitted.result);
    assert.equal(snapshotCalls.length, 1, "query/restart never dispatches the original script again");

    await t.test("Core restart resolves an unstarted ticket as not_dispatched without replay", async () => {
      const key = "github-script-restart-prepared-001";
      const before = snapshotCalls.length;
      const preparedRun = await managedTaskService.operate(credentialHash, request("task.submit", key), { agentSocketIngressVerified: true }) as Json;
      assert.equal(preparedRun.run.status, "running");
      assert.equal(preparedRun.run.dispatch_state, "not_dispatched");
      const restartedAccess = createFileManagedAccessStore({ directory: accessDirectory });
      const restartedRuns = createFileRunRecordStore({ directory: runDirectory });
      const restartedLibrary = createFileSkillLibraryService({ directory: libraryDirectory, lodeAssetsPath: root, accessStore: restartedAccess, runRecordStore: restartedRuns });
      const restartedService = createManagedTaskService({ accessStore: restartedAccess, runRecordStore: restartedRuns, skillLibraryService: restartedLibrary, managedBrowserService });
      const reconnect = await restartedAccess.connect(credentialHash);
      const queried = response(await restartedService.operate(credentialHash, {
        schema_version: "webenvoy.managed-task-operation/v1", operation: "task.query", grant_id: grant.grant_id,
        connection_id: reconnect.connection_id,
        task_scope: { operations: ["task.query"], skill_refs: [pin.package.package_ref], source_refs: [pin.package.revision_ref], profile_refs: [profileRef], origins: [pin.origin] },
        selector: { original_idempotency_key: key }
      }));
      assert.equal(queried.run.run_id, preparedRun.run.run_id);
      assert.equal(queried.run.status, "failed");
      assert.equal(queried.run.dispatch_state, "not_dispatched");
      const replayRequest = request("task.submit", key);
      replayRequest.connection_id = reconnect.connection_id;
      const replay = response(await restartedService.operate(credentialHash, replayRequest, { agentSocketIngressVerified: true }));
      assert.equal(replay.run.run_id, preparedRun.run.run_id);
      assert.equal(replay.run.status, "failed");
      assert.equal(snapshotCalls.length, before, "restart query and same-key submit do not mint a new ticket or dispatch");
    });

    await t.test("an unconsumed worker ticket expires to a terminal not_dispatched Run", async () => {
      const key = "github-script-ticket-expiry-001";
      const before = snapshotCalls.length;
      const submit = request("task.submit", key);
      submit.intent.policy.timeout_ms = 40;
      const preparedRun = await managedTaskService.operate(credentialHash, submit, { agentSocketIngressVerified: true }) as Json;
      assert.equal(preparedRun.run.status, "running");
      assert.equal(preparedRun.run.dispatch_state, "not_dispatched");
      assert.equal(typeof preparedRun.worker_execution.ticket.ticket_id, "string");
      await delay(100);
      const terminal = await runRecordStore.getRunRecord(preparedRun.run.run_id);
      assert.equal(terminal?.status, "failed");
      assert.equal(terminal?.public_result_summary?.dispatch_state, "not_dispatched");
      assert.equal(terminal?.failure?.code, "managed_task_timeout");
      const retry = response(await managedTaskService.operate(credentialHash, submit, { agentSocketIngressVerified: true }));
      assert.equal(retry.run.run_id, preparedRun.run.run_id);
      assert.equal(retry.run.status, "failed");
      assert.equal(Object.hasOwn(retry, "worker_execution"), false);
      assert.equal(snapshotCalls.length, before, "ticket expiry and same-key submit never invoke Harbor or mint a replacement");
    });

    await t.test("Core restart after snapshot records dispatched unknown and never replays", async () => {
      const key = "github-script-restart-dispatched-001";
      const before = snapshotCalls.length;
      const preparedRun = await managedTaskService.operate(credentialHash, request("task.submit", key), { agentSocketIngressVerified: true }) as Json;
      const ticket = preparedRun.worker_execution.ticket as Json;
      await managedTaskService.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
      await managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" } });
      assert.equal(snapshotCalls.length, before + 1);
      const restartedAccess = createFileManagedAccessStore({ directory: accessDirectory });
      const restartedRuns = createFileRunRecordStore({ directory: runDirectory });
      const restartedLibrary = createFileSkillLibraryService({ directory: libraryDirectory, lodeAssetsPath: root, accessStore: restartedAccess, runRecordStore: restartedRuns });
      const restartedService = createManagedTaskService({ accessStore: restartedAccess, runRecordStore: restartedRuns, skillLibraryService: restartedLibrary, managedBrowserService });
      const reconnect = await restartedAccess.connect(credentialHash);
      const queried = response(await restartedService.operate(credentialHash, {
        schema_version: "webenvoy.managed-task-operation/v1", operation: "task.query", grant_id: grant.grant_id,
        connection_id: reconnect.connection_id,
        task_scope: { operations: ["task.query"], skill_refs: [pin.package.package_ref], source_refs: [pin.package.revision_ref], profile_refs: [profileRef], origins: [pin.origin] },
        selector: { original_idempotency_key: key }
      }));
      assert.equal(queried.run.run_id, preparedRun.run.run_id);
      assert.equal(queried.run.status, "unknown_outcome");
      assert.equal(queried.run.dispatch_state, "dispatched");
      assert.equal(snapshotCalls.length, before + 1, "restart recovery does not issue a second snapshot");
    });

    await t.test("a rejected first snapshot invoke is failed not_dispatched and never replayed", async () => {
      const key = "github-script-first-invoke-rejected-001";
      const before = snapshotCalls.length;
      const preparedRun = await managedTaskService.operate(credentialHash, request("task.submit", key), { agentSocketIngressVerified: true }) as Json;
      const ticket = preparedRun.worker_execution.ticket as Json;
      await managedTaskService.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
      nextSnapshotFailure = { status: "unavailable", dispatch_state: "not_dispatched" };
      await rejectsWithCode(managedTaskService.broker(credentialHash, {
        ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" }
      }), ["managed_task_snapshot_unavailable"]);
      await managedTaskService.workerFailure(credentialHash, { ticket_id: ticket.ticket_id, code: "managed_task_snapshot_unavailable" });
      const terminal = await runRecordStore.getRunRecord(preparedRun.run.run_id);
      assert.equal(terminal?.status, "failed");
      assert.equal(terminal?.public_result_summary?.dispatch_state, "not_dispatched");
      assert.equal(snapshotCalls.length, before + 1, "the rejected first invoke is never retried");
    });

    await t.test("a terminal Run discovered by worker failure deactivates its ticket", async () => {
      const prepared = await managedTaskService.operate(credentialHash,
        request("task.submit", "github-script-terminal-ticket-cleanup-001"), { agentSocketIngressVerified: true }) as Json;
      const ticketId = prepared.worker_execution.ticket.ticket_id as string;
      await completeRunWithFailure(runRecordStore, prepared.run.run_id, {
        status: "failed", failure: { category: "runtime_execution", code: "managed_task_timeout", phase: "execution", recovery_hint: "query_original_run_only" },
        persist_result_envelope: true
      });
      const existing = response(await managedTaskService.workerFailure(credentialHash, { ticket_id: ticketId, code: "managed_task_snapshot_unavailable" }));
      assert.equal(existing.run.status, "failed", "a terminal race returns the durable Run without rewriting it");
      await rejectsWithCode(managedTaskService.workerFailure(credentialHash, { ticket_id: ticketId, code: "managed_task_snapshot_unavailable" }), ["managed_task_ticket_inactive"]);
    });

    await t.test("Grant revocation after snapshot blocks output without a second browser call", async () => {
      const freshGrant = await accessStore.createGrant({
        idempotency_key: "github-script-revoke-grant", principal_id: actor.principal_id,
        allowed_operations: [...managedSkillOperations, ...managedTaskOperations, ...managedPageOperations], profile_refs: [profileRef], allowed_origins: [pin.origin],
        expires_at: grantExpiry, creation_template: null, max_created_profiles: 0,
        skill_scope: { skill_refs: [pin.package.package_ref], source_refs: [pin.source_ref, pin.package.revision_ref] }
      });
      const before = snapshotCalls.length;
      const revokedRequest = request("task.submit", "github-script-revoked-001");
      revokedRequest.grant_id = freshGrant.grant_id;
      const preparedRun = await managedTaskService.operate(credentialHash, revokedRequest, { agentSocketIngressVerified: true }) as Json;
      const ticket = preparedRun.worker_execution.ticket as Json;
      await managedTaskService.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
      await managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" } });
      assert.equal(snapshotCalls.length, before + 1);
      await accessStore.revokeGrant({ idempotency_key: "github-script-revoke", grant_id: freshGrant.grant_id });
      await rejectsWithCode(managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "output.write", input: {} }),
        ["managed_access_grant_unavailable", "managed_access_denied"]);
      await managedTaskService.workerFailure(credentialHash, { ticket_id: ticket.ticket_id, code: "managed_access_denied" });
      const terminal = await runRecordStore.getRunRecord(preparedRun.run.run_id);
      assert.equal(terminal?.status, "failed");
      assert.equal(terminal?.public_result_summary?.dispatch_state, "dispatched");
      assert.equal(snapshotCalls.length, before + 1, "revocation blocks output without another Harbor snapshot");
    });

    await t.test("task.stop after snapshot blocks late calls and preserves the cancelled Run", async () => {
      const freshGrant = await accessStore.createGrant({
        idempotency_key: "github-script-stop-grant", principal_id: actor.principal_id,
        allowed_operations: [...managedSkillOperations, ...managedTaskOperations, ...managedPageOperations], profile_refs: [profileRef], allowed_origins: [pin.origin],
        expires_at: grantExpiry, creation_template: null, max_created_profiles: 0,
        skill_scope: { skill_refs: [pin.package.package_ref], source_refs: [pin.source_ref, pin.package.revision_ref] }
      });
      const before = snapshotCalls.length;
      const submit = request("task.submit", "github-script-stop-submit-001");
      submit.grant_id = freshGrant.grant_id;
      const preparedRun = await managedTaskService.operate(credentialHash, submit, { agentSocketIngressVerified: true }) as Json;
      const ticket = preparedRun.worker_execution.ticket as Json;
      await managedTaskService.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
      await managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" } });
      assert.equal(snapshotCalls.length, before + 1);
      const stopped = response(await managedTaskService.operate(credentialHash, {
        schema_version: "webenvoy.managed-task-operation/v1", operation: "task.stop", idempotency_key: "github-script-stop-key-001",
        grant_id: freshGrant.grant_id, connection_id: connection.connection_id,
        task_scope: { operations: ["task.stop"], skill_refs: [pin.package.package_ref], source_refs: [pin.package.revision_ref], profile_refs: [profileRef], origins: [pin.origin] },
        selector: { run_id: preparedRun.run.run_id }
      }));
      assert.equal(stopped.run.status, "cancelled");
      await rejectsWithCode(managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "output.write", input: {} }), ["managed_task_ticket_inactive"]);
      await rejectsWithCode(managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" } }),
        ["managed_task_ticket_inactive", "managed_site_capability_not_admitted"]);
      await rejectsWithCode(managedTaskService.workerFailure(credentialHash, { ticket_id: ticket.ticket_id, code: "managed_task_snapshot_unavailable" }), ["managed_task_ticket_inactive"]);
      const terminal = await runRecordStore.getRunRecord(preparedRun.run.run_id);
      assert.equal(terminal?.status, "cancelled");
      assert.equal(snapshotCalls.length, before + 1, "stop prevents a second browser operation");
    });

    await t.test("disabling the package blocks new Runs but does not retarget an admitted ticket", async () => {
      const before = snapshotCalls.length;
      const preparedRun = await managedTaskService.operate(credentialHash,
        request("task.submit", "github-script-disable-after-prepare-001"), { agentSocketIngressVerified: true }) as Json;
      const ticket = preparedRun.worker_execution.ticket as Json;
      const disabled = await skillLibraryService.submit(credentialHash, {
        idempotency_key: "github-script-disable-while-running", connection_id: connection.connection_id,
        grant_id: grant.grant_id, operation: "skill.disable", skill_ref: pin.package.package_ref,
        task_scope: skillScope, expected_record_version: 2
      }) as Json;
      assert.equal(disabled.ok, true, JSON.stringify(disabled));
      await managedTaskService.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
      const snapshot = await managedTaskService.broker(credentialHash, {
        ticket_id: ticket.ticket_id, method: "runtime.invoke", input: { operation_id: "instance.snapshot", action: "read" }
      }) as Json;
      assert.equal(snapshot.status, "completed");
      const output = {
        result_kind: "github_trending_daily_top5", status: "available",
        normalized: { period: "daily", requested_count: 5,
          rows: names.map((name, index) => ({ name, url: `https://github.com/${name}`, language: ["Python", "TypeScript", "Rust", "Go", "Java"][index],
            language_state: "observed", today_stars: 310 - index * 20, today_stars_state: "observed" })),
          completeness: "complete", snapshot_coverage: "complete" },
        source_refs: [{ ref_id: targetRef, source_kind: "harbor_page" }],
        evidence_refs: [{ ref_id: `observation:${ticket.run_id}`, evidence_kind: "snapshot_ref", producer: "harbor", redaction: "summary_only" }]
      };
      await managedTaskService.broker(credentialHash, { ticket_id: ticket.ticket_id, method: "output.write", input: output });
      const completed = response(await managedTaskService.workerComplete(credentialHash, { ticket_id: ticket.ticket_id }));
      assert.equal(completed.run.status, "succeeded");
      assert.equal(snapshotCalls.length, before + 1);
      await rejectsWithCode(managedTaskService.operate(credentialHash,
        request("task.submit", "github-script-new-after-disable-001"), { agentSocketIngressVerified: true }), ["managed_skill_disabled"]);
      assert.equal(snapshotCalls.length, before + 1, "disabled package cannot create a new Harbor action");
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
