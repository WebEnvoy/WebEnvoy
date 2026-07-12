import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  getCapabilityRunSummary,
  getRunEvidenceRefs,
  getRunFailureReason,
  getRunResult,
  getRunSessionRefs,
  getRunSummary,
  submitRuntimeTask,
  type FailureRecord,
  type FileRunRecordStore,
  type HarborRuntimeClient,
  type LodePackageResolver,
  type RuntimeTaskSubmissionRequest,
  type TaskSubmissionResult
} from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type ApiServerOptions = {
  runRecordStore?: FileRunRecordStore;
  lodePackageResolver?: LodePackageResolver;
  harborRuntimeClient?: HarborRuntimeClient;
};

const serviceName = "webenvoy-api-server";
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const allowedHarborInputFields = new Set(["identity_environment_ref", "url", "reuse_existing", "timeout_ms", "evidence_policy", "session", "snapshot"]);
const validateOnlyFields = new Set(["url", "target_ref", "no_submit_guard", "requested_fields", "include_source_refs", "proposed_input_summary"]);
const validateOnlyRequestedFields = new Set(["title", "summary", "canonical_url", "source_status"]);
const runtimeTaskFields = new Set(["run_id", "task_intent", "package_ref", "public_query", "validate_only", "harbor"]);
const privateHarborInputFieldNames = new Set([
  "raw_payload",
  "dom",
  "har",
  "screenshot",
  "video",
  "cookie",
  "cookies",
  "token",
  "tokens",
  "password",
  "verification_code",
  "local_path",
  "profile_path",
  "storage_value",
  "session_token",
  "runtime_session",
  "cdp_endpoint",
  "vnc_url",
  "viewer_url",
  "webSocketDebuggerUrl",
  "raw_evidence_body",
  "full_dom",
  "network_response_body",
  "provider_private_object"
]);

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

function requestInvalid(code: string, recovery_hint = "fix_input"): FailureRecord {
  return {
    category: "request_invalid",
    code,
    phase: "pre_admission",
    recovery_hint
  };
}

function isFailureRecord(value: unknown): value is FailureRecord {
  return Boolean(value && typeof value === "object" && "category" in value);
}

function jsonObject(value: unknown): JsonBody | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonBody) : undefined;
}

function findForbiddenField(value: unknown, forbiddenFields: ReadonlySet<string>): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenField(entry, forbiddenFields);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as JsonBody)) {
    if (forbiddenFields.has(key)) return key;
    const found = findForbiddenField(entry, forbiddenFields);
    if (found) return found;
  }
  return undefined;
}

function optionalString(value: unknown, code: string): string | FailureRecord | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return requestInvalid(code);
  return value;
}

function optionalHttpUrl(value: unknown): string | FailureRecord | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return requestInvalid("harbor_url_invalid");
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // handled below
  }
  return requestInvalid("harbor_url_invalid");
}

function optionalBoolean(value: unknown, code: string): boolean | FailureRecord | undefined {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : requestInvalid(code);
}

function optionalPositiveInteger(value: unknown, code: string): number | FailureRecord | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : requestInvalid(code);
}

function queryStatusCode(failure: FailureRecord): number {
  if (failure.code === "run_not_found") return 404;
  if (failure.code === "run_store_unavailable") return 503;
  return 400;
}

function submitStatusCode(failure: FailureRecord): number {
  if (failure.code === "run_id_already_exists") return 409;
  if (failure.code === "harbor_read_operation_outcome_unknown" || failure.code === "harbor_write_precheck_outcome_unknown" || failure.code === "timeout") return 202;
  if (failure.code.startsWith("core_task_session_")) return 503;
  if (failure.category === "request_invalid") return 400;
  if (failure.category === "capability_contract") return 422;
  if (failure.category === "resource_admission" || failure.category === "evidence_reference") return 503;
  if (failure.category === "persistence_observability") return 500;
  if (failure.category === "action_risk") return 409;
  return 400;
}

function submitDuplicateRunId(): TaskSubmissionResult {
  return {
    ok: false,
    failure: requestInvalid("run_id_already_exists", "choose_new_run_id")
  };
}

