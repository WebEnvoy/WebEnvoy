import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  authorizationTimestamp,
  buildAuthorizationDecisionBase,
  normalizeAuthorizationDecisionBase,
  normalizeAuthorizationDecisionSubject,
  parseAuthorizationDecisionRef,
  type AuthorizationDecisionBase,
  type AuthorizationDecisionInvalidationReason,
  type AuthorizationDecisionSubject,
  type AuthorizationDecisionSummary
} from "./authorization-decision.js";
import { readTrustedExecutionPolicyEvaluation } from "./execution-policy.js";
import { FileOwnershipError, withFileOwnershipLock } from "./file-ownership.js";
import { normalizeNonSensitiveText } from "./sensitive-field-taxonomy.js";
import type { FileRunRecordStore } from "./run-record-store.js";

type StoredDecision = { request_hash: string; decision: AuthorizationDecisionBase };
type LifecycleEvent = {
  decision_ref: string;
  invalidated_at: string;
  invalidation_reason: AuthorizationDecisionInvalidationReason;
};
type DecisionJournal = {
  schema_version: "webenvoy.authorization-decision-journal.v0";
  stream_ref: string;
  decisions: StoredDecision[];
  lifecycle_events: LifecycleEvent[];
};

export type AuthorizationDecisionQuery = {
  decision_ref?: string;
  run_id?: string;
  thread_id?: string;
  turn_id?: string;
  operation_ref?: string;
  state?: AuthorizationDecisionSummary["state"];
  limit?: number;
};

export type FileAuthorizationDecisionStoreOptions = {
  directory: string;
  runRecordStore?: FileRunRecordStore;
  taskThreadStore?: {
    getTaskThread(threadId: string): Promise<{ turns: readonly { turn_id: string; run_id: string }[] } | undefined>;
  };
  clock?: () => Date;
  lockTimeoutMs?: number;
};

export type FileAuthorizationDecisionStore = {
  readonly directory: string;
  recordAuthorizationDecision(input: {
    idempotency_key: string;
    evaluation: unknown;
    subject: AuthorizationDecisionSubject;
    expires_at?: string;
  }): Promise<AuthorizationDecisionSummary>;
  invalidateAuthorizationDecision(
    decisionRef: string,
    reason: AuthorizationDecisionInvalidationReason,
    invalidatedAt?: string
  ): Promise<AuthorizationDecisionSummary>;
  getAuthorizationDecision(decisionRef: string): Promise<AuthorizationDecisionSummary | undefined>;
  listAuthorizationDecisions(query?: AuthorizationDecisionQuery): Promise<AuthorizationDecisionSummary[]>;
};

const streamRefPattern = /^[a-f0-9]{32}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxJournalEntries = 256;
const invalidationReasons = new Set<AuthorizationDecisionInvalidationReason>([
  "completed", "cancelled", "expired", "target_changed", "owner_changed", "action_reclassified", "effective_policy_changed"
]);
const decisionStates = new Set<AuthorizationDecisionSummary["state"]>(["active", "consumed", "invalidated", "expired"]);

function hash(value: string, length = 64): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function idempotencyKey(value: unknown): string {
  const normalized = normalizeNonSensitiveText(value, 128);
  if (!normalized) throw new Error("authorization_idempotency_key_invalid");
  return normalized;
}

function streamRef(subject: AuthorizationDecisionSubject, actionInstanceRef: string | undefined): string {
  return hash(JSON.stringify([subject, actionInstanceRef ?? "system_stop"]), 32);
}

function journalPath(directory: string, stream: string): string {
  if (!streamRefPattern.test(stream)) throw new Error("authorization_decision_stream_invalid");
  return join(directory, `${stream}.json`);
}

function journalLockPath(directory: string, stream: string): string {
  return join(`${directory}.locks`, `${stream}.lock`);
}

