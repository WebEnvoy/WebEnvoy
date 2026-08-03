import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createFixtureLauncher, HarborRuntime } from "./index.js";
import {
  copyRequest,
  copyTarget,
  createMutationInput,
  identityInput,
  importMutationInput,
  mutationTarget,
  testProviderDetection,
  tempDir
} from "./identity-environment-mutation-test-helpers.js";
import { providerLaunchArguments } from "./local-provider-launcher.js";
import { acquireProfileStorageOwnership, profileStoragePath } from "./profile-storage.js";

test("maps resolved identity configuration into local browser launch arguments", () => {
  const args = providerLaunchArguments({ headless: true, url: "https://example.test" }, "/private/profile", {
    provider_id: "chrome_official",
    proxy_server: "http://127.0.0.1:8080",
    language: "ja-JP",
    timezone: "Asia/Tokyo",
    viewport: { width: 1440, height: 900 }
  });
  assert.equal(args.includes("--proxy-server=http://127.0.0.1:8080"), true);
  assert.equal(args.includes("--enable-automation"), false);
  assert.equal(args.includes("--lang=ja-JP"), true);
  assert.equal(args.includes("--window-size=1440,900"), true);
  assert.equal(args.at(-1), "about:blank");
  assert.equal(providerLaunchArguments({ headless: true, url: "https://example.test" }, "/private/profile", null).at(-1), "https://example.test");
});

test("default Runtime copies and deletes profile-backed login material without exposing it", async () => {
  await withProfileRoot("profile-backed-material", async () => {
    const runtime = new HarborRuntime(createFixtureLauncher("ready"));
    runtime.createLocalIdentityEnvironment({
      ...identityInput("identity-profile-source", "profile-source"),
      profile_storage_ref: "profile-source:storage",
      cookie_jar_ref: "cookie-source",
      browser_storage_ref: "browser-storage-source",
      login_state: "logged_in",
      storage_state: "present"
    });
    const sourcePath = profileStoragePath("profile-source:storage");
    mkdirSync(sourcePath, { recursive: true });
    writeFileSync(join(sourcePath, "Cookies"), "profile-backed-session");

    const copy = copyRequest("identity-profile-source", "copy-profile-backed-material", "copy_full");
    const target = copyTarget(copy);
    const copied = runtime.mutateLocalIdentityEnvironment(copy);
    assert.equal(copied.status, "completed");
    assert.equal(JSON.stringify(copied).includes("profile-backed-session"), false);
    assert.equal(readFileSync(join(profileStoragePath(`${target.profile_ref}:storage`), "Cookies"), "utf8"), "profile-backed-session");

    const deleted = runtime.mutateLocalIdentityEnvironment({
      operation: "delete",
      idempotency_key: "delete-profile-backed-material",
      identity_environment_ref: target.identity_environment_ref,
      confirmation: "delete_local_data"
    });
    assert.equal(deleted.status, "completed");
    assert.equal(existsSync(profileStoragePath(`${target.profile_ref}:storage`)), false);
  });
});

test("fails closed for active sessions and external profile locks", async () => {
  await withProfileRoot("locks", async () => {
    const runtime = new HarborRuntime(createFixtureLauncher("ready"));
    runtime.createLocalIdentityEnvironment({
      ...identityInput("identity-locked", "profile-locked"),
      profile_storage_ref: "profile-storage-locked",
      login_state: "logged_in",
      storage_state: "present"
    });
    const profilePath = profileStoragePath("profile-storage-locked");
    mkdirSync(profilePath, { recursive: true });
    writeFileSync(join(profilePath, "SingletonLock"), "external-owner");
    const locked = runtime.mutateLocalIdentityEnvironment({
      operation: "edit",
      idempotency_key: "locked-edit-1",
      identity_environment_ref: "identity-locked",
      configuration: { language: "zh-CN" }
    });
    assert.equal(locked.failure?.code, "profile_locked");
    rmSync(join(profilePath, "SingletonLock"));
    symlinkSync("missing-lock-owner", join(profilePath, "SingletonLock"));
    const danglingLock = runtime.mutateLocalIdentityEnvironment({
      operation: "edit",
      idempotency_key: "dangling-lock-edit-1",
      identity_environment_ref: "identity-locked",
      configuration: { language: "zh-CN" }
    });
    assert.equal(danglingLock.failure?.code, "profile_locked");
    rmSync(join(profilePath, "SingletonLock"));

    symlinkSync("test-host-99999999", join(profilePath, "SingletonLock"));
    symlinkSync("stale-cookie", join(profilePath, "SingletonCookie"));
    symlinkSync("/tmp/stale-browser-socket", join(profilePath, "SingletonSocket"));
    writeFileSync(join(profilePath, "DevToolsActivePort"), "65535\n/devtools/browser/stale\n");
    const recoveredStaleBrowser = runtime.mutateLocalIdentityEnvironment({
      operation: "edit",
      idempotency_key: "stale-browser-lock-edit-1",
      identity_environment_ref: "identity-locked",
      configuration: { language: "zh-CN" }
    });
    assert.equal(recoveredStaleBrowser.status, "completed");
    for (const name of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      assert.equal(existsSync(join(profilePath, name)), false);
    }

    const session = await runtime.openManagedIdentityEnvironmentSession({
      identity_environment_ref: "identity-locked",
      url: "https://www.xiaohongshu.com/explore",
      control_owner: "agent"
    });
    assert.equal("status" in session, false);
    const active = runtime.mutateLocalIdentityEnvironment({
      operation: "remove",
      idempotency_key: "active-remove-1",
      identity_environment_ref: "identity-locked"
    });
    assert.equal(active.failure?.code, "active_session");
    if ("status" in session) throw new Error("fixture session should be active");
    await runtime.stopSession(session.runtime_session_ref, { control_owner: "agent" });
    assert.equal(runtime.mutateLocalIdentityEnvironment({
      operation: "remove",
      idempotency_key: "stopped-remove-1",
      identity_environment_ref: "identity-locked"
    }).status, "completed");
  });
});

