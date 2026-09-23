import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('quality_check_requires_macos_arm64');
const args = process.argv.slice(2);
function classifyOutcome(parsed, exitCode, hasError, mutation) {
  const state = parsed?.status ?? parsed?.result?.status ?? parsed?.run?.status;
  if (exitCode === 6 || state === 'unknown_outcome' || parsed?.failure_class === 'unknown_outcome' || parsed?.dispatch_state === 'possibly_dispatched') return 'unknown';
  if (state === 'manual_recovery_required' || parsed?.failure_class === 'manual_recovery_required') return 'manual_recovery_required';
  if (mutation && (hasError || !parsed)) return 'unknown';
  return !hasError && parsed && exitCode === 0 && parsed.ok !== false ? 'completed' : 'failed';
}
function compareObserved(initial, current) {
  const fields = ['language', 'languages', 'timezone', 'viewport', 'screen'];
  const checked = fields.filter(key => initial?.[key] != null && current?.[key] != null);
  return { checked, changed: checked.filter(key => JSON.stringify(initial[key]) !== JSON.stringify(current[key])),
    unknown: fields.filter(key => !checked.includes(key)) };
}
if (args.length === 1 && args[0] === '--self-check') {
  assert.equal(classifyOutcome({ status: 'succeeded', ok: true }, 0, false, true), 'completed');
  assert.equal(classifyOutcome({ status: 'unknown_outcome' }, 6, false, true), 'unknown');
  assert.equal(classifyOutcome({ status: 'manual_recovery_required' }, 4, false, true), 'manual_recovery_required');
  assert.equal(classifyOutcome({ dispatch_state: 'possibly_dispatched' }, 6, false, true), 'unknown');
  assert.equal(classifyOutcome(null, 0, false, true), 'unknown');
  assert.equal(classifyOutcome(null, null, true, true), 'unknown');
  assert.equal(classifyOutcome(null, null, true, false), 'failed');
  assert.deepEqual(compareObserved({ language: 'en', timezone: 'UTC' }, { language: 'en', timezone: 'UTC' }),
    { checked: ['language', 'timezone'], changed: [], unknown: ['languages', 'viewport', 'screen'] });
  assert.deepEqual(compareObserved({ language: 'en' }, { language: 'fr' }).changed, ['language']);
  process.stdout.write('quality-check-self-check-passed\n');
  process.exit(0);
}
const sourcePackageRoot = resolve(args[0] ?? process.env.PACKAGE_ROOT ?? '.');
const materialsPointer = resolve(args[1] ?? process.env.W3_MATERIALS_POINTER ?? '/tmp/webenvoy-w1-material-root.txt');
const root = await mkdtemp('/tmp/webenvoy-w3-quality-');
const packageRoot = join(root, 'package');
const ownerData = join(root, 'owner-data');
const agentHost = join(root, 'agent-host');
const requestRoot = join(agentHost, 'requests');
const evidencePath = join(root, 'evidence.json');
const addressPath = join(root, 'local-origin.json');
const prefix = basename(root);
const ownerUid = process.getuid?.();
if (!Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('owner_uid_unavailable');

await cp(sourcePackageRoot, packageRoot, { recursive: true, errorOnExist: true });
const cli = join(packageRoot, 'bin', 'webenvoy');
const fixedNode = join(packageRoot, 'runtime', 'node');
const manifestBytes = await readFile(join(packageRoot, 'agent-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const sourceManifestBytes = await readFile(join(sourcePackageRoot, 'agent-manifest.json'));
assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), createHash('sha256').update(sourceManifestBytes).digest('hex'), 'isolated_package_manifest_changed');
const versionResult = spawnSync(cli, ['--version'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } });
if (versionResult.status !== 0) throw new Error('isolated_package_version_failed');
const version = JSON.parse(versionResult.stdout.trim());
assert.equal(version.integrity, 'verified', 'isolated_package_integrity_unverified');

