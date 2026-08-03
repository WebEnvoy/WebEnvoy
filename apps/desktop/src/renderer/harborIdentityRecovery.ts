import type { LoginState, ManualAuthState } from "./harborIdentityTypes";

const authenticationRecoveryReasons = new Set([
  "auth_required",
  "captcha_required",
  "challenge_required",
  "identity_auth_required",
  "login_expired",
  "logged_out",
  "manual_auth_required",
  "qr_scan_required",
  "two_factor_required",
]);

export function requiresManualAuthentication(
  loginState: LoginState,
  manualAuthenticationState: ManualAuthState,
) {
  return loginState === "logged_out" || loginState === "expired" || loginState === "manual_auth_required" ||
    manualAuthenticationState === "required" || manualAuthenticationState === "in_progress" || manualAuthenticationState === "failed";
}

export function boundedRecoveryReasonCodes(...values: unknown[]) {
  const reasonCodes = values.flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(reasonCodes.filter(
    (value): value is string => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value),
  ))].slice(0, 32);
}

export function isAuthenticationRecoveryReason(reason: string) {
  return authenticationRecoveryReasons.has(reason) || reason.startsWith("login_state_");
}

export function isBrowserEnvironmentRepairReason(reason: string) {
  return [
    "browser_environment_repair_required",
    "browser_provider_unavailable",
    "fingerprint_conflict",
    "identity_environment_unavailable",
    "identity_storage_unavailable",
    "profile_locked",
    "provider_conflict",
    "repair_required",
    "storage_missing",
    "provider_missing",
    "provider_unavailable",
    "provider_binding_conflict",
  ].includes(reason) || /^(browser|environment|fingerprint|identity_environment|profile|repair|storage|proxy)_/.test(reason);
}
