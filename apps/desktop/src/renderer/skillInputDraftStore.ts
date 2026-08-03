import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { createSkillInputDraft, type SkillInputAttachment, type SkillInputDraft, type SkillInputValue } from "./skillInputDraft";
import { credentialBearingValue } from "../electron/credentialBearingValue";

export type RestoredDraft = {
  draft: SkillInputDraft;
  generation: number;
  restored: boolean;
  omittedFieldIds: string[];
  persistence: "ready" | "unavailable";
};

type DraftContext = { packageRef: string; version: string; identityId: string };
type ProtectedDraft = {
  context: DraftContext;
  values: Record<string, SkillInputValue>;
  attachments: Record<string, StoredAttachment[]>;
  omittedFieldIds: string[];
};
type StoredAttachment = Omit<SkillInputAttachment, "state" | "file">;

type MemoryDraft = { draft: SkillInputDraft; omittedFieldIds: string[] };

const memoryDrafts = new Map<string, MemoryDraft>();
const memoryDraftPersistence = new Map<string, RestoredDraft["persistence"]>();
const memoryDraftGeneration = new Map<string, number>();
const contextGeneration = new Map<string, number>();
const persistenceQueues = new Map<string, Promise<void>>();
const localFileRefPattern = /^local_file_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadSkillInputDraft(skill: LodeCatalogSkill, identityId: string | undefined): Promise<RestoredDraft> {
  const context = draftContext(skill, identityId);
  const key = draftKey(context);
  await (persistenceQueues.get(key) ?? Promise.resolve()).catch(() => undefined);
  const generation = contextGeneration.get(key) ?? 0;
  const memory = memoryDrafts.get(key);
  if (memory != null) return {
    draft: cloneDraft(memory.draft),
    generation,
    restored: true,
    omittedFieldIds: [...memory.omittedFieldIds],
    persistence: memoryDraftPersistence.get(key) ?? "unavailable",
  };
  const load = window.webenvoyShell?.loadProtectedDraft;
  if (load == null) return { draft: createSkillInputDraft(skill), generation, restored: false, omittedFieldIds: [], persistence: "unavailable" };
  try {
    const result = await load(context);
    if (!isCurrentSkillInputDraftGeneration(skill, identityId, generation)) {
      return loadSkillInputDraft(skill, identityId);
    }
    const currentMemory = memoryDrafts.get(key);
    if (currentMemory != null) return {
      draft: cloneDraft(currentMemory.draft),
      generation,
      restored: true,
      omittedFieldIds: [...currentMemory.omittedFieldIds],
      persistence: memoryDraftPersistence.get(key) ?? "unavailable",
    };
    if (result.status !== "ready") return { draft: createSkillInputDraft(skill), generation, restored: false, omittedFieldIds: [], persistence: "unavailable" };
    const restored = restoreDraft(result.draft, skill, context);
    if (restored == null) return { draft: createSkillInputDraft(skill), generation, restored: false, omittedFieldIds: [], persistence: "ready" };
    memoryDrafts.set(key, { draft: cloneDraft(restored.draft), omittedFieldIds: [...restored.omittedFieldIds] });
    memoryDraftPersistence.set(key, "ready");
    return { ...restored, generation, restored: true, persistence: "ready" };
  } catch {
    return { draft: createSkillInputDraft(skill), generation, restored: false, omittedFieldIds: [], persistence: "unavailable" };
  }
}

export function isCurrentSkillInputDraftGeneration(
  skill: LodeCatalogSkill,
  identityId: string | undefined,
  generation: number,
) {
  return (contextGeneration.get(draftKey(draftContext(skill, identityId))) ?? 0) === generation;
}

export async function saveSkillInputDraft(skill: LodeCatalogSkill, identityId: string | undefined, draft: SkillInputDraft) {
  const saveGeneration = cacheSkillInputDraft(skill, identityId, draft);
  return saveGeneration == null ? "unavailable" as const : persistSkillInputDraft(skill, identityId, draft, saveGeneration);
}

