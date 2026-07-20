export const executionPolicyEvaluationSchemaVersion = "webenvoy.execution-policy-evaluation.v0";

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

export type BusinessActionDeclaration = {
  owner: "Lode" | "Harbor";
  declaration_ref: string;
  action_id: string;
  category: string;
  target_scope: {
    target_types: readonly string[];
    site_slug?: string;
    supported_origins?: readonly string[];
  };
  valid_from?: string;
  valid_until?: string;
};

export type BusinessActionRequest = {
  action_instance_ref: string;
  action_id: string;
  target: BusinessActionTarget;
  declaration?: BusinessActionDeclaration;
};

type PolicyModes = Partial<Record<BusinessActionCategory, ExecutionPolicyMode>>;

export type ExecutionPolicyContext = {
  thread_ref?: string;
  skill_ref?: string;
};

export type SingleActionDecision = {
  source_ref: string;
  action_instance_ref: string;
  action_id: string;
  category: BusinessActionCategory;
  target_ref: string;
  mode: "auto" | "deny";
  state: "active" | "consumed" | "cancelled" | "expired" | "target_changed";
  expires_at: string;
};

export type ExecutionPolicySources = {
  single_action_decision?: SingleActionDecision;
  thread_revision?: { source_ref: string; thread_ref: string; modes: PolicyModes };
  installed_skill_user_version?: { source_ref: string; skill_ref: string; modes: PolicyModes };
  global_user_config?: { source_ref: string; modes: PolicyModes };
};

export type ExecutionPolicyEvaluationInput = {
  caller: ExecutionPolicyCaller;
  evaluated_at: string;
  action: BusinessActionRequest;
  context: ExecutionPolicyContext;
  policies: ExecutionPolicySources;
};

export type EvaluatedBusinessAction = {
  action_instance_ref: string;
  action_id: string;
  target_ref: string;
  category: BusinessActionCategory;
  declaration_ref: string;
};

export type EffectiveExecutionPolicy = {
  mode: ExecutionPolicyMode;
  source: ExecutionPolicySource;
  source_ref: string;
};

export type SingleActionConfirmationRequest = {
  scope: "current_action";
  action_instance_ref: string;
  action_id: string;
  target_ref: string;
  category: BusinessActionCategory;
  choices: readonly ["allow_once", "deny_once"];
};

type EvaluationBase = {
  schema_version: typeof executionPolicyEvaluationSchemaVersion;
  evaluated_at: string;
};

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
      stop_reason:
        | "action_undeclared"
        | "action_unclassifiable"
        | "declaration_invalid"
        | "declaration_not_yet_valid"
        | "declaration_expired"
        | "target_mismatch"
        | "policy_unavailable";
      action?: EvaluatedBusinessAction;
      risk_marker?: "destructive" | null;
    });

const actionCategories = new Set<BusinessActionCategory>(["read", "prepare", "commit", "destructive"]);
const policyModes = new Set<ExecutionPolicyMode>(["auto", "confirm", "deny"]);
const privateRefPattern = /(https?:\/\/|[\r\n\0]|cookie|token|password|raw[_-]?(?:evidence|dom|har))/i;

function persistentRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !privateRefPattern.test(value);
}

function httpsOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
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

export function matchesBusinessActionTarget(
  scope: BusinessActionDeclaration["target_scope"],
  target: BusinessActionTarget
): boolean {
  if (!scope || !target || !Array.isArray(scope.target_types) || !scope.target_types.includes(target.target_type)) return false;
  if (scope.site_slug !== undefined && scope.site_slug !== target.site_slug) return false;
  if (scope.supported_origins === undefined) return true;
  return scope.supported_origins.length > 0 && httpsOrigin(target.origin) &&
    scope.supported_origins.some((origin) => httpsOrigin(origin) && sameOrigin(origin, target.origin));
}

function validTargetScope(declaration: BusinessActionDeclaration): boolean {
  const scope = declaration.target_scope;
  if (!scope || !Array.isArray(scope.target_types) || scope.target_types.length === 0 ||
    !scope.target_types.every((type) => typeof type === "string" && type.length > 0)) return false;
  if (declaration.owner === "Lode") {
    return typeof scope.site_slug === "string" && scope.site_slug.length > 0 &&
      Array.isArray(scope.supported_origins) && scope.supported_origins.length > 0 && scope.supported_origins.every(httpsOrigin);
  }
  return (scope.site_slug === undefined || typeof scope.site_slug === "string") &&
    (scope.supported_origins === undefined ||
      (Array.isArray(scope.supported_origins) && scope.supported_origins.length > 0 && scope.supported_origins.every(httpsOrigin)));
}

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stopped(
  input: ExecutionPolicyEvaluationInput,
  stopReason: Extract<ExecutionPolicyEvaluation, { status: "stopped" }>["stop_reason"],
  action?: EvaluatedBusinessAction
): ExecutionPolicyEvaluation {
  return {
    schema_version: executionPolicyEvaluationSchemaVersion,
    evaluated_at: input.evaluated_at,
    status: "stopped",
    next_step: "stop",
    stop_reason: stopReason,
    ...(action === undefined ? {} : { action, risk_marker: action.category === "destructive" ? "destructive" as const : null })
  };
}

