export type BusinessActionCategory = "read" | "prepare" | "commit" | "destructive";
export type BusinessActionOwnerMatcher = "lode_action_declaration" | "harbor_operation_catalog";

export type BusinessActionTargetScope = {
  target_types: readonly string[];
  site_slug?: string;
  supported_origins?: readonly string[];
};

declare const businessActionOwnerProofType: unique symbol;
export type BusinessActionOwnerProof = { readonly [businessActionOwnerProofType]: true };

export type HarborResourceMatchContract = {
  schema_version: "webenvoy.harbor-resource-match.v0";
  match_ref: string;
  match_version: string;
  matched_requirement_refs: readonly string[];
};

export type LodeBusinessActionOwnerContract = {
  package_ref: string;
  version: string;
  action_declaration: {
    schema_version: "lode.capability-action-declaration.v0";
    schema_ref: string;
    actions: readonly {
      action_id: string;
      category: BusinessActionCategory;
      target_scope: {
        site_slug: string;
        target_types: readonly string[];
        supported_origins: readonly string[];
      };
      resource_requirements: {
        path: string;
        id: string;
        profile_ids: readonly string[];
      };
      external_effects: readonly string[];
    }[];
  };
};

export type HarborBusinessOperationOwnerContract = {
  schema_version: "webenvoy.harbor-operation-catalog.v0";
  catalog_ref: string;
  catalog_version: string;
  operations: readonly {
    operation_id: string;
    category: BusinessActionCategory;
    target_scope: BusinessActionTargetScope;
    resource_requirement_refs: readonly string[];
  }[];
};

export type BusinessActionOwnerProofFields = {
  matcher: BusinessActionOwnerMatcher;
  owner_declaration_ref: string;
  owner_declaration_version: string;
  resource_match_ref: string;
  resource_match_version: string;
  action_id: string;
  category: BusinessActionCategory;
  target_scope: BusinessActionTargetScope;
  resource_requirement_refs: readonly string[];
};

type JsonObject = Record<string, unknown>;

const proofFields = new WeakMap<object, BusinessActionOwnerProofFields>();
const categories = new Set<BusinessActionCategory>(["read", "prepare", "commit", "destructive"]);
const commitEffects = new Set(["upload", "publish", "send", "submit", "create", "modify", "external_transmission"]);
const destructiveEffects = new Set(["delete", "revoke", "irreversible_change"]);
const actionIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const siteSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const targetTypePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const profileIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const resourcePathPattern = /^[A-Za-z0-9._/-]+\.json$/;
const lodePackageRefPattern = /^lode:\/\/site-capability\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/;
const browserPrimitivePattern = /(?:^|[._-])(?:browser_?)?(?:click|fill|type|scroll)(?:$|[._-])/;
const privateRefPattern = /(https?:\/\/|[\r\n\0]|cookie|token|password|raw[_-]?(?:evidence|dom|har))/i;

function exactObject(value: unknown, fields: readonly string[]): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as JsonObject;
  return fields.every((field) => Object.hasOwn(object, field)) && Object.keys(object).every((field) => fields.includes(field)) ? object : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.trim() === value ? value : undefined;
}

function ref(value: unknown): string | undefined {
  const parsed = text(value);
  return parsed && !privateRefPattern.test(parsed) ? parsed : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => text(entry))) return undefined;
  return [...value] as string[];
}

export function normalizeExecutionPolicyOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/^https:\/\/[^/?#]*@/i.test(value) && !url.username && !url.password ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function isBrowserPrimitiveAction(actionId: string): boolean {
  return browserPrimitivePattern.test(actionId);
}

