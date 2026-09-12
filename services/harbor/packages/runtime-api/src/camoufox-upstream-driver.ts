import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProfileStorage, profileStorageHasExternalLock } from "./profile-storage.js";
import {
  normalizeEnvironmentObservation,
  trustEnvironmentProbe,
  type EnvironmentObservation
} from "./profile-environment.js";
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
  RuntimeErrorFact,
  RuntimeFact,
  RuntimeViewerEntry
} from "./runtime-session-types.js";

/** The only Camoufox source that Harbor may launch for #519. */
export const CAMOUFOX_UPSTREAM_PINS = Object.freeze({
  source: "official_release",
  source_sha256: "3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3",
  camoufox_version: "0.5.6",
  browser_version: "152.0.4-beta.30",
  playwright_version: "1.60.0",
  properties_sha256: "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4",
  bundle_schema_version: 1,
  bundle_filename: ".webenvoy-camoufox-environment.v1.json"
} as const);

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const DRIVER_FILENAME = "camoufox-upstream-driver.py";
const DRIVER_SOURCE_ENV = "HARBOR_CAMOUFOX_DRIVER";

type JsonObject = Record<string, unknown>;
type DriverResponse = { id: number; status: "ok" | "error"; result?: unknown; message?: string };

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

export type CamoufoxUpstreamSourceFacts = {
  source: typeof CAMOUFOX_UPSTREAM_PINS.source;
  source_sha256: string;
  camoufox_version: typeof CAMOUFOX_UPSTREAM_PINS.camoufox_version;
  browser_version: typeof CAMOUFOX_UPSTREAM_PINS.browser_version;
  playwright_version: typeof CAMOUFOX_UPSTREAM_PINS.playwright_version;
};

/**
 * Validate the owner-provided install facts before profile preparation or a
 * child process is started. In particular, an executable path alone is not a
 * trusted source/version claim.
 */
export function readCamoufoxUpstreamSourceFacts(
  env: Record<string, string | undefined> = process.env,
  binding?: JsonObject | null
): CamoufoxUpstreamSourceFacts | null {
  const source = stringFact(binding, "source") ?? env.HARBOR_CAMOUFOX_SOURCE;
  const source_sha256 = stringFact(binding, "source_sha256") ?? stringFact(binding, "archive_sha256") ?? stringFact(binding, "source_hash") ?? env.HARBOR_CAMOUFOX_SOURCE_SHA256 ?? env.HARBOR_CAMOUFOX_ARCHIVE_SHA256;
  const camoufox_version = stringFact(binding, "camoufox_version") ?? env.HARBOR_CAMOUFOX_VERSION;
  const browser_version = stringFact(binding, "browser_version") ?? env.HARBOR_CAMOUFOX_BROWSER_VERSION;
  const playwright_version = stringFact(binding, "playwright_version") ?? env.HARBOR_CAMOUFOX_PLAYWRIGHT_VERSION;
  if (source !== CAMOUFOX_UPSTREAM_PINS.source ||
    source_sha256 !== CAMOUFOX_UPSTREAM_PINS.source_sha256 ||
    camoufox_version !== CAMOUFOX_UPSTREAM_PINS.camoufox_version ||
    browser_version !== CAMOUFOX_UPSTREAM_PINS.browser_version ||
    playwright_version !== CAMOUFOX_UPSTREAM_PINS.playwright_version) return null;
  return { source, source_sha256, camoufox_version, browser_version, playwright_version };
}

export function hasRetiredCamoufoxBinding(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as JsonObject;
  return Object.keys(object).some(key => /native504|native510|patched|obscura|camoufoxArtifact|camoufox_artifact/i.test(key)) ||
    Object.values(object).some(item => typeof item === "string" && /native504|native510|patched|obscura|camoufox-driver|camoufox-native-playwright/i.test(item));
}

export function isOfficialCamoufoxLaunchRequest(
  input: Pick<LocalProviderLaunchInput, "provider_id" | "browser_path" | "identity_environment">,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (input.provider_id !== "camoufox" && input.identity_environment?.provider_binding.selected_provider_id !== "camoufox" && !isCamoufoxPath(input.browser_path || env.HARBOR_BROWSER_PATH)) return false;
  if (hasRetiredCamoufoxBinding(input.identity_environment?.provider_binding)) return false;
  return readCamoufoxUpstreamSourceFacts(env, input.identity_environment?.provider_binding?.selected_provider?.install as JsonObject | undefined) !== null;
}

/**
 * A pure request classification used by the driver and its tests. Unknown
 * Page ownership is rejected before the caller can continue/fetch a request.
 */
