import { contextBridge, ipcRenderer } from "electron";

type WebEnvoyShellContext = {
  platform: NodeJS.Platform;
  colorScheme: "light" | "dark";
  configScope: "local-ui-only";
};
type WebEnvoyColorScheme = WebEnvoyShellContext["colorScheme"];
type RuntimeEndpointConfig = {
  coreEndpoint: string;
  harborEndpoint: string;
};
type OwnerApiJsonRequest = {
  base: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};
type ManualAuthenticationCompletionIntent = {
  base: string;
  runtimeSessionRef: string;
};

const shellApi = {
  getShellContext: () =>
    ipcRenderer.invoke("webenvoy:shell-context") as Promise<WebEnvoyShellContext>,
  getRuntimeSupervisorState: (config: RuntimeEndpointConfig) =>
    ipcRenderer.invoke("webenvoy:runtime-supervisor-state", config),
  getLodeCatalog: () => ipcRenderer.invoke("webenvoy:lode-catalog"),
  requestOwnerJson: (request: OwnerApiJsonRequest) =>
    ipcRenderer.invoke("webenvoy:owner-api-json", request),
  completeHarborManualAuthentication: (intent: ManualAuthenticationCompletionIntent) =>
    ipcRenderer.invoke("webenvoy:harbor-manual-authentication-completed", intent),
  selectLocalFiles: () => ipcRenderer.invoke("webenvoy:select-local-files"),
  checkLocalFiles: (localRefs: string[]) => ipcRenderer.invoke("webenvoy:check-local-files", localRefs),
  releaseLocalFiles: (localRefs: string[]) => ipcRenderer.invoke("webenvoy:release-local-files", localRefs),
  loadProtectedDraft: (context: unknown) => ipcRenderer.invoke("webenvoy:load-protected-draft", context),
  saveProtectedDraft: (draft: unknown) => ipcRenderer.invoke("webenvoy:save-protected-draft", draft),
  deleteProtectedDraft: (context: unknown) => ipcRenderer.invoke("webenvoy:delete-protected-draft", context),
  sealProtectedInput: (draft: unknown) => ipcRenderer.invoke("webenvoy:seal-protected-input", draft),
  releaseProtectedInputs: (ownerRefs: string[]) => ipcRenderer.invoke("webenvoy:release-protected-inputs", ownerRefs),
  subscribeToSystemThemeVariant: (listener: (colorScheme: WebEnvoyColorScheme) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, colorScheme: WebEnvoyColorScheme) => {
      listener(colorScheme);
    };
    ipcRenderer.on("webenvoy:system-theme-variant", handler);
    return () => {
      ipcRenderer.off("webenvoy:system-theme-variant", handler);
    };
  },
};

contextBridge.exposeInMainWorld("webenvoyShell", shellApi);
