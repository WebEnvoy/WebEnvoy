import { randomUUID } from "node:crypto";
import { access, lstat, open, readFile, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, join } from "node:path";
import { ProviderCacheOwnershipLost, type ProviderCacheOwnership } from "./managed-provider-cache-ownership.js";

export const PROVIDER_EXCHANGE_JOURNAL = ".harbor-provider-exchange.json";

export interface ProviderExchangeJournal {
  schema_version: "harbor-provider-exchange/v0";
  operation_id: string;
  version: string;
  target_name: string;
  staging_name: string;
  backup_name: string;
  marker_name: string;
  previous_version: string | null;
  phase: "prepared" | "backup_created" | "target_published" | "rollback_started" | "committed";
  rollback_action: "restore_backup" | "remove_target" | "none" | null;
}

export interface ProviderExchangeFileOperations {
  rename: typeof rename;
  rm: typeof rm;
}

export interface ProviderRollbackResult {
  rolled_back: boolean;
  failure: unknown | null;
}

const defaultOperations: ProviderExchangeFileOperations = { rename, rm };
const MAX_STALE_ARTIFACT_REMOVALS = 64;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const DOWNLOAD_ARTIFACT = new RegExp(`^\\.harbor-download-${UUID}\\.(?:zip|tar\\.gz)$`, "i");
const STAGING_ARTIFACT = new RegExp(`^\\.harbor-staging-provider_operation_${UUID}$`, "i");
const JOURNAL_TEMPORARY = new RegExp(`^\\.harbor-provider-exchange\\.json\\.tmp-${UUID}$`, "i");
const MARKER_TEMPORARY = new RegExp(`^latest_version_[a-z0-9_-]{1,64}\\.tmp-${UUID}$`, "i");

export async function writeProviderExchangeJournal(
  cacheDir: string,
  journal: ProviderExchangeJournal,
  ownership: ProviderCacheOwnership,
  signal?: AbortSignal
): Promise<void> {
  await ownership.assert(cacheDir);
  assertNotAborted(signal);
  const existing = await readJournal(cacheDir);
  if (existing && existing.operation_id !== journal.operation_id) {
    throw new Error("An unresolved provider exchange journal already exists.");
  }
  const path = join(cacheDir, PROVIDER_EXCHANGE_JOURNAL);
  await writeCacheFileAtomically(cacheDir, path, JSON.stringify(journal), ownership, "journal", signal);
}

export async function publishProviderExchange(
  cacheDir: string,
  journal: ProviderExchangeJournal,
  operations: ProviderExchangeFileOperations,
  ownership: ProviderCacheOwnership,
  signal: AbortSignal
): Promise<void> {
  await ownership.assert(cacheDir);
  await writeProviderExchangeJournal(cacheDir, journal, ownership, signal);
  const paths = journalPaths(cacheDir, journal);
  if (await pathExists(paths.target)) {
    assertNotAborted(signal);
    await fencedRename(cacheDir, ownership, "exchange:create-backup", operations, paths.target, paths.backup);
    journal.phase = "backup_created";
    await writeProviderExchangeJournal(cacheDir, journal, ownership, signal);
  }
  assertNotAborted(signal);
  await fencedRename(cacheDir, ownership, "exchange:publish-target", operations, paths.staging, paths.target);
  journal.phase = "target_published";
  await writeProviderExchangeJournal(cacheDir, journal, ownership, signal);
}

export async function commitProviderExchange(
  cacheDir: string,
  journal: ProviderExchangeJournal,
  operations: ProviderExchangeFileOperations,
  ownership: ProviderCacheOwnership
): Promise<void> {
  await ownership.assert(cacheDir);
  const paths = journalPaths(cacheDir, journal);
  await pruneManagedVersions(cacheDir, journal.version, operations, ownership);
  await fencedRemove(cacheDir, ownership, "commit:remove-backup", operations, paths.backup, { recursive: true, force: true });
  await fencedRemove(cacheDir, ownership, "commit:remove-journal", operations, join(cacheDir, PROVIDER_EXCHANGE_JOURNAL), { force: true });
}

