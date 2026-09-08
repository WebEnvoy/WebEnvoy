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
  confirmationContext?: XhsConfirmationContext;
};

type ConfirmationStatus = "verified" | "unknown" | "mismatch";

export type XhsConfirmationContext = {
  status: "ready" | "blocked";
  runtimeBinding: {
    runtimeSessionRef: string;
    identityEnvironmentRef: string;
    profileRef: string;
    providerRef: string;
    controlOwner: "core_task";
    observationGeneration: string;
    observationRef: string;
  };
  account: { status: ConfirmationStatus; accountRef: string | null; label: string | null };
  businessTarget: { status: ConfirmationStatus; targetRef: string | null; label: string | null };
  page: { status: "verified" | "unknown" | "stale"; url: string; fingerprint: string | null; diff: "unchanged" | "changed" | "unknown" };
  media: { status: ConfirmationStatus; imageCount: number | null; orderedItemRefs: string[]; summary: string | null };
  fields: {
    status: ConfirmationStatus;
    title: ConfirmationField;
    body: ConfirmationField;
  };
  pendingIssues: string[];
  observedAt: string;
  fingerprint: string;
  failClosed: true;
};

type ConfirmationField = { state: "empty" | "present" | "unknown"; length: number | null; summary: string | null };

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
    const context = parseConfirmationContext(record?.confirmation_context);
    const decision = parsePendingDecision(record?.authorization_decision);
    return record?.ok === true && decision != null && decision.decisionRef === expected.decisionRef &&
      decision.runId === expected.runId && decision.threadId === expected.threadId && decision.turnId === expected.turnId
      ? { ok: true as const, decision: { ...decision, ...(context ? { confirmationContext: context } : {}) } }
      : { ok: false as const, reason: "当前动作确认与本回合不匹配或已失效。" };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function refreshPendingAuthorizationDecision(endpoint: string, expected: PendingAuthorizationBinding) {
  try {
    const response = await requestOwnerJson(endpoint, `/authorization-decisions/${encodeURIComponent(expected.decisionRef)}/preflight`, {
      method: "POST",
      timeoutMs: 15_000,
      includeErrorBody: true,
    });
    const envelope = asRecord(response);
    const record = asRecord(envelope?.body) ?? envelope;
    const context = parseConfirmationContext(record?.confirmation_context);
    const decision = parsePendingDecision(record?.authorization_decision);
    return decision != null && decision.decisionRef === expected.decisionRef && decision.runId === expected.runId &&
      decision.threadId === expected.threadId && decision.turnId === expected.turnId
      ? { ok: true as const, decision: { ...decision, ...(context ? { confirmationContext: context } : {}) } }
      : { ok: false as const, reason: ownerError(record, "Core 未能重新观察当前 Instance。") };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function requiresXhsConfirmationContext(decision: PendingAuthorizationDecision) {
  return decision.siteSlug === "xiaohongshu" && decision.actionId.startsWith("xhs_publish_note_image_text_");
}

export function canAllowPendingDecision(decision: PendingAuthorizationDecision) {
  if (!requiresXhsConfirmationContext(decision)) return true;
  const context = decision.confirmationContext;
  if (!(context?.status === "ready" && context.failClosed && context.runtimeBinding.controlOwner === "core_task" &&
    context.account.status === "verified" && context.businessTarget.status === "verified" &&
    context.page.status === "verified" && context.page.diff === "unchanged" &&
    context.pendingIssues.length === 0)) return false;
  const commit = decision.actionId.endsWith(".save_draft") || decision.actionId.endsWith(".publish");
  return (!commit || context.media.status === "verified") &&
    (!(commit || decision.actionId === "xhs_publish_note_image_text_fields.compose") || context.fields.status === "verified");
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

function parseConfirmationContext(value: unknown): XhsConfirmationContext | null {
  const record = asRecord(value);
  if (record == null) return null;
  const binding = asRecord(record.runtime_binding);
  const account = parseNamedFact(record.account, "account_ref");
  const businessTarget = parseNamedFact(record.business_target, "target_ref");
  const page = asRecord(record.page);
  const media = asRecord(record.media);
  const fields = asRecord(record.fields);
  const title = parseConfirmationField(fields?.title);
  const body = parseConfirmationField(fields?.body);
  if (!hasExactKeys(record, ["schema_version", "status", "runtime_binding", "account", "business_target", "page", "media", "fields", "pending_issues", "observed_at", "fingerprint", "fail_closed"]) ||
    record.schema_version !== "webenvoy.xhs-confirmation-context/v0" || (record.status !== "ready" && record.status !== "blocked") || record.fail_closed !== true ||
    binding == null || !hasExactKeys(binding, ["runtime_session_ref", "identity_environment_ref", "profile_ref", "provider_ref", "control_owner", "observation_generation", "observation_ref"]) ||
    ![binding.runtime_session_ref, binding.identity_environment_ref, binding.profile_ref, binding.provider_ref, binding.observation_ref].every(validRef) ||
    binding.control_owner !== "core_task" || typeof binding.observation_generation !== "string" ||
    !(binding.observation_generation === "unknown" || /^fnv1a:[a-f0-9]{8}$/.test(binding.observation_generation)) ||
    account == null || businessTarget == null || page == null || !hasExactKeys(page, ["status", "url", "fingerprint", "diff"]) ||
    (page.status !== "verified" && page.status !== "unknown" && page.status !== "stale") || typeof page.url !== "string" || !validHttpsUrl(page.url) ||
    (page.fingerprint !== null && (typeof page.fingerprint !== "string" || !/^fnv1a:[a-f0-9]{8}$/.test(page.fingerprint))) ||
    (page.diff !== "unchanged" && page.diff !== "changed" && page.diff !== "unknown") ||
    media == null || !hasExactKeys(media, ["status", "image_count", "ordered_item_refs", "summary"]) || !isConfirmationStatus(media.status) ||
    (media.image_count !== null && (!Number.isSafeInteger(media.image_count) || Number(media.image_count) < 0)) ||
    !Array.isArray(media.ordered_item_refs) || media.ordered_item_refs.length > 32 || !media.ordered_item_refs.every(validRef) || !validSummary(media.summary) ||
    fields == null || !hasExactKeys(fields, ["status", "title", "body"]) || !isConfirmationStatus(fields.status) || title == null || body == null ||
    !Array.isArray(record.pending_issues) || record.pending_issues.length > 24 || !record.pending_issues.every((item) => typeof item === "string" && item.length > 0 && item.length <= 160) ||
    !validTime(record.observed_at) || typeof record.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.fingerprint)) return null;
  return {
    status: record.status,
    runtimeBinding: {
      runtimeSessionRef: binding.runtime_session_ref as string,
      identityEnvironmentRef: binding.identity_environment_ref as string,
      profileRef: binding.profile_ref as string,
      providerRef: binding.provider_ref as string,
      controlOwner: "core_task",
      observationGeneration: binding.observation_generation,
      observationRef: binding.observation_ref as string,
    },
    account: { status: account.status, accountRef: account.ref, label: account.label },
    businessTarget: { status: businessTarget.status, targetRef: businessTarget.ref, label: businessTarget.label },
    page: { status: page.status, url: page.url, fingerprint: page.fingerprint as string | null, diff: page.diff },
    media: { status: media.status, imageCount: media.image_count as number | null, orderedItemRefs: media.ordered_item_refs as string[], summary: media.summary as string | null },
    fields: { status: fields.status, title, body },
    pendingIssues: record.pending_issues as string[],
    observedAt: record.observed_at as string,
    fingerprint: record.fingerprint,
    failClosed: true,
  };
}

function parseNamedFact(value: unknown, refKey: "account_ref" | "target_ref") {
  const record = asRecord(value);
  if (record == null || !hasExactKeys(record, ["status", refKey, "label"]) || !isConfirmationStatus(record.status) ||
    (record[refKey] !== null && !validRef(record[refKey])) || !validSummary(record.label)) return null;
  return { status: record.status, ref: record[refKey] as string | null, label: record.label as string | null };
}

function parseConfirmationField(value: unknown): ConfirmationField | null {
  const record = asRecord(value);
  if (record == null || !hasExactKeys(record, ["state", "length", "summary"]) ||
    (record.state !== "empty" && record.state !== "present" && record.state !== "unknown") ||
    (record.length !== null && (!Number.isSafeInteger(record.length) || Number(record.length) < 0)) || !validSummary(record.summary)) return null;
  return { state: record.state, length: record.length as number | null, summary: record.summary as string | null };
}

function isConfirmationStatus(value: unknown): value is ConfirmationStatus {
  return value === "verified" || value === "unknown" || value === "mismatch";
}

function validRef(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z][A-Za-z0-9._:/-]*$/.test(value);
}

function validSummary(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 280);
}

function validHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
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
      .every((item) => typeof item === "string" && item.length > 0 && item.length <= 512 && !/^https?:\/\//i.test(item));
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
