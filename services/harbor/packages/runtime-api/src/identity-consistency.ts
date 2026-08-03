import {
  createLocalIdentityEnvironmentFacts,
  HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA,
  type HumanVerificationKind,
  type LocalIdentityEnvironmentFacts,
  type LocalIdentityEnvironmentInput,
  type LoginState
} from "./identity-environment.js";
import type {
  BrowserProviderCapabilityFact,
  BrowserProviderDetectionInput,
  IdentityEnvironmentProviderBinding
} from "./provider-management.js";

export const HARBOR_IDENTITY_CONSISTENCY_FACTS_SCHEMA = "harbor-identity-consistency-facts/v0";

export type IdentityConsistencyState = "satisfied" | "missing" | "unknown" | "conflict" | "drift";
export type IdentityConsistencyReadiness = "ready" | "limited" | "blocked" | "unknown";
export type IdentityConsistencyRiskState = "normal" | "login_required" | "environment_drift" | "provider_unavailable" | "site_blocked" | "browser_error" | "unknown";
export type IdentityConsistencyResourceKey =
  | "provider"
  | "proxy"
  | "region"
  | "language"
  | "timezone"
  | "browser_version"
  | "fingerprint"
  | "login_state";
export type IdentityConsistencyRiskEvent = "site_blocked" | "browser_error" | "proxy_changed" | "provider_limit" | "login_missing";

export interface ObservedIdentityEnvironmentFacts {
  proxy_ref?: string | null;
  proxy_label?: string | null;
  region?: string | null;
  language?: string | null;
  timezone?: string | null;
  browser_family?: string | null;
  browser_version?: string | null;
  fingerprint_summary?: string | null;
  login_state?: LoginState;
}

export interface IdentityConsistencyFactsInput extends BrowserProviderDetectionInput {
  identity_environment: LocalIdentityEnvironmentInput | LocalIdentityEnvironmentFacts;
  observed_environment?: ObservedIdentityEnvironmentFacts;
  risk_events?: IdentityConsistencyRiskEvent[];
}

export interface IdentityConsistencyResourceFact {
  key: IdentityConsistencyResourceKey;
  state: IdentityConsistencyState;
  configured: string | null;
  observed: string | null;
  source: "configured" | "observed" | "provider_claim" | "derived";
  note: string;
}

export interface IdentityConsistencyFacts {
  schema_version: typeof HARBOR_IDENTITY_CONSISTENCY_FACTS_SCHEMA;
  identity_environment_ref: string;
  execution_identity_ref: string;
  profile_ref: string;
  provider: {
    selected_provider_id: IdentityEnvironmentProviderBinding["selected_provider_id"];
    selected_role: "primary" | "restricted_fallback" | null;
    default_provider_id: "cloakbrowser";
    restricted_fallback_provider_id: "chrome_official";
    selection_reason: IdentityEnvironmentProviderBinding["selection_reason"];
    requires_user_notice: boolean;
    launchability: string | null;
    browser_version: string | null;
    capability_facts: BrowserProviderCapabilityFact[];
    limitations: string[];
    excluded_providers: readonly [
      { provider: "chromium"; reason: "internal_development_only" },
      { provider: "donut_browser"; reason: "mechanism_reference_only" }
    ];
  };
  resources: IdentityConsistencyResourceFact[];
  drift: {
    state: "none" | "detected" | "unknown";
    reasons: string[];
  };
  login: {
    state: LoginState;
    missing: boolean;
    recovery_required: boolean;
    recovery_actions: HumanVerificationKind[];
  };
  risk: {
    states: IdentityConsistencyRiskState[];
    blocking: boolean;
    recoverable: boolean;
    recovery_suggestions: string[];
  };
  readiness: {
    state: IdentityConsistencyReadiness;
    blocking_reasons: string[];
  };
  public_facts: {
    app: "provider_environment_login_risk_summary";
    core: "admission_resource_facts_and_blocking_reasons";
    lode: "resource_requirement_matching_facts_only";
    not_exposed: readonly ["password", "verification_code", "cookie_value", "storage_value", "session_token", "raw_cdp_endpoint", "raw_vnc_endpoint"];
  };
}

