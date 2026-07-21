import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type RunRecordStatus } from "./run-record-store.js";
import { FileOwnershipError, withFileOwnershipLock } from "./file-ownership.js";
import {
  requireIdentifier,
  requireText,
  taskTurnInputSchemaVersion,
  TaskThreadStoreError,
  validatePersistedTaskTurnInputSnapshot,
  validateTaskTurnInputSnapshot,
  type TaskTurnFieldKind,
  type TaskTurnInputField,
  type TaskTurnInputSnapshot
} from "./task-turn-input.js";
import { validateTaskTurnInputAgainstPolicy } from "./task-turn-input-policy.js";
import {
  taskThreadSchemaVersion,
  taskThreadStoreSchemaVersion,
  type FileTaskThreadStore,
  type FileTaskThreadStoreOptions,
  type TaskThreadRecord,
  type TaskThreadView,
  type TaskTurnInputGap,
  type TaskTurnRecord,
  type TaskTurnStatus,
  type TaskTurnSubmissionError,
  type TaskTurnView
} from "./task-thread-types.js";
export {
  taskTurnInputConsumerBoundary,
  taskTurnInputSchemaVersion,
  TaskThreadStoreError,
  validateTaskTurnInputSnapshot,
  type TaskTurnFieldKind,
  type TaskTurnInputField,
  type TaskTurnInputSnapshot
} from "./task-turn-input.js";

export {
  taskThreadSchemaVersion,
  type FileTaskThreadStore,
  type FileTaskThreadStoreOptions,
  type ReserveTaskTurnInput,
  type TaskThreadRecord,
  type TaskThreadView,
  type TaskTurnInputGap,
  type TaskTurnRecord,
  type TaskTurnStatus,
  type TaskTurnSubmissionError,
  type TaskTurnView
} from "./task-thread-types.js";

const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const capabilityRefPattern = /^lode:capability\/[A-Za-z0-9][A-Za-z0-9._~/-]{0,2030}$/;
const packageRefPattern = /^lode:\/\/site-capability\/[A-Za-z0-9][A-Za-z0-9._~/-]{0,1980}@[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const canonicalIdentityEnvironmentRefPattern = /^identity-env_[a-f0-9]{24}$/;
// The colon form is read-compatible only; new threads require Harbor's canonical owner ref.
const legacyIdentityEnvironmentRefPattern = /^identity-env:(?=.{1,2031}$)[A-Za-z0-9][A-Za-z0-9._~-]{0,2030}(?:[/:][A-Za-z0-9][A-Za-z0-9._~-]{0,2030})*$/;
const sensitiveIdentityEnvironmentRefPattern = /(?:credential|password|secret|token|cookie)/i;
const ownerRefCheckConcurrency = 8;
function requireThreadBindingRef(value: unknown, label: string, pattern: RegExp): string {
  const ref = requireText(value, label, 2048);
  if (!pattern.test(ref)) throw new TaskThreadStoreError(`${label}_invalid`);
  return ref;
}

function requireIdentityEnvironmentRef(value: unknown): string {
  const ref = requireText(value, "identity_environment_ref", 2048);
  if (!canonicalIdentityEnvironmentRefPattern.test(ref) && !legacyIdentityEnvironmentRefPattern.test(ref)) {
    throw new TaskThreadStoreError("identity_environment_ref_invalid");
  }
  if (sensitiveIdentityEnvironmentRefPattern.test(ref)) throw new TaskThreadStoreError("identity_environment_ref_invalid");
  return ref;
}

function taskThreadId(capabilityRef: string, identityEnvironmentRef: string): string {
  const digest = createHash("sha256")
    .update(`${capabilityRef}\u0000${identityEnvironmentRef}`)
    .digest("hex")
    .slice(0, 32);
  return `thread_${digest}`;
}

function threadPath(directory: string, threadId: string): string {
  return join(directory, `${requireIdentifier(threadId, "thread_id")}.json`);
}

async function readThread(path: string): Promise<TaskThreadRecord | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as TaskThreadRecord;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertThread(thread: TaskThreadRecord): void {
  if (thread.schema_version !== taskThreadStoreSchemaVersion) throw new TaskThreadStoreError("thread_schema_unsupported");
  requireIdentifier(thread.thread_id, "thread_id");
  requireThreadBindingRef(thread.capability_ref, "capability_ref", capabilityRefPattern);
  requireIdentityEnvironmentRef(thread.identity_environment_ref);
  requireText(thread.created_at, "created_at");
  requireText(thread.updated_at, "updated_at");
  let expectedSequence = 1;
  const turnIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const turn of thread.turns) {
    if (turn.sequence !== expectedSequence) throw new TaskThreadStoreError("turn_sequence_invalid");
    expectedSequence += 1;
    requireIdentifier(turn.turn_id, "turn_id");
    requireIdentifier(turn.idempotency_key, "idempotency_key");
    requireIdentifier(turn.run_id, "run_id");
    requireText(turn.request_hash, "request_hash");
    requireText(turn.created_at, "turn_created_at");
    requireText(turn.updated_at, "turn_updated_at");
    if (!["api", "cli", "mcp", "sdk", "app"].includes(turn.creation_channel)) {
      throw new TaskThreadStoreError("creation_channel_invalid");
    }
    if (!["submitting", "accepted", "rejected"].includes(turn.submission_state)) {
      throw new TaskThreadStoreError("submission_state_invalid");
    }
    if (turn.failure_code !== undefined) requireText(turn.failure_code, "failure_code");
    if (turn.submission_error !== undefined) normalizeSubmissionError(turn.submission_error);
    if (turn.terminated_at !== undefined) requireText(turn.terminated_at, "terminated_at");
    requireText(turn.run_claim_token, "run_claim_token");
    if ((turn.submission_http_status === undefined) !== (turn.submission_ok === undefined)) {
      throw new TaskThreadStoreError("submission_response_invalid");
    }
    if (turn.submission_http_status !== undefined && (!Number.isInteger(turn.submission_http_status) || turn.submission_http_status < 100 || turn.submission_http_status > 599)) {
      throw new TaskThreadStoreError("submission_http_status_invalid");
    }
    if (turn.submission_ok !== undefined && typeof turn.submission_ok !== "boolean") {
      throw new TaskThreadStoreError("submission_ok_invalid");
    }
    validatePersistedTaskTurnInputSnapshot(turn.input);
    if (turnIds.has(turn.turn_id)) throw new TaskThreadStoreError("turn_id_duplicate");
    if (idempotencyKeys.has(turn.idempotency_key)) throw new TaskThreadStoreError("idempotency_key_duplicate");
    turnIds.add(turn.turn_id);
    idempotencyKeys.add(turn.idempotency_key);
  }
}

