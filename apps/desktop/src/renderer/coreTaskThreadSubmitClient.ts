import type { EffectiveExecutionPolicy, ExecutionPolicyModes } from "./executionPolicyClient";
import { coreTaskSubmitFailureSummary } from "./coreTaskSubmitClient";
import { fetchEffectiveExecutionPolicy, putThreadExecutionPolicy, sourceVersionForPolicy } from "./executionPolicyClient";
import type { HarborIdentityLoadState } from "./harborIdentityTypes";
import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { requestOwnerJson } from "./ownerApiClient";
import { runtimeService, type RuntimeSupervisorState } from "./runtimeSupervisorState";
import {
  isOpaqueDetailRef,
  isXiaohongshuDetailHandoffSkill,
  xiaohongshuDetailHandoff,
} from "./resultDetailHandoff";
import type { SkillInputDraft, SkillInputValue } from "./skillInputDraft";
import type { SkillInputProjectionRefs } from "./skillInputOwnerClient";
import { projectCoreThreadResponse } from "./coreThreadClient";
import type { CoreThreadInputSnapshot } from "./coreThreadInputContract";
import type { TaskProjection } from "./taskThreadFixtures";

type Identity = HarborIdentityLoadState["identities"][number];
type JsonRecord = Record<string, unknown>;
const xiaohongshuSearchPackageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";

export type TaskThreadSubmitState =
  | { status: "idle"; summary: string }
  | { status: "submitting"; summary: string }
  | { status: "blocked" | "failed"; summary: string; task?: TaskProjection }
  | { status: "unknown"; summary: string; attempt: TaskTurnSubmissionAttempt; task?: TaskProjection }
  | { status: "ready"; summary: string; task: TaskProjection };

export type TaskTurnSubmissionAttempt = {
  threadRef: string;
  idempotencyKey: string;
};

export const initialTaskThreadSubmitState: TaskThreadSubmitState = {
  status: "idle",
  summary: "填写技能声明的业务输入后提交。",
};

export async function createTaskThreadTurn(options: SubmitOptions & {
  threadModes: ExecutionPolicyModes;
  threadModeOverrides: ExecutionPolicyModes;
}) {
  const prepared = prepareTaskTurnRequest(options, options.threadModes);
  if (!prepared.ok) return blocked(prepared.reason);
  const created = await requestOwnerJson(options.endpoint, "/threads", {
    method: "POST",
    timeoutMs: 5000,
    body: { capability_ref: prepared.capabilityRef, identity_environment_ref: options.identity.identityEnvironmentRef },
  });
  const threadTask = projectCoreThreadResponse(created);
  if (threadTask == null) return failed(created, "Core 未返回可消费的任务线程。");
  const createdRecord = asRecord(created);
  if (typeof createdRecord?.created !== "boolean") return failed(created, "Core 未声明任务线程是新建还是复用。");
  let expectedThreadVersion: string | null = null;
  let effectivePolicy = options.executionPolicy;
  if (!createdRecord.created) {
    const currentPolicy = await fetchEffectiveExecutionPolicy(options.endpoint, options.skill.packageRef, threadTask.id);
    if (currentPolicy.status !== "ready") {
      return withExactSkillPackage({ status: "failed" as const, summary: currentPolicy.summary, task: threadTask }, options.skill);
    }
    expectedThreadVersion = sourceVersionForPolicy(currentPolicy.policy, "thread_revision");
    effectivePolicy = currentPolicy.policy;
  }
  if (Object.keys(options.threadModeOverrides).length > 0) {
    const policy = await putThreadExecutionPolicy(
      options.endpoint,
      threadTask.id,
      options.skill.packageRef,
      options.threadModeOverrides,
      expectedThreadVersion,
    );
    if (policy.status !== "ready") {
      return withExactSkillPackage({ status: "failed" as const, summary: policy.summary, task: threadTask }, options.skill);
    }
    effectivePolicy = policy.policy;
  }
  const policyBlock = executionPolicyReadiness(options.skill, effectivePolicy);
  if (policyBlock != null) {
    return withExactSkillPackage({ status: "blocked" as const, summary: policyBlock, task: threadTask }, options.skill);
  }
  const result = await appendPreparedTurn(options.endpoint, threadTask.id, prepared.request);
  return withExactSkillPackage(result, options.skill);
}

export async function appendTaskThreadTurn(options: SubmitOptions & { threadRef: string }) {
  const prepared = prepareTaskTurnRequest(options);
  if (!prepared.ok) return blocked(prepared.reason);
  return withExactSkillPackage(await appendPreparedTurn(options.endpoint, options.threadRef, prepared.request), options.skill);
}

