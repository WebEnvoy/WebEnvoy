import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileManagedSiteTaskAdmissionStore, type ExtendedSiteSkillPackagePin, type SiteTaskAdmissionRuntime } from "./managed-site-task-admission.js";

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
      manifest_sha256: sha256("base-manifest"), source_repository: "WebEnvoy/Lode", source_path: packagePath,
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
    const inspected = await store.inspectCandidate({ repository_ref: selected.repository_ref, package_ref: packageRef, base_revision_ref: basePin.revision_ref, task_ref: taskRef }) as Json;
    assert.equal(inspected.authoring_commit, authoringCommit);
    assert.equal(inspected.source_commit, sourceCommit);
    assert.deepEqual(inspected.changed_paths, ["SKILL.md", "capabilities/managed-page-snapshot.json", "manifest.json", "package-lock.json", "registry/local-packages.json", "scripts/read-daily-trending-top5.mjs"]);
    const diff = await store.candidateDiff({ candidate_ref: inspected.candidate_ref }) as Json;
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
