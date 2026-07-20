import assert from "node:assert/strict";

import {
  evaluateExecutionPolicy,
  type BusinessActionCategory,
  type BusinessActionOwnerProof,
  type ExecutionPolicyCaller,
  type ExecutionPolicyEvaluation,
  type ExecutionPolicyEvaluationInput,
  type SingleActionDecision
} from "./execution-policy.js";
import {
  matchHarborBusinessOperationOwner,
  matchLodeBusinessActionOwner,
  type HarborResourceMatchContract,
  type LodeBusinessActionOwnerContract
} from "./execution-policy-owner-proof.js";

const allCallers: readonly ExecutionPolicyCaller[] = ["api", "cli", "mcp", "sdk", "app", "agent", "environment"];
const packageRef = "lode://site-capability/xiaohongshu/publish-note@1.0.0";
const requirementRef = "xiaohongshu.publish-note.resources";

function resourceMatch(overrides: Partial<HarborResourceMatchContract> = {}): HarborResourceMatchContract {
  return {
    schema_version: "webenvoy.harbor-resource-match.v0",
    match_ref: "resource-match:xhs/publish/1",
    match_version: "1",
    matched_requirement_refs: [requirementRef],
    ...overrides
  };
}

function lodeContract(category: BusinessActionCategory = "commit"): LodeBusinessActionOwnerContract {
  return {
    package_ref: packageRef,
    version: "1.0.0",
    action_declaration: {
      schema_version: "lode.capability-action-declaration.v0",
      schema_ref: "lode://schema/capability-action-declaration@0.1.0",
      actions: [{
        action_id: "xhs_publish_note",
        category,
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["creator_publish_page"],
          supported_origins: ["https://creator.xiaohongshu.com/owner-contract-path?not-echoed=true"]
        },
        resource_requirements: {
          path: "resource-requirements.json",
          id: requirementRef,
          profile_ids: ["xhs-creator-publish-page"]
        },
        external_effects: category === "commit" ? ["submit"] : category === "destructive" ? ["delete"] : []
      }]
    }
  };
}

function lodeProof(category: BusinessActionCategory = "commit", contract = lodeContract(category)): BusinessActionOwnerProof {
  const proof = matchLodeBusinessActionOwner(contract, "xhs_publish_note", resourceMatch());
  if (!proof) throw new Error("authoritative Lode owner contract did not match");
  return proof;
}

function input(category: BusinessActionCategory = "commit", ownerProof = lodeProof(category)): ExecutionPolicyEvaluationInput {
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
        origin: "https://creator.xiaohongshu.com/current/path?credential=never-echoed"
      }
    },
    owner_proof: ownerProof,
    context: { thread_ref: "thread:1", skill_ref: "skill:user/xhs@3" },
    policies: {
      thread_revision: { source_ref: "policy:thread/2", source_version: "2", thread_ref: "thread:1", modes: { [category]: "confirm" } },
      installed_skill_user_version: { source_ref: "policy:skill/3", source_version: "3", skill_ref: "skill:user/xhs@3", modes: { [category]: "auto" } },
      global_user_config: {
        source_ref: "policy:global/4",
        source_version: "4",
        modes: { read: "auto", prepare: "auto", commit: "deny", destructive: "confirm" }
      }
    }
  };
}

function assertCurrentConfirm(result: ExecutionPolicyEvaluation, source: "thread_revision" | "installed_skill_user_version" = "thread_revision"): void {
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") throw new Error("policy must be evaluated");
  assert.equal(result.next_step, "request_confirmation");
  assert.equal(result.effective_policy.source, source);
}

function assertInvalid(value: unknown): void {
  assert.deepEqual(evaluateExecutionPolicy(value), {
    schema_version: "webenvoy.execution-policy-evaluation.v0",
    status: "stopped",
    next_step: "stop",
    stop_reason: "invalid_input"
  });
}

