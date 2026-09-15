import { realpathSync } from "node:fs";
import {
  launchSharedPlaywrightProvider,
  unavailable
} from "./playwright-shared-driver.js";
import type {
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  RuntimeFact
} from "./runtime-session-types.js";
import type { IdentityEnvironmentProviderBinding } from "./provider-management.js";
import {
  resolveIdentityEnvironmentLaunchConfiguration,
  type ResolvedIdentityEnvironmentLaunchConfiguration
} from "./identity-environment-configuration.js";

export const CHROME_OFFICIAL_PLAYWRIGHT_VERSION = "1.60.0";
export const CHROME_OFFICIAL_BROWSER_VERSION = "153.0.8010.37";
export const CHROME_OFFICIAL_CONNECTION = "public_connect_over_cdp";

export const CHROME_OFFICIAL_PAIRING = Object.freeze({
  source: "official_release",
  signature_status: "apple_codesign_verified",
  source_sha256: "6b6cf06fc357a647d26a32453780f020d9d36978ebe30d69ba8a233b538373e3",
  executable_sha256: "83dfc7d9e4fde4272ced1c0cc8d3584d3b5d3d3bdac46978ee05031e8c2ae3c2",
  browser_version: CHROME_OFFICIAL_BROWSER_VERSION,
  playwright_version: CHROME_OFFICIAL_PLAYWRIGHT_VERSION
} as const);

export type ChromeOfficialPairing = typeof CHROME_OFFICIAL_PAIRING;

export function hostTimezone(): string | null {
  const configured = process.env.TZ;
  if (configured) return rawTimezone(configured);
  return timezoneFromPath("/etc/localtime") ?? canonicalTimezone();
}

function rawTimezone(value: string): string | null {
  const candidate = value.replace(/^:/, "");
  const timezone = candidate.startsWith("/") ? timezoneFromPath(candidate) : candidate;
  return timezone && canonicalTimezone(timezone) ? normalizeUtc(timezone) : null;
}

