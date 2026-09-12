import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalIdentityEnvironmentFacts } from "./identity-environment.js";
import { acquireFileOwnership, acquireProfileStorageOwnership, profileStorageHasExternalLock, profileStoragePath } from "./profile-storage.js";

export const HARBOR_PROFILE_RECOVERY_SCHEMA = "harbor-profile-recovery/v1";
export const HARBOR_PROFILE_RECOVERY_BACKUP_SCHEMA = "webenvoy.profile-recovery-backup.v1";
export const HARBOR_PROFILE_RECOVERY_OPERATION_SCHEMA = "harbor.profile-recovery-operation.v1";
const CAMOUFOX_BUNDLE = ".webenvoy-camoufox-environment.v1.json";
const CAMOUFOX_BUNDLE_VALIDATOR = "camoufox-bundle-validator.py";
const PROFILE_RESIDUE = new Set(["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket", ".parentlock", "parent.lock", "lock", ".harbor-profile-lock"]);
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type RecoveryProfileFacts = {
  facts: LocalIdentityEnvironmentFacts;
  in_use: () => boolean;
  account_bindings?: readonly unknown[];
};

export type ProfileRecoveryInspection = {
  schema_version: typeof HARBOR_PROFILE_RECOVERY_SCHEMA;
  status: "completed" | "manual_recovery_required" | "unavailable";
  profile_ref: string;
  identity_environment_ref: string;
  storage_present: boolean;
  storage_fingerprint: string | null;
  environment_fingerprint: string;
  owner_binding: string;
  material_version: string;
  compatibility: RecoveryCompatibility;
  continuity: "matchable" | "missing_bundle" | "unknown";
  active_instance: boolean;
  backups: ProfileRecoveryBackupSummary[];
  failure?: { code: string; recovery_hint: string };
};

export type RecoveryCompatibility = {
  provider_id: string | null;
  provider_version: string | null;
  bundle_schema_version: 1;
  camoufox_version: string | null;
  browser_version: string | null;
  properties_sha256: string | null;
};

export type ProfileRecoveryBackupSummary = {
  schema_version: typeof HARBOR_PROFILE_RECOVERY_BACKUP_SCHEMA;
  backup_ref: string;
  profile_ref: string;
  identity_environment_ref: string;
  created_at: string;
  backup_time: string;
  storage_fingerprint: string;
  environment_fingerprint: string;
  material_version: string;
  owner_binding: string;
  provider_id: string | null;
  compatibility: RecoveryCompatibility;
  scope: "profile_storage_and_matching_environment_bundle";
  private: true;
};

export type ProfileRecoveryPlanInput = {
  idempotency_key: string;
  operation_ref: string;
  profile_ref: string;
  backup_ref: string;
  current_material_fingerprint?: string;
};

export type ProfileRecoveryApplyInput = {
  idempotency_key: string;
  operation_ref: string;
  plan: {
    schema_version: "webenvoy.profile-recovery-plan.v1";
    plan_ref: string;
    profile_ref: string;
    backup_ref: string;
    backup_time: string;
    current_material_fingerprint: string;
    backup_material_fingerprint: string;
    current_environment_fingerprint: string;
    backup_environment_fingerprint: string;
    current_material_version: string;
    backup_material_version: string;
    owner_binding: string;
    scope: "profile_storage_and_matching_environment_bundle";
    compatibility: RecoveryCompatibility;
    expires_at: string;
  };
  confirmation: {
    schema_version: "webenvoy.profile-recovery-confirmation.v1";
    confirmation_ref: string;
    plan_ref: string;
    confirmed_at: string;
    confirmed_by: "owner";
    idempotency_key: string;
    decision: "apply";
  };
};

export type ProfileRecoveryOperation = {
  schema_version: typeof HARBOR_PROFILE_RECOVERY_OPERATION_SCHEMA;
  operation_ref: string;
  idempotency_hash: string;
  request_hash: string;
  kind: "backup" | "plan" | "apply";
  status: "running" | "completed" | "rejected" | "unknown_outcome" | "manual_recovery_required";
  profile_ref: string;
  backup_ref?: string;
  plan_ref?: string;
  created_at: string;
  updated_at: string;
  result?: Record<string, unknown>;
  failure?: { code: string; recovery_hint: string };
};

type State = { schema_version: typeof HARBOR_PROFILE_RECOVERY_SCHEMA; backups: ProfileRecoveryBackupSummary[]; operations: ProfileRecoveryOperation[] };

export class ProfileRecoveryError extends Error {
  constructor(readonly code: string, readonly recovery_hint = "inspect_profile_and_request_new_plan") { super(code); }
}

