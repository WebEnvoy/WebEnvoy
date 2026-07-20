import type { ActionRequest, AdmissionDecision, CreateRunRecordInput, FailureRecord, FileRunRecordStore, RunRecord } from "./run-record-store.js";
import { validateHarborAdmission, type HarborAdmissionInput } from "./harbor-admission.js";
import { validateLodePackageAdmission, type LodePackageAdmissionContract } from "./lode-admission.js";
import { normalizeStoredTargetRef } from "./public-target-reference.js";

export const taskIntentSchemaVersion = "webenvoy.task-intent.v0";
export const actionRequestSchemaVersion = "webenvoy.action-request.v0";

export type TaskEntrypoint = "api" | "cli" | "mcp" | "sdk" | "app";
export type TaskActionRisk = AdmissionDecision["action_risk"];
export type TaskExecutionIntent = "read" | "validate_only" | "draft" | "preview" | "execute_after_approval" | "reconcile_status" | "request_cancel";

export type TaskIntentEnvelope = {
  schema_version: typeof taskIntentSchemaVersion;
  intent_id: string;
  correlation_id?: string;
  entrypoint: TaskEntrypoint;
  user_intent: {
    summary: string;
  };
  capability: {
    ref: string;
    version: string;
    source_ref?: string;
    lock_ref?: string;
  };
  input: {
    summary: string;
    refs?: string[];
  };
  scope: {
    target_type: string;
    target_ref: string;
  };
  policy: {
    risk: TaskActionRisk;
    execution_intent: TaskExecutionIntent;
    timeout_ms?: number;
  };
  resource_requirement_refs: string[];
  resource_requirement_profile_id?: string;
  evidence_policy_ref: string;
};

export type TaskSubmissionInput = HarborAdmissionInput & {
  run_id: string;
  run_claim_token?: string;
  task_intent: unknown;
  package_ref?: string;
  lode_package_contract?: LodePackageAdmissionContract;
  lode_resolution_failure?: FailureRecord;
  harbor_admission_failure?: FailureRecord;
  resource_match_ref?: string;
  runtime_binding_refs?: readonly string[];
  evidence_refs?: readonly string[];
};

export type TaskSubmissionResult =
  | {
      ok: true;
      task_intent: TaskIntentEnvelope;
      run_record: RunRecord;
    }
  | {
      ok: false;
      failure: FailureRecord;
      run_record?: RunRecord;
    };

type ParsedTaskIntentFields = {
  taskIntent: Record<string, unknown>;
  schemaVersion: typeof taskIntentSchemaVersion;
  intentId: string;
  entrypoint: string;
  userIntent: Record<string, unknown>;
  capability: Record<string, unknown>;
  input: Record<string, unknown>;
  scope: Record<string, unknown>;
  policy: Record<string, unknown>;
  resourceRequirementRefs: string[];
  resourceRequirementProfileId?: string;
  evidencePolicyRef: string;
};

const entrypoints = new Set<TaskEntrypoint>(["api", "cli", "mcp", "sdk", "app"]);
const actionRisks = new Set<TaskActionRisk>(["read", "write", "submit", "destructive"]);
const executionIntents = new Set<TaskExecutionIntent>(["read", "validate_only", "draft", "preview", "execute_after_approval", "reconcile_status", "request_cancel"]);
const trueWriteExecutionIntents = new Set<TaskExecutionIntent>(["execute_after_approval", "reconcile_status", "request_cancel"]);
const writePrecheckExecutionIntents = new Set<TaskExecutionIntent>(["validate_only", "draft", "preview"]);
const allowedTaskIntentFields = new Set([
  "$schema",
  "schema_version",
  "intent_id",
  "correlation_id",
  "entrypoint",
  "user_intent",
  "capability",
  "input",
  "scope",
  "policy",
  "resource_requirement_refs",
  "resource_requirement_profile_id",
  "evidence_policy_ref"
]);
const privateFieldNames = new Set(["raw_payload", "dom", "har", "screenshot", "video", "cookie", "token", "local_path", "ui_state", "runtime_session"]);
type WritePrecheckExecutionIntent = Extract<TaskExecutionIntent, "validate_only" | "draft" | "preview">;