export function classifyUpstreamPageRequest(input: {
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
export function inheritUpstreamPopupAuthorizedOrigins(input: {
  opener_page_ref: string | null;
  pages: readonly { provider_page_ref: string; authorized_origins: readonly string[] }[];
}): string[] {
  if (!input.opener_page_ref) return [];
  const opener = input.pages.find(page => page.provider_page_ref === input.opener_page_ref);
  if (!opener) return [];
  return [...new Set(opener.authorized_origins.filter(origin => safeOrigin(origin) !== null))];
}

class CamoufoxDriverError extends Error {
  constructor(readonly code: "source_untrusted" | "driver_unavailable" | "request_failed" | "profile_locked" | "protocol_error", message: string) {
    super(message);
  }
}

class JsonlDriverProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private closed = false;

  constructor(pythonPath: string, driverPath: string, env: NodeJS.ProcessEnv) {
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
    this.child.on("exit", () => this.failAll(new CamoufoxDriverError("driver_unavailable", "Camoufox upstream Driver exited.")));
  }

  request(op: string, payload: JsonObject, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closed || this.child.stdin.destroyed) return Promise.reject(new CamoufoxDriverError("driver_unavailable", "Camoufox upstream Driver is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CamoufoxDriverError("request_failed", `Camoufox upstream Driver request timed out: ${op}.`));
        void this.close();
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Driver write failed."));
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CamoufoxDriverError("driver_unavailable", "Camoufox upstream Driver closed."));
    }
    this.pending.clear();
    if (!this.child.killed) this.child.kill();
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.failAll(new CamoufoxDriverError("protocol_error", "Camoufox upstream Driver response is too large."));
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
        this.failAll(new CamoufoxDriverError("protocol_error", "Camoufox upstream Driver returned invalid JSON."));
        void this.close();
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.status === "ok") pending.resolve(response.result);
      else pending.reject(new CamoufoxDriverError("request_failed", typeof response.message === "string" ? response.message : "Camoufox upstream operation failed."));
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

type UpstreamPage = {
  provider_page_ref: string;
  current_url: string | null;
  title: string | null;
  status: LocalProviderPageFacts["status"];
  origin?: string | null;
  active?: boolean;
  document_generation?: number;
  opener_provider_page_ref?: string;
  facts?: RuntimeFact[];
};

/**
 * Keep the JSONL boundary on the public Harbor viewer contract.  In
 * particular, never cast upstream/private native-window values into the
 * public enum: an invalid launch result is a protocol failure.
 */
export function normalizeUpstreamViewerEntry(value: unknown): RuntimeViewerEntry {
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
    throw new CamoufoxDriverError("protocol_error", "Driver returned an invalid public viewer entry.");
  }
  const unavailable_reason = raw.unavailable_reason;
  if (unavailable_reason !== undefined && (typeof unavailable_reason !== "string" || !VIEWER_UNAVAILABLE_REASONS.has(unavailable_reason))) {
    throw new CamoufoxDriverError("protocol_error", "Driver returned an invalid viewer unavailable reason.");
  }
  return {
    availability: availability as RuntimeViewerEntry["availability"],
    access_mode: access_mode as RuntimeViewerEntry["access_mode"],
    transport: transport as RuntimeViewerEntry["transport"],
    input_capabilities: [...input_capabilities] as RuntimeViewerEntry["input_capabilities"],
    ...(unavailable_reason === undefined ? {} : { unavailable_reason: unavailable_reason as RuntimeViewerEntry["unavailable_reason"] })
  };
}

function upstreamPage(value: unknown): LocalProviderPageState {
  const raw = value && typeof value === "object" ? value as JsonObject : {};
  if (typeof raw.provider_page_ref !== "string" || !raw.provider_page_ref || raw.provider_page_ref.length > 256) throw new CamoufoxDriverError("protocol_error", "Driver returned an invalid Page ref.");
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
    active: raw.active === true,
    ...(Number.isSafeInteger(raw.document_generation) && Number(raw.document_generation) >= 1 ? { document_generation: Number(raw.document_generation) } : {}),
    ...(typeof raw.opener_provider_page_ref === "string" ? { opener_provider_page_ref: raw.opener_provider_page_ref } : {}),
    facts
  };
}

