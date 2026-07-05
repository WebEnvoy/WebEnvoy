import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeFailureRecord, type FailureAttribution } from "./failure-attribution.js";

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
  admission: AdmissionDecision;
  runtime_binding_refs?: string[];
  action_request?: ActionRequest;
  approval_request?: ApprovalRequest;
  result_ref?: string;
  preview_result?: PreviewResult;
  evidence_refs?: string[];
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
  runtime_binding_refs?: readonly string[];
  action_request?: ActionRequest;
  approval_request?: ApprovalRequest;
  result_ref?: string;
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
  preview_result?: PreviewResult;
  evidence_refs?: readonly string[];
  failure?: FailureRecord;
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type FileRunRecordStoreOptions = {
  directory: string;
  clock?: () => Date;
};

export type FileRunRecordStore = {
  readonly directory: string;
  createRunRecord(input: CreateRunRecordInput): Promise<RunRecord>;
  getRunRecord(runId: string): Promise<RunRecord | undefined>;
  updateRunRecord(runId: string, patch: RunRecordPatch): Promise<RunRecord>;
  listRunRecords(): Promise<RunRecord[]>;
};

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

const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function requireRef(value: string, label: string): string {
  if (value.length === 0) {
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
  if (!runIdPattern.test(runId)) {
    throw new Error("run_id must use 1-128 characters from A-Z, a-z, 0-9, dot, underscore, or hyphen");
  }
  return runId;
}

function runRecordPath(directory: string, runId: string): string {
  return join(directory, `${validateRunId(runId)}.json`);
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
  if (record.result_ref !== undefined) {
    requireRef(record.result_ref, "result_ref");
  }
  if (record.preview_result !== undefined) {
    validatePreviewResult(record.preview_result);
  }
  if (record.admission.resource_match_ref !== undefined) {
    requireRef(record.admission.resource_match_ref, "admission.resource_match_ref");
  }
  copyRefs(record.admission.resource_requirement_refs, "admission.resource_requirement_refs");
  copyRefs(record.admission.runtime_binding_refs, "admission.runtime_binding_refs");
  copyRefs(record.admission.evidence_refs, "admission.evidence_refs");
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

export function createFileRunRecordStore(options: FileRunRecordStoreOptions): FileRunRecordStore {
  const clock = options.clock ?? (() => new Date());
  const directory = options.directory;

  async function getRunRecord(runId: string): Promise<RunRecord | undefined> {
    const record = await readRecord(runRecordPath(directory, runId));
    if (record) {
      assertRunRecord(record);
    }
    return record;
  }

  return {
    directory,

    async createRunRecord(input) {
      const path = runRecordPath(directory, input.run_id);
      const existing = await readRecord(path);
      if (existing) {
        throw new Error(`run record already exists: ${input.run_id}`);
      }
      const record = makeRecord(input, clock().toISOString());
      await writeRecord(directory, record);
      return record;
    },

    getRunRecord,

    async updateRunRecord(runId, patch) {
      const record = await getRunRecord(runId);
      if (!record) {
        throw new Error(`run record not found: ${runId}`);
      }
      const nextStatus = patch.status ?? record.status;
      assertTransition(record.status, nextStatus);
      const now = clock().toISOString();
      const next = withOptionalFields(
        {
          ...record,
          status: nextStatus,
          updated_at: now
        },
        patch
      );
      if (terminalRunRecordStatuses.has(nextStatus) && !next.terminal_at) {
        next.terminal_at = now;
      }
      assertRunRecord(next);
      await writeRecord(directory, next);
      return next;
    },

    async listRunRecords() {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort();
      const records: RunRecord[] = [];
      for (const file of files) {
        const runId = basename(file, ".json");
        const record = await getRunRecord(runId);
        if (record) {
          records.push(record);
        }
      }
      return records;
    }
  };
}
