import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { sha } from './bundle.mjs';

export const CAMOUFOX_NATIVE_MANIFEST_SCHEMA = 'webenvoy.camoufox-native/v1';
export const CAMOUFOX_NATIVE_TAB_HANDOFF_MANIFEST_SCHEMA = 'webenvoy.camoufox-native/v2';
export const CAMOUFOX_NATIVE_PATCH_ID = 'managed-native-snapshot';
export const CAMOUFOX_NATIVE_TAB_HANDOFF_PATCH_ID = 'managed-native-tab-handoff';
export const CAMOUFOX_NATIVE_PINS = Object.freeze({
  camoufox_version: '0.5.6',
  browser_version: '152.0.4-beta.30',
  source_omni_sha256: 'bed61930f353ef21011487c4c0fc84e64103b00617b5f8dd0538fb261d0732a5',
  properties_sha256: '10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4',
  source_executable_sha256: 'e468f25acba5085624da4d1ac809fd5679fa281ed2b0265f82efe63904900b33',
  source_info_plist_sha256: 'c843c5dd03cb9c6241ec589573bd408df69a5a9dc079aba3e8711ee3adac60d2',
  source_application_ini_sha256: 'b96cb1a88c4c6dd22b308f8125b70a227ef6fb10dee994c8daf47c9cf019f2a5',
  bundle_identifier: 'com.webenvoy.camoufox.native504',
  bundle_name: 'WebEnvoy Camoufox Native Test',
  source_chrome_css_sha256: '8edbf68d8b73d2e59bcbaa37560ebfdc145888b37c98628eda6bc3e5f54359ab',
  tab_handoff_css_sha256: '7e7f9e13bfb872344f81934fde84464e1791b03b3831b6e6a467e7300662d6eb',
  tab_handoff_bundle_identifier: 'com.webenvoy.camoufox.native510',
  tab_handoff_bundle_name: 'WebEnvoy Camoufox Native Tab Handoff Test'
});

const HASH = /^[a-f0-9]{64}$/;
const PATCHED_ENTRIES = [
  'chrome/juggler/content/protocol/Protocol.js',
  'chrome/juggler/content/protocol/BrowserHandler.js',
  'chrome/juggler/content/TargetRegistry.js',
  'chrome/juggler/content/protocol/PageHandler.js'
];
const SOURCE_HASHES = {
  'omni.ja': CAMOUFOX_NATIVE_PINS.source_omni_sha256,
  'properties.json': CAMOUFOX_NATIVE_PINS.properties_sha256,
  executable: CAMOUFOX_NATIVE_PINS.source_executable_sha256,
  info_plist: CAMOUFOX_NATIVE_PINS.source_info_plist_sha256,
  application_ini: CAMOUFOX_NATIVE_PINS.source_application_ini_sha256
};
const OUTPUT_HASHES = ['omni_sha256', 'properties_sha256', 'executable_sha256', 'info_plist_sha256', 'application_ini_sha256', 'adjacent_properties_sha256'];
const TAB_HANDOFF_CSS_PATH = 'Contents/Resources/chrome.css';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject(code) {
  throw new Error(code);
}

async function regular(path, code) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) reject(code);
    return info;
  } catch (error) {
    if (error.code === 'ENOENT') reject(code);
    throw error;
  }
}

async function directory(path, code) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) reject(code);
  } catch (error) {
    if (error.code === 'ENOENT') reject(code);
    throw error;
  }
}

async function bytes(path, code) {
  await regular(path, code);
  return readFile(path);
}

function hashField(value, key, code) {
  if (!record(value) || !HASH.test(value[key] ?? '')) reject(code);
  return value[key];
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
}

function verifySource(source, tabHandoff) {
  if (!record(source) || typeof source.app !== 'string' || !source.app || source.executable !== CAMOUFOX_NATIVE_PINS.source_executable_sha256 || source.browser_version !== CAMOUFOX_NATIVE_PINS.browser_version) reject('camoufox_artifact_source_pins_mismatch');
  for (const [key, expected] of Object.entries(SOURCE_HASHES)) if (source[key] !== expected) reject('camoufox_artifact_source_pins_mismatch');
  if (tabHandoff ? source.chrome_css !== CAMOUFOX_NATIVE_PINS.source_chrome_css_sha256 : Object.hasOwn(source, 'chrome_css')) reject('camoufox_artifact_source_pins_mismatch');
}

function verifyPatchedEntries(entries) {
  if (!record(entries) || !exactKeys(entries, PATCHED_ENTRIES)) reject('camoufox_artifact_patch_manifest_invalid');
  for (const name of PATCHED_ENTRIES) {
    const entry = entries[name];
    hashField(entry, 'before_sha256', 'camoufox_artifact_patch_manifest_invalid');
    hashField(entry, 'after_sha256', 'camoufox_artifact_patch_manifest_invalid');
  }
}

function xmlValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'") : undefined;
}

