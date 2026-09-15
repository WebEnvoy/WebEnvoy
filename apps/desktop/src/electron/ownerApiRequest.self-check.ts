import assert from "node:assert/strict";
import { ownerSupervisorAuthorizationHeader, parseOwnerApiRequest } from "./ownerApiRequest.js";
import { runtimeSupervisorChildEnvironment } from "./runtimeSupervisor.js";

const credential = "isolated_supervisor_test_credential_00000000";
const stale = { WEBENVOY_CORE_SUPERVISOR_TOKEN: "stale-core", HARBOR_RUNTIME_SUPERVISOR_TOKEN: "stale-harbor" };
const core = runtimeSupervisorChildEnvironment("core", "packaged-path", {}, credential, stale);
const harbor = runtimeSupervisorChildEnvironment("harbor", "packaged-path", {}, credential, stale);
assert.equal(core.WEBENVOY_CORE_SUPERVISOR_TOKEN, credential);
assert.equal(harbor.WEBENVOY_CORE_SUPERVISOR_TOKEN, undefined);
assert.equal(core.HARBOR_RUNTIME_SUPERVISOR_TOKEN, credential);
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
const profilePolicyRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/profile-policies", method: "POST" });
assert(profilePolicyRequest.ok);
assert.equal(profilePolicyRequest.method, "POST");
const v2ProfilePolicyRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/v2/profile-policies", method: "POST" });
assert(v2ProfilePolicyRequest.ok);
assert.equal(v2ProfilePolicyRequest.method, "POST");
const v2GrantRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/v2/grants", method: "POST" });
assert(v2GrantRequest.ok);
assert.equal(v2GrantRequest.method, "POST");
const scopeConfirmationRequest = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/scope-confirmations", method: "POST" });
assert(scopeConfirmationRequest.ok);
assert.equal(scopeConfirmationRequest.method, "POST");
const adjacentSensitivePath = parseOwnerApiRequest({ base: "http://127.0.0.1:8787", path: "/agent-access/profile-policies/profile", method: "POST" });
assert.equal(adjacentSensitivePath.ok, false);
console.log("Validated isolated Core supervisor headers and existing Harbor protection.");
