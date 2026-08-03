import { createHash } from "node:crypto";
import type {
  BrowserProviderDetectionInput,
  IdentityEnvironmentProviderBinding,
  IdentityEnvironmentProviderBindingInput
} from "./provider-management.js";
import { bindIdentityEnvironmentDefaultProvider } from "./provider-management.js";

export const HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA = "harbor-local-identity-environment/v0";

export type LoginState = "logged_in" | "logged_out" | "expired" | "unknown" | "manual_auth_required";
export type BrowserStorageState = "present" | "missing" | "cleared" | "unknown";
export type ProtectedMaterialClass = "public_summary" | "local_protected_material" | "never_export_material";
export type ExportPolicy = "safe_summary" | "redacted_ref" | "explicit_full_export_only" | "never_export";
export type ManualAuthenticationState = "not_required" | "required" | "in_progress" | "completed" | "failed";
export type HumanVerificationKind = "manual_login" | "qr_scan" | "two_factor" | "captcha" | "login_expired";

export interface SiteBindingInput {
  site_id: string;
  origin: string;
  display_name?: string;
  account_identifier?: string;
  account_ref?: string;
}

export interface LocalIdentityEnvironmentInput extends BrowserProviderDetectionInput {
  identity_environment_ref?: string;
  execution_identity_ref?: string;
  profile_ref?: string;
  site: SiteBindingInput;
  login_state?: LoginState;
  login_state_reason?: string;
  storage_state?: BrowserStorageState;
  profile_storage_ref?: string;
  proxy_ref?: string;
  proxy_label?: string;
  region?: string;
  geoip_mode?: "proxy" | "system" | "disabled";
  language?: string;
  timezone?: string;
  browser_family?: string;
  user_agent_summary?: string;
  viewport?: string;
  hardware_concurrency?: number;
  device_memory_gb?: number;
  gpu_profile?: string;
  interaction_preset?: "default" | "humanized";
  fingerprint_strategy?: "provider_default" | "stable";
  fingerprint_summary?: string;
  credential_ref?: string;
  keychain_ref?: string;
  local_secret_ref?: string;
  login_method?: "manual" | "qr" | "sso" | "password_manager" | "unknown";
  manual_authentication_state?: ManualAuthenticationState;
  human_verification?: HumanVerificationKind[];
  requested_provider_id?: IdentityEnvironmentProviderBindingInput["requested_provider_id"];
}

export interface MaterialBoundary {
  material:
    | "identity_environment_summary"
    | "account_identifier"
    | "profile_storage_ref"
    | "browser_storage_material"
    | "credential_ref"
    | "human_verification_state";
  class: ProtectedMaterialClass;
  app_visibility: ExportPolicy;
  core_visibility: ExportPolicy;
  lode_visibility: ExportPolicy;
  note: string;
}

export interface LocalIdentityEnvironmentFacts {
  schema_version: typeof HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA;
  identity_environment_ref: string;
  execution_identity_ref: string;
  profile_ref: string;
  site_binding: {
    site_id: string;
    origin: string;
    display_name: string;
    account_label: string | null;
    account_ref: string | null;
  };
  login_state: {
    state: LoginState;
    reason: string | null;
    recovery_required: boolean;
    manual_authentication_state: ManualAuthenticationState;
    human_verification: HumanVerificationKind[];
  };
  browser_storage: {
    profile_storage_ref: string;
    state: BrowserStorageState;
    cookies_session_state: BrowserStorageState;
    local_storage_state: BrowserStorageState;
    indexeddb_state: BrowserStorageState;
    cleanup_rule: "delete_profile_storage_and_refs";
    residual_check: "required_before_delete_complete";
  };
  environment: {
    proxy: { state: "configured" | "missing" | "unknown"; proxy_ref: string | null; label: string | null };
    region: string | null;
    geoip_mode: "proxy" | "system" | "disabled" | null;
    language: string | null;
    timezone: string | null;
    browser_family: string;
    user_agent_summary: string | null;
    viewport: string | null;
    hardware_concurrency: number | null;
    device_memory_gb: number | null;
    gpu_profile: string | null;
    interaction_preset: "default" | "humanized" | null;
    fingerprint_strategy: "provider_default" | "stable" | null;
    fingerprint_summary: string;
  };
  provider_binding: IdentityEnvironmentProviderBinding;
  credential_recovery: {
    account_identifier: string | null;
    login_method: LocalIdentityEnvironmentInput["login_method"];
    credential_ref: string | null;
    keychain_ref: string | null;
    local_secret_ref: string | null;
    recovery_actions: HumanVerificationKind[];
    forbidden_plaintext: readonly ["password", "verification_code", "cookie", "session_token"];
  };
  sensitive_material_boundary: MaterialBoundary[];
  import_export_delete: {
    default_export: "safe_summary_only";
    full_export: "explicit_user_action_required";
    local_encryption: "required_for_protected_material";
    delete_confirmation: "required";
    residual_check: "profile_storage_credentials_and_refs";
  };
  consumer_boundary: {
    app: "public_summary_refs_and_recovery_state_only";
    core: "admission_facts_refs_and_blocking_reasons_only";
    lode: "site_requirement_matching_refs_only";
    not_exposed: readonly ["password", "verification_code", "cookie_value", "storage_value", "session_token"];
  };
  risk_boundary: {
    anti_detection_success: "not_claimed";
    target_site_bypass: "not_claimed";
  };
  diagnostics: string[];
}

