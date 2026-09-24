import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProfileStorage, profileStorageHasExternalLock } from "./profile-storage.js";
import {
  trustEnvironmentProbe,
  type EnvironmentObservation
} from "./profile-environment.js";
import {
  resolveIdentityEnvironmentLaunchConfiguration,
  type ResolvedIdentityEnvironmentLaunchConfiguration
} from "./identity-environment-configuration.js";
import {
  normalizeRuntimeDiagnostics,
  trustRuntimeDiagnosticsProbe,
  type RuntimeDiagnosticsInput,
  type RuntimeDiagnosticsResponse
} from "./runtime-diagnostics.js";
import {
  trustManagedInteractionOperation,
  type ManagedInteractionInput,
  type ManagedInteractionResult
} from "./managed-interaction.js";
import {
  trustLocalProviderFileOperation,
  type LocalProviderFileOperationInput,
  type LocalProviderFileOperationResult
} from "./runtime-session-types.js";
import {
  normalizeManagedProviderObservation,
  trustManagedPageObserver,
  trustManagedPublicPageOperation,
  type ManagedProviderPageInput,
  type ManagedPublicPageInput,
  type ManagedPublicPageResult,
  type ManagedProviderObservation
} from "./managed-observation.js";
import type {
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  LocalProviderPageController,
  LocalProviderPageFacts,
  LocalProviderPageState,
  LocalProviderScreenshotFacts,
  RuntimeProviderOperationDiagnostic,
  RuntimeProviderOperationDiagnosticSink,
  RuntimeErrorFact,
  RuntimeFact,
  RuntimeViewerEntry
} from "./runtime-session-types.js";

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

type JsonObject = Record<string, unknown>;
type DriverResponse = { id: number; status?: "ok" | "error"; result?: unknown; message?: string; event?: string };
const PROVIDER_DIAGNOSTIC_PHASES = new Set([
  "candidate_capture", "candidate_query", "control_read", "accessibility_semantics",
  "page_text", "batch_verification", "control_cleanup", "response_projection"
]);

export type SharedProviderAdapter = {
  provider_id: string;
  driver_filename: string;
  pythonPath: (input: LocalProviderLaunchInput) => string | undefined;
  browserPath: (input: LocalProviderLaunchInput) => string;
  launchFields: (input: LocalProviderLaunchInput) => JsonObject;
  facts: (input: LocalProviderLaunchInput) => RuntimeFact[];
  normalizeEnvironmentObservation: (value: unknown) => EnvironmentObservation | null;
  driverPath?: (input: LocalProviderLaunchInput) => string | undefined;
  screenshotUnavailableMessage?: string;
};

const UNSUPPORTED_VIEWER_ENTRY: RuntimeViewerEntry = {
  availability: "unsupported",
  access_mode: "none",
  transport: "not_applicable",
  input_capabilities: [],
  unavailable_reason: "unsupported"
};

const VIEWER_AVAILABILITIES = new Set(["available", "unavailable", "permission_denied", "expired", "unsupported"]);
const VIEWER_ACCESS_MODES = new Set(["none", "read_only", "interactive", "input_disabled"]);
const VIEWER_TRANSPORTS = new Set(["not_applicable", "local_window", "remote_vnc", "remote_browser_viewer"]);
const VIEWER_INPUT_CAPABILITIES = new Set(["keyboard_mouse", "clipboard", "file_upload", "download_view"]);
const VIEWER_UNAVAILABLE_REASONS = new Set(["viewer_unavailable", "permission_denied", "policy_denied", "already_user_controlled", "session_unavailable", "unsupported"]);

/**
 * A pure request classification used by the driver and its tests. Unknown
 * Page ownership is rejected before the caller can continue/fetch a request.
 */
export function classifyProviderPageRequest(input: {
  page_ref: string | null;
  known_page_refs: readonly string[];
  request_origin: string;
  authorized_origins: readonly string[];
}): "allow" | "reject_unknown_page" | "reject_origin" {
  if (!input.page_ref || !input.known_page_refs.includes(input.page_ref)) return "reject_unknown_page";
  return input.authorized_origins.includes(input.request_origin) ? "allow" : "reject_origin";
}

/**
 * Copy the opener scope only when the opener Page is already known by ref.
 * An absent or stale relation intentionally produces an empty scope so the
 * first popup request remains fail-closed until no request can be replayed.
 */
