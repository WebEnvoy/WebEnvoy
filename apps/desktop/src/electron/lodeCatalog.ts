import path from "node:path";

import {
  createLodeCatalogReadBudget,
  LodeReadBudgetExceededError,
  readLodeJsonObject,
  resolveLodeAssetPath,
  type LodeReadBudget,
} from "./lodeAssetAccess.js";
import {
  resolveLodeAssetBundle,
  supportedLodePackageRefs,
  type LodeAssetBundleState,
} from "./lodeAssetBundle.js";
import { projectActions } from "./lodeCatalogActions.js";
import {
  isRecord,
  optionalString,
  requiredRecord,
  requiredString,
  requiredStringArray,
} from "./lodeCatalogGuards.js";
import { projectInputFields, type LodeCatalogField } from "./lodeCatalogInput.js";
import { projectOutputKind } from "./lodeCatalogOutput.js";
import { projectResultView, standardResultView } from "./lodeCatalogResultView.js";

export type { LodeCatalogField } from "./lodeCatalogInput.js";

export type LodeCatalogAction = {
  id: string;
  category: "read" | "prepare" | "commit" | "destructive";
  operationMode: "read" | "validate_only" | "draft" | "preview";
  targetTypes: string[];
  supportedOrigins: string[];
  externalEffects: string[];
  resourceRequirementRef: string;
  resourceRequirementProfileIds: string[];
};

export type LodeCatalogResultView =
  | {
      mode: "standard";
      fallback: "standard_renderer";
      reason: "not_declared" | "incompatible";
    }
  | {
      mode: "skill";
      fallback: "standard_renderer";
      declarationVersion: "0.1.0";
      viewId: string;
      viewVersion: string;
      resourceRef: string;
      lockRef: string;
    };

export type LodeCatalogSkill = {
  id: string;
  packageRef: string;
  lockRef?: string;
  siteSlug: string;
  siteName: string;
  name: string;
  summary: string;
  category: string;
  version: string;
  latestVersion: string;
  lifecycle: string;
  facets: string[];
  sourceHealth: string;
  updatedAt: string;
  availability: "available" | "incompatible";
  availabilityReason: string;
  inputSchemaId: string;
  inputFields: LodeCatalogField[];
  outputSchemaId: string;
  outputKind: string;
  resultView: LodeCatalogResultView;
  actions: LodeCatalogAction[];
};

export type LodeCatalogState = {
  status: "ready" | "unavailable";
  fetchedAt: string;
  source: LodeAssetBundleState["source"];
  summary: string;
  skills: LodeCatalogSkill[];
};

type LocalCatalogQuery = {
  schema_version?: unknown;
  queries?: { results?: unknown[] }[];
};

type LocalPackageRegistry = {
  entries?: unknown[];
};

