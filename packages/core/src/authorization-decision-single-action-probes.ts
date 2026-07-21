import assert from "node:assert/strict";
import { join } from "node:path";

import {
  authorizationEvaluationInput,
  environmentAuthorizationSubject,
  singleAuthorizationDecision
} from "./authorization-decision-probe-fixtures.js";
import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";

function singleEvaluation(evaluatedAt: string, options: {
  mode?: "auto" | "deny";
  actionInstance?: string;
  targetRef?: string;
  ownerVersion?: string;
  expiresAt?: string;
} = {}) {
  const input = authorizationEvaluationInput({
    mode: "confirm",
    evaluatedAt,
    actionInstance: options.actionInstance ?? "action-instance:single/1",
    ...(options.targetRef === undefined ? {} : { targetRef: options.targetRef }),
    ...(options.ownerVersion === undefined ? {} : { ownerVersion: options.ownerVersion })
  });
  const decision = singleAuthorizationDecision(input, options.mode ?? "auto");
  if (options.expiresAt !== undefined) decision.expires_at = options.expiresAt;
  input.policies.single_action_decision = decision;
  return evaluateExecutionPolicy(input);
}

async function assertDenyOnce(directory: string): Promise<void> {
  const store = createFileAuthorizationDecisionStore({
    directory,
    clock: () => new Date("2026-07-21T00:00:30.000Z")
  });
  const denied = await store.recordAuthorizationDecision({
    idempotency_key: "deny-first",
    evaluation: singleEvaluation("2026-07-21T00:00:00.000Z", { mode: "deny" }),
    subject: environmentAuthorizationSubject
  });
  assert.equal(denied.reason?.kind, "user_deny");
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "deny-second-key",
    evaluation: singleEvaluation("2026-07-21T00:00:00.000Z", { mode: "deny" }),
    subject: environmentAuthorizationSubject
  }), /authorization_single_action_already_decided/);
}

export async function probeSingleActionConsumption(directory: string): Promise<void> {
  let now = "2026-07-21T00:00:30.000Z";
  const store = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "single-first",
    evaluation: singleEvaluation("2026-07-21T00:00:00.000Z"),
    subject: environmentAuthorizationSubject
  });
  for (const [idempotencyKey, subject] of [
    ["single-second-key", environmentAuthorizationSubject],
    ["single-different-subject", { scope: "environment", operation_ref: "harbor-operation:fixture/2" } as const]
  ] as const) {
    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: idempotencyKey,
      evaluation: singleEvaluation("2026-07-21T00:00:00.000Z"),
      subject
    }), /authorization_single_action_already_decided/);
  }
  now = "2026-07-21T00:01:00.000Z";
  assert.equal((await store.invalidateAuthorizationDecision(first.decision_ref, "completed", now)).state, "consumed");
  assert.equal((await store.recordAuthorizationDecision({
    idempotency_key: "single-first",
    evaluation: singleEvaluation("2026-07-21T00:00:00.000Z"),
    subject: environmentAuthorizationSubject
  })).state, "consumed");
  now = "2026-07-21T00:02:00.000Z";
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "single-after-complete",
    evaluation: singleEvaluation(now),
    subject: environmentAuthorizationSubject
  }), /authorization_single_action_already_decided/);
  const second = await store.recordAuthorizationDecision({
    idempotency_key: "single-new-target",
    evaluation: singleEvaluation(now, { targetRef: "target:xhs-note/2" }),
    subject: environmentAuthorizationSubject
  });
  now = "2026-07-21T00:03:00.000Z";
  assert.equal((await store.invalidateAuthorizationDecision(second.decision_ref, "cancelled", now)).state, "invalidated");
  now = "2026-07-21T00:04:00.000Z";
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "single-after-cancel",
    evaluation: singleEvaluation(now, { targetRef: "target:xhs-note/2" }),
    subject: environmentAuthorizationSubject
  }), /authorization_single_action_already_decided/);
  const third = await store.recordAuthorizationDecision({
    idempotency_key: "single-new-owner",
    evaluation: singleEvaluation(now, { targetRef: "target:xhs-note/2", ownerVersion: "2.0.0" }),
    subject: environmentAuthorizationSubject
  });
  now = "2026-07-21T00:11:00.000Z";
  assert.equal((await store.getAuthorizationDecision(third.decision_ref))?.state, "expired");
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "single-after-expiry",
    evaluation: singleEvaluation(now, {
      targetRef: "target:xhs-note/2",
      ownerVersion: "2.0.0",
      expiresAt: "2026-07-21T00:20:00.000Z"
    }),
    subject: environmentAuthorizationSubject
  }), /authorization_single_action_already_decided/);
  assert.equal((await store.recordAuthorizationDecision({
    idempotency_key: "single-new-instance",
    evaluation: singleEvaluation(now, {
      actionInstance: "action-instance:single/2",
      targetRef: "target:xhs-note/2",
      ownerVersion: "2.0.0",
      expiresAt: "2026-07-21T00:20:00.000Z"
    }),
    subject: environmentAuthorizationSubject
  })).state, "active");
  await assertDenyOnce(join(directory, "deny"));
}
