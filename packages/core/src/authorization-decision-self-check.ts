import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import {
  evaluateExecutionPolicy,
  type BusinessActionCategory,
  type ExecutionPolicyEvaluationInput,
  type SingleActionDecision
} from "./execution-policy.js";
import { matchLodeBusinessActionOwner } from "./execution-policy-owner-proof.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createFileTaskThreadStore } from "./task-thread-store.js";
import { taskTurnInputSchemaVersion } from "./task-turn-input.js";

const environmentSubject = { scope: "environment", operation_ref: "harbor-operation:fixture/1" } as const;

function evaluationInput(options: {
  category?: BusinessActionCategory;
  mode?: "auto" | "confirm" | "deny";
  actionInstance?: string;
  targetRef?: string;
  origin?: string;
  evaluatedAt?: string;
  ownerVersion?: string;
} = {}): ExecutionPolicyEvaluationInput {
  const category = options.category ?? "read";
  const ownerVersion = options.ownerVersion ?? "1.0.0";
  const actionId = `xhs_${category}_note`;
  const requirementRef = `xiaohongshu.${actionId}.resources`;
  const effect = category === "commit" ? ["submit"] : category === "destructive" ? ["delete"] : [];
  const proof = matchLodeBusinessActionOwner({
    package_ref: `lode://site-capability/xiaohongshu/${category}-note@${ownerVersion}`,
    version: ownerVersion,
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: actionId,
        category,
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["note_detail"],
          supported_origins: ["https://www.xiaohongshu.com"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: requirementRef,
          profile_ids: ["note-reader"]
        },
        external_effects: effect
      }]
    }
  }, actionId, {
    schema_version: "webenvoy.harbor-resource-match.v0",
    match_ref: `resource-match:${category}/1`,
    match_version: "1",
    matched_requirement_refs: [requirementRef]
  });
  assert(proof);
  return {
    caller: "api",
    evaluated_at: options.evaluatedAt ?? "2026-07-21T00:00:00.000Z",
    action: {
      action_instance_ref: options.actionInstance ?? `action-instance:${category}/1`,
      action_id: actionId,
      target: {
        target_ref: options.targetRef ?? "target:xhs-note/1",
        target_type: "note_detail",
        site_slug: "xiaohongshu",
        origin: options.origin ?? "https://www.xiaohongshu.com/path?discarded=true"
      }
    },
    owner_proof: proof,
    context: {},
    policies: {
      global_user_config: {
        source_ref: "policy:global/1",
        source_version: "1",
        modes: { [category]: options.mode ?? "auto" }
      }
    }
  };
}

function singleDecision(input: ExecutionPolicyEvaluationInput, mode: "auto" | "deny"): SingleActionDecision {
  const confirmation = evaluateExecutionPolicy(input);
  assert(confirmation.status === "evaluated" && confirmation.confirmation_request);
  const request = confirmation.confirmation_request;
  return {
    source_ref: `decision:single/${mode}`,
    source_version: "1",
    action_instance_ref: request.action_instance_ref,
    action_id: request.action_id,
    category: request.category,
    target: request.target,
    owner_matcher: request.owner_matcher,
    owner_declaration_ref: request.owner_declaration_ref,
    owner_declaration_version: request.owner_declaration_version,
    resource_match_ref: request.resource_match_ref,
    resource_match_version: request.resource_match_version,
    effective_policy_source_ref: request.effective_policy_source_ref,
    effective_policy_source_version: request.effective_policy_source_version,
    effective_policy_source: request.effective_policy_source,
    mode,
    state: "active",
    issued_at: "2026-07-21T00:00:00.000Z",
    expires_at: "2026-07-21T00:10:00.000Z"
  };
}

