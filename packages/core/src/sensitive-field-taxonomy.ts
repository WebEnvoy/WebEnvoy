const sensitiveFieldNames = new Set([
  "cookie", "cookies", "token", "tokens", "password", "profile", "profile_path", "profile_storage", "profile_state",
  "storage", "storage_value", "dom", "har", "video", "screenshot", "raw_payload", "raw_body", "raw_evidence_body",
  "network_body", "network_response_body", "cdp_endpoint", "viewer_url", "websocketdebuggerurl",
  "secret", "credential", "authorization", "auth", "api_key", "access_key",
  "verification_code", "otp", "one_time_password", "passcode", "session_token"
]);

const sensitiveFieldFragments = [
  "cookie", "token", "password", "secret", "credential", "authorization",
  "apikey", "accesskey", "profilepath", "storagevalue", "rawpayload", "networkbody",
  "verificationcode", "onetimepassword", "passcode", "sessiontoken", "profilestorage", "profilestate",
  "rawevidencebody", "networkresponsebody", "cdpendpoint", "viewerurl", "websocketdebuggerurl"
];

const sensitiveFieldSegments = new Set(["auth", "otp"]);

export const persistentReferenceMaxLength = 512;
export const persistentVersionMaxLength = 128;

export function isSensitiveFieldName(value: string): boolean {
  const lower = value.toLowerCase();
  const segments = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const normalized = lower.replaceAll(/[^a-z0-9]/g, "");
  return sensitiveFieldNames.has(lower) ||
    segments.some((segment) => sensitiveFieldSegments.has(segment)) ||
    sensitiveFieldFragments.some((name) => normalized.includes(name));
}

export function normalizeNonSensitiveText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) || isSensitiveFieldName(value)) return undefined;
  return value;
}
