import type { ExecutionCategory, ExecutionPolicySource } from "./executionPolicyClient";
import { requestOwnerJson } from "./ownerApiClient";

type JsonRecord = Record<string, unknown>;
const decisionBoundary = "Business policy decision summary only; technical trace and private browser, evidence, and content material are excluded.";
const decisionRefPattern = /^authorization-decision:[a-f0-9]{32}:[a-f0-9]{32}$/;

export type PendingAuthorizationDecision = {
  decisionRef: string;
  actionId: string;
  category: ExecutionCategory;
  targetRef: string;
  targetType: string;
  siteSlug?: string;
  origin?: string;
  policySource: ExecutionPolicySource;
  expiresAt: string;
  destructive: boolean;
  runId: string;
  threadId: string;
  turnId: string;
};

export type PendingAuthorizationBinding = {
  decisionRef: string;
  runId: string;
  threadId: string;
  turnId: string;
};

export async function fetchPendingAuthorizationDecision(endpoint: string, expected: PendingAuthorizationBinding) {
  try {
    const response = await requestOwnerJson(endpoint, `/authorization-decisions/${encodeURIComponent(expected.decisionRef)}`, { timeoutMs: 3500 });
    const record = asRecord(response);
    const decision = parsePendingDecision(record?.authorization_decision);
    return record?.ok === true && decision != null && decision.decisionRef === expected.decisionRef &&
      decision.runId === expected.runId && decision.threadId === expected.threadId && decision.turnId === expected.turnId
      ? { ok: true as const, decision }
      : { ok: false as const, reason: "当前动作确认与本回合不匹配或已失效。" };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function decideSingleAction(
  endpoint: string,
  decisionRef: string,
  choice: "allow_once" | "deny_once",
  idempotencyKey = `app-single-action-${crypto.randomUUID()}`,
) {
  try {
    const response = await requestOwnerJson(endpoint, `/authorization-decisions/${encodeURIComponent(decisionRef)}/single-action`, {
      method: "POST",
      timeoutMs: 5000,
      body: {
        schema_version: "webenvoy.single-action-decision-command.v0",
        idempotency_key: idempotencyKey,
        choice,
      },
    });
    const record = asRecord(response);
    const decision = asRecord(record?.single_action_decision);
    const expectedMode = choice === "allow_once" ? "auto" : "deny";
    return record?.ok === true && decision?.confirmation_decision_ref === decisionRef && decision.mode === expectedMode
      ? { ok: true as const, summary: choice === "allow_once" ? "已允许这一次。" : "已拒绝这一次。" }
      : { ok: false as const, reason: ownerError(response, "Core 未接受当前单次决定。") };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

function parsePendingDecision(value: unknown): PendingAuthorizationDecision | null {
  const record = asRecord(value);
  const action = asRecord(record?.business_action);
  const target = asRecord(action?.target);
  const policy = asRecord(record?.effective_policy);
  const applicability = taskApplicability(record?.applicability);
  if (!record || !hasExactKeys(record, [
    "schema_version", "decision_ref", "business_action", "owner_declaration", "effective_policy", "applicability",
    "outcome", "risk_marker", "decided_at", "expires_at", "state", "invalidated_at", "invalidation_reason", "consumer_boundary",
  ]) || record.schema_version !== "webenvoy.authorization-decision.v0" || record.consumer_boundary !== decisionBoundary ||
    record.outcome !== "confirm" || record.state !== "active" || record.invalidated_at !== null || record.invalidation_reason !== null ||
    typeof record.decision_ref !== "string" || !decisionRefPattern.test(record.decision_ref) || !validTime(record.decided_at) || !validFutureTime(record.expires_at) ||
    !validOwnerDeclaration(record.owner_declaration) || applicability == null || !action ||
    !hasExactKeys(action, ["action_instance_ref", "action_id", "category", "target"]) || !target ||
    !hasExactKeys(target, ["target_ref", "target_type"], ["site_slug", "origin"]) || !policy ||
    !hasExactKeys(policy, ["mode", "source", "source_version"]) || policy.mode !== "confirm" ||
    typeof action.action_instance_ref !== "string" || typeof action.action_id !== "string" || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(action.action_id) ||
    !isCategory(action.category) || typeof target.target_ref !== "string" || target.target_ref.includes("://") || target.target_ref.length > 512 ||
    typeof target.target_type !== "string" || target.target_type.length === 0 || target.target_type.length > 128 ||
    (target.site_slug !== undefined && typeof target.site_slug !== "string") || !validOrigin(target.origin) ||
    !isPolicySource(policy.source) || typeof policy.source_version !== "string" || policy.source_version.length === 0 ||
    (record.risk_marker !== null && record.risk_marker !== "destructive") ||
    (action.category === "destructive") !== (record.risk_marker === "destructive")) return null;
  return {
    decisionRef: record.decision_ref,
    actionId: action.action_id,
    category: action.category,
    targetRef: target.target_ref,
    targetType: target.target_type,
    ...(typeof target.site_slug === "string" ? { siteSlug: target.site_slug } : {}),
    ...(typeof target.origin === "string" ? { origin: target.origin } : {}),
    policySource: policy.source,
    expiresAt: record.expires_at as string,
    destructive: record.risk_marker === "destructive",
    runId: applicability.runId,
    threadId: applicability.threadId,
    turnId: applicability.turnId,
  };
}

function validFutureTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validOrigin(value: unknown) {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  try {
    const origin = new URL(value);
    return (origin.protocol === "http:" || origin.protocol === "https:") && origin.origin === value && !origin.username && !origin.password;
  } catch {
    return false;
  }
}

function validOwnerDeclaration(value: unknown) {
  const declaration = asRecord(value);
  return declaration != null && hasExactKeys(declaration, [
    "matcher", "declaration_ref", "declaration_version", "resource_match_ref", "resource_match_version",
  ]) && (declaration.matcher === "lode_action_declaration" || declaration.matcher === "harbor_operation_catalog") &&
    [declaration.declaration_ref, declaration.declaration_version, declaration.resource_match_ref, declaration.resource_match_version]
      .every((item) => typeof item === "string" && item.length > 0 && item.length <= 512 && !item.includes("://"));
}

function taskApplicability(value: unknown) {
  const applicability = asRecord(value);
  if (applicability == null || !Array.isArray(applicability.config_refs) || applicability.config_refs.length !== 1 ||
    !applicability.config_refs.every((item) => typeof item === "string" && item.length > 0 && item.length <= 512 && !item.includes("://")) ||
    applicability.scope !== "task" ||
    !hasExactKeys(applicability, ["scope", "run_id", "thread_id", "turn_id", "config_refs"]) ||
    typeof applicability.run_id !== "string" || !/^thread_[a-f0-9]{32}$/.test(String(applicability.thread_id)) ||
    !/^turn_[a-f0-9]{32}$/.test(String(applicability.turn_id))) return null;
  return {
    runId: applicability.run_id,
    threadId: applicability.thread_id as string,
    turnId: applicability.turn_id as string,
  };
}

function hasExactKeys(value: JsonRecord, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function isCategory(value: unknown): value is ExecutionCategory {
  return value === "read" || value === "prepare" || value === "commit" || value === "destructive";
}

function isPolicySource(value: unknown): value is ExecutionPolicySource {
  return value === "thread_revision" || value === "installed_skill_user_version" || value === "global_user_config";
}

function ownerError(value: unknown, fallback: string) {
  const record = asRecord(value);
  const error = asRecord(record?.error);
  return typeof error?.code === "string" ? error.code : typeof record?.error === "string" ? record.error : fallback;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}
