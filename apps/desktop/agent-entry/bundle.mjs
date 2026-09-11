import { createHash } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const sha = value => createHash('sha256').update(value).digest('hex');
export const obscuraValidatedCommit = '01e1caa33360f6c02643457307894ec885e82eef';
export const obscuraValidatedSha256 = 'd05336b807fde6b27221af3f1427550666d1f855166c3cc94be537a08b4ba98d';
export const recoveryOperationRef = (kind, idempotencyKey) => `recovery:${sha(`${kind}:${idempotencyKey}`).slice(0, 64)}`;
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
  if (manifest.schema !== 'webenvoy-installed-agent/v1' || manifest.skill_version !== '0.2.0') throw new Error('asset_version_mismatch: reinstall the matching bundle');
  if (checkHost && process.versions.electron && sha(await readFile(hostExecutable)) !== manifest.host?.executable_sha256) throw new Error('runtime_host_integrity_failed');
  const required = ['agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs', 'agent-entry/skills/webenvoy-browser/SKILL.md', 'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs'];
  if (!manifest.files || required.some(name => !manifest.files[name])) throw new Error('asset_manifest_incomplete');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!name || name === 'agent-manifest.json' || relative(bundleRoot, resolve(bundleRoot, name)).startsWith('..') || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('asset_manifest_invalid');
    const path = join(bundleRoot, name);
    if (!(await lstat(path)).isFile() || sha(await readFile(path)) !== hash) throw new Error(`asset_integrity_failed: ${name}; reinstall the matching bundle`);
  }
  let obscura = { state: 'unavailable' };
  if (manifest.providers?.obscura !== undefined) {
    const provider = manifest.providers.obscura;
    const providerPath = 'agent-entry/providers/obscura';
    if (!provider || Object.keys(provider).sort().join(',') !== 'commit,path,sha256,validation_private_network' || provider.path !== providerPath || provider.commit !== obscuraValidatedCommit || provider.sha256 !== obscuraValidatedSha256 || typeof provider.validation_private_network !== 'boolean' || manifest.files[providerPath] !== obscuraValidatedSha256) throw new Error('obscura_asset_manifest_invalid');
    obscura = { state: 'verified', executable_path: join(bundleRoot, providerPath), validation_private_network: provider.validation_private_network };
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
  return { host: { node: process.versions.node, electron: process.versions.electron ?? null, executable_integrity: process.versions.electron ? 'verified' : 'not_checked_by_node_helper' }, optional_website_assets: optionalUnavailable ? { state: 'unavailable', affected_files: optionalUnavailable } : { state: 'verified' }, optional_skill_assets: optionalSkillUnavailable ? { state: 'unavailable', affected_files: optionalSkillUnavailable } : { state: 'verified' }, obscura, version: manifest.version, skill_version: manifest.skill_version, workspace: manifest.workspace, lode: manifest.lode, integrity: 'verified', digest: sha(JSON.stringify(manifest)) };
}
