import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvedAccountSystemTemplates, createFileAccountSystemDefinitionStore, mergeAccountSystemDefinitions } from "./account-system-definition.js";
import type { AccountSystemTemplate } from "./account-system-definition.js";

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
const refreshTemplate: Json = {
  ...template,
  template_ref: "lode://account-system/github@1.0.1",
  version: "1.0.1",
  source: {
    ...template.source,
    path: "account-systems/github/1.0.1.json",
    version: "1.0.1",
    evidence_refs: ["https://github.com/login", "https://docs.github.com/en/account-and-profile/how-tos/account-management/creating-an-account-on-github"]
  }
};
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const asJson = (value: unknown) => value as Json;

test("AccountSystem refresh merge advances template-only metadata and reports same-field edits", () => {
  const base = template as unknown as AccountSystemTemplate;
  const local = { ...base, version: "2.0.0", display_name: "GitHub (local)", related_domains: ["github.com", "github.enterprise"] };
  const nextTemplate = { ...(refreshTemplate as unknown as AccountSystemTemplate), products: ["GitHub.com", "GitHub Enterprise"] };
  const merged = mergeAccountSystemDefinitions(base, local, nextTemplate);
  assert.equal(merged.definition.display_name, "GitHub (local)");
  assert.deepEqual(merged.definition.related_domains, ["github.com", "github.enterprise"]);
  assert.deepEqual(merged.definition.products, ["GitHub.com", "GitHub Enterprise"]);
  assert.equal(merged.definition.source.version, "1.0.1");
  assert.deepEqual(merged.conflicts, [{ path: "/version", base: "1.0.0", local: "2.0.0", template: "1.0.1" }]);
  assert.equal(merged.definition.version, "2.0.0", "unresolved conflicts retain the local value until owner resolution");
});

