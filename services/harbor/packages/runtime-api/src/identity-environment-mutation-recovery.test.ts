import assert from "node:assert/strict";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  LocalIdentityEnvironmentManager,
  type IdentityEnvironmentMutationRequest
} from "./index.js";
import type { IdentityEnvironmentMutationPersistenceState } from "./identity-environment-mutation-types.js";
import {
  copyRequest,
  copyTarget,
  createMutationInput,
  identityInput,
  isolateProfileStorage,
  mutationTarget,
  testProviderDetection,
  tempDir
} from "./identity-environment-mutation-test-helpers.js";
import { profileStoragePath } from "./profile-storage.js";

after(isolateProfileStorage("identity-mutation-recovery"));

test("custom persistence reloads records, receipts, and configuration", () => {
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const persistence = {
    load_state: () => state,
    persist_state: (next: IdentityEnvironmentMutationPersistenceState) => { state = structuredClone(next); }
  };
  const createRequest: IdentityEnvironmentMutationRequest = {
    operation: "create",
    idempotency_key: "custom-create",
    identity_environment: {
      ...createMutationInput(),
      language: "en-US",
      timezone: "Europe/London",
      viewport: "1280x720"
    }
  };
  const first = new LocalIdentityEnvironmentManager({ ...persistence, provider_detection: testProviderDetection }).mutate(createRequest);
  const identityRef = mutationTarget(createRequest).identity_environment_ref;
  assert.equal(first.status, "completed");

  const reloaded = new LocalIdentityEnvironmentManager({ ...persistence, provider_detection: testProviderDetection });
  assert.deepEqual(reloaded.mutate(createRequest), first);
  assert.deepEqual(reloaded.get(identityRef)?.environment_summary, first.record?.environment_summary);
  assert.equal(requiredState(state).mutation_receipts.length, 1);
  assert.deepEqual(requiredState(state).repairs, []);
});

test("rolls back clean failures and records durable repair state", () => {
  let persistenceWrites = 0;
  let persisted: IdentityEnvironmentMutationPersistenceState | null = null;
  let rolledBack = false;
  const persistenceFailure = new LocalIdentityEnvironmentManager({
    load_state: () => persisted,
    persist_state: (state) => {
      persistenceWrites += 1;
      if (persistenceWrites > 1) throw new Error("persistence unavailable");
      persisted = structuredClone(state);
    },
    stage_profile_copy: () => ({
      commit: () => undefined,
      rollback: () => { rolledBack = true; return true; },
      residual: () => false
    })
  });
  persistenceFailure.create(identityInput("identity-persist-source", "profile-persist-source"));
  const failedRequest = copyRequest("identity-persist-source", "copy-persist-fail");
  const failedTarget = copyTarget(failedRequest).identity_environment_ref;
  const failed = persistenceFailure.mutate(failedRequest);
  assert.equal(failed.failure?.code, "persistence_failed");
  assert.equal(rolledBack, true);
  assert.equal(persistenceFailure.get(failedTarget), null);

  const cleanRollback = new LocalIdentityEnvironmentManager({
    stage_profile_copy: () => ({ commit: () => { throw new Error("copy failed"); }, rollback: () => true, residual: () => false })
  });
  cleanRollback.create(identityInput("identity-clean-source", "profile-clean-source"));
  const cleanRequest = copyRequest("identity-clean-source", "copy-clean-fail");
  const cleanTarget = copyTarget(cleanRequest).identity_environment_ref;
  const cleanFailure = cleanRollback.mutate(cleanRequest);
  assert.equal(cleanFailure.failure?.code, "mutation_failed");
  assert.equal(cleanRollback.get(cleanTarget), null);

  const residual = new LocalIdentityEnvironmentManager({
    stage_profile_copy: () => ({ commit: () => { throw new Error("copy failed"); }, rollback: () => false, residual: () => true })
  });
  residual.create(identityInput("identity-residual-source", "profile-residual-source"));
  const residualRequest = copyRequest("identity-residual-source", "copy-residual");
  const residualTarget = copyTarget(residualRequest).identity_environment_ref;
  assert.equal(residual.mutate(residualRequest).status, "repair_required");
  assert.equal(residual.get(residualTarget)?.status.repair_state, "repair_required");
  assert.equal(residual.mutate(residualRequest).failure?.code, "mutation_failed");
  assert.equal(residual.get(residualTarget), null);
});

