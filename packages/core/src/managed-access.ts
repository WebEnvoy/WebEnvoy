import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import type { BusinessTargetAccountScope } from "./business-target-store.js";

export const managedInteractionOperations = ["instance.snapshot", "instance.click", "instance.input", "instance.press", "instance.scroll", "instance.wait"] as const;
export const managedPageOperations = ["page.list", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward"] as const;
export const managedSkillOperations = ["skill.list", "skill.inspect", "skill.install", "skill.enable", "skill.read", "skill.update", "skill.rollback", "skill.disable"] as const;
export const managedTaskOperations = ["task.submit", "task.query", "task.stop"] as const;
export const managedFileOperations = ["file.upload", "file.download"] as const;
export const managedBusinessTargetOperations = ["business_target.create", "business_target.list", "business_target.read", "business_target.metadata.update", "business_target.disable"] as const;
export const managedOperations = ["profile.list", "profile.read", "profile.create", "profile.import", "profile.migrate.request", "profile.copy_environment", "profile.archive", "profile.delete", "profile.metadata.update", "provider.preference.read", "provider.preference.set", "provider.preference.clear", "account_system.import_template", "instance.start", "instance.stop", "instance.observe", "instance.diagnostics", "environment.read", "environment.update", "instance.navigate", "instance.read", "instance.handoff", "account.bind", "recovery.inspect", "recovery.request", "recovery.status", ...managedPageOperations, ...managedInteractionOperations, ...managedFileOperations, ...managedSkillOperations, ...managedTaskOperations, ...managedBusinessTargetOperations] as const;
export type ManagedOperation = typeof managedOperations[number];
export type ManagedSkillOperation = typeof managedSkillOperations[number];
export type ManagedTaskOperation = typeof managedTaskOperations[number];
const profileScopeIndependentReads: readonly ManagedOperation[] = ["profile.list", "profile.read", "recovery.inspect", "recovery.status"];
export const managedScopeSemantics = ["legacy_request_guard_v1", "agent_operations_v2"] as const;
export type ManagedScopeSemantics = typeof managedScopeSemantics[number];
export const managedScopeConfirmationSchemaVersion = "webenvoy.agent-operations-v2-confirmation.v1" as const;
export type ManagedPrincipal = { principal_id: string; display_name: string; revoked_at: string | null };
export type ManagedConnection = { connection_id: string; principal_id: string; connected_at: string; revoked_at: string | null };
export type ManagedProfilePolicy = { profile_ref: string; allowed_operations: ManagedOperation[]; allowed_origins: string[]; controlled_interaction_origins?: string[]; scope_semantics?: ManagedScopeSemantics };
export type ManagedSkillScope = { skill_refs: string[]; source_refs: string[] };
export type ManagedAccountSystemScope = { template_refs: string[] };
export type ManagedAccountBindingScope = { profile_ref: string; account_system_ref: string; account_ref: string };
export type ManagedProfileSourceScope = { profile_source_refs: string[] };
export type ManagedFileScope = { upload_refs: string[]; allowed_mime_types: string[]; max_file_bytes: number };
export type ManagedBusinessTargetAccountScope = BusinessTargetAccountScope;
export type ManagedCreationTemplate = {
  template_ref: string;
  provider_id: string | null;
  site: { site_id: string; origin: string; display_name: string };
  language: string;
  timezone: string;
  permission_ceiling: Omit<ManagedProfilePolicy, "profile_ref">;
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
  skill_scope?: ManagedSkillScope;
  profile_source_refs?: string[];
  file_scope?: ManagedFileScope;
  business_target_account_scopes?: ManagedBusinessTargetAccountScope[];
  account_system_scope?: ManagedAccountSystemScope;
  account_binding_scopes?: ManagedAccountBindingScope[];
  scope_semantics?: ManagedScopeSemantics;
};
export type ManagedTaskScope = { operations: ManagedOperation[]; profile_refs: string[]; origins: string[]; file_refs?: string[]; skill_refs?: string[]; source_refs?: string[]; profile_source_refs?: string[]; template_refs?: string[]; account_binding_scopes?: ManagedAccountBindingScope[] };
export type ManagedAccessRequest = {
  connection_id: string; grant_id: string; operation: ManagedOperation;
  profile_ref?: string; origin?: string; template_ref?: string; target_provider_id?: string; profile_source_ref?: string; confirmation?: "delete_local_data"; skill_ref?: string; source_ref?: string; revision_ref?: string; file_refs?: string[];
  account_system_ref?: string; account_ref?: string; business_target_ref?: string; task_scope: ManagedTaskScope;
};
export type ManagedAccess = {
  principal: ManagedPrincipal; connection: ManagedConnection; grant: ManagedGrant;
  profile_policy?: ManagedProfilePolicy; creation_template?: ManagedCreationTemplate; authorized_origins: string[]; scope_semantics: ManagedScopeSemantics;
};
export type ManagedScopeTransitionResult = { scope_semantics: "agent_operations_v2"; source_grant_id: string; confirmation_ref: string; grant: ManagedGrant; profile_policy: ManagedProfilePolicy };
type StoredPrincipal = ManagedPrincipal & { credential_hash: string };
type State = {
  schema_version: "webenvoy.managed-access.v0" | "webenvoy.managed-access.v1" | "webenvoy.managed-access.v2";
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
function scopeSemantics(value: unknown): ManagedScopeSemantics {
  if (value === undefined) return "legacy_request_guard_v1";
  if (!managedScopeSemantics.includes(value as ManagedScopeSemantics)) return fail("managed_access_invalid_input");
  return value as ManagedScopeSemantics;
}
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
  const obj = object(value, ["allowed_operations", "allowed_origins"], ["controlled_interaction_origins", "scope_semantics"]);
  const allowed_origins = strings(obj.allowed_origins, origin);
  const controlled = obj.controlled_interaction_origins === undefined ? undefined : strings(obj.controlled_interaction_origins, origin);
  if (controlled?.some(item => !allowed_origins.includes(item))) return fail("managed_access_invalid_input");
  return { allowed_operations: operations(obj.allowed_operations), allowed_origins, ...(controlled === undefined ? {} : { controlled_interaction_origins: controlled }), ...(obj.scope_semantics === undefined ? {} : { scope_semantics: scopeSemantics(obj.scope_semantics) }) };
}
function skillScope(value: unknown): ManagedSkillScope {
  const obj = object(value, ["skill_refs", "source_refs"]);
  return { skill_refs: strings(obj.skill_refs), source_refs: strings(obj.source_refs) };
}
function accountSystemScope(value: unknown): ManagedAccountSystemScope {
  const obj = object(value, ["template_refs"]);
  const template_refs = strings(obj.template_refs, value => {
    const ref = string(value);
    if (!/^lode:\/\/account-system\/[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+$/.test(ref)) return fail("managed_access_invalid_input");
    return ref;
  });
  return { template_refs };
}
function accountBindingScopes(value: unknown): ManagedAccountBindingScope[] {
  if (!Array.isArray(value) || value.length > 1024) return fail("managed_access_invalid_input");
  const scopes = value.map(item => {
    const entry = object(item, ["profile_ref", "account_system_ref", "account_ref"]);
    const profile_ref = string(entry.profile_ref), account_system_ref = string(entry.account_system_ref), account_ref = string(entry.account_ref);
    if (!/^account-system:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(account_system_ref) || !/^account:sha256:[a-f0-9]{64}$/.test(account_ref)) return fail("managed_access_invalid_input");
    return { profile_ref, account_system_ref, account_ref };
  });
  if (new Set(scopes.map(item => canonical(item))).size !== scopes.length) return fail("managed_access_invalid_input");
  return scopes;
}
function profileSourceRefs(value: unknown): string[] {
  const refs = strings(value);
  if (refs.length > 64 || refs.some(ref => !/^profile-source:[0-9a-f-]{36}$/.test(ref))) return fail("managed_access_invalid_input");
  return refs;
}
const managedFileMimeTypes = new Set(["image/png", "image/jpeg", "application/pdf", "text/plain", "text/csv"]);
const managedFileRef = /^attachment:runtime\/[0-9a-f-]{36}$/;
function fileRef(value: unknown): string {
  const ref = string(value);
  if (!managedFileRef.test(ref)) return fail("managed_access_invalid_input");
  return ref;
}
function fileRefs(value: unknown): string[] {
  const refs = strings(value, fileRef);
  if (new Set(refs).size !== refs.length) return fail("managed_access_invalid_input");
  return refs;
}
function fileScope(value: unknown): ManagedFileScope {
  const obj = object(value, ["upload_refs", "allowed_mime_types", "max_file_bytes"]);
  const upload_refs = fileRefs(obj.upload_refs);
  if (upload_refs.length > 32) return fail("managed_access_invalid_input");
  const allowed_mime_types = strings(obj.allowed_mime_types);
  if (!allowed_mime_types.length || allowed_mime_types.length > managedFileMimeTypes.size || allowed_mime_types.some(item => !managedFileMimeTypes.has(item))) return fail("managed_access_invalid_input");
  if (!Number.isSafeInteger(obj.max_file_bytes) || Number(obj.max_file_bytes) < 1 || Number(obj.max_file_bytes) > 10 * 1024 * 1024) return fail("managed_access_invalid_input");
  return { upload_refs, allowed_mime_types, max_file_bytes: Number(obj.max_file_bytes) };
}
const businessTargetAccountSystemRef = /^account-system:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const businessTargetAccountRef = /^account:sha256:[a-f0-9]{64}$/;
const isBusinessTargetOperation = (value: unknown): value is typeof managedBusinessTargetOperations[number] =>
  (managedBusinessTargetOperations as readonly unknown[]).includes(value);
function businessTargetAccountScopes(value: unknown): ManagedBusinessTargetAccountScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) return fail("managed_access_invalid_input");
  const scopes = value.map(item => {
    const scope = object(item, ["profile_ref", "account_system_ref", "account_ref"]);
    const profile_ref = string(scope.profile_ref), account_system_ref = string(scope.account_system_ref), account_ref = string(scope.account_ref);
    if (!businessTargetAccountSystemRef.test(account_system_ref) || !businessTargetAccountRef.test(account_ref)) return fail("managed_access_invalid_input");
    return { profile_ref, account_system_ref, account_ref };
  });
  const keys = scopes.map(scope => `${scope.profile_ref}\u0000${scope.account_system_ref}\u0000${scope.account_ref}`);
  if (new Set(keys).size !== keys.length) return fail("managed_access_invalid_input");
  return scopes;
}
type ManagedBusinessTargetAccountSelection = { account_system_ref: string; account_ref: string };
function businessTargetAccountSelections(value: unknown): ManagedBusinessTargetAccountSelection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) return fail("managed_access_invalid_input");
  const selections = value.map(item => {
    const selection = object(item, ["account_system_ref", "account_ref"]);
    const account_system_ref = string(selection.account_system_ref), account_ref = string(selection.account_ref);
    if (!businessTargetAccountSystemRef.test(account_system_ref) || !businessTargetAccountRef.test(account_ref)) return fail("managed_access_invalid_input");
    return { account_system_ref, account_ref };
  });
  const keys = selections.map(selection => `${selection.account_system_ref}\u0000${selection.account_ref}`);
  if (new Set(keys).size !== keys.length) return fail("managed_access_invalid_input");
  return selections;
}
function businessTargetAccountScopesFromOwner(value: unknown, profileRef: string, selections: readonly ManagedBusinessTargetAccountSelection[]): ManagedBusinessTargetAccountScope[] {
  const scopes = businessTargetAccountScopes(value);
  if (scopes.length !== selections.length || scopes.some(scope => scope.profile_ref !== profileRef ||
      !selections.some(selection => selection.account_system_ref === scope.account_system_ref && selection.account_ref === scope.account_ref))) return fail("managed_access_account_binding_unavailable");
  return scopes;
}
function template(value: unknown): ManagedCreationTemplate | null {
  if (value === null) return null;
  const obj = object(value, ["template_ref", "provider_id", "site", "language", "timezone", "permission_ceiling"]);
  const site = object(obj.site, ["site_id", "origin", "display_name"]);
  return { template_ref: string(obj.template_ref), provider_id: obj.provider_id === null ? null : string(obj.provider_id),
    site: { site_id: string(site.site_id), origin: origin(site.origin), display_name: string(site.display_name) },
    language: string(obj.language), timezone: string(obj.timezone), permission_ceiling: ceiling(obj.permission_ceiling) };
}
function policy(value: unknown): ManagedProfilePolicy {
  const obj = object(value, ["profile_ref", "allowed_operations", "allowed_origins"], ["controlled_interaction_origins", "scope_semantics"]);
  const { profile_ref, ...limits } = obj;
  return { profile_ref: string(profile_ref), ...ceiling(limits) };
}
function v2Policy(value: unknown, profileRef: string): ManagedProfilePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_access_invalid_input");
  const raw = value as Record<string, unknown>;
  const parsed = policy({ ...raw, scope_semantics: raw.scope_semantics ?? "agent_operations_v2" });
  if (parsed.profile_ref !== profileRef || parsed.scope_semantics !== "agent_operations_v2") return fail("managed_access_scope_confirmation_invalid");
  return parsed;
}
function policySnapshot(value: ManagedProfilePolicy): Record<string, unknown> {
  return {
    profile_ref: value.profile_ref,
    allowed_operations: value.allowed_operations,
    allowed_origins: value.allowed_origins,
    controlled_interaction_origins: value.controlled_interaction_origins ?? [],
    scope_semantics: scopeSemantics(value.scope_semantics)
  };
}
function grantSnapshot(value: ManagedGrant): Record<string, unknown> {
  return {
    grant_id: value.grant_id,
    principal_id: value.principal_id,
    profile_refs: value.profile_refs,
    allowed_operations: value.allowed_operations,
    allowed_origins: value.allowed_origins,
    expires_at: value.expires_at,
    revoked_at: value.revoked_at,
    creation_template: value.creation_template,
    max_created_profiles: value.max_created_profiles,
    created_profile_refs: value.created_profile_refs,
    skill_scope: value.skill_scope ?? null,
    ...(value.profile_source_refs === undefined ? {} : { profile_source_refs: value.profile_source_refs }),
    file_scope: value.file_scope ?? null,
    ...(value.business_target_account_scopes === undefined ? {} : { business_target_account_scopes: value.business_target_account_scopes }),
    ...(value.account_system_scope === undefined ? {} : { account_system_scope: value.account_system_scope }),
    ...(value.account_binding_scopes === undefined ? {} : { account_binding_scopes: value.account_binding_scopes }),
    scope_semantics: scopeSemantics(value.scope_semantics)
  };
}
function grantDigest(value: ManagedGrant): string { return hash(canonical(grantSnapshot(value))); }
type ParsedGrant = {
  principal_id: string;
  profile_refs: string[];
  allowed_operations: ManagedOperation[];
  allowed_origins: string[];
  expires_at: string;
  creation_template: ManagedCreationTemplate | null;
  max_created_profiles: number;
  skill_scope?: ManagedSkillScope;
  profile_source_refs?: string[];
  file_scope?: ManagedFileScope;
  account_system_scope?: ManagedAccountSystemScope;
  account_binding_scopes?: ManagedAccountBindingScope[];
};
function grantFields(value: unknown): ParsedGrant {
  const input = object(value, ["principal_id", "profile_refs", "allowed_operations", "allowed_origins", "expires_at", "creation_template", "max_created_profiles"], ["skill_scope", "profile_source_refs", "file_scope", "account_system_scope", "account_binding_scopes"]);
  const parsed = { principal_id: string(input.principal_id), profile_refs: strings(input.profile_refs), allowed_operations: operations(input.allowed_operations),
    allowed_origins: strings(input.allowed_origins, origin), expires_at: timestamp(input.expires_at), creation_template: template(input.creation_template), max_created_profiles: input.max_created_profiles,
    ...(input.skill_scope === undefined ? {} : { skill_scope: skillScope(input.skill_scope) }),
    ...(input.profile_source_refs === undefined ? {} : { profile_source_refs: profileSourceRefs(input.profile_source_refs) }),
    ...(input.file_scope === undefined ? {} : { file_scope: fileScope(input.file_scope) }) } as ParsedGrant;
  if (input.account_system_scope !== undefined) parsed.account_system_scope = accountSystemScope(input.account_system_scope);
  if (input.account_binding_scopes !== undefined) parsed.account_binding_scopes = accountBindingScopes(input.account_binding_scopes);
  if (!Number.isSafeInteger(parsed.max_created_profiles) || parsed.max_created_profiles < 0 || parsed.max_created_profiles > 1024 ||
    (!parsed.creation_template && parsed.max_created_profiles !== 0)) return fail("managed_access_invalid_input");
  if ((parsed.allowed_operations.includes("account_system.import_template") && !parsed.account_system_scope?.template_refs.length) ||
      (parsed.allowed_operations.includes("account.bind") && !parsed.account_binding_scopes?.length) ||
      (parsed.account_system_scope !== undefined && !parsed.allowed_operations.includes("account_system.import_template")) ||
      (parsed.account_binding_scopes !== undefined && (!parsed.allowed_operations.includes("account.bind") || parsed.account_binding_scopes.some(item => !parsed.profile_refs.includes(item.profile_ref))))) return fail("managed_access_invalid_input");
  if (parsed.creation_template && parsed.creation_template.permission_ceiling.scope_semantics === "agent_operations_v2") return fail("managed_access_scope_confirmation_required");
  return parsed;
}
function subset(values: readonly string[], allowed: readonly string[]): boolean { return values.every(value => allowed.includes(value)); }
function operationSubset(values: readonly ManagedOperation[], allowed: readonly ManagedOperation[]): boolean { return values.every(value => allowed.includes(value)); }
function scopeConfirmation(value: unknown, idempotencyKey: string, profileRef: string): { confirmation_ref: string; profile_ref: string } {
  const input = object(value, ["schema_version", "confirmation_ref", "profile_ref", "confirmed_at", "confirmed_by", "idempotency_key", "decision"]);
  if (input.schema_version !== managedScopeConfirmationSchemaVersion || input.confirmed_by !== "owner" || input.decision !== "apply" || input.idempotency_key !== idempotencyKey || input.profile_ref !== profileRef) return fail("managed_access_scope_confirmation_invalid");
  timestamp(input.confirmed_at);
  return { confirmation_ref: string(input.confirmation_ref), profile_ref: string(input.profile_ref) };
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
function ensureV1State(state: State): void {
  if (state.schema_version === "webenvoy.managed-access.v0") state.schema_version = "webenvoy.managed-access.v1";
}

export function createFileManagedAccessStore(options: { directory: string; clock?: () => Date; lockTimeoutMs?: number; withStoppedProfile?: <T>(profileRef: string, operationRef: string, action: () => Promise<T> | T) => Promise<T> }) {
  const path = join(options.directory, "managed-access.json");
  const now = () => (options.clock?.() ?? new Date()).toISOString();
  async function read(): Promise<State> {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Partial<State>;
      if (raw.schema_version !== "webenvoy.managed-access.v0" && raw.schema_version !== "webenvoy.managed-access.v1" && raw.schema_version !== "webenvoy.managed-access.v2") return fail("managed_access_store_invalid");
      if (Object.keys(raw).some(key => !["schema_version", "principals", "connections", "grants", "profile_policies", "receipts"].includes(key))) return fail("managed_access_store_invalid");
      if (![(raw as State).principals, (raw as State).connections, (raw as State).grants, (raw as State).profile_policies, (raw as State).receipts].every(Array.isArray)) return fail("managed_access_store_invalid");
      const state = raw as State;
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
        object(entry, ["grant_id", "principal_id", "profile_refs", "allowed_operations", "allowed_origins", "expires_at", "revoked_at", "creation_template", "max_created_profiles", "created_profile_refs"], ["skill_scope", "profile_source_refs", "file_scope", ...(state.schema_version === "webenvoy.managed-access.v0" ? [] : ["scope_semantics", "account_system_scope", "account_binding_scopes"]), ...(state.schema_version === "webenvoy.managed-access.v2" ? ["business_target_account_scopes"] : [])]);
        string(entry.grant_id); string(entry.principal_id); strings(entry.profile_refs);
        operations(entry.allowed_operations); strings(entry.allowed_origins, origin); timestamp(entry.expires_at); template(entry.creation_template);
        if (state.schema_version === "webenvoy.managed-access.v0" && (Object.hasOwn(entry, "scope_semantics") ||
          (entry.creation_template && Object.hasOwn(entry.creation_template.permission_ceiling, "scope_semantics")))) return fail("managed_access_store_invalid");
        if (entry.scope_semantics !== undefined) scopeSemantics(entry.scope_semantics);
        if (entry.skill_scope !== undefined) skillScope(entry.skill_scope);
        if (entry.profile_source_refs !== undefined) profileSourceRefs(entry.profile_source_refs);
        if (entry.file_scope !== undefined) fileScope(entry.file_scope);
        if (entry.business_target_account_scopes !== undefined) {
          if (state.schema_version !== "webenvoy.managed-access.v2") return fail("managed_access_store_invalid");
          const scopes = businessTargetAccountScopes(entry.business_target_account_scopes);
          if (scopes.some(scope => !entry.profile_refs.includes(scope.profile_ref))) return fail("managed_access_store_invalid");
        }
        const hasBusinessTargetOperation = entry.allowed_operations.some(isBusinessTargetOperation);
        if (hasBusinessTargetOperation !== (entry.business_target_account_scopes !== undefined)) return fail("managed_access_store_invalid");
        if (entry.account_system_scope !== undefined) accountSystemScope(entry.account_system_scope);
        if (entry.account_binding_scopes !== undefined) accountBindingScopes(entry.account_binding_scopes);
        if (entry.revoked_at !== null) timestamp(entry.revoked_at);
        strings(entry.created_profile_refs);
        if (!Number.isSafeInteger(entry.max_created_profiles) || entry.max_created_profiles < entry.created_profile_refs.length ||
          entry.max_created_profiles > 1024 || entry.created_profile_refs.some(ref => !entry.profile_refs.includes(ref))) return fail("managed_access_store_invalid");
      }
      state.profile_policies.forEach(item => {
        if (state.schema_version === "webenvoy.managed-access.v0" && Object.hasOwn(item, "scope_semantics")) return fail("managed_access_store_invalid");
        policy(item);
      });
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
  async function transaction<T>(action: (state: State) => T | Promise<T>): Promise<T> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    return withFileOwnershipLock(`${path}.lock`, options.lockTimeoutMs ?? 5000, async () => {
      const state = await read();
      const result = await action(state);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      return result;
    });
  }
  async function receipt<T>(state: State, method: string, input: Record<string, unknown>, action: () => T | Promise<T>): Promise<T> {
    const keyHash = hash(string(input.idempotency_key));
    const requestHash = hash(canonical({ method, ...input }));
    const previous = state.receipts.find(item => item.key_hash === keyHash);
    if (previous) {
      if (previous.request_hash !== requestHash) return fail("managed_access_idempotency_conflict");
      return previous.result as T;
    }
    const result = await action();
    state.receipts.push({ key_hash: keyHash, request_hash: requestHash, result: structuredClone(result) });
    return result;
  }
  async function completedReceipt<T>(method: string, input: Record<string, unknown>): Promise<T | undefined> {
    const previous = (await read()).receipts.find(item => item.key_hash === hash(string(input.idempotency_key)));
    if (!previous) return undefined;
    if (previous.request_hash !== hash(canonical({ method, ...input }))) return fail("managed_access_idempotency_conflict");
    return previous.result as T;
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
    /** Read-only connection ownership check used by optional capability help. */
    async checkConnection(credentialHash: unknown, connectionId: unknown): Promise<{ principal: ManagedPrincipal; connection: ManagedConnection }> {
      const state = await read(), principal = authenticated(state, credentialHash), id = string(connectionId);
      const connection = state.connections.find(item => item.connection_id === id && item.principal_id === principal.principal_id && item.revoked_at === null);
      if (!connection) return fail("managed_access_connection_unavailable");
      return { principal: publicPrincipal(principal), connection };
    },
    async listAgentGrants(credentialHash: unknown): Promise<ManagedGrant[]> {
      const state = await read(), principal = authenticated(state, credentialHash);
      return state.grants.filter(grant => grant.principal_id === principal.principal_id);
    },
    async connect(credentialHash: unknown): Promise<ManagedConnection> {
      return transaction(state => {
        const principal = authenticated(state, credentialHash);
        const connection = { connection_id: `connection:${randomUUID()}`, principal_id: principal.principal_id, connected_at: now(), revoked_at: null };
        state.connections.push(connection);
        return connection;
      });
    },
    async createGrant(value: unknown): Promise<ManagedGrant> {
      const input = object(value, ["idempotency_key", "principal_id", "profile_refs", "allowed_operations", "allowed_origins", "expires_at", "creation_template", "max_created_profiles"], ["skill_scope", "profile_source_refs", "file_scope", "account_system_scope", "account_binding_scopes"]);
      const parsed = grantFields(Object.fromEntries(Object.keys(input).filter(key => key !== "idempotency_key").map(key => [key, input[key]])));
      if (parsed.allowed_operations.some(isBusinessTargetOperation)) return fail("managed_access_scope_confirmation_required");
      return transaction(state => receipt(state, "createGrant", input, () => {
        if (!state.principals.some(item => item.principal_id === parsed.principal_id && item.revoked_at === null) || Date.parse(parsed.expires_at) <= Date.parse(now())) return fail("managed_access_grant_unavailable");
        if (parsed.account_system_scope !== undefined || parsed.account_binding_scopes !== undefined) ensureV1State(state);
        const grant: ManagedGrant = { ...parsed, max_created_profiles: parsed.max_created_profiles, grant_id: `grant:${randomUUID()}`, revoked_at: null, created_profile_refs: [] };
        state.grants.push(grant);
        return grant;
      }));
    },
    async issueAgentOperationsV2Grant(value: unknown, resolveBusinessTargetAccountScopes?: (profileRef: string, selections: ManagedBusinessTargetAccountSelection[]) => Promise<ManagedBusinessTargetAccountScope[]>): Promise<ManagedGrant> {
      const input = object(value, ["idempotency_key", "principal_id", "profile_refs", "policy_digest", "allowed_operations", "allowed_origins", "expires_at"], ["source_grant_id", "source_grant_digest", "replaces_grant_id", "replaces_grant_digest", "skill_scope", "profile_source_refs", "file_scope", "account_scope_selections", "account_system_scope", "account_binding_scopes"]);
      const principalId = string(input.principal_id), policyDigest = string(input.policy_digest);
      if (!/^[a-f0-9]{64}$/.test(policyDigest)) return fail("managed_access_invalid_input");
      const profileRefs = strings(input.profile_refs);
      if (profileRefs.length !== 1) return fail("managed_access_invalid_input");
      const profileRef = profileRefs[0]!;
      const parsedOperations = operations(input.allowed_operations), parsedOrigins = strings(input.allowed_origins, origin), expiresAt = timestamp(input.expires_at);
      const sourceGrantId = input.source_grant_id === undefined ? undefined : string(input.source_grant_id);
      const sourceGrantDigest = input.source_grant_digest === undefined ? undefined : string(input.source_grant_digest);
      if ((sourceGrantId === undefined) !== (sourceGrantDigest === undefined) || sourceGrantDigest !== undefined && !/^[a-f0-9]{64}$/.test(sourceGrantDigest)) return fail("managed_access_invalid_input");
      const replaceGrantId = input.replaces_grant_id === undefined ? undefined : string(input.replaces_grant_id);
      const replaceGrantDigest = input.replaces_grant_digest === undefined ? undefined : string(input.replaces_grant_digest);
      if ((replaceGrantId === undefined) !== (replaceGrantDigest === undefined) || replaceGrantDigest !== undefined && !/^[a-f0-9]{64}$/.test(replaceGrantDigest)) return fail("managed_access_invalid_input");
      const parsedSkillScope = input.skill_scope === undefined ? undefined : skillScope(input.skill_scope);
      const parsedProfileSourceRefs = input.profile_source_refs === undefined ? undefined : profileSourceRefs(input.profile_source_refs);
      const parsedFileScope = input.file_scope === undefined ? undefined : fileScope(input.file_scope);
      const targetOperationsIncluded = parsedOperations.some(isBusinessTargetOperation);
      const accountScopeSelections = input.account_scope_selections === undefined ? undefined : businessTargetAccountSelections(input.account_scope_selections);
      if (targetOperationsIncluded !== (accountScopeSelections !== undefined)) return fail("managed_access_invalid_input");
      const parsedAccountSystemScope = input.account_system_scope === undefined ? undefined : accountSystemScope(input.account_system_scope);
      const parsedAccountBindingScopes = input.account_binding_scopes === undefined ? undefined : accountBindingScopes(input.account_binding_scopes);
      if (parsedAccountBindingScopes?.some(item => item.profile_ref !== profileRef) ||
          parsedOperations.includes("account.bind") && !parsedAccountBindingScopes?.length ||
          parsedAccountSystemScope !== undefined && !parsedOperations.includes("account_system.import_template") ||
          parsedOperations.includes("account_system.import_template") && !parsedAccountSystemScope?.template_refs.length) return fail("managed_access_scope_confirmation_expands_scope");
      return transaction(state => receipt(state, "issueAgentOperationsV2Grant", input, async () => {
        const sourceGrant = sourceGrantId === undefined ? undefined : state.grants.find(item => item.grant_id === sourceGrantId);
        if (sourceGrantId !== undefined && !sourceGrant) return fail("managed_access_v2_grant_source_invalid");
        if (sourceGrant && (scopeSemantics(sourceGrant.scope_semantics) !== "agent_operations_v2" || !sourceGrant.profile_refs.includes(profileRef) || sourceGrant.principal_id !== principalId)) return fail("managed_access_v2_grant_source_invalid");
        if (sourceGrant && sourceGrantDigest !== undefined && grantDigest(sourceGrant) !== sourceGrantDigest) return fail("managed_access_grant_conflict");
        if (!state.principals.some(item => item.principal_id === principalId && item.revoked_at === null)) return fail("managed_access_authentication_required");
        const profilePolicy = state.profile_policies.find(item => item.profile_ref === profileRef);
        if (!profilePolicy || scopeSemantics(profilePolicy.scope_semantics) !== "agent_operations_v2") return fail("managed_access_scope_confirmation_required");
        if (hash(canonical(policySnapshot(profilePolicy))) !== policyDigest) return fail("managed_access_policy_conflict");
        if (Date.parse(expiresAt) <= Date.parse(now()) || parsedOperations.includes("profile.create") ||
          !operationSubset(parsedOperations, profilePolicy.allowed_operations) || !subset(parsedOrigins, profilePolicy.allowed_origins)) return fail("managed_access_scope_confirmation_expands_scope");
        if (parsedProfileSourceRefs && sourceGrant && !subset(parsedProfileSourceRefs, sourceGrant.profile_source_refs ?? [])) return fail("managed_access_scope_confirmation_expands_scope");
        const replacement = replaceGrantId === undefined ? undefined : state.grants.find(item => item.grant_id === replaceGrantId);
        if (replaceGrantId !== undefined && (!replacement || replacement.principal_id !== principalId || replacement.profile_refs.length !== 1 || replacement.profile_refs[0] !== profileRef || scopeSemantics(replacement.scope_semantics) !== "agent_operations_v2" || sourceGrant && (sourceGrant.profile_refs.length !== 1 || sourceGrant.revoked_at !== null || Date.parse(sourceGrant.expires_at) <= Date.parse(now())) || replacement.revoked_at !== null || Date.parse(replacement.expires_at) <= Date.parse(now()))) return fail("managed_access_v2_grant_replacement_invalid");
        if (replacement && replaceGrantDigest !== undefined && grantDigest(replacement) !== replaceGrantDigest) return fail("managed_access_grant_conflict");
        let businessTargetAccountScopes: ManagedBusinessTargetAccountScope[] | undefined;
        if (targetOperationsIncluded) {
          if (!resolveBusinessTargetAccountScopes || !accountScopeSelections) return fail("managed_access_account_binding_unavailable");
          businessTargetAccountScopes = businessTargetAccountScopesFromOwner(await resolveBusinessTargetAccountScopes(profileRef, accountScopeSelections), profileRef, accountScopeSelections);
        }
        const grant: ManagedGrant = {
          grant_id: `grant:${randomUUID()}`,
          principal_id: principalId,
          profile_refs: [profileRef],
          allowed_operations: parsedOperations,
          allowed_origins: parsedOrigins,
          expires_at: expiresAt,
          revoked_at: null,
          creation_template: null,
          max_created_profiles: 0,
          created_profile_refs: [],
          ...(parsedSkillScope === undefined ? {} : { skill_scope: parsedSkillScope }),
          ...(parsedProfileSourceRefs === undefined ? {} : { profile_source_refs: parsedProfileSourceRefs }),
          ...(parsedFileScope === undefined ? {} : { file_scope: parsedFileScope }),
          ...(businessTargetAccountScopes === undefined ? {} : { business_target_account_scopes: businessTargetAccountScopes }),
          ...(parsedAccountSystemScope === undefined ? {} : { account_system_scope: parsedAccountSystemScope }),
          ...(parsedAccountBindingScopes === undefined ? {} : { account_binding_scopes: parsedAccountBindingScopes }),
          scope_semantics: "agent_operations_v2"
        };
        if (businessTargetAccountScopes === undefined) ensureV1State(state);
        else state.schema_version = "webenvoy.managed-access.v2";
        state.grants.push(grant);
        if (replacement) replacement.revoked_at ??= now();
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
      const input = object(value, ["idempotency_key", "profile_ref", "allowed_operations", "allowed_origins"], ["controlled_interaction_origins"]);
      const { idempotency_key: _key, ...limits } = input;
      const parsed = policy(limits);
      if (parsed.scope_semantics === "agent_operations_v2") return fail("managed_access_scope_confirmation_required");
      return transaction(state => receipt(state, "setProfilePolicy", input, () => {
        const existing = state.profile_policies.find(item => item.profile_ref === parsed.profile_ref);
        // A legacy-shaped owner update must not silently downgrade a v2
        // Profile. A v2-aware owner update is not part of this contract yet.
        if (existing && scopeSemantics(existing.scope_semantics) === "agent_operations_v2") return fail("managed_access_scope_confirmation_required");
        state.profile_policies = state.profile_policies.filter(item => item.profile_ref !== parsed.profile_ref);
        state.profile_policies.push(parsed); return parsed;
      }));
    },
    async updateAgentOperationsV2ProfilePolicy(value: unknown): Promise<ManagedProfilePolicy> {
      const input = object(value, ["idempotency_key", "profile_ref", "current_policy_digest", "allowed_operations", "allowed_origins", "controlled_interaction_origins"]);
      const idempotencyKey = string(input.idempotency_key), profileRef = string(input.profile_ref);
      const currentPolicyDigest = string(input.current_policy_digest);
      if (!/^[a-f0-9]{64}$/.test(currentPolicyDigest)) return fail("managed_access_invalid_input");
      const proposed = v2Policy({ profile_ref: profileRef, allowed_operations: input.allowed_operations, allowed_origins: input.allowed_origins, ...(input.controlled_interaction_origins === undefined ? {} : { controlled_interaction_origins: input.controlled_interaction_origins }) }, profileRef);
      const previous = await completedReceipt<ManagedProfilePolicy>("updateAgentOperationsV2ProfilePolicy", input);
      if (previous !== undefined) return previous;
      if (!options.withStoppedProfile) return fail("managed_access_profile_state_unavailable");
      return options.withStoppedProfile(profileRef, idempotencyKey, () => transaction(state => receipt(state, "updateAgentOperationsV2ProfilePolicy", input, () => {
        const existing = state.profile_policies.find(item => item.profile_ref === profileRef);
        if (!existing || scopeSemantics(existing.scope_semantics) !== "agent_operations_v2") return fail("managed_access_scope_confirmation_required");
        const actualSnapshot = policySnapshot(existing);
        if (hash(canonical(actualSnapshot)) !== currentPolicyDigest) return fail("managed_access_policy_conflict");
        ensureV1State(state);
        state.profile_policies = state.profile_policies.filter(item => item.profile_ref !== profileRef);
        state.profile_policies.push(proposed);
        return proposed;
      })));
    },
    async checkAccess(credentialHash: unknown, value: unknown): Promise<ManagedAccess> {
      const input = object(value, ["connection_id", "grant_id", "operation", "task_scope"], ["profile_ref", "origin", "template_ref", "target_provider_id", "profile_source_ref", "confirmation", "skill_ref", "source_ref", "revision_ref", "file_refs", "account_system_ref", "account_ref", "business_target_ref"]);
      const connectionId = string(input.connection_id), grantId = string(input.grant_id), op = operation(input.operation);
      const profileRef = input.profile_ref === undefined ? undefined : string(input.profile_ref);
      const targetOrigin = input.origin === undefined ? undefined : origin(input.origin);
      const templateRef = input.template_ref === undefined ? undefined : string(input.template_ref);
      const confirmation = input.confirmation === undefined ? undefined : string(input.confirmation);
      if (op === "profile.delete" ? confirmation !== "delete_local_data" : confirmation !== undefined) return fail("managed_access_invalid_input");
      const accountSystemRef = input.account_system_ref === undefined ? undefined : string(input.account_system_ref);
      const accountRef = input.account_ref === undefined ? undefined : string(input.account_ref);
      const targetProviderId = input.target_provider_id === undefined ? undefined : string(input.target_provider_id);
      const skillRef = input.skill_ref === undefined ? undefined : string(input.skill_ref);
      const sourceRef = input.source_ref === undefined ? undefined : string(input.source_ref);
      const profileSourceRef = input.profile_source_ref === undefined ? undefined : string(input.profile_source_ref);
      if (profileSourceRef !== undefined && profileSourceRefs([profileSourceRef]).length !== 1) return fail("managed_access_invalid_input");
      const revisionRef = input.revision_ref === undefined ? undefined : string(input.revision_ref);
      const requestedFileRefs = input.file_refs === undefined ? undefined : fileRefs(input.file_refs);
      const requestedAccountSystemRef = input.account_system_ref === undefined ? undefined : string(input.account_system_ref);
      const requestedAccountRef = input.account_ref === undefined ? undefined : string(input.account_ref);
      const businessTargetRef = input.business_target_ref === undefined ? undefined : string(input.business_target_ref);
      const businessTargetOperation = isBusinessTargetOperation(op);
      const accountBind = op === "account.bind";
      if ((requestedAccountSystemRef !== undefined || requestedAccountRef !== undefined || businessTargetRef !== undefined) && !businessTargetOperation && !accountBind) return fail("managed_access_invalid_input");
      if ((requestedAccountSystemRef === undefined) !== (requestedAccountRef === undefined)) return fail("managed_access_invalid_input");
      if (requestedAccountSystemRef !== undefined && !businessTargetAccountSystemRef.test(requestedAccountSystemRef) || requestedAccountRef !== undefined && !businessTargetAccountRef.test(requestedAccountRef)) return fail("managed_access_invalid_input");
      if (businessTargetOperation && (["business_target.create", "business_target.list"].includes(op)
        ? requestedAccountSystemRef === undefined || requestedAccountRef === undefined || businessTargetRef !== undefined
        : businessTargetRef === undefined || requestedAccountSystemRef !== undefined || requestedAccountRef !== undefined)) return fail("managed_access_invalid_input");
      const skillOperation = (managedSkillOperations as readonly string[]).includes(op);
      const taskOperation = (managedTaskOperations as readonly string[]).includes(op);
      const profileTransferOperation = op === "profile.import" || op === "profile.migrate.request";
      const accountSystemImport = op === "account_system.import_template";
      const scope = accountSystemImport
        ? object(input.task_scope, ["operations", "template_refs"])
        : skillOperation
        ? object(input.task_scope, ["operations", "skill_refs", "source_refs"], ["file_refs"])
        : profileTransferOperation
          ? object(input.task_scope, ["operations", "profile_refs", "origins", "profile_source_refs"])
        : taskOperation
          ? object(input.task_scope, ["operations", "skill_refs", "source_refs", "profile_refs", "origins"])
          : accountBind
            ? object(input.task_scope, ["operations", "profile_refs", "origins", "account_binding_scopes"])
            : object(input.task_scope, ["operations", "profile_refs", "origins"], ["file_refs"]);
      const task = (accountSystemImport
        ? { operations: operations(scope.operations), profile_refs: [] as string[], origins: [] as string[], template_refs: strings(scope.template_refs, value => {
          const ref = string(value);
          if (!/^lode:\/\/account-system\/[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+$/.test(ref)) return fail("managed_access_invalid_input");
          return ref;
        }) }
        : skillOperation
        ? { operations: operations(scope.operations), profile_refs: [] as string[], origins: [] as string[], ...(scope.file_refs === undefined ? {} : { file_refs: fileRefs(scope.file_refs) }), skill_refs: strings(scope.skill_refs), source_refs: strings(scope.source_refs) }
        : taskOperation
          ? { operations: operations(scope.operations), profile_refs: strings(scope.profile_refs), origins: strings(scope.origins, origin), skill_refs: strings(scope.skill_refs), source_refs: strings(scope.source_refs) }
          : profileTransferOperation
            ? { operations: operations(scope.operations), profile_refs: strings(scope.profile_refs), origins: strings(scope.origins, origin), profile_source_refs: profileSourceRefs(scope.profile_source_refs) }
          : { operations: operations(scope.operations), profile_refs: strings(scope.profile_refs), origins: strings(scope.origins, origin),
            ...(scope.file_refs === undefined ? {} : { file_refs: fileRefs(scope.file_refs) }),
            ...(scope.account_binding_scopes === undefined ? {} : { account_binding_scopes: accountBindingScopes(scope.account_binding_scopes) }) }) as ManagedTaskScope;
      const state = await read(), principal = authenticated(state, credentialHash);
      const connection = state.connections.find(item => item.connection_id === connectionId && item.principal_id === principal.principal_id && item.revoked_at === null);
      if (!connection) return fail("managed_access_connection_unavailable");
      const grant = activeGrant(state, grantId);
      if (grant.principal_id !== principal.principal_id || !grant.allowed_operations.includes(op) || !task.operations.includes(op)) return fail("managed_access_denied");
      const grantScope = scopeSemantics(grant.scope_semantics);
      const result: ManagedAccess = { principal: publicPrincipal(principal), connection, grant, authorized_origins: [], scope_semantics: grantScope };
      if (businessTargetOperation) {
        if (grantScope !== "agent_operations_v2" || !grant.business_target_account_scopes?.some(scope => scope.profile_ref === profileRef) ||
            targetOrigin !== undefined || templateRef !== undefined || requestedFileRefs !== undefined || skillRef !== undefined || sourceRef !== undefined || revisionRef !== undefined || task.origins.length !== 0) return fail("managed_access_denied");
        if (requestedAccountSystemRef !== undefined && requestedAccountRef !== undefined &&
            !grant.business_target_account_scopes.some(scope => scope.profile_ref === profileRef && scope.account_system_ref === requestedAccountSystemRef && scope.account_ref === requestedAccountRef)) return fail("managed_access_denied");
      }
      if (skillOperation) {
        const taskSkillRefs = task.skill_refs ?? [], taskSourceRefs = task.source_refs ?? [], grantSkillScope = grant.skill_scope;
        if (profileRef !== undefined || targetOrigin !== undefined || templateRef !== undefined || !grantSkillScope) return fail("managed_access_denied");
        if (taskSkillRefs.some(ref => !grantSkillScope.skill_refs.includes(ref)) || taskSourceRefs.some(ref => !grantSkillScope.source_refs.includes(ref)) ||
          revisionRef !== undefined && (!grantSkillScope.source_refs.includes(revisionRef) || !taskSourceRefs.includes(revisionRef)) ||
          skillRef !== undefined && (!grantSkillScope.skill_refs.includes(skillRef) || !taskSkillRefs.includes(skillRef)) ||
          sourceRef !== undefined && (!grantSkillScope.source_refs.includes(sourceRef) || !taskSourceRefs.includes(sourceRef))) return fail("managed_access_denied");
        if (skillRef === undefined && (sourceRef !== undefined || revisionRef !== undefined)) return fail("managed_access_invalid_input");
        return result;
      }
      if (accountSystemImport) {
        const templateRefs = task.template_refs ?? [];
        const approvedRefs = grant.account_system_scope?.template_refs ?? [];
        if (!templateRef || profileRef !== undefined || targetOrigin !== undefined || accountSystemRef !== undefined || accountRef !== undefined || skillRef !== undefined || sourceRef !== undefined || revisionRef !== undefined ||
            task.operations.length !== 1 || task.operations[0] !== op || templateRefs.length !== 1 ||
            task.profile_refs.length !== 0 || task.origins.length !== 0 || task.account_binding_scopes !== undefined ||
            !templateRefs.includes(templateRef) || !approvedRefs.includes(templateRef)) return fail("managed_access_denied");
        return result;
      }
      if (taskOperation) {
        const taskSkillRefs = task.skill_refs ?? [], taskSourceRefs = task.source_refs ?? [], grantSkillScope = grant.skill_scope;
        if (!grantSkillScope || taskSkillRefs.some(ref => !grantSkillScope.skill_refs.includes(ref)) ||
          taskSourceRefs.some(ref => !grantSkillScope.source_refs.includes(ref)) ||
          skillRef === undefined || sourceRef === undefined || revisionRef !== undefined ||
          !grantSkillScope.skill_refs.includes(skillRef) || !taskSkillRefs.includes(skillRef) ||
          !grantSkillScope.source_refs.includes(sourceRef) || !taskSourceRefs.includes(sourceRef) ||
          requestedFileRefs !== undefined || task.file_refs !== undefined || templateRef !== undefined) return fail("managed_access_denied");
      }
      if (!taskOperation && (skillRef !== undefined || sourceRef !== undefined || revisionRef !== undefined)) return fail("managed_access_invalid_input");
      if (!accountBind && !businessTargetOperation && (accountSystemRef !== undefined || accountRef !== undefined || task.account_binding_scopes !== undefined || task.template_refs !== undefined)) return fail("managed_access_invalid_input");
      if (profileTransferOperation && (skillRef !== undefined || sourceRef !== undefined || revisionRef !== undefined || requestedFileRefs !== undefined || task.file_refs !== undefined)) return fail("managed_access_invalid_input");
      if (requestedFileRefs !== undefined && ![...requestedFileRefs].every(ref => (task.file_refs ?? []).includes(ref))) return fail("managed_access_denied");
      if (managedFileOperations.includes(op as typeof managedFileOperations[number])) {
        const filePermission = grant.file_scope;
        if (!filePermission) return fail("managed_access_file_scope_required");
        if (task.file_refs === undefined) return fail("managed_access_file_scope_required");
        if (op === "file.upload") {
          if (!profileRef || requestedFileRefs?.length !== 1 || !filePermission.upload_refs.includes(requestedFileRefs[0]!)) return fail("managed_access_file_ref_denied");
        } else if (requestedFileRefs === undefined || requestedFileRefs.length !== 0 || task.file_refs.length !== 0) return fail("managed_access_file_ref_denied");
      } else if (requestedFileRefs !== undefined || task.file_refs !== undefined) return fail("managed_access_invalid_input");
      if (["provider.preference.read", "provider.preference.set", "provider.preference.clear"].includes(op)) {
        if (profileRef !== undefined || targetOrigin !== undefined || templateRef !== undefined || task.profile_refs.length || task.origins.length) return fail("managed_access_denied");
        return result;
      }
      if (op === "profile.create" || op === "profile.import") {
        if (profileRef || !grant.creation_template || templateRef !== grant.creation_template.template_ref || grant.created_profile_refs.length >= grant.max_created_profiles) return fail("managed_access_creation_denied");
        const creationOrigin = grant.creation_template.site.origin;
        if ((targetOrigin !== undefined && targetOrigin !== creationOrigin) || !grant.allowed_origins.includes(creationOrigin) || !task.origins.includes(creationOrigin)) return fail("managed_access_denied");
        if (op === "profile.import") {
          const authorizedSources = grant.profile_source_refs ?? [];
          if (!profileSourceRef || task.profile_refs.length !== 0 || task.profile_source_refs?.length !== 1 || task.profile_source_refs[0] !== profileSourceRef || !authorizedSources.includes(profileSourceRef)) return fail("managed_access_denied");
        } else if (profileSourceRef !== undefined || task.profile_source_refs?.length) return fail("managed_access_invalid_input");
        return { ...result, creation_template: grant.creation_template };
      }
      if (op === "profile.migrate.request") {
        if (!profileRef || !grant.profile_refs.includes(profileRef) || !task.profile_refs.includes(profileRef) || task.profile_refs.length !== 1 || task.origins.length !== 0 || !templateRef || !targetProviderId || !grant.creation_template || grant.creation_template.template_ref !== templateRef || grant.creation_template.provider_id !== targetProviderId || targetOrigin !== undefined || profileSourceRef !== undefined || task.profile_source_refs?.length) return fail("managed_access_denied");
        const profile = state.profile_policies.find(item => item.profile_ref === profileRef);
        if (!profile || !profile.allowed_operations.includes(op)) return fail("managed_access_denied");
        if (!profileScopeIndependentReads.includes(op) && scopeSemantics(profile.scope_semantics) !== grantScope) return fail("managed_access_scope_semantics_mismatch");
        return { ...result, creation_template: grant.creation_template, profile_policy: profile };
      }
      if (targetProviderId !== undefined || profileSourceRef !== undefined || task.profile_source_refs?.length) return fail("managed_access_invalid_input");
      if (op === "profile.copy_environment") {
        if (!profileRef || !grant.creation_template || templateRef !== grant.creation_template.template_ref || grant.created_profile_refs.length >= grant.max_created_profiles ||
          targetOrigin !== undefined || task.origins.length !== 0 || task.profile_refs.length !== 1 || task.profile_refs[0] !== profileRef) return fail("managed_access_creation_denied");
        if (!grant.profile_refs.includes(profileRef)) return fail("managed_access_denied");
      } else if (templateRef !== undefined) return fail("managed_access_invalid_input");
      if (op === "profile.list" && profileRef === undefined) {
        return { ...result, authorized_origins: [...new Set(task.origins.filter(item => grant.allowed_origins.includes(item)))], grant: { ...grant, profile_refs: grant.profile_refs.filter(ref => task.profile_refs.includes(ref) && state.profile_policies.some(item => item.profile_ref === ref && item.allowed_operations.includes(op) && (profileScopeIndependentReads.includes(op) || scopeSemantics(item.scope_semantics) === grantScope))) } };
      }
      if (!profileRef || !grant.profile_refs.includes(profileRef) || !task.profile_refs.includes(profileRef)) return fail("managed_access_denied");
      const profile = state.profile_policies.find(item => item.profile_ref === profileRef);
      if (!profile || !profile.allowed_operations.includes(op)) return fail("managed_access_denied");
      // Read-only Profile/recovery metadata remains available through the
      // historical Grant. Only browser execution (and recovery mutations)
      // requires the Grant/Profile semantics pair.
      if (!profileScopeIndependentReads.includes(op) && scopeSemantics(profile.scope_semantics) !== grantScope) return fail("managed_access_scope_semantics_mismatch");
      if (op === "profile.metadata.update" && (targetOrigin !== undefined || task.origins.length !== 0)) return fail("managed_access_denied");
      if (businessTargetOperation && task.origins.length !== 0) return fail("managed_access_denied");
      if (["profile.archive", "profile.delete"].includes(op) && (targetOrigin !== undefined || task.origins.length !== 0 || task.profile_refs.length !== 1 || task.profile_refs[0] !== profileRef)) return fail("managed_access_denied");
      const authorized_origins = [...new Set(grant.allowed_origins.filter(item => profile.allowed_origins.includes(item) && task.origins.includes(item)))];
      if (targetOrigin !== undefined && !authorized_origins.includes(targetOrigin)) return fail("managed_access_denied");
      if (accountBind) {
        const tuple = { profile_ref: profileRef, account_system_ref: accountSystemRef, account_ref: accountRef };
        const taskBindingScopes = task.account_binding_scopes ?? [];
        if (!accountSystemRef || !accountRef || task.operations.length !== 1 || task.operations[0] !== op ||
            task.profile_refs.length !== 1 || task.profile_refs[0] !== profileRef || !targetOrigin || task.origins.length !== 1 || task.origins[0] !== targetOrigin ||
            taskBindingScopes.length !== 1 || canonical(taskBindingScopes[0]) !== canonical(tuple) ||
            !(grant.account_binding_scopes ?? []).some(item => canonical(item) === canonical(tuple))) return fail("managed_access_denied");
      }
      if (["instance.start", "instance.observe", "instance.diagnostics", "environment.read", "environment.update", "instance.navigate", "instance.read", "account.bind", "page.open", "page.navigate", ...managedInteractionOperations, ...managedFileOperations, ...managedTaskOperations].includes(op) && targetOrigin === undefined) return fail("managed_access_origin_required");
      if ((managedInteractionOperations as readonly string[]).includes(op) && (!targetOrigin || !profile.controlled_interaction_origins?.includes(targetOrigin))) return fail("managed_access_controlled_origin_required");
      return { ...result, profile_policy: profile, authorized_origins,
        ...(op === "profile.copy_environment" ? { creation_template: grant.creation_template! } : {}) };
    },
    /**
     * Owner-only, one-time migration of a stopped Profile to the v2 scope
     * semantics. The source Grant is never edited (or revived); the new Grant
     * and policy are constrained to the source intersection in one transaction.
     */
    async confirmAgentOperationsV2(value: unknown): Promise<ManagedScopeTransitionResult> {
      const input = object(value, ["idempotency_key", "source_grant_id", "profile_ref", "confirmation", "new_grant", "new_profile_policy"]);
      const idempotencyKey = string(input.idempotency_key), sourceGrantId = string(input.source_grant_id), profileRef = string(input.profile_ref);
      const confirmation = scopeConfirmation(input.confirmation, idempotencyKey, profileRef);
      const newGrant = grantFields(input.new_grant);
      if (newGrant.allowed_operations.some(isBusinessTargetOperation)) return fail("managed_access_scope_confirmation_required");
      if (!input.new_profile_policy || typeof input.new_profile_policy !== "object" || Array.isArray(input.new_profile_policy)) return fail("managed_access_invalid_input");
      const rawPolicy = input.new_profile_policy as Record<string, unknown>;
      if (Object.hasOwn(rawPolicy, "scope_semantics")) return fail("managed_access_scope_confirmation_invalid");
      const newPolicy = policy(rawPolicy);
      if (newPolicy.profile_ref !== profileRef || scopeSemantics(newPolicy.scope_semantics) !== "legacy_request_guard_v1") return fail("managed_access_scope_confirmation_invalid");
      const previous = await completedReceipt<ManagedScopeTransitionResult>("confirmAgentOperationsV2", input);
      if (previous !== undefined) return previous;
      if (!options.withStoppedProfile) return fail("managed_access_profile_state_unavailable");
      return options.withStoppedProfile(profileRef, idempotencyKey, () => transaction(state => receipt(state, "confirmAgentOperationsV2", input, async () => {
          const confirmationConsumed = state.receipts.some(item => {
            const result = item.result;
            return Boolean(result && typeof result === "object" && !Array.isArray(result) &&
              (result as Record<string, unknown>).scope_semantics === "agent_operations_v2" &&
              (result as Record<string, unknown>).confirmation_ref === confirmation.confirmation_ref);
          });
          if (confirmationConsumed) return fail("managed_access_scope_confirmation_consumed");
          const sourceGrant = state.grants.find(item => item.grant_id === sourceGrantId);
          const sourcePolicy = state.profile_policies.find(item => item.profile_ref === profileRef);
          if (!sourceGrant || sourceGrant.revoked_at !== null || Date.parse(sourceGrant.expires_at) <= Date.parse(now()) || !sourcePolicy || scopeSemantics(sourceGrant.scope_semantics) !== "legacy_request_guard_v1" || scopeSemantics(sourcePolicy.scope_semantics) !== "legacy_request_guard_v1" ||
            !sourceGrant.profile_refs.includes(profileRef) || sourceGrant.principal_id !== newGrant.principal_id) return fail("managed_access_scope_confirmation_source_invalid");
          if (!state.principals.some(item => item.principal_id === newGrant.principal_id && item.revoked_at === null)) return fail("managed_access_authentication_required");
          if (newGrant.profile_refs.length !== 1 || newGrant.profile_refs[0] !== profileRef || newGrant.creation_template !== null || newGrant.max_created_profiles !== 0 || newGrant.allowed_operations.includes("profile.create") ||
            !operationSubset(newGrant.allowed_operations, sourceGrant.allowed_operations) || !operationSubset(newGrant.allowed_operations, newPolicy.allowed_operations) || !subset(newGrant.allowed_origins, sourceGrant.allowed_origins) || !subset(newGrant.allowed_origins, newPolicy.allowed_origins) || Date.parse(newGrant.expires_at) > Date.parse(sourceGrant.expires_at) || Date.parse(newGrant.expires_at) <= Date.parse(now()) ||
            !operationSubset(newPolicy.allowed_operations, sourcePolicy.allowed_operations) || !subset(newPolicy.allowed_origins, sourcePolicy.allowed_origins) ||
            newPolicy.controlled_interaction_origins?.some(item => !sourcePolicy.controlled_interaction_origins?.includes(item)) ||
            !subset(newGrant.allowed_origins, newPolicy.allowed_origins)) return fail("managed_access_scope_confirmation_expands_scope");
          if (newGrant.skill_scope && (!sourceGrant.skill_scope || !subset(newGrant.skill_scope.skill_refs, sourceGrant.skill_scope.skill_refs) || !subset(newGrant.skill_scope.source_refs, sourceGrant.skill_scope.source_refs))) return fail("managed_access_scope_confirmation_expands_scope");
          if (newGrant.profile_source_refs && !subset(newGrant.profile_source_refs, sourceGrant.profile_source_refs ?? [])) return fail("managed_access_scope_confirmation_expands_scope");
          if (newGrant.file_scope && (!sourceGrant.file_scope || !subset(newGrant.file_scope.upload_refs, sourceGrant.file_scope.upload_refs) || !subset(newGrant.file_scope.allowed_mime_types, sourceGrant.file_scope.allowed_mime_types) || newGrant.file_scope.max_file_bytes > sourceGrant.file_scope.max_file_bytes)) return fail("managed_access_scope_confirmation_expands_scope");
          if (newGrant.account_system_scope && (!sourceGrant.account_system_scope || !subset(newGrant.account_system_scope.template_refs, sourceGrant.account_system_scope.template_refs))) return fail("managed_access_scope_confirmation_expands_scope");
          if (newGrant.account_binding_scopes && (!sourceGrant.account_binding_scopes || newGrant.account_binding_scopes.some(item => !sourceGrant.account_binding_scopes!.some(source => canonical(source) === canonical(item))))) return fail("managed_access_scope_confirmation_expands_scope");
          ensureV1State(state);
          const grant: ManagedGrant = { ...newGrant, grant_id: `grant:${randomUUID()}`, revoked_at: null, created_profile_refs: [], scope_semantics: "agent_operations_v2" };
          const profilePolicy: ManagedProfilePolicy = { ...newPolicy, scope_semantics: "agent_operations_v2" };
          state.grants.push(grant);
          state.profile_policies = state.profile_policies.filter(item => item.profile_ref !== profileRef);
          state.profile_policies.push(profilePolicy);
        return { scope_semantics: "agent_operations_v2" as const, source_grant_id: sourceGrantId, confirmation_ref: confirmation.confirmation_ref, grant, profile_policy: profilePolicy };
      })));
    },
    // The caller coordinates Harbor creation with its existing operation/idempotency owner.
    // This short transaction registers the result; it does not reserve quota before a side effect.
    async recordCreatedProfile(value: unknown): Promise<ManagedProfilePolicy> {
      const input = object(value, ["idempotency_key", "grant_id", "profile_ref"], ["operation", "source_profile_ref", "source_policy_snapshot"]), grantId = string(input.grant_id), profileRef = string(input.profile_ref);
      const profileOperation = input.operation === undefined ? "profile.create" : operation(input.operation);
      if (profileOperation !== "profile.create" && profileOperation !== "profile.copy_environment") return fail("managed_access_invalid_input");
      const sourcePolicySnapshot = profileOperation === "profile.copy_environment" ? policy(input.source_policy_snapshot) : undefined;
      if (profileOperation === "profile.copy_environment" && sourcePolicySnapshot?.profile_ref !== string(input.source_profile_ref)) return fail("managed_access_invalid_input");
      return transaction(state => receipt(state, "recordCreatedProfile", input, () => {
        const grant = state.grants.find(item => item.grant_id === grantId);
        if (!grant || !grant.creation_template || !grant.allowed_operations.includes(profileOperation) || grant.created_profile_refs.length >= grant.max_created_profiles ||
          state.profile_policies.some(item => item.profile_ref === profileRef)) return fail("managed_access_creation_denied");
        grant.created_profile_refs.push(profileRef);
        if (!grant.profile_refs.includes(profileRef)) grant.profile_refs.push(profileRef);
        let profile: ManagedProfilePolicy;
        if (profileOperation === "profile.copy_environment") {
          const sourceProfileRef = string(input.source_profile_ref);
          const source = sourcePolicySnapshot;
          if (!source || !grant.profile_refs.includes(sourceProfileRef) || !source.allowed_operations.includes(profileOperation)) return fail("managed_access_creation_denied");
          const templateCeiling = grant.creation_template.permission_ceiling;
          profile = {
            profile_ref: profileRef,
            allowed_operations: source.allowed_operations.filter(item => templateCeiling.allowed_operations.includes(item) && grant.allowed_operations.includes(item)),
            allowed_origins: source.allowed_origins.filter(item => templateCeiling.allowed_origins.includes(item) && grant.allowed_origins.includes(item)),
            controlled_interaction_origins: (source.controlled_interaction_origins ?? []).filter(item =>
              templateCeiling.allowed_origins.includes(item) &&
              source.allowed_origins.includes(item) &&
              (templateCeiling.controlled_interaction_origins ?? []).includes(item) &&
              grant.allowed_origins.includes(item)),
            ...(state.schema_version !== "webenvoy.managed-access.v0" ? { scope_semantics: scopeSemantics(source.scope_semantics) } : {})
          };
        } else {
          profile = { profile_ref: profileRef, ...structuredClone(grant.creation_template.permission_ceiling) };
        }
        state.profile_policies.push(profile); return profile;
      }));
    },
    async getOwnerOperation(key: string) {
      const entry = (await read()).receipts.find(item => item.key_hash === hash(string(key)));
      return entry ? { status: "completed" as const, result: entry.result } : undefined;
    },
    async list() {
      const state = await read();
      return {
        principals: state.principals.map(publicPrincipal),
        connections: state.connections,
        grants: state.grants.map(item => ({ ...item, grant_digest: grantDigest(item) })),
        profile_policies: state.profile_policies.map(item => ({ ...item, policy_digest: hash(canonical(policySnapshot(item))) }))
      };
    }
  };
}
export type FileManagedAccessStore = ReturnType<typeof createFileManagedAccessStore>;
