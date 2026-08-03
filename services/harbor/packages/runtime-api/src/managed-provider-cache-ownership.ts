import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";

export const PROVIDER_CACHE_OWNERSHIP_LOCK = ".harbor-provider-ownership.lock";
export const PROVIDER_CACHE_OWNERSHIP_DIRECTORY = ".harbor-provider-ownership";
export const PROVIDER_CACHE_OWNERSHIP_STALE_MS = 60_000;
const HEARTBEAT_MS = 5_000;
const MAX_LOCK_BYTES = 4_096;
const MAX_CLAIMS = 128;
const OWNERSHIP_SCHEMA = "harbor-provider-cache-ownership/v1";
const OWNERSHIP_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM = /^claim-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.lock$/i;
const OWNERSHIP_CONSTRUCTION = Symbol("provider-cache-ownership");
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1_000).toISOString();

interface LockOwner {
  pid: number;
  token: string;
  schema_version?: string;
  created_at?: string;
  process_started_at?: string;
}

interface ClaimSnapshot {
  path: string;
  device: number;
  inode: number;
  modifiedAt: number;
  owner: LockOwner | null;
}

interface FenceSnapshot extends ClaimSnapshot {
  contents: string;
}

export interface AcquireProviderCacheOwnershipOptions {
  on_ready_to_publish?: () => Promise<void>;
  on_claim_published?: () => Promise<void>;
  on_before_legacy_fence?: () => Promise<void>;
  on_before_mutation?: (label: string) => Promise<void>;
  lease_duration_ms?: number;
  heartbeat_interval_ms?: number;
}

export class ProviderCacheOwnershipBusy extends Error {
  constructor() {
    super("The managed provider cache is owned by another runtime.");
  }
}

export class ProviderCacheOwnershipLost extends Error {
  constructor() {
    super("Managed provider cache ownership is not held by this runtime.");
  }
}

export class ProviderCacheOwnership {
  private released = false;
  private lost = false;
  private refreshing: Promise<void> | null = null;
  private readonly heartbeat: NodeJS.Timeout | null;

  constructor(
    construction: typeof OWNERSHIP_CONSTRUCTION,
    private readonly cacheDir: string,
    private readonly claimPath: string,
    private readonly fencePath: string,
    private readonly token: string,
    private readonly claimDevice: number,
    private readonly claimInode: number,
    private readonly fenceDevice: number,
    private readonly fenceInode: number,
    private readonly claim: FileHandle,
    private readonly fence: FileHandle,
    private readonly beforeMutation?: (label: string) => Promise<void>,
    heartbeatIntervalMs = HEARTBEAT_MS
  ) {
    if (construction !== OWNERSHIP_CONSTRUCTION) throw new Error("Managed provider cache ownership cannot be constructed directly.");
    this.heartbeat = heartbeatIntervalMs > 0
      ? setInterval(() => void this.refreshLease().catch(() => undefined), heartbeatIntervalMs)
      : null;
    this.heartbeat?.unref();
  }

  async assert(cacheDir: string): Promise<void> {
    if (this.released || this.lost || resolve(cacheDir) !== this.cacheDir) throw ownershipLost();
    await this.refreshLease();
  }

  async mutate<T>(cacheDir: string, label: string, mutation: () => Promise<T>): Promise<T> {
    await this.beforeMutation?.(label);
    await this.assert(cacheDir);
    return mutation();
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.refreshing?.catch(() => undefined);
    const actualFence = await this.matchesActualFence().catch(() => false);
    if (actualFence) await unlink(this.fencePath).catch(() => undefined);
    await this.fence.close().catch(() => undefined);
    const actualClaim = await this.matchesActualClaim().catch(() => false);
    if (actualClaim) await unlink(this.claimPath).catch(() => undefined);
    await this.claim.close().catch(() => undefined);
  }