function fail(code: string, hint?: string): never { throw new ProfileRecoveryError(code, hint); }
function now(): string { return new Date().toISOString(); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) return fail("recovery_ref_invalid"); return value; }
function key(value: unknown): string { if (typeof value !== "string" || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return fail("recovery_idempotency_key_invalid"); return value; }
function sha(value: unknown): string { if (typeof value !== "string" || !SHA256.test(value)) return fail("recovery_fingerprint_invalid"); return value; }
function realDirectory(path: string): boolean { try { const entry = lstatSync(path); return entry.isDirectory() && !entry.isSymbolicLink(); } catch { return false; } }
function secureDirectory(path: string): void {
  if (existsSync(path) && !realDirectory(path)) fail("recovery_path_unsafe");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
function profileRoot(profileStorageRef: string): string { return dirname(profileStoragePath(profileStorageRef)); }
function recoveryRoot(profileStorageRef: string): string { const root = join(profileRoot(profileStorageRef), ".recovery"); secureDirectory(root); return root; }
function operationPath(profileStorageRef: string): string { return join(recoveryRoot(profileStorageRef), "operations.json"); }
function backupRoot(profileStorageRef: string): string { const root = join(recoveryRoot(profileStorageRef), "backups"); secureDirectory(root); return root; }
function backupId(backupRef: string): string { const match = /^backup:([0-9a-f-]{36})$/.exec(backupRef); if (!match) return fail("recovery_backup_ref_invalid"); return match[1]!; }
function operationId(operationRef: string): string { const match = /^recovery:([A-Za-z0-9._-]{1,80})$/.exec(operationRef); if (!match) return fail("recovery_operation_ref_invalid"); return match[1]!; }
function operationLock(profileStorageRef: string): string { return join(recoveryRoot(profileStorageRef), "operations.lock"); }

function loadState(profileStorageRef: string): State {
  try {
    if (!lstatSync(operationPath(profileStorageRef)).isFile()) return fail("recovery_store_invalid");
    const state = JSON.parse(readFileSync(operationPath(profileStorageRef), "utf8")) as State;
    if (state.schema_version !== HARBOR_PROFILE_RECOVERY_SCHEMA || !Array.isArray(state.backups) || !Array.isArray(state.operations)
        || state.operations.some(operation => !operation || operation.schema_version !== HARBOR_PROFILE_RECOVERY_OPERATION_SCHEMA
          || !["backup", "plan", "apply"].includes(operation.kind) || !["running", "completed", "rejected", "unknown_outcome", "manual_recovery_required"].includes(operation.status)
          || typeof operation.operation_ref !== "string" || !/^recovery:[A-Za-z0-9._-]{1,80}$/.test(operation.operation_ref)
          || typeof operation.profile_ref !== "string" || !REF.test(operation.profile_ref) || !SHA256.test(operation.idempotency_hash) || !SHA256.test(operation.request_hash)
          || !Number.isFinite(Date.parse(operation.created_at)) || !Number.isFinite(Date.parse(operation.updated_at)))) return fail("recovery_store_invalid");
    return state;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { schema_version: HARBOR_PROFILE_RECOVERY_SCHEMA, backups: [], operations: [] };
    if (error instanceof ProfileRecoveryError) throw error;
    return fail("recovery_store_invalid");
  }
}
function saveState(profileStorageRef: string, state: State): void {
  const path = operationPath(profileStorageRef), temporary = `${path}.${randomUUID()}.tmp`;
  secureDirectory(dirname(path));
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
    const file = openSync(temporary, "r");
    try { fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { rmSync(temporary, { force: true }); }
}
function withState<T>(profileStorageRef: string, action: (state: State) => T): T {
  const lock = acquireFileOwnership(operationLock(profileStorageRef), 5_000);
  try { const state = loadState(profileStorageRef); const result = action(state); saveState(profileStorageRef, state); return result; } finally { lock.release(); }
}

function walkHash(path: string, relative = ""): string {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) fail("recovery_symlink_refused");
  if (entry.isDirectory()) {
    const children = readdirSync(path).filter(name => relative !== "" || !PROFILE_RESIDUE.has(name)).sort();
    return hash(`dir:${relative}:${children.map(name => `${name}:${walkHash(join(path, name), relative ? `${relative}/${name}` : name)}`).join("|")}`);
  }
  if (!entry.isFile() || entry.size > 512 * 1024 * 1024) fail("recovery_profile_entry_unsupported");
  return hash(`file:${relative}:${entry.size}:${readFileSync(path).toString("base64")}`);
}
function profileFingerprint(path: string): string { return realDirectory(path) ? walkHash(path) : fail("recovery_profile_missing"); }
function nonResidueEntries(path: string): string[] { return realDirectory(path) ? readdirSync(path).filter(name => !PROFILE_RESIDUE.has(name)) : []; }
function clearResidue(path: string): void { for (const name of PROFILE_RESIDUE) rmSync(join(path, name), { recursive: true, force: true }); }
function copyTree(source: string, target: string): void {
  if (!realDirectory(source)) fail("recovery_backup_missing");
  if (existsSync(target)) fail("recovery_target_exists");
  secureDirectory(dirname(target));
  mkdirSync(target, { mode: 0o700 });
  try {
    cpSync(source, target, { recursive: true, filter: value => { const item = lstatSync(value); if (item.isSymbolicLink()) throw new ProfileRecoveryError("recovery_symlink_refused"); return true; } });
    clearResidue(target);
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    if (error instanceof ProfileRecoveryError) throw error;
    fail("recovery_copy_failed");
  }
}
function compatibility(facts: LocalIdentityEnvironmentFacts): RecoveryCompatibility {
  const provider = facts.provider_binding.selected_provider;
  let pins: Record<string, unknown> = {};
  if (provider?.provider_id === "camoufox") {
    try { pins = readCamoufoxBundleFacts(profileStoragePath(facts.browser_storage.profile_storage_ref)); } catch { /* Damaged current materials can still be matched to a validated backup. */ }
  }
  return {
    provider_id: facts.provider_binding.selected_provider_id,
    provider_version: provider?.install.version ?? null,
    bundle_schema_version: 1,
    camoufox_version: typeof pins.camoufox_version === "string" ? pins.camoufox_version : null,
    browser_version: typeof pins.browser_version === "string" ? pins.browser_version : null,
    properties_sha256: typeof pins.properties_sha256 === "string" ? pins.properties_sha256 : null
  };
}
function environmentFingerprint(facts: LocalIdentityEnvironmentFacts): string {
  return hash(canonical(environmentSnapshot(facts)));
}
function environmentSnapshot(facts: LocalIdentityEnvironmentFacts): Record<string, unknown> {
  return { provider_binding: { selected_provider_id: facts.provider_binding.selected_provider_id, selected_provider_version: facts.provider_binding.selected_provider?.install.version ?? null }, environment: facts.environment };
}
function ownerBinding(profile: RecoveryProfileFacts): string { const facts = profile.facts; return hash(canonical({ profile_ref: facts.profile_ref, identity_environment_ref: facts.identity_environment_ref, execution_identity_ref: facts.execution_identity_ref, profile_storage_ref: facts.browser_storage.profile_storage_ref, site_binding: facts.site_binding, account_bindings: profile.account_bindings ?? [] })); }
function materialVersion(facts: LocalIdentityEnvironmentFacts): string { return `profile-material:v1:${facts.provider_binding.selected_provider_id ?? "unknown"}:${facts.provider_binding.selected_provider?.install.version ?? "unknown"}`; }
function publicFailure(error: unknown): { code: string; recovery_hint: string } {
  return error instanceof ProfileRecoveryError ? { code: error.code, recovery_hint: error.recovery_hint } : { code: "recovery_execution_failed", recovery_hint: "inspect_operation_and_request_new_plan" };
}
function backupFor(state: State, backupRef: string): ProfileRecoveryBackupSummary { return state.backups.find(item => item.backup_ref === backupRef) ?? fail("recovery_backup_not_found"); }
function backupPath(profileStorageRef: string, backupRef: string): string { return join(backupRoot(profileStorageRef), backupId(backupRef), "profile"); }
function backupMetadataPath(profileStorageRef: string, backupRef: string): string { return join(backupRoot(profileStorageRef), backupId(backupRef), "backup.json"); }
function backupEnvironmentPath(profileStorageRef: string, backupRef: string): string { return join(backupRoot(profileStorageRef), backupId(backupRef), "environment.json"); }
function readBackup(profileStorageRef: string, profileRef: string, backupRef: string): ProfileRecoveryBackupSummary {
  try {
    if (!realDirectory(join(backupRoot(profileStorageRef), backupId(backupRef))) || !lstatSync(backupMetadataPath(profileStorageRef, backupRef)).isFile() || !lstatSync(backupEnvironmentPath(profileStorageRef, backupRef)).isFile()) return fail("recovery_symlink_refused");
    const metadata = JSON.parse(readFileSync(backupMetadataPath(profileStorageRef, backupRef), "utf8")) as ProfileRecoveryBackupSummary;
    const fields = ["schema_version", "backup_ref", "profile_ref", "identity_environment_ref", "created_at", "backup_time", "storage_fingerprint", "environment_fingerprint", "material_version", "owner_binding", "provider_id", "compatibility", "scope", "private"];
    if (!metadata || typeof metadata !== "object" || Object.keys(metadata).length !== fields.length || fields.some(field => !(field in metadata)) ||
      metadata.schema_version !== HARBOR_PROFILE_RECOVERY_BACKUP_SCHEMA || metadata.backup_ref !== backupRef || metadata.profile_ref !== profileRef ||
      typeof metadata.identity_environment_ref !== "string" || !metadata.identity_environment_ref || typeof metadata.created_at !== "string" || !Number.isFinite(Date.parse(metadata.created_at)) ||
      typeof metadata.backup_time !== "string" || !Number.isFinite(Date.parse(metadata.backup_time)) || !SHA256.test(metadata.storage_fingerprint) || !SHA256.test(metadata.environment_fingerprint) ||
      typeof metadata.material_version !== "string" || !metadata.material_version || !SHA256.test(metadata.owner_binding) ||
      (metadata.provider_id !== null && typeof metadata.provider_id !== "string") || !isCompatibility(metadata.compatibility) ||
      metadata.scope !== "profile_storage_and_matching_environment_bundle" || metadata.private !== true) return fail("recovery_backup_invalid");
    const snapshot = JSON.parse(readFileSync(backupEnvironmentPath(profileStorageRef, backupRef), "utf8")) as Record<string, unknown>;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || hash(canonical(snapshot)) !== metadata.environment_fingerprint) return fail("recovery_backup_invalid");
    return metadata;
  } catch (error) {
    if (error instanceof ProfileRecoveryError) throw error;
    return fail("recovery_backup_invalid");
  }
}
function backupEnvironment(profile: RecoveryProfileFacts, backupRef: string): LocalIdentityEnvironmentFacts["environment"] {
  const value = JSON.parse(readFileSync(backupEnvironmentPath(profile.facts.browser_storage.profile_storage_ref, backupRef), "utf8"));
  const environment = value?.environment;
  const current = environmentSnapshot(profile.facts);
  const staticEnvironment = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([name]) => !["language", "timezone", "viewport"].includes(name)));
  if (!isDeepStrictEqual(value?.provider_binding, current.provider_binding) || !environment || typeof environment !== "object" || Array.isArray(environment)
      || !isDeepStrictEqual(staticEnvironment(environment), staticEnvironment(profile.facts.environment))
      || ["language", "timezone", "viewport"].some(name => environment[name] !== null && typeof environment[name] !== "string")) return fail("recovery_environment_incompatible");
  return environment;
}

