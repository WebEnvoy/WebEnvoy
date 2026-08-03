import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const SUPERVISOR_TOKEN_BYTES = 32;
const SUPERVISOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const authorizationGrants = new WeakMap<object, string>();

export interface ManualAuthenticationAuthorizationGrant {
  readonly kind: "manual_authentication_supervisor_grant";
}

export type ManualAuthenticationAuthorization =
  | { authorized: true; grant?: ManualAuthenticationAuthorizationGrant }
  | {
    authorized: false;
    status_code: 403 | 503;
    failure_class: "manual_auth_authorization_required" | "manual_auth_authorization_unavailable";
  };

export class ManualAuthenticationAuthorizer {
  private readonly supervisorToken: Buffer | null;

  constructor(configuredToken: string | undefined) {
    this.supervisorToken = decodeSupervisorToken(configuredToken);
  }

  authorize(request: IncomingMessage): ManualAuthenticationAuthorization {
    if (!this.supervisorToken) {
      return {
        authorized: false,
        status_code: 503,
        failure_class: "manual_auth_authorization_unavailable"
      };
    }

    const candidate = bearerToken(request);
    if (!candidate || !timingSafeEqual(this.supervisorToken, candidate)) {
      return {
        authorized: false,
        status_code: 403,
        failure_class: "manual_auth_authorization_required"
      };
    }
    return { authorized: true };
  }

  authorizeManualAuthentication(request: IncomingMessage, runtimeSessionRef: string): ManualAuthenticationAuthorization {
    const authorization = this.authorize(request);
    if (!authorization.authorized) return authorization;
    const grant: ManualAuthenticationAuthorizationGrant = { kind: "manual_authentication_supervisor_grant" };
    authorizationGrants.set(grant, runtimeSessionRef);
    return { authorized: true, grant };
  }
}

export function consumeManualAuthenticationAuthorizationGrant(value: unknown, runtimeSessionRef: string): value is ManualAuthenticationAuthorizationGrant {
  if (typeof value !== "object" || value === null || authorizationGrants.get(value) !== runtimeSessionRef) return false;
  authorizationGrants.delete(value);
  return true;
}

function bearerToken(request: IncomingMessage): Buffer | null {
  const authorizationHeaders: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "authorization") authorizationHeaders.push(request.rawHeaders[index + 1]);
  }
  if (authorizationHeaders.length !== 1) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorizationHeaders[0]);
  return match ? decodeSupervisorToken(match[1]) : null;
}

function decodeSupervisorToken(value: string | undefined): Buffer | null {
  if (!value || !SUPERVISOR_TOKEN_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === SUPERVISOR_TOKEN_BYTES && decoded.toString("base64url") === value ? decoded : null;
}