export async function writeProviderVersionMarker(
  cacheDir: string,
  markerName: string,
  version: string,
  ownership: ProviderCacheOwnership,
  signal: AbortSignal
): Promise<void> {
  await ownership.assert(cacheDir);
  await writeMarker(cacheDir, markerName, version, ownership, signal);
}

export async function recoverProviderExchange(
  cacheDir: string,
  ownership: ProviderCacheOwnership,
  operations: ProviderExchangeFileOperations = defaultOperations
): Promise<boolean> {
  await ownership.assert(cacheDir);
  const journal = await readJournal(cacheDir);
  if (!journal) return false;
  const paths = journalPaths(cacheDir, journal);
  if (journal.phase === "committed") {
    if (await pathExists(paths.target)) {
      await writeMarker(cacheDir, journal.marker_name, journal.version, ownership);
      await pruneManagedVersions(cacheDir, journal.version, operations, ownership);
      await fencedRemove(cacheDir, ownership, "recovery:remove-backup", operations, paths.backup, { recursive: true, force: true });
    } else if (await pathExists(paths.backup)) {
      await fencedRename(cacheDir, ownership, "recovery:restore-backup", operations, paths.backup, paths.target);
      await restoreMarker(cacheDir, journal, ownership);
    } else {
      throw new Error("Committed provider exchange is missing both target and backup.");
    }
  } else if (journal.phase === "rollback_started") {
    if (journal.rollback_action === "restore_backup") {
      if (await pathExists(paths.backup)) {
        if (await pathExists(paths.target)) {
          await fencedRemove(cacheDir, ownership, "recovery:remove-target", operations, paths.target, { recursive: true, force: true });
        }
        await fencedRename(cacheDir, ownership, "recovery:restore-backup", operations, paths.backup, paths.target);
      } else if (!await pathExists(paths.target)) {
        throw new Error("Provider rollback lost both target and backup.");
      }
    } else if (journal.rollback_action === "remove_target") {
      await fencedRemove(cacheDir, ownership, "recovery:remove-target", operations, paths.target, { recursive: true, force: true });
    }
    await restoreMarker(cacheDir, journal, ownership);
  } else if (journal.phase === "prepared" && await pathExists(paths.target) &&
      await pathExists(paths.staging) && !await pathExists(paths.backup)) {
    // No exchange rename occurred before the crash.
  } else {
    if (await pathExists(paths.target)) {
      await fencedRemove(cacheDir, ownership, "recovery:remove-target", operations, paths.target, { recursive: true, force: true });
    }
    if (await pathExists(paths.backup)) {
      await fencedRename(cacheDir, ownership, "recovery:restore-backup", operations, paths.backup, paths.target);
    }
    await restoreMarker(cacheDir, journal, ownership);
  }
  await fencedRemove(cacheDir, ownership, "recovery:remove-staging", operations, paths.staging, { recursive: true, force: true });
  await fencedRemove(cacheDir, ownership, "recovery:remove-journal", operations, join(cacheDir, PROVIDER_EXCHANGE_JOURNAL), { force: true });
  return true;
}

export async function rollbackProviderExchange(
  cacheDir: string,
  journal: ProviderExchangeJournal,
  ownership: ProviderCacheOwnership,
  operations: ProviderExchangeFileOperations = defaultOperations
): Promise<ProviderRollbackResult> {
  try {
    await ownership.assert(cacheDir);
    const paths = journalPaths(cacheDir, journal);
    const backupExists = await pathExists(paths.backup);
    const originalPhase = journal.phase;
    journal.phase = "rollback_started";
    journal.rollback_action = backupExists
      ? "restore_backup"
      : originalPhase === "target_published" || originalPhase === "committed" ? "remove_target" : "none";
    await writeProviderExchangeJournal(cacheDir, journal, ownership);
    if (backupExists && await pathExists(paths.target)) {
      await fencedRemove(cacheDir, ownership, "rollback:remove-target", operations, paths.target, { recursive: true, force: true });
    }
    else if (!backupExists && journal.rollback_action === "remove_target") {
      await fencedRemove(cacheDir, ownership, "rollback:remove-target", operations, paths.target, { recursive: true, force: true });
    }
    if (backupExists) {
      await fencedRename(cacheDir, ownership, "rollback:restore-backup", operations, paths.backup, paths.target);
    }
    await restoreMarker(cacheDir, journal, ownership);
    await fencedRemove(cacheDir, ownership, "rollback:remove-journal", operations, join(cacheDir, PROVIDER_EXCHANGE_JOURNAL), { force: true });
    return { rolled_back: true, failure: null };
  } catch (failure) {
    return { rolled_back: false, failure };
  }
}