export function inheritPopupAuthorizedOrigins(input: {
  opener_page_ref: string | null;
  pages: readonly { provider_page_ref: string; authorized_origins: readonly string[] }[];
}): string[] {
  if (!input.opener_page_ref) return [];
  const opener = input.pages.find(page => page.provider_page_ref === input.opener_page_ref);
  if (!opener) return [];
  return [...new Set(opener.authorized_origins.filter(origin => safeOrigin(origin) !== null))];
}

class SharedDriverError extends Error {
  constructor(readonly code: "source_untrusted" | "driver_unavailable" | "request_failed" | "request_timeout" | "profile_locked" | "protocol_error", message: string) {
    super(message);
  }
}

type DriverDiagnosticStage = Extract<RuntimeProviderOperationDiagnostic["stage"], "page_list_request" | "provider_snapshot">;
type PendingDriverRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  diagnostic_stage?: DriverDiagnosticStage;
  started_at: number;
};

function driverDiagnosticStage(op: string, payload: JsonObject): DriverDiagnosticStage | undefined {
  if (op === "page_list") return "page_list_request";
  if (op === "interact" && payload.action === "snapshot") return "provider_snapshot";
  return undefined;
}

function boundedDiagnosticCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

class JsonlDriverProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingDriverRequest>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private closed = false;

  constructor(pythonPath: string, driverPath: string, env: NodeJS.ProcessEnv, private readonly recordDiagnostic?: RuntimeProviderOperationDiagnosticSink) {
    // The node command branch is test-only injection; installed owner paths
    // always use Python's -B entrypoint.
    const commandArgs = pythonPath === process.execPath ? [driverPath] : ["-B", driverPath];
    this.child = spawn(pythonPath, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...env, PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" }
    });
    this.child.stdout.on("data", chunk => this.consume(Buffer.from(chunk)));
    this.child.stdout.on("error", error => this.failAll(error));
    this.child.stderr.on("data", () => { /* stderr is intentionally not exported. */ });
    this.child.on("error", error => this.failAll(error));
    this.child.on("exit", () => this.failAll(new SharedDriverError("driver_unavailable", "Shared Provider Driver exited.")));
  }

  request(op: string, payload: JsonObject, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const diagnosticStage = driverDiagnosticStage(op, payload);
    const startedAt = Date.now();
    if (this.closed || this.child.stdin.destroyed) {
      this.recordRequestDiagnostic(diagnosticStage, "error", "driver_unavailable", startedAt);
      return Promise.reject(new SharedDriverError("driver_unavailable", "Shared Provider Driver is not running."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.recordRequestDiagnostic(diagnosticStage, "timeout", "request_timeout", startedAt);
        reject(new SharedDriverError("request_timeout", `Shared Provider Driver request timed out: ${op}.`));
        void this.close();
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer, diagnostic_stage: diagnosticStage, started_at: startedAt });
      try {
        this.child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.recordRequestDiagnostic(diagnosticStage, "error", "request_failed", startedAt);
        reject(error instanceof Error ? error : new Error("Driver write failed."));
      }
    });
  }

  private recordRequestDiagnostic(
    stage: DriverDiagnosticStage | undefined,
    outcome: RuntimeProviderOperationDiagnostic["outcome"],
    code: string | undefined,
    startedAt: number
  ): void {
    if (!stage || !this.recordDiagnostic) return;
    const diagnostic: RuntimeProviderOperationDiagnostic = {
      stage,
      outcome,
      duration_ms: Math.max(0, Math.min(120_000, Date.now() - startedAt)),
      observed_at: new Date().toISOString(),
      ...(boundedDiagnosticCode(code) === undefined ? {} : { code: boundedDiagnosticCode(code) })
    };
    try { this.recordDiagnostic(diagnostic); } catch { /* Diagnostics never change Provider behavior. */ }
  }

  private recordPendingFailure(pending: PendingDriverRequest, error: Error): void {
    this.recordRequestDiagnostic(pending.diagnostic_stage, "error",
      error instanceof SharedDriverError ? error.code : "request_failed", pending.started_at);
  }

  private recordPendingResponse(pending: PendingDriverRequest, result: unknown): void {
    if (!pending.diagnostic_stage) return;
    const value = object(result);
    const status = value?.status;
    const pageListCompleted = pending.diagnostic_stage === "page_list_request" && Array.isArray(value?.pages);
    const outcome = pageListCompleted || status === "completed" ? "completed" : status === "unavailable" ? "unavailable" : "error";
    this.recordRequestDiagnostic(pending.diagnostic_stage, outcome,
      boundedDiagnosticCode(value?.failure_class), pending.started_at);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new SharedDriverError("driver_unavailable", "Shared Provider Driver closed."));
    }
    this.pending.clear();
    if (!this.child.killed) this.child.kill();
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.failAll(new SharedDriverError("protocol_error", "Shared Provider Driver response is too large."));
      void this.close();
      return;
    }
    while (true) {
      const end = this.buffer.indexOf(0x0a);
      if (end < 0) return;
      const line = this.buffer.subarray(0, end);
      this.buffer = this.buffer.subarray(end + 1);
      if (!line.length) continue;
      let response: DriverResponse;
      try { response = JSON.parse(line.toString("utf8")) as DriverResponse; } catch {
        this.failAll(new SharedDriverError("protocol_error", "Shared Provider Driver returned invalid JSON."));
        void this.close();
        return;
      }
      if (response.event === "provider_snapshot_phase") {
        this.consumeProviderSnapshotPhase(response);
        continue;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.status === "ok") {
        this.recordPendingResponse(pending, response.result);
        pending.resolve(response.result);
      } else {
        const error = new SharedDriverError("request_failed", typeof response.message === "string" ? response.message : "Shared Provider operation failed.");
        this.recordPendingFailure(pending, error);
        pending.reject(error);
      }
    }
  }

  private consumeProviderSnapshotPhase(value: DriverResponse): void {
    if (!this.recordDiagnostic || value.id !== 0 || value.status !== undefined) return;
    try {
      const raw = value as DriverResponse & Record<string, unknown>;
      if (raw.stage !== "provider_snapshot" || typeof raw.phase !== "string" || !PROVIDER_DIAGNOSTIC_PHASES.has(raw.phase) ||
        !["started", "completed", "error", "unavailable"].includes(String(raw.outcome)) ||
        typeof raw.duration_ms !== "number" || !Number.isSafeInteger(raw.duration_ms) || typeof raw.observed_at !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.observed_at)) return;
      this.recordDiagnostic({
        stage: "provider_snapshot", phase: raw.phase as RuntimeProviderOperationDiagnostic["phase"],
        outcome: raw.outcome as RuntimeProviderOperationDiagnostic["outcome"],
        duration_ms: Math.max(0, Math.min(120_000, raw.duration_ms)), observed_at: raw.observed_at,
        ...(boundedDiagnosticCode(raw.code) === undefined ? {} : { code: boundedDiagnosticCode(raw.code) })
      });
    } catch { /* Driver diagnostics never affect Provider behavior. */ }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      this.recordPendingFailure(pending, error);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