async function assertTaskTurnReference(directory: string): Promise<void> {
  const runStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  const threadStore = createFileTaskThreadStore({
    directory: join(directory, "threads"),
    runRecordStore: runStore,
    resolveInputPolicy: async ({ package_ref, capability_ref }) => ({
      package_ref,
      capability_ref,
      input_schema_ref: "lode://schema/empty-input@0.1.0",
      fields: new Map()
    })
  });
  const { thread } = await threadStore.createOrGetTaskThread({
    capability_ref: "lode:capability/xiaohongshu/read-note",
    identity_environment_ref: "identity-env:fixture"
  });
  const reserved = await threadStore.reserveTaskTurn(thread.thread_id, {
    idempotency_key: "authorization-turn",
    request_hash: "authorization-turn-hash",
    run_id: "run_policy_turn",
    creation_channel: "api",
    package_ref: "lode://site-capability/xiaohongshu/read-note@1.0.0",
    input: { schema_version: taskTurnInputSchemaVersion, fields: [] }
  });
  assert(reserved.run_claim_token);
  await runStore.createRunRecord({
    run_id: reserved.turn.run_id,
    task_intent_ref: "task-intent:authorization-turn",
    capability_ref: thread.capability_ref,
    admission: { decision: "accepted", action_risk: "read" }
  }, reserved.run_claim_token);
  const decisionStore = createFileAuthorizationDecisionStore({
    directory: join(directory, "task-decisions"),
    runRecordStore: runStore,
    taskThreadStore: threadStore,
    clock: () => new Date("2026-07-21T01:00:00.000Z")
  });
  const decision = await decisionStore.recordAuthorizationDecision({
    idempotency_key: "task-system-stop",
    evaluation: evaluateExecutionPolicy({}),
    subject: {
      scope: "task",
      run_id: reserved.turn.run_id,
      thread_id: thread.thread_id,
      turn_id: reserved.turn.turn_id
    }
  });
  const replay = await decisionStore.recordAuthorizationDecision({
    idempotency_key: "task-system-stop",
    evaluation: evaluateExecutionPolicy({}),
    subject: {
      scope: "task",
      run_id: reserved.turn.run_id,
      thread_id: thread.thread_id,
      turn_id: reserved.turn.turn_id
    }
  });
  assert.equal(replay.decision_ref, decision.decision_ref);
  await assert.rejects(() => decisionStore.recordAuthorizationDecision({
    idempotency_key: "task-binding-mismatch",
    evaluation: evaluateExecutionPolicy({}),
    subject: {
      scope: "task",
      run_id: reserved.turn.run_id,
      thread_id: thread.thread_id,
      turn_id: "turn_ffffffffffffffffffffffffffffffff"
    }
  }), /authorization_task_binding_mismatch/);
  assert.equal(decision.reason?.kind, "system_stop");
  await Promise.all(Array.from({ length: 4 }, (_, index) => decisionStore.recordAuthorizationDecision({
    idempotency_key: `task-concurrent-${index}`,
    evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: `action-instance:task-concurrent/${index}` })),
    subject: {
      scope: "task",
      run_id: reserved.turn.run_id,
      thread_id: thread.thread_id,
      turn_id: reserved.turn.turn_id
    }
  })));
  assert.equal((await runStore.getRunRecord(reserved.turn.run_id))?.authorization_decision_refs?.length, 5);
  assert.equal((await threadStore.getTaskThread(thread.thread_id))?.turns[0]?.authorization_decision_refs?.length, 5);
}

