import { createServer } from 'node:http';
import { chmod, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { root, verifyBundle } from './bundle.mjs';
import { assertProviderPythonPairing, classifyCamoufoxBinding, classifyChromeOfficialBinding, verifyInstalledCamoufox, verifyInstalledChromeOfficial } from './provider-artifact.mjs';
import { installedRuntimeEnvironment } from './runtime-environment.mjs';
import { agentDataSocket, isOwnerHarborRoute, ownerControlSocket, requiresControlPrecondition, verifyOsBoundary, verifyOwnerDataDirectory } from './os-boundary.mjs';

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
  ownerSocketPath: socket
});

async function prepareSocket(path, { ownerUid = process.getuid?.() } = {}) {
  const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
  if (!info) return;
  if (info.isSymbolicLink() || !info.isSocket() || info.uid !== ownerUid) throw new Error('runtime_endpoint_occupied');
  await unlink(path);
}

// A live or unrecognized socket is never removed or adopted.
try {
  const pid = Number(await readFile(join(dataDir, 'runtime.pid'), 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('runtime_pid_invalid');
  try { process.kill(pid, 0); process.exit(0); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await prepareSocket(socket);
  if (boundary.state === 'supported') await prepareSocket(agentSocket);
} catch (error) { if (error.code !== 'ENOENT') throw error; }

let state = { ready: false, runtime_id: randomUUID(), pid: process.pid, boundary };
let supervisor, ownerToken;
let ownerServer, agentServer;
let agentSocketOwned = false;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const projectRuntimeError = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['code', 'retryable'].filter(key => key in value).map(key => [key, value[key]]))
  : undefined;
const projectPage = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['requested_url', 'current_url', 'title', 'status', 'error_reason', 'observed_at', 'page_id', 'page_ref', 'document_generation', 'origin', 'active', 'opener_page_id'].filter(key => key in value).map(key => [key, key === 'error_reason' ? projectRuntimeError(value[key]) : value[key]]))
  : undefined;
const projectLock = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['owner', 'state', 'holder_ref', 'updated_at'].filter(key => key in value).map(key => [key, value[key]]))
  : undefined;
function projectSessionFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.control_generation) || value.control_generation < 0) return undefined;
  const result = Object.fromEntries(['schema_version', 'runtime_session_ref', 'identity_environment_ref', 'execution_identity_ref', 'profile_ref', 'provider_ref', 'provider_mode', 'lifecycle_state', 'created_at', 'last_seen_at', 'closed_at', 'availability', 'control_owner', 'control_generation'].filter(key => key in value).map(key => [key, value[key]]));
  if (value.availability && typeof value.availability === 'object' && !Array.isArray(value.availability)) result.availability = Object.fromEntries(['driver', 'cdp', 'viewer', 'snapshot', 'evidence'].filter(key => key in value.availability).map(key => [key, value.availability[key]]));
  if (value.current_page) result.current_page = projectPage(value.current_page);
  if (value.control_lock) result.control_lock = projectLock(value.control_lock);
  if (value.current_error) result.current_error = projectRuntimeError(value.current_error);
  if (value.viewer_entry && typeof value.viewer_entry === 'object' && !Array.isArray(value.viewer_entry)) {
    result.viewer_entry = Object.fromEntries(['availability', 'access_mode', 'transport', 'input_capabilities', 'unavailable_reason'].filter(key => key in value.viewer_entry).map(key => [key, value.viewer_entry[key]]));
  }
  for (const key of ['lock_owner', 'lock_state', 'holder_ref']) if (key in value) result[key] = value[key];
  if (value.control_precondition && typeof value.control_precondition === 'object' && !Array.isArray(value.control_precondition)) {
    result.control_precondition = Object.fromEntries(['schema_version', 'control_owner', 'lock_owner', 'lock_state', 'holder_ref', 'control_generation'].filter(key => key in value.control_precondition).map(key => [key, value.control_precondition[key]]));
  }
  return result;
}
function projectHarborResponse(req, value) {
  const pathname = new URL(req.url, 'http://owner.local').pathname;
  if (pathname === '/runtime/sessions') {
    if (Array.isArray(value)) {
      const sessions = value.map(projectSessionFacts);
      return sessions.every(Boolean) ? sessions : undefined;
    }
    if (value && typeof value === 'object' && Array.isArray(value.sessions)) {
      const sessions = value.sessions.map(projectSessionFacts);
      if (!sessions.every(Boolean)) return undefined;
      return { ...('schema_version' in value ? { schema_version: value.schema_version } : {}), ...('status' in value ? { status: value.status } : {}), sessions };
    }
    return value && typeof value === 'object' && typeof value.error === 'string' ? { error: value.error } : undefined;
  }
  if (value && typeof value === 'object' && value.status === 'unavailable') {
    const result = Object.fromEntries(['status', 'failure_class', 'message', 'retryable'].filter(key => key in value).map(key => [key, value[key]]));
    if (value.current_error) result.current_error = projectRuntimeError(value.current_error);
    return result;
  }
  if (value && typeof value === 'object' && typeof value.error === 'string') return { error: value.error };
  return projectSessionFacts(value);
}
const ownerRoutes = (req) => (req.method === 'POST' && ['/owner/recovery/inspect', '/owner/recovery/backup', '/owner/recovery/plan', '/owner/recovery/apply'].includes(req.url)) ||
  (req.method === 'GET' && /^\/owner\/recovery\/status\/[^/?]+$/.test(req.url)) ||
  (req.method === 'GET' && (req.url === '/owner/files' || req.url.startsWith('/owner/files?'))) ||
  (req.method === 'POST' && ['/owner/files/import', '/owner/files/export', '/owner/files/revoke', '/owner/files/delete'].includes(req.url)) ||
  (req.method === 'GET' && (req.url === '/agent-access' || /^\/agent-access\/operations\/[^/?]+$/.test(req.url))) ||
  ((req.method === 'GET' || req.method === 'PUT') && req.url === '/agent-access/management-policy') ||
  (req.method === 'POST' && (['/agent-access/principals', '/agent-access/grants', '/agent-access/v2/grants', '/agent-access/profile-policies', '/agent-access/v2/profile-policies', '/agent-access/scope-confirmations'].includes(req.url) || /^\/agent-access\/(principals|connections|grants)\/[^/?]+\/revoke$/.test(req.url))) ||
  isOwnerHarborRoute(req);
