import type { FailureRecord } from "./run-record-store.js";
import { isOpaqueDetailRef } from "./detail-target-store.js";
import {
  inferHarborIdentityResourceFacts,
  validateHarborIdentityEnvironmentFacts,
  validateHarborIdentityProviderStatus,
  type HarborBrowserProviderCatalog,
  type HarborIdentityEnvironmentFacts,
  type HarborPublicIdentityEnvironmentSnapshot
} from "./harbor-admission.js";
import {
  validateLodePackageAdmission,
  type LodePackageAdmissionContract,
  type LodeRequiredHarborFact
} from "./lode-admission.js";
import {
  matchLockedLodeOperation,
  matchLockedOperationIdentity,
  opaqueDetailOperationContract,
  type LockedOperationMatch
} from "./operation-identity-matcher.js";
import type { LodePackageResolver } from "./runtime-task-chain.js";
import { normalizePublicHttpTarget, normalizePublicOrigin } from "./public-target-reference.js";
import { isSensitiveFieldName } from "./sensitive-field-taxonomy.js";
export { createHttpHarborIdentityFactsReader, type HttpHarborIdentityFactsReaderOptions } from "./harbor-identity-facts-reader.js";

export const identityCompatibilityPreviewRequestSchemaVersion = "webenvoy.identity-compatibility-preview-request.v0" as const;
export const identityCompatibilityPreviewSchemaVersion = "webenvoy.identity-compatibility-preview.v0" as const;

export type IdentityCompatibilityStatus = "compatible" | "requires_setup" | "incompatible" | "unknown_until_runtime";
export type IdentityCompatibilityOwnerStatus = "available" | "unavailable" | "malformed" | "stale" | "not_checked";
export type IdentityCompatibilityRecoveryAction =
  | "none"
  | "select_supported_package_version"
  | "repair_package_contract"
  | "refresh_owner_facts"
  | "select_matching_identity"
  | "open_manual_auth"
  | "install_or_select_provider"
  | "repair_browser_environment"
  | "connect_identity_environment"
  | "fix_target"
  | "select_matching_resource_requirements"
  | "retry_at_task_submission";

export type IdentityCompatibilityPreviewRequest = {
  schema_version: typeof identityCompatibilityPreviewRequestSchemaVersion;
  package_ref: string;
  lock_ref: string;
  version: string;
  operation_id: string;
  operation_mode: "read" | "validate_only" | "draft" | "preview";
  target_ref: string;
  target_origin: string;
  resource_requirement_ref: string;
  resource_requirement_profile_id: string;
  identity_environment_refs: readonly string[];
};

export type HarborIdentityFactsReadResult =
  | ({ ok: true; owner_readiness: "ready"; provider_status: HarborBrowserProviderCatalog } & HarborPublicIdentityEnvironmentSnapshot)
  | { ok: false; owner_status: "unavailable" | "malformed"; reason_code: string };

export type HarborIdentityFactsReader = (identityEnvironmentRef: string) => Promise<HarborIdentityFactsReadResult>;

export type IdentityCompatibilityCandidate = {
  identity_environment_ref: string;
  status: IdentityCompatibilityStatus;
  reason_codes: readonly string[];
  missing_requirement_categories: readonly string[];
  fact_freshness: readonly {
    fact_key: string;
    required_freshness: string;
    state: "satisfied" | "missing" | "unknown_until_runtime";
  }[];
  owner_status: { lode: IdentityCompatibilityOwnerStatus; harbor: IdentityCompatibilityOwnerStatus };
  freshness: { state: "fresh" | "stale" | "unavailable"; observed_at?: string; age_ms?: number };
  recovery_action: IdentityCompatibilityRecoveryAction;
};

export type IdentityCompatibilityPreviewResponse = {
  schema_version: typeof identityCompatibilityPreviewSchemaVersion;
  package_ref: string;
  lock_ref: string;
  version: string;
  operation_id: string;
  operation_mode: IdentityCompatibilityPreviewRequest["operation_mode"];
  target_ref: string;
  target_origin: string;
  resource_requirement_ref: string;
  resource_requirement_profile_id: string;
  generated_at: string;
  candidates: readonly IdentityCompatibilityCandidate[];
  consumer_boundary: "Core returns bounded compatibility reasons and public freshness only; no task, thread, run, session, browser action, credential, cookie, token, profile storage, evidence body, or raw owner response is created or exposed.";
};

export type IdentityCompatibilityPreviewDependencies = {
  lodePackageResolver: LodePackageResolver;
  harborIdentityFactsReader: HarborIdentityFactsReader;
  clock?: () => Date;
  maxFactAgeMs?: number;
};

