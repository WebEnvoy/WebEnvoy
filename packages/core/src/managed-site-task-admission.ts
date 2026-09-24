import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError } from "./managed-access.js";
import type { SiteSkillPackagePin, VerifiedSiteTask } from "./site-skill-package.js";

type Json = Record<string, unknown>;
type CandidateScriptPin = NonNullable<ExtendedSiteSkillPackagePin["script"]>;
export type ExtendedSiteSkillPackagePin = SiteSkillPackagePin & {
  manifest_sha256: string;
  source_repository: string;
  source_path: string;
  source_commit: string;
  source_ref: string;
  lock_ref: string;
  capability_asset_ref: string;
  script: ({
    script_ref: string;
    path: string;
    version: string;
    sha256: string;
    runtime_kind: "webenvoy.site-skill-script-abi/v1";
    entrypoint: "run";
    broker: "webenvoy.site-skill-broker/v1";
    broker_capabilities: readonly ["runtime.invoke", "output.write"];
  } | {
    script_ref: string;
    path: string;
    version: string;
    sha256: string;
    runtime_kind: "webenvoy.site-skill-script-abi/v1";
    entrypoint: "run";
    broker: "webenvoy.site-skill-broker/v1.1";
    broker_capabilities: readonly ["network.read", "output.write"];
  }) | undefined;
};

export type ManagedSiteTaskPackageRequest = {
  package_ref: string;
  revision_ref: string;
  package_digest: string;
  task_ref: string;
};

export type OwnerAdmittedSiteTaskPin = {
  pin: ExtendedSiteSkillPackagePin;
  lodeAssetsPath: string;
  admission_ref: string;
  source_ref: string;
  source_commit: string;
  task_ref: string;
  code_admission_ref?: string;
};

export const managedSiteTaskAdmissionStoreSchemaVersion = "webenvoy.site-task-source-admissions.v2" as const;
const legacyManagedSiteTaskAdmissionStoreSchemaVersion = "webenvoy.site-task-source-admissions.v1" as const;

const fail = (code: string): never => { throw new ManagedAccessError(code); };
const digest = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);
const maxIndexBytes = 1024 * 1024;
const maxManifestBytes = 1024 * 1024;
const maxOwnerDiffBytes = 128 * 1024;
const shaRefPattern = /^sha256:[a-f0-9]{64}$/;
const manifestDigestPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const packageRefPattern = /^lode:\/\/site-skill\/[A-Za-z0-9._/-]+$/;
const sourceCandidatePattern = /^webenvoy:site-task-candidate\/[0-9a-f-]{36}#sha256:[a-f0-9]{64}$/;
const repositoryRefPattern = /^webenvoy:site-task-authoring-repository\/[0-9a-f-]{36}$/;
const localRevisionPattern = /^webenvoy:site-task-source-revision\/[0-9a-f-]{36}@1#sha256:[a-f0-9]{64}$/;
const sourceAdmissionPattern = /^webenvoy\.source-admission\/site-skill-package\/v1#sha256:[a-f0-9]{64}$/;
const gitNullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

type StoredRepository = { repository_ref: string; path: string; selected_at: string };
type StoredCandidate = {
  candidate_ref: string;
  repository_ref: string;
  base_revision_ref: string | null;
  pin: ExtendedSiteSkillPackagePin;
  authoring_commit: string;
  source_commit: string;
  changed_paths: string[];
  diff_sha256: string;
  inspected_at: string;
};
type StoredReceipt = {
  local_revision_ref: string;
  admission_ref: string;
  repository_ref: string;
  base_revision_ref: string | null;
  pin: ExtendedSiteSkillPackagePin;
  authoring_commit: string;
  source_commit: string;
  created_at: string;
  revoked_at: string | null;
  code_admission_ref: string | null;
  code_admitted_at: string | null;
  code_revoked_at: string | null;
};
type State = {
  schema_version: typeof managedSiteTaskAdmissionStoreSchemaVersion;
  repositories: StoredRepository[];
  candidates: StoredCandidate[];
  receipts: StoredReceipt[];
};

