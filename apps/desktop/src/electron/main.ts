import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ownerApiResponseMaxBytes, readBoundedJsonResponse } from "./boundedJsonResponse.js";
import { runPackagedTaskBoundarySmoke } from "./packagedTaskBoundarySmoke.js";
import { createRuntimeSupervisor } from "./runtimeSupervisor.js";
import { readLodeCatalog } from "./lodeCatalog.js";
import {
  isExpectedManualAuthenticationRendererUrl,
  parseManualAuthenticationCompletionIntent,
  requestManualAuthenticationCompletion,
} from "./manualAuthenticationCompletion.js";
import {
  harborSupervisorAuthorizationHeader,
  isHarborSupervisorProtectedRequest,
  ownerApiTimeoutMs,
  parseOwnerApiRequest,
  projectHarborIdentityMutationErrorBody,
  projectOwnerApiError,
  type OwnerApiJsonRequest,
} from "./ownerApiRequest.js";
import { registerWorkbenchIpc } from "./workbenchIpc.js";
import { secureRendererNavigation } from "./rendererNavigationGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDevUrl = process.env.WEBENVOY_RENDERER_URL;
const packagedSmoke = process.env.WEBENVOY_PACKAGED_SMOKE === "1";
const packagedSmokeTaskBoundary = process.env.WEBENVOY_PACKAGED_SMOKE_TASK_BOUNDARY === "1";
const packagedSmokeScreenshot = process.env.WEBENVOY_PACKAGED_SMOKE_SCREENSHOT;
const packagedSmokeRuntimeExpectation = process.env.WEBENVOY_PACKAGED_SMOKE_RUNTIME_EXPECTATION ?? "fail_closed";
const packagedSmokeCoreEndpoint = process.env.WEBENVOY_PACKAGED_SMOKE_CORE_ENDPOINT ?? "http://127.0.0.1:8787";
const packagedSmokeHarborEndpoint = process.env.WEBENVOY_PACKAGED_SMOKE_HARBOR_ENDPOINT ?? "http://127.0.0.1:8788";
const packagedSmokeLodeEndpoint = process.env.WEBENVOY_PACKAGED_SMOKE_LODE_ENDPOINT ?? "http://127.0.0.1:8789";
const packagedSmokeUserDataDir = process.env.WEBENVOY_PACKAGED_SMOKE_USER_DATA_DIR;
const localConnectionStorageKey = "webenvoy.localConnectionConfig.v1";
let runtimeSupervisor = createRuntimeSupervisor();
const mainWindows = new Set<BrowserWindow>();
app.setName("WebEnvoy App");

if (packagedSmoke && packagedSmokeUserDataDir) {
  app.setPath("userData", packagedSmokeUserDataDir);
}

function getSystemColorScheme() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function createMainWindow() {
  const macWindowChrome =
    process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {};

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 640,
    title: "WebEnvoy App",
    backgroundColor: getSystemColorScheme() === "dark" ? "#17191d" : "#f7f8fb",
    ...macWindowChrome,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindows.add(window);
  secureRendererNavigation(window.webContents, expectedRendererUrl());
  window.on("closed", () => {
    mainWindows.delete(window);
  });

  const loadRenderer = rendererDevUrl
    ? window.loadURL(rendererDevUrl)
    : window.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  revealMainWindow(window);

  if (packagedSmoke) {
    void runPackagedSmoke(window, loadRenderer);
  }

  return window;
}

function revealMainWindow(window: BrowserWindow) {
  const reveal = () => {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }
  };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", reveal);
  setTimeout(reveal, 500);
}

