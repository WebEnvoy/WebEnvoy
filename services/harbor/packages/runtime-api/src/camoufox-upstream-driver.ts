import {
  classifyProviderPageRequest,
  inheritPopupAuthorizedOrigins,
  launchSharedPlaywrightProvider,
  normalizeViewerEntry,
  unavailable
} from "./playwright-shared-driver.js";
import type {
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  RuntimeFact
} from "./runtime-session-types.js";
import type { ResolvedIdentityEnvironmentLaunchConfiguration } from "./identity-environment-configuration.js";

type JsonObject = Record<string, unknown>;

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

export type CamoufoxUpstreamSourceFacts = {
  source: typeof CAMOUFOX_UPSTREAM_PINS.source;
  source_sha256: string;
  camoufox_version: typeof CAMOUFOX_UPSTREAM_PINS.camoufox_version;
  browser_version: typeof CAMOUFOX_UPSTREAM_PINS.browser_version;
  playwright_version: typeof CAMOUFOX_UPSTREAM_PINS.playwright_version;
};

/**
 * Validate the owner-provided install facts before profile preparation or a
 * child process is started. An executable path alone is not a trusted source
 * or version claim.
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
  const bindingProvider = input.identity_environment?.provider_binding.selected_provider_id;
  if (bindingProvider !== undefined && bindingProvider !== "camoufox") return false;
  if (input.provider_id !== "camoufox" && bindingProvider !== "camoufox" && !isCamoufoxPath(input.browser_path || env.HARBOR_BROWSER_PATH)) return false;
  if (hasRetiredCamoufoxBinding(input.identity_environment?.provider_binding)) return false;
  const hasPersistedBinding = input.identity_environment?.provider_binding !== undefined;
  const binding = input.identity_environment?.provider_binding?.selected_provider?.install as JsonObject | undefined;
  return readCamoufoxUpstreamSourceFacts(hasPersistedBinding ? {} : env, binding) !== null;
}

/** The Page/route/files/diagnostics/lifecycle contract is provider-neutral. */
export const classifyUpstreamPageRequest = classifyProviderPageRequest;
export const inheritUpstreamPopupAuthorizedOrigins = inheritPopupAuthorizedOrigins;
export const normalizeUpstreamViewerEntry = normalizeViewerEntry;

export async function launchCamoufoxUpstreamProvider(
  input: LocalProviderLaunchInput,
  resolvedIdentityEnvironmentConfiguration?: ResolvedIdentityEnvironmentLaunchConfiguration
): Promise<LocalProviderLaunchResult> {
  const binding = input.identity_environment?.provider_binding?.selected_provider?.install as JsonObject | undefined;
  const source = readCamoufoxUpstreamSourceFacts(process.env, binding);
  if (!source || !isOfficialCamoufoxLaunchRequest(input)) {
    return unavailable("unsupported", "Camoufox 仅允许由 owner 提供并验证固定官方 source、version、hash；未知或历史 binding 已拒绝。", []);
  }
  return launchSharedPlaywrightProvider(input, {
    provider_id: "camoufox",
    driver_filename: "camoufox-upstream-driver.py",
    pythonPath: () => process.env.HARBOR_CAMOUFOX_PYTHON,
    driverPath: () => process.env.HARBOR_CAMOUFOX_DRIVER,
    browserPath: () => input.browser_path || stringFact(binding, "path") || process.env.HARBOR_BROWSER_PATH || "",
    launchFields: () => ({
      source,
      install_root: stringFact(binding, "install_root") ?? null
    }),
    facts: () => sourceFacts(source),
    screenshotUnavailableMessage: "Camoufox upstream screenshot is unavailable."
  }, resolvedIdentityEnvironmentConfiguration);
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

function stringFact(value: JsonObject | null | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

function isCamoufoxPath(value: string | undefined): boolean {
  return typeof value === "string" && /(?:^|[\\/])camoufox(?:$|[._\\/-])/i.test(value);
}
