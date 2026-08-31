import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  harborFixtureContractDigest, harborFixtureWireContract, pinnedHarborCommit
} from "./readonly-vertical-pins.js";
import { asRecord, listen, readRequestJson, sendJson, type JsonObject } from "./self-check-process-support.js";

type Mode = "success" | "unavailable" | "failure" | "rollback" | "canonical-network" | "canonical-5xx" | "canonical-session-missing" | "canonical-malformed";
type TraceEvent = { sequence: number; request: string; status: number; outcome: string };
type Reply = (status: number, body: unknown, outcome: string) => void;
type FixtureState = { holderRef: string; released: boolean; readAttempted: boolean; trace: TraceEvent[] };

const supervisorToken = "runtime-process-supervisor-token";
const privateBoundary = ["password", "verification_code", "cookie_value", "storage_value", "session_token"];

function modeFor(holderRef: string): Mode {
  const match = /^(?:run|intent)_vertical_(success|unavailable|failure|rollback|canonical-network|canonical-5xx|canonical-session-missing|canonical-malformed)/.exec(holderRef);
  return (match?.[1] as Mode | undefined) ?? "success";
}

function fixtureRef(prefix: string, seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function handleFixtureRoutes(request: IncomingMessage, response: ServerResponse, state: FixtureState): boolean {
  if (request.method === "GET" && request.url === "/__fixture/provenance") {
    sendJson(response, 200, {
      schema_version: "webenvoy.harbor-owner-fixture-provenance.v0",
      harbor_commit: pinnedHarborCommit,
      contract_digest: harborFixtureContractDigest(),
      wire_contract: harborFixtureWireContract
    });
    return true;
  }
  if (request.method === "GET" && request.url === "/__fixture/trace") {
    sendJson(response, 200, { schema_version: "webenvoy.harbor-owner-fixture-trace.v0", events: state.trace });
    return true;
  }
  return false;
}

function handleDiscoveryRoutes(request: IncomingMessage, reply: Reply): boolean {
  if (request.method === "GET" && request.url === "/readiness") {
    reply(200, { status: "ready" }, "fixture_ready");
    return true;
  }
  if (request.method === "GET" && request.url === "/runtime/browser-providers") {
    reply(200, {
      schema_version: "harbor-browser-provider-status/v0",
      providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }]
    }, "provider_ready");
    return true;
  }
  if (request.method !== "GET" || request.url !== "/runtime/identity-environments/identity-env_vertical") return false;
  reply(200, {
    schema_version: "harbor-local-identity-environment-store/v0", identity_environment_ref: "identity-env_vertical",
    execution_identity_ref: "identity-env_vertical:execution", profile_ref: "profile_vertical",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
    status: {
      login_state: "logged_in", authentication_provenance: "user_confirmed_managed_session",
      manual_authentication_state: "completed", browser_storage_state: "present", recovery_required: false,
      blocking_reasons: [], repair_reasons: []
    },
    refs: { execution_identity_ref: "identity-env_vertical:execution", profile_ref: "profile_vertical" },
    environment_summary: { provider_id: "cloakbrowser" },
    consumer_boundary: { core: "admission_facts_refs_and_blocking_reasons_only", not_exposed: privateBoundary }
  }, "identity_facts");
  return true;
}

