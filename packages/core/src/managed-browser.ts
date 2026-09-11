import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, managedInteractionOperations, managedPageOperations, type FileManagedAccessStore, type ManagedAccessRequest } from "./managed-access.js";
import type { FileRunRecordStore, RunRecord } from "./run-record-store.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { matchHarborBusinessOperationOwner } from "./execution-policy-owner-proof.js";
import { normalizeExecutionPolicyMutation } from "./execution-policy-config.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";
import { ProfileRecoveryCoreError, type ManagedRecoveryService } from "./profile-recovery.js";

type ObjectValue = Record<string, unknown>;
type EnvironmentConfiguration = { timezone?: string; language?: string; viewport?: string };
type Request = ManagedAccessRequest & { idempotency_key: string; url?: string; runtime_session_ref?: string; observation_ref?: string; account_system_ref?: string; account_ref?: string;
  page_id?: string; page_ref?: string; document_generation?: number; cursor?: string; limit?: number; target_ref?: string; text?: string; key?: string; delta_y?: number; wait_for?: "page_changed" | "text" | "enabled"; timeout_ms?: number; configuration?: EnvironmentConfiguration; backup_ref?: string; operation_ref?: string };
const isInteraction = (operation: string) => (managedInteractionOperations as readonly string[]).includes(operation);
const isPageMutation = (operation: string) => (managedPageOperations as readonly string[]).includes(operation) && operation !== "page.list";
const isObservation = (operation: string) => ["instance.observe", "instance.read", "instance.snapshot", "instance.wait"].includes(operation);
const isInput = (operation: string) => ["instance.click", "instance.input", "instance.press", "instance.scroll"].includes(operation);
const isEnvironment = (operation: string) => ["environment.read", "environment.update"].includes(operation);
const isRecovery = (operation: string) => ["recovery.inspect", "recovery.request", "recovery.status"].includes(operation);
class InteractionFailure extends ManagedAccessError {
  constructor(readonly receipt: ObjectValue) { super(typeof receipt.failure_class === "string" ? receipt.failure_class : "managed_interaction_outcome_unknown"); }
}
class PageFailure extends ManagedAccessError {
  constructor(readonly receipt: ObjectValue) { super(typeof receipt.failure_class === "string" ? receipt.failure_class : "managed_page_outcome_unknown"); }
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (code: string): never => { throw new ManagedAccessError(code); };
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_browser_invalid_input");
  return value as ObjectValue;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return fail("managed_browser_invalid_input");
  return value;
}
function configuration(value: unknown): EnvironmentConfiguration {
  const input = object(value), fields = ["timezone", "language", "viewport"];
  if (!Object.keys(input).length || Object.keys(input).some(key => !fields.includes(key))) return fail("managed_browser_invalid_input");
  for (const key of fields) if (input[key] !== undefined) {
    const item = input[key];
    if (typeof item !== "string" || !item.length || item.length > 128 || /[\u0000-\u001f\u007f]/.test(item)) return fail("managed_browser_invalid_input");
  }
  return input as EnvironmentConfiguration;
}
function parse(value: unknown): Request {
  const input = object(value);
  const allowed = ["idempotency_key", "connection_id", "grant_id", "operation", "task_scope", "profile_ref", "origin", "template_ref", "url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_id", "page_ref", "document_generation", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "configuration", "backup_ref", "operation_ref"];
  if (Object.keys(input).some(key => !allowed.includes(key))) return fail("managed_browser_invalid_input");
  text(input.idempotency_key);
  if (input.configuration !== undefined && !isEnvironment(String(input.operation))) return fail("managed_browser_invalid_input");
  for (const key of ["url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_id", "page_ref", "cursor", "target_ref"]) if (input[key] !== undefined) text(input[key]);
  if (input.document_generation !== undefined && (typeof input.document_generation !== "number" || !Number.isSafeInteger(input.document_generation) || input.document_generation < 1)) return fail("managed_browser_invalid_input");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 64)) return fail("managed_browser_invalid_input");
  if (input.url !== undefined) {
    let url: URL;
    try { url = new URL(text(input.url)); } catch { return fail("managed_browser_invalid_input"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== input.origin || !["instance.start", "instance.navigate", "page.open", "page.navigate"].includes(String(input.operation))) return fail("managed_browser_invalid_input");
  }
  if (["instance.navigate", "instance.read", "instance.diagnostics", ...managedPageOperations, ...managedInteractionOperations].includes(String(input.operation))) {
    text(input.runtime_session_ref);
    if (["instance.navigate", "page.navigate", "page.open"].includes(String(input.operation))) text(input.url);
    if (input.operation === "instance.diagnostics" && input.url !== undefined) return fail("managed_browser_invalid_input");
  }
  if ((managedPageOperations as readonly string[]).includes(String(input.operation))) {
    const operation = String(input.operation);
    if (!["page.list", "page.open"].includes(operation) && input.page_id === undefined && input.page_ref === undefined) return fail("managed_browser_invalid_input");
    if (["page.open", "page.navigate"].includes(operation)) text(input.url);
    if (!["page.open", "page.navigate"].includes(operation) && input.url !== undefined) return fail("managed_browser_invalid_input");
    if (input.cursor !== undefined || input.limit !== undefined || input.document_generation !== undefined && operation === "page.list" ||
      input.observation_ref !== undefined || input.target_ref !== undefined || input.text !== undefined || input.key !== undefined || input.delta_y !== undefined || input.wait_for !== undefined || input.timeout_ms !== undefined || input.configuration !== undefined || input.account_ref !== undefined || input.account_system_ref !== undefined || input.template_ref !== undefined) return fail("managed_browser_invalid_input");
  } else if (isInteraction(String(input.operation))) {
    if (input.cursor !== undefined || input.limit !== undefined) return fail("managed_browser_invalid_input");
    const action = String(input.operation).slice("instance.".length);
    const fields: Record<string, string[]> = { snapshot: ["page_ref"], click: ["page_ref", "observation_ref", "target_ref"], input: ["page_ref", "observation_ref", "target_ref", "text"], press: ["page_ref", "observation_ref", "target_ref", "key"], scroll: ["page_ref", "observation_ref", "delta_y"], wait: ["page_ref", "observation_ref", "wait_for", "target_ref", "text", "timeout_ms"] };
    const all = ["page_ref", "observation_ref", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "account_ref", "account_system_ref", "url", "template_ref"];
    if (all.some(key => input[key] !== undefined && !fields[action]!.includes(key))) return fail("managed_browser_invalid_input");
    if (action !== "snapshot") { text(input.page_ref); text(input.observation_ref); }
    if (["click", "input", "press"].includes(action)) text(input.target_ref);
    if (action === "input" && (typeof input.text !== "string" || input.text.length > 512 || /[\u0000-\u001f\u007f]/.test(input.text))) return fail("managed_browser_invalid_input");
    if (action === "press" && !["Enter", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Space", "Backspace", "Delete", "Escape"].includes(String(input.key))) return fail("managed_browser_invalid_input");
    if (action === "scroll" && (!Number.isSafeInteger(input.delta_y) || Math.abs(Number(input.delta_y)) > 2000 || input.delta_y === 0)) return fail("managed_browser_invalid_input");
    if (action === "wait") {
      if (!["page_changed", "text", "enabled"].includes(String(input.wait_for))) return fail("managed_browser_invalid_input");
      if (input.timeout_ms !== undefined && (!Number.isSafeInteger(input.timeout_ms) || Number(input.timeout_ms) < 1 || Number(input.timeout_ms) > 10_000)) return fail("managed_browser_invalid_input");
      if (input.wait_for === "enabled") text(input.target_ref); else if (input.target_ref !== undefined) return fail("managed_browser_invalid_input");
      if (input.wait_for === "text") { if (text(input.text).length > 256) return fail("managed_browser_invalid_input"); } else if (input.text !== undefined) return fail("managed_browser_invalid_input");
    }
  } else if (input.operation === "instance.diagnostics") {
    if (["target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "observation_ref", "account_system_ref", "account_ref", "template_ref"].some(key => input[key] !== undefined)) return fail("managed_browser_invalid_input");
  } else if (isEnvironment(String(input.operation))) {
    if (["template_ref", "url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_ref", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].some(key => input[key] !== undefined)) return fail("managed_browser_invalid_input");
    if (input.operation === "environment.update") configuration(input.configuration);
    else if (input.configuration !== undefined) return fail("managed_browser_invalid_input");
  } else if (isRecovery(String(input.operation))) {
    if (input.origin !== undefined || input.url !== undefined || input.runtime_session_ref !== undefined || input.page_ref !== undefined || input.cursor !== undefined || input.limit !== undefined || input.target_ref !== undefined || input.text !== undefined || input.key !== undefined || input.delta_y !== undefined || input.wait_for !== undefined || input.timeout_ms !== undefined || input.configuration !== undefined) return fail("managed_browser_invalid_input");
    text(input.profile_ref);
    if (input.operation === "recovery.status") text(input.operation_ref);
    if (input.backup_ref !== undefined && input.operation !== "recovery.request") return fail("managed_browser_invalid_input");
    if (input.backup_ref !== undefined) text(input.backup_ref);
  } else if (!["instance.navigate", "instance.read"].includes(String(input.operation)) && (["page_id", "page_ref", "document_generation", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].some(key => input[key] !== undefined)) ||
    (input.operation !== "account.bind" && ["observation_ref", "account_system_ref", "account_ref"].some(key => input[key] !== undefined))) return fail("managed_browser_invalid_input");
  return input as Request;
}
function accessRequest(input: Request): ManagedAccessRequest {
  const { idempotency_key: _key, url: _url, runtime_session_ref: _session, observation_ref: _observation, account_system_ref: _system, account_ref: _account, page_id: _pageId, page_ref: _page, document_generation: _generation, cursor: _cursor, limit: _limit, target_ref: _target, text: _text, key: _press, delta_y: _scroll, wait_for: _wait, timeout_ms: _timeout, configuration: _configuration, backup_ref: _backup, operation_ref: _operation, ...access } = input;
  return access;
}
function publicProfile(value: unknown): ObjectValue {
  const profile = object(value), refs = object(profile.refs);
  return { profile_ref: text(refs.profile_ref), identity_environment_ref: text(profile.identity_environment_ref), site: profile.site,
    status: profile.status, account_bindings: profile.account_bindings ?? [], environment_summary: profile.environment_summary };
}
function publicSession(value: unknown): ObjectValue {
  const session = object(value);
  return Object.fromEntries(["runtime_session_ref", "profile_ref", "identity_environment_ref", "provider_id", "lifecycle_state", "control_owner", "control_lock", "current_page", "current_error", "availability"].filter(key => session[key] !== undefined).map(key => [key, session[key]]));
}
function response(run: RunRecord) {
  return { ok: run.status === "succeeded", run_id: run.run_id, status: run.status,
    ...(run.public_result_summary?.result === undefined ? {} : { result: run.public_result_summary.result }),
    ...(run.public_result_summary?.dispatch_state === undefined ? {} : { dispatch_state: run.public_result_summary.dispatch_state }),
    ...(run.public_result_summary?.reconciliation === undefined ? {} : { reconciliation: run.public_result_summary.reconciliation }),
    ...(run.failure === undefined ? {} : { failure: { code: run.failure.code } }) };
}

export function createManagedBrowserService(options: {
  accessStore: FileManagedAccessStore; runRecordStore: FileRunRecordStore;
  authorizationDecisionStore: FileAuthorizationDecisionStore; executionPolicyConfigStore: FileExecutionPolicyConfigStore;
  harborBaseUrl: string; supervisorToken: string; recoveryService?: ManagedRecoveryService;
}) {
  const store = options.runRecordStore;
  const directory = join(store.directory, "managed-operation-locks");
  async function harbor(path: string, body?: ObjectValue, receiptKind?: "interaction" | "page"): Promise<ObjectValue> {
    const result = await fetch(new URL(path, options.harborBaseUrl), { method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(70_000) });
    const value = object(await result.json());
    if (receiptKind !== undefined) {
      if (["completed", "unavailable", "unknown_outcome"].includes(String(value.status)) && ["not_dispatched", "dispatched"].includes(String(value.dispatch_state))) return value;
      throw new Error(`managed_${receiptKind}_receipt_unavailable`);
    }
    if (!result.ok || value.status === "unavailable" || value.status === "failed" || value.lifecycle_state === "failed") {
      const failure = value.failure && typeof value.failure === "object" ? object(value.failure) : {};
      const error = value.current_error && typeof value.current_error === "object" ? object(value.current_error) : {};
      return fail(typeof value.failure_class === "string" ? value.failure_class : typeof failure.code === "string" ? failure.code : typeof error.code === "string" ? error.code : "managed_browser_runtime_refused");
    }
    return value;
  }
  async function authorize(hash: string, input: Request, runId: string) {
    const access = await options.accessStore.checkAccess(hash, accessRequest(input));
    const catalog = await harbor("/runtime/managed-operation-catalog");
    const version = digest(JSON.stringify(catalog));
    const controlled = isInteraction(input.operation);
    const policyOperation = controlled ? isInput(input.operation) ? "controlled-page.interact" : "controlled-page.observe" : input.operation;
    const proof = matchHarborBusinessOperationOwner(catalog, policyOperation, {
      schema_version: "webenvoy.harbor-resource-match.v0", match_ref: `resource-match:${version.slice(0, 32)}`,
      match_version: `sha256:${digest(JSON.stringify({ catalog: version, profile_ref: input.profile_ref, origin: input.origin, policy: access.profile_policy }))}`,
      matched_requirement_refs: ["harbor://managed-profile", ...(controlled ? ["harbor://controlled-page"] : [])]
    });
    if (!proof) return fail("execution_policy_owner_declaration_invalid");
    const evaluation = evaluateExecutionPolicy({ caller: "agent", evaluated_at: new Date().toISOString(),
      action: { action_instance_ref: `managed-action:${runId}`, action_id: policyOperation,
        // The policy owner acts on a Profile. Its exact origin is checked by the
        // access intersection and bound above, including explicitly approved local origins.
        target: { target_ref: input.profile_ref ?? input.template_ref ?? input.grant_id, target_type: "managed_profile" } },
      owner_proof: proof, context: { skill_ref: "harbor:managed-browser" },
      policies: await options.executionPolicyConfigStore.resolveSources({ skill_ref: "harbor:managed-browser" }) });
    const decision = await options.authorizationDecisionStore.recordAuthorizationDecision({ idempotency_key: `managed-policy:${runId}`,
      subject: { scope: "environment", operation_ref: runId }, evaluation });
    if (evaluation.status !== "evaluated" || evaluation.next_step !== "execute") return fail("managed_browser_policy_refused");
    return { ...access, decision_ref: decision.decision_ref };
  }
  async function execute(hash: string, input: Request, runId: string): Promise<ObjectValue> {
    const access = await authorize(hash, input, runId);
    const check = () => options.accessStore.checkAccess(hash, accessRequest(input));
    await store.updateRunRecord(runId, { evidence_refs: [access.decision_ref] });
    const holder = access.principal.principal_id;
    if (isRecovery(input.operation)) {
      await check();
      if (!options.recoveryService) return fail("recovery_unavailable");
      try {
        const recovery = input.operation === "recovery.inspect"
          ? await options.recoveryService.inspect({ idempotency_key: input.idempotency_key, profile_ref: input.profile_ref })
          : input.operation === "recovery.request"
            ? await options.recoveryService.request({ idempotency_key: input.idempotency_key, profile_ref: input.profile_ref, ...(input.backup_ref === undefined ? {} : { backup_ref: input.backup_ref }) })
            : await options.recoveryService.status({ operation_ref: input.operation_ref! }, input.profile_ref);
        return { recovery, authorization_decision_ref: access.decision_ref };
      } catch (error) {
        if (error instanceof ProfileRecoveryCoreError) throw new ManagedAccessError(error.code);
        throw error;
      }
    }
    if (input.operation === "profile.create") {
      // Unknown creation blocks further quota consumption until the existing receipt is reconciled.
      const unresolved = (await store.listRunRecords()).some(run => run.run_id !== runId && run.public_result_summary?.grant_id === input.grant_id &&
        run.public_result_summary?.operation === "profile.create" && ["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.reconciliation !== "completed");
      if (unresolved) return fail("managed_browser_creation_reconciliation_required");
      const template = access.creation_template!;
      await check();
      const created = await harbor("/runtime/identity-environment-mutations", { operation: "create", idempotency_key: runId,
        identity_environment: { site: template.site, requested_provider_id: template.provider_id, language: template.language, timezone: template.timezone } });
      if (created.status !== "completed") return fail("managed_browser_creation_unknown");
      const profile = publicProfile(created.record);
      await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: input.grant_id, profile_ref: profile.profile_ref });
      return { profile, authorization_decision_ref: access.decision_ref };
    }
    const list = await harbor("/runtime/identity-environments");
    if (!Array.isArray(list.identity_environments)) return fail("managed_browser_runtime_invalid");
    const profiles = list.identity_environments.map(publicProfile);
    if (input.operation === "profile.list") return { profiles: profiles.filter(profile => access.grant.profile_refs.includes(text(profile.profile_ref))) };
    const profile = profiles.find(profile => profile.profile_ref === input.profile_ref);
    if (!profile) return fail("managed_browser_profile_not_found");
    if (input.operation === "profile.read") return { profile };
    const identity = encodeURIComponent(text(profile.identity_environment_ref));
    if (isEnvironment(input.operation)) await check();
    if (input.operation === "environment.read") return await harbor(`/runtime/identity-environments/${identity}/environment`);
    if (input.operation === "environment.update") return await harbor(`/runtime/identity-environments/${identity}/environment`, {
      idempotency_key: runId, configuration: input.configuration!
    });
    const active = await harbor(`/runtime/identity-environments/${identity}/session`);
    const activeSession = active.runtime_session === null ? undefined : object(active.runtime_session);
    let session = activeSession;
    if (input.operation === "instance.start" && !session) {
      await check();
      session = await harbor("/runtime/identity-environment-sessions", { identity_environment_ref: profile.identity_environment_ref,
        operation_scope: "profile_management", url: input.url ?? input.origin, reuse_existing: true,
        control_owner: "core_task", holder_ref: holder, headless: false, timeout_ms: 60_000 });
    }
    if (!session || session.profile_ref !== input.profile_ref) return fail("managed_browser_session_missing");
    if (input.runtime_session_ref !== undefined && session.runtime_session_ref !== input.runtime_session_ref) return fail("managed_browser_session_mismatch");
    let leaseSession: ObjectValue = session;
    const ref = encodeURIComponent(text(leaseSession.runtime_session_ref));
    const acquireControlLease = async () => {
      await check();
      const lease = object(leaseSession.control_lock);
      // A user-held Instance is never implicitly taken over by an Agent Page action.
      if (leaseSession.control_owner === "user" && lease.state === "held") return fail("control_lock_conflict");
      if (leaseSession.control_owner !== "core_task" || lease.state !== "held" || lease.holder_ref !== holder) {
        leaseSession = await harbor(`/runtime/sessions/${ref}/lock`, { control_owner: "core_task", holder_ref: holder });
        session = leaseSession;
      }
      const acquired = object(leaseSession.control_lock);
      if (leaseSession.control_owner !== "core_task" || acquired.state !== "held" || acquired.holder_ref !== holder) return fail("control_lock_conflict");
      return await check();
    };
    if ((managedPageOperations as readonly string[]).includes(input.operation)) {
      if (input.operation === "page.list") {
        const pageAccess = await check();
        return await harbor(`/runtime/sessions/${ref}/pages`, {
          operation: input.operation,
          authorized_origins: pageAccess.authorized_origins
        });
      }
      const pageAccess = await acquireControlLease();
      const run = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      const result = await harbor(`/runtime/sessions/${ref}/pages`, {
        operation: input.operation, holder_ref: holder, operation_ref: runId, idempotency_key: runId,
        ...(input.page_id ? { page_id: input.page_id } : {}), ...(input.page_ref ? { page_ref: input.page_ref } : {}),
        ...(input.document_generation ? { document_generation: input.document_generation } : {}), ...(input.url ? { url: input.url } : {}),
        authorized_origins: pageAccess.authorized_origins
      }, "page");
      if (result.status !== "completed") throw new PageFailure(result);
      return result;
    }
    if (input.operation === "instance.diagnostics") {
      // Network/console diagnostics are pure observation and must not acquire or refresh the input lease.
      await check();
      return await harbor(`/runtime/sessions/${ref}/diagnostics`, {
        origin: input.origin!, authorized_origins: access.authorized_origins, ...(input.page_ref ? { page_ref: input.page_ref } : {}),
        ...(input.document_generation ? { document_generation: input.document_generation } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.limit ? { limit: input.limit } : {})
      });
    }
    if (!isObservation(input.operation)) await acquireControlLease();
    else await check();
    if (input.operation === "instance.stop") return { session: publicSession(await harbor(`/runtime/sessions/${ref}/stop`, { control_owner: "core_task", holder_ref: holder })) };
    if (input.operation === "instance.handoff") return { session: publicSession(await harbor(`/runtime/sessions/${ref}/handoff`, { control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested", holder_ref: holder })) };
    if (isInteraction(input.operation)) {
      await check();
      const run = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      const result = await harbor(`/runtime/sessions/${ref}/interactions`, {
        holder_ref: holder, operation_ref: runId, expected_origin: input.origin, controlled_origin: input.origin,
        action: input.operation.slice("instance.".length),
        ...Object.fromEntries(["page_ref", "observation_ref", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].filter(key => input[key as keyof Request] !== undefined).map(key => [key, input[key as keyof Request]]))
      }, "interaction");
      if (result.status !== "completed") throw new InteractionFailure(result);
      return result;
    }
    if (input.operation === "instance.navigate" || input.operation === "instance.read") {
      await harbor(`/runtime/sessions/${ref}/observe`, { holder_ref: holder });
      await check();
      const result = await harbor(`/runtime/sessions/${ref}/${input.operation === "instance.navigate" ? "navigate" : "read"}`, {
        holder_ref: holder, expected_origin: input.origin, ...(input.page_id ? { page_id: input.page_id } : {}),
        ...(input.page_ref ? { page_ref: input.page_ref } : {}), ...(input.document_generation ? { document_generation: input.document_generation } : {}),
        ...(input.url ? { url: input.url } : {}) });
      return { session: publicSession(result.session), ...(result.text === undefined ? {} : { text: result.text, truncated: result.truncated }), observed_at: result.observed_at };
    }
    const observation = await harbor(`/runtime/sessions/${ref}/observe`, { holder_ref: holder });
    const page = object(observation.page);
    let observedOrigin: string;
    try { observedOrigin = new URL(text(page.current_url)).origin; } catch { return fail("managed_browser_observation_unknown"); }
    if (observedOrigin !== input.origin) return fail("managed_browser_observed_origin_denied");
    if (input.operation === "account.bind") {
      await check();
      const bound = await harbor(`/runtime/identity-environments/${identity}/account-bindings`, {
        observation_ref: text(input.observation_ref), account_system_ref: text(input.account_system_ref), account_ref: text(input.account_ref),
        idempotency_key: runId, holder_ref: holder });
      return { profile: publicProfile(bound), observation };
    }
    return { session: publicSession(session), observation };
  }
  return {
    async getManagementPolicy() {
      return await options.executionPolicyConfigStore.getInstalledSkillConfiguration("harbor:managed-browser") ?? null;
    },
    async putManagementPolicy(value: unknown) {
      // These are the categories declared by Harbor's managed operation catalog.
      const mutation = normalizeExecutionPolicyMutation(value, { allowed_categories: new Set(["read", "prepare", "commit"]) });
      return options.executionPolicyConfigStore.putInstalledSkillConfiguration("harbor:managed-browser", mutation);
    },
    async submit(credentialHash: string, value: unknown) {
      const input = parse(value);
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      const runId = `managed-${digest(`${principal.principal_id}:${input.idempotency_key}`)}`;
      const requestHash = digest(JSON.stringify(input));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return withFileOwnershipLock(join(directory, `${digest(input.operation === "profile.create" ? input.grant_id : input.profile_ref ?? runId)}.lock`), 5000, async () => {
        const previous = await store.getRunRecord(runId);
        if (previous) {
          if (previous.public_result_summary?.request_hash !== requestHash) return fail("managed_browser_idempotency_conflict");
          return response(previous);
        }
        await options.accessStore.checkAccess(credentialHash, accessRequest(input));
        const summary = { principal_id: principal.principal_id, grant_id: input.grant_id, operation: input.operation, request_hash: requestHash,
          ...(isInteraction(input.operation) || isEnvironment(input.operation) || isPageMutation(input.operation) ? {
            ...(isInteraction(input.operation) || isPageMutation(input.operation) ? { runtime_session_ref: input.runtime_session_ref } : {}),
            profile_ref: input.profile_ref, origin: input.origin,
            ...(isInteraction(input.operation) || isPageMutation(input.operation) ? { dispatch_state: "not_dispatched" } : {})
          } : {}) };
        await store.createRunRecord({ run_id: runId, task_intent_ref: `managed-intent:${runId}`, capability_ref: "harbor:managed-browser", status: "admitted",
          admission: { decision: "accepted", action_risk: (["profile.create", "account.bind", "environment.update"].includes(input.operation) || isInput(input.operation) || isPageMutation(input.operation)) ? "write" : "read" }, public_result_summary: summary });
        await store.updateRunRecord(runId, { status: "running" });
        try {
          const result = await execute(credentialHash, input, runId);
          await completeRunWithResult(store, runId, { result_ref: `managed-result:${runId}`, result_kind: "managed_browser_operation", data: result, persisted_public_summary: { ...summary, ...(isInteraction(input.operation) || isPageMutation(input.operation) ? { dispatch_state: result.dispatch_state } : {}), result } });
        } catch (error) {
          const current = (await store.getRunRecord(runId))!;
          const receipt = error instanceof InteractionFailure || error instanceof PageFailure ? error.receipt : undefined;
          const dispatchAware = isInteraction(input.operation) || isPageMutation(input.operation);
          const known = dispatchAware
            ? (receipt?.dispatch_state ?? current.public_result_summary?.dispatch_state) === "not_dispatched"
            : error instanceof ManagedAccessError && error.code !== "managed_browser_creation_unknown";
          if (dispatchAware) await store.updateRunRecord(runId, { public_result_summary: {
            ...current.public_result_summary, dispatch_state: known ? "not_dispatched" : "dispatched", ...(receipt ? { result: receipt } : {})
          } });
          await completeRunWithFailure(store, runId, { status: known ? "failed" : "unknown_outcome",
            failure: { category: "runtime_execution", code: error instanceof ManagedAccessError ? error.code : known ? "managed_browser_runtime_unavailable" : "managed_browser_outcome_unknown", phase: "execution", recovery_hint: "query_operation_without_replay" } });
        }
        return response((await store.getRunRecord(runId))!);
      });
    },
    async query(credentialHash: string, runId: string) {
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      const run = await store.getRunRecord(runId);
      if (!run || run.public_result_summary?.principal_id !== principal.principal_id) return fail("managed_browser_operation_not_found");
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.operation === "environment.update" && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const profileRef = typeof run.public_result_summary?.profile_ref === "string" ? run.public_result_summary.profile_ref : runId;
        return withFileOwnershipLock(join(directory, `${digest(text(profileRef))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            // A receipt lookup is read-only; never reissue the environment update.
            const receipt = await harbor(`/runtime/identity-environment-mutations/${encodeURIComponent(runId)}`);
            if (receipt.status === "completed" || receipt.status === "rejected" || receipt.status === "repair_required") {
              let environment: ObjectValue | undefined;
              if (receipt.status === "completed" && typeof receipt.identity_environment_ref === "string") {
                try {
                  environment = await harbor(`/runtime/identity-environments/${encodeURIComponent(text(receipt.identity_environment_ref))}/environment`);
                } catch { /* The persisted receipt remains the authoritative recovery fact. */ }
              }
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result: { receipt, ...(environment === undefined ? {} : { environment }) } } });
            }
          } catch { /* Missing Runtime receipt never proves the original update did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && isInteraction(String(run.public_result_summary?.operation)) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.profile_ref))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            const receipt = await harbor(`/runtime/managed-interactions/${encodeURIComponent(runId)}`, undefined, "interaction");
            if (receipt.operation_ref !== runId || receipt.runtime_session_ref !== current.public_result_summary?.runtime_session_ref) throw new Error("receipt_mismatch");
            await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: receipt,
              ...(receipt.status === "completed" ? { reconciliation: "completed" } : receipt.dispatch_state === "not_dispatched" ? { reconciliation: "not_dispatched" } : {}) } });
          } catch { /* Missing Runtime receipt never proves the original input did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && isPageMutation(String(run.public_result_summary?.operation)) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.profile_ref))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            // The Runtime receipt is a read-only lookup of the original operation.
            const receipt = await harbor(`/runtime/managed-pages/${encodeURIComponent(runId)}`, undefined, "page");
            if (receipt.operation_ref !== runId || receipt.runtime_session_ref !== current.public_result_summary?.runtime_session_ref) throw new Error("receipt_mismatch");
            await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: receipt,
              ...(receipt.status === "completed" ? { reconciliation: "completed" } : receipt.dispatch_state === "not_dispatched" ? { reconciliation: "not_dispatched" } : {}) } });
          } catch { /* Missing Runtime receipt never proves the original Page action did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.operation === "profile.create" && run.public_result_summary.reconciliation !== "completed") {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.grant_id))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation === "completed") return response(current);
          if (current.status === "running" || current.status === "admitted") await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          // A read-only receipt lookup never reissues the original creation.
          const receipt = await harbor(`/runtime/identity-environment-mutations/${encodeURIComponent(runId)}`);
          if (receipt.status === "completed") {
            const profile = publicProfile(receipt.record);
            await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: run.public_result_summary!.grant_id, profile_ref: profile.profile_ref });
            await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, reconciliation: "completed", result: { profile } } });
          }
          return response((await store.getRunRecord(runId))!);
        });
      }
      return response(run);
    }
  };
}
