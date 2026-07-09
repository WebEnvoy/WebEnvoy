import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

type JsonResponse = {
  status: number;
  body: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function getJson(port: number, path: string): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    body: await response.json()
  };
}

async function waitForJson(port: number, path: string, child: ChildProcess): Promise<JsonResponse> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 5_000) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited before ${path} became available.`);
    }
    try {
      return await getJson(port, path);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const port = await reservePort();
  const runRecordDir = await mkdtemp(join(tmpdir(), "webenvoy-api-runtime-runs-"));
  const child = spawn(process.execPath, ["dist/index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      WEBENVOY_RUN_RECORD_DIR: runRecordDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    assert.deepEqual(await waitForJson(port, "/health", child), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ok"
      }
    });

    const admission = await getJson(port, "/admission/health");
    assert.equal(admission.status, 200);
    const admissionBody = asRecord(admission.body);
    assert.equal(admissionBody.service, "webenvoy-api-server");
    assert.equal(admissionBody.status, "degraded");
    const checks = asRecord(admissionBody.checks);
    assert.equal(checks.runRecordStore, "configured");
    assert.equal(checks.lodePackageResolver, "missing");
    assert.equal(checks.harborRuntimeClient, "missing");

    const capabilityRuns = await getJson(
      port,
      "/capability-runs?capability_ref=lode%3Acapability%2Fread-public-page&capability_version=0.1.0&limit=8"
    );
    assert.equal(capabilityRuns.status, 200);
    const capabilityRunsBody = asRecord(capabilityRuns.body);
    assert.equal(capabilityRunsBody.ok, true);
    const envelope = asRecord(capabilityRunsBody.capability_runs);
    assert.equal(envelope.schema_version, "webenvoy.capability-run-query.v0");
    assert.equal(envelope.total_runs, 0);
    assert.equal(envelope.returned_runs, 0);
    assert.deepEqual(envelope.runs, []);

    const missingCapabilityRef = await getJson(port, "/capability-runs");
    assert.equal(missingCapabilityRef.status, 400);
    const missingCapabilityRefBody = asRecord(missingCapabilityRef.body);
    assert.equal(missingCapabilityRefBody.ok, false);
    assert.equal(asRecord(missingCapabilityRefBody.error).code, "capability_ref_required");
  } catch (error) {
    if (stdout || stderr) {
      console.error(`API server stdout:\n${stdout}`);
      console.error(`API server stderr:\n${stderr}`);
    }
    throw error;
  } finally {
    await stopProcess(child);
    await rm(runRecordDir, { recursive: true, force: true });
  }
}

await main();
