import assert from 'node:assert/strict';
import { chmod, copyFile, cp, lstat, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import test from 'node:test';
import definitions from '../../../packages/core/src/managed-capability-definitions.json' with { type: 'json' };
import { validateManagedTaskRequest, validateOperationRequest } from './request-validation.mjs';
import { INSTALLED_AGENT_MANIFEST_SCHEMA, INSTALLED_SKILL_VERSION, REQUIRED_AGENT_ASSETS, REQUIRED_DRIVER_ASSETS, sha, verifyBundle } from './bundle.mjs';

const entryRoot = dirname(fileURLToPath(import.meta.url));
const cliPath = join(entryRoot, 'cli.mjs');
const installationLink = join(entryRoot, '../webenvoy-installation.json');

test('installed bundle version tracks the installed SKILL metadata and both package manifests', async () => {
  const skill = await readFile(join(entryRoot, 'skills/webenvoy-browser/SKILL.md'), 'utf8');
  assert.equal(skill.match(/^metadata:\s*\n\s+version:\s*([^\s]+)\s*$/m)?.[1], INSTALLED_SKILL_VERSION);
  for (const file of ['../scripts/package-agent.mjs', '../scripts/package-standalone.mjs']) {
    const source = await readFile(join(entryRoot, file), 'utf8');
    assert.match(source, /skill_version:\s*INSTALLED_SKILL_VERSION/);
  }
});

async function runCli(args, targetCliPath = cliPath) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [targetCliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => resolveResult({ code, stdout, stderr }));
  });
}