export async function cancelTaskThreadTurn(endpoint: string, threadRef: string, turnId: string): Promise<TaskThreadSubmitState> {
  const response = await requestOwnerJson(
    endpoint,
    `/threads/${encodeURIComponent(threadRef)}/turns/${encodeURIComponent(turnId)}/terminate`,
    { method: "POST", timeoutMs: 5000 },
  );
  const task = projectCoreThreadResponse(response);
  const record = asRecord(response);
  if (task == null) return failed(response, "Core 未返回取消后的任务线程状态。");
  return record?.ok === true
    ? { status: "ready", summary: "当前回合已停止，业务输入草稿保持不变。", task }
    : { status: "failed", summary: ownerError(response, "Core 未接受停止当前回合的请求。"), task };
}

type SubmitOptions = {
  endpoint: string;
  skill: LodeCatalogSkill;
  identity: Identity;
  draft: SkillInputDraft;
  ownerRefs: SkillInputProjectionRefs;
  executionPolicy: EffectiveExecutionPolicy;
  runtime: RuntimeSupervisorState;
  ownerTargetRef?: string;
};

async function appendPreparedTurn(endpoint: string, threadRef: string, request: JsonRecord): Promise<TaskThreadSubmitState> {
  const attempt = submissionAttempt(threadRef, request);
  if (attempt == null) return blocked("任务回合缺少稳定提交标识，提交保持停止。");
  const response = await requestOwnerJson(endpoint, `/threads/${encodeURIComponent(threadRef)}/turns`, {
    method: "POST",
    timeoutMs: 65_000,
    body: request,
    includeErrorBody: true,
  });
  const record = asRecord(response);
  const responseBody = asRecord(record?.body);
  const taskPayload = projectCoreThreadResponse(response) == null ? responseBody : response;
  const task = projectCoreThreadResponse(taskPayload);
  const status = typeof record?.status === "number" ? record.status : null;
  if (task == null) {
    return status != null && status >= 400 && status < 500 && !isTerminalRuntimeFailure(response)
      ? failed(response, "Core 未接受当前任务回合。")
      : reconcileTaskThreadTurn(endpoint, attempt);
  }
  const turn = turnForAttempt(taskPayload, attempt.idempotencyKey);
  if (turn == null) return status != null && status >= 400 && status < 500
    ? { status: "failed", summary: ownerError(response, "Core 未接受当前任务回合。"), task }
    : unknownAttempt(attempt, task);
  if (turn.status === "status_unknown" || turn.status === "submitting") return unknownAttempt(attempt, task);
  if (turn.status === "failed" || turn.status === "cancelled" || turn.submission_state === "rejected") {
    return { status: "failed", summary: ownerError(response, "Core 已确认当前任务回合未被接受。"), task };
  }
  return { status: "ready", summary: "任务回合已由 Core 接受。", task };
}

export async function reconcileTaskThreadTurn(
  endpoint: string,
  attempt: TaskTurnSubmissionAttempt,
): Promise<TaskThreadSubmitState> {
  const response = await requestOwnerJson(endpoint, `/threads/${encodeURIComponent(attempt.threadRef)}`, { timeoutMs: 5000 });
  const task = projectCoreThreadResponse(response);
  const turn = turnForAttempt(response, attempt.idempotencyKey);
  if (task == null || turn == null) return unknownAttempt(attempt, task ?? undefined);
  if (turn.status === "status_unknown" || turn.status === "submitting") return unknownAttempt(attempt, task);
  if (turn.status === "failed" || turn.status === "cancelled" || turn.submission_state === "rejected") {
    return { status: "failed", summary: "Core 已确认该提交没有进入可继续执行的回合。", task };
  }
  return { status: "ready", summary: "已按原提交标识确认任务回合由 Core 接受。", task };
}

