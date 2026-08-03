import { createHash } from "node:crypto";
import { createIdentityConsistencyFacts } from "./identity-consistency.js";
import {
  applyIdentityEnvironmentConfiguration,
  validateIdentityEnvironmentConfiguration
} from "./identity-environment-configuration.js";
import {
  assertNoSensitiveMaterialInput,
  createLocalIdentityEnvironmentFacts,
  type LocalIdentityEnvironmentFacts
} from "./identity-environment.js";
import {
  acquireProfileStorageOwnership,
  profileStorageHasExternalLock,
  profileStoragePathExists,
  stageProfileStorageCopy,
  type StagedProfileStorageMutation
} from "./profile-storage.js";
import type {
  LocalIdentityEnvironmentPublicRecord,
  ManagedLocalIdentityEnvironmentInput,
  StoredLocalIdentityEnvironmentRecord
} from "./identity-environment-manager.js";
import {
  type IdentityEnvironmentConfigurationUpdate,
  hasOnlyIdentityEnvironmentBusinessInputKeys,
  type IdentityEnvironmentLocalMaterialRefs,
  type IdentityEnvironmentMutationConflict,
  type MaterializedIdentityEnvironmentMutationRequest,
  type IdentityEnvironmentMutationOptions,
  type IdentityEnvironmentMutationRequest,
  type IdentityEnvironmentMutationResult,
  type IdentityEnvironmentMutationStore,
  type StagedIdentityEnvironmentLocalMaterialCopy,
  type StoredIdentityEnvironmentMutationReceipt
} from "./identity-environment-mutation-types.js";
import {
  commitProfileCopy,
  commitProfileDelete,
  commitSimple,
  completed,
  profileFailure,
  reconcileRepair,
  rejected
} from "./identity-environment-mutation-commit.js";

export * from "./identity-environment-mutation-types.js";
export function createStoredIdentityRecord(
  input: ManagedLocalIdentityEnvironmentInput,
  operation: StoredLocalIdentityEnvironmentRecord["operation"],
  created_at = new Date().toISOString()
): StoredLocalIdentityEnvironmentRecord {
  assertNoSensitiveMaterialInput(input);
  const facts = createLocalIdentityEnvironmentFacts(input);
  return {
    schema_version: "harbor-local-identity-environment-store/v0",
    operation,
    created_at,
    updated_at: new Date().toISOString(),
    identity_environment: facts,
    consistency: consistency(facts, input.observed_environment),
    local_material_refs: {
      profile_storage_ref: input.profile_storage_ref ?? `${facts.profile_ref}:storage`,
      cookie_jar_ref: input.cookie_jar_ref ?? null,
      browser_storage_ref: input.browser_storage_ref ?? null,
      credential_ref: facts.credential_recovery.credential_ref,
      keychain_ref: facts.credential_recovery.keychain_ref,
      local_secret_ref: facts.credential_recovery.local_secret_ref
    },
    imported_from: input.imported_from ?? null,
    user_confirmed_session_ref: null,
    repair_state: "clean",
    repair_reasons: []
  };
}

export function executeIdentityEnvironmentMutation(
  request: IdentityEnvironmentMutationRequest,
  store: IdentityEnvironmentMutationStore,
  options: IdentityEnvironmentMutationOptions = {},
  conflict: IdentityEnvironmentMutationConflict | null = null
): IdentityEnvironmentMutationResult {
  if ((request.operation === "create" || request.operation === "import") &&
    !hasOnlyIdentityEnvironmentBusinessInputKeys(request.identity_environment, request.operation)) {
    return rejected(request.operation, null, "invalid_request", false, []);
  }
  try {
    assertNoSensitiveMaterialInput(request);
  } catch {
    return rejected(request.operation, requestRef(request), "invalid_request", false, []);
  }
  if (!request.idempotency_key?.trim() || request.idempotency_key.length > 200) {
    return rejected(request.operation, requestRef(request), "invalid_request", false, []);
  }
  const hash = requestHash(request);
  const receipt = store.receipts.get(request.idempotency_key);
  if (receipt) {
    if (receipt.request_hash !== hash) return rejected(request.operation, requestRef(request), "idempotency_conflict", false, []);
    if (receipt.result.status !== "repair_required") return receipt.result;
  }
  if (conflict) return rejected(request.operation, requestRef(request), conflict.code, true, conflict.recovery_actions);
  const materializedRequest = materializeIdentityEnvironmentMutation(request, options.provider_detection);
  let ownership;
  try {
    ownership = acquireProfileStorageOwnership(profileStorageRefsForMutation(materializedRequest, store, receipt));
  } catch (error) {
    return profileFailure(request.operation, requestRef(request) ?? "unknown", error);
  }
  try {
    if (profileStorageRefsForMutation(materializedRequest, store, receipt).some(profileStorageHasExternalLock)) {
      return rejected(request.operation, requestRef(request), "profile_locked", true, ["close_external_browser", "retry"]);
    }
    if (receipt) return reconcileRepair(receipt, store, options);
    switch (materializedRequest.operation) {
      case "create":
      case "import":
        return createOrImport(materializedRequest, hash, store, options);
      case "edit":
        return edit(materializedRequest, hash, store, options);
      case "copy_full":
      case "copy_environment":
        return copy(materializedRequest, hash, store, options);
      case "remove":
        return remove(materializedRequest, hash, store);
      case "delete":
        return deleteIdentity(materializedRequest, hash, store, options);
    }
  } finally {
    ownership.release();
  }
}

