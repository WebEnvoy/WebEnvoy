import { managedUnavailable, trustManagedPublicPageOperation, managedPageObservationExpression, normalizeManagedProviderObservation, trustManagedPageObserver } from "./managed-observation.js";
import { trustManagedInteractionOperation, type ManagedInteractionResult, type ManagedInteractionSnapshot } from "./managed-interaction.js";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  resolveCamoufoxOverride
} from "./provider-management.js";
import {
  resolveIdentityEnvironmentLaunchConfiguration,
  type ResolvedIdentityEnvironmentLaunchConfiguration
} from "./identity-environment-configuration.js";
import { opaqueRef } from "./refs.js";
import { prepareProfileStorage, profileStorageHasExternalLock } from "./profile-storage.js";
import { trustLocalProviderReadProbe, trustLocalProviderSiteResourceProbe } from "./read-operation-probe-trust.js";
import { normalizeRuntimeDiagnostics, trustRuntimeDiagnosticsProbe } from "./runtime-diagnostics.js";
import type {
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  LocalProviderPageFacts,
  LocalProviderReadProbeInput,
  LocalProviderReadProbeResult,
  LocalProviderSiteResourceProbeInput,
  LocalProviderSiteResourceProbeResult,
  RuntimeErrorCode,
  RuntimeFact,
  RuntimePageStatus
} from "./runtime-session-types.js";
import type { RuntimeDiagnosticsInput } from "./runtime-diagnostics.js";

const CAMOUFOX_DRIVER_KIND = "firefox_juggler" as const;
const DRIVER_COMMAND_TIMEOUT_MS = 5_000;
const SITE_PROBE_TIMEOUT_MS = 3_000;
const MAX_DRIVER_LINE_BYTES = 256 * 1024;

type DriverPage = {
  current_url: string | null;
  title: string | null;
  status: RuntimePageStatus;
};

type DriverReady = {
  page: DriverPage;
  python_version?: string;
  camoufox_version?: string;
  browser_version?: string;
  properties_source?: "adjacent" | "resources_copy";
};

class CamoufoxDriverProtocolError extends Error {}

