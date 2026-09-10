import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileManagedAccessStore } from "./managed-access.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createFileSkillLibraryService } from "./skill-library.js";

type Json = Record<string, any>;
type FixtureRevision = {
  revision_ref: string;
  source_ref: string;
  source_commit: string;
  path: string;
  content_sha256: string;
  content_bytes: number;
};
type FixtureManifest = { asset_ref: string; revisions: FixtureRevision[] };

const credentialHash = "a".repeat(64);
const expiry = "2099-01-01T00:00:00.000Z";
const skillOperations = [
  "skill.list", "skill.inspect", "skill.install", "skill.enable", "skill.read", "skill.update", "skill.rollback", "skill.disable"
];

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

async function fixtureRoot(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), "apps/desktop/agent-entry/skill-assets"),
    resolve(process.cwd(), "../../apps/desktop/agent-entry/skill-assets"),
    resolve(fileURLToPath(new URL("../../..", import.meta.url)), "apps/desktop/agent-entry/skill-assets")
  ];
  for (const candidate of candidates) {
    try {
      await readFile(join(candidate, "manifest.json"));
      return candidate;
    } catch {
      // Try the next repository-relative candidate.
    }
  }
  throw new Error("skill asset fixture not found");
}

async function copyFixture(destination: string): Promise<FixtureManifest> {
  const root = await fixtureRoot();
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString()) as FixtureManifest;
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "manifest.json"), manifestBytes);
  for (const revision of manifest.revisions) {
    const target = join(destination, revision.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, revision.path), target);
  }
  return manifest;
}

function request(
  connectionId: string,
  grantId: string,
  skillRef: string,
  operation: string,
  idempotencyKey: string,
  sourceRefs: string[],
  extra: Json = {}
): Json {
  return {
    idempotency_key: idempotencyKey,
    connection_id: connectionId,
    grant_id: grantId,
    operation,
    skill_ref: skillRef,
    task_scope: { operations: skillOperations, skill_refs: [skillRef], source_refs: sourceRefs },
    ...extra
  };
}

function result(response: Json): Json {
  assert.equal(response.status, "succeeded");
  assert.equal(response.ok, true);
  return response.result as Json;
}

function failure(response: Json, code: string): void {
  assert.equal(response.ok, false);
  assert.equal(response.status, "failed");
  assert.equal((response.failure as Json).code, code);
}

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => key === "content" || hasContent(item));
}

