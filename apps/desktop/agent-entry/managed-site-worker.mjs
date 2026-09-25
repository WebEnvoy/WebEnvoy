import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';

const maxFrameBytes = 32 * 1024 * 1024;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
let scriptWorker;
let finished = false;
let intentionalInputClose = false;
let executionTimer;

function object(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function parseFrame(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > maxFrameBytes) throw new Error('managed_site_worker_frame_invalid');
  try {
    const value = JSON.parse(line);
    if (!object(value)) throw new Error();
    return value;
  } catch {
    throw new Error('managed_site_worker_frame_invalid');
  }
}
function exactKeys(value, required, optional = []) {
  return object(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function emit(frame) {
  const encoded = JSON.stringify(frame);
  if (Buffer.byteLength(encoded) > maxFrameBytes) throw new Error('managed_site_worker_frame_too_large');
  process.stdout.write(`${encoded}\n`);
}
function finish(frame, exitCode = 0) {
  if (finished) return;
  finished = true;
  clearTimeout(executionTimer);
  try { emit(frame); } catch { exitCode = 1; }
  process.exitCode = exitCode;
  intentionalInputClose = true;
  void scriptWorker?.terminate();
  process.stdin.destroy();
}
function validRequest(request) {
  const pageRead = request.broker_capabilities?.[0] === 'runtime.invoke' && request.broker_capabilities?.[1] === 'output.write';
  const publicRead = request.broker_capabilities?.[0] === 'network.read' && request.broker_capabilities?.[1] === 'output.write';
  return exactKeys(request, ['source', 'input', 'context', 'broker_capabilities', 'execution_timeout_ms']) &&
    typeof request.source === 'string' && Buffer.byteLength(request.source) <= 1024 * 1024 &&
    object(request.context) && Array.isArray(request.broker_capabilities) &&
    request.broker_capabilities.length === 2 && (pageRead || publicRead) && Number.isSafeInteger(request.execution_timeout_ms) &&
    request.execution_timeout_ms > 0 && request.execution_timeout_ms <= 60_000;
}

emit({ type: 'identity', uid: process.getuid?.() ?? null, pid: process.pid });

process.stdin.once('close', () => {
  if (!finished && !intentionalInputClose) {
    finished = true;
    clearTimeout(executionTimer);
    void scriptWorker?.terminate();
    process.exit(1);
  }
});

async function main() {
  const first = await iterator.next();
  if (first.done) throw new Error('managed_site_worker_request_invalid');
  const request = parseFrame(first.value);
  if (!validRequest(request)) throw new Error('managed_site_worker_request_invalid');
  scriptWorker = new Worker(new URL('./managed-site-script-thread.mjs', import.meta.url), {
    workerData: request
  });
  executionTimer = setTimeout(() => finish({ type: 'failure', code: 'managed_site_worker_timeout' }, 1), request.execution_timeout_ms);
  scriptWorker.on('message', frame => {
    if (!object(frame) || typeof frame.type !== 'string') return finish({ type: 'failure', code: 'managed_site_worker_protocol_invalid' }, 1);
    if (frame.type === 'broker.request') {
      if (!exactKeys(frame, ['type', 'id', 'method', 'input']) || !Number.isSafeInteger(frame.id) || frame.id < 1 ||
          !['runtime.invoke', 'network.read', 'output.write'].includes(frame.method) || Buffer.byteLength(JSON.stringify(frame)) > maxFrameBytes) {
        return finish({ type: 'failure', code: 'managed_site_worker_protocol_invalid' }, 1);
      }
      try { emit(frame); } catch { finish({ type: 'failure', code: 'managed_site_worker_protocol_invalid' }, 1); }
      return;
    }
    if (frame.type === 'complete' && Object.keys(frame).length === 1) return finish({ type: 'complete' });
    if (frame.type === 'failure' && exactKeys(frame, ['type', 'code']) &&
        typeof frame.code === 'string' && /^[a-z0-9_:-]{1,128}$/.test(frame.code)) {
      return finish(frame, 1);
    }
    finish({ type: 'failure', code: 'managed_site_worker_protocol_invalid' }, 1);
  });
  scriptWorker.on('error', () => finish({ type: 'failure', code: 'managed_site_worker_unavailable' }, 1));
  scriptWorker.on('exit', code => {
    if (!finished && code !== 0) finish({ type: 'failure', code: 'managed_site_worker_unavailable' }, 1);
  });

  for (;;) {
    const next = await iterator.next();
    if (next.done) {
      if (!finished) finish({ type: 'failure', code: 'managed_site_broker_unavailable' }, 1);
      return;
    }
    const response = parseFrame(next.value);
    if (!exactKeys(response, ['type', 'id', 'ok'], ['result', 'code']) || response.type !== 'broker.response' ||
        !Number.isSafeInteger(response.id) || response.id < 1 || typeof response.ok !== 'boolean' ||
        response.ok && Object.hasOwn(response, 'code') || !response.ok && typeof response.code !== 'string') {
      finish({ type: 'failure', code: 'managed_site_broker_response_invalid' }, 1);
      return;
    }
    scriptWorker.postMessage(response);
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  const code = /^(?:managed_site_[a-z0-9_]+|managed_task_[a-z0-9_]+|managed_access_[a-z0-9_]+|worker_identity_unavailable|owner_socket_acl_unavailable)$/.test(message)
    ? message : 'managed_site_worker_request_invalid';
  finish({ type: 'failure', code }, 1);
});
