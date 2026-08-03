import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindIdentityEnvironmentDefaultProvider,
  classifyLaunchFailure,
  diagnoseBrowserProviderFailure,
  type BrowserProviderDetectionInput,
  type IdentityEnvironmentProviderBinding
} from "./provider-management.js";
import { opaqueRef } from "./refs.js";
import {
  resolveIdentityEnvironmentLaunchConfiguration,
  type ResolvedIdentityEnvironmentLaunchConfiguration
} from "./identity-environment-configuration.js";
import { prepareProfileStorage } from "./profile-storage.js";
import { trustLocalProviderReadProbe, trustLocalProviderSiteResourceProbe } from "./read-operation-probe-trust.js";
import { isCanonicalDetailUrl } from "./detail-read-target.js";
import type {
  BossJobDetailPublicSummary,
  LocalProviderLaunchInput,
  LocalProviderLauncher,
  LocalProviderLaunchResult,
  LocalProviderDetailPublicSummary,
  LocalProviderPageFacts,
  LocalProviderReadProbeInput,
  LocalProviderReadProbeResult,
  LocalProviderReadProbePublicSummary,
  LocalProviderSiteResourceProbeInput,
  LocalProviderSiteResourceProbeResult,
  LocalProviderScreenshotFacts,
  RuntimeErrorCode,
  RuntimeErrorFact,
  RuntimeFact,
  XiaohongshuNoteDetailPublicSummary,
  XiaohongshuSearchPublicFields
} from "./runtime-session-types.js";

type CdpPageTarget = { id?: string; type?: string; webSocketDebuggerUrl?: string; url?: string; title?: string };
type ObservedDetailPublicSummary = Omit<XiaohongshuNoteDetailPublicSummary, "source_citation"> | Omit<BossJobDetailPublicSummary, "detail_ref" | "source_citation">;

class ProviderPageCommitError extends Error {}
class ProviderOriginDriftError extends Error {}

export async function launchLocalDedicatedProvider(input: LocalProviderLaunchInput): Promise<LocalProviderLaunchResult> {
  const explicitBrowserPath = input.browser_path || process.env.HARBOR_BROWSER_PATH || "";
  const providerBinding = explicitBrowserPath
    ? null
    : resolveRuntimeProviderBinding(input.identity_environment);
  const browserPath = explicitBrowserPath || providerBinding?.selected_provider?.install.path || "";
  if (!browserPath) {
    const diagnostic = providerBinding?.diagnostics[0] ?? diagnoseBrowserProviderFailure({ provider_id: "cloakbrowser", failure_class: "not_installed" });
    return unavailable("provider_unavailable", diagnostic.app_summary, providerBindingFacts(providerBinding));
  }
  const profileStorage = await prepareProfileStorage(input.profile_storage_ref);
  const providerConfiguration = input.identity_environment
    ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy)
    : null;
  if (input.identity_environment && !providerConfiguration) {
    return unavailable("unsupported", "Identity environment configuration cannot be resolved by the selected local provider.", [
      ...providerBindingFacts(providerBinding),
      ...profileStorage.facts
    ]);
  }
  const args = providerLaunchArguments(input, profileStorage.profileDir, providerConfiguration);
  await removeStaleDevtoolsPort(profileStorage.profileDir);
  const child = spawn(browserPath, args, { stdio: "ignore" });
  const launchDeadline = Date.now() + Math.max(1, input.timeout_ms);
  try {
    const port = await waitForDevtoolsPort(profileStorage.profileDir, launchDeadline);
    const readbackSignal = AbortSignal.timeout(remainingLaunchTime(launchDeadline));
    const version = await fetchVersion(port, readbackSignal);
    const initialPageUrl = providerConfiguration ? providerConfigurationPageUrl(input) : input.url;
    const configurationFacts = providerConfiguration
      ? await applyAndReadbackProviderConfiguration(port, initialPageUrl, providerConfiguration, readbackSignal)
      : [];
    const page = await readPageFacts(port, initialPageUrl, readbackSignal);
    let currentUrl = page.current_url ?? initialPageUrl;
    const evidence_ref = opaqueRef("validation");
    return {
      status: "ready",
      execution_surface: "local_provider",
      cdp_ref: opaqueRef("cdp"),
      viewer_entry: viewerEntry(input.headless),
      page,
      facts: [
        ...providerBindingFacts(providerBinding),
        ...configurationFacts,
        ...profileStorage.facts,
        { key: "browser.launch", source: "observed", value: "ready", evidence_ref },
        { key: "cdp.version", source: "validation_evidence", value: `${version.Browser} ${version["Protocol-Version"]}`, evidence_ref },
        ...page.facts
      ],
      openUrl: async (url) => {
        const nextPage = await openProviderUrl(port, url, AbortSignal.timeout(Math.max(1, input.timeout_ms)));
        currentUrl = nextPage.current_url ?? url;
        return nextPage;
      },
      probeSiteResource: trustLocalProviderSiteResourceProbe((probe) => probeProviderSiteResource(port, currentUrl, probe)),
      probeReadOperation: trustLocalProviderReadProbe(async (probe) => {
        const result = await probeProviderReadOperation(port, probe);
        if (result.page?.current_url) currentUrl = result.page.current_url;
        return result;
      }),
      captureScreenshot: () => captureProviderScreenshot(port, currentUrl),
      close: () => closeBrowser(child, profileStorage.profileDir, !profileStorage.persistent)
    };
  } catch (error) {
    await closeBrowser(child, profileStorage.profileDir, !profileStorage.persistent);
    const diagnostic = diagnoseBrowserProviderFailure({
      provider_id: providerBinding?.selected_provider_id ?? providerConfiguration?.provider_id ?? "cloakbrowser",
      failure_class: classifyLaunchFailure(error),
      path: browserPath,
      message: error instanceof Error ? error.message : "Browser launch failed."
    });
    return unavailable("launch_failed", diagnostic.app_summary, [...providerBindingFacts(providerBinding), ...profileStorage.facts]);
  }
}

export function resolveRuntimeProviderBinding(
  identityEnvironment: LocalProviderLaunchInput["identity_environment"],
  detection: BrowserProviderDetectionInput = {}
): IdentityEnvironmentProviderBinding {
  const persisted = identityEnvironment?.provider_binding;
  return bindIdentityEnvironmentDefaultProvider({
    ...detection,
    ...(persisted?.selected_provider_id ? { requested_provider_id: persisted.selected_provider_id } : {}),
    execution_identity_ref: identityEnvironment?.execution_identity_ref,
    profile_ref: identityEnvironment?.profile_ref
  });
}

export interface LocalProviderLaunchVerification {
  browser_version: string;
}

export async function verifyLocalProviderLaunch(
  browserPath: string,
  options: { expected_version?: string; timeout_ms?: number; signal?: AbortSignal } = {}
): Promise<LocalProviderLaunchVerification> {
  const profileDir = await mkdtemp(join(tmpdir(), "harbor-provider-verify-"));
  const child = spawn(browserPath, providerLaunchArguments({ headless: true, url: "about:blank" }, profileDir, null), { stdio: "ignore" });
  const deadline = Date.now() + Math.max(1, options.timeout_ms ?? 10_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, options.timeout_ms ?? 10_000))])
    : AbortSignal.timeout(Math.max(1, options.timeout_ms ?? 10_000));
  try {
    const port = await waitForDevtoolsPort(profileDir, deadline, signal);
    const versionFacts = await fetchVersion(port, signal);
    const browserVersion = observedBrowserVersion(versionFacts);
    if (options.expected_version && !compatibleBrowserVersion(browserVersion, options.expected_version)) {
      throw new Error(`Provider version ${browserVersion} does not match target ${options.expected_version}.`);
    }
    const page = await readPageFacts(port, "about:blank", signal);
    if (page.status !== "ready") throw new Error("Provider launch readback was not ready.");
    return { browser_version: browserVersion };
  } finally {
    await closeBrowser(child, profileDir, true);
  }
}

export function providerLaunchArguments(
  input: Pick<LocalProviderLaunchInput, "headless" | "url">,
  profileDir: string,
  configuration: ResolvedIdentityEnvironmentLaunchConfiguration | null
): string[] {
  return [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-default-browser-check",
    "--no-first-run",
    ...(input.headless ? ["--headless=new"] : []),
    ...(configuration?.proxy_server ? [`--proxy-server=${configuration.proxy_server}`] : []),
    ...(configuration?.language ? [`--lang=${configuration.language}`] : []),
    ...(configuration?.viewport ? [`--window-size=${configuration.viewport.width},${configuration.viewport.height}`] : []),
    configuration ? "about:blank" : input.url
  ];
}

function providerConfigurationPageUrl(input: LocalProviderLaunchInput): string {
  try {
    const url = new URL(input.url);
    if (
      input.identity_environment?.site_binding.site_id === "xiaohongshu" &&
      url.origin === "https://www.xiaohongshu.com" &&
      ["/search_result", "/search_result/"].includes(url.pathname)
    ) return "https://www.xiaohongshu.com/explore";
  } catch {
    // URL validation remains owned by the Runtime Session boundary.
  }
  return input.url;
}

const SITE_RESOURCE_PROBE_DEADLINE_MS = 3000;

export async function probeProviderSiteResource(
  port: string,
  requestedUrl: string,
  input: LocalProviderSiteResourceProbeInput,
  deadlineMs = SITE_RESOURCE_PROBE_DEADLINE_MS
): Promise<LocalProviderSiteResourceProbeResult> {
  if (
    (input.site_id === "boss" && input.task_kind !== "job_search" && input.task_kind !== "boss_job_search") ||
    (input.site_id === "xiaohongshu" &&
      input.task_kind !== "search_notes" &&
      input.task_kind !== "xhs_search_notes" &&
      input.task_kind !== "read_note_detail" &&
      input.task_kind !== "xhs_read_note_detail")
  ) {
    return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The local provider has no safe probe for this site resource.");
  }
  const deadline = AbortSignal.timeout(Math.max(1, Math.min(deadlineMs, SITE_RESOURCE_PROBE_DEADLINE_MS)));
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  try {
    const page = await activePage(port, requestedUrl, signal);
    if (!page.webSocketDebuggerUrl) {
      return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The site page has no controlled CDP target.");
    }
    return await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Runtime.enable");
      const observe = async () => {
        const evaluated = await client.send("Runtime.evaluate", {
          expression: input.site_id === "boss"
            ? readProbeExpression("boss", "")
            : xiaohongshuSiteResourceProbeExpression(),
          returnByValue: true
        });
        return (evaluated.result as { value?: ReadProbeObservation } | undefined)?.value;
      };
      if (input.site_id === "boss") return validateBossSpaResourceProbe(await observe());
      return waitForXiaohongshuSiteResourceReadiness(observe, signal);
    }, signal);
  } catch {
    return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The site readiness surface could not be verified through the controlled CDP probe.");
  }
}

export function validateBossSpaResourceProbe(observation: ReadProbeObservation | undefined): LocalProviderSiteResourceProbeResult {
  if (!observation) return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The BOSS SPA probe returned no public observation.");
  if (observation.challenge_like) return siteResourceProbeUnavailable("blocked", "safety_challenge", "The BOSS page shows a verification or safety challenge.");
  if (observation.login_like) return siteResourceProbeUnavailable("blocked", "not_logged_in", "The BOSS page requires manual login.");
  if (observation.origin !== "https://www.zhipin.com" || observation.pathname !== "/web/geek/job") {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The active page is not the canonical BOSS job-search surface.");
  }
  if (!observation.ready || !observation.vue_owned || !observation.rendered_surface || !observation.job_cards_valid || !observation.job_card_count) {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The canonical BOSS page has no verified SPA job-search surface.");
  }
  return {
    status: "available",
    observed_at: new Date().toISOString(),
    evidence_ref: opaqueRef("validation"),
    verified_fact_keys: ["page.boss_spa.ready"]
  };
}