function single(value: ExecutionPolicyEvaluationInput, mode: "auto" | "deny" = "auto"): SingleActionDecision {
  const current = evaluateExecutionPolicy(value);
  assertCurrentConfirm(current);
  if (current.status !== "evaluated" || !current.confirmation_request) throw new Error("confirmation contract is required");
  const confirmation = current.confirmation_request;
  return {
    source_ref: "decision:once/1",
    source_version: "1",
    action_instance_ref: confirmation.action_instance_ref,
    action_id: confirmation.action_id,
    category: confirmation.category,
    target: { ...confirmation.target },
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
    issued_at: "2026-07-20T23:59:59.999Z",
    expires_at: "2026-07-21T00:00:00.001Z"
  };
}

function assertSingleDecisionRules(): void {
  const confirm = input();
  confirm.policies.single_action_decision = single(confirm);
  const allowedOnce = evaluateExecutionPolicy(confirm);
  assert.equal(allowedOnce.status === "evaluated" && allowedOnce.next_step, "execute");
  assert.equal(allowedOnce.status === "evaluated" && allowedOnce.effective_policy.source, "single_action_decision");

  const deniedOnceInput = input();
  deniedOnceInput.policies.single_action_decision = single(deniedOnceInput, "deny");
  const deniedOnce = evaluateExecutionPolicy(deniedOnceInput);
  assert.equal(deniedOnce.status === "evaluated" && deniedOnce.next_step, "stop");
  assert.equal(deniedOnce.status === "evaluated" && deniedOnce.effective_policy.source, "single_action_decision");

  const denied = input();
  const allowDecision = single(denied);
  denied.policies.thread_revision!.modes.commit = "deny";
  denied.policies.single_action_decision = allowDecision;
  const stillDenied = evaluateExecutionPolicy(denied);
  assert.equal(stillDenied.status === "evaluated" && stillDenied.next_step, "stop");
  assert.equal(stillDenied.status === "evaluated" && stillDenied.effective_policy.source, "thread_revision");

  const automatic = input();
  const denyDecision = single(automatic, "deny");
  automatic.policies.thread_revision!.modes.commit = "auto";
  automatic.policies.single_action_decision = denyDecision;
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
    (decision) => { decision.owner_matcher = "harbor_operation_catalog"; },
    (decision) => { decision.owner_declaration_ref = "lode://other"; },
    (decision) => { decision.owner_declaration_version = "2.0.0"; },
    (decision) => { decision.resource_match_ref = "resource-match:other"; },
    (decision) => { decision.resource_match_version = "2"; },
    (decision) => { decision.effective_policy_source_ref = "policy:other"; },
    (decision) => { decision.effective_policy_source_version = "3"; },
    (decision) => { decision.effective_policy_source = "global_user_config"; },
    (decision) => { decision.issued_at = "2026-07-21T00:00:00.001Z"; },
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

  const exactMillisecond = input();
  exactMillisecond.evaluated_at = "2026-07-21T00:00:00.001Z";
  exactMillisecond.policies.single_action_decision = { ...single(input()), expires_at: exactMillisecond.evaluated_at };
  assertCurrentConfirm(evaluateExecutionPolicy(exactMillisecond));

  const changedPolicySource = input();
  changedPolicySource.policies.single_action_decision = single(changedPolicySource);
  changedPolicySource.policies.thread_revision!.thread_ref = "thread:other";
  changedPolicySource.policies.installed_skill_user_version!.modes.commit = "confirm";
  assertCurrentConfirm(evaluateExecutionPolicy(changedPolicySource), "installed_skill_user_version");

  const changedCurrentTarget = input();
  changedCurrentTarget.policies.single_action_decision = single(changedCurrentTarget);
  changedCurrentTarget.action.target.target_ref = "target:creator-note/2";
  assertCurrentConfirm(evaluateExecutionPolicy(changedCurrentTarget));
}

