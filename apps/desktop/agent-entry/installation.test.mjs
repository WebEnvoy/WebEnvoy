import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, link, mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installManagedFiles, uninstallManagedFiles } from './installation.mjs';
import { recoveryOperationRef } from './bundle.mjs';
import { previousRoot } from './previous-installation.mjs';
import { bindCamoufoxArtifact, CAMOUFOX_NATIVE_PINS, camoufoxArtifactInstallationRecord, resolveInstalledCamoufoxArtifact, sameCamoufoxArtifact, verifyCamoufoxArtifact } from './provider-artifact.mjs';
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

test('binds only a verified Camoufox test artifact and strips untrusted service overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webenvoy-camoufox-binding-test-'));
  try {
    const artifact = await createCamoufoxArtifact(root);
    const verified = await verifyCamoufoxArtifact(artifact);
    const installation = bindCamoufoxArtifact({ coreEndpoint: 'http://127.0.0.1:1', harborEndpoint: 'http://127.0.0.1:2' }, verified);
    assert.deepEqual(installation.camoufoxArtifact, camoufoxArtifactInstallationRecord(verified));
    assert.equal(sameCamoufoxArtifact(await resolveInstalledCamoufoxArtifact(installation), verified), true);
    assert.throws(() => bindCamoufoxArtifact(installation, { ...verified, executable: join(root, 'different') }), /camoufox_artifact_binding_mismatch/);

    const environment = installedRuntimeEnvironment({
      parentEnvironment: { PATH: '/usr/bin', WEBENVOY_DEV_STORE: '/tmp/dev', HARBOR_CAMOUFOX_PATH: '/tmp/untrusted', CAMOUFOX_EXECUTABLE: '/tmp/untrusted' },
      dataDir: join(root, 'data'), installRoot: join(root, 'install'), camoufoxArtifact: verified
    });
    assert.equal(environment.HARBOR_CAMOUFOX_PATH, verified.executable);
    assert.equal(environment.WEBENVOY_DEV_STORE, undefined);
    assert.equal(environment.CAMOUFOX_EXECUTABLE, undefined);
    assert.equal(environment.HARBOR_PROFILE_STORAGE_ROOT, join(root, 'data/profiles'));

    const legacyEnvironment = installedRuntimeEnvironment({ parentEnvironment: { HARBOR_CAMOUFOX_PATH: '/tmp/untrusted' }, dataDir: join(root, 'data'), installRoot: join(root, 'install') });
    assert.equal(legacyEnvironment.HARBOR_CAMOUFOX_PATH, undefined);

    const manifest = await readFile(verified.manifest);
    await writeFile(verified.manifest, JSON.stringify({ schema: CAMOUFOX_NATIVE_PINS }), 'utf8');
    await assert.rejects(resolveInstalledCamoufoxArtifact(installation), /camoufox_artifact_manifest_invalid/);
    await writeFile(verified.manifest, manifest);
    await writeFile(join(artifact, 'Contents/Info.plist'), infoWithBundleName('Tampered'));
    await assert.rejects(verifyCamoufoxArtifact(artifact), /camoufox_artifact_output_mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function createCamoufoxArtifact(root) {
  const app = join(root, 'WebEnvoy Camoufox Native Test.app');
  const macos = join(app, 'Contents/MacOS');
  const resources = join(app, 'Contents/Resources');
  await mkdir(macos, { recursive: true });
  await mkdir(resources, { recursive: true });
  const source = '/Applications/Camoufox.app/Contents';
  const sourceFiles = [
    ['Resources/omni.ja', 'Resources/omni.ja'],
    ['Resources/properties.json', 'Resources/properties.json'],
    ['MacOS/camoufox', 'MacOS/camoufox']
  ];
  for (const [from, to] of sourceFiles) await copyOrLink(join(source, from), join(app, 'Contents', to));
  const info = infoWithBundleName(CAMOUFOX_NATIVE_PINS.bundle_name);
  await writeFile(join(app, 'Contents/Info.plist'), info);
  await writeFile(join(resources, 'application.ini'), `[App]\nVersion=${CAMOUFOX_NATIVE_PINS.browser_version}\n`);
  await copyOrLink(join(resources, 'properties.json'), join(macos, 'properties.json'));
  const output = {
    app,
    executable: join(macos, 'camoufox'),
    omni_sha256: await fileSha(join(resources, 'omni.ja')),
    properties_sha256: await fileSha(join(resources, 'properties.json')),
    executable_sha256: await fileSha(join(macos, 'camoufox')),
    info_plist_sha256: await fileSha(join(app, 'Contents/Info.plist')),
    application_ini_sha256: await fileSha(join(resources, 'application.ini')),
    adjacent_properties_sha256: await fileSha(join(macos, 'properties.json'))
  };
  const manifest = {
    schema: 'webenvoy.camoufox-native/v1', patch_id: 'managed-native-snapshot', test_only: true, distribution_or_production_use_authorized: false,
    source: { app: '/Applications/Camoufox.app', executable: CAMOUFOX_NATIVE_PINS.source_executable_sha256, browser_version: CAMOUFOX_NATIVE_PINS.browser_version, 'omni.ja': CAMOUFOX_NATIVE_PINS.source_omni_sha256, 'properties.json': CAMOUFOX_NATIVE_PINS.properties_sha256, info_plist: CAMOUFOX_NATIVE_PINS.source_info_plist_sha256, application_ini: CAMOUFOX_NATIVE_PINS.source_application_ini_sha256 },
    output,
    identity: { bundle_identifier: CAMOUFOX_NATIVE_PINS.bundle_identifier, bundle_name: CAMOUFOX_NATIVE_PINS.bundle_name },
    provider: { camoufox_version: CAMOUFOX_NATIVE_PINS.camoufox_version, browser_version: CAMOUFOX_NATIVE_PINS.browser_version },
    patched_entries: Object.fromEntries(['chrome/juggler/content/protocol/Protocol.js', 'chrome/juggler/content/protocol/BrowserHandler.js', 'chrome/juggler/content/TargetRegistry.js'].map((name, index) => [name, { before_sha256: String(index + 1).padStart(64, '0'), after_sha256: String(index + 4).padStart(64, '0') }]))
  };
  await writeFile(join(resources, 'webenvoy-native-manifest.json'), JSON.stringify(manifest) + '\n');
  return app;
}

function infoWithBundleName(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleExecutable</key><string>camoufox</string>\n<key>CFBundleIdentifier</key><string>${CAMOUFOX_NATIVE_PINS.bundle_identifier}</string>\n<key>CFBundleName</key><string>${name}</string>\n</dict></plist>\n`;
}

async function copyOrLink(source, target) {
  try { await link(source, target); } catch { await copyFile(source, target); }
}

async function fileSha(path) {
  const { sha } = await import('./bundle.mjs');
  return sha(await readFile(path));
}
