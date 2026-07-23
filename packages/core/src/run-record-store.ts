import { link, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { normalizeFailureRecord, type FailureAttribution } from "./failure-attribution.js";
import {
  authorizationTimestamp,
  buildAuthorizationDecisionBase,
  parseAuthorizationDecisionRef,
  type AuthorizationDecisionBase,
  type AuthorizationDecisionSubject
} from "./authorization-decision.js";
import {
  authorizationDecisionJournalLockPath,
  commitTaskAuthorizationDecisionJournalEntry,
  prepareAuthorizationDecisionJournalEntry,
  readAuthorizationDecisionJournal,
  visibleAuthorizationDecisionEntries,
  writeAuthorizationDecisionJournal,
  type PreparedAuthorizationDecision
} from "./authorization-decision-journal.js";
import { normalizeStoredTargetRef } from "./public-target-reference.js";
import { normalizeNonSensitiveText } from "./sensitive-field-taxonomy.js";
import {
  FileOwnershipError,
  isFileOwnershipOwnerAlive,
  readFileOwnership,
  recoverDeadFileOwnership,
  releaseFileOwnership,
  tryAcquireFileOwnership,
  withFileOwnershipLock
} from "./file-ownership.js";
import type { RuntimeSessionBindingFacts } from "./harbor-admission.js";
import { readTrustedExecutionPolicyEvaluation } from "./execution-policy.js";
import { requireRunId } from "./run-id.js";

export const runRecordSchemaVersion = "webenvoy.run-record.v0";

export type RunRecordStatus =
  | "pending"
  | "admitted"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "requires_user_action"
  | "manual_recovery_required"
  | "unknown_outcome"
  | "cancelled"
  | "expired";

export type SuccessfulRunResultOutcome = "success" | "partial" | "empty";
export type RetentionState = "active" | "summary_only" | "expired" | "redacted" | "access_denied" | "deleted_by_policy";
export type PostCheckStatus = "passed" | "failed" | "blocked" | "not_run";

export type PostCheckResult = {
  schema_version: "webenvoy.post-check-result.v0";
  status: PostCheckStatus;
  summary: string;
  checked_at?: string;
  code?: string;
  attribution?: FailureAttribution;
  recovery_hint?: string;
  evidence_refs?: string[];
  source_refs?: string[];
  consumer_boundary: string;
};

export type AdmissionDecision = {
  decision: "accepted" | "accepted_with_warnings" | "blocked_pre_admission" | "requires_user_action" | "deferred_true_write";
  action_risk: "read" | "write" | "submit" | "destructive";
  resource_requirement_refs?: readonly string[];
  runtime_binding_refs?: readonly string[];
  evidence_refs?: readonly string[];
  resource_match_ref?: string;
  runtime_session_binding?: RuntimeSessionBindingFacts;
};

export type ActionRequest = {
  schema_version: "webenvoy.action-request.v0";
  action_request_id: string;
  task_intent_ref: string;
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  capability_lock_ref?: string;
  package_ref?: string;
  operation_mode: "validate_only" | "draft" | "preview" | "blocked_true_write";
  risk_classification: {
    risk: AdmissionDecision["action_risk"];
    execution_intent: string;
    level: "low" | "medium" | "high" | "blocked";
    true_write_requested: boolean;
    reasons: string[];
  };
  no_submit_guard: {
    status: "active";
    enforced_by: "core";
    blocked_execution_intents: string[];
    source_refs: string[];
  };
  target_refs?: {
    scope_target_ref: string;
    writable_target_ref?: string;
    form_state_ref?: string;
  };
  runtime_binding_refs?: readonly string[];
  evidence_refs?: readonly string[];
  consumer_boundary: string;
};

export type ApprovalRequestStatus = "pending" | "expired" | "blocked";

export type ApprovalRequest = {
  schema_version: "webenvoy.approval-request.v0";
  approval_request_id: string;
  action_request_id: string;
  task_intent_ref: string;
  status: ApprovalRequestStatus;
  requested_at: string;
  expires_at?: string;
  risk: AdmissionDecision["action_risk"];
  blocking_reasons?: string[];
  source_refs?: string[];
  evidence_refs?: string[];
  consumer_boundary: string;
};

export type PreviewResultState = "available" | "preview_unavailable" | "page_changed" | "user_cancelled";
export type PreviewFailureClass = Exclude<PreviewResultState, "available">;

export type PreviewResult = {
  schema_version: "webenvoy.preview-result.v0";
  state: PreviewResultState;
  submitted: false;
  expected_change?: Record<string, unknown>;
  action_refs: {
    action_request_id: string;
  };
  capability: {
    capability_ref: string;
    capability_version?: string;
    capability_source_ref?: string;
    capability_lock_ref?: string;
    package_ref?: string;
  };
  evidence_refs: string[];
  failure_class?: PreviewFailureClass;
  consumer_boundary: string;
};

export type FailureRecord = {
  category:
    | "request_invalid"
    | "capability_contract"
    | "resource_admission"
    | "action_risk"
    | "runtime_execution"
    | "result_projection"
    | "evidence_reference"
    | "persistence_observability"
    | "write_outcome";
  code: string;
  phase:
    | "pre_admission"
    | "admission"
    | "resource_matching"
    | "runtime_binding"
    | "execution"
    | "verification"
    | "projection"
    | "evidence"
    | "persistence"
    | "observability"
    | "query"
    | "write_verification"
    | "reconciliation";
  recovery_hint: string;
  attribution?: FailureAttribution;
};

export type RunRecord = {
  schema_version: typeof runRecordSchemaVersion;
  run_id: string;
  status: RunRecordStatus;
  created_at: string;
  updated_at: string;
  terminal_at?: string;
  task_intent_ref: string;
  entrypoint_ref?: string;
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  capability_lock_ref?: string;
  package_ref?: string;
  scope_target_ref?: string;
  admission: AdmissionDecision;
  runtime_binding_refs?: string[];
  action_request?: ActionRequest;
  approval_request?: ApprovalRequest;
  result_ref?: string;
  result_kind?: string;
  result_outcome?: SuccessfulRunResultOutcome;
  output_schema_id?: string;
  projection_ref?: string;
  public_result_summary?: Record<string, unknown>;
  source_refs?: string[];
  preview_result?: PreviewResult;
  evidence_refs?: string[];
  authorization_decision_refs?: string[];
  failure?: FailureRecord;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type CreateRunRecordInput = {
  run_id: string;
  task_intent_ref: string;
  capability_ref: string;
  admission: AdmissionDecision;
  status?: Extract<RunRecordStatus, "pending" | "admitted" | "failed" | "blocked" | "requires_user_action" | "cancelled" | "expired">;
  entrypoint_ref?: string;
  capability_version?: string;
  capability_source_ref?: string;
  capability_lock_ref?: string;
  package_ref?: string;
  scope_target_ref?: string;
  runtime_binding_refs?: readonly string[];
  action_request?: ActionRequest;
  approval_request?: ApprovalRequest;
  result_ref?: string;
  result_kind?: string;
  result_outcome?: SuccessfulRunResultOutcome;
  output_schema_id?: string;
  projection_ref?: string;
  public_result_summary?: Record<string, unknown>;
  source_refs?: readonly string[];
  preview_result?: PreviewResult;
  evidence_refs?: readonly string[];
  failure?: FailureRecord;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type RunRecordPatch = {
  status?: RunRecordStatus;
  runtime_binding_refs?: readonly string[];
  action_request?: ActionRequest;
  approval_request?: ApprovalRequest;
  result_ref?: string;
  result_kind?: string;
  result_outcome?: SuccessfulRunResultOutcome;
  output_schema_id?: string;
  projection_ref?: string;
  public_result_summary?: Record<string, unknown>;
  source_refs?: readonly string[];
  preview_result?: PreviewResult;
  evidence_refs?: readonly string[];
  failure?: FailureRecord;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type FileRunRecordStoreOptions = {
  directory: string;
  clock?: () => Date;
  lockTimeoutMs?: number;
};

export type FileRunRecordStore = {
  readonly directory: string;
  claimRunId(runId: string, ownerRef?: string): Promise<string | undefined>;
  getRunIdClaim(runId: string): Promise<{ owner_ref: string; owner_alive: boolean } | undefined>;
  recoverRunIdClaim(runId: string, expectedOwnerRef: string): Promise<boolean>;
  releaseRunIdClaim(runId: string, claimToken: string): Promise<void>;
  createRunRecord(input: CreateRunRecordInput, claimToken?: string): Promise<RunRecord>;
  getRunRecord(runId: string): Promise<RunRecord | undefined>;
  updateRunRecord(runId: string, patch: RunRecordPatch): Promise<RunRecord>;
  listRunRecords(): Promise<RunRecord[]>;
};

type AuthorizationDecisionRefTransaction = (
  runId: string,
  decisionDirectory: string,
  stream: string,
  prepared: PreparedAuthorizationDecision,
  observedAt: string,
  evaluation: unknown,
  idempotencyKey: string,
  expiresAt?: string
) => Promise<AuthorizationDecisionBase>;

const authorizationDecisionRefTransactions = new WeakMap<FileRunRecordStore, AuthorizationDecisionRefTransaction>();
const authorizationDecisionRefFaultTransactions = new WeakMap<
  FileRunRecordStore,
  (phase: "prepare" | "commit", transaction: Parameters<AuthorizationDecisionRefTransaction>) => Promise<AuthorizationDecisionBase>
>();

function assertTrustedPreparedAuthorizationDecision(
  prepared: PreparedAuthorizationDecision,
  evaluation: unknown,
  stream: string,
  idempotencyKey: string,
  expiresAt: string | undefined
): boolean {
  const facts = readTrustedExecutionPolicyEvaluation(evaluation);
  if (!facts) throw new Error("authorization_evaluation_untrusted");
  const { config_refs: _configRefs, ...subjectFields } = prepared.decision.applicability;
  const subject = subjectFields as AuthorizationDecisionSubject;
  const expected = buildAuthorizationDecisionBase({
    decision_ref: prepared.decision.decision_ref,
    facts,
    subject,
    fallback_decided_at: prepared.decision.decided_at,
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt })
  });
  const expectedHash = createHash("sha256").update(JSON.stringify({
    subject,
    evaluation: facts.evaluation,
    requested_action: facts.requested_action ?? null,
    owner_proof: facts.owner_proof ?? null,
    ...(facts.single_action_decision === undefined ? {} : {
      single_action_decision: facts.single_action_decision
    }),
    expires_at: expiresAt ?? null
  })).digest("hex");
  const normalizedKey = normalizeNonSensitiveText(idempotencyKey, 128);
  if (!normalizedKey) throw new Error("authorization_idempotency_key_invalid");
  const expectedStream = createHash("sha256").update(JSON.stringify([
    subject,
    facts.requested_action?.action_instance_ref ?? "system_stop"
  ])).digest("hex").slice(0, 32);
  const expectedRef = `authorization-decision:${expectedStream}:${createHash("sha256").update(normalizedKey).digest("hex").slice(0, 32)}`;
  if (stream !== expectedStream || prepared.decision.decision_ref !== expectedRef || prepared.request_hash !== expectedHash ||
    JSON.stringify(prepared.decision) !== JSON.stringify(expected)) {
    throw new Error("authorization_decision_journal_invalid");
  }
  return !("evaluated_at" in facts.evaluation);
}

// Internal Core coordination surface. It is absent from the public store contract and package exports.
export function commitRunRecordAuthorizationDecisionRef(
  store: FileRunRecordStore,
  runId: string,
  decisionDirectory: string,
  stream: string,
  prepared: PreparedAuthorizationDecision,
  observedAt: string,
  evaluation: unknown,
  idempotencyKey: string,
  expiresAt?: string
): Promise<AuthorizationDecisionBase> {
  const commit = authorizationDecisionRefTransactions.get(store);
  if (!commit) throw new Error("authorization_run_store_unavailable");
  return commit(runId, decisionDirectory, stream, prepared, observedAt, evaluation, idempotencyKey, expiresAt);
}

export function createAuthorizationDecisionRefFailureProbeStore(
  store: FileRunRecordStore,
  phase: "prepare" | "commit"
): FileRunRecordStore {
  const sourceCommit = authorizationDecisionRefTransactions.get(store);
  const sourceFaultCommit = authorizationDecisionRefFaultTransactions.get(store);
  if (!sourceCommit || !sourceFaultCommit) throw new Error("authorization_run_store_unavailable");
  const probe = { ...store };
  let fail = true;
  authorizationDecisionRefTransactions.set(probe, (...transaction) => {
    if (!fail) return sourceCommit(...transaction);
    fail = false;
    return sourceFaultCommit(phase, transaction);
  });
  authorizationDecisionRefFaultTransactions.set(probe, sourceFaultCommit);
  return probe;
}

export const terminalRunRecordStatuses = new Set<RunRecordStatus>([
  "succeeded",
  "failed",
  "blocked",
  "requires_user_action",
  "manual_recovery_required",
  "unknown_outcome",
  "cancelled",
  "expired"
]);

export const runLifecycleTransitions: Readonly<Record<RunRecordStatus, readonly RunRecordStatus[]>> = {
  pending: ["admitted", "failed", "cancelled", "expired"],
  admitted: ["running", "failed", "cancelled", "expired"],
  running: ["succeeded", "failed", "blocked", "requires_user_action", "manual_recovery_required", "unknown_outcome", "cancelled", "expired"],
  succeeded: [],
  failed: [],
  blocked: [],
  requires_user_action: [],
  manual_recovery_required: [],
  unknown_outcome: [],
  cancelled: [],
  expired: []
};

const forbiddenRunRecordFieldNames = new Set([
  "raw_payload",
  "dom",
  "har",
  "screenshot",
  "screenshot_body",
  "video",
  "cookie",
  "cookies",
  "token",
  "tokens",
  "password",
  "verification_code",
  "local_path",
  "profile_path",
  "storage_url",
  "cdp_endpoint",
  "vnc_url",
  "viewer_url",
  "webSocketDebuggerUrl",
  "raw_evidence_body",
  "full_dom",
  "network_response_body",
  "provider_private_object",
  "production_payload",
  "user_business_data"
]);

function requireRef(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return value;
}

function copyRequiredRefs(values: readonly string[], label: string): string[] {
  for (const [index, value] of values.entries()) {
    requireRef(value, `${label}[${index}]`);
  }
  return [...values];
}

function copyRefs(values: readonly string[] | undefined, label: string): string[] | undefined {
  return values ? copyRequiredRefs(values, label) : undefined;
}

function copyAuthorizationDecisionRefs(values: readonly string[]): string[] {
  if (values.length > 64 || new Set(values).size !== values.length) throw new Error("authorization_decision_refs_invalid");
  return values.map(parseAuthorizationDecisionRef);
}

function validatePreviewResult(preview: PreviewResult): void {
  if (preview.schema_version !== "webenvoy.preview-result.v0") {
    throw new Error("preview_result.schema_version is unsupported");
  }
  requireRef(preview.state, "preview_result.state");
  if (preview.submitted !== false) {
    throw new Error("preview_result.submitted must be false");
  }
  requireRef(preview.action_refs.action_request_id, "preview_result.action_refs.action_request_id");
  requireRef(preview.capability.capability_ref, "preview_result.capability.capability_ref");
  if (preview.capability.capability_version !== undefined) requireRef(preview.capability.capability_version, "preview_result.capability.capability_version");
  if (preview.capability.capability_source_ref !== undefined) requireRef(preview.capability.capability_source_ref, "preview_result.capability.capability_source_ref");
  if (preview.capability.capability_lock_ref !== undefined) requireRef(preview.capability.capability_lock_ref, "preview_result.capability.capability_lock_ref");
  if (preview.capability.package_ref !== undefined) requireRef(preview.capability.package_ref, "preview_result.capability.package_ref");
  copyRequiredRefs(preview.evidence_refs, "preview_result.evidence_refs");
  if (preview.state === "available" && preview.failure_class !== undefined) {
    throw new Error("preview_result.failure_class must be absent when preview is available");
  }
  if (preview.state !== "available" && preview.failure_class !== preview.state) {
    throw new Error("preview_result.failure_class must match unavailable preview state");
  }
  requireRef(preview.consumer_boundary, "preview_result.consumer_boundary");
}

function validateRunId(runId: string): string {
  return requireRunId(runId);
}

function copyPublicResultSummary(value: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > 64 * 1024) throw new Error("public_result_summary exceeds 64 KiB");
  return JSON.parse(json) as Record<string, unknown>;
}

function runRecordPath(directory: string, runId: string): string {
  return join(directory, `${validateRunId(runId)}.json`);
}

function runClaimPath(directory: string, runId: string): string {
  return join(`${directory}.run-id-claims`, `${validateRunId(runId)}.claim`);
}

function runLockPath(directory: string, runId: string): string {
  return join(`${directory}.locks`, `${validateRunId(runId)}.lock`);
}

function assertTransition(current: RunRecordStatus, next: RunRecordStatus): void {
  if (current === next) {
    return;
  }
  if (terminalRunRecordStatuses.has(current)) {
    throw new Error(`run ${current} is terminal and cannot transition to ${next}`);
  }
  if (!runLifecycleTransitions[current].includes(next)) {
    throw new Error(`illegal run status transition from ${current} to ${next}`);
  }
}

function assertRunRecord(record: RunRecord): void {
  const forbiddenField = findForbiddenRunRecordField(record);
  if (forbiddenField) {
    throw new Error(`run record must not contain private browser material: ${forbiddenField}`);
  }
  validateRunId(record.run_id);
  requireRef(record.task_intent_ref, "task_intent_ref");
  requireRef(record.capability_ref, "capability_ref");
  requireRef(record.created_at, "created_at");
  requireRef(record.updated_at, "updated_at");
  requireRef(record.admission.decision, "admission.decision");
  requireRef(record.admission.action_risk, "admission.action_risk");
  if (record.entrypoint_ref !== undefined) {
    requireRef(record.entrypoint_ref, "entrypoint_ref");
  }
  if (record.capability_version !== undefined) {
    requireRef(record.capability_version, "capability_version");
  }
  if (record.capability_source_ref !== undefined) {
    requireRef(record.capability_source_ref, "capability_source_ref");
  }
  if (record.capability_lock_ref !== undefined) {
    requireRef(record.capability_lock_ref, "capability_lock_ref");
  }
  if (record.package_ref !== undefined) {
    requireRef(record.package_ref, "package_ref");
  }
  if (record.scope_target_ref !== undefined && normalizeStoredTargetRef(record.scope_target_ref) !== record.scope_target_ref) {
    throw new Error("scope_target_ref must be a normalized non-sensitive target reference");
  }
  if (record.result_ref !== undefined) {
    requireRef(record.result_ref, "result_ref");
  }
  if (record.result_kind !== undefined) {
    requireRef(record.result_kind, "result_kind");
  }
  if (record.result_outcome !== undefined && !["success", "partial", "empty"].includes(record.result_outcome)) {
    throw new Error("result_outcome is unsupported");
  }
  if (record.result_outcome !== undefined && record.status !== "succeeded") {
    throw new Error("result_outcome is only allowed on succeeded run records");
  }
  if (record.output_schema_id !== undefined) {
    requireRef(record.output_schema_id, "output_schema_id");
  }
  if (record.projection_ref !== undefined) {
    requireRef(record.projection_ref, "projection_ref");
  }
  if (record.public_result_summary !== undefined) copyPublicResultSummary(record.public_result_summary);
  copyRefs(record.source_refs, "source_refs");
  if (record.preview_result !== undefined) {
    validatePreviewResult(record.preview_result);
  }
  if (record.admission.resource_match_ref !== undefined) {
    requireRef(record.admission.resource_match_ref, "admission.resource_match_ref");
  }
  copyRefs(record.admission.resource_requirement_refs, "admission.resource_requirement_refs");
  copyRefs(record.admission.runtime_binding_refs, "admission.runtime_binding_refs");
  copyRefs(record.admission.evidence_refs, "admission.evidence_refs");
  if (record.admission.runtime_session_binding !== undefined) {
    requireRef(record.admission.runtime_session_binding.schema_version, "admission.runtime_session_binding.schema_version");
    if (record.admission.runtime_session_binding.schema_version !== "webenvoy.runtime-session-binding.v0") {
      throw new Error("admission.runtime_session_binding.schema_version is unsupported");
    }
    requireRef(record.admission.runtime_session_binding.identity_environment_ref, "admission.runtime_session_binding.identity_environment_ref");
    requireRef(record.admission.runtime_session_binding.execution_identity_ref, "admission.runtime_session_binding.execution_identity_ref");
    requireRef(record.admission.runtime_session_binding.runtime_session_ref, "admission.runtime_session_binding.runtime_session_ref");
    requireRef(record.admission.runtime_session_binding.profile_ref, "admission.runtime_session_binding.profile_ref");
    requireRef(record.admission.runtime_session_binding.provider_ref, "admission.runtime_session_binding.provider_ref");
    requireRef(record.admission.runtime_session_binding.provider_mode, "admission.runtime_session_binding.provider_mode");
    requireRef(record.admission.runtime_session_binding.lifecycle_state, "admission.runtime_session_binding.lifecycle_state");
    requireRef(record.admission.runtime_session_binding.control_owner, "admission.runtime_session_binding.control_owner");
    requireRef(record.admission.runtime_session_binding.session_use, "admission.runtime_session_binding.session_use");
    requireRef(record.admission.runtime_session_binding.consumer_boundary, "admission.runtime_session_binding.consumer_boundary");
  }
  copyRefs(record.runtime_binding_refs, "runtime_binding_refs");
  if (record.action_request !== undefined) {
    requireRef(record.action_request.schema_version, "action_request.schema_version");
    if (record.action_request.schema_version !== "webenvoy.action-request.v0") {
      throw new Error("action_request.schema_version is unsupported");
    }
    requireRef(record.action_request.action_request_id, "action_request.action_request_id");
    requireRef(record.action_request.task_intent_ref, "action_request.task_intent_ref");
    requireRef(record.action_request.capability_ref, "action_request.capability_ref");
    requireRef(record.action_request.operation_mode, "action_request.operation_mode");
    requireRef(record.action_request.risk_classification.risk, "action_request.risk_classification.risk");
    requireRef(record.action_request.risk_classification.execution_intent, "action_request.risk_classification.execution_intent");
    requireRef(record.action_request.risk_classification.level, "action_request.risk_classification.level");
    copyRefs(record.action_request.risk_classification.reasons, "action_request.risk_classification.reasons");
    requireRef(record.action_request.no_submit_guard.status, "action_request.no_submit_guard.status");
    requireRef(record.action_request.no_submit_guard.enforced_by, "action_request.no_submit_guard.enforced_by");
    copyRefs(record.action_request.no_submit_guard.blocked_execution_intents, "action_request.no_submit_guard.blocked_execution_intents");
    copyRefs(record.action_request.no_submit_guard.source_refs, "action_request.no_submit_guard.source_refs");
    copyRefs(record.action_request.runtime_binding_refs, "action_request.runtime_binding_refs");
    copyRefs(record.action_request.evidence_refs, "action_request.evidence_refs");
    requireRef(record.action_request.consumer_boundary, "action_request.consumer_boundary");
  }
  if (record.approval_request !== undefined) {
    requireRef(record.approval_request.schema_version, "approval_request.schema_version");
    if (record.approval_request.schema_version !== "webenvoy.approval-request.v0") {
      throw new Error("approval_request.schema_version is unsupported");
    }
    requireRef(record.approval_request.approval_request_id, "approval_request.approval_request_id");
    requireRef(record.approval_request.action_request_id, "approval_request.action_request_id");
    requireRef(record.approval_request.task_intent_ref, "approval_request.task_intent_ref");
    requireRef(record.approval_request.status, "approval_request.status");
    requireRef(record.approval_request.requested_at, "approval_request.requested_at");
    requireRef(record.approval_request.risk, "approval_request.risk");
    copyRefs(record.approval_request.blocking_reasons, "approval_request.blocking_reasons");
    copyRefs(record.approval_request.source_refs, "approval_request.source_refs");
    copyRefs(record.approval_request.evidence_refs, "approval_request.evidence_refs");
    requireRef(record.approval_request.consumer_boundary, "approval_request.consumer_boundary");
  }
  copyRefs(record.evidence_refs, "evidence_refs");
  if (record.authorization_decision_refs !== undefined) copyAuthorizationDecisionRefs(record.authorization_decision_refs);
  if (record.post_check !== undefined) {
    requireRef(record.post_check.schema_version, "post_check.schema_version");
    if (record.post_check.schema_version !== "webenvoy.post-check-result.v0") {
      throw new Error("post_check.schema_version is unsupported");
    }
    requireRef(record.post_check.status, "post_check.status");
    requireRef(record.post_check.summary, "post_check.summary");
    requireRef(record.post_check.consumer_boundary, "post_check.consumer_boundary");
    if (record.post_check.checked_at !== undefined) {
      requireRef(record.post_check.checked_at, "post_check.checked_at");
    }
    if (record.post_check.code !== undefined) {
      requireRef(record.post_check.code, "post_check.code");
    }
    if (record.post_check.recovery_hint !== undefined) {
      requireRef(record.post_check.recovery_hint, "post_check.recovery_hint");
    }
    copyRefs(record.post_check.evidence_refs, "post_check.evidence_refs");
    copyRefs(record.post_check.source_refs, "post_check.source_refs");
  }
  if (record.terminal_at && !terminalRunRecordStatuses.has(record.status)) {
    throw new Error("terminal_at is only allowed on terminal run records");
  }
  if (record.status === "failed" && !record.failure) {
    throw new Error("failed run records must include failure");
  }
}

function findForbiddenRunRecordField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenRunRecordField(entry);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenRunRecordFieldNames.has(key)) return key;
    const found = findForbiddenRunRecordField(entry);
    if (found) return found;
  }
  return undefined;
}

