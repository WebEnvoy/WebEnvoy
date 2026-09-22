import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { Ajv2020 } from '../../../packages/schemas/node_modules/ajv/dist/2020.js';
import { localRequest } from './client.mjs';
import { REQUIRED_AGENT_ASSETS, REQUIRED_DRIVER_ASSETS, root, sha } from './bundle.mjs';

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const waitForExit = (timeout) => new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    child.once('exit', finish);
  });
  if (child.stdin && !child.stdin.destroyed) child.stdin.end();
  await waitForExit(2000);
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await waitForExit(1000);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForExit(1000);
  }
}

function firstJsonMessage(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.stdout.removeListener('data', onData);
      if (error) reject(error);
      else resolve(value);
    };
    const onError = error => finish(error);
    const onExit = (code, signal) => finish(new Error(`child_exited_before_response:${code ?? signal ?? 'unknown'}`));
    const onData = chunk => {
      try { finish(undefined, JSON.parse(chunk.toString('utf8'))); } catch (error) { finish(error); }
    };
    const timer = setTimeout(() => finish(new Error('child_response_timeout')), timeoutMs);
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout.once('data', onData);
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

const fixtureOwnerUid = () => (process.getuid?.() ?? 1) === 1 ? 2 : 1;
function fixtureClient(dataDir, agentEndpoint) {
  return {
    data_dir: dataDir,
    credential: 'c'.repeat(32),
    agent_endpoint: agentEndpoint,
    owner_uid: fixtureOwnerUid(),
    agent_uid: process.getuid?.() ?? 1
  };
}
async function writeFixtureClient(path, dataDir, agentEndpoint) {
  await writeFile(path, JSON.stringify(fixtureClient(dataDir, agentEndpoint)), { mode: 0o600 });
}

