import assert from "node:assert/strict";
import test from "node:test";
import {
  ManualAuthenticationAuthorizer,
  consumeManualAuthenticationAuthorizationGrant
} from "./manual-authentication-authorization.js";

const supervisorToken = Buffer.alloc(32, 7).toString("base64url");

test("scopes supervisor grants to one session and consumes them once", () => {
  const authorizer = new ManualAuthenticationAuthorizer(supervisorToken);
  const request = { rawHeaders: ["Authorization", `Bearer ${supervisorToken}`] } as never;
  const authorization = authorizer.authorizeManualAuthentication(request, "session_authorized");
  assert.equal(authorization.authorized, true);
  if (!authorization.authorized || !authorization.grant) throw new Error("Expected a supervisor grant.");

  assert.equal(consumeManualAuthenticationAuthorizationGrant({ kind: "manual_authentication_supervisor_grant" }, "session_authorized"), false);
  assert.equal(consumeManualAuthenticationAuthorizationGrant(authorization.grant, "session_other"), false);
  assert.equal(consumeManualAuthenticationAuthorizationGrant(authorization.grant, "session_authorized"), true);
  assert.equal(consumeManualAuthenticationAuthorizationGrant(authorization.grant, "session_authorized"), false);
});
