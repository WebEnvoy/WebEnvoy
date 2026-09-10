import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, managedSkillOperations, type FileManagedAccessStore, type ManagedAccessRequest } from "./managed-access.js";
import type { FileRunRecordStore, RunRecord } from "./run-record-store.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";

type JsonObject = Record<string, unknown>;

export const skillLibrarySchemaVersion = "webenvoy.skill-library.v1" as const;
export const skillSourceManifestSchemaVersion = "webenvoy.skill-source-manifest.v1" as const;
export const skillResultSchemaVersion = "webenvoy.skill-operation-result.v1" as const;
export const approvedSkillManifestSha256 = "ddcc8bf912379ed9731b3f7fb6b7ea19b39b716e428a8b64887c9fb97dfb3b4d" as const;
const maxSkillContentBytes = 1024 * 1024;
const maxSkillManifestBytes = 256 * 1024;

type Compatibility = { host: string; plugin_version: string };
export type SkillRevision = {
  revision_ref: string;
  source_ref: string;
  source_commit: string;
  source_blob: string;
  version: string;
  path: string;
  content_sha256: string;
  content_bytes: number;
  compatibility: Compatibility;
};
type ManifestRevision = SkillRevision;
type SkillSourceManifest = {
  schema_version: typeof skillSourceManifestSchemaVersion;
  asset_ref: string;
  asset_name: string;
  source_repository: string;
  source_path: string;
  revisions: ManifestRevision[];
};

type InstalledRevision = SkillRevision & { installed_at: string };
type SkillHistoryEntry = {
  event: "install" | "enable" | "read" | "update" | "rollback" | "disable";
  revision_ref?: string;
  source_ref?: string;
  receipt_ref?: string;
  at: string;
  run_id: string;
};
type SkillOperationRecord = {
  run_id: string;
  principal_id: string;
  request_hash: string;
  operation: SkillOperation;
  metadata: JsonObject;
  committed_at: string;
};
type SkillRecord = {
  skill_ref: string;
  asset_name: string;
  source_repository: string;
  source_path: string;
  revisions: InstalledRevision[];
  enabled: boolean;
  enabled_revision_ref: string | null;
  record_version: number;
  history: SkillHistoryEntry[];
};
type SkillLibraryState = {
  schema_version: typeof skillLibrarySchemaVersion;
  assets: SkillRecord[];
  operations: SkillOperationRecord[];
};

export type SkillOperation = typeof managedSkillOperations[number];
export type SkillScopeRequest = {
  connection_id: string;
  grant_id: string;
  operation: SkillOperation;
  task_scope: { operations: SkillOperation[]; skill_refs: string[]; source_refs: string[] };
  skill_ref?: string;
  source_ref?: string;
  revision_ref?: string;
  target_revision_ref?: string;
  expected_revision_ref?: string | null;
  expected_current_revision_ref?: string | null;
  expected_record_version?: number;
  idempotency_key: string;
};

export class ManagedSkillError extends ManagedAccessError {
  constructor(code: string) { super(code); }
}

const fail = (code: string): never => { throw new ManagedSkillError(code); };
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const gitBlobDigest = (value: Uint8Array) => createHash("sha1").update(`blob ${value.byteLength}\0`).update(value).digest("hex");
const nowIso = (clock?: () => Date) => (clock?.() ?? new Date()).toISOString();

