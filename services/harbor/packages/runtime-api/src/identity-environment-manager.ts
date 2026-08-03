import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createIdentityConsistencyFacts, type IdentityConsistencyFacts, type ObservedIdentityEnvironmentFacts } from "./identity-consistency.js";
import {
  assertNoSensitiveMaterialInput,
  HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA,
  type BrowserStorageState,
  type LocalIdentityEnvironmentFacts,
  type LocalIdentityEnvironmentInput,
  type LoginState,
  type ManualAuthenticationState
} from "./identity-environment.js";
import {
  createStoredIdentityRecord,
  executeIdentityEnvironmentMutation,
  type IdentityEnvironmentMutationConflict,
  type IdentityEnvironmentMutationOptions,
  type IdentityEnvironmentMutationPersistenceState,
  type IdentityEnvironmentMutationRequest,
  type IdentityEnvironmentMutationResult,
  type StoredIdentityEnvironmentMutationReceipt,
  type StoredIdentityEnvironmentRepair
} from "./identity-environment-mutations.js";
import {
  fsyncIdentityEnvironmentStoreDirectory,
  internalIdentityEnvironmentFacts,
  replaceMap,
  secureIdentityEnvironmentStoreDirectory,
  secureIdentityEnvironmentStoreFile
} from "./identity-environment-store.js";
import { acquireFileOwnership } from "./profile-storage.js";

export const HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA = "harbor-local-identity-environment-store/v0";

export type ManagedSiteId = "xiaohongshu" | "boss" | string;
export type LocalIdentityEnvironmentOperation = "created" | "imported" | "updated";
export type LocalIdentityEnvironmentReadiness = "ready" | "needs_auth" | "blocked" | "unknown";

export interface LocalIdentityEnvironmentManagerOptions extends IdentityEnvironmentMutationOptions {
  persistence_path?: string;
  persist_state?: (state: IdentityEnvironmentMutationPersistenceState) => void;
  load_state?: () => IdentityEnvironmentMutationPersistenceState | null;
}

export interface ManagedLocalIdentityEnvironmentInput extends LocalIdentityEnvironmentInput {
  site: LocalIdentityEnvironmentInput["site"] & { site_id: ManagedSiteId };
  observed_environment?: ObservedIdentityEnvironmentFacts;
  imported_from?: string;
  cookie_jar_ref?: string;
  browser_storage_ref?: string;
}

export interface LocalIdentityEnvironmentStateUpdate {
  login_state?: LoginState;
  login_state_reason?: string;
  storage_state?: BrowserStorageState;
  manual_authentication_state?: ManualAuthenticationState;
  observed_environment?: ObservedIdentityEnvironmentFacts;
  profile_storage_ref?: string;
  cookie_jar_ref?: string;
  browser_storage_ref?: string;
}

export interface StoredLocalIdentityEnvironmentRecord {
  schema_version: typeof HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA;
  operation: LocalIdentityEnvironmentOperation;
  created_at: string;
  updated_at: string;
  identity_environment: LocalIdentityEnvironmentFacts;
  consistency: IdentityConsistencyFacts;
  local_material_refs: {
    profile_storage_ref: string;
    cookie_jar_ref: string | null;
    browser_storage_ref: string | null;
    credential_ref: string | null;
    keychain_ref: string | null;
    local_secret_ref: string | null;
  };
  imported_from: string | null;
  user_confirmed_session_ref: string | null;
  repair_state: "clean" | "repair_required";
  repair_reasons: string[];
}

