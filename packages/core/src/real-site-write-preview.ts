import { completeRunWithPreviewResult, type CompletedRunOutput } from "./result-envelope.js";
import type { ApprovalRequest, FailureRecord, FileRunRecordStore, PostCheckResult, PreviewResultState, RetentionState, RunRecord } from "./run-record-store.js";
import { acceptReadOnlyTaskSubmission, type TaskIntentEnvelope, type TaskSubmissionInput } from "./task-submission.js";

export type RealSiteWritePreviewInput = TaskSubmissionInput & {
  result_ref: string;
  expected_change?: Record<string, unknown>;
  preview_state?: PreviewResultState;
  approval_request?: ApprovalRequest;
  evidence_refs?: readonly string[];
  post_check?: PostCheckResult;
  retention_state?: RetentionState;
};

export type RealSiteWritePreviewResult =
  | {
      ok: true;
      task_intent: TaskIntentEnvelope;
      run_record: RunRecord;
      result?: CompletedRunOutput;
    }
  | {
      ok: false;
      failure: FailureRecord;
      run_record?: RunRecord;
    };

function invalidPreviewInput(code: string, recoveryHint = "fix_input"): FailureRecord {
  return {
    category: "request_invalid",
    code,
    phase: "admission",
    recovery_hint: recoveryHint,
    attribution: "input"
  };
}

function actionRequestMismatch(): FailureRecord {
  return invalidPreviewInput("approval_action_request_mismatch", "refresh_preview_request");
}

function approvalBlocked(): FailureRecord {
  return {
    category: "action_risk",
    code: "approval_blocked",
    phase: "admission",
    recovery_hint: "show_blocked_approval_state"
  };
}

function approvalEvidenceRefs(input: RealSiteWritePreviewInput, record: RunRecord): readonly string[] {
  return input.evidence_refs ?? input.approval_request?.evidence_refs ?? record.evidence_refs ?? record.action_request?.evidence_refs ?? [];
}

function validateApprovalRequest(input: RealSiteWritePreviewInput, record: RunRecord): FailureRecord | undefined {
  if (!input.approval_request) return undefined;
  if (!record.action_request || input.approval_request.action_request_id !== record.action_request.action_request_id) {
    return actionRequestMismatch();
  }
  if (input.approval_request.task_intent_ref !== record.task_intent_ref) {
    return actionRequestMismatch();
  }
  return undefined;
}

async function attachApprovalRequest(store: FileRunRecordStore, input: RealSiteWritePreviewInput, record: RunRecord): Promise<RunRecord | FailureRecord> {
  const mismatch = validateApprovalRequest(input, record);
  if (mismatch) return mismatch;
  if (!input.approval_request) return record;

  const evidence_refs = approvalEvidenceRefs(input, record);
  if (input.approval_request.status === "expired") {
    return store.updateRunRecord(record.run_id, {
      status: "expired",
      approval_request: input.approval_request,
      ...(evidence_refs.length === 0 ? {} : { evidence_refs }),
      retention_state: input.retention_state ?? "active"
    });
  }

  if (input.approval_request.status === "blocked") {
    return store.updateRunRecord(record.run_id, {
      status: "failed",
      approval_request: input.approval_request,
      failure: approvalBlocked(),
      ...(evidence_refs.length === 0 ? {} : { evidence_refs }),
      retention_state: input.retention_state ?? "active"
    });
  }

  return store.updateRunRecord(record.run_id, {
    approval_request: input.approval_request,
    ...(evidence_refs.length === 0 ? {} : { evidence_refs })
  });
}

export async function recordRealSiteWritePreviewResult(store: FileRunRecordStore, input: RealSiteWritePreviewInput): Promise<RealSiteWritePreviewResult> {
  const admitted = await acceptReadOnlyTaskSubmission(store, input);
  if (!admitted.ok) return admitted;

  if (!admitted.run_record.action_request) {
    return {
      ok: false,
      failure: invalidPreviewInput("write_precheck_action_request_required", "use_validate_or_preview"),
      run_record: admitted.run_record
    };
  }
  if (admitted.run_record.action_request.no_submit_guard.status !== "active" || admitted.run_record.action_request.risk_classification.true_write_requested !== false) {
    return {
      ok: false,
      failure: invalidPreviewInput("no_submit_guard_required", "use_validate_or_preview"),
      run_record: admitted.run_record
    };
  }

  const approvalAttached = await attachApprovalRequest(store, input, admitted.run_record);
  if ("category" in approvalAttached) {
    return {
      ok: false,
      failure: approvalAttached,
      run_record: admitted.run_record
    };
  }
  if (approvalAttached.status === "expired" || approvalAttached.status === "failed") {
    return {
      ok: true,
      task_intent: admitted.task_intent,
      run_record: approvalAttached
    };
  }

  const running = await store.updateRunRecord(approvalAttached.run_id, {
    status: "running",
    evidence_refs: approvalEvidenceRefs(input, approvalAttached)
  });
  const result =
    input.preview_state === "preview_unavailable" || input.preview_state === "page_changed" || input.preview_state === "user_cancelled"
      ? await completeRunWithPreviewResult(store, running.run_id, {
          result_ref: input.result_ref,
          preview_state: input.preview_state,
          evidence_refs: approvalEvidenceRefs(input, running),
          ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
          retention_state: input.retention_state ?? "active"
        })
      : await completeRunWithPreviewResult(store, running.run_id, {
          result_ref: input.result_ref,
          ...(input.expected_change === undefined ? {} : { expected_change: input.expected_change }),
          evidence_refs: approvalEvidenceRefs(input, running),
          ...(input.post_check === undefined ? {} : { post_check: input.post_check }),
          retention_state: input.retention_state ?? "active"
        });

  return {
    ok: true,
    task_intent: admitted.task_intent,
    run_record: result.run_record,
    result
  };
}
