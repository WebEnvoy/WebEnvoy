import type { LocalIdentityEnvironmentFacts } from "./identity-environment.js";
import type {
  IdentityEnvironmentConfigurationUpdate,
  IdentityEnvironmentMutationFailureCode,
  IdentityEnvironmentMutationOptions
} from "./identity-environment-mutation-types.js";
import type { ManagedLocalIdentityEnvironmentInput } from "./identity-environment-manager.js";
import { bindIdentityEnvironmentDefaultProvider, type BrowserProviderCapabilityKey } from "./provider-management.js";

export interface ResolvedIdentityEnvironmentLaunchConfiguration {
  provider_id: "cloakbrowser" | "chrome_official";
  proxy_server: string | null;
  language: string | null;
  timezone: string | null;
  viewport: { width: number; height: number } | null;
}

const LEGACY_SYSTEM_DEFAULT_VIEWPORT = "系统默认";

export function applyIdentityEnvironmentConfiguration(
  facts: LocalIdentityEnvironmentFacts,
  update: IdentityEnvironmentConfigurationUpdate
): void {
  if (update.provider_id) {
    facts.provider_binding = bindIdentityEnvironmentDefaultProvider({
      requested_provider_id: update.provider_id,
      execution_identity_ref: facts.execution_identity_ref,
      profile_ref: facts.profile_ref
    });
    facts.environment.browser_family = update.provider_id;
  }
  if (update.proxy_ref !== undefined) {
    facts.environment.proxy.proxy_ref = update.proxy_ref;
    if (update.proxy_ref === null && update.proxy_label === undefined) facts.environment.proxy.label = null;
    if (update.proxy_ref === null && update.geoip_mode === undefined && facts.environment.geoip_mode === "proxy") {
      facts.environment.geoip_mode = "system";
    }
  }
  if (update.proxy_label !== undefined) facts.environment.proxy.label = update.proxy_label;
  if (update.proxy_ref !== undefined || update.proxy_label !== undefined) {
    facts.environment.proxy.state = facts.environment.proxy.proxy_ref ? "configured" : "missing";
  }
  for (const key of [
    "geoip_mode",
    "region",
    "language",
    "timezone",
    "viewport",
    "hardware_concurrency",
    "device_memory_gb",
    "gpu_profile",
    "interaction_preset",
    "fingerprint_strategy"
  ] as const) {
    if (update[key] !== undefined) Object.assign(facts.environment, { [key]: update[key] });
  }
}

