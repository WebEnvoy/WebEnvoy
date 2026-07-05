import {
  terminalRunRecordStatuses,
  type AdmissionDecision,
  type FailureRecord,
  type FileRunRecordStore,
  type PostCheckResult,
  type RetentionState,
  type RunRecord,
  type RunRecordStatus
} from "./run-record-store.js";
import { normalizeFailureRecord } from "./failure-attribution.js";

export const runQuerySchemaVersion = "webenvoy.run-query.v0";

export type RunTimeline = {
  created_at: string;
  updated_at: string;
  terminal_at?: string;
};

export type RunCapabilitySummary = {
  task_intent_ref: string;
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  capability_lock_ref?: string;
  entrypoint_ref?: string;
  package_ref?: string;
};

export type RunAdmissionSummary = {
  decision: AdmissionDecision["decision"];
  action_risk: AdmissionDecision["action_risk"];
  resource_requirement_refs?: string[];
  resource_match_ref?: string;
};

export type RunRuntimeRefs = {
  binding_refs?: string[];
  admission_binding_refs?: string[];
};

export type TerminalRunStatus = Exclude<RunRecordStatus, "pending" | "admitted" | "running">;

export type RunTerminalFailureSummary = Pick<FailureRecord, "category" | "code" | "phase" | "attribution">;

export type RunPostCheckSummary = Pick<PostCheckResult, "schema_version" | "status" | "summary" | "checked_at" | "code" | "attribution" | "recovery_hint">;

export type RunTerminalSummary = {
  terminal: true;
  status: TerminalRunStatus;
  terminal_at?: string;
  result_ref?: string;
  failure?: RunTerminalFailureSummary;
  post_check?: RunPostCheckSummary;
  retention_state?: RetentionState;
};

export type RunSummary = {
  schema_version: typeof runQuerySchemaVersion;
  run_id: string;
  status: RunRecordStatus;
  timeline: RunTimeline;
  task: RunCapabilitySummary;
  admission: RunAdmissionSummary;
  runtime_refs: RunRuntimeRefs;
  terminal_summary?: RunTerminalSummary;
};

export type RunQueryResult =
  | {
      ok: true;
      run: RunSummary;
    }
  | {
      ok: false;
      failure: FailureRecord;
    };

function queryFailure(code: string, category: FailureRecord["category"], recoveryHint: string): FailureRecord {
  return {
    category,
    code,
    phase: "query",
    recovery_hint: recoveryHint
  };
}

function terminalSummary(record: RunRecord): RunTerminalSummary | undefined {
  if (!terminalRunRecordStatuses.has(record.status)) {
    return undefined;
  }
  const failure: RunTerminalFailureSummary | undefined =
    record.failure === undefined
      ? undefined
      : (() => {
          const normalized = normalizeFailureRecord(record.failure);
          return {
            category: normalized.category,
            code: normalized.code,
            phase: normalized.phase,
            ...(normalized.attribution === undefined ? {} : { attribution: normalized.attribution })
          };
        })();
  const postCheck =
    record.post_check === undefined
      ? undefined
      : {
          schema_version: record.post_check.schema_version,
          status: record.post_check.status,
          summary: record.post_check.summary,
          ...(record.post_check.checked_at === undefined ? {} : { checked_at: record.post_check.checked_at }),
          ...(record.post_check.code === undefined ? {} : { code: record.post_check.code }),
          ...(record.post_check.attribution === undefined ? {} : { attribution: record.post_check.attribution }),
          ...(record.post_check.recovery_hint === undefined ? {} : { recovery_hint: record.post_check.recovery_hint })
        };
  return {
    terminal: true,
    status: record.status as TerminalRunStatus,
    ...(record.terminal_at === undefined ? {} : { terminal_at: record.terminal_at }),
    ...(record.result_ref === undefined ? {} : { result_ref: record.result_ref }),
    ...(failure === undefined ? {} : { failure }),
    ...(postCheck === undefined ? {} : { post_check: postCheck }),
    ...(record.retention_state === undefined ? {} : { retention_state: record.retention_state })
  };
}

export function projectRunSummary(record: RunRecord): RunSummary {
  const terminal = terminalSummary(record);
  return {
    schema_version: runQuerySchemaVersion,
    run_id: record.run_id,
    status: record.status,
    timeline: {
      created_at: record.created_at,
      updated_at: record.updated_at,
      ...(record.terminal_at === undefined ? {} : { terminal_at: record.terminal_at })
    },
    task: {
      task_intent_ref: record.task_intent_ref,
      capability_ref: record.capability_ref,
      ...(record.capability_version === undefined ? {} : { capability_version: record.capability_version }),
      ...(record.capability_source_ref === undefined ? {} : { capability_source_ref: record.capability_source_ref }),
      ...(record.capability_lock_ref === undefined ? {} : { capability_lock_ref: record.capability_lock_ref }),
      ...(record.entrypoint_ref === undefined ? {} : { entrypoint_ref: record.entrypoint_ref }),
      ...(record.package_ref === undefined ? {} : { package_ref: record.package_ref })
    },
    admission: {
      decision: record.admission.decision,
      action_risk: record.admission.action_risk,
      ...(record.admission.resource_requirement_refs === undefined ? {} : { resource_requirement_refs: [...record.admission.resource_requirement_refs] }),
      ...(record.admission.resource_match_ref === undefined ? {} : { resource_match_ref: record.admission.resource_match_ref })
    },
    runtime_refs: {
      ...(record.runtime_binding_refs === undefined ? {} : { binding_refs: [...record.runtime_binding_refs] }),
      ...(record.admission.runtime_binding_refs === undefined ? {} : { admission_binding_refs: [...record.admission.runtime_binding_refs] })
    },
    ...(terminal === undefined ? {} : { terminal_summary: terminal })
  };
}

export async function getRunSummary(store: FileRunRecordStore, runId: string): Promise<RunQueryResult> {
  let record: RunRecord | undefined;
  try {
    record = await store.getRunRecord(runId);
  } catch (error) {
    if (error instanceof Error && /run_id/.test(error.message)) {
      return {
        ok: false,
        failure: queryFailure("run_id_invalid", "request_invalid", "fix_input")
      };
    }
    throw error;
  }

  if (!record) {
    return {
      ok: false,
      failure: queryFailure("run_not_found", "persistence_observability", "fix_input")
    };
  }

  return {
    ok: true,
    run: projectRunSummary(record)
  };
}
