import assert from "node:assert/strict";
import { isHarborOwnerViewerRequest, ownerSupervisorAuthorizationHeader, parseOwnerApiRequest, projectViewerInputErrorBody } from "./ownerApiRequest.js";
import { runtimeSupervisorChildEnvironment } from "./runtimeSupervisor.js";

const credential = "isolated_supervisor_test_credential_00000000";
const stale = { WEBENVOY_CORE_SUPERVISOR_TOKEN: "stale-core", HARBOR_RUNTIME_SUPERVISOR_TOKEN: "stale-harbor", HARBOR_OWNER_VIEWER_SUPERVISOR_TOKEN: "stale-viewer" };
const core = runtimeSupervisorChildEnvironment("core", "packaged-path", {}, credential, stale);
const harbor = runtimeSupervisorChildEnvironment("harbor", "packaged-path", {}, credential, stale, "owner-viewer");
assert.equal(core.WEBENVOY_CORE_SUPERVISOR_TOKEN, credential);
assert.equal(harbor.WEBENVOY_CORE_SUPERVISOR_TOKEN, undefined);
assert.equal(core.HARBOR_RUNTIME_SUPERVISOR_TOKEN, credential);
assert.equal(core.HARBOR_OWNER_VIEWER_SUPERVISOR_TOKEN, undefined);
assert.equal(harbor.HARBOR_OWNER_VIEWER_SUPERVISOR_TOKEN, "owner-viewer");
assert.equal(runtimeSupervisorChildEnvironment("core", "packaged-path", stale, undefined, stale).WEBENVOY_CORE_SUPERVISOR_TOKEN, undefined);
for (const path of ["/agent-access", "/agent-access/principals", "/runs/run-one/result", "/threads"]) {
  const parsed = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path });
  assert(parsed.ok);
  assert.equal(ownerSupervisorAuthorizationHeader(parsed, credential, undefined), `Bearer ${credential}`);
  assert.equal(ownerSupervisorAuthorizationHeader(parsed, undefined, undefined), undefined);
  assert.equal(ownerSupervisorAuthorizationHeader(parsed, undefined, credential), undefined);
}
const harborRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8788", path: "/runtime/sessions/session-one/lock", method: "POST" });
assert(harborRequest.ok);
assert.equal(ownerSupervisorAuthorizationHeader(harborRequest, undefined, credential), `Bearer ${credential}`);
const viewerRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8788", path: "/runtime/sessions/session-one/viewer-input", method: "POST" });
assert(viewerRequest.ok);
assert.equal(isHarborOwnerViewerRequest(viewerRequest), true);
assert.deepEqual(projectViewerInputErrorBody(viewerRequest.path, { status: "unknown_outcome", dispatch_state: "dispatched", failure_class: "viewer_input_driver_unavailable", secret: "discarded" }), { status: "unknown_outcome", dispatch_state: "dispatched", failure_class: "viewer_input_driver_unavailable" });
const profilePolicyRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/profile-policies", method: "POST" });
assert(profilePolicyRequest.ok);
assert.equal(profilePolicyRequest.method, "POST");
const adjacentSensitivePath = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/profile-policies/profile", method: "POST" });
assert.equal(adjacentSensitivePath.ok, false);
console.log("Validated isolated Core supervisor headers and existing Harbor protection.");
