import { CloakBrowserReleaseError } from "./cloakbrowser-release.js";
import { ProviderCacheOwnershipLost } from "./managed-provider-cache-ownership.js";
import {
  HARBOR_MANAGED_PROVIDER_LIFECYCLE_SCHEMA,
  type ManagedProviderLifecycleError,
  type ManagedProviderLifecycleProgress,
  type ManagedProviderLifecycleState,
  type ManagedProviderLifecycleStatus
} from "./managed-provider-lifecycle-types.js";

export function baseStatus(
  state: "missing" | "ready" | "damaged",
  version: string | null,
  ownership: "harbor" | "external_override",
  platform: string | null,
  checkedAt: string
): ManagedProviderLifecycleStatus {
  const actions: ManagedProviderLifecycleStatus["available_actions"] = ownership === "external_override"
    ? ["recheck", "open_external_management"]
    : state === "ready" ? ["update", "repair", "recheck"] : state === "damaged" ? ["repair", "recheck"] : ["install", "recheck"];
  return {
    schema_version: HARBOR_MANAGED_PROVIDER_LIFECYCLE_SCHEMA,
    provider_id: "cloakbrowser",
    management_mode: ownership === "external_override" ? "external" : "managed",
    ownership,
    state,
    installed_version: version,
    target_version: null,
    release_boundary: {
      source: "cloakbrowser_official_release",
      channel: "free",
      platform,
      integrity: "ed25519_sha256_required",
      distribution: "end_user_direct_download",
      license: "upstream_binary_license"
    },
    checked_at: checkedAt,
    operation: null,
    result: null,
    error: null,
    available_actions: actions,
    public_boundary: { raw_logs: "not_exposed", binary_path: "not_exposed", checksum: "not_exposed", profile_storage: "isolated_temporary_only" }
  };
}

export function progress(phase: ManagedProviderLifecycleState, completedSteps: number): ManagedProviderLifecycleProgress {
  return { phase, completed_steps: completedSteps, total_steps: 5, downloaded_bytes: 0, total_bytes: null, percent: null };
}

export function result(
  status: "succeeded" | "cancelled" | "failed",
  operationId: string,
  version: string | null,
  integrityVerified: boolean,
  launchVerified: boolean,
  rolledBack: boolean
): NonNullable<ManagedProviderLifecycleStatus["result"]> {
  return { status, operation_id: operationId, installed_version: version, integrity_verified: integrityVerified, launch_verified: launchVerified, rolled_back: rolledBack };
}

export function error(
  code: ManagedProviderLifecycleError["code"],
  message: string,
  retryable: boolean,
  recoveryActions: ManagedProviderLifecycleError["recovery_actions"]
): ManagedProviderLifecycleError {
  return { code, message, retryable, recovery_actions: recoveryActions };
}

export function publicError(cause: unknown, phase: ManagedProviderLifecycleState, launchVerified: boolean): ManagedProviderLifecycleError {
  if (isLifecycleError(cause)) return cause;
  if (cause instanceof CloakBrowserReleaseError) {
    const code = cause.code;
    const recovery = code === "unsupported_platform" ? ["recheck"] as const : code === "install_failed" ? ["repair", "recheck"] as const : ["retry", "recheck"] as const;
    return error(code, cause.message, code !== "unsupported_platform", [...recovery]);
  }
  return phase === "launch_verifying" && !launchVerified
    ? error("launch_verification_failed", "CloakBrowser could not complete isolated launch verification.", true, ["repair", "recheck"])
    : error("install_failed", "The verified CloakBrowser release could not be installed.", true, ["repair", "recheck"]);
}

export function recoveryError(message = "Recover the interrupted provider exchange before starting another operation."): ManagedProviderLifecycleError {
  return error("recovery_failed", message, true, ["recheck"]);
}

export function cacheBusyError(): ManagedProviderLifecycleError {
  return error("busy", "Another Harbor Runtime owns the managed provider cache.", true, ["recheck"]);
}

