import assert from "node:assert/strict";
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareProfileStorage, profileStorageHasExternalLock, profileStoragePath, stageProfileStorageCopy } from "./profile-storage.js";

test("managed storage refuses root, Profile and cloned child symlinks without touching their targets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-storage-boundary-"));
  const previous = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const outside = join(dir, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "sentinel"), "untouched");
  try {
    const root = join(dir, "profiles");
    process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
    symlinkSync(outside, root);
    await assert.rejects(prepareProfileStorage("source"), /mutation_failed/);
    rmSync(root);
    mkdirSync(root);
    symlinkSync(outside, profileStoragePath("source"));
    await assert.rejects(prepareProfileStorage("source"), /mutation_failed/);
    assert.throws(() => stageProfileStorageCopy("source", "target", "full"), /mutation_failed/);
    rmSync(profileStoragePath("source"));
    const source = await prepareProfileStorage("source");
    symlinkSync(outside, join(source.profileDir, "child"));
    assert.throws(() => stageProfileStorageCopy("source", "target", "full"), /mutation_failed/);
    assert.equal(existsSync(profileStoragePath("target")), false);
    assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "untouched");
    rmSync(join(source.profileDir, "child"));
    writeFileSync(join(source.profileDir, "data"), "persisted");
    const copy = stageProfileStorageCopy("source", "target", "full");
    copy.commit();
    assert.equal(readFileSync(join(profileStoragePath("target"), "data"), "utf8"), "persisted");
    writeFileSync(join(source.profileDir, ".parentlock"), "");
    if (process.platform === "darwin") {
      const fd = openSync(join(source.profileDir, ".parentlock"), constants.O_RDONLY | constants.O_NONBLOCK | 0x20);
      try {
        assert.equal(profileStorageHasExternalLock("source"), true);
        assert.throws(() => stageProfileStorageCopy("source", "blocked", "full"), /profile_locked/);
      } finally {
        closeSync(fd);
      }
      assert.equal(profileStorageHasExternalLock("source"), false);
    } else {
      assert.equal(profileStorageHasExternalLock("source"), true);
      rmSync(join(source.profileDir, ".parentlock"));
    }
  } finally {
    if (previous === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
