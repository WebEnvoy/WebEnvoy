import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  createFixtureLauncher,
  HarborRuntime,
  LocalIdentityEnvironmentManager,
  type IdentityEnvironmentMutationRequest
} from "./index.js";
import {
  copyRequest,
  copyTarget,
  createMutationInput,
  identityInput,
  importMutationInput,
  isolateProfileStorage,
  mutationTarget,
  mutationHeaders,
  testProviderDetection,
  tempDir
} from "./identity-environment-mutation-test-helpers.js";
import { profileStoragePath } from "./profile-storage.js";
import { startHarborRuntimeServer } from "./server.js";
import type { IdentityEnvironmentMutationPersistenceState } from "./identity-environment-mutation-types.js";

after(isolateProfileStorage("identity-mutations"));

test("persists idempotent receipts and rejects sensitive or conflicting payloads", () => {
  const dir = tempDir("receipts");
  const persistence_path = join(dir, "identity-environments.json");
  try {
    const request: IdentityEnvironmentMutationRequest = {
      operation: "create",
      idempotency_key: "create-identity-1",
      identity_environment: createMutationInput()
    };
    const target = mutationTarget(request);
    const first = new LocalIdentityEnvironmentManager({ persistence_path, provider_detection: testProviderDetection }).mutate(request);
    assert.equal(first.status, "completed");
    assert.equal(first.record?.identity_environment_ref, target.identity_environment_ref);
    assert.equal(JSON.stringify(first).includes(`${target.profile_ref}:storage`), false);

    const reloaded = new LocalIdentityEnvironmentManager({ persistence_path, provider_detection: testProviderDetection });
    assert.deepEqual(reloaded.mutate(request), first);
    assert.equal(reloaded.mutate({
      ...request,
      identity_environment: { ...createMutationInput(), language: "fr-FR" }
    }).failure?.code, "idempotency_conflict");
    assert.equal(reloaded.mutate({
      operation: "import",
      idempotency_key: "import-duplicate-1",
      identity_environment: importMutationInput(`${target.profile_ref}:storage`)
    }).failure?.code, "duplicate_import");

    const sensitive = reloaded.mutate({
      operation: "create",
      idempotency_key: "sensitive-1",
      identity_environment: { ...createMutationInput(), cookie_value: "cookie-secret" }
    } as IdentityEnvironmentMutationRequest);
    assert.equal(sensitive.failure?.code, "invalid_request");
    assert.equal(readFileSync(persistence_path, "utf8").includes("cookie-secret"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allocates owner refs and rejects provider metadata that conflicts with the selected provider", () => {
  const manager = new LocalIdentityEnvironmentManager({ provider_detection: testProviderDetection });
  const request: IdentityEnvironmentMutationRequest = {
    operation: "create",
    idempotency_key: "owner-allocated-create",
    identity_environment: createMutationInput()
  };
  const created = manager.mutate(request);
  assert.equal(created.status, "completed");
  assert.match(created.identity_environment_ref ?? "", /^identity-env_[a-f0-9]{24}$/);
  assert.notEqual(created.identity_environment_ref, "identity-env_fixture");
  assert.deepEqual(manager.mutate(request), created);

  const bypassedTypes = manager.mutate({
    operation: "create",
    idempotency_key: "owner-refs-bypassed-types",
    identity_environment: {
      ...createMutationInput(),
      identity_environment_ref: "caller-identity",
      execution_identity_ref: "caller-execution",
      profile_ref: "caller-profile",
      profile_storage_ref: "caller-storage",
      cookie_jar_ref: "caller-cookie",
      imported_from: "caller-import-source"
    }
  } as unknown as IdentityEnvironmentMutationRequest);
    assert.equal(bypassedTypes.failure?.code, "invalid_request");
    assert.equal(bypassedTypes.identity_environment_ref, null);
    assert.equal(JSON.stringify(bypassedTypes).includes("caller-storage"), false);

    const detectionBypass = manager.mutate({
      operation: "create",
      idempotency_key: "owner-detection-bypassed-types",
      identity_environment: {
        ...createMutationInput(),
        env: { HARBOR_CHROME_PATH: "/bin/echo" },
        platform: "linux",
        path_exists: "not-a-function",
        login_state: "logged_in"
      }
    } as unknown as IdentityEnvironmentMutationRequest);
    assert.equal(detectionBypass.failure?.code, "invalid_request");

  const mismatch = manager.mutate({
    operation: "create",
    idempotency_key: "provider-mismatch-create",
    identity_environment: {
      ...createMutationInput(),
      requested_provider_id: "chrome_official",
      browser_family: "cloakbrowser"
    }
  } as unknown as IdentityEnvironmentMutationRequest);
  assert.equal(mismatch.failure?.code, "invalid_request");
});

test("derives internal import ownership only from the Harbor import source ref", () => {
  const root = tempDir("import-source-boundary");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  const importSourceRef = "harbor-import-source";
  mkdirSync(profileStoragePath(importSourceRef), { recursive: true });
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  try {
    const manager = new LocalIdentityEnvironmentManager({
      provider_detection: testProviderDetection,
      load_state: () => state,
      persist_state: (next) => { state = structuredClone(next); }
    });
    const imported = manager.mutate({
      operation: "import",
      idempotency_key: "import-source-boundary",
      identity_environment: importMutationInput(importSourceRef)
    });
    assert.equal(imported.status, "completed");
    const persisted = state as IdentityEnvironmentMutationPersistenceState | null;
    assert.ok(persisted);
    const record = persisted.records[0];
    assert.equal(record?.local_material_refs.profile_storage_ref, importSourceRef);
    assert.equal(record?.imported_from, importSourceRef);
    const bypassed = manager.mutate({
      operation: "import",
      idempotency_key: "import-source-bypass",
      identity_environment: {
        ...importMutationInput(importSourceRef),
        profile_storage_ref: "caller-profile-storage",
        imported_from: "caller-import-source"
      }
    } as unknown as IdentityEnvironmentMutationRequest);
    assert.equal(bypassed.failure?.code, "invalid_request");
    assert.equal(JSON.stringify(state).includes("caller-profile-storage"), false);
    assert.equal(JSON.stringify(state).includes("caller-import-source"), false);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("persists supported launch configuration and normalizes proxy clearing", () => {
  const manager = new LocalIdentityEnvironmentManager({
    provider_detection: testProviderDetection,
    validate_proxy: (ref) => ref === "proxy-reachable" ? "reachable" : "unreachable",
    resolve_proxy: () => "http://127.0.0.1:8080"
  });
  manager.create(identityInput("identity-edit", "profile-edit"));

  const edited = manager.mutate({
    operation: "edit",
    idempotency_key: "edit-1",
    identity_environment_ref: "identity-edit",
    configuration: {
      proxy_ref: "proxy-reachable",
      proxy_label: "Tokyo",
      geoip_mode: "proxy",
      language: "ja-JP",
      timezone: "Asia/Tokyo",
      viewport: "1440x900"
    }
  });
  assert.equal(edited.status, "completed");
  assert.equal(edited.record?.environment_summary.geoip_mode, "proxy");
  assert.equal(edited.record?.environment_summary.language, "ja-JP");
  assert.equal(edited.record?.environment_summary.timezone, "Asia/Tokyo");
  assert.equal(edited.record?.environment_summary.viewport, "1440x900");
  assert.equal(edited.record?.refs.proxy_ref?.startsWith("proxy_ref_"), true);
  assert.equal(JSON.stringify(edited).includes("proxy-reachable"), false);

  const cleared = manager.mutate({
    operation: "edit",
    idempotency_key: "clear-proxy",
    identity_environment_ref: "identity-edit",
    configuration: { proxy_ref: null }
  });
  assert.equal(cleared.status, "completed");
  assert.equal(cleared.record?.environment_summary.proxy_state, "missing");
  assert.equal(cleared.record?.environment_summary.geoip_mode, "system");
  assert.equal(cleared.record?.refs.proxy_ref, null);

  assert.equal(manager.mutate({
    operation: "edit",
    idempotency_key: "clear-proxy-invalid-geoip",
    identity_environment_ref: "identity-edit",
    configuration: { proxy_ref: null, geoip_mode: "proxy" }
  }).failure?.code, "proxy_policy_incompatible");
  assert.equal(manager.mutate({
    operation: "edit",
    idempotency_key: "unsupported-fields",
    identity_environment_ref: "identity-edit",
    configuration: { region: "JP", interaction_preset: "humanized" }
  }).failure?.code, "unsupported_configuration");
  assert.equal(manager.mutate({
    operation: "edit",
    idempotency_key: "edit-proxy-fail",
    identity_environment_ref: "identity-edit",
    configuration: { proxy_ref: "proxy-down" }
  }).failure?.code, "proxy_unreachable");
});

test("full copy includes owner session material while configuration-only copy excludes it", () => {
  const root = tempDir("profiles");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let localCopyCalls = 0;
  let deletedRefs: unknown = null;
  try {
    const manager = new LocalIdentityEnvironmentManager({
      provider_detection: testProviderDetection,
      stage_local_material_copy: (refs, target) => {
        localCopyCalls += 1;
        assert.deepEqual(refs, { cookie_jar_ref: "source-cookie-ref", browser_storage_ref: "source-browser-storage" });
        const target_refs = {
          cookie_jar_ref: `${target.identity_environment_ref}:cookies`,
          browser_storage_ref: `${target.identity_environment_ref}:storage`
        };
        return { target_refs, commit: () => undefined, rollback: () => true, residual: () => false };
      },
      delete_local_material: (refs) => { deletedRefs = refs; return "deleted"; }
    });
    manager.create({
      ...identityInput("identity-source", "profile-source"),
      profile_storage_ref: "source-profile-storage",
      cookie_jar_ref: "source-cookie-ref",
      browser_storage_ref: "source-browser-storage",
      login_state: "logged_in",
      storage_state: "present",
      language: "ja-JP",
      timezone: "Asia/Tokyo",
      viewport: "1440x900",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书",
        account_identifier: "owner@example.test",
        account_ref: "account-source"
      }
    });
    manager.completeManualAuthentication("identity-source", "session-source");
    const sourcePath = profileStoragePath("source-profile-storage");
    mkdirSync(sourcePath, { recursive: true });
    writeFileSync(join(sourcePath, "session-owner-data"), "cookie-secret");
    writeFileSync(join(sourcePath, "DevToolsActivePort"), "stale");

    const fullRequest = copyRequest("identity-source", "copy-full-1", "copy_full");
    const fullTarget = copyTarget(fullRequest);
    const full = manager.mutate(fullRequest);
    const fullPath = profileStoragePath(`${fullTarget.profile_ref}:storage`);
    assert.equal(full.status, "completed");
    assert.equal(full.effects.login_state, "preserved_unverified");
    assert.equal(full.record?.status.readiness, "unknown");
    assert.equal(full.record?.site.account_ref, "account-source");
    assert.equal(full.record?.environment_summary.timezone, "Asia/Tokyo");
    assert.equal(full.record?.refs.cookie_jar_ref?.startsWith("cookie_jar_ref_"), true);
    assert.equal(readFileSync(join(fullPath, "session-owner-data"), "utf8"), "cookie-secret");
    assert.equal(existsSync(join(fullPath, "DevToolsActivePort")), false);
    assert.equal(JSON.stringify(full).includes("cookie-secret"), false);
    assert.deepEqual(manager.mutate(fullRequest), full);

    const environmentRequest = copyRequest("identity-source", "copy-environment-1");
    const environmentTarget = copyTarget(environmentRequest);
    const environment = manager.mutate(environmentRequest);
    const environmentPath = profileStoragePath(`${environmentTarget.profile_ref}:storage`);
    assert.equal(environment.status, "completed");
    assert.equal(environment.record?.status.login_state, "logged_out");
    assert.equal(environment.record?.site.account_ref, null);
    assert.equal(environment.record?.refs.cookie_jar_ref, null);
    assert.equal(environment.record?.refs.browser_storage_ref, null);
    assert.equal(environment.record?.environment_summary.timezone, "Asia/Tokyo");
    assert.deepEqual(readdirSync(environmentPath), []);
    assert.equal(localCopyCalls, 1);

    const removed = manager.mutate({ operation: "remove", idempotency_key: "remove-1", identity_environment_ref: environmentTarget.identity_environment_ref });
    assert.equal(removed.effects.local_data, "preserved");
    assert.equal(existsSync(environmentPath), true);
    const deleted = manager.mutate({
      operation: "delete",
      idempotency_key: "delete-1",
      identity_environment_ref: fullTarget.identity_environment_ref,
      confirmation: "delete_local_data"
    });
    assert.equal(deleted.status, "completed");
    assert.equal(existsSync(fullPath), false);
    assert.deepEqual(deletedRefs, {
      cookie_jar_ref: `${fullTarget.identity_environment_ref}:cookies`,
      browser_storage_ref: `${fullTarget.identity_environment_ref}:storage`,
      credential_ref: null,
      keychain_ref: null,
      local_secret_ref: null
    });
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("exposes redacted mutation HTTP results with stable authorization and status codes", async () => {
  const token = Buffer.alloc(32, 9).toString("base64url");
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), { provider_detection: testProviderDetection });
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: token });
  try {
    const unauthorized = await fetch(`${running.url}/runtime/identity-environment-mutations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "remove", idempotency_key: "unauthorized", identity_environment_ref: "missing" })
    });
    assert.equal(unauthorized.status, 403);

    const response = await fetch(`${running.url}/runtime/identity-environment-mutations`, {
      method: "POST",
      headers: mutationHeaders(token),
      body: JSON.stringify({
        operation: "create",
        idempotency_key: "http-create-1",
        identity_environment: createMutationInput()
      })
    });
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 201);
    assert.equal(body.schema_version, "harbor-identity-environment-mutation/v1");
    assert.equal(body.status, "completed");
    const httpIdentityRef = body.identity_environment_ref as string;

    const legacyEdit = await fetch(`${running.url}/runtime/identity-environments/${httpIdentityRef}`, {
      method: "PATCH",
      headers: { ...mutationHeaders(token), "idempotency-key": "legacy-edit" },
      body: JSON.stringify({ language: "en-US" })
    });
    assert.equal(legacyEdit.status, 200);
    assert.equal((await legacyEdit.json() as Record<string, any>).record.environment_summary.language, "en-US");

    const malformed = await fetch(`${running.url}/runtime/identity-environment-mutations`, {
      method: "POST",
      headers: mutationHeaders(token),
      body: JSON.stringify({ operation: "delete", idempotency_key: "bad-delete", identity_environment_ref: "identity-http" })
    });
    assert.equal(malformed.status, 400);

    const callerAssignedCreateOwner = await fetch(`${running.url}/runtime/identity-environment-mutations`, {
      method: "POST",
      headers: mutationHeaders(token),
      body: JSON.stringify({
        operation: "create",
        idempotency_key: "caller-assigned-create-owner",
        identity_environment: {
          ...createMutationInput(),
          identity_environment_ref: "caller-identity",
          execution_identity_ref: "caller-execution",
          profile_ref: "caller-profile"
        }
      })
    });
    assert.equal(callerAssignedCreateOwner.status, 400);

    for (const [key, value] of [
      ["env", { HARBOR_CHROME_PATH: "/bin/echo" }],
      ["path_exists", "not-a-function"],
      ["login_state", "logged_in"]
    ] as const) {
      const injected = await fetch(`${running.url}/runtime/identity-environment-mutations`, {
        method: "POST",
        headers: mutationHeaders(token),
        body: JSON.stringify({
          operation: "create",
          idempotency_key: `caller-injected-${key}`,
          identity_environment: { ...createMutationInput(), [key]: value }
        })
      });
      assert.equal(injected.status, 400);
    }

    const legacyInjected = await fetch(`${running.url}/runtime/identity-environments`, {
      method: "POST",
      headers: { ...mutationHeaders(token), "idempotency-key": "legacy-injected-detection" },
      body: JSON.stringify({
        ...createMutationInput(),
        env: { HARBOR_CHROME_PATH: "/bin/echo" },
        login_state: "logged_in"
      })
    });
    assert.equal(legacyInjected.status, 400);

    const callerAssignedCopyTarget = await fetch(`${running.url}/runtime/identity-environment-mutations`, {
      method: "POST",
      headers: mutationHeaders(token),
      body: JSON.stringify({
        operation: "copy_environment",
        idempotency_key: "caller-assigned-copy-target",
        identity_environment_ref: "identity-http",
        target: {
          identity_environment_ref: "caller-target",
          execution_identity_ref: "caller-execution",
          profile_ref: "caller-profile"
        }
      })
    });
    assert.equal(callerAssignedCopyTarget.status, 400);
  } finally {
    await running.close();
  }
});
