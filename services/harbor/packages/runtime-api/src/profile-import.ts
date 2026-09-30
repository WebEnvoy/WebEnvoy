import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  lstatSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  acquireExternalProfileReadLock,
  profileDirectoryHasExternalLock
} from "./profile-storage.js";
import { secureIdentityEnvironmentStoreFile, writeSecureJsonFile } from "./identity-environment-store.js";
import { opaqueRef } from "./refs.js";

export const HARBOR_PROFILE_SOURCE_SCHEMA = "harbor-profile-source/v1";
export const HARBOR_PROFILE_IMPORT_REPORT_SCHEMA = "harbor-profile-import-report/v1";
export const PROFILE_SOURCE_FORMAT = "camoufox.firefox-places.v86";
export const PROFILE_SOURCE_BROWSER_VERSION = "152.0.4-beta.30";
export const PROFILE_SOURCE_PLACES_VERSION = 86;
export const MAX_PROFILE_SOURCE_PLACES_BYTES = 128 * 1024 * 1024;
export const MAX_PROFILE_SOURCE_BOOKMARKS = 5_000;
const MAX_PROFILE_SOURCE_ITEMS = 10_000;
const MAX_SOURCE_HANDLES = 128;
const SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BOOKMARK_URL_LENGTH = 4_096;
const MAX_BOOKMARK_TITLE_LENGTH = 512;
const ROOT_GUIDS = ["menu________", "toolbar_____", "unfiled_____", "mobile______"] as const;

export type ProfileSourceFailureCode =
  | "profile_source_invalid"
  | "profile_source_locked"
  | "profile_source_changed"
  | "profile_source_unsupported"
  | "profile_source_expired"
  | "profile_source_revoked"
  | "profile_source_persistence_failed";

export class ProfileSourceError extends Error {
  constructor(readonly code: ProfileSourceFailureCode) {
    super(code);
  }
}

export interface ProfileSourcePublicRecord {
  schema_version: typeof HARBOR_PROFILE_SOURCE_SCHEMA;
  source_ref: string;
  provider_id: "camoufox";
  source_format: typeof PROFILE_SOURCE_FORMAT;
  bookmark_count: number;
  registered_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface StoredProfileSource extends ProfileSourcePublicRecord {
  canonical_path: string;
  fingerprint: string;
}

interface StoredProfileSourceState {
  schema_version: "harbor-profile-source-store/v1";
  sources: StoredProfileSource[];
  imports?: StoredProfileImportReceipt[];
}

export interface ProfileImportReceipt {
  schema_version: "harbor-profile-import-receipt/v1";
  idempotency_key: string;
  request_hash: string;
  source_ref: string;
  target_profile_ref: string;
  target_identity_environment_ref: string;
  report: ProfileImportReport;
}

interface StoredProfileImportReceipt extends ProfileImportReceipt { key_hash: string }

export interface ImportedBookmark {
  kind: "bookmark";
  title: string;
  url: string;
  date_added: number | null;
  last_modified: number | null;
}

export interface ImportedBookmarkFolder {
  kind: "folder";
  title: string;
  children: ImportedBookmarkNode[];
  date_added: number | null;
  last_modified: number | null;
}

export interface ImportedBookmarkSeparator {
  kind: "separator";
}

export type ImportedBookmarkNode = ImportedBookmark | ImportedBookmarkFolder | ImportedBookmarkSeparator;

export interface ProfileImportReport {
  schema_version: typeof HARBOR_PROFILE_IMPORT_REPORT_SCHEMA;
  status: "completed" | "partial";
  imported: { bookmarks: number; folders: number };
  skipped: { bookmarks: number; folders: number; separators: number; unsafe_urls: number };
  repair_status: "not_attempted";
  requires_login: true;
  exclusions: readonly ["history", "cookies", "logins", "extensions", "provider_configuration", "account_binding", "runtime_runs"];
}

export class ProfileSourceRegistry {
  private readonly sources = new Map<string, StoredProfileSource>();
  private readonly imports = new Map<string, StoredProfileImportReceipt>();
  private readonly path: string;

