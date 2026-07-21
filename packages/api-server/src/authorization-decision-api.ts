import type { AuthorizationDecisionState, FileAuthorizationDecisionStore } from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type AuthorizationDecisionApiResult =
  | { handled: false }
  | { handled: true; status: number; body: JsonBody };

function decode(value: string | undefined): string | undefined {
  try {
    const decoded = decodeURIComponent(value ?? "");
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function error(status: number, code: string): AuthorizationDecisionApiResult {
  return {
    handled: true,
    status,
    body: {
      ok: false,
      error: {
        category: status === 503 ? "persistence_observability" : "request_invalid",
        code,
        phase: "query",
        recovery_hint: status === 503 ? "contact_operator" : "fix_input"
      }
    }
  };
}

function queryValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("authorization_decision_query_duplicate");
  const value = values[0];
  return value && value.length > 0 ? value : undefined;
}

export async function handleAuthorizationDecisionApi(input: {
  method: string | undefined;
  url: URL;
  store?: FileAuthorizationDecisionStore;
}): Promise<AuthorizationDecisionApiResult> {
  const detail = /^\/authorization-decisions\/([^/]+)$/.exec(input.url.pathname);
  const run = /^\/runs\/([^/]+)\/authorization-decisions$/.exec(input.url.pathname);
  if (input.url.pathname !== "/authorization-decisions" && !detail && !run) return { handled: false };
  if (input.method !== "GET") return error(405, "method_not_allowed");
  if (!input.store) return error(503, "authorization_decision_store_unavailable");

  try {
    const allowedQueryFields = new Set(["run_id", "thread_id", "turn_id", "operation_ref", "state", "limit"]);
    if ([...input.url.searchParams.keys()].some((name) => !allowedQueryFields.has(name)) || detail && input.url.search.length > 0) {
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
    const runId = run ? decode(run[1]) : queryValue(input.url, "run_id");
    if (run && !runId) return error(400, "run_id_invalid");
    const rawState = queryValue(input.url, "state");
    if (rawState && !["active", "consumed", "invalidated", "expired"].includes(rawState)) {
      return error(400, "authorization_decision_state_invalid");
    }
    const rawLimit = queryValue(input.url, "limit");
    const decisions = await input.store.listAuthorizationDecisions({
      ...(runId === undefined ? {} : { run_id: runId }),
      ...(queryValue(input.url, "thread_id") === undefined ? {} : { thread_id: queryValue(input.url, "thread_id")! }),
      ...(queryValue(input.url, "turn_id") === undefined ? {} : { turn_id: queryValue(input.url, "turn_id")! }),
      ...(queryValue(input.url, "operation_ref") === undefined ? {} : { operation_ref: queryValue(input.url, "operation_ref")! }),
      ...(rawState === undefined ? {} : { state: rawState as AuthorizationDecisionState }),
      ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) })
    });
    return { handled: true, status: 200, body: { ok: true, authorization_decisions: decisions } };
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "authorization_decision_query_failed";
    return error(code.endsWith("not_found") ? 404 : 400, code);
  }
}
