import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { FileHandle } from "node:fs/promises";
import { acquireFileOwnership } from "./profile-storage.js";

export const HARBOR_MANAGED_FILE_STORE_SCHEMA = "harbor-managed-file-store/v1" as const;
export const HARBOR_BROWSER_FILE_RESULT_SCHEMA = "webenvoy.browser-file-result/v1" as const;
export const MANAGED_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const MANAGED_FILE_MAX_MATERIALS = 32;
export const MANAGED_FILE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const MANAGED_FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const MANAGED_FILE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/plain",
  "text/csv"
] as const;
export type ManagedFileMimeType = typeof MANAGED_FILE_MIME_TYPES[number];
export type ManagedFileSource = "owner_import" | "browser_download";
export type ManagedFileStatus = "available" | "revoked" | "expired" | "deleted";

export type ManagedFileRecord = {
  schema_version: typeof HARBOR_MANAGED_FILE_STORE_SCHEMA;
  file_ref: string;
  profile_ref: string;
  source: ManagedFileSource;
  status: ManagedFileStatus;
  display_name: string;
  mime_type: ManagedFileMimeType;
  detected_mime_type: ManagedFileMimeType;
  byte_length: number;
  sha256: string;
  created_at: string;
  expires_at: string;
  operation_ref?: string;
  principal_id?: string;
  runtime_session_ref?: string;
  page_ref?: string;
  page_id?: string;
  origin?: string;
};

type StoredManagedFileRecord = ManagedFileRecord & { storage_name: string | null };
type StoredOperation = {
  operation_ref: string;
  request_hash: string;
  result: unknown;
};
type FileState = {
  schema_version: typeof HARBOR_MANAGED_FILE_STORE_SCHEMA;
  materials: StoredManagedFileRecord[];
  operations: StoredOperation[];
};

export type ManagedFileImportInput = {
  source_path: string;
  profile_ref: string;
  display_name?: string;
  mime_type?: string;
  operation_ref?: string;
  principal_id?: string;
};
export type ManagedFileExportInput = { file_ref: string; destination_path: string };
export type ManagedFileDownloadCommitInput = {
  staging_path: string;
  profile_ref: string;
  operation_ref: string;
  principal_id: string;
  display_name: string;
  mime_type?: string;
  max_file_bytes?: number;
  allowed_mime_types?: readonly string[];
  runtime_session_ref: string;
  page_ref: string;
  page_id?: string;
  origin: string;
};

export class ManagedFileError extends Error {
  constructor(readonly code: string) { super(code); }
}

const FILE_REF = /^attachment:runtime\/[0-9a-f-]{36}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PUBLIC_REF = /^[A-Za-z0-9:_./-]{1,256}$/;
const ALLOWED_EXTENSIONS: Record<ManagedFileMimeType, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/csv": [".csv"]
};

function fail(code: string): never { throw new ManagedFileError(code); }
function boundedRef(value: unknown): string {
  if (typeof value !== "string" || !PUBLIC_REF.test(value)) return fail("file_ref_unavailable");
  return value;
}
function fileRef(value: unknown): string {
  if (typeof value !== "string" || !FILE_REF.test(value)) return fail("file_ref_unavailable");
  return value;
}
function displayName(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f\\/]/.test(value) || value === "." || value === "..") return fail("file_name_invalid");
  return value;
}
function mime(value: unknown): ManagedFileMimeType {
  if (!MANAGED_FILE_MIME_TYPES.includes(value as ManagedFileMimeType)) return fail("file_type_unsupported");
  return value as ManagedFileMimeType;
}
function safeOrigin(value: unknown): string {
  if (typeof value !== "string") return fail("download_relation_unavailable");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || url.username || url.password) return fail("download_relation_unavailable");
    return value;
  } catch { return fail("download_relation_unavailable"); }
}
function safeOperationRef(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !PUBLIC_REF.test(value)) return fail("file_operation_invalid");
  return value;
}

function extensionMime(name: string): ManagedFileMimeType | null {
  const extension = extname(name).toLowerCase();
  for (const candidate of MANAGED_FILE_MIME_TYPES) if (ALLOWED_EXTENSIONS[candidate].includes(extension)) return candidate;
  return null;
}