function withOptionalFields(record: RunRecord, patch: RunRecordPatch): RunRecord {
  const next: RunRecord = { ...record };
  if (patch.runtime_binding_refs !== undefined) {
    next.runtime_binding_refs = copyRequiredRefs(patch.runtime_binding_refs, "runtime_binding_refs");
  }
  if (patch.action_request !== undefined) {
    next.action_request = patch.action_request;
  }
  if (patch.approval_request !== undefined) {
    next.approval_request = patch.approval_request;
  }
  if (patch.result_ref !== undefined) {
    next.result_ref = requireRef(patch.result_ref, "result_ref");
  }
  if (patch.result_kind !== undefined) {
    next.result_kind = requireRef(patch.result_kind, "result_kind");
  }
  if (patch.result_outcome !== undefined) {
    next.result_outcome = patch.result_outcome;
  }
  if (patch.output_schema_id !== undefined) {
    next.output_schema_id = requireRef(patch.output_schema_id, "output_schema_id");
  }
  if (patch.projection_ref !== undefined) {
    next.projection_ref = requireRef(patch.projection_ref, "projection_ref");
  }
  if (patch.public_result_summary !== undefined) {
    next.public_result_summary = copyPublicResultSummary(patch.public_result_summary);
  }
  if (patch.source_refs !== undefined) {
    next.source_refs = copyRequiredRefs(patch.source_refs, "source_refs");
  }
  if (patch.preview_result !== undefined) {
    next.preview_result = patch.preview_result;
  }
  if (patch.evidence_refs !== undefined) {
    next.evidence_refs = copyRequiredRefs(patch.evidence_refs, "evidence_refs");
  }
  if (patch.failure !== undefined) {
    next.failure = normalizeFailureRecord(patch.failure);
  }
  if (patch.post_check !== undefined) {
    next.post_check = patch.post_check;
  }
  if (patch.retention_state !== undefined) {
    next.retention_state = patch.retention_state;
  }
  return next;
}

