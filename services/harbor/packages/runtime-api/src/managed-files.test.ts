import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createManagedFileStore, ManagedFileError, MANAGED_FILE_MAX_MATERIALS, MANAGED_FILE_RETENTION_MS } from "./managed-files.js";

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
const csv = Buffer.from("id,status\n1,ok\n", "utf8");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const rejectsCode = (action: Promise<unknown>, code: string) => assert.rejects(action, (error: unknown) => error instanceof ManagedFileError && error.code === code);

test("managed file owner store validates immutable copies, types, and export boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-managed-files-"));
  const sourceDir = await mkdtemp(join(tmpdir(), "webenvoy-managed-file-source-"));
  try {
    const source = join(sourceDir, "source.png");
    await writeFile(source, png, { mode: 0o600 });
    const store = createManagedFileStore({ root });
    const imported = await store.importFile({ source_path: source, profile_ref: "profile:one" });
    assert.equal(imported.source, "owner_import");
    assert.equal(imported.mime_type, "image/png");
    assert.equal(imported.detected_mime_type, "image/png");
    assert.equal(imported.byte_length, png.length);
    assert.equal(imported.sha256, sha(png));
    assert.equal(imported.status, "available");
    assert.equal((await readFile(source)).equals(png), true);
    assert.equal((await store.inspect(imported.file_ref))[0]?.file_ref, imported.file_ref);

    const exported = join(sourceDir, "export.png");
    assert.equal((await store.exportFile({ file_ref: imported.file_ref, destination_path: exported })).file_ref, imported.file_ref);
    assert.equal((await readFile(exported)).equals(png), true);
    await rejectsCode(store.exportFile({ file_ref: imported.file_ref, destination_path: exported }), "file_destination_exists");
    const destinationTarget = join(sourceDir, "destination-target");
    await writeFile(destinationTarget, "do not overwrite");
    const destinationLink = join(sourceDir, "destination-link");
    await symlink(destinationTarget, destinationLink);
    await rejectsCode(store.exportFile({ file_ref: imported.file_ref, destination_path: destinationLink }), "file_destination_exists");
    assert.equal(await readFile(destinationTarget, "utf8"), "do not overwrite");

    const mismatched = join(sourceDir, "mismatch.png");
    await writeFile(mismatched, csv);
    await rejectsCode(store.importFile({ source_path: mismatched, profile_ref: "profile:one", mime_type: "image/png" }), "file_type_mismatch");
    const sourceLink = join(sourceDir, "source-link.png");
    await symlink(source, sourceLink);
    await rejectsCode(store.importFile({ source_path: sourceLink, profile_ref: "profile:one" }), "file_symlink_rejected");
    await rejectsCode(store.importFile({ source_path: sourceDir, profile_ref: "profile:one" }), "file_source_not_regular");
    await rejectsCode(store.importFile({ source_path: `${source}\0`, profile_ref: "profile:one" }), "file_source_invalid");

    const operationResult = { status: "completed", operation_ref: "operation:one" };
    const operationHash = sha(Buffer.from("request"));
    assert.deepEqual(await store.putOperation("operation:one", operationHash, operationResult), operationResult);
    assert.deepEqual(await store.putOperation("operation:one", operationHash, { changed: true }), operationResult);
    await rejectsCode(store.putOperation("operation:one", sha(Buffer.from("other")), operationResult), "file_idempotency_conflict");

    const staging = await store.createDownloadStaging("operation:csv");
    await writeFile(staging, csv);
    const downloaded = await store.commitDownloaded({ staging_path: staging, profile_ref: "profile:one", operation_ref: "operation:csv", principal_id: "principal:one", display_name: "receipt.csv", runtime_session_ref: "session:one", page_ref: "page:one", page_id: "page-id:one", origin: "https://files.example.test", max_file_bytes: csv.length, allowed_mime_types: ["text/csv"] });
    assert.equal(downloaded.source, "browser_download");
    assert.equal(downloaded.principal_id, "principal:one");
    assert.equal(downloaded.sha256, sha(csv));
    await assert.rejects(readFile(staging), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    const reloaded = createManagedFileStore({ root });
    assert.equal((await reloaded.inspect(downloaded.file_ref))[0]?.sha256, sha(csv));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test("managed file store enforces quotas, revocation, expiry, and tamper evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "webenvoy-managed-files-quota-"));
  const sourceDir = await mkdtemp(join(tmpdir(), "webenvoy-managed-file-quota-source-"));
  let current = new Date("2026-09-13T00:00:00.000Z");
  try {
    const source = join(sourceDir, "item.txt");
    await writeFile(source, "bounded", { mode: 0o600 });
    const store = createManagedFileStore({ root, clock: () => current });
    const refs: string[] = [];
    for (let index = 0; index < MANAGED_FILE_MAX_MATERIALS; index++) refs.push((await store.importFile({ source_path: source, profile_ref: "profile:one", display_name: `item-${index}.txt` })).file_ref);
    await rejectsCode(store.importFile({ source_path: source, profile_ref: "profile:one", display_name: "overflow.txt" }), "file_limit_exceeded");
    const revoked = await store.revoke(refs[0]!);
    assert.equal(revoked.status, "revoked");
    await rejectsCode(store.importFile({ source_path: source, profile_ref: "profile:one", display_name: "still-full.txt" }), "file_limit_exceeded");
    assert.equal((await store.exportFile({ file_ref: refs[0]!, destination_path: join(sourceDir, "revoked.txt") })).status, "revoked");
    await store.delete(refs[0]!);
    const replacement = await store.importFile({ source_path: source, profile_ref: "profile:one", display_name: "replacement.txt" });
    assert.equal(replacement.status, "available");
    const revokedExpiry = await store.revoke(refs[2]!);
    assert.equal(revokedExpiry.status, "revoked");

    const indexPath = join(root, "index.json");
    const state = JSON.parse(await readFile(indexPath, "utf8")) as { materials: Array<{ file_ref: string; storage_name: string | null }> };
    const tampered = state.materials.find(item => item.file_ref === refs[1]);
    assert(tampered?.storage_name);
    await writeFile(join(root, "content", tampered.storage_name), "tampered");
    await rejectsCode(store.exportFile({ file_ref: refs[1]!, destination_path: join(sourceDir, "tampered.txt") }), "file_integrity_mismatch");

    current = new Date(current.getTime() + MANAGED_FILE_RETENTION_MS + 1);
    const expired = (await store.inspect()).find(item => item.file_ref === refs[1]);
    assert.equal(expired?.status, "expired");
    const revokedAfterExpiry = (await store.inspect()).find(item => item.file_ref === revokedExpiry.file_ref);
    assert.equal(revokedAfterExpiry?.status, "expired");
    await rejectsCode(store.exportFile({ file_ref: refs[1]!, destination_path: join(sourceDir, "expired.txt") }), "file_expired");
    const contentNames = await readdir(join(root, "content"));
    assert.equal(contentNames.some(name => name === tampered.storage_name), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});