export function prepareTaskTurnRequest(options: SubmitOptions, requestedModes?: ExecutionPolicyModes): { ok: true; capabilityRef: string; request: JsonRecord } | { ok: false; reason: string } {
  const readiness = submissionReadiness(options, requestedModes);
  if (readiness != null) return { ok: false, reason: readiness };
  const action = options.skill.actions[0]!;
  const target = taskTarget(options.skill, options.identity, options.draft, options.ownerTargetRef);
  if (!target.ok) return target;
  const publicQuery = publicQueryForSkill(options.skill, options.draft);
  if (!publicQuery.ok) return publicQuery;
  const snapshot = buildCoreThreadInputSnapshot(options.skill, options.draft, options.ownerRefs);
  if (!snapshot.ok) return snapshot;
  const capabilityRef = capabilityRefForSkill(options.skill);
  const runId = `app-${options.skill.siteSlug}-${crypto.randomUUID()}`;
  const resourceRefs = Array.from(new Set(options.skill.actions.map((item) => item.resourceRequirementRef)));
  return {
    ok: true,
    capabilityRef,
    request: {
      idempotency_key: `app-turn-${crypto.randomUUID()}`,
      run_id: runId,
      input_snapshot: snapshot.value,
      package_ref: options.skill.packageRef,
      ...(publicQuery.value == null ? {} : { public_query: publicQuery.value }),
      task_intent: {
        schema_version: "webenvoy.task-intent.v0",
        intent_id: `intent_${runId}`,
        entrypoint: "app",
        user_intent: { summary: options.skill.name },
        capability: {
          ref: capabilityRef,
          version: options.skill.version,
          source_ref: options.skill.packageRef,
          ...(options.skill.lockRef ? { lock_ref: options.skill.lockRef } : {}),
        },
        input: { summary: options.skill.name, refs: [target.ref] },
        scope: { target_type: target.targetType, target_ref: target.ref },
        policy: {
          risk: action.category === "read" ? "read" : "write",
          execution_intent: action.operationMode,
          timeout_ms: 60_000,
        },
        resource_requirement_refs: resourceRefs,
        resource_requirement_profile_id: action.resourceRequirementProfileIds[0],
        evidence_policy_ref: "policy:no-raw-evidence",
      },
      harbor: {
        identity_environment_ref: options.identity.identityEnvironmentRef,
        ...(target.url == null ? {} : { url: target.url }),
        reuse_existing: true,
        timeout_ms: 60_000,
      },
    },
  };
}

function submissionReadiness(options: SubmitOptions, requestedModes?: ExecutionPolicyModes) {
  const core = runtimeService(options.runtime, "core");
  const harbor = runtimeService(options.runtime, "harbor");
  if (!options.runtime.canUseLiveRuntime || core?.health.state !== "ready" || core.admission?.state !== "ready" || harbor?.health.state !== "ready") {
    return "Core 或 Harbor live runtime 尚未 ready；提交保持停止。";
  }
  if (options.identity.source !== "Harbor live") return "账号身份尚未由 Harbor live 证明可用。";
  if (options.identity.readiness.state === "blocked") return "需要修复浏览器环境后再提交。";
  if (options.identity.readiness.state === "needs-auth" || options.identity.login.recoveryRequired) {
    return "需要登录或完成人工认证后再提交。";
  }
  if (options.identity.readiness.state === "unknown") return "账号身份状态尚未确认；提交保持停止。";
  if (
    options.skill.actions.length !== 1 ||
    options.skill.actions[0]?.operationMode !== "read" ||
    options.skill.actions[0].resourceRequirementProfileIds.length !== 1
  ) {
    return "当前 Core 仅接入已声明的单一只读动作；准备、发布与危险行为保持停止。";
  }
  if (requestedModes != null) {
    const categories = new Set(options.skill.actions.map((action) => action.category));
    if ([...categories].some((category) => requestedModes[category] == null)) return "当前动作无法取得完整有效执行方式；提交保持停止。";
    if ([...categories].some((category) => requestedModes[category] === "deny")) return "当前动作的有效执行方式为“禁止”。";
    return null;
  }
  return executionPolicyReadiness(options.skill, options.executionPolicy);
}

function executionPolicyReadiness(skill: LodeCatalogSkill, policy: EffectiveExecutionPolicy) {
  if (policy.skillRef !== skill.packageRef || policy.actions.length !== skill.actions.length ||
    skill.actions.some((declared) => !policy.actions.some((action) =>
      action.actionId === declared.id && action.category === declared.category && action.policy != null))) {
    return "当前动作无法取得完整有效执行方式；提交保持停止。";
  }
  if (policy.actions.some((action) => action.policy?.mode === "deny")) return "当前动作的有效执行方式为“禁止”。";
  return null;
}