export function assertNoUnfinishedProfileRecovery(profileStorageRef: string, profileRef: string): void {
  const path = join(dirname(profileStoragePath(profileStorageRef)), ".recovery", "operations.json");
  if (!existsSync(path)) return;
  const state = loadState(profileStorageRef);
  if (activeResidue(profileStorageRef) || state.operations.some(operation => operation.profile_ref === profileRef && operation.kind === "apply" && ["running", "unknown_outcome", "manual_recovery_required"].includes(operation.status))) fail("recovery_operation_unfinished", "query_the_original_recovery_operation_without_starting_the_profile");
}
function activeResidue(profileStorageRef: string): boolean {
  const path = profileStoragePath(profileStorageRef), parent = dirname(path);
  if (!existsSync(parent)) return false;
  const prefix = path.slice(parent.length + 1);
  // A recovery-before copy is intentionally retained as historical evidence;
  // only an unfinished staging tree means the Profile is still mid-switch.
  return readdirSync(parent).some(name => name.startsWith(`${prefix}.recovery-stage-`)) ||
    (!realDirectory(path) && readdirSync(parent).some(name => name.startsWith(`${prefix}.recovery-before-`)));
}
function validateCompatibility(current: RecoveryCompatibility, backup: RecoveryCompatibility): void {
  if (current.provider_id !== backup.provider_id || current.bundle_schema_version !== backup.bundle_schema_version || current.provider_version !== backup.provider_version) fail("recovery_provider_incompatible", "restore_a_matching_provider_profile_backup");
}
function canRecoverDamagedCamoufoxInspection(inspection: ProfileRecoveryInspection): boolean {
  return inspection.status === "completed" || (inspection.status === "manual_recovery_required" &&
    (inspection.failure?.code === "camoufox_bundle_missing" || inspection.failure?.code === "camoufox_bundle_invalid" || inspection.failure?.code === "camoufox_bundle_incompatible"));
}
function isCompatibility(value: unknown): value is RecoveryCompatibility {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const compatibility = value as Partial<RecoveryCompatibility>;
  return (compatibility.provider_id === null || typeof compatibility.provider_id === "string") &&
    (compatibility.provider_version === null || typeof compatibility.provider_version === "string") &&
    compatibility.bundle_schema_version === 1 &&
    (compatibility.camoufox_version === null || typeof compatibility.camoufox_version === "string") &&
    (compatibility.browser_version === null || typeof compatibility.browser_version === "string") &&
    (compatibility.properties_sha256 === null || (typeof compatibility.properties_sha256 === "string" && SHA256.test(compatibility.properties_sha256)));
}
function readCamoufoxBundleFacts(profileDirectory: string): Record<string, unknown> {
    const helperPath = join(dirname(fileURLToPath(import.meta.url)), CAMOUFOX_BUNDLE_VALIDATOR);
    const pythonPath = process.env.HARBOR_CAMOUFOX_PYTHON || process.env.PYTHON || "python3";
    const output = execFileSync(pythonPath, ["-B", helperPath], {
      input: `${JSON.stringify({ id: 1, op: "validate_environment_bundle", profile_dir: profileDirectory })}\n`,
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    });
    const line = output.trim().split(/\r?\n/).at(-1);
    if (!line) throw new Error("camoufox_bundle_invalid");
    const response = JSON.parse(line) as { status?: unknown; result?: Record<string, unknown> };
    if (response.status !== "ok" || !response.result || response.result.valid !== true || response.result.provider !== "camoufox") throw new Error("camoufox_bundle_invalid");
    return response.result;
}
function validateCamoufoxBundle(path: string, expected: RecoveryCompatibility): string | null {
  try {
    const result = readCamoufoxBundleFacts(dirname(path));
    if ((expected.camoufox_version && result.camoufox_version !== expected.camoufox_version) || (expected.browser_version && result.browser_version !== expected.browser_version) ||
      (expected.properties_sha256 && result.properties_sha256 !== expected.properties_sha256)) return "camoufox_bundle_incompatible";
    return null;
  } catch { return "camoufox_bundle_invalid"; }
}

