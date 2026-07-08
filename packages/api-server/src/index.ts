import { pathToFileURL } from "node:url";

import { createFileRunRecordStore, createHttpHarborRuntimeClient, createLocalLodePackageResolver } from "@webenvoy/core-runtime";

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
  const server = createApiServer(
    process.env.WEBENVOY_RUN_RECORD_DIR
      ? {
          runRecordStore: createFileRunRecordStore({ directory: process.env.WEBENVOY_RUN_RECORD_DIR }),
          ...(process.env.WEBENVOY_LODE_REGISTRY_PATH === undefined
            ? {}
            : { lodePackageResolver: createLocalLodePackageResolver({ registryPath: process.env.WEBENVOY_LODE_REGISTRY_PATH }) }),
          ...(process.env.WEBENVOY_HARBOR_RUNTIME_URL === undefined
            ? {}
            : { harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL }) })
        }
      : {}
  );

  server.listen(port, () => {
    console.log(`WebEnvoy API Server listening on http://127.0.0.1:${port}`);
  });
}
