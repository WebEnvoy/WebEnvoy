import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Installed CLI acceptance against one synthetic public page; no model or account.
const packageRoot = resolve(process.argv[2] ?? '');
const materialRoot = resolve((await readFile(process.argv[3] ?? '/tmp/webenvoy-w1-material-root.txt', 'utf8')).trim());
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('site_task_check_requires_macos_arm64');
const root = await mkdtemp('/tmp/webenvoy-site-task-');
const cli = join(packageRoot, 'bin/webenvoy');
const ownerData = join(root, 'owner');
const host = join(root, 'agent');
const clientFile = join(host, 'webenvoy-client.json');
const requests = join(host, 'requests');
await mkdir(requests, { recursive: true, mode: 0o700 });
const run = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const manifestBytes = await readFile(join(packageRoot, 'agent-manifest.json'));
const bundle = JSON.parse(manifestBytes);
const site = JSON.parse(await readFile(join(packageRoot, 'dist-electron/lode/sites/controlled-local/page-summary/manifest.json'), 'utf8'));
const task = JSON.parse(await readFile(join(packageRoot, 'dist-electron/lode/sites/controlled-local/page-summary', site.tasks[0].path), 'utf8'));
const origin = 'http://127.0.0.1:4173';
assert.deepEqual(site.site.supported_origins, [origin]);
const evidence = {
  schema: 'webenvoy.site-task-installed-check/v1', candidate: bundle.workspace.commit,
  manifest_sha256: sha(manifestBytes), workspace_tree: bundle.workspace.tree,
  platform: `${process.platform}-${process.arch}`, node_version: bundle.runtime.node_version,
  provider: { id: 'camoufox', browser_version: '152.0.4-beta.30', package_version: '0.5.6', playwright_version: '1.60.0' },
  package_ref: site.package_ref, revision_ref: site.revision_ref, package_digest: site.integrity.package_digest,
  installation_client: 'installed webenvoy CLI', real_provider: true, third_party_model_agent: false,
  plugin_verified: false, real_third_party_site: false, account: false, release: false,
  normal_path_model_calls: 0, trust_mode: 'trusted_local', steps: {}, state: 'running',
};
const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
let runtimeStarted = false, sessionRef, grantId, profileRef;
let reads = 0;
const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/catalog') { response.writeHead(404); response.end(); return; }
  reads++;
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" });
  response.end('<!doctype html><title>Controlled Local Catalog</title><main><h1>Controlled Local Catalog</h1><p>Deterministic local catalog summary for WebEnvoy acceptance.</p></main>');
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolveListen); });

