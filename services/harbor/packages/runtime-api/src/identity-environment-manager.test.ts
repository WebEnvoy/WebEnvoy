import assert from "node:assert/strict";
import test from "node:test";
import { LocalIdentityEnvironmentManager, rebindUserConfirmedManagedSession } from "./identity-environment-manager.js";
import { LocalIdentityEnvironmentManager as PublicLocalIdentityEnvironmentManager } from "./index.js";
import { resolveIdentityEnvironmentStorePath } from "./identity-environment-store.js";
import type { IdentityEnvironmentMutationPersistenceState } from "./identity-environment-mutation-types.js";

test("resolves a persistent identity environment store for the production runtime by default", () => {
  assert.equal(
    resolveIdentityEnvironmentStorePath(undefined, "/home/test"),
    "/home/test/.webenvoy/harbor/identity-environments.json"
  );
  assert.equal(resolveIdentityEnvironmentStorePath("/configured/identities.json", "/home/test"), "/configured/identities.json");
});

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("user confirmation clears only the authentication gate for a restricted Chrome identity", () => {
  const manager = new LocalIdentityEnvironmentManager();
  const created = manager.create({
    platform: "darwin",
    arch: "arm64",
    home_dir: "/Users/test",
    env: {},
    path_exists: (path) => path === chromePath,
    is_executable: (path) => path === chromePath,
    read_text: () => null,
    identity_environment_ref: "identity-env_chrome-manual-auth",
    execution_identity_ref: "execution-identity_chrome-manual-auth",
    profile_ref: "profile_chrome-manual-auth",
    site: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "小红书"
    },
    login_state: "manual_auth_required",
    manual_authentication_state: "required",
    storage_state: "present",
    proxy_ref: "proxy-shanghai",
    region: "CN-SH",
    language: "zh-CN",
    timezone: "Asia/Shanghai",
    fingerprint_summary: "chrome_official_restricted_fallback"
  });
  assert.equal(created.status.readiness, "needs_auth");

  const completed = manager.completeManualAuthentication(created.identity_environment_ref, "session_chrome-manual-auth");
  assert.ok(completed);
  assert.equal(completed.status.readiness, "ready");
  assert.equal(completed.status.login_state, "logged_in");
  assert.equal(completed.status.authentication_provenance, "user_confirmed_managed_session");
  assert.equal(completed.status.manual_authentication_state, "completed");
  assert.equal(completed.status.recovery_required, false);
  assert.equal(completed.status.blocking_reasons.includes("provider_conflict"), false);
  assert.equal(completed.status.blocking_reasons.includes("fingerprint_conflict"), false);
  assert.equal(completed.environment_summary.provider_id, "chrome_official");
});

test("does not accept caller-provided login reasons as managed-session provenance", () => {
  const record = new LocalIdentityEnvironmentManager().create({
    identity_environment_ref: "identity-env_spoofed-provenance",
    execution_identity_ref: "execution-identity_spoofed-provenance",
    profile_ref: "profile_spoofed-provenance",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
    login_state: "logged_in",
    login_state_reason: "user_confirmed_managed_session",
    manual_authentication_state: "completed",
    storage_state: "present"
  });
  assert.equal(record.status.authentication_provenance, "unknown");
  assert.equal(record.status.recovery_required, true);
});

test("requires recovery when a managed identity has no browser storage", () => {
  const record = new LocalIdentityEnvironmentManager().create({
    identity_environment_ref: "identity-env_missing-storage",
    execution_identity_ref: "execution-identity_missing-storage",
    profile_ref: "profile_missing-storage",
    site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
    login_state: "logged_in",
    manual_authentication_state: "completed",
    storage_state: "missing"
  });
  assert.equal(record.status.recovery_required, true);
  assert.equal(record.status.readiness, "needs_auth");
});

test("package-index manager cannot mint a managed session ref through its public rebind method", () => {
  const manager = new PublicLocalIdentityEnvironmentManager();
  const created = manager.create({
    identity_environment_ref: "identity-env_public-rebind",
    execution_identity_ref: "execution-identity_public-rebind",
    profile_ref: "profile_public-rebind",
    site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
    login_state: "logged_in",
    manual_authentication_state: "completed",
    storage_state: "present"
  });
  const facts = manager.getFacts(created.identity_environment_ref)!;
  assert.equal(manager.rebindUserConfirmedManagedSession(created.identity_environment_ref, "session_forged", {
    execution_identity_ref: facts.execution_identity_ref,
    profile_ref: facts.profile_ref,
    profile_storage_ref: facts.browser_storage.profile_storage_ref
  }), false);
  assert.equal(manager.hasUserConfirmedManagedSession(created.identity_environment_ref, "session_forged"), false);
});

