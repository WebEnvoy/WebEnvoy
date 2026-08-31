import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileAuthorizationDecisionStore, type FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { continueWritePrecheckTask, submitRuntimeTask, type HarborRuntimeClient } from "./runtime-task-chain.js";
import type { HarborAdmissionInput } from "./harbor-admission.js";
import type { ExecutionPolicyMode, SingleActionDecision } from "./execution-policy.js";
import type { LodePackageAdmissionContract } from "./lode-admission.js";
import type { TaskIntentEnvelope } from "./task-submission.js";
import {
  evaluateWritePrecheckTaskPolicy,
  isUnifiedWritePrecheckTask,
  writePrecheckPolicyFailure,
  type WritePrecheckAuthorizationContext
} from "./write-precheck-policy.js";

const evaluatedAt = "2026-08-31T08:00:00.000Z";
const context: WritePrecheckAuthorizationContext = {
  thread_id: "thread_11111111111111111111111111111111",
  turn_id: "turn_22222222222222222222222222222222",
  turn_sequence: 1,
  idempotency_key: "turn-policy-check"
};

function contract(): LodePackageAdmissionContract {
  return {
    package_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
    source_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1",
    capability_id: "publish-note-precheck",
    operation_id: "xhs_publish_note_precheck",
    operation_mode: "validate_only",
    version: "0.1.0",
    runtime_admission: { enabled: true, status: "current", recheck_condition: "not_applicable" },
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: "xhs_publish_note_precheck",
        category: "prepare",
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["creator_publish_page"],
          supported_origins: ["https://creator.xiaohongshu.com"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: "xiaohongshu.publish-note-precheck.resources",
          profile_ids: ["xhs-creator-publish-page-precheck"]
        },
        external_effects: []
      }]
    },
    resource_requirements: {
      resource_requirements_id: "xiaohongshu.publish-note-precheck.resources",
      package_ref: "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0",
      operation_mode: "validate_only",
      resource_requirement_profiles: [{ requirement_profile_id: "xhs-creator-publish-page-precheck" }]
    }
  };
}

function taskIntent(): TaskIntentEnvelope {
  return {
    schema_version: "webenvoy.task-intent.v0",
    intent_id: "intent_write_precheck_policy",
    entrypoint: "app",
    user_intent: { summary: "验证发布前页面" },
    capability: {
      ref: "lode:capability/publish-note-precheck",
      version: "0.1.0",
      source_ref: contract().package_ref,
      lock_ref: "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1"
    },
    input: { summary: "仅验证，不提交" },
    scope: {
      target_type: "creator_publish_page",
      target_ref: "https://creator.xiaohongshu.com/publish/publish"
    },
    policy: { risk: "write", execution_intent: "validate_only" },
    resource_requirement_refs: ["xiaohongshu.publish-note-precheck.resources"],
    resource_requirement_profile_id: "xhs-creator-publish-page-precheck",
    evidence_policy_ref: "policy:no-raw-evidence"
  };
}

function configStore(mode: ExecutionPolicyMode): FileExecutionPolicyConfigStore {
  return {
    resolveSources: async () => ({
      global_user_config: {
        source_ref: "execution-policy:global_user_config:global",
        source_version: "1",
        modes: { read: "auto", prepare: mode, commit: "confirm", destructive: "deny" }
      }
    })
  } as unknown as FileExecutionPolicyConfigStore;
}

function singleActionDecision(evaluation: Awaited<ReturnType<typeof evaluate>>, mode: "auto" | "deny" = "auto"): SingleActionDecision {
  if ("category" in evaluation || evaluation.evaluation.status !== "evaluated" || !evaluation.evaluation.confirmation_request) {
    throw new Error("confirmation evaluation required");
  }
  const confirmation = evaluation.evaluation.confirmation_request;
  return {
    schema_version: "webenvoy.single-action-decision.v0",
    confirmation_decision_ref: "authorization-decision:11111111111111111111111111111111:22222222222222222222222222222222",
    source_ref: "execution-policy:single-action:precheck",
    source_version: "1",
    action_instance_ref: confirmation.action_instance_ref,
    action_id: confirmation.action_id,
    category: confirmation.category,
    target: confirmation.target,
    owner_matcher: confirmation.owner_matcher,
    owner_declaration_ref: confirmation.owner_declaration_ref,
    owner_declaration_version: confirmation.owner_declaration_version,
    resource_match_ref: confirmation.resource_match_ref,
    resource_match_version: confirmation.resource_match_version,
    effective_policy_source_ref: confirmation.effective_policy_source_ref,
    effective_policy_source_version: confirmation.effective_policy_source_version,
    effective_policy_source: confirmation.effective_policy_source,
    mode,
    state: "active",
    issued_at: "2026-08-31T07:59:59.000Z",
    expires_at: "2026-08-31T08:10:00.000Z"
  };
}

