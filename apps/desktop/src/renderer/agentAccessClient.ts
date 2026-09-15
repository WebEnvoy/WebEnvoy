import { requestOwnerJson } from "./ownerApiClient";

export type AgentPrincipal = { principal_id: string; display_name: string; revoked_at: string | null };
export type AgentConnection = { connection_id: string; principal_id: string; connected_at: string; revoked_at: string | null };
export type AgentGrant = {
  grant_id: string; principal_id: string; profile_refs: string[]; allowed_operations: string[];
  allowed_origins: string[]; expires_at: string; revoked_at: string | null;
  creation_template: { template_ref: string; provider_id: string | null } | null;
  max_created_profiles: number; created_profile_refs: string[];
  scope_semantics: "legacy_request_guard_v1" | "agent_operations_v2";
  skill_scope?: { skill_refs: string[]; source_refs: string[] };
  file_scope?: { upload_refs: string[]; allowed_mime_types: string[]; max_file_bytes: number };
};
export type AgentAccessState = {
  principals: AgentPrincipal[]; connections: AgentConnection[]; grants: AgentGrant[];
  profile_policies: AgentProfilePolicy[];
};
export type AgentProfilePolicy = { profile_ref: string; allowed_operations: string[]; allowed_origins: string[]; controlled_interaction_origins: string[]; scope_semantics: "legacy_request_guard_v1" | "agent_operations_v2" };

export const agentOperations = [
  ["profile.list", "列出 Profile"], ["profile.read", "读取 Profile"],
  ["provider.preference.read", "读取 Provider 新建默认"], ["provider.preference.set", "设置 Provider 新建默认"], ["provider.preference.clear", "清除 Provider 新建默认"],
  ["instance.start", "启动实例"], ["instance.stop", "停止实例"],
  ["instance.observe", "页面与身份事实"], ["instance.diagnostics", "网络与控制台诊断"], ["instance.handoff", "接管与交还"],
  ["environment.read", "读取环境连续性事实"], ["environment.update", "修改时区、语言或视口（重启后生效）"],
  ["instance.navigate", "导航"], ["instance.read", "公开正文读取"],
  ["page.list", "列出页面"], ["page.open", "打开后台页面"], ["page.activate", "激活页面"], ["page.close", "关闭页面"],
  ["page.navigate", "导航指定页面"], ["page.reload", "刷新指定页面"], ["page.back", "页面后退"], ["page.forward", "页面前进"],
  ["instance.snapshot", "观察受控页面控件"], ["instance.click", "点击"],
  ["instance.input", "填写非敏感字段"], ["instance.press", "按键"],
  ["instance.scroll", "滚动"], ["instance.wait", "等待页面变化"],
  ["recovery.inspect", "检查 Profile 恢复兼容性"], ["recovery.request", "请求恢复计划"], ["recovery.status", "查询恢复操作"],
] as const;
export const defaultAgentOperations = ["profile.list", "profile.read", "instance.observe", "environment.read", "instance.read"];
export const agentManagementScope = "只授权下方选择的 Profile、精确 origin 集合和必要操作。Profile 管理权不隐含网页输入权限。";
export type AgentScopeInput = { origin: string; origins?: string[]; operations: string[]; controlled: boolean };

function selectedScope(input: AgentScopeInput) {
  const origins = [...new Set((input.origins?.length ? input.origins : [input.origin]).map(value => value.trim()).filter(Boolean))];
  if (!origins.length) throw new Error("至少需要一个精确 origin。");
  for (const origin of origins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new Error("请输入精确 origin（协议、主机及可选端口），不含路径、查询串或片段。");
  }
  if (!input.operations.length) throw new Error("请选择必要操作。");
  if (input.operations.some(operation => !agentOperations.some(([id]) => id === operation))) throw new Error("请选择有效操作。");
  return { allowed_operations: [...input.operations], allowed_origins: origins, controlled_interaction_origins: input.controlled ? origins : [] };
}

export function createProfilePolicyInput(profileRef: string, input: AgentScopeInput, key: string) {
  if (!profileRef) throw new Error("请选择受管 Profile。");
  return { idempotency_key: key, profile_ref: profileRef, ...selectedScope(input) };
}

