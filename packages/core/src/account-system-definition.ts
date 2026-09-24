import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError } from "./managed-access.js";

type JsonObject = Record<string, unknown>;

export const accountSystemDefinitionStoreSchemaVersion = "webenvoy.account-system-definitions.v1" as const;
export const approvedAccountSystemTemplates = {
  "lode://account-system/github@1.0.0": {
    version: "1.0.0",
    path: "account-systems/github/1.0.0.json",
    sha256: "sha256:8b022fc329a6f75887e465ab561c83ba74d2ab2af1ef0e51a41f3d06b1b4c777"
  }
} as const;

export type AccountSystemTemplate = {
  schema_version: "lode.account-system-template.v1";
  template_ref: string;
  account_system_id: string;
  version: string;
  display_name: string;
  related_domains: string[];
  products: string[];
  login_entry: { label: string; url: string };
  admin_entry_points: Array<{ label: string; url: string }>;
  identity_method?: { method_ref: string; description: string; evidence_refs: string[] };
  known_shared_login_relationships: Array<{ system_ref: string; relationship: string; evidence_refs: string[] }>;
  source: { publisher: string; repository: string; path: string; version: string; evidence_refs: string[] };
};

type TemplatePin = { template_ref: string; template_sha256: string; source: AccountSystemTemplate["source"] };
type StoredRevision = {
  revision_ref: string;
  definition_sha256: string;
  template_ref: string;
  template_sha256: string;
  base_revision_ref: string | null;
  created_at: string;
  definition: AccountSystemTemplate;
};
type StoredDefinition = {
  local_definition_ref: string;
  account_system_id: string;
  enabled: boolean;
  enabled_revision_ref: string | null;
  record_version: number;
  revisions: StoredRevision[];
};
type StoredDraft = {
  draft_ref: string;
  local_definition_ref: string;
  base_revision_ref: string;
  template_ref: string;
  template_sha256: string;
  template_source: AccountSystemTemplate["source"];
  definition: AccountSystemTemplate;
  created_at: string;
  updated_at: string;
  pinned_revision_ref: string | null;
};
type AccountSystemState = {
  schema_version: typeof accountSystemDefinitionStoreSchemaVersion;
  definitions: StoredDefinition[];
  drafts: StoredDraft[];
};

export class AccountSystemDefinitionError extends ManagedAccessError {
  constructor(code: string) { super(code); }
}