function parseScope(value: unknown, requireSite: boolean): BusinessActionTargetScope | undefined {
  const object = exactObject(value, requireSite ? ["site_slug", "target_types", "supported_origins"] : ["target_types", "site_slug", "supported_origins"])
    ?? (!requireSite ? exactObject(value, ["target_types"]) : undefined)
    ?? (!requireSite ? exactObject(value, ["target_types", "site_slug"]) : undefined)
    ?? (!requireSite ? exactObject(value, ["target_types", "supported_origins"]) : undefined);
  const targetTypes = strings(object?.target_types);
  const siteSlug = object?.site_slug === undefined ? undefined : text(object.site_slug);
  const rawOrigins = object?.supported_origins === undefined ? undefined : strings(object.supported_origins);
  const origins = rawOrigins?.map(normalizeExecutionPolicyOrigin);
  if (!object || !targetTypes?.length || new Set(targetTypes).size !== targetTypes.length ||
    targetTypes.some((targetType) => !targetTypePattern.test(targetType)) ||
    (requireSite && !siteSlug) || (object.site_slug !== undefined && (!siteSlug || !siteSlugPattern.test(siteSlug))) ||
    (requireSite && !rawOrigins?.length) || (object.supported_origins !== undefined && (!rawOrigins?.length || origins?.some((origin) => !origin))) ||
    (origins && new Set(origins).size !== origins.length)) return undefined;
  return {
    target_types: Object.freeze([...targetTypes]),
    ...(siteSlug ? { site_slug: siteSlug } : {}),
    ...(origins ? { supported_origins: Object.freeze(origins as string[]) } : {})
  };
}

function parseResourceMatch(value: unknown): HarborResourceMatchContract | undefined {
  const object = exactObject(value, ["schema_version", "match_ref", "match_version", "matched_requirement_refs"]);
  const requirementRefs = strings(object?.matched_requirement_refs);
  if (!object || object.schema_version !== "webenvoy.harbor-resource-match.v0" || !ref(object.match_ref) || !text(object.match_version) ||
    !requirementRefs?.length || new Set(requirementRefs).size !== requirementRefs.length) return undefined;
  return {
    schema_version: "webenvoy.harbor-resource-match.v0",
    match_ref: object.match_ref as string,
    match_version: object.match_version as string,
    matched_requirement_refs: requirementRefs
  };
}

function sameRefs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}

function brandedProof(fields: BusinessActionOwnerProofFields): BusinessActionOwnerProof {
  const proof = Object.freeze({});
  proofFields.set(proof, Object.freeze({
    ...fields,
    target_scope: Object.freeze(fields.target_scope),
    resource_requirement_refs: Object.freeze([...fields.resource_requirement_refs])
  }));
  return proof as BusinessActionOwnerProof;
}

function validEffects(category: BusinessActionCategory, effects: readonly string[]): boolean {
  if (new Set(effects).size !== effects.length) return false;
  if (category === "read" || category === "prepare") return effects.length === 0;
  const allowed = category === "commit" ? commitEffects : destructiveEffects;
  return effects.length > 0 && effects.every((effect) => allowed.has(effect));
}

type ParsedLodeAction = {
  action_id: string;
  category: BusinessActionCategory;
  target_scope: BusinessActionTargetScope;
  requirement_ref: string;
};

function parseLodeAction(value: unknown): ParsedLodeAction | undefined {
  const action = exactObject(value, ["action_id", "category", "target_scope", "resource_requirements", "external_effects"]);
  const requirements = exactObject(action?.resource_requirements, ["path", "id", "profile_ids"]);
  const actionId = text(action?.action_id);
  const category = action?.category as BusinessActionCategory;
  const scope = parseScope(action?.target_scope, true);
  const requirementId = ref(requirements?.id);
  const requirementPath = text(requirements?.path);
  const profileIds = strings(requirements?.profile_ids);
  const effects = strings(action?.external_effects);
  if (!action || !actionId || !actionIdPattern.test(actionId) || isBrowserPrimitiveAction(actionId) || !categories.has(category) || !scope ||
    !requirementId || !requirementPath || !resourcePathPattern.test(requirementPath) || !profileIds?.length ||
    profileIds.some((profileId) => !profileIdPattern.test(profileId)) || new Set(profileIds).size !== profileIds.length ||
    !effects || !validEffects(category, effects)) return undefined;
  return { action_id: actionId, category, target_scope: scope, requirement_ref: requirementId };
}

type ParsedHarborOperation = {
  operation_id: string;
  category: BusinessActionCategory;
  target_scope: BusinessActionTargetScope;
  requirement_refs: readonly string[];
};

function parseHarborOperation(value: unknown): ParsedHarborOperation | undefined {
  const operation = exactObject(value, ["operation_id", "category", "target_scope", "resource_requirement_refs"]);
  const operationId = text(operation?.operation_id);
  const category = operation?.category as BusinessActionCategory;
  const scope = parseScope(operation?.target_scope, false);
  const requirementRefs = strings(operation?.resource_requirement_refs);
  if (!operation || !operationId || !actionIdPattern.test(operationId) || isBrowserPrimitiveAction(operationId) || !categories.has(category) || !scope ||
    !requirementRefs?.length || new Set(requirementRefs).size !== requirementRefs.length) return undefined;
  return { operation_id: operationId, category, target_scope: scope, requirement_refs: requirementRefs };
}