export function cacheSkillInputDraft(
  skill: LodeCatalogSkill,
  identityId: string | undefined,
  draft: SkillInputDraft,
  expectedContextGeneration?: number,
) {
  const context = draftContext(skill, identityId);
  const key = draftKey(context);
  if (expectedContextGeneration != null && expectedContextGeneration !== (contextGeneration.get(key) ?? 0)) return null;
  const protectedDraft = projectProtectedDraft(skill, context, draft);
  memoryDrafts.set(key, { draft: cloneDraft(draft), omittedFieldIds: [...protectedDraft.omittedFieldIds] });
  memoryDraftPersistence.set(key, "unavailable");
  const generation = (memoryDraftGeneration.get(key) ?? 0) + 1;
  memoryDraftGeneration.set(key, generation);
  return generation;
}

export async function persistSkillInputDraft(
  skill: LodeCatalogSkill,
  identityId: string | undefined,
  draft: SkillInputDraft,
  generation: number,
) {
  const context = draftContext(skill, identityId);
  const key = draftKey(context);
  return enqueuePersistence(key, async () => {
    const save = window.webenvoyShell?.saveProtectedDraft;
    if (save == null) return "unavailable" as const;
    try {
      const result = await save(projectProtectedDraft(skill, context, draft));
      const persistence = result.status === "ready" ? "ready" as const : "unavailable" as const;
      if (memoryDraftGeneration.get(key) === generation) memoryDraftPersistence.set(key, persistence);
      return persistence;
    } catch {
      return "unavailable" as const;
    }
  });
}

export async function clearSkillInputDraft(skill: LodeCatalogSkill, identityId: string | undefined) {
  const context = draftContext(skill, identityId);
  const key = draftKey(context);
  const generation = (contextGeneration.get(key) ?? 0) + 1;
  contextGeneration.set(key, generation);
  memoryDrafts.delete(key);
  memoryDraftPersistence.delete(key);
  memoryDraftGeneration.delete(key);
  const persistence = await enqueuePersistence(key, async () => {
    const remove = window.webenvoyShell?.deleteProtectedDraft;
    if (remove == null) return "unavailable" as const;
    try {
      return (await remove(context)).status === "ready" ? "ready" as const : "unavailable" as const;
    } catch {
      return "unavailable" as const;
    }
  });
  return { generation, persistence };
}

function enqueuePersistence<T>(key: string, operation: () => Promise<T>) {
  const result = (persistenceQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  const settled = result.then(() => undefined, () => undefined);
  persistenceQueues.set(key, settled);
  void settled.finally(() => { if (persistenceQueues.get(key) === settled) persistenceQueues.delete(key); });
  return result;
}

export function projectProtectedSkillInput(skill: LodeCatalogSkill, identityId: string | undefined, draft: SkillInputDraft): ProtectedDraft {
  return projectProtectedDraft(skill, draftContext(skill, identityId), draft);
}

function projectProtectedDraft(skill: LodeCatalogSkill, context: DraftContext, draft: SkillInputDraft): ProtectedDraft {
  return {
    context,
    values: Object.fromEntries(skill.inputFields.flatMap((field) =>
      persistableValueField(field) && draft.values[field.id] !== undefined && !credentialBearingValue(draft.values[field.id])
        ? [[field.id, cloneValue(draft.values[field.id]!)]] : [],
    )),
    attachments: Object.fromEntries(skill.inputFields.flatMap((field) =>
      field.kind === "file" && !sensitiveField(field) ? [[field.id, (draft.files[field.id] ?? []).map(storedAttachment)]] : [],
    )),
    omittedFieldIds: skill.inputFields.flatMap((field) =>
      ((!persistableValueField(field) || credentialBearingValue(draft.values[field.id])) && hasMeaningfulValue(draft.values[field.id]) ||
        field.kind === "file" && sensitiveField(field) && (draft.files[field.id]?.length ?? 0) > 0) ? [field.id] : [],
    ),
  };
}

function restoreDraft(value: unknown, skill: LodeCatalogSkill, context: DraftContext) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["context", "values", "attachments", "omittedFieldIds"]) ||
    !sameContext(value.context, context) || !isRecord(value.values) || !isRecord(value.attachments) || !isStringArray(value.omittedFieldIds)) return null;
  const draft = createSkillInputDraft(skill);
  for (const [id, storedValue] of Object.entries(value.values)) {
    const field = skill.inputFields.find((item) => item.id === id);
    if (field == null || !persistableValueField(field) || credentialBearingValue(storedValue) || !validStoredValue(field, storedValue)) return null;
    draft.values[id] = cloneValue(storedValue as SkillInputValue);
  }
  for (const [id, attachments] of Object.entries(value.attachments)) {
    const field = skill.inputFields.find((item) => item.id === id);
    if (field?.kind !== "file" || sensitiveField(field) || !validStoredAttachments(attachments)) return null;
    draft.files[id] = attachments.map((attachment) => ({ ...attachment, state: "reselect" }));
  }
  return { draft, omittedFieldIds: value.omittedFieldIds };
}

