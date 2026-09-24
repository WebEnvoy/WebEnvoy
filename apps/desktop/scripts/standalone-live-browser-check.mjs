import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Acceptance-only path. It must run on the real macOS arm64 runner with a
// distinct nobody UID; it never creates users, accounts, or login credentials.
// The workflow supplies pinned official browser materials and locked Lode source.
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('live_browser_check_requires_macos_arm64');
const packageRoot = resolve(process.argv[2] ?? process.env.PACKAGE_ROOT ?? '.');
const materialsRoot = resolve(process.argv[3] ?? process.env.CAMOUFOX_MATERIAL_ROOT ?? (() => { throw new Error('camoufox_material_root_required'); })());
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');
const agentUid = Number(execFileSync('/usr/bin/id', ['-u', 'nobody'], { encoding: 'utf8' }).trim());
if (!Number.isSafeInteger(agentUid) || agentUid < 1 || agentUid === ownerUid) throw new Error('agent_uid_unavailable');
const switchedUid = Number(execFileSync('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', '/usr/bin/id', '-u'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim());
if (switchedUid !== agentUid) throw new Error('agent_uid_switch_unavailable');

const { CAMOUFOX_UPSTREAM_PINS, verifyCamoufoxUpstreamInstall } = await import(pathToFileURL(join(packageRoot, 'agent-entry/provider-artifact.mjs')).href);
const browserRoot = join(materialsRoot, 'browser', 'Camoufox.app');
const browserExecutable = join(browserRoot, 'Contents/MacOS/camoufox');
const pythonPath = join(materialsRoot, 'venv/bin/python');
const browserSourcePath = join(materialsRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip');
const camoufoxSourcePath = join(materialsRoot, 'camoufox-0.5.6-py3-none-any.whl');
const playwrightSourcePath = join(materialsRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl');
const binding = await verifyCamoufoxUpstreamInstall({
  provider: 'camoufox', browser_install_root: browserRoot, browser_executable: browserExecutable, python_path: pythonPath,
  browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version, browser_source_path: browserSourcePath,
  camoufox_source_path: camoufoxSourcePath, playwright_source_path: playwrightSourcePath
});

const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
const root = await mkdtemp('/tmp/webenvoy-live-browser-');
const ownerData = join(root, 'owner-data');
let originProcess;
let origin;
let agentHost;
let runtimeStarted = false;
let sessionRef;

async function startLocalOrigin() {
  const source = String.raw`
import { createServer } from "node:http";
const server = createServer((request, response) => {
  if (request.method !== "GET" || !["/", "/index.html"].includes(new URL(request.url ?? "/", "http://127.0.0.1").pathname)) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end('<!doctype html><title>WebEnvoy local acceptance</title><main><h1>No account local page</h1><label for=message>Message</label><input id=message name=message aria-label=Message><p id=state>Awaiting input</p><script>const field=document.getElementById("message");const state=document.getElementById("state");field.addEventListener("input",()=>state.textContent="Received: "+field.value)</script></main>');
});
server.listen(0, "127.0.0.1", () => { const address = server.address(); process.stdout.write(JSON.stringify({ port: address.port }) + String.fromCharCode(10)); });
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop); process.once("SIGINT", stop);
`;
  originProcess = spawn(fixedNode, ['--input-type=module', '-e', source], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  return new Promise((resolveOrigin, rejectOrigin) => {
    let pending = '';
    let stderr = '';
    let settled = false;
    const fail = error => { if (!settled) { settled = true; rejectOrigin(error); } };
    originProcess.once('error', fail);
    originProcess.once('exit', (code, signal) => fail(new Error(`local_origin_process_exit:${code ?? 'null'}:${signal ?? 'null'}:${stderr}`)));
    originProcess.stderr.on('data', chunk => { stderr += String(chunk); });
    originProcess.stdout.on('data', chunk => {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        try {
          const value = JSON.parse(line);
          if (Number.isSafeInteger(value.port) && value.port > 0) { settled = true; resolveOrigin(`http://127.0.0.1:${value.port}`); return; }
        } catch {}
      }
    });
  });
}

function command(commandName, args, asAgent = false, input) {
  const executable = asAgent ? '/usr/bin/sudo' : commandName;
  const commandArgs = asAgent ? ['-n', '-u', 'nobody', '--', commandName, ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: packageRoot, encoding: 'utf8', input, timeout: 120_000, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw result.error;
  return result;
}
function run(commandName, args, asAgent = false) {
  const result = command(commandName, args, asAgent);
  if (result.status !== 0 || result.signal) throw new Error(`live_browser_command_failed:${commandName}:${args.join(' ')}:${result.stderr || result.stdout}`);
  return result;
}
function jsonFrom(result, label) {
  for (const line of `${result.stdout}\n${result.stderr}`.trim().split('\n').reverse()) try { return JSON.parse(line); } catch {}
  throw new Error(`${label}_json_missing`);
}
function runJson(commandName, args, asAgent, label) { return jsonFrom(run(commandName, args, asAgent), label); }
function allowJson(commandName, args, asAgent, label) { return jsonFrom(command(commandName, args, asAgent), label); }
function findString(value, keys) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) if (typeof value[key] === 'string') return value[key];
  for (const child of Object.values(value)) { const found = findString(child, keys); if (found) return found; }
  return undefined;
}
function succeeded(value, label) { assert.equal(value?.ok, true, `${label}: ${JSON.stringify(value)}`); assert.equal(value?.status, 'succeeded', `${label}: ${JSON.stringify(value)}`); }
function viewerUnavailable(value) {
  return value?.status === 'unavailable' && [value.failure_class, value.error?.code, value.failure?.code].includes('viewer_unavailable');
}
function scope(operation, profileRef = undefined) { return { operations: [operation], profile_refs: profileRef ? [profileRef] : [], origins: [origin] }; }
async function agentTemp(prefix) {
  const result = command(fixedNode, ['--input-type=module', '-e', 'import { mkdtemp } from "node:fs/promises"; process.stdout.write(await mkdtemp(process.argv[1]));', prefix], true);
  if (result.status !== 0 || result.signal) throw new Error(`agent_temp_failed:${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
async function agentWrite(path, value) {
  run(fixedNode, ['--input-type=module', '-e', 'import { writeFile } from "node:fs/promises"; await writeFile(process.argv[1], process.argv[2], { mode: 0o600 });', path, JSON.stringify(value)], true);
}
function request(operation, idempotencyKey, grantId, taskScope, fields = {}) { return { idempotency_key: idempotencyKey, grant_id: grantId, operation, task_scope: taskScope, ...fields }; }
function ref(value, key, label) { const found = findString(value, [key]); assert.ok(found, `${label} missing ${key}: ${JSON.stringify(value)}`); return found; }
async function runMcpTool(clientPath, name, args) {
  const startedAt = Date.now();
  const child = spawn('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', fixedNode, join(packageRoot, 'agent-entry/mcp.mjs'), clientPath],
    { cwd: packageRoot, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const waiters = new Map();
  lines.on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const waiter = waiters.get(response.id);
    if (waiter) { waiters.delete(response.id); waiter.resolve(response); }
  });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once('error', rejectClose);
    child.once('close', (status, signal) => status === 0 && !signal ? resolveClose() : rejectClose(new Error(`mcp_process_failed:${status ?? signal}:${stderr}`)));
  });
  void closed.catch(() => {});
  const call = (id, method, params) => new Promise((resolveResponse, rejectResponse) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectResponse(new Error(`mcp_response_timeout:${id}`)); }, 120_000);
    waiters.set(id, { resolve: value => { clearTimeout(timer); resolveResponse(value); }, reject: error => { clearTimeout(timer); rejectResponse(error); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  child.once('error', error => {
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
  });
  child.once('close', (status, signal) => {
    if (status === 0 && !signal) return;
    const error = new Error(`mcp_process_failed:${status ?? signal}:${stderr}`);
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
  });
  try {
    const initialized = await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'standalone-site-live-acceptance', version: '1' } });
    if (initialized.error) throw new Error('mcp_initialize_refused');
    const connected = await call(2, 'tools/call', { name: 'webenvoy_connect', arguments: {} });
    if (connected.error || connected.result?.isError) throw new Error('mcp_connect_refused');
    const connectionText = connected.result?.content?.find(item => item?.type === 'text')?.text;
    if (typeof connectionText !== 'string' || JSON.parse(connectionText).ok !== true) throw new Error('mcp_connect_refused');
    const response = await call(3, 'tools/call', { name, arguments: args });
    const text = response?.result?.content?.find(item => item?.type === 'text')?.text;
    if (!response || response.error || response.result?.isError || typeof text !== 'string') throw new Error(`mcp_tool_refused:${name}`);
    child.stdin.end();
    await closed;
    return { value: JSON.parse(text), startedAt, completedAt: Date.now() };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}
async function runMcpQuery(clientPath, idempotencyKey) {
  return (await runMcpTool(clientPath, 'webenvoy_query', { idempotency_key: idempotencyKey })).value;
}
function siteTaskScope(operation, packageRef, revisionRef, profileRef, siteOrigin) {
  return { operations: [operation], skill_refs: [packageRef], source_refs: [revisionRef], profile_refs: [profileRef], origins: [siteOrigin] };
}
async function readAnonymousTrendingPage(url) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(30_000),
    headers: { accept: 'text/html', 'user-agent': 'WebEnvoy-live-acceptance/1.0' }
  });
  const html = await response.text();
  const completedAt = Date.now();
  assert.equal(response.status, 200, `independent_public_page_status:${response.status}`);
  const finalUrl = new URL(response.url);
  assert.equal(finalUrl.origin, 'https://github.com', response.url);
  assert.equal(finalUrl.pathname, '/trending', response.url);
  assert.equal(finalUrl.search, '?since=daily', response.url);
  return { html, startedAt, completedAt, status: response.status, url: response.url };
}
async function runGithubTrendingAcceptance({ ownerData, agentHost, clientFile, principalId }) {
  const siteOrigin = 'https://github.com';
  const pageUrl = `${siteOrigin}/trending?since=daily`;
  if (!process.env.LODE_ROOT) throw new Error('lode_root_required');
  const lodeRoot = resolve(process.env.LODE_ROOT);
  const sourceLock = JSON.parse(await readFile(resolve('apps/desktop/scripts/runtime-source-lock.json'), 'utf8'));
  const lodeCommit = execFileSync('/usr/bin/git', ['-C', lodeRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(lodeCommit, sourceLock.lode.commit, 'locked_lode_checkout_mismatch');
  assert.equal(execFileSync('/usr/bin/git', ['-C', lodeRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'locked_lode_checkout_dirty');

  const lodeAssetsRoot = join(packageRoot, 'dist-electron/lode');
  const packageDir = join(lodeAssetsRoot, 'sites/github/trending');
  const site = JSON.parse(await readFile(join(packageDir, 'manifest.json'), 'utf8'));
  const taskLocator = site.tasks?.find(item => item.task_ref === 'read-daily-trending-top5');
  assert.ok(taskLocator, 'trending_task_missing');
  const task = JSON.parse(await readFile(join(packageDir, taskLocator.path), 'utf8'));
  const script = site.scripts?.find(item => item.script_ref === task.entrypoint?.script_ref);
  assert.equal(site.package_ref, 'lode://site-skill/github/trending');
  assert.equal(site.source?.repository, 'WebEnvoy/Lode');
  assert.equal(task.task_ref, 'read-daily-trending-top5');
  assert.deepEqual(task.applicability?.origins, [siteOrigin]);
  assert.equal(task.applicability?.target_type, 'web_page');
  assert.equal(task.action, 'read');
  assert.equal(task.inputs?.carrier, 'none');
  assert.deepEqual(task.data_handling, { input_sensitivity: 'public', output_sensitivity: 'public', external_egress: 'none' });
  assert.ok(script && script.runtime_kind === 'webenvoy.site-skill-script-abi/v1' && script.broker === 'webenvoy.site-skill-broker/v1');

  const core = await import(pathToFileURL(join(packageRoot, 'dist-electron/runtime/core/node_modules/@webenvoy/core-runtime/dist/index.js')).href);
  const fixedPin = core.approvedManagedSiteTaskPackageFor(site.package_ref);
  assert.ok(fixedPin, 'github_trending_not_in_core_fixed_pin');
  assert.equal(site.revision_ref, fixedPin.revision_ref);
  assert.equal(site.integrity.package_digest, fixedPin.package_digest);
  assert.equal(site.source.source_ref, fixedPin.source_ref);
  assert.equal(site.source.commit, fixedPin.source_commit);
  assert.equal(script.sha256, fixedPin.script.sha256);
  const verified = await core.verifySiteSkillPackageRoot(lodeAssetsRoot, fixedPin);
  assert.equal(verified.script?.sha256, script.sha256);
  const sourceScriptBytes = await readFile(join(lodeRoot, verified.package_path, verified.script.path));
  assert.equal(sha(sourceScriptBytes), script.sha256.slice('sha256:'.length), 'locked_lode_script_bytes_mismatch');
  assert.deepEqual(sourceScriptBytes, verified.script.source, 'packaged_script_differs_from_locked_lode_checkout');
  const admissionFields = {
    package_ref: fixedPin.package_ref, revision_ref: fixedPin.revision_ref, package_digest: fixedPin.package_digest,
    source_ref: fixedPin.source_ref, source_commit: fixedPin.source_commit
  };
  const sourceAdmissionRef = `webenvoy.source-admission/site-skill/v1#sha256:${sha(JSON.stringify(Object.fromEntries(Object.entries(admissionFields).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))))}`;
  const codeAdmissionRef = core.managedSiteScriptCodeAdmissionRef(fixedPin);

  const prefix = `github-trending-live-${Date.now()}`;
  const operations = ['instance.start', 'instance.observe', 'instance.snapshot', 'instance.stop', 'task.submit', 'task.query', 'task.stop',
    'skill.inspect', 'skill.install', 'skill.enable', 'skill.read'];
  const expiresAt = new Date(Date.now() + 1_800_000).toISOString();
  async function createGrant(name, body) {
    const grantPath = join(ownerData, `${name}.json`);
    await writeFile(grantPath, JSON.stringify({ idempotency_key: `${prefix}-${name}`, ...body }), { mode: 0o600 });
    return ref(runJson(cli, ['access', 'grant', '--data-dir', ownerData, '--grant-file', grantPath], false, name), 'grant_id', name);
  }
  const creationGrantId = await createGrant('github-create', {
    principal_id: principalId, profile_refs: [], allowed_operations: ['profile.create'], allowed_origins: [siteOrigin],
    expires_at: expiresAt, max_created_profiles: 1,
    creation_template: { template_ref: `${prefix}-template`, provider_id: 'camoufox',
      site: { site_id: 'github-trending', origin: siteOrigin, display_name: 'GitHub Trending public read' }, language: 'en-US', timezone: 'UTC',
      permission_ceiling: { allowed_operations: operations, allowed_origins: [siteOrigin], controlled_interaction_origins: [siteOrigin] } }
  });
  const profileCreateFile = join(agentHost, `${prefix}-profile-create.json`);
  await agentWrite(profileCreateFile, request('profile.create', `${prefix}-profile-create`, creationGrantId,
    { operations: ['profile.create'], profile_refs: [], origins: [siteOrigin] }, { template_ref: `${prefix}-template` }));
  const created = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', profileCreateFile], true, 'github_profile_create');
  succeeded(created, 'github_profile_create');
  const profileRef = ref(created.result, 'profile_ref', 'github_profile_create');
  const grantId = await createGrant('github-read-only', {
    principal_id: principalId, profile_refs: [profileRef], allowed_operations: operations, allowed_origins: [siteOrigin],
    expires_at: expiresAt, creation_template: null, max_created_profiles: 0,
    skill_scope: { skill_refs: [site.package_ref], source_refs: [site.revision_ref] }
  });
  const skillRequest = (operation, fields = {}, requestLabel = operation) => ({ idempotency_key: `${prefix}-${requestLabel}`, grant_id: grantId, operation,
    task_scope: { operations: [operation], skill_refs: [site.package_ref], source_refs: [site.revision_ref] }, skill_ref: site.package_ref, ...fields });
  const inspectFile = join(agentHost, `${prefix}-skill-inspect.json`);
  await agentWrite(inspectFile, skillRequest('skill.inspect'));
  const inspected = runJson(cli, ['agent', 'skills', '--client-file', clientFile, '--request-file', inspectFile], true, 'github_skill_inspect');
  assert.equal(inspected.ok, true, `github_skill_inspect:${inspected.failure?.code ?? inspected.error?.code}`);
  const summary = inspected.result.skill.site_tasks;
  const declared = summary?.tasks?.find(item => item.task_ref === task.task_ref);
  assert.equal(summary?.revision_ref, site.revision_ref);
  assert.equal(summary?.package_digest, site.integrity.package_digest);
  assert.equal(declared?.entrypoint?.script_ref, script.script_ref);
  assert.equal(declared?.entrypoint?.script_sha256, script.sha256);
  assert.equal(declared?.runtime_state, 'not_evaluated');

  const installFile = join(agentHost, `${prefix}-skill-install.json`);
  await agentWrite(installFile, skillRequest('skill.install', { revision_ref: site.revision_ref }));
  const installedResult = runJson(cli, ['agent', 'skills', '--client-file', clientFile, '--request-file', installFile], true, 'github_skill_install');
  assert.equal(installedResult.ok, true, `github_skill_install:${installedResult.failure?.code ?? installedResult.error?.code}`);
  const installedFile = join(agentHost, `${prefix}-skill-inspect-installed.json`);
  await agentWrite(installedFile, skillRequest('skill.inspect', {}, 'skill-inspect-installed'));
  const installed = runJson(cli, ['agent', 'skills', '--client-file', clientFile, '--request-file', installedFile], true, 'github_skill_inspect_installed');
  assert.equal(installed.ok, true, `github_skill_inspect_installed:${installed.failure?.code ?? installed.error?.code}`);
  assert.equal(installed.result.skill.record_version, installedResult.result.skill.record_version);
  assert.equal(installed.result.skill.enabled, false);
  assert.equal(installed.result.skill.enabled_revision_ref, null);
  const enableFile = join(agentHost, `${prefix}-skill-enable.json`);
  await agentWrite(enableFile, skillRequest('skill.enable', { target_revision_ref: site.revision_ref,
    expected_revision_ref: null, expected_record_version: installed.result.skill.record_version }));
  const enabled = runJson(cli, ['agent', 'skills', '--client-file', clientFile, '--request-file', enableFile], true, 'github_skill_enable');
  assert.equal(enabled.ok, true, `github_skill_enable:${enabled.failure?.code ?? enabled.error?.code}`);
  const skillReadFile = join(agentHost, `${prefix}-skill-read.json`);
  await agentWrite(skillReadFile, skillRequest('skill.read'));
  const read = runJson(cli, ['agent', 'skills', '--client-file', clientFile, '--request-file', skillReadFile], true, 'github_skill_read');
  assert.equal(read.ok, true, `github_skill_read:${read.failure?.code ?? read.error?.code}`);
  assert.equal(read.result.revision.revision_ref, site.revision_ref);
  assert.equal(read.result.receipt.content_sha256, site.integrity.files.find(item => item.path === 'SKILL.md')?.sha256?.slice('sha256:'.length));

  const startFile = join(agentHost, `${prefix}-instance-start.json`);
  await agentWrite(startFile, request('instance.start', `${prefix}-instance-start`, grantId,
    { operations: ['instance.start'], profile_refs: [profileRef], origins: [siteOrigin] }, { profile_ref: profileRef, origin: siteOrigin, url: pageUrl }));
  const started = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', startFile], true, 'github_instance_start');
  succeeded(started, 'github_instance_start');
  sessionRef = ref(started.result, 'runtime_session_ref', 'github_instance_start');
  const observeFile = join(agentHost, `${prefix}-instance-observe.json`);
  await agentWrite(observeFile, request('instance.observe', `${prefix}-instance-observe`, grantId,
    { operations: ['instance.observe'], profile_refs: [profileRef], origins: [siteOrigin] }, { profile_ref: profileRef, origin: siteOrigin, runtime_session_ref: sessionRef }));
  const observed = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', observeFile], true, 'github_instance_observe');
  succeeded(observed, 'github_instance_observe');
  const page = observed.result.observation.page;
  assert.equal(page.current_url, pageUrl, JSON.stringify({ current_url: page.current_url }));
  const targetRef = ref(page, 'page_ref', 'github_page');
  const submitKey = `${prefix}-task-submit`;
  const submitRequest = {
    schema_version: 'webenvoy.managed-task-operation/v1', operation: 'task.submit', idempotency_key: submitKey, grant_id: grantId,
    task_scope: siteTaskScope('task.submit', site.package_ref, site.revision_ref, profileRef, siteOrigin),
    package: { package_ref: site.package_ref, revision_ref: site.revision_ref, package_digest: site.integrity.package_digest, task_ref: task.task_ref },
    target: { target_type: task.applicability.target_type, target_ref: targetRef },
    input: { schema_ref: task.inputs.schema_ref, carrier: 'none' },
    intent: { summary: 'Read the first five public daily GitHub Trending repositories', policy: { risk: 'read', execution_intent: 'read', timeout_ms: 30_000 } }
  };
  async function requireRefusal(label, fields, expectedCode) {
    const requestFile = join(agentHost, `${prefix}-${label}.json`);
    await agentWrite(requestFile, { ...submitRequest, idempotency_key: `${prefix}-${label}`, ...fields });
    const refusal = allowJson(cli, ['agent', 'task', 'submit', '--client-file', clientFile, '--request-file', requestFile], true, `github_refusal_${label}`);
    const code = refusal.failure?.code ?? refusal.error?.code ?? refusal.result?.failure?.code;
    assert.ok(code && (refusal.ok === false || refusal.error || refusal.result?.ok === false || refusal.run?.status === 'failed'),
      `${label}_unexpected_success:${JSON.stringify(refusal)}`);
    assert.equal(code, expectedCode, `${label}_wrong_refusal:${JSON.stringify(refusal)}`);
    if (refusal.run) assert.equal(refusal.run.dispatch_state, 'not_dispatched', `${label}_dispatched:${JSON.stringify(refusal)}`);
    return { state: 'refused', code, run_id: refusal.run?.run_id ?? null,
      dispatch_state: refusal.run?.dispatch_state ?? refusal.dispatch_state ?? null };
  }
  const refusals = {
    out_of_scope_origin: await requireRefusal('out-of-scope-origin', {
      task_scope: { ...submitRequest.task_scope, origins: ['https://example.com'] }
    }, 'managed_access_denied'),
    package_digest_mismatch: await requireRefusal('package-digest-mismatch', {
      package: { ...submitRequest.package, package_digest: `sha256:${'0'.repeat(64)}` }
    }, 'managed_access_denied'),
    undeclared_input: await requireRefusal('undeclared-input', {
      input: { ...submitRequest.input, value: { unexpected: true } }
    }, 'managed_task_invalid_input')
  };
  const directPagePromise = readAnonymousTrendingPage(pageUrl);
  const taskPromise = runMcpTool(clientFile, 'webenvoy_task', submitRequest);
  const [mcpSubmission, independentPage] = await Promise.all([taskPromise, directPagePromise]);
  const submitted = mcpSubmission.value;
  assert.equal(submitted?.ok, true, `github_managed_script_submit:${submitted?.failure?.code ?? submitted?.error?.code ?? 'refused'}`);
  assert.equal(submitted.run.status, 'succeeded', JSON.stringify({ run: submitted.run, failure: submitted.failure }));
  assert.equal(submitted.run.dispatch_state, 'dispatched');
  assert.equal(submitted.result.schema_version, 'webenvoy.result-envelope.v0');
  assert.equal(submitted.result.outcome, 'success');
  assert.equal(submitted.result.result_kind, 'github_trending_daily_top5');
  assert.equal(submitted.result.data.status, 'available');
  assert.equal(submitted.result.data.normalized.completeness, 'complete');
  const rows = submitted.result.data.normalized.rows;
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(item => item.name)).size, 5);
  assert.ok(rows.every(item => item.url === `${siteOrigin}/${item.name}` && item.today_stars_state === 'observed' && item.language_state !== 'unknown'));
  const verifiedNames = rows.filter(item => independentPage.html.includes(item.name));
  assert.equal(verifiedNames.length, 5, 'independent_public_page_did_not_contain_all_returned_repository_names');
  const startSkewMs = Math.abs(independentPage.startedAt - mcpSubmission.startedAt);
  assert.ok(startSkewMs <= 2_000, `independent_page_check_not_near_simultaneous:${startSkewMs}`);

  const originalRunId = submitted.run.run_id;
  const queryFile = join(agentHost, `${prefix}-task-query.json`);
  await agentWrite(queryFile, {
    schema_version: 'webenvoy.managed-task-operation/v1', operation: 'task.query', grant_id: grantId,
    task_scope: siteTaskScope('task.query', site.package_ref, site.revision_ref, profileRef, siteOrigin),
    selector: { original_idempotency_key: submitKey }
  });
  const queried = runJson(cli, ['agent', 'task', 'query', '--client-file', clientFile, '--request-file', queryFile], true, 'github_original_run_query');
  assert.equal(queried.run.run_id, originalRunId);
  assert.deepEqual(queried.result, submitted.result);

  const stopFile = join(agentHost, `${prefix}-instance-stop.json`);
  await agentWrite(stopFile, request('instance.stop', `${prefix}-instance-stop`, grantId,
    { operations: ['instance.stop'], profile_refs: [profileRef], origins: [siteOrigin] }, { profile_ref: profileRef, runtime_session_ref: sessionRef }));
  succeeded(runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', stopFile], true, 'github_instance_stop'), 'github_instance_stop');
  sessionRef = undefined;
  const evidence = {
    schema: 'webenvoy.live-site-skill-script-acceptance/v1', state: 'passed', page_url: pageUrl, anonymous_independent_check: { state: 'passed', status: independentPage.status,
      requested_at: new Date(independentPage.startedAt).toISOString(), completed_at: new Date(independentPage.completedAt).toISOString(),
      credentials_sent: false, repositories_matched: verifiedNames.length, start_skew_ms: startSkewMs },
    package: { package_ref: site.package_ref, revision_ref: site.revision_ref, package_digest: site.integrity.package_digest,
      source_ref: site.source.source_ref, source_commit: site.source.commit, locked_lode_commit: lodeCommit,
      task_ref: task.task_ref, script_ref: script.script_ref, script_sha256: script.sha256, runtime_kind: script.runtime_kind,
      source_admission_ref: sourceAdmissionRef, code_admission_ref: codeAdmissionRef, admission_kind: 'Core fixed approved source and code admission',
      data_handling: task.data_handling },
    lifecycle: { inspected: true, installed: true, explicitly_enabled: true, read_receipt_ref: read.result.receipt.receipt_ref },
    refusals,
    profile_creation_grant: { grant_id: creationGrantId, allowed_operations: ['profile.create'], allowed_origins: [siteOrigin],
      max_created_profiles: 1, profile_permission_ceiling: { allowed_operations: operations, allowed_origins: [siteOrigin], controlled_interaction_origins: [siteOrigin] } },
    grant: { grant_id: grantId, allowed_operations: operations, allowed_origins: [siteOrigin], profile_refs: [profileRef],
      max_created_profiles: 0 },
    task_policy: { risk: 'read', execution_intent: 'read', timeout_ms: 30_000 },
    consumer: { submit: 'installed WebEnvoy MCP tool webenvoy_task', query: 'installed WebEnvoy CLI agent task query',
      independent_check: 'acceptance harness only; not passed to the site script', real_model: false, third_party_agent: false, plugin_verified: false, account: false },
    run: { run_id: originalRunId, status: queried.run.status, dispatch_state: queried.run.dispatch_state,
      result_schema: queried.result.schema_version, outcome: queried.result.outcome, result_kind: queried.result.result_kind,
      result_sha256: sha(JSON.stringify(queried.result)), queried_same_original_result: true,
      repository_names: rows.map(item => item.name) }
  };
  if (process.env.SITE_TASK_EVIDENCE_PATH) await writeFile(resolve(process.env.SITE_TASK_EVIDENCE_PATH), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return evidence;
}

const providerArgs = [
  '--browser-install-root', browserRoot, '--browser-executable', browserExecutable, '--python-path', pythonPath,
  '--browser-version', CAMOUFOX_UPSTREAM_PINS.browser_version, '--camoufox-version', CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  '--playwright-version', CAMOUFOX_UPSTREAM_PINS.playwright_version, '--browser-source-path', browserSourcePath,
  '--camoufox-source-path', camoufoxSourcePath, '--playwright-source-path', playwrightSourcePath
];
const operationKeys = {
  create: 'live-camoufox-profile-create', start: 'live-camoufox-instance-start', observe: 'live-camoufox-observe',
  snapshot: 'live-camoufox-snapshot', input: 'live-camoufox-input', read: 'live-camoufox-read',
  takeoverInput: 'live-camoufox-input-after-takeover', handbackObserve: 'live-camoufox-observe-after-handback'
};

try {
  origin = await startLocalOrigin();
  const setup = runJson(cli, ['setup', '--data-dir', ownerData, '--agent-uid', String(agentUid), ...providerArgs], false, 'owner_setup');
  assert.equal(setup.installed, true, JSON.stringify(setup));
  assert.equal(setup.boundary?.mode, 'distinct_uid_hardened', JSON.stringify(setup.boundary));
  assert.equal(setup.bootstrap?.owner_uid, ownerUid);
  assert.equal(setup.bootstrap?.agent_uid, agentUid);
  assert.deepEqual(setup.camoufox_launch, { state: 'qualified', reason: 'official_upstream' }, JSON.stringify(setup));
  run(cli, ['start', '--data-dir', ownerData]);
  runtimeStarted = true;
  const status = runJson(cli, ['diagnose', '--data-dir', ownerData], false, 'owner_diagnose');
  assert.equal(status.ready, true, JSON.stringify(status));

  const policy = await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: 'live-camoufox-management-policy', expected_source_version: null,
    modes: { read: 'auto', prepare: 'auto', commit: 'auto' }
  } });
  assert.equal(policy.ok, true, JSON.stringify(policy));

  agentHost = await agentTemp('/tmp/webenvoy-agent-live-');
  run(cli, ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid)], true);
  const clientFile = join(agentHost, 'webenvoy-client.json');
  const agentMeta = jsonFrom(command(fixedNode, ['--input-type=module', '-e', 'import { createHash } from "node:crypto"; import { readFile } from "node:fs/promises"; const v=JSON.parse(await readFile(process.argv[1],"utf8")); process.stdout.write(JSON.stringify({agent_endpoint:v.agent_endpoint,owner_uid:v.owner_uid,agent_uid:v.agent_uid,credential_fingerprint:createHash("sha256").update(v.credential).digest("hex")}));', clientFile], true), 'agent_metadata');
  assert.equal(agentMeta.owner_uid, ownerUid); assert.equal(agentMeta.agent_uid, agentUid);

  const registered = runJson(cli, ['access', 'register', '--data-dir', ownerData, '--display-name', 'live-camoufox-agent', '--credential-hash', agentMeta.credential_fingerprint, '--idempotency-key', 'live-camoufox-register'], false, 'owner_register');
  const principalId = ref(registered, 'principal_id', 'register');
  const grant = {
    idempotency_key: 'live-camoufox-grant', principal_id: principalId, profile_refs: [],
    allowed_operations: ['profile.create', 'profile.list', 'profile.read', 'instance.start', 'instance.observe', 'instance.snapshot', 'instance.input', 'instance.read', 'instance.stop'],
    allowed_origins: [origin], expires_at: new Date(Date.now() + 300_000).toISOString(), max_created_profiles: 1,
    creation_template: { template_ref: 'live-camoufox-template', provider_id: 'camoufox', site: { site_id: 'local-acceptance', origin, display_name: 'Local no-account acceptance' }, language: 'en-US', timezone: 'UTC', permission_ceiling: {
      allowed_operations: ['profile.list', 'profile.read', 'instance.start', 'instance.observe', 'instance.snapshot', 'instance.input', 'instance.read', 'instance.stop'],
      allowed_origins: [origin], controlled_interaction_origins: [origin]
    } }
  };
  await writeFile(join(ownerData, 'grant.json'), JSON.stringify(grant), { mode: 0o600 });
  const granted = runJson(cli, ['access', 'grant', '--data-dir', ownerData, '--grant-file', join(ownerData, 'grant.json')], false, 'owner_grant');
  const grantId = ref(granted, 'grant_id', 'grant');
  assert.equal(runJson(cli, ['diagnose', '--data-dir', ownerData], false, 'owner_diagnose_after_grant').ready, true);
  assert.equal(runJson(cli, ['agent', 'connect', '--client-file', clientFile], true, 'agent_connect').ok, true);

  const createFile = join(agentHost, 'profile-create.json');
  await agentWrite(createFile, request('profile.create', operationKeys.create, grantId, { operations: ['profile.create'], profile_refs: [], origins: [origin] }, { template_ref: 'live-camoufox-template' }));
  const created = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', createFile], true, 'profile_create');
  succeeded(created, 'profile_create');
  assert.equal(created.result?.provider_selection?.selected_provider_id, 'camoufox', JSON.stringify(created));
  const profileRef = ref(created.result, 'profile_ref', 'profile_create');

  const startFile = join(agentHost, 'instance-start.json');
  await agentWrite(startFile, request('instance.start', operationKeys.start, grantId, scope('instance.start', profileRef), { profile_ref: profileRef, origin, url: `${origin}/` }));
  const started = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', startFile], true, 'instance_start');
  succeeded(started, 'instance_start');
  sessionRef = ref(started.result, 'runtime_session_ref', 'instance_start');

  const observeFile = join(agentHost, 'observe.json');
  await agentWrite(observeFile, request('instance.observe', operationKeys.observe, grantId, scope('instance.observe', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef }));
  const observed = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', observeFile], true, 'instance_observe');
  succeeded(observed, 'instance_observe');
  assert.equal(observed.result?.observation?.page?.current_url, `${origin}/`, JSON.stringify(observed));
  const observedPage = observed.result.observation.page;

  const snapshotFile = join(agentHost, 'snapshot.json');
  await agentWrite(snapshotFile, request('instance.snapshot', operationKeys.snapshot, grantId, scope('instance.snapshot', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: observedPage.page_ref, ...(observedPage.page_id ? { page_id: observedPage.page_id } : {}), ...(observedPage.document_generation ? { document_generation: observedPage.document_generation } : {}) }));
  const snapshot = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', snapshotFile], true, 'instance_snapshot');
  succeeded(snapshot, 'instance_snapshot');
  const snapshotValue = snapshot.result?.snapshot;
  assert.ok(snapshotValue?.text?.includes('No account local page'), JSON.stringify(snapshot));
  const control = snapshotValue.controls?.find(item => item.role === 'textbox' && item.name === 'Message' && item.enabled === true);
  assert.ok(control?.target_ref, `Message target missing: ${JSON.stringify(snapshot)}`);

  const inputFile = join(agentHost, 'input.json');
  const inputText = 'ordinary local acceptance input';
  await agentWrite(inputFile, request('instance.input', operationKeys.input, grantId, scope('instance.input', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: snapshotValue.page_ref, ...(snapshotValue.page_id ? { page_id: snapshotValue.page_id } : {}), ...(snapshotValue.document_generation ? { document_generation: snapshotValue.document_generation } : {}), observation_ref: snapshotValue.observation_ref, target_ref: control.target_ref, text: inputText }));
  const inputResult = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', inputFile], true, 'instance_input');
  succeeded(inputResult, 'instance_input');

  const readFilePath = join(agentHost, 'read.json');
  const inputPage = snapshotValue;
  await agentWrite(readFilePath, request('instance.read', operationKeys.read, grantId, scope('instance.read', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: inputPage.page_ref, ...(inputPage.page_id ? { page_id: inputPage.page_id } : {}), ...(inputPage.document_generation ? { document_generation: inputPage.document_generation } : {}) }));
  const freshRead = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', readFilePath], true, 'instance_read');
  succeeded(freshRead, 'instance_read');
  assert.ok(freshRead.result?.text?.includes(`Received: ${inputText}`), JSON.stringify(freshRead));

  const cliQuery = runJson(cli, ['agent', 'query', '--client-file', clientFile, '--idempotency-key', operationKeys.input], true, 'cli_query');
  assert.equal(cliQuery.run_id, inputResult.run_id, JSON.stringify({ cliQuery, inputResult }));
  const mcpQuery = await runMcpQuery(clientFile, operationKeys.input);
  assert.equal(mcpQuery.run_id, inputResult.run_id, JSON.stringify({ mcpQuery, inputResult }));

  const takeover = allowJson(cli, ['instance', 'takeover', '--data-dir', ownerData, '--runtime-session-ref', sessionRef], false, 'instance_takeover');
  let takeoverEvidence;
  if (viewerUnavailable(takeover)) {
    takeoverEvidence = { state: 'not_exercised', reason: 'viewer_unavailable', failure_class: takeover.failure_class ?? takeover.error?.code ?? takeover.failure?.code };
  } else {
    assert.equal(takeover.control_owner, 'user', JSON.stringify(takeover));
    assert.equal(takeover.control_lock?.owner, 'user', JSON.stringify(takeover));
    assert.equal(takeover.control_lock?.state, 'held', JSON.stringify(takeover));
    const deniedFile = join(agentHost, 'input-after-takeover.json');
    await agentWrite(deniedFile, request('instance.input', operationKeys.takeoverInput, grantId, scope('instance.input', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: inputPage.page_ref, ...(inputPage.page_id ? { page_id: inputPage.page_id } : {}), ...(inputPage.document_generation ? { document_generation: inputPage.document_generation } : {}), observation_ref: inputPage.observation_ref, target_ref: control.target_ref, text: 'must be refused' }));
    const denied = allowJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', deniedFile], true, 'input_after_takeover');
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.equal(denied.dispatch_state, 'not_dispatched', JSON.stringify(denied));
    assert.equal(denied.failure?.code, 'control_lock_conflict', JSON.stringify(denied));
    const handback = allowJson(cli, ['instance', 'handback', '--data-dir', ownerData, '--runtime-session-ref', sessionRef], false, 'instance_handback');
    assert.equal(handback.runtime_session_ref, sessionRef, JSON.stringify(handback));
    assert.equal(handback.lifecycle_state, 'idle', JSON.stringify(handback));
    assert.equal(handback.control_owner, 'none', JSON.stringify(handback));
    assert.equal(handback.control_lock?.owner, 'none', JSON.stringify(handback));
    assert.equal(handback.control_lock?.state, 'released', JSON.stringify(handback));
    const afterHandbackFile = join(agentHost, 'observe-after-handback.json');
    await agentWrite(afterHandbackFile, request('instance.observe', operationKeys.handbackObserve, grantId, scope('instance.observe', profileRef), { profile_ref: profileRef, origin, runtime_session_ref: sessionRef }));
    const afterHandback = runJson(cli, ['agent', 'operation', '--client-file', clientFile, '--request-file', afterHandbackFile], true, 'observe_after_handback');
    succeeded(afterHandback, 'observe_after_handback');
    assert.equal(afterHandback.result?.observation?.runtime_session_ref, sessionRef, JSON.stringify(afterHandback));
    assert.equal(afterHandback.result?.observation?.profile_ref, profileRef, JSON.stringify(afterHandback));
    assert.equal(afterHandback.result?.observation?.page?.current_url, `${origin}/`, JSON.stringify(afterHandback));
    assert.notEqual(afterHandback.result?.observation?.observation_ref, observed.result?.observation?.observation_ref, JSON.stringify({ observed, afterHandback }));
    assert.ok(Number.isSafeInteger(afterHandback.result?.observation?.control_generation) &&
      afterHandback.result.observation.control_generation > observed.result?.observation?.control_generation, JSON.stringify({ observed, afterHandback }));
    takeoverEvidence = { state: 'verified', controller: 'owner_cli', human_interaction: false, failure_code: denied.failure?.code,
      run_id: denied.run_id, fresh_observe_run_id: afterHandback.run_id };
  }
  run(cli, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]);
  sessionRef = undefined;
  const siteTaskEvidence = await runGithubTrendingAcceptance({ ownerData, agentHost, clientFile, principalId });

  const manifestPath = join(packageRoot, 'agent-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const evidence = { schema: 'webenvoy.live-camoufox-acceptance/v1', state: 'passed', candidate: manifest.workspace?.commit,
    package_manifest_sha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex'), owner_uid: ownerUid, agent_uid: agentUid,
    origin, provider: { provider: binding.provider, camoufox_version: binding.camoufox_version, browser_version: binding.browser_version,
      playwright_version: binding.playwright_version, properties_sha256: binding.properties_sha256, source_sha256: binding.source_sha256 },
    real_provider: true, external_site: true, external_site_target: 'https://github.com/trending?since=daily', account: false, third_party_agent: false, plugin_verified: false, takeover: takeoverEvidence,
    site_task: siteTaskEvidence,
    runs: { profile_create: created.run_id, instance_start: started.run_id, observe: observed.run_id, snapshot: snapshot.run_id,
      input: inputResult.run_id, read: freshRead.run_id, cli_query: cliQuery.run_id, mcp_query: mcpQuery.run_id, takeover_input: takeoverEvidence.run_id ?? null,
      observe_after_handback: takeoverEvidence.fresh_observe_run_id ?? null } };
  if (process.env.LIVE_BROWSER_EVIDENCE_PATH) await writeFile(resolve(process.env.LIVE_BROWSER_EVIDENCE_PATH), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  try { if (sessionRef) run(cli, ['instance', 'stop', '--data-dir', ownerData, '--runtime-session-ref', sessionRef]); } catch {}
  if (runtimeStarted) { try { run(cli, ['stop', '--data-dir', ownerData]); } catch {} }
  if (agentHost) { try { run(fixedNode, ['--input-type=module', '-e', 'import { rm } from "node:fs/promises"; await rm(process.argv[1], { recursive: true, force: true });', agentHost], true); } catch {} }
  if (originProcess) {
    try {
      if (originProcess.exitCode === null) {
        await new Promise(resolveExit => {
          const timer = setTimeout(() => { try { originProcess.kill('SIGKILL'); } catch {} resolveExit(); }, 2_000);
          originProcess.once('exit', () => { clearTimeout(timer); resolveExit(); });
          originProcess.kill('SIGTERM');
        });
      }
    } catch {}
  }
  await rm(root, { recursive: true, force: true });
}
