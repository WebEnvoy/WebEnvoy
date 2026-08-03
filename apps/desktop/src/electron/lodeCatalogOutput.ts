import { hasOnlyAllowedKeys, isRecord, optionalString, strictStringArray } from "./lodeCatalogGuards.js";
import { isSafeCatalogPattern } from "./safeCatalogPattern.js";

const schemaKeys = [
  "$defs", "$id", "$ref", "$schema", "additionalProperties", "allOf", "const", "default", "description",
  "enum", "examples", "format", "if", "items", "maxLength", "minItems", "minLength", "oneOf", "pattern",
  "properties", "required", "then", "title", "type", "uniqueItems", "x-lode",
];
const resultKindKeys = ["const", "title", "description"];
const schemaTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);
const maxSchemaDepth = 24;
const maxSchemaNodes = 2_000;
const maxSchemaMapEntries = 200;
const maxCompositionEntries = 32;

type OutputContract = {
  operationMode: string;
  operationRef: string;
  packageRef: string;
  schemaId: string;
  schemaVersion: string;
};

export function projectOutputKind(schema: Record<string, unknown>, contract: OutputContract) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || schema.$id !== contract.schemaId ||
    schema.type !== "object" || schema.additionalProperties !== false || !validateOutputSchema(schema)) return undefined;
  const properties = isRecord(schema.properties) ? schema.properties : null;
  const required = strictStringArray(schema.required);
  const resultKind = properties != null && isRecord(properties.result_kind) ? properties.result_kind : null;
  const extension = isRecord(schema["x-lode"]) ? schema["x-lode"] : null;
  if (properties == null || Object.keys(properties).length === 0 || Object.keys(properties).length > 100 ||
    required == null || required.length === 0 || !required.includes("result_kind") ||
    required.some((field) => !Object.hasOwn(properties, field)) || resultKind == null ||
    !hasOnlyAllowedKeys(resultKind, resultKindKeys) || optionalString(resultKind.const) == null ||
    extension == null || extension.schema_version !== contract.schemaVersion ||
    extension.package_ref !== contract.packageRef || extension.operation_ref !== contract.operationRef ||
    (extension.operation_mode !== undefined && extension.operation_mode !== contract.operationMode) ||
    (extension.result_kind !== undefined && extension.result_kind !== resultKind.const)) return undefined;
  return resultKind.const as string;
}

function validateOutputSchema(schema: Record<string, unknown>) {
  const definitions = isRecord(schema.$defs) ? schema.$defs : {};
  const budget = { remaining: maxSchemaNodes };
  return validateSchemaNode(schema, definitions, budget, 0);
}

function validateSchemaNode(
  node: unknown,
  definitions: Record<string, unknown>,
  budget: { remaining: number },
  depth: number,
): boolean {
  if (!isRecord(node) || depth > maxSchemaDepth || --budget.remaining < 0 || !hasOnlyAllowedKeys(node, schemaKeys)) return false;
  if (depth > 0 && ["$defs", "$id", "$schema", "x-lode"].some((key) => node[key] !== undefined)) return false;
  if (!validOptionalText(node.title, 512) || !validOptionalText(node.description, 8_192) ||
    !validOptionalText(node.format, 128) || !validOptionalText(node.pattern, 512) || !validType(node.type) ||
    !validOptionalBoolean(node.additionalProperties) || !validOptionalBoolean(node.uniqueItems) ||
    !validOptionalInteger(node.minLength) || !validOptionalInteger(node.maxLength) || !validOptionalInteger(node.minItems) ||
    typeof node.pattern === "string" && !isSafeCatalogPattern(node.pattern)) return false;
  if (!validLiteral(node.const) || !validLiteral(node.default) || !validEnum(node.enum) || !validExamples(node.examples)) return false;
  if (!validReference(node.$ref, definitions) || !validRequired(node.required, node.properties)) return false;
  if (!validateSchemaMap(node.properties, definitions, budget, depth) ||
    !validateSchemaMap(node.$defs, definitions, budget, depth) ||
    !validateSchemaChild(node.items, definitions, budget, depth) ||
    !validateSchemaList(node.allOf, definitions, budget, depth) ||
    !validateSchemaList(node.oneOf, definitions, budget, depth)) return false;
  const hasIf = node.if !== undefined;
  const hasThen = node.then !== undefined;
  return hasIf === hasThen && validateSchemaChild(node.if, definitions, budget, depth) &&
    validateSchemaChild(node.then, definitions, budget, depth);
}

function validateSchemaMap(
  value: unknown,
  definitions: Record<string, unknown>,
  budget: { remaining: number },
  depth: number,
) {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).length > maxSchemaMapEntries) return false;
  return Object.entries(value).every(([key, child]) => validSchemaName(key) && validateSchemaNode(child, definitions, budget, depth + 1));
}

function validateSchemaChild(
  value: unknown,
  definitions: Record<string, unknown>,
  budget: { remaining: number },
  depth: number,
) {
  return value === undefined || validateSchemaNode(value, definitions, budget, depth + 1);
}

function validateSchemaList(
  value: unknown,
  definitions: Record<string, unknown>,
  budget: { remaining: number },
  depth: number,
) {
  return value === undefined || Array.isArray(value) && value.length > 0 && value.length <= maxCompositionEntries &&
    value.every((child) => validateSchemaNode(child, definitions, budget, depth + 1));
}

function validReference(value: unknown, definitions: Record<string, unknown>) {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const match = /^#\/\$defs\/([A-Za-z][A-Za-z0-9._-]{0,127})$/.exec(value);
  return match != null && Object.hasOwn(definitions, match[1]!);
}

function validRequired(value: unknown, properties: unknown) {
  if (value === undefined) return true;
  const required = strictStringArray(value);
  if (required == null || required.length === 0 || required.length > maxSchemaMapEntries || new Set(required).size !== required.length) return false;
  return !isRecord(properties) || required.every((key) => Object.hasOwn(properties, key));
}

function validType(value: unknown) {
  return value === undefined || typeof value === "string" && schemaTypes.has(value);
}

function validOptionalText(value: unknown, max: number) {
  return value === undefined || typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function validOptionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function validOptionalInteger(value: unknown) {
  return value === undefined || Number.isSafeInteger(value) && Number(value) >= 0;
}

function validEnum(value: unknown) {
  return value === undefined || Array.isArray(value) && value.length > 0 && value.length <= 100 &&
    value.every((item) => validJsonLiteral(item)) && new Set(value.map((item) => JSON.stringify(item))).size === value.length;
}

function validExamples(value: unknown) {
  return value === undefined || Array.isArray(value) && value.length <= 20 && value.every((item) => validJsonValue(item, 0));
}

function validLiteral(value: unknown) {
  return value === undefined || validJsonValue(value, 0);
}

function validJsonLiteral(value: unknown) {
  return value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

function validJsonValue(value: unknown, depth: number): boolean {
  if (depth > 8) return false;
  if (validJsonLiteral(value)) return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => validJsonValue(item, depth + 1));
  return isRecord(value) && Object.keys(value).length <= 100 &&
    Object.entries(value).every(([key, item]) => validSchemaName(key) && validJsonValue(item, depth + 1));
}

function validSchemaName(value: string) {
  return value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}
