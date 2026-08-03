import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalLodePackageResolver } from "@webenvoy/core-runtime";
import {
  pinnedHarborCommit, pinnedLodeCommit, resolveCoreProvenance, resolveHarborContract,
  resolvePinnedLodeArtifact, type CoreProvenance, type HarborContractProvenance, type PinnedLodeArtifact
} from "./readonly-vertical-pins.js";
import {
  asRecord, getJson, postJson, reservePort, spawnApiServer, spawnNode, stopProcess, waitForJson,
  type JsonObject, type SpawnedProcess
} from "./self-check-process-support.js";

const packageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const lockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const resourceRef = "xiaohongshu.search-notes.resources";
const supervisorToken = "runtime-process-supervisor-token";
const fixtureEntry = join(dirname(fileURLToPath(import.meta.url)), "readonly-vertical-harbor-fixture.js");

type TraceEvent = { sequence: number; request: string; status: number; outcome: string };
type Submission = { status: number; body: JsonObject; trace: TraceEvent[] };
type ProvenanceInputs = { core: CoreProvenance; harbor: HarborContractProvenance; lode: PinnedLodeArtifact };

function taskIntent(intentId: string): JsonObject {
  return {
    schema_version: "webenvoy.task-intent.v0", intent_id: intentId, entrypoint: "app",
    user_intent: { summary: "Read Xiaohongshu search results from an offline Harbor fixture." },
    capability: { ref: "lode:capability/search-notes", version: "0.1.0", source_ref: packageRef, lock_ref: lockRef },
    input: { summary: "Read the current public search result summary.", refs: ["https://www.xiaohongshu.com/search_result/?keyword=coffee"] },
    scope: { target_type: "search_results_page", target_ref: "https://www.xiaohongshu.com/search_result/?keyword=coffee" },
    policy: { risk: "read", execution_intent: "read", timeout_ms: 5000 },
    resource_requirement_refs: [resourceRef], resource_requirement_profile_id: "search-notes-logged-in-ready-page",
    evidence_policy_ref: "evidence-policy:refs-only"
  };
}