async function withInvalidOwnerLink(callback) {
  let previous;
  try { previous = await readFile(installationLink); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(installationLink, 'owner-only-invalid-json', { mode: 0o600 });
  try { return await callback(); }
  finally {
    if (previous) await writeFile(installationLink, previous, { mode: 0o600 });
    else await unlink(installationLink).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function writeAgentClient(dir) {
  const clientPath = join(dir, 'webenvoy-client.json');
  await writeFile(clientPath, JSON.stringify({ data_dir: join(dir, 'owner-data'), credential: 'a'.repeat(32), agent_endpoint: join(dir, 'agent.sock'), owner_uid: 1, agent_uid: 2 }), { mode: 0o600 });
  return clientPath;
}

test('shared operation validator rejects unknown fields before dispatch', () => {
  const valid = { idempotency_key: 'key', grant_id: 'grant', operation: 'profile.list', task_scope: { operations: ['profile.list'], profile_refs: [], origins: [] } };
  assert.deepEqual(validateOperationRequest(valid, definitions), valid);
  assert.throws(() => validateOperationRequest({ ...valid, owner_secret: 'nope' }, definitions), /operation_input_refused/);
});

test('managed-task CLI validator accepts only the fixed S2 envelope and operation scope', () => {
  const common = {
    schema_version: 'webenvoy.managed-task-operation/v1', grant_id: 'grant:fixture',
    task_scope: { operations: ['task.submit'], skill_refs: ['lode://site-skill/example/catalog'], source_refs: ['lode://site-skill/example/catalog@1.0.0#commit'], profile_refs: [], origins: [] },
    idempotency_key: 'task-key', package: { package_ref: 'lode://site-skill/example/catalog', revision_ref: 'lode://site-skill/example/catalog@1.0.0#commit', package_digest: `sha256:${'a'.repeat(64)}`, task_ref: 'catalog-read' },
    target: { target_type: 'catalog_page', target_ref: 'target:catalog' }, input: { schema_ref: 'lode://schema/example/catalog-read@1.0.0', carrier: 'none' },
    intent: { summary: 'Read the catalog.', policy: { risk: 'read', execution_intent: 'read' } }
  };
  assert.deepEqual(validateManagedTaskRequest({ ...common, operation: 'task.submit' }), { ...common, operation: 'task.submit' });
  const publicRead = { ...common, target: undefined,
    task_scope: { operations: ['task.submit'], skill_refs: ['lode://site-skill/github/opencli-trending-repos'],
      source_refs: ['lode://site-skill/github/opencli-trending-repos@0.1.0#0123456789abcdef0123456789abcdef01234567'],
      profile_refs: ['profile:public-read'], origins: ['https://github.com'] },
    package: { package_ref: 'lode://site-skill/github/opencli-trending-repos',
      revision_ref: 'lode://site-skill/github/opencli-trending-repos@0.1.0#0123456789abcdef0123456789abcdef01234567',
      package_digest: `sha256:${'b'.repeat(64)}`, task_ref: 'read-trending' },
    input: { schema_ref: 'lode://schema/github/opencli-trending-input@0.1.0', carrier: 'webenvoy.managed-task-inline/v1', value: { since: 'daily' } } };
  delete publicRead.target;
  assert.deepEqual(validateManagedTaskRequest({ ...publicRead, operation: 'task.submit' }), { ...publicRead, operation: 'task.submit' },
    'the installed CLI task envelope permits a pinned public-origin task without a fabricated Page target');
  assert.throws(() => validateManagedTaskRequest({ ...common, operation: 'task.submit', connection_id: 'connection:caller' }), /managed_task_invalid_input/);
  assert.throws(() => validateManagedTaskRequest({ ...common, schema_version: 'webenvoy.managed-task-operation/v2', operation: 'task.submit' }), /managed_task_version_unsupported/);
  assert.throws(() => validateManagedTaskRequest({ ...common, operation: 'task.submit', task_scope: { ...common.task_scope, operations: ['task.query'] } }), /managed_task_invalid_input/);
  const query = { schema_version: common.schema_version, operation: 'task.query', grant_id: common.grant_id, task_scope: { ...common.task_scope, operations: ['task.query'] }, selector: { original_idempotency_key: 'task-key' } };
  assert.deepEqual(validateManagedTaskRequest(query), query);
  assert.throws(() => validateManagedTaskRequest({ ...query, selector: { run_id: 'run:a', original_idempotency_key: 'task-key' } }), /managed_task_invalid_input/);
});

test('Agent CLI does not read owner installation link before validating request', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-agent-input-'));
  try {
    const clientPath = await writeAgentClient(dir);
    const requestPath = join(dir, 'request.json');
    await writeFile(requestPath, '{not-json');
    const result = await withInvalidOwnerLink(() => runCli(['agent', 'recovery', '--client-file', clientPath, '--request-file', requestPath]));
    assert.equal(result.code, 2);
    assert.deepEqual(JSON.parse(result.stderr).error.code, 'recovery_input_refused');
    assert.equal(result.stdout, '');
    await assert.rejects(lstat(join(dir, 'agent.sock')), error => error.code === 'ENOENT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Agent task CLI rejects caller-supplied connection context before connecting', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-agent-task-input-'));
  try {
    const clientPath = await writeAgentClient(dir);
    const requestPath = join(dir, 'request.json');
    await writeFile(requestPath, JSON.stringify({
      schema_version: 'webenvoy.managed-task-operation/v1', operation: 'task.submit', idempotency_key: 'catalog-read-001', grant_id: 'grant:fixture', connection_id: 'connection:caller',
      task_scope: { operations: ['task.submit'], skill_refs: ['lode://site-skill/controlled-local/page-summary'], source_refs: ['lode://site-skill/controlled-local/page-summary@1.0.0#commit'], profile_refs: [], origins: [] },
      package: { package_ref: 'lode://site-skill/controlled-local/page-summary', revision_ref: 'lode://site-skill/controlled-local/page-summary@1.0.0#commit', package_digest: `sha256:${'a'.repeat(64)}`, task_ref: 'read-page-summary' },
      target: { target_type: 'web_page', target_ref: 'target:catalog-fixture' },
      input: { schema_ref: 'lode://schema/site-skill/controlled-local/page-summary/input@1.0.0', carrier: 'none' },
      intent: { summary: 'Read the catalog page summary.', policy: { risk: 'read', execution_intent: 'read' } }
    }));
    const result = await runCli(['agent', 'task', 'submit', '--client-file', clientPath, '--request-file', requestPath]);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).error.code, 'managed_task_invalid_input');
    assert.equal(result.stdout, '');
    await assert.rejects(lstat(join(dir, 'agent.sock')), error => error.code === 'ENOENT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI describes trusted local mode without claiming OS isolation', async () => {
  const setup = await runCli(['help', 'setup']);
  const agentSetup = await runCli(['help', 'agent', 'setup']);
  assert.equal(setup.code, 0);
  assert.match(setup.stdout, /setup --data-dir OWNER_DIR \[--agent-uid UID\]/);
  assert.match(setup.stdout, /omitting --agent-uid defaults to the\s+owner UID/);
  assert.match(setup.stdout, /trusted local mode/);
  assert.match(setup.stdout, /same-UID processes are not\s+OS-isolated/);
  assert.equal(agentSetup.code, 0);
  assert.match(agentSetup.stdout, /provides no OS isolation/);
});

test('Agent describe help documents its JSON request shape', async () => {
  const describe = await runCli(['help', 'agent', 'describe']);
  assert.equal(describe.code, 0);
  assert.match(describe.stdout, /Usage: webenvoy agent describe --client-file FILE --request-file FILE/);
  assert.match(describe.stdout, /\{"operation":"profile\.create"\}/);
});

test('owner v2 Grant CLI accepts and forwards selected BusinessTarget Accounts to Core', async () => {
  const temporary = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'wsa-bt-'));
  const bundleRoot = join(temporary, 'bundle');
  const ownerDataDir = temporary;
  const socketPath = join(ownerDataDir, 'owner-control.sock');
  const sourceAppRoot = dirname(entryRoot);
  const files = [
    'agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs',
    'agent-entry/skills/webenvoy-browser/SKILL.md',
    'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs',
    ...REQUIRED_AGENT_ASSETS, ...REQUIRED_DRIVER_ASSETS
  ];
  const requests = [];
  let assets;
  const input = {
    idempotency_key: 'business-target-grant-once', principal_id: 'principal:agent',
    profile_refs: ['profile:business-target'], policy_digest: `sha256:${'c'.repeat(64)}`,
    allowed_operations: ['business_target.create', 'business_target.list'], allowed_origins: [],
    expires_at: '2026-10-01T00:00:00.000Z',
    account_scope_selections: [{ account_system_ref: 'account-system:example', account_ref: `account:sha256:${'a'.repeat(64)}` }]
  };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    requests.push({ path: request.url, method: request.method, ...(body === undefined ? {} : { body }) });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/status' ? { ready: true, assets: { digest: assets.digest } }
      : { ok: true, result: { grant_id: 'grant:business-target', business_target_account_scopes: input.account_scope_selections.map(scope => ({ profile_ref: 'profile:business-target', ...scope })) } }));
  });
  try {
    await mkdir(bundleRoot, { recursive: true });
    await cp(entryRoot, join(bundleRoot, 'agent-entry'), { recursive: true, dereference: true });
    for (const name of files.filter(path => path.startsWith('dist-electron/'))) {
      const destination = join(bundleRoot, name);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceAppRoot, name), destination);
    }
    const manifestFiles = Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await readFile(join(bundleRoot, name)))])));
    await writeFile(join(bundleRoot, 'agent-manifest.json'), JSON.stringify({ schema: INSTALLED_AGENT_MANIFEST_SCHEMA, version: '0.0.0-test',
      skill_version: INSTALLED_SKILL_VERSION, files: manifestFiles, optional_files: {} }));
    assets = await verifyBundle(bundleRoot);
    await mkdir(ownerDataDir, { recursive: true, mode: 0o700 });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const grantFile = join(temporary, 'grant.json');
    await writeFile(grantFile, JSON.stringify(input), { mode: 0o600 });
    const result = await runCli(['access', 'grant-v2', '--data-dir', ownerDataDir, '--grant-file', grantFile, '--confirm'], join(bundleRoot, 'agent-entry/cli.mjs'));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).result.business_target_account_scopes, input.account_scope_selections.map(scope => ({ profile_ref: 'profile:business-target', ...scope })));
    assert.deepEqual(requests, [
      { path: '/status', method: 'GET' },
      { path: '/agent-access/v2/grants', method: 'POST', body: input }
    ], 'the exact selected tuple reaches the existing owner Grant route unchanged');
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});