export function materializeIdentityEnvironmentMutation(
  request: IdentityEnvironmentMutationRequest,
  providerDetection: IdentityEnvironmentMutationOptions["provider_detection"] = {}
): MaterializedIdentityEnvironmentMutationRequest {
  if (request.operation === "create" || request.operation === "import") {
    const {
      import_source_ref: importSourceRef,
      identity_environment_ref: _identityRef,
      execution_identity_ref: _executionRef,
      profile_ref: _profileRef,
      profile_storage_ref: _profileStorageRef,
      cookie_jar_ref: _cookieRef,
      browser_storage_ref: _browserStorageRef,
      credential_ref: _credentialRef,
      keychain_ref: _keychainRef,
      local_secret_ref: _localSecretRef,
      imported_from: _importedFrom,
      ...businessInput
    } = request.identity_environment as ManagedLocalIdentityEnvironmentInput & { import_source_ref?: string };
    return {
      ...request,
      identity_environment: {
        ...providerDetection,
        ...businessInput,
        ...(request.operation === "import" ? {
          profile_storage_ref: importSourceRef,
          imported_from: importSourceRef
        } : {}),
        identity_environment_ref: ownerRef("identity-env", request),
        execution_identity_ref: ownerRef("execution-identity", request),
        profile_ref: ownerRef("profile", request)
      }
    };
  }
  if (request.operation === "copy_full" || request.operation === "copy_environment") {
    return {
      ...request,
      target: {
        identity_environment_ref: ownerRef("identity-env", request),
        execution_identity_ref: ownerRef("execution-identity", request),
        profile_ref: ownerRef("profile", request)
      }
    };
  }
  return request as Exclude<IdentityEnvironmentMutationRequest, { operation: "create" } | { operation: "import" } | { operation: "copy_full" | "copy_environment" }>;
}
function createOrImport(
  request: Extract<MaterializedIdentityEnvironmentMutationRequest, { operation: "create" | "import" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore,
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationResult {
  const record = createStoredIdentityRecord(request.identity_environment, request.operation === "create" ? "created" : "imported");
  const ref = record.identity_environment.identity_environment_ref;
  if (request.identity_environment.login_state_reason === "user_confirmed_managed_session") {
    return rejected(request.operation, ref, "invalid_request", false, []);
  }
  if (hasIdentityReferenceConflict(store.records, record)) {
    return rejected(request.operation, ref, request.operation === "import" ? "duplicate_import" : "duplicate_identity", false, []);
  }
  const localMaterialFailure = unavailableLocalMaterialAdapter(record.local_material_refs, options);
  if (localMaterialFailure) {
    return rejected(request.operation, ref, localMaterialFailure, false, ["configure_local_material_adapter", "retry"]);
  }
  if (request.operation === "create" && profileStoragePathExists(record.local_material_refs.profile_storage_ref)) {
    return rejected(request.operation, ref, "profile_storage_exists", false, ["choose_new_target"]);
  }
  if (request.operation === "import" && !profileStoragePathExists(record.local_material_refs.profile_storage_ref)) {
    return rejected(request.operation, ref, "source_material_missing", true, ["locate_source_profile", "retry"]);
  }
  const invalid = validateIdentityEnvironmentConfiguration(request.identity_environment, record.identity_environment, options);
  if (invalid) return rejected(request.operation, ref, invalid, invalid === "proxy_unreachable", ["revise_configuration", "retry"]);
  return commitSimple(store, request.idempotency_key, hash, completed(request.operation, store.public_record(record), null, "registered", "created", "unchanged"), new Map(store.records).set(ref, record));
}
function edit(
  request: Extract<IdentityEnvironmentMutationRequest, { operation: "edit" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore,
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationResult {
  const current = store.records.get(request.identity_environment_ref);
  if (!current) return rejected("edit", request.identity_environment_ref, "identity_environment_missing", true, ["refresh_identity_list"]);
  const facts = clone(current.identity_environment);
  applyIdentityEnvironmentConfiguration(facts, request.configuration);
  const invalid = validateIdentityEnvironmentConfiguration(request.configuration, facts, options);
  if (invalid) return rejected("edit", request.identity_environment_ref, invalid, invalid === "proxy_unreachable", ["revise_configuration", "retry"]);
  const record: StoredLocalIdentityEnvironmentRecord = {
    ...current,
    operation: "updated",
    updated_at: new Date().toISOString(),
    identity_environment: facts,
    consistency: consistency(facts),
    local_material_refs: {
      ...current.local_material_refs,
      ...(request.configuration.proxy_ref !== undefined ? {} : {})
    }
  };
  const records = new Map(store.records).set(request.identity_environment_ref, record);
  return commitSimple(store, request.idempotency_key, hash, completed("edit", store.public_record(record), null, "updated", "unchanged", "unchanged"), records);
}
function copy(
  request: Extract<MaterializedIdentityEnvironmentMutationRequest, { operation: "copy_full" | "copy_environment" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore,
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationResult {
  const source = store.records.get(request.identity_environment_ref);
  if (!source) return rejected(request.operation, request.target.identity_environment_ref, "identity_environment_missing", true, ["refresh_identity_list"]);
  const full = request.operation === "copy_full";
  const material = stageCopiedLocalMaterial(source, request.target, full, options);
  if ("failure" in material) return rejected(request.operation, request.target.identity_environment_ref, material.failure, false, ["configure_local_material_adapter", "retry"]);
  const record = copiedRecord(source, request.target, full, material.target_refs);
  if (hasIdentityReferenceConflict(store.records, record)) {
    material.transaction?.rollback();
    return rejected(request.operation, request.target.identity_environment_ref, "target_in_use", false, ["choose_new_target"]);
  }
  const transactionFactory = options.stage_profile_copy ?? stageProfileStorageCopy;
  let transaction: StagedProfileStorageMutation;
  try {
    transaction = transactionFactory(source.local_material_refs.profile_storage_ref, record.local_material_refs.profile_storage_ref, full ? "full" : "environment_only");
  } catch (error) {
    material.transaction?.rollback();
    return profileFailure(request.operation, request.target.identity_environment_ref, error);
  }
  return commitProfileCopy(request, hash, store, record, combineTransactions(transaction, material.transaction));
}
function remove(
  request: Extract<IdentityEnvironmentMutationRequest, { operation: "remove" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore
): IdentityEnvironmentMutationResult {
  const current = store.records.get(request.identity_environment_ref);
  if (!current) return rejected("remove", request.identity_environment_ref, "identity_environment_missing", true, ["refresh_identity_list"]);
  const result = completed("remove", null, request.identity_environment_ref, "removed", "preserved", "unchanged");
  const records = new Map(store.records);
  records.delete(request.identity_environment_ref);
  return commitSimple(store, request.idempotency_key, hash, result, records);
}
function deleteIdentity(
  request: Extract<IdentityEnvironmentMutationRequest, { operation: "delete" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore,
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationResult {
  if (request.confirmation !== "delete_local_data") return rejected("delete", request.identity_environment_ref, "invalid_request", false, []);
  const current = store.records.get(request.identity_environment_ref);
  if (!current) return rejected("delete", request.identity_environment_ref, "identity_environment_missing", true, ["refresh_identity_list"]);
  if (hasLocalMaterialRefs(current.local_material_refs) && !options.delete_local_material) {
    return rejected("delete", request.identity_environment_ref, "local_material_cleanup_unavailable", false, ["configure_local_material_adapter", "retry"]);
  }
  return commitProfileDelete(request, hash, store, current, options, !options.stage_profile_delete);
}
function copiedRecord(
  source: StoredLocalIdentityEnvironmentRecord,
  target: { identity_environment_ref: string; execution_identity_ref: string; profile_ref: string },
  full: boolean,
  copiedMaterialRefs: Pick<IdentityEnvironmentLocalMaterialRefs, "cookie_jar_ref" | "browser_storage_ref">
): StoredLocalIdentityEnvironmentRecord {
  const facts = clone(source.identity_environment);
  facts.identity_environment_ref = target.identity_environment_ref;
  facts.execution_identity_ref = target.execution_identity_ref;
  facts.profile_ref = target.profile_ref;
  facts.provider_binding = {
    ...facts.provider_binding,
    execution_identity_ref: target.execution_identity_ref,
    profile_ref: target.profile_ref
  };
  const profileStorageRef = `${target.profile_ref}:storage`;
  facts.browser_storage.profile_storage_ref = profileStorageRef;
  if (!full) {
    facts.site_binding.account_label = null;
    facts.site_binding.account_ref = null;
    facts.login_state = { state: "logged_out", reason: "environment_only_copy", recovery_required: true, manual_authentication_state: "required", human_verification: ["manual_login"] };
    facts.browser_storage.state = "cleared";
    facts.browser_storage.cookies_session_state = "cleared";
    facts.browser_storage.local_storage_state = "cleared";
    facts.browser_storage.indexeddb_state = "cleared";
    facts.credential_recovery.account_identifier = null;
    facts.credential_recovery.credential_ref = null;
    facts.credential_recovery.keychain_ref = null;
    facts.credential_recovery.local_secret_ref = null;
  } else {
    facts.login_state.reason = "full_copy_unverified";
    facts.credential_recovery.credential_ref = null;
    facts.credential_recovery.keychain_ref = null;
    facts.credential_recovery.local_secret_ref = null;
  }
  const now = new Date().toISOString();
  return {
    ...source,
    operation: "created",
    created_at: now,
    updated_at: now,
    identity_environment: facts,
    consistency: consistency(facts),
    local_material_refs: {
      profile_storage_ref: profileStorageRef,
      cookie_jar_ref: copiedMaterialRefs.cookie_jar_ref,
      browser_storage_ref: copiedMaterialRefs.browser_storage_ref,
      credential_ref: null,
      keychain_ref: null,
      local_secret_ref: null
    },
    imported_from: source.identity_environment.identity_environment_ref,
    user_confirmed_session_ref: null,
    repair_state: "clean",
    repair_reasons: []
  };
}

function unavailableLocalMaterialAdapter(
  refs: StoredLocalIdentityEnvironmentRecord["local_material_refs"],
  options: IdentityEnvironmentMutationOptions
): "local_material_cleanup_unavailable" | "local_material_copy_unavailable" | null {
  if (hasLocalMaterialRefs(refs) && !options.delete_local_material) return "local_material_cleanup_unavailable";
  if ((refs.cookie_jar_ref || refs.browser_storage_ref) && !options.stage_local_material_copy) return "local_material_copy_unavailable";
  return null;
}

function hasLocalMaterialRefs(refs: StoredLocalIdentityEnvironmentRecord["local_material_refs"]): boolean {
  return Boolean(
    refs.cookie_jar_ref ||
    refs.browser_storage_ref ||
    refs.credential_ref ||
    refs.keychain_ref ||
    refs.local_secret_ref
  );
}

function stageCopiedLocalMaterial(
  source: StoredLocalIdentityEnvironmentRecord,
  target: { identity_environment_ref: string; profile_ref: string },
  full: boolean,
  options: IdentityEnvironmentMutationOptions
): {
  target_refs: Pick<IdentityEnvironmentLocalMaterialRefs, "cookie_jar_ref" | "browser_storage_ref">;
  transaction: StagedIdentityEnvironmentLocalMaterialCopy | null;
} | { failure: "local_material_copy_failed" | "local_material_copy_unavailable" } {
  const sourceRefs = {
    cookie_jar_ref: full ? source.local_material_refs.cookie_jar_ref : null,
    browser_storage_ref: full ? source.local_material_refs.browser_storage_ref : null
  };
  if (!sourceRefs.cookie_jar_ref && !sourceRefs.browser_storage_ref) {
    return { target_refs: sourceRefs, transaction: null };
  }
  if (!options.stage_local_material_copy) return { failure: "local_material_copy_unavailable" };
  try {
    const transaction = options.stage_local_material_copy(sourceRefs, target);
    if ((sourceRefs.cookie_jar_ref && !transaction.target_refs.cookie_jar_ref) ||
      (sourceRefs.browser_storage_ref && !transaction.target_refs.browser_storage_ref)) {
      transaction.rollback();
      return { failure: "local_material_copy_failed" };
    }
    return { target_refs: transaction.target_refs, transaction };
  } catch {
    return { failure: "local_material_copy_failed" };
  }
}

function combineTransactions(
  profile: StagedProfileStorageMutation,
  material: StagedIdentityEnvironmentLocalMaterialCopy | null
): StagedProfileStorageMutation {
  if (!material) return profile;
  return {
    commit: () => {
      profile.commit();
      material.commit();
    },
    rollback: () => {
      const materialRolledBack = material.rollback();
      const profileRolledBack = profile.rollback();
      return materialRolledBack && profileRolledBack;
    },
    residual: () => material.residual() || profile.residual()
  };
}

function profileStorageRefsForMutation(
  request: MaterializedIdentityEnvironmentMutationRequest,
  store: IdentityEnvironmentMutationStore,
  receipt: StoredIdentityEnvironmentMutationReceipt | undefined
): string[] {
  if (receipt?.result.identity_environment_ref) {
    const repair = store.repairs.get(receipt.result.identity_environment_ref);
    return repair ? [repair.profile_storage_ref] : [];
  }
  if (request.operation === "create" || request.operation === "import") {
    const input = request.identity_environment;
    const identityRef = input.identity_environment_ref ?? "identity-env_fixture";
    const profileRef = input.profile_ref ?? `${identityRef}:profile`;
    return [input.profile_storage_ref ?? `${profileRef}:storage`];
  }
  if (!("identity_environment_ref" in request)) return [];
  const source = store.records.get(request.identity_environment_ref);
  if (!source) return [];
  if (request.operation === "copy_full" || request.operation === "copy_environment") {
    return [source.local_material_refs.profile_storage_ref, `${request.target.profile_ref}:storage`];
  }
  return [source.local_material_refs.profile_storage_ref];
}

function ownerRef(kind: string, request: IdentityEnvironmentMutationRequest): string {
  const source = "identity_environment_ref" in request ? request.identity_environment_ref : request.identity_environment.site.origin;
  return `${kind}_${createHash("sha256").update(`${request.operation}\0${request.idempotency_key}\0${source}\0${kind}`).digest("hex").slice(0, 24)}`;
}
function hasIdentityReferenceConflict(records: Map<string, StoredLocalIdentityEnvironmentRecord>, candidate: StoredLocalIdentityEnvironmentRecord): boolean {
  const candidateFacts = candidate.identity_environment;
  for (const record of records.values()) {
    const facts = record.identity_environment;
    const conflict = facts.identity_environment_ref === candidateFacts.identity_environment_ref ||
      facts.execution_identity_ref === candidateFacts.execution_identity_ref ||
      facts.profile_ref === candidateFacts.profile_ref ||
      record.local_material_refs.profile_storage_ref === candidate.local_material_refs.profile_storage_ref;
    if (conflict) return true;
  }
  return false;
}
function consistency(facts: LocalIdentityEnvironmentFacts, observed_environment?: ManagedLocalIdentityEnvironmentInput["observed_environment"]) {
  return createIdentityConsistencyFacts({ identity_environment: facts, observed_environment, risk_events: facts.login_state.recovery_required ? ["login_missing"] : [] });
}
function requestRef(request: IdentityEnvironmentMutationRequest): string | null {
  return "identity_environment_ref" in request ? request.identity_environment_ref : null;
}

function requestHash(request: IdentityEnvironmentMutationRequest): string { return createHash("sha256").update(JSON.stringify(normalize(request))).digest("hex"); }

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== "function" && item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
