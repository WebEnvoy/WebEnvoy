import {resolve} from 'node:path';

export const ISOLATED_ROOT = '/tmp/webenvoy-native-prototype-504';
export const ORIGINAL_BROWSER_EXECUTABLE = '/Applications/Camoufox.app/Contents/MacOS/camoufox';

const childOf = (path, root) => typeof path === 'string' && resolve(path).startsWith(`${resolve(root)}/`);

export function uiLaunchRejection(target) {
  if (target?.registered !== true) return 'target_not_registered';
  if (target.status !== 'running') return target.status === 'missing' ? 'target_missing' : 'target_not_running';
  const process = target.process;
  if (!process || !Number.isInteger(process.pid) || process.pid < 1 || process.pid !== process.expectedPid ||
      typeof process.startIdentity !== 'string' || process.startIdentity !== process.expectedStartIdentity) {
    return 'process_identity_mismatch';
  }
  if (target.executablePath === ORIGINAL_BROWSER_EXECUTABLE) return 'original_browser_path';
  if (!childOf(target.executablePath, ISOLATED_ROOT)) return 'executable_not_isolated';
  if (!childOf(target.profilePath, ISOLATED_ROOT)) return 'profile_not_isolated';
  if (!childOf(target.manifestPath, ISOLATED_ROOT)) return 'manifest_not_isolated';
  const manifest = target.manifest;
  if (!manifest || manifest.kind !== 'local-only-unadopted-prototype' ||
      manifest.schema !== 'webenvoy-native-snapshot/prototype-1' ||
      manifest.original_signature_not_valid_for_modified_resources !== true ||
      manifest.distribution_or_production_use_authorized !== false ||
      typeof manifest.bundle_identifier !== 'string' ||
      !manifest.bundle_identifier.startsWith('com.webenvoy.prototype.native504.')) {
    return 'manifest_mismatch';
  }
  return 'ui_automation_disabled';
}

// This is deliberately a one-way stop. It does not accept a launcher callback,
// so a rejected target can never dispatch a process from this path.
export function denyUiLaunch(target) {
  throw new Error(`ui_launch_rejected:${uiLaunchRejection(target)}`);
}
