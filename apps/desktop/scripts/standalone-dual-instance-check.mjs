import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('dual_instance_check_requires_macos_arm64');
const args = process.argv.slice(2);
const sourcePackageRoot = resolve(args[0] ?? process.env.PACKAGE_ROOT ?? '.');
const materialsPointer = resolve(args[1] ?? '/tmp/webenvoy-w1-material-root.txt');
const requireSupervision = args.includes('--require-supervision');
const holdAtUi = args.indexOf('--hold-before-stop-ms');
const holdBeforeStopMs = holdAtUi < 0 ? 0 : Number(args[holdAtUi + 1]);
if (!Number.isSafeInteger(holdBeforeStopMs) || holdBeforeStopMs < 0 || holdBeforeStopMs > 60_000) throw new Error('ui_hold_must_be_between_0_and_60000_ms');
const root = await mkdtemp('/tmp/webenvoy-w2-dual-instance-');
const packageRoot = join(root, 'package');
await cp(sourcePackageRoot, packageRoot, { recursive: true, errorOnExist: true });
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');
const manifestPath = join(packageRoot, 'agent-manifest.json');
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const sourceManifestBytes = await readFile(join(sourcePackageRoot, 'agent-manifest.json'));
assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),
  createHash('sha256').update(sourceManifestBytes).digest('hex'), 'isolated_package_manifest_changed');
