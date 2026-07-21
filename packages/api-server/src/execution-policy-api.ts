import type {
  FileAuthorizationDecisionStore,
  FileExecutionPolicyConfigStore,
  FileTaskThreadStore,
  LodePackageResolver
} from "@webenvoy/core-runtime";
import {
  ExecutionPolicyVersionConflictError,
  decideSingleAction,
  declaredActionCategories,
  getExecutionPolicyEffectiveView,
  normalizeExecutionPolicyMutation,
  normalizeSingleActionDecisionCommand,
  resolveSkillActionCatalog,
  validateThreadPolicyContext
} from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type ExecutionPolicyApiResult =
  | { handled: false }
  | { handled: false; requires_body: true }
  | { handled: true; status: number; body: JsonBody };

export type ExecutionPolicyApiDependencies = {
  configStore?: FileExecutionPolicyConfigStore;
  authorizationDecisionStore?: FileAuthorizationDecisionStore;
  taskThreadStore?: FileTaskThreadStore;
  lodePackageResolver?: LodePackageResolver;
  clock?: () => Date;
};

const unavailableCodes = new Set([
  "execution_policy_store_unavailable",
  "execution_policy_thread_store_unavailable",
  "execution_policy_owner_unavailable",
  "execution_policy_persistence_failed",
  "execution_policy_lock_timeout",
  "execution_policy_store_invalid",
  "execution_policy_store_budget_exceeded",
  "authorization_decision_store_unavailable"
]);
const conflictCodes = new Set([
  "execution_policy_idempotency_conflict",
  "single_action_idempotency_conflict",
  "single_action_already_decided",
  "single_action_confirmation_effective_policy_changed",
  "single_action_confirmation_binding_mismatch",
  "execution_policy_thread_binding_mismatch"
]);
const goneCodes = new Set([
  "single_action_confirmation_expired",
  "single_action_confirmation_completed",
  "single_action_confirmation_cancelled",
  "single_action_confirmation_target_changed",
  "single_action_confirmation_owner_changed",
  "single_action_confirmation_action_reclassified",
  "single_action_confirmation_inactive"
]);
const notFoundCodes = new Set([
  "execution_policy_skill_not_found",
  "execution_policy_thread_not_found",
  "single_action_confirmation_not_found"
]);

function error(status: number, code: string, current?: unknown): ExecutionPolicyApiResult {
  const persistence = status >= 500;
  return {
    handled: true,
    status,
    body: {
      ok: false,
      error: {
        category: persistence ? "persistence_observability" : status === 410 ? "action_risk" : "request_invalid",
        code,
        phase: "policy_resolution",
        recovery_hint: persistence ? "contact_operator" : status === 409 ? "refresh_and_retry" : "fix_input",
        ...(current === undefined ? {} : { current_configuration: current })
      }
    }
  };
}

function classifiedError(cause: unknown): ExecutionPolicyApiResult {
  if (cause instanceof ExecutionPolicyVersionConflictError) return error(409, cause.message, cause.current ?? null);
  if (!(cause instanceof Error)) return error(500, "execution_policy_request_failed");
  const code = cause.message;
  if (code === "execution_policy_request_failed") return error(500, code);
  if (unavailableCodes.has(code)) return error(503, code);
  if (notFoundCodes.has(code)) return error(404, code);
  if (conflictCodes.has(code)) return error(409, code);
  if (goneCodes.has(code)) return error(410, code);
  if (code.endsWith("_required") || code.endsWith("_invalid") ||
    code.startsWith("execution_policy_") || code.startsWith("single_action_")) {
    return error(400, code);
  }
  return error(500, "execution_policy_request_failed");
}

function queryValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("execution_policy_query_duplicate");
  return values[0] || undefined;
}

