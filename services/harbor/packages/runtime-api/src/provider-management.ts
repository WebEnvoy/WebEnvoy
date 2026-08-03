import { constants, existsSync, readFileSync, readdirSync, statSync, accessSync } from "node:fs";
import { arch as hostArch, homedir, platform as hostPlatform } from "node:os";
import { join } from "node:path";
import {
  CLOAKBROWSER_FREE_VERSIONS,
  cloakBrowserBinaryPath,
  cloakBrowserPlatformTag
} from "./cloakbrowser-release.js";
import {
  chromeCapabilities,
  chromeDownloadGuide,
  chromeLimitations,
  cloakCapabilities,
  cloakDownloadGuide,
  cloakLimitations
} from "./provider-capabilities.js";

export const HARBOR_BROWSER_PROVIDER_STATUS_SCHEMA = "harbor-browser-provider-status/v0";
export const HARBOR_IDENTITY_PROVIDER_BINDING_SCHEMA = "harbor-identity-provider-binding/v0";

export type BrowserProviderId = "cloakbrowser" | "chrome_official";
export type BrowserProviderRole = "primary" | "restricted_fallback";
export type BrowserProviderInstallStatus = "installed" | "missing" | "path_invalid";
export type BrowserProviderLaunchability = "launchable" | "not_executable" | "not_checked";
export type BrowserProviderCapabilityState = "supported" | "limited" | "unsupported" | "provider_claim" | "requires_validation";
export type BrowserProviderFactSource = "configured" | "observed" | "provider_claim" | "validation_evidence" | "derived";
export type BrowserProviderFailureClass =
  | "not_installed"
  | "path_invalid"
  | "version_unknown"
  | "version_unsupported"
  | "launch_args_incompatible"
  | "profile_dir_unavailable"
  | "proxy_unavailable"
  | "cdp_unavailable"
  | "launch_timeout"
  | "permission_denied"
  | "unknown";

export type BrowserProviderCapabilityKey =
  | "persistent_profile"
  | "independent_user_data_dir"
  | "proxy"
  | "timezone"
  | "locale"
  | "viewport"
  | "extensions"
  | "cookie_persistence"
  | "cdp"
  | "viewer"
  | "snapshot_refs"
  | "evidence_refs"
  | "native_fingerprint_control"
  | "anti_detection_binary_patches"
  | "automation_exposure_reduction";

export interface BrowserProviderCapabilityFact {
  key: BrowserProviderCapabilityKey;
  state: BrowserProviderCapabilityState;
  source: BrowserProviderFactSource;
  note: string;
}

export interface BrowserProviderDownloadGuide {
  action: "managed_install" | "manual_install" | "external_management";
  primary_url: string;
  fallback_url?: string;
  install_hint: string;
  missing_impacts: string[];
}

export interface BrowserProviderInstallFacts {
  status: BrowserProviderInstallStatus;
  path: string | null;
  version: string | null;
  version_status: "known" | "unknown";
  launchability: BrowserProviderLaunchability;
  reason: string | null;
}

export interface BrowserProviderDiagnostic {
  provider_id: BrowserProviderId;
  failure_class: BrowserProviderFailureClass;
  retryable: boolean;
  summary: string;
  app_summary: string;
  suggested_action: string;
}

export interface BrowserProviderStatus {
  provider_id: BrowserProviderId;
  display_name: string;
  role: BrowserProviderRole;
  selectable: true;
  default_for_identity_environment: boolean;
  management_mode: "managed" | "system" | "external";
  install: BrowserProviderInstallFacts;
  capabilities: BrowserProviderCapabilityFact[];
  limitations: string[];
  download_guide: BrowserProviderDownloadGuide;
  diagnostics: BrowserProviderDiagnostic[];
}

