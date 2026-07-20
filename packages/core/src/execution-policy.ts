export const executionPolicyEvaluationSchemaVersion = "webenvoy.execution-policy-evaluation.v0";
export const actionOwnerMatchSchemaVersion = "webenvoy.action-owner-match.v0";

export type BusinessActionCategory = "read" | "prepare" | "commit" | "destructive";
export type ExecutionPolicyMode = "auto" | "confirm" | "deny";
export type ExecutionPolicySource =
  | "single_action_decision"
  | "thread_revision"
  | "installed_skill_user_version"
  | "global_user_config";
export type ExecutionPolicyCaller = "api" | "cli" | "mcp" | "sdk" | "app" | "agent" | "environment";

export type BusinessActionTarget = {
  target_ref: string;
  target_type: string;
  site_slug?: string;
  origin?: string;
};

export type BusinessActionOwnerMatch = {
  schema_version: typeof actionOwnerMatchSchemaVersion;
  matcher: "lode_package_admission" | "harbor_admission";
  owner_declaration_ref: string;
  owner_declaration_version: string;
  resource_match_ref: string;
  resource_match_version: string;
  action_id: string;
  categories: readonly BusinessActionCategory[];
  target_scope: {
    target_types: readonly string[];
    site_slug?: string;
    supported_origins?: readonly string[];
  };
  resource_requirement_refs: readonly string[];
};

export type BusinessActionRequest = {
  action_instance_ref: string;
  action_id: string;
  target: BusinessActionTarget;
};

export type ExecutionPolicyModes = Partial<Record<BusinessActionCategory, ExecutionPolicyMode>>;
export type ExecutionPolicyContext = { thread_ref?: string; skill_ref?: string };

export type SingleActionDecision = {
  source_ref: string;
  source_version: string;
  action_instance_ref: string;
  action_id: string;
  category: BusinessActionCategory;
  target: BusinessActionTarget;
  owner_matcher: BusinessActionOwnerMatch["matcher"];
  owner_declaration_ref: string;
  owner_declaration_version: string;
  resource_match_ref: string;
  resource_match_version: string;
  effective_policy_source_ref: string;
  effective_policy_source_version: string;
  effective_policy_source: Exclude<ExecutionPolicySource, "single_action_decision">;
  mode: "auto" | "deny";
  state: "active" | "consumed" | "cancelled" | "expired" | "target_changed";
  issued_at: string;
  expires_at: string;
};

export type ExecutionPolicySources = {
  single_action_decision?: SingleActionDecision;
  thread_revision?: { source_ref: string; source_version: string; thread_ref: string; modes: ExecutionPolicyModes };
  installed_skill_user_version?: { source_ref: string; source_version: string; skill_ref: string; modes: ExecutionPolicyModes };
  global_user_config?: { source_ref: string; source_version: string; modes: ExecutionPolicyModes };
};

export type ExecutionPolicyEvaluationInput = {
  caller: ExecutionPolicyCaller;
  evaluated_at: string;
  action: BusinessActionRequest;
  owner_match: BusinessActionOwnerMatch;
  context: ExecutionPolicyContext;
  policies: ExecutionPolicySources;
};

export type EvaluatedBusinessAction = {
  action_instance_ref: string;
  action_id: string;
  target: BusinessActionTarget;
  category: BusinessActionCategory;
  owner_matcher: BusinessActionOwnerMatch["matcher"];
  owner_declaration_ref: string;
  owner_declaration_version: string;
  resource_match_ref: string;
  resource_match_version: string;
};

export type EffectiveExecutionPolicy = {
  mode: ExecutionPolicyMode;
  source: ExecutionPolicySource;
  source_ref: string;
  source_version: string;
};

export type SingleActionConfirmationRequest = {
  scope: "current_action";
  action_instance_ref: string;
  action_id: string;
  target: BusinessActionTarget;
  category: BusinessActionCategory;
  owner_matcher: BusinessActionOwnerMatch["matcher"];
  owner_declaration_ref: string;
  owner_declaration_version: string;
  resource_match_ref: string;
  resource_match_version: string;
  effective_policy_source_ref: string;
  effective_policy_source_version: string;
  effective_policy_source: Exclude<ExecutionPolicySource, "single_action_decision">;
  choices: readonly ["allow_once", "deny_once"];
};

type EvaluationBase = { schema_version: typeof executionPolicyEvaluationSchemaVersion; evaluated_at: string };
type StopReason =
  | "invalid_input"
  | "action_undeclared"
  | "action_unclassifiable"
  | "owner_match_conflict"
  | "target_mismatch"
  | "policy_unavailable";