export async function launchCamoufoxUpstreamProvider(input: LocalProviderLaunchInput): Promise<LocalProviderLaunchResult> {
  const binding = input.identity_environment?.provider_binding?.selected_provider?.install as JsonObject | undefined;
  const source = readCamoufoxUpstreamSourceFacts(process.env, binding);
  if (!source || !isOfficialCamoufoxLaunchRequest(input)) return unavailable("unsupported", "Camoufox 仅允许由 owner 提供并验证固定官方 source、version、hash；未知或历史 binding 已拒绝。");
  if (input.operation_scope === "profile_management") return unavailable("provider_unavailable", "Provider 不支持 guarded management navigation。", sourceFacts(source));
  const profileStorage = await prepareProfileStorage(input.profile_storage_ref);
  if (input.profile_storage_ref && profileStorageHasExternalLock(input.profile_storage_ref)) return unavailable("profile_locked", "Managed Profile 当前由其他 owner 使用。", [...sourceFacts(source), ...profileStorage.facts]);
  const pythonPath = process.env.HARBOR_CAMOUFOX_PYTHON;
  const driverPath = process.env[DRIVER_SOURCE_ENV] || join(dirname(fileURLToPath(import.meta.url)), DRIVER_FILENAME);
  const browserPath = input.browser_path || stringFact(binding, "path") || process.env.HARBOR_BROWSER_PATH || "";
  if (!pythonPath || !isSafeExecutablePath(driverPath)) return unavailable("driver_unavailable", "固定官方 Camoufox Python/Playwright Driver 未由 installed owner 提供。", [...sourceFacts(source), ...profileStorage.facts]);
  const driver = new JsonlDriverProcess(pythonPath, driverPath, process.env);
  try {
    const result = await driver.request("launch", {
      browser_path: browserPath,
      profile_dir: profileStorage.profileDir,
      profile_storage_ref: input.profile_storage_ref ?? null,
      headless: input.headless,
      url: input.url,
      timeout_ms: input.timeout_ms,
      source,
      install_root: stringFact(binding, "install_root") ?? null,
      environment: launchEnvironment(input)
    }, input.timeout_ms);
    const launched = object(result);
    if (!launched || launched.status !== "ready") throw new CamoufoxDriverError("driver_unavailable", "Camoufox upstream Driver did not return ready.");
    const initialPage = upstreamPage(launched.page);
    const initialPages = Array.isArray(launched.pages) ? launched.pages.map(upstreamPage) : [initialPage];
    if (!initialPages.some(page => page.provider_page_ref === initialPage.provider_page_ref)) initialPages.unshift(initialPage);
    const context = { driver, input, source, profileStorage, pages: initialPages, current: initialPage.provider_page_ref };
    const pageController = createPageController(context);
    const resultBase = {
      status: "ready" as const,
      execution_surface: "local_provider" as const,
      driver_ref: String(launched.driver_ref || `camoufox-upstream:${input.profile_ref}`),
      driver_kind: "playwright_jsonl" as const,
      viewer_entry: normalizeUpstreamViewerEntry(launched.viewer_entry),
      page: toPageFacts(initialPage),
      pages: initialPages,
      pageController,
      facts: [...sourceFacts(source), ...profileStorage.facts, ...arrayFacts(launched.facts), { key: "browser.launch", source: "observed" as const, value: "ready" }],
      close: async () => { await driver.request("close", {}, input.timeout_ms).catch(() => undefined); await driver.close(); if (!profileStorage.persistent) await removeDirectory(profileStorage.profileDir); },
      captureScreenshot: async () => screenshot(context),
      openUrl: async (url: string) => {
        const page = await callPage(context, "navigate", { provider_page_ref: context.current, action: "navigate", url, authorized_origins: [new URL(url).origin] });
        context.current = page.provider_page_ref;
        return toPageFacts(page);
      },
      observePage: trustManagedPageObserver(async (pageInput?: ManagedProviderPageInput) => observe(context, pageInput)),
      interaction: trustManagedInteractionOperation(async (interactionInput: ManagedInteractionInput) => interact(context, interactionInput)),
      publicPage: trustManagedPublicPageOperation(async (publicInput: ManagedPublicPageInput) => readPublicPage(context, publicInput)),
      readDiagnostics: trustRuntimeDiagnosticsProbe(async (diagnosticsInput: RuntimeDiagnosticsInput) => diagnostics(context, diagnosticsInput)),
      readEnvironment: trustEnvironmentProbe(async () => environment(context))
    };
    return resultBase;
  } catch (error) {
    await driver.close();
    if (!profileStorage.persistent) await removeDirectory(profileStorage.profileDir);
    const message = error instanceof Error ? error.message : "Camoufox upstream Driver launch failed.";
    return unavailable(error instanceof CamoufoxDriverError && error.code === "profile_locked" ? "profile_locked" : "launch_failed", message, [...sourceFacts(source), ...profileStorage.facts]);
  }
}