function assertJournal(value: unknown, expectedStream: string): DecisionJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authorization_decision_journal_invalid");
  const journal = value as Partial<DecisionJournal>;
  if (Object.keys(journal).some((key) => !["schema_version", "stream_ref", "decisions", "lifecycle_events"].includes(key)) ||
    journal.schema_version !== "webenvoy.authorization-decision-journal.v0" || journal.stream_ref !== expectedStream ||
    !Array.isArray(journal.decisions) || !Array.isArray(journal.lifecycle_events) ||
    journal.decisions.length > maxJournalEntries || journal.lifecycle_events.length > maxJournalEntries) {
    throw new Error("authorization_decision_journal_invalid");
  }
  const decisions = journal.decisions.map((entry) => {
    if (!entry || typeof entry !== "object" || Object.keys(entry).some((key) => key !== "request_hash" && key !== "decision") ||
      !hashPattern.test(entry.request_hash)) {
      throw new Error("authorization_decision_journal_invalid");
    }
    const decision = normalizeAuthorizationDecisionBase(entry.decision);
    if (decision.decision_ref.split(":")[1] !== expectedStream) throw new Error("authorization_decision_journal_invalid");
    return { request_hash: entry.request_hash, decision };
  });
  const lifecycle_events = journal.lifecycle_events.map((event) => {
    if (!event || typeof event !== "object" || Object.keys(event).some((key) => !["decision_ref", "invalidated_at", "invalidation_reason"].includes(key)) ||
      !invalidationReasons.has(event.invalidation_reason)) throw new Error("authorization_decision_journal_invalid");
    return {
      decision_ref: parseAuthorizationDecisionRef(event.decision_ref),
      invalidated_at: authorizationTimestamp(event.invalidated_at, "invalidated_at"),
      invalidation_reason: event.invalidation_reason
    };
  });
  if (new Set(decisions.map((entry) => entry.decision.decision_ref)).size !== decisions.length ||
    new Set(lifecycle_events.map((event) => event.decision_ref)).size !== lifecycle_events.length) {
    throw new Error("authorization_decision_journal_invalid");
  }
  for (const event of lifecycle_events) {
    const decision = decisions.find((entry) => entry.decision.decision_ref === event.decision_ref)?.decision;
    if (!decision || Date.parse(event.invalidated_at) < Date.parse(decision.decided_at)) throw new Error("authorization_decision_journal_invalid");
  }
  return {
    schema_version: "webenvoy.authorization-decision-journal.v0",
    stream_ref: expectedStream,
    decisions,
    lifecycle_events
  };
}

async function readJournal(directory: string, stream: string): Promise<DecisionJournal> {
  try {
    return assertJournal(JSON.parse(await readFile(journalPath(directory, stream), "utf8")), stream);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { schema_version: "webenvoy.authorization-decision-journal.v0", stream_ref: stream, decisions: [], lifecycle_events: [] };
    }
    throw error;
  }
}

