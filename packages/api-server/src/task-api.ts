import {
  isValidRunId,
  submitRuntimeTask,
  validateTaskIntent,
  type FailureRecord,
  type FileRunRecordStore,
  type HarborRuntimeClient,
  type LodePackageResolver,
  type RuntimeTaskSubmissionRequest,
  type TaskSubmissionResult
} from "@webenvoy/core-runtime";

type JsonBody = Record<string, unknown>;

export type TaskSubmissionHttpResult = {
  status: number;
  body: JsonBody;
  run_record_present: boolean;
  failure_code?: string;
};

export type TaskSubmissionDependencies = {
  runRecordStore?: FileRunRecordStore;
  lodePackageResolver?: LodePackageResolver;
  harborRuntimeClient?: HarborRuntimeClient;
};

const allowedHarborInputFields = new Set(["identity_environment_ref", "url", "reuse_existing", "timeout_ms", "evidence_policy", "session", "snapshot"]);
const privateHarborInputFieldNames = new Set([
  "raw_payload", "dom", "har", "screenshot", "video", "cookie", "cookies", "token", "tokens",
  "password", "verification_code", "local_path", "profile_path", "storage_value", "session_token",
  "runtime_session", "cdp_endpoint", "vnc_url", "viewer_url", "webSocketDebuggerUrl",
  "raw_evidence_body", "full_dom", "network_response_body", "provider_private_object"
]);

function requestInvalid(code: string, recovery_hint = "fix_input"): FailureRecord {
  return { category: "request_invalid", code, phase: "pre_admission", recovery_hint };
}

function runStoreUnavailable(): FailureRecord {
  return {
    category: "persistence_observability",
    code: "run_store_unavailable",
    phase: "query",
    recovery_hint: "contact_operator"
  };
}

function isFailureRecord(value: unknown): value is FailureRecord {
  return Boolean(value && typeof value === "object" && "category" in value);
}

function jsonObject(value: unknown): JsonBody | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonBody : undefined;
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
  return typeof value === "string" && value.length > 0 ? value : requestInvalid(code);
}

function optionalHttpUrl(value: unknown): string | FailureRecord | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return requestInvalid("harbor_url_invalid");
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // Invalid URL is mapped below.
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

export function taskSubmissionFailureStatusCode(failure: { category: string; code: string }): number {
  if (failure.code === "run_id_already_exists") return 409;
  if (failure.code === "harbor_read_operation_outcome_unknown") return 202;
  if (failure.code.startsWith("core_task_session_")) return 503;
  if (failure.category === "request_invalid") return 400;
  if (failure.category === "capability_contract") return 422;
  if (failure.category === "resource_admission" || failure.category === "evidence_reference") return 503;
  if (failure.category === "persistence_observability") return 500;
  if (failure.category === "action_risk") return 409;
  return 400;
}

function submitDuplicateRunId(): TaskSubmissionResult {
  return { ok: false, failure: requestInvalid("run_id_already_exists", "choose_new_run_id") };
}

