import assert from "node:assert/strict";

import {
  actionOwnerMatchSchemaVersion,
  evaluateExecutionPolicy,
  type ExecutionPolicyCaller,
  type ExecutionPolicyEvaluation,
  type ExecutionPolicyEvaluationInput,
  type SingleActionDecision
} from "./execution-policy.js";
import { createLodeBusinessActionOwnerMatch } from "./lode-admission.js";
import { createHarborBusinessActionOwnerMatch } from "./harbor-admission.js";

const allCallers: readonly ExecutionPolicyCaller[] = ["api", "cli", "mcp", "sdk", "app", "agent", "environment"];

function input(category: "read" | "prepare" | "commit" | "destructive" = "commit"): ExecutionPolicyEvaluationInput {
  const packageRef = "lode://site-capability/xiaohongshu/publish-note@1.0.0";
  const resourceRequirementRefs = ["xiaohongshu.publish-note.resources"];
  const ownerMatch = createLodeBusinessActionOwnerMatch({
    ok: true,
    package_ref: packageRef,
    capability_version: "1.0.0",
    resource_requirement_refs: resourceRequirementRefs,
    required_harbor_facts: []
  }, {
    schema_version: actionOwnerMatchSchemaVersion,
    matcher: "lode_package_admission",
    owner_declaration_ref: `${packageRef}#xhs_publish_note`,
    owner_declaration_version: "1.0.0",
    resource_match_ref: "resource-match:xhs/publish/1",
    resource_match_version: "1",
    action_id: "xhs_publish_note",
    categories: [category],
    target_scope: {
      target_types: ["creator_publish_page"],
      site_slug: "xiaohongshu",
      supported_origins: ["https://creator.xiaohongshu.com"]
    },
    resource_requirement_refs: resourceRequirementRefs
  });
  if (!ownerMatch) throw new Error("Lode owner match fixture is invalid");
  return {
    caller: "api",
    evaluated_at: "2026-07-21T00:00:00.000Z",
    action: {
      action_instance_ref: "action-instance:publish-note/1",
      action_id: "xhs_publish_note",
      target: {
        target_ref: "target:creator-note/1",
        target_type: "creator_publish_page",
        site_slug: "xiaohongshu",
        origin: "https://creator.xiaohongshu.com/publish"
      }
    },
    owner_match: ownerMatch,
    context: { thread_ref: "thread:1", skill_ref: "skill:user/xhs@3" },
    policies: {
      thread_revision: { source_ref: "policy:thread/2", source_version: "2", thread_ref: "thread:1", modes: { commit: "confirm" } },
      installed_skill_user_version: { source_ref: "policy:skill/3", source_version: "3", skill_ref: "skill:user/xhs@3", modes: { commit: "auto" } },
      global_user_config: {
        source_ref: "policy:global/4",
        source_version: "4",
        modes: { read: "auto", prepare: "auto", commit: "deny", destructive: "confirm" }
      }
    }
  };
}

function single(value: ExecutionPolicyEvaluationInput, mode: "auto" | "deny" = "auto"): SingleActionDecision {
  return {
    source_ref: "decision:once/1",
    source_version: "1",
    action_instance_ref: value.action.action_instance_ref,
    action_id: value.action.action_id,
    category: value.owner_match.categories[0]!,
    target: { ...value.action.target },
    owner_matcher: value.owner_match.matcher,
    owner_declaration_ref: value.owner_match.owner_declaration_ref,
    owner_declaration_version: value.owner_match.owner_declaration_version,
    resource_match_ref: value.owner_match.resource_match_ref,
    resource_match_version: value.owner_match.resource_match_version,
    effective_policy_source_ref: value.policies.thread_revision!.source_ref,
    effective_policy_source_version: value.policies.thread_revision!.source_version,
    effective_policy_source: "thread_revision",
    mode,
    state: "active",
    issued_at: "2026-07-20T23:59:00.000Z",
    expires_at: "2026-07-21T00:05:00.000Z"
  };
}