const maxCatalogSkills = 200;
export function readLodeCatalog(bundle = resolveLodeAssetBundle()): LodeCatalogState {
  const fetchedAt = new Date().toISOString();
  if (bundle.state !== "ready" || !bundle.rootPath || !bundle.registryPath) {
    return {
      status: "unavailable",
      fetchedAt,
      source: bundle.source,
      summary: bundle.summary,
      skills: [],
    };
  }

  try {
    const budget = createLodeCatalogReadBudget();
    const queryPath = resolveLodeAssetPath(bundle.rootPath, "registry/local-query.fixture.json");
    const query = readLodeJsonObject(queryPath, budget) as LocalCatalogQuery;
    const registry = readLodeJsonObject(bundle.registryPath, budget) as LocalPackageRegistry;
    if (query.schema_version !== "lode.local-registry-query-fixture.v0") {
      throw new Error("Unsupported Lode catalog query contract.");
    }
    const entries = new Map<string, Record<string, unknown>>();
    const packageEntries = new Map(
      (Array.isArray(registry.entries) ? registry.entries : []).flatMap((entry) =>
        isRecord(entry) && optionalString(entry.package_ref) != null
          ? [[entry.package_ref as string, entry] as const]
          : [],
      ),
    );
    for (const result of (Array.isArray(query.queries) ? query.queries : []).flatMap((item) =>
      Array.isArray(item.results) ? item.results : [],
    )) {
      if (!isRecord(result)) continue;
      const packageRef = optionalString(result.package_ref);
      if (packageRef) entries.set(packageRef, { ...packageEntries.get(packageRef), ...entries.get(packageRef), ...result });
      if (entries.size > maxCatalogSkills) throw new Error("Lode catalog exceeds the supported skill count.");
    }
    const skills = [...entries.values()]
      .flatMap((entry) => projectCatalogEntry(bundle.rootPath!, entry, budget))
      .sort((left, right) =>
        left.siteName.localeCompare(right.siteName, "zh-CN") ||
        left.name.localeCompare(right.name, "zh-CN"),
      );
    const incompatibleCount = skills.filter((skill) => skill.availability === "incompatible").length;

    return {
      status: skills.length > 0 ? "ready" : "unavailable",
      fetchedAt,
      source: bundle.source,
      summary:
        skills.length === 0
          ? "站点技能目录中没有可用的技能。"
          : `读取 ${skills.length} 个站点技能${incompatibleCount > 0 ? `，${incompatibleCount} 个合同不完整` : ""}。`,
      skills,
    };
  } catch {
    return {
      status: "unavailable",
      fetchedAt,
      source: bundle.source,
      summary: "站点技能目录无法读取。",
      skills: [],
    };
  }
}

function projectCatalogEntry(rootPath: string, entry: Record<string, unknown>, budget: LodeReadBudget): LodeCatalogSkill[] {
  try {
    return [readCatalogSkill(rootPath, entry, budget)];
  } catch (error) {
    if (error instanceof LodeReadBudgetExceededError) throw error;
    const packageRef = optionalString(entry.package_ref);
    const siteSlug = optionalString(entry.site_slug);
    if (!packageRef || !siteSlug) return [];

    const capabilityId = packageRef.match(/\/([^/@]+)@[^/]+$/)?.[1] ?? packageRef;
    return [{
      id: packageRef,
      packageRef,
      lockRef: optionalString(entry.lock_ref),
      siteSlug,
      siteName: siteSlug,
      name: capabilityId,
      summary: "技能合同无法读取。",
      category: "unknown",
      version: optionalString(entry.version) ?? "unknown",
      latestVersion: optionalString(entry.version) ?? "unknown",
      lifecycle: optionalString(entry.lifecycle) ?? "unknown",
      facets: [],
      sourceHealth: "invalid",
      updatedAt: "unknown",
      availability: "incompatible",
      availabilityReason: "技能合同无法读取，已停止使用。",
      inputSchemaId: "",
      inputFields: [],
      outputSchemaId: "",
      outputKind: "unknown",
      resultView: standardResultView("incompatible"),
      actions: [],
    }];
  }
}

type CatalogSkillAssets = ReturnType<typeof readCatalogSkillAssets>;
type CatalogSkillMetadata = ReturnType<typeof projectCatalogSkillMetadata>;
type ConsumedAssetRole = "catalog_metadata" | "input_schema" | "normalized_output_schema" | "resource_requirements";

const consumedAssetFields: Record<ConsumedAssetRole, { ref: string; version: string }> = {
  catalog_metadata: { ref: "catalog_metadata_id", version: "catalog_metadata_version" },
  input_schema: { ref: "schema_id", version: "schema_version" },
  normalized_output_schema: { ref: "schema_id", version: "schema_version" },
  resource_requirements: { ref: "resource_requirements_id", version: "resource_requirements_version" },
};

