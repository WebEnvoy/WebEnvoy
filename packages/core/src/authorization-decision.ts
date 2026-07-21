import type {
  BusinessActionCategory,
  BusinessActionTarget,
  ExecutionPolicyMode,
  TrustedExecutionPolicyEvaluationFacts
} from "./execution-policy.js";
import { normalizePublicOrigin, normalizeStoredTargetRef } from "./public-target-reference.js";
import {
  normalizeNonSensitiveText,
  persistentReferenceMaxLength,
  persistentVersionMaxLength
} from "./sensitive-field-taxonomy.js";

export const authorizationDecisionSchemaVersion = "webenvoy.authorization-decision.v0";
export const authorizationDecisionRefSchemaVersion = "webenvoy.authorization-decision-ref.v0";

export type AuthorizationDecisionSource =
  | "single_action"
  | "thread_revision"
  | "installed_skill_user_version"
  | "global_user_config";
export type AuthorizationDecisionState = "active" | "consumed" | "invalidated" | "expired";
export type AuthorizationDecisionInvalidationReason =
  | "completed"
  | "cancelled"
  | "expired"
  | "target_changed"
  | "owner_changed"
  | "action_reclassified"
  | "effective_policy_changed";

export type AuthorizationDecisionRef = {
  schema_version: typeof authorizationDecisionRefSchemaVersion;
  decision_ref: string;
};

export type AuthorizationDecisionApplicability =
  | {
      scope: "task";
      run_id: string;
      thread_id: string;
      turn_id: string;
      config_refs: string[];
    }
  | {
      scope: "environment";
      operation_ref: string;
      config_refs: string[];
    };

export type AuthorizationDecisionSummary = {
  schema_version: typeof authorizationDecisionSchemaVersion;
  decision_ref: string;
  business_action: {
    action_instance_ref: string;
    action_id: string;
    category: BusinessActionCategory | null;
    target: BusinessActionTarget;
  } | null;
  owner_declaration: {
    matcher: "lode_action_declaration" | "harbor_operation_catalog";
    declaration_ref: string;
    declaration_version: string;
    resource_match_ref: string;
    resource_match_version: string;
  } | null;
  effective_policy: {
    mode: ExecutionPolicyMode;
    source: AuthorizationDecisionSource;
    source_version: string;
  } | null;
  applicability: AuthorizationDecisionApplicability;
  outcome: "execute" | "confirm" | "stop";
  reason?: {
    kind: "system_stop" | "user_deny";
    code: string;
  };
  risk_marker: "destructive" | null;
  decided_at: string;
  expires_at: string | null;
  state: AuthorizationDecisionState;
  invalidated_at: string | null;
  invalidation_reason: AuthorizationDecisionInvalidationReason | null;
  consumer_boundary: string;
};

export type AuthorizationDecisionBase = Omit<
  AuthorizationDecisionSummary,
  "state" | "invalidated_at" | "invalidation_reason"
>;

export type AuthorizationDecisionSubject =
  | { scope: "task"; run_id: string; thread_id: string; turn_id: string }
  | { scope: "environment"; operation_ref: string };

const decisionRefPattern = /^authorization-decision:[a-f0-9]{32}:[a-f0-9]{32}$/;
const threadIdPattern = /^thread_[a-f0-9]{32}$/;
const turnIdPattern = /^turn_[a-f0-9]{32}$/;
const categories = new Set<BusinessActionCategory>(["read", "prepare", "commit", "destructive"]);
const modes = new Set<ExecutionPolicyMode>(["auto", "confirm", "deny"]);
const sources = new Set<AuthorizationDecisionSource>(["single_action", "thread_revision", "installed_skill_user_version", "global_user_config"]);
const outcomes = new Set<AuthorizationDecisionBase["outcome"]>(["execute", "confirm", "stop"]);
const lifecycleInvalidationReasons = new Set<AuthorizationDecisionInvalidationReason>([
  "completed", "cancelled", "expired", "target_changed", "owner_changed", "action_reclassified", "effective_policy_changed"
]);
const consumerBoundary = "Business policy decision summary only; technical trace and private browser, evidence, and content material are excluded.";

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authorization_decision_invalid");
  const object = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (!required.every((key) => Object.hasOwn(object, key)) || !Object.keys(object).every((key) => allowed.has(key))) {
    throw new Error("authorization_decision_invalid");
  }
  return object;
}