function verifyPlistIdentity(bytes, executableName, identity) {
  const text = bytes.toString('utf8');
  if (!text.includes('<plist') || xmlValue(text, 'CFBundleIdentifier') !== identity.bundle_identifier ||
      xmlValue(text, 'CFBundleName') !== identity.bundle_name || xmlValue(text, 'CFBundleExecutable') !== executableName) {
    reject('camoufox_artifact_identity_mismatch');
  }
}

export async function verifyCamoufoxArtifact(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) reject('camoufox_artifact_path_invalid');
  const app = resolve(inputPath);
  let canonical;
  try { canonical = await realpath(app); } catch (error) { if (error.code === 'ENOENT') reject('camoufox_artifact_missing'); throw error; }
  // `realpath` may normalize an OS alias such as /var -> /private/var. The
  // artifact itself must not be a symlink, while harmless aliases in its
  // parent path remain usable and are preserved in the manifest contract.
  const original = await realpath('/Applications/Camoufox.app').catch(() => resolve('/Applications/Camoufox.app'));
  if (canonical === original) reject('camoufox_artifact_original_app_refused');
  await directory(app, 'camoufox_artifact_path_invalid');
  const contents = join(app, 'Contents');
  const macos = join(contents, 'MacOS');
  const resources = join(contents, 'Resources');
  await directory(contents, 'camoufox_artifact_layout_invalid');
  await directory(macos, 'camoufox_artifact_layout_invalid');
  await directory(resources, 'camoufox_artifact_layout_invalid');

  const manifestPath = join(resources, 'webenvoy-native-manifest.json');
  const manifestBytes = await bytes(manifestPath, 'camoufox_artifact_manifest_missing');
  if (manifestBytes.length > 256 * 1024) reject('camoufox_artifact_manifest_invalid');
  let manifest;
  try {
    const text = manifestBytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(manifestBytes)) reject('camoufox_artifact_manifest_invalid');
    manifest = JSON.parse(text);
  } catch (error) {
    if (error.message?.startsWith('camoufox_artifact_')) throw error;
    reject('camoufox_artifact_manifest_invalid');
  }
  if (!record(manifest) || manifest.test_only !== true || manifest.distribution_or_production_use_authorized !== false) reject('camoufox_artifact_manifest_invalid');
  const tabHandoff = manifest.schema === CAMOUFOX_NATIVE_TAB_HANDOFF_MANIFEST_SCHEMA && manifest.patch_id === CAMOUFOX_NATIVE_TAB_HANDOFF_PATCH_ID;
  const legacy = manifest.schema === CAMOUFOX_NATIVE_MANIFEST_SCHEMA && manifest.patch_id === CAMOUFOX_NATIVE_PATCH_ID;
  if (!tabHandoff && !legacy) reject('camoufox_artifact_manifest_invalid');
  const provider = manifest.provider;
  if (!record(provider) || provider.camoufox_version !== CAMOUFOX_NATIVE_PINS.camoufox_version || provider.browser_version !== CAMOUFOX_NATIVE_PINS.browser_version) reject('camoufox_artifact_provider_pins_mismatch');
  const identity = manifest.identity;
  const expectedIdentity = tabHandoff
    ? { bundle_identifier: CAMOUFOX_NATIVE_PINS.tab_handoff_bundle_identifier, bundle_name: CAMOUFOX_NATIVE_PINS.tab_handoff_bundle_name }
    : { bundle_identifier: CAMOUFOX_NATIVE_PINS.bundle_identifier, bundle_name: CAMOUFOX_NATIVE_PINS.bundle_name };
  if (!record(identity) || identity.bundle_identifier !== expectedIdentity.bundle_identifier || identity.bundle_name !== expectedIdentity.bundle_name) reject('camoufox_artifact_identity_mismatch');
  const output = manifest.output;
  if (!record(output) || typeof output.app !== 'string' || resolve(output.app) !== app || typeof output.executable !== 'string') reject('camoufox_artifact_output_mismatch');
  const executable = resolve(output.executable);
  const relativeExecutable = relative(macos, executable);
  if (!relativeExecutable || relativeExecutable.startsWith('..') || relativeExecutable.includes('/') || basename(relativeExecutable) !== relativeExecutable) reject('camoufox_artifact_executable_mismatch');
  const executableInfo = await regular(executable, 'camoufox_artifact_executable_missing');
  if ((executableInfo.mode & 0o111) === 0) reject('camoufox_artifact_executable_not_executable');
  verifySource(manifest.source, tabHandoff);
  verifyPatchedEntries(manifest.patched_entries);

  const infoPlist = join(contents, 'Info.plist');
  const applicationIni = join(resources, 'application.ini');
  const omni = join(resources, 'omni.ja');
  const properties = join(resources, 'properties.json');
  const adjacentProperties = join(macos, 'properties.json');
  const chromeCss = join(app, TAB_HANDOFF_CSS_PATH);
  if (tabHandoff) await regular(chromeCss, 'camoufox_artifact_output_missing');
  const actual = {
    omni_sha256: sha(await bytes(omni, 'camoufox_artifact_output_missing')),
    properties_sha256: sha(await bytes(properties, 'camoufox_artifact_output_missing')),
    executable_sha256: sha(await bytes(executable, 'camoufox_artifact_output_missing')),
    info_plist_sha256: sha(await bytes(infoPlist, 'camoufox_artifact_output_missing')),
    application_ini_sha256: sha(await bytes(applicationIni, 'camoufox_artifact_output_missing')),
    adjacent_properties_sha256: sha(await bytes(adjacentProperties, 'camoufox_artifact_output_missing'))
  };
  if (tabHandoff) actual.chrome_css_sha256 = sha(await bytes(chromeCss, 'camoufox_artifact_output_missing'));
  for (const key of OUTPUT_HASHES) if (hashField(output, key, 'camoufox_artifact_output_mismatch') !== actual[key]) reject('camoufox_artifact_output_mismatch');
  if (tabHandoff) {
    if (!hashField(output, 'chrome_css_sha256', 'camoufox_artifact_output_mismatch') || output.chrome_css_sha256 !== actual.chrome_css_sha256 || actual.chrome_css_sha256 !== CAMOUFOX_NATIVE_PINS.tab_handoff_css_sha256) reject('camoufox_artifact_output_mismatch');
    const assets = manifest.patched_assets;
    const cssPatch = record(assets) && Object.keys(assets).length === 1 && record(assets[TAB_HANDOFF_CSS_PATH]) ? assets[TAB_HANDOFF_CSS_PATH] : null;
    if (!cssPatch || cssPatch.before_sha256 !== CAMOUFOX_NATIVE_PINS.source_chrome_css_sha256 || cssPatch.after_sha256 !== CAMOUFOX_NATIVE_PINS.tab_handoff_css_sha256) reject('camoufox_artifact_patch_manifest_invalid');
  } else if (Object.hasOwn(manifest, 'patched_assets') || Object.hasOwn(output, 'chrome_css_sha256')) reject('camoufox_artifact_patch_manifest_invalid');
  if (actual.executable_sha256 !== CAMOUFOX_NATIVE_PINS.source_executable_sha256 || actual.application_ini_sha256 !== CAMOUFOX_NATIVE_PINS.source_application_ini_sha256 ||
      actual.properties_sha256 !== CAMOUFOX_NATIVE_PINS.properties_sha256 || !Buffer.from(await readFile(properties)).equals(await readFile(adjacentProperties))) reject('camoufox_artifact_output_mismatch');
  verifyPlistIdentity(await readFile(infoPlist), relativeExecutable, expectedIdentity);
  const ini = (await readFile(applicationIni)).toString('utf8');
  if (!ini.split(/\r?\n/).some(line => line.trim() === `Version=${CAMOUFOX_NATIVE_PINS.browser_version}`)) reject('camoufox_artifact_browser_version_mismatch');
  return {
    app,
    executable,
    manifest: manifestPath,
    manifest_sha256: sha(manifestBytes),
    output,
    source: manifest.source,
    provider,
    identity,
    patch_id: manifest.patch_id
  };
}