test("reserves opening sessions before launcher readiness and forwards persisted configuration", async () => {
  await withProfileRoot("opening", async () => {
    let releaseLaunch!: () => void;
    let markStarted!: () => void;
    const launchStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const launchGate = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    const fixture = createFixtureLauncher("ready");
    let capturedTimezone: string | null = null;
    try {
      const runtime = new HarborRuntime(async (input) => {
        capturedTimezone = input.identity_environment?.environment.timezone ?? null;
        markStarted();
        await launchGate;
        return fixture(input);
      }, {
        provider_detection: testProviderDetection,
        validate_proxy: () => "reachable",
        resolve_proxy: () => "http://127.0.0.1:8080"
      });
      const createRequest = {
        operation: "create",
        idempotency_key: "opening-create",
        identity_environment: {
          ...createMutationInput(),
          proxy_ref: "proxy-opening",
          geoip_mode: "proxy",
          language: "ja-JP",
          timezone: "Asia/Tokyo",
          viewport: "1440x900"
        }
      } as const;
      const created = runtime.mutateLocalIdentityEnvironment(createRequest);
      const identityRef = mutationTarget(createRequest).identity_environment_ref;
      assert.equal(created.status, "completed");
      assert.equal(runtime.getManagedLocalIdentityEnvironment(identityRef)?.environment_summary.timezone, "Asia/Tokyo");

      const opening = runtime.openManagedIdentityEnvironmentSession({
        identity_environment_ref: identityRef,
        url: "https://www.xiaohongshu.com/explore",
        control_owner: "agent"
      });
      await launchStarted;
      const blocked = runtime.mutateLocalIdentityEnvironment({
        operation: "remove",
        idempotency_key: "opening-remove",
        identity_environment_ref: identityRef
      });
      assert.equal(blocked.failure?.code, "active_session");
      releaseLaunch();
      const session = await opening;
      assert.equal("status" in session, false);
      assert.equal(capturedTimezone, "Asia/Tokyo");
      if ("status" in session) throw new Error("fixture session should be active");
      assert.equal(session.facts.find((fact) => fact.key === "identity_environment.timezone")?.value, "Asia/Tokyo");
      assert.equal(session.facts.find((fact) => fact.key === "identity_environment.proxy")?.value, "provider_argument_applied");
      assert.equal(JSON.stringify(session).includes("proxy-opening"), false);
    } finally {
      releaseLaunch?.();
    }
  });
});

