import { coreReadTaskSpecs, fetchCoreRunProjectionById, type CoreReadTaskSpec } from "./coreReadTaskClient";
import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import { requestOwnerJson } from "./ownerApiClient";
import { runtimeService, type RuntimeSupervisorState } from "./runtimeSupervisorState";
import type { RunProjection, TaskProjection } from "./taskThreadFixtures";

export type CoreTaskSubmitState =
  | { status: "idle"; summary: string }
  | { status: "blocked"; summary: string }
  | { status: "submitting"; summary: string }
  | { status: "polling"; summary: string; runId: string }
  | { status: "ready"; summary: string; runId: string; run: RunProjection }
  | { status: "failed"; summary: string; runId?: string };

type SubmitReadiness =
  | { ok: true; spec: CoreReadTaskSpec; identity: IdentityEnvironmentProjection; payload: CoreTaskPayload }
  | { ok: false; reason: string };

type CoreTaskPayload = {
  run_id: string;
  package_ref: string;
  public_query: { query: string; city_code?: string; page?: 1; limit?: number };
  task_intent: {
    schema_version: "webenvoy.task-intent.v0";
    intent_id: string;
    entrypoint: "app";
    user_intent: {
      summary: string;
    };
    capability: {
      ref: string;
      version: string;
      source_ref: string;
      lock_ref?: string;
    };
    input: {
      summary: string;
      refs?: string[];
    };
    scope: {
      target_type: "site" | "boss_job_search";
      target_ref: string;
    };
    policy: {
      risk: "read";
      execution_intent: "read";
      timeout_ms: number;
    };
    resource_requirement_refs: string[];
    resource_requirement_profile_id: string;
    evidence_policy_ref: string;
  };
  harbor: {
    identity_environment_ref: string;
    url: string;
    reuse_existing: true;
    timeout_ms: number;
  };
};

type CoreTaskSubmitOptions = {
  pollAttempts?: number;
  pollIntervalMs?: number;
};

const sensitivePayloadPattern =
  /\b(token|cookie|secret|bearer|credential|password|authorization|profile_storage|raw_evidence|dom|har|trace)\b/i;
const supportedBossCityCodes = new Set(["101020100"]);

export const initialCoreTaskSubmitState: CoreTaskSubmitState = {
  status: "idle",
  summary: "真实只读任务尚未提交；按钮只在 Core admission、Harbor live identity 和只读 submit spec 都可用时启用。",
};

