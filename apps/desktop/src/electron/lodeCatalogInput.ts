import {
  hasOnlyAllowedKeys,
  isRecord,
  optionalString,
  requiredRecord,
  requiredStringArray,
} from "./lodeCatalogGuards.js";
import { isSafeCatalogPattern } from "./safeCatalogPattern.js";

export type LodeCatalogField = {
  id: string;
  label: string;
  kind: "text" | "multiline" | "number" | "boolean" | "select" | "multi-select" | "file" | "constant" | "unknown";
  required: boolean;
  description: string;
  options?: string[];
  defaultValue?: string | number | boolean | string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  patternSafety?: "linear";
  format?: "uri";
  integer?: boolean;
  inputProjection: "safe_summary" | "sanitized_url" | "owner_ref";
};

const maxCatalogFields = 100;
const schemaKeys = ["$schema", "$id", "title", "description", "type", "additionalProperties", "required", "properties", "examples", "x-lode"];
const fieldKeys = [
  "type", "title", "description", "enum", "default", "minimum", "maximum", "minLength", "maxLength",
  "minItems", "maxItems", "uniqueItems", "pattern", "format", "contentMediaType", "contentEncoding",
  "const", "items", "examples",
];
const itemKeys = ["type", "enum"];

type InputContract = {
  operationMode: string;
  operationRef: string;
  packageRef: string;
  schemaId: string;
};

export function projectInputFields(schema: Record<string, unknown>, contract?: InputContract): LodeCatalogField[] {
  if (schema.type !== "object" || schema.additionalProperties !== false || !hasOnlyAllowedKeys(schema, schemaKeys)) {
    throw new Error("Input schema uses an unsupported object contract.");
  }
  if (contract != null && !inputContractMatches(schema, contract)) {
    throw new Error("Input schema does not match the selected business action.");
  }
  const properties = requiredRecord(schema.properties, "input schema properties");
  const extension = isRecord(schema["x-lode"]) ? schema["x-lode"] : null;
  const sensitivity = isRecord(extension?.sensitivity) ? extension.sensitivity : null;
  if (contract != null && sensitivity == null) throw new Error("Input schema sensitivity contract is missing.");
  const required = new Set(schema.required === undefined ? [] : requiredStringArray(schema.required, "input schema required", maxCatalogFields));
  if (Object.keys(properties).length > maxCatalogFields || [...required].some((id) => !Object.hasOwn(properties, id))) {
    throw new Error("Input schema field declaration is invalid.");
  }
  return Object.entries(properties).map(([id, value]) =>
    projectField(id, value, required.has(id), optionalString(sensitivity?.[id])),
  );
}

function inputContractMatches(schema: Record<string, unknown>, contract: InputContract) {
  const extension = isRecord(schema["x-lode"]) ? schema["x-lode"] : null;
  return schema.$schema === "https://json-schema.org/draft/2020-12/schema" && schema.$id === contract.schemaId &&
    extension?.package_ref === contract.packageRef && extension.operation_ref === contract.operationRef &&
    extension.operation_mode === contract.operationMode;
}

function projectField(id: string, value: unknown, required: boolean, sensitivity: string | undefined): LodeCatalogField {
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(id) || !isRecord(value) || !hasOnlyAllowedKeys(value, fieldKeys)) {
    return incompatibleField(id, required);
  }
  try {
    return projectSupportedField(id, value, required, sensitivity);
  } catch {
    return incompatibleField(id, required);
  }
}

