import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import * as addFormatsModule from "ajv-formats";
import {
  authorizationDecisionTimeOrderValid,
  normalizeNonSensitiveText,
  normalizeAuthorizationDecisionSummary,
  normalizePublicHttpTarget,
  normalizePublicOrigin,
  normalizeStoredTargetRef
} from "@webenvoy/core-runtime";

type JsonObject = Record<string, unknown>;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaDir = join(packageRoot, "schemas");
const fixtureDir = join(packageRoot, "fixtures");
const invalidFixtureDir = join(packageRoot, "invalid-fixtures");
const executionPolicyInvalidFixtureDir = join(packageRoot, "fixtures-invalid");

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
  for (const [index, entry] of value.entries()) asString(entry, `${label}[${index}]`);
  return value as string[];
}

async function readJson(path: string): Promise<JsonObject> {
  return asObject(JSON.parse(await readFile(path, "utf8")), path);
}

async function jsonFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort().map((entry) => join(dir, entry));
}

function localRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localRefs);
  if (!value || typeof value !== "object") return [];
  const object = value as JsonObject;
  return [
    ...(typeof object.$ref === "string" && !object.$ref.startsWith("#") ? [object.$ref] : []),
    ...Object.values(object).flatMap(localRefs)
  ];
}

function assertValid(validate: ValidateFunction, value: unknown, label: string): void {
  assert(validate(value), `${label} failed Draft 2020-12 validation: ${JSON.stringify(validate.errors)}`);
}

function assertObservationTargetShape(value: JsonObject, label: string): void {
  if (value.schema_version !== "harbor-observation-targets/v1") return;
  const coverage = asObject(value.coverage, `${label}.coverage`);
  const controlCoverage = asObject(coverage.controls, `${label}.coverage.controls`);
  const continuation = asObject(value.continuation, `${label}.continuation`);
  const controls = value.controls;
  assert(Array.isArray(controls), `${label}.controls must be an array`);
  assert.equal(controls.length, continuation.returned_count, `${label}.controls.length must equal continuation.returned_count`);
  const offset = continuation.offset as number;
  const returnedCount = continuation.returned_count as number;
  const returnedThrough = controlCoverage.returned_through as number;
  const capturedCount = controlCoverage.captured_count as number;
  assert.equal(offset + returnedCount, returnedThrough, `${label}.returned_through must equal offset + returned_count`);
  assert(returnedThrough <= capturedCount, `${label}.returned_through must not exceed captured_count`);
  assert.equal(controlCoverage.complete, controlCoverage.enumeration_complete && controlCoverage.returned_through === controlCoverage.captured_count, `${label}.complete must reflect enumeration and returned coverage`);
  if (controlCoverage.enumeration_complete) assert.equal(controlCoverage.total, controlCoverage.captured_count, `${label}.total must equal captured_count when enumeration is complete`);
  else assert.equal(controlCoverage.total, null, `${label}.total must be null when enumeration is incomplete`);
  if (continuation.has_more) assert.equal(typeof continuation.next_cursor, "string", `${label}.next_cursor required when has_more`);
  else assert.equal(continuation.next_cursor, null, `${label}.next_cursor must be null at the end`);
  assert.equal(continuation.has_more, returnedThrough < capturedCount, `${label}.has_more must reflect remaining captured controls`);
  if (continuation.has_more) assert(returnedCount > 0, `${label}.a continued segment must make progress`);
  const textCoverage = asObject(coverage.text, `${label}.coverage.text`);
  assert.equal(textCoverage.returned_bytes, Buffer.byteLength(String(value.text), "utf8"), `${label}.text returned_bytes must match UTF-8 text`);
  if (offset > 0) {
    assert.equal(value.text, "", `${label}.continuation must omit text`);
    assert.equal(textCoverage.state, "omitted_on_continuation", `${label}.continuation text state must be omitted_on_continuation`);
  }
}

function observationTargetShapeValid(value: unknown): boolean {
  try {
    assertObservationTargetShape(asObject(value, "observation target"), "observation target");
    return true;
  } catch {
    return false;
  }
}

