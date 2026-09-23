import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, type FileManagedAccessStore, type ManagedOperation, type ManagedTaskOperation, type ManagedTaskScope } from "./managed-access.js";
import type { createManagedBrowserService } from "./managed-browser.js";
import type { createFileSkillLibraryService } from "./skill-library.js";
import { approvedManagedSiteTaskPackage } from "./site-skill-package.js";
import { terminalRunRecordStatuses, type FailureRecord, type FileRunRecordStore, type PostCheckResult, type RunRecord } from "./run-record-store.js";
import { completeRunWithFailure, completeRunWithResult, type ResultEnvelope } from "./result-envelope.js";
import { validateTaskIntent } from "./task-submission.js";
import { isValidRunId } from "./run-id.js";
import { normalizePublicOrigin, normalizeStoredTargetRef } from "./public-target-reference.js";

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
  input?: { schema_ref: string; carrier: "none"; value?: unknown };
  intent?: { summary: string; policy: { risk: string; execution_intent: string; timeout_ms?: number } };
  selector?: { run_id?: string; original_idempotency_key?: string };
};

const responseSchemaVersion = "webenvoy.managed-task-operation-result/v1" as const;
const taskIntentCapabilityRef = "lode:capability/managed-page-snapshot";
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
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
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
  const input = object(value, [...required, ...(operation === "task.submit" ? ["idempotency_key", "package", "target", "input", "intent"] : operation === "task.query" ? ["selector"] : ["idempotency_key", "selector"])], required.concat(optionalByOperation[operation]));
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
    const target = object(input.target, ["target_type", "target_ref"]);
    const target_ref = string(target.target_ref, 2048);
    if (target_ref.includes("://") || normalizeStoredTargetRef(target_ref) !== target_ref) return fail("managed_task_invalid_input");
    parsed.target = { target_type: string(target.target_type), target_ref };
    const taskInput = object(input.input, ["schema_ref", "carrier"], ["value"]);
    if (taskInput.carrier !== "none" || Object.hasOwn(taskInput, "value")) return fail("managed_task_invalid_input");
    parsed.input = { schema_ref: string(taskInput.schema_ref), carrier: "none" };
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
function assertPinnedTask(task: JsonObject, sitePackage: Awaited<ReturnType<ReturnType<typeof createFileSkillLibraryService>["resolveManagedSiteTask"]>>): { origin: string; inputSchemaRef: string; outputSchemaRef: string; resultKind: string; checkRef: string } {
  const applicability = isObject(task.applicability) ? task.applicability : {};
  const inputs = isObject(task.inputs) ? task.inputs : {};
  const outputs = isObject(task.outputs) ? task.outputs : {};
  const verification = isObject(task.verification) ? task.verification : {};
  const origins = applicability.origins;
  const origin = Array.isArray(origins) && origins.length === 1 && typeof origins[0] === "string" ? origins[0] : undefined;
  if (task.task_ref !== sitePackage.task_ref || task.operation_id !== "instance.snapshot" || task.action !== "read" ||
      applicability.target_type !== taskTargetType || !origin || inputs.carrier !== "none" || inputs.max_bytes !== 0 ||
      outputs.completeness !== "required" || typeof outputs.result_kind !== "string" || typeof inputs.schema_ref !== "string" ||
      typeof outputs.schema_ref !== "string" || typeof verification.post_check_ref !== "string" ||
      sitePackage.capability.operation_id !== "instance.snapshot" || sitePackage.capability.action !== "read") return fail("managed_skill_source_corrupt");
  return { origin, inputSchemaRef: inputs.schema_ref, outputSchemaRef: outputs.schema_ref, resultKind: outputs.result_kind, checkRef: verification.post_check_ref };
}
function schemaValid(value: unknown, schemaValue: unknown): boolean {
  if (!isObject(schemaValue)) return false;
  const schema = schemaValue;
  if (Object.hasOwn(schema, "const") && canonical(value) !== canonical(schema.const)) return false;
  if (schema.type === "object") {
    if (!isObject(value)) return false;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (required.some(key => typeof key !== "string" || !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) return false;
    return Object.entries(value).every(([key, item]) => properties[key] === undefined || schemaValid(item, properties[key]));
  }
  if (schema.type === "array") return Array.isArray(value) && isObject(schema.items) && value.every(item => schemaValid(item, schema.items));
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "integer") return Number.isSafeInteger(value);
  return Object.hasOwn(schema, "const") && schema.type === undefined;
}
function normalizedField(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.trim() === value; }
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
    for (const field of requiredFields) if (typeof field !== "string" || !normalizedField(normalized[field])) passed = false;
    const expected = isObject(requirement.expected_normalized_fields) ? requirement.expected_normalized_fields : {};
    for (const [field, expectation] of Object.entries(expected)) {
      if (typeof expectation === "string") {
        if (normalized[field] !== expectation) passed = false;
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
function summaryFacts(run: RunRecord): { package_ref: string; revision_ref: string; profile_ref: string; origin: string; source_ref: string; task_ref: string; package_digest: string; input_schema_ref: string; input_carrier: "none"; principal_id: string; grant_id: string; request_hash: string; target_ref: string; target_type: string } | undefined {
  const summary = run.public_result_summary;
  if (!summary || summary.task_kind !== "managed_site_task" ||
      typeof summary.package_ref !== "string" || typeof summary.revision_ref !== "string" || typeof summary.profile_ref !== "string" ||
      typeof summary.origin !== "string" || typeof summary.source_ref !== "string" || typeof summary.task_ref !== "string" ||
      typeof summary.package_digest !== "string" || typeof summary.input_schema_ref !== "string" || summary.input_carrier !== "none" ||
      typeof summary.principal_id !== "string" || typeof summary.grant_id !== "string" || typeof summary.request_hash !== "string" ||
      typeof summary.target_ref !== "string" || typeof summary.target_type !== "string") return undefined;
  return summary as ReturnType<typeof summaryFacts> extends infer T ? Exclude<T, undefined> : never;
}
function response(run: RunRecord, operation: ManagedTaskOperation, operationRef = run.run_id, failureOverride?: JsonObject | null) {
  const summary = run.public_result_summary;
  const input = isObject(summary?.input) ? summary.input : {};
  return {
    ok: true as const,
    schema_version: responseSchemaVersion,
    operation,
    operation_ref: operationRef,
    run: { run_id: run.run_id, task_intent_ref: run.task_intent_ref, package_ref: run.package_ref ?? "", status: run.status,
      dispatch_state: summary?.dispatch_state === "dispatched" ? "dispatched" as const : "not_dispatched" as const },
    input: { schema_ref: typeof input.schema_ref === "string" ? input.schema_ref : "unavailable", carrier: "none" as const, value_present: false as const },
    result: isObject(summary?.result) ? summary.result as unknown as ResultEnvelope : null,
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
  managedBrowserService: Pick<ReturnType<typeof createManagedBrowserService>, "executeTaskSnapshot">;
}) {
  const store = options.runRecordStore;
  const directory = join(store.directory, "managed-task-operation-locks");

  async function authorize(credentialHash: string, input: ParsedRequest, profileRef: string, origin: string, packageRef: string, revisionRef: string) {
    return options.accessStore.checkAccess(credentialHash, accessRequest(input, profileRef, origin, packageRef, revisionRef));
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
    const run = await store.getRunRecord(selectedRunId);
    if (!run || run.public_result_summary?.principal_id !== principalId || !summaryFacts(run)) return fail("managed_task_operation_unavailable");
    const facts = summaryFacts(run)!;
    assertScopeMatches(input, { package_ref: facts.package_ref, revision_ref: facts.revision_ref, profile_ref: facts.profile_ref, origin: facts.origin });
    await authorize(credentialHash, input, facts.profile_ref, facts.origin, facts.package_ref, facts.revision_ref);
    return run;
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
    async operate(credentialHash: string, rawHttpBody: unknown) {
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
      if (pkg.package_ref !== approvedManagedSiteTaskPackage.package_ref || pkg.revision_ref !== approvedManagedSiteTaskPackage.revision_ref ||
          pkg.package_digest !== approvedManagedSiteTaskPackage.package_digest || pkg.task_ref !== approvedManagedSiteTaskPackage.task_ref ||
          request.task_scope.skill_refs[0] !== pkg.package_ref || request.task_scope.source_refs[0] !== pkg.revision_ref ||
          request.target!.target_type !== taskTargetType) return fail("managed_access_denied");

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
          return { kind: "existing" as const, run: previous };
        }

        const sitePackage = await options.skillLibraryService.resolveManagedSiteTask(pkg);
        const taskFacts = assertPinnedTask(sitePackage.task, sitePackage);
        if (origin !== taskFacts.origin || request.input!.schema_ref !== taskFacts.inputSchemaRef || request.target!.target_type !== String((sitePackage.task.applicability as JsonObject).target_type)) return fail("managed_access_denied");
        const taskIntentValue = {
          schema_version: "webenvoy.task-intent.v0", intent_id: `task-intent-${runRef}`, correlation_id: runRef, entrypoint: "api",
          user_intent: { summary: request.intent!.summary },
          capability: { ref: taskIntentCapabilityRef, version: sitePackage.capability.version, source_ref: sitePackage.capability.source_ref, lock_ref: sitePackage.capability.lock_ref },
          input: { summary: "No inline input" }, scope: { target_type: request.target!.target_type, target_ref: request.target!.target_ref },
          policy: request.intent!.policy, resource_requirement_refs: [], evidence_policy_ref: taskFacts.checkRef
        };
        const taskIntent = validateTaskIntent(taskIntentValue);
        if (!isObject(taskIntent) || (taskIntent as JsonObject).schema_version !== "webenvoy.task-intent.v0" || typeof (taskIntent as JsonObject).intent_id !== "string") return fail("managed_task_task_intent_invalid");
        const taskIntentRef = String((taskIntent as JsonObject).intent_id);
        const inputSummary = { schema_ref: taskFacts.inputSchemaRef, carrier: "none", value_present: false };
        const initialSummary = {
          task_kind: "managed_site_task", principal_id: principal.principal_id, connection_id: request.connection_id, grant_id: request.grant_id,
          operation: "task.submit", request_hash: requestHash, package_ref: sitePackage.package_ref, revision_ref: sitePackage.revision_ref,
          package_digest: sitePackage.package_digest, task_ref: sitePackage.task_ref, source_ref: sitePackage.source_ref,
          capability_ref: taskIntentCapabilityRef, profile_ref: profileRef, origin, target_type: request.target!.target_type,
          target_ref: request.target!.target_ref, input_schema_ref: taskFacts.inputSchemaRef, input_carrier: "none", input: inputSummary,
          task_intent: taskIntent, dispatch_state: "not_dispatched"
        };
        await store.createRunRecord({
          run_id: runRef, task_intent_ref: taskIntentRef, entrypoint_ref: "entrypoint:api", status: "admitted",
          capability_ref: taskIntentCapabilityRef, capability_version: sitePackage.capability.version,
          capability_source_ref: sitePackage.capability.source_ref, capability_lock_ref: sitePackage.capability.lock_ref,
          package_ref: sitePackage.package_ref, scope_target_ref: request.target!.target_ref,
          admission: { decision: "accepted", action_risk: "read", resource_requirement_refs: [] }, public_result_summary: initialSummary
        });
        await store.updateRunRecord(runRef, { status: "running" });
        return { kind: "created" as const, sitePackage, taskFacts, initialSummary };
      });
      if (setup.kind === "existing") return response(setup.run, request.operation);
      const { sitePackage, taskFacts, initialSummary } = setup;

      let browserResult: unknown;
      try {
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
