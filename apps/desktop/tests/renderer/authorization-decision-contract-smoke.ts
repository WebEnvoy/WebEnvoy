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
  let responseKind: "active" | "http-owner" | "mismatch" | "terminal" | "wrong-single-action" = "active";
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
    const active = await fetchPendingAuthorizationDecision("http://127.0.0.1:8787", binding);
    if (!active.ok || active.decision.actionId !== "xhs_publish_note_path_prepare") {
      throw new Error("Authorization decision client rejected a production-shaped lode:// owner declaration.");
    }
    responseKind = "http-owner";
    const httpOwner = await fetchPendingAuthorizationDecision("http://127.0.0.1:8787", binding);
    if (httpOwner.ok) throw new Error("Authorization decision client accepted an HTTP owner declaration reference.");
    responseKind = "mismatch";
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

function decision(kind: "active" | "http-owner" | "mismatch" | "terminal" | "wrong-single-action") {
  const terminal = kind === "terminal";
  return {
    schema_version: "webenvoy.authorization-decision.v0",
    decision_ref: decisionRef,
    business_action: {
      action_instance_ref: "action-instance:xhs-publish-note-path-prepare",
      action_id: "xhs_publish_note_path_prepare",
      category: "prepare",
      target: {
        target_ref: "target:xhs-publish-note-path-prepare",
        target_type: "creator_publish_page",
        site_slug: "xiaohongshu",
        origin: "https://creator.xiaohongshu.com",
      },
    },
    owner_declaration: {
      matcher: "lode_action_declaration",
      declaration_ref: kind === "http-owner"
        ? "https://example.invalid/owner-declaration"
        : "lode://site-capability/xiaohongshu/publish-note-path-prepare@0.1.0#xhs_publish_note_path_prepare",
      declaration_version: "0.1.0",
      resource_match_ref: `resource-match:${"a".repeat(32)}`,
      resource_match_version: `sha256:${"b".repeat(64)}`,
    },
    effective_policy: { mode: "confirm", source: "installed_skill_user_version", source_version: "1" },
    applicability: {
      scope: "task",
      run_id: binding.runId,
      thread_id: binding.threadId,
      turn_id: terminal || kind === "active" ? binding.turnId : "turn_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
