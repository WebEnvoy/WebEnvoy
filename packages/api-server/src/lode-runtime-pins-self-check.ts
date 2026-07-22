import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
