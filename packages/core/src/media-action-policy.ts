import { createHash } from "node:crypto";

import type { AuthorizationDecisionSummary } from "./authorization-decision.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { matchLodeBusinessActionOwner, readBusinessActionOwnerProof } from "./execution-policy-owner-proof.js";
import {
  evaluateExecutionPolicy,
  type ExecutionPolicySources,
  type ExecutionPolicyEvaluation,
  type SingleActionDecision
} from "./execution-policy.js";
import {
  xhsMediaActionPaths,
  xhsMediaCapabilityId,
  xhsMediaLockRef,
  xhsMediaOperationId,
  xhsMediaPackageRef,
  type LodePackageAdmissionContract,
  type XhsMediaActionId
} from "./lode-admission.js";
import { normalizePublicHttpTarget } from "./public-target-reference.js";
import type { FailureRecord, FileRunRecordStore, PolicyBindingSnapshot, RunRecord } from "./run-record-store.js";
import { isXhsMediaActionIntent, type TaskIntentEnvelope } from "./task-submission.js";

export type MediaActionAuthorizationContext = {
  thread_id: string;
  turn_id: string;
  turn_sequence: number;
  idempotency_key: string;
};

export type EvaluatedXhsMediaActionPolicy = {
  evaluation: ExecutionPolicyEvaluation;
  expires_at: string;
  context: MediaActionAuthorizationContext;
  action_id: XhsMediaActionId;
  requested_path: (typeof xhsMediaActionPaths)[XhsMediaActionId];
};

const confirmationTtlMs = 10 * 60 * 1_000;

