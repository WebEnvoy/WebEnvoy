export type LodeCatalogSkill = WebEnvoyLodeCatalogSkill;

export type LodeCatalogLoadState = {
  status: "loading" | "ready" | "stale" | "offline";
  fetchedAt: string;
  source: WebEnvoyLodeAssetBundleState["source"];
  summary: string;
  skills: LodeCatalogSkill[];
};

const cacheKey = "webenvoy.lodeCatalog.displayCache.v2";

export const loadingLodeCatalogState: LodeCatalogLoadState = {
  status: "loading",
  fetchedAt: "pending",
  source: "not_configured",
  summary: "正在读取已安装的站点技能。",
  skills: [],
};

export async function fetchLodeCatalog(signal?: AbortSignal): Promise<LodeCatalogLoadState> {
  const readCatalog = window.webenvoyShell?.getLodeCatalog;
  if (readCatalog == null) return cachedOrOffline("站点技能目录接口暂不可用。");

  try {
    signal?.throwIfAborted();
    const state = await readCatalog();
    signal?.throwIfAborted();
    if (!isCatalogState(state)) return cachedOrOffline("站点技能目录返回了不兼容的数据。");
    if (state.status !== "ready") return cachedOrOffline(state.summary);

    const readyState: LodeCatalogLoadState = {
      status: "ready",
      fetchedAt: state.fetchedAt,
      source: state.source,
      summary: state.summary,
      skills: state.skills,
    };
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(projectLodeCatalogDisplayCache(readyState)));
    } catch {
      // A display cache failure must not hide the live owner response.
    }
    return readyState;
  } catch (error) {
    return cachedOrOffline(error instanceof Error ? error.message : String(error));
  }
}

export function catalogSkillSiteId(skill: LodeCatalogSkill) {
  return skill.siteSlug;
}

export function catalogSkillSiteName(skill: LodeCatalogSkill) {
  return skill.siteName;
}

export function catalogSkillName(skill: LodeCatalogSkill) {
  return skill.name;
}

function cachedOrOffline(summary: string): LodeCatalogLoadState {
  const cached = readCache();
  return cached == null
    ? { status: "offline", fetchedAt: new Date().toISOString(), source: "not_configured", summary, skills: [] }
    : {
        ...cached,
        status: "stale",
        summary: `${summary} 当前展示最近一次非敏感目录缓存。`,
      };
}

export function projectLodeCatalogDisplayCache(state: LodeCatalogLoadState): LodeCatalogLoadState {
  return {
    status: state.status,
    fetchedAt: state.fetchedAt,
    source: state.source,
    summary: state.summary,
    skills: state.skills.map((skill) => ({
      id: skill.id,
      packageRef: skill.packageRef,
      ...(skill.lockRef === undefined ? {} : { lockRef: skill.lockRef }),
      siteSlug: skill.siteSlug,
      siteName: skill.siteName,
      name: skill.name,
      summary: skill.summary,
      category: skill.category,
      version: skill.version,
      latestVersion: skill.latestVersion,
      lifecycle: skill.lifecycle,
      facets: [...skill.facets],
      sourceHealth: skill.sourceHealth,
      updatedAt: skill.updatedAt,
      availability: skill.availability,
      availabilityReason: skill.availabilityReason,
      inputSchemaId: skill.inputSchemaId,
      inputFields: skill.inputFields.map(({ id, label, kind, required, description, inputProjection, options, defaultValue, minimum, maximum, minLength, maxLength, minItems, maxItems, uniqueItems, format, integer }) => ({
        id,
        label,
        kind,
        required,
        description,
        inputProjection,
        ...(options === undefined ? {} : { options: [...options] }),
        ...(defaultValue === undefined ? {} : { defaultValue }),
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
        ...(minLength === undefined ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength }),
        ...(minItems === undefined ? {} : { minItems }),
        ...(maxItems === undefined ? {} : { maxItems }),
        ...(uniqueItems === undefined ? {} : { uniqueItems }),
        ...(format === undefined ? {} : { format }),
        ...(integer === undefined ? {} : { integer }),
      })),
      outputSchemaId: skill.outputSchemaId,
      outputKind: skill.outputKind,
      resultView: skill.resultView.mode === "standard"
        ? { mode: "standard", fallback: "standard_renderer", reason: skill.resultView.reason }
        : {
            mode: "skill",
            fallback: "standard_renderer",
            declarationVersion: skill.resultView.declarationVersion,
            viewId: skill.resultView.viewId,
            viewVersion: skill.resultView.viewVersion,
            resourceRef: skill.resultView.resourceRef,
            lockRef: skill.resultView.lockRef,
          },
      actions: skill.actions.map(({ id, category, operationMode, targetTypes, supportedOrigins, externalEffects, resourceRequirementRef, resourceRequirementProfileIds }) => ({
        id,
        category,
        operationMode,
        targetTypes: [...targetTypes],
        supportedOrigins: [...supportedOrigins],
        externalEffects: [...externalEffects],
        resourceRequirementRef,
        resourceRequirementProfileIds: [...resourceRequirementProfileIds],
      })),
    })),
  };
}

