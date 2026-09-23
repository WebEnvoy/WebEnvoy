import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fixtureForPath, fixtureSha256 } from './standalone-observation-cost-diagnostic.mjs';

const normalCounts = [32, 128, 160];
const repeatsPerCount = 3;
const operationTimeoutMs = 120_000; // Client wait only; Harbor keeps its existing 60 s provider-operation timeout.
const liveBudgetMs = 15 * 60_000;
const fixtureSummary = pathname => {
  const fixture = fixtureForPath(pathname);
  assert.ok(fixture, `fixture_missing:${pathname}`);
  return { controls: pathname === '/stress' ? 800 : Number(pathname.split('/').at(-1)),
    html_bytes: Buffer.byteLength(fixture.html), sha256: fixtureSha256(fixture.html) };
};

function outcome(parsed, exitCode, error, mutation = false) {
  const states = [parsed?.status, parsed?.result?.status, parsed?.run?.status];
  if (exitCode === 6 || states.includes('unknown_outcome') || parsed?.dispatch_state === 'possibly_dispatched' ||
      /TIMEOUT|ETIMEDOUT|timed out/i.test(String(error ?? ''))) return 'unknown';
  if (mutation && (error || !parsed)) return 'unknown';
  if (!error && parsed?.ok === true && parsed?.status === 'succeeded') return 'completed';
  return 'failed';
}

function parseJson(stdout, stderr) {
  for (const line of `${stdout ?? ''}\n${stderr ?? ''}`.trim().split('\n').reverse()) {
    try { return JSON.parse(line); } catch {}
  }
  return null;
}

function valueForKey(value, key) {
  if (Array.isArray(value)) {
    for (const item of value) { const found = valueForKey(item, key); if (found !== undefined) return found; }
  } else if (value && typeof value === 'object') {
    if (typeof value[key] === 'string') return value[key];
    for (const child of Object.values(value)) { const found = valueForKey(child, key); if (found !== undefined) return found; }
  }
  return undefined;
}

function sampleFrom(value) { return value?.result?.snapshot; }
function pageFrom(value) { return value?.result?.observation?.page; }
function succeeded(value) { return value?.ok === true && value?.status === 'succeeded'; }
function failureCode(value) { return value?.failure?.code ?? value?.failure?.failure_class ?? value?.failure_code ?? value?.failure_class ?? value?.error?.code ?? null; }
function fingerprint(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }

if (process.argv.at(-1) === '--self-check') {
  for (const count of normalCounts) {
    const fixture = fixtureForPath(`/controls/${count}`);
    assert.ok(fixture);
    assert.equal([...fixture.html.matchAll(/<input /g)].length, count);
    assert.equal(fixtureSummary(`/controls/${count}`).controls, count);
  }
  const stress = fixtureForPath('/stress');
  assert.ok(stress);
  assert.equal([...stress.html.matchAll(/<input /g)].length, 800);
  assert.ok(stress.html.includes('名'.repeat(256)) && stress.html.includes('说明'.repeat(128)));
  assert.equal(outcome({ ok: false, status: 'unknown_outcome' }, 6, false), 'unknown');
  assert.equal(outcome({ ok: true, status: 'succeeded' }, 0, false), 'completed');
  assert.equal(outcome(null, null, true), 'failed');
  assert.equal(outcome(null, null, 'ETIMEDOUT'), 'unknown');
  assert.equal(outcome(null, null, 'ECONNRESET', true), 'unknown');
  assert.ok(parseJson('{"ok":true}', '')?.ok);
  process.stdout.write('observation-cost-check-self-check-passed\n');
  process.exit(0);
}

