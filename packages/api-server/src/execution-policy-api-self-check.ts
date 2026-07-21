import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileAuthorizationDecisionStore,
  createFileExecutionPolicyConfigStore,
  createFileRunRecordStore,
  evaluateExecutionPolicy,
  executionPolicyMutationSchemaVersion,
  matchLodeBusinessActionOwner,
  singleActionDecisionCommandSchemaVersion,
  taskTurnInputSchemaVersion,
  type LodePackageResolver
} from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";

import { createApiServer } from "./server.js";
import { handleExecutionPolicyApi } from "./execution-policy-api.js";

function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function request(
  port: number,
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
  contentType = "application/json"
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": contentType },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: asRecord(await response.json()) };
}

const skillRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const environmentAuthorizationSubject = { scope: "environment", operation_ref: "harbor-operation:policy-api/1" } as const;

function authorizationEvaluationInput(input: {
  evaluatedAt: string;
  policyRef: string;
  policyVersion: string;
  actionInstance: string;
  singleAction?: Record<string, unknown>;
}) {
  const proof = matchLodeBusinessActionOwner({
    package_ref: skillRef,
    version: "0.1.0",
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: "xhs_search_notes",
        category: "read",
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["search_results_page"],
          supported_origins: ["https://www.xiaohongshu.com"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: "xiaohongshu.search-notes.resources",
          profile_ids: ["search-notes-ready"]
        },
        external_effects: []
      }]
    }
  }, "xhs_search_notes", {
    schema_version: "webenvoy.harbor-resource-match.v0",
    match_ref: "resource-match:policy-api/1",
    match_version: "1",
    matched_requirement_refs: ["xiaohongshu.search-notes.resources"]
  });
  assert(proof);
  return {
    caller: "api" as const,
    evaluated_at: input.evaluatedAt,
    action: {
      action_instance_ref: input.actionInstance,
      action_id: "xhs_search_notes",
      target: {
        target_ref: "target:xhs-search/policy-api",
        target_type: "search_results_page",
        site_slug: "xiaohongshu",
        origin: "https://www.xiaohongshu.com"
      }
    },
    owner_proof: proof,
    context: {},
    policies: {
      ...(input.singleAction === undefined ? {} : { single_action_decision: input.singleAction }),
      global_user_config: {
        source_ref: input.policyRef,
        source_version: input.policyVersion,
        modes: { read: "confirm" as const }
      }
    }
  };
}

const lodePackageResolver: LodePackageResolver = async ({ package_ref }) => package_ref === skillRef ? {
  package_ref,
  source_ref: package_ref,
  capability_id: "search-notes",
  operation_id: "xhs_search_notes",
  operation_mode: "read",
  version: "0.1.0",
  action_declaration: {
    schema_version: "lode.capability-action-declaration.v0",
    schema_ref: "lode://schema/capability-action-declaration@0.1.0",
    actions: [
      {
        action_id: "xhs_search_notes",
        category: "read",
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["search_results_page"],
          supported_origins: ["https://www.xiaohongshu.com"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: "xiaohongshu.search-notes.resources",
          profile_ids: ["search-notes-ready"]
        },
        external_effects: []
      },
      {
        action_id: "xhs_delete_saved_search",
        category: "destructive",
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["saved_search"],
          supported_origins: ["https://www.xiaohongshu.com"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: "xiaohongshu.search-notes.resources",
          profile_ids: ["search-notes-ready"]
        },
        external_effects: ["delete"]
      }
    ]
  },
  resource_requirements: {
    resource_requirements_id: "xiaohongshu.search-notes.resources",
    package_ref,
    operation_mode: "read",
    resource_requirement_profiles: [{ requirement_profile_id: "search-notes-ready" }]
  }
} : {
  category: "capability_contract",
  code: "package_not_found",
  phase: "admission",
  recovery_hint: "select_capability_version"
};

function mutation(idempotencyKey: string, expected: string | null, modes: Record<string, string>) {
  return {
    schema_version: executionPolicyMutationSchemaVersion,
    idempotency_key: idempotencyKey,
    expected_source_version: expected,
    modes
  };
}