export interface BrowserProviderCatalog {
  schema_version: typeof HARBOR_BROWSER_PROVIDER_STATUS_SCHEMA;
  providers: BrowserProviderStatus[];
  excluded_providers: {
    provider: "chromium" | "donut_browser";
    reason: string;
  }[];
}

export interface IdentityEnvironmentProviderBindingInput extends BrowserProviderDetectionInput {
  execution_identity_ref?: string;
  profile_ref?: string;
  requested_provider_id?: BrowserProviderId;
}

export interface IdentityEnvironmentProviderBinding {
  schema_version: typeof HARBOR_IDENTITY_PROVIDER_BINDING_SCHEMA;
  execution_identity_ref: string | null;
  profile_ref: string | null;
  selected_provider_id: BrowserProviderId | null;
  fallback_provider_id: BrowserProviderId | null;
  selection_reason:
    | "cloakbrowser_default"
    | "chrome_restricted_fallback"
    | "requested_provider_available"
    | "requested_provider_unavailable"
    | "no_launchable_provider";
  requires_user_notice: boolean;
  selected_provider: BrowserProviderStatus | null;
  warnings: string[];
  diagnostics: BrowserProviderDiagnostic[];
  unavailable_reason: string | null;
}

export interface BrowserProviderDetectionInput {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  arch?: string;
  home_dir?: string;
  path_exists?: (path: string) => boolean;
  is_executable?: (path: string) => boolean;
  read_text?: (path: string) => string | null;
  list_dir?: (path: string) => string[];
}

interface DetectionContext {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  arch: string;
  home: string;
  pathExists: (path: string) => boolean;
  isExecutable: (path: string) => boolean;
  readText: (path: string) => string | null;
  listDir: (path: string) => string[];
}

interface ProviderPathCandidate {
  path: string;
  version: string | null;
  explicit: boolean;
}

export function detectBrowserProviders(input: BrowserProviderDetectionInput = {}): BrowserProviderCatalog {
  const ctx = context(input);
  const cloakExternal = Boolean(resolveCloakBrowserOverride(ctx.env));
  return {
    schema_version: HARBOR_BROWSER_PROVIDER_STATUS_SCHEMA,
    providers: [
      providerStatus("cloakbrowser", "CloakBrowser", "primary", detectCloakBrowser(ctx), cloakExternal ? "external" : "managed"),
      providerStatus("chrome_official", "Google Chrome", "restricted_fallback", detectChrome(ctx), "system")
    ],
    excluded_providers: [
      { provider: "chromium", reason: "Chromium 仅保留为开发/测试内部实现，不进入用户可选 provider 管理。" },
      { provider: "donut_browser", reason: "Donut Browser 只作为机制参考，不注册为 Harbor provider。" }
    ]
  };
}

