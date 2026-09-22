import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { recoveryOperationRef, root, sha, verifyBundle } from './bundle.mjs';
import * as clientApi from './client.mjs';
const { ensureRuntime, localRequest, readClient } = clientApi;
const ownerRequest = (...parameters) => {
  if (typeof clientApi.ownerRequest !== 'function') throw new Error('owner_control_helper_missing');
  return clientApi.ownerRequest(...parameters);
};
import { atomicWrite, installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { previousRoot } from './previous-installation.mjs';
import { CAMOUFOX_UPSTREAM_PINS, CHROME_OFFICIAL_INSTALL_SCHEMA, CHROME_OFFICIAL_PINS, classifyCamoufoxBinding, classifyChromeOfficialBinding, resolveCamoufoxSetupBinding, resolveChromeOfficialSetupBinding } from './provider-artifact.mjs';
const [command, ...args] = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };

const HELP = {
  root: `Usage: webenvoy <command> [options]

Commands:
  setup       Install or repair the no-App Runtime bundle (owner-only)
  start       Start the local Runtime service (owner-only)
  diagnose    Read Runtime and installation health (owner-only)
  stop        Stop the local Runtime service (owner-only)
  uninstall   Remove receipt-managed host files (owner-only)
  access      Register, grant, revoke, and query owner access (owner-only)
  files       Manage owner-registered file references (owner-only)
  recovery    Inspect or apply owner-managed recovery (owner-only)
  instance    Discover and control a Runtime instance (owner-only)
  agent       Consume the managed browser projection (Agent-only)
  help        Show this help without starting Runtime
  --version   Show the verified bundle version without starting Runtime

Use "webenvoy help <command>" for command syntax.`,
  access: `Usage: webenvoy access <list|register|grant|grant-v2|policy-v2|revoke|operation> --data-dir DIR

Owner control identity is required. Core receipt actions use the caller's stable
idempotency key: register/revoke take --idempotency-key; grant, grant-v2 and
policy-v2 require idempotency_key in their JSON file. operation queries the
original caller key with --operation-ref. Reuse the original key after a lost
response; never create a new key.`,
  files: `Usage: webenvoy files <import|inspect|export|revoke|delete> --data-dir DIR

Owner control identity is required. File import accepts an optional correlation
--operation-ref but it is not a receipt key. Export is protected by exclusive
destination creation; revoke and delete are keyed by the exact --file-ref.
After a lost response, inspect the same file and destination before retrying.`,
  recovery: `Usage: webenvoy recovery <inspect|backup|plan|apply|status> --data-dir DIR

Owner control identity is required. backup, plan and apply require a caller
--idempotency-key; inspect may generate a local read key when omitted. status
accepts --operation-ref or --idempotency-key with --kind. apply also requires
--confirm or a validated --confirmation-file.`,
  instance: `Usage: webenvoy instance <list|inspect|takeover|handback|stop> --data-dir DIR

Owner control identity is required. list/inspect are live reads. takeover and
handback use the Harbor expected_control CAS precondition from the same inspect
result; stop targets the exact --runtime-session-ref and never stops Runtime.`,
  agent: `Usage: webenvoy agent <status|skill|connect|describe|operation|query|recovery|skills> --client-file FILE

Agent commands use only the installed client credential. request files are
strictly validated against the installed managed capability definitions;
connection_id, principal_id, owner credentials and supervisor tokens are
rejected. query only reads the original run_id or idempotency key and never
replays an operation. Agent commands are non-interactive and cannot confirm
owner actions.`,
  'agent operation': `Usage: webenvoy agent operation --client-file FILE --request-file FILE

The request file is one operation envelope from the installed capability
definition. It must include a fresh idempotency_key, grant_id, operation and
single-operation task_scope. Unknown fields and fields outside that operation
definition are rejected before dispatch.`,
  'agent query': `Usage: webenvoy agent query --client-file FILE (--run-id RUN_ID|--idempotency-key KEY)

Query the original durable Run only. A lost response or unknown outcome must
use the same run_id or original idempotency key; do not submit a new operation.`,
};

