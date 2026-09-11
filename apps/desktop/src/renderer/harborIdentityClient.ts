import { projectHarborIdentity, projectHarborSession } from "./harborIdentityProjection";
import { fixtureOrDemoPayloadReason } from "./ownerPayloadGuards";
import {
  type HarborIdentityFacts,
  type HarborIdentityLoadState,
  type HarborProviderCatalog,
  type HarborProviderPreference,
  type HarborRuntimeSession,
  isHarborIdentityFacts,
  isProviderCatalog,
  isProviderPreference,
  isRecord,
} from "./harborIdentityTypes";
import type { BrowserSessionProjection, BrowserTargetProjection, IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import { boundedRecoveryReasonCodes, isAuthenticationRecoveryReason, requiresManualAuthentication } from "./harborIdentityRecovery";
import { requestOwnerJson } from "./ownerApiClient";

export type ManualAuthenticationCompletionResult =
  | { ok: true; identity: HarborIdentityFacts }
  | { ok: false; error: string };

export async function fetchHarborIdentityState(
  harborEndpoint: string,
  signal?: AbortSignal,
): Promise<HarborIdentityLoadState> {
  const fetchedAt = new Date().toISOString();
  const [catalogResult, identityResult, preferenceResult] = await Promise.all([
    fetchFirstJson<HarborProviderCatalog>(harborEndpoint, [
      "/runtime/browser-providers",
      "/runtime/browser-provider-status",
      "/browser-providers",
    ], signal),
    fetchFirstJson<unknown>(harborEndpoint, [
      "/runtime/identity-environments",
      "/identity-environments",
      "/runtime/local-identity-environments",
    ], signal),
    fetchFirstJson<HarborProviderPreference>(harborEndpoint, ["/runtime/browser-provider-preference"], signal),
  ]);
  const catalog = catalogResult.ok && isProviderCatalog(catalogResult.value) && !fixtureOrDemoPayloadReason(catalogResult.value) ? catalogResult.value : null;
  const parsedIdentities = identityResult.ok && !fixtureOrDemoPayloadReason(identityResult.value)
    ? parseIdentityList(identityResult.value, catalog)
    : null;
  const identities = parsedIdentities?.map((item) => projectHarborIdentity(item, catalog, fetchedAt)) ?? [];
  const providerPreference = preferenceResult.ok && isProviderPreference(preferenceResult.value) && !fixtureOrDemoPayloadReason(preferenceResult.value)
    ? preferenceResult.value
    : null;

  if (parsedIdentities != null) {
    return {
      status: "ready",
      fetchedAt,
      summary: catalog ? "已读取 Harbor provider/identity public facts。" : "已读取 Harbor identity public facts；provider endpoint 未返回。",
      identities,
      providers: catalog?.providers ?? [],
      providerPreference,
    };
  }

  return {
    status: "offline",
    fetchedAt,
    summary: `Harbor identity endpoint 未返回可消费的 owner facts。${identityResult.ok ? "" : ` ${identityResult.error}`}`,
    identities,
    providers: catalog?.providers ?? [],
    providerPreference,
  };
}

export async function mutateHarborProviderPreference(
  harborEndpoint: string,
  operation: "set" | "clear",
  providerId?: import("./harborIdentityTypes").ProviderId,
): Promise<{ ok: boolean; message: string }> {
  const idempotencyKey = crypto.randomUUID();
  const path = "/runtime/browser-provider-preference";
  let payload: unknown;
  try {
    payload = await requestOwnerJson(harborEndpoint, path, {
      method: "POST",
      body: operation === "set" ? { operation, idempotency_key: idempotencyKey, provider_id: providerId } : { operation, idempotency_key: idempotencyKey },
      includeErrorBody: true,
      timeoutMs: 20_000,
    });
  } catch {
    payload = null;
  }
  const direct = providerPreferenceMutationBody(payload);
  if (direct) return { ok: direct.status === "completed", message: direct.status === "completed" ? (operation === "set" ? "已保存新建默认。" : "已清除新建默认。") : providerPreferenceFailure(isRecord(direct.failure) ? direct.failure.code : undefined) };
  const projectedFailure = isRecord(payload) && payload.ok === false && isRecord(payload.body) && isRecord(payload.body.error)
    ? payload.body.error.code
    : undefined;
  if (projectedFailure !== undefined) return { ok: false, message: providerPreferenceFailure(projectedFailure) };
  let receipt: unknown;
  try {
    receipt = await requestOwnerJson(harborEndpoint, `/runtime/browser-provider-preference-mutations/${encodeURIComponent(idempotencyKey)}`);
  } catch {
    receipt = null;
  }
  const reconciled = providerPreferenceMutationBody(receipt);
  if (reconciled?.status === "completed") return { ok: true, message: operation === "set" ? "已确认并保存新建默认。" : "已确认并清除新建默认。" };
  if (reconciled?.status === "rejected") return { ok: false, message: providerPreferenceFailure(isRecord(reconciled.failure) ? reconciled.failure.code : undefined) };
  return { ok: false, message: "偏好修改结果未知；未重发原操作，请刷新后核对。" };
}

function providerPreferenceMutationBody(value: unknown): Record<string, unknown> | null {
  const candidate = isRecord(value) && value.ok === false && isRecord(value.body) ? value.body : value;
  return isRecord(candidate) && candidate.schema_version === "harbor-browser-provider-preference-mutation/v1" &&
    (candidate.status === "completed" || candidate.status === "rejected") ? candidate : null;
}

function providerPreferenceFailure(code: unknown) {
  if (code === "provider_unavailable") return "该 Provider 当前不可用；旧默认保持不变。";
  if (code === "persistence_failed") return "保存失败；旧默认保持不变。";
  return "偏好修改被拒绝；旧默认保持不变。";
}

export async function fetchHarborIdentitySession(
  harborEndpoint: string,
  identity: IdentityEnvironmentProjection,
  signal?: AbortSignal,
): Promise<BrowserSessionProjection> {
  const empty = projectHarborSession(null, identity.browser.session);
  const result = await requestJson<unknown>(harborEndpoint, `/runtime/identity-environments/${encodeURIComponent(identity.identityEnvironmentRef)}/session`, { method: "GET", signal });
  if (result.ok && isRecord(result.value) && result.value.runtime_session === null) return empty;
  const session = result.ok && isRecord(result.value) ? result.value.runtime_session : null;
  if (!isRecord(session) || fixtureOrDemoPayloadReason(session) || session.schema_version !== "harbor-runtime-facts/v0" ||
    session.identity_environment_ref !== identity.identityEnvironmentRef || session.profile_ref !== identity.profileRef ||
    typeof session.runtime_session_ref !== "string" || typeof session.lifecycle_state !== "string" || typeof session.control_owner !== "string" ||
    !isRecord(session.current_page) || typeof session.current_page.requested_url !== "string" || typeof session.created_at !== "string" ||
    !(session.current_page.current_url === null || typeof session.current_page.current_url === "string") ||
    !(session.current_page.title === null || typeof session.current_page.title === "string")) {
    return { ...empty, state: "failed", statusLabel: "状态未知", message: result.ok ? "Harbor 未返回匹配该 Profile 的有效实例。" : result.error };
  }
  return projectHarborSession(session as unknown as HarborRuntimeSession, empty);
}

export async function openHarborIdentitySession(
  harborEndpoint: string,
  identity: IdentityEnvironmentProjection,
  target: BrowserTargetProjection,
) {
  if (identity.source !== "Harbor live") {
    return {
      status: "unavailable" as const,
      message: "只有 Harbor live identity environment 可以启动真实身份浏览器；App local/fixture identity 必须先注册并由 Harbor 回读。",
      retryable: true,
    };
  }
  const result = await requestJson<HarborRuntimeSession>(harborEndpoint, "/runtime/identity-environment-sessions", {
    method: "POST",
    body: JSON.stringify({
    identity_environment_ref: identity.identityEnvironmentRef,
    url: target.defaultUrl,
    headless: false,
    control_owner: "user",
    holder_ref: "app-browser-page",
    reuse_existing: true,
    timeout_ms: 60_000,
    }),
  }, 65_000);
  return result.ok ? result.value : { status: "unavailable" as const, message: result.error, retryable: false };
}

export async function lockHarborSession(harborEndpoint: string, sessionRef: string) {
  const current = await requestJson<unknown>(harborEndpoint, `/runtime/sessions/${encodeURIComponent(sessionRef)}`, { method: "GET" });
  if (!current.ok || !isLiveRuntimeSession(current.value, sessionRef)) {
    return { status: "unavailable" as const, message: "Harbor 未返回可核验的同一实例状态；请刷新实例状态后重试。", retryable: true };
  }
  if (current.value.control_owner === "core_task") return postHarborSession(harborEndpoint, [`/runtime/sessions/${encodeURIComponent(sessionRef)}/handoff`], {
    control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested",
  });
  return postHarborSession(harborEndpoint, sessionPaths(sessionRef, "lock"), {
    control_owner: "user",
    holder_ref: "app-browser-page",
  });
}

export async function releaseHarborSession(harborEndpoint: string, sessionRef: string) {
  return postHarborSession(harborEndpoint, sessionPaths(sessionRef, "release"), { control_owner: "user" });
}

export async function stopHarborSession(harborEndpoint: string, sessionRef: string) {
  return postHarborSession(harborEndpoint, sessionPaths(sessionRef, "stop"), { control_owner: "user" });
}

export function manualAuthenticationCompletionBlockReason(
  identity: IdentityEnvironmentProjection,
  session: BrowserSessionProjection,
) {
  if (identity.source !== "Harbor live") {
    return "仅 Harbor live identity 的受控会话可以确认认证完成。";
  }
  if (session.state !== "takeover" || session.controller !== "用户接管") {
    return "请先在 active 的 Harbor 受控会话中接管浏览器，再确认认证完成。";
  }
  if (!session.browserSessionRef || session.browserSessionRef === "无") {
    return "Harbor 未返回可确认的 runtime session ref；请刷新会话状态。";
  }
  return null;
}

export async function completeHarborManualAuthentication(
  harborEndpoint: string,
  identity: IdentityEnvironmentProjection,
  session: BrowserSessionProjection,
): Promise<ManualAuthenticationCompletionResult> {
  const blockedReason = manualAuthenticationCompletionBlockReason(identity, session);
  if (blockedReason) return { ok: false, error: blockedReason };

  const completeWithShell = window.webenvoyShell?.completeHarborManualAuthentication;
  if (!completeWithShell) {
    return { ok: false, error: "认证完成确认只能在受监督的桌面 App 中执行。" };
  }

  try {
    const payload = await completeWithShell({ base: harborEndpoint, runtimeSessionRef: session.browserSessionRef });
    if (isOkFailure(payload)) return { ok: false, error: manualAuthenticationCompletionFailure(payload) };
    if (fixtureOrDemoPayloadReason(payload)) {
      return { ok: false, error: "Harbor 未返回可验证的公开身份状态；App 未改变登录状态。" };
    }

    const completedIdentity = isHarborIdentityFacts(payload)
      ? payload
      : identityFactsFromPublicRecord(payload, null);
    if (
      !completedIdentity ||
      completedIdentity.identity_environment_ref !== identity.identityEnvironmentRef ||
      !hasUserConfirmedAuthenticationProvenance(payload) ||
      completedIdentity.login_state.state !== "logged_in" ||
      completedIdentity.login_state.manual_authentication_state !== "completed" ||
      completedIdentity.login_state.recovery_required
    ) {
      return { ok: false, error: "Harbor 未返回可验证的认证完成公开状态；App 未改变登录状态。" };
    }
    return { ok: true, identity: completedIdentity };
  } catch {
    return { ok: false, error: "无法联系 Harbor 确认认证完成；请检查受控会话后刷新重试。" };
  }
}

export { projectHarborSession };

async function postHarborSession(harborEndpoint: string, paths: string[], body: unknown): Promise<HarborRuntimeSession> {
  const result = await postFirstJson<HarborRuntimeSession>(harborEndpoint, paths, body);
  return result.ok ? result.value : { status: "unavailable", message: result.error, retryable: true };
}

async function fetchFirstJson<T>(base: string, paths: string[], signal?: AbortSignal) {
  for (const path of paths) {
    const result = await requestJson<T>(base, path, { method: "GET", signal });
    if (result.ok) return result;
  }
  return { ok: false as const, error: `无法读取 ${base}`, status: undefined };
}

async function postFirstJson<T>(
  base: string,
  paths: string[],
  body: unknown,
  fallbackError = "Harbor endpoint 未接受会话请求。",
) {
  let lastError = fallbackError;
  for (const path of paths) {
    const result = await requestJson<T>(base, path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (result.ok) return result;
    lastError = result.error;
    if (result.status !== 404) return result;
  }
  return { ok: false as const, error: lastError };
}

async function requestJson<T>(base: string, path: string, init: RequestInit, timeoutMs = 2500) {
  try {
    const payload = await requestOwnerJson(base, path, {
      method: init.method === "POST" || init.method === "PATCH" || init.method === "DELETE" ? init.method : "GET",
      body: typeof init.body === "string" ? parseJson(init.body) : undefined,
      timeoutMs,
      signal: init.signal ?? undefined,
    });
    if (isOkFailure(payload)) return {
      ok: false as const,
      error: payload.error,
      ...(typeof payload.status === "number" ? { status: payload.status } : {}),
    };
    return { ok: true as const, value: payload as T };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error), status: undefined };
  }
}

