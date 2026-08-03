import type { BrowserProviderDetectionInput, BrowserProviderId } from "./provider-management.js";
import type { stageProfileStorageCopy, stageProfileStorageDelete } from "./profile-storage.js";
import type {
  LocalIdentityEnvironmentPublicRecord,
  ManagedLocalIdentityEnvironmentInput,
  StoredLocalIdentityEnvironmentRecord
} from "./identity-environment-manager.js";
import type { SiteBindingInput } from "./identity-environment.js";

export const HARBOR_IDENTITY_ENVIRONMENT_MUTATION_SCHEMA = "harbor-identity-environment-mutation/v1";

export type IdentityEnvironmentMutationOperation = "create" | "import" | "edit" | "copy_full" | "copy_environment" | "remove" | "delete";

export interface IdentityEnvironmentConfigurationUpdate {
  provider_id?: BrowserProviderId;
  proxy_ref?: string | null;
  proxy_label?: string | null;
  geoip_mode?: "proxy" | "system" | "disabled";
  region?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  hardware_concurrency?: number;
  device_memory_gb?: number;
  gpu_profile?: string;
  interaction_preset?: "default" | "humanized";
  fingerprint_strategy?: "provider_default" | "stable";
}

export interface MutationBase {
  idempotency_key: string;
}

export const IDENTITY_ENVIRONMENT_BUSINESS_INPUT_KEYS = [
  "site",
  "requested_provider_id",
  "proxy_ref",
  "proxy_label",
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
] as const;

export const IDENTITY_ENVIRONMENT_SITE_INPUT_KEYS = [
  "site_id",
  "origin",
  "display_name",
  "account_identifier",
  "account_ref"
] as const;

export interface IdentityEnvironmentBusinessInput {
  site: SiteBindingInput;
  requested_provider_id?: BrowserProviderId;
  proxy_ref?: string;
  proxy_label?: string;
  geoip_mode?: "proxy" | "system" | "disabled";
  region?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  hardware_concurrency?: number;
  device_memory_gb?: number;
  gpu_profile?: string;
  interaction_preset?: "default" | "humanized";
  fingerprint_strategy?: "provider_default" | "stable";
}

export type IdentityEnvironmentCreateInput = IdentityEnvironmentBusinessInput;
export type IdentityEnvironmentImportInput = IdentityEnvironmentBusinessInput & { import_source_ref: string };

export function hasOnlyIdentityEnvironmentBusinessInputKeys(value: unknown, operation: "create" | "import"): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const allowed = operation === "import"
    ? [...IDENTITY_ENVIRONMENT_BUSINESS_INPUT_KEYS, "import_source_ref"]
    : IDENTITY_ENVIRONMENT_BUSINESS_INPUT_KEYS;
  if (!Object.keys(input).every((key) => allowed.includes(key as never))) return false;
  if (!input.site || typeof input.site !== "object" || Array.isArray(input.site)) return false;
  return Object.keys(input.site).every((key) => IDENTITY_ENVIRONMENT_SITE_INPUT_KEYS.includes(key as never));
}

export type IdentityEnvironmentMutationRequest =
  | (MutationBase & { operation: "create"; identity_environment: IdentityEnvironmentCreateInput })
  | (MutationBase & { operation: "import"; identity_environment: IdentityEnvironmentImportInput })
  | (MutationBase & { operation: "edit"; identity_environment_ref: string; configuration: IdentityEnvironmentConfigurationUpdate })
  | (MutationBase & { operation: "copy_full" | "copy_environment"; identity_environment_ref: string })
  | (MutationBase & { operation: "remove"; identity_environment_ref: string })
  | (MutationBase & { operation: "delete"; identity_environment_ref: string; confirmation: "delete_local_data" });

export type MaterializedIdentityEnvironmentMutationRequest =
  | (MutationBase & {
      operation: "create" | "import";
      identity_environment: ManagedLocalIdentityEnvironmentInput & Required<Pick<
        ManagedLocalIdentityEnvironmentInput,
        "identity_environment_ref" | "execution_identity_ref" | "profile_ref"
      >>;
    })
  | Exclude<IdentityEnvironmentMutationRequest, { operation: "create" } | { operation: "import" } | { operation: "copy_full" | "copy_environment" }>
  | (MutationBase & {
      operation: "copy_full" | "copy_environment";
      identity_environment_ref: string;
      target: { identity_environment_ref: string; execution_identity_ref: string; profile_ref: string };
    });

