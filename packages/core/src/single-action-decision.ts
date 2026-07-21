import { createHash } from "node:crypto";

import type { AuthorizationDecisionSummary } from "./authorization-decision.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { ConfigurableExecutionPolicySource, SingleActionDecisionCommand } from "./execution-policy-config.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import type { SingleActionDecision } from "./execution-policy.js";
import type { FileTaskThreadStore } from "./task-thread-types.js";

export type SingleActionDecisionDependencies = {
  authorizationDecisionStore: FileAuthorizationDecisionStore;
  configStore: FileExecutionPolicyConfigStore;
  taskThreadStore?: FileTaskThreadStore;
  clock?: () => Date;
};

const terminalTurnStatuses = new Set(["completed", "failed", "cancelled", "status_unknown"]);

function singleActionSourceRef(decisionRef: string): string {
  const digest = createHash("sha256").update(decisionRef).digest("hex").slice(0, 32);
  return `execution-policy:single-action:${digest}`;
}

function configurableSource(decision: AuthorizationDecisionSummary): ConfigurableExecutionPolicySource {
  const source = decision.effective_policy?.source;
  if (source !== "thread_revision" && source !== "installed_skill_user_version" && source !== "global_user_config") {
    throw new Error("single_action_confirmation_invalid");
  }
  return source;
}

async function taskTurnSequence(
  decision: AuthorizationDecisionSummary,
  store?: FileTaskThreadStore
): Promise<{ thread_ref?: string; turn_sequence?: number }> {
  const applicability = decision.applicability;
  if (applicability.scope !== "task") return {};
  if (!store) throw new Error("execution_policy_thread_store_unavailable");
  const thread = await store.getTaskThread(applicability.thread_id);
  const turn = thread?.turns.find((candidate) => candidate.turn_id === applicability.turn_id);
  if (!thread || !turn || turn.run_id !== applicability.run_id) {
    throw new Error("single_action_confirmation_binding_mismatch");
  }
  if (terminalTurnStatuses.has(turn.status)) throw new Error("single_action_confirmation_inactive");
  return { thread_ref: thread.thread_id, turn_sequence: turn.sequence };
}

function assertActiveConfirmation(decision: AuthorizationDecisionSummary, now: string): void {
  if (decision.state === "expired" || decision.expires_at !== null && Date.parse(decision.expires_at) <= Date.parse(now)) {
    throw new Error("single_action_confirmation_expired");
  }
  if (decision.state !== "active") throw new Error(`single_action_confirmation_${decision.invalidation_reason ?? "inactive"}`);
  if (decision.outcome !== "confirm" || decision.effective_policy?.mode !== "confirm" ||
    !decision.business_action || !decision.owner_declaration || decision.expires_at === null ||
    decision.applicability.config_refs.length !== 1) {
    throw new Error("single_action_confirmation_invalid");
  }
}

export async function decideSingleAction(
  confirmationDecisionRef: string,
  command: SingleActionDecisionCommand,
  dependencies: SingleActionDecisionDependencies
): Promise<SingleActionDecision> {
  const replay = await dependencies.configStore.getSingleActionDecision(
    confirmationDecisionRef,
    command.idempotency_key
  );
  if (replay) return replay;
  const confirmation = await dependencies.authorizationDecisionStore.getAuthorizationDecision(confirmationDecisionRef);
  if (!confirmation) throw new Error("single_action_confirmation_not_found");
  const now = (dependencies.clock ?? (() => new Date()))().toISOString();
  assertActiveConfirmation(confirmation, now);
  const source = configurableSource(confirmation);
  const binding = await taskTurnSequence(confirmation, dependencies.taskThreadStore);
  const applies = await dependencies.configStore.sourceVersionApplies({
    source,
    source_ref: confirmation.applicability.config_refs[0]!,
    source_version: confirmation.effective_policy!.source_version,
    ...binding
  });
  if (!applies) throw new Error("single_action_confirmation_effective_policy_changed");
  const action = confirmation.business_action!;
  const owner = confirmation.owner_declaration!;
  const decision: SingleActionDecision = {
    schema_version: "webenvoy.single-action-decision.v0",
    confirmation_decision_ref: confirmation.decision_ref,
    source_ref: singleActionSourceRef(confirmation.decision_ref),
    source_version: "1",
    action_instance_ref: action.action_instance_ref,
    action_id: action.action_id,
    category: action.category!,
    target: action.target,
    owner_matcher: owner.matcher,
    owner_declaration_ref: owner.declaration_ref,
    owner_declaration_version: owner.declaration_version,
    resource_match_ref: owner.resource_match_ref,
    resource_match_version: owner.resource_match_version,
    effective_policy_source_ref: confirmation.applicability.config_refs[0]!,
    effective_policy_source_version: confirmation.effective_policy!.source_version,
    effective_policy_source: source,
    mode: command.choice === "allow_once" ? "auto" : "deny",
    state: "active",
    issued_at: now,
    expires_at: confirmation.expires_at!
  };
  return dependencies.configStore.recordSingleActionDecision({
    confirmation_decision_ref: confirmation.decision_ref,
    idempotency_key: command.idempotency_key,
    decision
  });
}
