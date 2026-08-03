const fixtureToken = /(^|[\s:._/-])(demo|fixture|smoke)([\s:._/-]|$)/i;
const metadataKey =
  /(^|_)(capture_method|environment|id|kind|locator|metadata|mode|provenance|ref|refs|runtime|schema|source|type)($|_)/i;
const metadataContainerKey = /(^|_)(locator|locators|provenance|ref|refs|source|sources)($|_)/i;

type OwnerPayloadInspectionOptions = { maximumDepth?: number };

export function fixtureOrDemoPayloadReason(value: unknown, options: OwnerPayloadInspectionOptions = {}): string | null {
  const maximumDepth = options.maximumDepth ?? 8;
  return fixtureOrDemoReason(value, "$", 0, false, maximumDepth);
}

function fixtureOrDemoReason(
  value: unknown,
  path: string,
  depth: number,
  metadataContext: boolean,
  maximumDepth: number,
): string | null {
  if (depth > maximumDepth) return `${path}=maximum metadata inspection depth exceeded`;
  if (typeof value === "string" && metadataContext && fixtureToken.test(value)) {
    return `${path}=${value}`;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const reason = fixtureOrDemoReason(value[index], `${path}[${index}]`, depth + 1, metadataContext, maximumDepth);
      if (reason) return reason;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  for (const [key, field] of Object.entries(value)) {
    if ((key === "demo" || key === "fixture" || key === "is_demo" || key === "is_fixture") && field === true) {
      return `${path}.${key}=true`;
    }
    const childMetadataContext = metadataContext || metadataKey.test(key) || metadataContainerKey.test(key);
    if (typeof field === "string" && childMetadataContext && fixtureToken.test(field)) {
      return `${path}.${key}=${field}`;
    }
    if (isRecord(field) || Array.isArray(field)) {
      const reason = fixtureOrDemoReason(field, `${path}.${key}`, depth + 1, childMetadataContext, maximumDepth);
      if (reason) return reason;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
