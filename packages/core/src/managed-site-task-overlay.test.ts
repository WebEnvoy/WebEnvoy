import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createFileManagedAccessStore, managedSkillOperations, managedTaskOperations } from "./managed-access.js";
import { createManagedTaskService } from "./managed-task.js";
import { createFileManagedSiteTaskAdmissionStore } from "./managed-site-task-admission.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { managedSiteScriptCodeAdmissionRef, verifySiteSkillPackageRoot, approvedManagedSiteTaskBasePackageFor, approvedManagedSiteTaskPackageFor } from "./site-skill-package.js";
import { createFileSkillLibraryService } from "./skill-library.js";
import type { ProgramPublicHttpPolicy, ProgramPublicHttpResponse } from "./program-public-http.js";

type Json = Record<string, any>;
const execFileAsync = promisify(execFile);
const lodeRoot = process.env.WEBENVOY_LODE_ROOT;
const packageRef = "lode://site-skill/github/opencli-trending-repos";
const packagePath = "sites/github/opencli-trending-repos";
const taskRef = "read-trending-repositories";
const origin = "https://github.com";
const profileRef = "profile:opencli-overlay-test";
const credentialHash = "c".repeat(64);
const expiry = "2099-01-01T00:00:00.000Z";

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Json)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function git(root: string, ...args: string[]): Promise<string> {
  return String((await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" })).stdout).trim();
}
async function gitCommit(root: string, message: string): Promise<string> {
  await git(root, "add", "-A");
  await git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}
async function writeJson(path: string, value: unknown): Promise<void> { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
async function runManagedSiteWorker(ticket: Json, managedTask: ReturnType<typeof createManagedTaskService>): Promise<Json> {
  const workerPath = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/agent-entry/managed-site-worker.mjs");
  const child = spawn(process.execPath, ["--experimental-vm-modules", workerPath], { stdio: ["pipe", "pipe", "pipe"], env: {} });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const exited = once(child, "exit");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const identity = await iterator.next();
    assert.equal(identity.done, false);
    const identityFrame = JSON.parse(identity.value as string) as Json;
    assert.equal(identityFrame.type, "identity");
    assert.equal(identityFrame.uid, process.getuid?.());
    assert.equal(identityFrame.pid, child.pid);
    await managedTask.workerStarted(credentialHash, { ticket_id: ticket.ticket_id });
    child.stdin.write(`${JSON.stringify({ source: ticket.script.source, input: ticket.input.value, context: ticket.context,
      broker_capabilities: ticket.script.broker_capabilities, execution_timeout_ms: Math.min(ticket.deadline_at - Date.now(), 10_000) })}\n`);
    let expectedId = 1;
    for (;;) {
      const next = await iterator.next();
      assert.equal(next.done, false, "worker closed before reporting a terminal frame");
      const frame = JSON.parse(next.value as string) as Json;
      if (frame.type === "broker.request") {
        assert.equal(frame.id, expectedId++);
        assert(ticket.script.broker_capabilities.includes(frame.method));
        try {
          const result = await managedTask.broker(credentialHash, { ticket_id: ticket.ticket_id, method: frame.method, input: frame.input });
          child.stdin.write(`${JSON.stringify({ type: "broker.response", id: frame.id, ok: true, result: result ?? null })}\n`);
        } catch (error) {
          const code = error instanceof Error ? error.message : "managed_site_broker_denied";
          child.stdin.write(`${JSON.stringify({ type: "broker.response", id: frame.id, ok: false, code })}\n`);
        }
        continue;
      }
      if (frame.type === "complete") {
        const [code] = await exited;
        assert.equal(code, 0);
        return await managedTask.workerComplete(credentialHash, { ticket_id: ticket.ticket_id }) as Json;
      }
      if (frame.type === "failure") {
        await exited;
        return await managedTask.workerFailure(credentialHash, { ticket_id: ticket.ticket_id, code: frame.code }) as Json;
      }
      assert.fail(`unexpected managed site worker frame: ${JSON.stringify(frame)}`);
    }
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited.catch(() => undefined);
  }
}
async function packageFiles(root: string, relative = ""): Promise<string[]> {
  const absolute = join(root, packagePath, relative);
  const found: string[] = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = [relative, entry.name].filter(Boolean).join("/");
    if (entry.isDirectory()) found.push(...await packageFiles(root, child));
    else if (child !== "manifest.json") found.push(child);
  }
  return found.sort();
}

async function createPrivateDerivedRevision(lodeAssetsPath: string, tempRoot: string, version: string, note: string) {
  const base = approvedManagedSiteTaskBasePackageFor(packageRef);
  assert(base, "the public OpenCLI package must be registered only as an owner-overlay base");
  assert.equal(approvedManagedSiteTaskPackageFor(packageRef), undefined, "the base is not runnable by default");
  const root = join(tempRoot, `private-lode-${version.replaceAll(".", "-")}`);
  await execFileAsync("git", ["clone", "--quiet", "--local", "--no-hardlinks", lodeAssetsPath, root]);
  await git(root, "checkout", "--quiet", "--detach", base.source_commit);
  await git(root, "config", "user.name", "Private Overlay Test");
  await git(root, "config", "user.email", "overlay-test@example.invalid");

  const packageRoot = join(root, packagePath);
  const manifestPath = join(packageRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Json;
  const lockPath = join(packageRoot, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as Json;
  const capabilityAsset = manifest.assets.find((item: Json) => item.role === "capability_declaration") as Json;
  const capabilityPath = join(packageRoot, capabilityAsset.path);
  const capability = JSON.parse(await readFile(capabilityPath, "utf8")) as Json;
  const taskLocator = manifest.tasks.find((item: Json) => item.task_ref === taskRef) as Json;
  assert(taskLocator);
  const taskPath = join(packageRoot, taskLocator.path);
  const task = JSON.parse(await readFile(taskPath, "utf8")) as Json;
  const scriptDeclaration = manifest.scripts[0] as Json;
  const scriptPath = join(packageRoot, scriptDeclaration.path);
  const script = await readFile(scriptPath, "utf8");
  const mismatch = "block.match(/([\\d,]+)\\s+stars\\s+(?:today|this week|this month)/i)";
  const repaired = "block.match(/\\+?([\\d,]+)\\s+stars\\s+(?:today|this week|this month)/i)";
  assert(script.includes(mismatch), "the fixed OpenCLI adapter must have the expected bounded repair point");
  await writeFile(scriptPath, script.replace(mismatch, repaired));
  await writeFile(join(packageRoot, "SKILL.md"), `${await readFile(join(packageRoot, "SKILL.md"), "utf8")}\n\nPrivate repair draft ${version}: the daily stars field accepts the observed optional leading plus. The scope, one-request budget, broker, and output contract remain unchanged.\n`);
  await writeFile(join(packageRoot, "references/recovery.md"), `${await readFile(join(packageRoot, "references/recovery.md"), "utf8")}\n\nFor a parser mismatch, keep the original Run and evidence, create a private derived draft, inspect its exact diff and dependencies, pin and test it, then ask the owner to enable or roll back with the existing revision controls. Never replay an unknown Run.\n`);

  const sourcePlaceholder = "0".repeat(40);
  const sourceRef = `lode://source/site-skill/github/opencli-trending-repos@${version}#${sourcePlaceholder}`;
  const lockRef = `lode://lock/site-skill/github/opencli-trending-repos@${version}`;
  const revisionRef = `${packageRef}@${version}#${sourcePlaceholder}`;
  const scriptHash = `sha256:${sha256(await readFile(scriptPath))}`;
  capability.source_ref = sourceRef;
  capability.lock_ref = lockRef;
  await writeJson(capabilityPath, capability);
  lock.lock_ref = lockRef;
  lock.revision_ref = revisionRef;
  lock.version = version;
  lock.source_ref = sourceRef;
  await writeJson(lockPath, lock);
  task.entrypoint.script_ref = scriptDeclaration.script_ref.replace(/@\d+\.\d+\.\d+$/, `@${version}`);
  task.entrypoint.script_version = version;
  task.entrypoint.script_sha256 = scriptHash;
  task.version = version;
  await writeJson(taskPath, task);

  // The manifest is regenerated after the source commit; versioned script and lock refs
  // are package metadata, while generated source pins are normalized by Core's verifier.
  manifest.version = version;
  manifest.revision_ref = revisionRef;
  manifest.source.commit = sourcePlaceholder;
  manifest.source.source_ref = sourceRef;
  manifest.package_lock.lock_ref = lockRef;
  manifest.scripts[0].script_ref = task.entrypoint.script_ref;
  manifest.scripts[0].version = version;
  manifest.scripts[0].source_commit = sourcePlaceholder;
  manifest.scripts[0].sha256 = scriptHash;
  manifest.assets = manifest.assets.map((asset: Json) => asset.role === "repair_guidance"
    ? { ...asset, reference_ref: String(asset.reference_ref).replace(/@\d+\.\d+\.\d+$/, `@${version}`) }
    : asset);
  await writeJson(manifestPath, manifest);
  const sourceCommit = await gitCommit(root, `private GitHub overlay draft ${version}`);

  const actualSourceRef = `lode://source/site-skill/github/opencli-trending-repos@${version}#${sourceCommit}`;
  const actualRevisionRef = `${packageRef}@${version}#${sourceCommit}`;
  capability.source_ref = actualSourceRef;
  await writeJson(capabilityPath, capability);
  lock.revision_ref = actualRevisionRef;
  lock.source_ref = actualSourceRef;
  await writeJson(lockPath, lock);

  manifest.revision_ref = actualRevisionRef;
  manifest.source.commit = sourceCommit;
  manifest.source.source_ref = actualSourceRef;
  manifest.scripts[0].source_commit = sourceCommit;
  const oldRoles = new Map((manifest.integrity.files as Json[]).map(file => [file.path, file.role]));
  const records = [];
  for (const path of await packageFiles(root)) {
    const bytes = await readFile(join(packageRoot, path));
    records.push({ path, role: oldRoles.get(path) ?? (path === "SKILL.md" ? "entrypoint" : "reference"), bytes: bytes.byteLength, sha256: `sha256:${sha256(bytes)}` });
  }
  manifest.integrity.files = records;
  delete manifest.integrity.package_digest;
  const tuples = records.map(record => `${record.path}\t${record.bytes}\t${record.sha256}\n`).join("");
  const packageDigest = `sha256:${sha256(`lode.site-skill-package/v1\n${canonical(manifest)}\n${tuples}`)}`;
  manifest.integrity.package_digest = packageDigest;
  await writeJson(manifestPath, manifest);
  const indexPath = join(root, "registry/local-packages.json");
  const index = JSON.parse(await readFile(indexPath, "utf8")) as Json;
  const entry = index.entries.find((item: Json) => item.package_ref === packageRef) as Json;
  assert(entry, "the private clone keeps the public package index entry");
  entry.revision_ref = actualRevisionRef;
  entry.package_digest = packageDigest;
  await writeJson(indexPath, index);
  const authoringCommit = await gitCommit(root, `pin private GitHub overlay ${version}`);
  return { root, sourceCommit, authoringCommit, revisionRef: actualRevisionRef, sourceRef: actualSourceRef, packageDigest, task, manifest };
}

function skillRequest(connectionId: string, grantId: string, operation: string, key: string, revisions: string[], options: Json = {}): Json {
  return {
    idempotency_key: key, connection_id: connectionId, grant_id: grantId, operation, skill_ref: packageRef,
    task_scope: { operations: managedSkillOperations, skill_refs: [packageRef], source_refs: revisions }, ...options
  };
}

test("OpenCLI trending is pinned as an overlay source base, not a default runnable package", () => {
  const base = approvedManagedSiteTaskBasePackageFor(packageRef);
  assert.equal(base?.revision_ref, `${packageRef}@0.1.0#464c7210b2efb79314292848781b472741bb996b`);
  assert.equal(base?.package_digest, "sha256:2d6fbc1df2dfced60203a095ca2b263964c35948bba11943c0fd31718800cb94");
  assert.equal(approvedManagedSiteTaskPackageFor(packageRef), undefined);
});

test("OpenCLI private overlay is admitted, installed, run through its pinned broker, rolled back, and read from its original Run", {
  skip: lodeRoot ? false : "WEBENVOY_LODE_ROOT is not configured; exact Lode package is unavailable"
}, async () => {
  const tempRoot = await realpath(await mkdtemp(join(tmpdir(), "webenvoy-opencli-private-overlay-")));
  try {
    const base = approvedManagedSiteTaskBasePackageFor(packageRef);
    assert(base);
    await verifySiteSkillPackageRoot(lodeRoot!, base);
    const first = await createPrivateDerivedRevision(lodeRoot!, tempRoot, "0.1.1", "agent repair draft");
    const second = await createPrivateDerivedRevision(lodeRoot!, tempRoot, "0.1.2", "owner-reviewed successor");
    const admissionStore = createFileManagedSiteTaskAdmissionStore({
      directory: join(tempRoot, "owner-state"), managedDataRoot: join(tempRoot, "managed-root"),
      runtime: { approvedBasePackageFor: approvedManagedSiteTaskBasePackageFor, verifyPackageRoot: verifySiteSkillPackageRoot,
        scriptCodeAdmissionRef: managedSiteScriptCodeAdmissionRef }
    });
    const firstRepo = await admissionStore.selectAuthoringRepository({ path: first.root }) as Json;
    const firstCandidate = await admissionStore.inspectCandidate({ repository_ref: firstRepo.repository_ref, package_ref: packageRef,
      base_revision_ref: base.revision_ref, task_ref: taskRef }) as Json;
    assert.equal(firstCandidate.source_commit, first.sourceCommit);
    const diff = await admissionStore.candidateDiff({ candidate_ref: firstCandidate.candidate_ref }) as Json;
    assert.match(diff.diff, /opencli-adapter\.mjs/);
    assert.match(diff.diff, /registry\/local-packages\.json/);
    assert.match(diff.diff, /optional leading plus/);
    assert(!firstCandidate.changed_paths.some((path: string) => path === "package.json" || path.startsWith("node_modules/")),
      "the repair draft adds no executable dependencies");
    const sourceReceipt = await admissionStore.admitSource({ candidate_ref: firstCandidate.candidate_ref }) as Json;
    assert.equal(sourceReceipt.code_active, false);
    const sourceOnly = await admissionStore.resolveAdmitted({ package_ref: packageRef, revision_ref: first.revisionRef,
      package_digest: first.packageDigest, task_ref: taskRef });
    assert(sourceOnly);
    assert.equal(sourceOnly.code_admission_ref, undefined, "source admission alone cannot execute the script");
    const admitted = await admissionStore.admitCode({ admission_ref: sourceReceipt.admission_ref }) as Json;
    assert.equal(admitted.code_active, true);

    const secondRepo = await admissionStore.selectAuthoringRepository({ path: second.root }) as Json;
    const secondCandidate = await admissionStore.inspectCandidate({ repository_ref: secondRepo.repository_ref, package_ref: packageRef,
      base_revision_ref: base.revision_ref, task_ref: taskRef }) as Json;
    const secondReceipt = await admissionStore.admitSource({ candidate_ref: secondCandidate.candidate_ref }) as Json;
    await admissionStore.admitCode({ admission_ref: secondReceipt.admission_ref });

    const accessStore = createFileManagedAccessStore({ directory: join(tempRoot, "access") });
    const runRecordStore = createFileRunRecordStore({ directory: join(tempRoot, "runs") });
    const principal = await accessStore.registerPrincipal({ idempotency_key: "overlay-principal", display_name: "overlay-test", credential_hash: credentialHash });
    const connection = await accessStore.connect(credentialHash);
    const sourceRefs = [first.sourceRef, first.revisionRef, second.sourceRef, second.revisionRef];
    const allowedOperations = [...managedSkillOperations, ...managedTaskOperations];
    const grant = await accessStore.createGrant({ idempotency_key: "overlay-grant", principal_id: principal.principal_id,
      profile_refs: [profileRef], allowed_operations: allowedOperations, allowed_origins: [origin], expires_at: expiry,
      creation_template: null, max_created_profiles: 0, skill_scope: { skill_refs: [packageRef], source_refs: sourceRefs } });
    await accessStore.setProfilePolicy({ idempotency_key: "overlay-profile-policy", profile_ref: profileRef,
      allowed_operations: managedTaskOperations, allowed_origins: [origin] });
    const library = createFileSkillLibraryService({ directory: join(tempRoot, "library"), accessStore, runRecordStore,
      lodeAssetsPath: first.root, managedSiteTaskAdmissionStore: admissionStore });
    const installOps = (revisions: string[]) => (operation: string, key: string, options: Json = {}) => library.submit(credentialHash,
      skillRequest(connection.connection_id, grant.grant_id, operation, key, revisions, options));
    const installFirst = installOps(sourceRefs);
    const installedFirst = await installFirst("skill.install", "install-overlay-011", { revision_ref: first.revisionRef, source_ref: first.sourceRef }) as Json;
    assert.equal(installedFirst.status, "succeeded", JSON.stringify(installedFirst));
    const firstRecordVersion = installedFirst.result.skill.record_version;
    const enabledFirst = await installFirst("skill.enable", "enable-overlay-011", { target_revision_ref: first.revisionRef,
      source_ref: first.sourceRef, expected_record_version: firstRecordVersion }) as Json;
    assert.equal(enabledFirst.result.skill.enabled_revision_ref, first.revisionRef);

    const html = Array.from({ length: 5 }, (_, index) => {
      const repo = `owner${index + 1}/repo${index + 1}`;
      return `<article class="Box-row"><h2><a href="/${repo}">${repo}</a></h2><p class="col-9 color-fg-muted">Summary ${index + 1}</p>` +
        `<span itemprop="programmingLanguage">TypeScript</span><a href="/${repo}/stargazers">${100 + index}</a>` +
        `<a href="/${repo}/forks">${20 + index}</a><span>+${500 + index} stars today</span></article>`;
    }).join("\n");
    let httpCalls = 0;
    const managedTask = createManagedTaskService({ accessStore, runRecordStore, skillLibraryService: library,
      workerIdentity: { owner_uid: 501, agent_uid: 502, mode: "distinct_uid_hardened", owner_socket_acl: "verified" },
      async publicHttpReader(_policy: ProgramPublicHttpPolicy, callValue: unknown, dependencies): Promise<ProgramPublicHttpResponse> {
        const call = callValue as Json;
        httpCalls += 1;
        assert.equal(call.url, `${origin}/trending?since=daily`);
        await dependencies?.beforeDispatch?.(new URL(call.url), { url_sha256: sha256(call.url), pathname: "/trending", hop_index: 0 });
        return { ok: true, status: 200, url: call.url, body: html, response_ref: "public-http-response:overlay-fixture",
          content_type: "text/html", facts: { url_sha256: sha256(call.url), pathname: "/trending", status: 200,
            content_type: "text/html", body_sha256: sha256(html), body_bytes: Buffer.byteLength(html), redirect_count: 0 } };
      }
    });
    const taskInput = {
      schema_version: "webenvoy.managed-task-operation/v1", operation: "task.submit", idempotency_key: "opencli-overlay-daily-five",
      grant_id: grant.grant_id, connection_id: connection.connection_id,
      task_scope: { operations: ["task.submit"], skill_refs: [packageRef], source_refs: [first.revisionRef], profile_refs: [profileRef], origins: [origin] },
      package: { package_ref: packageRef, revision_ref: first.revisionRef, package_digest: first.packageDigest, task_ref: taskRef },
      input: { schema_ref: first.task.inputs.schema_ref, carrier: "webenvoy.managed-task-inline/v1", value: { since: "daily", limit: 5 } },
      intent: { summary: "Read the daily top five GitHub Trending repositories.", policy: { risk: "read", execution_intent: "read", timeout_ms: 10_000 } }
    };
    const prepared = await managedTask.operate(credentialHash, taskInput, { agentSocketIngressVerified: true }) as Json;
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(prepared.run.status, "running");
    const submitted = await runManagedSiteWorker(prepared.worker_execution.ticket, managedTask);
    assert.equal(submitted.run.status, "succeeded", JSON.stringify(submitted));
    const submittedRecord = await runRecordStore.getRunRecord(submitted.run.run_id);
    assert(submittedRecord?.public_result_summary);
    assert.equal(submittedRecord.public_result_summary.revision_ref, first.revisionRef);
    assert.equal(submittedRecord.public_result_summary.source_admission_ref, sourceReceipt.admission_ref);
    assert.equal(submittedRecord.public_result_summary.code_admission_ref, admitted.code_admission_ref);
    assert.equal(submitted.result.data.normalized.parameters.since, "daily");
    assert.equal(submitted.result.data.normalized.parameters.limit, 5);
    assert.equal(submitted.result.data.normalized.records.length, 5);
    assert.equal(submitted.result.data.normalized.records[0].starsSince, 500);
    assert.equal(submitted.result.post_check.status, "passed");

    const installedSecond = await installFirst("skill.install", "install-overlay-012", { revision_ref: second.revisionRef, source_ref: second.sourceRef }) as Json;
    assert.equal(installedSecond.status, "succeeded", JSON.stringify(installedSecond));
    const updatedSecond = await installFirst("skill.update", "update-overlay-012", { target_revision_ref: second.revisionRef,
      source_ref: second.sourceRef, expected_current_revision_ref: first.revisionRef, expected_record_version: installedSecond.result.skill.record_version }) as Json;
    assert.equal(updatedSecond.result.skill.enabled_revision_ref, second.revisionRef);
    const rolledBack = await installFirst("skill.rollback", "rollback-overlay-011", { target_revision_ref: first.revisionRef,
      source_ref: first.sourceRef, expected_current_revision_ref: second.revisionRef, expected_record_version: updatedSecond.result.skill.record_version }) as Json;
    assert.equal(rolledBack.result.skill.enabled_revision_ref, first.revisionRef);

    const reopenedAccess = createFileManagedAccessStore({ directory: join(tempRoot, "access") });
    const reopenedConnection = await reopenedAccess.connect(credentialHash);
    const reopenedRuns = createFileRunRecordStore({ directory: join(tempRoot, "runs") });
    const reopenedLibrary = createFileSkillLibraryService({ directory: join(tempRoot, "library"), accessStore: reopenedAccess,
      runRecordStore: reopenedRuns, lodeAssetsPath: first.root, managedSiteTaskAdmissionStore: admissionStore });
    const reopenedTask = createManagedTaskService({ accessStore: reopenedAccess, runRecordStore: reopenedRuns, skillLibraryService: reopenedLibrary,
      publicHttpReader: async () => { throw new Error("historical Run query must not redispatch"); } });
    const historical = await reopenedTask.operate(credentialHash, {
      schema_version: "webenvoy.managed-task-operation/v1", operation: "task.query", grant_id: grant.grant_id,
      connection_id: reopenedConnection.connection_id,
      task_scope: { operations: ["task.query"], skill_refs: [packageRef], source_refs: [first.revisionRef], profile_refs: [profileRef], origins: [origin] },
      selector: { run_id: submitted.run.run_id }
    }) as Json;
    assert.equal(historical.ok, true, JSON.stringify(historical));
    assert.equal(historical.run.run_id, submitted.run.run_id);
    const historicalRecord = await reopenedRuns.getRunRecord(historical.run.run_id);
    assert.equal(historicalRecord?.public_result_summary?.revision_ref, first.revisionRef);
    assert.equal(historical.result.data.normalized.records.length, 5);
    assert.equal(httpCalls, 1, "historical readback does not replay the public request");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
