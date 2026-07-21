import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  authorizationEvaluationInput,
  environmentAuthorizationSubject,
  fixtureAuthorizationDecisionRef
} from "./authorization-decision-probe-fixtures.js";
import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import { readAuthorizationDecisionJournal } from "./authorization-decision-journal.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";
import {
  commitRunRecordAuthorizationDecisionRef,
  createAuthorizationDecisionRefFailureProbeStore,
  createFileRunRecordStore,
  type CreateRunRecordInput,
  type FileRunRecordStore,
  type RunRecordPatch
} from "./run-record-store.js";
import { createFileTaskThreadStore } from "./task-thread-store.js";
import { taskTurnInputSchemaVersion } from "./task-turn-input.js";

async function createTaskFixture(directory: string) {
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
    run_id: "run_policy_0",
    creation_channel: "api",
    package_ref: "lode://site-capability/xiaohongshu/read-note@1.0.0",
    input: { schema_version: taskTurnInputSchemaVersion, fields: [] }
  });
  assert(reserved.run_claim_token);
  await runStore.createRunRecord({
    run_id: reserved.turn.run_id,
    task_intent_ref: "task-intent:authorization-turn",
    capability_ref: thread.capability_ref,
    admission: { decision: "accepted", action_risk: "read" },
    authorization_decision_refs: [fixtureAuthorizationDecisionRef(999)]
  } as unknown as CreateRunRecordInput, reserved.run_claim_token);
  assert.equal((await runStore.getRunRecord(reserved.turn.run_id))?.authorization_decision_refs, undefined);
  return {
    runStore,
    threadStore,
    thread,
    subject: {
      scope: "task" as const,
      run_id: reserved.turn.run_id,
      thread_id: thread.thread_id,
      turn_id: reserved.turn.turn_id
    }
  };
}

export async function probeAuthoritativeTaskBinding(directory: string): Promise<void> {
  const fixture = await createTaskFixture(directory);
  assert.equal("commitAuthorizationDecisionRef" in fixture.runStore, false);
  const decisionDirectory = join(directory, "decisions");
  const noThreadStore = createFileAuthorizationDecisionStore({ directory: decisionDirectory, runRecordStore: fixture.runStore });
  await assert.rejects(() => noThreadStore.recordAuthorizationDecision({
    idempotency_key: "missing-thread-store",
    evaluation: evaluateExecutionPolicy({}),
    subject: fixture.subject
  }), /authorization_task_store_unavailable/);
  const store = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: fixture.runStore,
    taskThreadStore: fixture.threadStore
  });
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "missing-binding",
    evaluation: evaluateExecutionPolicy({}),
    subject: { ...fixture.subject, turn_id: "turn_ffffffffffffffffffffffffffffffff" }
  }), /authorization_task_binding_mismatch/);
  const run = await fixture.runStore.getRunRecord(fixture.subject.run_id);
  assert(run);
  const wrongRunOwnerStore = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: { ...fixture.runStore, getRunRecord: async () => ({ ...run, run_id: "run_wrong_owner" }) },
    taskThreadStore: fixture.threadStore
  });
  await assert.rejects(() => wrongRunOwnerStore.recordAuthorizationDecision({
    idempotency_key: "wrong-run-owner",
    evaluation: evaluateExecutionPolicy({}),
    subject: fixture.subject
  }), /authorization_task_binding_mismatch/);
  const wrongThreadOwnerStore = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: fixture.runStore,
    taskThreadStore: {
      getTaskThread: async () => ({ thread_id: "thread_ffffffffffffffffffffffffffffffff", turns: [] })
    }
  });
  await assert.rejects(() => wrongThreadOwnerStore.recordAuthorizationDecision({
    idempotency_key: "wrong-thread-owner",
    evaluation: evaluateExecutionPolicy({}),
    subject: fixture.subject
  }), /authorization_task_binding_mismatch/);
  await assert.rejects(() => readdir(decisionDirectory), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  const evaluation = evaluateExecutionPolicy({});
  const decision = await store.recordAuthorizationDecision({
    idempotency_key: "valid-task-binding",
    evaluation,
    subject: fixture.subject
  });
  assert.equal((await fixture.runStore.getRunRecord(fixture.subject.run_id))?.authorization_decision_refs?.[0], decision.decision_ref);
  assert.equal((await fixture.threadStore.getTaskThread(fixture.subject.thread_id))?.turns[0]?.authorization_decision_refs?.[0], decision.decision_ref);
  await fixture.runStore.updateRunRecord(fixture.subject.run_id, {
    authorization_decision_refs: []
  } as unknown as RunRecordPatch);
  assert.deepEqual(
    (await fixture.runStore.getRunRecord(fixture.subject.run_id))?.authorization_decision_refs,
    [decision.decision_ref]
  );
  const stream = decision.decision_ref.split(":")[1]!;
  const journal = await readAuthorizationDecisionJournal(decisionDirectory, stream);
  const prepared = journal.decisions[0]!;
  const legacyRequestHash = createHash("sha256").update(JSON.stringify({
    subject: fixture.subject,
    evaluation,
    requested_action: null,
    owner_proof: null,
    expires_at: null
  })).digest("hex");
  assert.equal(prepared.request_hash, legacyRequestHash, "non-single decisions must retain the pre-#303 request hash");
  await assert.rejects(() => commitRunRecordAuthorizationDecisionRef(
    fixture.runStore,
    fixture.subject.run_id,
    decisionDirectory,
    stream,
    { request_hash: prepared.request_hash, decision: prepared.decision },
    "2026-07-21T00:01:00.000Z",
    structuredClone(evaluation),
    "valid-task-binding"
  ), /authorization_evaluation_untrusted/);
}

