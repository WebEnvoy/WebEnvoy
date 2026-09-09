import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";

export const managedOperations = ["profile.list", "profile.read", "profile.create", "instance.start", "instance.stop", "instance.observe", "instance.handoff", "account.bind"] as const;
export type ManagedOperation = typeof managedOperations[number];
export type ManagedPrincipal = { principal_id: string; display_name: string; revoked_at: string | null };
export type ManagedConnection = { connection_id: string; principal_id: string; connected_at: string; revoked_at: string | null };
export type ManagedProfilePolicy = { profile_ref: string; allowed_operations: ManagedOperation[]; allowed_origins: string[] };
export type ManagedCreationTemplate = {
  template_ref: string;
  provider_id: string;
  site: { site_id: string; origin: string; display_name: string };
  language: string;
  timezone: string;
  permission_ceiling: { allowed_operations: ManagedOperation[]; allowed_origins: string[] };
};
export type ManagedGrant = {
  grant_id: string;
  principal_id: string;
  profile_refs: string[];
  allowed_operations: ManagedOperation[];
  allowed_origins: string[];
  expires_at: string;
  revoked_at: string | null;
  creation_template: ManagedCreationTemplate | null;
  max_created_profiles: number;
  created_profile_refs: string[];
};
export type ManagedTaskScope = { operations: ManagedOperation[]; profile_refs: string[]; origins: string[] };
export type ManagedAccessRequest = {
  connection_id: string; grant_id: string; operation: ManagedOperation;
  profile_ref?: string; origin?: string; template_ref?: string; task_scope: ManagedTaskScope;
};
export type ManagedAccess = {
  principal: ManagedPrincipal; connection: ManagedConnection; grant: ManagedGrant;
  profile_policy?: ManagedProfilePolicy; creation_template?: ManagedCreationTemplate;
};
type StoredPrincipal = ManagedPrincipal & { credential_hash: string };
type State = {
  schema_version: "webenvoy.managed-access.v0";
  principals: StoredPrincipal[]; connections: ManagedConnection[]; grants: ManagedGrant[];
  profile_policies: ManagedProfilePolicy[];
  receipts: { key_hash: string; request_hash: string; result: unknown }[];
};
export class ManagedAccessError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new ManagedAccessError(code); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_access_invalid_input");
  const obj = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(obj, key)) || Object.keys(obj).some(key => ![...required, ...optional].includes(key))) return fail("managed_access_invalid_input");
  return obj;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 512 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail("managed_access_invalid_input");
  return value;
}
function strings(value: unknown, parse: (value: unknown) => string = string): string[] {
  if (!Array.isArray(value) || value.length > 1024) return fail("managed_access_invalid_input");
  const result = value.map(parse);
  if (new Set(result).size !== result.length) return fail("managed_access_invalid_input");
  return result;
}
function operation(value: unknown): ManagedOperation {
  if (!managedOperations.includes(value as ManagedOperation)) return fail("managed_access_invalid_input");
  return value as ManagedOperation;
}
function operations(value: unknown): ManagedOperation[] { return strings(value, operation) as ManagedOperation[]; }
function origin(value: unknown): string {
  const text = string(value);
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== text || url.username || url.password) return fail("managed_access_invalid_input");
    return text;
  } catch { return fail("managed_access_invalid_input"); }
}
function timestamp(value: unknown): string {
  const text = string(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) return fail("managed_access_invalid_input");
  return text;
}
function credential(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return fail("managed_access_invalid_credential");
  return value;
}
function ceiling(value: unknown): ManagedCreationTemplate["permission_ceiling"] {
  const obj = object(value, ["allowed_operations", "allowed_origins"]);
  return { allowed_operations: operations(obj.allowed_operations), allowed_origins: strings(obj.allowed_origins, origin) };
}
function template(value: unknown): ManagedCreationTemplate | null {
  if (value === null) return null;
  const obj = object(value, ["template_ref", "provider_id", "site", "language", "timezone", "permission_ceiling"]);
  const site = object(obj.site, ["site_id", "origin", "display_name"]);
  return { template_ref: string(obj.template_ref), provider_id: string(obj.provider_id),
    site: { site_id: string(site.site_id), origin: origin(site.origin), display_name: string(site.display_name) },
    language: string(obj.language), timezone: string(obj.timezone), permission_ceiling: ceiling(obj.permission_ceiling) };
}
function policy(value: unknown): ManagedProfilePolicy {
  const obj = object(value, ["profile_ref", "allowed_operations", "allowed_origins"]);
  return { profile_ref: string(obj.profile_ref), ...ceiling({ allowed_operations: obj.allowed_operations, allowed_origins: obj.allowed_origins }) };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function publicPrincipal(principal: StoredPrincipal): ManagedPrincipal {
  return { principal_id: principal.principal_id, display_name: principal.display_name, revoked_at: principal.revoked_at };
}
function empty(): State { return { schema_version: "webenvoy.managed-access.v0", principals: [], connections: [], grants: [], profile_policies: [], receipts: [] }; }

export function createFileManagedAccessStore(options: { directory: string; clock?: () => Date; lockTimeoutMs?: number }) {
  const path = join(options.directory, "managed-access.json");
  const now = () => (options.clock?.() ?? new Date()).toISOString();
  async function read(): Promise<State> {
    try {
      const state = JSON.parse(await readFile(path, "utf8")) as State;
      if (state.schema_version !== "webenvoy.managed-access.v0" || ![state.principals, state.connections, state.grants, state.profile_policies, state.receipts].every(Array.isArray)) return fail("managed_access_store_invalid");
      for (const entry of state.principals) {
        object(entry, ["principal_id", "display_name", "credential_hash", "revoked_at"]);
        string(entry.principal_id); string(entry.display_name); credential(entry.credential_hash);
        if (entry.revoked_at !== null) timestamp(entry.revoked_at);
      }
      for (const entry of state.connections) {
        object(entry, ["connection_id", "principal_id", "connected_at", "revoked_at"]);
        string(entry.connection_id); string(entry.principal_id); timestamp(entry.connected_at);
        if (entry.revoked_at !== null) timestamp(entry.revoked_at);
      }
      for (const entry of state.grants) {
        object(entry, ["grant_id", "principal_id", "profile_refs", "allowed_operations", "allowed_origins", "expires_at", "revoked_at", "creation_template", "max_created_profiles", "created_profile_refs"]);
        string(entry.grant_id); string(entry.principal_id); strings(entry.profile_refs);
        operations(entry.allowed_operations); strings(entry.allowed_origins, origin); timestamp(entry.expires_at); template(entry.creation_template);
        if (entry.revoked_at !== null) timestamp(entry.revoked_at);
        strings(entry.created_profile_refs);
        if (!Number.isSafeInteger(entry.max_created_profiles) || entry.max_created_profiles < entry.created_profile_refs.length ||
          entry.max_created_profiles > 1024 || entry.created_profile_refs.some(ref => !entry.profile_refs.includes(ref))) return fail("managed_access_store_invalid");
      }
      state.profile_policies.forEach(policy);
      for (const entry of state.receipts) {
        object(entry, ["key_hash", "request_hash", "result"]); credential(entry.key_hash); credential(entry.request_hash);
      }
      for (const ids of [state.principals.map(item => item.principal_id), state.principals.map(item => item.credential_hash),
        state.connections.map(item => item.connection_id), state.grants.map(item => item.grant_id),
        state.profile_policies.map(item => item.profile_ref), state.receipts.map(item => item.key_hash)]) {
        if (new Set(ids).size !== ids.length) return fail("managed_access_store_invalid");
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }
  async function transaction<T>(action: (state: State) => T): Promise<T> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    return withFileOwnershipLock(`${path}.lock`, options.lockTimeoutMs ?? 5000, async () => {
      const state = await read();
      const result = action(state);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      return result;
    });
  }
  function receipt<T>(state: State, method: string, input: Record<string, unknown>, action: () => T): T {
    const keyHash = hash(string(input.idempotency_key));
    const requestHash = hash(canonical({ method, ...input }));
    const previous = state.receipts.find(item => item.key_hash === keyHash);
    if (previous) {
      if (previous.request_hash !== requestHash) return fail("managed_access_idempotency_conflict");
      return previous.result as T;
    }
    const result = action();
    state.receipts.push({ key_hash: keyHash, request_hash: requestHash, result: structuredClone(result) });
    return result;
  }
  function authenticated(state: State, credentialHash: unknown): StoredPrincipal {
    const digest = credential(credentialHash);
    const principal = state.principals.find(item => item.credential_hash === digest);
    if (!principal || principal.revoked_at !== null) return fail("managed_access_authentication_required");
    return principal;
  }
  function activeGrant(state: State, grantId: string): ManagedGrant {
    const grant = state.grants.find(item => item.grant_id === grantId);
    if (!grant || grant.revoked_at !== null || Date.parse(grant.expires_at) <= Date.parse(now())) return fail("managed_access_grant_unavailable");
    const principal = state.principals.find(item => item.principal_id === grant.principal_id);
    if (!principal || principal.revoked_at !== null) return fail("managed_access_grant_unavailable");
    return grant;
  }
  return {
    async registerPrincipal(value: unknown): Promise<ManagedPrincipal> {
      const input = object(value, ["idempotency_key", "display_name", "credential_hash"]);
      const name = string(input.display_name), digest = credential(input.credential_hash);
      return transaction(state => receipt(state, "registerPrincipal", input, () => {
        if (state.principals.some(item => item.credential_hash === digest)) return fail("managed_access_credential_already_registered");
        const principal = { principal_id: `principal:${randomUUID()}`, display_name: name, credential_hash: digest, revoked_at: null };
        state.principals.push(principal);
        return publicPrincipal(principal);
      }));
    },
    async authenticateCredential(credentialHash: unknown): Promise<ManagedPrincipal> { return publicPrincipal(authenticated(await read(), credentialHash)); },
    async connect(credentialHash: unknown): Promise<ManagedConnection> {
      return transaction(state => {
        const principal = authenticated(state, credentialHash);
        const connection = { connection_id: `connection:${randomUUID()}`, principal_id: principal.principal_id, connected_at: now(), revoked_at: null };
        state.connections.push(connection);
        return connection;
      });
    },
    async createGrant(value: unknown): Promise<ManagedGrant> {
      const input = object(value, ["idempotency_key", "principal_id", "profile_refs", "allowed_operations", "allowed_origins", "expires_at", "creation_template", "max_created_profiles"]);
      const parsed = { principal_id: string(input.principal_id), profile_refs: strings(input.profile_refs), allowed_operations: operations(input.allowed_operations),
        allowed_origins: strings(input.allowed_origins, origin), expires_at: timestamp(input.expires_at), creation_template: template(input.creation_template), max_created_profiles: input.max_created_profiles };
      if (!Number.isSafeInteger(parsed.max_created_profiles) || (parsed.max_created_profiles as number) < 0 || (parsed.max_created_profiles as number) > 1024 ||
        (!parsed.creation_template && parsed.max_created_profiles !== 0)) return fail("managed_access_invalid_input");
      return transaction(state => receipt(state, "createGrant", input, () => {
        if (!state.principals.some(item => item.principal_id === parsed.principal_id && item.revoked_at === null) || Date.parse(parsed.expires_at) <= Date.parse(now())) return fail("managed_access_grant_unavailable");
        const grant: ManagedGrant = { ...parsed, max_created_profiles: parsed.max_created_profiles as number, grant_id: `grant:${randomUUID()}`, revoked_at: null, created_profile_refs: [] };
        state.grants.push(grant);
        return grant;
      }));
    },
    async revokeGrant(value: unknown): Promise<ManagedGrant> {
      const input = object(value, ["idempotency_key", "grant_id"]), id = string(input.grant_id);
      return transaction(state => receipt(state, "revokeGrant", input, () => {
        const item = state.grants.find(item => item.grant_id === id);
        if (!item) return fail("managed_access_grant_unavailable");
        item.revoked_at ??= now(); return item;
      }));
    },
    async revokePrincipal(value: unknown): Promise<ManagedPrincipal> {
      const input = object(value, ["idempotency_key", "principal_id"]), id = string(input.principal_id);
      return transaction(state => receipt(state, "revokePrincipal", input, () => {
        const item = state.principals.find(item => item.principal_id === id);
        if (!item) return fail("managed_access_authentication_required");
        item.revoked_at ??= now(); return publicPrincipal(item);
      }));
    },
    async revokeConnection(value: unknown): Promise<ManagedConnection> {
      const input = object(value, ["idempotency_key", "connection_id"]), id = string(input.connection_id);
      return transaction(state => receipt(state, "revokeConnection", input, () => {
        const item = state.connections.find(item => item.connection_id === id);
        if (!item) return fail("managed_access_connection_unavailable");
        item.revoked_at ??= now(); return item;
      }));
    },
    async setProfilePolicy(value: unknown): Promise<ManagedProfilePolicy> {
      const input = object(value, ["idempotency_key", "profile_ref", "allowed_operations", "allowed_origins"]);
      const parsed = policy({ profile_ref: input.profile_ref, allowed_operations: input.allowed_operations, allowed_origins: input.allowed_origins });
      return transaction(state => receipt(state, "setProfilePolicy", input, () => {
        state.profile_policies = state.profile_policies.filter(item => item.profile_ref !== parsed.profile_ref);
        state.profile_policies.push(parsed); return parsed;
      }));
    },
    async checkAccess(credentialHash: unknown, value: unknown): Promise<ManagedAccess> {
      const input = object(value, ["connection_id", "grant_id", "operation", "task_scope"], ["profile_ref", "origin", "template_ref"]);
      const connectionId = string(input.connection_id), grantId = string(input.grant_id), op = operation(input.operation);
      const profileRef = input.profile_ref === undefined ? undefined : string(input.profile_ref);
      const targetOrigin = input.origin === undefined ? undefined : origin(input.origin);
      const templateRef = input.template_ref === undefined ? undefined : string(input.template_ref);
      const scope = object(input.task_scope, ["operations", "profile_refs", "origins"]);
      const task = { operations: operations(scope.operations), profile_refs: strings(scope.profile_refs), origins: strings(scope.origins, origin) };
      const state = await read(), principal = authenticated(state, credentialHash);
      const connection = state.connections.find(item => item.connection_id === connectionId && item.principal_id === principal.principal_id && item.revoked_at === null);
      if (!connection) return fail("managed_access_connection_unavailable");
      const grant = activeGrant(state, grantId);
      if (grant.principal_id !== principal.principal_id || !grant.allowed_operations.includes(op) || !task.operations.includes(op)) return fail("managed_access_denied");
      const result: ManagedAccess = { principal: publicPrincipal(principal), connection, grant };
      if (op === "profile.create") {
        if (profileRef || !grant.creation_template || templateRef !== grant.creation_template.template_ref || grant.created_profile_refs.length >= grant.max_created_profiles) return fail("managed_access_creation_denied");
        const creationOrigin = grant.creation_template.site.origin;
        if ((targetOrigin !== undefined && targetOrigin !== creationOrigin) || !grant.allowed_origins.includes(creationOrigin) || !task.origins.includes(creationOrigin)) return fail("managed_access_denied");
        return { ...result, creation_template: grant.creation_template };
      }
      if (templateRef !== undefined) return fail("managed_access_invalid_input");
      if (op === "profile.list" && profileRef === undefined) {
        return { ...result, grant: { ...grant, profile_refs: grant.profile_refs.filter(ref => task.profile_refs.includes(ref) && state.profile_policies.some(item => item.profile_ref === ref && item.allowed_operations.includes(op))) } };
      }
      if (!profileRef || !grant.profile_refs.includes(profileRef) || !task.profile_refs.includes(profileRef)) return fail("managed_access_denied");
      const profile = state.profile_policies.find(item => item.profile_ref === profileRef);
      if (!profile || !profile.allowed_operations.includes(op)) return fail("managed_access_denied");
      if (targetOrigin !== undefined && (!grant.allowed_origins.includes(targetOrigin) || !profile.allowed_origins.includes(targetOrigin) || !task.origins.includes(targetOrigin))) return fail("managed_access_denied");
      if (["instance.start", "instance.observe", "account.bind"].includes(op) && targetOrigin === undefined) return fail("managed_access_origin_required");
      return { ...result, profile_policy: profile };
    },
    // The caller coordinates Harbor creation with its existing operation/idempotency owner.
    // This short transaction registers the result; it does not reserve quota before a side effect.
    async recordCreatedProfile(value: unknown): Promise<ManagedProfilePolicy> {
      const input = object(value, ["idempotency_key", "grant_id", "profile_ref"]), grantId = string(input.grant_id), profileRef = string(input.profile_ref);
      return transaction(state => receipt(state, "recordCreatedProfile", input, () => {
        const grant = activeGrant(state, grantId);
        if (!grant.creation_template || !grant.allowed_operations.includes("profile.create") || grant.created_profile_refs.length >= grant.max_created_profiles || state.profile_policies.some(item => item.profile_ref === profileRef)) return fail("managed_access_creation_denied");
        grant.created_profile_refs.push(profileRef);
        if (!grant.profile_refs.includes(profileRef)) grant.profile_refs.push(profileRef);
        const profile = { profile_ref: profileRef, ...structuredClone(grant.creation_template.permission_ceiling) };
        state.profile_policies.push(profile); return profile;
      }));
    },
    async list() {
      const state = await read();
      return { principals: state.principals.map(publicPrincipal), connections: state.connections, grants: state.grants, profile_policies: state.profile_policies };
    }
  };
}
export type FileManagedAccessStore = ReturnType<typeof createFileManagedAccessStore>;