export async function scavengeStaleProviderArtifacts(
  cacheDir: string,
  ownership: ProviderCacheOwnership,
  operations: ProviderExchangeFileOperations = defaultOperations
): Promise<number> {
  await ownership.assert(cacheDir);
  const journal = await readJournal(cacheDir);
  const protectedNames = new Set(journal ? [journal.staging_name, journal.backup_name] : []);
  let removed = 0;
  for (const name of (await readdir(cacheDir)).sort()) {
    if (removed >= MAX_STALE_ARTIFACT_REMOVALS || protectedNames.has(name)) continue;
    const download = DOWNLOAD_ARTIFACT.test(name);
    const staging = STAGING_ARTIFACT.test(name);
    const temporary = JOURNAL_TEMPORARY.test(name) || MARKER_TEMPORARY.test(name);
    if (!download && !staging && !temporary) continue;
    const path = join(cacheDir, name);
    const entry = await lstat(path).catch(() => null);
    if (!entry || entry.isSymbolicLink() || (download || temporary) && !entry.isFile() || staging && !entry.isDirectory()) continue;
    await fencedRemove(cacheDir, ownership, "scavenge:remove-artifact", operations, path, { recursive: staging, force: true });
    removed += 1;
  }
  return removed;
}

export function providerExchangeJournal(
  operationId: string,
  version: string,
  targetDir: string,
  stagingDir: string,
  backupDir: string,
  markerName: string,
  previousVersion: string | null
): ProviderExchangeJournal {
  return {
    schema_version: "harbor-provider-exchange/v0",
    operation_id: operationId,
    version,
    target_name: basename(targetDir),
    staging_name: basename(stagingDir),
    backup_name: basename(backupDir),
    marker_name: markerName,
    previous_version: previousVersion,
    phase: "prepared",
    rollback_action: null
  };
}

async function readJournal(cacheDir: string): Promise<ProviderExchangeJournal | null> {
  let text: string;
  try {
    const path = join(cacheDir, PROVIDER_EXCHANGE_JOURNAL);
    const facts = await lstat(path);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.size > 16_384) throw new Error("Provider exchange journal is not a bounded regular file.");
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (Buffer.byteLength(text) > 16_384) throw new Error("Provider exchange journal exceeds its size limit.");
  const value = JSON.parse(text) as Partial<ProviderExchangeJournal>;
  if (value.schema_version !== "harbor-provider-exchange/v0" ||
      !validName(value.target_name, "chromium-") ||
      !validName(value.staging_name, ".harbor-staging-") ||
      !validName(value.backup_name, ".harbor-backup-") ||
      !validName(value.marker_name, "latest_version_") ||
      !(value.previous_version === null || validVersion(value.previous_version)) ||
      typeof value.operation_id !== "string" || value.operation_id.length < 1 || value.operation_id.length > 200 ||
      !validVersion(value.version) ||
      value.target_name !== `chromium-${value.version}` ||
      !["prepared", "backup_created", "target_published", "rollback_started", "committed"].includes(value.phase ?? "") ||
      !(value.rollback_action === null || ["restore_backup", "remove_target", "none"].includes(value.rollback_action ?? "")) ||
      (value.phase === "rollback_started") !== (value.rollback_action !== null)) {
    throw new Error("Provider exchange journal is invalid.");
  }
  return value as ProviderExchangeJournal;
}

