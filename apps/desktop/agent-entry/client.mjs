import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, verifyBundle } from './bundle.mjs';
export function localRequest(dataDir, path, { method = 'GET', body, credential } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const succeed = value => { if (!settled) { settled = true; resolve(value); } };
    const req = request({ socketPath: join(dataDir, 'runtime.sock'), path, method, headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) } }, res => {
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
      res.on('end', () => { if (settled) return; try { succeed(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(new Error('runtime_response_invalid')); } });
    });
    req.setTimeout(90_000, () => req.destroy(new Error('runtime_timeout: query the original operation; do not replay')));
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
export async function ensureRuntime(dataDir) {
  const assets = await verifyBundle();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  try {
    const status = await localRequest(dataDir, '/status');
    if (status.assets?.digest !== assets.digest) throw new Error('runtime_version_mismatch: stop the old Runtime explicitly before using this installation');
    if (!status.ready) throw new Error(status.error ?? 'runtime_starting');
    return status;
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
  }
  // Only the service process handles owner credentials; the connector never reads them.
  const child = spawn(process.execPath, [join(root, 'agent-entry/service.mjs'), dataDir], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const status = await localRequest(dataDir, '/status');
      if (status.error) throw new Error(status.error);
      if (status.assets && status.assets.digest !== assets.digest) throw new Error('runtime_version_mismatch');
      if (status.ready && status.assets) return status;
    } catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  }
  const diagnostic = await readFile(join(dataDir, 'last-start-error.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  throw new Error(diagnostic.error ?? 'runtime_start_failed: run diagnose; check occupied endpoints and restore verified assets');
}
export async function readClient(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!value.data_dir || !/^[A-Za-z0-9_-]{32,512}$/.test(value.credential)) throw new Error('client_configuration_invalid');
  return value;
}
