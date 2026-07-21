import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { basename } from "node:path";

import {
  authorizationTimestamp,
  buildAuthorizationDecisionBase,
  isAuthorizationDecisionInvalidationReason,
  normalizeAuthorizationDecisionSubject,
  parseAuthorizationDecisionRef,
  type AuthorizationDecisionBase,
  type AuthorizationDecisionInvalidationReason,
  type AuthorizationDecisionSubject,
  type AuthorizationDecisionSummary
} from "./authorization-decision.js";
import {
  authorizationDecisionJournalLockPath,
  authorizationDecisionLifecycle,
  authorizationDecisionStreamPattern,
  prepareAuthorizationDecisionJournalEntry,
  projectAuthorizationDecision,
  readAuthorizationDecisionJournal,
  visibleAuthorizationDecisionEntries,
  writeAuthorizationDecisionJournal,
  type AuthorizationDecisionJournal,
  type PreparedAuthorizationDecision,
  type StoredAuthorizationDecision
} from "./authorization-decision-journal.js";
import {
  loadAuthorizationDecisionCursorSigningKey,
  paginateAuthorizationDecisions,
  prepareAuthorizationDecisionQuery,
  type AuthorizationDecisionPage,
  type AuthorizationDecisionQuery
} from "./authorization-decision-query.js";
import { readTrustedExecutionPolicyEvaluation, type TrustedExecutionPolicyEvaluationFacts } from "./execution-policy.js";
import { FileOwnershipError, withFileOwnershipLock } from "./file-ownership.js";
import { normalizeNonSensitiveText } from "./sensitive-field-taxonomy.js";
import {
  commitRunRecordAuthorizationDecisionRef,
  type FileRunRecordStore
} from "./run-record-store.js";

type TaskThreadReader = {
  getTaskThread(threadId: string): Promise<{
    thread_id: string;
    turns: readonly { turn_id: string; run_id: string }[];
  } | undefined>;
};

export type FileAuthorizationDecisionStoreOptions = {
  directory: string;
  runRecordStore?: FileRunRecordStore;
  taskThreadStore?: TaskThreadReader;
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
  queryAuthorizationDecisions(query?: AuthorizationDecisionQuery): Promise<AuthorizationDecisionPage>;
};

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

function requestHash(
  subject: AuthorizationDecisionSubject,
  facts: TrustedExecutionPolicyEvaluationFacts,
  expiresAt: string | undefined
): string {
  return hash(JSON.stringify({
    subject,
    evaluation: facts.evaluation,
    requested_action: facts.requested_action ?? null,
    owner_proof: facts.owner_proof ?? null,
    expires_at: expiresAt ?? null
  }));
}

function sameSingleActionConsumption(left: AuthorizationDecisionBase, right: AuthorizationDecisionBase): boolean {
  return JSON.stringify({
    business_action: left.business_action,
    owner_declaration: left.owner_declaration
  }) === JSON.stringify({
    business_action: right.business_action,
    owner_declaration: right.owner_declaration
  });
}

class FileAuthorizationDecisionStoreImpl implements FileAuthorizationDecisionStore {
  readonly directory: string;
  private readonly clock: () => Date;
  private readonly lockTimeoutMs: number;
  private cursorSigningKeyPromise?: Promise<Uint8Array>;

  constructor(private readonly options: FileAuthorizationDecisionStoreOptions) {
    this.directory = options.directory;
    this.clock = options.clock ?? (() => new Date());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  }

  private async withJournalLock<T>(stream: string, action: () => Promise<T>): Promise<T> {
    try {
      return await withFileOwnershipLock(
        authorizationDecisionJournalLockPath(this.directory, stream),
        this.lockTimeoutMs,
        action
      );
    } catch (error) {
      if (error instanceof FileOwnershipError && error.message === "file_lock_timeout") {
        throw new Error("authorization_decision_lock_timeout");
      }
      throw error;
    }
  }

  private async withSingleActionLock<T>(action: () => Promise<T>): Promise<T> {
    return this.withJournalLock(hash("single-action-consumption", 32), action);
  }

  private async assertSingleActionGloballyAvailable(prepared: PreparedAuthorizationDecision): Promise<void> {
    if (prepared.decision.effective_policy?.source !== "single_action") return;
    for (const file of await this.journalFiles()) {
      const journal = await readAuthorizationDecisionJournal(this.directory, basename(file, ".json"));
      if (journal.decisions.some((entry) =>
        entry.decision.decision_ref !== prepared.decision.decision_ref &&
        entry.decision.effective_policy?.source === "single_action" &&
        sameSingleActionConsumption(entry.decision, prepared.decision)
      )) throw new Error("authorization_single_action_already_decided");
    }
  }

