import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, type FileManagedAccessStore, type ManagedAccessRequest } from "./managed-access.js";
import type { FileRunRecordStore, RunRecord } from "./run-record-store.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { matchHarborBusinessOperationOwner } from "./execution-policy-owner-proof.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";

type ObjectValue = Record<string, unknown>;
type Request = ManagedAccessRequest & { idempotency_key: string; url?: string; observation_ref?: string; account_system_ref?: string; account_ref?: string };
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
function parse(value: unknown): Request {
  const input = object(value);
  const allowed = ["idempotency_key", "connection_id", "grant_id", "operation", "task_scope", "profile_ref", "origin", "template_ref", "url", "observation_ref", "account_system_ref", "account_ref"];
  if (Object.keys(input).some(key => !allowed.includes(key))) return fail("managed_browser_invalid_input");
  text(input.idempotency_key);
  for (const key of ["url", "observation_ref", "account_system_ref", "account_ref"]) if (input[key] !== undefined) text(input[key]);
  if (input.url !== undefined) {
    let url: URL;
    try { url = new URL(text(input.url)); } catch { return fail("managed_browser_invalid_input"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.origin !== input.origin || input.operation !== "instance.start") return fail("managed_browser_invalid_input");
  }
  if (input.operation !== "account.bind" && ["observation_ref", "account_system_ref", "account_ref"].some(key => input[key] !== undefined)) return fail("managed_browser_invalid_input");
  return input as Request;
}
function accessRequest(input: Request): ManagedAccessRequest {
  const { idempotency_key: _key, url: _url, observation_ref: _observation, account_system_ref: _system, account_ref: _account, ...access } = input;
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
    ...(run.failure === undefined ? {} : { failure: { code: run.failure.code } }) };
}

export function createManagedBrowserService(options: {
  accessStore: FileManagedAccessStore; runRecordStore: FileRunRecordStore;
  authorizationDecisionStore: FileAuthorizationDecisionStore; executionPolicyConfigStore: FileExecutionPolicyConfigStore;
  harborBaseUrl: string; supervisorToken: string;
}) {
  const store = options.runRecordStore;
  const directory = join(store.directory, "managed-operation-locks");
  async function harbor(path: string, body?: ObjectValue): Promise<ObjectValue> {
    const result = await fetch(new URL(path, options.harborBaseUrl), { method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
    const value = object(await result.json());
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
    const proof = matchHarborBusinessOperationOwner(catalog, input.operation, {
      schema_version: "webenvoy.harbor-resource-match.v0", match_ref: `resource-match:${version.slice(0, 32)}`,
      match_version: `sha256:${version}`, matched_requirement_refs: ["harbor://managed-profile"]
    });
    if (!proof) return fail("execution_policy_owner_declaration_invalid");
    const evaluation = evaluateExecutionPolicy({ caller: "agent", evaluated_at: new Date().toISOString(),
      action: { action_instance_ref: `managed-action:${runId}`, action_id: input.operation,
        target: { target_ref: input.profile_ref ?? input.template_ref ?? input.grant_id, target_type: "managed_profile", ...(input.origin ? { origin: input.origin } : {}) } },
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
    const active = await harbor(`/runtime/identity-environments/${identity}/session`);
    let session = active.runtime_session === null ? undefined : object(active.runtime_session);
    if (input.operation === "instance.start" && !session) {
      await check();
      session = await harbor("/runtime/identity-environment-sessions", { identity_environment_ref: profile.identity_environment_ref,
        operation_scope: "profile_management", url: input.url ?? input.origin, reuse_existing: true,
        control_owner: "core_task", holder_ref: holder, headless: false });
    }
    if (!session || session.profile_ref !== input.profile_ref) return fail("managed_browser_session_missing");
    const ref = encodeURIComponent(text(session.runtime_session_ref));
    await check();
    const lease = object(session.control_lock);
    if (session.control_owner !== "core_task" || lease.state !== "held" || lease.holder_ref !== holder) {
      session = await harbor(`/runtime/sessions/${ref}/lock`, { control_owner: "core_task", holder_ref: holder });
    }
    await check();
    if (input.operation === "instance.stop") return { session: publicSession(await harbor(`/runtime/sessions/${ref}/stop`, { control_owner: "core_task", holder_ref: holder })) };
    if (input.operation === "instance.handoff") return { session: publicSession(await harbor(`/runtime/sessions/${ref}/handoff`, { control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested", holder_ref: holder })) };
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
        const summary = { principal_id: principal.principal_id, grant_id: input.grant_id, operation: input.operation, request_hash: requestHash };
        await store.createRunRecord({ run_id: runId, task_intent_ref: `managed-intent:${runId}`, capability_ref: "harbor:managed-browser", status: "admitted",
          admission: { decision: "accepted", action_risk: ["profile.create", "account.bind"].includes(input.operation) ? "write" : "read" }, public_result_summary: summary });
        await store.updateRunRecord(runId, { status: "running" });
        try {
          const result = await execute(credentialHash, input, runId);
          await completeRunWithResult(store, runId, { result_ref: `managed-result:${runId}`, result_kind: "managed_browser_operation", data: result, persisted_public_summary: { ...summary, result } });
        } catch (error) {
          const known = error instanceof ManagedAccessError && error.code !== "managed_browser_creation_unknown";
          await completeRunWithFailure(store, runId, { status: known ? "failed" : "unknown_outcome",
            failure: { category: "runtime_execution", code: known ? error.code : "managed_browser_outcome_unknown", phase: "execution", recovery_hint: "query_operation_without_replay" } });
        }
        return response((await store.getRunRecord(runId))!);
      });
    },
    async query(credentialHash: string, runId: string) {
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      const run = await store.getRunRecord(runId);
      if (!run || run.public_result_summary?.principal_id !== principal.principal_id) return fail("managed_browser_operation_not_found");
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