function failTransactionOnce(runStore: FileRunRecordStore, phase: "prepare" | "commit"): FileRunRecordStore {
  return createAuthorizationDecisionRefFailureProbeStore(runStore, phase);
}

async function assertRecoverableCommit(directory: string, phase: "prepare" | "commit"): Promise<void> {
  const fixture = await createTaskFixture(directory);
  const runStore = failTransactionOnce(fixture.runStore, phase);
  const store = createFileAuthorizationDecisionStore({
    directory: join(directory, "decisions"),
    runRecordStore: runStore,
    taskThreadStore: fixture.threadStore
  });
  const input = { idempotency_key: "recoverable-commit", evaluation: evaluateExecutionPolicy({}), subject: fixture.subject };
  await assert.rejects(() => store.recordAuthorizationDecision(input), new RegExp(`injected_${phase}_failure`));
  if (phase === "prepare") {
    assert.equal((await fixture.runStore.getRunRecord(fixture.subject.run_id))?.authorization_decision_refs, undefined);
    await assert.rejects(() => store.recordAuthorizationDecision({
      ...input,
      idempotency_key: "different-key-during-recovery"
    }), /authorization_decision_pending/);
  } else {
    assert.equal((await store.queryAuthorizationDecisions()).authorization_decisions.length, 0);
  }
  const recovered = await store.recordAuthorizationDecision(input);
  assert.equal((await store.getAuthorizationDecision(recovered.decision_ref))?.decision_ref, recovered.decision_ref);
  assert.deepEqual((await fixture.runStore.getRunRecord(fixture.subject.run_id))?.authorization_decision_refs, [recovered.decision_ref]);
  const [journalFile] = await readdir(join(directory, "decisions"));
  const journal = JSON.parse(await readFile(join(directory, "decisions", journalFile!), "utf8")) as {
    decisions: Array<{ commit_state: string }>;
  };
  assert.equal(journal.decisions[0]?.commit_state, "committed");
}

async function assertPrepareFailureKeepsPreviousDecisionActive(directory: string): Promise<void> {
  const fixture = await createTaskFixture(directory);
  const decisionDirectory = join(directory, "decisions");
  let now = "2026-07-21T00:01:00.000Z";
  const store = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: fixture.runStore,
    taskThreadStore: fixture.threadStore,
    clock: () => new Date(now)
  });
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "stable-before-prepare-failure",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput()),
    subject: fixture.subject
  });
  now = "2026-07-21T00:02:00.000Z";
  const failing = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: failTransactionOnce(fixture.runStore, "prepare"),
    taskThreadStore: fixture.threadStore,
    clock: () => new Date(now)
  });
  await assert.rejects(() => failing.recordAuthorizationDecision({
    idempotency_key: "target-change-prepare-failure",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({
      evaluatedAt: now,
      targetRef: "target:xhs-note/2"
    })),
    subject: fixture.subject
  }), /injected_prepare_failure/);
  assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.state, "active");
}

async function assertPreparedRecoveryRejectsDecisionDrift(directory: string): Promise<void> {
  const fixture = await createTaskFixture(directory);
  const decisionDirectory = join(directory, "decisions");
  const input = {
    idempotency_key: "prepared-decision-drift",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput()),
    subject: fixture.subject
  };
  const failing = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: failTransactionOnce(fixture.runStore, "prepare"),
    taskThreadStore: fixture.threadStore
  });
  await assert.rejects(() => failing.recordAuthorizationDecision(input), /injected_prepare_failure/);
  const [journalFile] = (await readdir(decisionDirectory)).filter((file) => file.endsWith(".json"));
  const journalPath = join(decisionDirectory, journalFile!);
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    decisions: Array<{ decision: { applicability: { thread_id: string; turn_id: string } } }>;
  };
  journal.decisions[0]!.decision.applicability.thread_id = "thread_ffffffffffffffffffffffffffffffff";
  journal.decisions[0]!.decision.applicability.turn_id = "turn_ffffffffffffffffffffffffffffffff";
  await writeFile(journalPath, JSON.stringify(journal), "utf8");
  const store = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: fixture.runStore,
    taskThreadStore: fixture.threadStore
  });
  await assert.rejects(() => store.recordAuthorizationDecision(input), /authorization_decision_journal_invalid/);
  assert.equal((await fixture.runStore.getRunRecord(fixture.subject.run_id))?.authorization_decision_refs, undefined);
}

