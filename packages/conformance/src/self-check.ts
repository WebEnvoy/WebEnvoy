import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFileRunRecordStore,
  completeRunWithFailure,
  completeRunWithResult,
  getRunEvidenceRefs,
  getRunResult,
  getRunSummary,
  resultEnvelopeSchemaVersion,
  runRecordSchemaVersion,
  type AdmissionDecision,
  type FailureRecord,
  type RetentionState,
  type RunRecord
} from "@webenvoy/core-runtime";
import { assertRealSiteReadOnlyFixtureQueries } from "./real-site-readonly-fixtures.js";
import { assertRealSiteWritePreviewFixtureQueries } from "./real-site-write-preview-fixtures.js";

type JsonObject = Record<string, unknown>;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = join(packageRoot, "..", "..");
const schemaPackageRoot = join(workspaceRoot, "packages", "schemas");
const schemaDir = join(schemaPackageRoot, "schemas");
const fixtureDir = join(schemaPackageRoot, "fixtures");

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 1, 0, tick));
  tick += 1;
  return instant;
}

const harborRuntimeBindingRefs = [
  "session_fixture_ready",
  "profile_fixture_public",
  "provider_fixture_local",
  "viewer_fixture_readonly",
  "snapshot_fixture_example",
  "refmap_fixture_example",
  "source_trace_fixture_example"
];

function asObject(value: unknown, label: string): JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

function asString(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert((value as string).length > 0, `${label} must not be empty`);
  return value as string;
}

function asStringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value.map((entry, index) => asString(entry, `${label}[${index}]`));
}

async function readJson(path: string): Promise<JsonObject> {
  return asObject(JSON.parse(await readFile(path, "utf8")), path);
}

async function jsonFiles(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => join(dir, entry));
}

async function readFixture(name: string): Promise<JsonObject> {
  return readJson(join(fixtureDir, name));
}

function assertSchemaMetadata(schema: JsonObject, file: string): void {
  asString(schema.$schema, `${file}.$schema`);
  asString(schema.$id, `${file}.$id`);
  const metadata = asObject(schema["x-webenvoy"], `${file}.x-webenvoy`);
  asString(metadata.owner, `${file}.x-webenvoy.owner`);
  asString(metadata.status, `${file}.x-webenvoy.status`);
  asString(metadata.compatibility_boundary, `${file}.x-webenvoy.compatibility_boundary`);
  asString(metadata.schema_version, `${file}.x-webenvoy.schema_version`);
  asStringArray(metadata.source_adrs, `${file}.x-webenvoy.source_adrs`);
}

async function assertLocalSchemaFixtures(): Promise<{ schemaCount: number; fixtureCount: number }> {
  const schemaFiles = await jsonFiles(schemaDir);
  const fixtureFiles = await jsonFiles(fixtureDir);
  assert(schemaFiles.length > 0, "at least one schema is required");
  assert(fixtureFiles.length > 0, "at least one fixture is required");

  const schemasByFile = new Map<string, JsonObject>();
  for (const file of schemaFiles) {
    const schema = await readJson(file);
    schemasByFile.set(basename(file), schema);
    assertSchemaMetadata(schema, file);
  }

  for (const file of fixtureFiles) {
    const fixture = await readJson(file);
    const schemaRef = asString(fixture.$schema, `${file}.$schema`);
    const schema = schemasByFile.get(basename(schemaRef));
    assert(schema, `${file} must reference a local schema file`);

    const fixtureVersion = asString(fixture.schema_version, `${file}.schema_version`);
    const schemaVersion = asString(asObject(schema["x-webenvoy"], `${schemaRef}.x-webenvoy`).schema_version, `${schemaRef}.schema_version`);
    assert.equal(fixtureVersion, schemaVersion, `${file} schema_version must match ${schemaRef}`);

    for (const field of Array.isArray(schema.required) ? schema.required : []) {
      const key = asString(field, `${schemaRef}.required[]`);
      assert(Object.hasOwn(fixture, key), `${file} missing required field ${key}`);
    }
  }

  return { schemaCount: schemaFiles.length, fixtureCount: fixtureFiles.length };
}

function asActionRisk(value: unknown, label: string): AdmissionDecision["action_risk"] {
  const risk = asString(value, label);
  assert(["read", "write", "submit", "destructive"].includes(risk), `${label} must be a known action risk`);
  return risk as AdmissionDecision["action_risk"];
}

