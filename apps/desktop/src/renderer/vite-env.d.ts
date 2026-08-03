/// <reference types="vite/client" />

type WebEnvoyShellContext = {
  platform: NodeJS.Platform;
  colorScheme: "light" | "dark";
  configScope: "local-ui-only";
};
type WebEnvoyRuntimeEndpointConfig = {
  coreEndpoint: string;
  harborEndpoint: string;
};
type WebEnvoyRuntimeProbe = {
  state: "ready" | "unavailable";
  url: string;
  statusCode?: number;
  summary: string;
  attempts?: Array<{ url: string; statusCode?: number; summary: string }>;
};
type WebEnvoyRuntimeServiceState = {
  id: "core" | "harbor";
  name: string;
  endpoint: string;
  processState: "not_configured" | "starting" | "running" | "exited" | "failed";
  launchSource: "env-command" | "env-path" | "packaged-path" | "local-cwd" | "not_configured";
  command?: string;
  cwd?: string;
  pid?: number;
  health: WebEnvoyRuntimeProbe;
  admission?: WebEnvoyRuntimeProbe;
  checkedAt: string;
  lastExitCode?: number | null;
  lastError?: string;
  repairAction: string;
};
type WebEnvoyLodeAssetBundleState = {
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
type WebEnvoyRuntimeSupervisorState = {
  mode: "real";
  checkedAt: string;
  services: WebEnvoyRuntimeServiceState[];
  lodeAssets: WebEnvoyLodeAssetBundleState;
  canUseLiveRuntime: boolean;
  failClosed: boolean;
  summary: string;
};
type WebEnvoyOwnerApiJsonRequest = {
  base: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};
type WebEnvoyManualAuthenticationCompletionIntent = {
  base: string;
  runtimeSessionRef: string;
};
type WebEnvoyLocalFileReference = {
  localRef: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
};
type WebEnvoyLocalFileReadability = {
  localRef: string;
  readable: boolean;
  reason: "readable" | "unreadable" | "not_regular_file" | "invalid_reference";
};
type WebEnvoyProtectedDraftResult = {
  status: "ready" | "unavailable" | "rejected";
  draft?: unknown;
};
type WebEnvoySealedInputResult =
  | {
      status: "ready";
      refs: {
        ownerRef: string;
        fieldOwnerRefs: Record<string, string>;
        attachmentRefs: Record<string, string[]>;
      };
    }
  | { status: "unavailable" | "rejected" };
type WebEnvoyProtectedInputReleaseResult = { status: "ready" | "unavailable" | "rejected" };
type WebEnvoyLodeCatalogField = {
  id: string;
  label: string;
  kind: "text" | "multiline" | "number" | "boolean" | "select" | "multi-select" | "file" | "constant" | "unknown";
  required: boolean;
  description: string;
  options?: string[];
  defaultValue?: string | number | boolean | string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  patternSafety?: "linear";
  format?: "uri";
  integer?: boolean;
  inputProjection: "safe_summary" | "sanitized_url" | "owner_ref";
};
type WebEnvoyLodeCatalogAction = {
  id: string;
  category: "read" | "prepare" | "commit" | "destructive";
  operationMode: "read" | "validate_only" | "draft" | "preview";
  targetTypes: string[];
  supportedOrigins: string[];
  externalEffects: string[];
  resourceRequirementRef: string;
  resourceRequirementProfileIds: string[];
};
type WebEnvoyLodeCatalogResultView =
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
type WebEnvoyLodeCatalogSkill = {
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
  inputFields: WebEnvoyLodeCatalogField[];
  outputSchemaId: string;
  outputKind: string;
  resultView: WebEnvoyLodeCatalogResultView;
  actions: WebEnvoyLodeCatalogAction[];
};
type WebEnvoyLodeCatalogState = {
  status: "ready" | "unavailable";
  fetchedAt: string;
  source: WebEnvoyLodeAssetBundleState["source"];
  summary: string;
  skills: WebEnvoyLodeCatalogSkill[];
};
type WebEnvoyLocalFileSelectionResult =
  | { status: "ready"; files: WebEnvoyLocalFileReference[] }
  | { status: "unavailable" | "rejected"; files: [] };

interface Window {
  webenvoyShell?: {
    getShellContext: () => Promise<WebEnvoyShellContext>;
    getRuntimeSupervisorState?: (
      config: WebEnvoyRuntimeEndpointConfig,
    ) => Promise<WebEnvoyRuntimeSupervisorState>;
    getLodeCatalog?: () => Promise<WebEnvoyLodeCatalogState>;
    requestOwnerJson?: (request: WebEnvoyOwnerApiJsonRequest) => Promise<unknown>;
    completeHarborManualAuthentication?: (intent: WebEnvoyManualAuthenticationCompletionIntent) => Promise<unknown>;
    selectLocalFiles?: () => Promise<WebEnvoyLocalFileSelectionResult>;
    checkLocalFiles?: (localRefs: string[]) => Promise<WebEnvoyLocalFileReadability[]>;
    releaseLocalFiles?: (localRefs: string[]) => Promise<WebEnvoyProtectedDraftResult>;
    loadProtectedDraft?: (context: unknown) => Promise<WebEnvoyProtectedDraftResult>;
    saveProtectedDraft?: (draft: unknown) => Promise<WebEnvoyProtectedDraftResult>;
    deleteProtectedDraft?: (context: unknown) => Promise<WebEnvoyProtectedDraftResult>;
      sealProtectedInput?: (draft: unknown) => Promise<WebEnvoySealedInputResult>;
      releaseProtectedInputs?: (ownerRefs: string[]) => Promise<WebEnvoyProtectedInputReleaseResult>;
    subscribeToSystemThemeVariant?: (
      listener: (colorScheme: WebEnvoyShellContext["colorScheme"]) => void,
    ) => () => void;
  };
}