export function validateIdentityEnvironmentConfiguration(
  input: IdentityEnvironmentConfigurationUpdate | ManagedLocalIdentityEnvironmentInput,
  facts: LocalIdentityEnvironmentFacts,
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationFailureCode | null {
  const requestedProvider = "provider_id" in input
    ? input.provider_id
    : "requested_provider_id" in input ? input.requested_provider_id : undefined;
  if (requestedProvider && facts.provider_binding.selected_provider_id !== requestedProvider) return "provider_mismatch";
  if (!facts.provider_binding.selected_provider_id || !facts.provider_binding.selected_provider) return "provider_mismatch";
  if ("browser_family" in input && input.browser_family !== undefined &&
    input.browser_family !== facts.provider_binding.selected_provider_id) return "provider_mismatch";

  const capabilities = facts.provider_binding.selected_provider.capabilities;
  for (const capability of requiredCapabilities(input)) {
    const fact = capabilities.find((item) => item.key === capability);
    if (!fact || !["supported", "limited"].includes(fact.state) || fact.source === "provider_claim") {
      return "unsupported_configuration";
    }
  }

  if (input.region !== undefined) return "unsupported_configuration";
  if (input.hardware_concurrency !== undefined || input.device_memory_gb !== undefined || input.gpu_profile !== undefined) {
    return "unsupported_configuration";
  }
  if (input.interaction_preset === "humanized" || input.fingerprint_strategy === "stable") {
    return "unsupported_configuration";
  }
  if (input.language !== undefined && !validLanguage(input.language)) return "unsupported_configuration";
  if (input.timezone !== undefined && !validTimezone(input.timezone)) return "unsupported_configuration";
  if (input.viewport !== undefined && !parseViewport(input.viewport)) return "unsupported_configuration";

  const proxy = facts.environment.proxy;
  if (proxy.label && !proxy.proxy_ref) return "unsupported_configuration";
  if (facts.environment.geoip_mode === "proxy" && !proxy.proxy_ref) return "proxy_policy_incompatible";
  if (proxy.proxy_ref) {
    const validation = options.validate_proxy?.(proxy.proxy_ref);
    if (!validation) return "proxy_validation_unavailable";
    if (validation === "incompatible") return "proxy_policy_incompatible";
    if (validation === "unreachable") return "proxy_unreachable";
    const resolved = resolveProxyServer(proxy.proxy_ref, options.resolve_proxy);
    if (!resolved) return "proxy_resolution_unavailable";
  }
  return null;
}

export function resolveIdentityEnvironmentLaunchConfiguration(
  facts: LocalIdentityEnvironmentFacts,
  resolveProxy: IdentityEnvironmentMutationOptions["resolve_proxy"]
): ResolvedIdentityEnvironmentLaunchConfiguration | null {
  const providerId = facts.provider_binding.selected_provider_id;
  if (!providerId) return null;
  const proxyRef = facts.environment.proxy.proxy_ref;
  const proxyServer = proxyRef ? resolveProxyServer(proxyRef, resolveProxy) : null;
  if (proxyRef && !proxyServer) return null;
  const viewportValue = facts.environment.viewport;
  const viewport = viewportValue === null || viewportValue === LEGACY_SYSTEM_DEFAULT_VIEWPORT
    ? null
    : parseViewport(viewportValue);
  if (viewportValue !== null && viewportValue !== LEGACY_SYSTEM_DEFAULT_VIEWPORT && !viewport) return null;
  return {
    provider_id: providerId,
    proxy_server: proxyServer,
    language: facts.environment.language,
    timezone: facts.environment.timezone,
    viewport
  };
}

function requiredCapabilities(
  input: IdentityEnvironmentConfigurationUpdate | ManagedLocalIdentityEnvironmentInput
): BrowserProviderCapabilityKey[] {
  const keys = new Set<BrowserProviderCapabilityKey>();
  if (input.proxy_ref !== undefined || input.geoip_mode === "proxy") keys.add("proxy");
  if (input.timezone !== undefined) keys.add("timezone");
  if (input.language !== undefined || input.region !== undefined) keys.add("locale");
  if (input.viewport !== undefined) keys.add("viewport");
  if (input.hardware_concurrency !== undefined || input.device_memory_gb !== undefined || input.gpu_profile !== undefined || input.fingerprint_strategy === "stable") {
    keys.add("native_fingerprint_control");
  }
  if (input.interaction_preset === "humanized") keys.add("automation_exposure_reduction");
  return [...keys];
}

function resolveProxyServer(
  proxyRef: string,
  resolveProxy: IdentityEnvironmentMutationOptions["resolve_proxy"]
): string | null {
  if (!resolveProxy) return null;
  try {
    const value = resolveProxy(proxyRef);
    return value && validProxyServer(value) ? value : null;
  } catch {
    return null;
  }
}

function validProxyServer(value: string): boolean {
  if (!value.trim() || value.length > 2048 || /[\r\n\0]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol) &&
      Boolean(parsed.hostname) && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function validLanguage(value: string): boolean {
  if (!value.trim() || value.length > 64) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function validTimezone(value: string): boolean {
  if (!value.trim() || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function parseViewport(value: string): { width: number; height: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= 200 && width <= 16384 && height >= 200 && height <= 16384 ? { width, height } : null;
}