function requireQuery(url: URL, name: string): string {
  const value = queryValue(url, name);
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function allowedQuery(url: URL, names: readonly string[]): void {
  const allowed = new Set(names);
  if ([...url.searchParams.keys()].some((name) => !allowed.has(name))) {
    throw new Error("execution_policy_query_field_unsupported");
  }
}

function decode(value: string | undefined, code: string): string {
  try {
    const decoded = decodeURIComponent(value ?? "");
    if (!decoded) throw new Error(code);
    return decoded;
  } catch {
    throw new Error(code);
  }
}

function requiresBody(method: string | undefined, path: string): boolean {
  return method === "PUT" && (path === "/execution-policy-configs/global" || path === "/execution-policy-configs/skill") ||
    method === "PUT" && /^\/threads\/[^/]+\/execution-policy$/.test(path) ||
    method === "POST" && /^\/authorization-decisions\/[^/]+\/single-action$/.test(path);
}

export async function handleExecutionPolicyApi(input: {
  method: string | undefined;
  url: URL;
  body?: JsonBody;
  dependencies: ExecutionPolicyApiDependencies;
}): Promise<ExecutionPolicyApiResult> {
  const path = input.url.pathname;
  const threadMatch = /^\/threads\/([^/]+)\/execution-policy$/.exec(path);
  const singleMatch = /^\/authorization-decisions\/([^/]+)\/single-action$/.exec(path);
  const known = path === "/execution-policy-configs/global" || path === "/execution-policy-configs/skill" ||
    path === "/execution-policies/effective" || threadMatch !== null || singleMatch !== null;
  if (!known) return { handled: false };
  if (!input.dependencies.configStore) return error(503, "execution_policy_store_unavailable");
  if (requiresBody(input.method, path) && input.body === undefined) return { handled: false, requires_body: true };

  const configStore = input.dependencies.configStore;
  const serviceDependencies = {
    configStore,
    ...(input.dependencies.lodePackageResolver === undefined ? {} : {
      lodePackageResolver: input.dependencies.lodePackageResolver
    }),
    ...(input.dependencies.taskThreadStore === undefined ? {} : {
      taskThreadStore: input.dependencies.taskThreadStore
    })
  };
  try {
    if (path === "/execution-policy-configs/global") {
      allowedQuery(input.url, []);
      if (input.method === "GET") {
        return { handled: true, status: 200, body: { ok: true, configuration: await configStore.getGlobalConfiguration() ?? null } };
      }
      if (input.method === "PUT") {
        const mutation = normalizeExecutionPolicyMutation(input.body, { require_all: true });
        return { handled: true, status: 200, body: { ok: true, configuration: await configStore.putGlobalConfiguration(mutation) } };
      }
      return error(405, "method_not_allowed");
    }

    if (path === "/execution-policy-configs/skill") {
      allowedQuery(input.url, ["skill_ref"]);
      const skillRef = requireQuery(input.url, "skill_ref");
      const { catalog } = await resolveSkillActionCatalog(skillRef, input.dependencies.lodePackageResolver);
      if (input.method === "GET") {
        return { handled: true, status: 200, body: { ok: true, configuration: await configStore.getInstalledSkillConfiguration(skillRef) ?? null } };
      }
      if (input.method === "PUT") {
        const mutation = normalizeExecutionPolicyMutation(input.body, { allowed_categories: declaredActionCategories(catalog) });
        const configuration = await configStore.putInstalledSkillConfiguration(skillRef, mutation);
        const executionPolicy = await getExecutionPolicyEffectiveView(
          { skill_ref: skillRef },
          serviceDependencies
        );
        return { handled: true, status: 200, body: { ok: true, configuration, execution_policy: executionPolicy } };
      }
      return error(405, "method_not_allowed");
    }

    if (path === "/execution-policies/effective") {
      if (input.method !== "GET") return error(405, "method_not_allowed");
      allowedQuery(input.url, ["skill_ref", "thread_ref"]);
      const skillRef = requireQuery(input.url, "skill_ref");
      const threadRef = queryValue(input.url, "thread_ref");
      const executionPolicy = await getExecutionPolicyEffectiveView(
        { skill_ref: skillRef, ...(threadRef === undefined ? {} : { thread_ref: threadRef }) },
        serviceDependencies
      );
      return { handled: true, status: 200, body: { ok: true, execution_policy: executionPolicy } };
    }

    if (threadMatch) {
      if (input.method !== "GET" && input.method !== "PUT") return error(405, "method_not_allowed");
      allowedQuery(input.url, ["skill_ref"]);
      const threadRef = decode(threadMatch[1], "thread_ref_invalid");
      const skillRef = requireQuery(input.url, "skill_ref");
      if (input.method === "PUT") {
        const { resolved, catalog } = await resolveSkillActionCatalog(skillRef, input.dependencies.lodePackageResolver);
        if (!input.dependencies.taskThreadStore) throw new Error("execution_policy_thread_store_unavailable");
        const mutation = normalizeExecutionPolicyMutation(input.body, { allowed_categories: declaredActionCategories(catalog) });
        return input.dependencies.taskThreadStore.withNextTurnPolicyBoundary(threadRef, async (boundary) => {
          const thread = validateThreadPolicyContext(boundary.thread, resolved);
          const configuration = await configStore.putThreadRevision(threadRef, thread.next_turn_sequence, mutation);
          const executionPolicy = await getExecutionPolicyEffectiveView(
            { skill_ref: skillRef, thread_ref: threadRef },
            serviceDependencies
          );
          return { handled: true, status: 200, body: { ok: true, configuration, execution_policy: executionPolicy } };
        });
      }
      const executionPolicy = await getExecutionPolicyEffectiveView(
        { skill_ref: skillRef, thread_ref: threadRef },
        serviceDependencies
      );
      return { handled: true, status: 200, body: { ok: true, execution_policy: executionPolicy } };
    }

    if (singleMatch) {
      allowedQuery(input.url, []);
      if (input.method !== "POST") return error(405, "method_not_allowed");
      if (!input.dependencies.authorizationDecisionStore) return error(503, "authorization_decision_store_unavailable");
      const decisionRef = decode(singleMatch[1], "authorization_decision_ref_invalid");
      const command = normalizeSingleActionDecisionCommand(input.body);
      const decision = await decideSingleAction(decisionRef, command, {
        authorizationDecisionStore: input.dependencies.authorizationDecisionStore,
        configStore,
        ...(input.dependencies.taskThreadStore === undefined ? {} : {
          taskThreadStore: input.dependencies.taskThreadStore
        }),
        ...(input.dependencies.clock === undefined ? {} : { clock: input.dependencies.clock })
      });
      return { handled: true, status: 200, body: { ok: true, single_action_decision: decision } };
    }
    return { handled: false };
  } catch (cause) {
    return classifiedError(cause);
  }
}
