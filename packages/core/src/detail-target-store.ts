import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const detailTargetTtlMs = 10 * 60 * 1000;
const allowedObservationSkewMs = 24 * 60 * 60 * 1000;

export type DetailTargetBinding = {
  detail_ref: string;
  site_slug: "xiaohongshu";
  identity_environment_ref: string;
  runtime_session_ref: string;
  search_run_ref: string;
  search_result_ref: string;
  observed_at: string;
  created_at: string;
  expires_at: string;
};

export type DetailTargetBatch = { directory: string; batch_id: string };
export type DetailTargetReservation = { directory: string; detail_ref: string; detail_run_ref: string };
export type DetailTargetClaim = { ok: true; binding: DetailTargetBinding } | { ok: false; code: DetailTargetFailureCode };
export type DetailTargetReserve = { ok: true; binding: DetailTargetBinding; reservation: DetailTargetReservation } | { ok: false; code: DetailTargetFailureCode };
export type DetailTargetLookup = DetailTargetClaim;
type DetailTargetFailureCode = "detail_ref_unknown" | "detail_ref_binding_mismatch" | "detail_ref_expired" | "detail_ref_already_consumed";

const detailRefPattern = /^detail_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const batchIdPattern = /^[0-9a-f]{64}$/;
const sensitiveRefPattern = /(https?:\/\/|[\r\n\0]|cookie|token|xsec|password|authorization|raw_dom|raw_har)/i;

export function isOpaqueDetailRef(value: unknown): value is string {
  return typeof value === "string" && detailRefPattern.test(value);
}

type PersistInput = Omit<DetailTargetBinding, "detail_ref" | "observed_at" | "created_at" | "expires_at"> & {
  detail_refs: readonly string[];
  observed_at: string;
};

export async function stageSearchDetailTargets(directory: string, input: PersistInput, now = new Date()): Promise<DetailTargetBatch> {
  const root = await secureStoreRoot(directory);
  const createdAt = validClock(now, "detail target persistence clock");
  const observedAt = validClock(new Date(input.observed_at), "detail target observed_at");
  if (Math.abs(observedAt.getTime() - createdAt.getTime()) > allowedObservationSkewMs) throw new Error("detail target observed_at skew is invalid");
  if (input.detail_refs.length === 0 || new Set(input.detail_refs).size !== input.detail_refs.length || input.detail_refs.some((ref) => !isOpaqueDetailRef(ref))) {
    throw new Error("detail target refs are invalid");
  }
  assertBindingRefs(input);
  const reservationPaths: string[] = [];
  try {
    for (const ref of input.detail_refs) {
      const reservation = join(root, "reservations", refKey(ref));
      await writeNoFollow(reservation, `${input.search_run_ref}\n`);
      reservationPaths.push(reservation);
    }
    await rejectExistingRefs(root, input.detail_refs);
  } catch (error) {
    await releaseReservations(reservationPaths);
    throw error;
  }
  const batchKey = refKey(input.search_run_ref);
  const stagedPath = join(root, "staging", `${batchKey}.staged`);
  const publishedPath = join(root, "published", batchKey);
  try {
    await assertAbsent(stagedPath);
    await assertAbsent(publishedPath);
    await mkdir(stagedPath, { mode: 0o700 });
    await assertSecureDirectory(root, stagedPath);
    for (const detail_ref of input.detail_refs) {
      const binding: DetailTargetBinding = {
        detail_ref,
        site_slug: "xiaohongshu",
        identity_environment_ref: input.identity_environment_ref,
        runtime_session_ref: input.runtime_session_ref,
        search_run_ref: input.search_run_ref,
        search_result_ref: input.search_result_ref,
        observed_at: observedAt.toISOString(),
        created_at: createdAt.toISOString(),
        expires_at: new Date(createdAt.getTime() + detailTargetTtlMs).toISOString()
      };
      await writeNoFollow(join(stagedPath, `${refKey(detail_ref)}.json`), `${JSON.stringify(binding)}\n`);
    }
    const written = await readdir(stagedPath);
    if (written.length !== input.detail_refs.length) throw new Error("detail target batch verification failed");
    return { directory: await realpath(directory), batch_id: batchKey };
  } catch (error) {
    await rm(stagedPath, { recursive: true, force: true });
    await releaseReservations(reservationPaths);
    throw error;
  }
}

