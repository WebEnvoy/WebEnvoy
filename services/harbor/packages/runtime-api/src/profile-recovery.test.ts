import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createLocalIdentityEnvironmentFacts } from "./identity-environment.js";
import { profileStoragePath } from "./profile-storage.js";
import { ProfileRecoveryError, ProfileRecoveryManager } from "./profile-recovery.js";

const root = mkdtempSync(join(tmpdir(), "harbor-profile-recovery-"));
process.env.HARBOR_PROFILE_STORAGE_ROOT = join(root, "profiles");
after(() => rmSync(root, { recursive: true, force: true }));

function fixture(refs: { profile?: string; storage?: string } = {}, options: { restoreEnvironment?: boolean; onRestore?: () => void } = {}) {
  const facts = createLocalIdentityEnvironmentFacts({
    platform: "darwin", arch: "arm64", home_dir: "/Users/fixture", env: {},
    path_exists: path => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    is_executable: path => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    read_text: () => null,
    identity_environment_ref: "identity-env-recovery-fixture",
    execution_identity_ref: "execution-recovery-fixture",
    profile_ref: refs.profile ?? "profile-recovery-fixture",
    profile_storage_ref: refs.storage ?? "storage-recovery-fixture",
    site: { site_id: "fixture", origin: "https://fixture.invalid", display_name: "Recovery fixture" },
    requested_provider_id: "chrome_official", storage_state: "present", login_state: "logged_out"
  });
  const profileDir = profileStoragePath(facts.browser_storage.profile_storage_ref);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(profileDir, "marker.txt"), "before", { mode: 0o600 });
  const profile = { facts, in_use: () => false };
  return {
    facts,
    profileDir,
    manager: new ProfileRecoveryManager({
      resolveProfile: ref => ref === facts.profile_ref ? profile : null,
      listProfiles: () => [profile],
      ...(options.restoreEnvironment ? {
        restoreEnvironment: (_profile, environment) => {
          options.onRestore?.();
          profile.facts.environment = structuredClone(environment);
        }
      } : {})
    })
  };
}

function camoufoxFixture(ref = `camoufox-${randomSuffix()}`) {
  const executable = join(root, `${ref}-camoufox-0.5.6`);
  writeFileSync(executable, "fixture", { mode: 0o700 });
  const facts = createLocalIdentityEnvironmentFacts({
    platform: "darwin", arch: "arm64", home_dir: "/Users/fixture", env: { HARBOR_CAMOUFOX_PATH: executable },
    path_exists: path => path === executable,
    is_executable: path => path === executable,
    read_text: () => null,
    identity_environment_ref: `${ref}:identity`, execution_identity_ref: `${ref}:execution`, profile_ref: `${ref}:profile`, profile_storage_ref: `${ref}:storage`,
    site: { site_id: "fixture", origin: "https://fixture.invalid", display_name: "Recovery fixture" }, requested_provider_id: "camoufox", storage_state: "present", login_state: "logged_out"
  });
  const profileDir = profileStoragePath(facts.browser_storage.profile_storage_ref);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(profileDir, "marker.txt"), "before", { mode: 0o600 });
  writeFileSync(join(profileDir, ".webenvoy-camoufox-environment.v1.json"), `${JSON.stringify(pythonBundle())}\n`, { mode: 0o600 });
  chmodSync(join(profileDir, ".webenvoy-camoufox-environment.v1.json"), 0o600);
  const profile = { facts, in_use: () => false };
  return { facts, profileDir, bundlePath: join(profileDir, ".webenvoy-camoufox-environment.v1.json"), manager: new ProfileRecoveryManager({ resolveProfile: value => value === facts.profile_ref ? profile : null, listProfiles: () => [profile] }) };
}

function randomSuffix(): string { return Math.random().toString(36).slice(2, 10); }

function pythonBundle(): Record<string, unknown> {
  const helper = join(dirname(fileURLToPath(import.meta.url)), "camoufox-driver.py");
  const script = "import importlib.util,json,sys; spec=importlib.util.spec_from_file_location('camoufox_driver',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps(module.build_environment_bundle({'fingerprint.seed':'fixture-seed','timezone':'UTC'}),ensure_ascii=False,separators=(',',':')))";
  return JSON.parse(execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, helper], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } }));
}

function backupDir(profileDir: string, backupRef: string): string {
  return join(profileDir, "..", ".recovery", "backups", backupRef.slice("backup:".length));
}