function isOkFailure(value: unknown): value is { ok: false; error: string; status?: number } {
  return isRecord(value) && value.ok === false && typeof value.error === "string" &&
    (value.status === undefined || typeof value.status === "number");
}

function isLiveRuntimeSession(value: unknown, sessionRef: string): value is Exclude<HarborRuntimeSession, { status: "unavailable" }> {
  return isRecord(value) && !fixtureOrDemoPayloadReason(value) && value.schema_version === "harbor-runtime-facts/v0" &&
    value.runtime_session_ref === sessionRef && typeof value.lifecycle_state === "string" && typeof value.control_owner === "string" &&
    isRecord(value.control_lock) && typeof value.control_lock.state === "string";
}

function manualAuthenticationCompletionFailure(value: { ok: false; error: string; status?: unknown }) {
  if (value.status === 404) return "Harbor 未找到当前受控会话；请刷新会话状态后重试。";
  if (value.status === 409) {
    return "Harbor 未接受该会话的认证确认。仅 active 且由用户控制的 managed identity session 可以确认。";
  }
  return "Harbor 未接受认证完成确认；App 未改变登录状态。";
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function parseIdentityList(value: unknown, catalog: HarborProviderCatalog | null): HarborIdentityFacts[] | null {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.identity_environments)
      ? value.identity_environments
      : isRecord(value) && Array.isArray(value.items)
        ? value.items
        : null;
  if (items == null) return null;
  const parsed = items.map((item) => {
    if (isHarborIdentityFacts(item)) return [item];
    const publicFacts = identityFactsFromPublicRecord(item, catalog);
    return publicFacts ? [publicFacts] : [];
  }).flat();
  return parsed.length === items.length ? parsed : null;
}

