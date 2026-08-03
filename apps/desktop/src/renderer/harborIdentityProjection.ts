import {
  manualBrowserTargets,
  type BrowserProviderProjection,
  type BrowserSessionProjection,
  type BrowserTargetProjection,
  type IdentityEnvironmentProjection,
  type IdentityStatus,
} from "./identityEnvironmentFixtures";
import type {
  HarborIdentityFacts,
  HarborProviderCatalog,
  HarborProviderStatus,
  HarborRuntimeSession,
  ProviderId,
  SiteId,
} from "./harborIdentityTypes";
import { isAuthenticationRecoveryReason, isBrowserEnvironmentRepairReason, requiresManualAuthentication } from "./harborIdentityRecovery";

export function projectHarborIdentity(
  facts: HarborIdentityFacts,
  catalog: HarborProviderCatalog | null,
  fetchedAt: string,
): IdentityEnvironmentProjection {
  const siteId = normalizeSiteId(facts.site_binding.site_id);
  const selected = providerName(facts.provider_binding.selected_provider_id);
  const recoveryActions = [
    ...facts.login_state.human_verification.map(authLabel),
    ...facts.credential_recovery.recovery_actions.map(authLabel),
  ];
  const manualAuthenticationRequired = factsRequireManualAuthentication(facts);
  const readiness = readinessFromFacts(facts);
  return {
    id: facts.identity_environment_ref,
    name: `${facts.site_binding.display_name} ${facts.site_binding.account_label ?? "本地身份"}`,
    siteName: siteLabel(siteId),
    siteId,
    origin: facts.site_binding.origin,
    accountLabel: facts.site_binding.account_label ?? "未绑定账号",
    source: "Harbor live",
    fetchedAt,
    identityEnvironmentRef: facts.identity_environment_ref,
    executionIdentityRef: facts.execution_identity_ref,
    profileRef: facts.profile_ref,
    admissionFacts: {
      providerId: facts.provider_binding.selected_provider_id,
      providerRole: facts.provider_binding.selected_provider?.role ?? null,
      authenticationProvenance: facts.authentication_provenance ?? null,
      loginState: facts.login_state.state,
      manualAuthenticationState: facts.login_state.manual_authentication_state,
      recoveryRequired: facts.login_state.recovery_required,
      browserStorageState: facts.browser_storage.state,
      warningReasonCodes: [...facts.provider_binding.warnings],
    },
    provider: {
      selected,
      role: selected === "CloakBrowser" ? "默认主力" : selected === "官方 Chrome" ? "受限后备" : "不可启动",
      state: readiness.state,
      reason: facts.provider_binding.warnings.join("；") || facts.provider_binding.unavailable_reason || facts.provider_binding.selection_reason,
    },
    login: {
      state: loginLabel(facts.login_state.state),
      recoveryRequired: manualAuthenticationRequired,
      manualAuthenticationState: manualAuthLabel(facts.login_state.manual_authentication_state),
      recoveryActions: Array.from(new Set(recoveryActions)),
      reason: facts.login_state.reason ?? "登录恢复和人工认证由 Harbor 浏览器现场完成。",
    },
    environment: {
      proxy: facts.environment.proxy.label ?? facts.environment.proxy.proxy_ref ?? facts.environment.proxy.state,
      proxyRef: facts.environment.proxy.proxy_ref,
      geoipMode: facts.environment.geoip_mode ?? null,
      region: facts.environment.region ?? "未知",
      language: facts.environment.language ?? "未知",
      timezone: facts.environment.timezone ?? "未知",
      browser: facts.environment.browser_family,
      userAgent: facts.environment.user_agent_summary ?? "未知",
      viewport: facts.environment.viewport ?? "未知",
      hardwareConcurrency: facts.environment.hardware_concurrency ?? null,
      deviceMemoryGb: facts.environment.device_memory_gb ?? null,
      gpuProfile: facts.environment.gpu_profile ?? null,
      interactionPreset: facts.environment.interaction_preset ?? null,
      fingerprintStrategy: facts.environment.fingerprint_strategy ?? null,
      fingerprint: facts.environment.fingerprint_summary,
    },
    storage: {
      profileStorage: profileStorageLabel(facts.browser_storage.state),
      cookies: storageLabel(facts.browser_storage.cookies_session_state),
      credentialRef: facts.credential_recovery.credential_ref ? "已绑定本机引用" : "未绑定",
    },
    readiness,
    siteBindings: siteBindings(siteId),
    browser: {
      providers: providerList(catalog, facts.provider_binding.selected_provider),
      defaultProvider: selected === "官方 Chrome" ? "官方 Chrome" : "CloakBrowser",
      targets: manualBrowserTargets,
      session: emptySession(selected === "官方 Chrome" ? "官方 Chrome" : "CloakBrowser", facts.identity_environment_ref),
      boundary: "App 只发送启动、查看、接管、释放、停止意图；Harbor 拥有 session、controller、viewer 和 provider truth。",
    },
    taskEntries: [],
  };
}