function readCache(): LodeCatalogLoadState | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey) ?? "null") as unknown;
    if (!isLoadState(parsed) || parsed.status !== "ready") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isCatalogState(value: unknown): value is WebEnvoyLodeCatalogState {
  return isRecord(value) && hasOnlyKeys(value, ["status", "fetchedAt", "source", "summary", "skills"]) &&
    (value.status === "ready" || value.status === "unavailable") &&
    isString(value.fetchedAt) &&
    isCatalogSource(value.source) &&
    isString(value.summary) &&
    Array.isArray(value.skills) &&
    value.skills.every(isSkill);
}

function isLoadState(value: unknown): value is LodeCatalogLoadState {
  return isRecord(value) && hasOnlyKeys(value, ["status", "fetchedAt", "source", "summary", "skills"]) &&
    ["loading", "ready", "stale", "offline"].includes(String(value.status)) &&
    isString(value.fetchedAt) &&
    isCatalogSource(value.source) &&
    isString(value.summary) &&
    Array.isArray(value.skills) &&
    value.skills.every(isSkill);
}

function isSkill(value: unknown): value is LodeCatalogSkill {
  if (!isRecord(value)) return false;
  const requiredKeys = [
    "id", "packageRef", "siteSlug", "siteName", "name", "summary", "category", "version", "latestVersion",
    "lifecycle", "facets", "sourceHealth", "updatedAt", "availability", "availabilityReason", "inputSchemaId",
    "inputFields", "outputSchemaId", "outputKind", "resultView", "actions",
  ];
  if (!Object.keys(value).every((key) => key === "lockRef" || requiredKeys.includes(key)) ||
    !requiredKeys.every((key) => Object.hasOwn(value, key))) return false;
  const stringsValid = [
    "id",
    "packageRef",
    "siteSlug",
    "siteName",
    "name",
    "summary",
    "category",
    "version",
    "latestVersion",
    "lifecycle",
    "sourceHealth",
    "updatedAt",
    "availabilityReason",
    "outputKind",
  ].every((key) => isString(value[key]));
  const availabilityValid = value.availability === "available" || value.availability === "incompatible";
  const schemaIdsValid = value.availability === "available"
    ? isString(value.inputSchemaId) && isString(value.outputSchemaId)
    : isText(value.inputSchemaId) && isText(value.outputSchemaId);
  return stringsValid && availabilityValid && schemaIdsValid &&
    (value.lockRef === undefined || isString(value.lockRef)) &&
    isStringArray(value.facets) &&
    Array.isArray(value.inputFields) &&
    value.inputFields.every(isField) &&
    isResultView(value.resultView) &&
    Array.isArray(value.actions) &&
    value.actions.every(isAction);
}

function isResultView(value: unknown): value is WebEnvoyLodeCatalogResultView {
  if (!isRecord(value) || value.fallback !== "standard_renderer") return false;
  if (value.mode === "standard") return hasOnlyKeys(value, ["mode", "fallback", "reason"]) &&
    (value.reason === "not_declared" || value.reason === "incompatible");
  return value.mode === "skill" && hasOnlyKeys(value, [
    "mode", "fallback", "declarationVersion", "viewId", "viewVersion", "resourceRef", "lockRef",
  ]) &&
    value.declarationVersion === "0.1.0" &&
    isString(value.viewId) &&
    isString(value.viewVersion) &&
    isString(value.resourceRef) &&
    isString(value.lockRef);
}

function isCatalogSource(value: unknown): value is WebEnvoyLodeAssetBundleState["source"] {
  return ["env-path", "packaged-path", "build-output", "not_configured"].includes(String(value));
}

