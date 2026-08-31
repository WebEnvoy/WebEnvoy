import { createHash } from "node:crypto";

import type { AuthorizationDecisionSummary } from "./authorization-decision.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { matchLodeBusinessActionOwner } from "./execution-policy-owner-proof.js";
import {
  evaluateExecutionPolicy,
  type SingleActionDecision,
  type ExecutionPolicyEvaluation
} from "./execution-policy.js";
import { readBusinessActionOwnerProof } from "./execution-policy-owner-proof.js";
import type { LodePackageAdmissionContract } from "./lode-admission.js";
import { normalizePublicHttpTarget } from "./public-target-reference.js";
import type { FailureRecord, FileRunRecordStore, PolicyBindingSnapshot, RunRecord } from "./run-record-store.js";
import type { TaskIntentEnvelope } from "./task-submission.js";

export type WritePrecheckAuthorizationContext = {
  thread_id: string;
  turn_id: string;
  turn_sequence: number;
  idempotency_key: string;
};

export type EvaluatedWritePrecheckPolicy = {
  evaluation: ExecutionPolicyEvaluation;
  expires_at: string;
  context: WritePrecheckAuthorizationContext;
};

const writePrecheckPackageRef = "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0";
const writePrecheckLockRef = "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1";
const writePrecheckActionId = "xhs_publish_note_precheck";
const pathPreparePackageRef = "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0";
const pathPrepareLockRef = "lode://lock/site-capability/xiaohongshu/publish-note-path-prepare@0.1.0";
const pathPrepareActionId = "xhs_publish_note_path_prepare";
const confirmationTtlMs = 10 * 60 * 1_000;

type WritePrecheckVariant = {
  package_ref: string;
  lock_ref: string;
  capability_id: string;
  action_id: string;
};

function writePrecheckVariant(taskIntent: TaskIntentEnvelope, contract: LodePackageAdmissionContract): WritePrecheckVariant | undefined {
  const candidate = contract.package_ref === pathPreparePackageRef
    ? { package_ref: pathPreparePackageRef, lock_ref: pathPrepareLockRef, capability_id: "publish-note-path-prepare", action_id: pathPrepareActionId }
    : { package_ref: writePrecheckPackageRef, lock_ref: writePrecheckLockRef, capability_id: "publish-note-precheck", action_id: writePrecheckActionId };
  return contract.package_ref === candidate.package_ref &&
    contract.source_ref === candidate.package_ref &&
    contract.lock_ref === candidate.lock_ref &&
    contract.capability_id === candidate.capability_id &&
    contract.version === "0.1.0" &&
    taskIntent.capability.ref === `lode:capability/${candidate.capability_id}` &&
    taskIntent.capability.version === "0.1.0" &&
    taskIntent.capability.source_ref === candidate.package_ref &&
    taskIntent.capability.lock_ref === candidate.lock_ref &&
    contract.operation_id === candidate.action_id &&
    taskIntent.policy.risk === "write" &&
    taskIntent.policy.execution_intent === "validate_only" &&
    contract.operation_mode === "validate_only"
    ? candidate
    : undefined;
}