function makePlan(manager: ProfileRecoveryManager, profileRef: string, backupRef: string, key: string, expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  const inspection = manager.inspect(profileRef);
  const prepared = manager.preparePlan({ idempotency_key: `plan-${key}`, operation_ref: `recovery:plan-${key}`, profile_ref: profileRef, backup_ref: backupRef, current_material_fingerprint: inspection.storage_fingerprint! });
  return { ...prepared.plan_inputs, plan_ref: `plan:${key}`, expires_at: expiresAt } as never;
}

function confirmation(key: string, plan: { plan_ref: string }, idempotencyKey = key) {
  return { schema_version: "webenvoy.profile-recovery-confirmation.v1" as const, confirmation_ref: `confirmation:${key}`, plan_ref: plan.plan_ref, confirmed_at: new Date().toISOString(), confirmed_by: "owner" as const, idempotency_key: idempotencyKey, decision: "apply" as const };
}

test("backs up and applies matching storage while keeping state beside the actual storage ref", () => {
  const { facts, profileDir, manager } = fixture();
  const inspection = manager.inspect(facts.profile_ref);
  assert.equal(inspection.status, "completed");
  assert.ok(inspection.storage_fingerprint);

  const backup = manager.backup({ idempotency_key: "backup-1", operation_ref: "recovery:backup-1", profile_ref: facts.profile_ref });
  assert.equal(backup.status, "completed");
  const backupRef = backup.backup_ref;
  assert.ok(backupRef);
  assert.ok(existsSync(join(profileDir, "..", ".recovery", "backups")));

  writeFileSync(join(profileDir, "marker.txt"), "after", { mode: 0o600 });
  const changed = manager.inspect(facts.profile_ref);
  assert.notEqual(changed.storage_fingerprint, inspection.storage_fingerprint);
  const prepared = manager.preparePlan({ idempotency_key: "plan-1", operation_ref: "recovery:plan-1", profile_ref: facts.profile_ref, backup_ref: backupRef!, current_material_fingerprint: changed.storage_fingerprint! });
  const plan = { ...prepared.plan_inputs, plan_ref: "plan:plan-1", expires_at: new Date(Date.now() + 60_000).toISOString() } as never;
  const confirmation = { schema_version: "webenvoy.profile-recovery-confirmation.v1" as const, confirmation_ref: "confirmation:apply-1", plan_ref: "plan:plan-1", confirmed_at: new Date().toISOString(), confirmed_by: "owner" as const, idempotency_key: "apply-1", decision: "apply" as const };
  const applied = manager.apply({
    idempotency_key: "apply-1", operation_ref: "recovery:apply-1", plan,
    confirmation
  });
  assert.equal(applied.status, "completed", JSON.stringify(applied));
  assert.equal(readFileSync(join(profileDir, "marker.txt"), "utf8"), "before");
  assert.equal(manager.getOperation(applied.operation_ref)?.status, "completed");
  assert.equal(manager.apply({
    idempotency_key: "apply-1", operation_ref: "recovery:apply-1", plan,
    confirmation
  }).operation_ref, applied.operation_ref);
});

test("rejects a plan when material changes after planning", () => {
  const { facts, profileDir, manager } = fixture();
  const backup = manager.backup({ idempotency_key: "backup-2", operation_ref: "recovery:backup-2", profile_ref: facts.profile_ref });
  const current = manager.inspect(facts.profile_ref);
  const prepared = manager.preparePlan({ idempotency_key: "plan-2", operation_ref: "recovery:plan-2", profile_ref: facts.profile_ref, backup_ref: backup.backup_ref!, current_material_fingerprint: current.storage_fingerprint! });
  const plan = { ...prepared.plan_inputs, plan_ref: "plan:plan-2", expires_at: new Date(Date.now() + 60_000).toISOString() } as never;
  writeFileSync(join(profileDir, "marker.txt"), "changed-after-plan", { mode: 0o600 });
  const result = manager.apply({
    idempotency_key: "apply-2", operation_ref: "recovery:apply-2", plan,
    confirmation: { schema_version: "webenvoy.profile-recovery-confirmation.v1", confirmation_ref: "confirmation:apply-2", plan_ref: "plan:plan-2", confirmed_at: new Date().toISOString(), confirmed_by: "owner", idempotency_key: "apply-2", decision: "apply" }
  });
  assert.equal(result.status, "rejected");
  assert.equal(readFileSync(join(profileDir, "marker.txt"), "utf8"), "changed-after-plan");
});