export function matchLodeBusinessActionOwner(
  ownerContract: unknown,
  actionId: string,
  resourceMatchContract: unknown
): BusinessActionOwnerProof | undefined {
  try {
    const owner = exactObject(ownerContract, ["package_ref", "version", "action_declaration"]);
    const declaration = exactObject(owner?.action_declaration, ["schema_version", "schema_ref", "actions"]);
    const packageRef = ref(owner?.package_ref);
    const version = text(owner?.version);
    const schemaRef = ref(declaration?.schema_ref);
    const resourceMatch = parseResourceMatch(resourceMatchContract);
    const packageVersion = packageRef === undefined ? undefined : lodePackageRefPattern.exec(packageRef)?.[1];
    if (!owner || !declaration || !packageRef || !version || packageVersion !== version ||
      declaration.schema_version !== "lode.capability-action-declaration.v0" || schemaRef !== "lode://schema/capability-action-declaration@0.1.0" ||
      !actionIdPattern.test(actionId) || isBrowserPrimitiveAction(actionId) || !Array.isArray(declaration.actions) || !resourceMatch) return undefined;

    const parsedActions = declaration.actions.map(parseLodeAction);
    if (parsedActions.some((action) => !action)) return undefined;
    const actions = parsedActions as ParsedLodeAction[];
    if (new Set(actions.map((action) => action.action_id)).size !== actions.length) return undefined;
    const action = actions.find((candidate) => candidate.action_id === actionId);
    if (!action || !sameRefs([action.requirement_ref], resourceMatch.matched_requirement_refs)) return undefined;
    return brandedProof({
      matcher: "lode_action_declaration",
      owner_declaration_ref: `${packageRef}#${action.action_id}`,
      owner_declaration_version: version,
      resource_match_ref: resourceMatch.match_ref,
      resource_match_version: resourceMatch.match_version,
      action_id: action.action_id,
      category: action.category,
      target_scope: action.target_scope,
      resource_requirement_refs: [action.requirement_ref]
    });
  } catch {
    return undefined;
  }
}

export function matchHarborBusinessOperationOwner(
  ownerContract: unknown,
  operationId: string,
  resourceMatchContract: unknown
): BusinessActionOwnerProof | undefined {
  try {
    const owner = exactObject(ownerContract, ["schema_version", "catalog_ref", "catalog_version", "operations"]);
    const catalogRef = ref(owner?.catalog_ref);
    const catalogVersion = text(owner?.catalog_version);
    const resourceMatch = parseResourceMatch(resourceMatchContract);
    if (!owner || owner.schema_version !== "webenvoy.harbor-operation-catalog.v0" || !catalogRef?.startsWith("harbor://") || !catalogVersion ||
      !actionIdPattern.test(operationId) || isBrowserPrimitiveAction(operationId) || !Array.isArray(owner.operations) || !resourceMatch) return undefined;
    const parsedOperations = owner.operations.map(parseHarborOperation);
    if (parsedOperations.some((operation) => !operation)) return undefined;
    const operations = parsedOperations as ParsedHarborOperation[];
    if (new Set(operations.map((operation) => operation.operation_id)).size !== operations.length) return undefined;
    const operation = operations.find((candidate) => candidate.operation_id === operationId);
    if (!operation || !sameRefs(operation.requirement_refs, resourceMatch.matched_requirement_refs)) return undefined;
    return brandedProof({
      matcher: "harbor_operation_catalog",
      owner_declaration_ref: `${catalogRef}#${operation.operation_id}`,
      owner_declaration_version: catalogVersion,
      resource_match_ref: resourceMatch.match_ref,
      resource_match_version: resourceMatch.match_version,
      action_id: operation.operation_id,
      category: operation.category,
      target_scope: operation.target_scope,
      resource_requirement_refs: operation.requirement_refs
    });
  } catch {
    return undefined;
  }
}

export function readBusinessActionOwnerProof(value: unknown): BusinessActionOwnerProofFields | undefined {
  return value && typeof value === "object" ? proofFields.get(value as object) : undefined;
}