function taskTarget(skill: LodeCatalogSkill, identity: Identity, draft: SkillInputDraft, ownerTargetRef?: string) {
  const action = skill.actions[0]!;
  if (ownerTargetRef != null) {
    if (
      !isXiaohongshuDetailHandoffSkill(skill) ||
      identity.siteId !== xiaohongshuDetailHandoff.siteSlug ||
      !isOpaqueDetailRef(ownerTargetRef)
    ) return { ok: false as const, reason: "详情目标与技能、版本或账号身份不匹配。" };
    return { ok: true as const, ref: ownerTargetRef, targetType: xiaohongshuDetailHandoff.targetType };
  }
  const rawUrl = skill.packageRef === xiaohongshuSearchPackageRef
    ? identity.origin
    : stringValue(draft.values.url) || identity.origin;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false as const, reason: "目标网址无效。" }; }
  if (url.username || url.password || !action.supportedOrigins.includes(url.origin) || url.origin !== new URL(identity.origin).origin) {
    return { ok: false as const, reason: "目标网址与技能或账号身份声明的站点不匹配。" };
  }
  if (skill.packageRef.includes("/search-notes@")) {
    url = new URL("/search_result", url.origin);
    url.searchParams.set("keyword", stringValue(draft.values.keyword));
    url.searchParams.set("source", "web_search_result_notes");
  }
  if (skill.packageRef.includes("/job-search@")) {
    url = new URL("/web/geek/job", url.origin);
    url.searchParams.set("query", stringValue(draft.values.query));
    url.searchParams.set("city", stringValue(draft.values.city_code));
  }
  return {
    ok: true as const,
    ref: url.href,
    url: url.href,
    targetType: skill.packageRef.includes("/job-search@") ? "boss_job_search" : action.targetTypes[0]!,
  };
}

function publicQueryForSkill(skill: LodeCatalogSkill, draft: SkillInputDraft) {
  if (skill.packageRef.includes("/search-notes@")) {
    const query = stringValue(draft.values.keyword).trim();
    const limitValue = stringValue(draft.values.limit).trim() ||
      String(skill.inputFields.find((field) => field.id === "limit")?.defaultValue ?? "");
    const limit = Number(limitValue);
    if (!query) return { ok: false as const, reason: "搜索关键词不能为空。" };
    if (limitValue && (!Number.isInteger(limit) || limit < 1 || limit > 15)) {
      return { ok: false as const, reason: "小红书搜索数量必须为 1..15。" };
    }
    return { ok: true as const, value: { query, ...(limitValue ? { limit } : {}) } };
  }
  if (skill.packageRef.includes("/job-search@")) {
    const query = stringValue(draft.values.query).trim();
    const cityCode = stringValue(draft.values.city_code);
    const page = Number(stringValue(draft.values.page));
    const limit = Number(stringValue(draft.values.limit));
    return query && /^\d{6,32}$/.test(cityCode) && page === 1 && Number.isInteger(limit) && limit >= 1 && limit <= 15
      ? { ok: true as const, value: { query, city_code: cityCode, page: 1, limit } }
      : { ok: false as const, reason: "职位搜索条件不符合当前 Core 合同。" };
  }
  return { ok: true as const, value: null };
}

export function projectTaskSubmissionSkill(skill: LodeCatalogSkill): LodeCatalogSkill {
  if (skill.packageRef !== xiaohongshuSearchPackageRef) return skill;
  return {
    ...skill,
    inputFields: skill.inputFields
      .filter((field) => field.id !== "url")
      .map((field) => field.id === "limit" ? { ...field, maximum: Math.min(field.maximum ?? 15, 15) } : field),
  };
}