const VALUE_FLAGS = new Set([
  '--data-dir', '--host-dir', '--codex-profile', '--previous-installation', '--browser-install-root', '--browser-root',
  '--browser-executable', '--python-path', '--python', '--browser-version', '--camoufox-version', '--playwright-version',
  '--browser-source-path', '--browser-source', '--browser-archive', '--camoufox-source-path', '--camoufox-source', '--camoufox-wheel',
  '--playwright-source-path', '--playwright-source', '--playwright-wheel', '--browser-executable-sha256', '--python-executable-sha256', '--camoufox-artifact',
  '--chrome-install-root', '--chrome-browser-root', '--chrome-executable', '--chrome-python-path', '--chrome-python', '--chrome-version',
  '--chrome-playwright-version', '--chrome-source-path', '--chrome-source', '--chrome-archive', '--chrome-executable-sha256',
  '--display-name', '--credential-hash', '--idempotency-key', '--grant-file', '--policy-file', '--kind', '--id', '--operation-ref',
  '--source-path', '--profile-ref', '--mime-type', '--file-ref', '--destination-path', '--backup-ref', '--plan-file', '--confirmation-file',
  '--client-file', '--request-file', '--run-id', '--runtime-session-ref', '--expected-control-file'
]);
const COMMAND_FLAGS = new Map([
  ['setup', new Set(['--data-dir', '--host-dir', '--codex-profile', '--approve-tools', '--previous-installation', '--browser-install-root', '--browser-root', '--browser-executable', '--python-path', '--python', '--browser-version', '--camoufox-version', '--playwright-version', '--browser-source-path', '--browser-source', '--browser-archive', '--camoufox-source-path', '--camoufox-source', '--camoufox-wheel', '--playwright-source-path', '--playwright-source', '--playwright-wheel', '--browser-executable-sha256', '--python-executable-sha256', '--camoufox-artifact', '--chrome-install-root', '--chrome-browser-root', '--chrome-executable', '--chrome-python-path', '--chrome-python', '--chrome-version', '--chrome-playwright-version', '--chrome-source-path', '--chrome-source', '--chrome-archive', '--chrome-executable-sha256'])],
  ['access:list', new Set(['--data-dir'])],
  ['access:register', new Set(['--data-dir', '--display-name', '--credential-hash', '--idempotency-key'])],
  ['access:grant', new Set(['--data-dir', '--grant-file'])],
  ['access:grant-v2', new Set(['--data-dir', '--grant-file', '--confirm'])],
  ['access:policy-v2', new Set(['--data-dir', '--policy-file', '--confirm'])],
  ['access:revoke', new Set(['--data-dir', '--kind', '--id', '--idempotency-key'])],
  ['access:operation', new Set(['--data-dir', '--operation-ref'])],
  ['files:import', new Set(['--data-dir', '--source-path', '--profile-ref', '--display-name', '--mime-type', '--operation-ref'])],
  ['files:inspect', new Set(['--data-dir', '--file-ref'])],
  ['files:export', new Set(['--data-dir', '--file-ref', '--destination-path'])],
  ['files:revoke', new Set(['--data-dir', '--file-ref'])],
  ['files:delete', new Set(['--data-dir', '--file-ref'])],
  ['recovery:inspect', new Set(['--data-dir', '--profile-ref', '--idempotency-key'])],
  ['recovery:backup', new Set(['--data-dir', '--profile-ref', '--idempotency-key'])],
  ['recovery:plan', new Set(['--data-dir', '--profile-ref', '--backup-ref', '--idempotency-key'])],
  ['recovery:apply', new Set(['--data-dir', '--plan-file', '--idempotency-key', '--confirm', '--confirmation-file'])],
  ['recovery:status', new Set(['--data-dir', '--operation-ref', '--idempotency-key', '--kind'])],
  ['instance:list', new Set(['--data-dir', '--profile-ref'])],
  ['instance:inspect', new Set(['--data-dir', '--runtime-session-ref'])],
  ['instance:takeover', new Set(['--data-dir', '--runtime-session-ref', '--expected-control-file'])],
  ['instance:handback', new Set(['--data-dir', '--runtime-session-ref', '--expected-control-file'])],
  ['instance:stop', new Set(['--data-dir', '--runtime-session-ref'])],
  ['agent:status', new Set(['--client-file'])],
  ['agent:skill', new Set(['--client-file'])],
  ['agent:connect', new Set(['--client-file'])],
  ['agent:describe', new Set(['--client-file', '--request-file'])],
  ['agent:operation', new Set(['--client-file', '--request-file'])],
  ['agent:query', new Set(['--client-file', '--run-id', '--idempotency-key'])],
  ['agent:recovery', new Set(['--client-file', '--request-file'])],
  ['agent:skills', new Set(['--client-file', '--request-file'])],
  ['start', new Set(['--data-dir'])], ['diagnose', new Set(['--data-dir'])], ['stop', new Set(['--data-dir'])],
  ['app', new Set(['--data-dir'])], ['uninstall', new Set(['--data-dir', '--host-dir', '--codex-profile'])]
]);

function cliError(message) { const error = new Error(message); error.code = message.split(':', 1)[0]; return error; }
function validateCliSyntax(name, values) {
  if (name === 'help') {
    const seen = new Set(), topics = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === '--data-dir') {
        if (seen.has(value) || !values[i + 1] || values[i + 1].startsWith('--')) throw cliError('help_data_dir_invalid');
        seen.add(value); i++; continue;
      }
      if (value.startsWith('--')) throw cliError('help_topic_invalid');
      topics.push(value);
    }
    if (topics.length > 2) throw cliError('help_topic_invalid');
    return;
  }
  const action = ['access', 'files', 'recovery', 'instance', 'agent'].includes(name) ? values[0] : undefined;
  const key = action ? `${name}:${action}` : name;
  const declared = COMMAND_FLAGS.get(key);
  const allowed = declared ? new Set([...declared, '--help']) : undefined;
  if (!allowed) throw cliError(action ? `unknown_${name}_command` : `unknown_command`);
  const seen = new Set();
  let positional = 0;
  for (let i = action ? 1 : 0; i < values.length; i++) {
    const token = values[i];
    if (!token.startsWith('--')) { positional++; continue; }
    if (!allowed.has(token) || token.includes('=')) throw cliError(`unknown_flag:${token}`);
    if (seen.has(token)) throw cliError(`duplicate_flag:${token}`);
    seen.add(token);
    if (VALUE_FLAGS.has(token) && (!values[i + 1] || values[i + 1].startsWith('--'))) throw cliError(`${token}_value_required`);
    if (VALUE_FLAGS.has(token)) i++;
  }
  if (positional) throw cliError('unexpected_positional_argument');
  if (seen.has('--help')) return;
  if (name === 'agent' && !seen.has('--client-file')) throw cliError('--client-file_required');
  if (name === 'agent' && seen.has('--data-dir')) throw cliError('agent_data_dir_forbidden');
  if (name === 'agent' && (action === 'query') && (seen.has('--run-id') === seen.has('--idempotency-key'))) throw cliError('agent_query_selector_required');
  if (name === 'agent' && action !== 'query' && (seen.has('--run-id') || seen.has('--idempotency-key'))) throw cliError('agent_query_selector_forbidden');
}

function printHelp(topic) { process.stdout.write(`${HELP[topic] ?? HELP.root}\n`); }

