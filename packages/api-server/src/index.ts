import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  createFileRunRecordStore,
  createFileManagedAccessStore,
  createFileSkillLibraryService,
  approvedSkillManifestSha256,
  createManagedBrowserService,
  createManagedTaskService,
  createManagedRecoveryService,
  createFileAuthorizationDecisionStore,
  createFileExecutionPolicyConfigStore,
  createHttpHarborIdentityFactsReader,
  createHttpHarborRuntimeClient,
  createHttpManagedFileOwnerClient,
  createLocalLodePackageResolver,
  createLocalTaskTurnInputPolicyResolver,
  createFileAccountSystemDefinitionStore,
  createManagedAccountSystemReadService,
  createFileManagedSiteTaskAdmissionStore,
  approvedManagedSiteTaskPackageFor,
  managedSiteScriptCodeAdmissionRef,
  verifySiteSkillPackageRoot,
  recoverInterruptedCoreTaskSessions,
  ManagedAccessError
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
  const managedAccessHarborUrl = process.env.WEBENVOY_HARBOR_RUNTIME_URL;
  const managedAccessStore = runRecordStore
    ? createFileManagedAccessStore({
        directory: process.env.WEBENVOY_MANAGED_ACCESS_DIR ?? `${runRecordStore.directory}.managed-access`,
        ...(managedAccessHarborUrl === undefined ? {} : {
          withStoppedProfile: async <T>(profileRef: string, operationRef: string, action: () => Promise<T> | T) => {
            const headers = { authorization: `Bearer ${process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN ?? ""}` };
            const reservationRef = `scope:${createHash("sha256").update(operationRef).digest("hex")}`;
            try {
              const response = await fetch(new URL("/runtime/profile-scope-transition-reservations", managedAccessHarborUrl), { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ profile_ref: profileRef, reservation_ref: reservationRef }) });
              const result = await response.json() as { status?: unknown };
              if (!response.ok || result.status !== "held") throw new ManagedAccessError("managed_access_profile_not_stopped");
            } catch (error) {
              if (error instanceof ManagedAccessError) throw error;
              throw new ManagedAccessError("managed_access_profile_state_unavailable");
            }
            let actionFailed = false;
            try {
              return await action();
            } catch (error) {
              actionFailed = true;
              throw error;
            } finally {
              const response = await fetch(new URL(`/runtime/profile-scope-transition-reservations/${encodeURIComponent(reservationRef)}/release`, managedAccessHarborUrl), { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ profile_ref: profileRef }) }).catch(() => null);
              if (!response?.ok && !actionFailed) throw new ManagedAccessError("managed_access_profile_state_unavailable");
            }
          }
        })
    })
    : undefined;
  const runtimeDataRoot = process.env.WEBENVOY_RUNTIME_DATA_DIR;
  const lodeAssetsPath = process.env.WEBENVOY_LODE_ASSETS_PATH;
  const accountSystemDefinitionService = runtimeDataRoot && lodeAssetsPath
    ? createFileAccountSystemDefinitionStore({
        directory: join(runtimeDataRoot, "core", "account-systems"),
        lodeAssetsPath
    })
    : undefined;
  const managedAccountSystemService = managedAccessStore && accountSystemDefinitionService
    ? createManagedAccountSystemReadService({ managedAccessStore, accountSystemDefinitionService })
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
  const managedSiteTaskAdmissionService = runtimeDataRoot && lodeAssetsPath
    ? createFileManagedSiteTaskAdmissionStore({
        directory: join(runtimeDataRoot, "core", "site-task-admissions"),
        managedDataRoot: runtimeDataRoot,
        ...(skillLibraryDirectory === undefined ? {} : { managedMaterializationPaths: [skillLibraryDirectory, join(skillLibraryDirectory, "skill-library")] }),
        runtime: {
          approvedBasePackageFor: approvedManagedSiteTaskPackageFor,
          verifyPackageRoot: verifySiteSkillPackageRoot,
          scriptCodeAdmissionRef: managedSiteScriptCodeAdmissionRef
        }
      })
    : undefined;
  const skillAssetsPath = process.env.WEBENVOY_SKILL_ASSETS_PATH;
  const managedSkillService = managedAccessStore && runRecordStore && skillLibraryDirectory
    ? createFileSkillLibraryService({ accessStore: managedAccessStore, runRecordStore, directory: skillLibraryDirectory,
        trustedManifestSha256: approvedSkillManifestSha256,
        ...(process.env.WEBENVOY_LODE_ASSETS_PATH === undefined ? {} : { lodeAssetsPath: process.env.WEBENVOY_LODE_ASSETS_PATH }),
        ...(managedSiteTaskAdmissionService === undefined ? {} : { managedSiteTaskAdmissionStore: managedSiteTaskAdmissionService }),
        ...(skillAssetsPath === undefined ? {} : { sourceManifestPath: join(skillAssetsPath, "manifest.json") }) })
    : undefined;
  const ownerUid = Number(process.env.WEBENVOY_SITE_WORKER_OWNER_UID);
  const agentUid = Number(process.env.WEBENVOY_SITE_WORKER_AGENT_UID);
  const workerMode = process.env.WEBENVOY_SITE_WORKER_MODE;
  const ownerSocketAcl = process.env.WEBENVOY_SITE_WORKER_OWNER_SOCKET_ACL;
  const workerIdentity = Number.isSafeInteger(ownerUid) && ownerUid > 0 && Number.isSafeInteger(agentUid) && agentUid > 0 &&
      (workerMode === "trusted_local" || workerMode === "distinct_uid_hardened") && typeof ownerSocketAcl === "string"
    ? { owner_uid: ownerUid, agent_uid: agentUid, mode: workerMode, owner_socket_acl: ownerSocketAcl }
    : undefined;
  const managedTaskService = managedAccessStore && runRecordStore && managedSkillService
    ? createManagedTaskService({ accessStore: managedAccessStore, runRecordStore, skillLibraryService: managedSkillService,
        ...(managedBrowserService === undefined ? {} : { managedBrowserService }),
        ...(accountSystemDefinitionService === undefined ? {} : { accountSystemDefinitionService }),
        ...(workerIdentity === undefined ? {} : { workerIdentity }) })
    : undefined;
  const server = createApiServer({
    supervisorToken,
    ...(accountSystemDefinitionService === undefined ? {} : { accountSystemDefinitionService }),
    ...(managedAccountSystemService === undefined ? {} : { managedAccountSystemService }),
    ...(managedSiteTaskAdmissionService === undefined ? {} : { siteTaskAdmissionService: managedSiteTaskAdmissionService }),
    ...(managedAccessStore === undefined ? {} : { managedAccessStore }),
    ...(managedBrowserService === undefined ? {} : { managedBrowserService }),
    ...(managedSkillService === undefined ? {} : { managedSkillService }),
    ...(managedTaskService === undefined ? {} : { managedTaskService }),
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
