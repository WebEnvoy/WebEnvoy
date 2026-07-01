import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaDir = join(packageRoot, "schemas");
const fixtureDir = join(packageRoot, "fixtures");

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

assert(schemaFiles.length > 0, "at least one schema is required");
assert(fixtureFiles.length > 0, "at least one fixture is required");

const schemasByFile = new Map<string, JsonObject>();

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
}

for (const file of fixtureFiles) {
  const fixture = await readJson(file);
  const schemaRef = asString(fixture.$schema, `${file}.$schema`);
  const schema = schemasByFile.get(basename(schemaRef));
  assert(schema, `${file} must reference a local schema file`);

  const fixtureVersion = asString(fixture.schema_version, `${file}.schema_version`);
  const schemaVersion = asString(asObject(schema["x-webenvoy"], `${schemaRef}.x-webenvoy`).schema_version, `${schemaRef}.schema_version`);
  assert.equal(fixtureVersion, schemaVersion, `${file} schema_version must match ${schemaRef}`);

  const required = schema.required;
  if (Array.isArray(required)) {
    for (const field of required) {
      const key = asString(field, `${schemaRef}.required[]`);
      assert(Object.hasOwn(fixture, key), `${file} missing required field ${key}`);
    }
  }
}

console.log(`Validated ${schemaFiles.length} schemas and ${fixtureFiles.length} fixtures.`);