function readCatalogSkill(rootPath: string, entry: Record<string, unknown>, budget: LodeReadBudget): LodeCatalogSkill {
  const assets = readCatalogSkillAssets(rootPath, entry, budget);
  const metadata = projectCatalogSkillMetadata(entry, assets);
  return projectCatalogSkill(rootPath, budget, assets, metadata);
}

function readCatalogSkillAssets(rootPath: string, entry: Record<string, unknown>, budget: LodeReadBudget) {
  const packageRef = requiredString(entry.package_ref, "registry package_ref");
  const siteSlug = requiredString(entry.site_slug, `${packageRef} site_slug`);
  const manifestPath = resolveLodeAssetPath(rootPath, requiredString(entry.manifest_path, `${packageRef} manifest_path`));
  const manifest = readLodeJsonObject(manifestPath, budget);
  const packageRoot = path.dirname(manifestPath);
  const packageLock = readLodeJsonObject(
    resolveLodeAssetPath(rootPath, requiredString(entry.lock_path, `${packageRef} lock_path`)),
    budget,
  );
  const catalogBinding = requiredLockedAssetBinding(manifest, packageLock, "catalog_metadata", packageRef);
  const inputBinding = requiredLockedAssetBinding(manifest, packageLock, "input_schema", packageRef);
  const outputBinding = requiredLockedAssetBinding(manifest, packageLock, "normalized_output_schema", packageRef);
  const requirementBinding = requiredLockedAssetBinding(manifest, packageLock, "resource_requirements", packageRef);
  const catalog = readBoundAsset(rootPath, packageRoot, catalogBinding, packageRef, "catalog_metadata", budget);
  const inputSchema = readBoundAsset(rootPath, packageRoot, inputBinding, packageRef, "input_schema", budget);
  const outputSchema = readBoundAsset(rootPath, packageRoot, outputBinding, packageRef, "normalized_output_schema", budget);
  const resourceRequirements = readBoundAsset(rootPath, packageRoot, requirementBinding, packageRef, "resource_requirements", budget);
  const requirementPath = requirementBinding.path;
  return { packageRef, siteSlug, manifest, packageRoot, packageLock, catalog, inputSchema, outputSchema, requirementPath, resourceRequirements };
}

function requiredLockedAssetBinding(
  manifest: Record<string, unknown>,
  packageLock: Record<string, unknown>,
  role: ConsumedAssetRole,
  packageRef: string,
) {
  const manifestAssets = Array.isArray(manifest.asset_refs)
    ? manifest.asset_refs.filter((asset) => isRecord(asset) && asset.role === role)
    : [];
  const lockedAssets = Array.isArray(packageLock.locked_assets)
    ? packageLock.locked_assets.filter((asset) => isRecord(asset) && asset.role === role)
    : [];
  if (manifestAssets.length !== 1 || lockedAssets.length !== 1) {
    throw new Error(`${packageRef} must declare exactly one ${role} asset binding.`);
  }
  const manifestAsset = requiredRecord(manifestAssets[0], `${packageRef} ${role} manifest asset`);
  const lockedAsset = requiredRecord(lockedAssets[0], `${packageRef} ${role} locked asset`);
  const fields = consumedAssetFields[role];
  const pathValue = requiredString(manifestAsset.path, `${packageRef} ${role} path`);
  const ref = requiredString(manifestAsset[fields.ref], `${packageRef} ${role} ref`);
  const version = requiredString(manifestAsset[fields.version], `${packageRef} ${role} version`);
  if (
    requiredString(lockedAsset.path, `${packageRef} locked ${role} path`) !== pathValue ||
    requiredString(lockedAsset.ref, `${packageRef} locked ${role} ref`) !== ref ||
    requiredString(lockedAsset.version, `${packageRef} locked ${role} version`) !== version
  ) {
    throw new Error(`${packageRef} ${role} is not bound to its package lock.`);
  }
  return { path: pathValue, ref, version };
}

