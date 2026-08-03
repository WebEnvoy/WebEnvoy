import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { requestOwnerJson } from "./ownerApiClient";

type JsonRecord = Record<string, unknown>;

export type ExecutionCategory = "read" | "prepare" | "commit" | "destructive";
export type ExecutionMode = "auto" | "confirm" | "deny";
export type ExecutionPolicySource = "thread_revision" | "installed_skill_user_version" | "global_user_config";
export type ExecutionPolicyModes = Partial<Record<ExecutionCategory, ExecutionMode>>;

export type EffectiveExecutionAction = {
  actionId: string;
  category: ExecutionCategory;
  riskMarker: "destructive" | null;
  targetScope: {
    siteSlug: string;
    targetTypes: string[];
    supportedOrigins: string[];
  };
  policy: null | {
    mode: ExecutionMode;
    source: ExecutionPolicySource;
    sourceRef: string;
    sourceVersion: string;
  };
};

export type EffectiveExecutionPolicy = {
  skillRef: string;
  threadRef?: string;
  turnSequence?: number;
  actions: EffectiveExecutionAction[];
};

export type ExecutionPolicyConfiguration = {
  source: ExecutionPolicySource;
  sourceVersion: string;
  modes: ExecutionPolicyModes;
};

export type ExecutionPolicyConfigurationLoadState =
  | { status: "ready"; configuration: ExecutionPolicyConfiguration | null }
  | { status: "unavailable"; summary: string };

export type ExecutionPolicyLoadState =
  | { status: "loading"; summary: string }
  | { status: "ready"; summary: string; policy: EffectiveExecutionPolicy }
  | { status: "unavailable"; summary: string };

const categories = new Set<ExecutionCategory>(["read", "prepare", "commit", "destructive"]);
const modes = new Set<ExecutionMode>(["auto", "confirm", "deny"]);
const sources = new Set<ExecutionPolicySource>(["thread_revision", "installed_skill_user_version", "global_user_config"]);
const boundary = "Business action modes and versioned owner refs only; credentials, browser storage, raw evidence, page content, and App drafts are excluded.";

export function loadingExecutionPolicyState(): ExecutionPolicyLoadState {
  return { status: "loading", summary: "正在读取当前执行方式。" };
}

export async function fetchEffectiveExecutionPolicy(
  endpoint: string,
  skillRef: string,
  threadRef?: string,
): Promise<ExecutionPolicyLoadState> {
  const query = new URLSearchParams({ skill_ref: skillRef });
  if (threadRef) query.set("thread_ref", threadRef);
  return readEffectivePolicy(endpoint, `/execution-policies/effective?${query.toString()}`);
}

export async function putThreadExecutionPolicy(
  endpoint: string,
  threadRef: string,
  skillRef: string,
  modesValue: ExecutionPolicyModes,
  expectedSourceVersion: string | null,
): Promise<ExecutionPolicyLoadState> {
  const query = new URLSearchParams({ skill_ref: skillRef });
  return writeExecutionPolicy(
    endpoint,
    `/threads/${encodeURIComponent(threadRef)}/execution-policy?${query.toString()}`,
    modesValue,
    expectedSourceVersion,
  );
}

export async function putSkillExecutionPolicy(
  endpoint: string,
  skillRef: string,
  modesValue: ExecutionPolicyModes,
  expectedSourceVersion: string | null,
): Promise<ExecutionPolicyLoadState> {
  const query = new URLSearchParams({ skill_ref: skillRef });
  return writeExecutionPolicy(
    endpoint,
    `/execution-policy-configs/skill?${query.toString()}`,
    modesValue,
    expectedSourceVersion,
  );
}

