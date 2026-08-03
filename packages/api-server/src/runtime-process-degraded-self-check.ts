import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bossPackageRef, bossTaskIntent, taskIntent } from "./runtime-process-fixture.js";
import { asRecord, getJson, postJson, reservePort, spawnApiServer, stopProcess, waitForJson, type JsonObject } from "./self-check-process-support.js";

async function assertAdmissionQueries(port: number): Promise<void> {
  const admission = await getJson(port, "/admission/health");
  assert.equal(admission.status, 200);
  const admissionBody = asRecord(admission.body);
  assert.equal(admissionBody.status, "degraded");
  const checks = asRecord(admissionBody.checks);
  assert.equal(checks.runRecordStore, "configured");
  assert.equal(checks.lodePackageResolver, "missing");
  assert.equal(checks.harborRuntimeClient, "missing");
  const capabilityRuns = await getJson(port, "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0&limit=8");
  const envelope = asRecord(asRecord(capabilityRuns.body).capability_runs);
  assert.equal(capabilityRuns.status, 200);
  assert.equal(envelope.total_runs, 0);
  assert.deepEqual(envelope.runs, []);
  const missingCapabilityRef = await getJson(port, "/capability-runs");
  assert.equal(missingCapabilityRef.status, 400);
  assert.equal(asRecord(asRecord(missingCapabilityRef.body).error).code, "capability_ref_required");
}

async function assertBossQueryValidation(port: number): Promise<void> {
  const valid = await postJson(port, "/tasks", {
    run_id: "run_process_boss_query_valid", package_ref: bossPackageRef,
    task_intent: bossTaskIntent("intent_process_boss_query_valid"),
    public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
    harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
  });
  assert.equal(valid.status, 422);
  assert.equal(asRecord(asRecord(valid.body).error).code, "lode_resolver_unconfigured");
  const invalidQueries: Array<{ name: string; public_query: JsonObject }> = [
    { name: "city_missing", public_query: { query: "AI", page: 1, limit: 15 } },
    { name: "city_invalid", public_query: { query: "AI", city_code: "beijing", page: 1, limit: 15 } },
    { name: "page", public_query: { query: "AI", city_code: "101010100", page: 2, limit: 15 } },
    { name: "limit", public_query: { query: "AI", city_code: "101010100", page: 1, limit: 16 } },
    { name: "query_length", public_query: { query: "A".repeat(81), city_code: "101010100", page: 1, limit: 15 } },
    { name: "unknown", public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15, sort: "latest" } }
  ];
  for (const invalid of invalidQueries) {
    const response = await postJson(port, "/tasks", {
      run_id: `run_process_boss_query_${invalid.name}`, package_ref: bossPackageRef,
      task_intent: bossTaskIntent(`intent_process_boss_query_${invalid.name}`), public_query: invalid.public_query,
      harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
    });
    assert.equal(response.status, 400, invalid.name);
    assert.equal(asRecord(asRecord(response.body).error).code, "public_query_invalid", invalid.name);
  }
  const missing = await postJson(port, "/tasks", {
    run_id: "run_process_boss_query_missing", package_ref: bossPackageRef,
    task_intent: bossTaskIntent("intent_process_boss_query_missing"),
    harbor: { url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" }
  });
  assert.equal(missing.status, 400);
}

async function assertBossTargetValidation(port: number): Promise<void> {
  const cases: Array<{ name: string; target_ref?: string; harbor_url?: string }> = [
    { name: "target_ref_missing", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
    { name: "target_ref_path", target_ref: "https://www.zhipin.com/web/geek/jobs?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
    { name: "harbor_missing", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100" },
    { name: "harbor_query", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=other&city=101010100" },
    { name: "harbor_city", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101020100" },
    { name: "harbor_extra", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100&extra=1" },
    { name: "harbor_duplicate", target_ref: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100", harbor_url: "https://www.zhipin.com/web/geek/job?query=AI&query=AI&city=101010100" }
  ];
  for (const drift of cases) {
    const intent = bossTaskIntent(`intent_process_boss_target_${drift.name}`);
    intent.scope = { ...asRecord(intent.scope), target_ref: drift.target_ref };
    const response = await postJson(port, "/tasks", {
      run_id: `run_process_boss_target_${drift.name}`, package_ref: bossPackageRef, task_intent: intent,
      public_query: { query: "AI", city_code: "101010100", page: 1, limit: 15 },
      ...(drift.harbor_url === undefined ? {} : { harbor: { url: drift.harbor_url } })
    });
    assert.equal(response.status, 400, drift.name);
    assert.equal(asRecord(asRecord(response.body).error).code, "boss_target_invalid", drift.name);
  }
}

async function assertXhsQueryValidation(port: number): Promise<void> {
  for (const [name, field] of [["city", { city_code: "101010100" }], ["page", { page: 1 }], ["limit", { limit: 15 }]] as const) {
    const response = await postJson(port, "/tasks", {
      run_id: `run_process_xhs_query_${name}`, package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      task_intent: taskIntent(`intent_process_xhs_query_${name}`), public_query: { query: "coffee", ...field }
    });
    assert.equal(response.status, 400, name);
    assert.equal(asRecord(asRecord(response.body).error).code, "public_query_invalid", name);
  }
  const intent = taskIntent("intent_process_xhs_declared_target");
  intent.capability = { ref: "lode:capability/search-notes", version: "0.1.0", source_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0" };
  intent.scope = { target_type: "search_results_page", target_ref: "https://www.xiaohongshu.com/search_result?keyword=coffee" };
  const response = await postJson(port, "/tasks", {
    run_id: "run_process_xhs_declared_target", package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    task_intent: intent, public_query: { query: "coffee", limit: 15 }
  });
  assert.equal(response.status, 422);
  assert.equal(asRecord(asRecord(response.body).error).code, "lode_resolver_unconfigured");
}

export async function assertDegradedProcessSmoke(): Promise<void> {
  const port = await reservePort();
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-runs-"));
  const { child, output } = spawnApiServer(port, runRecordDir, {
    WEBENVOY_LODE_REGISTRY_PATH: undefined, WEBENVOY_HARBOR_RUNTIME_URL: undefined,
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: undefined
  });
  try {
    assert.deepEqual(await waitForJson(port, "/health", child), { status: 200, body: { service: "webenvoy-api-server", status: "ok" } });
    await assertAdmissionQueries(port);
    await assertBossQueryValidation(port);
    await assertBossTargetValidation(port);
    await assertXhsQueryValidation(port);
  } catch (error) {
    console.error(output());
    throw error;
  } finally {
    await stopProcess(child);
    await rm(runRecordDir, { recursive: true, force: true });
  }
}