function assertNoPrivateKeys(value: unknown): void {
  const privateKey = /^(?:password|verification_code|cookie|cookies|token|tokens|profile_storage|raw_dom|raw_har|screenshot_body|network_response_body|provider_key|local_path)$/i;
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      assert.equal(privateKey.test(key), false, `private Harbor field leaked: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

async function fixtureTrace(port: number): Promise<TraceEvent[]> {
  const response = await getJson(port, "/__fixture/trace");
  assert.equal(response.status, 200);
  const events = asRecord(response.body).events;
  assert(Array.isArray(events));
  return events.map((event) => asRecord(event) as TraceEvent);
}

async function submit(apiPort: number, fixturePort: number, runId: string): Promise<Submission> {
  const start = (await fixtureTrace(fixturePort)).length;
  const response = await postJson(apiPort, "/tasks", {
    run_id: runId, package_ref: packageRef, task_intent: taskIntent(`intent_${runId}`),
    public_query: { query: "coffee", limit: 1 },
    harbor: { identity_environment_ref: "identity-env_vertical", url: "https://www.xiaohongshu.com/search_result/?keyword=coffee" }
  });
  return { status: response.status, body: asRecord(response.body), trace: (await fixtureTrace(fixturePort)).slice(start) };
}

async function assertSuccess(apiPort: number, fixturePort: number): Promise<unknown[]> {
  const success = await submit(apiPort, fixturePort, "run_vertical_success");
  assert.equal(success.status, 202, JSON.stringify(success.body));
  assert.equal(success.body.ok, true);
  const run = asRecord(success.body.run);
  assert.equal(run.status, "succeeded");
  assert.deepEqual(asRecord(run.admission).runtime_binding_refs, [
    "session_vertical", "profile_vertical", "harbor:provider/cloakbrowser", "viewer_vertical",
    "identity-env_vertical", "identity-env_vertical:execution", "snapshot_vertical", "refmap_vertical", "source_trace_vertical"
  ]);
  assert(success.trace.some(({ outcome }) => outcome === "canonical_runtime_facts"));
  assert(success.trace.some(({ outcome }) => outcome === "read_operation_completed"));
  const result = await getJson(apiPort, "/runs/run_vertical_success/result");
  assert.equal(result.status, 200);
  assert.equal(asRecord(result.body).ok, true);
  const failure = await getJson(apiPort, "/runs/run_vertical_success/failure");
  assert.equal(asRecord(asRecord(failure.body).failure_reason).failure_present, false);
  return [success.body, result.body, failure.body];
}

async function assertUnavailable(apiPort: number, fixturePort: number): Promise<unknown[]> {
  const unavailable = await submit(apiPort, fixturePort, "run_vertical_unavailable");
  assert.equal(unavailable.body.ok, false);
  const run = asRecord(unavailable.body.run);
  assert.equal(run.status, "blocked");
  assert.equal(asRecord(run.failure).code, "resource_unavailable");
  assert.equal(asRecord(run.failure).category, "runtime_execution");
  const failure = await getJson(apiPort, "/runs/run_vertical_unavailable/failure");
  const reason = asRecord(asRecord(failure.body).failure_reason);
  assert.equal(reason.failure_present, true);
  assert.equal(asRecord(reason.failure).attribution, "runtime");
  return [unavailable.body, failure.body];
}

async function assertFailure(apiPort: number, fixturePort: number): Promise<unknown[]> {
  const failure = await submit(apiPort, fixturePort, "run_vertical_failure");
  assert.equal(failure.body.ok, false);
  const run = asRecord(failure.body.run);
  assert.equal(run.status, "failed");
  assert.equal(asRecord(run.failure).code, "output_invalid");
  assert.equal(asRecord(run.failure).category, "result_projection");
  assert.equal(asRecord(run.failure).attribution, "capability");
  const reason = await getJson(apiPort, "/runs/run_vertical_failure/failure");
  assert.equal(asRecord(asRecord(asRecord(reason.body).failure_reason).failure).attribution, "capability");
  return [failure.body, reason.body];
}

async function assertRollback(apiPort: number, fixturePort: number): Promise<JsonObject> {
  const rollback = await submit(apiPort, fixturePort, "run_vertical_rollback");
  assert.equal(rollback.status, 202, JSON.stringify(rollback.body));
  assert.equal(asRecord(rollback.body.run).status, "succeeded");
  const cleanup = await getJson(fixturePort, "/runtime/sessions/session_vertical");
  assert.equal(cleanup.status, 200);
  const cleanupFacts = asRecord(cleanup.body);
  assert.equal(cleanupFacts.lifecycle_state, "idle");
  assert.equal(cleanupFacts.control_owner, "none");
  const allEvents = await fixtureTrace(fixturePort);
  const start = allEvents.findIndex(({ outcome }) => outcome === "runtime_facts_unsupported");
  const events = allEvents.slice(start);
  const outcomes = events.map(({ outcome }) => outcome);
  for (const outcome of ["runtime_facts_unsupported", "legacy_session_facts", "read_operation_completed", "session_released", "cleanup_readback"]) {
    assert(outcomes.includes(outcome), outcome);
  }
  assert(outcomes.indexOf("runtime_facts_unsupported") < outcomes.indexOf("legacy_session_facts"), JSON.stringify(events));
  assert(outcomes.indexOf("legacy_session_facts") < outcomes.indexOf("read_operation_completed"), JSON.stringify(events));
  assert(outcomes.indexOf("read_operation_completed") < outcomes.indexOf("session_released"), JSON.stringify(events));
  return {
    schema_version: "webenvoy.readonly-rollback-trace.v0",
    events,
    transition_diff: {
      canonical: "GET runtime-facts -> runtime_facts_unsupported",
      compatibility: "GET legacy session facts -> read operation completed",
      cleanup: "POST release -> idle/none readback"
    }
  };
}

async function assertCanonicalGuards(apiPort: number, fixturePort: number): Promise<void> {
  for (const mode of ["canonical-network", "canonical-5xx", "canonical-session-missing", "canonical-malformed"] as const) {
    const guarded = await submit(apiPort, fixturePort, `run_vertical_${mode}`);
    assert.equal(guarded.body.ok, false, mode);
    const outcomes = guarded.trace.map(({ outcome }) => outcome);
    assert(outcomes.some((outcome) => ["network_disconnect", "runtime_facts_5xx", "session_missing", "malformed_runtime_facts"].includes(outcome)), mode);
    const trace = JSON.stringify(guarded.trace);
    assert.equal(outcomes.includes("legacy_session_facts"), false, `${mode}: ${trace}`);
    assert.equal(outcomes.includes("site_resource_facts"), false, `${mode}: ${trace}`);
    assert.equal(outcomes.includes("snapshot_refs"), false, `${mode}: ${trace}`);
    assert.equal(outcomes.includes("read_operation_completed"), false, `${mode}: ${trace}`);
  }
}

async function resolveInputs(): Promise<ProvenanceInputs | undefined> {
  const [core, harbor, lode] = await Promise.all([
    resolveCoreProvenance(), resolveHarborContract(), resolvePinnedLodeArtifact()
  ]);
  if (core && harbor && lode) return { core, harbor, lode };
  console.log(JSON.stringify({
    schema_version: "webenvoy.offline-readonly-vertical-slice-provenance.v0",
    state: "structured_unavailable",
    core: core ?? null,
    harbor: harbor ?? { commit: null, required_commit: pinnedHarborCommit, state: "exact_contract_unavailable" },
    lode: lode ? { commit: pinnedLodeCommit, source: lode.source } : { commit: null, required_commit: pinnedLodeCommit, state: "exact_pin_unavailable" },
    recovery: "Provide exact Core git metadata and exact Harbor/Lode commit objects or clean pinned checkouts."
  }));
  await lode?.cleanup?.();
  return undefined;
}

async function assertFixtureProvenance(port: number, child: SpawnedProcess, harbor: HarborContractProvenance): Promise<void> {
  const response = await waitForJson(port, "/__fixture/provenance", child.child);
  assert.equal(response.status, 200);
  const body = asRecord(response.body);
  assert.equal(body.harbor_commit, harbor.commit);
  assert.equal(body.contract_digest, harbor.fixture_contract_digest);
}

async function assertLodeResolution(registryPath: string): Promise<JsonObject> {
  const resolver = createLocalLodePackageResolver({ registryPath });
  const resolved = await resolver({ package_ref: packageRef, task_intent: taskIntent("intent_vertical_resolve") });
  assert.equal("category" in resolved, false, JSON.stringify(resolved));
  if ("category" in resolved) throw new Error("Pinned Lode search package did not resolve.");
  assert.equal(resolved.package_ref, packageRef);
  assert.equal(resolved.lock_ref, lockRef);
  assert.equal(resolved.runtime_consumption_declaration?.declaration_path, "registry/search-runtime-consumption.json");
  assert.equal(Object.keys(resolved.runtime_consumption_declaration?.asset_hashes ?? {}).sort().join(","), "failure_mapping,input_schema,manifest,output_schema,package_lock,post_check,resource_requirements,runtime_consumption_allowlist");
  return asRecord(resolved.runtime_consumption_declaration);
}

async function runSlice(inputs: ProvenanceInputs): Promise<void> {
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-vertical-runs-"));
  const fixturePort = await reservePort();
  const fixture = spawnNode(fixtureEntry, {
    PORT: String(fixturePort), WEBENVOY_HARBOR_FIXTURE_COMMIT: inputs.harbor.commit,
    WEBENVOY_HARBOR_FIXTURE_CONTRACT_DIGEST: inputs.harbor.fixture_contract_digest
  });
  const apiPort = await reservePort();
  const api = spawnApiServer(apiPort, runRecordDir, {
    WEBENVOY_LODE_REGISTRY_PATH: inputs.lode.registryPath,
    WEBENVOY_HARBOR_RUNTIME_URL: `http://127.0.0.1:${fixturePort}`,
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: supervisorToken
  });
  try {
    await assertFixtureProvenance(fixturePort, fixture, inputs.harbor);
    const declaration = await assertLodeResolution(inputs.lode.registryPath);
    await waitForJson(apiPort, "/health", api.child);
    const publicBodies = [
      ...await assertSuccess(apiPort, fixturePort),
      ...await assertUnavailable(apiPort, fixturePort),
      ...await assertFailure(apiPort, fixturePort)
    ];
    const rollbackArtifact = await assertRollback(apiPort, fixturePort);
    await assertCanonicalGuards(apiPort, fixturePort);
    const serialized = JSON.stringify([...publicBodies, rollbackArtifact]);
    assert.equal(serialized.includes(supervisorToken), false);
    assertNoPrivateKeys(JSON.parse(serialized));
    const records = await Promise.all((await readdir(runRecordDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile()).map((entry) => readFile(join(runRecordDir, entry.name), "utf8")));
    assert.equal(records.some((record) => record.includes(supervisorToken)), false);
    assert.equal(records.some((record) => /forbidden|cookie-value|secret-token/i.test(record)), false);
    console.log(JSON.stringify({
      schema_version: "webenvoy.offline-readonly-vertical-slice-provenance.v0", state: "passed",
      core: inputs.core,
      harbor: inputs.harbor,
      lode: { commit: pinnedLodeCommit, source: inputs.lode.source },
      artifacts: { registry: "registry/local-packages.json", package_ref: packageRef, declaration: "registry/search-runtime-consumption.json", asset_hashes: declaration.asset_hashes },
      rollback_artifact: rollbackArtifact,
      modes: ["success", "structured_unavailable", "failure_attribution", "bounded_rollback", "canonical_fail_closed"]
    }));
  } catch (error) {
    console.error(`${fixture.output()}\n${api.output()}`);
    throw error;
  } finally {
    await stopProcess(api.child);
    await stopProcess(fixture.child);
    await rm(runRecordDir, { recursive: true, force: true });
    await inputs.lode.cleanup?.();
  }
}

export async function runReadonlyVerticalSlice(): Promise<void> {
  const inputs = await resolveInputs();
  if (inputs) await runSlice(inputs);
}