export function createIdentityConsistencyFacts(input: IdentityConsistencyFactsInput): IdentityConsistencyFacts {
  const identityEnvironment = isLocalIdentityEnvironmentFacts(input.identity_environment)
    ? input.identity_environment
    : createLocalIdentityEnvironmentFacts({
        env: input.env,
        platform: input.platform,
        arch: input.arch,
        home_dir: input.home_dir,
        path_exists: input.path_exists,
        is_executable: input.is_executable,
        read_text: input.read_text,
        list_dir: input.list_dir,
        ...input.identity_environment
      });
  const provider = identityEnvironment.provider_binding.selected_provider;
  const observed = input.observed_environment ?? {};
  const resources: IdentityConsistencyResourceFact[] = [
    providerResource(identityEnvironment.provider_binding),
    resource("proxy", identityEnvironment.environment.proxy.proxy_ref ?? identityEnvironment.environment.proxy.label, observed.proxy_ref ?? observed.proxy_label, "代理配置缺失或现场代理变化会破坏身份连续性。"),
    resource("region", identityEnvironment.environment.region, observed.region, "地区应与代理、账号历史和站点预期保持一致。"),
    resource("language", identityEnvironment.environment.language, observed.language, "语言区域应与身份环境配置保持一致。"),
    resource("timezone", identityEnvironment.environment.timezone, observed.timezone, "时区应与地区和代理出口保持一致。"),
    resource("browser_version", provider?.install.version ?? null, observed.browser_version, "浏览器版本未知时只能作为待验证事实。"),
    fingerprintResource(identityEnvironment),
    loginResource(identityEnvironment.login_state.state, observed.login_state)
  ];
  const driftReasons = resources.filter((item) => item.state === "drift").map((item) => `${item.key}_drift`);
  const riskStates = riskStatesFor(identityEnvironment, resources, input.risk_events ?? []);
  const blockingReasons = resources
    .filter((item) => item.state === "missing" || item.state === "conflict" || item.state === "drift")
    .map((item) => `${item.key}_${item.state}`);

  return {
    schema_version: HARBOR_IDENTITY_CONSISTENCY_FACTS_SCHEMA,
    identity_environment_ref: identityEnvironment.identity_environment_ref,
    execution_identity_ref: identityEnvironment.execution_identity_ref,
    profile_ref: identityEnvironment.profile_ref,
    provider: {
      selected_provider_id: identityEnvironment.provider_binding.selected_provider_id,
      selected_role: provider?.role ?? null,
      default_provider_id: "cloakbrowser",
      restricted_fallback_provider_id: "chrome_official",
      selection_reason: identityEnvironment.provider_binding.selection_reason,
      requires_user_notice: identityEnvironment.provider_binding.requires_user_notice,
      launchability: provider?.install.launchability ?? null,
      browser_version: provider?.install.version ?? null,
      capability_facts: provider?.capabilities ?? [],
      limitations: [
        ...(provider?.limitations ?? []),
        "官方 Chrome 只作为受限 fallback/dev/manual provider；缺少 CloakBrowser 原生指纹和反检测二进制能力。",
        "Harbor 不承诺绕过风控，也不输出平台私有检测策略。"
      ],
      excluded_providers: [
        { provider: "chromium", reason: "internal_development_only" },
        { provider: "donut_browser", reason: "mechanism_reference_only" }
      ]
    },
    resources,
    drift: {
      state: driftReasons.length > 0 ? "detected" : observedHasAny(observed) ? "none" : "unknown",
      reasons: driftReasons
    },
    login: {
      state: identityEnvironment.login_state.state,
      missing: identityEnvironment.login_state.state !== "logged_in",
      recovery_required: identityEnvironment.login_state.recovery_required,
      recovery_actions: identityEnvironment.login_state.human_verification
    },
    risk: {
      states: riskStates,
      blocking: riskStates.some((state) => state !== "normal" && state !== "unknown"),
      recoverable: true,
      recovery_suggestions: recoverySuggestions(riskStates)
    },
    readiness: {
      state: readinessFor(resources, riskStates),
      blocking_reasons: blockingReasons
    },
    public_facts: {
      app: "provider_environment_login_risk_summary",
      core: "admission_resource_facts_and_blocking_reasons",
      lode: "resource_requirement_matching_facts_only",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token", "raw_cdp_endpoint", "raw_vnc_endpoint"]
    }
  };
}

function isLocalIdentityEnvironmentFacts(value: LocalIdentityEnvironmentInput | LocalIdentityEnvironmentFacts): value is LocalIdentityEnvironmentFacts {
  return (value as LocalIdentityEnvironmentFacts).schema_version === HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA;
}

function providerResource(binding: IdentityEnvironmentProviderBinding): IdentityConsistencyResourceFact {
  if (!binding.selected_provider) {
    return {
      key: "provider",
      state: "missing",
      configured: binding.selected_provider_id,
      observed: null,
      source: "derived",
      note: "没有可启动 provider，Core 不能准入该身份环境。"
    };
  }
  const chromeFallback = binding.selected_provider.provider_id === "chrome_official";
  return {
    key: "provider",
    state: "satisfied",
    configured: binding.selected_provider.provider_id,
    observed: binding.selected_provider.provider_id,
    source: "derived",
    note: chromeFallback ? "官方 Chrome 是可用的受限后备；能力限制由 provider facts 单独表达。" : "CloakBrowser 是默认主力 provider。"
  };
}

