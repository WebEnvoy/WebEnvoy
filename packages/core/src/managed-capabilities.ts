import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ManagedAccessError } from "./managed-access.js";

type JsonObject = Record<string, unknown>;

export type ManagedCapabilityField = {
  type: string;
  description: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  not?: { const?: unknown };
  enum?: string[];
  properties?: Record<string, ManagedCapabilityField>;
  additionalProperties?: boolean;
  items?: ManagedCapabilityField;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
};

export type ManagedCapabilityCondition = {
  kind: "conditional_fields" | "file_scope" | "page_selector" | "same_origin";
  when?: unknown;
  required?: string[];
  required_any?: string[];
  forbidden?: string[];
  fields?: string[];
  path?: string;
  exact_length?: number;
  exact?: unknown;
  equals?: string;
  field?: string;
  with?: string;
  summary: string;
  constraints?: Record<string, Record<string, number>>;
};

export type ManagedCapabilityDefinition = {
  id: string;
  definition: "defined" | "unknown" | "out_of_scope";
  exposure: "exposed" | "not_exposed";
  capability: string | null;
  context: "profile" | "unsupported";
  allowed: string[];
  required: string[];
  summary: string;
  file_scope?: "upload" | "download";
  conditions?: ManagedCapabilityCondition[];
};

export type ManagedCapabilityFieldGuidance = {
  path: string;
  required_when: string;
  source: string;
  constraints: string[];
};

type ManagedCapabilityDocument = {
  schema_version: string;
  operation_tool: string;
  query_tool: string;
  operation_pattern: string;
  fields: Record<string, ManagedCapabilityField>;
  operations: ManagedCapabilityDefinition[];
  out_of_scope_prefixes: string[];
  out_of_scope_operations: string[];
  illustrative_example: Record<string, JsonObject>;
};

