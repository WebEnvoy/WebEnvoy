import {
  ProfileStorageMutationError,
  profileStorageHasResiduals,
  profileStoragePathExists,
  repairProfileStorageResiduals,
  stageProfileStorageDelete,
  type StagedProfileStorageMutation
} from "./profile-storage.js";
import type {
  LocalIdentityEnvironmentPublicRecord,
  StoredLocalIdentityEnvironmentRecord
} from "./identity-environment-manager.js";
import {
  HARBOR_IDENTITY_ENVIRONMENT_MUTATION_SCHEMA,
  type IdentityEnvironmentLocalMaterialRefs,
  type IdentityEnvironmentMutationFailureCode,
  type IdentityEnvironmentMutationOperation,
  type IdentityEnvironmentMutationOptions,
  type IdentityEnvironmentMutationRequest,
  type IdentityEnvironmentMutationResult,
  type IdentityEnvironmentMutationStore,
  type MaterializedIdentityEnvironmentMutationRequest,
  type StoredIdentityEnvironmentMutationReceipt,
  type StoredIdentityEnvironmentRepair
} from "./identity-environment-mutation-types.js";

export function commitSimple(
  store: IdentityEnvironmentMutationStore,
  key: string,
  hash: string,
  result: IdentityEnvironmentMutationResult,
  records: Map<string, StoredLocalIdentityEnvironmentRecord>
): IdentityEnvironmentMutationResult {
  const receipts = new Map(store.receipts).set(key, { idempotency_key: key, request_hash: hash, result });
  try {
    store.persist(records, receipts, store.repairs);
  } catch {
    return rejected(result.operation, result.identity_environment_ref, "persistence_failed", true, ["retry"]);
  }
  replace(store.records, records);
  replace(store.receipts, receipts);
  return result;
}

