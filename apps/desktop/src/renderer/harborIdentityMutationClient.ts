import { fixtureOrDemoPayloadReason } from "./ownerPayloadGuards";
import { requestOwnerJson } from "./ownerApiClient";

export type IdentityEnvironmentBusinessInput = {
  site: {
    site_id: string;
    origin: string;
    display_name: string;
    account_identifier?: string;
  };
  requested_provider_id?: "cloakbrowser" | "chrome_official";
  proxy_ref?: string;
  proxy_label?: string;
  geoip_mode?: "proxy" | "system" | "disabled";
  region?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  hardware_concurrency?: number;
  device_memory_gb?: number;
  gpu_profile?: string;
  interaction_preset?: "default" | "humanized";
  fingerprint_strategy?: "provider_default" | "stable";
};

export type IdentityEnvironmentConfigurationUpdate = Omit<
  IdentityEnvironmentBusinessInput,
  "site" | "requested_provider_id" | "proxy_ref" | "proxy_label"
> & {
  provider_id?: IdentityEnvironmentBusinessInput["requested_provider_id"];
  proxy_ref?: string | null;
  proxy_label?: string | null;
};

export type IdentityEnvironmentMutationIntent =
  | { operation: "create"; identity_environment: IdentityEnvironmentBusinessInput }
  | { operation: "import"; identity_environment: IdentityEnvironmentBusinessInput & { import_source_ref: string } }
  | { operation: "edit"; identity_environment_ref: string; configuration: IdentityEnvironmentConfigurationUpdate }
  | { operation: "copy_full" | "copy_environment"; identity_environment_ref: string }
  | { operation: "remove"; identity_environment_ref: string }
  | { operation: "delete"; identity_environment_ref: string; confirmation: "delete_local_data" };

export type IdentityEnvironmentMutationFailureCode =
  | "active_session"
  | "duplicate_identity"
  | "duplicate_import"
  | "idempotency_conflict"
  | "identity_environment_missing"
  | "invalid_request"
  | "mutation_failed"
  | "persistence_failed"
  | "profile_locked"
  | "profile_storage_exists"
  | "provider_mismatch"
  | "proxy_policy_incompatible"
  | "proxy_resolution_unavailable"
  | "proxy_unreachable"
  | "proxy_validation_unavailable"
  | "repair_required"
  | "source_in_use"
  | "source_material_missing"
  | "target_in_use"
  | "local_material_cleanup_failed"
  | "local_material_cleanup_unavailable"
  | "local_material_copy_failed"
  | "local_material_copy_unavailable"
  | "unsupported_configuration";

export type IdentityEnvironmentMutationResult = {
  schema_version: "harbor-identity-environment-mutation/v1";
  operation: IdentityEnvironmentMutationIntent["operation"];
  status: "completed" | "rejected" | "repair_required";
  identity_environment_ref: string | null;
  source_identity_environment_ref: string | null;
  effects: {
    index: "registered" | "updated" | "removed" | "unchanged";
    local_data: "created" | "copied" | "excluded" | "preserved" | "deleted" | "unchanged" | "residual";
    login_state: "preserved_unverified" | "excluded" | "unchanged";
  };
  failure: null | {
    code: IdentityEnvironmentMutationFailureCode;
    retryable: boolean;
    recovery_actions: string[];
  };
  public_boundary: {
    output: "status_and_redacted_refs_only";
    raw_material: "not_exposed";
  };
};

export type IdentityEnvironmentMutationOutcome =
  | { ok: true; result: IdentityEnvironmentMutationResult; message: string }
  | { ok: false; result?: IdentityEnvironmentMutationResult; message: string };

const operations = new Set(["create", "import", "edit", "copy_full", "copy_environment", "remove", "delete"]);
const statuses = new Set(["completed", "rejected", "repair_required"]);
const indexEffects = new Set(["registered", "updated", "removed", "unchanged"]);
const localDataEffects = new Set(["created", "copied", "excluded", "preserved", "deleted", "unchanged", "residual"]);
const loginEffects = new Set(["preserved_unverified", "excluded", "unchanged"]);
const failureCodes = new Set<IdentityEnvironmentMutationFailureCode>([
  "active_session", "duplicate_identity", "duplicate_import", "idempotency_conflict",
  "identity_environment_missing", "invalid_request", "mutation_failed", "persistence_failed",
  "profile_locked", "profile_storage_exists", "provider_mismatch", "proxy_policy_incompatible",
  "proxy_resolution_unavailable", "proxy_unreachable", "proxy_validation_unavailable", "repair_required",
  "source_in_use", "source_material_missing", "target_in_use", "local_material_cleanup_failed",
  "local_material_cleanup_unavailable", "local_material_copy_failed", "local_material_copy_unavailable",
  "unsupported_configuration",
]);