function requestInvalid(code: string, recoveryHint: string): FailureRecord {
  return {
    category: "request_invalid",
    code,
    phase: "pre_admission",
    recovery_hint: recoveryHint
  };
}

function isFailure(value: unknown): value is FailureRecord {
  return Boolean(value && typeof value === "object" && "category" in value);
}

function asObject(value: unknown, code: string): Record<string, unknown> | FailureRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return requestInvalid(code, "fix_input");
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, code: string): string | FailureRecord {
  if (typeof value !== "string" || value.length === 0) {
    return requestInvalid(code, "fix_input");
  }
  return value;
}

function asStringArray(value: unknown, code: string): string[] | FailureRecord {
  if (!Array.isArray(value)) {
    return requestInvalid(code, "fix_input");
  }
  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = asNonEmptyString(entry, `${code}_${index}`);
    if (typeof parsed !== "string") {
      return parsed;
    }
    strings.push(parsed);
  }
  return strings;
}

function asActionRisk(value: unknown): TaskActionRisk | FailureRecord {
  const risk = asNonEmptyString(value, "policy_risk_required");
  if (isFailure(risk)) return risk;
  if (!actionRisks.has(risk as TaskActionRisk)) {
    return requestInvalid("policy_risk_unsupported", "fix_input");
  }
  return risk as TaskActionRisk;
}

function asExecutionIntent(value: unknown): TaskExecutionIntent | FailureRecord {
  const intent = asNonEmptyString(value, "policy_execution_intent_required");
  if (isFailure(intent)) return intent;
  if (!executionIntents.has(intent as TaskExecutionIntent)) {
    return requestInvalid("policy_execution_intent_unsupported", "fix_input");
  }
  return intent as TaskExecutionIntent;
}

function findForbiddenField(value: unknown, forbiddenFields: ReadonlySet<string>): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenField(entry, forbiddenFields);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenFields.has(key)) {
      return key;
    }
    const found = findForbiddenField(entry, forbiddenFields);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function parseTaskIntentFields(taskIntent: Record<string, unknown>): ParsedTaskIntentFields | FailureRecord {
  const schemaVersion = asNonEmptyString(taskIntent.schema_version, "schema_version_required");
  if (isFailure(schemaVersion)) return schemaVersion;
  if (schemaVersion !== taskIntentSchemaVersion) {
    return requestInvalid("schema_version_unsupported", "fix_input");
  }
  const intentId = asNonEmptyString(taskIntent.intent_id, "intent_id_required");
  const entrypoint = asNonEmptyString(taskIntent.entrypoint, "entrypoint_required");
  const userIntent = asObject(taskIntent.user_intent, "user_intent_required");
  const capability = asObject(taskIntent.capability, "capability_required");
  const input = asObject(taskIntent.input, "input_required");
  const scope = asObject(taskIntent.scope, "scope_required");
  const policy = asObject(taskIntent.policy, "policy_required");
  const resourceRequirementRefs = asStringArray(taskIntent.resource_requirement_refs, "resource_requirement_refs_required");
  const resourceRequirementProfileId = taskIntent.resource_requirement_profile_id === undefined
    ? undefined
    : asNonEmptyString(taskIntent.resource_requirement_profile_id, "resource_requirement_profile_id_invalid");
  const evidencePolicyRef = asNonEmptyString(taskIntent.evidence_policy_ref, "evidence_policy_ref_required");

  if (isFailure(intentId)) return intentId;
  if (isFailure(entrypoint)) return entrypoint;
  if (isFailure(userIntent)) return userIntent;
  if (isFailure(capability)) return capability;
  if (isFailure(input)) return input;
  if (isFailure(scope)) return scope;
  if (isFailure(policy)) return policy;
  if (isFailure(resourceRequirementRefs)) return resourceRequirementRefs;
  if (isFailure(resourceRequirementProfileId)) return resourceRequirementProfileId;
  if (isFailure(evidencePolicyRef)) return evidencePolicyRef;

  return {
    taskIntent,
    schemaVersion,
    intentId,
    entrypoint,
    userIntent,
    capability,
    input,
    scope,
    policy,
    resourceRequirementRefs,
    ...(resourceRequirementProfileId === undefined ? {} : { resourceRequirementProfileId }),
    evidencePolicyRef
  };
}