const materialsText = (await readFile(materialsPointer, 'utf8')).trim();
if (!materialsText || materialsText.includes('\n')) throw new Error('materials_pointer_invalid');
const materialsRoot = resolve(materialsText);
const browserRoot = join(materialsRoot, 'browser', 'Camoufox.app');
const browserExecutable = join(browserRoot, 'Contents/MacOS/camoufox');
const pythonPath = join(materialsRoot, 'venv/bin/python');
const { CAMOUFOX_UPSTREAM_PINS, verifyCamoufoxUpstreamInstall } = await import(pathToFileURL(join(packageRoot, 'agent-entry/provider-artifact.mjs')).href);
const provider = await verifyCamoufoxUpstreamInstall({
  provider: 'camoufox', browser_install_root: browserRoot, browser_executable: browserExecutable, python_path: pythonPath,
  browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version,
  browser_source_path: join(materialsRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
  camoufox_source_path: join(materialsRoot, 'camoufox-0.5.6-py3-none-any.whl'),
  playwright_source_path: join(materialsRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')
});
const providerArgs = [
  '--browser-install-root', browserRoot, '--browser-executable', browserExecutable, '--python-path', pythonPath,
  '--browser-version', provider.browser_version, '--camoufox-version', provider.camoufox_version,
  '--playwright-version', provider.playwright_version,
  '--browser-source-path', provider.sources.browser.path, '--camoufox-source-path', provider.sources.camoufox.path,
  '--playwright-source-path', provider.sources.playwright.path
];

let origin;
let originProcess;
let harborPid;
let runtimeStarted = false;
let runtimeStartAttempted = false;
let liveDeadline = null;
let currentStep = 'preflight';
let currentAttempt = null;
let profileA;
let profileB;
let grantA;
let grantB;
let sessionA;
let sessionB;
const active = new Map();
const starts = { A: 0, B: 0 };
const calls = [];
const systemCalls = [];
const evidence = {
  schema: 'webenvoy.browser-environment-quality-w3/v1', state: 'preflight', candidate: manifest.workspace?.commit ?? null,
  package_manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'), platform: `${process.platform}-${process.arch}`,
  provider: { provider_id: 'webenvoy.camoufox-upstream/v1', source: 'owner_verified_upstream', camoufox_version: provider.camoufox_version,
    browser_version: provider.browser_version, playwright_version: provider.playwright_version,
    properties_sha256: provider.properties_sha256, source_sha256: provider.source_sha256 },
  profile_class: 'dedicated_no_account', evidence_types: ['live_verified', 'fixture_verified'], real_provider: true,
  external_site: false, account: false, third_party_agent: false, paid_model: false, network_scope: '127.0.0.1 loopback fixture only',
  execution_path: { entry: 'standalone package CLI + managed agent operations', viewer: 'not used', headless: false,
    scope_semantics: 'legacy_request_guard_v1 (existing default for grants and policies without scope_semantics)',
    network_routing: 'legacy context.route enabled; offline during startup and service_workers blocked', main_world_eval: true,
    page_actions: 'managed snapshot/input/read; no arbitrary evaluate', input: 'instance.input' },
  budget: { max_profiles: 2, max_simultaneous_instances: 2, max_instance_starts_A: 4, max_instance_starts_B: 1,
    max_call_ms: 120_000, max_live_ms: 900_000 },
  calls, system_calls: systemCalls, starts, environment_reads: [], attempts: [], steps: {}
};
calls.push({ label: 'isolated-package-version', command: '--version', duration_ms: null,
  stdout_bytes: Buffer.byteLength(versionResult.stdout ?? ''), stderr_bytes: Buffer.byteLength(versionResult.stderr ?? ''),
  exit_code: versionResult.status ?? null, signal: versionResult.signal ?? null, outcome: 'completed',
  integrity: version.integrity, candidate: manifest.workspace?.commit ?? null });
async function persist() { await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }); }
function fingerprint(value) { return createHash('sha256').update(value).digest('hex').slice(0, 16); }
function ensureBudget() {
  if (liveDeadline !== null && Date.now() >= liveDeadline) throw Object.assign(new Error('live_budget_exhausted'), { code: 'live_budget_exhausted' });
}
function callTimeout(cleanup = false) {
  if (cleanup || liveDeadline === null) return 120_000;
  ensureBudget();
  return Math.max(1, Math.min(120_000, liveDeadline - Date.now()));
}
function parseJson(output) {
  for (const line of `${output.stdout ?? ''}\n${output.stderr ?? ''}`.trim().split('\n').reverse()) {
    try { return JSON.parse(line); } catch {}
  }
  return null;
}
function failureCode(value) {
  const parsed = value?.parsed;
  return parsed?.failure?.code ?? parsed?.error?.code ?? parsed?.failure_code ?? value?.error?.code ?? null;
}
async function command(label, commandArgs, { cleanup = false, idempotencyKey = null } = {}) {
  const timeout = callTimeout(cleanup);
  const started = performance.now();
const result = spawnSync(cli, commandArgs, { cwd: packageRoot, encoding: 'utf8', timeout,
    env: { ...process.env, LC_ALL: 'C' } });
  const parsed = parseJson(result);
  const mutation = /(?:start|input|create|update|grant|revoke|stop)/i.test(label);
  const entry = {
    label, command: commandArgs.slice(0, 2).join(' '), duration_ms: Math.round(performance.now() - started),
    stdout_bytes: Buffer.byteLength(result.stdout ?? ''), stderr_bytes: Buffer.byteLength(result.stderr ?? ''),
    exit_code: result.status ?? null, signal: result.signal ?? null,
    failure_code: failureCode({ parsed, error: result.error }), dispatch_state: parsed?.dispatch_state ?? null, business_status: parsed?.status ?? null,
    business_outcome: parsed?.status ?? parsed?.result?.status ?? parsed?.run?.status ?? null,
    outcome: classifyOutcome(parsed, result.status, Boolean(result.error), mutation),
    ...(idempotencyKey ? { key_fingerprint: fingerprint(idempotencyKey) } : {})
  };
  calls.push(entry);
  await persist().catch(() => {});
  return { result, parsed, entry };
}
async function runJson(label, commandArgs, options = {}) {
  const called = await command(label, commandArgs, options);
  if (called.result.error || called.result.status !== 0 || called.result.signal) {
    throw Object.assign(new Error(label), { code: called.entry.failure_code ?? called.result.error?.code ?? `${label}_exit`, call: called.entry });
  }
  if (!called.parsed) throw Object.assign(new Error(`${label}_json_missing`), { code: `${label}_json_missing`, call: called.entry });
  return called.parsed;
}
function collectObjects(value, predicate, found = []) {
  if (Array.isArray(value)) for (const item of value) collectObjects(item, predicate, found);
  else if (value && typeof value === 'object') {
    if (predicate(value)) found.push(value);
    for (const child of Object.values(value)) collectObjects(child, predicate, found);
  }
  return found;
}
function stringsForKey(value, key, found = []) {
  if (Array.isArray(value)) for (const item of value) stringsForKey(item, key, found);
  else if (value && typeof value === 'object') {
    if (typeof value[key] === 'string') found.push(value[key]);
    for (const child of Object.values(value)) stringsForKey(child, key, found);
  }
  return found;
}
function stringForKey(value, key, label) {
  const found = stringsForKey(value, key);
  assert.ok(found[0], `${label}_missing_${key}`);
  return found[0];
}
function succeeded(value, label) {
  assert.equal(value?.ok, true, `${label}_not_ok`);
  assert.equal(value?.status, 'succeeded', `${label}_not_succeeded`);
}
function scope(operation, profileRefs = []) { return { operations: [operation], profile_refs: profileRefs, origins: [origin] }; }
function request(operation, idempotencyKey, grantId, taskScope, fields = {}) {
  return { idempotency_key: idempotencyKey, grant_id: grantId, operation, task_scope: taskScope, ...fields };
}
async function agentOperation(label, operation, grantId, profileRefs, fields = {}, { allowFailure = false } = {}) {
  const idempotencyKey = `${prefix}-${label}`;
  const requestPath = join(requestRoot, `${label}.json`);
  const body = request(operation, idempotencyKey, grantId, scope(operation, profileRefs), fields);
  await writeFile(requestPath, JSON.stringify(body), { mode: 0o600 });
  const called = await command(label, ['agent', 'operation', '--client-file', join(agentHost, 'webenvoy-client.json'), '--request-file', requestPath], { idempotencyKey });
  if (!allowFailure && (called.result.error || called.result.status !== 0 || !called.parsed)) {
    throw Object.assign(new Error(label), { code: called.entry.failure_code ?? called.result.error?.code ?? `${label}_exit`, call: called.entry });
  }
  return { value: called.parsed, call: called.entry, key: idempotencyKey };
}
async function startLocalOrigin() {
  const source = String.raw`
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
const html = ` + '`' + String.raw`<!doctype html><meta charset="utf-8"><title>W3 local fixture</title>
<main><h1>W3 no-account fixture</h1><label for="value">Task input</label><input id="value" aria-label="Task input">
<p id="state"></p><p id="signals"></p></main><script>
const key='webenvoy.w3.local-fixture.v1';let rows=[];try{rows=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
const state=document.getElementById('state'),signals=document.getElementById('signals'),field=document.getElementById('value');
function render(){state.textContent='stored_count='+rows.length+';latest='+(rows.at(-1)?.value||'none')}
function expose(trusted=rows.at(-1)?.trusted??null){signals.textContent='webdriver='+String(navigator.webdriver)+';ua_available='+String(Boolean(navigator.userAgent))+';languages_available='+String(navigator.languages?.length>0)+';input_is_trusted='+String(trusted)}
render();expose();field.addEventListener('input',event=>{rows.push({value:field.value,trusted:event.isTrusted});localStorage.setItem(key,JSON.stringify(rows));render();expose(event.isTrusted)});
</script>` + '`' + `;
const server=createServer((request,response)=>{const path=new URL(request.url??'/', 'http://127.0.0.1').pathname;
 if(request.method!=='GET'||path!=='/fixture'){response.writeHead(404);response.end();return;}
 response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'"});response.end(html);
});
server.listen(0,'127.0.0.1',async()=>{const address=server.address();await writeFile(process.argv[1],JSON.stringify({port:address.port}),{mode:0o600});});
const stop=()=>server.close(()=>process.exit(0));process.once('SIGTERM',stop);process.once('SIGINT',stop);
`;
  originProcess = spawn(fixedNode, ['--input-type=module', '-e', source, addressPath], { cwd: packageRoot, detached: true, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } });
  originProcess.unref();
  if (!originProcess.pid) throw Object.assign(new Error('local_origin_start_failed'), { code: 'local_origin_start_failed' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const { port } = JSON.parse(await readFile(addressPath, 'utf8'));
      if (Number.isSafeInteger(port) && port > 0) return `http://127.0.0.1:${port}`;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw Object.assign(new Error('local_origin_start_timeout'), { code: 'local_origin_start_timeout' });
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}
function childPids(pid) {
  const result = spawnSync('/usr/bin/pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 });
  systemCalls.push({ kind: 'process_read', command: 'pgrep -P', exit_code: result.status ?? null,
    output_bytes: Buffer.byteLength(result.stdout ?? ''), outcome: result.status === 0 || result.status === 1 ? 'completed' : 'unknown' });
  if (result.status === 1 && !result.stdout.trim()) return [];
  if (result.status !== 0) return null;
  return result.stdout.trim().split(/\s+/).map(Number).filter(Number.isSafeInteger);
}
function processName(pid) {
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5_000 });
  systemCalls.push({ kind: 'process_read', command: 'ps -o comm', exit_code: result.status ?? null,
    output_bytes: Buffer.byteLength(result.stdout ?? ''), outcome: result.status === 0 ? 'completed' : 'unknown' });
  return result.status === 0 ? basename(result.stdout.trim()) : '';
}
function descendants(pid) {
  const found = [];
  const pending = [{ pid, parent: null }];
  const seen = new Set([pid]);
  while (pending.length) {
    const parent = pending.shift();
    const children = childPids(parent.pid);
    if (children === null) return null;
    for (const child of children) {
      if (seen.has(child)) continue;
      seen.add(child);
      const row = { pid: child, parent: parent.pid, name: processName(child) };
      found.push(row); pending.push(row);
    }
  }
  return found;
}
async function waitForNewDriver(before, label) {
  const deadline = Math.min(Date.now() + 30_000, liveDeadline ?? Infinity);
  while (Date.now() < deadline) {
    ensureBudget();
    const children = childPids(harborPid);
    if (children === null) break;
    const added = children.filter(pid => !before.has(pid) && /python/i.test(processName(pid)));
    if (added.length === 1) return added[0];
    if (added.length > 1) throw Object.assign(new Error(`${label}_driver_ambiguous`), { code: `${label}_driver_ambiguous` });
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw Object.assign(new Error(`${label}_driver_missing`), { code: `${label}_driver_missing` });
}
async function waitForBrowser(driverPid, label) {
  const deadline = Math.min(Date.now() + 30_000, liveDeadline ?? Infinity);
  while (Date.now() < deadline) {
    ensureBudget();
    const rows = descendants(driverPid);
    const browsers = rows?.filter(row => /camoufox/i.test(row.name)) ?? [];
    const ids = new Set(browsers.map(row => row.pid));
    const roots = browsers.filter(row => !ids.has(row.parent));
    if (roots.length === 1) return roots[0].pid;
    if (roots.length > 1) throw Object.assign(new Error(`${label}_browser_ambiguous`), { code: `${label}_browser_ambiguous` });
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw Object.assign(new Error(`${label}_browser_missing`), { code: `${label}_browser_missing` });
}
async function waitForPid(pid, expectedAlive, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (pidAlive(pid) === expectedAlive) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw Object.assign(new Error(`${label}_pid_state_mismatch`), { code: `${label}_pid_state_mismatch` });
}
function processSample(pid) {
  if (!pid) return { state: 'unknown', rss_kb: null, cpu_percent: null };
  const started = performance.now();
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'rss=', '-o', '%cpu='], { encoding: 'utf8', timeout: 5_000 });
  const outputBytes = Buffer.byteLength(result.stdout ?? '') + Buffer.byteLength(result.stderr ?? '');
  systemCalls.push({ kind: 'process_read', command: 'ps -o rss,%cpu', duration_ms: Math.round(performance.now() - started),
    output_bytes: outputBytes, exit_code: result.status ?? null, outcome: result.status === 0 ? 'completed' : 'unknown' });
  const [rss, cpu] = result.stdout.trim().split(/\s+/).map(Number);
  return result.status === 0 && Number.isFinite(rss) && Number.isFinite(cpu)
    ? { state: 'observed', rss_kb: rss, cpu_percent: cpu }
    : { state: 'unknown', rss_kb: null, cpu_percent: null };
}
function environmentSummary(value) {
  const v = value?.result ?? value;
  const config = item => item ? { provider_id: item.provider_id, language: item.language, timezone: item.timezone,
    viewport: item.viewport, proxy_configured: Boolean(item.proxy_ref), geoip_mode: item.geoip_mode } : null;
  const observed = v?.observed;
  return {
    schema_version: v?.schema_version ?? null, status: v?.status ?? 'unknown', observation_status: v?.observation_status ?? 'unknown',
    configured: config(v?.configured), effective: config(v?.effective), pending: config(v?.pending),
    observed: observed ? { language: observed.language ?? null, languages: observed.languages ?? null, timezone: observed.timezone ?? null,
      viewport: observed.viewport ?? null, screen: observed.screen ?? null,
      webgl_vendor_observed: Boolean(observed.webgl_vendor), webgl_renderer_observed: Boolean(observed.webgl_renderer),
      fonts_hash_observed: Boolean(observed.fonts_hash), voices_hash_observed: Boolean(observed.voices_hash),
      canvas_hash_observed: Boolean(observed.canvas_hash), audio_hash_observed: Boolean(observed.audio_hash) } : null,
    provider: v?.provider ? { camoufox_version: v.provider.camoufox_version, browser_version: v.provider.browser_version,
      properties_sha256: v.provider.properties_sha256 } : null,
    bundle_hash: v?.bundle_hash ?? null,
    drift: v?.drift ? { state: v.drift.state, checked_fields: v.drift.checked_fields, changed_fields: v.drift.changed_fields,
      unknown_fields: v.drift.unknown_fields } : null,
    support: v?.support ? { configuration_fields: v.support.configuration_fields, readback_fields: v.support.readback_fields,
      limitations: v.support.limitations } : null
  };
}
async function readEnvironment(label, profileRef, grantId) {
  const result = await agentOperation(label, 'environment.read', grantId, [profileRef], { profile_ref: profileRef, origin });
  succeeded(result.value, label);
  const summary = environmentSummary(result.value);
  evidence.environment_reads.push({ profile: profileRef === profileA ? 'A' : 'B', label, ...summary });
  await persist();
  return summary;
}
function pageFrom(value, label) {
  const page = value?.result?.observation?.page;
  assert.ok(page?.page_ref && page?.current_url, `${label}_page_missing`);
  return page;
}
function snapshotFrom(value, label) {
  const snapshot = value?.result?.snapshot;
  assert.ok(snapshot?.page_ref && snapshot?.observation_ref, `${label}_snapshot_missing`);
  return snapshot;
}
function readText(value, label) {
  const text = value?.result?.text;
  assert.equal(typeof text, 'string', `${label}_text_missing`);
  return text;
}
function viewSummary(text) {
  const count = Number(text.match(/stored_count=(\d+)/)?.[1]);
  const latest = text.match(/latest=([A-Z][0-9]+|none)/)?.[1] ?? null;
  const signals = text.match(/webdriver=(true|false);ua_available=(true|false);languages_available=(true|false);input_is_trusted=(true|false|null)/);
  return { stored_count: Number.isSafeInteger(count) ? count : null, latest,
    exposure: signals ? { webdriver: signals[1] === 'true', user_agent_available: signals[2] === 'true',
      languages_available: signals[3] === 'true', last_input_is_trusted: signals[4] === 'null' ? null : signals[4] === 'true' } : null };
}
async function observeAndSnapshot(label, profileRef, grantId, sessionRef) {
  const observed = await agentOperation(`${label}-observe`, 'instance.observe', grantId, [profileRef], {
    profile_ref: profileRef, origin, runtime_session_ref: sessionRef
  });
  succeeded(observed.value, `${label}_observe`);
  const page = pageFrom(observed.value, `${label}_observe`);
  const snap = await agentOperation(`${label}-snapshot`, 'instance.snapshot', grantId, [profileRef], {
    profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: page.page_ref,
    ...(page.page_id ? { page_id: page.page_id } : {}), ...(page.document_generation ? { document_generation: page.document_generation } : {})
  });
  succeeded(snap.value, `${label}_snapshot`);
  return { page, snapshot: snapshotFrom(snap.value, `${label}_snapshot`) };
}
async function readPage(label, profileRef, grantId, sessionRef, page) {
  return agentOperation(label, 'instance.read', grantId, [profileRef], {
    profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: page.page_ref,
    ...(page.page_id ? { page_id: page.page_id } : {}), ...(page.document_generation ? { document_generation: page.document_generation } : {})
  });
}
async function runTask(profileLabel, profileRef, grantId, sessionRef, task, expectedBefore, expectedAfter) {
  const label = `${profileLabel}-${task}`;
  const attempt = { profile: profileLabel, task, outcome: 'running', started_at: new Date().toISOString() };
  evidence.attempts.push(attempt); currentAttempt = attempt; await persist();
  const callStart = calls.length, startTime = performance.now();
  const page = await observeAndSnapshot(`${label}-target`, profileRef, grantId, sessionRef);
  const before = await readPage(`${label}-before`, profileRef, grantId, sessionRef, page.page);
  succeeded(before.value, `${label}_before_read`);
  const beforeSummary = viewSummary(readText(before.value, `${label}_before_read`));
  assert.equal(beforeSummary.stored_count, expectedBefore, `${label}_storage_before_mismatch`);
  if (profileLabel === 'B' && expectedBefore === 0) assert.equal(beforeSummary.latest, 'none', `${label}_cross_profile_storage_visible`);
  const control = page.snapshot.controls?.find(item => item.role === 'textbox' && item.name === 'Task input' && item.enabled === true);
  assert.ok(control?.target_ref, `${label}_task_input_missing`);
  const inputKey = `${prefix}-${label}-input`;
  const input = await agentOperation(`${label}-input`, 'instance.input', grantId, [profileRef], {
    profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: page.snapshot.page_ref,
    ...(page.snapshot.page_id ? { page_id: page.snapshot.page_id } : {}),
    ...(page.snapshot.document_generation ? { document_generation: page.snapshot.document_generation } : {}),
    observation_ref: page.snapshot.observation_ref, target_ref: control.target_ref, text: task
  });
  succeeded(input.value, `${label}_input`);
  const query = await runJson(`${label}-query`, ['agent', 'query', '--client-file', join(agentHost, 'webenvoy-client.json'), '--idempotency-key', inputKey], { idempotencyKey: inputKey });
  assert.equal(query.run_id, input.value.run_id, `${label}_query_run_mismatch`);
  const after = await readPage(`${label}-after-query`, profileRef, grantId, sessionRef, page.page);
  succeeded(after.value, `${label}_after_read`);
  const afterSummary = viewSummary(readText(after.value, `${label}_after_read`));
  assert.equal(afterSummary.stored_count, expectedAfter, `${label}_storage_after_mismatch`);
  assert.equal(afterSummary.latest, task, `${label}_storage_value_mismatch`);
  attempt.outcome = 'success'; attempt.completed_at = new Date().toISOString();
  attempt.duration_ms = Math.round(performance.now() - startTime);
  attempt.output_bytes = calls.slice(callStart).reduce((sum, item) => sum + item.stdout_bytes + item.stderr_bytes, 0);
  attempt.before = beforeSummary; attempt.after = afterSummary; attempt.idempotency_key_fingerprint = fingerprint(inputKey);
  attempt.queried_run_fingerprint = fingerprint(String(query.run_id)); attempt.run_fingerprint = fingerprint(String(input.value.run_id));
  attempt.query_did_not_replay = afterSummary.stored_count === expectedAfter;
  attempt.runtime_session_fingerprint = fingerprint(sessionRef); attempt.page_ref_fingerprint = fingerprint(page.page.page_ref);
  attempt.page_id_fingerprint = page.page.page_id ? fingerprint(page.page.page_id) : null;
  attempt.model_usage = 'not_used'; attempt.manual_intervention = 'none'; attempt.resources = processSample(active.get(profileLabel)?.browserPid);
  await persist(); currentAttempt = null;
  return attempt;
}
function sessionPids() {
  const children = childPids(harborPid);
  return children ?? [];
}
async function startInstance(label, profileRef, grantId, url) {
  const id = label;
  const profileLabel = label.startsWith('A') ? 'A' : 'B';
  const limit = profileLabel === 'A' ? 4 : 1;
  starts[profileLabel] += 1;
  assert.ok(starts[profileLabel] <= limit, `${profileLabel}_start_budget_exceeded`);
  const before = new Set(sessionPids());
  const startTime = performance.now();
  const started = await agentOperation(`${id}-start`, 'instance.start', grantId, [profileRef], {
    profile_ref: profileRef, origin, url
  });
  succeeded(started.value, `${id}_start`);
  const sessionRef = stringForKey(started.value, 'runtime_session_ref', `${id}_start`);
  active.set(profileLabel, { sessionRef, driverPid: null, browserPid: null });
  if (profileLabel === 'A') sessionA = sessionRef; else sessionB = sessionRef;
  const driverPid = await waitForNewDriver(before, id);
  const browserPid = await waitForBrowser(driverPid, id);
  active.set(profileLabel, { sessionRef, driverPid, browserPid });
  if (profileLabel === 'A') sessionA = sessionRef; else sessionB = sessionRef;
  attemptStartEvidence(label, started.call, startTime, browserPid);
  await persist();
  return sessionRef;
}
function attemptStartEvidence(label, call, startTime, browserPid) {
  evidence.steps[label] = { state: 'started', cli_duration_ms: call.duration_ms,
    ready_duration_ms: Math.round(performance.now() - startTime), resources: processSample(browserPid) };
}
async function stopInstance(profileLabel, cleanup = false) {
  const live = active.get(profileLabel);
  if (!live) return;
  const result = await runJson(`owner-stop-${profileLabel}-${starts[profileLabel]}`, ['instance', 'stop', '--data-dir', ownerData,
    '--runtime-session-ref', live.sessionRef], { cleanup });
  if (live.browserPid) await waitForPid(live.browserPid, false, `${profileLabel}_browser`);
  active.delete(profileLabel);
  evidence.steps[`stop_${profileLabel}_${starts[profileLabel]}`] = { state: 'stopped', result_status: result.status ?? 'returned',
    browser_exited: live.browserPid ? true : 'unknown' };
  await persist();
}
function environmentComparison(initial, current) {
  const observed = compareObserved(initial.observed, current.observed);
  return { configured_match: JSON.stringify(initial.configured) === JSON.stringify(current.configured),
    effective_match: JSON.stringify(initial.effective) === JSON.stringify(current.effective),
    observed_checked_fields: observed.checked, observed_changed_fields: observed.changed, observed_unknown_fields: observed.unknown,
    provider_version_match: JSON.stringify(initial.provider) === JSON.stringify(current.provider),
    bundle_hash_match: Boolean(initial.bundle_hash) && initial.bundle_hash === current.bundle_hash,
    current_drift: current.drift?.state ?? 'unknown', current_unknown_fields: current.drift?.unknown_fields ?? null };
}
async function recordEnvironmentTransition(initial, current, transition) {
  const comparison = { transition, ...environmentComparison(initial, current) };
  evidence.environment_comparisons ??= [];
  evidence.environment_comparisons.push(comparison);
  await persist();
  const drift = comparison.current_drift === 'drift' || Boolean(current.drift?.changed_fields?.length);
  const mismatch = !comparison.configured_match || !comparison.effective_match || !comparison.provider_version_match ||
    !comparison.bundle_hash_match || comparison.observed_changed_fields.length > 0 || drift;
  if (mismatch) throw Object.assign(new Error(`${transition}_environment_drift`), { code: 'environment_drift' });
  return comparison;
}
async function cleanup() {
  const result = { instances: {}, runtime: 'not_started', local_origin: 'not_started' };
  for (const profileLabel of ['A', 'B']) {
    try {
      const wasActive = active.has(profileLabel);
      const knownPid = active.get(profileLabel)?.browserPid ?? null;
      await stopInstance(profileLabel, true);
      result.instances[profileLabel] = wasActive ? knownPid ? 'stopped' : 'stopped_pid_unknown' : 'not_active';
    }
    catch (error) { result.instances[profileLabel] = { state: 'failed', code: error?.code ?? 'cleanup_failed' }; }
  }
  if (runtimeStarted || runtimeStartAttempted) {
    try {
      const stopped = await runJson('cleanup-runtime-stop', ['stop', '--data-dir', ownerData], { cleanup: true });
      if (harborPid) await waitForPid(harborPid, false, 'harbor');
      result.runtime = harborPid ? stopped.status ?? 'stopped' : 'stopped_pid_unknown';
      runtimeStarted = false; runtimeStartAttempted = false;
    } catch (error) { result.runtime = { state: 'failed', code: error?.code ?? 'cleanup_failed', harbor_alive: harborPid ? pidAlive(harborPid) : null }; }
  }
  if (originProcess?.pid) {
    try {
      if (pidAlive(originProcess.pid)) originProcess.kill('SIGTERM');
      await waitForPid(originProcess.pid, false, 'local_origin'); result.local_origin = 'stopped';
    } catch (error) { result.local_origin = { state: 'failed', code: error?.code ?? 'cleanup_failed', alive: pidAlive(originProcess.pid) }; }
  }
  return result;
}

