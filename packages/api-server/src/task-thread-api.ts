import { createHash } from "node:crypto";

import {
  TaskThreadStoreError,
  isExactWritePrecheckRun,
  validateTaskTurnInputSnapshot,
  type FileAuthorizationDecisionStore,
  type FileRunRecordStore,
  type RunRecord,
  type WritePrecheckAuthorizationContext,
  type TaskThreadView,
  type TaskTurnView
} from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";
import { taskSubmissionFailureStatusCode, type TaskSubmissionHttpResult } from "./task-api.js";

type JsonBody = Record<string, unknown>;
type FileTaskThreadStore = ReturnType<typeof createFileTaskThreadStore>;

export type TaskThreadApiResult = {
  handled: true;
  status: number;
  body: JsonBody;
} | {
  handled: false;
  requires_body: boolean;
};

export type TaskThreadApiInput = {
  method: string | undefined;
  path: string;
  body?: JsonBody;
  store?: FileTaskThreadStore;
  runRecordStore?: FileRunRecordStore;
  authorizationDecisionStore?: FileAuthorizationDecisionStore;
  withWritePrecheckRunLock?: <T>(runId: string, action: () => Promise<T>) => Promise<T>;
  validateTask: (body: JsonBody) => Promise<unknown | undefined>;
  submitTask: (
    body: JsonBody,
    runClaimToken: string,
    authorizationContext: WritePrecheckAuthorizationContext
  ) => Promise<TaskSubmissionHttpResult>;
};

const writePrecheckRunTails = new Map<string, Promise<void>>();

/** Serialize policy continuation and cancellation for one task run. */
export async function withWritePrecheckRunLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
  const previous = writePrecheckRunTails.get(runId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  writePrecheckRunTails.set(runId, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (writePrecheckRunTails.get(runId) === tail) writePrecheckRunTails.delete(runId);
  }
}

/**
 * A bounded, process-local continuation captured only for a waiting write
 * precheck. The body is already validated by this API before it enters the
 * map; it never contains Harbor private material.
 */
export type PendingWritePrecheckContinuation = {
  run_id: string;
  turn_id: string;
  package_ref: string;
  task_intent: JsonBody;
  harbor?: JsonBody;
  authorization_context: WritePrecheckAuthorizationContext;
  confirmation_decision_ref: string;
  expires_at: string;
};

const pendingWritePrecheckContinuations = new Map<string, PendingWritePrecheckContinuation>();
const pendingWritePrecheckMaxEntries = 256;
const writePrecheckPackageRef = "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0";
const writePrecheckLockRef = "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1";

function prunePendingWritePrecheckContinuations(now = Date.now()): void {
  for (const [ref, pending] of pendingWritePrecheckContinuations) {
    if (Date.parse(pending.expires_at) <= now) pendingWritePrecheckContinuations.delete(ref);
  }
  while (pendingWritePrecheckContinuations.size > pendingWritePrecheckMaxEntries) {
    const oldest = pendingWritePrecheckContinuations.keys().next().value;
    if (typeof oldest !== "string") break;
    pendingWritePrecheckContinuations.delete(oldest);
  }
}

/** Atomically remove a pending continuation before any Core dispatch. */
export function takePendingWritePrecheckContinuation(
  confirmationDecisionRef: string,
  now = Date.now()
): PendingWritePrecheckContinuation | undefined {
  prunePendingWritePrecheckContinuations(now);
  const pending = pendingWritePrecheckContinuations.get(confirmationDecisionRef);
  if (!pending) return undefined;
  pendingWritePrecheckContinuations.delete(confirmationDecisionRef);
  return Date.parse(pending.expires_at) > now ? pending : undefined;
}

export function clearPendingWritePrecheckContinuations(runId: string): void {
  for (const [ref, pending] of pendingWritePrecheckContinuations) {
    if (pending.run_id === runId) pendingWritePrecheckContinuations.delete(ref);
  }
}

export function clearPendingWritePrecheckContinuation(confirmationDecisionRef: string): void {
  pendingWritePrecheckContinuations.delete(confirmationDecisionRef);
}