function restoreOriginalProfile(source: string, before: string, expectedFingerprint: string): boolean {
  try {
    if (!realDirectory(before)) return false;
    if (existsSync(source)) rmSync(source, { recursive: true, force: true });
    renameSync(before, source);
    return realDirectory(source) && profileFingerprint(source) === expectedFingerprint;
  } catch {
    return false;
  }
}

function inspectProfile(profile: RecoveryProfileFacts, backups: readonly ProfileRecoveryBackupSummary[]): ProfileRecoveryInspection {
  const facts = profile.facts;
  const storageRef = facts.browser_storage.profile_storage_ref;
  const path = profileStoragePath(storageRef);
  const present = realDirectory(path);
  const bundlePresent = existsSync(join(path, CAMOUFOX_BUNDLE));
  const camoufox = facts.provider_binding.selected_provider_id === "camoufox";
  const bundleFailure = camoufox && bundlePresent ? validateCamoufoxBundle(join(path, CAMOUFOX_BUNDLE), compatibility(facts)) : null;
  const missingBundle = camoufox && present && nonResidueEntries(path).length > 0 && !bundlePresent;
  return {
    schema_version: HARBOR_PROFILE_RECOVERY_SCHEMA,
    status: missingBundle || bundleFailure ? "manual_recovery_required" : "completed",
    profile_ref: facts.profile_ref,
    identity_environment_ref: facts.identity_environment_ref,
    storage_present: present,
    storage_fingerprint: present ? profileFingerprint(path) : null,
    environment_fingerprint: environmentFingerprint(facts),
    owner_binding: ownerBinding(profile),
    material_version: materialVersion(facts),
    compatibility: compatibility(facts),
    continuity: missingBundle ? "missing_bundle" : bundleFailure ? "unknown" : bundlePresent ? "matchable" : "unknown",
    active_instance: profile.in_use() || profileStorageHasExternalLock(storageRef) || activeResidue(storageRef),
    backups: backups.filter(item => item.profile_ref === facts.profile_ref).map(item => ({ ...item })),
    ...((missingBundle || bundleFailure) ? { failure: { code: bundleFailure ?? "camoufox_bundle_missing", recovery_hint: "use_a_matching_profile_backup_or_manual_recovery" } } : {})
  };
}

