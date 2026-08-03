import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  IdentityEnvironmentConfigurationUpdate,
  IdentityEnvironmentCreateInput,
  IdentityEnvironmentMutationRequest,
  IdentityEnvironmentMutationResult
} from "./index.js";
import {
  hasOnlyIdentityEnvironmentBusinessInputKeys,
  IDENTITY_ENVIRONMENT_BUSINESS_INPUT_KEYS,
  IDENTITY_ENVIRONMENT_SITE_INPUT_KEYS
} from "./identity-environment-mutation-types.js";
import type { ManualAuthenticationAuthorizer } from "./manual-authentication-authorization.js";

export function authorizeIdentityEnvironmentMutationRequest(
  authorizer: ManualAuthenticationAuthorizer,
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  const authorization = authorizer.authorize(request);
  if (!authorization.authorized) {
    writeJson(response, authorization.status_code, { failure_class: authorization.failure_class });
    return false;
  }
  if (headerValues(request, "origin").length > 0) {
    writeJson(response, 403, { failure_class: "browser_origin_not_allowed" });
    return false;
  }
  const contentTypes = headerValues(request, "content-type");
  if (contentTypes.length !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentTypes[0])) {
    writeJson(response, 415, { failure_class: "json_content_type_required" });
    return false;
  }
  return true;
}

export function identityEnvironmentMutationStatusCode(result: IdentityEnvironmentMutationResult): number {
  if (result.status === "completed") {
    return result.operation === "create" || result.operation === "import" || result.operation.startsWith("copy_") ? 201 : 200;
  }
  if (result.status === "repair_required") return 409;
  if (result.failure?.code === "identity_environment_missing") return 404;
  if ([
    "active_session",
    "duplicate_identity",
    "duplicate_import",
    "idempotency_conflict",
    "profile_locked",
    "profile_storage_exists",
    "source_in_use",
    "target_in_use"
  ].includes(result.failure?.code ?? "")) return 409;
  return 422;
}

export function isIdentityEnvironmentMutationRequest(value: unknown): value is IdentityEnvironmentMutationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (typeof input.idempotency_key !== "string" || !input.idempotency_key.trim() || typeof input.operation !== "string") return false;
  if (["create", "import"].includes(input.operation)) {
    return onlyKeys(input, ["operation", "idempotency_key", "identity_environment"]) &&
      isIdentityEnvironmentMutationInput(input.identity_environment, input.operation as "create" | "import");
  }
  if (!["edit", "copy_full", "copy_environment", "remove", "delete"].includes(input.operation)) return false;
  if (!nonEmptyString(input.identity_environment_ref)) return false;
  if (input.operation === "edit") {
    return onlyKeys(input, ["operation", "idempotency_key", "identity_environment_ref", "configuration"]) &&
      isIdentityEnvironmentConfiguration(input.configuration);
  }
  if (input.operation.startsWith("copy_")) {
    return onlyKeys(input, ["operation", "idempotency_key", "identity_environment_ref"]);
  }
  if (input.operation === "remove") {
    return onlyKeys(input, ["operation", "idempotency_key", "identity_environment_ref"]);
  }
  return onlyKeys(input, ["operation", "idempotency_key", "identity_environment_ref", "confirmation"]) &&
    input.confirmation === "delete_local_data";
}

export function isIdentityEnvironmentConfiguration(value: unknown): value is IdentityEnvironmentConfigurationUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = ["provider_id", "proxy_ref", "proxy_label", "geoip_mode", "region", "language", "timezone", "viewport", "hardware_concurrency", "device_memory_gb", "gpu_profile", "interaction_preset", "fingerprint_strategy"];
  if (!keys.some((key) => Object.hasOwn(input, key)) || !Object.keys(input).every((key) => keys.includes(key))) return false;
  for (const key of ["region", "language", "timezone", "viewport", "gpu_profile"]) {
    if (!optionalString(input[key])) return false;
  }
  return optionalNullableString(input.proxy_ref) && optionalNullableString(input.proxy_label) &&
    optionalNumber(input.hardware_concurrency) && optionalNumber(input.device_memory_gb) &&
    optionalEnum(input.provider_id, ["cloakbrowser", "chrome_official"]) &&
    optionalEnum(input.geoip_mode, ["proxy", "system", "disabled"]) &&
    optionalEnum(input.interaction_preset, ["default", "humanized"]) &&
    optionalEnum(input.fingerprint_strategy, ["provider_default", "stable"]);
}

