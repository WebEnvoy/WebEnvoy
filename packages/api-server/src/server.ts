import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { getRunSummary, type FileRunRecordStore } from "@webenvoy/core-runtime";

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

  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const runMatch = /^\/runs\/([^/]+)$/.exec(path);

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

  if (runMatch) {
    if (!options.runRecordStore) {
      sendJson(response, 503, {
        ok: false,
        error: {
          category: "persistence_observability",
          code: "run_store_unavailable",
          phase: "query",
          recovery_hint: "contact_operator"
        }
      });
      return;
    }

    let runId: string;
    try {
      runId = decodeURIComponent(runMatch[1] ?? "");
    } catch {
      sendJson(response, 400, {
        ok: false,
        error: {
          category: "request_invalid",
          code: "run_id_invalid",
          phase: "query",
          recovery_hint: "fix_input"
        }
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

    sendJson(response, result.failure.code === "run_not_found" ? 404 : 400, {
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