function fingerprintResource(identityEnvironment: LocalIdentityEnvironmentFacts): IdentityConsistencyResourceFact {
  const fingerprint = identityEnvironment.environment.fingerprint_summary;
  const provider = identityEnvironment.provider_binding.selected_provider;
  const chromeFallback = provider?.provider_id === "chrome_official";
  return {
    key: "fingerprint",
    state: valuePresent(fingerprint) ? "satisfied" : "missing",
    configured: fingerprint,
    observed: null,
    source: fingerprint.startsWith("provider_claim") ? "provider_claim" : "configured",
    note: chromeFallback
      ? "官方 Chrome 缺少 provider 原生指纹控制；该限制不等于当前配置冲突。"
      : "指纹摘要是公开摘要，不包含 provider 私有检测策略。"
  };
}

function loginResource(configured: LoginState, observed?: LoginState): IdentityConsistencyResourceFact {
  const effective = observed ?? configured;
  return {
    key: "login_state",
    state: observed && observed !== configured ? "drift" : effective === "logged_in" ? "satisfied" : effective === "unknown" ? "unknown" : "missing",
    configured,
    observed: observed ?? null,
    source: observed ? "observed" : "configured",
    note: "登录态缺失或过期需要人工恢复；Harbor 不自动绕过验证码、2FA 或站点限制。"
  };
}

function resource(key: IdentityConsistencyResourceKey, configured: string | null | undefined, observed: string | null | undefined, note: string): IdentityConsistencyResourceFact {
  const configuredValue = normalize(configured);
  const observedValue = normalize(observed);
  return {
    key,
    state: stateFor(configuredValue, observedValue),
    configured: configuredValue,
    observed: observedValue,
    source: observedValue ? "observed" : "configured",
    note
  };
}

function stateFor(configured: string | null, observed: string | null): IdentityConsistencyState {
  if (!configured) return observed ? "drift" : "missing";
  if (!observed) return "satisfied";
  return configured === observed ? "satisfied" : "drift";
}

function riskStatesFor(
  identityEnvironment: LocalIdentityEnvironmentFacts,
  resources: IdentityConsistencyResourceFact[],
  events: IdentityConsistencyRiskEvent[]
): IdentityConsistencyRiskState[] {
  const states = new Set<IdentityConsistencyRiskState>();
  if (!identityEnvironment.provider_binding.selected_provider) states.add("provider_unavailable");
  if (identityEnvironment.login_state.state !== "logged_in" || events.includes("login_missing")) states.add("login_required");
  if (resources.some((item) => item.state === "drift") || events.includes("proxy_changed")) states.add("environment_drift");
  if (events.includes("site_blocked")) states.add("site_blocked");
  if (events.includes("browser_error")) states.add("browser_error");
  if (states.size === 0 && resources.some((item) => item.state === "unknown")) states.add("unknown");
  if (states.size === 0) states.add("normal");
  return [...states];
}

function readinessFor(resources: IdentityConsistencyResourceFact[], riskStates: IdentityConsistencyRiskState[]): IdentityConsistencyReadiness {
  if (riskStates.some((state) => state === "provider_unavailable" || state === "login_required" || state === "environment_drift" || state === "site_blocked" || state === "browser_error")) return "blocked";
  if (resources.some((item) => item.state === "conflict")) return "limited";
  if (resources.some((item) => item.state === "unknown")) return "unknown";
  return "ready";
}

function recoverySuggestions(states: IdentityConsistencyRiskState[]): string[] {
  const suggestions = new Set<string>();
  if (states.includes("provider_unavailable")) suggestions.add("安装或修复 CloakBrowser；官方 Chrome 只能作为受限后备。");
  if (states.includes("login_required")) suggestions.add("通过 App/Viewer 人工恢复登录态。");
  if (states.includes("environment_drift")) suggestions.add("重新核对代理、地区、语言、时区和浏览器指纹摘要。");
  if (states.includes("site_blocked")) suggestions.add("停止自动化并记录站点阻断事实，交由 Core/App 决定恢复路径。");
  if (states.includes("browser_error")) suggestions.add("检查本机 provider 启动、profile 锁和权限。");
  if (suggestions.size === 0) suggestions.add("无需恢复动作。");
  return [...suggestions];
}

function observedHasAny(observed: ObservedIdentityEnvironmentFacts): boolean {
  return Object.values(observed).some((value) => value !== undefined && value !== null && value !== "");
}

function normalize(value: string | null | undefined): string | null {
  return valuePresent(value) ? value : null;
}

function valuePresent(value: string | null | undefined): value is string {
  return Boolean(value && value !== "unknown" && value !== "not_configured");
}
