const sensitiveQueryTerms = [
  "token", "cookie", "secret", "credential", "authorization", "signature",
  "securityid", "accesskey", "apikey",
];

export function credentialBearingValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(credentialBearingValue);
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) || hasSensitiveParameters(url.searchParams) ||
      hasSensitiveParameters(fragmentParameters(url.hash));
  } catch {
    const [beforeHash, fragment = ""] = value.split("#", 2);
    const query = beforeHash!.includes("?") ? beforeHash!.slice(beforeHash!.indexOf("?") + 1) : beforeHash!;
    return hasSensitiveParameters(new URLSearchParams(query)) || hasSensitiveParameters(fragmentParameters(fragment));
  }
}

function fragmentParameters(value: string) {
  const fragment = value.replace(/^#/, "");
  const parameters = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment;
  return new URLSearchParams(parameters);
}

function hasSensitiveParameters(parameters: URLSearchParams) {
  return [...parameters.keys()].some(sensitiveQueryName);
}

function sensitiveQueryName(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return normalized === "sig" || sensitiveQueryTerms.some((term) => normalized.includes(term));
}
