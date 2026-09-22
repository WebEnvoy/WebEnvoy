import { chmod, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { files, sha } from "../agent-entry/bundle.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(process.argv[2] ?? "artifacts/webenvoy-standalone-macos-arm64");
const archivePath = `${outputRoot}.tar.gz`;
const nodeSource = resolve(process.execPath);
const nodeVersion = process.versions.node;
const requiredNodeVersion = "24.14.0";

assertBuildHost();
for (const path of [outputRoot, archivePath, `${archivePath}.sha256`]) {
  try {
    await stat(path);
    throw new Error(`Output already exists; choose a new standalone package path: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const runtimeState = await readJson(join(appRoot, "dist-electron/runtime/packaging-state.json"));
if (runtimeState.schema_version !== "webenvoy-app-packaged-runtime-assets/v1" || runtimeState.status !== "ready") {
  throw new Error(`Packaged Core/Harbor runtime assets are not ready: ${JSON.stringify(runtimeState)}`);
}
const lode = await readJsonIfPresent(join(appRoot, "dist-electron/lode/provenance.json"));

await mkdir(outputRoot, { recursive: true, mode: 0o755 });
const agentEntryRoot = join(appRoot, "agent-entry");
await cp(agentEntryRoot, join(outputRoot, "agent-entry"), {
  recursive: true,
  dereference: true,
  filter: (source) => source === agentEntryRoot || (!source.endsWith(".test.mjs") && !source.includes("/privatefixtures/")),
});
await mkdir(join(outputRoot, "dist-electron"), { recursive: true, mode: 0o755 });
for (const file of ["runtimeSupervisor.js", "lodeAssetBundle.js", "lodeAssetAccess.js"]) {
  await cp(join(appRoot, "dist-electron", file), join(outputRoot, "dist-electron", file), { dereference: true });
}
for (const directory of ["runtime", ...(lode ? ["lode"] : [])]) {
  await cp(join(appRoot, "dist-electron", directory), join(outputRoot, "dist-electron", directory), { recursive: true, dereference: true });
}

const nodePath = join(outputRoot, "runtime/node");
await mkdir(dirname(nodePath), { recursive: true, mode: 0o755 });
await cp(nodeSource, nodePath, { dereference: true });
await chmod(nodePath, 0o755);
await cp(join(dirname(dirname(nodeSource)), "LICENSE"), join(outputRoot, "runtime/Node-LICENSE"));
await mkdir(join(outputRoot, "licenses"), { mode: 0o755 });
for (const [name, source] of [
  ["WebEnvoy", join(appRoot, "../../LICENSE")],
  ["Agent-entry", join(appRoot, "LICENSE")],
  ["Harbor", join(appRoot, "../../services/harbor/LICENSE")],
]) await cp(source, join(outputRoot, "licenses", `${name}.txt`));
await writeFile(join(outputRoot, "SOURCE.txt"), `WebEnvoy source: https://github.com/WebEnvoy/WebEnvoy/tree/${runtimeState.workspace.commit}\nNode.js source and notices: https://github.com/nodejs/node/tree/v${nodeVersion}\nSee licenses/ and runtime/Node-LICENSE.\n`);
const nodeHash = sha(await readFile(nodePath));
if (nodeHash !== sha(await readFile(nodeSource))) throw new Error("standalone_node_copy_integrity_failed");

const launcherPath = join(outputRoot, "bin/webenvoy");
await mkdir(dirname(launcherPath), { recursive: true, mode: 0o755 });
await writeFile(launcherPath, `#!/bin/sh
set -eu
bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$bin_dir/.." && pwd)
node="$root/runtime/node"
if [ ! -x "$node" ]; then
  echo "webenvoy: fixed Node runtime is missing or not executable" >&2
  exit 7
fi
exec "$node" "$root/agent-entry/cli.mjs" "$@"
`, { mode: 0o755 });
await chmod(launcherPath, 0o755);

const allFiles = await files(outputRoot);
const optionalFiles = Object.fromEntries(Object.entries(allFiles).filter(([name]) =>
  (name.startsWith("dist-electron/lode/") && name !== "dist-electron/lode/provenance.json") || name.startsWith("agent-entry/skill-assets/"),
));
const requiredFiles = Object.fromEntries(Object.entries(allFiles).filter(([name]) => !(name in optionalFiles)));
const manifest = {
  schema: "webenvoy-installed-standalone/v1",
  package_kind: "standalone-runtime",
  version: "0.2.0",
  skill_version: "0.2.0",
  platform: process.platform,
  arch: process.arch,
  runtime: {
    kind: "node",
    platform: process.platform,
    arch: process.arch,
    node_version: nodeVersion,
    executable: "runtime/node",
    executable_sha256: nodeHash,
  },
  host: {
    kind: "standalone-node",
    platform: process.platform,
    arch: process.arch,
    node_version: nodeVersion,
    executable: "runtime/node",
    executable_sha256: nodeHash,
  },
  workspace: runtimeState.workspace,
  lode,
  files: requiredFiles,
  optional_files: optionalFiles,
};
await writeFile(join(outputRoot, "agent-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

const standaloneBundle = await import(pathToFileURL(join(outputRoot, "agent-entry/bundle.mjs")).href);
const verified = await standaloneBundle.verifyBundle(outputRoot, { hostExecutable: nodePath });
if (verified.package_kind !== "standalone-runtime" || verified.host.executable_sha256 !== nodeHash) {
  throw new Error(`standalone_bundle_verification_failed: ${JSON.stringify(verified)}`);
}

const archive = spawnSync("tar", ["-czf", archivePath, "-C", dirname(outputRoot), basename(outputRoot)], {
  stdio: "inherit",
});
if (archive.status !== 0) throw new Error(`standalone_archive_failed: ${archive.status ?? "unknown"}`);
const archiveHash = createHash("sha256").update(await readFile(archivePath)).digest("hex");
await writeFile(`${archivePath}.sha256`, `${archiveHash}  ${basename(archivePath)}\n`, { mode: 0o644 });

console.log(JSON.stringify({
  package_root: outputRoot,
  archive: archivePath,
  archive_sha256: archiveHash,
  manifest: join(outputRoot, "agent-manifest.json"),
  manifest_sha256: sha(await readFile(join(outputRoot, "agent-manifest.json"))),
  platform: process.platform,
  arch: process.arch,
  node_version: nodeVersion,
  node_executable_sha256: nodeHash,
  release: false,
  electron: false,
  workspace: runtimeState.workspace,
}));

function assertBuildHost() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("standalone_package_requires_macos_arm64");
  if (nodeVersion !== requiredNodeVersion) throw new Error(`standalone_package_requires_node_${requiredNodeVersion}: ${nodeVersion}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfPresent(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
