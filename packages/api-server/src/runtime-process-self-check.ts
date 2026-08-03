import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRunRecordStore } from "@webenvoy/core-runtime";
import { runReadonlyVerticalSlice } from "./readonly-vertical-slice-self-check.js";
import { assertDegradedProcessSmoke } from "./runtime-process-degraded-self-check.js";
import {
  createHarborMock, expectedRuntimeBindingRefs, harborSupervisorToken, packageRef, taskIntent, writeLodeRegistry
} from "./runtime-process-fixture.js";
import {
  asRecord, closeServer, getJson, listen, postJson, reservePort, spawnApiServer, stopProcess, waitForJson
} from "./self-check-process-support.js";

const interruptedRunId = "run_process_recover_interrupted_core_task";

async function seedInterruptedRun(runRecordDir: string): Promise<void> {
  const store = createFileRunRecordStore({ directory: runRecordDir });
  await store.createRunRecord({
    run_id: interruptedRunId,
    status: "admitted",
    task_intent_ref: "intent:process/recover-interrupted-core-task",
    capability_ref: "lode:capability/read-public-page",
    admission: {
      decision: "accepted",
      action_risk: "read",
      runtime_session_binding: {
        schema_version: "webenvoy.runtime-session-binding.v0",
        identity_environment_ref: "identity-env_process",
        execution_identity_ref: "identity-env_process:execution",
        runtime_session_ref: "session_process_ready",
        profile_ref: "profile_process",
        provider_ref: "harbor:provider/cloakbrowser",
        provider_mode: "local",
        lifecycle_state: "active",
        control_owner: "core_task",
        session_use: "core_task_run",
        core_task_run: true,
        consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
      }
    }
  });
  await store.updateRunRecord(interruptedRunId, { status: "running" });
}

async function assertRecoveredRun(apiPort: number): Promise<void> {
  const recovered = await getJson(apiPort, `/runs/${interruptedRunId}`);
  assert.equal(recovered.status, 200);
  const run = asRecord(asRecord(recovered.body).run);
  assert.equal(run.status, "failed");
  assert.equal(asRecord(asRecord(run.terminal_summary).failure).code, "core_task_interrupted");
  const admission = asRecord((await getJson(apiPort, "/admission/health")).body);
  assert.equal(admission.status, "ready");
  const checks = asRecord(admission.checks);
  assert.equal(checks.runRecordStore, "configured");
  assert.equal(checks.lodePackageResolver, "configured");
  assert.equal(checks.harborRuntimeClient, "configured");
}

async function assertSuccessfulRun(apiPort: number): Promise<unknown[]> {
  const submit = await postJson(apiPort, "/tasks", {
    run_id: "run_process_submit_runtime_chain", package_ref: packageRef,
    task_intent: taskIntent("intent_process_submit_runtime_chain"),
    harbor: { identity_environment_ref: "identity-env_process", url: "https://example.org/" }
  });
  assert.equal(submit.status, 202, JSON.stringify(submit.body));
  const run = asRecord(asRecord(submit.body).run);
  assert.equal(run.status, "succeeded");
  assert.equal(run.result_ref, "result:core/intent_process_submit_runtime_chain");
  assert.deepEqual(run.evidence_refs, ["evidence_process_snapshot"]);
  assert.deepEqual(asRecord(run.admission).runtime_binding_refs, expectedRuntimeBindingRefs);
  const result = await getJson(apiPort, "/runs/run_process_submit_runtime_chain/result");
  const resultEnvelope = asRecord(asRecord(asRecord(asRecord(result.body).result).result).result_envelope);
  assert.equal(resultEnvelope.ok, true);
  const evidence = await getJson(apiPort, "/runs/run_process_submit_runtime_chain/evidence-refs");
  assert.equal((asRecord(asRecord(evidence.body).evidence).evidence_refs as unknown[]).length, 1);
  const session = await getJson(apiPort, "/runs/run_process_submit_runtime_chain/session-refs");
  const sessionRefs = asRecord(asRecord(asRecord(session.body).session_refs).session_refs);
  assert.equal(sessionRefs.runtime_session_ref, "session_process_ready");
  assert.equal(sessionRefs.identity_environment_ref, "identity-env_process");
  const capabilityRuns = await getJson(apiPort, "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0&package_ref=lode%3A%2F%2Fsite-capability%2Fexample%2Fread-public-page%400.1.0&limit=8");
  assert.equal(asRecord(asRecord(asRecord(capabilityRuns.body).capability_runs).status_counts).succeeded, 1);
  return [submit.body, result.body, evidence.body, session.body];
}