export interface LocalIdentityEnvironmentPublicRecord {
  schema_version: typeof HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA;
  identity_environment_ref: string;
  created_at: string;
  updated_at: string;
  operation: LocalIdentityEnvironmentOperation;
  site: {
    site_id: string;
    origin: string;
    display_name: string;
    account_ref: string | null;
  };
  status: {
    readiness: LocalIdentityEnvironmentReadiness;
    login_state: LoginState;
    authentication_provenance: "unknown" | "user_confirmed_managed_session";
    browser_storage_state: BrowserStorageState;
    manual_authentication_state: ManualAuthenticationState;
    recovery_required: boolean;
    blocking_reasons: string[];
    repair_state: "clean" | "repair_required";
    repair_reasons: string[];
  };
  refs: {
    execution_identity_ref: string;
    profile_ref: string;
    profile_storage_ref: string;
    cookie_jar_ref: string | null;
    browser_storage_ref: string | null;
    credential_ref: string | null;
    keychain_ref: string | null;
    local_secret_ref: string | null;
    proxy_ref: string | null;
  };
  environment_summary: {
    provider_id: string | null;
    proxy_state: "configured" | "missing" | "unknown";
    region: string | null;
    language: string | null;
    timezone: string | null;
    browser_family: string;
    fingerprint_summary: string;
    geoip_mode: LocalIdentityEnvironmentFacts["environment"]["geoip_mode"];
    viewport: string | null;
    hardware_concurrency: number | null;
    device_memory_gb: number | null;
    gpu_profile: string | null;
    interaction_preset: LocalIdentityEnvironmentFacts["environment"]["interaction_preset"];
    fingerprint_strategy: LocalIdentityEnvironmentFacts["environment"]["fingerprint_strategy"];
  };
  public_boundary: {
    output: "status_and_redacted_refs_only";
    raw_material: "not_exposed";
    not_exposed: readonly ["password", "verification_code", "cookie_value", "storage_value", "session_token", "raw_profile_data"];
  };
  risk_boundary: LocalIdentityEnvironmentFacts["risk_boundary"];
}

export class LocalIdentityEnvironmentManager {
  private readonly records = new Map<string, StoredLocalIdentityEnvironmentRecord>();
  private readonly receipts = new Map<string, StoredIdentityEnvironmentMutationReceipt>();
  private readonly repairs = new Map<string, StoredIdentityEnvironmentRepair>();

  constructor(private readonly options: LocalIdentityEnvironmentManagerOptions = {}) {
    if (Boolean(options.persist_state) !== Boolean(options.load_state)) {
      throw new TypeError("Custom identity environment persistence must provide load_state and persist_state for records, receipts, and repairs.");
    }
    this.load();
  }

  create(input: ManagedLocalIdentityEnvironmentInput): LocalIdentityEnvironmentPublicRecord {
    return this.withStoreMutation(() => this.upsert(input, "created"));
  }

  importIdentityEnvironment(input: ManagedLocalIdentityEnvironmentInput): LocalIdentityEnvironmentPublicRecord {
    return this.withStoreMutation(() => this.upsert(input, "imported"));
  }

  mutate(request: IdentityEnvironmentMutationRequest, conflict: IdentityEnvironmentMutationConflict | null = null): IdentityEnvironmentMutationResult {
    return this.withStoreMutation(() => executeIdentityEnvironmentMutation(request, {
        records: this.records,
        receipts: this.receipts,
        repairs: this.repairs,
        persist: (records, receipts, repairs) => this.persist(records, receipts, repairs),
        public_record: publicRecord
      }, this.options, conflict));
  }

  update(identity_environment_ref: string, input: LocalIdentityEnvironmentStateUpdate): LocalIdentityEnvironmentPublicRecord | null {
    assertNoSensitiveMaterialInput(input);
    if (input.login_state_reason === USER_CONFIRMED_MANAGED_SESSION_REASON) {
      throw new Error("Reserved authentication provenance can only be set by a managed session confirmation.");
    }
    return this.updateRecord(identity_environment_ref, input);
  }

  completeManualAuthentication(identity_environment_ref: string, runtime_session_ref: string): LocalIdentityEnvironmentPublicRecord | null {
    return this.updateRecord(identity_environment_ref, {
      login_state: "logged_in",
      manual_authentication_state: "completed",
      login_state_reason: USER_CONFIRMED_MANAGED_SESSION_REASON
    }, runtime_session_ref);
  }

