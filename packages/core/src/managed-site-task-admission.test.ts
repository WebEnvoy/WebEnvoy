import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileManagedSiteTaskAdmissionStore, type ExtendedSiteSkillPackagePin, type SiteTaskAdmissionRuntime } from "./managed-site-task-admission.js";
import { managedSiteScriptCodeAdmissionRef, verifySiteSkillPackageRoot } from "./site-skill-package.js";

type Json = Record<string, any>;
const execFileAsync = promisify(execFile);
const packageRef = "lode://site-skill/github/trending";
const taskRef = "read-daily-trending-top5";
const packagePath = "sites/github/trending";
const sha256 = (value: Uint8Array | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Json)[key])}`).join(",")}}`
    : JSON.stringify(value);

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  return String(result.stdout).trim();
}
async function commit(root: string, message: string): Promise<string> {
  await git(root, "add", "-A");
  await git(root, "commit", "-m", message, "--quiet");
  return git(root, "rev-parse", "HEAD");
}
async function writeJson(path: string, value: unknown): Promise<void> { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }

test("owner source/code admission pins a clean Git candidate, preserves lifecycle separation, and revokes without replay", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "webenvoy-site-task-admission-test-")));
  const root = join(directory, "private-lode-worktree");
  try {
    await mkdir(join(root, packagePath, "scripts"), { recursive: true });
    await mkdir(join(root, packagePath, "capabilities"), { recursive: true });
    await mkdir(join(root, "registry"), { recursive: true });
    await git(root, "init", "--quiet");
    await git(root, "config", "user.name", "Site Admission Test");
    await git(root, "config", "user.email", "site-admission@example.invalid");

    const scriptPath = join(root, packagePath, "scripts/read-daily-trending-top5.mjs");
    const skillPath = join(root, packagePath, "SKILL.md");
    const lockPath = join(root, packagePath, "package-lock.json");
    const capabilityPath = join(root, packagePath, "capabilities/managed-page-snapshot.json");
    await writeFile(join(root, ".gitattributes"), `${packagePath}/SKILL.md diff=hostile\n`);
    const capabilityRef = "lode://site-capability/github/managed-page-snapshot@1.0.0";
    const capabilitySha = sha256("capability");
    const baseCode = "export function run() { return 'Built by'; }\n";
    await writeFile(scriptPath, baseCode);
    await writeFile(skillPath, "# Public site task\nRead the current page safely.\n");
    const oldGeneratedCommit = "0".repeat(40);
    await writeJson(lockPath, {
      schema_version: "lode.site-skill-package.lock.v1", lock_ref: "lode://lock/site-skill/github/trending@1.0.0",
      package_ref: packageRef, revision_ref: `${packageRef}@1.0.0#${oldGeneratedCommit}`, version: "1.0.0",
      source_ref: `lode://source/site-skill/github/trending@1.0.0#${oldGeneratedCommit}`, capability_ref: capabilityRef
    });
    await writeJson(capabilityPath, {
      capability_ref: capabilityRef, capability_id: "managed-page-snapshot", version: "1.0.0",
      source_ref: `lode://source/site-skill/github/trending@1.0.0#${oldGeneratedCommit}`, lock_ref: "lode://lock/site-skill/github/trending@1.0.0",
      operation_id: "instance.snapshot", action: "read"
    });
    const firstCommit = await commit(root, "base site package source");
    const basePin: ExtendedSiteSkillPackagePin = {
      package_ref: packageRef, package_path: packagePath, task_ref: taskRef,
      revision_ref: `${packageRef}@1.0.0#${firstCommit}`, package_digest: sha256("base-package"),
      manifest_sha256: createHash("sha256").update("base-manifest").digest("hex"), source_repository: "WebEnvoy/Lode", source_path: packagePath,
      source_commit: firstCommit, source_ref: `lode://source/site-skill/github/trending@1.0.0#${firstCommit}`,
      lock_ref: "lode://lock/site-skill/github/trending@1.0.0", capability_asset_ref: capabilityRef,
      script: {
        script_ref: "lode://script/site-skill/github/trending/read-daily-top5@1.0.0",
        path: "scripts/read-daily-trending-top5.mjs", version: "1.0.0", sha256: sha256(baseCode),
        runtime_kind: "webenvoy.site-skill-script-abi/v1", entrypoint: "run", broker: "webenvoy.site-skill-broker/v1",
        broker_capabilities: ["runtime.invoke", "output.write"]
      }
    };

    const repairedScript = "export function run() { return 'Built by or Contributors'; }\n";
    await writeFile(scriptPath, repairedScript);
    await writeFile(skillPath, "# Public site task\nRead the current page safely.\nSupport the known row metadata labels.\n");
    const packageLock = {
      schema_version: "lode.site-skill-package.lock.v1", lock_ref: "lode://lock/site-skill/github/trending@1.0.1",
      package_ref: packageRef, revision_ref: `${packageRef}@1.0.1#${oldGeneratedCommit}`, version: "1.0.1",
      source_ref: `lode://source/site-skill/github/trending@1.0.1#${oldGeneratedCommit}`, capability_ref: capabilityRef
    };
    await writeJson(lockPath, packageLock);
    await writeJson(capabilityPath, {
      capability_ref: capabilityRef, capability_id: "managed-page-snapshot", version: "1.0.0",
      source_ref: packageLock.source_ref, lock_ref: packageLock.lock_ref, operation_id: "instance.snapshot", action: "read"
    });
    const sourceCommit = await commit(root, "repair supported metadata labels");
    packageLock.revision_ref = `${packageRef}@1.0.1#${sourceCommit}`;
    packageLock.source_ref = `lode://source/site-skill/github/trending@1.0.1#${sourceCommit}`;
    await writeJson(lockPath, packageLock);
    await writeJson(capabilityPath, {
      capability_ref: capabilityRef, capability_id: "managed-page-snapshot", version: "1.0.0",
      source_ref: packageLock.source_ref, lock_ref: packageLock.lock_ref, operation_id: "instance.snapshot", action: "read"
    });
    const lockBytes = Buffer.from(`${JSON.stringify(packageLock, null, 2)}\n`);
    const capabilityBytes = Buffer.from(await readFile(capabilityPath));
    const scriptBytes = Buffer.from(repairedScript), skillBytes = Buffer.from(await import("node:fs/promises").then(fs => fs.readFile(skillPath)));
    const packageDigest = sha256("fixed-derived-package-digest");
    const manifest: Json = {
      manifest_version: "lode.site-skill-package.manifest.v1", package_type: "site-skill", package_ref: packageRef,
      revision_ref: `${packageRef}@1.0.1#${sourceCommit}`, version: "1.0.1",
      source: { repository: "WebEnvoy/Lode", package_path: packagePath, commit: sourceCommit, source_ref: packageLock.source_ref },
      package_lock: { path: "package-lock.json", lock_ref: packageLock.lock_ref },
      integrity: {
        files: [
          { path: "SKILL.md", role: "entrypoint", bytes: skillBytes.length, sha256: sha256(skillBytes) },
          { path: "capabilities/managed-page-snapshot.json", role: "capability_declaration", bytes: capabilityBytes.length, sha256: sha256(capabilityBytes) },
          { path: "package-lock.json", role: "package_lock", bytes: lockBytes.length, sha256: sha256(lockBytes) },
          { path: "scripts/read-daily-trending-top5.mjs", role: "script_source", bytes: scriptBytes.length, sha256: sha256(scriptBytes) }
        ], package_digest: packageDigest
      },
      assets: [{ role: "capability_declaration", path: "capabilities/managed-page-snapshot.json", capability_ref: capabilityRef }],
      scripts: [{
        script_ref: "lode://script/site-skill/github/trending/read-daily-top5@1.0.1", path: "scripts/read-daily-trending-top5.mjs",
        source_commit: sourceCommit, version: "1.0.1", sha256: sha256(scriptBytes), runtime_kind: "webenvoy.site-skill-script-abi/v1",
        entrypoint: "run", input_schema_ref: "lode://schema/site-skill/github/trending/input@1.0.1", output_schema_ref: "lode://schema/site-skill/github/trending/output@1.0.1",
        capability_refs: [capabilityRef], action: "read", broker: "webenvoy.site-skill-broker/v1", broker_capabilities: ["runtime.invoke", "output.write"],
        target_binding: { target_type: "web_page", requires_current_page: true, requires_fresh_observation: true }, timeout_ms: 10000,
        cancel: "cooperative", data_handling: { input_sensitivity: "public", output_sensitivity: "public", external_egress: "none" }
      }],
      tasks: [{ task_ref: taskRef, path: "tasks/read-daily-trending-top5.json" }]
    };
    await writeJson(join(root, packagePath, "manifest.json"), manifest);
    await writeJson(join(root, "registry/local-packages.json"), {
      schema_version: "lode.local-package-index.v0",
      entries: [{ package_ref: packageRef, package_type: "site-skill", package_path: packagePath, manifest_path: `${packagePath}/manifest.json`,
        revision_ref: manifest.revision_ref, package_digest: packageDigest, task_refs: [taskRef] }]
    });
    const authoringCommit = await commit(root, "fix derived package pins");

    const runtime: SiteTaskAdmissionRuntime = {
      approvedBasePackageFor(value) { return value === packageRef ? basePin : undefined; },
      async verifyPackageRoot(lodeAssetsPath, pin) {
        assert.equal(lodeAssetsPath, root);
        const files = await Promise.all([
          "SKILL.md", "capabilities/managed-page-snapshot.json", "package-lock.json", "scripts/read-daily-trending-top5.mjs"
        ].map(async path => { const bytes = await readFile(join(root, packagePath, path)); return { path, bytes, sha256: sha256(bytes) }; }));
        return {
          package_ref: pin.package_ref, revision_ref: pin.revision_ref, package_digest: pin.package_digest,
          source_ref: pin.source_ref, source_commit: pin.source_commit, task_ref: pin.task_ref,
          files
        };
      },
      scriptCodeAdmissionRef(pin) {
        assert(pin.script);
        const fields = { package_ref: pin.package_ref, revision_ref: pin.revision_ref, package_digest: pin.package_digest, script_ref: pin.script.script_ref, script_sha256: pin.script.sha256 };
        return `webenvoy.code-admission/site-skill-script/v1#sha256:${createHash("sha256").update(canonical(fields)).digest("hex")}`;
      }
    };
    const store = createFileManagedSiteTaskAdmissionStore({ directory: join(directory, "owner-state"), managedDataRoot: join(directory, "managed"), runtime });
    const selected = await store.selectAuthoringRepository({ path: root }) as Json;
    assert.equal(Object.hasOwn(selected, "path"), false, "owner repository path never leaves Core state");
    await assert.rejects(store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: packageRef, base_revision_ref: null, task_ref: taskRef }),
      /managed_site_task_base_revision_unapproved/, "first admission cannot bypass the existing base check for a statically approved package");
    const inspected = await store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: packageRef, base_revision_ref: basePin.revision_ref, task_ref: taskRef }) as Json;
    assert.equal(inspected.authoring_commit, authoringCommit);
    assert.equal(inspected.source_commit, sourceCommit);
    assert.deepEqual(inspected.changed_paths, ["SKILL.md", "capabilities/managed-page-snapshot.json", "manifest.json", "package-lock.json", "registry/local-packages.json", "scripts/read-daily-trending-top5.mjs"]);
    const diffMarker = join(directory, "external-diff-ran");
    const externalDiff = join(directory, "external-diff.sh");
    await writeFile(externalDiff, `#!/bin/sh\nprintf 'ran' > '${diffMarker}'\nexit 0\n`);
    await chmod(externalDiff, 0o700);
    await git(root, "config", "diff.external", externalDiff);
    await git(root, "config", "diff.hostile.textconv", externalDiff);
    await git(root, "config", "core.pager", externalDiff);
    const diff = await store.candidateDiff({ candidate_ref: inspected.candidate_ref }) as Json;
    await assert.rejects(access(diffMarker), { code: "ENOENT" }, "external diff, textconv, and pager programs are never executed by Core");
    assert.match(diff.diff, /Contributors/);
    assert.match(diff.diff, /registry\/local-packages\.json/);

    const source = await store.admitSource({ candidate_ref: inspected.candidate_ref }) as Json;
    assert.match(source.admission_ref, /^webenvoy\.source-admission\/site-skill-package\/v1#sha256:[a-f0-9]{64}$/);
    const request = { package_ref: packageRef, revision_ref: inspected.revision_ref, package_digest: inspected.package_digest, task_ref: taskRef };
    const sourceOnly = await store.resolveAdmitted(request);
    assert(sourceOnly);
    assert.equal(sourceOnly.admission_ref, source.admission_ref);
    assert.equal(sourceOnly.code_admission_ref, undefined, "source admission does not imply code admission");
    assert.equal((await store.listAdmitted(packageRef)).length, 1, "source-only pin remains available to the disabled install path");

    const admitted = await store.admitCode({ admission_ref: source.admission_ref }) as Json;
    assert.equal(admitted.code_active, true);
    const runnable = await store.resolveAdmitted(request);
    assert.match(runnable?.code_admission_ref ?? "", /^webenvoy\.code-admission\/site-skill-script\/v1#sha256:[a-f0-9]{64}$/);
    const revokedCode = await store.revokeCode({ admission_ref: source.admission_ref }) as Json;
    assert.equal(revokedCode.active, true);
    assert.equal(revokedCode.code_active, false);
    assert.equal((await store.resolveAdmitted(request))?.code_admission_ref, undefined);
    assert.equal((await store.listAdmitted(packageRef)).length, 1);
    const revokedSource = await store.revokeSource({ admission_ref: source.admission_ref }) as Json;
    assert.equal(revokedSource.active, false);
    assert.equal(await store.resolveAdmitted(request), undefined);
    assert.equal((await store.listAdmitted(packageRef)).length, 0);
    const receiptsAfterRevocation = await store.listAdmissions(packageRef) as Json[];
    assert.equal(receiptsAfterRevocation.length, 1, "revocation preserves the historical admission receipt");
    assert.equal(receiptsAfterRevocation[0]?.admission_ref, source.admission_ref);
    assert.equal(receiptsAfterRevocation[0]?.active, false);
    assert.equal(receiptsAfterRevocation[0]?.code_active, false);
    assert.equal(receiptsAfterRevocation[0]?.code_admission_ref, admitted.code_admission_ref);

    await writeFile(skillPath, `${await readFile(skillPath, "utf8")}Unadmitted authoring change.\n`);
    await commit(root, "tamper a non-generated package source file");
    await assert.rejects(
      store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: packageRef, base_revision_ref: basePin.revision_ref, task_ref: taskRef }),
      /managed_site_task_source_tree_mismatch/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner can explicitly admit a first fixed package without a static base, with separate source and code receipts", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "webenvoy-site-task-first-admission-")));
  const root = join(directory, "lode-worktree");
  const firstPackageRef = "lode://site-skill/github/opencli-trending-repos";
  const firstPackagePath = "sites/github/opencli-trending-repos";
  const firstTaskRef = "read-opencli-trending";
  const capabilityRef = "lode://site-capability/github/opencli-trending-repos@0.1.0";
  const lockRef = "lode://lock/site-skill/github/opencli-trending-repos@0.1.0";
  const sourceRefFor = (commitId: string) => "lode://source/site-skill/github/opencli-trending-repos@0.1.0#" + commitId;
  const revisionRefFor = (commitId: string) => firstPackageRef + "@0.1.0#" + commitId;
  const script = "export async function run(input, broker) { return { ok: true }; }\n";
  const packageFiles = new Map<string, { role: string; bytes: Buffer }>();
  const setFile = (path: string, role: string, value: string | Json) => {
    packageFiles.set(path, { role, bytes: Buffer.from(typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n") });
  };
  setFile("SKILL.md", "entrypoint", "# Read OpenCLI Trending\n");
  setFile("capabilities/public-http.json", "capability_declaration", {
    capability_ref: capabilityRef, capability_id: "opencli-trending-repos", version: "0.1.0",
    source_ref: sourceRefFor("0".repeat(40)), lock_ref: lockRef, operation_id: "network.public_read", action: "read"
  });
  setFile("package-lock.json", "package_lock", {
    schema_version: "lode.site-skill-package.lock.v1", lock_ref: lockRef, package_ref: firstPackageRef,
    revision_ref: revisionRefFor("0".repeat(40)), version: "0.1.0", source_ref: sourceRefFor("0".repeat(40)), capability_ref: capabilityRef
  });
  setFile("scripts/read.mjs", "script_source", script);

  try {
    await mkdir(root, { recursive: true });
    await git(root, "init", "--quiet");
    await git(root, "config", "user.name", "Site Admission Test");
    await git(root, "config", "user.email", "site-admission@example.invalid");
    await writeFile(join(root, "README.md"), "Lode source fixture\n");
    await commit(root, "initialize Lode fixture");
    for (const [path, item] of packageFiles) {
      const absolute = join(root, firstPackagePath, path);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, item.bytes);
    }
    const sourceCommit = await commit(root, "pin reviewed OpenCLI-derived sources");
    setFile("capabilities/public-http.json", "capability_declaration", {
      capability_ref: capabilityRef, capability_id: "opencli-trending-repos", version: "0.1.0",
      source_ref: sourceRefFor(sourceCommit), lock_ref: lockRef, operation_id: "network.public_read", action: "read"
    });
    setFile("package-lock.json", "package_lock", {
      schema_version: "lode.site-skill-package.lock.v1", lock_ref: lockRef, package_ref: firstPackageRef,
      revision_ref: revisionRefFor(sourceCommit), version: "0.1.0", source_ref: sourceRefFor(sourceCommit), capability_ref: capabilityRef
    });
    for (const [path, item] of packageFiles) await writeFile(join(root, firstPackagePath, path), item.bytes);
    const packageDigest = sha256("fixed-manifest-verified-package");
    const manifest = {
      manifest_version: "lode.site-skill-package.manifest.v1", package_type: "site-skill", package_ref: firstPackageRef,
      revision_ref: revisionRefFor(sourceCommit), version: "0.1.0",
      source: { repository: "WebEnvoy/Lode", package_path: firstPackagePath, commit: sourceCommit, source_ref: sourceRefFor(sourceCommit) },
      package_lock: { path: "package-lock.json", lock_ref: lockRef },
      integrity: { files: [...packageFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, item]) => ({
        path, role: item.role, bytes: item.bytes.length, sha256: sha256(item.bytes)
      })), package_digest: packageDigest },
      assets: [{ role: "capability_declaration", path: "capabilities/public-http.json", capability_ref: capabilityRef }],
      scripts: [{
        script_ref: "lode://script/site-skill/github/opencli-trending-repos/read@0.1.0", path: "scripts/read.mjs",
        source_commit: sourceCommit, version: "0.1.0", sha256: sha256(script), runtime_kind: "webenvoy.site-skill-script-abi/v1",
        entrypoint: "run", input_schema_ref: "lode://schema/site-skill/github/opencli-trending-repos/input@0.1.0",
        output_schema_ref: "lode://schema/site-skill/github/opencli-trending-repos/output@0.1.0",
        capability_refs: [capabilityRef], action: "read", broker: "webenvoy.site-skill-broker/v1.1", broker_capabilities: ["network.read", "output.write"],
        target_binding: { target_type: "public_http_origin", requires_current_page: false }, timeout_ms: 10000, cancel: "cooperative",
        data_handling: { input_sensitivity: "public", output_sensitivity: "public", external_egress: "declared" }
      }]
    };
    await writeJson(join(root, firstPackagePath, "manifest.json"), manifest);
    await mkdir(join(root, "registry"), { recursive: true });
    await writeJson(join(root, "registry/local-packages.json"), { schema_version: "lode.local-package-index.v0",
      entries: [{ package_ref: firstPackageRef, package_type: "site-skill", package_path: firstPackagePath,
        manifest_path: firstPackagePath + "/manifest.json", revision_ref: revisionRefFor(sourceCommit),
        package_digest: packageDigest, task_refs: [firstTaskRef] }] });
    const authoringCommit = await commit(root, "materialize the immutable Lode source pin");
    const runtime: SiteTaskAdmissionRuntime = {
      approvedBasePackageFor() { return undefined; },
      async verifyPackageRoot(lodeAssetsPath, pin) {
        assert.equal(lodeAssetsPath, root);
        const files = await Promise.all([...packageFiles.keys()].map(async path => {
          const bytes = await readFile(join(root, firstPackagePath, path));
          return { path, bytes, sha256: sha256(bytes) };
        }));
        return { package_ref: pin.package_ref, revision_ref: pin.revision_ref, package_digest: pin.package_digest,
          source_ref: pin.source_ref, source_commit: pin.source_commit, task_ref: pin.task_ref, files };
      },
      scriptCodeAdmissionRef(pin) {
        assert(pin.script);
        return "webenvoy.code-admission/site-skill-script/v1#sha256:" +
          createHash("sha256").update(canonical({ package_ref: pin.package_ref, revision_ref: pin.revision_ref,
            package_digest: pin.package_digest, script_ref: pin.script.script_ref, script_sha256: pin.script.sha256 })).digest("hex");
      }
    };
    const store = createFileManagedSiteTaskAdmissionStore({ directory: join(directory, "owner-state"), managedDataRoot: join(directory, "managed"), runtime });
    const selected = await store.selectAuthoringRepository({ path: root }) as Json;
    await assert.rejects(store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: firstPackageRef,
      base_revision_ref: "lode://site-skill/github/other@1.0.0#" + "a".repeat(40), task_ref: firstTaskRef }),
    /managed_site_task_base_revision_unapproved/, "a forged base cannot convert initial admission to an approved update");
    const candidate = await store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: firstPackageRef,
      base_revision_ref: null, task_ref: firstTaskRef }) as Json;
    assert.equal(candidate.base_revision_ref, null);
    assert.equal(candidate.authoring_commit, authoringCommit);
    assert.equal(candidate.source_commit, sourceCommit);
    assert(candidate.changed_paths.includes("scripts/read.mjs"));
    const diff = await store.candidateDiff({ candidate_ref: candidate.candidate_ref }) as Json;
    assert.match(String(diff.diff), /export async function run/);
    assert.match(String(diff.diff), /registry\/local-packages\.json/);
    const request = { package_ref: firstPackageRef, revision_ref: candidate.revision_ref, package_digest: candidate.package_digest, task_ref: firstTaskRef };
    assert.equal(await store.resolveAdmitted(request), undefined, "inspection alone does not admit the package");
    await assert.rejects(store.candidateDiff({ candidate_ref: candidate.candidate_ref.replace(/[a-f0-9]{64}$/, "f".repeat(64)) }),
      /managed_site_task_source_candidate_unavailable/);
    const sourceReceipt = await store.admitSource({ candidate_ref: candidate.candidate_ref }) as Json;
    assert.equal(sourceReceipt.base_revision_ref, null);
    assert.equal(sourceReceipt.code_active, false, "source admission does not imply script-code admission");
    assert.equal((await store.resolveAdmitted(request))?.code_admission_ref, undefined);
    assert.equal((await store.admitSource({ candidate_ref: candidate.candidate_ref }) as Json).admission_ref, sourceReceipt.admission_ref,
      "the same explicit admission reuses its receipt");
    const selectedAgain = await store.selectAuthoringRepository({ path: root }) as Json;
    const candidateAgain = await store.inspectCandidate({ repository_ref: selectedAgain.repository_ref, package_ref: firstPackageRef,
      base_revision_ref: null, task_ref: firstTaskRef }) as Json;
    await assert.rejects(store.admitSource({ candidate_ref: candidateAgain.candidate_ref }),
      /managed_site_task_source_admission_conflict/, "a second repository selection cannot create an unreadable duplicate receipt");
    assert.equal((await store.listAdmissions(firstPackageRef)).length, 1);
    const codeReceipt = await store.admitCode({ admission_ref: sourceReceipt.admission_ref }) as Json;
    assert.equal(codeReceipt.code_active, true);
    const restarted = createFileManagedSiteTaskAdmissionStore({ directory: join(directory, "owner-state"), managedDataRoot: join(directory, "managed"), runtime });
    assert.equal((await restarted.resolveAdmitted(request))?.code_admission_ref, codeReceipt.code_admission_ref, "admission receipts survive restart");
    await restarted.revokeSource({ admission_ref: sourceReceipt.admission_ref });
    await assert.rejects(restarted.admitSource({ candidate_ref: candidateAgain.candidate_ref }),
      /managed_site_task_source_admission_conflict/, "revocation preserves the first admission history");
    assert.equal((await restarted.listAdmissions(firstPackageRef)).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner-derived manifest pin passes the real site package verifier", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "webenvoy-site-task-real-verifier-")));
  const root = join(directory, "lode-worktree");
  const capabilityRef = "lode://site-capability/github/managed-page-snapshot@1.0.0";
  const taskRef = "read-daily-trending-top5";
  const schemaInputRef = "lode://schema/site-skill/github/trending/daily-top5/input@1.0.1";
  const schemaOutputRef = "lode://schema/site-skill/github/trending/daily-top5/output@1.0.1";
  const checkRef = "lode://check/site-skill/github/trending/daily-top5@1.0.1";
  const lockRef = "lode://lock/site-skill/github/trending@1.0.1";
  const sourceRefFor = (commitId: string) => `lode://source/site-skill/github/trending@1.0.1#${commitId}`;
  const revisionRefFor = (commitId: string) => `${packageRef}@1.0.1#${commitId}`;
  const code = "export async function run(input, broker, context) { return { ok: true }; }\n";
  const scriptRef = "lode://script/site-skill/github/trending/read-daily-top5@1.0.1";
  const scriptHash = sha256(code);
  const packageFiles = new Map<string, { role: string; bytes: Buffer }>();
  const setFile = (path: string, role: string, value: string | Json) => {
    const bytes = Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
    packageFiles.set(path, { role, bytes });
  };
  const inputSchema = { $id: schemaInputRef, type: "object", properties: {}, additionalProperties: false };
  const outputSchema = { $id: schemaOutputRef, type: "object", properties: {}, additionalProperties: false };
  const check = { schema_version: "lode.post-check.v0", check_ref: checkRef, requirements: [] };
  const task = {
    task_ref: taskRef, version: "1.0.1", title: "Read daily trending top five", operation_id: "instance.snapshot", action: "read",
    entrypoint: { script_ref: scriptRef, script_version: "1.0.1", script_sha256: scriptHash, runtime_kind: "webenvoy.site-skill-script-abi/v1",
      broker: "webenvoy.site-skill-broker/v1", capability_refs: [capabilityRef] },
    inputs: { schema_ref: schemaInputRef, carrier: "none", max_bytes: 0, sensitivity: "public" },
    outputs: { schema_ref: schemaOutputRef, result_kind: "github_trending_daily_top5", completeness: "required" },
    verification: { post_check_ref: checkRef, required_evidence_refs: ["snapshot_ref"] }
  };
  setFile("SKILL.md", "entrypoint", "# Read GitHub Trending\n\nRead a bounded current page snapshot.\n");
  setFile("capabilities/managed-page-snapshot.json", "capability_declaration", {
    capability_ref: capabilityRef, capability_id: "managed-page-snapshot", version: "1.0.0",
    source_ref: sourceRefFor("0".repeat(40)), lock_ref: lockRef, operation_id: "instance.snapshot", action: "read"
  });
  setFile("checks/post-check.json", "post_check", check);
  setFile("schemas/input.schema.json", "input_schema", inputSchema);
  setFile("schemas/output.schema.json", "output_schema", outputSchema);
  setFile("scripts/read-daily-trending-top5.mjs", "script_source", code);
  setFile("tasks/read-daily-trending-top5.json", "task_declaration", task);
  const placeholder = "0".repeat(40);
  setFile("package-lock.json", "package_lock", {
    schema_version: "lode.site-skill-package.lock.v1", lock_ref: lockRef,
    package_ref: packageRef, revision_ref: revisionRefFor(placeholder), version: "1.0.1",
    source_ref: sourceRefFor(placeholder), capability_ref: capabilityRef
  });
  const makeManifestAndRegistry = async (sourceCommit: string): Promise<{ manifest: Json; packageDigest: string }> => {
    const records = [...packageFiles.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, item]) => ({
      path, role: item.role, bytes: item.bytes.byteLength, sha256: sha256(item.bytes)
    }));
    const manifest: Json = {
      manifest_version: "lode.site-skill-package.manifest.v1", package_type: "site-skill", package_ref: packageRef,
      revision_ref: revisionRefFor(sourceCommit), version: "1.0.1",
      source: { repository: "WebEnvoy/Lode", package_path: packagePath, commit: sourceCommit, source_ref: sourceRefFor(sourceCommit) },
      package_lock: { path: "package-lock.json", lock_ref: lockRef },
      integrity: { files: records, package_digest: "sha256:" + "0".repeat(64) },
      compatibility: { required_capabilities: [{ ref: capabilityRef, version: "1.0.0" }] },
      assets: [
        { role: "capability_declaration", path: "capabilities/managed-page-snapshot.json", capability_ref: capabilityRef },
        { role: "input_schema", path: "schemas/input.schema.json", schema_ref: schemaInputRef },
        { role: "output_schema", path: "schemas/output.schema.json", schema_ref: schemaOutputRef },
        { role: "post_check", path: "checks/post-check.json", check_ref: checkRef }
      ],
      scripts: [{
        script_ref: scriptRef, path: "scripts/read-daily-trending-top5.mjs", source_commit: sourceCommit, version: "1.0.1", sha256: scriptHash,
        runtime_kind: "webenvoy.site-skill-script-abi/v1", entrypoint: "run", input_schema_ref: schemaInputRef,
        output_schema_ref: schemaOutputRef, capability_refs: [capabilityRef], action: "read",
        broker: "webenvoy.site-skill-broker/v1", broker_capabilities: ["runtime.invoke", "output.write"],
        target_binding: { target_type: "web_page", requires_current_page: true, requires_fresh_observation: true }, timeout_ms: 10000,
        cancel: "cooperative", data_handling: { input_sensitivity: "public", output_sensitivity: "public", external_egress: "none" }
      }],
      tasks: [{ task_ref: taskRef, path: "tasks/read-daily-trending-top5.json" }]
    };
    const withoutDigest = structuredClone(manifest);
    delete (withoutDigest.integrity as Json).package_digest;
    const tupleText = records.map(item => `${item.path}\t${item.bytes}\t${item.sha256}\n`).join("");
    const packageDigest = sha256(`lode.site-skill-package/v1\n${canonical(withoutDigest)}\n${tupleText}`);
    (manifest.integrity as Json).package_digest = packageDigest;
    for (const [path, item] of packageFiles) {
      const absolute = join(root, packagePath, path);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, item.bytes);
    }
    await writeJson(join(root, packagePath, "manifest.json"), manifest);
    await mkdir(join(root, "registry"), { recursive: true });
    await writeJson(join(root, "registry/local-packages.json"), {
      schema_version: "lode.local-package-index.v0",
      entries: [{ package_ref: packageRef, package_type: "site-skill", package_path: packagePath,
        manifest_path: `${packagePath}/manifest.json`, revision_ref: revisionRefFor(sourceCommit), package_digest: packageDigest, task_refs: [taskRef] }]
    });
    return { manifest, packageDigest };
  };

  try {
    await mkdir(root, { recursive: true });
    await git(root, "init", "--quiet");
    await git(root, "config", "user.name", "Site Admission Test");
    await git(root, "config", "user.email", "site-admission@example.invalid");
    await writeFile(join(root, "README.md"), "Lode source fixture\n");
    const baseCommit = await commit(root, "initialize source fixture");
    const basePin: ExtendedSiteSkillPackagePin = {
      package_ref: packageRef, package_path: packagePath, task_ref: taskRef, revision_ref: `${packageRef}@1.0.0#${baseCommit}`,
      package_digest: sha256("base-package"), manifest_sha256: createHash("sha256").update("base-manifest").digest("hex"),
      source_repository: "WebEnvoy/Lode", source_path: packagePath, source_commit: baseCommit,
      source_ref: `lode://source/site-skill/github/trending@1.0.0#${baseCommit}`,
      lock_ref: "lode://lock/site-skill/github/trending@1.0.0", capability_asset_ref: capabilityRef,
      script: undefined
    };
    for (const [path, item] of packageFiles) {
      const absolute = join(root, packagePath, path);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, item.bytes);
    }
    const sourceCommit = await commit(root, "commit package source before generated pins");
    setFile("capabilities/managed-page-snapshot.json", "capability_declaration", {
      capability_ref: capabilityRef, capability_id: "managed-page-snapshot", version: "1.0.0",
      source_ref: sourceRefFor(sourceCommit), lock_ref: lockRef, operation_id: "instance.snapshot", action: "read"
    });
    setFile("package-lock.json", "package_lock", {
      schema_version: "lode.site-skill-package.lock.v1", lock_ref: lockRef,
      package_ref: packageRef, revision_ref: revisionRefFor(sourceCommit), version: "1.0.1",
      source_ref: sourceRefFor(sourceCommit), capability_ref: capabilityRef
    });
    await makeManifestAndRegistry(sourceCommit);
    await commit(root, "materialize generated package pins");

    const runtime: SiteTaskAdmissionRuntime = {
      approvedBasePackageFor(value) { return value === packageRef ? basePin : undefined; },
      verifyPackageRoot(lodeAssetsPath, pin) { return verifySiteSkillPackageRoot(lodeAssetsPath, pin); },
      scriptCodeAdmissionRef: managedSiteScriptCodeAdmissionRef
    };
    const store = createFileManagedSiteTaskAdmissionStore({ directory: join(directory, "owner-state"), managedDataRoot: join(directory, "managed"), runtime });
    const selected = await store.selectAuthoringRepository({ path: root }) as Json;
    const candidate = await store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: packageRef, base_revision_ref: basePin.revision_ref, task_ref: taskRef }) as Json;
    const admittedPin = await store.resolveAdmitted({ package_ref: packageRef, revision_ref: candidate.revision_ref, package_digest: candidate.package_digest, task_ref: taskRef });
    assert.equal(admittedPin, undefined, "source inspection alone must not create runnable code admission");
    const diff = await store.candidateDiff({ candidate_ref: candidate.candidate_ref }) as Json;
    assert.match(String(diff.diff), /read-daily-trending-top5\.mjs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner Git inspection ignores executable config, inherited GIT overrides, custom filters, and redirected Git roots", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "webenvoy-site-task-git-safety-")));
  const repo = join(directory, "authoring");
  const redirectedRepo = join(directory, "redirected");
  const marker = join(directory, "fsmonitor-ran");
  const fsmonitor = join(directory, "fsmonitor.sh");
  const envMarker = join(directory, "env-fsmonitor-ran");
  const envFsmonitor = join(directory, "env-fsmonitor.sh");
  const filterRepo = join(directory, "filter-repo");
  const filterMarker = join(directory, "filter-ran");
  const filter = join(directory, "clean-filter.sh");
  const includeRepo = join(directory, "included-filter-repo");
  const includedFilterMarker = join(directory, "included-filter-ran");
  const includedFilter = join(directory, "included-clean-filter.sh");
  const worktreeFilterRepo = join(directory, "worktree-filter-repo");
  const worktreeFilterMarker = join(directory, "worktree-filter-ran");
  const worktreeFilter = join(directory, "worktree-clean-filter.sh");
  const runtime: SiteTaskAdmissionRuntime = {
    approvedBasePackageFor() { return undefined; },
    async verifyPackageRoot() { throw new Error("not used in repository selection"); },
    scriptCodeAdmissionRef() { return "not-used"; }
  };
  const store = createFileManagedSiteTaskAdmissionStore({
    directory: join(directory, "owner"), managedDataRoot: join(directory, "managed"), runtime
  });
  try {
    await mkdir(repo, { recursive: true });
    await git(repo, "init", "--quiet");
    await git(repo, "config", "user.name", "Git Safety Test");
    await git(repo, "config", "user.email", "git-safety@example.invalid");
    await writeFile(join(repo, "README.md"), "selected repository\n");
    await commit(repo, "initialize selected repository");
    await writeFile(fsmonitor, `#!/bin/sh\nprintf 'ran' > '${marker}'\nprintf 'token\\n'\n`);
    await chmod(fsmonitor, 0o700);
    const configPath = join(repo, ".git/config");
    await writeFile(configPath, `${await readFile(configPath, "utf8")}\n[core]\n\tfsmonitor = ${fsmonitor}\n`);
    const selected = await store.selectAuthoringRepository({ path: repo }) as Json;
    await assert.rejects(access(marker), { code: "ENOENT" }, "Agent-authored core.fsmonitor is never executed by Core");

    await mkdir(redirectedRepo, { recursive: true });
    await git(redirectedRepo, "init", "--quiet");
    await git(redirectedRepo, "config", "user.name", "Git Safety Test");
    await git(redirectedRepo, "config", "user.email", "git-safety@example.invalid");
    await writeFile(join(redirectedRepo, "README.md"), "selected repository\n");
    await commit(redirectedRepo, "initialize redirected repository");
    await writeFile(envFsmonitor, `#!/bin/sh\nprintf 'ran' > '${envMarker}'\nprintf 'token\\n'\n`);
    await chmod(envFsmonitor, 0o700);
    const envKeys = ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
    const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
    try {
      process.env.GIT_DIR = join(redirectedRepo, ".git");
      process.env.GIT_WORK_TREE = redirectedRepo;
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = "core.fsmonitor";
      process.env.GIT_CONFIG_VALUE_0 = envFsmonitor;
      await assert.rejects(
        store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: packageRef, base_revision_ref: "unapproved", task_ref: taskRef }),
        /managed_site_task_base_revision_unapproved/
      );
    } finally {
      for (const [key, value] of originalEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    await assert.rejects(access(envMarker), { code: "ENOENT" }, "inherited GIT_* config and repository overrides are ignored");

    await git(repo, "config", "core.worktree", redirectedRepo);
    await assert.rejects(store.selectAuthoringRepository({ path: repo }), /managed_site_task_authoring_repository_invalid/);

    await git(redirectedRepo, "config", "core.worktree", repo);
    await rm(join(repo, ".git"), { recursive: true, force: true });
    await writeFile(join(repo, ".git"), `gitdir: ${join(redirectedRepo, ".git")}\n`);
    const redirectedStore = createFileManagedSiteTaskAdmissionStore({
      directory: join(directory, "redirected-owner"), managedDataRoot: redirectedRepo, runtime
    });
    await assert.rejects(
      redirectedStore.selectAuthoringRepository({ path: repo }),
      /managed_site_task_authoring_repository_invalid|managed_site_task_authoring_repository_in_managed_root/
    );

    await mkdir(filterRepo, { recursive: true });
    await git(filterRepo, "init", "--quiet");
    await git(filterRepo, "config", "user.name", "Git Safety Test");
    await git(filterRepo, "config", "user.email", "git-safety@example.invalid");
    await writeFile(join(filterRepo, ".gitattributes"), "README.md filter=hostile\n");
    await writeFile(join(filterRepo, "README.md"), "tracked bytes\n");
    await commit(filterRepo, "initialize filter fixture");
    await writeFile(filter, `#!/bin/sh\nprintf 'ran' > '${filterMarker}'\ncat\n`);
    await chmod(filter, 0o700);
    await git(filterRepo, "config", "filter.hostile.clean", filter);
    await assert.rejects(store.selectAuthoringRepository({ path: filterRepo }), /managed_site_task_authoring_repository_invalid/);
    await assert.rejects(access(filterMarker), { code: "ENOENT" }, "custom clean filters are rejected before status can execute them");

    await mkdir(includeRepo, { recursive: true });
    await git(includeRepo, "init", "--quiet");
    await git(includeRepo, "config", "user.name", "Git Safety Test");
    await git(includeRepo, "config", "user.email", "git-safety@example.invalid");
    await writeFile(join(includeRepo, ".gitattributes"), "README.md filter=hostile\n");
    await writeFile(join(includeRepo, "README.md"), "tracked bytes\n");
    await commit(includeRepo, "initialize included filter fixture");
    await writeFile(includedFilter, `#!/bin/sh\nprintf 'ran' > '${includedFilterMarker}'\ncat\n`);
    await chmod(includedFilter, 0o700);
    await writeFile(join(directory, "included-filter.cfg"), `[filter "hostile"]\n clean = ${includedFilter}\n`);
    await writeFile(join(includeRepo, ".git/config"), `${await readFile(join(includeRepo, ".git/config"), "utf8")}\n[include]\n path = ../../included-filter.cfg\n`);
    await assert.rejects(store.selectAuthoringRepository({ path: includeRepo }), /managed_site_task_authoring_repository_invalid/);
    await assert.rejects(access(includedFilterMarker), { code: "ENOENT" }, "included repository clean filters are rejected before status can execute them");

    await mkdir(worktreeFilterRepo, { recursive: true });
    await git(worktreeFilterRepo, "init", "--quiet");
    await git(worktreeFilterRepo, "config", "user.name", "Git Safety Test");
    await git(worktreeFilterRepo, "config", "user.email", "git-safety@example.invalid");
    await writeFile(join(worktreeFilterRepo, ".gitattributes"), "README.md filter=hostile\n");
    await writeFile(join(worktreeFilterRepo, "README.md"), "tracked bytes\n");
    await commit(worktreeFilterRepo, "initialize worktree filter fixture");
    await writeFile(worktreeFilter, `#!/bin/sh\nprintf 'ran' > '${worktreeFilterMarker}'\ncat\n`);
    await chmod(worktreeFilter, 0o700);
    await git(worktreeFilterRepo, "config", "extensions.worktreeConfig", "true");
    await writeFile(join(worktreeFilterRepo, ".git/config.worktree"), `[filter "hostile"]\n clean = ${worktreeFilter}\n`);
    await assert.rejects(store.selectAuthoringRepository({ path: worktreeFilterRepo }), /managed_site_task_authoring_repository_invalid/);
    await assert.rejects(access(worktreeFilterMarker), { code: "ENOENT" }, "worktree repository clean filters are rejected before status can execute them");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
