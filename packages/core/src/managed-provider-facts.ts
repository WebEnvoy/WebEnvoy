import { normalizeNonSensitiveText } from "./sensitive-field-taxonomy.js";

export const managedProviderCatalogFactsSchemaVersion = "webenvoy.provider-catalog-facts/v1" as const;

const providerIds = new Set(["cloakbrowser", "chrome_official", "camoufox"]);
const providerRoles = new Set(["primary", "restricted_fallback", "qualification"]);
const availabilityStates = new Set(["available", "unavailable"]);
const unavailableReasons = new Set([
  "provider_not_selectable",
  "provider_not_installed",
  "provider_path_invalid",
  "provider_not_executable",
  "provider_not_launchable",
  "provider_not_supported"
]);
const capabilityKeys = new Set([
  "persistent_profile", "independent_user_data_dir", "proxy", "timezone", "locale", "viewport", "extensions",
  "cookie_persistence", "cdp", "viewer", "snapshot_refs", "evidence_refs", "native_fingerprint_control",
  "anti_detection_binary_patches", "automation_exposure_reduction"
]);
const capabilityStates = new Set(["supported", "limited", "unsupported", "provider_claim", "requires_validation"]);
const capabilitySources = new Set(["configured", "observed", "provider_claim", "validation_evidence", "derived"]);
const providerPrivateLocation = /(?:^|[\s"'(=:：])(?:~\/|\/(?:Users|home|private|tmp|var|Volumes|Applications|opt|etc|root|mnt|workspace|workspaces)\/|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|[A-Za-z]:\\)/i;
const providerAddress = /(?:https?|wss?|file):\/\/|\b(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?/i;
const providerSecretAssignment = /\b(?:cookie|token|password|secret|credential|authorization|api[_-]?key)\s*[:=]\s*["']?[^\s"',;]+/i;

type ManagedProviderCatalogFacts = {
  schema_version: typeof managedProviderCatalogFactsSchemaVersion;
  providers: {
    provider_id: string;
    display_name: string;
    role: "primary" | "restricted_fallback" | "qualification";
    selectable: boolean;
    project_recommended: boolean;
    availability: { state: "available" | "unavailable"; unavailable_reason: string | null };
    capabilities: { key: string; state: string; source: string; summary?: string }[];
    limitations: string[];
  }[];
};

type ManagedProviderPreference = {
  schema_version: "harbor-browser-provider-preference/v1";
  project_recommendation: { provider_id: string; availability: "available" | "unavailable"; unavailable_reason: string | null };
  user_creation_default: { provider_id: string | null; availability: "unset" | "available" | "unavailable" | "unsupported"; unavailable_reason: string | null; updated_at: string | null };
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  return normalizeNonSensitiveText(value, maxLength);
}

function safeProviderDescription(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) || providerPrivateLocation.test(value) || providerAddress.test(value) ||
    providerSecretAssignment.test(value)) return undefined;

  // Harbor's public summaries may name an interface without containing its private value.
  const publicSummary = value
    .replace(/(不暴露|暴露)\s+CDP\s*[、,，]\s*(?:原始\s+)?endpoint/giu, "$1远程调试接口")
    .replace(/(不暴露|暴露)\s+CDP\s+endpoint/giu, "$1远程调试接口")
    .replace(/CDP\s*[、,，]\s*(?:原始\s+)?endpoint/giu, "远程调试接口")
    .replace(/\bCDP\s+endpoint\b/giu, "远程调试接口")
    .replace(/\braw\s+DOM\b/giu, "页面标记内容")
    .replace(/\bHAR\b\s*/gu, "网络归档");
  return normalizeNonSensitiveText(publicSummary, maxLength);
}

function providerId(value: unknown): string | undefined {
  const id = safeText(value, 128);
  return id && /^[a-z][a-z0-9_.-]*$/.test(id) ? id : undefined;
}

function unavailableReason(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && unavailableReasons.has(value) ? value : undefined;
}

function isoTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  const timestamp = safeText(value, 64);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) return undefined;
  return timestamp;
}

function availability(value: unknown): ManagedProviderCatalogFacts["providers"][number]["availability"] | undefined {
  const input = record(value);
  if (!input || !availabilityStates.has(String(input.state))) return undefined;
  if (input.state === "available") return input.unavailable_reason === null ? { state: "available", unavailable_reason: null } : undefined;
  if (typeof input.unavailable_reason !== "string" || !unavailableReasons.has(input.unavailable_reason)) return undefined;
  return { state: "unavailable", unavailable_reason: input.unavailable_reason };
}