type DriverContext = {
  driver: JsonlDriverProcess;
  input: LocalProviderLaunchInput;
  source: CamoufoxUpstreamSourceFacts;
  profileStorage: Awaited<ReturnType<typeof prepareProfileStorage>>;
  pages: LocalProviderPageState[];
  current: string;
};

function createPageController(context: DriverContext): LocalProviderPageController {
  return {
    listPages: async () => {
      const pages = await context.driver.request("page_list", {});
      context.pages = Array.isArray(pages) ? pages.map(upstreamPage) : context.pages;
      return context.pages;
    },
    openPage: async (url, authorized_origins) => {
      const page = upstreamPage(await context.driver.request("page_open", { url: url ?? null, authorized_origins: authorized_origins ?? [] }));
      context.pages = [...context.pages.filter(item => item.provider_page_ref !== page.provider_page_ref), page];
      context.current = page.provider_page_ref;
      return page;
    },
    activatePage: async provider_page_ref => {
      const page = upstreamPage(await context.driver.request("page_activate", { provider_page_ref }));
      context.pages = context.pages.map(item => ({ ...item, active: item.provider_page_ref === provider_page_ref }));
      context.current = page.provider_page_ref;
      return page;
    },
    closePage: async (provider_page_ref, safe_return_provider_page_ref) => {
      const pages = await context.driver.request("page_close", { provider_page_ref, safe_return_provider_page_ref: safe_return_provider_page_ref ?? null });
      context.pages = Array.isArray(pages) ? pages.map(upstreamPage) : context.pages.filter(item => item.provider_page_ref !== provider_page_ref);
      const active = context.pages.find(item => item.active) ?? context.pages[0];
      if (active) context.current = active.provider_page_ref;
      return context.pages;
    },
    navigatePage: async (provider_page_ref, action, url, authorized_origins) => {
      const page = upstreamPage(await context.driver.request("page_navigate", { provider_page_ref, action, url: url ?? null, authorized_origins: authorized_origins ?? [] }));
      context.pages = context.pages.map(item => item.provider_page_ref === page.provider_page_ref ? page : item);
      context.current = page.provider_page_ref;
      return page;
    }
  };
}

async function callPage(context: DriverContext, op: string, payload: JsonObject): Promise<LocalProviderPageState> {
  const page = upstreamPage(await context.driver.request(op, payload, context.input.timeout_ms));
  context.pages = context.pages.map(item => item.provider_page_ref === page.provider_page_ref ? page : item);
  return page;
}

async function observe(context: DriverContext, input?: ManagedProviderPageInput): Promise<ManagedProviderObservation> {
  const page = await callPage(context, "observe", { provider_page_ref: input?.provider_page_ref ?? context.current });
  const raw = await context.driver.request("observe_identity", { provider_page_ref: page.provider_page_ref });
  const identity = normalizeManagedProviderObservation(raw);
  return { ...identity, page: { ...identity.page, ...toPageFacts(page) }, provider_page_ref: page.provider_page_ref };
}

