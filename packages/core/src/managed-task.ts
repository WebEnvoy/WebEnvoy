import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, type FileManagedAccessStore, type ManagedOperation, type ManagedTaskOperation, type ManagedTaskScope } from "./managed-access.js";
import type { createManagedBrowserService } from "./managed-browser.js";
import type { createFileSkillLibraryService } from "./skill-library.js";
import { publicRunResult, terminalRunRecordStatuses, type FailureRecord, type FileRunRecordStore, type PostCheckResult, type RunRecord } from "./run-record-store.js";
import { completeRunWithFailure, completeRunWithResult, type ResultEnvelope } from "./result-envelope.js";
import { validateTaskIntent } from "./task-submission.js";
import { isValidRunId } from "./run-id.js";
import { normalizePublicOrigin, normalizeStoredTargetRef } from "./public-target-reference.js";
import { ProgramPublicHttpError, parseProgramPublicHttpPolicy, readProgramPublicHttp, validateProgramPublicHttpCall, type ProgramPublicHttpPolicy, type ProgramPublicHttpResponse } from "./program-public-http.js";

type JsonObject = Record<string, unknown>;
type ParsedScope = ManagedTaskScope & { skill_refs: string[]; source_refs: string[]; profile_refs: string[]; origins: string[] };
type ParsedRequest = {
  schema_version: "webenvoy.managed-task-operation/v1";
  operation: ManagedTaskOperation;
  grant_id: string;
  connection_id: string;
  task_scope: ParsedScope;
  idempotency_key?: string;
  package?: { package_ref: string; revision_ref: string; package_digest: string; task_ref: string };
  target?: { target_type: string; target_ref: string };
  input?: { schema_ref: string; carrier: "none" | "webenvoy.managed-task-inline/v1"; value?: unknown };
  intent?: { summary: string; policy: { risk: string; execution_intent: string; timeout_ms?: number } };
  selector?: { run_id?: string; original_idempotency_key?: string };
};
type ActiveManagedSiteTicket = {
  ticket_id: string;
  run_id: string;
  credential_hash: string;
  input: ParsedRequest;
  principal_id: string;
  profile_ref: string;
  origin: string;
  deadline_at: number;
  package: NonNullable<ParsedRequest["package"]>;
  sitePackage: Awaited<ReturnType<ReturnType<typeof createFileSkillLibraryService>["resolveManagedSiteTask"]>>;
  taskFacts: ReturnType<typeof assertPinnedTask>;
  target_ref: string;
  cancelled: boolean;
  dispatched: boolean;
  worker_started: boolean;
  snapshot_started: boolean;
  snapshot?: JsonObject;
  network_started: boolean;
  network_controller: AbortController | undefined;
  public_response?: Pick<ProgramPublicHttpResponse, "response_ref" | "facts" | "url" | "status" | "content_type">;
  output?: JsonObject;
  postCheck?: PostCheckResult;
  failure_code?: string;
  outcome_uncertain?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  account_system?: { local_definition_ref: string; revision_ref: string; template_ref: string; template_sha256: string };
};

const responseSchemaVersion = "webenvoy.managed-task-operation-result/v1" as const;
const pageTaskIntentCapabilityRef = "lode:capability/managed-page-snapshot";
const taskTargetType = "web_page";
const snapshotCompletenessBoundary = "Core requires one complete Harbor page snapshot before evaluating the pinned Lode task output and business post-check.";
const postCheckBoundary = "Core evaluated the pinned Lode post-check against actual Harbor snapshot facts; it does not assert third-party processing.";