function exactWritePrecheckTaskBody(body: JsonBody, packageRef: string, run: RunRecord | undefined, confirmationDecisionRef: string): boolean {
  const taskIntent = asObject(body.task_intent);
  const capability = asObject(taskIntent?.capability);
  const policy = asObject(taskIntent?.policy);
  return packageRef === writePrecheckPackageRef &&
    capability?.ref === "lode:capability/publish-note-precheck" &&
    capability.version === "0.1.0" &&
    capability.source_ref === writePrecheckPackageRef &&
    capability.lock_ref === writePrecheckLockRef &&
    policy?.risk === "write" &&
    policy.execution_intent === "validate_only" &&
    isExactWritePrecheckRun(run, confirmationDecisionRef);
}

function publicContinuationHarbor(value: unknown): JsonBody | undefined {
  const input = asObject(value);
  if (!input) return undefined;
  const harbor: JsonBody = {};
  if (typeof input.identity_environment_ref === "string") harbor.identity_environment_ref = input.identity_environment_ref;
  if (typeof input.url === "string") harbor.url = input.url;
  if (typeof input.reuse_existing === "boolean") harbor.reuse_existing = input.reuse_existing;
  if (typeof input.timeout_ms === "number") harbor.timeout_ms = input.timeout_ms;
  const evidencePolicy = asObject(input.evidence_policy);
  if (evidencePolicy) harbor.evidence_policy = JSON.parse(JSON.stringify(evidencePolicy));
  return Object.keys(harbor).length === 0 ? undefined : harbor;
}

/** Capture the validated public request only when Core persisted confirmation. */
async function registerPendingWritePrecheckContinuation(input: {
  authorizationDecisionStore?: FileAuthorizationDecisionStore;
  runRecordStore?: FileRunRecordStore;
  body: JsonBody;
  submitted: TaskSubmissionHttpResult;
  run_id: string;
  turn_id: string;
  authorization_context: WritePrecheckAuthorizationContext;
}): Promise<void> {
  if (input.submitted.failure_code !== "authorization_confirmation_required" || !input.authorizationDecisionStore) return;
  const run = asObject(input.submitted.body.run);
  const refs = Array.isArray(run?.authorization_decision_refs)
    ? run.authorization_decision_refs.filter((ref): ref is string => typeof ref === "string")
    : [];
  const now = Date.now();
  prunePendingWritePrecheckContinuations(now);
  for (const ref of refs) {
    let decision;
    try {
      decision = await input.authorizationDecisionStore.getAuthorizationDecision(ref);
    } catch {
      continue;
    }
    if (!decision || decision.decision_ref !== ref || decision.state !== "active" || decision.outcome !== "confirm" ||
      decision.applicability.scope !== "task" || decision.applicability.run_id !== input.run_id ||
      decision.applicability.thread_id !== input.authorization_context.thread_id ||
      decision.applicability.turn_id !== input.turn_id || !decision.expires_at || Date.parse(decision.expires_at) <= now) continue;
    const taskIntent = asObject(input.body.task_intent);
    if (!taskIntent) return;
    const packageRef = nonEmptyString(input.body.package_ref);
    if (!packageRef) return;
    if (!input.runRecordStore) return;
    let run: RunRecord | undefined;
    try {
      run = await input.runRecordStore.getRunRecord(input.run_id);
    } catch {
      return;
    }
    if (!exactWritePrecheckTaskBody(input.body, packageRef, run, ref)) return;
    const harbor = publicContinuationHarbor(input.body.harbor);
    pendingWritePrecheckContinuations.set(ref, {
      run_id: input.run_id,
      turn_id: input.turn_id,
      package_ref: packageRef,
      task_intent: JSON.parse(JSON.stringify(taskIntent)) as JsonBody,
      ...(harbor === undefined ? {} : { harbor }),
      authorization_context: input.authorization_context,
      confirmation_decision_ref: ref,
      expires_at: decision.expires_at
    });
    prunePendingWritePrecheckContinuations(now);
    return;
  }
}

const threadIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function requestError(code: string, recovery_hint = "fix_input"): JsonBody {
  return {
    ok: false,
    error: {
      category: "request_invalid",
      code,
      phase: "pre_admission",
      recovery_hint
    }
  };
}

function submissionInterrupted(): JsonBody {
  return {
    ok: false,
    error: {
      category: "persistence_observability",
      code: "task_submission_interrupted",
      phase: "persistence",
      recovery_hint: "inspect_run_status_or_terminate"
    }
  };
}

