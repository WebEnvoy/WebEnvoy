import {
  projectHarborPublicIdentityEnvironmentRecord,
  type HarborBrowserProviderCatalog
} from "./harbor-admission.js";
import type { HarborIdentityFactsReader } from "./identity-compatibility-preview.js";
import { BoundedJsonResponseError, cancelResponseBody, readBoundedJsonResponse } from "./bounded-json-response.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HttpHarborIdentityFactsReaderOptions = {
  baseUrl: string;
  clock?: () => Date;
  fetch?: FetchLike;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function projectProviderCatalog(value: unknown): HarborBrowserProviderCatalog | undefined {
  const catalog = object(value);
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : undefined;
  if (catalog?.schema_version !== "harbor-browser-provider-status/v0" || !providers || providers.length > 32) return undefined;
  const projected = providers.map((entry) => {
    const provider = object(entry);
    const install = object(provider?.install);
    const providerId = boundedString(provider?.provider_id, 256);
    const status = boundedString(install?.status, 64);
    const launchability = boundedString(install?.launchability, 64);
    return providerId && status && launchability ? { provider_id: providerId, install: { status, launchability } } : undefined;
  });
  return projected.some((entry) => entry === undefined) ? undefined : {
    schema_version: "harbor-browser-provider-status/v0",
    providers: projected as HarborBrowserProviderCatalog["providers"]
  };
}

export function createHttpHarborIdentityFactsReader(options: HttpHarborIdentityFactsReaderOptions): HarborIdentityFactsReader {
  const clock = options.clock ?? (() => new Date());
  const fetchJson = options.fetch ?? fetch;
  const requestedMaxResponseBytes = options.maxResponseBytes ?? 64 * 1024;
  const maxResponseBytes = Math.min(requestedMaxResponseBytes, 64 * 1024);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(requestedMaxResponseBytes) || requestedMaxResponseBytes <= 0) throw new Error("maxResponseBytes must be a positive integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error("timeoutMs must be between 1 and 30000");
  const base = new URL(options.baseUrl);
  if ((base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password || base.search || base.hash) throw new Error("baseUrl must be an HTTP(S) URL without credentials, query, or fragment");
  const baseUrl = base.href.replace(/\/+$/, "");

  async function getPublicJson(path: string, notFoundCode: "identity_not_found" | "owner_unavailable"): Promise<unknown> {
    const response = await fetchJson(`${baseUrl}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(response.status === 404 ? notFoundCode : "owner_unavailable");
    }
    return readBoundedJsonResponse(response, maxResponseBytes);
  }

  let ownerFactsCache: { expiresAt: number; value: Promise<{ readiness: unknown; providers: unknown }> } | undefined;
  function readOwnerFacts(): Promise<{ readiness: unknown; providers: unknown }> {
    const now = Date.now();
    if (ownerFactsCache && ownerFactsCache.expiresAt > now) return ownerFactsCache.value;
    const value = Promise.all([
      getPublicJson("/readiness", "owner_unavailable"),
      getPublicJson("/runtime/browser-providers", "owner_unavailable")
    ]).then(([readiness, providers]) => ({ readiness, providers }));
    ownerFactsCache = { expiresAt: now + 1_000, value };
    return value;
  }

  return async (identityEnvironmentRef) => {
    try {
      const [ownerFacts, identityValue] = await Promise.all([
        readOwnerFacts(),
        getPublicJson(`/runtime/identity-environments/${encodeURIComponent(identityEnvironmentRef)}`, "identity_not_found")
      ]);
      const readiness = object(ownerFacts.readiness);
      if (readiness?.status !== "ready") return { ok: false, owner_status: "unavailable", reason_code: "harbor_owner_not_ready" };
      const providers = projectProviderCatalog(ownerFacts.providers);
      const snapshot = projectHarborPublicIdentityEnvironmentRecord(identityValue, { requireComplete: true });
      if (!providers || !snapshot) return { ok: false, owner_status: "malformed", reason_code: "harbor_identity_facts_malformed" };
      const observedAt = clock();
      if (!Number.isFinite(observedAt.getTime())) return { ok: false, owner_status: "malformed", reason_code: "harbor_identity_facts_malformed" };
      return { ok: true, owner_readiness: "ready", provider_status: providers, ...snapshot, observed_at: observedAt.toISOString() };
    } catch (error) {
      if (error instanceof BoundedJsonResponseError) {
        return {
          ok: false,
          owner_status: "malformed",
          reason_code: error.code === "response_too_large" ? "harbor_response_too_large" : "harbor_identity_facts_malformed"
        };
      }
      if (error instanceof Error && error.message === "identity_not_found") return { ok: false, owner_status: "unavailable", reason_code: "identity_environment_not_found" };
      return { ok: false, owner_status: "unavailable", reason_code: "harbor_owner_unavailable" };
    }
  };
}