function object(value: unknown, required: string[] = [], optional: string[] = []): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_skill_invalid_input");
  const result = value as JsonObject;
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => ![...required, ...optional].includes(key))) return fail("managed_skill_invalid_input");
  return result;
}
function plainObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_skill_store_invalid");
  return value as JsonObject;
}
function text(value: unknown, code = "managed_skill_invalid_input"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail(code);
  return value;
}
function idempotencyKey(value: unknown): string {
  const result = text(value);
  if (result.length > 512) return fail("managed_skill_invalid_input");
  return result;
}
function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return fail("managed_skill_source_corrupt");
  return value;
}
function revisionRef(value: unknown): string {
  const result = text(value);
  if (!/^git:[A-Za-z0-9._/-]+@[a-f0-9]{40}:[A-Za-z0-9._/-]+#[a-f0-9]{40}$/.test(result)) return fail("managed_skill_invalid_input");
  return result;
}
function sourceRef(value: unknown): string {
  const result = text(value);
  if (!/^github:[A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+@[a-f0-9]{40}$/.test(result)) return fail("managed_skill_invalid_input");
  return result;
}
function safeRelative(value: unknown): string {
  const result = text(value);
  if (result.startsWith("/") || result.includes("\\") || result === "." || result.split("/").some(part => part === ".." || part === "")) return fail("managed_skill_source_corrupt");
  return result;
}
function compatibility(value: unknown): Compatibility {
  const item = object(value, ["host", "plugin_version"]);
  return { host: text(item.host), plugin_version: text(item.plugin_version) };
}
function manifestRevision(value: unknown): ManifestRevision {
  const item = object(value, ["revision_ref", "source_ref", "source_commit", "source_blob", "version", "path", "content_sha256", "content_bytes", "compatibility"]);
  const commit = text(item.source_commit), blob = text(item.source_blob);
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(blob)) return fail("managed_skill_source_corrupt");
  if (!Number.isSafeInteger(item.content_bytes) || Number(item.content_bytes) < 1 || Number(item.content_bytes) > maxSkillContentBytes) return fail("managed_skill_source_corrupt");
  return {
    revision_ref: revisionRef(item.revision_ref), source_ref: sourceRef(item.source_ref), source_commit: commit, source_blob: blob,
    version: text(item.version), path: safeRelative(item.path), content_sha256: sha256(item.content_sha256), content_bytes: Number(item.content_bytes), compatibility: compatibility(item.compatibility)
  };
}
function parseManifest(value: unknown): SkillSourceManifest {
  try {
    const item = object(value, ["schema_version", "asset_ref", "asset_name", "source_repository", "source_path", "revisions"]);
    if (item.schema_version !== skillSourceManifestSchemaVersion || !Array.isArray(item.revisions) || item.revisions.length === 0 || item.revisions.length > 64) return fail("managed_skill_source_corrupt");
    const sourceRepository = text(item.source_repository), sourcePath = safeRelative(item.source_path);
    const revisions = item.revisions.map(manifestRevision);
    for (const revision of revisions) {
      if (revision.revision_ref !== `git:${sourceRepository}@${revision.source_commit}:${sourcePath}#${revision.source_blob}` ||
        revision.source_ref !== `github:${sourceRepository}:${sourcePath}@${revision.source_commit}`) return fail("managed_skill_source_corrupt");
    }
    if (new Set(revisions.map(item => item.revision_ref)).size !== revisions.length || new Set(revisions.map(item => item.source_ref)).size !== revisions.length) return fail("managed_skill_source_corrupt");
    return { schema_version: skillSourceManifestSchemaVersion, asset_ref: text(item.asset_ref), asset_name: text(item.asset_name), source_repository: sourceRepository, source_path: sourcePath, revisions };
  } catch (error) {
    if (error instanceof ManagedSkillError) return fail("managed_skill_source_corrupt");
    throw error;
  }
}
function emptyState(): SkillLibraryState { return { schema_version: skillLibrarySchemaVersion, assets: [], operations: [] }; }
function recordRef(value: unknown): string { return text(value); }
function recordVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail("managed_skill_store_invalid");
  return Number(value);
}
function parseStoredRevision(value: unknown): InstalledRevision {
  const item = object(value, ["revision_ref", "source_ref", "source_commit", "source_blob", "version", "path", "content_sha256", "content_bytes", "compatibility", "installed_at"]);
  const revision = manifestRevision({ revision_ref: item.revision_ref, source_ref: item.source_ref, source_commit: item.source_commit, source_blob: item.source_blob, version: item.version, path: item.path, content_sha256: item.content_sha256, content_bytes: item.content_bytes, compatibility: item.compatibility });
  return { ...revision, installed_at: text(item.installed_at) };
}
function parseHistory(value: unknown): SkillHistoryEntry[] {
  if (!Array.isArray(value)) return fail("managed_skill_store_invalid");
  return value.map(entry => {
    const item = object(entry, ["event", "at", "run_id"], ["revision_ref", "source_ref", "receipt_ref"]);
    if (!["install", "enable", "read", "update", "rollback", "disable"].includes(String(item.event))) return fail("managed_skill_store_invalid");
    return { event: item.event as SkillHistoryEntry["event"], at: text(item.at), run_id: text(item.run_id), ...(item.revision_ref === undefined ? {} : { revision_ref: revisionRef(item.revision_ref) }), ...(item.source_ref === undefined ? {} : { source_ref: sourceRef(item.source_ref) }), ...(item.receipt_ref === undefined ? {} : { receipt_ref: text(item.receipt_ref) }) };
  });
}
function parseState(value: unknown): SkillLibraryState {
  const input = object(value, ["schema_version", "assets"], ["operations"]);
  if (input.schema_version !== skillLibrarySchemaVersion || !Array.isArray(input.assets) || input.assets.length > 128 || input.operations !== undefined && !Array.isArray(input.operations)) return fail("managed_skill_store_invalid");
  const assets = input.assets.map(value => {
    const item = object(value, ["skill_ref", "asset_name", "source_repository", "source_path", "revisions", "enabled", "enabled_revision_ref", "record_version", "history"]);
    if (typeof item.enabled !== "boolean" || (item.enabled_revision_ref !== null && item.enabled_revision_ref !== undefined && typeof item.enabled_revision_ref !== "string")) return fail("managed_skill_store_invalid");
    const revisions = Array.isArray(item.revisions) ? item.revisions.map(parseStoredRevision) : fail("managed_skill_store_invalid");
    const history = parseHistory(item.history);
    const enabledRevision = item.enabled_revision_ref === undefined ? null : item.enabled_revision_ref;
    if (enabledRevision !== null && !revisions.some(revision => revision.revision_ref === enabledRevision)) return fail("managed_skill_store_invalid");
    return { skill_ref: recordRef(item.skill_ref), asset_name: recordRef(item.asset_name), source_repository: recordRef(item.source_repository), source_path: recordRef(item.source_path), revisions, enabled: item.enabled, enabled_revision_ref: enabledRevision, record_version: recordVersion(item.record_version), history };
  });
  const operations = (input.operations ?? []).map(value => {
    const item = object(value, ["run_id", "principal_id", "request_hash", "operation", "metadata", "committed_at"]);
    if (!/^[a-f0-9]{64}$/.test(String(item.request_hash)) || !(managedSkillOperations as readonly string[]).includes(String(item.operation))) return fail("managed_skill_store_invalid");
    const metadata = plainObject(item.metadata);
    if (JSON.stringify(metadata).includes('"content"')) return fail("managed_skill_store_invalid");
    return { run_id: recordRef(item.run_id), principal_id: recordRef(item.principal_id), request_hash: String(item.request_hash), operation: item.operation as SkillOperation, metadata, committed_at: text(item.committed_at) };
  });
  if (new Set(assets.map(item => item.skill_ref)).size !== assets.length || new Set(operations.map(item => item.run_id)).size !== operations.length) return fail("managed_skill_store_invalid");
  return { schema_version: skillLibrarySchemaVersion, assets, operations };
}
function publicRevision(revision: SkillRevision): JsonObject {
  return { revision_ref: revision.revision_ref, source_ref: revision.source_ref, source_commit: revision.source_commit, source_blob: revision.source_blob, version: revision.version, content_sha256: revision.content_sha256, content_bytes: revision.content_bytes, compatibility: revision.compatibility };
}
function assertCompatible(revision: SkillRevision): void {
  if (revision.compatibility.host !== "codex" || revision.compatibility.plugin_version !== "0.2.0") return fail("managed_skill_incompatible");
}
function receipt(revision: SkillRevision, skillRef: string, recordVersionValue: number, clock?: () => Date): JsonObject {
  const receiptRef = `skill-read:${randomUUID()}`;
  return { schema_version: "webenvoy.skill-read-receipt.v1", receipt_ref: receiptRef, skill_ref: skillRef, revision_ref: revision.revision_ref, source_ref: revision.source_ref, content_sha256: revision.content_sha256, content_bytes: revision.content_bytes, record_version: recordVersionValue, read_at: nowIso(clock) };
}
function stateSummary(record: SkillRecord | undefined, manifest: SkillSourceManifest, allowedSources?: readonly string[], localStates?: ReadonlyMap<string, "available" | "missing" | "local_modified">): JsonObject {
  const allowed = allowedSources === undefined ? undefined : new Set(allowedSources);
  const visible = manifest.revisions.filter(item => allowed === undefined || allowed.has(item.source_ref) || allowed.has(item.revision_ref));
  const selectedVisible = record?.enabled_revision_ref !== null && record?.enabled_revision_ref !== undefined && visible.some(item => item.revision_ref === record.enabled_revision_ref);
  return {
    skill_ref: manifest.asset_ref, asset_name: manifest.asset_name, source_repository: manifest.source_repository, source_path: manifest.source_path,
    revisions: visible.map(item => ({ ...publicRevision(item), installed: Boolean(record?.revisions.some(installed => installed.revision_ref === item.revision_ref)), ...(record?.revisions.some(installed => installed.revision_ref === item.revision_ref) ? { local_state: localStates?.get(item.revision_ref) ?? "unknown_until_verified" } : {}) })),
    enabled: selectedVisible ? record?.enabled ?? false : false, enabled_revision_ref: selectedVisible ? record?.enabled_revision_ref ?? null : null, record_version: record?.record_version ?? 0,
  };
}

