import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { root, sha, verifyBundle } from './bundle.mjs';
import { ensureRuntime, localRequest, readClient } from './client.mjs';
const [command, ...args] = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const linkedData = await readFile(join(root, '../webenvoy-installation.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return {}; });
const dataDir = resolve(arg('--data-dir') ?? linkedData.data_dir ?? (() => { throw new Error('--data-dir is required for setup; choose a dedicated persistent directory'); })());
if (command === 'setup') {
  const hostDir = resolve(arg('--host-dir') ?? (() => { throw new Error('--host-dir is required'); })());
  if (dataDir.startsWith(root + '/') || root.startsWith(dataDir + '/') || dataDir === root) throw new Error('Profile data must be separate from installation assets');
  await verifyBundle();
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
  await installFile(join(hostDir, '.agents/skills/webenvoy-browser/SKILL.md'), await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8'));
  // A standalone profile file is reviewable; never edit the user's existing Codex configuration.
  let config = `[mcp_servers.webenvoy]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([join(root, 'agent-entry/mcp.mjs'), clientPath])}\nstartup_timeout_sec = 30\ntool_timeout_sec = 100\n[mcp_servers.webenvoy.env]\nELECTRON_RUN_AS_NODE = "1"\n`;
  if (args.includes('--approve-tools')) for (const tool of ['webenvoy_skill', 'webenvoy_status', 'webenvoy_connect', 'webenvoy_operation', 'webenvoy_query']) config += `[mcp_servers.webenvoy.tools.${tool}]\napproval_mode = "approve"\n`;
  await installFile(join(hostDir, 'webenvoy.config.toml'), config);
  const profile = arg('--codex-profile');
  if (profile) {
    if (!/^[a-z0-9-]{1,64}$/.test(profile)) throw new Error('invalid_codex_profile_name');
    const configDir = process.env.CODEX_HOME ?? join(homedir(), '.codex');
    await mkdir(configDir, { recursive: true });
    await installFile(join(configDir, profile + '.config.toml'), config);
  }
  console.log(JSON.stringify({ installed: true, credential_fingerprint: sha(client.credential), host_configuration: join(hostDir, 'webenvoy.config.toml'), next: 'Install this isolated Codex profile, open App with the same --data-dir, then explicitly register this fingerprint and grant access.' }));
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
} else throw new Error('Use setup, start, diagnose, app or stop with --data-dir. Stop is an owner command, not an Agent tool.');
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function installFile(path, content) {
  try { await writeFile(path, content, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw error; }
}
