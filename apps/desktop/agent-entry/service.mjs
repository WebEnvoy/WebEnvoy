import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { root, verifyBundle } from './bundle.mjs';
import { classifyCamoufoxBinding } from './provider-artifact.mjs';
import { installedRuntimeEnvironment } from './runtime-environment.mjs';

const dataDir = process.argv[2];
if (!dataDir) throw new Error('data_directory_required');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const socket = join(dataDir, 'runtime.sock'), pidFile = join(dataDir, 'runtime.pid');
// A live or unrecognized socket is never removed or adopted.
try {
  const pid = Number(await readFile(pidFile, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('runtime_pid_invalid');
  try { process.kill(pid, 0); process.exit(0); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const info = await lstat(socket).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (info && (!info.isSocket() || info.uid !== process.getuid())) throw new Error('runtime_endpoint_occupied');
  if (info) await unlink(socket);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let state = { ready: false, runtime_id: randomUUID(), pid: process.pid };
let supervisor, ownerToken;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    if (state.ready && (!supervisor.getCoreRuntimeSupervisorToken(state.coreEndpoint) || !supervisor.getHarborRuntimeSupervisorToken(state.harborEndpoint))) state = { ...state, ready: false, error: 'runtime_child_exited' };
    if (req.url === '/status' && req.method === 'GET') return send(res, 200, state);
    if (req.url === '/stop' && req.method === 'POST' && ownerToken && req.headers.authorization === `Bearer ${ownerToken}`) {
      send(res, 200, { stopped: true }); return shutdown();
    }
    if (!state.ready) return send(res, 503, { ok: false, error: { code: state.error ?? 'runtime_starting' } });
    const ownerRoute = (req.method === 'POST' && ['/owner/recovery/inspect', '/owner/recovery/backup', '/owner/recovery/plan', '/owner/recovery/apply'].includes(req.url)) ||
      (req.method === 'GET' && /^\/owner\/recovery\/status\/[^/?]+$/.test(req.url)) ||
      (req.method === 'GET' && (req.url === '/agent-access' || /^\/agent-access\/operations\/[^/?]+$/.test(req.url))) ||
      ((req.method === 'GET' || req.method === 'PUT') && req.url === '/agent-access/management-policy') ||
      (req.method === 'POST' && (['/agent-access/principals', '/agent-access/grants', '/agent-access/profile-policies'].includes(req.url) || /^\/agent-access\/(principals|connections|grants)\/[^/?]+\/revoke$/.test(req.url)));
    const agentRoute = (req.method === 'POST' && ['/agent-connections', '/managed-browser/operations', '/managed-skills/operations'].includes(req.url)) ||
      (req.method === 'GET' && (/^\/managed-browser\/operations\/[A-Za-z0-9_-]+$/.test(req.url) || /^\/managed-skills\/operations\/[A-Za-z0-9_-]+$/.test(req.url)));
    if (!ownerRoute && !agentRoute) return send(res, 403, { ok: false, error: { code: 'agent_route_denied' } });
    if (req.rawHeaders.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'authorization').length !== 1) return send(res, 401, { ok: false, error: { code: ownerRoute ? 'owner_authentication_required' : 'agent_authentication_required' } });
    if (ownerRoute && (!ownerToken || req.headers.authorization !== `Bearer ${ownerToken}`)) return send(res, 401, { ok: false, error: { code: 'owner_authentication_required' } });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > 65536) return send(res, 413, { ok: false, error: { code: 'input_too_large' } });
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const upstream = await fetch(state.coreEndpoint + req.url, { method: req.method, headers: { authorization: req.headers.authorization, 'content-type': 'application/json' }, ...(['POST', 'PUT'].includes(req.method) ? { body } : {}), signal: AbortSignal.timeout(85_000) });
    send(res, upstream.status, await upstream.json());
  } catch { send(res, 503, { ok: false, error: { code: 'runtime_unavailable_query_without_replay' } }); }
});
server.on('error', () => { supervisor?.stop(); process.exit(1); });
await new Promise(resolve => server.listen(socket, resolve));
await writeFile(pidFile, String(process.pid), { mode: 0o600 });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  state.ready = false;
  supervisor?.stop();
  server.close();
  await unlink(pidFile).catch(() => {});
  // Allow Harbor to close its original browser processes and flush facts.
  setTimeout(() => process.exit(0), 1500);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, shutdown);
try {
  const assets = await verifyBundle();
  const config = JSON.parse(await readFile(join(dataDir, 'installation.json'), 'utf8'));
  const camoufoxLaunch = classifyCamoufoxBinding(config);
  const publicConfig = Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'camoufoxArtifact'));
  for (const key of ['coreEndpoint', 'harborEndpoint']) {
    const url = new URL(config[key]);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('installation_endpoint_invalid');
  }
  // The installed service never inherits development stores, launch wrappers,
  // fixture providers or private resolvers. Historical Camoufox bindings are
  // local evidence only and are never converted into a launch path.
  for (const key of Object.keys(process.env)) if (/^(WEBENVOY_|HARBOR_|CAMOUFOX_)/.test(key)) delete process.env[key];
  Object.assign(process.env, installedRuntimeEnvironment({ parentEnvironment: process.env, dataDir, installRoot: root, camoufoxLaunch }));
  const { createRuntimeSupervisor } = await import('../dist-electron/runtimeSupervisor.js');
  supervisor = createRuntimeSupervisor({ dataDir });
  state = { ...state, ...publicConfig, camoufox_launch: camoufoxLaunch, assets };
  let snapshot;
  for (let attempt = 0; attempt < 100; attempt++) {
    snapshot = await supervisor.readState(config);
    if (snapshot.services.some(s => ['exited', 'failed'].includes(s.processState))) throw new Error('runtime_endpoint_or_process_failed: check occupied endpoints; stop and retry');
    if (snapshot.services.every(s => s.health.state === 'ready' && s.pid && s.readyAnnounced)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!snapshot.services.every(s => s.health.state === 'ready' && s.pid && s.readyAnnounced)) throw new Error('runtime_start_timeout');
  ownerToken = supervisor.getCoreRuntimeSupervisorToken(config.coreEndpoint);
  // Only App/owner launcher reads this file; it is never sent through the MCP proxy.
  await writeFile(join(dataDir, 'owner.json'), JSON.stringify({ runtime_id: state.runtime_id, ...config, credential: ownerToken }), { mode: 0o600 });
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