test("reserves a copy target profile before any copy transaction", async () => {
  await withProfileRoot("target-reservation", async () => {
    let stagedCopies = 0;
    const runtime = new HarborRuntime(createFixtureLauncher("ready"), {
      stage_profile_copy: () => {
        stagedCopies += 1;
        return { commit: () => undefined, rollback: () => true, residual: () => false };
      }
    });
    runtime.createLocalIdentityEnvironment(identityInput("identity-source", "profile-source"));
    const request = copyRequest("identity-source", "target-reserved-copy");
    const target = copyTarget(request);
    runtime.createLocalIdentityEnvironment({
      ...identityInput("identity-holder", "profile-holder"),
      profile_storage_ref: `${target.profile_ref}:storage`
    });
    const session = await runtime.openManagedIdentityEnvironmentSession({
      identity_environment_ref: "identity-holder",
      url: "https://www.xiaohongshu.com/explore",
      control_owner: "agent"
    });
    if ("status" in session) throw new Error("fixture session should be active");
    const result = runtime.mutateLocalIdentityEnvironment(request);
    assert.equal(result.failure?.code, "target_in_use");
    assert.equal(stagedCopies, 0);
    assert.equal(runtime.getManagedLocalIdentityEnvironment(target.identity_environment_ref), null);
    await runtime.stopSession(session.runtime_session_ref, { control_owner: "agent" });
  });
});

test("checks create/import ownership and recovers cross-process locks without ABA release", () => {
  return withProfileRoot("ownership", () => {
    const runtime = new HarborRuntime(createFixtureLauncher("ready"), { provider_detection: testProviderDetection });
    const lockedPath = profileStoragePath("locked-import-storage");
    mkdirSync(lockedPath, { recursive: true });
    writeFileSync(join(lockedPath, "SingletonLock"), "external-owner");
    const locked = runtime.mutateLocalIdentityEnvironment({
      operation: "import",
      idempotency_key: "locked-import",
      identity_environment: importMutationInput("locked-import-storage")
    });
    assert.equal(locked.failure?.code, "profile_locked");

    rmSync(join(lockedPath, "SingletonLock"));
    assert.equal(runtime.mutateLocalIdentityEnvironment({
      operation: "import",
      idempotency_key: "existing-import",
      identity_environment: importMutationInput("locked-import-storage")
    }).status, "completed");
    const existingCreateRequest = {
      operation: "create",
      idempotency_key: "existing-create",
      identity_environment: createMutationInput()
    } as const;
    const existingCreateTarget = mutationTarget(existingCreateRequest);
    mkdirSync(profileStoragePath(`${existingCreateTarget.profile_ref}:storage`), { recursive: true });
    assert.equal(runtime.mutateLocalIdentityEnvironment(existingCreateRequest).failure?.code, "profile_storage_exists");

    const lockRef = "crash-recoverable-lock";
    const ownershipPath = `${profileStoragePath(lockRef)}.ownership-lock`;
    mkdirSync(join(ownershipPath, ".."), { recursive: true });
    writeFileSync(ownershipPath, JSON.stringify({ pid: 99999999, token: "dead-owner" }));
    const recovered = acquireProfileStorageOwnership([lockRef]);
    assert.notEqual(JSON.parse(readFileSync(ownershipPath, "utf8")).token, "dead-owner");
    recovered.release();
    assert.equal(existsSync(ownershipPath), false);

    const staleCreateRequest = {
      operation: "create",
      idempotency_key: "stale-create-lock",
      identity_environment: createMutationInput()
    } as const;
    const staleCreateRef = `${mutationTarget(staleCreateRequest).profile_ref}:storage`;
    const staleCreateOwnershipPath = `${profileStoragePath(staleCreateRef)}.ownership-lock`;
    writeFileSync(staleCreateOwnershipPath, JSON.stringify({ pid: 99999999, token: "dead-create-owner" }));
    const staleCreate = runtime.mutateLocalIdentityEnvironment(staleCreateRequest);
    assert.equal(staleCreate.status, "completed");
    assert.equal(existsSync(staleCreateOwnershipPath), false);

    const truncatedRef = "truncated-owner-lock";
    const truncatedPath = `${profileStoragePath(truncatedRef)}.ownership-lock`;
    writeFileSync(truncatedPath, "");
    assert.throws(() => acquireProfileStorageOwnership([truncatedRef]), /profile_locked/);
    const old = new Date(Date.now() - 60_000);
    utimesSync(truncatedPath, old, old);
    const recoveredTruncated = acquireProfileStorageOwnership([truncatedRef]);
    recoveredTruncated.release();
    assert.equal(existsSync(truncatedPath), false);

    const first = acquireProfileStorageOwnership([lockRef]);
    const firstOwner = readFileSync(ownershipPath, "utf8");
    rmSync(ownershipPath);
    writeFileSync(ownershipPath, firstOwner);
    first.release();
    assert.equal(existsSync(ownershipPath), true);
    rmSync(ownershipPath);
  });
});

async function withProfileRoot(label: string, run: () => void | Promise<void>): Promise<void> {
  const root = tempDir(label);
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  try {
    await run();
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
}