export function coreTaskSubmitReadiness(
  task: TaskProjection,
  runtime: RuntimeSupervisorState,
  identities: IdentityEnvironmentProjection[],
): SubmitReadiness {
  const core = runtimeService(runtime, "core");
  const harbor = runtimeService(runtime, "harbor");
  const spec = coreReadTaskSpecs.find((item) => item.taskId === task.id && item.mode === "read");

  if (!runtime.canUseLiveRuntime) {
    return { ok: false, reason: "生产 live runtime 不可用；fixture/demo 不可提交为 live task。" };
  }
  if (core?.health.state !== "ready" || core.admission?.state !== "ready") {
    return { ok: false, reason: "Core health/admission 未 ready；提交保持 fail closed。" };
  }
  if (harbor?.health.state !== "ready") {
    return { ok: false, reason: "Harbor runtime health 未 ready；提交保持 fail closed。" };
  }
  if (!spec) {
    return { ok: false, reason: "当前任务缺少只读 submit spec；不构造 Core task payload。" };
  }
  if (spec.resourceRequirementRefs.length === 0) {
    return { ok: false, reason: "当前任务缺少 Lode resource requirement refs；不构造 Core task payload。" };
  }
  if (!spec.resourceRequirementProfileId.trim()) {
    return { ok: false, reason: "当前任务缺少 Lode resource requirement profile；不构造 Core task payload。" };
  }

  const site = siteForTask(task);
  const identityRef = task.threadContext?.accountIdentityKey;
  if (!identityRef) return { ok: false, reason: "任务线程未固定 Harbor identity environment；不选择同站点其他身份。" };
  const identity = identities.find((item) => item.identityEnvironmentRef === identityRef);
  if (!identity || identity.source !== "Harbor live" || identity.siteId !== site || !isReadOnlyIdentityAdmitted(identity, site, spec)) {
    return { ok: false, reason: "线程固定的 Harbor identity 当前不可用于只读任务；不切换到同站点其他身份。" };
  }

  const bossQuery = site === "boss" ? parseBossJobSearchInput(task.businessInput) : null;
  if (site === "boss" && !bossQuery?.ok) {
    return { ok: false, reason: bossQuery?.reason ?? "BOSS 搜索输入无效；已 fail closed。" };
  }
  const query = bossQuery?.ok ? bossQuery.value.query : task.searchQuery;
  const maxQueryLength = site === "boss" ? 80 : 256;
  if (typeof query !== "string" || query.length === 0 || query !== query.trim() || query.length > maxQueryLength) {
    return { ok: false, reason: `当前任务缺少明确、已修剪且不超过 ${maxQueryLength} 字符的公开搜索 query；不发送自由格式业务输入。` };
  }

  const capability = spec.capabilities[0];
  const runId = `app-${site}-${Date.now().toString(36)}`;
  const inputTargetRef = targetRefForTask(task.businessInput, identity);
  if (inputTargetRef == null) {
    return { ok: false, reason: "业务输入中的 URL 不属于所选 Harbor identity origin；已 fail closed。" };
  }
  const targetUrl = new URL(site === "boss" ? "/web/geek/job" : "/search_result", identity.origin);
  targetUrl.searchParams.set(site === "boss" ? "query" : "keyword", query);
  if (bossQuery?.ok) targetUrl.searchParams.set("city", bossQuery.value.city_code);
  const targetRef = targetUrl.toString();
  const payload: CoreTaskPayload = {
    run_id: runId,
    package_ref: capability.packageRef,
    public_query: bossQuery?.ok ? bossQuery.value : { query },
    task_intent: {
      schema_version: "webenvoy.task-intent.v0",
      intent_id: `intent_${runId}`,
      entrypoint: "app",
      user_intent: {
        summary: task.title,
      },
      capability: {
        ref: capability.capabilityRef,
        version: capability.capabilityVersion,
        source_ref: capability.packageRef,
        ...(task.packageSource.lockRef === undefined ? {} : { lock_ref: task.packageSource.lockRef }),
      },
      input: {
        summary: task.title,
        ...(targetRef === identity.origin ? {} : { refs: [targetRef] }),
      },
      scope: {
        target_type: site === "boss" ? "boss_job_search" : "site",
        target_ref: targetRef,
      },
      policy: {
        risk: "read",
        execution_intent: "read",
        timeout_ms: 60_000,
      },
      resource_requirement_refs: spec.resourceRequirementRefs,
      resource_requirement_profile_id: spec.resourceRequirementProfileId,
      evidence_policy_ref: spec.evidencePolicyRef,
    },
    harbor: {
      identity_environment_ref: identity.identityEnvironmentRef,
      url: targetRef,
      reuse_existing: true,
      timeout_ms: 60_000,
    },
  };

  return containsSensitiveField(payload)
    ? { ok: false, reason: "Core task payload 含敏感字段；已 fail closed。" }
    : { ok: true, spec, identity, payload };
}

export function parseBossJobSearchInput(value: string):
  | { ok: true; value: { query: string; city_code: string; page: 1; limit: number } }
  | { ok: false; reason: string } {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    return { ok: false, reason: "BOSS 搜索只接受 JSON 结构化输入，不接受自由文本城市。" };
  }
  if (typeof input !== "object" || input == null || Array.isArray(input)) {
    return { ok: false, reason: "BOSS 搜索输入必须是单个 JSON object。" };
  }
  const record = input as Record<string, unknown>;
  const allowedKeys = new Set(["query", "city_code", "page", "limit"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, reason: "BOSS 搜索包含未知 filter；仅允许 query、city_code、page、limit。" };
  }
  const query = record.query;
  if (typeof query !== "string" || query.length === 0 || query !== query.trim() || query.length > 80) {
    return { ok: false, reason: "BOSS query 必须明确、已修剪且不超过 80 字符。" };
  }
  if (typeof record.city_code !== "string" || !supportedBossCityCodes.has(record.city_code)) {
    return { ok: false, reason: "BOSS city_code 未明确或不在当前支持列表；自由文本城市和未知城市代码均被拒绝。" };
  }
  const page = record.page ?? 1;
  const limit = record.limit ?? 15;
  if (page !== 1 || !Number.isInteger(limit) || typeof limit !== "number" || limit < 1 || limit > 15) {
    return { ok: false, reason: "BOSS 单次搜索仅允许 page=1 且 limit 为 1..15。" };
  }
  return { ok: true, value: { query, city_code: record.city_code, page: 1, limit } };
}

