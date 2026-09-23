import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Acceptance-only path. It must run on the real macOS arm64 runner with a
// distinct nobody UID; it never creates users, accounts, credentials, or
// external-site traffic. The workflow supplies only pinned official materials.
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('live_browser_check_requires_macos_arm64');
const packageRoot = resolve(process.argv[2] ?? process.env.PACKAGE_ROOT ?? '.');
const materialsRoot = resolve(process.argv[3] ?? process.env.CAMOUFOX_MATERIAL_ROOT ?? (() => { throw new Error('camoufox_material_root_required'); })());
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');
const agentUid = Number(execFileSync('/usr/bin/id', ['-u', 'nobody'], { encoding: 'utf8' }).trim());
if (!Number.isSafeInteger(agentUid) || agentUid < 1 || agentUid === ownerUid) throw new Error('agent_uid_unavailable');
const switchedUid = Number(execFileSync('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', '/usr/bin/id', '-u'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim());
if (switchedUid !== agentUid) throw new Error('agent_uid_switch_unavailable');

const { CAMOUFOX_UPSTREAM_PINS, verifyCamoufoxUpstreamInstall } = await import(pathToFileURL(join(packageRoot, 'agent-entry/provider-artifact.mjs')).href);
const browserRoot = join(materialsRoot, 'browser', 'Camoufox.app');
const browserExecutable = join(browserRoot, 'Contents/MacOS/camoufox');
const pythonPath = join(materialsRoot, 'venv/bin/python');
const browserSourcePath = join(materialsRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip');
const camoufoxSourcePath = join(materialsRoot, 'camoufox-0.5.6-py3-none-any.whl');
const playwrightSourcePath = join(materialsRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl');
const binding = await verifyCamoufoxUpstreamInstall({
  provider: 'camoufox', browser_install_root: browserRoot, browser_executable: browserExecutable, python_path: pythonPath,
  browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version, browser_source_path: browserSourcePath,
  camoufox_source_path: camoufoxSourcePath, playwright_source_path: playwrightSourcePath
});

const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
const root = await mkdtemp('/tmp/webenvoy-live-browser-');
const ownerData = join(root, 'owner-data');
let originProcess;
let origin;
let agentHost;
let runtimeStarted = false;
let sessionRef;

async function startLocalOrigin() {
  const source = String.raw`
import { createServer } from "node:http";
const server = createServer((request, response) => {
  if (request.method !== "GET" || !["/", "/index.html"].includes(new URL(request.url ?? "/", "http://127.0.0.1").pathname)) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end('<!doctype html><title>WebEnvoy local acceptance</title><main><h1>No account local page</h1><label for=message>Message</label><input id=message name=message aria-label=Message><p id=state>Awaiting input</p><script>const field=document.getElementById("message");const state=document.getElementById("state");field.addEventListener("input",()=>state.textContent="Received: "+field.value)</script></main>');
});
server.listen(0, "127.0.0.1", () => { const address = server.address(); process.stdout.write(JSON.stringify({ port: address.port }) + String.fromCharCode(10)); });
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop); process.once("SIGINT", stop);
`;
  originProcess = spawn(fixedNode, ['--input-type=module', '-e', source], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  return new Promise((resolveOrigin, rejectOrigin) => {
    let pending = '';
    let stderr = '';
    let settled = false;
    const fail = error => { if (!settled) { settled = true; rejectOrigin(error); } };
    originProcess.once('error', fail);
    originProcess.once('exit', (code, signal) => fail(new Error(`local_origin_process_exit:${code ?? 'null'}:${signal ?? 'null'}:${stderr}`)));
    originProcess.stderr.on('data', chunk => { stderr += String(chunk); });
    originProcess.stdout.on('data', chunk => {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        try {
          const value = JSON.parse(line);
          if (Number.isSafeInteger(value.port) && value.port > 0) { settled = true; resolveOrigin(`http://127.0.0.1:${value.port}`); return; }
        } catch {}
      }
    });
  });
}

function command(commandName, args, asAgent = false, input) {
  const executable = asAgent ? '/usr/bin/sudo' : commandName;
  const commandArgs = asAgent ? ['-n', '-u', 'nobody', '--', commandName, ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: packageRoot, encoding: 'utf8', input, timeout: 120_000, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw result.error;
  return result;
}
function run(commandName, args, asAgent = false) {
  const result = command(commandName, args, asAgent);
  if (result.status !== 0 || result.signal) throw new Error(`live_browser_command_failed:${commandName}:${args.join(' ')}:${result.stderr || result.stdout}`);
  return result;
}
function jsonFrom(result, label) {
  for (const line of `${result.stdout}\n${result.stderr}`.trim().split('\n').reverse()) try { return JSON.parse(line); } catch {}
  throw new Error(`${label}_json_missing`);
}
function runJson(commandName, args, asAgent, label) { return jsonFrom(run(commandName, args, asAgent), label); }
function allowJson(commandName, args, asAgent, label) { return jsonFrom(command(commandName, args, asAgent), label); }
function findString(value, keys) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) if (typeof value[key] === 'string') return value[key];
  for (const child of Object.values(value)) { const found = findString(child, keys); if (found) return found; }
  return undefined;
}
function succeeded(value, label) { assert.equal(value?.ok, true, `${label}: ${JSON.stringify(value)}`); assert.equal(value?.status, 'succeeded', `${label}: ${JSON.stringify(value)}`); }
function viewerUnavailable(value) {
  return value?.status === 'unavailable' && [value.failure_class, value.error?.code, value.failure?.code].includes('viewer_unavailable');
}
function scope(operation, profileRef = undefined) { return { operations: [operation], profile_refs: profileRef ? [profileRef] : [], origins: [origin] }; }
async function agentTemp(prefix) {
  const result = command(fixedNode, ['--input-type=module', '-e', 'import { mkdtemp } from "node:fs/promises"; process.stdout.write(await mkdtemp(process.argv[1]));', prefix], true);
  if (result.status !== 0 || result.signal) throw new Error(`agent_temp_failed:${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
async function agentWrite(path, value) {
  run(fixedNode, ['--input-type=module', '-e', 'import { writeFile } from "node:fs/promises"; await writeFile(process.argv[1], process.argv[2], { mode: 0o600 });', path, JSON.stringify(value)], true);
}
function request(operation, idempotencyKey, grantId, taskScope, fields = {}) { return { idempotency_key: idempotencyKey, grant_id: grantId, operation, task_scope: taskScope, ...fields }; }
function ref(value, key, label) { const found = findString(value, [key]); assert.ok(found, `${label} missing ${key}: ${JSON.stringify(value)}`); return found; }
function runMcpQuery(clientPath, idempotencyKey) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'standalone-live-browser-check', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'webenvoy_connect', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'webenvoy_query', arguments: { idempotency_key: idempotencyKey } } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n';
  const result = command(fixedNode, [join(packageRoot, 'agent-entry/mcp.mjs'), clientPath], true, input);
  if (result.status !== 0 || result.signal) throw new Error(`mcp_query_failed:${result.stderr || ''}`);
  const response = String(result.stdout).trim().split('\n').map(line => JSON.parse(line)).find(item => item.id === 3);
  const text = response?.result?.content?.find(item => item?.type === 'text')?.text;
  if (!response || response.error || response.result?.isError || typeof text !== 'string') throw new Error(`mcp_query_refused:${JSON.stringify(response)}`);
  return JSON.parse(text);
}

const providerArgs = [
  '--browser-install-root', browserRoot, '--browser-executable', browserExecutable, '--python-path', pythonPath,
  '--browser-version', CAMOUFOX_UPSTREAM_PINS.browser_version, '--camoufox-version', CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  '--playwright-version', CAMOUFOX_UPSTREAM_PINS.playwright_version, '--browser-source-path', browserSourcePath,
  '--camoufox-source-path', camoufoxSourcePath, '--playwright-source-path', playwrightSourcePath
];
const operationKeys = {
  create: 'live-camoufox-profile-create', start: 'live-camoufox-instance-start', observe: 'live-camoufox-observe',
  snapshot: 'live-camoufox-snapshot', input: 'live-camoufox-input', read: 'live-camoufox-read',
  takeoverInput: 'live-camoufox-input-after-takeover', handbackObserve: 'live-camoufox-observe-after-handback'
};

try {
  origin = await startLocalOrigin();
  const setup = runJson(cli, ['setup', '--data-dir', ownerData, '--agent-uid', String(agentUid), ...providerArgs], false, 'owner_setup');
  assert.equal(setup.installed, true, JSON.stringify(setup));
  assert.deepEqual(setup.camoufox_launch, { state: 'qualified', reason: 'official_upstream' }, JSON.stringify(setup));
  run(cli, ['start', '--data-dir', ownerData]);
  runtimeStarted = true;
  const status = runJson(cli, ['diagnose', '--data-dir', ownerData], false, 'owner_diagnose');
  assert.equal(status.ready, true, JSON.stringify(status));

  const policy = await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: 'live-camoufox-management-policy', expected_source_version: null,
    modes: { read: 'auto', prepare: 'auto', commit: 'auto' }
  } });
  assert.equal(policy.ok, true, JSON.stringify(policy));

  agentHost = await agentTemp('/tmp/webenvoy-agent-live-');
  run(cli, ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid)], true);
  const clientFile = join(agentHost, 'webenvoy-client.json');
  const agentMeta = jsonFrom(command(fixedNode, ['--input-type=module', '-e', 'import { createHash } from "node:crypto"; import { readFile } from "node:fs/promises"; const v=JSON.parse(await readFile(process.argv[1],"utf8")); process.stdout.write(JSON.stringify({agent_endpoint:v.agent_endpoint,owner_uid:v.owner_uid,agent_uid:v.agent_uid,credential_fingerprint:createHash("sha256").update(v.credential).digest("hex")}));', clientFile], true), 'agent_metadata');
  assert.equal(agentMeta.owner_uid, ownerUid); assert.equal(agentMeta.agent_uid, agentUid);

  const registered = runJson(cli, ['access', 'register', '--data-dir', ownerData, '--display-name', 'live-camoufox-agent', '--credential-hash', agentMeta.credential_fingerprint, '--idempotency-key', 'live-camoufox-register'], false, 'owner_register');
  const principalId = ref(registered, 'principal_id', 'register');
  const grant = {
    idempotency_key: 'live-camoufox-grant', principal_id: principalId, profile_refs: [],
    allowed_operations: ['profile.create', 'profile.list', 'profile.read', 'instance.start', 'instance.observe', 'instance.snapshot', 'instance.input', 'instance.read', 'instance.stop'],
    allowed_origins: [origin], expires_at: new Date(Date.now() + 300_000).toISOString(), max_created_profiles: 1,
    creation_template: { template_ref: 'live-camoufox-template', provider_id: 'camoufox', site: { site_id: 'local-acceptance', origin, display_name: 'Local no-account acceptance' }, language: 'en-US', timezone: 'UTC', permission_ceiling: {
      allowed_operations: ['profile.list', 'profile.read', 'instance.start', 'instance.observe', 'instance.snapshot', 'instance.input', 'instance.read', 'instance.stop'],
      allowed_origins: [origin], controlled_interaction_origins: [origin]
    } }
  };
  await writeFile(join(ownerData, 'grant.json'), JSON.stringify(grant), { mode: 0o600 });
  const granted = runJson(cli, ['access', 'grant', '--data-dir', ownerData, '--grant-file', join(ownerData, 'grant.json')], false, 'owner_grant');
  const grantId = ref(granted, 'grant_id', 'grant');
  assert.equal(runJson(cli, ['diagnose', '--data-dir', ownerData], false, 'owner_diagnose_after_grant').ready, true);
  assert.equal(runJson(cli, ['agent', 'connect', '--client-file', clientFile], true, 'agent_connect').ok, true);

  const createFile = join(agentHost, 'profile-create.json');
  await agentWrite(createFile, request('profile.create', operationKeys.create, grantId, { operations: ['profile.create'], profile_refs: [], origins: [origin] }, { template_ref: 'live-camoufox-template' }));
  const created = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', createFile], true, 'profile_create');
  succeeded(created, 'profile_create');
  assert.equal(created.result?.provider_selection?.selected_provider_id, 'camoufox', JSON.stringify(created));
  const profileRef = ref(created.result, 'profile_ref', 'profile_create');

  const startFile = join(agentHost, 'instance-start.json');
  await agentWrite(startFile, request('instance.start', operationKeys.start, grantId, scope('instance.start', profileRef), { profile_ref: profileRef, origin, url: `${origin}/` }));
  const started = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', startFile], true, 'instance_start');
  succeeded(started, 'instance_start');
  sessionRef = ref(started.result, 'runtime_session_ref', 'instance_start');

  const observeFile = join(agentHost, 'observe.json');
  await agentWrite(observeFile, request('instance.observe', operationKeys.observe, grantId, scope('instance.observe', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef }));
  const observed = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', observeFile], true, 'instance_observe');
  succeeded(observed, 'instance_observe');
  assert.equal(observed.result?.observation?.page?.current_url, `${origin}/`, JSON.stringify(observed));
  const observedPage = observed.result.observation.page;

  const snapshotFile = join(agentHost, 'snapshot.json');
  await agentWrite(snapshotFile, request('instance.snapshot', operationKeys.snapshot, grantId, scope('instance.snapshot', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: observedPage.page_ref, ...(observedPage.page_id ? { page_id: observedPage.page_id } : {}), ...(observedPage.document_generation ? { document_generation: observedPage.document_generation } : {}) }));
  const snapshot = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', snapshotFile], true, 'instance_snapshot');
  succeeded(snapshot, 'instance_snapshot');
  const snapshotValue = snapshot.result?.snapshot;
  assert.ok(snapshotValue?.text?.includes('No account local page'), JSON.stringify(snapshot));
  const control = snapshotValue.controls?.find(item => item.role === 'textbox' && item.name === 'Message' && item.enabled === true);
  assert.ok(control?.target_ref, `Message target missing: ${JSON.stringify(snapshot)}`);

  const inputFile = join(agentHost, 'input.json');
  const inputText = 'ordinary local acceptance input';
  await agentWrite(inputFile, request('instance.input', operationKeys.input, grantId, scope('instance.input', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: snapshotValue.page_ref, ...(snapshotValue.page_id ? { page_id: snapshotValue.page_id } : {}), ...(snapshotValue.document_generation ? { document_generation: snapshotValue.document_generation } : {}), observation_ref: snapshotValue.observation_ref, target_ref: control.target_ref, text: inputText }));
  const inputResult = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', inputFile], true, 'instance_input');
  succeeded(inputResult, 'instance_input');

  const readFilePath = join(agentHost, 'read.json');
  const inputPage = snapshotValue;
  await agentWrite(readFilePath, request('instance.read', operationKeys.read, grantId, scope('instance.read', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: inputPage.page_ref, ...(inputPage.page_id ? { page_id: inputPage.page_id } : {}), ...(inputPage.document_generation ? { document_generation: inputPage.document_generation } : {}) }));
  const freshRead = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', readFilePath], true, 'instance_read');
  succeeded(freshRead, 'instance_read');
  assert.ok(freshRead.result?.text?.includes(`Received: ${inputText}`), JSON.stringify(freshRead));

  const cliQuery = runJson(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', operationKeys.input], true, 'cli_query');
  assert.equal(cliQuery.run_id, inputResult.run_id, JSON.stringify({ cliQuery, inputResult }));
  const mcpQuery = runMcpQuery(clientFile, operationKeys.input);
  assert.equal(mcpQuery.run_id, inputResult.run_id, JSON.stringify({ mcpQuery, inputResult }));

  const takeover = allowJson(cli, ['instance', 'takeover', '--data-dir', ownerData, '--runtime-session-ref', sessionRef], false, 'instance_takeover');
  let takeoverEvidence;
  if (viewerUnavailable(takeover)) {
    takeoverEvidence = { state: 'not_exercised', reason: 'viewer_unavailable', failure_class: takeover.failure_class ?? takeover.error?.code ?? takeover.failure?.code };
  } else {
    assert.equal(takeover.control_owner, 'user', JSON.stringify(takeover));
    assert.equal(takeover.control_lock?.owner, 'user', JSON.stringify(takeover));
    assert.equal(takeover.control_lock?.state, 'held', JSON.stringify(takeover));
    const deniedFile = join(agentHost, 'input-after-takeover.json');
    await agentWrite(deniedFile, request('instance.input', operationKeys.takeoverInput, grantId, scope('instance.input', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: inputPage.page_ref, ...(inputPage.page_id ? { page_id: inputPage.page_id } : {}), ...(inputPage.document_generation ? { document_generation: inputPage.document_generation } : {}), observation_ref: inputPage.observation_ref, target_ref: control.target_ref, text: 'must be refused' }));
    const denied = allowJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', deniedFile], true, 'input_after_takeover');
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.equal(denied.dispatch_state, 'not_dispatched', JSON.stringify(denied));
    assert.equal(denied.failure?.code, 'control_lock_conflict', JSON.stringify(denied));
    const handback = allowJson(cli, ['instance', 'handback', '--data-dir', ownerData, '--runtime-session-ref', sessionRef], false, 'instance_handback');
    assert.equal(handback.control_owner, 'core_task', JSON.stringify(handback));
    assert.equal(handback.control_lock?.owner, 'core_task', JSON.stringify(handback));
    assert.equal(handback.control_lock?.state, 'held', JSON.stringify(handback));
    const afterHandbackFile = join(agentHost, 'observe-after-handback.json');
    await agentWrite(afterHandbackFile, request('instance.observe', operationKeys.handbackObserve, grantId, scope('instance.observe', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef }));
    const afterHandback = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', afterHandbackFile], true, 'observe_after_handback');
    succeeded(afterHandback, 'observe_after_handback');
    assert.equal(afterHandback.result?.observation?.page?.current_url, `${origin}/`, JSON.stringify(afterHandback));
    takeoverEvidence = { state: 'verified', failure_code: denied.failure?.code, run_id: denied.run_id };
  }
  run(cli, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]);
  sessionRef = undefined;

  const manifestPath = join(packageRoot, 'agent-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const evidence = { schema: 'webenvoy.live-camoufox-acceptance/v1', state: 'passed', candidate: manifest.workspace?.commit,
    package_manifest_sha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex'), owner_uid: ownerUid, agent_uid: agentUid,
    origin, provider: { provider: binding.provider, camoufox_version: binding.camoufox_version, browser_version: binding.browser_version,
      playwright_version: binding.playwright_version, properties_sha256: binding.properties_sha256, source_sha256: binding.source_sha256 },
    real_provider: true, external_site: false, account: false, third_party_agent: false, takeover: takeoverEvidence,
    runs: { profile_create: created.run_id, instance_start: started.run_id, observe: observed.run_id, snapshot: snapshot.run_id,
      input: inputResult.run_id, read: freshRead.run_id, cli_query: cliQuery.run_id, mcp_query: mcpQuery.run_id, takeover_input: takeoverEvidence.run_id ?? null } };
  if (process.env.LIVE_BROWSER_EVIDENCE_PATH) await writeFile(resolve(process.env.LIVE_BROWSER_EVIDENCE_PATH), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  try { if (sessionRef) run(cli, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]); } catch {}
  if (runtimeStarted) { try { run(cli, ['stop', '--data-dir', ownerData]); } catch {} }
  if (agentHost) { try { run(fixedNode, ['--input-type=module', '-e', 'import { rm } from "node:fs/promises"; await rm(process.argv[1], { recursive: true, force: true });', agentHost], true); } catch {} }
  if (originProcess) {
    try {
      if (originProcess.exitCode === null) {
        await new Promise(resolveExit => {
          const timer = setTimeout(() => { try { originProcess.kill('SIGKILL'); } catch {} resolveExit(); }, 2_000);
          originProcess.once('exit', () => { clearTimeout(timer); resolveExit(); });
          originProcess.kill('SIGTERM');
        });
      }
    } catch {}
  }
  await rm(root, { recursive: true, force: true });
}