async function restoreMarker(cacheDir: string, journal: ProviderExchangeJournal, ownership: ProviderCacheOwnership): Promise<void> {
  if (journal.previous_version) await writeMarker(cacheDir, journal.marker_name, journal.previous_version, ownership);
  else await fencedMutation(cacheDir, ownership, "marker:remove", () => rm(join(cacheDir, journal.marker_name), { force: true }));
}

async function writeMarker(
  cacheDir: string,
  markerName: string,
  version: string,
  ownership: ProviderCacheOwnership,
  signal?: AbortSignal
): Promise<void> {
  const path = join(cacheDir, markerName);
  await writeCacheFileAtomically(cacheDir, path, version, ownership, "marker", signal);
}

async function writeCacheFileAtomically(
  cacheDir: string,
  path: string,
  contents: string,
  ownership: ProviderCacheOwnership,
  label: "journal" | "marker",
  signal?: AbortSignal
): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  let file: FileHandle | null = null;
  try {
    file = await fencedMutation(cacheDir, ownership, `${label}:create-temporary`, () => open(temporary, "wx", 0o600));
    await fencedMutation(cacheDir, ownership, `${label}:write-temporary`, () => file!.writeFile(contents));
    await fencedMutation(cacheDir, ownership, `${label}:sync-temporary`, () => file!.sync());
    await file.close();
    file = null;
    assertNotAborted(signal);
    await fencedMutation(cacheDir, ownership, `${label}:publish`, () => rename(temporary, path));
  } catch (error) {
    await file?.close().catch(() => undefined);
    await fencedMutation(cacheDir, ownership, `${label}:discard-temporary`, () => rm(temporary, { force: true })).catch(() => undefined);
    throw error;
  }
  await syncCacheDirectory(cacheDir, ownership, label);
}

async function syncCacheDirectory(cacheDir: string, ownership: ProviderCacheOwnership, label: string): Promise<void> {
  let directory: FileHandle | null = null;
  try {
    directory = await fencedMutation(cacheDir, ownership, `${label}:open-directory`, () => open(cacheDir, "r"));
    await fencedMutation(cacheDir, ownership, `${label}:sync-directory`, () => directory!.sync());
  } catch (error) {
    if (error instanceof ProviderCacheOwnershipLost) throw error;
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

async function pruneManagedVersions(
  cacheDir: string,
  retainedVersion: string,
  operations: ProviderExchangeFileOperations,
  ownership: ProviderCacheOwnership
): Promise<void> {
  const retainedName = `chromium-${retainedVersion}`;
  for (const name of await readdir(cacheDir)) {
    if (name !== retainedName && /^chromium-[0-9]+(?:\.[0-9]+){3,4}$/.test(name)) {
      await fencedRemove(cacheDir, ownership, "commit:prune-version", operations, join(cacheDir, name), { recursive: true, force: true });
    }
  }
}

async function fencedRename(
  cacheDir: string,
  ownership: ProviderCacheOwnership,
  label: string,
  operations: ProviderExchangeFileOperations,
  source: string,
  destination: string
): Promise<void> {
  await fencedMutation(cacheDir, ownership, label, () => operations.rename(source, destination));
}

async function fencedRemove(
  cacheDir: string,
  ownership: ProviderCacheOwnership,
  label: string,
  operations: ProviderExchangeFileOperations,
  path: string,
  options: Parameters<typeof rm>[1]
): Promise<void> {
  await fencedMutation(cacheDir, ownership, label, () => operations.rm(path, options));
}

async function fencedMutation<T>(
  cacheDir: string,
  ownership: ProviderCacheOwnership,
  label: string,
  mutation: () => Promise<T>
): Promise<T> {
  return ownership.mutate(cacheDir, label, mutation);
}

function journalPaths(cacheDir: string, journal: ProviderExchangeJournal): { target: string; staging: string; backup: string } {
  return {
    target: join(cacheDir, journal.target_name),
    staging: join(cacheDir, journal.staging_name),
    backup: join(cacheDir, journal.backup_name)
  };
}

function validName(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && basename(value) === value && value.length <= 200;
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+(?:\.[0-9]+){3,4}$/.test(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