function assertCurrentConfirm(result: ExecutionPolicyEvaluation): void {
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") throw new Error("policy must be evaluated");
  assert.equal(result.next_step, "request_confirmation");
  assert.equal(result.effective_policy.source, "thread_revision");
  assert.equal(result.effective_policy.source_version, "2");
}

function assertInvalid(value: unknown): void {
  assert.deepEqual(evaluateExecutionPolicy(value), {
    schema_version: "webenvoy.execution-policy-evaluation.v0",
    status: "stopped",
    next_step: "stop",
    stop_reason: "invalid_input"
  });
}

function assertSingleDecisionRules(): void {
  const confirm = input();
  confirm.policies.single_action_decision = single(confirm);
  const allowedOnce = evaluateExecutionPolicy(confirm);
  assert.equal(allowedOnce.status === "evaluated" && allowedOnce.next_step, "execute");
  assert.equal(allowedOnce.status === "evaluated" && allowedOnce.effective_policy.source, "single_action_decision");

  confirm.policies.single_action_decision = single(confirm, "deny");
  const deniedOnce = evaluateExecutionPolicy(confirm);
  assert.equal(deniedOnce.status === "evaluated" && deniedOnce.next_step, "stop");
  assert.equal(deniedOnce.status === "evaluated" && deniedOnce.effective_policy.source, "single_action_decision");

  const denied = input();
  denied.policies.thread_revision!.modes.commit = "deny";
  denied.policies.single_action_decision = single(denied, "auto");
  const stillDenied = evaluateExecutionPolicy(denied);
  assert.equal(stillDenied.status === "evaluated" && stillDenied.next_step, "stop");
  assert.equal(stillDenied.status === "evaluated" && stillDenied.effective_policy.source, "thread_revision");

  const automatic = input();
  automatic.policies.thread_revision!.modes.commit = "auto";
  automatic.policies.single_action_decision = single(automatic, "deny");
  const stillAutomatic = evaluateExecutionPolicy(automatic);
  assert.equal(stillAutomatic.status === "evaluated" && stillAutomatic.next_step, "execute");
  assert.equal(stillAutomatic.status === "evaluated" && stillAutomatic.effective_policy.source, "thread_revision");

  const invalidations: readonly ((decision: SingleActionDecision) => void)[] = [
    (decision) => { decision.action_instance_ref = "action-instance:other"; },
    (decision) => { decision.action_id = "other_action"; },
    (decision) => { decision.category = "prepare"; },
    (decision) => { decision.target.target_ref = "target:other"; },
    (decision) => { decision.target.target_type = "other_target"; },
    (decision) => { decision.target.site_slug = "other-site"; },
    (decision) => { decision.target.origin = "https://www.xiaohongshu.com"; },
    (decision) => { decision.owner_matcher = "harbor_admission"; },
    (decision) => { decision.owner_declaration_ref = "lode://other"; },
    (decision) => { decision.owner_declaration_version = "2.0.0"; },
    (decision) => { decision.resource_match_ref = "resource-match:other"; },
    (decision) => { decision.resource_match_version = "2"; },
    (decision) => { decision.effective_policy_source_ref = "policy:other"; },
    (decision) => { decision.effective_policy_source_version = "3"; },
    (decision) => { decision.effective_policy_source = "global_user_config"; },
    (decision) => { decision.issued_at = "2026-07-21T00:01:00.000Z"; },
    (decision) => { decision.expires_at = "2026-07-21T00:00:00.000Z"; }
  ];
  for (const invalidate of invalidations) {
    const current = input();
    current.policies.single_action_decision = single(current);
    invalidate(current.policies.single_action_decision);
    assertCurrentConfirm(evaluateExecutionPolicy(current));
  }
  for (const state of ["consumed", "cancelled", "expired", "target_changed"] as const) {
    const current = input();
    current.policies.single_action_decision = { ...single(current), state };
    assertCurrentConfirm(evaluateExecutionPolicy(current));
  }

  const changedPolicySource = input();
  changedPolicySource.policies.single_action_decision = single(changedPolicySource);
  changedPolicySource.policies.thread_revision!.thread_ref = "thread:other";
  changedPolicySource.policies.installed_skill_user_version!.modes.commit = "confirm";
  const recalculated = evaluateExecutionPolicy(changedPolicySource);
  assert.equal(recalculated.status === "evaluated" && recalculated.effective_policy.source, "installed_skill_user_version");
  assert.equal(recalculated.status === "evaluated" && recalculated.next_step, "request_confirmation");

  const changedCurrentTarget = input();
  changedCurrentTarget.policies.single_action_decision = single(changedCurrentTarget);
  changedCurrentTarget.action.target.target_ref = "target:creator-note/2";
  assertCurrentConfirm(evaluateExecutionPolicy(changedCurrentTarget));
}

