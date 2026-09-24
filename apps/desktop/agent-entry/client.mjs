import { request } from 'node:http';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { agentDataSocket, ownerControlSocket, verifyAgentClientFile, verifyAgentIdentity, verifyAgentSocket, verifyOwnerDataDirectory, verifyOwnerSocket } from './os-boundary.mjs';
import { root, verifyBundle } from './bundle.mjs';
import { createManagedSiteWorkerSupervisor } from './managed-site-worker-supervisor.mjs';

function requestSocket(socketPath, path, { method = 'GET', body, credential } = {}) {
  return new Promise((resolveResponse, reject) => {
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const succeed = value => { if (!settled) { settled = true; resolveResponse(value); } };
    const headers = { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) };
    const req = request({ socketPath, path, method, headers }, res => {
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.length;
        if (bytes > 1024 * 1024) { fail(new Error('response_too_large')); return req.destroy(); }
        chunks.push(value);
      });
      res.on('aborted', () => fail(new Error('runtime_response_aborted')));
      res.on('error', fail);
      res.on('end', () => {
        if (settled) return;
        try { succeed(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(new Error('runtime_response_invalid')); }
      });
    });
    req.setTimeout(90_000, () => req.destroy(new Error('runtime_timeout: query the original operation; do not replay')));
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function resolveAgentEndpoint(target) {
  if (target && typeof target === 'object' && typeof target.agent_endpoint === 'string') return agentDataSocket(target);
  if (typeof target === 'string' && isAbsolute(target) && target.endsWith('.sock')) return target;
  throw new Error('client_configuration_invalid');
}

export function agentRequest(endpointOrDataDir, path, options = {}) {
  const { owner_uid: ownerUid, agent_uid: agentUid, ...requestOptions } = options;
  const socketPath = resolveAgentEndpoint(endpointOrDataDir);
  const resolvedOwnerUid = ownerUid ?? endpointOrDataDir?.owner_uid;
  const resolvedAgentUid = agentUid ?? endpointOrDataDir?.agent_uid;
  if (resolvedAgentUid !== undefined) {
    verifyAgentIdentity(resolvedAgentUid);
  }
  verifyAgentSocket(socketPath, { ownerUid: resolvedOwnerUid, agentUid: resolvedAgentUid });
  return requestSocket(socketPath, path, requestOptions);
}

export function localRequest(client, path, options = {}) {
  return agentRequest(client, path, options);
}

export function ownerRequest(dataDir, path, options = {}) {
  if (Object.hasOwn(options, 'credential')) throw new Error('owner_credential_forbidden');
  const socketPath = ownerControlSocket(dataDir);
  verifyOwnerSocket(socketPath);
  return requestSocket(socketPath, path, options);
}

export async function ensureOwnerRuntime(dataDir, { requireHarbor = false } = {}) {
  const assets = await verifyBundle();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  verifyOwnerDataDirectory(dataDir);
  try {
    const status = await ownerRequest(dataDir, '/status');
    if (status.assets?.digest !== assets.digest) throw new Error('runtime_version_mismatch: stop the old Runtime explicitly before using this installation');
    if (!status.ready && !(requireHarbor && status.harbor_ready === true)) throw new Error(status.error ?? 'runtime_starting');
    return status;
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
  }
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^(WEBENVOY_|HARBOR_|CAMOUFOX_)/.test(key)) delete environment[key];
  const child = spawn(process.execPath, [join(root, 'agent-entry/service.mjs'), dataDir], { detached: true, stdio: 'ignore', env: environment });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    try {
      const status = await ownerRequest(dataDir, '/status');
      if (status.error) throw new Error(status.error);
      if (status.assets && status.assets.digest !== assets.digest) throw new Error('runtime_version_mismatch');
      if (status.ready && status.assets) return status;
    } catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  }
  const diagnostic = await readFile(join(dataDir, 'last-start-error.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  throw new Error(diagnostic.error ?? 'runtime_start_failed: run diagnose; check occupied endpoints and restore verified assets');
}

export async function ensureAgentRuntime(clientOrDataDir) {
  const client = typeof clientOrDataDir === 'object' && clientOrDataDir !== null ? clientOrDataDir : undefined;
  if (!client?.agent_endpoint) throw new Error('client_configuration_invalid');
  if (client.agent_uid !== undefined) {
    verifyAgentIdentity(client.agent_uid);
  }
  const assets = await verifyBundle();
  try {
    const status = await agentRequest(client, '/status');
    if (status.assets?.digest !== assets.digest) throw new Error('runtime_version_mismatch: stop the old Runtime explicitly before using this installation');
    if (!status.ready) throw new Error(status.error ?? 'runtime_starting');
    return status;
  } catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw new Error('runtime_unavailable: owner must start Runtime before Agent connect');
    throw error;
  }
}

export async function probeOwnerSocketAccess(dataDir, { timeoutMs = 500 } = {}) {
  const socketPath = ownerControlSocket(dataDir);
  return await new Promise(resolveProbe => {
    let settled = false;
    const connection = createConnection(socketPath);
    const finish = state => {
      if (settled) return;
      settled = true;
      connection.destroy();
      resolveProbe(state);
    };
    connection.once('connect', () => finish('accessible'));
    connection.once('error', error => finish(['EACCES', 'EPERM'].includes(error.code) ? 'denied' : 'unverified'));
    connection.setTimeout(timeoutMs, () => finish('unverified'));
  });
}

function validWorkerApiResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ok !== true) {
    throw new Error(typeof value?.error?.code === 'string' ? value.error.code : 'managed_site_worker_api_unavailable');
  }
  return value.result;
}

export async function runManagedSiteWorker(client, ticket, { signal } = {}) {
  const request = async (path, body) => agentRequest(client, path, { credential: client.credential, method: 'POST', body });
  let supervisor;
  try {
    verifyAgentIdentity(client.agent_uid);
    if (client.agent_uid === client.owner_uid) throw Object.assign(new Error('worker_identity_unavailable'), { dispatch_state: 'not_dispatched' });
    const status = await ensureAgentRuntime(client);
    const boundary = status?.boundary;
    const identity = boundary?.identity;
    if (boundary?.state !== 'supported' || boundary?.mode !== 'distinct_uid_hardened' ||
        identity?.owner_uid !== client.owner_uid || identity?.agent_uid !== client.agent_uid || identity?.socket_acl !== 'verified') {
      throw Object.assign(new Error('worker_identity_unavailable'), { dispatch_state: 'not_dispatched' });
    }
    const ownerSocketProbe = await probeOwnerSocketAccess(client.data_dir);
    if (ownerSocketProbe !== 'denied') throw Object.assign(new Error('owner_socket_acl_unavailable'), { dispatch_state: 'not_dispatched' });
    supervisor = createManagedSiteWorkerSupervisor({
      installRoot: root, ownerUid: client.owner_uid, agentUid: client.agent_uid, mode: boundary.mode,
      probeOwnerSocket: async () => ownerSocketProbe
    });
    await supervisor.run(ticket, {
      signal,
      onStarted: async value => validWorkerApiResponse(await request('/managed-tasks/worker/started', value)),
      onBroker: async value => validWorkerApiResponse(await request('/managed-tasks/worker/broker', value))
    });
    try {
      return validWorkerApiResponse(await request('/managed-tasks/worker/complete', { ticket_id: ticket.ticket_id }));
    } catch {
      return await queryOriginalWorkerRun(client, ticket);
    }
  } catch (error) {
    const code = typeof error?.message === 'string' && /^[a-z0-9_:-]{1,128}$/.test(error.message) ? error.message : 'managed_site_worker_unavailable';
    try {
      const result = validWorkerApiResponse(await request('/managed-tasks/worker/fail', { ticket_id: ticket.ticket_id, code }));
      if (result?.ok === true) return result;
    } catch { /* resolve the original Run below; never issue a replacement ticket */ }
    return await queryOriginalWorkerRun(client, ticket);
  } finally {
    await supervisor?.stopAll();
  }
}

async function queryOriginalWorkerRun(client, ticket) {
  const value = await agentRequest(client, '/managed-tasks/operations', {
    credential: client.credential,
    method: 'POST',
    body: {
      schema_version: 'webenvoy.managed-task-operation/v1', operation: 'task.query',
      grant_id: ticket.authorization.grant_id, connection_id: ticket.authorization.connection_id,
      task_scope: {
        operations: ['task.query'], skill_refs: [ticket.package.package_ref], source_refs: [ticket.package.revision_ref],
        profile_refs: [ticket.authorization.profile_ref], origins: [ticket.authorization.origin]
      }, selector: { run_id: ticket.run_id }
    }
  });
  if (value?.ok !== true) throw new Error(value?.error?.code ?? 'managed_task_operation_unavailable');
  return value;
}

// Agent/MCP callers retain the old name, but this path never starts a service.
export const ensureRuntime = ensureAgentRuntime;

export async function readClient(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  const hasEndpoint = Object.hasOwn(value ?? {}, 'agent_endpoint');
  const hasOwnerUid = Object.hasOwn(value ?? {}, 'owner_uid');
  const hasAgentUid = Object.hasOwn(value ?? {}, 'agent_uid');
  if (hasEndpoint) verifyAgentClientFile(path);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !isAbsolute(value.data_dir) || !/^[A-Za-z0-9_-]{32,512}$/.test(value.credential) ||
    value.owner_uid !== undefined && (!Number.isSafeInteger(value.owner_uid) || value.owner_uid < 1) ||
    value.agent_uid !== undefined && (!Number.isSafeInteger(value.agent_uid) || value.agent_uid < 1) ||
    Object.keys(value).some(key => !['data_dir', 'credential', 'agent_endpoint', 'agent_uid', 'owner_uid'].includes(key)) ||
    !hasEndpoint || !hasOwnerUid || !hasAgentUid) {
    throw new Error('client_configuration_invalid');
  }
  let endpoint;
  try { endpoint = agentDataSocket(value); } catch { throw new Error('client_configuration_invalid'); }
  const client = { ...value, data_dir: resolve(value.data_dir), agent_endpoint: endpoint };
  if (endpoint === ownerControlSocket(client.data_dir)) throw new Error('client_configuration_invalid');
  return client;
}