export async function assertAuthorizationDecisionStore(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-authorization-decision-"));
  let now = "2026-07-21T00:00:30.000Z";
  try {
    const store = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
    const firstEvaluation = evaluateExecutionPolicy(evaluationInput());
    const [first, ...duplicates] = await Promise.all(Array.from({ length: 8 }, () => store.recordAuthorizationDecision({
      idempotency_key: "same-decision",
      evaluation: firstEvaluation,
      subject: environmentSubject,
      expires_at: "2026-07-21T00:20:00.000Z"
    })));
    assert(first);
    assert(duplicates.every((decision) => decision.decision_ref === first.decision_ref));
    assert.equal((await store.listAuthorizationDecisions()).length, 1);

    (firstEvaluation as unknown as Record<string, unknown>).raw_dom = "must-not-persist";
    const snapshotProtected = await store.recordAuthorizationDecision({
      idempotency_key: "trusted-snapshot",
      evaluation: firstEvaluation,
      subject: environmentSubject
    });
    assert.equal(JSON.stringify(snapshotProtected).includes("must-not-persist"), false);

    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: "untrusted-copy",
      evaluation: structuredClone(firstEvaluation),
      subject: environmentSubject
    }), /authorization_evaluation_untrusted/);
    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: "token-secret",
      evaluation: firstEvaluation,
      subject: environmentSubject
    }), /authorization_idempotency_key_invalid/);
    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: "sensitive-subject",
      evaluation: firstEvaluation,
      subject: { scope: "environment", operation_ref: "cookie:private" }
    }), /operation_ref_invalid/);
    const changedForConflict = evaluateExecutionPolicy(evaluationInput({ mode: "deny" }));
    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: "same-decision",
      evaluation: changedForConflict,
      subject: environmentSubject
    }), /authorization_decision_idempotency_conflict/);

    now = "2026-07-21T00:01:00.000Z";
    const changedTarget = await store.recordAuthorizationDecision({
      idempotency_key: "changed-target",
      evaluation: evaluateExecutionPolicy(evaluationInput({
        targetRef: "target:xhs-note/2",
        evaluatedAt: "2026-07-21T00:01:00.000Z"
      })),
      subject: environmentSubject
    });
    assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.invalidation_reason, "target_changed");
    assert.equal(changedTarget.state, "active");
    now = "2026-07-21T00:02:00.000Z";
    const cancelled = await store.invalidateAuthorizationDecision(changedTarget.decision_ref, "cancelled", "2026-07-21T00:02:00.000Z");
    assert.equal(cancelled.state, "invalidated");
    assert.deepEqual(await store.invalidateAuthorizationDecision(changedTarget.decision_ref, "cancelled", "2026-07-21T00:02:00.000Z"), cancelled);

    now = "2026-07-21T00:03:00.000Z";
    const expiring = await store.recordAuthorizationDecision({
      idempotency_key: "expires",
      evaluation: evaluateExecutionPolicy(evaluationInput({
        targetRef: "target:xhs-note/3",
        evaluatedAt: "2026-07-21T00:03:00.000Z"
      })),
      subject: environmentSubject,
      expires_at: "2026-07-21T00:04:00.000Z"
    });
    now = "2026-07-21T00:05:00.000Z";
    assert.equal((await store.listAuthorizationDecisions({ state: "expired" })).length, 1);
    await assert.rejects(() => store.invalidateAuthorizationDecision(expiring.decision_ref, "cancelled", now), /authorization_decision_state_conflict/);
    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: "invalid-expiry",
      evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: "action-instance:invalid-expiry/1", evaluatedAt: now })),
      subject: environmentSubject,
      expires_at: "2026-07-21T00:04:59.999Z"
    }), /authorization_decision_expiry_invalid/);
    await assert.rejects(() => store.recordAuthorizationDecision({
      idempotency_key: "stale-evaluation",
      evaluation: evaluateExecutionPolicy(evaluationInput({ targetRef: "target:xhs-note/stale", evaluatedAt: "2026-07-21T00:00:59.999Z" })),
      subject: environmentSubject
    }), /authorization_decision_time_conflict/);
    const restarted = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
    assert.equal((await restarted.listAuthorizationDecisions()).length, 4);
    now = "2026-07-21T00:08:00.000Z";

    const policyBefore = await store.recordAuthorizationDecision({
      idempotency_key: "policy-before",
      evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: "action-instance:policy-change/1", evaluatedAt: "2026-07-21T00:05:00.000Z" })),
      subject: environmentSubject
    });
    const policyAfter = await store.recordAuthorizationDecision({
      idempotency_key: "policy-after",
      evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: "action-instance:policy-change/1", mode: "deny", evaluatedAt: "2026-07-21T00:06:00.000Z" })),
      subject: environmentSubject
    });
    assert.equal((await store.getAuthorizationDecision(policyBefore.decision_ref))?.invalidation_reason, "effective_policy_changed");
    assert.equal(policyAfter.reason?.kind, "user_deny");

    const ownerBefore = await store.recordAuthorizationDecision({
      idempotency_key: "owner-before",
      evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: "action-instance:owner-change/1", evaluatedAt: "2026-07-21T00:06:00.000Z" })),
      subject: environmentSubject
    });
    await store.recordAuthorizationDecision({
      idempotency_key: "owner-after",
      evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: "action-instance:owner-change/1", ownerVersion: "2.0.0", evaluatedAt: "2026-07-21T00:07:00.000Z" })),
      subject: environmentSubject
    });
    assert.equal((await store.getAuthorizationDecision(ownerBefore.decision_ref))?.invalidation_reason, "owner_changed");

    const classificationBefore = await store.recordAuthorizationDecision({
      idempotency_key: "classification-before",
      evaluation: evaluateExecutionPolicy(evaluationInput({ actionInstance: "action-instance:classification-change/1", evaluatedAt: "2026-07-21T00:07:00.000Z" })),
      subject: environmentSubject
    });
    await store.recordAuthorizationDecision({
      idempotency_key: "classification-after",
      evaluation: evaluateExecutionPolicy(evaluationInput({ category: "commit", actionInstance: "action-instance:classification-change/1", evaluatedAt: "2026-07-21T00:08:00.000Z" })),
      subject: environmentSubject
    });
    assert.equal((await store.getAuthorizationDecision(classificationBefore.decision_ref))?.invalidation_reason, "action_reclassified");

    const dangerous = await store.recordAuthorizationDecision({
      idempotency_key: "dangerous-auto",
      evaluation: evaluateExecutionPolicy(evaluationInput({ category: "destructive", actionInstance: "action-instance:destructive/2" })),
      subject: environmentSubject
    });
    assert.equal(dangerous.effective_policy?.mode, "auto");
    assert.equal(dangerous.risk_marker, "destructive");

    for (const mode of ["auto", "deny"] as const) {
      const input = evaluationInput({ category: "commit", mode: "confirm", actionInstance: `action-instance:commit/${mode}` });
      input.policies.single_action_decision = singleDecision(input, mode);
      const once = await store.recordAuthorizationDecision({
        idempotency_key: `single-${mode}`,
        evaluation: evaluateExecutionPolicy(input),
        subject: environmentSubject
      });
      assert.equal(once.effective_policy?.source, "single_action");
      assert.equal(once.outcome, mode === "auto" ? "execute" : "stop");
      assert.equal(once.reason?.kind, mode === "deny" ? "user_deny" : undefined);
      assert.equal(once.expires_at, "2026-07-21T00:10:00.000Z");
    }

    const targetMismatch = await store.recordAuthorizationDecision({
      idempotency_key: "target-mismatch",
      evaluation: evaluateExecutionPolicy(evaluationInput({
        actionInstance: "action-instance:read/mismatch",
        origin: "https://example.com"
      })),
      subject: environmentSubject
    });
    assert.equal(targetMismatch.reason?.kind, "system_stop");
    assert.notEqual(targetMismatch.effective_policy?.mode, "deny");
    assert.equal(JSON.stringify(await store.listAuthorizationDecisions()).includes("discarded=true"), false);

    for (const caller of ["api", "cli", "mcp", "sdk", "app", "agent", "environment"] as const) {
      const input = evaluationInput({ actionInstance: `action-instance:consumer/${caller}` });
      input.caller = caller;
      const decision = await store.recordAuthorizationDecision({
        idempotency_key: `consumer-${caller}`,
        evaluation: evaluateExecutionPolicy(input),
        subject: environmentSubject
      });
      assert.equal(decision.effective_policy?.source, "global_user_config");
      assert.equal(decision.outcome, "execute");
    }

    const corruptDirectory = join(directory, "corrupt");
    const corruptStore = createFileAuthorizationDecisionStore({ directory: corruptDirectory });
    const corrupt = await corruptStore.recordAuthorizationDecision({
      idempotency_key: "corrupt-readback",
      evaluation: evaluateExecutionPolicy({}),
      subject: environmentSubject
    });
    const [journalName] = await readdir(corruptDirectory);
    assert(journalName);
    const journalPath = join(corruptDirectory, journalName);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Record<string, unknown>;
    const stored = (journal.decisions as Array<{ decision: Record<string, unknown> }>)[0]!;
    stored.decision.raw_dom = "must-not-project";
    await writeFile(journalPath, JSON.stringify(journal), "utf8");
    await assert.rejects(() => corruptStore.getAuthorizationDecision(corrupt.decision_ref), /authorization_decision_invalid/);

    await assertTaskTurnReference(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