function assertOwnerMatchAndParser(): void {
  const conflict = input();
  conflict.owner_match.categories = ["commit", "commit"];
  assert.equal(evaluateExecutionPolicy(conflict).status === "stopped" && evaluateExecutionPolicy(conflict).stop_reason, "owner_match_conflict");

  const resourceConflict = input();
  resourceConflict.owner_match.resource_requirement_refs = ["same", "same"];
  assert.equal(evaluateExecutionPolicy(resourceConflict).status === "stopped" && evaluateExecutionPolicy(resourceConflict).stop_reason, "owner_match_conflict");

  const scopeConflict = input();
  scopeConflict.owner_match.target_scope.target_types = ["creator_publish_page", "creator_publish_page"];
  assert.equal(evaluateExecutionPolicy(scopeConflict).status === "stopped" && evaluateExecutionPolicy(scopeConflict).stop_reason, "owner_match_conflict");

  const targetMismatch = input();
  targetMismatch.action.target.origin = "https://www.xiaohongshu.com";
  assert.equal(evaluateExecutionPolicy(targetMismatch).status === "stopped" && evaluateExecutionPolicy(targetMismatch).stop_reason, "target_mismatch");

  const undeclared = input();
  undeclared.owner_match.action_id = "other_action";
  assert.equal(evaluateExecutionPolicy(undeclared).status === "stopped" && evaluateExecutionPolicy(undeclared).stop_reason, "action_undeclared");

  const base = input();
  assertInvalid({ ...base, caller: "web" });
  assertInvalid({ ...base, evaluated_at: "2026-07-21" });
  assertInvalid({ ...base, evaluated_at: "NaN" });
  assertInvalid({ ...base, evaluated_at: Number.NaN });
  assertInvalid({ ...base, evaluated_at: "2026-02-30T00:00:00Z" });
  assertInvalid({ ...base, evaluated_at: "2026-07-21T00:00:00+24:00" });
  assertInvalid({ ...base, unknown: true });
  assertInvalid({ ...base, action: { ...base.action, click: true } });
  assertInvalid({ ...base, owner: "Lode", declaration: { action_id: base.action.action_id } });
  assertInvalid({ ...base, owner_match: { ...base.owner_match, unknown: true } });
  assertInvalid({ ...base, owner_match: { ...base.owner_match, categories: ["click"] } });
  assertInvalid({ ...base, policies: { ...base.policies, skill_recommendation: { commit: "auto" } } });
  assertInvalid({ ...base, policies: { ...base.policies, thread_revision: { ...base.policies.thread_revision, source_version: undefined } } });
  assertInvalid({ ...base, policies: { ...base.policies, single_action_decision: { ...single(base), issued_at: "2026-07-21" } } });
  assertInvalid(null);

  for (const actionId of ["click", "browser.type", "page_scroll"] as const) {
    const atomic = input();
    atomic.action.action_id = actionId;
    atomic.owner_match.action_id = actionId;
    const result = evaluateExecutionPolicy(atomic);
    assert.equal(result.status === "stopped" && result.stop_reason, "action_unclassifiable");
  }
}

