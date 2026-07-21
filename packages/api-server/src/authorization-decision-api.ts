import type {
  AuthorizationDecisionQuery,
  AuthorizationDecisionState,
  FileAuthorizationDecisionStore,
  FileRunRecordStore
} from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type AuthorizationDecisionApiResult =
  | { handled: false }
  | { handled: true; status: number; body: JsonBody };

const persistenceCodes = new Set([
  "authorization_decision_journal_invalid",
  "authorization_decision_lock_timeout",
  "authorization_decision_persistence_failed",
  "authorization_decision_store_unavailable",
  "authorization_run_store_unavailable",
  "authorization_run_record_invalid",
  "authorization_decision_refs_invalid"
]);
const notFoundCodes = new Set(["authorization_decision_not_found", "run_not_found"]);

function decode(value: string | undefined): string | undefined {
  try {
    const decoded = decodeURIComponent(value ?? "");
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function error(status: number, code: string): AuthorizationDecisionApiResult {
  const persistence = status >= 500;
  return {
    handled: true,
    status,
    body: {
      ok: false,
      error: {
        category: persistence ? "persistence_observability" : "request_invalid",
        code,
        phase: "query",
        recovery_hint: persistence ? "contact_operator" : "fix_input"
      }
    }
  };
}

function classifiedError(cause: unknown): AuthorizationDecisionApiResult {
  const code = cause instanceof Error ? cause.message : "authorization_decision_query_failed";
  if (notFoundCodes.has(code)) return error(404, code);
  if (persistenceCodes.has(code)) return error(503, code);
  if (code.startsWith("authorization_") || code === "run_id_invalid") return error(400, code);
  return error(500, "authorization_decision_query_failed");
}

function queryValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("authorization_decision_query_duplicate");
  const value = values[0];
  return value && value.length > 0 ? value : undefined;
}

function queryInput(url: URL, runId?: string): AuthorizationDecisionQuery {
  const rawState = queryValue(url, "state");
  if (rawState && !["active", "consumed", "invalidated", "expired"].includes(rawState)) {
    throw new Error("authorization_decision_state_invalid");
  }
  const threadId = queryValue(url, "thread_id");
  const turnId = queryValue(url, "turn_id");
  const operationRef = queryValue(url, "operation_ref");
  const rawLimit = queryValue(url, "limit");
  const cursor = queryValue(url, "cursor");
  return {
    ...(runId === undefined ? {} : { run_id: runId }),
    ...(threadId === undefined ? {} : { thread_id: threadId }),
    ...(turnId === undefined ? {} : { turn_id: turnId }),
    ...(operationRef === undefined ? {} : { operation_ref: operationRef }),
    ...(rawState === undefined ? {} : { state: rawState as AuthorizationDecisionState }),
    ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
    ...(cursor === undefined ? {} : { cursor })
  };
}

async function runQuery(
  runMatch: RegExpExecArray,
  input: { url: URL; store: FileAuthorizationDecisionStore; runRecordStore?: FileRunRecordStore }
): Promise<AuthorizationDecisionApiResult> {
  const runId = decode(runMatch[1]);
  if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) return error(400, "run_id_invalid");
  if (input.url.searchParams.has("run_id")) return error(400, "authorization_decision_query_field_unsupported");
  if (!input.runRecordStore) return error(503, "authorization_run_store_unavailable");
  const runRecord = await input.runRecordStore.getRunRecord(runId).catch(() => {
    throw new Error("authorization_run_record_invalid");
  });
  if (!runRecord) return error(404, "run_not_found");
  if (runRecord.run_id !== runId) throw new Error("authorization_run_record_invalid");
  const page = await input.store.queryAuthorizationDecisions(queryInput(input.url, runId));
  return { handled: true, status: 200, body: { ok: true, ...page } };
}

export async function handleAuthorizationDecisionApi(input: {
  method: string | undefined;
  url: URL;
  store?: FileAuthorizationDecisionStore;
  runRecordStore?: FileRunRecordStore;
}): Promise<AuthorizationDecisionApiResult> {
  const detail = /^\/authorization-decisions\/([^/]+)$/.exec(input.url.pathname);
  const run = /^\/runs\/([^/]+)\/authorization-decisions$/.exec(input.url.pathname);
  if (input.url.pathname !== "/authorization-decisions" && !detail && !run) return { handled: false };
  if (input.method !== "GET") return error(405, "method_not_allowed");
  if (!input.store) return error(503, "authorization_decision_store_unavailable");

  try {
    const allowed = new Set(["run_id", "thread_id", "turn_id", "operation_ref", "state", "limit", "cursor"]);
    if ([...input.url.searchParams.keys()].some((name) => !allowed.has(name)) || detail && input.url.search.length > 0) {
      return error(400, "authorization_decision_query_field_unsupported");
    }
    if (detail) {
      const decisionRef = decode(detail[1]);
      if (!decisionRef) return error(400, "authorization_decision_ref_invalid");
      const decision = await input.store.getAuthorizationDecision(decisionRef);
      return decision
        ? { handled: true, status: 200, body: { ok: true, authorization_decision: decision } }
        : error(404, "authorization_decision_not_found");
    }
    if (run) return await runQuery(run, { ...input, store: input.store });
    const page = await input.store.queryAuthorizationDecisions(queryInput(input.url, queryValue(input.url, "run_id")));
    return { handled: true, status: 200, body: { ok: true, ...page } };
  } catch (cause) {
    return classifiedError(cause);
  }
}
