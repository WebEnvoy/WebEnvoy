import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRequest } from './client.mjs';
import { REQUIRED_DRIVER_ASSETS, root, sha } from './bundle.mjs';

test('localRequest preserves UTF-8 when a socket response splits a code point', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-client-test-'));
  const socketPath = join(dataDir, 'runtime.sock');
  const server = createServer(socket => {
    socket.setNoDelay(true);
    socket.once('data', () => {
      const payload = Buffer.from(JSON.stringify({ ok: true, text: '时间和范围' }), 'utf8');
      const splitAt = payload.indexOf(Buffer.from('间', 'utf8')) + 1;
      const header = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`, 'ascii');
      socket.write(header);
      socket.write(payload.subarray(0, splitAt), () => setTimeout(() => socket.end(payload.subarray(splitAt)), 20));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  try {
    assert.deepEqual(await localRequest(dataDir, '/status'), { ok: true, text: '时间和范围' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('MCP guidance exposes instance.start origin admission', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-schema-test-'));
  const clientPath = join(dataDir, 'client.json');
  let child;
  try {
    await writeFile(clientPath, JSON.stringify({ data_dir: dataDir, credential: 'c'.repeat(32) }));
    child = spawn(process.execPath, [join(root, 'agent-entry/mcp.mjs'), clientPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const responsePromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', chunk => { try { resolve(JSON.parse(chunk.toString('utf8'))); } catch (error) { reject(error); } });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
    const response = await responsePromise;
    const operation = response.result.tools.find(tool => tool.name === 'webenvoy_operation');
    assert.ok(operation);
    assert.match(operation.description, /task_scope describes this submitted operation only/);
    assert.match(operation.description, /file_refs is allowed only for the current file\.upload or file\.download operation/);
    assert.match(operation.description, /instance\.start requires the exact authorized origin as a top-level origin field/);
    assert.equal(operation.inputSchema.required.includes('origin'), false);
    const fileScopeCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.enum?.includes('file.upload'));
    assert.ok(fileScopeCondition);
    assert.deepEqual(fileScopeCondition.if.properties.operation.enum, ['file.upload', 'file.download']);
    assert.equal(operation.inputSchema.properties.task_scope.properties.file_refs, undefined);
    assert.match(operation.inputSchema.properties.task_scope.description, /single submitted operation/);
    assert.match(operation.inputSchema.properties.task_scope.properties.operations.description, /current operation/);
    assert.equal(fileScopeCondition.else.properties.task_scope.properties.file_refs, undefined);
    assert.equal(fileScopeCondition.else.properties.task_scope.additionalProperties, false);
    assert.ok(fileScopeCondition.then.properties.task_scope.properties.file_refs);
    assert.match(fileScopeCondition.then.properties.task_scope.properties.file_refs.description, /Omit this field for every non-file operation/);
    assert.equal(fileScopeCondition.then.properties.task_scope.additionalProperties, false);
    for (const field of ['profile_ref', 'runtime_session_ref', 'origin', 'page_id', 'page_ref', 'document_generation', 'observation_ref', 'target_ref']) {
      assert.match(operation.inputSchema.properties[field].description, /file\.upload\/file\.download/);
    }
    assert.match(operation.inputSchema.properties.file_ref.description, /Only for file\.upload/);
    const skill = await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8');
    assert.match(skill, /`instance\.start` specifically requires the exact authorized origin in the top-level `origin` field/);
    assert.match(skill, /The operation must carry the fresh same-observation `profile_ref`, `runtime_session_ref`, exact `origin`, `page_id`, `page_ref`, `document_generation`, `observation_ref`, and `target_ref`/);
    assert.match(skill, /omit `file_ref` and use `task_scope\.file_refs: \[\]`/);
  } finally {
    if (child) { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('MCP status omits private Camoufox artifact binding while preserving runtime status', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-status-test-'));
  const bundleRoot = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-bundle-test-'));
  const socketPath = join(dataDir, 'runtime.sock');
  const clientPath = join(dataDir, 'client.json');
  const files = [
    'agent-entry/mcp.mjs',
    'agent-entry/client.mjs',
    'agent-entry/service.mjs',
    'agent-entry/bundle.mjs',
    'agent-entry/skills/webenvoy-browser/SKILL.md',
    'dist-electron/runtime/core/start-runtime.mjs',
    'dist-electron/runtime/harbor/start-runtime.mjs',
    ...REQUIRED_DRIVER_ASSETS
  ];
  let server;
  let child;
  try {
    for (const name of files) {
      const target = join(bundleRoot, name);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(root, name), target);
    }
    const manifest = { schema: 'webenvoy-installed-agent/v1', version: '0.2.0', skill_version: '0.2.0', files: Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await readFile(join(bundleRoot, name)))]))) };
    await writeFile(join(bundleRoot, 'agent-manifest.json'), JSON.stringify(manifest));
    const status = {
      ready: true,
      runtime_id: 'runtime-status-test',
      pid: 123,
      coreEndpoint: 'http://127.0.0.1:1234',
      harborEndpoint: 'http://127.0.0.1:5678',
      assets: { digest: sha(JSON.stringify(manifest)), version: manifest.version, integrity: 'verified' },
      services: [{ id: 'core', pid: 1 }, { id: 'harbor', pid: 2 }],
      camoufox_launch: { state: 'retired', reason: 'retired_binding' },
      camoufoxArtifact: { app: '/private/Camoufox Native Test.app', executable: '/private/Camoufox Native Test.app/Contents/MacOS/camoufox', manifest: '/private/Camoufox Native Test.app/Contents/Resources/webenvoy-native-manifest.json', manifest_sha256: 'a'.repeat(64) }
    };
    await writeFile(clientPath, JSON.stringify({ data_dir: dataDir, credential: 'c'.repeat(32) }));
    server = createServer(socket => {
      socket.once('data', () => {
        const payload = Buffer.from(JSON.stringify(status));
        socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`), payload]));
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    child = spawn(process.execPath, [join(bundleRoot, 'agent-entry/mcp.mjs'), clientPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const responsePromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', chunk => { try { resolve(JSON.parse(chunk.toString('utf8'))); } catch (error) { reject(error); } });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'webenvoy_status', arguments: {} } }) + '\n');
    const response = await responsePromise;
    assert.equal(response.result.isError, undefined, response.result.content?.[0]?.text);
    const publicStatus = JSON.parse(response.result.content[0].text);
    assert.equal(publicStatus.ready, true);
    assert.deepEqual(publicStatus.services, status.services);
    assert.equal(publicStatus.assets.digest, status.assets.digest);
    assert.deepEqual(publicStatus.camoufox_launch, status.camoufox_launch);
    assert.equal(Object.hasOwn(publicStatus, 'camoufoxArtifact'), false);
  } finally {
    if (child) { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); }
    if (server) await new Promise(resolve => server.close(resolve));
    await Promise.all([rm(dataDir, { recursive: true, force: true }), rm(bundleRoot, { recursive: true, force: true })]);
  }
});
