import assert from "node:assert/strict";
import { cpSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(packageRoot, "../..");

test("Core build restores public capability definition permissions under restrictive umask", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "core-build-permissions-"));
  const temporaryPackage = join(temporaryRoot, "packages", "core");
  const temporaryDist = join(temporaryPackage, "dist");
  const destination = join(temporaryDist, "managed-capability-definitions.json");
  try {
    mkdirSync(join(temporaryPackage, "src"), { recursive: true });
    mkdirSync(temporaryDist, { recursive: true });
    cpSync(join(packageRoot, "src"), join(temporaryPackage, "src"), { recursive: true });
    cpSync(join(packageRoot, "package.json"), join(temporaryPackage, "package.json"));
    cpSync(join(packageRoot, "tsconfig.json"), join(temporaryPackage, "tsconfig.json"));
    symlinkSync(join(workspaceRoot, "node_modules"), join(temporaryRoot, "node_modules"), "dir");
    symlinkSync(join(workspaceRoot, "tsconfig.base.json"), join(temporaryRoot, "tsconfig.base.json"));

    const source = readFileSync(join(packageRoot, "src", "managed-capability-definitions.json"));
    writeFileSync(destination, "stale generated content", { mode: 0o600 });
    chmodSync(destination, 0o600);

    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { scripts: { build: string } };
    const previousUmask = process.umask(0o077);
    let build;
    try {
      build = spawnSync("sh", ["-c", manifest.scripts.build], {
        cwd: temporaryPackage,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(workspaceRoot, "node_modules", ".bin")}:${process.env.PATH ?? ""}`
        }
      });
    } finally {
      process.umask(previousUmask);
    }

    assert.equal(build.status, 0, `${build.stderr}\n${build.error?.message ?? ""}`);
    assert.equal(statSync(destination).mode & 0o777, 0o644);
    assert.deepEqual(readFileSync(destination), source);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
