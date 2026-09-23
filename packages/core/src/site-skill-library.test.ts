import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileManagedAccessStore, managedSkillOperations } from "./managed-access.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createFileSkillLibraryService } from "./skill-library.js";

type Json = Record<string, any>;
type SitePin = {
  package_ref: string;
  revision_ref: string;
  package_digest: string;
  task_ref: string;
  source_ref: string;
  package_path: string;
};

const lodeRoot = process.env.WEBENVOY_LODE_ROOT;
const credentialHash = "b".repeat(64);
const expiry = "2099-01-01T00:00:00.000Z";
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

async function sitePin(root: string): Promise<SitePin> {
  const registry = JSON.parse(await readFile(join(root, "registry/local-packages.json"), "utf8")) as Json;
  assert.equal(registry.schema_version, "lode.local-package-index.v0");
  assert(Array.isArray(registry.entries));
  const entries = registry.entries.filter((entry: Json) => entry.package_ref === "lode://site-skill/controlled-local/page-summary");
  assert.equal(entries.length, 1, "the pinned Lode root must contain one controlled-local site task package");
  const entry = entries[0] as Json;
  assert.equal(entry.package_type, "site-skill");
  assert.equal(entry.task_refs?.length, 1);
  const manifest = JSON.parse(await readFile(join(root, entry.manifest_path), "utf8")) as Json;
  return {
    package_ref: entry.package_ref,
    revision_ref: entry.revision_ref,
    package_digest: entry.package_digest,
    task_ref: entry.task_refs[0],
    source_ref: manifest.source.source_ref,
    package_path: entry.package_path
  };
}

function request(connectionId: string, grantId: string, pin: SitePin, operation: string, key: string, extra: Json = {}): Json {
  return {
    idempotency_key: key,
    connection_id: connectionId,
    grant_id: grantId,
    operation,
    skill_ref: pin.package_ref,
    task_scope: { operations: [...managedSkillOperations], skill_refs: [pin.package_ref], source_refs: [pin.source_ref] },
    ...extra
  };
}

function listRequest(connectionId: string, grantId: string, key: string, skillRefs: string[], sourceRefs: string[]): Json {
  return {
    idempotency_key: key,
    connection_id: connectionId,
    grant_id: grantId,
    operation: "skill.list",
    task_scope: { operations: [...managedSkillOperations], skill_refs: skillRefs, source_refs: sourceRefs }
  };
}

function result(response: Json): Json {
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.status, "succeeded");
  assert(response.result && typeof response.result === "object");
  return response.result as Json;
}

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => key === "content" || hasContent(item));
}

function packageDirectory(libraryDirectory: string, pin: SitePin): string {
  return join(libraryDirectory, "skill-library", encodeURIComponent(pin.package_ref), "revisions", encodeURIComponent(sha256(pin.revision_ref)));
}

