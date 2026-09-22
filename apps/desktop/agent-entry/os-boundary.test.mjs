import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentDataSocket, classifyAdminMembership, classifySudoPolicy, isOwnerHarborRoute, ownerControlSocket, requiresControlPrecondition, verifyAgentSocket, verifyOsBoundary, verifyOwnerDataDirectory } from './os-boundary.mjs';

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

test('same UID and unverified identity fail closed', () => {
  const result = verifyOsBoundary({ ownerUid: process.getuid?.(), agentUid: process.getuid?.() });
  assert.equal(result.state, 'disabled');
  assert.equal(result.code, 'owner_agent_isolation_unavailable');
  assert.ok(result.reason_codes.includes('owner_agent_uid_not_separated'));
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

test('owner Harbor route allowlist distinguishes reads and control writes', () => {
  const route = (method, url) => ({ method, url });
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions?profile_ref=profile%3Aone')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions?other=1')), false);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session:one')), true);
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session:one/runtime-facts')), true);
  for (const action of ['handoff', 'lock', 'release', 'stop']) {
    assert.equal(isOwnerHarborRoute(route('POST', `/runtime/sessions/session:one/${action}`)), true);
  }
  assert.equal(isOwnerHarborRoute(route('GET', '/runtime/sessions/session:one/handoff')), false);
  assert.equal(requiresControlPrecondition(route('POST', '/runtime/sessions/session:one/handoff')), true);
  assert.equal(requiresControlPrecondition(route('POST', '/runtime/sessions/session:one/stop')), false);
});
