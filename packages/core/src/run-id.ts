export const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidRunId(value: unknown): value is string {
  return typeof value === "string" && runIdPattern.test(value);
}

export function requireRunId(value: unknown): string {
  if (!isValidRunId(value)) {
    throw new Error("run_id must use 1-128 characters from A-Z, a-z, 0-9, dot, underscore, or hyphen");
  }
  return value;
}
