import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFixtureLauncher, detectBrowserProviders, HarborRuntime } from "./index.js";
import { firefoxUrlHash, mergeBookmarksIntoTarget, ProfileSourceError, ProfileSourceRegistry, PROFILE_SOURCE_BROWSER_VERSION } from "./profile-import.js";
import { acquireExternalProfileReadLock, profileStoragePath } from "./profile-storage.js";
import { identityInput, testProviderDetection } from "./identity-environment-mutation-test-helpers.js";

const placesSchema = `
  PRAGMA user_version = 86;
  CREATE TABLE moz_places (
    id INTEGER PRIMARY KEY, url TEXT, title TEXT, url_hash INTEGER NOT NULL DEFAULT 0,
    guid TEXT, rev_host TEXT, foreign_count INTEGER NOT NULL DEFAULT 0, visit_count INTEGER DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0, typed INTEGER NOT NULL DEFAULT 0, frecency INTEGER NOT NULL DEFAULT -1
  );
  CREATE TABLE moz_bookmarks (
    id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT,
    dateAdded INTEGER, lastModified INTEGER, guid TEXT UNIQUE, syncStatus INTEGER NOT NULL DEFAULT 0,
    syncChangeCounter INTEGER NOT NULL DEFAULT 1
  );`;

function profileAt(root: string, name: string, bookmarks: "source" | "empty" = "source"): string {
  const profile = join(root, name);
  mkdirSync(profile);
  writeFileSync(join(profile, "compatibility.ini"), `[Compatibility]\nLastVersion=${PROFILE_SOURCE_BROWSER_VERSION}_20260831224318/20260831224318\n`);
  const db = new DatabaseSync(join(profile, "places.sqlite"));
  try {
    db.exec(placesSchema);
    for (const [id, guid, title] of [[1, "root________", ""], [2, "menu________", "menu"], [3, "toolbar_____", "toolbar"], [4, "tags________", "tags"], [5, "unfiled_____", "unfiled"], [6, "mobile______", "mobile"]] as const) {
      db.prepare("INSERT INTO moz_bookmarks (id, type, parent, position, title, guid) VALUES (?, 2, ?, ?, ?, ?)").run(id, id === 1 ? 0 : 1, id - 1, title, guid);
    }
    if (bookmarks === "source") {
      const url = "https://example.com/caf%C3%A9?q=你好";
      db.prepare("INSERT INTO moz_places (id, url, title, url_hash, guid, rev_host, foreign_count) VALUES (1, ?, ?, ?, 'place-guid-1', 'moc.elpmaxe.', 1)").run(url, "Synthetic title", firefoxUrlHash(url));
      db.prepare("INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, dateAdded, lastModified, guid) VALUES (7, 1, 1, 3, 0, 'Synthetic title', 100, 200, 'book-mark-01')").run();
      db.prepare("INSERT INTO moz_bookmarks (id, type, parent, position, title, dateAdded, lastModified, guid) VALUES (8, 3, 3, 1, NULL, 100, 100, 'separator-01')").run();
      db.prepare("INSERT INTO moz_bookmarks (id, type, parent, position, title, dateAdded, lastModified, guid) VALUES (9, 2, 3, 2, 'Nested folder', 100, 100, 'folder-guid-1')").run();
      db.prepare("INSERT INTO moz_places (id, url, title, url_hash, guid, rev_host, foreign_count) VALUES (2, 'javascript:alert(1)', '', 0, 'place-guid-2', '', 1)").run();
      db.prepare("INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, dateAdded, lastModified, guid) VALUES (10, 1, 2, 9, 0, 'Unsafe URL', 100, 200, 'book-mark-02')").run();
    }
  } finally { db.close(); }
  return profile;
}

function camoufoxBundle(): string {
  const helper = join(dirname(fileURLToPath(import.meta.url)), "camoufox-bundle-validator.py");
  const script = "import importlib.util,json,sys; spec=importlib.util.spec_from_file_location('camoufox_bundle_validator',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps(module.build_environment_bundle({'fingerprint.seed':'fixture-seed','timezone':'UTC'}),ensure_ascii=False,separators=(',',':')))";
  return execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, helper], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  }).trim();
}