export function createFileSkillLibraryService(options: {
  directory: string;
  sourceManifestPath?: string;
  trustedManifestSha256?: string;
  runRecordStore: FileRunRecordStore;
  accessStore: FileManagedAccessStore;
  clock?: () => Date;
  lockTimeoutMs?: number;
}) {
  const statePath = join(options.directory, "skill-library.json");
  const assetRoot = join(options.directory, "skill-library");
  const lockPath = join(options.directory, "skill-library.lock");
  const sourceManifestPath = options.sourceManifestPath ?? join(process.cwd(), "agent-entry", "skill-assets", "manifest.json");
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000;
  async function readState(): Promise<SkillLibraryState> {
    try { return parseState(JSON.parse(await readFile(statePath, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
  }
  async function writeState(state: SkillLibraryState): Promise<void> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, statePath); }
    finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async function ensureManagedDirectory(path: string): Promise<void> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(options.directory);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return fail("managed_skill_local_modified");
    const rel = relative(options.directory, path);
    if (rel.startsWith(".." + "/") || rel === "..") return fail("managed_skill_store_invalid");
    let current = options.directory;
    for (const part of rel.split("/")) {
      if (!part) continue;
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) return fail("managed_skill_local_modified");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
  }
  async function checkManagedDirectory(path: string): Promise<"available" | "missing" | "local_modified"> {
    let current = options.directory;
    try {
      const rootInfo = await lstat(current);
      if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return "local_modified";
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
    const rel = relative(options.directory, path);
    if (rel.startsWith(".." + "/") || rel === "..") return fail("managed_skill_store_invalid");
    for (const part of rel.split("/")) {
      if (!part) continue;
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) return "local_modified";
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
    }
    return "available";
  }
  async function transaction<T>(action: (state: SkillLibraryState) => Promise<T> | T): Promise<T> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    return withFileOwnershipLock(lockPath, lockTimeoutMs, async () => { const state = await readState(); const result = await action(state); await writeState(state); return result; });
  }
  async function sourceManifest(): Promise<{ manifest: SkillSourceManifest; sourceRoot: string }> {
    try {
      const info = await lstat(sourceManifestPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxSkillManifestBytes) return fail("managed_skill_source_corrupt");
      const bytes = await readFile(sourceManifestPath);
      if (options.trustedManifestSha256 !== undefined && digest(bytes) !== options.trustedManifestSha256) return fail("managed_skill_source_corrupt");
      const manifest = parseManifest(JSON.parse(bytes.toString("utf8")));
      return { manifest, sourceRoot: resolve(sourceManifestPath, "..") };
    } catch (error) {
      if (error instanceof ManagedSkillError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("managed_skill_source_missing");
      return fail("managed_skill_source_corrupt");
    }
  }
  async function sourceBytes(manifest: SkillSourceManifest, sourceRoot: string, revision: SkillRevision): Promise<Buffer> {
    const filePath = resolve(sourceRoot, revision.path);
    const rel = relative(sourceRoot, filePath);
    if (!rel || rel.startsWith(".." + "/") || rel === "..") return fail("managed_skill_source_corrupt");
    let parent = sourceRoot;
    for (const part of rel.split("/")) {
      parent = join(parent, part);
      const info = await lstat(parent).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
      if (info?.isSymbolicLink()) return fail("managed_skill_source_corrupt");
    }
    let info;
    try { info = await lstat(filePath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("managed_skill_source_missing"); throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.size !== revision.content_bytes || info.size > maxSkillContentBytes) return fail("managed_skill_source_corrupt");
    const bytes = await readFile(filePath);
    if (bytes.byteLength !== revision.content_bytes || digest(bytes) !== revision.content_sha256 || gitBlobDigest(bytes) !== revision.source_blob) return fail("managed_skill_source_corrupt");
    return bytes;
  }
  function findManifestRevision(manifest: SkillSourceManifest, ref: string): SkillRevision {
    return manifest.revisions.find(revision => revision.revision_ref === ref || revision.source_ref === ref) ?? fail("managed_skill_revision_unavailable");
  }
  function findRecord(state: SkillLibraryState, skillRef: string): SkillRecord | undefined { return state.assets.find(item => item.skill_ref === skillRef); }
  function targetPath(skillRef: string, revisionRef: string): string {
    const skill = encodeURIComponent(skillRef), revision = encodeURIComponent(digest(revisionRef));
    return join(assetRoot, skill, "revisions", `${revision}.md`);
  }
  async function installedBytes(record: SkillRecord, revision: SkillRevision): Promise<{ bytes: Buffer; state: "available" | "missing" | "local_modified" }> {
    const path = targetPath(record.skill_ref, revision.revision_ref);
    const directoryState = await checkManagedDirectory(join(assetRoot, encodeURIComponent(record.skill_ref), "revisions"));
    if (directoryState === "missing") return { bytes: Buffer.alloc(0), state: "missing" };
    if (directoryState === "local_modified") return { bytes: Buffer.alloc(0), state: "local_modified" };
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== revision.content_bytes || info.size > maxSkillContentBytes) return { bytes: Buffer.alloc(0), state: "local_modified" };
      const bytes = await readFile(path);
      return bytes.byteLength === revision.content_bytes && digest(bytes) === revision.content_sha256 ? { bytes, state: "available" } : { bytes, state: "local_modified" };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes: Buffer.alloc(0), state: "missing" }; throw error; }
  }
  async function verifiedStateSummary(record: SkillRecord | undefined, manifest: SkillSourceManifest, allowedSources?: readonly string[]): Promise<JsonObject> {
    const allowed = allowedSources === undefined ? undefined : new Set(allowedSources);
    const localStates = new Map<string, "available" | "missing" | "local_modified">();
    if (record) {
      for (const revision of manifest.revisions) {
        if (allowed !== undefined && !allowed.has(revision.source_ref) && !allowed.has(revision.revision_ref)) continue;
        if (record.revisions.some(installed => installed.revision_ref === revision.revision_ref)) localStates.set(revision.revision_ref, (await installedBytes(record, revision)).state);
      }
    }
    return stateSummary(record, manifest, allowedSources, localStates);
  }
  function assertScopeRef(input: SkillScopeRequest, skillRef: string, revision?: SkillRevision): void {
    if (!input.task_scope.operations.includes(input.operation) || !input.task_scope.skill_refs.includes(skillRef)) return fail("managed_access_denied");
    if (revision && !input.task_scope.source_refs.includes(revision.source_ref) && !input.task_scope.source_refs.includes(revision.revision_ref)) return fail("managed_access_denied");
  }
  function parse(value: unknown): SkillScopeRequest {
    const input = object(value, ["idempotency_key", "connection_id", "grant_id", "operation", "task_scope"], ["skill_ref", "source_ref", "revision_ref", "target_revision_ref", "expected_revision_ref", "expected_current_revision_ref", "expected_record_version"]);
    if (!(managedSkillOperations as readonly string[]).includes(String(input.operation))) return fail("managed_skill_invalid_input");
    const scope = object(input.task_scope, ["operations", "skill_refs", "source_refs"]);
    if (!Array.isArray(scope.operations) || !Array.isArray(scope.skill_refs) || !Array.isArray(scope.source_refs)) return fail("managed_skill_invalid_input");
    const operation = input.operation as SkillOperation;
    const result: SkillScopeRequest = {
      idempotency_key: idempotencyKey(input.idempotency_key), connection_id: text(input.connection_id), grant_id: text(input.grant_id), operation,
      task_scope: { operations: scope.operations.map(value => text(value)) as SkillOperation[], skill_refs: scope.skill_refs.map(value => text(value)), source_refs: scope.source_refs.map(value => text(value)) },
      ...(input.skill_ref === undefined ? {} : { skill_ref: text(input.skill_ref) }), ...(input.source_ref === undefined ? {} : { source_ref: sourceRef(input.source_ref) }),
      ...(input.revision_ref === undefined ? {} : { revision_ref: revisionRef(input.revision_ref) }), ...(input.target_revision_ref === undefined ? {} : { target_revision_ref: revisionRef(input.target_revision_ref) }),
      ...(input.expected_revision_ref === undefined ? {} : { expected_revision_ref: input.expected_revision_ref === null ? null : revisionRef(input.expected_revision_ref) }),
      ...(input.expected_current_revision_ref === undefined ? {} : { expected_current_revision_ref: input.expected_current_revision_ref === null ? null : revisionRef(input.expected_current_revision_ref) }),
      ...(input.expected_record_version === undefined ? {} : { expected_record_version: recordVersion(input.expected_record_version) })
    };
    const hasExpected = result.expected_revision_ref !== undefined || result.expected_current_revision_ref !== undefined || result.expected_record_version !== undefined;
    const hasRevision = result.revision_ref !== undefined, hasTarget = result.target_revision_ref !== undefined;
    if (["skill.inspect", "skill.install", "skill.enable", "skill.read", "skill.update", "skill.rollback", "skill.disable"].includes(operation) && !result.skill_ref) return fail("managed_skill_invalid_input");
    if (operation === "skill.list" && (result.source_ref !== undefined || hasRevision || hasTarget || hasExpected)) return fail("managed_skill_invalid_input");
    if (operation === "skill.inspect" && (result.source_ref !== undefined || hasRevision || hasTarget || hasExpected)) return fail("managed_skill_invalid_input");
    if (operation === "skill.install" && (!hasRevision || hasTarget || hasExpected)) return fail("managed_skill_invalid_input");
    if (["skill.enable", "skill.update", "skill.rollback"].includes(operation) && (!hasTarget || hasRevision)) return fail("managed_skill_invalid_input");
    if (operation === "skill.read" && (hasRevision || hasTarget || hasExpected)) return fail("managed_skill_invalid_input");
    if (operation === "skill.disable" && (result.source_ref !== undefined || hasRevision || hasTarget)) return fail("managed_skill_invalid_input");
    return result;
  }
  async function authorize(hash: string, input: SkillScopeRequest): Promise<void> {
    const request: ManagedAccessRequest = { connection_id: input.connection_id, grant_id: input.grant_id, operation: input.operation,
      task_scope: input.task_scope as ManagedAccessRequest["task_scope"], ...(input.skill_ref === undefined ? {} : { skill_ref: input.skill_ref }), ...(input.source_ref === undefined ? {} : { source_ref: input.source_ref }) };
    await options.accessStore.checkAccess(hash, request);
  }
  function response(run: RunRecord): JsonObject {
    return { ok: run.status === "succeeded", run_id: run.run_id, status: run.status, ...(run.public_result_summary?.result === undefined ? {} : { result: run.public_result_summary.result }), ...(run.failure === undefined ? {} : { failure: { code: run.failure.code } }) };
  }
  function committedResponse(operation: SkillOperationRecord): JsonObject {
    return { ok: true, run_id: operation.run_id, status: "succeeded", result: operation.metadata };
  }
  async function projectCommittedOperation(operation: SkillOperationRecord): Promise<JsonObject> {
    const current = await options.runRecordStore.getRunRecord(operation.run_id);
    if (!current) return committedResponse(operation);
    if (current.status !== "succeeded" || current.public_result_summary?.result === undefined) {
      await completeRunWithResult(options.runRecordStore, operation.run_id, {
        result_ref: `managed-skill-result:${operation.run_id}`,
        result_kind: "managed_skill_operation",
        data: operation.metadata,
        persisted_public_summary: { ...(current.public_result_summary ?? {}), result: operation.metadata },
        evidence_refs: current.evidence_refs ?? [`managed-skill:${operation.run_id}`]
      });
    }
    const updated = await options.runRecordStore.getRunRecord(operation.run_id);
    return updated ? response(updated) : committedResponse(operation);
  }
  function rememberOperation(state: SkillLibraryState, input: SkillScopeRequest, runId: string, principalId: string, requestHash: string, metadata: JsonObject): void {
    const existing = state.operations.find(item => item.run_id === runId);
    if (existing) {
      if (existing.request_hash !== requestHash || existing.principal_id !== principalId) return fail("managed_skill_idempotency_conflict");
      return;
    }
    state.operations.push({ run_id: runId, principal_id: principalId, request_hash: requestHash, operation: input.operation, metadata: structuredClone(metadata), committed_at: nowIso(options.clock) });
  }

  async function execute(input: SkillScopeRequest, runId: string, principalId: string, requestHash: string): Promise<{ metadata: JsonObject; content?: string }> {
    const { manifest, sourceRoot } = await sourceManifest();
    const state = await readState();
    let record = findRecord(state, manifest.asset_ref);
    const skillRef = input.skill_ref ?? manifest.asset_ref;
    if (skillRef !== manifest.asset_ref) return fail("managed_skill_not_found");
    const requestedRef = input.target_revision_ref ?? input.revision_ref;
    const requested = requestedRef === undefined ? undefined : findManifestRevision(manifest, requestedRef);
    if (input.source_ref !== undefined && requested && requested.source_ref !== input.source_ref) return fail("managed_skill_source_mismatch");
    assertScopeRef(input, skillRef, requested);
    if (input.operation === "skill.list") {
      const visible = input.task_scope.skill_refs.includes(manifest.asset_ref) ? [await verifiedStateSummary(record, manifest, input.task_scope.source_refs)] : [];
      const metadata = { schema_version: skillResultSchemaVersion, skills: visible };
      await transaction(current => { rememberOperation(current, input, runId, principalId, requestHash, metadata); });
      return { metadata };
    }
    if (input.operation === "skill.inspect") {
      const metadata = { schema_version: skillResultSchemaVersion, skill: await verifiedStateSummary(record, manifest, input.task_scope.source_refs) };
      await transaction(current => { rememberOperation(current, input, runId, principalId, requestHash, metadata); });
      return { metadata };
    }
    if (input.operation === "skill.install") {
      const revision = requested!;
      assertCompatible(revision);
      const bytes = await sourceBytes(manifest, sourceRoot, revision);
      return { metadata: await transaction(async current => {
        let asset = findRecord(current, skillRef);
        if (!asset) { asset = { skill_ref: skillRef, asset_name: manifest.asset_name, source_repository: manifest.source_repository, source_path: manifest.source_path, revisions: [], enabled: false, enabled_revision_ref: null, record_version: 0, history: [] }; current.assets.push(asset); }
        const existing = asset.revisions.find(item => item.revision_ref === revision.revision_ref);
        if (existing) {
          const installed = await installedBytes(asset!, revision);
          if (installed.state === "local_modified") return fail("managed_skill_local_modified");
          if (installed.state === "missing") return fail("managed_skill_missing");
          const metadata = { schema_version: skillResultSchemaVersion, skill: await verifiedStateSummary(asset, manifest, input.task_scope.source_refs), revision: publicRevision(revision), idempotent: true };
          rememberOperation(current, input, runId, principalId, requestHash, metadata);
          return metadata;
        }
        const destination = targetPath(skillRef, revision.revision_ref);
        await ensureManagedDirectory(join(assetRoot, encodeURIComponent(skillRef), "revisions"));
        try { const info = await lstat(destination); if (info.isSymbolicLink() || !info.isFile() || info.size !== revision.content_bytes || info.size > maxSkillContentBytes) return fail("managed_skill_local_modified"); const existingBytes = await readFile(destination); if (digest(existingBytes) !== revision.content_sha256) return fail("managed_skill_local_modified"); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const temporary = `${destination}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
            try { await link(temporary, destination); }
            catch (linkError) {
              if ((linkError as NodeJS.ErrnoException).code !== "EEXIST") throw linkError;
              return fail("managed_skill_local_modified");
            }
          } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
        }
        asset.revisions.push({ ...revision, installed_at: nowIso(options.clock) }); asset.record_version += 1; asset.history.push({ event: "install", revision_ref: revision.revision_ref, source_ref: revision.source_ref, at: nowIso(options.clock), run_id: runId });
        const metadata = { schema_version: skillResultSchemaVersion, skill: await verifiedStateSummary(asset, manifest, input.task_scope.source_refs), revision: publicRevision(revision), idempotent: false };
        rememberOperation(current, input, runId, principalId, requestHash, metadata);
        return metadata;
      }) };
    }
    if (!record) return fail("managed_skill_not_installed");
    if (input.operation === "skill.read") {
      if (!record.enabled || !record.enabled_revision_ref) return fail("managed_skill_disabled");
      const selected = manifest.revisions.find(item => item.revision_ref === record!.enabled_revision_ref);
      if (!selected) return fail("managed_skill_revision_unavailable");
      assertCompatible(selected);
      if (!input.task_scope.source_refs.includes(selected.source_ref) && !input.task_scope.source_refs.includes(selected.revision_ref)) return fail("managed_access_denied");
      if (input.source_ref !== undefined && input.source_ref !== selected.source_ref) return fail("managed_skill_source_mismatch");
      const installed = await installedBytes(record, selected);
      if (installed.state !== "available") return fail(`managed_skill_${installed.state}`);
      const readReceipt = receipt(selected, skillRef, record.record_version, options.clock);
      const metadata = { schema_version: skillResultSchemaVersion, skill_ref: skillRef, revision: publicRevision(selected), receipt: readReceipt };
      await transaction(async current => { const asset = findRecord(current, skillRef); if (!asset) return fail("managed_skill_not_installed"); asset.history.push({ event: "read", revision_ref: selected.revision_ref, source_ref: selected.source_ref, receipt_ref: String(readReceipt.receipt_ref), at: nowIso(options.clock), run_id: runId }); rememberOperation(current, input, runId, principalId, requestHash, metadata); return undefined; });
      return { metadata, content: installed.bytes.toString("utf8") };
    }
    const target = requested;
    if (input.operation !== "skill.disable" && (!target || !record.revisions.some(item => item.revision_ref === target.revision_ref))) return fail("managed_skill_revision_not_installed");
    const currentSelected = record.enabled_revision_ref === null ? undefined : manifest.revisions.find(item => item.revision_ref === record!.enabled_revision_ref);
    if (currentSelected && !input.task_scope.source_refs.includes(currentSelected.source_ref) && !input.task_scope.source_refs.includes(currentSelected.revision_ref)) return fail("managed_access_denied");
    if (["skill.enable", "skill.update", "skill.rollback", "skill.disable"].includes(input.operation) && input.expected_revision_ref === undefined && input.expected_current_revision_ref === undefined && input.expected_record_version === undefined) return fail("managed_skill_conflict");
    if (input.expected_revision_ref !== undefined && input.expected_revision_ref !== record.enabled_revision_ref) return fail("managed_skill_conflict");
    if (input.expected_current_revision_ref !== undefined && input.expected_current_revision_ref !== record.enabled_revision_ref) return fail("managed_skill_conflict");
    if (input.expected_record_version !== undefined && input.expected_record_version !== record.record_version) return fail("managed_skill_conflict");
    if (input.operation === "skill.update" || input.operation === "skill.rollback") {
      if (currentSelected) { assertCompatible(currentSelected); const currentBytes = await installedBytes(record, currentSelected); if (currentBytes.state !== "available") return fail(`managed_skill_${currentBytes.state}`); }
      assertCompatible(target!);
      const targetBytes = await installedBytes(record, target!); if (targetBytes.state !== "available") return fail(`managed_skill_${targetBytes.state}`);
    }
    if (input.operation === "skill.enable") { assertCompatible(target!); const targetBytes = await installedBytes(record, target!); if (targetBytes.state !== "available") return fail(`managed_skill_${targetBytes.state}`); }
    const event = input.operation === "skill.enable" ? "enable" : input.operation === "skill.update" ? "update" : input.operation === "skill.rollback" ? "rollback" : "disable";
    const metadata = await transaction(async current => {
      const asset = findRecord(current, skillRef); if (!asset) return fail("managed_skill_not_installed");
      if (input.expected_revision_ref !== undefined && input.expected_revision_ref !== asset.enabled_revision_ref) return fail("managed_skill_conflict");
      if (input.expected_current_revision_ref !== undefined && input.expected_current_revision_ref !== asset.enabled_revision_ref) return fail("managed_skill_conflict");
      if (input.expected_record_version !== undefined && input.expected_record_version !== asset.record_version) return fail("managed_skill_conflict");
      if (event === "disable") { asset.enabled = false; }
      else { asset.enabled_revision_ref = target!.revision_ref; if (event === "enable") asset.enabled = true; }
      asset.record_version += 1;
      const selected = asset.enabled_revision_ref ? manifest.revisions.find(item => item.revision_ref === asset.enabled_revision_ref) : undefined;
      if (selected && event !== "disable") assertCompatible(selected);
      asset.history.push({ event, ...(asset.enabled_revision_ref === null ? {} : { revision_ref: asset.enabled_revision_ref }), ...(selected === undefined ? {} : { source_ref: selected.source_ref }), at: nowIso(options.clock), run_id: runId });
      const visibleSelected = asset.enabled_revision_ref ? manifest.revisions.find(item => item.revision_ref === asset.enabled_revision_ref) : undefined;
      const metadata = { schema_version: skillResultSchemaVersion, skill: await verifiedStateSummary(asset, manifest, input.task_scope.source_refs), revision: visibleSelected && (input.task_scope.source_refs.includes(visibleSelected.source_ref) || input.task_scope.source_refs.includes(visibleSelected.revision_ref)) ? publicRevision(visibleSelected) : null };
      rememberOperation(current, input, runId, principalId, requestHash, metadata);
      return metadata;
    });
    return { metadata };
  }

  async function submit(credentialHash: string, value: unknown): Promise<JsonObject> {
    const input = parse(value);
    const principal = await options.accessStore.authenticateCredential(credentialHash);
    const runId = `managed-${digest(`${principal.principal_id}:${input.idempotency_key}`)}`;
    const { connection_id: _connectionId, ...stableInput } = input;
    const requestHash = digest(JSON.stringify(stableInput));
    return withFileOwnershipLock(join(options.runRecordStore.directory, "managed-skill-operation.lock"), lockTimeoutMs, async () => {
      const previous = await options.runRecordStore.getRunRecord(runId);
      if (previous) {
        if (previous.public_result_summary?.request_hash !== requestHash) return fail("managed_skill_idempotency_conflict");
        const committed = (await readState()).operations.find(item => item.run_id === runId);
        if (committed) {
          if (committed.request_hash !== requestHash || committed.principal_id !== principal.principal_id) return fail("managed_skill_idempotency_conflict");
          return projectCommittedOperation(committed);
        }
        return response(previous);
      }
      await authorize(credentialHash, input);
      const summary = { schema_version: skillResultSchemaVersion, principal_id: principal.principal_id, grant_id: input.grant_id, operation: input.operation, skill_ref: input.skill_ref, request_hash: requestHash };
      await options.runRecordStore.createRunRecord({ run_id: runId, task_intent_ref: `managed-skill-intent:${runId}`, capability_ref: "core:managed-skill-library", status: "admitted", admission: { decision: "accepted", action_risk: "read" }, public_result_summary: summary });
      await options.runRecordStore.updateRunRecord(runId, { status: "running" });
      try {
        const result = await execute(input, runId, principal.principal_id, requestHash);
        await completeRunWithResult(options.runRecordStore, runId, { result_ref: `managed-skill-result:${runId}`, result_kind: "managed_skill_operation", data: result.metadata, persisted_public_summary: { ...summary, result: result.metadata }, evidence_refs: [`managed-skill:${runId}`] });
        const output = response((await options.runRecordStore.getRunRecord(runId))!);
        return result.content === undefined ? output : { ...output, result: { ...result.metadata, content: result.content } };
      } catch (error) {
        const committed = (await readState()).operations.find(item => item.run_id === runId);
        if (committed) {
          try { return await projectCommittedOperation(committed); }
          catch { return response((await options.runRecordStore.getRunRecord(runId))!); }
        }
        await completeRunWithFailure(options.runRecordStore, runId, { failure: { category: "runtime_execution", code: error instanceof ManagedAccessError ? error.code : "managed_skill_unavailable", phase: "execution", recovery_hint: "query_operation_without_replay" }, evidence_refs: [`managed-skill:${runId}`] });
        return response((await options.runRecordStore.getRunRecord(runId))!);
      }
    });
  }
  async function query(credentialHash: string, runId: string): Promise<JsonObject> {
    const principal = await options.accessStore.authenticateCredential(credentialHash);
    const run = await options.runRecordStore.getRunRecord(runId);
    if (!run || run.public_result_summary?.principal_id !== principal.principal_id || run.capability_ref !== "core:managed-skill-library") return fail("managed_skill_operation_not_found");
    const committed = (await readState()).operations.find(item => item.run_id === runId);
    if (committed) {
      if (committed.principal_id !== principal.principal_id) return fail("managed_skill_operation_not_found");
      return withFileOwnershipLock(join(options.runRecordStore.directory, "managed-skill-operation.lock"), lockTimeoutMs, () => projectCommittedOperation(committed));
    }
    return response(run);
  }
  return { submit, query, async listSource(): Promise<JsonObject> { const { manifest } = await sourceManifest(); return { schema_version: skillResultSchemaVersion, skill: await verifiedStateSummary((await readState()).assets.find(item => item.skill_ref === manifest.asset_ref), manifest) }; } };
}

export type FileSkillLibraryService = ReturnType<typeof createFileSkillLibraryService>;
