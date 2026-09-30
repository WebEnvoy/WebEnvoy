import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError } from "./managed-access.js";

export type BusinessTargetAccountScope = { profile_ref: string; account_system_ref: string; account_ref: string };
export type BusinessTarget = {
  schema_version: "webenvoy.business-target/v1";
  business_target_ref: string;
  account_system_ref: string;
  account_ref: string;
  label: string;
  declared_external_id: string | null;
  status: "active" | "disabled";
  verification_state: "unverified";
  created_by_profile_ref: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
};

type OperationResult = { business_target: BusinessTarget } | { business_targets: BusinessTarget[] };
type BusinessTargetRequest = {
  operation: "business_target.create" | "business_target.list" | "business_target.read" | "business_target.metadata.update" | "business_target.disable";
  profile_ref: string;
  account_system_ref?: string;
  account_ref?: string;
  allowed_account_scopes: BusinessTargetAccountScope[];
  blocked_account_scopes?: (BusinessTargetAccountScope & { ownership_status: "conflict" | "not_runnable" | "unknown" | "changed" })[];
  business_target_ref?: string;
  label?: string;
  declared_external_id?: string;
};
type BusinessTargetAssessment = { state: "available"; status?: BusinessTarget["status"] } | { state: "blocked"; reason_code: string };
type State = {
  schema_version: "webenvoy.business-target-store/v1";
  records: BusinessTarget[];
  receipts: { operation_ref: string; request_hash: string; result: OperationResult }[];
};

const fail = (code: string): never => { throw new ManagedAccessError(code); };
const text = (value: unknown, max = 512): string => {
  if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail("managed_browser_invalid_input");
  return value;
};
function accountSystemRef(value: unknown): string {
  const ref = text(value, 128);
  if (!/^account-system:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ref)) return fail("managed_browser_invalid_input");
  return ref;
}
function accountRef(value: unknown): string {
  const ref = text(value, 128);
  if (!/^account:sha256:[a-f0-9]{64}$/.test(ref)) return fail("managed_browser_invalid_input");
  return ref;
}
function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function assertRecord(value: unknown): asserts value is BusinessTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("business_target_store_invalid");
  const record = value as Record<string, unknown>;
  const required = ["schema_version", "business_target_ref", "account_system_ref", "account_ref", "label", "declared_external_id", "status", "verification_state", "created_by_profile_ref", "created_at", "updated_at", "disabled_at"];
  if (Object.keys(record).length !== required.length || required.some(key => !Object.hasOwn(record, key)) ||
      record.schema_version !== "webenvoy.business-target/v1" || typeof record.business_target_ref !== "string" || !/^business-target:[0-9a-f-]{36}$/.test(record.business_target_ref) ||
      typeof record.label !== "string" || record.label.trim() !== record.label || !record.label || record.label.length > 256 || /[\u0000-\u001f\u007f]/.test(record.label) ||
      !(record.declared_external_id === null || typeof record.declared_external_id === "string" && record.declared_external_id.length <= 256 && !/[\u0000-\u001f\u007f]/.test(record.declared_external_id)) ||
      !["active", "disabled"].includes(String(record.status)) || record.verification_state !== "unverified" ||
      typeof record.created_by_profile_ref !== "string" || !record.created_by_profile_ref || record.created_by_profile_ref.length > 512 ||
      !validTimestamp(record.created_at) || !validTimestamp(record.updated_at) || !(record.disabled_at === null || validTimestamp(record.disabled_at)) ||
      record.status === "active" && record.disabled_at !== null || record.status === "disabled" && record.disabled_at === null) return fail("business_target_store_invalid");
  accountSystemRef(record.account_system_ref);
  accountRef(record.account_ref);
}
function empty(): State { return { schema_version: "webenvoy.business-target-store/v1", records: [], receipts: [] }; }

function assess(state: State, input: BusinessTargetRequest): { result: BusinessTargetAssessment; record?: BusinessTarget } {
  if (input.operation === "business_target.create" || input.operation === "business_target.list") {
    const system = accountSystemRef(input.account_system_ref), account = accountRef(input.account_ref);
    if (!input.allowed_account_scopes.some(scope => scope.profile_ref === input.profile_ref && scope.account_system_ref === system && scope.account_ref === account)) {
      return { result: { state: "blocked", reason_code: "business_target_scope_unavailable" } };
    }
    return { result: { state: "available" } };
  }
  const ref = text(input.business_target_ref, 128);
  const record = state.records.find(item => item.business_target_ref === ref);
  if (!record) return { result: { state: "blocked", reason_code: "business_target_unavailable" } };
  if (!input.allowed_account_scopes.some(scope => scope.profile_ref === input.profile_ref && scope.account_system_ref === record.account_system_ref && scope.account_ref === record.account_ref)) {
    const blocked = input.blocked_account_scopes?.find(scope => scope.profile_ref === input.profile_ref && scope.account_system_ref === record.account_system_ref && scope.account_ref === record.account_ref);
    const reason_code = blocked?.ownership_status === "conflict" ? "business_target_account_binding_conflict"
      : blocked?.ownership_status === "not_runnable" ? "business_target_account_not_runnable"
        : blocked?.ownership_status === "unknown" ? "business_target_account_binding_unknown"
          : blocked?.ownership_status === "changed" ? "business_target_account_binding_changed" : "business_target_unavailable";
    return { result: { state: "blocked", reason_code } };
  }
  if (input.operation === "business_target.metadata.update" && record.status !== "active") {
    return { result: { state: "blocked", reason_code: "business_target_disabled" }, record };
  }
  return { result: { state: "available", status: record.status }, record };
}

