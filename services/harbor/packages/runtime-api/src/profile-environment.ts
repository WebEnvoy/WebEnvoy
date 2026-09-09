import type { LocalIdentityEnvironmentFacts } from "./identity-environment.js";
import type { IdentityEnvironmentConfigurationUpdate } from "./identity-environment-mutation-types.js";

export const PROFILE_ENVIRONMENT_SCHEMA = "harbor-profile-environment/v1";
const CONFIGURATION_FIELDS = ["timezone", "language", "viewport"] as const;
const HASH_FIELDS = ["fonts_hash", "voices_hash", "canvas_hash", "audio_hash"] as const;
const OBSERVATION_FIELDS = ["language", "languages", "timezone", "viewport", "screen", "hardware_concurrency", "device_memory", "webgl_vendor", "webgl_renderer", ...HASH_FIELDS] as const;
const UNOBSERVED = ["network_exit", "geo", "webrtc", "media_devices"];

export interface ProfileEnvironmentConfiguration {
  provider_id: string | null;
  proxy_ref: string | null;
  geoip_mode: string | null;
  language: string | null;
  timezone: string | null;
  viewport: string | null;
}

export interface EnvironmentDrift {
  state: "match" | "drift" | "unknown";
  checked_fields: string[];
  changed_fields: string[];
  unknown_fields: string[];
}

export interface EnvironmentObservation {
  status: "completed";
  observed_at: string;
  provider: { camoufox_version: string; browser_version: string; properties_sha256: string };
  bundle_hash: string;
  observed: {
    language: string | null;
    languages: string[];
    timezone: string | null;
    viewport: { width: number; height: number } | null;
    screen: { width: number; height: number } | null;
    hardware_concurrency: number | null;
    device_memory: number | null;
    webgl_vendor: string | null;
    webgl_renderer: string | null;
    fonts_hash: string | null;
    voices_hash: string | null;
    canvas_hash: string | null;
    audio_hash: string | null;
  };
  continuity: EnvironmentDrift;
}

export type EnvironmentProbe = () => Promise<EnvironmentObservation | null>;
const trustedProbes = new WeakSet<EnvironmentProbe>();
export function trustEnvironmentProbe(probe: EnvironmentProbe): EnvironmentProbe { trustedProbes.add(probe); return probe; }
export function isTrustedEnvironmentProbe(probe: EnvironmentProbe | undefined): probe is EnvironmentProbe { return !!probe && trustedProbes.has(probe); }

export function profileEnvironmentConfiguration(facts: LocalIdentityEnvironmentFacts): ProfileEnvironmentConfiguration {
  return { provider_id: facts.provider_binding.selected_provider_id, proxy_ref: facts.environment.proxy.proxy_ref,
    geoip_mode: facts.environment.geoip_mode, language: facts.environment.language, timezone: facts.environment.timezone, viewport: facts.environment.viewport };
}

export function boundedEnvironmentUpdate(value: unknown): IdentityEnvironmentConfigurationUpdate | null {
  const input = object(value);
  if (!input || Object.keys(input).length === 0 || Object.keys(input).some(key => !CONFIGURATION_FIELDS.includes(key as never))) return null;
  if (Object.values(input).some(item => typeof item !== "string" || !item.length || item.length > 128 || /[\u0000-\u001f\u007f]/.test(item))) return null;
  return { ...input } as IdentityEnvironmentConfigurationUpdate;
}

export function normalizeEnvironmentObservation(value: unknown): EnvironmentObservation | null {
  const raw = object(value), provider = object(raw?.provider), observed = object(raw?.observed);
  if (!raw || raw.status !== "completed" || !provider || !observed ||
    typeof raw.observed_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.observed_at) || !Number.isFinite(Date.parse(raw.observed_at)) ||
    !version(provider.camoufox_version) || !version(provider.browser_version) || !hash(provider.properties_sha256) || !hash(raw.bundle_hash)) return null;
  const continuity = object(raw.continuity);
  const checked = fields(continuity?.checked_fields), changed = fields(continuity?.changed_fields).filter(key => checked.includes(key));
  return {
    status: "completed", observed_at: raw.observed_at,
    provider: { camoufox_version: provider.camoufox_version, browser_version: provider.browser_version, properties_sha256: provider.properties_sha256 },
    bundle_hash: raw.bundle_hash,
    observed: {
      language: text(observed.language), languages: Array.isArray(observed.languages) ? observed.languages.slice(0, 16).map(text).filter((item): item is string => item !== null) : [],
      timezone: text(observed.timezone), viewport: dimensions(observed.viewport), screen: dimensions(observed.screen),
      hardware_concurrency: finite(observed.hardware_concurrency), device_memory: finite(observed.device_memory),
      webgl_vendor: text(observed.webgl_vendor), webgl_renderer: text(observed.webgl_renderer),
      fonts_hash: hash(observed.fonts_hash) ? observed.fonts_hash : null,
      voices_hash: hash(observed.voices_hash) ? observed.voices_hash : null,
      canvas_hash: hash(observed.canvas_hash) ? observed.canvas_hash : null,
      audio_hash: hash(observed.audio_hash) ? observed.audio_hash : null
    },
    continuity: { state: changed.length ? "drift" : checked.length && continuity?.state === "match" ? "match" : "unknown", checked_fields: checked, changed_fields: changed, unknown_fields: fields(continuity?.unknown_fields) }
  };
}

