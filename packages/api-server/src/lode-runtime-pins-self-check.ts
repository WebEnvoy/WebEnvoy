import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createFileExecutionPolicyConfigStore,
  createLocalLodePackageResolver,
  executionPolicyMutationSchemaVersion,
  getExecutionPolicyEffectiveView
} from "@webenvoy/core-runtime";

const pinnedSkills = [
  {
    skill_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    action_id: "xhs_search_notes",
    category: "read",
    mode: "auto"
  },
  {
    skill_ref: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
    action_id: "xhs_read_note_detail",
    category: "read",
    mode: "auto"
  },
  {
    skill_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
    action_id: "xhs_publish_note_precheck",
    category: "prepare",
    mode: "confirm"
  }
] as const;

async function main(): Promise<void> {
  const registryPath = process.env.WEBENVOY_LODE_REGISTRY_PATH;
  assert(registryPath, "WEBENVOY_LODE_REGISTRY_PATH is required");
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-lode-runtime-pins-"));
  try {
    const configStore = createFileExecutionPolicyConfigStore({ directory });
    await configStore.putGlobalConfiguration({
      schema_version: executionPolicyMutationSchemaVersion,
      idempotency_key: "lode-runtime-pins-self-check",
      expected_source_version: null,
      modes: { read: "auto", prepare: "confirm", commit: "confirm", destructive: "confirm" }
    });
    const lodePackageResolver = createLocalLodePackageResolver({
      registryPath,
      rootDir: dirname(dirname(registryPath))
    });

    const search = await lodePackageResolver({
      package_ref: pinnedSkills[0].skill_ref,
      task_intent: {}
    });
    assert.equal("category" in search, false);
    if ("category" in search) throw new Error("search declaration did not resolve");
    assert.deepEqual(Object.keys(search.runtime_consumption_declaration?.asset_hashes ?? {}).sort(), [
      "failure_mapping",
      "input_schema",
      "manifest",
      "output_schema",
      "package_lock",
      "post_check",
      "resource_requirements",
      "runtime_consumption_allowlist"
    ]);

    const driftRoot = await mkdtemp(join(tmpdir(), "webenvoy-lode-runtime-pins-drift-"));
    try {
      await cp(dirname(dirname(registryPath)), driftRoot, { recursive: true });
      await appendFile(join(driftRoot, "registry/runtime-consumption-allowlist.json"), "\n");
      const drift = await createLocalLodePackageResolver({
        registryPath: join(driftRoot, "registry/local-packages.json"),
        rootDir: driftRoot
      })({ package_ref: pinnedSkills[0].skill_ref, task_intent: {} });
      assert.equal("category" in drift, true);
      if (!("category" in drift)) throw new Error("asset drift unexpectedly admitted");
      assert.equal(drift.code, "runtime_consumption_asset_pin_mismatch:runtime_consumption_allowlist");
    } finally {
      await rm(driftRoot, { recursive: true, force: true });
    }

    const pathMismatchRoot = await mkdtemp(join(tmpdir(), "webenvoy-lode-runtime-pins-path-mismatch-"));
    try {
      await cp(dirname(dirname(registryPath)), pathMismatchRoot, { recursive: true });
      const pathMismatchRegistryPath = join(pathMismatchRoot, "registry/local-packages.json");
      const pathMismatchRegistry = JSON.parse(await readFile(pathMismatchRegistryPath, "utf8")) as { entries: Record<string, unknown>[] };
      const pathMismatchEntry = pathMismatchRegistry.entries.find((entry) => entry.package_ref === pinnedSkills[0].skill_ref);
      assert(pathMismatchEntry);
      await writeFile(
        join(pathMismatchRoot, "sites/xiaohongshu/search-notes/swapped-manifest.json"),
        await readFile(join(pathMismatchRoot, "sites/xiaohongshu/search-notes/manifest.json"))
      );
      pathMismatchEntry.manifest_path = "sites/xiaohongshu/search-notes/swapped-manifest.json";
      await writeFile(pathMismatchRegistryPath, JSON.stringify(pathMismatchRegistry));
      const pathMismatch = await createLocalLodePackageResolver({ registryPath: pathMismatchRegistryPath, rootDir: pathMismatchRoot })({
        package_ref: pinnedSkills[0].skill_ref,
        task_intent: {}
      });
      assert.equal("category" in pathMismatch, true);
      if (!("category" in pathMismatch)) throw new Error("registry path mismatch unexpectedly admitted");
      assert.equal(pathMismatch.code, "runtime_consumption_asset_path_mismatch:manifest");
    } finally {
      await rm(pathMismatchRoot, { recursive: true, force: true });
    }

    const swappedAssetRoot = await mkdtemp(join(tmpdir(), "webenvoy-lode-runtime-pins-swapped-asset-"));
    try {
      await cp(dirname(dirname(registryPath)), swappedAssetRoot, { recursive: true });
      await writeFile(
        join(swappedAssetRoot, "sites/xiaohongshu/search-notes/resource-requirements.json"),
        await readFile(join(swappedAssetRoot, "sites/xiaohongshu/read-note-detail/resource-requirements.json"))
      );
      const swappedAsset = await createLocalLodePackageResolver({
        registryPath: join(swappedAssetRoot, "registry/local-packages.json"),
        rootDir: swappedAssetRoot
      })({ package_ref: pinnedSkills[0].skill_ref, task_intent: {} });
      assert.equal("category" in swappedAsset, true);
      if (!("category" in swappedAsset)) throw new Error("swapped pinned asset unexpectedly admitted");
      assert.equal(swappedAsset.code, "runtime_consumption_asset_pin_mismatch:resource_requirements");
    } finally {
      await rm(swappedAssetRoot, { recursive: true, force: true });
    }

    for (const expected of pinnedSkills) {
      const view = await getExecutionPolicyEffectiveView(
        { skill_ref: expected.skill_ref },
        { configStore, lodePackageResolver }
      );
      assert.equal(view.skill_ref, expected.skill_ref);
      assert.deepEqual(
        view.actions.map(({ action_id, category }) => ({ action_id, category })),
        [{ action_id: expected.action_id, category: expected.category }]
      );
      assert.equal(view.actions[0]?.effective_policy?.source, "global_user_config");
      assert.equal(view.actions[0]?.effective_policy?.mode, expected.mode);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
