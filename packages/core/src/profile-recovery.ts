import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import type { FileRunRecordStore, RunRecord } from "./run-record-store.js";

export const CORE_PROFILE_RECOVERY_SCHEMA = "webenvoy.profile-recovery-core.v1";
export type RecoveryResult = { ok: boolean; operation_ref: string; status: string; run_id: string; reconciliation?: string; result?: Record<string, unknown>; failure?: { code: string; recovery_hint: string } };
export class ProfileRecoveryCoreError extends Error { constructor(readonly code: string, readonly recovery_hint = "inspect_operation_and_request_new_plan") { super(code); } }

type ObjectValue = Record<string, unknown>;
type Plan = ObjectValue & { schema_version: "webenvoy.profile-recovery-plan.v1"; plan_ref: string; profile_ref: string; backup_ref: string; backup_time: string; created_at: string; expires_at: string };
type Confirmation = ObjectValue & { schema_version: "webenvoy.profile-recovery-confirmation.v1"; confirmation_ref: string; plan_ref: string; confirmed_at: string; confirmed_by: "owner"; idempotency_key: string; decision: "apply" };

function fail(code: string, hint?: string): never { throw new ProfileRecoveryCoreError(code, hint); }
function object(value: unknown): ObjectValue { if (!value || typeof value !== "object" || Array.isArray(value)) return fail("recovery_input_invalid"); return value as ObjectValue; }
function text(value: unknown, max = 512): string { if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail("recovery_input_invalid"); return value; }
function ref(value: unknown): string { const result = text(value); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(result)) return fail("recovery_ref_invalid"); return result; }
function key(value: unknown): string { return text(value, 512); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as ObjectValue).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function operationRef(kind: string, idempotencyKey: string): string { return `recovery:${hash(`${kind}:${idempotencyKey}`).slice(0, 64)}`; }
function runId(operation: string): string { return `managed-recovery-${hash(operation).slice(0, 64)}`; }
function failure(error: unknown): { code: string; recovery_hint: string } { return error instanceof ProfileRecoveryCoreError ? { code: error.code, recovery_hint: error.recovery_hint } : { code: "recovery_runtime_unavailable", recovery_hint: "query_operation_without_replay" }; }
function response(run: RunRecord): RecoveryResult {
  return { ok: run.status === "succeeded", operation_ref: String(run.public_result_summary?.operation_ref ?? run.run_id), status: String(run.public_result_summary?.recovery_status ?? run.status), run_id: run.run_id,
    ...(typeof run.public_result_summary?.reconciliation === "string" ? { reconciliation: run.public_result_summary.reconciliation } : {}),
    ...(run.public_result_summary?.result && typeof run.public_result_summary.result === "object" ? { result: run.public_result_summary.result as ObjectValue } : {}),
    ...(run.failure && run.status !== "succeeded" ? { failure: { code: run.failure.code, recovery_hint: run.failure.recovery_hint } } : {}) };
}
function normalizeInspect(value: unknown): ObjectValue { const input = object(value); if (input.schema_version !== "harbor-profile-recovery/v1") return fail("recovery_contract_invalid"); return input; }
function normalizeBackup(value: unknown): ObjectValue { const input = object(value); if (input.schema_version !== "harbor.profile-recovery-operation.v1") return fail("recovery_contract_invalid"); return input; }
function expiresAt(minutes = 15): string { return new Date(Date.now() + minutes * 60_000).toISOString(); }

export type ManagedRecoveryService = ReturnType<typeof createManagedRecoveryService>;