type GitResult = { stdout: string; stderr: string };
function isObject(value: unknown): value is Json { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function text(value: unknown, code = "managed_site_task_admission_invalid_input"): string {
  if (typeof value !== "string" || !value || value.length > 4096 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail(code);
  return value;
}
function exactObject(value: unknown, required: string[], optional: string[] = []): Json {
  if (!isObject(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) return fail("managed_site_task_source_corrupt");
  return value;
}
function safeRelative(value: unknown): string {
  const path = text(value, "managed_site_task_source_corrupt");
  if (path.startsWith("/") || path.includes("\\") || path === "." || path.split("/").some(part => part === "" || part === "." || part === "..")) return fail("managed_site_task_source_corrupt");
  return path;
}
function timestamp(value: unknown): string {
  const result = text(value, "managed_site_task_admission_store_invalid");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) return fail("managed_site_task_admission_store_invalid");
  return result;
}
function within(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function parseTimestampOrNull(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}
function pinDigestFields(pin: ExtendedSiteSkillPackagePin): Json {
  return {
    package_ref: pin.package_ref, package_path: pin.package_path, task_ref: pin.task_ref, revision_ref: pin.revision_ref,
    package_digest: pin.package_digest, manifest_sha256: pin.manifest_sha256, source_repository: pin.source_repository,
    source_path: pin.source_path, source_commit: pin.source_commit, source_ref: pin.source_ref,
    lock_ref: pin.lock_ref, capability_asset_ref: pin.capability_asset_ref, script: pin.script ?? null
  };
}
function localRevisionRef(candidate: StoredCandidate): string {
  const id = randomUUID();
  const snapshot = {
    base_revision_ref: candidate.base_revision_ref, package_ref: candidate.pin.package_ref,
    revision_ref: candidate.pin.revision_ref, package_digest: candidate.pin.package_digest,
    source_ref: candidate.pin.source_ref, source_commit: candidate.source_commit,
    authoring_commit: candidate.authoring_commit, task_ref: candidate.pin.task_ref
  };
  return `webenvoy:site-task-source-revision/${id}@1#sha256:${digest(canonical(snapshot))}`;
}
function sourceAdmissionRef(receipt: Pick<StoredReceipt,
  "local_revision_ref" | "pin" | "source_commit" | "authoring_commit">): string {
  const snapshot = {
    local_revision_ref: receipt.local_revision_ref,
    package_ref: receipt.pin.package_ref,
    revision_ref: receipt.pin.revision_ref,
    package_digest: receipt.pin.package_digest,
    source_ref: receipt.pin.source_ref,
    source_commit: receipt.source_commit,
    authoring_commit: receipt.authoring_commit,
    task_ref: receipt.pin.task_ref
  };
  return `webenvoy.source-admission/site-skill-package/v1#sha256:${digest(canonical(snapshot))}`;
}
function candidateRef(candidate: Omit<StoredCandidate, "candidate_ref" | "inspected_at">): string {
  return `webenvoy:site-task-candidate/${randomUUID()}#sha256:${candidateDigest(candidate)}`;
}
function candidateDigest(candidate: Pick<StoredCandidate, "repository_ref" | "base_revision_ref" | "pin" | "authoring_commit" | "source_commit" | "changed_paths" | "diff_sha256">): string {
  return digest(canonical({
    repository_ref: candidate.repository_ref,
    base_revision_ref: candidate.base_revision_ref,
    pin: pinDigestFields(candidate.pin),
    authoring_commit: candidate.authoring_commit,
    source_commit: candidate.source_commit,
    changed_paths: candidate.changed_paths,
    diff_sha256: candidate.diff_sha256
  }));
}
function nullableText(value: unknown, code = "managed_site_task_admission_invalid_input"): string | null {
  return value === null ? null : text(value, code);
}
function candidateRefMatches(candidate: StoredCandidate): boolean {
  const prefix = candidate.candidate_ref.split("#", 1)[0];
  return candidate.candidate_ref === `${prefix}#sha256:${candidateDigest(candidate)}`;
}

export type SiteTaskAdmissionRuntime = {
  approvedBasePackageFor(packageRef: string): ExtendedSiteSkillPackagePin | undefined;
  verifyPackageRoot(root: string, pin: ExtendedSiteSkillPackagePin): Promise<Pick<VerifiedSiteTask,
    "package_ref" | "revision_ref" | "package_digest" | "source_ref" | "source_commit" | "task_ref" | "files">>;
  scriptCodeAdmissionRef(pin: ExtendedSiteSkillPackagePin): string;
};

async function git(root: string, args: string[], maxBuffer = 2 * 1024 * 1024, useSelectedWorktree = true): Promise<GitResult> {
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_GLOBAL: gitNullDevice,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
      LC_ALL: "C"
    });
    const commandArgs = args[0] === "diff" ? ["diff", "--no-ext-diff", "--no-textconv", ...args.slice(1)] : args;
    const safeArgs = [
      "--no-pager", "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${gitNullDevice}`,
      "-c", "core.pager=cat", "-c", "pager.status=false", "-c", "diff.external=", "-C", root
    ];
    if (useSelectedWorktree) safeArgs.push(`--work-tree=${root}`);
    safeArgs.push(...commandArgs);
    const result = await execFileAsync("git", safeArgs, { encoding: "utf8", maxBuffer, env });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1) throw error;
    return fail("managed_site_task_authoring_repository_invalid");
  }
}
async function candidateDiffRange(root: string, baseRevisionRef: string | null, pin: ExtendedSiteSkillPackagePin, authoringCommit: string,
  runtime: SiteTaskAdmissionRuntime): Promise<{ range: string; packagePath: string }> {
  if (baseRevisionRef !== null) {
    const base = runtime.approvedBasePackageFor(pin.package_ref);
    if (!base || base.revision_ref !== baseRevisionRef) return fail("managed_site_task_base_revision_unapproved");
    return { range: `${base.source_commit}..${authoringCommit}`, packagePath: base.package_path };
  }
  if (runtime.approvedBasePackageFor(pin.package_ref)) return fail("managed_site_task_base_revision_unapproved");
  const parent = await git(root, ["rev-parse", `${pin.source_commit}^`]).then(result => result.stdout.trim()).catch(() => "");
  if (!commitPattern.test(parent)) return fail("managed_site_task_source_commit_unreviewable");
  return { range: `${parent}..${authoringCommit}`, packagePath: pin.package_path };
}
async function assertNoSymlinkPath(path: string): Promise<void> {
  const absolute = resolve(path);
  const parsed = absolute.split(sep).filter(Boolean);
  let current: string = sep;
  for (const part of parsed) {
    current = join(current, part);
    const info = await lstat(current).catch(() => fail("managed_site_task_authoring_repository_unavailable"));
    if (info.isSymbolicLink()) return fail("managed_site_task_authoring_repository_invalid");
  }
}
async function readRegular(root: string, relativePath: string, limit: number): Promise<Buffer> {
  const clean = safeRelative(relativePath);
  let current = root;
  const parts = clean.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("managed_site_task_source_missing");
      throw error;
    });
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory() || index === parts.length - 1 && (!info.isFile() || info.size > limit)) return fail("managed_site_task_source_corrupt");
  }
  const bytes = await readFile(current);
  if (bytes.byteLength > limit) return fail("managed_site_task_source_corrupt");
  return bytes;
}
function readObject(bytes: Buffer): Json {
  try { return exactObject(JSON.parse(bytes.toString("utf8")), [], Object.keys(JSON.parse(bytes.toString("utf8")))); }
  catch (error) { if (error instanceof ManagedAccessError) throw error; return fail("managed_site_task_source_corrupt"); }
}
function sourceComparableBytes(path: string, bytes: Buffer, capabilityPath: string, pin: ExtendedSiteSkillPackagePin): Buffer {
  if (path !== "package-lock.json" && path !== capabilityPath) return bytes;
  const value = readObject(bytes);
  if (path === "package-lock.json") {
    const revisionPrefix = `${pin.package_ref}@`;
    const revision = typeof value.revision_ref === "string" && value.revision_ref.startsWith(revisionPrefix) ? /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)#[a-f0-9]{40}$/.exec(value.revision_ref.slice(revisionPrefix.length)) : null;
    const sourcePrefix = `lode://source/site-skill/${pin.package_ref.slice("lode://site-skill/".length)}@`;
    const sourceRef = typeof value.source_ref === "string" && value.source_ref.startsWith(sourcePrefix) ? /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)#[a-f0-9]{40}$/.exec(value.source_ref.slice(sourcePrefix.length)) : null;
    if (!revision || !sourceRef || revision.slice(1, 4).join(".") !== sourceRef.slice(1, 4).join(".") || value.version !== revision.slice(1, 4).join(".")) return fail("managed_site_task_source_tree_mismatch");
    value.revision_ref = "<generated-source-pin>";
    value.source_ref = "<generated-source-pin>";
  } else {
    if (typeof value.source_ref !== "string" || !/^lode:\/\/source\/.+@[0-9]+\.[0-9]+\.[0-9]+#[a-f0-9]{40}$/.test(value.source_ref)) return fail("managed_site_task_source_tree_mismatch");
    value.source_ref = "<generated-source-pin>";
  }
  return Buffer.from(canonical(value));
}
function versionTuple(version: unknown): [number, number, number] {
  const value = text(version, "managed_site_task_source_corrupt");
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
  if (!match) return fail("managed_site_task_source_corrupt");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function versionGreater(candidate: unknown, base: unknown): boolean {
  const left = versionTuple(candidate), right = versionTuple(base);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index]! > right[index]!;
  return false;
}
function derivePin(packageRef: string, taskRef: string, index: Json, manifestBytes: Buffer): ExtendedSiteSkillPackagePin {
  const entries = Array.isArray(index.entries) ? index.entries.filter(value => isObject(value) && value.package_ref === packageRef) : [];
  if (entries.length !== 1) return fail("managed_site_task_source_corrupt");
  const entry = exactObject(entries[0], ["package_ref", "package_type", "package_path", "manifest_path", "revision_ref", "package_digest", "task_refs"]);
  const packagePath = safeRelative(entry.package_path);
  if (entry.package_type !== "site-skill" || entry.manifest_path !== `${packagePath}/manifest.json` || !Array.isArray(entry.task_refs) || !entry.task_refs.includes(taskRef)) return fail("managed_site_task_source_corrupt");
  const manifest = readObject(manifestBytes);
  const source = exactObject(manifest.source, ["repository", "package_path", "commit", "source_ref"]);
  const lock = exactObject(manifest.package_lock, ["path", "lock_ref"]);
  const integrity = exactObject(manifest.integrity, ["files", "package_digest"]);
  const version = text(manifest.version, "managed_site_task_source_corrupt");
  const commit = text(source.commit, "managed_site_task_source_corrupt");
  if (!commitPattern.test(commit) || manifest.manifest_version !== "lode.site-skill-package.manifest.v1" || manifest.package_type !== "site-skill" ||
      manifest.package_ref !== packageRef || source.package_path !== packagePath || lock.path !== "package-lock.json" ||
      !Array.isArray(integrity.files) || !shaRefPattern.test(String(entry.package_digest)) || integrity.package_digest !== entry.package_digest ||
      entry.revision_ref !== `${packageRef}@${version}#${commit}`) return fail("managed_site_task_source_corrupt");
  const capabilityAssets = Array.isArray(manifest.assets) ? manifest.assets.filter(value => isObject(value) && value.role === "capability_declaration") : [];
  const scripts = Array.isArray(manifest.scripts) ? manifest.scripts : [];
  if (capabilityAssets.length !== 1 || scripts.length > 1) return fail("managed_site_task_source_corrupt");
  let script: ExtendedSiteSkillPackagePin["script"];
  if (scripts.length === 1) {
    const declaration = exactObject(scripts[0], ["script_ref", "path", "source_commit", "version", "sha256", "runtime_kind", "entrypoint", "input_schema_ref", "output_schema_ref", "capability_refs", "action", "broker", "broker_capabilities", "target_binding", "timeout_ms", "cancel", "data_handling"]);
    const capabilities = declaration.broker_capabilities;
    const pageBroker = declaration.broker === "webenvoy.site-skill-broker/v1" && canonical(capabilities) === canonical(["runtime.invoke", "output.write"]);
    const publicReadBroker = declaration.broker === "webenvoy.site-skill-broker/v1.1" && canonical(capabilities) === canonical(["network.read", "output.write"]);
    if (!Array.isArray(capabilities) || !(pageBroker || publicReadBroker) || declaration.runtime_kind !== "webenvoy.site-skill-script-abi/v1" ||
        declaration.entrypoint !== "run" || declaration.source_commit !== commit ||
        !shaRefPattern.test(String(declaration.sha256))) return fail("managed_site_task_source_corrupt");
    const base = { script_ref: text(declaration.script_ref, "managed_site_task_source_corrupt"), path: safeRelative(declaration.path),
      version: text(declaration.version, "managed_site_task_source_corrupt"), sha256: text(declaration.sha256, "managed_site_task_source_corrupt"),
      runtime_kind: "webenvoy.site-skill-script-abi/v1" as const, entrypoint: "run" as const };
    script = publicReadBroker
      ? { ...base, broker: "webenvoy.site-skill-broker/v1.1", broker_capabilities: ["network.read", "output.write"] as const }
      : { ...base, broker: "webenvoy.site-skill-broker/v1", broker_capabilities: ["runtime.invoke", "output.write"] as const };
  }
  return {
    package_ref: packageRef,
    package_path: packagePath,
    task_ref: taskRef,
    revision_ref: text(entry.revision_ref, "managed_site_task_source_corrupt"),
    package_digest: text(entry.package_digest, "managed_site_task_source_corrupt"),
    manifest_sha256: digest(manifestBytes),
    source_repository: text(source.repository, "managed_site_task_source_corrupt"),
    source_path: packagePath,
    source_commit: commit,
    source_ref: text(source.source_ref, "managed_site_task_source_corrupt"),
    lock_ref: text(lock.lock_ref, "managed_site_task_source_corrupt"),
    capability_asset_ref: text((capabilityAssets[0] as Json).capability_ref, "managed_site_task_source_corrupt"),
    script
  };
}