function isField(value: unknown): value is WebEnvoyLodeCatalogField {
  return isRecord(value) && Object.keys(value).every((key) => [
    "id", "label", "kind", "required", "description", "options", "defaultValue", "minimum", "maximum",
    "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "pattern", "patternSafety", "format", "integer",
    "inputProjection",
  ].includes(key)) &&
    isString(value.id) &&
    isString(value.label) &&
    ["text", "multiline", "number", "boolean", "select", "multi-select", "file", "constant", "unknown"].includes(String(value.kind)) &&
    typeof value.required === "boolean" &&
    isString(value.description) &&
    ["safe_summary", "sanitized_url", "owner_ref"].includes(String(value.inputProjection)) &&
    (value.options === undefined || isStringArray(value.options)) &&
    (value.defaultValue === undefined || ["string", "number", "boolean"].includes(typeof value.defaultValue) || isStringArray(value.defaultValue)) &&
    (value.minimum === undefined || typeof value.minimum === "number") &&
    (value.maximum === undefined || typeof value.maximum === "number") &&
    (value.minLength === undefined || Number.isInteger(value.minLength) && Number(value.minLength) >= 0) &&
    (value.maxLength === undefined || Number.isInteger(value.maxLength) && Number(value.maxLength) >= 0) &&
    (value.minItems === undefined || Number.isInteger(value.minItems) && Number(value.minItems) >= 0) &&
    (value.maxItems === undefined || Number.isInteger(value.maxItems) && Number(value.maxItems) >= 0) &&
    (value.uniqueItems === undefined || typeof value.uniqueItems === "boolean") &&
    (value.pattern === undefined && value.patternSafety === undefined || isString(value.pattern) && value.patternSafety === "linear") &&
    (value.format === undefined || value.format === "uri") &&
    (value.integer === undefined || value.integer === true) &&
    validFieldConstraints(value);
}

function validFieldConstraints(value: Record<string, unknown>) {
  if (typeof value.minimum === "number" && typeof value.maximum === "number" && value.minimum > value.maximum) return false;
  if (typeof value.minLength === "number" && typeof value.maxLength === "number" && value.minLength > value.maxLength) return false;
  if (typeof value.minItems === "number" && typeof value.maxItems === "number" && value.minItems > value.maxItems) return false;
  if (value.pattern !== undefined && value.patternSafety !== "linear") return false;
  if (value.kind === "multi-select") {
    if (!isStringArray(value.options) || value.options.length === 0) return false;
  } else if (value.minItems !== undefined || value.maxItems !== undefined || value.uniqueItems !== undefined) return false;
  if (value.kind !== "number" && (value.minimum !== undefined || value.maximum !== undefined || value.integer !== undefined)) return false;
  if (!["text", "multiline", "select"].includes(String(value.kind)) &&
    (value.minLength !== undefined || value.maxLength !== undefined || value.pattern !== undefined || value.format !== undefined)) return false;
  if (value.kind === "select" && (!isStringArray(value.options) || value.options.length === 0 ||
    value.options.some((option) => !validCachedString(value, option)))) return false;
  return validFieldDefault(value);
}

function validFieldDefault(field: Record<string, unknown>) {
  const value = field.defaultValue;
  if (value === undefined) return true;
  if (field.kind === "multi-select") {
    if (!isStringArray(value) || !(value as string[]).every((item) => (field.options as string[]).includes(item))) return false;
    return (field.minItems == null || value.length >= Number(field.minItems)) &&
      (field.maxItems == null || value.length <= Number(field.maxItems));
  }
  if (field.kind === "select") return typeof value === "string" && (field.options as string[] | undefined)?.includes(value) === true;
  if (field.kind === "boolean") return typeof value === "boolean";
  if (field.kind === "number") return typeof value === "number" && Number.isFinite(value) &&
    (field.integer !== true || Number.isInteger(value)) &&
    (field.minimum == null || value >= Number(field.minimum)) && (field.maximum == null || value <= Number(field.maximum));
  return typeof value === "string" ? validCachedString(field, value) : field.kind === "constant";
}

function validCachedString(field: Record<string, unknown>, value: string) {
  if (field.minLength != null && value.length < Number(field.minLength) || field.maxLength != null && value.length > Number(field.maxLength)) return false;
  if (field.pattern != null && !new RegExp(String(field.pattern)).test(value)) return false;
  if (field.format === "uri") {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    } catch { return false; }
  }
  return true;
}

function isAction(value: unknown): value is WebEnvoyLodeCatalogAction {
  return isRecord(value) && hasOnlyKeys(value, [
    "id", "category", "operationMode", "targetTypes", "supportedOrigins", "externalEffects",
    "resourceRequirementRef", "resourceRequirementProfileIds",
  ]) &&
    isString(value.id) &&
    ["read", "prepare", "commit", "destructive"].includes(String(value.category)) &&
    ["read", "validate_only", "draft", "preview"].includes(String(value.operationMode)) &&
    isStringArray(value.targetTypes) &&
    isStringArray(value.supportedOrigins) &&
    isStringArray(value.externalEffects) &&
    isString(value.resourceRequirementRef) &&
    isStringArray(value.resourceRequirementProfileIds) && value.resourceRequirementProfileIds.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 1000) &&
    new Set(value).size === value.length;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
