import { pathToFileURL } from "node:url";
import { join } from "node:path";

import {
  createFileRunRecordStore,
  createFileManagedAccessStore,
  createFileSkillLibraryService,
  approvedSkillManifestSha256,
  createManagedBrowserService,
  createManagedRecoveryService,
  createFileAuthorizationDecisionStore,
  createFileExecutionPolicyConfigStore,
  createHttpHarborIdentityFactsReader,
  createHttpHarborRuntimeClient,
  createHttpManagedFileOwnerClient,
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
  const supervisorToken = process.env.WEBENVOY_CORE_SUPERVISOR_TOKEN;
  if (!supervisorToken || !/^[A-Za-z0-9_-]{32,512}$/.test(supervisorToken)) throw new Error("Core requires a supervisor credential before accepting requests.");
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
  const managedFileService = process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createHttpManagedFileOwnerClient({ baseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL, supervisorToken: process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN ?? "" })
    : undefined;
  const harborIdentityFactsReader = process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createHttpHarborIdentityFactsReader({ baseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL })
    : undefined;
  if (runRecordStore && harborRuntimeClient) {
    await recoverInterruptedCoreTaskSessions(runRecordStore, harborRuntimeClient);
  }
  const managedAccessStore = runRecordStore
    ? createFileManagedAccessStore({ directory: process.env.WEBENVOY_MANAGED_ACCESS_DIR ?? `${runRecordStore.directory}.managed-access` })
    : undefined;
  const managedRecoveryService = runRecordStore && process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createManagedRecoveryService({ runRecordStore, harborBaseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL, supervisorToken: process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN ?? "" })
    : undefined;
  const managedBrowserService = managedAccessStore && runRecordStore && authorizationDecisionStore && executionPolicyConfigStore && process.env.WEBENVOY_HARBOR_RUNTIME_URL
    ? createManagedBrowserService({ accessStore: managedAccessStore, runRecordStore, authorizationDecisionStore, executionPolicyConfigStore,
        harborBaseUrl: process.env.WEBENVOY_HARBOR_RUNTIME_URL, supervisorToken: process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN ?? "",
        ...(managedRecoveryService === undefined ? {} : { recoveryService: managedRecoveryService }) })
    : undefined;
  const skillLibraryDirectory = runRecordStore
    ? process.env.WEBENVOY_SKILL_LIBRARY_DIR ?? process.env.WEBENVOY_RUNTIME_DATA_DIR ?? join(runRecordStore.directory, "..", "..")
    : undefined;
  const skillAssetsPath = process.env.WEBENVOY_SKILL_ASSETS_PATH;
  const managedSkillService = managedAccessStore && runRecordStore && skillLibraryDirectory
    ? createFileSkillLibraryService({ accessStore: managedAccessStore, runRecordStore, directory: skillLibraryDirectory,
        trustedManifestSha256: approvedSkillManifestSha256,
        ...(skillAssetsPath === undefined ? {} : { sourceManifestPath: join(skillAssetsPath, "manifest.json") }) })
    : undefined;
  const server = createApiServer({
    supervisorToken,
    ...(managedAccessStore === undefined ? {} : { managedAccessStore }),
    ...(managedBrowserService === undefined ? {} : { managedBrowserService }),
    ...(managedSkillService === undefined ? {} : { managedSkillService }),
    ...(managedRecoveryService === undefined ? {} : { managedRecoveryService }),
    ...(managedFileService === undefined ? {} : { managedFileService }),
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