const schemaFiles = await jsonFiles(schemaDir);
const fixtureFiles = await jsonFiles(fixtureDir);
const invalidFixtureFiles = await jsonFiles(invalidFixtureDir);
const executionPolicyInvalidFixtureFiles = await jsonFiles(executionPolicyInvalidFixtureDir);
assert(schemaFiles.length > 0, "at least one schema is required");
assert(fixtureFiles.length > 0, "at least one fixture is required");
assert(invalidFixtureFiles.length > 0, "at least one invalid fixture set is required");
assert(executionPolicyInvalidFixtureFiles.length > 0, "at least one execution policy invalid fixture is required");

const schemasByFile = new Map<string, JsonObject>();
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);
ajv.addKeyword({ keyword: "x-webenvoy" });
ajv.addKeyword({
  keyword: "x-webenvoy-authorization-time-order",
  type: "object",
  schemaType: "boolean",
  validate: (enabled: boolean, value: unknown) => !enabled || authorizationDecisionTimeOrderValid(value)
});
ajv.addKeyword({
  keyword: "x-webenvoy-observation-targets",
  type: "object",
  schemaType: "boolean",
  validate: (enabled: boolean, value: unknown) => !enabled || observationTargetShapeValid(value)
});
ajv.addKeyword({
  keyword: "x-webenvoy-inline-json-max-bytes",
  type: "object",
  schemaType: "number",
  validate: (maxBytes: number, value: unknown) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return false;
    const input = value as JsonObject;
    if (input.carrier !== "webenvoy.managed-task-inline/v1") return true;
    try {
      const serialized = JSON.stringify(input.value);
      return serialized !== undefined && Buffer.byteLength(serialized, "utf8") <= maxBytes;
    } catch {
      return false;
    }
  }
});
ajv.addFormat("webenvoy-public-http-target", { type: "string", validate: (value: string) => normalizePublicHttpTarget(value).ok });
ajv.addFormat("webenvoy-public-origin", { type: "string", validate: (value: string) => normalizePublicOrigin(value) !== undefined });
ajv.addFormat("webenvoy-stored-target-ref", { type: "string", validate: (value: string) => normalizeStoredTargetRef(value) === value });
ajv.addFormat("webenvoy-nonsensitive-text", { type: "string", validate: (value: string) => normalizeNonSensitiveText(value, 512) === value });
ajv.addFormat("webenvoy-xhs-detail-ref", {
  type: "string",
  validate: /^detail_ref_[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/
});

for (const file of schemaFiles) {
  const schema = await readJson(file);
  schemasByFile.set(basename(file), schema);
  asString(schema.$schema, `${file}.$schema`);
  const schemaId = asString(schema.$id, `${file}.$id`);
  const metadata = asObject(schema["x-webenvoy"], `${file}.x-webenvoy`);
  asString(metadata.owner, `${file}.x-webenvoy.owner`);
  asString(metadata.status, `${file}.x-webenvoy.status`);
  asString(metadata.compatibility_boundary, `${file}.x-webenvoy.compatibility_boundary`);
  asString(metadata.schema_version, `${file}.x-webenvoy.schema_version`);
  asStringArray(metadata.source_adrs, `${file}.x-webenvoy.source_adrs`);
  ajv.addSchema(schema);
  const filenameAlias = new URL(basename(file), schemaId).href;
  if (filenameAlias !== schemaId) ajv.addSchema({ $ref: schemaId }, filenameAlias);
}

const taskThreadSchemaFile = "task-thread.schema.json";
const taskThreadSchema = schemasByFile.get(taskThreadSchemaFile);
assert(taskThreadSchema, `${taskThreadSchemaFile} must exist`);
const taskThreadSchemaId = asString(taskThreadSchema.$id, `${taskThreadSchemaFile}.$id`);
for (const ref of localRefs(taskThreadSchema)) {
  const resolvedRef = new URL(ref, taskThreadSchemaId).href;
  assert([...schemasByFile.values()].some((schema) => schema.$id === resolvedRef), `${taskThreadSchemaFile} reference ${ref} must resolve locally`);
}

for (const file of fixtureFiles) {
  const fixture = await readJson(file);
  const schemaRef = asString(fixture.$schema, `${file}.$schema`);
  const schema = schemasByFile.get(basename(schemaRef));
  assert(schema, `${file} must reference a local schema file`);
  const metadata = asObject(schema["x-webenvoy"], `${schemaRef}.x-webenvoy`);
  if (fixture.schema_version !== undefined) assert.equal(asString(fixture.schema_version, `${file}.schema_version`), asString(metadata.schema_version, `${schemaRef}.schema_version`));
  const validate = ajv.getSchema(asString(schema.$id, `${schemaRef}.$id`));
  assert(validate, `${schemaRef} must compile as Draft 2020-12 JSON Schema`);
  const { $schema: _fixtureSchemaRef, ...instance } = fixture;
  assertValid(validate, instance, file);
  assertObservationTargetShape(instance, file);
}

const managedTaskRequestSchema = schemasByFile.get("managed-task-operation-request.schema.json");
assert(managedTaskRequestSchema, "managed task request schema must exist");
const validateManagedTaskRequest = ajv.getSchema(asString(managedTaskRequestSchema.$id, "managed task request schema.$id"));
assert(validateManagedTaskRequest, "managed task request validator must compile");
const managedTaskRequest = await readJson(join(fixtureDir, "managed-task-operation-request.fixture.json"));
const managedTaskInput = asObject(managedTaskRequest.input, "managed task input");
managedTaskRequest.schema_version = "webenvoy.managed-task-operation/v1";
managedTaskInput.carrier = "webenvoy.managed-task-inline/v1";
managedTaskInput.value = "a".repeat(65534);
delete managedTaskRequest.$schema;
assertValid(validateManagedTaskRequest, managedTaskRequest, "inline managed task value at byte limit");
managedTaskInput.value = "a".repeat(65535);
assert.equal(validateManagedTaskRequest(managedTaskRequest), false, "inline managed task value over byte limit must be rejected");

const managedTaskResultSchema = schemasByFile.get("managed-task-operation-result.schema.json");
assert(managedTaskResultSchema, "managed task result schema must exist");
const validateManagedTaskResult = ajv.getSchema(asString(managedTaskResultSchema.$id, "managed task result schema.$id"));
assert(validateManagedTaskResult, "managed task result validator must compile");
const workerTicket = {
  ticket_id: "worker-ticket-001", run_id: "managed-task-run-001",
  package: { package_ref: "lode://site-skill/github/trending", revision_ref: "lode://site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433",
    package_digest: `sha256:${"a".repeat(64)}`, task_ref: "read-daily-trending-top5", source_ref: "lode://source/site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433",
    lock_ref: "lode://lock/site-skill/github/trending@1.0.0", capability_ref: "lode:capability/managed-page-snapshot", capability_version: "1.0.0",
    source_admission_ref: `webenvoy.source-admission/site-skill-package/v1#sha256:${"b".repeat(64)}`,
    code_admission_ref: `webenvoy.code-admission/site-skill-script/v1#sha256:${"c".repeat(64)}` },
  script: { script_ref: "lode://script/site-skill/github/trending/read-daily-top5@1.0.0", script_version: "1.0.0", script_sha256: `sha256:${"d".repeat(64)}`,
    runtime_kind: "webenvoy.site-skill-script-abi/v1", entrypoint: "run", broker: "webenvoy.site-skill-broker/v1",
    broker_capabilities: ["runtime.invoke", "output.write"], source: "export async function run(input, broker, context) {}" },
  authorization: { principal_id: "principal:agent", connection_id: "connection:agent", grant_id: "grant:site", profile_ref: "profile:default", origin: "https://github.com" },
  target: { target_type: "web_page", target_ref: "github-trending-current" },
  input: { schema_ref: "lode://schema/site-skill/github/trending/daily-top5/input@1.0.0", value: {} },
  context: { run_id: "managed-task-run-001", task_ref: "read-daily-trending-top5" }, deadline_at: Date.now() + 10_000
};
const managedTaskResult = {
  ok: true, schema_version: "webenvoy.managed-task-operation-result/v1", operation: "task.submit", operation_ref: "managed-task-run-001",
  run: { run_id: "managed-task-run-001", task_intent_ref: "intent:site-task", package_ref: "lode://site-skill/github/trending", status: "running", dispatch_state: "not_dispatched" },
  input: { schema_ref: "lode://schema/site-skill/github/trending/daily-top5/input@1.0.0", carrier: "none", value_present: false },
  result: null, failure: null, worker_execution: { ticket: workerTicket }
};
assertValid(validateManagedTaskResult, managedTaskResult, "one-time managed worker ticket in a prepared task result");
managedTaskResult.operation = "task.query";
assert.equal(validateManagedTaskResult(managedTaskResult), false, "worker tickets are only valid on task.submit responses");
managedTaskResult.operation = "task.submit";
(managedTaskResult.worker_execution.ticket.script as JsonObject).source = "x".repeat(65_537);
assert.equal(validateManagedTaskResult(managedTaskResult), false, "worker source is bounded by the response contract");

const validateTaskThread = ajv.getSchema(taskThreadSchemaId);
assert(validateTaskThread, `${taskThreadSchemaFile} must compile as Draft 2020-12 JSON Schema`);
const taskThreadFixture = await readJson(join(fixtureDir, "task-thread.fixture.json"));
delete taskThreadFixture.$schema;
const legacyDefinitionTaskThread = structuredClone(taskThreadFixture);
const legacyDefinitionTurn = asObject((legacyDefinitionTaskThread.turns as unknown[])[0], "legacy task thread turn");
delete legacyDefinitionTurn.package_ref;
delete legacyDefinitionTurn.input_schema_ref;
assertValid(validateTaskThread, legacyDefinitionTaskThread, "legacy task thread without definition refs");
for (const missingRef of ["package_ref", "input_schema_ref"] as const) {
  const partialDefinitionTaskThread = structuredClone(taskThreadFixture);
  delete asObject((partialDefinitionTaskThread.turns as unknown[])[0], "partial task thread turn")[missingRef];
  assert.equal(validateTaskThread(partialDefinitionTaskThread), false, `task thread must reject a lone ${missingRef}`);
}
const legacyTaskThread = structuredClone(taskThreadFixture);
legacyTaskThread.identity_environment_ref = "identity-env:xhs-brand";
assertValid(validateTaskThread, legacyTaskThread, "legacy task thread identity ref");
for (const identityEnvironmentRef of ["identity-env:xhs:brand", "identity-env:fixture/real-query:execution"]) {
  const compatibleTaskThread = structuredClone(taskThreadFixture);
  compatibleTaskThread.identity_environment_ref = identityEnvironmentRef;
  assertValid(validateTaskThread, compatibleTaskThread, `legacy task thread identity ref ${identityEnvironmentRef}`);
}
for (const identityEnvironmentRef of [
  "identity-env_deadbeef",
  "identity-env_0123456789abcdef0123456g",
  "harbor://identity-environment/xhs-brand",
  "https://example.test/identity/xhs-brand",
  "identity-env:https://example.test/identity/xhs-brand",
  "identity-env:foo/https://example.test/private",
  "identity-env:user:password",
  "identity-env:foo/user:password",
  "identity-env:credential-reference",
  "identity-env:cookie-reference",
  "identity-env:Mixed-SeCrEt-reference",
  "identity-env:token-secret",
  "identity-env_token-secret",
  `identity-env:${"a".repeat(2032)}`
]) {
  const invalidTaskThread = structuredClone(taskThreadFixture);
  invalidTaskThread.identity_environment_ref = identityEnvironmentRef;
  assert.equal(validateTaskThread(invalidTaskThread), false, `task thread must reject identity ref ${identityEnvironmentRef.slice(0, 80)}`);
}

for (const file of invalidFixtureFiles) {
  const fixtureSet = await readJson(file);
  const schemaFile = asString(fixtureSet.schema, `${file}.schema`);
  const schema = schemasByFile.get(schemaFile);
  assert(schema, `${file} must reference a local schema file`);
  const validate = ajv.getSchema(asString(schema.$id, `${schemaFile}.$id`));
  assert(validate, `${schemaFile} must compile as Draft 2020-12 JSON Schema`);
  assert(Array.isArray(fixtureSet.cases) && fixtureSet.cases.length > 0, `${file}.cases must be non-empty`);
  for (const [index, entry] of fixtureSet.cases.entries()) {
    const invalidCase = asObject(entry, `${file}.cases[${index}]`);
    const name = asString(invalidCase.name, `${file}.cases[${index}].name`);
    assert.equal(validate(invalidCase.instance), false, `${file} case ${name} must be rejected`);
  }
}

const executionPolicySchema = schemasByFile.get("execution-policy-evaluation.schema.json");
assert(executionPolicySchema, "execution policy schema must exist");
const validateExecutionPolicy = ajv.getSchema(asString(executionPolicySchema.$id, "execution policy schema.$id"));
assert(validateExecutionPolicy, "execution policy validator must compile");
const oversizedExecutionPolicy = await readJson(join(fixtureDir, "execution-policy-destructive-auto.fixture.json"));
asObject(oversizedExecutionPolicy.effective_policy, "execution policy effective_policy").source_ref = "x".repeat(513);
assert.equal(validateExecutionPolicy(oversizedExecutionPolicy), false, "execution policy refs over 512 characters must be rejected");
const sensitiveVersionExecutionPolicy = await readJson(join(fixtureDir, "execution-policy-destructive-auto.fixture.json"));
asObject(sensitiveVersionExecutionPolicy.effective_policy, "execution policy effective_policy").source_version = "credential-secret";
assert.equal(validateExecutionPolicy(sensitiveVersionExecutionPolicy), false, "execution policy sensitive versions must be rejected");
const sensitiveTargetExecutionPolicy = await readJson(join(fixtureDir, "execution-policy-destructive-auto.fixture.json"));
asObject(asObject(sensitiveTargetExecutionPolicy.action, "execution policy action").target, "execution policy target").target_type = "secret";
assert.equal(validateExecutionPolicy(sensitiveTargetExecutionPolicy), false, "execution policy sensitive target fields must be rejected");
for (const file of executionPolicyInvalidFixtureFiles) {
  assert.equal(validateExecutionPolicy(await readJson(file)), false, `${file} must fail Draft 2020-12 validation`);
}

const authorizationDecisionSchema = schemasByFile.get("authorization-decision.schema.json");
assert(authorizationDecisionSchema, "authorization decision schema must exist");
const validateAuthorizationDecision = ajv.getSchema(asString(authorizationDecisionSchema.$id, "authorization decision schema.$id"));
assert(validateAuthorizationDecision, "authorization decision validator must compile");
const authorizationFixture = await readJson(join(fixtureDir, "authorization-decision.fixture.json"));
delete authorizationFixture.$schema;
assert.deepEqual(normalizeAuthorizationDecisionSummary(authorizationFixture), authorizationFixture);
function runtimeAcceptsAuthorizationDecision(value: unknown): boolean {
  try {
    normalizeAuthorizationDecisionSummary(value);
    return true;
  } catch {
    return false;
  }
}
for (const mutate of [
  (value: JsonObject) => { value.raw_dom = "forbidden"; },
  (value: JsonObject) => { asObject(asObject(value.business_action, "action").target, "target").target_ref = "https://user:password@example.test/private"; },
  (value: JsonObject) => { asObject(value.applicability, "applicability").config_refs = ["a", "b"]; },
  (value: JsonObject) => {
    value.outcome = "stop";
    value.reason = { kind: "system_stop", code: "target_mismatch" };
  },
  (value: JsonObject) => { value.owner_declaration = null; },
  (value: JsonObject) => { asObject(value.business_action, "action").category = null; },
  (value: JsonObject) => { asObject(value.applicability, "applicability").config_refs = []; },
  (value: JsonObject) => {
    value.effective_policy = null;
    value.outcome = "stop";
    value.reason = { kind: "system_stop", code: "policy_unavailable" };
  },
  (value: JsonObject) => {
    value.state = "consumed";
    value.invalidation_reason = null;
  },
  (value: JsonObject) => { value.decided_at = "2026-07-21T00:00:00.0001Z"; },
  (value: JsonObject) => { value.decided_at = "2026-12-31T23:59:60Z"; },
  (value: JsonObject) => { value.decided_at = "0000-07-21T00:00:00Z"; },
  (value: JsonObject) => { value.expires_at = value.decided_at; },
  (value: JsonObject) => { value.expires_at = "2026-07-21T01:00:00.000+02:00"; },
  (value: JsonObject) => { asObject(value.business_action, "action").action_id = "token"; },
  (value: JsonObject) => {
    value.state = "invalidated";
    value.invalidated_at = "2026-07-20T23:59:59.999Z";
    value.invalidation_reason = "cancelled";
  },
  (value: JsonObject) => {
    value.expires_at = "2026-07-21T00:10:00.000Z";
    value.state = "invalidated";
    value.invalidated_at = "2026-07-21T00:11:00.000Z";
    value.invalidation_reason = "cancelled";
  },
  (value: JsonObject) => { asObject(value.effective_policy, "effective policy").source_ref = "duplicate:policy/ref"; },
  (value: JsonObject) => { value.consumer_boundary = "different boundary"; }
]) {
  const invalid = structuredClone(authorizationFixture);
  mutate(invalid);
  const schemaAccepts: boolean = Boolean(validateAuthorizationDecision(invalid));
  assert.equal(schemaAccepts, runtimeAcceptsAuthorizationDecision(invalid), "schema and runtime acceptance must match");
  assert.equal(schemaAccepts, false, "invalid authorization decision must be rejected");
}
for (const mutate of [
  (value: JsonObject) => { value.expires_at = "2026-07-21T02:00:00.000+01:00"; },
  (value: JsonObject) => {
    value.state = "consumed";
    value.invalidated_at = value.decided_at;
    value.invalidation_reason = "completed";
  }
]) {
  const valid = structuredClone(authorizationFixture);
  mutate(valid);
  const schemaAccepts: boolean = Boolean(validateAuthorizationDecision(valid));
  assert.equal(schemaAccepts, runtimeAcceptsAuthorizationDecision(valid), "schema and runtime acceptance must match");
  assert.equal(schemaAccepts, true, "valid authorization decision must be accepted");
}
for (const [state, reason, expected] of [
  ["active", null, true],
  ["active", "cancelled", false],
  ["consumed", "completed", true],
  ["consumed", "expired", false],
  ["expired", "expired", true],
  ["expired", "completed", false],
  ["invalidated", "cancelled", true],
  ["invalidated", "effective_policy_changed", true],
  ["invalidated", "completed", false],
  ["invalidated", "expired", false]
] as const) {
  const lifecycle = structuredClone(authorizationFixture);
  lifecycle.state = state;
  lifecycle.invalidated_at = state === "active" ? null : lifecycle.decided_at;
  lifecycle.invalidation_reason = reason;
  const schemaAccepts: boolean = Boolean(validateAuthorizationDecision(lifecycle));
  assert.equal(schemaAccepts, runtimeAcceptsAuthorizationDecision(lifecycle), "schema and runtime lifecycle acceptance must match");
  assert.equal(schemaAccepts, expected, `${state}/${reason ?? "none"} lifecycle acceptance must match the contract`);
}

type CorePolicyModule = { evaluateExecutionPolicy(input: unknown): JsonObject };
type CoreOwnerProofModule = { matchLodeBusinessActionOwner(owner: unknown, actionId: string, resourceMatch: unknown): unknown };
const coreModuleUrl = pathToFileURL(join(packageRoot, "..", "core", "dist", "execution-policy.js")).href;
const core = await import(coreModuleUrl) as CorePolicyModule;
const ownerProofModuleUrl = pathToFileURL(join(packageRoot, "..", "core", "dist", "execution-policy-owner-proof.js")).href;
const ownerProof = await import(ownerProofModuleUrl) as CoreOwnerProofModule;

function ownerContract(category: "commit" | "destructive"): JsonObject {
  const actionId = category === "destructive" ? "xhs_delete_note" : "xhs_publish_note";
  return {
    package_ref: `lode://site-capability/xiaohongshu/${category === "destructive" ? "delete-note" : "publish-note"}@1.0.0`,
    version: "1.0.0",
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: actionId,
        category,
        target_scope: { site_slug: "xiaohongshu", target_types: ["creator_publish_page"], supported_origins: ["https://creator.xiaohongshu.com/path"] },
        resource_requirements: { path: "resource-requirements.json", id: `xiaohongshu.${actionId}.resources`, profile_ids: ["creator-page"] },
        external_effects: [category === "destructive" ? "delete" : "submit"]
      }]
    }
  };
}

