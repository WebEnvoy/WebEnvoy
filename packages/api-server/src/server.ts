import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { getCapabilityRunSummary, getRunEvidenceRefs, getRunResult, getRunSummary, type FailureRecord, type FileRunRecordStore } from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type ApiServerOptions = {
  runRecordStore?: FileRunRecordStore;
};

const serviceName = "webenvoy-api-server";

function sendJson(response: ServerResponse, statusCode: number, body: JsonBody): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function runStoreUnavailable(): FailureRecord {
  return {
    category: "persistence_observability",
    code: "run_store_unavailable",
    phase: "query",
    recovery_hint: "contact_operator"
  };
}

function invalidRunId(): FailureRecord {
  return {
    category: "request_invalid",
    code: "run_id_invalid",
    phase: "query",
    recovery_hint: "fix_input"
  };
}

function queryStatusCode(failure: FailureRecord): number {
  if (failure.code === "run_not_found") return 404;
  if (failure.code === "run_store_unavailable") return 503;
  return 400;
}

function decodeRunId(value: string | undefined): string | undefined {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return undefined;
  }
}

function optionalSearchParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value && value.length > 0 ? value : undefined;
}

function capabilityQueryMissing(): FailureRecord {
  return {
    category: "request_invalid",
    code: "capability_ref_required",
    phase: "query",
    recovery_hint: "fix_input",
    attribution: "input"
  };
}

async function route(request: IncomingMessage, response: ServerResponse, options: ApiServerOptions): Promise<void> {
  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message: "Only GET is supported by the API Server"
      }
    });
    return;
  }

  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = requestUrl.pathname;
  const runMatch = /^\/runs\/([^/]+)$/.exec(path);
  const runResultMatch = /^\/runs\/([^/]+)\/result$/.exec(path);
  const runEvidenceRefsMatch = /^\/runs\/([^/]+)\/evidence-refs$/.exec(path);

  if (path === "/health") {
    sendJson(response, 200, {
      service: serviceName,
      status: "ok"
    });
    return;
  }

  if (path === "/readiness") {
    sendJson(response, 200, {
      service: serviceName,
      status: "ready",
      checks: {
        apiServer: "ok"
      }
    });
    return;
  }

  if (path === "/capability-runs") {
    if (!options.runRecordStore) {
      sendJson(response, 503, {
        ok: false,
        error: runStoreUnavailable()
      });
      return;
    }
    const capabilityRef = optionalSearchParam(requestUrl, "capability_ref");
    if (!capabilityRef) {
      sendJson(response, 400, {
        ok: false,
        error: capabilityQueryMissing()
      });
      return;
    }
    const capabilityVersion = optionalSearchParam(requestUrl, "capability_version");
    const capabilitySourceRef = optionalSearchParam(requestUrl, "capability_source_ref");
    const packageRef = optionalSearchParam(requestUrl, "package_ref");
    const result = await getCapabilityRunSummary(options.runRecordStore, {
      capability_ref: capabilityRef,
      ...(capabilityVersion === undefined ? {} : { capability_version: capabilityVersion }),
      ...(capabilitySourceRef === undefined ? {} : { capability_source_ref: capabilitySourceRef }),
      ...(packageRef === undefined ? {} : { package_ref: packageRef }),
      limit: Number(optionalSearchParam(requestUrl, "limit") ?? 20)
    });
    if (result.ok) {
      sendJson(response, 200, {
        ok: true,
        capability_runs: result.capability_runs
      });
      return;
    }
    sendJson(response, queryStatusCode(result.failure), {
      ok: false,
      error: result.failure
    });
    return;
  }

  if (runResultMatch || runEvidenceRefsMatch || runMatch) {
    if (!options.runRecordStore) {
      sendJson(response, 503, {
        ok: false,
        error: runStoreUnavailable()
      });
      return;
    }

    const runId = decodeRunId(runResultMatch?.[1] ?? runEvidenceRefsMatch?.[1] ?? runMatch?.[1]);
    if (runId === undefined) {
      sendJson(response, 400, {
        ok: false,
        error: invalidRunId()
      });
      return;
    }

    if (runResultMatch) {
      const result = await getRunResult(options.runRecordStore, runId);
      if (result.ok) {
        sendJson(response, 200, {
          ok: true,
          result: result.result
        });
        return;
      }

      sendJson(response, queryStatusCode(result.failure), {
        ok: false,
        error: result.failure
      });
      return;
    }

    if (runEvidenceRefsMatch) {
      const result = await getRunEvidenceRefs(options.runRecordStore, runId);
      if (result.ok) {
        sendJson(response, 200, {
          ok: true,
          evidence: result.evidence
        });
        return;
      }

      sendJson(response, queryStatusCode(result.failure), {
        ok: false,
        error: result.failure
      });
      return;
    }

    const result = await getRunSummary(options.runRecordStore, runId);
    if (result.ok) {
      sendJson(response, 200, {
        ok: true,
        run: result.run
      });
      return;
    }

    sendJson(response, queryStatusCode(result.failure), {
      ok: false,
      error: result.failure
    });
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Route not found"
    }
  });
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  return createServer((request, response) => {
    void route(request, response, options).catch((error: unknown) => {
      sendJson(response, 500, {
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "unknown internal error"
        }
      });
    });
  });
}
