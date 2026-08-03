import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const maxLodeAssetFileBytes = 2 * 1024 * 1024;
const maxLodeCatalogBytes = 16 * 1024 * 1024;

export type LodeReadBudget = { remainingBytes: number };

export class LodeReadBudgetExceededError extends Error {}

export function createLodeCatalogReadBudget(): LodeReadBudget {
  return { remainingBytes: maxLodeCatalogBytes };
}

export function resolveLodeAssetPath(rootPath: string, value: string, basePath = rootPath) {
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`Unsafe Lode package path: ${value}`);
  }
  if (lstatSync(rootPath).isSymbolicLink()) {
    throw new Error(`Symlinked Lode asset root: ${rootPath}`);
  }

  const root = realpathSync(rootPath);
  const candidatePath = path.resolve(realpathSync(basePath), value);
  const lexicalRelative = path.relative(root, candidatePath);
  if (lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Unsafe Lode package path: ${value}`);
  }

  let currentPath = root;
  for (const segment of lexicalRelative.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    if (lstatSync(currentPath).isSymbolicLink()) {
      throw new Error(`Symlinked Lode package path: ${value}`);
    }
  }

  const candidate = realpathSync(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe Lode package path: ${value}`);
  }
  return candidate;
}

export function readLodeJsonObject(filePath: string, budget?: LodeReadBudget): Record<string, unknown> {
  return readLodeJson(filePath, budget).value;
}

export function readLodeJsonObjectSha256(filePath: string, budget?: LodeReadBudget) {
  const result = readLodeJson(filePath, budget);
  return createHash("sha256").update(result.bytes).digest("hex");
}

function readLodeJson(filePath: string, budget?: LodeReadBudget) {
  const bytes = readLodeBytes(filePath, budget);
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(value)) throw new Error(`Invalid Lode JSON object: ${filePath}`);
  return { value, bytes };
}

function readLodeBytes(filePath: string, budget?: LodeReadBudget) {
  if (!lstatSync(filePath).isFile()) throw new Error(`Non-file Lode asset: ${filePath}`);
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error(`Non-file Lode asset: ${filePath}`);
    const size = stats.size;
    if (size > maxLodeAssetFileBytes) throw new Error(`Oversized Lode asset: ${filePath}`);
    const contents = Buffer.allocUnsafe(maxLodeAssetFileBytes + 1);
    const bytesRead = readSync(descriptor, contents, 0, contents.length, 0);
    if (bytesRead > maxLodeAssetFileBytes) throw new Error(`Oversized Lode asset: ${filePath}`);
    if (budget != null) {
      if (bytesRead > budget.remainingBytes) {
        throw new LodeReadBudgetExceededError("Lode catalog exceeds the supported read budget.");
      }
      budget.remainingBytes -= bytesRead;
    }
    return contents.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
