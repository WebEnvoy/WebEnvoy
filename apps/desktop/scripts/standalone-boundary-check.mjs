import assert from 'node:assert/strict';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

// This check is intentionally CI-only. Default mode uses the existing nobody
// account and sudo; --same-uid checks the trusted owner-user path. Neither mode
// creates users or changes ACLs, sudo policy, signatures, providers, browsers,
// or external accounts.
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('standalone_boundary_requires_macos_arm64');

const packageRoot = resolve(process.argv[2] ?? process.env.PACKAGE_ROOT ?? '.');
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
const sameUidMode = process.argv.includes('--same-uid');
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');
const agentUid = sameUidMode ? ownerUid : Number(execFileSync('/usr/bin/id', ['-u', 'nobody'], { encoding: 'utf8' }).trim());
if (!Number.isSafeInteger(agentUid) || agentUid < 1 || !sameUidMode && agentUid === ownerUid) throw new Error('agent_uid_unavailable');
if (!sameUidMode) {
  const switchedUid = Number(execFileSync('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', '/usr/bin/id', '-u'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim());
  if (switchedUid !== agentUid) throw new Error('agent_uid_switch_unavailable');
}

const { defaultAgentDataSocket, verifyAgentBundleBoundary, verifyOsBoundary } = await import(pathToFileURL(join(packageRoot, 'agent-entry', 'os-boundary.mjs')).href);
const root = await mkdtemp('/tmp/wb-ci-');
const ownerData = join(root, 'owner-data');
const ownerSocket = join(ownerData, 'owner-control.sock');
const sameUidBoundary = verifyOsBoundary({ ownerUid, agentUid: ownerUid, ownerSocketPath: join(root, 'same-uid-probe.sock') });
assert.equal(sameUidBoundary.mode, 'trusted_local', 'same UID must report its trusted local mode');
assert.equal(sameUidBoundary.state, 'supported', `same-UID owner path must be usable: ${JSON.stringify(sameUidBoundary)}`);
assert.equal(sameUidBoundary.asset_boundary.state, 'trusted_user_domain', 'same UID must not claim bundle isolation');
assert.ok(!sameUidBoundary.reason_codes.includes('owner_agent_uid_not_separated'), 'same UID is an explicit supported trust mode');
const linkedInstallationPath = join(packageRoot, '..', 'webenvoy-installation.json');
let linkedInstallationExisted = false;
try {
  await lstat(linkedInstallationPath);
  linkedInstallationExisted = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let agentHost;
let agentEndpoint;
let clientFile;
let started = false;
const agentMetadataScript = `import { createHash } from 'node:crypto'; import { lstat, readFile } from 'node:fs/promises'; const path = process.argv[1]; const value = JSON.parse(await readFile(path, 'utf8')); const info = await lstat(path); if ((info.mode & 0o777) !== 0o600) throw new Error('agent_client_mode_invalid'); if (Object.keys(value).some(key => /owner.*credential|owner.*bearer/i.test(key))) throw new Error('owner_credential_exposed'); if (typeof value.credential !== 'string') throw new Error('agent_credential_missing'); process.stdout.write(JSON.stringify({ agent_endpoint: value.agent_endpoint, owner_uid: value.owner_uid, agent_uid: value.agent_uid, credential_fingerprint: createHash('sha256').update(value.credential).digest('hex') }));`;

try {
  await mkdir(ownerData, { mode: 0o700 });
  await chmod(ownerData, 0o700);
  const ownerSetup = run(cli, ['setup', '--data-dir', ownerData, ...(sameUidMode ? [] : ['--agent-uid', String(agentUid)])]);
  const bootstrap = lastJson(ownerSetup.stdout, 'owner_setup');
  const installation = JSON.parse(await readFile(join(ownerData, 'installation.json'), 'utf8'));
  await expectMissing(join(ownerData, 'owner.json'), 'owner setup must not persist an owner bearer file');
  assert.equal(installation.owner_uid, ownerUid, 'owner setup must persist the actual owner UID');
  assert.equal(installation.agent_uid, agentUid, 'owner setup must persist the actual Agent UID');
  const expectedMode = sameUidMode ? 'trusted_local' : 'distinct_uid_hardened';
  assert.equal(bootstrap.boundary?.mode, expectedMode, 'owner setup must report the configured trust mode');
  assert.equal(installation.os_boundary?.mode, expectedMode, 'owner setup must persist the configured trust mode');
  agentEndpoint = bootstrap.agent_endpoint ?? installation.agent_endpoint ?? defaultAgentDataSocket(ownerData);
  assert.ok(typeof agentEndpoint === 'string' && agentEndpoint.startsWith('/'), 'owner setup must publish an absolute Agent endpoint');
  assert.ok(agentEndpoint !== ownerSocket && !agentEndpoint.startsWith(`${resolve(ownerData)}${sep}`), 'Agent endpoint must be outside owner-private data');
  assert.equal((await lstat(ownerData)).mode & 0o777, 0o700, 'owner data must remain owner-only');
  await expectMissing(agentEndpoint, 'Agent socket must not exist before owner start');

  run(cli, ['start', '--data-dir', ownerData]);
  started = true;
  const ownerStatus = lastJson(run(cli, ['diagnose', '--data-dir', ownerData]).stdout, 'owner_diagnose');
  assert.equal(ownerStatus.ready, true, 'owner Runtime must become ready');
  assert.equal(ownerStatus.boundary?.state, 'supported', `OS boundary must be supported: ${JSON.stringify(ownerStatus.boundary)}`);
  assert.equal(ownerStatus.boundary?.mode, expectedMode, 'Runtime must report the configured trust mode');
  if (!sameUidMode) {
    await assertAgentCannotModifyBundle();
    await assertBundleMutationBoundary();
  }

  agentHost = await mkdtempAsAgent(join('/tmp', `webenvoy-agent-host-${process.pid}-`));
  const agentSetup = lastJson(runAsAgent(cli, ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid), '--agent-endpoint', agentEndpoint]).stdout, 'agent_setup');
  if (sameUidMode) assert.equal(agentSetup.boundary?.mode, expectedMode, 'Agent setup must report trusted local mode');
  else assert.equal(agentSetup.boundary?.mode, undefined, 'Agent setup must not claim the distinct-UID hardening was verified');
  clientFile = join(agentHost, 'webenvoy-client.json');
  const agentMeta = JSON.parse(runAsAgent(fixedNode, ['--input-type=module', '-e', agentMetadataScript, clientFile]).stdout);
  assert.equal(agentMeta.owner_uid, ownerUid);
  assert.equal(agentMeta.agent_uid, agentUid);
  assert.equal(agentMeta.agent_endpoint, agentEndpoint);
  assert.match(agentMeta.credential_fingerprint, /^[a-f0-9]{64}$/);
  if (!sameUidMode) {
    await expectDenied(ownerData, 'Agent must not traverse owner data');
    await expectDenied(ownerSocket, 'Agent must not read owner control socket');
    await expectOwnerWriteDenied(agentHost, 'Owner must not write Agent host assets');
  }

  const registered = lastJson(run(cli, ['access', 'register', '--data-dir', ownerData, '--display-name', 'standalone-ci-agent', '--credential-hash', agentMeta.credential_fingerprint, '--idempotency-key', 'standalone-ci-register']).stdout, 'owner_register');
  const principalId = findString(registered, ['principal_id']);
  assert.ok(principalId, 'owner register must return principal_id');
  const grantFile = join(root, 'grant.json');
  await writeFile(grantFile, JSON.stringify({
    idempotency_key: 'standalone-ci-grant',
    principal_id: principalId,
    profile_refs: [],
    allowed_operations: ['profile.list'],
    allowed_origins: [],
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    creation_template: null,
    max_created_profiles: 0
  }), { mode: 0o600 });
  const granted = lastJson(run(cli, ['access', 'grant', '--data-dir', ownerData, '--grant-file', grantFile]).stdout, 'owner_grant');
  const grantId = findString(granted, ['grant_id']);
  assert.ok(grantId, 'owner grant must return grant_id');

  const connected = runAsAgent(cli, ['agent', 'connect', '--client-file', clientFile]);
  assert.equal(lastJson(connected.stdout, 'agent_connect').ok, true, 'Agent must connect through Agent endpoint');
  const operationFile = join(agentHost, 'profile-list.json');
  await writeAsAgent(operationFile, JSON.stringify({
    idempotency_key: 'standalone-ci-profile-list',
    grant_id: grantId,
    operation: 'profile.list',
    task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] }
  }));
  const operation = runAsAgent(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', operationFile]);
  const operationResult = lastJson(operation.stdout, 'agent_operation');
  assert.ok(findString(operationResult, ['run_id']), 'Agent operation must return a durable Run reference');
  const deniedOperationFile = join(agentHost, 'profile-read-denied.json');
  await writeAsAgent(deniedOperationFile, JSON.stringify({
    idempotency_key: 'standalone-ci-profile-read-denied',
    grant_id: grantId,
    operation: 'profile.read',
    profile_ref: 'profile:outside-live-grant',
    task_scope: { operations: ['profile.read'], profile_refs: ['profile:outside-live-grant'], origins: [] }
  }));
  const deniedOperation = runAsAgentResult(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', deniedOperationFile]);
  assert.equal(deniedOperation.status, 3, `out-of-scope operation must be denied: ${deniedOperation.stderr || deniedOperation.stdout}`);
  const deniedOperationBody = lastJson(deniedOperation.stdout, 'agent_out_of_scope_operation');
  assert.equal(deniedOperationBody.error?.code ?? deniedOperationBody.failure?.code, 'managed_access_denied', JSON.stringify(deniedOperationBody));
  const queriedBeforeStop = runAsAgent(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', 'standalone-ci-profile-list']);
  const queryBeforeStop = lastJson(queriedBeforeStop.stdout, 'agent_query_before_stop');
  assert.equal(findString(queryBeforeStop, ['run_id']), findString(operationResult, ['run_id']), 'query must address the original Run');
  const mcpQuery = await runAgentMcpQuery(clientFile, findString(operationResult, ['run_id']));
  assert.equal(findString(mcpQuery, ['run_id']), findString(operationResult, ['run_id']), 'MCP query must address the original Run without replay');
  await assertAgentOwnerRouteDenied(clientFile);

  const ownerSessions = run(cli, ['instance', 'list', '--data-dir', ownerData]);
  assert.ok(lastJson(ownerSessions.stdout, 'owner_instance_list'), 'owner instance list must be a live owner read');
  run(cli, ['stop', '--data-dir', ownerData]);
  started = false;
  await waitMissing(ownerSocket, 'owner stop must remove owner socket');
  await waitMissing(agentEndpoint, 'owner stop must remove Agent socket');
  run(cli, ['start', '--data-dir', ownerData]);
  started = true;
  const restarted = lastJson(run(cli, ['diagnose', '--data-dir', ownerData]).stdout, 'owner_restart');
  assert.notEqual(restarted.runtime_id, ownerStatus.runtime_id, 'restart must create a new Runtime identity');
  const queriedAfterRestart = lastJson(runAsAgent(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', 'standalone-ci-profile-list']).stdout, 'agent_query_after_restart');
  assert.equal(findString(queriedAfterRestart, ['run_id']), findString(queryBeforeStop, ['run_id']), 'restart query must not replay the original operation');

  console.log(JSON.stringify({
    state: 'passed',
    owner_uid: ownerUid,
    agent_uid: agentUid,
    mode: expectedMode,
    owner_data_mode: '0700',
    agent_endpoint: agentEndpoint,
    operation: 'profile.list',
    run_id: findString(operationResult, ['run_id']),
    restart_runtime_id: restarted.runtime_id
  }));
} finally {
  if (started) {
    try { run(cli, ['stop', '--data-dir', ownerData]); } catch {}
  }
  if (agentHost) {
    try { runAsAgent(fixedNode, ['--input-type=module', '-e', `import { rm } from 'node:fs/promises'; await rm(process.argv[1], { recursive: true, force: true });`, agentHost]); } catch {}
  }
  await rm(root, { recursive: true, force: true });
  if (!linkedInstallationExisted) {
    try { await unlink(linkedInstallationPath); } catch {}
  }
}

function run(command, args) {
  const result = runResult(command, args);
  if (result.status !== 0) throw new Error(`boundary_command_failed:${command}:${args.join(' ')}:${result.stderr || result.stdout}`);
  return result;
}

function runResult(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, encoding: 'utf8', timeout: 120_000, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw result.error;
  return result;
}

function runAsAgent(command, args) {
  const result = runAsAgentResult(command, args);
  if (result.status !== 0) throw new Error(`agent_command_failed:${command}:${args.join(' ')}:${result.stderr || result.stdout}`);
  return result;
}

function runAsAgentResult(command, args) {
  return sameUidMode ? runResult(command, args) : runResult('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', command, ...args]);
}

// This is a fixed-package MCP stdio client check, not a real third-party Agent
// or plugin_verified claim. It waits for each response before sending the next
// request, as a real MCP client does, so connect completes before query starts.
async function runAgentMcpQuery(clientPath, runId) {
  const mcpArgs = [join(packageRoot, 'agent-entry/mcp.mjs'), clientPath];
  const executable = sameUidMode ? fixedNode : '/usr/bin/sudo';
  const args = sameUidMode ? mcpArgs : ['-n', '-u', 'nobody', '--', fixedNode, ...mcpArgs];
  const child = spawn(executable, args, {
    cwd: packageRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' }
  });
  const output = createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); });
  output.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (waiter) waiter.resolve(message);
  });
  const exitPromise = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  child.once('error', error => { for (const waiter of pending.values()) waiter.reject(error); });
  child.once('exit', (code, signal) => {
    const error = new Error(`mcp_client_exited_before_response: status=${code ?? 'null'} signal=${signal ?? 'none'} stderr=${stderr}`);
    for (const waiter of pending.values()) waiter.reject(error);
  });
  let requestId = 0;
  const send = async (method, params) => {
    const id = ++requestId;
    const message = { jsonrpc: '2.0', id, method, params };
    const responsePromise = new Promise((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectResponse(new Error(`mcp_response_timeout:${method}:stderr=${stderr}`));
      }, 30_000);
      pending.set(id, {
        resolve(value) { clearTimeout(timer); pending.delete(id); resolveResponse(value); },
        reject(error) { clearTimeout(timer); pending.delete(id); rejectResponse(error); }
      });
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
    const response = await responsePromise;
    if (response.error || response.result?.isError) throw new Error(`mcp_request_failed:${method}:${JSON.stringify(response)}`);
    return response;
  };
  const toolValue = response => {
    const text = response.result?.content?.find(item => item?.type === 'text')?.text;
    if (typeof text !== 'string') throw new Error(`mcp_tool_result_missing:${JSON.stringify(response)}`);
    let value;
    try { value = JSON.parse(text); } catch { throw new Error(`mcp_tool_result_invalid:${text}`); }
    if (value?.ok === false) throw new Error(`mcp_tool_operation_failed:${JSON.stringify(value)}`);
    return value;
  };
  try {
    await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'standalone-boundary-check', version: '1' } });
    const connected = toolValue(await send('tools/call', { name: 'webenvoy_connect', arguments: {} }));
    if (connected.ok !== true) throw new Error(`mcp_connect_not_confirmed:${JSON.stringify(connected)}`);
    const queried = toolValue(await send('tools/call', { name: 'webenvoy_query', arguments: { run_id: runId } }));
    if (typeof queried.run_id !== 'string') throw new Error(`mcp_query_run_projection_missing:${JSON.stringify(queried)}`);
    child.stdin.end();
    const exit = await exitPromise;
    if (exit.code !== 0 || exit.signal) throw new Error(`mcp_query_failed: status=${exit.code ?? 'null'} signal=${exit.signal ?? 'none'} stderr=${stderr}`);
    return queried;
  } finally {
    output.close();
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

async function mkdtempAsAgent(prefix) {
  const script = `import { mkdtemp } from 'node:fs/promises'; process.stdout.write(await mkdtemp(process.argv[1]));`;
  const result = runAsAgent(fixedNode, ['--input-type=module', '-e', script, prefix]);
  const path = result.stdout.trim();
  assert.ok(path.startsWith(prefix), 'Agent host must be created below the traversable temp parent');
  const info = await lstat(path);
  assert.equal(info.uid, agentUid, 'Agent host must be owned by the Agent UID');
  assert.equal(info.mode & 0o777, 0o700, 'Agent host must be private to the Agent');
  return path;
}

async function writeAsAgent(path, contents) {
  const script = `import { writeFile, mkdir } from 'node:fs/promises'; import { dirname } from 'node:path'; await mkdir(dirname(process.argv[1]), { recursive: true, mode: 0o700 }); await writeFile(process.argv[1], process.argv[2], { mode: 0o600 });`;
  runAsAgent(fixedNode, ['--input-type=module', '-e', script, path, contents]);
}

function lastJson(output, label) {
  const lines = String(output).trim().split('\n').reverse();
  for (const line of lines) try { return JSON.parse(line); } catch {}
  throw new Error(`${label}_json_missing`);
}

function findString(value, keys) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) if (typeof value[key] === 'string') return value[key];
  for (const child of Object.values(value)) {
    const result = findString(child, keys);
    if (result) return result;
  }
  return undefined;
}

