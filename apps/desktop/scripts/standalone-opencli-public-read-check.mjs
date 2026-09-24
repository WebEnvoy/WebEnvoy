import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Installed-package CI check. This is a scripted client, not a model Agent.
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('opencli_check_requires_macos_arm64');
const packageRoot = resolve(process.argv[2] ?? '');
const lodeRoot = resolve(process.argv[3] ?? '');
const evidenceRoot = resolve(process.argv[4] ?? '');
const materialRoot = resolve(process.argv[5] ?? '');
const cli = join(packageRoot, 'bin/webenvoy');
const fixedNode = join(packageRoot, 'runtime/node');
const root = await mkdtemp('/tmp/webenvoy-opencli-check-');
const ownerData = join(root, 'owner');
const agentHost = command('/usr/bin/mktemp', ['-d', '/tmp/webenvoy-opencli-agent-XXXXXXXX'], { asAgent: true }).stdout.trim();
const clientFile = join(agentHost, 'webenvoy-client.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const manifestBytes = await readFile(join(packageRoot, 'agent-manifest.json'));
const bundle = JSON.parse(manifestBytes);
const lodeLock = JSON.parse(await readFile(join(packageRoot, 'dist-electron/lode/provenance.json'), 'utf8'));
const samples = [
  { name: 'github', path: 'sites/github/opencli-trending-repos', origin: 'https://github.com', input: { since: 'daily', limit: 2 } },
  { name: 'arxiv', path: 'sites/arxiv/opencli-recent-papers', origin: 'https://export.arxiv.org', input: { category: 'cs.AI', limit: 2 } },
  { name: 'devto', path: 'sites/devto/opencli-latest-articles', origin: 'https://dev.to', input: { limit: 2, page: 1 } },
];
for (const sample of samples) {
  sample.manifest = JSON.parse(await readFile(join(packageRoot, 'dist-electron/lode', sample.path, 'manifest.json'), 'utf8'));
  sample.task = JSON.parse(await readFile(join(packageRoot, 'dist-electron/lode', sample.path, sample.manifest.tasks[0].path), 'utf8'));
  assert.equal(sample.manifest.site.supported_origins[0], sample.origin);
  assert.equal(sample.task.network_read.origin, sample.origin);
}
const evidence = {
  schema: 'webenvoy.opencli-public-read-installed-acceptance/v1',
  state: 'running', webenvoy_commit: bundle.workspace.commit, webenvoy_tree: bundle.workspace.tree,
  webenvoy_manifest_sha256: sha(manifestBytes), lode_commit: lodeLock.commit,
  lode_tree: lodeLock.tree, opencli_commit: '8271afc67e8504bda94c147f446ee29775d08274',
  installation: 'macos-arm64 standalone candidate', profile_provider: 'camoufox', installed_plugin_model_agent: false,
  source_code_read_by_agent: false, browser_provider: null, account: false, release: false, samples: {},
};
await mkdir(evidenceRoot, { recursive: true });
const { ownerRequest } = await import(pathToFileURL(join(packageRoot, 'agent-entry/client.mjs')).href);
let runtimeStarted = false;
let requestIndex = 0;
let principalId;
let hostCredentialFingerprint;
const executionGrants = [];
const failedSamples = [];

function command(binary, args, { asAgent = false, input, allowFailure = false } = {}) {
  const commandArgs = asAgent ? ['-n', '-u', 'nobody', '--', binary, ...args] : args;
  const result = spawnSync(asAgent ? '/usr/bin/sudo' : binary, commandArgs, {
    cwd: packageRoot, encoding: 'utf8', input, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`command_failed:${binary}:${args.slice(0, 3).join(' ')}:${result.stderr || result.stdout}`);
  return result;
}
function jsonResult(result) {
  for (const line of `${result.stdout}\n${result.stderr}`.trim().split('\n').reverse()) {
    try { return JSON.parse(line); } catch {}
  }
  throw new Error(`cli_json_missing:${result.stderr.slice(0, 300)}`);
}
function owner(args, allowFailure = false) { return jsonResult(command(cli, args, { allowFailure })); }
function find(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value[key] === 'string') return value[key];
  return Object.values(value).map(item => find(item, key)).find(item => item !== undefined);
}
function success(value, label) { assert.equal(value.ok, true, `${label}:${value.failure?.code ?? value.error?.code}`); return value; }
function denied(value, label) {
  const code = value.failure?.code ?? value.error?.code ?? value.result?.failure?.code;
  assert.ok(code && (value.ok === false || value.error || value.result?.ok === false), `${label}:unexpected_success`);
  if (value.dispatch_state) assert.equal(value.dispatch_state, 'not_dispatched', `${label}:unexpected_dispatch`);
  assert.notEqual(code, 'managed_task_unavailable', `${label}:entry_not_assembled`);
  if (value.run) assert.equal(value.run.dispatch_state, 'not_dispatched', `${label}:dispatched`);
  return code;
}
async function agentFile(value) {
  const path = join(agentHost, `request-${++requestIndex}.json`);
  const writer = "const fs=require('node:fs');let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>body+=x);process.stdin.on('end',()=>fs.writeFileSync(process.argv[1],body,{mode:0o600,flag:'wx'}));";
  command(fixedNode, ['-e', writer, path], { asAgent: true, input: JSON.stringify(value) });
  return path;
}
async function agent(action, value, allowFailure = false) {
  const file = await agentFile(value);
  return jsonResult(command(cli, ['agent', ...action.split(' '), '--client-file', clientFile, '--request-file', file], { asAgent: true, allowFailure }));
}
async function grant(name, fields) {
  const path = join(root, `${name}.json`);
  await writeFile(path, JSON.stringify({ idempotency_key: `${root.split('/').at(-1)}-${name}`, principal_id: principalId, ...fields }), { mode: 0o600 });
  return find(owner(['access', 'grant', '--data-dir', ownerData, '--grant-file', path]), 'grant_id');
}
function scope(operation, sample, profileRef) {
  return { operations: [operation], profile_refs: [profileRef], origins: [sample.origin],
    skill_refs: [sample.manifest.package_ref], source_refs: [sample.manifest.revision_ref] };
}
function skillRequest(operation, sample) {
  return { idempotency_key: `${root.split('/').at(-1)}-${sample.name}-${operation}-${++requestIndex}`,
    grant_id: sample.grantId, operation, skill_ref: sample.manifest.package_ref,
    task_scope: { operations: [operation], skill_refs: [sample.manifest.package_ref], source_refs: [sample.manifest.revision_ref] } };
}
function taskRequest(operation, sample, fields = {}) {
  return { schema_version: 'webenvoy.managed-task-operation/v1', grant_id: sample.grantId,
    operation, task_scope: scope(operation, sample, sample.profileRef), ...fields };
}
async function verifyBusiness(sample, result) {
  const rows = result?.data?.normalized?.records;
  assert.ok(Array.isArray(rows) && rows.length > 0, `${sample.name}:records_missing`);
  const first = rows[0];
  let url;
  if (sample.name === 'github') url = `https://github.com/${first.repo}`;
  if (sample.name === 'devto') url = `https://dev.to/api/articles/${first.id}`;
  if (sample.name === 'arxiv') url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(first.id)}`;
  assert.ok(url, `${sample.name}:verification_url_missing`);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual' });
  assert.equal(response.status, 200, `${sample.name}:independent_status`);
  const body = await response.text();
  assert.ok(body.length > 0 && body.length < 2_000_000, `${sample.name}:independent_body`);
  if (sample.name === 'github') assert.ok(body.includes(first.repo.split('/')[1]), 'github:repo_detail_mismatch');
  if (sample.name === 'devto') assert.equal(JSON.parse(body).title, first.title, 'devto:article_title_mismatch');
  if (sample.name === 'arxiv') {
    const plain = body.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
    assert.ok(plain.includes(first.title.replace(/\s+/g, ' ')) && body.includes(first.id), 'arxiv:paper_detail_mismatch');
  }
  return { method: 'separate public detail request', status: response.status, record_count: rows.length,
    first_identity_sha256: sha(sample.name === 'github' ? first.repo : first.id) };
}

try {
  assert.equal(bundle.schema, 'webenvoy-installed-standalone/v1');
  assert.equal(await readFile(join(lodeRoot, 'sites/github/opencli-trending-repos/manifest.json'), 'utf8'),
    await readFile(join(packageRoot, 'dist-electron/lode/sites/github/opencli-trending-repos/manifest.json'), 'utf8'), 'installed Lode bytes differ from locked source');
  owner(['setup', '--data-dir', ownerData, '--agent-uid', String(Number(command('/usr/bin/id', ['-u', 'nobody']).stdout.trim())),
    '--browser-install-root', join(materialRoot, 'browser/Camoufox.app'),
    '--browser-executable', join(materialRoot, 'browser/Camoufox.app/Contents/MacOS/camoufox'),
    '--python-path', join(materialRoot, 'venv/bin/python'), '--browser-version', '152.0.4-beta.30',
    '--camoufox-version', '0.5.6', '--playwright-version', '1.60.0',
    '--browser-source-path', join(materialRoot, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
    '--camoufox-source-path', join(materialRoot, 'camoufox-0.5.6-py3-none-any.whl'),
    '--playwright-source-path', join(materialRoot, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')]);
  owner(['start', '--data-dir', ownerData]); runtimeStarted = true;
  success(await ownerRequest(ownerData, '/agent-access/management-policy', { method: 'PUT', body: {
    schema_version: 'webenvoy.execution-policy-mutation.v0', idempotency_key: `${root.split('/').at(-1)}-policy`, expected_source_version: null,
    modes: { read: 'auto', prepare: 'auto', commit: 'auto' },
  } }), 'management_policy');
  const installed = jsonResult(command(cli, ['agent', 'setup', '--host-dir', agentHost, '--data-dir', ownerData,
    '--owner-uid', String(process.getuid())], { asAgent: true }));
  hostCredentialFingerprint = installed.credential_fingerprint;
  assert.match(hostCredentialFingerprint, /^[0-9a-f]{64}$/);
  principalId = find(owner(['access', 'register', '--data-dir', ownerData, '--display-name', 'OpenCLI installed CI Agent',
    '--credential-hash', hostCredentialFingerprint, '--idempotency-key', `${root.split('/').at(-1)}-register`]), 'principal_id');
  assert.ok(principalId);
  const selected = owner(['site-task-admission', 'select-repository', '--data-dir', ownerData, '--path', lodeRoot]);
  const repositoryRef = find(selected, 'repository_ref'); assert.ok(repositoryRef);
  for (const sample of samples) {
    const manifest = sample.manifest;
    const task = sample.task;
    const inspected = owner(['site-task-admission', 'inspect-candidate', '--data-dir', ownerData,
      '--repository-ref', repositoryRef, '--package-ref', manifest.package_ref, '--first-admission', '--task-ref', task.task_ref]);
    const candidateRef = find(inspected, 'candidate_ref'); assert.ok(candidateRef);
    const diff = owner(['site-task-admission', 'candidate-diff', '--data-dir', ownerData, '--candidate-ref', candidateRef]);
    assert.ok(find(diff, 'diff')?.includes(sample.path), `${sample.name}:candidate_diff_missing`);
    const source = owner(['site-task-admission', 'admit-source', '--data-dir', ownerData, '--candidate-ref', candidateRef]);
    const admissionRef = find(source, 'admission_ref'); assert.ok(admissionRef);
    const code = owner(['site-task-admission', 'admit-code', '--data-dir', ownerData, '--admission-ref', admissionRef]);
    assert.ok(find(code, 'code_admission_ref'), `${sample.name}:code_admission_missing`);
    const operations = ['task.submit', 'task.query', 'task.stop', 'skill.list', 'skill.inspect', 'skill.install', 'skill.enable', 'skill.read'];
    const createGrantId = await grant(`${sample.name}-create`, { profile_refs: [], allowed_operations: ['profile.create'], allowed_origins: [sample.origin],
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), max_created_profiles: 1,
      creation_template: { template_ref: `opencli-${sample.name}-profile`, provider_id: 'camoufox',
        site: { site_id: sample.name, origin: sample.origin, display_name: sample.name }, language: 'en-US', timezone: 'UTC',
        permission_ceiling: { allowed_operations: operations, allowed_origins: [sample.origin], controlled_interaction_origins: [] } } });
    assert.ok(createGrantId);
    const created = success(await agent('operation', { idempotency_key: `${sample.name}-create-profile`, grant_id: createGrantId,
      operation: 'profile.create', task_scope: { operations: ['profile.create'], profile_refs: [], origins: [sample.origin] },
      template_ref: `opencli-${sample.name}-profile` }), `${sample.name}:profile_create`);
    sample.profileRef = find(created, 'profile_ref'); assert.ok(sample.profileRef);
    sample.grantId = await grant(`${sample.name}-execute`, { profile_refs: [sample.profileRef], allowed_operations: operations,
      allowed_origins: [sample.origin], expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      creation_template: null, max_created_profiles: 0,
      skill_scope: { skill_refs: [manifest.package_ref], source_refs: [manifest.revision_ref] } });
    assert.ok(sample.grantId);
    const inspectedSkill = success(await agent('skills', skillRequest('skill.inspect', sample)), `${sample.name}:skill_inspect`);
    assert.equal(inspectedSkill.result.skill.site_tasks.revision_ref, manifest.revision_ref);
    const declaration = inspectedSkill.result.skill.site_tasks.tasks.find(item => item.task_ref === task.task_ref);
    assert.ok(declaration);
    const submit = { package: { package_ref: manifest.package_ref, revision_ref: manifest.revision_ref,
      package_digest: manifest.integrity.package_digest, task_ref: task.task_ref },
      input: { schema_ref: declaration.input_schema_ref, carrier: 'webenvoy.managed-task-inline/v1', value: sample.input },
      intent: { summary: `Read ${sample.name} public data`, policy: { risk: 'read', execution_intent: 'read', timeout_ms: 30000 } } };
    sample.submit = submit;
    const beforeInstall = await agent('task submit', taskRequest('task.submit', sample, { idempotency_key: `${sample.name}-before-install`, ...submit }), true);
    const beforeInstallCode = denied(beforeInstall, `${sample.name}:not_installed`);
    assert.equal(beforeInstallCode, 'managed_skill_not_installed');
    success(await agent('skills', { ...skillRequest('skill.install', sample), revision_ref: manifest.revision_ref }), `${sample.name}:install`);
    const disabled = await agent('task submit', taskRequest('task.submit', sample, { idempotency_key: `${sample.name}-disabled`, ...submit }), true);
    const disabledCode = denied(disabled, `${sample.name}:disabled`);
    assert.equal(disabledCode, 'managed_skill_disabled');
    const afterInstall = success(await agent('skills', skillRequest('skill.inspect', sample)), `${sample.name}:inspect_installed`);
    success(await agent('skills', { ...skillRequest('skill.enable', sample), target_revision_ref: manifest.revision_ref,
      expected_revision_ref: null, expected_record_version: afterInstall.result.skill.record_version }), `${sample.name}:enable`);
    const wrongPin = await agent('task submit', taskRequest('task.submit', sample, { idempotency_key: `${sample.name}-wrong-pin`,
      ...submit, package: { ...submit.package, package_digest: `sha256:${'0'.repeat(64)}` } }), true);
    const wrongPinCode = denied(wrongPin, `${sample.name}:wrong_pin`);
    assert.equal(wrongPinCode, 'managed_access_denied');
    const wrongTarget = await agent('task submit', taskRequest('task.submit', sample, { idempotency_key: `${sample.name}-wrong-target`,
      ...submit, target: { target_type: 'public_http_origin', target_ref: sample.origin } }), true);
    const wrongTargetCode = denied(wrongTarget, `${sample.name}:target_must_be_omitted`);
    assert.equal(wrongTargetCode, 'managed_task_invalid_input');
    const attempted = await agent('task submit', taskRequest('task.submit', sample, { idempotency_key: `${sample.name}-execute`, ...submit }), true);
    if (attempted.run?.run_id && attempted.run.status !== 'succeeded') {
      const original = await agent('task query', taskRequest('task.query', sample,
        { selector: { run_id: attempted.run.run_id } }), true);
      evidence.samples[sample.name] = { run_id: attempted.run.run_id, status: attempted.run.status,
        dispatch_state: attempted.run.dispatch_state, failure_code: attempted.failure?.code,
        original_query_same_run: original.run?.run_id === attempted.run.run_id };
      if (sample.name === 'devto' && attempted.failure?.code === 'managed_task_network_content_type_denied') {
        const probe = spawnSync('/usr/bin/curl', ['--silent', '--show-error', '--http1.1', '--max-time', '10',
          '--output', '/dev/null', '--write-out', '%{http_code} %{content_type}',
          '--header', 'accept: application/json', '--header', 'user-agent:',
          'https://dev.to/api/articles/latest?per_page=2&page=1'], { encoding: 'utf8', timeout: 12_000 });
        evidence.samples[sample.name].independent_public_probe = { exit_code: probe.status,
          status_and_content_type: probe.stdout.trim().slice(0, 128) };
      }
      failedSamples.push(`${sample.name}:${attempted.failure?.code ?? attempted.run.status}`);
      executionGrants.push(sample.grantId);
      continue;
    }
    const completed = success(attempted, `${sample.name}:submit`);
    assert.equal(completed.run.status, 'succeeded', `${sample.name}:run_status`);
    assert.equal(completed.result.outcome, 'success', `${sample.name}:result_outcome`);
    assert.equal(completed.result.data.status, 'available', `${sample.name}:business_status`);
    const query = success(await agent('task query', taskRequest('task.query', sample,
      { selector: { run_id: completed.run.run_id } })), `${sample.name}:query`);
    assert.equal(query.run.run_id, completed.run.run_id);
    assert.deepEqual(query.result, completed.result);
    const business = await verifyBusiness(sample, completed.result);
    evidence.samples[sample.name] = { package_ref: manifest.package_ref, revision_ref: manifest.revision_ref,
      package_digest: manifest.integrity.package_digest, source_admission_ref: admissionRef,
      code_admission_ref: find(code, 'code_admission_ref'), profile_ref: sample.profileRef,
      run_id: completed.run.run_id, result_sha256: sha(JSON.stringify(completed.result)), business,
      refusals: { before_install: beforeInstallCode, disabled: disabledCode, wrong_pin: wrongPinCode, wrong_target: wrongTargetCode } };
    executionGrants.push(sample.grantId);
  }
  // Drop one completed submit response at the process boundary. Query its
  // original key; a second task.submit would be a new network request.
  const lostSample = samples[0];
  const lostKey = `${root.split('/').at(-1)}-response-lost`;
  const lostFile = await agentFile(taskRequest('task.submit', lostSample,
    { idempotency_key: lostKey, ...lostSample.submit }));
  const lostResult = spawnSync('/usr/bin/sudo', ['-n', '-u', 'nobody', '--', cli, 'agent', 'task', 'submit',
    '--client-file', clientFile, '--request-file', lostFile], { cwd: packageRoot, stdio: 'ignore', timeout: 120_000 });
  assert.equal(lostResult.status, 0, 'response_loss_submit_did_not_finish');
  const recovered = success(await agent('task query', taskRequest('task.query', lostSample,
    { selector: { original_idempotency_key: lostKey } })), 'response_loss_query');
  assert.equal(recovered.run.status, 'succeeded');
  evidence.response_loss = { original_key_sha256: sha(lostKey), original_run_id: recovered.run.run_id,
    resolution: 'queried original key without a second submit' };
  owner(['stop', '--data-dir', ownerData]); runtimeStarted = false;
  owner(['start', '--data-dir', ownerData]); runtimeStarted = true;
  for (const sample of samples) {
    const queried = await agent('task query', taskRequest('task.query', sample,
      { selector: { run_id: evidence.samples[sample.name].run_id } }), true);
    if (evidence.samples[sample.name].result_sha256) {
      success(queried, `${sample.name}:restart_query`);
      assert.equal(sha(JSON.stringify(queried.result)), evidence.samples[sample.name].result_sha256);
    } else {
      assert.equal(queried.run.status, evidence.samples[sample.name].status);
      assert.equal(queried.failure?.code, evidence.samples[sample.name].failure_code);
    }
    evidence.samples[sample.name].restart_query = 'same original Run and terminal result or failure';
  }
  for (const grantId of executionGrants) owner(['access', 'revoke', '--data-dir', ownerData, '--kind', 'grants', '--id', grantId,
    '--idempotency-key', `${root.split('/').at(-1)}-revoke-${grantId}`]);
  for (const sample of samples) {
    const rejected = await agent('task submit', taskRequest('task.submit', sample, { idempotency_key: `${sample.name}-revoked`,
      package: { package_ref: sample.manifest.package_ref, revision_ref: sample.manifest.revision_ref,
        package_digest: sample.manifest.integrity.package_digest, task_ref: sample.task.task_ref },
      input: { schema_ref: sample.task.inputs.schema_ref, carrier: 'webenvoy.managed-task-inline/v1', value: sample.input },
      intent: { summary: 'Should be rejected after revocation', policy: { risk: 'read', execution_intent: 'read', timeout_ms: 30000 } } }), true);
    evidence.samples[sample.name].revoked = denied(rejected, `${sample.name}:revoked`);
  }
  if (failedSamples.length) throw new Error(`public_samples_incomplete: ${failedSamples.join(', ')}`);
  evidence.state = 'passed';
} catch (error) {
  evidence.state = 'failed'; evidence.error = error.message;
  throw error;
} finally {
  if (runtimeStarted) try { owner(['stop', '--data-dir', ownerData]); } catch { evidence.cleanup_error = 'runtime_stop_failed'; }
  try { command('/bin/rm', ['-rf', agentHost], { asAgent: true }); } catch { evidence.cleanup_error = 'agent_host_cleanup_failed'; }
  await rm(root, { recursive: true, force: true });
  await writeFile(join(evidenceRoot, 'summary.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ state: evidence.state, evidence: join(evidenceRoot, 'summary.json') }));
}
