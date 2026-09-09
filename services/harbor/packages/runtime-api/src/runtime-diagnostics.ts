import type { RuntimePageStatus } from "./runtime-session-types.js";

export const HARBOR_RUNTIME_DIAGNOSTICS_SCHEMA = "harbor-runtime-diagnostics/v1";
const MAX_EVENTS = 64;
const MAX_TEXT = 512;
const MAX_REF = 256;
const SENSITIVE_NAMES = "authorization|cookie|password|passwd|secret|token|credential|api[_ -]?key|access[_ -]?(?:key|token)|refresh[_ -]?token|session";
const SENSITIVE_TEXT = new RegExp(
  `(?:\\bbearer\\s+\\S+|["']?(?:${SENSITIVE_NAMES})["']?\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^,\\s}]+))`,
  "i"
);
const SENSITIVE_PATH = new RegExp(`(?:^|/)(?:bearer|${SENSITIVE_NAMES})(?:/|$)`, "i");
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

export type DiagnosticsResourceKind =
  | "document" | "script" | "stylesheet" | "image" | "font" | "xhr" | "fetch" | "websocket" | "other";
export type DiagnosticsNetworkKind = "request" | "response" | "failure";
export type DiagnosticsFailureClass = "aborted" | "blocked" | "connection" | "dns" | "timeout" | "unknown";
export type DiagnosticsConsoleLevel = "warn" | "error" | "pageerror";

export interface RuntimeDiagnosticsNetworkEvent {
  event_ref: string;
  request_ref?: string;
  kind: DiagnosticsNetworkKind;
  observed_at: string;
  page_ref: string;
  document_generation: number;
  method: string;
  url: string;
  origin: string;
  resource_kind: DiagnosticsResourceKind;
  status?: number;
  duration_ms?: number;
  redirected?: boolean;
  failure_class?: DiagnosticsFailureClass;
}

export interface RuntimeDiagnosticsConsoleEvent {
  event_ref: string;
  level: DiagnosticsConsoleLevel;
  observed_at: string;
  page_ref: string;
  document_generation: number;
  text: string;
  truncated: boolean;
  source?: { url: string; line?: number; column?: number };
}

export interface RuntimeDiagnosticsInput {
  origin: string;
  page_ref?: string;
  cursor?: string;
  limit?: number;
}

export interface RuntimeDiagnosticsResult {
  status: "completed";
  schema_version: typeof HARBOR_RUNTIME_DIAGNOSTICS_SCHEMA;
  runtime_session_ref: string;
  profile_ref: string;
  page_ref: string;
  document_generation: number;
  page: { current_url: string | null; title: string | null; status: RuntimePageStatus };
  cursor: string;
  next_cursor: string;
  truncated: boolean;
  observed_at: string;
  network: RuntimeDiagnosticsNetworkEvent[];
  console: RuntimeDiagnosticsConsoleEvent[];
}

export interface RuntimeDiagnosticsUnavailable {
  status: "unavailable";
  failure_class: "invalid_request" | "session_missing" | "session_not_ready" | "wrong_page" | "stale_page" | "cursor_stale" | "provider_unavailable";
  message: string;
  retryable: boolean;
}

export type RuntimeDiagnosticsResponse = RuntimeDiagnosticsResult | RuntimeDiagnosticsUnavailable;

export function diagnosticsUnavailable(
  failure_class: RuntimeDiagnosticsUnavailable["failure_class"],
  message = failure_class === "session_missing" ? "Runtime Session is missing." : "Runtime diagnostics are unavailable.",
  retryable = false
): RuntimeDiagnosticsUnavailable {
  return { status: "unavailable", failure_class, message, retryable };
}

export function boundedDiagnosticsInput(value: unknown): RuntimeDiagnosticsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["origin", "page_ref", "cursor", "limit"].includes(key)) || typeof input.origin !== "string" || input.origin.length > MAX_REF) return null;
  if (!isOrigin(input.origin)) return null;
  for (const key of ["page_ref", "cursor"]) if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key] || input[key].length > MAX_REF)) return null;
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > MAX_EVENTS)) return null;
  return { origin: input.origin, ...(typeof input.page_ref === "string" ? { page_ref: input.page_ref } : {}), ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}), ...(typeof input.limit === "number" ? { limit: input.limit } : {}) };
}

export function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