export function camoufoxArtifactInstallationRecord(binding) {
  return { app: binding.app, executable: binding.executable, manifest: binding.manifest, manifest_sha256: binding.manifest_sha256 };
}

export async function resolveInstalledCamoufoxArtifact(installation) {
  if (!record(installation)) reject('installation_configuration_invalid');
  if (!Object.prototype.hasOwnProperty.call(installation, 'camoufoxArtifact')) return null;
  const configured = installation.camoufoxArtifact;
  if (!exactKeys(configured, ['app', 'executable', 'manifest', 'manifest_sha256']) || !HASH.test(configured.manifest_sha256)) reject('camoufox_artifact_binding_invalid');
  const binding = await verifyCamoufoxArtifact(configured.app);
  if (configured.app !== binding.app || configured.executable !== binding.executable || configured.manifest !== binding.manifest || configured.manifest_sha256 !== binding.manifest_sha256) reject('camoufox_artifact_binding_mismatch');
  return binding;
}

export function sameCamoufoxArtifact(left, right) {
  return left?.app === right?.app && left?.executable === right?.executable && left?.manifest === right?.manifest && left?.manifest_sha256 === right?.manifest_sha256;
}

export function bindCamoufoxArtifact(installation, binding) {
  if (!record(installation)) reject('installation_configuration_invalid');
  if (!binding) return installation;
  const next = camoufoxArtifactInstallationRecord(binding);
  if (Object.prototype.hasOwnProperty.call(installation, 'camoufoxArtifact')) {
    if (!sameCamoufoxArtifact(installation.camoufoxArtifact, next)) reject('camoufox_artifact_binding_mismatch');
    return installation;
  }
  return { ...installation, camoufoxArtifact: next };
}

export function validateCamoufoxArtifactSetup(existingInstallation, configuredArtifact, requestedArtifact) {
  if (requestedArtifact && existingInstallation && !configuredArtifact) reject('camoufox_artifact_binding_requires_new_data_root');
  if (configuredArtifact && requestedArtifact && !sameCamoufoxArtifact(configuredArtifact, requestedArtifact)) reject('camoufox_artifact_binding_mismatch');
}