function parsePin(value: unknown): ExtendedSiteSkillPackagePin {
  const pin = exactObject(value, ["package_ref", "package_path", "task_ref", "revision_ref", "package_digest", "manifest_sha256", "source_repository", "source_path", "source_commit", "source_ref", "lock_ref", "capability_asset_ref", "script"]);
  if (!packageRefPattern.test(text(pin.package_ref)) || !shaRefPattern.test(text(pin.package_digest)) || !manifestDigestPattern.test(text(pin.manifest_sha256)) || !commitPattern.test(text(pin.source_commit)) ||
      typeof pin.script !== "undefined" && pin.script !== undefined && pin.script !== null && !isObject(pin.script)) return fail("managed_site_task_admission_store_invalid");
  let script: ExtendedSiteSkillPackagePin["script"];
  if (isObject(pin.script)) {
    const candidate = exactObject(pin.script, ["script_ref", "path", "version", "sha256", "runtime_kind", "entrypoint", "broker", "broker_capabilities"]);
    const pageBroker = candidate.broker === "webenvoy.site-skill-broker/v1" && canonical(candidate.broker_capabilities) === canonical(["runtime.invoke", "output.write"]);
    const publicReadBroker = candidate.broker === "webenvoy.site-skill-broker/v1.1" && canonical(candidate.broker_capabilities) === canonical(["network.read", "output.write"]);
    if (candidate.runtime_kind !== "webenvoy.site-skill-script-abi/v1" || candidate.entrypoint !== "run" || !(pageBroker || publicReadBroker) ||
        !Array.isArray(candidate.broker_capabilities)) return fail("managed_site_task_admission_store_invalid");
    const base = { script_ref: text(candidate.script_ref), path: safeRelative(candidate.path), version: text(candidate.version), sha256: text(candidate.sha256),
      runtime_kind: "webenvoy.site-skill-script-abi/v1" as const, entrypoint: "run" as const };
    script = publicReadBroker
      ? { ...base, broker: "webenvoy.site-skill-broker/v1.1", broker_capabilities: ["network.read", "output.write"] as const }
      : { ...base, broker: "webenvoy.site-skill-broker/v1", broker_capabilities: ["runtime.invoke", "output.write"] as const };
  }
  const result: ExtendedSiteSkillPackagePin = {
    package_ref: text(pin.package_ref), package_path: safeRelative(pin.package_path), task_ref: text(pin.task_ref), revision_ref: text(pin.revision_ref),
    package_digest: text(pin.package_digest), manifest_sha256: text(pin.manifest_sha256), source_repository: text(pin.source_repository),
    source_path: safeRelative(pin.source_path), source_commit: text(pin.source_commit), source_ref: text(pin.source_ref), lock_ref: text(pin.lock_ref),
    capability_asset_ref: text(pin.capability_asset_ref), script
  };
  if (result.revision_ref !== `${result.package_ref}@${result.revision_ref.split("@").at(-1)?.split("#")[0]}#${result.source_commit}`) return fail("managed_site_task_admission_store_invalid");
  return result;
}

