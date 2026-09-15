import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileManagedAccessStore, managedScopeConfirmationSchemaVersion, ManagedAccessError, type ManagedAccessRequest, type ManagedCreationTemplate } from "./managed-access.js";

const directory = await mkdtemp(join(tmpdir(), "managed-access-check-"));
try {
  const store = createFileManagedAccessStore({ directory });
  const reloaded = createFileManagedAccessStore({ directory });
  const digest = createHash("sha256").update("test-only-credential").digest("hex");
  const principalInput = { idempotency_key: "principal", display_name: "host", credential_hash: digest };
  const principal = await store.registerPrincipal(principalInput);
  assert.deepEqual(await store.registerPrincipal({ credential_hash: digest, display_name: "host", idempotency_key: "principal" }), principal);
  const rejected = async (action: Promise<unknown>, code: string) => assert.rejects(action, (error: unknown) => error instanceof ManagedAccessError && error.code === code);
  await rejected(store.registerPrincipal({ ...principalInput, display_name: "changed" }), "managed_access_idempotency_conflict");
  await rejected(store.authenticateCredential("0".repeat(64)), "managed_access_authentication_required");
  const connection = await store.connect(digest);
  const template: ManagedCreationTemplate = { template_ref: "template:camoufox", provider_id: "camoufox", site: { site_id: "example", origin: "https://example.com", display_name: "Example" }, language: "en-US", timezone: "UTC", permission_ceiling: { allowed_operations: ["profile.list", "profile.read", "instance.start", "instance.observe"], allowed_origins: ["https://example.com"] } };
  const grant = await store.createGrant({ idempotency_key: "grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create", ...template.permission_ceiling.allowed_operations, "instance.stop"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), creation_template: template, max_created_profiles: 2 });
  const request: ManagedAccessRequest = { connection_id: connection.connection_id, grant_id: grant.grant_id, operation: "profile.create", template_ref: template.template_ref, task_scope: { operations: ["profile.create"], profile_refs: [], origins: ["https://example.com"] } };
  assert.deepEqual((await store.checkAccess(digest, request)).creation_template, template);
  await rejected(store.checkAccess(digest, { ...request, template_ref: "template:wider" }), "managed_access_creation_denied");
  await rejected(store.checkAccess(digest, { ...request, permission_ceiling: { allowed_operations: ["instance.stop"] } }), "managed_access_invalid_input");
  await rejected(store.checkAccess(digest, { ...request, connection_id: "connection:forged" }), "managed_access_connection_unavailable");
  await store.recordCreatedProfile({ idempotency_key: "created-a", grant_id: grant.grant_id, profile_ref: "profile:a" });
  await store.recordCreatedProfile({ idempotency_key: "created-b", grant_id: grant.grant_id, profile_ref: "profile:b" });
  await store.recordCreatedProfile({ idempotency_key: "created-a", grant_id: grant.grant_id, profile_ref: "profile:a" });
  await rejected(store.recordCreatedProfile({ idempotency_key: "created-c", grant_id: grant.grant_id, profile_ref: "profile:c" }), "managed_access_creation_denied");
  const access: ManagedAccessRequest = { connection_id: connection.connection_id, grant_id: grant.grant_id, operation: "instance.start", profile_ref: "profile:a", origin: "https://example.com", task_scope: { operations: ["instance.start", "instance.stop"], profile_refs: ["profile:a", "profile:b"], origins: ["https://example.com"] } };
  assert.equal((await reloaded.checkAccess(digest, access)).profile_policy?.profile_ref, "profile:a");
  await rejected(store.checkAccess(digest, { ...access, operation: "instance.stop" }), "managed_access_denied");
  await rejected(store.checkAccess(digest, { ...access, origin: "https://other.example" }), "managed_access_denied");
  await rejected(store.checkAccess(digest, { ...access, task_scope: { ...access.task_scope, profile_refs: ["profile:b"] } }), "managed_access_denied");
  await store.setProfilePolicy({ idempotency_key: "restrict-a", profile_ref: "profile:a", allowed_operations: [], allowed_origins: [] });
  await rejected(reloaded.checkAccess(digest, access), "managed_access_denied");
  assert.equal((await reloaded.checkAccess(digest, { ...access, profile_ref: "profile:b" })).profile_policy?.profile_ref, "profile:b");
  const otherDigest = createHash("sha256").update("other-test-credential").digest("hex");
  await store.registerPrincipal({ idempotency_key: "other-principal", display_name: "other", credential_hash: otherDigest });
  const otherConnection = await store.connect(otherDigest);
  await rejected(store.checkAccess(otherDigest, { ...access, connection_id: otherConnection.connection_id }), "managed_access_denied");
  const quotaGrant = await store.createGrant({ idempotency_key: "quota-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), creation_template: template, max_created_profiles: 1 });
  const concurrent = await Promise.allSettled(["c", "d"].map(id => reloaded.recordCreatedProfile({ idempotency_key: `quota-${id}`, grant_id: quotaGrant.grant_id, profile_ref: `profile:${id}` })));
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(item => item.status === "rejected" && item.reason.code === "managed_access_creation_denied").length, 1);
  await store.revokeGrant({ idempotency_key: "revoke", grant_id: grant.grant_id });
  const reconnect = await reloaded.connect(digest);
  await rejected(reloaded.checkAccess(digest, { ...access, connection_id: reconnect.connection_id, profile_ref: "profile:b" }), "managed_access_grant_unavailable");
  await store.revokeConnection({ idempotency_key: "disconnect", connection_id: reconnect.connection_id });
  await rejected(reloaded.checkAccess(digest, { ...access, connection_id: reconnect.connection_id }), "managed_access_connection_unavailable");

  const v2Directory = await mkdtemp(join(tmpdir(), "managed-access-v2-check-"));
  try {
    const stopped = createFileManagedAccessStore({ directory: v2Directory, withStoppedProfile: async (profileRef, _operationRef, action) => ["profile:v2", "profile:revoked"].includes(profileRef) ? action() : Promise.reject(new ManagedAccessError("managed_access_profile_not_stopped")) });
    const v2Digest = createHash("sha256").update("v2-test-credential").digest("hex");
    const v2Principal = await stopped.registerPrincipal({ idempotency_key: "v2-principal", display_name: "v2 host", credential_hash: v2Digest });
    await stopped.connect(v2Digest);
    const v2ExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const v2Operations = ["profile.list", "profile.read", "instance.start", "instance.observe", "recovery.inspect", "recovery.request", "recovery.status"];
    await stopped.setProfilePolicy({ idempotency_key: "v2-policy", profile_ref: "profile:v2", allowed_operations: v2Operations, allowed_origins: ["https://example.com"] });
    const source = await stopped.createGrant({ idempotency_key: "v2-source", principal_id: v2Principal.principal_id, profile_refs: ["profile:v2"], allowed_operations: v2Operations, allowed_origins: ["https://example.com"], expires_at: v2ExpiresAt, creation_template: null, max_created_profiles: 0 });
    const confirmationInput = {
      idempotency_key: "v2-confirm",
      source_grant_id: source.grant_id,
      profile_ref: "profile:v2",
      confirmation: {
        schema_version: managedScopeConfirmationSchemaVersion,
        confirmation_ref: "confirmation:v2",
        profile_ref: "profile:v2",
        confirmed_at: new Date().toISOString(),
        confirmed_by: "owner",
        idempotency_key: "v2-confirm",
        decision: "apply"
      },
      new_grant: {
        principal_id: v2Principal.principal_id,
        profile_refs: ["profile:v2"],
        allowed_operations: v2Operations,
        allowed_origins: ["https://example.com"],
        expires_at: v2ExpiresAt,
        creation_template: null,
        max_created_profiles: 0
      },
      new_profile_policy: {
        profile_ref: "profile:v2",
        allowed_operations: v2Operations,
        allowed_origins: ["https://example.com"]
      }
    };
    const active = createFileManagedAccessStore({ directory: v2Directory, withStoppedProfile: async () => { throw new ManagedAccessError("managed_access_profile_not_stopped"); } });
    await rejected(active.confirmAgentOperationsV2(confirmationInput), "managed_access_profile_not_stopped");
    await rejected(stopped.confirmAgentOperationsV2({
      ...confirmationInput,
      idempotency_key: "v2-file-expansion",
      confirmation: { ...confirmationInput.confirmation, confirmation_ref: "confirmation:file-expansion", idempotency_key: "v2-file-expansion" },
      new_grant: { ...confirmationInput.new_grant, file_scope: { upload_refs: ["attachment:runtime/00000000-0000-0000-0000-000000000001"], allowed_mime_types: ["image/png"], max_file_bytes: 1024 } }
    }), "managed_access_scope_confirmation_expands_scope");
    await stopped.setProfilePolicy({ idempotency_key: "revoked-policy", profile_ref: "profile:revoked", allowed_operations: ["instance.start"], allowed_origins: ["https://example.com"] });
    const revokedSource = await stopped.createGrant({ idempotency_key: "revoked-source", principal_id: v2Principal.principal_id, profile_refs: ["profile:revoked"], allowed_operations: ["instance.start"], allowed_origins: ["https://example.com"], expires_at: v2ExpiresAt, creation_template: null, max_created_profiles: 0 });
    await stopped.revokeGrant({ idempotency_key: "revoke-source", grant_id: revokedSource.grant_id });
    await rejected(stopped.confirmAgentOperationsV2({
      ...confirmationInput,
      idempotency_key: "revoked-confirm",
      source_grant_id: revokedSource.grant_id,
      profile_ref: "profile:revoked",
      confirmation: { ...confirmationInput.confirmation, confirmation_ref: "confirmation:revoked", profile_ref: "profile:revoked", idempotency_key: "revoked-confirm" },
      new_grant: { ...confirmationInput.new_grant, profile_refs: ["profile:revoked"], allowed_operations: ["instance.start"] },
      new_profile_policy: { ...confirmationInput.new_profile_policy, profile_ref: "profile:revoked", allowed_operations: ["instance.start"] }
    }), "managed_access_scope_confirmation_source_invalid");
    const upgraded = await stopped.confirmAgentOperationsV2(confirmationInput);
    assert.equal(upgraded.scope_semantics, "agent_operations_v2");
    assert.equal(upgraded.source_grant_id, source.grant_id);
    assert.equal((await stopped.list()).grants.find(item => item.grant_id === source.grant_id)?.scope_semantics, undefined);
    assert.equal((await stopped.list()).profile_policies.find(item => item.profile_ref === "profile:v2")?.scope_semantics, "agent_operations_v2");
    assert.deepEqual(await stopped.confirmAgentOperationsV2(confirmationInput), upgraded);
    const legacyScope = { operations: ["profile.list"], profile_refs: ["profile:v2"], origins: ["https://example.com"] };
    const legacyList = await stopped.checkAccess(v2Digest, { connection_id: (await stopped.list()).connections.find(item => item.principal_id === v2Principal.principal_id)!.connection_id, grant_id: source.grant_id, operation: "profile.list", task_scope: legacyScope });
    assert.deepEqual(legacyList.grant.profile_refs, ["profile:v2"]);
    const legacyProfileRead = await stopped.checkAccess(v2Digest, { connection_id: legacyList.connection.connection_id, grant_id: source.grant_id, operation: "profile.read", profile_ref: "profile:v2", task_scope: { operations: ["profile.read"], profile_refs: ["profile:v2"], origins: ["https://example.com"] } });
    assert.equal(legacyProfileRead.profile_policy?.profile_ref, "profile:v2");
    for (const operation of ["recovery.inspect", "recovery.status"] as const) {
      const recoveryAccess = await stopped.checkAccess(v2Digest, { connection_id: legacyList.connection.connection_id, grant_id: source.grant_id, operation, profile_ref: "profile:v2", task_scope: { operations: [operation], profile_refs: ["profile:v2"], origins: ["https://example.com"] } });
      assert.equal(recoveryAccess.profile_policy?.profile_ref, "profile:v2");
    }
    await rejected(stopped.checkAccess(v2Digest, { connection_id: legacyList.connection.connection_id, grant_id: source.grant_id, operation: "instance.start", profile_ref: "profile:v2", origin: "https://example.com", task_scope: { operations: ["instance.start"], profile_refs: ["profile:v2"], origins: ["https://example.com"] } }), "managed_access_scope_semantics_mismatch");
    await rejected(stopped.confirmAgentOperationsV2({ ...confirmationInput, idempotency_key: "v2-confirm-replay", confirmation: { ...confirmationInput.confirmation, idempotency_key: "v2-confirm-replay" } }), "managed_access_scope_confirmation_consumed");
    await rejected(stopped.setProfilePolicy({ idempotency_key: "v2-legacy-downgrade", profile_ref: "profile:v2", allowed_operations: ["instance.start"], allowed_origins: ["https://example.com"] }), "managed_access_scope_confirmation_required");
    assert.equal((await stopped.list()).profile_policies.find(item => item.profile_ref === "profile:v2")?.scope_semantics, "agent_operations_v2");
    await rejected(stopped.setProfilePolicy({ idempotency_key: "v2-direct", profile_ref: "profile:v2", allowed_operations: ["instance.start"], allowed_origins: ["https://example.com"], scope_semantics: "agent_operations_v2" }), "managed_access_invalid_input");
  } finally { await rm(v2Directory, { recursive: true, force: true }); }

  const strictDirectory = await mkdtemp(join(tmpdir(), "managed-access-v0-strict-check-"));
  try {
    const legacy = JSON.parse(await readFile(join(directory, "managed-access.json"), "utf8"));
    legacy.grants[0].creation_template.permission_ceiling.scope_semantics = "agent_operations_v2";
    await writeFile(join(strictDirectory, "managed-access.json"), JSON.stringify(legacy));
    await rejected(createFileManagedAccessStore({ directory: strictDirectory }).list(), "managed_access_store_invalid");
  } finally { await rm(strictDirectory, { recursive: true, force: true }); }

  assert.equal(JSON.stringify(await store.list()).includes(digest), false);
  assert.equal((await readFile(join(directory, "managed-access.json"), "utf8")).includes("test-only-credential"), false);
  await store.revokePrincipal({ idempotency_key: "remove-host", principal_id: principal.principal_id });
  await rejected(reloaded.connect(digest), "managed_access_authentication_required");
  console.log("managed access self-check passed");
} finally { await rm(directory, { recursive: true, force: true }); }
