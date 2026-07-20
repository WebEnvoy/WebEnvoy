import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { normalizePublicHttpTarget, normalizePublicOrigin, normalizeStoredTargetRef } from "@webenvoy/core-runtime";

type JsonObject = Record<string, unknown>;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaDir = join(packageRoot, "schemas");
const fixtureDir = join(packageRoot, "fixtures");
const invalidFixtureDir = join(packageRoot, "invalid-fixtures");

function isPublicHttpTarget(value: string): boolean {
  return normalizePublicHttpTarget(value).ok;
}

function isPublicOrigin(value: string): boolean {
  return normalizePublicOrigin(value) !== undefined;
}

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
  for (const [index, entry] of value.entries()) {
    asString(entry, `${label}[${index}]`);
  }
  return value as string[];
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

const schemaFiles = await jsonFiles(schemaDir);
const fixtureFiles = await jsonFiles(fixtureDir);
const invalidFixtureFiles = await jsonFiles(invalidFixtureDir);

assert(schemaFiles.length > 0, "at least one schema is required");
assert(fixtureFiles.length > 0, "at least one fixture is required");

const schemasByFile = new Map<string, JsonObject>();
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);
ajv.addKeyword({ keyword: "x-webenvoy" });
ajv.addFormat("webenvoy-public-http-target", { type: "string", validate: isPublicHttpTarget });
ajv.addFormat("webenvoy-public-origin", { type: "string", validate: isPublicOrigin });
ajv.addFormat("webenvoy-stored-target-ref", {
  type: "string",
  validate: (value: string) => normalizeStoredTargetRef(value) === value
});
ajv.addFormat("webenvoy-xhs-detail-ref", {
  type: "string",
  validate: /^detail_ref_[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/
});

function localRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localRefs);
  if (!value || typeof value !== "object") return [];
  const object = value as JsonObject;
  return [
    ...(typeof object.$ref === "string" && !object.$ref.startsWith("#") ? [object.$ref] : []),
    ...Object.values(object).flatMap(localRefs)
  ];
}

for (const file of schemaFiles) {
  const schema = await readJson(file);
  schemasByFile.set(basename(file), schema);

  asString(schema.$schema, `${file}.$schema`);
  asString(schema.$id, `${file}.$id`);
  const metadata = asObject(schema["x-webenvoy"], `${file}.x-webenvoy`);
  asString(metadata.owner, `${file}.x-webenvoy.owner`);
  asString(metadata.status, `${file}.x-webenvoy.status`);
  asString(metadata.compatibility_boundary, `${file}.x-webenvoy.compatibility_boundary`);
  asString(metadata.schema_version, `${file}.x-webenvoy.schema_version`);
  asStringArray(metadata.source_adrs, `${file}.x-webenvoy.source_adrs`);
  ajv.addSchema(schema);
  const schemaId = asString(schema.$id, `${file}.$id`);
  const filenameAlias = new URL(basename(file), schemaId).href;
  if (filenameAlias !== schemaId) ajv.addSchema({ $ref: schemaId }, filenameAlias);
}

const taskThreadSchemaFile = "task-thread.schema.json";
const taskThreadSchema = schemasByFile.get(taskThreadSchemaFile);
assert(taskThreadSchema, `${taskThreadSchemaFile} must exist`);
const taskThreadSchemaId = asString(taskThreadSchema.$id, `${taskThreadSchemaFile}.$id`);
for (const ref of localRefs(taskThreadSchema)) {
  const resolvedRef = new URL(ref, taskThreadSchemaId).href;
  const target = [...schemasByFile.values()].find((schema) => schema.$id === resolvedRef);
  assert(target, `${taskThreadSchemaFile} reference ${ref} must resolve to a local schema $id`);
}

for (const file of fixtureFiles) {
  const fixture = await readJson(file);
  const schemaRef = asString(fixture.$schema, `${file}.$schema`);
  const schema = schemasByFile.get(basename(schemaRef));
  assert(schema, `${file} must reference a local schema file`);

  const fixtureVersion = asString(fixture.schema_version, `${file}.schema_version`);
  const schemaVersion = asString(asObject(schema["x-webenvoy"], `${schemaRef}.x-webenvoy`).schema_version, `${schemaRef}.schema_version`);
  assert.equal(fixtureVersion, schemaVersion, `${file} schema_version must match ${schemaRef}`);

  const validate = ajv.getSchema(asString(schema.$id, `${schemaRef}.$id`));
  assert(validate, `${schemaRef} must compile as Draft 2020-12 JSON Schema`);
  const { $schema: _fixtureSchemaRef, ...instance } = fixture;
  assert(validate(instance), `${file} must satisfy ${schemaRef}: ${ajv.errorsText(validate.errors)}`);
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

const executionPolicySchemaPath = join(schemaDir, "execution-policy-evaluation.schema.json");
const executionPolicyFixturePath = join(fixtureDir, "execution-policy-destructive-auto.fixture.json");
const executionPolicySchema = schemasByFile.get(basename(executionPolicySchemaPath));
assert(executionPolicySchema, "execution policy schema must exist");
const validateExecutionPolicy = ajv.getSchema(asString(executionPolicySchema.$id, "execution policy schema $id"));
assert(validateExecutionPolicy, "execution policy schema must compile as Draft 2020-12 JSON Schema");
const { $schema: _executionPolicySchemaRef, ...executionPolicyFixture } = await readJson(executionPolicyFixturePath);
const confirm = structuredClone(executionPolicyFixture);
const action = asObject(confirm.action, "execution policy fixture action");
const effectivePolicy = asObject(confirm.effective_policy, "execution policy fixture effective_policy");
effectivePolicy.mode = "confirm";
confirm.next_step = "request_confirmation";
confirm.confirmation_request = {
  scope: "current_action",
  action_instance_ref: action.action_instance_ref,
  action_id: action.action_id,
  target: action.target,
  category: action.category,
  owner_matcher: action.owner_matcher,
  owner_declaration_ref: action.owner_declaration_ref,
  owner_declaration_version: action.owner_declaration_version,
  resource_match_ref: action.resource_match_ref,
  resource_match_version: action.resource_match_version,
  effective_policy_source_ref: effectivePolicy.source_ref,
  effective_policy_source_version: effectivePolicy.source_version,
  effective_policy_source: effectivePolicy.source,
  choices: ["allow_once", "deny_once"]
};
assert(validateExecutionPolicy(confirm), `confirm execution policy must validate: ${ajv.errorsText(validateExecutionPolicy.errors)}`);
assert(validateExecutionPolicy({
  schema_version: "webenvoy.execution-policy-evaluation.v0",
  status: "stopped",
  next_step: "stop",
  stop_reason: "invalid_input"
}), `stopped execution policy must validate: ${ajv.errorsText(validateExecutionPolicy.errors)}`);
delete confirm.confirmation_request;
assert.equal(validateExecutionPolicy(confirm), false, "confirm execution policy without confirmation_request must be rejected");

console.log(`Validated ${schemaFiles.length} schemas, ${fixtureFiles.length} positive fixtures, and ${invalidFixtureFiles.length} negative fixture sets.`);
