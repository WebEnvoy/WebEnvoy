import { createServer } from 'node:http';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root, verifyBundle } from './bundle.mjs';
import { assertProviderPythonPairing, classifyCamoufoxBinding, classifyChromeOfficialBinding, verifyInstalledCamoufox, verifyInstalledChromeOfficial } from './provider-artifact.mjs';
import { installedRuntimeEnvironment } from './runtime-environment.mjs';
import { agentDataSocket, isOwnerHarborRoute, ownerControlSocket, prepareRuntimeSocket, requiresControlPrecondition, verifyLiveOsBoundary, verifyOsBoundary, verifyOwnerDataDirectory } from './os-boundary.mjs';
import { projectHarborResponse } from './service-projection.mjs';

const dataDir = process.argv[2];
if (!dataDir) throw new Error('data_directory_required');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
verifyOwnerDataDirectory(dataDir);
const socket = ownerControlSocket(dataDir);
let config;
try { config = JSON.parse(await readFile(join(dataDir, 'installation.json'), 'utf8')); } catch { config = {}; }
const agentSocket = agentDataSocket({ data_dir: dataDir, agent_endpoint: config.agent_endpoint });
if (agentSocket === socket) throw new Error('runtime_endpoints_not_separate');
const boundary = verifyOsBoundary({
  ownerUid: config.owner_uid,
  agentUid: config.agent_uid,
  ownerSocketPath: socket,
  installRoot: root
});

