import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore, type FileRunRecordStore } from "./run-record-store.js";
import { createFileTaskThreadStore } from "./task-thread-store.js";
import { taskTurnInputSchemaVersion, TaskThreadStoreError } from "./task-turn-input.js";
import { createLocalTaskTurnInputPolicyResolver } from "./task-turn-input-policy.js";

const packageRef = "lode://site-capability/test/search-notes@0.1.0";

async function writeLodeFixture(root: string): Promise<string> {
  const packageDirectory = join(root, "sites", "test", "search-notes");
  const registryDirectory = join(root, "registry");
  await mkdir(join(packageDirectory, "schemas"), { recursive: true });
  await mkdir(registryDirectory, { recursive: true });
  await writeFile(join(packageDirectory, "manifest.json"), JSON.stringify({
    package_ref: packageRef,
    capability: { capability_id: "search-notes" },
    asset_refs: [{
      role: "input_schema",
      path: "schemas/input.schema.json",
      schema_id: "lode://schema/site-capability/test/search-notes/input@0.1.0"
    }]
  }), "utf8");
  await writeFile(join(packageDirectory, "schemas", "input.schema.json"), JSON.stringify({
    $id: "lode://schema/site-capability/test/search-notes/input@0.1.0",
    properties: {
      keyword: { type: "string", maxLength: 80 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
      url: { type: "string", format: "uri" },
      public_url: { type: "string", format: "uri" },
      mode: { type: "string", enum: ["latest", "general"] },
      draft_body: { type: "string", maxLength: 512 }
    },
    "x-lode": {
      package_ref: packageRef,
      sensitivity: {
        keyword: "user_provided",
        limit: "user_provided",
        url: "user_provided",
        public_url: "public",
        mode: "user_provided",
        draft_body: "user_provided"
      }
    }
  }), "utf8");
  const registryPath = join(registryDirectory, "local-packages.json");
  await writeFile(registryPath, JSON.stringify({
    entries: [{
      package_ref: packageRef,
      package_path: "sites/test/search-notes",
      manifest_path: "sites/test/search-notes/manifest.json",
      capability_id: "search-notes"
    }]
  }), "utf8");
  return registryPath;
}

function turnInput(runId: string, fields: unknown[]) {
  return {
    idempotency_key: `submit-${runId}`,
    request_hash: `hash-${runId}`,
    run_id: runId,
    creation_channel: "app" as const,
    package_ref: packageRef,
    input: { schema_version: taskTurnInputSchemaVersion, fields }
  };
}

async function assertProjectionPolicy(directory: string, runStore: FileRunRecordStore, registryPath: string): Promise<void> {
  const policyStore = createFileTaskThreadStore({
    directory: join(directory, "threads"),
    runRecordStore: runStore,
    resolveInputPolicy: createLocalTaskTurnInputPolicyResolver({ registryPath })
  });
  const thread = await policyStore.createOrGetTaskThread({
    capability_ref: "lode:capability/search-notes",
    identity_environment_ref: "identity-env:policy"
  });
  await assert.rejects(() => policyStore.reserveTaskTurn(thread.thread.thread_id, turnInput(
    "run_policy_raw_keyword",
    [{ field_id: "keyword", kind: "scalar", summary: "RAW DRAFT BODY" }]
  )), /input_field_summary_forbidden:keyword/);
  await assert.rejects(() => policyStore.reserveTaskTurn(thread.thread.thread_id, turnInput(
    "run_policy_invalid_number",
    [{ field_id: "limit", kind: "scalar", summary: "RAW DRAFT BODY" }]
  )), /input_field_summary_invalid:limit/);
  await assert.rejects(() => policyStore.reserveTaskTurn(thread.thread.thread_id, turnInput(
    "run_policy_owner_summary",
    [{ field_id: "draft_body", kind: "long_text", owner_ref: "draft:fixture", summary: "RAW DRAFT BODY" }]
  )), /field_summary_forbidden/);
  await assert.rejects(() => policyStore.reserveTaskTurn(thread.thread.thread_id, turnInput(
    "run_policy_private_url_path",
    [{ field_id: "url", kind: "url", summary: "https://example.test/reset/SECRET-TOKEN" }]
  )), /input_field_summary_forbidden:url/);
  await assert.rejects(() => policyStore.reserveTaskTurn(thread.thread.thread_id, {
    ...turnInput("run_policy_too_many_refs", []),
    input: {
      schema_version: taskTurnInputSchemaVersion,
      fields: [],
      attachment_refs: Array.from({ length: 33 }, (_, index) => `attachment:fixture/${index}`)
    }
  }), /attachment_refs_limit_exceeded/);
  assert.equal((await policyStore.getTaskThread(thread.thread.thread_id))?.turns.length, 0);
  const safeTurn = await policyStore.reserveTaskTurn(thread.thread.thread_id, turnInput("run_policy_safe", [
    { field_id: "keyword", kind: "long_text", owner_ref: "owner:input/keyword" },
    { field_id: "limit", kind: "scalar", summary: "8" },
    { field_id: "url", kind: "long_text", owner_ref: "owner:input/url" },
    { field_id: "public_url", kind: "url", summary: "https://example.test/search?q=public" }
  ]));
  assert.equal(safeTurn.turn.input.fields[2]?.owner_ref, "owner:input/url");
  assert.equal(safeTurn.turn.input.fields[3]?.summary, "https://example.test/search");
}

async function assertUnavailablePolicy(directory: string, runStore: FileRunRecordStore): Promise<void> {
  const store = createFileTaskThreadStore({ directory: join(directory, "unavailable"), runRecordStore: runStore });
  const thread = await store.createOrGetTaskThread({
    capability_ref: "lode:capability/policy-unavailable",
    identity_environment_ref: "identity-env:policy-unavailable"
  });
  await assert.rejects(
    () => store.reserveTaskTurn(thread.thread.thread_id, turnInput(
      "run_policy_unavailable",
      [{ field_id: "keyword", kind: "long_text", owner_ref: "owner:input/keyword" }]
    )),
    /lode_input_policy_unavailable/
  );
  assert.equal((await store.getTaskThread(thread.thread.thread_id))?.turns.length, 0);
}

async function assertOwnerCheckConcurrency(directory: string, runStore: FileRunRecordStore): Promise<void> {
  let activeChecks = 0;
  let maximumChecks = 0;
  const calls = new Map<string, number>();
  const store = createFileTaskThreadStore({
    directory: join(directory, "concurrency"),
    runRecordStore: runStore,
    resolveInputPolicy: async ({ package_ref, capability_ref }) => ({
      package_ref,
      capability_ref,
      input_schema_ref: "lode://schema/test/concurrency@0.1.0",
      fields: new Map(Array.from({ length: 16 }, (_, index) => [
        `file_${index}`,
        { field_id: `file_${index}`, projection: "owner_ref" as const }
      ]))
    }),
    checkOwnerRef: async (ownerRef) => {
      calls.set(ownerRef, (calls.get(ownerRef) ?? 0) + 1);
      activeChecks += 1;
      maximumChecks = Math.max(maximumChecks, activeChecks);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      activeChecks -= 1;
      return true;
    }
  });
  const thread = await store.createOrGetTaskThread({
    capability_ref: "lode:capability/owner-check-concurrency",
    identity_environment_ref: "identity-env:owner-check-concurrency"
  });
  for (let index = 0; index < 12; index += 1) {
    const ownerRef = `attachment:fixture/${index}`;
    const fields = [{ field_id: `file_${index}`, kind: "file", owner_ref: ownerRef }];
    const reserved = await store.reserveTaskTurn(thread.thread.thread_id, {
      ...turnInput(`run_owner_check_concurrency_${index}`, fields),
      input: { schema_version: taskTurnInputSchemaVersion, fields, attachment_refs: [ownerRef] }
    });
    await store.recordTaskTurnSubmission(thread.thread.thread_id, reserved.turn.turn_id, {
      accepted: false,
      http_status: 400,
      ok: false
    });
  }
  activeChecks = 0;
  maximumChecks = 0;
  calls.clear();
  await store.getTaskThread(thread.thread.thread_id);
  assert(maximumChecks <= 8);
  assert.equal(calls.size, 12);
  assert([...calls.values()].every((count) => count === 1));
}

async function assertResolverRaceReplay(
  directory: string,
  runStore: FileRunRecordStore,
  registryPath: string
): Promise<void> {
  const threadDirectory = join(directory, "resolver-race");
  const successResolver = createLocalTaskTurnInputPolicyResolver({ registryPath });
  const successStore = createFileTaskThreadStore({
    directory: threadDirectory,
    runRecordStore: runStore,
    resolveInputPolicy: successResolver
  });
  const thread = await successStore.createOrGetTaskThread({
    capability_ref: "lode:capability/search-notes",
    identity_environment_ref: "identity-env:resolver-race"
  });
  let signalStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let releaseFailure: () => void = () => {};
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  const failingStore = createFileTaskThreadStore({
    directory: threadDirectory,
    runRecordStore: runStore,
    resolveInputPolicy: async () => {
      signalStarted();
      await failureGate;
      throw new TaskThreadStoreError("lode_input_policy_unavailable");
    }
  });
  const input = turnInput("run_policy_resolver_race", [
    { field_id: "limit", kind: "scalar", summary: "8" }
  ]);
  const racingReplay = failingStore.reserveTaskTurn(thread.thread.thread_id, input);
  await started;
  const reserved = await successStore.reserveTaskTurn(thread.thread.thread_id, input);
  releaseFailure();
  const replayed = await racingReplay;
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.turn.turn_id, reserved.turn.turn_id);
}

export async function assertTaskTurnInputPolicy(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-input-policy-"));
  const runStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  try {
    const registryPath = await writeLodeFixture(join(directory, "lode"));
    await assertProjectionPolicy(directory, runStore, registryPath);
    await assertUnavailablePolicy(directory, runStore);
    await assertOwnerCheckConcurrency(directory, runStore);
    await assertResolverRaceReplay(directory, runStore, registryPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