function requiredRef(value: unknown, label: string): string {
  const normalized = normalizeNonSensitiveText(value, persistentReferenceMaxLength);
  if (!normalized || /^https?:\/\//i.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
}

function requiredVersion(value: unknown, label: string): string {
  const normalized = normalizeNonSensitiveText(value, persistentVersionMaxLength);
  if (!normalized) throw new Error(`${label}_invalid`);
  return normalized;
}

export function parseAuthorizationDecisionRef(value: unknown): string {
  const ref = typeof value === "string" ? value : "";
  if (!decisionRefPattern.test(ref)) throw new Error("authorization_decision_ref_invalid");
  return ref;
}

export function authorizationDecisionRef(decisionRef: string): AuthorizationDecisionRef {
  return { schema_version: authorizationDecisionRefSchemaVersion, decision_ref: parseAuthorizationDecisionRef(decisionRef) };
}

export function isAuthorizationDecisionInvalidationReason(
  value: unknown
): value is AuthorizationDecisionInvalidationReason {
  return lifecycleInvalidationReasons.has(value as AuthorizationDecisionInvalidationReason);
}

export function authorizationTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}_invalid`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const offsetHour = Number(match?.[7] ?? 0);
  const offsetMinute = Number(match?.[8] ?? 0);
  if (!match || !year || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

export function authorizationDecisionTimeOrderValid(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const temporal = value as Record<string, unknown>;
    const decidedAt = Date.parse(authorizationTimestamp(temporal.decided_at, "decided_at"));
    const expiresAt = temporal.expires_at === null ? null
      : Date.parse(authorizationTimestamp(temporal.expires_at, "expires_at"));
    const invalidatedAt = temporal.invalidated_at === null ? null
      : Date.parse(authorizationTimestamp(temporal.invalidated_at, "invalidated_at"));
    return (expiresAt === null || expiresAt > decidedAt) &&
      (invalidatedAt === null || invalidatedAt >= decidedAt) &&
      (invalidatedAt === null || expiresAt === null || invalidatedAt <= expiresAt);
  } catch {
    return false;
  }
}

export function normalizeAuthorizationDecisionSubject(subject: AuthorizationDecisionSubject): AuthorizationDecisionSubject {
  if (subject.scope === "task") {
    const runId = requiredRef(subject.run_id, "run_id");
    const threadId = requiredRef(subject.thread_id, "thread_id");
    const turnId = requiredRef(subject.turn_id, "turn_id");
    if (!threadIdPattern.test(threadId) || !turnIdPattern.test(turnId)) throw new Error("task_authorization_binding_invalid");
    return { scope: "task", run_id: runId, thread_id: threadId, turn_id: turnId };
  }
  return { scope: "environment", operation_ref: requiredRef(subject.operation_ref, "operation_ref") };
}

function source(value: string): AuthorizationDecisionSource {
  return value === "single_action_decision" ? "single_action" : value as AuthorizationDecisionSource;
}

function safeTarget(target: BusinessActionTarget): BusinessActionTarget {
  if (normalizeStoredTargetRef(target.target_ref) !== target.target_ref) throw new Error("authorization_target_invalid");
  return structuredClone(target);
}

function normalizeTarget(value: unknown): BusinessActionTarget {
  const object = exactObject(value, ["target_ref", "target_type"], ["site_slug", "origin"]);
  const target: BusinessActionTarget = {
    target_ref: requiredRef(object.target_ref, "target_ref"),
    target_type: requiredVersion(object.target_type, "target_type")
  };
  if (object.site_slug !== undefined) target.site_slug = requiredVersion(object.site_slug, "site_slug");
  if (object.origin !== undefined) {
    if (typeof object.origin !== "string" || normalizePublicOrigin(object.origin) !== object.origin) throw new Error("target_origin_invalid");
    target.origin = object.origin;
  }
  return safeTarget(target);
}

function normalizeApplicability(value: unknown): AuthorizationDecisionApplicability {
  const object = exactObject(value, ["scope", "config_refs"], ["run_id", "thread_id", "turn_id", "operation_ref"]);
  if (!Array.isArray(object.config_refs) || object.config_refs.length > 1 || new Set(object.config_refs).size !== object.config_refs.length) {
    throw new Error("authorization_config_refs_invalid");
  }
  const config_refs = object.config_refs.map((ref) => requiredRef(ref, "config_ref"));
  if (object.scope === "task") {
    const subject = normalizeAuthorizationDecisionSubject({
      scope: "task",
      run_id: object.run_id as string,
      thread_id: object.thread_id as string,
      turn_id: object.turn_id as string
    });
    if (object.operation_ref !== undefined) throw new Error("authorization_applicability_invalid");
    return { ...subject, config_refs };
  }
  if (object.scope === "environment") {
    const subject = normalizeAuthorizationDecisionSubject({ scope: "environment", operation_ref: object.operation_ref as string });
    if (object.run_id !== undefined || object.thread_id !== undefined || object.turn_id !== undefined) throw new Error("authorization_applicability_invalid");
    return { ...subject, config_refs };
  }
  throw new Error("authorization_applicability_invalid");
}

export function normalizeAuthorizationDecisionBase(value: unknown): AuthorizationDecisionBase {
  const fields = ["schema_version", "decision_ref", "business_action", "owner_declaration", "effective_policy", "applicability", "outcome", "risk_marker", "decided_at", "expires_at", "consumer_boundary"];
  const object = exactObject(value, fields, ["reason"]);
  if (object.schema_version !== authorizationDecisionSchemaVersion || object.consumer_boundary !== consumerBoundary) throw new Error("authorization_decision_invalid");
  const actionObject = object.business_action === null ? undefined : exactObject(object.business_action, ["action_instance_ref", "action_id", "category", "target"]);
  const category = actionObject?.category;
  if (category !== undefined && category !== null && !categories.has(category as BusinessActionCategory)) throw new Error("authorization_category_invalid");
  const actionId = actionObject ? requiredVersion(actionObject.action_id, "action_id") : undefined;
  if (actionId !== undefined && !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(actionId)) throw new Error("authorization_action_id_invalid");
  const business_action = actionObject ? {
    action_instance_ref: requiredRef(actionObject.action_instance_ref, "action_instance_ref"),
    action_id: actionId!,
    category: category as BusinessActionCategory | null,
    target: normalizeTarget(actionObject.target)
  } : null;
  const ownerObject = object.owner_declaration === null ? undefined : exactObject(object.owner_declaration, ["matcher", "declaration_ref", "declaration_version", "resource_match_ref", "resource_match_version"]);
  if (ownerObject && ownerObject.matcher !== "lode_action_declaration" && ownerObject.matcher !== "harbor_operation_catalog") throw new Error("authorization_owner_invalid");
  const owner_declaration = ownerObject ? {
    matcher: ownerObject.matcher as "lode_action_declaration" | "harbor_operation_catalog",
    declaration_ref: requiredRef(ownerObject.declaration_ref, "declaration_ref"),
    declaration_version: requiredVersion(ownerObject.declaration_version, "declaration_version"),
    resource_match_ref: requiredRef(ownerObject.resource_match_ref, "resource_match_ref"),
    resource_match_version: requiredVersion(ownerObject.resource_match_version, "resource_match_version")
  } : null;
  const policyObject = object.effective_policy === null ? undefined : exactObject(object.effective_policy, ["mode", "source", "source_version"]);
  if (policyObject && (!modes.has(policyObject.mode as ExecutionPolicyMode) || !sources.has(policyObject.source as AuthorizationDecisionSource))) throw new Error("authorization_policy_invalid");
  const effective_policy = policyObject ? {
    mode: policyObject.mode as ExecutionPolicyMode,
    source: policyObject.source as AuthorizationDecisionSource,
    source_version: requiredVersion(policyObject.source_version, "source_version")
  } : null;
  const outcome = object.outcome as AuthorizationDecisionBase["outcome"];
  if (!outcomes.has(outcome)) throw new Error("authorization_outcome_invalid");
  const reasonObject = object.reason === undefined ? undefined : exactObject(object.reason, ["kind", "code"]);
  if (reasonObject && reasonObject.kind !== "system_stop" && reasonObject.kind !== "user_deny") throw new Error("authorization_reason_invalid");
  const reason = reasonObject ? { kind: reasonObject.kind as "system_stop" | "user_deny", code: requiredVersion(reasonObject.code, "reason_code") } : undefined;
  if ((outcome === "stop") !== (reason !== undefined) || reason?.kind === "system_stop" && effective_policy !== null ||
    reason?.kind === "user_deny" && effective_policy?.mode !== "deny" || effective_policy?.mode === "auto" && outcome !== "execute" ||
    effective_policy?.mode === "confirm" && outcome !== "confirm" || effective_policy?.mode === "deny" && outcome !== "stop" ||
    effective_policy === null && reason?.kind !== "system_stop") throw new Error("authorization_decision_semantics_invalid");
  const riskMarker = object.risk_marker;
  if (riskMarker !== null && riskMarker !== "destructive" || (category === "destructive") !== (riskMarker === "destructive")) throw new Error("authorization_risk_marker_invalid");
  if (business_action === null ? owner_declaration !== null : (category === null) !== (owner_declaration === null)) {
    throw new Error("authorization_owner_invalid");
  }
  const applicability = normalizeApplicability(object.applicability);
  if (effective_policy === null ? applicability.config_refs.length !== 0 : applicability.config_refs.length !== 1) {
    throw new Error("authorization_config_refs_invalid");
  }
  const decidedAt = authorizationTimestamp(object.decided_at, "decided_at");
  const expiresAt = object.expires_at === null ? null : authorizationTimestamp(object.expires_at, "expires_at");
  if (!authorizationDecisionTimeOrderValid({ decided_at: decidedAt, expires_at: expiresAt, invalidated_at: null })) {
    throw new Error("authorization_decision_expiry_invalid");
  }
  return {
    schema_version: authorizationDecisionSchemaVersion,
    decision_ref: parseAuthorizationDecisionRef(object.decision_ref),
    business_action,
    owner_declaration,
    effective_policy,
    applicability,
    outcome,
    ...(reason === undefined ? {} : { reason }),
    risk_marker: riskMarker as "destructive" | null,
    decided_at: decidedAt,
    expires_at: expiresAt,
    consumer_boundary: consumerBoundary
  };
}

export function normalizeAuthorizationDecisionSummary(value: unknown): AuthorizationDecisionSummary {
  const object = exactObject(value, [
    "schema_version", "decision_ref", "business_action", "owner_declaration", "effective_policy", "applicability",
    "outcome", "risk_marker", "decided_at", "expires_at", "state", "invalidated_at", "invalidation_reason", "consumer_boundary"
  ], ["reason"]);
  const { state, invalidated_at, invalidation_reason, ...baseFields } = object;
  const base = normalizeAuthorizationDecisionBase(baseFields);
  if (state !== "active" && state !== "consumed" && state !== "invalidated" && state !== "expired") {
    throw new Error("authorization_decision_state_invalid");
  }
  const invalidatedAt = invalidated_at === null ? null : authorizationTimestamp(invalidated_at, "invalidated_at");
  const reason = invalidation_reason as AuthorizationDecisionInvalidationReason | null;
  if (reason !== null && !isAuthorizationDecisionInvalidationReason(reason)) throw new Error("authorization_decision_lifecycle_invalid");
  const valid = state === "active"
    ? invalidatedAt === null && reason === null
    : invalidatedAt !== null && (
      state === "consumed" && reason === "completed" ||
      state === "expired" && reason === "expired" ||
      state === "invalidated" && reason !== null && !["completed", "expired"].includes(reason)
    );
  if (!valid || !authorizationDecisionTimeOrderValid({ ...base, invalidated_at: invalidatedAt })) {
    throw new Error("authorization_decision_lifecycle_invalid");
  }
  return { ...base, state, invalidated_at: invalidatedAt, invalidation_reason: reason };
}

function effectiveExpiry(facts: TrustedExecutionPolicyEvaluationFacts, requested: string | undefined): string | null {
  const values = [facts.single_action_decision?.expires_at, requested]
    .filter((value): value is string => value !== undefined)
    .map((value) => authorizationTimestamp(value, "expires_at"));
  return values.length === 0 ? null : values.sort((left, right) => Date.parse(left) - Date.parse(right))[0]!;
}

export function buildAuthorizationDecisionBase(input: {
  decision_ref: string;
  facts: TrustedExecutionPolicyEvaluationFacts;
  subject: AuthorizationDecisionSubject;
  fallback_decided_at: string;
  expires_at?: string;
}): AuthorizationDecisionBase {
  const evaluation = input.facts.evaluation;
  const decidedAt = "evaluated_at" in evaluation
    ? authorizationTimestamp(evaluation.evaluated_at, "decided_at")
    : authorizationTimestamp(input.fallback_decided_at, "decided_at");
  const requestedAction = input.facts.requested_action;
  const evaluatedAction = "action" in evaluation ? evaluation.action : undefined;
  const ownerMatches = requestedAction !== undefined && input.facts.owner_proof?.action_id === requestedAction.action_id;
  const category = evaluatedAction?.category ?? (ownerMatches ? input.facts.owner_proof!.category : null);
  const target = evaluatedAction?.target ?? requestedAction?.target;
  const businessAction = requestedAction && target ? {
    action_instance_ref: requiredRef(requestedAction.action_instance_ref, "action_instance_ref"),
    action_id: requiredRef(requestedAction.action_id, "action_id"),
    category,
    target: safeTarget(target)
  } : null;
  const owner = ownerMatches ? input.facts.owner_proof! : undefined;
  const policy = evaluation.status === "evaluated" ? evaluation.effective_policy : undefined;
  const configRefs = policy === undefined ? [] : [requiredRef(policy.source_ref, "effective_policy_source_ref")];
  const subject = normalizeAuthorizationDecisionSubject(input.subject);
  const applicability = { ...subject, config_refs: configRefs } as AuthorizationDecisionApplicability;
  const outcome = evaluation.status === "evaluated"
    ? evaluation.next_step === "request_confirmation" ? "confirm" : evaluation.next_step
    : "stop";
  const reason = evaluation.status === "stopped"
    ? { kind: "system_stop" as const, code: evaluation.stop_reason }
    : evaluation.next_step === "stop"
      ? { kind: "user_deny" as const, code: evaluation.stop_reason ?? "policy_denied" }
      : undefined;
  const expiresAt = effectiveExpiry(input.facts, input.expires_at);
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(decidedAt)) throw new Error("authorization_decision_expiry_invalid");
  return {
    schema_version: authorizationDecisionSchemaVersion,
    decision_ref: parseAuthorizationDecisionRef(input.decision_ref),
    business_action: businessAction,
    owner_declaration: owner ? {
      matcher: owner.matcher,
      declaration_ref: requiredRef(owner.owner_declaration_ref, "owner_declaration_ref"),
      declaration_version: requiredVersion(owner.owner_declaration_version, "owner_declaration_version"),
      resource_match_ref: requiredRef(owner.resource_match_ref, "resource_match_ref"),
      resource_match_version: requiredVersion(owner.resource_match_version, "resource_match_version")
    } : null,
    effective_policy: policy ? {
      mode: policy.mode,
      source: source(policy.source),
      source_version: requiredVersion(policy.source_version, "effective_policy_source_version")
    } : null,
    applicability,
    outcome,
    ...(reason === undefined ? {} : { reason }),
    risk_marker: category === "destructive" ? "destructive" : null,
    decided_at: decidedAt,
    expires_at: expiresAt,
    consumer_boundary: consumerBoundary
  };
}