async function interact(context: DriverContext, input: ManagedInteractionInput): Promise<ManagedInteractionResult> {
  const pageRef = input.provider_page_ref ?? context.current;
  if (!context.pages.some(page => page.provider_page_ref === pageRef)) return { status: "unavailable", dispatch_state: "not_dispatched", failure_class: "page_relation_unavailable" };
  const result = await context.driver.request("interact", {
    provider_page_ref: pageRef,
    action: input.action,
    expected_origin: input.expected_origin,
    authorized_origins: input.authorized_origins ?? [],
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
    ...(raw?.page ? { page: toPageFacts(upstreamPage(raw.page)) } : {}),
    ...(raw?.snapshot && typeof raw.snapshot === "object" ? { snapshot: raw.snapshot as never } : {})
  };
}

async function readPublicPage(context: DriverContext, input: ManagedPublicPageInput): Promise<ManagedPublicPageResult> {
  const pageRef = input.provider_page_ref ?? context.current;
  if (!context.pages.some(page => page.provider_page_ref === pageRef)) return { status: "unavailable", failure_class: "page_relation_unavailable", retryable: false };
  const raw = object(await context.driver.request("read_public_page", { provider_page_ref: pageRef, expected_origin: input.expected_origin, url: input.url ?? null }));
  const page = raw?.page ? toPageFacts(upstreamPage(raw.page)) : undefined;
  if (raw?.status !== "completed") return { status: "unavailable", failure_class: typeof raw?.failure_class === "string" ? raw.failure_class : "provider_unavailable", retryable: raw?.retryable === true, ...(page ? { page } : {}) };
  return { status: "completed", page: page ?? toPageFacts(context.pages.find(item => item.provider_page_ref === pageRef)!), ...(typeof raw.text === "string" ? { text: raw.text.slice(0, 64 * 1024), truncated: raw.truncated === true } : {}) };
}

async function diagnostics(context: DriverContext, input: RuntimeDiagnosticsInput): Promise<RuntimeDiagnosticsResponse> {
  const pageRef = input.provider_page_ref ?? context.current;
  const raw = await context.driver.request("diagnostics", { ...input, provider_page_ref: pageRef });
  return normalizeRuntimeDiagnostics(raw, { runtime_session_ref: `runtime:${context.input.profile_ref}`, profile_ref: context.input.profile_ref });
}

async function environment(context: DriverContext): Promise<EnvironmentObservation | null> {
  return normalizeEnvironmentObservation(await context.driver.request("environment", { provider_page_ref: context.current }));
}

async function screenshot(context: DriverContext): Promise<LocalProviderScreenshotFacts | RuntimeErrorFact> {
  const raw = object(await context.driver.request("screenshot", { provider_page_ref: context.current }));
  if (!raw || raw.status !== "completed" || typeof raw.screenshot_ref !== "string" || raw.mime_type !== "image/png" || !Number.isSafeInteger(raw.byte_length) || typeof raw.sha256 !== "string" || typeof raw.captured_at !== "string") {
    return { code: "capture_denied", message: "Camoufox upstream screenshot is unavailable.", retryable: false };
  }
  return { screenshot_ref: raw.screenshot_ref, mime_type: "image/png", byte_length: raw.byte_length as number, sha256: raw.sha256, captured_at: raw.captured_at, facts: [] };
}

function launchEnvironment(input: LocalProviderLaunchInput): JsonObject {
  const environment = input.identity_environment?.environment;
  return {
    language: environment?.language ?? null,
    timezone: environment?.timezone ?? null,
    viewport: environment?.viewport ?? null,
    proxy_ref: environment?.proxy.proxy_ref ?? null
  };
}

function toPageFacts(page: LocalProviderPageState): LocalProviderPageFacts {
  return { current_url: page.current_url, title: page.title, status: page.status, origin: page.origin ?? null, active: page.active === true, ...(page.document_generation === undefined ? {} : { document_generation: page.document_generation }), facts: page.facts };
}

function sourceFacts(source: CamoufoxUpstreamSourceFacts): RuntimeFact[] {
  return [
    { key: "provider.camoufox.source", source: "observed", value: source.source },
    { key: "provider.camoufox.source_sha256", source: "validation_evidence", value: source.source_sha256 },
    { key: "provider.camoufox.version", source: "observed", value: source.camoufox_version },
    { key: "provider.camoufox.browser_version", source: "observed", value: source.browser_version },
    { key: "provider.camoufox.playwright_version", source: "observed", value: source.playwright_version },
    { key: "provider.camoufox.properties_sha256", source: "validation_evidence", value: CAMOUFOX_UPSTREAM_PINS.properties_sha256 }
  ];
}

function arrayFacts(value: unknown): RuntimeFact[] { return Array.isArray(value) ? value.filter(isRuntimeFact).slice(0, 64) : []; }
function isRuntimeFact(value: unknown): value is RuntimeFact { return !!value && typeof value === "object" && typeof (value as JsonObject).key === "string" && typeof (value as JsonObject).source === "string" && typeof (value as JsonObject).value === "string"; }
function object(value: unknown): JsonObject | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null; }
function stringFact(value: JsonObject | null | undefined, key: string): string | undefined { return typeof value?.[key] === "string" ? value[key] as string : undefined; }
function isCamoufoxPath(value: string | undefined): boolean { return typeof value === "string" && /(?:^|[\\/])camoufox(?:$|[._\\/-])/i.test(value); }
function safeOrigin(value: string): string | null { try { const url = new URL(value); return url.origin === value && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null; } catch { return null; } }
function safeUrl(value: string): string | null { try { const url = new URL(value); return safeOrigin(url.origin) ? `${url.origin}${url.pathname}${url.search}` : null; } catch { return null; } }
function isSafeExecutablePath(path: string): boolean { return path.length > 0 && path.length <= 4096 && !/[\0\r\n]/.test(path); }
function unavailable(code: RuntimeErrorFact["code"], message: string, facts: RuntimeFact[] = []): LocalProviderLaunchResult { return { status: "unavailable", error: { code, message, retryable: false }, facts }; }
async function removeDirectory(path: string): Promise<void> { await rm(path, { recursive: true, force: true }).catch(() => undefined); }
