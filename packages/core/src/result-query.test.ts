import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeRunWithResult } from "./result-envelope.js";
import { getRunResult } from "./result-query.js";
import { createFileRunRecordStore } from "./run-record-store.js";

function payloadWithJsonBytes(bytes: number): Record<string, unknown> {
  const empty = { snapshot: { text: "" } };
  const text = "x".repeat(bytes - Buffer.byteLength(JSON.stringify(empty)));
  const payload = { snapshot: { text } };
  assert.equal(Buffer.byteLength(JSON.stringify(payload)), bytes);
  return payload;
}

async function createRun(store: ReturnType<typeof createFileRunRecordStore>, runId: string): Promise<void> {
  await store.createRunRecord({
    run_id: runId,
    task_intent_ref: `intent:${runId}`,
    capability_ref: "harbor:managed-browser",
    status: "admitted",
    admission: { decision: "accepted", action_risk: "read" },
    evidence_refs: ["evidence:fixture"]
  });
  await store.updateRunRecord(runId, { status: "running" });
}

test("public result payload crosses the summary boundary and survives Core restart up to 256 KiB", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-result-payload-"));
  try {
    const store = createFileRunRecordStore({ directory });
    const summaryMetadata = { operation: "instance.snapshot", request_hash: "a".repeat(64) };

    const ordinary = payloadWithJsonBytes(32 * 1024);
    await createRun(store, "run_result_ordinary");
    await completeRunWithResult(store, "run_result_ordinary", {
      result_ref: "result:ordinary",
      result_kind: "managed_browser_operation",
      data: ordinary,
      evidence_refs: ["evidence:fixture"],
      persisted_public_summary: { ...summaryMetadata, result: ordinary }
    });
    const ordinaryRecord = await store.getRunRecord("run_result_ordinary");
    assert.deepEqual(ordinaryRecord?.public_result_summary?.result, ordinary);
    assert.equal(ordinaryRecord?.public_result_payload, undefined);

    const boundary = payloadWithJsonBytes(256 * 1024);
    await createRun(store, "run_result_boundary");
    await completeRunWithResult(store, "run_result_boundary", {
      result_ref: "result:boundary",
      result_kind: "managed_browser_operation",
      data: boundary,
      evidence_refs: ["evidence:fixture"],
      persisted_public_summary: { ...summaryMetadata, result: boundary }
    });

    const record = await createFileRunRecordStore({ directory }).getRunRecord("run_result_boundary");
    assert.equal(record?.status, "succeeded");
    assert.ok(Buffer.byteLength(JSON.stringify(record?.public_result_summary)) <= 64 * 1024);
    assert.deepEqual(record?.public_result_summary?.result, undefined);
    assert.deepEqual(record?.public_result_payload, boundary);

    const query = await getRunResult(createFileRunRecordStore({ directory }), "run_result_boundary");
    assert.equal(query.ok, true);
    if (!query.ok) throw new Error("result query after restart must succeed");
    assert.equal(query.result.result.payload_state, "available");
    assert.deepEqual(query.result.result.result_envelope?.data, { ...summaryMetadata, result: boundary });

    const tooLarge = payloadWithJsonBytes(256 * 1024 + 1);
    await createRun(store, "run_result_too_large");
    await assert.rejects(
      completeRunWithResult(store, "run_result_too_large", {
        result_ref: "result:too-large",
        result_kind: "managed_browser_operation",
        data: tooLarge,
        evidence_refs: ["evidence:fixture"],
        persisted_public_summary: { ...summaryMetadata, result: tooLarge }
      }),
      /public_result_payload exceeds 256 KiB/
    );
    assert.equal((await store.getRunRecord("run_result_too_large"))?.status, "running");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