function asRetentionState(value: unknown, label: string): RetentionState {
  const state = asString(value, label);
  assert(["active", "summary_only", "expired", "redacted", "access_denied", "deleted_by_policy"].includes(state), `${label} must be a known retention state`);
  return state as RetentionState;
}

function failureFromFixture(value: unknown): FailureRecord {
  const failure = asObject(value, "admission failure fixture.failure");
  const category = asString(failure.category, "failure.category");
  const phase = asString(failure.phase, "failure.phase");
  assert(
    [
      "request_invalid",
      "capability_contract",
      "resource_admission",
      "action_risk",
      "runtime_execution",
      "result_projection",
      "evidence_reference",
      "persistence_observability",
      "write_outcome"
    ].includes(category),
    "failure.category must be known"
  );
  assert(
    [
      "pre_admission",
      "admission",
      "resource_matching",
      "runtime_binding",
      "execution",
      "verification",
      "projection",
      "evidence",
      "persistence",
      "observability",
      "query",
      "write_verification",
      "reconciliation"
    ].includes(phase),
    "failure.phase must be known"
  );
  return {
    category: category as FailureRecord["category"],
    code: asString(failure.code, "failure.code"),
    phase: phase as FailureRecord["phase"],
    recovery_hint: asString(failure.recovery_hint, "failure.recovery_hint")
  };
}

function assertRefsOnly(record: RunRecord): void {
  for (const forbidden of ["raw_payload", "dom", "har", "screenshot", "video", "cookie", "token", "local_path"]) {
    assert(!Object.hasOwn(record, forbidden), `Run Record must not inline ${forbidden}`);
  }
}

function withoutFixtureSchema(value: JsonObject): JsonObject {
  const normalized = { ...value };
  delete normalized.$schema;
  return normalized;
}

function runRecordFromFixture(value: unknown, label: string): RunRecord {
  const fixture = asObject(value, label);
  const record = withoutFixtureSchema(fixture);
  assert.equal(asString(record.schema_version, `${label}.schema_version`), runRecordSchemaVersion);
  asString(record.run_id, `${label}.run_id`);
  const status = asString(record.status, `${label}.status`);
  assert(["pending", "admitted", "running", "succeeded", "failed", "blocked", "requires_user_action", "manual_recovery_required", "unknown_outcome", "cancelled", "expired"].includes(status), `${label}.status must be known`);
  asString(record.created_at, `${label}.created_at`);
  asString(record.updated_at, `${label}.updated_at`);
  asString(record.task_intent_ref, `${label}.task_intent_ref`);
  asString(record.capability_ref, `${label}.capability_ref`);
  if (record.capability_version !== undefined) asString(record.capability_version, `${label}.capability_version`);
  if (record.capability_source_ref !== undefined) asString(record.capability_source_ref, `${label}.capability_source_ref`);
  if (record.capability_lock_ref !== undefined) asString(record.capability_lock_ref, `${label}.capability_lock_ref`);
  if (record.terminal_at !== undefined) asString(record.terminal_at, `${label}.terminal_at`);
  if (record.entrypoint_ref !== undefined) asString(record.entrypoint_ref, `${label}.entrypoint_ref`);
  if (record.package_ref !== undefined) asString(record.package_ref, `${label}.package_ref`);
  if (record.runtime_binding_refs !== undefined) asStringArray(record.runtime_binding_refs, `${label}.runtime_binding_refs`);
  if (record.result_ref !== undefined) asString(record.result_ref, `${label}.result_ref`);
  if (record.evidence_refs !== undefined) asStringArray(record.evidence_refs, `${label}.evidence_refs`);
  if (record.retention_state !== undefined) asRetentionState(record.retention_state, `${label}.retention_state`);

  const admission = asObject(record.admission, `${label}.admission`);
  const decision = asString(admission.decision, `${label}.admission.decision`);
  assert(["accepted", "accepted_with_warnings", "blocked_pre_admission", "requires_user_action", "deferred_true_write"].includes(decision), `${label}.admission.decision must be known`);
  asActionRisk(admission.action_risk, `${label}.admission.action_risk`);
  if (admission.resource_requirement_refs !== undefined) asStringArray(admission.resource_requirement_refs, `${label}.admission.resource_requirement_refs`);
  if (admission.runtime_binding_refs !== undefined) asStringArray(admission.runtime_binding_refs, `${label}.admission.runtime_binding_refs`);
  if (admission.evidence_refs !== undefined) asStringArray(admission.evidence_refs, `${label}.admission.evidence_refs`);
  if (admission.resource_match_ref !== undefined) asString(admission.resource_match_ref, `${label}.admission.resource_match_ref`);
  if (admission.runtime_session_binding !== undefined) {
    const binding = asObject(admission.runtime_session_binding, `${label}.admission.runtime_session_binding`);
    assert.equal(asString(binding.schema_version, `${label}.admission.runtime_session_binding.schema_version`), "webenvoy.runtime-session-binding.v0");
    asString(binding.identity_environment_ref, `${label}.admission.runtime_session_binding.identity_environment_ref`);
    asString(binding.execution_identity_ref, `${label}.admission.runtime_session_binding.execution_identity_ref`);
    asString(binding.runtime_session_ref, `${label}.admission.runtime_session_binding.runtime_session_ref`);
    assert.equal(binding.core_task_run, true, `${label}.admission.runtime_session_binding.core_task_run must be true`);
  }
  if (record.failure !== undefined) failureFromFixture(record.failure);

  const runRecord = record as RunRecord;
  assertRefsOnly(runRecord);
  return runRecord;
}

