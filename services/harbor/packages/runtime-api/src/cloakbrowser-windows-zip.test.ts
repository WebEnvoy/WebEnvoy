import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractCloakBrowserArchive } from "./cloakbrowser-archive.js";

const windowsOnly = { skip: process.platform !== "win32" };

test("Windows ZIP extraction reaches ExtractToDirectory for safe content and rejects unsafe fixtures", windowsOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-windows-zip-"));
  const cases = [
    { name: "traversal", entry: "../escaped.txt", contents: "escape", attributes: 0, limit: 1_024, error: /unsafe archive path/i },
    { name: "symlink", entry: "browser-link", contents: "browser.exe", attributes: 0xa0000000, limit: 1_024, error: /links are not allowed/i },
    { name: "reparse", entry: "browser-reparse", contents: "browser.exe", attributes: 0x00000400, limit: 1_024, error: /links are not allowed/i },
    { name: "expanded", entry: "browser.exe", contents: "too-large", attributes: 0, limit: 4, error: /expanded-byte limit/i }
  ] as const;
  try {
    const validArchive = join(root, "valid.zip");
    const validDestination = join(root, "valid-destination");
    await writeFile(validArchive, zipWithSingleStoredEntry("release/browser.exe", "valid-browser", 0));
    await extractCloakBrowserArchive({
      archive_path: validArchive,
      destination_dir: validDestination,
      platform: "win32",
      signal: new AbortController().signal,
      limits: { max_entries: 4, max_expanded_bytes: 1_024 }
    });
    assert.equal(await readFile(join(validDestination, "browser.exe"), "utf8"), "valid-browser");
    await assert.rejects(access(join(validDestination, "release")));

    for (const fixture of cases) {
      const archive = join(root, `${fixture.name}.zip`);
      const destination = join(root, `${fixture.name}-destination`);
      await writeFile(archive, zipWithSingleStoredEntry(fixture.entry, fixture.contents, fixture.attributes));
      await assert.rejects(extractCloakBrowserArchive({
        archive_path: archive,
        destination_dir: destination,
        platform: "win32",
        signal: new AbortController().signal,
        limits: { max_entries: 4, max_expanded_bytes: fixture.limit }
      }), fixture.error);
      await assert.rejects(access(destination));
    }
    await assert.rejects(access(join(root, "escaped.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function zipWithSingleStoredEntry(name: string, contents: string, externalAttributes: number): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const body = Buffer.from(contents, "utf8");
  const crc = crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(externalAttributes === 0 ? 20 : 0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(externalAttributes >>> 0, 38);

  const centralOffset = local.length + nameBytes.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, body, central, nameBytes, end]);
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