function detectMime(data: Buffer, name: string, declared: ManagedFileMimeType): ManagedFileMimeType {
  let detected: ManagedFileMimeType | null = null;
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) detected = "image/png";
  else if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) detected = "image/jpeg";
  else if (data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-") detected = "application/pdf";
  else {
    if (data.includes(0)) return fail("file_type_unsupported");
    try { new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return fail("file_type_unsupported"); }
    detected = declared === "text/csv" || extensionMime(name) === "text/csv" ? "text/csv" : "text/plain";
  }
  if (detected !== declared || extensionMime(name) !== declared) return fail("file_type_mismatch");
  return detected;
}

function publicRecord(record: StoredManagedFileRecord): ManagedFileRecord {
  const { storage_name: _private, ...publicValue } = record;
  return structuredClone(publicValue);
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail("file_store_invalid");
  await chmod(path, 0o700);
}

async function readRealFile(path: string, missingCode: string): Promise<{ fd: FileHandle; size: number }> {
  let fd: FileHandle;
  try {
    fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail(missingCode);
    if ((error as NodeJS.ErrnoException).code === "ELOOP") return fail("file_symlink_rejected");
    throw error;
  }
  try {
    const entry = await fd.stat();
    if (!entry.isFile()) { await fd.close(); return fail("file_source_not_regular"); }
    return { fd, size: entry.size };
  } catch (error) {
    await fd.close().catch(() => undefined);
    throw error;
  }
}

async function readFd(fd: FileHandle, size: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let remaining = size;
  while (remaining > 0) {
    const chunk = Buffer.alloc(Math.min(1024 * 1024, remaining));
    const result = await fd.read(chunk, 0, chunk.length, null);
    if (!result.bytesRead) break;
    chunks.push(chunk.subarray(0, result.bytesRead));
    remaining -= result.bytesRead;
  }
  if (remaining !== 0) return fail("file_integrity_mismatch");
  return Buffer.concat(chunks, size);
}

async function writePrivateFile(path: string, data: Buffer): Promise<void> {
  const fd = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < data.length) {
      const result = await fd.write(data, offset, data.length - offset, null);
      if (!result.bytesWritten) return fail("file_commit_failed");
      offset += result.bytesWritten;
    }
  } finally { await fd.close(); }
  await chmod(path, 0o600);
}

function emptyState(): FileState {
  return { schema_version: HARBOR_MANAGED_FILE_STORE_SCHEMA, materials: [], operations: [] };
}

function validateState(value: unknown): FileState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("file_store_invalid");
  const state = value as Partial<FileState>;
  if (state.schema_version !== HARBOR_MANAGED_FILE_STORE_SCHEMA || !Array.isArray(state.materials) || !Array.isArray(state.operations)) return fail("file_store_invalid");
  for (const item of state.materials) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("file_store_invalid");
    const record = item as Partial<StoredManagedFileRecord>;
    fileRef(record.file_ref);
    boundedRef(record.profile_ref);
    if (!["owner_import", "browser_download"].includes(String(record.source)) || !["available", "revoked", "expired", "deleted"].includes(String(record.status))) return fail("file_store_invalid");
    displayName(record.display_name); mime(record.mime_type); mime(record.detected_mime_type);
    if (!Number.isSafeInteger(record.byte_length) || Number(record.byte_length) < 0 || Number(record.byte_length) > MANAGED_FILE_MAX_BYTES || !SHA256.test(String(record.sha256)) || typeof record.created_at !== "string" || typeof record.expires_at !== "string") return fail("file_store_invalid");
    if (record.principal_id !== undefined) boundedRef(record.principal_id);
    if (record.storage_name !== null && (typeof record.storage_name !== "string" || !/^[0-9a-f-]{36}\.bin$/.test(record.storage_name))) return fail("file_store_invalid");
  }
  for (const item of state.operations) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.operation_ref !== "string" || typeof item.request_hash !== "string" || !item.result) return fail("file_store_invalid");
  }
  return state as FileState;
}