  private updateRecord(
    identity_environment_ref: string,
    input: LocalIdentityEnvironmentStateUpdate,
    user_confirmed_session_ref: string | null = null
  ): LocalIdentityEnvironmentPublicRecord | null {
    return this.withStoreMutation(() => {
      assertNoSensitiveMaterialInput(input);
      const current = this.records.get(identity_environment_ref);
      if (!current) return null;
      const facts = snapshot(current.identity_environment);
      const loginState = input.login_state ?? facts.login_state.state;
      const storageState = input.storage_state ?? facts.browser_storage.state;
      facts.login_state = {
        ...facts.login_state,
        state: loginState,
        reason: input.login_state_reason ?? facts.login_state.reason,
        recovery_required: loginState === "logged_out" || loginState === "expired" || loginState === "unknown" || loginState === "manual_auth_required",
        manual_authentication_state: input.manual_authentication_state ?? facts.login_state.manual_authentication_state
      };
      facts.browser_storage = {
        ...facts.browser_storage,
        profile_storage_ref: redactedRequiredRef("profile_storage", input.profile_storage_ref ?? current.local_material_refs.profile_storage_ref),
        state: storageState,
        cookies_session_state: storageState,
        local_storage_state: storageState,
        indexeddb_state: storageState
      };
      const record: StoredLocalIdentityEnvironmentRecord = {
        ...current,
        operation: "updated",
        updated_at: new Date().toISOString(),
        identity_environment: facts,
        consistency: createIdentityConsistencyFacts({
          identity_environment: facts,
          observed_environment: input.observed_environment,
          risk_events: facts.login_state.recovery_required ? ["login_missing"] : []
        }),
        local_material_refs: {
          ...current.local_material_refs,
          profile_storage_ref: input.profile_storage_ref ?? current.local_material_refs.profile_storage_ref,
          cookie_jar_ref: input.cookie_jar_ref ?? current.local_material_refs.cookie_jar_ref,
          browser_storage_ref: input.browser_storage_ref ?? current.local_material_refs.browser_storage_ref
        },
        user_confirmed_session_ref
      };
      const nextRecords = new Map(this.records);
      nextRecords.set(identity_environment_ref, record);
      this.persist(nextRecords);
      this.records.set(identity_environment_ref, record);
      return publicRecord(record);
    });
  }

  get(identity_environment_ref: string): LocalIdentityEnvironmentPublicRecord | null {
    this.refresh();
    const record = this.records.get(identity_environment_ref);
    return record ? publicRecord(record) : null;
  }

  list(): LocalIdentityEnvironmentPublicRecord[] {
    this.refresh();
    return Array.from(this.records.values()).map(publicRecord);
  }

  getFacts(identity_environment_ref: string): LocalIdentityEnvironmentFacts | null {
    this.refresh();
    const record = this.records.get(identity_environment_ref);
    return record ? internalIdentityEnvironmentFacts(record) : null;
  }

  hasUserConfirmedManagedSession(identity_environment_ref: string, runtime_session_ref: string): boolean {
    this.refresh();
    const record = this.records.get(identity_environment_ref);
    const login = record?.identity_environment.login_state;
    return record?.user_confirmed_session_ref === runtime_session_ref &&
      login?.state === "logged_in" &&
      login.reason === USER_CONFIRMED_MANAGED_SESSION_REASON &&
      login.manual_authentication_state === "completed" &&
      !login.recovery_required;
  }

  rebindUserConfirmedManagedSession(identity_environment_ref: string, runtime_session_ref: string): boolean {
    return this.withStoreMutation(() => {
      const current = this.records.get(identity_environment_ref);
      const login = current?.identity_environment.login_state;
      if (!current ||
        login?.state !== "logged_in" ||
        login.reason !== USER_CONFIRMED_MANAGED_SESSION_REASON ||
        login.manual_authentication_state !== "completed" ||
        login.recovery_required
      ) return false;
      const record = { ...current, user_confirmed_session_ref: runtime_session_ref, updated_at: new Date().toISOString() };
      const records = new Map(this.records).set(identity_environment_ref, record);
      this.persist(records);
      this.records.set(identity_environment_ref, record);
      return true;
    });
  }

  delete(identity_environment_ref: string): LocalIdentityEnvironmentPublicRecord | null {
    return this.withStoreMutation(() => {
      const record = this.records.get(identity_environment_ref);
      if (!record) return null;
      const records = new Map(this.records);
      records.delete(identity_environment_ref);
      this.persist(records);
      this.records.delete(identity_environment_ref);
      return publicRecord(record);
    });
  }