async function expectMissing(path, message) {
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(message);
}

async function waitMissing(path, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(message);
}

async function expectDenied(path, message) {
  const script = `import { access } from 'node:fs/promises'; try { await access(process.argv[1]); process.exit(0); } catch { process.exit(7); }`;
  const result = spawnSync('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', fixedNode, '--input-type=module', '-e', script, path], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw result.error;
  if (result.status !== 7 || result.signal) throw new Error(`${message}: expected nobody access denial (exit 7), got status=${result.status ?? 'null'} signal=${result.signal ?? 'none'}`);
}

async function expectOwnerWriteDenied(path, message) {
  try { await access(path, 2); } catch (error) { if (['EACCES', 'EPERM'].includes(error.code)) return; throw error; }
  throw new Error(message);
}

async function assertAgentCannotModifyBundle() {
  const script = `import { access } from 'node:fs/promises'; const paths = process.argv.slice(1); for (const path of paths) { try { await access(path, 2); process.stdout.write(path + '\\n'); } catch {} }`;
  const result = runAsAgent(fixedNode, ['--input-type=module', '-e', script,
    packageRoot, join(packageRoot, 'bin'), join(packageRoot, 'agent-entry'), join(packageRoot, 'runtime'),
    cli, join(packageRoot, 'agent-entry', 'service.mjs'), join(packageRoot, 'agent-manifest.json'), fixedNode]);
  if (result.stdout.trim()) throw new Error(`agent_bundle_write_access:${result.stdout}`);
}

