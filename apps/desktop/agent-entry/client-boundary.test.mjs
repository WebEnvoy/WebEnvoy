import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentRequest, ownerRequest, readClient } from './client.mjs';
import { ownerControlSocket } from './os-boundary.mjs';

async function socketServer(socketPath, onRequest) {
  const server = createServer(socket => socket.once('data', chunk => {
    const request = chunk.toString('utf8');
    const body = JSON.stringify(onRequest(request));
    socket.end(Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`));
  }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return server;
}

test('owner transport never forwards a bearer and Agent transport does', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-client-boundary-'));
  const ownerSocket = ownerControlSocket(dataDir);
  const agentSocket = join(dataDir, 'agent.sock');
  const requests = [];
  let ownerServer;
  let agentServer;
  try {
    ownerServer = await socketServer(ownerSocket, request => { requests.push(['owner', request]); return { role: 'owner' }; });
    assert.deepEqual(await ownerRequest(dataDir, '/status'), { role: 'owner' });
    assert.throws(() => ownerRequest(dataDir, '/status', { credential: 'owner-secret' }), /owner_credential_forbidden/);
    agentServer = await socketServer(agentSocket, request => { requests.push(['agent', request]); return { role: 'agent' }; });
    assert.deepEqual(await agentRequest(agentSocket, '/status', { owner_uid: process.getuid?.(), credential: 'c'.repeat(32) }), { role: 'agent' });
    assert.match(requests.find(([role]) => role === 'owner')[1], /^GET \/status HTTP\/1\.1[\s\S]*\r\n\r\n$/);
    assert.doesNotMatch(requests.find(([role]) => role === 'owner')[1], /authorization:/i);
    assert.match(requests.find(([role]) => role === 'agent')[1], /authorization: Bearer c{32}/i);
  } finally {
    await Promise.all([ownerServer && new Promise(resolve => ownerServer.close(resolve)), agentServer && new Promise(resolve => agentServer.close(resolve))]);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('new client files cannot point Agent transport at the owner socket', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-client-config-'));
  const clientPath = join(dataDir, 'webenvoy-client.json');
  try {
    await writeFile(clientPath, JSON.stringify({
      data_dir: dataDir,
      credential: 'c'.repeat(32),
      agent_endpoint: ownerControlSocket(dataDir),
      owner_uid: process.getuid?.(),
      agent_uid: process.getuid?.() + 1
    }), { mode: 0o600 });
    await assert.rejects(() => readClient(clientPath), /client_configuration_invalid/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('new client files keep the Agent endpoint outside owner-private data', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-client-boundary-'));
  const clientPath = join(dataDir, 'webenvoy-client.json');
  try {
    await writeFile(clientPath, JSON.stringify({
      data_dir: dataDir,
      credential: 'c'.repeat(32),
      agent_endpoint: join(dataDir, 'agent.sock'),
      owner_uid: process.getuid?.() + 1,
      agent_uid: process.getuid?.()
    }), { mode: 0o600 });
    await assert.rejects(() => readClient(clientPath), /client_configuration_invalid/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
