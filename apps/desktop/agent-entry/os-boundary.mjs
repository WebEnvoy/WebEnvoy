import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { lstat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createConnection } from 'node:net';

export const OWNER_CONTROL_SOCKET_NAME = 'owner-control.sock';
const MAX_UNIX_SOCKET_PATH_BYTES = 104;

export function ownerControlSocket(dataDir) {
  return join(resolve(dataDir), OWNER_CONTROL_SOCKET_NAME);
}

export function verifyOwnerDataDirectory(dataDir, { ownerUid = process.getuid?.() } = {}) {
  if (typeof dataDir !== 'string' || dataDir.includes('\n') || dataDir.includes('\0')) throw new Error('owner_data_dir_invalid');
  let info;
  try { info = lstatSync(dataDir); } catch { throw new Error('owner_data_dir_invalid'); }
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o777) !== 0o700) throw new Error('owner_data_dir_invalid');
  if (!macAclVerified(dataDir, ['-lde'])) throw new Error('owner_data_dir_acl_unverified');
  return { state: 'verified', uid: info.uid, mode: info.mode & 0o777 };
}

export function verifyAgentClientFile(path, { ownerUid = process.getuid?.() } = {}) {
  if (typeof path !== 'string' || path.includes('\n') || path.includes('\0')) throw new Error('client_file_invalid');
  let info;
  try { info = lstatSync(path); } catch { throw new Error('client_file_invalid'); }
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o777) !== 0o600) throw new Error('client_file_invalid');
  if (!macAclVerified(path, ['-le'])) throw new Error('client_file_acl_unverified');
  return { state: 'verified', uid: info.uid, mode: info.mode & 0o777 };
}

export function defaultAgentDataSocket(dataDir) {
  const digest = createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0, 40);
  return join('/tmp', `webenvoy-agent-${digest}.sock`);
}

export function agentDataSocket(value) {
  const endpoint = typeof value === 'object' && value !== null ? value.agent_endpoint ?? (value.data_dir ? defaultAgentDataSocket(value.data_dir) : undefined) : undefined;
  const socketPath = endpoint ?? (typeof value === 'string' ? defaultAgentDataSocket(value) : undefined);
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || socketPath.includes('\0') || Buffer.byteLength(socketPath) >= MAX_UNIX_SOCKET_PATH_BYTES) throw new Error('agent_endpoint_invalid');
  if (value && typeof value === 'object' && typeof value.data_dir === 'string') {
    const ownerRelativeEndpoint = relative(resolve(value.data_dir), socketPath);
    if (!ownerRelativeEndpoint || (ownerRelativeEndpoint !== '..' && !ownerRelativeEndpoint.startsWith(`..${sep}`))) throw new Error('agent_endpoint_invalid');
  }
  return socketPath;
}

export function verifyAgentSocket(path, { ownerUid } = {}) {
  try {
    const info = lstatSync(path);
    if (!info.isSocket() || info.isSymbolicLink() || ownerUid !== undefined && info.uid !== ownerUid) throw new Error('agent_endpoint_invalid');
    return { state: 'verified', uid: info.uid, mode: info.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    if (error.message === 'agent_endpoint_invalid') throw error;
    throw new Error('agent_endpoint_invalid');
  }
}

export async function probeUnixSocket(path, { timeoutMs = 500 } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('runtime_endpoint_probe_invalid');
  return await new Promise((resolveProbe, rejectProbe) => {
    let settled = false;
    const connection = createConnection(path);
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      connection.destroy();
      if (error) rejectProbe(error);
      else resolveProbe(result);
    };
    connection.once('connect', () => finish({ state: 'live' }));
    connection.once('error', error => {
      if (error.code === 'ECONNREFUSED') return finish({ state: 'stale' });
      if (error.code === 'ENOENT') return finish({ state: 'missing' });
      finish(undefined, Object.assign(new Error('runtime_endpoint_probe_failed'), { cause: error }));
    });
    connection.setTimeout(timeoutMs, () => finish(undefined, new Error('runtime_endpoint_probe_timeout')));
  });
}