function buildTaskIntent(fields: ParsedTaskIntentFields): TaskIntentEnvelope | FailureRecord {
  if (!entrypoints.has(fields.entrypoint as TaskEntrypoint)) {
    return requestInvalid("entrypoint_unsupported", "fix_input");
  }
  const risk = asActionRisk(fields.policy.risk);
  const executionIntent = asExecutionIntent(fields.policy.execution_intent);
  if (isFailure(risk)) return risk;
  if (isFailure(executionIntent)) return executionIntent;

  const inputRefs = fields.input.refs === undefined ? undefined : asStringArray(fields.input.refs, "input_refs_invalid");
  if (isFailure(inputRefs)) {
    return inputRefs;
  }
  const userIntentSummary = asNonEmptyString(fields.userIntent.summary, "user_intent_summary_required");
  const capabilityRef = asNonEmptyString(fields.capability.ref, "capability_ref_required");
  const capabilityVersion = asNonEmptyString(fields.capability.version, "capability_version_required");
  const capabilitySourceRef = fields.capability.source_ref === undefined ? undefined : asNonEmptyString(fields.capability.source_ref, "capability_source_ref_invalid");
  const capabilityLockRef = fields.capability.lock_ref === undefined ? undefined : asNonEmptyString(fields.capability.lock_ref, "capability_lock_ref_invalid");
  const inputSummary = asNonEmptyString(fields.input.summary, "input_summary_required");
  const scopeTargetType = asNonEmptyString(fields.scope.target_type, "scope_target_type_required");
  const rawScopeTargetRef = asNonEmptyString(fields.scope.target_ref, "scope_target_ref_required");
  if (isFailure(userIntentSummary)) return userIntentSummary;
  if (isFailure(capabilityRef)) return capabilityRef;
  if (isFailure(capabilityVersion)) return capabilityVersion;
  if (isFailure(capabilitySourceRef)) return capabilitySourceRef;
  if (isFailure(capabilityLockRef)) return capabilityLockRef;
  if (isFailure(inputSummary)) return inputSummary;
  if (isFailure(scopeTargetType)) return scopeTargetType;
  if (isFailure(rawScopeTargetRef)) return rawScopeTargetRef;
  const scopeTargetRef = normalizeStoredTargetRef(rawScopeTargetRef);
  if (!scopeTargetRef) return requestInvalid("scope_target_ref_sensitive_or_invalid", "fix_input");
  const normalizedInputRefs = inputRefs?.map(normalizeStoredTargetRef);
  if (normalizedInputRefs?.some((ref) => ref === undefined)) return requestInvalid("input_ref_sensitive_or_invalid", "fix_input");

  return {
    schema_version: fields.schemaVersion,
    intent_id: fields.intentId,
    ...(typeof fields.taskIntent.correlation_id === "string" ? { correlation_id: fields.taskIntent.correlation_id } : {}),
    entrypoint: fields.entrypoint as TaskEntrypoint,
    user_intent: {
      summary: userIntentSummary
    },
    capability: {
      ref: capabilityRef,
      version: capabilityVersion,
      ...(capabilitySourceRef === undefined ? {} : { source_ref: capabilitySourceRef }),
      ...(capabilityLockRef === undefined ? {} : { lock_ref: capabilityLockRef })
    },
    input: {
      summary: inputSummary,
      ...(normalizedInputRefs === undefined ? {} : { refs: normalizedInputRefs as string[] })
    },
    scope: {
      target_type: scopeTargetType,
      target_ref: scopeTargetRef
    },
    policy: {
      risk,
      execution_intent: executionIntent,
      ...(typeof fields.policy.timeout_ms === "number" ? { timeout_ms: fields.policy.timeout_ms } : {})
    },
    resource_requirement_refs: fields.resourceRequirementRefs,
    ...(fields.resourceRequirementProfileId === undefined ? {} : { resource_requirement_profile_id: fields.resourceRequirementProfileId }),
    evidence_policy_ref: fields.evidencePolicyRef
  };
}

