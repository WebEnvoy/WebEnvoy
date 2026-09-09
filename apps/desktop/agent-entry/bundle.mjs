import { createHash } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const sha = value => createHash('sha256').update(value).digest('hex');
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
export async function verifyBundle() {
  const manifest = JSON.parse(await readFile(join(root, 'agent-manifest.json'), 'utf8'));
  if (manifest.schema !== 'webenvoy-installed-agent/v1' || manifest.skill_version !== '0.1.0') throw new Error('asset_version_mismatch: reinstall the matching bundle');
  if (process.versions.electron && sha(await readFile(process.execPath)) !== manifest.host?.executable_sha256) throw new Error('runtime_host_integrity_failed');
  const required = ['agent-entry/mcp.mjs', 'agent-entry/client.mjs', 'agent-entry/service.mjs', 'agent-entry/bundle.mjs', 'agent-entry/skills/webenvoy-browser/SKILL.md', 'dist-electron/runtime/core/start-runtime.mjs', 'dist-electron/runtime/harbor/start-runtime.mjs'];
  if (!manifest.files || required.some(name => !manifest.files[name])) throw new Error('asset_manifest_incomplete');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!name || name === 'agent-manifest.json' || relative(root, resolve(root, name)).startsWith('..') || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('asset_manifest_invalid');
    const path = join(root, name);
    if (!(await lstat(path)).isFile() || sha(await readFile(path)) !== hash) throw new Error(`asset_integrity_failed: ${name}; reinstall the matching bundle`);
  }
  let optionalUnavailable = 0;
  for (const [name, hash] of Object.entries(manifest.optional_files ?? {})) {
    if (!name.startsWith('dist-electron/lode/') || name.includes('..')) throw new Error('asset_manifest_invalid');
    try { if (sha(await readFile(join(root, name))) !== hash) optionalUnavailable++; } catch { optionalUnavailable++; }
  }
  return { host: { node: process.versions.node, electron: process.versions.electron ?? null, executable_integrity: process.versions.electron ? 'verified' : 'not_checked_by_node_helper' }, optional_website_assets: optionalUnavailable ? { state: 'unavailable', affected_files: optionalUnavailable } : { state: 'verified' }, version: manifest.version, skill_version: manifest.skill_version, workspace: manifest.workspace, lode: manifest.lode, integrity: 'verified', digest: sha(JSON.stringify(manifest)) };
}
