import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiServer } from "@webenvoy/api-server";
import {
  createFileRunRecordStore,
  createFileAuthorizationDecisionStore,
  evaluateExecutionPolicy,
  getRunEvidenceRefs,
  getRunResult,
  getRunSummary,
  runRecordSchemaVersion,
  type RunRecord
} from "@webenvoy/core-runtime";

type JsonObject = Record<string, unknown>;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = join(packageRoot, "..", "..");
const goldenFixturePath = join(workspaceRoot, "packages", "schemas", "fixtures", "golden-read-only-run-record.fixture.json");

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

async function readGoldenRunRecord(): Promise<RunRecord> {
  const fixture = asObject(JSON.parse(await readFile(goldenFixturePath, "utf8")), "golden run fixture");
  const record = withoutFixtureSchema(fixture);
  assert.equal(asString(record.schema_version, "golden run fixture.schema_version"), runRecordSchemaVersion);
  asString(record.run_id, "golden run fixture.run_id");
  return record as RunRecord;
}

async function seedRunRecord(directory: string, record: RunRecord): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${record.run_id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function queryFailureEnvelope(failure: unknown): JsonObject {
  return {
    ok: false,
    error: failure
  };
}

async function queryStore(directory: string, runId: string): Promise<JsonObject> {
  const store = createFileRunRecordStore({ directory });
  const decisionStore = createFileAuthorizationDecisionStore({ directory: `${directory}.authorization-decisions`, runRecordStore: store });
  const run = await getRunSummary(store, runId);
  if (!run.ok) return queryFailureEnvelope(run.failure);

  const result = await getRunResult(store, runId);
  if (!result.ok) return queryFailureEnvelope(result.failure);

  const evidence = await getRunEvidenceRefs(store, runId);
  if (!evidence.ok) return queryFailureEnvelope(evidence.failure);
  const authorizationDecisions = await decisionStore.listAuthorizationDecisions({ run_id: runId });

  return {
    ok: true,
    run: run.run,
    result: result.result,
    evidence: evidence.evidence,
    authorization_decisions: authorizationDecisions
  };
}

function requiredArg(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  assert(index >= 0 && args[index + 1], `${name} is required`);
  return args[index + 1] as string;
}

async function runCliQueryMode(args: readonly string[]): Promise<void> {
  const storeDir = requiredArg(args, "--store-dir");
  const runId = requiredArg(args, "--run-id");
  process.stdout.write(`${JSON.stringify(await queryStore(storeDir, runId), null, 2)}\n`);
}

async function getJson(port: number, path: string): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    body: asObject(await response.json(), `GET ${path} response`)
  };
}

async function runCliQueryProcess(directory: string, runId: string): Promise<JsonObject> {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "query", "--store-dir", directory, "--run-id", runId], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const [code] = (await once(child, "close")) as [number | null];
  assert.equal(code, 0, `CLI query exited with ${code}: ${stderr}`);
  return asObject(JSON.parse(stdout), "CLI query output");
}

function assertCliShape(cliOutput: JsonObject, golden: RunRecord): void {
  assert.equal(cliOutput.ok, true);
  const run = asObject(cliOutput.run, "CLI run");
  assert.equal(run.schema_version, "webenvoy.run-query.v0");
  assert.equal(run.run_id, golden.run_id);
  assert.equal(run.status, "succeeded");
  assert.equal(asObject(run.terminal_summary, "CLI run.terminal_summary").result_ref, golden.result_ref);

  const result = asObject(cliOutput.result, "CLI result");
  assert.equal(result.schema_version, "webenvoy.result-query.v0");
  assert.equal(result.run_id, golden.run_id);
  assert.equal(asObject(result.result, "CLI result.result").result_ref, golden.result_ref);
  assert.equal(asObject(asObject(result.result, "CLI result.result").result_envelope, "CLI result.result.result_envelope").ok, true);

  const evidence = asObject(cliOutput.evidence, "CLI evidence");
  assert.equal(evidence.schema_version, "webenvoy.evidence-refs-query.v0");
  assert.equal(evidence.run_id, golden.run_id);
  const evidenceRefs = evidence.evidence_refs;
  assert(Array.isArray(evidenceRefs), "CLI evidence.evidence_refs must be an array");
  assert.equal(evidenceRefs.length, 1);
  assert.equal(asObject(evidenceRefs[0], "CLI evidence.evidence_refs[0]").ref, golden.evidence_refs?.[0]);

  const decisions = cliOutput.authorization_decisions;
  assert(Array.isArray(decisions) && decisions.length === 1, "CLI authorization_decisions must contain the Core summary");
  assert.equal(asObject(decisions[0], "CLI authorization decision").schema_version, "webenvoy.authorization-decision.v0");
  assert.equal(asObject(asObject(decisions[0], "CLI authorization decision").reason, "CLI authorization reason").kind, "system_stop");
}

async function runSmokeMode(): Promise<void> {
  const golden = await readGoldenRunRecord();
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-api-cli-smoke-"));
  await seedRunRecord(directory, golden);

  const store = createFileRunRecordStore({ directory });
  const decisionStore = createFileAuthorizationDecisionStore({ directory: `${directory}.authorization-decisions`, runRecordStore: store });
  const decision = await decisionStore.recordAuthorizationDecision({
    idempotency_key: "cli-system-stop",
    evaluation: evaluateExecutionPolicy({}),
    subject: {
      scope: "task",
      run_id: golden.run_id,
      thread_id: "thread_0123456789abcdef0123456789abcdef",
      turn_id: "turn_0123456789abcdef0123456789abcdef"
    }
  });
  const server = createApiServer({ runRecordStore: store, authorizationDecisionStore: decisionStore });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;

  try {
    const cliOutput = await runCliQueryProcess(directory, golden.run_id);
    assertCliShape(cliOutput, golden);

    assert.deepEqual(await getJson(port, `/runs/${golden.run_id}`), {
      status: 200,
      body: {
        ok: true,
        run: asObject(cliOutput.run, "CLI run")
      }
    });
    assert.deepEqual(await getJson(port, `/runs/${golden.run_id}/result`), {
      status: 200,
      body: {
        ok: true,
        result: asObject(cliOutput.result, "CLI result")
      }
    });
    assert.deepEqual(await getJson(port, `/runs/${golden.run_id}/evidence-refs`), {
      status: 200,
      body: {
        ok: true,
        evidence: asObject(cliOutput.evidence, "CLI evidence")
      }
    });
    assert.deepEqual(await getJson(port, `/runs/${golden.run_id}/authorization-decisions`), {
      status: 200,
      body: {
        ok: true,
        authorization_decisions: cliOutput.authorization_decisions
      }
    });
    assert.deepEqual(await getJson(port, `/authorization-decisions/${encodeURIComponent(decision.decision_ref)}`), {
      status: 200,
      body: {
        ok: true,
        authorization_decision: decision
      }
    });
    const oversizedDecisionQuery = await getJson(port, "/authorization-decisions?limit=101");
    assert.equal(oversizedDecisionQuery.status, 400);
    assert.equal(asObject(asObject(oversizedDecisionQuery.body, "decision query").error, "decision query error").code, "authorization_decision_query_limit_invalid");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error: Error | undefined) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  }

  console.log(`Validated API/CLI smoke against golden run ${golden.run_id}.`);
}

if (process.argv[2] === "query") {
  await runCliQueryMode(process.argv.slice(3));
} else {
  await runSmokeMode();
}