const agentRoutes = (req) => (req.method === 'POST' && ['/agent-connections', '/managed-browser/capabilities/describe', '/managed-browser/operations', '/managed-skills/operations'].includes(req.url)) ||
  (req.method === 'GET' && (/^\/managed-browser\/operations\/[A-Za-z0-9_-]+$/.test(req.url) || /^\/managed-skills\/operations\/[A-Za-z0-9_-]+$/.test(req.url)));
function statusFor(role) {
  if (role === 'owner') return state;
  const { coreEndpoint: _core, harborEndpoint: _harbor, owner_control_socket: _ownerSocket, agent_data_socket: _agentSocket, ...publicState } = state;
  return publicState;
}

async function handle(role, req, res) {
  let requestBody = '';
  try {
    if (state.ready && (!supervisor.getCoreRuntimeSupervisorToken(state.coreEndpoint) || !supervisor.getHarborRuntimeSupervisorToken(state.harborEndpoint))) state = { ...state, ready: false, error: 'runtime_child_exited' };
    if (req.url === '/status' && req.method === 'GET') return send(res, 200, statusFor(role));
    if (role === 'owner' && req.url === '/stop' && req.method === 'POST') {
      if (req.headers.authorization) return send(res, 401, { ok: false, error: { code: 'owner_credential_forbidden' } });
      send(res, 200, { stopped: true });
      return shutdown();
    }
    if (!state.ready) return send(res, 503, { ok: false, error: { code: state.error ?? (role === 'agent' ? 'owner_agent_isolation_unavailable' : 'runtime_starting') } });
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
    for await (const chunk of req) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > 65536) return send(res, 413, { ok: false, error: { code: 'input_too_large' } });
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    requestBody = body;
    const harborRoute = role === 'owner' && isOwnerHarborRoute(req);
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
    const upstream = await fetch(new URL(req.url, upstreamBase), {
      method: req.method,
      headers: { authorization: upstreamAuthorization, 'content-type': 'application/json' },
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
const liveBoundary = verifyOsBoundary({ ownerUid: boundary.identity.owner_uid, agentUid: boundary.identity.agent_uid, ownerSocketPath: socket });
state = { ...state, boundary: liveBoundary };
if (liveBoundary.state === 'supported') {
  agentServer = createServer((req, res) => handle('agent', req, res));
  await new Promise((resolveListen, reject) => {
    agentServer.once('error', reject);
    agentServer.listen(agentSocket, () => chmod(agentSocket, 0o666).then(() => { agentSocketOwned = true; resolveListen(); }, reject));
  });
}
await writeFile(join(dataDir, 'runtime.pid'), String(process.pid), { mode: 0o600 });
let stopping = false;
async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise(resolveClose => server.close(resolveClose));
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
      try { process.kill(service.pid, 0); } catch { state = { ...state, ready: false, error: 'runtime_child_exited: explicitly stop and restart' }; supervisor.stop(); }
    }
  }, 1000).unref();
} catch (error) {
  supervisor?.stop();
  state = { ...state, ready: false, error: error.message };
  await writeFile(join(dataDir, 'last-start-error.json'), JSON.stringify({ error: error.message }), { mode: 0o600 });
  await shutdown();
}