function assertOwnerProofBoundary(): void {
  const valid = input();
  const oldBareMatch = {
    matcher: "lode_action_declaration",
    owner_declaration_ref: `${packageRef}#xhs_publish_note`,
    owner_declaration_version: "1.0.0",
    resource_match_ref: "resource-match:xhs/publish/1",
    resource_match_version: "1",
    action_id: "xhs_publish_note",
    category: "commit",
    target_scope: lodeContract().action_declaration.actions[0]!.target_scope,
    resource_requirement_refs: [requirementRef]
  };
  assertInvalid({ ...valid, owner_proof: oldBareMatch });
  assertInvalid({ ...valid, owner_match: oldBareMatch });
  assertInvalid({ ...valid, owner_proof: { ...valid.owner_proof } });
  assertInvalid(JSON.parse(JSON.stringify(valid)));
  assertInvalid({ ...valid, action: { ...valid.action, category: "read" } });
  assertInvalid({ ...valid, action: { ...valid.action, resource_match_ref: "resource-match:forged" } });

  const duplicate = structuredClone(lodeContract());
  duplicate.action_declaration.actions = [
    ...duplicate.action_declaration.actions,
    { ...structuredClone(duplicate.action_declaration.actions[0]!), category: "read", external_effects: [] }
  ];
  assert.equal(matchLodeBusinessActionOwner(duplicate, "xhs_publish_note", resourceMatch()), undefined);
  assert.equal(matchLodeBusinessActionOwner(lodeContract(), "xhs_publish_note", resourceMatch({ matched_requirement_refs: ["other.resources"] })), undefined);
  const credentialOwner = structuredClone(lodeContract());
  credentialOwner.action_declaration.actions[0]!.target_scope.supported_origins = ["https://owner:password@creator.xiaohongshu.com/path"];
  assert.equal(matchLodeBusinessActionOwner(credentialOwner, "xhs_publish_note", resourceMatch()), undefined);
  const emptyUserinfoOwner = structuredClone(lodeContract());
  emptyUserinfoOwner.action_declaration.actions[0]!.target_scope.supported_origins = ["https://@creator.xiaohongshu.com/path"];
  assert.equal(matchLodeBusinessActionOwner(emptyUserinfoOwner, "xhs_publish_note", resourceMatch()), undefined);
  const malformedSibling = structuredClone(lodeContract());
  malformedSibling.action_declaration.actions = [
    ...malformedSibling.action_declaration.actions,
    { ...structuredClone(malformedSibling.action_declaration.actions[0]!), action_id: "browser_fill" }
  ];
  assert.equal(matchLodeBusinessActionOwner(malformedSibling, "xhs_publish_note", resourceMatch()), undefined);

  for (const actionId of ["browser_fill", "click", "browser.type", "page_scroll"] as const) {
    const primitive = structuredClone(lodeContract());
    primitive.action_declaration.actions[0]!.action_id = actionId;
    assert.equal(matchLodeBusinessActionOwner(primitive, actionId, resourceMatch()), undefined);
    assertInvalid({ ...valid, action: { ...valid.action, action_id: actionId }, owner_proof: oldBareMatch });
  }

  const harborProof = matchHarborBusinessOperationOwner({
    schema_version: "webenvoy.harbor-operation-catalog.v0",
    catalog_ref: "harbor://operation-catalog/local",
    catalog_version: "1",
    operations: [{
      operation_id: "install_provider",
      category: "commit",
      target_scope: { target_types: ["provider_installation"] },
      resource_requirement_refs: ["harbor.provider.installable"]
    }]
  }, "install_provider", resourceMatch({
    match_ref: "resource-match:harbor/provider/1",
    matched_requirement_refs: ["harbor.provider.installable"]
  }));
  assert(harborProof);
  assert.equal(matchHarborBusinessOperationOwner({
    schema_version: "webenvoy.harbor-operation-catalog.v0",
    catalog_ref: "harbor://operation-catalog/local",
    catalog_version: "1",
    operations: [
      { operation_id: "install_provider", category: "commit", target_scope: { target_types: ["provider_installation"] }, resource_requirement_refs: ["harbor.provider.installable"] },
      { operation_id: "install_provider", category: "destructive", target_scope: { target_types: ["provider_installation"] }, resource_requirement_refs: ["harbor.provider.installable"] }
    ]
  }, "install_provider", resourceMatch({ matched_requirement_refs: ["harbor.provider.installable"] })), undefined);
  const environment = input("commit", harborProof);
  environment.caller = "environment";
  environment.action = {
    action_instance_ref: "action-instance:install-provider/1",
    action_id: "install_provider",
    target: { target_ref: "target:provider/chrome", target_type: "provider_installation" }
  };
  assert.equal(evaluateExecutionPolicy(environment).next_step, "request_confirmation");
}