  private upsert(input: ManagedLocalIdentityEnvironmentInput, operation: LocalIdentityEnvironmentOperation, created_at = new Date().toISOString()): LocalIdentityEnvironmentPublicRecord {
    const record = createStoredIdentityRecord(input, operation, created_at);
    const facts = record.identity_environment;
    const records = new Map(this.records).set(facts.identity_environment_ref, record);
    this.persist(records);
    this.records.set(facts.identity_environment_ref, record);
    return publicRecord(record);
  }

  private refresh(): void {
    if (this.options.load_state || this.options.persistence_path) this.load();
  }

  private load(): void {
    const backendState = this.options.load_state?.();
    const path = this.persistencePath();
    if (path) secureIdentityEnvironmentStoreDirectory(dirname(path));
    if (path && existsSync(path)) secureIdentityEnvironmentStoreFile(path);
    const parsed = backendState ?? (path && existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8")) as Partial<IdentityEnvironmentMutationPersistenceState>
      : {});
    const records = new Map<string, StoredLocalIdentityEnvironmentRecord>();
    const receipts = new Map<string, StoredIdentityEnvironmentMutationReceipt>();
    const repairs = new Map<string, StoredIdentityEnvironmentRepair>();
    for (const record of parsed.records ?? []) {
      if (record.schema_version === HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA && record.identity_environment.schema_version === HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA) {
        const consistency = createIdentityConsistencyFacts({
          identity_environment: record.identity_environment,
          risk_events: record.identity_environment.login_state.recovery_required ? ["login_missing"] : []
        });
        records.set(record.identity_environment.identity_environment_ref, {
          ...record,
          consistency,
          user_confirmed_session_ref: record.user_confirmed_session_ref ?? null,
          repair_state: record.repair_state ?? "clean",
          repair_reasons: record.repair_reasons ?? []
        });
      }
    }
    for (const receipt of parsed.mutation_receipts ?? []) receipts.set(receipt.idempotency_key, receipt);
    for (const repair of parsed.repairs ?? []) {
      repairs.set(repair.identity_environment_ref, {
        ...repair,
        local_material_refs: {
          cookie_jar_ref: repair.local_material_refs?.cookie_jar_ref ?? null,
          browser_storage_ref: repair.local_material_refs?.browser_storage_ref ?? null,
          credential_ref: repair.local_material_refs?.credential_ref ?? null,
          keychain_ref: repair.local_material_refs?.keychain_ref ?? null,
          local_secret_ref: repair.local_material_refs?.local_secret_ref ?? null
        },
        failure_code: repair.failure_code ?? "repair_required",
        automatic_repair: repair.automatic_repair ?? true
      });
    }
    replaceMap(this.records, records);
    replaceMap(this.receipts, receipts);
    replaceMap(this.repairs, repairs);
  }

  private persist(records = this.records, receipts = this.receipts, repairs = this.repairs): void {
    const state: IdentityEnvironmentMutationPersistenceState = {
      records: Array.from(records.values()),
      mutation_receipts: Array.from(receipts.values()),
      repairs: Array.from(repairs.values())
    };
    if (this.options.persist_state) {
      this.options.persist_state(snapshot(state));
      return;
    }
    const path = this.persistencePath();
    if (!path) return;
    secureIdentityEnvironmentStoreDirectory(dirname(path));
    const tmpPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    let fd: number | null = null;
    try {
      fd = openSync(tmpPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, JSON.stringify({ schema_version: HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA, ...state }, null, 2));
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmpPath, path);
      secureIdentityEnvironmentStoreFile(path);
      fsyncIdentityEnvironmentStoreDirectory(dirname(path));
    } catch (error) {
      if (fd !== null) closeSync(fd);
      rmSync(tmpPath, { force: true });
      throw error;
    }
  }

  private withStoreMutation<T>(action: () => T): T {
    const path = this.persistencePath();
    const ownership = path ? acquireFileOwnership(`${path}.ownership-lock`, 5000) : null;
    try {
      this.refresh();
      return action();
    } finally {
      ownership?.release();
    }
  }

  private persistencePath(): string | null {
    return this.options.persistence_path ? resolve(this.options.persistence_path) : null;
  }
}