function exitCodeFor(value) {
  const status = value?.status;
  const errorCode = value?.error?.code ?? value?.failure?.code;
  if (['unknown_outcome', 'managed_browser_outcome_unknown'].includes(status) || errorCode === 'managed_browser_outcome_unknown') return 6;
  if (['runtime_unavailable', 'runtime_unavailable_query_without_replay', 'discovery_not_available', 'bundle_unavailable'].includes(errorCode)) return 7;
  if (['requires_user_action', 'manual_recovery_required', 'pending'].includes(status)) return 4;
  if (['failed', 'blocked', 'cancelled', 'expired'].includes(status)) return 5;
  if (value?.ok === false || value?.error) return 3;
  return 0;
}
function printResult(value) { process.stdout.write(`${JSON.stringify(value)}\n`); process.exitCode = exitCodeFor(value); }
function safeDiagnostic(error) {
  const raw = typeof error?.code === 'string' ? error.code : String(error?.message ?? 'internal_error');
  return raw.split(':', 1)[0].replace(/[^A-Za-z0-9_.-]/g, '_') || 'internal_error';
}
function reportFatal(error) {
  if (reportFatal.done) return;
  reportFatal.done = true;
  const code = safeDiagnostic(error);
  process.stderr.write(`${JSON.stringify({ error: { code, message: code.replaceAll('_', ' '), next: 'inspect the input or run diagnose before retrying' } })}\n`);
  process.exitCode = ['runtime_unavailable', 'runtime_response_aborted', 'runtime_timeout', 'runtime_start_failed', 'owner_control_helper_missing'].includes(code) ? 7 : code.startsWith('unknown_') || code.includes('required') || code.includes('invalid') || code.includes('duplicate') || code.includes('flag') || code.includes('input_refused') ? 2 : 8;
}
process.on('uncaughtException', reportFatal);
process.on('unhandledRejection', reportFatal);

