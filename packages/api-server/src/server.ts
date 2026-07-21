import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  getCapabilityRunSummary,
  getRunEvidenceRefs,
  getRunFailureReason,
  getRunResult,
  getRunSessionRefs,
  getRunSummary,
  previewIdentityCompatibility,
  type FailureRecord,
  type FileAuthorizationDecisionStore,
  type FileRunRecordStore,
  type HarborIdentityFactsReader,
  type HarborRuntimeClient,
  type LodePackageResolver
} from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";
import { submitTaskBody, validateThreadTaskBody } from "./task-api.js";
import { handleAuthorizationDecisionApi } from "./authorization-decision-api.js";
import { handleTaskThreadApi } from "./task-thread-api.js";

type JsonBody = Record<string, unknown>;
type FileTaskThreadStore = ReturnType<typeof createFileTaskThreadStore>;

export type ApiServerOptions = {
  runRecordStore?: FileRunRecordStore;
  authorizationDecisionStore?: FileAuthorizationDecisionStore;
  taskThreadStore?: FileTaskThreadStore;
  lodePackageResolver?: LodePackageResolver;
  harborIdentityFactsReader?: HarborIdentityFactsReader;
  harborRuntimeClient?: HarborRuntimeClient;
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

function isFailureRecord(value: unknown): value is FailureRecord {
  return Boolean(value && typeof value === "object" && "category" in value);
}

function hasJsonMediaType(request: IncomingMessage): boolean {
  return request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function previewRequestFailure(code: string): FailureRecord {
  return {
    category: "request_invalid",
    code,
    phase: "pre_admission",
    recovery_hint: "fix_input"
  };
}

function queryStatusCode(failure: FailureRecord): number {
  if (failure.code === "run_not_found") return 404;
  if (failure.code === "run_store_unavailable") return 503;
  return 400;
}


async function readJsonBody(request: IncomingMessage, limitBytes = 1_000_000): Promise<Record<string, unknown> | FailureRecord> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limitBytes) {
      return {
        category: "request_invalid",
        code: "request_body_too_large",
        phase: "pre_admission",
        recovery_hint: "fix_input"
      };
    }
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("body must be an object");
    }
    return value as Record<string, unknown>;
  } catch {
    return {
      category: "request_invalid",
      code: "invalid_json_body",
      phase: "pre_admission",
      recovery_hint: "fix_input"
    };
  }
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

function admissionHealth(options: ApiServerOptions): JsonBody {
  const checks = {
    runRecordStore: options.runRecordStore === undefined ? "missing" : "configured",
    authorizationDecisionStore: options.authorizationDecisionStore === undefined ? "missing" : "configured",
    taskThreadStore: options.taskThreadStore === undefined ? "missing" : "configured",
    lodePackageResolver: options.lodePackageResolver === undefined ? "missing" : "configured",
    harborIdentityFactsReader: options.harborIdentityFactsReader === undefined ? "missing" : "configured",
    harborRuntimeClient: options.harborRuntimeClient === undefined ? "missing" : "configured"
  };
  return {
    service: serviceName,
    status: Object.values(checks).every((status) => status === "configured") ? "ready" : "degraded",
    checks,
    consumer_boundary: "Core admission health reports API wiring only; it does not launch Harbor, open a browser, or prove live site execution."
  };
}

