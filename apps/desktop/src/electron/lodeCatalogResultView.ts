import path from "node:path";

import { readLodeJsonObjectSha256, resolveLodeAssetPath, type LodeReadBudget } from "./lodeAssetAccess.js";
import type { LodeCatalogResultView } from "./lodeCatalog.js";
import { hasOnlyKeys, isRecord, optionalString } from "./lodeCatalogGuards.js";

type ResultViewContext = {
  manifest: Record<string, unknown>;
  packageRef: string;
  siteSlug: string;
  outputSchemaId: string;
  outputKind: string | undefined;
  lockRef: string;
  packageLock: Record<string, unknown>;
  packageRoot: string;
  rootPath: string;
  budget: LodeReadBudget;
};

export function projectResultView(value: unknown, context: ResultViewContext): LodeCatalogResultView {
  const resourceAsset = uniqueManifestAsset(context.manifest, "result_view_resource");
  if (value === undefined) return standardResultView(resourceAsset == null ? "not_declared" : "incompatible");
  if (!isRecord(value)) return standardResultView("incompatible");
  if (value.status === "absent") {
    return resourceAsset == null && hasOnlyKeys(value, ["status", "fallback"]) && value.fallback === "standard_renderer"
      ? standardResultView("not_declared")
      : standardResultView("incompatible");
  }
  const declaration = parseDeclaration(value);
  if (declaration == null) return standardResultView("incompatible");
  const binding = validateResourceBinding(declaration, context, resourceAsset);
  if (!binding.ok || !compatibleOutput(declaration.compatibleOutputs, context, binding.outputAsset)) {
    return standardResultView("incompatible");
  }
  const resourceDigest = readResultViewResource(context, declaration.resourcePath);
  if (resourceDigest !== declaration.digest) return standardResultView("incompatible");
  return {
    mode: "skill",
    fallback: "standard_renderer",
    declarationVersion: "0.1.0",
    viewId: declaration.viewId,
    viewVersion: declaration.viewVersion,
    resourceRef: declaration.resourceRef,
    lockRef: context.lockRef,
  };
}

function parseDeclaration(value: Record<string, unknown>) {
  const keys = ["status", "declaration_version", "view_id", "view_version", "resource_ref", "resource_path", "compatible_outputs", "integrity", "lock_ref", "fallback"];
  if (value.status !== "present" || !hasOnlyKeys(value, keys) || value.declaration_version !== "0.1.0" ||
    value.fallback !== "standard_renderer" || !isRecord(value.compatible_outputs) || !isRecord(value.integrity) ||
    !hasOnlyKeys(value.integrity, ["algorithm", "digest"]) || value.integrity.algorithm !== "sha256") return null;
  const viewId = optionalString(value.view_id);
  const viewVersion = optionalString(value.view_version);
  const resourceRef = optionalString(value.resource_ref);
  const resourcePath = optionalString(value.resource_path);
  const digest = optionalString(value.integrity.digest);
  if (viewId == null || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(viewId) || viewVersion == null ||
    !/^\d+\.\d+\.\d+$/.test(viewVersion) || resourceRef == null || resourcePath == null ||
    !isSafePackagePath(resourcePath) || digest == null || !/^[a-f0-9]{64}$/.test(digest)) return null;
  return { viewId, viewVersion, resourceRef, resourcePath, digest, compatibleOutputs: value.compatible_outputs, lockRef: value.lock_ref };
}

function validateResourceBinding(
  declaration: NonNullable<ReturnType<typeof parseDeclaration>>,
  context: ResultViewContext,
  resourceAsset: Record<string, unknown> | undefined,
) {
  const outputAsset = uniqueManifestAsset(context.manifest, "normalized_output_schema");
  const locked = uniqueLockedAsset(context.packageLock, "result_view_resource");
  const capabilityId = context.packageRef.match(/\/([^/@]+)@[^/]+$/)?.[1];
  const expectedRef = capabilityId == null ? null : `lode://result-view/${context.siteSlug}/${capabilityId}/${declaration.viewId}@${declaration.viewVersion}`;
  const ok = declaration.lockRef === context.lockRef && declaration.resourceRef === expectedRef &&
    resourceAsset?.status === "present" && resourceAsset.resource_ref === declaration.resourceRef &&
    resourceAsset.resource_version === declaration.viewVersion && resourceAsset.path === declaration.resourcePath &&
    locked?.ref === declaration.resourceRef && locked.version === declaration.viewVersion &&
    locked.path === declaration.resourcePath && locked.sha256 === declaration.digest &&
    outputAsset?.schema_id === context.outputSchemaId;
  return { ok, outputAsset };
}

function compatibleOutput(value: Record<string, unknown>, context: ResultViewContext, outputAsset: Record<string, unknown> | undefined) {
  const schemas = value.schemas;
  const kinds = value.result_kinds;
  const allowedKeys = [...(schemas === undefined ? [] : ["schemas"]), ...(kinds === undefined ? [] : ["result_kinds"])];
  if (allowedKeys.length === 0 || !hasOnlyKeys(value, allowedKeys)) return false;
  const schemasValid = schemas === undefined || Array.isArray(schemas) && schemas.length > 0 && schemas.length <= 100 &&
    schemas.every((candidate) => isRecord(candidate) && hasOnlyKeys(candidate, ["schema_ref", "schema_version"]) &&
      optionalString(candidate.schema_ref) != null && optionalString(candidate.schema_version) != null) &&
    schemas.some((candidate) => isRecord(candidate) && candidate.schema_ref === context.outputSchemaId && candidate.schema_version === outputAsset?.schema_version);
  const kindsValid = kinds === undefined || Array.isArray(kinds) && kinds.length > 0 && kinds.length <= 100 &&
    new Set(kinds).size === kinds.length && kinds.every((kind) => optionalString(kind) != null) &&
    context.outputKind != null && kinds.includes(context.outputKind);
  return schemasValid && kindsValid;
}

function uniqueManifestAsset(manifest: Record<string, unknown>, role: string) {
  const matches = (Array.isArray(manifest.asset_refs) ? manifest.asset_refs : [])
    .filter((value): value is Record<string, unknown> => isRecord(value) && value.role === role);
  return matches.length === 1 ? matches[0] : undefined;
}

function uniqueLockedAsset(lock: Record<string, unknown>, role: string) {
  const matches = (Array.isArray(lock.locked_assets) ? lock.locked_assets : [])
    .filter((value): value is Record<string, unknown> => isRecord(value) && value.role === role);
  return matches.length === 1 ? matches[0] : undefined;
}

function readResultViewResource(context: ResultViewContext, resourcePath: string) {
  try {
    const file = resolveLodeAssetPath(context.rootPath, resourcePath, context.packageRoot);
    return readLodeJsonObjectSha256(file, context.budget);
  } catch {
    return null;
  }
}

function isSafePackagePath(value: string) {
  return !path.isAbsolute(value) && !value.includes("\0") && !value.split(/[\\/]/).includes("..");
}

export function standardResultView(reason: "not_declared" | "incompatible"): LodeCatalogResultView {
  return { mode: "standard", fallback: "standard_renderer", reason };
}