export function validateXiaohongshuSiteResourceProbe(observation: ReadProbeObservation | undefined): LocalProviderSiteResourceProbeResult {
  if (!observation) {
    return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The Xiaohongshu readiness probe returned no public observation.");
  }
  if (observation.origin !== "https://www.xiaohongshu.com") {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The active page is not on the canonical Xiaohongshu origin.");
  }
  if (observation.challenge_like) {
    return siteResourceProbeUnavailable("blocked", "safety_challenge", "The Xiaohongshu page shows a verification or safety challenge.");
  }
  if (observation.login_like) {
    return siteResourceProbeUnavailable("blocked", "not_logged_in", "The Xiaohongshu page requires manual login.");
  }
  const verifiedFactKeys = [
    ...(observation.vue_ready ? ["page.vue_app.ready" as const] : []),
    ...(observation.pinia_ready ? ["page.pinia_store.ready" as const] : [])
  ];
  if (!observation.ready || !observation.vue_ready || !observation.pinia_ready) {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The Xiaohongshu Vue app or Pinia store is not ready.", verifiedFactKeys);
  }
  return {
    status: "available",
    observed_at: new Date().toISOString(),
    evidence_ref: opaqueRef("validation"),
    verified_fact_keys: verifiedFactKeys
  };
}

export async function waitForXiaohongshuSiteResourceReadiness(
  observe: () => Promise<ReadProbeObservation | undefined>,
  signal: AbortSignal,
  retryDelayMs = 100
): Promise<LocalProviderSiteResourceProbeResult> {
  while (true) {
    signal.throwIfAborted();
    const observation = await observe();
    const result = validateXiaohongshuSiteResourceProbe(observation);
    if (!isPendingXiaohongshuInitialization(observation)) return result;
    await abortableDelay(retryDelayMs, signal);
  }
}

function isPendingXiaohongshuInitialization(observation: ReadProbeObservation | undefined): boolean {
  return observation?.origin === "https://www.xiaohongshu.com" &&
    observation.ready === true &&
    observation.login_like === false &&
    observation.challenge_like === false &&
    typeof observation.vue_ready === "boolean" &&
    typeof observation.pinia_ready === "boolean" &&
    (!observation.vue_ready || !observation.pinia_ready);
}

export function xiaohongshuSiteResourceProbeExpression(): string {
  return `(() => {
    const text = document.body?.innerText || "";
    const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/login') || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    const app = document.querySelector('#app');
    const vue = app?.__vue_app__;
    const pinia = window.__PINIA__ || window.__pinia || vue?.config?.globalProperties?.$pinia;
    return {
      origin: location.origin,
      ready: document.readyState !== 'loading',
      login_like: login,
      challenge_like: challenge,
      vue_ready: Boolean(vue),
      pinia_ready: pinia?._s instanceof Map
    };
  })()`;
}

function siteResourceProbeUnavailable(
  status: "blocked" | "unavailable" | "unknown",
  failure_class: Extract<LocalProviderSiteResourceProbeResult, { status: "blocked" | "unavailable" | "unknown" }>["failure_class"],
  message: string,
  verified_fact_keys: Extract<LocalProviderSiteResourceProbeResult, { status: "blocked" | "unavailable" | "unknown" }>["verified_fact_keys"] = []
): LocalProviderSiteResourceProbeResult {
  return {
    status,
    failure_class,
    message,
    verified_fact_keys,
    ...(verified_fact_keys.length > 0 ? { evidence_ref: opaqueRef("validation") } : {})
  };
}

export function createFixtureLauncher(status: "ready" | "unavailable" | "profile_locked" | "session_lost" = "ready"): LocalProviderLauncher {
  return async (input) => {
    if (status === "unavailable") return unavailable("provider_unavailable", "Fixture provider unavailable.");
    if (status === "profile_locked") return unavailable("profile_locked", "Fixture profile is locked by another local browser process.");
    if (status === "session_lost") return unavailable("session_lost", "Fixture Runtime Session was lost before validation could complete.");
    const configuration = input.identity_environment
      ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy)
      : null;
    if (input.identity_environment && !configuration) return unavailable("unsupported", "Fixture provider could not resolve identity environment configuration.");
    const evidence_ref = opaqueRef("validation");
    const page = readyPage(input.url, `Fixture page for ${input.url}`);
    return {
      status: "ready",
      execution_surface: "fixture",
      cdp_ref: opaqueRef("cdp"),
      viewer_entry: viewerEntry(input.headless),
      page,
      facts: [
        ...fixtureIdentityEnvironmentConfigurationFacts(configuration, evidence_ref),
        { key: "browser.launch", source: "observed", value: "ready", evidence_ref },
        { key: "cdp.version", source: "validation_evidence", value: "FixtureBrowser 1.0", evidence_ref },
        ...page.facts
      ],
      openUrl: async (url) => readyPage(url, `Fixture page for ${url}`),
      captureScreenshot: async () => fixtureScreenshot(input.url),
      close: async () => {}
    };
  };
}

function unavailable(code: RuntimeErrorCode, message: string, facts: RuntimeFact[] = []): LocalProviderLaunchResult {
  return {
    status: "unavailable",
    error: { code, message, retryable: code !== "unsupported" },
    facts: [...facts, { key: "browser.launch", source: "observed", value: code }]
  };
}

function error(code: RuntimeErrorCode, message: string, retryable = true): RuntimeErrorFact {
  return { code, message, retryable };
}

function readyPage(current_url: string, title: string | null): LocalProviderPageFacts {
  const evidence_ref = opaqueRef("validation");
  return {
    current_url,
    title,
    status: "ready",
    facts: [
      { key: "page.current_url", source: "observed", value: current_url, evidence_ref },
      { key: "page.title", source: "observed", value: title ?? "unavailable", evidence_ref },
      { key: "page.status", source: "validation_evidence", value: "ready", evidence_ref }
    ]
  };
}

function providerBindingFacts(binding: IdentityEnvironmentProviderBinding | null): RuntimeFact[] {
  const facts: RuntimeFact[] = [
    { key: "provider.management.registered", source: "configured", value: "cloakbrowser,chrome_official" },
    { key: "provider.default", source: "configured", value: "cloakbrowser" },
    { key: "provider.excluded.chromium", source: "configured", value: "not_user_selectable" },
    { key: "provider.reference.donut_browser", source: "configured", value: "mechanism_reference_only" }
  ];
  if (!binding) return facts;
  facts.push(
    { key: "identity_environment.provider_selection", source: "configured", value: binding.selection_reason },
    { key: "identity_environment.provider_notice_required", source: "configured", value: String(binding.requires_user_notice) }
  );
  if (binding.selected_provider) {
    facts.push(
      { key: "provider.id", source: "configured", value: binding.selected_provider.provider_id },
      { key: "provider.role", source: "configured", value: binding.selected_provider.role }
    );
  }
  return facts;
}

function fixtureIdentityEnvironmentConfigurationFacts(
  configuration: ResolvedIdentityEnvironmentLaunchConfiguration | null,
  evidence_ref: string
): RuntimeFact[] {
  if (!configuration) return [];
  const facts: RuntimeFact[] = [
    { key: "identity_environment.provider_id", source: "validation_evidence", value: configuration.provider_id, evidence_ref }
  ];
  if (configuration.proxy_server) facts.push({ key: "identity_environment.proxy", source: "configured", value: "provider_argument_applied" });
  if (configuration.language) facts.push({ key: "identity_environment.language", source: "observed", value: configuration.language, evidence_ref });
  if (configuration.timezone) facts.push({ key: "identity_environment.timezone", source: "observed", value: configuration.timezone, evidence_ref });
  if (configuration.viewport) facts.push({ key: "identity_environment.viewport", source: "observed", value: `${configuration.viewport.width}x${configuration.viewport.height}`, evidence_ref });
  return facts;
}

async function applyAndReadbackProviderConfiguration(
  port: string,
  requestedUrl: string,
  configuration: ResolvedIdentityEnvironmentLaunchConfiguration,
  signal: AbortSignal
): Promise<RuntimeFact[]> {
  const evidence_ref = opaqueRef("validation");
  const facts: RuntimeFact[] = [
    { key: "identity_environment.provider_id", source: "validation_evidence", value: configuration.provider_id, evidence_ref }
  ];
  if (configuration.proxy_server) {
    facts.push({ key: "identity_environment.proxy", source: "configured", value: "provider_argument_applied" });
  }

  const opened = await openProviderUrl(port, requestedUrl, signal);
  if (opened.status !== "ready") {
    throw new Error(`Identity environment configuration could not open the requested page: ${opened.error?.message ?? "unknown failure"}`);
  }
  const page = await activePage(port, requestedUrl, signal);
  if (!page.webSocketDebuggerUrl) throw new Error("Identity environment configuration has no controlled CDP page target.");
  const observed = await withCdp(page.webSocketDebuggerUrl, async (client) => {
    if (configuration.language) await client.send("Emulation.setLocaleOverride", { locale: configuration.language });
    if (configuration.timezone) await client.send("Emulation.setTimezoneOverride", { timezoneId: configuration.timezone });
    if (configuration.viewport) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: configuration.viewport.width,
        height: configuration.viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
    }
    const result = await client.send("Runtime.evaluate", {
      expression: `(() => ({ language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, width: window.innerWidth, height: window.innerHeight }))()`,
      returnByValue: true
    });
    const value = (result.result as { value?: { language?: unknown; timezone?: unknown; width?: unknown; height?: unknown } } | undefined)?.value;
    return value;
  }, signal);
  if (!observed) throw new Error("Provider environment readback returned no observation.");
  if (configuration.language) {
    if (observed.language !== configuration.language) throw new Error("Provider locale readback did not match configured language.");
    facts.push({ key: "identity_environment.language", source: "observed", value: configuration.language, evidence_ref });
  }
  if (configuration.timezone) {
    if (observed.timezone !== configuration.timezone) throw new Error("Provider timezone readback did not match configured timezone.");
    facts.push({ key: "identity_environment.timezone", source: "observed", value: configuration.timezone, evidence_ref });
  }
  if (configuration.viewport) {
    if (observed.width !== configuration.viewport.width || observed.height !== configuration.viewport.height) {
      throw new Error("Provider viewport readback did not match configured dimensions.");
    }
    facts.push({
      key: "identity_environment.viewport",
      source: "observed",
      value: `${configuration.viewport.width}x${configuration.viewport.height}`,
      evidence_ref
    });
  }
  return facts;
}

function viewerEntry(headless: boolean): Exclude<LocalProviderLaunchResult, { status: "unavailable" }>["viewer_entry"] {
  return headless ? {
    availability: "unsupported",
    access_mode: "none",
    transport: "not_applicable",
    input_capabilities: [],
    unavailable_reason: "unsupported"
  } : {
    availability: "available",
    access_mode: "interactive",
    transport: "local_window",
    input_capabilities: ["keyboard_mouse"]
  };
}

async function waitForDevtoolsPort(profileDir: string, deadline: number, signal?: AbortSignal): Promise<string> {
  const portFile = join(profileDir, "DevToolsActivePort");
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split("\n");
      if (port) return port;
    } catch {
      await abortableDelay(25, signal);
    }
  }
  throw new Error("Timed out waiting for local browser CDP readiness.");
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function remainingLaunchTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Timed out reading local browser CDP readiness.");
  return remaining;
}

async function removeStaleDevtoolsPort(profileDir: string): Promise<void> {
  const portFile = join(profileDir, "DevToolsActivePort");
  let port = "";
  try {
    [port] = (await readFile(portFile, "utf8")).trim().split("\n");
  } catch {
    return;
  }
  if (port && await isDevtoolsPortReachable(port)) return;
  await rm(portFile, { force: true });
}

async function isDevtoolsPortReachable(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
    return response.ok && hasCdpWebSocketEndpoint(await response.json());
  } catch {
    return false;
  }
}

function hasCdpWebSocketEndpoint(version: unknown): boolean {
  const endpoint = typeof version === "object" && version !== null
    ? (version as Record<string, unknown>).webSocketDebuggerUrl
    : null;
  if (typeof endpoint !== "string") return false;
  try {
    const url = new URL(endpoint);
    return (url.protocol === "ws:" || url.protocol === "wss:") && url.hostname !== "";
  } catch {
    return false;
  }
}

async function fetchVersion(port: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal });
  if (!response.ok) throw new Error(`CDP readiness probe failed: ${response.status}`);
  return (await response.json()) as Record<string, string>;
}

function observedBrowserVersion(facts: Record<string, string>): string {
  const product = facts.Browser ?? "";
  const match = product.match(/(?:^|\/)([0-9]+(?:\.[0-9]+){3,4})$/);
  if (!match) throw new Error("Provider launch did not report a supported browser version.");
  return match[1]!;
}

