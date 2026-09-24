import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAccountSystemDefinitionStore } from "./account-system-definition.js";

type Json = Record<string, any>;
const templateRef = "lode://account-system/github@1.0.0";
const template: Json = {
  schema_version: "lode.account-system-template.v1",
  template_ref: templateRef,
  account_system_id: "github",
  version: "1.0.0",
  display_name: "GitHub",
  related_domains: ["github.com"],
  products: ["GitHub.com"],
  login_entry: { label: "GitHub sign in", url: "https://github.com/login" },
  admin_entry_points: [{ label: "GitHub profile settings", url: "https://github.com/settings/profile" }],
  known_shared_login_relationships: [],
  source: {
    publisher: "WebEnvoy", repository: "WebEnvoy/Lode", path: "account-systems/github/1.0.0.json", version: "1.0.0",
    evidence_refs: ["https://github.com/login", "https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github"]
  }
};
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const asJson = (value: unknown) => value as Json;

async function lodeRoot(directory: string, templateValue: Json = template): Promise<string> {
  const root = join(directory, "lode");
  const templatePath = "account-systems/github/1.0.0.json";
  const bytes = Buffer.from(`${JSON.stringify(templateValue, null, 2)}\n`);
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(join(root, "account-systems/github"), { recursive: true });
  await writeFile(join(root, templatePath), bytes);
  await writeFile(join(root, "registry/account-system-templates.json"), JSON.stringify({
    schema_version: "lode.account-system-template-index.v1",
    index_id: "lode.account-system-templates",
    entries: [{ template_ref: templateRef, version: "1.0.0", path: templatePath, sha256: `sha256:${sha256(bytes)}` }]
  }));
  return root;
}

