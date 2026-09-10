import { lstat, readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha } from './bundle.mjs';

async function readRegular(path) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('installation_file_conflict: ' + path);
    return await readFile(path);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function readReceipt(path, identity) {
  const raw = await readRegular(path);
  if (!raw) return null;
  const receipt = JSON.parse(raw);
  if (receipt.schema !== 'webenvoy-host-installation/v1' || receipt.data_dir !== resolve(identity.data_dir)
      || receipt.host_dir !== resolve(identity.host_dir) || !Array.isArray(receipt.files)
      || receipt.files.some(file => typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))) {
    throw new Error('installation_receipt_mismatch');
  }
  return receipt;
}

// Callers supply only fixed installer-owned targets. Legacy content must come from
// a separately integrity-verified previous installation, never from host files.
export async function installManagedFiles({ receiptPath, identity, files, legacyFiles = [] }) {
  const receipt = await readReceipt(receiptPath, identity);
  const managed = new Map((receipt?.files ?? []).map(file => [file.path, file.sha256]));
  const legacy = new Map(legacyFiles.map(file => [resolve(file.path), sha(file.content)]));
  const changes = [];
  for (const file of files) {
    const path = resolve(file.path), content = Buffer.from(file.content), current = await readRegular(path);
    const hash = sha(content);
    if (current && sha(current) !== hash && sha(current) !== managed.get(path) && sha(current) !== legacy.get(path)) {
      throw new Error('installation_user_modified_conflict: ' + path);
    }
    changes.push({ path, content, sha256: hash, changed: !current || sha(current) !== hash });
  }
  // Validate every target before changing any: a modified SKILL must not leave a
  // newly redirected host config behind when setup reports a conflict.
  for (const file of changes) if (file.changed) await atomicWrite(file.path, file.content);
  const updated = new Map(managed);
  for (const file of changes) updated.set(file.path, file.sha256);
  await atomicWrite(receiptPath, JSON.stringify({
    schema: 'webenvoy-host-installation/v1', ...identity,
    data_dir: resolve(identity.data_dir), host_dir: resolve(identity.host_dir),
    files: [...updated].map(([path, sha256]) => ({ path, sha256 })),
  }));
  return { installed: true, changed_files: changes.filter(file => file.changed).length };
}

export async function uninstallManagedFiles({ receiptPath, identity, allowedPaths }) {
  const receipt = await readReceipt(receiptPath, identity);
  if (!receipt) throw new Error('installation_receipt_missing');
  const allowed = new Set(allowedPaths.map(path => resolve(path)));
  const removed = [], conflicts = [], remaining = [];
  for (const file of receipt.files) {
    // Receipt metadata cannot turn uninstall into an arbitrary file deletion API.
    if (!allowed.has(file.path)) { remaining.push(file); continue; }
    let current;
    try { current = await readRegular(file.path); }
    catch (error) { if (!error.message.startsWith('installation_file_conflict')) throw error; conflicts.push(file.path); remaining.push(file); continue; }
    if (current && sha(current) !== file.sha256) { conflicts.push(file.path); remaining.push(file); continue; }
    if (current) { await unlink(file.path); removed.push(file.path); }
  }
  await atomicWrite(receiptPath, JSON.stringify({ ...receipt, files: remaining }));
  return { uninstalled: remaining.length === 0, removed, conflicts, retained_registration_count: remaining.length, data_preserved: true };
}
