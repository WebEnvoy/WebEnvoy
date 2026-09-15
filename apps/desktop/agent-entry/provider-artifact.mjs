import { lstat, readFile, realpath } from 'node:fs/promises';
import { execFile as runFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, resolve } from 'node:path';
import { sha } from './bundle.mjs';

const execFile = promisify(runFile);

const RETIRED_STATE = 'retired';
const RETIRED_BINDING_REASON = 'retired_binding';
const UNQUALIFIED_REASON = 'unqualified';
const QUALIFIED_STATE = 'qualified';
const OFFICIAL_REASON = 'official_upstream';
const HASH = /^[a-f0-9]{64}$/;

export const CAMOUFOX_UPSTREAM_INSTALL_SCHEMA = 'webenvoy.camoufox-upstream/v1';
export const CAMOUFOX_UPSTREAM_PINS = Object.freeze({
  provider: 'camoufox',
  camoufox_version: '0.5.6',
  browser_version: '152.0.4-beta.30',
  playwright_version: '1.60.0',
  properties_sha256: '10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4',
  browser_source_sha256: '3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3',
  camoufox_source_sha256: 'b906836cd952376a466f0e55445f139b8a65adfb9f18ab55cb2cd0c727b11561',
  playwright_source_sha256: '39b5420ba6145045b69ced4c5c47d4d9fe5bddfc8ff816c518913afcb25ec7a5'
});

export const CHROME_OFFICIAL_INSTALL_SCHEMA = 'webenvoy.chrome-official/v1';
export const CHROME_OFFICIAL_PINS = Object.freeze({
  provider: 'chrome_official',
  source: 'official_release',
  browser_version: '153.0.8010.37',
  playwright_version: '1.60.0',
  source_sha256: '6b6cf06fc357a647d26a32453780f020d9d36978ebe30d69ba8a233b538373e3',
  executable_sha256: '83dfc7d9e4fde4272ced1c0cc8d3584d3b5d3d3bdac46978ee05031e8c2ae3c2',
  signature_status: 'apple_codesign_verified'
});

const CHROME_STORED_KEYS = ['schema', 'provider', 'source', 'signature_status', 'browser_version', 'playwright_version', 'browser', 'python', 'sources', 'source_sha256'];
const CHROME_STORED_BROWSER_KEYS = ['install_root', 'executable', 'version', 'executable_sha256'];
const CHROME_STORED_PYTHON_KEYS = ['path', 'executable_sha256'];
const CHROME_STORED_SOURCES_KEYS = ['browser'];
const CHROME_STORED_SOURCE_KEYS = ['path', 'sha256'];
const CHROME_STORED_SOURCE_HASH_KEYS = ['browser'];

const RETIRED_BINDING_KEYS = ['camoufoxArtifact', 'native504', 'native510', 'camoufoxNativeArtifact', 'camoufoxNativeBinding'];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Classify the historical Camoufox installation field without touching its
 * paths. The record remains local evidence only; it is never a launch input.
 */
export function classifyCamoufoxBinding(installation) {
  if (!record(installation)) throw new Error('installation_configuration_invalid');
  return RETIRED_BINDING_KEYS.some(key => Object.hasOwn(installation, key))
    ? { state: RETIRED_STATE, reason: RETIRED_BINDING_REASON }
    : record(installation.camoufoxUpstream) && installation.camoufoxUpstream.schema === CAMOUFOX_UPSTREAM_INSTALL_SCHEMA
      ? { state: QUALIFIED_STATE, reason: OFFICIAL_REASON }
    : { state: RETIRED_STATE, reason: UNQUALIFIED_REASON };
}

/**
 * Classify the owner-persisted Chrome record without treating an old or
 * incomplete record as a new shared-execution qualification.
 */
export function classifyChromeOfficialBinding(installation) {
  if (!record(installation)) throw new Error('installation_configuration_invalid');
  try {
    readStoredChromeOfficialBinding(installation.chromeOfficial);
    return { state: QUALIFIED_STATE, reason: OFFICIAL_REASON };
  } catch {
    return { state: RETIRED_STATE, reason: UNQUALIFIED_REASON };
  }
}

