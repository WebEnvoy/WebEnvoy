import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { completeRunWithResult, createFileRunRecordStore } from "@webenvoy/core-runtime";
import { createApiServer } from "./server.js";

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    body: await response.json()
  };
}

let tick = 0;

function nextInstant(): Date {
  const instant = new Date(Date.UTC(2026, 6, 1, 2, 0, tick));
  tick += 1;
  return instant;
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-api-server-"));
  const store = createFileRunRecordStore({ directory, clock: nextInstant });
  const runId = "run_api_query_001";

  await store.createRunRecord({
    run_id: runId,
    task_intent_ref: "intent_fixture_read_only_001",
    entrypoint_ref: "entrypoint:api",
    capability_ref: "lode:capability/read-public-page",
    package_ref: "lode://site-capability/example/read-public-page@0.1.0",
    admission: {
      decision: "accepted",
      action_risk: "read",
      resource_requirement_refs: ["example.read-public-page.resources"],
      runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
      evidence_refs: ["evidence:fixture/read-public-page"],
      resource_match_ref: "resource-match:fixture/ready"
    },
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/read-public-page"]
  });
  await store.updateRunRecord(runId, {
    status: "admitted",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/read-public-page"]
  });
  await store.updateRunRecord(runId, {
    status: "running",
    runtime_binding_refs: ["harbor:runtime-session/fixture-ready"],
    evidence_refs: ["evidence:fixture/read-public-page"]
  });
  await completeRunWithResult(store, runId, {
    result_ref: "result:fixture/read-public-page",
    result_kind: "content_detail",
    projection_ref: "projection:fixture/read-public-page",
    evidence_refs: ["evidence:fixture/read-public-page"],
    retention_state: "active"
  });

  const server = createApiServer({ runRecordStore: store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;

  try {
    assert.deepEqual(await getJson(port, "/health"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ok"
      }
    });

    assert.deepEqual(await getJson(port, "/readiness"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ready",
        checks: {
          apiServer: "ok"
        }
      }
    });

    assert.deepEqual(await getJson(port, `/runs/${runId}`), {
      status: 200,
      body: {
        ok: true,
        run: {
          schema_version: "webenvoy.run-query.v0",
          run_id: runId,
          status: "succeeded",
          timeline: {
            created_at: "2026-07-01T02:00:00.000Z",
            updated_at: "2026-07-01T02:00:03.000Z",
            terminal_at: "2026-07-01T02:00:03.000Z"
          },
          task: {
            task_intent_ref: "intent_fixture_read_only_001",
            capability_ref: "lode:capability/read-public-page",
            entrypoint_ref: "entrypoint:api",
            package_ref: "lode://site-capability/example/read-public-page@0.1.0"
          },
          admission: {
            decision: "accepted",
            action_risk: "read",
            resource_requirement_refs: ["example.read-public-page.resources"],
            resource_match_ref: "resource-match:fixture/ready"
          },
          runtime_refs: {
            binding_refs: ["harbor:runtime-session/fixture-ready"],
            admission_binding_refs: ["harbor:runtime-session/fixture-ready"]
          },
          terminal_summary: {
            terminal: true,
            status: "succeeded",
            terminal_at: "2026-07-01T02:00:03.000Z",
            result_ref: "result:fixture/read-public-page",
            retention_state: "active"
          }
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/missing_run"), {
      status: 404,
      body: {
        ok: false,
        error: {
          category: "persistence_observability",
          code: "run_not_found",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/runs/%E0%A4%A"), {
      status: 400,
      body: {
        ok: false,
        error: {
          category: "request_invalid",
          code: "run_id_invalid",
          phase: "query",
          recovery_hint: "fix_input"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/missing"), {
      status: 404,
      body: {
        error: {
          code: "not_found",
          message: "Route not found"
        }
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