async function assertLateCommitRecoveryCannotReactivateStaleEvaluation(directory: string): Promise<void> {
  const fixture = await createTaskFixture(directory);
  const decisionDirectory = join(directory, "decisions");
  let now = "2026-07-21T00:01:00.000Z";
  const store = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: fixture.runStore,
    taskThreadStore: fixture.threadStore,
    clock: () => new Date(now)
  });
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "expiring-before-commit-failure",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ evaluatedAt: now })),
    subject: fixture.subject,
    expires_at: "2026-07-21T00:10:00.000Z"
  });
  now = "2026-07-21T00:05:00.000Z";
  const input = {
    idempotency_key: "stale-commit-recovery",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({
      evaluatedAt: now,
      targetRef: "target:xhs-note/2"
    })),
    subject: fixture.subject
  };
  const failing = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: failTransactionOnce(fixture.runStore, "commit"),
    taskThreadStore: fixture.threadStore,
    clock: () => new Date(now)
  });
  await assert.rejects(() => failing.recordAuthorizationDecision(input), /injected_commit_failure/);
  now = "2026-07-21T00:20:00.000Z";
  assert.equal((await store.recordAuthorizationDecision(input)).state, "expired");
  assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.state, "expired");
}

async function assertCapacityPreflight(directory: string): Promise<void> {
  const fixture = await createTaskFixture(directory);
  const decisionDirectory = join(directory, "decisions");
  const store = createFileAuthorizationDecisionStore({
    directory: decisionDirectory,
    runRecordStore: fixture.runStore,
    taskThreadStore: fixture.threadStore
  });
  for (let index = 0; index < 64; index += 1) {
    await store.recordAuthorizationDecision({
      idempotency_key: `capacity-${index}`,
      evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({
        actionInstance: `action-instance:capacity/${index}`
      })),
      subject: fixture.subject
    });
  }
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "capacity-boundary",
    evaluation: evaluateExecutionPolicy({}),
    subject: fixture.subject
  }), /authorization_decision_refs_full/);
  assert.equal((await readdir(decisionDirectory)).filter((file) => file.endsWith(".json")).length, 64);
  assert.equal((await fixture.runStore.getRunRecord(fixture.subject.run_id))?.authorization_decision_refs?.length, 64);
}

export async function probeRecoverableTaskCommit(directory: string): Promise<void> {
  await assertRecoverableCommit(join(directory, "prepare-recovery"), "prepare");
  await assertRecoverableCommit(join(directory, "commit-recovery"), "commit");
  await assertPrepareFailureKeepsPreviousDecisionActive(join(directory, "prepare-binding"));
  await assertPreparedRecoveryRejectsDecisionDrift(join(directory, "prepared-drift"));
  await assertLateCommitRecoveryCannotReactivateStaleEvaluation(join(directory, "late-commit-recovery"));
  await assertCapacityPreflight(join(directory, "capacity"));
}

async function assertSecurityBoundaries(directory: string): Promise<void> {
  const store = createFileAuthorizationDecisionStore({ directory });
  const evaluation = evaluateExecutionPolicy(authorizationEvaluationInput());
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "same-decision",
    evaluation,
    subject: environmentAuthorizationSubject
  });
  (evaluation as unknown as Record<string, unknown>).raw_dom = "must-not-persist";
  const protectedDecision = await store.recordAuthorizationDecision({
    idempotency_key: "trusted-snapshot",
    evaluation,
    subject: environmentAuthorizationSubject
  });
  assert.equal(JSON.stringify(protectedDecision).includes("must-not-persist"), false);
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "untrusted-copy",
    evaluation: structuredClone(evaluation),
    subject: environmentAuthorizationSubject
  }), /authorization_evaluation_untrusted/);
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "same-decision",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ mode: "deny" })),
    subject: environmentAuthorizationSubject
  }), /authorization_decision_idempotency_conflict/);
  assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.state, "active");
}