async function main() {
  currentStep = 'owner_setup';
  const setup = await runJson('owner-setup', ['setup', '--data-dir', ownerData, '--agent-uid', String(ownerUid), ...providerArgs]);
  assert.equal(setup.installed, true, 'owner_setup_not_installed');
  assert.deepEqual(setup.camoufox_launch, { state: 'qualified', reason: 'official_upstream' }, 'camoufox_binding_not_qualified');
  assert.equal(setup.boundary?.mode, 'trusted_local', 'trusted_local_mode_missing');
  currentStep = 'runtime_start'; liveDeadline = Date.now() + 900_000; evidence.live_started_at = new Date().toISOString();
  runtimeStartAttempted = true;
  await runJson('runtime-start-initial', ['start', '--data-dir', ownerData]); runtimeStarted = true;
  const status = await runJson('runtime-diagnose-initial', ['diagnose', '--data-dir', ownerData]);
  assert.equal(status.ready, true, 'runtime_not_ready');
  harborPid = Number(status.services?.find(service => service.id === 'harbor')?.pid);
  assert.ok(Number.isSafeInteger(harborPid) && harborPid > 0, 'harbor_pid_missing');
  evidence.runtime = { ready: true, harbor_pid_observed: true, build: version.version ?? manifest.version ?? null };
  const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
  const setupHost = await (async () => {
    await mkdir(requestRoot, { recursive: true, mode: 0o700 });
    return runJson('agent-host-setup', ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData, '--owner-uid', String(ownerUid)]);
  })();
  assert.equal(setupHost.boundary?.mode, 'trusted_local', 'agent_trust_mode_missing');
  const clientFile = join(agentHost, 'webenvoy-client.json');
  const registered = await runJson('agent-register', ['access', 'register', '--data-dir', ownerData, '--display-name', `${prefix}-quality-agent`,
    '--credential-hash', setupHost.credential_fingerprint, '--idempotency-key', `${prefix}-register`], { idempotencyKey: `${prefix}-register` });
  const principalId = stringForKey(registered, 'principal_id', 'agent_register');
  const policy = await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: `${prefix}-management-policy`,
    expected_source_version: null, modes: { read: 'auto', prepare: 'auto', commit: 'auto' }
  } });
  systemCalls.push({ label: 'management-policy', kind: 'owner_control', outcome: policy?.ok ? 'completed' : 'failed' });
  assert.equal(policy.ok, true, 'management_policy_not_set');
  origin = await startLocalOrigin();
  evidence.fixture = { scope: 'loopback only', page: '/fixture', storage: 'synthetic localStorage entries', signals: ['navigator.webdriver', 'user-agent availability', 'language availability', 'input Event.isTrusted'] };
  await runJson('agent-connect', ['agent', 'connect', '--client-file', clientFile]);
  const creationGrantPath = join(root, 'creation-grant.json');
  const permissionOperations = ['profile.list', 'profile.read', 'environment.read', 'instance.start', 'instance.observe', 'instance.snapshot',
    'instance.input', 'instance.read', 'instance.stop'];
  const creationGrant = { idempotency_key: `${prefix}-creation-grant`, principal_id: principalId,
    profile_refs: [], allowed_operations: ['profile.create', 'profile.list', 'profile.read'], allowed_origins: [origin],
    expires_at: new Date(Date.now() + 1_200_000).toISOString(), max_created_profiles: 2,
    creation_template: { template_ref: `${prefix}-local-template`, provider_id: 'camoufox',
      site: { site_id: `${prefix}-local-site`, origin, display_name: 'W3 no-account loopback fixture' }, language: 'en-US', timezone: 'UTC',
      permission_ceiling: { allowed_operations: permissionOperations, allowed_origins: [origin], controlled_interaction_origins: [origin] } } };
  await writeFile(creationGrantPath, JSON.stringify(creationGrant), { mode: 0o600 });
  const grantResult = await runJson('creation-grant', ['access', 'grant', '--data-dir', ownerData, '--grant-file', creationGrantPath], { idempotencyKey: creationGrant.idempotency_key });
  const creationGrantId = stringForKey(grantResult, 'grant_id', 'creation_grant');
  async function createProfile(label) {
    const made = await agentOperation(`create-profile-${label.toLowerCase()}`, 'profile.create', creationGrantId, [], { template_ref: `${prefix}-local-template` });
    succeeded(made.value, `create_profile_${label}`);
    return stringForKey(made.value, 'profile_ref', `create_profile_${label}`);
  }
  currentStep = 'create_profiles';
  profileA = await createProfile('A'); profileB = await createProfile('B');
  assert.notEqual(profileA, profileB, 'profile_refs_not_isolated');
  evidence.profiles = { A: 'dedicated_profile_A', B: 'dedicated_profile_B', distinct: true };
  await runJson('revoke-creation-grant', ['access', 'revoke', '--data-dir', ownerData, '--kind', 'grants', '--id', creationGrantId,
    '--idempotency-key', `${prefix}-revoke-creation-grant`], { idempotencyKey: `${prefix}-revoke-creation-grant` });
  async function profileGrant(label, profileRef) {
    const path = join(root, `grant-${label}.json`);
    const key = `${prefix}-grant-${label}`;
    await writeFile(path, JSON.stringify({ idempotency_key: key, principal_id: principalId, profile_refs: [profileRef],
      allowed_operations: permissionOperations, allowed_origins: [origin], expires_at: new Date(Date.now() + 1_200_000).toISOString(),
      creation_template: null, max_created_profiles: 0 }), { mode: 0o600 });
    const result = await runJson(`profile-grant-${label}`, ['access', 'grant', '--data-dir', ownerData, '--grant-file', path], { idempotencyKey: key });
    return stringForKey(result, 'grant_id', `profile_grant_${label}`);
  }
  grantA = await profileGrant('a', profileA); grantB = await profileGrant('b', profileB);
  const denied = await agentOperation('cross-profile-read-denied', 'profile.read', grantA, [profileA], { profile_ref: profileB }, { allowFailure: true });
  assert.equal(denied.value?.ok, false, 'cross_profile_read_unexpectedly_succeeded');
  evidence.steps.cross_profile_read_denied = { state: 'verified', failure_code: denied.value?.failure?.code ?? denied.value?.error?.code ?? null,
    dispatch_state: denied.value?.dispatch_state ?? 'not_applicable_read' };
  currentStep = 'start_A1';
  sessionA = await startInstance('A1', profileA, grantA, `${origin}/fixture`);
  const initial = await readEnvironment('A1-initial', profileA, grantA);
  assert.equal(initial.provider?.browser_version, provider.browser_version, 'environment_provider_version_mismatch');
  assert.ok(initial.bundle_hash, 'environment_bundle_hash_missing');
  const taskA1 = await runTask('A', profileA, grantA, sessionA, 'A1', 0, 1);
  currentStep = 'stop_A1_start_A2'; await stopInstance('A');
  sessionA = await startInstance('A2', profileA, grantA, `${origin}/fixture`);
  const afterA2 = await readEnvironment('A2', profileA, grantA); await recordEnvironmentTransition(initial, afterA2, 'A1_to_A2');
  const taskA2 = await runTask('A', profileA, grantA, sessionA, 'A2', 1, 2);
  currentStep = 'start_B1';
  sessionB = await startInstance('B1', profileB, grantB, `${origin}/fixture`);
  const environmentB = await readEnvironment('B1', profileB, grantB);
  const taskB1 = await runTask('B', profileB, grantB, sessionB, 'B1', 0, 1);
  const afterBOnA = await readPage('A-after-B-read', profileA, grantA, sessionA, (await observeAndSnapshot('A-after-B-target', profileA, grantA, sessionA)).page);
  succeeded(afterBOnA.value, 'A_after_B_read');
  const aUnaffectedByB = viewSummary(readText(afterBOnA.value, 'A_after_B_read'));
  assert.equal(aUnaffectedByB.stored_count, 2, 'cross_profile_storage_changed_A');
  const distinctSessions = sessionA !== sessionB && taskA2.runtime_session_fingerprint !== taskB1.runtime_session_fingerprint;
  const distinctPages = taskA2.page_ref_fingerprint !== taskB1.page_ref_fingerprint && taskA2.page_id_fingerprint !== null &&
    taskB1.page_id_fingerprint !== null && taskA2.page_id_fingerprint !== taskB1.page_id_fingerprint;
  const distinctRuns = taskA2.run_fingerprint !== taskB1.run_fingerprint;
  assert.ok(distinctSessions && distinctPages && distinctRuns, 'cross_profile_runtime_identity_not_isolated');
  evidence.steps.cross_profile_storage = { state: 'verified', B_initial_count: taskB1.before.stored_count,
    A_count_after_B: aUnaffectedByB.stored_count, distinct_sessions: distinctSessions, distinct_pages: distinctPages, distinct_runs: distinctRuns,
    control_lease_isolation: 'unknown' };
  currentStep = 'stop_B1'; await stopInstance('B');
  currentStep = 'stop_A2_start_A3'; await stopInstance('A');
  sessionA = await startInstance('A3', profileA, grantA, `${origin}/fixture`);
  const afterA3 = await readEnvironment('A3', profileA, grantA); await recordEnvironmentTransition(initial, afterA3, 'A1_to_A3');
  const taskA3 = await runTask('A', profileA, grantA, sessionA, 'A3', 2, 3);
  currentStep = 'stop_A3_runtime_restart'; await stopInstance('A');
  await runJson('runtime-stop-for-restart', ['stop', '--data-dir', ownerData]); runtimeStarted = false; runtimeStartAttempted = false; active.clear();
  const oldHarborPid = harborPid;
  await waitForPid(oldHarborPid, false, 'old_harbor');
  currentStep = 'runtime_restart';
  runtimeStartAttempted = true;
  await runJson('runtime-start-after-restart', ['start', '--data-dir', ownerData]); runtimeStarted = true;
  const restartedStatus = await runJson('runtime-diagnose-after-restart', ['diagnose', '--data-dir', ownerData]);
  assert.equal(restartedStatus.ready, true, 'runtime_not_ready_after_restart');
  harborPid = Number(restartedStatus.services?.find(service => service.id === 'harbor')?.pid);
  assert.ok(Number.isSafeInteger(harborPid) && harborPid > 0 && harborPid !== oldHarborPid, 'runtime_pid_not_replaced');
  currentStep = 'start_A4';
  sessionA = await startInstance('A4', profileA, grantA, `${origin}/fixture`);
  const afterRuntime = await readEnvironment('A4-runtime-restart', profileA, grantA);
  await recordEnvironmentTransition(initial, afterRuntime, 'A1_to_A4_after_runtime_restart');
  const finalPage = await observeAndSnapshot('A4-final', profileA, grantA, sessionA);
  const finalRead = await readPage('A4-final-storage-read', profileA, grantA, sessionA, finalPage.page);
  succeeded(finalRead.value, 'A4_final_read');
  const finalSummary = viewSummary(readText(finalRead.value, 'A4_final_read'));
  assert.equal(finalSummary.stored_count, 3, 'storage_not_continuous_after_runtime_restart');
  assert.equal(finalSummary.latest, 'A3', 'storage_latest_not_continuous_after_runtime_restart');
  evidence.continuity = { same_A_profile_label: true, instance_restarts: 2, runtime_restart: true,
    storage_count_after_runtime_restart: finalSummary.stored_count,
    bundle_hash_match_all_A_reads: evidence.environment_comparisons.every(item => item.bundle_hash_match),
    environment_drift_states: evidence.environment_reads.filter(item => item.profile === 'A').map(item => item.drift?.state ?? 'unknown'),
    not_a_marker_only_check: true };
  evidence.short_task_attempts = [taskA1, taskA2, taskA3];
  evidence.dimensions = {
    long_term_environment_continuity: 'restricted', profile_isolation: 'restricted',
    automation_exposure: 'continue_investigation', operation_and_recovery: 'restricted', performance_and_resources: 'restricted'
  };
  evidence.limits = ['Local fixture only; no authorized third-party site or account.',
    'Provider readback reports multiple environment fields as unknown; no product collection was added.',
    'Fixture exposes limited navigator and trusted-input signals; this is not an undetectability claim.',
    'No Network/visual route, viewer handoff, model, file path, or real site was exercised.',
    'Isolation of raw data roots, separate Context internals, environment-material path and ControlLease mutation remains unknown.',
    'Performance samples are three local fixture attempts, not an SLA; ps captures point-in-time process RSS/CPU only.'];
  evidence.revalidation_triggers = ['Provider/browser/Playwright source, hash or version changes', 'OS/architecture/display/install entry changes',
    'Profile environment/bundle/seed/configuration changes', 'Harbor launch/Page/ControlLease/Run/unknown recovery changes',
    'Network/viewer/main-world/input/wait path changes', 'meaningful resource, output, failure, challenge or site-condition changes'];
  evidence.state = 'observations_completed'; evidence.completed_at = new Date().toISOString();
  await persist();
}

