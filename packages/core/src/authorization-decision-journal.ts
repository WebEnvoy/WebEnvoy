import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  authorizationTimestamp,
  authorizationDecisionTimeOrderValid,
  isAuthorizationDecisionInvalidationReason,
  normalizeAuthorizationDecisionBase,
  parseAuthorizationDecisionRef,
  type AuthorizationDecisionBase,
  type AuthorizationDecisionInvalidationReason,
  type AuthorizationDecisionSummary
} from "./authorization-decision.js";

export type StoredAuthorizationDecision = {
  request_hash: string;
  commit_state: "prepared" | "committed";
  decision: AuthorizationDecisionBase;
};

export type PreparedAuthorizationDecision = {
  request_hash: string;
  decision: AuthorizationDecisionBase;
};

export type AuthorizationDecisionLifecycleEvent = {
  decision_ref: string;
  invalidated_at: string;
  invalidation_reason: AuthorizationDecisionInvalidationReason;
};

export type AuthorizationDecisionJournal = {
  schema_version: "webenvoy.authorization-decision-journal.v0";
  stream_ref: string;
  decisions: StoredAuthorizationDecision[];
  lifecycle_events: AuthorizationDecisionLifecycleEvent[];
};

export const authorizationDecisionStreamPattern = /^[a-f0-9]{32}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxJournalEntries = 256;

export function emptyAuthorizationDecisionJournal(stream: string): AuthorizationDecisionJournal {
  return {
    schema_version: "webenvoy.authorization-decision-journal.v0",
    stream_ref: stream,
    decisions: [],
    lifecycle_events: []
  };
}

export function authorizationDecisionJournalPath(directory: string, stream: string): string {
  if (!authorizationDecisionStreamPattern.test(stream)) throw new Error("authorization_decision_stream_invalid");
  return join(directory, `${stream}.json`);
}

export function authorizationDecisionJournalLockPath(directory: string, stream: string): string {
  return join(`${directory}.locks`, `${stream}.lock`);
}

function parseStoredDecision(value: unknown, stream: string): StoredAuthorizationDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authorization_decision_journal_invalid");
  const entry = value as Partial<StoredAuthorizationDecision>;
  if (Object.keys(entry).some((key) => !["request_hash", "commit_state", "decision"].includes(key)) ||
    !hashPattern.test(entry.request_hash ?? "") || entry.commit_state !== "prepared" && entry.commit_state !== "committed") {
    throw new Error("authorization_decision_journal_invalid");
  }
  const decision = normalizeAuthorizationDecisionBase(entry.decision);
  if (decision.decision_ref.split(":")[1] !== stream ||
    entry.commit_state === "prepared" && decision.applicability.scope !== "task") {
    throw new Error("authorization_decision_journal_invalid");
  }
  return { request_hash: entry.request_hash!, commit_state: entry.commit_state, decision };
}

function parseLifecycleEvent(value: unknown): AuthorizationDecisionLifecycleEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authorization_decision_journal_invalid");
  const event = value as Partial<AuthorizationDecisionLifecycleEvent>;
  if (Object.keys(event).some((key) => !["decision_ref", "invalidated_at", "invalidation_reason"].includes(key)) ||
    !isAuthorizationDecisionInvalidationReason(event.invalidation_reason)) throw new Error("authorization_decision_journal_invalid");
  return {
    decision_ref: parseAuthorizationDecisionRef(event.decision_ref),
    invalidated_at: authorizationTimestamp(event.invalidated_at, "invalidated_at"),
    invalidation_reason: event.invalidation_reason!
  };
}

function assertJournalRelations(journal: AuthorizationDecisionJournal): void {
  if (new Set(journal.decisions.map((entry) => entry.decision.decision_ref)).size !== journal.decisions.length ||
    new Set(journal.lifecycle_events.map((event) => event.decision_ref)).size !== journal.lifecycle_events.length) {
    throw new Error("authorization_decision_journal_invalid");
  }
  for (const event of journal.lifecycle_events) {
    const decision = journal.decisions.find((entry) => entry.decision.decision_ref === event.decision_ref)?.decision;
    if (!decision || !authorizationDecisionTimeOrderValid({
      decided_at: decision.decided_at,
      expires_at: decision.expires_at,
      invalidated_at: event.invalidated_at
    })) {
      throw new Error("authorization_decision_journal_invalid");
    }
  }
  const first = journal.decisions[0]?.decision;
  if (first) {
    const binding = JSON.stringify({
      subject: authorizationDecisionSubjectBinding(first),
      action_instance_ref: first.business_action?.action_instance_ref ?? null
    });
    if (journal.decisions.some((entry) => JSON.stringify({
      subject: authorizationDecisionSubjectBinding(entry.decision),
      action_instance_ref: entry.decision.business_action?.action_instance_ref ?? null
    }) !== binding)) throw new Error("authorization_decision_journal_invalid");
  }
}

function authorizationDecisionSubjectBinding(decision: AuthorizationDecisionBase): object {
  const { config_refs: _configRefs, ...subject } = decision.applicability;
  return subject;
}