function evaluatorInput(category: "commit" | "destructive", mode: "auto" | "confirm"): JsonObject {
  const contract = ownerContract(category);
  const actionId = category === "destructive" ? "xhs_delete_note" : "xhs_publish_note";
  const requirementRef = `xiaohongshu.${actionId}.resources`;
  const proof = ownerProof.matchLodeBusinessActionOwner(contract, actionId, {
    schema_version: "webenvoy.harbor-resource-match.v0",
    match_ref: `resource-match:${actionId}/1`,
    match_version: "1",
    matched_requirement_refs: [requirementRef]
  });
  assert(proof, "real evaluator owner proof must be created");
  return {
    caller: "api",
    evaluated_at: "2026-07-21T00:00:00.000Z",
    action: {
      action_instance_ref: `action-instance:${actionId}/1`,
      action_id: actionId,
      target: {
        target_ref: `target:${actionId}/1`,
        target_type: "creator_publish_page",
        site_slug: "xiaohongshu",
        origin: "https://creator.xiaohongshu.com/path?must-not-echo=true"
      }
    },
    owner_proof: proof,
    context: {},
    policies: { global_user_config: { source_ref: "policy:global/1", source_version: "1", modes: { [category]: mode } } }
  };
}

const destructiveAuto = core.evaluateExecutionPolicy(evaluatorInput("destructive", "auto"));
const confirmInput = evaluatorInput("commit", "confirm");
const confirmation = core.evaluateExecutionPolicy(confirmInput);
const confirmationRequest = asObject(confirmation.confirmation_request, "real confirmation request");
const singleInput = {
  ...confirmInput,
  policies: {
    ...asObject(confirmInput.policies, "confirm policies"),
    single_action_decision: {
      source_ref: "decision:once/1",
      source_version: "1",
      action_instance_ref: confirmationRequest.action_instance_ref,
      action_id: confirmationRequest.action_id,
      category: confirmationRequest.category,
      target: confirmationRequest.target,
      owner_matcher: confirmationRequest.owner_matcher,
      owner_declaration_ref: confirmationRequest.owner_declaration_ref,
      owner_declaration_version: confirmationRequest.owner_declaration_version,
      resource_match_ref: confirmationRequest.resource_match_ref,
      resource_match_version: confirmationRequest.resource_match_version,
      effective_policy_source_ref: confirmationRequest.effective_policy_source_ref,
      effective_policy_source_version: confirmationRequest.effective_policy_source_version,
      effective_policy_source: confirmationRequest.effective_policy_source,
      mode: "auto",
      state: "active",
      issued_at: "2026-07-20T23:59:59.999Z",
      expires_at: "2026-07-21T00:00:00.001Z"
    }
  }
};
const singleActionAuto = core.evaluateExecutionPolicy(singleInput);
const invalidInput = core.evaluateExecutionPolicy({});
for (const [label, output] of [["destructive auto", destructiveAuto], ["confirmation", confirmation], ["single action auto", singleActionAuto], ["invalid input", invalidInput]] as const) {
  assertValid(validateExecutionPolicy, output, `real evaluator ${label} output`);
}
assert.equal(JSON.stringify(confirmation).includes("must-not-echo"), false);

console.log(`Validated ${schemaFiles.length} schemas, ${fixtureFiles.length} positive fixtures, ${invalidFixtureFiles.length} negative fixture sets, and ${executionPolicyInvalidFixtureFiles.length} execution policy negative fixtures.`);
console.log("Validated 4 real execution policy evaluator outputs against the declared Draft 2020-12 schema.");
