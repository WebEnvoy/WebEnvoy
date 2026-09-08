import assert from "node:assert/strict";

import {
  xhsCommitPackageRef,
  type FileAuthorizationDecisionStore,
  type FileExecutionPolicyConfigStore,
  type FileRunRecordStore
} from "@webenvoy/core-runtime";

import { handleAuthorizationDecisionApi } from "./authorization-decision-api.js";
import { handleExecutionPolicyApi } from "./execution-policy-api.js";

function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export async function assertAuthorizationDecisionApi(): Promise<void> {
  const decisionRef = `authorization-decision:${"1".repeat(32)}:${"2".repeat(32)}`;
  const runId = "run_api_xhs_confirmation";
  const threadId = `thread_${"a".repeat(32)}`;
  const turnId = `turn_${"b".repeat(32)}`;
  const confirmationContext = {
    schema_version: "webenvoy.xhs-confirmation-context/v0",
    status: "blocked" as const,
    runtime_binding: {
      runtime_session_ref: "session_api_xhs_confirmation",
      identity_environment_ref: "identity-env_api_xhs_confirmation",
      profile_ref: "profile_api_xhs_confirmation",
      provider_ref: "harbor:provider/cloakbrowser",
      control_owner: "core_task" as const,
      observation_generation: "fnv1a:1234abcd",
      observation_ref: "operation:api-xhs-confirmation"
    },
    account: { status: "verified" as const, account_ref: "account:api-xhs", label: "小红书账号" },
    business_target: { status: "verified" as const, target_ref: "target:api-xhs", label: "小红书发布页" },
    page: {
      status: "verified" as const,
      url: "https://creator.xiaohongshu.com/publish/publish",
      fingerprint: "fnv1a:1234abcd",
      diff: "unchanged" as const
    },
    media: { status: "unknown" as const, image_count: null, ordered_item_refs: [], summary: null },
    fields: {
      status: "unknown" as const,
      title: { state: "unknown" as const, length: null, summary: null },
      body: { state: "unknown" as const, length: null, summary: null }
    },
    pending_issues: ["media_unknown", "fields_unknown"],
    observed_at: "2026-09-08T00:00:00.000Z",
    fingerprint: `sha256:${"a".repeat(64)}`,
    fail_closed: true as const
  };
  const decision = {
    schema_version: "webenvoy.authorization-decision.v0",
    decision_ref: decisionRef,
    business_action: {
      action_instance_ref: "action-instance:api-xhs-confirmation",
      action_id: "xhs_publish_note_image_text_commit.publish",
      category: "commit" as const,
      target: {
        target_ref: "target:api-xhs",
        target_type: "creator_publish_page",
        site_slug: "xiaohongshu",
        origin: "https://creator.xiaohongshu.com"
      }
    },
    owner_declaration: {
      matcher: "lode_action_declaration" as const,
      declaration_ref: xhsCommitPackageRef,
      declaration_version: "0.1.1",
      resource_match_ref: "resource-match:api-xhs-confirmation",
      resource_match_version: "1"
    },
    effective_policy: { mode: "confirm" as const, source: "global_user_config" as const, source_version: "1" },
    applicability: {
      scope: "task" as const,
      run_id: runId,
      thread_id: threadId,
      turn_id: turnId,
      config_refs: ["execution-policy:global"]
    },
    outcome: "confirm" as const,
    risk_marker: null,
    decided_at: "2026-09-08T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    state: "active" as const,
    invalidated_at: null,
    invalidation_reason: null,
    consumer_boundary: "Business policy decision summary only; technical trace and private browser, evidence, and content material are excluded."
  };
  const run = {
    run_id: runId,
    package_ref: xhsCommitPackageRef,
    action_request: { action_id: decision.business_action.action_id },
    public_result_summary: { confirmation_context: confirmationContext }
  };
  const decisions = new Map([[decisionRef, decision]]);
  const decisionStore = {
    getAuthorizationDecision: async (ref: string) => decisions.get(ref)
  } as unknown as FileAuthorizationDecisionStore;
  const runStore = {
    getRunRecord: async (ref: string) => ref === runId ? run : undefined
  } as unknown as FileRunRecordStore;

  const detail = await handleAuthorizationDecisionApi({
    method: "GET",
    url: new URL(`http://localhost/authorization-decisions/${encodeURIComponent(decisionRef)}`),
    store: decisionStore,
    runRecordStore: runStore
  });
  assert(detail.handled);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.confirmation_context, confirmationContext);

  const missingContext = await handleAuthorizationDecisionApi({
    method: "GET",
    url: new URL(`http://localhost/authorization-decisions/${encodeURIComponent(decisionRef)}`),
    store: decisionStore,
    runRecordStore: {
      getRunRecord: async (ref: string) => ref === runId ? { ...run, public_result_summary: undefined } : undefined
    } as unknown as FileRunRecordStore
  });
  assert(missingContext.handled);
  assert.equal(missingContext.status, 200);
  assert.equal(missingContext.body.confirmation_context, undefined, "missing live context must keep deny and recheck reachable");

  let runLockCalls = 0;
  let preflightCalls = 0;
  const blockedPreflight = {
    ok: false as const,
    status: 409,
    body: {
      ok: false,
      error: {
        category: "action_risk",
        code: "observation_stale",
        phase: "admission",
        recovery_hint: "refresh_confirmation_observation"
      },
      confirmation_context: confirmationContext
    }
  };
  const preflight = await handleAuthorizationDecisionApi({
    method: "POST",
    url: new URL(`http://localhost/authorization-decisions/${encodeURIComponent(decisionRef)}/preflight`),
    store: decisionStore,
    runRecordStore: runStore,
    withPreflightRunLock: async (lockedRunId, action) => {
      assert.equal(lockedRunId, runId);
      runLockCalls += 1;
      return action();
    },
    preflightSingleAction: async (ref) => {
      assert.equal(ref, decisionRef);
      preflightCalls += 1;
      return blockedPreflight;
    }
  });
  assert(preflight.handled);
  assert.equal(preflight.status, 409);
  assert.equal(runLockCalls, 1);
  assert.equal(preflightCalls, 1);
  assert.equal(asRecord(preflight.body.authorization_decision).state, "active");
  assert.deepEqual(preflight.body.confirmation_context, confirmationContext);

  let consumed: Record<string, unknown> | undefined;
  const configStore = {
    getSingleActionDecision: async () => undefined,
    sourceVersionApplies: async () => true,
    recordSingleActionDecision: async (input: { decision: Record<string, unknown> }) => {
      consumed = input.decision;
      return input.decision;
    }
  } as unknown as FileExecutionPolicyConfigStore;
  const taskThreadStore = {
    getTaskThread: async () => ({
      thread_id: threadId,
      turns: [{ turn_id: turnId, run_id: runId, sequence: 1, status: "awaiting_user_action" }]
    })
  } as never;
  const singlePath = `http://localhost/authorization-decisions/${encodeURIComponent(decisionRef)}/single-action`;
  const command = {
    schema_version: "webenvoy.single-action-decision-command.v0",
    idempotency_key: "api-xhs-confirmation-allow",
    choice: "allow_once"
  };
  const blockedAllow = await handleExecutionPolicyApi({
    method: "POST",
    url: new URL(singlePath),
    body: command,
    dependencies: {
      configStore,
      authorizationDecisionStore: decisionStore,
      taskThreadStore,
      preflightSingleAction: async () => blockedPreflight
    }
  });
  assert(blockedAllow.handled);
  assert.equal(blockedAllow.status, 409);
  assert.equal(consumed, undefined, "blocked allow must not consume a single-action decision");
  assert.equal(decisions.get(decisionRef)?.state, "active");

  const deny = await handleExecutionPolicyApi({
    method: "POST",
    url: new URL(singlePath),
    body: { ...command, idempotency_key: "api-xhs-confirmation-deny", choice: "deny_once" },
    dependencies: {
      configStore,
      authorizationDecisionStore: decisionStore,
      taskThreadStore,
      preflightSingleAction: async () => {
        throw new Error("deny must bypass preflight");
      }
    }
  });
  assert(deny.handled);
  assert.equal(deny.status, 200);
  assert.equal(asRecord(deny.body.single_action_decision).mode, "deny");
}
