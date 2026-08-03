import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readLodeJsonObject, resolveLodeAssetPath } from "./lodeAssetAccess.js";

export type LodeAssetBundleState = {
  state: "ready" | "missing" | "invalid";
  source: "env-path" | "packaged-path" | "build-output" | "not_configured";
  rootPath?: string;
  registryPath?: string;
  packageCount: number;
  requiredPackageRefs: string[];
  missingPackageRefs: string[];
  checkedAt: string;
  summary: string;
  consumerBoundary: string;
};

type LocalPackageIndex = {
  entries?: {
    package_ref?: unknown;
    package_type?: unknown;
    package_path?: unknown;
    manifest_path?: unknown;
    lock_path?: unknown;
    lock_ref?: unknown;
    site_slug?: unknown;
    version?: unknown;
    lifecycle?: unknown;
  }[];
};

export const supportedLodePackageRefs = [
  "lode://site-capability/xiaohongshu/search-notes@0.1.0",
  "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
  "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
  "lode://site-capability/boss/job-search@0.1.0",
  "lode://site-capability/boss/read-job-detail@0.1.1",
  "lode://site-capability/boss/greet-precheck@0.1.0",
];

const requiredPackageRefs = supportedLodePackageRefs;

const requiredPackageFiles = [
  "manifest_path",
  "lock_path",
  "resource-requirements.json",
  "failure-mapping.json",
  "write-deferred-guardrail.json",
] as const;

const consumerBoundary =
  "App only resolves packaged/local Lode capability assets and passes refs/paths to Core; Lode remains the asset truth and Core/Harbor own runtime/live evidence.";

export function resolveLodeAssetBundle(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath = getResourcesPath(),
): LodeAssetBundleState {
  const checkedAt = new Date().toISOString();
  const explicitPath = env.WEBENVOY_LODE_ASSETS_PATH?.trim();
  const packagedPath = resourcesPath ? path.join(resourcesPath, "lode") : undefined;
  const buildOutputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "lode");

  if (explicitPath) {
    return inspectLodeAssetRoot(explicitPath, "env-path", checkedAt);
  }

  if (packagedPath && existsSync(packagedPath)) {
    return inspectLodeAssetRoot(packagedPath, "packaged-path", checkedAt);
  }

  if (existsSync(buildOutputPath)) {
    return inspectLodeAssetRoot(buildOutputPath, "build-output", checkedAt);
  }

  return {
    state: "missing",
    source: "not_configured",
    packageCount: 0,
    requiredPackageRefs,
    missingPackageRefs: requiredPackageRefs,
    checkedAt,
    summary: "Lode capability assets are not packaged or configured; Core task submission remains fail closed.",
    consumerBoundary,
  };
}

export function coreLodeAssetEnvironment(bundle: LodeAssetBundleState): NodeJS.ProcessEnv {
  if (bundle.state !== "ready" || !bundle.rootPath || !bundle.registryPath) return {};

  return {
    WEBENVOY_LODE_ASSETS_PATH: bundle.rootPath,
    WEBENVOY_LODE_REGISTRY_PATH: bundle.registryPath,
  };
}

function inspectLodeAssetRoot(
  rootPath: string,
  source: LodeAssetBundleState["source"],
  checkedAt: string,
): LodeAssetBundleState {
  const registryPath = path.join(rootPath, "registry", "local-packages.json");

  try {
    const resolvedRegistryPath = resolveLodeAssetPath(rootPath, "registry/local-packages.json");
    const registry = readLodeJsonObject(resolvedRegistryPath) as LocalPackageIndex;
    const entries = Array.isArray(registry.entries) ? registry.entries : [];
    const requiredEntries = requiredPackageRefs.map((packageRef) =>
      entries.find((entry) => stringValue(entry.package_ref) === packageRef),
    );
    const resolvedPackageRefs = requiredEntries.map((entry, index) =>
      stringValue(entry?.package_ref) ?? requiredPackageRefs[index]!,
    );
    const missingPackageRefs = requiredEntries.flatMap((entry, index) =>
      entry == null ? [requiredPackageRefs[index]!] : [],
    );
    const missingFiles = requiredEntries
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
      .flatMap((entry) => missingEntryFiles(rootPath, entry));

    if (missingPackageRefs.length > 0 || missingFiles.length > 0) {
      return {
        state: "invalid",
        source,
        rootPath,
        registryPath,
        packageCount: entries.length,
        requiredPackageRefs: resolvedPackageRefs,
        missingPackageRefs,
        checkedAt,
        summary: `Lode asset bundle is incomplete; missing refs=${missingPackageRefs.length}, missing files=${missingFiles.length}.`,
        consumerBoundary,
      };
    }

    return {
      state: "ready",
      source,
      rootPath,
      registryPath,
      packageCount: entries.length,
      requiredPackageRefs: resolvedPackageRefs,
      missingPackageRefs: [],
      checkedAt,
      summary: "Lode local package registry and required Xiaohongshu/BOSS capability assets are available for Core consumption.",
      consumerBoundary,
    };
  } catch (error) {
    return {
      state: "invalid",
      source,
      rootPath,
      registryPath,
      packageCount: 0,
      requiredPackageRefs,
      missingPackageRefs: requiredPackageRefs,
      checkedAt,
      summary: error instanceof Error ? error.message : String(error),
      consumerBoundary,
    };
  }
}

function missingEntryFiles(rootPath: string, entry: NonNullable<LocalPackageIndex["entries"]>[number]) {
  const packagePath = stringValue(entry.package_path);
  const manifestPath = stringValue(entry.manifest_path);
  const lockPath = stringValue(entry.lock_path);
  const missingDeclarations = [
    packagePath == null ? "package_path" : null,
    manifestPath == null ? "manifest_path" : null,
    lockPath == null ? "lock_path" : null,
  ].filter((value): value is string => value != null);
  if (missingDeclarations.length > 0) return missingDeclarations;
  const relativePaths = [
    manifestPath,
    lockPath,
    ...(packagePath ? requiredPackageFiles.slice(2).map((file) => path.join(packagePath, file)) : []),
  ].filter((value): value is string => Boolean(value));

  return relativePaths.filter((relativePath) => {
    try {
      resolveLodeAssetPath(rootPath, relativePath);
      return false;
    } catch {
      return true;
    }
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getResourcesPath() {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}
