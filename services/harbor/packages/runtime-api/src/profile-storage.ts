import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeFact } from "./runtime-session-types.js";

export type ProfileStorageCopyMode = "full" | "environment_only";

export class ProfileStorageMutationError extends Error {
  constructor(readonly code: "source_missing" | "target_exists" | "profile_locked" | "mutation_failed") {
    super(code);
  }
}

export interface StagedProfileStorageMutation {
  commit: () => void;
  rollback: () => boolean;
  residual: () => boolean;
}

export interface ProfileStorageOwnershipLock {
  release: () => void;
}

const LOCK_RETRY_INTERVAL_MS = 10;
const INVALID_LOCK_STALE_MS = 30_000;

export async function prepareProfileStorage(profileStorageRef: string | undefined): Promise<{
  profileDir: string;
  persistent: boolean;
  facts: RuntimeFact[];
}> {
  if (!profileStorageRef) {
    return {
      profileDir: await mkdtemp(join(tmpdir(), "harbor-profile-")),
      persistent: false,
      facts: [{ key: "profile.storage_scope", source: "configured", value: "ephemeral" }]
    };
  }

  const profileDir = profileStoragePath(profileStorageRef);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  await chmod(profileDir, 0o700);
  return {
    profileDir,
    persistent: true,
    facts: [
      { key: "profile.storage_scope", source: "configured", value: "persistent_ref" },
      { key: "profile.storage_ref.bound", source: "configured", value: "redacted_ref" }
    ]
  };
}

export function profileStoragePath(profileStorageRef: string): string {
  const root = process.env.HARBOR_PROFILE_STORAGE_ROOT || join(homedir(), ".webenvoy", "harbor", "profiles");
  return join(root, createHash("sha256").update(profileStorageRef).digest("hex").slice(0, 32));
}

export function profileStorageHasExternalLock(profileStorageRef: string): boolean {
  const path = profileStoragePath(profileStorageRef);
  const browserLock = join(path, "SingletonLock");
  if (entryExists(browserLock) && !removeDemonstrablyStaleBrowserResidue(path, browserLock)) return true;
  return entryExists(join(path, ".harbor-profile-lock"));
}

export function acquireProfileStorageOwnership(profileStorageRefs: readonly string[]): ProfileStorageOwnershipLock {
  const paths = [...new Set(profileStorageRefs.map(profileStoragePath))].sort();
  const releases: Array<() => void> = [];
  try {
    for (const path of paths) releases.push(acquireFileOwnership(ownershipLockPath(path)).release);
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      for (const release of releases.reverse()) release();
    }
  };
}

