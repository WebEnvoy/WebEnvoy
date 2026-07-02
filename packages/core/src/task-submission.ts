import type { FailureRecord, FileRunRecordStore, RunRecord } from "./run-record-store.js";
import { validateHarborAdmission, type HarborAdmissionInput } from "./harbor-admission.js";
import { validateLodePackageAdmission, type LodePackageAdmissionContract } from "./lode-admission.js";

export const taskIntentSchemaVersion = "webenvoy.task-intent.v0";

export type TaskEntrypoint = "api" | "cli" | "mcp" | "sdk" | "app";

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
    risk: "read";
    execution_intent: "read";
    timeout_ms?: number;
  };
  resource_requirement_refs: string[];
  evidence_policy_ref: string;
};

export type TaskSubmissionInput = HarborAdmissionInput & {
  run_id: string;
  task_intent: unknown;
  package_ref?: string;
  lode_package_contract?: LodePackageAdmissionContract;
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
  evidencePolicyRef: string;
};

const entrypoints = new Set<TaskEntrypoint>(["api", "cli", "mcp", "sdk", "app"]);
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
  "evidence_policy_ref"
]);
const privateFieldNames = new Set(["raw_payload", "dom", "har", "screenshot", "video", "cookie", "token", "local_path", "ui_state", "runtime_session"]);

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
  const evidencePolicyRef = asNonEmptyString(taskIntent.evidence_policy_ref, "evidence_policy_ref_required");

  if (isFailure(intentId)) return intentId;
  if (isFailure(entrypoint)) return entrypoint;
  if (isFailure(userIntent)) return userIntent;
  if (isFailure(capability)) return capability;
  if (isFailure(input)) return input;
  if (isFailure(scope)) return scope;
  if (isFailure(policy)) return policy;
  if (isFailure(resourceRequirementRefs)) return resourceRequirementRefs;
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
    evidencePolicyRef
  };
}

function buildReadOnlyTaskIntent(fields: ParsedTaskIntentFields): TaskIntentEnvelope | FailureRecord {
  if (!entrypoints.has(fields.entrypoint as TaskEntrypoint)) {
    return requestInvalid("entrypoint_unsupported", "fix_input");
  }
  const risk = asNonEmptyString(fields.policy.risk, "policy_risk_required");
  const executionIntent = asNonEmptyString(fields.policy.execution_intent, "policy_execution_intent_required");
  if (risk !== "read" || executionIntent !== "read") {
    return requestInvalid("read_only_submission_required", "use_read_intent");
  }

  const inputRefs = fields.input.refs === undefined ? undefined : asStringArray(fields.input.refs, "input_refs_invalid");
  if (isFailure(inputRefs)) {
    return inputRefs;
  }
  const userIntentSummary = asNonEmptyString(fields.userIntent.summary, "user_intent_summary_required");
  const capabilityRef = asNonEmptyString(fields.capability.ref, "capability_ref_required");
  const capabilityVersion = asNonEmptyString(fields.capability.version, "capability_version_required");
  const inputSummary = asNonEmptyString(fields.input.summary, "input_summary_required");
  const scopeTargetType = asNonEmptyString(fields.scope.target_type, "scope_target_type_required");
  const scopeTargetRef = asNonEmptyString(fields.scope.target_ref, "scope_target_ref_required");
  if (isFailure(userIntentSummary)) return userIntentSummary;
  if (isFailure(capabilityRef)) return capabilityRef;
  if (isFailure(capabilityVersion)) return capabilityVersion;
  if (isFailure(inputSummary)) return inputSummary;
  if (isFailure(scopeTargetType)) return scopeTargetType;
  if (isFailure(scopeTargetRef)) return scopeTargetRef;

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
      version: capabilityVersion
    },
    input: {
      summary: inputSummary,
      ...(inputRefs === undefined ? {} : { refs: inputRefs })
    },
    scope: {
      target_type: scopeTargetType,
      target_ref: scopeTargetRef
    },
    policy: {
      risk: "read",
      execution_intent: "read",
      ...(typeof fields.policy.timeout_ms === "number" ? { timeout_ms: fields.policy.timeout_ms } : {})
    },
    resource_requirement_refs: fields.resourceRequirementRefs,
    evidence_policy_ref: fields.evidencePolicyRef
  };
}

function parseTaskIntent(value: unknown): TaskIntentEnvelope | FailureRecord {
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
  return isFailure(fields) ? fields : buildReadOnlyTaskIntent(fields);
}

export async function acceptReadOnlyTaskSubmission(store: FileRunRecordStore, input: TaskSubmissionInput): Promise<TaskSubmissionResult> {
  const taskIntent = parseTaskIntent(input.task_intent);
  if (isFailure(taskIntent)) {
    return {
      ok: false,
      failure: taskIntent
    };
  }

  const lodeAdmission = validateLodePackageAdmission(taskIntent, input);
  if (!lodeAdmission.ok) {
    const runRecord = await store.createRunRecord({
      run_id: input.run_id,
      status: "failed",
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      ...(lodeAdmission.package_ref === undefined ? {} : { package_ref: lodeAdmission.package_ref }),
      admission: {
        decision: "blocked_pre_admission",
        action_risk: "read",
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

  const harborAdmission = validateHarborAdmission(input);
  if (!harborAdmission.ok) {
    const runRecord = await store.createRunRecord({
      run_id: input.run_id,
      status: "failed",
      task_intent_ref: taskIntent.intent_id,
      entrypoint_ref: `entrypoint:${taskIntent.entrypoint}`,
      capability_ref: taskIntent.capability.ref,
      package_ref: lodeAdmission.package_ref,
      admission: {
        decision: "blocked_pre_admission",
        action_risk: "read",
        resource_requirement_refs: lodeAdmission.resource_requirement_refs,
        ...(harborAdmission.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: harborAdmission.runtime_binding_refs }),
        ...(harborAdmission.evidence_refs === undefined ? {} : { evidence_refs: harborAdmission.evidence_refs }),
        ...(input.resource_match_ref === undefined ? {} : { resource_match_ref: input.resource_match_ref })
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
    package_ref: lodeAdmission.package_ref,
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: lodeAdmission.resource_requirement_refs,
      runtime_binding_refs: harborAdmission.runtime_binding_refs,
      evidence_refs: harborAdmission.evidence_refs
    }
  } as const;
  const runRecord = await store.createRunRecord({
    ...runRecordInput,
    runtime_binding_refs: harborAdmission.runtime_binding_refs,
    evidence_refs: harborAdmission.evidence_refs,
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
