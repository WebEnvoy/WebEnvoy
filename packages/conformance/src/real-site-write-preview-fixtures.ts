import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createFileRunRecordStore,
  getApprovalCancellationSummary,
  getRunFailureReason,
  getRunResult,
  getRunSummary,
  runRecordSchemaVersion,
  type RunRecord
} from "@webenvoy/core-runtime";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

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

function assertNoSubmit(record: RunRecord): void {
  assert.equal(record.action_request?.no_submit_guard.status, "active");
  assert.equal(record.action_request?.risk_classification.true_write_requested, false);
  assert.equal(record.preview_result?.submitted, false);
  const forbiddenKeys = new Set(["submitted_result", "cookie", "cookies", "token", "tokens", "password", "raw_evidence_body", "full_dom", "network_response_body"]);
  const stack: unknown[] = [record];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `${record.run_id} must not contain ${key}`);
      stack.push(entry);
    }
  }
}

export async function assertRealSiteWritePreviewFixtureQueries(writePreviewFixtures: readonly JsonObject[], directory: string): Promise<void> {
  const writePreviewDirectory = join(directory, "real-site-write-preview");
  await mkdir(writePreviewDirectory, { recursive: true });

  const records = writePreviewFixtures.map((fixture, index) => runRecordFromFixture(fixture, `real site write preview fixture ${index}`));
  for (const [index, record] of records.entries()) {
    const fixture = writePreviewFixtures[index];
    assert(fixture, `real site write preview fixture ${index} must exist`);
    await writeFile(join(writePreviewDirectory, `${record.run_id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }

  const store = createFileRunRecordStore({ directory: writePreviewDirectory });
  const xhs = records.find((record) => record.run_id === "run_fixture_real_site_xiaohongshu_write_preview_001");
  const boss = records.find((record) => record.run_id === "run_fixture_real_site_boss_write_preview_001");
  const pageChanged = records.find((record) => record.run_id === "run_fixture_real_site_write_preview_page_changed_001");
  const cancelled = records.find((record) => record.run_id === "run_fixture_real_site_write_preview_cancelled_001");
  const expired = records.find((record) => record.run_id === "run_fixture_real_site_write_preview_expired_001");
  assert(xhs, "Xiaohongshu write preview fixture must exist");
  assert(boss, "BOSS write preview fixture must exist");
  assert(pageChanged, "page-changed write preview fixture must exist");
  assert(cancelled, "cancelled write preview fixture must exist");
  assert(expired, "expired write preview fixture must exist");

  assert.equal(xhs.action_request?.operation_mode, "draft");
  assert.equal(boss.action_request?.operation_mode, "preview");
  assertNoSubmit(xhs);
  assertNoSubmit(boss);

  const xhsResult = await getRunResult(store, xhs.run_id);
  if (!xhsResult.ok) assert.fail(xhsResult.failure.code);
  assert.equal(xhsResult.result.result.result_envelope?.preview_result?.state, "available");
  assert.equal(xhsResult.result.result.result_envelope?.preview_result?.submitted, false);
  assert.equal(asObject(xhsResult.result.result.result_envelope?.preview_result?.expected_change, "xhs expected_change").external_submit, false);

  const bossSummary = await getRunSummary(store, boss.run_id);
  if (!bossSummary.ok) assert.fail(bossSummary.failure.code);
  assert.equal(bossSummary.run.admission.action_risk, "write");
  assert.equal(bossSummary.run.task.capability_version, "0.1.0");

  const pageChangedResult = await getRunResult(store, pageChanged.run_id);
  if (!pageChangedResult.ok) assert.fail(pageChangedResult.failure.code);
  assert.equal(pageChangedResult.result.status, "failed");
  assert.equal(pageChangedResult.result.result.result_envelope?.preview_result?.failure_class, "page_changed");
  const pageChangedFailure = await getRunFailureReason(store, pageChanged.run_id);
  if (!pageChangedFailure.ok) assert.fail(pageChangedFailure.failure.code);
  assert.equal(pageChangedFailure.failure_reason.reason_class, "page_changed");

  const cancelledResult = await getRunResult(store, cancelled.run_id);
  if (!cancelledResult.ok) assert.fail(cancelledResult.failure.code);
  assert.equal(cancelledResult.result.status, "cancelled");
  assert.equal(cancelledResult.result.result.result_envelope?.outcome, "cancelled");
  assert.equal(cancelledResult.result.failure?.code, "user_cancelled");

  const expiredApproval = await getApprovalCancellationSummary(store, expired.action_request?.action_request_id ?? "");
  assert.equal(expiredApproval.latest_status, "expired");
  assert.equal(expiredApproval.approval_requests[0]?.status, "expired");
  const expiredResult = await getRunResult(store, expired.run_id);
  if (!expiredResult.ok) assert.fail(expiredResult.failure.code);
  assert.equal(expiredResult.result.status, "expired");
  assert.equal(expiredResult.result.result.payload_state, "expired");
}
