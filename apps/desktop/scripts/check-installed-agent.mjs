// Auxiliary contract/process checks. Real Codex and App UI consumption is a separate acceptance path.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const run = promisify(execFile);
const app = resolve(process.argv[2]);
const executable = join(app, 'Contents/MacOS/Electron');
const directory = await mkdtemp('/tmp/webenvoy-check-');
const root = join(directory, 'assets');
await cp(join(app, 'Contents/Resources/app'), root, { recursive: true });
const upstreamSourceDir = process.env.WEBENVOY_UPSTREAM_SOURCE_DIR ?? '/private/tmp/webenvoy-upstream-source-audit.LWbSiJ';
const upstreamBrowserRoot = process.env.WEBENVOY_CAMOUFOX_BROWSER_ROOT ?? '/Users/claw/Library/Caches/camoufox/browsers/official/152.0.4-beta.30-3b43e766/Camoufox.app';
const upstreamBrowserExecutable = process.env.WEBENVOY_CAMOUFOX_BROWSER_EXECUTABLE ?? join(upstreamBrowserRoot, 'Contents/MacOS/camoufox');
const upstreamPython = process.env.WEBENVOY_CAMOUFOX_PYTHON ?? '/Users/claw/.webenvoy/providers/camoufox/venv/bin/python';
const upstreamSetupArgs = [
  '--browser-install-root', upstreamBrowserRoot, '--browser-executable', upstreamBrowserExecutable, '--python-path', upstreamPython,
  '--browser-version', '152.0.4-beta.30', '--camoufox-version', '0.5.6', '--playwright-version', '1.60.0',
  '--browser-source-path', join(upstreamSourceDir, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
  '--camoufox-source-path', join(upstreamSourceDir, 'camoufox-0.5.6-py3-none-any.whl'),
  '--playwright-source-path', join(upstreamSourceDir, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')
];
const cli = async (command, data = join(directory, 'data'), extra = []) => JSON.parse((await run(executable, [join(root, 'agent-entry/cli.mjs'), command, '--data-dir', data, '--host-dir', join(directory, 'host'), ...extra], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000 })).stdout);
const { ensureRuntime, localRequest } = await import(pathToFileURL(join(root, 'agent-entry/client.mjs')));
const { verifyBundle } = await import(pathToFileURL(join(root, 'agent-entry/bundle.mjs')));
const data = join(directory, 'data');
let running = false;
let owner;
let ownerCall;
let grantId;
let connector;
let originServer;
try {
  await cli('setup', join(directory, 'data'), upstreamSetupArgs);
  await cli('setup', join(directory, 'data'), upstreamSetupArgs); // Exact repeat is recoverable without replacing another host config.
  await assert.rejects(
    run(executable, [join(root, 'agent-entry/cli.mjs'), 'setup', '--data-dir', data, '--host-dir', join(directory, 'host'), '--camoufox-artifact', join(directory, 'retired.app')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000 }),
    error => `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`.includes('camoufox_artifact_binding_retired')
  );
  const installationPath = join(data, 'installation.json');
  const installation = JSON.parse(await readFile(installationPath, 'utf8'));
  const legacyCamoufoxBinding = {
    app: join(directory, 'WebEnvoy Camoufox Native Tab Handoff Test.app'),
    executable: join(directory, 'WebEnvoy Camoufox Native Tab Handoff Test.app/Contents/MacOS/camoufox'),
    manifest: join(directory, 'WebEnvoy Camoufox Native Tab Handoff Test.app/Contents/Resources/webenvoy-native-manifest.json'),
    manifest_sha256: '5'.repeat(64)
  };
  const spawnMarker = join(directory, 'camoufox-spawned');
  await mkdir(dirname(legacyCamoufoxBinding.executable), { recursive: true });
  await writeFile(legacyCamoufoxBinding.executable, `#!/bin/sh\ntouch ${JSON.stringify(spawnMarker)}\nsleep 10\n`);
  await chmod(legacyCamoufoxBinding.executable, 0o755);
  await writeFile(installationPath, JSON.stringify({ ...installation, camoufoxArtifact: legacyCamoufoxBinding }));
  const first = await cli('start'); running = true;
  assert.equal(first.ready, true);
  assert.deepEqual(first.camoufox_launch, { state: 'retired', reason: 'retired_binding' });
  assert.deepEqual(JSON.parse(await readFile(installationPath, 'utf8')).camoufoxArtifact, legacyCamoufoxBinding);
  const { connectInstalledRuntime } = await import(pathToFileURL(join(root, 'dist-electron/installedRuntime.js')));
  const appConnection = await connectInstalledRuntime(data);
  assert(appConnection.getCoreRuntimeSupervisorToken(first.coreEndpoint + '/'));
  assert.equal(appConnection.getCoreRuntimeSupervisorToken('http://127.0.0.1:1/'), undefined);
  assert.equal((await ensureRuntime(data)).runtime_id, first.runtime_id);
  const client = JSON.parse(await readFile(join(directory, 'host/webenvoy-client.json'), 'utf8'));
  assert.equal((await localRequest(data, '/agent-connections', { method: 'POST', credential: client.credential, body: {} })).error.code, 'managed_access_authentication_required');
  assert.equal((await localRequest(data, '/agent-access', { credential: client.credential })).error.code, 'owner_authentication_required');
  owner = JSON.parse(await readFile(join(data, 'owner.json'), 'utf8'));
  ownerCall = async (path, body, method = 'POST') => (await fetch(first.coreEndpoint + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.credential}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();
  const registered = await ownerCall('/agent-access/principals', { idempotency_key: 'aux-register', display_name: 'Auxiliary connector check', credential_hash: createHash('sha256').update(client.credential).digest('hex') });
  originServer = createServer((req, res) => { res.end('local auxiliary origin'); });
  await new Promise(resolve => originServer.listen(0, '127.0.0.1', resolve));
  const originAddress = originServer.address();
  assert(originAddress && typeof originAddress !== 'string');
  const origin = `http://127.0.0.1:${originAddress.port}`;
  const granted = await ownerCall('/agent-access/grants', { idempotency_key: 'aux-grant', principal_id: registered.principal.principal_id, profile_refs: [], allowed_operations: ['profile.create', 'profile.list', 'instance.start'], allowed_origins: [origin], expires_at: new Date(Date.now() + 60000).toISOString(), max_created_profiles: 1, creation_template: { template_ref: 'aux-chrome', provider_id: 'chrome_official', site: { site_id: 'auxiliary', origin, display_name: 'Auxiliary' }, language: 'en-US', timezone: 'UTC', permission_ceiling: { allowed_operations: ['profile.list', 'instance.start'], allowed_origins: [origin] } } });
  grantId = granted.grant.grant_id;
  const policy = await ownerCall('/agent-access/management-policy', { schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: 'aux-management-policy', expected_source_version: null, modes: { read: 'auto', commit: 'auto' } }, 'PUT');
  assert.equal(policy.ok, true, JSON.stringify(policy));
  connector = mcp();
  const statusView = await connector.call('webenvoy_status');
  assert.deepEqual(statusView.camoufox_launch, { state: 'retired', reason: 'retired_binding' });
  assert.equal(Object.hasOwn(statusView, 'camoufoxArtifact'), false);
  const connected = await connector.call('webenvoy_connect');
  assert.equal(connected.grants[0].grant_id, granted.grant.grant_id);
  const submitted = await connector.call('webenvoy_operation', { idempotency_key: 'lost-response', grant_id: granted.grant.grant_id, operation: 'profile.list', task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] } });
  assert.equal(submitted.ok, true);
  const skill = await connector.call('webenvoy_skill');
  assert.equal(typeof skill.skill, 'string');
  assert(skill.skill.includes('webenvoy-browser'));
  const created = await connector.call('webenvoy_operation', { idempotency_key: 'aux-profile-create', grant_id: grantId, operation: 'profile.create', template_ref: 'aux-chrome', task_scope: { operations: ['profile.create'], profile_refs: [], origins: [origin] } });
  assert.equal(created.ok, true, JSON.stringify(created));
  const profileRef = created.result?.profile?.profile_ref;
  assert.equal(typeof profileRef, 'string', JSON.stringify(created));
  await connector.close(); connector = undefined;
  connector = mcp();
  const reconnected = await connector.call('webenvoy_connect');
  assert.notEqual(reconnected.connection.connection_id, connected.connection.connection_id);
  assert.equal(reconnected.connection.principal_id, connected.connection.principal_id);
  // The reconnecting host has only the original key; the prior response/run id is not needed.
  assert.deepEqual(await connector.call('webenvoy_query', { idempotency_key: 'lost-response' }), submitted);
  await connector.close(); connector = undefined;
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
  await cli('stop'); running = false;
  const harborStorePath = join(data, 'harbor/identity-environments.json');
  const harborStore = JSON.parse(await readFile(harborStorePath, 'utf8'));
  const storedProfile = harborStore.records?.find(record => record.identity_environment?.profile_ref === profileRef);
  assert(storedProfile, 'profile.create must persist an identity environment');
  const provider = storedProfile.identity_environment.provider_binding.selected_provider;
  storedProfile.identity_environment.environment.browser_family = 'camoufox';
  storedProfile.identity_environment.provider_binding = {
    ...storedProfile.identity_environment.provider_binding,
    selected_provider_id: 'camoufox',
    selection_reason: 'requested_provider_unavailable',
    requires_user_notice: true,
    selected_provider: {
      ...provider,
      provider_id: 'camoufox',
      display_name: 'Camoufox',
      role: 'qualification',
      management_mode: 'external',
      install: { ...provider.install, status: 'installed', path: legacyCamoufoxBinding.executable, launchability: 'not_checked', reason: 'Camoufox 私有浏览器/Driver 绑定已退役。' }
    },
    fallback_provider_id: null,
    unavailable_reason: null
  };
  await writeFile(harborStorePath, JSON.stringify(harborStore, null, 2));
  await cli('setup');
  assert.deepEqual(JSON.parse(await readFile(join(data, 'installation.json'), 'utf8')).camoufoxArtifact, legacyCamoufoxBinding);
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
  assert.equal(restarted.assets.optional_website_assets.state, 'unavailable');
  owner = JSON.parse(await readFile(join(data, 'owner.json'), 'utf8'));
  ownerCall = async (path, body, method = 'POST') => (await fetch(restarted.coreEndpoint + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.credential}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();
  connector = mcp();
  const reconnectAfterRestart = await connector.call('webenvoy_connect');
  assert.equal(reconnectAfterRestart.connection.principal_id, registered.principal.principal_id);
  const camoufoxStart = await connector.call('webenvoy_operation', { idempotency_key: 'camoufox-start', grant_id: grantId, operation: 'instance.start', profile_ref: profileRef, origin, url: `${origin}/`, task_scope: { operations: ['instance.start'], profile_refs: [profileRef], origins: [origin] } });
  assert.equal(camoufoxStart.ok, false, JSON.stringify(camoufoxStart));
  assert.equal(camoufoxStart.failure?.code, 'unsupported', JSON.stringify(camoufoxStart));
  assert.equal(await readFile(spawnMarker, 'utf8').catch(() => null), null, 'retired Camoufox binding must not spawn');
  await connector.close(); connector = undefined;
  const revoked = await ownerCall(`/agent-access/grants/${encodeURIComponent(grantId)}/revoke`, { idempotency_key: 'aux-revoke' });
  assert.equal(revoked.grant?.grant_id, grantId);
  assert.equal(typeof revoked.grant?.revoked_at, 'string');
  grantId = undefined;
  await rename(sites + '.held', sites);
  assert.equal((await verifyBundle()).integrity, 'verified');
  console.log('Installed auxiliary checks passed: startup/discovery, unregistered/owner denial, required missing/corrupt/version refusal and recovery, optional website isolation, occupied endpoint fail-closed/recovery, explicit stop/restart. No live Provider or host evidence claimed.');
} finally {
  if (connector) await connector.close().catch(() => {});
  if (running && grantId) {
    const currentStatus = await localRequest(data, '/status');
    const currentOwner = JSON.parse(await readFile(join(data, 'owner.json'), 'utf8'));
    const revoked = await localRequest(data, `/agent-access/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', credential: currentOwner.credential, body: { idempotency_key: 'aux-revoke-final' } });
    assert.equal(revoked.grant?.grant_id, grantId);
    assert.equal(typeof revoked.grant?.revoked_at, 'string');
    assert.equal(currentStatus.ready, true);
    grantId = undefined;
  }
  if (running) await cli('stop');
  if (originServer?.listening) await new Promise(resolve => originServer.close(resolve));
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