export async function fetchSkillExecutionPolicyConfiguration(
  endpoint: string,
  skillRef: string,
): Promise<ExecutionPolicyConfigurationLoadState> {
  const query = new URLSearchParams({ skill_ref: skillRef });
  try {
    const response = await requestOwnerJson(endpoint, `/execution-policy-configs/skill?${query.toString()}`, {
      timeoutMs: 3500,
    });
    const record = asRecord(response);
    if (record?.ok !== true) return unavailableConfiguration(response, "Core 未返回技能执行方式配置。");
    if (record.configuration === null) return { status: "ready", configuration: null };
    const configuration = parseConfiguration(record.configuration, "installed_skill_user_version");
    return configuration == null
      ? { status: "unavailable", summary: "Core 返回了不兼容的技能执行方式配置。" }
      : { status: "ready", configuration };
  } catch (error) {
    return { status: "unavailable", summary: `技能执行方式配置读取失败：${message(error)}` };
  }
}

export function declaredExecutionCategories(skill: LodeCatalogSkill) {
  return Array.from(new Set(skill.actions.map((action) => action.category)));
}

export function policyModesByCategory(policy: EffectiveExecutionPolicy): ExecutionPolicyModes {
  return Object.fromEntries(policy.actions.flatMap((action) =>
    action.policy == null ? [] : [[action.category, action.policy.mode]],
  ));
}

export function executionPolicyModeMutation(
  effectiveModes: ExecutionPolicyModes,
  modifiedCategories: Iterable<ExecutionCategory>,
): ExecutionPolicyModes {
  return Object.fromEntries([...modifiedCategories].flatMap((category) => {
    const mode = effectiveModes[category];
    return mode == null ? [] : [[category, mode]];
  })) as ExecutionPolicyModes;
}

export function policySourceForCategory(policy: EffectiveExecutionPolicy, category: ExecutionCategory) {
  return policy.actions.find((action) => action.category === category)?.policy ?? null;
}

export function policySourceLabel(source: ExecutionPolicySource) {
  if (source === "thread_revision") return "当前线程";
  if (source === "installed_skill_user_version") return "我的技能默认";
  return "全局默认";
}

export function sourceVersionForPolicy(policy: EffectiveExecutionPolicy, source: ExecutionPolicySource) {
  return policy.actions.find((action) => action.policy?.source === source)?.policy?.sourceVersion ?? null;
}

async function readEffectivePolicy(endpoint: string, path: string): Promise<ExecutionPolicyLoadState> {
  try {
    const response = await requestOwnerJson(endpoint, path, { timeoutMs: 3500 });
    const record = asRecord(response);
    const policy = parseEffectivePolicy(record?.execution_policy);
    if (record?.ok !== true || policy == null) return unavailable(response, "Core 未返回可消费的当前执行方式。");
    return { status: "ready", summary: "已读取 Core 当前有效执行方式。", policy };
  } catch (error) {
    return { status: "unavailable", summary: `当前执行方式读取失败：${message(error)}` };
  }
}

async function writeExecutionPolicy(
  endpoint: string,
  path: string,
  modesValue: ExecutionPolicyModes,
  expectedSourceVersion: string | null,
): Promise<ExecutionPolicyLoadState> {
  if (!validMutationModes(modesValue)) return { status: "unavailable", summary: "执行方式包含未声明的类别或取值。" };
  try {
    const response = await requestOwnerJson(endpoint, path, {
      method: "PUT",
      timeoutMs: 5000,
      body: {
        schema_version: "webenvoy.execution-policy-mutation.v0",
        idempotency_key: `app-policy-${crypto.randomUUID()}`,
        expected_source_version: expectedSourceVersion,
        modes: modesValue,
      },
    });
    const record = asRecord(response);
    const policy = parseEffectivePolicy(record?.execution_policy);
    if (record?.ok !== true || policy == null) return unavailable(response, "Core 未接受执行方式修订。");
    return { status: "ready", summary: "执行方式已保存。", policy };
  } catch (error) {
    return { status: "unavailable", summary: `执行方式保存失败：${message(error)}` };
  }
}