  constructor(configuredPath?: string) {
    this.path = configuredPath?.trim() || join(homedir(), ".webenvoy", "harbor", "profile-sources.json");
    this.load();
  }

  register(sourcePath: string): ProfileSourcePublicRecord {
    if (typeof sourcePath !== "string" || !sourcePath.trim() || sourcePath.length > 4_096 || /[\u0000-\u001f\u007f]/.test(sourcePath)) {
      throw new ProfileSourceError("profile_source_invalid");
    }
    let canonicalPath: string;
    try {
      const input = resolve(sourcePath.trim());
      const inputEntry = lstatSync(input);
      if (!inputEntry.isDirectory() || inputEntry.isSymbolicLink()) throw new Error("unsafe");
      canonicalPath = realpathSync.native(input);
    } catch {
      throw new ProfileSourceError("profile_source_invalid");
    }
    const snapshot = readSourceSnapshot(canonicalPath, null);
    if (this.sources.size >= MAX_SOURCE_HANDLES) throw new ProfileSourceError("profile_source_invalid");
    const now = Date.now();
    const source: StoredProfileSource = {
      schema_version: HARBOR_PROFILE_SOURCE_SCHEMA,
      source_ref: opaqueRef("profile-source"),
      provider_id: "camoufox",
      source_format: PROFILE_SOURCE_FORMAT,
      bookmark_count: snapshot.bookmarkCount,
      registered_at: new Date(now).toISOString(),
      expires_at: new Date(now + SOURCE_TTL_MS).toISOString(),
      revoked_at: null,
      canonical_path: canonicalPath,
      fingerprint: snapshot.fingerprint
    };
    const next = new Map(this.sources).set(source.source_ref, source);
    this.persist(next);
    replaceMap(this.sources, next);
    return publicSource(source);
  }

  list(): ProfileSourcePublicRecord[] {
    return [...this.sources.values()].map(publicSource);
  }

  inspect(sourceRef: string): ProfileSourcePublicRecord {
    const source = this.requireUsable(sourceRef);
    this.readBookmarks(sourceRef);
    return publicSource(source);
  }

  getImport(idempotencyKey: string): ProfileImportReceipt | undefined {
    const receipt = this.imports.get(createHash("sha256").update(idempotencyKey).digest("hex"));
    if (!receipt) return undefined;
    const { key_hash: _keyHash, ...publicReceipt } = receipt;
    return publicReceipt;
  }

  saveImport(receipt: ProfileImportReceipt): void {
    const keyHash = createHash("sha256").update(receipt.idempotency_key).digest("hex");
    const previous = this.imports.get(keyHash);
    if (previous) {
      if (previous.request_hash !== receipt.request_hash) throw new ProfileSourceError("profile_source_invalid");
      return;
    }
    const next = new Map(this.imports).set(keyHash, { ...receipt, key_hash: keyHash });
    this.persist(this.sources, next);
    replaceMap(this.imports, next);
  }

  revoke(sourceRef: string): ProfileSourcePublicRecord {
    const source = this.sources.get(sourceRef);
    if (!source) throw new ProfileSourceError("profile_source_invalid");
    if (source.revoked_at) return publicSource(source);
    const updated = { ...source, revoked_at: new Date().toISOString() };
    const next = new Map(this.sources).set(sourceRef, updated);
    this.persist(next);
    replaceMap(this.sources, next);
    return publicSource(updated);
  }

  readBookmarks(sourceRef: string): { bookmarks: ImportedBookmarkNode[]; fingerprint: string } {
    const source = this.requireUsable(sourceRef);
    const snapshot = readSourceSnapshot(source.canonical_path, source.fingerprint);
    if (snapshot.fingerprint !== source.fingerprint) throw new ProfileSourceError("profile_source_changed");
    return { bookmarks: snapshot.bookmarks, fingerprint: snapshot.fingerprint };
  }

  assertUnchanged(sourceRef: string, fingerprint: string): void {
    const source = this.requireUsable(sourceRef);
    const snapshot = readSourceSnapshot(source.canonical_path, source.fingerprint, false);
    if (snapshot.fingerprint !== fingerprint) throw new ProfileSourceError("profile_source_changed");
  }