async function route(request: IncomingMessage, response: ServerResponse, options: ApiServerOptions): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = requestUrl.pathname;
  const runMatch = /^\/runs\/([^/]+)$/.exec(path);
  const runResultMatch = /^\/runs\/([^/]+)\/result$/.exec(path);
  const runEvidenceRefsMatch = /^\/runs\/([^/]+)\/evidence-refs$/.exec(path);
  const runSessionRefsMatch = /^\/runs\/([^/]+)\/session-refs$/.exec(path);
  const runFailureMatch = /^\/runs\/([^/]+)\/failure$/.exec(path);

  const authorizationResult = await handleAuthorizationDecisionApi({
    method: request.method,
    url: requestUrl,
    ...(options.authorizationDecisionStore === undefined ? {} : { store: options.authorizationDecisionStore })
  });
  if (authorizationResult.handled) {
    sendJson(response, authorizationResult.status, authorizationResult.body);
    return;
  }

  if (path === "/threads" || path.startsWith("/threads/")) {
    const taskThreadInput = {
      method: request.method,
      path,
      ...(options.taskThreadStore === undefined ? {} : { store: options.taskThreadStore }),
      validateTask: (taskBody: JsonBody) => validateThreadTaskBody(taskBody, options),
      submitTask: (taskBody: JsonBody, runClaimToken: string) => submitTaskBody(taskBody, options, runClaimToken)
    };
    let result = await handleTaskThreadApi(taskThreadInput);
    if (!result.handled && result.requires_body) {
      const parsed = await readJsonBody(request);
      if (isFailureRecord(parsed)) {
        sendJson(response, 400, { ok: false, error: parsed });
        return;
      }
      result = await handleTaskThreadApi({ ...taskThreadInput, body: parsed });
    }
    if (result.handled) {
      sendJson(response, result.status, result.body);
      return;
    }
  }

  if (request.method === "POST" && path === "/tasks") {
    if (!options.runRecordStore) {
      sendJson(response, 503, { ok: false, error: runStoreUnavailable() });
      return;
    }
    const body = await readJsonBody(request);
    if (isFailureRecord(body)) {
      sendJson(response, 400, {
        ok: false,
        error: body
      });
      return;
    }
    const result = await submitTaskBody(body, options);
    sendJson(response, result.status, result.body);
    return;
  }

  if (path === "/identity-compatibility-preview") {
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, error: previewRequestFailure("method_not_allowed") });
      return;
    }
    if (!hasJsonMediaType(request)) {
      sendJson(response, 415, { ok: false, error: previewRequestFailure("content_type_unsupported") });
      return;
    }
    const body = await readJsonBody(request, 64 * 1024);
    if (isFailureRecord(body)) {
      sendJson(response, body.code === "request_body_too_large" ? 413 : 400, { ok: false, error: body });
      return;
    }
    if (!options.lodePackageResolver || !options.harborIdentityFactsReader) {
      sendJson(response, 503, {
        ok: false,
        error: {
          category: "resource_admission",
          code: "identity_compatibility_owner_unavailable",
          phase: "resource_matching",
          recovery_hint: "contact_operator"
        }
      });
      return;
    }
    const result = await previewIdentityCompatibility(body, {
      lodePackageResolver: options.lodePackageResolver,
      harborIdentityFactsReader: options.harborIdentityFactsReader
    });
    if (isFailureRecord(result)) {
      sendJson(response, 400, { ok: false, error: result });
      return;
    }
    sendJson(response, 200, result as unknown as JsonBody);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message: "Only supported task, thread, and query methods are allowed by the API Server"
      }
    });
    return;
  }

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

  if (path === "/admission/health") {
    sendJson(response, 200, admissionHealth(options));
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

  if (runResultMatch || runEvidenceRefsMatch || runSessionRefsMatch || runFailureMatch || runMatch) {
    if (!options.runRecordStore) {
      sendJson(response, 503, {
        ok: false,
        error: runStoreUnavailable()
      });
      return;
    }

    const runId = decodeRunId(runResultMatch?.[1] ?? runEvidenceRefsMatch?.[1] ?? runSessionRefsMatch?.[1] ?? runFailureMatch?.[1] ?? runMatch?.[1]);
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

    if (runSessionRefsMatch) {
      const result = await getRunSessionRefs(options.runRecordStore, runId);
      if (result.ok) {
        sendJson(response, 200, {
          ok: true,
          session_refs: result.session_refs
        });
        return;
      }

      sendJson(response, queryStatusCode(result.failure), {
        ok: false,
        error: result.failure
      });
      return;
    }

    if (runFailureMatch) {
      const result = await getRunFailureReason(options.runRecordStore, runId);
      if (result.ok) {
        sendJson(response, 200, {
          ok: true,
          failure_reason: result.failure_reason
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
    void route(request, response, options).catch(() => {
      sendJson(response, 500, {
        error: {
          code: "internal_error",
          message: "Internal server error"
        }
      });
    });
  });
}