const requestFields = new Set([
  "schema_version", "package_ref", "lock_ref", "version", "operation_id", "operation_mode", "target_ref", "target_origin",
  "resource_requirement_ref", "resource_requirement_profile_id", "identity_environment_refs"
]);
const operationModes = new Set(["read", "validate_only", "draft", "preview"]);
const consumerBoundary =
  "Core returns bounded compatibility reasons and public freshness only; no task, thread, run, session, browser action, credential, cookie, token, profile storage, evidence body, or raw owner response is created or exposed." as const;
const maxCandidates = 32;
const maxRequiredFacts = 32;
const defaultMaxFactAgeMs = 5 * 60 * 1000;
const maxFutureSkewMs = 60 * 1000;

function failure(code: string, recovery_hint = "fix_input"): FailureRecord {
  return { category: "request_invalid", code, phase: "pre_admission", recovery_hint };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function findPrivateField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findPrivateField(entry);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) return key;
    const found = findPrivateField(entry);
    if (found) return found;
  }
  return undefined;
}

export function parseIdentityCompatibilityPreviewRequest(value: unknown): IdentityCompatibilityPreviewRequest | FailureRecord {
  const privateField = findPrivateField(value);
  if (privateField) return failure(`private_field_rejected:${privateField}`, "remove_private_field");
  const input = object(value);
  if (!input || Object.keys(input).some((key) => !requestFields.has(key))) return failure("identity_compatibility_request_invalid");
  const packageRef = boundedString(input.package_ref, 512);
  const lockRef = boundedString(input.lock_ref, 512);
  const version = boundedString(input.version, 64);
  const operationId = boundedString(input.operation_id, 128);
  const operationMode = boundedString(input.operation_mode, 32);
  const rawTargetRef = boundedString(input.target_ref, 2048);
  const rawTargetOrigin = boundedString(input.target_origin, 512);
  const publicTarget = rawTargetRef === undefined ? undefined : normalizePublicHttpTarget(rawTargetRef);
  const opaqueDetailRequest = packageRef === opaqueDetailOperationContract.package_ref &&
    lockRef === opaqueDetailOperationContract.lock_ref && version === opaqueDetailOperationContract.version &&
    operationId === opaqueDetailOperationContract.operation_id && operationMode === opaqueDetailOperationContract.operation_mode;
  const targetRef = opaqueDetailRequest
    ? isOpaqueDetailRef(rawTargetRef) ? rawTargetRef : undefined
    : publicTarget?.ok ? publicTarget.target_ref : undefined;
  const targetOrigin = rawTargetOrigin === undefined ? undefined : normalizePublicOrigin(rawTargetOrigin);
  const resourceRequirementRef = boundedString(input.resource_requirement_ref, 256);
  const resourceRequirementProfileId = boundedString(input.resource_requirement_profile_id, 256);
  const refs = input.identity_environment_refs;
  if (
    input.schema_version !== identityCompatibilityPreviewRequestSchemaVersion || !packageRef || !lockRef || !version || !operationId ||
    !operationMode || !operationModes.has(operationMode) || !targetRef || !targetOrigin || !resourceRequirementRef ||
    !resourceRequirementProfileId || (publicTarget?.ok === true && publicTarget.target_origin !== targetOrigin) ||
    !Array.isArray(refs) || refs.length === 0 || refs.length > maxCandidates
  ) return failure("identity_compatibility_request_invalid");
  const identityRefs = refs.map((entry) => boundedString(entry, 256));
  if (identityRefs.some((entry) => entry === undefined) || new Set(identityRefs).size !== identityRefs.length) {
    return failure("identity_environment_refs_invalid");
  }
  return {
    schema_version: identityCompatibilityPreviewRequestSchemaVersion,
    package_ref: packageRef,
    lock_ref: lockRef,
    version,
    operation_id: operationId,
    operation_mode: operationMode as IdentityCompatibilityPreviewRequest["operation_mode"],
    target_ref: targetRef,
    target_origin: targetOrigin,
    resource_requirement_ref: resourceRequirementRef,
    resource_requirement_profile_id: resourceRequirementProfileId,
    identity_environment_refs: identityRefs as string[]
  };
}

function packageOwnerStatus(code: string): IdentityCompatibilityOwnerStatus {
  return code === "lode_registry_unavailable" ? "unavailable" : "malformed";
}