  private requireUsable(sourceRef: string): StoredProfileSource {
    const source = this.sources.get(sourceRef);
    if (!source) throw new ProfileSourceError("profile_source_invalid");
    if (source.revoked_at) throw new ProfileSourceError("profile_source_revoked");
    if (Date.parse(source.expires_at) <= Date.now()) throw new ProfileSourceError("profile_source_expired");
    return source;
  }

  private load(): void {
    try {
      const entry = lstatSync(this.path);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("unsafe");
      secureIdentityEnvironmentStoreFile(this.path);
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as StoredProfileSourceState;
      if (!parsed || parsed.schema_version !== "harbor-profile-source-store/v1" || !Array.isArray(parsed.sources) || parsed.sources.length > MAX_SOURCE_HANDLES || parsed.imports !== undefined && (!Array.isArray(parsed.imports) || parsed.imports.length > 10_000)) throw new Error("invalid");
      for (const item of parsed.sources) {
        if (!isStoredProfileSource(item)) throw new Error("invalid");
        this.sources.set(item.source_ref, item);
      }
      for (const item of parsed.imports ?? []) {
        if (!isStoredProfileImportReceipt(item)) throw new Error("invalid");
        this.imports.set(item.key_hash, item);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw new ProfileSourceError("profile_source_persistence_failed");
    }
  }

  private persist(sources: Map<string, StoredProfileSource>, imports = this.imports): void {
    try {
      const state: StoredProfileSourceState = { schema_version: "harbor-profile-source-store/v1", sources: [...sources.values()], imports: [...imports.values()] };
      writeSecureJsonFile(this.path, state);
    } catch {
      throw new ProfileSourceError("profile_source_persistence_failed");
    }
  }
}

/** Read only public bookmarks from a stopped, version-matched Camoufox Profile. */
export function readSourceSnapshot(profileDir: string, expectedFingerprint: string | null, verifyLock = true): {
  bookmarks: ImportedBookmarkNode[];
  bookmarkCount: number;
  fingerprint: string;
} {
  const lock = verifyLock ? acquireExternalProfileReadLock(profileDir) : null;
  if (verifyLock && !lock) throw new ProfileSourceError("profile_source_locked");
  if (!verifyLock && profileDirectoryHasExternalLock(profileDir, false)) throw new ProfileSourceError("profile_source_locked");
  try {
    const placesPath = safePlacesPath(profileDir);
    const fingerprintBefore = sourceFingerprint(placesPath);
    if (expectedFingerprint !== null && fingerprintBefore !== expectedFingerprint) throw new ProfileSourceError("profile_source_changed");
    const db = new DatabaseSync(placesPath, { readOnly: true });
    let bookmarks: ImportedBookmarkNode[];
    let bookmarkCount: number;
    try {
      db.exec("BEGIN");
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== PROFILE_SOURCE_PLACES_VERSION) throw new ProfileSourceError("profile_source_unsupported");
      const placesColumns = columns(db, "moz_places");
      const bookmarkColumns = columns(db, "moz_bookmarks");
      if (!["id", "url", "title", "url_hash"].every(name => placesColumns.has(name)) ||
        !["id", "type", "fk", "parent", "position", "title", "dateAdded", "lastModified", "guid"].every(name => bookmarkColumns.has(name))) {
        throw new ProfileSourceError("profile_source_unsupported");
      }
      bookmarkCount = Number(db.prepare("SELECT count(*) AS count FROM moz_bookmarks WHERE type = 1").get()?.count ?? 0);
      const itemCount = Number(db.prepare("SELECT count(*) AS count FROM moz_bookmarks WHERE type IN (1, 2, 3)").get()?.count ?? 0);
      if (bookmarkCount > MAX_PROFILE_SOURCE_BOOKMARKS || itemCount > MAX_PROFILE_SOURCE_ITEMS) throw new ProfileSourceError("profile_source_unsupported");
      bookmarks = extractPublicBookmarks(db);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* The connection may already be closed. */ }
      if (error instanceof ProfileSourceError) throw error;
      throw new ProfileSourceError("profile_source_unsupported");
    } finally {
      db.close();
    }
    const fingerprintAfter = sourceFingerprint(placesPath);
    if (fingerprintAfter !== fingerprintBefore || lock && !lock.stillValid() || !lock && profileDirectoryHasExternalLock(profileDir, false)) {
      throw new ProfileSourceError("profile_source_changed");
    }
    return { bookmarks, bookmarkCount, fingerprint: fingerprintAfter };
  } catch (error) {
    if (error instanceof ProfileSourceError) throw error;
    throw new ProfileSourceError("profile_source_unsupported");
  } finally {
    lock?.release();
  }
}