const fail = (code: string): never => { throw new AccountSystemDefinitionError(code); };
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const maxTemplateBytes = 256 * 1024;
const localDefinitionPattern = /^webenvoy:account-system\/([0-9a-f-]{36})$/;
const revisionPattern = /^webenvoy:account-system-revision\/([0-9a-f-]{36})@([1-9][0-9]*)#sha256:([a-f0-9]{64})$/;
const draftPattern = /^webenvoy:account-system-draft\/([0-9a-f-]{36})$/;
const semverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const templateRefPattern = /^lode:\/\/account-system\/[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+$/;

function isObject(value: unknown): value is JsonObject { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function exactObject(value: unknown, required: string[], optional: string[] = []): JsonObject {
  if (!isObject(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) return fail("account_system_template_corrupt");
  return value;
}
function string(value: unknown, code = "account_system_template_corrupt"): string {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail(code);
  return value;
}
function strings(value: unknown, minItems: number, code = "account_system_template_corrupt"): string[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > 256) return fail(code);
  const result = value.map(item => string(item, code));
  if (new Set(result).size !== result.length) return fail(code);
  return result;
}
function absoluteUri(value: unknown, code = "account_system_template_corrupt"): string {
  const result = string(value, code);
  try { if (!new URL(result).protocol) return fail(code); }
  catch { return fail(code); }
  return result;
}
function httpsUrl(value: unknown): string {
  const result = string(value);
  try {
    const url = new URL(result);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return fail("account_system_template_corrupt");
  } catch { return fail("account_system_template_corrupt"); }
  return result;
}
function hostname(value: unknown): string {
  const result = string(value);
  if (result.length > 253 || result !== result.toLowerCase() || result.split(".").some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return fail("account_system_template_corrupt");
  return result;
}
function entryPoint(value: unknown): { label: string; url: string } {
  const item = exactObject(value, ["label", "url"]);
  return { label: string(item.label), url: httpsUrl(item.url) };
}
function validateTemplate(value: unknown, expectedTemplateRef?: string, options: { allowLocalVersion?: boolean } = {}): AccountSystemTemplate {
  const item = exactObject(value,
    ["schema_version", "template_ref", "account_system_id", "version", "display_name", "related_domains", "products", "login_entry", "admin_entry_points", "known_shared_login_relationships", "source"],
    ["identity_method"]);
  const templateRef = string(item.template_ref);
  const id = string(item.account_system_id);
  const version = string(item.version);
  if (item.schema_version !== "lode.account-system-template.v1" || !templateRefPattern.test(templateRef) ||
      expectedTemplateRef !== undefined && templateRef !== expectedTemplateRef || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || !semverPattern.test(version) ||
      !/^lode:\/\/account-system\/[a-z0-9][a-z0-9._-]*@/.test(templateRef) || !options.allowLocalVersion && !templateRef.endsWith(`@${version}`)) return fail("account_system_template_corrupt");
  if (typeof item.display_name !== "string" || item.display_name.length < 1 || item.display_name.length > 256) return fail("account_system_template_corrupt");
  const domains = (Array.isArray(item.related_domains) ? item.related_domains : []).map(hostname);
  if (domains.length < 1 || domains.length > 128 || new Set(domains).size !== domains.length) return fail("account_system_template_corrupt");
  const products = strings(item.products, 1);
  if (products.some(value => value.length > 256)) return fail("account_system_template_corrupt");
  const loginEntry = entryPoint(item.login_entry);
  if (!Array.isArray(item.admin_entry_points) || item.admin_entry_points.length > 128) return fail("account_system_template_corrupt");
  const adminEntries = item.admin_entry_points.map(entryPoint);
  const relationships = item.known_shared_login_relationships;
  if (!Array.isArray(relationships) || relationships.length > 128) return fail("account_system_template_corrupt");
  const sharedRelationships = relationships.map(value => {
    const entry = exactObject(value, ["system_ref", "relationship", "evidence_refs"]);
    const systemRef = string(entry.system_ref);
    if (!templateRefPattern.test(systemRef)) return fail("account_system_template_corrupt");
    return { system_ref: systemRef, relationship: string(entry.relationship), evidence_refs: strings(entry.evidence_refs, 1) };
  });
  let identityMethod: AccountSystemTemplate["identity_method"];
  if (item.identity_method !== undefined) {
    const method = exactObject(item.identity_method, ["method_ref", "description", "evidence_refs"]);
    identityMethod = { method_ref: string(method.method_ref), description: string(method.description), evidence_refs: strings(method.evidence_refs, 1).map(value => absoluteUri(value)) };
  }
  const source = exactObject(item.source, ["publisher", "repository", "path", "version", "evidence_refs"]);
  const sourceVersion = string(source.version);
  const sourceVersionMismatch = !semverPattern.test(sourceVersion) || (options.allowLocalVersion
    ? !templateRef.endsWith(`@${sourceVersion}`)
    : sourceVersion !== version);
  if (sourceVersionMismatch) return fail("account_system_template_corrupt");
  const validatedSource = {
    publisher: string(source.publisher), repository: string(source.repository), path: string(source.path), version: sourceVersion,
    evidence_refs: strings(source.evidence_refs, 1).map(value => absoluteUri(value))
  };
  return {
    schema_version: "lode.account-system-template.v1", template_ref: templateRef, account_system_id: id, version,
    display_name: item.display_name, related_domains: domains, products, login_entry: loginEntry, admin_entry_points: adminEntries,
    ...(identityMethod === undefined ? {} : { identity_method: identityMethod }),
    known_shared_login_relationships: sharedRelationships, source: validatedSource
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function nonSensitiveText(value: unknown, code = "account_system_invalid_input"): string { return string(value, code); }
function revisionRef(value: unknown): string {
  const ref = string(value, "account_system_invalid_input");
  if (!revisionPattern.test(ref)) return fail("account_system_invalid_input");
  return ref;
}
function localRef(value: unknown): string {
  const ref = string(value, "account_system_invalid_input");
  if (!localDefinitionPattern.test(ref)) return fail("account_system_invalid_input");
  return ref;
}
function draftRef(value: unknown): string {
  const ref = string(value, "account_system_invalid_input");
  if (!draftPattern.test(ref)) return fail("account_system_invalid_input");
  return ref;
}
function recordVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail("account_system_invalid_input");
  return Number(value);
}
function timestamp(value: unknown): string {
  const text = string(value, "account_system_store_invalid");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) return fail("account_system_store_invalid");
  return text;
}
function makeRevisionRef(localDefinitionRef: string, sequence: number, snapshot: unknown): string {
  const uuid = localDefinitionPattern.exec(localDefinitionRef)?.[1];
  if (!uuid) return fail("account_system_store_invalid");
  return `webenvoy:account-system-revision/${uuid}@${sequence}#sha256:${digest(canonical(snapshot))}`;
}
function revisionSnapshot(input: Pick<StoredRevision, "definition" | "template_ref" | "template_sha256" | "base_revision_ref">): unknown {
  return { definition: input.definition, template_ref: input.template_ref, template_sha256: input.template_sha256, base_revision_ref: input.base_revision_ref };
}
function parseRevision(value: unknown, localDefinitionRef: string, sequence: number): StoredRevision {
  const item = exactObject(value, ["revision_ref", "definition_sha256", "template_ref", "template_sha256", "base_revision_ref", "created_at", "definition"]);
  const definition = validateTemplate(item.definition, string(item.template_ref, "account_system_store_invalid"), { allowLocalVersion: true });
  const templateSha256 = string(item.template_sha256, "account_system_store_invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(templateSha256) || item.base_revision_ref !== null && typeof item.base_revision_ref !== "string") return fail("account_system_store_invalid");
  const revision = { definition, template_ref: definition.template_ref, template_sha256: templateSha256, base_revision_ref: item.base_revision_ref as string | null };
  const ref = makeRevisionRef(localDefinitionRef, sequence, revisionSnapshot(revision));
  const definitionSha256 = `sha256:${digest(canonical(definition))}`;
  if (item.revision_ref !== ref || item.definition_sha256 !== definitionSha256) return fail("account_system_store_invalid");
  return { revision_ref: ref, definition_sha256: definitionSha256, ...revision, created_at: timestamp(item.created_at) };
}
function parseState(value: unknown): AccountSystemState {
  const item = exactObject(value, ["schema_version", "definitions", "drafts"]);
  if (item.schema_version !== accountSystemDefinitionStoreSchemaVersion || !Array.isArray(item.definitions) || !Array.isArray(item.drafts) || item.definitions.length > 1024 || item.drafts.length > 4096) return fail("account_system_store_invalid");
  const definitions: StoredDefinition[] = item.definitions.map(value => {
    const record = exactObject(value, ["local_definition_ref", "account_system_id", "enabled", "enabled_revision_ref", "record_version", "revisions"]);
    const ref = localRef(record.local_definition_ref);
    if (typeof record.enabled !== "boolean" || !Array.isArray(record.revisions) || record.revisions.length < 1 || record.revisions.length > 4096) return fail("account_system_store_invalid");
    const revisions = record.revisions.map((revision, index) => parseRevision(revision, ref, index + 1));
    if (revisions.some((revision, index) => revision.base_revision_ref !== null && !revisions.slice(0, index).some(previous => previous.revision_ref === revision.base_revision_ref))) return fail("account_system_store_invalid");
    const enabledRevisionRef = record.enabled_revision_ref === null ? null : revisionRef(record.enabled_revision_ref);
    if (record.enabled && (!enabledRevisionRef || !revisions.some(revision => revision.revision_ref === enabledRevisionRef)) || !record.enabled && enabledRevisionRef !== null && !revisions.some(revision => revision.revision_ref === enabledRevisionRef)) return fail("account_system_store_invalid");
    const id = string(record.account_system_id, "account_system_store_invalid");
    if (revisions[0]?.definition.account_system_id !== id || !Number.isSafeInteger(record.record_version) || Number(record.record_version) < revisions.length) return fail("account_system_store_invalid");
    return { local_definition_ref: ref, account_system_id: id, enabled: record.enabled, enabled_revision_ref: enabledRevisionRef, record_version: Number(record.record_version), revisions };
  });
  const drafts = item.drafts.map(value => {
    const draft = exactObject(value, ["draft_ref", "local_definition_ref", "base_revision_ref", "template_ref", "template_sha256", "template_source", "definition", "created_at", "updated_at", "pinned_revision_ref"]);
    const ref = localRef(draft.local_definition_ref), base = revisionRef(draft.base_revision_ref);
    const templateRef = string(draft.template_ref, "account_system_store_invalid");
    const definition = validateTemplate(draft.definition, templateRef, { allowLocalVersion: true });
    const source = exactObject(draft.template_source, ["publisher", "repository", "path", "version", "evidence_refs"]);
    if (!/^sha256:[a-f0-9]{64}$/.test(String(draft.template_sha256)) || !definitions.some(record => record.local_definition_ref === ref && record.revisions.some(item => item.revision_ref === base))) return fail("account_system_store_invalid");
    const pinned = draft.pinned_revision_ref === null ? null : revisionRef(draft.pinned_revision_ref);
    if (pinned !== null && !definitions.find(record => record.local_definition_ref === ref)?.revisions.some(item => item.revision_ref === pinned)) return fail("account_system_store_invalid");
    return { draft_ref: draftRef(draft.draft_ref), local_definition_ref: ref, base_revision_ref: base, template_ref: templateRef,
      template_sha256: String(draft.template_sha256), template_source: validateTemplate({
        schema_version: "lode.account-system-template.v1", template_ref: templateRef, account_system_id: definition.account_system_id, version: String(source.version),
        display_name: definition.display_name, related_domains: definition.related_domains, products: definition.products, login_entry: definition.login_entry,
        admin_entry_points: definition.admin_entry_points, ...(definition.identity_method === undefined ? {} : { identity_method: definition.identity_method }),
        known_shared_login_relationships: definition.known_shared_login_relationships, source
      }, templateRef).source,
      definition, created_at: timestamp(draft.created_at), updated_at: timestamp(draft.updated_at), pinned_revision_ref: pinned };
  });
  const refs = definitions.map(record => record.local_definition_ref);
  if (new Set(refs).size !== refs.length || new Set(definitions.map(record => record.account_system_id)).size !== definitions.length ||
      new Set(definitions.flatMap(record => record.revisions.map(revision => revision.revision_ref))).size !== definitions.reduce((total, record) => total + record.revisions.length, 0) ||
      new Set(drafts.map(draft => draft.draft_ref)).size !== drafts.length) return fail("account_system_store_invalid");
  return { schema_version: accountSystemDefinitionStoreSchemaVersion, definitions, drafts };
}
function emptyState(): AccountSystemState { return { schema_version: accountSystemDefinitionStoreSchemaVersion, definitions: [], drafts: [] }; }
function nowIso(clock?: () => Date): string { return (clock?.() ?? new Date()).toISOString(); }
async function readRegularLodeAsset(root: string, relativePath: string): Promise<Buffer> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return fail("account_system_template_corrupt");
  let current = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory() || index === parts.length - 1 && (!info.isFile() || info.size > maxTemplateBytes)) return fail("account_system_template_corrupt");
  }
  const bytes = await readFile(current);
  if (bytes.byteLength > maxTemplateBytes) return fail("account_system_template_corrupt");
  return bytes;
}
function findDefinition(state: AccountSystemState, value: unknown): StoredDefinition {
  const ref = localRef(value), record = state.definitions.find(item => item.local_definition_ref === ref);
  if (!record) return fail("account_system_definition_not_found");
  return record;
}
function findDraft(state: AccountSystemState, value: unknown): StoredDraft {
  const ref = draftRef(value), draft = state.drafts.find(item => item.draft_ref === ref);
  if (!draft) return fail("account_system_draft_not_found");
  return draft;
}
function findRevision(record: StoredDefinition, value: unknown): StoredRevision {
  const ref = revisionRef(value), revision = record.revisions.find(item => item.revision_ref === ref);
  if (!revision) return fail("account_system_revision_unavailable");
  return revision;
}
function publicRevision(revision: StoredRevision): JsonObject {
  return { revision_ref: revision.revision_ref, definition_sha256: revision.definition_sha256, template_ref: revision.template_ref,
    template_sha256: revision.template_sha256, base_revision_ref: revision.base_revision_ref, created_at: revision.created_at };
}
function publicRecord(record: StoredDefinition): JsonObject {
  return { local_definition_ref: record.local_definition_ref, account_system_id: record.account_system_id, enabled: record.enabled,
    enabled_revision_ref: record.enabled_revision_ref, record_version: record.record_version, revisions: record.revisions.map(publicRevision) };
}
function makeRevision(record: StoredDefinition, draft: StoredDraft, clock?: () => Date): StoredRevision {
  const sequence = record.revisions.length + 1;
  const snapshot = { definition: draft.definition, template_ref: draft.template_ref, template_sha256: draft.template_sha256, base_revision_ref: draft.base_revision_ref };
  const definitionSha256 = `sha256:${digest(canonical(draft.definition))}`;
  return { revision_ref: makeRevisionRef(record.local_definition_ref, sequence, snapshot), definition_sha256: definitionSha256,
    template_ref: draft.template_ref, template_sha256: draft.template_sha256, base_revision_ref: draft.base_revision_ref,
    created_at: nowIso(clock), definition: structuredClone(draft.definition) };
}
function changedPaths(left: unknown, right: unknown, path = ""): string[] {
  if (canonical(left) === canonical(right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const changes: string[] = [];
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      if (index >= left.length || index >= right.length) changes.push(`${path}/${index}`);
      else changes.push(...changedPaths(left[index], right[index], `${path}/${index}`));
    }
    return changes;
  }
  if (isObject(left) && isObject(right)) {
    const changes: string[] = [];
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const child = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) changes.push(child);
      else changes.push(...changedPaths(left[key], right[key], child));
    }
    return changes;
  }
  return [path || "/"];
}
function validateOwnerEdit(draft: StoredDraft, value: unknown): AccountSystemTemplate {
  const definition = validateTemplate(value, draft.template_ref, { allowLocalVersion: true });
  const base = draft.definition;
  if (definition.account_system_id !== base.account_system_id || canonical(definition.source) !== canonical(draft.template_source) ||
      canonical(definition.identity_method) !== canonical(base.identity_method)) return fail("account_system_invalid_definition");
  return definition;
}

