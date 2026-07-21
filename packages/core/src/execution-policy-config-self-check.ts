import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import {
  authorizationEvaluationInput,
  environmentAuthorizationSubject
} from "./authorization-decision-probe-fixtures.js";
import {
  executionPolicyMutationSchemaVersion,
  singleActionDecisionCommandSchemaVersion,
  type ExecutionPolicyMutation
} from "./execution-policy-config.js";
import {
  createFileExecutionPolicyConfigStore,
  ExecutionPolicyVersionConflictError
} from "./execution-policy-config-store.js";
import { evaluateExecutionPolicy, resolveCurrentExecutionPolicy } from "./execution-policy.js";
import { decideSingleAction } from "./single-action-decision.js";

function mutation(
  idempotencyKey: string,
  expectedSourceVersion: string | null,
  modes: ExecutionPolicyMutation["modes"]
): ExecutionPolicyMutation {
  return {
    schema_version: executionPolicyMutationSchemaVersion,
    idempotency_key: idempotencyKey,
    expected_source_version: expectedSourceVersion,
    modes
  };
}

async function pendingConfirmation(
  directory: string,
  policy: { source_ref: string; source_version: string },
  now: string,
  actionInstance: string,
  expiresAt: string
) {
  const store = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
  const evaluation = evaluateExecutionPolicy(authorizationEvaluationInput({
    mode: "confirm",
    actionInstance,
    evaluatedAt: now,
    policyRef: policy.source_ref,
    policyVersion: policy.source_version
  }));
  const decision = await store.recordAuthorizationDecision({
    idempotency_key: `pending-${actionInstance}`,
    evaluation,
    subject: environmentAuthorizationSubject,
    expires_at: expiresAt
  });
  assert.equal(decision.outcome, "confirm");
  return { store, decision };
}

