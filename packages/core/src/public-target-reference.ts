import { isSensitiveFieldName } from "./sensitive-field-taxonomy.js";

export type PublicHttpTargetResult =
  | { ok: true; target_ref: string; target_origin: string }
  | { ok: false; reason: "invalid" | "sensitive" };

function decodedFragment(url: URL): string | undefined {
  try {
    return decodeURIComponent(url.hash.slice(1));
  } catch {
    return undefined;
  }
}

export function normalizePublicHttpTarget(value: string): PublicHttpTargetResult {
  if (!value || value.length > 2048 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const hasAuthorityUserInfo = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*@/.test(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || hasAuthorityUserInfo || url.username || url.password) {
    return { ok: false, reason: hasAuthorityUserInfo || url.username || url.password ? "sensitive" : "invalid" };
  }
  for (const [key, queryValue] of url.searchParams) {
    if (isSensitiveFieldName(key) || isSensitiveFieldName(queryValue)) return { ok: false, reason: "sensitive" };
  }
  if (url.hash) {
    const fragment = decodedFragment(url);
    if (fragment === undefined) return { ok: false, reason: "invalid" };
    if (isSensitiveFieldName(fragment)) return { ok: false, reason: "sensitive" };
  }
  return { ok: true, target_ref: url.href, target_origin: url.origin };
}

export function normalizePublicOrigin(value: string): string | undefined {
  const normalized = normalizePublicHttpTarget(value);
  if (!normalized.ok) return undefined;
  const url = new URL(normalized.target_ref);
  return url.pathname === "/" && !url.search && !url.hash && value === url.origin ? url.origin : undefined;
}

export function normalizeStoredTargetRef(value: string): string | undefined {
  if (!value || value.length > 2048 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return undefined;
  if (value.includes("://")) {
    if (!/^https?:/i.test(value)) return undefined;
    const normalized = normalizePublicHttpTarget(value);
    return normalized.ok ? normalized.target_ref : undefined;
  }
  return isSensitiveFieldName(value) ? undefined : value;
}
