import { join } from 'node:path';

const PRIVATE_PREFIXES = /^(WEBENVOY_|HARBOR_|CAMOUFOX_)/;

/**
 * Build the environment owned by an installed Runtime service.
 *
 * Development launch overrides are deliberately removed before the fixed
 * service values are added. Historical Camoufox paths are never accepted;
 * Harbor receives only the verified upstream binding facts.
 */
export function installedRuntimeEnvironment({ parentEnvironment = process.env, dataDir, installRoot, camoufoxLaunch = { state: 'retired', reason: 'unqualified' }, camoufoxBinding = null }) {
  const environment = { ...parentEnvironment };
  for (const key of Object.keys(environment)) if (PRIVATE_PREFIXES.test(key)) delete environment[key];
  Object.assign(environment, {
    WEBENVOY_RUNTIME_DATA_DIR: dataDir,
    WEBENVOY_SKILL_ASSETS_PATH: join(installRoot, 'agent-entry/skill-assets'),
    HARBOR_PROFILE_STORAGE_ROOT: join(dataDir, 'profiles'),
    WEBENVOY_LODE_ASSETS_PATH: join(installRoot, 'dist-electron/lode'),
    WEBENVOY_CORE_RUNTIME_COMMAND: '', WEBENVOY_CORE_RUNTIME_PATH: '', WEBENVOY_CORE_RUNTIME_CWD: '',
    WEBENVOY_HARBOR_RUNTIME_COMMAND: '', WEBENVOY_HARBOR_RUNTIME_PATH: '', WEBENVOY_HARBOR_RUNTIME_CWD: '',
    WEBENVOY_DISABLE_PACKAGED_RUNTIME: '0', HARBOR_RUNTIME_PROVIDER: '',
    HARBOR_CAMOUFOX_LAUNCH_STATE: camoufoxLaunch.state,
    HARBOR_CAMOUFOX_LAUNCH_REASON: camoufoxLaunch.reason
  });
  if (camoufoxBinding) Object.assign(environment, {
    HARBOR_BROWSER_PROVIDER: 'camoufox',
    HARBOR_BROWSER_PATH: camoufoxBinding.browser.executable,
    HARBOR_CAMOUFOX_PATH: camoufoxBinding.browser.executable,
    HARBOR_CAMOUFOX_SOURCE: camoufoxBinding.source,
    HARBOR_CAMOUFOX_PROPERTIES_SHA256: camoufoxBinding.properties_sha256,
    HARBOR_CAMOUFOX_INSTALL_ROOT: camoufoxBinding.browser.install_root,
    HARBOR_CAMOUFOX_PYTHON: camoufoxBinding.python.path,
    HARBOR_CAMOUFOX_DRIVER: join(installRoot, 'dist-electron/runtime/harbor/dist/packages/runtime-api/src/camoufox-upstream-driver.py'),
    HARBOR_CAMOUFOX_VERSION: camoufoxBinding.camoufox_version,
    HARBOR_CAMOUFOX_BROWSER_VERSION: camoufoxBinding.browser_version,
    HARBOR_CAMOUFOX_PLAYWRIGHT_VERSION: camoufoxBinding.playwright_version,
    HARBOR_CAMOUFOX_BROWSER_SOURCE_SHA256: camoufoxBinding.source_sha256.browser,
    // Harbor's singular source fact identifies the official browser release;
    // package-specific hashes remain separate validation facts.
    HARBOR_CAMOUFOX_SOURCE_SHA256: camoufoxBinding.source_sha256.browser,
    HARBOR_CAMOUFOX_PLAYWRIGHT_SOURCE_SHA256: camoufoxBinding.source_sha256.playwright
  });
  return environment;
}