function makeRecord(input: CreateRunRecordInput, now: string): RunRecord {
  const status = input.status ?? "pending";
  const record: RunRecord = {
    schema_version: runRecordSchemaVersion,
    run_id: validateRunId(input.run_id),
    status,
    created_at: now,
    updated_at: now,
    task_intent_ref: requireRef(input.task_intent_ref, "task_intent_ref"),
    capability_ref: requireRef(input.capability_ref, "capability_ref"),
    admission: {
      ...input.admission,
      ...(input.admission.resource_requirement_refs === undefined ? {} : { resource_requirement_refs: copyRequiredRefs(input.admission.resource_requirement_refs, "admission.resource_requirement_refs") }),
      ...(input.admission.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: copyRequiredRefs(input.admission.runtime_binding_refs, "admission.runtime_binding_refs") }),
      ...(input.admission.evidence_refs === undefined ? {} : { evidence_refs: copyRequiredRefs(input.admission.evidence_refs, "admission.evidence_refs") })
    }
  };
  if (input.entrypoint_ref !== undefined) {
    record.entrypoint_ref = requireRef(input.entrypoint_ref, "entrypoint_ref");
  }
  if (input.capability_version !== undefined) {
    record.capability_version = requireRef(input.capability_version, "capability_version");
  }
  if (input.capability_source_ref !== undefined) {
    record.capability_source_ref = requireRef(input.capability_source_ref, "capability_source_ref");
  }
  if (input.capability_lock_ref !== undefined) {
    record.capability_lock_ref = requireRef(input.capability_lock_ref, "capability_lock_ref");
  }
  if (input.package_ref !== undefined) {
    record.package_ref = requireRef(input.package_ref, "package_ref");
  }
  if (input.scope_target_ref !== undefined) {
    const normalizedTargetRef = normalizeStoredTargetRef(input.scope_target_ref);
    if (normalizedTargetRef !== input.scope_target_ref) throw new Error("scope_target_ref must be a normalized non-sensitive target reference");
    record.scope_target_ref = normalizedTargetRef;
  }
  if (input.runtime_binding_refs !== undefined) {
    record.runtime_binding_refs = copyRequiredRefs(input.runtime_binding_refs, "runtime_binding_refs");
  }
  if (input.action_request !== undefined) {
    record.action_request = input.action_request;
  }
  if (input.approval_request !== undefined) {
    record.approval_request = input.approval_request;
  }
  if (input.result_ref !== undefined) {
    record.result_ref = requireRef(input.result_ref, "result_ref");
  }
  if (input.result_kind !== undefined) {
    record.result_kind = requireRef(input.result_kind, "result_kind");
  }
  if (input.result_outcome !== undefined) {
    record.result_outcome = input.result_outcome;
  }
  if (input.output_schema_id !== undefined) {
    record.output_schema_id = requireRef(input.output_schema_id, "output_schema_id");
  }
  if (input.projection_ref !== undefined) {
    record.projection_ref = requireRef(input.projection_ref, "projection_ref");
  }
  if (input.public_result_summary !== undefined) {
    record.public_result_summary = copyPublicResultSummary(input.public_result_summary);
  }
  if (input.source_refs !== undefined) {
    record.source_refs = copyRequiredRefs(input.source_refs, "source_refs");
  }
  if (input.preview_result !== undefined) {
    record.preview_result = input.preview_result;
  }
  if (input.evidence_refs !== undefined) {
    record.evidence_refs = copyRequiredRefs(input.evidence_refs, "evidence_refs");
  }
  if (input.failure !== undefined) {
    record.failure = normalizeFailureRecord(input.failure);
  }
  if (input.post_check !== undefined) {
    record.post_check = input.post_check;
  }
  if (input.retention_state !== undefined) {
    record.retention_state = input.retention_state;
  }
  if (terminalRunRecordStatuses.has(status)) {
    record.terminal_at = now;
  }
  assertRunRecord(record);
  return record;
}