async function validateRuntimeTaskSubmissionRequest(
  body: JsonBody,
  store: FileRunRecordStore,
  rejectExistingRun = true
): Promise<RuntimeTaskSubmissionRequest | FailureRecord> {
  const runId = optionalString(body.run_id, "run_id_invalid");
  if (runId === undefined || isFailureRecord(runId) || !isValidRunId(runId)) return requestInvalid("run_id_invalid");
  if (rejectExistingRun && await store.getRunRecord(runId)) return requestInvalid("run_id_already_exists", "choose_new_run_id");
  const task_intent = jsonObject(body.task_intent);
  if (!task_intent) return requestInvalid("task_intent_required");

  const package_ref = optionalString(body.package_ref, "package_ref_invalid");
  if (isFailureRecord(package_ref)) return package_ref;
  const publicQueryInput = body.public_query === undefined ? undefined : jsonObject(body.public_query);
  if (body.public_query !== undefined && !publicQueryInput) return requestInvalid("public_query_invalid");
  const publicQuery = publicQueryInput === undefined ? undefined : optionalString(publicQueryInput.query, "public_query_invalid");
  const capability = jsonObject(task_intent.capability);
  const scope = jsonObject(task_intent.scope);
  const bossJobSearch = package_ref === "lode://site-capability/boss/job-search@0.1.0" &&
    capability?.ref === "lode:capability/job-search" && capability.source_ref === package_ref && scope?.target_type === "boss_job_search";
  const allowedPublicQueryFields = bossJobSearch ? new Set(["query", "city_code", "page", "limit"]) : new Set(["query"]);
  const cityCode = publicQueryInput === undefined ? undefined : optionalString(publicQueryInput.city_code, "public_query_invalid");
  const page = publicQueryInput === undefined ? undefined : optionalPositiveInteger(publicQueryInput.page, "public_query_invalid");
  const limit = publicQueryInput === undefined ? undefined : optionalPositiveInteger(publicQueryInput.limit, "public_query_invalid");
  if (isFailureRecord(publicQuery) || isFailureRecord(cityCode) || isFailureRecord(page) || isFailureRecord(limit) ||
    (bossJobSearch && publicQueryInput === undefined) || (publicQueryInput && (
      publicQuery === undefined || publicQuery.trim() !== publicQuery || publicQuery.length > (bossJobSearch ? 80 : 256) ||
      Object.keys(publicQueryInput).some((field) => !allowedPublicQueryFields.has(field)) ||
      (bossJobSearch && (cityCode === undefined || !/^\d{6,32}$/.test(cityCode) || page !== 1 || limit === undefined || limit > 15))
    ))) return requestInvalid("public_query_invalid");

  const harborInput = body.harbor === undefined ? undefined : jsonObject(body.harbor);
  if (body.harbor !== undefined && !harborInput) return requestInvalid("harbor_invalid");
  let harbor: RuntimeTaskSubmissionRequest["harbor"];
  if (harborInput) {
    const unsupportedField = Object.keys(harborInput).find((field) => !allowedHarborInputFields.has(field));
    if (unsupportedField) return requestInvalid(`unsupported_harbor_field:${unsupportedField}`, "remove_private_field");
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
    const privateField = findForbiddenField(evidence_policy, privateHarborInputFieldNames);
    if (privateField) return requestInvalid(`private_field_rejected:${privateField}`, "remove_private_field");
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
    if (scope?.target_ref !== canonicalTarget.href || harbor?.url !== canonicalTarget.href) return requestInvalid("boss_target_invalid");
  }

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
    ...(harbor === undefined ? {} : { harbor })
  };
}

export async function validateThreadTaskBody(
  body: JsonBody,
  options: TaskSubmissionDependencies
): Promise<FailureRecord | undefined> {
  if (!options.runRecordStore) return runStoreUnavailable();
  const validated = await validateRuntimeTaskSubmissionRequest(body, options.runRecordStore, false);
  if (isFailureRecord(validated)) return validated;
  const taskIntent = validateTaskIntent(validated.task_intent);
  return isFailureRecord(taskIntent) ? taskIntent : undefined;
}

export async function submitTaskBody(body: JsonBody, options: TaskSubmissionDependencies, runClaimToken?: string): Promise<TaskSubmissionHttpResult> {
  if (!options.runRecordStore) {
    return {
      status: 503,
      body: { ok: false, error: runStoreUnavailable() },
      run_record_present: false,
      failure_code: "run_store_unavailable"
    };
  }
  const validated = await validateRuntimeTaskSubmissionRequest(body, options.runRecordStore);
  if (isFailureRecord(validated)) {
    return {
      status: taskSubmissionFailureStatusCode(validated),
      body: { ok: false, error: validated },
      run_record_present: false,
      failure_code: validated.code
    };
  }
  const result = await submitRuntimeTask(options.runRecordStore, {
    ...validated,
    ...(runClaimToken === undefined ? {} : { run_claim_token: runClaimToken })
  }, {
    ...(options.lodePackageResolver === undefined ? {} : { lodePackageResolver: options.lodePackageResolver }),
    ...(options.harborRuntimeClient === undefined ? {} : { harborRuntimeClient: options.harborRuntimeClient })
  }).catch((error: unknown) =>
    error instanceof Error && /^run record already exists: /.test(error.message)
      ? submitDuplicateRunId()
      : Promise.reject(error)
  );
  if (result.ok) {
    return {
      status: 202,
      body: {
        ok: true,
        task_intent: result.task_intent,
        run: result.run_record,
        evidence_refs: result.run_record.evidence_refs ?? [],
        runtime_binding_refs: result.run_record.runtime_binding_refs ?? []
      },
      run_record_present: true
    };
  }
  return {
    status: taskSubmissionFailureStatusCode(result.failure),
    body: {
      ok: false,
      error: result.failure,
      ...(result.run_record === undefined ? {} : { run: result.run_record })
    },
    run_record_present: result.run_record !== undefined,
    failure_code: result.failure.code
  };
}
