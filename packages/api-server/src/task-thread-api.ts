import { createHash } from "node:crypto";

import {
  TaskThreadStoreError,
  validateTaskTurnInputSnapshot,
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
  validateTask: (body: JsonBody) => Promise<unknown | undefined>;
  submitTask: (body: JsonBody, runClaimToken: string) => Promise<TaskSubmissionHttpResult>;
};

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
  if (error.code === "thread_lock_timeout" || error.code.startsWith("owner_ref_check_unavailable:")) return 503;
  if (error.code.startsWith("owner_ref_unavailable:")) return 409;
  if (error.code === "thread_has_active_turn" || error.code === "idempotency_payload_mismatch" || error.code === "run_id_already_linked" || error.code === "turn_not_active" || error.code === "turn_run_still_active") return 409;
  return 400;
}

function errorResult(error: unknown): TaskThreadApiResult {
  if (!(error instanceof TaskThreadStoreError)) throw error;
  const retryable = error.code === "thread_lock_timeout" || error.code.startsWith("owner_ref_check_unavailable:");
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
      const reserved = await input.store.reserveTaskTurn(threadId, {
        idempotency_key: idempotencyKey,
        request_hash: requestHash(body),
        run_id: runId,
        creation_channel: entrypoint as "api" | "cli" | "mcp" | "sdk" | "app",
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
        submitted = await input.submitTask(body, reserved.run_claim_token);
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
      const thread = await input.store.terminateTaskTurn(threadId, turnId);
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
