// Auxiliary contract/process checks. Real Codex and App UI consumption is a separate acceptance path.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const run = promisify(execFile);
const app = resolve(process.argv[2]);
const executable = join(app, 'Contents/MacOS/Electron');
const directory = await mkdtemp('/tmp/webenvoy-check-');
const root = join(directory, 'assets');
await cp(join(app, 'Contents/Resources/app'), root, { recursive: true });
const cli = async (command, data = join(directory, 'data')) => JSON.parse((await run(executable, [join(root, 'agent-entry/cli.mjs'), command, '--data-dir', data, '--host-dir', join(directory, 'host')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000 })).stdout);
const { ensureRuntime, localRequest } = await import(pathToFileURL(join(root, 'agent-entry/client.mjs')));
const { verifyBundle } = await import(pathToFileURL(join(root, 'agent-entry/bundle.mjs')));
const data = join(directory, 'data');
let running = false;
try {
  await cli('setup');
  await cli('setup'); // Exact repeat is recoverable without replacing another host config.
  const first = await cli('start'); running = true;
  assert.equal(first.ready, true);
  const { connectInstalledRuntime } = await import(pathToFileURL(join(root, 'dist-electron/installedRuntime.js')));
  const appConnection = await connectInstalledRuntime(data);
  assert(appConnection.getCoreRuntimeSupervisorToken(first.coreEndpoint + '/'));
  assert.equal(appConnection.getCoreRuntimeSupervisorToken('http://127.0.0.1:1/'), undefined);
  assert.equal((await ensureRuntime(data)).runtime_id, first.runtime_id);
  const client = JSON.parse(await readFile(join(directory, 'host/webenvoy-client.json'), 'utf8'));
  assert.equal((await localRequest(data, '/agent-connections', { method: 'POST', credential: client.credential, body: {} })).error.code, 'managed_access_authentication_required');
  assert.equal((await localRequest(data, '/agent-access', { credential: client.credential })).error.code, 'agent_route_denied');
  const owner = JSON.parse(await readFile(join(data, 'owner.json'), 'utf8'));
  const ownerCall = async (path, body) => (await fetch(first.coreEndpoint + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.credential}` }, body: JSON.stringify(body) })).json();
  const registered = await ownerCall('/agent-access/principals', { idempotency_key: 'aux-register', display_name: 'Auxiliary connector check', credential_hash: createHash('sha256').update(client.credential).digest('hex') });
  const granted = await ownerCall('/agent-access/grants', { idempotency_key: 'aux-grant', principal_id: registered.principal.principal_id, profile_refs: [], allowed_operations: ['profile.list'], allowed_origins: [], expires_at: new Date(Date.now() + 60000).toISOString(), max_created_profiles: 0, creation_template: null });
  let connector = mcp();
  const connected = await connector.call('webenvoy_connect');
  assert.equal(connected.grants[0].grant_id, granted.grant.grant_id);
  const submitted = await connector.call('webenvoy_operation', { idempotency_key: 'lost-response', grant_id: granted.grant.grant_id, operation: 'profile.list', task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] } });
  assert.equal(submitted.ok, true);
  await connector.close();
  connector = mcp();
  const reconnected = await connector.call('webenvoy_connect');
  assert.notEqual(reconnected.connection.connection_id, connected.connection.connection_id);
  assert.equal(reconnected.connection.principal_id, connected.connection.principal_id);
  // The reconnecting host has only the original key; the prior response/run id is not needed.
  assert.deepEqual(await connector.call('webenvoy_query', { idempotency_key: 'lost-response' }), submitted);
  await connector.close();
  const required = join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md');
  const original = await readFile(required);
  await writeFile(required, 'corrupt');
  await assert.rejects(ensureRuntime(data), /asset_integrity_failed/);
  await writeFile(required, original);
  await rename(required, required + '.held');
  await assert.rejects(ensureRuntime(data), /ENOENT/);
  await rename(required + '.held', required);
  const manifestPath = join(root, 'agent-manifest.json'), manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText); manifest.skill_version = '99';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(ensureRuntime(data), /asset_version_mismatch/);
  await writeFile(manifestPath, manifestText);
  const sites = join(root, 'dist-electron/lode/sites');
  await rename(sites, sites + '.held');
  assert.equal((await verifyBundle()).optional_website_assets.state, 'unavailable');
  assert.equal((await ensureRuntime(data)).runtime_id, first.runtime_id);
  assert.equal((await localRequest(data, '/agent-connections', { method: 'POST', credential: client.credential, body: {} })).ok, true);
  await rename(sites + '.held', sites);
  await cli('stop'); running = false;
  const config = JSON.parse(await readFile(join(data, 'installation.json'), 'utf8'));
  let authenticatedRequests = 0;
  const unrelated = createServer((req, res) => { if (req.headers.authorization) authenticatedRequests++; res.end(JSON.stringify({ status: 'ready' })); });
  await new Promise(resolve => unrelated.listen(Number(new URL(config.coreEndpoint).port), '127.0.0.1', resolve));
  await assert.rejects(cli('start'), /runtime_endpoint_or_process_failed|runtime_start_failed/);
  assert.equal(authenticatedRequests, 0);
  await new Promise(resolve => unrelated.close(resolve));
  // Wait for the failed service's own bounded shutdown, not an arbitrary browser delay.
  for (let i = 0; i < 50; i++) {
    try { await localRequest(data, '/status'); } catch { break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const restarted = await cli('start'); running = true;
  assert.equal(restarted.ready, true); assert.notEqual(restarted.runtime_id, first.runtime_id);
  assert.equal((await verifyBundle()).integrity, 'verified');
  console.log('Installed auxiliary checks passed: startup/discovery, unregistered/owner denial, required missing/corrupt/version refusal and recovery, optional website isolation, occupied endpoint fail-closed/recovery, explicit stop/restart. No live Provider or host evidence claimed.');
} finally {
  if (running) await cli('stop');
  await rm(directory, { recursive: true, force: true });
}

function mcp() {
  const child = spawn(executable, [join(root, 'agent-entry/mcp.mjs'), join(directory, 'host/webenvoy-client.json')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe','pipe','ignore'] });
  const pending = new Map(); let id = 0;
  createInterface({ input: child.stdout }).on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id); });
  return {
    async call(name, args = {}) {
      const key = ++id;
      const response = await new Promise(resolve => { pending.set(key, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method: 'tools/call', params: { name, arguments: args } }) + '\n'); });
      assert.equal(response.result.isError, undefined, response.result.content[0].text);
      return JSON.parse(response.result.content[0].text);
    },
    close: () => new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); }),
  };
}