export async function assertExecutionPolicyConfigStore(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-execution-policy-"));
  let now = "2026-07-21T01:00:00.000Z";
  const store = createFileExecutionPolicyConfigStore({ directory, clock: () => new Date(now) });
  try {
    const global = await store.putGlobalConfiguration(mutation("global-create", null, {
      read: "confirm",
      prepare: "auto",
      commit: "confirm",
      destructive: "auto"
    }));
    assert.equal(global.source_version, "1");
    assert.equal(global.modes.destructive, "auto", "dangerous actions may remain automatic");
    assert.deepEqual(await store.putGlobalConfiguration(mutation("global-create", null, global.modes)), global);
    await assert.rejects(
      () => store.putGlobalConfiguration(mutation("global-create", null, { ...global.modes, read: "deny" })),
      /execution_policy_idempotency_conflict/
    );
    await assert.rejects(
      () => store.putGlobalConfiguration(mutation("global-stale", null, global.modes)),
      (error: unknown) => error instanceof ExecutionPolicyVersionConflictError && error.current?.source_version === "1"
    );

    const skillRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
    const skill = await store.putInstalledSkillConfiguration(skillRef, mutation("skill-create", null, { read: "auto" }));
    const threadRef = "thread_11111111111111111111111111111111";
    const firstThread = await store.putThreadRevision(threadRef, 2, mutation("thread-create", null, { read: "deny" }));
    assert.equal((await store.getThreadRevision(threadRef, 1)), undefined);
    assert.equal((await store.getThreadRevision(threadRef, 2))?.source_version, "1");
    const beforeThread = await store.resolveSources({ skill_ref: skillRef, thread_ref: threadRef, turn_sequence: 1 });
    assert.equal(resolveCurrentExecutionPolicy({ context: { skill_ref: skillRef, thread_ref: threadRef, turn_sequence: 1 }, policies: beforeThread }, "read")?.source, "installed_skill_user_version");
    const afterThread = await store.resolveSources({ skill_ref: skillRef, thread_ref: threadRef, turn_sequence: 2 });
    assert.equal(resolveCurrentExecutionPolicy({ context: { skill_ref: skillRef, thread_ref: threadRef, turn_sequence: 2 }, policies: afterThread }, "read")?.mode, "deny");

    now = "2026-07-21T01:01:00.000Z";
    const secondThread = await store.putThreadRevision(threadRef, 3, mutation("thread-second", firstThread.source_version, { read: "confirm" }));
    assert.equal((await store.getThreadRevision(threadRef, 2))?.source_version, "1");
    assert.equal((await store.getThreadRevision(threadRef, 3))?.source_version, secondThread.source_version);

    const restarted = createFileExecutionPolicyConfigStore({ directory, clock: () => new Date(now) });
    assert.deepEqual(await restarted.getInstalledSkillConfiguration(skillRef), skill);
    assert.equal((await restarted.getThreadRevision(threadRef, 3))?.source_version, "2");

    const [left, right] = await Promise.allSettled([
      restarted.putGlobalConfiguration(mutation("global-concurrent-left", "1", { ...global.modes, read: "auto" })),
      restarted.putGlobalConfiguration(mutation("global-concurrent-right", "1", { ...global.modes, read: "deny" }))
    ]);
    assert.equal([left, right].filter((result) => result.status === "fulfilled").length, 1);
    assert.equal([left, right].filter((result) => result.status === "rejected" && result.reason instanceof ExecutionPolicyVersionConflictError).length, 1);
    const currentGlobal = (await restarted.getGlobalConfiguration())!;

    now = "2026-07-21T01:02:00.000Z";
    const pending = await pendingConfirmation(
      join(directory, "authorization-decisions"),
      currentGlobal,
      now,
      "action-instance:single-config/1",
      "2026-07-21T01:10:00.000Z"
    );
    now = "2026-07-21T01:02:01.000Z";
    const allowed = await decideSingleAction(pending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-allow",
      choice: "allow_once"
    }, {
      authorizationDecisionStore: pending.store,
      configStore: restarted,
      clock: () => new Date(now)
    });
    assert.equal(allowed.mode, "auto");
    assert.deepEqual(await decideSingleAction(pending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-allow",
      choice: "allow_once"
    }, {
      authorizationDecisionStore: pending.store,
      configStore: restarted,
      clock: () => new Date("2026-07-21T01:11:00.000Z")
    }), allowed, "idempotent replay remains readable after expiry");
    await assert.rejects(() => decideSingleAction(pending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-other",
      choice: "deny_once"
    }, {
      authorizationDecisionStore: pending.store,
      configStore: restarted,
      clock: () => new Date(now)
    }), /single_action_already_decided/);

    const stalePending = await pendingConfirmation(
      join(directory, "authorization-decisions-stale"),
      currentGlobal,
      now,
      "action-instance:single-config/2",
      "2026-07-21T01:10:00.000Z"
    );
    now = "2026-07-21T01:03:00.000Z";
    await restarted.putGlobalConfiguration(mutation("global-change", currentGlobal.source_version, currentGlobal.modes));
    await assert.rejects(() => decideSingleAction(stalePending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-stale",
      choice: "allow_once"
    }, {
      authorizationDecisionStore: stalePending.store,
      configStore: restarted,
      clock: () => new Date(now)
    }), /single_action_confirmation_effective_policy_changed/);

    const currentPolicy = (await restarted.getGlobalConfiguration())!;
    const deniedPending = await pendingConfirmation(
      join(directory, "authorization-decisions-denied"),
      currentPolicy,
      now,
      "action-instance:single-config/deny",
      "2026-07-21T01:10:00.000Z"
    );
    const deniedOnce = await decideSingleAction(deniedPending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-deny",
      choice: "deny_once"
    }, {
      authorizationDecisionStore: deniedPending.store,
      configStore: restarted,
      clock: () => new Date(now)
    });
    assert.equal(deniedOnce.mode, "deny");

    const cancelledPending = await pendingConfirmation(
      join(directory, "authorization-decisions-cancelled"),
      currentPolicy,
      now,
      "action-instance:single-config/cancelled",
      "2026-07-21T01:10:00.000Z"
    );
    await cancelledPending.store.invalidateAuthorizationDecision(cancelledPending.decision.decision_ref, "cancelled", now);
    await assert.rejects(() => decideSingleAction(cancelledPending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-cancelled",
      choice: "allow_once"
    }, {
      authorizationDecisionStore: cancelledPending.store,
      configStore: restarted,
      clock: () => new Date(now)
    }), /single_action_confirmation_cancelled/);

    const expiredPending = await pendingConfirmation(
      join(directory, "authorization-decisions-expired"),
      (await restarted.getGlobalConfiguration())!,
      now,
      "action-instance:single-config/3",
      "2026-07-21T01:04:00.000Z"
    );
    await assert.rejects(() => decideSingleAction(expiredPending.decision.decision_ref, {
      schema_version: singleActionDecisionCommandSchemaVersion,
      idempotency_key: "single-expired",
      choice: "deny_once"
    }, {
      authorizationDecisionStore: expiredPending.store,
      configStore: restarted,
      clock: () => new Date("2026-07-21T01:04:00.000Z")
    }), /single_action_confirmation_expired/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