function assertOwnerMatcherProofs(): void {
  const valid = input().owner_match;
  const admission = {
    ok: true as const,
    package_ref: "lode://site-capability/xiaohongshu/publish-note@1.0.0",
    capability_version: "1.0.0",
    resource_requirement_refs: ["xiaohongshu.publish-note.resources"],
    required_harbor_facts: []
  };
  assert(createLodeBusinessActionOwnerMatch(admission, valid));
  assert.equal(createLodeBusinessActionOwnerMatch({ ...admission, capability_version: "2.0.0" }, valid), undefined);
  assert.equal(createLodeBusinessActionOwnerMatch(admission, { ...valid, resource_requirement_refs: ["other.resources"] }), undefined);
  assert.equal(createLodeBusinessActionOwnerMatch({ ok: false, failure: { category: "resource_admission", code: "missing", phase: "resource_matching", recovery_hint: "repair" } }, valid), undefined);
  assert.equal(createHarborBusinessActionOwnerMatch({ ok: true, runtime_binding_refs: [], evidence_refs: [] }, valid), undefined);
  assert.equal(createHarborBusinessActionOwnerMatch({ ok: true, runtime_binding_refs: [], evidence_refs: [] }, { ...valid, matcher: "harbor_admission", owner_declaration_ref: "lode://not-harbor" }), undefined);
}

export function assertExecutionPolicyEvaluator(): void {
  const confirmation = evaluateExecutionPolicy(input());
  assertCurrentConfirm(confirmation);
  assert.equal(confirmation.status === "evaluated" && confirmation.confirmation_request?.effective_policy_source_version, "2");
  assert.deepEqual(confirmation.status === "evaluated" && confirmation.confirmation_request?.target, input().action.target);

  assertSingleDecisionRules();
  assertOwnerMatchAndParser();
  assertOwnerMatcherProofs();

  const skillFallback = input();
  skillFallback.policies.thread_revision!.thread_ref = "thread:other";
  const skillDecision = evaluateExecutionPolicy(skillFallback);
  assert.equal(skillDecision.status === "evaluated" && skillDecision.effective_policy.source, "installed_skill_user_version");
  assert.equal(skillDecision.status === "evaluated" && skillDecision.effective_policy.source_version, "3");

  const destructive = input("destructive");
  destructive.policies.thread_revision!.modes.destructive = "auto";
  const dangerousAuto = evaluateExecutionPolicy(destructive);
  assert.equal(dangerousAuto.status === "evaluated" && dangerousAuto.next_step, "execute");
  assert.equal(dangerousAuto.status === "evaluated" && dangerousAuto.risk_marker, "destructive");

  const environment = input();
  environment.caller = "environment";
  environment.action = { action_instance_ref: "action-instance:install-provider/1", action_id: "install_provider", target: { target_ref: "target:provider/chrome", target_type: "provider_installation" } };
  const harborMatch = createHarborBusinessActionOwnerMatch({ ok: true, runtime_binding_refs: [], evidence_refs: [] }, {
    ...environment.owner_match,
    matcher: "harbor_admission",
    owner_declaration_ref: "harbor://operation/install-provider",
    action_id: "install_provider",
    categories: ["commit"],
    target_scope: { target_types: ["provider_installation"] }
  });
  if (!harborMatch) throw new Error("Harbor owner match fixture is invalid");
  environment.owner_match = harborMatch;
  assert.equal(evaluateExecutionPolicy(environment).next_step, "request_confirmation");

  for (const caller of allCallers) {
    const current = input("read");
    current.caller = caller;
    current.policies.thread_revision!.modes.read = "auto";
    assert.deepEqual(evaluateExecutionPolicy(current), evaluateExecutionPolicy({ ...current, caller: "api" }));
  }
}
