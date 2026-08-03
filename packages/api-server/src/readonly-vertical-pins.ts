import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export const requiredCoreContractCommit = "a8325687abf01833a4b477f39f66cca4c9979ce1";
export const pinnedHarborCommit = "bcfc1b902c3fb8c2fd691c805a2ada1ddae51181";
export const pinnedLodeCommit = "6238d3f9de0cd09157c9769e27d90174c299406a";

export const harborFixtureWireContract = {
  schema_version: "webenvoy.harbor-owner-fixture-contract.v0",
  routes: [
    "POST /runtime/identity-environment-sessions",
    "GET /runtime/sessions/{runtime_session_ref}/runtime-facts",
    "GET /runtime/sessions/{runtime_session_ref}",
    "GET /runtime/sessions/{runtime_session_ref}/site-resource-facts",
    "POST /runtime/sessions/{runtime_session_ref}/snapshot",
    "POST /runtime/sessions/{runtime_session_ref}/read-operations",
    "POST /runtime/sessions/{runtime_session_ref}/release"
  ],
  response_schemas: [
    "harbor-core-runtime-facts/v0", "harbor-runtime-facts/v0", "harbor-site-resource-facts/v0",
    "harbor-page-scene-refs/v0", "harbor-allowlisted-read-operation/v0"
  ],
  rollback: { canonical_failure_class: "runtime_facts_unsupported", legacy_route: "GET /runtime/sessions/{runtime_session_ref}" }
} as const;

const harborSourceLocators = [
  {
    path: "packages/runtime-api/src/server.ts",
    sha256: "ab1ec0e9b6069afd585587129b1172998651ee920ae925139704055d626b0689",
    markers: ["/runtime/identity-environment-sessions", "runtime-facts", "site-resource-facts", "read-operations"]
  },
  {
    path: "packages/runtime-api/src/server.test.ts",
    sha256: "eb9e191137b2d33fb1cd5dd6b266ae2ebb3dd038e5ffc5019c6b67b9165b256f",
    markers: ["harbor-core-runtime-facts/v0", "session_missing", "site-resource-facts"]
  },
  {
    path: "packages/runtime-api/src/server-smoke.ts",
    sha256: "3d696ece51554eb4b5c8dbc469213e43948066ee2755ca77e44d202ca19aa2e0",
    markers: ["harbor-core-runtime-facts/v0", "harbor-site-resource-facts/v0", "identity-environment-sessions"]
  },
  {
    path: "packages/runtime-api/src/site-runtime-facts.ts",
    sha256: "b3b678dfd6b19c0ff8868e1b0ef7d588880347aec10b760938efa930263321ac",
    markers: ["harbor-site-resource-facts/v0"]
  }
] as const;

const execFileAsync = promisify(execFile);
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export function harborFixtureContractDigest(): string {
  return sha256(JSON.stringify({ harborFixtureWireContract, harborSourceLocators }));
}

export type PinnedLodeArtifact = {
  root: string;
  registryPath: string;
  source: "checkout" | "git-archive";
  cleanup?: () => Promise<void>;
};

export type CoreProvenance = {
  head: string;
  required_contract_commit: string;
  worktree_state: "clean" | "dirty";
};

export type HarborContractProvenance = {
  commit: string;
  source: "exact-git-object";
  fixture_contract_digest: string;
  source_locators: Array<{ path: string; sha256: string }>;
};

async function gitText(root: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return typeof result.stdout === "string" ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function gitBuffer(root: string, args: string[]): Promise<Buffer | undefined> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    return result.stdout as Buffer;
  } catch {
    return undefined;
  }
}

export async function resolveCoreProvenance(): Promise<CoreProvenance | undefined> {
  const root = await gitText(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!root) return undefined;
  const head = await gitText(root, ["rev-parse", "HEAD"]);
  const contract = await gitText(root, ["cat-file", "-t", `${requiredCoreContractCommit}^{commit}`]);
  const status = await gitText(root, ["status", "--porcelain", "--untracked-files=no"]);
  const ancestry = head ? await gitText(root, ["merge-base", "--is-ancestor", requiredCoreContractCommit, head]) : undefined;
  if (!head || contract !== "commit" || status === undefined || ancestry === undefined) return undefined;
  return { head, required_contract_commit: requiredCoreContractCommit, worktree_state: status === "" ? "clean" : "dirty" };
}