export function createManagedRecoveryService(options: { runRecordStore: FileRunRecordStore; harborBaseUrl: string; supervisorToken: string }) {
  const store = options.runRecordStore;
  const directory = join(store.directory, "managed-recovery-locks");
  const operationLock = (operation: string) => join(directory, `${hash(operation)}.lock`);
  async function harbor(path: string, body?: ObjectValue): Promise<ObjectValue> {
    const response = await fetch(new URL(path, options.harborBaseUrl), {
      method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(70_000)
    });
    let value: ObjectValue;
    try { value = object(await response.json()); } catch { throw new ProfileRecoveryCoreError("recovery_runtime_invalid", "inspect_runtime_and_retry"); }
    if (!response.ok && value.schema_version !== "harbor.profile-recovery-operation.v1") {
      const detail = value.failure && typeof value.failure === "object" ? object(value.failure) : value;
      throw new ProfileRecoveryCoreError(typeof detail.code === "string" ? detail.code : typeof detail.failure_class === "string" ? detail.failure_class : "recovery_runtime_refused", typeof detail.recovery_hint === "string" ? detail.recovery_hint : undefined);
    }
    return value;
  }
  async function harborOperationStatus(operation: string): Promise<ObjectValue | null> {
    const response = await fetch(new URL(`/runtime/profile-recovery/operations/${encodeURIComponent(operation)}`, options.harborBaseUrl), {
      method: "GET", headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" }, signal: AbortSignal.timeout(70_000)
    });
    if (response.status === 404) return null;
    let value: ObjectValue;
    try { value = object(await response.json()); } catch { throw new ProfileRecoveryCoreError("recovery_runtime_invalid", "inspect_runtime_and_retry"); }
    if (!response.ok && value.status !== "rejected" && value.status !== "unknown_outcome" && value.status !== "manual_recovery_required") {
      throw new ProfileRecoveryCoreError(typeof value.error === "string" ? value.error : "recovery_runtime_refused");
    }
    return value;
  }
  async function findByOperation(operation: string): Promise<RunRecord | undefined> {
    const records = await store.listRunRecords();
    return records.find(record => record.public_result_summary?.operation_ref === operation);
  }
  async function begin(kind: string, idempotencyKey: string, profileRef: string, input: ObjectValue): Promise<{ operation: string; run: RunRecord | undefined; requestHash: string }> {
    const operation = operationRef(kind, idempotencyKey), existing = await findByOperation(operation), requestHash = hash(canonical({ kind, ...input }));
    if (existing) {
      if (existing.public_result_summary?.request_hash !== requestHash) fail("recovery_idempotency_conflict");
      return { operation, run: existing, requestHash };
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return { operation, run: undefined, requestHash };
  }
  async function createRun(kind: string, idempotencyKey: string, operation: string, profileRef: string, requestHash: string, risk: "read" | "write") {
    const run = await store.createRunRecord({ run_id: runId(operation), task_intent_ref: `recovery-intent:${operation}`, capability_ref: "webenvoy:installed-profile-recovery", status: "admitted", admission: { decision: "accepted", action_risk: risk }, public_result_summary: { schema_version: CORE_PROFILE_RECOVERY_SCHEMA, operation, operation_ref: operation, kind, profile_ref: profileRef, request_hash: requestHash, recovery_status: "running" } });
    await store.updateRunRecord(run.run_id, { status: "running" });
    return (await store.getRunRecord(run.run_id))!;
  }
  async function complete(run: RunRecord, recoveryStatus: string, result: ObjectValue): Promise<RecoveryResult> {
    const updated = await store.updateRunRecord(run.run_id, { status: "succeeded", result_ref: `recovery-result:${run.run_id}`, result_kind: "installed_profile_recovery", evidence_refs: [`recovery:${run.public_result_summary?.operation_ref ?? run.run_id}`], public_result_summary: { ...run.public_result_summary, recovery_status: recoveryStatus, result } });
    return response(updated);
  }
  async function reject(run: RunRecord, error: unknown, status = "rejected"): Promise<RecoveryResult> {
    const detail = failure(error);
    const updated = await store.updateRunRecord(run.run_id, { status: status === "unknown_outcome" ? "unknown_outcome" : status === "manual_recovery_required" ? "manual_recovery_required" : "failed", failure: { category: "runtime_execution", code: detail.code, phase: "execution", recovery_hint: detail.recovery_hint }, public_result_summary: { ...run.public_result_summary, recovery_status: status } });
    return response(updated);
  }
  async function recordRemote(run: RunRecord, remote: ObjectValue): Promise<RecoveryResult> {
    normalizeBackup(remote);
    if (remote.operation_ref !== run.public_result_summary?.operation_ref || remote.profile_ref !== run.public_result_summary?.profile_ref) return fail("recovery_contract_invalid");
    if (run.status === "unknown_outcome" || run.status === "manual_recovery_required") {
      if (!["completed", "rejected", "manual_recovery_required", "unknown_outcome", "running"].includes(String(remote.status))) return fail("recovery_contract_invalid");
      const updated = await store.updateRunRecord(run.run_id, { public_result_summary: { ...run.public_result_summary, result: { operation: remote }, ...(remote.status === "completed" || remote.status === "rejected" ? { reconciliation: remote.status } : {}) } });
      return response(updated);
    }
    if (remote.status === "completed") return complete(run, `${run.public_result_summary?.kind}_completed`, { operation: remote });
    if (remote.status === "running") return response(run);
    if (!["rejected", "unknown_outcome", "manual_recovery_required"].includes(String(remote.status))) return fail("recovery_contract_invalid");
    const detail = object(remote.failure);
    return reject(run, new ProfileRecoveryCoreError(text(detail.code), text(detail.recovery_hint ?? "query_operation_without_replay")), String(remote.status));
  }
  async function runOperation(kind: "inspect" | "backup" | "plan", idempotencyKey: string, profileRef: string, input: ObjectValue, action: (operation: string) => Promise<{ status: string; result: ObjectValue }>, risk: "read" | "write" = "read"): Promise<RecoveryResult> {
    const lock = await withFileOwnershipLock(operationLock(operationRef(kind, idempotencyKey)), 5_000, async () => {
      const begun = await begin(kind, idempotencyKey, profileRef, input);
      if (begun.run) return response(begun.run);
      const run = await createRun(kind, idempotencyKey, begun.operation, profileRef, begun.requestHash, risk);
      try { const result = await action(begun.operation); return await complete(run, result.status, result.result); }
      catch (error) { return reject(run, error, kind === "backup" && !(error instanceof ProfileRecoveryCoreError) ? "unknown_outcome" : "rejected"); }
    });
    return lock;
  }
  function parseProfileRequest(value: unknown, allowBackup = false): { idempotency_key: string; profile_ref: string; backup_ref?: string } {
    const input = object(value), allowed = allowBackup ? ["idempotency_key", "profile_ref", "backup_ref"] : ["idempotency_key", "profile_ref"];
    if (Object.keys(input).some(name => !allowed.includes(name))) return fail("recovery_input_invalid");
    return { idempotency_key: key(input.idempotency_key), profile_ref: ref(input.profile_ref), ...(input.backup_ref === undefined ? {} : { backup_ref: ref(input.backup_ref) }) };
  }
  const service = {
    async inspect(value: unknown): Promise<RecoveryResult> {
      const input = parseProfileRequest(value);
      return runOperation("inspect", input.idempotency_key, input.profile_ref, input, async operation => ({ status: "inspect_completed", result: { inspection: normalizeInspect(await harbor("/runtime/profile-recovery/inspect", { profile_ref: input.profile_ref })), operation_ref: operation } }));
    },
    async backup(value: unknown): Promise<RecoveryResult> {
      const input = parseProfileRequest(value);
      return withFileOwnershipLock(operationLock(operationRef("backup", input.idempotency_key)), 5_000, async () => {
        const begun = await begin("backup", input.idempotency_key, input.profile_ref, input);
        if (begun.run) return response(begun.run);
        const run = await createRun("backup", input.idempotency_key, begun.operation, input.profile_ref, begun.requestHash, "write");
        try { return await recordRemote(run, await harbor("/runtime/profile-recovery/backups", { ...input, operation_ref: begun.operation })); }
        catch (error) { return reject(run, error, "unknown_outcome"); }
      });
    },
    async plan(value: unknown): Promise<RecoveryResult> {
      const input = parseProfileRequest(value, true);
      if (!input.backup_ref) return fail("recovery_backup_ref_required", "inspect_and_select_a_matching_backup");
      return runOperation("plan", input.idempotency_key, input.profile_ref, input, async operation => {
        const prepared = object(await harbor("/runtime/profile-recovery/plan", { idempotency_key: input.idempotency_key, operation_ref: operation, profile_ref: input.profile_ref, backup_ref: input.backup_ref }));
        const planInputs = object(prepared.plan_inputs);
        if (planInputs.profile_ref !== input.profile_ref || planInputs.backup_ref !== input.backup_ref || planInputs.schema_version !== "webenvoy.profile-recovery-plan.v1") return fail("recovery_contract_invalid");
        const plan: Plan = { ...planInputs, schema_version: "webenvoy.profile-recovery-plan.v1", profile_ref: input.profile_ref, backup_ref: input.backup_ref!, backup_time: text(planInputs.backup_time), plan_ref: `plan:${hash(operation).slice(0, 64)}`, created_at: new Date().toISOString(), expires_at: expiresAt(), preserved_current_truth: ["grants", "revocations", "security_policy", "account_bindings", "runs", "receipts", "external_outcomes", "audit", "other_profiles"], expected_effect: "restore_selected_profile_to_backup_timepoint_without_replay" };
        return { status: "plan_completed", result: { plan, requires_owner_confirmation: true } };
      });
    },
    async apply(value: unknown): Promise<RecoveryResult> {
      const input = object(value), allowed = ["idempotency_key", "plan", "confirmation"];
      if (Object.keys(input).some(name => !allowed.includes(name))) return fail("recovery_input_invalid");
      const idempotencyKey = key(input.idempotency_key), plan = object(input.plan) as Plan, confirmation = object(input.confirmation) as Confirmation;
      const planRef = ref(plan.plan_ref), profileRef = ref(plan.profile_ref), operation = operationRef("apply", idempotencyKey);
      const requestHash = hash(canonical({ kind: "apply", plan, confirmation }));
      return withFileOwnershipLock(operationLock(operation), 5_000, async () => {
        const existing = await findByOperation(operation);
        if (existing) {
          if (existing.public_result_summary?.request_hash !== requestHash) return fail("recovery_idempotency_conflict");
          return response(existing);
        }
        return withFileOwnershipLock(join(directory, `${hash(planRef)}.lock`), 5_000, async () => {
          const planRun = (await store.listRunRecords()).find(run => {
            const result = run.public_result_summary?.result as ObjectValue | undefined;
            return run.status === "succeeded" && (result?.plan as ObjectValue | undefined)?.plan_ref === planRef;
          });
          if (!planRun) return fail("recovery_plan_not_found", "create_a_new_plan");
          const planSummary = planRun.public_result_summary!;
          const storedPlan = (planSummary.result as ObjectValue).plan;
          if (canonical(plan) !== canonical(storedPlan)) return fail("recovery_plan_changed", "review_and_confirm_the_original_plan");
          if (typeof planSummary.apply_operation_ref === "string") return fail("recovery_confirmation_already_consumed", "query_the_original_recovery_operation");
          const confirmedAt = Date.parse(confirmation.confirmed_at);
          if (plan.schema_version !== "webenvoy.profile-recovery-plan.v1" || !Number.isFinite(Date.parse(plan.expires_at)) || Date.parse(plan.expires_at) <= Date.now()
              || confirmation.plan_ref !== planRef || confirmation.confirmed_by !== "owner" || confirmation.decision !== "apply"
              || confirmation.schema_version !== "webenvoy.profile-recovery-confirmation.v1" || confirmation.idempotency_key !== idempotencyKey
              || !Number.isFinite(confirmedAt) || confirmedAt < Date.parse(plan.created_at) || confirmedAt > Date.now() + 5_000
              || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(confirmation.confirmation_ref)) {
            return fail("recovery_confirmation_invalid", "create_a_new_plan_and_confirm_that_plan");
          }
          const run = await createRun("apply", idempotencyKey, operation, profileRef, requestHash, "write");
          // Consume the exact plan durably before dispatch. An interrupted Core
          // can query the original operation, but cannot dispatch a second apply.
          await store.updateRunRecord(planRun.run_id, { public_result_summary: { ...planSummary, apply_operation_ref: operation, confirmation_ref: confirmation.confirmation_ref, confirmation_consumed_at: new Date().toISOString() } });
          try {
            return await recordRemote(run, await harbor("/runtime/profile-recovery/apply", { idempotency_key: idempotencyKey, operation_ref: operation, plan, confirmation }));
          } catch (error) {
            return reject(run, error, "unknown_outcome");
          }
        });
      });
    },
    async request(value: unknown): Promise<RecoveryResult> {
      const input = parseProfileRequest(value, true);
      if (!input.backup_ref) {
        const inspected = await service.inspect({ idempotency_key: input.idempotency_key, profile_ref: input.profile_ref });
        return { ...inspected, status: "owner_selection_required", result: { ...(inspected.result ?? {}), requires_owner_confirmation: true } };
      }
      return service.plan(input);
    },
    async status(value: unknown, expectedProfileRef?: string): Promise<RecoveryResult> {
      const input = object(value);
      if (Object.keys(input).some(name => name !== "operation_ref")) return fail("recovery_input_invalid");
      const operation = ref(input.operation_ref);
      return withFileOwnershipLock(operationLock(operation), 5_000, async () => {
        const run = await findByOperation(operation);
        if (!run || run.public_result_summary?.schema_version !== CORE_PROFILE_RECOVERY_SCHEMA) return fail("recovery_operation_not_found", "query_the_original_operation_ref");
        if (expectedProfileRef !== undefined && run.public_result_summary.profile_ref !== expectedProfileRef) return fail("recovery_operation_not_found");
        if (["running", "unknown_outcome", "manual_recovery_required"].includes(run.status) && !run.public_result_summary.reconciliation && ["backup", "apply"].includes(String(run.public_result_summary.kind))) {
          // Observe only an existing receipt; never redispatch an old mutation.
          const remote = await harborOperationStatus(operation).catch(() => null);
          if (remote) return recordRemote(run, remote);
        }
        return response(run);
      });
    }
  };
  return service;
}