export function projectHarborSession(
  result: HarborRuntimeSession,
  fallback: BrowserSessionProjection,
): BrowserSessionProjection {
  if ("status" in result) {
    return { ...fallback, state: "failed", statusLabel: "不可用", message: result.message };
  }
  const state =
    result.lifecycle_state === "closed"
      ? "stopped"
      : result.lifecycle_state === "failed"
      ? "failed"
      : result.lifecycle_state === "idle" || result.control_owner === "none"
      ? "idle"
      : result.control_owner === "user"
      ? "takeover"
      : "running";
  return {
    provider: fallback.provider,
    state,
    statusLabel: state === "takeover" ? "用户接管" : state === "stopped" ? "已停止" : state === "failed" ? "失败" : state === "idle" ? "已释放" : "已启动",
    controller: result.control_owner === "none" ? "空闲" : result.control_owner === "user" ? "用户接管" : result.control_owner === "core_task" ? "Core 任务运行" : "手动浏览",
    browserSessionRef: result.runtime_session_ref,
    viewerRef: result.viewer_ref ?? fallback.viewerRef,
    currentUrl: result.current_page.current_url ?? result.current_page.requested_url,
    title: result.current_page.title ?? "无标题",
    startedAt: result.created_at,
    message: result.current_error?.message ?? "Harbor 已返回真实本地身份浏览器会话事实。",
  };
}

function providerList(catalog: HarborProviderCatalog | null, fallbackProvider: HarborProviderStatus | null): BrowserProviderProjection[] {
  const mapped = (catalog?.providers ?? (fallbackProvider ? [fallbackProvider] : [])).map(providerProjection);
  if (mapped.length > 0) return mapped;
  return [
    { name: "CloakBrowser", role: "推荐主力", state: "missing", statusLabel: "待检测", summary: "等待 Harbor provider 检测结果。" },
    { name: "官方 Chrome", role: "受限后备", state: "restricted", statusLabel: "待检测", summary: "官方 Chrome 只作为受限后备或手动准备环境。" },
  ];
}

function providerProjection(provider: HarborProviderStatus): BrowserProviderProjection {
  const launchable = provider.install.status === "installed" && provider.install.launchability === "launchable";
  const chrome = provider.provider_id === "chrome_official";
  return {
    name: providerName(provider.provider_id) === "官方 Chrome" ? "官方 Chrome" : "CloakBrowser",
    role: chrome ? "受限后备" : "推荐主力",
    state: launchable ? (chrome ? "restricted" : "available") : "missing",
    statusLabel: launchable ? (chrome ? "受限可用" : "可用") : provider.install.status === "missing" ? "未安装" : "不可启动",
    summary: provider.diagnostics?.[0]?.app_summary ?? provider.limitations?.[0] ?? provider.install.reason ?? "Harbor provider 检测已回读。",
    installHint: launchable ? undefined : provider.download_guide?.install_hint,
  };
}