export function createFileBusinessTargetStore(options: { directory: string; clock?: () => Date; lockTimeoutMs?: number }) {
  const path = join(options.directory, "business-targets.json");
  const now = () => (options.clock?.() ?? new Date()).toISOString();
  async function readState(): Promise<State> {
    try {
      const state = JSON.parse(await readFile(path, "utf8")) as State;
      if (!state || state.schema_version !== "webenvoy.business-target-store/v1" || !Array.isArray(state.records) || !Array.isArray(state.receipts) ||
          Object.keys(state).some(key => !["schema_version", "records", "receipts"].includes(key))) return fail("business_target_store_invalid");
      state.records.forEach(assertRecord);
      if (new Set(state.records.map(record => record.business_target_ref)).size !== state.records.length) return fail("business_target_store_invalid");
      for (const receipt of state.receipts) {
        if (!receipt || typeof receipt.operation_ref !== "string" || !receipt.operation_ref || typeof receipt.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(receipt.request_hash) ||
            !receipt.result || typeof receipt.result !== "object" || Array.isArray(receipt.result)) return fail("business_target_store_invalid");
      }
      if (new Set(state.receipts.map(receipt => receipt.operation_ref)).size !== state.receipts.length) return fail("business_target_store_invalid");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }
  async function transaction<T>(action: (state: State) => T | Promise<T>): Promise<T> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    return withFileOwnershipLock(`${path}.lock`, options.lockTimeoutMs ?? 5000, async () => {
      const state = await readState();
      const result = await action(state);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      return result;
    });
  }
  return {
    async inspect(input: BusinessTargetRequest): Promise<BusinessTargetAssessment> {
      return assess(await readState(), input).result;
    },
    async operate(input: BusinessTargetRequest & {
      operation_ref: string;
      request_hash: string;
    }): Promise<OperationResult> {
      if (!input.operation_ref || !/^[a-f0-9]{64}$/.test(input.request_hash) || !input.profile_ref || input.profile_ref.length > 512) return fail("business_target_invalid_input");
      return transaction(state => {
        const previous = state.receipts.find(item => item.operation_ref === input.operation_ref);
        if (previous) {
          if (previous.request_hash !== input.request_hash) return fail("managed_browser_idempotency_conflict");
          return structuredClone(previous.result);
        }
        let result: OperationResult;
        const assessment = assess(state, input);
        if (assessment.result.state === "blocked") return fail(assessment.result.reason_code);
        if (input.operation === "business_target.create" || input.operation === "business_target.list") {
          const system = accountSystemRef(input.account_system_ref), account = accountRef(input.account_ref);
          if (input.operation === "business_target.list") {
            result = { business_targets: state.records.filter(record => record.account_system_ref === system && record.account_ref === account).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.business_target_ref.localeCompare(b.business_target_ref)) };
          } else {
            const label = text(input.label, 256).trim();
            const declaredExternalId = input.declared_external_id === undefined ? null : text(input.declared_external_id, 256).trim();
            if (!label || input.declared_external_id !== undefined && !declaredExternalId) return fail("managed_browser_invalid_input");
            const timestamp = now();
            const record: BusinessTarget = {
              schema_version: "webenvoy.business-target/v1", business_target_ref: `business-target:${randomUUID()}`,
              account_system_ref: system, account_ref: account, label, declared_external_id: declaredExternalId,
              status: "active", verification_state: "unverified", created_by_profile_ref: input.profile_ref,
              created_at: timestamp, updated_at: timestamp, disabled_at: null
            };
            state.records.push(record);
            result = { business_target: record };
          }
        } else {
          const record = assessment.record!;
          if (input.operation === "business_target.read") result = { business_target: record };
          else if (input.operation === "business_target.metadata.update") {
            record.label = text(input.label, 256).trim();
            if (!record.label) return fail("managed_browser_invalid_input");
            record.updated_at = now();
            result = { business_target: record };
          } else {
            if (record.status !== "disabled") {
              record.status = "disabled";
              record.disabled_at = now();
              record.updated_at = record.disabled_at;
            }
            result = { business_target: record };
          }
        }
        state.receipts.push({ operation_ref: input.operation_ref, request_hash: input.request_hash, result: structuredClone(result) });
        return result;
      });
    },
    async operationResult(operationRef: string, requestHash: string): Promise<OperationResult | undefined> {
      const state = await readState();
      const receipt = state.receipts.find(item => item.operation_ref === operationRef);
      if (!receipt) return undefined;
      if (receipt.request_hash !== requestHash) return fail("managed_browser_idempotency_conflict");
      return structuredClone(receipt.result);
    }
  };
}

export type FileBusinessTargetStore = ReturnType<typeof createFileBusinessTargetStore>;