export class ProfileRecoveryManager {
  constructor(private readonly options: { persistence_path?: string; resolveProfile: (profileRef: string) => RecoveryProfileFacts | null; listProfiles?: () => RecoveryProfileFacts[]; restoreEnvironment?: (profile: RecoveryProfileFacts, environment: LocalIdentityEnvironmentFacts["environment"]) => void }) {}

  inspect(profileRefInput: unknown): ProfileRecoveryInspection {
    const profileRef = ref(profileRefInput), profile = this.options.resolveProfile(profileRef);
    if (!profile) return fail("recovery_profile_not_found");
    const storageRef = profile.facts.browser_storage.profile_storage_ref;
    return withState(storageRef, state => {
      const inspection = inspectProfile(profile, state.backups);
      if (state.operations.some(item => item.profile_ref === profileRef && item.kind === "apply" && ["running", "unknown_outcome", "manual_recovery_required"].includes(item.status))) return { ...inspection, status: "manual_recovery_required" as const, active_instance: true, failure: { code: "recovery_operation_unfinished", recovery_hint: "query_the_original_recovery_operation_without_starting_the_profile" } };
      return inspection;
    });
  }

  backup(input: { idempotency_key: unknown; operation_ref: unknown; profile_ref: unknown }): ProfileRecoveryOperation {
    const idempotencyKey = key(input.idempotency_key), operationRef = `recovery:${operationId(String(input.operation_ref))}`, profileRef = ref(input.profile_ref), initialProfile = this.options.resolveProfile(profileRef);
    if (!initialProfile) return this.rejected(operationRef, idempotencyKey, "backup", profileRef, "recovery_profile_not_found");
    let profile = initialProfile;
    const storageRef = profile.facts.browser_storage.profile_storage_ref;
    const requestHash = hash(canonical({ kind: "backup", profile_ref: profileRef }));
    return withState(storageRef, state => {
      const prior = state.operations.find(item => item.idempotency_hash === hash(idempotencyKey));
      if (prior) { if (prior.request_hash !== requestHash) fail("recovery_idempotency_conflict"); return { ...prior }; }
      const operation = this.startOperation(state, operationRef, idempotencyKey, requestHash, "backup", profileRef);
      // Persist the running receipt before copying any user material. A process
      // stop during the copy must remain queryable and must never look like a
      // fresh backup request.
      saveState(storageRef, state);
      let root: string | undefined;
      try {
        if (profile.in_use() || profileStorageHasExternalLock(profile.facts.browser_storage.profile_storage_ref)) throw new ProfileRecoveryError("recovery_profile_locked", "stop_the_managed_instance_and_retry");
        const source = profileStoragePath(profile.facts.browser_storage.profile_storage_ref);
        if (!realDirectory(source)) throw new ProfileRecoveryError("recovery_profile_missing");
        const camoufox = profile.facts.provider_binding.selected_provider_id === "camoufox";
        const bundlePath = join(source, CAMOUFOX_BUNDLE);
        const bundlePresent = existsSync(bundlePath);
        if (camoufox && bundlePresent) {
          const bundleFailure = validateCamoufoxBundle(bundlePath, compatibility(profile.facts));
          if (bundleFailure) throw new ProfileRecoveryError(bundleFailure, "repair_the_profile_or_restore_a_matching_backup");
        } else if (camoufox) {
          throw new ProfileRecoveryError("camoufox_bundle_missing", "restore_a_matching_profile_backup_or_manual_recovery");
        }
        const fingerprint = profileFingerprint(source);
        const environment = environmentSnapshot(profile.facts);
        const environmentFingerprintAtStart = hash(canonical(environment));
        const ownerBindingAtStart = ownerBinding(profile);
        const materialVersionAtStart = materialVersion(profile.facts);
        const backupRef = `backup:${randomUUID()}`;
        root = join(backupRoot(storageRef), backupId(backupRef));
        const target = join(root, "profile");
        const createdAt = now();
        let ownership: ReturnType<typeof acquireProfileStorageOwnership> | undefined;
        try {
          ownership = acquireProfileStorageOwnership([profile.facts.browser_storage.profile_storage_ref]);
          profile = this.options.resolveProfile(profileRef) ?? fail("recovery_profile_not_found");
          if (profile.in_use() || profileStorageHasExternalLock(profile.facts.browser_storage.profile_storage_ref)) throw new ProfileRecoveryError("recovery_profile_locked", "stop_the_managed_instance_and_retry");
          if (!realDirectory(source) || profileFingerprint(source) !== fingerprint) throw new ProfileRecoveryError("recovery_material_changed", "inspect_and_create_a_new_plan");
          if (environmentFingerprint(profile.facts) !== environmentFingerprintAtStart || ownerBinding(profile) !== ownerBindingAtStart || materialVersion(profile.facts) !== materialVersionAtStart) {
            throw new ProfileRecoveryError("recovery_environment_changed", "inspect_and_retry_backup");
          }
          if (camoufox && bundlePresent) {
            const bundleFailure = validateCamoufoxBundle(bundlePath, compatibility(profile.facts));
            if (bundleFailure) throw new ProfileRecoveryError(bundleFailure, "repair_the_profile_or_restore_a_matching_backup");
          }
          copyTree(source, target);
          if (profileFingerprint(target) !== fingerprint) throw new ProfileRecoveryError("recovery_verification_failed", "preserve_current_profile_and_request_manual_recovery");
          writeFileSync(join(root, "environment.json"), `${JSON.stringify(environment)}\n`, { mode: 0o600, flag: "wx" });
          const metadata: ProfileRecoveryBackupSummary = {
            schema_version: HARBOR_PROFILE_RECOVERY_BACKUP_SCHEMA, backup_ref: backupRef, profile_ref: profileRef,
            identity_environment_ref: profile.facts.identity_environment_ref, created_at: createdAt, backup_time: createdAt,
            storage_fingerprint: fingerprint, environment_fingerprint: environmentFingerprintAtStart, material_version: materialVersionAtStart, owner_binding: ownerBindingAtStart,
            provider_id: profile.facts.provider_binding.selected_provider_id, compatibility: compatibility(profile.facts), scope: "profile_storage_and_matching_environment_bundle", private: true
          };
          writeFileSync(join(root, "backup.json"), `${JSON.stringify(metadata)}\n`, { mode: 0o600, flag: "wx" });
          state.backups.push(metadata);
          operation.status = "completed"; operation.updated_at = now(); operation.backup_ref = backupRef; operation.result = { backup: metadata };
        } finally { ownership?.release(); }
      } catch (error) { operation.status = error instanceof ProfileRecoveryError && error.code === "recovery_copy_interrupted" ? "unknown_outcome" : "rejected"; operation.updated_at = now(); operation.failure = publicFailure(error); }
      if (operation.status !== "completed" && root) rmSync(root, { recursive: true, force: true });
      return { ...operation };
    });
  }