function packageReason(code: string): { reason: string; recovery: IdentityCompatibilityRecoveryAction; owner: IdentityCompatibilityOwnerStatus } {
  if (code === "package_lock_mismatch" || code === "package_lock_missing") {
    return { reason: "package_lock_mismatch", recovery: "select_supported_package_version", owner: "available" };
  }
  if (code === "capability_version_incompatible") {
    return { reason: "package_version_mismatch", recovery: "select_supported_package_version", owner: "available" };
  }
  if (code === "operation_id_mismatch" || code === "operation_mode_mismatch") {
    return { reason: "package_operation_mismatch", recovery: "select_supported_package_version", owner: "available" };
  }
  if (code === "package_not_found" || code === "package_ref_mismatch") {
    return { reason: "package_not_found", recovery: "select_supported_package_version", owner: "available" };
  }
  if (code === "target_contract_invalid" || code === "target_origin_not_allowed") {
    return { reason: "target_origin_mismatch", recovery: "fix_target", owner: "available" };
  }
  if (code === "resource_requirement_mismatch" || code === "resource_requirement_profile_mismatch") {
    return { reason: "resource_requirement_mismatch", recovery: "select_matching_resource_requirements", owner: "available" };
  }
  const owner = packageOwnerStatus(code);
  return {
    reason: owner === "unavailable" ? "lode_owner_unavailable" : "lode_contract_malformed",
    recovery: owner === "unavailable" ? "refresh_owner_facts" : "repair_package_contract",
    owner
  };
}

function packageFailureCandidates(request: IdentityCompatibilityPreviewRequest, generatedAt: string, code: string): IdentityCompatibilityPreviewResponse {
  const projected = packageReason(code);
  return response(request, generatedAt, request.identity_environment_refs.map((identityRef) => ({
    identity_environment_ref: identityRef,
    status: "incompatible",
    reason_codes: [projected.reason],
    missing_requirement_categories: ["package_contract"],
    fact_freshness: [],
    owner_status: { lode: projected.owner, harbor: "not_checked" },
    freshness: { state: "unavailable" },
    recovery_action: projected.recovery
  })));
}

function response(
  request: IdentityCompatibilityPreviewRequest,
  generatedAt: string,
  candidates: readonly IdentityCompatibilityCandidate[],
  normalizedTargetRef = request.target_ref
): IdentityCompatibilityPreviewResponse {
  return {
    schema_version: identityCompatibilityPreviewSchemaVersion,
    package_ref: request.package_ref,
    lock_ref: request.lock_ref,
    version: request.version,
    operation_id: request.operation_id,
    operation_mode: request.operation_mode,
    target_ref: normalizedTargetRef,
    target_origin: request.target_origin,
    resource_requirement_ref: request.resource_requirement_ref,
    resource_requirement_profile_id: request.resource_requirement_profile_id,
    generated_at: generatedAt,
    candidates,
    consumer_boundary: consumerBoundary
  };
}

function validateResolvedPackage(
  contract: LodePackageAdmissionContract,
  request: IdentityCompatibilityPreviewRequest
): FailureRecord | { operation: LockedOperationMatch; requiredFacts: readonly LodeRequiredHarborFact[] } {
  const operation = matchLockedLodeOperation(contract, request);
  if ("category" in operation) return operation;
  const admission = validateLodePackageAdmission({
    capability: {
      ref: `lode:capability/${contract.capability_id}`,
      version: request.version,
      source_ref: request.package_ref,
      lock_ref: request.lock_ref
    },
    policy: {
      risk: request.operation_mode === "read" ? "read" : "write",
      execution_intent: request.operation_mode
    },
    resource_requirement_refs: [request.resource_requirement_ref],
    resource_requirement_profile_id: request.resource_requirement_profile_id
  }, { package_ref: request.package_ref, lode_package_contract: contract });
  if (!admission.ok) return admission.failure;
  if (
    admission.required_harbor_facts.length > maxRequiredFacts ||
    admission.required_harbor_facts.some((fact) => !boundedString(fact.fact_key, 128) || (fact.freshness !== undefined && !boundedString(fact.freshness, 64)))
  ) return { category: "capability_contract", code: "resource_requirements_unbounded", phase: "resource_matching", recovery_hint: "repair_package_contract" };
  return { operation, requiredFacts: admission.required_harbor_facts };
}