function compatibleBrowserVersion(observed: string, target: string): boolean {
  const observedParts = observed.split(".");
  const targetParts = target.split(".");
  return observed === target || observedParts.slice(0, 4).join(".") === targetParts.slice(0, 4).join(".");
}

async function openProviderUrl(port: string, url: string, signal?: AbortSignal): Promise<LocalProviderPageFacts> {
  try {
    return readTargetPageFacts(await createProviderPage(port, url, signal), url, signal);
  } catch (cause) {
    return unavailablePageFacts("url_unreachable", url, cause);
  }
}

async function probeProviderReadOperation(port: string, input: LocalProviderReadProbeInput): Promise<LocalProviderReadProbeResult> {
  try {
    const bootstrapUrl = input.site_id === "xiaohongshu" ? "https://www.xiaohongshu.com/explore" : "about:blank";
    const page = await createProviderPage(port, bootstrapUrl, undefined, input.expected_origin);
    if (!page.id || !page.webSocketDebuggerUrl) throw new Error("Read-operation page has no target id or CDP websocket.");
    const observation = await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Page.enable");
      await client.send("Runtime.enable");
      await client.send("Network.enable", {
        maxTotalBufferSize: 20_000_000,
        maxResourceBufferSize: 5_000_000,
        enableDurableMessages: true
      });
      await client.send("Network.setCacheDisabled", { cacheDisabled: true });
      await client.send("Network.setBypassServiceWorker", { bypass: true });
      let blockedRedirect = false;
      let xhsFetchResponse: Promise<XhsSearchResponseSummary | XhsSearchResponseFailure> | null = null;
      await client.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }]
      });
      const stopIntercepting = client.on("Fetch.requestPaused", (event) => {
        const requestId = typeof event.requestId === "string" ? event.requestId : "";
        const request = event.request as { url?: unknown; method?: unknown } | undefined;
        const url = typeof request?.url === "string" ? request.url : "";
        const method = typeof request?.method === "string" ? request.method : "";
        if (!requestId) return;
        if (shouldBlockReadOperationDocumentNavigation(event.resourceType, url, input.expected_origin)) {
          blockedRedirect = true;
          void client.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
          return;
        }
        if (
          typeof event.responseStatusCode === "number" &&
          input.operation_id === "xhs_search_notes" &&
          method === "POST" &&
          isOperationReadNetworkUrl(input, url)
        ) {
          xhsFetchResponse = readXhsSearchResponseSummary(client, requestId, "Fetch")
            .finally(() => client.send("Fetch.continueRequest", { requestId }).catch(() => undefined));
          return;
        }
        if (input.operation_id === "xhs_search_notes" && method === "POST" && isOperationReadNetworkUrl(input, url)) {
          void client.send("Fetch.continueRequest", { requestId, interceptResponse: true }).catch(() => undefined);
          return;
        }
        void client.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
      });
      let navigationStarted = false;
      let operationResponse: { requestId: string; status: number; url: string } | null = null;
      let bossDetailResponse: { requestId: string; status: number; url: string } | null = null;
      const requestMethods = new Map<string, string>();
      const completedResponseRequests = new Set<string>();
      const stopObservingRequests = client.on("Network.requestWillBeSent", (event) => {
        const requestId = typeof event.requestId === "string" ? event.requestId : "";
        const request = event.request as { method?: unknown } | undefined;
        if (requestId && typeof request?.method === "string") requestMethods.set(requestId, request.method);
      });
      const stopObservingResponses = client.on("Network.responseReceived", (event) => {
        const response = event.response as { url?: unknown; status?: unknown } | undefined;
        const status = typeof response?.status === "number" ? response.status : null;
        const requestId = typeof event.requestId === "string" ? event.requestId : "";
        if (navigationStarted && input.operation_id === "boss_read_job_detail" && status !== null && status >= 200 && status < 300 && requestId && isBossJobDetailWapiUrl(input, response?.url)) {
          bossDetailResponse = { requestId, status, url: response!.url as string };
        } else if (
          navigationStarted &&
          status !== null &&
          status >= 200 &&
          status < 300 &&
          requestId &&
          (input.operation_id !== "xhs_search_notes" || requestMethods.get(requestId) === "POST") &&
          isOperationReadNetworkUrl(input, response?.url)
        ) operationResponse = { requestId, status, url: response!.url as string };
      });
      const stopObservingLoading = client.on("Network.loadingFinished", (event) => {
        if (typeof event.requestId === "string") completedResponseRequests.add(event.requestId);
      });
      const stopObservingNetwork = () => {
        stopObservingRequests();
        stopObservingResponses();
        stopObservingLoading();
      };
      navigationStarted = true;
      await navigateProviderPage(client, input.target_url);
      for (let attempt = 0; attempt < 20; attempt++) {
        if (blockedRedirect) {
          stopObservingNetwork();
          stopIntercepting();
          return { blocked_redirect: true };
        }
        const evaluated = await client.send("Runtime.evaluate", {
          expression: readProbeExpression(input.site_id, input.query ?? "", input.city_code, input.operation_id),
          returnByValue: true
        });
        const value = (evaluated.result as { value?: {
          origin?: string;
          pathname?: string;
          search?: string;
          ready?: boolean;
          rendered_surface?: boolean;
          login_like?: boolean;
          challenge_like?: boolean;
          vue_ready?: boolean;
          pinia_ready?: boolean;
          list_valid?: boolean;
          list_failure?: "empty_result" | "page_not_ready" | "field_missing" | "site_changed";
          note_count?: number;
          normalized?: ObservedDetailPublicSummary;
          detail_urls?: string[];
          search_items?: XiaohongshuSearchPublicFields[];
        } } | undefined)?.value;
        const observedResponse = operationResponse as { requestId: string; status: number; url: string } | null;
        const observedBossDetailResponse = bossDetailResponse as { requestId: string; status: number; url: string } | null;
        const operationBodyReady = input.operation_id !== "xhs_search_notes" && input.operation_id !== "boss_job_search" ||
          observedResponse !== null && completedResponseRequests.has(observedResponse.requestId);
        const bossDetailBodyReady = input.operation_id !== "boss_read_job_detail" ||
          observedBossDetailResponse !== null && completedResponseRequests.has(observedBossDetailResponse.requestId);
        if (value?.origin && (value.challenge_like || value.login_like)) {
          stopObservingNetwork();
          stopIntercepting();
          return { validation: validateReadOperationProbe(input, value) };
        }
        if (value?.origin && value.ready && observedResponse !== null && operationBodyReady && bossDetailBodyReady) {
          const xhsResponse = input.operation_id === "xhs_search_notes"
            ? await (xhsFetchResponse ?? readXhsSearchResponseSummary(client, observedResponse.requestId))
            : null;
          const bossResponse = input.operation_id === "boss_job_search"
            ? await readBossJobSearchResponseSummary(client, observedResponse.requestId)
            : null;
          const bossDetailSummary = input.operation_id === "boss_read_job_detail" && observedBossDetailResponse
            ? await readBossJobDetailResponseSummary(client, observedBossDetailResponse.requestId, bossDetailTargetId(input.target_url))
            : null;
          const validation = validateReadOperationProbe(input, {
            ...value,
            operation_response_status: observedResponse.status,
            operation_response_url: observedResponse.url,
            xhs_response: xhsResponse,
            boss_response: bossResponse,
            boss_detail_response: bossDetailSummary,
            boss_detail_response_status: observedBossDetailResponse?.status,
            boss_detail_response_url: observedBossDetailResponse?.url
          });
          if (
            input.operation_id === "xhs_read_note_detail" &&
            validation.status === "unavailable" &&
            validation.failure_class === "page_not_ready" &&
            value.pathname === new URL(input.target_url).pathname &&
            value.login_like === false &&
            value.challenge_like === false
          ) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          if (
            input.operation_id === "xhs_search_notes" &&
            validation.status === "unavailable" &&
            validation.failure_class === "page_not_ready" &&
            (value.pathname === "/search_result" || value.pathname === "/search_result/")
          ) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          stopObservingNetwork();
          stopIntercepting();
          if (validation.status === "unavailable") return { validation };
          const screenshot = await captureProbeScreenshot(client);
          return screenshot ? {
            validation,
            screenshot_ref: screenshot.screenshot_ref
          } : { evidence_missing: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      stopObservingNetwork();
      stopIntercepting();
      return null;
    }).finally(() => closeProviderPage(port, page.id!, page.webSocketDebuggerUrl).catch(() => undefined));
    const pageFacts = readOperationPageFacts(input.target_url);
    if (!observation) return probeUnavailable("page_not_ready", "The read-operation page did not reach a ready state.", true, pageFacts);
    if (observation.blocked_redirect) return probeUnavailable("origin_drift", "A cross-origin document redirect was blocked before navigation.", false, pageFacts);
    if (observation.evidence_missing) return probeUnavailable("evidence_refs_missing", "The local provider could not capture required refs-only evidence.", true, pageFacts);
    const validation = observation.validation;
    if (!validation || validation.status === "unavailable") {
      return probeUnavailable(validation?.failure_class ?? "page_not_ready", validation?.message ?? "The read-operation page did not reach a ready state.", validation?.retryable ?? true, pageFacts);
    }
    const source_refs = validation.source_kinds.map((kind) => ({ kind, ref: opaqueRef("source") }));
    const evidence_ref_kinds = [
      { kind: "snapshot_ref", ref: observation.screenshot_ref! },
      ...(input.operation_id === "boss_job_search" ? [{ kind: "network_summary_ref", ref: opaqueRef("evidence") }] : [])
    ];
    return {
      status: "completed",
      observed_at: new Date().toISOString(),
      observed_origin: input.expected_origin,
      page: pageFacts,
      source_refs,
      evidence_ref_kinds,
      public_summary_source_ref: source_refs.find((source) => source.kind === "network_summary" || source.kind === "wapi_job_detail_summary")?.ref ?? source_refs[0]!.ref,
      public_summary: validation.public_summary,
      detail_targets: validation.detail_urls?.map((canonical_url) => ({ canonical_url })),
      search_items: validation.search_items
    };
  } catch (cause) {
    if (cause instanceof ProviderOriginDriftError) {
      return probeUnavailable("origin_drift", cause.message, false);
    }
    return probeUnavailable(
      cause instanceof ProviderPageCommitError ? "page_not_ready" : "network_resource_unavailable",
      cause instanceof Error ? cause.message : "The provider read-only probe failed.",
      true
    );
  }
}

function probeUnavailable(
  failure_class: Extract<LocalProviderReadProbeResult, { status: "unavailable" }>["failure_class"],
  message: string,
  retryable: boolean,
  page?: LocalProviderPageFacts
): LocalProviderReadProbeResult {
  return { status: "unavailable", failure_class, message, retryable, page };
}

interface ReadProbeObservation {
  origin?: string;
  pathname?: string;
  search?: string;
  ready?: boolean;
  rendered_surface?: boolean;
  vue_owned?: boolean;
  job_card_count?: number;
  job_cards_valid?: boolean;
  login_like?: boolean;
  challenge_like?: boolean;
  vue_ready?: boolean;
  pinia_ready?: boolean;
  list_valid?: boolean;
  list_failure?: "empty_result" | "page_not_ready" | "field_missing" | "site_changed";
  note_count?: number;
  normalized?: ObservedDetailPublicSummary;
  detail_urls?: string[];
  search_items?: XiaohongshuSearchPublicFields[];
  operation_response_status?: number;
  operation_response_url?: string;
  xhs_response?: XhsSearchResponseSummary | XhsSearchResponseFailure | null;
  boss_response?: BossJobSearchResponseSummary | BossJobSearchResponseFailure | null;
  boss_detail_response?: BossJobDetailResponseSummary | BossJobSearchResponseFailure | null;
  boss_detail_response_status?: number;
  boss_detail_response_url?: string;
  blocked_redirect?: boolean;
  evidence_missing?: boolean;
  screenshot_ref?: string;
  validation?: ReturnType<typeof validateReadOperationProbe>;
}