if (command === '--version' || command === '-V') {
  const assets = await verifyBundle();
  process.stdout.write(`${JSON.stringify({ version: assets.version, skill_version: assets.skill_version, integrity: assets.integrity })}\n`);
  process.exit(0);
}
if (command === 'help' || command === '--help' || command === '-h') {
  validateCliSyntax('help', command === 'help' ? args : []);
  printHelp(command === 'help' ? args.filter((value, index) => value !== '--data-dir' && args[index - 1] !== '--data-dir').join(' ') || 'root' : 'root');
  process.exit(0);
}
if (command === undefined) { printHelp('root'); process.exitCode = 2; }
if (command === undefined) process.exit(2);
validateCliSyntax(command, args);
if (args.includes('--help')) {
  printHelp(command === 'agent' && args[0] ? `agent ${args[0]}` : command);
  process.exit(0);
}
const linkedData = await readFile(join(root, '../webenvoy-installation.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return {}; });
const dataDir = command === 'agent' ? undefined : resolve(arg('--data-dir') ?? linkedData.data_dir ?? (() => { throw new Error('--data-dir is required; choose a dedicated persistent directory'); })());
if (command === 'setup') {
  const hostDir = resolve(arg('--host-dir') ?? (() => { throw new Error('--host-dir is required'); })());
  if (dataDir.startsWith(root + '/') || root.startsWith(dataDir + '/') || dataDir === root) throw new Error('Profile data must be separate from installation assets');
  try { const active = await localRequest(dataDir, '/status'); if (active.ready) throw new Error('runtime_active_stop_before_setup'); } catch (error) { if (error.message === 'runtime_active_stop_before_setup' || !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  const assets = await verifyBundle();
  const installationPath = join(dataDir, 'installation.json');
  const existingInstallation = await readInstallation(installationPath);
  const legacyBinding = existingInstallation && ['camoufoxArtifact', 'native504', 'native510', 'camoufoxNativeArtifact', 'camoufoxNativeBinding'].some(key => Object.hasOwn(existingInstallation, key));
  const upstreamArgs = ['--browser-install-root', '--browser-root', '--browser-executable', '--python-path', '--python', '--browser-version', '--camoufox-version', '--playwright-version', '--browser-source-path', '--browser-source', '--browser-archive', '--camoufox-source-path', '--camoufox-source', '--camoufox-wheel', '--playwright-source-path', '--playwright-source', '--playwright-wheel', '--browser-executable-sha256', '--python-executable-sha256'];
  const hasUpstreamArguments = upstreamArgs.some(name => args.includes(name));
  if (args.includes('--camoufox-artifact') || legacyBinding && hasUpstreamArguments) throw new Error('camoufox_artifact_binding_retired');
  const upstream = legacyBinding ? null : await resolveCamoufoxSetupBinding({
    existingInstallation,
    hasUpstreamArguments,
    upstreamInput: hasUpstreamArguments ? {
      provider: 'camoufox',
      browser_install_root: requiredAny('--browser-install-root', '--browser-root'),
      browser_executable: required('--browser-executable'),
      python_path: requiredAny('--python-path', '--python'),
      browser_version: arg('--browser-version') ?? CAMOUFOX_UPSTREAM_PINS.browser_version,
      camoufox_version: arg('--camoufox-version') ?? CAMOUFOX_UPSTREAM_PINS.camoufox_version,
      playwright_version: arg('--playwright-version') ?? CAMOUFOX_UPSTREAM_PINS.playwright_version,
      browser_source_path: requiredAny('--browser-source-path', '--browser-source', '--browser-archive'),
      camoufox_source_path: requiredAny('--camoufox-source-path', '--camoufox-source', '--camoufox-wheel'),
      playwright_source_path: requiredAny('--playwright-source-path', '--playwright-source', '--playwright-wheel'),
      ...(arg('--browser-executable-sha256') ? { browser_executable_sha256: arg('--browser-executable-sha256') } : {}),
      ...(arg('--python-executable-sha256') ? { python_executable_sha256: arg('--python-executable-sha256') } : {})
    } : undefined
  });
  const chromeArgs = ['--chrome-install-root', '--chrome-browser-root', '--chrome-executable', '--chrome-python-path', '--chrome-python', '--chrome-version', '--chrome-playwright-version', '--chrome-source-path', '--chrome-source', '--chrome-archive', '--chrome-executable-sha256'];
  const hasChromeArguments = chromeArgs.some(name => args.includes(name));
  const chrome = await resolveChromeOfficialSetupBinding({
    existingInstallation,
    hasOfficialArguments: hasChromeArguments,
    officialInput: hasChromeArguments ? {
      schema: CHROME_OFFICIAL_INSTALL_SCHEMA,
      provider: CHROME_OFFICIAL_PINS.provider,
      source: CHROME_OFFICIAL_PINS.source,
      browser_install_root: requiredAny('--chrome-install-root', '--chrome-browser-root'),
      browser_executable: required('--chrome-executable'),
      python_path: requiredAny('--chrome-python-path', '--chrome-python'),
      browser_version: arg('--chrome-version') ?? CHROME_OFFICIAL_PINS.browser_version,
      playwright_version: arg('--chrome-playwright-version') ?? CHROME_OFFICIAL_PINS.playwright_version,
      browser_source_path: requiredAny('--chrome-source-path', '--chrome-source', '--chrome-archive'),
      ...(arg('--chrome-executable-sha256') ? { executable_sha256: arg('--chrome-executable-sha256') } : {})
    } : undefined
  });
  if (linkedData.data_dir && linkedData.data_dir !== dataDir) throw new Error('This installation already belongs to another data directory');
  if (!linkedData.data_dir) await writeFile(join(root, '../webenvoy-installation.json'), JSON.stringify({ data_dir: dataDir }), { mode: 0o600, flag: 'wx' });
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(hostDir, { recursive: true, mode: 0o700 });
  const clientPath = join(hostDir, 'webenvoy-client.json');
  let client;
  try { client = await readClient(clientPath); if (client.data_dir !== dataDir) throw new Error('existing_client_data_directory_mismatch'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    client = { data_dir: dataDir, credential: randomBytes(32).toString('base64url') };
    await writeFile(clientPath, JSON.stringify(client), { mode: 0o600, flag: 'wx' });
  }
  let installation = existingInstallation;
  if (!installation) {
    const ports = await Promise.all([reservePort(), reservePort()]);
    installation = { coreEndpoint: `http://127.0.0.1:${ports[0]}`, harborEndpoint: `http://127.0.0.1:${ports[1]}`, ...(upstream ? { camoufoxUpstream: upstream } : {}), ...(chrome ? { chromeOfficial: chrome } : {}) };
  } else if (upstream && installation.camoufoxUpstream) {
    if (JSON.stringify(installation.camoufoxUpstream) !== JSON.stringify(upstream)) throw new Error('camoufox_upstream_binding_mismatch');
  } else if (upstream) {
    installation = { ...installation, camoufoxUpstream: upstream };
  }
  if (chrome && installation.chromeOfficial) {
    if (JSON.stringify(installation.chromeOfficial) !== JSON.stringify(chrome)) throw new Error('chrome_official_binding_mismatch');
  } else if (chrome) {
    installation = { ...installation, chromeOfficial: chrome };
  }
  await mkdir(join(hostDir, '.agents/skills/webenvoy-browser'), { recursive: true });
  // A standalone profile file is reviewable; never edit the user's existing Codex configuration.
  const config = hostConfig(root, clientPath, args.includes('--approve-tools'), true);
  const configPath = join(hostDir, 'webenvoy.config.toml');
  const skillPath = join(hostDir, '.agents/skills/webenvoy-browser/SKILL.md');
  const profile = arg('--codex-profile');
  if (profile && !/^[a-z0-9-]{1,64}$/.test(profile)) throw new Error('invalid_codex_profile_name');
  const profileConfigPath = profile ? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), profile + '.config.toml') : undefined;
  const managedFiles = [
    { path: configPath, content: config },
    { path: skillPath, content: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md')) },
    ...(profileConfigPath ? [{ path: profileConfigPath, content: config }] : [])
  ];
  const legacyFiles = await previousLegacyFiles(arg('--previous-installation'), [configPath, ...(profileConfigPath ? [profileConfigPath] : [])], skillPath, clientPath);
  await installManagedFiles({
    receiptPath: join(hostDir, 'webenvoy-installation.json'),
    identity: { data_dir: dataDir, host_dir: hostDir, asset_digest: assets.digest, workspace: assets.workspace },
    files: managedFiles,
    legacyFiles
  });
  if (!existingInstallation || JSON.stringify(installation) !== JSON.stringify(existingInstallation)) await atomicWrite(installationPath, JSON.stringify(installation));
  printResult({ installed: true, camoufox_launch: classifyCamoufoxBinding(installation), chrome_launch: classifyChromeOfficialBinding(installation), credential_fingerprint: sha(client.credential), host_configuration: join(hostDir, 'webenvoy.config.toml'), next: 'Run webenvoy access register with this fingerprint and then webenvoy access grant; no Desktop App is required.' });
} else if (command === 'agent') {
  printResult(await runAgent(args[0], args));
} else if (command === 'access') {
  const action = args[0];
  await ensureRuntime(dataDir);
  const requestOwner = (path, body) => ownerRequest(dataDir, path, body === undefined ? {} : { method: 'POST', body });
  let result;
  if (action === 'list') {
    result = await requestOwner('/agent-access');
  } else if (action === 'register') {
    const credentialHash = required('--credential-hash');
    if (!/^[a-f0-9]{64}$/i.test(credentialHash)) throw new Error('credential_hash_invalid');
    result = await requestOwner('/agent-access/principals', { idempotency_key: required('--idempotency-key'), display_name: required('--display-name'), credential_hash: credentialHash });
  } else if (action === 'grant') {
    const value = await readJsonFile(required('--grant-file'), 'access_grant_file_invalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_grant_file_invalid');
    const allowed = ['idempotency_key', 'principal_id', 'profile_refs', 'allowed_operations', 'allowed_origins', 'expires_at', 'creation_template', 'max_created_profiles', 'skill_scope', 'file_scope'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key) throw new Error('access_grant_file_invalid');
    result = await requestOwner('/agent-access/grants', value);
  } else if (action === 'grant-v2') {
    if (!args.includes('--confirm')) throw new Error('access_confirmation_required');
    const value = await readJsonFile(required('--grant-file'), 'access_v2_grant_file_invalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_v2_grant_file_invalid');
    const allowed = ['idempotency_key', 'source_grant_id', 'source_grant_digest', 'principal_id', 'profile_refs', 'policy_digest', 'allowed_operations', 'allowed_origins', 'expires_at', 'skill_scope', 'file_scope', 'replaces_grant_id', 'replaces_grant_digest'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key) throw new Error('access_v2_grant_file_invalid');
    result = await requestOwner('/agent-access/v2/grants', value);
  } else if (action === 'policy-v2') {
    if (!args.includes('--confirm')) throw new Error('access_confirmation_required');
    const value = await readJsonFile(required('--policy-file'), 'access_v2_policy_file_invalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_v2_policy_file_invalid');
    const allowed = ['idempotency_key', 'profile_ref', 'current_policy_digest', 'allowed_operations', 'allowed_origins', 'controlled_interaction_origins'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key) throw new Error('access_v2_policy_file_invalid');
    result = await requestOwner('/agent-access/v2/profile-policies', value);
  } else if (action === 'revoke') {
    const kind = required('--kind');
    if (!['principals', 'connections', 'grants'].includes(kind)) throw new Error('access_revoke_kind_invalid');
    const id = required('--id');
    result = await requestOwner(`/agent-access/${kind}/${encodeURIComponent(id)}/revoke`, { idempotency_key: required('--idempotency-key') });
  } else if (action === 'operation') {
    result = await requestOwner(`/agent-access/operations/${encodeURIComponent(required('--operation-ref'))}`);
  } else throw new Error('Use access list, register, grant, grant-v2, policy-v2, revoke or operation with --data-dir. Owner credentials stay local.');
  printResult(result);
} else if (command === 'files') {
  const action = args[0];
  await ensureRuntime(dataDir);
  const requestOwner = (path, body) => ownerRequest(dataDir, path, body === undefined ? {} : { method: 'POST', body });
  let result;
  if (action === 'import') {
    const input = { source_path: resolve(required('--source-path')), profile_ref: required('--profile-ref'),
      ...(arg('--display-name') === undefined ? {} : { display_name: arg('--display-name') }),
      ...(arg('--mime-type') === undefined ? {} : { mime_type: arg('--mime-type') }),
      ...(arg('--operation-ref') === undefined ? {} : { operation_ref: arg('--operation-ref') }) };
    result = await requestOwner('/owner/files/import', input);
  } else if (action === 'inspect') {
    const fileRef = arg('--file-ref');
    result = await requestOwner(fileRef === undefined ? '/owner/files' : `/owner/files?file_ref=${encodeURIComponent(fileRef)}`);
  } else if (action === 'export') {
    result = await requestOwner('/owner/files/export', { file_ref: required('--file-ref'), destination_path: resolve(required('--destination-path')) });
  } else if (action === 'revoke' || action === 'delete') {
    result = await requestOwner(`/owner/files/${action}`, { file_ref: required('--file-ref') });
  } else throw new Error('Use files import, inspect, export, revoke or delete with --data-dir. Owner file paths never enter Agent requests.');
  printResult(result);
} else if (command === 'recovery') {
  const action = args[0];
  await ensureRuntime(dataDir);
  const requestOwner = (path, body) => ownerRequest(dataDir, path, body === undefined ? {} : { method: 'POST', body });
  let result;
  if (action === 'inspect') {
    const profileRef = required('--profile-ref');
    result = await requestOwner('/owner/recovery/inspect', { idempotency_key: arg('--idempotency-key') ?? `owner-recovery-inspect:${randomBytes(16).toString('hex')}`, profile_ref: profileRef });
  } else if (action === 'backup') {
    const profileRef = required('--profile-ref');
    result = await requestOwner('/owner/recovery/backup', { idempotency_key: required('--idempotency-key'), profile_ref: profileRef });
  } else if (action === 'plan') {
    result = await requestOwner('/owner/recovery/plan', { idempotency_key: required('--idempotency-key'), profile_ref: required('--profile-ref'), backup_ref: required('--backup-ref') });
  } else if (action === 'apply') {
    const idempotencyKey = required('--idempotency-key');
    const planFile = await readJsonFile(required('--plan-file'));
    const selectedPlan = planFile?.result?.plan ?? planFile?.plan ?? planFile;
    if (!selectedPlan || typeof selectedPlan !== 'object' || Array.isArray(selectedPlan)) throw new Error('recovery_plan_file_invalid');
    const confirmationPath = arg('--confirmation-file');
    const confirmation = confirmationPath
      ? await readJsonFile(confirmationPath)
      : args.includes('--confirm')
        ? { schema_version: 'webenvoy.profile-recovery-confirmation.v1', confirmation_ref: `confirmation:${randomBytes(16).toString('hex')}`, plan_ref: selectedPlan.plan_ref, confirmed_at: new Date().toISOString(), confirmed_by: 'owner', idempotency_key: idempotencyKey, decision: 'apply' }
        : (() => { throw new Error('recovery_confirmation_required: pass --confirm or --confirmation-file'); })();
    result = await requestOwner('/owner/recovery/apply', { idempotency_key: idempotencyKey, plan: selectedPlan, confirmation });
  } else if (action === 'status') {
    const operationRef = arg('--operation-ref');
    const idempotencyKey = arg('--idempotency-key');
    const kind = arg('--kind') ?? 'apply';
    if (!['inspect', 'backup', 'plan', 'apply'].includes(kind)) throw new Error('recovery_status_kind_invalid');
    if (operationRef !== undefined && idempotencyKey !== undefined) throw new Error('recovery_status_selector_conflict');
    if (operationRef !== undefined && arg('--kind') !== undefined) throw new Error('recovery_status_kind_requires_idempotency_key');
    if (operationRef !== undefined && !operationRef) throw new Error('recovery_status_operation_ref_invalid');
    if (operationRef === undefined && !idempotencyKey) throw new Error('recovery_status_selector_required');
    const resolvedOperationRef = operationRef ?? recoveryOperationRef(kind, idempotencyKey);
    result = await requestOwner(`/owner/recovery/status/${encodeURIComponent(resolvedOperationRef)}`);
  } else throw new Error('Use recovery inspect, backup, plan, apply or status with --data-dir. Owner confirmation is required for apply.');
  printResult(result);
} else if (command === 'uninstall') {
  const hostDir = resolve(arg('--host-dir') ?? (() => { throw new Error('--host-dir is required'); })());
  let status;
  try { status = await localRequest(dataDir, '/status'); } catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  if (status?.ready) throw new Error('runtime_active_stop_before_uninstall');
  const receiptPath = join(hostDir, 'webenvoy-installation.json');
  const configPath = join(hostDir, 'webenvoy.config.toml');
  const skillPath = join(hostDir, '.agents/skills/webenvoy-browser/SKILL.md');
  const profile = arg('--codex-profile');
  if (profile && !/^[a-z0-9-]{1,64}$/.test(profile)) throw new Error('invalid_codex_profile_name');
  const profileConfigPath = profile ? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), profile + '.config.toml') : undefined;
  const result = await uninstallManagedFiles({ receiptPath, identity: { data_dir: dataDir, host_dir: hostDir }, allowedPaths: [configPath, skillPath, ...(profileConfigPath ? [profileConfigPath] : [])] });
  if (result.uninstalled && !result.conflicts.length) await import('node:fs/promises').then(({ unlink }) => unlink(receiptPath));
  printResult(result);
} else if (command === 'start' || command === 'diagnose') {
  printResult(await ensureRuntime(dataDir));
} else if (command === 'stop') {
  const status = await localRequest(dataDir, '/status');
  await ownerRequest(dataDir, '/stop', { method: 'POST' });
  const pids = [status.pid, ...status.services.map(service => service.pid)];
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = pids.some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!active) { printResult({ stopped: true }); process.exit(0); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('runtime_stop_incomplete: diagnose before restarting');
} else if (command === 'app') {
  await ensureRuntime(dataDir);
  const { ELECTRON_RUN_AS_NODE: ignored, ...environment } = process.env;
  const child = spawn(process.execPath, [root], { detached: true, stdio: 'ignore', env: { ...environment, WEBENVOY_INSTALLED_RUNTIME_DIR: dataDir } });
  child.unref();
  printResult({ app_started: true, pid: child.pid });
} else throw new Error('Use setup, access, files, recovery, instance, agent, start, diagnose, app or stop with --data-dir.');

async function readCapabilityDefinitions() {
  return JSON.parse(await readFile(join(root, 'agent-entry/managed-capability-definitions.json'), 'utf8'));
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}
function assertExactObject(value, allowed, code) {
  assertObject(value, code);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(code);
  return value;
}
function assertString(value, code, { min = 1, max = 512 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(code);
  return value;
}
function assertField(value, schema, code) {
  if (schema.type === 'string') {
    assertString(value, code, { min: schema.minLength ?? 0, max: schema.maxLength ?? 2 ** 20 });
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) throw new Error(code);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(code);
    if (schema.format === 'webenvoy-public-origin') {
      let parsed; try { parsed = new URL(value); } catch { throw new Error(code); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(code);
    }
    if (schema.format === 'webenvoy-public-http-target') {
      let parsed; try { parsed = new URL(value); } catch { throw new Error(code); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new Error(code);
    }
    return;
  }
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum) || schema.not?.const === value)) throw new Error(code);
  if (schema.type === 'object') {
    assertObject(value, code);
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) throw new Error(code);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) throw new Error(code);
    for (const [key, child] of Object.entries(value)) assertField(child, schema.properties?.[key] ?? {}, code);
  }
}
function assertClientFile(value) {
  assertObject(value, 'client_configuration_invalid');
  assertString(value.data_dir, 'client_configuration_invalid');
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(value.credential)) throw new Error('client_configuration_invalid');
  return value;
}
function publicStatus(value) {
  const status = { ...value };
  for (const key of ['camoufoxArtifact', 'camoufoxUpstream', 'chromeOfficial']) delete status[key];
  if (status.camoufox_launch?.state === 'retired' && ['retired_binding', 'unqualified'].includes(status.camoufox_launch.reason)) status.camoufox_launch = { state: 'retired', reason: status.camoufox_launch.reason };
  else delete status.camoufox_launch;
  return status;
}
function assertTaskScope(scope, fileScope, code) {
  const keys = ['operations', 'profile_refs', 'origins', ...(fileScope ? ['file_refs'] : [])];
  assertExactObject(scope, keys, code);
  for (const key of ['operations', 'profile_refs', 'origins']) if (!Array.isArray(scope[key]) || scope[key].some(value => typeof value !== 'string')) throw new Error(code);
  if (fileScope === 'upload' && (!Array.isArray(scope.file_refs) || scope.file_refs.length !== 1 || typeof scope.file_refs[0] !== 'string')) throw new Error(code);
  if (fileScope === 'download' && (!Array.isArray(scope.file_refs) || scope.file_refs.length !== 0)) throw new Error(code);
}
function validateOperationRequest(value, definitions) {
  const code = 'operation_input_refused';
  const exposed = definitions.operations.filter(item => item.exposure === 'exposed');
  const fields = definitions.fields;
  assertObject(value, code);
  const allowedTop = ['idempotency_key', 'grant_id', 'operation', 'task_scope', ...Object.keys(fields)];
  if (Object.keys(value).some(key => !allowedTop.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key.length || value.idempotency_key.length > 512 || typeof value.grant_id !== 'string' || !value.grant_id.length || typeof value.operation !== 'string') throw new Error(code);
  const definition = exposed.find(item => item.id === value.operation);
  if (!definition) throw new Error(code);
  assertTaskScope(value.task_scope, definition.file_scope, code);
  if (!value.task_scope.operations.includes(definition.id)) throw new Error(code);
  if (definition.file_scope === 'upload' && !/^attachment:runtime\/[0-9a-f-]{36}$/.test(value.task_scope.file_refs[0])) throw new Error(code);
  for (const [key, field] of Object.entries(fields)) if (Object.hasOwn(value, key)) assertField(value[key], field, code);
  if (Object.keys(value).some(key => fields[key] && !definition.allowed.includes(key))) throw new Error(code);
  for (const key of definition.required) if (!Object.hasOwn(value, key)) throw new Error(code);
  for (const condition of definition.conditions ?? []) {
    if (condition.kind !== 'conditional_fields') continue;
    const when = condition.when ?? {};
    const matched = when.present ? Object.hasOwn(value, when.field) : when.absent ? !Object.hasOwn(value, when.field) : when.equals !== undefined ? value[when.field] === when.equals : false;
    if (!matched) continue;
    for (const key of condition.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(code);
    if ((condition.forbidden ?? []).some(key => Object.hasOwn(value, key))) throw new Error(code);
    for (const [key, constraints] of Object.entries(condition.constraints ?? {})) {
      if (!Object.hasOwn(value, key)) continue;
      if (constraints.maximum !== undefined && value[key] > constraints.maximum || constraints.maxLength !== undefined && value[key].length > constraints.maxLength || constraints.minLength !== undefined && value[key].length < constraints.minLength) throw new Error(code);
    }
  }
  for (const condition of definition.conditions ?? []) {
    if (condition.kind === 'page_selector' && condition.when === 'always' && !condition.required_any.some(key => Object.hasOwn(value, key))) throw new Error(code);
    if (condition.kind === 'file_scope' && condition.equals === 'file_ref' && value.task_scope.file_refs?.[0] !== value.file_ref) throw new Error(code);
  }
  return value;
}
function validateDescribeRequest(value, definitions) {
  const code = 'describe_input_refused';
  assertExactObject(value, ['operation', 'context', 'arguments'], code);
  assertString(value.operation, code);
  if (!(new RegExp(definitions.operation_pattern).test(value.operation))) throw new Error(code);
  if (value.context !== undefined) {
    const context = assertExactObject(value.context, ['grant_id', 'profile_ref', 'task_scope'], code);
    assertString(context.grant_id, code); assertString(context.profile_ref, code);
    assertTaskScope(context.task_scope, definitions.operations.find(item => item.id === value.operation)?.file_scope, code);
  }
  if (value.arguments !== undefined) {
    const draft = assertObject(value.arguments, code);
    const allowed = new Set(Object.keys(definitions.fields).filter(name => name !== 'profile_ref'));
    if (Object.keys(draft).some(key => !allowed.has(key))) throw new Error(code);
    for (const [key, field] of Object.entries(definitions.fields)) if (key !== 'profile_ref' && Object.hasOwn(draft, key)) assertField(draft[key], field, code);
  }
  return value;
}
function validateRecoveryRequest(value) {
  const code = 'recovery_input_refused';
  assertExactObject(value, ['idempotency_key', 'grant_id', 'operation', 'task_scope', 'profile_ref', 'backup_ref', 'operation_ref'], code);
  for (const key of ['idempotency_key', 'grant_id', 'profile_ref']) assertString(value[key], code);
  if (!['recovery.inspect', 'recovery.request', 'recovery.status'].includes(value.operation)) throw new Error(code);
  const scope = assertExactObject(value.task_scope, ['operations', 'profile_refs', 'origins'], code);
  for (const key of ['operations', 'profile_refs', 'origins']) if (!Array.isArray(scope[key]) || scope[key].some(item => typeof item !== 'string')) throw new Error(code);
  return value;
}
function validateSkillsRequest(value) {
  const code = 'skill_input_refused';
  assertExactObject(value, ['idempotency_key', 'grant_id', 'operation', 'task_scope', 'skill_ref', 'source_ref', 'revision_ref', 'target_revision_ref', 'expected_revision_ref', 'expected_current_revision_ref', 'expected_record_version'], code);
  for (const key of ['idempotency_key', 'grant_id']) assertString(value[key], code);
  if (!['skill.list', 'skill.inspect', 'skill.install', 'skill.enable', 'skill.read', 'skill.update', 'skill.rollback', 'skill.disable'].includes(value.operation)) throw new Error(code);
  const scope = assertExactObject(value.task_scope, ['operations', 'skill_refs', 'source_refs'], code);
  for (const key of ['operations', 'skill_refs', 'source_refs']) if (!Array.isArray(scope[key]) || scope[key].some(item => typeof item !== 'string')) throw new Error(code);
  return value;
}
async function runAgent(action, values) {
  let client;
  try { client = assertClientFile(await readClient(resolve(argFrom(values, '--client-file')))); }
  catch { throw new Error('client_configuration_invalid'); }
  const request = (path, body, start = true) => (start ? ensureRuntime(client.data_dir) : Promise.resolve()).then(() => localRequest(client.data_dir, path, { credential: client.credential, ...(body === undefined ? {} : { method: 'POST', body }) }));
  if (action === 'skill') return { skill: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8') };
  if (action === 'status') return publicStatus(await ensureRuntime(client.data_dir));
  if (action === 'connect') return request('/agent-connections', {});
  const definitions = await readCapabilityDefinitions();
  if (action === 'describe') {
    const value = validateDescribeRequest(await readJsonFile(argFrom(values, '--request-file'), 'describe_input_refused'), definitions);
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    return request('/managed-browser/capabilities/describe', { ...value, connection_id: connection.connection.connection_id }, false);
  }
  if (action === 'operation') {
    const value = validateOperationRequest(await readJsonFile(argFrom(values, '--request-file'), 'operation_input_refused'), definitions);
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    return request('/managed-browser/operations', { ...value, connection_id: connection.connection.connection_id }, false);
  }
  if (action === 'query') {
    let runId = argFrom(values, '--run-id');
    if (!runId) {
      const connection = await request('/agent-connections', {}, false);
      if (!connection?.connection?.principal_id) return connection;
      runId = `managed-${sha(`${connection.connection.principal_id}:${argFrom(values, '--idempotency-key')}`)}`;
    }
    if (!/^managed-[a-f0-9]{64}$/.test(runId)) throw new Error('query_input_refused');
    const skill = await request(`/managed-skills/operations/${runId}`, undefined, false);
    return skill?.error?.code === 'managed_skill_operation_not_found' ? request(`/managed-browser/operations/${runId}`, undefined, false) : skill;
  }
  if (action === 'recovery') {
    const value = validateRecoveryRequest(await readJsonFile(argFrom(values, '--request-file'), 'recovery_input_refused'));
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    return request('/managed-browser/operations', { ...value, connection_id: connection.connection.connection_id }, false);
  }
  if (action === 'skills') {
    const value = validateSkillsRequest(await readJsonFile(argFrom(values, '--request-file'), 'skill_input_refused'));
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    return request('/managed-skills/operations', { ...value, connection_id: connection.connection.connection_id }, false);
  }
  throw new Error('unknown_agent_command');
}
function argFrom(values, name) { const index = values.indexOf(name); return index < 0 ? undefined : values[index + 1]; }
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function readInstallation(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('installation_configuration_invalid');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.message === 'installation_configuration_invalid') throw error;
    throw new Error('installation_configuration_invalid');
  }
}

function required(name) { const value = arg(name); if (!value) throw new Error(`${name}_required`); return value; }
function requiredAny(...names) { for (const name of names) { const value = arg(name); if (value) return value; } throw new Error(`${names[0]}_required`); }
async function readJsonFile(path, invalidCode = 'recovery_json_file_invalid') { try { return JSON.parse(await readFile(resolve(path), 'utf8')); } catch { throw new Error(invalidCode); } }
function hostConfig(installRoot, clientPath, approveTools, includeRecovery, executable = join(installRoot, 'runtime/node')) {
  const legacyElectron = executable !== join(installRoot, 'runtime/node');
  let config = `[mcp_servers.webenvoy]\ncommand = ${JSON.stringify(executable)}\nargs = ${JSON.stringify([join(installRoot, 'agent-entry/mcp.mjs'), clientPath])}\nstartup_timeout_sec = 30\ntool_timeout_sec = 100\n${legacyElectron ? '[mcp_servers.webenvoy.env]\nELECTRON_RUN_AS_NODE = "1"\n' : ''}`;
  if (approveTools) for (const tool of ['webenvoy_skill', 'webenvoy_status', 'webenvoy_connect', 'webenvoy_describe', 'webenvoy_operation', 'webenvoy_query', 'webenvoy_skills', ...(includeRecovery ? ['webenvoy_recovery'] : [])]) config += `[mcp_servers.webenvoy.tools.${tool}]\napproval_mode = "approve"\n`;
  return config;
}
async function verifyPrevious(rootPath) {
  const suffix = '/Contents/Resources/app';
  const appPath = rootPath.endsWith(suffix) ? rootPath.slice(0, -suffix.length) : undefined;
  if (!appPath) throw new Error('previous_installation_host_unavailable');
  const executable = join(appPath, 'Contents/MacOS/Electron');
  try { return await verifyBundle(rootPath, { hostExecutable: executable }); } catch { throw new Error('previous_installation_integrity_failed'); }
}
async function previousLegacyFiles(input, configPaths, skillPath, clientPath) {
  const rootPath = await previousRoot(input);
  if (!rootPath) return [];
  await verifyPrevious(rootPath);
  const previousExecutable = rootPath.endsWith('/Contents/Resources/app') ? join(rootPath, '../../MacOS/Electron') : process.execPath;
  const legacy = [];
  for (const configPath of configPaths) try {
    const current = await readFile(configPath);
    for (const approve of [false, true]) {
      const candidate = Buffer.from(hostConfig(rootPath, clientPath, approve, false, previousExecutable));
      if (sha(current) === sha(candidate)) { legacy.push({ path: configPath, content: candidate }); break; }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const content = await readFile(join(rootPath, 'agent-entry/skills/webenvoy-browser/SKILL.md'));
    const current = await readFile(skillPath);
    if (sha(current) === sha(content)) legacy.push({ path: skillPath, content });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return legacy;
}