type ProviderPage = {
  provider_page_ref: string;
  current_url: string | null;
  title: string | null;
  status: LocalProviderPageFacts["status"];
  origin?: string | null;
  active?: boolean;
  task_selected?: boolean;
  document_generation?: number;
  opener_provider_page_ref?: string;
  facts?: RuntimeFact[];
};

/**
 * Keep the JSONL boundary on the public Harbor viewer contract.  In
 * particular, never cast upstream/private native-window values into the
 * public enum: an invalid launch result is a protocol failure.
 */
export function normalizeViewerEntry(value: unknown): RuntimeViewerEntry {
  const raw = object(value);
  if (!raw) return { ...UNSUPPORTED_VIEWER_ENTRY, input_capabilities: [] };
  const availability = raw.availability;
  const access_mode = raw.access_mode;
  const transport = raw.transport;
  const input_capabilities = raw.input_capabilities;
  if (typeof availability !== "string" || !VIEWER_AVAILABILITIES.has(availability) ||
    typeof access_mode !== "string" || !VIEWER_ACCESS_MODES.has(access_mode) ||
    typeof transport !== "string" || !VIEWER_TRANSPORTS.has(transport) ||
    !Array.isArray(input_capabilities) ||
    input_capabilities.some(item => typeof item !== "string" || !VIEWER_INPUT_CAPABILITIES.has(item)) ||
    new Set(input_capabilities).size !== input_capabilities.length) {
    throw new SharedDriverError("protocol_error", "Driver returned an invalid public viewer entry.");
  }
  const unavailable_reason = raw.unavailable_reason;
  if (unavailable_reason !== undefined && (typeof unavailable_reason !== "string" || !VIEWER_UNAVAILABLE_REASONS.has(unavailable_reason))) {
    throw new SharedDriverError("protocol_error", "Driver returned an invalid viewer unavailable reason.");
  }
  return {
    availability: availability as RuntimeViewerEntry["availability"],
    access_mode: access_mode as RuntimeViewerEntry["access_mode"],
    transport: transport as RuntimeViewerEntry["transport"],
    input_capabilities: [...input_capabilities] as RuntimeViewerEntry["input_capabilities"],
    ...(unavailable_reason === undefined ? {} : { unavailable_reason: unavailable_reason as RuntimeViewerEntry["unavailable_reason"] })
  };
}