function parseEffectivePolicy(value: unknown): EffectiveExecutionPolicy | null {
  const record = asRecord(value);
  if (!record || record.schema_version !== "webenvoy.execution-policy-effective-view.v0" ||
    typeof record.skill_ref !== "string" || record.consumer_boundary !== boundary || !Array.isArray(record.actions)) return null;
  const actions = record.actions.map(parseAction);
  if (!actions.every((action): action is EffectiveExecutionAction => action != null)) return null;
  const threadRef = typeof record.thread_ref === "string" ? record.thread_ref : undefined;
  const turnSequence = Number.isInteger(record.turn_sequence) ? Number(record.turn_sequence) : undefined;
  if ((threadRef == null) !== (turnSequence == null)) return null;
  return { skillRef: record.skill_ref, ...(threadRef ? { threadRef, turnSequence } : {}), actions };
}

function parseAction(value: unknown): EffectiveExecutionAction | null {
  const record = asRecord(value);
  const target = asRecord(record?.target_scope);
  if (!record || typeof record.action_id !== "string" || !categories.has(record.category as ExecutionCategory) ||
    !target || typeof target.site_slug !== "string" || !stringArray(target.target_types) || !stringArray(target.supported_origins) ||
    (record.risk_marker !== null && record.risk_marker !== "destructive")) return null;
  const policy = record.effective_policy === null ? null : parseEffectiveActionPolicy(record.effective_policy);
  if (record.effective_policy !== null && policy == null) return null;
  if (policy == null && record.stop_reason !== "policy_unavailable") return null;
  return {
    actionId: record.action_id,
    category: record.category as ExecutionCategory,
    riskMarker: record.risk_marker as "destructive" | null,
    targetScope: { siteSlug: target.site_slug, targetTypes: target.target_types, supportedOrigins: target.supported_origins },
    policy,
  };
}

function parseEffectiveActionPolicy(value: unknown): EffectiveExecutionAction["policy"] {
  const record = asRecord(value);
  return record && modes.has(record.mode as ExecutionMode) && sources.has(record.source as ExecutionPolicySource) &&
    typeof record.source_ref === "string" && typeof record.source_version === "string"
    ? { mode: record.mode as ExecutionMode, source: record.source as ExecutionPolicySource, sourceRef: record.source_ref, sourceVersion: record.source_version }
    : null;
}

function parseConfiguration(value: unknown, expectedSource: ExecutionPolicySource): ExecutionPolicyConfiguration | null {
  const record = asRecord(value);
  if (record?.schema_version !== "webenvoy.execution-policy-configuration.v0" ||
    record.source !== expectedSource || typeof record.source_version !== "string" ||
    record.consumer_boundary !== boundary) return null;
  const parsedModes = parseModes(record.modes);
  return parsedModes == null ? null : {
    source: expectedSource,
    sourceVersion: record.source_version,
    modes: parsedModes,
  };
}

function parseModes(value: unknown): ExecutionPolicyModes | null {
  const record = asRecord(value);
  if (record == null || Object.keys(record).some((category) => !categories.has(category as ExecutionCategory)) ||
    Object.values(record).some((mode) => !modes.has(mode as ExecutionMode))) return null;
  return record as ExecutionPolicyModes;
}

function validMutationModes(value: ExecutionPolicyModes) {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([category, mode]) => categories.has(category as ExecutionCategory) && modes.has(mode));
}

function unavailable(value: unknown, fallback: string): ExecutionPolicyLoadState {
  const record = asRecord(value);
  const error = asRecord(record?.error);
  const detail = typeof error?.code === "string" ? error.code : typeof record?.error === "string" ? record.error : fallback;
  return { status: "unavailable", summary: detail };
}

function unavailableConfiguration(value: unknown, fallback: string): ExecutionPolicyConfigurationLoadState {
  const state = unavailable(value, fallback);
  return { status: "unavailable", summary: state.summary };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