export function safeDiagnosticsUrl(value: unknown): { url: string; origin: string } | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (!isOrigin(parsed.origin) || parsed.username || parsed.password) return null;
    if (parsed.pathname.length > 512) return null;
    const path = SENSITIVE_PATH.test(decodeURIComponent(parsed.pathname)) ? "/<redacted>" : parsed.pathname || "/";
    return { url: `${parsed.origin}${path}`, origin: parsed.origin };
  } catch { return null; }
}

export function safeDiagnosticsText(value: unknown): { text: string; truncated: boolean } {
  if (typeof value !== "string") return { text: "", truncated: false };
  if (SENSITIVE_TEXT.test(value)) return { text: "[redacted]", truncated: false };
  let text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/([?&][^=\s&]+)=([^\s&#]*)/g, "$1=<redacted>");
  text = text.replace(URL_IN_TEXT, match => safeDiagnosticsUrl(match)?.url ?? "[redacted]");
  if (SENSITIVE_TEXT.test(text)) return { text: "[redacted]", truncated: false };
  return { text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
}

function boundedRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REF && /^[A-Za-z0-9:._/-]+$/.test(value);
}

function boundedCursor(value: unknown): value is string {
  return boundedRef(value);
}

function resourceKind(value: unknown): DiagnosticsResourceKind {
  return ["document", "script", "stylesheet", "image", "font", "xhr", "fetch", "websocket", "other"].includes(value as string)
    ? value as DiagnosticsResourceKind : "other";
}

function failureClass(value: unknown): DiagnosticsFailureClass | undefined {
  return ["aborted", "blocked", "connection", "dns", "timeout", "unknown"].includes(value as string)
    ? value as DiagnosticsFailureClass : undefined;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
    ? value : null;
}

export function normalizeRuntimeDiagnostics(value: unknown, context: { runtime_session_ref: string; profile_ref: string }): RuntimeDiagnosticsResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return diagnosticsUnavailable("provider_unavailable");
  const raw = value as Record<string, unknown>;
  if (raw.status === "unavailable") {
    const failure = ["invalid_request", "session_missing", "session_not_ready", "wrong_page", "stale_page", "cursor_stale", "provider_unavailable"].includes(String(raw.failure_class))
      ? raw.failure_class as RuntimeDiagnosticsUnavailable["failure_class"] : "provider_unavailable";
    const message = typeof raw.message === "string" ? safeDiagnosticsText(raw.message).text : undefined;
    return diagnosticsUnavailable(failure, message || undefined, raw.retryable === true);
  }
  if (raw.status !== "completed" || !boundedRef(raw.page_ref) || !boundedCursor(raw.cursor) || !boundedCursor(raw.next_cursor) ||
    !Number.isSafeInteger(raw.document_generation) || Number(raw.document_generation) < 1 || !raw.page || typeof raw.page !== "object" || Array.isArray(raw.page)) return diagnosticsUnavailable("provider_unavailable");
  const page = raw.page as Record<string, unknown>;
  const currentUrl = page.current_url === null ? null : safeDiagnosticsUrl(page.current_url)?.url ?? null;
  const currentOrigin = currentUrl ? safeDiagnosticsUrl(currentUrl)?.origin ?? null : null;
  const pageRef = raw.page_ref;
  const documentGeneration = Number(raw.document_generation);
  const network: RuntimeDiagnosticsNetworkEvent[] = [];
  const consoleEvents: RuntimeDiagnosticsConsoleEvent[] = [];
  let remainingEvents = MAX_EVENTS;
  if (!Array.isArray(raw.network) || !Array.isArray(raw.console)) return diagnosticsUnavailable("provider_unavailable");
  for (const event of raw.network.slice(0, MAX_EVENTS)) {
    if (!remainingEvents) break;
    if (!event || typeof event !== "object") continue;
    const item = event as Record<string, unknown>, safeUrl = safeDiagnosticsUrl(item.url);
    if (!safeUrl || safeUrl.origin !== currentOrigin || !boundedRef(item.event_ref) || typeof item.method !== "string") continue;
    const kind = ["request", "response", "failure"].includes(String(item.kind)) ? item.kind as DiagnosticsNetworkKind : null;
    const eventPageRef = item.page_ref === undefined ? pageRef : boundedRef(item.page_ref) ? item.page_ref : null;
    const eventGeneration = item.document_generation === undefined
      ? documentGeneration
      : Number.isSafeInteger(item.document_generation) && Number(item.document_generation) >= 0 ? Number(item.document_generation) : null;
    if (!kind || !eventPageRef || eventPageRef !== pageRef || eventGeneration === null || eventGeneration !== documentGeneration) continue;
    const observedAt = timestamp(item.observed_at);
    if (!observedAt) continue;
    const method = item.method.trim().slice(0, 16).toUpperCase();
    if (!method || !/^[A-Z!#$%&'*+.^_`|~-]+$/.test(method)) continue;
    const failure = failureClass(item.failure_class);
    network.push({ event_ref: item.event_ref, ...(boundedRef(item.request_ref) ? { request_ref: item.request_ref } : {}), kind, observed_at: observedAt, page_ref: eventPageRef, document_generation: eventGeneration, method, url: safeUrl.url, origin: safeUrl.origin, resource_kind: resourceKind(item.resource_kind), ...(Number.isInteger(item.status) && Number(item.status) >= 100 && Number(item.status) <= 599 ? { status: Number(item.status) } : {}), ...(Number.isFinite(item.duration_ms) && Number(item.duration_ms) >= 0 && Number(item.duration_ms) <= 86_400_000 ? { duration_ms: Math.round(Number(item.duration_ms)) } : {}), ...(item.redirected === true ? { redirected: true } : {}) , ...(failure ? { failure_class: failure } : {}) });
    remainingEvents -= 1;
  }
  for (const event of raw.console.slice(0, MAX_EVENTS)) {
    if (!remainingEvents) break;
    if (!event || typeof event !== "object") continue;
    const item = event as Record<string, unknown>, level = ["warn", "error", "pageerror"].includes(String(item.level)) ? item.level as DiagnosticsConsoleLevel : null;
    if (!level || !boundedRef(item.event_ref)) continue;
    const safe = safeDiagnosticsText(item.text);
    const source = item.source && typeof item.source === "object" ? item.source as Record<string, unknown> : null;
    const sourceUrl = source ? safeDiagnosticsUrl(source.url) : undefined;
    if (typeof item.origin === "string" && item.origin !== currentOrigin) continue;
    if (source && (!sourceUrl || sourceUrl.origin !== currentOrigin)) continue;
    const eventPageRef = item.page_ref === undefined ? pageRef : boundedRef(item.page_ref) ? item.page_ref : null;
    const eventGeneration = item.document_generation === undefined
      ? documentGeneration
      : Number.isSafeInteger(item.document_generation) && Number(item.document_generation) >= 0 ? Number(item.document_generation) : null;
    if (!eventPageRef || eventPageRef !== pageRef || eventGeneration === null || eventGeneration !== documentGeneration) continue;
    const observedAt = timestamp(item.observed_at);
    if (!observedAt) continue;
    const sourceFacts = source && sourceUrl ? { url: sourceUrl.url, ...(Number.isSafeInteger(source.line) && Number(source.line) >= 0 ? { line: Number(source.line) } : {}), ...(Number.isSafeInteger(source.column) && Number(source.column) >= 0 ? { column: Number(source.column) } : {}) } : undefined;
    consoleEvents.push({ event_ref: item.event_ref, level, observed_at: observedAt, page_ref: eventPageRef, document_generation: eventGeneration, text: safe.text, truncated: safe.truncated || item.truncated === true, ...(sourceFacts ? { source: sourceFacts } : {}) });
    remainingEvents -= 1;
  }
  const observedAt = timestamp(raw.observed_at);
  if (!observedAt) return diagnosticsUnavailable("provider_unavailable");
  return { status: "completed", schema_version: HARBOR_RUNTIME_DIAGNOSTICS_SCHEMA, runtime_session_ref: context.runtime_session_ref, profile_ref: context.profile_ref, page_ref: pageRef, document_generation: documentGeneration, page: { current_url: currentUrl, title: typeof page.title === "string" ? safeDiagnosticsText(page.title).text : null, status: ["ready", "unavailable", "unknown"].includes(String(page.status)) ? page.status as RuntimePageStatus : "unknown" }, cursor: raw.cursor, next_cursor: raw.next_cursor, truncated: raw.truncated === true, observed_at: observedAt, network, console: consoleEvents };
}

export type RuntimeDiagnosticsProbe = (input: RuntimeDiagnosticsInput) => Promise<RuntimeDiagnosticsResponse>;
const trustedProbes = new WeakSet<RuntimeDiagnosticsProbe>();
export function trustRuntimeDiagnosticsProbe(probe: RuntimeDiagnosticsProbe): RuntimeDiagnosticsProbe { trustedProbes.add(probe); return probe; }
export function isTrustedRuntimeDiagnosticsProbe(probe: RuntimeDiagnosticsProbe | undefined): probe is RuntimeDiagnosticsProbe { return probe !== undefined && trustedProbes.has(probe); }