export type IdentityEnvironmentMutationFailureCode =
  | "active_session"
  | "duplicate_identity"
  | "duplicate_import"
  | "idempotency_conflict"
  | "identity_environment_missing"
  | "invalid_request"
  | "mutation_failed"
  | "persistence_failed"
  | "profile_locked"
  | "profile_storage_exists"
  | "provider_mismatch"
  | "proxy_policy_incompatible"
  | "proxy_resolution_unavailable"
  | "proxy_unreachable"
  | "proxy_validation_unavailable"
  | "repair_required"
  | "source_in_use"
  | "source_material_missing"
  | "target_in_use"
  | "local_material_cleanup_failed"
  | "local_material_cleanup_unavailable"
  | "local_material_copy_failed"
  | "local_material_copy_unavailable"
  | "unsupported_configuration";

export interface IdentityEnvironmentMutationResult {
  schema_version: typeof HARBOR_IDENTITY_ENVIRONMENT_MUTATION_SCHEMA;
  operation: IdentityEnvironmentMutationOperation;
  status: "completed" | "rejected" | "repair_required";
  identity_environment_ref: string | null;
  source_identity_environment_ref: string | null;
  record: LocalIdentityEnvironmentPublicRecord | null;
  effects: {
    index: "registered" | "updated" | "removed" | "unchanged";
    local_data: "created" | "copied" | "excluded" | "preserved" | "deleted" | "unchanged" | "residual";
    login_state: "preserved_unverified" | "excluded" | "unchanged";
  };
  failure: null | { code: IdentityEnvironmentMutationFailureCode; retryable: boolean; recovery_actions: string[] };
  public_boundary: {
    output: "status_and_redacted_refs_only";
    raw_material: "not_exposed";
    not_exposed: readonly ["cookie", "token", "password", "profile_storage", "local_path"];
  };
}

export interface StoredIdentityEnvironmentMutationReceipt {
  idempotency_key: string;
  request_hash: string;
  result: IdentityEnvironmentMutationResult;
}

export interface StoredIdentityEnvironmentRepair {
  identity_environment_ref: string;
  profile_storage_ref: string;
  operation: "copy_full" | "copy_environment" | "delete";
  idempotency_key: string;
  local_material_refs: IdentityEnvironmentLocalMaterialRefs;
  failure_code: IdentityEnvironmentMutationFailureCode;
  automatic_repair: boolean;
}

export interface IdentityEnvironmentLocalMaterialRefs {
  cookie_jar_ref: string | null;
  browser_storage_ref: string | null;
  credential_ref: string | null;
  keychain_ref: string | null;
  local_secret_ref: string | null;
}

export interface StagedIdentityEnvironmentLocalMaterialCopy {
  target_refs: Pick<IdentityEnvironmentLocalMaterialRefs, "cookie_jar_ref" | "browser_storage_ref">;
  commit: () => void;
  rollback: () => boolean;
  residual: () => boolean;
}

export interface IdentityEnvironmentMutationConflict {
  code: "active_session" | "profile_locked" | "profile_storage_exists" | "source_in_use" | "source_material_missing" | "target_in_use";
  recovery_actions: string[];
}

export interface IdentityEnvironmentMutationOptions {
  provider_detection?: BrowserProviderDetectionInput;
  validate_proxy?: (proxy_ref: string) => "reachable" | "unreachable" | "incompatible";
  resolve_proxy?: (proxy_ref: string) => string | null;
  delete_local_material?: (refs: IdentityEnvironmentLocalMaterialRefs) => "deleted" | "unknown" | "failed";
  stage_local_material_copy?: (
    refs: Pick<IdentityEnvironmentLocalMaterialRefs, "cookie_jar_ref" | "browser_storage_ref">,
    target: { identity_environment_ref: string; profile_ref: string }
  ) => StagedIdentityEnvironmentLocalMaterialCopy;
  stage_profile_copy?: typeof stageProfileStorageCopy;
  stage_profile_delete?: typeof stageProfileStorageDelete;
}

export interface IdentityEnvironmentMutationPersistenceState {
  records: StoredLocalIdentityEnvironmentRecord[];
  mutation_receipts: StoredIdentityEnvironmentMutationReceipt[];
  repairs: StoredIdentityEnvironmentRepair[];
}

export interface IdentityEnvironmentMutationStore {
  records: Map<string, StoredLocalIdentityEnvironmentRecord>;
  receipts: Map<string, StoredIdentityEnvironmentMutationReceipt>;
  repairs: Map<string, StoredIdentityEnvironmentRepair>;
  persist: (
    records: Map<string, StoredLocalIdentityEnvironmentRecord>,
    receipts: Map<string, StoredIdentityEnvironmentMutationReceipt>,
    repairs: Map<string, StoredIdentityEnvironmentRepair>
  ) => void;
  public_record: (record: StoredLocalIdentityEnvironmentRecord) => LocalIdentityEnvironmentPublicRecord;
}
