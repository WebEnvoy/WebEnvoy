import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ManagedAccessError } from "./managed-access.js";

type JsonObject = Record<string, unknown>;

/** The first Core-admitted fixed site package. */
export const approvedManagedSiteTaskPackage = {
  package_ref: "lode://site-skill/controlled-local/page-summary",
  package_path: "sites/controlled-local/page-summary",
  task_ref: "read-page-summary",
  revision_ref: "lode://site-skill/controlled-local/page-summary@1.0.0#48ba83eff3d8321eae1699155e6be5a64b8efc5d",
  package_digest: "sha256:b5454650c8d143de8cd87392fd2a91f55225b0862224e681754ed1a41279acd8"
} as const;
export const approvedManagedSiteTaskSourceRef = "lode://source/site-skill/controlled-local/page-summary@1.0.0#48ba83eff3d8321eae1699155e6be5a64b8efc5d" as const;
export const approvedManagedSiteTaskCapabilityRef = "lode:capability/managed-page-snapshot" as const;
export const approvedManagedSiteTaskCapabilityVersion = "1.0.0" as const;
export const approvedManagedSiteTaskLockRef = "lode://lock/site-skill/controlled-local/page-summary@1.0.0" as const;
// Raw-byte pin also rejects duplicate JSON keys, which JSON.parse would erase
// before the canonical package digest is calculated.
export const approvedManagedSiteTaskManifestSha256 = "4bfddd6ba7b38844f9d31c61737783dc41bb17efdf205c78aa9766e3599ba063" as const;

export type SiteSkillPackagePin = {
  package_ref: string;
  package_path: string;
  task_ref: string;
  revision_ref: string;
  package_digest: string;
};

export type VerifiedSiteTask = {
  package_ref: string;
  revision_ref: string;
  version: string;
  package_digest: string;
  source_ref: string;
  lock_ref: string;
  source_commit: string;
  task_ref: string;
  capability: {
    capability_ref: string;
    capability_id: string;
    version: string;
    source_ref: string;
    lock_ref: string;
    operation_id: string;
    action: string;
  };
  task: JsonObject;
  input_schema: JsonObject;
  output_schema: JsonObject;
  post_check: JsonObject;
  manifest_bytes: Buffer;
  skill_text: Buffer;
  files: Array<{ path: string; bytes: Buffer; sha256: string }>;
};

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const maxRegistryBytes = 1024 * 1024;
const maxManifestBytes = 1024 * 1024;
const maxPackageBytes = 4 * 1024 * 1024;
const maxFileBytes = 1024 * 1024;

function fail(code: string): never { throw new ManagedAccessError(code); }
function object(value: unknown, code = "managed_skill_source_corrupt"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(code);
  return value as JsonObject;
}
function exactObject(value: unknown, required: string[], optional: string[] = []): JsonObject {
  const parsed = object(value);
  if (required.some(key => !Object.hasOwn(parsed, key)) || Object.keys(parsed).some(key => !required.includes(key) && !optional.includes(key))) return fail("managed_skill_source_corrupt");
  return parsed;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail("managed_skill_source_corrupt");
  return value;
}
function safeRelative(value: unknown): string {
  const path = string(value);
  if (path.startsWith("/") || path.includes("\\") || path === "." || path.split("/").some(part => part === "" || part === "." || part === "..")) return fail("managed_skill_source_corrupt");
  return path;
}
function sha256Ref(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) return fail("managed_skill_source_corrupt");
  return value;
}
function noFloats(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(noFloats);
  if (value && typeof value === "object") return Object.values(value as JsonObject).every(noFloats);
  return true;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as JsonObject;
    return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function readRegular(root: string, relPath: string, maxBytes: number): Promise<Buffer> {
  const rootInfo = await lstat(root).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
  if (!rootInfo) return fail("managed_skill_source_missing");
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return fail("managed_skill_source_corrupt");
  const absolute = resolve(root, relPath);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel === "..") return fail("managed_skill_source_corrupt");
  let parent = root;
  for (const part of rel.split(/[\\/]/)) {
    parent = join(parent, part);
    let info;
    try { info = await lstat(parent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("managed_skill_source_missing"); throw error; }
    if (info.isSymbolicLink()) return fail("managed_skill_source_corrupt");
    if (parent !== absolute && !info.isDirectory()) return fail("managed_skill_source_corrupt");
    if (parent === absolute && (!info.isFile() || info.size > maxBytes)) return fail("managed_skill_source_corrupt");
  }
  const data = await readFile(absolute);
  if (data.byteLength > maxBytes) return fail("managed_skill_source_corrupt");
  return data;
}
async function packageFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("managed_skill_source_missing"); throw error; }
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) return fail("managed_skill_source_corrupt");
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) {
        if (info.size > maxFileBytes) return fail("managed_skill_source_corrupt");
        const path = relative(root, absolute).split("\\").join("/");
        if (path !== "manifest.json") files.push(path);
      } else return fail("managed_skill_source_corrupt");
    }
  }
  await visit(root);
  return files.sort();
}
function parseJson(bytes: Buffer): JsonObject {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return object(value);
  } catch (error) {
    if (error instanceof ManagedAccessError) throw error;
    return fail("managed_skill_source_corrupt");
  }
}

