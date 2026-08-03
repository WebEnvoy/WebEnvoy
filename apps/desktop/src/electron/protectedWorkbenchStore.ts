import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { credentialBearingValue } from "./credentialBearingValue.js";

export type ProtectedStorageCodec = {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
};

export type ProtectedDraftContext = {
  packageRef: string;
  version: string;
  identityId: string;
};

export type ProtectedDraftAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  localRef?: string;
};

export type ProtectedDraft = {
  context: ProtectedDraftContext;
  values: Record<string, string | boolean | string[]>;
  attachments: Record<string, ProtectedDraftAttachment[]>;
  omittedFieldIds: string[];
};

type StoredFile = Omit<ProtectedDraftAttachment, "localRef"> & { localRef: string; path: string; touchedAt: number };
type StoredDraft = ProtectedDraft & { updatedAt: number };
type SealedInput = ProtectedDraft & { createdAt: number; ownerRef: string };
type ProtectedState = {
  schemaVersion: "webenvoy.protected-workbench.v2";
  files: Record<string, StoredFile>;
  drafts: Record<string, StoredDraft>;
  sealedInputs: Record<string, SealedInput>;
};

export type SealedInputRefs = {
  ownerRef: string;
  fieldOwnerRefs: Record<string, string>;
  attachmentRefs: Record<string, string[]>;
};

