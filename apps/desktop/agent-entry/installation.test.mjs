import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { recoveryOperationRef } from './bundle.mjs';
import { previousRoot } from './previous-installation.mjs';
import { CAMOUFOX_UPSTREAM_PINS, CHROME_OFFICIAL_INSTALL_SCHEMA, CHROME_OFFICIAL_PINS, assertProviderPythonPairing, classifyCamoufoxBinding, classifyChromeOfficialBinding, readStoredChromeOfficialBinding, resolveCamoufoxSetupBinding, verifyCamoufoxUpstreamInstall, verifyChromeOfficialInstall, verifyInstalledCamoufox, verifyInstalledChromeOfficial } from './provider-artifact.mjs';
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

test('keeps Chrome exact pairing separate from Camoufox and projects only verified facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-chrome-pairing-test-'));
  try {
    const binding = {
      schema: CHROME_OFFICIAL_INSTALL_SCHEMA,
      provider: CHROME_OFFICIAL_PINS.provider,
      source: CHROME_OFFICIAL_PINS.source,
      signature_status: CHROME_OFFICIAL_PINS.signature_status,
      browser_version: CHROME_OFFICIAL_PINS.browser_version,
      playwright_version: CHROME_OFFICIAL_PINS.playwright_version,
      browser: {
        install_root: join(root, 'Google Chrome.app'),
        executable: join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
        version: CHROME_OFFICIAL_PINS.browser_version,
        executable_sha256: CHROME_OFFICIAL_PINS.executable_sha256
      },
      python: { path: join(root, 'python'), executable_sha256: 'a'.repeat(64) },
      sources: { browser: { path: join(root, 'Chrome.dmg'), sha256: CHROME_OFFICIAL_PINS.source_sha256 } },
      source_sha256: { browser: CHROME_OFFICIAL_PINS.source_sha256 }
    };
    assert.deepEqual(classifyChromeOfficialBinding({ chromeOfficial: binding }), { state: 'qualified', reason: 'official_upstream' });
    assert.deepEqual(readStoredChromeOfficialBinding(binding), binding);
    const missingPython = { ...binding }; delete missingPython.python;
    assert.throws(() => readStoredChromeOfficialBinding(missingPython), /chrome_stored_binding_python_missing/);
    assert.throws(() => readStoredChromeOfficialBinding({ ...binding, unexpected: true }), /chrome_stored_binding_unknown_field/);
    assert.throws(() => readStoredChromeOfficialBinding({ ...binding, browser: { ...binding.browser, version: '153.0.8010.38' } }), /chrome_stored_browser_version_conflict/);
    assert.throws(() => readStoredChromeOfficialBinding({ ...binding, source_sha256: { browser: '0'.repeat(64) } }), /chrome_stored_source_hash_conflict/);
    assert.throws(() => readStoredChromeOfficialBinding({ ...binding, schema: 'webenvoy.chrome-official/v0' }), /chrome_stored_binding_version_unsupported/);
    await assert.rejects(verifyChromeOfficialInstall({
      schema: CHROME_OFFICIAL_INSTALL_SCHEMA, provider: CHROME_OFFICIAL_PINS.provider, source: CHROME_OFFICIAL_PINS.source,
      browser_version: CHROME_OFFICIAL_PINS.browser_version, playwright_version: CHROME_OFFICIAL_PINS.playwright_version,
      browser_install_root: join(root, 'one.app'), browser_root: join(root, 'other.app'), browser_executable: binding.browser.executable,
      python_path: binding.python.path, browser_source_path: binding.sources.browser.path
    }), /chrome_browser_root_conflict/);
    assert.deepEqual(classifyChromeOfficialBinding({ chromeOfficial: { schema: 'webenvoy.chrome-official/v0' } }), { state: 'retired', reason: 'unqualified' });
    assert.equal(await verifyInstalledChromeOfficial({ chrome: { path: '/legacy/chrome' } }), null);
    const environment = installedRuntimeEnvironment({
      parentEnvironment: {
        HARBOR_BROWSER_PATH: '/untrusted', HARBOR_PLAYWRIGHT_PYTHON: '/untrusted/python', WEBENVOY_DEV_STORE: '/untrusted'
      },
      dataDir: join(root, 'data'), installRoot: join(root, 'install'), chromeLaunch: { state: 'qualified', reason: 'official_upstream' }, chromeBinding: binding
    });
    assert.equal(environment.HARBOR_BROWSER_PROVIDER, 'chrome_official');
    assert.equal(environment.HARBOR_BROWSER_PATH, binding.browser.executable);
    assert.equal(environment.HARBOR_CHROME_PATH, binding.browser.executable);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_INSTALL_ROOT, binding.browser.install_root);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_SIGNATURE_STATUS, CHROME_OFFICIAL_PINS.signature_status);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_SOURCE_SHA256, CHROME_OFFICIAL_PINS.source_sha256);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_EXECUTABLE_SHA256, CHROME_OFFICIAL_PINS.executable_sha256);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_BROWSER_VERSION, CHROME_OFFICIAL_PINS.browser_version);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_PLAYWRIGHT_VERSION, CHROME_OFFICIAL_PINS.playwright_version);
    assert.equal(environment.HARBOR_PLAYWRIGHT_PYTHON, binding.python.path);
    assert.equal(environment.HARBOR_CAMOUFOX_PATH, undefined);
    assert.equal(environment.WEBENVOY_DEV_STORE, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects an incomplete Chrome v1 record before it can qualify a launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-chrome-incomplete-test-'));
  try {
    const appRoot = join(root, 'Google Chrome.app');
    const executable = join(appRoot, 'Contents/MacOS/Google Chrome');
    await mkdir(join(appRoot, 'Contents/MacOS'), { recursive: true });
    await writeFile(executable, '#!/bin/sh\n');
    await import('node:fs/promises').then(({ chmod }) => chmod(executable, 0o755));
    await assert.rejects(verifyChromeOfficialInstall({
      schema: CHROME_OFFICIAL_INSTALL_SCHEMA,
      provider: CHROME_OFFICIAL_PINS.provider,
      source: CHROME_OFFICIAL_PINS.source,
      browser_version: CHROME_OFFICIAL_PINS.browser_version,
      playwright_version: CHROME_OFFICIAL_PINS.playwright_version,
      browser_install_root: appRoot,
      browser_executable: executable,
      python_path: join(root, 'python'),
      browser_source_path: join(root, 'Chrome.dmg')
    }), /chrome_executable_hash_mismatch/);
    assert.throws(() => readStoredChromeOfficialBinding({ schema: 'webenvoy.chrome-official/v0' }), /chrome_stored_binding_version_unsupported/);
    await assert.rejects(verifyInstalledChromeOfficial({ chromeOfficial: { schema: 'webenvoy.chrome-official/v0' } }), /chrome_stored_binding_version_unsupported/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rechecks the persisted Chrome Python executable hash before qualification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-chrome-python-hash-test-'));
  try {
    const appRoot = join(root, 'Google Chrome.app');
    const executable = join(appRoot, 'Contents/MacOS/Google Chrome');
    const python = join(root, 'python');
    const source = join(root, 'Chrome.dmg');
    await mkdir(join(appRoot, 'Contents/MacOS'), { recursive: true });
    await writeFile(executable, 'chrome fixture');
    await writeFile(python, '#!/bin/sh\n');
    await writeFile(source, 'source fixture');
    await chmod(executable, 0o755);
    await chmod(python, 0o755);
    const currentPythonHash = 'f'.repeat(64);
    const command = async (file) => {
      if (file === '/usr/bin/plutil') return { stdout: `${CHROME_OFFICIAL_PINS.browser_version}\n` };
      if (file === '/usr/bin/codesign') return { stdout: '' };
      if (file.endsWith('/python')) return { stdout: `${CHROME_OFFICIAL_PINS.playwright_version}\n` };
      throw new Error(`unexpected command: ${file}`);
    };
    const hashFile = path => path.endsWith('/Google Chrome') ? CHROME_OFFICIAL_PINS.executable_sha256 : path.endsWith('/python') ? currentPythonHash : CHROME_OFFICIAL_PINS.source_sha256;
    const binding = {
      schema: CHROME_OFFICIAL_INSTALL_SCHEMA,
      provider: CHROME_OFFICIAL_PINS.provider,
      source: CHROME_OFFICIAL_PINS.source,
      signature_status: CHROME_OFFICIAL_PINS.signature_status,
      browser_version: CHROME_OFFICIAL_PINS.browser_version,
      playwright_version: CHROME_OFFICIAL_PINS.playwright_version,
      browser: { install_root: appRoot, executable, version: CHROME_OFFICIAL_PINS.browser_version, executable_sha256: CHROME_OFFICIAL_PINS.executable_sha256 },
      python: { path: python, executable_sha256: 'e'.repeat(64) },
      sources: { browser: { path: source, sha256: CHROME_OFFICIAL_PINS.source_sha256 } },
      source_sha256: { browser: CHROME_OFFICIAL_PINS.source_sha256 }
    };
    const options = { platform: 'darwin', execFile: command, hashFile };
    await assert.rejects(verifyInstalledChromeOfficial({ chromeOfficial: binding }, options), /chrome_python_hash_mismatch/);
    const verified = await verifyInstalledChromeOfficial({ chromeOfficial: { ...binding, python: { path: python, executable_sha256: currentPythonHash } } }, options);
    assert.equal(verified.python.executable_sha256, currentPythonHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('keeps provider-specific facts when both exact bindings share one Python runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-provider-pairing-test-'));
  try {
    const python = { path: join(root, 'python'), executable_sha256: 'b'.repeat(64) };
    const chromeBinding = {
      schema: CHROME_OFFICIAL_INSTALL_SCHEMA, provider: CHROME_OFFICIAL_PINS.provider, source: CHROME_OFFICIAL_PINS.source,
      signature_status: CHROME_OFFICIAL_PINS.signature_status, browser_version: CHROME_OFFICIAL_PINS.browser_version,
      playwright_version: CHROME_OFFICIAL_PINS.playwright_version,
      browser: { install_root: join(root, 'Chrome.app'), executable: join(root, 'Chrome.app/Contents/MacOS/Google Chrome'), version: CHROME_OFFICIAL_PINS.browser_version, executable_sha256: CHROME_OFFICIAL_PINS.executable_sha256 },
      python,
      sources: { browser: { path: join(root, 'Chrome.dmg'), sha256: CHROME_OFFICIAL_PINS.source_sha256 } },
      source_sha256: { browser: CHROME_OFFICIAL_PINS.source_sha256 }
    };
    const camoufoxBinding = {
      browser: { install_root: join(root, 'Camoufox.app'), executable: join(root, 'Camoufox.app/Contents/MacOS/camoufox') },
      python, source: 'official_release', properties_sha256: CAMOUFOX_UPSTREAM_PINS.properties_sha256,
      camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version, browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version,
      playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version,
      source_sha256: { browser: CAMOUFOX_UPSTREAM_PINS.browser_source_sha256, playwright: CAMOUFOX_UPSTREAM_PINS.playwright_source_sha256 }
    };
    assert.doesNotThrow(() => assertProviderPythonPairing(camoufoxBinding, chromeBinding));
    const environment = installedRuntimeEnvironment({
      parentEnvironment: {}, dataDir: join(root, 'data'), installRoot: join(root, 'install'),
      camoufoxLaunch: { state: 'qualified', reason: 'official_upstream' }, camoufoxBinding,
      chromeLaunch: { state: 'qualified', reason: 'official_upstream' }, chromeBinding
    });
    assert.equal(environment.HARBOR_BROWSER_PROVIDER, 'camoufox');
    assert.equal(environment.HARBOR_BROWSER_PATH, camoufoxBinding.browser.executable);
    assert.equal(environment.HARBOR_CAMOUFOX_PYTHON, python.path);
    assert.equal(environment.HARBOR_PLAYWRIGHT_PYTHON, python.path);
    assert.equal(environment.HARBOR_CHROME_OFFICIAL_PATH, chromeBinding.browser.executable);
    assert.throws(() => assertProviderPythonPairing(camoufoxBinding, { ...chromeBinding, python: { path: join(root, 'other-python'), executable_sha256: 'c'.repeat(64) } }), /provider_playwright_python_pairing_mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
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
