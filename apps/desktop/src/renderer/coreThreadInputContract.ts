type JsonRecord = Record<string, unknown>;

export type CoreThreadInputField = {
  field_id: string;
  kind: "scalar" | "url" | "long_text" | "file" | "attachment";
  summary?: string;
  owner_ref?: string;
};

export type CoreThreadInputSnapshot = {
  schema_version: "webenvoy.task-turn-input.v0";
  fields: CoreThreadInputField[];
  attachment_refs: string[];
  consumer_boundary: string;
};

const inputSnapshotKeys = new Set(["schema_version", "fields", "attachment_refs", "consumer_boundary"]);
const inputFieldKeys = new Set(["field_id", "kind", "summary", "owner_ref"]);
const privateFieldNames = new Set([
  "cookie", "cookies", "token", "tokens", "password", "profile", "profile_path",
  "storage", "storage_value", "dom", "har", "video", "raw_payload", "network_body",
  "secret", "credential", "authorization", "auth", "api_key", "access_key",
  "verification_code", "otp", "one_time_password", "passcode", "session_token",
]);
const privateFieldIdFragments = [
  "cookie", "token", "password", "secret", "credential", "authorization",
  "apikey", "accesskey", "profilepath", "storagevalue", "rawpayload", "networkbody",
  "verificationcode", "onetimepassword", "passcode", "sessiontoken",
];

export function parseCoreThreadInputSnapshot(value: unknown): CoreThreadInputSnapshot | null {
  const snapshot = asRecord(value);
  if (
    !snapshot ||
    !hasOnlyKeys(snapshot, inputSnapshotKeys) ||
    findPrivateField(snapshot) != null ||
    snapshot.schema_version !== "webenvoy.task-turn-input.v0" ||
    !Array.isArray(snapshot.fields) ||
    snapshot.fields.length > 64 ||
    (snapshot.attachment_refs !== undefined && !Array.isArray(snapshot.attachment_refs)) ||
    (Array.isArray(snapshot.attachment_refs) && !snapshot.attachment_refs.every(isOwnerRef)) ||
    snapshot.consumer_boundary !== "Core stores bounded field summaries and owner refs only; raw content remains with its owner."
  ) return null;
  const attachmentRefs = (snapshot.attachment_refs as string[] | undefined) ?? [];
  if (attachmentRefs.length > 32 || new Set(attachmentRefs).size !== attachmentRefs.length) return null;
  const fieldIds = new Set<string>();
  const fields = snapshot.fields.map((fieldValue) => {
    const field = asRecord(fieldValue);
    if (
      !field ||
      !hasOnlyKeys(field, inputFieldKeys) ||
      !isFieldId(field.field_id) ||
      isPrivateFieldId(field.field_id) ||
      fieldIds.has(field.field_id) ||
      !isInputKind(field.kind) ||
      !isValidInputField(field)
    ) return null;
    fieldIds.add(field.field_id);
    return field as CoreThreadInputField;
  });
  return fields.every((field): field is CoreThreadInputField => field != null)
    ? { ...snapshot, fields, attachment_refs: attachmentRefs } as CoreThreadInputSnapshot
    : null;
}

function isValidInputField(field: JsonRecord) {
  const usesOwnerRef = field.kind === "long_text" || field.kind === "file" || field.kind === "attachment";
  if (usesOwnerRef) return field.summary === undefined && isOwnerRef(field.owner_ref);
  if (field.owner_ref !== undefined || !isBoundedSummary(field.summary)) return false;
  return field.kind !== "url" || isPersistedPublicUrlSummary(field.summary);
}

function hasOnlyKeys(value: JsonRecord, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function findPrivateField(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPrivateField(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const [key, child] of Object.entries(record)) {
    if (privateFieldNames.has(key.toLowerCase())) return key;
    const found = findPrivateField(child);
    if (found) return found;
  }
  return undefined;
}

function isPrivateFieldId(fieldId: string) {
  const segments = fieldId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const normalized = fieldId.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return privateFieldNames.has(fieldId.toLowerCase()) ||
    segments.some((segment) => segment === "auth" || segment === "otp") ||
    privateFieldIdFragments.some((name) => normalized.includes(name));
}

function isBoundedSummary(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512;
}

function isPersistedPublicUrlSummary(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isInputKind(value: unknown): value is CoreThreadInputField["kind"] {
  return value === "scalar" || value === "url" || value === "long_text" || value === "file" || value === "attachment";
}

function isFieldId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function isOwnerRef(value: unknown): value is string {
  return typeof value === "string" && /^(attachment|draft|owner):[A-Za-z0-9][A-Za-z0-9._~:/%-]{0,2047}$/.test(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}