export function parseAuthorizationDecisionJournal(value: unknown, stream: string): AuthorizationDecisionJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authorization_decision_journal_invalid");
  const source = value as Partial<AuthorizationDecisionJournal>;
  if (Object.keys(source).some((key) => !["schema_version", "stream_ref", "decisions", "lifecycle_events"].includes(key)) ||
    source.schema_version !== "webenvoy.authorization-decision-journal.v0" || source.stream_ref !== stream ||
    !Array.isArray(source.decisions) || !Array.isArray(source.lifecycle_events) ||
    source.decisions.length > maxJournalEntries || source.lifecycle_events.length > maxJournalEntries) {
    throw new Error("authorization_decision_journal_invalid");
  }
  const journal = {
    schema_version: "webenvoy.authorization-decision-journal.v0" as const,
    stream_ref: stream,
    decisions: source.decisions.map((entry) => parseStoredDecision(entry, stream)),
    lifecycle_events: source.lifecycle_events.map(parseLifecycleEvent)
  };
  assertJournalRelations(journal);
  return journal;
}

function persistenceError(error: unknown): Error {
  if (error instanceof SyntaxError || error instanceof Error && error.message.includes("authorization_") && error.message.endsWith("_invalid")) {
    return new Error("authorization_decision_journal_invalid");
  }
  return new Error("authorization_decision_persistence_failed");
}

export async function readAuthorizationDecisionJournal(
  directory: string,
  stream: string
): Promise<AuthorizationDecisionJournal> {
  try {
    return parseAuthorizationDecisionJournal(
      JSON.parse(await readFile(authorizationDecisionJournalPath(directory, stream), "utf8")),
      stream
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyAuthorizationDecisionJournal(stream);
    }
    throw persistenceError(error);
  }
}