function strictIdentityFacts(facts: HarborIdentityEnvironmentFacts, expectedRef: string): boolean {
  if (facts.schema_version !== "harbor-local-identity-environment/v0" || facts.identity_environment_ref !== expectedRef) return false;
  if (!boundedString(facts.execution_identity_ref, 256) || !boundedString(facts.profile_ref, 256)) return false;
  if (!boundedString(facts.site_binding.site_id, 128) || !boundedString(facts.site_binding.origin, 512)) return false;
  if (!boundedString(facts.login_state.state, 64) || typeof facts.login_state.recovery_required !== "boolean") return false;
  if (!boundedString(facts.browser_storage.state, 64) || !boundedString(facts.provider_binding.binding_status, 128)) return false;
  if (facts.provider_binding.selected_provider_id !== null && !boundedString(facts.provider_binding.selected_provider_id, 256)) return false;
  try {
    const origin = new URL(facts.site_binding.origin);
    return origin.origin === facts.site_binding.origin && (origin.protocol === "https:" || origin.protocol === "http:");
  } catch {
    return false;
  }
}

function setupProjection(failureCode: string): { reason: string; category: string; recovery: IdentityCompatibilityRecoveryAction } | undefined {
  if (failureCode === "identity_auth_required") return { reason: "identity_auth_required", category: "authentication", recovery: "open_manual_auth" };
  if (failureCode === "browser_environment_repair_required") return { reason: "browser_environment_repair_required", category: "browser_environment", recovery: "repair_browser_environment" };
  if (failureCode === "identity_storage_unavailable") return { reason: "identity_storage_unavailable", category: "browser_environment", recovery: "repair_browser_environment" };
  if (failureCode === "browser_provider_unavailable") return { reason: "browser_provider_unavailable", category: "provider_binding", recovery: "install_or_select_provider" };
  return undefined;
}

function unavailableCandidate(identityRef: string, ownerStatus: "unavailable" | "malformed", reason: string): IdentityCompatibilityCandidate {
  return {
    identity_environment_ref: identityRef,
    status: "incompatible",
    reason_codes: [reason],
    missing_requirement_categories: ["owner_contract"],
    fact_freshness: [],
    owner_status: { lode: "available", harbor: ownerStatus },
    freshness: { state: "unavailable" },
    recovery_action: ownerStatus === "unavailable" ? "connect_identity_environment" : "refresh_owner_facts"
  };
}

function evaluateFreshCandidate(
  identityRef: string,
  facts: HarborIdentityEnvironmentFacts,
  providerStatus: HarborBrowserProviderCatalog,
  operation: LockedOperationMatch,
  requiredFacts: readonly LodeRequiredHarborFact[],
  freshness: IdentityCompatibilityCandidate["freshness"]
): IdentityCompatibilityCandidate {
  const identityAdmission = validateHarborIdentityEnvironmentFacts(facts);
  if ("category" in identityAdmission) {
    const setup = setupProjection(identityAdmission.code);
    if (!setup) return unavailableCandidate(identityRef, "malformed", "harbor_facts_malformed");
    return {
      identity_environment_ref: identityRef,
      status: "requires_setup",
      reason_codes: [setup.reason],
      missing_requirement_categories: [setup.category],
      fact_freshness: [],
      owner_status: { lode: "available", harbor: "available" },
      freshness,
      recovery_action: setup.recovery
    };
  }
  const operationIdentityFailure = matchLockedOperationIdentity(operation, facts, identityRef);
  if (operationIdentityFailure) {
    const setup = setupProjection(operationIdentityFailure.code);
    return {
      identity_environment_ref: identityRef,
      status: setup ? "requires_setup" : "incompatible",
      reason_codes: [setup?.reason ?? (operationIdentityFailure.code === "identity_runtime_mismatch" ? "identity_site_mismatch" : "identity_origin_mismatch")],
      missing_requirement_categories: [setup?.category ?? (operationIdentityFailure.code === "identity_runtime_mismatch" ? "site_binding" : "origin_binding")],
      fact_freshness: [],
      owner_status: { lode: "available", harbor: "available" },
      freshness,
      recovery_action: setup?.recovery ?? "select_matching_identity"
    };
  }
  const providerFailure = validateHarborIdentityProviderStatus(facts, providerStatus);
  if (providerFailure) {
    const setup = setupProjection(providerFailure.code);
    if (!setup) return unavailableCandidate(identityRef, "malformed", "harbor_provider_facts_malformed");
    return {
      identity_environment_ref: identityRef,
      status: "requires_setup",
      reason_codes: [setup.reason],
      missing_requirement_categories: [setup.category],
      fact_freshness: [],
      owner_status: { lode: "available", harbor: "available" },
      freshness,
      recovery_action: setup.recovery
    };
  }
  const availableFacts = new Set(inferHarborIdentityResourceFacts(facts));
  const factFreshness = requiredFacts.map((fact) => ({
    fact_key: fact.fact_key,
    required_freshness: fact.freshness ?? "owner_current",
    state: fact.freshness === "current_execution_window"
      ? "unknown_until_runtime" as const
      : availableFacts.has(fact.fact_key) ? "satisfied" as const : "missing" as const
  }));
  const runtimeUnknown = factFreshness.some((fact) => fact.state === "unknown_until_runtime" || fact.state === "missing");
  return {
    identity_environment_ref: identityRef,
    status: runtimeUnknown ? "unknown_until_runtime" : "compatible",
    reason_codes: runtimeUnknown ? ["runtime_facts_require_task_admission"] : [],
    missing_requirement_categories: runtimeUnknown ? ["runtime_facts"] : [],
    fact_freshness: factFreshness,
    owner_status: { lode: "available", harbor: "available" },
    freshness,
    recovery_action: runtimeUnknown ? "retry_at_task_submission" : "none"
  };
}