function projectSupportedField(
  id: string,
  value: Record<string, unknown>,
  required: boolean,
  sensitivity: string | undefined,
): LodeCatalogField {
  const type = optionalString(value.type);
  const constant = primitive(value.const);
  const options = value.enum === undefined ? undefined : requiredStringArray(value.enum, `${id} enum`);
  const array = type === "array" ? projectArray(value, id) : undefined;
  const pattern = projectPattern(value.pattern);
  const format = projectFormat(value.format);
  const minimum = finiteNumber(value.minimum);
  const maximum = finiteNumber(value.maximum);
  const minLength = nonNegativeInteger(value.minLength);
  const maxLength = nonNegativeInteger(value.maxLength);
  const file = projectFileDeclaration(value);
  rejectUnsupportedCombinations(value, { type, constant, options, array, file, minimum, maximum, minLength, maxLength });
  const kind = fieldKind(value, type, constant, options, array, file, format);
  const projectedDefault = projectDefault(value.default);
  if (value.default !== undefined && projectedDefault === undefined) throw new Error(`Unsupported ${id} default.`);
  const defaultValue = constant ?? projectedDefault;
  const field: LodeCatalogField = {
    id,
    label: optionalString(value.title) ?? fieldLabel(id),
    kind,
    required,
    description: optionalString(value.description) ?? "由技能合同定义。",
    inputProjection: fieldProjection(value, sensitivity),
    ...(options == null && array == null ? {} : { options: options ?? array?.options }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(array?.minItems === undefined ? {} : { minItems: array.minItems }),
    ...(array?.maxItems === undefined ? {} : { maxItems: array.maxItems }),
    ...(array?.uniqueItems === undefined ? {} : { uniqueItems: array.uniqueItems }),
    ...(pattern === undefined ? {} : { pattern, patternSafety: "linear" as const }),
    ...(format === undefined ? {} : { format }),
    ...(type === "integer" ? { integer: true } : {}),
  };
  if (field.options != null && field.options.length === 0) throw new Error(`Empty ${id} options.`);
  if (field.kind === "select" && field.options?.some((option) => !stringMatchesConstraints(field, option))) {
    throw new Error(`Invalid ${id} option constraints.`);
  }
  if (!defaultMatchesField(field)) throw new Error(`Invalid ${id} default.`);
  return field;
}

function fieldProjection(
  schema: Record<string, unknown>,
  sensitivity: string | undefined,
): LodeCatalogField["inputProjection"] {
  if (schema.type === "string" && (schema.format === "uri" || schema.format === "uri-reference")) {
    return sensitivity === "public" ? "sanitized_url" : "owner_ref";
  }
  if (
    sensitivity === "public" ||
    sensitivity === "public_safe_summary" ||
    schema.type === "boolean" ||
    schema.type === "integer" ||
    schema.type === "number" ||
    primitive(schema.const) !== undefined ||
    Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((item) => primitive(item) !== undefined)
  ) {
    return "safe_summary";
  }
  return "owner_ref";
}

function projectArray(value: Record<string, unknown>, id: string) {
  const items = isRecord(value.items) && hasOnlyAllowedKeys(value.items, itemKeys) ? value.items : null;
  if (items?.type !== "string") throw new Error(`Unsupported ${id} items.`);
  const options = requiredStringArray(items.enum, `${id} items enum`);
  const minItems = nonNegativeInteger(value.minItems);
  const maxItems = nonNegativeInteger(value.maxItems);
  const uniqueItems = value.uniqueItems === undefined ? undefined : value.uniqueItems === true ? true : value.uniqueItems === false ? false : null;
  if (options.length === 0 || uniqueItems === null || (minItems != null && maxItems != null && minItems > maxItems) ||
    uniqueItems === true && minItems != null && minItems > options.length) throw new Error(`Invalid ${id} array constraints.`);
  return { options, minItems, maxItems, uniqueItems };
}

function rejectUnsupportedCombinations(
  value: Record<string, unknown>,
  projected: {
    type: string | undefined;
    constant: ReturnType<typeof primitive>;
    options: string[] | undefined;
    array: ReturnType<typeof projectArray> | undefined;
    file: boolean;
    minimum: number | undefined;
    maximum: number | undefined;
    minLength: number | undefined;
    maxLength: number | undefined;
  },
) {
  const { type, constant, options, array, file, minimum, maximum, minLength, maxLength } = projected;
  if (constant !== undefined && (type != null || options != null) || options != null && type !== "string") throw new Error("Unsupported const/enum combination.");
  if (type !== "array" && ["items", "minItems", "maxItems", "uniqueItems"].some((key) => value[key] !== undefined)) throw new Error("Array constraint on non-array field.");
  if (!(["integer", "number"].includes(type ?? "")) && (minimum != null || maximum != null) || minimum != null && maximum != null && minimum > maximum) throw new Error("Invalid numeric constraints.");
  if (type !== "string" && (minLength != null || maxLength != null || value.pattern !== undefined || value.format !== undefined || file)) throw new Error("String constraint on non-string field.");
  if (minLength != null && maxLength != null && minLength > maxLength || type === "array" && array == null) throw new Error("Invalid field constraints.");
}

function fieldKind(
  value: Record<string, unknown>,
  type: string | undefined,
  constant: ReturnType<typeof primitive>,
  options: string[] | undefined,
  array: ReturnType<typeof projectArray> | undefined,
  file: boolean,
  format: "uri" | undefined,
): LodeCatalogField["kind"] {
  if (constant !== undefined) return "constant";
  if (array != null) return "multi-select";
  if (options != null) return "select";
  if (type === "string" && file) return "file";
  if (type === "string" && (value.format === "multiline" || value.format === "textarea")) return "multiline";
  if (type === "string" && (format != null || value.format === undefined)) return "text";
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  throw new Error("Unsupported field type.");
}

function defaultMatchesField(field: LodeCatalogField) {
  const value = field.defaultValue;
  if (value === undefined) return true;
  if (field.kind === "multi-select") {
    if (!Array.isArray(value) || value.some((item) => !field.options?.includes(item))) return false;
    if (field.minItems != null && value.length < field.minItems || field.maxItems != null && value.length > field.maxItems) return false;
    return !field.uniqueItems || new Set(value).size === value.length;
  }
  if (field.kind === "select") return typeof value === "string" && field.options?.includes(value) === true;
  if (field.kind === "number") return typeof value === "number" && (!field.integer || Number.isInteger(value)) &&
    (field.minimum == null || value >= field.minimum) && (field.maximum == null || value <= field.maximum);
  if (field.kind === "boolean") return typeof value === "boolean";
  if (typeof value !== "string") return field.kind === "constant";
  return stringMatchesConstraints(field, value);
}

function stringMatchesConstraints(field: LodeCatalogField, value: string) {
  if (field.minLength != null && value.length < field.minLength || field.maxLength != null && value.length > field.maxLength) return false;
  if (field.pattern != null && !new RegExp(field.pattern).test(value)) return false;
  if (field.format === "uri") {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    } catch { return false; }
  }
  return true;
}

