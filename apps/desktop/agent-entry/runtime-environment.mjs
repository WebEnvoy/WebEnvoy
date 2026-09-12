import { join } from 'node:path';

const PRIVATE_PREFIXES = /^(WEBENVOY_|HARBOR_|CAMOUFOX_)/;

/**
 * Build the environment owned by an installed Runtime service.
 *
 * Development launch overrides are deliberately removed before the fixed
 * service values are added. Historical Camoufox paths are never accepted;
 * Harbor receives only a bounded retirement classification.
 */
export function installedRuntimeEnvironment({ parentEnvironment = process.env, dataDir, installRoot, camoufoxLaunch = { state: 'retired', reason: 'unqualified' } }) {
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
  return environment;
}