export async function prepareRuntimeSocket(path, { ownerUid = process.getuid?.() } = {}) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error.code === 'ENOENT') return { state: 'absent' };
    throw new Error('runtime_endpoint_invalid');
  }
  if (info.isSymbolicLink() || !info.isSocket() || info.uid !== ownerUid) throw new Error('runtime_endpoint_occupied');
  const probe = await probeUnixSocket(path);
  if (probe.state === 'live') throw new Error('runtime_endpoint_occupied');
  if (probe.state === 'missing') return { state: 'absent' };
  if (probe.state !== 'stale') throw new Error('runtime_endpoint_probe_failed');
  try { await unlink(path); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('runtime_endpoint_occupied');
  }
  return { state: 'removed' };
}

export function verifyOwnerSocket(path, { ownerUid = process.getuid?.() } = {}) {
  try {
    const info = lstatSync(path);
    const mode = info.mode & 0o777;
    if (!info.isSocket() || info.isSymbolicLink() || info.uid !== ownerUid || (mode & 0o077) !== 0 || !macAclVerified(path, ['-lde'])) throw new Error('owner_endpoint_invalid');
    return { state: 'verified', uid: info.uid, mode };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    if (error.message === 'owner_endpoint_invalid') throw error;
    throw new Error('owner_endpoint_invalid');
  }
}

export function verifyAgentIdentity(agentUid) {
  const currentUid = process.getuid?.();
  if (!Number.isSafeInteger(agentUid) || agentUid < 1 || currentUid !== agentUid || currentUid === 0) throw new Error('agent_identity_unavailable');
  return { state: 'verified', uid: currentUid };
}