const emptyState = (): ProtectedState => ({ schemaVersion: "webenvoy.protected-workbench.v2", files: {}, drafts: {}, sealedInputs: {} });
const maxEncryptedBytes = 1024 * 1024;
const maxPlaintextBytes = 512 * 1024;
const maxDraftBytes = 64 * 1024;
const maxFiles = 256;
const maxDrafts = 64;
const maxSealedInputs = 32;
const localRefPattern = /^local_file_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sealedInputRefPattern = /^draft:app-protected\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProtectedWorkbenchStore {
  private state = emptyState();
  private writes = Promise.resolve();

  private constructor(private readonly filePath: string, private readonly codec: ProtectedStorageCodec | null) {}

  static async open(filePath: string, codec: ProtectedStorageCodec | null) {
    const store = new ProtectedWorkbenchStore(filePath, codec);
    await store.restore();
    return store;
  }

  get available() {
    return this.codec != null;
  }

  async registerFile(file: Omit<StoredFile, "id" | "localRef" | "touchedAt">) {
    if (!this.available || !validSelectedFile(file)) return null;
    let localRef = "";
    let registered = false;
    const saved = await this.update((state) => {
      trimOldestUnusedFiles(state, maxFiles - 1);
      if (Object.keys(state.files).length >= maxFiles) return;
      localRef = `local_file_ref_${randomUUID()}`;
      state.files[localRef] = { ...file, id: localRef, localRef, touchedAt: Date.now() };
      registered = true;
    });
    return saved && registered ? localRef : null;
  }

  resolveLocalRef(value: unknown) {
    if (!this.available || typeof value !== "string" || !localRefPattern.test(value)) return null;
    const file = this.state.files[value];
    if (file == null) return null;
    file.touchedAt = Date.now();
    return file.path;
  }

  async checkLocalRef(value: unknown) {
    const filePath = this.resolveLocalRef(value);
    if (filePath == null) return { readable: false, reason: "invalid_reference" as const };
    try {
      const metadata = await stat(filePath);
      const link = await lstat(filePath);
      if (!metadata.isFile() || link.isSymbolicLink()) return { readable: false, reason: "not_regular_file" as const };
      await access(filePath, constants.R_OK);
      return { readable: true, reason: "readable" as const };
    } catch {
      return { readable: false, reason: "unreadable" as const };
    }
  }

  async releaseLocalRefs(value: unknown) {
    const localRefs = parseLocalRefs(value);
    if (!this.available || localRefs == null) return false;
    return this.update((state) => removeUnusedFiles(state, new Set(localRefs)));
  }

  loadDraft(value: unknown) {
    const context = parseContext(value);
    if (!this.available || context == null) return null;
    const draft = this.state.drafts[draftKey(context)];
    if (draft == null) return null;
    const { updatedAt: _updatedAt, ...restored } = draft;
    return structuredClone(restored) as ProtectedDraft;
  }

  async saveDraft(value: unknown) {
    const draft = parseDraft(value);
    if (!this.available || draft == null || Buffer.byteLength(JSON.stringify(draft)) > maxDraftBytes) return false;
    return this.update((state) => {
      const key = draftKey(draft.context);
      const candidates = state.drafts[key] == null ? new Set<string>() : draftLocalRefs(state.drafts[key]);
      state.drafts[key] = { ...draft, updatedAt: Date.now() };
      for (const removed of trimOldest(state.drafts, maxDrafts, (entry) => entry.updatedAt)) {
        for (const localRef of draftLocalRefs(removed)) candidates.add(localRef);
      }
      removeUnusedFiles(state, candidates);
    });
  }

  async deleteDraft(value: unknown) {
    const context = parseContext(value);
    if (!this.available || context == null) return false;
    return this.update((state) => {
      const removed = state.drafts[draftKey(context)];
      delete state.drafts[draftKey(context)];
      if (removed != null) removeUnusedFiles(state, draftLocalRefs(removed));
    });
  }

  async sealInput(value: unknown): Promise<SealedInputRefs | null> {
    const draft = parseDraft(value);
    if (!this.available || draft == null || draft.omittedFieldIds.length > 0 ||
      Buffer.byteLength(JSON.stringify(draft)) > maxDraftBytes) return null;
    const ownerRef = `draft:app-protected/${randomUUID()}`;
    let refs: SealedInputRefs | null = null;
    const saved = await this.update((state) => {
      if (Object.keys(state.sealedInputs).length >= maxSealedInputs) return;
      const attachmentFieldIds = Object.keys(draft.attachments);
      const attachmentLocalRefs = Object.values(draft.attachments).flatMap((attachments) =>
        attachments.map((attachment) => attachment.localRef),
      );
      if (attachmentLocalRefs.some((localRef) => localRef == null || state.files[localRef] == null)) return;
      const fieldOwnerRefs = Object.fromEntries(
        [...new Set([...Object.keys(draft.values), ...attachmentFieldIds])].map((fieldId) => [fieldId, `${ownerRef}/${fieldId}`]),
      );
      const attachmentRefs = Object.fromEntries(Object.entries(draft.attachments).map(([fieldId, attachments]) => [
        fieldId,
        attachments.map((_, index) => `attachment:app-protected/${ownerRef.slice("draft:app-protected/".length)}/${fieldId}/${index}`),
      ]));
      state.sealedInputs[ownerRef] = { ...draft, createdAt: Date.now(), ownerRef };
      refs = { ownerRef, fieldOwnerRefs, attachmentRefs };
    });
    return saved ? refs : null;
  }

  async releaseSealedInputs(value: unknown) {
    const ownerRefs = parseSealedInputRefs(value);
    if (!this.available || ownerRefs == null) return false;
    return this.update((state) => {
      const localRefs = new Set<string>();
      for (const ownerRef of ownerRefs) {
        const input = state.sealedInputs[ownerRef];
        if (input == null) continue;
        for (const localRef of sealedInputLocalRefs(input)) localRefs.add(localRef);
        delete state.sealedInputs[ownerRef];
      }
      removeUnusedFiles(state, localRefs);
    });
  }

  private async restore() {
    if (this.codec == null) return;
    try {
      const encrypted = await readFile(this.filePath);
      if (encrypted.length > maxEncryptedBytes) throw new Error("Protected workbench store exceeds its budget.");
      const plaintext = this.codec.decrypt(encrypted);
      if (Buffer.byteLength(plaintext) > maxPlaintextBytes) throw new Error("Protected workbench plaintext exceeds its budget.");
      const state = parseState(JSON.parse(plaintext) as unknown);
      if (state == null) throw new Error("Protected workbench store is malformed.");
      this.state = state;
      removeUnusedFiles(this.state, new Set([
        ...Object.values(this.state.drafts).flatMap((draft) => [...draftLocalRefs(draft)]),
        ...Object.values(this.state.sealedInputs).flatMap((input) => [...sealedInputLocalRefs(input)]),
      ]), true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      await unlink(this.filePath).catch(() => undefined);
      this.state = emptyState();
    }
  }

  private update(mutator: (state: ProtectedState) => void) {
    let result = false;
    const operation = this.writes.catch(() => undefined).then(async () => {
      if (this.codec == null) return;
      const next = structuredClone(this.state) as ProtectedState;
      mutator(next);
      const plaintext = JSON.stringify(next);
      if (Buffer.byteLength(plaintext) > maxPlaintextBytes) return;
      const encrypted = this.codec.encrypt(plaintext);
      if (encrypted.length > maxEncryptedBytes) return;
      await atomicWrite(this.filePath, encrypted);
      this.state = next;
      result = true;
    });
    this.writes = operation.catch(() => undefined);
    return operation.then(() => result, () => false);
  }
}

async function atomicWrite(filePath: string, value: Buffer) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, value, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function parseState(value: unknown): ProtectedState | null {
  if (!isRecord(value) || !["webenvoy.protected-workbench.v1", "webenvoy.protected-workbench.v2"].includes(String(value.schemaVersion)) ||
    !hasOnlyKeys(value, value.schemaVersion === "webenvoy.protected-workbench.v1"
      ? ["schemaVersion", "files", "drafts"]
      : ["schemaVersion", "files", "drafts", "sealedInputs"]) ||
    !isRecord(value.files) || !isRecord(value.drafts) || (value.sealedInputs !== undefined && !isRecord(value.sealedInputs)) ||
    Object.keys(value.files).length > maxFiles || Object.keys(value.drafts).length > maxDrafts) return null;
  const files = Object.fromEntries(Object.entries(value.files).flatMap(([key, file]) => {
    const parsed = parseStoredFile(file);
    return parsed != null && key === parsed.localRef ? [[key, parsed]] : [];
  }));
  const drafts = Object.fromEntries(Object.entries(value.drafts).flatMap(([key, draft]) => {
    const parsed = parseStoredDraft(draft);
    return parsed != null && key === draftKey(parsed.context) ? [[key, parsed]] : [];
  }));
  const rawSealedInputs = isRecord(value.sealedInputs) ? value.sealedInputs : {};
  if (Object.keys(rawSealedInputs).length > maxSealedInputs) return null;
  const sealedInputs = Object.fromEntries(Object.entries(rawSealedInputs).flatMap(([key, input]) => {
    const parsed = parseSealedInput(input);
    return parsed != null && key === parsed.ownerRef ? [[key, parsed]] : [];
  }));
  return Object.keys(files).length === Object.keys(value.files).length && Object.keys(drafts).length === Object.keys(value.drafts).length &&
    Object.keys(sealedInputs).length === Object.keys(rawSealedInputs).length
    ? { schemaVersion: "webenvoy.protected-workbench.v2", files, drafts, sealedInputs }
    : null;
}

function parseDraft(value: unknown): ProtectedDraft | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["context", "values", "attachments", "omittedFieldIds"])) return null;
  const context = parseContext(value.context);
  if (context == null || !isRecord(value.values) || !isRecord(value.attachments) || !validOmittedIds(value.omittedFieldIds)) return null;
  if (!Object.entries(value.values).every(([id, item]) => safeFieldId(id) && validDraftValue(item) && !credentialBearingValue(item)) ||
    !Object.entries(value.attachments).every(([id, items]) => safeFieldId(id) && validAttachments(items))) return null;
  return { context, values: value.values as ProtectedDraft["values"], attachments: value.attachments as ProtectedDraft["attachments"], omittedFieldIds: value.omittedFieldIds };
}

