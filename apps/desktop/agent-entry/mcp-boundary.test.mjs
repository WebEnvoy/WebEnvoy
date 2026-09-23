import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import { agentDataSocket } from './os-boundary.mjs';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(sourceRoot, '../../..');
const requiredAssets = [
  'agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs', 'agent-entry/os-boundary.mjs', 'agent-entry/request-validation.mjs',
  'agent-entry/managed-capability-definitions.json', 'agent-entry/skills/webenvoy-browser/SKILL.md',
  'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs',
  'dist-electron/runtime/harbor/dist/packages/runtime-api/src/playwright_shared_driver.py',
  'dist-electron/runtime/harbor/dist/packages/runtime-api/src/camoufox-upstream-driver.py',
  'dist-electron/runtime/harbor/dist/packages/runtime-api/src/chrome_official_driver.py'
];

function sha(value) { return createHash('sha256').update(value).digest('hex'); }

async function makeBundle({ stubClient = false } = {}) {
  const bundle = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-boundary-bundle-'));
  const files = {};
  for (const name of requiredAssets) {
    const target = join(bundle, name);
    await mkdir(dirname(target), { recursive: true });
    const source = join(repoRoot, name === 'agent-entry/managed-capability-definitions.json' ? 'packages/core/src/managed-capability-definitions.json' : name.startsWith('agent-entry/') ? `apps/desktop/${name}` : name);
    try { await copyFile(source, target); } catch (error) {
      if (name.startsWith('dist-electron/')) await writeFile(target, 'fixture');
      else throw error;
    }
    files[name] = sha(await readFile(target));
  }
  if (stubClient) {
    const clientStub = `import { request } from 'node:http';\nimport { readFile } from 'node:fs/promises';\nexport async function readClient(path) { return JSON.parse(await readFile(path, 'utf8')); }\nexport async function ensureAgentRuntime() { return { ready: true }; }\nexport function agentRequest(client, path, options = {}) { return new Promise((resolve, reject) => { const req = request({ socketPath: client.agent_endpoint, path, method: options.method ?? 'GET', headers: { 'content-type': 'application/json', ...(client.credential ? { authorization: 'Bearer ' + client.credential } : {}) } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('aborted', () => reject(new Error('runtime_response_aborted'))); res.on('error', reject); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('runtime_response_invalid')); } }); }); req.on('error', reject); req.end(options.body === undefined ? undefined : JSON.stringify(options.body)); }); }`;
    await writeFile(join(bundle, 'agent-entry/client.mjs'), clientStub);
    files['agent-entry/client.mjs'] = sha(clientStub);
  }
  const manifest = { schema: 'webenvoy-installed-agent/v1', version: '0.2.0', skill_version: '0.2.0', files };
  await writeFile(join(bundle, 'agent-manifest.json'), JSON.stringify(manifest));
  return { bundle, manifest };
}

function response(socket, payload, status = '200 OK') {
  const body = Buffer.from(JSON.stringify(payload));
  socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body]));
}

test('MCP rejects malformed operation before Agent status/connect', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-input-'));
  const { bundle } = await makeBundle();
  const clientPath = join(dataDir, 'client.json');
  await writeFile(clientPath, JSON.stringify({ data_dir: dataDir, credential: 'c'.repeat(32), agent_endpoint: agentDataSocket(dataDir), owner_uid: 1, agent_uid: 2 }), { mode: 0o600 });
  const child = spawn(process.execPath, [join(bundle, 'agent-entry/mcp.mjs'), clientPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let startupError = '';
  child.stderr.on('data', value => { startupError += value; });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'webenvoy_operation', arguments: { owner_secret: 'forbidden' } } }) + '\n');
    const line = await lines.next();
    assert.equal(line.done, false, startupError);
    const envelope = JSON.parse(line.value);
    assert.equal(envelope.result.isError, true);
    assert.equal(envelope.result.content[0].text, 'operation_input_refused');
  } finally {
    child.kill('SIGTERM');
    await rm(dataDir, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  }
});

test('MCP preserves the original idempotency key when an operation response is lost', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-unknown-'));
  const { bundle, manifest } = await makeBundle({ stubClient: true });
  const clientPath = join(dataDir, 'client.json');
  const socketPath = agentDataSocket(dataDir);
  await writeFile(clientPath, JSON.stringify({ data_dir: dataDir, credential: 'c'.repeat(32), agent_endpoint: socketPath }), { mode: 0o600 });
  const server = createServer(socket => {
    socket.once('data', chunk => {
      const path = chunk.toString('utf8').split('\r\n', 1)[0].split(' ')[1];
      if (path === '/managed-browser/operations') return socket.destroy();
      if (path === '/status') return response(socket, { ready: true, assets: { digest: sha(JSON.stringify(manifest)) } });
      if (path === '/agent-connections') return response(socket, { ok: true, connection: { connection_id: 'connection:fixture', principal_id: 'principal:fixture' } });
      return response(socket, { ok: false, error: { code: 'not_found' } }, '404 Not Found');
    });
  });
  const child = spawn(process.execPath, [join(bundle, 'agent-entry/mcp.mjs'), clientPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let startupError = '';
  child.stderr.on('data', value => { startupError += value; });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const call = async (id, name, args) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    const line = await lines.next();
    assert.equal(line.done, false, startupError);
    return JSON.parse(line.value);
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const connected = await call(1, 'webenvoy_connect', {});
    assert.equal(JSON.parse(connected.result.content[0].text).ok, true);
    const unknown = await call(2, 'webenvoy_operation', { idempotency_key: 'original-key', grant_id: 'grant', operation: 'profile.list', task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] } });
    const value = JSON.parse(unknown.result.content[0].text);
    assert.equal(value.status, 'unknown_outcome');
    assert.equal(value.dispatch_state, 'dispatched');
    assert.equal(value.idempotency_key, 'original-key');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  }
});
