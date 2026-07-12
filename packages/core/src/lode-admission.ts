import type { FailureRecord } from "./run-record-store.js";
import { normalizeFailureRecord } from "./failure-attribution.js";

export type LodePackageAdmissionContract = {
  package_ref: string;
  source_ref?: string;
  lock_ref?: string;
  capability_id: string;
  operation_id?: string;
  operation_mode: string;
  version: string;
  lifecycle?: string;
  runtime_admission?: LodeRuntimeAdmissionPolicy;
  resource_requirements: {
    schema_version?: string;
    resource_requirements_id: string;
    resource_requirements_version?: string;
    package_ref: string;
    operation_mode: string;
    resource_requirement_profiles: readonly {
      requirement_profile_id: string;
      operation_boundary?: string;
      required_harbor_facts?: readonly {
        fact_key: string;
        owner: string;
        required?: boolean;
        freshness?: string;
      }[];
    }[];
  };
  runtime_consumption?: LodeRuntimeConsumptionEntry;
};

export type LodeRuntimeAdmissionPolicy = {
  enabled: boolean;
  status: "current" | "deferred_experimental";
  recheck_condition:
    | "not_applicable"
    | "deferred_milestone_scope_restored_with_current_head_review_and_runtime_live_evidence";
};

export type LodeRuntimeConsumptionEntry = {
  allowlist_id: string;
  allowlist_version: string;
  asset_owner: string;
  consumer: { repository: string; issue: string; purpose: string };
  package_ref: string;
  lock_ref: string;
  version: string;
  site_slug: string;
  operation_id: string;
  operation_mode: string;
  lifecycle: string;
  allowed_origins: readonly string[];
  resource_requirements_id: string;
  failure_mapping_id: string;
  required_failure_classes: readonly string[];
  required_source_ref_kinds: readonly string[];
  required_evidence_ref_kinds: readonly string[];
  post_check_id: string;
  required_post_check_fields: readonly string[];
};

export type LodeRequiredHarborFact = {
  fact_key: string;
  owner: "Harbor";
  required?: boolean;
  freshness?: string;
};

export type LodeAdmissionInput = {
  package_ref?: string;
  lode_package_contract?: LodePackageAdmissionContract;
};

export type LodeAdmissionTaskIntent = {
  capability: {
    ref: string;
    version: string;
    source_ref?: string;
    lock_ref?: string;
  };
  policy: {
    risk: "read" | "write" | "submit" | "destructive";
    execution_intent: "read" | "validate_only" | "draft" | "preview" | "execute_after_approval" | "reconcile_status" | "request_cancel";
  };
  resource_requirement_refs: readonly string[];
};

export type LodeAdmission =
  | {
      ok: true;
      package_ref: string;
      capability_version: string;
      capability_source_ref?: string;
      capability_lock_ref?: string;
      resource_requirement_refs: readonly string[];
      required_harbor_facts: readonly LodeRequiredHarborFact[];
      runtime_consumption?: LodeRuntimeConsumptionEntry;
    }
  | {
      ok: false;
      failure: FailureRecord;
      package_ref?: string;
    };

const lodeForbiddenFieldNames = new Set([
  "raw_payload",
  "dom",
  "har",
  "screenshot",
  "video",
  "cookie",
  "cookies",
  "token",
  "tokens",
  "local_path",
  "ui_state",
  "runtime_session",
  "runtime_session_id",
  "provider_key",
  "harbor_profile_id",
  "profile_state",
  "live_tab_state",
  "storage_url",
  "proxy",
  "raw_evidence_body",
  "full_dom",
  "screenshot_body",
  "network_response_body",
  "production_payload",
  "user_business_data"
]);
const lodeOperationModes = new Set(["read", "validate_only", "draft", "preview", "write"]);
const lodeAllowedLifecycleStates = new Set(["proposed", "active", "suspected_broken", "broken", "deprecated"]);

function admissionFailure(category: FailureRecord["category"], code: string, phase: FailureRecord["phase"], recoveryHint: string): FailureRecord {
  return normalizeFailureRecord({
    category,
    code,
    phase,
    recovery_hint: recoveryHint
  });
}

function findForbiddenField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenField(entry);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (lodeForbiddenFieldNames.has(key)) {
      return key;
    }
    const found = findForbiddenField(entry);
    if (found) return found;
  }
  return undefined;
}

function expectedCapabilityRef(capabilityId: string): string {
  return `lode:capability/${capabilityId}`;
}

function contractObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function contractString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidLodeContract(code = "invalid_contract", phase: FailureRecord["phase"] = "admission"): FailureRecord {
  return admissionFailure("capability_contract", code, phase, "repair_package_contract");
}

