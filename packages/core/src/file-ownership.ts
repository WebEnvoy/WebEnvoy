import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type FileOwnership = {
  token: string;
  pid: number;
  owner_ref: string;
  created_at: string;
  process_start_ref?: string;
};

export class FileOwnershipError extends Error {}
const currentProcessStartRef = processStartRef(process.pid);

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

function assertOwnership(value: unknown): FileOwnership {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FileOwnershipError("file ownership record is invalid");
  const owner = value as Record<string, unknown>;
  if (
    typeof owner.token !== "string" || !/^[0-9a-f-]{36}$/.test(owner.token) ||
    typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
    typeof owner.owner_ref !== "string" || owner.owner_ref.length === 0 || owner.owner_ref.length > 1024 ||
    typeof owner.created_at !== "string" || Number.isNaN(Date.parse(owner.created_at)) ||
    (owner.process_start_ref !== undefined && (typeof owner.process_start_ref !== "string" || owner.process_start_ref.length === 0))
  ) throw new FileOwnershipError("file ownership record is invalid");
  return owner as FileOwnership;
}

export async function readFileOwnership(path: string): Promise<FileOwnership | undefined> {
  try {
    return assertOwnership(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export function isOwnershipProcessAlive(owner: FileOwnership): boolean {
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function processStartRef(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
        resolve(error ? undefined : stdout.trim() || undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

export async function isFileOwnershipOwnerAlive(owner: FileOwnership): Promise<boolean> {
  if (!isOwnershipProcessAlive(owner)) return false;
  if (!owner.process_start_ref) return true;
  const observed = owner.pid === process.pid ? await currentProcessStartRef : await processStartRef(owner.pid);
  return observed === undefined || observed === owner.process_start_ref;
}

function recoveryDirectory(path: string): string {
  return `${path}.recovery`;
}

async function hasLiveRecovery(path: string): Promise<boolean> {
  const directory = recoveryDirectory(path);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
  let live = false;
  for (const name of names) {
    const markerPath = join(directory, name);
    const owner = await readFileOwnership(markerPath);
    if (!owner) continue;
    if (await isFileOwnershipOwnerAlive(owner)) live = true;
    else await unlink(markerPath).catch((error) => {
      if (errorCode(error) !== "ENOENT") throw error;
    });
  }
  return live;
}

export async function tryAcquireFileOwnership(path: string, ownerRef: string): Promise<FileOwnership | undefined> {
  const processStart = await currentProcessStartRef;
  const owner = assertOwnership({
    token: randomUUID(),
    pid: process.pid,
    owner_ref: ownerRef,
    created_at: new Date().toISOString(),
    ...(processStart === undefined ? {} : { process_start_ref: processStart })
  });
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  if (await hasLiveRecovery(path)) return undefined;
  const temp = join(parent, `.${owner.token}.tmp`);
  await writeFile(temp, `${JSON.stringify(owner)}\n`, "utf8");
  try {
    await link(temp, path);
    if (await hasLiveRecovery(path)) {
      await releaseFileOwnership(path, owner.token);
      return undefined;
    }
    return owner;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return undefined;
    throw error;
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function releaseFileOwnership(path: string, token: string): Promise<boolean> {
  const owner = await readFileOwnership(path);
  if (!owner || owner.token !== token) return false;
  await unlink(path);
  return true;
}

export async function recoverDeadFileOwnership(path: string, expectedOwnerRef?: string): Promise<boolean> {
  const owner = await readFileOwnership(path);
  if (!owner || (expectedOwnerRef !== undefined && owner.owner_ref !== expectedOwnerRef) || await isFileOwnershipOwnerAlive(owner)) return false;
  const processStart = await currentProcessStartRef;
  const markerOwner = assertOwnership({
    token: randomUUID(),
    pid: process.pid,
    owner_ref: `recover:${owner.token}`,
    created_at: new Date().toISOString(),
    ...(processStart === undefined ? {} : { process_start_ref: processStart })
  });
  const directory = recoveryDirectory(path);
  await mkdir(directory, { recursive: true });
  const markerPath = join(directory, `${markerOwner.token}.json`);
  await writeFile(markerPath, `${JSON.stringify(markerOwner)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    const current = await readFileOwnership(path);
    if (!current || current.token !== owner.token || await isFileOwnershipOwnerAlive(current)) return false;
    return releaseFileOwnership(path, owner.token);
  } finally {
    await unlink(markerPath).catch(() => undefined);
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function withFileOwnershipLock<T>(path: string, timeoutMs: number, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  let owner: FileOwnership | undefined;
  while (!owner) {
    owner = await tryAcquireFileOwnership(path, `lock:${basename(path)}`);
    if (owner) break;
    await recoverDeadFileOwnership(path);
    if (Date.now() - started > timeoutMs) throw new FileOwnershipError("file_lock_timeout");
    await wait(10);
  }
  try {
    return await action();
  } finally {
    await releaseFileOwnership(path, owner.token).catch(() => false);
  }
}
