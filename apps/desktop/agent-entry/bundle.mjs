import { createHash } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const sha = value => createHash('sha256').update(value).digest('hex');
export const recoveryOperationRef = (kind, idempotencyKey) => `recovery:${sha(`${kind}:${idempotencyKey}`).slice(0, 64)}`;
export const REQUIRED_DRIVER_ASSETS = [
  'dist-electron/runtime/harbor/dist/packages/runtime-api/src/playwright_shared_driver.py',
  'dist-electron/runtime/harbor/dist/packages/runtime-api/src/camoufox-upstream-driver.py',
  'dist-electron/runtime/harbor/dist/packages/runtime-api/src/chrome_official_driver.py'
];
export const REQUIRED_AGENT_ASSETS = [
  'agent-entry/managed-capability-definitions.json',
  'agent-entry/managed-site-worker.mjs',
  'agent-entry/managed-site-script-thread.mjs',
  'agent-entry/managed-site-worker-supervisor.mjs'
];
export const INSTALLED_AGENT_MANIFEST_SCHEMA = 'webenvoy-installed-agent/v1';
export const STANDALONE_MANIFEST_SCHEMA = 'webenvoy-installed-standalone/v1';
export async function files(directory, prefix = '') {
  const out = {};
  for (const name of (await readdir(directory)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const path = join(directory, name), info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('asset_symlink_refused');
    if (info.isDirectory()) Object.assign(out, await files(path, rel));
    else out[rel] = sha(await readFile(path));
  }
  return out;
}
export async function verifyBundle(bundleRoot = root, options = {}) {
  const hostExecutable = options.hostExecutable ?? process.execPath;
  const checkHost = options.checkHost ?? true;
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'agent-manifest.json'), 'utf8'));
  const standalone = manifest.schema === STANDALONE_MANIFEST_SCHEMA;
  if (![INSTALLED_AGENT_MANIFEST_SCHEMA, STANDALONE_MANIFEST_SCHEMA].includes(manifest.schema) || manifest.skill_version !== '0.2.0') throw new Error('asset_version_mismatch: reinstall the matching bundle');
  if (standalone) await verifyStandaloneRuntime(bundleRoot, manifest, hostExecutable);
  else if (checkHost && process.versions.electron && sha(await readFile(hostExecutable)) !== manifest.host?.executable_sha256) throw new Error('runtime_host_integrity_failed');
  const required = ['agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs', 'agent-entry/skills/webenvoy-browser/SKILL.md', 'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs', ...REQUIRED_AGENT_ASSETS, ...REQUIRED_DRIVER_ASSETS];
  if (standalone) required.push(
    'agent-entry/cli.mjs',
    'agent-entry/installation.mjs',
    'agent-entry/previous-installation.mjs',
    'agent-entry/provider-artifact.mjs',
    'agent-entry/runtime-environment.mjs',
    'bin/webenvoy',
    'runtime/node',
    'runtime/Node-LICENSE',
    'licenses/WebEnvoy.txt',
    'licenses/Agent-entry.txt',
    'licenses/Harbor.txt',
    'SOURCE.txt',
    'dist-electron/runtimeSupervisor.js',
    'dist-electron/lodeAssetBundle.js',
    'dist-electron/lodeAssetAccess.js',
  );
  if (!manifest.files || required.some(name => !manifest.files[name])) throw new Error('asset_manifest_incomplete');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!name || name === 'agent-manifest.json' || relative(bundleRoot, resolve(bundleRoot, name)).startsWith('..') || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('asset_manifest_invalid');
    const path = join(bundleRoot, name);
    if (!(await lstat(path)).isFile() || sha(await readFile(path)) !== hash) throw new Error(`asset_integrity_failed: ${name}; reinstall the matching bundle`);
  }
  let optionalUnavailable = 0, optionalSkillUnavailable = 0;
  for (const [name, hash] of Object.entries(manifest.optional_files ?? {})) {
    if (!(name.startsWith('dist-electron/lode/') || name.startsWith('agent-entry/skill-assets/')) || name.includes('..')) throw new Error('asset_manifest_invalid');
    try {
      const info = await lstat(join(bundleRoot, name));
      if (name.startsWith('agent-entry/skill-assets/') && (!info.isFile() || info.size > 1024 * 1024)) { optionalSkillUnavailable++; continue; }
      if (sha(await readFile(join(bundleRoot, name))) !== hash) name.startsWith('agent-entry/skill-assets/') ? optionalSkillUnavailable++ : optionalUnavailable++;
    } catch { name.startsWith('agent-entry/skill-assets/') ? optionalSkillUnavailable++ : optionalUnavailable++; }
  }
  const websiteAssetsUnavailable = optionalUnavailable || (standalone && !manifest.lode);
  return { host: standalone
    ? { kind: 'standalone-node', node: process.versions.node, electron: null, platform: process.platform, arch: process.arch, executable: manifest.runtime.executable, executable_sha256: manifest.runtime.executable_sha256, executable_integrity: 'verified' }
    : { node: process.versions.node, electron: process.versions.electron ?? null, executable_integrity: process.versions.electron ? 'verified' : 'not_checked_by_node_helper' }, optional_website_assets: websiteAssetsUnavailable ? { state: 'unavailable', ...(optionalUnavailable ? { affected_files: optionalUnavailable } : { reason: 'lode_provenance_missing' }) } : { state: 'verified' }, optional_skill_assets: optionalSkillUnavailable ? { state: 'unavailable', affected_files: optionalSkillUnavailable } : { state: 'verified' }, version: manifest.version, skill_version: manifest.skill_version, package_kind: standalone ? 'standalone-runtime' : 'electron-compat', workspace: manifest.workspace, lode: manifest.lode, integrity: 'verified', digest: sha(JSON.stringify(manifest)) };
}

async function verifyStandaloneRuntime(bundleRoot, manifest, hostExecutable) {
  const runtime = manifest.runtime;
  if (!runtime || runtime.platform !== process.platform || runtime.arch !== process.arch || process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('runtime_platform_mismatch: standalone package requires macOS arm64');
  if (process.versions.electron || runtime.node_version !== '24.14.0' || runtime.node_version !== process.versions.node || runtime.executable !== 'runtime/node' || !/^[0-9a-f]{64}$/.test(runtime.executable_sha256) || typeof runtime.executable !== 'string' || runtime.executable.startsWith('/') || relative(bundleRoot, resolve(bundleRoot, runtime.executable)).startsWith('..')) throw new Error('runtime_identity_mismatch: standalone package requires its fixed Node 24.14.0 runtime');
  const runtimePath = join(bundleRoot, runtime.executable);
  const runtimeHash = sha(await readFile(runtimePath));
  if (runtimeHash !== runtime.executable_sha256 || sha(await readFile(hostExecutable)) !== runtime.executable_sha256) throw new Error('runtime_host_integrity_failed');
}