async function assertBindingInvalidations(directory: string): Promise<void> {
  let now = "2026-07-21T00:01:00.000Z";
  const store = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "target-before",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput()),
    subject: environmentAuthorizationSubject
  });
  await store.recordAuthorizationDecision({
    idempotency_key: "target-after",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ targetRef: "target:xhs-note/2", evaluatedAt: now })),
    subject: environmentAuthorizationSubject
  });
  assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.invalidation_reason, "target_changed");
  now = "2026-07-21T00:02:00.000Z";
  const owner = await store.recordAuthorizationDecision({
    idempotency_key: "owner-before",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ actionInstance: "action-instance:owner/1", evaluatedAt: now })),
    subject: environmentAuthorizationSubject
  });
  now = "2026-07-21T00:03:00.000Z";
  await store.recordAuthorizationDecision({
    idempotency_key: "owner-after",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ actionInstance: "action-instance:owner/1", ownerVersion: "2.0.0", evaluatedAt: now })),
    subject: environmentAuthorizationSubject
  });
  assert.equal((await store.getAuthorizationDecision(owner.decision_ref))?.invalidation_reason, "owner_changed");
}

async function assertExpiredDecisionCannotBeBackfilled(directory: string): Promise<void> {
  const now = "2026-07-21T00:20:00.000Z";
  const store = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "expires-before-late-event",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput()),
    subject: environmentAuthorizationSubject,
    expires_at: "2026-07-21T00:10:00.000Z"
  });
  assert.equal(first.state, "expired");
  await assert.rejects(() => store.invalidateAuthorizationDecision(
    first.decision_ref,
    "completed",
    "2026-07-21T00:05:00.000Z"
  ), /authorization_decision_state_conflict/);
  await assert.rejects(() => store.recordAuthorizationDecision({
    idempotency_key: "late-target-change",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({
      evaluatedAt: "2026-07-21T00:05:00.000Z",
      targetRef: "target:xhs-note/2"
    })),
    subject: environmentAuthorizationSubject
  }), /authorization_decision_time_conflict/);
  assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.state, "expired");
}

async function assertPolicyInvalidations(directory: string): Promise<void> {
  let now = "2026-07-21T00:01:00.000Z";
  const store = createFileAuthorizationDecisionStore({ directory, clock: () => new Date(now) });
  const first = await store.recordAuthorizationDecision({
    idempotency_key: "policy-ref-before",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({
      actionInstance: "action-instance:policy/1",
      evaluatedAt: now
    })),
    subject: environmentAuthorizationSubject
  });
  now = "2026-07-21T00:02:00.000Z";
  const second = await store.recordAuthorizationDecision({
    idempotency_key: "policy-ref-after",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({
      actionInstance: "action-instance:policy/1",
      evaluatedAt: now,
      policyRef: "policy:global/2"
    })),
    subject: environmentAuthorizationSubject
  });
  assert.equal((await store.getAuthorizationDecision(first.decision_ref))?.invalidation_reason, "effective_policy_changed");
  now = "2026-07-21T00:03:00.000Z";
  const threadInput = authorizationEvaluationInput({ actionInstance: "action-instance:policy/1", evaluatedAt: now });
  delete threadInput.policies.global_user_config;
  threadInput.context.thread_ref = "thread-policy:fixture/1";
  threadInput.policies.thread_revision = {
    source_ref: "policy:thread/1",
    source_version: "1",
    thread_ref: threadInput.context.thread_ref,
    modes: { read: "auto" }
  };
  const third = await store.recordAuthorizationDecision({
    idempotency_key: "policy-source-after",
    evaluation: evaluateExecutionPolicy(threadInput),
    subject: environmentAuthorizationSubject
  });
  assert.equal((await store.getAuthorizationDecision(second.decision_ref))?.invalidation_reason, "effective_policy_changed");
  assert.equal(third.effective_policy?.source, "thread_revision");
  assert.deepEqual(third.applicability.config_refs, ["policy:thread/1"]);
}

export async function probeImmutableSecurityAndInvalidation(directory: string): Promise<void> {
  await assertSecurityBoundaries(join(directory, "security"));
  await assertBindingInvalidations(join(directory, "invalidation"));
  await assertExpiredDecisionCannotBeBackfilled(join(directory, "expiry-terminal"));
  await assertPolicyInvalidations(join(directory, "policy-invalidation"));
  const store = createFileAuthorizationDecisionStore({ directory: join(directory, "risk") });
  const dangerous = await store.recordAuthorizationDecision({
    idempotency_key: "dangerous-auto",
    evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ category: "destructive" })),
    subject: environmentAuthorizationSubject
  });
  assert.equal(dangerous.effective_policy?.mode, "auto");
  assert.equal(dangerous.risk_marker, "destructive");
}