export function createManagedFileStore(options: { persistence_path?: string; root?: string; clock?: () => Date; lock_timeout_ms?: number } = {}) {
  const persistence = options.persistence_path ? resolve(options.persistence_path) : undefined;
  const root = resolve(options.root ?? (persistence ? join(dirname(persistence), "files") : join(process.cwd(), "data", "harbor", "files")));
  const content = join(root, "content");
  const staging = join(root, "staging");
  const indexPath = join(root, "index.json");
  const now = () => (options.clock?.() ?? new Date()).toISOString();

  async function read(): Promise<FileState> {
    try { return validateState(JSON.parse(await readFile(indexPath, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
  }
  async function save(state: FileState): Promise<void> {
    await ensureDirectory(root);
    const temporary = join(root, `.index-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { await rename(temporary, indexPath); await chmod(indexPath, 0o600); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  async function transaction<T>(action: (state: FileState) => Promise<T> | T): Promise<T> {
    await ensureDirectory(root);
    const lock = acquireFileOwnership(`${indexPath}.lock`, options.lock_timeout_ms ?? 5000);
    try {
      const state = await read();
      await cleanupExpiredState(state, false);
      const result = await action(state);
      await save(state);
      return result;
    } finally { lock.release(); }
  }
  async function cleanupExpiredState(state: FileState, persist: boolean): Promise<void> {
    const current = Date.parse(now());
    let changed = false;
    for (const record of state.materials) {
      if ((record.status === "available" || record.status === "revoked") && Date.parse(record.expires_at) <= current) {
        record.status = "expired";
        if (record.storage_name) await rm(join(content, record.storage_name), { force: true }).catch(() => undefined);
        record.storage_name = null;
        changed = true;
      }
    }
    if (persist && changed) await save(state);
  }
  function activeMaterials(state: FileState): StoredManagedFileRecord[] {
    // Revoked material remains retained and owner-exportable until delete or
    // expiry, so it continues to consume the hard retention quota.
    return state.materials.filter(item => !["expired", "deleted"].includes(item.status) && item.storage_name !== null);
  }
  function recordForUse(state: FileState, ref: string, profileRef?: string): StoredManagedFileRecord {
    const item = state.materials.find(candidate => candidate.file_ref === ref);
    if (!item || item.status !== "available" || !item.storage_name || (profileRef !== undefined && item.profile_ref !== profileRef)) return fail("file_ref_unavailable");
    if (Date.parse(item.expires_at) <= Date.parse(now())) return fail("file_expired");
    return item;
  }
  async function readManagedBytes(record: StoredManagedFileRecord): Promise<Buffer> {
    if (!record.storage_name) return fail("file_ref_unavailable");
    const path = join(content, record.storage_name);
    const opened = await readRealFile(path, "file_ref_unavailable");
    try {
      if (opened.size !== record.byte_length) return fail("file_integrity_mismatch");
      const data = await readFd(opened.fd, opened.size);
      if (createHash("sha256").update(data).digest("hex") !== record.sha256) return fail("file_integrity_mismatch");
      return data;
    } finally { await opened.fd.close(); }
  }
  async function commitBytes(state: FileState, data: Buffer, input: { profile_ref: string; source: ManagedFileSource; display_name: string; mime_type: string; operation_ref?: string; principal_id?: string; max_file_bytes?: number; allowed_mime_types?: readonly string[]; runtime_session_ref?: string; page_ref?: string; page_id?: string; origin?: string }): Promise<ManagedFileRecord> {
    const profileRef = boundedRef(input.profile_ref);
    const name = displayName(input.display_name);
    const declared = mime(input.mime_type);
    if (input.max_file_bytes !== undefined && (!Number.isSafeInteger(input.max_file_bytes) || input.max_file_bytes < 1 || input.max_file_bytes > MANAGED_FILE_MAX_BYTES)) return fail("file_operation_invalid");
    if (input.allowed_mime_types !== undefined && (!input.allowed_mime_types.length || input.allowed_mime_types.some(item => !MANAGED_FILE_MIME_TYPES.includes(item as ManagedFileMimeType)) || new Set(input.allowed_mime_types).size !== input.allowed_mime_types.length)) return fail("file_operation_invalid");
    if (data.length > MANAGED_FILE_MAX_BYTES || (input.max_file_bytes !== undefined && data.length > input.max_file_bytes) || (input.source === "owner_import" && data.length < 1)) return fail("file_limit_exceeded");
    const detected = detectMime(data, name, declared);
    if (input.allowed_mime_types !== undefined && !input.allowed_mime_types.includes(detected)) return fail("file_type_unsupported");
    const live = activeMaterials(state);
    const total = live.reduce((sum, item) => sum + item.byte_length, 0);
    if (live.length >= MANAGED_FILE_MAX_MATERIALS || total + data.length > MANAGED_FILE_MAX_TOTAL_BYTES) return fail("file_limit_exceeded");
    await ensureDirectory(content);
    const storageName = `${randomUUID()}.bin`;
    await writePrivateFile(join(content, storageName), data);
    const created = now();
    const record: StoredManagedFileRecord = {
      schema_version: HARBOR_MANAGED_FILE_STORE_SCHEMA,
      file_ref: `attachment:runtime/${randomUUID()}`,
      profile_ref: profileRef,
      source: input.source,
      status: "available",
      display_name: name,
      mime_type: declared,
      detected_mime_type: detected,
      byte_length: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      created_at: created,
      expires_at: new Date(Date.parse(created) + MANAGED_FILE_RETENTION_MS).toISOString(),
      ...(input.operation_ref === undefined ? {} : { operation_ref: safeOperationRef(input.operation_ref) }),
      ...(input.principal_id === undefined ? {} : { principal_id: boundedRef(input.principal_id) }),
      ...(input.runtime_session_ref === undefined ? {} : { runtime_session_ref: boundedRef(input.runtime_session_ref) }),
      ...(input.page_ref === undefined ? {} : { page_ref: boundedRef(input.page_ref) }),
      ...(input.page_id === undefined ? {} : { page_id: boundedRef(input.page_id) }),
      ...(input.origin === undefined ? {} : { origin: safeOrigin(input.origin) }),
      storage_name: storageName
    };
    state.materials.push(record);
    return publicRecord(record);
  }

  return {
    root,
    async acquireOperationLock(operationRefInput: string) {
      const operationRef = safeOperationRef(operationRefInput);
      await ensureDirectory(root);
      const lockPath = join(root, `.operation-${createHash("sha256").update(operationRef).digest("hex")}.lock`);
      return acquireFileOwnership(lockPath, options.lock_timeout_ms ?? 5000);
    },
    async importFile(input: ManagedFileImportInput): Promise<ManagedFileRecord> {
      if (typeof input.source_path !== "string" || !input.source_path || input.source_path.includes("\0")) return fail("file_source_invalid");
      const opened = await readRealFile(resolve(input.source_path), "file_source_missing");
      try {
        if (opened.size < 1 || opened.size > MANAGED_FILE_MAX_BYTES) return fail("file_limit_exceeded");
        const data = await readFd(opened.fd, opened.size);
        const name = displayName(input.display_name ?? (await import("node:path")).basename(input.source_path));
        const inferred = input.mime_type ?? extensionMime(name);
        if (!inferred) return fail("file_type_unsupported");
        return await transaction(state => commitBytes(state, data, { profile_ref: input.profile_ref, source: "owner_import", display_name: name, mime_type: inferred, operation_ref: input.operation_ref, principal_id: input.principal_id ?? "owner" }));
      } finally { await opened.fd.close(); }
    },
    async inspect(fileRef?: string): Promise<ManagedFileRecord[]> {
      await ensureDirectory(root);
      const state = await read();
      await cleanupExpiredState(state, true);
      const records = fileRef === undefined ? state.materials : [state.materials.find(item => item.file_ref === fileRef)].filter((item): item is StoredManagedFileRecord => item !== undefined);
      if (fileRef !== undefined && !records.length) return fail("file_ref_unavailable");
      return records.map(publicRecord);
    },
    async exportFile(input: ManagedFileExportInput): Promise<ManagedFileRecord> {
      const ref = fileRef(input.file_ref);
      if (typeof input.destination_path !== "string" || !input.destination_path || input.destination_path.includes("\0")) return fail("file_destination_invalid");
      const state = await read();
      const record = state.materials.find(item => item.file_ref === ref);
      if (!record || record.status === "deleted") return fail("file_ref_unavailable");
      if (record.status === "expired") return fail("file_expired");
      const data = await readManagedBytes(record);
      const destination = resolve(input.destination_path);
      await ensureDirectory(dirname(destination));
      try { await lstat(destination); return fail("file_destination_exists"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const fd = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        let offset = 0;
        while (offset < data.length) {
          const result = await fd.write(data, offset, data.length - offset, null);
          if (!result.bytesWritten) return fail("file_export_failed");
          offset += result.bytesWritten;
        }
      } finally { await fd.close(); }
      return publicRecord(record);
    },
    async revoke(fileRefInput: string): Promise<ManagedFileRecord> {
      const ref = fileRef(fileRefInput);
      return transaction(async state => {
        const record = state.materials.find(item => item.file_ref === ref);
        if (!record) return fail("file_ref_unavailable");
        if (record.status === "available") record.status = "revoked";
        return publicRecord(record);
      });
    },
    async delete(fileRefInput: string): Promise<ManagedFileRecord> {
      const ref = fileRef(fileRefInput);
      return transaction(async state => {
        const record = state.materials.find(item => item.file_ref === ref);
        if (!record) return fail("file_ref_unavailable");
        if (record.storage_name) await rm(join(content, record.storage_name), { force: true });
        record.storage_name = null;
        record.status = "deleted";
        return publicRecord(record);
      });
    },
    async getForUse(fileRefInput: string, profileRef?: string): Promise<ManagedFileRecord & { path: string }> {
      const ref = fileRef(fileRefInput);
      const state = await read();
      const record = recordForUse(state, ref, profileRef);
      const path = join(content, record.storage_name!);
      // Verify the immutable copy before handing its private path to the
      // Provider.  The Provider's public set_input_files API accepts a path,
      // so a size-only check would leave a tampered copy observable at
      // dispatch time.
      await readManagedBytes(record);
      return { ...publicRecord(record), path };
    },
    async createDownloadStaging(operationRefInput: string): Promise<string> {
      const operationRef = safeOperationRef(operationRefInput);
      await ensureDirectory(staging);
      const path = join(staging, `${randomUUID()}-${operationRef.slice(-16)}.part`);
      const fd = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await fd.close();
      return path;
    },
    async commitDownloaded(input: ManagedFileDownloadCommitInput): Promise<ManagedFileRecord> {
      const stagingPath = resolve(input.staging_path);
      if (dirname(stagingPath) !== resolve(staging)) return fail("download_staging_unavailable");
      const opened = await readRealFile(stagingPath, "download_failed");
      try {
        if (opened.size > MANAGED_FILE_MAX_BYTES) return fail("file_limit_exceeded");
        const data = await readFd(opened.fd, opened.size);
        const result = await transaction(state => commitBytes(state, data, { profile_ref: input.profile_ref, source: "browser_download", display_name: input.display_name, mime_type: input.mime_type ?? extensionMime(input.display_name) ?? "application/octet-stream", operation_ref: input.operation_ref, principal_id: input.principal_id, max_file_bytes: input.max_file_bytes, allowed_mime_types: input.allowed_mime_types, runtime_session_ref: input.runtime_session_ref, page_ref: input.page_ref, page_id: input.page_id, origin: input.origin }));
        await rm(stagingPath, { force: true });
        return result;
      } finally { await opened.fd.close(); await rm(stagingPath, { force: true }).catch(() => undefined); }
    },
    async getOperation(operationRefInput: string): Promise<unknown | undefined> {
      const operationRef = safeOperationRef(operationRefInput);
      const state = await read();
      return state.operations.find(item => item.operation_ref === operationRef)?.result;
    },
    async putOperation(operationRefInput: string, requestHash: string, result: unknown): Promise<unknown> {
      const operationRef = safeOperationRef(operationRefInput);
      if (typeof requestHash !== "string" || !SHA256.test(requestHash)) return fail("file_operation_invalid");
      return transaction(state => {
        const previous = state.operations.find(item => item.operation_ref === operationRef);
        if (previous) {
          if (previous.request_hash !== requestHash) return fail("file_idempotency_conflict");
          return structuredClone(previous.result);
        }
        state.operations.push({ operation_ref: operationRef, request_hash: requestHash, result: structuredClone(result) });
        return result;
      });
    },
    async close(): Promise<void> {
      await ensureDirectory(root);
      const state = await read();
      const entries = await import("node:fs/promises").then(fs => fs.readdir(staging)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
        throw error;
      });
      for (const entry of entries) await rm(join(staging, entry), { force: true }).catch(() => undefined);
      await cleanupExpiredState(state, true);
    }
  };
}

export type ManagedFileStore = ReturnType<typeof createManagedFileStore>;