test('owner list, diagnose and inspect use live reads without Runtime startup', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-owner-read-'));
  const socketPath = join(dir, 'owner-control.sock');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    let payload = { ready: true, assets: { digest: 'fixture' }, pid: process.pid, services: [] };
    if (request.url === '/runtime/sessions') payload = { schema_version: 'harbor-runtime-session-list/v1', sessions: [{ runtime_session_ref: 'demo', profile_ref: 'profile:demo', control_owner: 'none', control_generation: 0, control_lock: { owner: 'none', state: 'released', holder_ref: null } }] };
    if (request.url === '/runtime/sessions/demo') payload = { runtime_session_ref: 'demo', control_owner: 'none', control_generation: 0, control_lock: { owner: 'none', state: 'released', holder_ref: null } };
    if (request.url === '/owner/runtime-sessions/demo/runs') payload = { schema_version: 'webenvoy.owner-session-runs/v1', runtime_session_ref: 'demo', status: 'available', runs: [] };
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(payload));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const list = await runCli(['instance', 'list', '--data-dir', dir]);
    const diagnose = await runCli(['diagnose', '--data-dir', dir]);
    const inspect = await runCli(['instance', 'inspect', '--data-dir', dir, '--runtime-session-ref', 'demo']);
    assert.equal(list.code, 0);
    assert.equal(diagnose.code, 0);
    assert.equal(inspect.code, 0);
    assert.deepEqual(requests, ['/runtime/sessions', '/owner/runtime-sessions/demo/runs', '/status', '/runtime/sessions/demo', '/owner/runtime-sessions/demo/runs']);
    assert.deepEqual(JSON.parse(list.stdout).sessions[0].supervision, { status: 'available', runs: [] });
    assert.deepEqual(JSON.parse(inspect.stdout).session.supervision, { status: 'available', runs: [] });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('owner stop preserves unavailable session outcomes with a nonzero exit', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-owner-stop-'));
  const socketPath = join(dir, 'owner-control.sock');
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    const failureClass = calls === 1 ? 'session_missing' : 'interaction_settling';
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 'unavailable', failure_class: failureClass, runtime_session_ref: 'demo' }));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const missing = await runCli(['instance', 'stop', '--data-dir', dir, '--runtime-session-ref', 'demo']);
    const settling = await runCli(['instance', 'stop', '--data-dir', dir, '--runtime-session-ref', 'demo']);
    assert.equal(missing.code, 5);
    assert.equal(settling.code, 5);
    assert.equal(JSON.parse(missing.stdout).failure_class, 'session_missing');
    assert.equal(JSON.parse(settling.stdout).failure_class, 'interaction_settling');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('Agent help exposes operation submission and durable query commands', async () => {
  const operation = await runCli(['help', 'agent', 'operation']);
  const query = await runCli(['help', 'agent', 'query']);
  assert.equal(operation.code, 0);
  assert.match(operation.stdout, /webenvoy agent operation --client-file FILE --request-file FILE/);
  assert.equal(query.code, 0);
  assert.match(query.stdout, /webenvoy agent query --client-file FILE \(--run-id RUN_ID\|--idempotency-key KEY\)/);
});

