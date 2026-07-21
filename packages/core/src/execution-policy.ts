import {
  isBrowserPrimitiveAction,
  normalizeExecutionPolicyOrigin,
  readBusinessActionOwnerProof,
  type BusinessActionCategory,
  type BusinessActionOwnerMatcher,
  type BusinessActionOwnerProof,
  type BusinessActionOwnerProofFields,
  type BusinessActionTargetScope
} from "./execution-policy-owner-proof.js";
import { normalizeStoredTargetRef } from "./public-target-reference.js";
import {
  normalizeNonSensitiveText,
  persistentReferenceMaxLength,
  persistentVersionMaxLength
} from "./sensitive-field-taxonomy.js";

export type {
  BusinessActionCategory,
  BusinessActionOwnerMatcher,
  BusinessActionOwnerProof
} from "./execution-policy-owner-proof.js";

export const executionPolicyEvaluationSchemaVersion = "webenvoy.execution-policy-evaluation.v0";

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
  owner_matcher: BusinessActionOwnerMatcher;
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
  owner_proof: BusinessActionOwnerProof;
  context: ExecutionPolicyContext;
  policies: ExecutionPolicySources;
};

export type EvaluatedBusinessAction = {
  action_instance_ref: string;
  action_id: string;
  target: BusinessActionTarget;
  category: BusinessActionCategory;
  owner_matcher: BusinessActionOwnerMatcher;
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
  owner_matcher: BusinessActionOwnerMatcher;
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
type ParsedExecutionPolicyEvaluationInput = Omit<ExecutionPolicyEvaluationInput, "owner_proof"> & { owner_proof: BusinessActionOwnerProofFields };
export type TrustedExecutionPolicyEvaluationFacts = {
  evaluation: ExecutionPolicyEvaluation;
  requested_action?: BusinessActionRequest;
  owner_proof?: BusinessActionOwnerProofFields;
  single_action_expires_at?: string;
};

const trustedEvaluationFacts = new WeakMap<object, TrustedExecutionPolicyEvaluationFacts>();
const actionCategories = new Set<BusinessActionCategory>(["read", "prepare", "commit", "destructive"]);
const policyModes = new Set<ExecutionPolicyMode>(["auto", "confirm", "deny"]);
const callers = new Set<ExecutionPolicyCaller>(["api", "cli", "mcp", "sdk", "app", "agent", "environment"]);
const singleStates = new Set<SingleActionDecision["state"]>(["active", "consumed", "cancelled", "expired", "target_changed"]);
const currentPolicySources = new Set<Exclude<ExecutionPolicySource, "single_action_decision">>(["thread_revision", "installed_skill_user_version", "global_user_config"]);
const businessActionIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const privateRefPattern = /https?:\/\//i;

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as JsonObject;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(object, key)) && Object.keys(object).every((key) => allowed.has(key)) ? object : undefined;
}

function string(value: unknown, maxLength = persistentVersionMaxLength): string | undefined {
  return normalizeNonSensitiveText(value, maxLength);
}

function persistentRef(value: unknown): string | undefined {
  const ref = normalizeNonSensitiveText(value, persistentReferenceMaxLength);
  return ref && !privateRefPattern.test(ref) ? ref : undefined;
}

function persistentTargetRef(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > persistentReferenceMaxLength) return undefined;
  const ref = normalizeStoredTargetRef(value);
  return ref && !ref.includes("://") ? ref : undefined;
}