export function projectManagedProviderCatalogFacts(value: unknown): ManagedProviderCatalogFacts | undefined {
  const catalog = record(value);
  if (catalog?.schema_version !== "harbor-browser-provider-status/v0" || !Array.isArray(catalog.providers) || catalog.providers.length < 1 || catalog.providers.length > 32) return undefined;
  const providers: ManagedProviderCatalogFacts["providers"] = [];
  for (const entry of catalog.providers) {
    const provider = record(entry);
    const id = safeText(provider?.provider_id, 128);
    const displayName = safeText(provider?.display_name, 128);
    const role = provider?.role;
    const providerAvailability = availability(provider?.availability);
    if (!provider || !id || !providerIds.has(id) || !displayName || !providerRoles.has(String(role)) ||
      typeof provider.selectable !== "boolean" || typeof provider.project_recommended !== "boolean" || !providerAvailability ||
      (providerAvailability.state === "available" && provider.selectable !== true) ||
      !Array.isArray(provider.capabilities) || provider.capabilities.length > 32 || !Array.isArray(provider.limitations) || provider.limitations.length > 32) return undefined;

    const capabilities: ManagedProviderCatalogFacts["providers"][number]["capabilities"] = [];
    for (const value of provider.capabilities) {
      const capability = record(value);
      const key = capability?.key;
      const summary = safeProviderDescription(capability?.note, 512);
      if (!capability || typeof key !== "string" || !capabilityKeys.has(key) || !capabilityStates.has(String(capability.state)) ||
        !capabilitySources.has(String(capability.source)) || typeof capability.note !== "string") return undefined;
      capabilities.push({ key, state: String(capability.state), source: String(capability.source), ...(summary ? { summary } : {}) });
    }

    const limitations = provider.limitations.map(item => safeProviderDescription(item, 512));
    if (limitations.some(item => item === undefined)) return undefined;
    providers.push({
      provider_id: id,
      display_name: displayName,
      role: role as ManagedProviderCatalogFacts["providers"][number]["role"],
      selectable: provider.selectable,
      project_recommended: provider.project_recommended,
      availability: providerAvailability,
      capabilities,
      limitations: limitations as string[]
    });
  }
  if (new Set(providers.map(provider => provider.provider_id)).size !== providers.length ||
    providers.filter(provider => provider.project_recommended).length !== 1 ||
    providers.filter(provider => provider.role === "primary").length !== 1 ||
    providers.some(provider => provider.project_recommended !== (provider.role === "primary"))) return undefined;
  return { schema_version: managedProviderCatalogFactsSchemaVersion, providers };
}

export function projectManagedProviderPreference(value: unknown): ManagedProviderPreference | undefined {
  const input = record(value);
  const recommendation = record(input?.project_recommendation);
  const savedDefault = record(input?.user_creation_default);
  const recommendationId = providerId(recommendation?.provider_id);
  const recommendationReason = unavailableReason(recommendation?.unavailable_reason);
  const defaultId = savedDefault?.provider_id === null ? null : providerId(savedDefault?.provider_id);
  const defaultReason = unavailableReason(savedDefault?.unavailable_reason);
  const updatedAt = isoTimestamp(savedDefault?.updated_at);
  if (input?.schema_version !== "harbor-browser-provider-preference/v1" || !recommendation || !recommendationId ||
    !availabilityStates.has(String(recommendation.availability)) || recommendationReason === undefined ||
    !savedDefault || !(defaultId === null || defaultId) ||
    !["unset", "available", "unavailable", "unsupported"].includes(String(savedDefault.availability)) || defaultReason === undefined || updatedAt === undefined ||
    (savedDefault.availability === "unset" && (defaultId !== null || defaultReason !== null || updatedAt !== null)) ||
    (savedDefault.availability !== "unset" && (defaultId === null || updatedAt === null))) return undefined;
  return {
    schema_version: "harbor-browser-provider-preference/v1",
    project_recommendation: {
      provider_id: recommendationId,
      availability: recommendation.availability as "available" | "unavailable",
      unavailable_reason: recommendationReason
    },
    user_creation_default: {
      provider_id: defaultId,
      availability: savedDefault.availability as ManagedProviderPreference["user_creation_default"]["availability"],
      unavailable_reason: defaultReason,
      updated_at: updatedAt
    }
  };
}

export function providerFactsMatchPreference(
  preference: ManagedProviderPreference,
  catalog: ManagedProviderCatalogFacts
): boolean {
  const recommended = catalog.providers.find(provider => provider.project_recommended);
  if (!recommended || recommended.provider_id !== preference.project_recommendation.provider_id ||
    recommended.availability.state !== preference.project_recommendation.availability ||
    recommended.availability.unavailable_reason !== preference.project_recommendation.unavailable_reason) return false;

  const savedDefault = preference.user_creation_default;
  if (savedDefault.provider_id === null) return savedDefault.availability === "unset";
  const savedProvider = catalog.providers.find(provider => provider.provider_id === savedDefault.provider_id);
  if (!savedProvider) return savedDefault.availability === "unsupported" && savedDefault.unavailable_reason === "provider_not_supported";
  return savedDefault.availability === savedProvider.availability.state && savedDefault.unavailable_reason === savedProvider.availability.unavailable_reason;
}
