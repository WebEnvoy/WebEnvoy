import type { FileRunRecordStore, RunRecordStatus } from "./run-record-store.js";
import type { TaskTurnInputField, TaskTurnInputSnapshot } from "./task-turn-input.js";
import type { TaskTurnInputPolicyResolver } from "./task-turn-input-policy.js";

export const taskThreadSchemaVersion = "webenvoy.task-thread.v0";
export const taskThreadStoreSchemaVersion = "webenvoy.task-thread-store.v0";

export type TaskTurnStatus =
  | "submitting"
  | "accepted"
  | "running"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "status_unknown";

export type TaskTurnSubmissionError = {
  category: string;
  code: string;
  phase: string;
  recovery_hint: string;
};

export type TaskTurnRecord = {
  turn_id: string;
  sequence: number;
  idempotency_key: string;
  request_hash: string;
  run_id: string;
  creation_channel: "api" | "cli" | "mcp" | "sdk" | "app";
  input: TaskTurnInputSnapshot;
  created_at: string;
  updated_at: string;
  submission_state: "submitting" | "accepted" | "rejected";
  failure_code?: string;
  submission_error?: TaskTurnSubmissionError;
  terminated_at?: string;
  run_claim_token: string;
  submission_http_status?: number;
  submission_ok?: boolean;
};

export type TaskThreadRecord = {
  schema_version: typeof taskThreadStoreSchemaVersion;
  thread_id: string;
  capability_ref: string;
  identity_environment_ref: string;
  created_at: string;
  updated_at: string;
  turns: TaskTurnRecord[];
};

export type TaskTurnInputGap = {
  location: `field:${string}` | `attachment:${number}`;
  code: "owner_ref_unavailable" | "owner_ref_check_unavailable";
  recovery_action: "restore_owner_content" | "reselect_attachment" | "retry_owner_check";
};

export type TaskTurnView = Omit<TaskTurnRecord, "request_hash" | "run_claim_token" | "submission_http_status" | "submission_ok"> & {
  status: TaskTurnStatus;
  run_status?: RunRecordStatus;
  terminal_at?: string;
  input_gaps?: TaskTurnInputGap[];
  authorization_decision_refs?: string[];
};

export type TaskThreadView = Omit<TaskThreadRecord, "schema_version" | "turns"> & {
  schema_version: typeof taskThreadSchemaVersion;
  turns: TaskTurnView[];
};

export type ReserveTaskTurnInput = {
  idempotency_key: string;
  request_hash: string;
  run_id: string;
  creation_channel: TaskTurnRecord["creation_channel"];
  package_ref: string;
  input: unknown;
};

export type FileTaskThreadStoreOptions = {
  directory: string;
  runRecordStore: FileRunRecordStore;
  clock?: () => Date;
  lockTimeoutMs?: number;
  ownerRefCheckTimeoutMs?: number;
  checkOwnerRef?: (ownerRef: string) => Promise<boolean>;
  resolveInputPolicy?: TaskTurnInputPolicyResolver;
};

export type FileTaskThreadStore = {
  readonly directory: string;
  createOrGetTaskThread(input: {
    capability_ref: string;
    identity_environment_ref: string;
  }): Promise<{ thread: TaskThreadView; created: boolean }>;
  getTaskThread(threadId: string): Promise<TaskThreadView | undefined>;
  listTaskThreads(): Promise<TaskThreadView[]>;
  reserveTaskTurn(threadId: string, input: ReserveTaskTurnInput): Promise<{
    thread: TaskThreadView;
    turn: TaskTurnView;
    replayed: boolean;
    run_claim_token?: string;
    replay_response?: { status: number; ok: boolean; error?: TaskTurnSubmissionError };
  }>;
  recordTaskTurnSubmission(threadId: string, turnId: string, input: {
    accepted: boolean;
    http_status: number;
    ok: boolean;
    failure_code?: string;
    error?: unknown;
  }): Promise<TaskThreadView>;
  terminateTaskTurn(threadId: string, turnId: string): Promise<TaskThreadView>;
};

export type { TaskTurnInputField, TaskTurnInputSnapshot };
