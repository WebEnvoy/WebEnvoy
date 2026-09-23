import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { REQUIRED_AGENT_ASSETS, REQUIRED_DRIVER_ASSETS, sha } from './bundle.mjs';

const entryRoot = dirname(fileURLToPath(import.meta.url));
const fixtureSupervisor = `
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const children = new Map();
const fixturePath = fileURLToPath(new URL('./fixture-runtime.mjs', import.meta.url));
const normalized = value => new URL(value).origin;

async function ready(endpoint, path) {
  try {
    const response = await fetch(new URL(path, endpoint), { signal: AbortSignal.timeout(300) });
    return response.ok;
  } catch { return false; }
}

function ensureChild(id, endpoint) {
  const existing = children.get(id);
  if (existing?.child && existing.child.exitCode === null && existing.child.signalCode === null && !existing.child.killed && existing.endpoint === normalized(endpoint)) return existing;
  const token = randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [fixturePath, id, endpoint, token, process.env.W2_FIXTURE_EVENTS], {
    stdio: 'ignore',
    env: process.env
  });
  const entry = { child, endpoint: normalized(endpoint), token };
  children.set(id, entry);
  return entry;
}

function tokenFor(id, endpoint) {
  const entry = children.get(id);
  return entry?.endpoint === normalized(endpoint) && entry.child.exitCode === null && entry.child.signalCode === null && !entry.child.killed
    ? entry.token : undefined;
}

export function createRuntimeSupervisor() {
  return {
    async readState(config) {
      const services = [];
      for (const [id, endpoint, path] of [
        ['core', config.coreEndpoint, '/health'], ['harbor', config.harborEndpoint, '/readiness']
      ]) {
        const entry = ensureChild(id, endpoint);
        const isReady = await ready(endpoint, path);
        services.push({ id, endpoint, processState: entry.child.exitCode === null ? 'running' : 'exited',
          pid: entry.child.pid, readyAnnounced: isReady, health: { state: isReady ? 'ready' : 'unavailable' } });
      }
      return { services };
    },
    stop() { for (const entry of children.values()) entry.child.kill(); },
    getCoreRuntimeSupervisorToken(endpoint) { return tokenFor('core', endpoint); },
    getHarborRuntimeSupervisorToken(endpoint) { return tokenFor('harbor', endpoint); },
    getHarborManualAuthSupervisorToken(endpoint) { return tokenFor('harbor', endpoint); }
  };
}
`;

const fixtureRuntime = `
import { appendFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const [id, endpoint, token, eventsPath] = process.argv.slice(2);
let session = {
  runtime_session_ref: 'demo', profile_ref: 'profile:demo', identity_environment_ref: 'identity:demo',
  execution_identity_ref: 'identity:demo:execution', provider_ref: 'harbor:provider/chrome_official',
  provider_mode: 'local_dedicated_profile', lifecycle_state: 'active', last_seen_at: '2026-09-22T00:00:00.000Z',
  current_page: { current_url: 'https://example.test/task', title: 'Original task', status: 'ready', observed_at: '2026-09-22T00:00:00.000Z', page_ref: 'page:task' },
  control_owner: 'core_task', control_generation: 4,
  control_lock: { owner: 'core_task', state: 'held', holder_ref: 'agent:one' }
};
const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = createServer((req, res) => { void (async () => {
  const url = new URL(req.url, 'http://fixture.local');
  let rawBody = '';
  for await (const chunk of req) rawBody += chunk;
  const body = rawBody ? JSON.parse(rawBody) : undefined;
  const authorized = req.headers.authorization === 'Bearer ' + token;
  await appendFile(eventsPath, JSON.stringify({ id, method: req.method, path: url.pathname, authorized }) + '\\n');
  if (url.pathname === '/health' || url.pathname === '/ready' || url.pathname === '/readiness' || url.pathname === '/admission/health') return send(res, 200, { status: 'ready' });
  if (!authorized) return send(res, 403, { error: 'forbidden' });
  if (id === 'core' && req.method === 'GET' && url.pathname === '/owner/runtime-sessions/demo/runs') {
    return send(res, 200, { schema_version: 'webenvoy.owner-session-runs/v1', runtime_session_ref: 'demo', status: 'available', runs: [] });
  }
  if (id === 'harbor' && req.method === 'GET' && url.pathname === '/runtime/sessions') {
    return send(res, 200, { schema_version: 'harbor-runtime-session-list/v1', sessions: [session] });
  }
  if (id === 'harbor' && req.method === 'GET' && url.pathname === '/runtime/sessions/demo') return send(res, 200, session);
  if (id === 'harbor' && req.method === 'POST' && url.pathname === '/runtime/sessions/demo/handoff') {
    if (body?.expected_control?.control_generation !== session.control_generation) return send(res, 409, { status: 'unavailable', failure_class: 'control_state_changed' });
    session = { ...session, control_owner: 'user', control_generation: session.control_generation + 1,
      control_lock: { owner: 'user', state: 'held', holder_ref: 'human:one' } };
    return send(res, 200, session);
  }
  if (id === 'harbor' && req.method === 'POST' && url.pathname === '/runtime/sessions/demo/release') {
    if (body?.expected_control?.control_generation !== session.control_generation) return send(res, 409, { status: 'unavailable', failure_class: 'control_state_changed' });
    session = { ...session, control_owner: 'none', control_generation: session.control_generation + 1,
      control_lock: { owner: 'none', state: 'released', holder_ref: null } };
    return send(res, 200, session);
  }
  if (id === 'harbor' && req.method === 'POST' && url.pathname === '/runtime/sessions/demo/stop') {
    session = { ...session, lifecycle_state: 'closed', control_owner: 'none', control_generation: session.control_generation + 1,
      control_lock: { owner: 'none', state: 'closed', holder_ref: null } };
    return send(res, 200, session);
  }
  if (id === 'harbor' && /^\\/runtime\\/sessions\\/[^/]+(?:\\/.*)?$/.test(url.pathname)) {
    return send(res, 200, { status: 'unavailable', failure_class: 'session_missing', runtime_session_ref: 'missing' });
  }
  return send(res, 404, { error: 'not_found' });
})().catch(error => send(res, 500, { error: error.code ?? 'fixture_error' })); });
const listen = new URL(endpoint);
server.listen(Number(listen.port), listen.hostname);
`;