const versionResult = spawnSync(cli, ['--version'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } });
assert.equal(versionResult.status, 0, 'isolated_package_version_failed');
const version = JSON.parse(versionResult.stdout.trim());
assert.equal(version.integrity, 'verified', 'isolated_package_integrity_unverified');
const materialsRootText = (await readFile(materialsPointer, 'utf8')).trim();
if (!materialsRootText || materialsRootText.includes('\n')) throw new Error('materials_root_pointer_invalid');
const materialsRoot = resolve(materialsRootText);
const { CAMOUFOX_UPSTREAM_PINS, verifyCamoufoxUpstreamInstall } = await import(pathToFileURL(join(packageRoot, 'agent-entry/provider-artifact.mjs')).href);
const browserRoot = join(materialsRoot, 'browser', 'Camoufox.app');
const browserExecutable = join(browserRoot, 'Contents/MacOS/camoufox');
const pythonPath = join(materialsRoot, 'venv/bin/python');
const browserSourcePath = join(materialsRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip');
const camoufoxSourcePath = join(materialsRoot, 'camoufox-0.5.6-py3-none-any.whl');
const playwrightSourcePath = join(materialsRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl');
const provider = await verifyCamoufoxUpstreamInstall({
  provider: 'camoufox', browser_install_root: browserRoot, browser_executable: browserExecutable, python_path: pythonPath,
  browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version, browser_source_path: browserSourcePath,
  camoufox_source_path: camoufoxSourcePath, playwright_source_path: playwrightSourcePath
});
const providerArgs = [
  '--browser-install-root', browserRoot, '--browser-executable', browserExecutable, '--python-path', pythonPath,
  '--browser-version', CAMOUFOX_UPSTREAM_PINS.browser_version, '--camoufox-version', CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  '--playwright-version', CAMOUFOX_UPSTREAM_PINS.playwright_version, '--browser-source-path', browserSourcePath,
  '--camoufox-source-path', camoufoxSourcePath, '--playwright-source-path', playwrightSourcePath
];

const ownerData = join(root, 'owner-data');
const agentHost = join(root, 'agent-host');
const requestRoot = join(agentHost, 'requests');
const evidencePath = join(root, 'evidence.json');
const addressPath = join(root, 'local-origin.json');
const prefix = basename(root);
const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
let currentStep = 'preflight';
let origin;
let originProcess;
let harborPid;
let profileA;
let profileB;
let sessionA;
let sessionB;
let browserPidA;
let browserPidB;
let runtimeStarted = false;
const evidence = {
  schema: 'webenvoy.dual-instance-live-check/v1', state: 'running', candidate: manifest.workspace?.commit ?? null,
  package_manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'), platform: `${process.platform}-${process.arch}`,
  owner_uid: ownerUid, agent_uid: ownerUid, trust_mode: 'trusted_local', real_provider: true,
  external_site: false, account: false, third_party_agent: false, human_interaction: false,
  agent_host_process: 'not_started; installed CLI invocations are short-lived', root, owner_data: ownerData,
  agent_host_dir: agentHost, provider: { provider: provider.provider, camoufox_version: provider.camoufox_version,
    browser_version: provider.browser_version, playwright_version: provider.playwright_version,
    properties_sha256: provider.properties_sha256, source_sha256: provider.source_sha256 },
  supervision_required: requireSupervision, hold_before_stop_ms: holdBeforeStopMs, steps: {}
};

function command(commandName, commandArgs, input) {
  const result = spawnSync(commandName, commandArgs, { cwd: packageRoot, encoding: 'utf8', input, timeout: 120_000, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw result.error;
  return result;
}
function lastJson(result, label) {
  for (const line of `${result.stdout}\n${result.stderr}`.trim().split('\n').reverse()) {
    try { return JSON.parse(line); } catch {}
  }
  throw Object.assign(new Error(`${label}_json_missing`), { code: `${label}_json_missing` });
}
function commandCode(result) {
  let parsed;
  try { parsed = lastJson(result, 'cli_error_json'); } catch {}
  const value = parsed?.error ?? parsed?.failure;
  return typeof value?.code === 'string' ? value.code : `exit_${result.status ?? 'signal'}`;
}
function runJson(commandName, commandArgs, label) {
  const result = command(commandName, commandArgs);
  if (result.status !== 0 || result.signal) throw Object.assign(new Error(`${label}:${commandCode(result)}`), { code: commandCode(result) });
  return lastJson(result, label);
}
function allowJson(commandName, commandArgs, label) {
  return lastJson(command(commandName, commandArgs), label);
}
function collectObjects(value, predicate, found = []) {
  if (Array.isArray(value)) for (const item of value) collectObjects(item, predicate, found);
  else if (value && typeof value === 'object') {
    if (predicate(value)) found.push(value);
    for (const child of Object.values(value)) collectObjects(child, predicate, found);
  }
  return found;
}
function stringsForKey(value, key, found = []) {
  if (Array.isArray(value)) for (const item of value) stringsForKey(item, key, found);
  else if (value && typeof value === 'object') {
    if (typeof value[key] === 'string') found.push(value[key]);
    for (const child of Object.values(value)) stringsForKey(child, key, found);
  }
  return found;
}
function stringForKey(value, key, label) {
  const found = stringsForKey(value, key);
  assert.ok(found[0], `${label}_missing_${key}`);
  return found[0];
}
function operationScope(operation, refs = []) { return { operations: [operation], profile_refs: refs, origins: [origin] }; }
function request(operation, idempotencyKey, grantId, taskScope, fields = {}) {
  return { idempotency_key: idempotencyKey, grant_id: grantId, operation, task_scope: taskScope, ...fields };
}
function succeeded(value, label) {
  assert.equal(value?.ok, true, `${label}_not_ok`);
  assert.equal(value?.status, 'succeeded', `${label}_not_succeeded`);
}
function expectSession(value, profileRef, sessionRef, label) {
  const row = collectObjects(value, item => item.runtime_session_ref === sessionRef && item.profile_ref === profileRef)[0];
  assert.ok(row, `${label}_identity_mismatch`);
  assert.ok(stringForKey(row, 'identity_environment_ref', label), `${label}_identity_environment_missing`);
  assert.ok(stringForKey(row, 'provider_ref', label), `${label}_provider_missing`);
  if (requireSupervision) {
    assert.equal(row.supervision?.status, 'available', `${label}_supervision_unavailable`);
    assert.deepEqual(row.supervision?.runs, [], `${label}_has_pending_runs`);
  }
  return row;
}
function listSessions(value) {
  return collectObjects(value, item => typeof item.runtime_session_ref === 'string' && typeof item.profile_ref === 'string');
}
function readSession(ref, label) {
  return runJson(cli, ['instance', 'inspect', '--data-dir', ownerData, '--runtime-session-ref', ref], label);
}
function instanceList(label) { return runJson(cli, ['instance', 'list', '--data-dir', ownerData], label); }
function assertProfileIdentity(value, profileRef, label) {
  assert.ok(stringsForKey(value, 'profile_ref').includes(profileRef), `${label}_profile_ref_missing`);
}
function profilePage(value, label) {
  const page = value?.result?.observation?.page;
  assert.ok(page && typeof page.page_ref === 'string' && typeof page.current_url === 'string', `${label}_page_missing`);
  return page;
}
function snapshotPage(value, label) {
  const snapshot = value?.result?.snapshot;
  assert.ok(snapshot && typeof snapshot.page_ref === 'string' && typeof snapshot.observation_ref === 'string', `${label}_snapshot_missing`);
  return snapshot;
}
function sessionPidList(pid) {
  const result = spawnSync('/usr/bin/pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 });
  if (result.status === 1 && !result.stdout.trim()) return [];
  if (result.status !== 0) throw Object.assign(new Error('process_child_inspection_failed'), { code: 'process_child_inspection_failed' });
  return result.stdout.trim().split(/\s+/).map(Number).filter(Number.isSafeInteger);
}
function processName(pid) {
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5_000 });
  if (result.status !== 0) return '';
  return basename(result.stdout.trim());
}
function descendantRecords(pid) {
  const found = [];
  const pending = [{ pid, parent: null, depth: 0 }];
  const seen = new Set([pid]);
  while (pending.length) {
    const parent = pending.shift();
    for (const child of sessionPidList(parent.pid)) {
      if (seen.has(child)) continue;
      seen.add(child);
      const record = { pid: child, parent: parent.pid, depth: parent.depth + 1, name: processName(child) };
      found.push(record);
      pending.push(record);
    }
  }
  return found;
}
function pythonDriverPids(pid) {
  return sessionPidList(pid).filter(child => /python/i.test(processName(child)));
}
async function waitForNewDriver(before, parentPid, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const added = pythonDriverPids(parentPid).filter(pid => !before.has(pid));
    if (added.length === 1) return added[0];
    if (added.length > 1) throw Object.assign(new Error(`${label}_driver_pid_ambiguous`), { code: `${label}_driver_pid_ambiguous` });
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw Object.assign(new Error(`${label}_driver_pid_missing`), { code: `${label}_driver_pid_missing` });
}
async function waitForBrowserPid(driverPid, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const matches = descendantRecords(driverPid).filter(item => /camoufox/i.test(item.name));
    const matchIds = new Set(matches.map(item => item.pid));
    const roots = matches.filter(item => !matchIds.has(item.parent));
    if (roots.length === 1) return roots[0].pid;
    if (roots.length > 1) {
      throw Object.assign(new Error(`${label}_browser_pid_ambiguous`), { code: `${label}_browser_pid_ambiguous` });
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw Object.assign(new Error(`${label}_browser_pid_missing`), { code: `${label}_browser_pid_missing` });
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}
async function waitForPid(pid, alive, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (pidAlive(pid) === alive) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw Object.assign(new Error(`${label}_pid_did_not_${alive ? 'remain_alive' : 'exit'}`), { code: `${label}_pid_state_mismatch` });
}
async function startLocalOrigin() {
  const source = String.raw`
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
const pages = new Map([
  ["/a", { title: "W2 Profile A task", label: "A", helper: false }],
  ["/b", { title: "W2 Profile B task", label: "B", helper: false }],
  ["/help", { title: "W2 Profile A help page B", label: "A help page B", helper: true }]
]);
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const page = pages.get(path);
  if (request.method !== "GET" || !page) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
  const main = page.helper
    ? '<main><h1>' + page.label + '</h1><p>Same Instance helper Page B; task Page A remains the original task.</p></main>'
    : '<main><h1>Task ' + page.label + '</h1><label for="message">' + page.label + ' message</label><input id="message" aria-label="' + page.label + ' message"><p id="state">' + page.label + ' inputs=0; value=</p></main><script>let count=0;const field=document.getElementById("message");const state=document.getElementById("state");field.addEventListener("input",()=>{count+=1;state.textContent="' + page.label + ' inputs="+count+"; value="+field.value})</script>';
  response.end('<!doctype html><title>' + page.title + '</title>' + main);
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  await writeFile(process.argv[1], JSON.stringify({ port: address.port }), { mode: 0o600 });
});
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop); process.once("SIGINT", stop);
`;
  originProcess = spawn(fixedNode, ['--input-type=module', '-e', source, addressPath], { cwd: packageRoot, detached: true, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } });
  originProcess.unref();
  if (!originProcess.pid) throw Object.assign(new Error('local_origin_process_start_failed'), { code: 'local_origin_process_start_failed' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const { port } = JSON.parse(await readFile(addressPath, 'utf8'));
      if (Number.isSafeInteger(port) && port > 0) return `http://127.0.0.1:${port}`;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw Object.assign(new Error('local_origin_start_timeout'), { code: 'local_origin_start_timeout' });
}
async function persist() { await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }); }
async function agentOperation(label, operation, grantId, profileRefs, fields = {}) {
  const key = `${prefix}-${label}`;
  const requestPath = join(requestRoot, `${label}.json`);
  await writeFile(requestPath, JSON.stringify(request(operation, key, grantId, operationScope(operation, profileRefs), fields)), { mode: 0o600 });
  return runJson(cli, ['agent', 'operation', '--client-file', join(agentHost, 'webenvoy-client.json'), '--request-file', requestPath], label);
}
function inputRequest(profileRef, snapshot, text) {
  const control = snapshot.controls?.find(item => item.role === 'textbox' && item.name === `${profileRef === profileA ? 'A' : 'B'} message` && item.enabled === true);
  assert.ok(control?.target_ref, 'message_target_missing');
  return { profile_ref: profileRef, origin, runtime_session_ref: profileRef === profileA ? sessionA : sessionB,
    page_ref: snapshot.page_ref, ...(snapshot.page_id ? { page_id: snapshot.page_id } : {}),
    ...(snapshot.document_generation ? { document_generation: snapshot.document_generation } : {}),
    observation_ref: snapshot.observation_ref, target_ref: control.target_ref, text };
}
async function observeAndSnapshot(label, profileRef, grantId, sessionRef, pageTarget) {
  const observed = await agentOperation(`${label}-observe`, 'instance.observe', grantId, [profileRef], {
    profile_ref: profileRef, origin, runtime_session_ref: sessionRef,
    ...(typeof pageTarget === 'string' ? { page_ref: pageTarget } : pageTarget?.page_id ? { page_id: pageTarget.page_id,
      ...(pageTarget.document_generation ? { document_generation: pageTarget.document_generation } : {}) } : {})
  });
  succeeded(observed, `${label}_observe`);
  const page = profilePage(observed, `${label}_observe`);
  const snapshotResult = await agentOperation(`${label}-snapshot`, 'instance.snapshot', grantId, [profileRef], {
    profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: page.page_ref,
    ...(page.page_id ? { page_id: page.page_id } : {}), ...(page.document_generation ? { document_generation: page.document_generation } : {})
  });
  succeeded(snapshotResult, `${label}_snapshot`);
  return { page, snapshot: snapshotPage(snapshotResult, `${label}_snapshot`) };
}
function pageText(value) { return typeof value?.result?.text === 'string' ? value.result.text : ''; }
function assertReceiptText(value, expected, label) { assert.ok(pageText(value).includes(expected), `${label}_receipt_mismatch`); }
function assertRefused(value, label, expectedCodes) {
  assert.equal(value?.ok, false, `${label}_unexpectedly_succeeded`);
  assert.equal(value?.dispatch_state, 'not_dispatched', `${label}_was_dispatched`);
  const code = value?.failure?.code ?? value?.error?.code;
  assert.ok(expectedCodes.includes(code), `${label}_unexpected_failure_${code ?? 'missing'}`);
  return code;
}
async function cleanupScene() {
  const cleanup = { sessions: {}, runtime: { state: runtimeStarted ? 'pending' : 'not_started' }, local_origin: { state: originProcess?.pid ? 'pending' : 'not_started' } };
  for (const [label, sessionRef, browserPid] of [['A', sessionA, browserPidA], ['B', sessionB, browserPidB]]) {
    if (!sessionRef) continue;
    try {
      const inspected = readSession(sessionRef, `cleanup_inspect_${label}`);
      const row = collectObjects(inspected, item => item.runtime_session_ref === sessionRef)[0];
      if (!row || row.lifecycle_state !== 'closed') runJson(cli, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef], `cleanup_stop_${label}`);
      if (browserPid) await waitForPid(browserPid, false, `cleanup_browser_${label}`);
      cleanup.sessions[label] = { state: row?.lifecycle_state === 'closed' ? 'already_closed' : 'stopped', original_browser_pid: browserPid ?? null,
        original_browser_pid_alive: browserPid ? pidAlive(browserPid) : null };
    } catch (error) {
      cleanup.sessions[label] = { state: 'failed', code: error?.code ?? 'cleanup_error', original_browser_pid: browserPid ?? null,
        original_browser_pid_alive: browserPid ? pidAlive(browserPid) : null };
    }
  }
  if (runtimeStarted) {
    try {
      const stopped = runJson(cli, ['stop', '--data-dir', ownerData], 'cleanup_owner_runtime_stop');
      if (harborPid) await waitForPid(harborPid, false, 'cleanup_harbor');
      cleanup.runtime = { state: 'stopped', status: stopped.status ?? 'returned', harbor_pid_alive: harborPid ? pidAlive(harborPid) : null };
    } catch (error) {
      cleanup.runtime = { state: 'failed', code: error?.code ?? 'cleanup_error', harbor_pid_alive: harborPid ? pidAlive(harborPid) : null };
    }
  }
  if (originProcess?.pid) {
    try {
      if (pidAlive(originProcess.pid)) originProcess.kill('SIGTERM');
      await waitForPid(originProcess.pid, false, 'cleanup_local_origin');
      cleanup.local_origin = { state: 'stopped', pid_alive: pidAlive(originProcess.pid) };
    } catch (error) {
      cleanup.local_origin = { state: 'failed', code: error?.code ?? 'cleanup_error', pid_alive: pidAlive(originProcess.pid) };
    }
  }
  return cleanup;
}

try {
  currentStep = 'owner_setup';
  const setup = runJson(cli, ['setup', '--data-dir', ownerData, '--agent-uid', String(ownerUid), ...providerArgs], 'owner_setup');
  assert.equal(setup.installed, true, 'owner_setup_not_installed');
  assert.deepEqual(setup.camoufox_launch, { state: 'qualified', reason: 'official_upstream' }, 'camoufox_binding_not_qualified');
  assert.equal(setup.boundary?.mode, 'trusted_local', 'trusted_local_mode_missing');
  runJson(cli, ['start', '--data-dir', ownerData], 'owner_start');
  runtimeStarted = true;
  const status = runJson(cli, ['diagnose', '--data-dir', ownerData], 'owner_diagnose');
  assert.equal(status.ready, true, 'owner_runtime_not_ready');
  harborPid = Number(status.services?.find(service => service.id === 'harbor')?.pid);
  assert.ok(Number.isSafeInteger(harborPid) && harborPid > 0, 'harbor_pid_missing');
  const managementPolicy = await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: `${prefix}-management-policy`, expected_source_version: null,
    modes: { read: 'auto', prepare: 'auto', commit: 'auto' }
  } });
  assert.equal(managementPolicy.ok, true, 'management_policy_not_set');
  currentStep = 'agent_setup';
  await mkdir(requestRoot, { recursive: true, mode: 0o700 });
  const hostSetup = runJson(cli, ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid)], 'agent_setup');
  assert.equal(hostSetup.boundary?.mode, 'trusted_local', 'agent_not_trusted_local');
  assert.equal(hostSetup.boundary?.owner_uid, ownerUid, 'agent_owner_uid_mismatch');
  assert.equal(hostSetup.boundary?.agent_uid, ownerUid, 'agent_uid_mismatch');
  const clientFile = join(agentHost, 'webenvoy-client.json');
  const registered = runJson(cli, ['access', 'register', '--data-dir', ownerData, '--display-name', `${prefix}-agent`,
    '--credential-hash', hostSetup.credential_fingerprint, '--idempotency-key', `${prefix}-register`], 'owner_register');
  const principalId = stringForKey(registered, 'principal_id', 'owner_register');

  currentStep = 'local_origin';
  origin = await startLocalOrigin();
  evidence.origin = origin;
  evidence.local_origin_pid = originProcess.pid;
  const creationGrant = {
    idempotency_key: `${prefix}-grant-create`, principal_id: principalId, profile_refs: [], allowed_operations: ['profile.create', 'profile.list', 'profile.read'],
    allowed_origins: [origin], expires_at: new Date(Date.now() + 1_800_000).toISOString(), max_created_profiles: 2,
    creation_template: { template_ref: `${prefix}-local-template`, provider_id: 'camoufox',
      site: { site_id: `${prefix}-local-site`, origin, display_name: 'No-account W2 local acceptance' }, language: 'en-US', timezone: 'UTC',
      permission_ceiling: { allowed_operations: ['profile.list', 'profile.read', 'instance.start', 'instance.observe', 'instance.snapshot',
        'instance.input', 'instance.read', 'instance.stop', 'page.list', 'page.open'], allowed_origins: [origin], controlled_interaction_origins: [origin] } }
  };
  const creationGrantPath = join(root, 'creation-grant.json');
  await writeFile(creationGrantPath, JSON.stringify(creationGrant), { mode: 0o600 });
  const createdGrant = runJson(cli, ['access', 'grant', '--data-dir', ownerData, '--grant-file', creationGrantPath], 'owner_creation_grant');
  const creationGrantId = stringForKey(createdGrant, 'grant_id', 'owner_creation_grant');
  await persist();

  currentStep = 'create_profiles';
  const createdA = await agentOperation('create-profile-a', 'profile.create', creationGrantId, [], { template_ref: `${prefix}-local-template` });
  succeeded(createdA, 'create_profile_a');
  profileA = stringForKey(createdA, 'profile_ref', 'create_profile_a');
  const createdB = await agentOperation('create-profile-b', 'profile.create', creationGrantId, [], { template_ref: `${prefix}-local-template` });
  succeeded(createdB, 'create_profile_b');
  profileB = stringForKey(createdB, 'profile_ref', 'create_profile_b');
  assert.notEqual(profileA, profileB, 'profiles_not_isolated');
  evidence.profiles = { A: profileA, B: profileB };
  runJson(cli, ['access', 'revoke', '--data-dir', ownerData, '--kind', 'grants', '--id', creationGrantId,
    '--idempotency-key', `${prefix}-revoke-create-grant`], 'revoke_creation_grant');

  currentStep = 'profile_grants';
  const profileOperations = ['profile.list', 'profile.read', 'instance.start', 'instance.observe', 'instance.snapshot',
    'instance.input', 'instance.read', 'instance.stop', 'page.list', 'page.open'];
  async function createProfileGrant(label, profileRef) {
    const path = join(root, `grant-${label}.json`);
    await writeFile(path, JSON.stringify({ idempotency_key: `${prefix}-grant-${label}`, principal_id: principalId,
      profile_refs: [profileRef], allowed_operations: profileOperations, allowed_origins: [origin],
      expires_at: new Date(Date.now() + 1_800_000).toISOString(), creation_template: null, max_created_profiles: 0 }), { mode: 0o600 });
    const grant = runJson(cli, ['access', 'grant', '--data-dir', ownerData, '--grant-file', path], `owner_grant_${label}`);
    return stringForKey(grant, 'grant_id', `owner_grant_${label}`);
  }
  const grantA = await createProfileGrant('a', profileA);
  const grantB = await createProfileGrant('b', profileB);
  runJson(cli, ['agent', 'connect', '--client-file', clientFile], 'agent_connect');
  const listA = await agentOperation('profile-list-a', 'profile.list', grantA, [profileA]);
  const listB = await agentOperation('profile-list-b', 'profile.list', grantB, [profileB]);
  succeeded(listA, 'profile_list_a'); succeeded(listB, 'profile_list_b');
  assertProfileIdentity(listA, profileA, 'profile_list_a'); assertProfileIdentity(listB, profileB, 'profile_list_b');
  const readA = await agentOperation('profile-read-a', 'profile.read', grantA, [profileA], { profile_ref: profileA });
  const readB = await agentOperation('profile-read-b', 'profile.read', grantB, [profileB], { profile_ref: profileB });
  succeeded(readA, 'profile_read_a'); succeeded(readB, 'profile_read_b');
  assertProfileIdentity(readA, profileA, 'profile_read_a'); assertProfileIdentity(readB, profileB, 'profile_read_b');
  evidence.steps.profile_list_read = 'passed';

  currentStep = 'start_instances';
  const driversBeforeA = new Set(pythonDriverPids(harborPid));
  const startedA = await agentOperation('instance-start-a', 'instance.start', grantA, [profileA], {
    profile_ref: profileA, origin, url: `${origin}/a`
  });
  succeeded(startedA, 'instance_start_a');
  sessionA = stringForKey(startedA, 'runtime_session_ref', 'instance_start_a');
  const driverA = await waitForNewDriver(driversBeforeA, harborPid, 'A');
  browserPidA = await waitForBrowserPid(driverA, 'A');
  assert.equal(pidAlive(browserPidA), true, 'A_browser_process_not_alive_after_start');
  const driversBeforeB = new Set(pythonDriverPids(harborPid));
  const startedB = await agentOperation('instance-start-b', 'instance.start', grantB, [profileB], {
    profile_ref: profileB, origin, url: `${origin}/b`
  });
  succeeded(startedB, 'instance_start_b');
  sessionB = stringForKey(startedB, 'runtime_session_ref', 'instance_start_b');
  const driverB = await waitForNewDriver(driversBeforeB, harborPid, 'B');
  browserPidB = await waitForBrowserPid(driverB, 'B');
  assert.notEqual(sessionA, sessionB, 'runtime_sessions_not_distinct');
  assert.notEqual(browserPidA, browserPidB, 'browser_processes_not_distinct');
  evidence.sessions = { A: sessionA, B: sessionB };
  evidence.browser_processes = { A: { pid: browserPidA, name: processName(browserPidA), alive: pidAlive(browserPidA) },
    B: { pid: browserPidB, name: processName(browserPidB), alive: pidAlive(browserPidB) } };
  assert.equal(evidence.browser_processes.A.name.toLowerCase().includes('camoufox'), true, 'A_process_not_camoufox');
  assert.equal(evidence.browser_processes.B.name.toLowerCase().includes('camoufox'), true, 'B_process_not_camoufox');
  const pageA = await observeAndSnapshot('a-initial', profileA, grantA, sessionA);
  const pageB = await observeAndSnapshot('b-initial', profileB, grantB, sessionB);
  assert.equal(pageA.page.current_url, `${origin}/a`, 'A_initial_page_mismatch');
  assert.equal(pageB.page.current_url, `${origin}/b`, 'B_initial_page_mismatch');
  assert.ok(pageA.page.page_id && pageB.page.page_id, 'initial_page_id_missing');
  const inputA1 = await agentOperation('input-a-before-takeover', 'instance.input', grantA, [profileA],
    inputRequest(profileA, pageA.snapshot, 'A_before_takeover'));
  const inputB1 = await agentOperation('input-b-before-takeover', 'instance.input', grantB, [profileB],
    inputRequest(profileB, pageB.snapshot, 'B_before_takeover'));
  succeeded(inputA1, 'input_a_before_takeover'); succeeded(inputB1, 'input_b_before_takeover');
  evidence.steps.initial_inputs = 'passed';

  currentStep = 'help_page_b';
  const helpOpen = await agentOperation('page-open-a-help', 'page.open', grantA, [profileA], {
    profile_ref: profileA, origin, runtime_session_ref: sessionA, url: `${origin}/help?for=A`
  });
  succeeded(helpOpen, 'page_open_a_help');
  const pageListA = await agentOperation('page-list-a', 'page.list', grantA, [profileA], { profile_ref: profileA, runtime_session_ref: sessionA });
  succeeded(pageListA, 'page_list_a');
  const listedPages = collectObjects(pageListA, item => typeof item.page_ref === 'string' && typeof item.current_url === 'string');
  const helpPage = listedPages.find(page => page.current_url.startsWith(`${origin}/help`));
  assert.ok(helpPage?.page_ref && helpPage.page_ref !== pageA.page.page_ref, 'same_instance_help_page_missing');
  const taskAPage = listedPages.find(page => page.page_id === pageA.page.page_id);
  assert.ok(taskAPage?.current_url === `${origin}/a`, 'task_page_a_changed_when_help_opened');
  const taskAPageId = pageA.page.page_id;
  const oldA = await observeAndSnapshot('a-before-takeover', profileA, grantA, sessionA,
    { page_id: taskAPageId, ...(pageA.page.document_generation ? { document_generation: pageA.page.document_generation } : {}) });
  assert.equal(oldA.page.page_id, taskAPageId, 'task_page_a_identity_changed');
  evidence.help_page = { state: 'verified', profile_ref: profileA, task_page_id: taskAPageId,
    task_page_ref: oldA.page.page_ref, helper_page_ref: helpPage.page_ref };

  currentStep = 'owner_list_inspect';
  const beforeList = instanceList('owner_list_before_takeover');
  const beforeRows = listSessions(beforeList);
  assert.equal(beforeRows.length, 2, 'owner_instance_list_count_mismatch');
  expectSession(beforeList, profileA, sessionA, 'owner_list_a');
  const beforeB = expectSession(beforeList, profileB, sessionB, 'owner_list_b');
  const inspectA = readSession(sessionA, 'owner_inspect_a_before_takeover');
  const inspectB = readSession(sessionB, 'owner_inspect_b_before_takeover');
  expectSession(inspectA, profileA, sessionA, 'owner_inspect_a');
  expectSession(inspectB, profileB, sessionB, 'owner_inspect_b');
  evidence.steps.owner_list_inspect = 'passed';
  evidence.owner_identity = { A: { profile_ref: profileA, runtime_session_ref: sessionA,
    identity_environment_ref: stringForKey(inspectA, 'identity_environment_ref', 'inspect_a'),
    provider_ref: stringForKey(inspectA, 'provider_ref', 'inspect_a') },
    B: { profile_ref: profileB, runtime_session_ref: sessionB,
      identity_environment_ref: stringForKey(inspectB, 'identity_environment_ref', 'inspect_b'),
      provider_ref: stringForKey(inspectB, 'provider_ref', 'inspect_b') } };

  currentStep = 'takeover_a';
  const takeover = runJson(cli, ['instance', 'takeover', '--data-dir', ownerData, '--runtime-session-ref', sessionA], 'takeover_a');
  assert.equal(takeover.control_owner, 'user', 'A_takeover_not_user');
  assert.equal(takeover.control_lock?.owner, 'user', 'A_takeover_lock_owner_mismatch');
  assert.equal(takeover.control_lock?.state, 'held', 'A_takeover_lock_not_held');
  assert.ok(Number.isSafeInteger(takeover.control_generation), 'A_takeover_generation_missing');
  const inspectAAfterTakeover = readSession(sessionA, 'owner_inspect_a_after_takeover');
  const userHeldA = expectSession(inspectAAfterTakeover, profileA, sessionA, 'owner_inspect_a_after_takeover');
  assert.equal(userHeldA.control_owner, 'user', 'A_user_lease_did_not_persist_after_cli_exit');
  assert.equal(userHeldA.control_lock?.owner, 'user', 'A_user_lock_did_not_persist_after_cli_exit');
  assert.equal(userHeldA.control_lock?.state, 'held', 'A_user_lock_not_held_after_cli_exit');
  const takeoverInput = request('instance.input', `${prefix}-input-a-during-takeover`, grantA, operationScope('instance.input', [profileA]),
    inputRequest(profileA, oldA.snapshot, 'A_must_be_refused'));
  await writeFile(join(requestRoot, 'input-a-during-takeover.json'), JSON.stringify(takeoverInput), { mode: 0o600 });
  const refusedA = allowJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', join(requestRoot, 'input-a-during-takeover.json')], 'input_a_after_takeover');
  const takeoverFailure = assertRefused(refusedA, 'A_input_during_user_lease', ['control_lock_conflict']);
  const duringList = instanceList('owner_list_during_takeover');
  const duringB = expectSession(duringList, profileB, sessionB, 'owner_list_b_during_takeover');
  assert.equal(duringB.control_owner, beforeB.control_owner, 'B_control_owner_changed_during_A_takeover');
  assert.equal(duringB.control_generation, beforeB.control_generation, 'B_generation_changed_during_A_takeover');
  assert.equal(pidAlive(browserPidB), true, 'B_original_process_lost_during_A_takeover');
  const bDuring = await observeAndSnapshot('b-during-a-takeover', profileB, grantB, sessionB,
    { page_id: pageB.page.page_id, ...(pageB.page.document_generation ? { document_generation: pageB.page.document_generation } : {}) });
  const inputB2 = await agentOperation('input-b-during-a-takeover', 'instance.input', grantB, [profileB],
    inputRequest(profileB, bDuring.snapshot, 'B_while_A_user_held'));
  succeeded(inputB2, 'input_b_during_a_takeover');
  evidence.steps.takeover_a_blocks_a_b_works = 'passed';
  evidence.takeover = { state: 'verified', controller: 'owner_cli', owner_cli_exited: true,
    denied_code: takeoverFailure, denied_dispatch_state: refusedA.dispatch_state,
    user_control_generation: userHeldA.control_generation };

  currentStep = 'handback_a';
  const handback = runJson(cli, ['instance', 'handback', '--data-dir', ownerData, '--runtime-session-ref', sessionA], 'handback_a');
  assert.equal(handback.runtime_session_ref, sessionA, 'handback_session_mismatch');
  assert.equal(handback.control_owner, 'none', 'A_handback_control_owner_not_released');
  assert.equal(handback.control_lock?.owner, 'none', 'A_handback_lock_owner_not_released');
  assert.equal(handback.control_lock?.state, 'released', 'A_handback_lock_not_released');
  const staleInput = request('instance.input', `${prefix}-input-a-stale-after-handback`, grantA,
    operationScope('instance.input', [profileA]), inputRequest(profileA, oldA.snapshot, 'A_stale_must_be_refused'));
  const stalePath = join(requestRoot, 'input-a-stale-after-handback.json');
  await writeFile(stalePath, JSON.stringify(staleInput), { mode: 0o600 });
  const stale = allowJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', stalePath], 'input_a_stale_after_handback');
  const staleFailure = assertRefused(stale, 'A_old_observation_after_handback', ['control_lock_conflict', 'managed_interaction_observation_stale']);
  const freshA = await observeAndSnapshot('a-after-handback', profileA, grantA, sessionA,
    { page_id: taskAPageId, ...(pageA.page.document_generation ? { document_generation: pageA.page.document_generation } : {}) });
  assert.equal(freshA.page.page_id, taskAPageId, 'A_fresh_observation_followed_helper_page');
  assert.notEqual(freshA.page.page_ref, oldA.page.page_ref, 'A_fresh_observation_ref_not_rotated');
  assert.equal(freshA.page.current_url, `${origin}/a`, 'A_fresh_observation_not_task_page');
  const inputA2 = await agentOperation('input-a-after-handback', 'instance.input', grantA, [profileA],
    inputRequest(profileA, freshA.snapshot, 'A_after_handback'));
  succeeded(inputA2, 'input_a_after_handback');
  const readAAfterHandback = await agentOperation('read-a-after-handback', 'instance.read', grantA, [profileA], {
    profile_ref: profileA, origin, runtime_session_ref: sessionA, page_ref: freshA.page.page_ref,
    ...(freshA.page.page_id ? { page_id: freshA.page.page_id } : {}), ...(freshA.page.document_generation ? { document_generation: freshA.page.document_generation } : {})
  });
  succeeded(readAAfterHandback, 'read_a_after_handback');
  assertReceiptText(readAAfterHandback, 'A inputs=2; value=A_after_handback', 'A_after_handback');
  const afterHandbackList = instanceList('owner_list_after_handback');
  const afterHandbackB = expectSession(afterHandbackList, profileB, sessionB, 'owner_list_b_after_handback');
  assert.equal(afterHandbackB.control_generation, beforeB.control_generation, 'B_generation_changed_during_A_handback');
  assert.equal(afterHandbackB.control_owner, beforeB.control_owner, 'B_control_owner_changed_during_A_handback');
  evidence.steps.handback_stale_refused_fresh_a_works = 'passed';
  evidence.handback = { state: 'verified', stale_input_code: staleFailure,
    fresh_snapshot_observation_ref: freshA.snapshot.observation_ref, task_page_id: taskAPageId,
    old_page_ref: oldA.page.page_ref, fresh_page_ref: freshA.page.page_ref,
    help_page_ref: helpPage.page_ref };

  currentStep = 'ui_pause';
  evidence.steps.ui_pause = holdBeforeStopMs ? 'running' : 'skipped';
  evidence.browser_processes.A.alive = pidAlive(browserPidA);
  evidence.browser_processes.B.alive = pidAlive(browserPidB);
  await persist();
  if (holdBeforeStopMs) {
    console.log(JSON.stringify({ state: 'ui_pause', hold_ms: holdBeforeStopMs, root, evidence: evidencePath,
      profile_refs: evidence.profiles, runtime_session_refs: evidence.sessions, browser_processes: evidence.browser_processes }));
    await new Promise(resolveWait => setTimeout(resolveWait, holdBeforeStopMs));
    evidence.steps.ui_pause = 'elapsed';
  }

  currentStep = 'query_revoke_stop_a';
  const queryAStart = runJson(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', `${prefix}-instance-start-a`], 'query_a_start');
  const queryAInput = runJson(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', `${prefix}-input-a-after-handback`], 'query_a_input');
  const queryBInput = runJson(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', `${prefix}-input-b-during-a-takeover`], 'query_b_input');
  assert.equal(queryAStart.run_id, startedA.run_id, 'A_start_query_run_changed');
  assert.equal(queryAInput.run_id, inputA2.run_id, 'A_input_query_run_changed');
  assert.equal(queryBInput.run_id, inputB2.run_id, 'B_input_query_run_changed');
  const readAAfterQueries = await agentOperation('read-a-after-run-queries', 'instance.read', grantA, [profileA], {
    profile_ref: profileA, origin, runtime_session_ref: sessionA, page_ref: freshA.page.page_ref,
    ...(freshA.page.page_id ? { page_id: freshA.page.page_id } : {}), ...(freshA.page.document_generation ? { document_generation: freshA.page.document_generation } : {})
  });
  const readBAfterQueries = await agentOperation('read-b-after-run-queries', 'instance.read', grantB, [profileB], {
    profile_ref: profileB, origin, runtime_session_ref: sessionB, page_ref: bDuring.page.page_ref,
    ...(bDuring.page.page_id ? { page_id: bDuring.page.page_id } : {}), ...(bDuring.page.document_generation ? { document_generation: bDuring.page.document_generation } : {})
  });
  succeeded(readAAfterQueries, 'read_a_after_run_queries');
  succeeded(readBAfterQueries, 'read_b_after_run_queries');
  assertReceiptText(readAAfterQueries, 'A inputs=2; value=A_after_handback', 'A_query_does_not_replay');
  assertReceiptText(readBAfterQueries, 'B inputs=2; value=B_while_A_user_held', 'B_query_does_not_replay');
  evidence.steps.run_queries_do_not_replay = 'passed';
  runJson(cli, ['access', 'revoke', '--data-dir', ownerData, '--kind', 'grants', '--id', grantA,
    '--idempotency-key', `${prefix}-revoke-grant-a`], 'owner_revoke_grant_a');
  const revokedObserve = request('instance.observe', `${prefix}-observe-a-after-grant-revoke`, grantA,
    operationScope('instance.observe', [profileA]), { profile_ref: profileA, origin, runtime_session_ref: sessionA,
      page_id: taskAPageId, ...(freshA.page.document_generation ? { document_generation: freshA.page.document_generation } : {}) });
  const revokedObservePath = join(requestRoot, 'observe-a-after-grant-revoke.json');
  await writeFile(revokedObservePath, JSON.stringify(revokedObserve), { mode: 0o600 });
  const revokedObserveResult = allowJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', revokedObservePath], 'observe_a_after_grant_revoke');
  const revokedObserveFailure = assertRefused(revokedObserveResult, 'A_observe_after_grant_revoke', ['managed_access_grant_unavailable']);
  evidence.steps.revoke_a_blocks_new_request = 'passed';
  evidence.revoke_a = { state: 'verified', denied_operation: 'instance.observe', denied_code: revokedObserveFailure,
    denied_dispatch_state: revokedObserveResult.dispatch_state };
  const preStopList = instanceList('owner_list_before_stop_a');
  const preStopA = expectSession(preStopList, profileA, sessionA, 'owner_list_a_before_stop');
  const preStopB = expectSession(preStopList, profileB, sessionB, 'owner_list_b_before_stop');
  assert.equal(preStopA.lifecycle_state, 'locked', 'A_not_locked_after_grant_revoke');
  assert.equal(preStopB.lifecycle_state, 'active', 'B_not_active_before_stop');
  assert.equal(pidAlive(browserPidA), true, 'A_browser_process_missing_before_stop');
  assert.equal(pidAlive(browserPidB), true, 'B_browser_process_missing_before_stop');
  const stoppedA = runJson(cli, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionA], 'owner_stop_a');
  await waitForPid(browserPidA, false, 'A_browser');
  await waitForPid(browserPidB, true, 'B_browser');
  const stoppedInspectA = readSession(sessionA, 'owner_inspect_a_after_stop');
  const stoppedAInfo = collectObjects(stoppedInspectA, item => item.runtime_session_ref === sessionA)[0];
  assert.ok(stoppedAInfo, 'A_stop_inspect_missing');
  assert.equal(stoppedAInfo.lifecycle_state, 'closed', 'A_instance_not_closed_after_stop');
  const afterStopList = instanceList('owner_list_after_stop_a');
  const remainingRows = listSessions(afterStopList);
  assert.ok(remainingRows.some(item => item.runtime_session_ref === sessionB && item.profile_ref === profileB), 'B_session_disappeared_after_A_stop');
  assert.ok(!remainingRows.some(item => item.runtime_session_ref === sessionA && item.lifecycle_state !== 'closed'), 'A_still_listed_active_after_stop');
  const afterStopB = expectSession(afterStopList, profileB, sessionB, 'owner_list_b_after_stop_a');
  assert.equal(afterStopB.lifecycle_state, 'active', 'B_session_not_active_after_A_stop');
  assert.equal(afterStopB.control_generation, preStopB.control_generation, 'B_generation_changed_after_A_stop');
  assert.equal(afterStopB.control_owner, preStopB.control_owner, 'B_control_owner_changed_after_A_stop');
  const liveB = await observeAndSnapshot('b-after-a-stop', profileB, grantB, sessionB,
    { page_id: pageB.page.page_id, ...(pageB.page.document_generation ? { document_generation: pageB.page.document_generation } : {}) });
  const inputB3 = await agentOperation('input-b-after-a-stop', 'instance.input', grantB, [profileB],
    inputRequest(profileB, liveB.snapshot, 'B_after_A_stop_and_revoke'));
  succeeded(inputB3, 'input_b_after_a_stop');
  const readBAfterStop = await agentOperation('read-b-after-a-stop', 'instance.read', grantB, [profileB], {
    profile_ref: profileB, origin, runtime_session_ref: sessionB, page_ref: liveB.page.page_ref,
    ...(liveB.page.page_id ? { page_id: liveB.page.page_id } : {}), ...(liveB.page.document_generation ? { document_generation: liveB.page.document_generation } : {})
  });
  succeeded(readBAfterStop, 'read_b_after_a_stop');
  assertReceiptText(readBAfterStop, 'B inputs=3; value=B_after_A_stop_and_revoke', 'B_after_A_stop');
  const queryBAfterStop = runJson(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', `${prefix}-input-b-after-a-stop`], 'query_b_after_stop_a');
  assert.equal(queryBAfterStop.run_id, inputB3.run_id, 'B_after_stop_query_run_changed');
  const readBAfterStopQuery = await agentOperation('read-b-after-stop-query', 'instance.read', grantB, [profileB], {
    profile_ref: profileB, origin, runtime_session_ref: sessionB, page_ref: liveB.page.page_ref,
    ...(liveB.page.page_id ? { page_id: liveB.page.page_id } : {}), ...(liveB.page.document_generation ? { document_generation: liveB.page.document_generation } : {})
  });
  succeeded(readBAfterStopQuery, 'read_b_after_stop_query');
  assertReceiptText(readBAfterStopQuery, 'B inputs=3; value=B_after_A_stop_and_revoke', 'B_stop_query_does_not_replay');
  const finalList = instanceList('owner_list_final');
  assert.ok(!listSessions(finalList).some(item => item.runtime_session_ref === sessionA), 'A_closed_session_still_listed');
  const finalB = expectSession(finalList, profileB, sessionB, 'owner_list_b_final');
  assert.equal(finalB.lifecycle_state, 'active', 'B_final_state_not_active');
  assert.equal(pidAlive(browserPidA), false, 'A_browser_process_still_alive');
  assert.equal(pidAlive(browserPidB), true, 'B_original_browser_process_not_alive');
  evidence.browser_processes.A.alive_after_stop = false;
  evidence.browser_processes.B.alive_after_stop = true;
  evidence.steps.stop_a_ends_original_process_and_b_continues = 'passed';
  evidence.steps.query_revoke_stop_a_b_continues = 'passed';
  evidence.runs = { A_start: startedA.run_id, A_first_input: inputA1.run_id, A_after_handback: inputA2.run_id,
    B_first_input: inputB1.run_id, B_during_A_takeover: inputB2.run_id, B_after_A_stop: inputB3.run_id,
    queried_A_start: queryAStart.run_id, queried_A_input: queryAInput.run_id, queried_B_input: queryBInput.run_id,
    queried_B_after_A_stop: queryBAfterStop.run_id };
  evidence.stop_a = { state: 'verified', runtime_session_ref: sessionA, status: stoppedA.status ?? 'returned',
    original_browser_pid: browserPidA, original_browser_pid_exited: true,
    B_runtime_session_ref: sessionB, B_original_browser_pid: browserPidB, B_original_browser_pid_alive: true,
    B_input_after_A_stop_and_A_grant_revoke_run_id: inputB3.run_id };
  evidence.state = 'checks_passed';
  evidence.completed_at = new Date().toISOString();
  await persist();
  currentStep = 'cleanup';
  evidence.cleanup = await cleanupScene();
  assert.equal(evidence.cleanup.sessions.B?.state, 'stopped', 'B_cleanup_not_stopped');
  assert.equal(evidence.cleanup.sessions.B?.original_browser_pid_alive, false, 'B_original_process_alive_after_cleanup');
  assert.equal(evidence.cleanup.runtime.state, 'stopped', 'owner_runtime_cleanup_failed');
  assert.equal(evidence.cleanup.runtime.harbor_pid_alive, false, 'harbor_process_alive_after_cleanup');
  assert.equal(evidence.cleanup.local_origin.state, 'stopped', 'local_origin_cleanup_failed');
  assert.equal(evidence.cleanup.local_origin.pid_alive, false, 'local_origin_process_alive_after_cleanup');
  evidence.state = 'passed';
  await persist();
  console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }));
} catch (error) {
  evidence.state = 'failed';
  evidence.failed_step = currentStep;
  evidence.failure_code = typeof error?.code === 'string' ? error.code : error?.name === 'AssertionError' ? 'assertion_failed' : 'unexpected_error';
  evidence.failure = error?.message ?? 'unknown_failure';
  if (profileA) evidence.profiles = { ...(evidence.profiles ?? {}), A: profileA };
  if (profileB) evidence.profiles = { ...(evidence.profiles ?? {}), B: profileB };
  if (sessionA) evidence.sessions = { ...(evidence.sessions ?? {}), A: sessionA };
  if (sessionB) evidence.sessions = { ...(evidence.sessions ?? {}), B: sessionB };
  if (browserPidA) evidence.browser_processes = { ...(evidence.browser_processes ?? {}), A: { pid: browserPidA, alive: pidAlive(browserPidA) } };
  if (browserPidB) evidence.browser_processes = { ...(evidence.browser_processes ?? {}), B: { pid: browserPidB, alive: pidAlive(browserPidB) } };
  evidence.failed_at = new Date().toISOString();
  await persist().catch(() => {});
  evidence.cleanup = await cleanupScene();
  await persist().catch(() => {});
  console.error(JSON.stringify({ state: 'failed', step: currentStep, code: evidence.failure_code, failure: evidence.failure,
    root, evidence: evidencePath, profile_refs: evidence.profiles ?? null, runtime_session_refs: evidence.sessions ?? null,
    browser_processes: evidence.browser_processes ?? null, cleanup: evidence.cleanup }));
  process.exitCode = 1;
}