function handleSessionCreation(request: IncomingMessage, body: JsonObject, state: FixtureState, reply: Reply): boolean {
  if (request.method !== "POST" || request.url !== "/runtime/identity-environment-sessions") return false;
  state.holderRef = typeof body.holder_ref === "string" ? body.holder_ref : "";
  state.released = false;
  state.readAttempted = false;
  reply(200, {
    identity_environment_facts: {
      schema_version: "harbor-local-identity-environment/v0", identity_environment_ref: "identity-env_vertical",
      execution_identity_ref: "identity-env_vertical:execution", profile_ref: "profile_vertical",
      site_binding: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
      login_state: { state: "logged_in", authentication_provenance: "user_confirmed_managed_session", manual_authentication_state: "completed", recovery_required: false },
      browser_storage: { state: "present" },
      provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "default_provider_available" },
      consumer_boundary: { core: "admission_facts_refs_and_blocking_reasons_only", not_exposed: privateBoundary }
    },
    runtime_facts: {
      runtime_session_ref: "session_vertical", identity_environment_ref: "identity-env_vertical",
      execution_identity_ref: "identity-env_vertical:execution", profile_ref: "profile_vertical",
      provider_ref: "harbor:provider/cloakbrowser", provider_mode: "local_dedicated_profile", lifecycle_state: "active",
      viewer_ref: "viewer_vertical", availability: { cdp: "available", viewer: "unsupported", snapshot: "available", evidence: "available" },
      control_owner: "core_task", control_lock: { owner: "core_task", state: "held", holder_ref: state.holderRef },
      last_seen_at: "2026-08-03T00:00:00.000Z"
    }
  }, "session_created");
  return true;
}

function canonicalFacts(request: IncomingMessage, response: ServerResponse, state: FixtureState, reply: Reply): boolean {
  if (request.method !== "GET" || request.url !== "/runtime/sessions/session_vertical/runtime-facts") return false;
  const mode = modeFor(state.holderRef);
  if (mode === "canonical-network") {
    state.trace.push({ sequence: state.trace.length + 1, request: `${request.method} ${request.url}`, status: 0, outcome: "network_disconnect" });
    response.destroy();
    return true;
  }
  if (mode === "rollback") {
    reply(404, { status: "unavailable", failure_class: "runtime_facts_unsupported", retryable: false }, "runtime_facts_unsupported");
    return true;
  }
  if (mode === "canonical-5xx") {
    reply(503, { status: "unavailable", failure_class: "runtime_facts_unavailable", retryable: true }, "runtime_facts_5xx");
    return true;
  }
  if (mode === "canonical-session-missing") {
    reply(404, { status: "unavailable", failure_class: "session_missing", retryable: false }, "session_missing");
    return true;
  }
  if (mode === "canonical-malformed") {
    reply(200, { schema_version: "harbor-runtime-facts/v0", runtime_session_ref: "session_vertical" }, "malformed_runtime_facts");
    return true;
  }
  reply(200, {
    schema_version: "harbor-core-runtime-facts/v0", runtime_session_ref: "session_vertical",
    identity_environment_ref: "identity-env_vertical", execution_identity_ref: "identity-env_vertical:execution",
    profile_ref: "profile_vertical", provider_ref: "harbor:provider/cloakbrowser",
    provider_mode: "local_dedicated_profile", lifecycle_state: "active",
    availability: { cdp: "available", viewer: "unsupported", snapshot: "available", evidence: "available" },
    viewer: { viewer_ref: "viewer_vertical", availability: "unsupported", access_mode: "none", expires_at: "2026-08-03T01:00:00.000Z" },
    control: { owner: "core_task", handoff_reason: null, takeover: { available: false, unavailable_reason: "viewer_unavailable" }, updated_at: "2026-08-03T00:00:00.000Z" },
    current_error: null, fact_refs: { session: "session_vertical", viewer: "viewer_vertical" }, unavailable: null
  }, "canonical_runtime_facts");
  return true;
}