export function acquireFileOwnership(lockPath: string, waitMs = 0): ProfileStorageOwnershipLock {
  secureDirectory(dirname(lockPath));
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    const token = randomUUID();
    try {
      const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(), token }));
        fsyncSync(fd);
        const entry = fstatSync(fd);
        return { release: () => releaseOwnershipPath(lockPath, token, entry.dev, entry.ino) };
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw new ProfileStorageMutationError("profile_locked");
      if (removeDemonstrablyStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new ProfileStorageMutationError("profile_locked");
      sleepSync(Math.min(LOCK_RETRY_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
  }
}

export function profileStoragePathExists(profileStorageRef: string): boolean {
  return existsSync(profileStoragePath(profileStorageRef));
}

export function profileStorageHasResiduals(profileStorageRef: string): boolean {
  return residualPaths(profileStorageRef).length > 0;
}

export function repairProfileStorageResiduals(profileStorageRef: string): boolean {
  for (const path of residualPaths(profileStorageRef)) remove(path);
  return !profileStorageHasResiduals(profileStorageRef);
}

export function stageProfileStorageCopy(
  sourceProfileStorageRef: string,
  targetProfileStorageRef: string,
  mode: ProfileStorageCopyMode
): StagedProfileStorageMutation {
  if (profileStorageHasExternalLock(sourceProfileStorageRef) || profileStorageHasExternalLock(targetProfileStorageRef)) {
    throw new ProfileStorageMutationError("profile_locked");
  }
  const source = profileStoragePath(sourceProfileStorageRef);
  const target = profileStoragePath(targetProfileStorageRef);
  if (entryExists(target)) throw new ProfileStorageMutationError("target_exists");
  if (mode === "full" && !isRealDirectory(source)) throw new ProfileStorageMutationError("source_missing");
  const existingResiduals = [...new Set([
    ...residualPaths(sourceProfileStorageRef),
    ...residualPaths(targetProfileStorageRef)
  ])];
  if (!existingResiduals.every(remove)) throw new ProfileStorageMutationError("mutation_failed");

  const staging = `${target}.copy-${randomUUID()}`;
  try {
    secureDirectory(dirname(staging));
    mkdirSync(staging, { mode: 0o700 });
    if (mode === "full") cpSync(source, staging, { recursive: true });
    clearRuntimeResidue(staging);
  } catch {
    rmSync(staging, { recursive: true, force: true });
    throw new ProfileStorageMutationError("mutation_failed");
  }

  let current = staging;
  return {
    commit: () => {
      try {
        renameSync(staging, target);
        current = target;
      } catch {
        throw new ProfileStorageMutationError("mutation_failed");
      }
    },
    rollback: () => remove(current),
    residual: () => existsSync(current)
  };
}

export function stageProfileStorageDelete(profileStorageRef: string): StagedProfileStorageMutation {
  if (profileStorageHasExternalLock(profileStorageRef)) throw new ProfileStorageMutationError("profile_locked");
  const source = profileStoragePath(profileStorageRef);
  const existingResiduals = residualPaths(profileStorageRef);
  if (!existingResiduals.every(remove)) throw new ProfileStorageMutationError("mutation_failed");
  if (!existsSync(source)) return noOpMutation();
  const quarantine = `${source}.delete-${randomUUID()}`;
  try {
    renameSync(source, quarantine);
  } catch {
    throw new ProfileStorageMutationError("mutation_failed");
  }

  return {
    commit: () => {
      if (!remove(quarantine)) throw new ProfileStorageMutationError("mutation_failed");
    },
    rollback: () => {
      try {
        if (existsSync(quarantine)) renameSync(quarantine, source);
        return !existsSync(quarantine);
      } catch {
        return false;
      }
    },
    residual: () => existsSync(quarantine)
  };
}

function clearRuntimeResidue(path: string): void {
  for (const name of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket", ".harbor-profile-lock"]) {
    rmSync(join(path, name), { recursive: true, force: true });
  }
}

function removeDemonstrablyStaleBrowserResidue(profilePath: string, lockPath: string): boolean {
  try {
    const entry = lstatSync(lockPath);
    if (!entry.isSymbolicLink()) return false;
    const original = readlinkSync(lockPath);
    const match = original.match(/-(\d+)$/);
    if (!match || processIsAlive(Number(match[1]))) return false;
    const current = lstatSync(lockPath);
    const unchanged = current.dev === entry.dev && current.ino === entry.ino && current.mtimeMs === entry.mtimeMs &&
      current.isSymbolicLink() && readlinkSync(lockPath) === original;
    if (!unchanged) return false;
    for (const name of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      rmSync(join(profilePath, name), { recursive: true, force: true });
    }
    return !entryExists(lockPath);
  } catch {
    return false;
  }
}

function remove(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return !existsSync(path);
  } catch {
    return false;
  }
}

function entryExists(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

function ownershipLockPath(profilePath: string): string {
  return `${profilePath}.ownership-lock`;
}

function releaseOwnershipPath(lockPath: string, token: string, device: number, inode: number): void {
  try {
    const entry = lstatSync(lockPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.dev !== device || entry.ino !== inode) return;
    const owner = parseLockOwner(readFileSync(lockPath, "utf8"));
    const current = lstatSync(lockPath);
    if (owner?.token === token && current.dev === device && current.ino === inode) unlinkSync(lockPath);
  } catch {
    // A missing or replaced lock is not ours to release.
  }
}

function removeDemonstrablyStaleLock(lockPath: string): boolean {
  try {
    const entry = lstatSync(lockPath);
    if (!entry.isFile() || entry.isSymbolicLink()) return false;
    const original = readFileSync(lockPath, "utf8");
    const owner = parseLockOwner(original);
    if (owner ? processIsAlive(owner.pid) : Date.now() - entry.mtimeMs <= INVALID_LOCK_STALE_MS) return false;
    const current = lstatSync(lockPath);
    if (current.dev !== entry.dev || current.ino !== entry.ino || current.mtimeMs !== entry.mtimeMs ||
      readFileSync(lockPath, "utf8") !== original) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function parseLockOwner(value: string): { pid: number; token: string } | null {
  try {
    const parsed = JSON.parse(value) as { pid?: unknown; token?: unknown };
    return Number.isInteger(parsed.pid) && Number(parsed.pid) > 0 && typeof parsed.token === "string" && parsed.token.length > 0
      ? { pid: Number(parsed.pid), token: parsed.token }
      : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isRealDirectory(path: string): boolean {
  try {
    const entry = lstatSync(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

function secureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function noOpMutation(): StagedProfileStorageMutation {
  return { commit: () => undefined, rollback: () => true, residual: () => false };
}

function residualPaths(profileStorageRef: string): string[] {
  const path = profileStoragePath(profileStorageRef);
  const parent = dirname(path);
  if (!existsSync(parent)) return [];
  const prefix = path.slice(parent.length + 1);
  return readdirSync(parent)
    .filter((name) => name.startsWith(`${prefix}.copy-`) || name.startsWith(`${prefix}.delete-`))
    .map((name) => join(parent, name));
}