async function createProviderPage(
  port: string,
  url: string,
  signal?: AbortSignal,
  expectedOrigin?: string
): Promise<CdpPageTarget> {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT", signal });
  if (!response.ok) throw new Error(`CDP read-operation target creation failed: ${response.status}`);
  const page = await response.json() as CdpPageTarget;
  if (!page.id) throw new Error("Created page has no target id.");
  try {
    if (!page.webSocketDebuggerUrl) throw new Error("Created page has no CDP websocket.");
    if (url === "about:blank") return page;
    const committedUrl = await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Page.enable");
      let blockedRedirect = false;
      const stopIntercepting = expectedOrigin
        ? await interceptProviderDocumentNavigation(client, expectedOrigin, () => { blockedRedirect = true; })
        : () => undefined;
      await navigateProviderPage(client, url);
      try {
        const committedUrl = await waitForProviderPageCommit(client, signal, () => blockedRedirect);
        if (blockedRedirect) throw new ProviderOriginDriftError("A cross-origin bootstrap redirect was blocked before navigation.");
        if (!committedUrl) throw new ProviderPageCommitError("Created page did not commit the requested URL.");
        return committedUrl;
      } finally {
        stopIntercepting();
      }
    }, signal);
    return { ...page, url: committedUrl };
  } catch (cause) {
    await closeProviderPage(port, page.id, page.webSocketDebuggerUrl).catch(() => undefined);
    throw cause;
  }
}

async function navigateProviderPage(client: CdpClient, url: string): Promise<void> {
  await client.send("Runtime.enable");
  void client.send("Runtime.evaluate", {
    expression: `location.assign(${JSON.stringify(url)})`,
    returnByValue: true
  }).catch(() => undefined);
}

async function waitForProviderPageCommit(
  client: CdpClient,
  signal?: AbortSignal,
  shouldStop: () => boolean = () => false
): Promise<string | null> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (shouldStop()) return null;
    signal?.throwIfAborted();
    let result: Record<string, unknown>;
    try {
      result = await client.send("Page.getFrameTree", {}, Math.min(500, Math.max(1, deadline - Date.now())));
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    const frame = (result.frameTree as { frame?: { url?: unknown } } | undefined)?.frame;
    if (typeof frame?.url === "string" && isCommittedHttpPage(frame.url)) return frame.url;
    await abortableDelay(Math.min(250, Math.max(1, deadline - Date.now())), signal);
  }
  return null;
}

async function closeProviderPage(port: string, targetId: string, webSocketUrl?: string): Promise<void> {
  if (webSocketUrl) {
    try {
      const signal = AbortSignal.timeout(1000);
      await withCdp(webSocketUrl, (client) => client.send("Page.close", {}, 1000), signal);
      return;
    } catch {
      // Fall back to the browser target endpoint when the page session cannot close itself.
    }
  }
  const response = await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`, {
    signal: AbortSignal.timeout(1000)
  });
  if (!response.ok) throw new Error(`CDP read-operation target cleanup failed: ${response.status}`);
}

function isCommittedHttpPage(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function interceptProviderDocumentNavigation(
  client: CdpClient,
  expectedOrigin: string,
  onBlocked: () => void
): Promise<() => void> {
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return client.on("Fetch.requestPaused", (event) => {
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const resourceType = event.resourceType;
    const request = event.request as { url?: unknown } | undefined;
    const url = typeof request?.url === "string" ? request.url : "";
    if (!requestId) return;
    if (shouldBlockReadOperationDocumentNavigation(resourceType, url, expectedOrigin)) {
      onBlocked();
      void client.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
      return;
    }
    void client.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
  });
}

export function shouldBlockReadOperationDocumentNavigation(resourceType: unknown, value: string, expectedOrigin: string): boolean {
  if (resourceType !== "Document") return false;
  try {
    return new URL(value).origin !== expectedOrigin;
  } catch {
    return true;
  }
}

async function captureProbeScreenshot(client: CdpClient): Promise<LocalProviderScreenshotFacts | null> {
  try {
    const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const data = typeof result.data === "string" ? result.data : "";
    return data ? screenshotFacts(Buffer.from(data, "base64")) : null;
  } catch {
    return null;
  }
}

export function validateReadOperationProbe(
  input: LocalProviderReadProbeInput,
  observation: ReadProbeObservation
):
  | { status: "completed"; source_kinds: string[]; public_summary: LocalProviderReadProbePublicSummary; detail_urls?: string[]; search_items?: XiaohongshuSearchPublicFields[] }
  | { status: "unavailable"; failure_class: Extract<LocalProviderReadProbeResult, { status: "unavailable" }>["failure_class"]; message: string; retryable: boolean } {
  if (observation.origin !== input.expected_origin) return { status: "unavailable", failure_class: "origin_drift", message: "The read-operation page left the pinned allowed origin.", retryable: false };
  if (observation.challenge_like) return { status: "unavailable", failure_class: "safety_challenge", message: "The read-operation page shows a verification or safety challenge.", retryable: false };
  if (observation.login_like) return { status: "unavailable", failure_class: "not_logged_in", message: "The read-operation page requires a manual login refresh.", retryable: true };
  if (!observation.ready) return { status: "unavailable", failure_class: "page_not_ready", message: "The read-operation page did not reach the expected operation surface.", retryable: true };
  if (input.operation_id === "xhs_read_note_detail" || input.operation_id === "boss_read_job_detail") {
    const xhs = input.operation_id === "xhs_read_note_detail";
    const expectedPath = new URL(input.target_url).pathname;
    const pathMatches = observation.pathname === expectedPath;
    const rendered = observation.rendered_surface === true;
    if (!pathMatches || !rendered || !isSuccessfulReadResponse(observation.operation_response_status) || !isOperationReadNetworkUrl(input, observation.operation_response_url)) {
      return { status: "unavailable", failure_class: rendered ? "site_changed" : "empty_result", message: "The bound detail page did not expose the expected read-only surface.", retryable: true };
    }
    if (xhs && (!observation.vue_ready || !observation.pinia_ready)) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu detail Vue app or Pinia note store is not ready.", retryable: true };
    }
    const normalized = validateDetailNormalizedSummary(input, observation.normalized);
    if (!normalized) return { status: "unavailable", failure_class: "field_missing", message: "Required bounded public detail fields are missing.", retryable: true };
    if (!xhs) {
      if (!isSuccessfulReadResponse(observation.boss_detail_response_status) || !isBossJobDetailWapiUrl(input, observation.boss_detail_response_url)) {
        return { status: "unavailable", failure_class: "network_resource_unavailable", message: "The bound BOSS detail WAPI response was not observed.", retryable: true };
      }
      if (!observation.boss_detail_response || observation.boss_detail_response.status === "unavailable") {
        return observation.boss_detail_response ?? { status: "unavailable", failure_class: "network_resource_unavailable", message: "The BOSS detail WAPI summary is unavailable.", retryable: true };
      }
      if (!sameBossDetailSummary(normalized, observation.boss_detail_response)) {
        return { status: "unavailable", failure_class: "site_changed", message: "The BOSS detail WAPI and rendered summary do not match.", retryable: true };
      }
    }
    return {
      status: "completed",
      source_kinds: xhs
        ? ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
        : ["wapi_job_detail_summary", "dom_snapshot_summary"],
      public_summary: {
        schema_version: "harbor-read-operation-public-summary/v0",
        operation_id: input.operation_id,
        result_kind: xhs ? "xiaohongshu_note_detail_surface" : "boss_job_detail_surface",
        surface: xhs ? "note_detail" : "job_detail",
        result_state: "operation_read_response_observed",
        response_status: observation.operation_response_status,
        normalized,
        source_signals: xhs
          ? ["pinia_note_store_ready", "xhs_note_detail_document", "xhs_note_detail_rendered"]
          : ["boss_job_detail_document"]
      }
    };
  }
  if (input.operation_id === "xhs_search_notes") {
    const xhsSurface = observation.pathname === "/search_result" || observation.pathname === "/search_result/";
    if (!xhsSurface || !hasExactPublicQuery(observation.search, "keyword", input.query ?? "") || !observation.pinia_ready || !isSuccessfulReadResponse(observation.operation_response_status) || !isOperationReadNetworkUrl(input, observation.operation_response_url)) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "Xiaohongshu search/note, Pinia, or operation-specific read signal is unavailable.", retryable: true };
    }
    const detailUrls = observation.detail_urls ?? [];
    const searchItems = observation.search_items ?? [];
    if (!observation.xhs_response) {
      return { status: "unavailable", failure_class: "network_resource_unavailable", message: "The Xiaohongshu search response summary is unavailable.", retryable: true };
    }
    if (observation.xhs_response.status === "unavailable") {
      if (observation.xhs_response.failure_class !== "empty_result" || observation.list_failure === "empty_result") {
        return observation.xhs_response;
      }
      if (observation.list_failure === "page_not_ready") {
        return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu search page is still settling after an empty response.", retryable: true };
      }
      return { status: "unavailable", failure_class: "site_changed", message: "The Xiaohongshu search response and rendered page disagree about whether results exist.", retryable: false };
    }
    if (observation.list_failure === "empty_result") {
      return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu search response has results while the rendered page is still hydrating.", retryable: true };
    }
    if (observation.list_failure) {
      return { status: "unavailable", failure_class: observation.list_failure, message: "Xiaohongshu search did not expose a valid page-matched note list.", retryable: observation.list_failure === "page_not_ready" };
    }
    if (!observation.list_valid) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "Xiaohongshu search note results are not correlated with the rendered page.", retryable: true };
    }
    const resultLimit = input.limit ?? 15;
    if (!Number.isInteger(observation.note_count) || observation.note_count! < 1 || detailUrls.length !== observation.note_count || searchItems.length !== detailUrls.length || !validXhsSearchTargets(detailUrls)) {
      return { status: "unavailable", failure_class: "site_changed", message: "Xiaohongshu search note targets do not match the expected public shape.", retryable: false };
    }
    if (!validXhsSearchTargets(observation.xhs_response.detail_urls)) {
      return { status: "unavailable", failure_class: "site_changed", message: "The Xiaohongshu search response contains invalid detail navigation targets.", retryable: false };
    }
    const correlated = correlateXhsSearchResults(detailUrls, searchItems, observation.xhs_response.detail_urls, observation.xhs_response.search_items, resultLimit);
    if (!correlated) {
      return { status: "unavailable", failure_class: "site_changed", message: "The Xiaohongshu search response and Pinia public fields do not match.", retryable: false };
    }
    return {
      status: "completed",
      source_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"],
      public_summary: {
        schema_version: "harbor-read-operation-public-summary/v0",
        operation_id: "xhs_search_notes",
        result_kind: "xiaohongshu_search_notes_surface",
        surface: "search_result",
        result_state: "operation_read_response_observed",
        response_status: observation.operation_response_status,
        result_count: correlated.detail_urls.length,
        source_signals: ["pinia_store", "xhs_search_read_network"]
      },
      detail_urls: correlated.detail_urls,
      search_items: correlated.search_items
    };
  }
  const bossJobsSurface = observation.pathname === "/web/geek/job";
  if (!hasExactPublicQuery(observation.search, "city", input.city_code ?? "")) {
    return { status: "unavailable", failure_class: "city_unresolved", message: "BOSS search city does not match the admitted city code.", retryable: true };
  }
  if (!bossJobsSurface || !hasExactBossSearch(observation.search, input.query ?? "", input.city_code ?? "") || !observation.rendered_surface || !isSuccessfulReadResponse(observation.operation_response_status) || !isOperationReadNetworkUrl(input, observation.operation_response_url)) {
    return { status: "unavailable", failure_class: "page_not_ready", message: "BOSS jobs surface or required WAPI read signal is unavailable.", retryable: true };
  }
  if (!observation.boss_response) return { status: "unavailable", failure_class: "site_changed", message: "BOSS WAPI response summary is unavailable.", retryable: true };
  if (observation.boss_response.status === "unavailable") return observation.boss_response;
  return {
    status: "completed",
    source_kinds: ["network_summary"],
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v0",
      operation_id: "boss_job_search",
      result_kind: "boss_job_search_surface",
      surface: "web_geek_jobs",
      result_state: "operation_read_response_observed",
      response_status: observation.operation_response_status,
      query: input.query,
      city_code: input.city_code,
      business_code: observation.boss_response.business_code,
      job_count: observation.boss_response.job_count,
      source_signals: ["boss_wapi_zpgeek_read_network"]
    },
    detail_urls: observation.boss_response.detail_urls
  };
}

function validXhsSearchTargets(values: readonly string[]): boolean {
  if (new Set(values).size !== values.length) return false;
  return values.every((value) => isCanonicalDetailUrl("xiaohongshu", value));
}

function correlateXhsSearchResults(
  renderedUrls: readonly string[],
  renderedItems: readonly XiaohongshuSearchPublicFields[],
  networkUrls: readonly string[],
  networkItems: readonly XiaohongshuSearchPublicFields[],
  limit: number
): { detail_urls: string[]; search_items: XiaohongshuSearchPublicFields[] } | null {
  if (networkUrls.length !== networkItems.length || renderedUrls.length !== renderedItems.length) return null;
  const entries = networkUrls.map((value, index) => {
    const url = new URL(value);
    return [`${url.origin}${url.pathname}`, { url: value, item: networkItems[index]! }] as const;
  });
  const byPath = new Map(entries);
  if (byPath.size !== entries.length) return null;
  const correlated: Array<{ url: string; item: XiaohongshuSearchPublicFields }> = [];
  for (const [index, value] of renderedUrls.entries()) {
    const url = new URL(value);
    const result = byPath.get(`${url.origin}${url.pathname}`);
    if (!result) continue;
    if (!sameXhsSearchFields(renderedItems[index]!, result.item)) return null;
    correlated.push(result);
  }
  const bounded = correlated.slice(0, limit);
  return bounded.length > 0
    ? { detail_urls: bounded.map((value) => value.url), search_items: bounded.map((value) => value.item) }
    : null;
}

function sameXhsSearchFields(left: XiaohongshuSearchPublicFields, right: XiaohongshuSearchPublicFields): boolean {
  return left.title === right.title &&
    left.author_display_name === right.author_display_name &&
    JSON.stringify(left.interaction_metrics ?? {}) === JSON.stringify(right.interaction_metrics ?? {});
}

function isSuccessfulReadResponse(status: unknown): status is number {
  return typeof status === "number" && Number.isInteger(status) && status >= 200 && status < 300;
}

function validateDetailNormalizedSummary(
  input: LocalProviderReadProbeInput,
  value: ObservedDetailPublicSummary | undefined
): LocalProviderDetailPublicSummary | null {
  const target = new URL(input.target_url);
  const canonical_url = `${target.origin}${target.pathname}`;
  if (input.operation_id === "xhs_read_note_detail") {
    const noteId = target.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (value?.kind !== "xiaohongshu_note_detail" || value.canonical_url !== canonical_url || value.note_id !== noteId || !/^[a-f0-9]{24}$/i.test(value.note_id) ||
      !boundedText(value.title, 200) || !boundedText(value.summary, 500) || !boundedText(value.body_summary, 2000) ||
      !boundedText(value.author.display_name, 100) || !boundedText(value.author.author_id, 100) ||
      !validPublicProfileUrl(value.author.profile_url, value.author.author_id) || !validMetrics(value.interaction_metrics) ||
      (value.source_status !== "located" && value.source_status !== "partially_located")) return null;
    return {
      kind: value.kind,
      canonical_url,
      note_id: value.note_id,
      title: value.title,
      summary: value.summary,
      body_summary: value.body_summary,
      author: { display_name: value.author.display_name, author_id: value.author.author_id, profile_url: value.author.profile_url },
      interaction_metrics: { ...value.interaction_metrics },
      source_citation: {
        kind: "xhs_note_detail_ref",
        note_id: value.note_id,
        url: canonical_url,
        // Lode v0 has one aggregate citation for all validated public fields.
        field_sources: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
      },
      source_status: value.source_status
    };
  }
  if (value?.kind !== "boss_job_detail" || value.canonical_url !== canonical_url ||
    !boundedText(value.title, 200) || !boundedText(value.summary, 500) || !boundedText(value.job.title, 200) ||
    !boundedText(value.job.description, 4000) || !boundedText(value.job.status, 100) || !optionalBoundedText(value.job.salary, 100) || !optionalBoundedText(value.job.location, 100) ||
    !boundedText(value.company.name, 200) || !boundedText(value.recruiter.name, 100) || !boundedText(value.recruiter.title, 100) ||
    (value.source_status !== "located" && value.source_status !== "partially_located")) return null;
  if (!input.detail_ref || !/^detail_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.detail_ref)) return null;
  return {
    kind: value.kind,
    canonical_url,
    detail_ref: input.detail_ref,
    title: value.title,
    summary: value.summary,
    job: {
      title: value.job.title,
      description: value.job.description,
      status: value.job.status,
      ...(value.job.salary ? { salary: value.job.salary } : {}),
      ...(value.job.location ? { location: value.job.location } : {})
    },
    company: { name: value.company.name },
    recruiter: { name: value.recruiter.name, title: value.recruiter.title },
    source_citation: {
      kind: "boss_job_detail_ref",
      detail_ref: input.detail_ref,
      url: canonical_url,
      field_sources: ["wapi_job_detail_summary", "dom_snapshot_summary"]
    },
    source_status: value.source_status
  };
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function optionalBoundedText(value: unknown, max: number): boolean {
  return value === undefined || boundedText(value, max);
}

function validPublicProfileUrl(value: string, authorId: string): boolean {
  return value === `https://www.xiaohongshu.com/user/profile/${authorId}` && /^[A-Za-z0-9_]+$/.test(authorId);
}