export function parseLodeRuntimeAdmissionPolicy(
  packageRef: string,
  value: unknown
): LodeRuntimeAdmissionPolicy | FailureRecord | undefined {
  const sitePackage = /^lode:\/\/site-capability\/(xiaohongshu|boss)\//.test(packageRef);
  if (value === undefined) {
    return sitePackage ? invalidLodeContract("runtime_admission_policy_missing") : undefined;
  }
  const policy = contractObject(value);
  if (!policy || Object.keys(policy).sort().join(",") !== "enabled,recheck_condition,status") {
    return invalidLodeContract("runtime_admission_policy_invalid");
  }
  const current =
    policy.enabled === true &&
    policy.status === "current" &&
    policy.recheck_condition === "not_applicable";
  const deferred =
    policy.enabled === false &&
    policy.status === "deferred_experimental" &&
    policy.recheck_condition ===
      "deferred_milestone_scope_restored_with_current_head_review_and_runtime_live_evidence";
  if (!current && !deferred) {
    return invalidLodeContract("runtime_admission_policy_invalid");
  }
  return policy as LodeRuntimeAdmissionPolicy;
}

export function lodeRuntimeAdmissionFailure(
  packageRef: string,
  value: unknown
): FailureRecord | undefined {
  const policy = parseLodeRuntimeAdmissionPolicy(packageRef, value);
  if (policy === undefined || "category" in policy) return policy;
  return policy.enabled
    ? undefined
    : admissionFailure(
        "capability_contract",
        "runtime_admission_disabled",
        "admission",
        "wait_for_scope_activation"
      );
}

function lifecycleFailure(lifecycle: string): FailureRecord | undefined {
  if (!lodeAllowedLifecycleStates.has(lifecycle)) {
    return invalidLodeContract("invalid_lifecycle");
  }
  if (lifecycle === "broken") {
    return admissionFailure("capability_contract", "capability_broken", "admission", "repair_package_or_choose_known_good");
  }
  if (lifecycle === "deprecated") {
    return admissionFailure("capability_contract", "capability_deprecated", "admission", "choose_latest_or_known_good");
  }
  if (lifecycle === "suspected_broken") {
    return admissionFailure("capability_contract", "capability_suspected_broken", "admission", "run_validation_or_choose_known_good");
  }
  return undefined;
}

function validateLodeResourceRequirements(
  taskIntent: LodeAdmissionTaskIntent,
  packageRef: string,
  operationMode: string,
  value: unknown
): FailureRecord | { resourceRequirementRefs: readonly string[]; requiredHarborFacts: readonly LodeRequiredHarborFact[] } {
  const resource = contractObject(value);
  if (!resource) {
    return invalidLodeContract();
  }
  const resourceId = contractString(resource.resource_requirements_id);
  const resourcePackageRef = contractString(resource.package_ref);
  const resourceOperationMode = contractString(resource.operation_mode);
  const profiles = Array.isArray(resource.resource_requirement_profiles) ? resource.resource_requirement_profiles : undefined;
  if (!resourceId || !resourcePackageRef || !resourceOperationMode || !profiles?.length) {
    return invalidLodeContract("invalid_contract", "resource_matching");
  }
  if (resourcePackageRef !== packageRef || resourceOperationMode !== operationMode) {
    return invalidLodeContract("invalid_contract", "resource_matching");
  }
  const requiredHarborFacts: LodeRequiredHarborFact[] = [];
  for (const profileValue of profiles) {
    const profile = contractObject(profileValue);
    if (!profile || !contractString(profile.requirement_profile_id)) {
      return invalidLodeContract("invalid_contract", "resource_matching");
    }
    if (profile.operation_boundary !== undefined && profile.operation_boundary !== operationMode) {
      return admissionFailure("action_risk", "true_write_deferred", "admission", "use_read_intent");
    }
    if (profile.required_harbor_facts !== undefined) {
      if (!Array.isArray(profile.required_harbor_facts)) {
        return invalidLodeContract("invalid_contract", "resource_matching");
      }
      for (const factValue of profile.required_harbor_facts) {
        const fact = contractObject(factValue);
        if (!fact || !contractString(fact.fact_key) || fact.owner !== "Harbor") {
          return invalidLodeContract("invalid_contract", "resource_matching");
        }
        if (fact.required !== false) {
          requiredHarborFacts.push({
            fact_key: fact.fact_key as string,
            owner: "Harbor",
            ...(fact.required === undefined ? {} : { required: fact.required as boolean }),
            ...(contractString(fact.freshness) === undefined ? {} : { freshness: fact.freshness as string })
          });
        }
      }
    }
  }
  if (taskIntent.resource_requirement_refs.length === 0 || !taskIntent.resource_requirement_refs.every((ref) => ref === resourceId)) {
    return admissionFailure("resource_admission", "resource_requirement_missing", "resource_matching", "repair_package_contract");
  }
  return { resourceRequirementRefs: taskIntent.resource_requirement_refs, requiredHarborFacts };
}