function rfc3339(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
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

export function sameOrigin(left: string | undefined, right: string | undefined): boolean {
  const leftOrigin = normalizeExecutionPolicyOrigin(left);
  const rightOrigin = normalizeExecutionPolicyOrigin(right);
  return leftOrigin !== undefined && leftOrigin === rightOrigin;
}

function parseTarget(value: unknown): BusinessActionTarget | undefined {
  const object = exactObject(value, ["target_ref", "target_type"], ["site_slug", "origin"]);
  const targetRef = persistentTargetRef(object?.target_ref);
  const targetType = string(object?.target_type, persistentVersionMaxLength);
  const siteSlug = object?.site_slug === undefined ? undefined : string(object.site_slug, persistentVersionMaxLength);
  const origin = object?.origin === undefined ? undefined : normalizeExecutionPolicyOrigin(object.origin);
  if (!object || !targetRef || !targetType || (object.site_slug !== undefined && !siteSlug) || (object.origin !== undefined && !origin)) return undefined;
  return { target_ref: targetRef, target_type: targetType, ...(siteSlug ? { site_slug: siteSlug } : {}), ...(origin ? { origin } : {}) };
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
    !normalizeNonSensitiveText(object.action_id, persistentVersionMaxLength) || !businessActionIdPattern.test(object.action_id as string) || !actionCategories.has(object.category as BusinessActionCategory) || !target ||
    (object.owner_matcher !== "lode_action_declaration" && object.owner_matcher !== "harbor_operation_catalog") ||
    !persistentRef(object.owner_declaration_ref) || !string(object.owner_declaration_version) ||
    !persistentRef(object.resource_match_ref) || !string(object.resource_match_version) ||
    !persistentRef(object.effective_policy_source_ref) || !string(object.effective_policy_source_version) ||
    !currentPolicySources.has(object.effective_policy_source as Exclude<ExecutionPolicySource, "single_action_decision">) ||
    (object.mode !== "auto" && object.mode !== "deny") || !singleStates.has(object.state as SingleActionDecision["state"]) ||
    !rfc3339(object.issued_at) || !rfc3339(object.expires_at)) return undefined;
  return object as SingleActionDecision;
}

function parseInput(value: unknown): ParsedExecutionPolicyEvaluationInput | undefined {
  const object = exactObject(value, ["caller", "evaluated_at", "action", "owner_proof", "context", "policies"]);
  const action = exactObject(object?.action, ["action_instance_ref", "action_id", "target"]);
  const context = exactObject(object?.context, [], ["thread_ref", "skill_ref"]);
  const policies = exactObject(object?.policies, [], ["single_action_decision", "thread_revision", "installed_skill_user_version", "global_user_config"]);
  const target = parseTarget(action?.target);
  const ownerProof = readBusinessActionOwnerProof(object?.owner_proof);
  const evaluatedAt = rfc3339(object?.evaluated_at);
  const threadRef = context?.thread_ref === undefined ? undefined : persistentRef(context.thread_ref);
  const skillRef = context?.skill_ref === undefined ? undefined : persistentRef(context.skill_ref);
  const single = policies?.single_action_decision === undefined ? undefined : parseSingleDecision(policies.single_action_decision);
  const thread = policies?.thread_revision === undefined ? undefined : parsePolicy(policies.thread_revision, "thread_ref");
  const skill = policies?.installed_skill_user_version === undefined ? undefined : parsePolicy(policies.installed_skill_user_version, "skill_ref");
  const global = policies?.global_user_config === undefined ? undefined : parsePolicy(policies.global_user_config);
  if (!object || !callers.has(object.caller as ExecutionPolicyCaller) || !evaluatedAt || !action || !persistentRef(action.action_instance_ref) ||
    !normalizeNonSensitiveText(action.action_id, persistentVersionMaxLength) || !businessActionIdPattern.test(action.action_id as string) || !target || !ownerProof || !context || !policies ||
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
    owner_proof: ownerProof,
    context: { ...(threadRef ? { thread_ref: threadRef } : {}), ...(skillRef ? { skill_ref: skillRef } : {}) },
    policies: parsedPolicies
  };
}