try {
  await main();
} catch (error) {
  evidence.state = error?.code === 'live_budget_exhausted' ? 'budget_exhausted' : 'failed';
  evidence.failed_step = currentStep;
  evidence.failure_code = error?.code ?? (error?.name === 'AssertionError' ? 'measurement_assertion_failed' : 'unexpected_error');
  if (currentAttempt?.outcome === 'running') {
    const lastCall = calls.at(-1);
    currentAttempt.outcome = ['unknown', 'manual_recovery_required'].includes(lastCall?.outcome) ? lastCall.outcome : 'failed';
    currentAttempt.failure_code = evidence.failure_code;
    currentAttempt.completed_at = new Date().toISOString();
  }
  evidence.failed_at = new Date().toISOString();
  await persist().catch(() => {});
} finally {
  evidence.cleanup = await cleanup();
  evidence.completed_at ??= new Date().toISOString();
  await persist().catch(() => {});
}
console.log(JSON.stringify({ state: evidence.state, evidence: evidencePath,
  candidate: evidence.candidate, provider: evidence.provider, starts: evidence.starts, attempts: evidence.attempts.map(item => ({ profile: item.profile, task: item.task, outcome: item.outcome, duration_ms: item.duration_ms ?? null })),
  cleanup: evidence.cleanup, failure_code: evidence.failure_code ?? null }));
if (evidence.state !== 'observations_completed' || Object.values(evidence.cleanup?.instances ?? {}).some(value => value !== 'stopped' && value !== 'not_active') ||
  (typeof evidence.cleanup?.runtime === 'object') || (typeof evidence.cleanup?.local_origin === 'object')) process.exitCode = 1;