function timezoneFromPath(path: string): string | null {
  try {
    const resolved = realpathSync(path);
    const marker = "/zoneinfo/";
    const suffix = resolved.includes(marker) ? resolved.split(marker, 2)[1] : null;
    if (!suffix) return null;
    const timezone = suffix.replace(/^(?:posix|right)\//, "");
    return timezone && canonicalTimezone(timezone) ? normalizeUtc(timezone) : null;
  } catch {
    return null;
  }
}

function canonicalTimezone(value?: string): string | null {
  try {
    const timezone = new Intl.DateTimeFormat("en", value ? { timeZone: value } : undefined).resolvedOptions().timeZone;
    return typeof timezone === "string" && timezone ? timezone : null;
  } catch {
    return null;
  }
}

function normalizeUtc(value: string): string {
  return ["Etc/UTC", "Etc/GMT", "GMT"].includes(value) ? "UTC" : value;
}

export function isHostTimezone(value: string | null | undefined): boolean {
  if (value == null) return true;
  if (!value) return false;
  const host = hostTimezone();
  if (!host) return false;
  return canonicalTimezone(value) === canonicalTimezone(host);
}

/**
 * A Chrome launch is admitted only from an owner-persisted, exact pairing.
 * Older Chrome bindings remain readable for management, but cannot spawn this
 * new shared public-connection path until their provenance is re-established.
 */
export function readChromeOfficialPairingFacts(
  binding: IdentityEnvironmentProviderBinding | null | undefined
): ChromeOfficialPairing | null {
  const install = binding?.selected_provider?.install;
  if (!binding || binding.selected_provider_id !== "chrome_official" ||
    binding.selected_provider?.provider_id !== "chrome_official" ||
    binding.selected_provider.selectable !== true || !install ||
    install.status !== "installed" || install.launchability !== "launchable" ||
    install.version_status !== "known" || install.version !== CHROME_OFFICIAL_PAIRING.browser_version ||
    install.source !== CHROME_OFFICIAL_PAIRING.source ||
    install.signature_status !== CHROME_OFFICIAL_PAIRING.signature_status ||
    install.source_sha256 !== CHROME_OFFICIAL_PAIRING.source_sha256 ||
    install.executable_sha256 !== CHROME_OFFICIAL_PAIRING.executable_sha256 ||
    install.browser_version !== CHROME_OFFICIAL_PAIRING.browser_version ||
    install.playwright_version !== CHROME_OFFICIAL_PAIRING.playwright_version) return null;
  return CHROME_OFFICIAL_PAIRING;
}

/** A persisted binding owns both the executable and the managed Profile. */
export function isOfficialChromeLaunchRequest(
  input: Pick<LocalProviderLaunchInput, "provider_id" | "browser_path" | "profile_ref" | "profile_storage_ref" | "identity_environment" | "scope_semantics">
): boolean {
  const binding = input.identity_environment?.provider_binding;
  const install = binding?.selected_provider?.install;
  return binding?.profile_ref === input.profile_ref &&
    install !== undefined &&
    binding.selected_provider_id === "chrome_official" &&
    input.scope_semantics === "agent_operations_v2" &&
    (input.provider_id === undefined || input.provider_id === "chrome_official") &&
    input.profile_storage_ref === input.identity_environment?.browser_storage.profile_storage_ref &&
    typeof install.path === "string" && install.path.trim().length > 0 &&
    !/[\0\r\n]/.test(install.path) &&
    (!input.browser_path || input.browser_path === install.path) &&
    readChromeOfficialPairingFacts(binding) !== null;
}

export async function launchChromeOfficialProvider(
  input: LocalProviderLaunchInput,
  resolvedIdentityEnvironmentConfiguration?: ResolvedIdentityEnvironmentLaunchConfiguration
): Promise<LocalProviderLaunchResult> {
  if (!isOfficialChromeLaunchRequest(input)) {
    return unavailable("unsupported", "官方 Chrome 仅允许由 owner 提供并验证 exact installed pairing 的 managed binding 启动。", []);
  }
  const configuration = resolvedIdentityEnvironmentConfiguration
    ?? (input.identity_environment ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy) : undefined)
    ?? undefined;
  const timezone = configuration ? configuration.timezone : input.identity_environment?.environment.timezone;
  if (!isHostTimezone(timezone)) {
    return unavailable("unsupported", "官方 Chrome 公开连接仅支持与宿主实际 IANA 时区一致的配置。", []);
  }
  const host = hostTimezone();
  const normalizedConfiguration = configuration && timezone && host
    ? { ...configuration, timezone: host }
    : configuration;
  const binding = input.identity_environment!.provider_binding;
  const install = binding.selected_provider!.install;
  const browserPath = install.path!;
  return launchSharedPlaywrightProvider(input, {
    provider_id: "chrome_official",
    driver_filename: "chrome_official_driver.py",
    pythonPath: () => process.env.HARBOR_PLAYWRIGHT_PYTHON,
    browserPath: () => browserPath,
    launchFields: () => ({
      chrome_pairing: CHROME_OFFICIAL_PAIRING,
      connection: CHROME_OFFICIAL_CONNECTION
    }),
    facts: () => chromeFacts(browserPath),
    normalizeEnvironmentObservation: () => null,
    screenshotUnavailableMessage: "Official Chrome screenshot is unavailable."
  }, normalizedConfiguration);
}

function chromeFacts(path: string): RuntimeFact[] {
  return [
    { key: "provider.chrome_official.source", source: "observed", value: CHROME_OFFICIAL_PAIRING.source },
    { key: "provider.chrome_official.source_sha256", source: "validation_evidence", value: CHROME_OFFICIAL_PAIRING.source_sha256 },
    { key: "provider.chrome_official.executable", source: "observed", value: path },
    { key: "provider.chrome_official.executable_sha256", source: "validation_evidence", value: CHROME_OFFICIAL_PAIRING.executable_sha256 },
    { key: "provider.chrome_official.browser_version", source: "observed", value: CHROME_OFFICIAL_PAIRING.browser_version },
    { key: "provider.chrome_official.playwright_version", source: "validation_evidence", value: CHROME_OFFICIAL_PAIRING.playwright_version },
    { key: "provider.chrome_official.connection", source: "configured", value: CHROME_OFFICIAL_CONNECTION }
  ];
}