export async function writeAuthorizationDecisionJournal(
  directory: string,
  journal: AuthorizationDecisionJournal
): Promise<void> {
  parseAuthorizationDecisionJournal(journal, journal.stream_ref);
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `.${journal.stream_ref}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await rename(temp, authorizationDecisionJournalPath(directory, journal.stream_ref));
  } catch {
    throw new Error("authorization_decision_persistence_failed");
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export function authorizationDecisionLifecycle(
  decision: AuthorizationDecisionBase,
  events: readonly AuthorizationDecisionLifecycleEvent[],
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

export function projectAuthorizationDecision(
  decision: AuthorizationDecisionBase,
  events: readonly AuthorizationDecisionLifecycleEvent[],
  now: string
): AuthorizationDecisionSummary {
  return { ...structuredClone(decision), ...authorizationDecisionLifecycle(decision, events, now) };
}

export function authorizationBindingChange(
  previous: AuthorizationDecisionBase,
  next: AuthorizationDecisionBase
): AuthorizationDecisionInvalidationReason | undefined {
  const left = previous.business_action;
  const right = next.business_action;
  if (left?.action_id !== right?.action_id || left?.category !== right?.category) return "action_reclassified";
  if (JSON.stringify(left?.target) !== JSON.stringify(right?.target)) return "target_changed";
  if (JSON.stringify(previous.owner_declaration) !== JSON.stringify(next.owner_declaration)) return "owner_changed";
  if (JSON.stringify(previous.effective_policy) !== JSON.stringify(next.effective_policy) ||
    JSON.stringify(previous.applicability.config_refs) !== JSON.stringify(next.applicability.config_refs)) {
    return "effective_policy_changed";
  }
  return undefined;
}

export function sameConcreteAuthorizationBinding(left: AuthorizationDecisionBase, right: AuthorizationDecisionBase): boolean {
  return JSON.stringify({
    business_action: left.business_action,
    owner_declaration: left.owner_declaration,
    subject: authorizationDecisionSubjectBinding(left)
  }) === JSON.stringify({
    business_action: right.business_action,
    owner_declaration: right.owner_declaration,
    subject: authorizationDecisionSubjectBinding(right)
  });
}

export function visibleAuthorizationDecisionEntries(
  journal: AuthorizationDecisionJournal,
  runDecisionRefs?: readonly string[]
): StoredAuthorizationDecision[] {
  return journal.decisions.filter((entry) => {
    if (entry.decision.applicability.scope === "environment") return entry.commit_state === "committed";
    return entry.commit_state === "committed" && (runDecisionRefs?.includes(entry.decision.decision_ref) ?? false);
  });
}

function latestJournalBoundary(journal: AuthorizationDecisionJournal, observedAt: string): number {
  const observed = Date.parse(observedAt);
  return Math.max(
    Number.NEGATIVE_INFINITY,
    ...journal.decisions.flatMap(({ decision }) => [
      Date.parse(decision.decided_at),
      ...(decision.expires_at !== null && Date.parse(decision.expires_at) <= observed
        ? [Date.parse(decision.expires_at)]
        : [])
    ]),
    ...journal.lifecycle_events
      .filter((event) => Date.parse(event.invalidated_at) <= observed)
      .map((event) => Date.parse(event.invalidated_at))
  );
}

function bindingInvalidations(
  entries: readonly StoredAuthorizationDecision[],
  journal: AuthorizationDecisionJournal,
  next: AuthorizationDecisionBase,
  observedAt: string
) {
  return entries.flatMap(({ decision: previous }) => {
    if (authorizationDecisionLifecycle(previous, journal.lifecycle_events, observedAt).state !== "active") return [];
    const reason = authorizationBindingChange(previous, next);
    return reason ? [{
      decision_ref: previous.decision_ref,
      invalidated_at: next.decided_at,
      invalidation_reason: reason
    }] : [];
  });
}

export function prepareAuthorizationDecisionJournalEntry(
  journal: AuthorizationDecisionJournal,
  prepared: PreparedAuthorizationDecision,
  commitState: StoredAuthorizationDecision["commit_state"],
  visible: readonly StoredAuthorizationDecision[],
  observedAt: string
): AuthorizationDecisionJournal {
  const existing = journal.decisions.find((entry) => entry.decision.decision_ref === prepared.decision.decision_ref);
  if (existing) {
    if (existing.request_hash !== prepared.request_hash) throw new Error("authorization_decision_idempotency_conflict");
    if (JSON.stringify(existing.decision) !== JSON.stringify(prepared.decision)) {
      throw new Error("authorization_decision_journal_invalid");
    }
    return journal;
  }
  const visibleRefs = new Set(visible.map((entry) => entry.decision.decision_ref));
  if (journal.decisions.some((entry) =>
    entry.commit_state === "prepared" && entry.decision.decision_ref !== prepared.decision.decision_ref &&
    !visibleRefs.has(entry.decision.decision_ref)
  )) throw new Error("authorization_decision_pending");
  if (latestJournalBoundary(journal, observedAt) > Date.parse(prepared.decision.decided_at)) {
    throw new Error("authorization_decision_time_conflict");
  }
  if (prepared.decision.effective_policy?.source === "single_action" && journal.decisions.some((entry) =>
    entry.decision.effective_policy?.source === "single_action" &&
    sameConcreteAuthorizationBinding(entry.decision, prepared.decision)
  )) throw new Error("authorization_single_action_already_decided");
  const invalidations = bindingInvalidations(visible, journal, prepared.decision, observedAt);
  assertAuthorizationJournalBudget(journal, invalidations.length);
  return {
    ...journal,
    decisions: [...journal.decisions, { ...prepared, commit_state: commitState }],
    lifecycle_events: commitState === "committed"
      ? [...journal.lifecycle_events, ...invalidations]
      : journal.lifecycle_events
  };
}

export function commitTaskAuthorizationDecisionJournalEntry(
  journal: AuthorizationDecisionJournal,
  decisionRef: string,
  observedAt: string
): AuthorizationDecisionJournal {
  const stored = journal.decisions.find((entry) => entry.decision.decision_ref === decisionRef);
  if (!stored || stored.decision.applicability.scope !== "task") {
    throw new Error("authorization_decision_journal_invalid");
  }
  const priorJournal = {
    ...journal,
    decisions: journal.decisions.filter((entry) => entry.decision.decision_ref !== decisionRef),
    lifecycle_events: journal.lifecycle_events.filter((event) => event.decision_ref !== decisionRef)
  };
  const staleRecovery = latestJournalBoundary(priorJournal, observedAt) > Date.parse(stored.decision.decided_at);
  const naturallyExpired = stored.decision.expires_at !== null &&
    Date.parse(stored.decision.expires_at) <= Date.parse(observedAt);
  const invalidations = bindingInvalidations(
    journal.decisions.filter((entry) => entry.commit_state === "committed"),
    journal,
    stored.decision,
    observedAt
  );
  const staleEvent = staleRecovery && !naturallyExpired &&
    !journal.lifecycle_events.some((event) => event.decision_ref === decisionRef)
    ? [{ decision_ref: decisionRef, invalidated_at: observedAt, invalidation_reason: "expired" as const }]
    : [];
  assertAuthorizationJournalBudget(journal, invalidations.length + staleEvent.length, 0);
  if (stored.commit_state === "committed" && invalidations.length === 0 && staleEvent.length === 0) return journal;
  return {
    ...journal,
    decisions: journal.decisions.map((entry) =>
      entry.decision.decision_ref === decisionRef ? { ...entry, commit_state: "committed" as const } : entry
    ),
    lifecycle_events: [...journal.lifecycle_events, ...invalidations, ...staleEvent]
  };
}

export function assertAuthorizationJournalBudget(
  journal: AuthorizationDecisionJournal,
  addedEvents = 0,
  addedDecisions = 1
): void {
  if (journal.decisions.length + addedDecisions > maxJournalEntries || journal.lifecycle_events.length + addedEvents > maxJournalEntries) {
    throw new Error("authorization_decision_stream_budget_exceeded");
  }
}
