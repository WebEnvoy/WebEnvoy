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
let liveObscura = false;
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
  assert.equal((await localRequest(data, '/agent-access', { credential: client.credential })).error.code, 'owner_authentication_required');
  const owner = JSON.parse(await readFile(join(data, 'owner.json'), 'utf8'));
  const ownerCall = async (path, body) => (await fetch(first.coreEndpoint + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.credential}` }, body: JSON.stringify(body) })).json();
  const registered = await ownerCall('/agent-access/principals', { idempotency_key: 'aux-register', display_name: 'Auxiliary connector check', credential_hash: createHash('sha256').update(client.credential).digest('hex') });
  const granted = await ownerCall('/agent-access/grants', { idempotency_key: 'aux-grant', principal_id: registered.principal.principal_id, profile_refs: [], allowed_operations: ['profile.list'], allowed_origins: [], expires_at: new Date(Date.now() + 60000).toISOString(), max_created_profiles: 0, creation_template: null });
  let connector = mcp();
  const connected = await connector.call('webenvoy_connect');
  assert.equal(connected.grants[0].grant_id, granted.grant.grant_id);
  const submitted = await connector.call('webenvoy_operation', { idempotency_key: 'lost-response', grant_id: granted.grant.grant_id, operation: 'profile.list', task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] } });
  assert.equal(submitted.ok, true);
  const bundle = await verifyBundle();
  if (bundle.obscura.state === 'verified' && bundle.obscura.validation_private_network) {
    connector = await runObscuraLiveCheck({ connector, owner, first, ownerCall });
    liveObscura = true;
  }
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
  assert.equal(restarted.assets.optional_website_assets.state, 'unavailable');
  await rename(sites + '.held', sites);
  assert.equal((await verifyBundle()).integrity, 'verified');
  console.log(`Installed auxiliary checks passed: startup/discovery, unregistered/owner denial, required missing/corrupt/version refusal and recovery, optional website isolation, occupied endpoint fail-closed/recovery, explicit stop/restart.${liveObscura ? ' Installed Obscura also passed MCP create/edit/save/restart/readback and dispatched-unknown query-without-replay.' : ' No live Provider or host evidence claimed.'}`);
} finally {
  if (running) await cli('stop');
  await rm(directory, { recursive: true, force: true });
}

async function runObscuraLiveCheck({ connector, owner, first, ownerCall }) {
  const recordPath = join(directory, 'controlled-record.json');
  let obscuraPid;
  const controlled = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/save') {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) throw new Error('body_too_large'); chunks.push(chunk); }
        const previous = JSON.parse(await readFile(recordPath, 'utf8'));
        const record = { text: Buffer.concat(chunks).toString('utf8'), version: previous.version + 1, writes: previous.writes + 1 };
        await writeFile(recordPath, JSON.stringify(record));
        res.end(JSON.stringify(record));
        if (req.headers['x-webenvoy-drop-response'] === '1' && obscuraPid) process.kill(obscuraPid, 'SIGKILL');
        return;
      }
      const record = JSON.parse(await readFile(recordPath, 'utf8'));
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta charset=utf-8><title>Obscura</title><input aria-label="内容"><button id="save">保存</button><button id="drop">保存并丢失响应</button><p id="draft"></p><p id="status">记录：${record.text || '空'} 版本:${record.version} 写入:${record.writes}</p><script>
const input=document.querySelector('input'),draft=document.querySelector('#draft'),status=document.querySelector('#status');input.value=localStorage.getItem('draft')||'';draft.textContent='草稿：'+(input.value||'空');document.title+='|'+(localStorage.getItem('draft')||'missing');input.addEventListener('input',()=>{localStorage.setItem('draft',input.value);draft.textContent='草稿：'+input.value});document.querySelector('#save').onclick=async()=>{const r=await fetch('/save',{method:'POST',body:input.value});const v=await r.json();status.textContent='记录：'+v.text+' 版本:'+v.version+' 写入:'+v.writes};document.querySelector('#drop').onmousedown=()=>{fetch('/save',{method:'POST',headers:{'x-webenvoy-drop-response':'1'},body:input.value});const end=Date.now()+5000;while(Date.now()<end){}};
</script>`);
    } catch { res.statusCode = 500; res.end('failed'); }
  });
  await writeFile(recordPath, JSON.stringify({ text: '', version: 0, writes: 0 }));
  await new Promise((resolve, reject) => controlled.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${controlled.address().port}`;
  try {
    const policy = await fetch(first.coreEndpoint + '/agent-access/management-policy', { method: 'PUT', headers: { authorization: `Bearer ${owner.credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: 'obscura-live-policy', expected_source_version: null, modes: { read: 'auto', prepare: 'auto', commit: 'auto' } }) });
    assert.equal(policy.status, 200, await policy.text());
    const operations = ['profile.create','profile.read','instance.start','instance.stop','instance.snapshot','instance.input','instance.click','instance.wait'];
    const permissionOperations = operations.filter(operation => operation !== 'profile.create');
    const principalId = (await connector.call('webenvoy_connect')).connection.principal_id;
    const grant = await ownerCall('/agent-access/grants', { idempotency_key: 'obscura-live-grant', principal_id: principalId, profile_refs: [], allowed_operations: operations, allowed_origins: [origin], expires_at: new Date(Date.now() + 3600000).toISOString(), max_created_profiles: 3, creation_template: { template_ref: 'template:obscura-live', provider_id: 'obscura', site: { site_id: 'controlled-obscura', origin, display_name: 'Controlled Obscura' }, language: 'en-US', timezone: 'Asia/Shanghai', permission_ceiling: { allowed_operations: permissionOperations, allowed_origins: [origin], controlled_interaction_origins: [origin] } } });
    const scope = profileRefs => ({ operations, profile_refs: profileRefs, origins: [origin] });
    const created = await connector.call('webenvoy_operation', { idempotency_key: 'obscura-live-create', grant_id: grant.grant.grant_id, operation: 'profile.create', template_ref: 'template:obscura-live', task_scope: scope([]) });
    assert.equal(created.status, 'succeeded', JSON.stringify(created));
    const profileRef = created.result.profile.profile_ref;
    const start = await connector.call('webenvoy_operation', { idempotency_key: 'obscura-live-start', grant_id: grant.grant.grant_id, operation: 'instance.start', profile_ref: profileRef, origin, url: origin + '/', task_scope: scope([profileRef]) });
    assert.equal(start.status, 'succeeded', JSON.stringify(start));
    let sessionRef = start.result.session.runtime_session_ref;
    let snapshot = await operation('obscura-live-snapshot', 'instance.snapshot', { runtime_session_ref: sessionRef });
    let textbox = snapshot.result.snapshot.controls.find(control => control.role === 'textbox');
    let input = await operation('obscura-live-input', 'instance.input', { runtime_session_ref: sessionRef, page_ref: snapshot.result.snapshot.page_ref, observation_ref: snapshot.result.snapshot.observation_ref, target_ref: textbox.target_ref, text: '已安装链路' });
    let save = input.result.snapshot.controls.find(control => control.name === '保存');
    await operation('obscura-live-save', 'instance.click', { runtime_session_ref: sessionRef, page_ref: input.result.snapshot.page_ref, observation_ref: input.result.snapshot.observation_ref, target_ref: save.target_ref });
    let savedText = '';
    for (let attempt = 0; attempt < 20 && !savedText.includes('写入:1'); attempt++) {
      const readback = await operation(`obscura-live-save-readback-${attempt}`, 'instance.snapshot', { runtime_session_ref: sessionRef });
      savedText = readback.result.snapshot.text;
      if (!savedText.includes('写入:1')) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(savedText, /记录：已安装链路 版本:1 写入:1/);
    assert.equal((await operation('obscura-live-stop', 'instance.stop', { runtime_session_ref: sessionRef })).status, 'succeeded');
    const restarted = await operation('obscura-live-restart', 'instance.start', { url: origin + '/' });
    sessionRef = restarted.result.session.runtime_session_ref;
    assert.match(restarted.result.session.current_page.title, /Obscura\|已安装链路/);
    snapshot = await operation('obscura-live-restart-snapshot', 'instance.snapshot', { runtime_session_ref: sessionRef });
    assert.match(snapshot.result.snapshot.text, /记录：已安装链路 版本:1 写入:1/);
    const liveSessions = [{ profileRef, sessionRef, expected: '已安装链路' }];
    for (const [index, expected] of ['合成身份二', '合成身份三'].entries()) {
      const createdProfile = await connector.call('webenvoy_operation', { idempotency_key: `obscura-live-create-${index + 2}`, grant_id: grant.grant.grant_id, operation: 'profile.create', template_ref: 'template:obscura-live', task_scope: scope([]) });
      assert.equal(createdProfile.status, 'succeeded', JSON.stringify(createdProfile));
      const nextProfileRef = createdProfile.result.profile.profile_ref;
      const startedProfile = await connector.call('webenvoy_operation', { idempotency_key: `obscura-live-start-${index + 2}`, grant_id: grant.grant.grant_id, operation: 'instance.start', profile_ref: nextProfileRef, origin, url: origin + '/', task_scope: scope([nextProfileRef]) });
      assert.equal(startedProfile.status, 'succeeded', JSON.stringify(startedProfile));
      const nextSessionRef = startedProfile.result.session.runtime_session_ref;
      const initial = await operationFor(`obscura-live-snapshot-${index + 2}`, 'instance.snapshot', nextProfileRef, nextSessionRef);
      assert.match(initial.result.snapshot.text, /草稿：空/);
      const target = initial.result.snapshot.controls.find(control => control.role === 'textbox');
      const entered = await operationFor(`obscura-live-input-${index + 2}`, 'instance.input', nextProfileRef, nextSessionRef, { page_ref: initial.result.snapshot.page_ref, observation_ref: initial.result.snapshot.observation_ref, target_ref: target.target_ref, text: expected });
      assert.match(entered.result.snapshot.text, new RegExp(`草稿：${expected}`));
      liveSessions.push({ profileRef: nextProfileRef, sessionRef: nextSessionRef, expected });
    }
    const reused = await operation('obscura-live-same-profile-start', 'instance.start', { url: origin + '/' });
    assert.equal(reused.result.session.runtime_session_ref, sessionRef);
    const camoufoxGrant = await ownerCall('/agent-access/grants', { idempotency_key: 'camoufox-live-grant', principal_id: principalId, profile_refs: [], allowed_operations: operations, allowed_origins: [origin], expires_at: new Date(Date.now() + 3600000).toISOString(), max_created_profiles: 1, creation_template: { template_ref: 'template:camoufox-live', provider_id: 'camoufox', site: { site_id: 'controlled-camoufox', origin, display_name: 'Controlled Camoufox' }, language: 'en-US', timezone: 'UTC', permission_ceiling: { allowed_operations: permissionOperations, allowed_origins: [origin], controlled_interaction_origins: [origin] } } });
    const camoufoxCreated = await connector.call('webenvoy_operation', { idempotency_key: 'camoufox-live-create', grant_id: camoufoxGrant.grant.grant_id, operation: 'profile.create', template_ref: 'template:camoufox-live', task_scope: scope([]) });
    assert.equal(camoufoxCreated.status, 'succeeded', JSON.stringify(camoufoxCreated));
    const camoufoxProfileRef = camoufoxCreated.result.profile.profile_ref;
    const camoufoxScope = { operations, profile_refs: [camoufoxProfileRef], origins: [origin] };
    const camoufoxStarted = await connector.call('webenvoy_operation', { idempotency_key: 'camoufox-live-start', grant_id: camoufoxGrant.grant.grant_id, operation: 'instance.start', profile_ref: camoufoxProfileRef, origin, url: origin + '/', task_scope: camoufoxScope });
    assert.equal(camoufoxStarted.status, 'succeeded', JSON.stringify(camoufoxStarted));
    const camoufoxSessionRef = camoufoxStarted.result.session.runtime_session_ref;
    let camoufoxInput;
    for (let attempt = 0; attempt < 3 && camoufoxInput?.status !== 'succeeded'; attempt++) {
      const camoufoxSnapshot = await camoufoxOperation(`camoufox-live-snapshot-${attempt}`, 'instance.snapshot');
      const camoufoxTarget = camoufoxSnapshot.result.snapshot.controls.find(control => control.role === 'textbox');
      camoufoxInput = await connector.call('webenvoy_operation', { idempotency_key: `camoufox-live-input-${attempt}`, grant_id: camoufoxGrant.grant.grant_id, operation: 'instance.input', profile_ref: camoufoxProfileRef, origin, runtime_session_ref: camoufoxSessionRef, task_scope: camoufoxScope, page_ref: camoufoxSnapshot.result.snapshot.page_ref, observation_ref: camoufoxSnapshot.result.snapshot.observation_ref, target_ref: camoufoxTarget.target_ref, text: 'Camoufox并存' });
      if (camoufoxInput.status !== 'succeeded') assert.equal(camoufoxInput.result?.failure_class, 'managed_interaction_stale_target', JSON.stringify(camoufoxInput));
    }
    assert.equal(camoufoxInput?.status, 'succeeded', JSON.stringify(camoufoxInput));
    assert.match(camoufoxInput.result.snapshot.text, /草稿：Camoufox并存/);
    await soak([...liveSessions, { profileRef: camoufoxProfileRef, sessionRef: camoufoxSessionRef, expected: 'Camoufox并存' }]);
    snapshot = await operation('obscura-live-post-soak-snapshot', 'instance.snapshot', { runtime_session_ref: sessionRef });
    textbox = snapshot.result.snapshot.controls.find(control => control.role === 'textbox');
    input = await operation('obscura-live-lost-input', 'instance.input', { runtime_session_ref: sessionRef, page_ref: snapshot.result.snapshot.page_ref, observation_ref: snapshot.result.snapshot.observation_ref, target_ref: textbox.target_ref, text: '第二版' });
    const drop = input.result.snapshot.controls.find(control => control.name === '保存并丢失响应');
    const processes = await run('/bin/ps', ['-axo', 'pid=,command=']);
    const line = processes.stdout.split('\n').find(value => value.includes('obscura serve') && value.includes(join(directory, 'data', 'profiles')));
    obscuraPid = Number(line?.trim().split(/\s+/, 1)[0]);
    assert(Number.isSafeInteger(obscuraPid));
    const lostInput = { idempotency_key: 'obscura-live-lost-save', grant_id: grant.grant.grant_id, operation: 'instance.click', profile_ref: profileRef, origin, runtime_session_ref: sessionRef, page_ref: input.result.snapshot.page_ref, observation_ref: input.result.snapshot.observation_ref, target_ref: drop.target_ref, task_scope: scope([profileRef]) };
    const lost = await connector.call('webenvoy_operation', lostInput);
    assert.equal(lost.status, 'unknown_outcome', JSON.stringify(lost));
    assert.equal(lost.dispatch_state, 'dispatched');
    await connector.close();
    const reconnected = mcp();
    await reconnected.call('webenvoy_connect');
    const queried = await reconnected.call('webenvoy_query', { idempotency_key: lostInput.idempotency_key });
    assert.equal(queried.status, 'unknown_outcome');
    assert.equal(queried.dispatch_state, 'dispatched');
    assert.equal((await reconnected.call('webenvoy_operation', lostInput)).error.code, 'managed_browser_idempotency_conflict');
    assert.deepEqual(JSON.parse(await readFile(recordPath, 'utf8')), { text: '已安装链路第二版', version: 2, writes: 2 });
    return reconnected;

    async function operation(idempotency_key, operation, extra) {
      const result = await connector.call('webenvoy_operation', { idempotency_key, grant_id: grant.grant.grant_id, operation, profile_ref: profileRef, origin, task_scope: scope([profileRef]), ...extra });
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      return result;
    }
    async function operationFor(idempotency_key, operation, targetProfileRef, targetSessionRef, extra = {}) {
      const result = await connector.call('webenvoy_operation', { idempotency_key, grant_id: grant.grant.grant_id, operation, profile_ref: targetProfileRef, origin, runtime_session_ref: targetSessionRef, task_scope: scope([targetProfileRef]), ...extra });
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      return result;
    }
    async function camoufoxOperation(idempotency_key, operation, extra = {}) {
      const result = await connector.call('webenvoy_operation', { idempotency_key, grant_id: camoufoxGrant.grant.grant_id, operation, profile_ref: camoufoxProfileRef, origin, runtime_session_ref: camoufoxSessionRef, task_scope: camoufoxScope, ...extra });
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      return result;
    }
    async function soak(sessions) {
      const minutes = Number(process.env.WEBENVOY_OBSCURA_SOAK_MINUTES ?? 0);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 30) throw new Error('WEBENVOY_OBSCURA_SOAK_MINUTES must be 0-30');
      if (!minutes) return;
      const startedAt = Date.now(), deadline = startedAt + minutes * 60000, samples = [];
      for (let index = 0; Date.now() < deadline; index++) {
        const sampleStarted = Date.now();
        for (const [sessionIndex, session] of sessions.entries()) {
          const result = sessionIndex === sessions.length - 1
            ? await camoufoxOperation(`obscura-soak-${index}-${sessionIndex}`, 'instance.snapshot')
            : await operationFor(`obscura-soak-${index}-${sessionIndex}`, 'instance.snapshot', session.profileRef, session.sessionRef);
          assert.match(result.result.snapshot.text, new RegExp(`草稿：${session.expected}`));
        }
        const tree = await processTree(first.pid);
        samples.push({ elapsed_ms: Date.now() - startedAt, response_ms: Date.now() - sampleStarted, rss_kib: tree.rss_kib, process_count: tree.process_count });
        const remaining = deadline - Date.now();
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(60000, remaining)));
      }
      console.log(JSON.stringify({ obscura_soak: { requested_minutes: minutes, actual_ms: Date.now() - startedAt, samples, errors: 0 } }));
    }
  } finally {
    await new Promise(resolve => controlled.close(resolve));
  }
}

async function processTree(rootPid) {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,command=']);
  const rows = stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]) }] : [];
  });
  const pids = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (pids.has(row.ppid) && !pids.has(row.pid)) { pids.add(row.pid); changed = true; }
  }
  return { process_count: pids.size, rss_kib: rows.filter(row => pids.has(row.pid)).reduce((sum, row) => sum + row.rss, 0) };
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