function legacyAndResourceFacts(request: IncomingMessage, state: FixtureState, reply: Reply): boolean {
  if (request.method === "GET" && request.url === "/runtime/sessions/session_vertical") {
    reply(200, {
      runtime_session_ref: "session_vertical", lifecycle_state: state.released ? "idle" : "active",
      control_owner: state.released ? "none" : "core_task",
      control_lock: state.released
        ? { owner: "none", state: "released", holder_ref: null }
        : { owner: "core_task", state: "held", holder_ref: state.holderRef }
    }, state.released
      ? "cleanup_readback"
      : modeFor(state.holderRef) === "rollback" && !state.readAttempted ? "legacy_session_facts" : "cleanup_precheck");
    return true;
  }
  if (request.method !== "GET" || !request.url?.startsWith("/runtime/sessions/session_vertical/site-resource-facts?")) return false;
  const keys = [
    "runtime.execution_surface.available", "runtime.origin.www_xiaohongshu_com.available",
    "identity.user_logged_in.confirmed", "page.vue_app.ready", "page.pinia_store.ready",
    "source.refs.available", "evidence.snapshot_ref.available", "safety.challenge.absent"
  ];
  reply(200, {
    schema_version: "harbor-site-resource-facts/v0", runtime_session_ref: "session_vertical",
    site_id: "xiaohongshu", task_kind: "search_notes", generated_at: "2026-08-03T00:00:00.000Z",
    resource_facts: keys.map((key) => ({ key, state: "available", evidence_ref: "evidence_vertical" })),
    evidence_refs: ["evidence_vertical"], public_boundary: { output: "public_runtime_facts_and_refs_only", raw_material: "not_exposed" }
  }, "site_resource_facts");
  return true;
}

function handleSnapshot(request: IncomingMessage, reply: Reply): boolean {
  if (request.method !== "POST" || request.url !== "/runtime/sessions/session_vertical/snapshot") return false;
  reply(200, { harbor_scene_ref: {
    schema_version: "harbor-page-scene-refs/v0", runtime_session_ref: "session_vertical",
    snapshot_ref: "snapshot_vertical", refmap_ref: "refmap_vertical", source_trace_ref: "source_trace_vertical",
    evidence_refs: ["evidence_vertical"], captured_at: "2026-08-03T00:00:00.000Z",
    page_summary: {
      title: "Xiaohongshu search", url: "https://www.xiaohongshu.com/search_result/?keyword=coffee",
      summary: "Redacted public search result fixture."
    },
    unavailable: null
  } }, "snapshot_refs");
  return true;
}

function completedRead(state: FixtureState): JsonObject {
  const detailRef = fixtureRef("detail_ref", state.holderRef);
  const evidenceRef = fixtureRef("evidence", state.holderRef);
  const postCheckRef = fixtureRef("post_check", state.holderRef);
  return {
    schema_version: "harbor-allowlisted-read-operation/v0", status: "completed",
    operation_ref: fixtureRef("read_operation", state.holderRef), runtime_session_ref: "session_vertical",
    site_id: "xiaohongshu", operation_id: "xhs_search_notes", operation_mode: "read",
    observed_at: new Date().toISOString(), public_summary_ref: fixtureRef("read_result", state.holderRef),
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v1", operation_id: "xhs_search_notes",
      result_kind: "xiaohongshu_search_notes_surface", surface: "search_result",
      result_state: "operation_read_response_observed", response_status: 200, result_count: 1,
      detail_refs: [detailRef],
      items: [{ detail_ref: detailRef, title: "城市咖啡公开笔记", author_display_name: "公开作者", interaction_metrics: { likes: "12", comments: "3", collects: "4" } }],
      source_signals: ["pinia_store", "xhs_search_read_network"],
      ...(modeFor(state.holderRef) === "failure" ? { token: "forbidden" } : {})
    },
    source_refs: [
      { kind: "pinia_store_summary", ref: fixtureRef("source", `${state.holderRef}:pinia`) },
      { kind: "network_summary", ref: fixtureRef("source", `${state.holderRef}:network`) },
      { kind: "dom_snapshot_summary", ref: fixtureRef("source", `${state.holderRef}:dom`) }
    ],
    evidence_refs: [evidenceRef],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: evidenceRef }, { kind: "post_check_ref", ref: postCheckRef }],
    post_check: { post_check_ref: postCheckRef, status: "passed", reason: "managed_provider_read_probe_completed" },
    public_boundary: {
      output: "public_summary_and_refs_only", raw_credentials: "not_exposed", raw_profile_storage: "not_exposed",
      raw_cdp_endpoint: "not_exposed", raw_dom: "not_exposed", raw_har: "not_exposed",
      raw_network_bodies: "not_exposed", screenshot_body: "not_exposed", external_write_actions: "not_performed"
    }
  };
}