async function command(args, acceptFailure = false) {
  let output, failed = false;
  try { output = await run(cli, args, { cwd: packageRoot, timeout: 120_000, maxBuffer: 1024 * 1024 }); }
  catch (error) { output = error; failed = true; }
  for (const line of `${output.stdout ?? ''}\n${output.stderr ?? ''}`.trim().split('\n').reverse()) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    if (failed && !acceptFailure) throw new Error(`cli_failed:${args.slice(0, 3).join(' ')}:${value.failure?.code ?? value.error?.code ?? output.code}`);
    return value;
  }
  throw new Error('cli_json_missing');
}
async function requestFile(name, value) {
  const path = join(requests, `${name}.json`);
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
async function agent(name, action, value, acceptFailure = false) {
  return command(['agent', ...action.split(' '), '--client-file', clientFile, '--request-file', await requestFile(name, value)], acceptFailure);
}
function find(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value[key] === 'string') return value[key];
  return Object.values(value).map(child => find(child, key)).find(item => item !== undefined);
}
function requireSuccess(value, label) { assert.equal(value.ok, true, `${label}:${value.failure?.code ?? value.error?.code}`); }
function requireDenied(value, label) {
  const code = value.failure?.code ?? value.error?.code ?? value.result?.failure?.code;
  const failedRun = value.run?.status === 'failed' && value.failure && value.result?.outcome === 'failed';
  assert.ok(code && (value.ok === false || value.result?.ok === false || failedRun), `${label}_unexpected_success`);
  if (value.run) assert.equal(value.run.dispatch_state, 'not_dispatched', `${label}_dispatched`);
  return code;
}
function browserRequest(operation, fields = {}, grant = grantId) {
  return { idempotency_key: `${root.split('/').pop()}-${operation}-${Date.now()}`, grant_id: grant, operation,
    task_scope: { operations: [operation], profile_refs: profileRef ? [profileRef] : [], origins: [origin] }, ...fields };
}
function skillRequest(operation, fields = {}) {
  return { idempotency_key: `${root.split('/').pop()}-${operation}-${Date.now()}`, grant_id: grantId, operation,
    task_scope: { operations: [operation], skill_refs: [site.package_ref], source_refs: [site.revision_ref] }, skill_ref: site.package_ref, ...fields };
}
function taskRequest(operation, fields = {}) {
  return { schema_version: 'webenvoy.managed-task-operation/v1', grant_id: grantId, operation,
    task_scope: { operations: [operation], skill_refs: [site.package_ref], source_refs: [site.revision_ref], profile_refs: [profileRef], origins: [origin] }, ...fields };
}
async function ownerGrant(name, value) {
  const valueWithKey = { idempotency_key: `${root.split('/').pop()}-${name}`, ...value };
  return command(['access', 'grant', '--data-dir', ownerData, '--grant-file', await requestFile(name, valueWithKey)]);
}
try {
  const version = await command(['--version']);
  assert.equal(version.integrity, 'verified');
  const setup = await command(['setup', '--data-dir', ownerData,
    '--browser-install-root', join(materialRoot, 'browser/Camoufox.app'),
    '--browser-executable', join(materialRoot, 'browser/Camoufox.app/Contents/MacOS/camoufox'),
    '--python-path', join(materialRoot, 'venv/bin/python'), '--browser-version', '152.0.4-beta.30',
    '--camoufox-version', '0.5.6', '--playwright-version', '1.60.0',
    '--browser-source-path', join(materialRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
    '--camoufox-source-path', join(materialRoot, 'camoufox-0.5.6-py3-none-any.whl'),
    '--playwright-source-path', join(materialRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')]);
  assert.equal(setup.boundary.mode, 'trusted_local');
  await command(['start', '--data-dir', ownerData]); runtimeStarted = true;
  requireSuccess(await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: `${root.split('/').pop()}-policy`, expected_source_version: null,
    modes: { read: 'auto', prepare: 'auto', commit: 'auto' },
  } }), 'management_policy');
  const hostSetup = await command(['agent', 'setup', '--host-dir', host, '--data-dir', ownerData, '--owner-uid', String(process.getuid())]);
  const principal = find(await command(['access', 'register', '--data-dir', ownerData, '--display-name', 'Controlled site task acceptance',
    '--credential-hash', hostSetup.credential_fingerprint, '--idempotency-key', `${root.split('/').pop()}-register`]), 'principal_id');
  assert.ok(principal);
  const operations = ['instance.start', 'instance.observe', 'instance.snapshot', 'instance.read', 'instance.stop',
    'task.submit', 'task.query', 'task.stop', 'skill.list', 'skill.inspect', 'skill.install', 'skill.enable', 'skill.read', 'skill.disable'];
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  const creation = find(await ownerGrant('creation', { principal_id: principal, profile_refs: [], allowed_operations: ['profile.create'], allowed_origins: [origin],
    expires_at: expires, max_created_profiles: 1, creation_template: { template_ref: 'controlled-site-task-template', provider_id: 'camoufox',
      site: { site_id: 'controlled-local', origin, display_name: 'Controlled local page' }, language: 'en-US', timezone: 'UTC',
      permission_ceiling: { allowed_operations: operations, allowed_origins: [origin], controlled_interaction_origins: [origin] } } }), 'grant_id');
  const created = await agent('create-profile', 'operation', browserRequest('profile.create', { template_ref: 'controlled-site-task-template' }, creation));
  requireSuccess(created, 'profile_create'); profileRef = find(created, 'profile_ref'); assert.ok(profileRef);
  grantId = find(await ownerGrant('execution', { principal_id: principal, profile_refs: [profileRef], allowed_operations: operations, allowed_origins: [origin],
    expires_at: expires, creation_template: null, max_created_profiles: 0, skill_scope: { skill_refs: [site.package_ref], source_refs: [site.revision_ref] } }), 'grant_id');
  const started = await agent('start-instance', 'operation', browserRequest('instance.start', { profile_ref: profileRef, origin, url: `${origin}/catalog` }));
  requireSuccess(started, 'instance_start'); sessionRef = find(started, 'runtime_session_ref'); assert.ok(sessionRef);
  const observed = await agent('observe', 'operation', browserRequest('instance.observe', { profile_ref: profileRef, origin, runtime_session_ref: sessionRef }));
  requireSuccess(observed, 'observe'); const pageRef = find(observed, 'page_ref'); assert.ok(pageRef);
  const inspected = await agent('inspect', 'skills', skillRequest('skill.inspect'));
  requireSuccess(inspected, 'skill_inspect');
  const summary = inspected.result.skill.site_tasks;
  assert.equal(summary.revision_ref, site.revision_ref); assert.equal(summary.package_digest, site.integrity.package_digest);
  const declared = summary.tasks.find(item => item.task_ref === task.task_ref); assert.ok(declared);
  const submitFields = { package: { package_ref: site.package_ref, revision_ref: site.revision_ref, package_digest: site.integrity.package_digest, task_ref: task.task_ref },
    target: { target_type: task.applicability.target_type, target_ref: pageRef }, input: { schema_ref: declared.input_schema_ref, carrier: 'none' },
    intent: { summary: 'Read the controlled local page summary', policy: { risk: 'read', execution_intent: 'read', timeout_ms: 30000 } } };
  evidence.steps.not_installed = requireDenied(await agent('not-installed', 'task submit', taskRequest('task.submit', { idempotency_key: 'not-installed', ...submitFields }), true), 'not_installed');
  requireSuccess(await agent('install', 'skills', skillRequest('skill.install', { revision_ref: site.revision_ref })), 'skill_install');
  evidence.steps.disabled = requireDenied(await agent('disabled', 'task submit', taskRequest('task.submit', { idempotency_key: 'disabled', ...submitFields }), true), 'disabled');
  const installed = await agent('inspect-installed', 'skills', skillRequest('skill.inspect'));
  requireSuccess(await agent('enable', 'skills', skillRequest('skill.enable', { target_revision_ref: site.revision_ref,
    expected_revision_ref: null, expected_record_version: installed.result.skill.record_version })), 'skill_enable');
  const wrongPin = { ...submitFields, package: { ...submitFields.package, package_digest: `sha256:${'0'.repeat(64)}` } };
  evidence.steps.pin_mismatch = requireDenied(await agent('wrong-pin', 'task submit', taskRequest('task.submit', { idempotency_key: 'wrong-pin', ...wrongPin }), true), 'pin_mismatch');
  evidence.steps.extra_input = requireDenied(await agent('extra-input', 'task submit', taskRequest('task.submit', {
    idempotency_key: 'extra-input', ...submitFields, input: { ...submitFields.input, value: { unexpected: true } },
  }), true), 'extra_input');
  evidence.steps.stale_target = requireDenied(await agent('stale-target', 'task submit', taskRequest('task.submit', {
    idempotency_key: 'stale-target', ...submitFields, target: { ...submitFields.target, target_ref: 'page_missing' },
  }), true), 'stale_target');
  const completed = await agent('execute', 'task submit', taskRequest('task.submit', { idempotency_key: 'execute', ...submitFields }));
  requireSuccess(completed, 'task_submit'); assert.equal(completed.run.status, 'succeeded');
  assert.equal(completed.result.schema_version, 'webenvoy.result-envelope.v0'); assert.equal(completed.result.outcome, 'success');
  const originalRun = completed.run.run_id;
  const query = await agent('query', 'task query', taskRequest('task.query', { selector: { original_idempotency_key: 'execute' } }));
  assert.equal(query.run.run_id, originalRun); assert.deepEqual(query.result, completed.result);
  evidence.steps.success = { run_id: originalRun, result_sha256: sha(JSON.stringify(completed.result)) };
  // Suppress the submit response entirely at the process boundary, then use only its saved key.
  const lostFile = await requestFile('lost-response', taskRequest('task.submit', { idempotency_key: 'lost-response', ...submitFields }));
  await new Promise((resolveExit, reject) => {
    const child = spawn(cli, ['agent', 'task', 'submit', '--client-file', clientFile, '--request-file', lostFile], { cwd: packageRoot, stdio: 'ignore' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`lost_response_submit_exit_${code}`)));
  });
  const recovered = await agent('lost-query', 'task query', taskRequest('task.query', { selector: { original_idempotency_key: 'lost-response' } }));
  requireSuccess(recovered, 'lost_query'); assert.equal(recovered.run.status, 'succeeded');
  evidence.steps.withheld_response_query = { run_id: recovered.run.run_id, simulation: 'CLI stdout discarded; original key queried without resubmit', unknown_write: false };
  await command(['instance', 'takeover', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]);
  const duringTakeover = await agent('takeover-submit', 'task submit', taskRequest('task.submit', { idempotency_key: 'takeover-submit', ...submitFields }), true);
  const ownerState = await command(['instance', 'inspect', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]);
  assert.equal(find(ownerState, 'control_owner'), 'user', 'read_task_must_not_take_control');
  evidence.steps.owner_takeover = { control_owner: 'user', read_status: duringTakeover.run?.status ?? duringTakeover.failure?.code ?? duringTakeover.error?.code };
  await command(['instance', 'handback', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]);
  await command(['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]); sessionRef = undefined;
  await command(['stop', '--data-dir', ownerData]); runtimeStarted = false;
  await command(['start', '--data-dir', ownerData]); runtimeStarted = true;
  const afterRestart = await agent('restart-query', 'task query', taskRequest('task.query', { selector: { run_id: originalRun } }));
  assert.equal(afterRestart.run.run_id, originalRun); assert.deepEqual(afterRestart.result, completed.result);
  evidence.steps.restart_query = 'same Run and result';
  const stopped = await agent('stop-completed', 'task stop', taskRequest('task.stop', { selector: { run_id: originalRun }, idempotency_key: 'stop-completed' }));
  requireSuccess(stopped, 'stop_completed'); assert.equal(stopped.run.run_id, originalRun);
  evidence.steps.stop_terminal_run = { run_id: originalRun, status: stopped.run.status };

  await command(['access', 'revoke', '--data-dir', ownerData, '--kind', 'grants', '--id', grantId, '--idempotency-key', 'revoke-task-grant']);
  evidence.steps.revoked_query = requireDenied(await agent('revoked-query', 'task query', taskRequest('task.query', { selector: { run_id: originalRun } }), true), 'revoked_query');
  evidence.page_get_count = reads; evidence.state = 'passed';
} catch (error) {
  evidence.state = 'failed'; evidence.error = error.message; throw error;
} finally {
  const cleanup = [];
  if (sessionRef) try { await command(['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]); } catch { cleanup.push('instance_stop_failed'); }
  if (runtimeStarted) try { await command(['stop', '--data-dir', ownerData]); } catch { cleanup.push('runtime_stop_failed'); }
  await new Promise(resolveClose => server.close(resolveClose));
  evidence.cleanup_failures = cleanup;
  if (cleanup.length) { evidence.state = 'failed'; evidence.error = 'cleanup_failed'; }
  await writeFile(join(root, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ evidence: join(root, 'evidence.json'), state: evidence.state, cleanup_failures: cleanup }));
}
if (evidence.state !== 'passed') throw new Error(evidence.error ?? 'site_task_check_failed');