test('Agent task help documents the managed task API and recovery selector', async () => {
  const submit = await runCli(['help', 'agent', 'task', 'submit']);
  const query = await runCli(['help', 'agent', 'task', 'query']);
  const stop = await runCli(['help', 'agent', 'task', 'stop']);
  assert.equal(submit.code, 0);
  assert.match(submit.stdout, /POST\s+\/managed-tasks\/operations/);
  assert.match(submit.stdout, /Page tasks supply the current opaque Page target/);
  assert.match(submit.stdout, /program-side public-read tasks omit target/);
  assert.match(submit.stdout, /verified distinct non-admin\s+Agent UID/);
  assert.match(submit.stdout, /trusted_local refuses script dispatch/);
  assert.equal(query.code, 0);
  assert.match(query.stdout, /task\.submit idempotency key/);
  assert.match(query.stdout, /does not create or redispatch a Run/);
  assert.equal(stop.code, 0);
  assert.match(stop.stdout, /does\s+not\s+roll back effects already dispatched/);
});

test('owner AccountSystem CLI calls the Core owner API and keeps local refs on the owner path', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-account-system-'));
  const socketPath = join(dir, 'owner-control.sock');
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url, method: request.method, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, result: { definitions: [] } }));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const help = await runCli(['help', 'account-system']);
    const result = await runCli(['account-system', 'list', '--data-dir', dir]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /explicitly enable or roll\s+back/);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: { definitions: [] } });
    assert.deepEqual(requests, [{ path: '/owner/account-systems/operations', method: 'POST', body: {
      schema_version: 'webenvoy.account-system-owner-operation/v1', operation: 'list'
    } }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('owner account CLI inspects and explicitly binds through the Core owner route', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'webenvoy-cli-account-binding-'));
  const socketPath = join(dir, 'owner-control.sock');
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url, method: request.method, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, result: request.url.endsWith('/account-bindings/operations') && requests.at(-1).body.operation === 'inspect'
      ? { identity_environment_ref: 'identity:github', account_bindings: [], legacy_binding_present: false }
      : { identity_environment_ref: 'identity:github', account_binding: { account_system_ref: 'account-system:github', account_ref: `account:sha256:${'a'.repeat(64)}`, observation_ref: 'observation:github', bound_at: '2026-09-28T10:00:00.000Z' } } }));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const help = await runCli(['help', 'account']);
    const inspected = await runCli(['account', 'bindings', '--data-dir', dir, '--identity-environment-ref', 'identity:github']);
    const bound = await runCli(['account', 'bind', '--data-dir', dir, '--profile-ref', 'profile:github', '--identity-environment-ref', 'identity:github',
      '--runtime-session-ref', 'session:github', '--observation-ref', 'observation:github', '--account-system-ref', 'account-system:github',
      '--account-ref', `account:sha256:${'a'.repeat(64)}`, '--idempotency-key', 'bind-github-once-001', '--confirm']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Harbor rechecks the\s+same observation/);
    assert.equal(inspected.code, 0);
    assert.equal(bound.code, 0);
    assert.deepEqual(requests.map(({ path, method, body }) => ({ path, method, body })), [
      { path: '/owner/account-bindings/operations', method: 'POST', body: {
        schema_version: 'webenvoy.account-binding-owner-operation/v1', operation: 'inspect', identity_environment_ref: 'identity:github'
      } },
      { path: '/owner/account-bindings/operations', method: 'POST', body: {
        schema_version: 'webenvoy.account-binding-owner-operation/v1', operation: 'bind', identity_environment_ref: 'identity:github',
        profile_ref: 'profile:github', runtime_session_ref: 'session:github', observation_ref: 'observation:github',
        account_system_ref: 'account-system:github', account_ref: `account:sha256:${'a'.repeat(64)}`,
        idempotency_key: 'bind-github-once-001', confirm: true
      } }
    ]);
    const unconfirmed = await runCli(['account', 'bind', '--data-dir', dir, '--profile-ref', 'profile:github', '--identity-environment-ref', 'identity:github',
      '--runtime-session-ref', 'session:github', '--observation-ref', 'observation:github', '--account-system-ref', 'account-system:github',
      '--account-ref', `account:sha256:${'a'.repeat(64)}`, '--idempotency-key', 'bind-github-once-002']);
    assert.equal(unconfirmed.code, 2);
    assert.equal(JSON.parse(unconfirmed.stderr).error.code, 'account_binding_confirm_required');
    assert.equal(requests.length, 2, 'missing owner confirmation is refused before dispatch');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('owner site-task admission CLI sends owner Git inspection through Core and documents the lifecycle', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'wsa-'));
  const socketPath = join(dir, 'owner-control.sock');
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url, method: request.method, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, result: { candidate_ref: 'webenvoy:site-task-candidate/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#sha256:' + 'b'.repeat(64) } }));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    const help = await runCli(['help', 'site-task-admission']);
    const result = await runCli(['site-task-admission', 'inspect-candidate', '--data-dir', dir,
      '--repository-ref', 'webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--package-ref', 'lode://site-skill/github/trending',
      '--base-revision-ref', 'lode://site-skill/github/trending@1.0.0#' + 'c'.repeat(40),
      '--task-ref', 'read-daily-trending-top5']);
    const firstAdmission = await runCli(['site-task-admission', 'inspect-candidate', '--data-dir', dir,
      '--repository-ref', 'webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--package-ref', 'lode://site-skill/github/opencli-trending-repos', '--first-admission',
      '--task-ref', 'read-opencli-trending']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--first-admission/);
    assert.match(help.stdout, /Script code admission is a separate owner/);
    assert.equal(result.code, 0);
    assert.equal(firstAdmission.code, 0);
    assert.equal(JSON.parse(result.stdout).result.candidate_ref.startsWith('webenvoy:site-task-candidate/'), true);
    assert.equal(JSON.parse(firstAdmission.stdout).result.candidate_ref.startsWith('webenvoy:site-task-candidate/'), true);
    assert.deepEqual(requests, [{ path: '/owner/site-task-admissions/operations', method: 'POST', body: {
      schema_version: 'webenvoy.site-task-admission-owner-operation/v1', operation: 'inspect_candidate',
      repository_ref: 'webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      package_ref: 'lode://site-skill/github/trending',
      base_revision_ref: 'lode://site-skill/github/trending@1.0.0#' + 'c'.repeat(40), task_ref: 'read-daily-trending-top5'
    } }, { path: '/owner/site-task-admissions/operations', method: 'POST', body: {
      schema_version: 'webenvoy.site-task-admission-owner-operation/v1', operation: 'inspect_candidate',
      repository_ref: 'webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      package_ref: 'lode://site-skill/github/opencli-trending-repos', base_revision_ref: null, task_ref: 'read-opencli-trending'
    } }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('formal CLI rejects the historical App entry', async () => {
  const result = await runCli(['app', '--data-dir', join(tmpdir(), 'webenvoy-app-disabled')]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'app_unsupported_formal_runtime');
});