function projectPattern(value: unknown) {
  if (value === undefined) return undefined;
  if (!isSafeCatalogPattern(value)) throw new Error("Unsupported pattern.");
  return value;
}

function projectFileDeclaration(value: Record<string, unknown>) {
  if (value.contentMediaType === undefined && value.contentEncoding === undefined) return false;
  if (typeof value.contentMediaType !== "string" || value.contentMediaType.length === 0 ||
    value.contentMediaType.length > 255 || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(value.contentMediaType)) {
    throw new Error("Invalid contentMediaType.");
  }
  if (value.contentEncoding !== undefined && value.contentEncoding !== "base64") {
    throw new Error("Unsupported contentEncoding.");
  }
  return true;
}

function projectFormat(value: unknown) {
  if (value === undefined || value === "multiline" || value === "textarea") return undefined;
  if (value === "uri") return "uri" as const;
  throw new Error("Unsupported format.");
}

function primitive(value: unknown) {
  return typeof value === "string" || typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" ? value : undefined;
}

function projectDefault(value: unknown) {
  if (Array.isArray(value)) return value.every((item) => typeof item === "string") ? [...value] : undefined;
  return primitive(value);
}

function finiteNumber(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid numeric constraint.");
  return value;
}

function nonNegativeInteger(value: unknown) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100_000) throw new Error("Invalid integer constraint.");
  return Number(value);
}

function incompatibleField(id: string, required: boolean): LodeCatalogField {
  return {
    id,
    label: fieldLabel(id),
    kind: "unknown",
    required,
    description: "字段合同不兼容。",
    inputProjection: "owner_ref",
  };
}

function fieldLabel(id: string) {
  return id.replaceAll("_", " ");
}