const definitionPath = join(dirname(fileURLToPath(import.meta.url)), "managed-capability-definitions.json");
const document = JSON.parse(readFileSync(definitionPath, "utf8")) as ManagedCapabilityDocument;
const byOperation = new Map(document.operations.map(definition => [definition.id, definition]));
const envelopeFields = ["idempotency_key", "connection_id", "grant_id", "operation", "task_scope"] as const;
const operationFields = new Set(Object.keys(document.fields));
// Existing out-of-scope operations still pass through the legacy parser.
const outOfScopeExecutionFields = ["account_system_ref", "account_ref", "backup_ref", "operation_ref"] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value as JsonObject).sort().map(key => `${JSON.stringify(key)}:${canonical((value as JsonObject)[key])}`).join(",")}}`;
}

function pathValue(value: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || !(key in (current as JsonObject))) return undefined;
    return (current as JsonObject)[key];
  }, value);
}

function conditionMatches(value: JsonObject, condition: ManagedCapabilityCondition): boolean {
  if (!condition.when || typeof condition.when !== "object") return true;
  const when = condition.when as JsonObject;
  const actual = value[String(when.field)];
  if (Object.hasOwn(when, "equals")) return actual === when.equals;
  return Array.isArray(when.in) && when.in.includes(actual);
}

function publicOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value && !parsed.username && !parsed.password;
  } catch { return false; }
}

/** The one static field matcher used by execution parsing and describe drafts. */
export function managedCapabilityFieldMatches(value: unknown, schema: ManagedCapabilityField): boolean {
  if (schema.not?.const !== undefined && value === schema.not.const) return false;
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "webenvoy-public-origin" && !publicOrigin(value)) return false;
    if (schema.format === "webenvoy-public-http-target") {
      try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return false;
      } catch { return false; }
    }
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) return false;
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
  } else if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.entries(value as JsonObject);
    if (schema.minProperties !== undefined && entries.length < schema.minProperties) return false;
    if (schema.additionalProperties === false && entries.some(([key]) => !schema.properties?.[key])) return false;
    if (schema.properties && entries.some(([key, item]) => schema.properties![key] !== undefined && !managedCapabilityFieldMatches(item, schema.properties![key]!))) return false;
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && value.some(item => !managedCapabilityFieldMatches(item, schema.items!))) return false;
  } else return false;
  if (schema.enum !== undefined && !schema.enum.includes(String(value))) return false;
  if (typeof value === "number" && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  return true;
}

function validateConditions(value: JsonObject, definition: ManagedCapabilityDefinition, partial = false): void {
  for (const condition of definition.conditions ?? []) {
    if (condition.kind === "conditional_fields" && conditionMatches(value, condition)) {
      if (!partial && (condition.required ?? []).some(field => value[field] === undefined) || (condition.forbidden ?? []).some(field => value[field] !== undefined)) {
        throw new ManagedAccessError("managed_browser_invalid_input");
      }
      for (const [field, constraints] of Object.entries(condition.constraints ?? {})) {
        const item = value[field];
        if (typeof item === "string" && constraints.maxLength !== undefined && item.length > constraints.maxLength) throw new ManagedAccessError("managed_browser_invalid_input");
      }
    }
    if (condition.kind === "page_selector" && condition.when === "always" &&
      !partial && (condition.required_any ?? []).every(field => value[field] === undefined)) throw new ManagedAccessError("managed_browser_invalid_input");
    if (condition.kind === "same_origin" && value[condition.field ?? ""] !== undefined) {
      const target = value[condition.field ?? ""], origin = value[condition.with ?? ""];
      if (origin === undefined && partial) continue;
      if (typeof target !== "string" || typeof origin !== "string") throw new ManagedAccessError("managed_browser_invalid_input");
      try {
        if (new URL(target).origin !== origin) throw new Error("origin_mismatch");
      } catch { throw new ManagedAccessError("managed_browser_invalid_input"); }
    }
    if (condition.kind === "file_scope") {
      const refs = pathValue(value, condition.path ?? "task_scope.file_refs");
      if (refs === undefined && partial) continue;
      if (!Array.isArray(refs)) throw new ManagedAccessError("managed_browser_invalid_input");
      if (condition.exact_length !== undefined && refs.length !== condition.exact_length) throw new ManagedAccessError("managed_browser_invalid_input");
      if (condition.exact !== undefined && canonical(refs) !== canonical(condition.exact)) throw new ManagedAccessError("managed_browser_invalid_input");
      if (condition.equals !== undefined && refs[0] !== value[condition.equals]) throw new ManagedAccessError("managed_browser_invalid_input");
    }
  }
}

export const managedCapabilityDefinitions = document;
export const managedCapabilityDefinitionRevision = `sha256:${createHash("sha256").update(canonical(document)).digest("hex")}`;
export const managedCapabilityEnvelopeFields = envelopeFields;

export function managedCapabilityDefinition(operation: unknown): ManagedCapabilityDefinition | undefined {
  return typeof operation === "string" ? byOperation.get(operation) : undefined;
}

export function managedCapabilityDefinitionState(operation: unknown): "defined" | "out_of_scope" | "unknown" {
  if (managedCapabilityDefinition(operation)) return "defined";
  if (typeof operation === "string" && (document.out_of_scope_operations.includes(operation) || document.out_of_scope_prefixes.some(prefix => operation.startsWith(prefix)))) return "out_of_scope";
  return "unknown";
}

export function managedCapabilityInputFields(operation: unknown): string[] {
  const definition = managedCapabilityDefinition(operation);
  if (definition?.exposure === "exposed") return [...envelopeFields, ...definition.allowed];
  return [...envelopeFields, ...operationFields, ...outOfScopeExecutionFields];
}

/** Validate the operation-specific shape before any access, run, or Harbor work. */
export function validateManagedCapabilityInputShape(value: JsonObject, options: { partial?: boolean } = {}): void {
  const definition = managedCapabilityDefinition(value.operation);
  if (!definition || definition.exposure !== "exposed") return;
  const allowed = new Set(managedCapabilityInputFields(value.operation));
  if (Object.keys(value).some(key => value[key] !== undefined && !allowed.has(key))) throw new ManagedAccessError("managed_browser_invalid_input");
  const scope = value.task_scope;
  if (scope !== undefined) {
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new ManagedAccessError("managed_browser_invalid_input");
    const scopeObject = scope as JsonObject;
    if (definition.file_scope === undefined && scopeObject.file_refs !== undefined) throw new ManagedAccessError("managed_browser_invalid_input");
    if (definition.file_scope === "download" && (!Array.isArray(scopeObject.file_refs) || scopeObject.file_refs.length !== 0)) throw new ManagedAccessError("managed_browser_invalid_input");
    if (definition.file_scope === "upload" && scopeObject.file_refs !== undefined && (!Array.isArray(scopeObject.file_refs) || scopeObject.file_refs.length !== 1)) throw new ManagedAccessError("managed_browser_invalid_input");
  }
  for (const field of definition.allowed) {
    if (value[field] !== undefined && !managedCapabilityFieldMatches(value[field], document.fields[field]!)) throw new ManagedAccessError("managed_browser_invalid_input");
  }
  if (options.partial) {
    validateConditions(value, definition, true);
    return;
  }
  for (const field of definition.required) if (value[field] === undefined) throw new ManagedAccessError("managed_browser_invalid_input");
  validateConditions(value, definition);
}

export function managedCapabilityExample(operation: string): JsonObject | null {
  const example = document.illustrative_example[operation];
  return example ? structuredClone(example) : null;
}

export function managedCapabilityInputSchema(operation?: string): JsonObject {
  const fields = document.fields;
  const properties: JsonObject = Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, { ...schema }]));
  const definition = managedCapabilityDefinition(operation);
  const schema: JsonObject = {
    type: "object",
    properties,
    additionalProperties: false
  };
  if (definition) {
    schema.required = definition.required;
    const forbidden = Object.keys(fields).filter(field => !definition.allowed.includes(field));
    if (forbidden.length > 0) schema.not = { anyOf: forbidden.map(field => ({ required: [field] })) };
    if (definition.conditions?.length) schema["x-webenvoy-conditions"] = structuredClone(definition.conditions);
  }
  return schema;
}

function taskScopeSchema(fileScope?: "upload" | "download"): JsonObject {
  const properties: JsonObject = {
    operations: { type: "array", items: { type: "string" }, description: "The operations granted for this one submitted request." },
    profile_refs: { type: "array", items: { type: "string" }, description: "The Profile references in this one submitted request." },
    origins: { type: "array", items: { type: "string", format: "webenvoy-public-origin" }, description: "The exact origins in this one submitted request." }
  };
  if (fileScope !== undefined) properties.file_refs = {
    type: "array", items: { type: "string", pattern: "^attachment:runtime/[0-9a-f-]{36}$" },
    ...(fileScope === "upload" ? { minItems: 1, maxItems: 1 } : { maxItems: 0 }),
    description: fileScope === "upload" ? "Exactly the top-level file_ref." : "An explicit empty array."
  };
  return { type: "object", properties, required: ["operations", "profile_refs", "origins", ...(fileScope === undefined ? [] : ["file_refs"])], additionalProperties: false };
}

function fieldConstraints(field: ManagedCapabilityField): string[] {
  return [
    field.format === undefined ? undefined : field.format,
    field.pattern === undefined ? undefined : `pattern=${field.pattern}`,
    field.minLength === undefined ? undefined : `minLength=${field.minLength}`,
    field.maxLength === undefined ? undefined : `maxLength=${field.maxLength}`,
    field.minimum === undefined ? undefined : `minimum=${field.minimum}`,
    field.maximum === undefined ? undefined : `maximum=${field.maximum}`,
    field.not?.const === undefined ? undefined : `not=${JSON.stringify(field.not.const)}`,
    field.enum === undefined ? undefined : `enum=${field.enum.join(",")}`
  ].filter((value): value is string => value !== undefined);
}

/** The complete public execution envelope for one exposed operation. */
export function managedCapabilityExecutionInputSchema(operation?: string): JsonObject {
  const definition = managedCapabilityDefinition(operation);
  const properties: JsonObject = {
    idempotency_key: { type: "string", minLength: 1, maxLength: 512, description: "A new idempotency key for this submitted operation." },
    grant_id: { type: "string", description: "The one owner-issued Grant for this submitted operation." },
    operation: { type: "string", ...(definition ? { enum: [definition.id] } : { pattern: document.operation_pattern }), description: "One exposed operation name." },
    task_scope: taskScopeSchema(definition?.file_scope),
    ...Object.fromEntries((definition ? definition.allowed : Object.keys(document.fields)).map(field => [field, { ...document.fields[field] }]))
  };
  const schema: JsonObject = {
    type: "object", properties, required: ["idempotency_key", "grant_id", "operation", "task_scope"], additionalProperties: false
  };
  if (!definition) return schema;
  schema.required = [...(schema.required as string[]), ...definition.required];
  const forbidden = Object.keys(document.fields).filter(field => !definition.allowed.includes(field));
  if (forbidden.length > 0) schema.not = { anyOf: forbidden.map(field => ({ required: [field] })) };
  const allOf: JsonObject[] = [];
  if (definition.file_scope === undefined) {
    allOf.push({ properties: { task_scope: { not: { required: ["file_refs"] } } } });
  } else {
    allOf.push({ properties: { task_scope: taskScopeSchema(definition.file_scope) } });
  }
  for (const condition of definition.conditions ?? []) {
    if (condition.kind === "conditional_fields" && condition.when && typeof condition.when === "object" && typeof (condition.when as JsonObject).field === "string") {
      const when = condition.when as JsonObject;
      const constrainedProperties = Object.fromEntries(Object.entries(condition.constraints ?? {}).map(([field, constraints]) => [field, { ...document.fields[field], ...constraints }]));
      allOf.push({ if: { properties: { [String(when.field)]: { const: when.equals } }, required: [String(when.field)] }, then: {
        ...(condition.required?.length ? { required: condition.required } : {}),
        ...(condition.forbidden?.length ? { not: { anyOf: condition.forbidden.map(field => ({ required: [field] })) } } : {}),
        ...(Object.keys(constrainedProperties).length ? { properties: constrainedProperties } : {})
      } });
    }
    if (condition.kind === "page_selector" && condition.when === "always") {
      allOf.push({ anyOf: (condition.required_any ?? []).map(field => ({ required: [field] })) });
    }
  }
  if (allOf.length > 0) schema.allOf = allOf;
  if (definition.conditions?.length) schema["x-webenvoy-conditions"] = structuredClone(definition.conditions);
  const fileCondition = definition.conditions?.find(condition => condition.kind === "file_scope" && condition.equals);
  if (fileCondition) schema["x-webenvoy-equals"] = { left: `${fileCondition.path ?? "task_scope.file_refs"}[0]`, right: fileCondition.equals };
  return schema;
}

/** Human-readable field guidance is generated from the same operation definition. */
export function managedCapabilityFieldGuidance(operation: unknown): ManagedCapabilityFieldGuidance[] {
  const definition = managedCapabilityDefinition(operation);
  if (!definition || definition.exposure !== "exposed") return [];
  const guidance: ManagedCapabilityFieldGuidance[] = [
    { path: "/idempotency_key", required_when: "submit", source: "new operation request", constraints: ["new key per operation"] },
    { path: "/grant_id", required_when: "submit", source: "owner-issued Grant", constraints: ["one Grant only"] },
    { path: "/task_scope", required_when: "submit", source: "the same Grant/task scope", constraints: ["current operation only"] }
  ];
  for (const field of definition.allowed) {
    const condition = definition.conditions?.find(item => item.kind === "conditional_fields" && item.required?.includes(field));
    const selector = definition.conditions?.find(item => item.kind === "page_selector" && item.fields?.includes(field));
    guidance.push({
      path: `/${field}`,
      required_when: definition.required.includes(field) ? "always" : condition ? `${String((condition.when as JsonObject | undefined)?.field)}=${String((condition.when as JsonObject | undefined)?.equals)}` : selector ? String(selector.when) : "optional",
      source: field === "runtime_session_ref" ? "instance.start result.session.runtime_session_ref" : field === "page_ref" || field === "page_id" ? "the latest observation/page list" : field === "observation_ref" || field === "target_ref" ? "the latest instance.observe result" : field === "file_ref" ? "owner file import result" : "operation definition",
      constraints: fieldConstraints(document.fields[field]!)
    });
  }
  for (const condition of definition.conditions ?? []) {
    if (condition.kind === "file_scope") guidance.push({ path: `/${condition.path ?? "task_scope.file_refs"}`, required_when: "submit", source: "the same operation envelope", constraints: [condition.summary] });
    if (condition.kind === "page_selector" && condition.when !== "always") guidance.push({ path: "/page_id|/page_ref", required_when: condition.when === "multiple_pages" ? "when multiple pages are registered" : String(condition.when), source: "the latest page list", constraints: [condition.summary] });
  }
  return guidance;
}

export function managedCapabilityDefinitionForParser(operation: unknown): ManagedCapabilityDefinition | undefined {
  return managedCapabilityDefinition(operation);
}