  preparePlan(input: ProfileRecoveryPlanInput): { inspection: ProfileRecoveryInspection; backup: ProfileRecoveryBackupSummary; plan_inputs: Record<string, unknown> } {
    const profileRef = ref(input.profile_ref), profile = this.options.resolveProfile(profileRef);
    if (!profile) return fail("recovery_profile_not_found");
    const storageRef = profile.facts.browser_storage.profile_storage_ref;
    const inspection = this.inspect(profileRef), backup = readBackup(storageRef, profileRef, ref(input.backup_ref));
    if (backup.profile_ref !== profileRef || backup.identity_environment_ref !== profile.facts.identity_environment_ref) fail("recovery_backup_owner_mismatch");
    validateCompatibility(inspection.compatibility, backup.compatibility);
    const targetEnvironment = backupEnvironment(profile, backup.backup_ref);
    if (!this.options.restoreEnvironment && !isDeepStrictEqual(targetEnvironment, profile.facts.environment)) fail("recovery_environment_incompatible");
    if (inspection.active_instance) fail("recovery_profile_locked", "stop_the_managed_instance_and_retry");
    if (inspection.status === "unavailable") fail("recovery_inspection_unavailable");
    if (!inspection.storage_fingerprint || !SHA256.test(inspection.storage_fingerprint)) fail("recovery_profile_missing");
    if (input.current_material_fingerprint !== undefined && sha(input.current_material_fingerprint) !== inspection.storage_fingerprint) fail("recovery_material_changed", "inspect_and_create_a_new_plan");
    return { inspection, backup, plan_inputs: {
      schema_version: "webenvoy.profile-recovery-plan.v1", profile_ref: profileRef, backup_ref: backup.backup_ref, backup_time: backup.backup_time,
      current_material_fingerprint: inspection.storage_fingerprint, backup_material_fingerprint: backup.storage_fingerprint,
      current_environment_fingerprint: inspection.environment_fingerprint, backup_environment_fingerprint: backup.environment_fingerprint,
      current_material_version: inspection.material_version, backup_material_version: backup.material_version, owner_binding: inspection.owner_binding,
      compatibility: backup.compatibility, scope: backup.scope
    } };
  }