async function readRecord(path: string): Promise<RunRecord | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RunRecord;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeRecord(directory: string, record: RunRecord): Promise<void> {
  assertRunRecord(record);
  await mkdir(directory, { recursive: true });
  const target = runRecordPath(directory, record.run_id);
  const temp = join(directory, `.${record.run_id}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function createRecord(directory: string, record: RunRecord): Promise<void> {
  assertRunRecord(record);
  await mkdir(directory, { recursive: true });
  const target = runRecordPath(directory, record.run_id);
  const temp = join(directory, `.${record.run_id}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  try {
    await link(temp, target);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export function createFileRunRecordStore(options: FileRunRecordStoreOptions): FileRunRecordStore {
  const clock = options.clock ?? (() => new Date());
  const directory = options.directory;
  const lockTimeoutMs = options.lockTimeoutMs ?? 30_000;

  async function getRunRecord(runId: string): Promise<RunRecord | undefined> {
    const record = await readRecord(runRecordPath(directory, runId));
    if (record) {
      assertRunRecord(record);
    }
    return record;
  }

  async function claimRunId(runId: string, ownerRef = `direct-run:${runId}`): Promise<string | undefined> {
    const target = runRecordPath(directory, runId);
    if (await readRecord(target)) return undefined;
    const claimPath = runClaimPath(directory, runId);
    const owner = await tryAcquireFileOwnership(claimPath, ownerRef);
    if (!owner) return undefined;
    if (await readRecord(target)) {
      await releaseFileOwnership(claimPath, owner.token).catch(() => false);
      return undefined;
    }
    return owner.token;
  }

  async function getRunIdClaim(runId: string): Promise<{ owner_ref: string; owner_alive: boolean } | undefined> {
    const owner = await readFileOwnership(runClaimPath(directory, runId));
    return owner ? { owner_ref: owner.owner_ref, owner_alive: await isFileOwnershipOwnerAlive(owner) } : undefined;
  }

  async function recoverRunIdClaim(runId: string, expectedOwnerRef: string): Promise<boolean> {
    if (await getRunRecord(runId)) return false;
    return recoverDeadFileOwnership(runClaimPath(directory, runId), expectedOwnerRef);
  }

  async function releaseRunIdClaim(runId: string, claimToken: string): Promise<void> {
    await releaseFileOwnership(runClaimPath(directory, runId), claimToken).catch(() => false);
  }

  const store: FileRunRecordStore = {
    directory,
    claimRunId,
    getRunIdClaim,
    recoverRunIdClaim,
    releaseRunIdClaim,

    async createRunRecord(input, claimedToken) {
      const record = makeRecord(input, clock().toISOString());
      let claimToken = claimedToken ?? await claimRunId(record.run_id);
      if (claimToken === undefined && claimedToken === undefined) {
        const directOwnerRef = `direct-run:${record.run_id}`;
        if (await recoverRunIdClaim(record.run_id, directOwnerRef)) claimToken = await claimRunId(record.run_id, directOwnerRef);
      }
      const claimOwner = claimToken === undefined ? undefined : await readFileOwnership(runClaimPath(directory, record.run_id));
      if (claimToken === undefined || claimOwner?.token !== claimToken) {
        throw new Error(`run record already exists: ${input.run_id}`);
      }
      try {
        await createRecord(directory, record);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          throw new Error(`run record already exists: ${input.run_id}`);
        }
        throw error;
      }
      return record;
    },

    getRunRecord,

    async updateRunRecord(runId, patch) {
      return withFileOwnershipLock(runLockPath(directory, runId), lockTimeoutMs, async () => {
        const record = await getRunRecord(runId);
        if (!record) throw new Error(`run record not found: ${runId}`);
        const nextStatus = patch.status ?? record.status;
        assertTransition(record.status, nextStatus);
        const now = clock().toISOString();
        const next = withOptionalFields({ ...record, status: nextStatus, updated_at: now }, patch);
        if (terminalRunRecordStatuses.has(nextStatus) && !next.terminal_at) next.terminal_at = now;
        assertRunRecord(next);
        await writeRecord(directory, next);
        return next;
      });
    },

    async listRunRecords() {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort();
      const records: RunRecord[] = [];
      for (const file of files) {
        const runId = basename(file, ".json");
        let record: RunRecord | undefined;
        try {
          record = await getRunRecord(runId);
        } catch {
          continue;
        }
        if (record) {
          records.push(record);
        }
      }
      return records;
    }
  };

  let pendingFault: "prepare" | "commit" | undefined;
  const commitAuthorizationDecision: AuthorizationDecisionRefTransaction = async (
    runId,
    decisionDirectory,
    stream,
    prepared,
    observedAt,
    evaluation,
    idempotencyKey,
    expiresAt
  ) => withFileOwnershipLock(runLockPath(directory, runId), lockTimeoutMs, async () => {
    const usesFallbackTimestamp = assertTrustedPreparedAuthorizationDecision(
      prepared,
      evaluation,
      stream,
      idempotencyKey,
      expiresAt
    );
    const transactionObservedAt = authorizationTimestamp(observedAt, "observed_at");
    if (Date.parse(prepared.decision.decided_at) > Date.parse(transactionObservedAt)) {
      throw new Error("authorization_decision_time_invalid");
    }
    const record = await getRunRecord(runId);
    if (!record) throw new Error(`run record not found: ${runId}`);
    const ref = parseAuthorizationDecisionRef(prepared.decision.decision_ref);
    if (ref.split(":")[1] !== stream || prepared.decision.applicability.scope !== "task" ||
      prepared.decision.applicability.run_id !== runId) {
      throw new Error("authorization_task_binding_mismatch");
    }
    const linked = record.authorization_decision_refs?.includes(ref) ?? false;
    if (!linked && (record.authorization_decision_refs?.length ?? 0) >= 64) {
      throw new Error("authorization_decision_refs_full");
    }
    try {
      return await withFileOwnershipLock(
        authorizationDecisionJournalLockPath(decisionDirectory, stream),
        lockTimeoutMs,
        async () => {
          const journal = await readAuthorizationDecisionJournal(decisionDirectory, stream);
          const existing = journal.decisions.find((entry) =>
            entry.decision.decision_ref === prepared.decision.decision_ref && entry.request_hash === prepared.request_hash
          );
          const transactionPrepared = usesFallbackTimestamp && existing
            ? { ...prepared, decision: { ...prepared.decision, decided_at: existing.decision.decided_at } }
            : prepared;
          if (Date.parse(transactionPrepared.decision.decided_at) > Date.parse(transactionObservedAt)) {
            throw new Error("authorization_decision_time_invalid");
          }
          const staged = prepareAuthorizationDecisionJournalEntry(
            journal,
            transactionPrepared,
            "prepared",
            visibleAuthorizationDecisionEntries(journal, record.authorization_decision_refs),
            transactionObservedAt
          );
          if (staged !== journal) await writeAuthorizationDecisionJournal(decisionDirectory, staged);
          if (pendingFault === "prepare") {
            pendingFault = undefined;
            throw new Error("injected_prepare_failure");
          }
          if (!linked) {
            await writeRecord(directory, {
              ...record,
              updated_at: clock().toISOString(),
              authorization_decision_refs: copyAuthorizationDecisionRefs([...(record.authorization_decision_refs ?? []), ref])
            });
          }
          if (pendingFault === "commit") {
            pendingFault = undefined;
            throw new Error("injected_commit_failure");
          }
          const committed = commitTaskAuthorizationDecisionJournalEntry(staged, ref, transactionObservedAt);
          if (committed !== staged) await writeAuthorizationDecisionJournal(decisionDirectory, committed);
          return transactionPrepared.decision;
        }
      );
    } catch (error) {
      if (error instanceof FileOwnershipError && error.message === "file_lock_timeout") {
        throw new Error("authorization_decision_lock_timeout");
      }
      throw error;
    }
  });
  authorizationDecisionRefTransactions.set(store, commitAuthorizationDecision);
  authorizationDecisionRefFaultTransactions.set(store, async (phase, transaction) => {
    pendingFault = phase;
    return commitAuthorizationDecision(...transaction);
  });
  return store;
}