export type ExecutionPolicyEvaluation =
  | (EvaluationBase & {
      status: "evaluated";
      action: EvaluatedBusinessAction;
      risk_marker: "destructive" | null;
      effective_policy: EffectiveExecutionPolicy;
      next_step: "execute" | "request_confirmation" | "stop";
      stop_reason?: "policy_denied";
      confirmation_request?: SingleActionConfirmationRequest;
    })
  | (EvaluationBase & {
      status: "stopped";
      next_step: "stop";
      stop_reason: Exclude<StopReason, "invalid_input">;
      action?: EvaluatedBusinessAction;
      risk_marker?: "destructive" | null;
    })
  | {
      schema_version: typeof executionPolicyEvaluationSchemaVersion;
      status: "stopped";
      next_step: "stop";
      stop_reason: "invalid_input";
    };

type JsonObject = Record<string, unknown>;
const actionCategories = new Set<BusinessActionCategory>(["read", "prepare", "commit", "destructive"]);
const policyModes = new Set<ExecutionPolicyMode>(["auto", "confirm", "deny"]);
const callers = new Set<ExecutionPolicyCaller>(["api", "cli", "mcp", "sdk", "app", "agent", "environment"]);
const singleStates = new Set<SingleActionDecision["state"]>(["active", "consumed", "cancelled", "expired", "target_changed"]);
const currentPolicySources = new Set<Exclude<ExecutionPolicySource, "single_action_decision">>(["thread_revision", "installed_skill_user_version", "global_user_config"]);
const businessActionIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const browserAtomicActionPattern = /(?:^|[._-])(?:click|type|scroll)(?:$|[._-])/;
const privateRefPattern = /(https?:\/\/|[\r\n\0]|cookie|token|password|raw[_-]?(?:evidence|dom|har))/i;

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as JsonObject;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(object, key)) && Object.keys(object).every((key) => allowed.has(key)) ? object : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function persistentRef(value: unknown): string | undefined {
  const ref = string(value);
  return ref && !privateRefPattern.test(ref) ? ref : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0) ? value : undefined;
}

