import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  authorizationTimestamp,
  parseAuthorizationDecisionRef,
  type AuthorizationDecisionSummary
} from "./authorization-decision.js";
import { normalizeNonSensitiveText } from "./sensitive-field-taxonomy.js";

export type AuthorizationDecisionQuery = {
  decision_ref?: string;
  run_id?: string;
  thread_id?: string;
  turn_id?: string;
  operation_ref?: string;
  state?: AuthorizationDecisionSummary["state"];
  limit?: number;
  cursor?: string;
};

export type AuthorizationDecisionPage = {
  authorization_decisions: AuthorizationDecisionSummary[];
  next_cursor: string | null;
};

type NormalizedAuthorizationDecisionQuery = Omit<AuthorizationDecisionQuery, "limit" | "cursor"> & {
  limit: number;
};

type CursorPayload = {
  version: 1;
  observed_at: string;
  after_decided_at: string;
  after_decision_ref: string;
  query_hash: string;
  signature: string;
};

export type AuthorizationDecisionQueryContext = {
  query: NormalizedAuthorizationDecisionQuery;
  observed_at: string;
  after?: Pick<CursorPayload, "after_decided_at" | "after_decision_ref">;
};

const states = new Set<AuthorizationDecisionSummary["state"]>(["active", "consumed", "invalidated", "expired"]);
const hashPattern = /^[a-f0-9]{64}$/;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;

