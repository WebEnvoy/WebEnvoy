import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import * as addFormatsModule from "ajv-formats";
import {
  normalizeNonSensitiveText,
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
  const fixtureVersion = asString(fixture.schema_version, `${file}.schema_version`);
  const metadata = asObject(schema["x-webenvoy"], `${schemaRef}.x-webenvoy`);
  assert.equal(fixtureVersion, asString(metadata.schema_version, `${schemaRef}.schema_version`));
  const validate = ajv.getSchema(asString(schema.$id, `${schemaRef}.$id`));
  assert(validate, `${schemaRef} must compile as Draft 2020-12 JSON Schema`);
  const { $schema: _fixtureSchemaRef, ...instance } = fixture;
  assertValid(validate, instance, file);
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