// A live or unrecognized socket is never removed or adopted.
try {
  const pid = Number(await readFile(join(dataDir, 'runtime.pid'), 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('runtime_pid_invalid');
  try { process.kill(pid, 0); process.exit(0); } catch (error) { if (error.code !== 'ESRCH') throw error; }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await prepareRuntimeSocket(socket);
if (boundary.state === 'supported') await prepareRuntimeSocket(agentSocket);

let state = { ready: false, runtime_id: randomUUID(), pid: process.pid, boundary };
let supervisor, ownerToken;
let ownerServer, agentServer;
let agentSocketOwned = false;
let stopping = false;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const ownerRoutes = (req) => (req.method === 'POST' && ['/owner/recovery/inspect', '/owner/recovery/backup', '/owner/recovery/plan', '/owner/recovery/apply'].includes(req.url)) ||
  (req.method === 'GET' && /^\/owner\/recovery\/status\/[^/?]+$/.test(req.url)) ||
  (req.method === 'GET' && /^\/owner\/runtime-sessions\/[^/?]+\/runs$/.test(req.url)) ||
  (req.method === 'POST' && req.url === '/owner/site-task-admissions/operations') ||
  (req.method === 'GET' && (req.url === '/owner/files' || req.url.startsWith('/owner/files?'))) ||
  (req.method === 'POST' && ['/owner/files/import', '/owner/files/export', '/owner/files/revoke', '/owner/files/delete'].includes(req.url)) ||
  (req.method === 'GET' && (req.url === '/agent-access' || /^\/agent-access\/operations\/[^/?]+$/.test(req.url))) ||
  ((req.method === 'GET' || req.method === 'PUT') && req.url === '/agent-access/management-policy') ||
  (req.method === 'POST' && (['/agent-access/principals', '/agent-access/grants', '/agent-access/v2/grants', '/agent-access/profile-policies', '/agent-access/v2/profile-policies', '/agent-access/scope-confirmations'].includes(req.url) || /^\/agent-access\/(principals|connections|grants)\/[^/?]+\/revoke$/.test(req.url))) ||
  isOwnerHarborRoute(req);
const agentRoutes = (req) => (req.method === 'POST' && ['/agent-connections', '/managed-browser/capabilities/describe', '/managed-browser/operations', '/managed-skills/operations', '/managed-tasks/operations', '/managed-tasks/worker/started', '/managed-tasks/worker/broker', '/managed-tasks/worker/complete', '/managed-tasks/worker/fail', '/managed-account-systems/operations'].includes(req.url)) ||
  (req.method === 'GET' && (/^\/managed-browser\/operations\/[A-Za-z0-9_-]+$/.test(req.url) || /^\/managed-skills\/operations\/[A-Za-z0-9_-]+$/.test(req.url)));
function harborControlReady() {
  return !stopping && Boolean(state.services?.some(service => service.id === 'harbor') &&
    supervisor?.getHarborRuntimeSupervisorToken(state.harborEndpoint));
}
function statusFor(role) {
  if (role === 'owner') return { ...state, harbor_ready: harborControlReady() };
  const { coreEndpoint: _core, harborEndpoint: _harbor, owner_control_socket: _ownerSocket, agent_data_socket: _agentSocket, ...publicState } = state;
  return publicState;
}

async function handle(role, req, res) {
  let requestBody = '';
  try {
    const identity = state.boundary.identity;
    const liveBoundary = verifyLiveOsBoundary({ dataDir, ownerUid: identity.owner_uid, agentUid: identity.agent_uid, ownerSocketPath: socket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true });
    state = { ...state, boundary: liveBoundary };
    if (role === 'agent' && liveBoundary.state !== 'supported') {
      void closeAgentServer();
      return send(res, 503, { ok: false, error: { code: 'owner_agent_isolation_unavailable', reason_codes: liveBoundary.reason_codes } });
    }
    if (liveBoundary.state !== 'supported') void closeAgentServer();
    if (role === 'owner' && !liveBoundary.owner_transport && !(req.method === 'GET' && req.url === '/status')) return send(res, 503, { ok: false, error: { code: 'owner_agent_isolation_unavailable', reason_codes: liveBoundary.reason_codes } });
    if (state.ready && (!supervisor.getCoreRuntimeSupervisorToken(state.coreEndpoint) || !supervisor.getHarborRuntimeSupervisorToken(state.harborEndpoint))) state = { ...state, ready: false, error: 'runtime_child_exited' };
    if (req.url === '/status' && req.method === 'GET') return send(res, 200, statusFor(role));
    if (role === 'owner' && req.url === '/stop' && req.method === 'POST') {
      if (req.headers.authorization) return send(res, 401, { ok: false, error: { code: 'owner_credential_forbidden' } });
      send(res, 200, { stopped: true });
      return shutdown();
    }
    const harborRoute = role === 'owner' && isOwnerHarborRoute(req);
    if (!state.ready && !(harborRoute && harborControlReady())) return send(res, 503, { ok: false, error: { code: state.error ?? (role === 'agent' ? 'owner_agent_isolation_unavailable' : 'runtime_starting') } });
    const allowed = role === 'owner' ? ownerRoutes(req) : agentRoutes(req);
    if (!allowed) return send(res, 403, { ok: false, error: { code: role === 'owner' ? 'owner_route_denied' : 'agent_route_denied' } });
    const authorizationHeaders = req.rawHeaders.filter((header, index) => index % 2 === 0 && header.toLowerCase() === 'authorization');
    if (role === 'owner') {
      if (authorizationHeaders.length) return send(res, 401, { ok: false, error: { code: 'owner_credential_forbidden' } });
    } else {
      if (authorizationHeaders.length !== 1 || typeof req.headers.authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{32,512}$/.test(req.headers.authorization)) return send(res, 401, { ok: false, error: { code: 'agent_authentication_required' } });
      if (ownerToken && req.headers.authorization === `Bearer ${ownerToken}`) return send(res, 403, { ok: false, error: { code: 'owner_credential_forbidden' } });
    }
    const chunks = [];
    let bytes = 0;
    const requestLimit = req.url === '/managed-tasks/operations' ? 128 * 1024 : req.url.startsWith('/managed-tasks/worker/') ? 2 * 1024 * 1024 : 65536;
    for await (const chunk of req) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > requestLimit) return send(res, 413, { ok: false, error: { code: 'input_too_large' } });
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    requestBody = body;
    let upstreamBase = state.coreEndpoint;
    let upstreamAuthorization = role === 'owner' ? `Bearer ${ownerToken}` : req.headers.authorization;
    if (harborRoute) {
      const harborToken = supervisor?.getHarborRuntimeSupervisorToken(state.harborEndpoint);
      if (!harborToken) return send(res, 503, { ok: false, error: { code: 'harbor_supervisor_unavailable' } });
      if (requiresControlPrecondition(req)) {
        let parsed;
        try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = undefined; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, 'expected_control')) {
          return send(res, 409, { ok: false, error: { code: 'control_precondition_required' } });
        }
      }
      upstreamBase = state.harborEndpoint;
      upstreamAuthorization = `Bearer ${harborToken}`;
    }
    const harborPath = harborRoute ? (() => {
      const parsed = new URL(req.url, 'http://owner.local');
      return `${parsed.pathname}${parsed.search}`;
    })() : req.url;
    const upstreamHeaders = { authorization: upstreamAuthorization, 'content-type': 'application/json' };
    if (role === 'agent' && req.url === '/managed-tasks/operations' && liveBoundary.mode === 'distinct_uid_hardened' &&
        liveBoundary.identity.socket_acl === 'verified' && liveBoundary.agent_transport && ownerToken) {
      let operation;
      try { operation = JSON.parse(body)?.operation; } catch { operation = undefined; }
      if (operation === 'task.submit') upstreamHeaders['x-webenvoy-agent-socket-ingress'] = ownerToken;
    }
    const upstream = await fetch(new URL(harborPath, upstreamBase), {
      method: req.method,
      headers: upstreamHeaders,
      ...(['POST', 'PUT'].includes(req.method) ? { body } : {}),
      signal: AbortSignal.timeout(85_000)
    });
    const upstreamBody = await upstream.json();
    if (harborRoute) {
      const projected = projectHarborResponse(req, upstreamBody);
      if (projected === undefined) return send(res, 503, { ok: false, error: { code: 'control_precondition_unavailable' } });
      return send(res, upstream.status, projected);
    }
    send(res, upstream.status, upstreamBody);
  } catch {
    const potentiallyDispatched = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const error = potentiallyDispatched
      ? { code: 'runtime_unavailable_unknown_outcome', dispatch_state: 'possibly_dispatched', recovery: 'query_original_request' }
      : { code: 'runtime_unavailable_query_without_replay', dispatch_state: 'not_dispatched' };
    if (potentiallyDispatched) {
      try {
        const parsed = requestBody ? JSON.parse(requestBody) : undefined;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.idempotency_key === 'string' && parsed.idempotency_key.length <= 512) error.idempotency_key = parsed.idempotency_key;
      } catch {}
    }
    send(res, 503, { ok: false, error });
  }
}

