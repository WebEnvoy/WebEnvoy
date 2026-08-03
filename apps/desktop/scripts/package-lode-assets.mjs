import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const outDir = path.resolve("dist-electron/lode");
const sourceLock = JSON.parse(await readFile(new URL("./runtime-source-lock.json", import.meta.url), "utf8"));
const sourceRepository = findLodeRepository(sourceLock.lode);

await rm(outDir, { recursive: true, force: true });

if (!sourceRepository) {
  console.warn(`Lode asset packaging skipped: no repository contains locked commit ${sourceLock.lode}.`);
  process.exit(0);
}

const exportRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-assets-"));
try {
  exportLockedAssets(sourceRepository, sourceLock.lode, exportRoot);
  await mkdir(outDir, { recursive: true });
  await copyJsonTree(path.join(exportRoot, "registry"), path.join(outDir, "registry"));
  await copyJsonTree(path.join(exportRoot, "sites"), path.join(outDir, "sites"));
} finally {
  await rm(exportRoot, { recursive: true, force: true });
}

console.log(`Packaged Lode capability assets from ${sourceLock.lode} in ${sourceRepository} into ${outDir}`);

function findLodeRepository(expectedHead) {
  const candidates = [
    process.env.WEBENVOY_LODE_ASSETS_SOURCE_DIR,
    path.resolve("../Lode"),
    path.resolve("../../Lode"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (hasCommit(candidate, expectedHead)) return candidate;
    if (candidate === process.env.WEBENVOY_LODE_ASSETS_SOURCE_DIR) {
      throw new Error(`Lode source does not contain locked commit ${expectedHead}: ${candidate}`);
    }
  }
  return null;
}

function hasCommit(candidate, expectedHead) {
  if (!existsSync(candidate)) return false;
  const result = spawnSync("git", ["cat-file", "-e", `${expectedHead}^{commit}`], {
    cwd: candidate,
    encoding: "utf8",
  });
  return result.status === 0;
}

function exportLockedAssets(repository, expectedHead, target) {
  const archive = spawnSync("git", ["archive", "--format=tar", expectedHead, "registry", "sites"], {
    cwd: repository,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error(`Unable to export locked Lode assets: ${archive.stderr?.toString() ?? "git archive failed"}`);
  const extract = spawnSync("tar", ["-x", "-C", target], { input: archive.stdout, encoding: "utf8" });
  if (extract.status !== 0) throw new Error(`Unable to extract locked Lode assets: ${extract.stderr || "tar failed"}`);
}

async function copyJsonTree(from, to) {
  if (!existsSync(from)) return;
  await cp(from, to, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return source === from || (!name.startsWith(".") && (!path.extname(source) || source.endsWith(".json")));
    },
  });
}