function providerPage(value: unknown): LocalProviderPageState {
  const raw = value && typeof value === "object" ? value as JsonObject : {};
  if (typeof raw.provider_page_ref !== "string" || !raw.provider_page_ref || raw.provider_page_ref.length > 256) throw new SharedDriverError("protocol_error", "Driver returned an invalid Page ref.");
  const status = ["loading", "ready", "failed", "closed", "unavailable", "unknown"].includes(String(raw.status)) ? raw.status as LocalProviderPageFacts["status"] : "unknown";
  const current_url = typeof raw.current_url === "string" ? safeUrl(raw.current_url) : null;
  const title = typeof raw.title === "string" && raw.title.length <= 256 ? raw.title : null;
  const origin = typeof raw.origin === "string" ? safeOrigin(raw.origin) : current_url ? new URL(current_url).origin : null;
  const facts = Array.isArray(raw.facts) ? raw.facts.filter(isRuntimeFact).slice(0, 32) : [];
  return {
    provider_page_ref: raw.provider_page_ref,
    current_url,
    title,
    status,
    origin,
    ...(typeof raw.active === "boolean" ? { active: raw.active } : {}),
    ...(raw.task_selected === true ? { task_selected: true } : {}),
    ...(Number.isSafeInteger(raw.document_generation) && Number(raw.document_generation) >= 1 ? { document_generation: Number(raw.document_generation) } : {}),
    ...(typeof raw.opener_provider_page_ref === "string" ? { opener_provider_page_ref: raw.opener_provider_page_ref } : {}),
    facts
  };
}

