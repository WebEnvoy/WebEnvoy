import assert from "node:assert/strict";

import { evaluateExecutionPolicy, type ExecutionPolicyCaller, type ExecutionPolicyEvaluationInput } from "./execution-policy.js";

const callers: readonly ExecutionPolicyCaller[] = ["api", "cli", "mcp", "sdk", "app", "agent", "environment"];

function input(category: string = "commit"): ExecutionPolicyEvaluationInput {
  return {
    caller: "api",
    evaluated_at: "2026-07-21T00:00:00.000Z",
    action: {
      action_instance_ref: "action-instance:publish-note/1",
      action_id: "xhs_publish_note",
      target: {
        target_ref: "target:creator-note/1",
        site_slug: "xiaohongshu",
        target_type: "creator_publish_page",
        origin: "https://creator.xiaohongshu.com/publish"
      },
      declaration: {
        owner: "Lode",
        declaration_ref: "lode://site-capability/xiaohongshu/publish-note@1.0.0#xhs_publish_note",
        action_id: "xhs_publish_note",
        category,
        target_scope: {
          site_slug: "xiaohongshu",
          target_types: ["creator_publish_page"],
          supported_origins: ["https://creator.xiaohongshu.com"]
        },
        valid_until: "2026-07-21T01:00:00.000Z"
      }
    },
    context: { thread_ref: "thread:1", skill_ref: "skill:user/xhs@3" },
    policies: {
      thread_revision: { source_ref: "policy:thread/2", thread_ref: "thread:1", modes: { commit: "confirm" } },
      installed_skill_user_version: { source_ref: "policy:skill/3", skill_ref: "skill:user/xhs@3", modes: { commit: "auto" } },
      global_user_config: {
        source_ref: "policy:global/4",
        modes: { read: "auto", prepare: "auto", commit: "deny", destructive: "confirm" }
      }
    }
  };
}

export function assertExecutionPolicyEvaluator(): void {
  const confirmation = evaluateExecutionPolicy(input());
  assert.equal(confirmation.status, "evaluated");
  if (confirmation.status !== "evaluated") throw new Error("confirmation must be evaluated");
  assert.equal(confirmation.effective_policy.source, "thread_revision");
  assert.equal(confirmation.next_step, "request_confirmation");
  assert.deepEqual(confirmation.confirmation_request?.choices, ["allow_once", "deny_once"]);

  const single = input();
  single.policies.single_action_decision = {
    source_ref: "decision:once/1",
    action_instance_ref: single.action.action_instance_ref,
    action_id: single.action.action_id,
    category: "commit",
    target_ref: single.action.target.target_ref,
    mode: "auto",
    state: "active",
    expires_at: "2026-07-21T00:05:00.000Z"
  };
  const allowedOnce = evaluateExecutionPolicy(single);
  assert.equal(allowedOnce.status === "evaluated" && allowedOnce.effective_policy.source, "single_action_decision");
  assert.equal(allowedOnce.status === "evaluated" && allowedOnce.next_step, "execute");
  single.policies.single_action_decision.mode = "deny";
  const deniedOnce = evaluateExecutionPolicy(single);
  assert.equal(deniedOnce.status === "evaluated" && deniedOnce.next_step, "stop");
  assert.equal(deniedOnce.status === "evaluated" && deniedOnce.effective_policy.source, "single_action_decision");
  single.policies.single_action_decision.mode = "auto";
  for (const state of ["consumed", "cancelled", "expired", "target_changed"] as const) {
    single.policies.single_action_decision.state = state;
    const inactive = evaluateExecutionPolicy(single);
    assert.equal(inactive.status === "evaluated" && inactive.effective_policy.source, "thread_revision");
  }
  single.policies.single_action_decision.state = "active";
  single.policies.single_action_decision.target_ref = "target:changed";
  const targetChanged = evaluateExecutionPolicy(single);
  assert.equal(targetChanged.status === "evaluated" && targetChanged.effective_policy.source, "thread_revision");
  single.policies.single_action_decision.target_ref = single.action.target.target_ref;
  single.policies.single_action_decision.expires_at = single.evaluated_at;
  const expired = evaluateExecutionPolicy(single);
  assert.equal(expired.status === "evaluated" && expired.effective_policy.source, "thread_revision");

  const skillFallback = input();
  skillFallback.policies.thread_revision = { source_ref: "policy:other-thread", thread_ref: "thread:other", modes: { commit: "deny" } };
  const skillDecision = evaluateExecutionPolicy(skillFallback);
  assert.equal(skillDecision.status === "evaluated" && skillDecision.effective_policy.source, "installed_skill_user_version");

  const globalFallback = input();
  globalFallback.policies.thread_revision = { source_ref: "policy:invalid", thread_ref: "thread:1", modes: { commit: "invalid" as never } };
  globalFallback.policies.installed_skill_user_version = { source_ref: "policy:other-skill", skill_ref: "skill:other", modes: { commit: "auto" } };
  const globalDecision = evaluateExecutionPolicy(globalFallback);
  assert.equal(globalDecision.status === "evaluated" && globalDecision.effective_policy.source, "global_user_config");
  assert.equal(globalDecision.status === "evaluated" && globalDecision.next_step, "stop");

  const destructive = input("destructive");
  destructive.policies.thread_revision!.modes.destructive = "auto";
  const dangerousAuto = evaluateExecutionPolicy(destructive);
  assert.equal(dangerousAuto.status === "evaluated" && dangerousAuto.next_step, "execute");
  assert.equal(dangerousAuto.status === "evaluated" && dangerousAuto.risk_marker, "destructive");
  assert.equal(dangerousAuto.status === "evaluated" && dangerousAuto.effective_policy.mode, "auto");

  const environment = input("commit");
  environment.caller = "environment";
  environment.action.action_id = "install_provider";
  environment.action.target = {
    target_ref: "target:provider/chrome",
    target_type: "provider_installation"
  };
  environment.action.declaration = {
    owner: "Harbor",
    declaration_ref: "harbor://operation/install-provider@1#install_provider",
    action_id: "install_provider",
    category: "commit",
    target_scope: { target_types: ["provider_installation"] },
    valid_until: "2026-07-21T01:00:00.000Z"
  };
  environment.policies.thread_revision!.modes.commit = "confirm";
  assert.equal(evaluateExecutionPolicy(environment).next_step, "request_confirmation");

  for (const caller of callers) {
    const current = input("read");
    current.caller = caller;
    current.policies.thread_revision!.modes.read = "auto";
    assert.deepEqual(evaluateExecutionPolicy(current), evaluateExecutionPolicy({ ...current, caller: "api" }));
  }

  const failures: readonly [string, (value: ExecutionPolicyEvaluationInput) => void][] = [
    ["action_undeclared", (value) => { delete value.action.declaration; }],
    ["action_unclassifiable", (value) => { value.action.declaration!.category = "click"; }],
    ["target_mismatch", (value) => { value.action.target.origin = "https://www.xiaohongshu.com"; }],
    ["declaration_expired", (value) => { value.action.declaration!.valid_until = value.evaluated_at; }],
    ["policy_unavailable", (value) => { value.policies = {}; }]
  ];
  for (const [reason, mutate] of failures) {
    const value = input();
    mutate(value);
    const result = evaluateExecutionPolicy(value);
    assert.equal(result.status, "stopped");
    assert.equal(result.status === "stopped" && result.stop_reason, reason);
  }
}
