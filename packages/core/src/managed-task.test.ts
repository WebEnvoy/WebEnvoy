import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileManagedAccessStore, managedSkillOperations, managedTaskOperations } from "./managed-access.js";
import { createManagedTaskService } from "./managed-task.js";
import { createFileRunRecordStore, type FileRunRecordStore, type RunRecordStatus } from "./run-record-store.js";
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
type Actor = { credential_hash: string; principal_id: string; connection_id: string; grant_id: string };
type SnapshotHandler = (request: Json, runId: string, timeoutMs?: number) => Promise<Json>;

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
      await rejectsWithCode(managedTaskService.operate(credentialHash, wrongPin), ["managed_access_denied"]);
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