async function lodeRoot(directory: string, templateValue: Json = template, additionalTemplates: Json[] = []): Promise<string> {
  const root = join(directory, "lode");
  const templates = [templateValue, ...additionalTemplates];
  await mkdir(join(root, "registry"), { recursive: true });
  await mkdir(join(root, "account-systems/github"), { recursive: true });
  const entries = [];
  for (const item of templates) {
    const pin = approvedAccountSystemTemplates[item.template_ref as keyof typeof approvedAccountSystemTemplates];
    const bytes = Buffer.from(`${JSON.stringify(item, null, 2)}\n`);
    await writeFile(join(root, pin.path), bytes);
    entries.push({ template_ref: item.template_ref, version: item.version, path: pin.path, sha256: `sha256:${sha256(bytes)}` });
  }
  await writeFile(join(root, "registry/account-system-templates.json"), JSON.stringify({
    schema_version: "lode.account-system-template-index.v1",
    index_id: "lode.account-system-templates",
    entries
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

test("owner template refresh merges local fields, requires explicit conflict resolution, pins provenance, enables and rolls back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-account-system-refresh-test-"));
  try {
    const refreshPin = approvedAccountSystemTemplates[refreshTemplate.template_ref as keyof typeof approvedAccountSystemTemplates];
    const refreshBytes = Buffer.from(`${JSON.stringify(refreshTemplate, null, 2)}\n`);
    assert.equal(`sha256:${sha256(refreshBytes)}`, refreshPin.sha256, "the approved Core pin must match the committed Lode template bytes");
    const assets = await lodeRoot(directory, template, [refreshTemplate]);
    const service = createFileAccountSystemDefinitionStore({ directory: join(directory, "owner"), lodeAssetsPath: assets });
    const imported = asJson(await service.importTemplate({ template_ref: templateRef }));
    const ownerDraft = asJson(await service.createDraft({ local_definition_ref: imported.local_definition_ref, base_revision_ref: imported.revision_ref }));
    const localDefinition = structuredClone(ownerDraft.definition) as Json;
    localDefinition.version = "2.0.0";
    localDefinition.display_name = "GitHub (local)";
    localDefinition.related_domains.push("github.enterprise");
    await service.updateDraft({ draft_ref: ownerDraft.draft_ref, definition: localDefinition });
    const ownerCheck = asJson(await service.checkDraft({ draft_ref: ownerDraft.draft_ref }));
    assert.equal(ownerCheck.valid, true);
    const localPin = asJson(await service.pinDraft({ draft_ref: ownerDraft.draft_ref, expected_record_version: imported.record_version }));
    const localEnabled = asJson(await service.enable({ local_definition_ref: imported.local_definition_ref, revision_ref: localPin.revision_ref, expected_record_version: localPin.record_version }));

    const refreshDraft = asJson(await service.createRefreshDraft({
      local_definition_ref: imported.local_definition_ref, base_revision_ref: localPin.revision_ref, template_ref: refreshTemplate.template_ref
    }));
    assert.equal(refreshDraft.definition.display_name, "GitHub (local)");
    assert.deepEqual(refreshDraft.definition.related_domains, ["github.com", "github.enterprise"]);
    assert.equal(refreshDraft.definition.source.version, "1.0.1");
    assert.deepEqual(refreshDraft.merge_conflicts.map((conflict: Json) => conflict.path), ["/version"]);
    assert.deepEqual(refreshDraft.merge_conflicts[0], { path: "/version", base: "1.0.0", local: "2.0.0", template: "1.0.1", resolution: null });
    const unresolved = asJson(await service.checkDraft({ draft_ref: refreshDraft.draft_ref }));
    assert.equal(unresolved.valid, false);
    assert.equal(unresolved.reason, "account_system_merge_conflicts_unresolved");
    assert.deepEqual(unresolved.unresolved_conflicts, ["/version"]);
    await assert.rejects(service.pinDraft({ draft_ref: refreshDraft.draft_ref, expected_record_version: localEnabled.record_version }), /account_system_merge_conflicts_unresolved/);
    assert.equal(asJson(await service.resolve(imported.local_definition_ref)).revision_ref, localPin.revision_ref,
      "the active provenance stays on the prior revision until pin and enable complete");

    const resolvedDraft = asJson(await service.updateDraft({
      draft_ref: refreshDraft.draft_ref, definition: refreshDraft.definition,
      conflict_resolutions: [{ path: "/version", choice: "template" }]
    }));
    assert.equal(resolvedDraft.definition.version, "1.0.1");
    const checked = asJson(await service.checkDraft({ draft_ref: refreshDraft.draft_ref }));
    assert.equal(checked.valid, true);
    assert.deepEqual(checked.unresolved_conflicts, []);
    await assert.rejects(service.pinDraft({ draft_ref: refreshDraft.draft_ref, expected_record_version: localEnabled.record_version - 1 }), /account_system_conflict/);
    assert.equal(asJson(await service.resolve(imported.local_definition_ref)).revision_ref, localPin.revision_ref);

    const refreshed = asJson(await service.pinDraft({ draft_ref: refreshDraft.draft_ref, expected_record_version: localEnabled.record_version }));
    assert.equal(refreshed.template_ref, refreshTemplate.template_ref);
    assert.equal(refreshed.source.template_sha256, refreshPin.sha256);
    assert.equal(asJson(await service.resolve(imported.local_definition_ref)).revision_ref, localPin.revision_ref);
    const enabled = asJson(await service.enable({ local_definition_ref: imported.local_definition_ref, revision_ref: refreshed.revision_ref, expected_record_version: refreshed.record_version }));
    const current = asJson(await service.resolve(imported.local_definition_ref));
    assert.equal(current.revision_ref, refreshed.revision_ref);
    assert.equal(current.template_ref, refreshTemplate.template_ref);
    assert.equal(current.definition.display_name, "GitHub (local)");
    assert.equal(current.definition.source.version, "1.0.1");

    const rolledBack = asJson(await service.rollback({ local_definition_ref: imported.local_definition_ref, revision_ref: localPin.revision_ref, expected_record_version: enabled.record_version }));
    assert.equal(rolledBack.enabled_revision_ref, localPin.revision_ref);
    const restored = asJson(await service.resolve(imported.local_definition_ref));
    assert.equal(restored.template_ref, templateRef);
    assert.equal(restored.template_sha256, imported.source.template_sha256);
    assert.equal(restored.definition.version, "2.0.0");
    assert.equal(restored.definition.display_name, "GitHub (local)");
    assert.equal(asJson(await service.resolve(imported.local_definition_ref, refreshed.revision_ref, { historical: true })).template_ref, refreshTemplate.template_ref);
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
