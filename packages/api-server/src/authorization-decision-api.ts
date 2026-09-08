import {
  isXhsConfirmationContext,
  xhsCommitPackageRef,
  xhsFieldPackageRef,
  xhsMediaActionPaths,
  xhsMediaPackageRef,
  type AuthorizationDecisionQuery,
  type AuthorizationDecisionState,
  type AuthorizationDecisionSummary,
  type FileAuthorizationDecisionStore,
  type FileRunRecordStore
} from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type AuthorizationDecisionApiResult =
  | { handled: false }
  | { handled: true; status: number; body: JsonBody };

export type AuthorizationDecisionPreflightResult =
  | { ok: true }
  | { ok: false; status: number; body: JsonBody };

const persistenceCodes = new Set([
  "authorization_decision_journal_invalid",
  "authorization_decision_lock_timeout",
  "authorization_decision_persistence_failed",
  "authorization_decision_store_unavailable",
  "authorization_run_store_unavailable",
  "authorization_run_record_invalid",
  "authorization_confirmation_context_invalid",
  "authorization_confirmation_context_missing",
  "authorization_preflight_unavailable",
  "authorization_decision_refs_invalid"
]);
const notFoundCodes = new Set(["authorization_decision_not_found", "run_not_found"]);

function isXhsMediaDecision(decision: AuthorizationDecisionSummary): boolean {
  const actionId = decision.business_action?.action_id;
  return typeof actionId === "string" && Object.hasOwn(xhsMediaActionPaths, actionId);
}

function isXhsMediaRunForDecision(run: Awaited<ReturnType<FileRunRecordStore["getRunRecord"]>>, decision: AuthorizationDecisionSummary): boolean {
  const actionId = decision.business_action?.action_id;
  if (!run || typeof actionId !== "string" || !Object.hasOwn(xhsMediaActionPaths, actionId)) return false;
  const expectedPackage = actionId === "xhs_publish_note_image_text_fields.compose"
    ? xhsFieldPackageRef
    : actionId.startsWith("xhs_publish_note_image_text_commit.") ? xhsCommitPackageRef : xhsMediaPackageRef;
  return run.action_request?.action_id === actionId && run.package_ref === expectedPackage;
}

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

async function detailBody(
  decision: AuthorizationDecisionSummary,
  runRecordStore?: FileRunRecordStore
): Promise<JsonBody> {
  if (decision.applicability.scope !== "task") {
    return { ok: true, authorization_decision: decision };
  }
  if (!runRecordStore) {
    if (isXhsMediaDecision(decision)) throw new Error("authorization_run_store_unavailable");
    return { ok: true, authorization_decision: decision };
  }
  const run = await runRecordStore.getRunRecord(decision.applicability.run_id).catch(() => undefined);
  if (!run || run.run_id !== decision.applicability.run_id) {
    if (isXhsMediaDecision(decision)) throw new Error("authorization_run_record_invalid");
    return { ok: true, authorization_decision: decision };
  }
  if (isXhsMediaDecision(decision) && !isXhsMediaRunForDecision(run, decision)) {
    throw new Error("authorization_run_record_invalid");
  }
  if (!isXhsMediaDecision(decision)) return { ok: true, authorization_decision: decision };
  const context = run.public_result_summary?.confirmation_context;
  if (context !== undefined && !isXhsConfirmationContext(context)) {
    throw new Error("authorization_confirmation_context_invalid");
  }
  if (context === undefined) throw new Error("authorization_confirmation_context_missing");
  return {
    ok: true,
    authorization_decision: decision,
    ...(isXhsConfirmationContext(context) ? { confirmation_context: context } : {})
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
  preflightSingleAction?: (confirmationDecisionRef: string) => Promise<AuthorizationDecisionPreflightResult | undefined>;
  withPreflightRunLock?: <T>(runId: string, action: () => Promise<T>) => Promise<T>;
}): Promise<AuthorizationDecisionApiResult> {
  const detail = /^\/authorization-decisions\/([^/]+)$/.exec(input.url.pathname);
  const preflight = /^\/authorization-decisions\/([^/]+)\/preflight$/.exec(input.url.pathname);
  const run = /^\/runs\/([^/]+)\/authorization-decisions$/.exec(input.url.pathname);
  if (input.url.pathname !== "/authorization-decisions" && !detail && !preflight && !run) return { handled: false };
  if (preflight ? input.method !== "POST" : input.method !== "GET") return error(405, "method_not_allowed");
  if (!input.store) return error(503, "authorization_decision_store_unavailable");

  try {
    const allowed = new Set(["run_id", "thread_id", "turn_id", "operation_ref", "state", "limit", "cursor"]);
    if ([...input.url.searchParams.keys()].some((name) => !allowed.has(name)) || (detail || preflight) && input.url.search.length > 0) {
      return error(400, "authorization_decision_query_field_unsupported");
    }
    if (detail || preflight) {
      const decisionRef = decode((detail ?? preflight)?.[1]);
      if (!decisionRef) return error(400, "authorization_decision_ref_invalid");
      const decision = await input.store.getAuthorizationDecision(decisionRef);
      if (!decision) return error(404, "authorization_decision_not_found");
      if (preflight && decision.applicability.scope === "task") {
        if (!input.preflightSingleAction) return error(503, "authorization_preflight_unavailable");
        const runId = decision.applicability.run_id;
        const runAction = () => input.preflightSingleAction!(decisionRef);
        const preflight = input.withPreflightRunLock
          ? await input.withPreflightRunLock(runId, runAction)
          : await runAction();
        if (preflight === undefined) return error(503, "authorization_preflight_unavailable");
        const freshDecision = await input.store.getAuthorizationDecision(decisionRef);
        const detailed = await detailBody(freshDecision ?? decision, input.runRecordStore);
        if (preflight?.ok === false) {
          return {
            handled: true,
            status: preflight.status,
            body: {
              ...preflight.body,
              authorization_decision: detailed.authorization_decision,
              ...(detailed.confirmation_context === undefined ? {} : { confirmation_context: detailed.confirmation_context })
            }
          };
        }
        return { handled: true, status: 200, body: detailed };
      }
      return { handled: true, status: 200, body: await detailBody(decision, input.runRecordStore) };
    }
    if (run) return await runQuery(run, { ...input, store: input.store });
    const page = await input.store.queryAuthorizationDecisions(queryInput(input.url, queryValue(input.url, "run_id")));
    return { handled: true, status: 200, body: { ok: true, ...page } };
  } catch (cause) {
    return classifiedError(cause);
  }
}
