import { isManualAuthenticationCompletionPath } from "./manualAuthenticationCompletion.js";

export { projectOwnerApiError } from "./ownerApiErrorProjection.js";

export type OwnerApiJsonRequest = {
  base?: unknown;
  path?: unknown;
  method?: unknown;
  body?: unknown;
};

type OwnerApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ParsedOwnerApiRequest =
  | { ok: true; base: string; url: string; path: string; method: OwnerApiMethod; body?: unknown }
  | { ok: false; error: string };

const ownerApiAllowedHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const sensitiveOwnerApiFragment =
  /\b(token|cookie|secret|bearer|profile|credential|password|authorization)\b|raw[\s_-]*evidence/i;
const authorizationDecisionRefPattern = /^authorization-decision:[a-f0-9]{32}:[a-f0-9]{32}$/;
const identityMutationOperations = new Set(["create", "import", "edit", "copy_full", "copy_environment", "remove", "delete"]);
const identityMutationStatuses = new Set(["rejected", "repair_required"]);
const identityMutationIndexEffects = new Set(["registered", "updated", "removed", "unchanged"]);
const identityMutationLocalDataEffects = new Set(["created", "copied", "excluded", "preserved", "deleted", "unchanged", "residual"]);
const identityMutationLoginEffects = new Set(["preserved_unverified", "excluded", "unchanged"]);
const identityMutationFailureCodes = new Set([
  "active_session", "duplicate_identity", "duplicate_import", "idempotency_conflict",
  "identity_environment_missing", "invalid_request", "mutation_failed", "persistence_failed",
  "profile_locked", "profile_storage_exists", "provider_mismatch", "proxy_policy_incompatible",
  "proxy_resolution_unavailable", "proxy_unreachable", "proxy_validation_unavailable", "repair_required",
  "source_in_use", "source_material_missing", "target_in_use", "local_material_cleanup_failed",
  "local_material_cleanup_unavailable", "local_material_copy_failed", "local_material_copy_unavailable",
  "unsupported_configuration",
]);

export function parseOwnerApiRequest(request: OwnerApiJsonRequest): ParsedOwnerApiRequest {
  if (typeof request?.base !== "string" || typeof request.path !== "string") {
    return { ok: false, error: "Owner API request requires base and path strings." };
  }
  const method = ownerApiMethod(request.method);
  if (!method) return { ok: false, error: "Owner API method is not allowed." };
  if (!request.path.startsWith("/") || request.path.startsWith("//")) {
    return { ok: false, error: "Owner API path must be an absolute local path." };
  }
  const knownAuthorizationPath = isAuthorizationDecisionPath(request.path);
  if (sensitiveOwnerApiFragment.test(request.base) || sensitiveOwnerApiFragment.test(request.path) && !knownAuthorizationPath) {
    return { ok: false, error: "Owner API URL cannot include sensitive fragments." };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(request.base);
  } catch {
    return { ok: false, error: "Owner API base must be a valid URL." };
  }
  if (baseUrl.protocol !== "http:") {
    return { ok: false, error: "Owner API base must use http on the local machine." };
  }
  if (!ownerApiAllowedHosts.has(baseUrl.hostname)) {
    return { ok: false, error: "Owner API host must be localhost or loopback." };
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    return { ok: false, error: "Owner API base cannot include credentials, query, or hash." };
  }

  const url = new URL(request.path, `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, "")}/`);
  if (url.origin !== baseUrl.origin) {
    return { ok: false, error: "Owner API path must stay on the configured local origin." };
  }
  if (isManualAuthenticationCompletionPath(url.pathname)) {
    return { ok: false, error: "Manual authentication completion requires its dedicated IPC intent." };
  }
  return {
    ok: true,
    base: baseUrl.toString(),
    url: url.toString(),
    path: `${url.pathname}${url.search}`,
    method,
    ...(request.body === undefined ? {} : { body: request.body }),
  };
}