export function validateTaskIntent(value: unknown): TaskIntentEnvelope | FailureRecord {
  const privateField = findForbiddenField(value, privateFieldNames);
  if (privateField) {
    return requestInvalid(`private_field_rejected:${privateField}`, "remove_private_field");
  }

  const taskIntent = asObject(value, "task_intent_must_be_object");
  if (isFailure(taskIntent)) {
    return taskIntent;
  }

  for (const field of Object.keys(taskIntent)) {
    if (!allowedTaskIntentFields.has(field)) {
      return requestInvalid(`unsupported_task_intent_field:${field}`, "fix_input");
    }
  }

  const fields = parseTaskIntentFields(taskIntent);
  return isFailure(fields) ? fields : buildTaskIntent(fields);
}

function writeGuardrailFailure(taskIntent: TaskIntentEnvelope): FailureRecord | undefined {
  if (taskIntent.policy.risk === "read" && taskIntent.policy.execution_intent === "read") {
    return undefined;
  }
  if (taskIntent.policy.risk === "write" && writePrecheckExecutionIntents.has(taskIntent.policy.execution_intent)) {
    return undefined;
  }
  const trueWriteRequested =
    taskIntent.policy.risk === "submit" ||
    taskIntent.policy.risk === "destructive" ||
    trueWriteExecutionIntents.has(taskIntent.policy.execution_intent);
  return {
    category: "action_risk",
    code: trueWriteRequested ? "true_write_deferred" : "write_action_request_deferred",
    phase: "admission",
    recovery_hint: trueWriteRequested ? "use_validate_or_preview" : "use_read_intent"
  };
}

function isWritePrecheckIntent(taskIntent: TaskIntentEnvelope): boolean {
  return taskIntent.policy.risk === "write" && writePrecheckExecutionIntents.has(taskIntent.policy.execution_intent);
}

function writePrecheckOperationMode(executionIntent: TaskExecutionIntent): WritePrecheckExecutionIntent | "blocked_true_write" {
  return writePrecheckExecutionIntents.has(executionIntent) ? (executionIntent as WritePrecheckExecutionIntent) : "blocked_true_write";
}