test("restores mutable environment settings from a matching backup", () => {
  let restoreCalls = 0;
  const { facts, manager } = fixture(
    { profile: `environment-restore-${randomSuffix()}`, storage: `environment-restore-storage-${randomSuffix()}` },
    { restoreEnvironment: true, onRestore: () => { restoreCalls += 1; } }
  );
  facts.environment.language = "en-US";
  facts.environment.timezone = "UTC";
  facts.environment.viewport = "1280x720";
  const backup = manager.backup({ idempotency_key: "environment-backup", operation_ref: "recovery:environment-backup", profile_ref: facts.profile_ref });
  assert.equal(backup.status, "completed");

  facts.environment.language = "fr-FR";
  facts.environment.timezone = "Europe/Paris";
  facts.environment.viewport = "1024x768";
  const plan = makePlan(manager, facts.profile_ref, backup.backup_ref!, "environment-restore");
  const applied = manager.apply({ idempotency_key: "environment-apply", operation_ref: "recovery:environment-apply", plan, confirmation: confirmation("environment-apply", plan) });

  assert.equal(applied.status, "completed", JSON.stringify(applied));
  assert.equal(restoreCalls, 1);
  assert.deepEqual(
    { language: facts.environment.language, timezone: facts.environment.timezone, viewport: facts.environment.viewport },
    { language: "en-US", timezone: "UTC", viewport: "1280x720" }
  );
  assert.equal(facts.environment.browser_family, "chrome_official");
});

test("rejects a backup plan when a static environment setting changes", () => {
  const { facts, manager } = fixture(
    { profile: `environment-static-${randomSuffix()}`, storage: `environment-static-storage-${randomSuffix()}` },
    { restoreEnvironment: true }
  );
  facts.environment.language = "en-US";
  const backup = manager.backup({ idempotency_key: "environment-static-backup", operation_ref: "recovery:environment-static-backup", profile_ref: facts.profile_ref });
  assert.equal(backup.status, "completed");
  facts.environment.proxy = { state: "configured", proxy_ref: "proxy:changed", label: "changed" };
  assert.throws(
    () => makePlan(manager, facts.profile_ref, backup.backup_ref!, "environment-static-plan"),
    (error: unknown) => error instanceof ProfileRecoveryError && error.code === "recovery_environment_incompatible"
  );
});

test("restores a matching backup when the current Camoufox bundle is corrupt", () => {
  const { facts, profileDir, bundlePath, manager } = camoufoxFixture();
  const backup = manager.backup({ idempotency_key: "camoufox-backup", operation_ref: "recovery:camoufox-backup", profile_ref: facts.profile_ref });
  assert.equal(backup.status, "completed");
  writeFileSync(bundlePath, "{broken", { mode: 0o600 });
  const damaged = manager.inspect(facts.profile_ref);
  assert.equal(damaged.status, "manual_recovery_required");
  assert.equal(damaged.failure?.code, "camoufox_bundle_invalid");
  const plan = makePlan(manager, facts.profile_ref, backup.backup_ref!, "camoufox-apply");
  const applied = manager.apply({ idempotency_key: "camoufox-apply", operation_ref: "recovery:camoufox-apply", plan, confirmation: confirmation("camoufox-apply", plan) });
  assert.equal(applied.status, "completed", JSON.stringify(applied));
  assert.equal(manager.inspect(facts.profile_ref).status, "completed");
  assert.equal(readFileSync(join(profileDir, "marker.txt"), "utf8"), "before");
});

test("retains a non-empty Camoufox profile and refuses automatic bundle reconstruction", () => {
  const { facts, bundlePath, manager } = camoufoxFixture();
  rmSync(bundlePath);
  const inspection = manager.inspect(facts.profile_ref);
  assert.equal(inspection.status, "manual_recovery_required");
  assert.equal(inspection.failure?.code, "camoufox_bundle_missing");
  assert.equal(existsSync(bundlePath), false);
  assert.throws(() => manager.preparePlan({ idempotency_key: "missing-plan", operation_ref: "recovery:missing-plan", profile_ref: facts.profile_ref, backup_ref: "backup:00000000-0000-4000-8000-000000000000", current_material_fingerprint: inspection.storage_fingerprint! }), (error: unknown) => error instanceof ProfileRecoveryError && ["recovery_backup_invalid", "recovery_symlink_refused"].includes(error.code));
  assert.equal(existsSync(bundlePath), false);
});