  apply(input: ProfileRecoveryApplyInput): ProfileRecoveryOperation {
    const plan = input.plan, idempotencyKey = key(input.idempotency_key), operationRef = `recovery:${operationId(String(input.operation_ref))}`, profileRef = ref(plan.profile_ref);
    const initialProfile = this.options.resolveProfile(profileRef);
    if (!initialProfile) return this.rejected(operationRef, idempotencyKey, "apply", profileRef, "recovery_profile_not_found");
    let profile = initialProfile;
    const storageRef = profile.facts.browser_storage.profile_storage_ref;
    const requestHash = hash(canonical({ kind: "apply", plan, confirmation: input.confirmation }));
    return withState(storageRef, state => {
      const prior = state.operations.find(item => item.idempotency_hash === hash(idempotencyKey));
      if (prior) { if (prior.request_hash !== requestHash) fail("recovery_idempotency_conflict"); return { ...prior }; }
      const operation = this.startOperation(state, operationRef, idempotencyKey, requestHash, "apply", profileRef);
      operation.plan_ref = plan.plan_ref;
      // Keep the operation receipt durable before taking the ownership lock or
      // changing any profile directory. A stopped process can therefore be
      // reconciled through status instead of being mistaken for a new apply.
      saveState(storageRef, state);
      try {
        validatePlanAndConfirmation(plan, input.confirmation, idempotencyKey);
        if (state.operations.some(item => item !== operation && item.profile_ref === profileRef && item.kind === "apply" && ["running", "unknown_outcome", "manual_recovery_required"].includes(item.status))) fail("recovery_operation_unfinished");
        const inspection = inspectProfile(profile, state.backups);
        if (!canRecoverDamagedCamoufoxInspection(inspection)) fail(inspection.failure?.code ?? "recovery_inspection_unavailable", "repair_the_profile_or_request_manual_recovery");
        if (inspection.storage_fingerprint !== plan.current_material_fingerprint || inspection.environment_fingerprint !== plan.current_environment_fingerprint || inspection.environment_fingerprint !== environmentFingerprint(profile.facts) || inspection.material_version !== plan.current_material_version || inspection.owner_binding !== plan.owner_binding) fail("recovery_material_changed", "inspect_and_create_a_new_plan");
        validateCompatibility(inspection.compatibility, plan.compatibility);
        const backupMetadata = readBackup(storageRef, profileRef, plan.backup_ref);
        validateCompatibility(inspection.compatibility, backupMetadata.compatibility);
        if (backupMetadata.storage_fingerprint !== plan.backup_material_fingerprint || backupMetadata.environment_fingerprint !== plan.backup_environment_fingerprint || backupMetadata.material_version !== plan.backup_material_version || backupMetadata.owner_binding !== plan.owner_binding) fail("recovery_backup_changed", "inspect_and_create_a_new_plan");
        const source = profileStoragePath(storageRef), backup = backupPath(storageRef, plan.backup_ref);
        if (profile.in_use() || profileStorageHasExternalLock(profile.facts.browser_storage.profile_storage_ref)) fail("recovery_profile_locked", "stop_the_managed_instance_and_retry");
        const ownership = acquireProfileStorageOwnership([profile.facts.browser_storage.profile_storage_ref]);
        let before: string | undefined;
        let staging: string | undefined;
        let isolated = false;
        let environmentRestored = false;
        const originalEnvironment = structuredClone(profile.facts.environment);
        try {
          profile = this.options.resolveProfile(profileRef) ?? fail("recovery_profile_not_found");
          if (profile.in_use() || profileStorageHasExternalLock(profile.facts.browser_storage.profile_storage_ref)) fail("recovery_profile_locked", "stop_the_managed_instance_and_retry");
          // Re-read all mutable facts after ownership is acquired. The plan is
          // only valid for the exact source and environment that was checked
          // before the lock; no rename is allowed until these checks pass.
          const lockedInspection = inspectProfile(profile, state.backups);
          if (!canRecoverDamagedCamoufoxInspection(lockedInspection)) fail(lockedInspection.failure?.code ?? "recovery_inspection_unavailable", "repair_the_profile_or_request_manual_recovery");
          if (lockedInspection.storage_fingerprint !== plan.current_material_fingerprint || lockedInspection.environment_fingerprint !== plan.current_environment_fingerprint || lockedInspection.environment_fingerprint !== environmentFingerprint(profile.facts) || lockedInspection.material_version !== plan.current_material_version || lockedInspection.owner_binding !== plan.owner_binding) fail("recovery_material_changed", "inspect_and_create_a_new_plan");
          validateCompatibility(lockedInspection.compatibility, plan.compatibility);
          const lockedBackup = readBackup(storageRef, profileRef, plan.backup_ref);
          const targetEnvironment = backupEnvironment(profile, plan.backup_ref);
          if (!this.options.restoreEnvironment && !isDeepStrictEqual(targetEnvironment, profile.facts.environment)) fail("recovery_environment_incompatible");
          validateCompatibility(lockedInspection.compatibility, lockedBackup.compatibility);
          if (lockedBackup.storage_fingerprint !== plan.backup_material_fingerprint || lockedBackup.environment_fingerprint !== plan.backup_environment_fingerprint || lockedBackup.material_version !== plan.backup_material_version || lockedBackup.owner_binding !== plan.owner_binding) fail("recovery_backup_changed", "inspect_and_create_a_new_plan");
          if (!realDirectory(source) || !realDirectory(backup)) fail("recovery_profile_missing");
          const sourceFingerprint = profileFingerprint(source);
          const backupFingerprint = profileFingerprint(backup);
          if (sourceFingerprint !== plan.current_material_fingerprint) fail("recovery_material_changed", "inspect_and_create_a_new_plan");
          if (backupFingerprint !== plan.backup_material_fingerprint) fail("recovery_backup_changed", "inspect_and_create_a_new_plan");
          const camoufox = profile.facts.provider_binding.selected_provider_id === "camoufox";
          if (camoufox) {
            const backupBundleFailure = validateCamoufoxBundle(join(backup, CAMOUFOX_BUNDLE), lockedInspection.compatibility);
            if (backupBundleFailure) fail(backupBundleFailure, "repair_the_profile_or_restore_a_matching_backup");
          }

          // Prepare and verify the replacement while the current profile is
          // still untouched. This keeps a failed copy from exposing a missing
          // or half-copied profile to the next runtime launch.
          staging = `${source}.recovery-stage-${randomUUID()}`;
          copyTree(backup, staging);
          if (profileFingerprint(staging) !== backupFingerprint) fail("recovery_verification_failed", "preserve_current_profile_and_request_manual_recovery");
          if (profile.in_use() || profileStorageHasExternalLock(profile.facts.browser_storage.profile_storage_ref) || profileFingerprint(source) !== plan.current_material_fingerprint || environmentFingerprint(profile.facts) !== plan.current_environment_fingerprint || ownerBinding(profile) !== plan.owner_binding) fail("recovery_material_changed", "inspect_and_create_a_new_plan");
          before = `${source}.recovery-before-${randomUUID()}`;
          renameSync(source, before);
          isolated = true;
          renameSync(staging, source);
          staging = undefined;
          if (profileFingerprint(source) !== backupFingerprint) fail("recovery_verification_failed", "preserve_current_profile_and_request_manual_recovery");
          this.options.restoreEnvironment?.(profile, targetEnvironment);
          environmentRestored = true;
          const restoredProfile = this.options.resolveProfile(profileRef) ?? fail("recovery_profile_not_found");
          if (environmentFingerprint(restoredProfile.facts) !== plan.backup_environment_fingerprint) fail("recovery_verification_failed");
          operation.status = "completed"; operation.result = { restored: true, backup_ref: plan.backup_ref, profile_ref: profileRef, observation_required: true, recovery_before_copy_retained: true };
          operation.updated_at = now();
        } catch (error) {
          if (staging) rmSync(staging, { recursive: true, force: true });
          let environmentRollbackSucceeded = true;
          if (environmentRestored) {
            try {
              const currentProfile = this.options.resolveProfile(profileRef) ?? fail("recovery_profile_not_found");
              if (environmentFingerprint(currentProfile.facts) !== plan.backup_environment_fingerprint) fail("recovery_material_changed");
              this.options.restoreEnvironment?.(currentProfile, originalEnvironment);
            } catch { environmentRollbackSucceeded = false; }
          }
          if (isolated && before) {
            if (environmentRollbackSucceeded && restoreOriginalProfile(source, before, plan.current_material_fingerprint)) {
              before = undefined;
              operation.status = "rejected";
              operation.failure = publicFailure(error);
            } else {
              operation.status = "manual_recovery_required";
              operation.failure = { code: "recovery_restore_failed", recovery_hint: "stop_all_instances_and_restore_the_retained_recovery_before_copy_manually" };
            }
          } else {
            operation.status = "rejected";
            operation.failure = publicFailure(error);
          }
          operation.updated_at = now();
        } finally { ownership.release(); }
      } catch (error) { operation.status = "rejected"; operation.updated_at = now(); operation.failure = publicFailure(error); }
      return { ...operation };
    });
  }