function matchesBusinessActionTarget(scope: BusinessActionTargetScope, target: BusinessActionTarget): boolean {
  if (!scope.target_types.includes(target.target_type)) return false;
  if (scope.site_slug !== undefined && scope.site_slug !== target.site_slug) return false;
  if (scope.supported_origins === undefined) return true;
  return scope.supported_origins.some((origin) => sameOrigin(origin, target.origin));
}

function invalidInput(): ExecutionPolicyEvaluation {
  return { schema_version: executionPolicyEvaluationSchemaVersion, status: "stopped", next_step: "stop", stop_reason: "invalid_input" };
}

function rememberEvaluation(
  evaluation: ExecutionPolicyEvaluation,
  input?: ParsedExecutionPolicyEvaluationInput,
  singleActionExpiresAt?: string
): ExecutionPolicyEvaluation {
  trustedEvaluationFacts.set(evaluation, {
    evaluation: structuredClone(evaluation),
    ...(input === undefined ? {} : {
      requested_action: structuredClone(input.action),
      owner_proof: structuredClone(input.owner_proof)
    }),
    ...(singleActionExpiresAt === undefined ? {} : {
      single_action_expires_at: singleActionExpiresAt
    })
  });
  return evaluation;
}

export function readTrustedExecutionPolicyEvaluation(
  value: unknown
): TrustedExecutionPolicyEvaluationFacts | undefined {
  return value && typeof value === "object" ? trustedEvaluationFacts.get(value as object) : undefined;
}

function stopped(input: ParsedExecutionPolicyEvaluationInput, stopReason: Exclude<StopReason, "invalid_input">, action?: EvaluatedBusinessAction): ExecutionPolicyEvaluation {
  return { schema_version: executionPolicyEvaluationSchemaVersion, evaluated_at: input.evaluated_at, status: "stopped", next_step: "stop", stop_reason: stopReason,
    ...(action ? { action, risk_marker: action.category === "destructive" ? "destructive" as const : null } : {}) };
}

function matchedAction(input: ParsedExecutionPolicyEvaluationInput): EvaluatedBusinessAction | ExecutionPolicyEvaluation {
  const match = input.owner_proof;
  if (match.action_id !== input.action.action_id) return stopped(input, "action_undeclared");
  if (isBrowserPrimitiveAction(input.action.action_id)) return stopped(input, "action_unclassifiable");
  if (!matchesBusinessActionTarget(match.target_scope, input.action.target)) return stopped(input, "target_mismatch");
  return {
    action_instance_ref: input.action.action_instance_ref,
    action_id: input.action.action_id,
    target: { ...input.action.target },
    category: match.category,
    owner_matcher: match.matcher,
    owner_declaration_ref: match.owner_declaration_ref,
    owner_declaration_version: match.owner_declaration_version,
    resource_match_ref: match.resource_match_ref,
    resource_match_version: match.resource_match_version
  };
}

function currentPolicy(input: ParsedExecutionPolicyEvaluationInput, category: BusinessActionCategory): EffectiveExecutionPolicy | undefined {
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

function validSingleDecision(input: ParsedExecutionPolicyEvaluationInput, action: EvaluatedBusinessAction, current: EffectiveExecutionPolicy): SingleActionDecision | undefined {
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

function evaluated(input: ParsedExecutionPolicyEvaluationInput, action: EvaluatedBusinessAction, policy: EffectiveExecutionPolicy): ExecutionPolicyEvaluation {
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
    if (!input) return rememberEvaluation(invalidInput());
    const action = matchedAction(input);
    if ("status" in action) return rememberEvaluation(action, input);
    const current = currentPolicy(input, action.category);
    if (!current) return rememberEvaluation(stopped(input, "policy_unavailable", action), input);
    const single = validSingleDecision(input, action, current);
    return rememberEvaluation(
      evaluated(input, action, single ? { mode: single.mode, source: "single_action_decision", source_ref: single.source_ref, source_version: single.source_version } : current),
      input,
      single?.expires_at
    );
  } catch {
    return rememberEvaluation(invalidInput());
  }
}