function parseStoredDraft(value: unknown): StoredDraft | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["context", "values", "attachments", "omittedFieldIds", "updatedAt"]) || !validTime(value.updatedAt)) return null;
  const draft = parseDraft({ context: value.context, values: value.values, attachments: value.attachments, omittedFieldIds: value.omittedFieldIds });
  return draft == null ? null : { ...draft, updatedAt: Number(value.updatedAt) };
}

function parseSealedInput(value: unknown): SealedInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["context", "values", "attachments", "omittedFieldIds", "createdAt", "ownerRef"]) ||
    !validTime(value.createdAt) || typeof value.ownerRef !== "string" || !/^draft:app-protected\/[0-9a-f-]{36}$/i.test(value.ownerRef)) return null;
  const draft = parseDraft({ context: value.context, values: value.values, attachments: value.attachments, omittedFieldIds: value.omittedFieldIds });
  return draft == null || draft.omittedFieldIds.length > 0 ? null : { ...draft, createdAt: Number(value.createdAt), ownerRef: value.ownerRef };
}

function parseContext(value: unknown): ProtectedDraftContext | null {
  return isRecord(value) && hasOnlyKeys(value, ["packageRef", "version", "identityId"]) &&
    boundedText(value.packageRef, 2048) && boundedText(value.version, 128) && boundedText(value.identityId, 512, true)
    ? { packageRef: value.packageRef, version: value.version, identityId: value.identityId }
    : null;
}

