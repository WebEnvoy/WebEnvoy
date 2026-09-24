import { createContext, Script, SourceTextModule } from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

const maxFrameBytes = 32 * 1024 * 1024;
const maxSourceBytes = 1024 * 1024;
const maxOutputBytes = 1024 * 1024;
const scriptExecutionTimeoutMs = 2_000;
let nextId = 0;
let outputAttempted = false;
let snapshotAttempted = false;
let networkReadAttempted = false;
let requestCapabilities = new Set();
const pendingBrokerCalls = new Map();

if (!parentPort) throw new Error('managed_site_worker_parent_unavailable');

function emit(frame) {
  if (Buffer.byteLength(JSON.stringify(frame)) > maxFrameBytes) throw new Error('managed_site_worker_frame_too_large');
  parentPort.postMessage(frame);
}

function assertRequest(value) {
  const pageRead = value.broker_capabilities?.[0] === 'runtime.invoke' && value.broker_capabilities?.[1] === 'output.write';
  const publicRead = value.broker_capabilities?.[0] === 'network.read' && value.broker_capabilities?.[1] === 'output.write';
  if (Object.keys(value).some(key => !['source', 'input', 'context', 'broker_capabilities', 'execution_timeout_ms'].includes(key)) ||
      typeof value.source !== 'string' || Buffer.byteLength(value.source) > maxSourceBytes ||
      !Object.hasOwn(value, 'input') || !value.context || typeof value.context !== 'object' || Array.isArray(value.context) ||
      !Array.isArray(value.broker_capabilities) || value.broker_capabilities.length !== 2 || !(pageRead || publicRead) ||
      !Number.isSafeInteger(value.execution_timeout_ms) || value.execution_timeout_ms < 1 || value.execution_timeout_ms > 60_000) {
    throw new Error('managed_site_worker_request_invalid');
  }
}

parentPort.on('message', response => {
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      Object.keys(response).some(key => !['type', 'id', 'ok', 'result', 'code'].includes(key)) ||
      response.type !== 'broker.response' || !Number.isSafeInteger(response.id) || typeof response.ok !== 'boolean') {
    const pending = [...pendingBrokerCalls.values()];
    pendingBrokerCalls.clear();
    for (const item of pending) item.reject(new Error('managed_site_broker_response_invalid'));
    return;
  }
  const pending = pendingBrokerCalls.get(response.id);
  if (!pending) return;
  pendingBrokerCalls.delete(response.id);
  if (response.ok) pending.resolve(response.result ?? null);
  else pending.reject(new Error(typeof response.code === 'string' ? response.code : 'managed_site_broker_denied'));
});

async function broker(method, encodedInput) {
  if (!requestCapabilities.has(method)) throw new Error('managed_site_broker_method_forbidden');
  if (method === 'runtime.invoke') {
    if (snapshotAttempted) throw new Error('managed_site_capability_call_already_used');
    snapshotAttempted = true;
    const value = JSON.parse(encodedInput);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        value.operation_id !== 'instance.snapshot' || value.action !== 'read') {
      throw new Error('managed_site_capability_not_admitted');
    }
  } else if (method === 'network.read') {
    if (networkReadAttempted || Buffer.byteLength(encodedInput) > 4096) throw new Error('managed_site_capability_call_already_used');
    networkReadAttempted = true;
  } else if (method === 'input.read') {
    if (encodedInput !== 'null') throw new Error('managed_site_input_invalid');
  } else if (method === 'output.write') {
    if (outputAttempted) throw new Error('managed_site_output_already_written');
    outputAttempted = true;
    if (Buffer.byteLength(encodedInput) > maxOutputBytes) throw new Error('managed_site_output_too_large');
  } else {
    throw new Error('managed_site_broker_method_forbidden');
  }

  const id = ++nextId;
  const input = JSON.parse(encodedInput);
  return JSON.stringify(await new Promise((resolve, reject) => {
    pendingBrokerCalls.set(id, { resolve, reject });
    try { emit({ type: 'broker.request', id, method, input }); }
    catch (error) { pendingBrokerCalls.delete(id); reject(error); }
  }));
}

async function main() {
  const request = workerData;
  assertRequest(request);
  requestCapabilities = new Set(request.broker_capabilities);

  const sandbox = Object.create(null);
  const context = createContext(sandbox, {
    name: 'approved-managed-site-script',
    codeGeneration: { strings: false, wasm: false }
  });
  const module = new SourceTextModule(request.source, {
    context,
    identifier: 'lode-approved-site-script.mjs',
    initializeImportMeta() {},
    importModuleDynamically() { throw new Error('managed_site_script_import_forbidden'); }
  });
  if (module.dependencySpecifiers.length > 0) throw new Error('managed_site_script_import_forbidden');
  await module.link(() => { throw new Error('managed_site_script_import_forbidden'); });
  await module.evaluate({ timeout: 5000 });
  if (typeof module.namespace.run !== 'function') throw new Error('managed_site_script_entrypoint_invalid');

  Object.defineProperties(sandbox, {
    __siteBridge: { value: broker, configurable: true },
    __siteRun: { value: module.namespace.run, configurable: true },
    __siteCapabilities: { value: JSON.stringify([...requestCapabilities]), configurable: true }
  });
  new Script(`
    (() => {
      const bridge = globalThis.__siteBridge;
      const run = globalThis.__siteRun;
      const caps = new Set(JSON.parse(globalThis.__siteCapabilities));
      delete globalThis.__siteBridge;
      delete globalThis.__siteRun;
      delete globalThis.__siteCapabilities;
      const call = async (method, value) => {
        const encoded = JSON.stringify(value);
        if (typeof encoded !== 'string') throw new Error('managed_site_broker_input_invalid');
        return JSON.parse(await bridge(method, encoded));
      };
      const broker = Object.freeze({
        ...(caps.has('runtime.invoke') ? { runtime: Object.freeze({ invoke: value => call('runtime.invoke', value) }) } : {}),
        ...(caps.has('network.read') ? { network: Object.freeze({ read: value => call('network.read', value) }) } : {}),
        output: Object.freeze({ write: value => call('output.write', value) })
      });
      globalThis.__invokeApprovedSiteTask = (inputJson, contextJson) => run(JSON.parse(inputJson), broker, JSON.parse(contextJson));
    })();
  `, { filename: 'managed-site-worker-host' }).runInContext(context, { timeout: 5000 });

  const runResult = new Script(`globalThis.__runResult = globalThis.__invokeApprovedSiteTask(${JSON.stringify(JSON.stringify(request.input))}, ${JSON.stringify(JSON.stringify(request.context))});`, {
    filename: 'managed-site-worker-invoke'
  }).runInContext(context, { timeout: scriptExecutionTimeoutMs });
  await runResult;
  if (!outputAttempted) throw new Error('managed_site_output_missing');
  emit({ type: 'complete' });
  parentPort.close();
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'managed_site_script_failed';
  const code = /^(?:managed_site_[a-z0-9_]+|managed_task_[a-z0-9_]+|managed_access_[a-z0-9_]+|worker_identity_unavailable|owner_socket_acl_unavailable)$/.test(message) ? message : 'managed_site_script_failed';
  try { emit({ type: 'failure', code }); } catch {}
  process.exitCode = 1;
  parentPort.close();
});
