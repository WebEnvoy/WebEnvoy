import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { firefoxUrlHash, mergeBookmarksIntoTarget, ProfileSourceError, ProfileSourceRegistry, PROFILE_SOURCE_BROWSER_VERSION } from "./profile-import.js";

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
      target_profile_ref: "profile:target", target_identity_environment_ref: "identity:target", report };
    registry.saveImport(receipt);
    assert.deepEqual(new ProfileSourceRegistry(registryPath).getImport("run:import"), receipt);
    assert.equal(JSON.stringify(registry.getImport("run:import")).includes(source), false);
    assert.throws(() => registry.saveImport({ ...receipt, request_hash: "b".repeat(64) }), error => error instanceof ProfileSourceError && error.code === "profile_source_invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