const allowedSensitiveRefKeys = new Set([
  "account_ref",
  "browser_storage_ref",
  "cookie_jar_ref",
  "credential_ref",
  "keychain_ref",
  "local_secret_ref",
  "profile_storage_ref",
  "proxy_ref",
  "storage_state"
]);
const forbiddenSensitiveTerms = ["password", "token", "cookie", "cookies", "secret", "storage", "raw", "websocketdebuggerurl"];

export function assertNoSensitiveMaterialInput(input: unknown): void {
  visitSensitiveMaterialInput(input, []);
}

export function createLocalIdentityEnvironmentFacts(input: LocalIdentityEnvironmentInput): LocalIdentityEnvironmentFacts {
  assertNoSensitiveMaterialInput(input);
  const identity_environment_ref = input.identity_environment_ref ?? "identity-env_fixture";
  const execution_identity_ref = input.execution_identity_ref ?? `${identity_environment_ref}:execution`;
  const profile_ref = input.profile_ref ?? `${identity_environment_ref}:profile`;
  const loginState = input.login_state ?? "unknown";
  const storageState = input.storage_state ?? "unknown";
  const providerBinding = bindIdentityEnvironmentDefaultProvider({
    ...input,
    execution_identity_ref,
    profile_ref,
    requested_provider_id: input.requested_provider_id
  });
  const recoveryRequired = loginState === "logged_out" || loginState === "expired" || loginState === "unknown" || loginState === "manual_auth_required";
  const humanVerification = input.human_verification ?? (recoveryRequired ? ["manual_login"] : []);
  const manualState = input.manual_authentication_state ?? (recoveryRequired ? "required" : "not_required");
  const diagnostics = [
    ...missing("proxy", input.proxy_ref || input.proxy_label),
    ...missing("region", input.region),
    ...missing("language", input.language),
    ...missing("timezone", input.timezone),
    ...missing("fingerprint_summary", input.fingerprint_summary),
    ...providerBinding.warnings
  ];

  return {
    schema_version: HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA,
    identity_environment_ref,
    execution_identity_ref,
    profile_ref,
    site_binding: {
      site_id: input.site.site_id,
      origin: input.site.origin,
      display_name: input.site.display_name ?? input.site.site_id,
      account_label: input.site.account_identifier ?? null,
      account_ref: input.site.account_ref ?? null
    },
    login_state: {
      state: loginState,
      reason: input.login_state_reason ?? null,
      recovery_required: recoveryRequired,
      manual_authentication_state: manualState,
      human_verification: humanVerification
    },
    browser_storage: {
      profile_storage_ref: redactedRef("profile_storage", input.profile_storage_ref ?? `${profile_ref}:storage`),
      state: storageState,
      cookies_session_state: storageState,
      local_storage_state: storageState,
      indexeddb_state: storageState,
      cleanup_rule: "delete_profile_storage_and_refs",
      residual_check: "required_before_delete_complete"
    },
    environment: {
      proxy: {
        state: input.proxy_ref || input.proxy_label ? "configured" : "missing",
        proxy_ref: input.proxy_ref ?? null,
        label: input.proxy_label ?? null
      },
      region: input.region ?? null,
      geoip_mode: input.geoip_mode ?? null,
      language: input.language ?? null,
      timezone: input.timezone ?? null,
      browser_family: providerBinding.selected_provider_id ?? "unknown",
      user_agent_summary: input.user_agent_summary ?? null,
      viewport: input.viewport ?? null,
      hardware_concurrency: input.hardware_concurrency ?? null,
      device_memory_gb: input.device_memory_gb ?? null,
      gpu_profile: input.gpu_profile ?? null,
      interaction_preset: input.interaction_preset ?? null,
      fingerprint_strategy: input.fingerprint_strategy ?? null,
      fingerprint_summary: input.fingerprint_summary ?? "not_configured"
    },
    provider_binding: providerBinding,
    credential_recovery: {
      account_identifier: input.site.account_identifier ?? null,
      login_method: input.login_method ?? "unknown",
      credential_ref: input.credential_ref ?? null,
      keychain_ref: input.keychain_ref ?? null,
      local_secret_ref: input.local_secret_ref ?? null,
      recovery_actions: humanVerification,
      forbidden_plaintext: ["password", "verification_code", "cookie", "session_token"]
    },
    sensitive_material_boundary: materialBoundary(),
    import_export_delete: {
      default_export: "safe_summary_only",
      full_export: "explicit_user_action_required",
      local_encryption: "required_for_protected_material",
      delete_confirmation: "required",
      residual_check: "profile_storage_credentials_and_refs"
    },
    consumer_boundary: {
      app: "public_summary_refs_and_recovery_state_only",
      core: "admission_facts_refs_and_blocking_reasons_only",
      lode: "site_requirement_matching_refs_only",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
    },
    risk_boundary: {
      anti_detection_success: "not_claimed",
      target_site_bypass: "not_claimed"
    },
    diagnostics
  };
}

