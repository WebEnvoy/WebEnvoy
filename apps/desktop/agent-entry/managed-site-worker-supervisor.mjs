import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const maxTicketBytes = 2 * 1024 * 1024;
const maxFrameBytes = 4 * 1024 * 1024;

function object(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function parseLine(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxFrameBytes) throw new Error('managed_site_worker_protocol_invalid');
  try {
    const frame = JSON.parse(value);
    if (!object(frame)) throw new Error();
    return frame;
  } catch {
    throw new Error('managed_site_worker_protocol_invalid');
  }
}
function exactKeys(value, required, optional = []) {
  return object(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function errorCode(error, fallback) {
  const message = error instanceof Error ? error.message : '';
  return /^(?:managed_site_[a-z0-9_]+|managed_task_[a-z0-9_]+|managed_access_[a-z0-9_]+|owner_socket_acl_unavailable|worker_identity_unavailable)$/.test(message) ? message : fallback;
}
function notDispatched(code) { return Object.assign(new Error(code), { dispatch_state: 'not_dispatched' }); }
function lineQueue(stream) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const buffered = [];
  const waiters = [];
  let ended = false;
  let failure;
  lines.on('line', line => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(line);
    else buffered.push(line);
  });
  lines.on('close', () => {
    ended = true;
    for (const waiter of waiters.splice(0)) waiter.resolve(undefined);
  });
  stream.on('error', error => {
    failure = error;
    ended = true;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  });
  return {
    next() {
      if (failure) return Promise.reject(failure);
      if (buffered.length) return Promise.resolve(buffered.shift());
      if (ended) return Promise.resolve(undefined);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    close() { lines.close(); }
  };
}

function assertTicket(ticket) {
  if (!exactKeys(ticket, ['ticket_id', 'run_id', 'package', 'script', 'authorization', 'target', 'input', 'context', 'deadline_at']) ||
      typeof ticket.ticket_id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(ticket.ticket_id) ||
      typeof ticket.run_id !== 'string' || typeof ticket.deadline_at !== 'number' || !Number.isSafeInteger(ticket.deadline_at) ||
      ticket.deadline_at <= Date.now() || ticket.deadline_at > Date.now() + 60_000 ||
      !exactKeys(ticket.package, ['package_ref', 'revision_ref', 'package_digest', 'task_ref', 'source_ref', 'lock_ref', 'capability_ref', 'capability_version', 'source_admission_ref', 'code_admission_ref']) ||
      !exactKeys(ticket.script, ['script_ref', 'script_version', 'script_sha256', 'runtime_kind', 'entrypoint', 'broker', 'broker_capabilities', 'source']) ||
      typeof ticket.script.source !== 'string' || Buffer.byteLength(ticket.script.source) > 1024 * 1024 ||
      !/^sha256:[a-f0-9]{64}$/.test(ticket.script.script_sha256) ||
      sha256(ticket.script.source) !== ticket.script.script_sha256.slice('sha256:'.length) ||
      ticket.script.runtime_kind !== 'webenvoy.site-skill-script-abi/v1' || ticket.script.entrypoint !== 'run' ||
      ticket.script.broker !== 'webenvoy.site-skill-broker/v1' || !Array.isArray(ticket.script.broker_capabilities) ||
      ticket.script.broker_capabilities.length !== 2 || ticket.script.broker_capabilities[0] !== 'runtime.invoke' || ticket.script.broker_capabilities[1] !== 'output.write' ||
      !exactKeys(ticket.authorization, ['principal_id', 'connection_id', 'grant_id', 'profile_ref', 'origin']) ||
      !exactKeys(ticket.target, ['target_type', 'target_ref']) || ticket.target.target_type !== 'web_page' ||
      !exactKeys(ticket.input, ['schema_ref', 'value']) || !object(ticket.context) || ticket.context.run_id !== ticket.run_id ||
      Buffer.byteLength(JSON.stringify(ticket)) > maxTicketBytes) throw new Error('managed_site_worker_ticket_invalid');
}

export function createManagedSiteWorkerSupervisor({ installRoot, ownerUid, agentUid, mode, probeOwnerSocket }) {
  if (typeof installRoot !== 'string' || !Number.isSafeInteger(ownerUid) || !Number.isSafeInteger(agentUid) ||
      !['trusted_local', 'distinct_uid_hardened'].includes(mode) || typeof probeOwnerSocket !== 'function') throw new Error('managed_site_worker_supervisor_invalid');
  const workerPath = join(installRoot, 'agent-entry/managed-site-worker.mjs');
  const consumedTickets = new Map();
  const active = new Map();

  async function run(ticket, { signal, onStarted, onBroker } = {}) {
    assertTicket(ticket);
    if (typeof onStarted !== 'function' || typeof onBroker !== 'function') throw new Error('managed_site_worker_supervisor_invalid');
    for (const [id, expiresAt] of consumedTickets) if (expiresAt <= Date.now()) consumedTickets.delete(id);
    if (consumedTickets.has(ticket.ticket_id)) throw new Error('managed_site_worker_ticket_reused');
    consumedTickets.set(ticket.ticket_id, ticket.deadline_at);
    if (active.has(ticket.ticket_id)) throw new Error('managed_site_worker_ticket_reused');
    if (mode !== 'distinct_uid_hardened' || ownerUid === agentUid || process.getuid?.() !== agentUid || agentUid === 0) throw notDispatched('worker_identity_unavailable');
    let ownerSocketProbe;
    try { ownerSocketProbe = await probeOwnerSocket(); } catch { ownerSocketProbe = 'unverified'; }
    if (ownerSocketProbe !== 'denied') throw notDispatched('owner_socket_acl_unavailable');

    let child;
    let cancelled = false;
    let brokerDispatched = false;
    const remaining = Math.min(ticket.deadline_at - Date.now(), 60_000);
    const identity = agentUid;
    const spawnOptions = { stdio: ['pipe', 'pipe', 'ignore'], env: {} };
    try {
      child = spawn(process.execPath, ['--experimental-vm-modules', workerPath], spawnOptions);
    } catch (error) {
      throw Object.assign(notDispatched(mode === 'distinct_uid_hardened' ? 'worker_identity_unavailable' : 'managed_site_worker_unavailable'), { cause: error });
    }
    const exitPromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    const reader = lineQueue(child.stdout);
    const settled = exitPromise.then(() => undefined, () => undefined);
    const entry = { child, settled, cancel: () => { cancelled = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 500).unref(); } };
    active.set(ticket.ticket_id, entry);
    const abort = () => entry.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, remaining);
    try {
      const identityLine = await reader.next();
      const identityFrame = parseLine(identityLine);
      if (!exactKeys(identityFrame, ['type', 'uid', 'pid']) || identityFrame.type !== 'identity' || identityFrame.uid !== identity || identityFrame.pid !== child.pid) {
        throw new Error('worker_identity_unavailable');
      }
      if (cancelled || signal?.aborted) throw new Error('managed_site_worker_cancelled');
      await onStarted({ ticket_id: ticket.ticket_id });
      child.stdin.write(`${JSON.stringify({ source: ticket.script.source, input: ticket.input.value, context: ticket.context,
        broker_capabilities: ticket.script.broker_capabilities, execution_timeout_ms: remaining })}\n`);
      let expectedId = 1;
      for (;;) {
        if (cancelled || signal?.aborted) throw new Error('managed_site_worker_cancelled');
        const line = await reader.next();
        if (cancelled || signal?.aborted) throw new Error('managed_site_worker_cancelled');
        if (line === undefined) throw new Error('managed_site_worker_unavailable');
        const frame = parseLine(line);
          if (frame.type === 'broker.request') {
            if (!exactKeys(frame, ['type', 'id', 'method', 'input']) || frame.id !== expectedId++ ||
              !ticket.script.broker_capabilities.includes(frame.method)) throw new Error('managed_site_worker_protocol_invalid');
          try {
            const result = await onBroker({ ticket_id: ticket.ticket_id, method: frame.method, input: frame.input });
            if (frame.method === 'runtime.invoke') brokerDispatched = true;
            child.stdin.write(`${JSON.stringify({ type: 'broker.response', id: frame.id, ok: true, result: result ?? null })}\n`);
          } catch (error) {
            if (frame.method === 'runtime.invoke' && error?.dispatch_state !== 'not_dispatched') brokerDispatched = true;
            child.stdin.write(`${JSON.stringify({ type: 'broker.response', id: frame.id, ok: false, code: errorCode(error, 'managed_site_broker_denied') })}\n`);
          }
          continue;
        }
        if (frame.type === 'complete' && Object.keys(frame).length === 1) {
          const result = await exitPromise;
          if (result.code !== 0) throw new Error('managed_site_worker_unavailable');
          return;
        }
        if (frame.type === 'failure' && exactKeys(frame, ['type', 'code']) && typeof frame.code === 'string') {
          await exitPromise.catch(() => undefined);
          throw new Error(errorCode(new Error(frame.code), 'managed_site_script_failed'));
        }
        throw new Error('managed_site_worker_protocol_invalid');
      }
    } catch (error) {
      entry.cancel();
      await exitPromise.catch(() => undefined);
      if (error && typeof error === 'object') error.dispatch_state = brokerDispatched ? 'dispatched' : 'not_dispatched';
      throw error;
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      reader.close();
      active.delete(ticket.ticket_id);
    }
  }

  async function cancel(ticketId) {
    const current = active.get(ticketId);
    if (!current) return { cancelled: false };
    current.cancel();
    await current.settled;
    return { cancelled: true };
  }

  async function stopAll() {
    const workers = [...active.values()];
    for (const worker of workers) worker.cancel();
    await Promise.all(workers.map(worker => worker.settled));
  }

  return { run, cancel, stopAll };
}
