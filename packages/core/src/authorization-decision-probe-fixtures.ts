import assert from "node:assert/strict";

import {
  evaluateExecutionPolicy,
  type BusinessActionCategory,
  type ExecutionPolicyEvaluationInput,
  type SingleActionDecision
} from "./execution-policy.js";
import { matchLodeBusinessActionOwner } from "./execution-policy-owner-proof.js";

export const environmentAuthorizationSubject = {
  scope: "environment",
  operation_ref: "harbor-operation:fixture/1"
} as const;

export function authorizationEvaluationInput(options: {
  category?: BusinessActionCategory;
  mode?: "auto" | "confirm" | "deny";
  actionInstance?: string;
  targetRef?: string;
  origin?: string;
  evaluatedAt?: string;
  ownerVersion?: string;
  policyRef?: string;
  policyVersion?: string;
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
        source_ref: options.policyRef ?? "policy:global/1",
        source_version: options.policyVersion ?? "1",
        modes: { [category]: options.mode ?? "auto" }
      }
    }
  };
}

export function singleAuthorizationDecision(
  input: ExecutionPolicyEvaluationInput,
  mode: "auto" | "deny"
): SingleActionDecision {
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

export function fixtureAuthorizationDecisionRef(index: number): string {
  const left = index.toString(16).padStart(32, "0");
  const right = (index + 1).toString(16).padStart(32, "0");
  return `authorization-decision:${left}:${right}`;
}