  private cursorSigningKey(): Promise<Uint8Array> {
    this.cursorSigningKeyPromise ??= loadAuthorizationDecisionCursorSigningKey(this.directory);
    return this.cursorSigningKeyPromise;
  }

  private async validateTaskBinding(subject: AuthorizationDecisionSubject): Promise<void> {
    if (subject.scope !== "task") return;
    if (!this.options.runRecordStore) throw new Error("authorization_run_store_unavailable");
    if (!this.options.taskThreadStore) throw new Error("authorization_task_store_unavailable");
    const run = await this.options.runRecordStore.getRunRecord(subject.run_id);
    if (!run) throw new Error("authorization_run_not_found");
    if (run.run_id !== subject.run_id) throw new Error("authorization_task_binding_mismatch");
    const thread = await this.options.taskThreadStore.getTaskThread(subject.thread_id);
    const turn = thread?.turns.find((candidate) => candidate.turn_id === subject.turn_id);
    if (thread?.thread_id !== subject.thread_id || !turn || turn.run_id !== subject.run_id) {
      throw new Error("authorization_task_binding_mismatch");
    }
  }

  private buildPreparedDecision(input: {
    idempotency_key: string;
    evaluation: unknown;
    subject: AuthorizationDecisionSubject;
    expires_at?: string;
  }): { stream: string; prepared: PreparedAuthorizationDecision } {
    const facts = readTrustedExecutionPolicyEvaluation(input.evaluation);
    if (!facts) throw new Error("authorization_evaluation_untrusted");
    const key = idempotencyKey(input.idempotency_key);
    const stream = streamRef(input.subject, facts.requested_action?.action_instance_ref);
    const decisionRef = `authorization-decision:${stream}:${hash(key, 32)}`;
    const decidedAt = "evaluated_at" in facts.evaluation ? facts.evaluation.evaluated_at : this.clock().toISOString();
    const decision = buildAuthorizationDecisionBase({
      decision_ref: decisionRef,
      facts,
      subject: input.subject,
      fallback_decided_at: decidedAt,
      ...(input.expires_at === undefined ? {} : { expires_at: input.expires_at })
    });
    if (Date.parse(decision.decided_at) > this.clock().getTime()) throw new Error("authorization_decision_time_invalid");
    return { stream, prepared: { request_hash: requestHash(input.subject, facts, input.expires_at), decision } };
  }

  private async recordTaskDecision(
    stream: string,
    prepared: PreparedAuthorizationDecision,
    evaluation: unknown,
    idempotencyKey: string,
    expiresAt: string | undefined
  ): Promise<void> {
    const applicability = prepared.decision.applicability;
    if (applicability.scope !== "task" || !this.options.runRecordStore) throw new Error("authorization_run_store_unavailable");
    await commitRunRecordAuthorizationDecisionRef(
      this.options.runRecordStore,
      applicability.run_id,
      this.directory,
      stream,
      prepared,
      this.clock().toISOString(),
      evaluation,
      idempotencyKey,
      expiresAt
    );
  }

  private async recordEnvironmentDecision(stream: string, prepared: PreparedAuthorizationDecision): Promise<void> {
    await this.withJournalLock(stream, async () => {
      const journal = await readAuthorizationDecisionJournal(this.directory, stream);
      const visible = visibleAuthorizationDecisionEntries(journal);
      const next = prepareAuthorizationDecisionJournalEntry(
        journal,
        prepared,
        "committed",
        visible,
        this.clock().toISOString()
      );
      if (next !== journal) await writeAuthorizationDecisionJournal(this.directory, next);
    });
  }

  private async visibleJournalEntries(journal: AuthorizationDecisionJournal): Promise<StoredAuthorizationDecision[]> {
    const task = journal.decisions.find((entry) => entry.decision.applicability.scope === "task")?.decision.applicability;
    if (!task || task.scope !== "task") return visibleAuthorizationDecisionEntries(journal);
    if (!this.options.runRecordStore) throw new Error("authorization_run_store_unavailable");
    const runRecord = await this.options.runRecordStore.getRunRecord(task.run_id).catch(() => {
      throw new Error("authorization_decision_persistence_failed");
    });
    if (!runRecord || runRecord.run_id !== task.run_id) throw new Error("authorization_decision_journal_invalid");
    return visibleAuthorizationDecisionEntries(journal, runRecord.authorization_decision_refs);
  }

  async getAuthorizationDecision(decisionRefValue: string): Promise<AuthorizationDecisionSummary | undefined> {
    const decisionRef = parseAuthorizationDecisionRef(decisionRefValue);
    const stream = decisionRef.split(":")[1]!;
    const journal = await readAuthorizationDecisionJournal(this.directory, stream);
    const stored = (await this.visibleJournalEntries(journal)).find((entry) => entry.decision.decision_ref === decisionRef);
    return stored ? projectAuthorizationDecision(stored.decision, journal.lifecycle_events, this.clock().toISOString()) : undefined;
  }