export function mergeBookmarksIntoTarget(targetPlacesPath: string, bookmarks: ImportedBookmarkNode[], beforeCommit?: () => void): ProfileImportReport {
  let db: DatabaseSync;
  try {
    const entry = lstatSync(targetPlacesPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_PROFILE_SOURCE_PLACES_BYTES) throw new Error("unsafe");
    db = new DatabaseSync(targetPlacesPath);
  } catch {
    throw new ProfileSourceError("profile_source_unsupported");
  }
  const skipped = { bookmarks: 0, folders: 0, separators: 0, unsafe_urls: 0 };
  const imported = { bookmarks: 0, folders: 0 };
  const now = Date.now() * 1_000;
  const newGuid = () => createHash("sha256").update(`${process.pid}:${Date.now()}:${Math.random()}`).digest("base64url").slice(0, 12);
  try {
    db.exec("BEGIN IMMEDIATE");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== PROFILE_SOURCE_PLACES_VERSION) throw new ProfileSourceError("profile_source_unsupported");
    const placesColumns = columns(db, "moz_places");
    const bookmarkColumns = columns(db, "moz_bookmarks");
    if (!["id", "url", "title", "url_hash", "guid", "rev_host", "foreign_count"].every(name => placesColumns.has(name)) ||
      !["id", "type", "fk", "parent", "position", "title", "dateAdded", "lastModified", "guid", "syncStatus", "syncChangeCounter"].every(name => bookmarkColumns.has(name))) {
      throw new ProfileSourceError("profile_source_unsupported");
    }
    const toolbar = db.prepare("SELECT id FROM moz_bookmarks WHERE guid = 'toolbar_____'").get()?.id;
    if (typeof toolbar !== "number") throw new ProfileSourceError("profile_source_unsupported");
    const insertFolder = db.prepare("INSERT INTO moz_bookmarks (type, parent, position, title, dateAdded, lastModified, guid, syncStatus, syncChangeCounter) VALUES (2, ?, ?, ?, ?, ?, ?, 0, 1)");
    const insertBookmark = db.prepare("INSERT INTO moz_bookmarks (type, fk, parent, position, title, dateAdded, lastModified, guid, syncStatus, syncChangeCounter) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, 1)");
    const insertPlace = db.prepare("INSERT INTO moz_places (url, title, rev_host, visit_count, hidden, typed, frecency, guid, foreign_count, url_hash) VALUES (?, ?, ?, 0, 0, 0, -1, ?, 1, ?)");
    const findPlace = db.prepare("SELECT id FROM moz_places WHERE url = ? ORDER BY id LIMIT 1");
    const findBookmark = db.prepare("SELECT 1 AS present FROM moz_bookmarks WHERE type = 1 AND parent = ? AND fk = ? AND title = ? LIMIT 1");
    let rootPosition = Number(db.prepare("SELECT coalesce(max(position), -1) + 1 AS next FROM moz_bookmarks WHERE parent = ?").get(toolbar)?.next ?? 0);
    const visit = (nodes: ImportedBookmarkNode[], parent: number): void => {
      let position = 0;
      for (const node of nodes) {
        if (node.kind === "folder") {
          if (!safeBookmarkTitle(node.title)) { skipped.folders++; continue; }
          insertFolder.run(parent, position++, node.title, node.date_added ?? now, node.last_modified ?? now, newGuid());
          const folderId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
          imported.folders++;
          visit(node.children, folderId);
          continue;
        }
        if (node.kind === "separator") { skipped.separators++; continue; }
        if (!safeBookmarkTitle(node.title)) { skipped.bookmarks++; continue; }
        if (!safeBookmarkUrl(node.url)) { skipped.bookmarks++; skipped.unsafe_urls++; continue; }
        const existing = findPlace.get(node.url)?.id;
        let placeId: number;
        if (typeof existing === "number") placeId = existing;
        else {
          const url = new URL(node.url);
          const reverseHost = url.hostname.split("").reverse().join("") + ".";
          insertPlace.run(node.url, node.title, reverseHost, newGuid(), firefoxUrlHash(node.url));
          placeId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
        }
        if (findBookmark.get(parent, placeId, node.title)) { skipped.bookmarks++; continue; }
        insertBookmark.run(placeId, parent, position++, node.title, node.date_added ?? now, node.last_modified ?? now, newGuid());
        imported.bookmarks++;
      }
    };
    const root = newGuid();
    insertFolder.run(Number(toolbar), rootPosition++, "Imported bookmarks", now, now, root);
    const importRoot = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    imported.folders++;
    visit(bookmarks, importRoot);
    const status = Object.values(skipped).some(count => count > 0) ? "partial" : "completed";
    const report: ProfileImportReport = {
      schema_version: HARBOR_PROFILE_IMPORT_REPORT_SCHEMA,
      status,
      imported,
      skipped,
      repair_status: "not_attempted",
      requires_login: true,
      exclusions: ["history", "cookies", "logins", "extensions", "provider_configuration", "account_binding", "runtime_runs"]
    };
    beforeCommit?.();
    db.exec("COMMIT");
    return report;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Preserve the initial failure. */ }
    if (error instanceof ProfileSourceError) throw error;
    throw new ProfileSourceError("profile_source_unsupported");
  } finally {
    db.close();
  }
}

