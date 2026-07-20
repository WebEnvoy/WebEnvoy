import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  TaskThreadStoreError,
  validateTaskTurnInputSnapshot,
  type TaskTurnInputField,
  type TaskTurnInputSnapshot
} from "./task-turn-input.js";

type JsonObject = Record<string, unknown>;
export type TaskTurnInputProjection = "safe_summary" | "sanitized_url" | "owner_ref";
export type TaskTurnInputSummaryConstraint =
  | { kind: "text" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "boolean" }
  | { kind: "number"; integer: boolean; minimum?: number; maximum?: number };
export type TaskTurnInputFieldPolicy = {
  field_id: string;
  projection: TaskTurnInputProjection;
  summary_constraint?: TaskTurnInputSummaryConstraint;
};
export type TaskTurnInputPolicy = {
  package_ref: string;
  capability_ref: string;
  input_schema_ref: string;
  fields: ReadonlyMap<string, TaskTurnInputFieldPolicy>;
};
export type TaskTurnInputPolicyResolver = (input: {
  package_ref: string;
  capability_ref: string;
}) => Promise<TaskTurnInputPolicy>;
export type LocalTaskTurnInputPolicyResolverOptions = { registryPath: string; rootDir?: string };

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function schemaTypes(schema: JsonObject): ReadonlySet<string> {
  if (typeof schema.type === "string") return new Set([schema.type]);
  if (Array.isArray(schema.type)) return new Set(schema.type.filter((value): value is string => typeof value === "string"));
  return new Set();
}

function closedPublicValue(schema: JsonObject): boolean {
  const types = schemaTypes(schema);
  if (types.has("boolean") || types.has("integer") || types.has("number")) return true;
  if (schema.const !== undefined && (typeof schema.const === "string" || typeof schema.const === "number" || typeof schema.const === "boolean")) return true;
  return Array.isArray(schema.enum) && schema.enum.length > 0 &&
    schema.enum.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean");
}

function fieldProjection(schema: JsonObject, sensitivity: string | undefined): TaskTurnInputProjection {
  if (schemaTypes(schema).has("string") && (schema.format === "uri" || schema.format === "uri-reference")) {
    return sensitivity === "public" || sensitivity === "user_provided" ? "sanitized_url" : "owner_ref";
  }
  if (sensitivity === "public" || sensitivity === "public_safe_summary" || closedPublicValue(schema)) {
    return "safe_summary";
  }
  return "owner_ref";
}

function summaryConstraint(schema: JsonObject): TaskTurnInputSummaryConstraint {
  if (schema.const !== undefined) return { kind: "enum", values: [String(schema.const)] };
  if (Array.isArray(schema.enum)) return { kind: "enum", values: schema.enum.map(String) };
  const types = schemaTypes(schema);
  if (types.has("boolean")) return { kind: "boolean" };
  if (types.has("integer") || types.has("number")) {
    return {
      kind: "number",
      integer: types.has("integer"),
      ...(typeof schema.minimum === "number" ? { minimum: schema.minimum } : {}),
      ...(typeof schema.maximum === "number" ? { maximum: schema.maximum } : {})
    };
  }
  return { kind: "text" };
}

function policyFields(inputSchema: JsonObject): ReadonlyMap<string, TaskTurnInputFieldPolicy> {
  const properties = object(inputSchema.properties);
  const sensitivity = object(object(inputSchema["x-lode"])?.sensitivity);
  if (!properties || !sensitivity) throw new TaskThreadStoreError("input_schema_invalid");
  const fields = new Map<string, TaskTurnInputFieldPolicy>();
  for (const [fieldId, value] of Object.entries(properties)) {
    const schema = object(value);
    if (!schema) throw new TaskThreadStoreError("input_schema_invalid");
    const projection = fieldProjection(schema, string(sensitivity[fieldId]));
    fields.set(fieldId, {
      field_id: fieldId,
      projection,
      ...(projection === "safe_summary" ? { summary_constraint: summaryConstraint(schema) } : {})
    });
  }
  return fields;
}

function assertSummaryConstraint(field: TaskTurnInputField, policy: TaskTurnInputFieldPolicy): void {
  const summary = field.summary;
  const constraint = policy.summary_constraint;
  if (summary === undefined || !constraint || constraint.kind === "text") return;
  if (constraint.kind === "enum" && !constraint.values.includes(summary)) {
    throw new TaskThreadStoreError(`input_field_summary_invalid:${field.field_id}`);
  }
  if (constraint.kind === "boolean" && summary !== "true" && summary !== "false") {
    throw new TaskThreadStoreError(`input_field_summary_invalid:${field.field_id}`);
  }
  if (constraint.kind === "number") {
    const number = Number(summary);
    if (!Number.isFinite(number) || String(number) !== summary ||
      (constraint.integer && !Number.isInteger(number)) ||
      (constraint.minimum !== undefined && number < constraint.minimum) ||
      (constraint.maximum !== undefined && number > constraint.maximum)) {
      throw new TaskThreadStoreError(`input_field_summary_invalid:${field.field_id}`);
    }
  }
}

