import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

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

export type AdmissionDecision = {
  decision: "accepted" | "accepted_with_warnings" | "blocked_pre_admission" | "requires_user_action" | "deferred_true_write";
  action_risk: "read" | "write" | "submit" | "destructive";
  resource_match_ref?: string;
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
  package_ref?: string;
  admission: AdmissionDecision;
  runtime_binding_refs?: string[];
  result_ref?: string;
  evidence_refs?: string[];
  failure?: FailureRecord;
  retention_state?: RetentionState;
};

export type CreateRunRecordInput = {
  run_id: string;
  task_intent_ref: string;
  capability_ref: string;
  admission: AdmissionDecision;
  status?: Extract<RunRecordStatus, "pending" | "admitted" | "running" | "failed" | "blocked" | "requires_user_action" | "cancelled" | "expired">;
  entrypoint_ref?: string;
  package_ref?: string;
  runtime_binding_refs?: readonly string[];
  result_ref?: string;
  evidence_refs?: readonly string[];
  failure?: FailureRecord;
  retention_state?: RetentionState;
};

export type RunRecordPatch = {
  status?: RunRecordStatus;
  runtime_binding_refs?: readonly string[];
  result_ref?: string;
  evidence_refs?: readonly string[];
  failure?: FailureRecord;
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

const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const statusRanks: Record<RunRecordStatus, number> = {
  pending: 0,
  admitted: 1,
  running: 2,
  succeeded: 3,
  failed: 3,
  blocked: 3,
  requires_user_action: 3,
  manual_recovery_required: 3,
  unknown_outcome: 3,
  cancelled: 3,
  expired: 3
};

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
  if (statusRanks[next] < statusRanks[current]) {
    throw new Error(`run status cannot move backward from ${current} to ${next}`);
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
  if (record.package_ref !== undefined) {
    requireRef(record.package_ref, "package_ref");
  }
  if (record.result_ref !== undefined) {
    requireRef(record.result_ref, "result_ref");
  }
  if (record.admission.resource_match_ref !== undefined) {
    requireRef(record.admission.resource_match_ref, "admission.resource_match_ref");
  }
  copyRefs(record.runtime_binding_refs, "runtime_binding_refs");
  copyRefs(record.evidence_refs, "evidence_refs");
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
  if (patch.result_ref !== undefined) {
    next.result_ref = requireRef(patch.result_ref, "result_ref");
  }
  if (patch.evidence_refs !== undefined) {
    next.evidence_refs = copyRequiredRefs(patch.evidence_refs, "evidence_refs");
  }
  if (patch.failure !== undefined) {
    next.failure = patch.failure;
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
    admission: input.admission
  };
  if (input.entrypoint_ref !== undefined) {
    record.entrypoint_ref = requireRef(input.entrypoint_ref, "entrypoint_ref");
  }
  if (input.package_ref !== undefined) {
    record.package_ref = requireRef(input.package_ref, "package_ref");
  }
  if (input.runtime_binding_refs !== undefined) {
    record.runtime_binding_refs = copyRequiredRefs(input.runtime_binding_refs, "runtime_binding_refs");
  }
  if (input.result_ref !== undefined) {
    record.result_ref = requireRef(input.result_ref, "result_ref");
  }
  if (input.evidence_refs !== undefined) {
    record.evidence_refs = copyRequiredRefs(input.evidence_refs, "evidence_refs");
  }
  if (input.failure !== undefined) {
    record.failure = input.failure;
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
