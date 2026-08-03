import { isCloakBrowserVersion, type InstallCloakBrowserReleaseInput, type InstalledCloakBrowserRelease } from "./cloakbrowser-release.js";
import type { ProviderExchangeFileOperations } from "./managed-provider-exchange.js";
import type { ProviderCacheOwnership } from "./managed-provider-cache-ownership.js";

export const HARBOR_MANAGED_PROVIDER_LIFECYCLE_SCHEMA = "harbor-managed-provider-lifecycle/v0";

export type ManagedProviderOperationKind = "install" | "update" | "repair";
export type ManagedProviderLifecycleState =
  | "missing"
  | "ready"
  | "update_available"
  | "damaged"
  | "detecting"
  | "downloading"
  | "verifying"
  | "installing"
  | "launch_verifying"
  | "cancelling"
  | "repairable"
  | "user_action_required"
  | "unsupported";

export interface ManagedProviderOperationInput {
  operation: ManagedProviderOperationKind;
  version?: string;
}

export interface ManagedProviderBeforeOperation {
  state: "missing" | "ready" | "update_available" | "damaged";
  version: string | null;
}

export interface ManagedProviderLifecycleProgress {
  phase: ManagedProviderLifecycleState;
  completed_steps: number;
  total_steps: 5;
  downloaded_bytes: number;
  total_bytes: number | null;
  percent: number | null;
}

export interface ManagedProviderLifecycleError {
  code:
    | "busy"
    | "already_ready"
    | "not_installed"
    | "externally_managed"
    | "install_source_unavailable"
    | "download_failed"
    | "integrity_check_failed"
    | "install_failed"
    | "launch_verification_failed"
    | "recovery_failed"
    | "not_cancellable"
    | "unsupported_platform";
  message: string;
  retryable: boolean;
  recovery_actions: Array<"retry" | "repair" | "recheck" | "open_external_management">;
}

export interface ManagedProviderLifecycleStatus {
  schema_version: typeof HARBOR_MANAGED_PROVIDER_LIFECYCLE_SCHEMA;
  provider_id: "cloakbrowser";
  management_mode: "managed" | "external";
  ownership: "harbor" | "external_override";
  state: ManagedProviderLifecycleState;
  installed_version: string | null;
  target_version: string | null;
  release_boundary: {
    source: "cloakbrowser_official_release";
    channel: "free";
    platform: string | null;
    integrity: "ed25519_sha256_required";
    distribution: "end_user_direct_download";
    license: "upstream_binary_license";
  };
  checked_at: string;
  operation: {
    operation_id: string;
    kind: ManagedProviderOperationKind;
    before_state: "missing" | "ready" | "update_available" | "damaged";
    cancellable: boolean;
    cancel_requested: boolean;
    progress: ManagedProviderLifecycleProgress;
  } | null;
  result: {
    status: "succeeded" | "cancelled" | "failed";
    operation_id: string;
    installed_version: string | null;
    integrity_verified: boolean;
    launch_verified: boolean;
    rolled_back: boolean;
  } | null;
  error: ManagedProviderLifecycleError | null;
  available_actions: Array<ManagedProviderOperationKind | "cancel" | "recheck" | "open_external_management">;
  public_boundary: {
    raw_logs: "not_exposed";
    binary_path: "not_exposed";
    checksum: "not_exposed";
    profile_storage: "isolated_temporary_only";
  };
}

export type ManagedProviderLifecycleCommandResult =
  | { accepted: true; lifecycle: ManagedProviderLifecycleStatus }
  | { accepted: false; lifecycle: ManagedProviderLifecycleStatus; error: ManagedProviderLifecycleError };

export interface ManagedProviderLifecycleOptions {
  cache_dir?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  arch?: string;
  install_release?: (input: InstallCloakBrowserReleaseInput) => Promise<InstalledCloakBrowserRelease>;
  resolve_latest_version?: (platform: NodeJS.Platform, arch: string, signal?: AbortSignal) => Promise<string | null>;
  verify_launch?: (binaryPath: string, expectedVersion: string, signal: AbortSignal) => Promise<{ browser_version: string }>;
  exchange_file_operations?: ProviderExchangeFileOperations;
  acquire_cache_ownership?: (cacheDir: string) => Promise<ProviderCacheOwnership>;
  now?: () => Date;
}

export function isManagedProviderOperationInput(value: unknown): value is ManagedProviderOperationInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  if (input.operation !== "install" && input.operation !== "update" && input.operation !== "repair") return false;
  return input.version === undefined || typeof input.version === "string" && isCloakBrowserVersion(input.version);
}