test("local AccountSystem definitions import a fixed template, preserve owner revisions, and resolve only enabled local refs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-account-system-test-"));
  try {
    const assets = await lodeRoot(directory);
    const service = createFileAccountSystemDefinitionStore({ directory: join(directory, "owner"), lodeAssetsPath: assets });
    const imported = asJson(await service.importTemplate({ template_ref: templateRef }));
    assert.equal(imported.template_ref, templateRef);
    assert.equal(imported.source.template_sha256, `sha256:${sha256(Buffer.from(`${JSON.stringify(template, null, 2)}\n`))}`);
    assert.equal(imported.definition.account_system_id, "github");
    assert.equal(Object.hasOwn(imported.definition, "identity_method"), false, "import must not infer a login identity method");

    const repeatedImport = asJson(await service.importTemplate({ template_ref: templateRef }));
    assert.deepEqual(repeatedImport, imported, "reimporting an existing immutable template is idempotent");
    const firstResolved = asJson(await service.resolve(imported.local_definition_ref));
    assert.equal(firstResolved.revision_ref, imported.revision_ref);
    assert.equal(firstResolved.template_ref, templateRef);
    assert.equal(asJson(await service.resolveTemplate(templateRef)).local_definition_ref, imported.local_definition_ref);

    const draft = asJson(await service.createDraft({ local_definition_ref: imported.local_definition_ref, base_revision_ref: imported.revision_ref }));
    const candidate = structuredClone(draft.definition) as Json;
    candidate.display_name = "GitHub Work";
    candidate.admin_entry_points[0].url = "https://github.com/settings/profile?tab=account";
    candidate.known_shared_login_relationships = [{
      system_ref: "lode://account-system/unapproved@1.0.0",
      relationship: "shared",
      evidence_refs: ["https://example.com/evidence"]
    }];
    await service.updateDraft({ draft_ref: draft.draft_ref, definition: candidate });
    const blockedCheck = asJson(await service.checkDraft({ draft_ref: draft.draft_ref }));
    assert.equal(blockedCheck.valid, false);
    assert.deepEqual(blockedCheck.dependency_check.unresolved_refs, ["lode://account-system/unapproved@1.0.0"]);
    await assert.rejects(service.pinDraft({ draft_ref: draft.draft_ref, expected_record_version: imported.record_version }), /account_system_dependency_unavailable/);
    candidate.known_shared_login_relationships = [];
    const updatedDraft = asJson(await service.updateDraft({ draft_ref: draft.draft_ref, definition: candidate }));
    const checked = asJson(await service.checkDraft({ draft_ref: draft.draft_ref }));
    assert.equal(checked.valid, true);
    assert.deepEqual(checked.changed_paths, ["/admin_entry_points/0/url", "/display_name"]);
    assert.equal(updatedDraft.base_revision_ref, imported.revision_ref);

    const pinned = asJson(await service.pinDraft({ draft_ref: draft.draft_ref, expected_record_version: imported.record_version }));
    assert.notEqual(pinned.revision_ref, imported.revision_ref);
    assert.equal(pinned.definition.display_name, "GitHub Work");
    const enabled = asJson(await service.enable({ local_definition_ref: imported.local_definition_ref, revision_ref: pinned.revision_ref, expected_record_version: pinned.record_version }));
    assert.equal(enabled.enabled_revision_ref, pinned.revision_ref);
    assert.equal(asJson(await service.resolve(imported.local_definition_ref)).definition.display_name, "GitHub Work");

    const rolledBack = asJson(await service.rollback({ local_definition_ref: imported.local_definition_ref, revision_ref: imported.revision_ref, expected_record_version: enabled.record_version }));
    assert.equal(rolledBack.enabled_revision_ref, imported.revision_ref);
    assert.equal(asJson(await service.resolve(imported.local_definition_ref)).revision_ref, imported.revision_ref);
    const historical = asJson(await service.resolve(imported.local_definition_ref, pinned.revision_ref, { historical: true }));
    assert.equal(historical.definition.display_name, "GitHub Work", "rollback must retain the exact historical pin");

    const disabled = asJson(await service.disable({ local_definition_ref: imported.local_definition_ref, expected_record_version: rolledBack.record_version }));
    assert.equal(disabled.enabled, false);
    await assert.rejects(service.resolve(imported.local_definition_ref), /account_system_definition_disabled/);
    await assert.rejects(service.resolveTemplate(templateRef), /account_system_definition_disabled/);
    await assert.rejects(service.resolveTemplate("lode://account-system/missing@1.0.0"), /account_system_definition_unavailable/);
    assert.equal(asJson(await service.resolve(imported.local_definition_ref, pinned.revision_ref, { historical: true })).revision_ref, pinned.revision_ref);

    const reconnected = createFileAccountSystemDefinitionStore({ directory: join(directory, "owner"), lodeAssetsPath: assets });
    const summary = asJson((await reconnected.list())[0]);
    assert.equal(summary?.local_definition_ref, imported.local_definition_ref);
    assert.deepEqual(summary?.revisions.map((revision: Json) => revision.revision_ref), [imported.revision_ref, pinned.revision_ref]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Lode template import fails closed on a changed template digest or unsafe template fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-account-system-reject-test-"));
  try {
    const assets = await lodeRoot(directory);
    const templateFile = join(assets, "account-systems/github/1.0.0.json");
    await writeFile(templateFile, Buffer.from(`${JSON.stringify({ ...template, display_name: "tampered" }, null, 2)}\n`));
    const service = createFileAccountSystemDefinitionStore({ directory: join(directory, "owner"), lodeAssetsPath: assets });
    await assert.rejects(service.importTemplate({ template_ref: templateRef }), /account_system_template_corrupt/);

    const unsafeAssets = await lodeRoot(directory, { ...template, identity_method: { selector: "[data-email]", value: "email" } });
    const unsafeService = createFileAccountSystemDefinitionStore({ directory: join(directory, "other-owner"), lodeAssetsPath: unsafeAssets });
    await assert.rejects(unsafeService.importTemplate({ template_ref: templateRef }), /account_system_template_corrupt/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