export function isReadOnlyIdentityAdmitted(
  identity: IdentityEnvironmentProjection,
  site: "xiaohongshu" | "boss",
  spec: CoreReadTaskSpec,
) {
  if (spec.mode !== "read") return false;
  const facts = identity.admissionFacts;
  if (
    identity.source === "Harbor live" &&
    identity.readiness.state === "ready" &&
    identity.provider.state === "ready" &&
    !identity.login.recoveryRequired &&
    facts?.loginState === "logged_in" &&
    (facts.manualAuthenticationState === "not_required" || facts.manualAuthenticationState === "completed") &&
    facts.recoveryRequired === false &&
    facts.browserStorageState === "present"
  ) {
    return true;
  }
  const warnings = facts?.warningReasonCodes ?? [];
  const allowsMissingProxy =
    site === "boss" &&
    spec.taskId === "task-boss-real-read" &&
    spec.capabilities.some((capability) => capability.capabilityRef === "lode:capability/job-search");
  return (
    identity.readiness.state === "warning" &&
    identity.source === "Harbor live" &&
    identity.provider.state === "warning" &&
    facts?.providerId === "chrome_official" &&
    facts.providerRole === "restricted_fallback" &&
    facts.authenticationProvenance === "user_confirmed_managed_session" &&
    facts.loginState === "logged_in" &&
    facts.manualAuthenticationState === "completed" &&
    facts.recoveryRequired === false &&
    facts.browserStorageState === "present" &&
    warnings.every((code) => allowsMissingProxy && code === "proxy_missing")
  );
}

export function readOnlyIdentityAdmissionBlockReason(
  identity: IdentityEnvironmentProjection,
  taskId: string,
) {
  if (identity.source !== "Harbor live") {
    return "缺少 Harbor live identity；fixture/local identity 只能管理或认证，不能启动真实 Core task。";
  }
  if (identity.readiness.state === "needs-auth") {
    return "需要先在 Harbor 身份浏览器完成登录/人工认证；未登录身份不能启动真实 Core task。";
  }
  if (identity.readiness.state === "blocked" || identity.login.recoveryRequired) {
    return "需要先修复浏览器环境；当前身份不能启动真实 Core task。";
  }
  const readSpec = coreReadTaskSpecs.find((spec) => spec.taskId === taskId && spec.mode === "read");
  if (!readSpec) {
    return "当前入口不是已登记的真实只读任务；保持 fail closed。";
  }
  if (isReadOnlyIdentityAdmitted(identity, identity.siteId, readSpec)) {
    return null;
  }
  return "身份环境尚未 ready；受限或告警状态不能直接启动真实 Core task。";
}

export async function submitCoreReadOnlyTask(
  endpoint: string,
  task: TaskProjection,
  runtime: RuntimeSupervisorState,
  identities: IdentityEnvironmentProjection[],
  options: CoreTaskSubmitOptions = {},
): Promise<CoreTaskSubmitState> {
  const readiness = coreTaskSubmitReadiness(task, runtime, identities);
  if (!readiness.ok) {
    return { status: "blocked", summary: readiness.reason };
  }

  const submitResponse = await requestJson(endpoint, "/tasks", {
    method: "POST",
    body: JSON.stringify(readiness.payload),
    includeErrorBody: true,
  });
  const runId = runIdFromSubmitResponse(submitResponse) ?? readiness.payload.run_id;

  if (!isOkResponse(submitResponse)) {
    return { status: "failed", runId, summary: coreTaskSubmitFailureSummary(submitResponse, "Core /tasks did not accept the read-only task.") };
  }

  const projected = await pollSubmittedRun(endpoint, runId, readiness.spec, options);
  return projected.ok
    ? {
        status: "ready",
        runId,
        run: projected.run,
        summary: `Core accepted /tasks and returned live run ${runId}; result/evidence/failure/session refs were polled from owner endpoints.`,
      }
    : {
        status: "polling",
        runId,
        summary: `Core accepted /tasks as ${runId}; owner refs are not queryable yet. ${projected.error}`,
      };
}

export function promoteSubmittedCoreTask(task: TaskProjection, run: RunProjection): TaskProjection {
  return {
    ...task,
    source: "Core live",
    identitySource: "Harbor live",
    runs: [run],
  };
}

function siteForTask(task: TaskProjection): "xiaohongshu" | "boss" {
  return task.id.includes("boss") || task.siteSkill.toLowerCase().includes("boss") ? "boss" : "xiaohongshu";
}

