import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { recoveryOperationRef, root, sha, verifyBundle } from './bundle.mjs';
import { ensureRuntime, localRequest, readClient } from './client.mjs';
import { installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { previousRoot } from './previous-installation.mjs';
const [command, ...args] = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const linkedData = await readFile(join(root, '../webenvoy-installation.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return {}; });
const dataDir = resolve(arg('--data-dir') ?? linkedData.data_dir ?? (() => { throw new Error('--data-dir is required for setup; choose a dedicated persistent directory'); })());
if (command === 'setup') {
  const hostDir = resolve(arg('--host-dir') ?? (() => { throw new Error('--host-dir is required'); })());
  if (dataDir.startsWith(root + '/') || root.startsWith(dataDir + '/') || dataDir === root) throw new Error('Profile data must be separate from installation assets');
  try { const active = await localRequest(dataDir, '/status'); if (active.ready) throw new Error('runtime_active_stop_before_setup'); } catch (error) { if (error.message === 'runtime_active_stop_before_setup' || !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  const assets = await verifyBundle();
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
  try { await readFile(join(dataDir, 'installation.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const ports = await Promise.all([reservePort(), reservePort()]);
    await writeFile(join(dataDir, 'installation.json'), JSON.stringify({ coreEndpoint: `http://127.0.0.1:${ports[0]}`, harborEndpoint: `http://127.0.0.1:${ports[1]}` }), { mode: 0o600, flag: 'wx' });
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
  console.log(JSON.stringify({ installed: true, credential_fingerprint: sha(client.credential), host_configuration: join(hostDir, 'webenvoy.config.toml'), next: 'Install this isolated Codex profile, open App with the same --data-dir, then explicitly register this fingerprint and grant access.' }));
} else if (command === 'access') {
  const action = args[0];
  const status = await ensureRuntime(dataDir);
  const owner = JSON.parse(await readFile(join(dataDir, 'owner.json'), 'utf8'));
  if (owner.runtime_id !== status.runtime_id || typeof owner.credential !== 'string' || !owner.credential.length) throw new Error('owner_runtime_mismatch');
  const requestOwner = (path, body) => localRequest(dataDir, path, { credential: owner.credential, ...(body === undefined ? {} : { method: 'POST', body }) });
  let result;
  if (action === 'list') {
    result = await requestOwner('/agent-access');
  } else if (action === 'register') {
    result = await requestOwner('/agent-access/principals', { idempotency_key: arg('--idempotency-key') ?? `owner-principal:${randomBytes(16).toString('hex')}`, display_name: required('--display-name'), credential_hash: required('--credential-hash') });
  } else if (action === 'grant') {
    const value = await readJsonFile(required('--grant-file'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('access_grant_file_invalid');
    const allowed = ['idempotency_key', 'principal_id', 'profile_refs', 'allowed_operations', 'allowed_origins', 'expires_at', 'creation_template', 'max_created_profiles', 'skill_scope'];
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('access_grant_file_invalid');
    result = await requestOwner('/agent-access/grants', value);
  } else if (action === 'revoke') {
    const kind = required('--kind');
    if (!['principals', 'connections', 'grants'].includes(kind)) throw new Error('access_revoke_kind_invalid');
    const id = required('--id');
    result = await requestOwner(`/agent-access/${kind}/${encodeURIComponent(id)}/revoke`, { idempotency_key: required('--idempotency-key') });
  } else if (action === 'operation') {
    result = await requestOwner(`/agent-access/operations/${encodeURIComponent(required('--operation-ref'))}`);
  } else throw new Error('Use access list, register, grant, revoke or operation with --data-dir. Owner credentials stay local.');
  console.log(JSON.stringify(result));
} else if (command === 'recovery') {
  const action = args[0];
  const status = await ensureRuntime(dataDir);
  const owner = JSON.parse(await readFile(join(dataDir, 'owner.json'), 'utf8'));
  if (owner.runtime_id !== status.runtime_id || typeof owner.credential !== 'string' || !owner.credential.length) throw new Error('owner_runtime_mismatch');
  const requestOwner = (path, body) => localRequest(dataDir, path, { credential: owner.credential, ...(body === undefined ? {} : { method: 'POST', body }) });
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
  console.log(JSON.stringify(result));
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
  console.log(JSON.stringify(result));
} else if (command === 'start' || command === 'diagnose') {
  console.log(JSON.stringify(await ensureRuntime(dataDir)));
} else if (command === 'stop') {
  const owner = JSON.parse(await readFile(join(dataDir, 'owner.json'), 'utf8'));
  const status = await localRequest(dataDir, '/status');
  if (owner.runtime_id !== status.runtime_id) throw new Error('owner_runtime_mismatch');
  await localRequest(dataDir, '/stop', { method: 'POST', credential: owner.credential });
  const pids = [status.pid, ...status.services.map(service => service.pid)];
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = pids.some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!active) { console.log(JSON.stringify({ stopped: true })); process.exit(0); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('runtime_stop_incomplete: diagnose before restarting');
} else if (command === 'app') {
  await ensureRuntime(dataDir);
  const { ELECTRON_RUN_AS_NODE: ignored, ...environment } = process.env;
  const child = spawn(process.execPath, [root], { detached: true, stdio: 'ignore', env: { ...environment, WEBENVOY_INSTALLED_RUNTIME_DIR: dataDir } });
  child.unref();
  console.log(JSON.stringify({ app_started: true, pid: child.pid }));
} else throw new Error('Use setup, access, recovery, start, diagnose, app or stop with --data-dir. Stop and access are owner commands, not Agent tools.');
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function required(name) { const value = arg(name); if (!value) throw new Error(`${name}_required`); return value; }
async function readJsonFile(path) { try { return JSON.parse(await readFile(resolve(path), 'utf8')); } catch { throw new Error('recovery_json_file_invalid'); } }
function hostConfig(installRoot, clientPath, approveTools, includeRecovery, executable = process.execPath) {
  let config = `[mcp_servers.webenvoy]\ncommand = ${JSON.stringify(executable)}\nargs = ${JSON.stringify([join(installRoot, 'agent-entry/mcp.mjs'), clientPath])}\nstartup_timeout_sec = 30\ntool_timeout_sec = 100\n[mcp_servers.webenvoy.env]\nELECTRON_RUN_AS_NODE = "1"\n`;
  if (approveTools) for (const tool of ['webenvoy_skill', 'webenvoy_status', 'webenvoy_connect', 'webenvoy_operation', 'webenvoy_query', 'webenvoy_skills', ...(includeRecovery ? ['webenvoy_recovery'] : [])]) config += `[mcp_servers.webenvoy.tools.${tool}]\napproval_mode = "approve"\n`;
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