function assertGoldenReadOnlyBindings(golden: RunRecord, task: JsonObject, result: JsonObject, evidence: JsonObject): void {
  const capability = asObject(task.capability, "read-only task capability");
  const policy = asObject(task.policy, "read-only task policy");
  const evidenceRef = asString(evidence.ref, "evidence.ref");
  assert.equal(golden.run_id, asString(result.run_record_ref, "result.run_record_ref"));
  assert.equal(golden.status, "succeeded");
  assert.equal(golden.task_intent_ref, asString(task.intent_id, "task.intent_id"));
  assert.equal(golden.entrypoint_ref, `entrypoint:${asString(task.entrypoint, "task.entrypoint")}`);
  assert.equal(golden.capability_ref, asString(capability.ref, "task.capability.ref"));
  assert.equal(golden.capability_version, asString(capability.version, "task.capability.version"));
  assert.equal(golden.capability_source_ref, asString(capability.source_ref, "task.capability.source_ref"));
  assert.equal(golden.capability_lock_ref, asString(capability.lock_ref, "task.capability.lock_ref"));
  assert.equal(golden.package_ref, asString(result.package_ref, "result.package_ref"));
  assert.equal(golden.admission.decision, "accepted");
  assert.equal(golden.admission.action_risk, asActionRisk(policy.risk, "task.policy.risk"));
  assert.deepEqual(golden.admission.resource_requirement_refs, asStringArray(task.resource_requirement_refs, "task.resource_requirement_refs"));
  assert.deepEqual(golden.admission.runtime_binding_refs, harborRuntimeBindingRefs);
  assert.deepEqual(golden.admission.evidence_refs, [evidenceRef]);
  assert.equal(golden.admission.resource_match_ref, "resource-match:fixture/ready");
  assert.deepEqual(golden.runtime_binding_refs, ["harbor:runtime-session/fixture-ready"]);
  assert.equal(golden.result_ref, asString(result.result_ref, "result.result_ref"));
  assert.deepEqual(golden.evidence_refs, [evidenceRef]);
  assert.equal(golden.retention_state, asRetentionState(result.retention_state, "result.retention_state"));
}

async function assertGoldenFixtureQueries(goldenFixture: JsonObject, golden: RunRecord, directory: string): Promise<void> {
  const goldenDirectory = join(directory, "golden");
  await mkdir(goldenDirectory, { recursive: true });
  await writeFile(join(goldenDirectory, `${golden.run_id}.json`), `${JSON.stringify(goldenFixture, null, 2)}\n`, "utf8");

  const goldenStore = createFileRunRecordStore({ directory: goldenDirectory });
  const seeded = await goldenStore.getRunRecord(golden.run_id);
  assert(seeded, "golden fixture must seed a file-backed Run Record store");
  assert.deepEqual(withoutFixtureSchema(seeded as unknown as JsonObject), golden);

  const runSummary = await getRunSummary(goldenStore, golden.run_id);
  if (!runSummary.ok) assert.fail(runSummary.failure.code);
  assert.equal(runSummary.run.status, "succeeded");
  assert.equal(runSummary.run.terminal_summary?.result_ref, golden.result_ref);

  const resultQuery = await getRunResult(goldenStore, golden.run_id);
  if (!resultQuery.ok) assert.fail(resultQuery.failure.code);
  assert.equal(resultQuery.result.result.envelope_state, "available");
  assert.equal(resultQuery.result.result.payload_state, "not_persisted_in_core");
  assert.equal(resultQuery.result.result.result_envelope?.ok, true);
  assert.equal(resultQuery.result.result.result_envelope?.result_ref, golden.result_ref);

  const evidenceQuery = await getRunEvidenceRefs(goldenStore, golden.run_id);
  if (!evidenceQuery.ok) assert.fail(evidenceQuery.failure.code);
  assert.equal(evidenceQuery.evidence.evidence_refs.length, 1);
  const evidenceSummary = evidenceQuery.evidence.evidence_refs[0];
  assert(evidenceSummary, "golden fixture query must return one evidence ref");
  assert.equal(evidenceSummary.ref, golden.evidence_refs?.[0]);
  assert.equal(evidenceSummary.source, "admission_and_terminal");
  assert.equal(evidenceSummary.state, "available");
  assert.equal(evidenceSummary.raw_access, "not_available_from_core");
}