export async function publishSearchDetailTargets(batch: DetailTargetBatch): Promise<void> {
  const paths = await batchPaths(batch);
  await assertSecureDirectory(paths.root, paths.staged);
  await assertAbsent(paths.published);
  await rename(paths.staged, paths.published);
  await assertSecureDirectory(paths.root, paths.published);
  // Rename is the publication commit point. Cleanup is recoverable and must not
  // report an already-published batch as failed.
  await recoverPublishedSearchDetailTargetReservations(batch).catch(() => undefined);
}

export async function rollbackSearchDetailTargets(batch: DetailTargetBatch): Promise<void> {
  const paths = await batchPaths(batch);
  await rejectSymlink(paths.staged, true);
  await releaseBatchReservations(paths.root, paths.staged);
  await rm(paths.staged, { recursive: true, force: true });
}

export async function compensatePublishedSearchDetailTargets(batch: DetailTargetBatch): Promise<void> {
  const paths = await batchPaths(batch);
  await rejectSymlink(paths.published, true);
  await recoverPublishedSearchDetailTargetReservations(batch);
  await rm(paths.published, { recursive: true, force: true });
}

export async function recoverPublishedSearchDetailTargetReservations(batch: DetailTargetBatch): Promise<void> {
  const paths = await batchPaths(batch);
  await releaseBatchReservations(paths.root, paths.published);
}

export async function persistSearchDetailTargets(directory: string, input: PersistInput, now = new Date()): Promise<void> {
  const batch = await stageSearchDetailTargets(directory, input, now);
  try {
    await publishSearchDetailTargets(batch);
  } catch (error) {
    await rollbackSearchDetailTargets(batch);
    throw error;
  }
}

export async function inspectDetailTarget(
  directory: string,
  detailRef: string,
  expected: Omit<Parameters<typeof claimDetailTarget>[2], "detail_run_ref">,
  now = new Date()
): Promise<DetailTargetLookup> {
  if (!isOpaqueDetailRef(detailRef)) return { ok: false, code: "detail_ref_unknown" };
  const root = await secureStoreRoot(directory);
  if (await secureExists(root, consumedPath(root, detailRef))) return { ok: false, code: "detail_ref_already_consumed" };
  const path = await findPublishedPath(root, detailRef);
  if (!path) return { ok: false, code: "detail_ref_unknown" };
  const binding = await readBinding(root, path);
  if (!matchesBinding(binding, detailRef, expected)) return { ok: false, code: "detail_ref_binding_mismatch" };
  return Date.parse(binding.expires_at) <= validClock(now, "detail target claim clock").getTime()
    ? { ok: false, code: "detail_ref_expired" }
    : { ok: true, binding };
}

export async function claimDetailTarget(
  directory: string,
  detailRef: string,
  expected: { site_slug: "xiaohongshu"; identity_environment_ref: string; runtime_session_ref: string; detail_run_ref: string },
  now = new Date()
): Promise<DetailTargetClaim> {
  const reserved = await reserveDetailTarget(directory, detailRef, expected, now);
  if (!reserved.ok) return reserved;
  return commitDetailTargetReservation(reserved.reservation, now);
}

