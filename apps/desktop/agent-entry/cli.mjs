import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { recoveryOperationRef, root, sha, verifyBundle } from './bundle.mjs';
import { agentRequest, ensureAgentRuntime, ensureOwnerRuntime, ownerRequest, readClient } from './client.mjs';
import { agentDataSocket, verifyOsBoundary } from './os-boundary.mjs';
import { atomicWrite, installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { previousRoot } from './previous-installation.mjs';
import { CAMOUFOX_UPSTREAM_PINS, CHROME_OFFICIAL_INSTALL_SCHEMA, CHROME_OFFICIAL_PINS, classifyCamoufoxBinding, classifyChromeOfficialBinding, resolveCamoufoxSetupBinding, resolveChromeOfficialSetupBinding } from './provider-artifact.mjs';
import { validateDescribeRequest, validateOperationRequest, validateRecoveryRequest, validateSkillsRequest } from './request-validation.mjs';
const [command, ...args] = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };

const HELP = {
  root: `Usage: webenvoy <command> [options]

Commands:
  setup       Install or repair owner Runtime assets (owner-only)
  start       Start the local Runtime service (owner-only)
  diagnose    Read Runtime and installation health (owner-only)
  stop        Stop the local Runtime service (owner-only)
  uninstall   Remove receipt-managed host files (owner-only)
  access      Register, grant, revoke, and query owner access (owner-only)
  files       Manage owner-registered file references (owner-only)
  recovery    Inspect or apply owner-managed recovery (owner-only)
  instance    Discover and control a Runtime instance (owner-only)
  agent       Set up or consume the managed browser projection (Agent-only)
  help        Show this help without starting Runtime
  --version   Show the verified bundle version without starting Runtime

Use "webenvoy help <command>" for command syntax.`,
  access: `Usage: webenvoy access <list|register|grant|grant-v2|policy-v2|revoke|operation> --data-dir DIR

Owner control identity is required. Core receipt actions use the caller's stable
idempotency key: register/revoke take --idempotency-key; grant, grant-v2 and
  policy-v2 require idempotency_key in their JSON file. operation queries the
  original caller key with --operation-ref. Reuse the original key after a lost
  response; never create a new key.`,
  setup: `Usage: webenvoy setup --data-dir OWNER_DIR [--agent-uid UID]

Owner setup verifies the standalone bundle and writes owner installation facts.
Without an existing Agent UID binding, omitting --agent-uid defaults to the
owner UID and selects trusted local mode; same-UID processes are not
OS-isolated from each other. A separate verified non-admin UID selects the
hardened OS boundary. Both modes use the Agent route, credential, and Core
Grant checks. --host-dir remains a legacy-compatible ignored option; the Agent
creates its own host assets with agent setup.`,
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
result; omit --expected-control-file to use the immediately fresh inspect, or
pass a strictly validated file to bind an earlier snapshot. stop targets the exact
--runtime-session-ref and never stops Runtime. Reads never start Runtime; a lost
write response requires fresh inspect and never a new key.`,
  agent: `Usage: webenvoy agent <setup|uninstall|status|skill|connect|describe|operation|query|recovery|skills> [role-specific options]

Agent setup is separate: run as the configured Agent identity (the owner UID
for trusted local mode, or the independent Agent UID for hardened mode) with
webenvoy agent setup --host-dir DIR --data-dir OWNER_DIR --owner-uid UID
[--agent-endpoint SOCKET]. It only creates the Agent-owned client file and
host assets; it never calls owner/Core or grants access. Other Agent commands
use only the installed client credential. request files are
strictly validated against the installed managed capability definitions;
connection_id, principal_id, owner credentials and supervisor tokens are
rejected. query only reads the original run_id or idempotency key and never
replays an operation. Agent commands are non-interactive and cannot confirm
owner actions.`,
  'agent setup': `Usage: webenvoy agent setup --host-dir DIR --data-dir OWNER_DIR --owner-uid UID [--agent-endpoint SOCKET]

Run this command as the configured Agent identity. It creates or reuses only
the Agent-owned client credential, MCP host configuration, SKILL and receipt.
The owner must first run setup (optionally binding --agent-uid UID) and then
register the printed fingerprint; setup never contacts Runtime, Core, or the
owner control socket.
Same-UID mode trusts the local user domain and provides no OS isolation.`,
  'agent uninstall': `Usage: webenvoy agent uninstall --host-dir DIR --data-dir OWNER_DIR

Run as the Agent UID. This removes only receipt-managed MCP/SKILL host files and
the Agent receipt after conflict checks; it keeps web envoy-client.json and all
owner data, Grants, Runs and recovery facts.`,
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
  '--client-file', '--request-file', '--run-id', '--runtime-session-ref', '--expected-control-file', '--agent-uid', '--owner-uid', '--agent-endpoint'
]);
const COMMAND_FLAGS = new Map([
  ['setup', new Set(['--data-dir', '--host-dir', '--agent-uid', '--codex-profile', '--approve-tools', '--previous-installation', '--browser-install-root', '--browser-root', '--browser-executable', '--python-path', '--python', '--browser-version', '--camoufox-version', '--playwright-version', '--browser-source-path', '--browser-source', '--browser-archive', '--camoufox-source-path', '--camoufox-source', '--camoufox-wheel', '--playwright-source-path', '--playwright-source', '--playwright-wheel', '--browser-executable-sha256', '--python-executable-sha256', '--camoufox-artifact', '--chrome-install-root', '--chrome-browser-root', '--chrome-executable', '--chrome-python-path', '--chrome-python', '--chrome-version', '--chrome-playwright-version', '--chrome-source-path', '--chrome-source', '--chrome-archive', '--chrome-executable-sha256'])],
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
  ['agent:setup', new Set(['--host-dir', '--data-dir', '--owner-uid', '--agent-endpoint'])],
  ['agent:uninstall', new Set(['--host-dir', '--data-dir'])],
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
  if (name === 'agent' && (action === 'setup' || action === 'uninstall')) {
    for (const flag of action === 'setup' ? ['--host-dir', '--data-dir', '--owner-uid'] : ['--host-dir', '--data-dir']) if (!seen.has(flag)) throw cliError(`${flag}_required`);
    if (action === 'uninstall' && seen.has('--owner-uid')) throw cliError('agent_uninstall_flag_invalid');
    if (seen.has('--client-file') || seen.has('--run-id') || seen.has('--idempotency-key')) throw cliError('agent_setup_flag_invalid');
  } else if (name === 'agent') {
    if (!seen.has('--client-file')) throw cliError('--client-file_required');
    if (seen.has('--data-dir') || seen.has('--host-dir') || seen.has('--owner-uid') || seen.has('--agent-endpoint')) throw cliError('agent_setup_only_flag');
    if (action === 'query' && (seen.has('--run-id') === seen.has('--idempotency-key'))) throw cliError('agent_query_selector_required');
    if (action !== 'query' && (seen.has('--run-id') || seen.has('--idempotency-key'))) throw cliError('agent_query_selector_forbidden');
  }
}

function printHelp(topic) { process.stdout.write(`${HELP[topic] ?? HELP.root}\n`); }

function exitCodeFor(value) {
  const status = value?.status;
  const errorCode = value?.error?.code ?? value?.failure?.code;
  if (value?.dispatch_state === 'possibly_dispatched' || ['unknown_outcome', 'managed_browser_outcome_unknown', 'runtime_unavailable_unknown_outcome'].includes(status) || ['managed_browser_outcome_unknown', 'runtime_unavailable_unknown_outcome'].includes(errorCode)) return 6;
  if (['runtime_unavailable', 'runtime_unavailable_query_without_replay', 'discovery_not_available', 'bundle_unavailable'].includes(errorCode)) return 7;
  if (status === 'unavailable') return 5;
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
  process.exitCode = ['runtime_unavailable', 'runtime_response_aborted', 'runtime_timeout', 'runtime_start_failed', 'owner_control_helper_missing'].includes(code) ? 7 : ['owner_agent_isolation_unavailable', 'owner_only_denied'].includes(code) ? 3 : code.startsWith('unknown_') || code.includes('required') || code.includes('invalid') || code.includes('duplicate') || code.includes('flag') || code.includes('input_refused') || code.includes('unsupported') ? 2 : 8;
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
if (command === 'app') throw new Error('app_unsupported_formal_runtime');
const linkedData = command === 'agent' ? {} : await readFile(join(root, '../webenvoy-installation.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return {}; });
const agentLocalAction = command === 'agent' && ['setup', 'uninstall'].includes(args[0]);
const dataDir = command === 'agent' && !agentLocalAction ? undefined : resolve(arg('--data-dir') ?? (command === 'agent' ? (() => { throw new Error('--data-dir is required for agent setup/uninstall'); })() : linkedData.data_dir ?? (() => { throw new Error('--data-dir is required; choose a dedicated persistent directory'); })()));
if (command === 'setup') {
  if (dataDir.startsWith(root + '/') || root.startsWith(dataDir + '/') || dataDir === root) throw new Error('Profile data must be separate from installation assets');
  try { const active = await ownerRequest(dataDir, '/status'); if (active.ready) throw new Error('runtime_active_stop_before_setup'); } catch (error) { if (error.message === 'runtime_active_stop_before_setup' || !['ENOENT', 'ECONNREFUSED', 'owner_endpoint_invalid'].includes(error.code)) throw error; }
  const assets = await verifyBundle();
  if (arg('--previous-installation')) {
    const previous = await previousRoot(arg('--previous-installation'));
    await verifyPrevious(previous);
  }
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
  const ownerUid = process.getuid?.();
  const configuredAgentUid = arg('--agent-uid') === undefined
    ? existingInstallation?.agent_uid ?? ownerUid
    : parseUid(arg('--agent-uid'), 'agent_uid_invalid');
  if (arg('--agent-uid') !== undefined && existingInstallation?.agent_uid !== undefined && existingInstallation.agent_uid !== configuredAgentUid) throw new Error('agent_uid_binding_mismatch');
  if (configuredAgentUid !== undefined && (!Number.isSafeInteger(ownerUid) || ownerUid < 1 || configuredAgentUid < 1)) throw new Error('agent_uid_invalid');
  const endpoint = configuredAgentUid === undefined ? undefined : agentDataSocket({ data_dir: dataDir });
  const boundary = configuredAgentUid === undefined
    ? { state: 'disabled', code: 'owner_agent_isolation_unavailable', reason_codes: ['agent_uid_missing'] }
    : verifyOsBoundary({ ownerUid, agentUid: configuredAgentUid, ownerSocketPath: join(dataDir, 'owner-control.sock'), installRoot: root });
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
  if (endpoint) installation = { ...installation, owner_uid: ownerUid, agent_uid: configuredAgentUid, agent_endpoint: endpoint, os_boundary: { state: boundary.state, mode: boundary.mode, code: boundary.code, reason_codes: boundary.reason_codes } };
  else if (installation.os_boundary || installation.agent_uid || installation.agent_endpoint) {
    const { owner_uid: ignoredOwnerUid, agent_uid: ignoredAgentUid, agent_endpoint: ignoredEndpoint, os_boundary: ignoredBoundary, ...withoutBoundary } = installation;
    installation = withoutBoundary;
  }
  const profile = arg('--codex-profile');
  if (profile && !/^[a-z0-9-]{1,64}$/.test(profile)) throw new Error('invalid_codex_profile_name');
  if (!existingInstallation || JSON.stringify(installation) !== JSON.stringify(existingInstallation)) await atomicWrite(installationPath, JSON.stringify(installation));
  const agentEnabled = Boolean(endpoint && boundary.state === 'supported');
  printResult({
    installed: true,
    camoufox_launch: classifyCamoufoxBinding(installation),
    chrome_launch: classifyChromeOfficialBinding(installation),
    boundary: endpoint ? { state: boundary.state, mode: boundary.mode, code: boundary.code, reason_codes: boundary.reason_codes } : { state: 'disabled', mode: 'unconfigured', code: 'owner_agent_isolation_unavailable', reason_codes: ['agent_uid_missing'] },
    ...(agentEnabled ? { bootstrap: { data_dir: dataDir, agent_endpoint: endpoint, owner_uid: ownerUid, agent_uid: configuredAgentUid } } : {}),
    next: agentEnabled
      ? `As ${boundary.mode === 'trusted_local' ? 'the owner user' : `Agent UID ${configuredAgentUid}`}, run webenvoy agent setup --host-dir DIR --data-dir ${dataDir} --owner-uid ${ownerUid}; then owner registers that fingerprint with access register.`
      : 'owner_agent_isolation_unavailable: owner maintenance is installed; configure a trusted local or separately verified Agent UID before enabling Agent data plane.'
  });
} else if (command === 'agent' && args[0] === 'setup') {
  printResult(await runAgentSetup(args));
} else if (command === 'agent' && args[0] === 'uninstall') {
  printResult(await runAgentUninstall(args));
} else if (command === 'agent') {
  printResult(await runAgent(args[0], args));
} else if (command === 'access') {
  const action = args[0];
  const requestOwner = (path, body) => body === undefined ? ownerRequest(dataDir, path) : ownerWriteRequest(dataDir, path, body);
  let result;
  if (action === 'list') {
    result = await requestOwner('/agent-access');
  } else if (action === 'register') {
    const credentialHash = required('--credential-hash');
    if (!/^[a-f0-9]{64}$/i.test(credentialHash)) throw new Error('credential_hash_invalid');
    const input = { idempotency_key: required('--idempotency-key'), display_name: required('--display-name'), credential_hash: credentialHash };
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/agent-access/principals', input);
  } else if (action === 'grant') {
    const value = await readJsonFile(required('--grant-file'), 'access_grant_file_invalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_grant_file_invalid');
    const allowed = ['idempotency_key', 'principal_id', 'profile_refs', 'allowed_operations', 'allowed_origins', 'expires_at', 'creation_template', 'max_created_profiles', 'skill_scope', 'file_scope'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key) throw new Error('access_grant_file_invalid');
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/agent-access/grants', value);
  } else if (action === 'grant-v2') {
    if (!args.includes('--confirm')) throw new Error('access_confirmation_required');
    const value = await readJsonFile(required('--grant-file'), 'access_v2_grant_file_invalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_v2_grant_file_invalid');
    const allowed = ['idempotency_key', 'source_grant_id', 'source_grant_digest', 'principal_id', 'profile_refs', 'policy_digest', 'allowed_operations', 'allowed_origins', 'expires_at', 'skill_scope', 'file_scope', 'replaces_grant_id', 'replaces_grant_digest'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key) throw new Error('access_v2_grant_file_invalid');
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/agent-access/v2/grants', value);
  } else if (action === 'policy-v2') {
    if (!args.includes('--confirm')) throw new Error('access_confirmation_required');
    const value = await readJsonFile(required('--policy-file'), 'access_v2_policy_file_invalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_v2_policy_file_invalid');
    const allowed = ['idempotency_key', 'profile_ref', 'current_policy_digest', 'allowed_operations', 'allowed_origins', 'controlled_interaction_origins'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key) throw new Error('access_v2_policy_file_invalid');
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/agent-access/v2/profile-policies', value);
  } else if (action === 'revoke') {
    const kind = required('--kind');
    if (!['principals', 'connections', 'grants'].includes(kind)) throw new Error('access_revoke_kind_invalid');
    const id = required('--id');
    const idempotencyKey = required('--idempotency-key');
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner(`/agent-access/${kind}/${encodeURIComponent(id)}/revoke`, { idempotency_key: idempotencyKey });
  } else if (action === 'operation') {
    result = await requestOwner(`/agent-access/operations/${encodeURIComponent(required('--operation-ref'))}`);
  } else throw new Error('Use access list, register, grant, grant-v2, policy-v2, revoke or operation with --data-dir. Owner credentials stay local.');
  printResult(result);
} else if (command === 'files') {
  const action = args[0];
  const requestOwner = (path, body) => body === undefined ? ownerRequest(dataDir, path) : ownerWriteRequest(dataDir, path, body);
  let result;
  if (action === 'import') {
    const input = { source_path: resolve(required('--source-path')), profile_ref: required('--profile-ref'),
      ...(arg('--display-name') === undefined ? {} : { display_name: arg('--display-name') }),
      ...(arg('--mime-type') === undefined ? {} : { mime_type: arg('--mime-type') }),
      ...(arg('--operation-ref') === undefined ? {} : { operation_ref: arg('--operation-ref') }) };
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/owner/files/import', input);
  } else if (action === 'inspect') {
    const fileRef = arg('--file-ref');
    result = await requestOwner(fileRef === undefined ? '/owner/files' : `/owner/files?file_ref=${encodeURIComponent(fileRef)}`);
  } else if (action === 'export') {
    const input = { file_ref: required('--file-ref'), destination_path: resolve(required('--destination-path')) };
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/owner/files/export', input);
  } else if (action === 'revoke' || action === 'delete') {
    const input = { file_ref: required('--file-ref') };
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner(`/owner/files/${action}`, input);
  } else throw new Error('Use files import, inspect, export, revoke or delete with --data-dir. Owner file paths never enter Agent requests.');
  printResult(result);
} else if (command === 'recovery') {
  const action = args[0];
  const requestOwner = (path, body) => body === undefined ? ownerRequest(dataDir, path) : ownerWriteRequest(dataDir, path, body);
  let result;
  if (action === 'inspect') {
    const profileRef = required('--profile-ref');
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/owner/recovery/inspect', { idempotency_key: arg('--idempotency-key') ?? `owner-recovery-inspect:${randomBytes(16).toString('hex')}`, profile_ref: profileRef });
  } else if (action === 'backup') {
    const profileRef = required('--profile-ref');
    const input = { idempotency_key: required('--idempotency-key'), profile_ref: profileRef };
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/owner/recovery/backup', input);
  } else if (action === 'plan') {
    const input = { idempotency_key: required('--idempotency-key'), profile_ref: required('--profile-ref'), backup_ref: required('--backup-ref') };
    await ensureOwnerRuntime(dataDir);
    result = await requestOwner('/owner/recovery/plan', input);
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
    await ensureOwnerRuntime(dataDir);
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
} else if (command === 'instance') {
  const action = args[0];
  const requestOwner = (path, body) => body === undefined ? ownerRequest(dataDir, path) : ownerWriteRequest(dataDir, path, body);
  if (action === 'list') {
    const profileRef = arg('--profile-ref');
    printResult(await requestOwner(profileRef === undefined ? '/runtime/sessions' : `/runtime/sessions?profile_ref=${encodeURIComponent(profileRef)}`));
  } else if (action === 'inspect') {
    const ref = required('--runtime-session-ref');
    printResult(await readInstanceFacts(dataDir, ref));
  } else if (action === 'takeover' || action === 'handback') {
    const ref = required('--runtime-session-ref');
    const expectedControlPath = arg('--expected-control-file');
    const providedExpectedControl = expectedControlPath === undefined ? undefined : await readExpectedControl(expectedControlPath);
    await ensureOwnerRuntime(dataDir);
    const current = await readInstanceFacts(dataDir, ref);
    if (current?.error || current?.ok === false || current?.status === 'unavailable') printResult(current);
    else {
      const projection = controlProjection(current);
      const expectedControl = providedExpectedControl ?? projection;
      if (action === 'takeover') {
        if (projection.control_owner === 'user' && projection.lock_owner === 'user' && projection.lock_state === 'held') {
          printResult({ status: 'already_user', ...current, expected_control: projection });
        } else if (projection.control_owner === 'core_task' && projection.lock_owner === 'core_task' && projection.lock_state === 'held') {
          printResult(await requestOwner(`/runtime/sessions/${encodeURIComponent(ref)}/handoff`, { control_owner: 'user', expected_control_owner: 'core_task', handoff_reason: 'user_requested', ...(projection.holder_ref === null ? {} : { holder_ref: projection.holder_ref }), expected_control: expectedControl }));
        } else if (projection.control_owner === 'none' && projection.lock_owner === 'none' && projection.lock_state === 'released') {
          printResult(await requestOwner(`/runtime/sessions/${encodeURIComponent(ref)}/lock`, { control_owner: 'user', holder_ref: 'harbor_mediated_user', expected_control: expectedControl }));
        } else printResult({ ok: false, status: 'unavailable', error: { code: 'control_state_unavailable' }, ...current });
      } else if (projection.control_owner === 'user' && projection.lock_owner === 'user' && projection.lock_state === 'held') {
        if (!projection.holder_ref) throw new Error('control_holder_ref_missing');
        printResult(await requestOwner(`/runtime/sessions/${encodeURIComponent(ref)}/release`, { control_owner: 'user', holder_ref: projection.holder_ref, expected_control: expectedControl }));
      } else if (projection.control_owner === 'none' && projection.lock_owner === 'none' && projection.lock_state === 'released') {
        printResult({ status: 'already_released', ...current, expected_control: projection });
      } else printResult({ ok: false, status: 'unavailable', error: { code: 'control_state_unavailable' }, ...current });
    }
  } else if (action === 'stop') {
    const ref = required('--runtime-session-ref');
    printResult(await requestOwner(`/runtime/sessions/${encodeURIComponent(ref)}/stop`, {}));
  } else throw new Error('Use instance list, inspect, takeover, handback or stop with --data-dir.');
} else if (command === 'uninstall') {
  const hostDir = resolve(arg('--host-dir') ?? (() => { throw new Error('--host-dir is required'); })());
  let status;
  try { status = await ownerRequest(dataDir, '/status'); } catch (error) { if (!['ENOENT', 'ECONNREFUSED', 'owner_endpoint_invalid'].includes(error.code)) throw error; }
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
} else if (command === 'start') {
  printResult(await ensureOwnerRuntime(dataDir));
} else if (command === 'diagnose') {
  printResult(await ownerRequest(dataDir, '/status'));
} else if (command === 'stop') {
  const status = await ownerRequest(dataDir, '/status');
  const stopResult = await ownerWriteRequest(dataDir, '/stop');
  if (stopResult?.dispatch_state === 'possibly_dispatched') {
    printResult(stopResult);
    process.exit(6);
  }
  const pids = [status.pid, ...(status.services ?? []).map(service => service.pid)];
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = pids.some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!active) { printResult({ stopped: true }); process.exit(0); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('runtime_stop_incomplete: diagnose before restarting');
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
function publicStatus(value) {
  const status = { ...value };
  for (const key of ['camoufoxArtifact', 'camoufoxUpstream', 'chromeOfficial']) delete status[key];
  if (status.camoufox_launch?.state === 'retired' && ['retired_binding', 'unqualified'].includes(status.camoufox_launch.reason)) status.camoufox_launch = { state: 'retired', reason: status.camoufox_launch.reason };
  else delete status.camoufox_launch;
  return status;
}

async function runAgentSetup(values) {
  const hostDir = resolve(argFrom(values, '--host-dir'));
  const ownerDataDir = resolve(argFrom(values, '--data-dir'));
  const ownerUid = parseUid(argFrom(values, '--owner-uid'), 'owner_uid_invalid');
  const agentUid = process.getuid?.();
  if (!Number.isSafeInteger(agentUid) || agentUid < 1 || ownerUid < 1) throw new Error('owner_agent_isolation_unavailable');
  const endpoint = agentDataSocket({ data_dir: ownerDataDir, agent_endpoint: argFrom(values, '--agent-endpoint') });
  if (endpoint === join(ownerDataDir, 'owner-control.sock')) throw new Error('agent_endpoint_invalid');
  await mkdir(hostDir, { recursive: true, mode: 0o700 });
  const hostInfo = await lstat(hostDir).catch(() => null);
  if (!hostInfo || !hostInfo.isDirectory() || hostInfo.isSymbolicLink() || hostInfo.uid !== agentUid || (hostInfo.mode & 0o777) !== 0o700) throw new Error('agent_host_directory_invalid');
  const assets = await verifyBundle();
  const clientPath = join(hostDir, 'webenvoy-client.json');
  let client;
  try {
    client = await readClient(clientPath);
    if (client.data_dir !== ownerDataDir || client.agent_endpoint !== endpoint || client.owner_uid !== ownerUid || client.agent_uid !== agentUid) throw new Error('existing_client_configuration_mismatch');
  } catch (error) {
    if (error.message === 'existing_client_configuration_mismatch') throw error;
    if (error.code !== 'ENOENT') throw new Error('client_configuration_invalid');
    client = { data_dir: ownerDataDir, credential: randomBytes(32).toString('base64url'), agent_endpoint: endpoint, owner_uid: ownerUid, agent_uid: agentUid };
    await writeFile(clientPath, JSON.stringify(client), { mode: 0o600, flag: 'wx' });
    client = await readClient(clientPath);
  }
  await mkdir(join(hostDir, '.agents/skills/webenvoy-browser'), { recursive: true, mode: 0o700 });
  const config = hostConfig(root, clientPath, false, true);
  const configPath = join(hostDir, 'webenvoy.config.toml');
  const skillPath = join(hostDir, '.agents/skills/webenvoy-browser/SKILL.md');
  await installManagedFiles({
    receiptPath: join(hostDir, 'webenvoy-installation.json'),
    identity: { data_dir: ownerDataDir, host_dir: hostDir, asset_digest: assets.digest, workspace: assets.workspace, owner_uid: ownerUid, agent_uid: agentUid, agent_endpoint: endpoint },
    files: [
      { path: configPath, content: config },
      { path: skillPath, content: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md')) }
    ]
  });
  return { installed: true, credential_fingerprint: sha(client.credential), boundary: { state: 'pending_owner_registration', ...(ownerUid === agentUid ? { mode: 'trusted_local' } : {}), owner_uid: ownerUid, agent_uid: agentUid, agent_endpoint: endpoint }, next: 'Owner registers this fingerprint with access register and grants the minimum scope.' };
}

async function runAgentUninstall(values) {
  const hostDir = resolve(argFrom(values, '--host-dir'));
  const ownerDataDir = resolve(argFrom(values, '--data-dir'));
  const agentUid = process.getuid?.();
  const hostInfo = await lstat(hostDir).catch(() => null);
  if (!hostInfo || !hostInfo.isDirectory() || hostInfo.isSymbolicLink() || hostInfo.uid !== agentUid || (hostInfo.mode & 0o777) !== 0o700) throw new Error('agent_host_directory_invalid');
  const configPath = join(hostDir, 'webenvoy.config.toml');
  const skillPath = join(hostDir, '.agents/skills/webenvoy-browser/SKILL.md');
  const receiptPath = join(hostDir, 'webenvoy-installation.json');
  const result = await uninstallManagedFiles({ receiptPath, identity: { data_dir: ownerDataDir, host_dir: hostDir }, allowedPaths: [configPath, skillPath] });
  if (result.uninstalled && !result.conflicts.length) await unlink(receiptPath);
  return { ...result, client_preserved: true, data_preserved: true };
}

async function runAgent(action, values) {
  let client;
  try { client = await readClient(resolve(argFrom(values, '--client-file'))); }
  catch { throw new Error('client_configuration_invalid'); }
  const request = async (path, body, start = true) => {
    if (start) await ensureAgentRuntime(client);
    return agentRequest(client, path, { credential: client.credential, ...(body === undefined ? {} : { method: 'POST', body }) });
  };
  if (action === 'skill') return { skill: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8') };
  if (action === 'status') return publicStatus(await ensureAgentRuntime(client));
  if (action === 'connect') return request('/agent-connections', {});
  if (action === 'describe') {
    const definitions = await readCapabilityDefinitions();
    const value = validateDescribeRequest(await readJsonFile(argFrom(values, '--request-file'), 'describe_input_refused'), definitions);
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    return request('/managed-browser/capabilities/describe', { ...value, connection_id: connection.connection.connection_id }, false);
  }
  if (action === 'operation') {
    const definitions = await readCapabilityDefinitions();
    const value = validateOperationRequest(await readJsonFile(argFrom(values, '--request-file'), 'operation_input_refused'), definitions);
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    try { return await request('/managed-browser/operations', { ...value, connection_id: connection.connection.connection_id }, false); }
    catch (error) { if (isDispatchedResponseLoss(error)) return unknownAgentOutcome(value.idempotency_key); throw error; }
  }
  if (action === 'query') {
    let runId = argFrom(values, '--run-id');
    const idempotencyKey = argFrom(values, '--idempotency-key');
    if (runId !== undefined && !/^managed-[a-f0-9]{64}$/.test(runId) || idempotencyKey !== undefined && (!idempotencyKey.length || idempotencyKey.length > 512)) throw new Error('query_input_refused');
    if (!runId) {
      const connection = await request('/agent-connections', {}, false);
      if (!connection?.connection?.principal_id) return connection;
      runId = `managed-${sha(`${connection.connection.principal_id}:${idempotencyKey}`)}`;
    }
    if (!/^managed-[a-f0-9]{64}$/.test(runId)) throw new Error('query_input_refused');
    const skill = await request(`/managed-skills/operations/${runId}`, undefined, false);
    return skill?.error?.code === 'managed_skill_operation_not_found' ? request(`/managed-browser/operations/${runId}`, undefined, false) : skill;
  }
  if (action === 'recovery') {
    const value = validateRecoveryRequest(await readJsonFile(argFrom(values, '--request-file'), 'recovery_input_refused'));
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    try { return await request('/managed-browser/operations', { ...value, connection_id: connection.connection.connection_id }, false); }
    catch (error) { if (isDispatchedResponseLoss(error)) return unknownAgentOutcome(value.idempotency_key); throw error; }
  }
  if (action === 'skills') {
    const value = validateSkillsRequest(await readJsonFile(argFrom(values, '--request-file'), 'skill_input_refused'));
    const connection = await request('/agent-connections', {});
    if (!connection?.connection?.connection_id) return connection;
    try { return await request('/managed-skills/operations', { ...value, connection_id: connection.connection.connection_id }, false); }
    catch (error) { if (isDispatchedResponseLoss(error)) return unknownAgentOutcome(value.idempotency_key); throw error; }
  }
  throw new Error('unknown_agent_command');
}
async function ownerWriteRequest(dataDir, path, body = {}) {
  try {
    return await ownerRequest(dataDir, path, { method: 'POST', body });
  } catch (error) {
    if (!isDispatchedResponseLoss(error)) throw error;
    return {
      ok: false,
      status: 'unknown_outcome',
      dispatch_state: 'possibly_dispatched',
      ...(typeof body?.idempotency_key === 'string' ? { idempotency_key: body.idempotency_key } : {}),
      error: { code: 'runtime_unavailable_unknown_outcome' }
    };
  }
}
function isDispatchedResponseLoss(error) {
  return ['runtime_response_aborted', 'runtime_response_invalid', 'runtime_timeout', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(error?.code ?? error?.message?.split(':', 1)[0]);
}
function unknownAgentOutcome(idempotencyKey) {
  return { ok: false, status: 'unknown_outcome', dispatch_state: 'dispatched', idempotency_key: idempotencyKey, failure: { code: 'managed_browser_outcome_unknown' }, reconciliation: null };
}
function argFrom(values, name) { const index = values.indexOf(name); return index < 0 ? undefined : values[index + 1]; }
async function readInstanceFacts(dataDir, runtimeSessionRef) {
  const encoded = encodeURIComponent(runtimeSessionRef);
  const session = await ownerRequest(dataDir, `/runtime/sessions/${encoded}`);
  if (session?.error || session?.ok === false || session?.status === 'unavailable') return session;
  return { session };
}

function controlProjection(value) {
  const session = value?.session ?? value;
  const facts = value?.runtime_facts ?? {};
  const lock = session?.control_lock ?? facts.control_lock ?? {};
  const controlOwner = session?.control_owner ?? facts.control_owner;
  const lockOwner = lock.owner;
  const lockState = lock.state;
  const holderRef = Object.hasOwn(lock, 'holder_ref') ? lock.holder_ref : null;
  if (!['core_task', 'user', 'none'].includes(controlOwner) || !['core_task', 'user', 'none'].includes(lockOwner) || !['held', 'released', 'closed'].includes(lockState) || (holderRef !== null && typeof holderRef !== 'string') || !Number.isSafeInteger(session?.control_generation ?? facts.control_generation) || (session?.control_generation ?? facts.control_generation) < 0) throw new Error('control_state_unavailable');
  return { schema_version: 'harbor-control-precondition/v1', control_owner: controlOwner, lock_owner: lockOwner, lock_state: lockState, holder_ref: holderRef, control_generation: session?.control_generation ?? facts.control_generation };
}

async function readExpectedControl(path) {
  const value = await readJsonFile(path, 'expected_control_invalid');
  const expected = assertExactObject(value, ['schema_version', 'control_owner', 'lock_owner', 'lock_state', 'holder_ref', 'control_generation'], 'expected_control_invalid');
  if (expected.schema_version !== 'harbor-control-precondition/v1' || !['core_task', 'user', 'none'].includes(expected.control_owner) || !['core_task', 'user', 'none'].includes(expected.lock_owner) || !['held', 'released', 'closed'].includes(expected.lock_state) || (expected.holder_ref !== null && typeof expected.holder_ref !== 'string') || !Number.isSafeInteger(expected.control_generation) || expected.control_generation < 0) throw new Error('expected_control_invalid');
  return expected;
}

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

function parseUid(value, code) {
  if (!/^[1-9][0-9]{0,9}$/.test(String(value ?? ''))) throw new Error(code);
  const uid = Number(value);
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error(code);
  return uid;
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