  private refreshLease(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshLeaseOnce().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refreshLeaseOnce(): Promise<void> {
    try {
      if (this.released || this.lost || !await this.matchesActualClaim() || !await this.matchesActualFence()) {
        throw ownershipLost();
      }
      const now = new Date();
      await this.claim.utimes(now, now);
      if (!await this.matchesActualClaim() || !await this.matchesActualFence()) throw ownershipLost();
    } catch (error) {
      this.lost = true;
      throw error instanceof ProviderCacheOwnershipLost ? error : ownershipLost();
    }
  }

  private async matchesActualClaim(): Promise<boolean> {
    return matchesHeldLock(this.claim, this.claimPath, this.claimDevice, this.claimInode, this.token);
  }

  private async matchesActualFence(): Promise<boolean> {
    return matchesHeldLock(this.fence, this.fencePath, this.fenceDevice, this.fenceInode, this.token, true);
  }
}

export async function acquireProviderCacheOwnership(
  cacheDir: string,
  options: AcquireProviderCacheOwnershipOptions = {}
): Promise<ProviderCacheOwnership> {
  const normalized = resolve(cacheDir);
  const leaseDurationMs = boundedDuration(options.lease_duration_ms, PROVIDER_CACHE_OWNERSHIP_STALE_MS);
  const heartbeatIntervalMs = boundedDuration(options.heartbeat_interval_ms, HEARTBEAT_MS, true);
  await mkdir(normalized, { recursive: true, mode: 0o700 });
  const claimsDir = join(normalized, PROVIDER_CACHE_OWNERSHIP_DIRECTORY);
  await ensureClaimsDirectory(claimsDir);
  if (await removeStaleClaims(claimsDir, leaseDurationMs)) throw new ProviderCacheOwnershipBusy();
  await options.on_ready_to_publish?.();

  const token = randomUUID();
  const claimPath = join(claimsDir, `claim-${token}.lock`);
  const temporary = join(claimsDir, `.claim-${token}.tmp`);
  let claim: FileHandle | null = null;
  let fence: FileHandle | null = null;
  try {
    await writeClaim(temporary, token);
    await rename(temporary, claimPath);
    await options.on_claim_published?.();
    const contenders = (await readClaims(claimsDir)).filter((entry) => entry.path !== claimPath);
    if (contenders.length > 0) throw new ProviderCacheOwnershipBusy();
    claim = await open(claimPath, "r+");
    const claimEntry = await claim.stat();
    await options.on_before_legacy_fence?.();
    const acquiredFence = await acquireLegacyFence(normalized, claimsDir, token, leaseDurationMs);
    fence = acquiredFence.handle;
    const validClaim = await matchesHeldLock(claim, claimPath, claimEntry.dev, claimEntry.ino, token).catch(() => false);
    const validFence = await matchesHeldLock(
      fence, acquiredFence.path, acquiredFence.device, acquiredFence.inode, token, true
    ).catch(() => false);
    if (!validClaim || !validFence) {
      throw ownershipLost();
    }
    return new ProviderCacheOwnership(
      OWNERSHIP_CONSTRUCTION,
      normalized,
      claimPath,
      acquiredFence.path,
      token,
      claimEntry.dev,
      claimEntry.ino,
      acquiredFence.device,
      acquiredFence.inode,
      claim,
      fence,
      options.on_before_mutation,
      heartbeatIntervalMs
    );
  } catch (error) {
    await fence?.close().catch(() => undefined);
    await claim?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    await removeOwnedPath(join(normalized, PROVIDER_CACHE_OWNERSHIP_LOCK), token).catch(() => undefined);
    await removeOwnedPath(claimPath, token).catch(() => undefined);
    throw error;
  }
}

async function writeClaim(path: string, token: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(lockOwner(token)));
    await file.sync();
  } finally {
    await file.close();
  }
}