export function resolveCloakBrowserOverride(env: Record<string, string | undefined>): string | undefined {
  return [env.HARBOR_CLOAKBROWSER_PATH, env.CLOAKBROWSER_BINARY_PATH]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function bindIdentityEnvironmentDefaultProvider(input: IdentityEnvironmentProviderBindingInput = {}): IdentityEnvironmentProviderBinding {
  const catalog = detectBrowserProviders(input);
  const cloak = catalog.providers.find((provider) => provider.provider_id === "cloakbrowser")!;
  const chrome = catalog.providers.find((provider) => provider.provider_id === "chrome_official")!;
  const requested = input.requested_provider_id ? catalog.providers.find((provider) => provider.provider_id === input.requested_provider_id) ?? null : null;

  if (requested && isLaunchable(requested)) {
    return binding(input, requested, null, "requested_provider_available", requested.provider_id === "chrome_official");
  }
  if (requested && !isLaunchable(requested)) {
    return binding(input, null, chrome.provider_id, "requested_provider_unavailable", true, [
      `${requested.display_name} 当前不可启动；Harbor 不会静默替换用户指定的 provider。`
    ]);
  }
  if (isLaunchable(cloak)) return binding(input, cloak, null, "cloakbrowser_default", false);
  if (isLaunchable(chrome)) {
    return binding(input, chrome, chrome.provider_id, "chrome_restricted_fallback", true, [
      "CloakBrowser 缺失或不可启动；官方 Chrome 只能作为受限后备。",
      "Chrome 不提供原生指纹控制，也不能提供完整身份环境一致性。"
    ]);
  }
  return binding(input, null, null, "no_launchable_provider", true);
}

export function getDefaultBrowserProviderExecutable(input: BrowserProviderDetectionInput = {}): string {
  return bindIdentityEnvironmentDefaultProvider(input).selected_provider?.install.path ?? "";
}

export function diagnoseBrowserProviderFailure(input: {
  provider_id: BrowserProviderId;
  failure_class: BrowserProviderFailureClass;
  path?: string | null;
  message?: string;
}): BrowserProviderDiagnostic {
  const name = input.provider_id === "cloakbrowser" ? "CloakBrowser" : "官方 Chrome";
  const pathText = input.path ? ` (${input.path})` : "";
  const table: Record<BrowserProviderFailureClass, [string, string, boolean]> = {
    not_installed: [`未检测到 ${name}${pathText}。`, "请从官方来源安装该 provider，然后重新检测。", true],
    path_invalid: [`${name} 路径无效${pathText}。`, "请修正已配置的可执行文件路径，或移除覆盖配置。", true],
    version_unknown: [`无法读取 ${name} 版本${pathText}。`, "请重新安装，或让 Harbor 指向可读取的官方二进制。", true],
    version_unsupported: [`${name} 版本不受支持${pathText}。`, "请更新到受支持的官方构建。", true],
    launch_args_incompatible: [`${name} 拒绝了启动参数。`, "请移除不受支持的启动参数后重试。", true],
    profile_dir_unavailable: [`${name} 无法使用 profile 目录。`, "请检查 profile 目录权限并清理残留锁。", true],
    proxy_unavailable: [`${name} 无法使用已配置代理。`, "请检查代理可达性和凭据后重试。", true],
    cdp_unavailable: [`${name} 未暴露 CDP ready 状态。`, "请关闭残留浏览器进程，或增加 timeout 后重试。", true],
    launch_timeout: [`${name} 启动超时。`, "请检查本机 CPU、权限和浏览器启动提示后重试。", true],
    permission_denied: [`${name} 因权限不足无法执行${pathText}。`, "请授予执行权限，或重新安装该 provider。", true],
    unknown: [`${name} 启动失败。`, "请查看本机 Harbor 日志和 provider 诊断。", true]
  };
  const [summary, suggested_action, retryable] = table[input.failure_class];
  const detail = input.message ? `${summary} ${input.message}` : summary;
  return {
    provider_id: input.provider_id,
    failure_class: input.failure_class,
    retryable,
    summary: detail,
    app_summary: detail,
    suggested_action
  };
}

export function classifyLaunchFailure(error: unknown): BrowserProviderFailureClass {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timed out")) return "launch_timeout";
  if (message.includes("permission") || message.includes("eacces")) return "permission_denied";
  if (message.includes("profile") || message.includes("user data") || message.includes("lock")) return "profile_dir_unavailable";
  if (message.includes("proxy")) return "proxy_unavailable";
  if (message.includes("argument") || message.includes("flag")) return "launch_args_incompatible";
  if (message.includes("cdp") || message.includes("devtools") || message.includes("fetch failed")) return "cdp_unavailable";
  return "unknown";
}

function providerStatus(
  provider_id: BrowserProviderId,
  display_name: string,
  role: BrowserProviderRole,
  install: BrowserProviderInstallFacts,
  managementMode: BrowserProviderStatus["management_mode"]
): BrowserProviderStatus {
  const defaultForIdentity = role === "primary";
  return {
    provider_id,
    display_name,
    role,
    selectable: true,
    default_for_identity_environment: defaultForIdentity,
    management_mode: managementMode,
    install,
    capabilities: provider_id === "cloakbrowser" ? cloakCapabilities() : chromeCapabilities(),
    limitations: provider_id === "cloakbrowser" ? cloakLimitations() : chromeLimitations(),
    download_guide: provider_id === "cloakbrowser"
      ? managementMode === "external"
        ? { ...cloakDownloadGuide(), action: "external_management", install_hint: "该覆盖路径由外部管理；请在外部更新或移除覆盖后重新检查。" }
        : cloakDownloadGuide()
      : chromeDownloadGuide(),
    diagnostics: diagnosticsFor(provider_id, install)
  };
}

function detectCloakBrowser(ctx: DetectionContext): BrowserProviderInstallFacts {
  return detectPath(ctx, cloakCandidates(ctx), "未在官方缓存中检测到 CloakBrowser，且未配置覆盖路径。");
}

function detectChrome(ctx: DetectionContext): BrowserProviderInstallFacts {
  return detectPath(ctx, chromeCandidates(ctx), "未在已知系统位置检测到官方 Chrome，且未配置覆盖路径。");
}

function detectPath(ctx: DetectionContext, candidates: ProviderPathCandidate[], missingReason: string): BrowserProviderInstallFacts {
  const explicit = candidates.find((candidate) => candidate.explicit);
  if (explicit) return installFacts(ctx, explicit, true);

  const installed = candidates.find((candidate) => ctx.pathExists(candidate.path));
  if (installed) return installFacts(ctx, installed, false);

  return {
    status: "missing",
    path: candidates[0]?.path ?? null,
    version: null,
    version_status: "unknown",
    launchability: "not_checked",
    reason: missingReason
  };
}

function installFacts(ctx: DetectionContext, candidate: ProviderPathCandidate, explicit: boolean): BrowserProviderInstallFacts {
  if (!ctx.pathExists(candidate.path)) {
    return {
      status: explicit ? "path_invalid" : "missing",
      path: candidate.path,
      version: candidate.version,
      version_status: candidate.version ? "known" : "unknown",
      launchability: "not_checked",
      reason: explicit ? `已配置路径不存在：${candidate.path}` : "浏览器可执行文件缺失。"
    };
  }
  const launchable = ctx.isExecutable(candidate.path);
  const version = candidate.version ?? readChromeBundleVersion(ctx, candidate.path);
  return {
    status: "installed",
    path: candidate.path,
    version,
    version_status: version ? "known" : "unknown",
    launchability: launchable ? "launchable" : "not_executable",
    reason: launchable ? null : `浏览器可执行文件不可启动：${candidate.path}`
  };
}

function cloakCandidates(ctx: DetectionContext): ProviderPathCandidate[] {
  const override = resolveCloakBrowserOverride(ctx.env);
  if (override) return [{ path: override, version: cloakVersionFromPath(override), explicit: true }];

  const tag = cloakBrowserPlatformTag(ctx.platform, ctx.arch);
  const cacheDir = ctx.env.CLOAKBROWSER_CACHE_DIR || join(ctx.home, ".cloakbrowser");
  const markerVersions = tag ? [`latest_version_${tag}`, "latest_version"].flatMap((name) => readVersionMarker(ctx, join(cacheDir, name))) : [];
  const defaultVersion = tag ? CLOAKBROWSER_FREE_VERSIONS[tag] : null;
  const versions = [...new Set([...markerVersions, defaultVersion].filter((value): value is string => Boolean(value)))];
  return versions.map((version) => ({
    path: cloakBrowserBinaryPath(ctx.platform, cacheDir, version),
    version,
    explicit: false
  }));
}

function chromeCandidates(ctx: DetectionContext): ProviderPathCandidate[] {
  const explicit = ctx.env.HARBOR_CHROME_PATH || ctx.env.CHROME_PATH;
  if (explicit) return [{ path: explicit, version: null, explicit: true }];
  if (ctx.platform === "darwin") {
    return [{ path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", version: null, explicit: false }];
  }
  if (ctx.platform === "win32") {
    return [
      { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", version: null, explicit: false },
      { path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", version: null, explicit: false }
    ];
  }
  return [
    { path: "/opt/google/chrome/chrome", version: null, explicit: false },
    { path: "/usr/bin/google-chrome", version: null, explicit: false },
    { path: "/usr/bin/google-chrome-stable", version: null, explicit: false }
  ];
}

function diagnosticsFor(provider_id: BrowserProviderId, install: BrowserProviderInstallFacts): BrowserProviderDiagnostic[] {
  if (install.status === "missing") return [diagnoseBrowserProviderFailure({ provider_id, failure_class: "not_installed", path: install.path })];
  if (install.status === "path_invalid") return [diagnoseBrowserProviderFailure({ provider_id, failure_class: "path_invalid", path: install.path })];
  if (install.launchability === "not_executable") return [diagnoseBrowserProviderFailure({ provider_id, failure_class: "permission_denied", path: install.path })];
  if (install.version_status === "unknown") return [diagnoseBrowserProviderFailure({ provider_id, failure_class: "version_unknown", path: install.path })];
  return [];
}

function binding(
  input: IdentityEnvironmentProviderBindingInput,
  selected: BrowserProviderStatus | null,
  fallback_provider_id: BrowserProviderId | null,
  selection_reason: IdentityEnvironmentProviderBinding["selection_reason"],
  requires_user_notice: boolean,
  warnings: string[] = []
): IdentityEnvironmentProviderBinding {
  const diagnostics = selected ? selected.diagnostics : detectBrowserProviders(input).providers.flatMap((provider) => provider.diagnostics);
  return {
    schema_version: HARBOR_IDENTITY_PROVIDER_BINDING_SCHEMA,
    execution_identity_ref: input.execution_identity_ref ?? null,
    profile_ref: input.profile_ref ?? null,
    selected_provider_id: selected?.provider_id ?? null,
    fallback_provider_id,
    selection_reason,
    requires_user_notice,
    selected_provider: selected,
    warnings,
    diagnostics,
    unavailable_reason: selected ? null : "当前没有可启动的 CloakBrowser 或官方 Chrome provider。"
  };
}

function isLaunchable(provider: BrowserProviderStatus): boolean {
  return provider.install.status === "installed" && provider.install.launchability === "launchable";
}

function context(input: BrowserProviderDetectionInput): DetectionContext {
  return {
    env: input.env ?? process.env,
    platform: input.platform ?? hostPlatform(),
    arch: input.arch ?? hostArch(),
    home: input.home_dir ?? homedir(),
    pathExists: input.path_exists ?? ((path) => existsSync(path)),
    isExecutable: input.is_executable ?? isExecutable,
    readText: input.read_text ?? readText,
    listDir: input.list_dir ?? listDir
  };
}

function isExecutable(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (hostPlatform() === "win32") return true;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readVersionMarker(ctx: DetectionContext, path: string): string[] {
  const version = ctx.readText(path)?.trim();
  return version && /^[0-9]+(?:\.[0-9]+){3,4}$/.test(version) ? [version] : [];
}

function cloakVersionFromPath(path: string): string | null {
  return path.match(/chromium-([0-9]+(?:\.[0-9]+){3,4})(?:-pro)?[\\/]/)?.[1] ?? null;
}

function readChromeBundleVersion(ctx: DetectionContext, executablePath: string): string | null {
  const marker = ".app/Contents/MacOS/";
  const markerAt = executablePath.indexOf(marker);
  if (markerAt === -1) return null;
  const plistPath = `${executablePath.slice(0, markerAt)}.app/Contents/Info.plist`;
  const plist = ctx.readText(plistPath);
  return plist?.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
}