if (process.argv.at(-1) === '--storage-check') {
  const { createFileRunRecordStore } = await import('../../../packages/core/dist/run-record-store.js');
  const { completeRunWithResult } = await import('../../../packages/core/dist/result-envelope.js');
  const directory = await mkdtemp('/tmp/webenvoy-556-summary-check-');
  const store = createFileRunRecordStore({ directory });
  const results = [];
  for (const bytes of [32_000, 260_000]) {
    const runId = `measurement-${bytes}`;
    await store.createRunRecord({ run_id: runId, task_intent_ref: 'intent:measurement', capability_ref: 'capability:measurement', status: 'running', admission: { decision: 'accepted', action_risk: 'read' }, evidence_refs: ['evidence:synthetic'] });
    const result = { snapshot: { text: 'x'.repeat(bytes) } };
    let error = null;
    try {
      await completeRunWithResult(store, runId, { result_ref: 'result:measurement', result_kind: 'managed_browser_operation', data: result, persisted_public_summary: { result } });
    } catch (caught) { error = caught.message; }
    assert.equal(error, bytes > 65_536 ? 'public_result_summary exceeds 64 KiB' : null);
    results.push({ synthetic_text_bytes: bytes, summary_bytes: Buffer.byteLength(JSON.stringify({ result })), error });
  }
  console.log(JSON.stringify({ kind: 'offline_Core_summary_boundary_only_not_browser_replay', results }));
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) throw new Error('usage: standalone-observation-cost-check.mjs <standalone-package> <camoufox-materials-pointer> [evidence-output]');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('observation_cost_requires_macos_arm64');
const sourcePackageRoot = resolve(args[0]);
const materialsPointer = resolve(args[1]);
const evidenceOutput = resolve(args[2] ?? `/tmp/webenvoy-observation-cost-556-${Date.now()}.json`);
const root = await mkdtemp('/tmp/webenvoy-observation-cost-556-');
await chmod(root, 0o700);
const packageRoot = join(root, 'package');
await cp(sourcePackageRoot, packageRoot, { recursive: true, errorOnExist: true });
const ownerData = join(root, 'owner-data');
const agentHost = join(root, 'agent-host');
const requestRoot = join(agentHost, 'requests');
const addressPath = join(root, 'fixture-address.json');
const prefix = basename(root);
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');