export async function mutateHarborIdentityEnvironment(
  harborEndpoint: string,
  intent: IdentityEnvironmentMutationIntent,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<IdentityEnvironmentMutationOutcome> {
  const payload = await requestOwnerJson(harborEndpoint, "/runtime/identity-environment-mutations", {
    method: "POST",
    body: { ...intent, idempotency_key: idempotencyKey },
    timeoutMs: 20_000,
    includeErrorBody: true,
  });
  const ownerFailure = isRecord(payload) && payload.ok === false ? payload : null;
  const result = parseIdentityEnvironmentMutationResult(ownerFailure?.body ?? payload);
  if (result == null) {
    return {
      ok: false,
      message: ownerFailure == null
        ? "Harbor 返回了无法识别的身份变更结果，请刷新后确认当前状态。"
        : "Harbor 未确认本次变更结果；重试相同操作时会复用本次请求标识。",
    };
  }
  if (result.operation !== intent.operation) {
    return { ok: false, message: "Harbor 返回的操作与本次请求不一致，请刷新后确认当前状态。" };
  }
  if (result.status !== "completed") {
    return { ok: false, result, message: mutationFailureMessage(result.failure?.code) };
  }
  return { ok: true, result, message: mutationSuccessMessage(result) };
}

export function parseIdentityEnvironmentMutationResult(value: unknown): IdentityEnvironmentMutationResult | null {
  if (fixtureOrDemoPayloadReason(value) || !isRecord(value)) return null;
  if (
    value.schema_version !== "harbor-identity-environment-mutation/v1" ||
    typeof value.operation !== "string" || !operations.has(value.operation) ||
    typeof value.status !== "string" || !statuses.has(value.status) ||
    !nullableString(value.identity_environment_ref) ||
    !nullableString(value.source_identity_environment_ref) ||
    !isRecord(value.effects) || !indexEffects.has(String(value.effects.index)) ||
    !localDataEffects.has(String(value.effects.local_data)) || !loginEffects.has(String(value.effects.login_state)) ||
    !isRecord(value.public_boundary) || value.public_boundary.output !== "status_and_redacted_refs_only" ||
    value.public_boundary.raw_material !== "not_exposed"
  ) return null;
  if (value.failure !== null && !isMutationFailure(value.failure)) return null;
  if ((value.status === "completed") !== (value.failure === null)) return null;
  return {
    schema_version: "harbor-identity-environment-mutation/v1",
    operation: value.operation as IdentityEnvironmentMutationResult["operation"],
    status: value.status as IdentityEnvironmentMutationResult["status"],
    identity_environment_ref: value.identity_environment_ref as string | null,
    source_identity_environment_ref: value.source_identity_environment_ref as string | null,
    effects: {
      index: value.effects.index as IdentityEnvironmentMutationResult["effects"]["index"],
      local_data: value.effects.local_data as IdentityEnvironmentMutationResult["effects"]["local_data"],
      login_state: value.effects.login_state as IdentityEnvironmentMutationResult["effects"]["login_state"],
    },
    failure: value.failure as IdentityEnvironmentMutationResult["failure"],
    public_boundary: {
      output: "status_and_redacted_refs_only",
      raw_material: "not_exposed",
    },
  };
}

function mutationSuccessMessage(result: IdentityEnvironmentMutationResult) {
  if (result.operation === "copy_full") return "已创建完整副本。登录状态已在本机复制，但仍可能需要按站点规则重新登录。";
  if (result.operation === "copy_environment") return "已创建仅含环境配置的副本，不包含账号资料和站点数据。";
  if (result.operation === "remove") return "已从 WebEnvoy 移除账号身份，本机数据仍保留。";
  if (result.operation === "delete") return "账号身份及其本机数据已删除。";
  if (result.operation === "edit") return "账号身份配置已更新。";
  if (result.operation === "import") return "账号身份已导入。";
  return "账号身份已创建。";
}

function mutationFailureMessage(code: IdentityEnvironmentMutationFailureCode | undefined) {
  if (code === "active_session" || code === "source_in_use" || code === "target_in_use") return "该账号身份仍有运行中的浏览器，请停止实例后重试。";
  if (code === "profile_locked") return "浏览器环境正在使用中，请关闭占用它的窗口后重试。";
  if (code === "duplicate_identity" || code === "duplicate_import") return "该账号身份已经存在，请使用现有身份或更换导入来源。";
  if (code === "identity_environment_missing") return "该账号身份已不存在，请刷新列表。";
  if (code?.startsWith("proxy_") || code === "provider_mismatch") return "当前代理或 Provider 配置不可用，请修正环境配置后重试。";
  if (code === "repair_required" || code?.startsWith("local_material_")) return "本机数据需要修复，请打开环境依赖并按提示处理。";
  if (code === "unsupported_configuration" || code === "invalid_request") return "当前配置不受支持，请检查填写内容。";
  return "身份变更未完成，请刷新后重试。";
}

function isMutationFailure(value: unknown) {
  return isRecord(value) && typeof value.code === "string" && failureCodes.has(value.code as IdentityEnvironmentMutationFailureCode) &&
    typeof value.retryable === "boolean" && Array.isArray(value.recovery_actions) &&
    value.recovery_actions.every((action) => typeof action === "string");
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
