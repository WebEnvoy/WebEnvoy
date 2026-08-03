const localhostHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const runtimeSessionRefPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;
const publicSiteOrigins = {
  boss: "https://www.zhipin.com",
  xiaohongshu: "https://www.xiaohongshu.com",
} as const;
const sensitivePublicReferenceFragment =
  /(token|cookie|secret|password|credential|authorization|bearer)|raw[\s_-]*evidence/i;
const publicReferencePatterns = {
  identity_environment_ref: [
    /^harbor:\/\/identity-environment\/[A-Za-z0-9._/-]{1,240}$/,
    /^identity-env-[A-Za-z0-9._-]{1,499}$/,
  ],
  execution_identity_ref: [
    /^harbor:\/\/execution-identity\/[A-Za-z0-9._/-]{1,240}$/,
    /^identity-env-[A-Za-z0-9._-]{1,489}:execution$/,
  ],
  profile_ref: [
    /^harbor:\/\/profile\/[A-Za-z0-9._/-]{1,240}$/,
    /^profile-[A-Za-z0-9._-]{1,503}$/,
  ],
} as const;

export type ManualAuthenticationCompletionIntent = {
  base: string;
  runtimeSessionRef: string;
};

export type ManualAuthenticationCompletionRequest = ManualAuthenticationCompletionIntent & {
  supervisorToken: string | undefined;
};

export type ManualAuthenticationCompletionResponse =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status?: number; error: string };

export function manualAuthenticationCompletionPath(runtimeSessionRef: string) {
  return `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}/manual-authentication-completed`;
}

export function isManualAuthenticationCompletionPath(value: string) {
  try {
    return decodeURIComponent(value).split("/").includes("manual-authentication-completed");
  } catch {
    return false;
  }
}

export function parseManualAuthenticationCompletionIntent(value: unknown): ManualAuthenticationCompletionIntent | null {
  const record = asRecord(value);
  if (!record || !hasOnlyKeys(record, ["base", "runtimeSessionRef"])) return null;
  if (!isLocalHarborBase(record.base) || !isRuntimeSessionRef(record.runtimeSessionRef)) return null;
  return { base: record.base, runtimeSessionRef: record.runtimeSessionRef };
}

export function isExpectedManualAuthenticationRendererUrl(senderUrl: string, expectedRendererUrl: string) {
  try {
    const sender = new URL(senderUrl);
    const expected = new URL(expectedRendererUrl);
    if (expected.protocol === "file:") {
      return (
        sender.protocol === "file:" &&
        sender.pathname === expected.pathname &&
        !sender.search &&
        !sender.hash
      );
    }
    return (expected.protocol === "http:" || expected.protocol === "https:") && sender.origin === expected.origin;
  } catch {
    return false;
  }
}

export async function requestManualAuthenticationCompletion(
  request: ManualAuthenticationCompletionRequest,
): Promise<ManualAuthenticationCompletionResponse> {
  const intent = parseManualAuthenticationCompletionIntent({
    base: request.base,
    runtimeSessionRef: request.runtimeSessionRef,
  });
  if (!intent || !request.supervisorToken) {
    return { ok: false, error: "Manual authentication completion is unavailable for this Harbor session." };
  }
  const base = new URL(intent.base);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new URL(manualAuthenticationCompletionPath(intent.runtimeSessionRef), base), {
      method: "POST",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${request.supervisorToken}`,
      },
      signal: controller.signal,
    });
    const body = redactPublicManualAuthenticationResponse(await response.text());
    if (!response.ok) {
      return { ok: false, status: response.status, error: "Harbor did not accept the manual authentication confirmation." };
    }
    if (!body) {
      return { ok: false, status: response.status, error: "Harbor returned an invalid public authentication response." };
    }
    return { ok: true, status: response.status, body };
  } catch {
    return { ok: false, error: "Harbor manual authentication completion is unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}

function isLocalHarborBase(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !localhostHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isRuntimeSessionRef(value: unknown): value is string {
  return typeof value === "string" && runtimeSessionRefPattern.test(value);
}

export function redactPublicManualAuthenticationResponse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    const record = asRecord(value);
    const status = asRecord(record?.status);
    const site = asRecord(record?.site);
    const refs = asRecord(record?.refs);
    const siteId = publicSiteId(site?.site_id);
    const identityEnvironmentRef = publicReference(record?.identity_environment_ref, "identity_environment_ref");
    const executionIdentityRef = publicReference(refs?.execution_identity_ref, "execution_identity_ref");
    const profileRef = publicReference(refs?.profile_ref, "profile_ref");
    if (
      !record ||
      record.schema_version !== "harbor-local-identity-environment-store/v0" ||
      !status ||
      !siteId ||
      !identityEnvironmentRef ||
      !executionIdentityRef ||
      !profileRef ||
      status.readiness !== "ready" ||
      status.login_state !== "logged_in" ||
      status.authentication_provenance !== "user_confirmed_managed_session" ||
      status.browser_storage_state !== "present" ||
      status.manual_authentication_state !== "completed" ||
      status.recovery_required !== false
    ) {
      return null;
    }

    return {
      schema_version: "harbor-local-identity-environment-store/v0",
      identity_environment_ref: identityEnvironmentRef,
      site: { site_id: siteId, origin: publicSiteOrigins[siteId] },
      refs: { execution_identity_ref: executionIdentityRef, profile_ref: profileRef },
      status: {
        readiness: "ready",
        login_state: "logged_in",
        authentication_provenance: "user_confirmed_managed_session",
        browser_storage_state: "present",
        manual_authentication_state: "completed",
        recovery_required: false,
      },
    };
  } catch {
    return null;
  }
}

function publicSiteId(value: unknown): keyof typeof publicSiteOrigins | null {
  return value === "boss" || value === "xiaohongshu" ? value : null;
}

function publicReference(value: unknown, kind: keyof typeof publicReferencePatterns) {
  if (
    typeof value !== "string" ||
    /^https?:\/\//i.test(value) ||
    sensitivePublicReferenceFragment.test(value)
  ) {
    return null;
  }
  return publicReferencePatterns[kind].some((pattern) => pattern.test(value)) ? value : null;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: string[]) {
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
