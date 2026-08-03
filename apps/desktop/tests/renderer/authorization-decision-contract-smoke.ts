import {
  decideSingleAction,
  fetchPendingAuthorizationDecision,
  type PendingAuthorizationBinding,
} from "../../src/renderer/authorizationDecisionClient";

const decisionRef = "authorization-decision:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const binding: PendingAuthorizationBinding = {
  decisionRef,
  runId: "run-contract-confirming",
  threadId: "thread_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  turnId: "turn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

export async function checkRejectedAuthorizationDecisions() {
  const original = window.webenvoyShell?.requestOwnerJson;
  if (window.webenvoyShell == null || original == null) throw new Error("Authorization smoke requires the Electron owner bridge mock.");
  let responseKind: "mismatch" | "terminal" | "wrong-single-action" = "mismatch";
  window.webenvoyShell.requestOwnerJson = async (request) => {
    if (!request.path.startsWith("/authorization-decisions/")) return original(request);
    if (request.path.endsWith("/single-action")) {
      return { ok: true, body: { ok: true, single_action_decision: {
        schema_version: "webenvoy.single-action-decision.v0",
        confirmation_decision_ref: "authorization-decision:cccccccccccccccccccccccccccccccc:dddddddddddddddddddddddddddddddd",
        mode: "auto",
      } } };
    }
    return { ok: true, body: { ok: true, authorization_decision: decision(responseKind) } };
  };
  try {
    const mismatch = await fetchPendingAuthorizationDecision("http://127.0.0.1:8787", binding);
    responseKind = "terminal";
    const terminal = await fetchPendingAuthorizationDecision("http://127.0.0.1:8787", binding);
    responseKind = "wrong-single-action";
    const wrongSingleAction = await decideSingleAction("http://127.0.0.1:8787", decisionRef, "allow_once");
    if (mismatch.ok || terminal.ok || wrongSingleAction.ok) {
      throw new Error("Authorization decision client accepted a mismatched, terminal, or wrongly bound single-action decision.");
    }
  } finally {
    window.webenvoyShell.requestOwnerJson = original;
  }
}

function decision(kind: "mismatch" | "terminal" | "wrong-single-action") {
  const terminal = kind === "terminal";
  return {
    schema_version: "webenvoy.authorization-decision.v0",
    decision_ref: decisionRef,
    business_action: {
      action_instance_ref: "action-instance:xhs-search",
      action_id: "xhs_search_notes",
      category: "read",
      target: {
        target_ref: "target:xhs-search-results",
        target_type: "search_results_page",
        site_slug: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
      },
    },
    owner_declaration: {
      matcher: "lode_action_declaration",
      declaration_ref: "lode:action/xhs_search_notes",
      declaration_version: "0.1.0",
      resource_match_ref: "lode:resource/xhs_search_notes",
      resource_match_version: "0.1.0",
    },
    effective_policy: { mode: "confirm", source: "installed_skill_user_version", source_version: "1" },
    applicability: {
      scope: "task",
      run_id: binding.runId,
      thread_id: binding.threadId,
      turn_id: terminal ? binding.turnId : "turn_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      config_refs: ["execution-policy:skill/xhs"],
    },
    outcome: "confirm",
    risk_marker: null,
    decided_at: "2026-07-20T08:00:00Z",
    expires_at: "2099-07-20T08:05:00Z",
    state: terminal ? "invalidated" : "active",
    invalidated_at: terminal ? "2026-07-20T08:01:00Z" : null,
    invalidation_reason: terminal ? "turn_terminal" : null,
    consumer_boundary: "Business policy decision summary only; technical trace and private browser, evidence, and content material are excluded.",
  };
}
