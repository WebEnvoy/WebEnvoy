import assert from 'node:assert/strict';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// This check is intentionally CI-only. It uses an existing nobody account and
// sudo's non-interactive account switch; it never creates users or changes
// ACLs, sudo policy, signatures, providers, browsers, or external accounts.
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('standalone_boundary_requires_macos_arm64');

const packageRoot = resolve(process.argv[2] ?? process.env.PACKAGE_ROOT ?? '.');
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');
const agentUid = Number(execFileSync('/usr/bin/id', ['-u', 'nobody'], { encoding: 'utf8' }).trim());
if (!Number.isSafeInteger(agentUid) || agentUid < 1 || agentUid === ownerUid) throw new Error('agent_uid_unavailable');
const switchedUid = Number(execFileSync('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', '/usr/bin/id', '-u'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim());
if (switchedUid !== agentUid) throw new Error('agent_uid_switch_unavailable');

const { defaultAgentDataSocket, verifyOsBoundary } = await import(pathToFileURL(join(packageRoot, 'agent-entry', 'os-boundary.mjs')).href);
const sameUidBoundary = verifyOsBoundary({ ownerUid, agentUid: ownerUid });
assert.equal(sameUidBoundary.state, 'disabled', 'same UID must never enable Agent data plane');
assert.ok(sameUidBoundary.reason_codes.includes('owner_agent_uid_not_separated'), 'same UID rejection must be explicit');
const root = await mkdtemp(join(tmpdir(), 'webenvoy-boundary-ci-'));
const ownerData = join(root, 'owner-data');
const ownerSocket = join(ownerData, 'owner-control.sock');
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
  const ownerSetup = run(cli, ['setup', '--data-dir', ownerData, '--agent-uid', String(agentUid)]);
  const bootstrap = lastJson(ownerSetup.stdout, 'owner_setup');
  const installation = JSON.parse(await readFile(join(ownerData, 'installation.json'), 'utf8'));
  await expectMissing(join(ownerData, 'owner.json'), 'owner setup must not persist an owner bearer file');
  assert.equal(installation.owner_uid, ownerUid, 'owner setup must persist the actual owner UID');
  assert.equal(installation.agent_uid, agentUid, 'owner setup must persist the actual Agent UID');
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
  await assertAgentCannotModifyBundle();

  agentHost = await mkdtempAsAgent(join('/tmp', `webenvoy-agent-host-${process.pid}-`));
  runAsAgent(cli, ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid), '--agent-endpoint', agentEndpoint]);
  clientFile = join(agentHost, 'webenvoy-client.json');
  const agentMeta = JSON.parse(runAsAgent(fixedNode, ['--input-type=module', '-e', agentMetadataScript, clientFile]).stdout);
  assert.equal(agentMeta.owner_uid, ownerUid);
  assert.equal(agentMeta.agent_uid, agentUid);
  assert.equal(agentMeta.agent_endpoint, agentEndpoint);
  assert.match(agentMeta.credential_fingerprint, /^[a-f0-9]{64}$/);
  await expectDenied(ownerData, 'Agent must not traverse owner data');
  await expectDenied(ownerSocket, 'Agent must not read owner control socket');
  await expectOwnerWriteDenied(agentHost, 'Owner must not write Agent host assets');

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
  const queriedBeforeStop = runAsAgent(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', 'standalone-ci-profile-list']);
  const queryBeforeStop = lastJson(queriedBeforeStop.stdout, 'agent_query_before_stop');
  assert.equal(findString(queryBeforeStop, ['run_id']), findString(operationResult, ['run_id']), 'query must address the original Run');
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
  const result = spawnSync(command, args, { cwd: packageRoot, encoding: 'utf8', timeout: 120_000, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`boundary_command_failed:${command}:${args.join(' ')}:${result.stderr || result.stdout}`);
  return result;
}

function runAsAgent(command, args) {
  return run('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', command, ...args]);
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

async function assertAgentOwnerRouteDenied(path) {
  const script = `import { readFile } from 'node:fs/promises'; import { request } from 'node:http'; const value = JSON.parse(await readFile(process.argv[1], 'utf8')); const req = request({ socketPath: value.agent_endpoint, path: '/agent-access', headers: { authorization: 'Bearer ' + value.credential } }, response => { let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk); response.on('end', () => { if (response.statusCode !== 403 || !body.includes('agent_route_denied')) process.exit(8); }); }); req.on('error', () => process.exit(9)); req.end();`;
  runAsAgent(fixedNode, ['--input-type=module', '-e', script, path]);
}