// These MCP projection fixtures intentionally mock only the client transport.
// They exercise MCP shape and no-fallback behavior; cross-UID IPC is covered by
// the macOS standalone lane and must not be inferred from this same-UID fixture.
const MOCK_CLIENT_MODULE = [
  "import { request } from 'node:http';",
  "import { readFile } from 'node:fs/promises';",
  "function endpoint(target) { return typeof target === 'string' ? target + '/runtime.sock' : target.agent_endpoint; }",
  "export async function readClient(path) { return JSON.parse(await readFile(path, 'utf8')); }",
  "export function localRequest(target, path, { method = 'GET', body, credential } = {}) {",
  "  return new Promise((resolve, reject) => {",
  "    const req = request({ socketPath: endpoint(target), path, method, headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) } }, response => {",
  "      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject); response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });",
  "    });",
  "    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));",
  "  });",
  "}",
  "export async function ensureRuntime(target) { return localRequest(target, '/status'); }"
].join('\n');
async function installMockClient(bundleRoot) {
  await writeFile(join(bundleRoot, 'agent-entry/client.mjs'), MOCK_CLIENT_MODULE);
}

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
    assert.deepEqual(await localRequest(socketPath, '/status'), { ok: true, text: '时间和范围' });
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
    await writeFixtureClient(clientPath, dataDir, join(tmpdir(), `webenvoy-agent-fixture-${process.pid}-${Date.now()}.sock`));
    child = spawn(process.execPath, [join(root, 'agent-entry/mcp.mjs'), clientPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const responsePromise = firstJsonMessage(child);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
    const response = await responsePromise;
    const operation = response.result.tools.find(tool => tool.name === 'webenvoy_operation');
    const describe = response.result.tools.find(tool => tool.name === 'webenvoy_describe');
    const definitions = JSON.parse(await readFile(join(root, 'agent-entry/managed-capability-definitions.json'), 'utf8'));
    assert.ok(operation);
    assert.ok(describe);
    assert.deepEqual(operation.inputSchema.properties.operation.enum, definitions.operations.filter(item => item.exposure === 'exposed').map(item => item.id));
    assert.equal(operation.inputSchema.properties.connection_id, undefined);
    assert.equal(describe.inputSchema.properties.operation.enum, undefined);
    assert.equal(describe.inputSchema.properties.arguments.properties.operation, undefined);
    assert.equal(describe.inputSchema.properties.arguments.properties.connection_id, undefined);
    const validateOperation = new Ajv2020({ allErrors: true, strict: false }).compile(operation.inputSchema);
    const snapshotSchemaFixture = {
      idempotency_key: 'schema-snapshot-limit', grant_id: 'grant:fixture', operation: 'instance.snapshot',
      task_scope: { operations: ['instance.snapshot'], profile_refs: ['profile:fixture'], origins: ['https://example.com'] },
      profile_ref: 'profile:fixture', origin: 'https://example.com', runtime_session_ref: 'session:fixture', limit: 128
    };
    assert.equal(validateOperation(snapshotSchemaFixture), true, JSON.stringify(validateOperation.errors));
    assert.equal(validateOperation({ ...snapshotSchemaFixture, idempotency_key: 'schema-diagnostics-limit', operation: 'instance.diagnostics', task_scope: { ...snapshotSchemaFixture.task_scope, operations: ['instance.diagnostics'] }, limit: 64 }), true, JSON.stringify(validateOperation.errors));
    assert.equal(validateOperation({ ...snapshotSchemaFixture, idempotency_key: 'schema-diagnostics-over-limit', operation: 'instance.diagnostics', task_scope: { ...snapshotSchemaFixture.task_scope, operations: ['instance.diagnostics'] }, limit: 65 }), false);
    assert.equal(validateOperation({ ...snapshotSchemaFixture, idempotency_key: 'schema-observe-limit', operation: 'instance.observe', task_scope: { ...snapshotSchemaFixture.task_scope, operations: ['instance.observe'] }, limit: 1 }), false);
    const operationConditions = operation.inputSchema.allOf.filter(condition => condition.if?.properties?.operation?.const);
    for (const definition of definitions.operations.filter(item => item.exposure === 'exposed')) {
      const condition = operationConditions.find(item => item.if.properties.operation.const === definition.id);
      assert.ok(condition, `${definition.id} generated operation condition`);
      assert.deepEqual(condition.then.required, definition.required, `${definition.id} required fields`);
      const forbidden = condition.then.not?.anyOf?.flatMap(item => item.required ?? []) ?? [];
      for (const field of Object.keys(definitions.fields)) {
        if (!definition.allowed.includes(field)) assert.ok(forbidden.includes(field), `${definition.id} forbids ${field}`);
      }
      for (const sourceCondition of definition.conditions ?? []) {
        if (sourceCondition.kind === 'conditional_fields') {
          assert.ok(condition.then.allOf?.some(item => item.if?.properties?.[sourceCondition.when.field]?.const === sourceCondition.when.equals), `${definition.id} conditional ${sourceCondition.when.field}`);
        } else if (sourceCondition.kind === 'page_selector' || sourceCondition.kind === 'same_origin') {
          assert.ok(condition.then['x-webenvoy-conditions']?.some(item => JSON.stringify(item) === JSON.stringify(sourceCondition)), `${definition.id} metadata condition`);
        }
      }
      if (definition.file_scope === 'upload') assert.deepEqual(condition.then['x-webenvoy-equals'], { left: 'task_scope.file_refs[0]', right: 'file_ref' });
    }
    assert.match(operation.description, /task_scope describes this submitted operation only/);
    assert.match(operation.description, /file_refs is allowed only for the current file\.upload or file\.download operation/);
    assert.match(operation.description, /instance\.start, instance\.observe, instance\.diagnostics/);
    for (const operationId of ['instance.snapshot', 'instance.click', 'instance.input', 'instance.press', 'instance.scroll', 'instance.wait']) {
      assert.match(operation.description, new RegExp(operationId.replace('.', '\\.')));
    }
    assert.equal(operation.inputSchema.required.includes('origin'), false);
    const fileScopeCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.enum?.includes('file.upload'));
    assert.ok(fileScopeCondition);
    assert.deepEqual(fileScopeCondition.if.properties.operation.enum, ['file.upload', 'file.download']);
    assert.ok(operation.inputSchema.properties.task_scope.properties.file_refs);
    assert.match(operation.inputSchema.properties.task_scope.description, /single submitted operation/);
    assert.match(operation.inputSchema.properties.task_scope.properties.operations.description, /current operation/);
    assert.equal(fileScopeCondition.else.properties.task_scope.properties.file_refs, undefined);
    assert.equal(fileScopeCondition.else.properties.task_scope.additionalProperties, false);
    assert.ok(fileScopeCondition.then.properties.task_scope.properties.file_refs);
    assert.match(fileScopeCondition.then.properties.task_scope.properties.file_refs.description, /Omit this field for every non-file operation/);
    assert.equal(fileScopeCondition.then.properties.task_scope.additionalProperties, false);
    const originCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.enum?.includes('instance.snapshot'));
    assert.ok(originCondition);
    assert.ok(originCondition.if.properties.operation.enum.includes('file.upload'));
    assert.deepEqual(originCondition.then.required, ['origin']);
    const pageOpenCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.const === 'page.open');
    assert.ok(pageOpenCondition);
    assert.equal(pageOpenCondition.then.required.includes('url'), false);
    const navigateCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.const === 'instance.navigate');
    assert.ok(navigateCondition.then.required.includes('url'));
    const waitCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.const === 'instance.wait');
    assert.ok(waitCondition.then.allOf.some(condition => condition.if?.properties?.wait_for?.const === 'enabled' && condition.then.required.includes('target_ref')));
    const textWaitCondition = waitCondition.then.allOf.find(condition => condition.if?.properties?.wait_for?.const === 'text');
    assert.equal(textWaitCondition.then.properties.text.minLength, 1);
    assert.equal(textWaitCondition.then.properties.text.maxLength, 256);
    const uploadCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.const === 'file.upload');
    assert.deepEqual(uploadCondition.then['x-webenvoy-equals'], { left: 'task_scope.file_refs[0]', right: 'file_ref' });
    const uploadScopeCondition = operation.inputSchema.allOf?.find(condition => condition.if?.properties?.operation?.enum?.includes('file.upload') && condition.then?.properties?.task_scope?.properties?.file_refs?.minItems === 1);
    assert.equal(uploadScopeCondition.then.properties.task_scope.required.includes('file_refs'), true);
    assert.match(operation.inputSchema.properties.origin.description, /task_scope\.origins is only the allowed set/);
    assert.deepEqual(operation.inputSchema.properties.delta_y.not, { const: 0 });
    assert.equal(operation.inputSchema.properties.configuration.additionalProperties, false);
    assert.ok(operation.inputSchema.allOf.find(condition => condition.if?.properties?.operation?.const === 'page.navigate').then['x-webenvoy-conditions'].some(condition => condition.kind === 'same_origin'));
    for (const field of ['profile_ref', 'runtime_session_ref', 'origin', 'page_id', 'page_ref', 'document_generation', 'observation_ref', 'target_ref']) {
      assert.equal(typeof operation.inputSchema.properties[field].description, 'string');
      assert.ok(operation.inputSchema.properties[field].description.length > 0);
    }
    assert.match(operation.inputSchema.properties.file_ref.description, /Only for file\.upload/);
    const skill = await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8');
    assert.match(skill, /`instance\.start`, `instance\.observe`, `instance\.diagnostics`/);
    assert.match(skill, /`instance\.snapshot\/click\/input\/press\/scroll\/wait`/);
    assert.match(skill, /The operation must carry the fresh same-observation `profile_ref`, `runtime_session_ref`, exact `origin`, `page_id`, `page_ref`, `document_generation`, `observation_ref`, and `target_ref`/);
    assert.match(skill, /omit `file_ref` and use `task_scope\.file_refs: \[\]`/);
  } finally {
    await stopChild(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('MCP describe does not start Runtime and does not fall back for an old Runtime', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-describe-test-'));
  const bundleRoot = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-describe-bundle-'));
  const socketPath = join(dataDir, 'runtime.sock');
  const clientPath = join(dataDir, 'client.json');
  const files = [
    'agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs',
    ...REQUIRED_AGENT_ASSETS,
    'agent-entry/skills/webenvoy-browser/SKILL.md',
    'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs',
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
    await installMockClient(bundleRoot);
    const manifest = { schema: 'webenvoy-installed-agent/v1', version: '0.2.0', skill_version: '0.2.0', files: Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await readFile(join(bundleRoot, name)))]))) };
    await writeFile(join(bundleRoot, 'agent-manifest.json'), JSON.stringify(manifest));
    await writeFixtureClient(clientPath, dataDir, socketPath);
    const requests = [];
    server = createServer(socket => socket.once('data', chunk => {
      const path = chunk.toString('utf8').split('\r\n', 1)[0].split(' ')[1];
      requests.push(path);
      const payload = path === '/status'
        ? { ready: true, assets: { digest: sha(JSON.stringify(manifest)) } }
        : path === '/agent-connections'
          ? { ok: true, connection: { connection_id: 'connection:fixture' }, grants: [] }
          : { ok: false, error: { code: 'managed_access_route_not_found' } };
      const body = Buffer.from(JSON.stringify(payload));
      socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 ${path === '/managed-browser/capabilities/describe' ? '404 Not Found' : '200 OK'}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body]));
    }));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    child = spawn(process.execPath, [join(bundleRoot, 'agent-entry/mcp.mjs'), clientPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
    const call = async (id, name, args = {}) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
      const line = await lines.next();
      return JSON.parse(JSON.parse(line.value).result.content[0].text);
    };
    assert.equal((await call(1, 'webenvoy_connect')).ok, true);
    const oldRuntime = await call(2, 'webenvoy_describe', { operation: 'instance.snapshot' });
    assert.equal(oldRuntime.error.code, 'discovery_not_available');
    assert.deepEqual(requests, ['/status', '/agent-connections', '/managed-browser/capabilities/describe']);
    await new Promise(resolve => server.close(resolve));
    server = undefined;
    const stoppedRuntime = await call(3, 'webenvoy_describe', { operation: 'instance.snapshot' });
    assert.equal(stoppedRuntime.error.code, 'runtime_unavailable');
    assert.deepEqual(requests, ['/status', '/agent-connections', '/managed-browser/capabilities/describe'], 'describe must not call status or a fallback route');
    await assert.rejects(lstat(socketPath), error => error?.code === 'ENOENT');
  } finally {
    await stopChild(child);
    if (server) await new Promise(resolve => server.close(resolve));
    await Promise.all([rm(dataDir, { recursive: true, force: true }), rm(bundleRoot, { recursive: true, force: true })]);
  }
});