function validMetrics(value: XiaohongshuNoteDetailPublicSummary["interaction_metrics"]): boolean {
  return [value.likes, value.comments, value.collects, value.shares].every((entry) =>
    typeof entry === "string" && entry.length > 0 && entry.length <= 40 && entry.trim() === entry && !/[\u0000-\u001f\u007f]/.test(entry)
  );
}

function sameBossDetailSummary(value: LocalProviderDetailPublicSummary, source: BossJobDetailResponseSummary): boolean {
  return value.kind === "boss_job_detail" && value.title === source.title && value.summary === source.summary &&
    value.job.title === source.title && value.job.description === source.description && value.job.status === source.job_status &&
    value.job.salary === source.salary && value.job.location === source.location && value.company.name === source.company_name &&
    value.recruiter.name === source.recruiter_name && value.recruiter.title === source.recruiter_title;
}

export function readProbeExpression(siteId: LocalProviderReadProbeInput["site_id"], query: string, cityCode?: string, operationId?: LocalProviderReadProbeInput["operation_id"]): string {
  if (operationId === "xhs_read_note_detail" || operationId === "boss_read_job_detail") return `(() => {
    const text = document.body?.innerText || "";
    const clean = (value, max) => {
      if (typeof value !== "string") return "";
      const truncated = value.replace(/\\s+/g, " ").trim().slice(0, max);
      return /[\\uD800-\\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
    };
    const pick = (selectors, max) => clean(document.querySelector(selectors)?.textContent, max);
    const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    const canonicalUrl = location.origin + location.pathname;
    const rendered = ${operationId === "xhs_read_note_detail"
      ? "Boolean(document.querySelector('#detail-desc, .note-detail-mask, [class*=note-content], [class*=interaction-container]'))"
      : "Boolean(document.querySelector('.job-detail-box, .job-detail-container, [class*=job-detail], .job-sec-text'))"};
    ${operationId === "xhs_read_note_detail" ? `
    const app = document.querySelector('#app');
    const vue = app?.__vue_app__;
    const pinia = window.__PINIA__ || window.__pinia || vue?.config?.globalProperties?.$pinia;
    const stores = pinia?._s;
    const unwrap = (value) => value && typeof value === "object" && "value" in value ? value.value : value;
    const sameBoundedBody = (rendered, stored) => {
      const compact = (value) => value.replace(/\\[话题\\]#/g, "").replace(/[\\s\\u200B-\\u200D\\uFEFF]+/g, "");
      const renderedCompact = compact(rendered);
      const storedCompact = compact(stored);
      const renderedCharacters = Array.from(renderedCompact);
      const storedCharacters = Array.from(storedCompact);
      if (renderedCompact === storedCompact) return true;
      if (storedCharacters.length >= 8 && storedCharacters.length * 2 >= renderedCharacters.length && renderedCompact.includes(storedCompact)) return true;
      if (renderedCharacters.length < 8 || renderedCharacters.length * 2 < storedCharacters.length) return false;
      const withoutPresentationCharacters = storedCompact.replace(/[\\p{Extended_Pictographic}\\uFE00-\\uFE0F\\u200D\\u{1F3FB}-\\u{1F3FF}\\u{E0100}-\\u{E01EF}]/gu, "");
      return renderedCompact === withoutPresentationCharacters;
    };
    const detailRoot = document.querySelector('#noteContainer') || document.querySelector('.note-detail-mask, [class*="note-detail"]');
    const pickDetail = (selectors, max) => clean(detailRoot?.querySelector(selectors)?.textContent, max);
    const title = pickDetail('.note-content .title, #detail-title, [class*="note-title"]', 200);
    const body = pickDetail('#detail-desc, .note-content .desc, [class*="note-desc"]', 2000);
    const author = clean(detailRoot?.querySelector('.author-container .name, .author-wrapper .name, [class*="author"] [class*="name"]')?.textContent, 100);
    const authorLink = detailRoot?.querySelector('.author-container a[href*="/user/profile/"], .author-wrapper a[href*="/user/profile/"], [class*="author"] a[href*="/user/profile/"]');
    const profilePath = authorLink ? new URL(authorLink.getAttribute('href'), location.origin).pathname : "";
    const authorId = profilePath.startsWith('/user/profile/') ? profilePath.slice('/user/profile/'.length).split('/')[0] : "";
    const profileUrl = authorId ? location.origin + '/user/profile/' + authorId : "";
    const engagementRoot = detailRoot?.querySelector('.interactions.engage-bar');
    const pickMetric = (selectors) => clean(engagementRoot?.querySelector(selectors)?.textContent, 40);
    const likes = pickMetric('[class*="like"] [class*="count"], .like-wrapper .count');
    const comments = pickMetric('[class*="comment"] [class*="count"], .comment-wrapper .count');
    const collects = pickMetric('[class*="collect"] [class*="count"], .collect-wrapper .count');
    const shares = pickMetric('[class*="share"] [class*="count"], .share-wrapper .count');
    const noteId = location.pathname.split('/').filter(Boolean).at(-1) || "";
    const noteStores = stores instanceof Map ? Array.from(stores.entries()).filter(([key]) => /note|detail/i.test(String(key))) : [];
    let matchedMetrics;
    const matchesStore = ([, candidate]) => {
      const state = unwrap(candidate?.$state) || candidate;
      const detailMap = unwrap(state?.noteDetailMap);
      const mappedDetail = detailMap instanceof Map ? unwrap(detailMap.get(noteId)) : unwrap(detailMap?.[noteId]);
      const details = [unwrap(mappedDetail?.note), unwrap(state?.currentNote), unwrap(state?.noteDetail), unwrap(state?.detail), unwrap(state?.note), state].filter((value) => value && typeof value === "object");
      return details.some((detail) => {
        const storeAuthor = unwrap(detail.author) || unwrap(detail.user) || {};
        const storeMetrics = unwrap(detail.interaction_metrics) || unwrap(detail.interactInfo) || unwrap(detail.metrics) || {};
        const metric = (...values) => {
          const value = values.map(unwrap).find((entry) => entry !== undefined && entry !== null);
          return typeof value === "number" && Number.isFinite(value) ? String(value).slice(0, 40) : clean(value, 40);
        };
        const metrics = {
          likes: metric(storeMetrics.likes, storeMetrics.likedCount, storeMetrics.liked_count),
          comments: metric(storeMetrics.comments, storeMetrics.commentCount, storeMetrics.comment_count),
          collects: metric(storeMetrics.collects, storeMetrics.collectedCount, storeMetrics.collected_count),
          shares: metric(storeMetrics.shares, storeMetrics.shareCount, storeMetrics.share_count)
        };
        const matches = clean(unwrap(detail.note_id) || unwrap(detail.noteId) || unwrap(detail.id), 64) === noteId &&
          clean(unwrap(detail.title), 200) === title && sameBoundedBody(body, clean(unwrap(detail.body_summary) || unwrap(detail.desc) || unwrap(detail.description) || unwrap(detail.body), 2000)) &&
          clean(unwrap(storeAuthor.display_name) || unwrap(storeAuthor.nickname) || unwrap(storeAuthor.name), 100) === author &&
          clean(unwrap(storeAuthor.author_id) || unwrap(storeAuthor.userId) || unwrap(storeAuthor.id), 100) === authorId &&
          (!likes || metrics.likes === likes) && (!comments || metrics.comments === comments) &&
          (!collects || metrics.collects === collects) && (!shares || metrics.shares === shares);
        if (matches) matchedMetrics = metrics;
        return matches;
      });
    };
    const piniaReady = noteStores.length > 0;
    const storeMatched = noteStores.some(matchesStore);
    const interactionMetrics = matchedMetrics ? { likes: likes || matchedMetrics.likes, comments: comments || matchedMetrics.comments, collects: collects || matchedMetrics.collects, shares: shares || matchedMetrics.shares } : undefined;
    const publicInteractionMetrics = interactionMetrics ? {
      likes: interactionMetrics.likes || "未显示",
      comments: interactionMetrics.comments || "未显示",
      collects: interactionMetrics.collects || "未显示",
      shares: interactionMetrics.shares || "未显示"
    } : undefined;
    const metricsLocated = Boolean(likes && comments && collects && shares);
    const normalizedTitle = title || clean(body, 200);
    const normalized = storeMatched && normalizedTitle && body && author && authorId && profileUrl && publicInteractionMetrics && /^[A-Za-z0-9]+$/.test(noteId) ? { kind: "xiaohongshu_note_detail", canonical_url: canonicalUrl, note_id: noteId, title: normalizedTitle, summary: clean(body, 500), body_summary: body, author: { display_name: author, author_id: authorId, profile_url: profileUrl }, interaction_metrics: publicInteractionMetrics, source_status: metricsLocated ? "located" : "partially_located" } : undefined;
    return { origin: location.origin, pathname: location.pathname, ready: document.readyState !== 'loading', rendered_surface: rendered, login_like: login, challenge_like: challenge, vue_ready: Boolean(vue), pinia_ready: piniaReady, normalized };`
      : `
    const title = pick('.job-name, .job-detail-box h1, [class*="job-title"]', 200);
    const description = pick('.job-sec-text, .job-detail-section, [class*="job-description"]', 4000);
    const company = pick('.company-info .name, .company-name, [class*="company"] [class*="name"]', 200);
    const recruiter = pick('.boss-name, .job-boss-info .name, [class*="recruiter"] [class*="name"]', 100);
    const recruiterTitle = pick('.boss-info-attr, .job-boss-info .boss-info-attr, [class*="recruiter"] [class*="title"]', 100);
    const salary = pick('.salary, [class*="salary"]', 100);
    const locationText = pick('.location-address, [class*="job-address"], [class*="location"]', 100);
    const status = /职位已关闭|停止招聘|已下线/.test(text) ? "closed" : "available";
    const normalized = title && description && company && recruiter && recruiterTitle ? { kind: "boss_job_detail", canonical_url: canonicalUrl, title, summary: description.slice(0, 500), job: { title, description, status, ...(salary ? { salary } : {}), ...(locationText ? { location: locationText } : {}) }, company: { name: company }, recruiter: { name: recruiter, title: recruiterTitle }, source_status: "located" } : undefined;
    return { origin: location.origin, pathname: location.pathname, ready: document.readyState !== 'loading', rendered_surface: rendered, login_like: login, challenge_like: challenge, normalized };`}
  })()`;
  if (siteId === "boss") return `(() => {
    const text = document.body?.innerText || "";
    const challengeSurface = Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/web/user/') || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    const app = document.querySelector('#wrap, #app');
    const vue3App = app?.__vue_app__;
    const rootComponent = app?._vnode?.component;
    const mountedElement = rootComponent?.vnode?.el || rootComponent?.subTree?.el;
    const vue3Owned = typeof vue3App?.version === 'string' &&
      typeof vue3App?.config?.globalProperties === 'object' &&
      vue3App?._container === app &&
      rootComponent === vue3App?._instance &&
      rootComponent?.appContext?.app === vue3App &&
      Boolean(mountedElement && (mountedElement === app || app.contains(mountedElement)));
    const vue2Instance = app?.__vue__;
    const vue2Owned = Boolean(vue2Instance?._isMounted === true && vue2Instance?.$root === vue2Instance && vue2Instance?.$el === app);
    const vueOwned = vue3Owned || vue2Owned;
    const list = app?.querySelector('.job-list-box, .job-list, [class*="job-list"]');
    const cards = list ? Array.from(list.querySelectorAll('.job-card-wrapper, li.job-card-box, [ka^="search_list_"]')).slice(0, 20) : [];
    const validCards = cards.length > 0 && cards.every((card) => {
      if (!app.contains(list) || !list.contains(card)) return false;
      const jobName = (card.querySelector('.job-name, .job-title, [class*="job-name"]')?.textContent || '').trim();
      const companyName = (card.querySelector('.company-name, [class*="company-name"]')?.textContent || '').trim();
      const link = card.querySelector('a[href*="/job_detail/"]');
      let validLink = false;
      try {
        const href = new URL(link?.getAttribute('href') || '', location.origin);
        validLink = href.origin === location.origin && href.pathname.startsWith('/job_detail/');
      } catch {}
      return jobName.length > 0 && jobName.length <= 200 && companyName.length > 0 && companyName.length <= 200 && validLink;
    });
    return {
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
      ready: document.readyState !== 'loading' && vueOwned && Boolean(list) && app.contains(list),
      vue_owned: vueOwned,
      rendered_surface: vueOwned && Boolean(list) && app.contains(list) && validCards,
      job_card_count: cards.length,
      job_cards_valid: validCards,
      login_like: login,
      challenge_like: challenge
    };
  })()`;
  return `(() => {
    const expectedQuery = ${JSON.stringify(query)};
    const pinia = window.__PINIA__ || window.__pinia || document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia;
    const store = pinia?._s instanceof Map ? pinia._s.get("search") : undefined;
    const unwrap = (value) => value && typeof value === "object" && "value" in value ? value.value : value;
    const clean = (value, max) => {
      if (typeof value !== 'string') return '';
      const text = value.replace(/\\s+/g, ' ').trim();
      if (!text || text.length > max || /[\\u0000-\\u001f\\u007f]/.test(text)) return '';
      if (/(?:^|[^a-z0-9_-])(?:[a-z0-9_-]*token|cookie|authorization|password|passwd|secret|credential|profile[_-]?storage|raw[_-]?(?:dom|har)|network[_-]?response[_-]?body)\\s*[=:]\\s*\\S+/i.test(text) || /\\bbearer\\s+\\S+/i.test(text)) return '';
      return text;
    };
    const metric = (...values) => {
      for (const raw of values) {
        const value = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
        if (value && value.length <= 40 && /^[0-9０-９.,+\\-\\s万千百wWkKmM]+$/u.test(value)) return value;
      }
      return '';
    };
    const feeds = unwrap(store?.feeds);
    const boundedFeeds = Array.isArray(feeds) ? feeds.slice(0, 60) : [];
    const noteCandidate = (feed) => {
      const card = unwrap(feed?.noteCard) || unwrap(feed?.note_card) || {};
      const values = [unwrap(feed?.id), unwrap(feed?.noteId), unwrap(feed?.note_id), unwrap(card?.id), unwrap(card?.noteId), unwrap(card?.note_id)];
      const noteIds = values.filter((entry) => typeof entry === "string" && /^[a-f0-9]{24}$/i.test(entry)).map((entry) => entry.toLowerCase());
      const value = noteIds[0];
      const tokenValues = [unwrap(feed?.xsecToken), unwrap(feed?.xsec_token), unwrap(card?.xsecToken), unwrap(card?.xsec_token)];
      const tokens = tokenValues.filter((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 512 && /^[A-Za-z0-9_-]+={0,2}$/.test(entry));
      const xsecToken = tokens[0];
      const user = unwrap(card?.user) || {};
      const interactions = unwrap(card?.interactInfo) || unwrap(card?.interact_info) || {};
      const title = clean(unwrap(card?.displayTitle) || unwrap(card?.display_title) || unwrap(card?.title), 200);
      const author = clean(unwrap(user?.nickname) || unwrap(user?.displayName) || unwrap(user?.display_name) || unwrap(user?.name), 100);
      const likes = metric(unwrap(interactions?.likedCount), unwrap(interactions?.liked_count), unwrap(interactions?.likes));
      const comments = metric(unwrap(interactions?.commentCount), unwrap(interactions?.comment_count), unwrap(interactions?.comments));
      const collects = metric(unwrap(interactions?.collectedCount), unwrap(interactions?.collected_count), unwrap(interactions?.collects));
      const interactionMetrics = { ...(likes ? { likes } : {}), ...(comments ? { comments } : {}), ...(collects ? { collects } : {}) };
      const publicItem = title ? { title, ...(author ? { author_display_name: author } : {}), ...(Object.keys(interactionMetrics).length ? { interaction_metrics: interactionMetrics } : {}) } : undefined;
      const noteLike = Boolean(feed?.noteCard || feed?.note_card || values.some((entry) => entry !== undefined));
      if (!noteLike) return { kind: 'other' };
      if (new Set(noteIds).size > 1 || new Set(tokens).size > 1) return { kind: 'malformed' };
      return typeof value === "string"
        ? { kind: 'note', id: value, xsecToken, publicItem }
        : { kind: 'nonstandard' };
    };
    const candidates = boundedFeeds.map(noteCandidate);
    const hasMalformedFeed = candidates.some((candidate) => candidate.kind === 'malformed');
    const hasNonstandardFeed = candidates.some((candidate) => candidate.kind === 'nonstandard');
    const allFeedIds = candidates.filter((candidate) => candidate.kind === 'note' && candidate.publicItem).map((candidate) => candidate.id);
    const feedIds = Array.from(new Set(allFeedIds));
    const feedTokenEntries = candidates.filter((candidate) => candidate.kind === 'note' && candidate.xsecToken).map((candidate) => [candidate.id, candidate.xsecToken]);
    const hasCrossFeedTokenConflict = feedTokenEntries.some(([id, token], index) =>
      feedTokenEntries.slice(0, index).some(([previousId, previousToken]) => previousId === id && previousToken !== token));
    const feedTokens = new Map(feedTokenEntries);
    const feedPublicItems = new Map(candidates.filter((candidate) => candidate.kind === 'note' && candidate.publicItem).map((candidate) => [candidate.id, candidate.publicItem]));
    const anchors = typeof document.querySelectorAll === "function" ? Array.from(document.querySelectorAll('a[href*="/explore/"]')).slice(0, 60) : [];
    const pageTargets = new Map();
    for (const anchor of anchors) {
      try {
        const url = new URL(anchor.getAttribute?.('href') || anchor.href || '', location.origin);
        const match = new RegExp('^/explore/([a-f0-9]{24})$', 'i').exec(url.pathname);
        const validQuery = !url.hash &&
          Array.from(url.searchParams.keys()).every((key) => key === 'xsec_token' || key === 'xsec_source') &&
          url.searchParams.getAll('xsec_token').length <= 1 &&
          url.searchParams.getAll('xsec_source').length <= 1;
        if (url.origin !== location.origin || url.username || url.password || !match || !validQuery) continue;
        const id = match[1].toLowerCase();
        pageTargets.set(id, url.href);
      } catch {}
    }
    const detailUrls = feedIds.flatMap((id) => {
      const target = pageTargets.get(id);
      if (!target) return [];
      const targetUrl = new URL(target);
      const token = feedTokens.get(id);
      if (token && !targetUrl.searchParams.has('xsec_token')) {
        targetUrl.searchParams.set('xsec_token', token);
        targetUrl.searchParams.set('xsec_source', 'pc_search');
      }
      return [targetUrl.href];
    });
    const searchItems = detailUrls.flatMap((value) => {
      const id = new URL(value).pathname.split('/').at(-1);
      const item = feedPublicItems.get(id);
      return item ? [item] : [];
    });
    // A note card commonly exposes the same canonical target through both its
    // card wrapper and title link. Duplicate anchors are presentation detail,
    // not evidence that the feed contract changed.
    // The feed can include promoted or non-note entries alongside valid note
    // cards. Only the canonical ids and targets consumed below are trusted.
    const listFailure = hasMalformedFeed || hasCrossFeedTokenConflict
      ? 'page_not_ready'
      : feedIds.length === 0
      ? !hasNonstandardFeed && pageTargets.size === 0 ? 'empty_result' : 'page_not_ready'
      : detailUrls.length === 0 || searchItems.length !== detailUrls.length ? 'page_not_ready' : undefined;
    const listValid = listFailure === undefined && detailUrls.length > 0;
    const text = document.body?.innerText || "";
    const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/login') || Boolean(document.querySelector?.('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    return {
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
      ready: document.readyState !== 'loading',
      pinia_ready: unwrap(store?.searchValue) === expectedQuery && Array.isArray(feeds),
      list_valid: listValid,
      list_failure: listFailure,
      note_count: listValid ? detailUrls.length : 0,
      detail_urls: detailUrls,
      search_items: searchItems,
      login_like: login,
      challenge_like: challenge
    };
  })()`;
}

function hasExactPublicQuery(search: unknown, key: string, expected: string): boolean {
  if (typeof search !== "string") return false;
  const values = new URLSearchParams(search).getAll(key);
  return values.length === 1 && values[0] === expected;
}

function hasExactBossSearch(search: unknown, query: string, cityCode: string): boolean {
  if (typeof search !== "string") return false;
  const params = new URLSearchParams(search);
  return [...params.keys()].join(",") === "query,city" &&
    params.getAll("query").length === 1 && params.get("query") === query &&
    params.getAll("city").length === 1 && params.get("city") === cityCode;
}

function isOperationReadNetworkUrl(input: LocalProviderReadProbeInput, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (input.operation_id === "xhs_read_note_detail" || input.operation_id === "boss_read_job_detail") return value === input.target_url;
  if (input.operation_id === "xhs_search_notes") {
    try {
      const observed = new URL(value);
      return observed.origin === "https://so.xiaohongshu.com" && observed.pathname === "/api/sns/web/v2/search/notes";
    } catch {
      return false;
    }
  }
  const expected = { pathname: "/wapi/zpgeek/search/joblist.json", query: "query" };
  const canonical = new URL(expected.pathname, input.expected_origin);
  canonical.searchParams.set(expected.query, input.query ?? "");
  canonical.searchParams.set("city", input.city_code ?? "");
  return value === canonical.href;
}

function bossJobDetailWapiUrl(targetUrl: string): string {
  const securityId = bossDetailTargetId(targetUrl);
  const url = new URL("/wapi/zpgeek/job/detail.json", "https://www.zhipin.com");
  url.searchParams.set("securityId", securityId);
  return url.href;
}

function isBossJobDetailWapiUrl(input: LocalProviderReadProbeInput, value: unknown): boolean {
  return input.operation_id === "boss_read_job_detail" && typeof value === "string" && value === bossJobDetailWapiUrl(input.target_url);
}

function bossDetailTargetId(targetUrl: string): string {
  return new URL(targetUrl).pathname.split("/").at(-1)?.replace(/\.html$/, "") ?? "";
}

interface BossJobSearchResponseSummary {
  status: "completed";
  business_code: 0;
  job_count: number;
  detail_urls?: string[];
}

interface XhsSearchResponseSummary {
  status: "completed";
  detail_urls: string[];
  search_items: XiaohongshuSearchPublicFields[];
}

type XhsSearchResponseFailure = {
  status: "unavailable";
  failure_class: "permission_denied" | "empty_result" | "field_missing" | "site_changed" | "network_resource_unavailable";
  message: string;
  retryable: boolean;
};

interface BossJobDetailResponseSummary {
  status: "completed";
  title: string;
  summary: string;
  description: string;
  job_status: string;
  salary?: string;
  location?: string;
  company_name: string;
  recruiter_name: string;
  recruiter_title: string;
}

type BossJobSearchResponseFailure = {
  status: "unavailable";
  failure_class: "permission_denied" | "empty_result" | "site_changed" | "network_resource_unavailable";
  message: string;
  retryable: boolean;
};

const MAX_BOSS_RESPONSE_BYTES = 512 * 1024;
const MAX_XHS_RESPONSE_BYTES = 512 * 1024;

async function readXhsSearchResponseSummary(
  client: CdpClient,
  requestId: string,
  domain: "Network" | "Fetch" = "Network"
): Promise<XhsSearchResponseSummary | XhsSearchResponseFailure> {
  try {
    const response = await client.send(`${domain}.getResponseBody`, { requestId });
    const encoded = typeof response.body === "string" ? response.body : "";
    const bytes = response.base64Encoded === true ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_XHS_RESPONSE_BYTES) return xhsResponseFailure("network_resource_unavailable", "Xiaohongshu search response is empty or exceeds the summary read limit.", true);
    return summarizeXhsSearchResponse(bytes.toString("utf8"));
  } catch {
    return xhsResponseFailure("network_resource_unavailable", "Xiaohongshu search response summary could not be read.", true);
  }
}

