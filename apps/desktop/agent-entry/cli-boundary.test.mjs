import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import test from 'node:test';
import definitions from '../../../packages/core/src/managed-capability-definitions.json' with { type: 'json' };
import { validateOperationRequest } from './request-validation.mjs';

const entryRoot = dirname(fileURLToPath(import.meta.url));
const cliPath = join(entryRoot, 'cli.mjs');
const installationLink = join(entryRoot, '../webenvoy-installation.json');

async function runCli(args) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => resolveResult({ code, stdout, stderr }));
  });
}

async function withInvalidOwnerLink(callback) {
  let previous;
  try { previous = await readFile(installationLink); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(installationLink, 'owner-only-invalid-json', { mode: 0o600 });
  try { return await callback(); }
  finally {
    if (previous) await writeFile(installationLink, previous, { mode: 0o600 });
    else await unlink(installationLink).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function writeAgentClient(dir) {
  const clientPath = join(dir, 'webenvoy-client.json');
  await writeFile(clientPath, JSON.stringify({ data_dir: join(dir, 'owner-data'), credential: 'a'.repeat(32), agent_endpoint: join(dir, 'agent.sock'), owner_uid: 1, agent_uid: 2 }), { mode: 0o600 });
  return clientPath;
}

test('shared operation validator rejects unknown fields before dispatch', () => {
  const valid = { idempotency_key: 'key', grant_id: 'grant', operation: 'profile.list', task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] } };
  assert.deepEqual(validateOperationRequest(valid, definitions), valid);
  assert.throws(() => validateOperationRequest({ ...valid, owner_secret: 'nope' }, definitions), /operation_input_refused/);
});

test('Agent CLI does not read owner installation link before validating request', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-agent-input-'));
  try {
    const clientPath = await writeAgentClient(dir);
    const requestPath = join(dir, 'request.json');
    await writeFile(requestPath, '{not-json');
    const result = await withInvalidOwnerLink(() => runCli(['agent', 'recovery', '--client-file', clientPath, '--request-file', requestPath]));
    assert.equal(result.code, 2);
    assert.deepEqual(JSON.parse(result.stderr).error.code, 'recovery_input_refused');
    assert.equal(result.stdout, '');
    await assert.rejects(lstat(join(dir, 'agent.sock')), error => error.code === 'ENOENT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Agent setup rejects same UID without touching owner or host paths', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-agent-setup-'));
  const hostDir = join(dir, 'agent-host');
  try {
    const uid = process.getuid?.();
    const result = await withInvalidOwnerLink(() => runCli(['agent', 'setup', '--host-dir', hostDir, '--data-dir', join(dir, 'owner-data'), '--owner-uid', String(uid)]));
    assert.equal(result.code, 3);
    assert.equal(JSON.parse(result.stderr).error.code, 'owner_agent_isolation_unavailable');
    await assert.rejects(lstat(hostDir), error => error.code === 'ENOENT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('owner list, diagnose and inspect use live reads without Runtime startup', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-owner-read-'));
  const socketPath = join(dir, 'owner-control.sock');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    let payload = { ready: true, assets: { digest: 'fixture' }, pid: process.pid, services: [] };
    if (request.url === '/runtime/sessions') payload = { schema_version: 'harbor-runtime-session-list/v1', sessions: [] };
    if (request.url === '/runtime/sessions/demo') payload = { runtime_session_ref: 'demo', control_owner: 'none', control_generation: 0, control_lock: { owner: 'none', state: 'released', holder_ref: null } };
    if (request.url === '/runtime/sessions/demo/runtime-facts') payload = { runtime_session_ref: 'demo', control_owner: 'none', control_generation: 0, control_lock: { owner: 'none', state: 'released', holder_ref: null } };
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(payload));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const list = await runCli(['instance', 'list', '--data-dir', dir]);
    const diagnose = await runCli(['diagnose', '--data-dir', dir]);
    const inspect = await runCli(['instance', 'inspect', '--data-dir', dir, '--runtime-session-ref', 'demo']);
    assert.equal(list.code, 0);
    assert.equal(diagnose.code, 0);
    assert.equal(inspect.code, 0);
    assert.deepEqual(requests, ['/runtime/sessions', '/status', '/runtime/sessions/demo', '/runtime/sessions/demo/runtime-facts']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('formal CLI rejects the historical App entry', async () => {
  const result = await runCli(['app', '--data-dir', join(tmpdir(), 'webenvoy-app-disabled')]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'app_unsupported_formal_runtime');
});
