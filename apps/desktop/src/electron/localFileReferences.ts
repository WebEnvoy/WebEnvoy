import { dialog, type BrowserWindow } from "electron";
import { access, lstat, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import type { ProtectedWorkbenchStore } from "./protectedWorkbenchStore.js";

const maxLocalFileReferences = 32;
const maxLocalPathLength = 4096;
const localRefPattern = /^local_file_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalFileReference = {
  localRef: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
};

export async function selectLocalFileReferences(window: BrowserWindow, store: ProtectedWorkbenchStore): Promise<LocalFileReference[]> {
  const selection = await dialog.showOpenDialog(window, {
    title: "选择附件",
    properties: ["openFile", "multiSelections"],
  });
  if (selection.canceled) return [];
  const paths = selection.filePaths.slice(0, maxLocalFileReferences);
  return (await Promise.all(paths.map((filePath) => projectLocalFileReference(filePath, store)))).filter((item): item is LocalFileReference => item != null);
}

export async function checkLocalFileReferences(value: unknown, store: ProtectedWorkbenchStore) {
  if (!Array.isArray(value) || value.length > maxLocalFileReferences) return [];
  return Promise.all(value.map(async (item) => {
    const localRef = typeof item === "string" && localRefPattern.test(item) ? item : null;
    if (localRef == null) {
      return { localRef: localRef ?? "", readable: false, reason: "invalid_reference" as const };
    }
    return { localRef, ...(await store.checkLocalRef(localRef)) };
  }));
}

async function projectLocalFileReference(filePath: string, store: ProtectedWorkbenchStore): Promise<LocalFileReference | null> {
  const normalizedPath = validLocalPath(filePath);
  if (normalizedPath == null) return null;
  try {
    const fileStats = await stat(normalizedPath);
    const link = await lstat(normalizedPath);
    if (!fileStats.isFile() || link.isSymbolicLink()) return null;
    await access(normalizedPath, constants.R_OK);
    const metadata = {
      path: normalizedPath,
      name: path.basename(normalizedPath).slice(0, 255),
      size: fileStats.size,
      lastModified: Math.floor(fileStats.mtimeMs),
      type: "",
    };
    const localRef = await store.registerFile(metadata);
    if (localRef == null) return null;
    return {
      localRef,
      name: metadata.name,
      size: metadata.size,
      lastModified: metadata.lastModified,
      type: metadata.type,
    };
  } catch {
    return null;
  }
}

function validLocalPath(value: unknown) {
  return typeof value === "string" && path.isAbsolute(value) && value.length > 0 &&
    value.length <= maxLocalPathLength && !value.includes("\0") ? path.normalize(value) : null;
}
