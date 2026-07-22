import { validateHarborIdentityEnvironmentFacts, type HarborIdentityEnvironmentFacts } from "./harbor-admission.js";
import { isOpaqueDetailRef } from "./detail-target-store.js";
import type {
  LodePackageAdmissionContract,
  LodeRequiredHarborFact,
  LodeRuntimeConsumptionEntry
} from "./lode-admission.js";
import type { FailureRecord } from "./run-record-store.js";
import { normalizePublicHttpTarget, normalizePublicOrigin } from "./public-target-reference.js";

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

export const opaqueDetailOperationContract = {
  package_ref: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
  lock_ref: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
  version: "0.1.0",
  site_slug: "xiaohongshu",
  operation_id: "xhs_read_note_detail",
  operation_mode: "read"
} as const;

function failure(code: string, phase: FailureRecord["phase"], recovery_hint: string): FailureRecord {
  return { category: code.startsWith("identity_") || code.startsWith("runtime_") ? "resource_admission" : "capability_contract", code, phase, recovery_hint };
}

function bounded(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export function isOpaqueDetailOperationContract(runtime: LodeRuntimeConsumptionEntry | undefined): boolean {
  return runtime?.package_ref === opaqueDetailOperationContract.package_ref &&
    runtime.lock_ref === opaqueDetailOperationContract.lock_ref &&
    runtime.version === opaqueDetailOperationContract.version && runtime.site_slug === opaqueDetailOperationContract.site_slug &&
    runtime.operation_id === opaqueDetailOperationContract.operation_id && runtime.operation_mode === opaqueDetailOperationContract.operation_mode;
}

function normalizeTargetRef(
  runtime: LodeRuntimeConsumptionEntry,
  targetRef: string,
  targetOrigin: string
): string | undefined {
  if (isOpaqueDetailOperationContract(runtime)) return isOpaqueDetailRef(targetRef) ? targetRef : undefined;
  const publicTarget = normalizePublicHttpTarget(targetRef);
  if (publicTarget.ok) return publicTarget.target_origin === targetOrigin ? publicTarget.target_ref : undefined;
  return undefined;
}

export function matchLockedLodeOperation(
  contract: LodePackageAdmissionContract,
  selection: LockedOperationSelection
): LockedOperationMatch | FailureRecord {
  if (
    !bounded(selection.package_ref, 512) || !bounded(selection.lock_ref, 512) || !bounded(selection.version, 64) ||
    !bounded(selection.operation_id, 128) || !bounded(selection.operation_mode, 32) || !bounded(selection.target_ref, 2048) ||
    !bounded(selection.target_origin, 512) || !bounded(selection.resource_requirement_ref, 256) ||
    !bounded(selection.resource_requirement_profile_id, 256) ||
    !normalizePublicOrigin(selection.target_origin)
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
  const profiles = resource.resource_requirement_profiles.filter(
    (profile) => profile.requirement_profile_id === selection.resource_requirement_profile_id
  );
  if (
    profiles.length !== 1 ||
    profiles.some((profile) => !bounded(profile.requirement_profile_id, 256) || (profile.operation_boundary !== undefined && profile.operation_boundary !== selection.operation_mode))
  ) {
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
    runtime.allowed_origins.length > 16 || !runtime.allowed_origins.every((origin) => bounded(origin, 512) && Boolean(normalizePublicOrigin(origin)))
  ) return failure("runtime_consumption_invalid", "admission", "repair_package_contract");
  if (!runtime.allowed_origins.some((origin) => sameOrigin(origin, selection.target_origin))) {
    return failure("target_origin_not_allowed", "resource_matching", "fix_input");
  }

  const normalizedTargetRef = normalizeTargetRef(runtime, selection.target_ref, selection.target_origin);
  if (!normalizedTargetRef) return failure("target_contract_invalid", "resource_matching", "fix_input");
  const requiredFacts = profiles.flatMap((profile) => profile.required_harbor_facts ?? []).filter((fact) => fact.required !== false);
  return {
    selection: { ...selection, target_ref: normalizedTargetRef },
    runtime_consumption: runtime,
    required_harbor_facts: requiredFacts as readonly LodeRequiredHarborFact[]
  };
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

  const admission = validateHarborIdentityEnvironmentFacts(identity, operation.selection.operation_mode === "read" ? "read" : "write_precheck");
  if ("category" in admission) return admission;

  const login = identity.login_state;
  const provenance = login.reason ?? login.authentication_provenance;
  if (
    operation.selection.operation_mode !== "read" &&
    (login.state !== "logged_in" || provenance !== "user_confirmed_managed_session" || login.manual_authentication_state !== "completed")
  ) return failure("identity_auth_required", "runtime_binding", "open_manual_auth");

  const origin = identity.site_binding.origin;
  if (
    !origin.startsWith("https://") || !normalizePublicOrigin(origin) || !sameOrigin(origin, operation.selection.target_origin) ||
    !operation.runtime_consumption.allowed_origins.some((allowed) => sameOrigin(origin, allowed))
  ) return failure("runtime_origin_not_allowed", "resource_matching", "fix_input");
  return undefined;
}