  private async journalFiles(): Promise<string[]> {
    await mkdir(this.directory, { recursive: true });
    return (await readdir(this.directory))
      .filter((file) => file.endsWith(".json") && authorizationDecisionStreamPattern.test(basename(file, ".json")))
      .sort();
  }

  async queryAuthorizationDecisions(query: AuthorizationDecisionQuery = {}): Promise<AuthorizationDecisionPage> {
    const signingKey = await this.cursorSigningKey();
    const context = prepareAuthorizationDecisionQuery(query, this.clock().toISOString(), signingKey);
    try {
      const decisions: AuthorizationDecisionSummary[] = [];
      for (const file of await this.journalFiles()) {
        const journal = await readAuthorizationDecisionJournal(this.directory, basename(file, ".json"));
        const visible = await this.visibleJournalEntries(journal);
        decisions.push(...visible.map((entry) =>
          projectAuthorizationDecision(entry.decision, journal.lifecycle_events, context.observed_at)
        ));
      }
      return paginateAuthorizationDecisions(decisions, context, signingKey);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("authorization_")) throw error;
      throw new Error("authorization_decision_persistence_failed");
    }
  }

  async invalidateAuthorizationDecision(
    decisionRefValue: string,
    reason: AuthorizationDecisionInvalidationReason,
    invalidatedAt?: string
  ): Promise<AuthorizationDecisionSummary> {
    if (!isAuthorizationDecisionInvalidationReason(reason)) throw new Error("authorization_decision_invalidation_reason_invalid");
    const decisionRef = parseAuthorizationDecisionRef(decisionRefValue);
    const stream = decisionRef.split(":")[1]!;
    const observedAt = this.clock().toISOString();
    const at = authorizationTimestamp(invalidatedAt ?? observedAt, "invalidated_at");
    if (Date.parse(at) > Date.parse(observedAt)) throw new Error("authorization_decision_invalidation_time_invalid");
    return this.withJournalLock(stream, async () => {
      const journal = await readAuthorizationDecisionJournal(this.directory, stream);
      const stored = (await this.visibleJournalEntries(journal)).find((entry) => entry.decision.decision_ref === decisionRef);
      if (!stored) throw new Error("authorization_decision_not_found");
      const existing = journal.lifecycle_events.find((event) => event.decision_ref === decisionRef);
      if (existing) {
        if (existing.invalidation_reason !== reason || existing.invalidated_at !== at) throw new Error("authorization_decision_state_conflict");
        return projectAuthorizationDecision(stored.decision, journal.lifecycle_events, observedAt);
      }
      if (Date.parse(at) < Date.parse(stored.decision.decided_at)) throw new Error("authorization_decision_invalidation_time_invalid");
      const current = authorizationDecisionLifecycle(stored.decision, journal.lifecycle_events, observedAt);
      if (current.state !== "active" && !(current.invalidation_reason === reason && current.invalidated_at === at)) {
        throw new Error("authorization_decision_state_conflict");
      }
      const next = {
        ...journal,
        lifecycle_events: [...journal.lifecycle_events, { decision_ref: decisionRef, invalidated_at: at, invalidation_reason: reason }]
      };
      await writeAuthorizationDecisionJournal(this.directory, next);
      return projectAuthorizationDecision(stored.decision, next.lifecycle_events, observedAt);
    });
  }

  async recordAuthorizationDecision(input: {
    idempotency_key: string;
    evaluation: unknown;
    subject: AuthorizationDecisionSubject;
    expires_at?: string;
  }): Promise<AuthorizationDecisionSummary> {
    const subject = normalizeAuthorizationDecisionSubject(input.subject);
    await this.validateTaskBinding(subject);
    const { stream, prepared } = this.buildPreparedDecision({ ...input, subject });
    const record = async () => {
      if (subject.scope === "task") {
        await this.recordTaskDecision(stream, prepared, input.evaluation, input.idempotency_key, input.expires_at);
      }
      else await this.recordEnvironmentDecision(stream, prepared);
    };
    if (prepared.decision.effective_policy?.source === "single_action") {
      await this.withSingleActionLock(async () => {
        await this.assertSingleActionGloballyAvailable(prepared);
        await record();
      });
    } else {
      await record();
    }
    const decision = await this.getAuthorizationDecision(prepared.decision.decision_ref);
    if (!decision) throw new Error("authorization_decision_persistence_failed");
    return decision;
  }
}

export function createFileAuthorizationDecisionStore(
  options: FileAuthorizationDecisionStoreOptions
): FileAuthorizationDecisionStore {
  return new FileAuthorizationDecisionStoreImpl(options);
}

export type { AuthorizationDecisionPage, AuthorizationDecisionQuery } from "./authorization-decision-query.js";