function publicRecord(record: StoredLocalIdentityEnvironmentRecord): LocalIdentityEnvironmentPublicRecord {
  const facts = record.identity_environment;
  return {
    schema_version: HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA,
    identity_environment_ref: facts.identity_environment_ref,
    created_at: record.created_at,
    updated_at: record.updated_at,
    operation: record.operation,
    site: {
      site_id: facts.site_binding.site_id,
      origin: facts.site_binding.origin,
      display_name: facts.site_binding.display_name,
      account_ref: facts.site_binding.account_ref
    },
    status: {
      readiness: record.repair_state === "repair_required" ? "blocked" : readiness(facts, record.consistency),
      login_state: facts.login_state.state,
      authentication_provenance: facts.login_state.reason === USER_CONFIRMED_MANAGED_SESSION_REASON && record.user_confirmed_session_ref
        ? "user_confirmed_managed_session"
        : "unknown",
      browser_storage_state: facts.browser_storage.state,
      manual_authentication_state: facts.login_state.manual_authentication_state,
      recovery_required: facts.login_state.recovery_required,
      blocking_reasons: record.consistency.readiness.blocking_reasons,
      repair_state: record.repair_state,
      repair_reasons: record.repair_reasons
    },
    refs: {
      execution_identity_ref: facts.execution_identity_ref,
      profile_ref: facts.profile_ref,
      profile_storage_ref: redactedRequiredRef("profile_storage", facts.browser_storage.profile_storage_ref),
      cookie_jar_ref: redactedRef("cookie_jar", record.local_material_refs.cookie_jar_ref),
      browser_storage_ref: redactedRef("browser_storage", record.local_material_refs.browser_storage_ref),
      credential_ref: redactedRef("credential", facts.credential_recovery.credential_ref),
      keychain_ref: redactedRef("keychain", facts.credential_recovery.keychain_ref),
      local_secret_ref: redactedRef("local_secret", facts.credential_recovery.local_secret_ref),
      proxy_ref: redactedRef("proxy", facts.environment.proxy.proxy_ref)
    },
    environment_summary: {
      provider_id: facts.provider_binding.selected_provider_id,
      proxy_state: facts.environment.proxy.state,
      region: facts.environment.region,
      language: facts.environment.language,
      timezone: facts.environment.timezone,
      browser_family: facts.environment.browser_family,
      fingerprint_summary: facts.environment.fingerprint_summary,
      geoip_mode: facts.environment.geoip_mode,
      viewport: facts.environment.viewport,
      hardware_concurrency: facts.environment.hardware_concurrency,
      device_memory_gb: facts.environment.device_memory_gb,
      gpu_profile: facts.environment.gpu_profile,
      interaction_preset: facts.environment.interaction_preset,
      fingerprint_strategy: facts.environment.fingerprint_strategy
    },
    public_boundary: {
      output: "status_and_redacted_refs_only",
      raw_material: "not_exposed",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token", "raw_profile_data"]
    },
    risk_boundary: facts.risk_boundary
  };
}

const USER_CONFIRMED_MANAGED_SESSION_REASON = "user_confirmed_managed_session";

function readiness(facts: LocalIdentityEnvironmentFacts, consistency: IdentityConsistencyFacts): LocalIdentityEnvironmentReadiness {
  if (facts.login_state.recovery_required) return "needs_auth";
  if (facts.login_state.reason === "full_copy_unverified") return "unknown";
  if (consistency.readiness.state === "blocked") return "blocked";
  // A user-confirmed login resolves the authentication gate, not provider limitations.
  if (facts.login_state.reason === USER_CONFIRMED_MANAGED_SESSION_REASON && facts.login_state.manual_authentication_state === "completed") return "ready";
  return consistency.readiness.state === "ready" ? "ready" : "unknown";
}

function redactedRef(kind: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return `${kind}_ref_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function redactedRequiredRef(kind: string, value: string): string {
  return redactedRef(kind, value)!;
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