export function commitProfileCopy(
  request: Extract<MaterializedIdentityEnvironmentMutationRequest, { operation: "copy_full" | "copy_environment" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore,
  record: StoredLocalIdentityEnvironmentRecord,
  transaction: StagedProfileStorageMutation
): IdentityEnvironmentMutationResult {
  const ref = record.identity_environment.identity_environment_ref;
  const previousRecords = new Map(store.records);
  const previousReceipts = new Map(store.receipts);
  const previousRepairs = new Map(store.repairs);
  const repair = repairResult(request.operation, record, request.identity_environment_ref);
  const provisional = { ...record, repair_state: "repair_required" as const, repair_reasons: ["profile_mutation_incomplete"] };
  const records = new Map(store.records).set(ref, provisional);
  const copiedMaterialRefs = localMaterialRefsFor(record);
  const repairs = new Map(store.repairs).set(ref, repairRecord(
    request.operation,
    ref,
    record.local_material_refs.profile_storage_ref,
    request.idempotency_key,
    copiedMaterialRefs,
    "repair_required",
    !hasLocalMaterialRefs(copiedMaterialRefs)
  ));
  const receipts = new Map(store.receipts).set(request.idempotency_key, {
    idempotency_key: request.idempotency_key,
    request_hash: hash,
    result: repair
  });
  let provisionalPersisted = false;
  try {
    store.persist(records, receipts, repairs);
    provisionalPersisted = true;
    replace(store.records, records);
    replace(store.receipts, receipts);
    replace(store.repairs, repairs);
    transaction.commit();
  } catch {
    const rolledBack = transaction.rollback();
    if (!provisionalPersisted) return rolledBack ? rejected(request.operation, ref, "persistence_failed", true, ["retry"]) : repair;
    if (!rolledBack) return repair;
    return persistRolledBackFailure(
      store,
      request.idempotency_key,
      hash,
      request.operation,
      ref,
      previousRecords,
      previousReceipts,
      previousRepairs,
      repair
    );
  }
  const result = completed(
    request.operation,
    store.public_record(record),
    request.identity_environment_ref,
    "registered",
    copyDataEffect(request.operation),
    copyLoginEffect(request.operation)
  );
  return finishProfileMutation(store, request.idempotency_key, hash, result, new Map(records).set(ref, record), repairs, ref);
}

export function commitProfileDelete(
  request: Extract<IdentityEnvironmentMutationRequest, { operation: "delete" }>,
  hash: string,
  store: IdentityEnvironmentMutationStore,
  current: StoredLocalIdentityEnvironmentRecord,
  options: IdentityEnvironmentMutationOptions,
  automaticRepair: boolean
): IdentityEnvironmentMutationResult {
  const ref = request.identity_environment_ref;
  const localMaterialRefs = localMaterialRefsFor(current);
  const repair = repairResult("delete", null, ref);
  const provisional = { ...current, repair_state: "repair_required" as const, repair_reasons: ["profile_mutation_incomplete"] };
  const records = new Map(store.records).set(ref, provisional);
  const repairs = new Map(store.repairs).set(ref, repairRecord(
    "delete",
    ref,
    current.local_material_refs.profile_storage_ref,
    request.idempotency_key,
    localMaterialRefs,
    "repair_required",
    automaticRepair
  ));
  const receipts = new Map(store.receipts).set(request.idempotency_key, {
    idempotency_key: request.idempotency_key,
    request_hash: hash,
    result: repair
  });
  try {
    store.persist(records, receipts, repairs);
    replace(store.records, records);
    replace(store.receipts, receipts);
    replace(store.repairs, repairs);
  } catch {
    return rejected("delete", ref, "persistence_failed", true, ["retry"]);
  }
  try {
    const transaction = (options.stage_profile_delete ?? stageProfileStorageDelete)(current.local_material_refs.profile_storage_ref);
    transaction.commit();
  } catch {
    return repair;
  }
  const cleanup = deleteLocalMaterials(localMaterialRefs, options);
  if (cleanup !== "deleted") {
    return persistDeleteRepair(store, request.idempotency_key, hash, ref, records, repairs, cleanup);
  }
  const result = completed("delete", null, ref, "removed", "deleted", "unchanged");
  const completedRecords = new Map(records);
  completedRecords.delete(ref);
  return finishProfileMutation(store, request.idempotency_key, hash, result, completedRecords, repairs, ref);
}

export function reconcileRepair(
  receipt: StoredIdentityEnvironmentMutationReceipt,
  store: IdentityEnvironmentMutationStore,
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationResult {
  if (receipt.result.status !== "repair_required" || !receipt.result.identity_environment_ref) return receipt.result;
  const repair = store.repairs.get(receipt.result.identity_environment_ref);
  if (repair && !repair.automatic_repair) return receipt.result;
  if (!repair) return receipt.result;
  if (repair.operation === "delete" && profileStoragePathExists(repair.profile_storage_ref)) {
    try {
      const transaction = (options.stage_profile_delete ?? stageProfileStorageDelete)(repair.profile_storage_ref);
      transaction.commit();
    } catch {
      return receipt.result;
    }
  }
  if (!repairProfileStorageResiduals(repair.profile_storage_ref)) return receipt.result;
  const clean = repair.operation === "delete"
    ? !profileStoragePathExists(repair.profile_storage_ref) && !profileStorageHasResiduals(repair.profile_storage_ref)
    : profileStoragePathExists(repair.profile_storage_ref) && !profileStorageHasResiduals(repair.profile_storage_ref);
  if (!clean && repair.operation !== "delete" && !profileStorageHasResiduals(repair.profile_storage_ref)) {
    return clearRolledBackRepair(receipt, store, repair);
  }
  if (!clean) return receipt.result;
  if (repair.operation === "delete") {
    const cleanup = deleteLocalMaterials(repair.local_material_refs, options);
    if (cleanup !== "deleted") {
      return persistDeleteRepair(
        store,
        receipt.idempotency_key,
        receipt.request_hash,
        repair.identity_environment_ref,
        new Map(store.records),
        new Map(store.repairs),
        cleanup
      );
    }
  }
  let record = store.records.get(repair.identity_environment_ref);
  const records = new Map(store.records);
  if (repair.operation === "delete") {
    records.delete(repair.identity_environment_ref);
    record = undefined;
  } else if (record) {
    record = { ...record, repair_state: "clean", repair_reasons: [] };
    records.set(repair.identity_environment_ref, record);
  }
  const result = completed(
    repair.operation,
    record ? store.public_record(record) : null,
    receipt.result.source_identity_environment_ref,
    repair.operation === "delete" ? "removed" : "registered",
    repair.operation === "delete" ? "deleted" : copyDataEffect(repair.operation),
    repair.operation === "delete" ? "unchanged" : copyLoginEffect(repair.operation)
  );
  return finishProfileMutation(store, receipt.idempotency_key, receipt.request_hash, result, records, store.repairs, repair.identity_environment_ref);
}

export function completed(
  operation: IdentityEnvironmentMutationOperation,
  record: LocalIdentityEnvironmentPublicRecord | null,
  source: string | null,
  index: IdentityEnvironmentMutationResult["effects"]["index"],
  localData: IdentityEnvironmentMutationResult["effects"]["local_data"],
  login: IdentityEnvironmentMutationResult["effects"]["login_state"]
): IdentityEnvironmentMutationResult {
  return mutationResult(operation, "completed", record?.identity_environment_ref ?? source, source, record, index, localData, login, null);
}

export function rejected(
  operation: IdentityEnvironmentMutationOperation,
  ref: string | null,
  code: IdentityEnvironmentMutationFailureCode,
  retryable: boolean,
  recovery_actions: string[]
): IdentityEnvironmentMutationResult {
  return mutationResult(operation, "rejected", ref, null, null, "unchanged", "unchanged", "unchanged", { code, retryable, recovery_actions });
}

export function profileFailure(
  operation: IdentityEnvironmentMutationOperation,
  ref: string,
  error: unknown
): IdentityEnvironmentMutationResult {
  const code = error instanceof ProfileStorageMutationError ? error.code : "mutation_failed";
  if (code === "profile_locked") return rejected(operation, ref, "profile_locked", true, ["focus_or_stop_session", "retry"]);
  if (code === "source_missing") return rejected(operation, ref, "source_material_missing", true, ["open_source_identity", "retry"]);
  if (code === "target_exists") return rejected(operation, ref, "target_in_use", false, ["choose_new_target"]);
  return rejected(operation, ref, "repair_required", true, ["open_repair"]);
}

function persistRolledBackFailure(
  store: IdentityEnvironmentMutationStore,
  key: string,
  hash: string,
  operation: IdentityEnvironmentMutationOperation,
  ref: string,
  records: Map<string, StoredLocalIdentityEnvironmentRecord>,
  previousReceipts: Map<string, StoredIdentityEnvironmentMutationReceipt>,
  repairs: Map<string, StoredIdentityEnvironmentRepair>,
  fallback: IdentityEnvironmentMutationResult
): IdentityEnvironmentMutationResult {
  const failure = rejected(operation, ref, "mutation_failed", true, ["retry"]);
  const receipts = new Map(previousReceipts).set(key, { idempotency_key: key, request_hash: hash, result: failure });
  try {
    store.persist(records, receipts, repairs);
  } catch {
    return fallback;
  }
  replace(store.records, records);
  replace(store.receipts, receipts);
  replace(store.repairs, repairs);
  return failure;
}

function finishProfileMutation(
  store: IdentityEnvironmentMutationStore,
  key: string,
  hash: string,
  result: IdentityEnvironmentMutationResult,
  records: Map<string, StoredLocalIdentityEnvironmentRecord>,
  repairs: Map<string, StoredIdentityEnvironmentRepair>,
  repairRef: string
): IdentityEnvironmentMutationResult {
  const finalRepairs = new Map(repairs);
  finalRepairs.delete(repairRef);
  const receipts = new Map(store.receipts).set(key, { idempotency_key: key, request_hash: hash, result });
  try {
    store.persist(records, receipts, finalRepairs);
  } catch {
    return store.receipts.get(key)?.result ?? repairResult(result.operation, result.record, result.source_identity_environment_ref);
  }
  replace(store.records, records);
  replace(store.receipts, receipts);
  replace(store.repairs, finalRepairs);
  return result;
}

function clearRolledBackRepair(
  receipt: StoredIdentityEnvironmentMutationReceipt,
  store: IdentityEnvironmentMutationStore,
  repair: StoredIdentityEnvironmentRepair
): IdentityEnvironmentMutationResult {
  const result = rejected(repair.operation, repair.identity_environment_ref, "mutation_failed", true, ["retry_with_new_idempotency_key"]);
  const records = new Map(store.records);
  records.delete(repair.identity_environment_ref);
  const repairs = new Map(store.repairs);
  repairs.delete(repair.identity_environment_ref);
  const receipts = new Map(store.receipts).set(receipt.idempotency_key, { ...receipt, result });
  try {
    store.persist(records, receipts, repairs);
  } catch {
    return receipt.result;
  }
  replace(store.records, records);
  replace(store.receipts, receipts);
  replace(store.repairs, repairs);
  return result;
}

function repairResult(
  operation: IdentityEnvironmentMutationOperation,
  record: StoredLocalIdentityEnvironmentRecord | LocalIdentityEnvironmentPublicRecord | null,
  source: string | null,
  code: IdentityEnvironmentMutationFailureCode = "repair_required"
): IdentityEnvironmentMutationResult {
  const publicRecord = record && "identity_environment" in record ? null : record;
  const ref = record && "identity_environment" in record
    ? record.identity_environment.identity_environment_ref
    : publicRecord?.identity_environment_ref ?? source;
  return mutationResult(operation, "repair_required", ref, source, null, "unchanged", "residual", "unchanged", {
    code,
    retryable: true,
    recovery_actions: ["retry_with_same_idempotency_key", "open_repair"]
  });
}

function mutationResult(
  operation: IdentityEnvironmentMutationOperation,
  status: IdentityEnvironmentMutationResult["status"],
  ref: string | null,
  source: string | null,
  record: LocalIdentityEnvironmentPublicRecord | null,
  index: IdentityEnvironmentMutationResult["effects"]["index"],
  localData: IdentityEnvironmentMutationResult["effects"]["local_data"],
  login: IdentityEnvironmentMutationResult["effects"]["login_state"],
  failure: IdentityEnvironmentMutationResult["failure"]
): IdentityEnvironmentMutationResult {
  return {
    schema_version: HARBOR_IDENTITY_ENVIRONMENT_MUTATION_SCHEMA,
    operation,
    status,
    identity_environment_ref: ref,
    source_identity_environment_ref: source,
    record,
    effects: { index, local_data: localData, login_state: login },
    failure,
    public_boundary: {
      output: "status_and_redacted_refs_only",
      raw_material: "not_exposed",
      not_exposed: ["cookie", "token", "password", "profile_storage", "local_path"]
    }
  };
}

function repairRecord(
  operation: StoredIdentityEnvironmentRepair["operation"],
  ref: string,
  profileRef: string,
  key: string,
  localMaterialRefs: IdentityEnvironmentLocalMaterialRefs,
  failureCode: IdentityEnvironmentMutationFailureCode,
  automaticRepair: boolean
): StoredIdentityEnvironmentRepair {
  return {
    operation,
    identity_environment_ref: ref,
    profile_storage_ref: profileRef,
    idempotency_key: key,
    local_material_refs: localMaterialRefs,
    failure_code: failureCode,
    automatic_repair: automaticRepair
  };
}

function persistDeleteRepair(
  store: IdentityEnvironmentMutationStore,
  key: string,
  hash: string,
  ref: string,
  records: Map<string, StoredLocalIdentityEnvironmentRecord>,
  repairs: Map<string, StoredIdentityEnvironmentRepair>,
  cleanup: "unknown" | "failed"
): IdentityEnvironmentMutationResult {
  const code = cleanup === "failed" ? "local_material_cleanup_failed" : "local_material_cleanup_unavailable";
  const result = repairResult("delete", null, ref, code);
  const currentRepair = repairs.get(ref);
  const nextRepairs = new Map(repairs);
  if (currentRepair) nextRepairs.set(ref, { ...currentRepair, failure_code: code });
  const receipts = new Map(store.receipts).set(key, { idempotency_key: key, request_hash: hash, result });
  try {
    store.persist(records, receipts, nextRepairs);
  } catch {
    return result;
  }
  replace(store.records, records);
  replace(store.receipts, receipts);
  replace(store.repairs, nextRepairs);
  return result;
}

function localMaterialRefsFor(record: StoredLocalIdentityEnvironmentRecord): IdentityEnvironmentLocalMaterialRefs {
  return {
    cookie_jar_ref: record.local_material_refs.cookie_jar_ref,
    browser_storage_ref: record.local_material_refs.browser_storage_ref,
    credential_ref: record.local_material_refs.credential_ref,
    keychain_ref: record.local_material_refs.keychain_ref,
    local_secret_ref: record.local_material_refs.local_secret_ref
  };
}

function hasLocalMaterialRefs(refs: IdentityEnvironmentLocalMaterialRefs): boolean {
  return Boolean(refs.cookie_jar_ref || refs.browser_storage_ref || refs.credential_ref || refs.keychain_ref || refs.local_secret_ref);
}

function deleteLocalMaterials(
  refs: IdentityEnvironmentLocalMaterialRefs,
  options: IdentityEnvironmentMutationOptions
): "deleted" | "unknown" | "failed" {
  if (!hasLocalMaterialRefs(refs)) return "deleted";
  if (!options.delete_local_material) return "unknown";
  try {
    return options.delete_local_material(refs);
  } catch {
    return "failed";
  }
}

function copyDataEffect(operation: "copy_full" | "copy_environment"): "copied" | "excluded" {
  return operation === "copy_full" ? "copied" : "excluded";
}

function copyLoginEffect(operation: "copy_full" | "copy_environment"): "preserved_unverified" | "excluded" {
  return operation === "copy_full" ? "preserved_unverified" : "excluded";
}

function replace<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}