ownerServer = createServer((req, res) => handle('owner', req, res));
ownerServer.on('error', () => { supervisor?.stop(); process.exit(1); });
await new Promise((resolveListen, reject) => { ownerServer.once('error', reject); ownerServer.listen(socket, () => chmod(socket, 0o600).then(resolveListen, reject)); });
const liveBoundary = verifyOsBoundary({ ownerUid: boundary.identity.owner_uid, agentUid: boundary.identity.agent_uid, ownerSocketPath: socket, installRoot: root });
state = { ...state, boundary: liveBoundary };
if (liveBoundary.state === 'supported') {
  agentServer = createServer((req, res) => handle('agent', req, res));
  await new Promise((resolveListen, reject) => {
    agentServer.once('error', reject);
    agentServer.listen(agentSocket, async () => {
      try {
        await chmod(agentSocket, 0o600);
        const { owner_uid: ownerUid, agent_uid: agentUid } = liveBoundary.identity;
        if (ownerUid !== agentUid) {
          const name = execFileSync('/usr/bin/id', ['-nu', String(agentUid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (!name || /[^A-Za-z0-9_.-]/.test(name)) throw new Error('agent_socket_acl_unavailable');
          execFileSync('/bin/chmod', ['+a', `user:${name} allow read,write`, agentSocket], { stdio: ['ignore', 'ignore', 'ignore'] });
        }
        const verified = verifyLiveOsBoundary({ dataDir, ownerUid, agentUid, ownerSocketPath: socket, agentSocketPath: agentSocket, installRoot: root, requireAgentSocket: true });
        if (verified.state !== 'supported' || !verified.agent_transport) throw new Error('agent_socket_acl_unavailable');
        agentSocketOwned = true;
        resolveListen();
      } catch (error) { reject(error); }
    });
  });
}
await writeFile(join(dataDir, 'runtime.pid'), String(process.pid), { mode: 0o600 });
async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise(resolveClose => server.close(resolveClose));
}
async function closeAgentServer() {
  if (!agentServer?.listening) return;
  agentSocketOwned = false;
  await closeServer(agentServer);
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  state.ready = false;
  supervisor?.stop();
  await Promise.all([closeServer(ownerServer), closeServer(agentServer)]);
  await Promise.all([unlink(socket).catch(() => {}), agentSocketOwned ? unlink(agentSocket).catch(() => {}) : undefined, unlink(join(dataDir, 'runtime.pid')).catch(() => {})]);
  // Allow Harbor to close its original browser processes and flush facts.
  setTimeout(() => process.exit(0), 1500);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, shutdown);
try {
  const assets = await verifyBundle();
  config = JSON.parse(await readFile(join(dataDir, 'installation.json'), 'utf8'));
  const verifiedCamoufox = await verifyInstalledCamoufox(config);
  const verifiedChrome = await verifyInstalledChromeOfficial(config);
  assertProviderPythonPairing(verifiedCamoufox, verifiedChrome);
  const camoufoxLaunch = verifiedCamoufox ? { state: 'qualified', reason: 'official_upstream' } : classifyCamoufoxBinding(config);
  const chromeLaunch = verifiedChrome ? { state: 'qualified', reason: 'official_upstream' } : classifyChromeOfficialBinding(config);
  const publicConfig = Object.fromEntries(Object.entries(config).filter(([key]) => !['camoufoxArtifact', 'camoufoxUpstream', 'chromeOfficial', 'ownerToken', 'owner_token', 'supervisorToken', 'supervisor_token'].includes(key)));
  for (const key of ['coreEndpoint', 'harborEndpoint']) {
    const url = new URL(config[key]);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('installation_endpoint_invalid');
  }
  // The installed service never inherits development stores, launch wrappers,
  // fixture providers or private resolvers. Historical Camoufox bindings are
  // local evidence only and are never converted into a launch path.
  for (const key of Object.keys(process.env)) if (/^(WEBENVOY_|HARBOR_|CAMOUFOX_)/.test(key)) delete process.env[key];
  Object.assign(process.env, installedRuntimeEnvironment({ parentEnvironment: process.env, dataDir, installRoot: root, camoufoxLaunch, camoufoxBinding: verifiedCamoufox, chromeLaunch, chromeBinding: verifiedChrome }));
  Object.assign(process.env, {
    WEBENVOY_SITE_WORKER_MODE: state.boundary.mode,
    WEBENVOY_SITE_WORKER_OWNER_UID: String(state.boundary.identity.owner_uid),
    WEBENVOY_SITE_WORKER_AGENT_UID: String(state.boundary.identity.agent_uid),
    WEBENVOY_SITE_WORKER_OWNER_SOCKET_ACL: state.boundary.identity.socket_acl
  });
  const { createRuntimeSupervisor } = await import('../dist-electron/runtimeSupervisor.js');
  supervisor = createRuntimeSupervisor({ dataDir });
  state = { ...state, ...publicConfig, owner_control_socket: socket, agent_data_socket: agentSocket, camoufox_launch: camoufoxLaunch, chrome_launch: chromeLaunch, assets };
  let snapshot;
  for (let attempt = 0; attempt < 100; attempt++) {
    snapshot = await supervisor.readState(config);
    if (snapshot.services.some(s => ['exited', 'failed'].includes(s.processState))) throw new Error('runtime_endpoint_or_process_failed: check occupied endpoints; stop and retry');
    if (snapshot.services.every(s => s.health.state === 'ready' && s.pid && s.readyAnnounced)) break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  if (!snapshot.services.every(s => s.health.state === 'ready' && s.pid && s.readyAnnounced)) throw new Error('runtime_start_timeout');
  ownerToken = supervisor.getCoreRuntimeSupervisorToken(config.coreEndpoint);
  state = { ...state, ready: true, services: snapshot.services.map(s => ({ id: s.id, pid: s.pid })) };
  setInterval(async () => {
    if (stopping) return;
    // Do not let a replacement server inherit our discovery record after a child exits.
    for (const service of state.services) {
      try { process.kill(service.pid, 0); } catch {
        state = { ...state, ready: false, error: 'runtime_child_exited: explicitly stop and restart' };
        // Core loss must leave the original Harbor available for owner control.
        if (service.id === 'harbor') supervisor.stop();
      }
    }
  }, 1000).unref();
} catch (error) {
  supervisor?.stop();
  state = { ...state, ready: false, error: error.message };
  await writeFile(join(dataDir, 'last-start-error.json'), JSON.stringify({ error: error.message }), { mode: 0o600 });
  await shutdown();
}