function failure(code: string, recovery_hint: string): FailureRecord {
  return { category: "action_risk", code, phase: "admission", recovery_hint };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactMediaAction(
  taskIntent: TaskIntentEnvelope,
  contract: LodePackageAdmissionContract
): { action_id: XhsMediaActionId; requested_path: (typeof xhsMediaActionPaths)[XhsMediaActionId]; action: NonNullable<NonNullable<LodePackageAdmissionContract["action_declaration"]>["actions"][number]>; resource_profile: NonNullable<LodePackageAdmissionContract["resource_requirements"]["resource_requirement_profiles"]>[number] } | undefined {
  if (!isXhsMediaActionIntent(taskIntent, contract.package_ref) ||
    contract.package_ref !== xhsMediaPackageRef ||
    contract.source_ref !== xhsMediaPackageRef ||
    contract.lock_ref !== xhsMediaLockRef ||
    contract.capability_id !== xhsMediaCapabilityId ||
    contract.operation_id !== xhsMediaOperationId ||
    contract.operation_mode !== "write" ||
    contract.version !== "0.1.0" ||
    taskIntent.capability.ref !== `lode:capability/${xhsMediaCapabilityId}` ||
    taskIntent.capability.version !== "0.1.0" ||
    taskIntent.capability.source_ref !== xhsMediaPackageRef ||
    taskIntent.capability.lock_ref !== xhsMediaLockRef ||
    taskIntent.scope.target_type !== "creator_publish_page") return undefined;
  const actionId = taskIntent.input.action_id as XhsMediaActionId;
  const requestedPath = xhsMediaActionPaths[actionId];
  const inputRefs = taskIntent.input.refs;
  if (!Array.isArray(inputRefs)) return undefined;
  if ((actionId === "xhs_publish_note_image_text_media.image_upload" && inputRefs.length === 0) ||
    (actionId === "xhs_publish_note_image_text_media.text_to_image_generate" && inputRefs.length !== 0)) return undefined;
  const action = contract.action_declaration?.actions.find((candidate) => candidate.action_id === actionId);
  if (!action || action.category !== "commit" ||
    action.target_scope.site_slug !== "xiaohongshu" ||
    !action.target_scope.target_types.includes("creator_publish_page") ||
    !action.target_scope.supported_origins.includes("https://creator.xiaohongshu.com") ||
    action.resource_requirements.id !== contract.resource_requirements.resource_requirements_id ||
    taskIntent.resource_requirement_profile_id === undefined ||
    !action.resource_requirements.profile_ids.includes(taskIntent.resource_requirement_profile_id)) return undefined;
  const resourceProfile = contract.resource_requirements.resource_requirement_profiles.find((candidate) =>
    candidate.requirement_profile_id === taskIntent.resource_requirement_profile_id
  );
  const expectedEffect = actionId === "xhs_publish_note_image_text_media.image_upload" ? "upload" : "create";
  if (!resourceProfile || action.external_effects.length !== 1 || action.external_effects[0] !== expectedEffect) return undefined;
  return { action_id: actionId, requested_path: requestedPath, action, resource_profile: resourceProfile };
}

/** Exact package/action/target predicate used by media confirmation and continuation. */
export function isExactXhsMediaActionTask(
  taskIntent: TaskIntentEnvelope,
  contract: LodePackageAdmissionContract
): boolean {
  return exactMediaAction(taskIntent, contract) !== undefined;
}

/** Continuation accepts only the persisted media action request awaiting one confirmation. */
export function isExactXhsMediaActionRun(run: RunRecord | undefined, confirmationDecisionRef?: string): boolean {
  const action = run?.action_request;
  const risk = action?.risk_classification;
  const guard = action?.no_submit_guard;
  const snapshot = run?.policy_binding_snapshot;
  const actionId = action?.action_id;
  const requestedPath = actionId === undefined ? undefined : xhsMediaActionPaths[actionId as XhsMediaActionId];
  return run?.status === "requires_user_action" &&
    run.package_ref === xhsMediaPackageRef &&
    run.capability_ref === `lode:capability/${xhsMediaCapabilityId}` &&
    run.capability_version === "0.1.0" &&
    run.capability_source_ref === xhsMediaPackageRef &&
    run.capability_lock_ref === xhsMediaLockRef &&
    run.admission.action_risk === "write" &&
    action?.task_intent_ref === run.task_intent_ref &&
    action.capability_ref === run.capability_ref &&
    action.capability_version === run.capability_version &&
    action.capability_source_ref === run.capability_source_ref &&
    action.capability_lock_ref === run.capability_lock_ref &&
    action.package_ref === run.package_ref &&
    action.operation_mode === "execute_after_approval" &&
    typeof actionId === "string" && Object.hasOwn(xhsMediaActionPaths, actionId) &&
    requestedPath !== undefined &&
    risk?.risk === "write" &&
    risk.execution_intent === "execute_after_approval" &&
    risk.true_write_requested === false &&
    guard?.status === "active" &&
    guard.enforced_by === "core" &&
    ["draft", "submit", "destructive", "reconcile_status", "request_cancel"].every((intent) => guard.blocked_execution_intents.includes(intent)) &&
    guard.source_refs.includes(xhsMediaPackageRef) &&
    guard.source_refs.includes(xhsMediaLockRef) &&
    action.target_refs?.scope_target_ref === run.scope_target_ref &&
    snapshot?.schema_version === "webenvoy.policy-binding-snapshot.v0" &&
    (confirmationDecisionRef === undefined || snapshot.decision_ref === confirmationDecisionRef) &&
    run.authorization_decision_refs?.includes(snapshot.decision_ref) === true;
}

function policyBindingSnapshot(
  policy: EvaluatedXhsMediaActionPolicy,
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

export async function evaluateXhsMediaActionPolicy(input: {
  run_id: string;
  task_intent: TaskIntentEnvelope;
  lode_contract: LodePackageAdmissionContract;
  authorization_context?: MediaActionAuthorizationContext;
  config_store?: FileExecutionPolicyConfigStore;
  single_action_decision?: SingleActionDecision;
  /** Initial submission always asks the user once, even when the configured mode is auto. */
  require_confirmation?: boolean;
  evaluated_at: string;
}): Promise<EvaluatedXhsMediaActionPolicy | FailureRecord> {
  const context = input.authorization_context;
  if (!context || !input.config_store) return failure("execution_policy_owner_unavailable", "retry_when_policy_owner_ready");
  const variant = exactMediaAction(input.task_intent, input.lode_contract);
  if (!variant) return failure("execution_policy_owner_declaration_invalid", "repair_package_contract");
  const target = normalizePublicHttpTarget(input.task_intent.scope.target_ref);
  if (!target.ok || target.target_origin !== "https://creator.xiaohongshu.com") {
    return failure("execution_policy_target_invalid", "fix_input");
  }
  const matchedRequirementRefs = [...input.task_intent.resource_requirement_refs].sort();
  const matchVersion = hash({
    package_ref: input.lode_contract.package_ref,
    package_version: input.lode_contract.version,
    action_id: variant.action_id,
    action_category: variant.action.category,
    resource_requirements_id: input.lode_contract.resource_requirements.resource_requirements_id,
    resource_requirements_version: input.lode_contract.resource_requirements.resource_requirements_version ?? null,
    resource_profile_id: variant.resource_profile.requirement_profile_id,
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
  if (!ownerFields || ownerFields.category !== "commit" ||
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
  const evaluationInput = {
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
  } as const;
  let evaluation = evaluateExecutionPolicy(evaluationInput);
  if (input.require_confirmation && evaluation.status === "evaluated" && evaluation.next_step === "execute" &&
    evaluation.effective_policy.source !== "single_action_decision") {
    const source = evaluation.effective_policy.source;
    const sourcePolicy = policies[source];
    if (sourcePolicy) {
      const confirmationPolicies: ExecutionPolicySources = {
        ...policies,
        [source]: {
          ...sourcePolicy,
          modes: { ...sourcePolicy.modes, [variant.action.category]: "confirm" }
        }
      };
      if (input.single_action_decision !== undefined) {
        confirmationPolicies.single_action_decision = input.single_action_decision;
      }
      evaluation = evaluateExecutionPolicy({ ...evaluationInput, policies: confirmationPolicies });
    }
  }
  return {
    evaluation,
    expires_at: new Date(Date.parse(input.evaluated_at) + confirmationTtlMs).toISOString(),
    context,
    action_id: variant.action_id,
    requested_path: variant.requested_path
  };
}

export function xhsMediaActionPolicyFailure(evaluation: ExecutionPolicyEvaluation): FailureRecord {
  if (evaluation.status === "stopped") {
    return failure(`execution_policy_${evaluation.stop_reason}`, evaluation.stop_reason === "policy_unavailable"
      ? "configure_execution_policy"
      : "repair_package_contract");
  }
  if (evaluation.next_step === "request_confirmation") return failure("authorization_confirmation_required", "confirm_or_deny_current_action");
  if (evaluation.next_step === "stop") return failure("execution_policy_denied", "change_execution_policy_or_cancel");
  return failure("harbor_media_action_operation_unavailable", "retry_when_media_action_owner_ready");
}

export async function persistXhsMediaActionPolicyDecision(input: {
  run_id: string;
  policy: EvaluatedXhsMediaActionPolicy;
  authorization_store: FileAuthorizationDecisionStore;
  run_record_store?: FileRunRecordStore;
}): Promise<void> {
  const decisionKind = input.policy.evaluation.status === "evaluated" &&
    input.policy.evaluation.effective_policy.source === "single_action_decision"
    ? "single-action"
    : "initial";
  const decision = await input.authorization_store.recordAuthorizationDecision({
    idempotency_key: `xhs-media-action-policy:${decisionKind}:${hash(input.policy.context.idempotency_key).slice(0, 32)}`,
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
    await input.run_record_store.updateRunRecord(input.run_id, {
      policy_binding_snapshot: snapshot
    });
  }
}

export { xhsMediaPackageRef, xhsMediaLockRef, xhsMediaCapabilityId, xhsMediaOperationId, xhsMediaActionPaths };