interface PendingResponse {
  resolve: (value: Record<string, unknown>) => void;
  reject: (cause: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

class CamoufoxDriverProcess {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, PendingResponse>();
  private nextId = 1;
  private stdoutBuffer = "";
  private terminated = false;
  private exited = false;
  private termination?: Promise<void>;

  constructor(pythonPath: string, helperPath: string) {
    this.child = spawn(pythonPath, [helperPath], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.resume();
    this.child.stdout?.on("data", (chunk: string) => this.readStdout(chunk));
    this.child.on("error", (cause) => this.failPending(cause));
    this.child.on("close", (code, signal) => {
      this.exited = true;
      this.terminated = true;
      this.killGroup();
      this.failPending(new CamoufoxDriverProtocolError(
        `Camoufox Driver exited before completing the command (${code ?? "signal"}${signal ? `:${signal}` : ""}).`
      ));
    });
  }

  get running(): boolean {
    return !this.terminated && Boolean(this.child.stdin && !this.child.stdin.destroyed);
  }

  async request(op: string, payload: Record<string, unknown>, timeoutMs = DRIVER_COMMAND_TIMEOUT_MS): Promise<Record<string, unknown>> {
    if (this.terminated || !this.child.stdin || this.child.stdin.destroyed) {
      throw new CamoufoxDriverProtocolError("Camoufox Driver process is not running.");
    }
    const id = this.nextId++;
    const line = `${JSON.stringify({ id, op, ...payload })}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_DRIVER_LINE_BYTES) {
      throw new CamoufoxDriverProtocolError("Camoufox Driver command is too large.");
    }
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(new CamoufoxDriverProtocolError(`Camoufox Driver command timed out: ${op}.`));
        void this.terminate();
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin!.write(line, (cause) => {
          if (!cause) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(id);
          reject(cause);
        });
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(cause);
      }
    }).then((response) => {
      if (response.status === "error") {
        const message = typeof response.message === "string" ? response.message : "Camoufox Driver rejected the command.";
        throw new CamoufoxDriverProtocolError(safePublicText(message));
      }
      return response;
    });
  }

  terminate(): Promise<void> {
    if (this.termination) return this.termination;
    if (this.exited) return Promise.resolve();
    this.terminated = true;
    this.termination = new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.killGroup(), 2_000);
      this.child.once("close", () => { clearTimeout(timer); resolve(); });
      if (this.child.stdin && !this.child.stdin.destroyed) this.child.stdin.end();
    });
    this.failPending(new CamoufoxDriverProtocolError("Camoufox Driver was closed."));
    return this.termination;
  }

  private killGroup(): void {
    try {
      if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, "SIGKILL");
      else this.child.kill("SIGKILL");
    } catch { /* The process group already exited. */ }
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > MAX_DRIVER_LINE_BYTES * 2) {
      void this.terminate();
      this.failPending(new CamoufoxDriverProtocolError("Camoufox Driver output is too large."));
      return;
    }
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, "utf8") > MAX_DRIVER_LINE_BYTES) {
        this.failPending(new CamoufoxDriverProtocolError("Camoufox Driver response is too large."));
        void this.terminate();
        return;
      }
      let response: unknown;
      try {
        response = JSON.parse(line);
      } catch {
        this.failPending(new CamoufoxDriverProtocolError("Camoufox Driver returned invalid JSON."));
        void this.terminate();
        return;
      }
      if (!response || typeof response !== "object" || Array.isArray(response)) continue;
      const message = response as Record<string, unknown>;
      const id = message.id;
      if (typeof id !== "number") continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve(message);
    }
  }

  private failPending(cause: unknown): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(cause);
    }
  }
}

export function resolveCamoufoxPython(env = process.env, home = homedir()): string {
  const installed = join(home, ".webenvoy", "providers", "camoufox", "venv", "bin", "python");
  return env.HARBOR_CAMOUFOX_PYTHON || env.CAMOUFOX_PYTHON || (existsSync(installed) ? installed : "python3");
}

export async function launchCamoufoxProvider(input: LocalProviderLaunchInput): Promise<LocalProviderLaunchResult> {
  const browserPath = input.browser_path || resolveCamoufoxOverride(process.env) || "";
  const helperPath = process.env.HARBOR_CAMOUFOX_DRIVER_PATH ||
    join(dirname(fileURLToPath(import.meta.url)), "camoufox-driver.py");
  const pythonPath = resolveCamoufoxPython();
  if (!browserPath) return unavailable("provider_unavailable", "Camoufox executable is not configured.");
  if (!existsSync(helperPath)) return unavailable("driver_unavailable", "Camoufox Driver helper is not installed.");

  const configuration = input.identity_environment
    ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy)
    : null;
  if (input.identity_environment && !configuration) {
    return unavailable("unsupported", "Identity environment configuration cannot be resolved by Camoufox.");
  }
  if (configuration && configuration.provider_id !== "camoufox") {
    return unavailable("provider_unavailable", "The identity environment is bound to a different provider.");
  }

  const profileStorage = await prepareProfileStorage(input.profile_storage_ref);
  if (input.profile_storage_ref && profileStorageHasExternalLock(input.profile_storage_ref)) {
    return unavailable("profile_locked", "Camoufox cannot use a profile locked by another browser or Harbor operation.", profileStorage.facts);
  }
  const driver = new CamoufoxDriverProcess(pythonPath, helperPath);
  const launchDeadline = Date.now() + Math.max(1, input.timeout_ms);
  let closed = false;
  try {
    const initialUrl = input.operation_scope === "profile_management" ? input.url : camoufoxConfigurationPageUrl(input);
    const readyResponse = await driver.request("launch", {
      operation_scope: input.operation_scope,
      executable_path: browserPath,
      profile_dir: profileStorage.profileDir,
      headless: input.headless,
      url: initialUrl,
      locale: configuration?.language ?? null,
      timezone: configuration?.timezone ?? null,
      viewport: configuration?.viewport ?? null,
      proxy_server: configuration?.proxy_server ?? null,
      timeout_ms: input.timeout_ms
    }, remainingTimeout(launchDeadline));
    const ready = parseDriverReady(readyResponse);
    let observedPage = ready.page;
    let currentUrl = observedPage.current_url ?? initialUrl;
    if (initialUrl !== input.url) {
      const opened = await driver.request("open_url", { url: input.url }, remainingTimeout(launchDeadline));
      observedPage = parseDriverPage(opened);
      currentUrl = observedPage.current_url ?? input.url;
    }
    const evidenceRef = opaqueRef("validation");
    const page = pageFacts(observedPage);
    const facts = [
      ...profileStorage.facts,
      { key: "provider.id", source: "configured", value: "camoufox" } satisfies RuntimeFact,
      { key: "provider.driver.kind", source: "configured", value: CAMOUFOX_DRIVER_KIND } satisfies RuntimeFact,
      { key: "provider.driver.transport", source: "configured", value: "firefox_juggler_pipe" } satisfies RuntimeFact,
      { key: "browser.launch", source: "observed", value: "ready", evidence_ref: evidenceRef } satisfies RuntimeFact,
      { key: "camoufox.python.version", source: "observed", value: ready.python_version ?? "unknown", evidence_ref: evidenceRef } satisfies RuntimeFact,
      { key: "camoufox.package.version", source: "observed", value: ready.camoufox_version ?? "unknown", evidence_ref: evidenceRef } satisfies RuntimeFact,
      { key: "camoufox.browser.version", source: "observed", value: ready.browser_version ?? "unknown", evidence_ref: evidenceRef } satisfies RuntimeFact,
      { key: "camoufox.properties.source", source: "observed", value: ready.properties_source ?? "adjacent", evidence_ref: evidenceRef } satisfies RuntimeFact,
      ...configurationFacts(configuration, evidenceRef),
      ...page.facts
    ];
    return {
      status: "ready",
      execution_surface: "local_provider",
      driver_ref: opaqueRef("driver"),
      driver_kind: CAMOUFOX_DRIVER_KIND,
      viewer_entry: camoufoxViewerEntry(input.headless),
      page,
      facts,
      clearPublicPageGuard: async () => { await driver.request("clear_public_navigation_guard", {}, DRIVER_COMMAND_TIMEOUT_MS); },
      interaction: trustManagedInteractionOperation(async input => {
        // After a private command is sent, a lost response cannot prove that an
        // input was not dispatched. Preserve unknown; never retry the command.
        try {
          const response = await driver.request("managed_interaction", input, Math.max(DRIVER_COMMAND_TIMEOUT_MS, 2 * (input.timeout_ms ?? 5000) + 5000));
          return normalizeManagedInteractionResponse(response.result, input.expected_origin);
        } catch {
          // Keep Runtime's in-flight guard until the failed command's process
          // has exited; rejecting a timeout alone does not stop native input.
          await driver.terminate();
          const inputAction = ["click", "input", "press", "scroll"].includes(input.action);
          return { status: inputAction ? "unknown_outcome" : "unavailable", dispatch_state: inputAction ? "dispatched" : "not_dispatched", failure_class: "managed_interaction_driver_unavailable" };
        }
      }),
      publicPage: trustManagedPublicPageOperation(async input => {
        const result = await driver.request("managed_public_page", input, DRIVER_COMMAND_TIMEOUT_MS);
        if (result.page) currentUrl = parseDriverPage(result).current_url ?? currentUrl;
        if (result.failure_class) return { ...managedUnavailable(["managed_public_origin_denied", "managed_public_navigation_redirected", "managed_public_content_unavailable", "managed_public_navigation_blocked", "managed_public_redirect_blocked", "managed_public_navigation_unavailable"].includes(String(result.failure_class)) ? String(result.failure_class) : "managed_public_page_unavailable"), ...(result.page ? { page: pageFacts(parseDriverPage(result)) } : {}) };
        const page = pageFacts(parseDriverPage(result));
        if (typeof result.text === "string") {
          if (result.text.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|(?:token|cookie|password|secret|authorization|credential)\s*[=:]/i.test(result.text)) return managedUnavailable("managed_public_content_unavailable");
          return { status: "completed", page, text: result.text, truncated: result.truncated === true };
        }
        return input.url ? { status: "completed", page } : managedUnavailable("managed_public_content_unavailable");
      }),
      observePage: trustManagedPageObserver(async () => {
        const result = await driver.request("managed_observe", { expression: managedPageObservationExpression }, DRIVER_COMMAND_TIMEOUT_MS);
        return normalizeManagedProviderObservation(result.observation);
      }),
      readDiagnostics: trustRuntimeDiagnosticsProbe(async (diagnostics: RuntimeDiagnosticsInput) => {
        const result = await driver.request("diagnostics_read", { ...diagnostics }, DRIVER_COMMAND_TIMEOUT_MS);
        return normalizeRuntimeDiagnostics(result.diagnostics, { runtime_session_ref: "unknown", profile_ref: input.profile_ref });
      }),
      openUrl: async (url, operation_scope) => {
        const response = await driver.request("open_url", { url, operation_scope, timeout_ms: input.timeout_ms }, DRIVER_COMMAND_TIMEOUT_MS);
        const next = pageFacts(parseDriverPage(response));
        currentUrl = next.current_url ?? url;
        return next;
      },
      probeSiteResource: trustLocalProviderSiteResourceProbe((probe) =>
        probeCamoufoxSiteResource(driver, currentUrl, probe)
      ),
      probeReadOperation: trustLocalProviderReadProbe((probe) =>
        probeCamoufoxReadOperation(driver, probe)
      ),
      captureScreenshot: async () => ({
        code: "unsupported",
        message: "Camoufox Driver screenshot capture is outside this vertical slice.",
        retryable: false
      }),
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          if (driver.running) await driver.request("close", {}, DRIVER_COMMAND_TIMEOUT_MS);
        } finally {
          await driver.terminate();
          if (!profileStorage.persistent) await rm(profileStorage.profileDir, { recursive: true, force: true });
        }
      }
    };
  } catch (cause) {
    try {
      // Give the bridge a chance to remove a Driver-owned launch layout after
      // an early properties or runtime rejection before terminating it.
      await driver.request("close", {}, DRIVER_COMMAND_TIMEOUT_MS);
    } catch {
      // A hung or already-dead provider is handled by the bounded terminate.
    }
    await driver.terminate();
    if (!profileStorage.persistent) await rm(profileStorage.profileDir, { recursive: true, force: true });
    const message = safeErrorMessage(cause);
    const failureCode: RuntimeErrorCode = /driver|juggler|playwright|properties\.json/i.test(message)
      ? "driver_unavailable"
      : "provider_unavailable";
    return unavailable(
      failureCode,
      `Camoufox Driver launch failed: ${message}`,
      [...profileStorage.facts]
    );
  }
}

async function probeCamoufoxReadOperation(
  driver: CamoufoxDriverProcess,
  input: LocalProviderReadProbeInput
): Promise<LocalProviderReadProbeResult> {
  if (input.site_id !== "xiaohongshu" || input.operation_id !== "xhs_search_notes") {
    return {
      status: "unavailable",
      failure_class: "provider_probe_unavailable",
      message: "This Camoufox qualification Driver exposes only the Xiaohongshu search read adapter.",
      retryable: false
    };
  }
  const response = await driver.request("read_operation_probe", {
    site_id: input.site_id,
    operation_id: input.operation_id,
    target_url: input.target_url,
    expected_origin: input.expected_origin,
    query: input.query,
    limit: input.limit ?? 15
  }, Math.max(DRIVER_COMMAND_TIMEOUT_MS, 15_000));
  const page = pageFacts(parseDriverPage(response));
  const observation = response.observation;
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    return readUnavailable("provider_probe_unavailable", "Camoufox Driver returned no bounded read observation.", false, page);
  }
  const value = observation as Record<string, unknown>;
  if (value.status === "unavailable") {
    const failureClass = value.failure_class;
    return readUnavailable(
      isReadFailureClass(failureClass) ? failureClass : "provider_probe_unavailable",
      stringField(value, "message") ?? "Camoufox Driver could not complete the bounded read observation.",
      value.retryable === true,
      page
    );
  }
  if (value.status !== "completed" || value.observed_origin !== input.expected_origin) {
    return readUnavailable("origin_drift", "Camoufox Driver read observation did not match the expected origin.", false, page);
  }
  const responseStatus = value.response_status;
  const detailUrls = stringArray(value.detail_urls, 15);
  const searchItems = searchItemArray(value.search_items, 15);
  if (typeof responseStatus !== "number" || responseStatus < 200 || responseStatus >= 300 ||
    detailUrls.length === 0 || detailUrls.length !== searchItems.length) {
    return readUnavailable("site_changed", "Camoufox Driver returned an invalid bounded Xiaohongshu search summary.", false, page);
  }
  const sourceRefs = ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
    .map((kind) => ({ kind, ref: opaqueRef("source") }));
  return {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_origin: input.expected_origin,
    page,
    source_refs: sourceRefs,
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("snapshot") }],
    public_summary_source_ref: sourceRefs[1]!.ref,
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v0",
      operation_id: "xhs_search_notes",
      result_kind: "xiaohongshu_search_notes_surface",
      surface: "search_result",
      result_state: "operation_read_response_observed",
      response_status: responseStatus,
      result_count: detailUrls.length,
      source_signals: ["pinia_store", "xhs_search_read_network"]
    },
    detail_targets: detailUrls.map((canonical_url) => ({ canonical_url })),
    search_items: searchItems
  };
}

function readUnavailable(
  failure_class: Extract<LocalProviderReadProbeResult, { status: "unavailable" }>["failure_class"],
  message: string,
  retryable: boolean,
  page?: LocalProviderPageFacts
): LocalProviderReadProbeResult {
  return { status: "unavailable", failure_class, message, retryable, page };
}

function isReadFailureClass(value: unknown): value is Extract<LocalProviderReadProbeResult, { status: "unavailable" }>["failure_class"] {
  return typeof value === "string" && [
    "origin_drift", "not_logged_in", "safety_challenge", "page_not_ready", "network_resource_unavailable",
    "evidence_refs_missing", "fixture_runtime", "provider_probe_unavailable", "permission_denied", "city_unresolved",
    "empty_result", "field_missing", "site_changed"
  ].includes(value);
}

function stringArray(value: unknown, max: number): string[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string") ? value : [];
}

function searchItemArray(value: unknown, max: number): Array<{ title: string; author_display_name?: string; interaction_metrics?: { likes?: string; comments?: string; collects?: string } }> {
  if (!Array.isArray(value) || value.length > max) return [];
  const items = value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  if (items.length !== value.length) return [];
  return items.map((entry) => {
    const metrics = entry.interaction_metrics;
    return {
      title: typeof entry.title === "string" ? entry.title : "",
      ...(typeof entry.author_display_name === "string" ? { author_display_name: entry.author_display_name } : {}),
      ...(metrics && typeof metrics === "object" && !Array.isArray(metrics) ? { interaction_metrics: {
        ...(typeof (metrics as Record<string, unknown>).likes === "string" ? { likes: (metrics as Record<string, string>).likes } : {}),
        ...(typeof (metrics as Record<string, unknown>).comments === "string" ? { comments: (metrics as Record<string, string>).comments } : {}),
        ...(typeof (metrics as Record<string, unknown>).collects === "string" ? { collects: (metrics as Record<string, string>).collects } : {})
      } } : {})
    };
  });
}

function parseDriverReady(response: Record<string, unknown>): DriverReady {
  if (!/^3\.12\.\d+$/.test(String(response.python_version)) || response.camoufox_version !== "0.5.6" ||
    response.playwright_version !== "1.60.0" || response.browser_version !== "152.0.4-beta.30" ||
    !["adjacent", "resources_copy"].includes(String(response.properties_source))) {
    throw new CamoufoxDriverProtocolError("Camoufox Driver returned unqualified runtime or browser versions.");
  }
  const page = parseDriverPage(response);
  return {
    page,
    python_version: stringField(response, "python_version"),
    camoufox_version: stringField(response, "camoufox_version"),
    browser_version: stringField(response, "browser_version"),
    properties_source: response.properties_source === "resources_copy" ? "resources_copy" : "adjacent"
  };
}

function parseDriverPage(response: Record<string, unknown>): DriverPage {
  const page = response.page;
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    throw new CamoufoxDriverProtocolError("Camoufox Driver returned no page facts.");
  }
  const value = page as Record<string, unknown>;
  const status: RuntimePageStatus = value.status === "ready" ? "ready" : value.status === "unavailable" ? "unavailable" : "unknown";
  return {
    current_url: typeof value.current_url === "string" ? safePublicText(value.current_url) : null,
    title: typeof value.title === "string" ? safePublicText(value.title) : null,
    status
  };
}

async function probeCamoufoxSiteResource(
  driver: CamoufoxDriverProcess,
  currentUrl: string,
  input: LocalProviderSiteResourceProbeInput
): Promise<LocalProviderSiteResourceProbeResult> {
  if (input.signal?.aborted) throw input.signal.reason;
  const response = await driver.request("site_resource_probe", {
    site_id: input.site_id,
    task_kind: input.task_kind,
    current_url: currentUrl
  }, SITE_PROBE_TIMEOUT_MS);
  if (input.signal?.aborted) throw input.signal.reason;
  const observation = response.observation;
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    return { status: "unknown", failure_class: "provider_probe_unavailable", message: "Camoufox Driver returned no public site observation.", verified_fact_keys: [] };
  }
  const value = observation as Record<string, unknown>;
  const origin = stringField(value, "origin");
  const pathname = stringField(value, "pathname");
  const loginLike = value.login_like === true;
  const challengeLike = value.challenge_like === true;
  if (challengeLike) return { status: "blocked", failure_class: "safety_challenge", message: "The site page shows a verification or safety challenge.", verified_fact_keys: [] };
  if (loginLike) return { status: "blocked", failure_class: "not_logged_in", message: "The site page requires manual login.", verified_fact_keys: [] };
  if (input.site_id === "xiaohongshu") {
    if (origin !== "https://www.xiaohongshu.com") return { status: "unavailable", failure_class: "page_not_ready", message: "The active page is not on the canonical Xiaohongshu origin.", verified_fact_keys: [] };
    if (input.task_kind === "authentication_recovery") {
      return { status: "unknown", failure_class: "page_not_ready", message: "The canonical Xiaohongshu page has no verified bound account identity.", verified_fact_keys: [] };
    }
    const verified = [
      ...(value.vue_ready === true ? ["page.vue_app.ready" as const] : []),
      ...(value.pinia_ready === true ? ["page.pinia_store.ready" as const] : [])
    ];
    if (value.ready !== true || value.vue_ready !== true || value.pinia_ready !== true) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu Vue app or Pinia store is not ready.", verified_fact_keys: verified };
    }
    return { status: "available", observed_at: new Date().toISOString(), evidence_ref: opaqueRef("validation"), verified_fact_keys: verified };
  }
  if (origin !== "https://www.zhipin.com" || pathname !== "/web/geek/job") {
    return { status: "unavailable", failure_class: "page_not_ready", message: "The active page is not the canonical BOSS job-search surface.", verified_fact_keys: [] };
  }
  if (value.ready !== true || value.vue_owned !== true || value.rendered_surface !== true || value.job_cards_valid !== true || typeof value.job_card_count !== "number" || value.job_card_count < 1) {
    return { status: "unavailable", failure_class: "page_not_ready", message: "The canonical BOSS page has no verified SPA job-search surface.", verified_fact_keys: [] };
  }
  return { status: "available", observed_at: new Date().toISOString(), evidence_ref: opaqueRef("validation"), verified_fact_keys: ["page.boss_spa.ready"] };
}

function pageFacts(page: DriverPage): LocalProviderPageFacts {
  return { current_url: page.current_url, title: page.title, status: page.status, facts: pageFactList(page, opaqueRef("validation")) };
}

function pageFactList(page: DriverPage, evidenceRef: string): RuntimeFact[] {
  return [
    { key: "page.current_url", source: "observed", value: page.current_url ?? "unavailable", evidence_ref: evidenceRef },
    { key: "page.title", source: "observed", value: page.title ?? "unavailable", evidence_ref: evidenceRef },
    { key: "page.status", source: "validation_evidence", value: page.status, evidence_ref: evidenceRef }
  ];
}

function configurationFacts(configuration: ResolvedIdentityEnvironmentLaunchConfiguration | null, evidenceRef: string): RuntimeFact[] {
  if (!configuration) return [];
  const facts: RuntimeFact[] = [
    { key: "identity_environment.provider_id", source: "validation_evidence", value: configuration.provider_id, evidence_ref: evidenceRef }
  ];
  if (configuration.proxy_server) facts.push({ key: "identity_environment.proxy", source: "configured", value: "provider_argument_applied", evidence_ref: evidenceRef });
  if (configuration.language) facts.push({ key: "identity_environment.language", source: "configured", value: configuration.language, evidence_ref: evidenceRef });
  if (configuration.timezone) facts.push({ key: "identity_environment.timezone", source: "configured", value: configuration.timezone, evidence_ref: evidenceRef });
  if (configuration.viewport) facts.push({ key: "identity_environment.viewport", source: "configured", value: `${configuration.viewport.width}x${configuration.viewport.height}`, evidence_ref: evidenceRef });
  return facts;
}

function camoufoxConfigurationPageUrl(input: LocalProviderLaunchInput): string {
  try {
    const url = new URL(input.url);
    if (input.identity_environment?.site_binding.site_id === "xiaohongshu" &&
      ((url.origin === "https://www.xiaohongshu.com" && ["/search_result", "/search_result/"].includes(url.pathname)) ||
        (url.origin === "https://creator.xiaohongshu.com" && ["/publish/publish", "/publish/publish/"].includes(url.pathname)))) {
      return "https://www.xiaohongshu.com/explore";
    }
  } catch {
    // Runtime Session owns URL validation.
  }
  return input.url;
}

function camoufoxViewerEntry(headless: boolean): Exclude<LocalProviderLaunchResult, { status: "unavailable" }>['viewer_entry'] {
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

function remainingTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Camoufox Driver launch timed out.");
  return remaining;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key] ? value[key] as string : undefined;
}

function safePublicText(value: string): string {
  return value.replace(/([?&][^=\s&]+)=([^\s&#]*)/g, "$1=<redacted>");
}

function safeErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "unknown error";
  return safePublicText(cause.message).replace(/\s+/g, " ").slice(0, 240);
}

function unavailable(code: RuntimeErrorCode, message: string, facts: RuntimeFact[] = []): LocalProviderLaunchResult {
  return {
    status: "unavailable",
    error: { code, message, retryable: code !== "unsupported" },
    facts: [...facts, { key: "browser.launch", source: "observed", value: code }]
  };
}

export function normalizeManagedInteractionResponse(value: unknown, expectedOrigin: string): ManagedInteractionResult {
  const invalid = (): ManagedInteractionResult => ({ status: "unknown_outcome", dispatch_state: "dispatched", failure_class: "managed_interaction_response_invalid" });
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (!["completed", "unavailable", "unknown_outcome"].includes(String(result.status)) || !["dispatched", "not_dispatched"].includes(String(result.dispatch_state))) return invalid();
  if (result.status !== "completed") {
    if (typeof result.failure_class !== "string" || !/^managed_[a-z_]{1,96}$/.test(result.failure_class)) return invalid();
    return { status: result.dispatch_state === "dispatched" ? "unknown_outcome" : "unavailable", dispatch_state: result.dispatch_state as "dispatched" | "not_dispatched", failure_class: result.failure_class };
  }
  const snapshot = result.snapshot as ManagedInteractionSnapshot | undefined;
  const ref = (value: unknown) => typeof value === "string" && /^(?:page|observation|target)_[a-f0-9]{32}$/.test(value);
  const safe = (value: unknown, max: number) => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]|password|passwd|token|cookie|secret|credential|authorization|验证码|密码|口令|密钥/i.test(value);
  if (!snapshot || !ref(snapshot.page_ref) || !ref(snapshot.observation_ref) || !Array.isArray(snapshot.controls) || snapshot.controls.length > 64 || !safe(snapshot.text, 4096) || typeof snapshot.truncated !== "boolean") return invalid();
  const refs = new Set<string>();
  for (const control of snapshot.controls) {
    if (!control || !ref(control.target_ref) || refs.has(control.target_ref) || !["textbox", "button", "link", "checkbox", "radio", "region"].includes(control.role) || !safe(control.name, 160) || !control.name || typeof control.enabled !== "boolean" || control.value !== undefined && !safe(control.value, 512)) return invalid();
    refs.add(control.target_ref);
  }
  const page = pageFacts(parseDriverPage(result));
  try {
    if (!page.current_url || new URL(page.current_url).origin !== expectedOrigin) return invalid();
  } catch { return invalid(); }
  return { status: "completed", dispatch_state: result.dispatch_state as "dispatched" | "not_dispatched", page,
    snapshot: { page_ref: snapshot.page_ref, observation_ref: snapshot.observation_ref, text: snapshot.text, truncated: snapshot.truncated,
      controls: snapshot.controls.map(({ target_ref, role, name, enabled, value }) => ({ target_ref, role, name, enabled, ...(value === undefined ? {} : { value }) })) } };
}
