#!/usr/bin/env node
// Standalone Node.js 24+ acceptance client. This file never launches a service or browser process.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

const help = `Managed browser HTTP acceptance check (Node.js 24+)

No requests are made without --run and MANAGED_LIVE_OPT_IN=isolated-test-store.
Use a NEW isolated Core store and Harbor registry; existing global policy is refused.
The runtime must already be running with Camoufox installed by its normal installer.

Required environment:
  CORE_URL                  Existing Core HTTP(S) origin; no path/query/userinfo
  CORE_OWNER_TOKEN          Owner credential supplied securely in the environment
  MANAGED_LIVE_OPT_IN        Exactly isolated-test-store
Optional environment:
  MANAGED_LIVE_TARGET_URL    Public nonproduction URL, default https://example.com/

Usage:
  node managed-browser-live-check.mjs --run
  node managed-browser-live-check.mjs --run --handoff
  node managed-browser-live-check.mjs --run --owner-return

--owner-return uses HARBOR_URL + HARBOR_OWNER_TOKEN (coordinator-only credentials)
to return control through the formal Harbor owner release API. Its evidence is
labeled owner API, never a human click. These credentials are never sent to Core.

--handoff pauses for the human to return control through App, then verifies the
same instance using the formal Agent start/observe API. Without it, handoff is
reported as not run. Do not provide account credentials to this script.

The test creates two persistent isolated Profiles and retains their data for
inspection. It stops owned instances, revokes its Grant, and changes only its
new isolated policy to all-deny using compare-and-swap. It never deletes data,
replays an uncertain operation, reads private packages, or prints credentials.
`;
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  process.stdout.write(help);
} else if (args.some(arg => !["--run", "--handoff", "--owner-return"].includes(arg)) || !args.includes("--run")) {
  process.stderr.write("Use --help or explicitly select --run.\n");
  process.exitCode = 2;
} else {
  await run(args.includes("--handoff") || args.includes("--owner-return"), args.includes("--owner-return"));
}