function parseState(value: unknown, runtime: SiteTaskAdmissionRuntime): State {
  const state = exactObject(value, ["schema_version", "repositories", "candidates", "receipts"]);
  if (state.schema_version !== managedSiteTaskAdmissionStoreSchemaVersion && state.schema_version !== legacyManagedSiteTaskAdmissionStoreSchemaVersion ||
      !Array.isArray(state.repositories) || !Array.isArray(state.candidates) || !Array.isArray(state.receipts) ||
      state.repositories.length > 128 || state.candidates.length > 4096 || state.receipts.length > 4096) return fail("managed_site_task_admission_store_invalid");
  const repositories: StoredRepository[] = state.repositories.map(value => {
    const item = exactObject(value, ["repository_ref", "path", "selected_at"]);
    const ref = text(item.repository_ref, "managed_site_task_admission_store_invalid");
    const path = text(item.path, "managed_site_task_admission_store_invalid");
    if (!repositoryRefPattern.test(ref) || !isAbsolute(path)) return fail("managed_site_task_admission_store_invalid");
    return { repository_ref: ref, path, selected_at: timestamp(item.selected_at) };
  });
  const candidates: StoredCandidate[] = state.candidates.map(value => {
    const item = exactObject(value, ["candidate_ref", "repository_ref", "base_revision_ref", "pin", "authoring_commit", "source_commit", "changed_paths", "diff_sha256", "inspected_at"]);
    const pin = parsePin(item.pin);
    const baseRevisionRef = nullableText(item.base_revision_ref, "managed_site_task_admission_store_invalid");
    if (state.schema_version === legacyManagedSiteTaskAdmissionStoreSchemaVersion && baseRevisionRef === null) return fail("managed_site_task_admission_store_invalid");
    if (!sourceCandidatePattern.test(text(item.candidate_ref, "managed_site_task_admission_store_invalid")) ||
        !repositories.some(repo => repo.repository_ref === item.repository_ref) || !commitPattern.test(text(item.authoring_commit, "managed_site_task_admission_store_invalid")) ||
        !commitPattern.test(text(item.source_commit, "managed_site_task_admission_store_invalid")) || !Array.isArray(item.changed_paths) ||
        !shaRefPattern.test(text(item.diff_sha256, "managed_site_task_admission_store_invalid"))) return fail("managed_site_task_admission_store_invalid");
    const base = runtime.approvedBasePackageFor(pin.package_ref);
    if ((baseRevisionRef === null ? false : !base || base.revision_ref !== baseRevisionRef || pin.task_ref !== base.task_ref) || pin.source_commit !== item.source_commit) return fail("managed_site_task_admission_store_invalid");
    const candidate = { candidate_ref: String(item.candidate_ref), repository_ref: String(item.repository_ref), base_revision_ref: baseRevisionRef, pin,
      authoring_commit: String(item.authoring_commit), source_commit: String(item.source_commit), changed_paths: item.changed_paths.map(value => text(value, "managed_site_task_admission_store_invalid")),
      diff_sha256: String(item.diff_sha256), inspected_at: timestamp(item.inspected_at) };
    if (candidate.changed_paths.some(path => safeRelative(path) !== path) || !candidateRefMatches(candidate)) return fail("managed_site_task_admission_store_invalid");
    return candidate;
  });
  const receipts: StoredReceipt[] = state.receipts.map(value => {
    const item = exactObject(value, ["local_revision_ref", "admission_ref", "repository_ref", "base_revision_ref", "pin", "authoring_commit", "source_commit", "created_at", "revoked_at", "code_admission_ref", "code_admitted_at", "code_revoked_at"]);
    const pin = parsePin(item.pin);
    const baseRevisionRef = nullableText(item.base_revision_ref, "managed_site_task_admission_store_invalid");
    if (state.schema_version === legacyManagedSiteTaskAdmissionStoreSchemaVersion && baseRevisionRef === null) return fail("managed_site_task_admission_store_invalid");
    const receipt = {
      local_revision_ref: text(item.local_revision_ref, "managed_site_task_admission_store_invalid"),
      admission_ref: text(item.admission_ref, "managed_site_task_admission_store_invalid"),
      repository_ref: text(item.repository_ref, "managed_site_task_admission_store_invalid"),
      base_revision_ref: baseRevisionRef, pin,
      authoring_commit: text(item.authoring_commit, "managed_site_task_admission_store_invalid"), source_commit: text(item.source_commit, "managed_site_task_admission_store_invalid"),
      created_at: timestamp(item.created_at), revoked_at: parseTimestampOrNull(item.revoked_at),
      code_admission_ref: item.code_admission_ref === null ? null : text(item.code_admission_ref, "managed_site_task_admission_store_invalid"),
      code_admitted_at: parseTimestampOrNull(item.code_admitted_at), code_revoked_at: parseTimestampOrNull(item.code_revoked_at)
    };
    const base = runtime.approvedBasePackageFor(pin.package_ref);
    if (!localRevisionPattern.test(receipt.local_revision_ref) || !sourceAdmissionPattern.test(receipt.admission_ref) ||
        !repositories.some(repo => repo.repository_ref === receipt.repository_ref) ||
        (receipt.base_revision_ref !== null && (!base || base.revision_ref !== receipt.base_revision_ref || pin.task_ref !== base.task_ref)) ||
        receipt.pin.source_commit !== receipt.source_commit || sourceAdmissionRef(receipt) !== receipt.admission_ref ||
        receipt.code_admission_ref !== null && (!receipt.pin.script || runtime.scriptCodeAdmissionRef(receipt.pin) !== receipt.code_admission_ref)) return fail("managed_site_task_admission_store_invalid");
    return receipt;
  });
  if (new Set(repositories.map(item => item.repository_ref)).size !== repositories.length || new Set(candidates.map(item => item.candidate_ref)).size !== candidates.length ||
      new Set(receipts.map(item => item.admission_ref)).size !== receipts.length ||
      new Set(receipts.filter(item => item.base_revision_ref === null).map(item => item.pin.package_ref)).size !== receipts.filter(item => item.base_revision_ref === null).length) return fail("managed_site_task_admission_store_invalid");
  return { schema_version: managedSiteTaskAdmissionStoreSchemaVersion, repositories, candidates, receipts };
}