function parseStoredFile(value: unknown): StoredFile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "localRef", "name", "size", "type", "lastModified", "path", "touchedAt"]) ||
    !validSelectedFile(value) || value.id !== value.localRef || !localRefPattern.test(String(value.localRef)) || !validTime(value.touchedAt)) return null;
  return value as StoredFile;
}

function validSelectedFile(value: Record<string, unknown>) {
  return boundedText(value.path, 4096) && path.isAbsolute(value.path) && !value.path.includes("\0") &&
    boundedText(value.name, 255) && boundedText(value.type, 255, true) && validSize(value.size) && validTime(value.lastModified);
}

function validAttachments(value: unknown): value is ProtectedDraftAttachment[] {
  return Array.isArray(value) && value.length <= 32 && value.every((item) => isRecord(item) &&
    Object.keys(item).every((key) => ["id", "name", "size", "type", "lastModified", "localRef"].includes(key)) &&
    boundedText(item.id, 8192) && boundedText(item.name, 255) && boundedText(item.type, 255, true) &&
    validSize(item.size) && validTime(item.lastModified) && (item.localRef === undefined || typeof item.localRef === "string" && localRefPattern.test(item.localRef)));
}

function parseLocalRefs(value: unknown) {
  return Array.isArray(value) && value.length <= 32 && value.every((item) => typeof item === "string" && localRefPattern.test(item))
    ? value as string[]
    : null;
}

function parseSealedInputRefs(value: unknown) {
  return Array.isArray(value) && value.length <= maxSealedInputs &&
    value.every((item) => typeof item === "string" && sealedInputRefPattern.test(item))
    ? [...new Set(value)] as string[]
    : null;
}

function validDraftValue(value: unknown) {
  return typeof value === "boolean" || boundedText(value, 64 * 1024, true) ||
    Array.isArray(value) && value.length <= 100 && value.every((item) => boundedText(item, 2048, true));
}

function safeFieldId(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value) && ![
    "password", "cookie", "token", "secret", "credential", "authorization", "profilestorage",
    "rawevidence", "evidence", "har", "trace", "networkbody", "securityid", "accesskey", "apikey",
  ].some((term) => normalized.includes(term));
}

function validOmittedIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) => boundedText(item, 128));
}

function draftKey(context: ProtectedDraftContext) {
  return `${context.packageRef}\u0000${context.version}\u0000${context.identityId}`;
}

function draftLocalRefs(draft: ProtectedDraft) {
  return new Set(Object.values(draft.attachments).flatMap((items) => items.flatMap((item) => item.localRef == null ? [] : [item.localRef])));
}

function sealedInputLocalRefs(input: SealedInput) {
  return draftLocalRefs(input);
}

function removeUnusedFiles(state: ProtectedState, candidates: Set<string>, removeOthers = false) {
  const used = new Set([
    ...Object.values(state.drafts).flatMap((draft) => [...draftLocalRefs(draft)]),
    ...Object.values(state.sealedInputs).flatMap((input) => [...sealedInputLocalRefs(input)]),
  ]);
  for (const ref of Object.keys(state.files)) {
    if ((removeOthers || candidates.has(ref)) && !used.has(ref)) delete state.files[ref];
  }
}

function trimOldestUnusedFiles(state: ProtectedState, targetCount: number) {
  const used = new Set([
    ...Object.values(state.drafts).flatMap((draft) => [...draftLocalRefs(draft)]),
    ...Object.values(state.sealedInputs).flatMap((input) => [...sealedInputLocalRefs(input)]),
  ]);
  const removable = Object.values(state.files).filter((file) => !used.has(file.localRef))
    .sort((left, right) => left.touchedAt - right.touchedAt);
  while (Object.keys(state.files).length > targetCount && removable.length > 0) {
    const file = removable.shift();
    if (file != null) delete state.files[file.localRef];
  }
}

function trimOldest<T>(record: Record<string, T>, limit: number, timestamp: (value: T) => number) {
  const removed = Object.entries(record).sort((left, right) => timestamp(left[1]) - timestamp(right[1]))
    .slice(0, Math.max(0, Object.keys(record).length - limit));
  for (const [key] of removed) delete record[key];
  return removed.map(([, value]) => value);
}

function boundedText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
}

function validSize(value: unknown) {
  return Number.isFinite(value) && Number(value) >= 0 && Number(value) <= Number.MAX_SAFE_INTEGER;
}

function validTime(value: unknown) {
  return Number.isFinite(value) && Number(value) >= 0 && Number(value) <= Date.now() + 24 * 60 * 60_000;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
