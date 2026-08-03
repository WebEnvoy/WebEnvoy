import type { LodeCatalogAction } from "./lodeCatalog.js";
import { hasOnlyKeys, isRecord, optionalString, strictStringArray } from "./lodeCatalogGuards.js";

const maxCatalogActions = 50;

type ActionContext = {
  actionDeclaration: Record<string, unknown>;
  inputSchemaId: string;
  operationId: string;
  operationMode: string;
  operationRef: string;
  outputSchemaId: string;
  packageRef: string;
  requirementPath: string;
  requirementRef: string;
  requiredInputFields: string[];
  requirements: Record<string, unknown>;
  siteOrigins: string[];
  siteSlug: string;
  targetType: string;
};

export function projectActions(context: ActionContext): LodeCatalogAction[] {
  const { actionDeclaration, operationMode } = context;
  if (!["read", "validate_only", "draft", "preview"].includes(operationMode) ||
    !hasOnlyKeys(actionDeclaration, ["schema_version", "schema_ref", "actions"]) ||
    actionDeclaration.schema_version !== "lode.capability-action-declaration.v0" ||
    actionDeclaration.schema_ref !== "lode://schema/capability-action-declaration@0.1.0" ||
    !validRequirementContract(context)) return [];
  const value = actionDeclaration.actions;
  if (!Array.isArray(value) || value.length === 0 || value.length > maxCatalogActions) return [];
  const projected: LodeCatalogAction[] = [];
  for (const action of value) {
    const item = projectAction(action, context);
    if (item == null) return [];
    projected.push(item);
  }
  return new Set(projected.map((action) => action.id)).size === projected.length ? projected : [];
}

function projectAction(value: unknown, context: ActionContext) {
  if (!isRecord(value)) return null;
  const { operationId, operationMode, requirementPath, requirementRef, requirements, siteOrigins, siteSlug, targetType } = context;
  const targetScope = isRecord(value.target_scope) ? value.target_scope : null;
  const actionRequirements = isRecord(value.resource_requirements) ? value.resource_requirements : null;
  const targetTypes = targetScope == null ? null : strictStringArray(targetScope.target_types);
  const supportedOrigins = targetScope == null ? null : strictStringArray(targetScope.supported_origins);
  const externalEffects = strictStringArray(value.external_effects);
  const profileIds = actionRequirements == null ? null : strictStringArray(actionRequirements.profile_ids);
  const declaredProfiles = requirementProfiles(requirements);
  const expectedCategory = operationMode === "read" ? "read" : "prepare";
  if (value.action_id !== operationId || value.category !== expectedCategory ||
    targetScope?.site_slug !== siteSlug || targetTypes?.length !== 1 || targetTypes[0] !== targetType ||
    supportedOrigins == null || supportedOrigins.length === 0 || supportedOrigins.some((origin) => !siteOrigins.includes(origin)) ||
    externalEffects == null || externalEffects.length !== 0 || actionRequirements?.path !== requirementPath ||
    actionRequirements?.id !== requirementRef || profileIds == null || profileIds.length === 0 ||
    profileIds.some((id) => !declaredProfiles.has(id)) ||
    profileIds.some((id) => !profileMatchesContract(context, id, supportedOrigins))) return null;
  return {
    id: value.action_id,
    category: value.category as LodeCatalogAction["category"],
    operationMode: operationMode as LodeCatalogAction["operationMode"],
    targetTypes,
    supportedOrigins,
    externalEffects,
    resourceRequirementRef: requirementRef,
    resourceRequirementProfileIds: profileIds,
  };
}

function validRequirementContract(context: ActionContext) {
  const { operationMode, operationRef, packageRef, requirementRef, requirements } = context;
  const profiles = Array.isArray(requirements.resource_requirement_profiles) ? requirements.resource_requirement_profiles : [];
  return requirements.schema_version === "lode.resource-requirements.v0" &&
    requirements.resource_requirements_id === requirementRef && requirements.package_ref === packageRef &&
    requirements.operation_ref === operationRef && requirements.operation_mode === operationMode &&
    profiles.length > 0 && requirementProfiles(requirements).size === profiles.length;
}

function requirementProfiles(requirements: Record<string, unknown>) {
  const profiles = Array.isArray(requirements.resource_requirement_profiles) ? requirements.resource_requirement_profiles : [];
  return new Map(profiles.flatMap((profile) => {
    if (!isRecord(profile)) return [];
    const id = optionalString(profile.requirement_profile_id);
    return id == null ? [] : [[id, profile] as const];
  }));
}

function profileMatchesContract(context: ActionContext, profileId: string, origins: string[]) {
  const profile = requirementProfiles(context.requirements).get(profileId);
  const inputBinding = isRecord(profile?.input_binding) ? profile.input_binding : null;
  const outputBinding = isRecord(profile?.output_binding) ? profile.output_binding : null;
  const allowed = inputBinding == null ? null : strictStringArray(inputBinding.allowed_origins);
  const profileRequiredFields = inputBinding == null ? null : strictStringArray(inputBinding.required_input_fields);
  return profile?.operation_boundary === context.operationMode &&
    inputBinding?.input_schema === context.inputSchemaId && outputBinding?.output_schema === context.outputSchemaId &&
    allowed != null && origins.every((origin) => allowed.includes(origin)) && profileRequiredFields != null &&
    sameStrings(profileRequiredFields, context.requiredInputFields);
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