async function assertWriteGuardrailFixtureQueries(guardrailFixture: JsonObject, guardrail: RunRecord, directory: string): Promise<void> {
  const guardrailDirectory = join(directory, "write-guardrail");
  await mkdir(guardrailDirectory, { recursive: true });
  await writeFile(join(guardrailDirectory, `${guardrail.run_id}.json`), `${JSON.stringify(guardrailFixture, null, 2)}\n`, "utf8");

  const guardrailStore = createFileRunRecordStore({ directory: guardrailDirectory });
  const seeded = await guardrailStore.getRunRecord(guardrail.run_id);
  assert(seeded, "write guardrail fixture must seed a file-backed Run Record store");
  assert.deepEqual(withoutFixtureSchema(seeded as unknown as JsonObject), guardrail);

  const runSummary = await getRunSummary(guardrailStore, guardrail.run_id);
  if (!runSummary.ok) assert.fail(runSummary.failure.code);
  assert.equal(runSummary.run.status, "failed");
  assert.equal(runSummary.run.admission.decision, "deferred_true_write");
  assert.equal(runSummary.run.admission.action_risk, "submit");
  assert.equal(runSummary.run.terminal_summary?.failure?.code, "true_write_deferred");

  const resultQuery = await getRunResult(guardrailStore, guardrail.run_id);
  if (!resultQuery.ok) assert.fail(resultQuery.failure.code);
  assert.equal(resultQuery.result.terminal, true);
  assert.equal(resultQuery.result.failure?.category, "action_risk");
  assert.equal(resultQuery.result.failure?.code, "true_write_deferred");
  assert.equal(resultQuery.result.result.result_envelope?.ok, false);
  assert.equal(resultQuery.result.result.result_envelope?.failure?.recovery_hint, "use_validate_or_preview");

  const evidenceQuery = await getRunEvidenceRefs(guardrailStore, guardrail.run_id);
  if (!evidenceQuery.ok) assert.fail(evidenceQuery.failure.code);
  assert.deepEqual(evidenceQuery.evidence.evidence_refs, []);
}

