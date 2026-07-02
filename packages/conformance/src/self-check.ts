import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFileRunRecordStore,
  runRecordSchemaVersion,
  type AdmissionDecision,
  type FailureRecord,
  type RetentionState,
  type RunRecord
} from "@webenvoy/core-runtime";

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

async function assertRunRecordStoreConformance(): Promise<number> {
  const task = await readFixture("read-only-submit.fixture.json");
  const result = await readFixture("result-envelope-success.fixture.json");
  const evidence = await readFixture("evidence-ref-redacted.fixture.json");
  const admissionFailure = await readFixture("admission-failure-run-record.fixture.json");
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-conformance-"));

  try {
    const store = createFileRunRecordStore({ directory, clock: nextInstant });
    const capability = asObject(task.capability, "read-only task capability");
    const policy = asObject(task.policy, "read-only task policy");
    const successRunId = asString(result.run_record_ref, "result.run_record_ref");
    const evidenceRef = asString(evidence.ref, "evidence.ref");
    assert(asStringArray(result.evidence_refs, "result.evidence_refs").includes(evidenceRef), "result fixture must reference the evidence fixture");

    const created = await store.createRunRecord({
      run_id: successRunId,
      task_intent_ref: asString(task.intent_id, "task.intent_id"),
      entrypoint_ref: `entrypoint:${asString(task.entrypoint, "task.entrypoint")}`,
      capability_ref: asString(capability.ref, "task.capability.ref"),
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
    const succeeded = await store.updateRunRecord(successRunId, {
      status: "succeeded",
      result_ref: asString(result.result_ref, "result.result_ref"),
      evidence_refs: [evidenceRef],
      retention_state: asRetentionState(result.retention_state, "result.retention_state")
    });
    assert.equal(succeeded.terminal_at, "2026-07-01T01:00:03.000Z");
    assertRefsOnly(succeeded);
    assert.deepEqual(await store.getRunRecord(successRunId), JSON.parse(await readFile(join(directory, `${successRunId}.json`), "utf8")));

    const failureAdmission = asObject(admissionFailure.admission, "admission failure fixture.admission");
    const failedRunId = asString(admissionFailure.run_id, "admission failure fixture.run_id");
    await store.createRunRecord({
      run_id: failedRunId,
      task_intent_ref: asString(admissionFailure.task_intent_ref, "admission failure fixture.task_intent_ref"),
      entrypoint_ref: asString(admissionFailure.entrypoint_ref, "admission failure fixture.entrypoint_ref"),
      capability_ref: asString(admissionFailure.capability_ref, "admission failure fixture.capability_ref"),
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
      [failedRunId, successRunId].sort()
    );
    return 2;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const contracts = await assertLocalSchemaFixtures();
const runRecordCount = await assertRunRecordStoreConformance();

console.log(`Validated conformance fixtures with ${contracts.schemaCount} schemas, ${contracts.fixtureCount} fixtures, and ${runRecordCount} Run Records.`);
