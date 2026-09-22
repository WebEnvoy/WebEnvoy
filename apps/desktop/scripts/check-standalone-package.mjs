import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = resolve(process.argv[2] ?? "artifacts/webenvoy-standalone-macos-arm64");
const manifest = JSON.parse(await readFile(join(packageRoot, "agent-manifest.json"), "utf8"));
assert.equal(manifest.schema, "webenvoy-installed-standalone/v1");
assert.equal(manifest.package_kind, "standalone-runtime");
assert.equal(manifest.platform, "darwin");
assert.equal(manifest.arch, "arm64");
assert.equal(manifest.runtime?.executable, "runtime/node");
assert.equal(manifest.runtime?.node_version, "24.14.0");
await access(join(packageRoot, "bin/webenvoy"), constants.X_OK);
await access(join(packageRoot, "runtime/node"), constants.X_OK);
for (const path of ["agent-entry/cli.mjs", "agent-entry/mcp.mjs", "agent-entry/service.mjs", "dist-electron/runtime/core/start-runtime.mjs", "dist-electron/runtime/harbor/start-runtime.mjs"]) {
  await stat(join(packageRoot, path));
}
assert.equal(await fixedNodeVersion(packageRoot), `v${manifest.runtime.node_version}`);

const verifyScript = `import { verifyBundle } from './agent-entry/bundle.mjs'; console.log(JSON.stringify(await verifyBundle(process.cwd())));`;
const verified = spawnSync(join(packageRoot, manifest.runtime.executable), ["--input-type=module", "-e", verifyScript], {
  cwd: packageRoot,
  encoding: "utf8",
});
if (verified.status !== 0) throw new Error(`standalone_bundle_verification_failed: ${verified.stderr || verified.stdout}`);
const result = JSON.parse(verified.stdout.trim());
assert.equal(result.package_kind, "standalone-runtime");
assert.equal(result.host.kind, "standalone-node");
assert.equal(result.host.executable_integrity, "verified");
assert.equal(result.integrity, "verified");
assert.equal(result.host.platform, "darwin");
assert.equal(result.host.arch, "arm64");

console.log(JSON.stringify({ package_root: packageRoot, package_kind: result.package_kind, host: result.host, integrity: result.integrity }));

function fixedNodeVersion(root) {
  const result = spawnSync(join(root, "runtime/node"), ["--version"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`fixed_node_unavailable: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
