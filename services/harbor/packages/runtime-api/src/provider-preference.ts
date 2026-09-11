import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { acquireFileOwnership } from "./profile-storage.js";
import {
  detectBrowserProviders,
  type BrowserProviderDetectionInput,
  type BrowserProviderId,
  type BrowserProviderStatus
} from "./provider-management.js";
import { secureIdentityEnvironmentStoreDirectory, secureIdentityEnvironmentStoreFile, writeSecureJsonFile } from "./identity-environment-store.js";

export const HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA = "harbor-browser-provider-preference/v1";
export const HARBOR_BROWSER_PROVIDER_PREFERENCE_MUTATION_SCHEMA = "harbor-browser-provider-preference-mutation/v1";

export type BrowserProviderPreferenceAvailability = "unset" | "available" | "unavailable" | "unsupported";

export interface BrowserProviderPreferenceSnapshot {
  schema_version: typeof HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA;
  project_recommendation: {
    provider_id: BrowserProviderId;
    availability: "available" | "unavailable";
    unavailable_reason: string | null;
  };
  user_creation_default: {
    provider_id: string | null;
    availability: BrowserProviderPreferenceAvailability;
    unavailable_reason: string | null;
    updated_at: string | null;
  };
}

export type BrowserProviderPreferenceMutationRequest =
  | { operation: "set"; idempotency_key: string; provider_id: BrowserProviderId }
  | { operation: "clear"; idempotency_key: string };

export interface BrowserProviderPreferenceMutationResult {
  schema_version: typeof HARBOR_BROWSER_PROVIDER_PREFERENCE_MUTATION_SCHEMA;
  operation: "set" | "clear";
  status: "completed" | "rejected";
  preference: BrowserProviderPreferenceSnapshot;
  failure: null | {
    code: "invalid_request" | "provider_unavailable" | "idempotency_conflict" | "persistence_failed";
    retryable: boolean;
  };
}

type StoredPreference = { provider_id: string; updated_at: string };
type StoredReceipt = { idempotency_key: string; request_hash: string; result: BrowserProviderPreferenceMutationResult };
type StoredState = {
  schema_version: typeof HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA;
  user_creation_default: StoredPreference | null;
  mutation_receipts: StoredReceipt[];
};

export class BrowserProviderPreferenceManager {
  private state: StoredState = emptyState();

  constructor(private readonly options: { persistence_path?: string; provider_detection?: BrowserProviderDetectionInput } = {}) {
    this.load();
  }

  read(input: BrowserProviderDetectionInput = {}): BrowserProviderPreferenceSnapshot {
    this.load();
    return snapshot(this.state.user_creation_default, { ...this.options.provider_detection, ...input });
  }

  configuredProviderId(): string | undefined {
    this.load();
    return this.state.user_creation_default?.provider_id;
  }

  mutationResult(idempotencyKey: string): BrowserProviderPreferenceMutationResult | null {
    this.load();
    return clone(this.state.mutation_receipts.find((receipt) => receipt.idempotency_key === idempotencyKey)?.result ?? null);
  }

  mutate(value: unknown): BrowserProviderPreferenceMutationResult {
    const request = parseRequest(value);
    if (!request) return rejected("set", snapshot(this.state.user_creation_default, this.options.provider_detection), "invalid_request", false);
    const path = this.persistencePath();
    const ownership = path ? acquireFileOwnership(`${path}.ownership-lock`, 5000) : null;
    try {
      this.load();
      const requestHash = hash(request);
      const previous = this.state.mutation_receipts.find((receipt) => receipt.idempotency_key === request.idempotency_key);
      if (previous) {
        return previous.request_hash === requestHash
          ? clone(previous.result)
          : rejected(request.operation, snapshot(this.state.user_creation_default, this.options.provider_detection), "idempotency_conflict", false);
      }
      let nextPreference = this.state.user_creation_default;
      let result: BrowserProviderPreferenceMutationResult | undefined;
      if (request.operation === "set") {
        const provider = detectBrowserProviders(this.options.provider_detection).providers.find((candidate) => candidate.provider_id === request.provider_id);
        if (!provider || !isLaunchable(provider)) {
          result = rejected("set", snapshot(this.state.user_creation_default, this.options.provider_detection), "provider_unavailable", true);
        } else {
          nextPreference = { provider_id: request.provider_id, updated_at: new Date().toISOString() };
        }
      } else nextPreference = null;
      result ??= completed(request.operation, snapshot(nextPreference, this.options.provider_detection));
      const next: StoredState = {
        schema_version: HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA,
        user_creation_default: nextPreference,
        mutation_receipts: [...this.state.mutation_receipts, { idempotency_key: request.idempotency_key, request_hash: requestHash, result }]
      };
      try {
        this.persist(next);
      } catch {
        return rejected(request.operation, snapshot(this.state.user_creation_default, this.options.provider_detection), "persistence_failed", true);
      }
      this.state = next;
      return clone(result);
    } finally {
      ownership?.release();
    }
  }