async function validateRuntimeTaskSubmissionRequest(
  body: JsonBody,
  store: FileRunRecordStore
): Promise<RuntimeTaskSubmissionRequest | FailureRecord> {
  const unsupportedField = Object.keys(body).find((field) => !runtimeTaskFields.has(field));
  if (unsupportedField) return requestInvalid(`unsupported_task_field:${unsupportedField}`);
  const runId = optionalString(body.run_id, "run_id_invalid");
  if (runId === undefined || isFailureRecord(runId) || !runIdPattern.test(runId)) return requestInvalid("run_id_invalid");
  if (await store.getRunRecord(runId)) return requestInvalid("run_id_already_exists", "choose_new_run_id");

  const task_intent = jsonObject(body.task_intent);
  if (!task_intent) return requestInvalid("task_intent_required");

  const package_ref = optionalString(body.package_ref, "package_ref_invalid");
  if (isFailureRecord(package_ref)) return package_ref;
  const publicQueryInput = body.public_query === undefined ? undefined : jsonObject(body.public_query);
  if (body.public_query !== undefined && !publicQueryInput) return requestInvalid("public_query_invalid");
  const publicQuery = publicQueryInput === undefined ? undefined : optionalString(publicQueryInput.query, "public_query_invalid");
  const capability = jsonObject(task_intent.capability);
  const scope = jsonObject(task_intent.scope);
  const xhsWritePrecheck = package_ref === "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0" &&
    capability?.ref === "lode:capability/publish-note-precheck" && capability.source_ref === package_ref && scope?.target_type === "xiaohongshu_publish_note_precheck";
  const validateOnlyInput = body.validate_only === undefined ? undefined : jsonObject(body.validate_only);
  if (body.validate_only !== undefined && !validateOnlyInput) return requestInvalid("validate_only_input_invalid");
  let validate_only: RuntimeTaskSubmissionRequest["validate_only"];
  if (validateOnlyInput) {
    const url = optionalHttpUrl(validateOnlyInput.url);
    const targetRef = optionalString(validateOnlyInput.target_ref, "validate_only_target_ref_invalid");
    const requestedFields = validateOnlyInput.requested_fields;
    const proposedSummary = optionalString(validateOnlyInput.proposed_input_summary, "validate_only_summary_invalid");
    if (!xhsWritePrecheck || isFailureRecord(url) || isFailureRecord(targetRef) || isFailureRecord(proposedSummary) || url === undefined || targetRef === undefined ||
      Object.keys(validateOnlyInput).some((field) => !validateOnlyFields.has(field)) || validateOnlyInput.no_submit_guard !== "active" ||
      (requestedFields !== undefined && (!Array.isArray(requestedFields) || requestedFields.length < 1 || requestedFields.length > 4 || new Set(requestedFields).size !== requestedFields.length || !requestedFields.every((field) => typeof field === "string" && validateOnlyRequestedFields.has(field)))) ||
      (validateOnlyInput.include_source_refs !== undefined && typeof validateOnlyInput.include_source_refs !== "boolean") ||
      targetRef.length > 200 || /[\u0000-\u001f\u007f]/.test(targetRef) ||
      (typeof proposedSummary === "string" && (proposedSummary.length > 500 || proposedSummary.trim() !== proposedSummary || /[\u0000-\u001f\u007f]/.test(proposedSummary)))
    ) return requestInvalid("validate_only_input_invalid");
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== "https://creator.xiaohongshu.com" || parsedUrl.pathname !== "/publish/publish" || parsedUrl.username || parsedUrl.password || parsedUrl.hash) return requestInvalid("validate_only_input_invalid");
    validate_only = {
      url: parsedUrl.href, target_ref: targetRef, no_submit_guard: "active",
      ...(requestedFields === undefined ? {} : { requested_fields: requestedFields as ("title" | "summary" | "canonical_url" | "source_status")[] }),
      ...(validateOnlyInput.include_source_refs === undefined ? {} : { include_source_refs: validateOnlyInput.include_source_refs as boolean }),
      ...(proposedSummary === undefined ? {} : { proposed_input_summary: proposedSummary })
    };
  }
  if (xhsWritePrecheck !== Boolean(validate_only)) return requestInvalid("validate_only_input_required");
  const bossJobSearch = package_ref === "lode://site-capability/boss/job-search@0.1.0" &&
    capability?.ref === "lode:capability/job-search" && capability.source_ref === package_ref && scope?.target_type === "boss_job_search";
  const allowedPublicQueryFields = bossJobSearch ? new Set(["query", "city_code", "page", "limit"]) : new Set(["query"]);
  const cityCode = publicQueryInput === undefined ? undefined : optionalString(publicQueryInput.city_code, "public_query_invalid");
  const page = publicQueryInput === undefined ? undefined : optionalPositiveInteger(publicQueryInput.page, "public_query_invalid");
  const limit = publicQueryInput === undefined ? undefined : optionalPositiveInteger(publicQueryInput.limit, "public_query_invalid");
  if (isFailureRecord(publicQuery) || isFailureRecord(cityCode) || isFailureRecord(page) || isFailureRecord(limit) || (bossJobSearch && publicQueryInput === undefined) || (publicQueryInput && (
    publicQuery === undefined || publicQuery.trim() !== publicQuery || publicQuery.length > (bossJobSearch ? 80 : 256) ||
    Object.keys(publicQueryInput).some((field) => !allowedPublicQueryFields.has(field)) ||
    (bossJobSearch && (cityCode === undefined || !/^\d{6,32}$/.test(cityCode) || page !== 1 || limit === undefined || limit > 15))
  ))) {
    return requestInvalid("public_query_invalid");
  }

  const harborInput = body.harbor === undefined ? undefined : jsonObject(body.harbor);
  if (body.harbor !== undefined && !harborInput) return requestInvalid("harbor_invalid");

  let harbor: RuntimeTaskSubmissionRequest["harbor"];
  if (harborInput) {
    const unsupportedHarborField = Object.keys(harborInput).find((field) => !allowedHarborInputFields.has(field));
    if (unsupportedHarborField) return requestInvalid(`unsupported_harbor_field:${unsupportedHarborField}`, "remove_private_field");
    const identity_environment_ref = optionalString(harborInput.identity_environment_ref, "identity_environment_ref_invalid");
    const url = optionalHttpUrl(harborInput.url);
    const reuse_existing = optionalBoolean(harborInput.reuse_existing, "reuse_existing_invalid");
    const timeout_ms = optionalPositiveInteger(harborInput.timeout_ms, "timeout_ms_invalid");
    const evidence_policy = harborInput.evidence_policy === undefined ? undefined : jsonObject(harborInput.evidence_policy);
    if (isFailureRecord(identity_environment_ref)) return identity_environment_ref;
    if (isFailureRecord(url)) return url;
    if (isFailureRecord(reuse_existing)) return reuse_existing;
    if (isFailureRecord(timeout_ms)) return timeout_ms;
    if (harborInput.evidence_policy !== undefined && !evidence_policy) return requestInvalid("evidence_policy_invalid");
    const privateEvidencePolicyField = findForbiddenField(evidence_policy, privateHarborInputFieldNames);
    if (privateEvidencePolicyField) return requestInvalid(`private_field_rejected:${privateEvidencePolicyField}`, "remove_private_field");
    harbor = {
      ...(identity_environment_ref === undefined ? {} : { identity_environment_ref }),
      ...(url === undefined ? {} : { url }),
      ...(reuse_existing === undefined ? {} : { reuse_existing }),
      ...(timeout_ms === undefined ? {} : { timeout_ms }),
      ...(evidence_policy === undefined ? {} : { evidence_policy })
    };
  }

  if (bossJobSearch && publicQuery !== undefined && cityCode !== undefined) {
    const canonicalTarget = new URL("/web/geek/job", "https://www.zhipin.com");
    canonicalTarget.searchParams.set("query", publicQuery);
    canonicalTarget.searchParams.set("city", cityCode);
    if (scope?.target_ref !== canonicalTarget.href || harbor?.url !== canonicalTarget.href) {
      return requestInvalid("boss_target_invalid");
    }
  }
  if (validate_only && (scope?.target_ref !== validate_only.url || harbor?.url !== validate_only.url || publicQueryInput !== undefined)) return requestInvalid("validate_only_target_invalid");

  return {
    run_id: runId,
    task_intent,
    ...(package_ref === undefined ? {} : { package_ref }),
    ...(publicQuery === undefined ? {} : { public_query: {
      query: publicQuery,
      ...(cityCode === undefined ? {} : { city_code: cityCode }),
      ...(page === undefined ? {} : { page }),
      ...(limit === undefined ? {} : { limit })
    } }),
    ...(validate_only === undefined ? {} : { validate_only }),
    ...(harbor === undefined ? {} : { harbor })
  };
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
    lodePackageResolver: options.lodePackageResolver === undefined ? "missing" : "configured",
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

  if (request.method === "POST" && path === "/tasks") {
    if (!options.runRecordStore) {
      sendJson(response, 503, {
        ok: false,
        error: runStoreUnavailable()
      });
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
    const validated = await validateRuntimeTaskSubmissionRequest(body, options.runRecordStore);
    if (isFailureRecord(validated)) {
      sendJson(response, submitStatusCode(validated), {
        ok: false,
        error: validated
      });
      return;
    }
    const result = await submitRuntimeTask(options.runRecordStore, validated, {
      ...(options.lodePackageResolver === undefined ? {} : { lodePackageResolver: options.lodePackageResolver }),
      ...(options.harborRuntimeClient === undefined ? {} : { harborRuntimeClient: options.harborRuntimeClient })
    }).catch((error: unknown) =>
      error instanceof Error && /^run record already exists: /.test(error.message)
        ? submitDuplicateRunId()
        : Promise.reject(error)
    );
    if (result.ok) {
      sendJson(response, 202, {
        ok: true,
        task_intent: result.task_intent,
        run: result.run_record,
        evidence_refs: result.run_record.evidence_refs ?? [],
        runtime_binding_refs: result.run_record.runtime_binding_refs ?? []
      });
      return;
    }
    sendJson(response, submitStatusCode(result.failure), {
      ok: false,
      error: result.failure,
      ...(result.run_record === undefined ? {} : { run: result.run_record })
    });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message: "Only GET and POST /tasks are supported by the API Server"
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