export function cancelledTerminalStatus(
  detected: ManagedProviderLifecycleStatus,
  operation: ManagedProviderLifecycleStatus["operation"],
  operationId: string,
  rolledBack: boolean,
  recoveryFailed: boolean,
  integrityVerified: boolean,
  launchVerified: boolean,
  rollbackFailure: unknown,
  commitPersisted: boolean
): ManagedProviderLifecycleStatus {
  const state = recoveryFailed ? "repairable" : detected.state;
  return {
    ...detected,
    state,
    result: result("cancelled", operationId, detected.installed_version, integrityVerified, launchVerified, rolledBack),
    operation: terminalOperation(operation, state),
    error: recoveryFailed ? recoveryError(recoveryFailureMessage("Cancellation was accepted", null, rollbackFailure, commitPersisted)) : null,
    available_actions: recoveryFailed ? ["recheck"] : detected.available_actions
  };
}

export function failedTerminalStatus(
  detected: ManagedProviderLifecycleStatus,
  operation: ManagedProviderLifecycleStatus["operation"],
  operationId: string,
  phase: ManagedProviderLifecycleState,
  cause: unknown,
  rolledBack: boolean,
  recoveryFailed: boolean,
  integrityVerified: boolean,
  launchVerified: boolean,
  rollbackFailure: unknown,
  commitPersisted: boolean
): ManagedProviderLifecycleStatus {
  const operationError = publicError(cause, phase, launchVerified);
  const operationFailure = cause instanceof ProviderCacheOwnershipLost ? "cache_ownership_lost" : operationError.code;
  const lifecycleError = recoveryFailed
    ? recoveryError(recoveryFailureMessage("The provider operation failed", operationFailure, rollbackFailure, commitPersisted))
    : operationError;
  const state = recoveryFailed
    ? "repairable"
    : detected.state === "ready" ? "ready" : lifecycleError.code === "unsupported_platform" ? "unsupported" : "repairable";
  return {
    ...detected,
    state,
    operation: terminalOperation(operation, state),
    result: result("failed", operationId, detected.installed_version, integrityVerified, launchVerified, rolledBack),
    error: lifecycleError,
    available_actions: recoveryFailed ? ["recheck"] : detected.state !== "ready" ? ["repair", "recheck"] : ["update", "repair", "recheck"]
  };
}

export function compatibleBrowserVersion(observed: string, target: string): boolean {
  return observed === target || observed.split(".").slice(0, 4).join(".") === target.split(".").slice(0, 4).join(".");
}

export function versionNewer(candidate: string, installed: string): boolean {
  const left = candidate.split(".").map(Number);
  const right = installed.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return false;
}

function isLifecycleError(value: unknown): value is ManagedProviderLifecycleError {
  return Boolean(value && typeof value === "object" && "code" in value && "recovery_actions" in value);
}

function terminalOperation(
  operation: ManagedProviderLifecycleStatus["operation"],
  phase: ManagedProviderLifecycleState
): ManagedProviderLifecycleStatus["operation"] {
  return operation ? { ...operation, cancellable: false, progress: { ...operation.progress, phase } } : null;
}

function recoveryFailureMessage(
  prefix: string,
  operationCode: ManagedProviderLifecycleError["code"] | "cache_ownership_lost" | null,
  rollbackFailure: unknown,
  commitPersisted: boolean
): string {
  const attributed = operationCode ? `${prefix} with ${operationCode}` : prefix;
  if (rollbackFailure instanceof ProviderCacheOwnershipLost) {
    return `${attributed}, and rollback could not complete because cache ownership was lost; recheck is required.`;
  }
  if (rollbackFailure) return `${attributed}, and a filesystem rollback step failed; recheck is required.`;
  if (commitPersisted) return `${attributed} after the commit journal was persisted; recheck is required to complete recovery.`;
  return `${attributed}, and rollback could not complete; recheck is required.`;
}