function emptyState(): State { return { schema_version: managedSiteTaskAdmissionStoreSchemaVersion, repositories: [], candidates: [], receipts: [] }; }

export function createFileManagedSiteTaskAdmissionStore(options: {
  directory: string;
  managedDataRoot?: string;
  managedMaterializationPaths?: readonly string[];
  clock?: () => Date;
  lockTimeoutMs?: number;
  runtime: SiteTaskAdmissionRuntime;
}) {
  const statePath = join(options.directory, "managed-site-task-admissions.json");
  const lockPath = join(options.directory, "managed-site-task-admissions.lock");
  const now = () => (options.clock?.() ?? new Date()).toISOString();
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000;

  async function readState(): Promise<State> {
    try { return parseState(JSON.parse(await readFile(statePath, "utf8")), options.runtime); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
  }
  async function writeState(state: State): Promise<void> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, statePath);
    } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async function transaction<T>(action: (state: State) => Promise<T> | T): Promise<T> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    return withFileOwnershipLock(lockPath, lockTimeoutMs, async () => {
      const state = await readState();
      const result = await action(state);
      await writeState(state);
      return result;
    });
  }
  function repository(state: State, value: unknown): StoredRepository {
    const ref = text(value);
    if (!repositoryRefPattern.test(ref)) return fail("managed_site_task_admission_invalid_input");
    const entry = state.repositories.find(item => item.repository_ref === ref);
    if (!entry) return fail("managed_site_task_authoring_repository_unavailable");
    return entry;
  }
  function candidate(state: State, value: unknown): StoredCandidate {
    const ref = text(value);
    if (!sourceCandidatePattern.test(ref)) return fail("managed_site_task_admission_invalid_input");
    const entry = state.candidates.find(item => item.candidate_ref === ref);
    if (!entry) return fail("managed_site_task_source_candidate_unavailable");
    return entry;
  }
  function receipt(state: State, value: unknown): StoredReceipt {
    const ref = text(value);
    if (!sourceAdmissionPattern.test(ref)) return fail("managed_site_task_admission_invalid_input");
    const entry = state.receipts.find(item => item.admission_ref === ref);
    if (!entry) return fail("managed_site_task_source_admission_unavailable");
    return entry;
  }
  function publicRepository(value: StoredRepository): Json { return { repository_ref: value.repository_ref, selected_at: value.selected_at }; }
  function publicCandidate(value: StoredCandidate): Json {
    return {
      candidate_ref: value.candidate_ref, repository_ref: value.repository_ref, base_revision_ref: value.base_revision_ref,
      package_ref: value.pin.package_ref, revision_ref: value.pin.revision_ref, package_digest: value.pin.package_digest,
      source_ref: value.pin.source_ref, source_commit: value.source_commit, authoring_commit: value.authoring_commit,
      task_ref: value.pin.task_ref, changed_paths: [...value.changed_paths], diff_sha256: value.diff_sha256,
      code_state: value.pin.script ? "not_admitted" : "not_applicable", inspected_at: value.inspected_at
    };
  }
  function publicReceipt(value: StoredReceipt): Json {
    return {
      local_revision_ref: value.local_revision_ref, admission_ref: value.admission_ref,
      base_revision_ref: value.base_revision_ref,
      package_ref: value.pin.package_ref, revision_ref: value.pin.revision_ref, package_digest: value.pin.package_digest,
      source_ref: value.pin.source_ref, source_commit: value.source_commit, authoring_commit: value.authoring_commit,
      task_ref: value.pin.task_ref, active: value.revoked_at === null, created_at: value.created_at, revoked_at: value.revoked_at,
      code_admission_ref: value.code_admission_ref, code_active: value.code_admission_ref !== null && value.code_revoked_at === null,
      code_admitted_at: value.code_admitted_at, code_revoked_at: value.code_revoked_at
    };
  }
  async function selectedRepositoryPath(repo: StoredRepository): Promise<string> {
    await assertNoSymlinkPath(repo.path);
    const root = await realpath(repo.path).catch(() => fail("managed_site_task_authoring_repository_unavailable"));
    if (root !== repo.path) return fail("managed_site_task_authoring_repository_invalid");
    await assertOutsideManagedRoots(root);
    await assertGitRepositoryBoundary(root);
    await assertNoRepositoryFilters(root);
    const status = (await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    if (status !== "") return fail("managed_site_task_authoring_repository_dirty");
    const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    if (!commitPattern.test(head)) return fail("managed_site_task_authoring_repository_invalid");
    return root;
  }
  async function canonicalPotentialPath(path: string): Promise<string> {
    const absolute = resolve(path);
    try { return await realpath(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return fail("managed_site_task_authoring_repository_unavailable");
      const parent = dirname(absolute);
      if (parent === absolute) return absolute;
      return join(await canonicalPotentialPath(parent), basename(absolute));
    }
  }
  async function assertOutsideManagedRoots(root: string): Promise<void> {
    const roots = [options.directory, options.managedDataRoot, ...(options.managedMaterializationPaths ?? [])].filter((value): value is string => Boolean(value));
    for (const protectedPath of roots) {
      const absolute = await canonicalPotentialPath(protectedPath);
      if (within(root, absolute) || within(absolute, root)) return fail("managed_site_task_authoring_repository_in_managed_root");
    }
  }
  async function assertGitRepositoryBoundary(root: string): Promise<void> {
    const dotGit = join(root, ".git");
    const dotGitInfo = await lstat(dotGit).catch(() => fail("managed_site_task_authoring_repository_invalid"));
    if (dotGitInfo.isSymbolicLink() || !dotGitInfo.isDirectory() && !dotGitInfo.isFile() || dotGitInfo.isFile() && dotGitInfo.size > 4096) return fail("managed_site_task_authoring_repository_invalid");
    const top = (await git(root, ["rev-parse", "--show-toplevel"], 2 * 1024 * 1024, false)).stdout.trim();
    if (!top || await realpath(top).catch(() => "") !== root) return fail("managed_site_task_authoring_repository_invalid");
    const gitDir = await realpath((await git(root, ["rev-parse", "--path-format=absolute", "--absolute-git-dir"], 2 * 1024 * 1024, false)).stdout.trim())
      .catch(() => fail("managed_site_task_authoring_repository_invalid"));
    const commonDir = await realpath((await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], 2 * 1024 * 1024, false)).stdout.trim())
      .catch(() => fail("managed_site_task_authoring_repository_invalid"));
    await assertNoSymlinkPath(gitDir);
    await assertNoSymlinkPath(commonDir);
    if (dotGitInfo.isDirectory()) {
      if (gitDir !== await realpath(dotGit) || commonDir !== gitDir) return fail("managed_site_task_authoring_repository_invalid");
    } else {
      const gitFile = (await readFile(dotGit, "utf8")).trim();
      const match = /^gitdir: (.+)$/.exec(gitFile);
      if (!match) return fail("managed_site_task_authoring_repository_invalid");
      const declaredGitDir = await realpath(resolve(root, match[1]!)).catch(() => fail("managed_site_task_authoring_repository_invalid"));
      if (declaredGitDir !== gitDir) return fail("managed_site_task_authoring_repository_invalid");
      const commonFile = join(gitDir, "commondir");
      const commonInfo = await lstat(commonFile).catch(() => fail("managed_site_task_authoring_repository_invalid"));
      if (!commonInfo.isFile() || commonInfo.isSymbolicLink() || commonInfo.size > 4096) return fail("managed_site_task_authoring_repository_invalid");
      const declaredCommonDir = await realpath(resolve(gitDir, (await readFile(commonFile, "utf8")).trim())).catch(() => fail("managed_site_task_authoring_repository_invalid"));
      const worktreeParent = join(commonDir, "worktrees");
      const worktreeId = relative(worktreeParent, gitDir);
      if (declaredCommonDir !== commonDir || !worktreeId || worktreeId === ".." || worktreeId.startsWith(`..${sep}`) || worktreeId.includes(sep)) return fail("managed_site_task_authoring_repository_invalid");
      const backlinkFile = join(gitDir, "gitdir");
      const backlinkInfo = await lstat(backlinkFile).catch(() => fail("managed_site_task_authoring_repository_invalid"));
      if (!backlinkInfo.isFile() || backlinkInfo.isSymbolicLink() || backlinkInfo.size > 4096) return fail("managed_site_task_authoring_repository_invalid");
      const backlink = await realpath(resolve(gitDir, (await readFile(backlinkFile, "utf8")).trim())).catch(() => fail("managed_site_task_authoring_repository_invalid"));
      if (backlink !== dotGit) return fail("managed_site_task_authoring_repository_invalid");
    }
    await assertOutsideManagedRoots(gitDir);
    await assertOutsideManagedRoots(commonDir);
  }
  async function assertNoRepositoryFilters(root: string): Promise<void> {
    const filters = await git(root, ["config", "--includes", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"]).catch(error => {
      if ((error as { code?: unknown }).code === 1) return { stdout: "", stderr: "" };
      throw error;
    });
    if (filters.stdout !== "") return fail("managed_site_task_authoring_repository_invalid");
  }
  async function head(root: string): Promise<string> { return (await git(root, ["rev-parse", "HEAD"])).stdout.trim(); }
  async function verifySourceTree(root: string, pin: ExtendedSiteSkillPackagePin, verified: Pick<VerifiedSiteTask, "files">): Promise<void> {
    const mergeBase = await git(root, ["merge-base", "--is-ancestor", pin.source_commit, await head(root)]).then(() => true).catch(error => {
      if ((error as { code?: unknown }).code === 1) return false;
      return false;
    });
    if (!mergeBase) return fail("managed_site_task_source_commit_unreachable");
    const manifest = readObject(await readRegular(root, `${pin.package_path}/manifest.json`, maxManifestBytes));
    const capabilityAssets = Array.isArray(manifest.assets) ? manifest.assets.filter(value => isObject(value) && value.role === "capability_declaration" && value.capability_ref === pin.capability_asset_ref) : [];
    if (capabilityAssets.length !== 1 || !isObject(capabilityAssets[0])) return fail("managed_site_task_source_corrupt");
    const capabilityPath = safeRelative(capabilityAssets[0].path);
    for (const file of verified.files) {
      const path = safeRelative(file.path);
      const gitPath = `${pin.package_path}/${path}`;
      const sourceBytes = Buffer.from((await git(root, ["show", `${pin.source_commit}:${gitPath}`], 2 * 1024 * 1024)).stdout);
      if (`sha256:${digest(sourceComparableBytes(path, sourceBytes, capabilityPath, pin))}` !== `sha256:${digest(sourceComparableBytes(path, file.bytes, capabilityPath, pin))}`) return fail("managed_site_task_source_tree_mismatch");
    }
  }
  async function inspectCandidateInternal(state: State, repositoryRef: unknown, packageRefValue: unknown, baseRevisionRefValue: unknown, taskRefValue: unknown): Promise<StoredCandidate> {
    const repo = repository(state, repositoryRef);
    const root = await selectedRepositoryPath(repo);
    await assertOutsideManagedRoots(root);
    const packageRef = text(packageRefValue);
    const taskRef = text(taskRefValue);
    if (!packageRefPattern.test(packageRef)) return fail("managed_site_task_admission_invalid_input");
    const base = options.runtime.approvedBasePackageFor(packageRef);
    const baseRevisionRef = nullableText(baseRevisionRefValue);
    if (base) {
      if (baseRevisionRef === null || base.revision_ref !== baseRevisionRef) return fail("managed_site_task_base_revision_unapproved");
    } else if (baseRevisionRef !== null) {
      return fail("managed_site_task_base_revision_unapproved");
    }
    const index = readObject(await readRegular(root, "registry/local-packages.json", maxIndexBytes));
    if (index.schema_version !== "lode.local-package-index.v0" || !Array.isArray(index.entries)) return fail("managed_site_task_source_corrupt");
    const matching = index.entries.filter(value => isObject(value) && value.package_ref === packageRef);
    if (matching.length !== 1 || !isObject(matching[0])) return fail("managed_site_task_source_corrupt");
    const packagePath = safeRelative(matching[0].package_path);
    if (base ? packagePath !== base.package_path : !packagePath.startsWith("sites/")) return fail("managed_site_task_source_corrupt");
    const manifestBytes = await readRegular(root, `${packagePath}/manifest.json`, maxManifestBytes);
    const pin = derivePin(packageRef, taskRef, index, manifestBytes);
    if (!base && state.receipts.some(item => item.pin.package_ref === packageRef &&
        (item.pin.revision_ref !== pin.revision_ref || item.pin.package_digest !== pin.package_digest || item.pin.task_ref !== pin.task_ref))) {
      return fail("managed_site_task_initial_admission_exists");
    }
    if (base && (pin.revision_ref === base.revision_ref || !versionGreater(pin.revision_ref.split("@").at(-1)?.split("#")[0], base.revision_ref.split("@").at(-1)?.split("#")[0]) ||
        pin.source_repository !== base.source_repository || pin.source_path !== base.source_path || pin.task_ref !== base.task_ref || pin.capability_asset_ref !== base.capability_asset_ref)) return fail("managed_site_task_source_not_derived_from_base");
    const verified = await options.runtime.verifyPackageRoot(root, pin);
    if (verified.package_ref !== packageRef || verified.revision_ref !== pin.revision_ref || verified.package_digest !== pin.package_digest || verified.source_ref !== pin.source_ref ||
        verified.source_commit !== pin.source_commit || verified.task_ref !== taskRef) return fail("managed_site_task_source_corrupt");
    await verifySourceTree(root, pin, verified);
    if (pin.script) {
      const scriptPath = join(root, pin.package_path, pin.script.path);
      const check = await execFileAsync(process.execPath, ["--check", scriptPath], { encoding: "utf8", maxBuffer: 256 * 1024 }).catch(() => fail("managed_site_task_script_syntax_invalid"));
      void check;
    }
    const authoringCommit = await head(root);
    const diffRange = await candidateDiffRange(root, baseRevisionRef, pin, authoringCommit, options.runtime);
    const changedOutput = await git(root, ["diff", "--name-only", "-z", diffRange.range, "--", diffRange.packagePath, "registry/local-packages.json"]);
    const changedPaths = changedOutput.stdout.split("\0").filter(Boolean).map(path => path.startsWith(`${diffRange.packagePath}/`) ? path.slice(diffRange.packagePath.length + 1) : path).sort();
    if (changedPaths.length === 0) return fail("managed_site_task_source_candidate_unchanged");
    const diff = await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", diffRange.range, "--", diffRange.packagePath, "registry/local-packages.json"], maxOwnerDiffBytes + 1);
    if (Buffer.byteLength(diff.stdout) > maxOwnerDiffBytes) return fail("managed_site_task_source_diff_too_large");
    const storedWithoutRef: Omit<StoredCandidate, "candidate_ref" | "inspected_at"> = {
      repository_ref: repo.repository_ref, base_revision_ref: baseRevisionRef, pin, authoring_commit: authoringCommit,
      source_commit: pin.source_commit, changed_paths: changedPaths, diff_sha256: `sha256:${digest(diff.stdout)}`
    };
    const candidate: StoredCandidate = { ...storedWithoutRef, candidate_ref: candidateRef(storedWithoutRef), inspected_at: now() };
    state.candidates = state.candidates.filter(item => item.candidate_ref !== candidate.candidate_ref);
    state.candidates.push(candidate);
    return candidate;
  }
  async function verifyReceiptCurrent(state: State, value: StoredReceipt): Promise<{ root: string; verified: Awaited<ReturnType<SiteTaskAdmissionRuntime["verifyPackageRoot"]>> }> {
    if (value.revoked_at !== null) return fail("managed_site_task_source_admission_revoked");
    const repo = repository(state, value.repository_ref);
    const root = await selectedRepositoryPath(repo);
    await assertOutsideManagedRoots(root);
    if (await head(root) !== value.authoring_commit) return fail("managed_site_task_authoring_revision_changed");
    const verified = await options.runtime.verifyPackageRoot(root, value.pin);
    if (verified.package_ref !== value.pin.package_ref || verified.revision_ref !== value.pin.revision_ref || verified.package_digest !== value.pin.package_digest ||
        verified.source_ref !== value.pin.source_ref || verified.source_commit !== value.source_commit || verified.task_ref !== value.pin.task_ref) return fail("managed_site_task_source_corrupt");
    await verifySourceTree(root, value.pin, verified);
    return { root, verified };
  }

  return {
    async selectAuthoringRepository(value: unknown): Promise<Json> {
      const input = exactObject(value, ["path"]);
      const path = text(input.path);
      if (!isAbsolute(path)) return fail("managed_site_task_admission_invalid_input");
      await assertNoSymlinkPath(path);
      const root = await realpath(path).catch(() => fail("managed_site_task_authoring_repository_unavailable"));
      if (root !== resolve(path)) return fail("managed_site_task_authoring_repository_invalid");
      await assertOutsideManagedRoots(root);
      await assertGitRepositoryBoundary(root);
      await assertNoRepositoryFilters(root);
      if ((await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout !== "") return fail("managed_site_task_authoring_repository_dirty");
      const repositoryRef = `webenvoy:site-task-authoring-repository/${randomUUID()}`;
      return transaction(state => {
        state.repositories.push({ repository_ref: repositoryRef, path: root, selected_at: now() });
        return publicRepository(state.repositories.at(-1)!);
      });
    },
    async listAuthoringRepositories(): Promise<Json[]> { return (await readState()).repositories.map(publicRepository); },
    async inspectCandidate(value: unknown): Promise<Json> {
      const input = exactObject(value, ["repository_ref", "package_ref", "base_revision_ref", "task_ref"]);
      return transaction(async state => publicCandidate(await inspectCandidateInternal(state, input.repository_ref, input.package_ref, input.base_revision_ref, input.task_ref)));
    },
    async candidateDiff(value: unknown): Promise<Json> {
      const input = exactObject(value, ["candidate_ref"]);
      const state = await readState();
      const found = candidate(state, input.candidate_ref);
      const repo = repository(state, found.repository_ref);
      const root = await selectedRepositoryPath(repo);
      await assertOutsideManagedRoots(root);
      if (await head(root) !== found.authoring_commit) return fail("managed_site_task_authoring_revision_changed");
      const diffRange = await candidateDiffRange(root, found.base_revision_ref, found.pin, found.authoring_commit, options.runtime);
      const diff = (await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", diffRange.range, "--", diffRange.packagePath, "registry/local-packages.json"], maxOwnerDiffBytes + 1)).stdout;
      if (Buffer.byteLength(diff) > maxOwnerDiffBytes || `sha256:${digest(diff)}` !== found.diff_sha256) return fail("managed_site_task_source_candidate_changed");
      return { candidate_ref: found.candidate_ref, authoring_commit: found.authoring_commit, base_revision_ref: found.base_revision_ref, diff };
    },
    async admitSource(value: unknown): Promise<Json> {
      const input = exactObject(value, ["candidate_ref"]);
      return transaction(async state => {
        const found = candidate(state, input.candidate_ref);
        const freshlyInspected = await inspectCandidateInternal(state, found.repository_ref, found.pin.package_ref, found.base_revision_ref, found.pin.task_ref);
        if (freshlyInspected.authoring_commit !== found.authoring_commit || freshlyInspected.pin.revision_ref !== found.pin.revision_ref ||
            freshlyInspected.pin.package_digest !== found.pin.package_digest || freshlyInspected.diff_sha256 !== found.diff_sha256 || freshlyInspected.changed_paths.join("\0") !== found.changed_paths.join("\0")) return fail("managed_site_task_source_candidate_changed");
        const prior = state.receipts.find(item => item.repository_ref === found.repository_ref && item.authoring_commit === found.authoring_commit &&
          item.pin.package_ref === found.pin.package_ref && item.pin.revision_ref === found.pin.revision_ref && item.pin.package_digest === found.pin.package_digest && item.revoked_at === null);
        if (prior) return publicReceipt(prior);
        const receiptValue = {
          local_revision_ref: localRevisionRef(found), admission_ref: "",
          repository_ref: found.repository_ref, base_revision_ref: found.base_revision_ref, pin: structuredClone(found.pin),
          authoring_commit: found.authoring_commit, source_commit: found.source_commit,
          created_at: now(), revoked_at: null, code_admission_ref: null, code_admitted_at: null, code_revoked_at: null
        } as StoredReceipt;
        receiptValue.admission_ref = sourceAdmissionRef(receiptValue);
        state.receipts.push(receiptValue);
        return publicReceipt(receiptValue);
      });
    },
    async admitCode(value: unknown): Promise<Json> {
      const input = exactObject(value, ["admission_ref"]);
      return transaction(async state => {
        const found = receipt(state, input.admission_ref);
        if (found.revoked_at !== null) return fail("managed_site_task_source_admission_revoked");
        if (!found.pin.script) return fail("managed_site_task_code_not_required");
        await verifyReceiptCurrent(state, found);
        const codeRef = options.runtime.scriptCodeAdmissionRef(found.pin);
        if (found.code_admission_ref && found.code_admission_ref !== codeRef) return fail("managed_site_task_code_admission_conflict");
        if (found.code_revoked_at !== null) return fail("managed_site_task_code_admission_revoked");
        if (!found.code_admission_ref) { found.code_admission_ref = codeRef; found.code_admitted_at = now(); }
        return publicReceipt(found);
      });
    },
    async revokeCode(value: unknown): Promise<Json> {
      const input = exactObject(value, ["admission_ref"]);
      return transaction(state => {
        const found = receipt(state, input.admission_ref);
        if (!found.code_admission_ref || found.code_revoked_at !== null) return fail("managed_site_task_code_admission_unavailable");
        found.code_revoked_at = now();
        return publicReceipt(found);
      });
    },
    async revokeSource(value: unknown): Promise<Json> {
      const input = exactObject(value, ["admission_ref"]);
      return transaction(state => {
        const found = receipt(state, input.admission_ref);
        if (found.revoked_at !== null) return fail("managed_site_task_source_admission_revoked");
        found.revoked_at = now();
        if (found.code_admission_ref && found.code_revoked_at === null) found.code_revoked_at = found.revoked_at;
        return publicReceipt(found);
      });
    },
    async listAdmissions(packageRefValue?: string): Promise<Json[]> {
      const packageRef = packageRefValue === undefined ? undefined : text(packageRefValue);
      return (await readState()).receipts.filter(item => packageRef === undefined || item.pin.package_ref === packageRef).map(publicReceipt);
    },
    async resolveAdmitted(requestValue: ManagedSiteTaskPackageRequest): Promise<OwnerAdmittedSiteTaskPin | undefined> {
      const request = exactObject(requestValue, ["package_ref", "revision_ref", "package_digest", "task_ref"]);
      const state = await readState();
      const found = state.receipts.find(item => item.revoked_at === null && item.pin.package_ref === request.package_ref && item.pin.revision_ref === request.revision_ref &&
        item.pin.package_digest === request.package_digest && item.pin.task_ref === request.task_ref);
      if (!found) return undefined;
      const { root } = await verifyReceiptCurrent(state, found);
      const codeAdmissionRef = found.code_admission_ref && found.code_revoked_at === null ? found.code_admission_ref : undefined;
      return {
        pin: structuredClone(found.pin), lodeAssetsPath: root, admission_ref: found.admission_ref,
        source_ref: found.pin.source_ref, source_commit: found.source_commit, task_ref: found.pin.task_ref,
        ...(codeAdmissionRef === undefined ? {} : { code_admission_ref: codeAdmissionRef })
      };
    },
    async listAdmitted(packageRefValue?: string): Promise<readonly OwnerAdmittedSiteTaskPin[]> {
      const packageRef = packageRefValue === undefined ? undefined : text(packageRefValue);
      const state = await readState();
      const results: OwnerAdmittedSiteTaskPin[] = [];
      for (const found of state.receipts) {
        if (found.revoked_at !== null || packageRef !== undefined && found.pin.package_ref !== packageRef) continue;
        try {
          const { root } = await verifyReceiptCurrent(state, found);
          results.push({ pin: structuredClone(found.pin), lodeAssetsPath: root, admission_ref: found.admission_ref,
            source_ref: found.pin.source_ref, source_commit: found.source_commit, task_ref: found.pin.task_ref,
            ...(found.code_admission_ref && found.code_revoked_at === null ? { code_admission_ref: found.code_admission_ref } : {}) });
        } catch { /* A missing, moved, dirty, or changed owner source is not currently admitted for consumption. */ }
      }
      return results;
    }
  };
}

export type FileManagedSiteTaskAdmissionStore = ReturnType<typeof createFileManagedSiteTaskAdmissionStore>;
