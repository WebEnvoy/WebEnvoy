import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { recoveryOperationRef } from './bundle.mjs';
import { previousRoot } from './previous-installation.mjs';

test('managed A→B, modified-file preservation, uninstall/reinstall and symlink refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-installation-test-'));
  try {
    const config = join(root, 'host.config'), skill = join(root, 'SKILL.md'), credential = join(root, 'client.json');
    const receiptPath = join(root, 'installation.json');
    const identity = { data_dir: join(root, 'data'), host_dir: root, asset_digest: 'B' };
    await writeFile(config, 'legacy-config'); await writeFile(skill, 'legacy-skill'); await writeFile(credential, 'same-client');
    const files = [{ path: config, content: 'B-config' }, { path: skill, content: 'B-skill' }];
    const options = { receiptPath, identity, files };
    await assert.rejects(installManagedFiles(options), /user_modified_conflict/);
    await installManagedFiles({ ...options, legacyFiles: [{ path: config, content: 'legacy-config' }, { path: skill, content: 'legacy-skill' }] });
    assert.equal(await readFile(config, 'utf8'), 'B-config');
    await writeFile(skill, 'user-edit');
    await assert.rejects(installManagedFiles({ ...options, files: [{ path: config, content: 'C-config' }, { path: skill, content: 'C-skill' }] }), /user_modified_conflict/);
    assert.equal(await readFile(config, 'utf8'), 'B-config');
    const uninstall = () => uninstallManagedFiles({ receiptPath, identity, allowedPaths: [config, skill] });
    const result = await uninstall();
    assert.deepEqual(result.conflicts, [skill]);
    assert.equal(await readFile(skill, 'utf8'), 'user-edit');
    assert.equal(await readFile(credential, 'utf8'), 'same-client');
    await writeFile(skill, 'B-skill');
    assert.equal((await uninstall()).uninstalled, true);
    await installManagedFiles(options);
    assert.equal(await readFile(config, 'utf8'), 'B-config');
    await rm(skill); await symlink(credential, skill);
    await assert.rejects(installManagedFiles(options), /file_conflict/);
    assert.deepEqual((await uninstall()).conflicts, [skill]);
    assert.equal(await readFile(credential, 'utf8'), 'same-client');
    await assert.rejects(installManagedFiles({ ...options, identity: { ...identity, data_dir: join(root, 'other') } }), /receipt_mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('derives the same recovery operation ref from an idempotency key', () => {
  assert.equal(recoveryOperationRef('apply', 'lost-response'), 'recovery:091ddd10bbbaec94ee0da9f965b35ef2ea4fd7987b8244e8dba0e13ed0364097');
  assert.notEqual(recoveryOperationRef('apply', 'lost-response'), recoveryOperationRef('backup', 'lost-response'));
});

test('canonicalizes a symlinked previous app before constructing legacy paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-previous-installation-test-'));
  try {
    const app = join(root, 'WebEnvoy Baseline A.app');
    const appRoot = join(app, 'Contents/Resources/app');
    await mkdir(join(appRoot, 'agent-entry'), { recursive: true });
    await writeFile(join(appRoot, 'agent-entry/bundle.mjs'), '');
    const alias = join(root, 'previous-alias.app');
    await symlink(app, alias);
    assert.equal(await previousRoot(alias), await realpath(appRoot));
  } finally { await rm(root, { recursive: true, force: true }); }
});