function assertTargetAndParserBoundary(): void {
  const normalized = evaluateExecutionPolicy(input());
  assert.equal(normalized.status === "evaluated" && normalized.action.target.origin, "https://creator.xiaohongshu.com");
  assert.equal(JSON.stringify(normalized).includes("credential=never-echoed"), false);
  assert.equal(JSON.stringify(normalized).includes("owner-contract-path"), false);

  for (const target of [
    { target_ref: "https://preview-user:preview-password@example.test/path", target_type: "creator_publish_page", site_slug: "xiaohongshu", origin: "https://creator.xiaohongshu.com" },
    { target_ref: "ftp://preview-user:preview-password@example.test/path", target_type: "creator_publish_page", site_slug: "xiaohongshu", origin: "https://creator.xiaohongshu.com" },
    { target_ref: "target:creator-note/1", target_type: "creator_publish_page", site_slug: "xiaohongshu", origin: "https://preview-user:preview-password@creator.xiaohongshu.com/path?token=secret" },
    { target_ref: "target:creator-note/1", target_type: "creator_publish_page", site_slug: "xiaohongshu", origin: "https://@creator.xiaohongshu.com/path" }
  ]) {
    const candidate = input();
    candidate.action.target = target;
    const result = evaluateExecutionPolicy(candidate);
    assert.equal(result.status === "stopped" && result.stop_reason, "invalid_input");
    assert.equal(JSON.stringify(result).includes("preview-password"), false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }

  const mismatch = input();
  mismatch.action.target.origin = "https://www.xiaohongshu.com/path";
  assert.equal(evaluateExecutionPolicy(mismatch).status === "stopped" && evaluateExecutionPolicy(mismatch).stop_reason, "target_mismatch");

  const base = input();
  assertInvalid({ ...base, caller: "web" });
  assertInvalid({ ...base, evaluated_at: "2026-07-21" });
  assertInvalid({ ...base, evaluated_at: "NaN" });
  assertInvalid({ ...base, evaluated_at: Number.NaN });
  assertInvalid({ ...base, evaluated_at: "2026-02-30T00:00:00Z" });
  assertInvalid({ ...base, evaluated_at: "2026-07-21T00:00:00+24:00" });
  assertInvalid({ ...base, evaluated_at: "2026-07-21T00:00:00.0001Z" });
  assertInvalid({ ...base, evaluated_at: "2026-07-21T00:00:00.000000001Z" });
  assertInvalid({ ...base, unknown: true });
  assertInvalid({ ...base, action: { ...base.action, target: { ...base.action.target, target_type: " " } } });
  assertInvalid({ ...base, policies: { ...base.policies, skill_recommendation: { commit: "auto" } } });
  assertInvalid({ ...base, policies: { ...base.policies, thread_revision: { ...base.policies.thread_revision, source_version: undefined } } });
  assertInvalid({ ...base, policies: { ...base.policies, single_action_decision: { ...single(base), issued_at: "2026-07-20T23:59:59.9999Z" } } });
  assertInvalid({ ...base, policies: { ...base.policies, single_action_decision: { ...single(base), expires_at: "2026-07-21T00:00:00.000000001Z" } } });
  assertInvalid(null);
}

export function assertExecutionPolicyEvaluator(): void {
  const confirmation = evaluateExecutionPolicy(input());
  assertCurrentConfirm(confirmation);
  assert.equal(confirmation.status === "evaluated" && confirmation.confirmation_request?.effective_policy_source_version, "2");
  assert.deepEqual(confirmation.status === "evaluated" && confirmation.confirmation_request?.target, {
    ...input().action.target,
    origin: "https://creator.xiaohongshu.com"
  });

  assertSingleDecisionRules();
  assertOwnerProofBoundary();
  assertTargetAndParserBoundary();

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

  for (const caller of allCallers) {
    const current = input("read");
    current.caller = caller;
    current.policies.thread_revision!.modes.read = "auto";
    assert.deepEqual(evaluateExecutionPolicy(current), evaluateExecutionPolicy({ ...current, caller: "api" }));
  }
}