function firstHttpUrl(value: string) {
  return /https?:\/\/[^\s；;，,]+/.exec(value)?.[0];
}

function targetRefForTask(value: string, identity: IdentityEnvironmentProjection): string | null {
  const explicitUrl = firstHttpUrl(value);
  if (explicitUrl == null) return identity.origin;
  return isSameOrigin(explicitUrl, identity.origin) ? explicitUrl : null;
}

function isSameOrigin(candidate: string, expectedOrigin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

function containsSensitiveField(value: unknown): boolean {
  if (typeof value === "string") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveField);
  if (typeof value !== "object" || value == null) return false;
  return Object.entries(value).some(([key, entry]) => sensitivePayloadPattern.test(key) || containsSensitiveField(entry));
}

async function pollSubmittedRun(
  endpoint: string,
  runId: string,
  spec: CoreReadTaskSpec,
  options: CoreTaskSubmitOptions,
) {
  let lastError = "";
  const attempts = Math.max(1, options.pollAttempts ?? 30);
  const intervalMs = Math.max(0, options.pollIntervalMs ?? 1000);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const projection = await fetchCoreRunProjectionById(endpoint, runId, spec);
    if (projection.ok) return projection;
    lastError = projection.error;
    if (attempt + 1 < attempts && intervalMs > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, intervalMs));
    }
  }
  return { ok: false as const, error: `Core run ${runId} was accepted but not yet queryable: ${lastError}` };
}

async function requestJson(base: string, path: string, init: RequestInit & { includeErrorBody?: boolean }): Promise<unknown> {
  return requestOwnerJson(base, path, {
    method: init.method === "POST" || init.method === "PATCH" || init.method === "DELETE" ? init.method : "GET",
    body: typeof init.body === "string" ? parseJson(init.body) : undefined,
    timeoutMs: path === "/tasks" && init.method === "POST" ? 65_000 : 3500,
    includeErrorBody: init.includeErrorBody,
  });
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function runIdFromSubmitResponse(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const task = recordValue(value.task);
  const run = recordValue(value.run);
  return stringValue(value.run_id) ?? stringValue(task?.run_id) ?? stringValue(run?.run_id);
}

function isOkResponse(value: unknown) {
  return isRecord(value) && value.ok === true;
}

function responseError(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback;
  const error = recordValue(value.error) ?? recordValue(value.failure);
  return stringValue(error?.message) ?? stringValue(error?.code) ?? stringValue(value.error) ?? fallback;
}

export function coreTaskSubmitFailureSummary(value: unknown, fallback: string) {
  const recoveryCode = coreTaskRecoveryCode(value);
  if (["browser_environment_repair_required", "repair_browser_environment", "identity_storage_unavailable",
    "browser_provider_unavailable", "identity_environment_unavailable", "connect_identity_environment", "install_or_select_provider",
    "profile_locked", "launch_failed", "runtime_session_busy", "core_task_session_lock_mismatch", "provider_conflict", "fingerprint_conflict", "resource_unavailable"].includes(recoveryCode ?? "")) {
    return "需要修复浏览器环境后重试。";
  }
  if (recoveryCode === "identity_auth_required" || recoveryCode === "open_manual_auth") {
    return "需要登录或完成人工认证后重试。";
  }
  return responseError(value, fallback);
}

function coreTaskRecoveryCode(value: unknown) {
  if (!isRecord(value)) return undefined;
  const records = [value, recordValue(value.body)].filter((item): item is Record<string, unknown> => item != null);
  const candidates = records.flatMap((record) => {
    const error = recordValue(record.error) ?? recordValue(record.failure);
    return [error?.recovery_action, error?.recoveryAction, error?.recovery_hint, error?.recoveryHint,
      error?.code, record.recovery_action, record.recoveryAction, record.recovery_hint, record.recoveryHint, record.error]
      .map(stringValue)
      .filter((item): item is string => item != null);
  });
  const knownCodes = [
    "browser_environment_repair_required",
    "repair_browser_environment",
    "identity_storage_unavailable",
    "browser_provider_unavailable",
    "identity_environment_unavailable",
    "connect_identity_environment",
    "install_or_select_provider",
    "profile_locked",
    "launch_failed",
    "runtime_session_busy",
    "core_task_session_lock_mismatch",
    "provider_conflict",
    "fingerprint_conflict",
    "resource_unavailable",
    "identity_auth_required",
    "open_manual_auth",
  ];
  return knownCodes.find((code) => candidates.some((candidate) => candidate === code || candidate.includes(`: ${code}`)));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