function buildActionRequest(
  taskIntent: TaskIntentEnvelope,
  input: TaskSubmissionInput,
  refs: {
    package_ref?: string;
    runtime_binding_refs?: readonly string[];
    evidence_refs?: readonly string[];
    blocked?: boolean;
  } = {}
): ActionRequest {
  const blocked = refs.blocked === true;
  const requestOperationMode = writePrecheckOperationMode(taskIntent.policy.execution_intent);
  const sourceRefs = [
    taskIntent.capability.source_ref,
    taskIntent.capability.lock_ref,
    refs.package_ref ?? input.package_ref,
    ...taskIntent.resource_requirement_refs
  ].filter((ref): ref is string => Boolean(ref));
  const writeFacts = input.harbor_write_precheck_facts && "writable_target" in input.harbor_write_precheck_facts ? input.harbor_write_precheck_facts : undefined;
  const writableTargetRef = writeFacts === undefined ? undefined : normalizeStoredTargetRef(writeFacts.writable_target.target_ref);
  return {
    schema_version: actionRequestSchemaVersion,
    action_request_id: `action-request:${taskIntent.intent_id}`,
    task_intent_ref: taskIntent.intent_id,
    capability_ref: taskIntent.capability.ref,
    capability_version: taskIntent.capability.version,
    ...(taskIntent.capability.source_ref === undefined ? {} : { capability_source_ref: taskIntent.capability.source_ref }),
    ...(taskIntent.capability.lock_ref === undefined ? {} : { capability_lock_ref: taskIntent.capability.lock_ref }),
    ...((refs.package_ref ?? input.package_ref) === undefined ? {} : { package_ref: refs.package_ref ?? input.package_ref }),
    operation_mode: blocked ? "blocked_true_write" : requestOperationMode,
    risk_classification: {
      risk: taskIntent.policy.risk,
      execution_intent: taskIntent.policy.execution_intent,
      level: blocked ? "blocked" : taskIntent.policy.execution_intent === "validate_only" ? "low" : "medium",
      true_write_requested: blocked,
      reasons: blocked ? ["true_write_execution_intent_blocked"] : ["write_precheck_validate_only_boundary", "no_submit_guard_required"]
    },
    no_submit_guard: {
      status: "active",
      enforced_by: "core",
      blocked_execution_intents: ["execute_after_approval", "reconcile_status", "request_cancel"],
      source_refs: sourceRefs
    },
    target_refs: {
      scope_target_ref: taskIntent.scope.target_ref,
      ...(writeFacts === undefined || writableTargetRef === undefined ? {} : { writable_target_ref: writableTargetRef, form_state_ref: writeFacts.form_state.snapshot_ref })
    },
    ...(refs.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: refs.runtime_binding_refs }),
    ...(refs.evidence_refs === undefined ? {} : { evidence_refs: refs.evidence_refs }),
    consumer_boundary: "Core stores action request refs, risk classification, and no-submit guard only; no raw browser material or true write payload is stored."
  };
}

function lodeAdmissionDecision(failure: FailureRecord): AdmissionDecision["decision"] {
  return failure.category === "action_risk" && failure.code === "true_write_deferred" ? "deferred_true_write" : "blocked_pre_admission";
}

function lodeAdmissionActionRisk(taskIntent: TaskIntentEnvelope, failure: FailureRecord): TaskActionRisk {
  return failure.category === "action_risk" && failure.code === "true_write_deferred" && taskIntent.policy.risk === "read" ? "write" : taskIntent.policy.risk;
}

function harborAdmissionDecision(failure: FailureRecord): AdmissionDecision["decision"] {
  return harborFailureRequiresUserAction(failure.code) ? "requires_user_action" : "blocked_pre_admission";
}

function harborAdmissionStatus(failure: FailureRecord): Extract<RunRecord["status"], "failed" | "requires_user_action"> {
  return harborFailureRequiresUserAction(failure.code) ? "requires_user_action" : "failed";
}

function harborFailureRequiresUserAction(code: string): boolean {
  return (
    code === "identity_auth_required" ||
    code === "identity_environment_required" ||
    code === "identity_environment_unavailable" ||
    code === "identity_environment_missing" ||
    code === "login_expired"
  );
}