test('MCP validates capability description states and forwards correction guidance', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-description-state-test-'));
  const bundleRoot = await mkdtemp(join(tmpdir(), 'webenvoy-mcp-description-state-bundle-'));
  const socketPath = join(dataDir, 'runtime.sock');
  const clientPath = join(dataDir, 'client.json');
  const files = [
    'agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs',
    ...REQUIRED_AGENT_ASSETS,
    'agent-entry/skills/webenvoy-browser/SKILL.md',
    'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs',
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
    await installMockClient(bundleRoot);
    const manifest = { schema: 'webenvoy-installed-agent/v1', version: '0.2.0', skill_version: '0.2.0',
      host: { electron_version: process.versions.electron ?? null, executable_sha256: sha(await readFile(process.execPath)) },
      files: Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await readFile(join(bundleRoot, name)))]))) };
    await writeFile(join(bundleRoot, 'agent-manifest.json'), JSON.stringify(manifest));
    await writeFixtureClient(clientPath, dataDir, socketPath);
    const definitions = JSON.parse(await readFile(join(root, 'agent-entry/managed-capability-definitions.json'), 'utf8'));
    const revision = `sha256:${createHash('sha256').update(canonical(definitions)).digest('hex')}`;
    const base = {
      ok: true,
      schema_version: 'webenvoy.capability-description/v1',
      operation: 'instance.snapshot',
      assessed_at: '2026-09-16T00:00:00.000Z',
      definition_revision: revision,
      mode: 'definition_only',
      definition: { state: 'defined', capability: 'observation' },
      invocation: { exposure: 'exposed' },
      provider: { state: 'not_evaluated' },
      authorization: { state: 'not_evaluated' },
      availability: { state: 'not_evaluated' },
      inputs: { state: 'not_provided' }
    };
    let unknownState;
    let correction = false;
    let operationResponse;
    server = createServer(socket => socket.once('data', chunk => {
      const path = chunk.toString('utf8').split('\r\n', 1)[0].split(' ')[1];
      const payload = path === '/status'
        ? { ready: true, assets: { digest: sha(JSON.stringify(manifest)) } }
        : path === '/agent-connections'
        ? { ok: true, connection: { connection_id: 'connection:fixture' }, grants: [] }
        : path === '/managed-browser/capabilities/describe'
          ? (() => {
            const value = JSON.parse(JSON.stringify(base));
            if (correction) {
              value.operation = 'file.download';
              value.inputs = { state: 'invalid', missing: [], invalid: [{ path: '/arguments/file_ref', code: 'unknown_field' }] };
              value.next_steps = [{ code: 'fill_inputs', actor: 'agent', operation: 'file.download', fields: ['/arguments/file_ref'] }];
            }
            if (unknownState === 'definition') value.definition.state = 'future_state';
            if (unknownState === 'exposure') value.invocation.exposure = 'future_state';
            if (unknownState === 'provider') value.provider.state = 'future_state';
            if (unknownState === 'authorization') value.authorization.state = 'future_state';
            if (unknownState === 'availability') value.availability.state = 'future_state';
            if (unknownState === 'inputs') value.inputs.state = 'future_state';
            return value;
          })()
          : path === '/managed-browser/operations'
            ? operationResponse
          : { ok: false, error: { code: 'unexpected_request' } };
      const body = Buffer.from(JSON.stringify(payload));
      socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body]));
    }));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    child = spawn(process.execPath, [join(bundleRoot, 'agent-entry/mcp.mjs'), clientPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
    const call = async (id, name, args = {}) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
      const line = await lines.next();
      return JSON.parse(JSON.parse(line.value).result.content[0].text);
    };
    assert.equal((await call(1, 'webenvoy_connect')).ok, true);
    assert.equal((await call(2, 'webenvoy_describe', { operation: 'instance.snapshot' })).ok, true);
    for (const field of ['definition', 'exposure', 'provider', 'authorization', 'availability', 'inputs']) {
      unknownState = field;
      assert.deepEqual(await call(3, 'webenvoy_describe', { operation: 'instance.snapshot' }), { ok: false, error: { code: 'discovery_version_mismatch' } }, field);
    }
    unknownState = undefined;
    correction = true;
    const corrected = await call(4, 'webenvoy_describe', { operation: 'file.download', arguments: { file_ref: 'attachment:runtime/11111111-1111-4111-8111-111111111111' } });
    assert.deepEqual(corrected.inputs.invalid, [{ path: '/arguments/file_ref', code: 'unknown_field' }]);
    assert.equal(corrected.next_steps[0].fields.includes('/arguments/file_ref'), true);
    const snapshotInput = { idempotency_key: 'snapshot-format', grant_id: 'grant:fixture', operation: 'instance.snapshot',
      task_scope: { operations: ['instance.snapshot'], profile_refs: ['profile:fixture'], origins: ['https://example.test'] },
      profile_ref: 'profile:fixture', origin: 'https://example.test', runtime_session_ref: 'session:fixture' };
    operationResponse = { ok: true, run_id: `managed-${'a'.repeat(64)}`, status: 'succeeded', result: { snapshot: { page_ref: 'page:old', observation_ref: 'observation:old', controls: [], text: '', truncated: false } } };
    assert.equal((await call(5, 'webenvoy_operation', snapshotInput)).error.code, 'observation_format_unavailable');
    operationResponse = { ok: true, run_id: `managed-${'b'.repeat(64)}`, status: 'succeeded', result: { snapshot: {
      schema_version: 'harbor-observation-targets/v1', page_id: 'page:fixture', page_ref: 'page-ref:fixture', document_generation: 1,
      observation_ref: 'observation:fixture', captured_at: '2026-09-17T00:00:00.000Z', controls: [], text: '', truncated: false,
      coverage: { scope: 'main_document_light_dom', excluded: ['child_frames', 'shadow_roots', 'virtualized_not_in_dom'],
        controls: { enumeration_complete: true, captured_count: 0, total: 0, returned_through: 0, complete: true, reason_codes: [] },
        text: { state: 'complete', returned_bytes: 0 }, semantics: { complete: true, reason_codes: [] } },
      continuation: { offset: 0, returned_count: 0, has_more: false, next_cursor: null }
    } } };
    assert.equal((await call(6, 'webenvoy_operation', { ...snapshotInput, idempotency_key: 'snapshot-format-valid' })).ok, true);
  } finally {
    await stopChild(child);
    if (server) await new Promise(resolve => server.close(resolve));
    await Promise.all([rm(dataDir, { recursive: true, force: true }), rm(bundleRoot, { recursive: true, force: true })]);
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
    ...REQUIRED_AGENT_ASSETS,
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
    await installMockClient(bundleRoot);
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
    await writeFixtureClient(clientPath, dataDir, socketPath);
    server = createServer(socket => {
      socket.once('data', () => {
        const payload = Buffer.from(JSON.stringify(status));
        socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`), payload]));
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    child = spawn(process.execPath, [join(bundleRoot, 'agent-entry/mcp.mjs'), clientPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    const responsePromise = firstJsonMessage(child);
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
    await stopChild(child);
    if (server) await new Promise(resolve => server.close(resolve));
    await Promise.all([rm(dataDir, { recursive: true, force: true }), rm(bundleRoot, { recursive: true, force: true })]);
  }
});