function rfc3339(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (!year || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function httpsOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function sameOrigin(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function parseTarget(value: unknown): BusinessActionTarget | undefined {
  const object = exactObject(value, ["target_ref", "target_type"], ["site_slug", "origin"]);
  const targetRef = persistentRef(object?.target_ref);
  const targetType = string(object?.target_type);
  const siteSlug = object?.site_slug === undefined ? undefined : string(object.site_slug);
  const origin = object?.origin === undefined ? undefined : httpsOrigin(object.origin);
  if (!object || !targetRef || !targetType || (object.site_slug !== undefined && !siteSlug) || (object.origin !== undefined && !origin)) return undefined;
  return { target_ref: targetRef, target_type: targetType, ...(siteSlug ? { site_slug: siteSlug } : {}), ...(origin ? { origin } : {}) };
}

function parseTargetScope(value: unknown): BusinessActionOwnerMatch["target_scope"] | undefined {
  const object = exactObject(value, ["target_types"], ["site_slug", "supported_origins"]);
  const targetTypes = stringArray(object?.target_types);
  const siteSlug = object?.site_slug === undefined ? undefined : string(object.site_slug);
  const origins = object?.supported_origins === undefined ? undefined : stringArray(object.supported_origins);
  if (!object || !targetTypes?.length || (object.site_slug !== undefined && !siteSlug) ||
    (object.supported_origins !== undefined && (!origins?.length || origins.some((origin) => !httpsOrigin(origin))))) return undefined;
  return { target_types: targetTypes, ...(siteSlug ? { site_slug: siteSlug } : {}), ...(origins ? { supported_origins: origins } : {}) };
}

export function parseBusinessActionOwnerMatch(value: unknown): BusinessActionOwnerMatch | undefined {
  const object = exactObject(value, ["schema_version", "matcher", "owner_declaration_ref", "owner_declaration_version", "resource_match_ref", "resource_match_version", "action_id", "categories", "target_scope", "resource_requirement_refs"]);
  const categories = stringArray(object?.categories);
  const targetScope = parseTargetScope(object?.target_scope);
  const requirementRefs = stringArray(object?.resource_requirement_refs);
  if (!object || object.schema_version !== actionOwnerMatchSchemaVersion ||
    (object.matcher !== "lode_package_admission" && object.matcher !== "harbor_admission") ||
    !persistentRef(object.owner_declaration_ref) || !string(object.owner_declaration_version) ||
    !persistentRef(object.resource_match_ref) || !string(object.resource_match_version) ||
    !string(object.action_id) || !businessActionIdPattern.test(object.action_id as string) || !categories ||
    !categories.every((category) => actionCategories.has(category as BusinessActionCategory)) ||
    !targetScope || !requirementRefs) return undefined;
  return {
    schema_version: actionOwnerMatchSchemaVersion,
    matcher: object.matcher,
    owner_declaration_ref: object.owner_declaration_ref as string,
    owner_declaration_version: object.owner_declaration_version as string,
    resource_match_ref: object.resource_match_ref as string,
    resource_match_version: object.resource_match_version as string,
    action_id: object.action_id as string,
    categories: categories as BusinessActionCategory[],
    target_scope: targetScope,
    resource_requirement_refs: requirementRefs
  };
}

function parseModes(value: unknown): ExecutionPolicyModes | undefined {
  const object = exactObject(value, [], ["read", "prepare", "commit", "destructive"]);
  if (!object || !Object.values(object).every((mode) => policyModes.has(mode as ExecutionPolicyMode))) return undefined;
  return object as ExecutionPolicyModes;
}

function parsePolicy(value: unknown, binding?: "thread_ref" | "skill_ref"): { source_ref: string; source_version: string; modes: ExecutionPolicyModes; thread_ref?: string; skill_ref?: string } | undefined {
  const required = ["source_ref", "source_version", "modes", ...(binding ? [binding] : [])];
  const object = exactObject(value, required);
  const sourceRef = persistentRef(object?.source_ref);
  const sourceVersion = string(object?.source_version);
  const modes = parseModes(object?.modes);
  const bindingRef = binding ? persistentRef(object?.[binding]) : undefined;
  if (!object || !sourceRef || !sourceVersion || !modes || (binding && !bindingRef)) return undefined;
  return { source_ref: sourceRef, source_version: sourceVersion, modes, ...(binding === "thread_ref" ? { thread_ref: bindingRef! } : {}), ...(binding === "skill_ref" ? { skill_ref: bindingRef! } : {}) };
}

function parseSingleDecision(value: unknown): SingleActionDecision | undefined {
  const fields = ["source_ref", "source_version", "action_instance_ref", "action_id", "category", "target", "owner_matcher", "owner_declaration_ref", "owner_declaration_version", "resource_match_ref", "resource_match_version", "effective_policy_source_ref", "effective_policy_source_version", "effective_policy_source", "mode", "state", "issued_at", "expires_at"];
  const object = exactObject(value, fields);
  const target = parseTarget(object?.target);
  if (!object || !persistentRef(object.source_ref) || !string(object.source_version) || !persistentRef(object.action_instance_ref) ||
    !string(object.action_id) || !businessActionIdPattern.test(object.action_id as string) || !actionCategories.has(object.category as BusinessActionCategory) || !target ||
    (object.owner_matcher !== "lode_package_admission" && object.owner_matcher !== "harbor_admission") ||
    !persistentRef(object.owner_declaration_ref) || !string(object.owner_declaration_version) ||
    !persistentRef(object.resource_match_ref) || !string(object.resource_match_version) ||
    !persistentRef(object.effective_policy_source_ref) || !string(object.effective_policy_source_version) ||
    !currentPolicySources.has(object.effective_policy_source as Exclude<ExecutionPolicySource, "single_action_decision">) ||
    (object.mode !== "auto" && object.mode !== "deny") || !singleStates.has(object.state as SingleActionDecision["state"]) ||
    !rfc3339(object.issued_at) || !rfc3339(object.expires_at)) return undefined;
  return object as SingleActionDecision;
}

function parseInput(value: unknown): ExecutionPolicyEvaluationInput | undefined {
  const object = exactObject(value, ["caller", "evaluated_at", "action", "owner_match", "context", "policies"]);
  const action = exactObject(object?.action, ["action_instance_ref", "action_id", "target"]);
  const context = exactObject(object?.context, [], ["thread_ref", "skill_ref"]);
  const policies = exactObject(object?.policies, [], ["single_action_decision", "thread_revision", "installed_skill_user_version", "global_user_config"]);
  const target = parseTarget(action?.target);
  const ownerMatch = parseBusinessActionOwnerMatch(object?.owner_match);
  const evaluatedAt = rfc3339(object?.evaluated_at);
  const threadRef = context?.thread_ref === undefined ? undefined : persistentRef(context.thread_ref);
  const skillRef = context?.skill_ref === undefined ? undefined : persistentRef(context.skill_ref);
  const single = policies?.single_action_decision === undefined ? undefined : parseSingleDecision(policies.single_action_decision);
  const thread = policies?.thread_revision === undefined ? undefined : parsePolicy(policies.thread_revision, "thread_ref");
  const skill = policies?.installed_skill_user_version === undefined ? undefined : parsePolicy(policies.installed_skill_user_version, "skill_ref");
  const global = policies?.global_user_config === undefined ? undefined : parsePolicy(policies.global_user_config);
  if (!object || !callers.has(object.caller as ExecutionPolicyCaller) || !evaluatedAt || !action || !persistentRef(action.action_instance_ref) ||
    !string(action.action_id) || !businessActionIdPattern.test(action.action_id as string) || !target || !ownerMatch || !context || !policies ||
    (context.thread_ref !== undefined && !threadRef) || (context.skill_ref !== undefined && !skillRef) ||
    (policies.single_action_decision !== undefined && !single) || (policies.thread_revision !== undefined && !thread) ||
    (policies.installed_skill_user_version !== undefined && !skill) || (policies.global_user_config !== undefined && !global)) return undefined;
  const parsedPolicies: ExecutionPolicySources = {};
  if (single) parsedPolicies.single_action_decision = single;
  if (thread?.thread_ref) parsedPolicies.thread_revision = { source_ref: thread.source_ref, source_version: thread.source_version, thread_ref: thread.thread_ref, modes: thread.modes };
  if (skill?.skill_ref) parsedPolicies.installed_skill_user_version = { source_ref: skill.source_ref, source_version: skill.source_version, skill_ref: skill.skill_ref, modes: skill.modes };
  if (global) parsedPolicies.global_user_config = { source_ref: global.source_ref, source_version: global.source_version, modes: global.modes };
  return {
    caller: object.caller as ExecutionPolicyCaller,
    evaluated_at: evaluatedAt,
    action: { action_instance_ref: action.action_instance_ref as string, action_id: action.action_id as string, target },
    owner_match: ownerMatch,
    context: { ...(threadRef ? { thread_ref: threadRef } : {}), ...(skillRef ? { skill_ref: skillRef } : {}) },
    policies: parsedPolicies
  };
}

export function matchesBusinessActionTarget(scope: BusinessActionOwnerMatch["target_scope"], target: BusinessActionTarget): boolean {
  if (!scope.target_types.includes(target.target_type)) return false;
  if (scope.site_slug !== undefined && scope.site_slug !== target.site_slug) return false;
  if (scope.supported_origins === undefined) return true;
  return scope.supported_origins.some((origin) => sameOrigin(origin, target.origin));
}

function invalidInput(): ExecutionPolicyEvaluation {
  return { schema_version: executionPolicyEvaluationSchemaVersion, status: "stopped", next_step: "stop", stop_reason: "invalid_input" };
}

function stopped(input: ExecutionPolicyEvaluationInput, stopReason: Exclude<StopReason, "invalid_input">, action?: EvaluatedBusinessAction): ExecutionPolicyEvaluation {
  return { schema_version: executionPolicyEvaluationSchemaVersion, evaluated_at: input.evaluated_at, status: "stopped", next_step: "stop", stop_reason: stopReason,
    ...(action ? { action, risk_marker: action.category === "destructive" ? "destructive" as const : null } : {}) };
}

function matchedAction(input: ExecutionPolicyEvaluationInput): EvaluatedBusinessAction | ExecutionPolicyEvaluation {
  const match = input.owner_match;
  if (match.action_id !== input.action.action_id) return stopped(input, "action_undeclared");
  if (browserAtomicActionPattern.test(input.action.action_id)) return stopped(input, "action_unclassifiable");
  if (match.categories.length !== 1 || new Set(match.categories).size !== 1 ||
    match.target_scope.target_types.length !== new Set(match.target_scope.target_types).size ||
    (match.target_scope.supported_origins !== undefined && match.target_scope.supported_origins.length !== new Set(match.target_scope.supported_origins).size) ||
    match.resource_requirement_refs.length === 0 || new Set(match.resource_requirement_refs).size !== match.resource_requirement_refs.length) {
    return stopped(input, "owner_match_conflict");
  }
  if (!matchesBusinessActionTarget(match.target_scope, input.action.target)) return stopped(input, "target_mismatch");
  return {
    action_instance_ref: input.action.action_instance_ref,
    action_id: input.action.action_id,
    target: { ...input.action.target },
    category: match.categories[0]!,
    owner_matcher: match.matcher,
    owner_declaration_ref: match.owner_declaration_ref,
    owner_declaration_version: match.owner_declaration_version,
    resource_match_ref: match.resource_match_ref,
    resource_match_version: match.resource_match_version
  };
}

function currentPolicy(input: ExecutionPolicyEvaluationInput, category: BusinessActionCategory): EffectiveExecutionPolicy | undefined {
  const candidates: readonly [ExecutionPolicySource, { source_ref: string; source_version: string; modes: ExecutionPolicyModes } | undefined, boolean][] = [
    ["thread_revision", input.policies.thread_revision, input.policies.thread_revision?.thread_ref === input.context.thread_ref],
    ["installed_skill_user_version", input.policies.installed_skill_user_version, input.policies.installed_skill_user_version?.skill_ref === input.context.skill_ref],
    ["global_user_config", input.policies.global_user_config, true]
  ];
  for (const [source, policy, applies] of candidates) {
    const mode = policy?.modes[category];
    if (applies && mode) return { mode, source, source_ref: policy.source_ref, source_version: policy.source_version };
  }
  return undefined;
}

function targetsEqual(left: BusinessActionTarget, right: BusinessActionTarget): boolean {
  return left.target_ref === right.target_ref && left.target_type === right.target_type && left.site_slug === right.site_slug && left.origin === right.origin;
}

function validSingleDecision(input: ExecutionPolicyEvaluationInput, action: EvaluatedBusinessAction, current: EffectiveExecutionPolicy): SingleActionDecision | undefined {
  const single = input.policies.single_action_decision;
  if (!single || current.mode !== "confirm" || single.state !== "active") return undefined;
  const now = Date.parse(input.evaluated_at);
  const issuedAt = Date.parse(single.issued_at);
  const expiresAt = Date.parse(single.expires_at);
  return issuedAt <= now && now < expiresAt && issuedAt < expiresAt &&
    single.action_instance_ref === action.action_instance_ref && single.action_id === action.action_id && single.category === action.category &&
    targetsEqual(single.target, action.target) && single.owner_matcher === action.owner_matcher && single.owner_declaration_ref === action.owner_declaration_ref &&
    single.owner_declaration_version === action.owner_declaration_version && single.resource_match_ref === action.resource_match_ref &&
    single.resource_match_version === action.resource_match_version && single.effective_policy_source_ref === current.source_ref &&
    single.effective_policy_source_version === current.source_version && single.effective_policy_source === current.source ? single : undefined;
}

function evaluated(input: ExecutionPolicyEvaluationInput, action: EvaluatedBusinessAction, policy: EffectiveExecutionPolicy): ExecutionPolicyEvaluation {
  const base: EvaluationBase & { status: "evaluated"; action: EvaluatedBusinessAction; risk_marker: "destructive" | null; effective_policy: EffectiveExecutionPolicy } = {
    schema_version: executionPolicyEvaluationSchemaVersion, evaluated_at: input.evaluated_at, status: "evaluated", action,
    risk_marker: action.category === "destructive" ? "destructive" as const : null, effective_policy: policy };
  if (policy.mode === "auto") return { ...base, next_step: "execute" };
  if (policy.mode === "deny") return { ...base, next_step: "stop", stop_reason: "policy_denied" };
  return { ...base, next_step: "request_confirmation", confirmation_request: {
    scope: "current_action", action_instance_ref: action.action_instance_ref, action_id: action.action_id, target: { ...action.target },
    category: action.category, owner_matcher: action.owner_matcher, owner_declaration_ref: action.owner_declaration_ref, owner_declaration_version: action.owner_declaration_version,
    resource_match_ref: action.resource_match_ref, resource_match_version: action.resource_match_version,
    effective_policy_source_ref: policy.source_ref, effective_policy_source_version: policy.source_version,
    effective_policy_source: policy.source as Exclude<ExecutionPolicySource, "single_action_decision">,
    choices: ["allow_once", "deny_once"]
  } };
}

export function evaluateExecutionPolicy(value: unknown): ExecutionPolicyEvaluation {
  try {
    const input = parseInput(value);
    if (!input) return invalidInput();
    const action = matchedAction(input);
    if ("status" in action) return action;
    const current = currentPolicy(input, action.category);
    if (!current) return stopped(input, "policy_unavailable", action);
    const single = validSingleDecision(input, action, current);
    return evaluated(input, action, single ? { mode: single.mode, source: "single_action_decision", source_ref: single.source_ref, source_version: single.source_version } : current);
  } catch {
    return invalidInput();
  }
}