function readBoundAsset(
  rootPath: string,
  packageRoot: string,
  binding: { path: string; ref: string; version: string },
  packageRef: string,
  role: ConsumedAssetRole,
  budget: LodeReadBudget,
) {
  const asset = readLodeJsonObject(resolveLodeAssetPath(rootPath, binding.path, packageRoot), budget);
  const extension = isRecord(asset["x-lode"]) ? asset["x-lode"] : null;
  const identityMatches = role === "input_schema" || role === "normalized_output_schema"
    ? asset.$id === binding.ref && extension?.schema_version === binding.version && extension.package_ref === packageRef
    : role === "catalog_metadata"
    ? asset.catalog_metadata_id === binding.ref && asset.catalog_metadata_version === binding.version && asset.package_ref === packageRef
    : asset.resource_requirements_id === binding.ref && asset.resource_requirements_version === binding.version && asset.package_ref === packageRef;
  if (!identityMatches) throw new Error(`${packageRef} ${role} identity does not match its locked binding.`);
  return asset;
}

function projectCatalogSkillMetadata(entry: Record<string, unknown>, assets: CatalogSkillAssets) {
  const { packageRef, siteSlug, manifest, packageLock, catalog, inputSchema, outputSchema } = assets;
  const manifestSite = requiredRecord(manifest.site, `${packageRef} manifest site`);
  const manifestCapability = requiredRecord(manifest.capability, `${packageRef} manifest capability`);
  const queryAdmission = requiredRecord(entry.core_admission_fields, `${packageRef} query admission fields`);
  const catalogAdmission = requiredRecord(catalog.core_admission_fields, `${packageRef} catalog admission fields`);
  const version = requiredRecord(catalog.version, `${packageRef} catalog version`);
  const entryVersion = requiredString(entry.version, `${packageRef} query version`);
  const currentVersion = requiredString(version.current, `${packageRef} catalog version.current`);
  const latestVersion = optionalString(version.latest) ?? currentVersion;
  const lifecycle = requiredString(version.lifecycle, `${packageRef} catalog lifecycle`);
  const lockRef = requiredString(catalog.lock_ref, `${packageRef} catalog lock_ref`);
  const inputSchemaId = optionalString(inputSchema.$id) ?? "";
  const outputSchemaId = optionalString(outputSchema.$id) ?? "";
  const capabilityId = requiredString(manifestCapability.capability_id, `${packageRef} manifest capability id`);
  const operationId = requiredString(manifestCapability.operation_id, `${packageRef} manifest operation id`);
  const operationMode = requiredString(manifestCapability.operation_mode, `${packageRef} manifest operation mode`);
  const operationRef = requiredString(manifestCapability.operation_ref, `${packageRef} manifest operation ref`);
  const targetType = requiredString(manifestCapability.target_type, `${packageRef} manifest target type`);
  const siteOrigins = requiredStringArray(manifestSite.supported_origins, `${packageRef} manifest supported origins`);
  const outputAsset = requiredRecord(
    (Array.isArray(manifest.asset_refs) ? manifest.asset_refs : []).find((asset) => isRecord(asset) && asset.role === "normalized_output_schema"),
    `${packageRef} output schema asset`,
  );
  const outputSchemaVersion = requiredString(outputAsset.schema_version, `${packageRef} output schema version`);
  if (
    requiredString(manifest.manifest_version, `${packageRef} manifest version`) !== "lode.site-capability.manifest.v0" ||
    requiredString(manifest.package_type, `${packageRef} manifest package type`) !== "site-capability" ||
    requiredString(packageLock.schema_version, `${packageRef} package lock schema`) !== "lode.package-lock.v0" ||
    requiredString(catalog.schema_version, `${packageRef} catalog schema`) !== "lode.catalog-metadata.v0" ||
    requiredString(manifest.package_ref, `${packageRef} manifest package_ref`) !== packageRef ||
    requiredString(catalog.package_ref, `${packageRef} catalog package_ref`) !== packageRef ||
    requiredString(packageLock.package_ref, `${packageRef} package lock package_ref`) !== packageRef ||
    requiredString(packageLock.lock_ref, `${packageRef} package lock lock_ref`) !== lockRef ||
    requiredString(packageLock.lock_version, `${packageRef} package lock lock_version`) !== currentVersion ||
    requiredString(packageLock.package_version, `${packageRef} package lock version`) !== currentVersion ||
    requiredString(packageLock.capability_id, `${packageRef} package lock capability id`) !== capabilityId ||
    requiredString(packageLock.operation_id, `${packageRef} package lock operation id`) !== operationId ||
    requiredString(packageLock.operation_mode, `${packageRef} package lock operation mode`) !== operationMode ||
    requiredString(packageLock.lifecycle, `${packageRef} package lock lifecycle`) !== lifecycle ||
    requiredString(manifestCapability.lifecycle, `${packageRef} manifest lifecycle`) !== lifecycle ||
    requiredString(manifestSite.slug, `${packageRef} manifest site slug`) !== siteSlug ||
    requiredString(entry.lock_ref, `${packageRef} query lock_ref`) !== lockRef ||
    requiredString(queryAdmission.lock_ref, `${packageRef} query admission lock_ref`) !== lockRef ||
    requiredString(queryAdmission.input_schema_id, `${packageRef} query input schema`) !== inputSchemaId ||
    requiredString(queryAdmission.output_schema_id, `${packageRef} query output schema`) !== outputSchemaId ||
    requiredString(catalogAdmission.input_schema_id, `${packageRef} catalog input schema`) !== inputSchemaId ||
    requiredString(catalogAdmission.output_schema_id, `${packageRef} catalog output schema`) !== outputSchemaId ||
    requiredString(entry.operation_id, `${packageRef} query operation id`) !== operationId ||
    requiredString(entry.operation_mode, `${packageRef} query operation mode`) !== operationMode ||
    requiredString(catalog.operation_id, `${packageRef} catalog operation id`) !== operationId ||
    requiredString(catalog.operation_mode, `${packageRef} catalog operation mode`) !== operationMode ||
    requiredString(catalog.capability_id, `${packageRef} catalog capability id`) !== capabilityId ||
    requiredString(queryAdmission.operation_mode, `${packageRef} query admission operation mode`) !== operationMode ||
    requiredString(catalogAdmission.operation_mode, `${packageRef} catalog admission operation mode`) !== operationMode ||
    operationRef !== `lode://operation/${operationId}` ||
    packageRef.match(/\/([^/@]+)@[^/]+$/)?.[1] !== capabilityId ||
    requiredString(manifestCapability.version, `${packageRef} manifest version`) !== entryVersion ||
    packageRef.slice(packageRef.lastIndexOf("@") + 1) !== entryVersion ||
    currentVersion !== entryVersion ||
    requiredString(entry.lifecycle, `${packageRef} query lifecycle`) !== lifecycle
  ) {
    throw new Error(`Mismatched Lode package metadata for ${packageRef}.`);
  }
  return {
    capabilityId, catalogAdmission, currentVersion, latestVersion, lifecycle, lockRef, inputSchemaId,
    operationId, operationMode, operationRef, outputSchemaId, outputSchemaVersion, siteOrigins, targetType,
  };
}