export function legacyIdentityEnvironmentCreateMutation(
  value: unknown,
  request: IncomingMessage
): IdentityEnvironmentMutationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (isIdentityEnvironmentMutationRequest(value)) {
    return value.operation === "create" || value.operation === "import" ? value : null;
  }
  const input = value as Record<string, unknown>;
  const idempotencyKey = legacyIdempotencyKey(request);
  if (!idempotencyKey) return null;
  const operation = input.operation ?? "create";
  if (operation !== "create" && operation !== "import") return null;
  const legacyKeys = [
    ...IDENTITY_ENVIRONMENT_BUSINESS_INPUT_KEYS,
    "operation",
    "identity_environment_ref",
    "execution_identity_ref",
    "profile_ref",
    "profile_storage_ref",
    "cookie_jar_ref",
    "browser_storage_ref",
    "credential_ref",
    "keychain_ref",
    "local_secret_ref",
    "imported_from"
  ];
  if (!onlyKeys(input, legacyKeys)) return null;
  const businessInput = Object.fromEntries(
    IDENTITY_ENVIRONMENT_BUSINESS_INPUT_KEYS
      .filter((key) => Object.hasOwn(input, key))
      .map((key) => [key, input[key]])
  ) as unknown as IdentityEnvironmentCreateInput;
  if (!isIdentityEnvironmentInput(businessInput)) return null;
  if (operation === "import") {
    return nonEmptyString(input.profile_storage_ref)
      ? { operation, idempotency_key: idempotencyKey, identity_environment: { ...businessInput, import_source_ref: input.profile_storage_ref } }
      : null;
  }
  return { operation, idempotency_key: idempotencyKey, identity_environment: businessInput };
}

export function legacyIdentityEnvironmentDeleteMutation(
  identityEnvironmentRef: string,
  value: unknown,
  request: IncomingMessage
): IdentityEnvironmentMutationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const idempotencyKey = legacyIdempotencyKey(request);
  if (!idempotencyKey) return null;
  if (input.operation === "remove" && Object.keys(input).length === 1) {
    return { operation: "remove", idempotency_key: idempotencyKey, identity_environment_ref: identityEnvironmentRef };
  }
  if (input.operation === "delete" && input.confirmation === "delete_local_data" && Object.keys(input).every((key) => key === "operation" || key === "confirmation")) {
    return { operation: "delete", idempotency_key: idempotencyKey, identity_environment_ref: identityEnvironmentRef, confirmation: "delete_local_data" };
  }
  return null;
}

export function legacyIdentityEnvironmentIdempotencyKey(request: IncomingMessage): string | null {
  return legacyIdempotencyKey(request);
}

function isIdentityEnvironmentInput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (!hasOnlyIdentityEnvironmentBusinessInputKeys(
    input,
    Object.hasOwn(input, "import_source_ref") ? "import" : "create"
  )) return false;
  if (!input.site || typeof input.site !== "object" || Array.isArray(input.site)) return false;
  const site = input.site as Record<string, unknown>;
  if (!onlyKeys(site, [...IDENTITY_ENVIRONMENT_SITE_INPUT_KEYS])) return false;
  if (!nonEmptyString(site.site_id) || !isHttpOrigin(site.origin) ||
    !optionalString(site.display_name) || !optionalString(site.account_identifier) || !optionalRef(site.account_ref)) return false;
  for (const key of [
    "import_source_ref", "proxy_ref", "proxy_label", "region", "language", "timezone", "viewport", "gpu_profile"
  ]) {
    if (!optionalString(input[key])) return false;
  }
  return optionalNumber(input.hardware_concurrency) && optionalNumber(input.device_memory_gb) &&
    optionalEnum(input.geoip_mode, ["proxy", "system", "disabled"]) &&
    optionalEnum(input.interaction_preset, ["default", "humanized"]) &&
    optionalEnum(input.fingerprint_strategy, ["provider_default", "stable"]) &&
    optionalEnum(input.requested_provider_id, ["cloakbrowser", "chrome_official"]);
}

function isIdentityEnvironmentMutationInput(value: unknown, operation: "create" | "import"): boolean {
  if (!isIdentityEnvironmentInput(value)) return false;
  const input = value as Record<string, unknown>;
  if (!hasOnlyIdentityEnvironmentBusinessInputKeys(input, operation)) return false;
  if (operation === "create") {
    return !Object.hasOwn(input, "profile_storage_ref") && !Object.hasOwn(input, "import_source_ref");
  }
  return !Object.hasOwn(input, "profile_storage_ref") && nonEmptyString(input.import_source_ref);
}

function legacyIdempotencyKey(request: IncomingMessage): string | null {
  const values = headerValues(request, "idempotency-key");
  return values.length === 1 && nonEmptyString(values[0]) && values[0].length <= 200 ? values[0] : null;
}

function headerValues(request: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) values.push(request.rawHeaders[index + 1]);
  }
  return values;
}

function isHttpOrigin(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
  } catch {
    return false;
  }
}

function nonEmptyString(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function optionalString(value: unknown): boolean { return value === undefined || typeof value === "string"; }
function optionalNullableString(value: unknown): boolean { return value === undefined || value === null || typeof value === "string"; }
function optionalRef(value: unknown): boolean { return value === undefined || nonEmptyString(value); }
function optionalNumber(value: unknown): boolean { return value === undefined || typeof value === "number" && Number.isFinite(value); }
function optionalEnum(value: unknown, allowed: string[]): boolean { return value === undefined || typeof value === "string" && allowed.includes(value); }
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