export function createAgentGrantInput(principalId: string, hours: number, key: string, input: AgentScopeInput, profileRef = "", templateProviderId: string | null = null) {
  if (!principalId || ![1, 24, 168].includes(hours)) throw new Error("请选择 Agent 和授权时限。");
  const ceiling = selectedScope(input);
  if (!profileRef && ceiling.allowed_origins.length !== 1) throw new Error("创建模板需要一个站点 origin；多个 origin 请先选择已有 Profile。");
  return {
    idempotency_key: key,
    principal_id: principalId,
    profile_refs: profileRef ? [profileRef] : [],
    allowed_operations: profileRef ? ceiling.allowed_operations : ["profile.create", ...ceiling.allowed_operations],
    allowed_origins: ceiling.allowed_origins,
    expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
    max_created_profiles: profileRef ? 0 : 2,
    creation_template: profileRef ? null : {
      template_ref: crypto.randomUUID(),
      provider_id: templateProviderId,
      site: { site_id: "generic", origin: ceiling.allowed_origins[0], display_name: "非生产浏览器" },
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      permission_ceiling: ceiling,
    },
  };
}

export function createAgentOperationsV2Input(grant: AgentGrant, policy: AgentProfilePolicy, key: string) {
  if (grant.scope_semantics !== "legacy_request_guard_v1" || policy.scope_semantics !== "legacy_request_guard_v1" || grant.revoked_at !== null || Date.parse(grant.expires_at) <= Date.now() || !grant.profile_refs.includes(policy.profile_ref)) throw new Error("请选择当前有效的 legacy 授权与其 Profile。");
  const allowedOperations = grant.allowed_operations.filter(operation => operation !== "profile.create" && policy.allowed_operations.includes(operation));
  const allowedOrigins = grant.allowed_origins.filter(origin => policy.allowed_origins.includes(origin));
  if (!allowedOperations.length) throw new Error("该授权与 Profile 没有可转换的共同操作。");
  return {
    idempotency_key: key, source_grant_id: grant.grant_id, profile_ref: policy.profile_ref,
    confirmation: { schema_version: "webenvoy.agent-operations-v2-confirmation.v1", confirmation_ref: `confirmation:${crypto.randomUUID()}`, profile_ref: policy.profile_ref, confirmed_at: new Date().toISOString(), confirmed_by: "owner", idempotency_key: key, decision: "apply" },
    new_grant: { principal_id: grant.principal_id, profile_refs: [policy.profile_ref], allowed_operations: allowedOperations, allowed_origins: allowedOrigins, expires_at: grant.expires_at, creation_template: null, max_created_profiles: 0, ...(grant.skill_scope ? { skill_scope: grant.skill_scope } : {}), ...(grant.file_scope ? { file_scope: grant.file_scope } : {}) },
    new_profile_policy: { profile_ref: policy.profile_ref, allowed_operations: policy.allowed_operations, allowed_origins: policy.allowed_origins, ...(policy.controlled_interaction_origins.length ? { controlled_interaction_origins: policy.controlled_interaction_origins } : {}) }
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Core 返回的 Agent 接入数据无效。");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !value.length || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Core 返回的 Agent 接入字段无效。");
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error("Core 返回的时间无效。");
  return result;
}
function revoked(value: unknown): string | null { return value === null ? null : date(value); }
function scopeSemantics(value: unknown): "legacy_request_guard_v1" | "agent_operations_v2" {
  if (value === undefined) return "legacy_request_guard_v1";
  if (value !== "legacy_request_guard_v1" && value !== "agent_operations_v2") throw new Error("Core 返回的授权语义无效。");
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 1024) throw new Error("Core 返回的 Agent 接入列表无效。");
  return value.map(parse);
}

