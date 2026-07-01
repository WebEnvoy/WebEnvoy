import type { FailureRecord } from "./run-record-store.js";

export type LodePackageAdmissionContract = {
  package_ref: string;
  lock_ref?: string;
  capability_id: string;
  operation_id?: string;
  operation_mode: string;
  version: string;
  lifecycle?: string;
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
};

export type LodeAdmissionInput = {
  package_ref?: string;
  lode_package_contract?: LodePackageAdmissionContract;
};

export type LodeAdmissionTaskIntent = {
  capability: {
    ref: string;
    version: string;
  };
  resource_requirement_refs: readonly string[];
};

export type LodeAdmission =
  | {
      ok: true;
      package_ref: string;
      resource_requirement_refs: readonly string[];
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

function admissionFailure(category: FailureRecord["category"], code: string, phase: FailureRecord["phase"], recoveryHint: string): FailureRecord {
  return {
    category,
    code,
    phase,
    recovery_hint: recoveryHint
  };
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

function validateLodeResourceRequirements(taskIntent: LodeAdmissionTaskIntent, packageRef: string, operationMode: string, value: unknown): FailureRecord | readonly string[] {
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
  for (const profileValue of profiles) {
    const profile = contractObject(profileValue);
    if (!profile || !contractString(profile.requirement_profile_id)) {
      return invalidLodeContract("invalid_contract", "resource_matching");
    }
    if (profile.operation_boundary !== undefined && profile.operation_boundary !== "read") {
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
      }
    }
  }
  if (taskIntent.resource_requirement_refs.length === 0 || !taskIntent.resource_requirement_refs.every((ref) => ref === resourceId)) {
    return admissionFailure("resource_admission", "resource_requirement_missing", "resource_matching", "repair_package_contract");
  }
  return taskIntent.resource_requirement_refs;
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
  if (!contractString(lodePackage.lock_ref)) {
    return { ok: false, failure: invalidLodeContract("package_lock_missing"), package_ref: packageRef };
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
  if (operationMode !== "read") {
    return { ok: false, failure: admissionFailure("action_risk", "true_write_deferred", "admission", "use_read_intent"), package_ref: packageRef };
  }
  const resourceRequirementRefs = validateLodeResourceRequirements(taskIntent, packageRef, operationMode, lodePackage.resource_requirements);
  if ("category" in resourceRequirementRefs) {
    return { ok: false, failure: resourceRequirementRefs, package_ref: packageRef };
  }
  return {
    ok: true,
    package_ref: packageRef,
    resource_requirement_refs: resourceRequirementRefs
  };
}