function completedWritePrecheckOperation(input: {
  runtime_session_ref: string;
  target_ref: string;
  suffix: string;
}): Record<string, unknown> {
  const pageSourceRef = `source_page_${input.suffix}`;
  const domSourceRef = `source_dom_${input.suffix}`;
  const snapshotRef = `evidence_snapshot_${input.suffix}`;
  const postCheckRef = `postcheck_${input.suffix}`;
  return {
    schema_version: "harbor-validate-only-write-precheck/v0",
    status: "completed",
    runtime_session_ref: input.runtime_session_ref,
    target_ref: input.target_ref,
    page_ref: `page_${input.suffix}`,
    operation_ref: `operation_${input.suffix}`,
    result_ref: `result_${input.suffix}`,
    submitted_result_ref: `submitted_result_${input.suffix}`,
    observed_at: evaluatedAt,
    classification: "partial_result",
    precheck_scope: "entrypoint_only",
    composition_state: "composition_not_initialized",
    no_submit_guard: "active",
    submitted: false,
    lode_pin: {
      package_ref: contract().package_ref,
      lock_ref: contract().lock_ref,
      input_schema_ref: "lode://schema/site-capability/xiaohongshu/publish-note-precheck/input@0.1.0",
      output_schema_ref: "lode://schema/site-capability/xiaohongshu/publish-note-precheck/output@0.1.0",
      version: "0.1.0",
      operation_id: "xhs_publish_note_precheck",
      operation_mode: "validate_only",
      origin: "https://creator.xiaohongshu.com",
      repository: "WebEnvoy/Lode",
      commit: "6bff1afd059a30571f8ed219d1dcd25e6fb20c6b",
      asset_path: "registry/validate-only-runtime-consumption.json",
      asset_sha256: "c62ba191357e0056b03523a46c0bb26424c916333f388898a4cc457f9c1cc6fc",
      asset_semantic_sha256: "21f57cfd9f395bb13b322aec9e5dd0c9c5f01ea959052e3ceb0aeaf14e636ce0"
    },
    public_boundary: {
      raw_dom: "not_exposed",
      raw_har: "not_exposed",
      screenshot_body: "not_exposed",
      credentials: "not_exposed",
      external_write_actions: "not_performed"
    },
    source_refs: [
      { kind: "creator_publish_page_summary", ref: pageSourceRef },
      { kind: "dom_snapshot_summary", ref: domSourceRef }
    ],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: snapshotRef }, { kind: "post_check_ref", ref: postCheckRef }],
    post_check: {
      status: "passed",
      reason: "validated_creator_entrypoint_without_submission",
      submitted: false,
      no_submit_guard: "active",
      post_check_ref: postCheckRef,
      source_refs: [{ ref: pageSourceRef }, { ref: domSourceRef }],
      evidence_refs: [{ ref: snapshotRef }]
    },
    entrypoint_observations: { creator_publish_page: true, title_field: true, summary_field: true },
    field_states: { title: "available", summary: "available", canonical_url: "available", source_status: "located" },
    prohibited_actions_observed: { submit: false, publish: false, upload: false }
  };
}

async function evaluate(
  mode: ExecutionPolicyMode,
  authorizationContext = context,
  single_action_decision?: SingleActionDecision,
) {
  return evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-233",
    task_intent: taskIntent(),
    lode_contract: contract(),
    authorization_context: authorizationContext,
    config_store: configStore(mode),
    ...(single_action_decision === undefined ? {} : { single_action_decision }),
    evaluated_at: evaluatedAt
  });
}