export function firefoxUrlHash(url: string): number {
  const colon = url.indexOf(":");
  const prefixHash = hashSimple(colon < 0 ? "" : url.slice(0, colon)) & 0xffff;
  return prefixHash * 0x1_0000_0000 + hashSimple(url);
}

function hashSimple(value: string): number {
  let hash = 0;
  for (const byte of Buffer.from(value, "utf8")) {
    const rotated = ((hash << 5) | (hash >>> 27)) ^ byte;
    hash = Math.imul(rotated, 0x9e3779b9) >>> 0;
  }
  return hash;
}

function extractPublicBookmarks(db: DatabaseSync): ImportedBookmarkNode[] {
  const rows = db.prepare("SELECT id, type, fk, parent, position, title, dateAdded, lastModified, guid FROM moz_bookmarks WHERE type IN (1, 2, 3) ORDER BY parent, position, id").all() as Array<Record<string, unknown>>;
  const placeRows = db.prepare("SELECT id, url, title FROM moz_places WHERE id IN (SELECT fk FROM moz_bookmarks WHERE type = 1 AND fk IS NOT NULL)").all() as Array<Record<string, unknown>>;
  const places = new Map(placeRows.map(row => [Number(row.id), { url: String(row.url ?? ""), title: String(row.title ?? "") }]));
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  const children = new Map<number, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const parent = Number(row.parent);
    const list = children.get(parent) ?? [];
    list.push(row);
    children.set(parent, list);
  }
  const roots = new Map(rows.filter(row => ROOT_GUIDS.includes(String(row.guid) as typeof ROOT_GUIDS[number])).map(row => [String(row.guid), Number(row.id)]));
  const visited = new Set<number>();
  const build = (parentId: number, depth: number): ImportedBookmarkNode[] => {
    if (depth > 32) throw new ProfileSourceError("profile_source_unsupported");
    const result: ImportedBookmarkNode[] = [];
    for (const row of children.get(parentId) ?? []) {
      const id = Number(row.id);
      if (visited.has(id)) throw new ProfileSourceError("profile_source_unsupported");
      visited.add(id);
      const title = String(row.title ?? "");
      const dateAdded = nullableNumber(row.dateAdded);
      const lastModified = nullableNumber(row.lastModified);
      if (Number(row.type) === 2) {
        result.push({ kind: "folder", title, date_added: dateAdded, last_modified: lastModified, children: build(id, depth + 1) });
      } else if (Number(row.type) === 1) {
        const place = places.get(Number(row.fk));
        if (!place || !safeBookmarkUrl(place.url)) {
          result.push({ kind: "bookmark", title: "", url: "invalid:", date_added: dateAdded, last_modified: lastModified });
        } else {
          result.push({ kind: "bookmark", title: title || place.title, url: place.url, date_added: dateAdded, last_modified: lastModified });
        }
      } else {
        result.push({ kind: "separator" });
      }
    }
    return result;
  };
  return ROOT_GUIDS.flatMap(guid => {
    const rootId = roots.get(guid);
    return rootId === undefined ? [] : build(rootId, 0);
  });
}