export async function launchSharedPlaywrightProvider(
  input: LocalProviderLaunchInput,
  adapter: SharedProviderAdapter,
  resolvedIdentityEnvironmentConfiguration?: ResolvedIdentityEnvironmentLaunchConfiguration
): Promise<LocalProviderLaunchResult> {
  const profileStorage = await prepareProfileStorage(input.profile_storage_ref);
  const providerFacts = adapter.facts(input);
  if (input.profile_storage_ref && profileStorageHasExternalLock(input.profile_storage_ref)) {
    return unavailable("profile_locked", "Managed Profile 当前由其他 owner 使用。", [...providerFacts, ...profileStorage.facts]);
  }
  const pythonPath = adapter.pythonPath(input);
  const browserPath = adapter.browserPath(input);
  const driverPath = adapter.driverPath?.(input) || join(dirname(fileURLToPath(import.meta.url)), adapter.driver_filename);
  const providerConfiguration = resolvedIdentityEnvironmentConfiguration ?? (input.identity_environment
    ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy)
    : null);
  if (input.identity_environment && (!providerConfiguration || providerConfiguration.provider_id !== adapter.provider_id)) {
    return unavailable("unsupported", "Identity environment configuration cannot be resolved by the selected local provider.", [...providerFacts, ...profileStorage.facts]);
  }
  if (!pythonPath || !isSafeExecutablePath(driverPath) || !isSafeExecutablePath(browserPath)) {
    return unavailable("driver_unavailable", "固定官方 Playwright Driver 未由 installed owner 提供。", [...providerFacts, ...profileStorage.facts]);
  }
  const driver = new JsonlDriverProcess(pythonPath, driverPath, process.env, input.record_provider_diagnostic);
  try {
    const result = await driver.request("launch", {
      ...adapter.launchFields(input),
      browser_path: browserPath,
      profile_dir: profileStorage.profileDir,
      profile_storage_ref: input.profile_storage_ref ?? null,
      headless: input.headless,
      url: input.url,
      timeout_ms: input.timeout_ms,
      scope_semantics: input.scope_semantics ?? "legacy_request_guard_v1",
      environment: launchEnvironment(providerConfiguration)
    }, input.timeout_ms);
    const launched = object(result);
    if (!launched || launched.status !== "ready") {
      throw new SharedDriverError("driver_unavailable", "Shared Provider Driver did not return ready.");
    }
    const initialPage = providerPage(launched.page);
    const initialPages = Array.isArray(launched.pages) ? launched.pages.map(providerPage) : [initialPage];
    if (!initialPages.some(page => page.provider_page_ref === initialPage.provider_page_ref)) initialPages.unshift(initialPage);
    const selectedPage = initialPages.find(page => page.task_selected === true) ?? initialPage;
    const context: SharedDriverContext = {
      driver,
      input,
      providerFacts,
      profileStorage,
      pages: initialPages,
      current: selectedPage.provider_page_ref,
      provider_id: adapter.provider_id,
      normalizeEnvironmentObservation: adapter.normalizeEnvironmentObservation,
      unattributedRequestRejectionCount: 0,
      screenshotUnavailableMessage: adapter.screenshotUnavailableMessage ?? "Provider screenshot is unavailable."
    };
    const pageController = createPageController(context);
    let closeAttempt: Promise<void> | null = null;
    const close = (): Promise<void> => {
      if (closeAttempt) return closeAttempt;
      closeAttempt = (async () => {
        let failed = false;
        let failure: unknown;
        try {
          await driver.request("close", {}, input.timeout_ms);
        } catch (error) {
          failed = true;
          failure = error;
        }
        try {
          await driver.close();
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
        if (failed) throw failure;
        if (!profileStorage.persistent) await removeDirectory(profileStorage.profileDir);
      })();
      return closeAttempt;
    };
    const resultBase = {
      status: "ready" as const,
      execution_surface: "local_provider" as const,
      driver_ref: String(launched.driver_ref || `${adapter.provider_id}-playwright:${input.profile_ref}`),
      driver_kind: "playwright_jsonl" as const,
      viewer_entry: normalizeViewerEntry(launched.viewer_entry),
      page: toPageFacts(initialPage),
      pages: initialPages,
      pageController,
      facts: [...providerFacts, ...profileStorage.facts, ...arrayFacts(launched.facts), { key: "browser.launch", source: "observed" as const, value: "ready" }],
      close,
      captureScreenshot: async () => screenshot(context),
      openUrl: async (url: string, _operation_scope?: "profile_management", scope_semantics = input.scope_semantics ?? "legacy_request_guard_v1") => {
        const page = await callPage(context, "navigate", { provider_page_ref: context.current, action: "navigate", url, authorized_origins: [new URL(url).origin], scope_semantics });
        context.current = page.provider_page_ref;
        return toPageFacts(page);
      },
      observePage: trustManagedPageObserver(async (pageInput?: ManagedProviderPageInput) => observe(context, pageInput)),
      interaction: trustManagedInteractionOperation(async (interactionInput: ManagedInteractionInput) => interact(context, interactionInput)),
      publicPage: trustManagedPublicPageOperation(async (publicInput: ManagedPublicPageInput) => readPublicPage(context, publicInput)),
      executeFileOperation: trustLocalProviderFileOperation(async (fileInput: LocalProviderFileOperationInput) => fileOperation(context, fileInput)),
      readDiagnostics: trustRuntimeDiagnosticsProbe(async (diagnosticsInput: RuntimeDiagnosticsInput) => diagnostics(context, diagnosticsInput)),
      readEnvironment: trustEnvironmentProbe(async () => environment(context))
    };
    return resultBase;
  } catch (error) {
    await driver.close();
    if (!profileStorage.persistent) await removeDirectory(profileStorage.profileDir);
    const message = error instanceof Error ? error.message : "Shared Provider Driver launch failed.";
    return unavailable(error instanceof SharedDriverError && error.code === "profile_locked" ? "profile_locked" : "launch_failed", message, [...providerFacts, ...profileStorage.facts]);
  }
}
type SharedDriverContext = {
  driver: JsonlDriverProcess;
  input: LocalProviderLaunchInput;
  providerFacts: RuntimeFact[];
  provider_id: string;
  normalizeEnvironmentObservation: (value: unknown) => EnvironmentObservation | null;
  screenshotUnavailableMessage: string;
  profileStorage: Awaited<ReturnType<typeof prepareProfileStorage>>;
  pages: LocalProviderPageState[];
  current: string;
  unattributedRequestRejectionCount: number;
};

