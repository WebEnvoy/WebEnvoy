import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentDataSocket, classifyAdminMembership, classifySudoPolicy, isOwnerHarborRoute, ownerControlSocket, prepareRuntimeSocket, probeUnixSocket, requiresControlPrecondition, verifyAgentBundleBoundary, verifyAgentSocket, verifyLiveOsBoundary, verifyOsBoundary, verifyOwnerDataDirectory } from './os-boundary.mjs';

test('owner and Agent endpoints use separate trust domains', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-boundary-'));
  try {
    assert.equal(ownerControlSocket(dataDir), join(dataDir, 'owner-control.sock'));
    const agentSocket = agentDataSocket({ data_dir: dataDir });
    assert.ok(agentSocket.startsWith('/tmp/webenvoy-agent-'));
    assert.equal(agentSocket.startsWith(`${dataDir}/`), false);
    assert.ok(Buffer.byteLength(agentSocket) < 104);
    const explicit = join(tmpdir(), 'webenvoy-explicit-agent.sock');
    assert.equal(agentDataSocket({ data_dir: dataDir, agent_endpoint: explicit }), explicit);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('same UID uses the trusted local domain without claiming OS isolation', () => {
  const result = verifyOsBoundary({ ownerUid: process.getuid?.(), agentUid: process.getuid?.() });
  assert.equal(result.mode, 'trusted_local');
  assert.equal(result.identity.process_inspection, 'trusted_same_uid');
  assert.equal(result.asset_boundary.state, 'trusted_user_domain');
  assert.ok(!result.reason_codes.includes('owner_agent_uid_not_separated'));
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    assert.equal(result.state, 'disabled');
    assert.ok(result.reason_codes.includes('owner_socket_acl_unavailable'));
  } else {
    assert.equal(result.state, 'disabled');
    assert.ok(result.reason_codes.includes('platform_unsupported'));
  }
});

test('distinct UID reports unverified and fails closed when hardening checks fail', () => {
  const ownerUid = process.getuid?.();
  const agentUid = ownerUid + 1_000_000;
  const result = verifyOsBoundary({ ownerUid, agentUid, ownerSocketPath: '/missing/webenvoy-owner.sock', installRoot: '/missing/webenvoy-agent-bundle' });
  assert.equal(result.mode, 'distinct_uid_unverified');
  assert.equal(result.state, 'disabled');
  assert.ok(!result.reason_codes.includes('owner_agent_uid_not_separated'));
  assert.ok(result.reason_codes.includes('agent_uid_unverified'));
  assert.ok(result.reason_codes.includes('agent_process_inspection_policy_unavailable'));
});

test('sudo policy classification uses the target user text, not only exit status', () => {
  assert.equal(classifySudoPolicy({ name: 'nobody', status: 0, stdout: 'User nobody is not allowed to run sudo on host.' }), 'denied');
  assert.equal(classifySudoPolicy({ name: 'nobody', status: 1, stderr: 'sudo: a password is required' }), 'unknown');
  assert.equal(classifySudoPolicy({ name: 'claw', status: 0, stdout: 'User claw may run the following commands on host:' }), 'allowed');
  assert.equal(classifySudoPolicy({ name: 'agent', status: 0, stdout: 'User nobody is not allowed to run sudo on host.' }), 'unknown');
});

test('admin membership requires an explicit dsmemberutil denial', () => {
  assert.equal(classifyAdminMembership('User agent is not a member of admin.'), false);
  assert.equal(classifyAdminMembership('User agent is a member of admin.'), true);
  assert.equal(classifyAdminMembership('membership check unavailable'), undefined);
});

test('owner data directory is an actual owner-only directory', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-owner-data-'));
  try {
    assert.equal(verifyOwnerDataDirectory(dataDir).state, 'verified');
    await chmod(dataDir, 0o750);
    assert.throws(() => verifyOwnerDataDirectory(dataDir), /owner_data_dir_invalid/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('bundle boundary disables writable assets and parents while allowing missing optional assets', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async () => {
  const ownerUid = process.getuid?.();
  const agentUid = Number(execFileSync('/usr/bin/id', ['-u', 'nobody'], { encoding: 'utf8' }).trim());
  const agentName = execFileSync('/usr/bin/id', ['-nu', String(agentUid)], { encoding: 'utf8' }).trim();
  const grantSocketAccess = (path) => {
    execFileSync('/bin/chmod', ['+a', `user:${agentName} allow read,write`, path]);
    const acl = execFileSync('/bin/ls', ['-le', path], { encoding: 'utf8' }).split('\n').filter(line => /^\s*\d+:/.test(line));
    assert.deepEqual(acl.map(line => line.trim()), [`0: user:${agentName} allow read,write`]);
  };
  if (!Number.isSafeInteger(ownerUid) || ownerUid < 1 || !Number.isSafeInteger(agentUid) || agentUid < 1 || ownerUid === agentUid) return;
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-bundle-boundary-'));
  const assets = ['agent-manifest.json', 'agent-entry/cli.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs',
    'agent-entry/managed-site-worker.mjs', 'agent-entry/managed-site-script-thread.mjs', 'agent-entry/managed-site-worker-supervisor.mjs',
    'bin/webenvoy', 'runtime/node'];
  const optional = 'agent-entry/skill-assets/optional.txt';
  let ownerServer;
  let agentServer;
  let dataDir;
  try {
    const directories = new Set([...assets.map(path => dirname(join(root, path))), dirname(join(root, optional))]);
    await Promise.all([...directories].map(path => mkdir(path, { recursive: true, mode: 0o755 })));
    for (const path of assets) await writeFile(join(root, path), path === 'agent-manifest.json' ? JSON.stringify({ files: Object.fromEntries(assets.map(name => [name, 'a'.repeat(64)])), optional_files: { [optional]: 'b'.repeat(64) } }) : 'fixture', { mode: path === 'runtime/node' || path === 'bin/webenvoy' ? 0o755 : 0o644 });
    await writeFile(join(root, optional), 'optional', { mode: 0o644 });
    const supported = verifyAgentBundleBoundary({ installRoot: root, ownerUid, agentUid });
    assert.equal(supported.state, 'supported', JSON.stringify(supported));
    const asset = join(root, 'agent-entry/service.mjs');
    await chmod(asset, 0o666);
    const writableAsset = verifyAgentBundleBoundary({ installRoot: root, ownerUid, agentUid });
    assert.equal(writableAsset.state, 'disabled');
    assert.ok(writableAsset.reason_codes.includes('agent_bundle_asset_writable'));
    await chmod(asset, 0o644);
    const parent = join(root, 'agent-entry');
    await chmod(parent, 0o777);
    const writableParent = verifyAgentBundleBoundary({ installRoot: root, ownerUid, agentUid });
    assert.equal(writableParent.state, 'disabled');
    assert.ok(writableParent.reason_codes.includes('agent_bundle_asset_parent_replaceable'));
    await chmod(parent, 0o755);
    await unlink(join(root, optional));
    const missingOptional = verifyAgentBundleBoundary({ installRoot: root, ownerUid, agentUid });
    assert.equal(missingOptional.state, 'supported', JSON.stringify(missingOptional));
    await writeFile(join(root, optional), 'optional', { mode: 0o644 });
    assert.equal(verifyAgentBundleBoundary({ installRoot: root, ownerUid, agentUid }).state, 'supported');

    dataDir = await mkdtemp('/tmp/wb-live-owner-');
    const ownerSocket = join(dataDir, 'owner-control.sock');
    const agentSocket = join(dataDir, 'agent-data.sock');
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700);
    ownerServer = createServer();
    await new Promise((resolve, reject) => { ownerServer.once('error', reject); ownerServer.listen(ownerSocket, resolve); });
    await chmod(ownerSocket, 0o600);
    agentServer = createServer();
    await new Promise((resolve, reject) => { agentServer.once('error', reject); agentServer.listen(agentSocket, resolve); });
    await chmod(agentSocket, 0o600);
    grantSocketAccess(agentSocket);
    const live = verifyLiveOsBoundary({ dataDir, ownerUid, agentUid, ownerSocketPath: ownerSocket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true });
    assert.equal(live.state, 'supported', JSON.stringify(live));
    assert.equal(live.mode, 'distinct_uid_hardened');
    assert.equal(live.owner_transport, true);
    await chmod(ownerSocket, 0o666);
    const invalidSocket = verifyLiveOsBoundary({ dataDir, ownerUid, agentUid, ownerSocketPath: ownerSocket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true });
    assert.equal(invalidSocket.state, 'disabled', JSON.stringify(invalidSocket));
    assert.equal(invalidSocket.mode, 'distinct_uid_unverified');
    assert.equal(invalidSocket.owner_transport, false);
    assert.ok(invalidSocket.reason_codes.includes('owner_socket_acl_unavailable'));
    await chmod(ownerSocket, 0o600);
    await chmod(dataDir, 0o755);
    const invalidDataDir = verifyLiveOsBoundary({ dataDir, ownerUid, agentUid, ownerSocketPath: ownerSocket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true });
    assert.equal(invalidDataDir.state, 'disabled', JSON.stringify(invalidDataDir));
    assert.equal(invalidDataDir.mode, 'distinct_uid_unverified');
    assert.equal(invalidDataDir.owner_transport, false);
    assert.ok(invalidDataDir.reason_codes.includes('owner_data_dir_invalid'));
    await chmod(dataDir, 0o700);
    await new Promise(resolve => agentServer.close(resolve));
    agentServer = undefined;
    const missingAgent = verifyLiveOsBoundary({ dataDir, ownerUid, agentUid, ownerSocketPath: ownerSocket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true });
    assert.equal(missingAgent.state, 'disabled', JSON.stringify(missingAgent));
    assert.equal(missingAgent.mode, 'distinct_uid_unverified');
    assert.equal(missingAgent.agent_transport, false);
    assert.ok(missingAgent.reason_codes.includes('agent_socket_unavailable'));
    agentServer = createServer();
    await new Promise((resolve, reject) => { agentServer.once('error', reject); agentServer.listen(agentSocket, resolve); });
    await chmod(agentSocket, 0o600);
    grantSocketAccess(agentSocket);
    assert.equal(verifyLiveOsBoundary({ dataDir, ownerUid, agentUid, ownerSocketPath: ownerSocket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true }).state, 'supported');
  } finally {
    if (ownerServer) await new Promise(resolve => ownerServer.close(resolve));
    if (agentServer) await new Promise(resolve => agentServer.close(resolve));
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('Agent endpoint verification rejects files and symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webenvoy-boundary-socket-'));
  const file = join(directory, 'endpoint.sock');
  const link = join(directory, 'link.sock');
  try {
    await writeFile(file, 'not a socket');
    assert.throws(() => verifyAgentSocket(file), /agent_endpoint_invalid/);
    await symlink(file, link);
    assert.throws(() => verifyAgentSocket(link), /agent_endpoint_invalid/);
    await rm(file);
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(file, resolve); });
    await chmod(file, 0o600);
    assert.equal(verifyAgentSocket(file, { ownerUid: process.getuid?.() }).state, 'verified');
    await new Promise(resolve => server.close(resolve));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime socket preparation keeps live sockets and removes only proven stale sockets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webenvoy-boundary-probe-'));
  const livePath = join(directory, 'live.sock');
  const stalePath = join(directory, 'stale.sock');
  try {
    const liveServer = createServer();
    await new Promise((resolve, reject) => { liveServer.once('error', reject); liveServer.listen(livePath, resolve); });
    assert.deepEqual(await probeUnixSocket(livePath), { state: 'live' });
    await assert.rejects(prepareRuntimeSocket(livePath), /runtime_endpoint_occupied/);
    await new Promise(resolve => liveServer.close(resolve));
    assert.deepEqual(await probeUnixSocket(livePath), { state: 'missing' });
    const staleServer = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(process.argv[1], () => process.stdout.write('ready\\n'))", stalePath], { stdio: ['ignore', 'pipe', 'ignore'] });
    await once(staleServer.stdout, 'data');
    staleServer.kill('SIGKILL');
    await once(staleServer, 'exit');
    assert.deepEqual(await probeUnixSocket(stalePath), { state: 'stale' });
    assert.deepEqual(await prepareRuntimeSocket(stalePath), { state: 'removed' });
    assert.deepEqual(await probeUnixSocket(stalePath), { state: 'missing' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('owner Harbor route allowlist distinguishes reads and control writes', () => {
  const route = (method, url) => ({ method, url });
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions?profile_ref=profile%3Aone')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions?other=1')), false);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session:one')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session%3Aone')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session:one/runtime-facts')), true);
  for (const action of ['handoff', 'lock', 'release', 'stop']) {
    assert.equal(isOwnerHarborRoute(route('POST', `/runtime/sessions/session:one/${action}`)), true);
  }
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session:one/handoff')), false);
  assert.equal(requiresControlPrecondition(route('POST', '/runtime/sessions/session:one/handoff')), true);
  assert.equal(requiresControlPrecondition(route('POST', '/runtime/sessions/session%3Aone/handoff')), true);
  assert.equal(requiresControlPrecondition(route('POST', '/runtime/sessions/session:one/stop')), false);
  assert.equal(isOwnerHarborRoute(route('GET', 'http://attacker.invalid/runtime/sessions')), false);
  assert.equal(isOwnerHarborRoute(route('GET', '//attacker.invalid/runtime/sessions')), false);
  assert.equal(isOwnerHarborRoute(route('GET', '/\\attacker.invalid/runtime/sessions')), false);
  assert.equal(requiresControlPrecondition(route('POST', 'http://attacker.invalid/runtime/sessions/session:one/lock')), false);
});