const manifestBytes = await readFile(join(packageRoot, 'agent-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const versionResult = spawnSync(cli, ['--version'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } });
if (versionResult.status !== 0) throw new Error('standalone_package_version_failed');
const version = JSON.parse(versionResult.stdout.trim());
assert.equal(version.integrity, 'verified', 'standalone_package_integrity_unverified');
const versionDigest = createHash('sha256').update(manifestBytes).digest('hex');

const materialsText = (await readFile(materialsPointer, 'utf8')).trim();
if (!materialsText || materialsText.includes('\n')) throw new Error('camoufox_materials_pointer_invalid');
const materialsRoot = resolve(materialsText);
const browserRoot = join(materialsRoot, 'browser', 'Camoufox.app');
const browserExecutable = join(browserRoot, 'Contents/MacOS/camoufox');
const pythonPath = join(materialsRoot, 'venv/bin/python');
const { CAMOUFOX_UPSTREAM_PINS, verifyCamoufoxUpstreamInstall } = await import(pathToFileURL(join(packageRoot, 'agent-entry/provider-artifact.mjs')).href);
const provider = await verifyCamoufoxUpstreamInstall({
  provider: 'camoufox', browser_install_root: browserRoot, browser_executable: browserExecutable, python_path: pythonPath,
  browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version,
  browser_source_path: join(materialsRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
  camoufox_source_path: join(materialsRoot, 'camoufox-0.5.6-py3-none-any.whl'),
  playwright_source_path: join(materialsRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')
});
const providerArgs = [
  '--browser-install-root', browserRoot, '--browser-executable', browserExecutable, '--python-path', pythonPath,
  '--browser-version', provider.browser_version, '--camoufox-version', provider.camoufox_version,
  '--playwright-version', provider.playwright_version,
  '--browser-source-path', provider.sources.browser.path, '--camoufox-source-path', provider.sources.camoufox.path,
  '--playwright-source-path', provider.sources.playwright.path
];

let origin;
let originProcess;
let runtimeStarted = false;
let runtimeStartAttempted = false;
let currentSession = null;
let liveDeadline = null;
const calls = [];
const samples = [];
const evidence = {
  schema: 'webenvoy.observation-cost-556-cli/v1', state: 'preflight', candidate: manifest.workspace?.commit ?? null,
  standalone_integrity: version.integrity, package_manifest_sha256: versionDigest,
  platform: `${process.platform}-${process.arch}`, provider: {
    provider_id: 'webenvoy.camoufox-upstream/v1', source: 'owner_verified_upstream',
    camoufox_version: provider.camoufox_version, browser_version: provider.browser_version,
    playwright_version: provider.playwright_version, properties_sha256: provider.properties_sha256,
    source_sha256: provider.source_sha256
  },
  scope: 'dedicated no-account profile; static 127.0.0.1 fixture; no external resources or site skill',
  measurement: 'CLI command wall includes CLI start/local handling/output; caller JSON parse and request write are measured separately, not IPC or provider-only time',
  limits: { max_profiles: 1, simultaneous_instances: 1, per_operation_timeout_ms: operationTimeoutMs,
    provider_operation_timeout_ms: 60_000, live_budget_ms: liveBudgetMs, ordinary_repeats_per_count: repeatsPerCount,
    counts: normalCounts, pressure_count: 800, max_pressure_segments: 16 },
  fixtures: [...normalCounts.map(count => ({ path: `/controls/${count}`, ...fixtureSummary(`/controls/${count}`) })),
    { path: '/stress', ...fixtureSummary('/stress') }],
  cli_calls: calls, samples, chrome: { status: 'not_evaluated', reason: 'fixed Chrome 153.0.8010.37 materials unavailable; .53 not adopted' }
};
const persist = async () => writeFile(join(root, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
let persistence = Promise.resolve();
const persistSoon = () => { persistence = persistence.then(persist).catch(() => {}); return persistence; };
const grants = new Set();

function ensureBudget() {
  if (liveDeadline !== null && Date.now() >= liveDeadline) throw Object.assign(new Error('live_budget_exhausted'), { code: 'live_budget_exhausted' });
}

function runCommand(label, commandArgs, { mutation = false, requestBytes = null, serializationMs = null, operation = null, cleanup = false } = {}) {
  if (!cleanup) ensureBudget();
  const started = performance.now();
  const result = spawnSync(cli, commandArgs, { cwd: packageRoot, encoding: 'utf8', timeout: operationTimeoutMs,
    env: { ...process.env, LC_ALL: 'C' } });
  const wallMs = performance.now() - started;
  const parseStart = performance.now();
  const parsed = parseJson(result.stdout, result.stderr);
  const parseMs = performance.now() - parseStart;
  const entry = {
    label, ...(operation ? { operation } : {}), command: commandArgs.slice(0, 2).join(' '),
    wall_ms: Number(wallMs.toFixed(3)), request_bytes: requestBytes,
    request_serialize_ms: serializationMs === null ? null : Number(serializationMs.toFixed(3)),
    stdout_bytes: Buffer.byteLength(result.stdout ?? ''), stderr_bytes: Buffer.byteLength(result.stderr ?? ''),
    output_parse_ms: Number(parseMs.toFixed(3)), exit_code: result.status ?? null, signal: result.signal ?? null,
    failure_code: failureCode(parsed), dispatch_state: parsed?.dispatch_state ?? null,
    result_status: parsed?.status ?? parsed?.result?.status ?? parsed?.run?.status ?? null,
    mutation, timeout: result.error?.code === 'ETIMEDOUT' || /timed out/i.test(String(result.error?.message ?? '')),
    outcome: operation || (commandArgs[0] === 'agent' && commandArgs[1] === 'query') ? outcome(parsed, result.status, result.error?.code ?? result.error?.message ?? null, mutation)
      : !result.error && result.status === 0 && parsed && parsed.ok !== false ? 'completed' : 'failed'
  };
  calls.push(entry);
  persistSoon();
  return { result, parsed, entry };
}

function runOwnerJson(label, commandArgs) {
  const called = runCommand(label, commandArgs);
  if (called.result.error || called.result.status !== 0 || !called.parsed) throw Object.assign(new Error(label), { code: called.result.error?.code ?? called.entry.failure_code ?? `${label}_failed` });
  return called.parsed;
}

function runAgentOperation(label, operation, grantId, profileRef, fields = {}) {
  const key = `${prefix}-${label}`;
  const requestBody = { idempotency_key: key, grant_id: grantId, operation,
    task_scope: { operations: [operation], profile_refs: profileRef ? [profileRef] : [], origins: origin ? [origin] : [] }, ...fields };
  const serialStart = performance.now();
  const serialized = JSON.stringify(requestBody);
  const serializationMs = performance.now() - serialStart;
  const requestPath = join(requestRoot, `${label}.json`);
  const requestBytes = Buffer.byteLength(serialized);
  const started = performance.now();
  writeFileSync(requestPath, serialized, { mode: 0o600 });
  const writeMs = performance.now() - started;
  const called = runCommand(label, ['agent', 'operation', '--client-file', join(agentHost, 'webenvoy-client.json'), '--request-file', requestPath], {
    mutation: ['instance.start', 'instance.input', 'profile.create'].includes(operation), requestBytes, serializationMs, operation
  });
  called.entry.request_file_write_ms = Number(writeMs.toFixed(3));
  called.entry.key_fingerprint = fingerprint(key);
  persistSoon();
  return { ...called, key };
}

function queryOriginalRun(label, key) {
  const called = runCommand(`${label}-original-run-query`, ['agent', 'query', '--client-file', join(agentHost, 'webenvoy-client.json'), '--idempotency-key', key]);
  called.entry.key_fingerprint = fingerprint(key);
  return called;
}

function assertSucceeded(value, label) {
  assert.ok(succeeded(value), `${label}_not_succeeded:${failureCode(value) ?? 'unknown'}`);
}

async function startFixtureServer() {
  const helperUrl = new URL('./standalone-observation-cost-diagnostic.mjs', import.meta.url).href;
  const serverSource = `
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
const { fixtureForPath } = await import(${JSON.stringify(helperUrl)});
const addressPath = ${JSON.stringify(addressPath)};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const fixture = fixtureForPath(path);
  if (request.method !== 'GET' || !fixture) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': \"default-src 'none'; form-action 'none'; style-src 'unsafe-inline'\" });
  response.end(fixture.html);
});
server.listen(0, '127.0.0.1', async () => { const address = server.address(); await writeFile(addressPath, JSON.stringify({ port: address.port }), { mode: 0o600 }); });
const stop = () => server.close(() => process.exit(0)); process.once('SIGTERM', stop); process.once('SIGINT', stop);
`;
  originProcess = spawn(fixedNode, ['--input-type=module', '-e', serverSource], { cwd: packageRoot, detached: true,
    stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } });
  originProcess.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const { port } = JSON.parse(await readFile(addressPath, 'utf8'));
      if (Number.isSafeInteger(port) && port > 0) return `http://127.0.0.1:${port}`;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('fixture_server_start_timeout');
}

async function cleanup() {
  const result = { instance: 'not_active', grants: 'not_created', runtime: 'not_started', fixture: 'not_started' };
  if (currentSession) {
    try {
      const stopped = runCommand('cleanup-instance-stop', ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', currentSession], { cleanup: true });
      result.instance = stopped.result.status === 0 ? 'stopped' : 'stop_failed';
    } catch { result.instance = 'stop_failed'; }
    currentSession = null;
  }
  for (const id of grants) {
    try {
      const revoked = runCommand(`cleanup-grant-${fingerprint(id)}`, ['access', 'revoke', '--data-dir', ownerData,
        '--kind', 'grants', '--id', id, '--idempotency-key', `${prefix}-cleanup-${fingerprint(id)}`], { cleanup: true });
      result.grants = revoked.result.status === 0 ? 'revoked' : 'revoke_failed';
      if (revoked.result.status !== 0) break;
    } catch { result.grants = 'revoke_failed'; break; }
  }
  if (runtimeStarted || runtimeStartAttempted) {
    try {
      const stopped = runCommand('cleanup-runtime-stop', ['stop', '--data-dir', ownerData], { cleanup: true });
      result.runtime = stopped.result.status === 0 ? 'stopped' : 'stop_failed';
      runtimeStarted = false;
    } catch { result.runtime = 'stop_failed'; }
  }
  if (originProcess?.pid) {
    try {
      try { process.kill(originProcess.pid, 0); originProcess.kill('SIGTERM'); } catch {}
      const deadline = Date.now() + 5000;
      result.fixture = 'stop_failed';
      while (Date.now() < deadline) {
        try { process.kill(originProcess.pid, 0); } catch { result.fixture = 'stopped'; break; }
        await new Promise(done => setTimeout(done, 100));
      }
    } catch { result.fixture = 'stop_failed'; }
  }
  return result;
}

async function main() {
  if (manifest.workspace?.commit !== '5bfb19347ea1dd4079d4d9524686deedc5f2d872') throw new Error('candidate_commit_mismatch');
  await mkdir(requestRoot, { recursive: true, mode: 0o700 });
  const setup = runOwnerJson('owner-setup', ['setup', '--data-dir', ownerData, '--agent-uid', String(ownerUid), ...providerArgs]);
  assert.equal(setup.installed, true, 'owner_not_installed');
  assert.deepEqual(setup.camoufox_launch, { state: 'qualified', reason: 'official_upstream' }, 'camoufox_not_qualified');
  assert.equal(setup.boundary?.mode, 'trusted_local', 'trusted_local_boundary_missing');
  runtimeStartAttempted = true;
  const runtime = runOwnerJson('runtime-start', ['start', '--data-dir', ownerData]);
  runtimeStarted = runtime.status === 'started' || runtime.ready === true;
  const diagnosed = runOwnerJson('runtime-diagnose', ['diagnose', '--data-dir', ownerData]);
  assert.equal(diagnosed.ready, true, 'runtime_not_ready');

  const setupHost = runOwnerJson('agent-host-setup', ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid)]);
  assert.equal(setupHost.boundary?.mode, 'trusted_local', 'agent_trust_mode_missing');
  const clientFile = join(agentHost, 'webenvoy-client.json');
  const registered = runOwnerJson('agent-register', ['access', 'register', '--data-dir', ownerData, '--display-name', `${prefix}-observation-cost-agent`,
    '--credential-hash', setupHost.credential_fingerprint, '--idempotency-key', `${prefix}-register`]);
  const principalId = valueForKey(registered, 'principal_id');
  assert.ok(principalId, 'principal_missing');
  const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
  const policy = await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: `${prefix}-management-policy`,
    expected_source_version: null, modes: { read: 'auto', prepare: 'auto', commit: 'auto' }
  } });
  assert.equal(policy?.ok, true, 'management_policy_not_set');
  origin = await startFixtureServer();
  assert.equal(runOwnerJson('agent-connect', ['agent', 'connect', '--client-file', clientFile]).ok, true, 'agent_connect_failed');

  const creationGrantPath = join(root, 'creation-grant.json');
  const permissionOperations = ['profile.read', 'instance.start', 'instance.observe', 'instance.snapshot', 'instance.input', 'instance.stop'];
  const creationGrant = {
    idempotency_key: `${prefix}-creation-grant`, principal_id: principalId, profile_refs: [],
    allowed_operations: ['profile.create', 'profile.list', 'profile.read'], allowed_origins: [origin],
    expires_at: new Date(Date.now() + liveBudgetMs + 60_000).toISOString(), max_created_profiles: 1,
    creation_template: { template_ref: `${prefix}-local-template`, provider_id: 'camoufox',
      site: { site_id: `${prefix}-local-site`, origin, display_name: 'Observation cost loopback fixture' }, language: 'en-US', timezone: 'UTC',
      permission_ceiling: { allowed_operations: permissionOperations, allowed_origins: [origin], controlled_interaction_origins: [origin] } }
  };
  await writeFile(creationGrantPath, JSON.stringify(creationGrant), { mode: 0o600 });
  const creationResult = runOwnerJson('creation-grant', ['access', 'grant', '--data-dir', ownerData, '--grant-file', creationGrantPath]);
  const creationGrantId = valueForKey(creationResult, 'grant_id');
  assert.ok(creationGrantId, 'creation_grant_missing');
  grants.add(creationGrantId);
  const profileMade = runAgentOperation('profile-create', 'profile.create', creationGrantId, null, { template_ref: `${prefix}-local-template` });
  assertSucceeded(profileMade.parsed, 'profile_create');
  const profileRef = valueForKey(profileMade.parsed, 'profile_ref');
  assert.ok(profileRef, 'profile_ref_missing');
  runOwnerJson('creation-grant-revoke', ['access', 'revoke', '--data-dir', ownerData, '--kind', 'grants', '--id', creationGrantId,
    '--idempotency-key', `${prefix}-revoke-creation-grant`]);
  grants.delete(creationGrantId);

  const profileGrantPath = join(root, 'profile-grant.json');
  const grantBody = { idempotency_key: `${prefix}-profile-grant`, principal_id: principalId, profile_refs: [profileRef],
    allowed_operations: permissionOperations, allowed_origins: [origin], expires_at: new Date(Date.now() + liveBudgetMs + 60_000).toISOString(),
    creation_template: null, max_created_profiles: 0 };
  await writeFile(profileGrantPath, JSON.stringify(grantBody), { mode: 0o600 });
  const profileGrantResult = runOwnerJson('profile-grant', ['access', 'grant', '--data-dir', ownerData, '--grant-file', profileGrantPath]);
  const grantId = valueForKey(profileGrantResult, 'grant_id');
  assert.ok(grantId, 'profile_grant_missing');
  grants.add(grantId);
  evidence.state = 'running';
  evidence.profile = 'dedicated_no_account_profile';
  evidence.requested_authorization = { operations: permissionOperations.concat('profile.create'), origins: 'loopback fixture origin only' };
  await persist();
  liveDeadline = Date.now() + liveBudgetMs;

  for (const count of normalCounts) {
    const startLabel = `instance-start-${count}`;
    const started = runAgentOperation(startLabel, 'instance.start', grantId, profileRef, { profile_ref: profileRef, origin, url: `${origin}/controls/${count}` });
    assertSucceeded(started.parsed, startLabel);
    currentSession = valueForKey(started.parsed, 'runtime_session_ref');
    assert.ok(currentSession, 'runtime_session_missing');
    for (let repeat = 1; repeat <= repeatsPerCount; repeat += 1) {
      const sample = { controls: count, repeat, startup_position: repeat === 1 ? 'first_observation_after_instance_start' : 'warm_same_instance',
        outcome: 'running', segments: [], started_at: new Date().toISOString() };
      samples.push(sample); await persist();
      const observedCall = runAgentOperation(`observe-${count}-${repeat}`, 'instance.observe', grantId, profileRef, {
        profile_ref: profileRef, origin, runtime_session_ref: currentSession
      });
      if (!succeeded(observedCall.parsed)) { sample.outcome = observedCall.entry.outcome; sample.failure_code = observedCall.entry.failure_code; break; }
      const page = pageFrom(observedCall.parsed);
      assert.ok(page?.page_ref, 'observed_page_ref_missing');
      sample.page_ref_fingerprint = fingerprint(page.page_ref);
      sample.page_id_fingerprint = page.page_id ? fingerprint(page.page_id) : null;
      sample.document_generation = page.document_generation ?? null;

      const snapshotCall = runAgentOperation(`snapshot-${count}-${repeat}`, 'instance.snapshot', grantId, profileRef, {
        profile_ref: profileRef, origin, runtime_session_ref: currentSession, page_ref: page.page_ref,
        ...(page.page_id ? { page_id: page.page_id } : {}), ...(page.document_generation ? { document_generation: page.document_generation } : {})
      });
      if (!succeeded(snapshotCall.parsed)) {
        sample.outcome = snapshotCall.entry.outcome; sample.failure_code = snapshotCall.entry.failure_code;
        if (sample.outcome === 'unknown') queryOriginalRun(`snapshot-${count}-${repeat}`, snapshotCall.key);
        break;
      }
      const first = sampleFrom(snapshotCall.parsed);
      assert.ok(first?.observation_ref && first?.page_ref, 'snapshot_identity_missing');
      sample.observation_ref_fingerprint = fingerprint(first.observation_ref);
      sample.initial = { controls: first.controls?.length ?? 0, complete: first.coverage?.controls?.complete ?? null,
        enumeration_complete: first.coverage?.controls?.enumeration_complete ?? null, total: first.coverage?.controls?.total ?? null,
        has_more: first.continuation?.has_more ?? false, text_bytes: first.coverage?.text?.returned_bytes ?? null,
        text_state: first.coverage?.text?.state ?? null };
      sample.segments.push({ controls: first.controls?.length ?? 0, continuation: false });
      let allControls = [...(first.controls ?? [])];
      let current = first;
      let segmentNumber = 1;
      while (current.continuation?.has_more === true) {
        assert.ok(segmentNumber < 2, 'ordinary_continuation_segment_budget');
        if (count !== 160) throw new Error(`unexpected_continuation_${count}`);
        const cursor = current.continuation.next_cursor;
        assert.equal(typeof cursor, 'string', 'continuation_cursor_missing');
        segmentNumber += 1;
        const continuedCall = runAgentOperation(`continuation-${count}-${repeat}-${segmentNumber}`, 'instance.snapshot', grantId, profileRef, {
          profile_ref: profileRef, origin, runtime_session_ref: currentSession, page_ref: first.page_ref,
          ...(first.page_id ? { page_id: first.page_id } : {}), ...(first.document_generation ? { document_generation: first.document_generation } : {}),
          observation_ref: first.observation_ref, cursor, limit: 128
        });
        if (!succeeded(continuedCall.parsed)) {
          sample.outcome = continuedCall.entry.outcome; sample.failure_code = continuedCall.entry.failure_code;
          if (sample.outcome === 'unknown') queryOriginalRun(`continuation-${count}-${repeat}-${segmentNumber}`, continuedCall.key);
          break;
        }
        current = sampleFrom(continuedCall.parsed);
        assert.equal(current?.observation_ref, first.observation_ref, 'continuation_changed_observation');
        assert.equal(current?.captured_at, first.captured_at, 'continuation_changed_capture_time');
        const controls = current.controls ?? [];
        sample.segments.push({ controls: controls.length, continuation: true });
        allControls = allControls.concat(controls);
      }
      if (sample.outcome !== 'running') break;
      assert.equal(allControls.length, count, `snapshot_control_count_${count}`);
      assert.equal(current.coverage.controls.complete, true);
      assert.equal(first.controls.length, Math.min(128, count));
      assert.equal(new Set(allControls.map(control => control.target_ref)).size, count, `snapshot_duplicate_targets_${count}`);
      if (count === 160) assert.equal(sample.segments.length, 2, '160_should_be_128_plus_32');
      else assert.equal(sample.segments.length, 1, `unexpected_segment_count_${count}`);
      const actionControl = allControls.at(-1);
      assert.ok(actionControl?.target_ref && actionControl.role === 'textbox' && actionControl.enabled === true, 'normal_action_target_missing');
      const actionKeyLabel = `input-${count}-${repeat}`;
      const input = runAgentOperation(actionKeyLabel, 'instance.input', grantId, profileRef, {
        profile_ref: profileRef, origin, runtime_session_ref: currentSession, page_ref: first.page_ref,
        ...(first.page_id ? { page_id: first.page_id } : {}), ...(first.document_generation ? { document_generation: first.document_generation } : {}),
        observation_ref: first.observation_ref, target_ref: actionControl.target_ref, text: `sample-${count}-${repeat}`
      });
      sample.normal_target_action = { status: input.entry.result_status, outcome: input.entry.outcome,
        dispatch_state: input.entry.dispatch_state, failure_code: input.entry.failure_code,
        target_ordinal: count, target_ref_fingerprint: fingerprint(actionControl.target_ref) };
      if (!succeeded(input.parsed)) {
        sample.outcome = input.entry.outcome; sample.failure_code = input.entry.failure_code;
        if (sample.outcome === 'unknown') queryOriginalRun(`input-${count}-${repeat}`, input.key);
        break;
      }
      sample.outcome = 'completed'; sample.completed_at = new Date().toISOString();
    }
    const stop = runCommand(`instance-stop-${count}`, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', currentSession]);
    if (stop.result.status !== 0) throw new Error(`instance_stop_${count}_failed`);
    currentSession = null;
    if (samples.at(-1)?.outcome !== 'completed') break;
  }

  if (samples.length === normalCounts.length * repeatsPerCount && samples.every(sample => sample.outcome === 'completed')) {
    const stressStart = runAgentOperation('instance-start-stress-800', 'instance.start', grantId, profileRef, {
      profile_ref: profileRef, origin, url: `${origin}/stress`
    });
    assertSucceeded(stressStart.parsed, 'stress_instance_start');
    currentSession = valueForKey(stressStart.parsed, 'runtime_session_ref');
    const stressSample = { controls: 800, repeat: 1, startup_position: 'first_observation_after_instance_start', outcome: 'running', segments: [], started_at: new Date().toISOString() };
    samples.push(stressSample); await persist();
    const observedCall = runAgentOperation('observe-stress-800', 'instance.observe', grantId, profileRef, {
      profile_ref: profileRef, origin, runtime_session_ref: currentSession
    });
    const page = pageFrom(observedCall.parsed);
    if (!succeeded(observedCall.parsed)) { stressSample.outcome = observedCall.entry.outcome; stressSample.failure_code = observedCall.entry.failure_code; }
    else {
      const snapshotCall = runAgentOperation('snapshot-stress-800', 'instance.snapshot', grantId, profileRef, {
        profile_ref: profileRef, origin, runtime_session_ref: currentSession, page_ref: page.page_ref,
        ...(page.page_id ? { page_id: page.page_id } : {}), ...(page.document_generation ? { document_generation: page.document_generation } : {})
      });
      let snapshot = sampleFrom(snapshotCall.parsed);
      if (!succeeded(snapshotCall.parsed)) {
        stressSample.outcome = snapshotCall.entry.outcome; stressSample.failure_code = snapshotCall.entry.failure_code;
        if (stressSample.outcome === 'unknown') queryOriginalRun('snapshot-stress-800', snapshotCall.key);
      } else {
        let count = 0;
        do {
          if (stressSample.segments.length >= 16) { stressSample.outcome = 'segment_budget_exhausted'; break; }
          const controls = snapshot.controls ?? [];
          count += controls.length;
          stressSample.segments.push({ controls: controls.length, continuation: stressSample.segments.length > 0 });
          stressSample.enumeration_complete = snapshot.coverage?.controls?.enumeration_complete ?? null;
          stressSample.total = snapshot.coverage?.controls?.total ?? null;
          if (snapshot.continuation?.has_more !== true) break;
          const segment = stressSample.segments.length + 1;
          const cursor = snapshot.continuation.next_cursor;
          assert.equal(typeof cursor, 'string', 'stress_cursor_missing');
          const continued = runAgentOperation(`continuation-stress-800-${segment}`, 'instance.snapshot', grantId, profileRef, {
            profile_ref: profileRef, origin, runtime_session_ref: currentSession, page_ref: snapshot.page_ref,
            ...(snapshot.page_id ? { page_id: snapshot.page_id } : {}), ...(snapshot.document_generation ? { document_generation: snapshot.document_generation } : {}),
            observation_ref: snapshot.observation_ref, cursor, limit: 128
          });
          if (!succeeded(continued.parsed)) {
            stressSample.outcome = continued.entry.outcome; stressSample.failure_code = continued.entry.failure_code;
            if (stressSample.outcome === 'unknown') queryOriginalRun(`continuation-stress-800-${segment}`, continued.key);
            break;
          }
          snapshot = sampleFrom(continued.parsed);
        } while (snapshot);
        if (stressSample.outcome === 'running') stressSample.outcome = 'completed';
        stressSample.returned_controls = count;
        stressSample.page_ref_fingerprint = fingerprint(page.page_ref);
        stressSample.observation_ref_fingerprint = snapshot?.observation_ref ? fingerprint(snapshot.observation_ref) : null;
        stressSample.completed_at = new Date().toISOString();
      }
    }
    const stop = runCommand('instance-stop-stress-800', ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', currentSession]);
    if (stop.result.status !== 0) throw new Error('stress_instance_stop_failed');
    currentSession = null;
  }

  evidence.state = samples.length === 10 && samples.every(sample => sample.outcome === 'completed') ? 'measurements_completed' : 'stopped';
  evidence.completed_at = new Date().toISOString();
}

try {
  await main();
} catch (error) {
  evidence.state = error?.code === 'live_budget_exhausted' ? 'budget_exhausted' : 'failed';
  evidence.failure_code = error?.code ?? (error?.name === 'AssertionError' ? 'measurement_assertion_failed' : 'unexpected_error');
  evidence.failed_at = new Date().toISOString();
} finally {
  evidence.cleanup = await cleanup();
  evidence.completed_at ??= new Date().toISOString();
  await persistence;
  await persist().catch(() => {});
  await writeFile(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
process.stdout.write(`${JSON.stringify({ state: evidence.state, evidence: evidenceOutput, private_root: root, candidate: evidence.candidate,
  ordinary: samples.filter(sample => normalCounts.includes(sample.controls)).map(sample => ({ controls: sample.controls, repeat: sample.repeat, outcome: sample.outcome })),
  stress: samples.find(sample => sample.controls === 800)?.outcome ?? 'not_run', cleanup: evidence.cleanup, failure_code: evidence.failure_code ?? null })}\n`);
if (evidence.state !== 'measurements_completed' || Object.values(evidence.cleanup).some(value => value.endsWith('_failed'))) process.exitCode = 1;