async function assertBundleMutationBoundary() {
  const asset = join(packageRoot, 'agent-entry', 'service.mjs');
  const parent = join(packageRoot, 'agent-entry');
  const assetInfo = await lstat(asset);
  const parentInfo = await lstat(parent);
  const baseline = verifyAgentBundleBoundary({ installRoot: packageRoot, ownerUid, agentUid });
  assert.equal(baseline.state, 'supported', `baseline bundle boundary must be supported: ${JSON.stringify(baseline)}`);
  try {
    await chmod(asset, (assetInfo.mode & 0o7777) | 0o002);
    const writableAsset = verifyAgentBundleBoundary({ installRoot: packageRoot, ownerUid, agentUid });
    assert.equal(writableAsset.state, 'disabled', 'Agent-writable bundle asset must disable the data plane');
    assert.ok(writableAsset.reason_codes.includes('agent_bundle_asset_writable'), `missing writable asset reason: ${JSON.stringify(writableAsset)}`);
    await chmod(asset, assetInfo.mode & 0o7777);
    await chmod(parent, (parentInfo.mode & 0o7777) | 0o003);
    const writableParent = verifyAgentBundleBoundary({ installRoot: packageRoot, ownerUid, agentUid });
    assert.equal(writableParent.state, 'disabled', 'Agent-replaceable bundle parent must disable the data plane');
    assert.ok(writableParent.reason_codes.includes('agent_bundle_asset_parent_replaceable'), `missing replaceable parent reason: ${JSON.stringify(writableParent)}`);
    await chmod(parent, parentInfo.mode & 0o7777);
    const restored = verifyAgentBundleBoundary({ installRoot: packageRoot, ownerUid, agentUid });
    assert.equal(restored.state, 'supported', `restored bundle boundary must be supported: ${JSON.stringify(restored)}`);
  } finally {
    await chmod(asset, assetInfo.mode & 0o7777).catch(() => {});
    await chmod(parent, parentInfo.mode & 0o7777).catch(() => {});
  }
  const manifest = JSON.parse(await readFile(join(packageRoot, 'agent-manifest.json'), 'utf8'));
  for (const name of Object.keys(manifest.optional_files ?? {})) {
    const optional = join(packageRoot, name);
    let optionalInfo;
    try { optionalInfo = await lstat(optional); } catch { continue; }
    if (!optionalInfo.isFile()) continue;
    const contents = await readFile(optional);
    await unlink(optional);
    try {
      const missingOptional = verifyAgentBundleBoundary({ installRoot: packageRoot, ownerUid, agentUid });
      assert.equal(missingOptional.state, 'supported', `missing optional asset must remain a local unavailable state: ${JSON.stringify(missingOptional)}`);
    } finally {
      await writeFile(optional, contents, { mode: optionalInfo.mode & 0o7777 });
      await chmod(optional, optionalInfo.mode & 0o7777);
    }
    break;
  }
}

async function assertAgentOwnerRouteDenied(path) {
  const script = `import { readFile } from 'node:fs/promises'; import { request } from 'node:http'; const value = JSON.parse(await readFile(process.argv[1], 'utf8')); const req = request({ socketPath: value.agent_endpoint, path: '/agent-access', headers: { authorization: 'Bearer ' + value.credential } }, response => { let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk); response.on('end', () => { if (response.statusCode !== 403 || !body.includes('agent_route_denied')) process.exit(8); }); }); req.on('error', () => process.exit(9)); req.end();`;
  runAsAgent(fixedNode, ['--input-type=module', '-e', script, path]);
}