/** Resolves only byte-pinned templates listed in Lode's fixed-source index. */
async function readApprovedTemplate(lodeAssetsPath: string | undefined, requestedRef: string): Promise<{ definition: AccountSystemTemplate; sha256: string }> {
  const approved = approvedAccountSystemTemplates[requestedRef as keyof typeof approvedAccountSystemTemplates];
  if (!approved) return fail("account_system_template_not_approved");
  const root = lodeAssetsPath ?? process.env.WEBENVOY_LODE_ASSETS_PATH;
  if (!root) return fail("account_system_template_unavailable");
  try {
    const indexBytes = await readRegularLodeAsset(root, "registry/account-system-templates.json");
    const index = JSON.parse(indexBytes.toString("utf8")) as JsonObject;
    if (index.schema_version !== "lode.account-system-template-index.v1" || index.index_id !== "lode.account-system-templates" || !Array.isArray(index.entries)) return fail("account_system_template_corrupt");
    const entries = index.entries.filter(value => isObject(value) && value.template_ref === requestedRef);
    if (entries.length !== 1 || !isObject(entries[0])) return fail("account_system_template_corrupt");
    const entry = exactObject(entries[0], ["template_ref", "version", "path", "sha256"]);
    if (entry.template_ref !== requestedRef || entry.version !== approved.version || entry.path !== approved.path || entry.sha256 !== approved.sha256) return fail("account_system_template_corrupt");
    const bytes = await readRegularLodeAsset(root, approved.path);
    const actualSha = `sha256:${digest(bytes)}`;
    if (actualSha !== approved.sha256) return fail("account_system_template_corrupt");
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); }
    catch { return fail("account_system_template_corrupt"); }
    return { definition: validateTemplate(parsed, requestedRef), sha256: actualSha };
  } catch (error) {
    if (error instanceof AccountSystemDefinitionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("account_system_template_unavailable");
    return fail("account_system_template_corrupt");
  }
}

