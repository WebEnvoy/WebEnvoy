export type ProjectedOwnerApiError = {
  code?: string;
  category?: string;
  retryable?: boolean;
};

export function projectOwnerApiError(value: unknown): ProjectedOwnerApiError | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.error) ? value.error : value;
  const code = safeErrorToken(source.code);
  const category = safeErrorToken(source.category);
  const retryable = typeof source.retryable === "boolean" ? source.retryable : undefined;
  if (code == null && category == null && retryable == null) return undefined;
  return {
    ...(code == null ? {} : { code }),
    ...(category == null ? {} : { category }),
    ...(retryable == null ? {} : { retryable }),
  };
}

function safeErrorToken(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-z0-9_.-]+$/i.test(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