function safePlacesPath(profileDir: string): string {
  const compatibilityPath = join(profileDir, "compatibility.ini");
  try {
    const rootEntry = lstatSync(profileDir);
    const compatibilityEntry = lstatSync(compatibilityPath);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || !compatibilityEntry.isFile() || compatibilityEntry.isSymbolicLink()) throw new Error("unsafe");
    const version = /^LastVersion=(.+)$/m.exec(readFileSync(compatibilityPath, "utf8"))?.[1]?.split("_")[0];
    if (version !== PROFILE_SOURCE_BROWSER_VERSION) throw new ProfileSourceError("profile_source_unsupported");
    const placesPath = join(profileDir, "places.sqlite");
    const placesEntry = lstatSync(placesPath);
    if (!placesEntry.isFile() || placesEntry.isSymbolicLink() || placesEntry.size <= 0 || placesEntry.size > MAX_PROFILE_SOURCE_PLACES_BYTES) throw new Error("unsafe");
    return placesPath;
  } catch (error) {
    if (error instanceof ProfileSourceError) throw error;
    throw new ProfileSourceError("profile_source_invalid");
  }
}

function sourceFingerprint(placesPath: string): string {
  const hash = createHash("sha256");
  for (const name of ["places.sqlite", "places.sqlite-wal"]) {
    const path = name === "places.sqlite" ? placesPath : `${placesPath}-wal`;
    try {
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_PROFILE_SOURCE_PLACES_BYTES) throw new Error("unsafe");
      hash.update(name).update("\0").update(readFileSync(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") hash.update(name).update("\0missing");
      else throw error;
    }
  }
  return hash.digest("hex");
}

function columns(db: DatabaseSync, table: "moz_places" | "moz_bookmarks"): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)));
}

function safeBookmarkUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_BOOKMARK_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function safeBookmarkTitle(value: string): boolean {
  return typeof value === "string" && value.length <= MAX_BOOKMARK_TITLE_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function publicSource(source: StoredProfileSource): ProfileSourcePublicRecord {
  const { canonical_path: _path, fingerprint: _fingerprint, ...publicRecord } = source;
  return publicRecord;
}

function isStoredProfileSource(value: unknown): value is StoredProfileSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schema_version === HARBOR_PROFILE_SOURCE_SCHEMA && typeof item.source_ref === "string" &&
    item.provider_id === "camoufox" && item.source_format === PROFILE_SOURCE_FORMAT &&
    Number.isInteger(item.bookmark_count) && typeof item.registered_at === "string" && typeof item.expires_at === "string" &&
    (item.revoked_at === null || typeof item.revoked_at === "string") && typeof item.canonical_path === "string" &&
    /^[0-9a-f]{64}$/.test(String(item.fingerprint));
}

function isStoredProfileImportReceipt(value: unknown): value is StoredProfileImportReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schema_version === "harbor-profile-import-receipt/v1" && typeof item.idempotency_key === "string" &&
    typeof item.request_hash === "string" && /^[0-9a-f]{64}$/.test(item.request_hash) && typeof item.key_hash === "string" &&
    /^[0-9a-f]{64}$/.test(item.key_hash) && typeof item.source_ref === "string" && typeof item.target_profile_ref === "string" &&
    typeof item.target_identity_environment_ref === "string" && Boolean(item.report) &&
    typeof item.report === "object" && (item.report as Record<string, unknown>).schema_version === HARBOR_PROFILE_IMPORT_REPORT_SCHEMA;
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}