async function assertMismatchedScene(apiPort: number): Promise<void> {
  const response = await postJson(apiPort, "/tasks", {
    run_id: "run_process_mismatched_scene", package_ref: packageRef,
    task_intent: taskIntent("intent_process_mismatched_scene"),
    harbor: { identity_environment_ref: "identity-env_process", url: "https://example.org/" }
  });
  assert.equal(response.status, 400);
  const body = asRecord(response.body);
  assert.equal(body.ok, false);
  assert.equal(asRecord(body.error).code, "page_changed");
  assert.equal(asRecord(body.run).status, "blocked");
}

async function assertFixtureAudit(
  harborPaths: string[],
  protectedAuthorization: string[],
  runRecordDir: string,
  publicBodies: unknown[],
  processOutput: string
): Promise<void> {
  for (const path of [
    "GET /readiness", "GET /runtime/browser-providers",
    "GET /runtime/identity-environments/identity-env_process", "POST /runtime/identity-environment-sessions",
    "POST /runtime/sessions/session_process_ready/snapshot", "GET /runtime/evidence/evidence_process_snapshot"
  ]) assert(harborPaths.includes(path), path);
  assert(protectedAuthorization.length > 0);
  assert(protectedAuthorization.every((value) => value === `Bearer ${harborSupervisorToken}`));
  assert.equal(JSON.stringify(publicBodies).includes(harborSupervisorToken), false);
  const records = await Promise.all((await readdir(runRecordDir)).map((file) => readFile(join(runRecordDir, file), "utf8")));
  assert.equal(records.some((record) => record.includes(harborSupervisorToken)), false);
  assert.equal(processOutput.includes(harborSupervisorToken), false);
}

async function assertConfiguredTaskProcessSmoke(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-assets-"));
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-runs-"));
  const registryPath = await writeLodeRegistry(root);
  const harborPaths: string[] = [];
  const protectedAuthorization: string[] = [];
  const harbor = createHarborMock(harborPaths, protectedAuthorization, interruptedRunId);
  const harborPort = await listen(harbor);
  const apiPort = await reservePort();
  await seedInterruptedRun(runRecordDir);
  const process = spawnApiServer(apiPort, runRecordDir, {
    WEBENVOY_LODE_REGISTRY_PATH: registryPath,
    WEBENVOY_HARBOR_RUNTIME_URL: `http://127.0.0.1:${harborPort}`,
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: harborSupervisorToken
  });
  try {
    await waitForJson(apiPort, "/health", process.child);
    await assertRecoveredRun(apiPort);
    const publicBodies = await assertSuccessfulRun(apiPort);
    await assertMismatchedScene(apiPort);
    await assertFixtureAudit(harborPaths, protectedAuthorization, runRecordDir, publicBodies, process.output());
  } catch (error) {
    console.error(process.output());
    throw error;
  } finally {
    await stopProcess(process.child);
    await closeServer(harbor);
    await rm(root, { recursive: true, force: true });
    await rm(runRecordDir, { recursive: true, force: true });
  }
}

await assertDegradedProcessSmoke();
await assertConfiguredTaskProcessSmoke();
await runReadonlyVerticalSlice();
