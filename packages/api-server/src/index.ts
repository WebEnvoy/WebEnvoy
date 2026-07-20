import { pathToFileURL } from "node:url";
import { join } from "node:path";

import {
  createFileRunRecordStore,
  createHttpHarborRuntimeClient,
  createLocalLodePackageResolver,
  recoverInterruptedCoreTaskSessions
} from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";

import { createApiServer } from "./server.js";

export { createApiServer } from "./server.js";

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (import.meta.url === entrypoint) {
  const port = parsePort(process.env.PORT);
  const runRecordStore = process.env.WEBENVOY_RUN_RECORD_DIR
    ? createFileRunRecordStore({ directory: process.env.WEBENVOY_RUN_RECORD_DIR })
    : undefined;
  const taskThreadStore = runRecordStore
    ? createFileTaskThreadStore({
        directory: process.env.WEBENVOY_TASK_THREAD_DIR ?? join(runRecordStore.directory, "threads"),
        runRecordStore
      })
    : undefined;
  const harborRuntimeClient = process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createHttpHarborRuntimeClient({ baseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL })
    : undefined;
  if (runRecordStore && harborRuntimeClient) {
    await recoverInterruptedCoreTaskSessions(runRecordStore, harborRuntimeClient);
  }
  const server = createApiServer(runRecordStore ? {
    runRecordStore,
    ...(taskThreadStore === undefined ? {} : { taskThreadStore }),
    ...(process.env.WEBENVOY_LODE_REGISTRY_PATH === undefined
      ? {}
      : { lodePackageResolver: createLocalLodePackageResolver({ registryPath: process.env.WEBENVOY_LODE_REGISTRY_PATH }) }),
    ...(harborRuntimeClient === undefined ? {} : { harborRuntimeClient })
  } : {});

  server.listen(port, () => {
    console.log(`WebEnvoy API Server listening on http://127.0.0.1:${port}`);
  });
}