export async function acceptReadOnlyTaskSubmission(store: FileRunRecordStore, input: TaskSubmissionInput): Promise<TaskSubmissionResult> {
  const taskIntent = validateTaskIntent(input.task_intent);
  if (isFailure(taskIntent)) {
    return {
      ok: false,
      failure: taskIntent
    };
  }
  const createRunRecord = (record: CreateRunRecordInput) => store.createRunRecord({
    ...record,
    scope_target_ref: taskIntent.scope.target_ref
  }, input.run_claim_token);

  const writeGuardrail = writeGuardrailFailure(taskIntent);
  if (writeGuardrail) {
    const runRecord = await createRunRecord({
      run_id: input.run_id,
      status: "failed",
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      capability_version: taskIntent.capability.version,
      ...(taskIntent.capability.source_ref === undefined ? {} : { capability_source_ref: taskIntent.capability.source_ref }),
      ...(taskIntent.capability.lock_ref === undefined ? {} : { capability_lock_ref: taskIntent.capability.lock_ref }),
      ...(input.package_ref === undefined ? {} : { package_ref: input.package_ref }),
      admission: {
        decision: "deferred_true_write",
        action_risk: taskIntent.policy.risk,
        resource_requirement_refs: taskIntent.resource_requirement_refs,
        ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref })
      },
      action_request: buildActionRequest(taskIntent, input, { blocked: writeGuardrail.code === "true_write_deferred" }),
      failure: writeGuardrail,
      retention_state: "active"
    });
    return {
      ok: false,
      failure: writeGuardrail,
      run_record: runRecord
    };
  }

  if (input.lode_resolution_failure) {
    const runRecord = await createRunRecord({
      run_id: input.run_id,
      status: "failed",
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      capability_version: taskIntent.capability.version,
      ...(taskIntent.capability.source_ref === undefined ? {} : { capability_source_ref: taskIntent.capability.source_ref }),
      ...(taskIntent.capability.lock_ref === undefined ? {} : { capability_lock_ref: taskIntent.capability.lock_ref }),
      ...(input.package_ref === undefined ? {} : { package_ref: input.package_ref }),
      admission: {
        decision: lodeAdmissionDecision(input.lode_resolution_failure),
        action_risk: lodeAdmissionActionRisk(taskIntent, input.lode_resolution_failure),
        resource_requirement_refs: taskIntent.resource_requirement_refs,
        ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref })
      },
      failure: input.lode_resolution_failure
    });
    return {
      ok: false,
      failure: input.lode_resolution_failure,
      run_record: runRecord
    };
  }

  const lodeAdmission = validateLodePackageAdmission(taskIntent, input);
  if (!lodeAdmission.ok) {
    const runRecord = await createRunRecord({
      run_id: input.run_id,
      status: "failed",
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      capability_version: taskIntent.capability.version,
      ...(taskIntent.capability.source_ref === undefined ? {} : { capability_source_ref: taskIntent.capability.source_ref }),
      ...(taskIntent.capability.lock_ref === undefined ? {} : { capability_lock_ref: taskIntent.capability.lock_ref }),
      ...(lodeAdmission.package_ref === undefined ? {} : { package_ref: lodeAdmission.package_ref }),
      admission: {
        decision: lodeAdmissionDecision(lodeAdmission.failure),
        action_risk: lodeAdmissionActionRisk(taskIntent, lodeAdmission.failure),
        resource_requirement_refs: taskIntent.resource_requirement_refs,
        ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref })
      },
      failure: lodeAdmission.failure
    });
    return {
      ok: false,
      failure: lodeAdmission.failure,
      run_record: runRecord
    };
  }

  if (input.harbor_admission_failure) {
    const runRecord = await createRunRecord({
      run_id: input.run_id,
      status: harborAdmissionStatus(input.harbor_admission_failure),
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      capability_version: taskIntent.capability.version,
      ...(lodeAdmission.capability_source_ref === undefined ? {} : { capability_source_ref: lodeAdmission.capability_source_ref }),
      ...(lodeAdmission.capability_lock_ref === undefined ? {} : { capability_lock_ref: lodeAdmission.capability_lock_ref }),
      package_ref: lodeAdmission.package_ref,
      admission: {
        decision: harborAdmissionDecision(input.harbor_admission_failure),
        action_risk: taskIntent.policy.risk,
        resource_requirement_refs: lodeAdmission.resource_requirement_refs,
        ...(input.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: input.runtime_binding_refs }),
        ...(input.evidence_refs === undefined ? {} : { evidence_refs: input.evidence_refs }),
        ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref })
      },
      ...(input.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: input.runtime_binding_refs }),
      ...(input.evidence_refs === undefined ? {} : { evidence_refs: input.evidence_refs }),
      failure: input.harbor_admission_failure
    });
    return {
      ok: false,
      failure: input.harbor_admission_failure,
      run_record: runRecord
    };
  }

  const writePrecheck = isWritePrecheckIntent(taskIntent);
  const harborAdmission = validateHarborAdmission(input, writePrecheck ? "write_precheck" : "read", lodeAdmission.required_harbor_facts);
  if (!harborAdmission.ok) {
    if (harborAdmission.failure.code.startsWith("forbidden_field:")) {
      return {
        ok: false,
        failure: harborAdmission.failure
      };
    }
    const runRecord = await createRunRecord({
      run_id: input.run_id,
      status: harborAdmissionStatus(harborAdmission.failure),
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      capability_version: taskIntent.capability.version,
      ...(lodeAdmission.capability_source_ref === undefined ? {} : { capability_source_ref: lodeAdmission.capability_source_ref }),
      ...(lodeAdmission.capability_lock_ref === undefined ? {} : { capability_lock_ref: lodeAdmission.capability_lock_ref }),
      package_ref: lodeAdmission.package_ref,
      admission: {
        decision: harborAdmissionDecision(harborAdmission.failure),
        action_risk: taskIntent.policy.risk,
        resource_requirement_refs: lodeAdmission.resource_requirement_refs,
        ...(harborAdmission.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: harborAdmission.runtime_binding_refs }),
        ...(harborAdmission.evidence_refs === undefined ? {} : { evidence_refs: harborAdmission.evidence_refs }),
        ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref }),
        ...(harborAdmission.runtime_session_binding === undefined ? {} : { runtime_session_binding: harborAdmission.runtime_session_binding })
      },
      ...(harborAdmission.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: harborAdmission.runtime_binding_refs }),
      ...(harborAdmission.evidence_refs === undefined ? {} : { evidence_refs: harborAdmission.evidence_refs }),
      failure: harborAdmission.failure
    });
    return {
      ok: false,
      failure: harborAdmission.failure,
      run_record: runRecord
    };
  }

  const runRecordInput = {
    run_id: input.run_id,
    status: "admitted",
    task_intent_ref: taskIntent.intent_id,
    entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
    capability_ref: taskIntent.capability.ref,
    capability_version: taskIntent.capability.version,
    ...(lodeAdmission.capability_source_ref === undefined ? {} : { capability_source_ref: lodeAdmission.capability_source_ref }),
    ...(lodeAdmission.capability_lock_ref === undefined ? {} : { capability_lock_ref: lodeAdmission.capability_lock_ref }),
    package_ref: lodeAdmission.package_ref,
    admission: {
      decision: writePrecheck ? "accepted_with_warnings" : "accepted",
      action_risk: taskIntent.policy.risk,
      resource_requirement_refs: lodeAdmission.resource_requirement_refs,
      runtime_binding_refs: harborAdmission.runtime_binding_refs,
      evidence_refs: harborAdmission.evidence_refs,
      ...(harborAdmission.runtime_session_binding === undefined ? {} : { runtime_session_binding: harborAdmission.runtime_session_binding })
    }
  } as const;
  const actionRequest = writePrecheck
    ? buildActionRequest(taskIntent, input, {
        package_ref: lodeAdmission.package_ref,
        runtime_binding_refs: harborAdmission.runtime_binding_refs,
        evidence_refs: harborAdmission.evidence_refs
      })
    : undefined;
  const runRecord = await createRunRecord({
    ...runRecordInput,
    runtime_binding_refs: harborAdmission.runtime_binding_refs,
    evidence_refs: harborAdmission.evidence_refs,
    ...(actionRequest === undefined ? {} : { action_request: actionRequest }),
    admission: {
      ...runRecordInput.admission,
      ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref })
    }
  });

  return {
    ok: true,
    task_intent: taskIntent,
    run_record: runRecord
  };
}