function requestJson({ socketPath, path, method = 'GET', body }) {
  return new Promise((resolveResponse, reject) => {
    const req = request({ socketPath, path, method, headers: { 'content-type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try { resolveResponse({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.once('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function runCli(bundleRoot, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [join(bundleRoot, 'agent-entry/cli.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => resolveResult({ code, stdout, stderr }));
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function makeBundle() {
  const bundleRoot = await mkdtemp(join(tmpdir(), 'w2-service-bundle-'));
  await cp(entryRoot, join(bundleRoot, 'agent-entry'), { recursive: true });
  const fixturePaths = [
    'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs',
    ...REQUIRED_DRIVER_ASSETS
  ];
  for (const name of fixturePaths) {
    const path = join(bundleRoot, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'test fixture');
  }
  const supervisorPath = join(bundleRoot, 'dist-electron/runtimeSupervisor.js');
  await mkdir(dirname(supervisorPath), { recursive: true });
  await writeFile(supervisorPath, fixtureSupervisor);
  await writeFile(join(bundleRoot, 'dist-electron/fixture-runtime.mjs'), fixtureRuntime);
  await writeFile(join(bundleRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  const names = [
    'agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs',
    'agent-entry/skills/webenvoy-browser/SKILL.md', ...REQUIRED_AGENT_ASSETS, ...fixturePaths
  ];
  const files = Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await readFile(join(bundleRoot, name)))])));
  await writeFile(join(bundleRoot, 'agent-manifest.json'), JSON.stringify({
    schema: 'webenvoy-installed-agent/v1', version: '0.2.0', skill_version: '0.2.0', files
  }));
  return bundleRoot;
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return;
  await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => { child.off('exit', resolveExit); reject(new Error('process_exit_timeout')); }, timeoutMs);
    child.once('exit', (...args) => { clearTimeout(timeout); resolveExit(...args); });
  });
}

test('owner service preserves Harbor observation and control after the Core child exits', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() < 1,
  timeout: 30_000
}, async () => {
  const bundleRoot = await makeBundle();
  const dataDir = await mkdtemp('/tmp/w2-owner-');
  await chmod(dataDir, 0o700);
  const ownerSocket = join(dataDir, 'owner-control.sock');
  const agentSocket = `/tmp/w2-agent-${process.pid}-${randomUUID().slice(0, 8)}.sock`;
  const eventsPath = join(dataDir, 'runtime-events.jsonl');
  const corePort = await reservePort();
  const harborPort = await reservePort();
  const config = {
    owner_uid: process.getuid(), agent_uid: process.getuid(), agent_endpoint: agentSocket,
    coreEndpoint: `http://127.0.0.1:${corePort}`, harborEndpoint: `http://127.0.0.1:${harborPort}`
  };
  await writeFile(join(dataDir, 'installation.json'), JSON.stringify(config), { mode: 0o600 });
  const service = spawn(process.execPath, [join(bundleRoot, 'agent-entry/service.mjs'), dataDir], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, W2_FIXTURE_EVENTS: eventsPath }
  });
  let stderr = '';
  service.stderr.on('data', value => { stderr += value; });
  let replacement;
  try {
    let status;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (service.exitCode !== null) throw new Error(`service_start_failed:${stderr}`);
      try {
        const response = await requestJson({ socketPath: ownerSocket, path: '/status' });
        status = response.body;
        if (response.status === 200 && status.ready) break;
      } catch {}
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    assert.equal(status?.ready, true, `service never became ready: ${JSON.stringify(status)} ${stderr}`);
    assert.equal(status.harbor_ready, true);
    const core = status.services.find(service => service.id === 'core');
    const harbor = status.services.find(service => service.id === 'harbor');
    assert.ok(core?.pid && harbor?.pid);

    process.kill(core.pid, 'SIGKILL');
    const coreExitDeadline = Date.now() + 5000;
    while (true) {
      if (service.exitCode !== null) throw new Error(`service_exited_after_core_kill:${stderr}`);
      try { process.kill(core.pid, 0); } catch { break; }
      if (Date.now() >= coreExitDeadline) throw new Error('core_child_exit_timeout');
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
    }

    replacement = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schema_version: 'webenvoy.owner-session-runs/v1', runtime_session_ref: 'demo', status: 'available', runs: [] }));
    });
    await new Promise((resolveListen, reject) => { replacement.once('error', reject); replacement.listen(corePort, '127.0.0.1', resolveListen); });
    let replacementRequests = 0;
    replacement.on('request', () => { replacementRequests++; });

    await new Promise(resolveDelay => setTimeout(resolveDelay, 1200));
    try { process.kill(harbor.pid, 0); } catch { assert.fail('service stopped the surviving Harbor child after Core exit'); }
    const outageStatus = await requestJson({ socketPath: ownerSocket, path: '/status' });
    assert.equal(outageStatus.body.ready, false);
    assert.equal(outageStatus.body.harbor_ready, true);
    const harborList = await requestJson({ socketPath: ownerSocket, path: '/runtime/sessions' });
    assert.equal(harborList.status, 200);
    assert.equal(harborList.body.sessions[0].runtime_session_ref, 'demo');
    const coreRuns = await requestJson({ socketPath: ownerSocket, path: '/owner/runtime-sessions/demo/runs' });
    assert.equal(coreRuns.status, 503);
    assert.match(coreRuns.body.error.code, /^runtime_child_exited/);
    assert.equal(replacementRequests, 0, 'replacement Core must not receive a request carrying the old child token');

    const cliList = await runCli(bundleRoot, ['instance', 'list', '--data-dir', dataDir]);
    assert.equal(cliList.code, 0, cliList.stderr);
    const listed = JSON.parse(cliList.stdout).sessions[0];
    assert.equal(listed.runtime_session_ref, 'demo');
    assert.equal(listed.supervision.status, 'unavailable');
    assert.equal(listed.supervision.error.code, 'owner_session_runs_unavailable');
    const cliInspect = await runCli(bundleRoot, ['instance', 'inspect', '--data-dir', dataDir, '--runtime-session-ref', 'demo']);
    assert.equal(cliInspect.code, 0, cliInspect.stderr);
    assert.equal(JSON.parse(cliInspect.stdout).session.current_page.title, 'Original task');
    assert.equal(JSON.parse(cliInspect.stdout).session.supervision.status, 'unavailable');
    for (const action of [
      'takeover', 'handback', 'stop'
    ]) {
      const result = await runCli(bundleRoot, ['instance', action, '--data-dir', dataDir, '--runtime-session-ref', 'demo']);
      assert.equal(result.code, 0, `${action}: ${result.stderr || result.stdout}`);
      assert.equal(JSON.parse(result.stdout).runtime_session_ref, 'demo');
    }
    assert.equal(replacementRequests, 0, 'Core-dependent queries must not reach the replacement server');

    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const harborControl = events.filter(event => event.id === 'harbor' && ['/runtime/sessions', '/runtime/sessions/demo', '/runtime/sessions/demo/handoff', '/runtime/sessions/demo/release', '/runtime/sessions/demo/stop'].includes(event.path));
    assert.ok(harborControl.length >= 6);
    assert.ok(harborControl.every(event => event.authorized), 'service must keep Harbor supervisor authentication on owner routes');
    assert.ok(events.some(event => event.id === 'harbor' && event.path === '/runtime/sessions/demo/handoff'));
    assert.ok(events.some(event => event.id === 'harbor' && event.path === '/runtime/sessions/demo/release'));
    assert.ok(events.some(event => event.id === 'harbor' && event.path === '/runtime/sessions/demo/stop'));

    const agentStatus = await requestJson({ socketPath: agentSocket, path: '/status' });
    assert.equal(agentStatus.body.ready, false, 'Agent readiness continues to require the complete Runtime');
    assert.equal(Object.hasOwn(agentStatus.body, 'harbor_ready'), false);
  } finally {
    if (replacement?.listening) await new Promise(resolveClose => replacement.close(resolveClose));
    if (service.exitCode === null) {
      try { await requestJson({ socketPath: ownerSocket, path: '/stop', method: 'POST', body: {} }); } catch {}
      await waitForExit(service).catch(() => service.kill('SIGKILL'));
    }
    await rm(dataDir, { recursive: true, force: true });
    await rm(bundleRoot, { recursive: true, force: true });
  }
});
