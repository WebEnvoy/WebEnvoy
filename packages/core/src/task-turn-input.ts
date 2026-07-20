export const taskTurnInputSchemaVersion = "webenvoy.task-turn-input.v0";
export const taskTurnInputConsumerBoundary = "Core stores bounded field summaries and owner refs only; raw content remains with its owner.";

export type TaskTurnFieldKind = "scalar" | "url" | "long_text" | "file" | "attachment";

export type TaskTurnInputField = {
  field_id: string;
  kind: TaskTurnFieldKind;
  summary?: string;
  owner_ref?: string;
};

export type TaskTurnInputSnapshot = {
  schema_version: typeof taskTurnInputSchemaVersion;
  fields: TaskTurnInputField[];
  attachment_refs?: string[];
  consumer_boundary: string;
};

export class TaskThreadStoreError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const inlineSummaryLimit = 512;
const privateFieldNames = new Set([
  "cookie", "cookies", "token", "tokens", "password", "profile", "profile_path",
  "storage", "storage_value", "dom", "har", "video", "raw_payload", "network_body",
  "secret", "credential", "authorization", "auth", "api_key", "access_key",
  "verification_code", "otp", "one_time_password", "passcode", "session_token"
]);
const privateFieldIdFragments = [
  "cookie", "token", "password", "secret", "credential", "authorization",
  "apikey", "accesskey", "profilepath", "storagevalue", "rawpayload", "networkbody",
  "verificationcode", "onetimepassword", "passcode", "sessiontoken"
];
const privateFieldIdSegments = new Set(["auth", "otp"]);
const ownerRefPattern = /^(attachment|draft|owner):[A-Za-z0-9][A-Za-z0-9._~:/%-]{0,2047}$/;

function isPrivateFieldId(fieldId: string): boolean {
  const segments = fieldId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const normalized = fieldId.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return privateFieldNames.has(fieldId.toLowerCase()) ||
    segments.some((segment) => privateFieldIdSegments.has(segment)) ||
    privateFieldIdFragments.some((name) => normalized.includes(name));
}

function requireOwnerRef(value: unknown, label: string): string {
  const ref = requireText(value, label, 2048);
  if (!ownerRefPattern.test(ref)) throw new TaskThreadStoreError(`${label}_invalid`);
  return ref;
}

function requirePublicUrlSummary(value: unknown): string {
  const summary = requireText(value, "field_summary");
  let url: URL;
  try {
    url = new URL(summary);
  } catch {
    throw new TaskThreadStoreError("field_url_invalid");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TaskThreadStoreError("field_url_invalid");
  }
  const sensitiveKey = [...url.searchParams.keys()].find((key) => isPrivateFieldId(key));
  if (sensitiveKey || (url.hash && isPrivateFieldId(url.hash))) {
    throw new TaskThreadStoreError("field_url_sensitive_value_rejected");
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

export function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new TaskThreadStoreError(`${label}_invalid`);
  }
  return value;
}

export function requireText(value: unknown, label: string, maximum = inlineSummaryLimit): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TaskThreadStoreError(`${label}_invalid`);
  }
  return value;
}

function findPrivateField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPrivateField(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (privateFieldNames.has(key.toLowerCase())) return key;
    const found = findPrivateField(child);
    if (found) return found;
  }
  return undefined;
}

function requireObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskThreadStoreError(code);
  return value as Record<string, unknown>;
}

function rejectUnknownProperties(value: Record<string, unknown>, allowed: ReadonlySet<string>, code: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TaskThreadStoreError(`${code}:${unknown}`);
}

export function validateTaskTurnInputSnapshot(value: unknown): TaskTurnInputSnapshot {
  return normalizeTaskTurnInputSnapshot(value, false);
}

export function validatePersistedTaskTurnInputSnapshot(value: unknown): TaskTurnInputSnapshot {
  return normalizeTaskTurnInputSnapshot(value, true);
}

function normalizeTaskTurnInputSnapshot(value: unknown, persisted: boolean): TaskTurnInputSnapshot {
  const input = requireObject(value, "input_snapshot_invalid");
  const privateField = findPrivateField(input);
  if (privateField) throw new TaskThreadStoreError(`private_field_rejected:${privateField}`);
  rejectUnknownProperties(input, new Set(["schema_version", "fields", "attachment_refs", ...(persisted ? ["consumer_boundary"] : [])]), "input_snapshot_property_unsupported");
  if (input.schema_version !== taskTurnInputSchemaVersion || !Array.isArray(input.fields)) {
    throw new TaskThreadStoreError("input_snapshot_invalid");
  }
  if (persisted && input.consumer_boundary !== taskTurnInputConsumerBoundary) throw new TaskThreadStoreError("consumer_boundary_invalid");
  const fieldIds = new Set<string>();
  const fields = input.fields.map((value) => {
    const field = requireObject(value, "input_field_invalid");
    rejectUnknownProperties(field, new Set(["field_id", "kind", "summary", "owner_ref"]), "field_property_unsupported");
    const fieldId = requireIdentifier(field.field_id, "field_id");
    if (isPrivateFieldId(fieldId)) throw new TaskThreadStoreError(`private_field_rejected:${fieldId}`);
    if (fieldIds.has(fieldId)) throw new TaskThreadStoreError("field_id_duplicate");
    fieldIds.add(fieldId);
    if (typeof field.kind !== "string" || !["scalar", "url", "long_text", "file", "attachment"].includes(field.kind)) {
      throw new TaskThreadStoreError("field_kind_invalid");
    }
    const usesOwnerRef = field.kind === "long_text" || field.kind === "file" || field.kind === "attachment";
    if (usesOwnerRef && field.owner_ref === undefined) throw new TaskThreadStoreError("field_owner_ref_required");
    if (!usesOwnerRef && field.summary === undefined) throw new TaskThreadStoreError("field_summary_required");
    const summary = field.summary === undefined
      ? undefined
      : field.kind === "url"
        ? requirePublicUrlSummary(field.summary)
        : requireText(field.summary, "field_summary");
    const ownerRef = field.owner_ref === undefined ? undefined : requireOwnerRef(field.owner_ref, "field_owner_ref");
    return {
      field_id: fieldId,
      kind: field.kind as TaskTurnFieldKind,
      ...(summary === undefined ? {} : { summary }),
      ...(ownerRef === undefined ? {} : { owner_ref: ownerRef })
    };
  });
  if (input.attachment_refs !== undefined && !Array.isArray(input.attachment_refs)) {
    throw new TaskThreadStoreError("attachment_refs_invalid");
  }
  const attachmentRefs = input.attachment_refs?.map((ref) => requireOwnerRef(ref, "attachment_ref"));
  return {
    schema_version: taskTurnInputSchemaVersion,
    fields,
    ...(attachmentRefs === undefined ? {} : { attachment_refs: attachmentRefs }),
    consumer_boundary: taskTurnInputConsumerBoundary
  };
}