export function summarizeXhsSearchResponse(body: string): XhsSearchResponseSummary | XhsSearchResponseFailure {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return xhsResponseFailure("site_changed", "Xiaohongshu search response is not valid JSON.", false); }
  if (!isPlainRecord(parsed)) return xhsResponseFailure("site_changed", "Xiaohongshu search response has an unexpected shape.", false);
  if (parsed.success === false || typeof parsed.code === "number" && parsed.code !== 0) return xhsResponseFailure("permission_denied", "Xiaohongshu search response rejected the request.", false);
  if (parsed.success !== true || parsed.code !== 0) return xhsResponseFailure("site_changed", "Xiaohongshu search response has no explicit success state.", false);
  const data = isPlainRecord(parsed.data) ? parsed.data : null;
  if (!data || !Array.isArray(data.items)) return xhsResponseFailure("site_changed", "Xiaohongshu search response has no item list.", false);
  if (data.items.length === 0) return xhsResponseFailure("empty_result", "Xiaohongshu search returned no notes.", false);
  const detail_urls: string[] = [];
  const search_items: XiaohongshuSearchPublicFields[] = [];
  let missingPublicTitle = false;
  for (const item of data.items.slice(0, 60)) {
    if (!isPlainRecord(item)) continue;
    const card = isPlainRecord(item.note_card) ? item.note_card : isPlainRecord(item.noteCard) ? item.noteCard : {};
    const noteIds = [item.id, item.note_id, item.noteId, card.id, card.note_id, card.noteId]
      .filter((value): value is string => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value))
      .map((value) => value.toLowerCase());
    if (new Set(noteIds).size > 1) return xhsResponseFailure("site_changed", "Xiaohongshu search item identifiers do not match.", false);
    const tokens = [item.xsec_token, item.xsecToken, card.xsec_token, card.xsecToken]
      .filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+={0,2}$/.test(value));
    if (new Set(tokens).size > 1) return xhsResponseFailure("site_changed", "Xiaohongshu search item navigation tokens do not match.", false);
    const noteId = noteIds[0];
    const token = tokens[0];
    if (typeof noteId !== "string" || typeof token !== "string") continue;
    const title = firstSafeSearchText([card.display_title, card.displayTitle, card.title], 200);
    if (!title) {
      missingPublicTitle = true;
      continue;
    }
    const user = isPlainRecord(card.user) ? card.user : {};
    const author = firstSafeSearchText([user.nickname, user.display_name, user.displayName, user.name], 100);
    const interactions = isPlainRecord(card.interact_info) ? card.interact_info : isPlainRecord(card.interactInfo) ? card.interactInfo : {};
    const interaction_metrics = compactMetrics({
      likes: firstMetric([interactions.liked_count, interactions.likedCount, interactions.likes]),
      comments: firstMetric([interactions.comment_count, interactions.commentCount, interactions.comments]),
      collects: firstMetric([interactions.collected_count, interactions.collectedCount, interactions.collects])
    });
    const target = new URL(`/explore/${noteId.toLowerCase()}`, "https://www.xiaohongshu.com");
    target.searchParams.set("xsec_token", token);
    target.searchParams.set("xsec_source", "pc_search");
    detail_urls.push(target.href);
    search_items.push({
      title,
      ...(author ? { author_display_name: author } : {}),
      ...(interaction_metrics ? { interaction_metrics } : {})
    });
  }
  return detail_urls.length > 0
    ? { status: "completed", detail_urls, search_items }
    : missingPublicTitle
    ? xhsResponseFailure("field_missing", "Xiaohongshu search items have no bounded public title.", false)
    : xhsResponseFailure("site_changed", "Xiaohongshu search items have no valid detail navigation targets.", false);
}