export function buildCoreThreadInputSnapshot(
  skill: LodeCatalogSkill,
  draft: SkillInputDraft,
  refs: SkillInputProjectionRefs,
): { ok: true; value: CoreThreadInputSnapshot } | { ok: false; reason: string } {
  const fields: CoreThreadInputSnapshot["fields"] = [];
  const attachmentRefs: string[] = [];
  for (const field of skill.inputFields) {
    const value = draft.values[field.id];
    const files = draft.files[field.id] ?? [];
    if (!hasValue(value) && files.length === 0) continue;
    if (field.inputProjection === "safe_summary") {
      const summary = boundedScalarSummary(value);
      if (summary == null) return { ok: false, reason: `字段“${field.label}”无法生成安全的简短摘要。` };
      fields.push({ field_id: field.id, kind: "scalar", summary });
      continue;
    }
    if (field.inputProjection === "sanitized_url") {
      const summary = publicUrlSummary(value);
      if (summary == null) return { ok: false, reason: `字段“${field.label}”无法生成安全的网址摘要。` };
      fields.push({ field_id: field.id, kind: "url", summary });
      continue;
    }
    if (field.inputProjection === "owner_ref" && field.kind === "file") {
      const fileRefs = refs.attachmentRefs[field.id] ?? [];
      const ownerRef = refs.fieldOwnerRefs[field.id];
      if (fileRefs.length !== files.length) return { ok: false as const, reason: `字段“${field.label}”缺少附件 owner 引用。` };
      if (!ownerRef) return { ok: false as const, reason: `字段“${field.label}”缺少受保护 owner 引用。` };
      fields.push({ field_id: field.id, kind: "file", owner_ref: ownerRef });
      attachmentRefs.push(...fileRefs);
      continue;
    }
    if (field.inputProjection === "owner_ref") {
      const ownerRef = refs.fieldOwnerRefs[field.id];
      if (!ownerRef) return { ok: false as const, reason: `字段“${field.label}”缺少受保护 owner 引用。` };
      fields.push({ field_id: field.id, kind: "long_text", owner_ref: ownerRef });
      continue;
    }
    return { ok: false, reason: `字段“${field.label}”的类型尚未声明，提交保持停止。` };
  }
  if (fields.length > 64) return { ok: false, reason: "业务输入字段超过 Core 支持的上限。" };
  if (attachmentRefs.length > 32 || new Set(attachmentRefs).size !== attachmentRefs.length) {
    return { ok: false, reason: "附件引用超过 Core 支持的上限或包含重复项。" };
  }
  return {
    ok: true as const,
    value: {
      schema_version: "webenvoy.task-turn-input.v0",
      fields,
      attachment_refs: attachmentRefs,
      consumer_boundary: "Core stores bounded field summaries and owner refs only; raw content remains with its owner.",
    },
  };
}

function capabilityRefForSkill(skill: LodeCatalogSkill) {
  const match = /^lode:\/\/site-capability\/[^/]+\/([^@]+)@/.exec(skill.packageRef);
  return `lode:capability/${match?.[1] ?? "invalid"}`;
}

function boundedScalarSummary(value: SkillInputValue | undefined) {
  const summary = (Array.isArray(value) ? value.join(", ") : String(value ?? "")).trim();
  return summary.length >= 1 && summary.length <= 512 ? summary : null;
}

function publicUrlSummary(value: SkillInputValue | undefined) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.href.length <= 512 ? url.href : null;
  } catch {
    return null;
  }
}

function stringValue(value: SkillInputValue | undefined) {
  return typeof value === "string" ? value : "";
}

function hasValue(value: SkillInputValue | undefined) {
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.length > 0 : value !== undefined;
}

function blocked(reason: string): TaskThreadSubmitState {
  return { status: "blocked", summary: reason };
}

function submissionAttempt(threadRef: string, request: JsonRecord): TaskTurnSubmissionAttempt | null {
  return typeof request.idempotency_key === "string" && request.idempotency_key.length > 0
    ? { threadRef, idempotencyKey: request.idempotency_key }
    : null;
}

function unknownAttempt(attempt: TaskTurnSubmissionAttempt, task?: TaskProjection): TaskThreadSubmitState {
  return {
    status: "unknown",
    summary: "提交响应状态未知；请重新检查 Core 线程事实，不会生成新的提交标识。",
    attempt,
    ...(task == null ? {} : { task }),
  };
}

function withExactSkillPackage(state: TaskThreadSubmitState, skill: LodeCatalogSkill): TaskThreadSubmitState {
  if (!("task" in state) || state.task == null) return state;
  return {
    ...state,
    task: {
      ...state.task,
      packageSource: {
        ...state.task.packageSource,
        version: skill.version,
        sourceRef: skill.packageRef,
        ...(skill.lockRef == null ? {} : { lockRef: skill.lockRef }),
      },
    },
  };
}

function turnForAttempt(value: unknown, idempotencyKey: string) {
  const record = asRecord(value);
  const thread = asRecord(record?.thread);
  if (!Array.isArray(thread?.turns)) return null;
  return thread.turns.map(asRecord).find((turn) => turn?.idempotency_key === idempotencyKey) ?? null;
}

function failed(value: unknown, fallback: string): TaskThreadSubmitState {
  return { status: "failed", summary: ownerError(value, fallback) };
}

function ownerError(value: unknown, fallback: string) {
  return coreTaskSubmitFailureSummary(value, fallback);
}

function isTerminalRuntimeFailure(value: unknown) {
  const record = asRecord(value);
  const body = asRecord(record?.body);
  const error = asRecord(body?.error);
  return error?.category === "runtime_execution";
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}
