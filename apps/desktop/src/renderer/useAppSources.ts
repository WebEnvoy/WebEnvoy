import { useEffect, useState } from "react";

import { fetchCoreThreadState, loadingCoreThreadState, retainLastKnownCoreThreads } from "./coreThreadClient";
import type { CoreReadTaskLoadState } from "./coreReadTaskClient";
import { fetchHarborIdentityState } from "./harborIdentityClient";
import type { HarborIdentityLoadState } from "./harborIdentityTypes";
import { defaultConnectionConfig, loadLocalConnectionConfig, saveLocalConnectionConfig, type LocalConnectionConfig } from "./localConnectionConfig";
import { fetchLodeCatalog, loadingLodeCatalogState, type LodeCatalogLoadState } from "./lodeCatalogClient";
import { runtimeSupervisorCheckingState, runtimeSupervisorUnavailableState, type RuntimeSupervisorState } from "./runtimeSupervisorState";

export type ShellContext = {
  platform: string;
  colorScheme: "light" | "dark";
  configScope: "local-ui-only";
};

const initialHarborIdentityState: HarborIdentityLoadState = {
  status: "loading",
  fetchedAt: "pending",
  summary: "正在读取 Harbor live identity public facts。",
  identities: [],
  providers: [],
};

export function useAppSources() {
  const [connectionConfig, setConnectionConfig] = useState<LocalConnectionConfig>(defaultConnectionConfig);
  const [shellContext, setShellContext] = useState<ShellContext | null>(null);
  const [runtimeSupervisorState, setRuntimeSupervisorState] = useState<RuntimeSupervisorState>(runtimeSupervisorCheckingState);
  const [coreReadState, setCoreReadState] = useState<CoreReadTaskLoadState>(() => loadingCoreThreadState(defaultConnectionConfig.coreEndpoint));
  const [harborIdentityState, setHarborIdentityState] = useState<HarborIdentityLoadState>(initialHarborIdentityState);
  const [lodeCatalogState, setLodeCatalogState] = useState<LodeCatalogLoadState>(loadingLodeCatalogState);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  useShellSource(setShellContext, setConnectionConfig);
  useCoreSource(connectionConfig.coreEndpoint, setCoreReadState);
  useHarborSource(connectionConfig.harborEndpoint, runtimeSupervisorState.canUseLiveRuntime, setHarborIdentityState);
  useCatalogSource(setLodeCatalogState);
  useRuntimeSource(connectionConfig, setRuntimeSupervisorState);

  function updateEndpoint(field: keyof LocalConnectionConfig, value: string) {
    setSettingsSaved(false);
    setSettingsError("");
    setConnectionConfig((current) => ({ ...current, [field]: value }));
  }

  function saveSettings() {
    const validation = saveLocalConnectionConfig(connectionConfig);
    if (!validation.ok) {
      setSettingsSaved(false);
      setSettingsError(Object.values(validation.errors).join(" "));
      return;
    }
    setConnectionConfig(validation.config);
    setSettingsError("");
    setSettingsSaved(true);
  }

  return {
    connectionConfig, coreReadState, harborIdentityState, lodeCatalogState, runtimeSupervisorState,
    settingsError, settingsSaved, shellContext, saveSettings, setHarborIdentityState,
    setLodeCatalogState, updateEndpoint,
  };
}

function useShellSource(
  setShellContext: React.Dispatch<React.SetStateAction<ShellContext | null>>,
  setConnectionConfig: React.Dispatch<React.SetStateAction<LocalConnectionConfig>>,
) {
  useEffect(() => {
    let cancelled = false;
    setConnectionConfig(loadLocalConnectionConfig());
    const read = window.webenvoyShell?.getShellContext;
    (read?.() ?? Promise.resolve(localShellContext())).then((context) => {
      if (!cancelled) applyTheme(context, setShellContext);
    }).catch(() => {
      if (!cancelled) applyTheme(localShellContext(), setShellContext);
    });
    const unsubscribe = window.webenvoyShell?.subscribeToSystemThemeVariant?.((colorScheme) => {
      if (!cancelled) applyColorScheme(colorScheme, setShellContext);
    }) ?? null;
    const media = unsubscribe == null ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const browserTheme = () => { if (!cancelled) applyColorScheme(localShellContext().colorScheme, setShellContext); };
    media?.addEventListener("change", browserTheme);
    return () => {
      cancelled = true;
      unsubscribe?.();
      media?.removeEventListener("change", browserTheme);
    };
  }, []);
}

function useCoreSource(endpoint: string, setState: React.Dispatch<React.SetStateAction<CoreReadTaskLoadState>>) {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setState(loadingCoreThreadState(endpoint));
    const refresh = async () => {
      const next = await fetchCoreThreadState(endpoint);
      if (!cancelled) {
        setState((current) => retainLastKnownCoreThreads(current, next));
        timer = window.setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [endpoint]);
}

function useHarborSource(
  endpoint: string,
  runtimeAvailable: boolean,
  setState: React.Dispatch<React.SetStateAction<HarborIdentityLoadState>>,
) {
  useEffect(() => {
    let cancelled = false;
    setState(initialHarborIdentityState);
    void fetchHarborIdentityState(endpoint).then((state) => {
      if (!cancelled) setState(state);
    });
    return () => { cancelled = true; };
  }, [endpoint, runtimeAvailable]);
}

function useCatalogSource(setState: React.Dispatch<React.SetStateAction<LodeCatalogLoadState>>) {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      const state = await fetchLodeCatalog();
      if (!cancelled) {
        setState(state);
        timer = window.setTimeout(refresh, 30_000);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);
}

function useRuntimeSource(config: LocalConnectionConfig, setState: React.Dispatch<React.SetStateAction<RuntimeSupervisorState>>) {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setState(runtimeSupervisorCheckingState());
    const read = window.webenvoyShell?.getRuntimeSupervisorState;
    if (read == null) {
      setState(runtimeSupervisorUnavailableState("Electron runtime supervisor unavailable；生产任务保持 fail closed，fixture/demo 不作为可用结果。"));
      return () => { cancelled = true; };
    }
    const refresh = async () => {
      try {
        const state = await read(config);
        if (!cancelled) setState(state);
      } catch (error) {
        if (!cancelled) setState(runtimeSupervisorUnavailableState(error instanceof Error ? error.message : String(error)));
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [config]);
}

function localShellContext(): ShellContext {
  return { ...shellFallback(), colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" };
}

function shellFallback(): Omit<ShellContext, "colorScheme"> {
  return { platform: "browser", configScope: "local-ui-only" };
}

function applyTheme(context: ShellContext, setState: React.Dispatch<React.SetStateAction<ShellContext | null>>) {
  document.documentElement.style.setProperty("color-scheme", context.colorScheme);
  document.documentElement.dataset.weTheme = context.colorScheme;
  setState((current) => current == null ? context : { ...current, ...context });
}

function applyColorScheme(colorScheme: ShellContext["colorScheme"], setState: React.Dispatch<React.SetStateAction<ShellContext | null>>) {
  document.documentElement.style.setProperty("color-scheme", colorScheme);
  document.documentElement.dataset.weTheme = colorScheme;
  setState((current) => ({ ...(current ?? shellFallback()), colorScheme }));
}
