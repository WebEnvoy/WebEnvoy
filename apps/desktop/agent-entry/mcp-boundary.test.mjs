import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import test from 'node:test';
import { agentDataSocket } from './os-boundary.mjs';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(sourceRoot, '../../..');
const requiredAssets = [
  'agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs', 'agent-entry/os-boundary.mjs', 'agent-entry/request-validation.mjs',
  'agent-entry/managed-site-worker.mjs', 'agent-entry/managed-site-worker-supervisor.mjs',
  'agent-entry/managed-site-script-thread.mjs',
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
    const clientStub = `import { request } from 'node:http';\nimport { readFile } from 'node:fs/promises';\nexport async function readClient(path) { return JSON.parse(await readFile(path, 'utf8')); }\nexport async function ensureAgentRuntime() { return { ready: true }; }\nexport function agentRequest(client, path, options = {}) { return new Promise((resolve, reject) => { const req = request({ socketPath: client.agent_endpoint, path, method: options.method ?? 'GET', headers: { 'content-type': 'application/json', ...(client.credential ? { authorization: 'Bearer ' + client.credential } : {}) } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('aborted', () => reject(new Error('runtime_response_aborted'))); res.on('error', reject); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('runtime_response_invalid')); } }); }); req.on('error', reject); req.end(options.body === undefined ? undefined : JSON.stringify(options.body)); }); }\nexport async function runManagedSiteWorker(client, ticket) { return { ok: true, run: { run_id: ticket.run_id, status: 'succeeded', dispatch_state: 'dispatched' }, result: { ok: true, data: { result_kind: 'github_trending_daily_top5' } } }; }`;
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

test('MCP AccountSystem tool sends only the fixed read projection request', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-account-system-'));
  const { bundle, manifest } = await makeBundle({ stubClient: true });
  const clientPath = join(dataDir, 'client.json');
  const socketPath = agentDataSocket(dataDir);
  await writeFile(clientPath, JSON.stringify({ data_dir: dataDir, credential: 'c'.repeat(32), agent_endpoint: socketPath }), { mode: 0o600 });
  const received = [];
  const projection = {
    schema_version: 'webenvoy.account-system-agent-projection.v1', local_definition_ref: 'local-account-definition:github',
    local_revision_ref: 'local-account-definition-revision:github:1', template_ref: 'lode://account-system/github@1.0.0',
    template_sha256: 'a'.repeat(64), source: { publisher: 'WebEnvoy', repository: 'Lode', path: 'account-systems/github', version: '1.0.0' },
    site: { account_system_id: 'github', version: '1.0.0', display_name: 'GitHub', related_domains: ['github.com'], products: [], login_entry: 'https://github.com/login', admin_entry_points: [] },
    identity_state: 'unknown', evaluation_state: 'not_evaluated'
  };
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ path: request.url, body: body ? JSON.parse(body) : undefined });
      const result = request.url === '/status'
        ? { ready: true, assets: { digest: sha(JSON.stringify(manifest)) } }
        : request.url === '/agent-connections'
          ? { ok: true, connection: { connection_id: 'connection:account-test', principal_id: 'principal:account-test' } }
          : request.url === '/managed-account-systems/operations'
            ? { ok: true, result: projection }
            : { ok: false, error: { code: 'not_found' } };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result));
    });
  });
  const child = spawn(process.execPath, [join(bundle, 'agent-entry/mcp.mjs'), clientPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let startupError = '';
  child.stderr.on('data', value => { startupError += value; });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const call = async (id, method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const line = await lines.next();
    assert.equal(line.done, false, startupError);
    return JSON.parse(line.value);
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const listed = await call(1, 'tools/list');
    assert.ok(listed.result.tools.some(tool => tool.name === 'webenvoy_account_system'));
    const taskTool = listed.result.tools.find(tool => tool.name === 'webenvoy_task');
    assert.match(taskTool.description, /trusted_local refuses them/);
    assert.match(taskTool.description, /never the worker ticket or script source/);
    const malformed = await call(2, 'tools/call', { name: 'webenvoy_account_system', arguments: { grant_id: 'grant:account', template_ref: 'lode://account-system/github@1.0.0', task_scope: { operations: ['identity.read'] } } });
    assert.equal(malformed.result.isError, true);
    assert.equal(malformed.result.content[0].text, 'account_system_input_refused');
    assert.equal(received.length, 0, 'malformed AccountSystem requests must fail before connecting or sending an operation');
    const connected = await call(3, 'tools/call', { name: 'webenvoy_connect', arguments: {} });
    assert.equal(JSON.parse(connected.result.content[0].text).connection.connection_id, 'connection:account-test');
    const read = await call(4, 'tools/call', { name: 'webenvoy_account_system', arguments: { grant_id: 'grant:account', template_ref: 'lode://account-system/github@1.0.0' } });
    const value = JSON.parse(read.result.content[0].text);
    assert.deepEqual(value.result, projection);
    const operation = received.find(item => item.path === '/managed-account-systems/operations');
    assert.deepEqual(operation.body, {
      schema_version: 'webenvoy.account-system-agent-operation/v1', operation: 'account_system.read',
      connection_id: 'connection:account-test', grant_id: 'grant:account', template_ref: 'lode://account-system/github@1.0.0'
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  }
});

test('MCP consumes a worker ticket internally and returns only the final Run projection', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-managed-worker-'));
  const { bundle, manifest } = await makeBundle({ stubClient: true });
  const clientPath = join(dataDir, 'client.json');
  const socketPath = agentDataSocket(dataDir);
  await writeFile(clientPath, JSON.stringify({ data_dir: dataDir, credential: 'c'.repeat(32), agent_endpoint: socketPath }), { mode: 0o600 });
  const scriptSource = 'export async function run() { /* approved package source */ }';
  const runId = 'managed-' + 'a'.repeat(64);
  const requests = [];
  const server = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ path: request.url, body: body ? JSON.parse(body) : undefined });
    const result = request.url === '/agent-connections'
      ? { ok: true, connection: { connection_id: 'connection:worker-test', principal_id: 'principal:worker-test' } }
      : request.url === '/managed-tasks/operations'
        ? { ok: true, run: { run_id: runId, status: 'running', dispatch_state: 'not_dispatched' }, worker_execution: { ticket: {
          ticket_id: 'worker-ticket-00000001', run_id: runId, script: { source: scriptSource }
        } } }
        : { ok: false, error: { code: 'unexpected_route' } };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result));
  });
  const child = spawn(process.execPath, [join(bundle, 'agent-entry/mcp.mjs'), clientPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let startupError = '';
  child.stderr.on('data', value => { startupError += value; });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const call = async (id, name, args = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    const line = await lines.next();
    assert.equal(line.done, false, startupError);
    return JSON.parse(line.value);
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await call(1, 'webenvoy_connect');
    const submitted = await call(2, 'webenvoy_task', {
      schema_version: 'webenvoy.managed-task-operation/v1', operation: 'task.submit', idempotency_key: 'daily-trending-001', grant_id: 'grant:worker-test',
      task_scope: { operations: ['task.submit'], skill_refs: ['lode://site-skill/github/trending'],
        source_refs: ['lode://site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433'],
        profile_refs: ['profile:github'], origins: ['https://github.com'] },
      package: { package_ref: 'lode://site-skill/github/trending', revision_ref: 'lode://site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433',
        package_digest: 'sha256:' + 'a'.repeat(64), task_ref: 'read-daily-trending-top5' },
      target: { target_type: 'web_page', target_ref: 'target:github-trending' },
      input: { schema_ref: 'lode://schema/site-skill/github/trending/daily-top5/input@1.0.0', carrier: 'none' },
      intent: { summary: 'Read GitHub daily trending top five.', policy: { risk: 'read', execution_intent: 'read', timeout_ms: 10000 } }
    });
    assert.equal(submitted.result.isError, undefined);
    const publicResult = JSON.parse(submitted.result.content[0].text);
    assert.equal(publicResult.run.run_id, runId);
    assert.equal(publicResult.run.status, 'succeeded');
    assert.equal(Object.hasOwn(publicResult, 'worker_execution'), false);
    assert.equal(JSON.stringify(publicResult).includes(scriptSource), false);
    assert.deepEqual(requests.map(item => item.path), ['/agent-connections', '/managed-tasks/operations']);
    assert.equal(requests[1].body.connection_id, 'connection:worker-test');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
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
