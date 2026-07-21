import { pathToFileURL } from "node:url";
import { join } from "node:path";

import {
  createFileRunRecordStore,
  createFileAuthorizationDecisionStore,
  createFileExecutionPolicyConfigStore,
  createHttpHarborIdentityFactsReader,
  createHttpHarborRuntimeClient,
  createLocalLodePackageResolver,
  createLocalTaskTurnInputPolicyResolver,
  recoverInterruptedCoreTaskSessions
} from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";

import { createApiServer } from "./server.js";

export { createApiServer } from "./server.js";

export const apiServerHost = "127.0.0.1";

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
  const lodeRegistryPath = process.env.WEBENVOY_LODE_REGISTRY_PATH;
  const taskThreadStore = runRecordStore
    ? createFileTaskThreadStore({
        directory: process.env.WEBENVOY_TASK_THREAD_DIR ?? join(runRecordStore.directory, "threads"),
        runRecordStore,
        ...(lodeRegistryPath === undefined
          ? {}
          : { resolveInputPolicy: createLocalTaskTurnInputPolicyResolver({ registryPath: lodeRegistryPath }) })
      })
    : undefined;
  const authorizationDecisionStore = runRecordStore
    ? createFileAuthorizationDecisionStore({
        directory: process.env.WEBENVOY_AUTHORIZATION_DECISION_DIR ?? `${runRecordStore.directory}.authorization-decisions`,
        runRecordStore,
        ...(taskThreadStore === undefined ? {} : { taskThreadStore })
      })
    : undefined;
  const executionPolicyConfigStore = runRecordStore
    ? createFileExecutionPolicyConfigStore({
        directory: process.env.WEBENVOY_EXECUTION_POLICY_DIR ?? `${runRecordStore.directory}.execution-policies`
      })
    : undefined;
  const harborRuntimeClient = process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createHttpHarborRuntimeClient({ baseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL })
    : undefined;
  const harborIdentityFactsReader = process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createHttpHarborIdentityFactsReader({ baseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL })
    : undefined;
  if (runRecordStore && harborRuntimeClient) {
    await recoverInterruptedCoreTaskSessions(runRecordStore, harborRuntimeClient);
  }
  const server = createApiServer({
    ...(runRecordStore === undefined ? {} : { runRecordStore }),
    ...(authorizationDecisionStore === undefined ? {} : { authorizationDecisionStore }),
    ...(executionPolicyConfigStore === undefined ? {} : { executionPolicyConfigStore }),
    ...(taskThreadStore === undefined ? {} : { taskThreadStore }),
    ...(lodeRegistryPath === undefined
      ? {}
      : { lodePackageResolver: createLocalLodePackageResolver({ registryPath: lodeRegistryPath }) }),
    ...(harborIdentityFactsReader === undefined ? {} : { harborIdentityFactsReader }),
    ...(harborRuntimeClient === undefined ? {} : { harborRuntimeClient })
  });

  server.listen(port, apiServerHost, () => {
    console.log(`WebEnvoy API Server listening on http://${apiServerHost}:${port}`);
  });
}