  getOperation(operationRefInput: unknown): ProfileRecoveryOperation | null {
    const operationRef = ref(operationRefInput);
    for (const profile of this.allProfiles()) {
      const operation = withState(profile.facts.browser_storage.profile_storage_ref, state => state.operations.find(item => item.operation_ref === operationRef));
      if (operation) return { ...operation };
    }
    return null;
  }

  private allProfiles(): RecoveryProfileFacts[] { return this.options.listProfiles?.() ?? []; }

  private startOperation(state: State, operationRef: string, idempotencyKey: string, requestHash: string, kind: ProfileRecoveryOperation["kind"], profileRef: string): ProfileRecoveryOperation {
    if (state.operations.some(item => item.operation_ref === operationRef)) fail("recovery_operation_conflict");
    const operation: ProfileRecoveryOperation = { schema_version: HARBOR_PROFILE_RECOVERY_OPERATION_SCHEMA, operation_ref: operationRef, idempotency_hash: hash(idempotencyKey), request_hash: requestHash, kind, status: "running", profile_ref: profileRef, created_at: now(), updated_at: now() };
    state.operations.push(operation); return operation;
  }

  private rejected(operationRef: string, idempotencyKey: string, kind: ProfileRecoveryOperation["kind"], profileRef: string, code: string): ProfileRecoveryOperation {
    const profile = this.options.resolveProfile(profileRef);
    const storageRef = profile?.facts.browser_storage.profile_storage_ref ?? profileRef;
    return withState(storageRef, state => { const operation = this.startOperation(state, operationRef, idempotencyKey, hash(canonical({ kind, profile_ref: profileRef })), kind, profileRef); operation.status = "rejected"; operation.failure = { code, recovery_hint: "inspect_profile_and_request_new_plan" }; operation.updated_at = now(); return { ...operation }; });
  }
}

function validatePlanAndConfirmation(plan: ProfileRecoveryApplyInput["plan"], confirmation: ProfileRecoveryApplyInput["confirmation"], idempotencyKey: string): void {
  const compatibilityShape = isCompatibility(plan.compatibility);
  if (plan.schema_version !== "webenvoy.profile-recovery-plan.v1" || plan.scope !== "profile_storage_and_matching_environment_bundle" || confirmation.schema_version !== "webenvoy.profile-recovery-confirmation.v1" || confirmation.plan_ref !== plan.plan_ref || confirmation.confirmed_by !== "owner" || confirmation.decision !== "apply" || confirmation.idempotency_key !== idempotencyKey || !REF.test(plan.plan_ref) || !REF.test(plan.profile_ref) || !REF.test(plan.backup_ref) || !REF.test(confirmation.confirmation_ref) || !SHA256.test(plan.current_material_fingerprint) || !SHA256.test(plan.backup_material_fingerprint) || !SHA256.test(plan.current_environment_fingerprint) || !SHA256.test(plan.backup_environment_fingerprint) || !SHA256.test(plan.owner_binding) || typeof plan.current_material_version !== "string" || !plan.current_material_version || typeof plan.backup_material_version !== "string" || !plan.backup_material_version || !compatibilityShape || !Number.isFinite(Date.parse(plan.expires_at)) || !Number.isFinite(Date.parse(confirmation.confirmed_at)) || Date.parse(plan.expires_at) <= Date.now()) fail("recovery_confirmation_invalid", "create_a_new_plan_and_confirm_that_plan");
}