function createPageController(context: SharedDriverContext): LocalProviderPageController {
  return {
    listPages: async () => {
      const result = await context.driver.request("page_list", {});
      const wrapped = object(result);
      const pages = Array.isArray(result) ? result : wrapped?.pages;
      const rejectionCount = wrapped?.rejected_unattributed_count;
      context.unattributedRequestRejectionCount = Number.isSafeInteger(rejectionCount) && Number(rejectionCount) >= 0
        ? Math.min(Number(rejectionCount), 128)
        : 0;
      context.pages = Array.isArray(pages) ? pages.map(providerPage) : context.pages;
      const selected = context.pages.find(item => item.task_selected === true);
      if (selected) context.current = selected.provider_page_ref;
      return context.pages;
    },
    unattributedRequestRejectionCount: () => context.unattributedRequestRejectionCount,
    openPage: async (url, authorized_origins, scope_semantics) => {
      const page = providerPage(await context.driver.request("page_open", { url: url ?? null, authorized_origins: authorized_origins ?? [], scope_semantics: scope_semantics ?? context.input.scope_semantics ?? "legacy_request_guard_v1" }));
      context.pages = [...context.pages.filter(item => item.provider_page_ref !== page.provider_page_ref), page];
      context.current = page.provider_page_ref;
      return page;
    },
    activatePage: async provider_page_ref => {
      const page = providerPage(await context.driver.request("page_activate", { provider_page_ref }));
      context.pages = context.pages.map(item => item.provider_page_ref === page.provider_page_ref ? page : item);
      context.current = page.provider_page_ref;
      return page;
    },
    closePage: async (provider_page_ref, safe_return_provider_page_ref) => {
      const pages = await context.driver.request("page_close", { provider_page_ref, safe_return_provider_page_ref: safe_return_provider_page_ref ?? null });
      context.pages = Array.isArray(pages) ? pages.map(providerPage) : context.pages.filter(item => item.provider_page_ref !== provider_page_ref);
      const selected = context.pages.find(item => item.task_selected === true && item.status !== "closed");
      if (selected) context.current = selected.provider_page_ref;
      else if (safe_return_provider_page_ref && context.pages.some(item => item.provider_page_ref === safe_return_provider_page_ref && item.status !== "closed")) context.current = safe_return_provider_page_ref;
      return context.pages;
    },
    navigatePage: async (provider_page_ref, action, url, authorized_origins, scope_semantics) => {
      const page = providerPage(await context.driver.request("page_navigate", { provider_page_ref, action, url: url ?? null, authorized_origins: authorized_origins ?? [], scope_semantics: scope_semantics ?? context.input.scope_semantics ?? "legacy_request_guard_v1" }));
      context.pages = context.pages.map(item => item.provider_page_ref === page.provider_page_ref ? page : item);
      context.current = page.provider_page_ref;
      return page;
    }
  };
}

async function callPage(context: SharedDriverContext, op: string, payload: JsonObject): Promise<LocalProviderPageState> {
  const page = providerPage(await context.driver.request(op, payload, context.input.timeout_ms));
  context.pages = context.pages.map(item => item.provider_page_ref === page.provider_page_ref ? page : item);
  if (page.task_selected === true) context.current = page.provider_page_ref;
  return page;
}

async function observe(context: SharedDriverContext, input?: ManagedProviderPageInput): Promise<ManagedProviderObservation> {
  const page = await callPage(context, "observe", { provider_page_ref: input?.provider_page_ref ?? context.current });
  const raw = await context.driver.request("observe_identity", { provider_page_ref: page.provider_page_ref });
  const identity = normalizeManagedProviderObservation(raw);
  return { ...identity, page: { ...identity.page, ...toPageFacts(page) }, provider_page_ref: page.provider_page_ref };
}

async function interact(context: SharedDriverContext, input: ManagedInteractionInput): Promise<ManagedInteractionResult> {
  const pageRef = input.provider_page_ref ?? context.current;
  if (!context.pages.some(page => page.provider_page_ref === pageRef)) return { status: "unavailable", dispatch_state: "not_dispatched", failure_class: "page_relation_unavailable" };
  const result = await context.driver.request("interact", {
    provider_page_ref: pageRef,
    action: input.action,
    expected_origin: input.expected_origin,
    authorized_origins: input.authorized_origins ?? [],
    scope_semantics: input.scope_semantics ?? context.input.scope_semantics ?? "legacy_request_guard_v1",
    page_id: input.page_id ?? null,
    document_generation: input.document_generation ?? null,
    observation_ref: input.observation_ref ?? null,
    cursor: input.cursor ?? null,
    limit: input.limit ?? null,
    target_ref: input.target_ref ?? null,
    text: input.text ?? null,
    key: input.key ?? null,
    delta_y: input.delta_y ?? null,
    wait_for: input.wait_for ?? null,
    timeout_ms: input.timeout_ms ?? context.input.timeout_ms
  });
  const raw = object(result);
  return {
    status: raw?.status === "completed" ? "completed" : raw?.status === "unknown_outcome" ? "unknown_outcome" : "unavailable",
    dispatch_state: raw?.dispatch_state === "dispatched" ? "dispatched" : "not_dispatched",
    ...(typeof raw?.failure_class === "string" ? { failure_class: raw.failure_class } : {}),
    ...(raw?.page ? { page: toPageFacts(providerPage(raw.page)) } : {}),
    ...(raw?.snapshot && typeof raw.snapshot === "object" ? { snapshot: raw.snapshot as never } : {})
  };
}

