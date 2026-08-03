import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import path from "node:path";

import { isExpectedManualAuthenticationRendererUrl } from "./manualAuthenticationCompletion.js";
import { checkLocalFileReferences, selectLocalFileReferences } from "./localFileReferences.js";
import { ProtectedWorkbenchStore, type ProtectedStorageCodec } from "./protectedWorkbenchStore.js";

type SafeStorageLike = Pick<typeof safeStorage, "decryptString" | "encryptString" | "isEncryptionAvailable"> &
  Partial<Pick<typeof safeStorage, "getSelectedStorageBackend">>;

export function createProtectedStorageCodec(storage: SafeStorageLike = safeStorage): ProtectedStorageCodec | null {
  const backend = storage.getSelectedStorageBackend?.();
  return storage.isEncryptionAvailable() && backend !== "basic_text" && !(process.platform === "linux" && backend == null)
    ? { encrypt: (value) => storage.encryptString(value), decrypt: (value) => storage.decryptString(value) }
    : null;
}

export async function registerWorkbenchIpc(
  mainWindows: Set<BrowserWindow>,
  expectedRendererUrl: string,
  codec: ProtectedStorageCodec | null = createProtectedStorageCodec(),
) {
  const store = await ProtectedWorkbenchStore.open(
    path.join(app.getPath("userData"), "protected-workbench.bin"),
    codec,
  );

  ipcMain.handle("webenvoy:select-local-files", (event) => {
    const window = authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl);
    if (window == null) return { status: "rejected", files: [] };
    if (!store.available) return { status: "unavailable", files: [] };
    return selectLocalFileReferences(window, store).then((files) => ({ status: "ready", files }));
  });
  ipcMain.handle("webenvoy:check-local-files", (event, localRefs) =>
    authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null ? [] : checkLocalFileReferences(localRefs, store),
  );
  ipcMain.handle("webenvoy:release-local-files", async (event, localRefs) =>
    authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null
      ? { status: "rejected" }
      : !store.available ? { status: "unavailable" } : { status: await store.releaseLocalRefs(localRefs) ? "ready" : "rejected" },
  );
  ipcMain.handle("webenvoy:load-protected-draft", (event, context) =>
    authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null
      ? { status: "rejected" }
      : store.available ? { status: "ready", draft: store.loadDraft(context) } : { status: "unavailable" },
  );
  ipcMain.handle("webenvoy:save-protected-draft", async (event, draft) =>
    authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null
      ? { status: "rejected" }
      : !store.available ? { status: "unavailable" } : { status: await store.saveDraft(draft) ? "ready" : "rejected" },
  );
  ipcMain.handle("webenvoy:delete-protected-draft", async (event, context) =>
    authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null
      ? { status: "rejected" }
      : !store.available ? { status: "unavailable" } : { status: await store.deleteDraft(context) ? "ready" : "rejected" },
  );
  ipcMain.handle("webenvoy:seal-protected-input", async (event, draft) => {
    if (authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null) return { status: "rejected" };
    if (!store.available) return { status: "unavailable" };
    const refs = await store.sealInput(draft);
    return refs == null ? { status: "rejected" } : { status: "ready", refs };
  });
  ipcMain.handle("webenvoy:release-protected-inputs", async (event, ownerRefs) =>
    authorizedWorkbenchWindow(event.sender, mainWindows, expectedRendererUrl) == null
      ? { status: "rejected" }
      : !store.available ? { status: "unavailable" } : { status: await store.releaseSealedInputs(ownerRefs) ? "ready" : "rejected" },
  );
}

export function authorizedWorkbenchWindow(
  sender: Electron.WebContents,
  mainWindows: Set<BrowserWindow>,
  expectedRendererUrl: string,
) {
  const window = BrowserWindow.fromWebContents(sender);
  return window != null && mainWindows.has(window) &&
    isExpectedManualAuthenticationRendererUrl(sender.getURL(), expectedRendererUrl) ? window : null;
}