/** A shared installed Python must identify the same runtime for both adapters. */
export function assertProviderPythonPairing(camoufoxBinding, chromeBinding) {
  if (!camoufoxBinding || !chromeBinding) return;
  if (camoufoxBinding.python?.path !== chromeBinding.python?.path ||
    camoufoxBinding.python?.executable_sha256 !== chromeBinding.python?.executable_sha256) {
    reject('provider_playwright_python_pairing_mismatch');
  }
}

function reject(code) { throw new Error(code); }

async function regular(path, code, executable = false) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') reject(code); throw error; }
  if (!info.isFile()) reject(code);
  if (executable && (info.mode & 0o111) === 0) reject(`${code}_not_executable`);
  return info;
}

async function directory(path, code) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') reject(code); throw error; }
  if (!info.isDirectory()) reject(code);
}

function string(value, code) { if (typeof value !== 'string' || !value.trim()) reject(code); return value; }
function hash(value, code) { if (!HASH.test(value ?? '')) reject(code); return value; }
function exact(value, expected, code) { if (value !== expected) reject(code); return value; }
function aliasValue(input, names, code) {
  const values = names.map(name => input[name]).filter(value => value !== undefined);
  if (values.length > 1 && values.some(value => value !== values[0])) reject(`${code}_conflict`);
  return values[0];
}

function storedRecord(value, keys, code) {
  if (!record(value)) reject(`${code}_invalid`);
  if (Object.keys(value).some(key => !keys.includes(key))) reject(`${code}_unknown_field`);
  for (const key of keys) if (!Object.hasOwn(value, key)) reject(`${code}_${key}_missing`);
  return value;
}

/**
 * Read only the canonical owner-persisted Chrome binding. Setup accepts
 * aliases, but a stored record has one exact shape so old or mixed records
 * cannot silently qualify the shared adapter.
 */
export function readStoredChromeOfficialBinding(binding) {
  if (!record(binding)) reject('chrome_stored_binding_invalid');
  if (binding.schema !== CHROME_OFFICIAL_INSTALL_SCHEMA) reject('chrome_stored_binding_version_unsupported');
  storedRecord(binding, CHROME_STORED_KEYS, 'chrome_stored_binding');
  exact(binding.provider, CHROME_OFFICIAL_PINS.provider, 'chrome_stored_provider_invalid');
  exact(binding.source, CHROME_OFFICIAL_PINS.source, 'chrome_stored_source_invalid');
  exact(binding.signature_status, CHROME_OFFICIAL_PINS.signature_status, 'chrome_stored_signature_status_invalid');
  exact(binding.browser_version, CHROME_OFFICIAL_PINS.browser_version, 'chrome_stored_browser_version_invalid');
  exact(binding.playwright_version, CHROME_OFFICIAL_PINS.playwright_version, 'chrome_stored_playwright_version_invalid');

  const browser = storedRecord(binding.browser, CHROME_STORED_BROWSER_KEYS, 'chrome_stored_browser');
  string(browser.install_root, 'chrome_stored_browser_install_root_invalid');
  string(browser.executable, 'chrome_stored_browser_executable_invalid');
  exact(browser.version, binding.browser_version, 'chrome_stored_browser_version_conflict');
  exact(browser.executable_sha256, CHROME_OFFICIAL_PINS.executable_sha256, 'chrome_stored_executable_hash_invalid');

  const python = storedRecord(binding.python, CHROME_STORED_PYTHON_KEYS, 'chrome_stored_python');
  string(python.path, 'chrome_stored_python_path_invalid');
  hash(python.executable_sha256, 'chrome_stored_python_hash_invalid');

  const sources = storedRecord(binding.sources, CHROME_STORED_SOURCES_KEYS, 'chrome_stored_sources');
  const browserSource = storedRecord(sources.browser, CHROME_STORED_SOURCE_KEYS, 'chrome_stored_browser_source');
  string(browserSource.path, 'chrome_stored_browser_source_path_invalid');
  exact(browserSource.sha256, CHROME_OFFICIAL_PINS.source_sha256, 'chrome_stored_browser_source_hash_invalid');
  const sourceHashes = storedRecord(binding.source_sha256, CHROME_STORED_SOURCE_HASH_KEYS, 'chrome_stored_source_hashes');
  exact(sourceHashes.browser, browserSource.sha256, 'chrome_stored_source_hash_conflict');
  exact(sourceHashes.browser, CHROME_OFFICIAL_PINS.source_sha256, 'chrome_stored_source_hash_invalid');
  return binding;
}