export function projectAgentAccess(value: unknown): AgentAccessState {
  const source = record(value);
  if (source.ok !== true) throw new Error("无法读取 Agent 接入。请检查 Core 连接与管理权限。");
  return {
    principals: list(source.principals, value => {
      const item = record(value);
      return { principal_id: text(item.principal_id), display_name: text(item.display_name), revoked_at: revoked(item.revoked_at) };
    }),
    connections: list(source.connections, value => {
      const item = record(value);
      return { connection_id: text(item.connection_id), principal_id: text(item.principal_id), connected_at: date(item.connected_at), revoked_at: revoked(item.revoked_at) };
    }),
    grants: list(source.grants, value => {
      const item = record(value);
      if (!Number.isSafeInteger(item.max_created_profiles) || Number(item.max_created_profiles) < 0) throw new Error("Core 返回的 Profile 配额无效。");
      const template = item.creation_template === null ? null : record(item.creation_template);
      return {
        grant_id: text(item.grant_id), principal_id: text(item.principal_id), profile_refs: list(item.profile_refs, text),
        allowed_operations: list(item.allowed_operations, text), allowed_origins: list(item.allowed_origins, text),
        expires_at: date(item.expires_at), revoked_at: revoked(item.revoked_at),
        creation_template: template === null ? null : { template_ref: text(template.template_ref), provider_id: template.provider_id === null ? null : text(template.provider_id) },
        max_created_profiles: Number(item.max_created_profiles), created_profile_refs: list(item.created_profile_refs, text), scope_semantics: scopeSemantics(item.scope_semantics),
        ...(item.skill_scope === undefined ? {} : { skill_scope: (() => { const value = record(item.skill_scope); return { skill_refs: list(value.skill_refs, text), source_refs: list(value.source_refs, text) }; })() }),
        ...(item.file_scope === undefined ? {} : { file_scope: (() => { const value = record(item.file_scope); if (!Number.isSafeInteger(value.max_file_bytes)) throw new Error("Core 返回的文件授权无效。"); return { upload_refs: list(value.upload_refs, text), allowed_mime_types: list(value.allowed_mime_types, text), max_file_bytes: Number(value.max_file_bytes) }; })() }),
      };
    }),
    profile_policies: list(source.profile_policies, value => {
      const item = record(value);
      return { profile_ref: text(item.profile_ref), allowed_operations: list(item.allowed_operations, text), allowed_origins: list(item.allowed_origins, text), controlled_interaction_origins: item.controlled_interaction_origins === undefined ? [] : list(item.controlled_interaction_origins, text), scope_semantics: scopeSemantics(item.scope_semantics) };
    }),
  };
}

export async function fetchAgentAccess(endpoint: string, signal?: AbortSignal): Promise<AgentAccessState> {
  return projectAgentAccess(await requestOwnerJson(endpoint, "/agent-access", { signal }));
}

export type AgentMutationResult = "completed" | "rejected" | "unknown";
export async function mutateAgentAccess(endpoint: string, path: string, body: unknown): Promise<AgentMutationResult> {
  try {
    const result = record(await requestOwnerJson(endpoint, path, { method: "POST", body }));
    if (result.ok === true) return "completed";
    // A missing response or server failure does not prove the mutation was rejected.
    return typeof result.status === "number" && [400, 401, 403, 404, 409, 422].includes(result.status) ? "rejected" : "unknown";
  } catch { return "unknown"; }
}

export async function queryAgentAccessOperation(endpoint: string, key: string): Promise<"completed" | "unknown"> {
  try {
    const result = record(await requestOwnerJson(endpoint, `/agent-access/operations/${encodeURIComponent(key)}`));
    return result.ok === true && record(result.operation).status === "completed" ? "completed" : "unknown";
  } catch { return "unknown"; }
}

export async function fetchAgentManagementPolicy(endpoint: string): Promise<{ source_version: string; modes: Record<string, string> } | null> {
  const result = record(await requestOwnerJson(endpoint, '/agent-access/management-policy'));
  if (result.ok !== true) throw new Error('无法读取管理执行策略。');
  if (result.configuration === null) return null;
  const configuration = record(result.configuration);
  return { source_version: text(configuration.source_version), modes: record(configuration.modes) as Record<string, string> };
}

export async function allowAgentManagement(endpoint: string) {
  const current = await fetchAgentManagementPolicy(endpoint);
  const result = record(await requestOwnerJson(endpoint, '/agent-access/management-policy', {
    method: 'PUT', body: { schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: crypto.randomUUID(), expected_source_version: current?.source_version ?? null, modes: { read: 'auto', prepare: 'auto', commit: 'auto' } },
  }));
  if (result.ok !== true) throw new Error('未确认管理策略已保存，请刷新核对；不会自动重发。');
}