async function acquireLegacyFence(
  cacheDir: string,
  claimsDir: string,
  token: string,
  leaseDurationMs: number
): Promise<{ path: string; device: number; inode: number; handle: FileHandle }> {
  const path = join(cacheDir, PROVIDER_CACHE_OWNERSHIP_LOCK);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx+", 0o600);
      try {
        await handle.writeFile(JSON.stringify(lockOwner(token)));
        await handle.sync();
        const entry = await handle.stat();
        return { path, device: entry.dev, inode: entry.ino, handle };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await removeOwnedPath(path, token).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!isAlreadyExists(error) || attempt > 0 || !await removeReclaimableFence(path, claimsDir, leaseDurationMs)) {
        throw isAlreadyExists(error) ? new ProviderCacheOwnershipBusy() : error;
      }
    }
  }
  throw new ProviderCacheOwnershipBusy();
}

async function ensureClaimsDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if (!isAlreadyExists(error)) throw error;
  });
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ProviderCacheOwnershipBusy();
}

async function removeStaleClaims(claimsDir: string, leaseDurationMs: number): Promise<boolean> {
  const claims = await readClaims(claimsDir);
  let liveClaim = false;
  for (const claim of claims) {
    if (!claimIsStale(claim, leaseDurationMs)) liveClaim = true;
    else await removeStaleClaim(claim);
  }
  return liveClaim;
}

async function readClaims(claimsDir: string): Promise<ClaimSnapshot[]> {
  const names = (await readdir(claimsDir)).filter((name) => CLAIM.test(name));
  if (names.length > MAX_CLAIMS) throw new ProviderCacheOwnershipBusy();
  const claims: ClaimSnapshot[] = [];
  for (const name of names) {
    const snapshot = await readLockSnapshot(join(claimsDir, name));
    if (snapshot) claims.push(snapshot);
  }
  return claims;
}

function claimIsStale(claim: ClaimSnapshot, leaseDurationMs: number): boolean {
  if (claim.owner && !processIsAlive(claim.owner.pid)) return true;
  return Date.now() - claim.modifiedAt > leaseDurationMs;
}