/** Verify an exact site-skill v1 package, including all files and package digest. */
export async function verifySiteSkillPackageRoot(lodeAssetsPath: string, pin: SiteSkillPackagePin): Promise<VerifiedSiteTask> {
  if (!/^lode:\/\/site-skill\/[A-Za-z0-9._/-]+$/.test(pin.package_ref) ||
      !/^lode:\/\/site-skill\/.+@[0-9]+\.[0-9]+\.[0-9]+#[a-f0-9]{40}$/.test(pin.revision_ref) ||
      !/^sha256:[a-f0-9]{64}$/.test(pin.package_digest)) return fail("managed_skill_revision_unavailable");
  const root = resolve(lodeAssetsPath);
  const registryBytes = await readRegular(root, "registry/local-packages.json", maxRegistryBytes);
  const registry = parseJson(registryBytes);
  if (registry.schema_version !== "lode.local-package-index.v0" || !Array.isArray(registry.entries)) return fail("managed_skill_source_corrupt");
  const matches = registry.entries.filter(value => object(value).package_ref === pin.package_ref);
  if (matches.length !== 1) return fail("managed_skill_revision_unavailable");
  const entry = object(matches[0]);
  const packagePath = safeRelative(entry.package_path);
  const manifestPath = safeRelative(entry.manifest_path);
  if (entry.package_type !== "site-skill" || packagePath !== pin.package_path || manifestPath !== `${packagePath}/manifest.json` ||
      entry.revision_ref !== pin.revision_ref || entry.package_digest !== pin.package_digest ||
      !Array.isArray(entry.task_refs) || !entry.task_refs.includes(pin.task_ref)) return fail("managed_skill_source_corrupt");
  const manifestBytes = await readRegular(root, manifestPath, maxManifestBytes);
  if (digest(manifestBytes) !== approvedManagedSiteTaskManifestSha256) return fail("managed_skill_source_corrupt");
  const manifest = parseJson(manifestBytes);
  const source = object(manifest.source), lockLocator = object(manifest.package_lock), integrity = object(manifest.integrity);
  if (manifest.manifest_version !== "lode.site-skill-package.manifest.v1" || manifest.package_type !== "site-skill" ||
      manifest.package_ref !== pin.package_ref || manifest.revision_ref !== pin.revision_ref ||
      source.package_path !== packagePath || typeof source.commit !== "string" || !/^[a-f0-9]{40}$/.test(source.commit) ||
      source.source_ref !== approvedManagedSiteTaskSourceRef || typeof manifest.version !== "string" ||
      lockLocator.path !== "package-lock.json" || typeof lockLocator.lock_ref !== "string") return fail("managed_skill_source_corrupt");
  if (pin.revision_ref !== `${pin.package_ref}@${manifest.version}#${source.commit}`) return fail("managed_skill_source_corrupt");
  const lockPath = safeRelative(lockLocator.path);
  const declared = integrity.files;
  if (!Array.isArray(declared) || declared.length === 0 || integrity.package_digest !== pin.package_digest) return fail("managed_skill_source_corrupt");
  const records: Array<{ path: string; role: string; bytes: number; sha256: string }> = [];
  for (const raw of declared) {
    const record = exactObject(raw, ["path", "role", "bytes", "sha256"]);
    const path = safeRelative(record.path), role = string(record.role), bytes = record.bytes;
    if (!Number.isSafeInteger(bytes) || Number(bytes) < 0 || Number(bytes) > maxFileBytes) return fail("managed_skill_source_corrupt");
    records.push({ path, role, bytes: Number(bytes), sha256: sha256Ref(record.sha256) });
  }
  if (records.some((item, index) => item.path === "manifest.json" || index > 0 && records[index - 1]!.path >= item.path)) return fail("managed_skill_source_corrupt");
  const packageRoot = resolve(root, packagePath);
  const actualFiles = await packageFiles(packageRoot);
  if (actualFiles.length !== records.length || actualFiles.some((path, index) => path !== records[index]!.path)) return fail("managed_skill_source_corrupt");
  let packageByteCount = manifestBytes.byteLength;
  const files: VerifiedSiteTask["files"] = [];
  for (const record of records) {
    const bytes = await readRegular(packageRoot, record.path, maxFileBytes);
    const actualDigest = `sha256:${digest(bytes)}`;
    if (bytes.byteLength !== record.bytes || actualDigest !== record.sha256) return fail("managed_skill_source_corrupt");
    packageByteCount += bytes.byteLength;
    if (packageByteCount > maxPackageBytes) return fail("managed_skill_source_corrupt");
    files.push({ path: record.path, bytes, sha256: actualDigest });
  }
  const canonicalManifest = structuredClone(manifest) as JsonObject;
  const canonicalIntegrity = object(canonicalManifest.integrity);
  delete canonicalIntegrity.package_digest;
  if (!noFloats(canonicalManifest)) return fail("managed_skill_source_corrupt");
  const tuples = records.map(item => `${item.path}\t${item.bytes}\t${item.sha256}\n`).join("");
  const actualPackageDigest = `sha256:${digest(`lode.site-skill-package/v1\n${canonicalJson(canonicalManifest)}\n${tuples}`)}`;
  if (actualPackageDigest !== pin.package_digest) return fail("managed_skill_source_corrupt");

  const lock = parseJson(await readRegular(packageRoot, lockPath, maxFileBytes));
  if (lock.schema_version !== "lode.site-skill-package.lock.v1" || lock.lock_ref !== lockLocator.lock_ref || lock.package_ref !== pin.package_ref ||
      lock.revision_ref !== pin.revision_ref || lock.version !== manifest.version || lock.source_ref !== source.source_ref) return fail("managed_skill_source_corrupt");
  const capabilityAssets = Array.isArray(manifest.assets) ? manifest.assets.map(value => object(value)).filter(asset => asset.role === "capability_declaration") : [];
  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks.map(value => object(value)) : [];
  const taskLocators = tasks.filter(task => task.task_ref === pin.task_ref);
  if (capabilityAssets.length !== 1 || taskLocators.length !== 1) return fail("managed_skill_source_corrupt");
  const capabilityLocator = capabilityAssets[0]!;
  const capabilityRef = string(capabilityLocator.capability_ref);
  const capabilityFile = files.find(item => item.path === safeRelative(capabilityLocator.path));
  const taskLocator = taskLocators[0]!;
  const taskFile = files.find(item => item.path === safeRelative(taskLocator.path));
  if (!capabilityFile || !taskFile) return fail("managed_skill_source_corrupt");
  const capability = parseJson(capabilityFile.bytes);
  if (capability.capability_ref !== capabilityRef || capability.capability_id !== "managed-page-snapshot" || capability.version !== "1.0.0" ||
      capability.source_ref !== source.source_ref || capability.lock_ref !== lockLocator.lock_ref || capability.operation_id !== "instance.snapshot" || capability.action !== "read" ||
      lock.capability_ref !== capabilityRef || !Array.isArray(object(manifest.compatibility).required_capabilities) ||
      canonicalJson(object(manifest.compatibility).required_capabilities) !== canonicalJson([{ ref: capabilityRef, version: "1.0.0" }])) return fail("managed_skill_source_corrupt");
  const task = parseJson(taskFile.bytes);
  if (task.task_ref !== pin.task_ref || task.operation_id !== capability.operation_id || task.action !== capability.action ||
      object(task.entrypoint).kind !== "capability_refs" || canonicalJson(object(task.entrypoint).capability_refs) !== canonicalJson([capabilityRef])) return fail("managed_skill_source_corrupt");
  const inputRef = string(object(task.inputs).schema_ref), outputRef = string(object(task.outputs).schema_ref);
  const verification = object(task.verification), checkRef = string(verification.post_check_ref);
  const asset = (role: string, field: string, ref: string) => {
    const matches = Array.isArray(manifest.assets) ? manifest.assets.map(value => object(value)).filter(item => item.role === role && item[field] === ref) : [];
    if (matches.length !== 1) return fail("managed_skill_source_corrupt");
    const bytes = files.find(item => item.path === safeRelative(matches[0]!.path))?.bytes;
    if (!bytes) return fail("managed_skill_source_corrupt");
    return parseJson(bytes);
  };
  const inputSchema = asset("input_schema", "schema_ref", inputRef);
  const outputSchema = asset("output_schema", "schema_ref", outputRef);
  const postCheck = asset("post_check", "check_ref", checkRef);
  const skillFile = files.find(item => item.path === "SKILL.md");
  if (!skillFile || inputSchema.$id !== inputRef || outputSchema.$id !== outputRef || postCheck.check_ref !== checkRef ||
      postCheck.schema_version !== "lode.post-check.v0") return fail("managed_skill_source_corrupt");
  return {
    package_ref: pin.package_ref, revision_ref: pin.revision_ref, version: String(manifest.version), package_digest: pin.package_digest,
    source_ref: String(source.source_ref), lock_ref: String(lockLocator.lock_ref), source_commit: String(source.commit), task_ref: pin.task_ref,
    capability: { capability_ref: capabilityRef, capability_id: String(capability.capability_id), version: String(capability.version), source_ref: String(capability.source_ref), lock_ref: String(capability.lock_ref), operation_id: String(capability.operation_id), action: String(capability.action) },
    task, input_schema: inputSchema, output_schema: outputSchema, post_check: postCheck, manifest_bytes: manifestBytes, skill_text: skillFile.bytes, files
  };
}

export async function resolveApprovedSiteTaskPackage(lodeAssetsPath: string | undefined): Promise<VerifiedSiteTask> {
  const root = lodeAssetsPath ?? process.env.WEBENVOY_LODE_ASSETS_PATH;
  if (!root) return fail("managed_skill_source_missing");
  return verifySiteSkillPackageRoot(root, approvedManagedSiteTaskPackage);
}