function readinessFromFacts(facts: HarborIdentityFacts): { state: IdentityStatus; label: string; reasons: string[] } {
  const selectedProvider = facts.provider_binding.selected_provider;
  const providerUnavailable = selectedProvider == null || selectedProvider.install.status !== "installed" ||
    selectedProvider.install.launchability !== "launchable";
  const browserStorageUnavailable = facts.browser_storage.state !== "present" || facts.browser_storage.cookies_session_state !== "present";
  const allowedNoticeWarnings = facts.site_binding.site_id === "boss" && facts.provider_binding.requires_user_notice
    ? new Set(["proxy_missing"])
    : new Set<string>();
  const environmentReasons = facts.provider_binding.warnings.filter((reason) =>
    !allowedNoticeWarnings.has(reason) && isBrowserEnvironmentRepairReason(reason),
  );
  if (providerUnavailable || browserStorageUnavailable || environmentReasons.length > 0) {
    const reasons = environmentReasons.length > 0
      ? environmentReasons
      : facts.diagnostics.length > 0
      ? facts.diagnostics
      : [providerUnavailable ? "browser_provider_unavailable" : "identity_storage_unavailable"];
    return { state: "blocked", label: "需要修复浏览器环境", reasons };
  }
  if (factsRequireManualAuthentication(facts)) {
    return { state: "needs-auth", label: "需要登录或人工认证", reasons: facts.login_state.human_verification.map(authLabel) };
  }
  if (facts.login_state.recovery_required) {
    return { state: "blocked", label: "需要修复浏览器环境", reasons: facts.diagnostics };
  }
  return {
    state: facts.provider_binding.requires_user_notice ? "warning" : "ready",
    label: facts.provider_binding.requires_user_notice ? "受限后备" : "可用于只读任务",
    reasons: facts.provider_binding.warnings.length ? facts.provider_binding.warnings : ["Harbor public summary 可用。"],
  };
}

function factsRequireManualAuthentication(facts: HarborIdentityFacts) {
  return requiresManualAuthentication(facts.login_state.state, facts.login_state.manual_authentication_state) ||
    facts.provider_binding.warnings.some(isAuthenticationRecoveryReason) ||
    facts.login_state.human_verification.length > 0 ||
    facts.credential_recovery.recovery_actions.some((action) => action === "manual_login" || isAuthenticationRecoveryReason(action));
}

function emptySession(provider: BrowserSessionProjection["provider"], identityRef: string): BrowserSessionProjection {
  return {
    provider,
    state: "idle",
    statusLabel: "空闲",
    controller: "空闲",
    browserSessionRef: `${identityRef}:session-next`,
    viewerRef: `${identityRef}:viewer-next`,
    currentUrl: "未打开",
    title: "无活动页面",
    startedAt: "未启动",
    message: "从目标站点入口启动后，App 只展示 Harbor 返回的 session facts。",
  };
}

function siteBindings(siteId: SiteId) {
  return siteId === "boss" ? ["BOSS 职位搜索", "BOSS 打招呼写前预览"] : ["小红书搜索和笔记读取", "小红书发布草稿写前预览"];
}

function normalizeSiteId(value: string): SiteId {
  return value === "boss" || value === "zhipin" ? "boss" : "xiaohongshu";
}

function siteLabel(siteId: SiteId): "小红书" | "BOSS" {
  return siteId === "boss" ? "BOSS" : "小红书";
}

function providerName(providerId: ProviderId | null): "CloakBrowser" | "官方 Chrome" | "未可用" {
  return providerId === "chrome_official" ? "官方 Chrome" : providerId === "cloakbrowser" ? "CloakBrowser" : "未可用";
}

function loginLabel(state: string) {
  return state === "logged_in" ? "已登录" : state === "logged_out" ? "未登录" : state === "expired" ? "已过期" : state === "manual_auth_required" ? "需要人工认证" : "未知";
}

function manualAuthLabel(state: string) {
  return state === "not_required" ? "无需认证" : state === "in_progress" ? "认证中" : state === "completed" ? "已完成" : state === "failed" ? "认证失败" : "需要认证";
}

function authLabel(value: string) {
  return value === "qr_scan" ? "扫码" : value === "two_factor" ? "二次验证" : value === "captcha" ? "验证码" : value === "login_expired" ? "登录过期" : "手动登录";
}

function storageLabel(state: string): "存在" | "缺失" | "过期" | "未知" {
  return state === "present" ? "存在" : state === "missing" || state === "cleared" ? "缺失" : "未知";
}

function profileStorageLabel(state: string): "存在" | "缺失" | "未知" {
  return state === "present" ? "存在" : state === "missing" || state === "cleared" ? "缺失" : "未知";
}
