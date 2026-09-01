import {
  isValidRunId,
  submitRuntimeTask,
  validateTaskIntent,
  type FailureRecord,
  type FileAuthorizationDecisionStore,
  type FileExecutionPolicyConfigStore,
  type FileRunRecordStore,
  type HarborRuntimeClient,
  type LodePackageResolver,
  type RuntimeTaskSubmissionRequest,
  type XhsWritePrecheckCompositionPath,
  type XhsPathPrepareRequestedPath,
  xhsMediaActionPaths,
  xhsMediaCapabilityId,
  xhsMediaLockRef,
  xhsMediaPackageRef,
  type XhsMediaActionId,
  type WritePrecheckAuthorizationContext,
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
  executionPolicyConfigStore?: FileExecutionPolicyConfigStore;
  authorizationDecisionStore?: FileAuthorizationDecisionStore;
};

const allowedHarborInputFields = new Set(["identity_environment_ref", "url", "composition_path", "requested_path", "reuse_existing", "timeout_ms", "evidence_policy", "session", "snapshot"]);
const xhsWritePrecheckCompositionPaths = new Set<XhsWritePrecheckCompositionPath>([
  "image_text_upload", "image_text_generate", "video", "long_article", "podcast"
]);
const xhsPathPreparePackageRef = "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0";
const xhsPathPreparePaths = new Set<XhsPathPrepareRequestedPath>(["image_text_upload", "image_text_generate"]);
const xhsMediaResourceRequirementRef = "xiaohongshu.publish-note-image-text-media.resources";
const xhsMediaProfileByAction: Record<XhsMediaActionId, string> = {
  "xhs_publish_note_image_text_media.image_upload": "xhs-image-upload",
  "xhs_publish_note_image_text_media.text_to_image_generate": "xhs-text-to-image-generate"
};
const xhsMediaLocalFileRefPattern = /^local_file_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function isCreatorPublishUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://creator.xiaohongshu.com" && url.pathname === "/publish/publish" &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Structural API gate for the two #307 actions. Core remains the contract
 * and admission owner; this gate only rejects malformed requests before a
 * task thread or pending confirmation is created.
 */