test("delete removes all local material and resumes durable repair after restart", async () => {
  const root = tempDir("durable-delete");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const persistence = {
    load_state: () => state,
    persist_state: (next: IdentityEnvironmentMutationPersistenceState) => { state = structuredClone(next); }
  };
  const request: IdentityEnvironmentMutationRequest = {
    operation: "delete",
    idempotency_key: "delete-durable",
    identity_environment_ref: "identity-delete",
    confirmation: "delete_local_data"
  };
  try {
    const manager = new LocalIdentityEnvironmentManager({ ...persistence, delete_local_material: () => "unknown" });
    manager.create({
      ...identityInput("identity-delete", "profile-delete"),
      cookie_jar_ref: "cookie-owner",
      browser_storage_ref: "storage-owner",
      credential_ref: "credential-owner",
      keychain_ref: "keychain-owner",
      local_secret_ref: "secret-owner"
    });
    const profilePath = profileStoragePath("profile-delete:storage");
    mkdirSync(profilePath, { recursive: true });
    writeFileSync(join(profilePath, "Cookies"), "owner-session");

    const interrupted = manager.mutate(request);
    assert.equal(interrupted.status, "repair_required");
    assert.equal(interrupted.failure?.code, "local_material_cleanup_unavailable");
    assert.equal(manager.get("identity-delete")?.status.repair_state, "repair_required");
    assert.equal(existsSync(profilePath), false);
    assert.equal(requiredState(state).records[0]?.repair_state, "repair_required");
    assert.equal(requiredState(state).mutation_receipts[0]?.result.status, "repair_required");
    assert.equal(requiredState(state).repairs.length, 1);

    let deletedRefs: unknown = null;
    const repairedManager = new LocalIdentityEnvironmentManager({
      ...persistence,
      delete_local_material: (refs) => { deletedRefs = refs; return "deleted"; }
    });
    const repaired = repairedManager.mutate(request);
    assert.equal(repaired.status, "completed");
    assert.deepEqual(deletedRefs, {
      cookie_jar_ref: "cookie-owner",
      browser_storage_ref: "storage-owner",
      credential_ref: "credential-owner",
      keychain_ref: "keychain-owner",
      local_secret_ref: "secret-owner"
    });
    assert.equal(requiredState(state).repairs.length, 0);
    assert.equal(requiredState(state).records.length, 0);
    assert.deepEqual(new LocalIdentityEnvironmentManager(persistence).mutate(request), repaired);
    assert.equal(JSON.stringify(repaired).includes("cookie-owner"), false);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("persists delete intent before staging profile storage", () => {
  const root = tempDir("delete-intent-order");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  let stageCalls = 0;
  try {
    const manager = new LocalIdentityEnvironmentManager({
      load_state: () => state,
      persist_state: (next) => { state = structuredClone(next); },
      stage_profile_delete: (profileStorageRef) => {
        stageCalls += 1;
        const persisted = requiredState(state);
        assert.equal(persisted.mutation_receipts[0]?.result.status, "repair_required");
        assert.equal(persisted.repairs[0]?.operation, "delete");
        assert.equal(persisted.records[0]?.repair_state, "repair_required");
        assert.equal(existsSync(profileStoragePath(profileStorageRef)), true);
        throw new Error("simulated process interruption before profile staging");
      }
    });
    manager.create(identityInput("identity-delete-order", "profile-delete-order"));
    const profilePath = profileStoragePath("profile-delete-order:storage");
    mkdirSync(profilePath, { recursive: true });
    writeFileSync(join(profilePath, "Cookies"), "owner-session");

    const result = manager.mutate({
      operation: "delete",
      idempotency_key: "delete-intent-order",
      identity_environment_ref: "identity-delete-order",
      confirmation: "delete_local_data"
    });
    assert.equal(result.status, "repair_required");
    assert.equal(stageCalls, 1);
    assert.equal(existsSync(profilePath), true);
    assert.equal(manager.get("identity-delete-order")?.status.repair_state, "repair_required");
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("resumes delete after restart when durable repair precedes profile staging", () => {
  const root = tempDir("delete-restart-before-stage");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const persistence = {
    load_state: () => state,
    persist_state: (next: IdentityEnvironmentMutationPersistenceState) => { state = structuredClone(next); }
  };
  const request: IdentityEnvironmentMutationRequest = {
    operation: "delete",
    idempotency_key: "delete-restart-before-stage",
    identity_environment_ref: "identity-delete-before-stage",
    confirmation: "delete_local_data"
  };
  try {
    const manager = new LocalIdentityEnvironmentManager({
      ...persistence,
      stage_profile_delete: () => { throw new Error("simulated process interruption before profile staging"); }
    });
    manager.create(identityInput("identity-delete-before-stage", "profile-delete-before-stage"));
    const profilePath = profileStoragePath("profile-delete-before-stage:storage");
    mkdirSync(profilePath, { recursive: true });
    writeFileSync(join(profilePath, "Cookies"), "owner-session");

    assert.equal(manager.mutate(request).status, "repair_required");
    assert.equal(existsSync(profilePath), true);
    assert.equal(requiredState(state).repairs.length, 1);
    assert.equal(requiredState(state).repairs[0]?.automatic_repair, false);

    // Model the same durable intent written by Harbor's standard adapter before staging begins.
    requiredState(state).repairs[0]!.automatic_repair = true;

    const restarted = new LocalIdentityEnvironmentManager(persistence);
    const repaired = restarted.mutate(request);
    assert.equal(repaired.status, "completed");
    assert.equal(existsSync(profilePath), false);
    assert.equal(restarted.get("identity-delete-before-stage"), null);
    assert.equal(requiredState(state).records.length, 0);
    assert.equal(requiredState(state).repairs.length, 0);
    assert.deepEqual(new LocalIdentityEnvironmentManager(persistence).mutate(request), repaired);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("resumes delete after restart when profile is quarantined before commit failure", () => {
  const root = tempDir("delete-restart-from-quarantine");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const persistence = {
    load_state: () => state,
    persist_state: (next: IdentityEnvironmentMutationPersistenceState) => { state = structuredClone(next); }
  };
  const request: IdentityEnvironmentMutationRequest = {
    operation: "delete",
    idempotency_key: "delete-restart-from-quarantine",
    identity_environment_ref: "identity-delete-from-quarantine",
    confirmation: "delete_local_data"
  };
  try {
    const profileRef = "profile-delete-from-quarantine:storage";
    const profilePath = profileStoragePath(profileRef);
    const quarantinePath = `${profilePath}.delete-interrupted`;
    const manager = new LocalIdentityEnvironmentManager({
      ...persistence,
      stage_profile_delete: (profileStorageRef) => {
        assert.equal(profileStorageRef, profileRef);
        renameSync(profilePath, quarantinePath);
        return {
          commit: () => { throw new Error("simulated process interruption after quarantine"); },
          rollback: () => false,
          residual: () => existsSync(quarantinePath)
        };
      }
    });
    manager.create(identityInput("identity-delete-from-quarantine", "profile-delete-from-quarantine"));
    mkdirSync(profilePath, { recursive: true });
    writeFileSync(join(profilePath, "Cookies"), "owner-session");

    assert.equal(manager.mutate(request).status, "repair_required");
    assert.equal(existsSync(profilePath), false);
    assert.equal(existsSync(quarantinePath), true);
    assert.equal(requiredState(state).repairs.length, 1);
    assert.equal(requiredState(state).repairs[0]?.automatic_repair, false);

    // Model a standard .delete-* quarantine left after Harbor persisted an automatic repair.
    requiredState(state).repairs[0]!.automatic_repair = true;

    const restarted = new LocalIdentityEnvironmentManager(persistence);
    const repaired = restarted.mutate(request);
    assert.equal(repaired.status, "completed");
    assert.equal(existsSync(profilePath), false);
    assert.equal(existsSync(quarantinePath), false);
    assert.equal(restarted.get("identity-delete-from-quarantine"), null);
    assert.equal(requiredState(state).records.length, 0);
    assert.equal(requiredState(state).repairs.length, 0);
    assert.deepEqual(new LocalIdentityEnvironmentManager(persistence).mutate(request), repaired);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps provider-managed delete quarantine in repair_required after restart", () => {
  const root = tempDir("delete-provider-quarantine");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const persistence = {
    load_state: () => state,
    persist_state: (next: IdentityEnvironmentMutationPersistenceState) => { state = structuredClone(next); }
  };
  const request: IdentityEnvironmentMutationRequest = {
    operation: "delete",
    idempotency_key: "delete-provider-quarantine",
    identity_environment_ref: "identity-delete-provider-quarantine",
    confirmation: "delete_local_data"
  };
  try {
    const profileRef = "profile-delete-provider-quarantine:storage";
    const profilePath = profileStoragePath(profileRef);
    const providerQuarantinePath = `${profilePath}.provider-quarantine`;
    const manager = new LocalIdentityEnvironmentManager({
      ...persistence,
      stage_profile_delete: () => {
        renameSync(profilePath, providerQuarantinePath);
        return {
          commit: () => { throw new Error("simulated provider interruption after quarantine"); },
          rollback: () => false,
          residual: () => existsSync(providerQuarantinePath)
        };
      }
    });
    manager.create(identityInput("identity-delete-provider-quarantine", "profile-delete-provider-quarantine"));
    mkdirSync(profilePath, { recursive: true });
    writeFileSync(join(profilePath, "Cookies"), "sensitive-session");

    assert.equal(manager.mutate(request).status, "repair_required");
    assert.equal(requiredState(state).repairs[0]?.automatic_repair, false);
    assert.equal(existsSync(providerQuarantinePath), true);

    const restarted = new LocalIdentityEnvironmentManager(persistence);
    const blocked = restarted.mutate(request);
    assert.equal(blocked.status, "repair_required");
    assert.equal(restarted.get("identity-delete-provider-quarantine")?.status.repair_state, "repair_required");
    assert.equal(requiredState(state).records.length, 1);
    assert.equal(requiredState(state).repairs.length, 1);
    assert.equal(existsSync(providerQuarantinePath), true);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

function requiredState(state: IdentityEnvironmentMutationPersistenceState | null): IdentityEnvironmentMutationPersistenceState {
  assert.ok(state);
  return state;
}