function sessionPaths(sessionRef: string, action: "lock" | "release" | "stop") {
  const encoded = encodeURIComponent(sessionRef);
  return [`/runtime/sessions/${encoded}/${action}`, `/sessions/${encoded}/${action}`];
}

export function identityFactsFromPublicRecord(value: unknown, catalog: HarborProviderCatalog | null): HarborIdentityFacts | null {
  if (!isRecord(value) || value.schema_version !== "harbor-local-identity-environment-store/v0") return null;
  const site = recordValue(value.site);
  const status = recordValue(value.status);
  const refs = recordValue(value.refs);
  const environment = recordValue(value.environment_summary);
  const identityEnvironmentRef = stringValue(value.identity_environment_ref);
  const executionIdentityRef = stringValue(refs?.execution_identity_ref);
  const profileRef = stringValue(refs?.profile_ref);
  const siteId = stringValue(site?.site_id);
  const origin = stringValue(site?.origin);
  const displayName = stringValue(site?.display_name) ?? siteId;
  const providerId = providerIdValue(environment?.provider_id);

  if (!identityEnvironmentRef || !executionIdentityRef || !profileRef || !siteId || !origin || !displayName) return null;

  const loginState = loginStateValue(status?.login_state);
  const storageState = storageStateValue(status?.browser_storage_state);
  const manualAuthenticationState = manualAuthStateValue(status?.manual_authentication_state, loginState);
  const recoveryReasons = boundedRecoveryReasonCodes(status?.blocking_reasons, status?.repair_reasons);
  const environmentRecoveryReasons = status?.readiness === "ready" ? [] : recoveryReasons.filter((reason) => !isAuthenticationRecoveryReason(reason));
  const recoveryRequired = status?.recovery_required === true;
  const manualAuthenticationRequired = requiresManualAuthentication(loginState, manualAuthenticationState) ||
    recoveryReasons.some(isAuthenticationRecoveryReason);
  const authenticationProvenance = stringValue(status?.authentication_provenance);
  const selectedProvider = providerId ? catalog?.providers.find((provider) => provider.provider_id === providerId) ?? null : null;

  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref: identityEnvironmentRef,
    execution_identity_ref: executionIdentityRef,
    profile_ref: profileRef,
    site_binding: {
      site_id: siteId,
      origin,
      display_name: displayName,
      account_label: stringValue(site?.account_ref) ?? identityEnvironmentRef,
    },
    login_state: {
      state: loginState,
      reason: authenticationProvenance === "user_confirmed_managed_session"
        ? "认证状态由用户在 Harbor 受控会话中明确确认。"
        : manualAuthenticationRequired ? "Harbor 要求完成登录或人工认证。" : null,
      recovery_required: recoveryRequired,
      manual_authentication_state: manualAuthenticationState,
      human_verification: manualAuthenticationRequired ? ["manual_login"] : [],
    },
    browser_storage: {
      profile_storage_ref: stringValue(refs?.profile_storage_ref) ?? `${profileRef}:storage`,
      state: storageState,
      cookies_session_state: storageState,
    },
    environment: {
      proxy: {
        state: proxyStateValue(environment?.proxy_state),
        proxy_ref: stringValue(refs?.proxy_ref) ?? null,
        label: stringValue(refs?.proxy_ref) ? "Harbor redacted proxy ref" : null,
      },
      region: stringValue(environment?.region) ?? null,
      geoip_mode: geoipModeValue(environment?.geoip_mode),
      language: stringValue(environment?.language) ?? null,
      timezone: stringValue(environment?.timezone) ?? null,
      browser_family: stringValue(environment?.browser_family) ?? providerId ?? "unknown",
      user_agent_summary: null,
      viewport: stringValue(environment?.viewport) ?? null,
      hardware_concurrency: numberValue(environment?.hardware_concurrency),
      device_memory_gb: numberValue(environment?.device_memory_gb),
      gpu_profile: stringValue(environment?.gpu_profile) ?? null,
      interaction_preset: interactionPresetValue(environment?.interaction_preset),
      fingerprint_strategy: fingerprintStrategyValue(environment?.fingerprint_strategy),
      fingerprint_summary: stringValue(environment?.fingerprint_summary) ?? "not_configured",
    },
    provider_binding: {
      selected_provider_id: providerId,
      selection_reason: "harbor_public_record",
      requires_user_notice: providerId === "chrome_official",
      selected_provider: selectedProvider,
      warnings: environmentRecoveryReasons,
      unavailable_reason: providerId ? null : "Harbor public record did not expose a selected provider.",
    },
    credential_recovery: {
      credential_ref: stringValue(refs?.credential_ref) ?? null,
      recovery_actions: manualAuthenticationRequired ? ["manual_login"] : [],
    },
    diagnostics: recoveryReasons,
    authentication_provenance: authenticationProvenance ?? null,
  };
}

