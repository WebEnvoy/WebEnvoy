import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  type AuthorizationDecisionSummary,
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
  const authorizationDecisions = await decisionStore.queryAuthorizationDecisions({ run_id: runId });

  return {
    ok: true,
    run: run.run,
    result: result.result,
    evidence: evidence.evidence,
    authorization_decisions: authorizationDecisions.authorization_decisions
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

async function assertRunDecisionApis(
  port: number,
  golden: RunRecord,
  cliOutput: JsonObject,
  decision: AuthorizationDecisionSummary
): Promise<void> {
  assert.deepEqual(await getJson(port, `/runs/${golden.run_id}`), {
    status: 200,
    body: { ok: true, run: asObject(cliOutput.run, "CLI run") }
  });
  assert.deepEqual(await getJson(port, `/runs/${golden.run_id}/result`), {
    status: 200,
    body: { ok: true, result: asObject(cliOutput.result, "CLI result") }
  });
  assert.deepEqual(await getJson(port, `/runs/${golden.run_id}/evidence-refs`), {
    status: 200,
    body: { ok: true, evidence: asObject(cliOutput.evidence, "CLI evidence") }
  });
  assert.deepEqual(await getJson(port, `/runs/${golden.run_id}/authorization-decisions`), {
    status: 200,
    body: { ok: true, authorization_decisions: cliOutput.authorization_decisions, next_cursor: null }
  });
  assert.deepEqual(await getJson(port, `/authorization-decisions/${encodeURIComponent(decision.decision_ref)}`), {
    status: 200,
    body: { ok: true, authorization_decision: decision }
  });
}

async function assertDecisionPaginationApi(port: number, directory: string, golden: RunRecord): Promise<void> {
  const oversized = await getJson(port, "/authorization-decisions?limit=101");
  assert.equal(oversized.status, 400);
  assert.equal(asObject(asObject(oversized.body, "decision query").error, "decision query error").code, "authorization_decision_query_limit_invalid");
  const first = await getJson(port, "/authorization-decisions?limit=2");
  assert.equal(first.status, 200);
  const cursor = asString(first.body.next_cursor, "first decision page.next_cursor");
  const firstDecisions = first.body.authorization_decisions;
  assert(Array.isArray(firstDecisions) && firstDecisions.length === 2);
  const second = await getJson(port, `/authorization-decisions?limit=2&cursor=${encodeURIComponent(cursor)}`);
  assert.equal(second.status, 200);
  const secondDecisions = second.body.authorization_decisions;
  assert(Array.isArray(secondDecisions) && secondDecisions.length === 1);
  assert.notEqual(asObject(firstDecisions[0], "first paged decision").decision_ref, asObject(secondDecisions[0], "second paged decision").decision_ref);
  const missingRun = await getJson(port, "/runs/run_missing/authorization-decisions");
  assert.equal(missingRun.status, 404);
  assert.equal(asObject(asObject(missingRun.body, "missing run query").error, "missing run error").code, "run_not_found");
  await writeFile(join(directory, "run_wrong_owner.json"), JSON.stringify(golden), "utf8");
  const wrongOwner = await getJson(port, "/runs/run_wrong_owner/authorization-decisions");
  assert.equal(wrongOwner.status, 503);
  assert.equal(asObject(asObject(wrongOwner.body, "wrong run owner").error, "wrong run owner error").code, "authorization_run_record_invalid");
}

async function assertCorruptDecisionApi(port: number, directory: string): Promise<void> {
  const decisionDirectory = `${directory}.authorization-decisions`;
  const [journalFile] = await readdir(decisionDirectory);
  assert(journalFile);
  const journalPath = join(decisionDirectory, journalFile);
  const journal = asObject(JSON.parse(await readFile(journalPath, "utf8")), "decision journal");
  const entries = journal.decisions;
  assert(Array.isArray(entries));
  asObject(asObject(entries[0], "decision entry").decision, "stored decision").raw_dom = "forbidden";
  await writeFile(journalPath, JSON.stringify(journal), "utf8");
  const corrupt = await getJson(port, "/authorization-decisions");
  assert.equal(corrupt.status, 503);
  const failure = asObject(asObject(corrupt.body, "corrupt query").error, "corrupt query error");
  assert.equal(failure.category, "persistence_observability");
  assert.equal(failure.recovery_hint, "contact_operator");
  assert.equal(failure.code, "authorization_decision_journal_invalid");
}

async function runSmokeMode(): Promise<void> {
  const golden = await readGoldenRunRecord();
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-api-cli-smoke-"));
  await seedRunRecord(directory, golden);

  const store = createFileRunRecordStore({ directory });
  const threadId = "thread_0123456789abcdef0123456789abcdef";
  const turnId = "turn_0123456789abcdef0123456789abcdef";
  const taskThreadStore = {
    getTaskThread: async (candidate: string) => candidate === threadId
      ? { thread_id: threadId, turns: [{ turn_id: turnId, run_id: golden.run_id }] }
      : undefined
  };
  const decisionStore = createFileAuthorizationDecisionStore({
    directory: `${directory}.authorization-decisions`,
    runRecordStore: store,
    taskThreadStore
  });
  const decision = await decisionStore.recordAuthorizationDecision({
    idempotency_key: "cli-system-stop",
    evaluation: evaluateExecutionPolicy({}),
    subject: {
      scope: "task",
      run_id: golden.run_id,
      thread_id: threadId,
      turn_id: turnId
    }
  });
  for (const index of [1, 2]) {
    await decisionStore.recordAuthorizationDecision({
      idempotency_key: `environment-system-stop-${index}`,
      evaluation: evaluateExecutionPolicy({}),
      subject: { scope: "environment", operation_ref: `harbor-operation:smoke/${index}` }
    });
  }
  const server = createApiServer({ runRecordStore: store, authorizationDecisionStore: decisionStore });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;

  try {
    const cliOutput = await runCliQueryProcess(directory, golden.run_id);
    assertCliShape(cliOutput, golden);
    await assertRunDecisionApis(port, golden, cliOutput, decision);
    await assertDecisionPaginationApi(port, directory, golden);
    await assertCorruptDecisionApi(port, directory);
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