function lodeCandidates(): string[] {
  const configuredRoot = process.env.WEBENVOY_LODE_ROOT;
  const configuredRegistry = process.env.WEBENVOY_LODE_REGISTRY_PATH;
  return [
    ...(configuredRoot ? [configuredRoot] : []),
    ...(configuredRegistry ? [dirname(dirname(configuredRegistry))] : []),
    join(process.cwd(), "..", "Lode"), join(process.cwd(), "..", "Lode.worktrees", "lode-290-search-pin"),
    join(process.cwd(), "..", "..", "Lode"), join(process.cwd(), "..", "..", "Lode.worktrees", "lode-290-search-pin")
  ];
}

async function archivePinnedLode(repository: string): Promise<PinnedLodeArtifact | undefined> {
  let root: string | undefined;
  try {
    const archive = await gitBuffer(repository, ["archive", "--format=tar", pinnedLodeCommit]);
    if (!archive) return undefined;
    root = await mkdtemp(join(tmpdir(), "webenvoy-lode-pinned-"));
    const archivePath = join(root, "lode.tar");
    await writeFile(archivePath, archive);
    await execFileAsync("tar", ["-xf", archivePath, "-C", root]);
    await rm(archivePath, { force: true });
    return {
      root, registryPath: join(root, "registry", "local-packages.json"), source: "git-archive",
      cleanup: () => rm(root as string, { recursive: true, force: true })
    };
  } catch {
    if (root) await rm(root, { recursive: true, force: true });
    return undefined;
  }
}

export async function resolvePinnedLodeArtifact(): Promise<PinnedLodeArtifact | undefined> {
  const seen = new Set<string>();
  for (const candidate of lodeCandidates()) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const head = await gitText(candidate, ["rev-parse", "HEAD"]);
    if (head === pinnedLodeCommit && await gitText(candidate, ["status", "--porcelain"]) === "") {
      if (await gitText(candidate, ["cat-file", "-e", "HEAD:registry/local-packages.json"]) !== undefined) {
        return { root: candidate, registryPath: join(candidate, "registry", "local-packages.json"), source: "checkout" };
      }
    }
    if (await gitText(candidate, ["cat-file", "-t", `${pinnedLodeCommit}^{commit}`]) === "commit") {
      const artifact = await archivePinnedLode(candidate);
      if (artifact) return artifact;
    }
  }
  return undefined;
}

function harborCandidates(): string[] {
  return [
    ...(process.env.WEBENVOY_HARBOR_ROOT ? [process.env.WEBENVOY_HARBOR_ROOT] : []),
    join(process.cwd(), "..", "Harbor"), join(process.cwd(), "..", "..", "Harbor")
  ];
}

async function verifyHarborRepository(repository: string): Promise<HarborContractProvenance | undefined> {
  if (await gitText(repository, ["rev-parse", `${pinnedHarborCommit}^{commit}`]) !== pinnedHarborCommit) return undefined;
  for (const locator of harborSourceLocators) {
    const content = await gitBuffer(repository, ["show", `${pinnedHarborCommit}:${locator.path}`]);
    if (!content || sha256(content) !== locator.sha256) return undefined;
    const text = content.toString("utf8");
    if (locator.markers.some((marker) => !text.includes(marker))) return undefined;
  }
  return {
    commit: pinnedHarborCommit,
    source: "exact-git-object",
    fixture_contract_digest: harborFixtureContractDigest(),
    source_locators: harborSourceLocators.map(({ path, sha256: digest }) => ({ path, sha256: digest }))
  };
}

export async function resolveHarborContract(): Promise<HarborContractProvenance | undefined> {
  const seen = new Set<string>();
  for (const repository of harborCandidates()) {
    if (seen.has(repository)) continue;
    seen.add(repository);
    const verified = await verifyHarborRepository(repository);
    if (verified) return verified;
  }
  return undefined;
}
