import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createFileRunRecordStore,
  getCapabilityRunSummary,
  getRunResult,
  getRunSummary,
  runRecordSchemaVersion,
  type RunRecord
} from "@webenvoy/core-runtime";

type JsonObject = Record<string, unknown>;

function asString(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert((value as string).length > 0, `${label} must not be empty`);
  return value as string;
}

function withoutFixtureSchema(value: JsonObject): JsonObject {
  const normalized = { ...value };
  delete normalized.$schema;
  return normalized;
}

function runRecordFromFixture(value: JsonObject, label: string): RunRecord {
  const record = withoutFixtureSchema(value);
  assert.equal(asString(record.schema_version, `${label}.schema_version`), runRecordSchemaVersion);
  asString(record.run_id, `${label}.run_id`);
  return record as RunRecord;
}

export async function assertRealSiteReadOnlyFixtureQueries(realSiteFixtures: readonly JsonObject[], directory: string): Promise<void> {
  const realSiteDirectory = join(directory, "real-site-readonly");
  await mkdir(realSiteDirectory, { recursive: true });

  const records = realSiteFixtures.map((fixture, index) => runRecordFromFixture(fixture, `real site fixture ${index}`));
  for (const [index, record] of records.entries()) {
    const fixture = realSiteFixtures[index];
    assert(fixture, `real site fixture ${index} must exist`);
    await writeFile(join(realSiteDirectory, `${record.run_id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }

  const realSiteStore = createFileRunRecordStore({ directory: realSiteDirectory });
  const xhs = records.find((record) => record.run_id === "run_fixture_real_site_xiaohongshu_search_notes_001");
  const boss = records.find((record) => record.run_id === "run_fixture_real_site_boss_job_search_001");
  const takeover = records.find((record) => record.run_id === "run_fixture_real_site_boss_user_takeover_001");
  assert(xhs, "Xiaohongshu real-site fixture must exist");
  assert(boss, "BOSS real-site fixture must exist");
  assert(takeover, "user takeover real-site fixture must exist");

  assert.equal(xhs.status, "succeeded");
  assert.equal(xhs.capability_source_ref, "lode://site-capability/xiaohongshu/search-notes@0.1.0");
  assert.equal(xhs.capability_lock_ref, "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0");
  assert.equal(xhs.admission.runtime_session_binding?.session_use, "core_task_run");

  const xhsResult = await getRunResult(realSiteStore, xhs.run_id);
  if (!xhsResult.ok) assert.fail(xhsResult.failure.code);
  assert.equal(xhsResult.result.result.result_envelope?.ok, true);
  assert.equal(xhsResult.result.result.result_envelope?.package_ref, xhs.package_ref);
  assert.equal(xhsResult.result.evidence_refs.every((entry) => entry.raw_access === "not_available_from_core"), true);

  const bossSummary = await getRunSummary(realSiteStore, boss.run_id);
  if (!bossSummary.ok) assert.fail(bossSummary.failure.code);
  assert.equal(bossSummary.run.task.capability_version, "0.1.0");
  assert.equal(bossSummary.run.admission.resource_requirement_refs?.[0], "boss.job-search.resources");
  assert.equal(bossSummary.run.terminal_summary?.post_check?.status, "passed");

  const takeoverResult = await getRunResult(realSiteStore, takeover.run_id);
  if (!takeoverResult.ok) assert.fail(takeoverResult.failure.code);
  assert.equal(takeoverResult.result.status, "manual_recovery_required");
  assert.equal(takeoverResult.result.result.result_envelope?.outcome, "manual_recovery_required");
  assert.equal(takeoverResult.result.failure?.code, "user_takeover");

  const xhsCapabilityRuns = await getCapabilityRunSummary(realSiteStore, {
    capability_ref: "lode:capability/search-notes",
    capability_version: "0.1.0",
    package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0"
  });
  if (!xhsCapabilityRuns.ok) assert.fail(xhsCapabilityRuns.failure.code);
  assert.equal(xhsCapabilityRuns.capability_runs.total_runs, 1);
  assert.equal(xhsCapabilityRuns.capability_runs.status_counts.succeeded, 1);
}