export function createFileAccountSystemDefinitionStore(options: {
  directory: string;
  lodeAssetsPath?: string;
  clock?: () => Date;
  lockTimeoutMs?: number;
}) {
  const statePath = join(options.directory, "account-system-definitions.json");
  const lockPath = join(options.directory, "account-system-definitions.lock");
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000;

  async function readState(): Promise<AccountSystemState> {
    try { return parseState(JSON.parse(await readFile(statePath, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
  }
  async function writeState(state: AccountSystemState): Promise<void> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, statePath); }
    finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async function transaction<T>(action: (state: AccountSystemState) => Promise<T> | T): Promise<T> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    return withFileOwnershipLock(lockPath, lockTimeoutMs, async () => {
      const state = await readState();
      const result = await action(state);
      await writeState(state);
      return result;
    });
  }
  function draftView(draft: StoredDraft): JsonObject {
    return { draft_ref: draft.draft_ref, local_definition_ref: draft.local_definition_ref, base_revision_ref: draft.base_revision_ref,
      template_ref: draft.template_ref, template_sha256: draft.template_sha256, definition: structuredClone(draft.definition),
      created_at: draft.created_at, updated_at: draft.updated_at, pinned_revision_ref: draft.pinned_revision_ref };
  }
  async function createDraftWithTemplate(localDefinitionRefValue: unknown, baseRevisionRefValue: unknown, templateRefValue: string, templateValue: { definition: AccountSystemTemplate; sha256: string }, initialDefinition: AccountSystemTemplate) {
    return transaction(state => {
      const record = findDefinition(state, localDefinitionRefValue);
      const base = findRevision(record, baseRevisionRefValue);
      if (initialDefinition.account_system_id !== record.account_system_id) return fail("account_system_invalid_definition");
      const draft: StoredDraft = {
        draft_ref: `webenvoy:account-system-draft/${randomUUID()}`,
        local_definition_ref: record.local_definition_ref,
        base_revision_ref: base.revision_ref,
        template_ref: templateRefValue,
        template_sha256: templateValue.sha256,
        template_source: structuredClone(templateValue.definition.source),
        definition: structuredClone(initialDefinition),
        created_at: nowIso(options.clock), updated_at: nowIso(options.clock), pinned_revision_ref: null
      };
      state.drafts.push(draft);
      return draftView(draft);
    });
  }

  return {
    async importTemplate(input: { template_ref: string }): Promise<JsonObject> {
      const templateRef = nonSensitiveText(input?.template_ref);
      if (!templateRefPattern.test(templateRef)) return fail("account_system_invalid_input");
      const source = await readApprovedTemplate(options.lodeAssetsPath, templateRef);
      return transaction(state => {
        const existing = state.definitions.find(record => record.account_system_id === source.definition.account_system_id);
        if (existing) {
          const current = existing.revisions.find(item => item.revision_ref === existing.enabled_revision_ref) ?? existing.revisions.at(-1)!;
          if (current.template_ref !== templateRef || current.template_sha256 !== source.sha256) return fail("account_system_template_update_requires_merge");
          return { ...publicRecord(existing), revision_ref: current.revision_ref, template_ref: current.template_ref,
            source: { template_ref: current.template_ref, template_sha256: current.template_sha256 }, definition: structuredClone(current.definition) };
        }
        const ref = `webenvoy:account-system/${randomUUID()}`;
        const initial: StoredRevision = {
          revision_ref: makeRevisionRef(ref, 1, revisionSnapshot({ definition: source.definition, template_ref: templateRef, template_sha256: source.sha256, base_revision_ref: null })),
          definition_sha256: `sha256:${digest(canonical(source.definition))}`, template_ref: templateRef, template_sha256: source.sha256,
          base_revision_ref: null, created_at: nowIso(options.clock), definition: structuredClone(source.definition)
        };
        const record: StoredDefinition = { local_definition_ref: ref, account_system_id: source.definition.account_system_id, enabled: true,
          enabled_revision_ref: initial.revision_ref, record_version: 1, revisions: [initial] };
        state.definitions.push(record);
        return { ...publicRecord(record), revision_ref: initial.revision_ref, template_ref: initial.template_ref,
          source: { template_ref: initial.template_ref, template_sha256: initial.template_sha256 }, definition: structuredClone(initial.definition) };
      });
    },
    async list(): Promise<JsonObject[]> { return (await readState()).definitions.map(publicRecord); },
    async createDraft(input: { local_definition_ref: string; base_revision_ref: string }): Promise<JsonObject> {
      const ref = localRef(input?.local_definition_ref), baseRef = revisionRef(input?.base_revision_ref);
      const state = await readState(), record = findDefinition(state, ref), base = findRevision(record, baseRef);
      const source = await readApprovedTemplate(options.lodeAssetsPath, base.template_ref);
      if (source.sha256 !== base.template_sha256) return fail("account_system_template_corrupt");
      return createDraftWithTemplate(ref, baseRef, base.template_ref, source, base.definition);
    },
    async updateDraft(input: { draft_ref: string; definition: unknown }): Promise<JsonObject> {
      return transaction(state => {
        const draft = findDraft(state, input?.draft_ref);
        if (draft.pinned_revision_ref) return fail("account_system_draft_conflict");
        const definition = validateOwnerEdit(draft, input.definition);
        draft.definition = structuredClone(definition);
        draft.updated_at = nowIso(options.clock);
        return draftView(draft);
      });
    },
    async checkDraft(input: { draft_ref: string }): Promise<JsonObject> {
      const state = await readState(), draft = findDraft(state, input?.draft_ref), record = findDefinition(state, draft.local_definition_ref), base = findRevision(record, draft.base_revision_ref);
      const definition = validateOwnerEdit(draft, draft.definition);
      const source = await readApprovedTemplate(options.lodeAssetsPath, draft.template_ref);
      if (source.sha256 !== draft.template_sha256) return fail("account_system_template_corrupt");
      const changed = changedPaths(base.definition, definition).sort();
      const unresolvedRefs: string[] = [];
      for (const relationship of definition.known_shared_login_relationships) {
        try { await readApprovedTemplate(options.lodeAssetsPath, relationship.system_ref); }
        catch (error) {
          if (error instanceof AccountSystemDefinitionError && ["account_system_template_not_approved", "account_system_template_unavailable"].includes(error.code)) unresolvedRefs.push(relationship.system_ref);
          else throw error;
        }
      }
      return { draft_ref: draft.draft_ref, local_definition_ref: draft.local_definition_ref, base_revision_ref: draft.base_revision_ref,
        template_ref: draft.template_ref, template_sha256: draft.template_sha256, valid: changed.length > 0 && unresolvedRefs.length === 0,
        changed_paths: changed, dependency_check: { state: unresolvedRefs.length === 0 ? "complete" : "blocked", unresolved_refs: unresolvedRefs },
        ...(changed.length === 0 ? { reason: "account_system_draft_unchanged" } : {}),
        ...(unresolvedRefs.length > 0 ? { dependency_failure: "account_system_dependency_unavailable" } : {}) };
    },
    async pinDraft(input: { draft_ref: string; expected_record_version: number }): Promise<JsonObject> {
      const ref = draftRef(input?.draft_ref), expectedVersion = recordVersion(input?.expected_record_version);
      const state = await readState(), draft = findDraft(state, ref), currentRecord = findDefinition(state, draft.local_definition_ref), base = findRevision(currentRecord, draft.base_revision_ref);
      if (draft.pinned_revision_ref) return fail("account_system_draft_conflict");
      if (currentRecord.record_version !== expectedVersion || currentRecord.enabled_revision_ref !== base.revision_ref) return fail("account_system_conflict");
      const check = await this.checkDraft({ draft_ref: ref });
      if (check.valid !== true) return fail(check.dependency_failure === "account_system_dependency_unavailable" ? "account_system_dependency_unavailable" : "account_system_draft_unchanged");
      const checkedDefinitionDigest = digest(canonical(draft.definition));
      return transaction(current => {
        const committedDraft = findDraft(current, ref), record = findDefinition(current, committedDraft.local_definition_ref);
        if (record.record_version !== expectedVersion || record.enabled_revision_ref !== committedDraft.base_revision_ref || committedDraft.pinned_revision_ref ||
            digest(canonical(committedDraft.definition)) !== checkedDefinitionDigest) return fail("account_system_conflict");
        const revision = makeRevision(record, committedDraft, options.clock);
        record.revisions.push(revision);
        record.record_version += 1;
        committedDraft.pinned_revision_ref = revision.revision_ref;
        committedDraft.updated_at = nowIso(options.clock);
        return { ...publicRecord(record), revision_ref: revision.revision_ref, template_ref: revision.template_ref,
          revision: publicRevision(revision), definition: structuredClone(revision.definition), source: { template_ref: revision.template_ref, template_sha256: revision.template_sha256 } };
      });
    },
    async enable(input: { local_definition_ref: string; revision_ref: string; expected_record_version: number }): Promise<JsonObject> {
      const ref = localRef(input?.local_definition_ref), target = revisionRef(input?.revision_ref), expected = recordVersion(input?.expected_record_version);
      return transaction(state => {
        const record = findDefinition(state, ref), revision = findRevision(record, target);
        if (record.record_version !== expected) return fail("account_system_conflict");
        if (record.revisions.at(-1)?.revision_ref !== revision.revision_ref && record.enabled_revision_ref !== revision.revision_ref) return fail("account_system_revision_unavailable");
        record.enabled = true; record.enabled_revision_ref = target; record.record_version += 1;
        return { ...publicRecord(record), revision_ref: revision.revision_ref, template_ref: revision.template_ref,
          revision: publicRevision(revision), definition: structuredClone(revision.definition), source: { template_ref: revision.template_ref, template_sha256: revision.template_sha256 } };
      });
    },
    async disable(input: { local_definition_ref: string; expected_record_version: number }): Promise<JsonObject> {
      const ref = localRef(input?.local_definition_ref), expected = recordVersion(input?.expected_record_version);
      return transaction(state => {
        const record = findDefinition(state, ref);
        if (record.record_version !== expected) return fail("account_system_conflict");
        record.enabled = false; record.record_version += 1;
        return publicRecord(record);
      });
    },
    async rollback(input: { local_definition_ref: string; revision_ref: string; expected_record_version: number }): Promise<JsonObject> {
      const ref = localRef(input?.local_definition_ref), target = revisionRef(input?.revision_ref), expected = recordVersion(input?.expected_record_version);
      return transaction(state => {
        const record = findDefinition(state, ref), revision = findRevision(record, target);
        if (record.record_version !== expected) return fail("account_system_conflict");
        record.enabled = true; record.enabled_revision_ref = target; record.record_version += 1;
        return { ...publicRecord(record), revision_ref: revision.revision_ref, template_ref: revision.template_ref,
          revision: publicRevision(revision), definition: structuredClone(revision.definition), source: { template_ref: revision.template_ref, template_sha256: revision.template_sha256 } };
      });
    },
    async resolve(localDefinitionRefValue: string, revisionRefValue?: string, options?: { historical?: boolean }): Promise<JsonObject> {
      const record = findDefinition(await readState(), localDefinitionRefValue);
      if (revisionRefValue !== undefined) {
        const revision = findRevision(record, revisionRefValue);
        if (options?.historical === true) return { local_definition_ref: record.local_definition_ref, ...publicRevision(revision), definition: structuredClone(revision.definition), historical: true };
        if (!record.enabled || record.enabled_revision_ref !== revision.revision_ref) return fail("account_system_definition_disabled");
        return { local_definition_ref: record.local_definition_ref, ...publicRevision(revision), definition: structuredClone(revision.definition), historical: false };
      }
      if (!record.enabled || !record.enabled_revision_ref) return fail("account_system_definition_disabled");
      const revision = findRevision(record, record.enabled_revision_ref);
      return { local_definition_ref: record.local_definition_ref, ...publicRevision(revision), definition: structuredClone(revision.definition), historical: false };
    },
    async resolveTemplate(templateRefValue: string): Promise<JsonObject> {
      const templateRef = nonSensitiveText(templateRefValue);
      const state = await readState();
      const matching = state.definitions.filter(record => {
        const revision = record.enabled_revision_ref ? record.revisions.find(item => item.revision_ref === record.enabled_revision_ref) : undefined;
        return record.enabled && revision?.template_ref === templateRef;
      });
      if (matching.length !== 1) return fail(matching.length === 0 ? "account_system_definition_unavailable" : "account_system_definition_conflict");
      return this.resolve(matching[0]!.local_definition_ref);
    }
  };
}

export type FileAccountSystemDefinitionStore = ReturnType<typeof createFileAccountSystemDefinitionStore>;