export function classifySudoPolicy({ name, status, stdout = '', stderr = '' }) {
  const text = `${stdout}\n${stderr}`;
  const target = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|\\n)User ${target} (?:may not run sudo|is not allowed to run sudo)\\b`, 'm').test(text)) return 'denied';
  if (status === 0 && new RegExp(`(?:^|\\n)User ${target} may run `, 'm').test(text)) return 'allowed';
  return 'unknown';
}

export function classifyAdminMembership(output = '') {
  const text = String(output);
  if (/\bnot a member\b/i.test(text)) return false;
  if (/\bis a member\b/i.test(text)) return true;
  return undefined;
}

export function discoverOsIdentity({ ownerUid = process.getuid?.(), agentUid } = {}) {
  const account = Number.isSafeInteger(agentUid) && agentUid > 0 ? userFacts(agentUid) : { state: 'missing' };
  return {
    platform: process.platform,
    arch: process.arch,
    owner_uid: Number.isSafeInteger(ownerUid) ? ownerUid : null,
    agent_uid: Number.isSafeInteger(agentUid) ? agentUid : null,
    owner_is_root: ownerUid === 0,
    agent_is_root: agentUid === 0,
    same_uid: Number.isSafeInteger(ownerUid) && Number.isSafeInteger(agentUid) && ownerUid === agentUid,
    agent_account: account,
    process_inspection: account.state === 'verified' && account.admin === false && account.sudo_access === 'denied' ? 'distinct_non_admin_uid' : 'unverified'
  };
}

function userFacts(uid) {
  try {
    const name = execFileSync('/usr/bin/id', ['-nu', String(uid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!name || /[^A-Za-z0-9_.-]/.test(name)) return { state: 'invalid' };
    const admin = classifyAdminMembership(execFileSync('/usr/bin/dsmemberutil', ['checkmembership', '-U', name, '-G', 'admin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const groups = execFileSync('/usr/bin/id', ['-G', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/).filter(Boolean).map(Number);
    if (!groups.length || groups.some(group => !Number.isSafeInteger(group) || group < 0)) return { state: 'invalid' };
    const sudo = spawnSync('/usr/bin/sudo', ['-n', '-l', '-U', name], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { state: 'verified', name, admin, groups, sudo_access: classifySudoPolicy({ name, status: sudo.status, stdout: sudo.stdout, stderr: sudo.stderr }) };
  } catch {
    return { state: 'unavailable' };
  }
}

const FIXED_AGENT_ASSET_PATHS = [
  'agent-manifest.json',
  'agent-entry/cli.mjs',
  'agent-entry/client.mjs',
  'agent-entry/service.mjs',
  'bin/webenvoy',
  'runtime/node'
];

// The Agent data plane is disabled unless the owner-held installation and all
// manifest assets are provably immutable to the Agent UID. This supplements
// bundle hash verification: hashes detect content drift, while these checks
// prevent the Agent from causing that drift through a writable path.
export function verifyAgentBundleBoundary({ installRoot, ownerUid, agentUid } = {}) {
  const failures = [];
  if (typeof installRoot !== 'string' || !isAbsolute(installRoot) || installRoot.includes('\0')) return { state: 'disabled', code: 'agent_bundle_boundary_unavailable', reason_codes: ['agent_bundle_root_missing'], checked_paths: 0 };
  if (!Number.isSafeInteger(ownerUid) || ownerUid < 1 || !Number.isSafeInteger(agentUid) || agentUid < 1 || ownerUid === agentUid) return { state: 'disabled', code: 'agent_bundle_boundary_unavailable', reason_codes: ['agent_bundle_identity_unavailable'], checked_paths: 0 };
  const root = resolve(installRoot);
  let rootInfo;
  try { rootInfo = lstatSync(root); } catch { return { state: 'disabled', code: 'agent_bundle_boundary_unavailable', reason_codes: ['agent_bundle_root_missing'], checked_paths: 0 }; }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) failures.push('agent_bundle_root_invalid');
  if (rootInfo.uid !== ownerUid) failures.push('agent_bundle_owner_mismatch');

  const account = userFacts(agentUid);
  if (account.state !== 'verified' || !Array.isArray(account.groups)) {
    failures.push('agent_bundle_identity_unverified');
    return { state: 'disabled', code: 'agent_bundle_boundary_unavailable', reason_codes: [...new Set(failures)], checked_paths: 0 };
  }
  const groups = new Set(account.groups);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'agent-manifest.json'), 'utf8'));
  } catch {
    failures.push('agent_bundle_manifest_unavailable');
    return { state: 'disabled', code: 'agent_bundle_boundary_unavailable', reason_codes: [...new Set(failures)], checked_paths: 0 };
  }
  const requiredNames = new Set(FIXED_AGENT_ASSET_PATHS);
  const optionalNames = new Set();
  for (const [section, names] of [['files', requiredNames], ['optional_files', optionalNames]]) {
    const entries = manifest?.[section];
    if (entries !== undefined && (!entries || typeof entries !== 'object' || Array.isArray(entries))) failures.push('agent_bundle_manifest_invalid');
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) for (const name of Object.keys(entries)) names.add(name);
  }
  const requiredPaths = [];
  const optionalPaths = [];
  for (const [names, output] of [[requiredNames, requiredPaths], [optionalNames, optionalPaths]]) for (const name of names) {
    if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\n') || name.includes('\r') || isAbsolute(name)) {
      failures.push('agent_bundle_asset_path_invalid');
      continue;
    }
    const assetPath = resolve(root, name);
    const assetRelative = relative(root, assetPath);
    if (!assetRelative || assetRelative === '..' || assetRelative.startsWith(`..${sep}`) || isAbsolute(assetRelative)) {
      failures.push('agent_bundle_asset_path_invalid');
      continue;
    }
    output.push(assetPath);
  }
  const assetPaths = [...requiredPaths];
  const presentOptionalPaths = [];
  const missingOptionalParents = new Set();
  for (const assetPath of optionalPaths) {
    try {
      const info = lstatSync(assetPath);
      if (info.isSymbolicLink() || !info.isFile()) failures.push('agent_bundle_optional_asset_invalid');
      else presentOptionalPaths.push(assetPath);
    } catch (error) {
      if (error.code !== 'ENOENT') failures.push('agent_bundle_optional_asset_unavailable');
      else {
        try {
          const parent = findExistingAssetParent(assetPath, root);
          missingOptionalParents.add(parent);
        } catch {
          failures.push('agent_bundle_parent_unavailable');
        }
      }
    }
  }
  assetPaths.push(...presentOptionalPaths);

  let realRoot;
  try { realRoot = realpathSync(root); } catch { failures.push('agent_bundle_parent_unavailable'); }
  const aclPaths = new Set([root]);
  for (const assetPath of assetPaths) {
    for (let current = assetPath; current === root || current.startsWith(`${root}${sep}`); current = dirname(current)) aclPaths.add(current);
  }
  for (const parent of missingOptionalParents) {
    for (let current = parent; current === root || current.startsWith(`${root}${sep}`); current = dirname(current)) aclPaths.add(current);
  }
  for (let current = dirname(root); ; current = dirname(current)) {
    aclPaths.add(current);
    if (current === '/') break;
  }
  if (realRoot) for (let current = realRoot; ; current = dirname(current)) {
    aclPaths.add(current);
    if (current === '/') break;
  }
  const aclVerified = macAclBatchVerifier(aclPaths);
  if (!aclVerified(root)) failures.push('agent_bundle_root_acl_unverified');
  if (rootInfo.isDirectory() && agentCanWrite(rootInfo, agentUid, groups)) failures.push('agent_bundle_root_writable');

  for (const assetPath of assetPaths) {
    try {
      const info = lstatSync(assetPath);
      if (info.isSymbolicLink() || !info.isFile()) failures.push('agent_bundle_asset_invalid');
      else {
        if (agentCanWrite(info, agentUid, groups)) failures.push('agent_bundle_asset_writable');
        if (!aclVerified(assetPath)) failures.push('agent_bundle_asset_acl_unverified');
      }
      checkAssetParentReplacementChain(assetPath, root, agentUid, groups, failures, aclVerified);
    } catch {
      failures.push('agent_bundle_asset_missing');
    }
  }
  for (const parent of missingOptionalParents) checkMissingAssetParentReplacementChain(parent, root, agentUid, groups, failures, aclVerified);
  try { checkLexicalParentReplacementChain(root, agentUid, groups, failures, aclVerified); }
  catch { failures.push('agent_bundle_parent_unavailable'); }
  if (realRoot) {
    try { checkParentReplacementChain(realRoot, agentUid, groups, failures, aclVerified); }
    catch { failures.push('agent_bundle_parent_unavailable'); }
  }
  return {
    state: failures.length ? 'disabled' : 'supported',
    code: failures.length ? 'agent_bundle_boundary_unavailable' : 'ok',
    reason_codes: [...new Set(failures)],
    checked_paths: assetPaths.length
  };
}

function macAclBatchVerifier(paths) {
  const values = [...paths];
  const verified = new Map(values.map(path => [path, process.platform !== 'darwin']));
  if (process.platform !== 'darwin') return path => verified.get(path) === true;
  const batchSize = 128;
  for (let offset = 0; offset < values.length; offset += batchSize) {
    const batch = values.slice(offset, offset + batchSize);
    try {
      const listing = execFileSync('/bin/ls', ['-ldef', ...batch], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = listing.split('\n').filter(Boolean);
      if (lines.length !== batch.length) throw new Error('acl_listing_shape_invalid');
      lines.forEach((line, index) => verified.set(batch[index], !line.includes('+')));
    } catch {
      for (const path of batch) verified.set(path, false);
    }
  }
  return path => verified.get(path) === true;
}

function checkAssetParentReplacementChain(assetPath, root, agentUid, groups, failures, aclVerified) {
  let child = assetPath;
  let current = dirname(assetPath);
  while (current === root || current.startsWith(`${root}${sep}`)) {
    try {
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        failures.push('agent_bundle_asset_parent_invalid');
        return;
      }
      if (!aclVerified(current)) failures.push('agent_bundle_asset_parent_acl_unverified');
      const childInfo = lstatSync(child);
      const permission = agentPermissions(info, agentUid, groups);
      if (permission.write && permission.execute && (!((info.mode & 0o1000) !== 0) || info.uid === agentUid || childInfo.uid === agentUid)) failures.push('agent_bundle_asset_parent_replaceable');
    } catch {
      failures.push('agent_bundle_parent_unavailable');
      return;
    }
    if (current === root) break;
    child = current;
    current = dirname(current);
  }
}

function findExistingAssetParent(assetPath, root) {
  let current = dirname(assetPath);
  while (current !== root && current.startsWith(`${root}${sep}`)) {
    try { lstatSync(current); return current; }
    catch (error) { if (error.code !== 'ENOENT') throw error; current = dirname(current); }
  }
  lstatSync(root);
  return root;
}

function checkMissingAssetParentReplacementChain(parent, root, agentUid, groups, failures, aclVerified) {
  let child = undefined;
  let current = parent;
  while (current === root || current.startsWith(`${root}${sep}`)) {
    try {
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        failures.push('agent_bundle_asset_parent_invalid');
        return;
      }
      if (!aclVerified(current)) failures.push('agent_bundle_asset_parent_acl_unverified');
      let childInfo;
      if (child) {
        try { childInfo = lstatSync(child); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const permission = agentPermissions(info, agentUid, groups);
      const sticky = (info.mode & 0o1000) !== 0;
      if (permission.write && permission.execute && (!sticky || !childInfo || info.uid === agentUid || childInfo.uid === agentUid)) failures.push('agent_bundle_asset_parent_replaceable');
    } catch {
      failures.push('agent_bundle_parent_unavailable');
      return;
    }
    if (current === root) break;
    child = current;
    current = dirname(current);
  }
}

function checkParentReplacementChain(root, agentUid, groups, failures, aclVerified) {
  let child = root;
  let current = dirname(root);
  while (true) {
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      failures.push('agent_bundle_parent_invalid');
      return;
    }
    if (!aclVerified(current)) failures.push('agent_bundle_parent_acl_unverified');
    const childInfo = lstatSync(child);
    const permission = agentPermissions(info, agentUid, groups);
    if (permission.write && permission.execute && (!((info.mode & 0o1000) !== 0) || info.uid === agentUid || childInfo.uid === agentUid)) failures.push('agent_bundle_parent_replaceable');
    if (current === '/') break;
    child = current;
    current = dirname(current);
  }
}

function checkLexicalParentReplacementChain(root, agentUid, groups, failures, aclVerified) {
  let child = root;
  let current = dirname(root);
  while (true) {
    const info = lstatSync(current);
    if (!info.isDirectory() && !info.isSymbolicLink()) {
      failures.push('agent_bundle_parent_invalid');
      return;
    }
    if (!aclVerified(current)) failures.push('agent_bundle_parent_acl_unverified');
    if (info.isDirectory()) {
      const childInfo = lstatSync(child);
      const permission = agentPermissions(info, agentUid, groups);
      if (permission.write && permission.execute && (!((info.mode & 0o1000) !== 0) || info.uid === agentUid || childInfo.uid === agentUid)) failures.push('agent_bundle_parent_replaceable');
    }
    if (current === '/') break;
    child = current;
    current = dirname(current);
  }
}

function agentCanWrite(info, agentUid, groups) {
  return agentPermissions(info, agentUid, groups).write;
}

function agentPermissions(info, agentUid, groups) {
  const mode = info.mode & 0o777;
  const bits = info.uid === agentUid ? (mode >> 6) & 7 : groups.has(info.gid) ? (mode >> 3) & 7 : mode & 7;
  return { write: (bits & 2) !== 0, execute: (bits & 1) !== 0 };
}

function ownerSocketAcl(path, ownerUid) {
  if (!path) return 'unverified';
  try {
    const info = lstatSync(path);
    const mode = info.mode & 0o777;
    return info.isSocket() && info.uid === ownerUid && (mode & 0o077) === 0 && macAclVerified(path, ['-lde']) ? 'verified' : 'invalid';
  } catch (error) {
    return error.code === 'ENOENT' ? 'expected' : 'invalid';
  }
}

function macAclVerified(path, args) {
  if (process.platform !== 'darwin') return true;
  try {
    const listing = execFileSync('/bin/ls', [...args, path], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = listing.split('\n').filter(Boolean);
    return lines.length === 1 && !lines[0].includes('+');
  } catch {
    return false;
  }
}

export function verifyOsBoundary({ ownerUid = process.getuid?.(), agentUid, ownerSocketPath, installRoot } = {}) {
  const identity = { ...discoverOsIdentity({ ownerUid, agentUid }), socket_acl: ownerSocketAcl(ownerSocketPath, ownerUid) };
  const assetBoundary = verifyAgentBundleBoundary({ installRoot, ownerUid, agentUid });
  const failures = [];
  if (identity.platform !== 'darwin' || identity.arch !== 'arm64') failures.push('platform_unsupported');
  if (!Number.isSafeInteger(identity.owner_uid) || identity.owner_uid < 1) failures.push('owner_uid_invalid');
  if (!Number.isSafeInteger(identity.agent_uid) || identity.agent_uid < 1) failures.push('agent_uid_missing');
  if (identity.owner_is_root || identity.agent_is_root) failures.push('privileged_uid_unsupported');
  if (identity.same_uid) failures.push('owner_agent_uid_not_separated');
  if (identity.agent_account.state !== 'verified') failures.push('agent_uid_unverified');
  if (identity.agent_account.admin === true || identity.agent_account.sudo_access === 'allowed') failures.push('agent_uid_privileged');
  if (identity.agent_account.admin !== false) failures.push('agent_admin_policy_unverified');
  if (identity.agent_account.sudo_access !== 'denied') failures.push('agent_sudo_policy_unverified');
  if (!['verified', 'expected'].includes(identity.socket_acl)) failures.push('owner_socket_acl_unavailable');
  if (!['denied', 'enforced', 'verified', 'distinct_non_admin_uid'].includes(identity.process_inspection)) failures.push('agent_process_inspection_policy_unavailable');
  if (assetBoundary.state !== 'supported') failures.push(...assetBoundary.reason_codes);
  return {
    state: failures.length ? 'disabled' : 'supported',
    code: failures.length ? 'owner_agent_isolation_unavailable' : 'ok',
    reason_codes: failures,
    identity,
    asset_boundary: assetBoundary
  };
}

// Recheck the mutable transport boundary before serving a status, connection,
// or data-plane request. Bundle facts are intentionally re-read here; this is
// a live gate, not a cached startup grant.
export function verifyLiveOsBoundary({ dataDir, ownerUid = process.getuid?.(), agentUid, ownerSocketPath, agentSocketPath, installRoot, requireAgentSocket = false } = {}) {
  const boundary = verifyOsBoundary({ ownerUid, agentUid, ownerSocketPath, installRoot });
  const reasonCodes = [...boundary.reason_codes];
  let ownerTransport = true;
  let agentTransport = !requireAgentSocket;
  const addFailure = reason => reasonCodes.push(reason);
  try { verifyOwnerDataDirectory(dataDir, { ownerUid }); }
  catch (error) { ownerTransport = false; addFailure(error.message === 'owner_data_dir_acl_unverified' ? error.message : 'owner_data_dir_invalid'); }
  try { verifyOwnerSocket(ownerSocketPath, { ownerUid }); }
  catch { ownerTransport = false; addFailure('owner_socket_acl_unavailable'); }
  if (requireAgentSocket) {
    try { verifyAgentSocket(agentSocketPath, { ownerUid }); agentTransport = true; }
    catch { addFailure('agent_socket_unavailable'); }
  }
  const uniqueReasons = [...new Set(reasonCodes)];
  return {
    ...boundary,
    state: uniqueReasons.length ? 'disabled' : 'supported',
    code: uniqueReasons.length ? 'owner_agent_isolation_unavailable' : 'ok',
    reason_codes: uniqueReasons,
    owner_transport: ownerTransport,
    agent_transport: agentTransport
  };
}

export function assertOsBoundary(options) {
  const result = verifyOsBoundary(options);
  if (result.state !== 'supported') {
    const error = new Error(result.code);
    error.reason_codes = result.reason_codes;
    error.boundary = result;
    throw error;
  }
  return result;
}

const OWNER_RUNTIME_SESSION_REF = '[^/]+';

// Owner transport exposes only the Harbor session facts/control seam; Agent
// requests never enter this allowlist.
export function isOwnerHarborRoute(req) {
  if (typeof req?.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return false;
  let url;
  try { url = new URL(req.url, 'http://owner.local'); } catch { return false; }
  if (url.origin !== 'http://owner.local' || url.username || url.password || url.hash) return false;
  if (url.pathname === '/runtime/sessions') {
    if (req.method !== 'GET') return false;
    const keys = [...url.searchParams.keys()];
    return keys.length <= 1 && keys.every(key => key === 'profile_ref');
  }
  const match = url.pathname.match(new RegExp(`^/runtime/sessions/(${OWNER_RUNTIME_SESSION_REF})(?:/(runtime-facts|handoff|lock|release|stop))?$`));
  if (!match || url.search) return false;
  let sessionRef;
  try { sessionRef = decodeURIComponent(match[1]); } catch { return false; }
  if (!/^[A-Za-z0-9:_-]+$/.test(sessionRef)) return false;
  return match[2] === 'runtime-facts' ? req.method === 'GET' : match[2] ? req.method === 'POST' : req.method === 'GET';
}

export function requiresControlPrecondition(req) {
  return req.method === 'POST' && isOwnerHarborRoute(req) && /\/(handoff|lock|release)$/.test(new URL(req.url, 'http://owner.local').pathname);
}
