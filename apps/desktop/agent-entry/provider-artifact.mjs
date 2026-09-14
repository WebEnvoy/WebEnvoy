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

export const PLAYWRIGHT_SHARED_RUNTIME_SCHEMA = 'webenvoy.playwright-shared-runtime/v1';
export const PLAYWRIGHT_SHARED_RUNTIME_VERSION = '1.60.0';

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

async function canonicalFile(path, code, executable = false) {
  string(path, code);
  let canonical;
  try { canonical = await realpath(path); } catch (error) { if (error.code === 'ENOENT') reject(code); throw error; }
  await regular(canonical, code, executable);
  return { path: resolve(path), canonical, sha256: sha(await readFile(canonical)) };
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

async function sourceArchive(path, expected, code) {
  const file = await canonicalFile(path, code);
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

async function pythonPlaywrightVersion(path) {
  try {
    const { stdout } = await execFile(path, ['-I', '-B', '-c', 'import importlib.metadata as m; print(m.version("playwright"))'], {
      timeout: 5000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }
    });
    exact(stdout.trim(), PLAYWRIGHT_SHARED_RUNTIME_VERSION, 'playwright_runtime_version_mismatch');
  } catch (error) {
    if (error.message === 'playwright_runtime_version_mismatch') throw error;
    reject('playwright_runtime_unavailable');
  }
}

/** Validate the neutral Python/Playwright runtime shared by public adapters. */
export async function verifyPlaywrightRuntimeBinding(input) {
  if (!record(input)) reject('playwright_runtime_binding_invalid');
  const allowed = ['schema', 'provider', 'playwright_version', 'python_path', 'python_executable_sha256', 'python'];
  if (Object.keys(input).some(key => !allowed.includes(key))) reject('playwright_runtime_binding_invalid');
  if (input.python !== undefined && !record(input.python)) reject('playwright_runtime_binding_invalid');
  if (record(input.python) && Object.keys(input.python).some(key => !['path', 'executable_sha256'].includes(key))) reject('playwright_runtime_binding_invalid');
  exact(input.schema, PLAYWRIGHT_SHARED_RUNTIME_SCHEMA, 'playwright_runtime_schema_invalid');
  exact(input.provider, 'playwright_shared', 'playwright_runtime_provider_invalid');
  exact(input.playwright_version, PLAYWRIGHT_SHARED_RUNTIME_VERSION, 'playwright_runtime_version_invalid');
  if (input.python_path !== undefined && input.python?.path !== undefined && input.python_path !== input.python.path) reject('playwright_runtime_python_path_mismatch');
  if (input.python_executable_sha256 !== undefined && input.python?.executable_sha256 !== undefined && input.python_executable_sha256 !== input.python.executable_sha256) reject('playwright_runtime_python_hash_mismatch');
  const pythonPath = string(input.python_path ?? input.python?.path, 'playwright_runtime_python_path_required');
  const python = await canonicalFile(pythonPath, 'playwright_runtime_python_invalid', true);
  const declaredHash = string(input.python_executable_sha256 ?? input.python?.executable_sha256, 'playwright_runtime_python_hash_required');
  hash(declaredHash, 'playwright_runtime_python_hash_invalid');
  exact(declaredHash, python.sha256, 'playwright_runtime_python_hash_mismatch');
  await pythonPlaywrightVersion(python.path);
  return {
    schema: PLAYWRIGHT_SHARED_RUNTIME_SCHEMA,
    provider: 'playwright_shared',
    playwright_version: PLAYWRIGHT_SHARED_RUNTIME_VERSION,
    python: { path: resolve(pythonPath), executable_sha256: python.sha256 }
  };
}

export async function verifyInstalledPlaywrightRuntime(installation) {
  if (!record(installation)) reject('installation_configuration_invalid');
  if (!Object.hasOwn(installation, 'playwrightRuntime')) return null;
  return verifyPlaywrightRuntimeBinding(installation.playwrightRuntime);
}

export async function resolvePlaywrightRuntimeSetupBinding({ existingInstallation, hasRuntimeArguments, runtimeInput }) {
  if (hasRuntimeArguments) return verifyPlaywrightRuntimeBinding(runtimeInput);
  return existingInstallation ? verifyInstalledPlaywrightRuntime(existingInstallation) : null;
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

/** Resolve setup's optional binding without making ordinary installs provider-specific. */
export async function resolveCamoufoxSetupBinding({ existingInstallation, hasUpstreamArguments, upstreamInput }) {
  if (hasUpstreamArguments) return verifyCamoufoxUpstreamInstall(upstreamInput);
  return record(existingInstallation?.camoufoxUpstream) ? verifyInstalledCamoufox(existingInstallation) : null;
}

export const CAMOUFOX_RETIRED_STATE = RETIRED_STATE;
export const CAMOUFOX_RETIRED_BINDING_REASON = RETIRED_BINDING_REASON;
export const CAMOUFOX_UNQUALIFIED_REASON = UNQUALIFIED_REASON;
export const CAMOUFOX_QUALIFIED_STATE = QUALIFIED_STATE;