export function profileEnvironmentState(facts: LocalIdentityEnvironmentFacts, runtimeSessionRef: string | null,
  effective: ProfileEnvironmentConfiguration | null, observation: EnvironmentObservation | null, lastVerifiedAt: string | null) {
  const configured = profileEnvironmentConfiguration(facts);
  const drift: EnvironmentDrift = { state: "unknown", checked_fields: [...(observation?.continuity.checked_fields ?? [])], changed_fields: [...(observation?.continuity.changed_fields ?? [])], unknown_fields: [...UNOBSERVED, ...(observation?.continuity.unknown_fields ?? [])] };
  if (observation && effective) {
    for (const key of ["timezone", "language"] as const) {
      const expected = effective[key], actual = observation.observed[key];
      if (!expected || !actual) { drift.unknown_fields.push(key); continue; }
      drift.checked_fields.push(key);
      if (!sameLocaleFact(key, expected, actual)) drift.changed_fields.push(key);
    }
    for (const key of OBSERVATION_FIELDS) if (observation.observed[key] === null) drift.unknown_fields.push(key);
    drift.state = drift.changed_fields.length ? "drift" : drift.checked_fields.length ? "match" : "unknown";
  } else drift.unknown_fields.push(...OBSERVATION_FIELDS);
  drift.checked_fields = [...new Set(drift.checked_fields)];
  drift.changed_fields = [...new Set(drift.changed_fields)];
  drift.unknown_fields = [...new Set(drift.unknown_fields)];
  return {
    status: "completed" as const, schema_version: PROFILE_ENVIRONMENT_SCHEMA,
    profile_ref: facts.profile_ref, identity_environment_ref: facts.identity_environment_ref, runtime_session_ref: runtimeSessionRef,
    configured, effective, pending: JSON.stringify(configured) === JSON.stringify(effective) ? null : configured,
    observation_status: observation ? "observed" as const : runtimeSessionRef ? "unavailable" as const : "inactive" as const,
    observed: observation?.observed ?? null, provider: observation?.provider ?? null, bundle_hash: observation?.bundle_hash ?? null,
    drift, last_verified_at: observation?.observed_at ?? lastVerifiedAt,
    support: { configuration_fields: [...CONFIGURATION_FIELDS], readback_fields: observation ? OBSERVATION_FIELDS.filter(key => observation.observed[key] !== null) : [],
      limitations: ["No proxy/network-exit/geo/WebRTC verification in this read", "No arbitrary provider, hardware, seed or fingerprint changes", "Verification is scoped to the current Instance and checked fields"] }
  };
}

export function environmentUnavailable(failure_class: string, retryable = false) {
  return { status: "unavailable" as const, failure_class, message: "Profile environment operation is unavailable.", retryable };
}

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function version(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(value); }
function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= 256 && !/[\u0000-\u001f\u007f]|(?:token|password|cookie|secret|credential|authorization)\s*[:=]|bearer\s/i.test(value) ? value : null;
}
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000 ? value : null; }
function dimensions(value: unknown): { width: number; height: number } | null {
  const raw = object(value), width = finite(raw?.width), height = finite(raw?.height);
  return width !== null && height !== null ? { width, height } : null;
}
function fields(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && OBSERVATION_FIELDS.includes(item as never)).slice(0, 16) : []; }
function sameLocaleFact(key: "timezone" | "language", expected: string, actual: string): boolean {
  try {
    return key === "timezone"
      ? new Intl.DateTimeFormat("en", { timeZone: expected }).resolvedOptions().timeZone === new Intl.DateTimeFormat("en", { timeZone: actual }).resolvedOptions().timeZone
      : Intl.getCanonicalLocales(expected)[0]?.toLowerCase() === Intl.getCanonicalLocales(actual)[0]?.toLowerCase();
  } catch { return false; }
}