function projectCatalogSkill(
  rootPath: string,
  budget: LodeReadBudget,
  assets: CatalogSkillAssets,
  metadata: CatalogSkillMetadata,
): LodeCatalogSkill {
  const { packageRef, siteSlug, manifest, packageRoot, packageLock, catalog, inputSchema, outputSchema, requirementPath, resourceRequirements } = assets;
  const {
    currentVersion, latestVersion, lifecycle, lockRef, inputSchemaId, operationId, operationMode,
    operationRef, outputSchemaId, outputSchemaVersion, siteOrigins, targetType,
  } = metadata;
  const display = requiredRecord(catalog.display, `${packageRef} catalog display`);
  const status = requiredRecord(catalog.status, `${packageRef} catalog status`);
  const resourceRequirementRef = optionalString(metadata.catalogAdmission.resource_requirements_id);
  const actionDeclaration = isRecord(manifest.action_declaration) ? manifest.action_declaration : null;
  const inputFields = projectInputFields(inputSchema, {
    operationMode, operationRef, packageRef, schemaId: inputSchemaId,
  });
  const requiredInputFields = requiredStringArray(inputSchema.required ?? [], `${packageRef} input schema required`);
  const actions = actionDeclaration == null || operationMode == null || resourceRequirementRef == null
    ? []
    : projectActions({
        actionDeclaration, inputSchemaId, operationId, operationMode, operationRef, outputSchemaId, packageRef, requirementPath,
        requirementRef: resourceRequirementRef, requiredInputFields, requirements: resourceRequirements, siteOrigins, siteSlug, targetType,
      });
  const projectedOutputKind = projectOutputKind(outputSchema, {
    operationMode, operationRef, packageRef, schemaId: outputSchemaId, schemaVersion: outputSchemaVersion,
  });
  const resultView = projectResultView(catalog.result_view, {
    manifest,
    packageRef,
    siteSlug,
    outputSchemaId,
    outputKind: projectedOutputKind,
    lockRef,
    packageLock,
    packageRoot,
    rootPath,
    budget,
  });
  const catalogAvailable = status.catalog_state === "available";
  const lifecycleAvailable = lifecycle !== "broken" && lifecycle !== "deprecated";
  const versionCompatible = supportedLodePackageRefs.includes(packageRef);
  const contractComplete = inputSchemaId.length > 0 &&
    outputSchemaId.length > 0 &&
    inputFields.length > 0 &&
    inputFields.every((field) => field.kind !== "unknown") &&
    actions.length > 0 &&
    projectedOutputKind != null;
  const availability = catalogAvailable && lifecycleAvailable && versionCompatible && contractComplete ? "available" : "incompatible";

  return {
    id: packageRef,
    packageRef,
    lockRef,
    siteSlug,
    siteName: requiredString(display.site_name, `${packageRef} display.site_name`),
    name: requiredString(display.name, `${packageRef} display.name`),
    summary: requiredString(display.summary, `${packageRef} display.summary`),
    category: requiredString(display.category, `${packageRef} display.category`),
    version: currentVersion,
    latestVersion,
    lifecycle,
    facets: catalog.facets === undefined ? [] : requiredStringArray(catalog.facets, `${packageRef} facets`),
    sourceHealth: optionalString(status.source_health) ?? "unknown",
    updatedAt: optionalString(status.updated_at) ?? "unknown",
    availability,
    availabilityReason: catalogAvailabilityReason(
      availability, catalogAvailable, lifecycleAvailable, versionCompatible, actions.length, projectedOutputKind,
    ),
    inputSchemaId,
    inputFields,
    outputSchemaId,
    outputKind: projectedOutputKind ?? "unknown",
    resultView,
    actions,
  };
}

function catalogAvailabilityReason(
  availability: LodeCatalogSkill["availability"],
  catalogAvailable: boolean,
  lifecycleAvailable: boolean,
  versionCompatible: boolean,
  actionCount: number,
  output: string | undefined,
) {
  if (availability === "available") return "输入、输出与业务动作声明可用。";
  if (!catalogAvailable) return "技能目录状态不可用。";
  if (!lifecycleAvailable) return "当前技能版本已停用。";
  if (!versionCompatible) return "当前技能合同版本与 App 不兼容。";
  if (actionCount === 0) return "缺少业务动作声明，已停止使用。";
  return output == null ? "输出合同缺少结果类型，已停止使用。" : "输入或输出合同缺失，已停止使用。";
}