async function assertRunRecordStoreConformance(): Promise<number> {
  const task = await readFixture("read-only-submit.fixture.json");
  const result = await readFixture("result-envelope-success.fixture.json");
  const failureResult = await readFixture("result-envelope-failure.fixture.json");
  const evidence = await readFixture("evidence-ref-redacted.fixture.json");
  const admissionFailure = await readFixture("admission-failure-run-record.fixture.json");
  const goldenFixture = await readFixture("golden-read-only-run-record.fixture.json");
  const guardrailFixture = await readFixture("write-action-guardrail-run-record.fixture.json");
  const realSiteFixtures = [
    await readFixture("real-site-xiaohongshu-read-only-run-record.fixture.json"),
    await readFixture("real-site-boss-read-only-run-record.fixture.json"),
    await readFixture("real-site-user-takeover-run-record.fixture.json")
  ];
  const realSiteWritePreviewFixtures = [
    await readFixture("real-site-xiaohongshu-write-preview-run-record.fixture.json"),
    await readFixture("real-site-boss-write-preview-run-record.fixture.json"),
    await readFixture("real-site-write-preview-page-changed-run-record.fixture.json"),
    await readFixture("real-site-write-preview-cancelled-run-record.fixture.json"),
    await readFixture("real-site-write-preview-expired-run-record.fixture.json")
  ];
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-conformance-"));

  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const capability = asObject(task.capability, "read-only task capability");
    const policy = asObject(task.policy, "read-only task policy");
    const successRunId = asString(result.run_record_ref, "result.run_record_ref");
    const evidenceRef = asString(evidence.ref, "evidence.ref");
    assert(asStringArray(result.evidence_refs, "result.evidence_refs").includes(evidenceRef), "result fixture must reference the evidence fixture");
    const goldenRun = runRecordFromFixture(goldenFixture, "golden run fixture");
    const guardrailRun = runRecordFromFixture(guardrailFixture, "write guardrail run fixture");
    assert.equal(guardrailRun.status, "failed");
    assert.equal(guardrailRun.admission.decision, "deferred_true_write");
    assert.equal(guardrailRun.admission.action_risk, "submit");
    assert.equal(guardrailRun.failure?.code, "true_write_deferred");
    assertGoldenReadOnlyBindings(goldenRun, task, result, evidence);

    const created = await store.createRunRecord({
      run_id: successRunId,
      task_intent_ref: asString(task.intent_id, "task.intent_id"),
      entrypoint_ref: `entrypoint:${asString(task.entrypoint, "task.entrypoint")}`,
      capability_ref: asString(capability.ref, "task.capability.ref"),
      capability_version: asString(capability.version, "task.capability.version"),
      capability_source_ref: asString(capability.source_ref, "task.capability.source_ref"),
      capability_lock_ref: asString(capability.lock_ref, "task.capability.lock_ref"),
      package_ref: asString(result.package_ref, "result.package_ref"),
      admission: {
        decision: "accepted",
        action_risk: asActionRisk(policy.risk, "task.policy.risk"),
        resource_requirement_refs: asStringArray(task.resource_requirement_refs, "task.resource_requirement_refs"),
        runtime_binding_refs: harborRuntimeBindingRefs,
        evidence_refs: [evidenceRef],
        resource_match_ref: "resource-match:fixture/ready"
      }
    });
    assert.equal(created.schema_version, runRecordSchemaVersion);

    await store.updateRunRecord(successRunId, {
      status: "admitted",
      evidence_refs: [evidenceRef]
    });
    await store.updateRunRecord(successRunId, {
      status: "running",
      runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
      evidence_refs: [evidenceRef]
    });
    const completed = await completeRunWithResult(store, successRunId, {
      result_ref: asString(result.result_ref, "result.result_ref"),
      result_kind: asString(result.result_kind, "result.result_kind"),
      data: asObject(result.data, "result.data"),
      projection_ref: asString(result.projection_ref, "result.projection_ref"),
      raw_payload_refs: asStringArray(result.raw_payload_refs, "result.raw_payload_refs"),
      source_refs: asStringArray(result.source_refs, "result.source_refs"),
      evidence_refs: [evidenceRef],
      retention_state: asRetentionState(result.retention_state, "result.retention_state")
    });
    const succeeded = completed.run_record;
    assert.equal(completed.result_envelope.schema_version, resultEnvelopeSchemaVersion);
    assert.equal(completed.result_envelope.ok, true);
    assert.equal(completed.result_envelope.outcome, "success");
    assert.equal(completed.result_envelope.result_ref, result.result_ref);
    assert.equal(succeeded.terminal_at, "2026-07-01T01:00:03.000Z");
    assertRefsOnly(succeeded);
    assert.deepEqual(succeeded, goldenRun, "generated success Run Record must match the golden fixture");
    assert.deepEqual(await store.getRunRecord(successRunId), JSON.parse(await readFile(join(directory, `${successRunId}.json`), "utf8")));

    const failureRunId = asString(failureResult.run_record_ref, "failure result.run_record_ref");
    await store.createRunRecord({
      run_id: failureRunId,
      task_intent_ref: asString(task.intent_id, "task.intent_id"),
      entrypoint_ref: `entrypoint:${asString(task.entrypoint, "task.entrypoint")}`,
      capability_ref: asString(failureResult.capability_ref, "failure result.capability_ref"),
      capability_version: asString(failureResult.capability_version, "failure result.capability_version"),
      capability_source_ref: asString(failureResult.capability_source_ref, "failure result.capability_source_ref"),
      capability_lock_ref: asString(failureResult.capability_lock_ref, "failure result.capability_lock_ref"),
      package_ref: asString(failureResult.package_ref, "failure result.package_ref"),
      admission: {
        decision: "accepted",
        action_risk: asActionRisk(policy.risk, "task.policy.risk"),
        resource_requirement_refs: asStringArray(task.resource_requirement_refs, "task.resource_requirement_refs"),
        runtime_binding_refs: harborRuntimeBindingRefs,
        evidence_refs: asStringArray(failureResult.evidence_refs, "failure result.evidence_refs"),
        resource_match_ref: "resource-match:fixture/ready"
      }
    });
    await store.updateRunRecord(failureRunId, {
      status: "admitted",
      runtime_binding_refs: harborRuntimeBindingRefs,
      evidence_refs: asStringArray(failureResult.evidence_refs, "failure result.evidence_refs")
    });
    await store.updateRunRecord(failureRunId, {
      status: "running",
      runtime_binding_refs: harborRuntimeBindingRefs,
      evidence_refs: asStringArray(failureResult.evidence_refs, "failure result.evidence_refs")
    });
    const failedResult = await completeRunWithFailure(store, failureRunId, {
      failure: failureFromFixture(failureResult.failure),
      evidence_refs: asStringArray(failureResult.evidence_refs, "failure result.evidence_refs"),
      retention_state: asRetentionState(failureResult.retention_state, "failure result.retention_state")
    });
    assert.equal(failedResult.result_envelope.ok, false);
    assert.equal(failedResult.result_envelope.outcome, "failed");
    assert.equal(failedResult.result_envelope.failure?.category, "result_projection");
    assert.equal(failedResult.run_record.failure?.code, "output_invalid");

    const failureAdmission = asObject(admissionFailure.admission, "admission failure fixture.admission");
    const failedRunId = asString(admissionFailure.run_id, "admission failure fixture.run_id");
    await store.createRunRecord({
      run_id: failedRunId,
      task_intent_ref: asString(admissionFailure.task_intent_ref, "admission failure fixture.task_intent_ref"),
      entrypoint_ref: asString(admissionFailure.entrypoint_ref, "admission failure fixture.entrypoint_ref"),
      capability_ref: asString(admissionFailure.capability_ref, "admission failure fixture.capability_ref"),
      capability_version: asString(admissionFailure.capability_version, "admission failure fixture.capability_version"),
      capability_source_ref: asString(admissionFailure.capability_source_ref, "admission failure fixture.capability_source_ref"),
      capability_lock_ref: asString(admissionFailure.capability_lock_ref, "admission failure fixture.capability_lock_ref"),
      package_ref: asString(admissionFailure.package_ref, "admission failure fixture.package_ref"),
      admission: {
        decision: "blocked_pre_admission",
        action_risk: asActionRisk(failureAdmission.action_risk, "admission.action_risk"),
        resource_requirement_refs: asStringArray(failureAdmission.resource_requirement_refs, "admission.resource_requirement_refs"),
        runtime_binding_refs: asStringArray(failureAdmission.runtime_binding_refs, "admission.runtime_binding_refs"),
        evidence_refs: asStringArray(failureAdmission.evidence_refs, "admission.evidence_refs"),
        resource_match_ref: asString(failureAdmission.resource_match_ref, "admission.resource_match_ref")
      }
    });
    const failed = await store.updateRunRecord(failedRunId, {
      status: "failed",
      evidence_refs: asStringArray(admissionFailure.evidence_refs, "admission failure fixture.evidence_refs"),
      failure: failureFromFixture(admissionFailure.failure),
      retention_state: asRetentionState(admissionFailure.retention_state, "admission failure fixture.retention_state")
    });
    assert.equal(failed.failure?.code, "runtime_facts_stale");
    assertRefsOnly(failed);
    assert.deepEqual(
      (await store.listRunRecords()).map((record) => record.run_id),
      [failedRunId, failureRunId, successRunId].sort()
    );
    await assertGoldenFixtureQueries(goldenFixture, goldenRun, directory);
    await assertWriteGuardrailFixtureQueries(guardrailFixture, guardrailRun, directory);
    await assertRealSiteReadOnlyFixtureQueries(realSiteFixtures, directory);
    await assertRealSiteWritePreviewFixtureQueries(realSiteWritePreviewFixtures, directory);
    return 8;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const contracts = await assertLocalSchemaFixtures();
const runRecordCount = await assertRunRecordStoreConformance();

console.log(`Validated conformance fixtures with ${contracts.schemaCount} schemas, ${contracts.fixtureCount} fixtures, and ${runRecordCount} Run Records.`);