async function run(handoff, ownerReturn) {
  const stamp = `managed-live-${randomUUID()}`;
  const hash = value => createHash("sha256").update(value).digest("hex");
  const safeRef = value => typeof value === "string" ? `ref:${hash(value).slice(0, 20)}` : null;
  const emit = (check, status, refs = {}) => {
    process.stdout.write(`${JSON.stringify({ check, status, ...Object.fromEntries(Object.entries(refs).map(([key, value]) => [key, safeRef(value)])) })}\n`);
  };
  let phase = "configuration";
  const requireThat = (condition, code) => { if (!condition) throw new Error(code); };
  let ownerCredential, agentCredential, core, target, harbor, harborOwnerCredential;
  try {
    requireThat(process.env.MANAGED_LIVE_OPT_IN === "isolated-test-store", "explicit_isolated_store_opt_in_required");
    requireThat(!handoff || ownerReturn || process.stdin.isTTY, "handoff_requires_interactive_terminal");
    core = new URL(process.env.CORE_URL ?? "");
    requireThat(!core.username && !core.password && !core.search && !core.hash && core.pathname === "/", "core_origin_required");
    requireThat(core.protocol === "https:" || core.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(core.hostname), "core_transport_requires_tls_or_loopback");
    target = new URL(process.env.MANAGED_LIVE_TARGET_URL ?? "https://example.com/");
    requireThat(target.protocol === "https:" && !target.username && !target.password && !target.search && !target.hash, "public_nonproduction_https_target_required");
    ownerCredential = process.env.CORE_OWNER_TOKEN;
    requireThat(typeof ownerCredential === "string" && /^[A-Za-z0-9_-]{43}$/.test(ownerCredential) && Buffer.from(ownerCredential, "base64url").length === 32, "owner_credential_required");
    if (ownerReturn) {
      harbor = new URL(process.env.HARBOR_URL ?? "");
      requireThat(!harbor.username && !harbor.password && !harbor.search && !harbor.hash && harbor.pathname === "/", "harbor_origin_required");
      requireThat(harbor.protocol === "https:" || harbor.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(harbor.hostname), "harbor_transport_requires_tls_or_loopback");
      harborOwnerCredential = process.env.HARBOR_OWNER_TOKEN;
      requireThat(typeof harborOwnerCredential === "string" && /^[A-Za-z0-9_-]{43}$/.test(harborOwnerCredential) && Buffer.from(harborOwnerCredential, "base64url").length === 32, "harbor_owner_credential_required");
    }
    agentCredential = randomBytes(32).toString("base64url");
  } catch (error) {
    emit(phase, error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_configuration");
    process.exitCode = 2;
    return;
  }

  const operations = ["profile.list", "profile.read", "instance.start", "instance.stop", "instance.observe", "instance.handoff", "account.bind"];
  const origin = target.origin;
  let grant, connection, policyVersion, sequence = 0, grantRevoked = false, completed = false;
  const profiles = [], sessions = new Map(), stopped = new Set();
  const nextKey = label => `${stamp}:${++sequence}:${label}`;
  const failureCode = response => response.body?.error?.code ?? response.body?.failure?.code ?? response.body?.error;
  async function request(credential, method, path, body, base = core) {
    let response;
    try {
      response = await fetch(new URL(path, base), { method, redirect: "error", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
    } catch { throw new Error("transport_outcome_unknown_no_replay"); }
    const bytes = await response.text();
    requireThat(bytes.length <= 1_000_000, "response_too_large");
    let parsed;
    try { parsed = JSON.parse(bytes); } catch { throw new Error("invalid_json_response"); }
    requireThat(parsed && typeof parsed === "object" && !Array.isArray(parsed), "invalid_response");
    return { status: response.status, body: parsed };
  }
  async function owner(method, path, body) {
    const response = await request(ownerCredential, method, path, body);
    requireThat(response.status >= 200 && response.status < 300 && response.body.ok === true, "owner_request_refused");
    return response.body;
  }
  function scope(allowedOperations = operations) {
    return { operations: allowedOperations, profile_refs: profiles.map(profile => profile.profile_ref), origins: [origin] };
  }
  function operationBody(operation, extra = {}, task_scope = scope([operation])) {
    return { idempotency_key: nextKey(operation), connection_id: connection.connection_id, grant_id: grant.grant_id, operation, task_scope, ...extra };
  }
  async function submit(body) { return request(agentCredential, "POST", "/managed-browser/operations", body); }
  async function execute(operation, extra = {}, task_scope) {
    const response = await submit(operationBody(operation, extra, task_scope));
    if (response.body.status === "unknown_outcome") emit(phase, "unknown_outcome_no_replay", { run_id: response.body.run_id });
    requireThat(response.status >= 200 && response.status < 300 && response.body.ok === true && response.body.status === "succeeded", "managed_operation_failed");
    requireThat(response.body.result && typeof response.body.result === "object", "managed_result_missing");
    return response.body.result;
  }
  function denied(response, expectedCodes) {
    requireThat(response.body.ok !== true && expectedCodes.includes(failureCode(response)), "expected_denial_not_proven");
    emit(phase, "denied_as_expected");
  }
  async function stop(profile) {
    const result = await execute("instance.stop", { profile_ref: profile.profile_ref });
    requireThat(result.session?.runtime_session_ref === sessions.get(profile.profile_ref) && result.session.lifecycle_state === "closed", "stop_did_not_close_original_instance");
    stopped.add(profile.profile_ref);
  }

  try {
    phase = "isolated_policy";
    const existing = await owner("GET", "/execution-policy-configs/global");
    requireThat(existing.configuration === null, "nonempty_global_policy_refused");
    const policy = await owner("PUT", "/execution-policy-configs/global", { schema_version: "webenvoy.execution-policy-mutation.v0", idempotency_key: nextKey("policy"),
      expected_source_version: null, modes: { read: "auto", prepare: "deny", commit: "auto", destructive: "deny" } });
    policyVersion = policy.configuration?.source_version;
    requireThat(typeof policyVersion === "string", "policy_version_missing");
    emit(phase, "configured_new_isolated_store");

    phase = "stable_principal";
    const registered = await owner("POST", "/agent-access/principals", { idempotency_key: nextKey("register"), display_name: stamp, credential_hash: hash(agentCredential) });
    requireThat(typeof registered.principal?.principal_id === "string", "principal_missing");
    const connected = await request(agentCredential, "POST", "/agent-connections", {});
    requireThat(connected.body.ok === true && connected.body.connection?.principal_id === registered.principal.principal_id, "connection_principal_mismatch");
    connection = connected.body.connection;
    const template_ref = `template:${stamp}`;
    const granted = await owner("POST", "/agent-access/grants", { idempotency_key: nextKey("grant"), principal_id: registered.principal.principal_id,
      profile_refs: [], allowed_operations: ["profile.create", ...operations], allowed_origins: [origin], expires_at: new Date(Date.now() + 3_600_000).toISOString(), max_created_profiles: 2,
      creation_template: { template_ref, provider_id: "camoufox", site: { site_id: "managed-live", origin, display_name: "Isolated managed live check" }, language: "en-US", timezone: "UTC",
        permission_ceiling: { allowed_operations: operations, allowed_origins: [origin] } } });
    grant = granted.grant;
    requireThat(grant?.principal_id === registered.principal.principal_id, "grant_principal_mismatch");
    emit(phase, "connected_and_granted", { principal_id: registered.principal.principal_id, connection_id: connection.connection_id, grant_id: grant.grant_id });

    phase = "agent_self_escalation";
    const escalation = await request(agentCredential, "POST", "/agent-access/grants", {});
    requireThat([401, 403].includes(escalation.status) && escalation.body.ok !== true, "agent_owner_boundary_missing");
    emit(phase, "denied_as_expected");
    phase = "template_escalation";
    denied(await submit(operationBody("profile.create", { template_ref: "template:unauthorized" })), ["managed_access_creation_denied"]);

    for (const name of ["a", "b"]) {
      phase = `create_${name}`;
      const result = await execute("profile.create", { template_ref });
      requireThat(typeof result.profile?.profile_ref === "string" && !profiles.some(profile => profile.profile_ref === result.profile.profile_ref), "profile_isolation_missing");
      requireThat(Array.isArray(result.profile.account_bindings) && result.profile.account_bindings.length === 0, "new_profile_has_implicit_binding");
      profiles.push(result.profile);
      emit(phase, "created", { profile_ref: result.profile.profile_ref });
    }
    phase = "creation_quota";
    denied(await submit(operationBody("profile.create", { template_ref })), ["managed_access_creation_denied"]);
    phase = "list_two_profiles";
    const listed = await execute("profile.list");
    requireThat(Array.isArray(listed.profiles) && listed.profiles.length === 2 && profiles.every(profile => listed.profiles.some(item => item.profile_ref === profile.profile_ref)), "profile_list_not_isolated");
    emit(phase, "passed");

    for (const [index, profile] of profiles.entries()) {
      phase = `start_${index + 1}`;
      const started = await execute("instance.start", { profile_ref: profile.profile_ref, origin, url: target.href });
      const ref = started.session?.runtime_session_ref;
      requireThat(typeof ref === "string" && started.observation?.runtime_session_ref === ref && started.observation.profile_ref === profile.profile_ref && ![...sessions.values()].includes(ref), "instance_isolation_missing");
      sessions.set(profile.profile_ref, ref);
      emit(phase, "started", { profile_ref: profile.profile_ref, runtime_session_ref: ref });
      phase = `reuse_${index + 1}`;
      const reused = await execute("instance.start", { profile_ref: profile.profile_ref, origin, url: target.href });
      requireThat(reused.session?.runtime_session_ref === ref && reused.observation?.runtime_session_ref === ref, "reuse_replaced_instance");
      const observed = await execute("instance.observe", { profile_ref: profile.profile_ref, origin });
      requireThat(observed.observation?.runtime_session_ref === ref && observed.observation.profile_ref === profile.profile_ref, "observation_instance_mismatch");
      emit(phase, "same_instance_observed", { runtime_session_ref: ref });
    }

    phase = "foreign_profile";
    denied(await submit(operationBody("profile.read", { profile_ref: "profile:outside-live-grant" }, { ...scope(["profile.read"]), profile_refs: ["profile:outside-live-grant"] })), ["managed_access_denied"]);
    phase = "foreign_origin";
    denied(await submit(operationBody("instance.observe", { profile_ref: profiles[0].profile_ref, origin: "https://outside.invalid" }, { ...scope(["instance.observe"]), origins: ["https://outside.invalid"] })), ["managed_access_denied"]);
    phase = "task_scope_intersection";
    denied(await submit(operationBody("instance.observe", { profile_ref: profiles[0].profile_ref, origin }, { operations: ["instance.observe"], profile_refs: [], origins: [origin] })), ["managed_access_denied"]);
    phase = "forged_connection";
    denied(await submit({ ...operationBody("profile.list"), connection_id: "connection:forged" }), ["managed_access_connection_unavailable"]);

    if (handoff) {
      phase = ownerReturn ? "handoff_owner_api_return" : "human_handoff";
      const profile = profiles[0], original = sessions.get(profile.profile_ref);
      const transferred = await execute("instance.handoff", { profile_ref: profile.profile_ref });
      requireThat(transferred.session?.runtime_session_ref === original && transferred.session.control_owner === "user", "handoff_not_same_instance");
      emit(phase, "human_controlled", { runtime_session_ref: original });
      const blocked = await submit(operationBody("instance.observe", { profile_ref: profile.profile_ref, origin }));
      denied(blocked, ["session_locked", "control_lock_conflict", "session_user_controlled"]);
      if (ownerReturn) {
        const released = await request(harborOwnerCredential, "POST", `/runtime/sessions/${encodeURIComponent(original)}/release`, { control_owner: "user" }, harbor);
        requireThat(released.status === 200 && released.body.runtime_session_ref === original && released.body.control_owner === "none" && released.body.control_lock?.state === "released", "owner_api_return_not_confirmed");
        emit(phase, "owner_api_returned_control", { runtime_session_ref: original });
      } else {
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        try { await terminal.question("Return control of the FIRST isolated instance through App, then press Enter. Do not enter credentials.\n"); }
        finally { terminal.close(); }
      }
      const resumed = await execute("instance.start", { profile_ref: profile.profile_ref, origin, url: target.href });
      requireThat(resumed.observation?.runtime_session_ref === original, "handoff_resume_replaced_instance");
      emit(phase, "same_instance_reobserved", { runtime_session_ref: original });
    } else emit("human_handoff", "not_run_requires_human_return");
    emit("verified_account_binding", "not_run_requires_verified_site_identity");
    emit("cookie_storage_isolation", "not_run_requires_authorized_site_probe");

    for (const [index, profile] of profiles.entries()) {
      phase = `stop_${index + 1}`;
      await stop(profile);
      emit(phase, "closed_original_instance", { runtime_session_ref: sessions.get(profile.profile_ref) });
    }
    phase = "revoke_grant";
    await owner("POST", `/agent-access/grants/${encodeURIComponent(grant.grant_id)}/revoke`, { idempotency_key: `${stamp}:revoke` });
    grantRevoked = true;
    const reconnected = await request(agentCredential, "POST", "/agent-connections", {});
    requireThat(reconnected.body.ok === true && reconnected.body.connection?.principal_id === connection.principal_id && reconnected.body.connection.connection_id !== connection.connection_id, "reconnection_identity_mismatch");
    connection = reconnected.body.connection;
    phase = "revoked_grant_after_reconnect";
    denied(await submit(operationBody("profile.list")), ["managed_access_grant_unavailable"]);
    completed = true;
  } catch (error) {
    emit(phase, error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "acceptance_failed");
    process.exitCode = 1;
  } finally {
    for (const profile of profiles) if (sessions.has(profile.profile_ref) && !stopped.has(profile.profile_ref) && !grantRevoked) {
      phase = "cleanup_stop";
      try { await stop(profile); emit(phase, "closed", { profile_ref: profile.profile_ref }); }
      catch { emit(phase, "not_closed_requires_owner_attention", { profile_ref: profile.profile_ref }); process.exitCode = 1; }
    }
    if (grant && !grantRevoked) {
      try { await owner("POST", `/agent-access/grants/${encodeURIComponent(grant.grant_id)}/revoke`, { idempotency_key: `${stamp}:revoke` }); grantRevoked = true; }
      catch { emit("cleanup_grant", "revocation_unconfirmed"); process.exitCode = 1; }
    }
    if (policyVersion) {
      try { await owner("PUT", "/execution-policy-configs/global", { schema_version: "webenvoy.execution-policy-mutation.v0", idempotency_key: nextKey("restrict-policy"), expected_source_version: policyVersion,
        modes: { read: "deny", prepare: "deny", commit: "deny", destructive: "deny" } }); emit("cleanup_policy", "isolated_store_all_deny"); }
      catch { emit("cleanup_policy", "not_changed_check_owner_policy_version"); process.exitCode = 1; }
    }
    emit("acceptance", completed && !process.exitCode ? "management_checks_passed_with_explicit_coverage_gaps" : "incomplete");
    for (const profile of profiles) emit("retained_isolated_profile", "not_deleted", { profile_ref: profile.profile_ref });
    ownerCredential = undefined;
    agentCredential = undefined;
    harborOwnerCredential = undefined;
  }
}