test("pinned site SKILL lifecycle keeps metadata, bytes, installation integrity, and authorization separate", {
  skip: lodeRoot ? false : "WEBENVOY_LODE_ROOT is not configured; no pinned Lode package source is available"
}, async () => {
  if (!lodeRoot) return;
  const root = resolve(lodeRoot);
  const pin = await sitePin(root);
  const packageManifest = JSON.parse(await readFile(join(root, pin.package_path, "manifest.json"), "utf8")) as Json;
  const sourceSkill = await readFile(join(root, pin.package_path, "SKILL.md"));
  const legacyManifestPath = join(resolve(fileURLToPath(new URL("../../..", import.meta.url))), "apps/desktop/agent-entry/skill-assets/manifest.json");
  const legacyManifest = JSON.parse(await readFile(legacyManifestPath, "utf8")) as Json;
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-site-skill-library-test-"));
  const accessDirectory = join(directory, "access");
  const runsDirectory = join(directory, "runs");
  const libraryDirectory = join(directory, "library");

  try {
    const accessStore = createFileManagedAccessStore({ directory: accessDirectory });
    const runRecordStore = createFileRunRecordStore({ directory: runsDirectory });
    const skillLibraryService = createFileSkillLibraryService({ directory: libraryDirectory, sourceManifestPath: legacyManifestPath, lodeAssetsPath: root, accessStore, runRecordStore });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "site-task-principal", display_name: "site-task-test", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const grant = await accessStore.createGrant({
      idempotency_key: "site-task-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: [...managedSkillOperations],
      allowed_origins: [],
      expires_at: expiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: { skill_refs: [pin.package_ref], source_refs: [pin.source_ref] }
    });
    const legacySourceRefs = legacyManifest.revisions.map((revision: Json) => revision.source_ref) as string[];
    const bothGrant = await accessStore.createGrant({
      idempotency_key: "site-task-both-grant",
      principal_id: principal.principal_id,
      profile_refs: [],
      allowed_operations: [...managedSkillOperations],
      allowed_origins: [],
      expires_at: expiry,
      creation_template: null,
      max_created_profiles: 0,
      skill_scope: {
        skill_refs: [legacyManifest.asset_ref, pin.package_ref],
        source_refs: [...legacySourceRefs, pin.source_ref]
      }
    });
    const call = (operation: string, key: string, extra: Json = {}) => skillLibraryService.submit(credentialHash,
      request(connection.connection_id, grant.grant_id, pin, operation, key, extra));

    const siteOnlyList = result(await skillLibraryService.submit(credentialHash, listRequest(
      connection.connection_id, grant.grant_id, "site-task-site-only-list", [pin.package_ref], [pin.source_ref]
    )));
    assert.deepEqual(siteOnlyList.skills.map((skill: Json) => skill.skill_ref), [pin.package_ref]);
    assert.equal(siteOnlyList.skills[0].site_tasks.tasks[0].runtime_state, "not_evaluated");

    const bothScopeList = result(await skillLibraryService.submit(credentialHash, listRequest(
      connection.connection_id,
      bothGrant.grant_id,
      "site-task-both-scope-list",
      [legacyManifest.asset_ref, pin.package_ref],
      [...legacySourceRefs, pin.source_ref]
    )));
    assert.deepEqual(
      bothScopeList.skills.map((skill: Json) => skill.skill_ref).sort(),
      [legacyManifest.asset_ref, pin.package_ref].sort(),
      "a broad scope includes both the legacy package and the site package"
    );

    const inspection = result(await call("skill.inspect", "site-task-inspect"));
    assert.equal(inspection.skill.skill_ref, pin.package_ref);
    assert.equal(inspection.skill.site_tasks.schema_version, "webenvoy.site-task-summary/v1");
    assert.equal(inspection.skill.site_tasks.package_ref, pin.package_ref);
    assert.equal(inspection.skill.site_tasks.revision_ref, pin.revision_ref);
    assert.equal(inspection.skill.site_tasks.package_digest, pin.package_digest);
    assert.deepEqual(inspection.skill.site_tasks.tasks.map((task: Json) => task.task_ref), [pin.task_ref]);
    assert.equal(inspection.skill.site_tasks.tasks[0].task_support, "declared");
    assert.equal(inspection.skill.site_tasks.tasks[0].runtime_state, "not_evaluated");
    assert.equal(JSON.stringify(inspection).includes("executable_ready"), false);
    assert.equal(hasContent(inspection), false);

    const installed = result(await call("skill.install", "site-task-install", { revision_ref: pin.revision_ref, source_ref: pin.source_ref }));
    assert.equal(installed.skill.enabled, false, "install must leave the revision disabled");
    assert.equal(installed.skill.record_version, 1);

    const resolverRequest = { package_ref: pin.package_ref, revision_ref: pin.revision_ref, package_digest: pin.package_digest, task_ref: pin.task_ref };
    await assert.rejects(skillLibraryService.resolveManagedSiteTask(resolverRequest), /managed_skill_disabled/);
    const enabled = result(await call("skill.enable", "site-task-enable", {
      target_revision_ref: pin.revision_ref, source_ref: pin.source_ref, expected_record_version: 1
    }));
    assert.equal(enabled.skill.enabled, true);
    assert.equal(enabled.skill.enabled_revision_ref, pin.revision_ref);
    assert.equal(enabled.skill.record_version, 2);

    const readResponse = await call("skill.read", "site-task-read", { source_ref: pin.source_ref });
    const read = result(readResponse);
    assert.equal(read.content, sourceSkill.toString("utf8"), "read returns the verified Lode SKILL bytes");
    assert.equal(read.revision.content_sha256, packageManifest.integrity.files.find((file: Json) => file.path === "SKILL.md").sha256.slice("sha256:".length));
    assert.equal(typeof readResponse.run_id, "string");
    assert.equal(hasContent(await skillLibraryService.query(credentialHash, readResponse.run_id as string)), false, "query returns only the read receipt, never the SKILL content");
    const resolved = await skillLibraryService.resolveManagedSiteTask(resolverRequest);
    assert.equal(resolved.package_ref, pin.package_ref);
    assert.equal(resolved.revision_ref, pin.revision_ref);
    assert.deepEqual(resolved.skill_text, sourceSkill);
    assert.equal(resolved.capability.operation_id, "instance.snapshot");
    assert.equal(resolved.capability.action, "read");
    assert(resolved.input_schema && resolved.output_schema && resolved.post_check);
    assert.deepEqual(
      resolved.files.map((file: Json) => file.path),
      packageManifest.integrity.files.map((file: Json) => file.path),
      "resolver returns every integrity-listed package file"
    );
    assert(resolved.files.some((file: Json) => file.path === "SKILL.md"));

    const installRoot = packageDirectory(libraryDirectory, pin);
    const jsonAsset = resolved.files.find((file: Json) => file.path.endsWith(".json") && file.path !== "manifest.json");
    assert(jsonAsset, "the pinned package must materialize a non-SKILL JSON asset");
    const modifiedPath = join(installRoot, jsonAsset.path);
    const originalJson = await readFile(modifiedPath);
    const modifiedJson = Buffer.concat([originalJson, Buffer.from("\nlocal test modification\n")]);
    await writeFile(modifiedPath, modifiedJson);
    await assert.rejects(skillLibraryService.resolveManagedSiteTask(resolverRequest), /managed_skill_local_modified/);
    assert.deepEqual(await readFile(modifiedPath), modifiedJson, "resolver must preserve rather than repair the modified local asset");
    assert.deepEqual(await readFile(join(installRoot, "SKILL.md")), sourceSkill, "the intact SKILL bytes remain unchanged");
    await writeFile(modifiedPath, originalJson);
    await rm(modifiedPath);
    await assert.rejects(skillLibraryService.resolveManagedSiteTask(resolverRequest), /managed_skill_missing/);
    await writeFile(modifiedPath, originalJson);

    const disabled = result(await call("skill.disable", "site-task-disable", { expected_record_version: 2 }));
    assert.equal(disabled.skill.enabled, false);
    await assert.rejects(skillLibraryService.resolveManagedSiteTask(resolverRequest), /managed_skill_disabled/);

    await accessStore.revokeGrant({ idempotency_key: "site-task-revoke", grant_id: grant.grant_id });
    await assert.rejects(call("skill.inspect", "site-task-inspect-after-revoke"), /grant_unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