function firstSafeSearchText(values: unknown[], max: number): string | undefined {
  return values.find((value): value is string => safeSearchPublicText(value, max));
}

function safeSearchPublicText(value: unknown, max: number): value is string {
  return boundedText(value, max) &&
    !/(?:^|[^a-z0-9_-])(?:[a-z0-9_-]*token|cookie|authorization|password|passwd|secret|credential|profile[_-]?storage|raw[_-]?(?:dom|har)|network[_-]?response[_-]?body)\s*[=:]\s*\S+/i.test(value) &&
    !/\bbearer\s+\S+/i.test(value);
}

function firstMetric(values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = typeof value === "number" && Number.isFinite(value) && value >= 0
      ? String(value)
      : typeof value === "string" ? value.trim() : "";
    if (normalized && normalized.length <= 40 && /^[0-9０-９.,+\-\s万千百wWkKmM]+$/u.test(normalized)) return normalized;
  }
  return undefined;
}

function compactMetrics(metrics: XiaohongshuSearchPublicFields["interaction_metrics"]): XiaohongshuSearchPublicFields["interaction_metrics"] {
  const entries = Object.entries(metrics ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function xhsResponseFailure(failure_class: XhsSearchResponseFailure["failure_class"], message: string, retryable: boolean): XhsSearchResponseFailure {
  return { status: "unavailable", failure_class, message, retryable };
}

async function readBossJobSearchResponseSummary(client: CdpClient, requestId: string): Promise<BossJobSearchResponseSummary | BossJobSearchResponseFailure> {
  try {
    const response = await client.send("Network.getResponseBody", { requestId });
    const encoded = typeof response.body === "string" ? response.body : "";
    const bytes = response.base64Encoded === true ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BOSS_RESPONSE_BYTES) return bossResponseFailure("network_resource_unavailable", "BOSS WAPI response is empty or exceeds the summary read limit.", true);
    return summarizeBossJobSearchResponse(bytes.toString("utf8"));
  } catch {
    return bossResponseFailure("network_resource_unavailable", "BOSS WAPI response summary could not be read.", true);
  }
}

async function readBossJobDetailResponseSummary(client: CdpClient, requestId: string, targetId: string): Promise<BossJobDetailResponseSummary | BossJobSearchResponseFailure> {
  try {
    const response = await client.send("Network.getResponseBody", { requestId });
    const encoded = typeof response.body === "string" ? response.body : "";
    const bytes = response.base64Encoded === true ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BOSS_RESPONSE_BYTES) return bossResponseFailure("network_resource_unavailable", "BOSS detail WAPI response is empty or exceeds the summary read limit.", true);
    return summarizeBossJobDetailResponse(bytes.toString("utf8"), targetId);
  } catch {
    return bossResponseFailure("network_resource_unavailable", "BOSS detail WAPI response summary could not be read.", true);
  }
}