export async function loadAuthorizationDecisionCursorSigningKey(directory: string): Promise<Uint8Array> {
  const path = `${directory}.cursor-signing-key`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await readFile(path);
    if (existing.length !== 32) throw new Error("authorization_decision_persistence_failed");
    return existing;
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  try {
    await writeFile(path, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
      throw new Error("authorization_decision_persistence_failed");
    }
    const existing = await readFile(path);
    if (existing.length !== 32) throw new Error("authorization_decision_persistence_failed");
    return existing;
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("authorization_decision_query_limit_invalid");
  return value;
}

function normalizeReference(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeNonSensitiveText(value, 512);
  if (!normalized || /^https?:\/\//i.test(normalized)) throw new Error(`${label}_invalid`);
  if (label === "thread_id" && !/^thread_[a-f0-9]{32}$/.test(normalized) ||
    label === "turn_id" && !/^turn_[a-f0-9]{32}$/.test(normalized) ||
    label === "run_id" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
}

function normalizeQuery(query: AuthorizationDecisionQuery): NormalizedAuthorizationDecisionQuery {
  if (query.state !== undefined && !states.has(query.state)) throw new Error("authorization_decision_state_invalid");
  return {
    ...(query.decision_ref === undefined ? {} : { decision_ref: parseAuthorizationDecisionRef(query.decision_ref) }),
    ...(query.run_id === undefined ? {} : { run_id: normalizeReference(query.run_id, "run_id")! }),
    ...(query.thread_id === undefined ? {} : { thread_id: normalizeReference(query.thread_id, "thread_id")! }),
    ...(query.turn_id === undefined ? {} : { turn_id: normalizeReference(query.turn_id, "turn_id")! }),
    ...(query.operation_ref === undefined ? {} : { operation_ref: normalizeReference(query.operation_ref, "operation_ref")! }),
    ...(query.state === undefined ? {} : { state: query.state }),
    limit: normalizeLimit(query.limit)
  };
}

function queryHash(query: NormalizedAuthorizationDecisionQuery): string {
  const { limit: _limit, ...filters } = query;
  return createHash("sha256").update(JSON.stringify(filters)).digest("hex");
}

function cursorSignature(payload: Omit<CursorPayload, "signature">, signingKey: Uint8Array): string {
  return createHmac("sha256", signingKey).update(JSON.stringify(payload)).digest("base64url");
}

function signatureMatches(actual: string, expected: string): boolean {
  if (!signaturePattern.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
}

function parseCursor(value: string, expectedHash: string, signingKey: Uint8Array): CursorPayload {
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (Object.keys(parsed).some((key) => !["version", "observed_at", "after_decided_at", "after_decision_ref", "query_hash", "signature"].includes(key)) ||
      parsed.version !== 1 || parsed.query_hash !== expectedHash || !hashPattern.test(parsed.query_hash) ||
      authorizationTimestamp(parsed.observed_at, "cursor_observed_at") !== parsed.observed_at ||
      authorizationTimestamp(parsed.after_decided_at, "cursor_after_decided_at") !== parsed.after_decided_at ||
      parseAuthorizationDecisionRef(parsed.after_decision_ref) !== parsed.after_decision_ref) throw new Error();
    const { signature, ...unsigned } = parsed as CursorPayload;
    if (!signatureMatches(signature, cursorSignature(unsigned, signingKey))) throw new Error();
    return parsed as CursorPayload;
  } catch {
    throw new Error("authorization_decision_cursor_invalid");
  }
}

export function prepareAuthorizationDecisionQuery(
  query: AuthorizationDecisionQuery,
  now: string,
  signingKey: Uint8Array
): AuthorizationDecisionQueryContext {
  const normalized = normalizeQuery(query);
  const observedNow = authorizationTimestamp(now, "observed_at");
  if (query.cursor === undefined) {
    return { query: normalized, observed_at: observedNow };
  }
  const cursor = parseCursor(query.cursor, queryHash(normalized), signingKey);
  if (Date.parse(cursor.observed_at) > Date.parse(observedNow) ||
    Date.parse(cursor.after_decided_at) > Date.parse(cursor.observed_at)) {
    throw new Error("authorization_decision_cursor_invalid");
  }
  return {
    query: normalized,
    observed_at: cursor.observed_at,
    after: {
      after_decided_at: cursor.after_decided_at,
      after_decision_ref: cursor.after_decision_ref
    }
  };
}

function matches(decision: AuthorizationDecisionSummary, query: NormalizedAuthorizationDecisionQuery): boolean {
  const applies = decision.applicability;
  return (query.decision_ref === undefined || decision.decision_ref === query.decision_ref) &&
    (query.run_id === undefined || applies.scope === "task" && applies.run_id === query.run_id) &&
    (query.thread_id === undefined || applies.scope === "task" && applies.thread_id === query.thread_id) &&
    (query.turn_id === undefined || applies.scope === "task" && applies.turn_id === query.turn_id) &&
    (query.operation_ref === undefined || applies.scope === "environment" && applies.operation_ref === query.operation_ref) &&
    (query.state === undefined || decision.state === query.state);
}

function afterCursor(decision: AuthorizationDecisionSummary, context: AuthorizationDecisionQueryContext): boolean {
  if (!context.after) return true;
  const decisionTime = Date.parse(decision.decided_at);
  const cursorTime = Date.parse(context.after.after_decided_at);
  return decisionTime < cursorTime ||
    decisionTime === cursorTime && decision.decision_ref < context.after.after_decision_ref;
}

function encodeCursor(
  decision: AuthorizationDecisionSummary,
  context: AuthorizationDecisionQueryContext,
  signingKey: Uint8Array
): string {
  const unsigned: Omit<CursorPayload, "signature"> = {
    version: 1,
    observed_at: context.observed_at,
    after_decided_at: decision.decided_at,
    after_decision_ref: decision.decision_ref,
    query_hash: queryHash(context.query)
  };
  const payload: CursorPayload = { ...unsigned, signature: cursorSignature(unsigned, signingKey) };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function paginateAuthorizationDecisions(
  decisions: AuthorizationDecisionSummary[],
  context: AuthorizationDecisionQueryContext,
  signingKey: Uint8Array
): AuthorizationDecisionPage {
  if (context.after && !decisions.some((decision) =>
    decision.decision_ref === context.after?.after_decision_ref &&
    decision.decided_at === context.after.after_decided_at &&
    Date.parse(decision.decided_at) <= Date.parse(context.observed_at) &&
    matches(decision, context.query)
  )) throw new Error("authorization_decision_cursor_invalid");
  const ordered = decisions
    .filter((decision) => Date.parse(decision.decided_at) <= Date.parse(context.observed_at))
    .filter((decision) => matches(decision, context.query) && afterCursor(decision, context))
    .sort((left, right) => Date.parse(right.decided_at) - Date.parse(left.decided_at) ||
      right.decision_ref.localeCompare(left.decision_ref));
  const page = ordered.slice(0, context.query.limit);
  return {
    authorization_decisions: page,
    next_cursor: ordered.length > page.length ? encodeCursor(page[page.length - 1]!, context, signingKey) : null
  };
}
