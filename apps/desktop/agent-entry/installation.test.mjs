import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { recoveryOperationRef } from './bundle.mjs';
import { previousRoot } from './previous-installation.mjs';
import { CAMOUFOX_UPSTREAM_PINS, classifyCamoufoxBinding, resolveCamoufoxSetupBinding, verifyCamoufoxUpstreamInstall, verifyInstalledCamoufox } from './provider-artifact.mjs';
import { installedRuntimeEnvironment } from './runtime-environment.mjs';

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

test('leaves an ordinary setup without a Camoufox binding', async () => {
  assert.equal(await resolveCamoufoxSetupBinding({ existingInstallation: { coreEndpoint: 'http://127.0.0.1:1' }, hasUpstreamArguments: false }), null);
});

test('revalidates an existing upstream binding when setup has no new provider arguments', async (t) => {
  const sourceDir = '/private/tmp/webenvoy-upstream-source-audit.LWbSiJ';
  const browserRoot = '/Users/claw/Library/Caches/camoufox/browsers/official/152.0.4-beta.30-3b43e766/Camoufox.app';
  const browserExecutable = join(browserRoot, 'Contents/MacOS/camoufox');
  const pythonPath = '/Users/claw/.webenvoy/providers/camoufox/venv/bin/python';
  try { await Promise.all([access(browserRoot), access(browserExecutable), access(pythonPath), access(join(sourceDir, 'camoufox-152.0.4-beta.30-mac.arm64.zip')), access(join(sourceDir, 'camoufox-0.5.6-py3-none-any.whl')), access(join(sourceDir, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl'))]); }
  catch { t.skip('official upstream source fixtures are not available on this host'); return; }
  const input = {
    browser_install_root: browserRoot, browser_executable: browserExecutable, python_path: pythonPath,
    browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
    playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version,
    browser_source_path: join(sourceDir, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
    camoufox_source_path: join(sourceDir, 'camoufox-0.5.6-py3-none-any.whl'),
    playwright_source_path: join(sourceDir, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')
  };
  const binding = await verifyCamoufoxUpstreamInstall(input);
  assert.deepEqual(await resolveCamoufoxSetupBinding({ existingInstallation: { camoufoxUpstream: binding }, hasUpstreamArguments: false }), binding);
});

test('classifies historical Camoufox bindings without resolving or launching them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-camoufox-retirement-test-'));
  try {
    const legacy = {
      coreEndpoint: 'http://127.0.0.1:1',
      harborEndpoint: 'http://127.0.0.1:2',
      camoufoxArtifact: {
        app: join(root, 'missing.app'),
        executable: join(root, 'missing.app/Contents/MacOS/camoufox'),
        manifest: join(root, 'missing.app/Contents/Resources/webenvoy-native-manifest.json'),
        manifest_sha256: 'not-a-real-hash'
      }
    };
    assert.deepEqual(classifyCamoufoxBinding(legacy), { state: 'retired', reason: 'retired_binding' });
    assert.deepEqual(classifyCamoufoxBinding({ coreEndpoint: 'http://127.0.0.1:1', harborEndpoint: 'http://127.0.0.1:2' }), { state: 'retired', reason: 'unqualified' });
    assert.throws(() => classifyCamoufoxBinding(null), /installation_configuration_invalid/);

    const environment = installedRuntimeEnvironment({
      parentEnvironment: { PATH: '/usr/bin', WEBENVOY_DEV_STORE: '/tmp/dev', HARBOR_CAMOUFOX_PATH: '/tmp/untrusted', CAMOUFOX_EXECUTABLE: '/tmp/untrusted' },
      dataDir: join(root, 'data'), installRoot: join(root, 'install'), camoufoxLaunch: classifyCamoufoxBinding(legacy)
    });
    assert.equal(environment.HARBOR_CAMOUFOX_LAUNCH_STATE, 'retired');
    assert.equal(environment.HARBOR_CAMOUFOX_LAUNCH_REASON, 'retired_binding');
    assert.equal(environment.HARBOR_CAMOUFOX_PATH, undefined);
    assert.equal(environment.WEBENVOY_DEV_STORE, undefined);
    assert.equal(environment.CAMOUFOX_EXECUTABLE, undefined);
    assert.equal(environment.HARBOR_PROFILE_STORAGE_ROOT, join(root, 'data/profiles'));

    const unqualified = installedRuntimeEnvironment({ parentEnvironment: { HARBOR_CAMOUFOX_PATH: '/tmp/untrusted' }, dataDir: join(root, 'data'), installRoot: join(root, 'install') });
    assert.equal(unqualified.HARBOR_CAMOUFOX_LAUNCH_STATE, 'retired');
    assert.equal(unqualified.HARBOR_CAMOUFOX_LAUNCH_REASON, 'unqualified');
    assert.equal(unqualified.HARBOR_CAMOUFOX_PATH, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('accepts only the explicit official upstream Camoufox installation binding', async (t) => {
  const sourceDir = '/private/tmp/webenvoy-upstream-source-audit.LWbSiJ';
  const browserRoot = '/Users/claw/Library/Caches/camoufox/browsers/official/152.0.4-beta.30-3b43e766/Camoufox.app';
  const executable = join(browserRoot, 'Contents/MacOS/camoufox');
  const pythonPath = '/Users/claw/.webenvoy/providers/camoufox/venv/bin/python';
  try { await Promise.all([access(browserRoot), access(executable), access(join(sourceDir, 'camoufox-152.0.4-beta.30-mac.arm64.zip')), access(join(sourceDir, 'camoufox-0.5.6-py3-none-any.whl')), access(join(sourceDir, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')), access(pythonPath)]); }
  catch { t.skip('official upstream source fixtures are not available on this host'); return; }
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-camoufox-upstream-test-'));
  try {
    const input = {
      browser_install_root: browserRoot, browser_executable: executable, python_path: pythonPath,
      browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version, camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
      playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version,
      browser_source_path: join(sourceDir, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
      camoufox_source_path: join(sourceDir, 'camoufox-0.5.6-py3-none-any.whl'),
      playwright_source_path: join(sourceDir, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl')
    };
    const binding = await verifyCamoufoxUpstreamInstall(input);
    assert.equal(binding.schema, 'webenvoy.camoufox-upstream/v1');
    assert.deepEqual(classifyCamoufoxBinding({ camoufoxUpstream: binding }), { state: 'qualified', reason: 'official_upstream' });
    assert.deepEqual(await verifyInstalledCamoufox({ camoufoxUpstream: binding }), binding);
    const environment = installedRuntimeEnvironment({
      parentEnvironment: { HARBOR_BROWSER_PATH: '/private/untrusted', CAMOUFOX_EXECUTABLE: '/private/untrusted', WEBENVOY_DEV_STORE: '/private/untrusted' },
      dataDir: join(root, 'data'), installRoot: join(root, 'install'), camoufoxLaunch: { state: 'qualified', reason: 'official_upstream' }, camoufoxBinding: binding
    });
    assert.equal(environment.HARBOR_BROWSER_PATH, executable);
    assert.equal(environment.HARBOR_CAMOUFOX_PATH, executable);
    assert.equal(environment.HARBOR_CAMOUFOX_PYTHON, pythonPath);
    assert.equal(environment.HARBOR_CAMOUFOX_SOURCE_SHA256, CAMOUFOX_UPSTREAM_PINS.browser_source_sha256);
    assert.equal(environment.HARBOR_CAMOUFOX_SOURCE_SHA256, binding.source_sha256.browser);
    assert.equal(environment.HARBOR_CAMOUFOX_BROWSER_SOURCE_SHA256, binding.source_sha256.browser);
    assert.equal(environment.HARBOR_CAMOUFOX_PLAYWRIGHT_SOURCE_SHA256, binding.source_sha256.playwright);
    assert.equal(environment.HARBOR_CAMOUFOX_BROWSER_VERSION, CAMOUFOX_UPSTREAM_PINS.browser_version);
    assert.equal(environment.HARBOR_CAMOUFOX_PLAYWRIGHT_VERSION, CAMOUFOX_UPSTREAM_PINS.playwright_version);
    assert.equal(environment.WEBENVOY_DEV_STORE, undefined);
    await writeFile(join(root, 'wrong-source'), 'not-an-official-archive');
    await assert.rejects(verifyCamoufoxUpstreamInstall({ ...input, browser_source_path: join(root, 'wrong-source') }), /source_hash_mismatch/);
    await assert.rejects(verifyCamoufoxUpstreamInstall({ ...input, browser_version: '152.0.4' }), /browser_version_invalid/);
    await assert.rejects(verifyCamoufoxUpstreamInstall({ ...input, browser_executable: join(root, 'outside') }), /browser_executable_invalid/);
    await assert.rejects(verifyCamoufoxUpstreamInstall({ ...input, camoufoxArtifact: {} }), /artifact_binding_retired/);
  } finally { await rm(root, { recursive: true, force: true }); }
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
    assert.equal(await previousRoot(alias), await import('node:fs/promises').then(({ realpath }) => realpath(appRoot)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