async function writeJournal(directory: string, journal: DecisionJournal): Promise<void> {
  assertJournal(journal, journal.stream_ref);
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `.${journal.stream_ref}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  await rename(temp, journalPath(directory, journal.stream_ref));
}

function lifecycle(
  decision: AuthorizationDecisionBase,
  events: readonly LifecycleEvent[],
  now: string
): Pick<AuthorizationDecisionSummary, "state" | "invalidated_at" | "invalidation_reason"> {
  const event = [...events].reverse().find((candidate) =>
    candidate.decision_ref === decision.decision_ref && Date.parse(candidate.invalidated_at) <= Date.parse(now)
  );
  if (event) {
    return {
      state: event.invalidation_reason === "completed" ? "consumed" : event.invalidation_reason === "expired" ? "expired" : "invalidated",
      invalidated_at: event.invalidated_at,
      invalidation_reason: event.invalidation_reason
    };
  }
  if (decision.expires_at !== null && Date.parse(decision.expires_at) <= Date.parse(now)) {
    return { state: "expired", invalidated_at: decision.expires_at, invalidation_reason: "expired" };
  }
  return { state: "active", invalidated_at: null, invalidation_reason: null };
}

function project(decision: AuthorizationDecisionBase, events: readonly LifecycleEvent[], now: string): AuthorizationDecisionSummary {
  return { ...structuredClone(decision), ...lifecycle(decision, events, now) };
}

function changedBindingReason(
  previous: AuthorizationDecisionBase,
  next: AuthorizationDecisionBase
): AuthorizationDecisionInvalidationReason | undefined {
  const left = previous.business_action;
  const right = next.business_action;
  if (left?.action_id !== right?.action_id || left?.category !== right?.category) return "action_reclassified";
  if (JSON.stringify(left?.target) !== JSON.stringify(right?.target)) return "target_changed";
  if (JSON.stringify(previous.owner_declaration) !== JSON.stringify(next.owner_declaration)) return "owner_changed";
  if (JSON.stringify(previous.effective_policy) !== JSON.stringify(next.effective_policy)) return "effective_policy_changed";
  return undefined;
}

function queryMatches(decision: AuthorizationDecisionSummary, query: AuthorizationDecisionQuery): boolean {
  const applies = decision.applicability;
  return (query.decision_ref === undefined || decision.decision_ref === query.decision_ref) &&
    (query.run_id === undefined || applies.scope === "task" && applies.run_id === query.run_id) &&
    (query.thread_id === undefined || applies.scope === "task" && applies.thread_id === query.thread_id) &&
    (query.turn_id === undefined || applies.scope === "task" && applies.turn_id === query.turn_id) &&
    (query.operation_ref === undefined || applies.scope === "environment" && applies.operation_ref === query.operation_ref) &&
    (query.state === undefined || decision.state === query.state);
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("authorization_decision_query_limit_invalid");
  return value;
}

function queryReference(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeNonSensitiveText(value, 512);
  if (!normalized || /^https?:\/\//i.test(normalized)) throw new Error(`${label}_invalid`);
  if (label === "thread_id" && !/^thread_[a-f0-9]{32}$/.test(normalized) ||
    label === "turn_id" && !/^turn_[a-f0-9]{32}$/.test(normalized) ||
    label === "run_id" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
}

function queryState(value: AuthorizationDecisionSummary["state"] | undefined): AuthorizationDecisionSummary["state"] | undefined {
  if (value !== undefined && !decisionStates.has(value)) throw new Error("authorization_decision_state_invalid");
  return value;
}

export function createFileAuthorizationDecisionStore(
  options: FileAuthorizationDecisionStoreOptions
): FileAuthorizationDecisionStore {
  const clock = options.clock ?? (() => new Date());
  const lockTimeoutMs = options.lockTimeoutMs ?? 30_000;

  async function withJournalLock<T>(stream: string, action: () => Promise<T>): Promise<T> {
    try {
      return await withFileOwnershipLock(journalLockPath(options.directory, stream), lockTimeoutMs, action);
    } catch (error) {
      if (error instanceof FileOwnershipError && error.message === "file_lock_timeout") throw new Error("authorization_decision_lock_timeout");
      throw error;
    }
  }

  async function linkTaskDecision(decision: AuthorizationDecisionSummary): Promise<void> {
    if (decision.applicability.scope !== "task") return;
    if (!options.runRecordStore) throw new Error("authorization_run_store_unavailable");
    await options.runRecordStore.appendAuthorizationDecisionRef(decision.applicability.run_id, decision.decision_ref);
  }

  async function validateTaskBinding(subject: AuthorizationDecisionSubject): Promise<void> {
    if (subject.scope !== "task") return;
    if (!options.runRecordStore || !await options.runRecordStore.getRunRecord(subject.run_id)) {
      throw new Error("authorization_run_not_found");
    }
    if (!options.taskThreadStore) return;
    const thread = await options.taskThreadStore.getTaskThread(subject.thread_id);
    const turn = thread?.turns.find((candidate) => candidate.turn_id === subject.turn_id);
    if (!turn || turn.run_id !== subject.run_id) throw new Error("authorization_task_binding_mismatch");
  }

  async function getAuthorizationDecision(decisionRefValue: string): Promise<AuthorizationDecisionSummary | undefined> {
    const decisionRef = parseAuthorizationDecisionRef(decisionRefValue);
    const stream = decisionRef.split(":")[1]!;
    const journal = await readJournal(options.directory, stream);
    const stored = journal.decisions.find((entry) => entry.decision.decision_ref === decisionRef);
    return stored ? project(stored.decision, journal.lifecycle_events, clock().toISOString()) : undefined;
  }

  return {
    directory: options.directory,

    async recordAuthorizationDecision(input) {
      const facts = readTrustedExecutionPolicyEvaluation(input.evaluation);
      if (!facts) throw new Error("authorization_evaluation_untrusted");
      const subject = normalizeAuthorizationDecisionSubject(input.subject);
      await validateTaskBinding(subject);
      const key = idempotencyKey(input.idempotency_key);
      const stream = streamRef(subject, facts.requested_action?.action_instance_ref);
      const decisionRef = `authorization-decision:${stream}:${hash(key, 32)}`;
      const requestHash = hash(JSON.stringify({
        subject,
        evaluation: facts.evaluation,
        requested_action: facts.requested_action ?? null,
        owner_proof: facts.owner_proof ?? null,
        expires_at: input.expires_at ?? null
      }));
      const decidedAt = "evaluated_at" in facts.evaluation ? facts.evaluation.evaluated_at : clock().toISOString();
      const base = buildAuthorizationDecisionBase({
        decision_ref: decisionRef,
        facts,
        subject,
        fallback_decided_at: decidedAt,
        ...(input.expires_at === undefined ? {} : { expires_at: input.expires_at })
      });
      if (Date.parse(base.decided_at) > clock().getTime()) throw new Error("authorization_decision_time_invalid");
      const decision = await withJournalLock(stream, async () => {
        const journal = await readJournal(options.directory, stream);
        const existing = journal.decisions.find((entry) => entry.decision.decision_ref === decisionRef);
        if (existing) {
          if (existing.request_hash !== requestHash) throw new Error("authorization_decision_idempotency_conflict");
          return project(existing.decision, journal.lifecycle_events, clock().toISOString());
        }
        if (journal.decisions.length >= maxJournalEntries) throw new Error("authorization_decision_stream_budget_exceeded");
        if (journal.decisions.some((entry) => Date.parse(entry.decision.decided_at) > Date.parse(base.decided_at))) {
          throw new Error("authorization_decision_time_conflict");
        }
        const invalidations = journal.decisions.flatMap(({ decision: previous }): LifecycleEvent[] => {
          if (lifecycle(previous, journal.lifecycle_events, base.decided_at).state !== "active") return [];
          const reason = changedBindingReason(previous, base);
          return reason ? [{
            decision_ref: previous.decision_ref,
            invalidated_at: base.decided_at,
            invalidation_reason: reason
          }] : [];
        });
        if (journal.lifecycle_events.length + invalidations.length > maxJournalEntries) {
          throw new Error("authorization_decision_stream_budget_exceeded");
        }
        const next: DecisionJournal = {
          ...journal,
          decisions: [...journal.decisions, { request_hash: requestHash, decision: base }],
          lifecycle_events: [...journal.lifecycle_events, ...invalidations]
        };
        await writeJournal(options.directory, next);
        return project(base, next.lifecycle_events, clock().toISOString());
      });
      await linkTaskDecision(decision);
      return decision;
    },

    async invalidateAuthorizationDecision(decisionRefValue, reason, invalidatedAt) {
      const decisionRef = parseAuthorizationDecisionRef(decisionRefValue);
      const stream = decisionRef.split(":")[1]!;
      const observedAt = clock().toISOString();
      const at = authorizationTimestamp(invalidatedAt ?? observedAt, "invalidated_at");
      if (Date.parse(at) > Date.parse(observedAt)) throw new Error("authorization_decision_invalidation_time_invalid");
      return withJournalLock(stream, async () => {
        const journal = await readJournal(options.directory, stream);
        const stored = journal.decisions.find((entry) => entry.decision.decision_ref === decisionRef);
        if (!stored) throw new Error("authorization_decision_not_found");
        const existing = journal.lifecycle_events.find((event) => event.decision_ref === decisionRef);
        if (existing) {
          if (existing.invalidation_reason !== reason || existing.invalidated_at !== at) throw new Error("authorization_decision_state_conflict");
          return project(stored.decision, journal.lifecycle_events, at);
        }
        if (Date.parse(at) < Date.parse(stored.decision.decided_at)) throw new Error("authorization_decision_invalidation_time_invalid");
        const current = lifecycle(stored.decision, journal.lifecycle_events, at);
        if (current.state !== "active") {
          if (current.invalidation_reason === reason && current.invalidated_at === at) return project(stored.decision, journal.lifecycle_events, at);
          throw new Error("authorization_decision_state_conflict");
        }
        const next = { ...journal, lifecycle_events: [...journal.lifecycle_events, { decision_ref: decisionRef, invalidated_at: at, invalidation_reason: reason }] };
        await writeJournal(options.directory, next);
        return project(stored.decision, next.lifecycle_events, at);
      });
    },

    getAuthorizationDecision,

    async listAuthorizationDecisions(query = {}) {
      const limit = normalizedLimit(query.limit);
      const normalizedQuery = {
        ...(query.decision_ref === undefined ? {} : { decision_ref: parseAuthorizationDecisionRef(query.decision_ref) }),
        ...(query.run_id === undefined ? {} : { run_id: queryReference(query.run_id, "run_id")! }),
        ...(query.thread_id === undefined ? {} : { thread_id: queryReference(query.thread_id, "thread_id")! }),
        ...(query.turn_id === undefined ? {} : { turn_id: queryReference(query.turn_id, "turn_id")! }),
        ...(query.operation_ref === undefined ? {} : { operation_ref: queryReference(query.operation_ref, "operation_ref")! }),
        ...(query.state === undefined ? {} : { state: queryState(query.state)! }),
        limit
      };
      await mkdir(options.directory, { recursive: true });
      const files = (await readdir(options.directory)).filter((file) => streamRefPattern.test(basename(file, ".json")) && file.endsWith(".json")).sort();
      const now = clock().toISOString();
      const decisions: AuthorizationDecisionSummary[] = [];
      for (const file of files) {
        const journal = await readJournal(options.directory, basename(file, ".json"));
        decisions.push(...journal.decisions.map((entry) => project(entry.decision, journal.lifecycle_events, now)));
      }
      return decisions.filter((decision) => queryMatches(decision, normalizedQuery)).sort((left, right) =>
        right.decided_at.localeCompare(left.decided_at) || right.decision_ref.localeCompare(left.decision_ref)
      ).slice(0, limit);
    }
  };
}
