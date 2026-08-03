import type { BrowserWindow } from "electron";

export type PackagedTaskBoundarySmokeResult = {
  lodeActionDeclared: boolean;
  effectivePolicyStatus: number;
  effectivePolicyReady: boolean;
  threadCreateStatus: number;
  firstTurnSubmitStatus: number;
  firstTurnRecorded: boolean;
  firstTurnStatus: string;
  firstTurnFailureCode: string;
};

export async function runPackagedTaskBoundarySmoke(
  window: BrowserWindow,
  coreEndpoint: string,
): Promise<PackagedTaskBoundarySmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const shell = window.webenvoyShell;
      if (!shell?.getLodeCatalog || !shell.requestOwnerJson) {
        throw new Error("Packaged task boundary smoke requires the App owner bridges.");
      }

      const coreEndpoint = ${JSON.stringify(coreEndpoint)};
      const packageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
      const capabilityRef = "lode:capability/search-notes";
      const identityRef = "identity-env_000000000000000000000239";
      const catalog = await shell.getLodeCatalog();
      const skill = catalog?.skills?.find((candidate) => candidate.packageRef === packageRef);
      const action = skill?.actions?.[0];
      const lodeActionDeclared = catalog?.status === "ready" && skill?.actions?.length === 1 &&
        action?.category === "read" && action.operationMode === "read" && action.externalEffects?.length === 0;
      if (!lodeActionDeclared) throw new Error("Packaged Lode read action declaration is unavailable.");

      const effectivePolicy = await shell.requestOwnerJson({
        base: coreEndpoint,
        path: "/execution-policies/effective?skill_ref=" + encodeURIComponent(packageRef),
        method: "GET"
      });
      const effectiveActions = effectivePolicy?.body?.execution_policy?.actions;
      const effectivePolicyReady = effectivePolicy?.ok === true && effectivePolicy.status === 200 &&
        Array.isArray(effectiveActions) && effectiveActions.some((candidate) =>
          candidate.action_id === action.id && candidate.category === action.category && candidate.effective_policy != null
        );
      if (!effectivePolicyReady) throw new Error("Core effective execution policy is unavailable for the packaged Lode action.");

      const created = await shell.requestOwnerJson({
        base: coreEndpoint,
        path: "/threads",
        method: "POST",
        body: { capability_ref: capabilityRef, identity_environment_ref: identityRef }
      });
      const threadId = created?.body?.thread?.thread_id;
      if (created?.ok !== true || created.status !== 201 || typeof threadId !== "string") {
        throw new Error("App owner bridge could not create the packaged smoke task thread.");
      }

      const targetUrl = "https://www.xiaohongshu.com/search_result?keyword=packaged-smoke";
      const submitted = await shell.requestOwnerJson({
        base: coreEndpoint,
        path: "/threads/" + encodeURIComponent(threadId) + "/turns",
        method: "POST",
        body: {
          idempotency_key: "app-packaged-boundary-turn-239",
          run_id: "app-packaged-boundary-239",
          input_snapshot: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [
              { field_id: "url", kind: "long_text", owner_ref: "owner:packaged-smoke-url" },
              { field_id: "keyword", kind: "long_text", owner_ref: "owner:packaged-smoke-keyword" },
              { field_id: "limit", kind: "scalar", summary: "1" }
            ],
            attachment_refs: [],
            consumer_boundary: "Core stores bounded field summaries and owner refs only; raw content remains with its owner."
          },
          package_ref: packageRef,
          public_query: { query: "packaged-smoke" },
          task_intent: {
            schema_version: "webenvoy.task-intent.v0",
            intent_id: "intent_app-packaged-boundary-239",
            entrypoint: "app",
            user_intent: { summary: "Verify the packaged structured first-turn boundary." },
            capability: {
              ref: capabilityRef,
              version: skill.version,
              source_ref: packageRef,
              ...(skill.lockRef ? { lock_ref: skill.lockRef } : {})
            },
            input: { summary: "Search notes with packaged structured input.", refs: [targetUrl] },
            scope: { target_type: action.targetTypes[0], target_ref: targetUrl },
            policy: { risk: "read", execution_intent: "read", timeout_ms: 60000 },
            resource_requirement_refs: [action.resourceRequirementRef],
            resource_requirement_profile_id: action.resourceRequirementProfileIds[0],
            evidence_policy_ref: "policy:no-raw-evidence"
          },
          harbor: { identity_environment_ref: identityRef, url: targetUrl, reuse_existing: true }
        }
      });
      if (submitted?.ok !== false || submitted.status !== 503) {
        throw new Error("The packaged boundary probe must fail closed before any Harbor session or site access: " + JSON.stringify(submitted));
      }

      const readback = await shell.requestOwnerJson({
        base: coreEndpoint,
        path: "/threads/" + encodeURIComponent(threadId),
        method: "GET"
      });
      const turn = readback?.body?.thread?.turns?.find((candidate) =>
        candidate.idempotency_key === "app-packaged-boundary-turn-239"
      );
      const firstTurnRecorded = readback?.ok === true && readback.status === 200 &&
        turn?.submission_state === "accepted" && turn.status === "waiting_for_user" &&
        turn.failure_code === "identity_environment_missing";
      if (!firstTurnRecorded) {
        throw new Error("Core did not retain the fail-closed packaged first-turn attempt: " + JSON.stringify({ readback, turn }));
      }

      return {
        lodeActionDeclared,
        effectivePolicyStatus: effectivePolicy.status,
        effectivePolicyReady,
        threadCreateStatus: created.status,
        firstTurnSubmitStatus: submitted.status,
        firstTurnRecorded,
        firstTurnStatus: turn.status,
        firstTurnFailureCode: turn.failure_code
      };
    })();
  `)) as PackagedTaskBoundarySmokeResult;

  return result;
}