test("Firefox Places URL hash matches the stored hash for non-ASCII and percent-encoded URLs", () => {
  for (const url of ["http://example.test/path", "https://example.test/caf%C3%A9?q=你好", "https://例え.テスト/路径%20one"]) {
    const prefix = url.slice(0, url.indexOf(":"));
    const simple = (value: string) => {
      let hash = 0;
      for (const byte of Buffer.from(value, "utf8")) hash = Math.imul(((hash << 5) | (hash >>> 27)) ^ byte, 0x9e3779b9) >>> 0;
      return hash;
    };
    assert.equal(firefoxUrlHash(url), (simple(prefix) & 0xffff) * 0x1_0000_0000 + simple(url));
    assert.ok(Number.isSafeInteger(firefoxUrlHash(url)));
  }
});

test("source registry stores an opaque handle and reads only safe bookmark rows without changing source files", () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-source-"));
  const source = profileAt(root, "source");
  const registry = new ProfileSourceRegistry(join(root, "sources.json"));
  const before = readFileSync(join(source, "places.sqlite"));
  const handle = registry.register(source);
  assert.match(handle.source_ref, /^profile-source:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const serialized = JSON.stringify(handle);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes("Synthetic title"), false);
  assert.equal(handle.bookmark_count, 2);
  assert.equal(existsSync(join(root, "sources.json")), true);
  assert.equal(readFileSync(join(source, "places.sqlite")).equals(before), true);
  const snapshot = registry.readBookmarks(handle.source_ref);
  assert.equal(snapshot.bookmarks.length, 3);
  assert.equal(snapshot.bookmarks[0]?.kind, "bookmark");
  assert.equal(readFileSync(join(source, "places.sqlite")).equals(before), true);
  assert.equal(lstatSync(source).isDirectory(), true);
  try {
    const symlink = join(root, "source-link");
    symlinkSync(source, symlink);
    assert.throws(() => registry.register(symlink), error => error instanceof ProfileSourceError && error.code === "profile_source_invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("reads a stopped WAL-mode source through a private snapshot without creating source sidecars", () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-source-wal-"));
  try {
    const source = profileAt(root, "source");
    const db = new DatabaseSync(join(source, "places.sqlite"));
    try { db.exec("PRAGMA journal_mode=WAL"); } finally { db.close(); }
    const namesBefore = readdirSync(source).sort();
    assert.equal(namesBefore.includes("places.sqlite-wal"), false);
    assert.equal(namesBefore.includes("places.sqlite-shm"), false);
    const bytesBefore = namesBefore.map((name): [string, Buffer] => [name, readFileSync(join(source, name))]);
    const registry = new ProfileSourceRegistry(join(root, "sources.json"));
    const handle = registry.register(source);
    assert.equal(registry.readBookmarks(handle.source_ref).bookmarks.length, 3);
    assert.deepEqual(readdirSync(source).sort(), namesBefore);
    for (const [name, bytes] of bytesBefore) assert.equal(readFileSync(join(source, name)).equals(bytes), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source snapshot holds the provider lock and refuses a competing browser lock", { skip: process.platform !== "darwin" }, () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-source-lock-"));
  try {
    const source = profileAt(root, "source");
    const registry = new ProfileSourceRegistry(join(root, "sources.json"));
    const handle = registry.register(source);
    writeFileSync(join(source, ".parentlock"), "synthetic stopped-browser lock");
    const held = acquireExternalProfileReadLock(source);
    assert.ok(held, "the first importer acquires the provider's native lock");
    try {
      assert.throws(() => registry.openImportSnapshot(handle.source_ref), error => error instanceof ProfileSourceError && error.code === "profile_source_locked");
      assert.equal(held.stillValid(), true);
    } finally { held.release(); }
    const second = registry.openImportSnapshot(handle.source_ref);
    try { assert.equal(second.bookmarks.length, 3); }
    finally { second.release(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source fingerprint changes are rejected and revoked handles cannot be read", () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-source-state-"));
  try {
    const source = profileAt(root, "source");
    const registry = new ProfileSourceRegistry(join(root, "sources.json"));
    const handle = registry.register(source);
    const sourceDb = new DatabaseSync(join(source, "places.sqlite"));
    try { sourceDb.prepare("UPDATE moz_places SET title = 'changed' WHERE id = 1").run(); }
    finally { sourceDb.close(); }
    assert.throws(() => registry.readBookmarks(handle.source_ref), error => error instanceof ProfileSourceError && error.code === "profile_source_changed");
    registry.revoke(handle.source_ref);
    assert.throws(() => registry.readBookmarks(handle.source_ref), error => error instanceof ProfileSourceError && error.code === "profile_source_revoked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bookmark merge rehashes source URLs and reports unsafe URLs and separators without importing them", () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-bookmark-merge-"));
  try {
    const target = profileAt(root, "target", "empty");
    const sourceProfile = profileAt(root, "source");
    const registry = new ProfileSourceRegistry(join(root, "sources.json"));
    const handle = registry.register(sourceProfile);
    const sourceRows = registry.readBookmarks(handle.source_ref).bookmarks;
    const report = mergeBookmarksIntoTarget(join(target, "places.sqlite"), sourceRows);
    assert.equal(report.status, "partial");
    assert.deepEqual(report.imported, { bookmarks: 1, folders: 2 });
    assert.deepEqual(report.skipped, { bookmarks: 1, folders: 0, separators: 1, unsafe_urls: 1 });
    const targetDb = new DatabaseSync(join(target, "places.sqlite"), { readOnly: true });
    try {
      const imported = targetDb.prepare("SELECT p.url, p.url_hash, b.title FROM moz_bookmarks b JOIN moz_places p ON p.id=b.fk WHERE b.title='Synthetic title'").get() as Record<string, unknown>;
      assert.equal(imported.url_hash, firefoxUrlHash(String(imported.url)));
      assert.equal(imported.title, "Synthetic title");
      assert.equal(targetDb.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='moz_historyvisits'").get()?.count, 0);
    } finally { targetDb.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Profile import receipt is durable, opaque, and conflicts on a changed source or target", () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-import-receipt-"));
  try {
    const source = profileAt(root, "source");
    const registryPath = join(root, "sources.json");
    const registry = new ProfileSourceRegistry(registryPath);
    const handle = registry.register(source);
    const target = profileAt(root, "target", "empty");
    const report = mergeBookmarksIntoTarget(join(target, "places.sqlite"), registry.readBookmarks(handle.source_ref).bookmarks);
    const receipt = { schema_version: "harbor-profile-import-receipt/v1" as const, idempotency_key: "run:import", request_hash: "a".repeat(64), source_ref: handle.source_ref,
      target_profile_ref: "profile:target", target_identity_environment_ref: "identity:target", status: "completed" as const, report };
    registry.beginImport({ schema_version: receipt.schema_version, idempotency_key: receipt.idempotency_key, request_hash: receipt.request_hash,
      source_ref: receipt.source_ref, target_profile_ref: receipt.target_profile_ref, target_identity_environment_ref: receipt.target_identity_environment_ref });
    registry.saveImport(receipt);
    assert.deepEqual(new ProfileSourceRegistry(registryPath).getImport("run:import"), receipt);
    assert.equal(JSON.stringify(registry.getImport("run:import")).includes(source), false);
    assert.throws(() => registry.saveImport({ ...receipt, request_hash: "b".repeat(64) }), error => error instanceof ProfileSourceError && error.code === "profile_source_invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a failed post-commit receipt write remains unknown and blocks same-key replay", () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-import-post-commit-"));
  try {
    const source = profileAt(root, "source");
    const target = profileAt(root, "target", "empty");
    const targetPlaces = join(target, "places.sqlite");
    const registryPath = join(root, "sources.json");
    const registry = new ProfileSourceRegistry(registryPath);
    const handle = registry.register(source);
    const sourceBytes = readFileSync(join(source, "places.sqlite"));
    const snapshot = registry.openImportSnapshot(handle.source_ref);
    const intent = { schema_version: "harbor-profile-import-receipt/v1" as const, idempotency_key: "post-commit-fault",
      request_hash: "c".repeat(64), source_ref: handle.source_ref, target_profile_ref: "profile:target", target_identity_environment_ref: "identity:target" };
    const dispatch = registry.beginImport(intent);
    const report = mergeBookmarksIntoTarget(targetPlaces, snapshot.bookmarks, snapshot.assertUnchanged);
    snapshot.release();
    const completed = { ...dispatch, status: "completed" as const, report };
    const faultableRegistry = registry as unknown as { persist: (...args: unknown[]) => void };
    const originalPersist = faultableRegistry.persist;
    faultableRegistry.persist = () => { throw new Error("simulated durable receipt write failure"); };
    try { assert.throws(() => registry.saveImport(completed), /simulated durable receipt write failure/); }
    finally { faultableRegistry.persist = originalPersist; }

    const reopened = new ProfileSourceRegistry(registryPath);
    assert.equal(reopened.getImport("post-commit-fault")?.status, "possibly_dispatched");
    assert.throws(() => reopened.beginImport(intent), error => error instanceof ProfileSourceError && error.code === "profile_import_outcome_unknown");
    const targetDb = new DatabaseSync(targetPlaces, { readOnly: true });
    try { assert.equal(targetDb.prepare("SELECT count(*) AS count FROM moz_bookmarks WHERE title = 'Synthetic title'").get()?.count, 1); }
    finally { targetDb.close(); }
    assert.equal(readFileSync(join(source, "places.sqlite")).equals(sourceBytes), true, "post-commit recovery never modifies source bytes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Harbor import uses one idle managed Camoufox target, native source lock, and a durable pending receipt", { skip: process.platform !== "darwin" }, () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-profile-import-runtime-"));
  const previousProfileRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const managedRoot = join(root, "managed-profiles");
  process.env.HARBOR_PROFILE_STORAGE_ROOT = managedRoot;
  try {
    mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
    const persistencePath = join(root, "identity-environments.json");
    const creatingRuntime = new HarborRuntime(createFixtureLauncher("ready"), { persistence_path: persistencePath, provider_detection: testProviderDetection });
    const target = creatingRuntime.createLocalIdentityEnvironment(identityInput("identity:import-test", "profile:import-test"));
    const stored = JSON.parse(readFileSync(persistencePath, "utf8")) as { records: Array<{ local_material_refs: { profile_storage_ref: string }; identity_environment: { provider_binding: Record<string, unknown> } }> };
    assert.equal(stored.records.length, 1);
    const targetStorageRef = stored.records[0]!.local_material_refs.profile_storage_ref;
    const targetDirectory = profileStoragePath(targetStorageRef);
    mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    const emptyPlacesSource = profileAt(root, "target-schema", "empty");
    for (const name of ["compatibility.ini", "places.sqlite"]) writeFileSync(join(targetDirectory, name), readFileSync(join(emptyPlacesSource, name)));
    writeFileSync(join(targetDirectory, ".webenvoy-camoufox-environment.v1.json"), `${camoufoxBundle()}\n`, { mode: 0o600 });

    const detectedCamoufox = detectBrowserProviders({ platform: "darwin", arch: "arm64", home_dir: root,
      env: { HARBOR_CAMOUFOX_PATH: join(root, "camoufox-0.5.6") },
      path_exists: path => path.endsWith("camoufox-0.5.6"), is_executable: path => path.endsWith("camoufox-0.5.6"), read_text: () => null
    }).providers.find(provider => provider.provider_id === "camoufox");
    assert.ok(detectedCamoufox);
    stored.records[0]!.identity_environment.provider_binding = { ...stored.records[0]!.identity_environment.provider_binding,
      selected_provider_id: "camoufox", selected_provider: detectedCamoufox, fallback_provider_id: null };
    writeFileSync(persistencePath, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
    const runtime = new HarborRuntime(createFixtureLauncher("ready"), { persistence_path: persistencePath, provider_detection: testProviderDetection });

    const sourceDirectory = profileAt(root, "source");
    const sourceBytesBefore = readFileSync(join(sourceDirectory, "places.sqlite"));
    const source = runtime.registerProfileSource(sourceDirectory);
    assert.match(source.source_ref, /^profile-source:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(runtime.getActiveManagedIdentitySession(target.identity_environment_ref), null);
    const recovery = runtime.inspectProfileRecovery(target.refs.profile_ref);
    assert.equal(recovery.status, "completed", JSON.stringify(recovery));
    assert.equal(recovery.continuity, "matchable", JSON.stringify(recovery));

    const targetPlaces = join(targetDirectory, "places.sqlite");
    const beforeHeldOwnership = readFileSync(targetPlaces);
    writeFileSync(join(sourceDirectory, ".parentlock"), "synthetic stopped-browser lock");
    const sourceNamesBefore = readdirSync(sourceDirectory).sort();
    const ownership = acquireExternalProfileReadLock(sourceDirectory);
    assert.ok(ownership);
    try {
      assert.throws(() => runtime.importProfileBookmarks("locked-source", source.source_ref, target.refs.profile_ref), error => error instanceof ProfileSourceError && error.code === "profile_source_locked");
      assert.equal(runtime.getProfileImportResult("locked-source"), null, "source lock rejection occurs before durable dispatch");
      assert.equal(readFileSync(targetPlaces).equals(beforeHeldOwnership), true, "source lock rejection leaves the target untouched");
    } finally { ownership.release(); }

    const completed = runtime.importProfileBookmarks("actual-harbor-import", source.source_ref, target.refs.profile_ref);
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.report?.imported, { bookmarks: 1, folders: 2 });
    assert.equal(runtime.getActiveManagedIdentitySession(target.identity_environment_ref), null);
    assert.equal(readdirSync(sourceDirectory).sort().join("\0"), sourceNamesBefore.join("\0"));
    assert.equal(readFileSync(join(sourceDirectory, "places.sqlite")).equals(sourceBytesBefore), true);

    const registry = (runtime as unknown as { profileSources: { persist: (...args: unknown[]) => void } }).profileSources;
    const originalPersist = registry.persist;
    let importPersistenceCalls = 0;
    registry.persist = (...args: unknown[]) => {
      importPersistenceCalls++;
      if (importPersistenceCalls === 2) throw new Error("simulated durable receipt write failure");
      return originalPersist.apply(registry, args as never[]);
    };
    const rowsBeforeFault = new DatabaseSync(targetPlaces, { readOnly: true });
    let importedRowsBeforeFault: number;
    try { importedRowsBeforeFault = Number(rowsBeforeFault.prepare("SELECT count(*) AS count FROM moz_bookmarks WHERE title = 'Synthetic title'").get()?.count); }
    finally { rowsBeforeFault.close(); }
    try {
      assert.throws(() => runtime.importProfileBookmarks("post-commit-runtime-fault", source.source_ref, target.refs.profile_ref), /simulated durable receipt write failure/);
    } finally { registry.persist = originalPersist; }
    assert.equal(runtime.getProfileImportResult("post-commit-runtime-fault")?.status, "possibly_dispatched");
    assert.throws(() => runtime.importProfileBookmarks("post-commit-runtime-fault", source.source_ref, target.refs.profile_ref), /profile_import_outcome_unknown/);
    const rowsAfterFault = new DatabaseSync(targetPlaces, { readOnly: true });
    try { assert.equal(Number(rowsAfterFault.prepare("SELECT count(*) AS count FROM moz_bookmarks WHERE title = 'Synthetic title'").get()?.count), importedRowsBeforeFault + 1); }
    finally { rowsAfterFault.close(); }
    assert.equal(readFileSync(join(sourceDirectory, "places.sqlite")).equals(sourceBytesBefore), true, "even failed receipt persistence leaves source bytes unchanged");
  } finally {
    if (previousProfileRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousProfileRoot;
    rmSync(root, { recursive: true, force: true });
  }
});