test("rebinds only valid user-confirmed authentication and rolls back on persistence failure", () => {
  let failPersistence = false;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const manager = new LocalIdentityEnvironmentManager({
    load_state: () => state,
    persist_state: (next) => {
      if (failPersistence) throw new Error("persistence unavailable");
      state = structuredClone(next);
    }
  });
  const created = manager.create({
    identity_environment_ref: "identity-env_rebind",
    execution_identity_ref: "execution-identity_rebind",
    profile_ref: "profile_rebind",
    site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
    login_state: "manual_auth_required",
    manual_authentication_state: "required",
    storage_state: "present"
  });
  const binding = manager.getFacts(created.identity_environment_ref)!;
  const exactBinding = {
    execution_identity_ref: binding.execution_identity_ref,
    profile_ref: binding.profile_ref,
    profile_storage_ref: binding.browser_storage.profile_storage_ref
  };

  assert.equal(manager.rebindUserConfirmedManagedSession(created.identity_environment_ref, "session_unconfirmed", exactBinding), false);
  assert.ok(manager.completeManualAuthentication(created.identity_environment_ref, "session_confirmed"));
  assert.equal(manager.rebindUserConfirmedManagedSession(created.identity_environment_ref, "session_drifted", { ...exactBinding, profile_ref: "profile_drifted" }), false);
  assert.equal(rebindUserConfirmedManagedSession(manager, created.identity_environment_ref, "session_rebound", exactBinding), true);
  assert.equal(manager.hasUserConfirmedManagedSession(created.identity_environment_ref, "session_rebound"), true);

  const restarted = new LocalIdentityEnvironmentManager({
    load_state: () => state,
    persist_state: (next) => {
      if (failPersistence) throw new Error("persistence unavailable");
      state = structuredClone(next);
    }
  });
  assert.equal(restarted.get(created.identity_environment_ref)?.status.authentication_provenance, "user_confirmed_managed_session");
  assert.equal(restarted.get(created.identity_environment_ref)?.status.recovery_required, true);
  assert.equal(restarted.hasUserConfirmedManagedSession(created.identity_environment_ref, "session_rebound"), false);

  failPersistence = true;
  assert.throws(
    () => rebindUserConfirmedManagedSession(restarted, created.identity_environment_ref, "session_not_persisted", exactBinding),
    /persistence unavailable/
  );
  assert.equal(restarted.get(created.identity_environment_ref)?.status.recovery_required, true);
  assert.equal(restarted.hasUserConfirmedManagedSession(created.identity_environment_ref, "session_not_persisted"), false);
});

test("recomputes stale provider and fingerprint conflicts when loading a clean legacy record", () => {
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const first = new LocalIdentityEnvironmentManager({
    load_state: () => state,
    persist_state: (next) => { state = structuredClone(next); }
  });
  const created = first.create({
    platform: "darwin",
    arch: "arm64",
    home_dir: "/Users/test",
    env: {},
    path_exists: (path) => path === chromePath,
    is_executable: (path) => path === chromePath,
    read_text: () => null,
    identity_environment_ref: "identity-env_legacy-chrome",
    execution_identity_ref: "execution-identity_legacy-chrome",
    profile_ref: "profile_legacy-chrome",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
    login_state: "logged_in",
    manual_authentication_state: "completed",
    storage_state: "present",
    fingerprint_summary: "chrome_official_restricted_fallback"
  });
  const persisted = state as IdentityEnvironmentMutationPersistenceState | null;
  assert.ok(persisted);
  const record = persisted.records[0]!;
  record.consistency.readiness = {
    state: "blocked",
    blocking_reasons: ["provider_conflict", "fingerprint_conflict"]
  };

  const reloaded = new LocalIdentityEnvironmentManager({
    load_state: () => state,
    persist_state: (next) => { state = structuredClone(next); }
  });
  const migrated = reloaded.get(created.identity_environment_ref);
  assert.ok(migrated);
  assert.equal(migrated.status.repair_state, "clean");
  assert.equal(migrated.status.blocking_reasons.includes("provider_conflict"), false);
  assert.equal(migrated.status.blocking_reasons.includes("fingerprint_conflict"), false);
});