async function fileOperation(context: SharedDriverContext, input: LocalProviderFileOperationInput): Promise<LocalProviderFileOperationResult> {
  const pageRef = input.provider_page_ref;
  if (!context.pages.some(page => page.provider_page_ref === pageRef)) return { status: "unavailable", dispatch_state: "not_dispatched", operation: input.operation, failure_class: "page_relation_unavailable" };
  const rawValue = object(await context.driver.request("file_operation", {
    provider_page_ref: pageRef,
    operation: input.operation,
    expected_origin: input.expected_origin,
    authorized_origins: input.authorized_origins,
    scope_semantics: input.scope_semantics ?? context.input.scope_semantics ?? "legacy_request_guard_v1",
    target_ref: input.target_ref,
    ...(input.source_path === undefined ? {} : { source_path: input.source_path }),
    ...(input.staging_path === undefined ? {} : { staging_path: input.staging_path }),
    timeout_ms: input.timeout_ms ?? context.input.timeout_ms
  }));
  if (!rawValue) return { status: "unknown_outcome", dispatch_state: "dispatched", operation: input.operation, failure_class: "file_result_invalid" };
  const raw = rawValue;
  const status = raw?.status === "completed" ? "completed" : raw?.status === "unknown_outcome" ? "unknown_outcome" : "unavailable";
  const dispatch = raw?.dispatch_state === "dispatched" ? "dispatched" : "not_dispatched";
  const page = raw?.page ? toPageFacts(providerPage(raw.page)) : undefined;
  if (status !== "completed") return { status, dispatch_state: dispatch, operation: input.operation, failure_class: typeof raw?.failure_class === "string" ? raw.failure_class : "file_operation_failed", ...(page ? { page } : {}) };
  if (!page || raw.operation !== input.operation || raw.browser_delivery !== "completed" || raw.business_commit !== "not_observed") return { status: "unknown_outcome", dispatch_state: "dispatched", operation: input.operation, failure_class: "file_result_invalid", ...(page ? { page } : {}) };
  const download = raw.download && typeof raw.download === "object" ? raw.download as JsonObject : undefined;
  if (input.operation === "download" && (!download || typeof download.page_url !== "string" || typeof download.url !== "string" || typeof download.suggested_filename !== "string" || !Number.isSafeInteger(download.byte_length) || typeof download.sha256 !== "string" || typeof download.staging_path !== "string")) return { status: "unknown_outcome", dispatch_state: "dispatched", operation: "download", failure_class: "file_result_invalid", page };
  return {
    status: "completed",
    dispatch_state: "dispatched",
    operation: input.operation,
    page,
    browser_delivery: "completed",
    page_receipt: raw.page_receipt === "observed" ? "observed" : "unknown",
    page_processing: raw.page_processing === "observed" ? "observed" : "unknown",
    business_commit: "not_observed",
    ...(download ? { download: {
      page_url: download.page_url as string,
      url: download.url as string,
      suggested_filename: download.suggested_filename as string,
      byte_length: download.byte_length as number,
      sha256: download.sha256 as string,
      staging_path: download.staging_path as string
    } } : {})
  };
}