function hasUserConfirmedAuthenticationProvenance(value: unknown) {
  const status = recordValue(recordValue(value)?.status);
  return status?.authentication_provenance === "user_confirmed_managed_session";
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function geoipModeValue(value: unknown) {
  return value === "proxy" || value === "system" || value === "disabled" ? value : null;
}

function interactionPresetValue(value: unknown) {
  return value === "default" || value === "humanized" ? value : null;
}

function fingerprintStrategyValue(value: unknown) {
  return value === "provider_default" || value === "stable" ? value : null;
}

function providerIdValue(value: unknown) {
  return value === "cloakbrowser" || value === "chrome_official" || value === "camoufox" ? value : null;
}

function loginStateValue(value: unknown): HarborIdentityFacts["login_state"]["state"] {
  return value === "logged_in" || value === "logged_out" || value === "expired" || value === "manual_auth_required" ? value : "unknown";
}

function manualAuthStateValue(
  value: unknown,
  loginState: HarborIdentityFacts["login_state"]["state"],
): HarborIdentityFacts["login_state"]["manual_authentication_state"] {
  return value === "not_required" || value === "required" || value === "in_progress" || value === "completed" || value === "failed"
    ? value
    : loginState === "logged_out" || loginState === "expired" || loginState === "manual_auth_required" ? "required" : "not_required";
}

function storageStateValue(value: unknown): HarborIdentityFacts["browser_storage"]["state"] {
  return value === "present" || value === "missing" || value === "cleared" ? value : "unknown";
}

function proxyStateValue(value: unknown): HarborIdentityFacts["environment"]["proxy"]["state"] {
  return value === "configured" || value === "missing" ? value : "unknown";
}