function normalizeSubmissionError(value: unknown): TaskTurnSubmissionError {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskThreadStoreError("submission_error_invalid");
  const error = value as Record<string, unknown>;
  return {
    category: requireText(error.category, "submission_error_category", 128),
    code: requireText(error.code, "submission_error_code", 256),
    phase: requireText(error.phase, "submission_error_phase", 128),
    recovery_hint: requireText(error.recovery_hint, "submission_error_recovery_hint", 256)
  };
}

async function writeThread(directory: string, thread: TaskThreadRecord): Promise<void> {
  assertThread(thread);
  await mkdir(directory, { recursive: true });
  const target = threadPath(directory, thread.thread_id);
  const temp = join(directory, `.${thread.thread_id}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(thread, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

function mapRunStatus(status: RunRecordStatus): TaskTurnStatus {
  if (status === "pending" || status === "admitted") return "accepted";
  if (status === "running") return "running";
  if (status === "requires_user_action") return "waiting_for_user";
  if (status === "succeeded") return "completed";
  if (status === "cancelled" || status === "expired") return "cancelled";
  if (status === "unknown_outcome" || status === "manual_recovery_required") return "status_unknown";
  return "failed";
}

function statusKeepsThreadLocked(status: TaskTurnStatus): boolean {
  return status === "submitting" || status === "accepted" || status === "running" || status === "waiting_for_user" || status === "status_unknown";
}

async function withFileLock<T>(directory: string, key: string, timeoutMs: number, action: () => Promise<T>): Promise<T> {
  try {
    return await withFileOwnershipLock(join(directory, ".locks", `${key}.lock`), timeoutMs, action);
  } catch (error) {
    if (error instanceof FileOwnershipError && error.message === "file_lock_timeout") throw new TaskThreadStoreError("thread_lock_timeout");
    throw error;
  }
}

export function createFileTaskThreadStore(options: FileTaskThreadStoreOptions): FileTaskThreadStore {
  const clock = options.clock ?? (() => new Date());
  const lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  const ownerRefCheckTimeoutMs = options.ownerRefCheckTimeoutMs ?? 5_000;
  let activeOwnerRefChecks = 0;
  const ownerRefCheckWaiters: Array<{
    deadline: number;
    resolve: (acquired: boolean) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }> = [];

  async function acquireOwnerRefCheck(deadline: number): Promise<boolean> {
    if (Date.now() >= deadline) return false;
    if (activeOwnerRefChecks < ownerRefCheckConcurrency) {
      activeOwnerRefChecks += 1;
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const waiter: (typeof ownerRefCheckWaiters)[number] = {
        deadline,
        resolve
      };
      ownerRefCheckWaiters.push(waiter);
      waiter.timeout = setTimeout(() => {
        const index = ownerRefCheckWaiters.indexOf(waiter);
        if (index < 0) return;
        ownerRefCheckWaiters.splice(index, 1);
        resolve(false);
      }, Math.max(0, deadline - Date.now()));
    });
  }

  function releaseOwnerRefCheck(): void {
    while (ownerRefCheckWaiters.length > 0) {
      const next = ownerRefCheckWaiters.shift();
      if (!next) continue;
      if (next.timeout) clearTimeout(next.timeout);
      if (Date.now() >= next.deadline) {
        next.resolve(false);
        continue;
      }
      next.resolve(true);
      return;
    }
    activeOwnerRefChecks -= 1;
  }

  async function checkOwnerRef(ownerRef: string): Promise<boolean | undefined> {
    if (!options.checkOwnerRef) return undefined;
    const deadline = Date.now() + ownerRefCheckTimeoutMs;
    if (!await acquireOwnerRefCheck(deadline)) return undefined;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      releaseOwnerRefCheck();
      return undefined;
    }
    const check = Promise.resolve()
      .then(() => options.checkOwnerRef!(ownerRef))
      .catch(() => undefined)
      .finally(releaseOwnerRefCheck);
    let timeout: number | undefined;
    try {
      return await Promise.race([
        check,
        new Promise<undefined>((resolve) => { timeout = setTimeout(resolve, remainingMs); })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function inputGaps(
    input: TaskTurnInputSnapshot,
    availability = new Map<string, Promise<boolean | undefined>>()
  ): Promise<TaskTurnInputGap[]> {
    if (!options.checkOwnerRef) return [];
    const refs = [
      ...input.fields.flatMap((field) => field.owner_ref === undefined ? [] : [{ ref: field.owner_ref, location: `field:${field.field_id}` as const, attachment: field.kind === "attachment" || field.kind === "file" }]),
      ...(input.attachment_refs ?? []).map((ref, index) => ({ ref, location: `attachment:${index}` as const, attachment: true }))
    ];
    const uniqueRefs = [...new Set(refs.map((item) => item.ref))];
    for (const ref of uniqueRefs) {
      if (!availability.has(ref)) availability.set(ref, checkOwnerRef(ref));
    }
    const checked = new Map(await Promise.all(uniqueRefs.map(async (ref) => [
      ref,
      await availability.get(ref)
    ] as const)));
    const gaps = refs.map((item): TaskTurnInputGap | undefined => {
      const available = checked.get(item.ref);
      if (available === true) return undefined;
      return {
        location: item.location,
        code: available === false ? "owner_ref_unavailable" : "owner_ref_check_unavailable",
        recovery_action: available === false
          ? item.attachment ? "reselect_attachment" : "restore_owner_content"
          : "retry_owner_check"
      };
    });
    return gaps.filter((gap): gap is TaskTurnInputGap => gap !== undefined);
  }

  async function assertInputRefsAvailable(
    input: TaskTurnInputSnapshot,
    availability: Map<string, Promise<boolean | undefined>>
  ): Promise<void> {
    const [gap] = await inputGaps(input, availability);
    if (gap) throw new TaskThreadStoreError(`${gap.code}:${gap.location}`);
  }

  async function turnState(turn: TaskTurnRecord): Promise<{
    status: TaskTurnStatus;
    runStatus?: RunRecordStatus;
    runFailure?: TaskTurnSubmissionError;
    updatedAt?: string;
    terminalAt?: string;
    authorizationDecisionRefs?: string[];
  }> {
    const run = await options.runRecordStore.getRunRecord(turn.run_id);
    let status: TaskTurnStatus;
    if (turn.terminated_at) status = "cancelled";
    else if (turn.submission_state === "rejected") status = "failed";
    else if (run) status = mapRunStatus(run.status);
    else if (turn.submission_state === "submitting") {
      const claim = await options.runRecordStore.getRunIdClaim(turn.run_id);
      status = claim?.owner_alive ? "submitting" : "status_unknown";
    } else status = "status_unknown";
    return {
      status,
      ...(run?.status === undefined ? {} : { runStatus: run.status }),
      ...(run?.failure === undefined ? {} : { runFailure: normalizeSubmissionError(run.failure) }),
      ...(run?.updated_at === undefined ? {} : { updatedAt: run.updated_at }),
      ...(run?.terminal_at === undefined ? {} : { terminalAt: run.terminal_at }),
      ...(run?.authorization_decision_refs === undefined ? {} : { authorizationDecisionRefs: [...run.authorization_decision_refs] })
    };
  }

  async function turnView(
    turn: TaskTurnRecord,
    availability: Map<string, Promise<boolean | undefined>>
  ): Promise<TaskTurnView> {
    const [state, gaps] = await Promise.all([turnState(turn), inputGaps(turn.input, availability)]);
    const {
      request_hash: _requestHash,
      run_claim_token: _runClaimToken,
      submission_http_status: _submissionHttpStatus,
      submission_ok: _submissionOk,
      ...publicTurn
    } = turn;
    const submissionError = turn.submission_error ?? state.runFailure;
    const failureCode = turn.failure_code ?? submissionError?.code;
    return {
      ...publicTurn,
      ...(failureCode === undefined ? {} : { failure_code: failureCode }),
      ...(submissionError === undefined ? {} : { submission_error: submissionError }),
      submission_state: state.runStatus !== undefined && turn.submission_state === "submitting"
        ? "accepted"
        : turn.submission_state,
      updated_at: state.updatedAt && state.updatedAt > turn.updated_at ? state.updatedAt : turn.updated_at,
      status: state.status,
      ...(gaps.length === 0 ? {} : { input_gaps: gaps }),
      ...(state.runStatus === undefined ? {} : { run_status: state.runStatus }),
      ...(state.terminalAt === undefined ? {} : { terminal_at: state.terminalAt }),
      ...(state.authorizationDecisionRefs === undefined ? {} : { authorization_decision_refs: state.authorizationDecisionRefs })
    };
  }

  async function project(
    thread: TaskThreadRecord,
    availability = new Map<string, Promise<boolean | undefined>>()
  ): Promise<TaskThreadView> {
    const { schema_version: _storeSchemaVersion, ...publicThread } = thread;
    const turns = await Promise.all(thread.turns.map((turn) => turnView(turn, availability)));
    const updatedAt = turns.reduce(
      (latest, turn) => turn.updated_at > latest ? turn.updated_at : latest,
      thread.updated_at
    );
    return {
      ...publicThread,
      schema_version: taskThreadSchemaVersion,
      updated_at: updatedAt,
      turns
    };
  }

  async function getRecord(threadId: string): Promise<TaskThreadRecord | undefined> {
    const thread = await readThread(threadPath(options.directory, threadId));
    if (thread) assertThread(thread);
    return thread;
  }

  async function hasPersistedRunId(runId: string): Promise<boolean> {
    await mkdir(options.directory, { recursive: true });
    for (const name of (await readdir(options.directory)).filter((entry) => entry.endsWith(".json"))) {
      const thread = await getRecord(basename(name, ".json"));
      if (thread?.turns.some((turn) => turn.run_id === runId)) return true;
    }
    return false;
  }

  async function claimRunIdForTurn(runId: string, ownerRef: string): Promise<string | undefined> {
    let token = await options.runRecordStore.claimRunId(runId, ownerRef);
    if (token) return token;
    const claim = await options.runRecordStore.getRunIdClaim(runId);
    if (!claim || claim.owner_alive || await hasPersistedRunId(runId)) return undefined;
    if (await options.runRecordStore.recoverRunIdClaim(runId, claim.owner_ref)) {
      token = await options.runRecordStore.claimRunId(runId, ownerRef);
    }
    return token;
  }

  async function reservationView(
    thread: TaskThreadRecord,
    turn: TaskTurnRecord,
    replayed: boolean,
    runClaimToken?: string,
    availability = new Map<string, Promise<boolean | undefined>>()
  ) {
    const view = await project(thread, availability);
    const publicTurn = view.turns.find((candidate) => candidate.turn_id === turn.turn_id);
    if (!publicTurn) throw new TaskThreadStoreError("turn_sequence_invalid");
    return {
      thread: view,
      turn: publicTurn,
      replayed,
      ...(runClaimToken === undefined ? {} : { run_claim_token: runClaimToken }),
      ...(turn.submission_http_status === undefined || turn.submission_ok === undefined
        ? {}
        : { replay_response: {
            status: turn.submission_http_status,
            ok: turn.submission_ok,
            ...(turn.submission_error === undefined ? {} : { error: turn.submission_error })
          } })
    };
  }

  return {
    directory: options.directory,

    async createOrGetTaskThread(input) {
      const capabilityRef = requireThreadBindingRef(input.capability_ref, "capability_ref", capabilityRefPattern);
      const identityRef = requireIdentityEnvironmentRef(input.identity_environment_ref);
      const canCreate = canonicalIdentityEnvironmentRefPattern.test(identityRef);
      const threadId = taskThreadId(capabilityRef, identityRef);
      const result = await withFileLock(options.directory, threadId, lockTimeoutMs, async () => {
        const existing = await getRecord(threadId);
        if (existing) {
          if (existing.capability_ref !== capabilityRef || existing.identity_environment_ref !== identityRef) {
            throw new TaskThreadStoreError("thread_binding_mismatch");
          }
          return { record: existing, created: false };
        }
        if (!canCreate) throw new TaskThreadStoreError("identity_environment_ref_invalid");
        const now = clock().toISOString();
        const thread: TaskThreadRecord = {
          schema_version: taskThreadStoreSchemaVersion,
          thread_id: threadId,
          capability_ref: capabilityRef,
          identity_environment_ref: identityRef,
          created_at: now,
          updated_at: now,
          turns: []
        };
        await writeThread(options.directory, thread);
        return { record: thread, created: true };
      });
      return { thread: await project(result.record), created: result.created };
    },

    async getTaskThread(threadId) {
      const thread = await getRecord(threadId);
      return thread ? project(thread) : undefined;
    },

    async listTaskThreads() {
      await mkdir(options.directory, { recursive: true });
      const names = (await readdir(options.directory)).filter((name) => name.endsWith(".json")).sort();
      const threads: TaskThreadView[] = [];
      const availability = new Map<string, Promise<boolean | undefined>>();
      for (const name of names) {
        const thread = await getRecord(basename(name, ".json"));
        if (thread) threads.push(await project(thread, availability));
      }
      return threads.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    },

    async withNextTurnPolicyBoundary(threadId, action) {
      return withFileLock(options.directory, threadId, lockTimeoutMs, async () => {
        const thread = await getRecord(threadId);
        if (!thread) throw new TaskThreadStoreError("thread_not_found");
        return action({
          thread: await project(thread),
          next_turn_sequence: thread.turns.length + 1
        });
      });
    },

    async reserveTaskTurn(threadId, input) {
      const idempotencyKey = requireIdentifier(input.idempotency_key, "idempotency_key");
      const requestHash = requireText(input.request_hash, "request_hash");
      const runId = requireText(input.run_id, "run_id", 128);
      const packageRef = requireThreadBindingRef(input.package_ref, "package_ref", packageRefPattern);
      if (!runIdPattern.test(runId)) throw new TaskThreadStoreError("run_id_invalid");
      const initial = await getRecord(threadId);
      if (!initial) throw new TaskThreadStoreError("thread_not_found");
      const initialReplay = initial.turns.find((turn) => turn.idempotency_key === idempotencyKey);
      if (initialReplay) {
        if (initialReplay.request_hash !== requestHash) throw new TaskThreadStoreError("idempotency_payload_mismatch");
        return reservationView(initial, initialReplay, true);
      }
      const shapeInput = validateTaskTurnInputSnapshot(input.input);
      const availability = new Map<string, Promise<boolean | undefined>>();
      let validatedInput: TaskTurnInputSnapshot;
      try {
        if (!options.resolveInputPolicy) throw new TaskThreadStoreError("lode_input_policy_unavailable");
        const inputPolicy = await options.resolveInputPolicy({
          package_ref: packageRef,
          capability_ref: initial.capability_ref
        });
        if (inputPolicy.package_ref !== packageRef || inputPolicy.capability_ref !== initial.capability_ref) {
          throw new TaskThreadStoreError("input_capability_mismatch");
        }
        validatedInput = validateTaskTurnInputAgainstPolicy(shapeInput, inputPolicy);
        await assertInputRefsAvailable(validatedInput, availability);
      } catch (error) {
        const latest = await getRecord(threadId);
        const replay = latest?.turns.find((turn) => turn.idempotency_key === idempotencyKey);
        if (latest && replay) {
          if (replay.request_hash !== requestHash) throw new TaskThreadStoreError("idempotency_payload_mismatch");
          return reservationView(latest, replay, true, undefined, availability);
        }
        throw error;
      }
      const reserved = await withFileLock(options.directory, threadId, lockTimeoutMs, async () => {
        const thread = await getRecord(threadId);
        if (!thread) throw new TaskThreadStoreError("thread_not_found");
        const replay = thread.turns.find((turn) => turn.idempotency_key === idempotencyKey);
        if (replay) {
          if (replay.request_hash !== requestHash) throw new TaskThreadStoreError("idempotency_payload_mismatch");
          return { record: thread, turn: replay, replayed: true };
        }
        if (thread.turns.some((turn) => turn.run_id === runId)) {
          throw new TaskThreadStoreError("run_id_already_linked");
        }
        for (const turn of thread.turns) {
          if (statusKeepsThreadLocked((await turnState(turn)).status)) throw new TaskThreadStoreError("thread_has_active_turn");
        }
        const turnId = `turn_${randomUUID().replaceAll("-", "")}`;
        const runClaimToken = await claimRunIdForTurn(runId, `thread:${threadId}:turn:${turnId}`);
        if (!runClaimToken) throw new TaskThreadStoreError("run_id_already_linked");
        const now = clock().toISOString();
        const turn: TaskTurnRecord = {
          turn_id: turnId,
          sequence: thread.turns.length + 1,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          run_id: runId,
          creation_channel: input.creation_channel,
          input: validatedInput,
          created_at: now,
          updated_at: now,
          submission_state: "submitting",
          run_claim_token: runClaimToken
        };
        const next = { ...thread, updated_at: now, turns: [...thread.turns, turn] };
        try {
          await writeThread(options.directory, next);
        } catch (error) {
          await options.runRecordStore.releaseRunIdClaim(runId, runClaimToken);
          throw error;
        }
        return { record: next, turn, replayed: false, run_claim_token: runClaimToken };
      });
      return reservationView(reserved.record, reserved.turn, reserved.replayed, reserved.run_claim_token, availability);
    },

    async recordTaskTurnSubmission(threadId, turnId, input) {
      const record = await withFileLock(options.directory, threadId, lockTimeoutMs, async () => {
        const thread = await getRecord(threadId);
        if (!thread) throw new TaskThreadStoreError("thread_not_found");
        const index = thread.turns.findIndex((turn) => turn.turn_id === turnId);
        if (index < 0) throw new TaskThreadStoreError("turn_not_found");
        const current = thread.turns[index];
        if (!current) throw new TaskThreadStoreError("turn_not_found");
        if (current.submission_state !== "submitting") return thread;
        const updated: TaskTurnRecord = {
          ...current,
          submission_state: input.accepted ? "accepted" : "rejected",
          updated_at: clock().toISOString(),
          submission_http_status: input.http_status,
          submission_ok: input.ok,
          ...(input.failure_code === undefined ? {} : { failure_code: requireText(input.failure_code, "failure_code") }),
          ...(input.error === undefined ? {} : { submission_error: normalizeSubmissionError(input.error) })
        };
        const now = updated.updated_at;
        const turns = [...thread.turns];
        turns[index] = updated;
        const next = { ...thread, updated_at: now, turns };
        await writeThread(options.directory, next);
        return next;
      });
      return project(record);
    },

    async terminateTaskTurn(threadId, turnId) {
      const record = await withFileLock(options.directory, threadId, lockTimeoutMs, async () => {
        const thread = await getRecord(threadId);
        if (!thread) throw new TaskThreadStoreError("thread_not_found");
        const index = thread.turns.findIndex((turn) => turn.turn_id === turnId);
        if (index < 0) throw new TaskThreadStoreError("turn_not_found");
        const current = thread.turns[index];
        if (!current) throw new TaskThreadStoreError("turn_not_found");
        const state = await turnState(current);
        if (!statusKeepsThreadLocked(state.status)) return thread;
        if (state.status !== "status_unknown" && state.status !== "waiting_for_user") {
          throw new TaskThreadStoreError("turn_run_still_active");
        }
        const now = clock().toISOString();
        const turns = [...thread.turns];
        turns[index] = { ...current, updated_at: now, terminated_at: now };
        const next = { ...thread, updated_at: now, turns };
        await writeThread(options.directory, next);
        return next;
      });
      return project(record);
    }
  };
}