export async function assertExecutionPolicyApi(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-policy-api-"));
  const runStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  const taskThreadStore = createFileTaskThreadStore({
    directory: join(directory, "threads"),
    runRecordStore: runStore,
    resolveInputPolicy: async ({ package_ref, capability_ref }) => ({
      package_ref,
      capability_ref,
      input_schema_ref: "lode://schema/xiaohongshu/search-notes-input@0.1.0",
      fields: new Map()
    })
  });
  const configStore = createFileExecutionPolicyConfigStore({ directory: join(directory, "policies") });
  let releaseRacePut: (() => void) | undefined;
  let reportRacePutStarted: (() => void) | undefined;
  const racePutStarted = new Promise<void>((resolve) => { reportRacePutStarted = resolve; });
  const racePutGate = new Promise<void>((resolve) => { releaseRacePut = resolve; });
  const gatedConfigStore = new Proxy(configStore, {
    get(target, property) {
      if (property === "putThreadRevision") {
        return async (...args: Parameters<typeof target.putThreadRevision>) => {
          if (args[2].idempotency_key === "thread-race") {
            reportRacePutStarted?.();
            await racePutGate;
          }
          return target.putThreadRevision(...args);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const authorizationStore = createFileAuthorizationDecisionStore({
    directory: join(directory, "decisions"),
    runRecordStore: runStore,
    taskThreadStore
  });
  const server = createApiServer({
    runRecordStore: runStore,
    taskThreadStore,
    executionPolicyConfigStore: gatedConfigStore,
    authorizationDecisionStore: authorizationStore,
    lodePackageResolver
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  try {
    assert.equal((await request(port, "/execution-policy-configs/global", "PUT", mutation("global-incomplete", null, { read: "auto" }))).status, 400);
    const globalResponse = await request(port, "/execution-policy-configs/global", "PUT", {
      $schema: "execution-policy-mutation.schema.json",
      ...mutation("global-create", null, { read: "confirm", prepare: "auto", commit: "confirm", destructive: "auto" })
    });
    assert.equal(globalResponse.status, 200);
    const global = asRecord(globalResponse.body.configuration);
    assert.equal(global.source_version, "1");
    assert.equal(asRecord(global.modes).destructive, "auto");
    assert.equal((await request(port, "/execution-policy-configs/skill")).status, 400);
    assert.equal((await request(port, "/execution-policy-configs/global", "PUT", mutation("global-zero", "0", {
      read: "auto", prepare: "auto", commit: "confirm", destructive: "auto"
    }))).status, 400);

    const effectiveResponse = await request(port, `/execution-policies/effective?skill_ref=${encodeURIComponent(skillRef)}`);
    assert.equal(effectiveResponse.status, 200);
    const effective = asRecord(effectiveResponse.body.execution_policy);
    const actions = effective.actions as Record<string, unknown>[];
    assert.deepEqual(actions.map((action) => action.action_id), ["xhs_search_notes", "xhs_delete_saved_search"]);
    assert.equal(asRecord(actions[1]!.effective_policy).mode, "auto");
    assert.equal(actions[1]!.risk_marker, "destructive");

    const skillResponse = await request(port, `/execution-policy-configs/skill?skill_ref=${encodeURIComponent(skillRef)}`, "PUT", mutation("skill-create", null, {
      read: "auto", destructive: "confirm"
    }));
    assert.equal(skillResponse.status, 200);
    assert.equal(asRecord(asRecord(skillResponse.body.configuration).modes).destructive, "confirm");
    assert.equal((await request(port, `/execution-policy-configs/skill?skill_ref=${encodeURIComponent(skillRef)}`, "PUT", mutation("skill-stale", null, { read: "deny" }))).status, 409);
    assert.equal((await request(port, `/execution-policy-configs/skill?skill_ref=${encodeURIComponent(skillRef)}`, "PUT", {
      ...mutation("skill-private", "1", { read: "deny" }), cookies: []
    })).status, 400);

    const { thread } = await taskThreadStore.createOrGetTaskThread({
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env_666666666666666666666666"
    });
    const threadResponse = await request(port, `/threads/${thread.thread_id}/execution-policy?skill_ref=${encodeURIComponent(skillRef)}`, "PUT", mutation("thread-create", null, { read: "deny" }));
    assert.equal(threadResponse.status, 200);
    const threadConfiguration = asRecord(threadResponse.body.configuration);
    assert.equal(threadConfiguration.effective_from_turn_sequence, 1);
    const threadEffective = asRecord(threadResponse.body.execution_policy);
    assert.equal(threadEffective.turn_sequence, 1);
    assert.equal(asRecord((threadEffective.actions as Record<string, unknown>[])[0]!.effective_policy).source, "thread_revision");

    const { thread: raceThread } = await taskThreadStore.createOrGetTaskThread({
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env_777777777777777777777777"
    });
    const racePolicyRequest = request(
      port,
      `/threads/${raceThread.thread_id}/execution-policy?skill_ref=${encodeURIComponent(skillRef)}`,
      "PUT",
      mutation("thread-race", null, { read: "auto" })
    );
    await racePutStarted;
    let reserveSettled = false;
    const raceReservation = taskThreadStore.reserveTaskTurn(raceThread.thread_id, {
      idempotency_key: "thread-race-turn",
      request_hash: "thread-race-request",
      run_id: "run_policy_race",
      creation_channel: "app",
      package_ref: skillRef,
      input: { schema_version: taskTurnInputSchemaVersion, fields: [] }
    }).finally(() => { reserveSettled = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(reserveSettled, false, "turn reservation must wait for the policy boundary lock");
    releaseRacePut?.();
    const [racePolicyResponse, raceTurn] = await Promise.all([racePolicyRequest, raceReservation]);
    assert.equal(racePolicyResponse.status, 200);
    assert.equal(asRecord(racePolicyResponse.body.configuration).effective_from_turn_sequence, 1);
    assert.equal(raceTurn.turn.sequence, 1);

    const restartedStore = createFileExecutionPolicyConfigStore({ directory: join(directory, "policies") });
    assert.equal((await restartedStore.getInstalledSkillConfiguration(skillRef))?.source_version, "1");

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
    const pendingEvaluation = evaluateExecutionPolicy(authorizationEvaluationInput({
      evaluatedAt: issuedAt.toISOString(),
      policyRef: global.source_ref as string,
      policyVersion: global.source_version as string,
      actionInstance: "action-instance:policy-api/1"
    }));
    const pending = await authorizationStore.recordAuthorizationDecision({
      idempotency_key: "policy-api-pending",
      evaluation: pendingEvaluation,
      subject: environmentAuthorizationSubject,
      expires_at: expiresAt.toISOString()
    });
    const singleCommand = {
      $schema: "single-action-decision-command.schema.json",
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-api-allow",
      choice: "allow_once"
    };
    const singlePath = `/authorization-decisions/${encodeURIComponent(pending.decision_ref)}/single-action`;
    const singleResponse = await request(port, singlePath, "POST", singleCommand);
    assert.equal(singleResponse.status, 200);
    assert.equal(asRecord(singleResponse.body.single_action_decision).mode, "auto");
    assert.deepEqual(await request(port, singlePath, "POST", singleCommand), singleResponse);
    assert.equal((await request(port, singlePath, "POST", { ...singleCommand, idempotency_key: "single-api-deny", choice: "deny_once" })).status, 409);
    const singleDecision = asRecord(singleResponse.body.single_action_decision);
    assert.equal(singleDecision.confirmation_decision_ref, pending.decision_ref);
    await authorizationStore.invalidateAuthorizationDecision(pending.decision_ref, "cancelled");
    const cancelledEvaluation = evaluateExecutionPolicy(authorizationEvaluationInput({
      evaluatedAt: new Date().toISOString(),
      policyRef: global.source_ref as string,
      policyVersion: global.source_version as string,
      actionInstance: "action-instance:policy-api/1",
      singleAction: singleDecision
    }));
    assert.equal(cancelledEvaluation.status === "evaluated" && cancelledEvaluation.effective_policy.source, "single_action_decision");
    await assert.rejects(() => authorizationStore.recordAuthorizationDecision({
      idempotency_key: "policy-api-cancelled-single",
      evaluation: cancelledEvaluation,
      subject: environmentAuthorizationSubject
    }), /authorization_single_action_confirmation_inactive/);
    assert.equal((await request(port, "/authorization-decisions/not-a-ref/single-action", "POST", singleCommand)).status, 400);

    assert.equal((await request(port, "/execution-policy-configs/global", "PUT", mutation("global-private", "1", {
      read: "auto", prepare: "auto", commit: "confirm", destructive: "auto"
    }), "text/plain")).status, 415);
    const unknownFailureStore = new Proxy(configStore, {
      get(target, property) {
        if (property === "getGlobalConfiguration") return async () => { throw null; };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const unknownFailure = await handleExecutionPolicyApi({
      method: "GET",
      url: new URL("http://localhost/execution-policy-configs/global"),
      dependencies: { configStore: unknownFailureStore }
    });
    assert(unknownFailure.handled);
    assert.equal(unknownFailure.status, 500);
    await writeFile(join(directory, "policies", "execution-policy-store.json"), "{", "utf8");
    assert.equal((await request(port, "/execution-policy-configs/global")).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