const defaultFileHash = (_path, bytes) => sha(bytes);

async function canonicalFile(path, code, executable = false, hashFile = defaultFileHash) {
  string(path, code);
  let canonical;
  try { canonical = await realpath(path); } catch (error) { if (error.code === 'ENOENT') reject(code); throw error; }
  await regular(canonical, code, executable);
  const bytes = await readFile(canonical);
  return { path: resolve(path), canonical, sha256: hashFile(canonical, bytes) };
}

function inside(root, path, code) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${requireSeparator()}`)) reject(code);
}

function requireSeparator() { return process.platform === 'win32' ? '\\' : '/'; }

async function browserVersion(appRoot) {
  const applicationIni = join(appRoot, 'Contents/Resources/application.ini');
  const text = (await readFile(applicationIni).catch(error => { if (error.code === 'ENOENT') reject('camoufox_browser_version_missing'); throw error; })).toString('utf8');
  const version = text.split(/\r?\n/).find(line => line.trim().startsWith('Version='))?.trim().slice('Version='.length);
  return version;
}

async function browserPropertiesHash(appRoot, canonicalRoot) {
  const properties = await canonicalFile(join(appRoot, 'Contents/Resources/properties.json'), 'camoufox_properties_invalid');
  inside(canonicalRoot, properties.canonical, 'camoufox_properties_outside_root');
  exact(properties.sha256, CAMOUFOX_UPSTREAM_PINS.properties_sha256, 'camoufox_properties_hash_mismatch');
  return properties.sha256;
}

async function sourceArchive(path, expected, code, hashFile = defaultFileHash) {
  const file = await canonicalFile(path, code, false, hashFile);
  exact(file.sha256, expected, `${code}_hash_mismatch`);
  return { path: file.path, sha256: file.sha256 };
}

async function pythonPackageVersions(path) {
  try {
    const { stdout } = await execFile(path, ['-I', '-B', '-c', 'import importlib.metadata as m, json; print(json.dumps({"camoufox": m.version("camoufox"), "playwright": m.version("playwright")}))'], {
      timeout: 5000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }
    });
    const versions = JSON.parse(stdout.trim());
    if (versions.camoufox !== CAMOUFOX_UPSTREAM_PINS.camoufox_version || versions.playwright !== CAMOUFOX_UPSTREAM_PINS.playwright_version) reject('camoufox_python_package_version_mismatch');
  } catch (error) {
    if (error.message === 'camoufox_python_package_version_mismatch') throw error;
    reject('camoufox_python_packages_unavailable');
  }
}

async function pythonPlaywrightVersion(path, command = execFile) {
  try {
    const { stdout } = await command(path, ['-I', '-B', '-c', 'import importlib.metadata as m; print(m.version("playwright"))'], {
      timeout: 5000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }
    });
    exact(stdout.trim(), CHROME_OFFICIAL_PINS.playwright_version, 'chrome_playwright_version_mismatch');
  } catch (error) {
    if (error.message === 'chrome_playwright_version_mismatch') throw error;
    reject('chrome_playwright_package_unavailable');
  }
}

async function chromeBundleVersion(appRoot, command = execFile) {
  try {
    const { stdout } = await command('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(appRoot, 'Contents/Info.plist')], { timeout: 5000 });
    return stdout.trim();
  } catch (error) {
    if (error.code === 'ENOENT') reject('chrome_browser_version_missing');
    reject('chrome_browser_version_unavailable');
  }
}

async function verifyChromeSignature(appRoot, command = execFile, platform = process.platform) {
  if (platform !== 'darwin') reject('chrome_signature_unavailable');
  try {
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', appRoot], { timeout: 10000 });
  } catch { reject('chrome_signature_invalid'); }
  return CHROME_OFFICIAL_PINS.signature_status;
}

/** Validate an owner-selected, already-installed official Chrome combination. */
export async function verifyChromeOfficialInstall(input, options = {}) {
  if (!record(input)) reject('chrome_official_binding_invalid');
  exact(input.schema, CHROME_OFFICIAL_INSTALL_SCHEMA, 'chrome_install_schema_invalid');
  exact(input.provider, CHROME_OFFICIAL_PINS.provider, 'chrome_provider_invalid');
  exact(input.source, CHROME_OFFICIAL_PINS.source, 'chrome_source_invalid');
  exact(input.browser_version, CHROME_OFFICIAL_PINS.browser_version, 'chrome_browser_version_invalid');
  exact(input.playwright_version, CHROME_OFFICIAL_PINS.playwright_version, 'chrome_playwright_version_invalid');
  if (input.signature_status !== undefined) exact(input.signature_status, CHROME_OFFICIAL_PINS.signature_status, 'chrome_signature_status_invalid');
  if (input.source_sha256 !== undefined) exact(input.source_sha256, CHROME_OFFICIAL_PINS.source_sha256, 'chrome_source_hash_invalid');
  if (input.executable_sha256 !== undefined) exact(input.executable_sha256, CHROME_OFFICIAL_PINS.executable_sha256, 'chrome_executable_hash_invalid');
  if (input.python_executable_sha256 !== undefined) hash(input.python_executable_sha256, 'chrome_python_hash_invalid');

  const browserRoot = string(aliasValue(input, ['browser_install_root', 'browser_root', 'app_root'], 'chrome_browser_root'), 'chrome_browser_root_required');
  const browserExecutable = string(aliasValue(input, ['browser_executable', 'executable'], 'chrome_browser_executable'), 'chrome_browser_executable_required');
  const pythonPath = string(aliasValue(input, ['python_path', 'chrome_python_path', 'python'], 'chrome_python_path'), 'chrome_python_path_required');
  const browserSourcePath = string(aliasValue(input, ['browser_source_path', 'browser_source', 'browser_archive', 'source_archive_path'], 'chrome_browser_source'), 'chrome_browser_source_required');
  await directory(browserRoot, 'chrome_browser_root_invalid');
  const canonicalRoot = await realpath(browserRoot);
  await directory(canonicalRoot, 'chrome_browser_root_invalid');
  if (!canonicalRoot.endsWith('.app')) reject('chrome_browser_root_invalid');

  const fileHash = options.hashFile ?? defaultFileHash;
  const browser = await canonicalFile(browserExecutable, 'chrome_browser_executable_invalid', true, fileHash);
  inside(canonicalRoot, browser.canonical, 'chrome_browser_executable_outside_root');
  exact(browser.sha256, CHROME_OFFICIAL_PINS.executable_sha256, 'chrome_executable_hash_mismatch');
  const command = options.execFile ?? execFile;
  exact(await chromeBundleVersion(canonicalRoot, command), CHROME_OFFICIAL_PINS.browser_version, 'chrome_browser_version_mismatch');
  const signature_status = await verifyChromeSignature(canonicalRoot, command, options.platform ?? process.platform);
  const python = await canonicalFile(pythonPath, 'chrome_python_invalid', true, fileHash);
  if (input.python_executable_sha256 !== undefined && input.python_executable_sha256 !== python.sha256) reject('chrome_python_hash_mismatch');
  await pythonPlaywrightVersion(python.path, command);
  const source = await sourceArchive(browserSourcePath, CHROME_OFFICIAL_PINS.source_sha256, 'chrome_browser_source', fileHash);

  return {
    schema: CHROME_OFFICIAL_INSTALL_SCHEMA,
    provider: CHROME_OFFICIAL_PINS.provider,
    source: CHROME_OFFICIAL_PINS.source,
    signature_status,
    browser_version: CHROME_OFFICIAL_PINS.browser_version,
    playwright_version: CHROME_OFFICIAL_PINS.playwright_version,
    browser: {
      install_root: resolve(browserRoot),
      executable: resolve(browserExecutable),
      version: CHROME_OFFICIAL_PINS.browser_version,
      executable_sha256: browser.sha256
    },
    python: { path: resolve(pythonPath), executable_sha256: python.sha256 },
    sources: { browser: source },
    source_sha256: { browser: source.sha256 }
  };
}

/** Validate an owner-selected, already-installed official upstream combination. */
export async function verifyCamoufoxUpstreamInstall(input) {
  if (!record(input)) reject('camoufox_upstream_binding_invalid');
  for (const key of RETIRED_BINDING_KEYS) if (Object.hasOwn(input, key)) reject('camoufox_artifact_binding_retired');
  const browserRoot = string(input.browser_install_root ?? input.browser_root, 'camoufox_browser_root_required');
  const browserExecutable = string(input.browser_executable, 'camoufox_browser_executable_required');
  const pythonPath = string(input.python_path ?? input.python, 'camoufox_python_path_required');
  const browserSourcePath = string(input.browser_source_path ?? input.browser_source, 'camoufox_browser_source_path_required');
  const camoufoxSourcePath = string(input.camoufox_source_path ?? input.camoufox_source, 'camoufox_source_path_required');
  const playwrightSourcePath = string(input.playwright_source_path ?? input.playwright_source, 'playwright_source_path_required');
  exact(input.provider ?? 'camoufox', CAMOUFOX_UPSTREAM_PINS.provider, 'camoufox_provider_invalid');
  exact(input.browser_version, CAMOUFOX_UPSTREAM_PINS.browser_version, 'camoufox_browser_version_invalid');
  exact(input.camoufox_version, CAMOUFOX_UPSTREAM_PINS.camoufox_version, 'camoufox_version_invalid');
  exact(input.playwright_version, CAMOUFOX_UPSTREAM_PINS.playwright_version, 'playwright_version_invalid');

  await directory(browserRoot, 'camoufox_browser_root_invalid');
  const canonicalRoot = await realpath(browserRoot);
  await directory(canonicalRoot, 'camoufox_browser_root_invalid');
  const browser = await canonicalFile(browserExecutable, 'camoufox_browser_executable_invalid', true);
  inside(canonicalRoot, browser.canonical, 'camoufox_browser_executable_outside_root');
  exact(await browserVersion(canonicalRoot), CAMOUFOX_UPSTREAM_PINS.browser_version, 'camoufox_browser_version_mismatch');
  await browserPropertiesHash(canonicalRoot, canonicalRoot);
  const python = await canonicalFile(pythonPath, 'camoufox_python_invalid', true);
  await pythonPackageVersions(python.path);
  const sources = {
    browser: await sourceArchive(browserSourcePath, CAMOUFOX_UPSTREAM_PINS.browser_source_sha256, 'camoufox_browser_source'),
    camoufox: await sourceArchive(camoufoxSourcePath, CAMOUFOX_UPSTREAM_PINS.camoufox_source_sha256, 'camoufox_source'),
    playwright: await sourceArchive(playwrightSourcePath, CAMOUFOX_UPSTREAM_PINS.playwright_source_sha256, 'playwright_source')
  };
  hash(input.browser_executable_sha256 ?? browser.sha256, 'camoufox_browser_hash_invalid');
  if (input.browser_executable_sha256 && input.browser_executable_sha256 !== browser.sha256) reject('camoufox_browser_hash_mismatch');
  hash(input.python_executable_sha256 ?? python.sha256, 'camoufox_python_hash_invalid');
  if (input.python_executable_sha256 && input.python_executable_sha256 !== python.sha256) reject('camoufox_python_hash_mismatch');

  return {
    schema: CAMOUFOX_UPSTREAM_INSTALL_SCHEMA,
    provider: CAMOUFOX_UPSTREAM_PINS.provider,
    source: 'official_release',
    camoufox_version: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
    browser_version: CAMOUFOX_UPSTREAM_PINS.browser_version,
    playwright_version: CAMOUFOX_UPSTREAM_PINS.playwright_version,
    properties_sha256: CAMOUFOX_UPSTREAM_PINS.properties_sha256,
    browser: { install_root: resolve(browserRoot), executable: resolve(browserExecutable), version: CAMOUFOX_UPSTREAM_PINS.browser_version, executable_sha256: browser.sha256 },
    python: { path: resolve(pythonPath), executable_sha256: python.sha256 },
    packages: {
      camoufox: { version: CAMOUFOX_UPSTREAM_PINS.camoufox_version, source_sha256: CAMOUFOX_UPSTREAM_PINS.camoufox_source_sha256 },
      playwright: { version: CAMOUFOX_UPSTREAM_PINS.playwright_version, source_sha256: CAMOUFOX_UPSTREAM_PINS.playwright_source_sha256 }
    },
    sources,
    source_sha256: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.sha256]))
  };
}

export async function verifyInstalledCamoufox(installation) {
  if (!record(installation)) reject('installation_configuration_invalid');
  if (RETIRED_BINDING_KEYS.some(key => Object.hasOwn(installation, key))) return null;
  return record(installation.camoufoxUpstream) ? verifyCamoufoxUpstreamInstall({
    ...installation.camoufoxUpstream,
    browser_install_root: installation.camoufoxUpstream.browser?.install_root ?? installation.camoufoxUpstream.browser_install_root,
    browser_executable: installation.camoufoxUpstream.browser?.executable ?? installation.camoufoxUpstream.browser_executable,
    browser_version: installation.camoufoxUpstream.browser?.version ?? installation.camoufoxUpstream.browser_version,
    python_path: installation.camoufoxUpstream.python?.path ?? installation.camoufoxUpstream.python_path,
    browser_source_path: installation.camoufoxUpstream.sources?.browser?.path,
    camoufox_source_path: installation.camoufoxUpstream.sources?.camoufox?.path,
    playwright_source_path: installation.camoufoxUpstream.sources?.playwright?.path,
    camoufox_version: installation.camoufoxUpstream.packages?.camoufox?.version ?? installation.camoufoxUpstream.camoufox_version,
    playwright_version: installation.camoufoxUpstream.packages?.playwright?.version ?? installation.camoufoxUpstream.playwright_version,
    browser_source_sha256: installation.camoufoxUpstream.source_sha256?.browser ?? installation.camoufoxUpstream.browser_source_sha256,
    camoufox_source_sha256: installation.camoufoxUpstream.source_sha256?.camoufox ?? installation.camoufoxUpstream.camoufox_source_sha256,
    playwright_source_sha256: installation.camoufoxUpstream.source_sha256?.playwright ?? installation.camoufoxUpstream.playwright_source_sha256,
    browser_executable_sha256: installation.camoufoxUpstream.browser?.executable_sha256,
    python_executable_sha256: installation.camoufoxUpstream.python?.executable_sha256
  }) : null;
}

export async function verifyInstalledChromeOfficial(installation, options = {}) {
  if (!record(installation)) reject('installation_configuration_invalid');
  const binding = installation.chromeOfficial;
  if (binding === undefined) return null;
  const stored = readStoredChromeOfficialBinding(binding);
  return verifyChromeOfficialInstall({
    schema: stored.schema,
    provider: stored.provider,
    source: stored.source,
    signature_status: stored.signature_status,
    browser_version: stored.browser_version,
    playwright_version: stored.playwright_version,
    browser_install_root: stored.browser.install_root,
    browser_executable: stored.browser.executable,
    python_path: stored.python.path,
    python_executable_sha256: stored.python.executable_sha256,
    browser_source_path: stored.sources.browser.path,
    source_sha256: stored.source_sha256.browser,
    executable_sha256: stored.browser.executable_sha256
  }, options);
}

/** Resolve setup's optional binding without making ordinary installs provider-specific. */
export async function resolveCamoufoxSetupBinding({ existingInstallation, hasUpstreamArguments, upstreamInput }) {
  if (hasUpstreamArguments) return verifyCamoufoxUpstreamInstall(upstreamInput);
  return record(existingInstallation?.camoufoxUpstream) ? verifyInstalledCamoufox(existingInstallation) : null;
}

export async function resolveChromeOfficialSetupBinding({ existingInstallation, hasOfficialArguments, officialInput }) {
  if (hasOfficialArguments) return verifyChromeOfficialInstall(officialInput);
  return record(existingInstallation?.chromeOfficial) ? verifyInstalledChromeOfficial(existingInstallation) : null;
}

export const CAMOUFOX_RETIRED_STATE = RETIRED_STATE;
export const CAMOUFOX_RETIRED_BINDING_REASON = RETIRED_BINDING_REASON;
export const CAMOUFOX_UNQUALIFIED_REASON = UNQUALIFIED_REASON;
export const CAMOUFOX_QUALIFIED_STATE = QUALIFIED_STATE;
export const CHROME_OFFICIAL_QUALIFIED_STATE = QUALIFIED_STATE;
