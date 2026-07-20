import type { HarborIdentityEnvironmentFacts } from "./harbor-admission.js";
import type {
  LodePackageAdmissionContract,
  LodeRequiredHarborFact,
  LodeRuntimeConsumptionEntry
} from "./lode-admission.js";
import type { FailureRecord } from "./run-record-store.js";

export type LockedOperationSelection = {
  package_ref: string;
  lock_ref: string;
  version: string;
  operation_id: string;
  operation_mode: string;
  target_ref: string;
  target_origin: string;
  resource_requirement_ref: string;
  resource_requirement_profile_id: string;
};

export type LockedOperationMatch = {
  selection: LockedOperationSelection;
  runtime_consumption: LodeRuntimeConsumptionEntry;
  required_harbor_facts: readonly LodeRequiredHarborFact[];
};

function failure(code: string, phase: FailureRecord["phase"], recovery_hint: string): FailureRecord {
  return { category: code.startsWith("identity_") || code.startsWith("runtime_") ? "resource_admission" : "capability_contract", code, phase, recovery_hint };
}

function bounded(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function targetRefMatchesOrigin(targetRef: string, targetOrigin: string): boolean {
  try {
    const target = new URL(targetRef);
    return (target.protocol === "https:" || target.protocol === "http:") && target.origin === targetOrigin;
  } catch {
    return !targetRef.includes("://");
  }
}

export function matchLockedLodeOperation(
  contract: LodePackageAdmissionContract,
  selection: LockedOperationSelection
): LockedOperationMatch | FailureRecord {
  if (
    !bounded(selection.package_ref, 512) || !bounded(selection.lock_ref, 512) || !bounded(selection.version, 64) ||
    !bounded(selection.operation_id, 128) || !bounded(selection.operation_mode, 32) || !bounded(selection.target_ref, 2048) ||
    !bounded(selection.target_origin, 512) || !bounded(selection.resource_requirement_ref, 256) ||
    !bounded(selection.resource_requirement_profile_id, 256) || !exactOrigin(selection.target_origin) ||
    !targetRefMatchesOrigin(selection.target_ref, selection.target_origin)
  ) return failure("target_contract_invalid", "resource_matching", "fix_input");

  if (contract.package_ref !== selection.package_ref) return failure("package_ref_mismatch", "admission", "select_capability_version");
  if (!bounded(contract.lock_ref, 512) || contract.lock_ref !== selection.lock_ref) return failure("package_lock_mismatch", "admission", "select_capability_version");
  if (contract.version !== selection.version) return failure("capability_version_incompatible", "admission", "select_capability_version");
  if (contract.operation_id !== selection.operation_id || contract.operation_mode !== selection.operation_mode) {
    return failure("operation_id_mismatch", "admission", "select_capability_version");
  }

  const resource = contract.resource_requirements;
  if (
    resource.package_ref !== selection.package_ref || resource.operation_mode !== selection.operation_mode ||
    resource.resource_requirements_id !== selection.resource_requirement_ref
  ) return failure("resource_requirement_mismatch", "resource_matching", "repair_package_contract");
  const profiles = resource.resource_requirement_profiles.filter((profile) => profile.requirement_profile_id === selection.resource_requirement_profile_id);
  if (profiles.length !== 1 || (profiles[0]?.operation_boundary !== undefined && profiles[0].operation_boundary !== selection.operation_mode)) {
    return failure("resource_requirement_profile_mismatch", "resource_matching", "repair_package_contract");
  }

  const runtime = contract.runtime_consumption;
  if (!runtime) return failure("runtime_consumption_missing", "admission", "repair_package_contract");
  if (
    runtime.package_ref !== selection.package_ref || runtime.lock_ref !== selection.lock_ref || runtime.version !== selection.version ||
    runtime.operation_id !== selection.operation_id || runtime.operation_mode !== selection.operation_mode ||
    runtime.resource_requirements_id !== selection.resource_requirement_ref
  ) return failure("runtime_consumption_mismatch", "admission", "repair_package_contract");
  if (
    !bounded(runtime.site_slug, 128) || !Array.isArray(runtime.allowed_origins) || runtime.allowed_origins.length === 0 ||
    runtime.allowed_origins.length > 16 || !runtime.allowed_origins.every((origin) => bounded(origin, 512) && exactOrigin(origin))
  ) return failure("runtime_consumption_invalid", "admission", "repair_package_contract");
  if (!runtime.allowed_origins.some((origin) => sameOrigin(origin, selection.target_origin))) {
    return failure("target_origin_not_allowed", "resource_matching", "fix_input");
  }

  const requiredFacts = (profiles[0]?.required_harbor_facts ?? []).filter((fact) => fact.required !== false);
  return { selection, runtime_consumption: runtime, required_harbor_facts: requiredFacts as readonly LodeRequiredHarborFact[] };
}

export function matchLockedOperationIdentity(
  operation: LockedOperationMatch,
  identity: HarborIdentityEnvironmentFacts,
  requestedIdentityRef: string
): FailureRecord | undefined {
  if (
    identity.schema_version !== "harbor-local-identity-environment/v0" ||
    identity.identity_environment_ref !== requestedIdentityRef ||
    identity.site_binding.site_id !== operation.runtime_consumption.site_slug
  ) return failure("identity_runtime_mismatch", "runtime_binding", "select_matching_runtime");

  const login = identity.login_state;
  const provenance = login.reason ?? login.authentication_provenance;
  if (
    login.state !== "logged_in" || provenance !== "user_confirmed_managed_session" ||
    login.manual_authentication_state !== "completed" || login.recovery_required !== false
  ) return failure("identity_auth_required", "runtime_binding", "open_manual_auth");

  const origin = identity.site_binding.origin;
  if (
    !origin.startsWith("https://") || !exactOrigin(origin) || !sameOrigin(origin, operation.selection.target_origin) ||
    !operation.runtime_consumption.allowed_origins.some((allowed) => sameOrigin(origin, allowed))
  ) return failure("runtime_origin_not_allowed", "resource_matching", "fix_input");
  return undefined;
}