function validateAction(input: ExecutionPolicyEvaluationInput): EvaluatedBusinessAction | ExecutionPolicyEvaluation {
  const declaration = input.action.declaration;
  if (!declaration || declaration.action_id !== input.action.action_id) return stopped(input, "action_undeclared");
  if (!actionCategories.has(declaration.category as BusinessActionCategory)) return stopped(input, "action_unclassifiable");
  const evaluatedAt = instant(input.evaluated_at);
  if (
    (declaration.owner !== "Lode" && declaration.owner !== "Harbor") ||
    !persistentRef(declaration.declaration_ref) ||
    !persistentRef(input.action.action_instance_ref) ||
    !persistentRef(input.action.target.target_ref) ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(input.action.action_id) ||
    !validTargetScope(declaration) ||
    evaluatedAt === undefined
  ) return stopped(input, "declaration_invalid");
  const action: EvaluatedBusinessAction = {
    action_instance_ref: input.action.action_instance_ref,
    action_id: input.action.action_id,
    target_ref: input.action.target.target_ref,
    category: declaration.category as BusinessActionCategory,
    declaration_ref: declaration.declaration_ref
  };
  const validFrom = declaration.valid_from === undefined ? undefined : instant(declaration.valid_from);
  const validUntil = declaration.valid_until === undefined ? undefined : instant(declaration.valid_until);
  if ((declaration.valid_from !== undefined && validFrom === undefined) || (declaration.valid_until !== undefined && validUntil === undefined)) {
    return stopped(input, "declaration_invalid", action);
  }
  if (validFrom !== undefined && evaluatedAt < validFrom) return stopped(input, "declaration_not_yet_valid", action);
  if (validUntil !== undefined && evaluatedAt >= validUntil) return stopped(input, "declaration_expired", action);
  if (!matchesBusinessActionTarget(declaration.target_scope, input.action.target)) return stopped(input, "target_mismatch", action);
  return action;
}

function singleActionMode(input: ExecutionPolicyEvaluationInput, category: BusinessActionCategory): ExecutionPolicyMode | undefined {
  const decision = input.policies.single_action_decision;
  const now = instant(input.evaluated_at);
  const expiresAt = decision === undefined ? undefined : instant(decision.expires_at);
  if (
    !decision || decision.state !== "active" || !persistentRef(decision.source_ref) ||
    (decision.mode !== "auto" && decision.mode !== "deny") ||
    now === undefined || expiresAt === undefined || now >= expiresAt
  ) return undefined;
  return decision.action_instance_ref === input.action.action_instance_ref &&
    decision.action_id === input.action.action_id &&
    decision.target_ref === input.action.target.target_ref &&
    decision.category === category
    ? decision.mode
    : undefined;
}

function effectivePolicy(input: ExecutionPolicyEvaluationInput, category: BusinessActionCategory): EffectiveExecutionPolicy | undefined {
  const singleMode = singleActionMode(input, category);
  if (singleMode !== undefined) {
    return { mode: singleMode, source: "single_action_decision", source_ref: input.policies.single_action_decision!.source_ref };
  }
  const candidates: readonly [ExecutionPolicySource, { source_ref: string; modes: PolicyModes } | undefined, boolean][] = [
    ["thread_revision", input.policies.thread_revision, input.policies.thread_revision?.thread_ref === input.context.thread_ref],
    ["installed_skill_user_version", input.policies.installed_skill_user_version, input.policies.installed_skill_user_version?.skill_ref === input.context.skill_ref],
    ["global_user_config", input.policies.global_user_config, true]
  ];
  for (const [source, policy, applies] of candidates) {
    const mode = policy?.modes?.[category];
    if (applies && persistentRef(policy?.source_ref) && policyModes.has(mode as ExecutionPolicyMode)) {
      return { mode: mode as ExecutionPolicyMode, source, source_ref: policy.source_ref };
    }
  }
  return undefined;
}

export function evaluateExecutionPolicy(input: ExecutionPolicyEvaluationInput): ExecutionPolicyEvaluation {
  const action = validateAction(input);
  if ("status" in action) return action;
  const policy = effectivePolicy(input, action.category);
  if (!policy) return stopped(input, "policy_unavailable", action);
  const base: EvaluationBase & {
    status: "evaluated";
    action: EvaluatedBusinessAction;
    risk_marker: "destructive" | null;
    effective_policy: EffectiveExecutionPolicy;
  } = {
    schema_version: executionPolicyEvaluationSchemaVersion,
    evaluated_at: input.evaluated_at,
    status: "evaluated" as const,
    action,
    risk_marker: action.category === "destructive" ? "destructive" as const : null,
    effective_policy: policy
  };
  if (policy.mode === "auto") return { ...base, next_step: "execute" };
  if (policy.mode === "deny") return { ...base, next_step: "stop", stop_reason: "policy_denied" };
  return {
    ...base,
    next_step: "request_confirmation",
    confirmation_request: {
      scope: "current_action",
      action_instance_ref: action.action_instance_ref,
      action_id: action.action_id,
      target_ref: action.target_ref,
      category: action.category,
      choices: ["allow_once", "deny_once"]
    }
  };
}
