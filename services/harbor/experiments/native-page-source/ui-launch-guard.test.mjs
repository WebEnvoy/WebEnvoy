import assert from 'node:assert/strict';
import {denyUiLaunch, ISOLATED_ROOT, ORIGINAL_BROWSER_EXECUTABLE, uiLaunchRejection} from './ui-launch-guard.mjs';

const validTarget = {
  registered: true,
  status: 'running',
  process: {pid: 9201, expectedPid: 9201, startIdentity: '9201:42', expectedStartIdentity: '9201:42'},
  executablePath: `${ISOLATED_ROOT}/f3/WebEnvoy Native Prototype.app/Contents/MacOS/camoufox`,
  profilePath: `${ISOLATED_ROOT}/profiles/p1`,
  manifestPath: `${ISOLATED_ROOT}/f3/prototype-manifest.json`,
  manifest: {
    kind: 'local-only-unadopted-prototype',
    schema: 'webenvoy-native-snapshot/prototype-1',
    original_signature_not_valid_for_modified_resources: true,
    distribution_or_production_use_authorized: false,
    bundle_identifier: 'com.webenvoy.prototype.native504.f3',
  },
};

let dispatches = 0;
const attempt = target => {
  denyUiLaunch(target);
  dispatches += 1;
};
const rejects = (target, reason) => {
  assert.equal(uiLaunchRejection(target), reason);
  assert.throws(() => attempt(target), new RegExp(`ui_launch_rejected:${reason}`));
  assert.equal(dispatches, 0);
};

rejects({...validTarget, registered: false}, 'target_not_registered');
rejects({...validTarget, status: 'missing'}, 'target_missing');
rejects({...validTarget, status: 'exited'}, 'target_not_running');
rejects({...validTarget, process: {...validTarget.process, pid: 9200}}, 'process_identity_mismatch');
rejects({...validTarget, process: {...validTarget.process, startIdentity: '9201:41'}}, 'process_identity_mismatch');
rejects({...validTarget, executablePath: ORIGINAL_BROWSER_EXECUTABLE}, 'original_browser_path');
rejects({...validTarget, profilePath: '/Users/test/Library/Application Support/Camoufox'}, 'profile_not_isolated');
rejects({...validTarget, manifest: {...validTarget.manifest, schema: 'wrong'}}, 'manifest_mismatch');
rejects(validTarget, 'ui_automation_disabled');

console.log('PASS: missing, exited, stale identity, original path, non-test Profile and manifest mismatch are rejected; matching targets remain disabled; launch dispatches=0');
