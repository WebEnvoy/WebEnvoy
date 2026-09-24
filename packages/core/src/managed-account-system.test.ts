import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAccountSystemDefinitionStore } from "./account-system-definition.js";
import { createManagedAccountSystemReadService, managedAccountSystemReadSchemaVersion } from "./managed-account-system.js";
import { createFileManagedAccessStore, managedSkillOperations } from "./managed-access.js";

type Json = Record<string, any>;
const templateRef = "lode://account-system/github@1.0.0";
const credentialHash = "b".repeat(64);
const template: Json = {
  schema_version: "lode.account-system-template.v1", template_ref: templateRef, account_system_id: "github", version: "1.0.0",
  display_name: "GitHub", related_domains: ["github.com"], products: ["GitHub.com"],
  login_entry: { label: "GitHub sign in", url: "https://github.com/login" },
  admin_entry_points: [{ label: "GitHub profile settings", url: "https://github.com/settings/profile" }],
  known_shared_login_relationships: [],
  source: {
    publisher: "WebEnvoy", repository: "WebEnvoy/Lode", path: "account-systems/github/1.0.0.json", version: "1.0.0",
    evidence_refs: ["https://github.com/login", "https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github"]
  }
};
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

test("installed Agent AccountSystem read checks the existing skill Grant and projects enabled owner-local metadata only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-account-system-agent-read-"));
  try {
    const lodeRoot = join(directory, "lode");
    const templateBytes = Buffer.from(`${JSON.stringify(template, null, 2)}\n`);
    assert.equal(sha256(templateBytes), "8b022fc329a6f75887e465ab561c83ba74d2ab2af1ef0e51a41f3d06b1b4c777");
    await mkdir(join(lodeRoot, "registry"), { recursive: true });
    await mkdir(join(lodeRoot, "account-systems/github"), { recursive: true });
    await writeFile(join(lodeRoot, "registry/account-system-templates.json"), JSON.stringify({
      schema_version: "lode.account-system-template-index.v1", index_id: "lode.account-system-templates",
      entries: [{ template_ref: templateRef, version: "1.0.0", path: "account-systems/github/1.0.0.json", sha256: `sha256:${sha256(templateBytes)}` }]
    }));
    await writeFile(join(lodeRoot, "account-systems/github/1.0.0.json"), templateBytes);

    const definitionStore = createFileAccountSystemDefinitionStore({ directory: join(directory, "owner"), lodeAssetsPath: lodeRoot });
    const imported = await definitionStore.importTemplate({ template_ref: templateRef }) as Json;
    const accessStore = createFileManagedAccessStore({ directory: join(directory, "access") });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "account-read-principal", display_name: "agent", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const grant = await accessStore.createGrant({
      idempotency_key: "account-read-grant", principal_id: principal.principal_id, profile_refs: [],
      allowed_operations: [...managedSkillOperations], allowed_origins: [], expires_at: "2030-01-01T00:00:00.000Z",
      creation_template: null, max_created_profiles: 0,
      skill_scope: { skill_refs: [templateRef], source_refs: [templateRef] }
    });
    const service = createManagedAccountSystemReadService({
      managedAccessStore: accessStore,
      accountSystemDefinitionService: {
        async resolveTemplate(ref: string) {
          const local = await definitionStore.resolveTemplate(ref) as Json;
          return {
            ...local,
            identity_method: { method_ref: "private-should-not-escape" },
            definition: {
              ...local.definition,
              identity_method: { method_ref: "private-should-not-escape" },
              known_shared_login_relationships: [{ system_ref: "private-should-not-escape" }],
              credential_selector: "private-should-not-escape"
            }
          };
        }
      }
    });
    const request = { connection_id: connection.connection_id, grant_id: grant.grant_id, template_ref: templateRef };
    const initial = await service.read(credentialHash, request);
    assert.equal(initial.schema_version, managedAccountSystemReadSchemaVersion);
    assert.equal(initial.local_definition_ref, imported.local_definition_ref);
    assert.equal(initial.local_revision_ref, imported.revision_ref);
    assert.equal(initial.template_sha256, imported.source.template_sha256);
    assert.deepEqual(initial.source, { publisher: "WebEnvoy", repository: "WebEnvoy/Lode", path: "account-systems/github/1.0.0.json", version: "1.0.0" });
    assert.equal(initial.identity_state, "unknown");
    assert.equal(initial.evaluation_state, "not_evaluated");
    assert.equal(Object.hasOwn(initial, "identity_method"), false);
    assert.equal(Object.hasOwn(initial.site, "identity_method"), false);
    assert.equal(Object.hasOwn(initial.site, "known_shared_login_relationships"), false);

    const draft = await definitionStore.createDraft({ local_definition_ref: imported.local_definition_ref, base_revision_ref: imported.revision_ref }) as Json;
    const changed = structuredClone(draft.definition) as Json;
    changed.version = "1.1.0";
    changed.display_name = "GitHub (local)";
    const updated = await definitionStore.updateDraft({ draft_ref: draft.draft_ref, definition: changed }) as Json;
    assert.equal((await definitionStore.checkDraft({ draft_ref: draft.draft_ref }) as Json).valid, true);
    const pinned = await definitionStore.pinDraft({ draft_ref: draft.draft_ref, expected_record_version: imported.record_version }) as Json;
    await definitionStore.enable({ local_definition_ref: imported.local_definition_ref, revision_ref: pinned.revision_ref, expected_record_version: pinned.record_version });
    const ownerProjection = await service.read(credentialHash, request);
    assert.equal(ownerProjection.local_revision_ref, pinned.revision_ref);
    assert.equal(ownerProjection.site.version, "1.1.0");
    assert.equal(ownerProjection.site.display_name, "GitHub (local)");
    assert.equal(updated.definition.source.version, "1.0.0", "local account version keeps source provenance pinned to the imported template version");
    const repeatedImport = await definitionStore.importTemplate({ template_ref: templateRef }) as Json;
    assert.equal(repeatedImport.local_definition_ref, imported.local_definition_ref);
    assert.equal((await service.read(credentialHash, request)).site.display_name, "GitHub (local)", "re-importing the fixed upstream template preserves and consumes the enabled local definition");

    const wrongScope = await accessStore.createGrant({
      idempotency_key: "account-read-wrong-scope", principal_id: principal.principal_id, profile_refs: [],
      allowed_operations: [...managedSkillOperations], allowed_origins: [], expires_at: "2030-01-01T00:00:00.000Z",
      creation_template: null, max_created_profiles: 0,
      skill_scope: { skill_refs: [templateRef], source_refs: [] }
    });
    await assert.rejects(service.read(credentialHash, { ...request, grant_id: wrongScope.grant_id }), /managed_access_denied/);
    await assert.rejects(service.read(credentialHash, { ...request, operation: "account_system.read" }), /managed_account_system_invalid_input/);

    const rolledBack = await definitionStore.rollback({
      local_definition_ref: imported.local_definition_ref,
      revision_ref: imported.revision_ref,
      expected_record_version: pinned.record_version + 1
    }) as Json;
    const rolledBackProjection = await service.read(credentialHash, request);
    assert.equal(rolledBackProjection.local_revision_ref, imported.revision_ref);
    assert.equal(rolledBackProjection.site.display_name, "GitHub");
    const disabled = await definitionStore.disable({ local_definition_ref: imported.local_definition_ref, expected_record_version: rolledBack.record_version });
    await assert.rejects(service.read(credentialHash, request), /account_system_definition_disabled/);
    assert.equal(disabled.enabled, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