function validStoredValue(field: WebEnvoyLodeCatalogField, value: unknown) {
  if (field.kind === "boolean") return typeof value === "boolean";
  if (field.kind === "multi-select") return Array.isArray(value) && value.length <= 100 && value.every((item) => field.options?.includes(item));
  if (field.kind === "select") return typeof value === "string" && field.options?.includes(value) === true;
  if (field.kind === "constant") return sameValue(value, field.defaultValue);
  return typeof value === "string" && value.length <= 64 * 1024;
}

function validStoredAttachments(value: unknown): value is StoredAttachment[] {
  return Array.isArray(value) && value.length <= 32 && value.every((item) => isRecord(item) &&
    Object.keys(item).every((key) => ["id", "name", "size", "type", "lastModified", "localRef"].includes(key)) &&
    boundedText(item.id, 8192) && boundedText(item.name, 255) && boundedText(item.type, 255, true) &&
    validNumber(item.size) && validNumber(item.lastModified) &&
    (item.localRef === undefined || typeof item.localRef === "string" && localFileRefPattern.test(item.localRef)));
}

function persistableValueField(field: WebEnvoyLodeCatalogField) {
  return field.kind !== "file" && field.kind !== "unknown" && !sensitiveField(field);
}

function sensitiveField(field: WebEnvoyLodeCatalogField) {
  const normalized = `${field.id} ${field.label} ${field.description}`.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return [
    "password", "cookie", "token", "secret", "credential", "authorization", "profilestorage",
    "rawevidence", "evidence", "har", "trace", "networkbody", "securityid", "accesskey", "apikey",
  ].some((term) => normalized.includes(term));
}

function storedAttachment(attachment: SkillInputAttachment): StoredAttachment {
  const { id, name, size, type, lastModified, localRef } = attachment;
  return { id, name, size, type, lastModified, ...(localRef == null ? {} : { localRef }) };
}

function draftContext(skill: LodeCatalogSkill, identityId: string | undefined): DraftContext {
  return { packageRef: skill.packageRef, version: skill.version, identityId: identityId ?? "" };
}

function draftKey(context: DraftContext) {
  return `${context.packageRef}\u0000${context.version}\u0000${context.identityId}`;
}

function cloneDraft(draft: SkillInputDraft): SkillInputDraft {
  return {
    values: Object.fromEntries(Object.entries(draft.values).map(([id, value]) => [id, cloneValue(value)])),
    files: Object.fromEntries(Object.entries(draft.files).map(([id, files]) => [id, files.map((file) => ({ ...file }))])),
  };
}

function cloneValue(value: SkillInputValue): SkillInputValue {
  return Array.isArray(value) ? [...value] : value;
}

function sameContext(value: unknown, expected: DraftContext) {
  return isRecord(value) && hasOnlyKeys(value, ["packageRef", "version", "identityId"]) &&
    value.packageRef === expected.packageRef && value.version === expected.version && value.identityId === expected.identityId;
}

function sameValue(value: unknown, expected: unknown) {
  return Array.isArray(value) && Array.isArray(expected)
    ? value.length === expected.length && value.every((item, index) => item === expected[index])
    : value === (typeof expected === "number" ? String(expected) : expected);
}

function hasMeaningfulValue(value: SkillInputValue | undefined) {
  return typeof value === "string" ? value.length > 0 : Array.isArray(value) ? value.length > 0 : value === true;
}

function boundedText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
}

function validNumber(value: unknown) {
  return Number.isFinite(value) && Number(value) >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) => boundedText(item, 128));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