async function evaluateCandidate(
  identityRef: string,
  operation: LockedOperationMatch,
  requiredFacts: readonly LodeRequiredHarborFact[],
  readFacts: HarborIdentityFactsReader,
  clock: () => Date,
  maxFactAgeMs: number
): Promise<IdentityCompatibilityCandidate> {
  let read: HarborIdentityFactsReadResult;
  try {
    read = await readFacts(identityRef);
  } catch {
    return unavailableCandidate(identityRef, "unavailable", "harbor_owner_unavailable");
  }
  if (!read.ok) return unavailableCandidate(identityRef, read.owner_status, read.reason_code === "identity_environment_not_found" ? "identity_environment_not_found" : `harbor_owner_${read.owner_status}`);
  if (!strictIdentityFacts(read.facts, identityRef) || !read.observed_at) return unavailableCandidate(identityRef, "malformed", "harbor_facts_malformed");
  const now = clock();
  if (!Number.isFinite(now.getTime())) return unavailableCandidate(identityRef, "malformed", "harbor_facts_malformed");
  const observedAt = Date.parse(read.observed_at);
  const ageMs = now.getTime() - observedAt;
  if (!Number.isFinite(observedAt) || ageMs < -maxFutureSkewMs) return unavailableCandidate(identityRef, "malformed", "harbor_facts_malformed");
  if (ageMs > maxFactAgeMs) {
    return {
      ...unavailableCandidate(identityRef, "malformed", "harbor_facts_stale"),
      owner_status: { lode: "available", harbor: "stale" },
      freshness: { state: "stale", observed_at: read.observed_at, age_ms: ageMs },
      recovery_action: "refresh_owner_facts"
    };
  }

  return evaluateFreshCandidate(identityRef, read.facts, read.provider_status, operation, requiredFacts, {
    state: "fresh",
    observed_at: read.observed_at,
    age_ms: Math.max(0, ageMs)
  });
}

export async function previewIdentityCompatibility(
  rawRequest: unknown,
  dependencies: IdentityCompatibilityPreviewDependencies
): Promise<IdentityCompatibilityPreviewResponse | FailureRecord> {
  const request = parseIdentityCompatibilityPreviewRequest(rawRequest);
  if ("category" in request) return request;
  const clock = dependencies.clock ?? (() => new Date());
  const now = clock();
  const maxFactAgeMs = dependencies.maxFactAgeMs ?? defaultMaxFactAgeMs;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(maxFactAgeMs) || maxFactAgeMs <= 0) return failure("identity_compatibility_configuration_invalid", "contact_operator");
  const generatedAt = now.toISOString();
  let resolved: Awaited<ReturnType<LodePackageResolver>>;
  try {
    resolved = await dependencies.lodePackageResolver({ package_ref: request.package_ref, task_intent: request });
  } catch {
    return packageFailureCandidates(request, generatedAt, "lode_registry_unavailable");
  }
  if ("category" in resolved) return packageFailureCandidates(request, generatedAt, resolved.code);
  const packageMatch = validateResolvedPackage(resolved, request);
  if ("category" in packageMatch) return packageFailureCandidates(request, generatedAt, packageMatch.code);
  const candidates = new Array<IdentityCompatibilityCandidate>(request.identity_environment_refs.length);
  let nextCandidate = 0;
  const workers = Array.from({ length: Math.min(4, request.identity_environment_refs.length) }, async () => {
    while (nextCandidate < request.identity_environment_refs.length) {
      const index = nextCandidate;
      nextCandidate += 1;
      const identityRef = request.identity_environment_refs[index];
      if (identityRef) candidates[index] = await evaluateCandidate(identityRef, packageMatch.operation, packageMatch.requiredFacts, dependencies.harborIdentityFactsReader, clock, maxFactAgeMs);
    }
  });
  await Promise.all(workers);
  return response(request, generatedAt, candidates, packageMatch.operation.selection.target_ref);
}