function installedPath(directory: string, skillRef: string, revisionRef: string): string {
  return join(directory, "skill-library", encodeURIComponent(skillRef), "revisions", `${sha256(revisionRef)}.md`);
}
async function stateAssets(directory: string): Promise<Json[]> {
  try { return (JSON.parse((await readFile(join(directory, "skill-library.json"))).toString("utf8")) as Json).assets as Json[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

test("managed skill revisions enforce source scope, CAS, bytes, idempotency, and recovery boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-skill-library-test-"));
  const sources = join(directory, "sources");
  const accessDirectory = join(directory, "access");
  const runsDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");

  try {
    const manifest = await copyFixture(sources);
    assert.equal(manifest.revisions.length, 2);
    const [r1, r2] = manifest.revisions;
    assert.ok(r1);
    assert.ok(r2);
    const r1Bytes = await readFile(join(sources, r1.path));
    const r2Bytes = await readFile(join(sources, r2.path));
    assert.equal(r1Bytes.byteLength, r1.content_bytes);
    assert.equal(r2Bytes.byteLength, r2.content_bytes);
    assert.equal(sha256(r1Bytes), r1.content_sha256);
    assert.equal(sha256(r2Bytes), r2.content_sha256);

    const accessStore = createFileManagedAccessStore({ directory: accessDirectory });
    const runRecordStore = createFileRunRecordStore({ directory: runsDirectory });
    const service = createFileSkillLibraryService({
      directory: libraryDirectory,
      sourceManifestPath: join(sources, "manifest.json"),
      accessStore,
      runRecordStore
    });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "principal", display_name: "test-agent", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const createGrant = (idempotencyKey: string, sourceRefs?: string[]) => accessStore.createGrant({
      idempotency_key: idempotencyKey,
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: skillOperations,
      allowed_origins: [],
      expires_at: expiry,
      creation_template: null,
      max_created_profiles: 0,
      ...(sourceRefs === undefined ? {} : { skill_scope: { skill_refs: [manifest.asset_ref], source_refs: sourceRefs } })
    });
    const broadGrant = await createGrant("grant-broad", [r1.source_ref, r2.source_ref]);
    const r1Grant = await createGrant("grant-r1", [r1.source_ref]);
    const oldGrant = await createGrant("grant-old");
    const fullScope = [r1.source_ref, r2.source_ref];
    const call = (grantId: string, operation: string, key: string, sourceRefs = fullScope, extra: Json = {}) =>
      service.submit(credentialHash, request(connection.connection_id, grantId, manifest.asset_ref, operation, key, sourceRefs, extra));

    const listed = result(await call(broadGrant.grant_id, "skill.list", "list"));
    assert.equal((listed.skills as Json[]).length, 1);
    assert.equal((listed.skills[0].revisions as Json[]).length, 2);
    assert.equal(hasContent(listed), false);
    const inspected = result(await call(broadGrant.grant_id, "skill.inspect", "inspect"));
    assert.equal((inspected.skill.revisions as Json[]).length, 2);
    assert.equal(hasContent(inspected), false);

    const installR1Input = request(connection.connection_id, broadGrant.grant_id, manifest.asset_ref, "skill.install", "install-r1", fullScope, {
      revision_ref: r1.revision_ref,
      source_ref: r1.source_ref
    });
    const installedR1 = result(await service.submit(credentialHash, installR1Input));
    assert.equal(installedR1.skill.record_version, 1);
    assert.equal(installedR1.idempotent, false);
    assert.equal(hasContent(installedR1), false);

    const reconnectedAccess = createFileManagedAccessStore({ directory: accessDirectory });
    const reconnectedRunRecords = createFileRunRecordStore({ directory: runsDirectory });
    const reconnected = createFileSkillLibraryService({
      directory: libraryDirectory,
      sourceManifestPath: join(sources, "manifest.json"),
      accessStore: reconnectedAccess,
      runRecordStore: reconnectedRunRecords
    });
    const reconnectedConnection = await reconnectedAccess.connect(credentialHash);
    const reconnectedInstallInput = { ...installR1Input, connection_id: reconnectedConnection.connection_id };
    assert.deepEqual(await reconnected.submit(credentialHash, reconnectedInstallInput), { ok: true, run_id: `managed-${sha256(`${principal.principal_id}:install-r1`)}`, status: "succeeded", result: installedR1 });
    assert.deepEqual(((await reconnected.listSource()) as Json).skill.revisions, ((await service.listSource()) as Json).skill.revisions);
    const { revision_ref: _installRevision, source_ref: _installSource, ...installReplayConflict } = installR1Input;
    await assert.rejects(
      reconnected.submit(credentialHash, { ...installReplayConflict, operation: "skill.inspect", idempotency_key: "install-r1" }),
      /managed_skill_idempotency_conflict/
    );

    failure(await call(broadGrant.grant_id, "skill.read", "read-disabled", fullScope, { source_ref: r1.source_ref }), "managed_skill_disabled");
    failure(await call(broadGrant.grant_id, "skill.enable", "enable-no-cas", fullScope, { target_revision_ref: r1.revision_ref, source_ref: r1.source_ref }), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.enable", "enable-wrong-record", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_record_version: 99
    }), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.enable", "enable-wrong-current", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_revision_ref: r2.revision_ref
    }), "managed_skill_conflict");
    const enabledR1 = result(await call(broadGrant.grant_id, "skill.enable", "enable-r1", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_record_version: 1
    }));
    assert.equal(enabledR1.skill.enabled, true);
    assert.equal(enabledR1.skill.enabled_revision_ref, r1.revision_ref);
    assert.equal(enabledR1.skill.record_version, 2);

    const readR1Response = await call(broadGrant.grant_id, "skill.read", "read-r1", fullScope, { source_ref: r1.source_ref });
    const readR1 = result(readR1Response);
    assert.deepEqual(Buffer.from(readR1.content, "utf8"), r1Bytes);
    assert.equal(readR1.revision.content_sha256, r1.content_sha256);
    assert.equal(readR1.receipt.content_sha256, r1.content_sha256);
    assert.equal(readR1.receipt.content_bytes, r1Bytes.byteLength);
    const oldReceipt = structuredClone(readR1.receipt);
    const oldReadRunId = readR1Response.run_id as string;

    const installedR2 = result(await call(broadGrant.grant_id, "skill.install", "install-r2", fullScope, {
      revision_ref: r2.revision_ref, source_ref: r2.source_ref
    }));
    assert.equal(installedR2.skill.record_version, 3);
    assert.equal(hasContent(installedR2), false);

    const r2Path = installedPath(libraryDirectory, manifest.asset_ref, r2.revision_ref);
    await unlink(r2Path);
    failure(await call(broadGrant.grant_id, "skill.enable", "enable-r2-missing", fullScope, {
      target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_record_version: 3
    }), "managed_skill_missing");
    await writeFile(r2Path, Buffer.from("corrupt fixture\n"));
    const corruptInspect = result(await call(broadGrant.grant_id, "skill.inspect", "inspect-r2-corrupt", fullScope));
    assert.equal((corruptInspect.skill.revisions as Json[]).find(item => item.revision_ref === r2.revision_ref)?.local_state, "local_modified");
    failure(await call(broadGrant.grant_id, "skill.enable", "enable-r2-corrupt", fullScope, {
      target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_record_version: 3
    }), "managed_skill_local_modified");
    await writeFile(r2Path, r2Bytes);

    failure(await call(broadGrant.grant_id, "skill.update", "update-no-cas", fullScope, {
      target_revision_ref: r2.revision_ref, source_ref: r2.source_ref
    }), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.update", "update-wrong-record", fullScope, {
      target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_record_version: 99
    }), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.update", "update-wrong-current", fullScope, {
      target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_revision_ref: r2.revision_ref
    }), "managed_skill_conflict");
    const updatedR2 = result(await call(broadGrant.grant_id, "skill.update", "update-r2", fullScope, {
      target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_record_version: 3
    }));
    assert.equal(updatedR2.skill.enabled_revision_ref, r2.revision_ref);
    assert.equal(updatedR2.skill.record_version, 4);

    const readR2 = result(await call(broadGrant.grant_id, "skill.read", "read-r2", fullScope, { source_ref: r2.source_ref }));
    assert.deepEqual(Buffer.from(readR2.content, "utf8"), r2Bytes);
    assert.equal(readR2.revision.content_sha256, r2.content_sha256);
    assert.equal(hasContent(await reconnected.query(credentialHash, oldReadRunId)), false);
    const oldQuery = await reconnected.query(credentialHash, oldReadRunId);
    assert.deepEqual((oldQuery.result as Json).receipt, oldReceipt);
    assert.equal((oldQuery.result as Json).revision.revision_ref, r1.revision_ref);

    const narrowCall = (operation: string, key: string, sourceRefs = [r1.source_ref], extra: Json = {}) =>
      call(r1Grant.grant_id, operation, key, sourceRefs, extra);
    const narrowList = result(await narrowCall("skill.list", "r1-list"));
    assert.deepEqual((narrowList.skills[0].revisions as Json[]).map(item => item.revision_ref), [r1.revision_ref]);
    assert.equal(narrowList.skills[0].enabled, false);
    assert.equal(narrowList.skills[0].enabled_revision_ref, null);
    assert.equal(hasContent(narrowList), false);
    const narrowInspect = result(await narrowCall("skill.inspect", "r1-inspect"));
    assert.deepEqual((narrowInspect.skill.revisions as Json[]).map(item => item.revision_ref), [r1.revision_ref]);
    assert.equal(hasContent(narrowInspect), false);
    failure(await narrowCall("skill.read", "r1-read-while-r2-enabled", [r1.source_ref], { source_ref: r1.source_ref }), "managed_access_denied");
    await assert.rejects(
      narrowCall("skill.inspect", "r1-wide-task", fullScope),
      /managed_access_denied/
    );
    await assert.rejects(
      call(oldGrant.grant_id, "skill.list", "old-grant-list", [r1.source_ref]),
      /managed_access_denied/
    );

    await writeFile(r2Path, Buffer.from("current local modification\n"));
    failure(await call(broadGrant.grant_id, "skill.read", "read-r2-local-modified", fullScope, { source_ref: r2.source_ref }), "managed_skill_local_modified");
    failure(await call(broadGrant.grant_id, "skill.update", "update-local-modified", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_record_version: 4
    }), "managed_skill_local_modified");
    failure(await call(broadGrant.grant_id, "skill.rollback", "rollback-local-modified", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_record_version: 4
    }), "managed_skill_local_modified");
    await writeFile(r2Path, r2Bytes);

    failure(await call(broadGrant.grant_id, "skill.rollback", "rollback-no-cas", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref
    }), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.rollback", "rollback-wrong-current", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_revision_ref: r1.revision_ref
    }), "managed_skill_conflict");
    const rolledBack = result(await call(broadGrant.grant_id, "skill.rollback", "rollback-r1", fullScope, {
      target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_record_version: 4
    }));
    assert.equal(rolledBack.skill.enabled_revision_ref, r1.revision_ref);
    assert.equal(rolledBack.skill.record_version, 5);

    failure(await call(broadGrant.grant_id, "skill.disable", "disable-no-cas", [r1.source_ref]), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.disable", "disable-wrong-record", [r1.source_ref], { expected_record_version: 99 }), "managed_skill_conflict");
    failure(await call(broadGrant.grant_id, "skill.disable", "disable-wrong-current", [r1.source_ref], { expected_revision_ref: r2.revision_ref }), "managed_skill_conflict");
    const disabled = result(await call(broadGrant.grant_id, "skill.disable", "disable-r1", [r1.source_ref], { expected_record_version: 5 }));
    assert.equal(disabled.skill.enabled, false);
    assert.equal(disabled.skill.record_version, 6);
    failure(await call(broadGrant.grant_id, "skill.read", "read-after-disable", [r1.source_ref], { source_ref: r1.source_ref }), "managed_skill_disabled");
    const postDisableReadQuery = await reconnected.query(credentialHash, oldReadRunId);
    assert.equal(hasContent(postDisableReadQuery), false);
    assert.deepEqual((postDisableReadQuery.result as Json).receipt, oldReceipt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("managed skill source manifests fail closed on trust, schema, identity, blob, and compatibility errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-skill-source-test-"));
  const sources = join(directory, "sources");
  const accessDirectory = join(directory, "access");
  const runsDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");

  try {
    const manifest = await copyFixture(sources);
    const manifestPath = join(sources, "manifest.json");
    const originalManifestBytes = await readFile(manifestPath);
    const trustedManifestSha256 = sha256(originalManifestBytes);
    const trustedService = createFileSkillLibraryService({
      directory: libraryDirectory,
      sourceManifestPath: manifestPath,
      trustedManifestSha256,
      accessStore: createFileManagedAccessStore({ directory: accessDirectory }),
      runRecordStore: createFileRunRecordStore({ directory: runsDirectory })
    });
    await trustedService.listSource();

    const alteredManifest = JSON.parse(originalManifestBytes.toString()) as Json;
    alteredManifest.asset_name = "tampered";
    await writeFile(manifestPath, JSON.stringify(alteredManifest));
    await assert.rejects(trustedService.listSource(), /managed_skill_source_corrupt/);
    await writeFile(manifestPath, originalManifestBytes);

    const invalidSchema = JSON.parse(originalManifestBytes.toString()) as Json;
    invalidSchema.unexpected = true;
    await writeFile(manifestPath, JSON.stringify(invalidSchema));
    const untrustedService = createFileSkillLibraryService({
      directory: libraryDirectory,
      sourceManifestPath: manifestPath,
      accessStore: createFileManagedAccessStore({ directory: accessDirectory }),
      runRecordStore: createFileRunRecordStore({ directory: runsDirectory })
    });
    await assert.rejects(untrustedService.listSource(), /managed_skill_source_corrupt/);
    await writeFile(manifestPath, originalManifestBytes);

    const invalidIdentity = JSON.parse(originalManifestBytes.toString()) as Json;
    invalidIdentity.source_path = "other/SKILL.md";
    await writeFile(manifestPath, JSON.stringify(invalidIdentity));
    await assert.rejects(untrustedService.listSource(), /managed_skill_source_corrupt/);
    await writeFile(manifestPath, originalManifestBytes);

    const bytes = Buffer.from(`${await readFile(join(sources, manifest.revisions[0]!.path), "utf8")}tampered`);
    await writeFile(join(sources, manifest.revisions[0]!.path), bytes);
    const blobMismatch = JSON.parse(originalManifestBytes.toString()) as Json;
    blobMismatch.revisions[0].content_sha256 = sha256(bytes);
    blobMismatch.revisions[0].content_bytes = bytes.byteLength;
    await writeFile(manifestPath, JSON.stringify(blobMismatch));

    const accessStore = createFileManagedAccessStore({ directory: accessDirectory });
    const runRecordStore = createFileRunRecordStore({ directory: runsDirectory });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "source-principal", display_name: "source-test", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const grant = await accessStore.createGrant({
      idempotency_key: "source-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: skillOperations,
      allowed_origins: [],
      expires_at: expiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: { skill_refs: [manifest.asset_ref], source_refs: [manifest.revisions[0]!.source_ref] }
    });
    const blobService = createFileSkillLibraryService({ directory: libraryDirectory, sourceManifestPath: manifestPath, accessStore, runRecordStore });
    const blobResult = await blobService.submit(credentialHash, request(connection.connection_id, grant.grant_id, manifest.asset_ref, "skill.install", "blob-mismatch", [manifest.revisions[0]!.source_ref], { revision_ref: manifest.revisions[0]!.revision_ref, source_ref: manifest.revisions[0]!.source_ref }));
    failure(blobResult, "managed_skill_source_corrupt");
    await writeFile(join(sources, manifest.revisions[0]!.path), await readFile(join(await fixtureRoot(), manifest.revisions[0]!.path)));
    await writeFile(manifestPath, originalManifestBytes);

    const incompatible = JSON.parse(originalManifestBytes.toString()) as Json;
    incompatible.revisions[0].compatibility.host = "other-host";
    await writeFile(manifestPath, JSON.stringify(incompatible));
    const compatibilityService = createFileSkillLibraryService({ directory: libraryDirectory, sourceManifestPath: manifestPath, accessStore, runRecordStore });
    const compatibilityResult = await compatibilityService.submit(credentialHash, request(connection.connection_id, grant.grant_id, manifest.asset_ref, "skill.install", "incompatible", [manifest.revisions[0]!.source_ref], { revision_ref: manifest.revisions[0]!.revision_ref, source_ref: manifest.revisions[0]!.source_ref }));
    failure(compatibilityResult, "managed_skill_incompatible");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a committed skill operation reconciles its existing Run after result projection failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-skill-reconcile-test-"));
  const sources = join(directory, "sources");
  const accessDirectory = join(directory, "access");
  const runsDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");
  try {
    const manifest = await copyFixture(sources);
    const accessStore = createFileManagedAccessStore({ directory: accessDirectory });
    const runRecordStore = createFileRunRecordStore({ directory: runsDirectory });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "reconcile-principal", display_name: "reconcile-test", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const grant = await accessStore.createGrant({
      idempotency_key: "reconcile-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: skillOperations,
      allowed_origins: [],
      expires_at: expiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: { skill_refs: [manifest.asset_ref], source_refs: manifest.revisions.map(revision => revision.source_ref) }
    });
    let failNextResultProjection = false;
    const faultingRunRecordStore = {
      ...runRecordStore,
      updateRunRecord: async (...args: Parameters<typeof runRecordStore.updateRunRecord>) => {
        if (failNextResultProjection && args[1].status === "succeeded") {
          failNextResultProjection = false;
          throw new Error("injected_result_projection_failure");
        }
        return runRecordStore.updateRunRecord(...args);
      }
    } as typeof runRecordStore;
    const service = createFileSkillLibraryService({ directory: libraryDirectory, sourceManifestPath: join(sources, "manifest.json"), accessStore, runRecordStore: faultingRunRecordStore });
    const scope = manifest.revisions.map(revision => revision.source_ref);
    const install = await service.submit(credentialHash, request(connection.connection_id, grant.grant_id, manifest.asset_ref, "skill.install", "reconcile-install", scope, { revision_ref: manifest.revisions[0]!.revision_ref, source_ref: manifest.revisions[0]!.source_ref }));
    assert.equal(install.ok, true);
    const enable = await service.submit(credentialHash, request(connection.connection_id, grant.grant_id, manifest.asset_ref, "skill.enable", "reconcile-enable", scope, { target_revision_ref: manifest.revisions[0]!.revision_ref, source_ref: manifest.revisions[0]!.source_ref, expected_record_version: 1 }));
    assert.equal(enable.ok, true);

    failNextResultProjection = true;
    const read = await service.submit(credentialHash, request(connection.connection_id, grant.grant_id, manifest.asset_ref, "skill.read", "reconcile-read", scope, { source_ref: manifest.revisions[0]!.source_ref }));
    assert.equal(read.ok, true);
    assert.equal(hasContent(read), false);
    const run = await runRecordStore.getRunRecord(read.run_id as string);
    assert.equal(run?.status, "succeeded");
    assert.equal(run?.failure, undefined);
    assert.equal(hasContent(run), false);
    const queried = await service.query(credentialHash, read.run_id as string);
    assert.deepEqual(queried, read);
    assert.equal(hasContent(queried), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("managed skill rejects unknown refs, unsafe source paths, local clobbering, stale CAS, and revoked or expired grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-skill-boundary-test-"));
  const sources = join(directory, "sources");
  const accessDirectory = join(directory, "access");
  const runsDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");
  try {
    const manifest = await copyFixture(sources);
    const manifestPath = join(sources, "manifest.json");
    const originalManifestBytes = await readFile(manifestPath);
    const [r1, r2] = manifest.revisions;
    assert.ok(r1);
    assert.ok(r2);
    let accessNow = new Date("2026-01-01T00:00:00.000Z");
    const accessStore = createFileManagedAccessStore({ directory: accessDirectory, clock: () => accessNow });
    const runRecordStore = createFileRunRecordStore({ directory: runsDirectory });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "boundary-principal", display_name: "boundary-test", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const grantExpiry = "2026-01-02T00:00:00.000Z";
    const broadGrant = await accessStore.createGrant({
      idempotency_key: "boundary-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: skillOperations,
      allowed_origins: [],
      expires_at: grantExpiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: { skill_refs: [manifest.asset_ref], source_refs: [r1.source_ref, r2.source_ref] }
    });
    const service = createFileSkillLibraryService({ directory: libraryDirectory, sourceManifestPath: manifestPath, accessStore, runRecordStore });
    const scope = [r1.source_ref, r2.source_ref];
    const call = (grantId: string, operation: string, key: string, sourceRefs = scope, extra: Json = {}) =>
      service.submit(credentialHash, request(connection.connection_id, grantId, manifest.asset_ref, operation, key, sourceRefs, extra));

    await assert.rejects(call(broadGrant.grant_id, "skill.read", "invalid-read-target", scope, { target_revision_ref: r1.revision_ref }), /managed_skill_invalid_input/);
    await assert.rejects(call(broadGrant.grant_id, "skill.list", "invalid-list-cas", scope, { expected_record_version: 0 }), /managed_skill_invalid_input/);
    await assert.rejects(call(broadGrant.grant_id, "skill.install", "invalid-install-target", scope, { revision_ref: r1.revision_ref, target_revision_ref: r1.revision_ref }), /managed_skill_invalid_input/);
    await assert.rejects(call(broadGrant.grant_id, "skill.update", "invalid-update-revision", scope, { revision_ref: r1.revision_ref, expected_record_version: 0 }), /managed_skill_invalid_input/);
    await assert.rejects(call(broadGrant.grant_id, "skill.update", "invalid-update-two-targets", scope, { revision_ref: r1.revision_ref, target_revision_ref: r1.revision_ref, expected_record_version: 0 }), /managed_skill_invalid_input/);
    await assert.rejects(call(broadGrant.grant_id, "skill.disable", "invalid-disable-target", scope, { target_revision_ref: r1.revision_ref, expected_record_version: 0 }), /managed_skill_invalid_input/);
    await assert.rejects(call(broadGrant.grant_id, "skill.list", "k".repeat(513), scope), /managed_skill_invalid_input/);

    const unknownRevision = r1.revision_ref.replace(r1.source_commit, "0".repeat(40));
    failure(await call(broadGrant.grant_id, "skill.install", "unknown-revision", scope, { revision_ref: unknownRevision, source_ref: r1.source_ref }), "managed_skill_revision_unavailable");
    const unknownSource = r1.source_ref.replace(r1.source_commit, "0".repeat(40));
    const sourceGrant = await accessStore.createGrant({
      idempotency_key: "boundary-source-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: skillOperations,
      allowed_origins: [],
      expires_at: grantExpiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: { skill_refs: [manifest.asset_ref], source_refs: [r1.source_ref, unknownSource] }
    });
    failure(await call(sourceGrant.grant_id, "skill.install", "unknown-source", [r1.source_ref, unknownSource], { revision_ref: r1.revision_ref, source_ref: unknownSource }), "managed_skill_source_mismatch");

    const traversalManifest = JSON.parse(originalManifestBytes.toString()) as Json;
    traversalManifest.revisions[0].path = "../escape.md";
    await writeFile(manifestPath, JSON.stringify(traversalManifest));
    await assert.rejects(service.listSource(), /managed_skill_source_corrupt/);
    await writeFile(manifestPath, originalManifestBytes);

    const symlinkManifest = JSON.parse(originalManifestBytes.toString()) as Json;
    symlinkManifest.revisions[0].path = "nested/r1.md";
    await writeFile(manifestPath, JSON.stringify(symlinkManifest));
    const outside = join(directory, "outside");
    await mkdir(outside, { recursive: true });
    await copyFile(join(sources, r1.path), join(outside, "r1.md"));
    await symlink(outside, join(sources, "nested"), "dir");
    failure(await call(broadGrant.grant_id, "skill.install", "source-ancestor-symlink", scope, { revision_ref: r1.revision_ref, source_ref: r1.source_ref }), "managed_skill_source_corrupt");
    await unlink(join(sources, "nested"));
    await writeFile(manifestPath, originalManifestBytes);

    const occupiedPath = installedPath(libraryDirectory, manifest.asset_ref, r1.revision_ref);
    const occupiedBytes = Buffer.from("preexisting local file\n");
    await mkdir(join(libraryDirectory, "skill-library", encodeURIComponent(manifest.asset_ref), "revisions"), { recursive: true });
    await writeFile(occupiedPath, occupiedBytes);
    failure(await call(broadGrant.grant_id, "skill.install", "occupied-destination", scope, { revision_ref: r1.revision_ref, source_ref: r1.source_ref }), "managed_skill_local_modified");
    assert.deepEqual(await readFile(occupiedPath), occupiedBytes);
    assert.deepEqual(await stateAssets(libraryDirectory), []);
    await unlink(occupiedPath);
    const interruptedTempPath = `${occupiedPath}.interrupted.tmp`;
    await writeFile(interruptedTempPath, Buffer.from("partial interrupted install\n"));
    const preInstallList = result(await call(broadGrant.grant_id, "skill.list", "interrupted-list", scope));
    assert.equal((preInstallList.skills[0].revisions as Json[]).some(item => item.installed === true), false);
    failure(await call(broadGrant.grant_id, "skill.read", "interrupted-read", scope, { source_ref: r1.source_ref }), "managed_skill_not_installed");

    const r2SourcePath = join(sources, r2.path);
    const r2Bytes = await readFile(r2SourcePath);
    await unlink(r2SourcePath);
    failure(await call(broadGrant.grant_id, "skill.install", "missing-source-no-partial", scope, { revision_ref: r2.revision_ref, source_ref: r2.source_ref }), "managed_skill_source_missing");
    assert.deepEqual(await stateAssets(libraryDirectory), []);
    await writeFile(r2SourcePath, r2Bytes);
    await truncate(r2SourcePath, 1024 * 1024 + 1);
    failure(await call(broadGrant.grant_id, "skill.install", "oversized-source", scope, { revision_ref: r2.revision_ref, source_ref: r2.source_ref }), "managed_skill_source_corrupt");
    await writeFile(r2SourcePath, r2Bytes);

    assert.equal((await call(broadGrant.grant_id, "skill.install", "real-install", scope, { revision_ref: r1.revision_ref, source_ref: r1.source_ref })).ok, true);
    assert.deepEqual(await readFile(interruptedTempPath), Buffer.from("partial interrupted install\n"));
    const inspectedInstalled = result(await call(broadGrant.grant_id, "skill.inspect", "interrupted-inspect", scope));
    assert.equal((inspectedInstalled.skill.revisions as Json[]).find(item => item.revision_ref === r1.revision_ref)?.local_state, "available");
    assert.equal((await call(broadGrant.grant_id, "skill.enable", "real-enable", scope, { target_revision_ref: r1.revision_ref, source_ref: r1.source_ref, expected_record_version: 1 })).ok, true);
    assert.equal((await call(broadGrant.grant_id, "skill.install", "real-install-r2", scope, { revision_ref: r2.revision_ref, source_ref: r2.source_ref })).ok, true);
    const installedR2Path = installedPath(libraryDirectory, manifest.asset_ref, r2.revision_ref);
    await truncate(installedR2Path, 1024 * 1024 + 1);
    const oversizedInspect = result(await call(broadGrant.grant_id, "skill.inspect", "oversized-installed-inspect", scope));
    assert.equal((oversizedInspect.skill.revisions as Json[]).find(item => item.revision_ref === r2.revision_ref)?.local_state, "local_modified");
    await writeFile(installedR2Path, r2Bytes);
    const concurrent = await Promise.all([
      call(broadGrant.grant_id, "skill.update", "concurrent-update-one", scope, { target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_record_version: 3 }),
      call(broadGrant.grant_id, "skill.update", "concurrent-update-two", scope, { target_revision_ref: r2.revision_ref, source_ref: r2.source_ref, expected_record_version: 3 })
    ]);
    assert.equal(concurrent.filter(item => item.ok).length, 1);
    assert.equal(concurrent.filter(item => !item.ok && (item.failure as Json | undefined)?.code === "managed_skill_conflict").length, 1);
    const read = await call(broadGrant.grant_id, "skill.read", "historical-read", scope, { source_ref: r2.source_ref });
    assert.equal(read.ok, true);
    await accessStore.revokeGrant({ idempotency_key: "boundary-revoke", grant_id: broadGrant.grant_id });
    await assert.rejects(call(broadGrant.grant_id, "skill.read", "read-after-revoke", scope, { source_ref: r2.source_ref }), /grant_unavailable/);
    const historical = await service.query(credentialHash, read.run_id as string);
    assert.equal(hasContent(historical), false);

    const expiringGrant = await accessStore.createGrant({
      idempotency_key: "boundary-expiring-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: skillOperations,
      allowed_origins: [],
      expires_at: grantExpiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: { skill_refs: [manifest.asset_ref], source_refs: scope }
    });
    accessNow = new Date("2026-01-03T00:00:00.000Z");
    await assert.rejects(call(expiringGrant.grant_id, "skill.list", "list-after-expiry", scope), /grant_unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