test("rejects a corrupt backup before switching the current profile", () => {
  const { facts, profileDir, manager } = fixture({ profile: `backup-corrupt-${randomSuffix()}`, storage: `backup-corrupt-storage-${randomSuffix()}` });
  const backup = manager.backup({ idempotency_key: "corrupt-backup", operation_ref: "recovery:corrupt-backup", profile_ref: facts.profile_ref });
  assert.equal(backup.status, "completed");
  const metadataPath = join(backupDir(profileDir, backup.backup_ref!), "backup.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  metadata.schema_version = "corrupt";
  writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  assert.throws(() => makePlan(manager, facts.profile_ref, backup.backup_ref!, "corrupt-plan"), (error: unknown) => error instanceof ProfileRecoveryError && error.code === "recovery_backup_invalid");
  assert.equal(readFileSync(join(profileDir, "marker.txt"), "utf8"), "before");
});

test("rejects a source symlink and a backup symlink without touching the target", () => {
  const source = fixture({ profile: `source-symlink-${randomSuffix()}`, storage: `source-symlink-storage-${randomSuffix()}` });
  writeFileSync(join(root, "symlink-secret"), "outside");
  symlinkSync(join(root, "symlink-secret"), join(source.profileDir, "outside-link"));
  assert.throws(() => source.manager.inspect(source.facts.profile_ref), (error: unknown) => error instanceof ProfileRecoveryError && error.code === "recovery_symlink_refused");
  assert.equal(source.manager.backup({ idempotency_key: "source-link-backup", operation_ref: "recovery:source-link-backup", profile_ref: source.facts.profile_ref }).status, "rejected");

  const backupFixture = fixture({ profile: `backup-symlink-${randomSuffix()}`, storage: `backup-symlink-storage-${randomSuffix()}` });
  const backup = backupFixture.manager.backup({ idempotency_key: "backup-link", operation_ref: "recovery:backup-link", profile_ref: backupFixture.facts.profile_ref });
  assert.equal(backup.status, "completed");
  const backupProfile = join(backupDir(backupFixture.profileDir, backup.backup_ref!), "profile");
  symlinkSync(join(root, "symlink-secret"), join(backupProfile, "outside-link"));
  const plan = makePlan(backupFixture.manager, backupFixture.facts.profile_ref, backup.backup_ref!, "backup-link-plan");
  const applied = backupFixture.manager.apply({ idempotency_key: "backup-link-apply", operation_ref: "recovery:backup-link-apply", plan, confirmation: confirmation("backup-link-apply", plan) });
  assert.equal(applied.status, "rejected");
  assert.equal(readFileSync(join(backupFixture.profileDir, "marker.txt"), "utf8"), "before");
});

test("rejects a backup owned by a different Profile", () => {
  const shared = `wrong-profile-storage-${randomSuffix()}`;
  const first = fixture({ profile: `wrong-profile-a-${randomSuffix()}`, storage: shared });
  const backup = first.manager.backup({ idempotency_key: "wrong-owner-backup", operation_ref: "recovery:wrong-owner-backup", profile_ref: first.facts.profile_ref });
  assert.equal(backup.status, "completed");
  const second = fixture({ profile: `wrong-profile-b-${randomSuffix()}`, storage: shared });
  assert.throws(() => second.manager.preparePlan({ idempotency_key: "wrong-owner-plan", operation_ref: "recovery:wrong-owner-plan", profile_ref: second.facts.profile_ref, backup_ref: backup.backup_ref!, current_material_fingerprint: second.manager.inspect(second.facts.profile_ref).storage_fingerprint! }), (error: unknown) => error instanceof ProfileRecoveryError && error.code === "recovery_backup_invalid");
});

test("refuses backup while a managed Profile lock is present", () => {
  const { facts, profileDir, manager } = fixture({ profile: `locked-${randomSuffix()}`, storage: `locked-storage-${randomSuffix()}` });
  writeFileSync(join(profileDir, ".harbor-profile-lock"), "active", { mode: 0o600 });
  const result = manager.backup({ idempotency_key: "locked-backup", operation_ref: "recovery:locked-backup", profile_ref: facts.profile_ref });
  assert.equal(result.status, "rejected");
  assert.equal(result.failure?.code, "recovery_profile_locked");
  rmSync(join(profileDir, ".harbor-profile-lock"), { force: true });
});

test("rejects an expired plan without changing the current Profile", () => {
  const { facts, profileDir, manager } = fixture({ profile: `expired-${randomSuffix()}`, storage: `expired-storage-${randomSuffix()}` });
  const backup = manager.backup({ idempotency_key: "expired-backup", operation_ref: "recovery:expired-backup", profile_ref: facts.profile_ref });
  assert.equal(backup.status, "completed");
  const plan = makePlan(manager, facts.profile_ref, backup.backup_ref!, "expired-plan", new Date(Date.now() - 1).toISOString());
  const applied = manager.apply({ idempotency_key: "expired-apply", operation_ref: "recovery:expired-apply", plan, confirmation: confirmation("expired-apply", plan) });
  assert.equal(applied.status, "rejected");
  assert.equal(applied.failure?.code, "recovery_confirmation_invalid");
  assert.equal(readFileSync(join(profileDir, "marker.txt"), "utf8"), "before");
});