export function isExactXhsMediaTaskBody(body: JsonBody): boolean {
  const taskIntent = jsonObject(body.task_intent);
  const capability = jsonObject(taskIntent?.capability);
  const input = jsonObject(taskIntent?.input);
  const scope = jsonObject(taskIntent?.scope);
  const policy = jsonObject(taskIntent?.policy);
  const harbor = jsonObject(body.harbor);
  const actionId = input?.action_id as XhsMediaActionId | undefined;
  const requestedPath = input?.requested_path;
  const refs = input?.refs;
  const profileId = taskIntent?.resource_requirement_profile_id;
  const requirementRefs = taskIntent?.resource_requirement_refs;
  if (body.package_ref !== xhsMediaPackageRef ||
    !input || Object.keys(input).some((key) => !["summary", "refs", "requested_path", "action_id"].includes(key)) ||
    capability?.ref !== `lode:capability/${xhsMediaCapabilityId}` ||
    capability.version !== "0.1.0" || capability.source_ref !== xhsMediaPackageRef || capability.lock_ref !== xhsMediaLockRef ||
    scope?.target_type !== "creator_publish_page" || !isCreatorPublishUrl(scope?.target_ref) ||
    typeof harbor?.identity_environment_ref !== "string" || harbor.identity_environment_ref.length === 0 ||
    !isCreatorPublishUrl(harbor?.url) || harbor?.url !== scope.target_ref ||
    typeof actionId !== "string" || !Object.hasOwn(xhsMediaActionPaths, actionId) ||
    requestedPath !== xhsMediaActionPaths[actionId] ||
    policy?.risk !== "write" || policy.execution_intent !== "execute_after_approval" ||
    profileId !== xhsMediaProfileByAction[actionId] ||
    !Array.isArray(requirementRefs) || requirementRefs.length !== 1 || requirementRefs[0] !== xhsMediaResourceRequirementRef ||
    !Array.isArray(refs) || refs.length > 18 || !refs.every((ref) => typeof ref === "string" && ref.length > 0 && ref.length <= 2_048)) {
    return false;
  }
  const summary = input.summary;
  if (typeof summary !== "string" || summary.trim() !== summary || summary.length === 0 || summary.length > 512) return false;
  if (actionId === "xhs_publish_note_image_text_media.image_upload") {
    return refs.length >= 1 && refs.every((ref) => xhsMediaLocalFileRefPattern.test(ref));
  }
  return refs.length === 0;
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
  const taskInput = jsonObject(task_intent.input);
  const pathPrepare = package_ref === xhsPathPreparePackageRef && capability?.ref === "lode:capability/publish-note-path-prepare" &&
    capability.source_ref === package_ref && scope?.target_type === "creator_publish_page";
  const mediaAction = package_ref === xhsMediaPackageRef &&
    capability?.ref === `lode:capability/${xhsMediaCapabilityId}` &&
    capability.version === "0.1.0" && capability.source_ref === package_ref && capability.lock_ref === xhsMediaLockRef &&
    scope?.target_type === "creator_publish_page";
  const bossJobSearch = package_ref === "lode://site-capability/boss/job-search@0.1.0" &&
    capability?.ref === "lode:capability/job-search" && capability.source_ref === package_ref && scope?.target_type === "boss_job_search";
  const xhsSearch = package_ref === "lode://site-capability/xiaohongshu/search-notes@0.1.0" &&
    (capability?.ref === "lode:capability/search-notes" || capability?.ref === "lode:capability/xiaohongshu-search-notes") &&
    capability.source_ref === package_ref && scope?.target_type === "search_results_page";
  const allowedPublicQueryFields = bossJobSearch
    ? new Set(["query", "city_code", "page", "limit"])
    : xhsSearch ? new Set(["query", "limit"]) : new Set(["query"]);
  const cityCode = publicQueryInput === undefined ? undefined : optionalString(publicQueryInput.city_code, "public_query_invalid");
  const page = publicQueryInput === undefined ? undefined : optionalPositiveInteger(publicQueryInput.page, "public_query_invalid");
  const limit = publicQueryInput === undefined ? undefined : optionalPositiveInteger(publicQueryInput.limit, "public_query_invalid");
  if (isFailureRecord(publicQuery) || isFailureRecord(cityCode) || isFailureRecord(page) || isFailureRecord(limit) ||
    (bossJobSearch && publicQueryInput === undefined) || (publicQueryInput && (
      publicQuery === undefined || publicQuery.trim() !== publicQuery || publicQuery.length > (bossJobSearch ? 80 : 256) ||
      Object.keys(publicQueryInput).some((field) => !allowedPublicQueryFields.has(field)) ||
      (bossJobSearch && (cityCode === undefined || !/^\d{6,32}$/.test(cityCode) || page !== 1 || limit === undefined || limit > 15)) ||
      (xhsSearch && limit !== undefined && limit > 15)
    ))) return requestInvalid("public_query_invalid");

  const harborInput = body.harbor === undefined ? undefined : jsonObject(body.harbor);
  if (body.harbor !== undefined && !harborInput) return requestInvalid("harbor_invalid");
  let harbor: RuntimeTaskSubmissionRequest["harbor"];
  if (harborInput) {
    const unsupportedField = Object.keys(harborInput).find((field) => !allowedHarborInputFields.has(field));
    if (unsupportedField) return requestInvalid(`unsupported_harbor_field:${unsupportedField}`, "remove_private_field");
    const identity_environment_ref = optionalString(harborInput.identity_environment_ref, "identity_environment_ref_invalid");
    const url = optionalHttpUrl(harborInput.url);
    const composition_path = harborInput.composition_path === undefined
      ? undefined
      : typeof harborInput.composition_path === "string" && xhsWritePrecheckCompositionPaths.has(harborInput.composition_path as XhsWritePrecheckCompositionPath)
        ? harborInput.composition_path as XhsWritePrecheckCompositionPath
        : requestInvalid("composition_path_invalid");
    const requested_path = harborInput.requested_path === undefined
      ? undefined
      : typeof harborInput.requested_path === "string" && xhsPathPreparePaths.has(harborInput.requested_path as XhsPathPrepareRequestedPath)
        ? harborInput.requested_path as XhsPathPrepareRequestedPath
        : requestInvalid("requested_path_invalid");
    const reuse_existing = optionalBoolean(harborInput.reuse_existing, "reuse_existing_invalid");
    const timeout_ms = optionalPositiveInteger(harborInput.timeout_ms, "timeout_ms_invalid");
    const evidence_policy = harborInput.evidence_policy === undefined ? undefined : jsonObject(harborInput.evidence_policy);
    const session = harborInput.session === undefined ? undefined : jsonObject(harborInput.session);
    const snapshot = harborInput.snapshot === undefined ? undefined : jsonObject(harborInput.snapshot);
    if (isFailureRecord(identity_environment_ref)) return identity_environment_ref;
    if (isFailureRecord(url)) return url;
    if (isFailureRecord(composition_path)) return composition_path;
    if (isFailureRecord(requested_path)) return requested_path;
    if (isFailureRecord(reuse_existing)) return reuse_existing;
    if (isFailureRecord(timeout_ms)) return timeout_ms;
    if (harborInput.evidence_policy !== undefined && !evidence_policy) return requestInvalid("evidence_policy_invalid");
    if (harborInput.session !== undefined && !session) return requestInvalid("harbor_session_invalid");
    if (harborInput.snapshot !== undefined && !snapshot) return requestInvalid("harbor_snapshot_invalid");
    const privateField = findForbiddenField([evidence_policy, session, snapshot], privateHarborInputFieldNames);
    if (privateField) return requestInvalid(`private_field_rejected:${privateField}`, "remove_private_field");
    harbor = {
      ...(identity_environment_ref === undefined ? {} : { identity_environment_ref }),
      ...(url === undefined ? {} : { url }),
      ...(composition_path === undefined ? {} : { composition_path }),
      ...(requested_path === undefined ? {} : { requested_path }),
      ...(reuse_existing === undefined ? {} : { reuse_existing }),
      ...(timeout_ms === undefined ? {} : { timeout_ms }),
      ...(evidence_policy === undefined ? {} : { evidence_policy })
    };
  }

  if (mediaAction) {
    if (!isExactXhsMediaTaskBody(body)) return requestInvalid("media_action_binding_invalid");
    if (harbor?.composition_path !== undefined) return requestInvalid("composition_path_not_allowed");
    if (harbor?.requested_path !== taskInput?.requested_path) return requestInvalid("requested_path_binding_invalid");
  } else if (pathPrepare) {
    if (!harbor?.requested_path || !xhsPathPreparePaths.has(harbor.requested_path) || taskInput?.requested_path !== harbor.requested_path) {
      return requestInvalid("requested_path_binding_invalid");
    }
    if (harbor.composition_path !== undefined) return requestInvalid("composition_path_not_allowed");
  } else if (harbor?.requested_path !== undefined) {
    return requestInvalid("requested_path_not_allowed");
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

export async function submitTaskBody(
  body: JsonBody,
  options: TaskSubmissionDependencies,
  runClaimToken?: string,
  authorizationContext?: WritePrecheckAuthorizationContext
): Promise<TaskSubmissionHttpResult> {
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
    ...(runClaimToken === undefined ? {} : { run_claim_token: runClaimToken }),
    ...(authorizationContext === undefined ? {} : { authorization_context: authorizationContext })
  }, {
    ...(options.lodePackageResolver === undefined ? {} : { lodePackageResolver: options.lodePackageResolver }),
    ...(options.harborRuntimeClient === undefined ? {} : { harborRuntimeClient: options.harborRuntimeClient }),
    ...(options.executionPolicyConfigStore === undefined ? {} : { executionPolicyConfigStore: options.executionPolicyConfigStore }),
    ...(options.authorizationDecisionStore === undefined ? {} : { authorizationDecisionStore: options.authorizationDecisionStore })
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
