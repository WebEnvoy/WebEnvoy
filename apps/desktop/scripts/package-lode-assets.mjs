import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.resolve("dist-electron/lode");
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = path.resolve(appRoot, "../..");
const sourceLock = JSON.parse(await readFile(new URL("./runtime-source-lock.json", import.meta.url), "utf8"));
const lodeLock = sourceLock.lode;
assertLodeLock(lodeLock);
const sourceRepository = findLodeRepository(lodeLock.commit);

await rm(outDir, { recursive: true, force: true });

if (!sourceRepository) {
  console.warn(`Lode asset packaging skipped: no repository contains locked commit ${lodeLock.commit}.`);
  process.exit(0);
}

const exportRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-assets-"));
try {
  exportLockedAssets(sourceRepository, lodeLock, exportRoot);
  await mkdir(outDir, { recursive: true });
  await copyJsonTree(path.join(exportRoot, "registry"), path.join(outDir, "registry"));
  await copyJsonTree(path.join(exportRoot, "sites"), path.join(outDir, "sites"));
  await writeFile(
    path.join(outDir, "provenance.json"),
    `${JSON.stringify({ schema_version: "webenvoy-lode-asset-provenance/v1", ...lodeLock }, null, 2)}\n`,
  );
} finally {
  await rm(exportRoot, { recursive: true, force: true });
}

console.log(`Packaged Lode capability assets from ${lodeLock.commit} in ${sourceRepository} into ${outDir}`);

function assertLodeLock(value) {
  if (
    value?.repository !== "WebEnvoy/Lode" ||
    !/^[0-9a-f]{40}$/.test(value.commit ?? "") ||
    !/^[0-9a-f]{40}$/.test(value.tree ?? "") ||
    !/^[0-9a-f]{64}$/.test(value.raw_assets_sha256 ?? "")
  ) {
    throw new Error("Lode source lock must declare repository, commit, tree, and raw_assets_sha256.");
  }
}

function findLodeRepository(expectedHead) {
  const candidates = [
    process.env.WEBENVOY_LODE_ASSETS_SOURCE_DIR,
    path.resolve(workspaceRoot, "../Lode"),
    path.resolve(workspaceRoot, "../../Lode"),
    path.resolve(workspaceRoot, "../Lode.worktrees/lode-290-search-pin"),
    path.resolve(workspaceRoot, "../../Lode.worktrees/lode-290-search-pin"),
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

function exportLockedAssets(repository, lock, target) {
  const tree = spawnSync("git", ["rev-parse", `${lock.commit}^{tree}`], { cwd: repository, encoding: "utf8" });
  if (tree.status !== 0 || tree.stdout.trim() !== lock.tree) {
    throw new Error(`Lode tree does not match locked tree ${lock.tree}: ${tree.stderr || tree.stdout}`);
  }
  const archive = spawnSync("git", ["archive", "--format=tar", lock.commit, "registry", "sites"], {
    cwd: repository,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error(`Unable to export locked Lode assets: ${archive.stderr?.toString() ?? "git archive failed"}`);
  const rawAssetsSha256 = createHash("sha256").update(archive.stdout).digest("hex");
  if (rawAssetsSha256 !== lock.raw_assets_sha256) {
    throw new Error(`Lode raw asset hash does not match locked hash ${lock.raw_assets_sha256}: ${rawAssetsSha256}`);
  }
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