function assertFieldProjection(field: TaskTurnInputField, policy: TaskTurnInputFieldPolicy): void {
  if (policy.projection === "safe_summary" && (field.kind !== "scalar" || field.summary === undefined)) {
    throw new TaskThreadStoreError(`input_field_policy_mismatch:${field.field_id}`);
  }
  if (policy.projection === "safe_summary") assertSummaryConstraint(field, policy);
  if (policy.projection === "sanitized_url" && (field.kind !== "url" || field.summary === undefined)) {
    throw new TaskThreadStoreError(`input_field_policy_mismatch:${field.field_id}`);
  }
  if (policy.projection === "owner_ref" &&
    (!field.owner_ref || (field.kind !== "long_text" && field.kind !== "file" && field.kind !== "attachment"))) {
    throw new TaskThreadStoreError(`input_field_summary_forbidden:${field.field_id}`);
  }
}

export function validateTaskTurnInputAgainstPolicy(
  value: unknown,
  policy: TaskTurnInputPolicy
): TaskTurnInputSnapshot {
  const input = validateTaskTurnInputSnapshot(value);
  for (const field of input.fields) {
    const fieldPolicy = policy.fields.get(field.field_id);
    if (!fieldPolicy) throw new TaskThreadStoreError(`input_field_not_declared:${field.field_id}`);
    assertFieldProjection(field, fieldPolicy);
  }
  return input;
}

export function createLocalTaskTurnInputPolicyResolver(
  options: LocalTaskTurnInputPolicyResolverOptions
): TaskTurnInputPolicyResolver {
  const root = resolve(options.rootDir ?? dirname(dirname(options.registryPath)));

  async function pathUnderRoot(path: string): Promise<string> {
    const resolved = resolve(root, path);
    const child = relative(root, resolved);
    if (child !== "" && (child.startsWith("..") || isAbsolute(child))) {
      throw new TaskThreadStoreError("input_schema_invalid");
    }
    const [base, target] = await Promise.all([realpath(root), realpath(resolved)]);
    const realChild = relative(base, target);
    if (realChild !== "" && (realChild.startsWith("..") || isAbsolute(realChild))) {
      throw new TaskThreadStoreError("input_schema_invalid");
    }
    return target;
  }

  return async ({ package_ref, capability_ref }) => {
    try {
      const registry = object(JSON.parse(await readFile(options.registryPath, "utf8")));
      const entries = Array.isArray(registry?.entries) ? registry.entries.map(object) : [];
      const entry = entries.find((candidate) => candidate?.package_ref === package_ref);
      if (!entry) throw new TaskThreadStoreError("input_package_not_found");
      const packagePath = string(entry.package_path);
      const manifestPath = string(entry.manifest_path);
      const capabilityId = string(entry.capability_id);
      if (!packagePath || !manifestPath || !capabilityId || `lode:capability/${capabilityId}` !== capability_ref) {
        throw new TaskThreadStoreError("input_capability_mismatch");
      }
      const manifest = object(JSON.parse(await readFile(await pathUnderRoot(manifestPath), "utf8")));
      const manifestCapability = object(manifest?.capability);
      const inputSchemaAsset = Array.isArray(manifest?.asset_refs)
        ? manifest.asset_refs.map(object).find((asset) => asset?.role === "input_schema")
        : undefined;
      const inputSchemaPath = string(inputSchemaAsset?.path);
      const declaredInputSchemaRef = string(inputSchemaAsset?.schema_id);
      if (manifest?.package_ref !== package_ref || manifestCapability?.capability_id !== capabilityId || !inputSchemaPath || !declaredInputSchemaRef) {
        throw new TaskThreadStoreError("input_schema_invalid");
      }
      const inputSchema = object(JSON.parse(await readFile(await pathUnderRoot(join(packagePath, inputSchemaPath)), "utf8")));
      const inputSchemaRef = string(inputSchema?.$id);
      const lode = object(inputSchema?.["x-lode"]);
      if (!inputSchema || inputSchemaRef !== declaredInputSchemaRef || lode?.package_ref !== package_ref) {
        throw new TaskThreadStoreError("input_schema_ref_mismatch");
      }
      return {
        package_ref,
        capability_ref,
        input_schema_ref: inputSchemaRef,
        fields: policyFields(inputSchema)
      };
    } catch (error) {
      if (error instanceof TaskThreadStoreError) throw error;
      throw new TaskThreadStoreError("lode_input_policy_unavailable");
    }
  };
}