function failure(code: string, recovery_hint: string): FailureRecord {
  return { category: "action_risk", code, phase: "admission", recovery_hint };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function policyBindingSnapshot(
  policy: EvaluatedWritePrecheckPolicy,
  decision: AuthorizationDecisionSummary
): PolicyBindingSnapshot | undefined {
  if (policy.evaluation.status !== "evaluated") return undefined;
  const action = policy.evaluation.action;
  if (!action || !policy.evaluation.effective_policy) return undefined;
  return {
    schema_version: "webenvoy.policy-binding-snapshot.v0",
    decision_ref: decision.decision_ref,
    effective_policy_source: policy.evaluation.effective_policy.source,
    effective_policy_source_ref: policy.evaluation.effective_policy.source_ref,
    effective_policy_source_version: policy.evaluation.effective_policy.source_version,
    action_fingerprint: `sha256:${hash({
      action_instance_ref: action.action_instance_ref,
      action_id: action.action_id,
      category: action.category,
      target: action.target,
      owner_declaration_ref: action.owner_declaration_ref,
      owner_declaration_version: action.owner_declaration_version,
      resource_match_ref: action.resource_match_ref,
      resource_match_version: action.resource_match_version
    })}`,
    resource_match_ref: action.resource_match_ref,
    resource_match_version: action.resource_match_version,
    expires_at: decision.expires_at ?? policy.expires_at
  };
}

export function isUnifiedWritePrecheckTask(
  taskIntent: TaskIntentEnvelope,
  contract: LodePackageAdmissionContract
): boolean {
  return contract.package_ref === writePrecheckPackageRef &&
    contract.source_ref === writePrecheckPackageRef &&
    contract.lock_ref === writePrecheckLockRef &&
    contract.capability_id === "publish-note-precheck" &&
    contract.version === "0.1.0" &&
    taskIntent.capability.ref === "lode:capability/publish-note-precheck" &&
    taskIntent.capability.version === "0.1.0" &&
    taskIntent.capability.source_ref === writePrecheckPackageRef &&
    taskIntent.capability.lock_ref === writePrecheckLockRef &&
    contract.operation_id === writePrecheckActionId &&
    taskIntent.policy.risk === "write" &&
    taskIntent.policy.execution_intent === "validate_only" &&
    contract.operation_mode === "validate_only";
}

/** Exact #405 path-prepare package/action binding. */
export function isXhsPathPrepareTask(
  taskIntent: TaskIntentEnvelope,
  contract: LodePackageAdmissionContract
): boolean {
  return writePrecheckVariant(taskIntent, contract)?.action_id === pathPrepareActionId &&
    (taskIntent.input.requested_path === "image_text_upload" || taskIntent.input.requested_path === "image_text_generate");
}

/** Accept continuation only for the exact persisted validate-only precheck. */
export function isExactWritePrecheckRun(run: RunRecord | undefined, confirmationDecisionRef?: string): boolean {
  const action = run?.action_request;
  const risk = action?.risk_classification;
  const guard = action?.no_submit_guard;
  const snapshot = run?.policy_binding_snapshot;
  const pathPrepare = run?.package_ref === pathPreparePackageRef;
  const expectedPackageRef = pathPrepare ? pathPreparePackageRef : writePrecheckPackageRef;
  const expectedLockRef = pathPrepare ? pathPrepareLockRef : writePrecheckLockRef;
  const expectedCapabilityRef = pathPrepare ? "lode:capability/publish-note-path-prepare" : "lode:capability/publish-note-precheck";
  return run?.status === "requires_user_action" &&
    run.package_ref === expectedPackageRef &&
    run.capability_ref === expectedCapabilityRef &&
    run.capability_version === "0.1.0" &&
    run.capability_source_ref === expectedPackageRef &&
    run.capability_lock_ref === expectedLockRef &&
    run.admission.action_risk === "write" &&
    action?.task_intent_ref === run.task_intent_ref &&
    action.capability_ref === run.capability_ref &&
    action.capability_version === run.capability_version &&
    action.capability_source_ref === run.capability_source_ref &&
    action.capability_lock_ref === run.capability_lock_ref &&
    action.package_ref === run.package_ref &&
    action.operation_mode === "validate_only" &&
    action.target_refs?.scope_target_ref === run.scope_target_ref &&
    risk?.risk === "write" &&
    risk.execution_intent === "validate_only" &&
    risk.true_write_requested === false &&
    guard?.status === "active" &&
    guard.enforced_by === "core" &&
    ["execute_after_approval", "reconcile_status", "request_cancel"].every((intent) =>
      guard.blocked_execution_intents.includes(intent)
    ) &&
    guard.source_refs.includes(expectedPackageRef) &&
    guard.source_refs.includes(expectedLockRef) &&
    snapshot?.schema_version === "webenvoy.policy-binding-snapshot.v0" &&
    (confirmationDecisionRef === undefined || snapshot.decision_ref === confirmationDecisionRef) &&
    run.authorization_decision_refs?.includes(snapshot.decision_ref) === true;
}

export async function evaluateWritePrecheckTaskPolicy(input: {
  run_id: string;
  task_intent: TaskIntentEnvelope;
  lode_contract: LodePackageAdmissionContract;
  authorization_context?: WritePrecheckAuthorizationContext;
  config_store?: FileExecutionPolicyConfigStore;
  /** A Core-sourced single-action decision, when continuing a confirmed run. */
  single_action_decision?: SingleActionDecision;
  evaluated_at: string;
}): Promise<EvaluatedWritePrecheckPolicy | FailureRecord> {
  const context = input.authorization_context;
  if (!context || !input.config_store) {
    return failure("execution_policy_owner_unavailable", "retry_when_policy_owner_ready");
  }
  const variant = writePrecheckVariant(input.task_intent, input.lode_contract);
  if (!variant || input.lode_contract.operation_mode !== input.task_intent.policy.execution_intent ||
    input.lode_contract.operation_mode !== "validate_only" ||
    input.task_intent.policy.risk !== "write") {
    return failure("execution_policy_owner_declaration_invalid", "repair_package_contract");
  }
  const target = normalizePublicHttpTarget(input.task_intent.scope.target_ref);
  if (!target.ok) return failure("execution_policy_target_invalid", "fix_input");
  const action = input.lode_contract.action_declaration?.actions.find((candidate) => candidate.action_id === variant.action_id);
  const resourceProfile = input.lode_contract.resource_requirements.resource_requirement_profiles.find((candidate) =>
    candidate.requirement_profile_id === input.task_intent.resource_requirement_profile_id
  );
  if (!action || action.category !== "prepare" ||
    action.target_scope.site_slug !== "xiaohongshu" ||
    !action.target_scope.target_types.includes("creator_publish_page") ||
    !action.target_scope.supported_origins.includes("https://creator.xiaohongshu.com") ||
    action.resource_requirements.id !== input.lode_contract.resource_requirements.resource_requirements_id ||
    input.task_intent.resource_requirement_profile_id === undefined ||
    !action.resource_requirements.profile_ids.includes(input.task_intent.resource_requirement_profile_id) ||
    !resourceProfile) {
    return failure("execution_policy_owner_declaration_invalid", "repair_package_contract");
  }
  const matchedRequirementRefs = [...input.task_intent.resource_requirement_refs].sort();
  const matchVersion = hash({
    package_ref: input.lode_contract.package_ref,
    package_version: input.lode_contract.version,
    action_id: variant.action_id,
    action_category: action.category,
    resource_requirements_id: input.lode_contract.resource_requirements.resource_requirements_id,
    resource_requirements_version: input.lode_contract.resource_requirements.resource_requirements_version ?? null,
    resource_profile_id: resourceProfile.requirement_profile_id,
    requirement_refs: matchedRequirementRefs,
    operation_mode: input.lode_contract.operation_mode
  });
  const ownerProof = matchLodeBusinessActionOwner({
    package_ref: input.lode_contract.package_ref,
    version: input.lode_contract.version,
    action_declaration: input.lode_contract.action_declaration
  }, variant.action_id, {
    schema_version: "webenvoy.harbor-resource-match.v0",
    match_ref: `resource-match:${matchVersion.slice(0, 32)}`,
    match_version: `sha256:${matchVersion}`,
    matched_requirement_refs: matchedRequirementRefs
  });
  if (!ownerProof) return failure("execution_policy_owner_declaration_invalid", "repair_package_contract");
  const ownerFields = readBusinessActionOwnerProof(ownerProof);
  if (!ownerFields || ownerFields.category !== "prepare" ||
    ownerFields.target_scope.site_slug !== "xiaohongshu" ||
    !ownerFields.target_scope.target_types.includes("creator_publish_page") ||
    !ownerFields.target_scope.supported_origins?.includes("https://creator.xiaohongshu.com")) {
    return failure("execution_policy_owner_declaration_invalid", "repair_package_contract");
  }
  let policies;
  try {
    policies = await input.config_store.resolveSources({
      skill_ref: input.lode_contract.package_ref,
      thread_ref: context.thread_id,
      turn_sequence: context.turn_sequence
    });
  } catch {
    return failure("execution_policy_owner_unavailable", "retry_when_policy_owner_ready");
  }
  const targetFingerprint = hash({ target_ref: target.target_ref, target_type: input.task_intent.scope.target_type });
  const evaluation = evaluateExecutionPolicy({
    caller: input.task_intent.entrypoint,
    evaluated_at: input.evaluated_at,
    action: {
      action_instance_ref: `task-action:${input.run_id}:${variant.action_id}`,
      action_id: variant.action_id,
      target: {
        target_ref: `target:sha256:${targetFingerprint}`,
        target_type: input.task_intent.scope.target_type,
        site_slug: "xiaohongshu",
        origin: target.target_origin
      }
    },
    owner_proof: ownerProof,
    context: {
      skill_ref: input.lode_contract.package_ref,
      thread_ref: context.thread_id,
      turn_sequence: context.turn_sequence
    },
    policies: input.single_action_decision === undefined
      ? policies
      : { ...policies, single_action_decision: input.single_action_decision }
  });
  return {
    evaluation,
    expires_at: new Date(Date.parse(input.evaluated_at) + confirmationTtlMs).toISOString(),
    context
  };
}

export function writePrecheckPolicyFailure(evaluation: ExecutionPolicyEvaluation): FailureRecord {
  if (evaluation.status === "stopped") {
    return failure(`execution_policy_${evaluation.stop_reason}`, evaluation.stop_reason === "policy_unavailable"
      ? "configure_execution_policy"
      : "repair_package_contract");
  }
  if (evaluation.next_step === "request_confirmation") {
    return failure("authorization_confirmation_required", "confirm_or_deny_current_action");
  }
  if (evaluation.next_step === "stop") return failure("execution_policy_denied", "change_execution_policy_or_cancel");
  // #379 owns the validate-only Harbor operation. Until that owner contract is
  // available, an allowed policy decision is durable but has no dispatch path.
  return failure("harbor_write_precheck_operation_unavailable", "retry_when_write_precheck_owner_ready");
}

export async function persistWritePrecheckPolicyDecision(input: {
  run_id: string;
  policy: EvaluatedWritePrecheckPolicy;
  authorization_store: FileAuthorizationDecisionStore;
  run_record_store?: FileRunRecordStore;
}): Promise<void> {
  const decisionKind = input.policy.evaluation.status === "evaluated" &&
    input.policy.evaluation.effective_policy.source === "single_action_decision"
    ? "single-action"
    : "initial";
  const decision = await input.authorization_store.recordAuthorizationDecision({
    idempotency_key: `write-precheck-policy:${decisionKind}:${hash(input.policy.context.idempotency_key).slice(0, 32)}`,
    evaluation: input.policy.evaluation,
    subject: {
      scope: "task",
      run_id: input.run_id,
      thread_id: input.policy.context.thread_id,
      turn_id: input.policy.context.turn_id
    },
    expires_at: input.policy.expires_at
  });
  const snapshot = policyBindingSnapshot(input.policy, decision);
  if (snapshot && input.run_record_store) {
    await input.run_record_store.updateRunRecord(input.run_id, { policy_binding_snapshot: snapshot });
  }
}