function fail(code: string): never { throw new ManagedAccessError(code); }
function isObject(value: unknown): value is JsonObject { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function object(value: unknown, required: string[], optional: string[] = []): JsonObject {
  if (!isObject(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) return fail("managed_task_invalid_input");
  return value;
}
function string(value: unknown, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return fail("managed_task_invalid_input");
  return value;
}
function stringArray(value: unknown, max = 1024): string[] {
  if (!Array.isArray(value) || value.length > max) return fail("managed_task_invalid_input");
  const result = value.map(item => string(item));
  if (new Set(result).size !== result.length) return fail("managed_task_invalid_input");
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function parseScope(value: unknown, operation: ManagedTaskOperation): ParsedScope {
  const input = object(value, ["operations", "skill_refs", "source_refs", "profile_refs", "origins"]);
  const operations = stringArray(input.operations, 1) as ManagedOperation[];
  const skill_refs = stringArray(input.skill_refs), source_refs = stringArray(input.source_refs), profile_refs = stringArray(input.profile_refs);
  const origins = stringArray(input.origins).map(value => {
    const normalized = normalizePublicOrigin(value);
    if (normalized !== value) return fail("managed_task_invalid_input");
    return value;
  });
  if (operations.length !== 1 || operations[0] !== operation || skill_refs.length !== 1 || source_refs.length !== 1 || profile_refs.length !== 1 || origins.length !== 1) return fail("managed_access_denied");
  return { operations, skill_refs, source_refs, profile_refs, origins };
}
function parseRequest(value: unknown): ParsedRequest {
  if (!isObject(value)) return fail("managed_task_invalid_input");
  const operation = value.operation;
  if (operation !== "task.submit" && operation !== "task.query" && operation !== "task.stop") return fail("managed_task_invalid_input");
  const required = ["schema_version", "operation", "grant_id", "connection_id", "task_scope"];
  const optionalByOperation: Record<ManagedTaskOperation, string[]> = {
    "task.submit": ["idempotency_key", "package", "target", "input", "intent"],
    "task.query": ["selector"],
    "task.stop": ["idempotency_key", "selector"]
  };
  const operationRequired = operation === "task.submit" ? ["idempotency_key", "package", "input", "intent"]
    : operation === "task.query" ? ["selector"] : ["idempotency_key", "selector"];
  const input = object(value, [...required, ...operationRequired], required.concat(optionalByOperation[operation]));
  if (input.schema_version !== "webenvoy.managed-task-operation/v1") return fail("managed_task_version_unsupported");
  const parsed: ParsedRequest = {
    schema_version: "webenvoy.managed-task-operation/v1",
    operation,
    grant_id: string(input.grant_id),
    connection_id: string(input.connection_id),
    task_scope: parseScope(input.task_scope, operation)
  };
  if (operation === "task.submit") {
    parsed.idempotency_key = string(input.idempotency_key);
    if (parsed.idempotency_key.length > 512) return fail("managed_task_invalid_input");
    const pkg = object(input.package, ["package_ref", "revision_ref", "package_digest", "task_ref"]);
    const package_digest = string(pkg.package_digest);
    if (!/^sha256:[a-f0-9]{64}$/.test(package_digest)) return fail("managed_task_invalid_input");
    parsed.package = { package_ref: string(pkg.package_ref), revision_ref: string(pkg.revision_ref), package_digest, task_ref: string(pkg.task_ref) };
    if (Object.hasOwn(input, "target")) {
      const target = object(input.target, ["target_type", "target_ref"]);
      const target_ref = string(target.target_ref, 2048);
      if (target_ref.includes("://") || normalizeStoredTargetRef(target_ref) !== target_ref) return fail("managed_task_invalid_input");
      parsed.target = { target_type: string(target.target_type), target_ref };
    }
    const taskInput = object(input.input, ["schema_ref", "carrier"], ["value"]);
    if (taskInput.carrier === "none") {
      if (Object.hasOwn(taskInput, "value")) return fail("managed_task_invalid_input");
      parsed.input = { schema_ref: string(taskInput.schema_ref), carrier: "none" };
    } else if (taskInput.carrier === "webenvoy.managed-task-inline/v1" && Object.hasOwn(taskInput, "value")) {
      const serialized = canonical(taskInput.value);
      if (Buffer.byteLength(serialized, "utf8") > 65_536) return fail("managed_task_invalid_input");
      parsed.input = { schema_ref: string(taskInput.schema_ref), carrier: "webenvoy.managed-task-inline/v1", value: taskInput.value };
    } else return fail("managed_task_invalid_input");
    const intent = object(input.intent, ["summary", "policy"]);
    const policy = object(intent.policy, ["risk", "execution_intent"], ["timeout_ms"]);
    if (typeof intent.summary !== "string" || !intent.summary.length || Buffer.byteLength(intent.summary, "utf8") > 256 || /[\u0000-\u001f\u007f]/.test(intent.summary) ||
        policy.timeout_ms !== undefined && (!Number.isSafeInteger(policy.timeout_ms) || Number(policy.timeout_ms) < 1 || Number(policy.timeout_ms) > 60_000)) return fail("managed_task_invalid_input");
    if (policy.risk !== "read" || policy.execution_intent !== "read") return fail("managed_access_denied");
    parsed.intent = { summary: intent.summary, policy: { risk: "read", execution_intent: "read", ...(policy.timeout_ms === undefined ? {} : { timeout_ms: Number(policy.timeout_ms) }) } };
  } else {
    if (operation === "task.stop") {
      parsed.idempotency_key = string(input.idempotency_key);
      if (parsed.idempotency_key.length > 512) return fail("managed_task_invalid_input");
    }
    const selector = object(input.selector, operation === "task.stop" ? ["run_id"] : [], ["run_id", "original_idempotency_key"]);
    if (Object.hasOwn(selector, "run_id") === Object.hasOwn(selector, "original_idempotency_key")) return fail("managed_task_invalid_input");
    if (operation === "task.stop" && !Object.hasOwn(selector, "run_id")) return fail("managed_task_invalid_input");
    parsed.selector = {
      ...(selector.run_id === undefined ? {} : { run_id: string(selector.run_id) }),
      ...(selector.original_idempotency_key === undefined ? {} : { original_idempotency_key: string(selector.original_idempotency_key) })
    };
  }
  return parsed;
}
function accessRequest(input: ParsedRequest, profileRef: string, origin: string, packageRef: string, revisionRef: string) {
  return {
    connection_id: input.connection_id, grant_id: input.grant_id, operation: input.operation,
    profile_ref: profileRef, origin, skill_ref: packageRef, source_ref: revisionRef,
    task_scope: input.task_scope
  };
}
function assertScopeMatches(input: ParsedRequest, facts: { package_ref: string; revision_ref: string; profile_ref: string; origin: string }): void {
  if (input.task_scope.skill_refs[0] !== facts.package_ref || input.task_scope.source_refs[0] !== facts.revision_ref ||
      input.task_scope.profile_refs[0] !== facts.profile_ref || input.task_scope.origins[0] !== facts.origin) return fail("managed_task_operation_unavailable");
}
function assertPinnedTask(task: JsonObject, sitePackage: Awaited<ReturnType<ReturnType<typeof createFileSkillLibraryService>["resolveManagedSiteTask"]>>): {
  kind: "page_snapshot" | "program_public_read"; operationId: string; targetType: string; targetRef: string; origin: string;
  inputSchemaRef: string; inputCarrier: "none" | "webenvoy.managed-task-inline/v1"; maxInputBytes: number;
  outputSchemaRef: string; resultKind: string; checkRef: string; networkRead?: ProgramPublicHttpPolicy; accountSystemRef?: string
} {
  const applicability = isObject(task.applicability) ? task.applicability : {};
  const dataHandling = isObject(task.data_handling) ? task.data_handling : {};
  const inputs = isObject(task.inputs) ? task.inputs : {};
  const outputs = isObject(task.outputs) ? task.outputs : {};
  const verification = isObject(task.verification) ? task.verification : {};
  const origins = applicability.origins;
  const origin = Array.isArray(origins) && origins.length === 1 && typeof origins[0] === "string" ? origins[0] : undefined;
  const common = task.task_ref === sitePackage.task_ref && task.action === "read" && !!origin && outputs.completeness === "required" &&
    typeof outputs.result_kind === "string" && typeof inputs.schema_ref === "string" && typeof outputs.schema_ref === "string" &&
    typeof verification.post_check_ref === "string" && sitePackage.capability.action === "read" && sitePackage.capability.operation_id === task.operation_id;
  if (!common) return fail("managed_skill_source_corrupt");
  let kind: "page_snapshot" | "program_public_read";
  let inputCarrier: "none" | "webenvoy.managed-task-inline/v1";
  let maxInputBytes: number;
  let networkRead: ProgramPublicHttpPolicy | undefined;
  let targetRef = "";
  if (task.operation_id === "instance.snapshot" && applicability.target_type === taskTargetType && inputs.carrier === "none" && inputs.max_bytes === 0 &&
      !Object.hasOwn(task, "network_read") && sitePackage.script?.broker !== "webenvoy.site-skill-broker/v1.1") {
    kind = "page_snapshot";
    inputCarrier = "none";
    maxInputBytes = 0;
  } else if (task.operation_id === "network.public_read" && applicability.target_type === "public_http_origin" &&
      inputs.carrier === "webenvoy.managed-task-inline/v1" && Number.isSafeInteger(inputs.max_bytes) && Number(inputs.max_bytes) >= 0 && Number(inputs.max_bytes) <= 65_536 &&
      dataHandling.external_egress === "declared" && sitePackage.script?.broker === "webenvoy.site-skill-broker/v1.1" &&
      canonical(sitePackage.script.broker_capabilities) === canonical(["network.read", "output.write"])) {
    kind = "program_public_read";
    inputCarrier = "webenvoy.managed-task-inline/v1";
    maxInputBytes = Number(inputs.max_bytes);
    targetRef = origin;
    try { networkRead = parseProgramPublicHttpPolicy(task.network_read, origin); }
    catch { return fail("managed_skill_source_corrupt"); }
  } else return fail("managed_skill_source_corrupt");
  const accountSystemRef = applicability.account_system_ref === undefined ? undefined : string(applicability.account_system_ref, 512);
  return { kind, operationId: string(task.operation_id), targetType: string(applicability.target_type), targetRef,
    origin, inputSchemaRef: string(inputs.schema_ref), inputCarrier, maxInputBytes, outputSchemaRef: string(outputs.schema_ref),
    resultKind: string(outputs.result_kind), checkRef: string(verification.post_check_ref), ...(networkRead ? { networkRead } : {}),
    ...(accountSystemRef === undefined ? {} : { accountSystemRef }) };
}
function schemaValid(value: unknown, schemaValue: unknown): boolean {
  if (!isObject(schemaValue)) return false;
  const schema = schemaValue;
  if (Object.hasOwn(schema, "const") && canonical(value) !== canonical(schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(item => canonical(item) === canonical(value))) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeMatches = (type: unknown): boolean => {
    if (type === "object") return isObject(value);
    if (type === "array") return Array.isArray(value);
    if (type === "string") return typeof value === "string";
    if (type === "boolean") return typeof value === "boolean";
    if (type === "integer") return Number.isSafeInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "null") return value === null;
    return false;
  };
  if (schema.type !== undefined && (!Array.isArray(schema.type) && typeof schema.type !== "string" || !types.some(typeMatches))) return false;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === "string") {
      try { if (!new RegExp(schema.pattern).test(value)) return false; } catch { return false; }
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.items !== undefined && (!isObject(schema.items) || !value.every(item => schemaValid(item, schema.items)))) return false;
  }
  if (isObject(value)) {
    if (!isObject(value)) return false;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (required.some(key => typeof key !== "string" || !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) return false;
    if (!Object.entries(value).every(([key, item]) => properties[key] === undefined || schemaValid(item, properties[key]))) return false;
  }
  if (Array.isArray(schema.allOf) && !schema.allOf.every(part => schemaValid(value, part))) return false;
  if (schema.if !== undefined) {
    if (!isObject(schema.if)) return false;
    const branch = schemaValid(value, schema.if) ? schema.then : schema.else;
    if (branch !== undefined && (!isObject(branch) || !schemaValid(value, branch))) return false;
  }
  const supported = new Set(["$schema", "$id", "type", "const", "enum", "required", "properties", "items", "additionalProperties", "minItems", "maxItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "allOf", "if", "then", "else", "title", "description"]);
  if (Object.keys(schema).some(key => !supported.has(key))) return false;
  return true;
}
function normalizedField(value: unknown): boolean { return value !== undefined && value !== null && (typeof value !== "string" || value.length > 0 && value.trim() === value); }
function evaluatePostCheck(output: JsonObject, check: JsonObject, facts: { sourceRef: string; evidenceRef: string }): { passed: boolean; postCheck: PostCheckResult } {
  const normalized = isObject(output.normalized) ? output.normalized : {};
  const outputEvidence = Array.isArray(output.evidence_refs) ? output.evidence_refs.filter(isObject) : [];
  let passed = check.schema_version === "lode.post-check.v0" && Array.isArray(check.requirements) && check.requirements.length > 0;
  const matched: string[] = [];
  for (const rawRequirement of Array.isArray(check.requirements) ? check.requirements : []) {
    if (!isObject(rawRequirement)) { passed = false; continue; }
    const requirement = rawRequirement;
    if (requirement.required_status !== output.status) passed = false;
    const requiredFields = Array.isArray(requirement.required_normalized_fields) ? requirement.required_normalized_fields : [];
    for (const field of requiredFields) if (typeof field !== "string" || !Object.hasOwn(normalized, field) || !normalizedField(normalized[field])) passed = false;
    const expected = isObject(requirement.expected_normalized_fields) ? requirement.expected_normalized_fields : {};
    for (const [field, expectation] of Object.entries(expected)) {
      if (["string", "number", "boolean"].includes(typeof expectation) || expectation === null) {
        if (canonical(normalized[field]) !== canonical(expectation)) passed = false;
      } else if (isObject(expectation) && Object.keys(expectation).length === 1 && typeof expectation.contains === "string") {
        if (typeof normalized[field] !== "string" || !normalized[field].includes(expectation.contains)) passed = false;
      } else passed = false;
    }
    const requiredEvidence = Array.isArray(requirement.required_evidence_refs) ? requirement.required_evidence_refs : [];
    for (const kind of requiredEvidence) {
      if (typeof kind !== "string" || !outputEvidence.some(item => item.evidence_kind === kind && item.ref_id === facts.evidenceRef)) passed = false;
    }
    if (passed && typeof requirement.requirement_id === "string") matched.push(requirement.requirement_id);
  }
  const postCheck: PostCheckResult = {
    schema_version: "webenvoy.post-check-result.v0", status: passed ? "passed" : "failed",
    summary: passed ? `Pinned Lode post-check passed: ${matched.join(", ")}.` : "Pinned Lode task output did not satisfy its declared business post-check.",
    checked_at: new Date().toISOString(), ...(passed ? {} : { code: "site_task_post_check_failed", recovery_hint: "query_original_run_only" }),
    evidence_refs: [facts.evidenceRef], source_refs: [facts.sourceRef], consumer_boundary: postCheckBoundary
  };
  return { passed, postCheck };
}
function summaryFacts(run: RunRecord): { package_ref: string; revision_ref: string; profile_ref: string; origin: string; source_ref: string; task_ref: string; package_digest: string; input_schema_ref: string; input_carrier: "none" | "webenvoy.managed-task-inline/v1"; principal_id: string; grant_id: string; request_hash: string; target_ref: string; target_type: string } | undefined {
  const summary = run.public_result_summary;
  if (!summary || summary.task_kind !== "managed_site_task" ||
      typeof summary.package_ref !== "string" || typeof summary.revision_ref !== "string" || typeof summary.profile_ref !== "string" ||
      typeof summary.origin !== "string" || typeof summary.source_ref !== "string" || typeof summary.task_ref !== "string" ||
      typeof summary.package_digest !== "string" || typeof summary.input_schema_ref !== "string" || !["none", "webenvoy.managed-task-inline/v1"].includes(String(summary.input_carrier)) ||
      typeof summary.principal_id !== "string" || typeof summary.grant_id !== "string" || typeof summary.request_hash !== "string" ||
      typeof summary.target_ref !== "string" || typeof summary.target_type !== "string") return undefined;
  return summary as ReturnType<typeof summaryFacts> extends infer T ? Exclude<T, undefined> : never;
}
function response(run: RunRecord, operation: ManagedTaskOperation, operationRef = run.run_id, failureOverride?: JsonObject | null) {
  const summary = run.public_result_summary;
  const input = isObject(summary?.input) ? summary.input : {};
  const result = publicRunResult(run);
  return {
    ok: true as const,
    schema_version: responseSchemaVersion,
    operation,
    operation_ref: operationRef,
    run: { run_id: run.run_id, task_intent_ref: run.task_intent_ref, package_ref: run.package_ref ?? "", status: run.status,
      dispatch_state: summary?.dispatch_state === "dispatched" ? "dispatched" as const : "not_dispatched" as const },
    input: { schema_ref: typeof input.schema_ref === "string" ? input.schema_ref : "unavailable",
      carrier: input.carrier === "webenvoy.managed-task-inline/v1" ? "webenvoy.managed-task-inline/v1" as const : "none" as const,
      value_present: input.value_present === true },
    result: isObject(result) ? result as unknown as ResultEnvelope : null,
    failure: failureOverride !== undefined ? failureOverride : run.failure ?? null
  };
}
function publicFailure(category: FailureRecord["category"], code: string, phase: FailureRecord["phase"], recovery_hint: string): FailureRecord {
  return { category, code, phase, recovery_hint };
}

export function createManagedTaskService(options: {
  accessStore: FileManagedAccessStore;
  runRecordStore: FileRunRecordStore;
  skillLibraryService: Pick<ReturnType<typeof createFileSkillLibraryService>, "resolveManagedSiteTask">;
  managedBrowserService?: Pick<ReturnType<typeof createManagedBrowserService>, "executeTaskSnapshot">;
  workerIdentity?: { owner_uid: number; agent_uid: number; mode: string; owner_socket_acl: string };
  accountSystemDefinitionService?: {
    resolveTemplate(templateRef: string): Promise<unknown>;
  };
}) {
  const store = options.runRecordStore;
  const directory = join(store.directory, "managed-task-operation-locks");
  const activeTickets = new Map<string, ActiveManagedSiteTicket>();
  function deactivateWorkerTicket(active: ActiveManagedSiteTicket): void {
    active.cancelled = true;
    active.network_controller?.abort();
    if (active.timer !== undefined) clearTimeout(active.timer);
    if (activeTickets.get(active.ticket_id) === active) activeTickets.delete(active.ticket_id);
  }

  async function authorize(credentialHash: string, input: ParsedRequest, profileRef: string, origin: string, packageRef: string, revisionRef: string) {
    return options.accessStore.checkAccess(credentialHash, accessRequest(input, profileRef, origin, packageRef, revisionRef));
  }
  async function resolveTaskAccountSystem(templateRef: string | undefined): Promise<{ local_definition_ref: string; local_revision_ref: string; template_ref: string; template_sha256: string } | undefined> {
    if (templateRef === undefined) return undefined;
    if (!options.accountSystemDefinitionService) return fail("account_system_definition_unavailable");
    const resolved = await options.accountSystemDefinitionService.resolveTemplate(templateRef);
    if (!isObject(resolved) || resolved.template_ref !== templateRef || resolved.historical === true ||
        typeof resolved.local_definition_ref !== "string" || !/^webenvoy:account-system\/[0-9a-f-]{36}$/.test(resolved.local_definition_ref) ||
        typeof resolved.revision_ref !== "string" || !/^webenvoy:account-system-revision\/[0-9a-f-]{36}@[1-9][0-9]*#sha256:[a-f0-9]{64}$/.test(resolved.revision_ref) ||
        typeof resolved.template_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(resolved.template_sha256)) return fail("account_system_definition_unavailable");
    return {
      template_ref: templateRef,
      local_definition_ref: resolved.local_definition_ref,
      local_revision_ref: resolved.revision_ref,
      template_sha256: resolved.template_sha256
    };
  }
  function runId(principalId: string, key: string): string { return `managed-task-${digest(`${principalId}\0${key}`)}`; }
  async function finishFailure(runId: string, code: string, status: "failed" | "unknown_outcome", dispatchState: "not_dispatched" | "dispatched", options: { evidenceRef?: string; sourceRef?: string; postCheck?: PostCheckResult; failure?: FailureRecord } = {}): Promise<RunRecord> {
    const current = await store.getRunRecord(runId);
    if (!current) throw new Error(`run record not found: ${runId}`);
    if (terminalRunRecordStatuses.has(current.status)) return current;
    const failure = options.failure ?? publicFailure(status === "unknown_outcome" ? "write_outcome" : "runtime_execution", code, status === "unknown_outcome" ? "reconciliation" : "execution", "query_original_run_only");
    try {
      const terminal = await completeRunWithFailure(store, runId, { status, failure,
        persisted_public_summary: { ...current.public_result_summary, dispatch_state: dispatchState }, persist_result_envelope: true,
        ...(options.evidenceRef === undefined ? {} : { evidence_refs: [options.evidenceRef] }), ...(options.postCheck === undefined ? {} : { post_check: options.postCheck }) });
      return terminal.run_record;
    } catch (error) {
      const latest = await store.getRunRecord(runId);
      if (latest && terminalRunRecordStatuses.has(latest.status)) return latest;
      throw error;
    }
  }
  async function lookupRun(credentialHash: string, input: ParsedRequest, principalId: string): Promise<RunRecord> {
    const selectedRunId = input.selector?.run_id ?? (input.selector?.original_idempotency_key ? runId(principalId, input.selector.original_idempotency_key) : undefined);
    if (!selectedRunId || !isValidRunId(selectedRunId)) return fail("managed_task_operation_unavailable");
    let run = await store.getRunRecord(selectedRunId);
    if (!run || run.public_result_summary?.principal_id !== principalId || !summaryFacts(run)) return fail("managed_task_operation_unavailable");
    const facts = summaryFacts(run)!;
    assertScopeMatches(input, { package_ref: facts.package_ref, revision_ref: facts.revision_ref, profile_ref: facts.profile_ref, origin: facts.origin });
    try {
      await authorize(credentialHash, input, facts.profile_ref, facts.origin, facts.package_ref, facts.revision_ref);
    } catch (error) {
      if (error instanceof ManagedAccessError && error.code === "managed_access_denied") return fail("managed_task_operation_unavailable");
      throw error;
    }
    return recoverOrphanedScriptRun(run);
  }
  async function recoverOrphanedScriptRun(run: RunRecord): Promise<RunRecord> {
    const summary = run.public_result_summary;
    if ((run.status !== "running" && run.status !== "admitted") || summary?.script_execution !== true ||
        [...activeTickets.values()].some(ticket => ticket.run_id === run.run_id)) return run;
    const dispatchState = summary.dispatch_state === "dispatched" ? "dispatched" : "not_dispatched";
    return finishFailure(run.run_id, "managed_site_worker_lost", dispatchState === "dispatched" ? "unknown_outcome" : "failed", dispatchState,
      { ...(typeof summary.target_ref === "string" ? { sourceRef: summary.target_ref } : {}),
        failure: publicFailure(dispatchState === "dispatched" ? "write_outcome" : "runtime_execution", "managed_site_worker_lost",
          dispatchState === "dispatched" ? "reconciliation" : "execution", "query_original_run_only") });
  }
  async function revalidateWorkerTicket(active: ActiveManagedSiteTicket): Promise<void> {
    if (active.cancelled || activeTickets.get(active.ticket_id) !== active || Date.now() >= active.deadline_at) return fail("managed_task_ticket_inactive");
    const run = await store.getRunRecord(active.run_id);
    if (!run || run.status !== "running" || run.public_result_summary?.principal_id !== active.principal_id ||
        run.public_result_summary?.grant_id !== active.input.grant_id || run.public_result_summary?.revision_ref !== active.package.revision_ref ||
        run.public_result_summary?.package_digest !== active.package.package_digest ||
        run.public_result_summary?.script_execution !== true || run.public_result_summary?.script_ref !== active.sitePackage.script?.script_ref ||
        run.public_result_summary?.script_sha256 !== active.sitePackage.script?.sha256 ||
        run.public_result_summary?.source_admission_ref !== active.sitePackage.source_admission_ref ||
        run.public_result_summary?.code_admission_ref !== active.sitePackage.code_admission_ref) return fail("managed_task_ticket_inactive");
    await options.accessStore.authenticateCredential(active.credential_hash);
    await authorize(active.credential_hash, active.input, active.profile_ref, active.origin, active.package.package_ref, active.package.revision_ref);
    // Admission and enablement select bytes for a new Run. An in-flight Run
    // keeps those exact bytes when a newer revision is installed or the skill
    // is disabled. Authorization is still rechecked for every broker request.
    const script = active.sitePackage.script;
    if (!script || digest(script.source) !== script.sha256.slice("sha256:".length)) return fail("managed_skill_source_corrupt");
  }
  async function requireWorkerTicket(credentialHash: string, value: unknown): Promise<ActiveManagedSiteTicket> {
    const request = object(value, ["ticket_id"]);
    const ticketId = string(request.ticket_id, 128);
    const active = activeTickets.get(ticketId);
    if (!active || active.credential_hash !== credentialHash) return fail("managed_task_ticket_inactive");
    await options.accessStore.authenticateCredential(credentialHash);
    await revalidateWorkerTicket(active);
    return active;
  }
  async function workerStarted(credentialHash: string, value: unknown): Promise<JsonObject> {
    const active = await requireWorkerTicket(credentialHash, value);
    if (active.worker_started) return fail("managed_task_ticket_reused");
    active.worker_started = true;
    return { accepted: true };
  }
  async function workerBroker(credentialHash: string, value: unknown): Promise<JsonObject> {
    const request = object(value, ["ticket_id", "method", "input"]);
    const ticketId = string(request.ticket_id, 128);
    const active = activeTickets.get(ticketId);
    if (!active || active.credential_hash !== credentialHash || !active.worker_started) return fail("managed_task_ticket_inactive");
    try {
      await options.accessStore.authenticateCredential(credentialHash);
      await revalidateWorkerTicket(active);
      if (request.method === "runtime.invoke") {
        if (active.taskFacts.kind !== "page_snapshot") return fail("managed_site_capability_not_admitted");
        if (!options.managedBrowserService) return fail("managed_task_browser_unavailable");
        if (active.snapshot_started || !isObject(request.input) || Object.keys(request.input).length !== 2 ||
            request.input.operation_id !== "instance.snapshot" || request.input.action !== "read") return fail("managed_site_capability_not_admitted");
        active.snapshot_started = true;
        active.dispatched = true;
        const currentRun = await store.getRunRecord(active.run_id);
        if (!currentRun || currentRun.status !== "running") return fail("managed_task_ticket_inactive");
        await store.updateRunRecord(active.run_id, { public_result_summary: { ...currentRun.public_result_summary, dispatch_state: "dispatched" } });
        let receiptValue: unknown;
        try {
          const remainingMs = active.deadline_at - Date.now();
          if (remainingMs <= 0) return fail("managed_task_timeout");
          receiptValue = await options.managedBrowserService.executeTaskSnapshot(active.credential_hash, {
            idempotency_key: active.run_id, operation: "instance.snapshot", connection_id: active.input.connection_id,
            grant_id: active.input.grant_id, profile_ref: active.profile_ref, origin: active.origin, page_ref: active.target_ref,
            task_scope: { operations: ["instance.snapshot"], profile_refs: [active.profile_ref], origins: [active.origin] }
          }, active.run_id, remainingMs);
        } catch (error) {
          const code = error instanceof ManagedAccessError ? error.code : "managed_task_snapshot_unavailable";
          active.failure_code = code;
          const receipt = isObject(error) && isObject(error.receipt) ? error.receipt : {};
          if (receipt.status === "unknown_outcome" || receipt.dispatch_state === "possibly_dispatched") active.outcome_uncertain = true;
          if (receipt.dispatch_state === "not_dispatched") active.dispatched = false;
          throw error;
        }
        const receipt = isObject(receiptValue) ? receiptValue : {};
        const page = isObject(receipt.page) ? receipt.page : {};
        const snapshot = isObject(receipt.snapshot) ? receipt.snapshot : {};
        const coverage = isObject(snapshot.coverage) ? snapshot.coverage : {};
        const coverageText = isObject(coverage.text) ? coverage.text : {};
        const continuation = isObject(snapshot.continuation) ? snapshot.continuation : {};
        const currentUrl = typeof page.current_url === "string" ? page.current_url : undefined;
        let sameOrigin = false;
        try { sameOrigin = Boolean(currentUrl && new URL(currentUrl).origin === active.origin); } catch { /* invalid URL fails below */ }
        if (receipt.status !== "completed" || page.page_ref !== active.target_ref || snapshot.page_ref !== active.target_ref ||
            typeof page.title !== "string" || !page.title || typeof snapshot.text !== "string" || Buffer.byteLength(snapshot.text, "utf8") > 65_536 ||
            typeof snapshot.truncated !== "boolean" || typeof coverageText.state !== "string" || !sameOrigin ||
            typeof snapshot.observation_ref !== "string" || !snapshot.observation_ref ||
            continuation.has_more !== false) {
          active.failure_code = "site_task_snapshot_incomplete";
          return fail("managed_task_snapshot_incomplete");
        }
        const projected = {
          status: receipt.status,
          page: { current_url: currentUrl!, title: page.title, page_ref: page.page_ref },
          snapshot: { text: snapshot.text, truncated: snapshot.truncated, coverage: { text: { state: coverageText.state } },
            observation_ref: snapshot.observation_ref, page_ref: snapshot.page_ref }
        };
        active.snapshot = projected;
        return projected;
      }
      if (request.method === "network.read") {
        const policy = active.taskFacts.networkRead;
        if (active.taskFacts.kind !== "program_public_read" || !policy || active.network_started || active.snapshot_started) return fail("managed_site_capability_not_admitted");
        validateProgramPublicHttpCall(policy, request.input);
        active.network_started = true;
        const controller = new AbortController();
        active.network_controller = controller;
        let run = await store.getRunRecord(active.run_id);
        if (!run || run.status !== "running") return fail("managed_task_ticket_inactive");
        try {
          const result = await readProgramPublicHttp(policy, request.input, {
            async beforeDispatch(_url, hop) {
              await revalidateWorkerTicket(active);
              const current = await store.getRunRecord(active.run_id);
              if (!current || current.status !== "running") return fail("managed_task_ticket_inactive");
              const previousHttp = isObject(current.public_result_summary?.program_public_http) ? current.public_result_summary!.program_public_http as JsonObject : {};
              const previousHops = Array.isArray(previousHttp.request_hops) ? previousHttp.request_hops : [];
              if (previousHops.length !== hop.hop_index) return fail("managed_task_network_state_invalid");
              // Persist dispatch and a query-free path/hash before opening the socket. A restart can never replay this request.
              await store.updateRunRecord(active.run_id, { public_result_summary: {
                ...current.public_result_summary, dispatch_state: "dispatched",
                program_public_http: { ...previousHttp, request_hops: [...previousHops, hop] }
              } });
              active.dispatched = true;
            }
          }, controller.signal);
          let current: RunRecord | undefined;
          try { current = await store.getRunRecord(active.run_id); }
          catch {
            active.dispatched = true;
            active.outcome_uncertain = true;
            active.failure_code = "managed_task_network_evidence_unavailable";
            throw new ProgramPublicHttpError(active.failure_code, "dispatched", true);
          }
          if (!current || current.status !== "running") return fail("managed_task_ticket_inactive");
          const previousHttp = isObject(current.public_result_summary?.program_public_http) ? current.public_result_summary!.program_public_http as JsonObject : {};
          const persistedResponse = { response_ref: result.response_ref, ...result.facts };
          try {
            await store.updateRunRecord(active.run_id, { public_result_summary: {
              ...current.public_result_summary, program_public_http: { ...previousHttp, response: persistedResponse }
            } });
          } catch {
            active.dispatched = true;
            active.outcome_uncertain = true;
            active.failure_code = "managed_task_network_evidence_unavailable";
            throw new ProgramPublicHttpError(active.failure_code, "dispatched", true);
          }
          active.public_response = { response_ref: result.response_ref, facts: result.facts, url: result.url, status: result.status, content_type: result.content_type };
          return { ok: result.ok, status: result.status, url: result.url, body: result.body, response_ref: result.response_ref, content_type: result.content_type };
        } catch (error) {
          if (error instanceof ProgramPublicHttpError) {
            if (error.dispatch_state === "dispatched") active.dispatched = true;
            if (error.outcome_uncertain) active.outcome_uncertain = true;
            active.failure_code = error.code;
          } else if (!active.failure_code) active.failure_code = "managed_task_network_unavailable";
          throw error;
        } finally {
          if (active.network_controller === controller) active.network_controller = undefined;
        }
      }
      if (request.method === "output.write") {
        const pageTask = active.taskFacts.kind === "page_snapshot";
        const publicReadTask = active.taskFacts.kind === "program_public_read";
        if (active.output || (pageTask ? !active.snapshot : !active.public_response) || !isObject(request.input) || Buffer.byteLength(canonical(request.input), "utf8") > 1_048_576) return fail("managed_site_output_invalid");
        const output = request.input;
        const page = output.source_refs;
        const evidence = output.evidence_refs;
        const snapshot = active.snapshot && active.snapshot.snapshot as JsonObject | undefined;
        const pageValue = active.snapshot && active.snapshot.page as JsonObject | undefined;
        const responseRef = active.public_response?.response_ref;
        const pageRefsValid = pageTask && !!pageValue && !!snapshot && Array.isArray(page) && page.length === 1 && isObject(page[0]) &&
          page[0].ref_id === pageValue.page_ref && page[0].source_kind === "harbor_page" && Array.isArray(evidence) && evidence.length === 1 &&
          isObject(evidence[0]) && evidence[0].ref_id === snapshot.observation_ref && evidence[0].evidence_kind === "snapshot_ref" &&
          evidence[0].producer === "harbor" && evidence[0].redaction === "summary_only";
        const publicReadRefsValid = publicReadTask && typeof responseRef === "string" && Array.isArray(page) && page.length === 1 && isObject(page[0]) &&
          page[0].ref_id === responseRef && page[0].source_kind === "public_http_response" && Array.isArray(evidence) && evidence.length === 1 &&
          isObject(evidence[0]) && evidence[0].ref_id === responseRef && evidence[0].evidence_kind === "public_http_response" &&
          evidence[0].producer === "core" && evidence[0].redaction === "summary_only";
        if (!schemaValid(output, active.sitePackage.output_schema) || !(pageRefsValid || publicReadRefsValid)) {
          active.failure_code = "site_task_output_schema_invalid";
          return fail("managed_task_output_invalid");
        }
        const post = evaluatePostCheck(output, active.sitePackage.post_check, {
          sourceRef: publicReadRefsValid ? responseRef! : String(pageValue!.page_ref),
          evidenceRef: publicReadRefsValid ? responseRef! : String(snapshot!.observation_ref)
        });
        active.output = output;
        active.postCheck = post.postCheck;
        return { accepted: true };
      }
      return fail("managed_site_broker_method_forbidden");
    } catch (error) {
      if (!active.failure_code) active.failure_code = error instanceof ManagedAccessError ? error.code : "managed_task_runtime_unavailable";
      throw error;
    }
  }
  async function cancelWorkerTicket(runId: string): Promise<void> {
    const active = [...activeTickets.values()].find(item => item.run_id === runId);
    if (!active) return;
    deactivateWorkerTicket(active);
  }
  async function executeScriptTask(credentialHash: string, request: ParsedRequest, principalId: string, profileRef: string, origin: string,
      runId: string, deadlineAt: number, sitePackage: ActiveManagedSiteTicket["sitePackage"], taskFacts: ReturnType<typeof assertPinnedTask>, initialSummary: JsonObject, targetRef: string) {
    const script = sitePackage.script;
    const canRunScript = options.workerIdentity?.mode === "distinct_uid_hardened" &&
      Number.isSafeInteger(options.workerIdentity.owner_uid) && Number.isSafeInteger(options.workerIdentity.agent_uid) &&
      options.workerIdentity.owner_uid !== options.workerIdentity.agent_uid && options.workerIdentity.owner_socket_acl === "verified";
    if (!script || !canRunScript || !sitePackage.code_admission_ref) {
      const failed = await finishFailure(runId, "worker_identity_unavailable", "failed", "not_dispatched", {
        sourceRef: targetRef,
        failure: publicFailure("runtime_execution", "worker_identity_unavailable", "pre_admission", "retry_only_after_hardened_agent_worker_is_available")
      });
      return response(failed, request.operation);
    }
    const ticketId = randomUUID();
    const active: ActiveManagedSiteTicket = {
      ticket_id: ticketId, run_id: runId, credential_hash: credentialHash, input: request, principal_id: principalId,
      profile_ref: profileRef, origin, deadline_at: deadlineAt, package: request.package!, sitePackage, taskFacts,
      target_ref: targetRef, cancelled: false, dispatched: false, worker_started: false, snapshot_started: false, network_started: false, network_controller: undefined
    };
    activeTickets.set(ticketId, active);
    const ticket: JsonObject = {
      ticket_id: ticketId, run_id: runId,
      package: { package_ref: sitePackage.package_ref, revision_ref: sitePackage.revision_ref, package_digest: sitePackage.package_digest,
        task_ref: sitePackage.task_ref, source_ref: sitePackage.source_ref, lock_ref: sitePackage.lock_ref,
        capability_ref: sitePackage.capability.capability_ref, capability_version: sitePackage.capability.version,
        source_admission_ref: sitePackage.source_admission_ref, code_admission_ref: sitePackage.code_admission_ref },
      script: { script_ref: script.script_ref, script_version: script.version, script_sha256: script.sha256,
        runtime_kind: script.runtime_kind, entrypoint: script.entrypoint, broker: script.broker,
        broker_capabilities: script.broker_capabilities, source: script.source.toString("utf8") },
      authorization: { principal_id: principalId, connection_id: request.connection_id, grant_id: request.grant_id, profile_ref: profileRef, origin },
      ...(taskFacts.kind === "page_snapshot" ? { target: { target_type: taskFacts.targetType, target_ref: targetRef } } : {}),
      input: { schema_ref: taskFacts.inputSchemaRef, value: request.input?.carrier === "webenvoy.managed-task-inline/v1" ? request.input.value : {} },
      context: { run_id: runId, task_ref: sitePackage.task_ref }, deadline_at: deadlineAt
    };
    const current = await store.getRunRecord(runId);
    if (!current || current.status !== "running") {
      deactivateWorkerTicket(active);
      return current ? response(current, request.operation) : fail("managed_task_operation_unavailable");
    }
    active.timer = setTimeout(() => { void settleWorkerTimeout(active).catch(() => undefined); }, Math.max(0, deadlineAt - Date.now()));
    active.timer.unref?.();
    return { ...response(current, request.operation), worker_execution: { ticket } };
  }
  async function finalizeWorker(active: ActiveManagedSiteTicket): Promise<JsonObject> {
    const latest = await store.getRunRecord(active.run_id);
    if (!latest || terminalRunRecordStatuses.has(latest.status)) {
      deactivateWorkerTicket(active);
      return latest ? response(latest, "task.submit") : fail("managed_task_operation_unavailable");
    }
    const pageTask = active.taskFacts.kind === "page_snapshot";
    if ((pageTask ? !active.snapshot : !active.public_response) || !active.output || !active.postCheck) return fail("managed_site_output_missing");
    const evidenceRef = pageTask ? String((active.snapshot!.snapshot as JsonObject).observation_ref) : active.public_response!.response_ref;
    const sourceRef = pageTask ? active.target_ref : active.public_response!.response_ref;
    if (active.postCheck.status !== "passed") {
      const failed = await finishFailure(active.run_id, "site_task_post_check_failed", "failed", active.dispatched ? "dispatched" : "not_dispatched", {
        evidenceRef, sourceRef, postCheck: active.postCheck,
        failure: publicFailure("result_projection", "site_task_post_check_failed", "verification", "query_original_run_only")
      });
      deactivateWorkerTicket(active);
      return response(failed, "task.submit");
    }
    const completed = await completeRunWithResult(store, active.run_id, {
      result_ref: `managed-site-task-result:${active.run_id}`, result_kind: active.taskFacts.resultKind,
      output_schema_id: active.taskFacts.outputSchemaRef, data: active.output, source_refs: [sourceRef],
      evidence_refs: [evidenceRef], post_check: active.postCheck,
      persisted_public_summary: { ...latest.public_result_summary, dispatch_state: active.dispatched ? "dispatched" : "not_dispatched" },
      persist_result_envelope: true
    });
    deactivateWorkerTicket(active);
    return response(completed.run_record, "task.submit");
  }
  async function failWorker(active: ActiveManagedSiteTicket, code: string): Promise<JsonObject> {
    const latest = await store.getRunRecord(active.run_id);
    if (!latest || terminalRunRecordStatuses.has(latest.status)) {
      deactivateWorkerTicket(active);
      return latest ? response(latest, "task.submit") : fail("managed_task_operation_unavailable");
    }
    const failureCode = active.failure_code ?? code;
    const dispatchState = active.dispatched ? "dispatched" : "not_dispatched";
    const unknown = active.outcome_uncertain || active.taskFacts.kind === "page_snapshot" && active.dispatched && !active.snapshot;
    const status = unknown ? "unknown_outcome" : "failed";
    const failed = await finishFailure(active.run_id, failureCode, status, dispatchState, {
      ...(active.snapshot && isObject(active.snapshot.snapshot) && typeof active.snapshot.snapshot.observation_ref === "string"
        ? { evidenceRef: active.snapshot.snapshot.observation_ref } : active.public_response ? { evidenceRef: active.public_response.response_ref } : {}),
      sourceRef: active.public_response?.response_ref ?? active.target_ref, ...(active.postCheck === undefined ? {} : { postCheck: active.postCheck }),
      failure: publicFailure(unknown ? "write_outcome" : "runtime_execution", failureCode,
        unknown ? "reconciliation" : "execution", "query_original_run_only")
    });
    deactivateWorkerTicket(active);
    return response(failed, "task.submit");
  }
  async function workerComplete(credentialHash: string, value: unknown): Promise<JsonObject> {
    const active = await requireWorkerTicket(credentialHash, value);
    return finalizeWorker(active);
  }
  async function workerFailure(credentialHash: string, value: unknown): Promise<JsonObject> {
    const request = object(value, ["ticket_id", "code"]);
    const ticketId = string(request.ticket_id, 128);
    const active = activeTickets.get(ticketId);
    if (!active || active.credential_hash !== credentialHash || typeof request.code !== "string" ||
        !/^(?:managed_site_[a-z0-9_]+|managed_task_[a-z0-9_]+|managed_access_[a-z0-9_]+|worker_identity_unavailable|owner_socket_acl_unavailable)$/.test(request.code)) return fail("managed_task_ticket_inactive");
    await options.accessStore.authenticateCredential(credentialHash);
    return failWorker(active, request.code);
  }
  async function settleWorkerTimeout(active: ActiveManagedSiteTicket): Promise<void> {
    if (activeTickets.get(active.ticket_id) !== active) return;
    const run = await store.getRunRecord(active.run_id);
    if (!run || terminalRunRecordStatuses.has(run.status)) { deactivateWorkerTicket(active); return; }
    // Once output.write was accepted Core has the exact snapshot and validated
    // output. Finalize that known read result without another Harbor call.
    if (!active.cancelled && (active.snapshot || active.public_response) && active.output && active.postCheck) {
      await finalizeWorker(active);
      return;
    }
    await failWorker(active, "managed_task_timeout");
  }
  async function stopRun(input: ParsedRequest, principalId: string, run: RunRecord): Promise<RunRecord> {
    const stopKeyHash = digest(`${principalId}\0${input.idempotency_key!}`);
    const requestHash = digest(canonical({ operation: "task.stop", principal_id: principalId, grant_id: input.grant_id, run_id: run.run_id, task_scope: input.task_scope }));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stopKeyRunId = runId(principalId, input.idempotency_key!);
    return withFileOwnershipLock(join(directory, `${stopKeyRunId}.lock`), 5000, async () => {
      // A stop key is distinct from the original submit key and from every
      // other stop operation for this Principal.
      if (await store.getRunRecord(runId(principalId, input.idempotency_key!))) return fail("managed_access_idempotency_conflict");
      return withFileOwnershipLock(join(directory, `${run.run_id}.lock`), 5000, async () => {
        const current = await store.getRunRecord(run.run_id);
        if (!current || current.public_result_summary?.principal_id !== principalId || !summaryFacts(current)) return fail("managed_task_operation_unavailable");
        const records = await store.listRunRecords();
        for (const item of records) {
          const existing = item.public_result_summary?.stop_idempotency;
          if (!isObject(existing) || !Object.hasOwn(existing, stopKeyHash)) continue;
          if (item.run_id !== current.run_id || existing[stopKeyHash] !== requestHash) return fail("managed_access_idempotency_conflict");
          return current;
        }
        const previousKeys = isObject(current.public_result_summary?.stop_idempotency) ? current.public_result_summary!.stop_idempotency as JsonObject : {};
        const stopKeys = { ...previousKeys, [stopKeyHash]: requestHash };
        const summary = { ...current.public_result_summary, stop_idempotency: stopKeys };
        await cancelWorkerTicket(current.run_id);
        if (terminalRunRecordStatuses.has(current.status)) {
          return store.updateRunRecord(current.run_id, { public_result_summary: summary });
        }
        const failure = publicFailure("runtime_execution", "user_cancelled", "execution", "query_original_run_only");
        try {
          return (await completeRunWithFailure(store, current.run_id, {
            status: "cancelled", failure, persisted_public_summary: summary, persist_result_envelope: true
          })).run_record;
        } catch (error) {
          const latest = await store.getRunRecord(current.run_id);
          if (!latest || !terminalRunRecordStatuses.has(latest.status)) throw error;
          return store.updateRunRecord(latest.run_id, { public_result_summary: { ...latest.public_result_summary, stop_idempotency: stopKeys } });
        }
      });
    });
  }

  return {
    workerStarted,
    broker: workerBroker,
    workerComplete,
    workerFailure,
    async operate(credentialHash: string, rawHttpBody: unknown, executionContext: { agentSocketIngressVerified?: boolean } = {}) {
      const input = parseRequest(rawHttpBody);
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      if (input.operation !== "task.submit") {
        const run = await lookupRun(credentialHash, input, principal.principal_id);
        if (input.operation === "task.stop") return response(await stopRun(input, principal.principal_id, run), input.operation);
        return response(run, input.operation);
      }

      const request = input;
      const pkg = request.package!;
      const profileRef = request.task_scope.profile_refs[0]!;
      const origin = request.task_scope.origins[0]!;
      if (request.task_scope.skill_refs[0] !== pkg.package_ref || request.task_scope.source_refs[0] !== pkg.revision_ref) return fail("managed_access_denied");

      await authorize(credentialHash, request, profileRef, origin, pkg.package_ref, pkg.revision_ref);
      const runRef = runId(principal.principal_id, request.idempotency_key!);
      const deadlineAt = Date.now() + (request.intent!.policy.timeout_ms ?? 60_000);
      const requestForHash = { ...request, connection_id: undefined };
      const requestHash = digest(canonical(requestForHash));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const setup = await withFileOwnershipLock(join(directory, `${runRef}.lock`), 5000, async () => {
        const submitKeyHash = digest(`${principal.principal_id}\0${request.idempotency_key!}`);
        // Stop-key uniqueness is indexed by the existing original Run summaries.
        // This scan is intentionally bounded to the current Run store (O(history));
        // if that store gains archival/scale requirements, keep the index in that
        // same owner instead of adding a parallel task-operation registry.
        if ((await store.listRunRecords()).some(item => isObject(item.public_result_summary?.stop_idempotency) && Object.hasOwn(item.public_result_summary!.stop_idempotency as JsonObject, submitKeyHash))) {
          return fail("managed_access_idempotency_conflict");
        }
        const previous = await store.getRunRecord(runRef);
        if (previous) {
          const facts = summaryFacts(previous);
          if (!facts || facts.principal_id !== principal.principal_id || facts.request_hash !== requestHash) return fail("managed_access_idempotency_conflict");
          return { kind: "existing" as const, run: await recoverOrphanedScriptRun(previous) };
        }

        const sitePackage = await options.skillLibraryService.resolveManagedSiteTask(pkg);
        if (sitePackage.package_ref !== pkg.package_ref || sitePackage.revision_ref !== pkg.revision_ref ||
            sitePackage.package_digest !== pkg.package_digest || sitePackage.task_ref !== pkg.task_ref) return fail("managed_skill_revision_unavailable");
        const taskFacts = assertPinnedTask(sitePackage.task, sitePackage);
        const targetRef = taskFacts.kind === "page_snapshot" ? request.target?.target_ref : taskFacts.targetRef;
        const taskInputValue = request.input!.carrier === "webenvoy.managed-task-inline/v1" ? request.input!.value : {};
        if (origin !== taskFacts.origin || request.input!.schema_ref !== taskFacts.inputSchemaRef || request.input!.carrier !== taskFacts.inputCarrier ||
          request.input!.carrier === "webenvoy.managed-task-inline/v1" && Buffer.byteLength(canonical(taskInputValue), "utf8") > taskFacts.maxInputBytes || !schemaValid(taskInputValue, sitePackage.input_schema) ||
            taskFacts.kind === "page_snapshot" && (!request.target || request.target.target_type !== taskFacts.targetType) ||
            taskFacts.kind === "program_public_read" && request.target !== undefined || !targetRef) return fail("managed_access_denied");
        // A task's AccountSystem dependency is part of its admission inputs. Resolve
        // the enabled owner-local revision before the first durable Run write so
        // recovery and result queries retain the exact definition this Run used.
        const accountSystem = await resolveTaskAccountSystem(taskFacts.accountSystemRef);
        const taskIntentValue = {
          schema_version: "webenvoy.task-intent.v0", intent_id: `task-intent-${runRef}`, correlation_id: runRef, entrypoint: "api",
          user_intent: { summary: request.intent!.summary },
          capability: { ref: taskFacts.kind === "page_snapshot" ? pageTaskIntentCapabilityRef : sitePackage.capability.capability_ref,
            version: sitePackage.capability.version, source_ref: sitePackage.capability.source_ref, lock_ref: sitePackage.capability.lock_ref },
          input: { summary: request.input!.carrier === "none" ? "No inline input" : "Inline task parameters supplied; the value is not persisted." },
          scope: { target_type: taskFacts.targetType, target_ref: targetRef },
          policy: request.intent!.policy, resource_requirement_refs: [], evidence_policy_ref: taskFacts.checkRef
        };
        const taskIntent = validateTaskIntent(taskIntentValue);
        if (!isObject(taskIntent) || (taskIntent as JsonObject).schema_version !== "webenvoy.task-intent.v0" || typeof (taskIntent as JsonObject).intent_id !== "string") return fail("managed_task_task_intent_invalid");
        const taskIntentRef = String((taskIntent as JsonObject).intent_id);
        const inputSummary = { schema_ref: taskFacts.inputSchemaRef, carrier: request.input!.carrier,
          value_present: request.input!.carrier === "webenvoy.managed-task-inline/v1",
          ...(request.input!.carrier === "webenvoy.managed-task-inline/v1" ? { value_sha256: `sha256:${digest(canonical(request.input!.value))}` } : {}) };
        const capabilityRef = taskFacts.kind === "page_snapshot" ? pageTaskIntentCapabilityRef : sitePackage.capability.capability_ref;
        const initialSummary = {
          task_kind: "managed_site_task", principal_id: principal.principal_id, connection_id: request.connection_id, grant_id: request.grant_id,
          operation: "task.submit", request_hash: requestHash, package_ref: sitePackage.package_ref, revision_ref: sitePackage.revision_ref,
          package_digest: sitePackage.package_digest, task_ref: sitePackage.task_ref, source_ref: sitePackage.source_ref,
          capability_ref: capabilityRef, operation_id: taskFacts.operationId, profile_ref: profileRef, origin, target_type: taskFacts.targetType,
          target_ref: targetRef, input_schema_ref: taskFacts.inputSchemaRef, input_carrier: request.input!.carrier, input: inputSummary,
          task_intent: taskIntent, dispatch_state: "not_dispatched",
          ...(accountSystem === undefined ? {} : { account_system: accountSystem }),
          ...(sitePackage.script ? {
            script_execution: true, script_ref: sitePackage.script.script_ref, script_version: sitePackage.script.version,
            script_sha256: sitePackage.script.sha256, script_runtime_kind: sitePackage.script.runtime_kind,
            source_admission_ref: sitePackage.source_admission_ref, code_admission_ref: sitePackage.code_admission_ref
          } : {})
        };
        await store.createRunRecord({
          run_id: runRef, task_intent_ref: taskIntentRef, entrypoint_ref: "entrypoint:api", status: "admitted",
          capability_ref: capabilityRef, capability_version: sitePackage.capability.version,
          capability_source_ref: sitePackage.capability.source_ref, capability_lock_ref: sitePackage.capability.lock_ref,
          package_ref: sitePackage.package_ref, scope_target_ref: targetRef,
          admission: { decision: "accepted", action_risk: "read", resource_requirement_refs: [] }, public_result_summary: initialSummary
        });
        await store.updateRunRecord(runRef, { status: "running" });
        return { kind: "created" as const, sitePackage, taskFacts, targetRef, initialSummary };
      });
      if (setup.kind === "existing") return response(setup.run, request.operation);
      const { sitePackage, taskFacts, targetRef, initialSummary } = setup;
      if (sitePackage.script) {
        if (executionContext.agentSocketIngressVerified !== true) {
          const failed = await finishFailure(runRef, "managed_site_worker_host_unavailable", "failed", "not_dispatched", {
            sourceRef: targetRef,
            failure: publicFailure("runtime_execution", "managed_site_worker_host_unavailable", "pre_admission", "retry_only_through_verified_agent_socket")
          });
          return response(failed, request.operation);
        }
        return executeScriptTask(credentialHash, request, principal.principal_id, profileRef, origin,
          runRef, deadlineAt, sitePackage, taskFacts, initialSummary, targetRef);
      }

      let browserResult: unknown;
      try {
        if (!options.managedBrowserService) throw new ManagedAccessError("managed_task_browser_unavailable");
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) throw new ManagedAccessError("managed_task_timeout");
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          browserResult = await Promise.race([
            options.managedBrowserService.executeTaskSnapshot(credentialHash, {
            idempotency_key: runRef, operation: "instance.snapshot", connection_id: request.connection_id,
            grant_id: request.grant_id, profile_ref: profileRef, origin, page_ref: request.target!.target_ref,
            task_scope: { operations: ["instance.snapshot"], profile_refs: [profileRef], origins: [origin] }
            }, runRef, remainingMs),
            new Promise<never>((_, reject) => { timeoutTimer = setTimeout(() => reject(new ManagedAccessError("managed_task_timeout")), remainingMs); })
          ]);
        } finally {
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        }
      } catch (error) {
        const current = await store.getRunRecord(runRef);
        if (!current) throw error;
        if (terminalRunRecordStatuses.has(current.status)) return response(current, request.operation);
        const receipt = isObject(error) && isObject(error.receipt) ? error.receipt : undefined;
        const dispatchState = receipt?.dispatch_state === "dispatched" || current.public_result_summary?.dispatch_state === "dispatched" ? "dispatched" : "not_dispatched";
        const known = dispatchState === "not_dispatched" || receipt?.status === "unavailable";
        const code = error instanceof ManagedAccessError ? error.code : "managed_task_runtime_unavailable";
        const failed = await finishFailure(runRef, code, known ? "failed" : "unknown_outcome", dispatchState, {
          ...(typeof receipt?.snapshot === "object" && isObject(receipt.snapshot) && typeof receipt.snapshot.observation_ref === "string" ? { evidenceRef: receipt.snapshot.observation_ref } : {}),
          sourceRef: request.target!.target_ref
        });
        return response(failed, request.operation);
      }

      const currentAfterSnapshot = await store.getRunRecord(runRef);
      if (!currentAfterSnapshot) throw new Error(`run record not found: ${runRef}`);
      if (terminalRunRecordStatuses.has(currentAfterSnapshot.status)) return response(currentAfterSnapshot, request.operation);
      const receipt = isObject(browserResult) ? browserResult : {};
      const page = isObject(receipt.page) ? receipt.page : {};
      const snapshot = isObject(receipt.snapshot) ? receipt.snapshot : {};
      const observationRef = typeof snapshot.observation_ref === "string" ? snapshot.observation_ref : undefined;
      const currentUrl = typeof page.current_url === "string" ? page.current_url : undefined;
      let canonicalUrl: string | undefined;
      try {
        const url = currentUrl ? new URL(currentUrl) : undefined;
        if (url && url.origin === origin && !url.username && !url.password) canonicalUrl = url.href;
      } catch { /* the post-check below records a bounded failure */ }
      const actualTitle = typeof page.title === "string" ? page.title : undefined;
      const actualSummary = typeof snapshot.text === "string" ? snapshot.text : undefined;
      const coverage = isObject(snapshot.coverage) ? snapshot.coverage : {};
      const coverageText = isObject(coverage.text) ? coverage.text : {};
      const coverageControls = isObject(coverage.controls) ? coverage.controls : {};
      const coverageSemantics = isObject(coverage.semantics) ? coverage.semantics : {};
      const continuation = isObject(snapshot.continuation) ? snapshot.continuation : {};
      const optionalIdentityMatches = (left: unknown, right: unknown) => left === undefined || right === undefined || left === right;
      const pageIdentityMatches = page.page_ref === request.target!.target_ref && snapshot.page_ref === request.target!.target_ref &&
        optionalIdentityMatches(page.page_id, snapshot.page_id) && optionalIdentityMatches(page.document_generation, snapshot.document_generation);
      const completeSnapshot = receipt.status === "completed" && ["not_dispatched", "dispatched"].includes(String(receipt.dispatch_state)) && pageIdentityMatches &&
          canonicalUrl !== undefined && actualTitle !== undefined && actualTitle.length > 0 &&
          actualSummary !== undefined && actualSummary.length > 0 && snapshot.truncated === false && coverageText.state === "complete" &&
          coverageControls.complete === true && coverageSemantics.complete === true && continuation.has_more === false && typeof observationRef === "string" && observationRef.length > 0;
      const output: JsonObject = {
        result_kind: taskFacts.resultKind, status: "available",
        normalized: { canonical_url: canonicalUrl ?? "", title: actualTitle ?? "", summary: actualSummary ?? "" },
        source_refs: [{ ref_id: request.target!.target_ref, source_kind: "harbor_page" }],
        evidence_refs: [{ ref_id: observationRef ?? "snapshot:unavailable", evidence_kind: "snapshot_ref", producer: "harbor", redaction: "summary_only" }]
      };
      const evidenceRef = observationRef ?? `missing-snapshot-ref:${runRef}`;
      const outputSchemaValid = schemaValid(output, sitePackage.output_schema);
      const post = evaluatePostCheck(output, sitePackage.post_check, { sourceRef: request.target!.target_ref, evidenceRef });
      const passed = completeSnapshot && outputSchemaValid && post.passed;
      // A page snapshot is a read observation. Harbor reports not_dispatched.
      const dispatchState = receipt.dispatch_state === "dispatched" ? "dispatched" : "not_dispatched";
      if (!passed) {
        const code = !completeSnapshot ? "site_task_snapshot_incomplete" : !outputSchemaValid ? "site_task_output_schema_invalid" : "site_task_post_check_failed";
        const failedPost = completeSnapshot && outputSchemaValid ? post.postCheck : { ...post.postCheck, status: "failed" as const, summary: !completeSnapshot ? "Harbor snapshot was incomplete or did not match the selected current Page." : "Harbor snapshot did not satisfy the pinned task output schema.", code };
        const failed = await finishFailure(runRef, code, "failed", dispatchState, {
          ...(observationRef ? { evidenceRef: observationRef } : {}), sourceRef: request.target!.target_ref, postCheck: failedPost,
          failure: publicFailure("result_projection", code, "verification", "query_original_run_only")
        });
        return response(failed, request.operation);
      }
      try {
        const completed = await completeRunWithResult(store, runRef, {
          result_ref: `managed-site-task-result:${runRef}`, result_kind: taskFacts.resultKind, output_schema_id: taskFacts.outputSchemaRef,
          data: output, source_refs: [request.target!.target_ref], evidence_refs: [observationRef!], post_check: post.postCheck,
          persisted_public_summary: { ...initialSummary, dispatch_state: dispatchState }, persist_result_envelope: true
        });
        return response(completed.run_record, request.operation);
      } catch (error) {
        const latest = await store.getRunRecord(runRef);
        if (latest && terminalRunRecordStatuses.has(latest.status)) return response(latest, request.operation);
        throw error;
      }
    }
  };
}

export type ManagedTaskService = ReturnType<typeof createManagedTaskService>;