async function removeStaleClaim(claim: ClaimSnapshot): Promise<void> {
  const quarantine = `${claim.path}.stale-${randomUUID()}`;
  try {
    await rename(claim.path, quarantine);
    const moved = await lstat(quarantine);
    if (moved.dev !== claim.device || moved.ino !== claim.inode || moved.mtimeMs !== claim.modifiedAt) {
      await rename(quarantine, claim.path).catch(() => undefined);
      return;
    }
    await rm(quarantine, { force: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function removeReclaimableFence(path: string, claimsDir: string, leaseDurationMs: number): Promise<boolean> {
  const snapshot = await readFenceSnapshot(path);
  if (!snapshot) return true;
  const owner = snapshot.owner;
  if (!owner) return false;
  if (owner.schema_version !== OWNERSHIP_SCHEMA) {
    if (processIsAlive(owner.pid)) return false;
  } else {
    if (!OWNERSHIP_TOKEN.test(owner.token)) return false;
    const claim = await readLockSnapshot(join(claimsDir, `claim-${owner.token}.lock`));
    if (claim && !claimIsStale(claim, leaseDurationMs)) return false;
  }
  return quarantineFence(snapshot);
}

async function quarantineFence(snapshot: FenceSnapshot): Promise<boolean> {
  const quarantine = `${snapshot.path}.stale-${randomUUID()}`;
  try {
    await rename(snapshot.path, quarantine);
    const moved = await lstat(quarantine);
    const unchanged = moved.dev === snapshot.device && moved.ino === snapshot.inode && moved.mtimeMs === snapshot.modifiedAt &&
      await readFile(quarantine, "utf8").catch(() => "") === snapshot.contents;
    if (!unchanged) {
      await rename(quarantine, snapshot.path).catch(() => undefined);
      return false;
    }
    await rm(quarantine, { force: true });
    return true;
  } catch (error) {
    if (isMissing(error)) return true;
    return false;
  }
}

async function readLockSnapshot(path: string): Promise<ClaimSnapshot | null> {
  const snapshot = await readFenceSnapshot(path);
  if (!snapshot) return null;
  return snapshot;
}

async function readFenceSnapshot(path: string): Promise<FenceSnapshot | null> {
  const entry = await lstat(path).catch(() => null);
  if (!entry) return null;
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_LOCK_BYTES) {
    return { path, device: entry.dev, inode: entry.ino, modifiedAt: entry.mtimeMs, owner: null, contents: "" };
  }
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return { path, device: entry.dev, inode: entry.ino, modifiedAt: entry.mtimeMs, owner: null, contents: "" };
  try {
    const [held, current] = await Promise.all([handle.stat(), lstat(path).catch(() => null)]);
    if (!current) return null;
    if (!current.isFile() || current.isSymbolicLink() || held.dev !== entry.dev || held.ino !== entry.ino ||
        current.dev !== entry.dev || current.ino !== entry.ino || held.size > MAX_LOCK_BYTES || current.size > MAX_LOCK_BYTES) {
      return { path, device: current.dev, inode: current.ino, modifiedAt: current.mtimeMs, owner: null, contents: "" };
    }
    const buffer = Buffer.alloc(MAX_LOCK_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const contents = bytesRead <= MAX_LOCK_BYTES ? buffer.subarray(0, bytesRead).toString("utf8") : "";
    return { path, device: held.dev, inode: held.ino, modifiedAt: held.mtimeMs, owner: parseLockOwner(contents), contents };
  } finally {
    await handle.close();
  }
}

async function matchesHeldLock(
  handle: FileHandle,
  path: string,
  device: number,
  inode: number,
  token: string,
  requireSchema = false
): Promise<boolean> {
  const [held, actual] = await Promise.all([handle.stat(), lstat(path)]);
  if (!actual.isFile() || actual.isSymbolicLink() || held.dev !== device || held.ino !== inode ||
      actual.dev !== device || actual.ino !== inode || actual.size > MAX_LOCK_BYTES || held.size > MAX_LOCK_BYTES) return false;
  const buffer = Buffer.alloc(MAX_LOCK_BYTES + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  if (bytesRead > MAX_LOCK_BYTES) return false;
  const owner = parseLockOwner(buffer.subarray(0, bytesRead).toString("utf8"));
  const current = await lstat(path);
  return owner?.token === token && owner.pid === process.pid && owner.process_started_at === PROCESS_STARTED_AT &&
    (!requireSchema || owner.schema_version === OWNERSHIP_SCHEMA) && current.dev === device && current.ino === inode;
}

async function removeOwnedPath(path: string, token: string): Promise<void> {
  const snapshot = await readFenceSnapshot(path);
  if (snapshot?.owner?.token !== token) return;
  const current = await lstat(path).catch(() => null);
  if (current?.dev === snapshot.device && current.ino === snapshot.inode) await unlink(path).catch(() => undefined);
}

function lockOwner(token: string): LockOwner {
  return {
    schema_version: OWNERSHIP_SCHEMA,
    pid: process.pid,
    process_started_at: PROCESS_STARTED_AT,
    created_at: new Date().toISOString(),
    token
  };
}

function parseLockOwner(value: string): LockOwner | null {
  try {
    const parsed = JSON.parse(value) as Partial<LockOwner>;
    return Number.isInteger(parsed.pid) && Number(parsed.pid) > 0 && typeof parsed.token === "string" &&
      parsed.token.length > 0 && parsed.token.length <= 200
      ? {
          pid: Number(parsed.pid),
          token: parsed.token,
          schema_version: parsed.schema_version,
          created_at: parsed.created_at,
          process_started_at: parsed.process_started_at
        }
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

function boundedDuration(value: number | undefined, fallback: number, allowZero = false): number {
  if (value === undefined) return fallback;
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > 3_600_000) throw new Error("Provider ownership duration is invalid.");
  return value;
}

function ownershipLost(): ProviderCacheOwnershipLost {
  return new ProviderCacheOwnershipLost();
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
