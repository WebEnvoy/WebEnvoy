import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, safeStorage } from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules/vite/bin/vite.js");
const nodeBin = process.env.npm_node_execpath ?? "node";
app.commandLine.appendSwitch("force-prefers-reduced-motion");
if (process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
const ipcUserData = mkdtempSync(path.join(os.tmpdir(), "webenvoy-workbench-ipc-"));
app.setPath("userData", ipcUserData);
const electronReady = app.whenReady();
let vite;
let window;
let preloadProbe;

function stage(message) {
  process.stderr.write(`[workbench-dom] ${message}\n`);
}

function withTimeout(promise, label, timeoutMs = 30_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForVite(url, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (vite.exitCode != null) throw new Error(`Vite exited early.\n${stderr()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${stderr()}`);
}

async function runRendererCheck(expression, label) {
  const result = await window.webContents.executeJavaScript(`Promise.resolve().then(() => ${expression}).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
  )`, true);
  if (!result.ok) throw new Error(`${label} failed: ${result.stack ?? result.message}`);
  return result.value;
}

async function run() {
  if (process.env.WEBENVOY_WORKBENCH_DOM_FORCE_FAILURE === "1") {
    throw new Error("Forced workbench DOM smoke failure.");
  }
  stage("waiting for Electron ready");
  await withTimeout(electronReady, "Electron ready", 10_000);
  await checkProtectedStorageBackend();
  stage("reserving port");
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let viteStderr = "";
  vite = spawn(nodeBin, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  vite.stderr.setEncoding("utf8");
  vite.stderr.on("data", (chunk) => { viteStderr += chunk; });
  stage(`starting Vite on ${port}`);
  await withTimeout(waitForVite(baseUrl, () => viteStderr), "Vite startup");
  stage("creating BrowserWindow");

  window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") stage(`renderer error: ${details.message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    stage(`renderer process gone: ${details.reason}`);
  });
  stage("BrowserWindow created");
  const navigationModule = await import(pathToFileURL(path.join(root, "dist-electron/rendererNavigationGuard.js")).href);
  const workbenchIpcModule = await import(pathToFileURL(path.join(root, "dist-electron/workbenchIpc.js")).href);
  const mainWindows = new Set([window]);
  await workbenchIpcModule.registerWorkbenchIpc(mainWindows, baseUrl, {
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  navigationModule.secureRendererNavigation(window.webContents, baseUrl);
  stage("loading harness");
  await withTimeout(
    window.loadURL(`${baseUrl}/tests/renderer/workbench-dom.html`),
    "Workbench harness load",
  );
  await checkRendererSecurityBoundary(baseUrl);
  await checkPreloadIpcBoundary(baseUrl, mainWindows);

  stage("running desktop checks");
  const desktop = await withTimeout(
    runRendererCheck("window.__runWorkbenchDomSmoke('desktop')", "Desktop DOM checks"),
    "Desktop DOM checks",
  );
  stage("resizing to 720x900");
  window.setContentSize(720, 900);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const narrow = await withTimeout(
    runRendererCheck("window.__runWorkbenchDomSmoke('narrow')", "Narrow DOM checks"),
    "Narrow DOM checks",
  );
  stage("loading Library harness");
  window.setContentSize(1200, 900);
  await withTimeout(
    window.loadURL(`${baseUrl}/tests/renderer/library-dom.html`),
    "Library harness load",
  );
  const libraryDesktop = await withTimeout(
    runRendererCheck("window.__runLibraryDomSmoke('desktop')", "Library desktop DOM checks"),
    "Library desktop DOM checks",
  );
  window.setContentSize(1200, 900);
  window.webContents.setZoomFactor(2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await withTimeout(
    window.loadURL(`${baseUrl}/tests/renderer/library-dom.html`),
    "Library narrow harness reload",
  );
  const libraryNarrow = await withTimeout(
    runRendererCheck("window.__runLibraryDomSmoke('narrow')", "Library narrow DOM checks"),
    "Library narrow DOM checks",
  );
  if (window.webContents.getZoomFactor() !== 2) throw new Error("Library narrow checks did not run at 200% zoom.");
  window.webContents.setZoomFactor(1);
  window.setContentSize(1200, 900);
  await withTimeout(
    window.loadURL(`${baseUrl}/tests/renderer/library-dom.html?stale=1`),
    "Library stale harness load",
  );
  const libraryStale = await withTimeout(
    runRendererCheck("window.__runLibraryDomSmoke('stale')", "Library stale DOM checks"),
    "Library stale DOM checks",
  );
  stage("loading production shell harness");
  window.webContents.setZoomFactor(2);
  await withTimeout(
    window.loadURL(`${baseUrl}/tests/renderer/library-dom.html?production=1`),
    "Production shell harness load",
  );
  const productionShell = await withTimeout(
    runRendererCheck("window.__runLibraryDomSmoke('production')", "Production shell DOM checks"),
    "Production shell DOM checks",
  );
  if (window.webContents.getZoomFactor() !== 2) throw new Error("Production shell checks did not run at 200% zoom.");
  window.webContents.setZoomFactor(1);
  window.setContentSize(1200, 900);
  await withTimeout(window.loadURL(`${baseUrl}/tests/renderer/identity-dom.html`), "Identity desktop harness load");
  const identityDesktop = await withTimeout(
    runRendererCheck("window.__runIdentityDomSmoke('desktop')", "Identity desktop DOM checks"),
    "Identity desktop DOM checks",
  );
  window.setContentSize(720, 900);
  await withTimeout(window.loadURL(`${baseUrl}/tests/renderer/identity-dom.html`), "Identity narrow harness load");
  const identityNarrow = await withTimeout(
    runRendererCheck("window.__runIdentityDomSmoke('narrow')", "Identity narrow DOM checks"),
    "Identity narrow DOM checks",
  );
  stage("checks passed");
  process.stdout.write(`${JSON.stringify({ desktop, narrow, libraryDesktop, libraryNarrow, libraryStale, productionShell, identityDesktop, identityNarrow }, null, 2)}\n`);
}

async function checkRendererSecurityBoundary(baseUrl) {
  const { authorizedWorkbenchWindow } = await import(pathToFileURL(path.join(root, "dist-electron/workbenchIpc.js")).href);
  const windows = new Set([window]);
  if (authorizedWorkbenchWindow(window.webContents, windows, baseUrl) !== window ||
    authorizedWorkbenchWindow(window.webContents, windows, "https://unexpected.example") !== null) {
    throw new Error("Workbench IPC renderer binding did not reject an unexpected source.");
  }
  const popupOpened = await window.webContents.executeJavaScript("window.open('https://unexpected.example') !== null", true);
  if (popupOpened) throw new Error("Renderer opened an untrusted child window.");
  const trustedUrl = window.webContents.getURL();
  await window.webContents.executeJavaScript("location.assign('https://unexpected.example')", true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (window.webContents.getURL() !== trustedUrl) throw new Error("Renderer navigated away from its trusted source.");
}

async function checkPreloadIpcBoundary(baseUrl, mainWindows) {
  preloadProbe = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(root, "dist-electron/preload.cjs"),
    },
  });
  mainWindows.add(preloadProbe);
  await withTimeout(preloadProbe.loadURL(`${baseUrl}/tests/renderer/preload-ipc.html`), "Preload IPC probe load");
  const result = await preloadProbe.webContents.executeJavaScript(`(async () => {
    const shell = window.webenvoyShell;
    if (shell == null || typeof shell.releaseLocalFiles !== "function") return { exposed: false };
    const pathResult = await shell.releaseLocalFiles(["/tmp/not-an-opaque-ref"]);
    const unknownRefResult = await shell.releaseLocalFiles(["local_file_ref_00000000-0000-4000-8000-000000000099"]);
    return { exposed: true, pathStatus: pathResult.status, unknownRefStatus: unknownRefResult.status };
  })()`, true);
  const expectedPathStatuses = new Set(["rejected"]);
  const expectedUnknownStatuses = new Set(["ready"]);
  if (!result.exposed || !expectedPathStatuses.has(result.pathStatus) || !expectedUnknownStatuses.has(result.unknownRefStatus)) {
    throw new Error(`Preload IPC release boundary failed: ${JSON.stringify(result)}`);
  }
}

async function checkProtectedStorageBackend() {
  const [{ createProtectedStorageCodec }, { ProtectedWorkbenchStore }] = await Promise.all([
    import(pathToFileURL(path.join(root, "dist-electron/workbenchIpc.js")).href),
    import(pathToFileURL(path.join(root, "dist-electron/protectedWorkbenchStore.js")).href),
  ]);
  const syntheticBasicText = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: () => { throw new Error("basic_text must not encrypt protected drafts"); },
    decryptString: () => { throw new Error("basic_text must not decrypt protected drafts"); },
  };
  if (createProtectedStorageCodec(syntheticBasicText) !== null) throw new Error("Synthetic basic_text backend did not fail closed.");
  const syntheticLegacyBackend = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  };
  if ((createProtectedStorageCodec(syntheticLegacyBackend) == null) !== (process.platform === "linux")) {
    throw new Error("Legacy safeStorage backend handling did not follow the platform boundary.");
  }
  if (process.platform !== "linux") return;
  if (typeof safeStorage.getSelectedStorageBackend === "function" && safeStorage.getSelectedStorageBackend() !== "basic_text") {
    throw new Error("Linux basic_text test backend was not selected.");
  }
  const store = await ProtectedWorkbenchStore.open(path.join(app.getPath("temp"), "webenvoy-basic-text-probe.bin"), createProtectedStorageCodec());
  if (store.available) throw new Error("Linux basic_text backend enabled protected draft persistence.");
}

async function cleanup(exitCode) {
  process.exitCode = exitCode;
  if (vite && vite.exitCode == null) {
    vite.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => vite.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (vite.exitCode == null) vite.kill("SIGKILL");
  }
  if (preloadProbe && !preloadProbe.isDestroyed()) preloadProbe.destroy();
  if (window && !window.isDestroyed()) window.destroy();
  rmSync(ipcUserData, { recursive: true, force: true });
  process.exit(exitCode);
}

void withTimeout(run(), "Electron DOM smoke", 60_000)
  .then(() => cleanup(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    return cleanup(1);
  });