async function runPackagedSmoke(window: BrowserWindow, loadRenderer: Promise<void>) {
  try {
    await loadRenderer;
    await applyPackagedSmokeConnectionConfig(window);
    const result = (await window.webContents.executeJavaScript(`
      (async () => {
        const root = document.getElementById("root");
        const shell = window.webenvoyShell;
        const appShell = document.querySelector(".app-shell");
        const leftPanelButton = document.querySelector('[data-shell-panel-toggle="left"]');
        const rightPanelButton = document.querySelector('[data-shell-panel-toggle="right"]');
        const rightFullscreenButton = document.querySelector('[data-shell-panel-fullscreen="right"]');
        const panelButtons = [leftPanelButton, rightPanelButton].filter(Boolean);
        const composer = document.querySelector("[data-webenvoy-composer]");
        const waitUntil = async (predicate, attempts = 40, delayMs = 250) => {
          let latest = null;
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            latest = predicate();
            if (latest) return latest;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          return latest;
        };
        const readRuntimeSupervisorState = async () => {
          if (!shell?.getRuntimeSupervisorState) return null;
          let latest = null;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            latest = await shell.getRuntimeSupervisorState({
              coreEndpoint: ${JSON.stringify(packagedSmokeCoreEndpoint)},
              harborEndpoint: ${JSON.stringify(packagedSmokeHarborEndpoint)}
            });
            if (${JSON.stringify(packagedSmokeRuntimeExpectation)} === "live_ready" && latest?.canUseLiveRuntime) return latest;
            if (
              ${JSON.stringify(packagedSmokeRuntimeExpectation)} !== "live_ready" &&
              latest?.failClosed &&
              latest.services?.length === 2 &&
              latest.services?.every((service) => service.processState === "running")
            ) return latest;
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
          return latest;
        };
        const runtimeSupervisorState = await readRuntimeSupervisorState();
        const coreRuntime = runtimeSupervisorState?.services?.find((service) => service.id === "core");
        const harborRuntime = runtimeSupervisorState?.services?.find((service) => service.id === "harbor");
        const matchingRuntimeGate = () => {
          const candidate = document.querySelector("[data-testid='runtime-supervisor-status']");
          if (!candidate) return null;
          return candidate.getAttribute("data-runtime-core-health") === (coreRuntime?.health?.state ?? "unknown") &&
            candidate.getAttribute("data-runtime-core-admission") === (coreRuntime?.admission?.state ?? "unknown") &&
            candidate.getAttribute("data-runtime-harbor-health") === (harborRuntime?.health?.state ?? "unknown")
            ? candidate
            : null;
        };
        const matchingBlockedSurface = () => matchingRuntimeGate() ??
          (document.querySelector(".owner-state")?.textContent?.includes("还没有账号身份")
            ? document.querySelector(".owner-state")
            : null);
        const runtimeGate = ${JSON.stringify(packagedSmokeRuntimeExpectation)} === "live_ready"
          ? matchingRuntimeGate()
          : await waitUntil(matchingBlockedSurface);
        const coreThreadReadReady = Boolean(await waitUntil(
          () => document.querySelector(".task-list-empty")?.textContent?.trim() === "暂无任务线程"
        ));
        const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const readPanels = () => ({
          left: appShell?.getAttribute("data-left-panel-open"),
          right: appShell?.getAttribute("data-right-panel-open"),
          rightFullscreen: appShell?.getAttribute("data-right-panel-fullscreen"),
          leftWidth: Number(appShell?.getAttribute("data-left-panel-width") ?? 0),
          rightWidth: Number(appShell?.getAttribute("data-right-panel-width") ?? 0)
        });
        const dragHandle = async (handle, deltaX) => {
          if (!handle) return false;
          const rect = handle.getBoundingClientRect();
          const pointer = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          handle.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: pointer.x,
            clientY: pointer.y,
            pointerId: 1
          }));
          await waitFrame();
          window.dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true,
            clientX: pointer.x + deltaX,
            clientY: pointer.y,
            pointerId: 1
          }));
          window.dispatchEvent(new PointerEvent("pointerup", {
            bubbles: true,
            clientX: pointer.x + deltaX,
            clientY: pointer.y,
            pointerId: 1
          }));
          await waitFrame();
          return true;
        };
        const initialPanels = readPanels();
        rightPanelButton?.click();
        await waitFrame();
        const rightCollapsed = readPanels();
        rightPanelButton?.click();
        await waitFrame();
        const rightRestored = readPanels();
        rightFullscreenButton?.click();
        await waitFrame();
        const rightFullscreen = readPanels();
        rightFullscreenButton?.click();
        await waitFrame();
        const rightFullscreenRestored = readPanels();
        leftPanelButton?.click();
        await waitFrame();
        const leftCollapsed = readPanels();
        const leftRevealZone = document.querySelector(".left-panel-reveal-zone");
        leftRevealZone?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          clientX: 2,
          clientY: 64,
          pointerId: 2
        }));
        await waitFrame();
        const leftHoverPreviewVisible = Boolean(
          document.querySelector("[data-floating-left-panel]")
        );
        leftPanelButton?.click();
        await waitFrame();
        const leftRestored = readPanels();
        composer?.focus();
        await waitFrame();
        const composerFocused = document.activeElement === composer;
        const deviceScale = window.devicePixelRatio || 1;
        const leftHandleAfterRestore = document.querySelector(".left-panel-resizer .resize-handle-right");
        const leftStayOpenDragDistance = -(leftRestored.leftWidth - 180) * deviceScale;
        const leftStayOpenDragStarted = await dragHandle(
          leftHandleAfterRestore,
          leftStayOpenDragDistance
        );
        const leftDragStayedOpen = readPanels();
        const leftCollapseDragDistance = -(leftDragStayedOpen.leftWidth - 96) * deviceScale;
        const leftDragStarted = await dragHandle(leftHandleAfterRestore, leftCollapseDragDistance);
        const leftDragCollapsed = readPanels();
        if (leftDragCollapsed.left === "false") {
          leftPanelButton?.click();
          await waitFrame();
        }
        const leftAfterDragRestore = readPanels();
        const rightHandleAfterLeftRestore = document.querySelector(".right-panel-resizer .resize-handle-left");
        const rightStayOpenDragDistance = (leftAfterDragRestore.rightWidth - 220) * deviceScale;
        const rightStayOpenDragStarted = await dragHandle(
          rightHandleAfterLeftRestore,
          rightStayOpenDragDistance
        );
        const rightDragStayedOpen = readPanels();
        const rightCollapseDragDistance = (rightDragStayedOpen.rightWidth - 140) * deviceScale;
        const rightDragStarted = await dragHandle(
          rightHandleAfterLeftRestore,
          rightCollapseDragDistance
        );
        const rightDragCollapsed = readPanels();
        if (rightDragCollapsed.right === "false") {
          rightPanelButton?.click();
          await waitFrame();
        }
        const dragRestored = readPanels();
        return {
          hasRoot: Boolean(root),
          rootChildCount: root?.childElementCount ?? 0,
          rootTextLength: root?.textContent?.trim().length ?? 0,
          hasPreload: typeof shell?.getShellContext === "function",
          hasRuntimeSupervisorApi: typeof shell?.getRuntimeSupervisorState === "function",
          shellContext: shell?.getShellContext ? await shell.getShellContext() : null,
          runtimeSupervisorState,
          coreThreadReadReady,
          hasRuntimeGate: Boolean(runtimeGate),
          runtimeGateText: runtimeGate?.textContent ?? "",
          ownerStateText: document.querySelector(".owner-state")?.textContent ?? "",
          panelControls: panelButtons.length,
          hasComposer: Boolean(composer),
          composerFocused,
          panelToggleSmoke:
            initialPanels.left === "true" &&
            (rightPanelButton
              ? initialPanels.right === "true" &&
                rightCollapsed.right === "false" &&
                rightRestored.right === "true" &&
                rightFullscreen.right === "true" &&
                rightFullscreen.rightFullscreen === "true" &&
                rightFullscreen.left === initialPanels.left &&
                rightFullscreen.leftWidth === initialPanels.leftWidth &&
                rightFullscreenRestored.rightFullscreen === "false"
              : initialPanels.right === "false" && initialPanels.rightWidth === 0) &&
            leftCollapsed.left === "false" &&
            leftHoverPreviewVisible &&
            leftRestored.left === "true",
          panelDragSmoke:
            leftStayOpenDragStarted &&
            leftDragStarted &&
            leftDragStayedOpen.left === "true" &&
            leftDragCollapsed.left === "false" &&
            leftAfterDragRestore.left === "true" &&
            dragRestored.left === "true" &&
            (rightHandleAfterLeftRestore
              ? rightStayOpenDragStarted &&
                rightDragStarted &&
                rightDragStayedOpen.right === "true" &&
                rightDragCollapsed.right === "false" &&
                dragRestored.right === "true"
              : dragRestored.right === "false" && dragRestored.rightWidth === 0),
          panelStateTrace: {
            initialPanels,
            rightCollapsed,
            rightRestored,
            rightFullscreen,
            rightFullscreenRestored,
            leftCollapsed,
            leftHoverPreviewVisible,
            leftRestored,
            leftDragStayedOpen,
            leftDragCollapsed,
            leftAfterDragRestore,
            rightDragStayedOpen,
            rightDragCollapsed,
            dragRestored
          }
        };
      })();
    `)) as {
      hasRoot: boolean;
      rootChildCount: number;
      rootTextLength: number;
      hasPreload: boolean;
      hasRuntimeSupervisorApi: boolean;
      shellContext: unknown;
      runtimeSupervisorState: {
        canUseLiveRuntime?: boolean;
        failClosed?: boolean;
        services?: { id: string; processState?: string; health?: { state?: string }; admission?: { state?: string } }[];
        lodeAssets?: { state?: string; packageCount?: number };
      } | null;
      coreThreadReadReady: boolean;
      hasRuntimeGate: boolean;
      runtimeGateText: string;
      ownerStateText: string;
      panelControls: number;
      hasComposer: boolean;
      composerFocused: boolean;
      panelToggleSmoke: boolean;
      panelDragSmoke: boolean;
      panelStateTrace: unknown;
    };

    if (!result.hasRoot || result.rootChildCount === 0 || result.rootTextLength === 0) {
      throw new Error("packaged renderer smoke failed: #root is blank.");
    }

    if (!result.hasPreload || result.shellContext === null) {
      throw new Error("packaged renderer smoke failed: preload was not injected.");
    }

    if (
      !result.hasRuntimeSupervisorApi ||
      result.runtimeSupervisorState === null ||
      (!result.coreThreadReadReady && !result.hasRuntimeGate)
    ) {
      throw new Error("packaged renderer smoke failed: runtime supervisor bridge, thread readback, or fail-closed gate is missing.");
    }

    if (
      packagedSmokeRuntimeExpectation === "live_ready" &&
      (!result.runtimeSupervisorState.canUseLiveRuntime ||
        !result.coreThreadReadReady ||
        result.runtimeSupervisorState.lodeAssets?.state !== "ready" ||
        result.runtimeSupervisorState.services?.some((service) => service.health?.state !== "ready") ||
        result.runtimeSupervisorState.services?.some((service) => service.id === "core" && service.admission?.state !== "ready"))
    ) {
      throw new Error(
        `packaged renderer smoke failed: runtime supervisor did not reach live_ready. ${JSON.stringify(result.runtimeSupervisorState)}`,
      );
    }

    if (
      packagedSmokeRuntimeExpectation !== "live_ready" &&
      (!result.runtimeSupervisorState.failClosed ||
        (!result.runtimeGateText.includes("运行环境暂不可用") && !result.ownerStateText.includes("还没有账号身份")))
    ) {
      throw new Error(
        `packaged renderer smoke failed: runtime supervisor fail-closed gate is missing. ${JSON.stringify({
          runtimeSupervisorState: result.runtimeSupervisorState,
          hasRuntimeGate: result.hasRuntimeGate,
          runtimeGateText: result.runtimeGateText,
          ownerStateText: result.ownerStateText,
          coreThreadReadReady: result.coreThreadReadReady,
        })}`,
      );
    }

    if (result.panelControls < 1 || !result.panelToggleSmoke) {
      throw new Error(
        `packaged renderer smoke failed: panel controls did not toggle. ${JSON.stringify({
          panelControls: result.panelControls,
          coreThreadReadReady: result.coreThreadReadReady,
          hasRuntimeGate: result.hasRuntimeGate,
          panelStateTrace: result.panelStateTrace,
        })}`,
      );
    }

    if (
      !result.coreThreadReadReady &&
      !result.ownerStateText.includes("还没有账号身份") &&
      (!result.hasComposer || !result.composerFocused)
    ) {
      throw new Error("packaged renderer smoke failed: composer is missing or cannot receive focus.");
    }

    if (!result.panelDragSmoke) {
      throw new Error(
        `packaged renderer smoke failed: panel drag thresholds did not match Codex behavior. ${JSON.stringify(result.panelStateTrace)}`,
      );
    }

    window.setSize(720, 900);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const packagedViewport = (await window.webContents.executeJavaScript(`({
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    })`)) as { innerWidth: number; scrollWidth: number };
    const packagedWindowWidth = window.getSize()[0];
    if (
      packagedWindowWidth !== 720 ||
      packagedViewport.innerWidth > 720 ||
      packagedViewport.scrollWidth > packagedViewport.innerWidth
    ) {
      throw new Error(
        `packaged renderer smoke failed: 720px production window overflowed. ${JSON.stringify({ packagedWindowWidth, ...packagedViewport })}`,
      );
    }

    if (packagedSmokeScreenshot) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await mkdir(path.dirname(packagedSmokeScreenshot), { recursive: true });
      const image = await window.webContents.capturePage();
      const pixels = image.toBitmap();
      const firstPixel = pixels.subarray(0, 4).toString("hex");
      let hasDifferentPixel = false;

      for (let offset = 4; offset < pixels.length; offset += 4) {
        if (pixels.subarray(offset, offset + 4).toString("hex") !== firstPixel) {
          hasDifferentPixel = true;
          break;
        }
      }

      if (!hasDifferentPixel) {
        throw new Error("packaged renderer smoke failed: captured preview is blank.");
      }

      await writeFile(packagedSmokeScreenshot, image.toPNG());
    }

    const packagedTaskBoundary = packagedSmokeTaskBoundary
      ? await runPackagedTaskBoundarySmoke(window, packagedSmokeCoreEndpoint)
      : null;
    console.log(`WEBSMOKE_RESULT ${JSON.stringify({
      ...result,
      packagedViewport: { windowWidth: packagedWindowWidth, ...packagedViewport, horizontalOverflow: false },
      packagedTaskBoundary,
    })}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

async function applyPackagedSmokeConnectionConfig(window: BrowserWindow) {
  const connectionConfig = JSON.stringify({
    coreEndpoint: packagedSmokeCoreEndpoint,
    harborEndpoint: packagedSmokeHarborEndpoint,
    lodeEndpoint: packagedSmokeLodeEndpoint,
  });
  await window.webContents.executeJavaScript(
    `window.localStorage.setItem(${JSON.stringify(localConnectionStorageKey)}, ${JSON.stringify(connectionConfig)})`,
  );
  await reloadWindow(window);
}

function reloadWindow(window: BrowserWindow) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.webContents.off("did-finish-load", didFinishLoad);
      window.webContents.off("did-fail-load", didFailLoad);
    };
    const didFinishLoad = () => {
      cleanup();
      resolve();
    };
    const didFailLoad = (_event: Electron.Event, _errorCode: number, errorDescription: string) => {
      cleanup();
      reject(new Error(`packaged smoke renderer reload failed: ${errorDescription}`));
    };
    window.webContents.once("did-finish-load", didFinishLoad);
    window.webContents.once("did-fail-load", didFailLoad);
    window.webContents.reload();
  });
}

app.whenReady().then(async () => {
  runtimeSupervisor = createRuntimeSupervisor({ dataDir: path.join(app.getPath("userData"), "runtime") });
  ipcMain.handle("webenvoy:shell-context", () => ({
    platform: process.platform,
    colorScheme: getSystemColorScheme(),
    configScope: "local-ui-only",
  }));
  ipcMain.handle("webenvoy:runtime-supervisor-state", (_event, config) =>
    runtimeSupervisor.readState(config),
  );
  ipcMain.handle("webenvoy:lode-catalog", () => readLodeCatalog());
  ipcMain.handle("webenvoy:owner-api-json", (_event, request) =>
    requestOwnerApiJson(request),
  );
  ipcMain.handle("webenvoy:harbor-manual-authentication-completed", (event, intent) =>
    requestHarborManualAuthenticationCompletion(event, intent),
  );
  await registerWorkbenchIpc(mainWindows, expectedRendererUrl());

  nativeTheme.on("updated", () => {
    const colorScheme = getSystemColorScheme();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("webenvoy:system-theme-variant", colorScheme);
    }
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  runtimeSupervisor.stop();
});

async function requestOwnerApiJson(request: OwnerApiJsonRequest) {
  const parsed = parseOwnerApiRequest(request);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const supervisorToken = isHarborSupervisorProtectedRequest(parsed)
    ? runtimeSupervisor.getHarborRuntimeSupervisorToken(parsed.base)
    : undefined;
  const supervisorAuthorization = harborSupervisorAuthorizationHeader(parsed, supervisorToken);
  if (isHarborSupervisorProtectedRequest(parsed) && !supervisorAuthorization) {
    return { ok: false, error: "Protected Harbor owner API request requires the supervised runtime." };
  }

  const controller = new AbortController();
  const timeoutMs = ownerApiTimeoutMs(parsed);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed.url, {
      method: parsed.method,
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(parsed.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(supervisorAuthorization ? { Authorization: supervisorAuthorization } : {}),
      },
      ...(parsed.body === undefined ? {} : { body: JSON.stringify(parsed.body) }),
      signal: controller.signal,
    });
    const json = await readBoundedJsonResponse(response, ownerApiResponseMaxBytes(parsed.path));
    if (!response.ok) {
      const projectedError = projectOwnerApiError(json);
      const identityMutationError = projectHarborIdentityMutationErrorBody(parsed.path, json);
      return {
        ok: false,
        status: response.status,
        error: `${parsed.path} returned ${response.status}`,
        ...(identityMutationError !== undefined
          ? { body: identityMutationError }
          : projectedError == null ? {} : { body: { error: projectedError } }),
      };
    }
    return { ok: true, status: response.status, body: json ?? {} };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestHarborManualAuthenticationCompletion(event: Electron.IpcMainInvokeEvent, intent: unknown) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    window.isDestroyed() ||
    !mainWindows.has(window) ||
    !isExpectedManualAuthenticationRendererUrl(event.sender.getURL(), expectedRendererUrl())
  ) {
    return { ok: false, error: "Manual authentication completion is unavailable." };
  }
  const parsedIntent = parseManualAuthenticationCompletionIntent(intent);
  if (!parsedIntent) return { ok: false, error: "Manual authentication completion is unavailable." };
  const supervisorToken = runtimeSupervisor.getHarborManualAuthSupervisorToken(parsedIntent.base);
  if (!supervisorToken) return { ok: false, error: "Manual authentication completion is unavailable." };
  const result = await requestManualAuthenticationCompletion({
    ...parsedIntent,
    supervisorToken,
  });
  return result.ok ? result.body : result;
}

function expectedRendererUrl() {
  return rendererDevUrl ?? pathToFileURL(path.join(__dirname, "../dist/renderer/index.html")).toString();
}