export async function reserveDetailTarget(
  directory: string,
  detailRef: string,
  expected: { site_slug: "xiaohongshu"; identity_environment_ref: string; runtime_session_ref: string; detail_run_ref: string },
  now = new Date()
): Promise<DetailTargetReserve> {
  assertClaimRefs(expected);
  const inspected = await inspectDetailTarget(directory, detailRef, expected, now);
  if (!inspected.ok) return inspected;
  const root = await secureStoreRoot(directory);
  const reservation: DetailTargetReservation = { directory: await realpath(directory), detail_ref: detailRef, detail_run_ref: expected.detail_run_ref };
  try {
    await writeNoFollow(claimPath(root, detailRef), `${JSON.stringify({ detail_ref: detailRef, detail_run_ref: expected.detail_run_ref })}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { ok: false, code: "detail_ref_already_consumed" };
  }
  return { ok: true, binding: inspected.binding, reservation };
}

export async function commitDetailTargetReservation(reservation: DetailTargetReservation, now = new Date()): Promise<DetailTargetClaim> {
  const { root, binding } = await validateClaimReservation(reservation);
  const source = await findPublishedPath(root, reservation.detail_ref);
  if (!source) return { ok: false, code: "detail_ref_already_consumed" };
  const tombstone = consumedPath(root, reservation.detail_ref);
  const claimClock = validClock(now, "detail target claim clock");
  try {
    await writeNoFollow(tombstone, `${JSON.stringify({ ...binding, consumed_by_run_ref: reservation.detail_run_ref, consumed_at: claimClock.toISOString() })}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await unlink(claimPath(root, reservation.detail_ref)).catch(() => undefined);
    return { ok: false, code: "detail_ref_already_consumed" };
  }
  try {
    await unlink(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  } finally {
    await unlink(claimPath(root, reservation.detail_ref)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { ok: true, binding };
}

export async function releaseDetailTargetReservation(reservation: DetailTargetReservation): Promise<void> {
  const { root } = await validateClaimReservation(reservation);
  await unlink(claimPath(root, reservation.detail_ref));
}

function matchesBinding(binding: DetailTargetBinding, detailRef: string, expected: { site_slug: "xiaohongshu"; identity_environment_ref: string; runtime_session_ref: string }): boolean {
  return binding.detail_ref === detailRef && binding.site_slug === expected.site_slug &&
    binding.identity_environment_ref === expected.identity_environment_ref && binding.runtime_session_ref === expected.runtime_session_ref;
}

function validClock(value: Date, label: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
  return value;
}

function refKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function consumedPath(root: string, detailRef: string): string {
  return join(root, "consumed", `${refKey(detailRef)}.json`);
}

function claimPath(root: string, detailRef: string): string {
  return join(root, "claims", `${refKey(detailRef)}.json`);
}

async function secureStoreRoot(directory: string): Promise<string> {
  const base = await realpath(directory);
  const root = join(base, ".detail-targets");
  await secureMkdir(base, root);
  for (const name of ["staging", "published", "consumed", "reservations", "claims"]) await secureMkdir(root, join(root, name));
  return await realpath(root);
}

async function batchPaths(batch: DetailTargetBatch): Promise<{ root: string; staged: string; published: string }> {
  if (!batchIdPattern.test(batch.batch_id)) throw new Error("detail target batch is invalid");
  const directory = await realpath(batch.directory);
  const root = await secureStoreRoot(directory);
  return {
    root,
    staged: join(root, "staging", `${batch.batch_id}.staged`),
    published: join(root, "published", batch.batch_id)
  };
}

async function releaseBatchReservations(root: string, batchPath: string): Promise<void> {
  try {
    await assertSecureDirectory(root, batchPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const refs: string[] = [];
  for (const name of await readdir(batchPath)) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) throw new Error("detail target batch entry is invalid");
    const binding = await readBinding(root, join(batchPath, name));
    if (!isOpaqueDetailRef(binding.detail_ref)) throw new Error("detail target batch binding is invalid");
    refs.push(binding.detail_ref);
  }
  await releaseReservations(refs.map((ref) => join(root, "reservations", refKey(ref))));
}

async function validateClaimReservation(reservation: DetailTargetReservation): Promise<{ root: string; binding: DetailTargetBinding }> {
  if (!isOpaqueDetailRef(reservation.detail_ref)) throw new Error("detail target reservation is invalid");
  assertSafeRef(reservation.detail_run_ref, "run", /^(?:run[_-])[A-Za-z0-9._:-]{1,200}$/);
  const root = await secureStoreRoot(reservation.directory);
  const path = claimPath(root, reservation.detail_ref);
  const claim = JSON.parse(await readNoFollow(root, path)) as { detail_ref?: unknown; detail_run_ref?: unknown };
  if (claim.detail_ref !== reservation.detail_ref || claim.detail_run_ref !== reservation.detail_run_ref) throw new Error("detail target reservation binding mismatch");
  const source = await findPublishedPath(root, reservation.detail_ref);
  if (!source) throw new Error("detail target reservation source is missing");
  return { root, binding: await readBinding(root, source) };
}

async function secureMkdir(parent: string, path: string): Promise<void> {
  assertContained(parent, path);
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  await assertSecureDirectory(parent, path);
}

async function assertSecureDirectory(root: string, path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("detail target path is not a secure directory");
  assertContained(root, await realpath(path));
}

async function rejectSymlink(path: string, allowMissing = false): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("detail target symlink is forbidden");
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function assertContained(root: string, path: string): void {
  const value = relative(resolve(root), resolve(path));
  if (value === ".." || value.startsWith(`..${sep}`) || resolve(path) === resolve(root) && path !== root) throw new Error("detail target path escaped store root");
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error("detail target path already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function secureExists(root: string, path: string): Promise<boolean> {
  assertContained(root, path);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("detail target file is unsafe");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function rejectExistingRefs(root: string, refs: readonly string[]): Promise<void> {
  for (const ref of refs) {
    if (await secureExists(root, consumedPath(root, ref)) || await findPublishedPath(root, ref)) throw new Error("detail target ref already exists");
  }
}

async function releaseReservations(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  })));
}

async function findPublishedPath(root: string, detailRef: string): Promise<string | undefined> {
  const published = join(root, "published");
  const filename = `${refKey(detailRef)}.json`;
  let found: string | undefined;
  for (const entry of await readdir(published, { withFileTypes: true })) {
    const batch = join(published, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("detail target published batch is unsafe");
    await assertSecureDirectory(root, batch);
    const candidate = join(batch, filename);
    if (await secureExists(root, candidate)) {
      if (found) throw new Error("detail target ref is duplicated");
      found = candidate;
    }
  }
  return found;
}

async function readBinding(root: string, path: string): Promise<DetailTargetBinding> {
  assertContained(root, path);
  await rejectSymlink(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile("utf8")) as DetailTargetBinding;
  } finally {
    await handle.close();
  }
}

async function readNoFollow(root: string, path: string): Promise<string> {
  assertContained(root, path);
  await rejectSymlink(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function assertBindingRefs(input: PersistInput): void {
  assertSafeRef(input.identity_environment_ref, "identity environment", /^identity-env[_-][A-Za-z0-9._:-]{1,200}$/);
  assertSafeRef(input.runtime_session_ref, "runtime session", /^session[_-][A-Za-z0-9._:-]{1,200}$/);
  assertSafeRef(input.search_run_ref, "search run", /^run[_-][A-Za-z0-9._:-]{1,200}$/);
  assertSafeRef(input.search_result_ref, "search result", /^(?:read_result_|result[_:-])[A-Za-z0-9._:/-]{1,240}$/);
}

function assertClaimRefs(input: { identity_environment_ref: string; runtime_session_ref: string; detail_run_ref: string }): void {
  assertSafeRef(input.identity_environment_ref, "identity environment", /^identity-env[_-][A-Za-z0-9._:-]{1,200}$/);
  assertSafeRef(input.runtime_session_ref, "runtime session", /^session[_-][A-Za-z0-9._:-]{1,200}$/);
  assertSafeRef(input.detail_run_ref, "detail run", /^run[_-][A-Za-z0-9._:-]{1,200}$/);
}

function assertSafeRef(value: string, label: string, pattern: RegExp): void {
  if (!pattern.test(value) || sensitiveRefPattern.test(value)) throw new Error(`${label} ref is invalid`);
}

async function writeNoFollow(path: string, value: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