function visitSensitiveMaterialInput(value: unknown, path: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSensitiveMaterialInput(item, [...path, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!allowedSensitiveRefKeys.has(key) && forbiddenSensitiveTerms.some((term) => normalizedKey(key).includes(term))) {
      throw new TypeError(`Sensitive local identity material is not accepted at ${[...path, key].join(".")}. Use a *_ref field or status summary instead.`);
    }
    visitSensitiveMaterialInput(child, [...path, key]);
  }
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function missing(name: string, value: unknown): string[] {
  return value ? [] : [`${name}_missing`];
}

function redactedRef(kind: string, value: string): string {
  return `${kind}_ref_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function materialBoundary(): MaterialBoundary[] {
  return [
    {
      material: "identity_environment_summary",
      class: "public_summary",
      app_visibility: "safe_summary",
      core_visibility: "safe_summary",
      lode_visibility: "safe_summary",
      note: "Site binding, readiness, and environment summary can be shown without raw local material."
    },
    {
      material: "account_identifier",
      class: "public_summary",
      app_visibility: "safe_summary",
      core_visibility: "redacted_ref",
      lode_visibility: "redacted_ref",
      note: "Account label is display-only; use account_ref for automation contracts."
    },
    {
      material: "profile_storage_ref",
      class: "local_protected_material",
      app_visibility: "redacted_ref",
      core_visibility: "redacted_ref",
      lode_visibility: "never_export",
      note: "Profile storage, cookies, sessions, and browser storage stay local to Harbor."
    },
    {
      material: "browser_storage_material",
      class: "never_export_material",
      app_visibility: "never_export",
      core_visibility: "never_export",
      lode_visibility: "never_export",
      note: "Raw cookies, tokens, storage values, cache, and browser databases are never exposed."
    },
    {
      material: "credential_ref",
      class: "local_protected_material",
      app_visibility: "redacted_ref",
      core_visibility: "redacted_ref",
      lode_visibility: "never_export",
      note: "Only keychain or local secret references are visible; secret payloads stay local."
    },
    {
      material: "human_verification_state",
      class: "public_summary",
      app_visibility: "safe_summary",
      core_visibility: "safe_summary",
      lode_visibility: "redacted_ref",
      note: "Manual login, QR, 2FA, captcha, and expired-login states are status facts, not bypass capability."
    }
  ];
}