export async function assertWritePrecheckPolicyWiring(): Promise<void> {
  assert.equal(isUnifiedWritePrecheckTask(taskIntent(), contract()), true);
  const spoofedTask = structuredClone(taskIntent());
  spoofedTask.capability.ref = "lode:capability/evil-cap";
  assert.equal(isUnifiedWritePrecheckTask(spoofedTask, contract()), false);
  const spoofedContract = structuredClone(contract());
  spoofedContract.capability_id = "evil-cap";
  assert.equal(isUnifiedWritePrecheckTask(taskIntent(), spoofedContract), false);

  const spoofDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-spoof-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(spoofDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    let harborCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-spoof",
      task_intent: spoofedTask,
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        validateOnlyWritePrecheck: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        executeReadOperation: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        releaseCoreTaskSession: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); }
      } as HarborRuntimeClient
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "write_precheck_binding_invalid");
    assert.equal(harborCalls, 0);
  } finally {
    await rm(spoofDirectory, { recursive: true, force: true });
  }

  const automatic = await evaluate("auto");
  assert.ok(!("category" in automatic));
  assert.equal(automatic.evaluation.status === "evaluated" && automatic.evaluation.next_step, "execute");
  assert.equal(writePrecheckPolicyFailure(automatic.evaluation).code, "harbor_write_precheck_operation_unavailable");

  const confirmation = await evaluate("confirm");
  assert.ok(!("category" in confirmation));
  assert.equal(confirmation.evaluation.status === "evaluated" && confirmation.evaluation.next_step, "request_confirmation");
  assert.equal(writePrecheckPolicyFailure(confirmation.evaluation).code, "authorization_confirmation_required");
  const denied = await evaluate("deny");
  assert.ok(!("category" in denied));
  assert.equal(denied.evaluation.status === "evaluated" && denied.evaluation.next_step, "stop");
  assert.equal(writePrecheckPolicyFailure(denied.evaluation).code, "execution_policy_denied");

  const allowOnce = await evaluate("confirm");
  const allowedOnceDecision = singleActionDecision(allowOnce);
  const allowedOnce = await evaluate("confirm", context, allowedOnceDecision);
  assert.ok(!("category" in allowedOnce));
  assert.equal(allowedOnce.evaluation.status === "evaluated" && allowedOnce.evaluation.next_step, "execute");
  assert.equal(allowedOnce.evaluation.status === "evaluated" && allowedOnce.evaluation.effective_policy.source, "single_action_decision");
  const expiredDecision = { ...allowedOnceDecision, expires_at: evaluatedAt };
  const expired = await evaluate("confirm", context, expiredDecision);
  assert.ok(!("category" in expired));
  assert.equal(expired.evaluation.status === "evaluated" && expired.evaluation.next_step, "request_confirmation");

  const reclassifiedContract = structuredClone(contract());
  reclassifiedContract.action_declaration!.actions[0]!.category = "commit";
  const reclassified = await evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-reclassified",
    task_intent: taskIntent(),
    lode_contract: reclassifiedContract,
    authorization_context: context,
    config_store: configStore("auto"),
    evaluated_at: evaluatedAt
  });
  assert.equal("category" in reclassified && reclassified.code, "execution_policy_owner_declaration_invalid");

  const changedProfileContract = structuredClone(contract());
  changedProfileContract.resource_requirements.resource_requirement_profiles[0]!.requirement_profile_id = "other-profile";
  const changedProfile = await evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-profile-drift",
    task_intent: taskIntent(),
    lode_contract: changedProfileContract,
    authorization_context: context,
    config_store: configStore("auto"),
    evaluated_at: evaluatedAt
  });
  assert.equal("category" in changedProfile && changedProfile.code, "execution_policy_owner_declaration_invalid");

  const unavailable = await evaluateWritePrecheckTaskPolicy({
    run_id: "app-xhs-write-precheck-owner-unavailable",
    task_intent: taskIntent(),
    lode_contract: contract(),
    authorization_context: context,
    config_store: { resolveSources: async () => { throw new Error("unavailable"); } } as unknown as FileExecutionPolicyConfigStore,
    evaluated_at: evaluatedAt
  });
  assert.equal("category" in unavailable && unavailable.code, "execution_policy_owner_unavailable");

  const first = await evaluate("auto");
  const replay = await evaluate("auto");
  assert.deepEqual(replay, first);

  for (const [mode, expectedStatus, expectedCode] of [
    ["auto", "succeeded", undefined],
    ["confirm", "requires_user_action", "authorization_confirmation_required"],
    ["deny", "failed", "execution_policy_denied"]
  ] as const) {
    const directory = await mkdtemp(join(tmpdir(), `webenvoy-write-policy-${mode}-`));
    try {
      const runStore = createFileRunRecordStore({ directory: join(directory, "runs"), clock: () => new Date(evaluatedAt) });
      const authorizationStore = createFileAuthorizationDecisionStore({
        directory: join(directory, "decisions"),
        runRecordStore: runStore,
        taskThreadStore: {
          getTaskThread: async () => ({
            thread_id: context.thread_id,
            turns: [{ turn_id: context.turn_id, run_id: `app-xhs-write-precheck-${mode}` }]
          })
        },
        clock: () => new Date(evaluatedAt)
      });
      let collectCalls = 0;
      let validateCalls = 0;
      let releaseCalls = 0;
      const harbor = {
        collectAdmissionFacts: async () => {
          collectCalls += 1;
          return { harbor_runtime_facts: { runtime_session_ref: `session_${mode}` } } as unknown as HarborAdmissionInput;
        },
        validateOnlyWritePrecheck: async (input: { runtime_session_ref: string; target_ref: string }) => {
          validateCalls += 1;
          return completedWritePrecheckOperation({ runtime_session_ref: input.runtime_session_ref, target_ref: input.target_ref, suffix: mode });
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      } as HarborRuntimeClient;
      const result = await submitRuntimeTask(runStore, {
        run_id: `app-xhs-write-precheck-${mode}`,
        task_intent: { ...taskIntent(), intent_id: `intent_write_precheck_${mode}` },
        package_ref: contract().package_ref,
        authorization_context: context,
        harbor: { identity_environment_ref: "harbor://identity-environment/xhs-policy" }
      }, {
        lodePackageResolver: async () => contract(),
        harborRuntimeClient: harbor,
        executionPolicyConfigStore: configStore(mode),
        authorizationDecisionStore: authorizationStore,
        clock: () => new Date(evaluatedAt)
      });
      assert.equal(result.ok, mode === "auto");
      if (expectedCode) {
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.failure.code, expectedCode);
      }
      assert.equal(result.run_record?.status, expectedStatus);
      assert.equal(result.run_record?.authorization_decision_refs?.length, 1);
      const policySnapshot = result.run_record?.policy_binding_snapshot;
      assert.ok(policySnapshot);
      assert.equal(policySnapshot.schema_version, "webenvoy.policy-binding-snapshot.v0");
      assert.match(policySnapshot.decision_ref, /^authorization-decision:/);
      assert.equal(policySnapshot.effective_policy_source, "global_user_config");
      assert.ok(policySnapshot.effective_policy_source_ref.length > 0);
      assert.ok(policySnapshot.effective_policy_source_version.length > 0);
      assert.match(policySnapshot.action_fingerprint, /^sha256:[a-f0-9]{64}$/);
      assert.equal(policySnapshot.resource_match_ref.length > 0, true);
      assert.equal(policySnapshot.resource_match_version.length > 0, true);
      assert.equal(policySnapshot.expires_at, evaluatedAt.replace("08:00:00", "08:10:00"));
      assert.equal(collectCalls, mode === "auto" ? 1 : 0);
      assert.equal(validateCalls, mode === "auto" ? 1 : 0);
      assert.equal(releaseCalls, mode === "auto" ? 1 : 0);
      if (mode === "auto") {
        assert.equal(result.run_record?.public_result_summary && (result.run_record.public_result_summary as Record<string, unknown>).submitted, false);
        assert.equal(result.run_record?.preview_result?.submitted, false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  const missingSnapshotDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-continuation-binding-"));
  try {
    const baseRunStore = createFileRunRecordStore({ directory: join(missingSnapshotDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(missingSnapshotDirectory, "decisions"),
      runRecordStore: baseRunStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-missing-snapshot" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    const waiting = await submitRuntimeTask(baseRunStore, {
      run_id: "app-xhs-write-precheck-missing-snapshot",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_missing_snapshot" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      executionPolicyConfigStore: configStore("confirm"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(waiting.ok, false);
    const confirmationRef = waiting.run_record?.authorization_decision_refs?.[0];
    assert(confirmationRef);
    const confirmationEvaluation = await evaluate("confirm");
    const decision = { ...singleActionDecision(confirmationEvaluation), confirmation_decision_ref: confirmationRef };
    let harborCalls = 0;
    const runStore = {
      ...baseRunStore,
      getRunRecord: async (runId: string) => {
        const record = await baseRunStore.getRunRecord(runId);
        if (!record) return record;
        const { policy_binding_snapshot: _snapshot, ...withoutSnapshot } = record;
        return withoutSnapshot;
      }
    };
    const continued = await continueWritePrecheckTask(runStore, {
      run_id: "app-xhs-write-precheck-missing-snapshot",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_missing_snapshot" },
      package_ref: contract().package_ref,
      authorization_context: context,
      single_action_decision: decision
    }, {
      harborRuntimeClient: {
        collectAdmissionFacts: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        validateOnlyWritePrecheck: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        executeReadOperation: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); },
        releaseCoreTaskSession: async () => { harborCalls += 1; throw new Error("unexpected Harbor dispatch"); }
      } as HarborRuntimeClient
    });
    assert.equal(continued.ok, false);
    if (!continued.ok) assert.equal(continued.failure.code, "single_action_confirmation_binding_mismatch");
    assert.equal(harborCalls, 0);
    assert.equal((await baseRunStore.getRunRecord("app-xhs-write-precheck-missing-snapshot"))?.status, "requires_user_action");
  } finally {
    await rm(missingSnapshotDirectory, { recursive: true, force: true });
  }

  const missingClientDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-missing-client-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(missingClientDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(missingClientDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-missing-client" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-missing-client",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_missing_client" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.category, "resource_admission");
      assert.equal(result.failure.code, "harbor_runtime_api_unconfigured");
    }
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(result.run_record?.preview_result?.submitted, false);
  } finally {
    await rm(missingClientDirectory, { recursive: true, force: true });
  }

  const collectionFailureDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-collection-failure-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(collectionFailureDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(collectionFailureDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-collection-failure" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-collection-failure",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_collection_failure" },
      package_ref: contract().package_ref,
      authorization_context: context,
      harbor: { identity_environment_ref: "harbor://identity-environment/xhs-policy" }
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => ({
          kind: "harbor_admission_collection_failure",
          runtime_session_ref: "session_collection_failure",
          failure: {
            category: "resource_admission",
            code: "harbor_runtime_admission_failed",
            phase: "runtime_binding",
            recovery_hint: "connect_runtime"
          },
          cleanup_failure: {
            category: "runtime_execution",
            code: "core_task_session_cleanup_failed",
            phase: "runtime_binding",
            recovery_hint: "inspect_runtime_session"
          }
        }) as unknown as HarborAdmissionInput,
        validateOnlyWritePrecheck: async () => {
          validateCalls += 1;
          throw new Error("collection failure must stop before operation");
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => {
          releaseCalls += 1;
          return undefined;
        }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.category, "resource_admission");
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.failure?.code, "harbor_runtime_admission_failed");
    assert.deepEqual(result.run_record?.runtime_binding_refs, ["session_collection_failure"]);
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(result.run_record?.preview_result?.submitted, false);
    assert.equal(result.run_record?.post_check?.code, "core_task_session_cleanup_failed");
    assert.deepEqual(result.run_record?.post_check?.source_refs, ["session_collection_failure"]);
    assert.equal(validateCalls, 0);
    assert.equal(releaseCalls, 0, "collection cleanup failure is already recorded; do not retry cleanup");
  } finally {
    await rm(collectionFailureDirectory, { recursive: true, force: true });
  }

  const unavailableDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-unavailable-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(unavailableDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(unavailableDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-unavailable" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let operationCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-unavailable",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_unavailable" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => ({ harbor_runtime_facts: { runtime_session_ref: "session_unavailable" } } as unknown as HarborAdmissionInput),
        validateOnlyWritePrecheck: async () => {
          operationCalls += 1;
          return {
            schema_version: "harbor-validate-only-write-precheck/v0",
            status: "unavailable",
            submitted: false,
            failure_class: "browser_provider_unavailable",
            retryable: false
          };
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => undefined
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "write_precheck_browser_provider_unavailable");
    assert.equal(result.run_record?.status, "failed");
    assert.equal(result.run_record?.preview_result?.submitted, false);
    assert.equal(operationCalls, 1);
  } finally {
    await rm(unavailableDirectory, { recursive: true, force: true });
  }

  const incompleteEvidenceDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-incomplete-evidence-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(incompleteEvidenceDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(incompleteEvidenceDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-incomplete-evidence" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-incomplete-evidence",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_incomplete_evidence" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => ({ harbor_runtime_facts: { runtime_session_ref: "session_incomplete_evidence" } } as unknown as HarborAdmissionInput),
        validateOnlyWritePrecheck: async (input: { runtime_session_ref: string; target_ref: string }) => {
          const completed = completedWritePrecheckOperation({ runtime_session_ref: input.runtime_session_ref, target_ref: input.target_ref, suffix: "incomplete" });
          completed.evidence_ref_kinds = [{ kind: "post_check_ref", ref: "postcheck_incomplete" }];
          return completed;
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "harbor_write_precheck_outcome_unknown");
    assert.equal(result.run_record?.status, "unknown_outcome");
    assert.equal(result.run_record?.public_result_summary?.submitted, false);
    assert.equal(releaseCalls, 1);
  } finally {
    await rm(incompleteEvidenceDirectory, { recursive: true, force: true });
  }

  const persistenceDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-unknown-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(persistenceDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    let collectCalls = 0;
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-unknown",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_unknown" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => {
          collectCalls += 1;
          return { harbor_runtime_facts: { runtime_session_ref: "session_unknown" } } as unknown as HarborAdmissionInput;
        },
        validateOnlyWritePrecheck: async () => {
          validateCalls += 1;
          // A syntactically JSON but incomplete response is still unknown.
          return { schema_version: "harbor-validate-only-write-precheck/v0", status: "completed", submitted: false };
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; return undefined; }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: {
        recordAuthorizationDecision: async () => { throw new Error("outcome_unknown"); }
      } as unknown as FileAuthorizationDecisionStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, "authorization_decision_persistence_failed");
    assert.equal(result.run_record?.post_check?.code, "authorization_decision_persistence_failed");
    assert.equal(collectCalls, 0);
    assert.equal(validateCalls, 0);
    assert.equal(releaseCalls, 0);
  } finally {
    await rm(persistenceDirectory, { recursive: true, force: true });
  }

  const unknownDirectory = await mkdtemp(join(tmpdir(), "webenvoy-write-policy-transport-unknown-"));
  try {
    const runStore = createFileRunRecordStore({ directory: join(unknownDirectory, "runs"), clock: () => new Date(evaluatedAt) });
    const authorizationStore = createFileAuthorizationDecisionStore({
      directory: join(unknownDirectory, "decisions"),
      runRecordStore: runStore,
      taskThreadStore: {
        getTaskThread: async () => ({
          thread_id: context.thread_id,
          turns: [{ turn_id: context.turn_id, run_id: "app-xhs-write-precheck-transport-unknown" }]
        })
      },
      clock: () => new Date(evaluatedAt)
    });
    let collectCalls = 0;
    let validateCalls = 0;
    let releaseCalls = 0;
    const result = await submitRuntimeTask(runStore, {
      run_id: "app-xhs-write-precheck-transport-unknown",
      task_intent: { ...taskIntent(), intent_id: "intent_write_precheck_transport_unknown" },
      package_ref: contract().package_ref,
      authorization_context: context
    }, {
      lodePackageResolver: async () => contract(),
      harborRuntimeClient: {
        collectAdmissionFacts: async () => {
          collectCalls += 1;
          return { harbor_runtime_facts: { runtime_session_ref: "session_transport_unknown" } } as unknown as HarborAdmissionInput;
        },
        validateOnlyWritePrecheck: async () => {
          validateCalls += 1;
          throw new Error("transport timeout");
        },
        executeReadOperation: async () => { throw new Error("unexpected read dispatch"); },
        releaseCoreTaskSession: async () => { releaseCalls += 1; throw new Error("cleanup transport failure"); }
      },
      executionPolicyConfigStore: configStore("auto"),
      authorizationDecisionStore: authorizationStore,
      clock: () => new Date(evaluatedAt)
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "harbor_write_precheck_outcome_unknown");
    assert.equal(result.run_record?.status, "unknown_outcome");
    assert.equal(collectCalls, 1);
    assert.equal(validateCalls, 1);
    assert.equal(releaseCalls, 1);
    assert.equal(result.run_record?.preview_result?.submitted, false);
    assert.equal(result.run_record?.post_check?.code, "core_task_session_cleanup_unverified");
    assert.deepEqual(result.run_record?.post_check?.source_refs, ["session_transport_unknown"]);
  } finally {
    await rm(unknownDirectory, { recursive: true, force: true });
  }
}