export function summarizeBossJobDetailResponse(body: string, targetId: string): BossJobDetailResponseSummary | BossJobSearchResponseFailure {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return bossResponseFailure("site_changed", "BOSS detail WAPI response is not valid JSON.", true);
  }
  if (!isPlainRecord(value) || value.code !== 0) return bossResponseFailure("permission_denied", "BOSS detail WAPI rejected the read request.", false);
  const zpData = isPlainRecord(value.zpData) ? value.zpData : null;
  const job = zpData && isPlainRecord(zpData.jobInfo) ? zpData.jobInfo : null;
  const company = zpData && isPlainRecord(zpData.brandComInfo) ? zpData.brandComInfo : null;
  const recruiter = zpData && isPlainRecord(zpData.bossInfo) ? zpData.bossInfo : null;
  if (!zpData || !job || !company || !recruiter) return bossResponseFailure("site_changed", "BOSS detail WAPI public summary shape is unavailable.", true);
  const internalIds = [zpData.securityId, zpData.encryptJobId, job.securityId, job.encryptJobId].filter((entry): entry is string => typeof entry === "string");
  if (!/^[A-Za-z0-9_-]+$/.test(targetId) || !internalIds.includes(targetId)) return bossResponseFailure("site_changed", "BOSS detail WAPI target binding does not match the selected result.", false);
  const title = publicResponseText(job.jobName ?? job.title, 200);
  const description = publicResponseText(job.postDescription ?? job.description ?? job.jobDescription, 4000);
  const job_status = publicResponseText(job.jobStatus ?? job.status, 100);
  const company_name = publicResponseText(company.brandName ?? company.name, 200);
  const recruiter_name = publicResponseText(recruiter.name ?? recruiter.bossName, 100);
  const recruiter_title = publicResponseText(recruiter.title ?? recruiter.bossTitle, 100);
  if (!title || !description || !job_status || !company_name || !recruiter_name || !recruiter_title) return bossResponseFailure("site_changed", "BOSS detail WAPI required public fields are unavailable.", true);
  const salary = publicResponseText(job.salaryDesc ?? job.salary, 100);
  const location = publicResponseText(job.locationName ?? job.location, 100);
  return {
    status: "completed",
    title,
    summary: description.slice(0, 500),
    description,
    job_status,
    ...(salary ? { salary } : {}),
    ...(location ? { location } : {}),
    company_name,
    recruiter_name,
    recruiter_title
  };
}

function publicResponseText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);
  return normalized || null;
}

export function summarizeBossJobSearchResponse(body: string): BossJobSearchResponseSummary | BossJobSearchResponseFailure {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return bossResponseFailure("site_changed", "BOSS WAPI response is not valid JSON.", true);
  }
  if (!isPlainRecord(value) || value.code !== 0) return bossResponseFailure("permission_denied", "BOSS WAPI rejected the read request.", false);
  const zpData = isPlainRecord(value.zpData) ? value.zpData : null;
  if (!zpData || !Array.isArray(zpData.jobList)) return bossResponseFailure("site_changed", "BOSS WAPI job list shape is unavailable.", true);
  const jobCount = zpData.jobList.filter(isPlainRecord).length;
  if (jobCount === 0) return bossResponseFailure("empty_result", "BOSS WAPI returned no jobs for the bound query and city.", false);
  const detail_urls = zpData.jobList.filter(isPlainRecord).slice(0, 15).flatMap((job) => {
    const securityId = typeof job.securityId === "string" ? job.securityId : typeof job.encryptJobId === "string" ? job.encryptJobId : "";
    return /^[A-Za-z0-9_-]+$/.test(securityId) ? [`https://www.zhipin.com/job_detail/${securityId}.html`] : [];
  });
  return detail_urls.length > 0
    ? { status: "completed", business_code: 0, job_count: jobCount, detail_urls }
    : { status: "completed", business_code: 0, job_count: jobCount };
}

function bossResponseFailure(failure_class: BossJobSearchResponseFailure["failure_class"], message: string, retryable: boolean): BossJobSearchResponseFailure {
  return { status: "unavailable", failure_class, message, retryable };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOperationPageFacts(targetUrl: string): LocalProviderPageFacts {
  const evidence_ref = opaqueRef("validation");
  const publicUrl = publicReadOperationUrl(targetUrl);
  return {
    current_url: publicUrl,
    title: null,
    status: "ready",
    facts: [
      { key: "page.current_url", source: "observed", value: publicUrl, evidence_ref },
      { key: "page.title", source: "observed", value: "not_read", evidence_ref },
      { key: "page.status", source: "validation_evidence", value: "operation_probe_ready", evidence_ref }
    ]
  };
}

function publicReadOperationUrl(targetUrl: string): string {
  const url = new URL(targetUrl);
  if (url.origin === "https://www.xiaohongshu.com" && /^\/explore\/[a-f0-9]{24}$/i.test(url.pathname)) {
    url.search = "";
    url.hash = "";
  }
  return url.href;
}

async function readPageFacts(port: string, requested_url: string, signal?: AbortSignal): Promise<LocalProviderPageFacts> {
  try {
    const page = await activePage(port, requested_url, signal);
    return readTargetPageFacts(page, requested_url, signal);
  } catch (cause) {
    return unavailablePageFacts("cdp_unavailable", requested_url, cause);
  }
}

export async function readTargetPageFacts(page: CdpPageTarget | undefined, requested_url: string, signal?: AbortSignal): Promise<LocalProviderPageFacts> {
  if (!page) return unavailablePageFacts("url_unreachable", requested_url, new Error("Requested page target is unavailable."));
  let observed: { title: string; url: string } | null = null;
  if (page?.webSocketDebuggerUrl) {
    try {
      observed = await readPageTitle(page.webSocketDebuggerUrl, requested_url, signal);
    } catch {
      // Page-list facts remain useful for login/challenge handoff when a page target rejects deeper CDP commands.
    }
  }
  return readyPage(observed?.url ?? page?.url ?? requested_url, observed?.title ?? page?.title ?? null);
}

async function captureProviderScreenshot(port: string, requested_url: string): Promise<LocalProviderScreenshotFacts | RuntimeErrorFact> {
  try {
    const page = await activePage(port, requested_url);
    if (!page.webSocketDebuggerUrl) return error("cdp_unavailable", "Active page has no CDP websocket.", true);
    const data = await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Page.bringToFront");
      await client.send("Page.enable");
      const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      return String(result.data ?? "");
    });
    return screenshotFacts(Buffer.from(data, "base64"));
  } catch (cause) {
    return error("cdp_unavailable", cause instanceof Error ? cause.message : "Unable to capture screenshot.", true);
  }
}

async function activePage(port: string, requested_url: string, signal?: AbortSignal): Promise<CdpPageTarget> {
  const readinessSignal = signal ?? AbortSignal.timeout(1000);
  while (true) {
    readinessSignal.throwIfAborted();
    const page = selectPage(await pageTargets(port, readinessSignal), requested_url);
    if (page && (requested_url === "about:blank" || (page.url && page.url !== "about:blank"))) return page;
    await abortableDelay(25, readinessSignal);
  }
}

async function pageTargets(port: string, signal?: AbortSignal): Promise<CdpPageTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal });
  if (!response.ok) throw new Error(`CDP page-list probe failed: ${response.status}`);
  return (await response.json()) as CdpPageTarget[];
}

export function selectPage(pages: CdpPageTarget[], requested_url?: string) {
  if (requested_url) {
    const pageTargets = pages.filter((candidate) => candidate.type === "page");
    return pages.find((candidate) => candidate.type === "page" && candidate.url === requested_url) ??
      pages.find((candidate) => candidate.type === "page" && urlsReferToSamePage(candidate.url, requested_url)) ??
      (pageTargets.length === 1 ? pageTargets[0] : undefined);
  }
  return pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl) ??
    pages.find((candidate) => candidate.type === "page") ??
    pages[0];
}

function urlsReferToSamePage(candidate_url?: string, requested_url?: string): boolean {
  if (!candidate_url || !requested_url) return false;
  try {
    const candidate = new URL(candidate_url);
    const requested = new URL(requested_url);
    if (!["http:", "https:"].includes(candidate.protocol) || !["http:", "https:"].includes(requested.protocol)) return false;
    return candidate.origin === requested.origin &&
      candidate.pathname === requested.pathname &&
      candidate.hash === requested.hash &&
      (normalizedQuery(candidate) === normalizedQuery(requested) ||
        isBoundedXiaohongshuSearchRedirect(candidate, requested));
  } catch {
    return candidate_url === requested_url;
  }
}

function isBoundedXiaohongshuSearchRedirect(candidate: URL, requested: URL): boolean {
  if (
    candidate.origin !== "https://www.xiaohongshu.com" ||
    !["/search_result", "/search_result/"].includes(candidate.pathname) ||
    requested.searchParams.has("type") ||
    candidate.searchParams.getAll("type").join() !== "51"
  ) return false;
  const withoutType = new URL(candidate);
  withoutType.searchParams.delete("type");
  return normalizedQuery(withoutType) === normalizedQuery(requested);
}

function normalizedQuery(url: URL): string {
  return JSON.stringify([...url.searchParams.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
}

async function readPageTitle(webSocketUrl: string, requested_url: string, signal?: AbortSignal): Promise<{ title: string; url: string } | null> {
  return withCdp(webSocketUrl, async (client) => {
    await client.send("Runtime.enable");
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await client.send("Runtime.evaluate", {
        expression: "({ title: document.title, url: location.href, readyState: document.readyState })",
        returnByValue: true
      });
      const value = (result.result as { value?: { title?: string; url?: string; readyState?: string } } | undefined)?.value;
      const url = value?.url ?? "";
      const navigated = url === requested_url || (url !== "" && url !== "about:blank");
      if (navigated && (value?.title || value?.readyState === "complete")) return { title: value.title ?? "", url };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }, signal);
}

async function withCdp<T>(webSocketUrl: string, callback: (client: CdpClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const ws = new WebSocket(webSocketUrl);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      ws.close();
      finish(new Error("CDP probe aborted."));
    };
    const onOpen = () => finish();
    const onError = () => finish(new Error("CDP websocket connection failed."));
    const timer = setTimeout(() => {
      ws.close();
      finish(new Error("Timed out connecting to CDP websocket."));
    }, 5000);
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  const client = new CdpClient(ws, signal);
  try {
    return await callback(client);
  } finally {
    client.dispose();
    ws.close();
  }
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (result: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  constructor(private readonly ws: WebSocket, private readonly signal?: AbortSignal) {
    ws.addEventListener("message", this.handleMessage);
    signal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  on(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<Record<string, unknown>> {
    if (this.signal?.aborted) return Promise.reject(new Error(`CDP command aborted: ${method}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const text = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
    const payload = JSON.parse(text) as { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string } };
    if (payload.id !== undefined) {
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      clearTimeout(pending.timer);
      if (payload.error) pending.reject(new Error(payload.error.message ?? "CDP command failed."));
      else pending.resolve(payload.result ?? {});
      return;
    }
    if (!payload.method) return;
    for (const listener of this.listeners.get(payload.method) ?? []) listener(payload.params ?? {});
  };

  private readonly handleAbort = () => {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP probe aborted."));
    }
    this.ws.close();
  };

  dispose(): void {
    this.signal?.removeEventListener("abort", this.handleAbort);
    this.ws.removeEventListener("message", this.handleMessage);
    this.handleAbort();
  }
}

function fixtureScreenshot(seed: string): LocalProviderScreenshotFacts {
  return screenshotFacts(Buffer.from(`fixture screenshot for ${seed}`, "utf8"));
}

function screenshotFacts(bytes: Buffer): LocalProviderScreenshotFacts {
  const evidence_ref = opaqueRef("validation");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    screenshot_ref: opaqueRef("screenshot"),
    mime_type: "image/png",
    byte_length: bytes.byteLength,
    sha256,
    captured_at: new Date().toISOString(),
    facts: [
      { key: "screenshot.capture", source: "validation_evidence", value: "ready", evidence_ref },
      { key: "screenshot.mime_type", source: "observed", value: "image/png", evidence_ref },
      { key: "screenshot.byte_length", source: "observed", value: String(bytes.byteLength), evidence_ref },
      { key: "screenshot.sha256", source: "validation_evidence", value: sha256, evidence_ref }
    ]
  };
}

function unavailablePageFacts(code: RuntimeErrorCode, requested_url: string, cause: unknown): LocalProviderPageFacts {
  const current_error = error(code, cause instanceof Error ? cause.message : `Unable to open ${requested_url}.`, true);
  return {
    current_url: null,
    title: null,
    status: "unavailable",
    error: current_error,
    facts: [
      { key: "page.current_url", source: "observed", value: "unavailable" },
      { key: "page.title", source: "observed", value: "unavailable" },
      { key: "page.status", source: "observed", value: code }
    ]
  };
}

async function closeBrowser(child: ChildProcess, profileDir: string, removeProfileDir: boolean): Promise<void> {
  if (!hasExited(child)) child.kill("SIGTERM");
  await waitForExit(child, 1000);
  if (!hasExited(child)) child.kill("SIGKILL");
  await waitForExit(child, 500);
  if (removeProfileDir) await rm(profileDir, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(child)) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