  private load(): void {
    const path = this.persistencePath();
    if (!path) return;
    secureIdentityEnvironmentStoreDirectory(dirname(path));
    if (!existsSync(path)) {
      this.state = emptyState();
      return;
    }
    secureIdentityEnvironmentStoreFile(path);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredState>;
    if (parsed.schema_version !== HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA ||
      !(parsed.user_creation_default === null || validStoredPreference(parsed.user_creation_default)) ||
      !Array.isArray(parsed.mutation_receipts) || !parsed.mutation_receipts.every(validStoredReceipt)) {
      throw new Error("Browser provider preference store is invalid.");
    }
    this.state = clone(parsed as StoredState);
  }

  private persist(state: StoredState): void {
    const path = this.persistencePath();
    if (path) writeSecureJsonFile(path, state);
  }

  private persistencePath(): string | null {
    return this.options.persistence_path ? resolve(this.options.persistence_path) : null;
  }
}

export function resolveBrowserProviderPreferenceStorePath(identityEnvironmentStorePath: string): string {
  return join(dirname(identityEnvironmentStorePath), "browser-provider-preference.json");
}

function emptyState(): StoredState {
  return { schema_version: HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA, user_creation_default: null, mutation_receipts: [] };
}

function snapshot(preference: StoredPreference | null, detection: BrowserProviderDetectionInput = {}): BrowserProviderPreferenceSnapshot {
  const catalog = detectBrowserProviders(detection);
  const recommendation = catalog.providers.find((provider) => provider.role === "primary")!;
  const saved = preference ? catalog.providers.find((provider) => provider.provider_id === preference.provider_id) : undefined;
  return {
    schema_version: HARBOR_BROWSER_PROVIDER_PREFERENCE_SCHEMA,
    project_recommendation: {
      provider_id: recommendation.provider_id,
      availability: isLaunchable(recommendation) ? "available" : "unavailable",
      unavailable_reason: isLaunchable(recommendation) ? null : providerUnavailableReason(recommendation)
    },
    user_creation_default: preference === null
      ? { provider_id: null, availability: "unset", unavailable_reason: null, updated_at: null }
      : saved === undefined
        ? { provider_id: preference.provider_id, availability: "unsupported", unavailable_reason: "provider_not_supported", updated_at: preference.updated_at }
        : { provider_id: preference.provider_id, availability: isLaunchable(saved) ? "available" : "unavailable", unavailable_reason: isLaunchable(saved) ? null : providerUnavailableReason(saved), updated_at: preference.updated_at }
  };
}

function parseRequest(value: unknown): BrowserProviderPreferenceMutationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (request.operation !== "set" && request.operation !== "clear") return null;
  const allowed = request.operation === "set" ? ["operation", "idempotency_key", "provider_id"] : ["operation", "idempotency_key"];
  if (Object.keys(request).some((key) => !allowed.includes(key)) || !validIdempotencyKey(request.idempotency_key)) return null;
  if (request.operation === "set" && !isProviderId(request.provider_id)) return null;
  return request as BrowserProviderPreferenceMutationRequest;
}

function validStoredPreference(value: unknown): value is StoredPreference {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as StoredPreference).provider_id === "string" && (value as StoredPreference).provider_id.length <= 128 &&
    typeof (value as StoredPreference).updated_at === "string" && Number.isFinite(Date.parse((value as StoredPreference).updated_at)));
}

function validStoredReceipt(value: unknown): value is StoredReceipt {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    validIdempotencyKey((value as StoredReceipt).idempotency_key) && /^[a-f0-9]{64}$/.test((value as StoredReceipt).request_hash) &&
    (value as StoredReceipt).result?.schema_version === HARBOR_BROWSER_PROVIDER_PREFERENCE_MUTATION_SCHEMA);
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isProviderId(value: unknown): value is BrowserProviderId {
  return value === "cloakbrowser" || value === "chrome_official" || value === "camoufox";
}

function isLaunchable(provider: BrowserProviderStatus): boolean {
  return provider.selectable && provider.install.status === "installed" && provider.install.launchability === "launchable";
}

function providerUnavailableReason(provider: BrowserProviderStatus): string {
  if (provider.install.status === "missing") return "provider_not_installed";
  if (provider.install.status === "path_invalid") return "provider_path_invalid";
  if (provider.install.launchability === "not_executable") return "provider_not_executable";
  return "provider_not_launchable";
}

function completed(operation: "set" | "clear", preference: BrowserProviderPreferenceSnapshot): BrowserProviderPreferenceMutationResult {
  return { schema_version: HARBOR_BROWSER_PROVIDER_PREFERENCE_MUTATION_SCHEMA, operation, status: "completed", preference, failure: null };
}

function rejected(
  operation: "set" | "clear",
  preference: BrowserProviderPreferenceSnapshot,
  code: NonNullable<BrowserProviderPreferenceMutationResult["failure"]>["code"],
  retryable: boolean
): BrowserProviderPreferenceMutationResult {
  return { schema_version: HARBOR_BROWSER_PROVIDER_PREFERENCE_MUTATION_SCHEMA, operation, status: "rejected", preference, failure: { code, retryable } };
}

function hash(request: BrowserProviderPreferenceMutationRequest): string {
  return createHash("sha256").update(JSON.stringify(request.operation === "set"
    ? [request.operation, request.idempotency_key, request.provider_id]
    : [request.operation, request.idempotency_key])).digest("hex");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