async function readPublicPage(context: SharedDriverContext, input: ManagedPublicPageInput): Promise<ManagedPublicPageResult> {
  const pageRef = input.provider_page_ref ?? context.current;
  if (!context.pages.some(page => page.provider_page_ref === pageRef)) return { status: "unavailable", failure_class: "page_relation_unavailable", retryable: false };
  const raw = object(await context.driver.request("read_public_page", { provider_page_ref: pageRef, expected_origin: input.expected_origin, url: input.url ?? null, scope_semantics: input.scope_semantics ?? context.input.scope_semantics ?? "legacy_request_guard_v1" }));
  const page = raw?.page ? toPageFacts(providerPage(raw.page)) : undefined;
  if (raw?.status !== "completed") return { status: "unavailable", failure_class: typeof raw?.failure_class === "string" ? raw.failure_class : "provider_unavailable", retryable: raw?.retryable === true, ...(page ? { page } : {}) };
  return { status: "completed", page: page ?? toPageFacts(context.pages.find(item => item.provider_page_ref === pageRef)!), ...(typeof raw.text === "string" ? { text: raw.text.slice(0, 64 * 1024), truncated: raw.truncated === true } : {}) };
}

async function diagnostics(context: SharedDriverContext, input: RuntimeDiagnosticsInput): Promise<RuntimeDiagnosticsResponse> {
  const pageRef = input.provider_page_ref ?? context.current;
  const raw = await context.driver.request("diagnostics", { ...input, scope_semantics: input.scope_semantics ?? context.input.scope_semantics ?? "legacy_request_guard_v1", provider_page_ref: pageRef });
  return normalizeRuntimeDiagnostics(raw, { runtime_session_ref: `runtime:${context.input.profile_ref}`, profile_ref: context.input.profile_ref });
}

async function environment(context: SharedDriverContext): Promise<EnvironmentObservation | null> {
  return context.normalizeEnvironmentObservation(await context.driver.request("environment", { provider_page_ref: context.current }));
}

async function screenshot(context: SharedDriverContext): Promise<LocalProviderScreenshotFacts | RuntimeErrorFact> {
  const raw = object(await context.driver.request("screenshot", { provider_page_ref: context.current }));
  if (!raw || raw.status !== "completed" || typeof raw.screenshot_ref !== "string" || raw.mime_type !== "image/png" || !Number.isSafeInteger(raw.byte_length) || typeof raw.sha256 !== "string" || typeof raw.captured_at !== "string") {
    return { code: "capture_denied", message: context.screenshotUnavailableMessage, retryable: false };
  }
  return { screenshot_ref: raw.screenshot_ref, mime_type: "image/png", byte_length: raw.byte_length as number, sha256: raw.sha256, captured_at: raw.captured_at, facts: [] };
}

function launchEnvironment(configuration: ResolvedIdentityEnvironmentLaunchConfiguration | null): JsonObject {
  return {
    language: configuration?.language ?? null,
    timezone: configuration?.timezone ?? null,
    viewport: configuration?.viewport ?? null,
    proxy_server: configuration?.proxy_server ?? null
  };
}

function toPageFacts(page: LocalProviderPageState): LocalProviderPageFacts {
  return {
    current_url: page.current_url,
    title: page.title,
    status: page.status,
    origin: page.origin ?? null,
    ...(typeof page.active === "boolean" ? { active: page.active } : {}),
    ...(page.document_generation === undefined ? {} : { document_generation: page.document_generation }),
    facts: page.facts
  };
}

function arrayFacts(value: unknown): RuntimeFact[] { return Array.isArray(value) ? value.filter(isRuntimeFact).slice(0, 64) : []; }
function isRuntimeFact(value: unknown): value is RuntimeFact { return !!value && typeof value === "object" && typeof (value as JsonObject).key === "string" && typeof (value as JsonObject).source === "string" && typeof (value as JsonObject).value === "string"; }
function object(value: unknown): JsonObject | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null; }
function stringFact(value: JsonObject | null | undefined, key: string): string | undefined { return typeof value?.[key] === "string" ? value[key] as string : undefined; }
function safeOrigin(value: string): string | null { try { const url = new URL(value); return url.origin === value && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null; } catch { return null; } }
function safeUrl(value: string): string | null { try { const url = new URL(value); return safeOrigin(url.origin) ? `${url.origin}${url.pathname}${url.search}` : null; } catch { return null; } }
function isSafeExecutablePath(path: string): boolean { return path.length > 0 && path.length <= 4096 && !/[\0\r\n]/.test(path); }
export function unavailable(code: RuntimeErrorFact["code"], message: string, facts: RuntimeFact[] = []): LocalProviderLaunchResult { return { status: "unavailable", error: { code, message, retryable: false }, facts }; }
async function removeDirectory(path: string): Promise<void> { await rm(path, { recursive: true, force: true }).catch(() => undefined); }