function handleReadAndCleanup(request: IncomingMessage, state: FixtureState, reply: Reply): boolean {
  if (request.method === "POST" && request.url === "/runtime/sessions/session_vertical/read-operations") {
    state.readAttempted = true;
    if (modeFor(state.holderRef) === "unavailable") {
      reply(200, {
        schema_version: "harbor-allowlisted-read-operation/v0", status: "unavailable",
        runtime_session_ref: "session_vertical", site_id: "xiaohongshu", operation_id: "xhs_search_notes",
        failure_class: "resource_unavailable", retryable: true
      }, "read_operation_unavailable");
    } else {
      reply(200, completedRead(state), "read_operation_completed");
    }
    return true;
  }
  if (request.method === "POST" && request.url === "/runtime/sessions/session_vertical/release") {
    state.released = true;
    reply(200, { status: "released", runtime_session_ref: "session_vertical", control_owner: "none", control_lock: { owner: "none", state: "released", holder_ref: null } }, "session_released");
    return true;
  }
  if (request.method === "GET" && request.url === "/runtime/evidence/evidence_vertical") {
    reply(200, { evidence_ref: "evidence_vertical", access_state: "available" }, "evidence_ref");
    return true;
  }
  return false;
}

function createReply(request: IncomingMessage, response: ServerResponse, state: FixtureState): Reply {
  return (status, body, outcome) => {
    state.trace.push({ sequence: state.trace.length + 1, request: `${request.method} ${request.url}`, status, outcome });
    sendJson(response, status, body);
  };
}

function createFixtureServer(state: FixtureState) {
  return createServer((request, response) => {
    if (handleFixtureRoutes(request, response, state)) return;
    const protectedRequest = request.method === "POST" && (
      request.url === "/runtime/identity-environment-sessions" ||
      /^\/runtime\/sessions\/[^/]+\/(?:release|snapshot|read-operations)$/.test(request.url ?? "")
    );
    const reply = createReply(request, response, state);
    if (protectedRequest && request.headers.authorization !== `Bearer ${supervisorToken}`) {
      reply(401, { status: "unavailable", failure_class: "supervisor_authorization_required", retryable: false }, "authorization_rejected");
      return;
    }
    void readRequestJson(request).then((body) => {
      if (handleDiscoveryRoutes(request, reply) || handleSessionCreation(request, body, state, reply)) return;
      if (canonicalFacts(request, response, state, reply) || legacyAndResourceFacts(request, state, reply)) return;
      if (handleSnapshot(request, reply) || handleReadAndCleanup(request, state, reply)) return;
      reply(404, { error: { category: "resource_admission", code: "fixture_route_missing" } }, "route_missing");
    }).catch(() => reply(500, { error: { category: "resource_admission", code: "fixture_failure" } }, "fixture_failure"));
  });
}

async function main(): Promise<void> {
  const expectedDigest = process.env.WEBENVOY_HARBOR_FIXTURE_CONTRACT_DIGEST;
  const expectedCommit = process.env.WEBENVOY_HARBOR_FIXTURE_COMMIT;
  const port = Number(process.env.PORT);
  if (expectedDigest !== harborFixtureContractDigest() || expectedCommit !== pinnedHarborCommit || !Number.isInteger(port)) {
    throw new Error("Harbor fixture contract provenance is unavailable or mismatched.");
  }
  const server = createFixtureServer({ holderRef: "", released: false, readAttempted: false, trace: [] });
  await listen(server, port);
  const shutdown = (): void => { server.close(() => process.exit(0)); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

await main();