function isAuthorizationDecisionPath(value: string) {
  const match = /^\/authorization-decisions\/([^/]+)(?:\/single-action)?$/.exec(value);
  if (!match) return false;
  try {
    return authorizationDecisionRefPattern.test(decodeURIComponent(match[1]!));
  } catch {
    return false;
  }
}

export function isHarborSupervisorProtectedRequest(request: Extract<ParsedOwnerApiRequest, { ok: true }>) {
  const pathname = new URL(request.url).pathname;
  if (
    request.method === "POST" &&
    (pathname === "/runtime/identity-environment-mutations" || pathname === "/runtime/identity-environments")
  ) {
    return true;
  }
  if (
    (request.method === "PATCH" || request.method === "DELETE") &&
    /^\/runtime\/identity-environments\/[^/]+$/.test(pathname)
  ) {
    return true;
  }
  if (request.method !== "POST") return false;
  if ([
    "/runtime/identity-environment-sessions",
    "/runtime/sessions/identity-environment",
    "/identity-environment-sessions",
  ].includes(pathname)) {
    return true;
  }
  return /^\/(?:runtime\/)?sessions\/[^/]+\/(?:lock|release|stop|read-operations|snapshot)$/.test(pathname);
}

export function harborSupervisorAuthorizationHeader(
  request: Extract<ParsedOwnerApiRequest, { ok: true }>,
  supervisorToken: string | undefined,
) {
  return isHarborSupervisorProtectedRequest(request) && supervisorToken
    ? `Bearer ${supervisorToken}`
    : undefined;
}

export function ownerApiTimeoutMs(request: Extract<ParsedOwnerApiRequest, { ok: true }>) {
  if (request.method === "POST" && (request.path === "/tasks" || /^\/threads\/[^/]+\/turns$/.test(new URL(request.url).pathname))) return 65_000;
  if (isHarborSupervisorProtectedRequest(request)) return 20_000;
  return 5_000;
}

export function projectHarborIdentityMutationErrorBody(path: string, value: unknown) {
  if (new URL(path, "http://localhost").pathname !== "/runtime/identity-environment-mutations" || !isRecord(value)) return undefined;
  const effects = isRecord(value.effects) ? value.effects : null;
  const failure = isRecord(value.failure) ? value.failure : null;
  const boundary = isRecord(value.public_boundary) ? value.public_boundary : null;
  if (
    value.schema_version !== "harbor-identity-environment-mutation/v1" ||
    typeof value.operation !== "string" || !identityMutationOperations.has(value.operation) ||
    typeof value.status !== "string" || !identityMutationStatuses.has(value.status) ||
    !nullableString(value.identity_environment_ref) || !nullableString(value.source_identity_environment_ref) ||
    !effects || !identityMutationIndexEffects.has(String(effects.index)) ||
    !identityMutationLocalDataEffects.has(String(effects.local_data)) ||
    !identityMutationLoginEffects.has(String(effects.login_state)) ||
    !failure || typeof failure.code !== "string" || !identityMutationFailureCodes.has(failure.code) ||
    typeof failure.retryable !== "boolean" || !stringArray(failure.recovery_actions) ||
    !boundary || boundary.output !== "status_and_redacted_refs_only" || boundary.raw_material !== "not_exposed"
  ) return undefined;
  return {
    schema_version: "harbor-identity-environment-mutation/v1",
    operation: value.operation,
    status: value.status,
    identity_environment_ref: value.identity_environment_ref,
    source_identity_environment_ref: value.source_identity_environment_ref,
    effects: { index: effects.index, local_data: effects.local_data, login_state: effects.login_state },
    failure: { code: failure.code, retryable: failure.retryable, recovery_actions: failure.recovery_actions },
    public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed" },
  };
}

function ownerApiMethod(value: unknown): OwnerApiMethod | null {
  if (value === undefined) return "GET";
  return value === "GET" || value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