function storeUnavailable(): TaskThreadApiResult {
  return {
    handled: true,
    status: 503,
    body: {
      ok: false,
      error: {
        category: "persistence_observability",
        code: "task_thread_store_unavailable",
        phase: "query",
        recovery_hint: "contact_operator"
      }
    }
  };
}

function asObject(value: unknown): JsonBody | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonBody : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decodedIdentifier(value: string | undefined): string | undefined {
  try {
    const decoded = decodeURIComponent(value ?? "");
    return threadIdPattern.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonBody)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(body: JsonBody): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

function errorStatus(error: TaskThreadStoreError): number {
  if (error.code === "thread_not_found" || error.code === "turn_not_found") return 404;
  if (error.code === "thread_lock_timeout" || error.code === "lode_input_policy_unavailable" || error.code.startsWith("owner_ref_check_unavailable:")) return 503;
  if (error.code === "authorization_decision_cancellation_failed") return 503;
  if (error.code === "input_schema_invalid" || error.code === "input_schema_ref_mismatch" || error.code === "input_package_not_found") return 422;
  if (error.code.startsWith("owner_ref_unavailable:")) return 409;
  if (error.code === "thread_has_active_turn" || error.code === "idempotency_payload_mismatch" || error.code === "run_id_already_linked" || error.code === "turn_not_active" || error.code === "turn_run_still_active" || error.code === "input_capability_mismatch" || error.code === "turn_definition_refs_unavailable" || error.code === "turn_definition_refs_mismatch") return 409;
  return 400;
}

function errorResult(error: unknown): TaskThreadApiResult {
  if (!(error instanceof TaskThreadStoreError)) throw error;
  const retryable = error.code === "thread_lock_timeout" || error.code === "lode_input_policy_unavailable" || error.code.startsWith("owner_ref_check_unavailable:");
  return {
    handled: true,
    status: errorStatus(error),
    body: requestError(error.code, retryable ? "retry_later" : "fix_input")
  };
}

function threadTurn(thread: TaskThreadView, turnId: string): TaskTurnView {
  const turn = thread.turns.find((candidate) => candidate.turn_id === turnId);
  if (!turn) throw new TaskThreadStoreError("turn_not_found");
  return turn;
}

async function cancelAuthorizationDecisions(
  store: FileAuthorizationDecisionStore | undefined,
  turn: TaskTurnView
): Promise<void> {
  const refs = turn.authorization_decision_refs;
  if (!store || !refs || refs.length === 0) return;
  try {
    for (const ref of refs) {
      const decision = await store.getAuthorizationDecision(ref);
      if (!decision) throw new Error("authorization_decision_not_found");
      if (decision.applicability.scope !== "task" || decision.applicability.run_id !== turn.run_id) {
        throw new Error("authorization_decision_binding_mismatch");
      }
      if (decision.state === "active") await store.invalidateAuthorizationDecision(ref, "cancelled");
    }
  } catch {
    throw new TaskThreadStoreError("authorization_decision_cancellation_failed");
  }
}

function recoveredSubmissionOutcome(turn: TaskTurnView): { ok: boolean; outcome: string } {
  if (turn.status === "waiting_for_user") return { ok: false, outcome: "submission_requires_user_action" };
  if (turn.status === "failed") return { ok: false, outcome: "submission_failed" };
  if (turn.status === "cancelled") return { ok: false, outcome: "submission_cancelled" };
  if (turn.status === "status_unknown") return { ok: false, outcome: "submission_status_unknown" };
  return { ok: true, outcome: "submission_recovered" };
}

function requiresBody(method: string | undefined, path: string): boolean {
  return method === "POST" && (path === "/threads" || /^\/threads\/[^/]+\/turns$/.test(path));
}

export async function handleTaskThreadApi(input: TaskThreadApiInput): Promise<TaskThreadApiResult> {
  const threadMatch = /^\/threads\/([^/]+)$/.exec(input.path);
  const turnCollectionMatch = /^\/threads\/([^/]+)\/turns$/.exec(input.path);
  const terminateMatch = /^\/threads\/([^/]+)\/turns\/([^/]+)\/terminate$/.exec(input.path);
  const isThreadPath = input.path === "/threads" || threadMatch || turnCollectionMatch || terminateMatch;
  if (!isThreadPath) return { handled: false, requires_body: false };
  if (!input.store) return storeUnavailable();
  if (requiresBody(input.method, input.path) && input.body === undefined) {
    return { handled: false, requires_body: true };
  }

  try {
    if (input.method === "POST" && input.path === "/threads") {
      const capabilityRef = nonEmptyString(input.body?.capability_ref);
      const identityRef = nonEmptyString(input.body?.identity_environment_ref);
      if (!capabilityRef || !identityRef) {
        return { handled: true, status: 400, body: requestError("thread_binding_required") };
      }
      const result = await input.store.createOrGetTaskThread({
        capability_ref: capabilityRef,
        identity_environment_ref: identityRef
      });
      return {
        handled: true,
        status: result.created ? 201 : 200,
        body: { ok: true, created: result.created, thread: result.thread }
      };
    }

    if (input.method === "GET" && input.path === "/threads") {
      return {
        handled: true,
        status: 200,
        body: { ok: true, threads: await input.store.listTaskThreads() }
      };
    }

    if (threadMatch && input.method === "GET") {
      const threadId = decodedIdentifier(threadMatch[1]);
      if (!threadId) return { handled: true, status: 400, body: requestError("thread_id_invalid") };
      const thread = await input.store.getTaskThread(threadId);
      if (!thread) throw new TaskThreadStoreError("thread_not_found");
      return { handled: true, status: 200, body: { ok: true, thread } };
    }

    if (turnCollectionMatch && input.method === "POST") {
      const threadId = decodedIdentifier(turnCollectionMatch[1]);
      const body = input.body!;
      const idempotencyKey = nonEmptyString(body.idempotency_key);
      const runId = nonEmptyString(body.run_id);
      const inputSnapshotValue = asObject(body.input_snapshot);
      const taskIntent = asObject(body.task_intent);
      const harbor = asObject(body.harbor);
      const capability = asObject(taskIntent?.capability);
      const entrypoint = nonEmptyString(taskIntent?.entrypoint);
      if (!threadId || !idempotencyKey || !runId || !inputSnapshotValue || !taskIntent || !capability || !entrypoint) {
        return { handled: true, status: 400, body: requestError("task_turn_request_invalid") };
      }
      const validationFailure = await input.validateTask(body);
      if (validationFailure) {
        return { handled: true, status: 400, body: { ok: false, error: validationFailure } };
      }
      validateTaskTurnInputSnapshot(inputSnapshotValue);
      const thread = await input.store.getTaskThread(threadId);
      if (!thread) throw new TaskThreadStoreError("thread_not_found");
      if (capability.ref !== thread.capability_ref || harbor?.identity_environment_ref !== thread.identity_environment_ref) {
        return { handled: true, status: 409, body: requestError("thread_binding_mismatch") };
      }
      const packageRef = nonEmptyString(body.package_ref);
      if (!packageRef || capability.source_ref !== packageRef) {
        return { handled: true, status: 400, body: requestError("package_ref_mismatch") };
      }
      const reserved = await input.store.reserveTaskTurn(threadId, {
        idempotency_key: idempotencyKey,
        request_hash: requestHash(body),
        run_id: runId,
        creation_channel: entrypoint as "api" | "cli" | "mcp" | "sdk" | "app",
        package_ref: packageRef,
        input: inputSnapshotValue
      });
      if (reserved.replayed) {
        if (!reserved.replay_response) {
          const submissionInFlight = reserved.turn.status === "submitting";
          const runRecovered = reserved.turn.run_status !== undefined;
          const recovered = recoveredSubmissionOutcome(reserved.turn);
          const pending = submissionInFlight || reserved.turn.run_status === "pending" ||
            reserved.turn.run_status === "admitted" || reserved.turn.run_status === "running";
          const status = pending || !runRecovered
            ? 202
            : recovered.ok
              ? 200
              : reserved.turn.submission_error === undefined
                ? 202
                : taskSubmissionFailureStatusCode(reserved.turn.submission_error);
          return {
            handled: true,
            status,
            body: {
              ok: submissionInFlight || (runRecovered && recovered.ok),
              replayed: true,
              pending,
              outcome: submissionInFlight
                ? "submission_in_flight"
                : runRecovered
                  ? recovered.outcome
                  : "submission_status_unknown",
              ...(recovered.ok || reserved.turn.submission_error === undefined
                ? {}
                : { error: reserved.turn.submission_error }),
              thread: reserved.thread,
              turn: reserved.turn
            }
          };
        }
        return {
          handled: true,
          status: reserved.replay_response.status,
          body: {
            ok: reserved.replay_response.ok,
            replayed: true,
            ...(reserved.replay_response.error === undefined ? {} : { error: reserved.replay_response.error }),
            thread: reserved.thread,
            turn: reserved.turn
          }
        };
      }
      if (!reserved.run_claim_token) throw new TaskThreadStoreError("run_claim_missing");
      let submitted: TaskSubmissionHttpResult;
      try {
        submitted = await input.submitTask(body, reserved.run_claim_token, {
          thread_id: threadId,
          turn_id: reserved.turn.turn_id,
          turn_sequence: reserved.turn.sequence,
          idempotency_key: idempotencyKey
        });
      } catch {
        const updated = await input.store.recordTaskTurnSubmission(threadId, reserved.turn.turn_id, {
          accepted: true,
          http_status: 500,
          ok: false,
          failure_code: "task_submission_interrupted",
          error: submissionInterrupted().error
        });
        return {
          handled: true,
          status: 500,
          body: {
            ...submissionInterrupted(),
            replayed: false,
            thread: updated,
            turn: threadTurn(updated, reserved.turn.turn_id)
          }
        };
      }
      const updated = await input.store.recordTaskTurnSubmission(threadId, reserved.turn.turn_id, {
        accepted: submitted.run_record_present,
        http_status: submitted.status,
        ok: submitted.body.ok === true,
        ...(submitted.failure_code === undefined ? {} : { failure_code: submitted.failure_code }),
        ...(submitted.body.error === undefined ? {} : { error: submitted.body.error })
      });
      await registerPendingWritePrecheckContinuation({
        ...(input.authorizationDecisionStore === undefined ? {} : { authorizationDecisionStore: input.authorizationDecisionStore }),
        ...(input.runRecordStore === undefined ? {} : { runRecordStore: input.runRecordStore }),
        body,
        submitted,
        run_id: runId,
        turn_id: reserved.turn.turn_id,
        authorization_context: {
          thread_id: threadId,
          turn_id: reserved.turn.turn_id,
          turn_sequence: reserved.turn.sequence,
          idempotency_key: idempotencyKey
        }
      });
      return {
        handled: true,
        status: submitted.status,
        body: {
          ...submitted.body,
          replayed: false,
          thread: updated,
          turn: threadTurn(updated, reserved.turn.turn_id)
        }
      };
    }

    if (terminateMatch && input.method === "POST") {
      const threadId = decodedIdentifier(terminateMatch[1]);
      const turnId = decodedIdentifier(terminateMatch[2]);
      if (!threadId || !turnId) return { handled: true, status: 400, body: requestError("turn_id_invalid") };
      const before = await input.store.getTaskThread(threadId);
      if (!before) throw new TaskThreadStoreError("thread_not_found");
      const turn = threadTurn(before, turnId);
      const terminate = async () => {
        const run = input.runRecordStore
          ? await input.runRecordStore.getRunRecord(turn.run_id)
          : undefined;
        if (isExactWritePrecheckRun(run)) {
          await cancelAuthorizationDecisions(input.authorizationDecisionStore, turn);
          clearPendingWritePrecheckContinuations(turn.run_id);
          await input.runRecordStore!.cancelRequiresUserActionRun(turn.run_id);
        }
        return input.store!.terminateTaskTurn(threadId, turnId);
      };
      const thread = input.withWritePrecheckRunLock
        ? await input.withWritePrecheckRunLock(turn.run_id, terminate)
        : await terminate();
      return { handled: true, status: 200, body: { ok: true, thread, turn: threadTurn(thread, turnId) } };
    }

    return {
      handled: true,
      status: 405,
      body: { error: { code: "method_not_allowed", message: "Method not allowed for task thread route" } }
    };
  } catch (error) {
    return errorResult(error);
  }
}