export function validateLodePackageAdmission(taskIntent: LodeAdmissionTaskIntent, input: LodeAdmissionInput): LodeAdmission {
  const requestedPackageRef = input.package_ref;
  if (!requestedPackageRef) {
    return { ok: false, failure: invalidLodeContract("package_ref_required") };
  }
  const lodePackage = contractObject(input.lode_package_contract);
  if (!lodePackage) {
    return { ok: false, failure: invalidLodeContract("package_contract_required"), package_ref: requestedPackageRef };
  }
  const forbiddenField = findForbiddenField(lodePackage);
  if (forbiddenField) {
    return { ok: false, failure: invalidLodeContract(`forbidden_field:${forbiddenField}`), package_ref: requestedPackageRef };
  }
  const packageRef = contractString(lodePackage.package_ref);
  const capabilityId = contractString(lodePackage.capability_id);
  const operationMode = contractString(lodePackage.operation_mode);
  const version = contractString(lodePackage.version);
  if (!packageRef || !capabilityId || !operationMode || !version) {
    return { ok: false, failure: invalidLodeContract(), package_ref: requestedPackageRef };
  }
  if (packageRef !== requestedPackageRef) {
    return { ok: false, failure: invalidLodeContract("package_ref_mismatch"), package_ref: requestedPackageRef };
  }
  const runtimeAdmissionFailure = lodeRuntimeAdmissionFailure(packageRef, lodePackage.runtime_admission);
  if (runtimeAdmissionFailure) {
    return { ok: false, failure: runtimeAdmissionFailure, package_ref: packageRef };
  }
  if (!contractString(lodePackage.lock_ref)) {
    return { ok: false, failure: invalidLodeContract("package_lock_missing"), package_ref: packageRef };
  }
  const lockRef = contractString(lodePackage.lock_ref);
  const sourceRef = contractString(lodePackage.source_ref) ?? packageRef;
  if (taskIntent.capability.lock_ref !== undefined && taskIntent.capability.lock_ref !== lockRef) {
    return { ok: false, failure: invalidLodeContract("package_lock_mismatch"), package_ref: packageRef };
  }
  if (taskIntent.capability.source_ref !== undefined && taskIntent.capability.source_ref !== sourceRef) {
    return { ok: false, failure: invalidLodeContract("capability_source_mismatch"), package_ref: packageRef };
  }
  if (taskIntent.capability.ref !== expectedCapabilityRef(capabilityId) && taskIntent.capability.ref !== capabilityId) {
    return { ok: false, failure: invalidLodeContract("capability_ref_mismatch"), package_ref: packageRef };
  }
  if (taskIntent.capability.version !== version) {
    return { ok: false, failure: invalidLodeContract("capability_version_incompatible"), package_ref: packageRef };
  }
  if (!lodeOperationModes.has(operationMode)) {
    return { ok: false, failure: invalidLodeContract(), package_ref: packageRef };
  }
  if (lodePackage.lifecycle !== undefined) {
    const lifecycle = contractString(lodePackage.lifecycle);
    if (!lifecycle) {
      return { ok: false, failure: invalidLodeContract("invalid_lifecycle"), package_ref: packageRef };
    }
    const failure = lifecycleFailure(lifecycle);
    if (failure) {
      return { ok: false, failure, package_ref: packageRef };
    }
  }
  if (operationMode === "write") {
    return { ok: false, failure: admissionFailure("action_risk", "true_write_deferred", "admission", "use_read_intent"), package_ref: packageRef };
  }
  if (operationMode !== taskIntent.policy.execution_intent) {
    return { ok: false, failure: invalidLodeContract("operation_mode_mismatch"), package_ref: packageRef };
  }
  if (operationMode !== "read" && taskIntent.policy.risk === "read") {
    return { ok: false, failure: admissionFailure("action_risk", "write_precheck_risk_required", "admission", "use_validate_or_preview"), package_ref: packageRef };
  }
  const resourceRequirements = validateLodeResourceRequirements(taskIntent, packageRef, operationMode, lodePackage.resource_requirements);
  if ("category" in resourceRequirements) {
    return { ok: false, failure: resourceRequirements, package_ref: packageRef };
  }
  return {
    ok: true,
    package_ref: packageRef,
    capability_version: version,
    capability_source_ref: sourceRef,
    ...(lockRef === undefined ? {} : { capability_lock_ref: lockRef }),
    resource_requirement_refs: resourceRequirements.resourceRequirementRefs,
    required_harbor_facts: resourceRequirements.requiredHarborFacts,
    ...(lodePackage.runtime_consumption === undefined ? {} : { runtime_consumption: lodePackage.runtime_consumption as LodeRuntimeConsumptionEntry })
  };
}
