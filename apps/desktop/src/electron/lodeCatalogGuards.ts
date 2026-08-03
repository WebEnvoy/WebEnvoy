export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 ? value : undefined;
}

export function requiredString(value: unknown, label: string) {
  const result = optionalString(value);
  if (!result) throw new Error(`Missing ${label}.`);
  return result;
}

export function requiredRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function strictStringArray(value: unknown, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => optionalString(item) == null)) return null;
  const strings = value as string[];
  return new Set(strings).size === strings.length ? strings : null;
}

export function requiredStringArray(value: unknown, label: string, maxItems = 100) {
  const result = strictStringArray(value, maxItems);
  if (result == null) throw new Error(`Invalid ${label}.`);
  return result;
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function hasOnlyAllowedKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function manifestAssetPath(manifest: Record<string, unknown>, role: string, packageRef: string) {
  const assets = Array.isArray(manifest.asset_refs) ? manifest.asset_refs : [];
  const matches = assets.filter((value) => isRecord(value) && value.role === role && value.status === "present");
  if (matches.length !== 1 || !isRecord(matches[0])) throw new Error(`Missing ${role} asset for ${packageRef}.`);
  return requiredString(matches[0].path, `${packageRef} ${role} path`);
}
